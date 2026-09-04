/**
 * 现成流量看板：GoatCounter（免费、无 cookie、适合 GitHub Pages）
 *
 * 开通步骤：
 * 1. 打开 https://www.goatcounter.com/signup 注册
 * 2. 站点码填成你想要的（如 ow-sim）→ 看板地址 https://ow-sim.goatcounter.com
 * 3. 把下面 GOATCOUNTER_CODE 改成你的站点码，推送后即可看 PV/UV
 */
export const GOATCOUNTER_CODE = 'zhongyc1997ow'

declare global {
  interface Window {
    goatcounter?: {
      count: (vars?: { path?: string; title?: string; event?: boolean }) => void
    }
  }
}

/** 注入 GoatCounter；未填站点码则跳过 */
export function initAnalytics() {
  const code = GOATCOUNTER_CODE.trim()
  if (!code) return
  if (document.querySelector('script[data-goatcounter]')) return

  const s = document.createElement('script')
  s.async = true
  s.src = 'https://gc.zgo.at/count.js'
  s.dataset.goatcounter = `https://${code}.goatcounter.com/count`
  document.head.appendChild(s)
}

/** SPA 内自定义事件（可选）：开局、结算等 */
export function trackEvent(path: string, title: string) {
  if (!GOATCOUNTER_CODE.trim()) return
  const send = () => window.goatcounter?.count({ path: `/event/${path}`, title, event: true })
  if (window.goatcounter?.count) send()
  else window.setTimeout(send, 800)
}
