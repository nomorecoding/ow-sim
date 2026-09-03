import './style.css'
import type { GameState, Identity, LogLine, RankState } from './types'
import {
  BOOST_JOBS, DEFAULT_SPEED, FORM_INFO, FORM_ORDER, GEAR_LEVELS, GUN_COST, HELPER_PACK_GAMES, HELPER_TIERS, INTL_NAME,
  MAJOR_NAME, MIN_SPEED, PRO_START_AGE, PRO_UNLOCK_SEASONS, RANK_COLOR_CLASS, SOFT_RESET_EVERY,
  STAGE_INFO, TALENT_INFO, TALENT_ORDER, majorIndex,
} from './data/constants'
import { ACHIEVEMENTS, ACH_MAP } from './data/achievements'
import { growthPoints, talentProbs } from './data/talent'
import {
  buyGoldGun, buyJadeGun, commitSeason, createSeason, endSeasonEarly, freshMeta, isSoftResetSeason, labelIdentity,
  loadMeta, playMatch, writeMeta,
} from './sim/engine'
import { clamp, helperOdds as oddsFn, isLateSeason, rankScore, scoreToRank } from './sim/rank'
import {
  buyGear, cancelPreorder, describeHelper, enableCheat, helperCost, hireBooster, hireEscort, preorderHelper, purifyEnv,
  takeBoostJob,
} from './sim/shop'
import {
  beginYear, canStartCareer, commitYear, exposureP, formProbs, proChoose, proStep, proUnlocked, startCareer, teamOf,
  teamRating, yearInProgress,
} from './sim/pro'
import { pendingOffers, snoozeOffer, takeJob } from './sim/offers'
import { rehire } from './sim/shop'
import type { Offer } from './sim/offers'

const fmt = (n: number) => n.toLocaleString()
const DEBUG = new URLSearchParams(location.search).has('debug')

const meta = loadMeta()
if (typeof meta.speed !== 'number') meta.speed = DEFAULT_SPEED
if (typeof meta.manual !== 'boolean') meta.manual = false

let game: GameState | null = null
let timer: number | null = null
let paused = false
let fastForward = false
let settledOnce = false
let shownLog = 0
let shownEv = 0
let backFrom: 'home' | 'game' = 'home'
let escortCount = 1

const app = document.querySelector<HTMLDivElement>('#app')!
const $ = (id: string) => document.getElementById(id)

/* ———————————— 小工具 ———————————— */

function phaseLabel(g: GameState) {
  return ({ placement: '定级', regular: '常规', rivalry: '竞逐', settle: '结算' } as const)[g.phase]
}

function intervalMs() {
  if (fastForward) return 40
  return Math.max(MIN_SPEED * 1000, (meta.speed || DEFAULT_SPEED) * 1000)
}

function stopTimer() {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
}

function appendTo(id: string, lines: LogLine[]) {
  const box = $(id)
  if (!box) return
  const frag = document.createDocumentFragment()
  for (const l of lines) {
    const d = document.createElement('div')
    d.className = l.cls
    d.textContent = l.text
    frag.appendChild(d)
  }
  box.appendChild(frag)
  box.scrollTop = box.scrollHeight
}

function flushLogs() {
  if (!game) return
  if (shownLog < game.logs.length) {
    appendTo('log-box', game.logs.slice(shownLog))
    shownLog = game.logs.length
  }
  if (shownEv < game.events.length) {
    appendTo('event-box', game.events.slice(shownEv))
    shownEv = game.events.length
  }
}

/** 段位排版：中文大段用衬线，数字用 Didot */
function rankHtml(r: RankState) {
  const cls = RANK_COLOR_CLASS[r.major]
  if (r.major === 'top') return `<span class="${cls}"><span class="cn">${MAJOR_NAME[r.major]}</span> <span class="num">${r.rp}</span></span>`
  return `<span class="${cls}"><span class="cn">${MAJOR_NAME[r.major]}</span><span class="num">${r.div}</span> <span class="num" style="font-size:0.6em;opacity:0.7">${r.rp}</span></span>`
}

function rankInline(r: RankState) {
  return `<span class="${RANK_COLOR_CLASS[r.major]}">${MAJOR_NAME[r.major]}${r.major === 'top' ? '' : r.div} · ${r.rp}</span>`
}

function playerTag(g: GameState) {
  const id = `#${1000 + (g.season % 9000)}`
  return g.redBox ? `<span class="redbox-id">${id}</span>` : `<span class="num">${id}</span>`
}

function talentBadge(t: GameState['talent']) {
  const ti = TALENT_INFO[t]
  return `<span class="talent-badge ${ti.cls}">${ti.name}</span>`
}

function seasonOver(g: GameState) {
  return g.phase === 'settle' || g.banned
}

/* ———————————— HUD ———————————— */

function refreshHud() {
  if (!game) return
  const g = game
  const set = (id: string, html: string) => { const el = $(id); if (el) el.innerHTML = html }
  const pct = ((g.quotaMax - g.quotaLeft) / Math.max(1, g.quotaMax)) * 100
  set('hud-meta', `<span>S<span class="num">${g.season}</span> · 第<span class="num">${g.year}</span>年第<span class="num">${g.seasonInYear}</span>季</span><span><span class="num">${g.age}</span> 岁 · ${STAGE_INFO[g.stage].name}</span><span>${phaseLabel(g)} · ${playerTag(g)}</span>`)
  set('hud-rank', g.phase === 'placement' ? `<span class="sys" style="font-size:0.6em;letter-spacing:0.3em">定级中</span>` : rankHtml(g.rank))
  set('hud-persona', `${talentBadge(g.talent)}&nbsp;&nbsp;<span class="tip">【${g.persona.name}】${g.persona.tagline} · ${labelIdentity(g.identity)}</span>`)
  const helper = g.helper && g.helper.left > 0
    ? `<span>${g.helper.kind === 'boost' ? '代练' : `${g.helper.count} 陪 1`} 剩 <b class="num">${g.helper.left}</b></span>`
    : ''
  const rep = g.reportStacks > 0 ? `<span>举报 <b class="num">${g.reportStacks}</b></span>` : ''
  set('hud-res', `<span>现金 <b class="num ${g.cash < 0 ? 'lose' : ''}">${fmt(g.cash)}</b></span><span>信誉 <b class="num">${g.credit}</b></span><span>人气 <b class="num">${fmt(g.fans)}</b></span><span>竞技点 <b class="num">${g.compPoints}</b></span><span>污染 <b class="num">${g.envPollution}</b></span>${rep}${helper}`)
  const bar = $('hud-bar')
  if (bar) bar.style.width = `${pct}%`
  const conf = g.phase === 'placement' ? '' : ` · 系统识别 <span class="num">${Math.round(g.conf * 100)}</span>%`
  set('hud-quota', `<span class="num">${g.quotaMax - g.quotaLeft}</span> / <span class="num">${g.quotaMax}</span>${conf}${g.cloudMudAim ? ' · <span class="temper">控温中</span>' : ''}${fastForward ? ' · 快进' : ''}`)
  const mute = $('mute-line')
  if (mute) mute.classList.toggle('on', g.redBox)
  set('mute-title', `禁言中 · ID 已被红框 · 剩余 <span class="num">${g.muteLeft}</span> 把`)
}

function showSheet(id: string) {
  const m = $(id)
  if (m) m.hidden = false
}
function hideSheets() {
  for (const id of ['pause-mask', 'market-mask', 'helper-mask', 'pro-pause', 'pro-choice']) { const m = $(id); if (m) m.hidden = true }
}

/* ———————————— 邀约弹窗：职业模式解锁 / 负债抉择 ———————————— */

