# TODO / 规划

> 2026-07-11:远程 MCP server 支持(C8)与 **web-agent 桥接均已完成**。
> Settings 里配置 Streamable HTTP 端点或 Chrome 扩展 ID(32 位 a-p,自动选
> Port 传输),工具以 `mcp__<server>__<tool>` 注入两个 provider。web-agent 的
> `web_task` 已实测跑通(localmd agent 委托浏览任务 → web-agent 引擎执行
> → 结果回传)。注意:扩展 manifest 带 `key` 字段时,ID 由 key 派生——重载后
> ID 会变,可用 `sha256(base64decode(key))[:32]` 映射到 a-p 计算。

## web-agent 桥接:把浏览器自动化当作 MCP 式工具(已完成,设计存档)

**动机**:localmd 是纯网页,agent 没有网页浏览能力(fetch 任意站点被 CORS 挡);
web-agent(Chrome 扩展)有 host 权限与完整的浏览 agent 引擎。桥接后,localmd
的 agent 可以把"搜索/读网页/网页操作"类任务整体委托出去——例如「查一下 X 的最新
进展,整理进 wiki 并注明来源」。

**通道**:`externally_connectable`(Chrome 官方的网页↔扩展通信机制)

- web-agent manifest 声明允许的页面源(收紧到 localhost:5173 + 部署域名——列入的
  任何页面都能驱动扩展,不能放宽)
- localmd 侧 `chrome.runtime.connect(EXTENSION_ID)` 建长连接 Port,JSON-RPC
  消息双向走,进度事件流式回推;探测不到扩展时优雅降级(不注册工具)
- 扩展 ID 需固定(manifest 配 key),避免开发/打包不一致

**集成粒度**:高层委托(推荐,先做)——只暴露一个 `web_task(task)` 工具,把任务
交给 web-agent 自己的 agent loop(独立上下文、自己的 LLM 配置、自己的安全确认),
只回传最终答案。与 run_subagent 同构。协议消息按 MCP 的 `tools/list` / `tools/call`
形状定义,将来接真正的远程 MCP server 时同一套工具注册抽象直接复用。
低层桥接(navigate/click/read/screenshot 逐个暴露)暂不做——往返多,且截图→视觉、
元素引用、脱敏这些 web-agent 引擎已解决,不值得在外面再驱动一遍。

**工作量**:web-agent 侧 manifest + background 对外 handler(喂任务给 engine、回推
进度/结果)约 150-300 行;localmd 侧扩展桥接层 + 动态注册 `web_task` + 设置里的
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

## 开源仓的一键部署按钮:验证过再加(待做)

2026-08-26 加过又撤了。按钮本身很简单(两个 markdown 链接 + `oss/netlify.toml`
里的 build 配置,那个文件留着了),难的是**确认它们真的能跑通** —— 要在 Vercel /
Netlify 上实打实部署一次才知道。

不验证就挂上去,风险正是它想解决的那个问题:第一周、最需要好口碑的时候,来自
最挑剔那批人的一次失败部署。

要加回来的话,先自己各点一次确认能出站,再往 README 的「Running it」一节顶部放:

    [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwhitefoxx%2Flocalmd)
    [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/whitefoxx/localmd)

Cloudflare Pages 也可以考虑,同样要先验证。

## 用一个角色邮箱替回手册里的私下联系渠道(待做)

2026-08-26 开源准备时,`lib/links.ts` 里的 `CONTACT_EMAIL` 和手册
`docs/app/getting-started.{md,zh.md}` 里的私下联系地址都是个人 Gmail。开源仓
一公开它就会被爬,所以先删掉了:手册那条改指向问题追踪仓的
**Security → Report a vulnerability**(开私密会话,不暴露任何邮箱)。

**但换窄了。** 原文说的是「安全问题,**或者没法贴进公开工单的文档**」,后半句现在
没有对应渠道 —— 一个早期用户想私下发一份不能公开的材料,没有地方可发。

