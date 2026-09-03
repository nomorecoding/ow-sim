import './style.css'
import type { LifeState, LogLine, RankState, TalentTier } from './types'
import {
  ACH_PERKS, DEFAULT_SPEED, FORM_INFO, INTL_NAME, MAJOR_NAME, MIN_SPEED, QUIT_AGE, RANK_COLOR_CLASS, SCOUT_MAX_AGE,
  STAGE_INFO, START_AGE, TALENT_INFO, TALENT_ORDER,
} from './data/constants'
import { ACHIEVEMENTS, ACH_MAP } from './data/achievements'
import { growthPoints, talentProbs } from './data/talent'
import { achCount, beginLife, commitLife, createLife, freshMeta, lifeChoose, lifeStep, loadMeta, recountHeroPool, writeMeta } from './sim/life'
import { clamp, scoreToRank } from './sim/rank'
import { teamOf } from './sim/pro'

const fmt = (n: number) => n.toLocaleString()
const DEBUG = new URLSearchParams(location.search).has('debug')

const meta = loadMeta()
if (typeof meta.speed !== 'number') meta.speed = DEFAULT_SPEED
if (typeof meta.manual !== 'boolean') meta.manual = false

let life: LifeState | null = null
let timer: number | null = null
let paused = false
let fastForward = false
let committed = false
let shownLog = 0
let shownHl = 0

const app = document.querySelector<HTMLDivElement>('#app')!
const $ = (id: string) => document.getElementById(id)

/* ———————————— 小工具 ———————————— */

function intervalMs() {
  if (fastForward) return 40
  return Math.max(MIN_SPEED * 1000, (meta.speed || DEFAULT_SPEED) * 1000)
}

