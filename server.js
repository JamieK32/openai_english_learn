const express = require("express");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const dotenv = require("dotenv");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const ENV_PATH = path.join(__dirname, ".env");
const ENV_MANAGED_KEYS = [
  "PORT",
  "OPENAI_TIMEOUT_MS",
  "API_MODE",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "RELAY_BASE_URL",
  "RELAY_API_KEY",
  "ANALYZE_MODEL",
  "TTS_MODEL"
];
const DEFAULT_RUNTIME_CONFIG = {
  timeoutMs: 15000,
  apiMode: "openai",
  analyzeModel: "gpt-5-mini",
  ttsModel: "gpt-4o-mini-tts"
};

function parseTimeoutMsFromValue(rawValue, fallbackMs) {
  if (rawValue == null || rawValue === "") {
    return fallbackMs;
  }
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackMs;
  }
  return Math.floor(parsedValue);
}

function normalizeApiMode(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  return normalized === "relay" ? "relay" : "openai";
}

function sanitizeTextValue(rawValue) {
  return String(rawValue == null ? "" : rawValue).trim();
}

function maskSecret(value) {
  const raw = sanitizeTextValue(value);
  if (!raw) {
    return "";
  }
  if (raw.length <= 8) {
    return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
  }
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function escapeEnvValue(value) {
  const text = String(value == null ? "" : value);
  if (text === "") {
    return "";
  }
  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) {
    return text;
  }
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function readEnvFileObject() {
  try {
    const raw = fs.readFileSync(ENV_PATH, "utf8");
    return dotenv.parse(raw);
  } catch {
    return {};
  }
}

function writeEnvFileObject(envObject) {
  const orderedKeys = [...new Set([...ENV_MANAGED_KEYS, ...Object.keys(envObject)])];
  const lines = orderedKeys
    .filter((key) => envObject[key] != null)
    .map((key) => `${key}=${escapeEnvValue(envObject[key])}`);
  fs.writeFileSync(ENV_PATH, `${lines.join("\n")}\n`, "utf8");
}

function getMergedEnv() {
  return {
    ...readEnvFileObject(),
    ...process.env
  };
}

function getRuntimeConfig() {
  const merged = getMergedEnv();
  const apiMode = normalizeApiMode(merged.API_MODE || DEFAULT_RUNTIME_CONFIG.apiMode);
  const timeoutMs = parseTimeoutMsFromValue(
    merged.OPENAI_TIMEOUT_MS,
    DEFAULT_RUNTIME_CONFIG.timeoutMs
  );
  const openaiApiKey = sanitizeTextValue(merged.OPENAI_API_KEY);
  const relayApiKey = sanitizeTextValue(merged.RELAY_API_KEY);
  const openaiBaseUrl = sanitizeTextValue(merged.OPENAI_BASE_URL);
  const relayBaseUrl = sanitizeTextValue(merged.RELAY_BASE_URL);
  const analyzeModel =
    sanitizeTextValue(merged.ANALYZE_MODEL) || DEFAULT_RUNTIME_CONFIG.analyzeModel;
  const ttsModel = sanitizeTextValue(merged.TTS_MODEL) || DEFAULT_RUNTIME_CONFIG.ttsModel;

  const activeApiKey =
    apiMode === "relay" ? relayApiKey || openaiApiKey : openaiApiKey || relayApiKey;
  const activeBaseUrl =
    apiMode === "relay" ? relayBaseUrl || openaiBaseUrl : openaiBaseUrl || relayBaseUrl;

  return {
    timeoutMs,
    apiMode,
    analyzeModel,
    ttsModel,
    openaiApiKey,
    relayApiKey,
    openaiBaseUrl,
    relayBaseUrl,
    activeApiKey,
    activeBaseUrl
  };
}

function createClientFromRuntimeConfig(config) {
  if (!config.activeApiKey) {
    throw new Error("未配置 API Key，请在控制台填写并保存。");
  }
  if (config.apiMode === "relay" && !config.activeBaseUrl) {
    throw new Error("当前为 relay 模式，请配置中转 API 地址。");
  }

  const options = {
    apiKey: config.activeApiKey,
    timeout: config.timeoutMs,
    maxRetries: 0
  };
  if (config.activeBaseUrl) {
    options.baseURL = config.activeBaseUrl;
  }
  return new OpenAI(options);
}

function toConfigResponse(config) {
  return {
    timeoutMs: config.timeoutMs,
    apiMode: config.apiMode,
    analyzeModel: config.analyzeModel,
    ttsModel: config.ttsModel,
    openaiBaseUrl: config.openaiBaseUrl,
    relayBaseUrl: config.relayBaseUrl,
    openaiApiKeyMasked: maskSecret(config.openaiApiKey),
    relayApiKeyMasked: maskSecret(config.relayApiKey),
    hasOpenAIApiKey: Boolean(config.openaiApiKey),
    hasRelayApiKey: Boolean(config.relayApiKey)
  };
}

function updateRuntimeEnvVars(nextEnvObject) {
  ENV_MANAGED_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(nextEnvObject, key)) {
      process.env[key] = String(nextEnvObject[key] ?? "");
    } else {
      delete process.env[key];
    }
  });
}