修法:在 localmd.app 这个域名下配一个角色邮箱(如 `hello@localmd.app`),然后
把手册那句和 `lib/links.ts` 接回去。角色地址公开无妨,个人 Gmail 才是问题。
注意 `links.ts` 现在是 edition 文件(在 `oss/` 有覆盖版),两边都要看一眼 ——
开源版是否也给出这个地址,是一个决定,不是默认。

## Backlog(已确认暂缓)

- ~~MCP OAuth 2.1 (deferred 2026-07-26)~~ **已实现**,见下方「MCP OAuth」一节。
  当时的判断有一处后来被推翻:那条笔记担心 Linear/Notion 不暴露
  `Access-Control-Expose-Headers: Mcp-Session-Id`、浏览器读不回 session id。
  实际情况是 `WWW-Authenticate` 才是浏览器读不到的那个(103 个服务器里只有 15 个
  暴露),所以发现链改走 well-known 路径兜底;而 2026-07-28 规范干脆把 session
  整个删掉了。

- **GitHub 同步 live 验证**:push/pull 代码与错误路径已测,但真实推送需用户 PAT
  (Settings → Git & GitHub;README 有 token 指南)
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

## 来源感知的写入门禁：让代价与不可逆程度成正比（未做）

2026-08-26 提出，2026-08-27 重写——原方案「按目录划的 overlay-only 模式」已撤销，
理由见下。产品原则「The agent adds; it does not rearrange」在 CLAUDE.md 里已经写下，
但今天没有任何代码在执行它。

**现状**：`guardPath` 只拒绝 KB 根目录与 `.git`，其余授权范围内的任何路径，写入四件套
(`write_file` / `edit_file` / `move_path` / `delete_path`) 都能碰。默认 `writeMode` 是
先写后审(写前快照 + 行级 diff + Approve/Discard)，`'ask'` 每次停下等卡片；删除有一条
额外的不对称——目录与二进制没有快照，所以不管什么模式**一律先问**；底下有 git 兜底。

**缺的不是禁止，是区分**：今天这套门禁，对「用户三年前手写的那篇笔记」和「agent 五分钟
前刚建的那个页面」花掉的用户注意力完全一样多。信号是平的，而平的信号会被审批疲劳磨成
「全部同意」。目标应该是**让代价与不可逆程度成正比**，不是一刀切地不许动。

**撤销的旧方案(按目录划)**：曾打算给一个「叠加目录」(默认 `wiki/`，无则 `inbox/`)，
其外只读。撤销的理由不是死板，是**自相矛盾**——它把规则钉在我们自己的布局上，而没有
`wiki/` 的库、直接指向 `~/Zotero/storage/` 的库根本没有天然的叠加目录。用一条违反
「用户的结构赢」的机制，去执行由该原则派生出来的规矩，讲不通。

**新方案：按来源(provenance)划，不落盘。**

- 判据已经在写入路径上算出来了：`review` store 的 `PendingChange.before` 为 `null`
  就是「这个文件是 agent 新建的」，而且 `upsert` 保证首次快照不被后续写入覆盖。
- 需要新增的只有一个**会话内的 Set**(本会话由 agent 新建的路径)——因为 `approve()`
  会把条目从 `pending` 里删掉，不能直接拿 `pending` 当来源表。内存里，不写盘。
- **跨会话不做**：上一次会话它写的页面，这次会话降级为「用户的文件」，待遇更谨慎。
  保守方向是对的，而且绕开了「哪些文件是 agent 建的」需要记账这个死结——把记账文件
  写进用户的文件夹，正是 `_index.md` 与 review queue 被否决的同一条理由
  (docs/llm-wiki-prior-art.md)。
- 可选加强：KB 是 git 仓时，「HEAD 里有没有这个 blob」是一个不用记账的持久判据；
  非 git 的库退回会话内判定即可。

