import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationFlow } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { LlmAdapter, LlmError, type GenerateOptions, type LlmModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PassThrough } from 'node:stream'
import { authenticateAgy, listAgyModels, promptAgy } from './agy-acp.ts'

export const AGY_PROVIDER = 'agy-gemini'
export const AGY_KEY = credentialKey('agy-connect', AGY_PROVIDER)
const description = 'Official Antigravity CLI · text chat only; no DSH tools or attachments'

export const agyAuthorization: AuthorizationFlow = {
  key: AGY_KEY,
  label: 'Gemini via Antigravity CLI',
  methods: [{ id: 'google', label: 'Sign in with Google via Antigravity CLI' }],
  async run(session) {
    session.notify({ message: 'Continue in the browser if prompted by Antigravity CLI.' })
    await authenticateAgy(session.signal)
    session.signal.throwIfAborted()
    // The CLI owns its Google credentials. DSH stores only this opt-in marker.
    await session.commit({ kind: 'grant', payload: { managedBy: 'agy' } })
  },
}

function chatPrompt(options: GenerateOptions): string {
  const history: { role: string, text: string }[] = []
  if (options.system) history.push({ role: 'system', text: options.system })
  for (const message of options.messages) {
    if (message.role === 'tool') throw LlmError.fromFailure({ message: 'AGY text chat cannot replay tool results; start a fresh text conversation.', code: 'UNSUPPORTED' })
    const parts: string[] = []
    for (const block of message.content) {
      // DSH may supply optional tools by default. Do not send their schemas or execute them.
      if (message.role === 'developer' && (block.type === 'tool-addition' || block.type === 'tool-removal')) continue
      if (block.type === 'text') parts.push(block.text)
      else throw LlmError.fromFailure({ message: `AGY text chat does not support ${block.type} content.`, code: 'UNSUPPORTED' })
    }
    if (parts.length) history.push({ role: message.role, text: parts.join('') })
  }
  return 'Respond to the latest user message in the following conversation. Return text only. Do not use tools, files, or commands.\n' + JSON.stringify(history)
}

export class AgyAdapter extends LlmAdapter {
  constructor(private readonly connected: () => Promise<boolean>) { super() }

  override providerInfo(provider: string) {
    if (provider !== AGY_PROVIDER) throw new LlmError('Unknown AGY provider', 'NO_ADAPTER')
    return { id: provider, name: 'Gemini via Antigravity CLI' }
  }

  override async listModels(provider: string, signal?: AbortSignal): Promise<readonly LlmModelInfo[]> {
    this.providerInfo(provider)
    if (!await this.connected()) return []
    return (await listAgyModels(signal)).filter(model => model.id.startsWith('gemini-')).map(model => ({
      provider, ...model, inputModalities: ['text'], description,
    }))
  }

  override async resolveModel(provider: string, model: string): Promise<LlmModelInfo> {
    this.providerInfo(provider)
    if (!/^gemini-[a-z0-9][a-z0-9.-]*$/.test(model)) throw LlmError.fromFailure({ message: 'Expected an AGY Gemini model ID', code: 'INVALID_MODEL' })
    return { provider, id: model, name: model, inputModalities: ['text'], description }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.resolveModel(options.provider, options.model)
    if (!await this.connected()) throw new LlmError('Sign in to Gemini via Antigravity CLI in DSH Authorization first.', 'AUTH')
    const prompt = chatPrompt(options)
    const controller = new AbortController()
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    const deltas = new PassThrough({ objectMode: true })
    const run = promptAgy({ model: options.model, prompt, signal, onText: text => { if (text) deltas.write(text) } })
      .then(() => { deltas.end() }, error => { deltas.destroy(error) })
    try {
      let complete = ''
      for await (const delta of deltas) {
        if (!complete) yield { type: 'block-start', index: 0, blockType: 'text' }
        complete += delta
        yield { type: 'text-delta', index: 0, text: delta }
      }
      if (!complete) throw new LlmError('AGY returned no text.', 'EMPTY_RESPONSE')
      yield { type: 'block-end', index: 0, block: { type: 'text', text: complete } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally {
      controller.abort()
      await run
    }
  }
}

export function registerAgyProvider(ctx: Context): void {
  ctx.inject(['authorization', 'credentials', 'llm'], scoped => {
    scoped.authorization.registerFlow(agyAuthorization)
    scoped.llm.registerAdapter([AGY_PROVIDER], new AgyAdapter(async () => {
      const info = await scoped.credentials.describeRecord(AGY_KEY)
      return info.configured && info.kind === 'grant'
    }))
  })
}
