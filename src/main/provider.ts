import { homedir } from 'node:os'
import type { ProviderKind, ProviderStatus } from '../shared/types'
import { childEnv, run, which } from './env'
import { modelsUrl, startProxy, type Proxy, type Upstream } from './openai-proxy'
import { getSecret, setSecret } from './secrets'
import { getSettings, updateSettings } from './settings'

export function providerStatus(): ProviderStatus {
  const s = getSettings()
  const custom = s.customProvider
  return {
    active: s.provider === 'custom' && custom?.baseUrl && custom.model ? 'custom' : 'claude',
    baseUrl: custom?.baseUrl ?? '',
    model: custom?.model ?? '',
    hasKey: (getSecret('provider')?.length ?? 0) > 0
  }
}

function upstream(): Upstream | null {
  const s = providerStatus()
  if (s.active !== 'custom') return null
  return { baseUrl: s.baseUrl, key: getSecret('provider') ?? '', model: s.model }
}

const normalizeUrl = (u: string): string => {
  const t = u.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(t)) throw new Error('The endpoint should start with https://')
  return t
}

/** The models the endpoint lists (GET /models), sorted; rejects with the provider's reason. */
export async function listModels(args: { baseUrl: string; key?: string }): Promise<string[]> {
  const baseUrl = normalizeUrl(args.baseUrl)
  const key = args.key?.trim() || getSecret('provider') || ''
  let r: Response
  try {
    r = await fetch(modelsUrl(baseUrl), {
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new Error(
      `Couldn’t reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  const text = await r.text()
  if (r.status === 401 || r.status === 403)
    throw new Error('The provider refused this API key. Check it and try again.')
  if (!r.ok) throw new Error(`The provider said (${r.status}): ${text.slice(0, 200)}`)
  let ids: string[] = []
  try {
    const j = JSON.parse(text) as {
      data?: { id?: string }[]
      models?: { id?: string; name?: string }[]
    }
    ids = (j.data ?? j.models ?? [])
      .map((m) => (m as { id?: string; name?: string }).id ?? (m as { name?: string }).name ?? '')
      .filter(Boolean)
  } catch {
    throw new Error('That endpoint didn’t answer like an OpenAI-compatible API (no model list).')
  }
  if (!ids.length) throw new Error('The provider didn’t list any models for this key.')
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

export function saveProvider(args: {
  baseUrl: string
  key?: string
  model: string
}): ProviderStatus {
  const baseUrl = normalizeUrl(args.baseUrl)
  const model = args.model.trim()
  if (!model) throw new Error('Pick a model')
  if (args.key?.trim()) setSecret('provider', args.key)
  updateSettings({ provider: 'custom', customProvider: { baseUrl, model } })
  return providerStatus()
}

export function setActiveProvider(kind: ProviderKind): ProviderStatus {
  if (kind === 'custom' && !getSettings().customProvider?.model)
    throw new Error('Set up your API key and model first')
  updateSettings({ provider: kind })
  return providerStatus()
}

let proxy: Promise<Proxy> | null = null

/**
 * The environment Claude Code runs with when Luca edits with the person's own provider: every
 * request goes to Luca's local bridge, which sends it on to their endpoint with their key.
 * Null while the Claude subscription is used.
 */
export async function customProviderEnv(): Promise<Record<string, string> | null> {
  const up = upstream()
  if (!up) return null
  proxy ??= startProxy(upstream)
  const p = await proxy
  return {
    ANTHROPIC_BASE_URL: p.url,
    ANTHROPIC_AUTH_TOKEN: p.token,
    ANTHROPIC_MODEL: up.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: up.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: up.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: up.model,
    ANTHROPIC_SMALL_FAST_MODEL: up.model,
    CLAUDE_CODE_SUBAGENT_MODEL: up.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_PROMPT_CACHING: '1'
  }
}

export async function closeProviderProxy(): Promise<void> {
  const p = proxy
  proxy = null
  await (await p)?.close()
}

/** `claude auth logout`: the Claude account is signed out of Claude Code on this Mac. */
export async function signOutClaude(): Promise<void> {
  const claude = await which('claude')
  if (!claude) return
  const r = await run(claude, ['auth', 'logout'], {
    env: await childEnv(),
    timeoutMs: 20_000,
    cwd: homedir()
  })
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || 'Signing out failed')
}
