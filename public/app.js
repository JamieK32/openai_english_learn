const textInput = document.getElementById("text");
const voiceSelect = document.getElementById("voice");
const generateBtn = document.getElementById("generateBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const timeoutBtn = document.getElementById("timeoutBtn");
const saveConversationBtn = document.getElementById("saveConversationBtn");
const newConversationBtn = document.getElementById("newConversationBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyListEl = document.getElementById("historyList");
const statusEl = document.getElementById("status");
const timeoutInfoEl = document.getElementById("timeoutInfo");
const player = document.getElementById("player");
const audioPlayBtn = document.getElementById("audioPlayBtn");
const audioSeekEl = document.getElementById("audioSeek");
const audioTimeEl = document.getElementById("audioTime");
const analysisEl = document.getElementById("analysis");
const conversationTitleEl = document.getElementById("conversationTitle");
const conversationBadgeEl = document.getElementById("conversationBadge");
const inputDialogEl = document.getElementById("inputDialog");
const dialogTitleEl = document.getElementById("dialogTitle");
const dialogMessageEl = document.getElementById("dialogMessage");
const dialogInputEl = document.getElementById("dialogInput");
const dialogErrorEl = document.getElementById("dialogError");
const dialogCancelBtn = document.getElementById("dialogCancelBtn");
const dialogConfirmBtn = document.getElementById("dialogConfirmBtn");
const envConsoleBtn = document.getElementById("envConsoleBtn");
const envConsoleModalEl = document.getElementById("envConsoleModal");
const envConsoleFormEl = document.getElementById("envConsoleForm");
const consoleCloseBtn = document.getElementById("consoleCloseBtn");
const consoleCancelBtn = document.getElementById("consoleCancelBtn");
const consoleSaveBtn = document.getElementById("consoleSaveBtn");
const consoleApiModeEl = document.getElementById("consoleApiMode");
const consoleRelayBaseUrlEl = document.getElementById("consoleRelayBaseUrl");
const consoleRelayApiKeyEl = document.getElementById("consoleRelayApiKey");
const consoleRelayKeyHintEl = document.getElementById("consoleRelayKeyHint");
const consoleClearRelayApiKeyEl = document.getElementById("consoleClearRelayApiKey");
const consoleOpenaiBaseUrlEl = document.getElementById("consoleOpenaiBaseUrl");
const consoleOpenaiApiKeyEl = document.getElementById("consoleOpenaiApiKey");
const consoleOpenaiKeyHintEl = document.getElementById("consoleOpenaiKeyHint");
const consoleClearOpenaiApiKeyEl = document.getElementById("consoleClearOpenaiApiKey");
const consoleAnalyzeModelEl = document.getElementById("consoleAnalyzeModel");
const consoleTtsModelEl = document.getElementById("consoleTtsModel");
const consoleTimeoutMsEl = document.getElementById("consoleTimeoutMs");
const consoleStatusEl = document.getElementById("consoleStatus");
const requestLoaderEls = {
  analyze: {
    root: document.getElementById("analyzeRequestLoader"),
    title: document.getElementById("analyzeRequestLoaderTitle"),
    countdown: document.getElementById("analyzeRequestLoaderCountdown"),
    fill: document.getElementById("analyzeRequestLoaderFill")
  },
  tts: {
    root: document.getElementById("ttsRequestLoader"),
    title: document.getElementById("ttsRequestLoaderTitle"),
    countdown: document.getElementById("ttsRequestLoaderCountdown"),
    fill: document.getElementById("ttsRequestLoaderFill")
  }
};

let activeTtsController = null;
let activeAnalyzeController = null;
let currentAudioUrl = null;
let currentAudioBlob = null;
let currentTtsRequestId = 0;
let currentAnalyzeRequestId = 0;
let currentAnalysisMarkdown = "";
let conversationHistory = [];
let activeConversationId = null;
let isDirty = false;
let isHydrating = false;
let isAudioSeeking = false;
let isEnvConsoleOpen = false;
let runtimeConfigCache = null;

const FALLBACK_REQUEST_TIMEOUT_MS = 15000;
let envRequestTimeoutMs = FALLBACK_REQUEST_TIMEOUT_MS;
let requestTimeoutMs = FALLBACK_REQUEST_TIMEOUT_MS;
const HISTORY_STORAGE_KEY = "ai_english_learning_history_v3";
const LEGACY_HISTORY_STORAGE_KEYS = [
  "ai_english_learning_history_v2",
  "ai_english_learning_history_v1"
];
const HISTORY_LIMIT = 100;
const DEFAULT_ANALYSIS_HINT = "点击“一键解析”后，这里会显示语法和重点词汇。";

const AUDIO_DB_NAME = "ai_english_learning_audio_db";
const AUDIO_STORE_NAME = "conversation_audio";
const AUDIO_DB_VERSION = 1;
let audioDbPromise = null;
let activeInputDialog = null;
const activeRequestLoaderTasks = {
  tts: null,
  analyze: null
};
let requestLoaderTimerId = null;
const requestLoaderHideTimerIds = {
  tts: null,
  analyze: null
};

function setStatus(message) {
  statusEl.textContent = message;
}

function hasActiveRequestLoaderTask() {
  return Boolean(activeRequestLoaderTasks.tts || activeRequestLoaderTasks.analyze);
}

function renderRequestLoader(taskType) {
  const refs = requestLoaderEls[taskType];
  if (!refs?.root || !refs?.title || !refs?.countdown || !refs?.fill) {
    return;
  }

  const task = activeRequestLoaderTasks[taskType];
  if (!task) {
    refs.root.classList.remove("is-open");
    if (requestLoaderHideTimerIds[taskType]) {
      window.clearTimeout(requestLoaderHideTimerIds[taskType]);
    }
    requestLoaderHideTimerIds[taskType] = window.setTimeout(() => {
      if (!activeRequestLoaderTasks[taskType]) {
        refs.root.hidden = true;
      }
    }, 180);
    return;
  }

  if (requestLoaderHideTimerIds[taskType]) {
    window.clearTimeout(requestLoaderHideTimerIds[taskType]);
    requestLoaderHideTimerIds[taskType] = null;
  }

  const now = Date.now();
  const totalMs = Math.max(1, Number(task.timeoutMs) || FALLBACK_REQUEST_TIMEOUT_MS);
  const elapsedMs = Math.max(0, Math.min(totalMs, now - task.startedAt));
  const remainingMs = Math.max(0, task.deadlineAt - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progress = Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100));

  refs.title.textContent = task.label;
  refs.countdown.textContent = `倒计时剩余 ${remainingSeconds} 秒`;
  refs.fill.style.width = `${progress.toFixed(2)}%`;

  refs.root.hidden = false;
  refs.root.classList.add("is-open");
}

function renderAllRequestLoaders() {
  renderRequestLoader("analyze");
  renderRequestLoader("tts");
}

function syncRequestLoaderTimer() {
  if (hasActiveRequestLoaderTask()) {
    if (!requestLoaderTimerId) {
      requestLoaderTimerId = window.setInterval(() => {
        renderAllRequestLoaders();
      }, 200);
    }
  } else if (requestLoaderTimerId) {
    window.clearInterval(requestLoaderTimerId);
    requestLoaderTimerId = null;
  }
}

function startRequestLoader(taskType, label, timeoutMs) {
  const now = Date.now();
  const effectiveTimeoutMs = Math.max(1000, Number(timeoutMs) || FALLBACK_REQUEST_TIMEOUT_MS);
  const taskId = `${taskType}_${now}_${Math.random().toString(36).slice(2, 8)}`;
  activeRequestLoaderTasks[taskType] = {
    id: taskId,
    label,
    timeoutMs: effectiveTimeoutMs,
    startedAt: now,
    deadlineAt: now + effectiveTimeoutMs
  };
  renderRequestLoader(taskType);
  syncRequestLoaderTimer();
  return taskId;
}

function stopRequestLoader(taskType, taskId) {
  const currentTask = activeRequestLoaderTasks[taskType];
  if (!currentTask) {
    return;
  }
  if (taskId && currentTask.id !== taskId) {
    return;
  }

  activeRequestLoaderTasks[taskType] = null;
  renderRequestLoader(taskType);
  syncRequestLoaderTimer();
}

function parseTimeoutMs(rawValue, fallbackMs) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  return Math.floor(parsed);
}

