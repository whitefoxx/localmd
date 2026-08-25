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
      updateAvailable: 'Update index',
      updateHint:
        'The AI index was built by an older version of the app. It still works as it is — click to rebuild with the current one. Citations in your notes keep working either way.',
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
      indexNoText: 'no text layer (scanned?)',
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
      updateAvailable: '更新索引',
      updateHint:
        'AI 索引由旧版本生成。不更新也能正常使用——点击用当前版本重建。无论是否重建，笔记里已有的引用都不受影响。',
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
      indexNoText: '无文本层（扫描件？）',
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