**「用户确实想改」怎么区分**：授权来自用户的请求，但**必须以一次点击的形式携带，不能
从提示词里推断**——agent 读到的网页与工具结果，在内容上与真实请求不可区分。所以重排类
操作的授权落在一张**作用域卡片**上：一次操作的计划 + 受影响文件清单，同意即授权**这一次
操作**，不授权下一次(既有三条门禁规则：默认是否 / 一次同意只管一件事 / 卡片指向它所
决定的那次调用)。**批量必须是一张计划卡，不是 34 张文件卡**——审批疲劳会把门禁本身毁掉，
那比不设门禁更糟。执行完落成一个 commit，可整体回退。

**建议的最小可用版(先做区分，不做模式)**：

1. 卡片与 Agent-changes 面板显示来源(你写的 / 我建的)——纯呈现，零风险。
2. 用户来源文件的 delete / move **一律先问**，不管 `writeMode`：把今天只给目录与二进制
   的那条不对称，扩展到「不是它自己建的东西」。
3. 重排类操作走一张计划卡 + 一个 commit。

三条都不需要新设置、不需要新的持久状态。**严格模式(只增，连编辑都不许)留作可选开关**，
给「资料不敢让 AI 碰」那批人，等真有人要求再做——**不做默认**，否则「帮我整理一下」
这类正当请求会直接撞墙。

**在哪执行**：`src/agent/tools.ts` 里写入四件套共用的审批处，不是提示词。拒绝要回一句
能让 agent 改道的话(「这个路径是你的，要动它得先给你一张卡片」)，而不是静默失败。

**对文案的影响**：做完 1–3，口径仍然只能是**「它会问，而且它知道哪些是你的」**；只有
严格模式落地之后，才能在那个模式下说「它不能」。message house 里那条禁句照旧有效。

**验证**：动写入路径，必须配 e2e 并在真浏览器里走一遍。手册(`docs/app/`)**实现之后**
才写，未实现的行为不许进手册。

## Resurfacing old material: a view or a note, never a record (未做)

2026-08-26。痛点：资料越攒越多，攒完就忘；想要的是在对的场景里让旧线索自己浮上来。
两半，只缺一半：

- **拉(已有，但对外一个字没说)**：用自然语言问自己的库——`search_files`、⌘K、
  agent 三者已经能做。r/PKMS 与 r/ObsidianMD 最高赞的诉求原话就是这个(「上次写
  这个是什么时候」)，而落地页从未提过。**零开发，纯文案，优先级最高。**
- **推(未做)**：在对的时刻把旧东西放到手边。

**硬约束**：没有后端，所以没有定时推送(PWA 通知需要推送服务，且标签页不开就不成立)；
以及**不许写记账文件**——review queue 已经被刻意否决过一次，理由是「队列是写进别人
文件夹的记账基础设施，而 log 是一篇普通笔记」(docs/llm-wiki-prior-art.md)。任何
浮现功能都必须是**算出来的视图**，不是存下来的状态。

**候选，按成本从低到高**：

1. **回答前先查你自己的库**——一个 skill 加一句系统提示即可，零代码。画面感最强：
   你问它一个问题，它先去问三年前的你自己。
2. **写作时的邻居**——打开一篇笔记时，列出与它共享词汇但没有链接过去的旧页面。
   数据来自 `kbIndex`，不读 LLM、不花 token。
3. **进门时的一张卡片**——完全由 `computeLint` 已经算出来的信号构成：
   `unreferencedSources`(还没被任何页面提到的材料)、`stalePages`、
   `staleLogEntries`、`weaklyLinked`。按需渲染，什么都不写盘。

**明确不做**：间隔重复调度、常驻的待复习清单、任何把状态写进用户文件夹的东西。

## meta 页面的角色解析：名字是默认值，frontmatter 是覆盖，AGENTS.md 是叙述（部分完成）

