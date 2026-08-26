# localmd

**一个 AI 知识库，跑在你的浏览器和本地文件夹里。** 打开网页 → 选择本地文件夹 → 配置 LLM API key，即可使用。无需安装、无需后端——文件通过 File System Access API 直接读写在你的设备上，API key 只存在你的浏览器里、只发给你配置的模型服务商。

localmd 借鉴了 [files.md](https://files.md) 的 local-first 网页模式。知识库的数据格式是稳定的：已有知识库里的索引目录、标注 sidecar 和笔记里的块级引用都按它组织，格式不会因为版本升级而失效。

## 功能

- **Markdown 知识库**：文件树、CodeMirror 6 编辑器（自动保存）、预览、可点击的 `[[wikilinks]]`（含路径式目标）、多标签页
- **AI Agent**：右侧聊天面板驱动一个浏览器内的 agent 循环——它能列出、读取、搜索、索引、写入你打开的文件夹；支持流式输出、思维链（reasoning）折叠显示、会话历史（IndexedDB 持久化，可切换/删除）
- **多模型配置（能力槽位）**：底层统一走 [Vercel AI SDK](https://ai-sdk.dev)——Anthropic / OpenAI / DeepSeek / Google Gemini / xAI / Groq 等各家用**各自的 key 直连各自端点**（Base URL 与接口适配由 SDK 内置，无中转/聚合器、无需自己维护）；可配置多个 profile，按「主模型 / 视觉理解」分工——主模型跑 agent 循环，视觉槽给纯文本主模型补上看图能力（agent 通过 `view_image` 工具调用；多模态主模型则图片直接进上下文）
- **聊天附件与 @ 引用**：输入框可直接粘贴截图 / 上传 / 拖入文件——自动按类型归档进 `raw/`（截图 → `raw/images/`，PDF → `raw/papers/`，已有知识库就是按这张路由表组织的）并随消息告知 agent；输入 `@` 弹出文件补全（Claude Code 式），引用的小文本文件直接内联进消息，大文件/文档指引 agent 用工具读
- **Claude Code 式 agent 工具**：`edit_file` 精确替换（old/new string，唯一性校验）、`update_plan` 任务清单（聊天面板实时渲染进度）、`run_subagent` 子任务 agent（独立上下文跑同一套工具，只回传最终答案，深度限一层）
- **变更审查（两种模式）**：默认直接写入 + 事后审查（写前快照、行级 diff、Approve/Discard）；「先询问」模式下每次 write/edit 暂停等你批准，Reject 则完全不落盘
- **Git 集成（isomorphic-git，读写标准 .git，与终端 git 互认）**：标题栏分支 + 改动数徽章；Git 面板看逐文件 diff vs HEAD、勾选提交、查看提交历史；**GitHub 同步**走 REST Git Data API（浏览器可直连，git smart-HTTP 不给 CORS）——push/pull 均为镜像 git 对象、逐一校验 sha、fast-forward-only，冲突回终端处理。状态与提交只覆盖文本文件（.trace/ 与大二进制排除，终端提交）
- **文档索引与块级引用**：PDF/EPUB/Markdown 源解析为结构化索引（`.trace/` 下），agent 引用原文时写 `[[1:b14-3]]` token，渲染为可点击徽章——点击跳转到 PDF 的具体段落并高亮（EPUB 按 CFI 定位，Markdown 按块定位）
- **知识库工具**：⌘K 搜索（文件名 + 全文）、backlinks 面板、D3 力导向图谱、健康检查（断链/孤儿页）、拖拽文件自动归档到 `raw/`
- **文件查看器**：PDF（EmbedPDF：原生选择/高亮标注/缩放/搜索，标注写成 `<源文件>.annotations.json` sidecar）、EPUB（epub.js 分页 + 主题 + 标注 + 进度）、图片、代码/文本；PDF/EPUB 有目录面板，标签页切换保持阅读位置
- **PWA**：可安装、离线可用

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/，纯静态，可部署到任何支持 https 的托管
npm test           # 单元测试(vitest)
npm run test:e2e   # 端到端测试(Playwright,用系统 Chrome):
                   # ?e2e=1 启动内存文件系统 + mock LLM provider,
                   # 覆盖 脚手架/流式聊天/写入审查/计划卡片,无需 key 无网络
```

**浏览器要求**：Chrome / Edge（`showDirectoryPicker` 目前仅 Chromium 系支持）。生产部署需 https（File System Access API 要求 secure context）。

**LLM 配置**（右侧面板齿轮）：添加一个或多个模型 profile，再在「模型分工」里指派槽位（web-agent 的多 profile + 能力槽模式）。底层统一走 [Vercel AI SDK](https://ai-sdk.dev)——**选好 provider 后只需填 API key 和模型名**，Base URL 与接口适配由各家 `@ai-sdk/*` 包内置（升级/协议漂移由 SDK 维护，不用我们跟）：
- **内置 provider**：Anthropic (Claude) / OpenAI / DeepSeek / Google Gemini / xAI (Grok) / Groq 各有专用包（Base URL 已内置，无需填写）；Qwen / 智谱 GLM / Kimi / MiniMax 走 OpenAI-compatible 包（Base URL 由预设提供）；另有 **Custom（OpenAI-compatible）** 供任意兼容端点手填 Base URL
- **一套工具循环**：所有 provider 共用同一个 `streamText` 多步工具循环（用各家自己的 key、直连各家自己的端点，无中转/聚合器）。Anthropic 仍走浏览器直连头 `anthropic-dangerous-direct-browser-access`，并对系统提示做 prompt cache
- **CORS 仍是硬约束**：纯网页只能调用允许跨域的端点。Anthropic/OpenAI/DeepSeek/Qwen/GLM/Kimi/MiniMax 的标准端点已验证可用；Google/xAI/Groq 按 BYO-key 提供、浏览器 CORS 未逐一核验；自定义网关多数不支持，会报 connection error（聊天区给出提示）
- **视觉理解槽**：多模态主模型（Anthropic/OpenAI/Google/xAI，或 qwen-vl / glm-4v 这类把视觉槽选成自己的兼容模型）图片直接内联进上下文；纯文本主模型（如 deepseek-chat）则指一个专门的视觉模型，agent 需要看图时通过 `view_image` 工具一次性子调用它

## 架构

纯静态 Vue 3 SPA（Vite + Pinia + Tailwind），无任何服务端。所有数据流动只发生在「你的浏览器 ↔ 本地文件夹」和「你的浏览器 ↔ LLM API」之间。

```
src/
  lib/
    fs.ts            File System Access 层：KB 相对路径 → handle 遍历，
                     原子写（createWritable 提交语义），目录树读取
    idb.ts           IndexedDB：目录 handle 持久化（Recent 列表）、聊天会话
    markdown.ts      marked + wikilink 扩展 + 引用 token 渲染
    citations.ts     [[pdfN:path]] / [[N:blockid]] 引用 token 解析
    diff.ts          LCS 行级 diff（review 面板用）
    gitfs.ts         File System Access → isomorphic-git 的 fs 适配器
                     （stat 只有 size+mtime；首次 status 后 index 刷新即缓存命中）
    git.ts           status（文本文件范围）/ diff vs HEAD / commit / log
    github.ts        GitHub REST Git Data API 同步（push/pull 镜像对象、sha 校验）
    edits.ts         edit_file 的精确替换逻辑（唯一性校验）
    mentions.ts      @ 引用解析（已知路径最长匹配，支持空格/CJK 文件名）
    capture.ts       粘贴/上传/拖入 → raw/<subdir> 类型路由（已有 KB 按此组织）
    docindex/        文档索引器（见下方「格式兼容性」）
      pdf/           pdf.js 提取（行分组按垂直区间重叠、CJK 感知拼接、
                     标题启发式、内嵌大纲）→ sections/toc/locations/manifest
      epub/          epub.js 提取（HTML 块即引用块，CFI 定位）
      md/            marked lexer 分块
  agent/
    tools.ts         Zod 定义的工具：list_files / read_file / write_file /
                     search_files / index_document（所有 provider 共享）
    model.ts         profile → AI SDK LanguageModel（每 provider 一个 @ai-sdk/* 包）
    run.ts           统一的 streamText 多步工具循环（替代旧的两套手写循环；
                     view_image 多模态回图 / 视觉槽子调用；run_subagent 递归）
    vision.ts        视觉子调用（KB 图片 → base64，经 AI SDK generateText）
    prompt.ts        系统提示词；KB 根目录的 AGENTS.md/CLAUDE.md、MEMORY.md 会原文附加
  stores/            Pinia：kb / files（含多标签页）/ chat（会话持久化）/
                     review（写入快照与审查）/ kbIndex（mtime 缓存的内容索引，
                     供搜索、backlinks、图谱、健康检查共用）/ citations / ui
  components/        布局、文件树、编辑器/预览、查看器、聊天、审查、搜索、图谱
```

**关键取舍**（相对 Electron 版）：

| Electron 桌面版的做法 | localmd 的替代 |
|---|---|
| 内嵌终端跑 Claude Code CLI | 浏览器内 agent 循环 + 五个文件工具 |
| git 版本管理 + diff 审查 | 写前快照 + LCS diff 审查 |
| chokidar 文件监听 | 窗口聚焦时按 mtime 重扫 |
| git CLI 子进程 | isomorphic-git（浏览器内读写标准 .git）+ GitHub REST API 同步 |
| ripgrep 搜索 | 内存索引扫描（kbIndex store） |
| EmbedPDF 查看器 + 提取引擎 | EmbedPDF 查看器（同款）；索引提取用 pdf.js 自研提取器 |
| macOS Vision OCR | 暂缺（扫描件产出 0 块） |

## Skills（可复用工作流）

技能是存在知识库里的工作流说明书，采用开放的 SKILL.md 格式（markdown + `name`/`description` frontmatter），**规范目录为工具中立的 `.agents/skills/<name>/SKILL.md`**（同时兼容读取 `.claude/skills/`，同名时规范目录优先）：

```markdown
---
name: ingest
description: 处理 raw/ 下未入库的源文件,生成或更新 wiki 页面并链接索引
---

# 具体步骤……（正文随 use_skill 按需加载,不占常驻上下文）
```

- **渐进披露**：系统提示词只带 name+description 清单；agent 判断任务匹配时调 `use_skill` 加载全文
- **用户直接触发**：输入框敲 `/` 弹出技能补全，`/lint` 回车即强制执行；无消息时的预设按钮也来自技能列表
- **沉淀新技能**：对 agent 说「把刚才的流程存成 skill」，它会写入 `.agents/skills/`——git 版本管理、review 面板审查都天然适用
- **与终端 Claude Code 共享**：一次性 `ln -s ../.agents/skills .claude/skills`（建议把 `.claude/skills` 加进 `.gitignore`——FS Access API 会把软链接当真目录，应用内 git 会看到重复文件）
- KB 指令文件同样中立化：**AGENTS.md 优先，CLAUDE.md 兜底**（常见做法是 `CLAUDE.md` 软链接到 `AGENTS.md`）

## Memory（持久记忆）

记忆是知识库根目录下一个**固定名字**的普通 markdown 文件——`MEMORY.md`，存放要跨会话长期记住的东西：用户的稳定偏好、项目当前状态、值得留存的决策。和 skill 不同，它**不做渐进披露**——存在时**全文注入**系统提示词（放在 `<kb_memory>` 块里，和 `AGENTS.md` 的 `<kb_schema>` 并列），agent 每轮都带着它，无需再调工具加载。

- **就是一个普通文件**：在文件树里可见，用户可以像编辑任何页面一样直接改;跟 git、review 面板天然兼容
- **让 agent 记**：对 agent 说「记住我……」「把这条写进 memory」，它会用 `write_file`/`edit_file` 创建(不存在就新建)或更新 `MEMORY.md`——先读后改、条目精简、保留原有内容
- **不自动总结**：agent **不会**主动往 `MEMORY.md` 写东西,也**不会**自动把会话历史蒸馏进去——只有用户明确要求时才动它
- 区别于 `AGENTS.md`(KB 的结构/工作流约定,偏静态)：`MEMORY.md` 是随用随记、不断累积的事实与偏好

## 外部工具(MCP servers)

工具是可插拔的，分三层管理，全部自动生效（增删零代码）：

| 层 | 位置 | 适用 |
|---|---|---|
| **全局工具** | Settings → Tools（localStorage） | 跨知识库通用的，如 localmd Connect 浏览器扩展；token 放这里 |
| **KB 级工具** | 知识库里的 `.agents/mcp.json`（随 git 走） | 这个库特有的服务；格式 `{"servers":[{"name","url","token"?,"enabled"?}]}`；与全局重复的目标以 KB 为准 |
| **用法知识** | `.agents/skills/`（技能） | "什么任务用什么工具、怎么措辞"的流程沉淀 |

每个条目支持 `enabled: false` 停用（保留配置）；Settings 里全局条目有停用/删除按钮，KB 条目显示 KB 徽章（编辑文件修改）。连接成功后工具以 `mcp__<名称>__<工具>` 出现在 agent 的工具列表，两个 provider 通用。

**延迟加载（token 控制）**：工具数超过 8 的服务器，其工具 schema 默认不随请求发送——系统提示词只带一行一个的紧凑目录（约省 80%），agent 需要时调 `enable_tools` 按名激活，**当轮立即可用**（全部外部工具在 `streamText` 里预先注册，靠每步 `prepareStep` 的 `activeTools` 门控只把当前激活的那批发给模型；激活后下一步即纳入）。激活按会话计，新会话重置。为什么必须激活：模型只能调用当次请求携带完整 JSON Schema 的工具，目录行没有参数定义——激活就是把 schema 带进请求的动作（每会话一次 ~200 token，换掉每请求数千 token 的常驻开销）。约束与安全：

- 服务器必须允许浏览器 CORS（与 LLM 端点同一约束）；本地起的 server（localhost）天然可用
- **localmd Connect 扩展**走另一条传输：它不声明 `externally_connectable`，改为在用户授权过的源上注入 relay content script，页面用 `window.postMessage` 收发同样的 JSON-RPC/MCP 报文（`src/lib/connectRelay.ts`，模块头有完整线格式）。从 Settings → Tools 的推荐列表安装，扩展 ID 由 relay 自己报出（`<html data-localmd-connect>`），线上版和本地 dev 版都自动识别；`https://localmd.app` 安装即授权，dev 地址需要在扩展弹窗的「Web app access」里加上本站的地址（含端口）并刷新页面
- 外部工具的**结果按不可信数据处理**——系统提示词明确要求 agent 不执行结果中内嵌的指令、不主动把 KB 内容发给外部工具
- `scripts/mcp-test-server.mjs` 提供一个本地测试 server（add/echo 两个工具），`node scripts/mcp-test-server.mjs` 后在 Settings 添加 `http://localhost:8901/mcp` 即可试用
- 已验证可直连的真实公共 server：DeepWiki（`https://mcp.deepwiki.com/mcp`，问答任意 GitHub 仓库）、Context7（`https://mcp.context7.com/mcp`，查库文档）——加 URL 即用

## Git 与 GitHub 同步

打开的文件夹是 git 仓库时，标题栏出现分支徽章（如 `main 3`），点开 Git 面板：

- **Changes**：相对 HEAD 的改动——文本文件按内容检测；二进制（PDF/EPUB/图片等）按"新增/删除"检测并可正常提交（**>100MB 的除外**——那是 GitHub API 的单文件推送上限，请在终端提交；tracked 二进制的**内容修改**无法检测，也请在终端提交）。`.trace/` 不参与。点文件看 diff（未变动区域折叠），勾选 + 填消息 + Commit
- **Recent commits**：最近 20 条提交
- **Pull / Push**：与 GitHub 同步（remote 需指向 github.com，SSH/HTTPS 形式都能识别）

同步实现说明：github.com 的 git smart-HTTP 端点不允许浏览器跨域，所以同步走 **GitHub REST Git Data API**（允许 CORS）——把 git 对象（blob/tree/commit）逐个镜像并**校验 sha 完全一致**，等价于真正的 push/pull；仅支持 fast-forward，分叉时请回终端 `git pull --rebase`。带 GPG 签名的本地提交无法经 API 镜像（会明确报错）。

### 获取 GitHub Token（push 需要；pull 公开仓库可不填）

1. 打开 <https://github.com/settings/personal-access-tokens/new>（GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate new token）
2. **Token name** 随意（如 `localmd`）；**Expiration** 按需（到期后重新生成）
3. **Repository access** 选 **Only select repositories**，只勾选你的知识库仓库（如 `whitefoxx/my-trace`）——不要给全部仓库授权
4. **Permissions → Repository permissions → Contents** 设为 **Read and write**（Metadata 会自动带上 Read-only；其余全部 No access）
5. 点 **Generate token**，复制 `github_pat_…` 开头的字符串
6. 回到 localmd：右侧面板齿轮 → Git & GitHub → 粘贴到 **GitHub Token**

Token 和 LLM key 一样只存在本浏览器的 localStorage、只发给 api.github.com。如果你更习惯 classic token：勾选 `repo` scope 即可，但权限比 fine-grained 粗，不推荐。

## 格式兼容性

知识库文件夹里的这几样东西是**已发布的格式**：已有知识库的磁盘上就是这么存的，笔记里的引用也是按这个解析的，所以它们不是我们能随手改的：

- **KB 结构**：`raw/`（不可变源文件）+ `wiki/`（LLM 维护的页面）+ `CLAUDE.md`（KB schema，会被两个应用的 agent 同样遵循）
- **索引目录与命名**：`.trace/{pdf,epub,md}-index/<slugify(文件名)>-<fnv1a(KB相对路径)>/`，内含 `sections/*.md`（每块带 `[[b<页/章>-<序>]]` ID）、`toc.md`、`locations.json`（块 → PDF 坐标 / EPUB CFI）、`manifest.json`、`_README.md`
- **新鲜度判定**：`manifest.contentHash`（源文件 sha256）+ 格式版本号（PDF=11，EPUB=3，MD=1）。任一应用生成的索引，另一应用命中即复用、不重建。**改动索引格式必须升版本号，且会破坏互认——慎动**
- **引用 token**：`[[pdf1:raw/papers/x.pdf]]` 声明来源（数字标识**来源**而非引用序号），`[[1:b14-3]]` 内联引用。写进 wiki 的引用在两个应用里都可点击回溯
- **索引生成**：点查看器上的 "Index for AI"，或让 agent 自己调 `index_document` 工具

## 已知限制

- 仅 Chromium 系浏览器（Safari/Firefox 无 `showDirectoryPicker`）
- LLM 端点必须允许浏览器 CORS（预设列表均已验证）
- 扫描版 PDF（无文本层）暂无 OCR，索引产出 0 块
- 双栏排版论文的块检测比 EmbedPDF 粗糙；中文书的上标脚注号已内联处理
- API key 存 localStorage——请只在自己的设备上使用，部署版不要引入任何第三方脚本
