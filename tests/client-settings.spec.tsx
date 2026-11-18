import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { it, expect, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { zh, Settings } from '../src/client/settings.tsx'

it('renders the registered localized pane and calls only the exact login RPC', async () => {
  const register = vi.fn(), call = vi.fn(), t = (key: keyof typeof zh) => zh[key]
  apply({ locale: { register() {}, bind: () => t }, effect: (f: Function) => f(),
    get: () => ({ rpc: { call } }), slots: { inject: (_: string, f: Function) => f(), register },
  } as never)
  const [slot, view] = register.mock.calls[0]!
  expect(view).toBe(Settings)
  expect(slot.label()).toBe(zh.nav)
  const props = slot.inject()
  expect(renderToStaticMarkup(<Settings {...props} />)).toContain(zh.signIn)
  const signal = new AbortController().signal
  for (const [reply, state] of [
    [{ ok: true, value: 'authorized' }, 'authorized'], [{ ok: true, value: 'cancelled' }, 'cancelled'],
    [{ ok: true, value: 'unknown' }, 'failed'], [{ ok: false, error: { code: 'loopback-required' } }, 'blocked'],
  ] as const) {
    call.mockResolvedValueOnce(reply)
    expect(await props.login(signal)).toBe(state)
    expect(call).toHaveBeenLastCalledWith('/api', 'agy-connect/login', {}, signal)
  }
})
