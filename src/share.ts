import QRCode from 'qrcode'

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

function stripHtml(s: string) {
  const d = document.createElement('div')
  d.innerHTML = s
  return (d.textContent || '').replace(/\s+/g, ' ').trim()
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
  if (isWeChat()) return '微信：长按下方图片 →「保存图片」→ 从相册发给好友（才会显示成大图）'
  if (isIOS()) return '长按图片保存到相册，或点「保存图片」'
  return '点「保存 PNG」下载；发图时选相册里刚存的那张'
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  let line = ''
  for (const ch of text) {
    const t = line + ch
    if (ctx.measureText(t).width > maxW && line) {
      out.push(line)
      line = ch
    } else line = t
  }
  if (line) out.push(line)
  return out
}

/** 同步画二维码（避免 await 丢失用户手势 → iOS/微信 toDataURL 白图） */
function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const modules = qr.modules
  const n = modules.size
  const cell = size / n
  ctx.fillStyle = '#e8e2d4'
  ctx.fillRect(x, y, size, size)
  ctx.fillStyle = '#0c0c0d'
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules.get(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell + 0.5, cell + 0.5)
    }
  }
}

/**
 * 全程同步画海报并 toDataURL。
 * 必须在点击回调的同步栈里调用，否则 Safari/微信会返回空白白图。
 */
function paintPngDataUrl(p: SharePoster): string {
  const W = 750
  const pad = 48
  const accent = p.dark || p.banned ? '#d45a5a' : '#c9a55c'
  const bone = '#e8e2d4'
  const dim = '#948e83'
  const ink = p.dark || p.banned ? '#140c0e' : '#0c0c0d'
  const qrSize = 220

  const hero = stripHtml(p.heroHtml) || '—'
  const stats = p.stats.map(stripHtml).filter(Boolean)

  const probe = document.createElement('canvas')
  const measure = probe.getContext('2d')!
  measure.font = '28px sans-serif'
  let contentH = 220 + stats.length * 40
  if (p.ending) {
    contentH += 60
    contentH += wrapLines(measure, p.ending.tip || '', W - pad * 2).length * 36
    for (const v of p.ending.verses.slice(0, 4)) {
      contentH += wrapLines(measure, v, W - pad * 2 - 20).length * 40 + 8
    }
  }
  contentH += qrSize + 130
  const H = Math.max(1100, Math.ceil(contentH + pad * 2))

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  // 挂进 DOM：部分 WebView 对离屏 canvas 读像素会直接给白图
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d', { alpha: false })!
  if (!ctx) {
    canvas.remove()
    throw new Error('no 2d context')
  }

  try {
    ctx.fillStyle = ink
    ctx.fillRect(0, 0, W, H)

    const g = ctx.createRadialGradient(W / 2, 0, 20, W / 2, 180, 480)
    g.addColorStop(0, p.banned || p.dark ? 'rgba(180,40,40,0.28)' : 'rgba(201,165,92,0.16)')
    g.addColorStop(1, ink)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, 520)

    ctx.strokeStyle = 'rgba(232,226,212,0.22)'
    ctx.lineWidth = 2
    ctx.strokeRect(24, 24, W - 48, H - 48)

    let y = 88
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = accent
    ctx.font = 'bold 34px sans-serif'
    ctx.fillText('守望天梯人生', W / 2, y)
    y += 42
    ctx.fillStyle = dim
    ctx.font = '22px sans-serif'
    ctx.fillText(p.note, W / 2, y)
    y += 36
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.moveTo(W / 2 - 56, y)
    ctx.lineTo(W / 2 + 56, y)
    ctx.stroke()
    ctx.globalAlpha = 1
    y += 44

    ctx.fillStyle = dim
    ctx.font = '24px sans-serif'
    ctx.fillText(p.sub, W / 2, y)
    y += 58

    ctx.fillStyle = p.banned ? '#f09898' : bone
    ctx.font = 'bold 48px sans-serif'
    for (const line of wrapLines(ctx, hero, W - pad * 2)) {
      ctx.fillText(line, W / 2, y)
      y += 56
    }
    y += 10

    ctx.fillStyle = dim
    ctx.font = '24px sans-serif'
    for (const s of stats) {
      ctx.fillText(s, W / 2, y)
      y += 36
    }

    if (p.ending) {
      y += 24
      ctx.strokeStyle = 'rgba(232,226,212,0.14)'
      ctx.beginPath()
      ctx.moveTo(pad, y)
      ctx.lineTo(W - pad, y)
      ctx.stroke()
      y += 48
      ctx.fillStyle = accent
      ctx.font = 'bold 34px sans-serif'
      ctx.fillText(p.ending.title, W / 2, y)
      y += 40
      ctx.fillStyle = dim
      ctx.font = '22px sans-serif'
      for (const line of wrapLines(ctx, p.ending.tip || '', W - pad * 2)) {
        ctx.fillText(line, W / 2, y)
        y += 32
      }
      y += 14
      ctx.fillStyle = bone
      ctx.font = '26px sans-serif'
      ctx.textAlign = 'left'
      for (const v of p.ending.verses.slice(0, 4)) {
        for (const line of wrapLines(ctx, v, W - pad * 2 - 24)) {
          ctx.fillText(line, pad + 12, y)
          y += 36
        }
        y += 8
      }
      ctx.textAlign = 'center'
    }

    y += 24
    ctx.strokeStyle = 'rgba(232,226,212,0.14)'
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(W - pad, y)
    ctx.stroke()
    y += 36

    const qx = (W - qrSize) / 2
    ctx.fillStyle = bone
    ctx.fillRect(qx - 12, y - 12, qrSize + 24, qrSize + 24)
    drawQr(ctx, playUrl(), qx, y, qrSize)
    y += qrSize + 44
    ctx.fillStyle = bone
    ctx.font = 'bold 28px sans-serif'
    ctx.fillText('扫码开玩', W / 2, y)
    y += 32
    ctx.fillStyle = dim
    ctx.font = '20px sans-serif'
    ctx.fillText(shortUrl(playUrl()), W / 2, y)

    if (p.banned) {
      ctx.save()
      ctx.translate(110, 130)
      ctx.rotate((-28 * Math.PI) / 180)
      ctx.strokeStyle = '#d42a2a'
      ctx.fillStyle = 'rgba(40,8,8,0.45)'
      ctx.lineWidth = 5
      ctx.strokeRect(-70, -28, 200, 56)
      ctx.fillRect(-70, -28, 200, 56)
      ctx.fillStyle = '#d42a2a'
      ctx.font = 'bold 40px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('BAN', 30, 14)
      ctx.restore()
    }

    // 同步读出：必须在用户手势同步栈内
    return canvas.toDataURL('image/png')
  } finally {
    canvas.remove()
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] || 'image/png'
  const bin = atob(body)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

