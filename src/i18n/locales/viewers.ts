/**
 * Document viewers & readers: PDF, EPUB, artifact, annotations, markdown.
 * One shared namespace: `viewers`, grouped by component.
 */
export default {
  en: {
    zen: 'Zen mode — hide everything but the page (Esc leaves)',
    // Shared across readers.
    selection: 'Selection',
    index: {
      // OCR is a reading, not a transcript. Said where the reader lands after
      // clicking a citation, because that is the moment the difference bites.
      recognised: 'Text recognised',
      recognisedHint:
        'This document has no text layer, so its text was recognised from pictures of the pages. Citations still land on the right passage, but the wording can contain mistakes — check anything you quote against the page.',
      updateAvailable: 'Update index',
      updateHint:
        'The AI index was built by an older version of the app. It still works as it is — click to rebuild with the current one. Citations in your notes keep working either way.',
    },

    // The offer to write a source note. Shown only while no page in the KB
    // cites this document — an offer, never a nag: the detection is free, the
    // writing costs tokens, so a click sits between them.
    // A scanned PDF is not a broken one, and "0 blocks" said nothing useful
    // to anybody. This says what happened, what still works, and stops.
    dismiss: 'Dismiss',
    scanned: {
      title: 'No text layer — this looks like a scan',
      body: 'Every page is a picture, so there is nothing for the index to quote and the assistant cannot cite passages from it. Reading, highlighting, annotating and read-aloud all work as usual, and anything you write about it in your own notes is unaffected.',
      // Reading the pictures is offered, never done uninvited: it is minutes
      // of this machine's CPU, so the size of the bill is on the button.
      offer: 'Read the pictures',
      language: 'Language',
      // The number is the point. A three-hundred-page book is most of an
      // hour, and finding that out afterwards is finding it out too late.
      start: 'Recognise {n} pages',
      estimate: 'Roughly {mins} min on this machine. It runs here, so the document stays in the folder — but the alphabet is downloaded the first time you use a language.',
      // Before page one there is a wait with nothing to count: the engine
      // starts and, the first time a language is used, its data is fetched.
      // Reported as "page 0 of 311" it reads as stuck.
      preparing: 'Getting the language ready…',
      running: 'Reading page {c} of {t}…',
      cancel: 'Cancel',
      // Said plainly because cancelling really does throw the work away.
      cancelled: 'Cancelled — nothing was written.',
      failed: 'Could not read the pages: {msg}',
      done: 'Read {n} passages from the pictures. Citations into this document work now.',
      empty: 'Nothing legible came back. A different language, or a sharper scan, may do better.',
    },

    sourceNote: {
      write: 'Write a note',
      hint: 'No page in this knowledge base cites this document yet. This drafts a request to the assistant — you can edit it before sending.',
      prompt:
        'Read {path} and write a source note for it in this knowledge base: a page following the layout already in use here, with `type: source` and a few tags in the frontmatter, a short summary of what it says, and a `[[pdf1:{path}]]` source declaration so citations into it work. Link it from the index page. Show me the plan first if more than one file would change.',
    },

    pdf: {
      loading: 'Opening PDF…',
      loadingSlow: 'Opening PDF — the first one takes longest…',
      restoring: 'Jumping to where you left off…',
      readAloud: 'Read aloud',
      note: 'Note',
      underline: 'Underline',
      viewAnnotations: 'View annotations',
      indexStarting: 'Starting…',
      indexExtracting: 'Extracting page {c}/{t}',
      indexBuilding: 'Building the index…',
      indexBuildingN: 'Building section {c}/{t}',
      indexWriting: 'Writing index {c}/{t}',
      indexAlready: 'Already indexed',
      indexDone: 'Indexed',
      indexSections: '{n} sections',
      indexFailed: 'Indexing failed',
    },

    epub: {
      toc: 'Table of contents',
      noNav: 'No navigation',
      smallerText: 'Smaller text',
      largerText: 'Larger text',
      searchInBook: 'Search in book',
      readChapter: 'Read this chapter aloud',
      viewAnnotations: 'View annotations',
      searchPlaceholder: 'Search in book…',
      searching: 'Searching…',
      results: '{n} results',
      resultsOne: '{n} result',
      noMatches: 'No matches.',
      prevPage: 'Previous page',
      nextPage: 'Next page',
      backToPage: 'Back to page {page}',
      backToOrigin: 'Back to where you jumped from',
      highlightColor: 'Highlight {name}',
      readSelection: 'Read selection aloud',
      underlineRed: 'Underline (red)',
      note: 'Note',
      deleteMark: 'Delete mark',
    },

    artifact: {
      preview: 'Preview',
      source: 'Source',
      openNewTab: 'Open in a new tab (sandboxed)',
      newTab: 'New tab',
    },

    annotations: {
      category: {
        highlight: 'Highlight',
        underline: 'Underline',
        note: 'Comment',
        other: 'Annotation',
      },
      count: '{n} annotations',
      openSource: 'Open source book',
      sourceMissing: 'Source file missing — cannot jump',
      empty: 'No annotations yet — select text in the reader to highlight it',
      page: 'Page {page}',
      jumpTitle: 'Click to jump to the passage',
      noExcerpt: '(no excerpt text)',
      notePlaceholder: 'Jot down a thought… (⌘↵ to save, Esc to cancel)',
      editComment: 'Click to edit comment',
      addComment: 'Add comment',
      changeTo: 'Change to {name}',
      deleteAnnotation: 'Delete annotation',
    },

    markdown: {
      createPagePrompt: 'This page does not exist. Create {target}?',
    },

    docx: {
      loading: 'Opening document…',
      loadFailed: 'Could not read this Word document.',
      indexing: 'Indexing for AI…',
      indexed: 'Indexed · {n} blocks',
      indexFailed: 'Indexing failed',
      legacyTitle: 'Legacy .doc format',
      legacyHint:
        'Word 97–2003 (.doc) is a binary format that cannot be read in the browser. Open it in Word or Pages and save a copy as .docx.',
      viewAnnotations: 'View annotations',
      highlightColor: 'Highlight {name}',
      readSelection: 'Read selection aloud',
      underlineRed: 'Underline (red)',
      note: 'Note',
      deleteMark: 'Delete mark',
    },

    media: {
      cantPlay:
        "This browser can't decode {name} — its codec isn't supported here. A dedicated player may still open it.",
    },

    image: {
      zoomIn: 'Zoom in (+)',
      zoomOut: 'Zoom out (−)',
      actual: 'Actual size (1)',
      fit: 'Fit',
      // Says what the two gestures are, because neither is discoverable.
      fitHint: 'Fit to the pane (0) — double-click the picture, or pinch to zoom',
    },

    csv: {
      empty: 'Empty file.',
      rowsCut: 'Showing the first {shown} of {total} rows.',
      colsCut: 'Some columns are not shown.',
    },

    sheet: {
      loading: 'Opening workbook…',
      loadFailed: 'Could not read this workbook.',
      legacyTitle: 'Legacy .xls format',
      legacyHint:
        'Excel 97–2003 (.xls) is a binary format that cannot be read in the browser. Open it in Excel or Numbers and save a copy as .xlsx.',
      cut: 'Showing the first {shown} of {total} rows.',
      empty: 'This sheet is empty.',
    },

    slides: {
      loading: 'Opening deck…',
      loadFailed: 'Could not read this deck.',
      legacyTitle: 'Legacy .ppt format',
      legacyHint:
        'PowerPoint 97–2003 (.ppt) is a binary format that cannot be read in the browser. Open it in PowerPoint or Keynote and save a copy as .pptx.',
      outlineHint: 'Outline view — text and pictures, not the original slide layout.',
      empty: 'No slides in this deck.',
    },
  },
  zh: {
    zen: '禅模式 —— 只留下页面（Esc 退出）',
    selection: '选中内容',
    index: {
      recognised: '文字为识别所得',
      recognisedHint:
        '这份文档没有文本层，正文是从页面图片里识别出来的。引用仍会落到正确的段落，但字句可能有误——引用前最好对照原页核一下。',
      updateAvailable: '更新索引',
      updateHint:
        'AI 索引由旧版本生成。不更新也能正常使用——点击用当前版本重建。无论是否重建，笔记里已有的引用都不受影响。',
    },

    dismiss: '知道了',
    scanned: {
      title: '没有文本层——这看起来是扫描件',
      body: '每一页都是图片，索引没有文字可以引用，助手也无法引用其中的段落。阅读、划线、标注和朗读照常可用，你自己在笔记里写的关于它的内容也不受影响。',
      offer: '识别页面上的文字',
      language: '语言',
      start: '识别 {n} 页',
      estimate: '在这台机器上大约需要 {mins} 分钟。识别在本地进行，文档不会离开文件夹——但第一次用某种语言时会下载它的字库。',
      preparing: '正在准备字库……',
      running: '正在识别第 {c} / {t} 页……',
      cancel: '取消',
      cancelled: '已取消——没有写入任何内容。',
      failed: '识别失败：{msg}',
      done: '从图片里读出 {n} 段文字。现在可以引用这份文档了。',
      empty: '没有识别出可用的文字。换一种语言，或者用更清晰的扫描件，也许会好一些。',
    },

    sourceNote: {
      write: '写一篇笔记',
      hint: '这个知识库里还没有任何页面引用这份文档。点击会给助手起草一条请求——发送前你可以修改。',
      prompt:
        '读一下 {path}，在这个知识库里为它写一篇源笔记：按这里已有的布局建页面，frontmatter 里写上 `type: source` 和几个 tag，正文给一段简短的内容摘要，并加上 `[[pdf1:{path}]]` 的源声明，好让引用能跳转。把它从索引页链接过去。如果会改动不止一个文件，先把计划给我看。',
    },

    pdf: {
      loading: '正在打开 PDF…',
      loadingSlow: '正在打开 PDF —— 第一次打开最慢…',
      restoring: '跳转到上次阅读位置…',
      readAloud: '朗读',
      note: '笔记',
      underline: '下划线',
      viewAnnotations: '查看标注',
      indexStarting: '开始…',
      indexExtracting: '提取第 {c}/{t} 页',
      indexBuilding: '正在构建索引……',
      indexBuildingN: '构建第 {c}/{t} 节',
      indexWriting: '写入索引 {c}/{t}',
      indexAlready: '已索引',
      indexDone: '已索引',
      indexSections: '{n} 个段落',
      indexFailed: '索引失败',
    },

    epub: {
      toc: '目录',
      noNav: '无目录',
      smallerText: '缩小字号',
      largerText: '放大字号',
      searchInBook: '书内搜索',
      readChapter: '朗读本章',
      viewAnnotations: '查看标注',
      searchPlaceholder: '书内搜索…',
      searching: '搜索中…',
      results: '{n} 条结果',
      resultsOne: '{n} 条结果',
      noMatches: '没有匹配。',
      prevPage: '上一页',
      nextPage: '下一页',
      backToPage: '回到第 {page} 页',
      backToOrigin: '回到跳转前的位置',
      highlightColor: '高亮 {name}',
      readSelection: '朗读选中',
      underlineRed: '下划线（红色）',
      note: '笔记',
      deleteMark: '删除划线',
    },

    artifact: {
      preview: '预览',
      source: '源码',
      openNewTab: '在新标签页打开（沙箱隔离）',
      newTab: '新标签页',
    },

    annotations: {
      category: {
        highlight: '高亮',
        underline: '下划线',
        note: '评论',
        other: '标注',
      },
      count: '{n} 条标注',
      openSource: '打开原书',
      sourceMissing: '原书文件不存在，无法跳转',
      empty: '这本书还没有标注 — 在阅读器里选中文字即可高亮',
      page: '第 {page} 页',
      jumpTitle: '点击跳转到原文位置',
      noExcerpt: '（无摘录文本）',
      notePlaceholder: '写点想法…（⌘↵ 保存，Esc 取消）',
      editComment: '点击编辑评论',
      addComment: '添加评论',
      changeTo: '改为 {name}',
      deleteAnnotation: '删除标注',
    },

    markdown: {
      createPagePrompt: '页面不存在，是否创建 {target}？',
    },

    docx: {
      loading: '正在打开文档…',
      loadFailed: '无法读取这个 Word 文档。',
      indexing: '正在建立 AI 索引…',
      indexed: '已索引 · {n} 个片段',
      indexFailed: '索引失败',
      legacyTitle: '旧版 .doc 格式',
      legacyHint:
        'Word 97–2003 的 .doc 是二进制格式，浏览器无法解析。请用 Word 或 Pages 打开后另存为 .docx。',
      viewAnnotations: '查看标注',
      highlightColor: '高亮 {name}',
      readSelection: '朗读选中',
      underlineRed: '下划线（红色）',
      note: '笔记',
      deleteMark: '删除划线',
    },

    media: {
      cantPlay: '浏览器无法解码 {name}——不支持这个格式的编解码器。用本地播放器应该仍能打开。',
    },

    image: {
      zoomIn: '放大（+）',
      zoomOut: '缩小（−）',
      actual: '原始尺寸（1）',
      fit: '适应',
      fitHint: '适应窗口（0）——也可以双击图片，或用触控板捏合缩放',
    },

    csv: {
      empty: '空文件。',
      rowsCut: '仅显示前 {shown} 行，共 {total} 行。',
      colsCut: '部分列未显示。',
    },

    sheet: {
      loading: '正在打开工作簿…',
      loadFailed: '无法读取这个工作簿。',
      legacyTitle: '旧版 .xls 格式',
      legacyHint:
        'Excel 97–2003 的 .xls 是二进制格式，浏览器无法解析。请用 Excel 或 Numbers 打开后另存为 .xlsx。',
      cut: '仅显示前 {shown} 行，共 {total} 行。',
      empty: '这个工作表是空的。',
    },

    slides: {
      loading: '正在打开演示文稿…',
      loadFailed: '无法读取这个演示文稿。',
      legacyTitle: '旧版 .ppt 格式',
      legacyHint:
        'PowerPoint 97–2003 的 .ppt 是二进制格式，浏览器无法解析。请用 PowerPoint 或 Keynote 打开后另存为 .pptx。',
      outlineHint: '大纲视图——只显示文字和图片，不还原原始版式。',
      empty: '这个演示文稿没有幻灯片。',
    },
  },
}