/** 逐个弹邀约；只要处理过至少一条，结束后调用 after（刷新页面） */
function showOffers(after: () => void, handled = false) {
  const list = pendingOffers(meta)
  if (!list.length) { if (handled) after(); return }
  const o: Offer = list[0]
  document.getElementById('offer-mask')?.remove()
  const mask = document.createElement('div')
  mask.className = 'mask'
  mask.id = 'offer-mask'
  mask.innerHTML = `<div class="mask-box">
    <div class="mask-title" ${o.danger ? 'style="color:var(--clay)"' : 'style="color:var(--brass)"'}>${o.title}</div>
    <div class="mask-body">${o.body}</div>
    ${o.buttons.map((b, i) => `<button class="btn ${b.cls ? 'btn-' + b.cls : ''}" data-i="${i}">${b.label}</button>`).join('')}
  </div>`
  document.body.appendChild(mask)
  mask.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((btn) => {
    btn.onclick = () => {
      const b = o.buttons[Number(btn.dataset.i)]
      const r = b.run(meta)
      snoozeOffer(meta, o)
      writeMeta(meta)
      mask.remove()
      if (r === 'market') { backFrom = 'home'; renderMarket(); return }
      if (r === 'play') { start('casual'); return }
      if (r === 'pro') { game = null; renderPro(); return }
      if (r && typeof r === 'object') toast(r.text)
      // 递归弹下一条
      showOffers(after, true)
    }
  })
}

function toast(text: string) {
  document.getElementById('toast')?.remove()
  const t = document.createElement('div')
  t.id = 'toast'
  t.className = 'toast'
  t.textContent = text
  document.body.appendChild(t)
  window.setTimeout(() => t.classList.add('show'), 10)
  window.setTimeout(() => { t.classList.remove('show'); window.setTimeout(() => t.remove(), 400) }, 4200)
}

/* ———————————— 两条线：天梯成长 / 职业模式 ———————————— */

function roadmap() {
  const p = meta.pro
  const bar = (v: number, cls = '') => `<div class="tal-bar road-bar"><i class="${cls}" style="width:${clamp(v * 100, 0, 100)}%"></i></div>`
  let pro: string
  let proBar = ''
  if (p.lifetimeBan) pro = '<span class="ban">终身禁赛 · 本存档永闭</span>'
  else if (p.active) { pro = `<span class="career">${teamOf(p.teamId)?.name ?? '自由人'}</span> · ${p.age} 岁 · 第 ${p.year + 1} 年`; proBar = bar(Math.min(1, p.yearsPlayed / 10), 'tal-3') }
  else if (proUnlocked(meta)) pro = `<span class="win">已解锁</span>${p.runs ? ` · 已打 ${p.runs} 段生涯` : ' · 单独一条线，点下面进去'}`
  else {
    const v = Math.min(1, meta.seasonsPlayed / PRO_UNLOCK_SEASONS)
    pro = `解锁：触及宗师，或打满 ${PRO_UNLOCK_SEASONS} 季（${meta.seasonsPlayed}/${PRO_UNLOCK_SEASONS}）`
    proBar = bar(v, 'tal-2')
  }
  const pts = growthPoints(meta.growth, meta.age)
  const achN = Object.keys(meta.achievements).filter((k) => ACH_MAP[k]).length
  const toPool = 5 - (achN % 5)
  return `<div class="section">
    <div class="label">两条线</div>
    <div class="road">
      <div class="road-row"><span class="road-k">天梯</span><div>成长 ${pts} · 再 ${toPool} 个成就英雄池 +1 · ${meta.age} 岁${meta.age >= 25 ? ' <span class="warn">年龄开始抵消成长</span>' : ''}${bar(Math.min(1, pts / 40), 'tal-1')}</div></div>
      <div class="road-row"><span class="road-k">职业</span><div>${pro}${proBar}</div></div>
    </div>
  </div>`
}

function tickMatch() {
  if (!game || paused) return
  if (seasonOver(game)) {
    stopTimer()
    timer = window.setTimeout(() => renderSettle(), 1400)
    return
  }
  playMatch(game)
  flushLogs()
  refreshHud()
  if (game.helperDone && !seasonOver(game)) {
    game.helperDone = false
    paused = true
    stopTimer()
    const body = $('helper-hint')
    if (body) body.innerHTML = `套餐打完了。现在 ${rankInline(game.rank)}，真实水平 ${rankInline(scoreToRank(game.mmr))}。${rankScore(game.rank) > game.mmr + 200 ? '不续单的话，系统会一把一把把分修正回去。' : '段位和水平差不多，自己打也守得住。'}<br>剩 ${game.quotaLeft} 把${isLateSeason(game) ? '，<span class="warn">赛季末帮手胜率 −10 点</span>' : ''}。`
    const again = $('btn-helper-again') as HTMLButtonElement | null
    if (again && game.lastHelper) {
      const cost = helperCost(game.lastHelper.kind, game.lastHelper.tier, game.lastHelper.count)
      const ok = game.cash >= cost
      again.hidden = false
      again.disabled = !ok
      again.textContent = ok ? `续同款 · ${describeHelper(game.lastHelper)} · ${fmt(cost)}` : `续同款要 ${fmt(cost)}，现金只有 ${fmt(game.cash)}`
    }
    showSheet('helper-mask')
    return
  }
  if (game.marketHint) {
    const t = game.marketHint
    game.marketHint = null
    paused = true
    stopTimer()
    const body = $('market-hint')
    if (body) body.textContent = t
    showSheet('market-mask')
    return
  }
  if (seasonOver(game)) {
    stopTimer()
    timer = window.setTimeout(() => renderSettle(), 1600)
    return
  }
  if (!meta.manual) timer = window.setTimeout(tickMatch, intervalMs())
}

function start(identity: Identity) {
  stopTimer()
  paused = false
  fastForward = false
  settledOnce = false
  game = createSeason(meta, identity)
  writeMeta(meta) // 预订已消费
  shownLog = 0
  shownEv = 0
  renderGame()
  flushLogs()
  refreshHud()
  if (!meta.manual) timer = window.setTimeout(tickMatch, intervalMs())
}

/* ———————————— 首页 ———————————— */

function talentPanel() {
  const pts = growthPoints(meta.growth, meta.age)
  const probs = talentProbs(pts)
  const rows = TALENT_ORDER.map((t) => {
    const ti = TALENT_INFO[t]
    const n = meta.talentLog[t] ?? 0
    return `<div class="tal-row">
      <div><span class="talent-badge ${ti.cls}">${ti.name}</span><div class="tal-range">${ti.range}</div></div>
      <div class="tal-bar"><i class="${ti.cls}" style="width:${clamp(probs[t] * 1.6, 1, 100)}%"></i></div>
      <span class="num">${probs[t]}%</span>
      <span class="tal-n num">${n ? `×${n}` : ''}</span>
    </div>`
  }).join('')
  const gr = meta.growth
  const agePen = meta.age >= 25 ? (meta.age - 24) + (meta.age >= 30 ? meta.age - 29 : 0) : 0
  return `<div class="section">
    <div class="row" style="border-bottom:0;padding:0 0 6px"><span class="label" style="margin:0">本季天赋概率</span><span class="tip">成长 <b class="num">${pts}</b></span></div>
    ${rows}
    <p class="tip" style="margin:12px 0 0">成长 = 赛季经验 ${Math.min(15, Math.floor(gr.seasons / 2))} · 英雄池 ${gr.heroPool} · 设备 ${gr.gear}${agePen ? ` · <span class="warn">年龄 −${agePen}</span>` : ''}<br>天赋只决定本季的隐藏真实水平；段位靠系统慢慢识别。</p>
  </div>`
}

