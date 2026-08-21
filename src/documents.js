import path from "node:path";
import mammoth from "mammoth";
import { cleanExtractedText } from "./compare.js";
import { getPdfJs, recognizePdfPages } from "./ocr.js";

const SUPPORTED_EXTENSIONS = new Set([".docx", ".pdf"]);
const OCR_PAGE_TEXT_THRESHOLD = Number(process.env.OCR_PAGE_TEXT_THRESHOLD || 12);
const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES || 60);

export function decodeUploadFilename(value) {
  const name = String(value || "");
  if (!/[ÃÂÐÑà-ÿ]/.test(name)) return name;

  try {
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    return decoded.includes("\uFFFD") ? name : decoded;
  } catch {
    return name;
  }
}

export function validateDocument(file) {
  if (!file) throw new Error("缺少文档");
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error("仅支持 DOCX 和 PDF 文件");
  }
  return extension;
}

export async function extractDocument(file) {
  const extension = validateDocument(file);
  const displayName = decodeUploadFilename(file.originalname);
  let text = "";
  let pdfMeta = null;

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    text = result.value;
  } else {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(file.buffer),
      disableFontFace: true,
      useSystemFonts: true,
    });
    const document = await loadingTask.promise;
    const pages = [];
    const ocrCandidates = [];
    const ocrConfidence = [];

    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        let pageText = "";

        for (const item of content.items) {
          if (!("str" in item)) continue;
          pageText += item.str;
          pageText += item.hasEOL ? "\n" : " ";
        }

        const cleanedPageText = cleanExtractedText(pageText);
        pages.push(cleanedPageText);
        if (cleanedPageText.replace(/\s/g, "").length < OCR_PAGE_TEXT_THRESHOLD) {
          ocrCandidates.push(pageNumber);
        }
        page.cleanup();
      }

      if (ocrCandidates.length > OCR_MAX_PAGES) {
        throw new Error(
          `扫描页共 ${ocrCandidates.length} 页，超过单次 OCR 上限 ${OCR_MAX_PAGES} 页`,
        );
      }

      if (ocrCandidates.length) {
        const recognizedPages = await recognizePdfPages(document, ocrCandidates);
        for (const recognized of recognizedPages) {
          const index = recognized.pageNumber - 1;
          if (recognized.text.length > pages[index].length) {
            pages[index] = recognized.text;
          }
          ocrConfidence.push(recognized.confidence);
        }
      }

      pdfMeta = {
        totalPages: document.numPages,
        ocrUsed: ocrCandidates.length > 0,
        ocrPages: ocrCandidates,
        ocrAverageConfidence: ocrConfidence.length
          ? Math.round(
              ocrConfidence.reduce((sum, confidence) => sum + confidence, 0) /
                ocrConfidence.length,
            )
          : null,
      };
    } finally {
      await loadingTask.destroy();
    }

    text = pages.join("\n\n");
  }

  const cleaned = cleanExtractedText(text);
  if (!cleaned) {
    throw new Error(
      extension === ".pdf"
        ? "未能从 PDF 中提取或识别到文字，请确认扫描页清晰且方向正确"
        : "文档中没有可读取的文字",
    );
  }

  return {
    text: cleaned,
    meta: {
      name: displayName,
      size: file.size,
      type: extension.slice(1).toUpperCase(),
      characters: cleaned.length,
      ...pdfMeta,
    },
  };
}
