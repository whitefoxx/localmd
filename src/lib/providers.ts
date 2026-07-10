/**
 * OpenAI-compatible provider presets, modeled on web-agent's PROVIDERS list.
 *
 * A pure web app can only call endpoints that allow browser CORS. Every
 * endpoint below answered the CORS preflight (OPTIONS with Origin →
 * access-control-allow-origin) when verified on 2026-07-10. Custom endpoints
 * (self-hosted proxies, region-specific gateways) may not — the chat surface
 * shows a CORS hint when a connection error occurs.
 */
export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  defaultModel: string
}

export const OPENAI_COMPAT_PRESETS: ProviderPreset[] = [
  {
    id: 'qwen',
    label: 'Qwen（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
  },
  {
    id: 'kimi',
    label: 'Kimi（Moonshot）',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0905-preview',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-Text-01',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
  },
  { id: 'custom', label: 'Custom（OpenAI-compatible）', baseUrl: '', defaultModel: '' },
]