> **2026-08-27 夜间：确定性半部已实现。** `extractRole`（wiki.ts）读 frontmatter
> `kb-role: index|log`；`computeLint` 全程角色感知——staleLogEntries、质量检查豁免、
> reachability root 均先查角色再按名字兜底；**root 坑已修**（声明的 index 优先于被
> 挪用的 `index.md`；双重声明取字典序最小；`index.md` 自称 log 时不再被当 root）。
> 测试：lint.test.ts 新增 5 例 + wiki.test.ts 2 例。**剩**：agent 侧引导（提示词/
> 冲突时提议别名的流程）、AGENTS.md 叙述约定、手册文档化——键名 `kb-role` 就此定下。

2026-08-27。index 与 log 是**鼓励**新建的 meta 页面：在不动用户任何原有文件的前提下，
index 给材料补空间结构，log 补时间历史（notes vs. records 的刀见 CLAUDE.md——agent
可以写 note，不可以写 record）。要解决的只是**重名**：用户的库里可能已经有一个
`index.md` 或 `log.md`，而且用途完全不同。

**现状（已核实）**：

- 用户自己的 `log.md`（比如健身记录）→ `isLogPage` 找不到 `## YYYY-MM-DD` 标题 →
  静默不报。良性，设计如此。
- 用户自己的 `index.md` 挪作他用 → 被 `isEntryPage` 豁免质量检查（良性），**但**被
  `computeLint` 当作 reachability root——它不链接任何内容页时，全库内容页被标
  `unreachable`。这是今天唯一真正的坑：一次合规的重名，换来一整页唠叨。

**方案：三层解析。**

1. **名字是默认值**：`index.md` / `log.md` 按名识别。零配置，scaffold 库和绝大多数库
   直接命中，什么都不用改。
2. **frontmatter 是覆盖，覆盖存在时是唯一的事实来源**：冲突时 agent 提议换个名字新建
   (名字随意，`kb-log.md`、中文名都行)，页面 frontmatter 写角色标记；确定性机器
   (`isEntryPage`、root 选择、`staleLogEntries`)先查标记、再按名字兜底。角色跟着文件
   走——改名、移动都不丢，「一个事实住一个地方」。键名**待定**：倾向
   `kb-role: index|log` 而不是裸 `role:`——后者太常用(人物页的 `role: manager`)，
   撞车概率不低。
3. **AGENTS.md 是叙述，不是事实来源**：agent 把决定写进去(「本库的综合日志在
   `kb-log.md`；根目录 `log.md` 是用户的健身记录，别动」)，给未来会话和别的工具看。
   它像任何散文一样会过期——过期时 frontmatter 依然正确，什么都不坏，agent 发现后
   提议修一句即可。

**AGENTS.md 自己没有别名机制，也不需要**：它的含义不由我们定义，由跨工具的开放标准
定义——名字即含义，用户挪用它是对整个生态「误标」，不只是对我们；而且它是发现链的
**根**——一个被挪作他用的 AGENTS.md 没办法告诉你真正的说明书在哪，因为读它就是了解
这个库的方式。对它只有优雅降级(内容不像说明书就按内容对待，另有 CLAUDE.md 兜底)。

**边界情形**：两个页面声称同一个角色 → 确定性平局(如取路径字典序最小)，并作为一条
lint finding 报出(与 `similarTags` 同类)。永远是建议，不是错误——软约束原则，不许
因此唠叨或拒绝工作。

**冲突检测不需要新机器**：agent 往 `log.md` 追加条目前本来就要先读它，读出来不是
综合日志，就提议「别名 + frontmatter 标记 + 记进 AGENTS.md」，三步都过正常写入审查。
与来源感知门禁自然衔接：agent 建的 meta 页是它自己的文件；用户那个重名文件是用户的
文件，动它先问。

**维护循环（信号全是现成的，不引入后台自动化）**：`unreachable` 就是「index 落后了」，
`staleLogEntries` 就是「log 落后了」；循环 = 确定性信号 → 提议 → 批准 → 一个 commit，
与内容页面同一套。