function renderHome() {
  stopTimer()
  fastForward = false
  game = null
  const achCount = Object.keys(meta.achievements).filter((k) => ACH_MAP[k]).length
  const last = meta.lastRank
  const lastHtml = last ? rankInline(last) : `<span class="sys">${meta.seasonsPlayed ? '新号' : '未定级'}</span>`
  const notes: string[] = []
  if (isSoftResetSeason(meta)) notes.push('<span class="temper">本季软重置</span>')
  if (meta.preorder) notes.push(`<span class="warn">已预订 ${describeHelper(meta.preorder)}</span>`)
  if (meta.bansTotal) notes.push(`封号 ${meta.bansTotal} 次`)
  if (meta.envPollution) notes.push(`污染 ${meta.envPollution}`)
  if (meta.dirty.boostJobs + meta.dirty.hires + meta.dirty.cheatSeasons > 0) notes.push(`黑历史 · 代练单 ${meta.dirty.boostJobs} · 请人 ${meta.dirty.hires} · 开挂 ${meta.dirty.cheatSeasons} 季`)
  const debt = meta.cash < 0
  const debtSection = debt ? `<div class="section">
      <div class="label" style="color:var(--clay)">负债 ${fmt(-meta.cash)} · 三条路</div>
      <p class="tip" style="margin:0 0 10px">每季利息 6%。</p>
      <div class="menu">
        ${meta.stage === 'worker' ? '' : `<button class="menu-row" id="btn-job"><span class="name">找份正业<span class="odds">工资稳，额度少</span></span><span class="leader"></span><span class="price">上班</span></button>`}
        <button class="menu-row danger" id="btn-debt-market"><span class="name">去黑市接单<span class="odds">来钱快，进黑历史</span></span><span class="leader"></span><span class="price">风险</span></button>
        <button class="menu-row" id="btn-debt-keep"><span class="name">咬牙坚持<span class="odds">干干净净打上去</span></span><span class="leader"></span><span class="price">继续</span></button>
      </div>
    </div>` : ''

  const banBanner = meta.pro.lifetimeBan
    ? `<div class="mute-line on" style="margin-bottom:14px"><span>本存档职业模式已永闭 · 终身禁赛</span><small>天梯、黑市、成就照常。想再打职业只能删档重来（成就保留）。</small></div>`
    : ''
  const proLabel = meta.pro.lifetimeBan ? '职业模式 · 永闭' : !proUnlocked(meta) ? `职业模式 · 未解锁（${meta.seasonsPlayed}/${PRO_UNLOCK_SEASONS} 季或触及宗师）` : meta.pro.active ? `职业模式 · ${teamOf(meta.pro.teamId)?.name ?? '自由人'} · ${meta.pro.age} 岁` : '职业模式 · 开始一段生涯'
  app.innerHTML = `<div class="reveal">
    <h1>守望天梯人生</h1>
    <div class="sub">天赋随机 · 系统控分 · 云泥之隔</div>
    ${banBanner}
    <div class="dossier">
      <div class="cell"><div class="label">年份</div><div class="num">${meta.year}<span style="font-size:0.5em;color:var(--bone-dim)"> / ${meta.seasonInYear}</span></div><small>第 ${meta.seasonInYear} 季</small></div>
      <div class="cell"><div class="label">年龄</div><div class="num">${meta.age}</div><small>${STAGE_INFO[meta.stage].name}</small></div>
      <div class="cell"><div class="label">上赛季</div><div style="font-family:var(--display);font-size:1.05rem;line-height:1.6">${lastHtml}</div><small>账号 #${meta.accountNo}</small></div>
    </div>
    <div class="section">
      <div class="stat">
        <span>现金 <b class="num ${debt ? 'lose' : ''}">${fmt(meta.cash)}</b></span>
        <span>信誉 <b class="num">${meta.credit}</b></span>
        <span>人气 <b class="num">${fmt(meta.fans)}</b></span>
        <span>竞技点 <b class="num">${meta.compPoints}</b></span>
        <span>金枪 <b class="num">${meta.goldGuns}</b></span>
        <span>玉枪 <b class="num">${meta.jadeGuns}</b></span>
        <span>成就 <b class="num">${achCount}</b><span style="color:var(--bone-faint)"> / ${ACHIEVEMENTS.length}</span></span>
      </div>
      <p class="tip" style="margin:10px 0 0">${notes.join(' · ')}</p>
    </div>
    ${debtSection}
    ${roadmap()}
    ${talentPanel()}
    <div class="section" style="border-top:0;padding-top:6px">
      <button class="btn btn-primary" id="btn-casual">天梯 · 开局摇天赋</button>
      ${meta.dirty.boostJobs > 0 ? '<button class="btn btn-warn" id="btn-boost">天梯 · 代练号开局</button>' : ''}
      <button class="btn ${proUnlocked(meta) && !meta.pro.lifetimeBan ? 'btn-pro' : ''}" id="btn-career" ${proUnlocked(meta) ? '' : 'disabled'}>${proLabel}</button>
      <div class="grid-2">
        <button class="btn" id="btn-shop">商店</button>
        <button class="btn btn-warn" id="btn-market">黑市${meta.preorder ? ' · 已预订' : ''}</button>
      </div>
      <div class="grid-2">
        <button class="btn" id="btn-ach">成就</button>
        <button class="btn" id="btn-settings">设置</button>
      </div>
      <div class="grid-2">
        <button class="btn" id="btn-about">说明</button>
        <button class="btn btn-danger" id="btn-wipe">删档</button>
      </div>
    </div>
  </div>`
  $('btn-casual')!.onclick = () => start('casual')
  $('btn-boost')?.addEventListener('click', () => start('boost'))
  $('btn-career')!.onclick = renderPro
  $('btn-shop')!.onclick = () => { backFrom = 'home'; renderShop() }
  $('btn-market')!.onclick = () => { backFrom = 'home'; renderMarket() }
  $('btn-job')?.addEventListener('click', () => {
    const l = takeJob(meta)
    writeMeta(meta)
    renderHome()
    toast(l.text)
  })
  $('btn-debt-market')?.addEventListener('click', () => { backFrom = 'home'; renderMarket() })
  $('btn-debt-keep')?.addEventListener('click', () => start('casual'))
  $('btn-ach')!.onclick = renderAchievements
  $('btn-about')!.onclick = renderAbout
  $('btn-settings')!.onclick = renderSettings
  $('btn-wipe')!.onclick = () => {
    if (!confirm('删档重来：年龄、现金、段位、职业生涯、黑历史全部清零，成就保留。确定？')) return
    Object.assign(meta, freshMeta(), { speed: meta.speed, manual: meta.manual, achievements: meta.achievements, endings: meta.endings })
    writeMeta(meta)
    renderHome()
  }
  mountDebug()
  showOffers(renderHome)
}

/* ———————————— 调试抽屉（?debug=1） ———————————— */

function mountDebug() {
  document.getElementById('debug-drawer')?.remove()
  if (!DEBUG) return
  const d = document.createElement('div')
  d.id = 'debug-drawer'
  d.className = 'debug'
  const acts: Array<[string, () => void]> = [
    ['现金 +10万', () => { meta.cash += 100000 }],
    ['现金 −5万', () => { meta.cash -= 50000 }],
    ['人气 +1万', () => { meta.fans += 10000 }],
    ['触及宗师', () => { meta.reachedGM = true }],
    ['赛季 +10', () => { meta.seasonsPlayed += 10; meta.growth.seasons += 10 }],
    ['下季必怪物', () => { meta.debugTalent = 'monster' }],
    ['下季必木桶', () => { meta.debugTalent = 'barrel' }],
    ['加黑历史', () => { meta.dirty.boostJobs += 2; meta.dirty.cheatSeasons += 1 }],
    ['清黑历史', () => { meta.dirty = { boostJobs: 0, hires: 0, cheatSeasons: 0 } }],
    ['清弹窗记忆', () => { meta.snooze = {}; meta.seen = {} }],
    ['年龄 +3', () => { meta.age += 3 }],
    ['季内跳到末尾', () => { if (game) game.quotaLeft = Math.min(game.quotaLeft, 3) }],
    ['解锁职业模式', () => { meta.pro.unlocked = true }],
    ['职业成长 +10', () => { meta.pro.growth += 10 }],
    ['职业人气 +5万', () => { meta.pro.fame += 50000 }],
    ['职业年龄 +5', () => { if (meta.pro.active) meta.pro.age += 5 }],
    ['解除终身禁赛', () => { meta.pro.lifetimeBan = false; meta.pro.banReason = undefined }],
  ]
  d.innerHTML = `<div class="debug-title">调试</div>${acts.map((a, i) => `<button data-d="${i}">${a[0]}</button>`).join('')}`
  document.body.appendChild(d)
  d.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => {
    b.onclick = () => {
      acts[Number(b.dataset.d)][1]()
      writeMeta(meta)
      if (game) { refreshHud() } else if (!yearInProgress()) renderHome()
      toast(`调试：${acts[Number(b.dataset.d)][0]}`)
    }
  })
}

function pageTop(title: string, onBack: () => void, extra = '') {
  return {
    html: `<div class="top"><h2>${title}</h2><div class="actions">${extra}<button class="btn btn-sm" id="back">返回</button></div></div>`,
    bind: () => { $('back')!.onclick = onBack },
  }
}

