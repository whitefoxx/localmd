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
    staleHeading: 'Indexes without their document',
    staleDesc:
      'A document\u2019s search index is a folder of its own, and it does not go away when the document is renamed or deleted. It keeps answering to that document\u2019s passage numbers, which is why a citation into a book you removed can still look alive.',
    staleGone: 'the document is gone \u2014 the index can be cleaned up',
    staleRenamed: 'the same file is now {path} \u2014 the old citations can be recovered',
    staleAction: 'Sort these out',
    stalePrompt:
      'These index directories under .localmd/ no longer have the document they were built from:\n\n{list}\n\nFor one whose file was renamed, recover the citations: index_document with adoptIdsFrom set to the old directory, so the block ids published before the rename resolve again — then tell me to spot-check a couple. For one whose document is simply gone, propose deleting the directory. Do neither until I have said yes to that specific one.',
    undeclaredHeading: 'Citations with no source named',
    undeclaredDesc:
      'These pages cite passages — “as it says at [1]” — without saying which document the numbering belongs to. Passage numbers are counted within each document, so several can answer to the same one, and the app is left matching by number alone. One declared line on the page ends that.',
    undeclaredSuggest: 'the page it links to says {path}',
    undeclaredUnknown: 'nothing it links to says which document',
    undeclaredAction: 'Add the missing declarations',
    undeclaredPrompt:
      'These pages cite [[N:block]] passages without declaring the source N on the page itself:\n\n{list}\n\nWhere a line is given, it comes from the source page that page links to — add it near the top of each, changing nothing else. Where the source is unknown, do not guess: list those back to me and I will say which document each one meant. Show me the plan before writing.',
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
    staleHeading: '文档已不在的索引',
    staleDesc:
      '一份文档的检索索引是一个独立的文件夹，文档被改名或删掉时它不会跟着消失。它会继续认领那份文档的段落编号——所以指向一本你已经删掉的书的引用，看上去还是好好的。',
    staleGone: '文档已不存在——这份索引可以清掉',
    staleRenamed: '同一个文件现在叫 {path}——旧引用可以救回来',
    staleAction: '处理一下',
    stalePrompt:
      '`.localmd/` 下这些索引目录，已经没有当初据以构建的那份文档了：\n\n{list}\n\n如果是文件被改了名，请把引用救回来：调用 index_document 并把 adoptIdsFrom 设为旧目录，让改名之前发布的块编号重新解析得到——然后提醒我抽查两条。如果是文档确实没了，请提议删掉那个目录。在我对某一条明确说了「可以」之前，两件事都不要动手。',
    undeclaredHeading: '没有指明来源的引用',
    undeclaredDesc:
      '这些页面引用了段落——「正如 [1] 所说」——却没有说这套编号属于哪份文档。段落编号是每份文档内部各自编的，好几份文档可能都含有同一个编号，应用就只能靠编号去匹配。在页面里写上一行声明就没这问题了。',
    undeclaredSuggest: '它链接的页面指向 {path}',
    undeclaredUnknown: '它链接的页面都没说是哪一份',
    undeclaredAction: '补上来源声明',
    undeclaredPrompt:
      '这些页面引用了 [[N:块编号]]，却没有在页面里声明来源 N：\n\n{list}\n\n凡是给出了那一行的，它来自该页面链接过去的来源页——把它加到每一页靠前的位置，别的什么都不要动。来源未知的那些不要猜：把它们列回给我，我来说每一条指的是哪份文档。动手前先把计划给我看。',
    allClear: '没有发现',
    jumpTo: '跳到 {path} 中的 {target}',
    editScope: '检测范围设置',
  },
}
