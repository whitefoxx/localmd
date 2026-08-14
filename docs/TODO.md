# TODO / 规划

> 2026-07-11:远程 MCP server 支持(C8)与 **web-agent 桥接均已完成**。
> Settings 里配置 Streamable HTTP 端点或 Chrome 扩展 ID(32 位 a-p,自动选
> Port 传输),工具以 `mcp__<server>__<tool>` 注入两个 provider。web-agent 的
> `web_task` 已实测跑通(browser-md agent 委托浏览任务 → web-agent 引擎执行
> → 结果回传)。注意:扩展 manifest 带 `key` 字段时,ID 由 key 派生——重载后
> ID 会变,可用 `sha256(base64decode(key))[:32]` 映射到 a-p 计算。

## web-agent 桥接:把浏览器自动化当作 MCP 式工具(已完成,设计存档)

**动机**:browser-md 是纯网页,agent 没有网页浏览能力(fetch 任意站点被 CORS 挡);
web-agent(Chrome 扩展)有 host 权限与完整的浏览 agent 引擎。桥接后,browser-md
的 agent 可以把"搜索/读网页/网页操作"类任务整体委托出去——例如「查一下 X 的最新
进展,整理进 wiki 并注明来源」。

**通道**:`externally_connectable`(Chrome 官方的网页↔扩展通信机制)

- web-agent manifest 声明允许的页面源(收紧到 localhost:5173 + 部署域名——列入的
  任何页面都能驱动扩展,不能放宽)
- browser-md 侧 `chrome.runtime.connect(EXTENSION_ID)` 建长连接 Port,JSON-RPC
  消息双向走,进度事件流式回推;探测不到扩展时优雅降级(不注册工具)
- 扩展 ID 需固定(manifest 配 key),避免开发/打包不一致

**集成粒度**:高层委托(推荐,先做)——只暴露一个 `web_task(task)` 工具,把任务
交给 web-agent 自己的 agent loop(独立上下文、自己的 LLM 配置、自己的安全确认),
只回传最终答案。与 run_subagent 同构。协议消息按 MCP 的 `tools/list` / `tools/call`
形状定义,将来接真正的远程 MCP server 时同一套工具注册抽象直接复用。
低层桥接(navigate/click/read/screenshot 逐个暴露)暂不做——往返多,且截图→视觉、
元素引用、脱敏这些 web-agent 引擎已解决,不值得在外面再驱动一遍。

**工作量**:web-agent 侧 manifest + background 对外 handler(喂任务给 engine、回推
进度/结果)约 150-300 行;browser-md 侧扩展桥接层 + 动态注册 `web_task` + 设置里的
连接状态显示,约 200 行。最小闭环验收:跑通"搜索并总结"场景。

**初版边界**:web-agent 的 LLM 配置保持独立(自己的 key 管理),不打通。

## Code Mode:让模型写程序来调工具(未做,方向记录)

2026-08-14。读 DeepSeek Harness 时看到的机制,是它 `packages/code-runtime` 的做法:
模型不逐个调用工具,而是**写一段程序**,工具作为 `tools.read_file(...)` 这样的 async
方法注入运行时;子调用照样走完整的工具流水线(带父级 token、记 dispatch 事件、拒绝变成
程序里的 typed rejection)。

**为什么对我们有意义**:收益不是「批量」,是**控制流**。「读 30 个文件筛出提到 X 的 3 个」
现在是 30 次 round trip,每次重放整个前缀;Code Mode 是 1 次。今天的前缀审计给了这笔账
一个真实数字——每步约 7.4k est 常驻,乘以 30 就是纯浪费。循环、条件、过滤在程序里免费,
在 agent loop 里每一步都要付钱。

**浏览器反而是优势**:Web Worker 天生没有 fs、没有网络凭据、没有 DOM,沙箱化比 Node
容易得多。工具调用通过 postMessage 回主线程执行,能力边界还是现有那套(licence 门、
approval 卡片、connectGuard)——不新增攻击面,只是换了驱动方式。

**为什么现在不做**:工程量大(运行时 + 绑定协议 + 错误映射 + UI 怎么呈现一段程序的执行),
而且它改变的是 agent loop 的形状,不是加一个工具。等两件事之一发生再动:(a) 出现真实的
「几十次同类调用」场景(批量索引、跨文件重构);(b) #6 的 snapshot 回放层建好,能证明改造
前后模型行为不变。

**边界**:不做通用代码执行工具(那是另一回事,面向用户跑任意脚本)。这里只是工具调用的
另一种**传输方式**,模型可见的能力集合必须完全一致。

