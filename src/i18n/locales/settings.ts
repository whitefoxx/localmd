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
    discardProfile:
      'This model has not been saved — it still needs an API key and a model name. Discard what you entered?',

    // General
    language: 'Language',
    languageDesc:
      'Interface language. The assistant answers in whatever language you write to it in — this is only what it falls back to when your message gives it nothing to go on.',
    appearance: 'Appearance',
    appearanceDesc:
      'Colour scheme. “System” follows your operating system. The theme icon at the bottom of the icon bar switches the same setting.',
    richEditor: 'Live rendering while editing',
    richEditorDesc:
      'Show headings at their size, hide the markdown symbols, and draw images, formulas and task boxes in place. The line your cursor is on always shows the plain text, so you edit exactly what is in the file. Turn this off to see the raw markdown everywhere.',

    // Profile editor
    labelOptional: 'Label (optional)',
    maxTokensOptional: 'Longest reply (optional)',
    maxTokensHelp: 'How much the model may write in one answer. Leave it empty for {n}.',
    reasoningOptional: 'Thinking effort (optional)',
    reasoning: {
      none: 'Off',
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      xhigh: 'Very high',
    },
    reasoningHelp:
      'How long the model thinks before it answers. Less is faster and cheaper; more is worth it for multi-step work. Left at Default the provider decides, and a model that cannot think ignores it.',
    defaultPlaceholder: 'Default',
    profileHelp:
      'Pick a provider, paste its API key and the model name. The key stays in this browser and goes straight to that provider. A model on your own machine works too.',
    baseUrlHelp:
      'The API root, not one of its endpoints — /chat/completions and /images/generations are added for you.',
    baseUrlResolved: 'A chat request goes to',
    capabilities: 'What it can do',
    capability: { chat: 'Chat', vision: 'Reads images', image: 'Generates images' },
    capabilitiesHelp:
      'Which roles below may point at this model. Ticked to match the provider when you added it — correct it if your model does more, or less.',

    // Models list
    profilesHeading: 'Model profiles',
    noProfiles:
      'No models yet. Add a key from any provider — it stays in this browser and goes straight to them, never through us.',
    badge: { primary: 'Primary', vision: 'Vision', image: 'Image' },
    slotsHeading: 'Model roles',
    slot: { primary: 'Primary', vision: 'Vision', image: 'Image generation' },
    notConfigured: 'Not set',
    notMarkedFor: 'Not marked for this',
    markConfirm: {
      chat: '“{label}” is not marked as a chat model. Use it as the primary anyway, and mark it?',
      vision: '“{label}” is not marked as reading images. Use it for this role anyway, and mark it?',
      image: '“{label}” is not marked as generating images. Use it for this role anyway, and mark it?',
    },
    visionHelp:
      'Leave empty if your primary model already reads pictures — most do. If it does not, point this at one that does and the agent will use it whenever something needs looking at.',
    imageHelp:
      'Optional. Set it and the agent can make pictures and save them into your knowledge base.',

    // Agent behavior
    writeMode: 'Write mode',
    writeModeDesc:
      'In ask mode every write, edit and delete stops in the chat, shows exactly what would change, and waits for your click. Deleting a folder, or a picture, video or PDF, asks in both modes — nothing brings those back. Either way, what did change is listed in the “Agent changes” panel.',
    writeAuto: 'Write directly (review afterward)',
    writeAsk: 'Ask first (approve each time)',
    multiTab: 'Multi-tab chats',
    multiTabDesc:
      'Let the agent panel hold several chat tabs at once; off means a single chat. A running chat is not interrupted by switching or closing its tab — only the stop button, deleting the chat, or closing the page stops it.',
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
      "What the health check skips. 'raw/' skips that folder and everything in it, 'AGENTS.md' skips that name wherever it sits, and '*' stands for part of a name. Everything else is checked.",
    ignorePlaceholder: 'Search files and folders to ignore…',
    ignoreAddPattern: 'Ignore “{pattern}” as a pattern',
    ignoredHeading: 'Ignored ({n})',
    ignoredRow: 'Skipped by the health check: {pattern}',
    ignoreReset: 'Reset to defaults',
    ignoreEmpty: 'Nothing ignored — the whole knowledge base is scanned.',
    ignoreRemove: 'Stop ignoring',

    // External tools — recommended catalog
    recommended: 'Recommended tools',
    bundledGroup: 'Bundled tools',
    priceFree: 'Free',
    pricePaid: 'Paid',
    bundledDesc:
      'These ship with the app and cost nothing, ever. Today that is web search and page reading; the set can grow.',
    connectionsGroup: 'Connections',
    connectionsDesc:
      'Anything that reaches a service outside this browser.',
    connectionsLicence: 'One licence covers all of it.',
    connectionsLocked: 'Adding and using connections needs a licence —',
    rowNeedsLicence: 'Needs a licence',
    connectTitle: 'Connect something',
    connectDesc:
      "Say what you want the agent to reach — a reading app, an API, a service you use. It will look up how that service works, build and test the tools, and ask you for anything only you can give (a key, an extension).",
    connectAction: 'Describe it to the agent',
    installed: 'Installed',
    installedDesc:
      'Everything the agent can reach right now — one row per integration. Open one to see the tools inside it.',
    sourcePreset: 'Preset',
    sourceYours: 'Yours',
    sourceKb: 'KB',
    kindExtension: 'Extension',
    backToTools: 'Tools',
    noneInstalled: 'Nothing installed yet — switch something on above, or ask the assistant for what you want to reach.',
    noToolsHere: 'No tools reported. If this is an extension or a server, it may not be connected.',
    removeEntry: 'Remove',
    presetLockedHint:
      'This is a preset: its tools are defined by the app, so only the fields you have to supply are editable here.',
    serverUrl: 'Server URL',
    signIn: 'Sign in',
    signOut: 'Sign out',
    signingIn: 'Waiting for sign-in…',
    checkChecking: 'Checking…',
    checkOk: 'Connected — it answered just now.',
    checkFailed: 'Still not connected.',
    lmdConnect: {
      setupNeeded: 'Setup needed',
      setupOpen: 'Open setup for this extension',
      reload: 'Reload this page',
      recheck: 'Check again',
      connected: 'Connected — localmd Connect is answering this site.',
      notDetected:
        'Not answering on this page — it may not be installed or enabled, or that changed after the page loaded. The extension attaches to a page as it loads, so reload after installing.',
      extension: 'Extension {id}',
      presentButSilent:
        'It is on this page but not answering it. Reload; if that does not help, check it is enabled here.',
      setupTitle: 'Set up localmd Connect',
      step1: 'Install it, then reload this page.',
      storeLink: 'Chrome Web Store →',
      stepScripts:
        'Optional: turn on “Allow user scripts” in its popup — only marketplace func adapters and site scripts need it.',
      confirmNote:
        'Anything that could change a real site asks first, on a card in the chat. Site scripts can be paused or removed in the extension popup.',
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
      'Keys the tools you installed need. They stay in this browser and are never shown to the agent — it knows a key by name only, so it can tell you which one is missing without seeing it.',
    getKey: 'Get one →',
    keyUsedBy: 'Read by {tools}',
    agentToolPrompt:
      'I need a new tool. Here is what it should do (which service, what I want back):\n\n',
    catalogFeatured: 'Start here',
    catalogNotConnected: 'not connected',
    catalogLearnMore: 'Learn more →',
    catalogRepo: 'Docs and source on GitHub',
    catalog: {
      'localmd-connect': {
        title: 'localmd Connect browser extension',
        desc: 'Your logged-in Chrome as agent tools: read pages, click and type, search, and open sites you are signed in to — including the many that a web page cannot reach on its own. Plus ~300 ready-made site adapters (Twitter, Zhihu, Reddit, YouTube, …) and site scripts that fix a page on every visit. Anything that posts to a real site or injects code asks you first.',
      },
      jina: {
        title: 'Jina web tools (web_search, web_fetch)',
        desc: 'Keyless web search and page reading through Jina AI Reader. Light, quick answers, and the only web access that keeps working when a server connection does not. No login or cookies, so sign-in walls and heavy bot protection will fail.',
      },
      parallel: {
        title: 'Parallel web search',
        desc: 'Web search and page extraction built for agents, keyless. Takes what you are trying to find out rather than just keywords, and returns long quotable excerpts — better answers than the Jina pack, and a fair slice of the chat to hold them.',
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
    transportAuto: 'Auto (direct, then the browser extension)',
    transportDirect: 'Direct only',
    transportExtension: 'Browser extension only',
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
    serverViaExtension: 'Reach it through the browser extension',
    serverViaExtensionHint:
      "Turn this on when the server won't talk to a web page. Most hosted MCP servers refuse browsers outright; the browser extension (localmd Connect) fetches on this page's behalf and is not bound by that.",
    serverViaExtensionMissing:
      'No browser extension is connected — this server cannot start until localmd Connect is.',
    toolsHelp:
      'Some servers refuse to answer a web page directly; those work through the browser extension instead. This is the global list — a knowledge base can also carry its own in .agents/mcp.json, which travels with it (keep tokens here, not in that file). Whatever a server returns is treated as untrusted.',

    // Git & GitHub
    gitHeading: 'Version history for your folder',
    gitDesc:
      'Optional. Turn the folder into a git repository and every change becomes a point you can go back to — the app commits from the git panel, and nothing is sent anywhere by doing so. Add a GitHub token as well and the same panel can push and pull, which is how a knowledge base moves between machines, or gets a backup that is not this browser.',
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
      'Everything else is free and always will be — web search, subagents, your own skills, and local git included. A licence covers what reaches past your folder and your model: the localmd Connect browser extension, MCP servers, tools built against outside services, and syncing with GitHub.',
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
    licenceHolder: 'Licensed to {to} — the name is part of the key itself.',
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
    discardProfile: '这个模型还没保存——它还缺 API key 和模型名。要丢弃已填的内容吗？',

    // General
    language: '语言',
    languageDesc:
      '界面语言。助手用你跟它说话的语言回答——这个设置只是在你的消息无从判断时的兜底。',
    appearance: '外观',
    appearanceDesc: '配色方案。「跟随系统」跟着操作系统走。图标栏底部的主题图标切换的是同一个设置。',
    richEditor: '编辑时实时渲染',
    richEditorDesc:
      '标题按级别显示字号，markdown 符号隐藏起来，图片、公式和任务框就地画出来。光标所在的那一行永远显示纯文本，所以你改的就是文件里的东西。关掉它则处处显示原始 markdown。',

    // Profile editor
    labelOptional: 'Label（可选）',
    maxTokensOptional: '单次回复上限（可选）',
    maxTokensHelp: '模型一次回答最多能写多少。留空就是 {n}。',
    reasoningOptional: '思考强度（可选）',
    reasoning: {
      none: '关闭',
      minimal: '极低',
      low: '低',
      medium: '中',
      high: '高',
      xhigh: '很高',
    },
    reasoningHelp:
      '模型回答前思考多久。想得少更快也更便宜；多步骤的活儿值得想久一点。留在「默认」就由厂商决定，不会思考的模型会忽略它。',
    defaultPlaceholder: '默认',
    profileHelp:
      '选好厂商，填上 API key 和模型名。key 只存在这个浏览器里，直接发给该厂商。跑在你自己机器上的模型也可以。',
    baseUrlHelp: '填 API 根地址，不要填具体端点 —— /chat/completions 和 /images/generations 会自动接上。',
    baseUrlResolved: '对话请求会发到',
    capabilities: '这个模型能做什么',
    capability: { chat: '对话', vision: '能看图', image: '能生图' },
    capabilitiesHelp:
      '下面哪些角色可以指向这个模型。添加时按厂商默认勾好了——如果你的模型能做的更多或更少，在这里改。',

    // Models list
    profilesHeading: '模型 Profiles',
    noProfiles:
      '还没有模型。加一个任意厂商的 key —— 它只存在这个浏览器里，直接发给厂商，不经过我们。',
    badge: { primary: '主模型', vision: '视觉', image: '图像' },
    slotsHeading: '模型分工',
    slot: { primary: '主模型', vision: '视觉理解', image: '图像生成' },
    notConfigured: '未配置',
    notMarkedFor: '未标记为可做这件事',
    markConfirm: {
      chat: '「{label}」没有标记为对话模型。仍然把它设为主模型，并标记上吗？',
      vision: '「{label}」没有标记为能看图。仍然用它填这个角色，并标记上吗？',
      image: '「{label}」没有标记为能生图。仍然用它填这个角色，并标记上吗？',
    },
    visionHelp:
      '主模型本来就能看图就留空 —— 多数都能。不能看图的话，指向一个能看图的模型，需要看图时 agent 会去用它。',
    imageHelp: '可选。配好之后 agent 就能生成图片并存进知识库。',

    // Agent behavior
    writeMode: '写入模式',
    writeModeDesc:
      '「先询问」模式下，每次写入、修改、删除都会停在聊天里，把要改什么摆给你看，等你点确认。删除文件夹，或者图片、视频、PDF，两种模式下都会先问——那些删了找不回来。无论哪种模式，改过什么都列在 “Agent changes” 面板里。',
    writeAuto: '直接写入（事后审查）',
    writeAsk: '先询问（每次批准）',
    multiTab: '多标签页对话',
    multiTabDesc:
      '允许 agent 面板同时开多个对话标签；关闭时最多一个对话。运行中的对话，切换标签或关闭它的标签都不会中断——只有输入框的 stop 按钮、删除对话或关闭网页才会停止。',
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
      '健康检查跳过哪些内容。「raw/」跳过整个目录；「AGENTS.md」跳过任意位置的同名文件；「*」代表名字里的一段。其余都会检查。',
    ignorePlaceholder: '搜索要忽略的文件或目录……',
    ignoreAddPattern: '把「{pattern}」作为规则加入',
    ignoredHeading: '已忽略（{n}）',
    ignoredRow: '健康检查会跳过：{pattern}',
    ignoreReset: '恢复默认',
    ignoreEmpty: '没有忽略任何内容——整个知识库都会被检测。',
    ignoreRemove: '取消忽略',

    // External tools — recommended catalog
    recommended: '推荐工具',
    bundledGroup: '自带工具',
    priceFree: '免费',
    pricePaid: '付费',
    bundledDesc: '随应用附带，永远不收费。目前是网页搜索和读网页；这个集合以后会变多。',
    connectionsGroup: '外部接入',
    connectionsDesc: '所有连到这个浏览器之外的服务的能力。',
    connectionsLicence: '一份许可全都涵盖。',
    connectionsLocked: '添加和使用外部接入需要许可 ——',
    rowNeedsLicence: '需要许可',
    connectTitle: '接入一个服务',
    connectDesc:
      '说出你想让 agent 够到什么 —— 一个阅读应用、一个 API、你常用的某个服务。它会去查这个服务怎么用，建好工具并测通，需要你提供的东西（密钥、扩展）会来问你。',
    connectAction: '描述给 agent',
    installed: '已安装',
    installedDesc: '当前 agent 能用到的全部能力，一行一个集成。点开可以看到里面具体有哪些工具。',
    sourcePreset: '预设',
    sourceYours: '你的',
    sourceKb: 'KB',
    kindExtension: '扩展',
    backToTools: '工具',
    noneInstalled: '还没装任何工具 —— 把上面的开关打开，或者直接告诉助手你想接什么。',
    noToolsHere: '没有报告任何工具。如果这是扩展或服务器，可能尚未连接。',
    removeEntry: '移除',
    presetLockedHint: '这是预设项：它的工具由应用定义，所以这里只能改你必须自己填的字段。',
    serverUrl: '服务器 URL',
    signIn: '登录',
    signOut: '退出登录',
    signingIn: '等待登录…',
    checkChecking: '检测中…',
    checkOk: '已连接 —— 刚刚响应了。',
    checkFailed: '仍未连上。',
    lmdConnect: {
      setupNeeded: '需要设置',
      setupOpen: '打开这个扩展的设置页',
      reload: '刷新本页',
      recheck: '重新检测',
      connected: '已连接 —— localmd Connect 正在响应本站。',
      notDetected:
        '本页上没有响应 —— 可能没安装或没启用，也可能是本页加载之后才变的。扩展是在页面加载那一刻接入的，所以装好后刷新一次。',
      extension: '扩展 {id}',
      presentButSilent: '它在本页上，但不响应。刷新试试；还不行就看看它在这里是否启用。',
      setupTitle: '设置 localmd Connect',
      step1: '安装扩展，然后刷新本页。',
      storeLink: 'Chrome 应用商店 →',
      stepScripts:
        '可选：在它的弹窗里打开「Allow user scripts」—— 只有市场里的 func 适配器和站点脚本需要它。',
      confirmNote:
        '任何可能改动真实网站的操作，都会先在聊天里停在一张确认卡片上。站点脚本可以在扩展弹窗里暂停或删除。',
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
      '你装的那些工具需要的 key。它们只存在这个浏览器里，agent 看不到 —— 它只知道 key 的名字，所以能告诉你缺哪一个，却看不到内容。',
    getKey: '去获取 →',
    keyUsedBy: '被这些工具读取：{tools}',
    agentToolPrompt: '我需要一个新工具。它应该做的是（哪个服务、我想拿到什么）：\n\n',
    catalogFeatured: '首选',
    catalogNotConnected: '未连接',
    catalogLearnMore: '了解更多 →',
    catalogRepo: 'GitHub 上的文档与源码',
    catalog: {
      'localmd-connect': {
        title: 'localmd Connect 浏览器扩展',
        desc: '把你已登录的 Chrome 变成 agent 的工具：读网页、点击输入、搜索、打开你已登录的站点 —— 包括很多网页本身够不着的地方。另有约 300 个现成的站点适配器（Twitter、知乎、Reddit、YouTube……），以及每次打开页面自动生效的站点脚本。任何会向真实网站发内容或注入代码的操作都会先问你。',
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
    transportAuto: '自动（先直连，失败走浏览器扩展）',
    transportDirect: '仅直连',
    transportExtension: '仅浏览器扩展',
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
    serverViaExtension: '通过浏览器扩展连接',
    serverViaExtensionHint:
      '当这个服务器不接受网页直接访问时打开它。大多数托管的 MCP 服务器都直接拒绝浏览器；浏览器扩展（localmd Connect）会代替本页去取，不受这条限制。',
    serverViaExtensionMissing: '浏览器扩展未连接 —— 在 localmd Connect 连上之前这个服务器起不来。',
    toolsHelp:
      '有些服务器不接受网页直连，那种就走浏览器扩展。这里是全局列表；知识库也可以自带一份 .agents/mcp.json 跟着走（token 建议放这里，别写进那个文件）。服务器返回的内容一律按不可信处理。',

    // Git & GitHub
    gitHeading: '给文件夹留一份历史',
    gitDesc:
      '可选。把文件夹变成一个 git 仓库，每次改动就成了一个可以回去的点 —— 提交在 git 面板里做，这一步不会把任何东西发到外面。再填一个 GitHub token，同一个面板就能 push 和 pull，知识库靠这个在多台机器之间流转，也靠这个拿到一份不在浏览器里的备份。',
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
      '其余部分永远免费 —— 网页搜索、子 agent、你自己的 skill、本机 git 都在内。许可覆盖的是伸到你的文件夹和你的模型之外的那些：localmd Connect 浏览器扩展、MCP server、针对外部服务造的工具，以及跟 GitHub 同步。',
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
    licenceHolder: '授权给 {to} —— 这个名字是 key 本身的一部分。',
  },
}