function renderAchievements() {
  const rows = ACHIEVEMENTS.map((a) => {
    const got = !!meta.achievements[a.id]
    return `<div class="ach-row ${got ? 'got' : ''} ${a.honor ? 'pro' : ''}">
      <b>${got ? a.name : '· · ·'}</b>
      <span>${got || !a.honor ? a.desc : '职业模式荣誉'}</span>
    </div>`
  }).join('')
  const ends = Object.entries(meta.endings)
  const top = pageTop(`成就 <span class="num" style="font-size:0.9em">${Object.keys(meta.achievements).filter((k) => ACH_MAP[k]).length}</span><span style="color:var(--bone-faint)">/${ACHIEVEMENTS.length}</span>`, renderHome)
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <p class="tip">每 5 个成就 → 英雄池 +1 → 天赋分布上移。成就不加胜率。✦ 为职业模式荣誉。</p>
    <div class="section">${rows}</div>
    ${ends.length ? `<div class="section"><div class="label">结局收集</div><p class="tip">${ends.map(([k, n]) => `${ENDING_NAME[k] ?? k} ×${n}`).join(' · ')}</p></div>` : ''}
  </div>`
  top.bind()
}

/* ———————————— 职业模式 ———————————— */

const ENDING_NAME: Record<string, string> = {
  top500: '顶尖 500', banned: '封号', landed: '上岸', bronze: '地心探索',
  lifetime_ban: '终身禁赛', fix_ruin: '那笔钱', hell_return: '地狱归来', quit: '回家', legend: '一代传奇',
  world_champion: '世界冠军', regional_king: '赛区名将', evergreen: '常青树', bench: '板凳', journeyman: '打工人',
}
for (const m of Object.keys(MAJOR_NAME) as Array<keyof typeof MAJOR_NAME>) ENDING_NAME[`cloudmud_${m}`] = `云泥之隔 · ${MAJOR_NAME[m]}`

let proTimer: number | null = null
let proPaused = false
let proShownLog = 0
let proShownHl = 0
let proCommitted = false

function stopProTimer() {
  if (proTimer != null) { clearTimeout(proTimer); proTimer = null }
}

function formBadge(f: keyof typeof FORM_INFO) {
  const fi = FORM_INFO[f]
  return `<span class="talent-badge ${fi.cls}">${fi.name}</span>`
}

/** 本年状态档概率（职业模式的天赋面板） */
function formPanel(age: number) {
  const p = meta.pro
  const probs = formProbs(p.growth, age)
  const rows = FORM_ORDER.map((f) => {
    const fi = FORM_INFO[f]
    return `<div class="tal-row">
      <div><span class="talent-badge ${fi.cls}">${fi.name}</span><div class="tal-range">实力 ${fi.min}–${fi.max}</div></div>
      <div class="tal-bar"><i class="${fi.cls}" style="width:${clamp(probs[f] * 1.6, 1, 100)}%"></i></div>
      <span class="num">${probs[f]}%</span>
      <span class="tal-n num"></span>
    </div>`
  }).join('')
  return `<div class="section">
    <div class="row" style="border-bottom:0;padding:0 0 6px"><span class="label" style="margin:0">本年状态概率</span><span class="tip">职业成长 <b class="num">${p.growth}</b> · ${age} 岁${age >= 25 ? ' <span class="warn">年龄开始抵消</span>' : ''}</span></div>
    ${rows}
    <p class="tip" style="margin:12px 0 0">每年开局摇一档状态，决定本年个人实力；成绩 = 队伍底子 × 0.55 + 你 × 0.45。职业成长跨生涯累积，只改分布。</p>
  </div>`
}

function historyLedger(limit = 12) {
  const hist = meta.pro.history.slice().reverse().slice(0, limit)
  if (!hist.length) return '<p class="tip">还没有正赛记录。</p>'
  return `<div class="ledger">${hist.map((r) => `<div class="row">
    <span class="k">第 ${r.year} 年 S${r.stage} · ${r.team}</span>
    <span class="v">${r.place ? `地区第 <b class="num">${r.place}</b>` : r.note ?? '预选出局'}${r.intl ? ` · ${INTL_NAME[r.stage]} 第 <b class="num">${r.intl}</b>` : ''}${r.prize ? ` · <span class="num">+${fmt(r.prize)}</span>` : ''}${r.bench ? ' <span class="tip">替补</span>' : ''}</span>
  </div>`).join('')}</div>`
}

function renderPro() {
  stopTimer()
  stopProTimer()
  game = null
  const p = meta.pro
  const top = pageTop('职业模式', renderHome)
  const chk = canStartCareer(meta)
  const t = teamOf(p.teamId)
  const titles = `地区冠军 ${p.titles.regional} · 国际赛前二 ${p.titles.intl}${p.titles.world ? ` · 国际赛冠军 ${p.titles.world}` : ''}${p.titles.worldCup ? ` · 国家队 ${p.titles.worldCup}` : ''}`
  const d = meta.dirty
  const expo = exposureP(meta)
  const dirtyText = d.boostJobs + d.hires + d.cheatSeasons + p.fixes === 0
    ? '<span class="win">干净。背调翻不出东西。</span>'
    : `<span class="warn">代练单 ${d.boostJobs} · 请人 ${d.hires} 套 · 开挂 ${d.cheatSeasons} 季${p.fixes ? ` · 假赛 ${p.fixes}` : ''} → 每次背调 / 赛前审查被翻出来的概率 ${Math.round(expo * 100)}%。</span>`

  let body: string
  if (p.lifetimeBan) {
    body = `<div class="section ending-card"><h2>终身禁赛</h2><div class="tip">${p.banReason ?? ''}</div><div class="verse">本存档职业模式到此为止。天梯、黑市、成就照常。想再打职业只能删档重来（成就保留）。</div></div>`
  } else if (!chk.ok) {
    body = `<div class="section"><div class="label">未解锁</div><p class="tip" style="color:var(--bone)">${chk.why}</p><p class="tip">职业模式是单独的一条线：${PRO_START_AGE} 岁起步，一年一局，三个 Stage 逐场滚动，年末转会窗自己选队。天梯里的现金、人气、黑历史都会带过去。</p></div>${formPanel(PRO_START_AGE)}`
  } else if (!p.active) {
    body = `${p.ending ? `<div class="section ending-card"><h2>${p.ending.title}</h2><div class="tip">${p.ending.rankLabel}</div>${p.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}</div>` : ''}
      <div class="section">
        <div class="label">开始</div>
        <p class="tip" style="color:var(--bone)">${PRO_START_AGE} 岁，自由人。年初会有队来找你，签哪家你定。${p.runs ? `这是第 ${p.runs + 1} 段生涯，职业成长 ${p.growth} 会带上。` : ''}</p>
        <p class="tip" style="margin-top:6px">背调档案：${dirtyText}</p>
        <button class="btn btn-primary" id="btn-start-career" style="margin-top:12px">开始生涯 · ${PRO_START_AGE} 岁</button>
      </div>
      ${formPanel(PRO_START_AGE)}
      ${p.history.length ? `<div class="section"><div class="label">上一段生涯</div>${historyLedger(8)}</div>` : ''}`
  } else {
    body = `<div class="dossier">
        <div class="cell"><div class="label">年龄</div><div class="num">${p.age}</div><small>第 ${p.year + 1} 年</small></div>
        <div class="cell"><div class="label">队伍</div><div style="font-family:var(--display);font-size:1rem;line-height:1.5" class="career">${t ? t.name : '自由人'}</div><small>${t ? `${t.partner ? '合作战队' : '普通队'} · 底子 ${teamRating(t)}` : '年初等报价'}</small></div>
        <div class="cell"><div class="label">人气</div><div class="num">${fmt(p.fame)}</div><small>现金 ${fmt(meta.cash)}</small></div>
      </div>
      <div class="section">
        <p class="tip" style="color:var(--bone)">${titles}${p.suspended ? ` · <span class="ban">禁赛剩 ${p.suspended} 个 Stage</span>` : ''}</p>
        <p class="tip" style="margin-top:6px">背调档案：${dirtyText}</p>
        <button class="btn btn-primary" id="btn-year" style="margin-top:12px">${p.year === 0 ? '开始第 1 年 · 摇状态' : `第 ${p.year + 1} 年 · 摇状态`}</button>
      </div>
      ${formPanel(p.age)}
      <div class="section"><div class="label">履历</div>${historyLedger()}</div>`
  }

  app.innerHTML = `<div class="reveal">${top.html}${body}</div>`
  top.bind()
  $('btn-start-career')?.addEventListener('click', () => { startCareer(meta); writeMeta(meta); renderPro() })
  $('btn-year')?.addEventListener('click', () => { beginYear(meta); startProYear() })
  mountDebug()
}

function proLogs() {
  const p = meta.pro
  if (proShownLog < p.log.length) { appendTo('pro-log', p.log.slice(proShownLog)); proShownLog = p.log.length }
  if (proShownHl < p.highlights.length) { appendTo('pro-hl', p.highlights.slice(proShownHl)); proShownHl = p.highlights.length }
}

function proHud() {
  const p = meta.pro
  const set = (id: string, html: string) => { const el = $(id); if (el) el.innerHTML = html }
  const t = teamOf(p.teamId)
  set('pro-title', `${t ? t.name : '自由人'}`)
  set('pro-meta', `<span>第 <span class="num">${p.year + 1}</span> 年 · <span class="num">${p.age}</span> 岁</span><span>${p.stageAt ? `Stage <span class="num">${p.stageAt}</span> / 3` : '年初'}</span><span>${formBadge(p.form)} 实力 <span class="num">${p.skill}</span></span>`)
  set('pro-res', `<span>现金 <b class="num ${meta.cash < 0 ? 'lose' : ''}">${fmt(meta.cash)}</b></span><span>人气 <b class="num">${fmt(p.fame)}</b></span><span>冠军 <b class="num">${p.titles.regional}</b></span><span>国际赛 <b class="num">${p.titles.intl}</b></span>${p.suspended ? `<span class="ban">禁赛 ${p.suspended}</span>` : ''}`)
  const bar = $('pro-bar')
  if (bar) bar.style.width = `${(p.stageAt / 3) * 100}%`
}

function startProYear() {
  stopTimer()
  stopProTimer()
  proPaused = false
  proCommitted = false
  fastForward = false
  const p = meta.pro
  app.innerHTML = `
    <div class="top">
      <h2 id="pro-title"></h2>
      <div class="actions"><button class="btn btn-sm" id="btn-pro-pause">暂停</button></div>
    </div>
    <div class="stat" id="pro-meta"></div>
    <div class="stat" id="pro-res" style="margin-top:6px"></div>
    <div class="bar"><i id="pro-bar" style="width:0%"></i></div>
    <div class="tip" style="margin-bottom:16px">OWCS 中国赛区 · 第 ${p.year + 1} 年${meta.manual ? ' · 点赛程推进' : ''}</div>
    <div class="log-cols">
      <div class="log-col"><div class="label">赛程</div><div class="log-box" id="pro-log"></div></div>
      <div class="log-col"><div class="label">高光</div><div class="log-box" id="pro-hl"></div></div>
    </div>
    <div class="mask" id="pro-pause" hidden>
      <div class="mask-box">
        <div class="mask-title">暂停</div>
        <button class="btn btn-primary" id="btn-pro-resume">继续</button>
        <button class="btn" id="btn-pro-ff">${fastForward ? '取消快进' : '快进'}</button>
        <button class="btn btn-danger" id="btn-pro-exit">退出（这一年重打）</button>
      </div>
    </div>
    <div class="mask" id="pro-choice" hidden>
      <div class="mask-box">
        <div class="mask-title" id="pro-choice-title" style="color:var(--brass)"></div>
        <div class="mask-body" id="pro-choice-body"></div>
        <div id="pro-choice-btns"></div>
      </div>
    </div>
  `
  proShownLog = 0
  proShownHl = 0
  proLogs()
  proHud()
  $('btn-pro-pause')!.onclick = () => { proPaused = true; stopProTimer(); $('btn-pro-ff')!.textContent = fastForward ? '取消快进' : '快进'; showSheet('pro-pause') }
  $('btn-pro-resume')!.onclick = resumePro
  $('btn-pro-ff')!.onclick = () => { fastForward = !fastForward; resumePro() }
  $('btn-pro-exit')!.onclick = () => { stopProTimer(); Object.assign(meta, loadMeta()); renderPro() }
  if (meta.manual) $('pro-log')!.onclick = () => { if (!proPaused && !meta.pro.choice) tickPro() }
  else proTimer = window.setTimeout(tickPro, intervalMs() * 3)
  mountDebug()
}

function resumePro() {
  proPaused = false
  hideSheets()
  if (!meta.manual) { stopProTimer(); tickPro() }
}

function tickPro() {
  if (proPaused) return
  const r = proStep()
  proLogs()
  proHud()
  if (r === 'choice') { showProChoice(); return }
  if (r === 'done') { stopProTimer(); proTimer = window.setTimeout(renderProSettle, 1200); return }
  // 每行是一整个系列赛，比天梯一把慢 3 倍
  if (!meta.manual) proTimer = window.setTimeout(tickPro, fastForward ? intervalMs() : intervalMs() * 3)
}

function showProChoice() {
  const c = meta.pro.choice
  if (!c) { tickPro(); return }
  stopProTimer()
  $('pro-choice-title')!.textContent = c.title
  $('pro-choice-body')!.innerHTML = c.body
  $('pro-choice-btns')!.innerHTML = c.options.map((o) => `<button class="btn ${o.cls ? 'btn-' + o.cls : ''}" data-opt="${o.id}">${o.label}${o.sub ? `<span class="btn-sub">${o.sub}</span>` : ''}</button>`).join('')
  $('pro-choice-btns')!.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.opt!
      if (id === 'retire' && !confirm('退役：生涯到此为止，结算结局。确定？')) return
      if (id === 'fix_yes' && !confirm('接假赛的钱：这一步没有回头路。确定？')) return
      proChoose(meta, id)
      hideSheets()
      if (meta.manual) tickPro()
      else { stopProTimer(); tickPro() }
    }
  })
  showSheet('pro-choice')
}

function renderProSettle() {
  stopProTimer()
  fastForward = false
  const p = meta.pro
  if (!proCommitted) {
    proCommitted = true
    if (!p.ending) commitYear(meta)
    writeMeta(meta)
  }
  const yearNo = p.ending ? p.year + 1 : p.year
  const thisYear = p.history.filter((r) => r.year === yearNo)
  const newAch = p.highlights.filter((l) => l.cls === 'ach').map((l) => l.text)
  const t = teamOf(p.teamId)
  app.innerHTML = `<div class="reveal">
    <div class="sub" style="margin:0 0 6px">${p.ending ? '生涯结算' : `年终 · 第 ${yearNo} 年`}</div>
    <div class="rank-hero" style="text-align:center;font-size:2rem"><span class="career">${p.ending ? p.ending.title : (t ? t.name : '自由人')}</span></div>
    <div class="stat" style="justify-content:center;margin-top:6px">
      <span><span class="num">${p.age}</span> 岁</span>
      <span>${formBadge(p.form)}</span>
      <span>人气 <span class="num">${fmt(p.fame)}</span></span>
      <span>现金 <span class="num ${meta.cash < 0 ? 'lose' : ''}">${fmt(meta.cash)}</span></span>
    </div>
    <div class="rule-brass"></div>
    ${p.ending ? `<div class="section ending-card">
        <h2>${p.ending.title}</h2>
        <div class="tip">${p.ending.rankLabel}</div>
        ${p.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}
      </div>` : ''}
    ${thisYear.length ? `<div class="dossier">${thisYear.map((r) => `<div class="cell"><div class="label">Stage ${r.stage}</div><div class="num" style="color:var(--brass)">${r.place ? `第 ${r.place}` : '—'}</div><small>${r.intl ? `国际赛 ${r.intl} · ` : ''}${r.prize ? `+${fmt(r.prize)}` : r.note ?? '预选出局'}</small></div>`).join('')}</div>` : ''}
    ${newAch.length ? `<div class="section"><div class="label">新成就</div>${newAch.map((txt) => `<div class="ach-row got pro"><b>${txt.replace(/^成就【|】$/g, '')}</b><span>${ACH_MAP[Object.keys(ACH_MAP).find((k) => `成就【${ACH_MAP[k].name}】` === txt) ?? '']?.desc ?? ''}</span></div>`).join('')}</div>` : ''}
    <div class="section" style="padding-bottom:6px">
      ${p.ending
        ? (p.lifetimeBan ? '' : '<button class="btn btn-primary" id="pro-again">再开一段生涯</button>')
        : '<button class="btn btn-primary" id="pro-next">下一年 · 摇状态</button>'}
      <div class="grid-2">
        <button class="btn" id="pro-home">职业主页</button>
        <button class="btn" id="home">回首页</button>
      </div>
    </div>
    ${p.highlights.length ? `<div class="section"><div class="label">本年高光</div>${p.highlights.slice(0, 12).map((l) => `<div class="hl ${l.cls}">${l.text}</div>`).join('')}</div>` : ''}
    <div class="section"><div class="label">赛程</div><div class="log-box" id="pro-log" style="max-height:40vh"></div></div>
  </div>`
  appendTo('pro-log', p.log)
  $('pro-next')?.addEventListener('click', () => { beginYear(meta); startProYear() })
  $('pro-again')?.addEventListener('click', () => { startCareer(meta); writeMeta(meta); beginYear(meta); startProYear() })
  $('pro-home')!.onclick = renderPro
  $('home')!.onclick = renderHome
  mountDebug()
}


function renderAbout() {
  const top = pageTop('说明', renderHome)
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <div class="section" style="border-top:0">
      <div class="label">天赋</div>
      <p class="tip" style="color:var(--bone)">每季开局随机摇一档，决定本季隐藏真实水平（MMR）。全局成长只改摇到高档的概率，摇到什么打什么。</p>
    </div>
    <div class="section">
      <div class="label">系统控分</div>
      <p class="tip" style="color:var(--bone)">匹配系统按它对你的估计找对手。校准期它还不认识你，胜率高；识别之后归于五五开，段位靠修正词慢慢漂向真实水平——低于水平时赢多加（逆风局）输少扣（安慰奖），高于时反过来（预期 / 大逆转）。顶端底端有「压力」。这是 OW 真实的机制。</p>
    </div>
    <div class="section">
      <div class="label">黑市</div>
      <p class="tip" style="color:var(--bone)">代练替你打，胜率按代练段位与你的差算；陪玩和你一起打，同档低一点，但能 4 陪 1。都是宽组减收益、脏环境、吃举报。代练把你抬到真实水平之上，之后会被系统修正回来。</p>
    </div>
    <div class="section">
      <div class="label">职业模式</div>
      <p class="tip" style="color:var(--bone)">单独的一条线，天梯里触及宗师或打满 ${PRO_UNLOCK_SEASONS} 季解锁。${PRO_START_AGE} 岁起步，一年一局：年初摇状态档，三个 Stage 逐场滚动（预选瑞士轮 → 循环赛 → 双败季后赛 → 国际赛），年末转会窗自己选队。会发生什么、怎么收场，打了才知道。天梯里的现金、人气和黑历史会带过去。</p>
    </div>
    <div class="section">
      <div class="label">其他</div>
      <p class="tip" style="color:var(--bone)">胜场攒竞技点，${GUN_COST} 换金枪，每年一把玉枪。每 ${SOFT_RESET_EVERY} 季软重置。</p>
    </div>
  </div>`
  top.bind()
}

