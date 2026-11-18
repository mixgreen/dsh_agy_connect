import type { Context } from '@deepseek-ai/cordis'
import { registerAgyProvider } from './agy-provider.ts'
import { registerHostUi } from './host-ui.ts'

export const name = 'agy-connect'
export function apply(ctx: Context): void {
  registerAgyProvider(ctx)
  registerHostUi(ctx)
}
