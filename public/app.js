const textInput = document.getElementById("text");
const voiceSelect = document.getElementById("voice");
const generateBtn = document.getElementById("generateBtn");
const analyzeBtn = document.getElementById("analyzeBtn");
const saveConversationBtn = document.getElementById("saveConversationBtn");
const newConversationBtn = document.getElementById("newConversationBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyListEl = document.getElementById("historyList");
const statusEl = document.getElementById("status");
const player = document.getElementById("player");
const analysisEl = document.getElementById("analysis");
const conversationTitleEl = document.getElementById("conversationTitle");
const conversationBadgeEl = document.getElementById("conversationBadge");

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

const TTS_TIMEOUT_MS = 20000;
const ANALYZE_TIMEOUT_MS = 30000;
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

function setStatus(message) {
  statusEl.textContent = message;
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

function clearAudioPlayer() {
  cleanupAudioUrl();
  player.removeAttribute("src");
  player.load();
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
  const source = normalizeOneLine(markdown || text);
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
          preview: String(item.preview || "无内容"),
          text: String(item.text || ""),
          voice: String(item.voice || "alloy"),
          analysisMarkdown: String(item.analysisMarkdown || ""),
          hasAudio: Boolean(item.hasAudio || item.audioDataUrl),
          legacyAudioDataUrl:
            typeof item.audioDataUrl === "string" ? String(item.audioDataUrl) : ""
        };
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
      } else {
        if (record.legacyAudioDataUrl) {
          player.src = record.legacyAudioDataUrl;
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

function renameConversation(id) {
  const record = conversationHistory.find((item) => item.id === id);
  if (!record) {
    return;
  }
  const nextTitle = window.prompt("请输入新的会话名称：", record.title || "");
  if (nextTitle === null) {
    return;
  }
  const normalized = nextTitle.trim();
  if (!normalized) {
    setStatus("会话名称不能为空");
    return;
  }

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
  }, TTS_TIMEOUT_MS);

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
  }, ANALYZE_TIMEOUT_MS);

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
    clearTimeout(timeoutId);
    if (requestId === currentAnalyzeRequestId) {
      analyzeBtn.disabled = false;
      if (activeAnalyzeController === controller) {
        activeAnalyzeController = null;
      }
    }
  }
}

generateBtn.addEventListener("click", () => {
  generateTTS();
});

analyzeBtn.addEventListener("click", () => {
  analyzeText();
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
    renameConversation(id);
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

window.addEventListener("beforeunload", () => {
  clearAudioPlayer();
  if (activeTtsController) {
    activeTtsController.abort();
  }
  if (activeAnalyzeController) {
    activeAnalyzeController.abort();
  }
});
