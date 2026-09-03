import './style.css'
import type { HiddenTalent, LifeState, LogLine, RankState, TalentTier } from './types'
import {
  ACH_PERKS, DEFAULT_SPEED, FORM_INFO, FORM_ORDER, HIDDEN_INFO, INTL_NAME, MAJOR_NAME, MIN_SPEED, QUIT_AGE, RANK_COLOR_CLASS, SCOUT_MAX_AGE,
  STAGE_INFO, START_AGE, TALENT_INFO, TALENT_ORDER,
} from './data/constants'
import { ACHIEVEMENTS, ACH_MAP } from './data/achievements'
import { levelNeed, talentProbs } from './data/talent'
import { achCount, beginLife, commitLife, createLife, currentShift, freshMeta, lifeStep, loadMeta, writeMeta } from './sim/life'
import { clamp, scoreToRank } from './sim/rank'
import { beginCareerRun, careerInProgress, exposureP, formProbs, proAge, proStep, teamOf, teamRating } from './sim/pro'

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
let commitResult: { toPro: boolean; exp: number; ups: number } | null = null
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

function talentBadge(t: TalentTier, hidden: HiddenTalent | null = null) {
  const ti = TALENT_INFO[t]
  const hid = hidden ? `&nbsp;<span class="talent-badge tal-h" title="隐藏天赋">${HIDDEN_INFO[hidden].name}</span>` : ''
  return `<span class="talent-badge ${ti.cls}">${ti.name}</span>${hid}`
}

function showSheet(id: string) { const m = $(id); if (m) m.hidden = false }
function hideSheets() {
  for (const id of ['pause-mask', 'pro-pause']) { const m = $(id); if (m) m.hidden = true }
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
  aimbot: '人形自走挂', unstuck: '从没卡过', latebloom: '越老越妖', glasshand: '伤仲永',
}
for (const m of Object.keys(MAJOR_NAME) as Array<keyof typeof MAJOR_NAME>) {
  ENDING_NAME[`cloudmud_${m}`] = `云泥之隔 · ${MAJOR_NAME[m]}`
  ENDING_NAME[`quit_${m}`] = `退坑 · ${MAJOR_NAME[m]}`
}

const dirtyN = (g: LifeState) => g.dirty.boostJobs + g.dirty.hires + g.dirty.cheatSeasons

/** 经验行：Lv · 细条 */
function expLine() {
  const g = meta.growth
  const need = levelNeed(g.level)
  return `<div class="exp-line"><span class="lv">Lv <b class="num">${g.level}</b></span><div class="exp-bar"><i style="width:${clamp((g.exp / need) * 100, 0, 100)}%"></i></div><span class="num tip">${g.exp}/${need}</span></div>`
}

/* ———————————— 首页 ———————————— */

/** 下辈子天赋：一根固定的条，各档占比；天才 / 怪物随成就 + 等级慢慢变宽 */
function talentBar() {
  const probs = talentProbs(currentShift(meta))
  const segs = TALENT_ORDER.map((t) => `<i class="${TALENT_INFO[t].cls}" style="width:${probs[t]}%" title="${TALENT_INFO[t].name} ${probs[t]}% · ${TALENT_INFO[t].range}"></i>`).join('')
  const legend = TALENT_ORDER.map((t) => `<span class="${TALENT_INFO[t].cls}">${TALENT_INFO[t].name}</span>`).join('')
  return `<div class="section" style="padding-bottom:10px">
    <div class="row" style="border-bottom:0;padding:0 0 8px"><span class="label" style="margin:0">下辈子投胎</span>${expLine()}</div>
    <div class="tal-stack">${segs}</div>
    <div class="tal-legend">${legend}</div>
  </div>`
}

/** 成就奖励：成就攒到一定数量，下辈子永久带着的 buff。首页只列已拿到的 + 下一档 */
function perkLine() {
  const n = achCount(meta)
  const got = ACH_PERKS.filter((p) => n >= p.n)
  const next = ACH_PERKS.find((p) => n < p.n)
  if (!got.length && !next) return ''
  const rows = got.map((p) => `<div class="perk-row"><b>${p.name}</b><span>${p.desc}</span></div>`).join('')
  const nextRow = next ? `<div class="perk-row next"><b>${next.n} 成就解锁</b><span>${next.name} · ${next.desc}</span></div>` : ''
  return `<div class="section" style="padding-top:8px">
    <div class="row" style="border-bottom:0;padding:0 0 6px"><span class="label" style="margin:0">成就奖励 · 下辈子带着</span><span class="tip">${got.length}/${ACH_PERKS.length}</span></div>
    ${rows}${nextRow}
  </div>`
}