## tags 升格为索引维度：文献卡、图谱合并、工作集 recall（部分完成）

> **2026-08-27 夜间：第 1、2 步已实现。** kbIndex 新增 `tags` computed（path→tags，
> 内容缓存派生、不落盘）；搜索面板支持 `tag:` 过滤，与 `type:` 组合生效——查询语法
> 抽成 `lib/searchQuery.ts` 纯函数（parseSearchQuery / matchesFilters）配 6 例测试。
> 真浏览器阳性验证：demo 页加 tags frontmatter 后 `tag:llm` 命中。**剩**：GraphView
> 源文档节点与 tag 伪节点（第 3 步）、文献卡模式、工作集 recall；另记一笔——**手册
> 从未记载 ⌘K 的 `type:`/`tag:` 过滤**，两个一起补进合适的 topic。

2026-08-27 讨论结论。背景：整理散乱 corpus 需要 tag 把文件横向关联起来，但二进制
(PDF/EPUB)没有 frontmatter 可写；同时 recall 需要「相关旧笔记」的确定性信号。

**tag 只有一种住处：markdown frontmatter。** 二进制的 tag 不发明新格式，用**文献卡**
(每个源一张 stub 笔记)承载：frontmatter 放 tags、正文声明 `[[pdfN:path]]`、可加一句
摘要。这不是为 tag 造的特殊格式，是「给二进制一个 markdown 代理」的通用原语——摘要、
评分、阅读状态将来都住这里。全部现有机器零改动即工作(`similarTags`、搜索、`inbound`、
图谱节点)。「给 200 个 PDF 打 tag」= 批量生成文献卡，一张计划卡 + 一个 commit。
**源文件自身的 tag 是派生值**：引用它的页面的 tags 求并集，一个 computed，不存盘。

> **2026-08-28：文献卡的位置与检测入口已定并部分实现。**
> - **位置不新增目录**：文献卡就是一张普通 wiki 页面，位置服从既有规则（scaffold 库
>   写进 `wiki/`；用户自己的结构由 agent 按其组织方式归档；没有笔记区的库落 `inbox/`）。
>   **身份由 frontmatter 承载**（`type: source`，与 saved session 的 `type: chat` 同一
>   套词汇表），不由路径承载——与 `kb-role` 同一条原则。命名按作品标题，不镜像源文件名
>   （绑定由正文 `[[pdfN:path]]` 承担，`resolveCitePath` 容忍改名/移动）。
> - **sources 不进 frontmatter**（用户提议，讨论后否决）：`[[pdfN:path]]` 是**编号绑定**，
>   正文里每个 `[[N:block]]` 都靠它解析；写成 YAML 列表则顺序决定编号，重排即静默改指，
>   违反「编号一旦发布永远指向同一段」。frontmatter 只放无编号语义的元数据（type/tags）。
> - **已实现**：`kbIndex.declaredSources` / `hasSourceNote`（复用 refreshSourceMtimes
>   本就在算的集合，零新解析）；`SourceNoteBadge.vue` 挂在 PDF/EPUB/DOCX 三个 viewer 的
>   徽章区，仅在无人引用该源时出现，点击把预填请求交给 `ui.pendingPrompt`（草稿，不自动
>   发送）；手册 `documents` 新增一节（en+zh）。测试：lint.test.ts 新增 4 例锁住
>   「提及≠引用」这条判据。真浏览器验过阴性（已引用→无徽章）与阳性（删掉声明→徽章即时
>   出现→点击落草稿）。
> - **剩**：`type: source` 的 agent 侧引导（ingest/skill 里让它默认写这个字段）、
>   PDF 自身 tag 的派生值（引用它的页面 tags 并集）、批量「给 N 个源建卡」的计划卡。

