/**
 * First-run scaffolding: turn an empty folder into a working knowledge base
 * (the trace-app "LLM Wiki" layout) — raw/ intake dirs, a wiki index,
 * a tool-neutral AGENTS.md schema, and the two starter skills.
 */
import * as fs from '@/lib/fs'

const AGENTS_MD = `# 知识库说明(AGENTS.md)

这是一个 LLM 维护的个人知识库。agent 在这里工作时遵循以下约定。

## 结构

\`\`\`
raw/    ← 不可变的源文件(文章、书、图片、数据)。只读,不要修改
raw/conversations/ ← 保存下来的会话记录(type: chat),就是普通 md 文件(保存位置可自选)。蒸馏时把讨论里的结论提炼进 wiki
wiki/   ← LLM 维护的 markdown 页面。用 [[wikilinks]] 互相链接
wiki/index.md ← 入口页,新页面要从这里可达
.agents/skills/ ← 可复用的工作流(SKILL.md)
MEMORY.md ← 跨会话的持久记忆(用户偏好、项目状态、重要决策)。可选:用户自己写,或让 agent 记录/更新;不主动自动总结
\`\`\`

## 规则

- raw/ 是事实来源:ingest 时读取它,写作只发生在 wiki/
- 每个 wiki 页面聚焦一个主题;宁可多建小页面 + 链接,不要堆大杂烩
- 引用来源:从 PDF/EPUB 得出的结论用 [[N:block-id]] 引用标注
- 修改前先读原文件;编辑保持最小化
`

const INDEX_MD = `# 索引

欢迎!这是知识库的入口页。

## 开始使用

1. 把文章 / PDF / EPUB 拖进窗口,或在聊天框粘贴截图——会自动归档到 \`raw/\`
2. 对右侧 agent 说 \`/ingest\`,它会阅读源文件并生成 wiki 页面
3. 用 \`/lint\` 检查知识库健康度

## 页面

(暂无 — ingest 后 agent 会把新页面链接到这里)
`

const SKILL_INGEST = `---
name: ingest
description: 处理 raw/ 下未入库的源文件,生成或更新 wiki 页面并链接索引
---

# Ingest 流程

1. 列出 raw/ 下的源文件,对照 wiki/ 找出尚未处理的。
2. 逐个阅读(PDF/EPUB 走索引),为每个源创建或更新 wiki 页面,遵循 AGENTS.md 的约定。
3. 新页面用 [[wikilinks]] 链入 wiki/index.md。
4. 汇报:处理了哪些、跳过了哪些(及原因)。
`

const SKILL_LINT = `---
name: lint
description: 检查知识库健康度——孤儿页、断链、缺失索引项、内容矛盾
---

# Lint 流程

1. 遍历 wiki/ 全部页面,收集 [[wikilinks]]。
2. 找出:孤儿页(无入链)、断链(目标不存在)、index.md 缺失的页面。
3. 抽查内容矛盾(同一事实在不同页面说法不一)。
4. 先列出全部问题再动手修;修复需逐项说明。
`

const SKILL_HARVEST = `---
name: harvest
description: 蒸馏一段讨论——把其中的结论、决策、想法提炼进 wiki 笔记
---

# Harvest 流程

对象:一段讨论。可以是**当前对话**的内容,也可以是用户 @ 指定的任意文件(比如之前保存的会话文件——当普通文件处理即可,无需特殊对待)。

1. 通读要蒸馏的内容,提炼值得留存的结论、决策、想法——是提炼,不是复述对话。
2. 按主题合并进 wiki 已有页面(优先),必要时新建页面并链入索引。
3. 若来源是 KB 里的文件,在写入的笔记里用 [[链接]] 指回来源,方便日后复核。
4. 汇报:蒸馏出了什么、写进了哪里、跳过了什么。

没有值得蒸馏的内容也是正常结果,如实说明即可。
`

const FILES: Array<[string, string]> = [
  ['AGENTS.md', AGENTS_MD],
  ['wiki/index.md', INDEX_MD],
  ['.agents/skills/ingest/SKILL.md', SKILL_INGEST],
  ['.agents/skills/lint/SKILL.md', SKILL_LINT],
  ['.agents/skills/harvest/SKILL.md', SKILL_HARVEST],
  ['raw/articles/.gitkeep', ''],
  ['raw/books/.gitkeep', ''],
  ['raw/images/.gitkeep', ''],
  ['raw/papers/.gitkeep', ''],
]

/** Write the starter layout. Existing files are never overwritten. */
export async function scaffoldKb(): Promise<string[]> {
  const written: string[] = []
  for (const [path, content] of FILES) {
    if (await fs.exists(path)) continue
    await fs.writeFile(path, content)
    written.push(path)
  }
  return written
}
