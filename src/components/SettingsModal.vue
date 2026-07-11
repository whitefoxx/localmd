<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore, newProfileId, autoLabel, type LlmProfile } from '@/stores/settings'
import { useMcpStore } from '@/stores/mcp'
import { ALL_PROVIDERS } from '@/lib/providers'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useSettingsStore()
const mcp = useMcpStore()

/** Working copy under edit (null = list view). */
const editing = ref<LlmProfile | null>(null)

/* MCP server add form */
const mcpName = ref('')
const mcpUrl = ref('')
const mcpToken = ref('')

function addMcpServer(): void {
  if (!mcpUrl.value.trim()) return
  store.state.mcpServers.push({
    id: newProfileId(),
    name: mcpName.value.trim() || 'server',
    url: mcpUrl.value.trim(),
    ...(mcpToken.value.trim() ? { token: mcpToken.value.trim() } : {}),
  })
  mcpName.value = ''
  mcpUrl.value = ''
  mcpToken.value = ''
}

function removeMcpServer(id: string): void {
  store.state.mcpServers = store.state.mcpServers.filter((s) => s.id !== id)
}

function mcpStatus(id: string): { label: string; ok: boolean } {
  const s = mcp.servers.find((x) => x.config.id === id)
  if (!s || s.status === 'connecting') return { label: '连接中…', ok: false }
  if (s.status === 'error') return { label: s.error?.slice(0, 60) ?? '连接失败', ok: false }
  return { label: `${s.tools.length} 个工具`, ok: true }
}

function addProfile(): void {
  editing.value = {
    id: newProfileId(),
    label: '',
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: 'claude-opus-4-8',
  }
}

function editProfile(p: LlmProfile): void {
  editing.value = { ...p }
}

function applyProviderPreset(): void {
  const e = editing.value
  if (!e) return
  const preset = ALL_PROVIDERS.find((p) => p.id === e.provider)
  if (!preset) return
  e.baseUrl = preset.baseUrl
  e.model = preset.defaultModel
}

function saveProfile(): void {
  const e = editing.value
  if (!e) return
  if (!e.label.trim()) e.label = autoLabel(e)
  if (e.maxTokens !== undefined && !(e.maxTokens > 0)) delete e.maxTokens
  store.upsertProfile({ ...e })
  editing.value = null
}

