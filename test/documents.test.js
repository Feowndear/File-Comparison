import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { Document, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";
import { decodeUploadFilename, extractDocument } from "../src/documents.js";
import { terminateOcrWorker } from "../src/ocr.js";

function makePdfBuffer(text) {
  return new Promise((resolve) => {
    const document = new PDFDocument();
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.font("Helvetica").text(text);
    document.end();
  });
}

function makeScannedPdfBuffer(lines) {
  return new Promise((resolve) => {
    const canvas = createCanvas(1600, 2200);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111111";
    context.font = "bold 66px Arial";
    context.fillText("SOFTWARE SERVICES AGREEMENT", 120, 220);
    context.font = "52px Arial";
    lines.forEach((line, index) => context.fillText(line, 120, 410 + index * 130));

    const image = canvas.toBuffer("image/png");
    const document = new PDFDocument({ size: "A4", margin: 0 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.image(image, 0, 0, { fit: [595.28, 841.89], align: "center", valign: "center" });
    document.end();
  });
}

after(async () => {
  await terminateOcrWorker();
});

test("repairs UTF-8 filenames decoded as latin1", () => {
  assert.equal(
    decodeUploadFilename(
      "JYXC-OT20260710-01-é¿äº­å½äº§å¤§æ¨¡åå®å¨è½åæåæ°æ®éå¼æ¾è®¡å.docx",
    ),
    "JYXC-OT20260710-01-长亭国产大模型安全能力提升数据集开放计划.docx",
  );
});

test("extracts text from DOCX", async () => {
  const document = new Document({
    sections: [{ children: [new Paragraph("Service term is one year.")] }],
  });
  const buffer = await Packer.toBuffer(document);
  const result = await extractDocument({
    originalname: "contract.docx",
    buffer,
    size: buffer.length,
  });

  assert.match(result.text, /Service term is one year/);
  assert.equal(result.meta.type, "DOCX");
});

test("extracts text from PDF", async () => {
  const buffer = await makePdfBuffer("Payment is due within 30 days.");
  const result = await extractDocument({
    originalname: "contract.pdf",
    buffer,
    size: buffer.length,
  });

  assert.match(result.text, /Payment is due within 30 days/);
  assert.equal(result.meta.type, "PDF");
  assert.equal(result.meta.ocrUsed, false);
});

test(
  "uses OCR for image-only scanned PDF pages",
  { timeout: 120000 },
  async () => {
    const buffer = await makeScannedPdfBuffer([
      "PAYMENT DUE WITHIN 10 DAYS",
      "LIABILITY IS UNLIMITED",
      "TERMINATION NOTICE: 3 DAYS",
    ]);
    const result = await extractDocument({
      originalname: "scanned-contract.pdf",
      buffer,
      size: buffer.length,
    });

    assert.match(result.text, /PAYMENT DUE WITHIN 10 DAYS/i);
    assert.match(result.text, /LIABILITY IS UNLIMITED/i);
    assert.equal(result.meta.ocrUsed, true);
    assert.deepEqual(result.meta.ocrPages, [1]);
    assert.ok(result.meta.ocrAverageConfidence > 50);
  },
);
