/** Open-knowledge-base landing screen. Namespace: `openKb`. */
export default {
  en: {
    // The hero in two parts, and the split is load-bearing. The headline is
    // the three-beat stance — who writes, what the agent does, where it all
    // stays; the subline is the sentence that used to BE the headline, and it
    // is the half reused byte-identically as the meta description, in
    // llms.txt and in the README. The title tags carry the headline instead.
    // Do not reword one half alone, and do not "improve" either in place.
    headline: 'You write. AI connects.\u00A0All in your local folder.',
    subline:
      'An agent lives in your folder, a wiki grows around your files. It reads the PDFs, EPUBs and notes already there, reaches the tabs open in your browser, and writes linked Markdown beside them. Every citation clicks back to the exact paragraph, and every change waits for your yes.',
    openFolder: 'Open local folder',
    demo: 'Try the demo',
    demoHint:
      'No folder, no key. It lives in this tab and goes when you close it.',
    laterHint:
      'To open a folder of your own you will need a desktop Chrome or Edge.',
    copyAddress: 'Copy the address',
    copied: 'Copied',
    recent: 'Recent',
    forget: 'Remove from recent',
    howItWorks: 'How it works',
    step1Title: 'Open a folder',
    step1Body:
      'Any folder on your device, empty or already full of Markdown and PDFs. Nothing is copied, moved or uploaded.',
    step2Title: 'Add your model key',
    step2Body:
      'Bring your own key: Anthropic, OpenAI, DeepSeek, Gemini. It stays in this browser; you pay the provider directly.',
    // Step three is not a step — by now the agent is there. The old title
    // ("Put an agent to work in it") read like a third thing to go and do.
    step3Title: 'The agent is already there',
    step3Body:
      'Nothing more to set up. Just ask. Citations click back to the exact paragraph, and every note and edit waits for your yes.',
    privacy:
      'No account · No upload · No usage caps · Just a web page and your folder',
    // Caption for the product shot, and the home of what used to be a loose
    // line under the buttons: it names the picture and says what the demo
    // costs, next to the thing it is talking about. Set as a run of facts,
    // like the privacy line — same shape, so it scans the same way.
    frameCaption:
      'Demo knowledge base · No folder · No key · Gone when you close the tab',
    // Said on the way in, positively, rather than left for someone to discover
    // as a failure. The limit is real and it is also the reason this can work
    // at all — so it is stated as a fact about the web, not an apology.
    source: 'Open source',
    sourceTitle: 'Read the code, or run your own copy. MIT, on GitHub',
    whyChrome: 'Why Chrome or Edge?',
    whyChromeBody:
      'Letting a web page read and write a folder you choose takes the File System Access API, and only Chromium browsers have it. So localmd needs Chrome or Edge; Firefox and Safari cannot open a local folder at all. The demo knowledge base needs none of this and runs anywhere.',
    unsupported:
      'This browser cannot open local folders. The API that lets a page read and write a folder directly (File System Access) exists only in Chrome, Edge and other Chromium browsers. Please open localmd in one of those.',
  },
  zh: {
    headline: '你写，AI 连，文件夹即一切。',
    subline:
      'Agent 住进你的文件夹，围绕你的文件构建 wiki。它读你指定目录下已有的 PDF、EPUB 和笔记，也可像读文件一样读取你的浏览器 tabs，生成相互连接的 Markdown 笔记，引用可跳转原文，而所有改动必须你同意。',
    openFolder: '打开本地文件夹',
    demo: '先试示例',
    demoHint: '不用选文件夹，也不用填 Key。它只活在这个标签页里，关掉就没了。',
    laterHint: '想打开你自己的文件夹，得有桌面版 Chrome 或 Edge。',
    copyAddress: '复制网址',
    copied: '已复制',
    recent: '最近打开',
    forget: '从最近列表移除',
    howItWorks: '如何使用',
    step1Title: '打开一个文件夹',
    step1Body:
      '你设备上的任意文件夹都行。空的可以，已经满是 Markdown 和 PDF 的也可以。不复制，不移动，不上传。',
    step2Title: '填入你的模型 Key',
    step2Body:
      '自带 Key：Anthropic、OpenAI、DeepSeek、Gemini 都行。Key 只留在这个浏览器里，钱直接付给厂商。',
    step3Title: 'agent 已经在里面了',
    step3Body:
      '不用再配置什么，直接问。引用点得回原文那一段，每一条笔记、每一次改动，都等你点头。',
    privacy: '没有账号 · 不上传 · 没有用量上限 · 就一个网页，加你的文件夹',
    frameCaption: '示例知识库 · 不用选文件夹 · 不用填 Key · 关掉标签页就没了',
    source: '开源',
    sourceTitle: '代码随便读，也可以自己跑一份。MIT 协议，在 GitHub 上',
    whyChrome: '为什么只有 Chrome 和 Edge？',
    whyChromeBody:
      '让网页读写你指定的文件夹，靠的是 File System Access API，目前只有 Chromium 系浏览器才有。所以 localmd 需要 Chrome 或 Edge；Firefox 和 Safari 完全打不开本地文件夹。示例知识库不依赖这些，在哪儿都能跑。',
    unsupported:
      '这个浏览器打不开本地文件夹。让网页直接读写文件夹的 API（File System Access），目前只有 Chrome、Edge 等 Chromium 系浏览器才有。请用 Chrome 或 Edge 打开 localmd。',
  },
};
