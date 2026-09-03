import './style.css'
import type { GameState, Identity, LogLine, RankState } from './types'
import {
  BOOST_JOBS, DEFAULT_SPEED, GEAR_LEVELS, GUN_COST, HELPER_PACK_GAMES, HELPER_TIERS, MAJOR_NAME, MIN_SPEED,
  RANK_COLOR_CLASS, SOFT_RESET_EVERY, STAGE_INFO, TALENT_INFO, TALENT_ORDER, majorIndex,
} from './data/constants'
import { ACHIEVEMENTS, ACH_MAP } from './data/achievements'
import { growthPoints, talentProbs } from './data/talent'
import {
  buyGoldGun, buyJadeGun, commitSeason, createSeason, freshMeta, isSoftResetSeason, labelIdentity, loadMeta,
  playMatch, stageOfSeason, writeMeta,
} from './sim/engine'
import { clamp, helperOdds as oddsFn, rankScore, scoreToRank } from './sim/rank'
import { buyGear, enableCheat, helperCost, hireBooster, hireEscort, purifyEnv, takeBoostJob } from './sim/shop'
import { careerLabel } from './sim/career'

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
  const career = g.career.phase !== 'none' ? ` · <span class="career">${careerLabel(g.career)}</span>` : ''
  set('hud-persona', `${talentBadge(g.talent)}&nbsp;&nbsp;<span class="tip">【${g.persona.name}】${g.persona.tagline} · ${labelIdentity(g.identity)}${career}</span>`)
  const helper = g.helper && g.helper.left > 0
    ? `<span>${g.helper.kind === 'boost' ? '代练' : `${g.helper.count} 陪 1`} 剩 <b class="num">${g.helper.left}</b></span>`
    : ''
  const rep = g.reportStacks > 0 ? `<span>举报 <b class="num">${g.reportStacks}</b></span>` : ''
  set('hud-res', `<span>现金 <b class="num">${g.cash}</b></span><span>信誉 <b class="num">${g.credit}</b></span><span>竞技点 <b class="num">${g.compPoints}</b></span><span>污染 <b class="num">${g.envPollution}</b></span>${rep}${helper}`)
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
  for (const id of ['pause-mask', 'market-mask']) { const m = $(id); if (m) m.hidden = true }
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
    <p class="tip" style="margin:12px 0 0">成长 = 赛季经验 ${Math.min(15, Math.floor(gr.seasons / 2))} · 英雄池 ${gr.heroPool} · 设备 ${gr.gear} · 战队训练 ${Math.min(6, gr.training)}${agePen ? ` · <span class="warn">年龄 −${agePen}</span>` : ''}<br>天赋只决定本季的隐藏真实水平；段位靠系统慢慢识别。</p>
  </div>`
}

function renderHome() {
  stopTimer()
  fastForward = false
  game = null
  const achCount = Object.keys(meta.achievements).filter((k) => ACH_MAP[k]).length
  const last = meta.lastRank
  const lastHtml = last ? rankInline(last) : `<span class="sys">${meta.seasonsPlayed ? '新号' : '未定级'}</span>`
  const st = stageOfSeason(meta.seasonInYear)
  const c = meta.career
  const notes: string[] = []
  if (c.phase !== 'none') notes.push(`<span class="career">${careerLabel(c)}</span>${c.history.length ? ` · ${c.history.length} 个 Stage` : ''}${c.worldCup ? ` · 国家队 ×${c.worldCup}` : ''}`)
  notes.push(st ? `本季末 OWCS Stage ${st}` : '本季无正赛')
  if (isSoftResetSeason(meta)) notes.push('<span class="temper">本季软重置</span>')
  if (meta.careerBanned) notes.push('<span class="warn">本存档接过代练，战队不会再找你</span>')
  if (meta.bansTotal) notes.push(`封号 ${meta.bansTotal} 次`)
  if (meta.envPollution) notes.push(`污染 ${meta.envPollution}`)

  app.innerHTML = `<div class="reveal">
    <h1>守望天梯人生</h1>
    <div class="sub">天赋随机 · 系统控分 · 云泥之隔</div>
    <div class="dossier">
      <div class="cell"><div class="label">年份</div><div class="num">${meta.year}<span style="font-size:0.5em;color:var(--bone-dim)"> / ${meta.seasonInYear}</span></div><small>第 ${meta.seasonInYear} 季</small></div>
      <div class="cell"><div class="label">年龄</div><div class="num">${meta.age}</div><small>${STAGE_INFO[meta.stage].name}</small></div>
      <div class="cell"><div class="label">上赛季</div><div style="font-family:var(--display);font-size:1.05rem;line-height:1.6">${lastHtml}</div><small>账号 #${meta.accountNo}</small></div>
    </div>
    <div class="section">
      <div class="stat">
        <span>现金 <b class="num">${meta.cash}</b></span>
        <span>信誉 <b class="num">${meta.credit}</b></span>
        <span>竞技点 <b class="num">${meta.compPoints}</b></span>
        <span>金枪 <b class="num">${meta.goldGuns}</b></span>
        <span>玉枪 <b class="num">${meta.jadeGuns}</b></span>
        <span>成就 <b class="num">${achCount}</b><span style="color:var(--bone-faint)"> / ${ACHIEVEMENTS.length}</span></span>
      </div>
      <p class="tip" style="margin:10px 0 0">${notes.join(' · ')}</p>
    </div>
    ${talentPanel()}
    <div class="section" style="border-top:0;padding-top:6px">
      <button class="btn btn-primary" id="btn-casual">开局 · 摇天赋</button>
      ${meta.careerBanned ? '<button class="btn btn-warn" id="btn-boost">开局 · 代练号</button>' : ''}
      <div class="grid-2">
        <button class="btn" id="btn-shop">商店</button>
        <button class="btn btn-warn" id="btn-market">黑市</button>
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
  $('btn-shop')!.onclick = () => { backFrom = 'home'; renderShop() }
  $('btn-market')!.onclick = () => { backFrom = 'home'; renderMarket() }
  $('btn-ach')!.onclick = renderAchievements
  $('btn-about')!.onclick = renderAbout
  $('btn-settings')!.onclick = renderSettings
  $('btn-wipe')!.onclick = () => {
    if (!confirm('删除全部档案（年龄、成就、现金、段位、生涯）？')) return
    Object.assign(meta, freshMeta(), { speed: meta.speed, manual: meta.manual })
    writeMeta(meta)
    renderHome()
  }
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
      <span>${got || !a.honor ? a.desc : '职业线荣誉'}</span>
    </div>`
  }).join('')
  const ends = Object.entries(meta.endings)
  const top = pageTop(`成就 <span class="num" style="font-size:0.9em">${Object.keys(meta.achievements).filter((k) => ACH_MAP[k]).length}</span><span style="color:var(--bone-faint)">/${ACHIEVEMENTS.length}</span>`, renderHome)
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <p class="tip">每 5 个成就 → 英雄池 +1 → 天赋分布上移。成就不加胜率。✦ 为职业线荣誉。</p>
    <div class="section">${rows}</div>
    ${ends.length ? `<div class="section"><div class="label">结局收集</div><p class="tip">${ends.map(([k, n]) => `${k} ×${n}`).join(' · ')}</p></div>` : ''}
  </div>`
  top.bind()
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
      <div class="label">职业线</div>
      <p class="tip" style="color:var(--bone)">打到宗师 1 以上会有战队私信 → 试训 → 签约。6 个赛季 = 1 年，年内第 2 / 4 / 6 季末打 OWCS 中国赛区 Stage：预选瑞士轮 → 循环赛 → 双败季后赛 → 国际赛。年末转会窗。25 岁后可能退役。</p>
    </div>
    <div class="section">
      <div class="label">其他</div>
      <p class="tip" style="color:var(--bone)">胜场攒竞技点，${GUN_COST} 换金枪，每年一把玉枪。每 ${SOFT_RESET_EVERY} 季软重置。赛季末可能被控温卡在大段 1·99——云泥之隔。</p>
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
  return oddsFn(kind, idx, count, my)
}

