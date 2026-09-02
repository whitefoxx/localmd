/**
 * Graph view. Namespace: `graph`.
 *
 * The canvas itself is a pure d3-force drawing: its text nodes are file stems
 * (data, not UI copy). The strings here are the two halves of the wait before a
 * graph appears, the tag toggle in the header bar, and the card that answers
 * "what is this node" beside the picture.
 */
export default {
  en: {
    reading: 'Reading your pages…',
    laying: 'Laying out the graph…',
    showTags: 'Tags',
    showTagsHint:
      'Draw each tag as a node joined to every page carrying it. Click one to see what it holds.',
    previewLocate: 'Find it on the graph',
    searchPlaceholder: 'Find a page…',
    searchNone: 'No page here goes by that name.',
    previewOpen: 'Open this file',
    previewSearchTag: 'Search for this tag',
    previewBack: 'Back to the page you came from',
    previewExpand: 'Fill the window',
    previewShrink: 'Back to the side',
    previewSaved: 'Saved',
    previewSaving: 'Saving…',
    previewClose: 'Close',
    previewEmpty: 'This page has no text yet.',
    previewNoPages: 'No page carries this tag.',
    previewBinary: '{format} file — not text, so there is nothing to show here.',
    previewTruncated: 'Only the beginning is shown. Open the file to read the rest.',
  },
  zh: {
    reading: '正在读取页面……',
    laying: '正在计算图谱布局……',
    showTags: '标签',
    showTagsHint: '把每个 tag 画成一个节点，连向所有带它的页面。点一下看看它下面有什么。',
    previewLocate: '在图上定位它',
    searchPlaceholder: '找一个页面……',
    searchNone: '这里没有叫这个名字的页面。',
    previewOpen: '打开这个文件',
    previewSearchTag: '搜索这个标签',
    previewBack: '回到刚才那一页',
    previewExpand: '铺满窗口',
    previewShrink: '回到侧边',
    previewSaved: '已保存',
    previewSaving: '正在保存……',
    previewClose: '关闭',
    previewEmpty: '这个页面还没有正文。',
    previewNoPages: '没有页面带这个标签。',
    previewBinary: '{format} 文件——不是文本，这里没有内容可显示。',
    previewTruncated: '只显示了开头。打开文件看全文。',
  },
}