function settingsBody() {
  return `
    <label class="row"><span class="k">手动模式（点对局日志打一把）</span><input type="checkbox" id="set-manual" ${meta.manual ? 'checked' : ''}></label>
    <div class="row" style="border-bottom:0"><span class="k">每把间隔</span><span class="v num" id="speed-val">${meta.speed}s</span></div>
    <input type="range" id="set-speed" min="${MIN_SPEED}" max="1" step="0.01" value="${meta.speed}">
  `
}

function bindSpeed() {
  $('set-manual')!.onchange = (e) => { meta.manual = (e.target as HTMLInputElement).checked; writeMeta(meta) }
  const range = $('set-speed') as HTMLInputElement
  range.oninput = () => {
    meta.speed = Number(range.value)
    $('speed-val')!.textContent = meta.speed + 's'
    writeMeta(meta)
  }
}

function renderSettings() {
  const top = pageTop('设置', () => { writeMeta(meta); renderHome() })
  app.innerHTML = `<div class="reveal">${top.html}<div class="section" style="border-top:0">${settingsBody()}</div></div>`
  top.bind()
  bindSpeed()
}

function renderSettingsInGame() {
  const top = pageTop('设置', () => { writeMeta(meta); paused = true; renderGame() })
  app.innerHTML = `<div class="reveal">${top.html}<div class="section" style="border-top:0">${settingsBody()}</div></div>`
  top.bind()
  bindSpeed()
}