function renderTimeoutInfo() {
  if (!timeoutInfoEl) {
    return;
  }
  const sourceTag = requestTimeoutMs === envRequestTimeoutMs ? "env默认" : "临时";
  timeoutInfoEl.textContent = `请求超时：${requestTimeoutMs}ms（${sourceTag}）`;
}

function setConsoleStatus(message, isError = false) {
  if (!consoleStatusEl) {
    return;
  }
  consoleStatusEl.textContent = message;
  consoleStatusEl.classList.toggle("is-error", Boolean(isError));
}

function setSecretHint(targetEl, maskedValue, hasKey) {
  if (!targetEl) {
    return;
  }
  if (hasKey) {
    targetEl.textContent = `当前状态：已配置（${maskedValue || "***"}）`;
  } else {
    targetEl.textContent = "当前状态：未配置";
  }
}

function applyRuntimeConfig(data, { keepTemporaryTimeout = false } = {}) {
  runtimeConfigCache = data || null;
  envRequestTimeoutMs = parseTimeoutMs(data?.timeoutMs, FALLBACK_REQUEST_TIMEOUT_MS);
  if (!keepTemporaryTimeout || requestTimeoutMs === envRequestTimeoutMs) {
    requestTimeoutMs = envRequestTimeoutMs;
  }
  renderTimeoutInfo();
}

async function fetchRuntimeConfig() {
  const response = await fetch("/api/config", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("读取配置失败");
  }
  return response.json();
}

async function loadTimeoutConfig() {
  try {
    const data = await fetchRuntimeConfig();
    applyRuntimeConfig(data);
  } catch (error) {
    requestTimeoutMs = parseTimeoutMs(requestTimeoutMs, FALLBACK_REQUEST_TIMEOUT_MS);
    renderTimeoutInfo();
    setStatus(`读取 env 超时失败，已使用 ${requestTimeoutMs}ms`);
  }
}

function bindConsoleForm(config) {
  if (!config) {
    return;
  }
  if (consoleApiModeEl) {
    consoleApiModeEl.value = String(config.apiMode || "openai");
  }
  if (consoleRelayBaseUrlEl) {
    consoleRelayBaseUrlEl.value = String(config.relayBaseUrl || "");
  }
  if (consoleOpenaiBaseUrlEl) {
    consoleOpenaiBaseUrlEl.value = String(config.openaiBaseUrl || "");
  }
  if (consoleAnalyzeModelEl) {
    consoleAnalyzeModelEl.value = String(config.analyzeModel || "gpt-5-mini");
  }
  if (consoleTtsModelEl) {
    consoleTtsModelEl.value = String(config.ttsModel || "gpt-4o-mini-tts");
  }
  if (consoleTimeoutMsEl) {
    consoleTimeoutMsEl.value = String(parseTimeoutMs(config.timeoutMs, FALLBACK_REQUEST_TIMEOUT_MS));
  }
  if (consoleRelayApiKeyEl) {
    consoleRelayApiKeyEl.value = "";
  }
  if (consoleClearRelayApiKeyEl) {
    consoleClearRelayApiKeyEl.checked = false;
  }
  if (consoleOpenaiApiKeyEl) {
    consoleOpenaiApiKeyEl.value = "";
  }
  if (consoleClearOpenaiApiKeyEl) {
    consoleClearOpenaiApiKeyEl.checked = false;
  }
  setSecretHint(
    consoleOpenaiKeyHintEl,
    String(config.openaiApiKeyMasked || ""),
    Boolean(config.hasOpenAIApiKey)
  );
  setSecretHint(
    consoleRelayKeyHintEl,
    String(config.relayApiKeyMasked || ""),
    Boolean(config.hasRelayApiKey)
  );
}

