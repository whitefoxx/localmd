<script setup lang="ts">
/**
 * The control the agent asked for, rendered above the composer while the turn
 * is blocked on it.
 *
 * For a key the input writes into settings directly and the agent is told only
 * that a value arrived — the one path by which a secret can reach the app
 * during a conversation without passing through the model.
 */
import { ref, computed } from 'vue'
import { useToolsStore } from '@/stores/tools'
import { useSetupStore, type SetupRequest } from '@/stores/setup'
import { useMcpStore } from '@/stores/mcp'
import { catalogEntryById } from '@/lib/toolCatalog'
import { isLocalmdConnectRelayUrl } from '@/lib/connectRelay'

const props = defineProps<{ request: SetupRequest }>()

const setup = useSetupStore()
const tools = useToolsStore()
const mcp = useMcpStore()

const value = ref('')
const checking = ref(false)
const checkFailed = ref(false)

/** A value is already stored under this id — from an earlier setup, or the
 *  same one interrupted. Re-typing a key you already gave is pure friction, so
 *  offer to keep it and let Save mean "replace". */
const alreadySet = computed(() => !!props.request.secretId && tools.hasSecret(props.request.secretId))

function keepExisting(): void {
  setup.settle(props.request.id, 'provided')
}

function saveKey(): void {
  const v = value.value.trim()
  if (!v || !props.request.secretId) return
  tools.setSecret(props.request.secretId, v)
  value.value = ''
  setup.settle(props.request.id, 'provided')
}

/** The entry's own server row — per entry, not "any fetch_url tool", so the
 *  check answers for the extension this card is actually about. */
const entryServerUrl = computed(() =>
  props.request.entryId ? catalogEntryById(props.request.entryId)?.server?.url : undefined,
)
const entryConnected = computed(() => {
  const url = entryServerUrl.value
  if (!url) return tools.extensionConnected
  return mcp.servers.some((s) => s.config.url === url && s.status === 'ok')
})

/** Install the entry if it isn't yet, reconnect, then report what we see. */
async function checkExtension(): Promise<void> {
  const entryId = props.request.entryId
  checking.value = true
  checkFailed.value = false
  try {
    if (entryId && !tools.isInstalled(entryId)) tools.install(entryId)
    mcp.recheckRelay()
    await mcp.refresh()
    if (entryConnected.value) setup.settle(props.request.id, 'connected')
    else checkFailed.value = true
  } finally {
    checking.value = false
  }
}

/** The extension is not always reachable by installing alone: it answers only
 *  origins on its list (localmd.app is pre-authorized; dev addresses still
 *  need adding), and it starts listening on the next page load. So the card
 *  spells out the address to add and offers the reload, rather than sending
 *  the user back and forth between Chrome and a "check again" that cannot
 *  succeed. Keyed on the connection, not on the relay marker: the marker is
 *  also present on a page whose exact address was never allowed, which is the
 *  case that most needs the address spelled out. */
const needsRelaySetup = computed(
  () =>
    !!entryServerUrl.value &&
    isLocalmdConnectRelayUrl(entryServerUrl.value) &&
    !entryConnected.value,
)
const pageHost = computed(() => window.location.host)

function reloadPage(): void {
  window.location.reload()
}

const busy = ref(false)
const failure = ref('')

/**
 * Nothing the agent proposed happens until this runs.
 *
 * The card is the trust boundary: the agent reads untrusted things — web pages,
 * files, tool output — so a page can talk it into proposing an address. What a
 * page cannot do is click here, and `detail` shows the user exactly what they
 * are clicking before they do.
 */
async function confirmAction(): Promise<void> {
  busy.value = true
  failure.value = ''
  try {
    await props.request.apply?.()
    setup.settle(props.request.id, 'confirmed')
  } catch (err) {
    failure.value = (err as Error).message
    setup.settle(props.request.id, `failed:${(err as Error).message}`)
  } finally {
    busy.value = false
  }
}

/** Hand off to the row's own OAuth flow — the popup, the verifier and the token
 *  all stay where they already live. */
