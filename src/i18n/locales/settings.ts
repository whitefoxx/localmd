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
      licence: 'Licence',
    },
    privacyNote: 'API keys and tokens stay in this browser only — sent straight to the provider, never through any other server.',
    back: 'Back',
    addProfile: 'Add model',
    editProfile: 'Edit model',

    // General
    language: 'Language',
    languageDesc:
      'Interface language. The assistant answers in whatever language you write to it in — this is only what it falls back to when your message gives it nothing to go on.',
    appearance: 'Appearance',
    appearanceDesc:
      'Colour scheme. “System” follows your operating system. The theme icon at the bottom of the icon bar switches the same setting.',

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
      'In ask mode, every write, edit and delete pauses the conversation on an approval card in the chat — the diff and the Approve/Reject buttons are right there, and the agent waits for your click. Deleting a folder or a binary file asks in BOTH modes — nothing can bring those back. Files already changed can be reviewed in the “Agent changes” panel; whether and how to commit is up to you in the Git panel.',
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
      'A short list on purpose — these are the ones almost everyone wants, checked to work from a browser. For anything else, tell the assistant what you want to reach and it will set it up with you; there is no list to wait for.',
    connectTitle: 'Connect something',
    connectDesc:
      "Say what you want the agent to reach — a reading app, an API, a service you use. It will look up how that service works, build and test the tools, and ask you for anything only you can give (a key, an extension).",
    connectAction: 'Describe it to the agent',
    basics: 'The basics',
    installed: 'Installed',
    installedDesc:
      'Everything the agent can reach right now — one row per integration. Open one to see the tools inside it.',
    sourcePreset: 'Preset',
    sourceYours: 'Yours',
    sourceKb: 'KB',
    kindExtension: 'Extension',
    browseAll: 'Browse recommended →',
    backToTools: 'Tools',
    noneInstalled: 'Nothing installed yet — switch one of the basics on above, or ask the assistant for something else.',
    noToolsHere: 'No tools reported. If this is an extension or a server, it may not be connected.',
    removeEntry: 'Remove',
    presetLockedHint:
      'This is a preset: its tools are defined by the app, so only the fields you have to supply are editable here.',
    installFromStore: 'Install from the Chrome Web Store →',
    serverUrl: 'Server URL',
    signIn: 'Sign in',
    signOut: 'Sign out',
    signingIn: 'Waiting for sign-in…',
    checkChecking: 'Checking…',
    checkOk: 'Connected — it answered just now.',
    checkFailed: 'Still not connected.',
    webcli: {
      connected: 'Connected — WebCLI is answering this site.',
      notDetected:
        'We cannot see WebCLI on this page — it is not installed, or this site is not on its list, or it was installed/enabled/allowed after this page was opened. Only reloading can change any of those: the extension attaches to a page as it loads, and never afterwards.',
      extension: 'Extension {id}',
      setupNeeded: 'Setup needed',
      setupTitle: 'Let WebCLI talk to this site',
      setupIntro:
        'WebCLI only answers sites you have allowed, so this takes two steps rather than one — install it, then add this site to its list.',
      presentButSilent:
        'WebCLI is on this page but is not answering it — so the address below is not the one in its list. Check the port: it counts, and it is the usual culprit.',
      step1: 'Install the extension, if you have not already.',
      step2: 'Click its toolbar icon → “Web app access” → add this address, exactly as shown (the port is part of it):',
      step3:
        'Reload this page. The extension only starts listening on pages opened after you add them, so this last step is what finishes it.',
      reload: 'Reload this page',
      recheck: 'Check again',
    },
    advanced: 'Advanced',
    advancedDesc: 'Build an integration by hand, if you would rather not have the agent do it.',
    customToolsDesc:
      'A tool is one HTTP request — URL template, parameters, and how to shape the response. The agent can build these for you; this editor is for doing it by hand.',
    addManually: 'Write a tool by hand',
    newToolTitle: 'New tool',
    editToolTitle: 'Edit tool',
    serversDesc:
      'A separate program (MCP) that contributes a whole bundle of tools at once, rather than a single request.',
    addServer: 'Add an MCP server',
    newServerTitle: 'New MCP server',
    editServerTitle: 'Edit MCP server',
    keys: 'Keys',
    keysDesc:
      'API keys the installed tools need. They stay in this browser and are never shown to the agent — a tool refers to a key by name, so the agent can tell you which one is missing without ever seeing its value.',
    getKey: 'Get one →',
    keyUsedBy: 'Read by {tools}',
    agentToolPrompt:
      'I need a new tool. Here is what it should do (which service, what I want back):\n\n',
    catalogFeatured: 'Start here',
    catalogNeedsWebcli: 'needs WebCLI',
    catalogNotConnected: 'not connected',
    catalogLearnMore: 'Learn more →',
    catalogRepo: 'Docs and source on GitHub',
    catalog: {
      webcli: {
        title: 'WebCLI browser extension',
        desc: "Your logged-in Chrome as agent tools: open and read pages, click and type, search, and fetch any URL with your cookies — which also bypasses the CORS limit that blocks the browser from calling many APIs directly. Official extension, one click from the Chrome Web Store; after installing, add this site under “Web app access” in its popup, because it only answers sites you allow.",
      },
      jina: {
        title: 'Jina web tools (web_search, web_fetch)',
        desc: 'Keyless web search and page reading through Jina AI Reader. Light, quick answers, and the only web access that keeps working when a server connection does not. No login or cookies, so sign-in walls and heavy bot protection will fail.',
      },
      parallel: {
        title: 'Parallel web search',
        desc: 'Web search and page extraction built for agents, keyless. Takes what you are trying to find out rather than just keywords, and returns long quotable excerpts — better answers than the Jina pack, and a fair slice of the conversation to hold them.',
      },
    },

    helpLink: 'How tools work, and where they are stored →',

    // KB-carried tools
    kbToolsTitle: 'This knowledge base carries tools',
    kbToolsDesc:
      'Its .agents/tools.json defines the tools below. They came with the folder, so they stay off until you approve them. Check where each one sends data first.',
    kbToolsApprove: 'Approve these tools',
    kbToolsUsesKeys: 'reads your saved key: {ids}',

    // Custom tools
    kbToolHint: "Defined by this knowledge base's .agents/tools.json — ask the agent to change or remove it.",
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

    reconnect: 'Reconnect',
    status: {
      off: 'Disabled',
      connecting: 'Connecting…',
      failed: 'Connection failed',
      nTools: '{n} tools',
      oneTool: '1 tool',
    },
    kbServerTitle: "From the knowledge base's .agents/mcp.json — edit that file to change it",
    enable: 'Enable',
    disable: 'Disable (keep config)',
    editingServer: 'Editing “{name}”',
    namePlaceholder: 'Name',
    urlPlaceholder: 'https://…/mcp',
    serverUrlInvalid: 'Needs an http(s) address — this field takes an MCP endpoint.',
    tokenPlaceholder: 'token (optional)',
    serverViaWebcli: 'Reach it through WebCLI',
    serverViaWebcliHint:
      "Turn this on when the server won't talk to a web page. Most hosted MCP servers refuse browsers outright; WebCLI fetches on this page's behalf and is not bound by that.",
    serverViaWebcliMissing: 'WebCLI is not connected — this server cannot start until it is.',
    toolsHelp:
      'A server reached directly must allow browser CORS; one reached through WebCLI need not. This is the global config; a knowledge base can also carry its own .agents/mcp.json (travels with git; on a duplicate target the KB wins; keep tokens here rather than in the file). Tools appear in the agent tool list as mcp__name__tool; results from external tools are treated as untrusted data.',

    // Git & GitHub
    commitAuthor: 'Commit author name',
    commitAuthorPlaceholder: '(defaults to the repo git config)',
    commitEmail: 'Commit email',
    githubToken: 'GitHub token (needed to push; not required to pull public repos)',
    githubTokenLink: 'Create a fine-grained token here ↗',
    githubHelp:
      ': set Repository access to Only select repositories (just your KB repo), Permissions → Contents to Read and write, then paste the github_pat_… into the field above. See the README “Git & GitHub sync” section for the full steps. Sync is fast-forward-only; resolve conflicts in the terminal.',

    // Licence
    licenceKeyLabel: 'Licence key',
    licencePlaceholder: 'LMD1.…',
    licenceCovers:
      'Everything else is free and always will be — web search, subagents, your own skills, and local git included. A licence covers what reaches past your folder and your model: the WebCLI browser extension, MCP servers, tools built against outside services, and syncing with GitHub.',
    licenceOffline:
      'Checked here in your browser, against a key built into the app. Nothing is sent anywhere, and there is no account.',
    licenceNone: 'No licence. The features above are locked.',
    licenceNoneYet: 'No licence — and nothing is locked yet, because the paid tier is not live.',
    licenceValid: 'Active — thank you.',
    licenceValidUntil: 'Active · {days} days left',
    licenceLastDay: 'Active · last day',
    licenceExpired: 'This licence ran out on {date}. Nothing in your folder changed.',
    licenceBad: "This key isn't valid. Check for a truncated paste — a key is one long line.",
    licenceUnverifiable: 'Could not check this key ({reason}). This is our problem, not yours — nothing is wrong with your key.',
    licenceRemove: 'Remove',
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
      licence: '许可',
    },
    privacyNote: 'API key 与 token 只存在本浏览器，直连服务商，不经其他服务器。',
    back: '返回',
    addProfile: '添加模型',
    editProfile: '编辑模型',

    // General
    language: '语言',
    languageDesc:
      '界面语言。助手用你跟它说话的语言回答——这个设置只是在你的消息无从判断时的兜底。',
    appearance: '外观',
    appearanceDesc: '配色方案。「跟随系统」跟着操作系统走。图标栏底部的主题图标切换的是同一个设置。',

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
      '先询问模式下，每次写入、修改、删除都会让对话停在聊天里的一张确认卡片上——改动对照和「批准 / 拒绝」按钮就在原地，agent 会一直等你点。删除文件夹或二进制文件在两种模式下都会先询问——它们没有任何办法找回。已写入的改动可在 “Agent changes” 面板查看，是否提交、如何提交由你在 Git 面板自行决定。',
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
      '这个列表故意做得很短 —— 只放几乎人人都要、而且实测能从浏览器访问的。别的想接什么，直接告诉助手，它会带着你装好，不用等我们收录。',
    connectTitle: '接入一个服务',
    connectDesc:
      '说出你想让 agent 够到什么 —— 一个阅读应用、一个 API、你常用的某个服务。它会去查这个服务怎么用，建好工具并测通，需要你提供的东西（密钥、扩展）会来问你。',
    connectAction: '描述给 agent',
    basics: '基础能力',
    installed: '已安装',
    installedDesc: '当前 agent 能用到的全部能力，一行一个集成。点开可以看到里面具体有哪些工具。',
    sourcePreset: '预设',
    sourceYours: '你的',
    sourceKb: 'KB',
    kindExtension: '扩展',
    browseAll: '浏览推荐 →',
    backToTools: '工具',
    noneInstalled: '还没装任何工具 —— 去推荐列表里挑几个，agent 才有能力可用。',
    noToolsHere: '没有报告任何工具。如果这是扩展或服务器，可能尚未连接。',
    removeEntry: '移除',
    presetLockedHint: '这是预设项：它的工具由应用定义，所以这里只能改你必须自己填的字段。',
    installFromStore: '去 Chrome 应用商店安装 →',
    serverUrl: '服务器 URL',
    signIn: '登录',
    signOut: '退出登录',
    signingIn: '等待登录…',
    checkChecking: '检测中…',
    checkOk: '已连接 —— 刚刚响应了。',
    checkFailed: '仍未连上。',
    webcli: {
      connected: '已连接 —— WebCLI 正在响应本站。',
      notDetected:
        '本页上看不到 WebCLI —— 可能是没安装、本站不在它的名单里，也可能是安装/启用/授权发生在本页打开之后。这三种都只有刷新才能改变：扩展是在页面加载的那一刻附着上去的，之后就不会了。',
      extension: '扩展 {id}',
      setupNeeded: '需要设置',
      setupTitle: '允许 WebCLI 与本站通信',
      setupIntro:
        'WebCLI 只响应你允许过的站点，所以这里有两步而不是一步 —— 先安装它，再把本站加进它的名单。',
      presentButSilent:
        'WebCLI 就在本页上，但不响应本页 —— 说明下面这个地址不是它名单里的那个。检查端口：端口算在内，而且十次有九次是它。',
      step1: '如果还没装，先安装扩展。',
      step2: '点它的工具栏图标 →「Web app access」→ 按下面显示的地址原样添加（端口也算在内）：',
      step3:
        '刷新本页。扩展只会监听添加之后才打开的页面，所以这最后一步才是真正生效的一步。',
      reload: '刷新本页',
      recheck: '重新检测',
    },
    advanced: '高级',
    advancedDesc: '手动搭一个集成 —— 如果你不想让 agent 代劳的话。',
    customToolsDesc:
      '一个工具就是一次 HTTP 请求 —— URL 模板、参数、响应怎么裁剪。这些 agent 都能帮你生成；这个编辑器用于手写。',
    addManually: '手动写一个工具',
    newToolTitle: '新建工具',
    editToolTitle: '编辑工具',
    serversDesc: '一个独立的程序（MCP），一次性提供一整组工具，而不是单次请求。',
    addServer: '添加 MCP 服务器',
    newServerTitle: '新建 MCP 服务器',
    editServerTitle: '编辑 MCP 服务器',
    keys: '密钥',
    keysDesc:
      '已安装工具所需的 API key。它们只保存在这个浏览器里，绝不会给到 agent —— 工具只按名字引用密钥，所以 agent 能告诉你缺哪一个，却看不到它的值。',
    getKey: '去获取 →',
    keyUsedBy: '被这些工具读取：{tools}',
    agentToolPrompt: '我需要一个新工具。它应该做的是（哪个服务、我想拿到什么）：\n\n',
    catalogFeatured: '首选',
    catalogNeedsWebcli: '需要 WebCLI',
    catalogNotConnected: '未连接',
    catalogLearnMore: '了解更多 →',
    catalogRepo: 'GitHub 上的文档与源码',
    catalog: {
      webcli: {
        title: 'WebCLI 浏览器扩展',
        desc: '把你已登录的 Chrome 变成 agent 的工具：打开并读取网页、点击输入、搜索，以及带着 cookie 抓取任意 URL —— 这同时绕开了让浏览器无法直连许多 API 的 CORS 限制。官方扩展，Chrome 应用商店一键安装；装好后还要在它的弹窗里「Web app access」添加本站，因为它只响应你允许过的站点。',
      },
      jina: {
        title: 'Jina 网页工具 (web_search、web_fetch)',
        desc: '通过 Jina AI Reader 实现免 key 的网页搜索与正文抓取。不带登录态和 cookie，登录墙和强反爬页面会失败，但无需安装任何东西。',
      },
      parallel: {
        title: 'Parallel 联网搜索',
        desc: '为 agent 做的联网搜索和网页提取，免 key。比上面的 Jina 更强 —— 它接收的是「你想查清什么」而不只是关键词 —— 返回的摘录长且可直接引用，所以会占掉对话里不小的一块。',
      },
    },

    helpLink: '工具是怎么回事、都存在哪里 →',

    // KB-carried tools
    kbToolsTitle: '这个知识库自带工具',
    kbToolsDesc:
      '它的 .agents/tools.json 定义了下列工具。它们是跟着文件夹一起来的，所以在你确认之前不会启用。请先看清每个工具会把数据发到哪里。',
    kbToolsApprove: '确认启用这些工具',
    kbToolsUsesKeys: '会读取你已保存的密钥：{ids}',

    // Custom tools
    kbToolHint: '由这个知识库的 .agents/tools.json 定义 —— 要改或删，跟 agent 说。',
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

    reconnect: '重连',
    status: {
      off: '已停用',
      connecting: '连接中…',
      failed: '连接失败',
      nTools: '{n} 个工具',
      oneTool: '1 个工具',
    },
    kbServerTitle: '来自知识库的 .agents/mcp.json — 编辑该文件修改',
    enable: '启用',
    disable: '停用（保留配置）',
    editingServer: '正在编辑「{name}」',
    namePlaceholder: '名称',
    urlPlaceholder: 'https://…/mcp',
    serverUrlInvalid: '需要一个 http(s) 地址 —— 这里填的是 MCP 端点。',
    tokenPlaceholder: 'token（可选）',
    serverViaWebcli: '通过 WebCLI 连接',
    serverViaWebcliHint:
      '当这个服务器不接受网页直接访问时打开它。大多数托管的 MCP 服务器都直接拒绝浏览器；WebCLI 会代替本页去取，不受这条限制。',
    serverViaWebcliMissing: 'WebCLI 未连接 —— 在它连上之前这个服务器起不来。',
    toolsHelp:
      '直连的服务器必须允许浏览器 CORS，走 WebCLI 的则不需要。这里是全局配置；知识库还可以自带 .agents/mcp.json（随 git 走，重复目标以 KB 为准，token 建议只放这里不放文件）。工具以 mcp__名称__工具 出现在 agent 工具列表；外部工具的结果按不可信数据处理。',

    // Git & GitHub
    commitAuthor: 'Commit 作者名',
    commitAuthorPlaceholder: '（默认读仓库 git config）',
    commitEmail: 'Commit 邮箱',
    githubToken: 'GitHub Token（push 需要；pull 公开仓库可不填）',
    githubTokenLink: '点这里创建 Fine-grained token ↗',
    githubHelp:
      '：Repository access 选 Only select repositories（只勾知识库仓库），Permissions → Contents 设为 Read and write，生成后把 github_pat_… 粘贴到上面。详细步骤见 README「Git 与 GitHub 同步」。同步 fast-forward-only，冲突时回终端处理。',

    // Licence
    licenceKeyLabel: '许可 key',
    licencePlaceholder: 'LMD1.…',
    licenceCovers:
      '其余部分永远免费 —— 网页搜索、子 agent、你自己的 skill、本机 git 都在内。许可覆盖的是伸到你的文件夹和你的模型之外的那些：WebCLI 浏览器扩展、MCP server、针对外部服务造的工具，以及跟 GitHub 同步。',
    licenceOffline: '就在你的浏览器里校验，对照应用里内置的一把公钥。不会发往任何地方，也没有账号。',
    licenceNone: '没有许可，上面这些功能处于锁定状态。',
    licenceNoneYet: '没有许可 —— 但目前什么都没锁，因为付费层还没上线。',
    licenceValid: '已激活 —— 谢谢。',
    licenceValidUntil: '已激活 · 还剩 {days} 天',
    licenceLastDay: '已激活 · 今天是最后一天',
    licenceExpired: '这个许可已于 {date} 到期。你文件夹里的东西没有任何变化。',
    licenceBad: '这串 key 无效。先看看是不是粘贴时被截断了 —— 一个 key 是完整的一行。',
    licenceUnverifiable: '没能校验这串 key（{reason}）。这是我们这边的问题，不是你的 key 有问题。',
    licenceRemove: '移除',
  },
}