function closeEnvConsole() {
  if (!envConsoleModalEl) {
    return;
  }
  isEnvConsoleOpen = false;
  envConsoleModalEl.classList.remove("is-open");
  window.setTimeout(() => {
    if (!isEnvConsoleOpen) {
      envConsoleModalEl.hidden = true;
    }
  }, 180);
}

async function openEnvConsole() {
  if (!envConsoleModalEl || !envConsoleFormEl) {
    return;
  }
  isEnvConsoleOpen = true;
  envConsoleModalEl.hidden = false;
  window.requestAnimationFrame(() => {
    envConsoleModalEl.classList.add("is-open");
  });
  setConsoleStatus("正在读取配置...");
  if (consoleSaveBtn) {
    consoleSaveBtn.disabled = true;
  }

  try {
    const response = await fetch("/api/env", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("读取 .env 失败");
    }
    const data = await response.json();
    bindConsoleForm(data);
    applyRuntimeConfig(data, { keepTemporaryTimeout: true });
    setConsoleStatus("已加载当前配置");
  } catch (error) {
    setConsoleStatus(`读取失败：${error.message}`, true);
  } finally {
    if (consoleSaveBtn) {
      consoleSaveBtn.disabled = false;
    }
  }
}

function getEnvConsolePayload() {
  return {
    apiMode: String(consoleApiModeEl?.value || "openai").trim(),
    relayBaseUrl: String(consoleRelayBaseUrlEl?.value || "").trim(),
    relayApiKey: String(consoleRelayApiKeyEl?.value || "").trim(),
    openaiBaseUrl: String(consoleOpenaiBaseUrlEl?.value || "").trim(),
    openaiApiKey: String(consoleOpenaiApiKeyEl?.value || "").trim(),
    clearOpenaiApiKey: Boolean(consoleClearOpenaiApiKeyEl?.checked),
    analyzeModel: String(consoleAnalyzeModelEl?.value || "").trim(),
    ttsModel: String(consoleTtsModelEl?.value || "").trim(),
    timeoutMs: String(consoleTimeoutMsEl?.value || "").trim(),
    clearRelayApiKey: Boolean(consoleClearRelayApiKeyEl?.checked)
  };
}

function validateEnvConsolePayload(payload) {
  if (!payload.timeoutMs || !Number.isFinite(Number(payload.timeoutMs)) || Number(payload.timeoutMs) <= 0) {
    return "超时必须是大于 0 的毫秒值";
  }
  if (!payload.analyzeModel) {
    return "ANALYZE_MODEL 不能为空";
  }
  if (!payload.ttsModel) {
    return "TTS_MODEL 不能为空";
  }
  if (payload.apiMode === "relay" && !payload.relayBaseUrl) {
    return "relay 模式必须填写中转地址";
  }
  return "";
}

async function saveEnvConfigFromConsole() {
  const payload = getEnvConsolePayload();
  const validationError = validateEnvConsolePayload(payload);
  if (validationError) {
    setConsoleStatus(validationError, true);
    return;
  }

  if (consoleSaveBtn) {
    consoleSaveBtn.disabled = true;
  }
  setConsoleStatus("正在保存并应用...");

  try {
    const response = await fetch("/api/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "保存失败");
    }

    const data = await response.json();
    bindConsoleForm(data?.config || runtimeConfigCache || {});
    applyRuntimeConfig(data?.config || null);
    setConsoleStatus("保存成功，配置已即时生效");
    setStatus("系统控制台配置已更新");
  } catch (error) {
    setConsoleStatus(`保存失败：${error.message}`, true);
  } finally {
    if (consoleSaveBtn) {
      consoleSaveBtn.disabled = false;
    }
  }
}

function closeInputDialog({ confirmed = false } = {}) {
  if (!activeInputDialog) {
    return;
  }

  const { resolve } = activeInputDialog;
  const value = dialogInputEl ? String(dialogInputEl.value || "") : "";
  activeInputDialog = null;

  if (inputDialogEl) {
    inputDialogEl.classList.remove("is-open");
    window.setTimeout(() => {
      if (!inputDialogEl.classList.contains("is-open")) {
        inputDialogEl.hidden = true;
      }
    }, 180);
  }

  if (dialogErrorEl) {
    dialogErrorEl.textContent = "";
  }

  resolve({ confirmed, value });
}

function submitInputDialog() {
  if (!activeInputDialog || !dialogInputEl) {
    return;
  }

  const rawValue = String(dialogInputEl.value || "");
  const validate = activeInputDialog.validate;
  const errorMessage = typeof validate === "function" ? String(validate(rawValue) || "") : "";

  if (errorMessage) {
    if (dialogErrorEl) {
      dialogErrorEl.textContent = errorMessage;
    }
    dialogInputEl.focus();
    return;
  }

  closeInputDialog({ confirmed: true });
}

