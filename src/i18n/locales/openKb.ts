/** Open-knowledge-base landing screen. Namespace: `openKb`. */
export default {
  en: {
    // The product one-liner, split at its sentence break so the first half can
    // carry the page as a headline. Concatenated they are still byte-identical
    // to the wording reused everywhere else — do not reword one half alone.
    headline: 'An AI knowledge base that runs in your browser and your local folder.',
    subline: 'Open a URL, pick a folder, start thinking — nothing to install.',
    openFolder: 'Open local folder',
    newKb: 'Start a new knowledge base',
    demo: 'Try a demo knowledge base',
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
      'Bring your own API key (Anthropic, OpenAI, DeepSeek, Gemini). It stays in this browser, and you pay the provider directly, at their prices.',
    // Step three is not a step — by now the agent is there. The old title
    // ("Put an agent to work in it") read like a third thing to go and do.
    step3Title: 'The agent is already there',
    step3Body:
      'Nothing more to set up — just start asking. Ask about a PDF and click the citation to land on the exact paragraph; it writes notes and edits files with your approval.',
    privacy: 'No account · Nothing to install · Your files stay in your folder',
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
      'Letting a web page read and write a folder you choose takes the File System Access API, and only Chromium browsers have it. That rules out Firefox and Safari today — and it is also the whole reason a page can work inside your own folder at all. The demo knowledge base needs none of it and runs anywhere.',
    unsupported:
      'This browser cannot open local folders. The API that lets a page read and write a folder directly (File System Access) exists only in Chrome, Edge and other Chromium browsers — please open localmd in one of those.',
  },
  zh: {
    headline: '一个 AI 知识库，跑在你的浏览器和本地文件夹里。',
    subline: '打开网址，选个文件夹，开始思考——什么都不用装。',
    openFolder: '打开本地文件夹',
    newKb: '新建一个知识库',
    demo: '先试一个示例知识库',
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
      '自带 API Key（Anthropic、OpenAI、DeepSeek、Gemini）。Key 只留在这个浏览器里，你按模型商的价格直接付给他们。',
    step3Title: 'agent 已经在里面了',
    step3Body:
      '不用再配置什么——直接问就行。问一句 PDF 里的事，点引用就落到原文的那一段；它还能写笔记，经你批准直接改文件。',
    privacy: '无需账号 · 无需安装 · 文件只待在你的文件夹里',
    frameCaption: '示例知识库 · 不用选文件夹 · 不用填 Key · 关掉标签页就没了',
    source: '开源',
    sourceTitle: '代码可以读，也可以自己跑一份 —— MIT，在 GitHub 上',
    whyChrome: '为什么只有 Chrome 和 Edge？',
    whyChromeBody:
      '让一个网页读写你选定的文件夹，靠的是 File System Access API，目前只有 Chromium 系浏览器有。这确实把 Firefox 和 Safari 挡在了外面——而它同时也是「网页能在你自己的文件夹里干活」这件事成立的全部原因。示例知识库不需要它，在哪儿都能跑。',
    unsupported:
      '这个浏览器无法打开本地文件夹。让网页直接读写一个文件夹的 API（File System Access）目前只有 Chrome、Edge 等 Chromium 系浏览器有——请用其中之一打开 localmd。',
  },
}
