/**
 * Graph view. Namespace: `graph`.
 *
 * GraphView.vue is a pure d3-force canvas: its text nodes are file stems
 * (data, not UI copy), so the only strings here are the two halves of the wait
 * before a graph appears — reading the pages, then working out where they go.
 */
export default {
  en: {
    reading: 'Reading your pages…',
    laying: 'Laying out the graph…',
    showTags: 'Tags',
    showTagsHint:
      'Draw each tag as a node joined to every page carrying it. Click one to search for it.',
  },
  zh: {
    reading: '正在读取页面……',
    laying: '正在计算图谱布局……',
    showTags: '标签',
    showTagsHint: '把每个 tag 画成一个节点，连向所有带它的页面。点一下就搜索它。',
  },
}
