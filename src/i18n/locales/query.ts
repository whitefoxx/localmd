/** The `localmd-query` block: a question saved in a note and answered fresh on
 *  every render. Namespace: `query`. */
export default {
  en: {
    count: '{n} pages',
    countCapped: '{shown} of {total} pages',
    empty: 'Nothing matches this query.',
    // Only ever shown with an empty result: a filter nothing satisfies cannot
    // leave a row standing, so naming it and saying "nothing matches" would be
    // the same sentence twice.
    emptyUnknown: 'Nothing matches — nothing here satisfies {terms}.',
    badQuery: 'This query could not be read:',
    canWrite: 'What a query can ask for:',
    // One line per filter, shown for whichever row the palette is sitting on.
    // Written for someone who has never seen the grammar: what it finds, not
    // how it parses.
    filter: {
      tag: 'Pages carrying this tag — and documents that inherited it',
      type: 'Pages whose type is this one',
      path: 'Anything inside this folder',
      fm: 'Any other field at the top of a page: status=draft, rating>=4',
      role: 'The index page, or the log',
      orphan: 'Pages nothing links to',
      broken: 'Pages with a link that goes nowhere',
      age: 'How long since it was last touched: <30d, >6m',
      modified: 'Changed before, or after, a date',
      'links-to': 'Pages that link to the one you name',
      'linked-by': 'Pages linked to from the one you name',
      cites: 'Pages that declare this document as a source',
      sort: 'Order the results — a minus in front counts down',
      limit: 'Show at most this many; the true total is still reported',
      columns: 'Extra fields to show for each result',
    },
  },
  zh: {
    count: '{n} 个页面',
    countCapped: '{total} 个页面中的 {shown} 个',
    empty: '没有页面匹配这个查询。',
    emptyUnknown: '没有匹配——这里没有任何东西满足 {terms}。',
    badQuery: '这个查询读不了：',
    canWrite: '一个查询可以问这些：',
    filter: {
      tag: '带这个标签的页面——以及继承了它的文档',
      type: 'type 是这个的页面',
      path: '这个目录下的一切',
      fm: '页面顶部的任何其他字段：status=draft、rating>=4',
      role: '索引页，或者 log',
      orphan: '没有任何页面链接过去的页面',
      broken: '带死链的页面',
      age: '距上次改动过了多久：<30d、>6m',
      modified: '在某个日期之前或之后改过',
      'links-to': '链接到你指定的那个页面的页面',
      'linked-by': '被你指定的那个页面链接过去的页面',
      cites: '把这个文档声明为来源的页面',
      sort: '结果怎么排——前面加减号是倒序',
      limit: '最多显示这么多；真实总数仍会报出',
      columns: '每条结果额外显示哪些字段',
    },
  },
}