async function signIn(): Promise<void> {
  const serverId = props.request.serverId
  if (!serverId) return
  busy.value = true
  failure.value = ''
  try {
    const err = await mcp.signIn(serverId)
    if (err) {
      failure.value = err
      setup.settle(props.request.id, `failed:${err}`)
    } else {
      setup.settle(props.request.id, 'connected')
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mb-2 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2.5">
    <div class="flex items-center gap-1.5">
      <span
        class="codicon codicon-sm text-accent"
        :class="{
          'codicon-key': request.kind === 'key',
          'codicon-plug': request.kind === 'extension',
          'codicon-shield': request.kind === 'confirm',
          'codicon-sign-in': request.kind === 'signin',
          'codicon-question': request.kind === 'choice',
        }"
      />
      <span class="text-sm text-fg-1">{{ request.label }}</span>
    </div>
    <p v-if="request.help" class="mt-0.5 text-xs text-fg-3 leading-relaxed">{{ request.help }}</p>

    <!-- A key: straight into settings, never back to the model. -->
    <div v-if="request.kind === 'key'" class="mt-2 space-y-1.5">
      <div class="flex items-center gap-2">
        <input
          v-model="value"
          type="password"
          class="input text-xs flex-1"
          autocomplete="off"
          :placeholder="alreadySet ? $t('chat.setupReplace') : request.secretId"
          @keydown.enter.prevent="saveKey"
        />
        <button class="btn text-xs shrink-0" :disabled="!value.trim()" @click="saveKey">
          {{ $t('chat.setupSave') }}
        </button>
      </div>
      <div v-if="alreadySet" class="flex items-center gap-2 text-xs">
        <span class="text-fg-3">{{ $t('chat.setupAlreadySet') }}</span>
        <button class="text-accent hover:underline" @click="keepExisting">
          {{ $t('chat.setupKeep') }}
        </button>
      </div>
    </div>

    <!-- An extension: install, allow this site, reload, then re-check. -->
    <div v-else-if="request.kind === 'extension'" class="mt-2 space-y-2">
      <p v-if="needsRelaySetup" class="text-xs text-fg-3 leading-relaxed">
        {{ $t('settings.lmdConnect.step2') }}
        <span class="font-mono text-fg-1">{{ pageHost }}</span>
        {{ $t('settings.lmdConnect.step3') }}
      </p>
      <div class="flex items-center gap-2 flex-wrap">
        <a v-if="request.url" :href="request.url" target="_blank" rel="noopener" class="btn text-xs">
          {{ $t('chat.setupInstall') }}
        </a>
        <button v-if="needsRelaySetup" class="btn text-xs" @click="reloadPage">
          {{ $t('settings.lmdConnect.reload') }}
        </button>
        <button class="btn text-xs" :disabled="checking" @click="checkExtension">
          {{ checking ? $t('chat.setupChecking') : $t('chat.setupRecheck') }}
        </button>
      </div>
    </div>

    <!-- A proposed change. The detail is shown verbatim: the address — or the
         exact css/js a site script would inject — is the thing being judged,
         so it must not be truncated or prettified into something that reads
         safer than it is. pre-wrap keeps a multi-line script legible; the
         scroll cap keeps a long one from swallowing the chat. -->
    <div v-else-if="request.kind === 'confirm'" class="mt-2 space-y-2">
      <p
        v-if="request.detail"
        class="rounded-lg bg-bg-2 px-2.5 py-2 text-xs font-mono text-fg-1 whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-auto"
      >{{ request.detail }}</p>
      <button class="btn text-xs" :disabled="busy" @click="confirmAction">
        {{ busy ? $t('chat.setupWorking') : $t('chat.setupConfirm') }}
      </button>
    </div>

    <!-- An authorization only the user can grant, in the service's own window. -->
    <div v-else-if="request.kind === 'signin'" class="mt-2 space-y-2">
      <p
        v-if="request.detail"
        class="rounded-lg bg-bg-2 px-2.5 py-2 text-xs font-mono text-fg-1 break-all leading-relaxed"
      >{{ request.detail }}</p>
      <button class="btn text-xs" :disabled="busy" @click="signIn">
        {{ busy ? $t('settings.signingIn') : $t('settings.signIn') }}
      </button>
    </div>

    <!-- A choice the agent could not make on the user's behalf. -->
    <div v-else class="mt-2 flex items-center gap-2 flex-wrap">
      <button
        v-for="o in request.options ?? []"
        :key="o"
        class="btn text-xs"
        @click="setup.settle(request.id, `chose:${o}`)"
      >{{ o }}</button>
    </div>

    <p v-if="checkFailed" class="mt-1.5 text-xs text-removed">
      {{ needsRelaySetup ? $t('chat.setupNotAllowed') : $t('chat.setupNotDetected') }}
    </p>
    <p v-if="failure" class="mt-1.5 text-xs text-removed leading-relaxed">{{ failure }}</p>

    <div class="mt-2 flex items-center gap-3">
      <a
        v-if="request.url && request.kind !== 'extension'"
        :href="request.url"
        target="_blank"
        rel="noopener"
        class="text-xs text-accent hover:underline"
      >{{ $t('chat.setupWhere') }}</a>
      <button class="text-xs text-fg-3 hover:text-fg-1" @click="setup.settle(request.id, 'skipped')">
        {{ $t('chat.setupSkip') }}
      </button>
    </div>
  </div>
</template>
