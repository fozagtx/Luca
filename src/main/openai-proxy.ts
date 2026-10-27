import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A local bridge that speaks the Anthropic Messages API to Claude Code and the OpenAI chat
 * completions API to the person's own provider (Nebius, OpenRouter, Together, Groq, OpenAI,
 * a local server…), so Luca can edit with any model they have a key for.
 */

export type Upstream = { baseUrl: string; key: string; model: string }

export type Proxy = { url: string; token: string; close: () => Promise<void> }

type Json = Record<string, unknown>

type AnthropicBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string }
    }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result'
      tool_use_id: string
      content?: string | AnthropicBlock[]
      is_error?: boolean
    }
  | { type: 'thinking' | 'redacted_thinking'; [k: string]: unknown }

type AnthropicMessage = { role: 'user' | 'assistant'; content: string | AnthropicBlock[] }

type AnthropicRequest = {
  model?: string
  system?: string | { type: 'text'; text: string }[]
  messages: AnthropicMessage[]
  tools?: { name: string; description?: string; input_schema?: Json; type?: string }[]
  tool_choice?: { type: 'auto' | 'any' | 'tool' | 'none'; name?: string }
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  stream?: boolean
}

type OpenAIPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIPart[] }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

/** The provider's chat completions URL, from the base URL people paste (with or without /v1). */
export function completionsUrl(baseUrl: string): string {
  const b = baseUrl.trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(b)) return b
  return `${b}/chat/completions`
}

export function modelsUrl(baseUrl: string): string {
  const b = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
  return `${b}/models`
}

const imageUrl = (b: Extract<AnthropicBlock, { type: 'image' }>): string =>
  b.source.type === 'base64' ? `data:${b.source.media_type};base64,${b.source.data}` : b.source.url

function textOf(content: string | AnthropicBlock[] | undefined): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : ''))
    .filter(Boolean)
    .join('\n')
}

/** Schemas as Claude Code sends them; some providers refuse `$schema` and similar keys. */
function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Json = {}
  for (const [k, v] of Object.entries(schema as Json)) {
    if (k === '$schema') continue
    out[k] = cleanSchema(v)
  }
  return out
}

export function toOpenAI(req: AnthropicRequest, model: string): Json {
  const messages: OpenAIMessage[] = []
  const system =
    typeof req.system === 'string' ? req.system : textOf(req.system as AnthropicBlock[])
  if (system) messages.push({ role: 'system', content: system })

  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content } as OpenAIMessage)
      continue
    }
    if (m.role === 'assistant') {
      const text = m.content
        .filter((b): b is Extract<AnthropicBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('')
      const calls = m.content
        .filter((b): b is Extract<AnthropicBlock, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) }
        }))
      if (!text && !calls.length) continue
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {})
      })
      continue
    }
    // a user turn: tool results first (they answer the assistant's calls), then what was said
    const parts: OpenAIPart[] = []
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        const images = Array.isArray(b.content)
          ? b.content.filter(
              (c): c is Extract<AnthropicBlock, { type: 'image' }> => c.type === 'image'
            )
          : []
        const text = textOf(b.content)
        messages.push({
          role: 'tool',
          tool_call_id: b.tool_use_id,
          content: (b.is_error ? `Error: ${text}` : text) || '(no output)'
        })
        // tool messages can't carry pictures: they follow as the user's
        for (const img of images)
          parts.push({ type: 'image_url', image_url: { url: imageUrl(img) } })
      } else if (b.type === 'text') {
        parts.push({ type: 'text', text: b.text })
      } else if (b.type === 'image') {
        parts.push({ type: 'image_url', image_url: { url: imageUrl(b) } })
      }
    }
    if (parts.length) {
      const onlyText = parts.every((p) => p.type === 'text')
      messages.push({
        role: 'user',
        content: onlyText ? parts.map((p) => (p as { text: string }).text).join('\n') : parts
      })
    }
  }

  const tools = (req.tools ?? [])
    .filter((t) => !t.type || t.type === 'custom')
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: cleanSchema(t.input_schema ?? { type: 'object', properties: {} })
      }
    }))

  const body: Json = { model, messages }
  if (tools.length) {
    body.tools = tools
    const c = req.tool_choice
    if (c?.type === 'any') body.tool_choice = 'required'
    else if (c?.type === 'tool' && c.name)
      body.tool_choice = { type: 'function', function: { name: c.name } }
    else if (c?.type === 'none') body.tool_choice = 'none'
  }
  if (req.max_tokens) body.max_tokens = req.max_tokens
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.top_p !== undefined) body.top_p = req.top_p
  if (req.stop_sequences?.length) body.stop = req.stop_sequences
  return body
}

