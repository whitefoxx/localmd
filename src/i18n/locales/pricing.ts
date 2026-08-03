/** Pricing section on the start screen, and its dialog. Namespace: `pricing`. */
export default {
  en: {
    label: 'Pricing',
    title: 'Free, with one paid part',
    // The boundary, phrased so a reader can apply it themselves rather than
    // memorising a feature list.
    line: 'Anything you can do with your own folder and your own model is free forever — it is your key and your money, and there are no usage caps.',
    freeTitle: 'Free, always',
    freeBody:
      'Reading and writing your notes, PDFs and EPUBs with citations that click back to the paragraph, the assistant and everything it does in your folder, subagents, your own skills, web search, and git on your own machine.',
    paidTitle: 'Paid',
    paidBody:
      'What reaches past your folder and your model: the browser extension, MCP servers you connect, tools built against outside services, and syncing with GitHub.',
    price: '${n} once',
    priceNote: 'Includes a year of updates. No account, no subscription, checked in your browser.',
    notLive: 'Not live yet — nothing is charged today, and nothing is held back.',
    cta: 'How the paid part works',

    dialogTitle: 'The paid part',
    dialogNotLive:
      'It is not on sale yet. Everything described as paid is currently working for everyone, and will keep working until there is a way to buy it.',
    slotsTitle: 'Early access',
    slotsBody:
      '{left} of {total} slots left. Take one and you get a key for {days} days, in exchange for telling me where it breaks.',
    // The anti-claim, stated in the offer rather than discovered at expiry.
    slotsNote:
      'It is {days} days, not forever. When it runs out you get the returning price, the paid parts go back to locked, and nothing in your folder changes.',
    slotsCta: 'Ask for a slot',
    close: 'Close',
  },
  zh: {
    label: '价格',
    title: '免费，外加一个收费的部分',
    line: '用你自己的文件夹和你自己的模型能做的一切，永远免费 —— 花的是你自己的钱，没有任何用量上限。',
    freeTitle: '永远免费',
    freeBody:
      '读写你的笔记，读 PDF 和 EPUB 并且引用点一下就跳回原文那一段，助手以及它在你文件夹里做的一切，子 agent，你自己的 skill，网页搜索，还有你自己机器上的 git。',
    paidTitle: '收费',
    paidBody:
      '伸到你的文件夹和你的模型之外的部分：浏览器扩展、你接进来的 MCP server、针对外部服务造的工具，以及跟 GitHub 同步。',
    price: '一次性 ${n}',
    priceNote: '含一年更新。不需要账号，不是订阅，在你的浏览器里校验。',
    notLive: '还没上线 —— 今天不收任何费用，也没有任何东西被锁起来。',
    cta: '收费的部分是怎么回事',

    dialogTitle: '收费的部分',
    dialogNotLive:
      '还没开卖。上面写着收费的那些，目前对所有人都是可用的，并且会一直可用到真的能买为止。',
    slotsTitle: '早期名额',
    slotsBody:
      '还剩 {left} / {total} 个名额。领一个，你会拿到一把 {days} 天的 key，条件是回头告诉我哪里不好用。',
    slotsNote:
      '是 {days} 天，不是永久。到期后你会拿到一个老用户价，收费的部分回到锁定状态，而你文件夹里的任何东西都不会变。',
    slotsCta: '申请一个名额',
    close: '关闭',
  },
}
