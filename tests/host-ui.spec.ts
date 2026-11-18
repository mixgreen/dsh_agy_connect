import { expect, it, vi } from 'vitest'
import { registerHostUi } from '../src/host-ui.ts'
import { AGY_KEY } from '../src/agy-provider.ts'

function host(bind?: string) {
  const register = vi.fn(), begin = vi.fn().mockResolvedValue({ status: 'authorized', ignored: 'private' })
  registerHostUi({ inject: (_: unknown, setup: Function) => setup({
    get: () => bind && { host: bind }, authorization: { begin }, connection: { fetch: { register } },
  }) } as never)
  const route = register.mock.calls[0]![0]
  expect(route).toMatchObject({ path: '/api/agy-connect/login', methods: ['POST'], requestBody: 'buffered' })
  const call = (method = 'agy-connect/login', payload: unknown = {}) => route.fetch(new Request('http://localhost/api/agy-connect/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: '1', method, payload }),
  })).then((r: Response) => r.json())
  return { begin, call }
}
it.each([undefined, '0.0.0.0', 'localhost'])('does not start auth on bind %s', async bind => {
  const { call, begin } = host(bind)
  expect(await call()).toMatchObject({ result: { ok: false, error: { code: 'loopback-required' } } })
  expect(begin).not.toHaveBeenCalled()
})
it('calls only the fixed native flow and returns only the outcome', async () => {
  const { call, begin } = host('127.0.0.1')
  for (const [method, payload] of [['other', {}], ['agy-connect/login', { key: 'other' }]] as const) {
    expect(await call(method, payload)).toMatchObject({ result: { ok: false } })
  }
  expect(begin).not.toHaveBeenCalled()
  expect(await call()).toEqual({ type: 'server-response', rpcId: '1', result: { ok: true, value: 'authorized' } })
  expect(begin).toHaveBeenCalledWith(expect.objectContaining({ key: AGY_KEY, method: 'google', signal: expect.any(AbortSignal) }))
  begin.mockRejectedValue(new Error('private detail'))
  expect(JSON.stringify(await call())).not.toContain('private detail')
})