const STOP_REASONS: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'end_turn'
}

function parseArgs(s: string): unknown {
  try {
    return s ? JSON.parse(s) : {}
  } catch {
    return {}
  }
}

type Choice = {
  message?: {
    content?: string | null
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
  }
  finish_reason?: string | null
}

export function fromOpenAI(
  res: {
    id?: string
    choices?: Choice[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  },
  model: string
): Json {
  const choice = res.choices?.[0]
  const content: Json[] = []
  if (choice?.message?.content) content.push({ type: 'text', text: choice.message.content })
  for (const c of choice?.message?.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: c.id || `toolu_${randomUUID().replace(/-/g, '')}`,
      name: c.function?.name ?? '',
      input: parseArgs(c.function?.arguments ?? '')
    })
  }
  const usedTools = content.some((c) => c.type === 'tool_use')
  return {
    id: `msg_${randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: usedTools
      ? 'tool_use'
      : (STOP_REASONS[choice?.finish_reason ?? 'stop'] ?? 'end_turn'),
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0
    }
  }
}

/** Turns the provider's chat-completion chunks into Anthropic stream events. */
export class StreamTranslator {
  private index = -1
  private open: 'text' | 'tool' | null = null
  /** OpenAI tool-call index → Anthropic content block index. */
  private toolBlocks = new Map<number, number>()
  private usedTools = false
  private finish: string | null = null
  private usage = { input_tokens: 0, output_tokens: 0 }

  private model: string
  private write: (event: string, data: Json) => void

  constructor(model: string, write: (event: string, data: Json) => void) {
    this.model = model
    this.write = write
  }

  start(): void {
    this.write('message_start', {
      type: 'message_start',
      message: {
        id: `msg_${randomUUID().replace(/-/g, '')}`,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    })
  }

  private closeBlock(): void {
    if (this.open === null) return
    this.write('content_block_stop', { type: 'content_block_stop', index: this.index })
    this.open = null
  }

  chunk(c: {
    choices?: {
      delta?: {
        content?: string | null
        tool_calls?: {
          index?: number
          id?: string
          function?: { name?: string; arguments?: string }
        }[]
      }
      finish_reason?: string | null
    }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null
  }): void {
    if (c.usage) {
      this.usage.input_tokens = c.usage.prompt_tokens ?? this.usage.input_tokens
      this.usage.output_tokens = c.usage.completion_tokens ?? this.usage.output_tokens
    }
    const choice = c.choices?.[0]
    if (!choice) return
    const d = choice.delta ?? {}
    if (d.content) {
      if (this.open !== 'text') {
        this.closeBlock()
        this.index++
        this.open = 'text'
        this.write('content_block_start', {
          type: 'content_block_start',
          index: this.index,
          content_block: { type: 'text', text: '' }
        })
      }
      this.write('content_block_delta', {
        type: 'content_block_delta',
        index: this.index,
        delta: { type: 'text_delta', text: d.content }
      })
    }
    for (const t of d.tool_calls ?? []) {
      const key = t.index ?? 0
      let block = this.toolBlocks.get(key)
      if (block === undefined) {
        this.closeBlock()
        this.index++
        block = this.index
        this.toolBlocks.set(key, block)
        this.open = 'tool'
        this.usedTools = true
        this.write('content_block_start', {
          type: 'content_block_start',
          index: block,
          content_block: {
            type: 'tool_use',
            id: t.id || `toolu_${randomUUID().replace(/-/g, '')}`,
            name: t.function?.name ?? '',
            input: {}
          }
        })
      }
      const args = t.function?.arguments
      // a provider that interleaves two calls' arguments can't be streamed block by block
      if (args && block === this.index && this.open === 'tool') {
        this.write('content_block_delta', {
          type: 'content_block_delta',
          index: block,
          delta: { type: 'input_json_delta', partial_json: args }
        })
      }
    }
    if (choice.finish_reason) this.finish = choice.finish_reason
  }

  end(): void {
    this.closeBlock()
    this.write('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: this.usedTools
          ? 'tool_use'
          : (STOP_REASONS[this.finish ?? 'stop'] ?? 'end_turn'),
        stop_sequence: null
      },
      usage: this.usage
    })
    this.write('message_stop', { type: 'message_stop' })
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  529: 'overloaded_error'
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message } })}\n\n`
    )
    res.end()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      type: 'error',
      error: { type: ERROR_TYPES[status] ?? 'api_error', message }
    })
  )
}