function parseEnvPayload(payload) {
  const errors = [];
  const apiMode = normalizeApiMode(payload?.apiMode);
  const timeoutMs = parseTimeoutMsFromValue(payload?.timeoutMs, 0);
  if (!timeoutMs) {
    errors.push("OPENAI_TIMEOUT_MS 必须是大于 0 的数字。");
  }

  const analyzeModel = sanitizeTextValue(payload?.analyzeModel);
  if (!analyzeModel) {
    errors.push("ANALYZE_MODEL 不能为空。");
  }

  const ttsModel = sanitizeTextValue(payload?.ttsModel);
  if (!ttsModel) {
    errors.push("TTS_MODEL 不能为空。");
  }

  const openaiBaseUrl = sanitizeTextValue(payload?.openaiBaseUrl);
  const relayBaseUrl = sanitizeTextValue(payload?.relayBaseUrl);

  if (apiMode === "relay" && !relayBaseUrl) {
    errors.push("relay 模式下必须填写 RELAY_BASE_URL。");
  }

  const openaiApiKey = sanitizeTextValue(payload?.openaiApiKey);
  const relayApiKey = sanitizeTextValue(payload?.relayApiKey);
  const hasOpenaiApiKeyInput = Object.prototype.hasOwnProperty.call(payload || {}, "openaiApiKey");
  const hasRelayApiKeyInput = Object.prototype.hasOwnProperty.call(payload || {}, "relayApiKey");
  const clearOpenaiApiKey = Boolean(payload?.clearOpenaiApiKey);
  const clearRelayApiKey = Boolean(payload?.clearRelayApiKey);

  return {
    errors,
    nextValues: {
      API_MODE: apiMode,
      OPENAI_TIMEOUT_MS: String(timeoutMs),
      ANALYZE_MODEL: analyzeModel,
      TTS_MODEL: ttsModel,
      OPENAI_BASE_URL: openaiBaseUrl,
      RELAY_BASE_URL: relayBaseUrl
    },
    secretUpdates: {
      hasOpenaiApiKeyInput,
      hasRelayApiKeyInput,
      clearOpenaiApiKey,
      clearRelayApiKey,
      openaiApiKey,
      relayApiKey
    }
  };
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(toConfigResponse(getRuntimeConfig()));
});

app.get("/api/env", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(toConfigResponse(getRuntimeConfig()));
});

