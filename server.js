const express = require("express");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error("Missing OPENAI_API_KEY in environment.");
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  timeout: 15000,
  maxRetries: 0
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

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
    const text = String(req.body?.text || "").trim();
    const voice = String(req.body?.voice || "alloy").trim();

    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    const speech = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "mp3"
    });

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
    const text = String(req.body?.text || "").trim();
    const instructions = loadAnalyzePrompt();

    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    const response = await client.responses.create({
      model: "gpt-5-mini",
      reasoning: { effort: "minimal" },
      max_output_tokens: 1000,
      instructions,
      input: `请解析这段文本：\n\n${text}`
    });

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
