<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore, newProfileId, autoLabel, type LlmProfile } from '@/stores/settings'
import { useMcpStore } from '@/stores/mcp'
import { ALL_PROVIDERS, presetFor, needsBaseUrl, providerHasImageModel } from '@/lib/providers'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

// Esc closes the modal while it's open.
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

const store = useSettingsStore()
const mcp = useMcpStore()

/** Left-nav sections (ChatGPT-style). */
type SectionId = 'models' | 'agent' | 'tools' | 'git'
const NAV: { id: SectionId; label: string; icon: string }[] = [
  { id: 'models', label: '模型', icon: 'codicon-sparkle' },
  { id: 'agent', label: 'Agent 行为', icon: 'codicon-settings-gear' },
  { id: 'tools', label: '外部工具', icon: 'codicon-plug' },
  { id: 'git', label: 'Git & GitHub', icon: 'codicon-github' },
]
const section = ref<SectionId>('models')
const sectionTitle = computed(() => NAV.find((n) => n.id === section.value)?.label ?? '')
function goSection(id: SectionId): void {
  section.value = id
  editing.value = null // leaving the models pane cancels an in-progress edit
}

/** Only providers with an AI SDK image model can fill the image-generation slot. */
const imageCapableProfiles = computed(() =>
  store.state.profiles.filter((p) => providerHasImageModel(p.provider)),
)

/** Working copy under edit (null = list view). */
const editing = ref<LlmProfile | null>(null)
const isExistingProfile = computed(
  () => !!editing.value && store.state.profiles.some((p) => p.id === editing.value!.id),
)

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

function toggleMcpServer(id: string): void {
  const s = store.state.mcpServers.find((x) => x.id === id)
  if (s) s.enabled = s.enabled === false ? true : false
}