/** 弹出分享：同步生成真 PNG，避免白图 */
export function openShareSheet(p: SharePoster) {
  document.getElementById('share-sheet')?.remove()

  const wx = isWeChat()
  let dataUrl = ''
  try {
    dataUrl = paintPngDataUrl(p)
  } catch (e) {
    const sheetErr = document.createElement('div')
    sheetErr.id = 'share-sheet'
    sheetErr.className = 'share-sheet show'
    sheetErr.innerHTML = `<div class="share-backdrop" data-close></div>
      <div class="share-panel"><div class="share-head"><b>分享本局</b><button type="button" class="share-x" data-close>×</button></div>
      <p class="share-err">PNG 生成失败：${e instanceof Error ? e.message : '未知错误'}</p>
      <button type="button" class="btn" id="share-copy">复制游戏链接</button></div>`
    document.body.appendChild(sheetErr)
    sheetErr.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => sheetErr.remove()))
    wireCopy(sheetErr)
    return
  }

  const sheet = document.createElement('div')
  sheet.id = 'share-sheet'
  sheet.className = 'share-sheet'
  sheet.innerHTML = `
    <div class="share-backdrop" data-close></div>
    <div class="share-panel" role="dialog" aria-label="分享本局">
      <div class="share-head"><b>分享本局</b><button type="button" class="share-x" data-close aria-label="关闭">×</button></div>
      <div class="share-scroll">
        <img class="share-poster" id="share-poster" alt="分享海报 PNG" src="${dataUrl}" />
      </div>
      <p class="share-tip" id="share-tip">${tipText()}</p>
      <div class="share-actions">
        <button type="button" class="btn btn-primary" id="share-save">${wx ? '如何保存这张图' : '保存 PNG'}</button>
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

  const tip = sheet.querySelector('#share-tip') as HTMLElement
  const saveBtn = sheet.querySelector('#share-save') as HTMLButtonElement
  const poster = sheet.querySelector('#share-poster') as HTMLImageElement
  const filename = `守望天梯人生-${safeFile(p.ending?.title || p.sub)}.png`
  const blob = dataUrlToBlob(dataUrl)

  poster.addEventListener('click', () => {
    tip.textContent = wx ? '请长按图片，选择「保存图片」' : tipText()
  })

  saveBtn.onclick = () => {
    if (wx) {
      tip.classList.add('pulse')
      tip.textContent = '👆 长按上方 PNG 图片 → 选「保存图片」→ 打开相册发给好友'
      window.setTimeout(() => tip.classList.remove('pulse'), 900)
      return
    }
    saveBtn.disabled = true
    saveBtn.textContent = '下载中…'
    const ok = downloadBlob(blob, filename)
    saveBtn.textContent = ok ? '已保存' : '请长按图片保存'
    if (!ok) tip.textContent = '浏览器未触发下载，请长按上方图片保存'
    window.setTimeout(() => {
      saveBtn.textContent = '保存 PNG'
      saveBtn.disabled = false
    }, 1600)
  }
}

function downloadBlob(blob: Blob, filename: string): boolean {
  const obj = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = obj
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (isIOS()) return false
    return true
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(obj), 4000)
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
