/** KB health panel: broken links, orphan pages. Namespace: `health`. */
export default {
  en: {
    title: 'KB health',
    // Intro paragraph is split around inline <code> samples in the template,
    // each of which explains itself on hover (…Hint below).
    introBefore:
      "Structural checks over your wiki's link graph — page contents aren't read. Citations like",
    introMiddle: 'are ignored; only real page-to-page',
    introAfter: 'count.',
    citationHint:
      'A citation into a source document: page 1, block b14-3 of a PDF or EPUB in your folder. It points at a place inside a file rather than at a page, so it has no page to be broken against and is skipped here.',
    wikilinkHint:
      "A link from one page to another by file name. These are the edges of the graph — following them is what finds a target that isn't there, and a page nothing reaches.",
    brokenHeading: 'Broken wikilinks',
    brokenDesc:
      'These pages link to a target with no matching file. Click a target to jump to it in the page and fix or remove the link.',
    orphansHeading: 'Orphan pages',
    orphansDesc:
      'Nothing links to them and they link nowhere — unreachable by navigation. Link them from a related page or an index.',
    unreadHeading: 'Documents with no note',
    unreadDesc:
      'PDFs, EPUBs and Word files no page cites yet. They are in the folder but not in the knowledge base — nothing can find them by tag, and nothing links them. Writing a note is what changes that.',
    unreadAction: 'Write notes for these',
    unreadPrompt:
      'These documents are in the knowledge base but no page cites any of them yet:\n\n{list}\n\nWrite a source note for each, following the layout already in use here: `type: source` and a few tags in the frontmatter, a short summary of what it says, a `[[pdf1:path]]` source declaration so citations resolve, and a link in from the index page. Show me the plan before writing anything, and start with three unless I say otherwise — reading them all could be expensive.',
    allClear: 'Nothing found',
    jumpTo: 'Jump to {target} in {path}',
    editScope: 'What gets scanned (settings)',
  },
  zh: {
    title: '知识库健康度',
    introBefore: '对 wiki 链接图谱的结构检查——不读取页面内容。像',
    introMiddle: '这样的引用会被忽略；只统计真正的页面到页面',
    introAfter: '。',
    citationHint:
      '指向原始文档的引用：文件夹里某个 PDF 或 EPUB 的第 1 页、b14-3 块。它指向的是文件内部的某个位置，不是某个页面，没有「目标页面不存在」这回事，所以这里不检查它。',
    wikilinkHint:
      '从一个页面按文件名链到另一个页面。这些就是图谱的边——顺着它们走，才能发现链向不存在目标的链接，以及没有任何路径能到达的页面。',
    brokenHeading: '断链 wikilinks',
    brokenDesc: '这些页面链向了没有对应文件的目标。点击目标可跳到页面中的位置，修正或删除链接。',
    orphansHeading: '孤立页面',
    orphansDesc: '没有任何页面链向它们，它们也不链向别处——导航无法到达。从相关页面或索引里链接它们。',
    unreadHeading: '还没有笔记的文档',
    unreadDesc:
      '还没有任何页面引用过的 PDF、EPUB 和 Word 文件。它们在文件夹里，但不在知识库里——按 tag 找不到它们，也没有任何链接指向它们。写一篇笔记才会改变这一点。',
    unreadAction: '为它们写笔记',
    unreadPrompt:
      '知识库里有这些文档，但还没有任何页面引用过它们：\n\n{list}\n\n请按这里已有的布局为每一篇写一则源笔记：frontmatter 里写 `type: source` 和几个 tag，正文给一段简短的内容摘要，加上 `[[pdf1:路径]]` 的源声明好让引用能跳转，并从索引页链接过去。动手前先把计划给我看，而且除非我另说，先做三篇——把它们全读一遍可能很贵。',
    allClear: '没有发现',
    jumpTo: '跳到 {path} 中的 {target}',
    editScope: '检测范围设置',
  },
}
