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
    allClear: '没有发现',
    jumpTo: '跳到 {path} 中的 {target}',
    editScope: '检测范围设置',
  },
}