function openInputDialog(options = {}) {
  if (
    !inputDialogEl ||
    !dialogTitleEl ||
    !dialogMessageEl ||
    !dialogInputEl ||
    !dialogErrorEl ||
    !dialogCancelBtn ||
    !dialogConfirmBtn
  ) {
    return Promise.resolve({ confirmed: false, value: "" });
  }

  if (activeInputDialog) {
    closeInputDialog({ confirmed: false });
  }

  const config = {
    title: String(options.title || "请输入"),
    message: String(options.message || ""),
    value: String(options.value || ""),
    placeholder: String(options.placeholder || ""),
    confirmText: String(options.confirmText || "确定"),
    cancelText: String(options.cancelText || "取消"),
    inputType: String(options.inputType || "text"),
    validate: options.validate
  };

  dialogTitleEl.textContent = config.title;
  dialogMessageEl.textContent = config.message;
  dialogInputEl.type = config.inputType;
  dialogInputEl.value = config.value;
  dialogInputEl.placeholder = config.placeholder;
  dialogErrorEl.textContent = "";
  dialogCancelBtn.textContent = config.cancelText;
  dialogConfirmBtn.textContent = config.confirmText;

  inputDialogEl.hidden = false;
  window.requestAnimationFrame(() => {
    inputDialogEl.classList.add("is-open");
    dialogInputEl.focus();
    dialogInputEl.select();
  });

  return new Promise((resolve) => {
    activeInputDialog = {
      resolve,
      validate: config.validate
    };
  });
}

async function updateTimeoutFromDialog() {
  const { confirmed, value } = await openInputDialog({
    title: "设置请求超时",
    message: `当前为 ${requestTimeoutMs}ms。留空可恢复 env 默认值（${envRequestTimeoutMs}ms）。`,
    value: String(requestTimeoutMs),
    placeholder: "例如 30000",
    inputType: "number",
    confirmText: "应用",
    validate: (rawInput) => {
      const normalized = String(rawInput || "").trim();
      if (!normalized) {
        return "";
      }
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return "请输入大于 0 的毫秒值";
      }
      return "";
    }
  });

  if (!confirmed) {
    return;
  }

  const normalized = String(value || "").trim();
  if (!normalized) {
    requestTimeoutMs = envRequestTimeoutMs;
    renderTimeoutInfo();
    setStatus(`已恢复 env 默认超时：${requestTimeoutMs}ms`);
    return;
  }

  requestTimeoutMs = Math.floor(Number(normalized));
  renderTimeoutInfo();
  setStatus(`已临时设置请求超时：${requestTimeoutMs}ms`);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanupAudioUrl() {
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}

function formatAudioTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function setAudioControlEnabled(enabled) {
  if (audioPlayBtn) {
    audioPlayBtn.disabled = !enabled;
    if (!enabled) {
      audioPlayBtn.textContent = "▶";
      audioPlayBtn.setAttribute("aria-label", "播放");
    }
  }
  if (audioSeekEl) {
    audioSeekEl.disabled = !enabled;
    if (!enabled) {
      audioSeekEl.max = "1000";
      audioSeekEl.value = "0";
    }
  }
  if (audioTimeEl && !enabled) {
    audioTimeEl.textContent = "00:00 / 00:00";
  }
}

function syncAudioControlState() {
  if (!player || !audioTimeEl) {
    return;
  }

  const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
  const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;

  if (audioSeekEl) {
    if (duration > 0) {
      audioSeekEl.max = String(Math.floor(duration * 1000));
      if (!isAudioSeeking) {
        audioSeekEl.value = String(Math.floor(Math.min(currentTime, duration) * 1000));
      }
    } else {
      audioSeekEl.max = "1000";
      if (!isAudioSeeking) {
        audioSeekEl.value = "0";
      }
    }
  }

  if (audioPlayBtn) {
    const isPaused = player.paused;
    audioPlayBtn.textContent = isPaused ? "▶" : "⏸";
    audioPlayBtn.setAttribute("aria-label", isPaused ? "播放" : "暂停");
  }
  audioTimeEl.textContent = `${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`;
}

function clearAudioPlayer() {
  player.pause();
  cleanupAudioUrl();
  player.removeAttribute("src");
  player.load();
  setAudioControlEnabled(false);
  syncAudioControlState();
}

function renderInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return html;
}

