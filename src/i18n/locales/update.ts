/** The "a new version is waiting" prompt. Namespace: `update`. */
export default {
  en: {
    title: 'A new version is ready',
    // Says what the click costs, because the cost is the whole reason this is
    // a question: reloading ends an agent turn in progress.
    body: 'Updating reloads the page. Your files are already on disk; a chat in progress will stop.',
    apply: 'Reload now',
    applying: 'Reloading…',
    later: 'Later',
  },
  zh: {
    title: '新版本已就绪',
    body: '更新会重新加载页面。文件都已经在磁盘上了；正在进行的对话会中断。',
    apply: '立即重新加载',
    applying: '正在重新加载……',
    later: '稍后',
  },
}
