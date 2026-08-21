import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { Document, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.join(__dirname, "..", "test", "fixtures");

const originalClauses = [
  "第一条 服务期限为一年，自2026年9月1日起计算。",
  "第二条 合同总价为人民币100,000元，甲方应在验收后30日内付款。",
  "第三条 双方对履约中获悉的商业秘密承担对等保密义务。",
  "第四条 任一方承担的赔偿责任以合同总价为上限。",
  "第五条 争议应提交上海仲裁委员会仲裁。",
];

const revisedClauses = [
  "第一条 服务期限为两年，自2026年9月1日起计算，并自动续期一年。",
  "第二条 合同总价为人民币120,000元，甲方应在收到发票后10日内付款。",
  "第三条 乙方对履约中获悉的全部信息承担永久保密义务。",
  "第四条 乙方承担无限赔偿责任，甲方不承担任何间接损失。",
  "第五条 争议应提交北京仲裁委员会仲裁。",
  "第六条 甲方可提前三日书面通知无条件终止合同。",
];

async function writeDocx(fileName, clauses) {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph("软件服务合同"),
          ...clauses.map((clause) => new Paragraph(clause)),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);
  await fs.writeFile(path.join(outputDirectory, fileName), buffer);
}

function makePdf(clauses) {
  return new Promise((resolve) => {
    const document = new PDFDocument({ margin: 54 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.font("Helvetica-Bold").fontSize(16).text("Software Services Agreement");
    document.moveDown();
    clauses.forEach((clause, index) => {
      document.font("Helvetica").fontSize(11).text(`${index + 1}. ${clause}`);
      document.moveDown(0.6);
    });
    document.end();
  });
}

function makeScannedPdf(title, clauses) {
  const fontPath = "C:\\Windows\\Fonts\\msyh.ttc";
  return fs
    .access(fontPath)
    .then(() => GlobalFonts.registerFromPath(fontPath, "Microsoft YaHei"))
    .catch(() => false)
    .then(
      () =>
        new Promise((resolve) => {
          const canvas = createCanvas(1600, 2200);
          const context = canvas.getContext("2d");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "#111111";
          context.font = 'bold 66px "Microsoft YaHei", Arial';
          context.fillText(title, 130, 210);
          context.font = '48px "Microsoft YaHei", Arial';
          clauses.forEach((clause, index) => context.fillText(clause, 130, 390 + index * 130));

          const image = canvas.toBuffer("image/png");
          const document = new PDFDocument({ size: "A4", margin: 0 });
          const chunks = [];
          document.on("data", (chunk) => chunks.push(chunk));
          document.on("end", () => resolve(Buffer.concat(chunks)));
          document.image(image, 0, 0, {
            fit: [595.28, 841.89],
            align: "center",
            valign: "center",
          });
          document.end();
        }),
    );
}

await fs.mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeDocx("original-contract.docx", originalClauses),
  writeDocx("revised-contract.docx", revisedClauses),
  makePdf([
    "The service term is one year.",
    "Payment is due within 30 days after acceptance.",
    "Liability is capped at the total contract value.",
  ]).then((buffer) => fs.writeFile(path.join(outputDirectory, "original-contract.pdf"), buffer)),
  makePdf([
    "The service term is two years and renews automatically.",
    "Payment is due within 10 days after invoice.",
    "Supplier liability is unlimited.",
    "Customer may terminate on three days notice.",
  ]).then((buffer) => fs.writeFile(path.join(outputDirectory, "revised-contract.pdf"), buffer)),
  makeScannedPdf("软件服务合同", [
    "第一条 服务期限为一年。",
    "第二条 付款期限为三十日。",
    "第三条 赔偿责任以合同金额为上限。",
  ]).then((buffer) =>
    fs.writeFile(path.join(outputDirectory, "original-scanned-contract.pdf"), buffer),
  ),
  makeScannedPdf("软件服务合同", [
    "第一条 服务期限为两年。",
    "第二条 付款期限为十日。",
    "第三条 乙方承担无限赔偿责任。",
    "第四条 甲方可提前三日通知终止。",
  ]).then((buffer) =>
    fs.writeFile(path.join(outputDirectory, "revised-scanned-contract.pdf"), buffer),
  ),
]);

console.log(`Fixtures created in ${outputDirectory}`);