**明确不做**：中心化 `tags.md`(一个事实两个住处，且是全库写入热点，滑向 record)；
JSON sidecar tag 表(只有本 app 能读。annotations sidecar 不是先例：标注是查看器
几何数据，markdown 里没有家；tag 是知识层数据，有家)。

**实现三步(从小到大)**：

1. kbIndex 加 `tags` computed(path → tags / tag → paths)。`extractTags` 已在
   `wiki.ts`，内容已在缓存，今天 tags 只被 lint 的 `similarTags` 消费。
2. 搜索面板加 `tag:` 过滤——与现有 `type:` 过滤对称。
3. GraphView 合并而非新开 view：两个开关——**显示源文档节点**(放宽 `graph` computed
   里 `pages.value.has(target)` 那行过滤；`outgoing` 本就记录了指向 PDF 的链接，
   PDF 的 backlinks 今天已能用)、**显示 tag 伪节点**(共享 tag 的页面经 tag 节点相连)。
   着色管线已吃 `types`，加一路 tags 顺水。

**Recall 分两层**：

- **ambient(程序算，免费，安静)**：会话工作集(本轮 agent 读/写/引用过的路径 + 用户
  @ 过的文件，transcript 里全有)→ kbIndex 查邻居：backlinks ∪ 共享 tag ∪ 共同引用
  同一源(`declaredSourcePaths` 已在算)∪ 出链重合。零 LLM、零写盘。UI：BacklinksPanel
  扩成 Related 面板(当前笔记的邻居，按信号分组)；聊天面板一条**折叠的**细线提示
  (「N 篇相关旧笔记」，点开才展开)。**只进 UI，不进模型上下文**——自动注入既花 token
  又破坏缓存前缀；放侧板里用户点了才算数。
- **active(agent 检索，花 token，显式触发)**：agent 真用 `search_files` 检索旧笔记并
  引用进回答，由 skill 或用户一句话触发。

**否决的方案**：「agent 每轮回复后 LLM 生成 session tags 再程序匹配」——每轮多一次
模型调用是常驻税；生成的词汇与库内词汇漂移(`similarTags` 的存在即证据)，对不上就
匹配不到；还要存一份 session 状态。工作集推导更便宜且 ground 在实际发生的事上。

**诚实边界**：ambient 层只覆盖结构性相关(链接/tag/共同引源)；「语义相关但从未链接」
需要 embedding 或 LLM，另一个成本档位，明确往后排。


## 扫描件 OCR:Stage 0 / Stage 1 已实现(2026-08-28)

**引擎必须是 tesseract.js,不能是视觉模型——这条是几何决定的,不是成本。**
`inherit.ts` 的不变量建立在**矩形重叠**上(「几何是 ground truth」),`locations.json`
存的是每个块的 `NormRect[]`,引用点击能落到那一段并高亮也靠这些坐标。tesseract 输出
逐词/逐行 bounding box → 真坐标 → 高亮准确、重跑时 id 继承照常;视觉模型只回文本,
没有可靠坐标 → 只能伪造矩形 → 高亮退化成整页闪烁、继承全乱。**视觉模型不能喂索引**,
它将来至多做「帮我读这一页」的便利功能,那是另一件事。

### 已实现

- **Stage 0**:viewer 上一张常驻提示卡(不是 toast 尾巴)、`index_document` 的工具
  结果对 agent 说清 0 块的含义、手册两语言各一节。
- **Stage 1**:`lib/docindex/pdf/ocr.ts` + `extractPdfViaOcr`,提示卡上「识别页面
  上的文字」→ 选语言 → 按钮上写明页数与预估分钟数 → 进度条与取消。产物走既有
  `assembleBlocks` / `boundsOf` / `inherit.ts`,所以块、矩形、id、引用与文本层路径
  完全同一条。
- **出处标记**:manifest 记 `textSource` / `ocrLang`;viewer 顶栏一枚常驻徽章
  「Text recognised」,索引的 `_README.md` 也对 agent 说明这是识别所得、引用时要
  声明。

