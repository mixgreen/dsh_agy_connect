import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { AGY_PROVIDER, AGY_KEY, AgyAdapter, agyAuthorization, registerAgyProvider } from '../src/agy-provider.ts'
import { authenticateAgy, listAgyModels, promptAgy } from '../src/agy-acp.ts'

vi.mock('../src/agy-acp.ts', () => ({ authenticateAgy: vi.fn(), listAgyModels: vi.fn(), promptAgy: vi.fn() }))
const options: GenerateOptions = { provider: AGY_PROVIDER, model: 'gemini-3.8-flash-low', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }
async function collect(adapter: AgyAdapter, request = options) {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream(request)) chunks.push(chunk)
  return chunks
}

describe('official AGY route', () => {
  beforeEach(() => vi.resetAllMocks())

  it('registers a distinct provider and explicit auth flow; removal disables listing and inference without invoking CLI', async () => {
    const describeRecord = vi.fn().mockResolvedValue({ configured: false })
    const registerFlow = vi.fn(), registerAdapter = vi.fn()
    const scoped = { credentials: { describeRecord }, authorization: { registerFlow }, llm: { registerAdapter } }
    registerAgyProvider({ inject: (_: unknown, cb: (ctx: typeof scoped) => void) => cb(scoped) } as never)
    expect(AGY_KEY).toBe('agy-connect/agy-gemini')
    expect(registerFlow).toHaveBeenCalledWith(agyAuthorization)
    expect(registerAdapter).toHaveBeenCalledWith(['agy-gemini'], expect.any(AgyAdapter))
    const adapter: AgyAdapter = registerAdapter.mock.calls[0]![1]
    expect(await adapter.listModels(AGY_PROVIDER)).toEqual([])
    expect(listAgyModels).not.toHaveBeenCalled()
    describeRecord.mockResolvedValue({ configured: true, kind: 'grant' })
    vi.mocked(listAgyModels).mockResolvedValue([{ id: options.model, name: 'Flash' }, { id: 'claude-other', name: 'Other' }])
    expect(await adapter.listModels(AGY_PROVIDER)).toEqual([expect.objectContaining({ id: options.model, name: 'Flash', inputModalities: ['text'] })])
    describeRecord.mockResolvedValue({ configured: false })
    await expect(collect(adapter)).rejects.toMatchObject({ code: 'AUTH' })
    expect(describeRecord).toHaveBeenCalledWith(AGY_KEY)
    expect(authenticateAgy).not.toHaveBeenCalled()
    expect(promptAgy).not.toHaveBeenCalled()
  })

  it('commits a non-secret opt-in only after successful explicit official sign-in', async () => {
    const session: AuthorizationSession = { method: 'google', signal: new AbortController().signal, notify: vi.fn(), commit: vi.fn(), prompt: vi.fn() }
    vi.mocked(authenticateAgy).mockRejectedValueOnce(new Error('cancelled'))
    await expect(agyAuthorization.run(session)).rejects.toThrow('cancelled')
    expect(session.commit).not.toHaveBeenCalled()
    await agyAuthorization.run(session)
    expect(authenticateAgy).toHaveBeenCalledWith(session.signal)
    expect(session.commit).toHaveBeenCalledWith({ kind: 'grant', payload: { managedBy: 'agy' } })
  })

  it('streams text, preserves system/history and omits optional tool schemas', async () => {
    vi.mocked(promptAgy).mockImplementation(async ({ onText }) => { onText('A'); onText('B') })
    const chunks = await collect(new AgyAdapter(async () => true), { ...options, system: 'Answer in Chinese', tools: [{ name: 'test_tool', description: 'not for AGY', parameters: {} }] })
    const call = vi.mocked(promptAgy).mock.calls[0]![0]
    expect(call.model).toBe(options.model)
    expect(call.prompt).toContain('Answer in Chinese')
    expect(call.prompt).toContain('Hello')
    expect(call.prompt).not.toContain('test_tool')
    expect(chunks.map(c => c.type)).toEqual(['block-start', 'text-delta', 'text-delta', 'block-end', 'finish'])
    expect(chunks[3]).toMatchObject({ block: { type: 'text', text: 'AB' } })
  })

  it('rejects actual tool calls, tool results, images and non-Gemini models before dispatch', async () => {
    const adapter = new AgyAdapter(async () => true)
    for (const message of [{ role: 'tool', content: [] }, { role: 'assistant', content: [{ type: 'tool-call' }] }, { role: 'user', content: [{ type: 'image' }] }]) {
      await expect(collect(adapter, { ...options, messages: [message as never] })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    }
    await expect(collect(adapter, { ...options, model: 'claude-other' })).rejects.toMatchObject({ code: 'INVALID_MODEL' })
    expect(promptAgy).not.toHaveBeenCalled()
  })
})
