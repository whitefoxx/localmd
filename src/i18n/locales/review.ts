/** Agent-changes review panel: already-landed writes, keep or restore.
 *  (Ask-first pauses render as approval cards in the chat — see `chat`.)
 *  Namespace: `review`. */
export default {
  en: {
    title: 'Agent changes',
    discardAll: 'Discard all',
    approveAll: 'Approve all',
    noPending: 'No pending changes',
    discard: 'Discard',
    dismiss: 'Dismiss',
    approve: 'Approve',
    deletedRestorable: 'Deleted by the agent. Discard restores the file.',
    deletedFinal: 'Deleted by the agent — this could not be undone.',
    unchangedLines: '⋯ {n} unchanged lines ⋯',
  },
  zh: {
    title: 'Agent 改动',
    discardAll: '全部丢弃',
    approveAll: '全部批准',
    noPending: '没有待处理的改动',
    discard: '丢弃',
    dismiss: '知道了',
    approve: '批准',
    deletedRestorable: 'Agent 已删除该文件。点“丢弃”可以恢复。',
    deletedFinal: 'Agent 已删除——此操作无法撤销。',
    unchangedLines: '⋯ 未变动的 {n} 行 ⋯',
  },
}
