/** Open-knowledge-base landing screen. Namespace: `openKb`. */
export default {
  en: {
    // The product one-liner and its descriptor paragraph, verbatim from the
    // message house. Concatenated they are byte-identical to the wording
    // reused everywhere else (meta tags, llms.txt) — do not reword one half
    // alone, and do not "improve" either in place.
    headline: 'An agent lives in your folder,\u00A0a wiki grows around your files.',
    subline:
      'It reads the PDFs, EPUBs and notes already in the folder and writes linked Markdown beside them — every citation clicks back to the exact paragraph, and every change waits for your yes.',
    openFolder: 'Open local folder',
    demo: 'Try the demo',
    demoHint: 'No folder, no key. It lives in this tab and goes when you close it.',
    laterHint: 'To open a folder of your own you will need a desktop Chrome or Edge.',
    copyAddress: 'Copy the address',
    copied: 'Copied',
    recent: 'Recent',
    forget: 'Remove from recent',
    howItWorks: 'How it works',
    step1Title: 'Open a folder',
    step1Body:
      'Any folder on your device — empty, or already full of Markdown and PDFs. Nothing is copied, moved or uploaded.',
    step2Title: 'Add your model key',
    step2Body:
      'Bring your own key — Anthropic, OpenAI, DeepSeek, Gemini. It stays in this browser; you pay the provider directly.',
    // Step three is not a step — by now the agent is there. The old title
    // ("Put an agent to work in it") read like a third thing to go and do.
    step3Title: 'The agent is already there',
    step3Body:
      'Nothing more to set up — just ask. Citations click back to the exact paragraph, and every note and edit waits for your yes.',
    privacy: 'No install · No account · No upload · No usage caps — only your folder',
    // Caption for the product shot, and the home of what used to be a loose
    // line under the buttons: it names the picture and says what the demo
    // costs, next to the thing it is talking about. Set as a run of facts,
    // like the privacy line — same shape, so it scans the same way.
    frameCaption: 'Demo knowledge base · No folder · No key · Gone when you close the tab',
    // Said on the way in, positively, rather than left for someone to discover
    // as a failure. The limit is real and it is also the reason this can work
    // at all — so it is stated as a fact about the web, not an apology.
    source: 'Open source',
    sourceTitle: 'Read the code, or run your own copy — MIT, on GitHub',
    whyChrome: 'Why Chrome or Edge?',
    whyChromeBody:
      'Letting a web page read and write a folder you choose takes the File System Access API, and today only Chromium browsers ship it. That rules out Firefox and Safari — but the same API is what makes localmd possible in the first place: without it, no web page could open your folder. The demo knowledge base needs none of it and runs anywhere.',
    unsupported:
      'This browser cannot open local folders. The API that lets a page read and write a folder directly (File System Access) exists only in Chrome, Edge and other Chromium browsers — please open localmd in one of those.',
  },
  zh: {
    headline: '一个 agent 住进你的文件夹，一座 wiki 绕着你的原件生长。',
    subline:
      '它就地读文件夹里已有的 PDF、EPUB 和笔记，在旁边写出互相链接的 Markdown——每条引用点回原文那一段，每个改动都等你点头。',
    openFolder: '打开本地文件夹',
    demo: '先试示例知识库',
    demoHint: '不用选文件夹，也不用填 Key。它只活在这个标签页里，关掉就没了。',
    laterHint: '要打开你自己的文件夹，需要桌面版的 Chrome 或 Edge。',
    copyAddress: '复制网址',
    copied: '已复制',
    recent: '最近',
    forget: '从最近中移除',
    howItWorks: '如何使用',
    step1Title: '打开一个文件夹',
    step1Body:
      '设备上任意文件夹——空的，或已经装满 Markdown 和 PDF。不会被拷走、移动或上传。',
    step2Title: '填入你的模型 Key',
    step2Body:
      '自带 Key——Anthropic、OpenAI、DeepSeek、Gemini。Key 只留在这个浏览器里，你直接付给模型商。',
    step3Title: 'agent 已经在里面了',
    step3Body:
      '不用再配置什么——直接问。引用点回原文那一段，每个笔记和改动都等你点头。',
    privacy: '不用安装 · 没有账号 · 不上传 · 没有用量上限——只有你的文件夹',
    frameCaption: '示例知识库 · 不用选文件夹 · 不用填 Key · 关掉标签页就没了',
    source: '开源',
    sourceTitle: '代码可以读，也可以自己跑一份 —— MIT，在 GitHub 上',
    whyChrome: '为什么只有 Chrome 和 Edge？',
    whyChromeBody:
      '让一个网页读写你选定的文件夹，靠的是 File System Access API，目前只有 Chromium 系浏览器有。这确实把 Firefox 和 Safari 挡在了外面——但 localmd 能存在，靠的也正是这个 API：没有它，任何网页都打不开你的文件夹。示例知识库不需要它，在哪儿都能跑。',
    unsupported:
      '这个浏览器无法打开本地文件夹。让网页直接读写一个文件夹的 API（File System Access）目前只有 Chrome、Edge 等 Chromium 系浏览器有——请用其中之一打开 localmd。',
  },
}
