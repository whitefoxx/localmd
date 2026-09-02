/** The `localmd-query` block: a question saved in a note and answered fresh on
 *  every render. Namespace: `query`. */
export default {
  en: {
    count: '{n} pages',
    countCapped: '{shown} of {total} pages',
    empty: 'Nothing matches this query.',
    // Only ever shown together with an empty result: a term nothing in the KB
    // satisfies cannot leave any row standing, so saying "nothing matches"
    // first and naming the term second is the same sentence twice.
    emptyUnknown: 'Nothing matches: this knowledge base has no {terms}.',
    badQuery: 'This query could not be read:',
    unknown: 'Nothing in this knowledge base matches: {terms}',
  },
  zh: {
    count: '{n} 个页面',
    countCapped: '{total} 个页面中的 {shown} 个',
    empty: '没有页面匹配这个查询。',
    emptyUnknown: '没有匹配：这个知识库里没有 {terms}。',
    badQuery: '这个查询读不了：',
    unknown: '这个知识库里没有：{terms}',
  },
}
