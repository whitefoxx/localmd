/**
 * The citation picker — what a chip says when the id alone cannot name one
 * document, or names one that is no longer in the folder. Namespace:
 * `citations`.
 */
export default {
  en: {
    pickTitle: 'Which document does {id} mean?',
    pickBody:
      'Block ids are numbered within each document, so {n} of them contain this one. This page does not say which — declaring the source on the page ([[pdf1:…]]) makes the answer exact.',
    goneTitle: 'That source is not in this folder',
    goneBody:
      'Nothing that still exists contains {id}. The document it cited was probably renamed or removed; its index can outlive it, which is why the citation still looked live.',
    goneDeclared: '{path} is not in the knowledge base — renamed, moved out, or deleted.',
  },
  zh: {
    pickTitle: '{id} 指的是哪一份文档？',
    pickBody:
      '块编号是每份文档内部各自编的，所以有 {n} 份文档都含有这一个。这个页面没有说是哪一份——在页面里声明来源（`[[pdf1:…]]`）就不用猜了。',
    goneTitle: '这条引用的源文件不在这个文件夹里',
    goneBody:
      '现存的文档里没有 {id}。它引用的那份文档多半被改名或删掉了——索引会比源文件活得久，所以这条引用看上去还是好的。',
    goneDeclared: '{path} 不在知识库里——被改名、移走或删掉了。',
  },
}
