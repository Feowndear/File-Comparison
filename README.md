# 法务文档对比台

一个本地运行的 DOCX/PDF 双文档对比工具。基础文本差异在本机完成；扫描版 PDF 自动 OCR；配置 OpenAI 兼容接口后，可生成法务风险摘要、影响判断与谈判建议。

## 快速启动

要求：Node.js 20 或更高版本。

Windows 下可以双击：

```text
start-legal-doc-compare.cmd
```

或者手动启动：

```powershell
Copy-Item .env.example .env
# 编辑 .env，填入自己的模型配置
npm install
npm start
```

浏览器打开 `http://localhost:4173/`。

开发模式可使用：

```powershell
npm run dev
```

## 项目结构

```text
legal-doc-compare/
├─ public/              网页界面、样式和前端交互
├─ src/
│  ├─ ai.js             AI 网关调用和结果整理
│  ├─ compare.js        段落、条款和词级差异算法
│  ├─ documents.js      DOCX/PDF 文本提取
│  └─ ocr.js            扫描 PDF OCR
├─ test/                自动化测试和虚构样例文档
├─ scripts/             测试样例生成脚本
├─ server.js            Express 本地服务和上传接口
├─ start-legal-doc-compare.cmd
├─ package.json
└─ .env.example         环境变量模板
```

## 功能

- 双栏上传 `.docx` / `.pdf`
- 普通 PDF、DOCX 文本提取
- 扫描 PDF 自动简体中文和英文 OCR
- 变更清单和全文左右对照
- 原稿删除内容标红，修订稿新增内容标绿
- 变更卡片可跳转到全文对照对应位置
- AI 法务风险研判
- Markdown 报告导出
- 单文件上限 25 MB

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LLM_KEY` | 空 | 模型 API Key；留空仍可使用基础对比 |
| `LLM_URL` | 空 | OpenAI 兼容网关的完整 Chat Completions 地址 |
| `LLM_MODEL` | 空 | 网关提供的模型名称 |
| `OPENAI_API_MODE` | `responses` | 兼容网关通常设置为 `chat` |
| `OCR_DPI` | `300` | 扫描页 OCR 渲染清晰度，可设置 144-300 |
| `OCR_PAGE_TEXT_THRESHOLD` | `12` | 页面文字少于该值时触发 OCR |
| `OCR_MAX_PAGES` | `60` | 单份 PDF 最大 OCR 页数 |
| `PORT` | `4173` | 本地服务端口 |

## 测试

```powershell
npm test
```

AI 输出用于辅助审阅，不构成法律意见。

## 分享前注意

- `.env` 已被 `.gitignore` 忽略，不要提交真实 API Key。
- 分享到公开仓库前，建议重新生成此前已经暴露过的 API Key。
- 接收方复制 `.env.example` 为 `.env`，填入自己的 Key 后再启动。
