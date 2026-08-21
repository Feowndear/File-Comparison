import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { createWorker, OEM, PSM } from "tesseract.js";
import { cleanExtractedText } from "./compare.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeDirectory = path.join(os.tmpdir(), "legal-doc-compare-ocr-v1");
const languageDirectory = path.join(runtimeDirectory, "languages");
const cacheDirectory = path.join(runtimeDirectory, "cache");
const chiSimData = require("@tesseract.js-data/chi_sim");
const engData = require("@tesseract.js-data/eng");

let pdfjsPromise = null;
let workerPromise = null;
let ocrQueue = Promise.resolve();

async function copyIfMissing(source, destination) {
  try {
    await fs.access(destination);
  } catch {
    await fs.copyFile(source, destination);
  }
}

async function prepareLanguageData() {
  await Promise.all([
    fs.mkdir(languageDirectory, { recursive: true }),
    fs.mkdir(cacheDirectory, { recursive: true }),
  ]);

  await Promise.all([
    copyIfMissing(
      path.join(chiSimData.langPath, "chi_sim.traineddata.gz"),
      path.join(languageDirectory, "chi_sim.traineddata.gz"),
    ),
    copyIfMissing(
      path.join(engData.langPath, "eng.traineddata.gz"),
      path.join(languageDirectory, "eng.traineddata.gz"),
    ),
  ]);
}

export async function getPdfJs() {
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
  if (!globalThis.ImageData) globalThis.ImageData = ImageData;
  if (!globalThis.Path2D) globalThis.Path2D = Path2D;
  pdfjsPromise ||= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await prepareLanguageData();
      const worker = await createWorker(["chi_sim", "eng"], OEM.LSTM_ONLY, {
        langPath: languageDirectory,
        cachePath: cacheDirectory,
        gzip: true,
        logger:
          process.env.OCR_DEBUG === "true"
            ? (message) => console.log(`OCR ${message.status}: ${message.progress ?? ""}`)
            : () => {},
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: String(Number(process.env.OCR_DPI || 300)),
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function renderPdfPage(page) {
  const dpi = Math.max(144, Math.min(Number(process.env.OCR_DPI || 300), 300));
  const maxPixels = Number(process.env.OCR_MAX_PIXELS || 9000000);
  let scale = dpi / 72;
  let viewport = page.getViewport({ scale });
  const pixels = viewport.width * viewport.height;

  if (pixels > maxPixels) {
    scale *= Math.sqrt(maxPixels / pixels);
    viewport = page.getViewport({ scale });
  }

  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    background: "#ffffff",
  }).promise;

  return canvas.toBuffer("image/png");
}

async function recognizeImage(image) {
  const worker = await getWorker();
  const result = await worker.recognize(image);
  return {
    text: cleanExtractedText(result.data.text)
      .replace(/服务合(?:厅|司厂)/g, "服务合同")
      .replace(/期限(?:力|加)(?=[一二三四五六七八九十百0-9])/g, "期限为")
      .replace(/金额(?:力|加)(?=上限)/g, "金额为"),
    confidence: Number(result.data.confidence || 0),
  };
}

export function recognizePdfPages(document, pageNumbers) {
  const task = ocrQueue.then(async () => {
    const results = [];

    for (const pageNumber of pageNumbers) {
      const page = await document.getPage(pageNumber);
      try {
        const image = await renderPdfPage(page);
        const recognition = await recognizeImage(image);
        results.push({ pageNumber, ...recognition });
      } finally {
        page.cleanup();
      }
    }

    return results;
  });

  ocrQueue = task.catch(() => undefined);
  return task;
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}
