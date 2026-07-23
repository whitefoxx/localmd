/** Landing-page "about" sections shown below the hero. Namespace: `about`. */
export default {
  en: {
    whyLabel: 'Why localmd exists',
    whyTitle: 'Your knowledge is scattered. It should just be files you own.',
    whyBody1:
      "Notes in one app, PDFs in a downloads folder, highlights locked inside a reader you'll cancel next year, half-read papers everywhere. Every tool wants to be the place your knowledge lives — on its servers, in its format, behind its login.",
    whyBody2:
      'localmd makes the opposite bet: your knowledge is just files in a folder on your own computer. Markdown you can read in any editor, the PDFs and EPUBs you already have, conversations you choose to keep. An AI agent works inside that folder with you — but the folder is yours, and it never leaves your machine.',

    diffLabel: 'What makes it different',
    diff1Title: "It's your folder, not our database.",
    diff1Body:
      'Everything is plain Markdown and your original files, in a folder you picked. Open it in VS Code, sync it with git, or walk away — there is no "export", because nothing was ever locked in.',
    diff2Title: 'Local-first, genuinely.',
    diff2Body:
      "No account, no sign-up, no server. Files are read and written through the browser's File System Access API. localmd is a static page — there is no backend to upload anything to.",
    diff3Title: 'Bring your own model.',
    diff3Body:
      'Plug in your own API key — Anthropic, OpenAI, DeepSeek, Gemini and more — each hitting its own endpoint directly. Your key and your text go to the model you chose, and nowhere else.',
    diff4Title: 'An agent that works in your files.',
    diff4Body:
      'Not a chat window bolted onto notes. It reads your PDFs and EPUBs with citations, writes and links Markdown pages, and edits files directly — with your approval.',
    diff5Title: 'The structure is a suggestion, not a cage.',
    diff5Body:
      'No rigid templates. Open an empty folder and it offers a starting layout; open your existing notes and it adapts to how you already organize them.',

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

    doesLabel: 'What localmd does',
    does1: 'Interlinked Markdown notes with [[wikilinks]] and a graph view',
    does2: 'Read PDFs and EPUBs in-app, with block-level citations back into your notes',
    does3: 'An AI agent with tools: search, read, write, edit, plan, run skills, call MCP servers',
    does4: 'Bring-your-own-key for many providers, a vision model for images, optional image generation',
    does5: 'Save conversations as Markdown and distill them into notes',
    does6: 'Version your knowledge base with built-in git and sync to GitHub',
    does7: 'Installable and offline — everything cached on your device',

    dontLabel: "What we don't do",
    dont1: "No account. You don't sign up to think.",
    dont2: "No server storing your files. There's nowhere for us to put them.",
    dont3: 'No uploading your notes. They stay in your folder unless you send text to your own model.',
    dont4: 'No ads, no notifications, no "reading goals."',
    dont5: "No lock-in. It's Markdown in a folder — leave whenever you like.",
    dont6: "We don't hold your API key. It lives in your browser, and you can clear it anytime.",

    closingTitle: 'Open a folder and start thinking.',
    footer: 'localmd · a local-first AI knowledge base in your browser',
  },
  zh: {
    whyLabel: '为什么有 localmd',
    whyTitle: '你的知识是散的。它本该只是你自己拥有的文件。',
    whyBody1:
      '笔记在一个 app 里，PDF 在下载文件夹里，划线锁在你明年就会取消的阅读器里，读了一半的论文散落各处。每个工具都想成为你知识的归宿——在它的服务器上、它的格式里、它的登录后面。',
    whyBody2:
      'localmd 反着赌：你的知识就是你自己电脑上一个文件夹里的文件。可以用任何编辑器打开的 Markdown、你本来就有的 PDF 和 EPUB、你愿意留下的对话。一个 AI agent 在这个文件夹里陪你干活——但文件夹是你的，它永远不离开你的机器。',

    diffLabel: '与别的产品有什么不同',
    diff1Title: '是你的文件夹，不是我们的数据库。',
    diff1Body:
      '全都是纯 Markdown 和你的原始文件，就在你选的那个文件夹里。用 VS Code 打开、用 git 同步，或者随时走人——没有「导出」，因为它从没被锁进去过。',
    diff2Title: '真正的本地优先。',
    diff2Body:
      '无账号、无注册、无服务器。文件通过浏览器的 File System Access API 读写。localmd 是一个静态页面——没有后端可以上传任何东西。',
    diff3Title: '自带你的模型。',
    diff3Body:
      '填入你自己的 API Key——Anthropic、OpenAI、DeepSeek、Gemini 等等——各自直连各自的端点。你的 Key 和文本只去你选的那个模型，别无他处。',
    diff4Title: '真正在你文件里干活的 agent。',
    diff4Body:
      '不是硬塞进笔记的聊天框。它读你的 PDF 和 EPUB 并附引用、撰写和链接 Markdown 页面、经你批准直接编辑文件。',
    diff5Title: '结构是建议，不是牢笼。',
    diff5Body:
      '没有死板的模板。打开一个空文件夹，它给你一套起手布局；打开你已有的笔记，它顺着你本来的组织方式来。',

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

    doesLabel: 'localmd 能做什么',
    does1: '用 [[wikilinks]] 互链的 Markdown 笔记，配图谱视图',
    does2: '应用内阅读 PDF 和 EPUB，带块级引用回链到你的笔记',
    does3: '带工具的 AI agent：搜索、读、写、改、计划、运行 skills、调用 MCP 服务器',
    does4: '多家自带 Key、用于图像的视觉模型、可选的图像生成',
    does5: '把对话存成 Markdown，再蒸馏进笔记',
    does6: '用内置 git 为知识库做版本管理，并同步到 GitHub',
    does7: '可安装、可离线——一切都缓存在你的设备上',

    dontLabel: '我们不做的事',
    dont1: '不要账号。思考不需要先注册。',
    dont2: '不在服务器上存你的文件。我们根本没有地方放。',
    dont3: '不上传你的笔记。除非你把文本发给你自己的模型，否则它们只待在你的文件夹里。',
    dont4: '没有广告、没有推送、没有「阅读目标」。',
    dont5: '不锁定。就是文件夹里的 Markdown——想走随时走。',
    dont6: '不替你保管 API Key。它就在你的浏览器里，你随时能清除。',

    closingTitle: '打开一个文件夹，开始思考。',
    footer: 'localmd · 浏览器里的本地优先 AI 知识库',
  },
}