/* ———————————— 商店 ———————————— */

function renderShop() {
  const g = game
  const cash = g?.cash ?? meta.cash
  const cp = g?.compPoints ?? meta.compPoints
  const next = GEAR_LEVELS[meta.growth.gear]
  const top = pageTop('商店', () => { writeMeta(meta); backFrom === 'game' && game ? renderGame() : renderHome() })
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <div class="stat"><span>现金 <b class="num">${cash}</b></span><span>竞技点 <b class="num">${cp}</b></span><span>金枪 <b class="num">${meta.goldGuns}</b></span><span>玉枪 <b class="num">${meta.jadeGuns}</b></span></div>
    <div class="section">
      <div class="label">设备 · 每级成长 +1</div>
      <div class="menu">
        ${GEAR_LEVELS.map((l) => `<button class="menu-row" ${meta.growth.gear >= l.level || l.level !== (next?.level ?? -1) ? 'disabled' : ''} data-gear="${l.level}">
          <span class="name">${l.name}${meta.growth.gear >= l.level ? '<span class="odds">已购</span>' : ''}</span><span class="leader"></span><span class="price">${l.cost}</span>
        </button>`).join('')}
      </div>
    </div>
    <div class="section">
      <div class="label">竞技点兑换</div>
      <div class="menu">
        <button class="menu-row" id="btn-gold"><span class="name">金枪</span><span class="leader"></span><span class="price">${GUN_COST} <span class="odds">CP</span></span></button>
        <button class="menu-row" id="btn-jade" ${meta.jadeThisYear ? 'disabled' : ''}><span class="name">玉枪 · 年度限定${meta.jadeThisYear ? '<span class="odds">今年已换</span>' : ''}</span><span class="leader"></span><span class="price">${GUN_COST} <span class="odds">CP</span></span></button>
      </div>
    </div>
    <div class="msg" id="shop-msg"></div>
  </div>`
  top.bind()
  const msg = (l: LogLine) => { writeMeta(meta); renderShop(); $('shop-msg')!.textContent = l.text }
  app.querySelectorAll<HTMLButtonElement>('[data-gear]').forEach((b) => { b.onclick = () => msg(buyGear(meta, game)) })
  $('btn-gold')!.onclick = () => {
    if (game) meta.compPoints = game.compPoints
    const l = buyGoldGun(meta)
    if (game) game.compPoints = meta.compPoints
    msg(l)
  }
  $('btn-jade')!.onclick = () => {
    if (game) meta.compPoints = game.compPoints
    const l = buyJadeGun(meta)
    if (game) game.compPoints = meta.compPoints
    msg(l)
  }
}

/* ———————————— 黑市 ———————————— */

function helperOdds(kind: 'boost' | 'escort', idx: number, count: number, g: GameState | null): number {
  const my = g && g.phase !== 'placement' ? majorIndex(g.rank.major) : (meta.lastRank ? majorIndex(meta.lastRank.major) : 3)
  return oddsFn(kind, idx, count, my, g ? isLateSeason(g) : false)
}

function renderMarket() {
  const g = game
  const cash = g?.cash ?? meta.cash
  const credit = g?.credit ?? meta.credit
  const pol = g?.envPollution ?? meta.envPollution
  const cur = g && g.phase !== 'placement' ? rankInline(g.rank) : meta.lastRank ? `上季 ${rankInline(meta.lastRank)}` : '未定级'
  const pct = (p: number) => `${Math.round(p * 100)}%`
  const late = g ? isLateSeason(g) : false
  const top = pageTop('黑市', () => { backFrom === 'game' && game ? renderGame() : renderHome() })
  const preNote = !g
    ? meta.preorder
      ? `<div class="menu"><button class="menu-row" id="btn-cancel-pre"><span class="name">已预订 ${describeHelper(meta.preorder)}<span class="odds">开局即上号，定级一起打</span></span><span class="leader"></span><span class="price">取消退款</span></button></div>`
      : '<p class="tip" style="margin-top:8px">开赛前下单 = <b>预订</b>：先付钱，下赛季第一把就上号，定级赛一起打，落点更高。也可以开赛后随时进来。</p>'
    : late
      ? '<p class="tip" style="margin-top:8px;color:var(--brass)">赛季末：对手更硬，帮手胜率 −10 个点。但打完套餐正好收官，分掉不回去。</p>'
      : '<p class="tip" style="margin-top:8px">打完套餐会问你：续单、提前收官锁段位、还是自己打。分抬过真实水平之后，自己打会被系统一把把修正回去。</p>'
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <div class="stat"><span>现金 <b class="num ${cash < 0 ? 'lose' : ''}">${fmt(cash)}</b></span><span>信誉 <b class="num">${credit}</b></span><span>污染 <b class="num">${pol}</b></span><span>你 ${cur}</span></div>
    ${preNote}
    <div class="section">
      <div class="label">代练 · 替你打 ${HELPER_PACK_GAMES} 把</div>
      <div class="menu">
        ${HELPER_TIERS.filter((t) => t.boost).map((t) => `<button class="menu-row" data-boost="${t.id}">
          <span class="name">${t.name}<span class="odds">胜率 ${pct(helperOdds('boost', t.idx, 1, g))}</span></span><span class="leader"></span><span class="price">${fmt(helperCost('boost', t.id, 1))}</span>
        </button>`).join('')}
      </div>
      <p class="tip" style="margin-top:8px">账号共享有被检测风险，也进黑历史。</p>
    </div>
    <div class="section">
      <div class="row" style="border-bottom:0;padding-top:0"><span class="label" style="margin:0">陪玩 · 和你一起打 ${HELPER_PACK_GAMES} 把</span>
        <span class="seg">${[1, 2, 3, 4].map((n) => `<button class="${escortCount === n ? 'on' : ''}" data-count="${n}">${n} 陪 1</button>`).join('')}</span>
      </div>
      <div class="menu">
        ${HELPER_TIERS.map((t) => `<button class="menu-row" data-escort="${t.id}">
          <span class="name">${t.name}<span class="odds">胜率 ${pct(helperOdds('escort', t.idx, escortCount, g))}</span></span><span class="leader"></span><span class="price">${fmt(helperCost('escort', t.id, escortCount))}</span>
        </button>`).join('')}
      </div>
      <p class="tip" style="margin-top:8px">同档比代练低 8 个点，人多叠加；4 陪 1 就是 5 排，基本躺赢。宽组减收益。</p>
    </div>
    <div class="section">
      <div class="label">接单 · 自己去做代练</div>
      <div class="menu">
        ${BOOST_JOBS.map((j) => `<button class="menu-row" data-job="${j.id}">
          <span class="name">${j.name}<span class="odds">污染 +${j.pollution}</span></span><span class="leader"></span><span class="price">+${fmt(j.payout)}</span>
        </button>`).join('')}
      </div>
      <p class="tip" style="margin-top:8px">来钱快，之后整季按把结算。每一单都进黑历史。</p>
    </div>
    <div class="section">
      <div class="menu">
        <button class="menu-row danger" id="btn-cheat"><span class="name">开挂</span><span class="leader"></span><span class="price">免费</span></button>
        <button class="menu-row" id="btn-pure"><span class="name">净修环境<span class="odds">污染 −18 · 解除红框</span></span><span class="leader"></span><span class="price">25 <span class="odds">信誉</span></span></button>
      </div>
    </div>
    <div class="msg" id="market-msg"></div>
  </div>`
  top.bind()
  // 赛季中买成功 → 直接回天梯继续打，不用再点返回
  const done = (l: LogLine) => {
    if (game) {
      game.events.push(l)
      if (l.text.startsWith('【')) { renderGame(); resumeGame(); toast(l.text); return }
      refreshHud()
      flushLogs()
    }
    renderMarket()
    $('market-msg')!.textContent = l.text
  }
  const pre = (l: LogLine) => { writeMeta(meta); renderMarket(); $('market-msg')!.textContent = l.text }
  const need = () => { $('market-msg')!.textContent = '接单 / 开挂 / 净修要在赛季里操作；开赛前只能预订代练陪玩。' }
  app.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) => { b.onclick = () => { escortCount = Number(b.dataset.count); renderMarket() } })
  app.querySelectorAll<HTMLButtonElement>('[data-boost]').forEach((b) => { b.onclick = () => game ? done(hireBooster(game, b.dataset.boost!)) : pre(preorderHelper(meta, 'boost', b.dataset.boost!, 1)) })
  app.querySelectorAll<HTMLButtonElement>('[data-escort]').forEach((b) => { b.onclick = () => game ? done(hireEscort(game, b.dataset.escort!, escortCount)) : pre(preorderHelper(meta, 'escort', b.dataset.escort!, escortCount)) })
  $('btn-cancel-pre')?.addEventListener('click', () => pre(cancelPreorder(meta)))
  app.querySelectorAll<HTMLButtonElement>('[data-job]').forEach((b) => {
    b.onclick = () => {
      if (!game) return need()
      if (!confirm('接代练单：会留在账号记录里，进黑历史。确定？')) return
      done(takeBoostJob(game, b.dataset.job!))
    }
  })
  $('btn-cheat')!.onclick = () => game ? done(enableCheat(game)) : need()
  $('btn-pure')!.onclick = () => game ? done(purifyEnv(game)) : need()
}