function renderMarket() {
  const g = game
  const cash = g?.cash ?? meta.cash
  const credit = g?.credit ?? meta.credit
  const pol = g?.envPollution ?? meta.envPollution
  const cur = g && g.phase !== 'placement' ? rankInline(g.rank) : meta.lastRank ? `上季 ${rankInline(meta.lastRank)}` : '未定级'
  const pct = (p: number) => `${Math.round(p * 100)}%`
  const top = pageTop('黑市', () => { backFrom === 'game' && game ? renderGame() : renderHome() })
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <div class="stat"><span>现金 <b class="num">${cash}</b></span><span>信誉 <b class="num">${credit}</b></span><span>污染 <b class="num">${pol}</b></span><span>你 ${cur}</span></div>
    ${g ? '' : '<p class="tip" style="margin-top:8px">开赛后才能下单。</p>'}
    <div class="section">
      <div class="label">代练 · 替你打 ${HELPER_PACK_GAMES} 把</div>
      <div class="menu">
        ${HELPER_TIERS.filter((t) => t.boost).map((t) => `<button class="menu-row" data-boost="${t.id}">
          <span class="name">${t.name}<span class="odds">胜率 ${pct(helperOdds('boost', t.idx, 1, g))}</span></span><span class="leader"></span><span class="price">${helperCost('boost', t.id, 1)}</span>
        </button>`).join('')}
      </div>
      <p class="tip" style="margin-top:8px">账号共享有被检测风险。抬过真实水平之后，系统会慢慢把分修正回来。</p>
    </div>
    <div class="section">
      <div class="row" style="border-bottom:0;padding-top:0"><span class="label" style="margin:0">陪玩 · 和你一起打 ${HELPER_PACK_GAMES} 把</span>
        <span class="seg">${[1, 2, 3, 4].map((n) => `<button class="${escortCount === n ? 'on' : ''}" data-count="${n}">${n} 陪 1</button>`).join('')}</span>
      </div>
      <div class="menu">
        ${HELPER_TIERS.map((t) => `<button class="menu-row" data-escort="${t.id}">
          <span class="name">${t.name}<span class="odds">胜率 ${pct(helperOdds('escort', t.idx, escortCount, g))}</span></span><span class="leader"></span><span class="price">${helperCost('escort', t.id, escortCount)}</span>
        </button>`).join('')}
      </div>
      <p class="tip" style="margin-top:8px">同档比代练低 8 个点，人多叠加；4 陪 1 就是 5 排，基本躺赢。宽组减收益。</p>
    </div>
    <div class="section">
      <div class="label">接单 · 自己去做代练</div>
      <div class="menu">
        ${BOOST_JOBS.map((j) => `<button class="menu-row" data-job="${j.id}">
          <span class="name">${j.name}<span class="odds">污染 +${j.pollution}</span></span><span class="leader"></span><span class="price">+${j.payout}</span>
        </button>`).join('')}
      </div>
      <p class="tip" style="margin-top:8px">来钱快。这个存档以后不会再有战队找你。</p>
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
  const done = (l: LogLine) => {
    if (game) { game.events.push(l); refreshHud(); flushLogs() }
    renderMarket()
    $('market-msg')!.textContent = l.text
  }
  const need = () => { $('market-msg')!.textContent = '先开一局赛季，再来黑市下单。' }
  app.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) => { b.onclick = () => { escortCount = Number(b.dataset.count); renderMarket() } })
  app.querySelectorAll<HTMLButtonElement>('[data-boost]').forEach((b) => { b.onclick = () => game ? done(hireBooster(game, b.dataset.boost!)) : need() })
  app.querySelectorAll<HTMLButtonElement>('[data-escort]').forEach((b) => { b.onclick = () => game ? done(hireEscort(game, b.dataset.escort!, escortCount)) : need() })
  app.querySelectorAll<HTMLButtonElement>('[data-job]').forEach((b) => {
    b.onclick = () => {
      if (!game) return need()
      if (!confirm('接代练单：这个存档以后不会再有战队找你。确定？')) return
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
        <button class="btn btn-danger" id="btn-exit">退出赛季</button>
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

  const resume = () => {
    paused = false
    hideSheets()
    if (game && seasonOver(game)) { renderSettle(); return }
    if (!meta.manual && game) { stopTimer(); tickMatch() }
  }
  $('btn-pause')!.onclick = () => { paused = true; stopTimer(); showSheet('pause-mask') }
  $('btn-resume')!.onclick = resume
  $('btn-market-no')!.onclick = resume
  $('btn-ff')!.onclick = () => { fastForward = !fastForward; resume() }
  $('btn-settings-ingame')!.onclick = () => { hideSheets(); renderSettingsInGame() }
  const openMarket = () => { paused = true; stopTimer(); backFrom = 'game'; renderMarket() }
  $('btn-market')!.onclick = openMarket
  $('btn-market2')!.onclick = openMarket
  $('btn-market-go')!.onclick = openMarket
  $('btn-shop2')!.onclick = () => { paused = true; stopTimer(); backFrom = 'game'; renderShop() }
  $('btn-exit')!.onclick = () => { game = null; renderHome() }
  if (meta.manual) {
    $('log-box')!.onclick = () => { if (game && !paused && !seasonOver(game)) tickMatch() }
  }
  if (paused) showSheet('pause-mask')
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
  const hl = g.highlights.slice(0, 8)
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
      <div class="cell"><div class="label">现金</div><div class="num">${g.cash}</div><small>竞技点 ${g.compPoints}</small></div>
      <div class="cell"><div class="label">连胜 / 连败</div><div class="num">${g.bestStreak}<span style="color:var(--bone-faint)"> / </span>${g.worstStreak}</div><small>污染 ${g.envPollution}</small></div>
    </div>
    <p class="tip" style="margin-top:14px">${nextTip}</p>
    ${g.ending ? `<div class="section ending-card">
        <h2>${g.ending.title}</h2>
        <div class="tip">${g.ending.rankLabel}</div>
        ${g.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}
      </div>` : ''}
    ${hl.length ? `<div class="section"><div class="label">赛季高光</div>${hl.map((l) => `<div class="hl ${l.cls}">${l.text}</div>`).join('')}</div>` : ''}
    ${newAch.length ? `<div class="section"><div class="label">新成就</div>${newAch.map((a) => `<div class="ach-row got ${a.honor ? 'pro' : ''}"><b>${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>` : ''}
    <div class="section">
      <div class="log-cols">
        <div class="log-col"><div class="label">对局</div><div class="log-box" id="log-box"></div></div>
        <div class="log-col"><div class="label">事件</div><div class="log-box" id="event-box"></div></div>
      </div>
    </div>
    <button class="btn btn-primary" id="again">再来一赛季 · 摇天赋</button>
    <button class="btn" id="home">回首页</button>
  </div>`
  shownLog = 0
  shownEv = 0
  flushLogs()
  $('again')!.onclick = () => start(g.identity === 'boost' && !g.banned ? 'boost' : 'casual')
  $('home')!.onclick = () => { game = null; renderHome() }
}

renderHome()

// 直达入口（分享链接 / 调试）：?go=play|market|shop|ach|about
{
  const go = new URLSearchParams(location.search).get('go')
  if (go === 'play') start('casual')
  else if (go === 'market') renderMarket()
  else if (go === 'shop') renderShop()
  else if (go === 'ach') renderAchievements()
  else if (go === 'about') renderAbout()
}
