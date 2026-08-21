import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { compareDocuments } from "./src/compare.js";
import { extractDocument } from "./src/documents.js";
import { analyzeChanges, getAiConfig } from "./src/ai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 2,
  },
});

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));
app.get("/vendor/lucide.js", (_request, response) => {
  response.sendFile(path.join(__dirname, "node_modules", "lucide", "dist", "umd", "lucide.js"));
});

app.get("/api/status", (_request, response) => {
  const aiConfig = getAiConfig();
  response.json({
    ok: true,
    aiConfigured: Boolean(aiConfig.apiKey),
    model: aiConfig.model,
    apiMode: aiConfig.mode,
  });
});

app.post(
  "/api/compare",
  upload.fields([
    { name: "original", maxCount: 1 },
    { name: "revised", maxCount: 1 },
  ]),
  async (request, response) => {
    try {
      const originalFile = request.files?.original?.[0];
      const revisedFile = request.files?.revised?.[0];

      if (!originalFile || !revisedFile) {
        return response.status(400).json({ error: "请同时上传原稿和修订稿" });
      }

      const [original, revised] = await Promise.all([
        extractDocument(originalFile),
        extractDocument(revisedFile),
      ]);
      const comparison = compareDocuments(original.text, revised.text);

      let ai = null;
      let aiError = null;
      const aiConfig = getAiConfig();
      if (request.body.useAi !== "false" && aiConfig.apiKey) {
        try {
          ai = await analyzeChanges({
            comparison,
            originalMeta: original.meta,
            revisedMeta: revised.meta,
          });
        } catch (error) {
          console.error("AI analysis failed:", error);
          aiError = "基础差异已完成，但 AI 研判暂时失败，请检查模型权限或稍后重试。";
        }
      }

      return response.json({
        files: {
          original: original.meta,
          revised: revised.meta,
        },
        comparison,
        ai,
        aiError,
        aiConfigured: Boolean(aiConfig.apiKey),
        model: aiConfig.model,
        apiMode: aiConfig.mode,
      });
    } catch (error) {
      console.error(error);
      const message =
        error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
          ? "单个文件不能超过 25 MB"
          : error.message || "文档解析失败";
      return response.status(400).json({ error: message });
    }
  },
);

app.use((error, _request, response, _next) => {
  console.error(error);
  const message =
    error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
      ? "单个文件不能超过 25 MB"
      : "服务暂时不可用";
  response.status(500).json({ error: message });
});

const port = Number(process.env.PORT || 4173);
let server = null;

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  server = app.listen(port, () => {
    console.log(`Legal document compare is running at http://localhost:${port}`);
  });
  server.requestTimeout = 10 * 60 * 1000;
}

export { server };
export default app;