/* ———————————— 对局 ———————————— */

function renderGame() {
  if (!game) return
  app.innerHTML = `
    <div class="top">
      <h2>天梯</h2>
      <div class="actions">
        <button class="btn btn-sm btn-warn" id="btn-market">黑市</button>
        <button class="btn btn-sm" id="btn-pause">暂停</button>
      </div>
    </div>
    <div class="mute-line" id="mute-line">
      <span id="mute-title">禁言中 · ID 已被红框</span>
      <small>你骂了疑似挂 / 代，对方未必封，你先不能说话。到期自动解除，或在黑市用信誉净修。</small>
    </div>
    <div class="stat" id="hud-meta"></div>
    <div class="rank-hero" id="hud-rank"></div>
    <div id="hud-persona" style="margin:4px 0 10px"></div>
    <div class="stat" id="hud-res"></div>
    <div class="bar"><i id="hud-bar" style="width:0%"></i></div>
    <div class="tip" id="hud-quota" style="margin-bottom:16px"></div>
    ${meta.manual ? '<div class="manual-tip">点对局日志 · 打一把</div>' : ''}
    <div class="log-cols">
      <div class="log-col"><div class="label">对局</div><div class="log-box" id="log-box"></div></div>
      <div class="log-col"><div class="label">事件</div><div class="log-box" id="event-box"></div></div>
    </div>
    <div class="mask" id="pause-mask" hidden>
      <div class="mask-box">
        <div class="mask-title">暂停</div>
        <button class="btn btn-primary" id="btn-resume">继续</button>
        <button class="btn" id="btn-ff">${fastForward ? '取消快进' : '快进'}</button>
        <div class="grid-2">
          <button class="btn" id="btn-settings-ingame">设置</button>
          <button class="btn" id="btn-shop2">商店</button>
        </div>
        <button class="btn btn-warn" id="btn-market2">黑市</button>
        <button class="btn" id="btn-end-early">提前收官 · 锁定段位</button>
        <button class="btn btn-danger" id="btn-exit">退出赛季</button>
      </div>
    </div>
    <div class="mask" id="helper-mask" hidden>
      <div class="mask-box">
        <div class="mask-title" style="color:var(--brass)">套餐打完了</div>
        <div class="mask-body" id="helper-hint"></div>
        <button class="btn btn-primary" id="btn-helper-again" hidden></button>
        <button class="btn btn-warn" id="btn-helper-more">换一档 · 去黑市</button>
        <button class="btn" id="btn-helper-end">提前收官 · 锁定现在的段位</button>
        <button class="btn" id="btn-helper-self">自己打</button>
      </div>
    </div>
    <div class="mask" id="market-mask" hidden>
      <div class="mask-box">
        <div class="mask-title" style="color:var(--brass)">有人私信你</div>
        <div class="mask-body" id="market-hint"></div>
        <button class="btn btn-warn" id="btn-market-go">去黑市看看</button>
        <button class="btn" id="btn-market-no">不理，继续打</button>
      </div>
    </div>
  `
  shownLog = 0
  shownEv = 0
  flushLogs()
  refreshHud()

  const resume = resumeGame
  $('btn-pause')!.onclick = () => { paused = true; stopTimer(); showSheet('pause-mask') }
  $('btn-helper-again')!.onclick = () => {
    if (!game) return
    const l = rehire(game)
    game.events.push(l)
    if (l.text.startsWith('【')) { toast(l.text); resume() } else { flushLogs(); refreshHud(); toast(l.text) }
  }
  $('btn-resume')!.onclick = resume
  $('btn-market-no')!.onclick = resume
  $('btn-ff')!.onclick = () => { fastForward = !fastForward; resume() }
  $('btn-settings-ingame')!.onclick = () => { hideSheets(); renderSettingsInGame() }
  const openMarket = () => { paused = true; stopTimer(); backFrom = 'game'; renderMarket() }
  $('btn-market')!.onclick = openMarket
  $('btn-market2')!.onclick = openMarket
  $('btn-market-go')!.onclick = openMarket
  $('btn-shop2')!.onclick = () => { paused = true; stopTimer(); backFrom = 'game'; renderShop() }
  const endEarly = () => {
    if (!game) return
    if (game.phase === 'placement') { alert('定级赛还没打完，不能收官。'); return }
    if (!confirm(`提前收官：锁定 ${MAJOR_NAME[game.rank.major]}${game.rank.major === 'top' ? '' : game.rank.div}，剩余 ${game.quotaLeft} 把作废（少了事件、竞技点和云泥机会）。确定？`)) return
    hideSheets()
    endSeasonEarly(game)
    flushLogs()
    renderSettle()
  }
  $('btn-end-early')!.onclick = endEarly
  $('btn-helper-more')!.onclick = openMarket
  $('btn-helper-end')!.onclick = endEarly
  $('btn-helper-self')!.onclick = resume
  $('btn-exit')!.onclick = () => { game = null; renderHome() }
  if (meta.manual) {
    $('log-box')!.onclick = () => { if (game && !paused && !seasonOver(game)) tickMatch() }
  }
  if (paused) showSheet('pause-mask')
  mountDebug()
}