真实验收(311 页中文扫描件切出的 3 页,`chi_sim`):34 块、中文正确、`b2-3` 点回去
精确高亮到第 2 页那段编号段落。

### 这个依赖为什么引,什么条件下重新评估

按「默认自己实现」的规矩过了一遍:OCR 引擎「组件非常复杂」✓、「候选库非常稳定」✓
(tesseract.js,Apache-2.0,十年项目,纯 WASM 无后端,与「浏览器内、无服务端」的
硬约束天然相容)。它替换的不是薄层——自己写一个中文 OCR 不是一个季度的事。

值得借鉴的:引擎与语言数据分离、按需下载再缓存;worker 生命周期由调用方持有并
`terminate()`。**重新评估的条件**:(a) 浏览器原生 `Shape Detection API` 的
`TextDetector` 在 Chrome 稳定落地并给出逐行坐标——那就是零依赖零下载;(b) tesseract.js
的 CDN 语言包不再可靠(我们目前依赖它按需取字库);(c) 它停止维护,或某次大版本再
一次静默改结果结构(7.0 就干过一次,见下面的坑 3)。

### 与原方案不同的几处(都是实现时才发现的)

| 原计划 | 实际 | 为什么 |
|---|---|---|
| `BUILDER` 必须 bump | **没有 bump** | OCR 没有改文本层的抽取算法。bump 会把每一个既有索引标成「outdated」,为一条它们从未走过的路径 |
| 取消保留已识别的页 | **取消丢弃全部** | 半本书会装配成一个完全合法、看起来完整、实际只覆盖三分之一页面的索引,而没有任何地方说得出来 |
| 2–5 秒/页 | 正文页 ~4.5s、表格页 ~13s(Intel Mac) | 预估按 6s/页,按钮上直接写分钟数 |
| Web Worker 里跑 | tesseract.js 自带 worker | 不需要我们再包一层 |

### 三个静默的坑(都不报错,只是产出空白)

1. **pdf.js 6 把 JBIG2 / JPEG 2000 解码搬进了 WASM,需要 `getDocument({ wasmUrl })`。**
   扫描件几乎都是 JBIG2,缺了它 pdf.js 只 warn 一句、把页面画成白纸、然后正常
   resolve——OCR 拿到一张空白纸,看起来和「扫描质量太差」一模一样。
   `vite.config.ts` 的 `pdfjsWasmAssets()` 把两个 wasm 复制到固定路径(`?url` 用不了,
   pdf.js 自己按文件名拼)。
2. **pdf.js 6 的 `render()` 收 `canvas`,只给 `canvasContext`(6 之前的签名)什么都
   不画**,同样不抛错。
3. **tesseract.js 7 把 `data.lines` 挪进了 `blocks[].paragraphs[].lines[]`**,读旧
   位置得到 `undefined` 而不是报错——整页识别完美却产出 0 行。`ocr.test.ts` 钉住了
   这三者中唯一可在 node 里测的那个。

另有一条不是坑但会影响观感:tesseract 逐字切中文再用空格拼回,`起 始 情 境` 要在
`tidy()` 里收掉,否则空格会进笔记、进搜索索引、进每一条引文。

### 还没做

- **页范围 OCR**:311 页 ≈ 半小时,全有或全无。要做就得让 manifest 记下识别了哪些页,
  并在 viewer 说明覆盖范围——否则就是上面「取消丢弃全部」那条要避免的东西。
- **OCR 的标题判定偏噪**:行高来自 bbox,受升降部影响,正文段落容易被当成标题,
  于是 section 文件名变成一整段话。共享的启发式不能单独为 OCR 改(会波及文本层
  并触发 BUILDER bump),要做得另开一条按 `textSource` 分叉的路径。
- 语言包目前从 tesseract.js 的 CDN 按需下载(手册两语言都写明了)。要不要自带
  `eng` 还没定。
