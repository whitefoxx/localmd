# browser-md

**你的 AI 知识库，跑在浏览器里。** 打开网页 → 配置 LLM API key → 选择本地文件夹，即可使用。无需安装、无需后端——文件通过 File System Access API 直接读写在你的设备上，API key 只存在你的浏览器里、只发给你配置的模型服务商。

browser-md 是 [trace-app](../trace-app)（Electron 桌面版 AI 知识库）的纯浏览器重写，借鉴了 [files.md](https://files.md) 的 local-first 网页模式。两者共享同一套知识库数据格式，可以对同一个文件夹混用。

## 功能

- **Markdown 知识库**：文件树、CodeMirror 6 编辑器（自动保存）、预览、可点击的 `[[wikilinks]]`（含路径式目标）、多标签页
- **AI Agent**：右侧聊天面板驱动一个浏览器内的 agent 循环——它能列出、读取、搜索、索引、写入你打开的文件夹；支持流式输出、思维链（reasoning）折叠显示、会话历史（IndexedDB 持久化，可切换/删除）
- **变更审查**：agent 的每次写入都先快照原文件；标题栏出现 diff 徽章，逐文件查看行级 diff，Approve / Discard
- **文档索引与块级引用**：PDF/EPUB/Markdown 源解析为结构化索引（`.trace/` 下），agent 引用原文时写 `[[1:b14-3]]` token，渲染为可点击徽章——点击跳转到 PDF 的具体段落并高亮（EPUB 按 CFI 定位，Markdown 按块定位）
- **知识库工具**：⌘K 搜索（文件名 + 全文）、backlinks 面板、D3 力导向图谱、健康检查（断链/孤儿页）、拖拽文件自动归档到 `raw/`
- **文件查看器**：PDF（pdf.js 渲染）、EPUB（epub.js）、图片、代码/文本
- **PWA**：可安装、离线可用

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/，纯静态，可部署到任何支持 https 的托管
```

**浏览器要求**：Chrome / Edge（`showDirectoryPicker` 目前仅 Chromium 系支持）。生产部署需 https（File System Access API 要求 secure context）。

**LLM 配置**（右侧面板齿轮）：
- **Anthropic (Claude)**：官方 SDK 浏览器直连（`anthropic-dangerous-direct-browser-access`），agent 循环由 SDK 的 beta toolRunner 驱动
- **OpenAI-compatible**：手写的 Chat Completions 工具循环，支持自定义 Base URL。内置预设（Qwen/DeepSeek/智谱 GLM/Kimi/MiniMax/OpenAI）均已验证支持浏览器 CORS——**注意**：纯网页只能调用允许跨域的端点，自定义网关（如各类中转/企业代理）多数不支持，会报 connection error

## 架构

纯静态 Vue 3 SPA（Vite + Pinia + Tailwind），无任何服务端。所有数据流动只发生在「你的浏览器 ↔ 本地文件夹」和「你的浏览器 ↔ LLM API」之间。

```
src/
  lib/
    fs.ts            File System Access 层：KB 相对路径 → handle 遍历，
                     原子写（createWritable 提交语义），目录树读取
    idb.ts           IndexedDB：目录 handle 持久化（Recent 列表）、聊天会话
    markdown.ts      marked + wikilink 扩展 + 引用 token 渲染
    citations.ts     [[pdfN:path]] / [[N:blockid]] 引用 token 解析（trace-app 同源）
    diff.ts          LCS 行级 diff（review 面板用）
    docindex/        文档索引器（见下方 trace-app 兼容性）
      pdf/           pdf.js 提取（行分组按垂直区间重叠、CJK 感知拼接、
                     标题启发式、内嵌大纲）→ sections/toc/locations/manifest
      epub/          epub.js 提取（HTML 块即引用块，CFI 定位）
      md/            marked lexer 分块
  agent/
    tools.ts         Zod 定义的工具：list_files / read_file / write_file /
                     search_files / index_document（两个 provider 共享）
    anthropic.ts     Anthropic beta toolRunner 集成
    openai.ts        Chat Completions 手写工具循环（reasoning_content 透出）
    prompt.ts        系统提示词；KB 根目录的 CLAUDE.md 会原文附加
  stores/            Pinia：kb / files（含多标签页）/ chat（会话持久化）/
                     review（写入快照与审查）/ kbIndex（mtime 缓存的内容索引，
                     供搜索、backlinks、图谱、健康检查共用）/ citations / ui
  components/        布局、文件树、编辑器/预览、查看器、聊天、审查、搜索、图谱
```

**关键取舍**（相对 Electron 版）：

| trace-app（Electron） | browser-md 的替代 |
|---|---|
| 内嵌终端跑 Claude Code CLI | 浏览器内 agent 循环 + 五个文件工具 |
| git 版本管理 + diff 审查 | 写前快照 + LCS diff 审查 |
| chokidar 文件监听 | 窗口聚焦时按 mtime 重扫 |
| ripgrep 搜索 | 内存索引扫描（kbIndex store） |
| EmbedPDF 提取引擎 | pdf.js 自研提取器 |
| macOS Vision OCR | 暂缺（扫描件产出 0 块） |

## trace-app 兼容性

browser-md 与 trace-app 可交替打开同一个知识库文件夹，互认对方生成的数据：

- **KB 结构**：`raw/`（不可变源文件）+ `wiki/`（LLM 维护的页面）+ `CLAUDE.md`（KB schema，会被两个应用的 agent 同样遵循）
- **索引目录与命名**：`.trace/{pdf,epub,md}-index/<slugify(文件名)>-<fnv1a(KB相对路径)>/`，内含 `sections/*.md`（每块带 `[[b<页/章>-<序>]]` ID）、`toc.md`、`locations.json`（块 → PDF 坐标 / EPUB CFI）、`manifest.json`、`_README.md`
- **新鲜度判定**：`manifest.contentHash`（源文件 sha256）+ 格式版本号（PDF=11，EPUB=3，MD=1）。任一应用生成的索引，另一应用命中即复用、不重建。**改动索引格式必须升版本号，且会破坏互认——慎动**
- **引用 token**：`[[pdf1:raw/papers/x.pdf]]` 声明来源（数字标识**来源**而非引用序号），`[[1:b14-3]]` 内联引用。写进 wiki 的引用在两个应用里都可点击回溯
- **索引生成**：trace-app 里点 "Index for AI"；browser-md 里点查看器的同名按钮，或让 agent 自己调 `index_document` 工具

## 已知限制

- 仅 Chromium 系浏览器（Safari/Firefox 无 `showDirectoryPicker`）
- LLM 端点必须允许浏览器 CORS（预设列表均已验证）
- 扫描版 PDF（无文本层）暂无 OCR，索引产出 0 块
- 双栏排版论文的块检测比 EmbedPDF 粗糙；中文书的上标脚注号已内联处理
- API key 存 localStorage——请只在自己的设备上使用，部署版不要引入任何第三方脚本
