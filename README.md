# AI英语学习软件

一个简单的英语学习 Web App：
- 输入英文文本后可生成 TTS 语音朗读。
- 点击“一键解析”可让 ChatGPT 输出语法解析和重点词汇（Markdown 格式）。
- 提供会话侧栏：支持手动保存、切换、重命名、单条删除和全部删除历史记录。

## 1. 安装依赖

```bash
npm install
```

## 2. 配置环境变量

在 `.env` 中设置：

```bash
OPENAI_API_KEY=your_real_key
PORT=3000
OPENAI_TIMEOUT_MS=15000
API_MODE=openai
OPENAI_BASE_URL=
RELAY_BASE_URL=
RELAY_API_KEY=
ANALYZE_MODEL=gpt-5-mini
TTS_MODEL=gpt-4o-mini-tts
```

- `OPENAI_TIMEOUT_MS`：统一的请求超时（毫秒），同时用于 `/api/tts` 和 `/api/analyze`。
- 页面中的“超时设置”按钮会默认读取此值，并支持本次页面会话内临时覆盖；刷新页面后会恢复为 env 默认值。
- `API_MODE`：`openai`（直连）或 `relay`（中转）。
- `RELAY_BASE_URL` + `RELAY_API_KEY`：启用中转模式时使用。
- 页面右上角“系统控制台”支持可视化编辑上述 `.env` 配置，保存后会即时生效（无需重启服务）。

## 3. 启动

```bash
npm start
```

打开 `http://localhost:3000`。

## API

- `POST /api/tts`
  - 请求体：`{ "text": "...", "voice": "alloy" }`
  - 返回：`mp3` 音频流

- `POST /api/analyze`
  - 请求体：`{ "text": "..." }`
  - 返回：`{ "markdown": "..." }`

- `GET /api/env`
  - 返回当前运行配置（敏感值会脱敏）

- `POST /api/env`
  - 请求体示例：
    ```json
    {
      "apiMode": "relay",
      "relayBaseUrl": "https://your-relay-host/v1",
      "relayApiKey": "sk-xxx",
      "clearRelayApiKey": false,
      "openaiBaseUrl": "",
      "openaiApiKey": "",
      "clearOpenaiApiKey": false,
      "analyzeModel": "gpt-5-mini",
      "ttsModel": "gpt-4o-mini-tts",
      "timeoutMs": "15000"
    }
    ```
  - 作用：写入 `.env` 并立即生效

## 自定义提示词

- 解析接口提示词在项目根目录：`prompt.md`
- 你可以直接修改 `prompt.md` 内容，下一次点击“一键解析”会自动使用新提示词

## 使用模型

- TTS 默认：`gpt-4o-mini-tts`（可在控制台改 `TTS_MODEL`）
- 文本解析默认：`gpt-5-mini`（可在控制台改 `ANALYZE_MODEL`）
