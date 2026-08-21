import OpenAI from "openai";

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    overview: { type: "string" },
    overallRisk: { type: "string", enum: ["high", "medium", "low", "none"] },
    keyFindings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          changeId: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" },
          impact: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["changeId", "severity", "title", "impact", "recommendation"],
      },
    },
    negotiationChecklist: {
      type: "array",
      items: { type: "string" },
    },
    unchangedNote: { type: "string" },
  },
  required: [
    "overview",
    "overallRisk",
    "keyFindings",
    "negotiationChecklist",
    "unchangedNote",
  ],
};

function compactChanges(changes) {
  let remaining = 90000;
  const selected = [];

  for (const change of changes.slice(0, 80)) {
    const record = {
      id: change.id,
      type: change.type,
      location: change.location,
      original: change.original.slice(0, 2400),
      revised: change.revised.slice(0, 2400),
    };
    const serialized = JSON.stringify(record);
    if (serialized.length > remaining) break;
    selected.push(record);
    remaining -= serialized.length;
  }

  return selected;
}

function parseJsonObject(value) {
  const text = String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error("模型没有返回可解析的 JSON");
  }
  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

function buildRequestPayload({ comparison, originalMeta, revisedMeta }) {
  const changes = compactChanges(comparison.changes);
  return {
    task: "比较修订稿相对原稿的法务影响",
    originalFile: originalMeta.name,
    revisedFile: revisedMeta.name,
    totalChangeGroups: comparison.changes.length,
    includedChangeGroups: changes.length,
    changes,
  };
}

const SYSTEM_PROMPT =
  "你是一名严谨的企业合同法务审阅助手。请仅依据给出的差异进行分析，不要臆测缺失条款。重点识别权利义务、金额、期限、责任、解除、知识产权、保密、数据合规和争议解决的实质变化。使用简洁、专业的中文。changeId 必须引用输入中真实存在的 ID。输出是辅助审阅，不要声称构成正式法律意见。";

export function getAiConfig() {
  const endpoint = process.env.LLM_URL?.replace(/\/+$/, "");
  const endpointBaseURL = endpoint?.replace(/\/chat\/completions$/i, "");
  const baseURL = process.env.OPENAI_BASE_URL || endpointBaseURL;

  return {
    apiKey: process.env.LLM_KEY || process.env.OPENAI_API_KEY || "",
    baseURL,
    endpoint,
    mode:
      process.env.OPENAI_API_MODE ||
      (endpoint?.endsWith("/chat/completions") || baseURL ? "chat" : "responses"),
    model: process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-5.6",
  };
}

async function analyzeWithResponses(client, model, payload) {
  const response = await client.responses.create({
    model,
    store: false,
    instructions: SYSTEM_PROMPT,
    input: JSON.stringify(payload),
    text: {
      format: {
        type: "json_schema",
        name: "legal_document_comparison",
        strict: true,
        schema: REPORT_SCHEMA,
      },
    },
  });

  return parseJsonObject(response.output_text);
}

async function analyzeWithChatCompletions(client, model, payload) {
  const request = {
    model,
    messages: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n必须只返回一个 JSON 对象，结构必须符合以下 JSON Schema：\n${JSON.stringify(REPORT_SCHEMA)}`,
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  };

  let response;
  try {
    response = await client.chat.completions.create(request);
  } catch (error) {
    if (error?.status !== 400) throw error;
    const { response_format: _responseFormat, ...fallbackRequest } = request;
    response = await client.chat.completions.create(fallbackRequest);
  }

  return parseJsonObject(response.choices?.[0]?.message?.content);
}

export async function analyzeChanges({ comparison, originalMeta, revisedMeta }) {
  const config = getAiConfig();
  if (!config.apiKey) return null;

  if (comparison.identical) {
    return {
      overview: "未发现文本层面的差异。",
      overallRisk: "none",
      keyFindings: [],
      negotiationChecklist: [],
      unchangedNote: "两份文档提取出的正文一致。",
    };
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL || undefined,
    timeout: 120000,
    maxRetries: 1,
  });
  const payload = buildRequestPayload({ comparison, originalMeta, revisedMeta });

  return config.mode === "chat"
    ? analyzeWithChatCompletions(client, config.model, payload)
    : analyzeWithResponses(client, config.model, payload);
}
