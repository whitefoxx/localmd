/** Settings modal — every pane. Namespace: `settings`. */
export default {
  en: {
    nav: {
      general: 'General',
      models: 'Models',
      agent: 'Agent',
      hotkeys: 'Shortcuts',
      health: 'KB health',
      tools: 'Tools',
      git: 'Git & GitHub',
    },
    privacyNote: 'API keys and tokens stay in this browser only — sent straight to the provider, never through any other server.',
    back: 'Back',
    addProfile: 'Add model',
    editProfile: 'Edit model',

    // General
    language: 'Language',
    languageDesc: 'Interface language. Agent replies follow this setting too.',

    // Profile editor
    labelOptional: 'Label (optional)',
    maxTokensOptional: 'Max tokens (optional)',
    defaultPlaceholder: 'Default',
    profileHelp:
      'Once you pick a provider you only need the API key and model name — the base URL and API adapter are built into the SDK. The endpoint must allow browser (CORS) access; the chat area will warn you if the connection fails.',

    // Models list
    profilesHeading: 'Model profiles',
    noProfiles: 'No models configured yet — add an API key so the agent can work.',
    badge: { primary: 'Primary', vision: 'Vision', image: 'Image' },
    slotsHeading: 'Model roles',
    slot: { primary: 'Primary', vision: 'Vision', image: 'Image generation' },
    notConfigured: 'Not set',
    visionHelp:
      'A Claude primary is multimodal by nature — no vision slot needed. For an OpenAI-compatible primary: if it is itself multimodal (e.g. qwen-vl, glm-4v, gpt-4o), point the vision slot at itself (images go straight into context); if it is text-only (e.g. deepseek-chat), point the vision slot at a dedicated vision model (the agent calls it through the view_image tool).',
    imageHelp:
      'The image-generation slot is optional; once set, the primary can create pictures with the generate_image tool (saved into the KB). Supported: OpenAI (DALL·E), Google (Imagen), xAI, and OpenAI-compatible /images/generations endpoints (Zhipu CogView, Qwen, custom, …). Enter the matching image model name; the endpoint must allow browser CORS.',

    // Agent behavior
    writeMode: 'Write mode',
    writeModeDesc:
      'In ask mode, the agent\'s write_file / edit_file / delete_path pause until you Approve or Reject in the Review panel. Deleting a folder or a binary file asks in BOTH modes — nothing can bring those back. After changes you can review the affected files in the “Agent changes” panel; whether and how to commit is up to you in the Git panel.',
    writeAuto: 'Write directly (review afterward)',
    writeAsk: 'Ask first (approve each time)',
    multiTab: 'Multi-tab sessions',
    multiTabDesc:
      'Let the agent panel hold several session tabs at once; off means a single session. A running session is not interrupted by switching or closing its tab — only the stop button, deleting the session, or closing the page stops it.',
    maxTabs: 'Max tabs',

    // Hotkeys
    hotkeysHeading: 'Keyboard shortcuts',
    resetDefaults: 'Reset to defaults',
    recordingHint: 'Press the new combo, Esc to cancel',
    recordHint: 'Click to record a new binding',
    recording: 'Recording…',
    resetOne: 'Reset to default',
    hotkeysHelp:
      'Click a binding on the right, then press the new combo (must include ⌘/Ctrl). When ⌘N, ⌘M, ⌘` and friends are taken by the browser or system, use ⌥⌘N, ⌥⌘M, ⌃` for the same command. Changes save instantly.',
    needsModifier: 'A shortcut must include ⌘ or Ctrl',
    conflictsWith: 'Conflicts with “{label}” — pick another',

    // KB health scope
    healthScope: 'Scan scope',
    healthDesc:
      'Which directories the KB health check (broken links, orphan pages) scans. Defaults to the whole knowledge base; you can also pick specific top-level dirs — e.g. only wiki/, ignoring the conversation logs under raw/.',
    allDirs: 'All directories',
    noSubdirs: 'This knowledge base has no subdirectories yet.',

    // External tools — recommended catalog
    recommended: 'Recommended tools',
    recommendedDesc:
      'Nothing is built in: the agent can reach exactly what you check here. Every endpoint listed has been checked to work from a browser. Start with WebCLI — it fetches with your real Chrome session, so it also reaches sites that refuse browser scripts.',
    browseAll: 'Browse all →',
    backToTools: 'Tools',
    noneInstalled: 'Nothing installed yet — browse the recommended list to give the agent some reach.',
    noToolsHere: 'No tools reported. If this is an extension or a server, it may not be connected.',
    removeEntry: 'Remove',
    presetLockedHint:
      'This is a preset: its tools are defined by the app, so only the fields you have to supply are editable here.',
    extensionId: 'Chrome extension ID',
    serverUrl: 'Server URL',
    customToolsDesc:
      'One HTTP request each — a search, a lookup, an API you use. Describe what you need and the agent will build and test it, or write it yourself.',
    askAgent: 'Ask the agent',
    addManually: 'Add manually',
    serversDesc:
      'A separate program (MCP) that contributes a whole bundle of tools at once, rather than a single request.',
    addServer: '+ Add server',
    keys: 'Keys',
    keysDesc:
      'API keys the installed tools need. They stay in this browser and are never shown to the agent — a tool refers to a key by name, so the agent can tell you which one is missing without ever seeing its value.',
    getKey: 'Get one →',
    agentToolPrompt:
      'I need a new tool. Here is what it should do (which service, what I want back):\n\n',
    catalogFeatured: 'Start here',
    catalogNeedsWebcli: 'needs WebCLI',
    catalogNotConnected: 'not connected',
    catalogExtensionHint:
      'Added, but Chrome does not answer yet. Install/enable the extension, then use Reconnect below.',
    catalogLearnMore: 'Learn more →',
    catalog: {
      webcli: {
        title: 'WebCLI browser extension',
        desc: "Your logged-in Chrome as agent tools: open and read pages, click and type, search, and fetch any URL with your cookies — which also bypasses the CORS limit that blocks the browser from calling many APIs directly.",
      },
      jina: {
        title: 'Jina web tools (web_search, web_fetch)',
        desc: 'Keyless web search and page reading through Jina AI Reader. No login or cookies, so sign-in walls and heavy bot protection will fail — but it needs no install.',
      },
      research: {
        title: 'Research lookup (OpenAlex, Crossref, Europe PMC)',
        desc: 'Search papers by topic, turn a DOI into full metadata, and search biomedical literature. Keyless.',
      },
      reference: {
        title: 'Reference lookup (Wikipedia, Open Library)',
        desc: 'Search and read English Wikipedia articles, and look up books. Keyless.',
      },
      feeds: {
        title: 'Feeds (RSS, Atom)',
        desc: 'Read any RSS or Atom feed by URL and get recent items as a short list — for following a blog, journal or podcast into the knowledge base.',
      },
      arxiv: {
        title: 'arXiv preprints',
        desc: 'Search arXiv and get titles, authors, dates and abstracts. arXiv refuses browser requests, so this one needs the WebCLI extension above.',
      },
      zotero: {
        title: 'Zotero library',
        desc: 'Search your own Zotero references, with their notes and tags. Needs your user ID and an API key.',
      },
      deepwiki: {
        title: 'DeepWiki',
        desc: 'Ask questions about any public GitHub repository and get answers from generated documentation. No key.',
      },
      context7: {
        title: 'Context7 library docs',
        desc: 'Version-correct documentation for thousands of libraries and frameworks, instead of guesses from training data.',
      },
    },

    // KB-carried tools
    kbToolsTitle: 'This knowledge base carries tools',
    kbToolsDesc:
      'Its .agents/tools.json defines the tools below. They came with the folder, so they stay off until you approve them. Check where each one sends data first.',
    kbToolsApprove: 'Approve these tools',

    // Custom tools
    customTools: 'Your tools',
    newTool: '+ New tool',
    noCustomTools: 'No tools of your own yet. You can also just ask the agent to build one.',
    toolName: 'Name (as the agent calls it)',
    toolNameTaken: 'That name is already taken by another tool.',
    toolTransport: 'Send through',
    transportAuto: 'Auto (direct, then WebCLI)',
    transportDirect: 'Direct only',
    transportWebcli: 'WebCLI only',
    toolDescription: 'Description',
    toolDescriptionPlaceholder: 'What it does and when the agent should reach for it.',
    toolUrl: 'Request',
    toolUrlHelp:
      'Use {{param}} for a parameter and {{secret:id}} for a stored key. Must be https, and the host cannot contain a placeholder — a tool always talks to the server you approved.',
    toolParams: 'Parameters',
    addParam: '+ Add',
    paramDescription: 'What to pass (the agent reads this)',
    paramRequired: 'Required',
    toolHeaders: 'Headers (one per line)',
    toolBody: 'Body',
    toolResponse: 'Response',
    toolResponseHelp:
      'text returns the body as-is. json picks a list and renders each item with your template — do use it: a raw JSON payload can cost thousands of tokens per call.',
    toolSecretsNote: 'Uses stored keys: {ids}. Add their values above, on the entry that owns them.',
    toolTest: 'Test with:',
    toolRunTest: 'Run test',
    toolTesting: 'Running…',
    toolTestChars: 'Result: {n} characters — this is what the agent sees.',
    toolInvalid: 'Needs a name and an https URL.',

    connectedServers: 'Connected servers',
    reconnect: 'Reconnect',
    status: {
      off: 'Disabled',
      connecting: 'Connecting…',
      failed: 'Connection failed',
      nTools: '{n} tools',
    },
    kbServerTitle: "From the knowledge base's .agents/mcp.json — edit that file to change it",
    enable: 'Enable',
    disable: 'Disable (keep config)',
    noGlobalServers: 'No global tool servers yet.',
    editingServer: 'Editing “{name}”',
    namePlaceholder: 'Name',
    urlPlaceholder: 'https://…/mcp or Chrome extension ID',
    tokenPlaceholder: 'token (optional)',
    toolsHelp:
      'Servers must allow browser CORS; put a 32-char Chrome extension ID in the URL field to use the extension bridge. This is the global config; a knowledge base can also carry its own .agents/mcp.json (travels with git; on a duplicate target the KB wins; keep tokens here rather than in the file). Tools appear in the agent tool list as mcp__name__tool; results from external tools are treated as untrusted data.',

    // Git & GitHub
    commitAuthor: 'Commit author name',
    commitAuthorPlaceholder: '(defaults to the repo git config)',
    commitEmail: 'Commit email',
    githubToken: 'GitHub token (needed to push; not required to pull public repos)',
    githubTokenLink: 'Create a fine-grained token here ↗',
    githubHelp:
      ': set Repository access to Only select repositories (just your KB repo), Permissions → Contents to Read and write, then paste the github_pat_… into the field above. See the README “Git & GitHub sync” section for the full steps. Sync is fast-forward-only; resolve conflicts in the terminal.',
  },
  zh: {
    nav: {
      general: '通用',
      models: '模型',
      agent: 'Agent',
      hotkeys: '快捷键',
      health: 'KB 健康',
      tools: '外部工具',
      git: 'Git & GitHub',
    },
    privacyNote: 'API key 与 token 只存在本浏览器，直连服务商，不经其他服务器。',
    back: '返回',
    addProfile: '添加模型',
    editProfile: '编辑模型',

    // General
    language: '语言',
    languageDesc: '界面语言。agent 的回复也会跟随这个设置。',

    // Profile editor
    labelOptional: 'Label（可选）',
    maxTokensOptional: 'Max tokens（可选）',
    defaultPlaceholder: '默认',
    profileHelp:
      '选好 provider 后只需填 API key 和模型名——base URL 与接口适配由 SDK 内置。端点须允许浏览器（CORS）访问；连接失败时聊天区会给出提示。',

    // Models list
    profilesHeading: '模型 Profiles',
    noProfiles: '还没有配置模型 — 添加一个 API key 后 agent 才能工作。',
    badge: { primary: '主模型', vision: '视觉', image: '图像' },
    slotsHeading: '模型分工',
    slot: { primary: '主模型', vision: '视觉理解', image: '图像生成' },
    notConfigured: '未配置',
    visionHelp:
      'Claude 主模型天生多模态，无需配置视觉槽。OpenAI 兼容主模型：若它本身是多模态（如 qwen-vl、glm-4v、gpt-4o），视觉槽选它自己（图片直接进上下文）；若是纯文本模型（如 deepseek-chat），视觉槽指一个专门的视觉模型（agent 通过 view_image 工具调用它）。',
    imageHelp:
      '图像生成槽可选，配置后主模型可用 generate_image 工具作图（保存进知识库）。支持 OpenAI（DALL·E）、Google（Imagen）、xAI，以及 OpenAI 兼容的 /images/generations 端点（智谱 CogView、Qwen、自定义等）；模型名填对应的作图模型，端点须允许浏览器 CORS。',

    // Agent behavior
    writeMode: '写入模式',
    writeModeDesc:
      '先询问模式下，agent 的 write_file / edit_file / delete_path 会挂起，直到你在 Review 面板里 Approve 或 Reject。删除文件夹或二进制文件在两种模式下都会先询问——它们没有任何办法找回。改动后可在 “Agent changes” 面板查看被改的文件，是否提交、如何提交由你在 Git 面板自行决定。',
    writeAuto: '直接写入（事后审查）',
    writeAsk: '先询问（每次批准）',
    multiTab: '多标签页会话',
    multiTabDesc:
      '允许 agent 面板同时开多个会话标签；关闭时最多一个会话。运行中的会话，切换标签或关闭它的标签都不会中断——只有输入框的 stop 按钮、删除会话或关闭网页才会停止。',
    maxTabs: '最多标签数',

    // Hotkeys
    hotkeysHeading: '键盘快捷键',
    resetDefaults: '恢复默认',
    recordingHint: '按下新组合键，Esc 取消',
    recordHint: '点击后录制新键位',
    recording: '录制中…',
    resetOne: '重置为默认',
    hotkeysHelp:
      '点击右侧键位后按下新组合键（需含 ⌘/Ctrl）。⌘N、⌘M、⌘` 等被浏览器或系统占用时，改用 ⌥⌘N、⌥⌘M、⌃` 触发同一命令。改动即时保存。',
    needsModifier: '快捷键需配合 ⌘ 或 Ctrl',
    conflictsWith: '与「{label}」冲突，请换一个',

    // KB health scope
    healthScope: '检测范围',
    healthDesc:
      'KB 健康检查（断链、孤立页）扫描哪些目录。默认检测整个知识库；也可只选某些顶层目录，比如只查 wiki/、忽略 raw/ 里的对话记录。',
    allDirs: '全部目录',
    noSubdirs: '此知识库暂无子目录。',

    // External tools — recommended catalog
    recommended: '推荐工具',
    recommendedDesc:
      '没有任何内置工具：agent 能用什么，完全取决于你在这里勾选了什么。列出的每个服务都已实测可在浏览器中调用。建议从 WebCLI 开始 —— 它用你真实的 Chrome 会话发请求，因此也能访问那些拒绝浏览器脚本的接口。',
    browseAll: '查看全部 →',
    backToTools: '工具',
    noneInstalled: '还没装任何工具 —— 去推荐列表里挑几个，agent 才有能力可用。',
    noToolsHere: '没有报告任何工具。如果这是扩展或服务器，可能尚未连接。',
    removeEntry: '移除',
    presetLockedHint: '这是预设项：它的工具由应用定义，所以这里只能改你必须自己填的字段。',
    extensionId: 'Chrome 扩展 ID',
    serverUrl: '服务器 URL',
    customToolsDesc:
      '每个工具就是一次 HTTP 请求 —— 一次搜索、一次查询、你常用的某个 API。可以描述需求让 agent 帮你做好并测试，也可以自己写。',
    askAgent: '让 agent 来做',
    addManually: '手动添加',
    serversDesc: '一个独立的程序（MCP），一次性提供一整组工具，而不是单次请求。',
    addServer: '+ 添加服务器',
    keys: '密钥',
    keysDesc:
      '已安装工具所需的 API key。它们只保存在这个浏览器里，绝不会给到 agent —— 工具只按名字引用密钥，所以 agent 能告诉你缺哪一个，却看不到它的值。',
    getKey: '去获取 →',
    agentToolPrompt: '我需要一个新工具。它应该做的是（哪个服务、我想拿到什么）：\n\n',
    catalogFeatured: '首选',
    catalogNeedsWebcli: '需要 WebCLI',
    catalogNotConnected: '未连接',
    catalogExtensionHint: '已添加，但 Chrome 还没有响应。请先安装/启用该扩展，然后点下方的「重连」。',
    catalogLearnMore: '了解更多 →',
    catalog: {
      webcli: {
        title: 'WebCLI 浏览器扩展',
        desc: '把你已登录的 Chrome 变成 agent 的工具：打开并读取网页、点击输入、搜索，以及带着 cookie 抓取任意 URL —— 这同时绕开了让浏览器无法直连许多 API 的 CORS 限制。',
      },
      jina: {
        title: 'Jina 网页工具 (web_search、web_fetch)',
        desc: '通过 Jina AI Reader 实现免 key 的网页搜索与正文抓取。不带登录态和 cookie，登录墙和强反爬页面会失败，但无需安装任何东西。',
      },
      research: {
        title: '文献检索 (OpenAlex、Crossref、Europe PMC)',
        desc: '按主题检索论文、把 DOI 换成完整元数据、检索生物医学文献。免 key。',
      },
      reference: {
        title: '资料查询 (Wikipedia、Open Library)',
        desc: '检索并阅读英文维基百科条目，以及查询图书信息。免 key。',
      },
      feeds: {
        title: '订阅源 (RSS、Atom)',
        desc: '按 URL 读取任意 RSS/Atom 源，返回精简的最新条目列表 —— 用于把关注的博客、期刊、播客追进知识库。',
      },
      arxiv: {
        title: 'arXiv 预印本',
        desc: '检索 arXiv，返回标题、作者、日期和摘要。arXiv 拒绝浏览器直连，所以这一项需要上面的 WebCLI 扩展。',
      },
      zotero: {
        title: 'Zotero 文献库',
        desc: '检索你自己的 Zotero 文献（含笔记和标签）。需要填写 User ID 和 API key。',
      },
      deepwiki: {
        title: 'DeepWiki',
        desc: '针对任意公开 GitHub 仓库提问，从自动生成的文档中得到答案。免 key。',
      },
      context7: {
        title: 'Context7 库文档',
        desc: '获取数千个库和框架的版本正确的文档，而不是模型凭训练数据猜测。',
      },
    },

    // KB-carried tools
    kbToolsTitle: '这个知识库自带工具',
    kbToolsDesc:
      '它的 .agents/tools.json 定义了下列工具。它们是跟着文件夹一起来的，所以在你确认之前不会启用。请先看清每个工具会把数据发到哪里。',
    kbToolsApprove: '确认启用这些工具',

    // Custom tools
    customTools: '自定义工具',
    newTool: '+ 新建工具',
    noCustomTools: '还没有自定义工具。你也可以直接让 agent 帮你做一个。',
    toolName: '名称（agent 调用时使用）',
    toolNameTaken: '这个名称已被其他工具占用。',
    toolTransport: '请求通道',
    transportAuto: '自动（先直连，失败走 WebCLI）',
    transportDirect: '仅直连',
    transportWebcli: '仅 WebCLI',
    toolDescription: '描述',
    toolDescriptionPlaceholder: '这个工具做什么、agent 什么时候该用它。',
    toolUrl: '请求',
    toolUrlHelp:
      '用 {{参数名}} 插入参数，用 {{secret:id}} 插入已保存的密钥。必须是 https，且域名部分不能含占位符 —— 工具只会访问你确认过的那台服务器。',
    toolParams: '参数',
    addParam: '+ 添加',
    paramDescription: '该传什么（agent 会读这段）',
    paramRequired: '必填',
    toolHeaders: '请求头（每行一条）',
    toolBody: '请求体',
    toolResponse: '响应处理',
    toolResponseHelp:
      'text 原样返回响应体。json 会取出一个列表并用你的模板渲染每一项 —— 建议用它：原始 JSON 一次调用就可能消耗几千 token。',
    toolSecretsNote: '使用了已保存的密钥：{ids}。请在上方拥有它们的条目里填写。',
    toolTest: '测试参数：',
    toolRunTest: '运行测试',
    toolTesting: '运行中…',
    toolTestChars: '结果 {n} 个字符 —— 这就是 agent 看到的内容。',
    toolInvalid: '需要填写名称和 https URL。',

    connectedServers: '已连接的服务器',
    reconnect: '重连',
    status: {
      off: '已停用',
      connecting: '连接中…',
      failed: '连接失败',
      nTools: '{n} 个工具',
    },
    kbServerTitle: '来自知识库的 .agents/mcp.json — 编辑该文件修改',
    enable: '启用',
    disable: '停用（保留配置）',
    noGlobalServers: '还没有全局工具服务器。',
    editingServer: '正在编辑「{name}」',
    namePlaceholder: '名称',
    urlPlaceholder: 'https://…/mcp 或 Chrome 扩展 ID',
    tokenPlaceholder: 'token（可选）',
    toolsHelp:
      '服务器必须允许浏览器 CORS；URL 栏填 32 位 Chrome 扩展 ID 则走扩展桥接。这里是全局配置；知识库还可以自带 .agents/mcp.json（随 git 走，重复目标以 KB 为准，token 建议只放这里不放文件）。工具以 mcp__名称__工具 出现在 agent 工具列表；外部工具的结果按不可信数据处理。',

    // Git & GitHub
    commitAuthor: 'Commit 作者名',
    commitAuthorPlaceholder: '（默认读仓库 git config）',
    commitEmail: 'Commit 邮箱',
    githubToken: 'GitHub Token（push 需要；pull 公开仓库可不填）',
    githubTokenLink: '点这里创建 Fine-grained token ↗',
    githubHelp:
      '：Repository access 选 Only select repositories（只勾知识库仓库），Permissions → Contents 设为 Read and write，生成后把 github_pat_… 粘贴到上面。详细步骤见 README「Git 与 GitHub 同步」。同步 fast-forward-only，冲突时回终端处理。',
  },
}
