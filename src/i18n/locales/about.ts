/**
 * Landing-page "about" sections shown below the hero. Namespace: `about`.
 *
 * The headers below name the sections; they deliberately do not number them.
 * The running order lives in one place, `LandingAbout.vue`'s template, and a
 * copy of it here is a second thing to keep in step — it drifted twice in one
 * afternoon before this note replaced it.
 */
export default {
  en: {
    // ── Citations, shown before anything is claimed ──────────────────
    showLabel: 'The moment it clicks',
    diff3Title: 'Citations that click back.',
    diff3Body:
      'Ask about a 300-page PDF and the answer comes back with citations you can click, straight to the paragraph it came from. Those citations are written into your own Markdown, so they still work tomorrow, in your folder, with or without us.',
    showCapNote: 'Your note. Every citation is plain text in the file.',
    showCapPdf: 'The source, at the paragraph the citation points to.',

    // ── Who decides ──────────────────────────────────────────────────
    // Each line names a mechanism that exists — the diff review, ask-first
    // mode, git — not a promise about intent.
    reviewLabel: 'Who decides',
    reviewTitle: 'It proposes. You decide.',
    review1: 'Every change shows up as a diff. Approve it, or throw it away.',
    review2: 'In ask-first mode, nothing touches disk until you say yes.',
    review3: 'Git is built in, so there is always a history to go back to.',

    // ── The three cards ──────────────────────────────────────────────
    // Written to roughly one length: they sit side by side and are equals.
    diffLabel: 'Nothing to change',
    basicsTitle: 'It fits what you already have.',
    // "Nothing to install" was the old title, and it was not quite true: the
    // Connect extension is an install, optional but real. A page that says
    // "nothing" and then asks for something has spent its credibility on the
    // first card.
    diff1Title: 'A browser is enough.',
    diff1Body:
      'localmd is a web page. Open it, pick a folder, and the agent is there. No app to download, no account to make. The only optional install is the Connect extension, if you want it to reach your browser tabs.',
    // Under the url-bar drawing in card 01.
    installCap: 'that is all of it',
    adaptTitle: 'Your folders, your structure.',
    // "asks before it moves anything", not "never moves anything": what
    // exists today is review, not a write guard, and copy may say the agent
    // asks but not that it cannot.
    adaptBody:
      'There is no import step, because there is no format to import into. Open your existing vault, or that downloads folder you never sorted. The agent follows your layout: it adds pages next to your files, in plain Markdown, and asks before moving anything.',
    diff5Title: 'Your model, your key.',
    // The provider names live under it as chips built from the real provider
    // table — a list written twice drifts.
    diff5Body:
      'Add your own API key. Requests go straight to the provider you chose, so your key and your text go there and nowhere else. You pay them, at their prices.',
    freeLine:
      'Without a key, it is still a full notebook and reader for your folder.',
    caps: 'PDF · EPUB · Markdown · Wikilinks · Graph view · Git & GitHub · Skills · MCP servers · Browser connect',

    // ── KB health ────────────────────────────────────────────────────
    // The counterweight to a page that keeps saying the agent adds files:
    // this is how you ever see the whole thing. Every claim here is checked
    // against `computeLint`, which reads no files and calls no model, and the
    // second paragraph is the principle the check exists to demonstrate — a
    // finding is a view, computed on demand, never a record left in someone's
    // folder.
    healthLabel: 'kb health',
    healthTitle: 'Nothing rots quietly.',
    healthBody:
      'Ask for a health check and it goes over the whole knowledge base at once: links that point at nothing, pages nothing links to, material you added and never wrote about, notes citing a document that has moved on since. It is plain code rather than a model, so it costs no tokens.',
    healthCap: 'Computed when you ask. Saved nowhere.',
    healthNote:
      'It reports. It never fixes anything and never blocks you. And it writes nothing down: the report is worked out fresh each time you ask and forgotten when you close it. A list of problems saved into your folder would be one more file for you to keep up to date, and a stale one starts to lie.',

    // ── The browser ──────────────────────────────────────────────────
    connectLabel: 'beyond your disk',
    connectTitle: 'Connect your browser.',
    connectBody:
      'After your own files, the browser is where most of what you read and use actually lives. localmd Connect is a small Chrome extension that lets you ask your browser tabs like files in your folder: the agent opens tabs, reads pages, clicks and types, in the browser you are already signed into. Anything that would post to a real site asks you first. The extension does the refusing, not the prompt.',
    // How the services you use get in. The mechanism lives here and the
    // reasoning lives in `why4a`, which tells the same story from the other
    // end; a mechanism explained in both places drifts.
    connectApps:
      'It is also how your web apps get in. Point the agent at a service and it either connects an MCP server for it, reaching endpoints a web page cannot reach on its own, or works the site out in the browser itself and saves what it learned as a skill in your folder. Either way, what you end up with is a file you own, sitting in your knowledge base.',
    connectLink: 'localmd Connect on the Chrome Web Store',

    // ── Local-first ──────────────────────────────────────────────────
    // Everything about where your things are and where they go lives here,
    // once. It used to be said four times across the page — a pillar, two
    // beliefs, a don't list and a data-flow block — and a thing said four
    // times reads as a thing the writer is nervous about.
    localLabel: 'local-first',
    localTitle: 'Your files, not our database.',
    localBody:
      'Your knowledge base is a folder: plain Markdown next to the PDFs and EPUBs you already had. No database behind it, no account in front of it. Open it in any editor, sync it however you like, leave whenever you want. Nothing is locked in.',
    flowLabel: 'where your data goes',
    flow1: 'Your files → nowhere. They stay in your folder.',
    flow2:
      'Your questions, and the passages it reads → the model you chose, on your key.',
    flow3: 'To us → nothing. There is no server to send to.',

    // ── Free and open ────────────────────────────────────────────────
    // "Forever" is a strong word, and the second paragraph is what earns it:
    // MIT is the mechanism, not the promise.
    freeLabel: 'no catch',
    freeTitle: 'Free forever. Open source.',
    free1:
      'All of it is free: the agent, the book reader, the document indexes, git and GitHub sync, MCP, the Connect extension. No paid tier, no account, no usage caps. The only thing you pay for is your model, and you pay the provider directly. We add nothing on top.',
    free2:
      'Both the app and the extension are open source, MIT. That is what makes "forever" a fact and not a promise: nobody can take the code back, us included.',
    sourceLink: 'localmd on GitHub',
    connectSource: 'localmd Connect on GitHub',

    // ── Why I built this ─────────────────────────────────────────────
    // The only first-person block on the page, and deliberately so.
    // Everything else speaks as "we", which is the right voice for a claim
    // about the software and the wrong one for a claim about a motive: a
    // motive has to belong to somebody. Used everywhere, "I" is a mannerism;
    // used once, it is a signature — so this is the one section that may.
    // Two paragraphs carry a link, and are split around it so each language
    // can place the link where its own sentence wants it.
    whyLabel: 'where this came from',
    whyTitle: 'Why I built this.',
    why1: "I tried Notion and left, because my notes lived in someone else's database. I tried Obsidian and left too, because keeping the plugins working cost more than the notes were worth. So I went back to a folder of Markdown in a git repo, which asked nothing of me and did nothing for me.",
    why2a: "Then I read Karpathy's note on the ",
    why2Link: 'LLM wiki',
    why2b:
      ', and the bare folder suddenly had a point: let an agent keep the structure, and keep the judgment for myself. So I pointed a coding agent at my notes folder and used it like that for a while.',
    why3: 'Three things wore me down. It burned tokens on tools built for code, not notes. It could not cite a book, so I kept switching between a terminal and a PDF reader, copying paragraphs by hand. And it handled the browser badly: extensions can connect an agent to your tabs, but what comes back is loose text with no source attached and no way back to it. Three missing features, one problem: I was the one carrying context from window to window. So I built localmd, and localmd Connect with it.',
    // The plugin argument, which is the same story from the other end: the
    // thing that made Obsidian worth using is the thing that made it exhausting.
    // The mechanism is not repeated here — `connectApps` up in the browser
    // section carries that, and a mechanism explained twice drifts.
    why4a:
      'What I loved about Obsidian and what made me leave were the same thing: plugins. So this is my answer to it. The apps I would want a plugin for are already on the web, already open in a tab, already signed in. ',
    why4Link: 'Connect',
    why4b:
      ' does more than turn those tabs into files. It turns the apps themselves into plugins, with nothing to install, configure or keep updated, because they are the ones you already use every day. It connects them when you need them, and stays out of the way when you do not.',
    whyKicker:
      'That is the whole story of how localmd got built. I still use it every day for my own notes, so if something on this page is wrong, I am the first to find out.',

    // ── Phones ───────────────────────────────────────────────────────
    // The one forward-looking claim on a page that otherwise only describes
    // what exists, so it is written as small as it honestly can be: no date,
    // and nothing to sign up for. A waitlist here would be collecting
    // addresses on a page whose first promise is that it has no account.
    mobileLabel: 'in progress',
    mobileTitle: 'A phone version is on the way.',
    mobileBody:
      'localmd needs a browser that can open a folder, which today means Chrome or Edge on a desktop. A version that works on a phone is being built now. There is no date and nothing to sign up for; when it is ready it will be here, free and open like the rest.',

    // ── Closing ─────────────────────────────────────────────────────
    closingTitle: 'Open a folder. Start thinking.',
    footer: 'localmd · an agent lives in your folder',
    feedback: 'Report a problem',
  },
  zh: {
    showLabel: '一点就通',
    diff3Title: '引用可点击跳转原文。',
    diff3Body:
      '问一句关于 300 页 PDF 里的问题，答案带着可以点的引用，直接跳转到它出处的那一段。这些引用是写进你自己的 Markdown 的，所以明天它们照样能用，在你的文件夹里，有没有我们都一样。',
    showCapNote: '你的笔记。每个引用都是文件里的纯文本。',
    showCapPdf: '原文，停在引用指向的那一段。',

    reviewLabel: '谁说了算',
    reviewTitle: 'agent 提议，你决定。',
    review1: '它的每个改动都 diff 给你看。批准，或者丢掉。',
    review2: '「先询问」模式下，你不点头，什么都不落盘。',
    review3: '内置了 git，永远有历史可以退回去。',

    diffLabel: '无需改变',
    basicsTitle: '适配你已有的东西。',
    diff1Title: '浏览器，足够了。',
    diff1Body:
      'localmd 就是一个网页。打开它，选一个文件夹，agent 就在了。不用下载 app，不用注册账号。唯一可能要装的是 Connect 扩展，而且只在你想让它读取浏览器标签页时才需要。',
    installCap: '点击即可使用',
    adaptTitle: '你的目录，你的结构。',
    adaptBody:
      '没有「导入」这一步，因为根本没有要导入进去的格式。打开已有的 vault，或者那个一直没整理的下载文件夹，agent 顺着你的布局来：在你的文件旁边加页面，写的是普通 Markdown，要挪动任何东西之前先问你。',
    diff5Title: '你的模型，你的 key。',
    diff5Body:
      '填上你自己的 API Key。请求直连你选的那家厂商，你的 Key 和你的文本只去那儿，别处哪儿也不去。钱按厂商的价格直接付给他们。',
    freeLine: '不填 Key，它也是一个完整的本地笔记工具和 PDF/EPUB 阅读器。',
    caps: 'PDF · EPUB · Markdown · 双链笔记 · 图谱 · Git 与 GitHub · Skills · MCP · Browser connect',

    healthLabel: '知识库体检',
    healthTitle: '不让笔记悄悄烂掉。',
    healthBody:
      '让它做一次体检，它会把整个知识库一次过一遍：指向空处的链接、没有任何页面链到的孤页、你放进来却从没写过的材料、引用的文档后来已经变了的笔记。它是纯代码，不是模型，所以不花 token。',
    healthCap: '你问的时候现算。不存在任何地方。',
    healthNote:
      '它只报告。它不替你修，也不拦着你。而且它什么都不写下来：报告是你每次问的时候现算的，关掉就没了。一份存进你文件夹的问题清单，会变成又一个要你维护的文件，而一份过期的清单会开始骗人。',

    connectLabel: '磁盘之外',
    connectTitle: '连接你的浏览器。',
    connectBody:
      '除了你自己的文件，你平时读的和用的东西大多在浏览器。localmd Connect 是一个小小的 Chrome 扩展，让你可以像问文件夹里的文件一样，问你的浏览器标签页：agent 在你已经登录的浏览器里开标签页、读页面、点击、输入。任何会往真实网站上发东西的动作都会先问你。',
    connectApps:
      '你常用的那些网页应用，也是这样接进来的。你派给 agent 一个服务需求，它要么给它接上一个 MCP server，够到网页自己够不着的地方，要么自己在浏览器里把这个站点摸清楚，把办法存成你文件夹里的一个 skill 供以后复用。两条路的结果都是一份归你所有的文件，就放在你的知识库里。',
    connectLink: 'Chrome 商店里的 localmd Connect',

    localLabel: '本地优先',
    localTitle: '你的文件，非我们的数据库。',
    localBody:
      '你的知识库就是一个文件夹：开放格式的 Markdown，你本来就有的 PDF 和 EPUB 等等。背后没有数据库，没有账号。你可用任何编辑器打开它，随你怎么同步，想走随时走，没有任何东西会被锁住。',
    flowLabel: '你的数据去哪儿',
    flow1: '你的文件 → 哪儿也不去，就待在你的文件夹里。',
    flow2: '你的提问，和它读到的段落 → 你选的模型，走你自己的 Key。',
    flow3: '给我们 → 什么都没有，根本没有服务器可发。',

    freeLabel: '没有套路',
    freeTitle: '永久免费，开源。',
    free1:
      '全部免费：agent、阅读器、文档索引、git 与 GitHub 同步、MCP、Connect 扩展。没有付费档位，没有账号，没有用量上限。唯一要花钱的地方是你的模型，直接付给厂商。我们一分不加。',
    free2:
      'app 和扩展都是开源的，MIT 协议。「永久」之所以是事实而不是承诺，就在这里：谁都收不回这份代码，包括我们。',
    sourceLink: 'GitHub 上的 localmd',
    connectSource: 'GitHub 上的 localmd Connect',

    whyLabel: '不忘初心',
    whyTitle: '我为什么做这个？',
    why1: 'Notion 我用了很长一段时间，后来离开了，因为我的笔记住在别人的数据库里。Obsidian 我也试过，也离开了，因为管理插件的成本比笔记本身还高。于是我退回到最原始的方式，使用 git 仓库来管理我的 Markdown 文件夹，简陋但是简单可控。',
    why2a: '后来我读到 Karpathy 写的 ',
    why2Link: 'LLM wiki',
    why2b:
      '，那个光秃秃的文件夹忽然有了意义：让 agent 去维护结构，把判断和思考留给自己。于是我直接拿一个code agent 对着我的笔记目录用，就这么用了一阵。',
    why3: '但有三件地方我是用的不爽的。第一，费 token，它在一套为代码而不是笔记准备的工具上浪费了很多 token。其次，它没法引用一本书，我只好在终端和 PDF 阅读器之间来回切，一段一段手动复制context。再者，它无法无缝衔接我的第二大 context 来源即浏览器。三个缺憾，其实是同一个问题：我需要不停地在窗口之间搬运 context。所以我做了 localmd，以及跟它配套的 localmd Connect 插件。',
    why4a:
      '讽刺的是，当初喜欢 Obsidian 的地方，和我最后离开它的原因，是同一样东西：插件。所以这是我给出的回答。那些我会想装个插件去用的能力，如 calendar，画图等等，本来就有专门的网站，开一个 tab 即可，没必要装那么多插件。',
    why4Link: 'Connect',
    why4b:
      ' 做的不只是把这些 tabs 变成文件。它还可以通过探索站点生成可复用 skills 的方式将这些应用本身变成类似插件的能力，但没有东西要装、要配、要一直更新，因为它们本来就是你每天在用的。你需要的时候它接进来，不需要的时候它退到一边。',
    whyKicker:
      '这就是 localmd 被做出来的全部故事。我自己每天都在用它阅读，记笔记，所以要是哪里出问题了，第一个发现的很可能是我。',

    mobileLabel: '正在做的',
    mobileTitle: '手机版在路上了。',
    mobileBody:
      'localmd 需要一个能打开文件夹的浏览器，今天这意味着只有桌面上的 Chrome 或 Edge 能使用。手机版本正在开发中。没有时间表，也没有waitlist；做好了就放这里，和其余部分一样免费开源。',

    closingTitle: '打开一个文件夹，开始思考。',
    footer: 'localmd · 一个住在你文件夹里的 agent',
    feedback: '反馈问题',
  },
};
