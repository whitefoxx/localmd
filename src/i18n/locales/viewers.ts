/**
 * Document viewers & readers: PDF, EPUB, artifact, annotations, markdown.
 * One shared namespace: `viewers`, grouped by component.
 */
export default {
  en: {
    // Shared across readers.
    selection: 'Selection',

    pdf: {
      restoring: 'Jumping to where you left off…',
      readAloud: 'Read aloud',
      note: 'Note',
      underline: 'Underline',
      viewAnnotations: 'View annotations',
      indexStarting: 'Starting…',
      indexExtracting: 'Extracting page {c}/{t}',
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
  },
  zh: {
    selection: '选中内容',

    pdf: {
      restoring: '跳转到上次阅读位置…',
      readAloud: '朗读',
      note: '笔记',
      underline: '下划线',
      viewAnnotations: '查看标注',
      indexStarting: '开始…',
      indexExtracting: '提取第 {c}/{t} 页',
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
  },
}