function markdownToHtml(markdown) {
  const source = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!source) {
    return `<p>${escapeHtml(DEFAULT_ANALYSIS_HINT)}</p>`;
  }

  const codeBlocks = [];
  const withCodePlaceholders = source.replace(
    /```([\w-]*)\n([\s\S]*?)```/g,
    (_, lang, code) => {
      const index =
        codeBlocks.push({
          lang: escapeHtml(lang || ""),
          code: escapeHtml(String(code).trimEnd())
        }) - 1;
      return `@@CODE_BLOCK_${index}@@`;
    }
  );

  const lines = withCodePlaceholders.split("\n");
  const htmlParts = [];
  let inList = false;

  function closeList() {
    if (inList) {
      htmlParts.push("</ul>");
      inList = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeList();
      continue;
    }

    if (/^@@CODE_BLOCK_\d+@@$/.test(line)) {
      closeList();
      htmlParts.push(line);
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      htmlParts.push(`<h3>${renderInlineMarkdown(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      htmlParts.push(`<h2>${renderInlineMarkdown(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      htmlParts.push(`<h1>${renderInlineMarkdown(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      htmlParts.push(`<li>${renderInlineMarkdown(line.slice(2))}</li>`);
      continue;
    }

    closeList();
    htmlParts.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();

  return htmlParts
    .join("\n")
    .replace(/@@CODE_BLOCK_(\d+)@@/g, (_, indexText) => {
      const item = codeBlocks[Number(indexText)];
      if (!item) {
        return "";
      }
      const className = item.lang ? ` class="language-${item.lang}"` : "";
      return `<pre><code${className}>${item.code}</code></pre>`;
    });
}

function openAudioDb() {
  if (audioDbPromise) {
    return audioDbPromise;
  }
  audioDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        db.createObjectStore(AUDIO_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("open indexedDB failed"));
  });
  return audioDbPromise;
}

async function putAudioBlob(id, blob) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
    tx.objectStore(AUDIO_STORE_NAME).put({
      id,
      blob,
      updatedAt: Date.now()
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("write audio failed"));
  });
}

async function getAudioBlob(id) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readonly");
    const req = tx.objectStore(AUDIO_STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => reject(req.error || new Error("read audio failed"));
  });
}

async function deleteAudioBlob(id) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
    tx.objectStore(AUDIO_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("delete audio failed"));
  });
}

async function clearAudioStore() {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
    tx.objectStore(AUDIO_STORE_NAME).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("clear audio failed"));
  });
}

function getCurrentState() {
  return {
    text: String(textInput.value || ""),
    voice: String(voiceSelect.value || "alloy"),
    analysisMarkdown: String(currentAnalysisMarkdown || ""),
    hasAudio: Boolean(currentAudioBlob)
  };
}

function hasContent(state) {
  return Boolean(
    String(state.text || "").trim() ||
      String(state.analysisMarkdown || "").trim() ||
      state.hasAudio
  );
}

function normalizeOneLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdownForPreview(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getNextDefaultTitle() {
  const maxIndex = conversationHistory.reduce((max, item) => {
    const match = String(item?.title || "").match(/^历史对话(\d+)$/);
    if (!match) {
      return max;
    }
    const index = Number(match[1]);
    return Number.isFinite(index) ? Math.max(max, index) : max;
  }, 0);
  return `历史对话${maxIndex + 1}`;
}

function buildPreview(text, markdown) {
  const rawSource = markdown || text;
  const source = normalizeOneLine(stripMarkdownForPreview(rawSource));
  if (!source) {
    return "无内容";
  }
  return source.length > 50 ? `${source.slice(0, 50)}...` : source;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function loadHistory() {
  try {
    const raw =
      localStorage.getItem(HISTORY_STORAGE_KEY) ||
      LEGACY_HISTORY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && item.id)
      .map((item) => {
        const normalized = {
          id: String(item.id),
          createdAt: String(item.createdAt || new Date().toISOString()),
          updatedAt: String(item.updatedAt || new Date().toISOString()),
          title: String(item.title || "未命名对话"),
          customTitle: Boolean(item.customTitle),
          text: String(item.text || ""),
          voice: String(item.voice || "alloy"),
          analysisMarkdown: String(item.analysisMarkdown || ""),
          hasAudio: Boolean(item.hasAudio || item.audioDataUrl),
          legacyAudioDataUrl:
            typeof item.audioDataUrl === "string" ? String(item.audioDataUrl) : ""
        };
        normalized.preview = buildPreview(normalized.text, normalized.analysisMarkdown || item.preview);
        return normalized;
      });
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(conversationHistory));
    LEGACY_HISTORY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    return true;
  } catch {
    return false;
  }
}

function sortHistory() {
  conversationHistory.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function findActiveConversation() {
  return conversationHistory.find((item) => item.id === activeConversationId) || null;
}

function updateSessionMeta() {
  const state = getCurrentState();
  const active = findActiveConversation();

  if (active) {
    conversationTitleEl.textContent = active.title || "未命名对话";
    if (isDirty) {
      conversationBadgeEl.textContent = "已修改，待保存";
      saveConversationBtn.textContent = "更新会话";
    } else {
      conversationBadgeEl.textContent = "历史会话";
      saveConversationBtn.textContent = "更新会话";
    }
  } else {
    conversationTitleEl.textContent = "新对话草稿";
    if (hasContent(state)) {
      conversationBadgeEl.textContent = "草稿未保存";
      saveConversationBtn.textContent = "保存到历史";
    } else {
      conversationBadgeEl.textContent = "空白草稿";
      saveConversationBtn.textContent = "保存到历史";
    }
  }
}

function renderHistoryList() {
  if (!conversationHistory.length) {
    historyListEl.innerHTML = '<p class="history-empty">暂无历史会话</p>';
    return;
  }

  historyListEl.innerHTML = conversationHistory
    .map((item) => {
      const isActive = item.id === activeConversationId;
      const title = escapeHtml(item.title || "未命名对话");
      const preview = escapeHtml(item.preview || "无内容");
      const time = escapeHtml(formatTime(item.updatedAt));
      const activeClass = isActive ? " is-active" : "";
      const audioMark = item.hasAudio || item.legacyAudioDataUrl ? " | 含音频" : "";
      return `<article class="history-item${activeClass}">
        <button type="button" class="history-main" data-action="open" data-id="${escapeHtml(
          item.id
        )}">
          <span class="history-title">${title}</span>
          <span class="history-preview">${preview}${audioMark}</span>
          <span class="history-time">更新于 ${time}</span>
        </button>
        <div class="history-tools">
          <button type="button" class="tool-btn" data-action="rename" data-id="${escapeHtml(
            item.id
          )}">改名</button>
          <button type="button" class="tool-btn delete" data-action="delete" data-id="${escapeHtml(
            item.id
          )}">删除</button>
        </div>
      </article>`;
    })
    .join("");
}

function setAnalysisMarkdown(markdown) {
  currentAnalysisMarkdown = String(markdown || "").trim();
  analysisEl.innerHTML = markdownToHtml(currentAnalysisMarkdown);
  if (!currentAnalysisMarkdown) {
    analysisEl.classList.add("empty");
  } else {
    analysisEl.classList.remove("empty");
  }
}

async function hydrateFromRecord(record) {
  isHydrating = true;
  textInput.value = String(record.text || "");
  if (
    record.voice &&
    Array.from(voiceSelect.options).some((option) => option.value === record.voice)
  ) {
    voiceSelect.value = record.voice;
  }
  setAnalysisMarkdown(String(record.analysisMarkdown || ""));
  clearAudioPlayer();
  currentAudioBlob = null;
  isHydrating = false;

  if (record.hasAudio) {
    try {
      const blob = await getAudioBlob(record.id);
      if (blob) {
        currentAudioBlob = blob;
        cleanupAudioUrl();
        currentAudioUrl = URL.createObjectURL(blob);
        player.src = currentAudioUrl;
        setAudioControlEnabled(true);
        syncAudioControlState();
      } else {
        if (record.legacyAudioDataUrl) {
          player.src = record.legacyAudioDataUrl;
          setAudioControlEnabled(true);
          syncAudioControlState();
          try {
            const fetched = await fetch(record.legacyAudioDataUrl);
            const migratedBlob = await fetched.blob();
            currentAudioBlob = migratedBlob;
            await putAudioBlob(record.id, migratedBlob);
            record.hasAudio = true;
            record.legacyAudioDataUrl = "";
            saveHistory();
            renderHistoryList();
          } catch {
            setStatus("已加载旧版历史音频，但迁移失败");
          }
        } else {
          record.hasAudio = false;
          saveHistory();
          renderHistoryList();
          setStatus("该历史会话的音频不存在，请重新生成");
        }
      }
    } catch {
      if (record.legacyAudioDataUrl) {
        player.src = record.legacyAudioDataUrl;
        setAudioControlEnabled(true);
        syncAudioControlState();
      } else {
        record.hasAudio = false;
        saveHistory();
        renderHistoryList();
        setStatus("加载历史音频失败，请重新生成");
      }
    }
  }
}

function clearComposer() {
  isHydrating = true;
  textInput.value = "";
  setAnalysisMarkdown("");
  currentAudioBlob = null;
  isHydrating = false;
  clearAudioPlayer();
}

function markDirty() {
  if (isHydrating) {
    return;
  }
  isDirty = true;
  updateSessionMeta();
  renderHistoryList();
}

function buildRecordFromState(state, existingRecord = null) {
  const now = new Date().toISOString();
  const record = existingRecord
    ? { ...existingRecord }
    : {
        id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        customTitle: false,
        title: getNextDefaultTitle()
      };

  if (!record.title) {
    record.title = getNextDefaultTitle();
  }

  record.preview = buildPreview(state.text, state.analysisMarkdown);
  record.text = state.text;
  record.voice = state.voice;
  record.analysisMarkdown = state.analysisMarkdown;
  record.hasAudio = state.hasAudio;
  record.legacyAudioDataUrl = "";
  record.updatedAt = now;
  return record;
}

async function saveCurrentConversation({ silent = false } = {}) {
  const state = getCurrentState();

  if (!hasContent(state)) {
    if (!silent) {
      setStatus("当前没有可保存内容");
    }
    return false;
  }

  const active = findActiveConversation();
  const record = buildRecordFromState(state, active);

  if (active) {
    conversationHistory = conversationHistory.map((item) =>
      item.id === active.id ? record : item
    );
  } else {
    conversationHistory.unshift(record);
    activeConversationId = record.id;
  }

  if (conversationHistory.length > HISTORY_LIMIT) {
    const toDrop = conversationHistory.slice(HISTORY_LIMIT);
    conversationHistory = conversationHistory.slice(0, HISTORY_LIMIT);
    await Promise.all(
      toDrop
        .filter((item) => item.hasAudio)
        .map((item) => deleteAudioBlob(item.id).catch(() => false))
    );
  }

  if (currentAudioBlob) {
    try {
      await putAudioBlob(record.id, currentAudioBlob);
      record.hasAudio = true;
    } catch {
      record.hasAudio = false;
      if (!silent) {
        setStatus("文本已保存，但音频保存失败（本地存储限制）");
      }
    }
  } else {
    record.hasAudio = false;
    await deleteAudioBlob(record.id).catch(() => false);
  }

  conversationHistory = conversationHistory.map((item) =>
    item.id === record.id ? record : item
  );

  sortHistory();
  const saved = saveHistory();
  if (!saved) {
    if (!silent) {
      setStatus("保存失败：本地存储空间不足");
    }
    return false;
  }

  isDirty = false;
  renderHistoryList();
  updateSessionMeta();
  if (!silent) {
    setStatus(record.hasAudio ? "当前对话已保存（含音频）" : "当前对话已保存");
  }
  return true;
}

async function startNewConversation() {
  const state = getCurrentState();
  if (isDirty && hasContent(state)) {
    await saveCurrentConversation({ silent: true });
  }

  activeConversationId = null;
  isDirty = false;
  clearComposer();
  renderHistoryList();
  updateSessionMeta();
  setStatus("已新建对话，当前为草稿");
}

async function openConversation(id) {
  if (!id || id === activeConversationId) {
    return;
  }

  const state = getCurrentState();
  if (isDirty && hasContent(state)) {
    const shouldSave = window.confirm("当前内容有修改，是否先保存后再切换？");
    if (shouldSave) {
      await saveCurrentConversation({ silent: true });
    }
  }

  const record = conversationHistory.find((item) => item.id === id);
  if (!record) {
    return;
  }

  activeConversationId = id;
  isDirty = false;
  await hydrateFromRecord(record);
  renderHistoryList();
  updateSessionMeta();
  setStatus("已切换到历史会话");
}

async function renameConversation(id) {
  const record = conversationHistory.find((item) => item.id === id);
  if (!record) {
    return;
  }

  const { confirmed, value } = await openInputDialog({
    title: "修改会话名称",
    message: "请输入新的会话名称。",
    value: String(record.title || ""),
    placeholder: "例如：过去完成时练习",
    confirmText: "保存",
    validate: (rawInput) => {
      const normalized = String(rawInput || "").trim();
      if (!normalized) {
        return "会话名称不能为空";
      }
      return "";
    }
  });

  if (!confirmed) {
    return;
  }

  const normalized = String(value || "").trim();

  record.title = normalized;
  record.customTitle = true;
  record.updatedAt = new Date().toISOString();
  sortHistory();
  saveHistory();
  renderHistoryList();
  updateSessionMeta();
  setStatus("会话名称已更新");
}

async function deleteConversation(id) {
  const record = conversationHistory.find((item) => item.id === id);
  if (!record) {
    return;
  }

  const confirmed = window.confirm(`确定删除会话「${record.title}」吗？`);
  if (!confirmed) {
    return;
  }

  conversationHistory = conversationHistory.filter((item) => item.id !== id);
  if (record.hasAudio) {
    await deleteAudioBlob(id).catch(() => false);
  }
  if (activeConversationId === id) {
    activeConversationId = null;
    isDirty = false;
    clearComposer();
  }

  saveHistory();
  renderHistoryList();
  updateSessionMeta();
  setStatus("会话已删除");
}

async function clearAllHistory() {
  if (!conversationHistory.length) {
    setStatus("暂无可删除的历史记录");
    return;
  }

  const confirmed = window.confirm("确定删除全部历史记录吗？此操作不可恢复。");
  if (!confirmed) {
    return;
  }

  conversationHistory = [];
  activeConversationId = null;
  isDirty = false;
  currentAudioBlob = null;
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  LEGACY_HISTORY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  await clearAudioStore().catch(() => false);
  clearComposer();
  renderHistoryList();
  updateSessionMeta();
  setStatus("全部历史记录已删除");
}

async function generateTTS() {
  const text = textInput.value.trim();
  const voice = voiceSelect.value;

  if (!text) {
    setStatus("请先输入英文文本");
    return;
  }

  if (activeTtsController) {
    activeTtsController.abort();
  }
  const controller = new AbortController();
  activeTtsController = controller;
  const requestId = ++currentTtsRequestId;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  const requestLoaderTaskId = startRequestLoader(
    "tts",
    "正在生成语音中...",
    requestTimeoutMs
  );

  setStatus("语音生成中...");
  generateBtn.disabled = true;

  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal: controller.signal
    });

    if (requestId !== currentTtsRequestId) {
      return;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "请求失败");
    }

    const audioBlob = await response.blob();
    cleanupAudioUrl();
    currentAudioUrl = URL.createObjectURL(audioBlob);
    player.src = currentAudioUrl;
    setAudioControlEnabled(true);
    syncAudioControlState();
    currentAudioBlob = audioBlob;
    isDirty = true;
    renderHistoryList();
    updateSessionMeta();
    await player.play().catch(() => {});
    setStatus("语音已完成");
  } catch (error) {
    if (requestId !== currentTtsRequestId) {
      return;
    }

    if (error.name === "AbortError") {
      setStatus(
        timedOut ? "错误：请求超时。请检查服务日志、API Key 或网络。" : "请求已取消"
      );
    } else {
      setStatus(`错误：${error.message}`);
    }
  } finally {
    stopRequestLoader("tts", requestLoaderTaskId);
    clearTimeout(timeoutId);
    if (requestId === currentTtsRequestId) {
      generateBtn.disabled = false;
      if (activeTtsController === controller) {
        activeTtsController = null;
      }
    }
  }
}

async function analyzeText() {
  const text = textInput.value.trim();
  if (!text) {
    setStatus("请先输入英文文本");
    return;
  }

  if (activeAnalyzeController) {
    activeAnalyzeController.abort();
  }
  const controller = new AbortController();
  activeAnalyzeController = controller;
  const requestId = ++currentAnalyzeRequestId;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  const requestLoaderTaskId = startRequestLoader(
    "analyze",
    "正在解析文本中...",
    requestTimeoutMs
  );

  setStatus("文本解析中...");
  analyzeBtn.disabled = true;

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });

    if (requestId !== currentAnalyzeRequestId) {
      return;
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "请求失败");
    }

    const data = await response.json();
    setAnalysisMarkdown(data.markdown || "");
    isDirty = true;
    renderHistoryList();
    updateSessionMeta();
    setStatus("文本解析已完成");
  } catch (error) {
    if (requestId !== currentAnalyzeRequestId) {
      return;
    }

    if (error.name === "AbortError") {
      setStatus(
        timedOut ? "错误：解析请求超时。请检查服务日志、API Key 或网络。" : "解析请求已取消"
      );
    } else {
      setStatus(`错误：${error.message}`);
    }
  } finally {
    stopRequestLoader("analyze", requestLoaderTaskId);
    clearTimeout(timeoutId);
    if (requestId === currentAnalyzeRequestId) {
      analyzeBtn.disabled = false;
      if (activeAnalyzeController === controller) {
        activeAnalyzeController = null;
      }
    }
  }
}

if (player) {
  player.addEventListener("loadedmetadata", () => {
    setAudioControlEnabled(true);
    syncAudioControlState();
  });

  player.addEventListener("timeupdate", () => {
    syncAudioControlState();
  });

  player.addEventListener("play", () => {
    syncAudioControlState();
  });

  player.addEventListener("pause", () => {
    syncAudioControlState();
  });

  player.addEventListener("ended", () => {
    syncAudioControlState();
  });

  player.addEventListener("emptied", () => {
    setAudioControlEnabled(false);
    syncAudioControlState();
  });
}

if (audioPlayBtn) {
  audioPlayBtn.addEventListener("click", async () => {
    if (!player || audioPlayBtn.disabled) {
      return;
    }
    if (player.paused) {
      await player.play().catch(() => {});
    } else {
      player.pause();
    }
    syncAudioControlState();
  });
}

if (audioSeekEl) {
  audioSeekEl.addEventListener("input", () => {
    if (!player || audioSeekEl.disabled) {
      return;
    }
    isAudioSeeking = true;
    const maxValue = Number(audioSeekEl.max) || 0;
    const nextValue = Number(audioSeekEl.value) || 0;
    if (maxValue > 0) {
      player.currentTime = Math.max(0, Math.min(maxValue, nextValue)) / 1000;
    }
    syncAudioControlState();
  });

  audioSeekEl.addEventListener("change", () => {
    isAudioSeeking = false;
    syncAudioControlState();
  });
}

setAudioControlEnabled(false);
syncAudioControlState();

generateBtn.addEventListener("click", () => {
  generateTTS();
});

analyzeBtn.addEventListener("click", () => {
  analyzeText();
});

if (inputDialogEl && dialogInputEl && dialogCancelBtn && dialogConfirmBtn) {
  dialogCancelBtn.addEventListener("click", () => {
    closeInputDialog({ confirmed: false });
  });

  dialogConfirmBtn.addEventListener("click", () => {
    submitInputDialog();
  });

  dialogInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitInputDialog();
    }
  });

  dialogInputEl.addEventListener("input", () => {
    if (dialogErrorEl) {
      dialogErrorEl.textContent = "";
    }
  });

  inputDialogEl.addEventListener("click", (event) => {
    if (event.target === inputDialogEl) {
      closeInputDialog({ confirmed: false });
    }
  });
}

if (timeoutBtn) {
  timeoutBtn.addEventListener("click", () => {
    void updateTimeoutFromDialog();
  });
}

if (envConsoleBtn) {
  envConsoleBtn.addEventListener("click", () => {
    void openEnvConsole();
  });
}

if (consoleCloseBtn) {
  consoleCloseBtn.addEventListener("click", () => {
    closeEnvConsole();
  });
}

if (consoleCancelBtn) {
  consoleCancelBtn.addEventListener("click", () => {
    closeEnvConsole();
  });
}

if (envConsoleFormEl) {
  envConsoleFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveEnvConfigFromConsole();
  });
}

if (envConsoleModalEl) {
  envConsoleModalEl.addEventListener("click", (event) => {
    if (event.target === envConsoleModalEl) {
      closeEnvConsole();
    }
  });
}

if (consoleClearRelayApiKeyEl && consoleRelayApiKeyEl) {
  consoleClearRelayApiKeyEl.addEventListener("change", () => {
    if (consoleClearRelayApiKeyEl.checked) {
      consoleRelayApiKeyEl.value = "";
    }
  });
  consoleRelayApiKeyEl.addEventListener("input", () => {
    if (consoleRelayApiKeyEl.value.trim()) {
      consoleClearRelayApiKeyEl.checked = false;
    }
  });
}

if (consoleClearOpenaiApiKeyEl && consoleOpenaiApiKeyEl) {
  consoleClearOpenaiApiKeyEl.addEventListener("change", () => {
    if (consoleClearOpenaiApiKeyEl.checked) {
      consoleOpenaiApiKeyEl.value = "";
    }
  });
  consoleOpenaiApiKeyEl.addEventListener("input", () => {
    if (consoleOpenaiApiKeyEl.value.trim()) {
      consoleClearOpenaiApiKeyEl.checked = false;
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  if (activeInputDialog) {
    event.preventDefault();
    closeInputDialog({ confirmed: false });
    return;
  }
  if (isEnvConsoleOpen) {
    event.preventDefault();
    closeEnvConsole();
  }
});

saveConversationBtn.addEventListener("click", async () => {
  await saveCurrentConversation();
});

newConversationBtn.addEventListener("click", async () => {
  await startNewConversation();
});

clearHistoryBtn.addEventListener("click", async () => {
  await clearAllHistory();
});

historyListEl.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action][data-id]");
  if (!target) {
    return;
  }
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!id) {
    return;
  }
  if (action === "open") {
    await openConversation(id);
  } else if (action === "rename") {
    await renameConversation(id);
  } else if (action === "delete") {
    await deleteConversation(id);
  }
});

textInput.addEventListener("input", () => {
  markDirty();
});

voiceSelect.addEventListener("change", () => {
  markDirty();
});

conversationHistory = loadHistory();
sortHistory();
renderHistoryList();
setAnalysisMarkdown("");
updateSessionMeta();
renderTimeoutInfo();
void loadTimeoutConfig();

window.addEventListener("beforeunload", () => {
  clearAudioPlayer();
  if (requestLoaderTimerId) {
    window.clearInterval(requestLoaderTimerId);
  }
  Object.values(requestLoaderHideTimerIds).forEach((timerId) => {
    if (timerId) {
      window.clearTimeout(timerId);
    }
  });
  if (activeTtsController) {
    activeTtsController.abort();
  }
  if (activeAnalyzeController) {
    activeAnalyzeController.abort();
  }
});