function renderHome() {
  stopTimer()
  stopProTimer()
  fastForward = false
  life = null
  const achN = achCount(meta)
  const p = meta.pro
  const best = meta.bestPeakScore ? rankInline(scoreToRank(meta.bestPeakScore)) : '<span class="sys">—</span>'
  const blockBanner = meta.proBlockLives > 0
    ? `<div class="mute-line on" style="margin-bottom:14px"><span>职业圈拉黑 · 还剩 ${meta.proBlockLives} 辈子</span><small>上次打职业时代练史被翻出来了。这几辈子不会再有教练私信你。</small></div>`
    : ''
  const proNow = p.active
    ? `<div class="section">
        <div class="label">进行中的职业生涯</div>
        <p class="tip" style="color:var(--bone)"><span class="career">${teamOf(p.teamId)?.name ?? '自由人'}</span> · ${p.age} 岁 · 第 ${p.year + 1} 年 · 人气 ${fmt(p.fame)}</p>
        <button class="btn btn-pro btn-gold" id="btn-pro" style="margin-top:10px">继续职业生涯</button>
      </div>`
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
    ${proNow}
    ${talentBar()}
    ${perkLine()}
    <div class="section" style="border-top:0;padding-top:6px">
      <button class="btn btn-primary" id="btn-start" ${p.active ? 'disabled' : ''}>${p.active ? '先把职业生涯打完' : '开始一段人生 · 摇天赋'}</button>
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
  $('btn-pro')?.addEventListener('click', renderPro)
  $('btn-ach')!.onclick = renderAchievements
  $('btn-about')!.onclick = renderAbout
  $('btn-settings')!.onclick = renderSettings
  $('btn-wipe')!.onclick = () => {
    if (!confirm('删档重来：等级、职业生涯、职业拉黑全部清零，成就与结局收集保留。确定？')) return
    Object.assign(meta, freshMeta(), { speed: meta.speed, manual: meta.manual, achievements: meta.achievements, endings: meta.endings })
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
    ['隐藏：神枪', () => { meta.debugHidden = 'aim' }],
    ['隐藏：大心脏', () => { meta.debugHidden = 'clutch' }],
    ['隐藏：晚熟', () => { meta.debugHidden = 'late' }],
    ['隐藏：玻璃手', () => { meta.debugHidden = 'glass' }],
    ['等级 +10', () => { meta.growth.level += 10 }],
    ['热情 +300', () => { if (life) { life.passion += 300; life.passionMax = Math.max(life.passionMax, life.passion) } }],
    ['热情 → 50', () => { if (life) life.passion = 50 }],
    ['实力 +500', () => { if (life) life.mmr += 500 }],
    ['现金 +10万', () => { if (life) life.cash += 100000; else meta.cash += 100000 }],
    ['现金 −5万', () => { if (life) life.cash -= 50000; else meta.cash -= 50000 }],
    ['人气 +1万', () => { if (life) life.fans += 10000; meta.pro.fame += 10000 }],
    ['代练史 +1', () => { if (life) life.dirty.hires++; else meta.dirty.hires++ }],
    ['职业成长 +10', () => { meta.pro.growth += 10 }],
    ['职业年龄 +5', () => { if (meta.pro.active) meta.pro.age += 5 }],
    ['解除职业拉黑', () => { meta.proBlockLives = 0 }],
  ]
  d.innerHTML = `<div class="debug-title">调试</div>${acts.map((a, i) => `<button data-d="${i}">${a[0]}</button>`).join('')}`
  document.body.appendChild(d)
  d.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => {
    b.onclick = () => {
      acts[Number(b.dataset.d)][1]()
      writeMeta(meta)
      if (life) refreshHud()
      else if (!careerInProgress() && !meta.pro.active) renderHome()
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
    const hide = !got && (a.honor || a.secret)
    return `<div class="ach-row ${got ? 'got' : ''} ${a.honor ? 'pro' : ''} ${a.secret ? 'secret' : ''}">
      <b>${hide ? (a.secret ? '？' : '· · ·') : a.name}</b>
      <span>${!hide ? a.desc : a.secret ? '隐藏' : '职业生涯荣誉'}</span>
    </div>`
  }).join('')
  const n = achCount(meta)
  const perkRows = ACH_PERKS.map((p) => `<div class="ach-row ${n >= p.n ? 'got' : ''}"><b>${p.n} 个成就 · ${p.name}</b><span>${p.desc}</span></div>`).join('')
  const ends = Object.entries(meta.endings)
  const top = pageTop(`成就 <span class="num" style="font-size:0.9em">${n}</span><span style="color:var(--bone-faint)">/${ACHIEVEMENTS.length}</span>`, renderHome)
  app.innerHTML = `<div class="reveal">
    ${top.html}
    <p class="tip">每个成就都让下辈子摇到天才 / 怪物的概率高 0.1%。成就总数攒到下面的档位，还会解锁一个下辈子永久带着的 buff。✦ 为职业生涯荣誉，？为隐藏。开挂之后这辈子解锁的成就不计。</p>
    <div class="section"><div class="label">成就奖励 · 攒够数就永久生效</div>${perkRows}</div>
    <div class="section">${rows}</div>
    ${ends.length ? `<div class="section"><div class="label">结局收集</div><p class="tip">${ends.map(([k, v]) => `${ENDING_NAME[k] ?? k} ×${v}`).join(' · ')}</p></div>` : ''}
  </div>`
  top.bind()
}

