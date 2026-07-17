<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSettingsStore, newProfileId, autoLabel, type LlmProfile } from '@/stores/settings'
import { useMcpStore } from '@/stores/mcp'
import { ALL_PROVIDERS, presetFor, needsBaseUrl, providerHasImageModel } from '@/lib/providers'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const store = useSettingsStore()
const mcp = useMcpStore()

/** Only providers with an AI SDK image model can fill the image-generation slot. */
const imageCapableProfiles = computed(() =>
  store.state.profiles.filter((p) => providerHasImageModel(p.provider)),
)

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
        class="w-[560px] max-w-[92vw] max-h-[85vh] rounded-lg border border-border bg-bg-1 shadow-xl flex flex-col overflow-hidden"
      >
        <!-- Header (fixed, opaque) -->
        <div class="flex items-center gap-2 px-5 h-12 border-b border-border shrink-0 bg-bg-1">
          <span v-if="editing" class="codicon codicon-arrow-left text-fg-3 hover:text-fg-0 cursor-pointer" @click="editing = null" />
          <h2 class="text-base font-semibold text-fg-0 flex-1">
            {{ editing ? (store.state.profiles.some((p) => p.id === editing!.id) ? '编辑模型' : '添加模型') : 'Settings' }}
          </h2>
          <button class="text-fg-3 hover:text-fg-0" @click="emit('close')">
            <span class="codicon codicon-close" />
          </button>
        </div>

        <!-- Body (scrolls; every surface is opaque bg-bg-1) -->
        <div class="flex-1 min-h-0 overflow-y-auto panel-scroll bg-bg-1">
          <!-- Profile editor -->
          <div v-if="editing" class="p-5 space-y-4">
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

          <!-- Sections (list view) -->
          <template v-else>
            <!-- Models -->
            <section class="p-5 border-b border-border space-y-3">
              <h3 class="text-sm font-semibold text-fg-0">模型 Profiles</h3>
              <div v-if="!store.state.profiles.length" class="text-xs text-fg-3">
                还没有配置模型 — 添加一个 API key 后 agent 才能工作。
              </div>
              <div class="space-y-0.5">
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
              </div>
              <button class="btn text-xs" @click="addProfile">
                <span class="codicon codicon-sm codicon-add mr-1" />添加模型
              </button>
            </section>

            <!-- Slots -->
            <section v-if="store.state.profiles.length" class="p-5 border-b border-border space-y-3">
              <h3 class="text-sm font-semibold text-fg-0">模型分工</h3>
              <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
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
                <span class="text-xs text-fg-2">图像生成</span>
                <select
                  :value="store.state.slots.image ?? ''"
                  class="input"
                  @change="store.setSlot('image', ($event.target as HTMLSelectElement).value || null)"
                >
                  <option value="">未配置</option>
                  <option
                    v-for="p in imageCapableProfiles"
                    :key="p.id"
                    :value="p.id"
                  >
                    {{ p.label }}
                  </option>
                </select>
              </div>
              <p class="text-xs text-fg-3 leading-relaxed">
                Claude 主模型天生多模态，无需配置视觉槽。OpenAI 兼容主模型：若它本身是多模态（如
                qwen-vl、glm-4v、gpt-4o），视觉槽选它自己（图片直接进上下文）；若是纯文本模型（如
                deepseek-chat），视觉槽指一个专门的视觉模型（agent 通过 view_image 工具调用它）。
              </p>
              <p class="text-xs text-fg-3 leading-relaxed">
                图像生成槽可选，配置后主模型可用 generate_image 工具作图（保存进 raw/images/）。支持
                OpenAI（DALL·E）、Google（Imagen）、xAI，以及 OpenAI 兼容的 /images/generations 端点（智谱
                CogView、Qwen、自定义等）；模型名填对应的作图模型，端点须允许浏览器 CORS。
              </p>
            </section>

            <!-- Agent behavior -->
            <section class="p-5 border-b border-border space-y-3">
              <h3 class="text-sm font-semibold text-fg-0">Agent 行为</h3>
              <div class="space-y-1">
                <label class="block text-xs uppercase tracking-wide text-fg-3">写入模式</label>
                <select v-model="store.state.writeMode" class="input">
                  <option value="auto">直接写入（事后在 Review 面板审查/回退）</option>
                  <option value="ask">先询问（每次写入暂停，等我批准）</option>
                </select>
                <p class="text-xs text-fg-3 leading-relaxed">
                  先询问模式下，agent 的 write_file / edit_file 会挂起，直到你在 Review 面板里
                  Approve 或 Reject。改动后可在 “Agent changes” 面板查看被改的文件，
                  是否提交、如何提交由你在 Git 面板自行决定。
                </p>
              </div>
            </section>

            <!-- MCP -->
            <section class="p-5 border-b border-border space-y-3">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold text-fg-0 flex-1">外部工具（MCP servers）</h3>
                <button class="text-xs text-accent hover:underline" @click="mcp.refresh()">重连</button>
              </div>
              <div v-if="mcp.servers.length" class="space-y-0.5">
                <div
                  v-for="s in mcp.servers"
                  :key="s.config.id"
                  class="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-2 text-xs"
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
                    <button
                      class="text-fg-3 hover:text-removed shrink-0"
                      title="删除"
                      @click="removeMcpServer(s.config.id)"
                    >
                      <span class="codicon codicon-sm codicon-trash" />
                    </button>
                  </template>
                </div>
              </div>
              <div class="grid grid-cols-[100px_1fr_100px_auto] gap-2">
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
            </section>

            <!-- Git -->
            <section class="p-5 space-y-3">
              <h3 class="text-sm font-semibold text-fg-0">Git & GitHub</h3>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-fg-3 mb-1">Commit 作者名</label>
                  <input v-model="store.state.gitName" class="input" placeholder="（默认读仓库 git config）" />
                </div>
                <div>
                  <label class="block text-xs text-fg-3 mb-1">Commit 邮箱</label>
                  <input v-model="store.state.gitEmail" class="input" placeholder="you@example.com" />
                </div>
              </div>
              <div>
                <label class="block text-xs text-fg-3 mb-1">GitHub Token（push 需要；pull 公开仓库可不填）</label>
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
            </section>
          </template>
        </div>

        <!-- Footer (fixed, opaque) -->
        <div class="px-5 py-3 border-t border-border shrink-0 bg-bg-1 text-xs text-fg-3 leading-relaxed">
          API key 与 token 只保存在这个浏览器（localStorage），只发给对应的服务商，不经过任何其他服务器。
        </div>
      </div>
    </div>
  </Teleport>
</template>
