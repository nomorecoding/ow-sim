import QRCode from 'qrcode'
import { toPng } from 'html-to-image'

/** 精简结算页式分享卡 */
export type SharePoster = {
  kind: 'life' | 'pro'
  note: string
  sub: string
  heroHtml: string
  stats: string[]
  ending?: { title: string; tip: string; verses: string[] }
  banned?: boolean
  dark?: boolean
}

const isWeChat = () => /MicroMessenger/i.test(navigator.userAgent)
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)

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
      <img class="share-qr" src="${qrDataUrl}" alt="" width="148" height="148" />
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

function tipText() {
  if (isWeChat()) return '微信里请长按上方图片 → 保存到手机 → 再发到聊天/朋友圈（会显示成图片，不是网页卡片）'
  if (isIOS()) return '可点「保存图片」，或长按图片存到相册后再转发'
  return '点「保存图片」下载 PNG，发图时选相册里的这张'
}

/** 弹出分享：先渲成 PNG 预览（可长按保存），避免微信把分享变成网页/文件卡片 */
export async function openShareSheet(p: SharePoster) {
  document.getElementById('share-sheet')?.remove()

  const wx = isWeChat()
  const sheet = document.createElement('div')
  sheet.id = 'share-sheet'
  sheet.className = 'share-sheet'
  sheet.innerHTML = `
    <div class="share-backdrop" data-close></div>
    <div class="share-panel" role="dialog" aria-label="分享本局">
      <div class="share-head"><b>分享本局</b><button type="button" class="share-x" data-close aria-label="关闭">×</button></div>
      <div class="share-scroll">
        <div class="share-loading" id="share-wait">正在生成图片…</div>
        <img class="share-poster" id="share-poster" alt="分享海报" hidden />
      </div>
      <p class="share-tip" id="share-tip">${tipText()}</p>
      <div class="share-actions">
        <button type="button" class="btn btn-primary" id="share-save" disabled>${wx ? '如何保存' : '保存图片'}</button>
        <button type="button" class="btn" id="share-copy">复制游戏链接</button>
      </div>
    </div>`
  document.body.appendChild(sheet)
  requestAnimationFrame(() => sheet.classList.add('show'))

  const close = () => {
    sheet.classList.remove('show')
    window.setTimeout(() => sheet.remove(), 220)
  }
  sheet.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close))
  wireCopy(sheet)

  const wait = sheet.querySelector('#share-wait') as HTMLElement
  const poster = sheet.querySelector('#share-poster') as HTMLImageElement
  const saveBtn = sheet.querySelector('#share-save') as HTMLButtonElement
  const tip = sheet.querySelector('#share-tip') as HTMLElement

  let dataUrl = ''
  try {
    const qrDataUrl = await QRCode.toDataURL(playUrl(), {
      width: 296,
      margin: 1,
      color: { dark: '#0c0c0d', light: '#e8e2d4' },
      errorCorrectionLevel: 'M',
    })

    // 离屏渲染 DOM 卡 → PNG（预览用真图片，微信才能长按存图）
    const paint = document.createElement('div')
    paint.className = `share-card share-paint${p.dark ? ' dark' : ''}${p.banned ? ' banned' : ''}`
    paint.innerHTML = cardHtml(p, qrDataUrl)
    document.body.appendChild(paint)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    // 等二维码图 decode
    await Promise.all(
      [...paint.querySelectorAll('img')].map((img) =>
        img.complete ? Promise.resolve() : new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res() })),
    )
    dataUrl = await toPng(paint, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#0c0c0d',
    })
    paint.remove()
  } catch {
    wait.className = 'share-err'
    wait.textContent = '图片生成失败，可先复制游戏链接'
    return
  }

  wait.remove()
  poster.hidden = false
  poster.src = dataUrl
  saveBtn.disabled = false

  saveBtn.onclick = async () => {
    if (wx) {
      tip.classList.add('pulse')
      tip.textContent = '请长按上方图片，选「保存图片」到相册，再从相册发给好友'
      window.setTimeout(() => tip.classList.remove('pulse'), 1200)
      return
    }
    saveBtn.disabled = true
    saveBtn.textContent = '导出中…'
    try {
      const ok = await downloadPng(dataUrl, `守望天梯人生-${safeFile(p.ending?.title || p.sub)}.png`)
      saveBtn.textContent = ok ? '已下载' : '请长按图片保存'
      if (!ok) tip.textContent = '浏览器拦了下载，请长按上方图片保存'
    } catch {
      saveBtn.textContent = '请长按图片保存'
      tip.textContent = '自动下载失败，请长按上方图片保存到相册'
    }
    window.setTimeout(() => {
      saveBtn.textContent = '保存图片'
      saveBtn.disabled = false
    }, 1600)
  }
}

async function downloadPng(dataUrl: string, filename: string): Promise<boolean> {
  // 优先 blob URL（部分 WebView 对 data: download 不友好）
  const blob = await (await fetch(dataUrl)).blob()
  const obj = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = obj
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // iOS Safari 常忽略 download，当作失败引导长按
    if (isIOS()) return false
    return true
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(obj), 2000)
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
      window.setTimeout(() => { btn.textContent = '复制游戏链接' }, 1400)
    } catch {
      window.prompt('复制链接', url)
    }
  }
}
