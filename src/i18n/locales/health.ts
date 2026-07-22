/** KB health panel: broken links, orphan pages. Namespace: `health`. */
export default {
  en: {
    title: 'KB health',
    // Intro paragraph is split around inline <code> samples in the template.
    introBefore:
      "Structural checks over your wiki's link graph — page contents aren't read. Citations like",
    introMiddle: 'are ignored; only real page-to-page',
    introAfter: 'count.',
    brokenHeading: 'Broken wikilinks ({n})',
    brokenDesc:
      'These pages link to a target with no matching file. Click a target to jump to it in the page and fix or remove the link.',
    orphansHeading: 'Orphan pages ({n})',
    orphansDesc:
      'Nothing links to them and they link nowhere — unreachable by navigation. Link them from a related page or an index.',
    allClear: 'None 🎉',
    jumpTo: 'Jump to {target} in {path}',
  },
  zh: {
    title: '知识库健康度',
    introBefore: '对 wiki 链接图谱的结构检查——不读取页面内容。像',
    introMiddle: '这样的引用会被忽略；只统计真正的页面到页面',
    introAfter: '。',
    brokenHeading: '断链 wikilinks（{n}）',
    brokenDesc: '这些页面链向了没有对应文件的目标。点击目标可跳到页面中的位置，修正或删除链接。',
    orphansHeading: '孤立页面（{n}）',
    orphansDesc: '没有任何页面链向它们，它们也不链向别处——导航无法到达。从相关页面或索引里链接它们。',
    allClear: '无 🎉',
    jumpTo: '跳到 {path} 中的 {target}',
  },
}
