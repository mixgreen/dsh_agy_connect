import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// GUI applications need not inherit the user's shell PATH. Never search the workspace.
async function executable() {
  for (const path of [join(homedir(), '.local/bin/agy'), '/opt/homebrew/bin/agy', '/usr/local/bin/agy']) {
    try { await access(path, constants.X_OK); return path } catch { /* next known installation */ }
  }
  throw new Error('Official Antigravity CLI (agy) not found. Install it in ~/.local/bin, /opt/homebrew/bin, or /usr/local/bin.')
}

const agent = 'dsh-text'
const definition = `---
name: dsh-text
description: Text-only assistant for DeepSeek Harness.
tools: []
mainAgent: true
subagent: false
commandExecutionPolicy: "off"
mcpServers: []
skills: []
plugins: []
---
Answer using text alone. Do not use tools, files, or commands.
`

type ObjectValue = Record<string, unknown>
function obj(value: unknown): ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
}
type Model = { id: string, name: string }
type Prompt = { model: string, prompt: string, signal?: AbortSignal | undefined, onText: (text: string) => void }
type Call = (method: string, params: ObjectValue) => Promise<ObjectValue>

async function withCli<T>(signal: AbortSignal | undefined, task: (call: Call, cwd: string, init: ObjectValue) => Promise<T>, onText?: (text: string) => void): Promise<T> {
  signal?.throwIfAborted()
  const bin = await executable()
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-agy-'))
  try {
    const agents = join(cwd, '.agents', 'agents')
    await mkdir(agents, { recursive: true })
    await writeFile(join(agents, agent + '.md'), definition, { mode: 0o600 })
    signal?.throwIfAborted()
    // Keep desktop/session networking, but don't hand the CLI DSH credentials, API keys,
    // library injection flags, or the repository environment.
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin' }
    for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
      if (process.env[key] !== undefined) env[key] = process.env[key]
    }
    const child = spawn(bin, ['acp', '--stdio', '--sandbox', '--agent', agent, '--include-default-customizations=false'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] })
    let seq = 0, sessionId: string | undefined, buffer = '', failure: Error | undefined
    let pending: { id: number, method: string, resolve: (result: ObjectValue) => void, reject: (err: Error) => void } | undefined
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
    const send = (msg: ObjectValue) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
    const fail = (err: Error) => { failure ??= err; pending?.reject(failure); pending = undefined }
    const stopped = () => fail(new Error('Antigravity CLI closed its ACP connection.'))
    child.once('error', stopped); child.once('close', stopped); child.stdin.on('error', stopped); child.stdout.on('error', stopped)
    const abort = () => {
      if (sessionId && pending?.method === 'session/prompt' && child.stdin.writable) send({ method: 'session/cancel', params: { sessionId } })
      fail(new DOMException('Antigravity operation aborted.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    const deadline = setTimeout(() => fail(new Error('Antigravity ACP operation timed out.')), 5 * 60_000)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (failure) return
      try {
        buffer += chunk
        let end: number
        while ((end = buffer.indexOf('\n')) !== -1) {
          if (end > 4_194_304) throw new Error('Oversized ACP frame.')
          const msg = obj(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1)
          if (msg.jsonrpc !== '2.0') throw new Error('Invalid ACP frame.')
          if (typeof msg.method === 'string') {
            if (msg.id != null) {
              send(msg.method === 'session/request_permission'
                ? { id: msg.id, result: { outcome: { outcome: 'cancelled' } } }
                : { id: msg.id, error: { code: -32601, message: 'Client capability unavailable.' } })
            } else if (msg.method === 'session/update' && sessionId && obj(msg.params).sessionId === sessionId && pending?.method === 'session/prompt') {
              const update = obj(obj(msg.params).update), content = obj(update.content)
              if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') throw new Error('Antigravity requested a tool in a text-only session.')
              if (update.sessionUpdate === 'agent_message_chunk' && content.type === 'text' && typeof content.text === 'string') onText?.(content.text)
            }
          } else if (pending && msg.id === pending.id) {
            const waiter = pending; pending = undefined
            if ('error' in msg) {
              const code = obj(msg.error).code
              waiter.reject(new Error(code === -32000 ? 'Antigravity sign-in required. Use the official CLI login.' : `Antigravity ACP ${waiter.method} failed (${typeof code === 'number' ? code : 'unknown'}).`))
            } else if ('result' in msg) {
              const result = obj(msg.result)
              if (waiter.method === 'session/new' && typeof result.sessionId === 'string') sessionId = result.sessionId
              waiter.resolve(result)
            } else waiter.reject(new Error('Invalid ACP result.'))
          }
        }
        if (buffer.length > 4_194_304) throw new Error('Oversized ACP frame.')
      } catch (err) { fail(err instanceof SyntaxError ? new Error('Malformed ACP JSON.') : err instanceof Error ? err : new Error('Invalid ACP stream.')) }
    })
    const call: Call = (method, params) => new Promise((resolve, reject) => {
      if (failure) return reject(failure)
      const id = ++seq; pending = { id, method, resolve, reject }; send({ method, id, params })
    })
    try {
      const init = await call('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'dsh-agy-connect', version: '0.1.0' } })
      if (init.protocolVersion !== 1) throw new Error('Unsupported Antigravity ACP protocol version.')
      return await task(call, cwd, init)
    } finally {
      clearTimeout(deadline); signal?.removeEventListener('abort', abort)
      child.stdin.end()
      const kill = setTimeout(() => child.kill('SIGKILL'), 500)
      try { await closed } finally { clearTimeout(kill) }
    }
  } finally { await rm(cwd, { recursive: true, force: true }) }
}

/** Explicit user action only. Normal discovery and generation never start OAuth. */
export function authenticateAgy(signal?: AbortSignal): Promise<void> {
  return withCli(signal, async (call, _cwd, init) => {
    if (!Array.isArray(init.authMethods) || !init.authMethods.some(m => obj(m).id === 'oauth-personal')) throw new Error('Antigravity CLI does not advertise personal Google sign-in.')
    await call('authenticate', { methodId: 'oauth-personal' })
  })
}

async function newSession(call: Call, cwd: string) {
  const result = await call('session/new', { cwd, mcpServers: [] })
  const raw = obj(result.models).availableModels
  if (typeof result.sessionId !== 'string' || !result.sessionId || !Array.isArray(raw)) throw new Error('Missing ACP session or model catalog.')
  const models: Model[] = []
  for (const item of raw) {
    const { modelId, name } = obj(item)
    if (typeof modelId === 'string' && modelId && typeof name === 'string') models.push({ id: modelId, name })
  }
  return { sessionId: result.sessionId, models }
}

export function listAgyModels(signal?: AbortSignal): Promise<Model[]> {
  return withCli(signal, async (call, cwd) => (await newSession(call, cwd)).models)
}

export function promptAgy(options: Prompt): Promise<void> {
  return withCli(options.signal, async (call, cwd) => {
    const { sessionId, models } = await newSession(call, cwd)
    if (!models.some(m => m.id === options.model)) throw new Error('Requested model is not in the Antigravity CLI catalog.')
    await call('session/set_model', { sessionId, modelId: options.model })
    const result = await call('session/prompt', { sessionId, prompt: [{ type: 'text', text: options.prompt }] })
    if (result.stopReason === 'cancelled') throw new DOMException('Antigravity prompt cancelled.', 'AbortError')
    if (result.stopReason !== 'end_turn') throw new Error('Antigravity prompt ended without completing.')
  }, options.onText)
}