/** The provider's own words for an error, from its JSON body when there is one. */
function upstreamMessage(status: number, text: string): string {
  try {
    const j = JSON.parse(text) as {
      error?: { message?: string } | string
      detail?: unknown
      message?: string
    }
    const m =
      (typeof j.error === 'string' ? j.error : j.error?.message) ??
      j.message ??
      (typeof j.detail === 'string' ? j.detail : j.detail ? JSON.stringify(j.detail) : undefined)
    if (m) return `Your model provider said (${status}): ${m}`
  } catch {
    // not JSON
  }
  return `Your model provider said (${status}): ${text.slice(0, 300) || 'no details'}`
}

/** Too many output tokens for this model: the request goes again with the provider's default. */
const MAX_TOKENS_REFUSED =
  /max_tokens|max_completion_tokens|maximum context|context length|too large/i

async function callUpstream(up: Upstream, body: Json, signal: AbortSignal): Promise<Response> {
  const send = (b: Json): Promise<Response> =>
    fetch(completionsUrl(up.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(up.key ? { authorization: `Bearer ${up.key}` } : {})
      },
      body: JSON.stringify(b),
      signal
    })
  const r = await send(body)
  if (r.status !== 400 || body.max_tokens === undefined) return r
  const text = await r.text()
  if (!MAX_TOKENS_REFUSED.test(text))
    return new Response(text, { status: r.status, headers: r.headers })
  const { max_tokens: _drop, ...rest } = body
  void _drop
  return send(rest)
}

async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  up: Upstream
): Promise<void> {
  const parsed = JSON.parse(await readBody(req)) as AnthropicRequest
  const model = up.model
  const body = toOpenAI(parsed, model)
  const abort = new AbortController()
  res.on('close', () => abort.abort())

  if (!parsed.stream) {
    const r = await callUpstream(up, body, abort.signal)
    const text = await r.text()
    if (!r.ok) return sendError(res, r.status, upstreamMessage(r.status, text))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(fromOpenAI(JSON.parse(text), model)))
    return
  }

  body.stream = true
  body.stream_options = { include_usage: true }
  let r = await callUpstream(up, body, abort.signal)
  // some servers don't know stream_options
  if (r.status === 400) {
    const text = await r.text()
    if (/stream_options/i.test(text)) {
      delete body.stream_options
      r = await callUpstream(up, body, abort.signal)
    } else {
      return sendError(res, 400, upstreamMessage(400, text))
    }
  }
  if (!r.ok || !r.body) return sendError(res, r.status, upstreamMessage(r.status, await r.text()))

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })
  const write = (event: string, data: Json): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const t = new StreamTranslator(model, write)
  t.start()
  const decoder = new TextDecoder()
  let buf = ''
  const reader = r.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const chunk = JSON.parse(data) as Parameters<StreamTranslator['chunk']>[0] & {
          error?: { message?: string }
        }
        if (chunk.error)
          return sendError(res, 500, `Your model provider said: ${chunk.error.message ?? 'error'}`)
        t.chunk(chunk)
      } catch {
        // a keep-alive or a line split oddly: skip it
      }
    }
  }
  t.end()
  res.end()
}

/** Roughly how many tokens a request is, for Claude Code's context bookkeeping. */
function countTokens(body: string): number {
  return Math.ceil(body.length / 4)
}

export async function startProxy(upstream: () => Upstream | null): Promise<Proxy> {
  // only Claude Code, started by Luca with this token, may use the person's key through here
  const token = randomBytes(24).toString('hex')
  const server = createServer((req, res) => {
    void (async () => {
      const auth = req.headers.authorization ?? ''
      const key = req.headers['x-api-key']
      if (auth !== `Bearer ${token}` && key !== token) return sendError(res, 401, 'Invalid API key')
      const up = upstream()
      if (!up) return sendError(res, 401, 'No model provider is set up in Luca')
      const path = (req.url ?? '').split('?')[0]
      if (req.method === 'POST' && /\/v1\/messages\/count_tokens$/.test(path)) {
        const n = countTokens(await readBody(req))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: n }))
        return
      }
      if (req.method === 'POST' && /\/v1\/messages$/.test(path)) return handleMessages(req, res, up)
      sendError(res, 404, `Luca's bridge doesn't serve ${req.method} ${path}`)
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (!res.writableEnded) sendError(res, 502, `Luca couldn’t reach your model provider: ${msg}`)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
