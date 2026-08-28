/** Sidebar panel for the current file: what links here, and what else the
 *  knowledge base has about it. Namespace: `backlinks`. */
export default {
  en: {
    heading: 'Backlinks ({n})',
    empty: 'No backlinks',
    // The ambient half of recall: computed from the index, never stored, and
    // never sent to the model — it costs nothing, so it can afford to be a
    // suggestion.
    relatedHeading: 'Related ({n})',
    sharedTags: 'shares {list}',
    sharedSources: 'cites {list}',
  },
  zh: {
    heading: 'Backlinks（{n}）',
    empty: '没有 backlink',
    relatedHeading: '相关（{n}）',
    sharedTags: '同为 {list}',
    sharedSources: '同样引用 {list}',
  },
}