function stopTimer() {
  if (timer != null) { clearTimeout(timer); timer = null }
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
  if (!life) return
  if (shownLog < life.logs.length) { appendTo('log-box', life.logs.slice(shownLog)); shownLog = life.logs.length }
  if (shownHl < life.highlights.length) { appendTo('hl-box', life.highlights.slice(shownHl)); shownHl = life.highlights.length }
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

function talentBadge(t: TalentTier) {
  const ti = TALENT_INFO[t]
  return `<span class="talent-badge ${ti.cls}">${ti.name}</span>`
}

function showSheet(id: string) { const m = $(id); if (m) m.hidden = false }
function hideSheets() {
  for (const id of ['pause-mask', 'choice-mask']) { const m = $(id); if (m) m.hidden = true }
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

const ENDING_NAME: Record<string, string> = {
  banned: '永封', landed: '上岸',
  lifetime_ban: '终身禁赛', fix_ruin: '那笔钱', hell_return: '地狱归来', quit: '回家', legend: '一代传奇',
  world_champion: '世界冠军', regional_king: '赛区名将', evergreen: '常青树', bench: '板凳', journeyman: '打工人',
}
for (const m of Object.keys(MAJOR_NAME) as Array<keyof typeof MAJOR_NAME>) {
  ENDING_NAME[`cloudmud_${m}`] = `云泥之隔 · ${MAJOR_NAME[m]}`
  ENDING_NAME[`quit_${m}`] = `退坑 · ${MAJOR_NAME[m]}`
}

const dirtyN = (g: LifeState) => g.dirty.boostJobs + g.dirty.hires + g.dirty.cheatSeasons

/* ———————————— 首页 ———————————— */

/** 下辈子天赋概率：一行 */
function talentLine() {
  const pts = growthPoints(meta.growth)
  const probs = talentProbs(pts)
  const items = TALENT_ORDER.map((t) => `<span class="talent-badge ${TALENT_INFO[t].cls}" title="${TALENT_INFO[t].range}">${TALENT_INFO[t].name} <span class="num">${probs[t]}%</span></span>`).join('<span class="sep">·</span>')
  const gr = meta.growth
  return `<div class="section" style="padding-bottom:10px">
    <div class="row" style="border-bottom:0;padding:0 0 6px"><span class="label" style="margin:0">下辈子投胎</span><span class="tip">成长 <b class="num">${pts}</b> = 人生 ${Math.min(12, gr.runs)} + 英雄池 ${gr.heroPool} + 里程碑 ${gr.milestones}</span></div>
    <div class="tal-line">${items}</div>
  </div>`
}

/** 成就传承：已解锁 / 下一档 */
function perkLine() {
  const n = achCount(meta)
  const got = ACH_PERKS.filter((p) => n >= p.n)
  const next = ACH_PERKS.find((p) => n < p.n)
  if (!got.length && !next) return ''
  return `<div class="section" style="padding-top:8px">
    <div class="row" style="border-bottom:0;padding:0 0 6px"><span class="label" style="margin:0">传承</span><span class="tip">${next ? `下一档 ${next.n} 成就：${next.name}` : '全部解锁'}</span></div>
    <div class="tal-line">${got.length ? got.map((p) => `<span class="perk on" title="${p.desc}">${p.name}</span>`).join('') : '<span class="tip">还没有。成就攒到 10 个解锁第一档。</span>'}</div>
  </div>`
}

function renderHome() {
  stopTimer()
  fastForward = false
  life = null
  const achN = achCount(meta)
  const best = meta.bestPeakScore ? rankInline(scoreToRank(meta.bestPeakScore)) : '<span class="sys">—</span>'
  const blockBanner = meta.proBlockLives > 0
    ? `<div class="mute-line on" style="margin-bottom:14px"><span>职业圈拉黑 · 还剩 ${meta.proBlockLives} 辈子</span><small>上次打职业时代练史被翻出来了。这几辈子不会再有教练私信你。</small></div>`
    : ''
  const lastEnd = meta.lastEndingId ? ENDING_NAME[meta.lastEndingId] ?? meta.lastEndingId : ''
  app.innerHTML = `<div class="reveal">
    <h1>守望天梯人生</h1>
    <div class="sub">一局一辈子 · 天赋随机 · 段位有墙</div>
    ${blockBanner}
    <div class="dossier">
      <div class="cell"><div class="label">人生</div><div class="num">${meta.runs}</div><small>${lastEnd ? `上一世：${lastEnd}` : '还没开始'}</small></div>
      <div class="cell"><div class="label">历史最高</div><div style="font-family:var(--display);font-size:1.05rem;line-height:1.6">${best}</div><small>进过职业 ${meta.scoutedTimes} 次</small></div>
      <div class="cell"><div class="label">成就</div><div class="num">${achN}<span style="font-size:0.5em;color:var(--bone-dim)"> / ${ACHIEVEMENTS.length}</span></div><small>${meta.bestTalent ? `最好天赋 ${TALENT_INFO[meta.bestTalent].name}` : ''}</small></div>
    </div>
    ${talentLine()}
    ${perkLine()}
    <div class="section" style="border-top:0;padding-top:6px">
      <button class="btn btn-primary" id="btn-start">开始一段人生 · 摇天赋</button>
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
  $('btn-start')!.onclick = startLife
  $('btn-ach')!.onclick = renderAchievements
  $('btn-about')!.onclick = renderAbout
  $('btn-settings')!.onclick = renderSettings
  $('btn-wipe')!.onclick = () => {
    if (!confirm('删档重来：成长、里程碑、职业拉黑全部清零，成就与结局收集保留。确定？')) return
    Object.assign(meta, freshMeta(), { speed: meta.speed, manual: meta.manual, achievements: meta.achievements, endings: meta.endings })
    recountHeroPool(meta)
    writeMeta(meta)
    renderHome()
  }
  mountDebug()
}

/* ———————————— 调试抽屉（?debug=1） ———————————— */

function mountDebug() {
  document.getElementById('debug-drawer')?.remove()
  if (!DEBUG) return
  const d = document.createElement('div')
  d.id = 'debug-drawer'
  d.className = 'debug'
  const acts: Array<[string, () => void]> = [
    ['下辈子必怪物', () => { meta.debugTalent = 'monster' }],
    ['下辈子必天才', () => { meta.debugTalent = 'genius' }],
    ['下辈子必木桶', () => { meta.debugTalent = 'barrel' }],
    ['成长 +10', () => { meta.growth.milestones += 10 }],
    ['热情 +300', () => { if (life) { life.passion += 300; life.passionMax = Math.max(life.passionMax, life.passion) } }],
    ['热情 → 50', () => { if (life) life.passion = 50 }],
    ['实力 +500', () => { if (life) life.mmr += 500 }],
    ['现金 +10万', () => { if (life) life.cash += 100000; meta.cash += 100000 }],
    ['现金 −5万', () => { if (life) life.cash -= 50000; meta.cash -= 50000 }],
    ['人气 +1万', () => { if (life) life.fans += 10000; meta.pro.fame += 10000 }],
    ['代练史 +1', () => { if (life) life.dirty.hires++; meta.dirty.hires++ }],
    ['职业成长 +10', () => { meta.pro.growth += 10 }],
    ['解除职业拉黑', () => { meta.proBlockLives = 0 }],
  ]
  d.innerHTML = `<div class="debug-title">调试</div>${acts.map((a, i) => `<button data-d="${i}">${a[0]}</button>`).join('')}`
  document.body.appendChild(d)
  d.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => {
    b.onclick = () => {
      acts[Number(b.dataset.d)][1]()
      writeMeta(meta)
      if (life) refreshHud()
      else renderHome()
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
      <span>${got || !a.honor ? a.desc : '职业生涯荣誉'}</span>
    </div>`
  }).join('')
  const n = achCount(meta)
  const perkRows = ACH_PERKS.map((p) => `<div class="ach-row ${n >= p.n ? 'got' : ''}"><b>${p.n} 个 · ${p.name}</b><span>${p.desc}</span></div>`).join('')
  const ends = Object.entries(meta.endings)
  const top = pageTop(`成就 <span class="num" style="font-size:0.9em">${n}</span><span style="color:var(--bone-faint)">/${ACHIEVEMENTS.length}</span>`, renderHome)
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <p class="tip">每 5 个成就 → 英雄池 +1 → 下辈子天赋分布上移。攒到档位解锁传承。✦ 为职业生涯荣誉。开挂之后这辈子解锁的成就不计。</p>
    <div class="section"><div class="label">传承</div>${perkRows}</div>
    <div class="section">${rows}</div>
    ${ends.length ? `<div class="section"><div class="label">结局收集</div><p class="tip">${ends.map(([k, v]) => `${ENDING_NAME[k] ?? k} ×${v}`).join(' · ')}</p></div>` : ''}
  </div>`
  top.bind()
}

/* ———————————— 一段人生：滚动页 ———————————— */

function startLife() {
  stopTimer()
  paused = false
  fastForward = false
  committed = false
  life = createLife(meta)
  writeMeta(meta) // debugTalent 已消费
  beginLife(meta, life)
  renderLife()
  tickLife()
}

function refreshHud() {
  if (!life) return
  const g = life
  const set = (id: string, html: string) => { const el = $(id); if (el) el.innerHTML = html }
  if (g.scouted && (meta.pro.active || meta.pro.ending)) {
    // 职业阶段 HUD
    const p = meta.pro
    const t = teamOf(p.teamId)
    const fi = FORM_INFO[p.form]
    set('hud-title', '职业生涯')
    set('hud-meta', `<span>第 <span class="num">${p.year + 1}</span> 年 · <span class="num">${p.age}</span> 岁</span><span>${p.stageAt ? `Stage <span class="num">${p.stageAt}</span> / 3` : '年初'}</span><span><span class="talent-badge ${fi.cls}">${fi.name}</span> 实力 <span class="num">${p.skill}</span></span>`)
    set('hud-rank', `<span class="career" style="font-size:0.7em">${t ? t.name : '自由人'}</span>`)
    set('hud-persona', `${talentBadge(g.talent)}&nbsp;&nbsp;<span class="tip">${g.scoutedAt ? `${g.scoutedAt.age} 岁 ${rankInline(g.scoutedAt.rank)} 被发掘` : ''}</span>`)
    set('hud-res', `<span>现金 <b class="num ${meta.cash < 0 ? 'lose' : ''}">${fmt(meta.cash)}</b></span><span>人气 <b class="num">${fmt(p.fame)}</b></span><span>冠军 <b class="num">${p.titles.regional}</b></span><span>国际赛 <b class="num">${p.titles.intl}</b></span>${p.titles.world ? `<span>世界冠军 <b class="num">${p.titles.world}</b></span>` : ''}${p.titles.fmvp ? `<span>FMVP <b class="num">${p.titles.fmvp}</b></span>` : ''}${p.suspended ? `<span class="ban">禁赛 ${p.suspended}</span>` : ''}`)
    const bar = $('hud-bar')
    if (bar) bar.style.width = `${(p.stageAt / 3) * 100}%`
    set('hud-quota', `OWCS 中国赛区${meta.manual ? ' · 点左栏推进' : ''}${fastForward ? ' · 快进' : ''}`)
    return
  }
  set('hud-title', '天梯人生')
  set('hud-meta', `<span>S<span class="num">${g.season}</span></span><span><span class="num">${g.age}</span> 岁 · ${STAGE_INFO[g.stage].name}</span><span>${g.stuckSeasons ? `<span class="warn">卡墙 ${g.stuckSeasons} 季</span>` : `峰值 ${rankInline(scoreToRank(g.peakScore))}`}</span>`)
  set('hud-rank', rankHtml(g.rank))
  set('hud-persona', `${talentBadge(g.talent)}&nbsp;&nbsp;<span class="tip">【${g.persona.name}】${g.persona.tagline}</span>`)
  const extra = [
    g.spurtSeasons ? `<span class="win">爆发 <b class="num">${g.spurtSeasons}</b></span>` : '',
    g.crewSeasons ? `<span>车队 <b class="num">${g.crewSeasons}</b></span>` : '',
    dirtyN(g) ? `<span class="warn">黑历史 <b class="num">${dirtyN(g)}</b></span>` : '',
    g.achLocked ? '<span class="ban">成就锁定</span>' : '',
  ].join('')
  set('hud-res', `<span>热情 <b class="num ${g.passion < STAGE_INFO[g.stage].games * 1.5 ? 'lose' : ''}">${g.passion}</b></span><span>现金 <b class="num ${g.cash < 0 ? 'lose' : ''}">${fmt(g.cash)}</b></span><span>人气 <b class="num">${fmt(g.fans)}</b></span>${extra}`)
  const bar = $('hud-bar')
  if (bar) bar.style.width = `${clamp((g.passion / Math.max(1, g.passionMax)) * 100, 0, 100)}%`
  set('hud-quota', `热情还够打 <span class="num">${Math.floor(g.passion / Math.max(1, STAGE_INFO[g.stage].games))}</span> 季 · ${g.gamesTotal.toLocaleString()} 把${fastForward ? ' · 快进' : ''}`)
}

function renderLife() {
  if (!life) return
  app.innerHTML = `
    <div class="top">
      <h2 id="hud-title">天梯人生</h2>
      <div class="actions"><button class="btn btn-sm" id="btn-pause">暂停</button></div>
    </div>
    <div class="stat" id="hud-meta"></div>
    <div class="rank-hero" id="hud-rank"></div>
    <div id="hud-persona" style="margin:4px 0 10px"></div>
    <div class="stat" id="hud-res"></div>
    <div class="bar"><i id="hud-bar" style="width:0%"></i></div>
    <div class="tip" id="hud-quota" style="margin-bottom:16px"></div>
    ${meta.manual ? '<div class="manual-tip">点左栏 · 推进</div>' : ''}
    <div class="log-cols">
      <div class="log-col"><div class="label">人生</div><div class="log-box" id="log-box"></div></div>
      <div class="log-col"><div class="label">高光</div><div class="log-box" id="hl-box"></div></div>
    </div>
    <div class="mask" id="pause-mask" hidden>
      <div class="mask-box">
        <div class="mask-title">暂停</div>
        <button class="btn btn-primary" id="btn-resume">继续</button>
        <button class="btn" id="btn-ff">${fastForward ? '取消快进' : '快进'}</button>
        <button class="btn" id="btn-settings-ingame">设置</button>
        <button class="btn btn-danger" id="btn-exit">放弃这辈子 · 回首页</button>
      </div>
    </div>
    <div class="mask" id="choice-mask" hidden>
      <div class="mask-box">
        <div class="mask-title" id="choice-title" style="color:var(--brass)"></div>
        <div class="mask-body" id="choice-body"></div>
        <div id="choice-btns"></div>
      </div>
    </div>
  `
  shownLog = 0
  shownHl = 0
  flushLogs()
  refreshHud()
  $('btn-pause')!.onclick = () => { paused = true; stopTimer(); $('btn-ff')!.textContent = fastForward ? '取消快进' : '快进'; showSheet('pause-mask') }
  $('btn-resume')!.onclick = resumeLife
  $('btn-ff')!.onclick = () => { fastForward = !fastForward; resumeLife() }
  $('btn-settings-ingame')!.onclick = () => { hideSheets(); renderSettingsInGame() }
  $('btn-exit')!.onclick = () => { if (confirm('放弃这辈子：不写档、不计成长。确定？')) { life = null; Object.assign(meta, loadMeta()); renderHome() } }
  if (meta.manual) $('log-box')!.onclick = () => { if (life && !paused && !life.choice && !life.over) tickLife() }
  if (paused) showSheet('pause-mask')
  mountDebug()
}

function resumeLife() {
  paused = false
  hideSheets()
  if (life?.choice) { showChoice(); return }
  if (life?.over) { renderLifeSettle(); return }
  if (!meta.manual) { stopTimer(); tickLife() }
}

function tickLife() {
  if (!life || paused) return
  const r = lifeStep()
  flushLogs()
  refreshHud()
  if (r === 'choice') { showChoice(); return }
  if (r === 'done') { stopTimer(); timer = window.setTimeout(renderLifeSettle, 1400); return }
  // 天梯一行一季，慢一点；职业一行一场，稍快
  const mult = life.scouted ? 1.6 : 2.5
  if (!meta.manual) timer = window.setTimeout(tickLife, fastForward ? intervalMs() : intervalMs() * mult)
}

function showChoice() {
  const c = life?.choice
  if (!c || !life) { tickLife(); return }
  stopTimer()
  $('choice-title')!.textContent = c.title
  $('choice-body')!.innerHTML = c.body
  $('choice-btns')!.innerHTML = c.options.map((o) => `<button class="btn ${o.cls && o.cls !== 'disabled' ? 'btn-' + o.cls : ''}" data-opt="${o.id}" ${o.cls === 'disabled' ? 'disabled' : ''}>${o.label}${o.sub ? `<span class="btn-sub">${o.sub}</span>` : ''}</button>`).join('')
  $('choice-btns')!.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.opt!
      if (id === 'cheat' && !confirm('开挂：这道墙大概率过得去，但几季之内必被永封，从此刻起这辈子的成就不再计入，也永远进不了职业。确定？')) return
      lifeChoose(life!, id)
      hideSheets()
      stopTimer()
      tickLife()
    }
  })
  showSheet('choice-mask')
}

/* ———————————— 人生结算 ———————————— */

function proLedger(limit = 12) {
  const hist = meta.pro.history.slice().reverse().slice(0, limit)
  if (!hist.length) return ''
  return `<div class="ledger">${hist.map((r) => `<div class="row">
    <span class="k">第 ${r.year} 年 S${r.stage} · ${r.team}</span>
    <span class="v">${r.place ? `地区第 <b class="num">${r.place}</b>` : r.note ?? '预选出局'}${r.intl ? ` · ${INTL_NAME[r.stage]} 第 <b class="num">${r.intl}</b>` : ''}${r.prize ? ` · <span class="num">+${fmt(r.prize)}</span>` : ''}${r.bench ? ' <span class="tip">替补</span>' : ''}</span>
  </div>`).join('')}</div>`
}

function renderLifeSettle() {
  if (!life) return
  const g = life
  stopTimer()
  fastForward = false
  if (!committed) {
    committed = true
    commitLife(g, meta)
    writeMeta(meta)
  }

  const peak = scoreToRank(g.peakScore)
  const real = scoreToRank(g.peakMmr)
  const newAch = g.newAchievements.map((id) => ACH_MAP[id]).filter(Boolean)
  const big = (l: LogLine) => l.cls === 'ending' || l.cls === 'ban' || l.cls === 'talent'
  const hl = [...g.highlights.filter(big), ...g.highlights.filter((l) => !big(l))].slice(0, 12)
  const p = meta.pro

  const head = g.scouted
    ? `<div class="sub" style="margin:0 0 6px">这一辈子 · ${g.age} 岁退役 · 职业 ${p.yearsPlayed} 年</div>
       <div class="rank-hero" style="text-align:center;font-size:2rem"><span class="career">${g.ending?.title ?? '职业生涯'}</span></div>`
    : `<div class="sub" style="margin:0 0 6px">这一辈子 · ${g.age} 岁${g.banned ? '永封' : '退坑'}</div>
       <div class="rank-hero" style="text-align:center;font-size:2.8rem">${rankHtml(peak)}</div>`

  const cells = g.scouted
    ? `<div class="cell"><div class="label">荣誉</div><div class="num" style="color:var(--brass)">${p.titles.regional + p.titles.intl + p.titles.world}</div><small>地区 ${p.titles.regional} · 国际 ${p.titles.intl} · 世界 ${p.titles.world}${p.titles.fmvp ? ` · FMVP ${p.titles.fmvp}` : ''}</small></div>
       <div class="cell"><div class="label">现金</div><div class="num ${meta.cash < 0 ? 'lose' : ''}">${fmt(meta.cash)}</div><small>人气 ${fmt(p.fame)}</small></div>
       <div class="cell"><div class="label">被发掘</div><div style="font-family:var(--display);font-size:1rem;line-height:1.5">${g.scoutedAt ? `${g.scoutedAt.age} 岁` : ''}</div><small>${g.scoutedAt ? rankInline(g.scoutedAt.rank) : ''}</small></div>`
    : `<div class="cell"><div class="label">现金</div><div class="num ${g.cash < 0 ? 'lose' : ''}">${fmt(g.cash)}</div><small>人气 ${fmt(g.fans)}</small></div>
       <div class="cell"><div class="label">卡墙</div><div class="num">${g.stuckTotal}</div><small>季</small></div>
       <div class="cell"><div class="label">阶段</div><div style="font-family:var(--display);font-size:1rem;line-height:1.5">${STAGE_INFO[g.stage].name}</div><small>${dirtyN(g) ? `黑历史 ${dirtyN(g)}` : '干净'}</small></div>`

  app.innerHTML = `<div class="reveal">
    ${head}
    <div class="stat" style="justify-content:center;margin-top:6px">
      <span>${talentBadge(g.talent)}</span>
      <span>真实峰值 ${rankInline(real)}</span>
      <span>${g.season} 季 · ${fmt(g.gamesTotal)} 把</span>
    </div>
    <div class="rule-brass"></div>
    <div class="dossier">${cells}</div>
    ${g.ending ? `<div class="section ending-card">
        <h2>${g.ending.title}</h2>
        <div class="tip">${g.ending.rankLabel}</div>
        ${g.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}
      </div>` : ''}
    ${newAch.length ? `<div class="section"><div class="label">新成就</div>${newAch.map((a) => `<div class="ach-row got ${a.honor ? 'pro' : ''}"><b>${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>` : ''}
    <div class="section" style="padding-bottom:6px">
      <button class="btn btn-primary" id="again">再来一辈子 · 摇天赋</button>
      <button class="btn" id="home">回首页</button>
    </div>
    ${hl.length ? `<div class="section"><div class="label">这辈子的高光</div>${hl.map((l) => `<div class="hl ${l.cls}">${l.text}</div>`).join('')}</div>` : ''}
    ${g.scouted ? `<div class="section"><div class="label">履历</div>${proLedger()}</div>` : ''}
    <div class="section"><div class="label">人生</div><div class="log-box" id="log-box" style="max-height:40vh"></div></div>
  </div>`
  appendTo('log-box', g.logs)
  $('again')!.onclick = startLife
  $('home')!.onclick = () => { life = null; renderHome() }
  mountDebug()
}

/* ———————————— 说明 / 设置 ———————————— */

function renderAbout() {
  const top = pageTop('说明', renderHome)
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <div class="section" style="border-top:0">
      <div class="label">一局一辈子</div>
      <p class="tip" style="color:var(--bone)">${START_AGE} 岁开局，一行一季，一年四季。热情是寿元：每季打天梯要花，突破段位才回。热情花完、或者 ${QUIT_AGE} 岁，这辈子就退坑。</p>
    </div>
    <div class="section">
      <div class="label">天赋与墙</div>
      <p class="tip" style="color:var(--bone)">天赋开局摇一档，一辈子不变，决定隐藏实力涨多快。每个大段之间有一道墙：实力顶到墙就要过检定，过不去就卡在 X1·9x——差一分的那种。卡久了会有一次抉择：换英雄池（先掉分再爆发）、找教练复盘（花钱堆势），或者继续打。</p>
    </div>
    <div class="section">
      <div class="label">系统控分</div>
      <p class="tip" style="color:var(--bone)">段位跟着实力慢慢走。实力高于段位时系统欠你分（逆风局 / 安慰奖），低于时段位虚高（预期 / 大逆转）。每年软重置一次重新定级。</p>
    </div>
    <div class="section">
      <div class="label">被发掘</div>
      <p class="tip" style="color:var(--bone)">${SCOUT_MAX_AGE} 岁前打到宗师以上，有概率收到青训教练的私信。试训前有背调：账号干净才好过。通过就进职业：OWCS 中国赛区在同一条时间线上继续滚，签约、转会、板凳、更衣室、赛季注册审查——全是事件，不用你点。</p>
    </div>
    <div class="section">
      <div class="label">黑市</div>
      <p class="tip" style="color:var(--bone)">热情快见底又卡在墙上时，会有人私信你。代练能过墙，但留下记录：天梯里可能被封 30 天，职业里被翻出来就是禁赛解约，还连累下几辈子。开挂过墙最容易，但几季之内必被永封，从那一刻起这辈子的成就不再计入。</p>
    </div>
    <div class="section">
      <div class="label">全局成长</div>
      <p class="tip" style="color:var(--bone)">每辈子打完，成长点 +1；每 5 个成就英雄池 +1；首次触及各大段 / 首次进职业各 +1。成长只改下辈子摇到高档天赋的概率。成就攒到 10 / 20 / 30 / 40 / 50 个各解锁一档传承，改开局条件。</p>
    </div>
    <div class="section">
      <div class="label">会发生什么</div>
      <p class="tip" style="color:var(--bone)">打了才知道。</p>
    </div>
  </div>`
  top.bind()
}

function settingsBody() {
  return `
    <label class="row"><span class="k">手动模式（点日志推进一季 / 一场）</span><input type="checkbox" id="set-manual" ${meta.manual ? 'checked' : ''}></label>
    <div class="row" style="border-bottom:0"><span class="k">基础间隔</span><span class="v num" id="speed-val">${meta.speed}s</span></div>
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
  const top = pageTop('设置', () => { writeMeta(meta); paused = true; renderLife() })
  app.innerHTML = `<div class="reveal">${top.html}<div class="section" style="border-top:0">${settingsBody()}</div></div>`
  top.bind()
  bindSpeed()
}

renderHome()

// 直达入口（分享链接 / 调试）：?go=play|ach|about
{
  const go = new URLSearchParams(location.search).get('go')
  if (go === 'play') startLife()
  else if (go === 'ach') renderAchievements()
  else if (go === 'about') renderAbout()
}
