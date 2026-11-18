import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { AGY_KEY } from './agy-provider.ts'
import { loginMethod } from './ui-contract.ts'

const failure = (code: string) => ({ ok: false, error: { code, message: code, details: {} } })

export function registerHostUi(ctx: Context): void {
  ctx.inject(['connection', 'authorization'], scoped => scoped.connection.fetch.register({
    // Connection 只允许 owner 访问精确路由；另行检查绑定地址，不信任请求头。
    path: `/api/${loginMethod}`, methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return new Response(null, { status: 415 })
      const envelope = clientRequestSchema.safeParse(await request.json().catch(() => null))
      if (!envelope.success) return new Response(null, { status: 400 })
      const { rpcId, method, payload } = envelope.data
      const reply = (result: unknown) => Response.json({ type: 'server-response', rpcId, result })
      if (scoped.get('webServer')?.host !== '127.0.0.1') return reply(failure('loopback-required'))
      if (method !== loginMethod || !payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) return reply(failure('bad-request'))
      try {
        const { status } = await scoped.authorization.begin({
          key: AGY_KEY, method: 'google', signal: request.signal,
          interaction: { notify() {}, async prompt() { throw new Error('Unexpected CLI authorization prompt') } },
        })
        return reply({ ok: true, value: status })
      } catch { return reply(failure('authorization-failed')) }
    },
  }))
}
