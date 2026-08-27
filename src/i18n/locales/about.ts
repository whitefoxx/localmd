/** Landing-page "about" sections shown below the hero. Namespace: `about`. */
export default {
  en: {
    diffLabel: 'What makes it different',
    diff1Title: 'Nothing to install.',
    // These three sit side by side in the ink band, so they are written to
    // roughly one length: a column that runs half again as long as its
    // neighbours reads as the important one, and they are meant to be equals.
    // What came out of here — no backend, no account — is said again in "what
    // we don't do", where it belongs anyway.
    diff1Body:
      'Every other way to put an agent in your files installs something first — an app, a virtual machine, a terminal, a plugin and its configuration. localmd is a web page: open it, grant it one folder, and the agent is already there.',
    diff3Title: 'Citations live in your notes and click back to the exact paragraph.',
    diff3Body:
      'Ask about a 300-page PDF and the answer comes back with citations you can click, straight to the paragraph it came from. Those citations are written into your own Markdown, so they still work tomorrow, in your folder, with or without us.',
    diff5Title: 'Bring your own model.',
    // The provider names moved out of this sentence and under it, as chips
    // built from the real provider table — a list written twice drifts.
    diff5Body:
      'Plug in your own API key. Each provider is hit directly at its own endpoint, so your key and your text go to the model you chose and nowhere else — and you pay that provider at their prices. We take no cut and meter nothing.',

    // The citation round-trip gets its own section with the two screenshots
    // that show it, so `diff3Title` / `diff3Body` are read there rather than in
    // the list of differences. One claim, one place on the page.
    // The approval story gets its own section: for a note-keeping audience
    // "what may it do on its own" is the first question, and each line here is
    // a mechanism that exists, not a promise.
    // Under the url-bar drawing in card 01.
    installCap: '— that is the whole install',
    // The data-flow block: three lines a non-network person can read. The
    // second line carries the anti-claims qualifier in plain words.
    flowLabel: 'where your data goes',
    flow1: 'Your files → nowhere. They stay in your folder.',
    flow2: 'Your questions, and the passages it reads → the model you chose, on your key.',
    flow3: 'To us → nothing. There is no server to send to.',
    reviewLabel: 'Who decides',
    reviewTitle: 'It reads. You decide.',
    review1: 'Every change it makes arrives as a line-level diff — approve it, or discard it.',
    review2: 'In ask-first mode, nothing touches disk until you say yes.',
    review3: 'And git is built in underneath, so there is always a history to fall back on.',
    // Pillar 4's wording, verbatim from the message house.
    adaptTitle: 'It adapts to your folders, not the other way round.',
    adaptBody:
      'There is no import, because there is no format to import into. Open an existing vault — or the downloads folder you never organized — and it follows your structure, writing plain Markdown any editor can open. Leave whenever you like; nothing was ever locked in.',
    freeLine: 'Without a key it is still a complete, free notebook and reader for your folder.',
    caps: 'PDF · EPUB · Markdown · Wikilinks · Graph view · Git & GitHub · Skills · MCP servers · Browser connect',

    showLabel: 'The moment it clicks',
    showCapNote: 'Your own Markdown — the citation chips are plain text in the file',
    showCapPdf: 'The source PDF, opened at the exact paragraph it came from',

    // Act two: the sources that are not on disk. Wording is bound by the
    // message house — the extension is free to INSTALL, using it from the app
    // is the paid tier, and write actions always ask first.
    connectLabel: 'beyond your disk',
    connectTitle: 'Ask your browser tabs like files in your folder.',
    connectBody:
      'localmd Connect is a companion Chrome extension that lets the agent use your own logged-in browser — open tabs, read pages, click — with ready-made actions for 30+ sites (arXiv, Hacker News, Reddit, YouTube…). What it brings back lands in your folder as sources, citable like any PDF. The extension is free to install; using it from the app is part of the paid tier, and anything that writes to a real site asks you first.',
    connectLink: 'localmd Connect on the Chrome Web Store',

    believeLabel: 'What we believe',
    believe1Title: 'Your files should outlive the app.',
    believe1Body:
      "A note you can't open without us is a note we've taken hostage. Plain Markdown, in your folder, for as long as you keep it.",
    believe2Title: 'Local by default.',
    believe2Body:
      "Your notes, highlights and keys stay in your browser. Not because we're noble — because they were never ours to hold.",
    believe3Title: 'Summoned, not nagging.',
    believe3Body:
      'No streaks, no red badges, no "you haven\'t journaled today." The tools wait quietly until you reach for them.',
    believe4Title: 'Minimal and manual over clever and automatic.',
    believe4Body:
      "We'd rather ship one honest manual action than a magic feature that does the wrong thing behind your back.",

    sourceLead: 'None of this has to be taken on trust.',
    sourceBody:
      'The app is open source, MIT — read the code, run your own copy, watch the network tab. A privacy claim is worth exactly what your willingness to believe it is worth; this is the only thing that makes it checkable.',
    sourceLink: 'Source on GitHub',
    dontLabel: "What we don't do",
    dont2: "No server storing your files. There's nowhere for us to put them.",
    dont3:
      'No uploading your notes. They stay in your folder unless you send text to your own model.',
    dont4: 'No ads, no notifications, no "reading goals."',
    dont6:
      "We don't hold your API key. It lives in your browser, and you can clear it anytime.",

    closingTitle: 'Open a folder and start thinking.',
    footer: 'localmd · an agent lives in your folder',
    feedback: 'Report a problem',
  },
  zh: {
    diffLabel: '与别的产品有什么不同',
    diff1Title: '什么都不用装。',
    diff1Body:
      '别的「让 agent 在你文件里干活」的做法，都要你先装点什么——一个 app、一个虚拟机、一个终端，或者一个插件和它的配置。localmd 就是一个网页：打开它，授权一个文件夹，agent 已经在那儿了。',
    diff3Title: '引用就存在你的笔记里，点一下回到原文那一段。',
    diff3Body:
      '问一句 300 页 PDF 里的事，答案带着可以点的引用，直接落到它出处的那一段。这些引用是写进你自己的 Markdown 的，所以明天它们照样能用，在你的文件夹里，有没有我们都一样。',
    diff5Title: '自带你的模型。',
    diff5Body:
      '填入你自己的 API Key。各家直连各家的端点，你的 Key 和文本只去你选的那个模型，别无他处——而且你按模型商的价格直接付给他们。我们不抽成，也不计量。',

    installCap: '——这就是安装的全部',
    flowLabel: '你的数据去哪儿',
    flow1: '你的文件 → 哪儿也不去，就待在你的文件夹里。',
    flow2: '你的提问和它读到的段落 → 你选的模型商，用你自己的 key。',
    flow3: '给我们 → 什么都没有，根本没有服务器可发。',
    reviewLabel: '谁说了算',
    reviewTitle: '它读，你判断。',
    review1: '它做的每个改动都以逐行 diff 出现——由你批准，或者丢弃。',
    review2: '「先询问」模式下，你不点头，什么都不落盘。',
    review3: '底下还有内置的 git，永远有历史可退。',
    adaptTitle: '是软件适应你的目录，不是你去适应软件。',
    adaptBody:
      '没有「导入」这一步，因为根本没有要导入进去的格式。打开已有的 vault，或者那个一直没整理的下载文件夹——它顺着你的结构来，写下的是任何编辑器都能打开的普通 Markdown。想走随时走，从来没有东西被锁进去过。',
    freeLine: '不填 key，它也是一个完整免费的本地 Markdown 笔记本和 PDF/EPUB 阅读标注工具。',
    caps: 'PDF · EPUB · Markdown · 双链笔记 · 图谱 · Git 与 GitHub · Skills · MCP · Browser connect',

    showLabel: '最能说明问题的那一下',
    showCapNote: '你自己的 Markdown——那些引用徽章就是文件里的纯文本',
    showCapPdf: '原始 PDF，直接停在它出处的那一段',

    connectLabel: '盘外的源',
    connectTitle: '像问文件夹里的文件一样，问你的浏览器标签页。',
    connectBody:
      'localmd Connect 是配套的 Chrome 扩展，让 agent 使用你自己已登录的浏览器——开标签页、读页面、点击，外加 30+ 个站点的现成动作（arXiv、Hacker News、Reddit、YouTube……）。它取回的东西落进你的文件夹，像任何 PDF 一样可引用。扩展本身免费安装；从 app 里连接使用属于付费层，而任何会写到真实网站的动作都会先问你。',
    connectLink: 'Chrome 商店里的 localmd Connect',

    believeLabel: '我们相信什么',
    believe1Title: '你的文件应该比 app 活得久。',
    believe1Body:
      '一条离开我们就打不开的笔记，是被我们扣作人质的笔记。纯 Markdown，在你的文件夹里，你留着它就一直在。',
    believe2Title: '默认本地。',
    believe2Body:
      '你的笔记、划线和 Key 都留在你的浏览器里。不是因为我们多高尚——而是它们本来就不该由我们保管。',
    believe3Title: '被召唤，而非打扰。',
    believe3Body:
      '没有连续打卡、没有红点、没有「你今天还没记笔记」。工具安静地待在那儿，等你来用。',
    believe4Title: '极简手动，优先于聪明自动。',
    believe4Body:
      '我们宁愿给你一个老实的手动操作，也不做一个在你背后做错事的魔法功能。',

    sourceLead: '上面这些都不用你信。',
    sourceBody:
      '应用是开源的，MIT —— 代码可以读，可以自己跑一份，网络请求可以自己看。隐私主张的价值，等于你愿意相信它的程度；开源是唯一能让它可被验证的东西。',
    sourceLink: '在 GitHub 上看源码',
    dontLabel: '我们不做的事',
    dont2: '不在服务器上存你的文件。我们根本没有地方放。',
    dont3:
      '不上传你的笔记。除非你把文本发给你自己的模型，否则它们只待在你的文件夹里。',
    dont4: '没有广告、没有推送、没有「阅读目标」。',
    dont6: '不替你保管 API Key。它就在你的浏览器里，你随时能清除。',

    closingTitle: '打开一个文件夹，开始思考。',
    footer: 'localmd · 一个住在你文件夹里的 agent',
    feedback: '反馈问题',
  },
};