app.post("/api/env", (req, res) => {
  try {
    const currentEnvFile = readEnvFileObject();
    const mergedCurrentEnv = getMergedEnv();
    const payloadResult = parseEnvPayload(req.body);
    if (payloadResult.errors.length) {
      return res.status(400).json({ error: payloadResult.errors.join(" ") });
    }

    const nextEnvFile = {
      ...currentEnvFile,
      ...payloadResult.nextValues
    };

    if (payloadResult.secretUpdates.hasOpenaiApiKeyInput || payloadResult.secretUpdates.clearOpenaiApiKey) {
      if (payloadResult.secretUpdates.clearOpenaiApiKey) {
        nextEnvFile.OPENAI_API_KEY = "";
      } else if (payloadResult.secretUpdates.openaiApiKey) {
        nextEnvFile.OPENAI_API_KEY = payloadResult.secretUpdates.openaiApiKey;
      } else if (!nextEnvFile.OPENAI_API_KEY && mergedCurrentEnv.OPENAI_API_KEY) {
        nextEnvFile.OPENAI_API_KEY = sanitizeTextValue(mergedCurrentEnv.OPENAI_API_KEY);
      } else if (!nextEnvFile.OPENAI_API_KEY) {
        nextEnvFile.OPENAI_API_KEY = "";
      }
    }

    if (payloadResult.secretUpdates.hasRelayApiKeyInput || payloadResult.secretUpdates.clearRelayApiKey) {
      if (payloadResult.secretUpdates.clearRelayApiKey) {
        nextEnvFile.RELAY_API_KEY = "";
      } else if (payloadResult.secretUpdates.relayApiKey) {
        nextEnvFile.RELAY_API_KEY = payloadResult.secretUpdates.relayApiKey;
      } else if (!nextEnvFile.RELAY_API_KEY && mergedCurrentEnv.RELAY_API_KEY) {
        nextEnvFile.RELAY_API_KEY = sanitizeTextValue(mergedCurrentEnv.RELAY_API_KEY);
      } else if (!nextEnvFile.RELAY_API_KEY) {
        nextEnvFile.RELAY_API_KEY = "";
      }
    }

    writeEnvFileObject(nextEnvFile);
    updateRuntimeEnvVars(nextEnvFile);

    const runtimeConfig = getRuntimeConfig();
    return res.json({
      message: "环境变量已保存并即时生效。",
      config: toConfigResponse(runtimeConfig)
    });
  } catch (error) {
    console.error("Failed to update env config:", error);
    return res.status(500).json({ error: "保存 .env 失败" });
  }
});

const ANALYZE_PROMPT_PATH = path.join(__dirname, "prompt.md");
const DEFAULT_ANALYZE_PROMPT =
  "你是一名英语学习老师。请基于用户给出的英文文本，用简体中文输出 Markdown。输出结构固定为：## 语法解析、## 重点词汇、## 学习建议。每个部分用简洁的要点列表。不要输出多余寒暄。";

function loadAnalyzePrompt() {
  try {
    const fileContent = fs.readFileSync(ANALYZE_PROMPT_PATH, "utf8").trim();
    return fileContent || DEFAULT_ANALYZE_PROMPT;
  } catch (error) {
    console.warn("Failed to read prompt.md, fallback to default prompt.");
    return DEFAULT_ANALYZE_PROMPT;
  }
}

app.post("/api/tts", async (req, res) => {
  try {
    const runtimeConfig = getRuntimeConfig();
    const client = createClientFromRuntimeConfig(runtimeConfig);
    const text = String(req.body?.text || "").trim();
    const voice = String(req.body?.voice || "alloy").trim();

    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    const speech = await client.audio.speech.create({
      model: runtimeConfig.ttsModel,
      voice,
      input: text,
      response_format: "mp3"
    }, { timeout: runtimeConfig.timeoutMs });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.send(audioBuffer);
  } catch (error) {
    console.error("TTS generation failed:", error);
    const rawMessage = String(error?.message || "");
    const isTimeout = rawMessage.toLowerCase().includes("timed out");
    const status = Number(error?.status) || (isTimeout ? 504 : 500);
    const message =
      rawMessage ||
      (isTimeout
        ? "OpenAI request timed out. Check internet/API access and try again."
        : "Failed to generate TTS");
    return res.status(status).json({ error: message });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const runtimeConfig = getRuntimeConfig();
    const client = createClientFromRuntimeConfig(runtimeConfig);
    const text = String(req.body?.text || "").trim();
    const instructions = loadAnalyzePrompt();

    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    const response = await client.responses.create({
      model: runtimeConfig.analyzeModel,
      reasoning: { effort: "minimal" },
      max_output_tokens: 128000,
      instructions,
      input: `请解析这段文本：\n\n${text}`
    }, { timeout: runtimeConfig.timeoutMs });

    let markdown = String(response?.output_text || "").trim();

    if (!markdown && Array.isArray(response?.output)) {
      markdown = response.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .filter((item) => item?.type === "output_text")
        .map((item) => String(item?.text || ""))
        .join("\n")
        .trim();
    }

    if (!markdown) {
      return res.status(502).json({ error: "未获取到解析结果" });
    }

    return res.json({ markdown });
  } catch (error) {
    console.error("Analyze request failed:", error);
    const rawMessage = String(error?.message || "");
    const isTimeout = rawMessage.toLowerCase().includes("timed out");
    const status = Number(error?.status) || (isTimeout ? 504 : 500);
    const message =
      rawMessage ||
      (isTimeout
        ? "OpenAI request timed out. Check internet/API access and try again."
        : "Failed to analyze text");
    return res.status(status).json({ error: message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
