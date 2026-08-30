/**
 * The warning shown before an index build could hand an already-cited block id
 * to a different passage. Namespace: `renumber`.
 *
 * Written as sentences that compose (stake + reason + remedy), because the same
 * three facts are needed in three places — a notice in a viewer, a native
 * confirm on a button, and a decision card in the transcript — and three
 * separately-worded versions of one warning is three chances to disagree.
 */
export default {
  en: {
    stake: 'Your notes cite {ids} passage(s) in this document, across {pages} page(s).',
    noRecord:
      'The record of where those ids point is not on this machine — it lives in .localmd/, which git does not carry — so indexing here numbers the passages from scratch. Every citation would still open, but some may land on a different paragraph.',
    sourceChanged:
      'The file has changed since those ids were made, so the stored positions no longer describe it and cannot be carried over. Some citations may land on a different paragraph.',
    noInheritance:
      'This format numbers passages from the document’s own structure and has no way to carry old ids over, and the algorithm has changed since this index was built. Some citations may land on a different paragraph.',
    remedy:
      'To keep them exact, copy .localmd/ from the machine that built the index before indexing here.',
    proceed: 'Index it anyway?',
    badge: 'Indexing paused',
    badgeHint: 'This document was not indexed, because doing so could re-point citations your notes already carry. Click to see what is at stake.',
  },
  zh: {
    stake: '你的笔记里有 {ids} 处引用指向这份文档，分布在 {pages} 个页面。',
    noRecord:
      '这些编号指向哪里的记录不在这台机器上——它在 `.localmd/` 里，而 git 不会带上它——所以在这里建索引会重新编号。引用仍然都能打开，但有些可能落到别的段落。',
    sourceChanged:
      '文件在这些编号生成之后改动过，存下来的位置已经描述不了它，无法沿用。有些引用可能落到别的段落。',
    noInheritance:
      '这种格式按文档自身的结构编号，没有沿用旧编号的机制，而算法在这个索引建成之后变过。有些引用可能落到别的段落。',
    remedy: '想让它们保持准确，先把建索引那台机器上的 `.localmd/` 拷过来，再在这里建索引。',
    proceed: '仍然建立索引？',
    badge: '索引已暂停',
    badgeHint: '这份文档没有建立索引，因为建索引可能让你笔记里已有的引用指向别处。点击查看具体情况。',
  },
}