/* ———————————— 一段人生：滚动页 ———————————— */

function startLife() {
  stopTimer()
  stopProTimer()
  paused = false
  fastForward = false
  committed = false
  commitResult = null
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
  set('hud-meta', `<span>S<span class="num">${g.season}</span></span><span><span class="num">${g.age}</span> 岁 · ${STAGE_INFO[g.stage].name}</span><span>${g.stuckSeasons ? `<span class="warn">卡墙 ${g.stuckSeasons} 季</span>` : `峰值 ${rankInline(scoreToRank(g.peakScore))}`}</span>`)
  set('hud-rank', rankHtml(g.rank))
  set('hud-persona', `${talentBadge(g.talent, g.hidden)}&nbsp;&nbsp;<span class="tip">【${g.persona.name}】${g.persona.tagline}</span>`)
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
      <h2>天梯人生</h2>
      <div class="actions"><button class="btn btn-sm" id="btn-pause">暂停</button></div>
    </div>
    <div class="stat" id="hud-meta"></div>
    <div class="rank-hero" id="hud-rank"></div>
    <div id="hud-persona" style="margin:4px 0 10px"></div>
    <div class="stat" id="hud-res"></div>
    <div class="bar"><i id="hud-bar" style="width:0%"></i></div>
    <div class="tip" id="hud-quota" style="margin-bottom:16px"></div>
    ${meta.manual ? '<div class="manual-tip">点左栏 · 过一季</div>' : ''}
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
  `
  shownLog = 0
  shownHl = 0
  flushLogs()
  refreshHud()
  $('btn-pause')!.onclick = () => { paused = true; stopTimer(); $('btn-ff')!.textContent = fastForward ? '取消快进' : '快进'; showSheet('pause-mask') }
  $('btn-resume')!.onclick = resumeLife
  $('btn-ff')!.onclick = () => { fastForward = !fastForward; resumeLife() }
  $('btn-settings-ingame')!.onclick = () => { hideSheets(); renderSettingsInGame() }
  $('btn-exit')!.onclick = () => { if (confirm('放弃这辈子：不写档、不计经验。确定？')) { life = null; renderHome() } }
  if (meta.manual) $('log-box')!.onclick = () => { if (life && !paused && !life.over) tickLife() }
  if (paused) showSheet('pause-mask')
  mountDebug()
}

function resumeLife() {
  paused = false
  hideSheets()
  if (life?.over) { renderLifeSettle(); return }
  if (!meta.manual) { stopTimer(); tickLife() }
}

function tickLife() {
  if (!life || paused) return
  const r = lifeStep()
  flushLogs()
  refreshHud()
  if (r === 'done') { stopTimer(); timer = window.setTimeout(renderLifeSettle, 1400); return }
  // 一行是一季，比职业一场慢一点
  if (!meta.manual) timer = window.setTimeout(tickLife, fastForward ? intervalMs() : intervalMs() * 2.5)
}

/* ———————————— 人生结算 ———————————— */

function expCard(exp: number, ups: number) {
  return `<div class="section" style="padding-top:8px">
    <div class="row" style="border-bottom:0;padding:0 0 8px"><span class="label" style="margin:0">经验 <b class="num" style="color:var(--brass)">+${exp}</b>${ups ? ` <span class="win">升 ${ups} 级</span>` : ''}</span>${expLine()}</div>
  </div>`
}

function renderLifeSettle() {
  if (!life) return
  const g = life
  stopTimer()
  fastForward = false
  if (!committed) {
    committed = true
    commitResult = commitLife(g, meta)
    writeMeta(meta)
  }
  const toPro = commitResult?.toPro ?? g.scouted

  const peak = scoreToRank(g.peakScore)
  const real = scoreToRank(g.peakMmr)
  const newAch = g.newAchievements.map((id) => ACH_MAP[id]).filter(Boolean)
  const big = (l: LogLine) => l.cls === 'ending' || l.cls === 'ban' || l.cls === 'talent'
  const hl = [...g.highlights.filter(big), ...g.highlights.filter((l) => !big(l))].slice(0, 12)

  const head = toPro
    ? `<div class="sub" style="margin:0 0 6px">试训通过 · ${g.age} 岁</div>
       <div class="rank-hero" style="text-align:center;font-size:2rem"><span class="career">进入职业生涯</span></div>`
    : `<div class="sub" style="margin:0 0 6px">这一辈子 · ${g.age} 岁${g.banned ? '永封' : '退坑'}</div>
       <div class="rank-hero" style="text-align:center;font-size:2.8rem">${rankHtml(peak)}</div>`

  app.innerHTML = `<div class="reveal">
    ${head}
    <div class="stat" style="justify-content:center;margin-top:6px">
      <span>${talentBadge(g.talent, g.hidden)}</span>
      <span>真实峰值 ${rankInline(real)}</span>
      <span>${g.season} 季 · ${fmt(g.gamesTotal)} 把</span>
    </div>
    <div class="rule-brass"></div>
    <div class="dossier">
      <div class="cell"><div class="label">现金</div><div class="num ${g.cash < 0 ? 'lose' : ''}">${fmt(g.cash)}</div><small>人气 ${fmt(g.fans)}</small></div>
      <div class="cell"><div class="label">卡墙</div><div class="num">${g.stuckTotal}</div><small>季</small></div>
      <div class="cell"><div class="label">阶段</div><div style="font-family:var(--display);font-size:1rem;line-height:1.5">${STAGE_INFO[g.stage].name}</div><small>${dirtyN(g) ? `黑历史 ${dirtyN(g)}` : '干净'}</small></div>
    </div>
    ${toPro ? `<div class="section ending-card">
        <h2>有人找你</h2>
        <div class="tip">${g.age} 岁 · ${rankInline(g.rank)}</div>
        <div class="verse">教练说：「下周来报到。」天梯到此为止，接下来是 OWCS。</div>
        <div class="verse">这辈子的天赋会带进去：${TALENT_INFO[g.talent].name}。现金、人气、${dirtyN(g) ? '<span class="warn">还有黑历史</span>' : '干净的档案'}也一起。</div>
      </div>` : ''}
    ${g.ending ? `<div class="section ending-card">
        <h2>${g.ending.title}</h2>
        <div class="tip">${g.ending.rankLabel}</div>
        ${g.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}
      </div>` : ''}
    ${newAch.length ? `<div class="section"><div class="label">新成就</div>${newAch.map((a) => `<div class="ach-row got ${a.honor ? 'pro' : ''}"><b>${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>` : ''}
    ${commitResult ? expCard(commitResult.exp, commitResult.ups) : ''}
    <div class="section" style="padding-bottom:6px">
      ${toPro
        ? '<button class="btn btn-pro btn-gold" id="go-pro">进入职业生涯 · 一路滚到退役</button>'
        : '<button class="btn btn-primary" id="again">再来一辈子 · 摇天赋</button>'}
      <button class="btn" id="home">回首页</button>
    </div>
    ${hl.length ? `<div class="section"><div class="label">这辈子的高光</div>${hl.map((l) => `<div class="hl ${l.cls}">${l.text}</div>`).join('')}</div>` : ''}
    <div class="section"><div class="label">人生</div><div class="log-box" id="log-box" style="max-height:40vh"></div></div>
  </div>`
  appendTo('log-box', g.logs)
  $('again')?.addEventListener('click', startLife)
  $('go-pro')?.addEventListener('click', () => { life = null; startProRun() })
  $('home')!.onclick = () => { life = null; renderHome() }
  mountDebug()
}

/* ———————————— 职业生涯（独立一页，签约到退役一路滚完，全自动） ———————————— */

let proTimer: number | null = null
let proPaused = false
let proShownLog = 0
let proShownHl = 0
let proSavedYear = 0

function stopProTimer() {
  if (proTimer != null) { clearTimeout(proTimer); proTimer = null }
}

function formBadge(f: keyof typeof FORM_INFO) {
  const fi = FORM_INFO[f]
  return `<span class="talent-badge ${fi.cls}">${fi.name}</span>`
}

/** 本年状态档概率：也是一根固定的条 */
function formBar(age: number) {
  const p = meta.pro
  const probs = formProbs(p.growth + p.talentBonus, age)
  const segs = FORM_ORDER.map((f) => `<i class="${FORM_INFO[f].cls}" style="width:${probs[f]}%" title="${FORM_INFO[f].name} ${probs[f]}% · 实力 ${FORM_INFO[f].min}–${FORM_INFO[f].max}"></i>`).join('')
  const legend = FORM_ORDER.map((f) => `<span class="${FORM_INFO[f].cls}">${FORM_INFO[f].name}</span>`).join('')
  return `<div class="section" style="padding-bottom:10px">
    <div class="row" style="border-bottom:0;padding:0 0 8px"><span class="label" style="margin:0">本年状态</span><span class="tip">职业成长 <b class="num">${p.growth}</b>${p.talentBonus ? ` · 天赋 ${p.talentBonus > 0 ? '+' : ''}${p.talentBonus}` : ''} · ${age} 岁${age >= 25 ? ' <span class="warn">年龄开始抵消</span>' : ''}</span></div>
    <div class="tal-stack">${segs}</div>
    <div class="tal-legend">${legend}</div>
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
  life = null
  const p = meta.pro
  const top = pageTop('职业生涯', renderHome)
  const t = teamOf(p.teamId)
  const titles = `地区冠军 ${p.titles.regional} · 国际赛前二 ${p.titles.intl}${p.titles.world ? ` · 国际赛冠军 ${p.titles.world}` : ''}${p.titles.fmvp ? ` · FMVP ${p.titles.fmvp}` : ''}${p.titles.worldCup ? ` · 国家队 ${p.titles.worldCup}` : ''}`
  const d = meta.dirty
  const expo = exposureP(meta)
  const dirtyText = d.boostJobs + d.hires + d.cheatSeasons + p.fixes === 0
    ? '<span class="win">干净。背调翻不出东西。</span>'
    : `<span class="warn">代练单 ${d.boostJobs} · 请人 ${d.hires} 套${p.fixes ? ` · 假赛 ${p.fixes}` : ''} → 每次审查被翻出来的概率 ${Math.round(expo * 100)}%。</span>`

  let body: string
  if (!p.active) {
    body = `${p.ending ? `<div class="section ending-card"><h2>${p.ending.title}</h2><div class="tip">${p.ending.rankLabel}</div>${p.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}</div>` : ''}
      <div class="section"><div class="label">怎么进来</div><p class="tip" style="color:var(--bone)">天梯人生里 ${SCOUT_MAX_AGE} 岁前打到宗师以上，有概率被青训教练私信；试训通过就换这条路。天赋、现金、人气、黑历史都带进来。</p></div>
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
        <button class="btn btn-primary" id="btn-year" style="margin-top:12px">${p.year === 0 ? '开始职业生涯 · 一路滚到退役' : `从第 ${p.year + 1} 年继续 · 一路滚到退役`}</button>
      </div>
      ${formBar(proAge(p))}
      <div class="section"><div class="label">履历</div>${historyLedger()}</div>`
  }

  app.innerHTML = `<div class="reveal">${top.html}${body}</div>`
  top.bind()
  $('btn-year')?.addEventListener('click', startProRun)
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
  set('pro-res', `<span>现金 <b class="num ${meta.cash < 0 ? 'lose' : ''}">${fmt(meta.cash)}</b></span><span>人气 <b class="num">${fmt(p.fame)}</b></span><span>冠军 <b class="num">${p.titles.regional}</b></span><span>国际赛 <b class="num">${p.titles.intl}</b></span>${p.titles.fmvp ? `<span>FMVP <b class="num">${p.titles.fmvp}</b></span>` : ''}${p.suspended ? `<span class="ban">禁赛 ${p.suspended}</span>` : ''}`)
  const bar = $('pro-bar')
  if (bar) bar.style.width = `${(p.stageAt / 3) * 100}%`
}

/** 从当前年开始一路滚到退役。每滚完一年自动写档，刷新后从最近一年年初接着滚 */
function startProRun() {
  stopTimer()
  stopProTimer()
  proPaused = false
  fastForward = false
  const p = meta.pro
  proSavedYear = p.year
  beginCareerRun(meta)
  app.innerHTML = `
    <div class="top">
      <h2 id="pro-title"></h2>
      <div class="actions"><button class="btn btn-sm" id="btn-pro-pause">暂停</button></div>
    </div>
    <div class="stat" id="pro-meta"></div>
    <div class="stat" id="pro-res" style="margin-top:6px"></div>
    <div class="bar"><i id="pro-bar" style="width:0%"></i></div>
    <div class="tip" style="margin-bottom:16px">OWCS 中国赛区 · ${p.year === 0 ? '新人' : `第 ${p.year + 1} 年起`} · 签约到退役一路滚完${meta.manual ? ' · 点赛程推进' : ''}</div>
    <div class="log-cols">
      <div class="log-col"><div class="label">赛程</div><div class="log-box" id="pro-log"></div></div>
      <div class="log-col"><div class="label">高光</div><div class="log-box" id="pro-hl"></div></div>
    </div>
    <div class="mask" id="pro-pause" hidden>
      <div class="mask-box">
        <div class="mask-title">暂停</div>
        <button class="btn btn-primary" id="btn-pro-resume">继续</button>
        <button class="btn" id="btn-pro-ff">${fastForward ? '取消快进' : '快进'}</button>
        <button class="btn btn-danger" id="btn-pro-exit">退出（回到最近一年年初）</button>
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
  if (meta.manual) $('pro-log')!.onclick = () => { if (!proPaused) tickPro() }
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
  // 滚过一年就落盘一次：刷新只丢当前这一年
  if (meta.pro.year !== proSavedYear) { proSavedYear = meta.pro.year; writeMeta(meta) }
  if (r === 'done') { stopProTimer(); proTimer = window.setTimeout(renderProSettle, 1200); return }
  if (!meta.manual) proTimer = window.setTimeout(tickPro, fastForward ? intervalMs() : intervalMs() * 3)
}

/** 生涯结算：一辈子的职业路走完了 */
function renderProSettle() {
  stopProTimer()
  fastForward = false
  const p = meta.pro
  writeMeta(meta)
  const newAch = p.highlights.filter((l) => l.cls === 'ach').map((l) => l.text.replace(/^成就【|】$/g, ''))
  const big = (l: LogLine) => l.cls === 'ending' || l.cls === 'ban' || l.cls === 'ach'
  const hl = [...p.highlights.filter(big), ...p.highlights.filter((l) => !big(l))].slice(0, 14)
  const titles = [
    p.titles.regional ? `地区冠军 ×${p.titles.regional}` : '',
    p.titles.intl ? `国际赛前二 ×${p.titles.intl}` : '',
    p.titles.world ? `国际赛冠军 ×${p.titles.world}` : '',
    p.titles.fmvp ? `FMVP ×${p.titles.fmvp}` : '',
    p.titles.worldCup ? `国家队 ×${p.titles.worldCup}` : '',
  ].filter(Boolean).join(' · ')
  app.innerHTML = `<div class="reveal">
    <div class="sub" style="margin:0 0 6px">职业生涯 · ${p.yearsPlayed} 年 · ${p.age} 岁</div>
    <div class="rank-hero" style="text-align:center;font-size:2rem"><span class="career">${p.ending ? p.ending.title : '退役'}</span></div>
    <div class="stat" style="justify-content:center;margin-top:6px">
      <span>人气 <span class="num">${fmt(p.fame)}</span></span>
      <span>现金 <span class="num ${meta.cash < 0 ? 'lose' : ''}">${fmt(meta.cash)}</span></span>
      <span>职业收入 <span class="num">${fmt(p.income)}</span></span>
    </div>
    <div class="rule-brass"></div>
    ${p.ending ? `<div class="section ending-card">
        <h2>${p.ending.title}</h2>
        <div class="tip">${p.ending.rankLabel}</div>
        ${p.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}
      </div>` : ''}
    ${titles ? `<div class="section"><div class="label">荣誉</div><p class="tip" style="color:var(--brass)">${titles}</p></div>` : ''}
    ${newAch.length ? `<div class="section"><div class="label">新成就</div>${newAch.map((name) => { const a = ACHIEVEMENTS.find((x) => x.name === name); return `<div class="ach-row got pro"><b>${name}</b><span>${a?.desc ?? ''}</span></div>` }).join('')}</div>` : ''}
    ${p.endExp != null ? expCard(p.endExp, p.endUps ?? 0) : ''}
    <div class="section" style="padding-bottom:6px">
      <button class="btn btn-primary" id="again">再来一辈子 · 摇天赋</button>
      <button class="btn" id="home">回首页</button>
    </div>
    ${hl.length ? `<div class="section"><div class="label">生涯高光</div>${hl.map((l) => `<div class="hl ${l.cls}">${l.text}</div>`).join('')}</div>` : ''}
    <div class="section"><div class="label">履历</div>${historyLedger(30)}</div>
    <div class="section"><div class="label">赛程</div><div class="log-box" id="pro-log" style="max-height:40vh"></div></div>
  </div>`
  appendTo('pro-log', p.log)
  $('again')?.addEventListener('click', startLife)
  $('home')!.onclick = renderHome
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
      <p class="tip" style="color:var(--bone)">天赋开局摇一档，一辈子不变，决定隐藏实力涨多快。极小概率会在天赋之外再摇到一个隐藏天赋——摇到了你会知道，它有自己的结局。每个大段之间有一道墙：实力顶到墙就要过检定，过不去就卡在 X1·9x——差一分的那种。卡久了会自己想办法：换英雄池、找人复盘，都是事件。</p>
    </div>
    <div class="section">
      <div class="label">系统控分</div>
      <p class="tip" style="color:var(--bone)">段位跟着实力慢慢走。实力高于段位时系统欠你分（逆风局 / 安慰奖），低于时段位虚高（预期 / 大逆转）。每年软重置一次重新定级。</p>
    </div>
    <div class="section">
      <div class="label">被发掘</div>
      <p class="tip" style="color:var(--bone)">${SCOUT_MAX_AGE} 岁前打到宗师以上，有概率收到青训教练的私信。试训前有背调，账号干净才好过。通过就单开一段职业生涯：OWCS 中国赛区，从签约一路滚到退役，签约、转会、板凳、审查、热搜全是事件，不用你点。</p>
    </div>
    <div class="section">
      <div class="label">黑市</div>
      <p class="tip" style="color:var(--bone)">热情快见底又卡在墙上时，会有人私信你。你会怎么选，也是摇的——环境越脏、手头越有钱，越容易走歪；整个游戏没有任何要你点的抉择。代练能过墙，但留下记录：天梯里可能被封 30 天，职业里被翻出来就是禁赛解约，还连累下几辈子。开挂过墙最容易，但几季之内必被永封，从那一刻起这辈子的成就不再计入。</p>
    </div>
    <div class="section">
      <div class="label">经验与等级</div>
      <p class="tip" style="color:var(--bone)">每辈子结束按最高段位给经验，进职业、拿冠军再加。升级所需经验一级比一级多一点。每一级、每一个成就，都让下辈子摇到天才 / 怪物的概率高一点——不多，但一直在长。成就总数攒到 10 / 20 / 30 / 40 / 50 个，各解锁一个下辈子永久带着的 buff（成就页有明细）。</p>
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

// 直达入口（分享链接 / 调试）：?go=play|ach|about|pro
{
  const go = new URLSearchParams(location.search).get('go')
  if (go === 'play') startLife()
  else if (go === 'ach') renderAchievements()
  else if (go === 'pro' || go === 'career') renderPro()
  else if (go === 'about') renderAbout()
}
