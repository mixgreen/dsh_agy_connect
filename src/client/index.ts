import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { loginMethod } from '../ui-contract.ts'
import { en, zh, Settings, type LoginState } from './settings.tsx'

const namespace = 'settings.agyConnect'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.agyConnect': keyof typeof en }
}
export const inject = ['slots', 'locale', 'connection']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'agy-connect: locales')
  const t = ctx.locale.bind(namespace)
  const login = async (signal: AbortSignal): Promise<LoginState> => {
    const connection = ctx.get('connection') as ConnectionHandle
    const result = await connection.rpc.call('/api', loginMethod, {}, signal)
    if (!result.ok) return result.error.code === 'loopback-required' ? 'blocked' : 'failed'
    return result.value === 'authorized' || result.value === 'cancelled' ? result.value : 'failed'
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'agy-connect', order: 21, label: () => t('nav'), inject: () => ({ t, login }),
  }, Settings))
}
