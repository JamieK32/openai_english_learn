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
```

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

## 自定义提示词

- 解析接口提示词在项目根目录：`prompt.md`
- 你可以直接修改 `prompt.md` 内容，下一次点击“一键解析”会自动使用新提示词

## 使用模型

- TTS：`gpt-4o-mini-tts`
- 文本解析：`gpt-5-mini`
