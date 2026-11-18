import React, { useEffect, useRef, useState } from 'react'

export const en = {
  nav: 'Gemini via Antigravity CLI', signIn: 'Sign in with Google via Antigravity CLI',
  intro: 'Use the official Antigravity CLI (agy) on this host. Google credentials stay with the CLI.',
  waiting: 'Waiting for Antigravity CLI. Continue in your browser if prompted.',
  authorized: 'Signed in. Select agy-gemini in the model picker.', cancelled: 'Sign-in cancelled.',
  failed: 'Sign-in failed. Check that agy is installed and retry.', blocked: 'Sign-in requires a local DSH host bound to 127.0.0.1.',
}
export const zh: Record<keyof typeof en, string> = {
  nav: 'Gemini（Antigravity CLI）', signIn: '通过 Antigravity CLI 登录 Google',
  intro: '使用本机官方 Antigravity CLI（agy）。Google 凭据由 CLI 保管。',
  waiting: '正在等待 Antigravity CLI。如有提示，请在浏览器中继续。',
  authorized: '登录成功。请在模型选择器中选择 agy-gemini。', cancelled: '已取消登录。',
  failed: '登录失败。请确认本机已安装 agy 后重试。', blocked: '登录需要绑定到 127.0.0.1 的本地 DSH 宿主。',
}
export type LoginState = 'authorized' | 'cancelled' | 'blocked' | 'failed'
export function Settings({ t, login }: { t(key: keyof typeof en): string; login(signal: AbortSignal): Promise<LoginState> }) {
  const [state, setState] = useState<LoginState | 'waiting'>()
  const active = useRef<AbortController>()
  useEffect(() => () => active.current?.abort(), [])
  async function start() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setState('waiting')
    try {
      const result = await login(controller.signal)
      if (!controller.signal.aborted) setState(result)
    } catch { if (!controller.signal.aborted) setState('failed') }
    finally { active.current = undefined }
  }
  return <section aria-labelledby="agy-connect-title">
    <h2 id="agy-connect-title">{t('nav')}</h2>
    <p>{t('intro')}</p>
    <button type="button" disabled={state === 'waiting'} onClick={() => { void start() }}>{t('signIn')}</button>
    <p role="status">{state && t(state)}</p>
  </section>
}