function mcpStatusLabel(s: (typeof mcp.servers)[number]): { label: string; cls: string } {
  if (s.status === 'off') return { label: '已停用', cls: 'bg-fg-3' }
  if (s.status === 'connecting') return { label: '连接中…', cls: 'bg-fg-3' }
  if (s.status === 'error') return { label: s.error?.slice(0, 60) ?? '连接失败', cls: 'bg-removed' }
  return { label: `${s.tools.length} 个工具`, cls: 'bg-added' }
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
  if (store.state.slots.image === p.id) out.push('图像')
  return out
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      @click.self="emit('close')"
    >
      <div
        class="w-[800px] max-w-[95vw] h-[620px] max-h-[88vh] rounded-xl border border-border bg-bg-1 shadow-2xl flex overflow-hidden"
      >
        <!-- ── Sidebar ─────────────────────────────────────────────────── -->
        <aside class="w-52 shrink-0 border-r border-border bg-bg-2/40 flex flex-col">
          <div class="flex items-center h-12 px-2.5 shrink-0">
            <button
              class="w-7 h-7 flex items-center justify-center rounded-md text-fg-3 hover:text-fg-0 hover:bg-bg-3 transition-colors"
              title="关闭 (Esc)"
              @click="emit('close')"
            >
              <span class="codicon codicon-close" />
            </button>
            <span class="ml-1.5 text-sm font-semibold text-fg-0">Settings</span>
          </div>
          <nav class="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            <button
              v-for="n in NAV"
              :key="n.id"
              class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition-colors"
              :class="
                section === n.id
                  ? 'bg-bg-3 text-fg-0 font-medium'
                  : 'text-fg-2 hover:bg-bg-2 hover:text-fg-0'
              "
              @click="goSection(n.id)"
            >
              <span class="codicon shrink-0" :class="n.icon" />
              <span class="truncate">{{ n.label }}</span>
            </button>
          </nav>
          <div class="px-3 py-2.5 text-[11px] text-fg-3 leading-relaxed border-t border-border">
            <span class="codicon codicon-sm codicon-shield mr-0.5" />
            API key 与 token 只存在本浏览器,直连服务商,不经其他服务器。
          </div>
        </aside>

        <!-- ── Panel ───────────────────────────────────────────────────── -->
        <div class="flex-1 min-w-0 flex flex-col bg-bg-1">
          <div class="flex items-center h-12 px-6 shrink-0 border-b border-border">
            <span
              v-if="editing"
              class="codicon codicon-arrow-left text-fg-3 hover:text-fg-0 cursor-pointer mr-2"
              title="返回"
              @click="editing = null"
            />
            <h2 class="text-base font-semibold text-fg-0">
              {{ editing ? (isExistingProfile ? '编辑模型' : '添加模型') : sectionTitle }}
            </h2>
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto panel-scroll px-6 py-5">
            <!-- ▸ Profile editor (lives inside the Models pane) -->
            <div v-if="editing" class="space-y-4 max-w-md">
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Provider</label>
                <select v-model="editing.provider" class="input" @change="applyProviderPreset">
                  <option v-for="p in ALL_PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
              </div>

              <div v-if="needsBaseUrl(editing.provider)">
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Base URL</label>
                <input v-model="editing.baseUrl" class="input" placeholder="https://api.example.com/v1" />
              </div>

              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">API key</label>
                <input
                  v-model="editing.apiKey"
                  type="password"
                  class="input"
                  :placeholder="editing.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'"
                  autocomplete="off"
                />
              </div>

              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Model</label>
                <input
                  v-model="editing.model"
                  class="input"
                  list="model-suggestions"
                  :placeholder="presetFor(editing.provider)?.defaultModel || 'e.g. gpt-4.1, deepseek-chat'"
                />
                <datalist id="model-suggestions">
                  <option v-for="m in presetFor(editing.provider)?.models ?? []" :key="m" :value="m" />
                </datalist>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Label（可选）</label>
                  <input v-model="editing.label" class="input" :placeholder="autoLabel(editing)" />
                </div>
                <div>
                  <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Max tokens（可选）</label>
                  <input v-model.number="editing.maxTokens" type="number" class="input" placeholder="默认" />
                </div>
              </div>

              <p class="text-xs text-fg-3 leading-relaxed">
                选好 provider 后只需填 API key 和模型名——base URL 与接口适配由 SDK 内置。端点须允许浏览器（CORS）访问；连接失败时聊天区会给出提示。
              </p>

              <div class="flex gap-2 pt-1">
                <button class="btn-primary text-xs" :disabled="!editing.apiKey || !editing.model" @click="saveProfile">
                  保存
                </button>
                <button class="btn text-xs" @click="editing = null">取消</button>
              </div>
            </div>

            <!-- ▸ Models -->
            <div v-else-if="section === 'models'" class="space-y-6">
              <div>
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs uppercase tracking-wide text-fg-3">模型 Profiles</span>
                  <button class="btn text-xs" @click="addProfile">
                    <span class="codicon codicon-sm codicon-add mr-1" />添加模型
                  </button>
                </div>
                <div v-if="!store.state.profiles.length" class="text-sm text-fg-3 py-3">
                  还没有配置模型 — 添加一个 API key 后 agent 才能工作。
                </div>
                <div v-else class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  <div
                    v-for="p in store.state.profiles"
                    :key="p.id"
                    class="group flex items-center gap-2.5 px-3 py-2.5 hover:bg-bg-2 transition-colors"
                  >
                    <span class="codicon codicon-sparkle text-fg-3 shrink-0" />
                    <div class="min-w-0 flex-1">
                      <div class="text-sm text-fg-0 truncate">{{ p.label }}</div>
                      <div class="text-xs text-fg-3 truncate">{{ p.provider }} · {{ p.model }}</div>
                    </div>
                    <span
                      v-for="b in slotBadges(p)"
                      :key="b"
                      class="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent shrink-0"
                    >{{ b }}</span>
                    <button class="text-fg-3 hover:text-fg-0 opacity-0 group-hover:opacity-100" title="编辑" @click="editProfile(p)">
                      <span class="codicon codicon-sm codicon-edit" />
                    </button>
                    <button
                      class="text-fg-3 hover:text-removed opacity-0 group-hover:opacity-100"
                      title="删除"
                      @click="store.deleteProfile(p.id)"
                    >
                      <span class="codicon codicon-sm codicon-trash" />
                    </button>
                  </div>
                </div>
              </div>

              <!-- Slots -->
              <div v-if="store.state.profiles.length">
                <div class="text-xs uppercase tracking-wide text-fg-3 mb-2">模型分工</div>
                <div class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  <div class="flex items-center justify-between gap-4 px-3 py-3">
                    <div class="text-sm text-fg-1">主模型</div>
                    <select
                      :value="store.state.slots.primary ?? ''"
                      class="input w-48 shrink-0"
                      @change="store.setSlot('primary', ($event.target as HTMLSelectElement).value || null)"
                    >
                      <option v-for="p in store.state.profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-4 px-3 py-3">
                    <div class="text-sm text-fg-1">视觉理解</div>
                    <select
                      :value="store.state.slots.vision ?? ''"
                      class="input w-48 shrink-0"
                      @change="store.setSlot('vision', ($event.target as HTMLSelectElement).value || null)"
                    >
                      <option value="">未配置</option>
                      <option v-for="p in store.state.profiles" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-4 px-3 py-3">
                    <div class="text-sm text-fg-1">图像生成</div>
                    <select
                      :value="store.state.slots.image ?? ''"
                      class="input w-48 shrink-0"
                      @change="store.setSlot('image', ($event.target as HTMLSelectElement).value || null)"
                    >
                      <option value="">未配置</option>
                      <option v-for="p in imageCapableProfiles" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                  </div>
                </div>
                <p class="text-xs text-fg-3 leading-relaxed mt-2">
                  Claude 主模型天生多模态，无需配置视觉槽。OpenAI 兼容主模型：若它本身是多模态（如
                  qwen-vl、glm-4v、gpt-4o），视觉槽选它自己（图片直接进上下文）；若是纯文本模型（如
                  deepseek-chat），视觉槽指一个专门的视觉模型（agent 通过 view_image 工具调用它）。
                </p>
                <p class="text-xs text-fg-3 leading-relaxed mt-2">
                  图像生成槽可选，配置后主模型可用 generate_image 工具作图（保存进 raw/images/）。支持
                  OpenAI（DALL·E）、Google（Imagen）、xAI，以及 OpenAI 兼容的 /images/generations 端点（智谱
                  CogView、Qwen、自定义等）；模型名填对应的作图模型，端点须允许浏览器 CORS。
                </p>
              </div>
            </div>

            <!-- ▸ Agent behavior -->
            <div v-else-if="section === 'agent'" class="space-y-6">
              <div>
                <div class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  <div class="flex items-center justify-between gap-4 px-3 py-3">
                    <div class="min-w-0">
                      <div class="text-sm text-fg-1">写入模式</div>
                      <div class="text-xs text-fg-3 mt-0.5 leading-relaxed">
                        先询问模式下，agent 的 write_file / edit_file 会挂起，直到你在 Review 面板里 Approve 或 Reject。
                      </div>
                    </div>
                    <select v-model="store.state.writeMode" class="input w-56 shrink-0">
                      <option value="auto">直接写入（事后审查）</option>
                      <option value="ask">先询问（每次批准）</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-4 px-3 py-3">
                    <div class="min-w-0">
                      <div class="text-sm text-fg-1">回合 checkpoint</div>
                      <div class="text-xs text-fg-3 mt-0.5 leading-relaxed">
                        开启后（需 KB 为 git 仓库），每个写过文件的回合自动提交为 “checkpoint: …”，可在 Git 面板一键回滚。只提交 agent 改的文件。
                      </div>
                    </div>
                    <select v-model="store.state.checkpointMode" class="input w-56 shrink-0">
                      <option value="off">关闭</option>
                      <option value="auto">自动</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <!-- ▸ External tools (MCP) -->
            <div v-else-if="section === 'tools'" class="space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs uppercase tracking-wide text-fg-3">已连接的服务器</span>
                <button class="text-xs text-accent hover:underline" @click="mcp.refresh()">重连</button>
              </div>
              <div v-if="mcp.servers.length" class="rounded-lg border border-border divide-y divide-border overflow-hidden">
                <div
                  v-for="s in mcp.servers"
                  :key="s.config.id"
                  class="flex items-center gap-2 px-3 py-2.5 hover:bg-bg-2 text-xs transition-colors"
                >
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="mcpStatusLabel(s).cls" />
                  <span class="text-fg-1 shrink-0">{{ s.config.name }}</span>
                  <span
                    v-if="s.source === 'kb'"
                    class="text-[10px] px-1 rounded bg-accent/15 text-accent shrink-0"
                    title="来自知识库的 .agents/mcp.json — 编辑该文件修改"
                  >KB</span>
                  <span class="text-fg-3 truncate flex-1" :title="s.config.url">
                    {{ mcpStatusLabel(s).label }}
                  </span>
                  <template v-if="s.source === 'global'">
                    <button
                      class="text-fg-3 hover:text-fg-0 shrink-0"
                      :title="s.config.enabled === false ? '启用' : '停用(保留配置)'"
                      @click="toggleMcpServer(s.config.id)"
                    >
                      <span
                        class="codicon codicon-sm"
                        :class="s.config.enabled === false ? 'codicon-circle-slash' : 'codicon-pass'"
                      />
                    </button>
                    <button class="text-fg-3 hover:text-removed shrink-0" title="删除" @click="removeMcpServer(s.config.id)">
                      <span class="codicon codicon-sm codicon-trash" />
                    </button>
                  </template>
                </div>
              </div>
              <div v-else class="text-sm text-fg-3">还没有全局工具服务器。</div>

              <div class="grid grid-cols-[100px_1fr_110px_auto] gap-2">
                <input v-model="mcpName" class="input text-xs" placeholder="名称" />
                <input v-model="mcpUrl" class="input text-xs" placeholder="https://…/mcp 或 Chrome 扩展 ID" />
                <input v-model="mcpToken" type="password" class="input text-xs" placeholder="token(可选)" autocomplete="off" />
                <button class="btn text-xs" :disabled="!mcpUrl.trim()" @click="addMcpServer">添加</button>
              </div>
              <p class="text-xs text-fg-3 leading-relaxed">
                服务器必须允许浏览器 CORS;URL 栏填 32 位 Chrome 扩展 ID 则走扩展桥接。这里是
                全局配置;知识库还可以自带 <code>.agents/mcp.json</code>(随 git 走,重复目标以
                KB 为准,token 建议只放这里不放文件)。工具以 mcp__名称__工具 出现在 agent
                工具列表;外部工具的结果按不可信数据处理。
              </p>
            </div>

            <!-- ▸ Git & GitHub -->
            <div v-else-if="section === 'git'" class="space-y-4 max-w-md">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Commit 作者名</label>
                  <input v-model="store.state.gitName" class="input" placeholder="（默认读仓库 git config）" />
                </div>
                <div>
                  <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">Commit 邮箱</label>
                  <input v-model="store.state.gitEmail" class="input" placeholder="you@example.com" />
                </div>
              </div>
              <div>
                <label class="block text-xs uppercase tracking-wide text-fg-3 mb-1">GitHub Token（push 需要；pull 公开仓库可不填）</label>
                <input
                  v-model="store.state.githubToken"
                  type="password"
                  class="input"
                  placeholder="github_pat_… / ghp_…"
                  autocomplete="off"
                />
              </div>
              <p class="text-xs text-fg-3 leading-relaxed">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