function slotBadges(p: LlmProfile): string[] {
  const out: string[] = []
  if (store.state.slots.primary === p.id) out.push('主模型')
  if (store.state.slots.vision === p.id) out.push('视觉')
  return out
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      @click.self="emit('close')"
    >
      <div class="w-[520px] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-bg-1 p-5">
        <div class="flex items-center mb-4">
          <h2 class="text-lg font-semibold text-fg-0 flex-1">Settings</h2>
          <button class="text-fg-3 hover:text-fg-0" @click="emit('close')">
            <span class="codicon codicon-close" />
          </button>
        </div>

        <!-- Profile editor -->
        <template v-if="editing">
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Provider</label>
          <select v-model="editing.provider" class="input mb-3" @change="applyProviderPreset">
            <option v-for="p in ALL_PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>

          <template v-if="editing.provider !== 'anthropic'">
            <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Base URL</label>
            <input v-model="editing.baseUrl" class="input mb-3" placeholder="https://api.openai.com/v1" />
          </template>

          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">API key</label>
          <input
            v-model="editing.apiKey"
            type="password"
            class="input mb-3"
            :placeholder="editing.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'"
            autocomplete="off"
          />

          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Model</label>
          <input
            v-model="editing.model"
            class="input mb-3"
            :placeholder="editing.provider === 'anthropic' ? 'claude-opus-4-8' : 'e.g. deepseek-chat, qwen-vl-plus'"
          />

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Label（可选）</label>
              <input v-model="editing.label" class="input" :placeholder="autoLabel(editing)" />
            </div>
            <div>
              <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Max tokens（可选）</label>
              <input v-model.number="editing.maxTokens" type="number" class="input" placeholder="默认" />
            </div>
          </div>

          <p v-if="editing.provider !== 'anthropic'" class="text-xs text-fg-3 mb-3">
            端点必须允许浏览器（CORS）访问。预设端点已验证可用；自定义网关可能不行。
          </p>

          <div class="flex gap-2 mb-4">
            <button class="btn-primary text-xs" :disabled="!editing.apiKey || !editing.model" @click="saveProfile">
              保存
            </button>
            <button class="btn text-xs" @click="editing = null">取消</button>
          </div>
        </template>

        <!-- Profile list + slots -->
        <template v-else>
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-2">模型 Profiles</label>
          <div v-if="!store.state.profiles.length" class="text-xs text-fg-3 mb-2">
            还没有配置模型 — 添加一个 API key 后 agent 才能工作。
          </div>
          <div
            v-for="p in store.state.profiles"
            :key="p.id"
            class="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-2"
          >
            <span class="flex-1 truncate text-sm text-fg-1">{{ p.label }}</span>
            <span
              v-for="b in slotBadges(p)"
              :key="b"
              class="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent shrink-0"
            >
              {{ b }}
            </span>
            <button class="text-fg-3 hover:text-fg-0 opacity-0 group-hover:opacity-100" title="Edit" @click="editProfile(p)">
              <span class="codicon codicon-sm codicon-edit" />
            </button>
            <button
              class="text-fg-3 hover:text-removed opacity-0 group-hover:opacity-100"
              title="Delete"
              @click="store.deleteProfile(p.id)"
            >
              <span class="codicon codicon-sm codicon-trash" />
            </button>
          </div>
          <button class="btn text-xs mt-2 mb-4" @click="addProfile">
            <span class="codicon codicon-sm codicon-add mr-1" />添加模型
          </button>

          <template v-if="store.state.profiles.length">
            <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">模型分工</label>
            <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 mb-2">
              <span class="text-xs text-fg-2">主模型</span>
              <select
                :value="store.state.slots.primary ?? ''"
                class="input"
                @change="store.setSlot('primary', ($event.target as HTMLSelectElement).value || null)"
              >
                <option v-for="p in store.state.profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
              <span class="text-xs text-fg-2">视觉理解</span>
              <select
                :value="store.state.slots.vision ?? ''"
                class="input"
                @change="store.setSlot('vision', ($event.target as HTMLSelectElement).value || null)"
              >
                <option value="">未配置</option>
                <option v-for="p in store.state.profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
            </div>
            <p class="text-xs text-fg-3 mb-4">
              Claude 主模型天生多模态，无需配置视觉槽。OpenAI 兼容主模型：若它本身是多模态（如
              qwen-vl、glm-4v、gpt-4o），视觉槽选它自己（图片直接进上下文）；若是纯文本模型（如
              deepseek-chat），视觉槽指一个专门的视觉模型（agent 通过 view_image 工具调用它）。
            </p>
          </template>
        </template>

        <template v-if="!editing">
          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Agent 写入</label>
          <select v-model="store.state.writeMode" class="input mb-1">
            <option value="auto">直接写入（事后在 Review 面板审查/回退）</option>
            <option value="ask">先询问（每次写入暂停，等我批准）</option>
          </select>
          <p class="text-xs text-fg-3 mb-4">
            先询问模式下，agent 的 write_file / edit_file 会挂起，直到你在 Review 面板里
            Approve 或 Reject。
          </p>

          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1 mt-1">
            外部工具(MCP servers)
            <button class="ml-1 normal-case text-accent hover:underline" @click="mcp.refresh()">重连</button>
          </label>
          <div
            v-for="s in store.state.mcpServers"
            :key="s.id"
            class="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-2 text-xs"
          >
            <span
              class="w-1.5 h-1.5 rounded-full shrink-0"
              :class="mcpStatus(s.id).ok ? 'bg-added' : 'bg-removed'"
            />
            <span class="text-fg-1 shrink-0">{{ s.name }}</span>
            <span class="text-fg-3 truncate flex-1" :title="s.url">{{ mcpStatus(s.id).label }}</span>
            <button class="text-fg-3 hover:text-removed shrink-0" title="删除" @click="removeMcpServer(s.id)">
              <span class="codicon codicon-sm codicon-trash" />
            </button>
          </div>
          <div class="grid grid-cols-[100px_1fr_100px_auto] gap-2 mt-1 mb-1">
            <input v-model="mcpName" class="input text-xs" placeholder="名称" />
            <input v-model="mcpUrl" class="input text-xs" placeholder="https://…/mcp(Streamable HTTP)" />
            <input v-model="mcpToken" type="password" class="input text-xs" placeholder="token(可选)" autocomplete="off" />
            <button class="btn text-xs" :disabled="!mcpUrl.trim()" @click="addMcpServer">添加</button>
          </div>
          <p class="text-xs text-fg-3 mb-4">
            服务器必须允许浏览器 CORS。连接成功后其工具以 mcp__名称__工具 出现在 agent
            工具列表;外部工具的结果按不可信数据处理。
          </p>

          <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1 mt-1">Git & GitHub</label>
          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-fg-3 mb-1">Commit 作者名</label>
              <input v-model="store.state.gitName" class="input" placeholder="（默认读仓库 git config）" />
            </div>
            <div>
              <label class="block text-xs text-fg-3 mb-1">Commit 邮箱</label>
              <input v-model="store.state.gitEmail" class="input" placeholder="you@example.com" />
            </div>
          </div>
          <label class="block text-xs text-fg-3 mb-1">GitHub Token（push 需要；pull 公开仓库可不填）</label>
          <input
            v-model="store.state.githubToken"
            type="password"
            class="input mb-1"
            placeholder="github_pat_… / ghp_…"
            autocomplete="off"
          />
          <p class="text-xs text-fg-3 mb-4">
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener"
              class="text-accent hover:underline"
            >点这里创建 Fine-grained token ↗</a>：Repository access 选 Only select
            repositories（只勾知识库仓库），Permissions → Contents 设为 Read and
            write，生成后把 <code>github_pat_…</code> 粘贴到上面。详细步骤见 README「Git 与
            GitHub 同步」。同步 fast-forward-only，冲突时回终端处理。
          </p>
        </template>

        <p class="text-xs text-fg-3 border-t border-border pt-3">
          API key 与 token 只保存在这个浏览器（localStorage），只发给对应的服务商，不经过任何其他服务器。
        </p>
      </div>
    </div>
  </Teleport>
</template>