function resumeGame() {
  paused = false
  hideSheets()
  if (game && seasonOver(game)) { renderSettle(); return }
  if (!meta.manual && game) { stopTimer(); tickMatch() }
}

/* ———————————— 结算 ———————————— */

function renderSettle() {
  if (!game) return
  const g = game
  if (!settledOnce) {
    settledOnce = true
    commitSeason(g, meta)
    writeMeta(meta)
  }
  stopTimer()
  fastForward = false

  const peak = scoreToRank(g.peakScore)
  const real = scoreToRank(g.mmr)
  const gap = rankScore(g.rank) - g.mmr
  const newAch = g.newAchievements.map((id) => ACH_MAP[id]).filter(Boolean)
  // 结局类高光排前面，段位升降排后面
  const big = (l: LogLine) => l.cls === 'ending' || l.cls === 'ban'
  const hl = [...g.highlights.filter(big), ...g.highlights.filter((l) => !big(l))].slice(0, 10)
  const nextTip = g.banned
    ? `账号 #${meta.accountNo - 1} 已封。下赛季换新号 #${meta.accountNo}，段位归零。`
    : isSoftResetSeason(meta)
      ? `下赛季软重置（每 ${SOFT_RESET_EVERY} 赛季一次）：定级向黄金 / 白金回拉。`
      : `下赛季以 ${MAJOR_NAME[g.rank.major]}${g.rank.major === 'top' ? '' : g.rank.div} 为定级锚点${meta.seasonInYear === 1 ? `。新的一年，${meta.age} 岁` : ''}。`

  app.innerHTML = `<div class="reveal">
    <div class="sub" style="margin:0 0 6px">赛季结算 · S${g.season}</div>
    <div class="rank-hero" style="text-align:center;font-size:2.8rem">${g.phase === 'placement' ? '<span class="sys">未定级</span>' : rankHtml(g.rank)}</div>
    <div class="stat" style="justify-content:center;margin-top:6px">
      <span>最高 ${rankInline(peak)}</span>
      <span>${talentBadge(g.talent)}</span>
      <span>真实水平 ${rankInline(real)}</span>
    </div>
    <div class="tip" style="text-align:center;margin-top:6px">${gap < -300 ? '系统欠你分' : gap > 300 ? '段位虚高，下季会被修正' : '段位与水平基本一致'}${g.banned ? ' · <span class="ban">已封号</span>' : ''}</div>
    <div class="rule-brass"></div>
    <div class="dossier">
      <div class="cell"><div class="label">对局</div><div class="num">${g.matchesThisSeason}</div><small>胜 ${g.wins}</small></div>
      <div class="cell"><div class="label">现金</div><div class="num ${g.cash < 0 ? 'lose' : ''}">${fmt(g.cash)}</div><small>人气 ${fmt(g.fans)} · 竞技点 ${g.compPoints}</small></div>
      <div class="cell"><div class="label">连胜 / 连败</div><div class="num">${g.bestStreak}<span style="color:var(--bone-faint)"> / </span>${g.worstStreak}</div><small>污染 ${g.envPollution}</small></div>
    </div>
    <p class="tip" style="margin-top:14px">${nextTip}</p>
    ${g.banned ? `<div class="mute-line on" style="margin-top:12px"><span>封号的代价</span><small>新号从零打。黑历史已更新（开挂 ${meta.dirty.cheatSeasons} 季、代练单 ${meta.dirty.boostJobs}、请人 ${meta.dirty.hires}）→ 职业模式里每次背调 / 赛前审查被翻出来的概率 ${Math.round(exposureP(meta) * 100)}%。</small></div>` : ''}
    ${g.ending ? `<div class="section ending-card">
        <h2>${g.ending.title}</h2>
        <div class="tip">${g.ending.rankLabel}</div>
        ${g.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}
      </div>` : ''}
    ${newAch.length ? `<div class="section"><div class="label">新成就</div>${newAch.map((a) => `<div class="ach-row got ${a.honor ? 'pro' : ''}"><b>${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>` : ''}
    <div class="section" style="padding-bottom:6px">
      <button class="btn btn-primary" id="again">再来一赛季 · 摇天赋</button>
      <div class="grid-2">
        <button class="btn" id="career" ${proUnlocked(meta) && !meta.pro.lifetimeBan ? '' : 'disabled'}>职业模式</button>
        <button class="btn" id="home">回首页</button>
      </div>
    </div>
    ${hl.length ? `<div class="section"><div class="label">赛季高光</div>${hl.map((l) => `<div class="hl ${l.cls}">${l.text}</div>`).join('')}</div>` : ''}
    <div class="section">
      <div class="log-cols">
        <div class="log-col"><div class="label">对局</div><div class="log-box" id="log-box"></div></div>
        <div class="log-col"><div class="label">事件</div><div class="log-box" id="event-box"></div></div>
      </div>
    </div>
  </div>`
  shownLog = 0
  shownEv = 0
  flushLogs()
  $('again')!.onclick = () => start(g.identity === 'boost' && !g.banned ? 'boost' : 'casual')
  $('career')!.onclick = () => { game = null; renderPro() }
  $('home')!.onclick = () => { game = null; renderHome() }
  mountDebug()
  // 结算后主动弹邀约：职业模式解锁 / 负债三条路；处理完回首页看新状态
  showOffers(() => { game = null; renderHome() })
}

renderHome()

// 直达入口（分享链接 / 调试）：?go=play|market|shop|ach|about
{
  const go = new URLSearchParams(location.search).get('go')
  if (go === 'play') start('casual')
  else if (go === 'market') renderMarket()
  else if (go === 'shop') renderShop()
  else if (go === 'ach') renderAchievements()
  else if (go === 'pro' || go === 'career') renderPro()
  else if (go === 'about') renderAbout()
}
