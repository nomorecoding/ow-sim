import QRCode from 'qrcode'
import { toPng } from 'html-to-image'

/** 精简结算页式分享卡 */
export type SharePoster = {
  kind: 'life' | 'pro'
  /** 小字：天梯人生结算 / 职业生涯结算 */
  note: string
  /** 年龄行等 */
  sub: string
  /** 主视觉 HTML（段位 / 结局大字），可复用 rank-hero 样式 */
  heroHtml: string
  /** 中部统计，短句 */
  stats: string[]
  ending?: { title: string; tip: string; verses: string[] }
  /** 外挂 / 永封：左上斜红 BAN */
  banned?: boolean
  dark?: boolean
}

export function playUrl(): string {
  const u = new URL(location.href)
  u.search = ''
  u.hash = ''
  if (!u.pathname.endsWith('/') && !u.pathname.endsWith('.html')) {
    u.pathname = u.pathname.replace(/\/?$/, '/')
  }
  return u.toString()
}

function cardHtml(p: SharePoster, qrDataUrl: string): string {
  const ending = p.ending
    ? `<div class="section ending-card${p.dark ? ' dark-end' : ''}">
        <h2>${esc(p.ending.title)}</h2>
        <div class="tip">${esc(p.ending.tip)}</div>
        ${p.ending.verses.map((v) => `<div class="verse">${esc(v)}</div>`).join('')}
      </div>`
    : ''
  const stats = p.stats.length
    ? `<div class="stat share-stat">${p.stats.map((s) => `<span>${s}</span>`).join('')}</div>`
    : ''
  return `
    ${p.banned ? '<div class="share-ban" aria-hidden="true">BAN</div>' : ''}
    <div class="share-brand">守望天梯人生</div>
    <div class="share-note">${esc(p.note)}</div>
    <div class="sub share-sub">${esc(p.sub)}</div>
    <div class="rank-hero share-hero">${p.heroHtml}</div>
    ${stats}
    ${ending}
    <div class="share-qr-wrap">
      <img class="share-qr" src="${qrDataUrl}" alt="二维码" width="148" height="148" />
      <div class="share-qr-cap">扫码开玩</div>
      <div class="share-qr-url">${esc(shortUrl(playUrl()))}</div>
    </div>`
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function shortUrl(url: string) {
  try {
    const u = new URL(url)
    return (u.host + u.pathname).replace(/\/$/, '')
  } catch {
    return url
  }
}

function safeFile(s: string) {
  return s.replace(/[\\/:*?"<>|]/g, '').slice(0, 24) || 'settle'
}

/** 弹出分享：精简结算卡 + 保存 / 复制链接 / 系统分享 */
export async function openShareSheet(p: SharePoster) {
  document.getElementById('share-sheet')?.remove()

  const sheet = document.createElement('div')
  sheet.id = 'share-sheet'
  sheet.className = 'share-sheet'
  sheet.innerHTML = `
    <div class="share-backdrop" data-close></div>
    <div class="share-panel" role="dialog" aria-label="分享本局">
      <div class="share-head"><b>分享本局</b><button type="button" class="share-x" data-close aria-label="关闭">×</button></div>
      <div class="share-scroll">
        <div class="share-card${p.dark ? ' dark' : ''}${p.banned ? ' banned' : ''}" id="share-card">
          <div class="share-loading">生成中…</div>
        </div>
      </div>
      <div class="share-actions">
        <button type="button" class="btn btn-primary" id="share-save" disabled>保存图片</button>
        <button type="button" class="btn" id="share-copy">复制链接</button>
        <button type="button" class="btn" id="share-native" hidden>系统分享</button>
      </div>
      <p class="share-tip">保存的是精简结算页 · 扫码进主页开玩</p>
    </div>`
  document.body.appendChild(sheet)
  requestAnimationFrame(() => sheet.classList.add('show'))

  const close = () => {
    sheet.classList.remove('show')
    window.setTimeout(() => sheet.remove(), 220)
  }
  sheet.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close))

  const card = sheet.querySelector('#share-card') as HTMLElement
  let qrDataUrl: string
  try {
    qrDataUrl = await QRCode.toDataURL(playUrl(), {
      width: 296,
      margin: 1,
      color: { dark: '#0c0c0d', light: '#e8e2d4' },
      errorCorrectionLevel: 'M',
    })
  } catch {
    card.innerHTML = '<p class="share-err">二维码生成失败</p>'
    wireCopy(sheet)
    return
  }

  card.innerHTML = cardHtml(p, qrDataUrl)
  const saveBtn = sheet.querySelector('#share-save') as HTMLButtonElement
  saveBtn.disabled = false

  saveBtn.onclick = async () => {
    saveBtn.disabled = true
    saveBtn.textContent = '导出中…'
    try {
      // 等字体 / 图加载一帧
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const dataUrl = await toPng(card, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: getComputedStyle(document.body).backgroundColor || '#0c0c0d',
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `守望天梯人生-${safeFile(p.ending?.title || p.sub)}.png`
      a.click()
    } catch {
      saveBtn.textContent = '导出失败'
      window.setTimeout(() => { saveBtn.textContent = '保存图片'; saveBtn.disabled = false }, 1200)
      return
    }
    saveBtn.textContent = '已保存'
    window.setTimeout(() => { saveBtn.textContent = '保存图片'; saveBtn.disabled = false }, 1200)
  }

  wireCopy(sheet)

  const nativeBtn = sheet.querySelector('#share-native') as HTMLButtonElement
  if (typeof navigator.share === 'function') {
    nativeBtn.hidden = false
    nativeBtn.onclick = async () => {
      const url = playUrl()
      try {
        const dataUrl = await toPng(card, { pixelRatio: 2, cacheBust: true, backgroundColor: '#0c0c0d' })
        const blob = await (await fetch(dataUrl)).blob()
        const file = new File([blob], '守望天梯人生.png', { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title: '守望天梯人生', text: p.ending?.title || p.sub, url, files: [file] })
        } else {
          await navigator.share({ title: '守望天梯人生', text: `${p.ending?.title || p.sub}\n${url}`, url })
        }
      } catch {
        /* 取消 */
      }
    }
  }
}

function wireCopy(sheet: HTMLElement) {
  const btn = sheet.querySelector('#share-copy') as HTMLButtonElement | null
  if (!btn) return
  btn.onclick = async () => {
    const url = playUrl()
    try {
      await navigator.clipboard.writeText(url)
      btn.textContent = '已复制'
      window.setTimeout(() => { btn.textContent = '复制链接' }, 1400)
    } catch {
      window.prompt('复制链接', url)
    }
  }
}
