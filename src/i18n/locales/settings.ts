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

    // External tools
    jinaTitle: 'Built-in web tools (Jina AI Reader)',
    jinaDesc:
      'Gives the agent web_search / web_fetch — no key, no extension needed. The connected browser extension below (which carries your login) is preferred; this is the fallback when the extension is unavailable. Turn it off and, with no extension connected, the agent has no web access.',
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

    // External tools
    jinaTitle: '内置网页工具 (Jina AI Reader)',
    jinaDesc:
      '给 agent 提供 web_search / web_fetch，免 key、无需扩展。优先使用下方连接的浏览器扩展（能带上你的登录态）；扩展不可用时回退到它。关闭后，未连接扩展时 agent 将没有联网能力。',
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