## Backlog(已确认暂缓)

- ~~MCP OAuth 2.1 (deferred 2026-07-26)~~ **已实现**,见下方「MCP OAuth」一节。
  当时的判断有一处后来被推翻:那条笔记担心 Linear/Notion 不暴露
  `Access-Control-Expose-Headers: Mcp-Session-Id`、浏览器读不回 session id。
  实际情况是 `WWW-Authenticate` 才是浏览器读不到的那个(103 个服务器里只有 15 个
  暴露),所以发现链改走 well-known 路径兜底;而 2026-07-28 规范干脆把 session
  整个删掉了。

- **GitHub 同步 live 验证**:push/pull 代码与错误路径已测,但真实推送需用户 PAT
  (Settings → Git & GitHub;README 有 token 指南)
- **扫描版 PDF 的 OCR**:无文本层的 PDF 索引产出 0 块(trace-app 用 macOS Vision,
  浏览器可考虑 tesseract.js,精度/体积待评估)
- **EPUB 页内截图**:epub.js 渲染的是 iframe HTML,无现成区域截图;若做,用
  getDisplayMedia(preferCurrentTab)抓帧 + 自绘选框裁剪(每次多一步浏览器确认,
  画质受屏幕分辨率限制)。当前结论:用系统截图(⌘⇧4)+ 聊天粘贴即可
- **tracked 二进制的内容修改检测**:需哈希全文件,status 阶段不可行;维持终端处理

## MCP OAuth(已实现,两处延后)

2026-07-31。发现链 → PKCE → CIMD/DCR → token 交换 → 令牌存储 → UI 全部落地
(`src/lib/mcpOAuth.ts` 纯逻辑 + `src/lib/oauthPopup.ts` 弹窗 +
`public/oauth/callback.html` 静态回调 + store 编排)。对 Notion 实测到授权页。

- ~~部署 `oauth-client.json`~~ **已生效**(2026-07-31)。文件在 `public/` 里,所以
  发版就带上去了 —— 从来不存在一个单独的「部署」动作。线上已验证:文档可取、
  `client_id` 等于它自己的 URL(自洽)、含生产回调;`/definitely-not-a-real-path`
  返回 404 而非 index.html,说明 Vercel 没把静态文件重写掉,回调页因此能活。
  CIMD 只在 `window.location.origin` 等于文档 `client_id` 的 origin 时启用 ——
  那不是开关,而是「对方抓得到」且「这份文档描述的是我们」同时成立的唯一条件。
  副作用:dev 永远走 DCR,兼容路径因此不会腐烂。

- ~~令牌中途过期的自动刷新~~ **已完成**(2026-07-31)。401 单独成一条重试路径
  (`isAuthFailure`),因为补救方式和掉线不同:掉线重连即可,令牌过期必须**先换
  令牌再重连** —— 否则只会换来第二个 401。续期成功是重试的**闸门**,换不到就报错
  停下,不会变成循环。安全性上 401 满足既有的「请求确定没送达」不变式,甚至比掉线
  更确定:服务器在鉴权阶段就拒了,没派发到工具。
  实测:注入坏 access token(refresh 有效)→ 一次调用内自动续期并成功;两个都坏
  → 报错停下,997ms 结束。

- **已知拦不住的**:只接受机密客户端的服务器(实测 Craft、Miro 明确只列
  `client_secret_*`)。浏览器应用没有能保管的密钥,`supportsPublicPkce` 会在用户
  点「登录」之前就说明白,这是正确行为而不是待办。

## KB 自带 MCP 服务器缺审批闸(已知不对称)

2026-07-31。`.agents/mcp.json` 里的服务器**打开文件夹就连**,而同样跟着文件夹来的
HTTP 工具要用户批准一次才生效(`stores/tools.ts` 的 `kbTrusted` 指纹机制)。

最危险的那条路已经堵上:KB 来源的行可以**写**  `{{secret:id}}` 但拿不到值,所以别人
的文件夹不能花你的密钥(见 `connectServer` 的 `source === 'kb'` 分支)。

剩下的仍值得做:打开一个陌生文件夹,仍会自动连上它指定的任意地址 —— 会暴露你的 IP、
让对方知道有人打开了这个 KB,如果那台服务器要 OAuth 还会诱导你去授权。正确做法是把
MCP 服务器纳入同一套 `kbTrusted` 审批(指纹变了要重新问),UI 上和 KB 工具的审批卡
片合并。
