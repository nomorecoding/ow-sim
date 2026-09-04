import './style.css'
import type { HiddenTalent, LifeState, LogLine, MetaSave, RankState, TalentTier, Team } from './types'
import {
  ACH_PERKS, DEFAULT_SPEED, FORM_INFO, HIDDEN_INFO, INTL_NAME, LIFE_TICK_MS, MAJOR_NAME, MAX_SPEED, MIN_SPEED, PRO_TICK_RATIO, QUIT_AGE, RANK_COLOR_CLASS, SCOUT_MAX_AGE,
  PRO_LEVELS, PRO_LEVEL_CLASS, PRO_TALENT_INFO, STAGE_INFO, START_AGE, TALENT_INFO, TALENT_ORDER, TALENT_SHIFT_CAP, TALENT_SHIFT_PER, TEAM_TIER_CLASS, topPlace,
} from './data/constants'
import { ACHIEVEMENTS, ACH_MAP } from './data/achievements'
import { levelNeed, talentProbs, talentShift } from './data/talent'
import { achCount, beginLife, chooseDark, clearAllSaves, commitLife, createLife, currentShift, freshMeta, hardResetMeta, lifeStep, loadMeta, writeMeta } from './sim/life'
import { clamp, scoreToRank } from './sim/rank'
import { beginCareerRun, careerInProgress, exposureP, proStep, retireNow, teamOf, teamRating } from './sim/pro'

import { teamLogoDataUri } from './data/teamLogos'

const fmt = (n: number) => n.toLocaleString()
const DEBUG = new URLSearchParams(location.search).has('debug')
const teamLogoUrl = (file: string) => teamLogoDataUri(file) ?? `${import.meta.env.BASE_URL}teams/${file}`

/** 队名徽章：logo + 队名，边框按档位越来越炫；外援挂角标 */
function teamBadge(t: Team | null) {
  if (!t) return `<div class="team-badge tm-free"><span class="tb-name">自由人</span></div>`
  const tag = t.region !== 'cn' ? '<em class="tb-tag">外援</em>' : ''
  return `<div class="team-badge ${TEAM_TIER_CLASS[t.tier]}">
    <img class="tb-logo" src="${teamLogoUrl(t.logo)}" alt="" width="36" height="36" decoding="async" />
    <div class="tb-text"><b class="tb-name">${t.name}</b>${tag}</div>
  </div>`
}
const meta = loadMeta()
if (typeof meta.speed !== 'number') meta.speed = DEFAULT_SPEED
if (typeof meta.manual !== 'boolean') meta.manual = false

/** 原地换成新档（保留同一个 meta 引用，方便全站共用） */
function replaceMeta(next: MetaSave) {
  for (const k of Object.keys(meta as object)) delete (meta as unknown as Record<string, unknown>)[k]
  Object.assign(meta, next)
}

/* ———————————— 外观主题 ———————————— */
const THEMES = [
  { id: 'arena', name: '赛场', desc: '深蓝黑 · 亮橙 · 粗黑体切角（默认）' },
  { id: 'dossier', name: '档案', desc: '黑曜石 · 古铜 · 宋体' },
  { id: 'paper', name: '报纸', desc: '米白纸 · 墨字 · 红章' },
]
function currentTheme() {
  const q = new URLSearchParams(location.search).get('theme')
  const raw = (q && THEMES.some((t) => t.id === q)) ? q : (meta.theme ?? 'arena')
  // 旧档若选了已下架主题，回落到赛场
  const id = THEMES.some((t) => t.id === raw) ? raw : 'arena'
  if (meta.theme && meta.theme !== id && !THEMES.some((t) => t.id === meta.theme)) {
    meta.theme = id
    writeMeta(meta)
  }
  return id
}
function applyTheme() {
  document.documentElement.dataset.theme = currentTheme()
}
applyTheme()

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

/** 一行滚多久：基准 ×1 = 0.1s；职业再乘系数 */
function speedScale() { return clamp(meta.speed || DEFAULT_SPEED, MIN_SPEED, MAX_SPEED) }
function tickMs(kind: 'life' | 'pro') {
  if (fastForward) return 30
  const base = LIFE_TICK_MS * speedScale()
  return Math.round(kind === 'life' ? base : base * PRO_TICK_RATIO)
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
  if (r.major === 'top') return `<span class="${cls}"><span class="cn">${MAJOR_NAME[r.major]}</span> <span class="num" style="font-size:0.6em;opacity:0.7">第</span><span class="num">${topPlace(r.rp)}</span><span class="num" style="font-size:0.6em;opacity:0.7">名</span></span>`
  return `<span class="${cls}"><span class="cn">${MAJOR_NAME[r.major]}</span><span class="num">${r.div}</span> <span class="num" style="font-size:0.6em;opacity:0.7">${r.rp}</span></span>`
}

function rankInline(r: RankState) {
  if (r.major === 'top') return `<span class="${RANK_COLOR_CLASS[r.major]}">${MAJOR_NAME[r.major]} · 第 ${topPlace(r.rp)} 名</span>`
  return `<span class="${RANK_COLOR_CLASS[r.major]}">${MAJOR_NAME[r.major]}${r.div} · ${r.rp}</span>`
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

/* ———————————— 成就横幅：右下角小条叠层，不挡玩法，自动淡出 ———————————— */

type AchLike = { id: string; name: string; desc: string; honor?: boolean; secret?: boolean }
const achWeight = (a: AchLike) => (a.secret ? 3 : a.honor ? 2 : 1)
let bannerShownLife = 0
let bannerShownPro = 0
let bannerStackEl: HTMLElement | null = null

function ensureBannerStack() {
  if (bannerStackEl && document.body.contains(bannerStackEl)) return bannerStackEl
  bannerStackEl = document.createElement('div')
  bannerStackEl.id = 'ach-banner-stack'
  bannerStackEl.className = 'ach-banner-stack'
  document.body.appendChild(bannerStackEl)
  return bannerStackEl
}

function queueBanner(list: AchLike[]) {
  if (!list.length) return
  const stack = ensureBannerStack()
  const sorted = [...list].sort((a, b) => achWeight(b) - achWeight(a))
  for (const a of sorted) {
    const w = achWeight(a)
    const el = document.createElement('div')
    el.className = `ach-toast w${w}`
    el.innerHTML = `<b>${a.name}</b><span>${w === 3 ? '隐藏' : w === 2 ? '荣誉' : '成就'}</span>`
    stack.appendChild(el)
    while (stack.children.length > 4) stack.firstElementChild?.remove()
    window.setTimeout(() => el.classList.add('show'), 10)
    const stay = fastForward ? 500 : w === 3 ? 2200 : w === 2 ? 1600 : 1200
    window.setTimeout(() => {
      el.classList.remove('show')
      window.setTimeout(() => el.remove(), 320)
    }, stay)
  }
}

/** 人生里新解锁的成就 → 横幅 */
function bannerFromLife() {
  if (!life) return
  if (bannerShownLife < life.newAchievements.length) {
    queueBanner(life.newAchievements.slice(bannerShownLife).map((id) => ACH_MAP[id]).filter(Boolean))
    bannerShownLife = life.newAchievements.length
  }
}

/** 职业里新解锁的成就（高光栏里的「成就【x】」）→ 横幅 */
function bannerFromPro() {
  const hl = meta.pro.highlights
  if (bannerShownPro < hl.length) {
    const list = hl.slice(bannerShownPro).filter((l) => l.cls === 'ach').map((l) => ACHIEVEMENTS.find((a) => a.name === l.text.replace(/^成就【|】$/g, ''))).filter((a): a is AchLike => !!a)
    queueBanner(list)
    bannerShownPro = hl.length
  }
}

const ENDING_NAME: Record<string, string> = {
  banned: '永封', landed: '上岸', dark_scorn: '万人唾弃', dark_delta: '天赋带到三角洲', dark_shame: '羞愧里终老',
  lifetime_ban: '终身禁赛', fix_ruin: '那笔钱', hell_return: '地狱归来', quit: '回家', legend: '一代传奇',
  world_champion: '世界冠军', regional_king: '赛区名将', evergreen: '常青树', bench: '板凳', journeyman: '打工人',
  aimbot: '人形自走挂', unstuck: '从没卡过', latebloom: '越老越妖', glasshand: '伤仲永',
}
for (const m of Object.keys(MAJOR_NAME) as Array<keyof typeof MAJOR_NAME>) {
  ENDING_NAME[`cloudmud_${m}`] = `云泥之隔 · ${MAJOR_NAME[m]}`
  ENDING_NAME[`quit_${m}`] = `退坑 · ${MAJOR_NAME[m]}`
}

const dirtyN = (g: LifeState) => g.dirty.boostJobs + g.dirty.hires + g.dirty.cheatSeasons

function darkBtnHtml() {
  // 常驻：走过黑暗线也不藏，下辈子还能再点
  return '<button type="button" class="btn btn-danger btn-dark-side" id="btn-dark">堕入黑暗</button>'
}
function bindDarkBtn() {
  $('btn-dark')?.addEventListener('click', () => {
    meta.startDark = true
    meta.darkEntered = true
    meta.darkPrompted = true
    writeMeta(meta)
    startLife()
  })
}
/** 结算页主操作：左边堕入黑暗（次要），右边再来一辈子（主按钮） */
function settleAgainRow(againHtml: string) {
  return `<div class="settle-main">${darkBtnHtml()}${againHtml}</div>`
}

/** 黑暗线 / 职业脏档时给整页加一圈微红光 */
function syncDarkChrome(on?: boolean) {
  const lit = on ?? !!(life?.darkPath || (meta.pro.active && meta.proDark))
  document.documentElement.classList.toggle('path-dark', lit)
}

/** 经验行：Lv · 细条；传 gain 时新加的那截用绿条区分 */
function expLine(level = meta.growth.level, exp = meta.growth.exp, gain = 0) {
  const need = levelNeed(level)
  const pct = clamp((exp / need) * 100, 0, 100)
  let bar: string
  if (gain > 0) {
    const oldPct = clamp((Math.max(0, exp - gain) / need) * 100, 0, pct)
    const newPct = Math.max(0, pct - oldPct)
    bar = `<div class="exp-bar dual"><i class="exp-base" style="width:${oldPct}%"></i><i class="exp-new" style="width:${newPct}%"></i></div>`
  } else {
    bar = `<div class="exp-bar"><i style="width:${pct}%"></i></div>`
  }
  return `<div class="exp-line"><span class="lv">Lv <b class="num">${level}</b></span>${bar}<span class="num tip">${exp}/${need}</span></div>`
}

const pct1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

/**
 * 天赋概率条：一根固定的条，各档占比。
 * 天才 / 怪物分成「底盘」和「加成」两层：加成是成就 + 等级挪过来的那一截，画成亮条，一眼看到多了多少。
 * 传 from 时，条先按旧概率画，下一帧滑到新概率（结算页用）。
 */
function talentStack(shift: number, from?: number) {
  const base = talentProbs(0)
  const now = talentProbs(shift)
  const old = from == null ? now : talentProbs(from)
  const seg = (cls: string, w: number, w0: number, title: string) => `<i class="${cls}" data-w="${w}" style="width:${w0}%" title="${title}"></i>`
  let html = ''
  for (const t of TALENT_ORDER) {
    const ti = TALENT_INFO[t]
    const bonus = Math.max(0, now[t] - base[t])
    if (t === 'genius' || t === 'monster') {
      const b0 = Math.max(0, old[t] - base[t])
      html += seg(ti.cls, Math.min(now[t], base[t]), Math.min(old[t], base[t]), `${ti.name} ${pct1(now[t])}% · ${ti.range}`)
      html += seg(`${ti.cls} bonus`, bonus, b0, `${ti.name} 加成 +${pct1(bonus)}%（成就 + 等级）`)
    } else html += seg(ti.cls, now[t], old[t], `${ti.name} ${pct1(now[t])}% · ${ti.range}`)
  }
  return `<div class="tal-stack${from != null ? ' animate' : ''}">${html}</div>`
}

/** 结算页：把 data-w 目标宽度滑过去 */
function animateStacks() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll<HTMLElement>('.tal-stack.animate i[data-w]').forEach((i) => { i.style.width = `${i.dataset.w}%` })
  }))
}

/* ———————————— 可视化部件：血条 / 资源条 / 飘字 / 天赋牌 / 奖杯柜 ———————————— */

/** 档位：进度条填满这一档 → 下一档，升档爆一下 */
const CASH_TIERS: Array<[number, string]> = [[-Infinity, '负债'], [0, '吃土'], [1000, '零花'], [10000, '小康'], [100000, '富裕'], [1000000, '财务自由']]
const FANS_TIERS: Array<[number, string]> = [[0, '无人问津'], [100, '小圈子'], [1000, '有粉丝'], [10000, '小网红'], [100000, '出圈'], [1000000, '顶流']]
function tierIdx(v: number, tiers: Array<[number, string]>) {
  let i = 0
  for (let k = 1; k < tiers.length; k++) if (v >= tiers[k][0]) i = k
  return i
}
function tierFrac(v: number, tiers: Array<[number, string]>) {
  const i = tierIdx(v, tiers)
  const lo = tiers[i][0] === -Infinity ? 0 : tiers[i][0]
  const hi = tiers[i + 1]?.[0]
  if (hi == null) return 1
  if (v < 0) return clamp(1 - (-v) / Math.max(1000, -lo || 1000), 0, 1)
  return clamp((v - lo) / Math.max(1, hi - lo), 0, 1)
}

const prevTier: Record<string, number> = {}
/** 升档时在条上爆一串粒子 */
function burstAt(el: HTMLElement, kind: 'cash' | 'fans') {
  const box = document.createElement('div')
  box.className = `coin-burst ${kind}`
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('i')
    p.style.setProperty('--a', `${(i / 10) * 360}deg`)
    p.style.setProperty('--d', `${12 + (i % 4) * 6}px`)
    box.appendChild(p)
  }
  el.appendChild(box)
  window.setTimeout(() => box.remove(), 900)
}

/** 钱包 / 人气：一根条 + 档位词；数字只在 title 里 */
function resBar(kind: 'cash' | 'fans', v: number, id: string) {
  const tiers = kind === 'cash' ? CASH_TIERS : FANS_TIERS
  const i = tierIdx(v, tiers)
  const frac = tierFrac(v, tiers)
  const neg = kind === 'cash' && v < 0
  const label = kind === 'cash' ? '钱包' : '人气'
  const word = neg ? `欠 ${fmt(-v)}` : tiers[i][1]
  return `<div class="res-bar ${kind}${neg ? ' neg' : ''} t${i}" id="${id}" title="${fmt(v)}">
    <div class="rb-top"><span class="res-k">${label}</span><span class="res-t">${word}</span></div>
    <div class="rb-track"><i class="rb-fill" style="width:${Math.round(frac * 100)}%"></i></div>
  </div>`
}

function paintRes(kind: 'cash' | 'fans', v: number, id: string) {
  const el = $(id)
  if (!el) return
  const tiers = kind === 'cash' ? CASH_TIERS : FANS_TIERS
  const i = tierIdx(v, tiers)
  const frac = tierFrac(v, tiers)
  const neg = kind === 'cash' && v < 0
  el.className = `res-bar ${kind}${neg ? ' neg' : ''} t${i}`
  el.title = fmt(v)
  const t = el.querySelector('.res-t')
  if (t) t.textContent = neg ? `欠 ${fmt(-v)}` : tiers[i][1]
  const fill = el.querySelector<HTMLElement>('.rb-fill')
  if (fill) fill.style.width = `${Math.round(frac * 100)}%`
  const key = `${id}:${kind}`
  const was = prevTier[key]
  prevTier[key] = i
  if (was != null && i > was) burstAt(el, kind)
}

/** 热情血条 */
function hpBar(id: string) {
  return `<div class="hp" id="${id}"><i class="hp-fill" id="${id}-fill"></i><span class="hp-l">热情</span><span class="hp-r" id="${id}-txt"></span></div>`
}
function setHp(id: string, cur: number, max: number, text: string, prev: number | null) {
  const el = $(id)
  const fill = $(`${id}-fill`)
  if (!el || !fill) return
  const r = clamp(cur / Math.max(1, max), 0, 1)
  fill.style.width = `${r * 100}%`
  el.classList.toggle('lo', r < 0.25)
  el.classList.toggle('mid', r >= 0.25 && r < 0.55)
  $(`${id}-txt`)!.textContent = text
  if (prev != null && prev !== cur) {
    el.classList.remove('hit', 'heal')
    void el.offsetWidth
    el.classList.add(cur < prev ? 'hit' : 'heal')
  }
}

/** 天梯天赋牌 */
function talentPlate(t: TalentTier, hidden: HiddenTalent | null) {
  const ti = TALENT_INFO[t]
  return `<div class="tal-plate ${ti.cls}${hidden ? ' has-h' : ''}">
    <small>天赋</small><b>${ti.name}</b>
    ${hidden ? `<em class="tal-h">${HIDDEN_INFO[hidden].name}</em>` : ''}
  </div>`
}

/** 职业档位牌：蓝领 / 路人王 / 城市天才 / 国一 / GOAT */
function proTalentPlate(t: TalentTier, hidden: HiddenTalent | null) {
  const ti = TALENT_INFO[t]
  const pt = PRO_TALENT_INFO[t]
  return `<div class="tal-plate pro-tier ${ti.cls}${hidden ? ' has-h' : ''}">
    <small>档位</small><b>${pt.name}</b>
    ${hidden ? `<em class="tal-h">${HIDDEN_INFO[hidden].name}</em>` : ''}
  </div>`
}

function levelBonusHtml() {
  const raw = meta.growth.level * TALENT_SHIFT_PER
  if (raw <= 0) return ''
  return `<span class="exp-bonus">等级加成 <b class="num">+${pct1(raw)}%</b></span>`
}

function achBonusHtml() {
  const raw = achCount(meta) * TALENT_SHIFT_PER
  if (raw <= 0) return ''
  const capped = currentShift(meta) >= TALENT_SHIFT_CAP
  return `<span class="exp-bonus">成就加成 <b class="num">+${pct1(raw)}%</b>${capped ? ' · 到顶' : ''}</span>`
}

/** 下辈子职业档位条（跟天梯同一套概率，换名字） */
function proTalentBar() {
  const shift = currentShift(meta)
  const probs = talentProbs(shift)
  const hi = probs.genius + probs.monster
  const segs = TALENT_ORDER.map((t) => {
    const ti = TALENT_INFO[t]
    const pt = PRO_TALENT_INFO[t]
    return `<i class="${ti.cls}" style="width:${probs[t]}%" title="${pt.name} ${pct1(probs[t])}%"></i>`
  }).join('')
  const legend = TALENT_ORDER.map((t) => `<span class="${TALENT_INFO[t].cls}">${PRO_TALENT_INFO[t].name}</span>`).join('')
  return `<div class="section" style="padding-bottom:10px">
    <div class="row" style="border-bottom:0;padding:0 0 8px;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="label" style="margin:0">下辈子职业天花板</span>
      ${expLine()}
      ${levelBonusHtml()}
    </div>
    <div class="tal-stack">${segs}</div>
    <div class="tal-legend">${legend}</div>
    <div class="tal-hi-line">国一 + GOAT <b class="num">${pct1(hi)}%</b></div>
  </div>`
}

/** 奖杯柜 */
const CUP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3c0 2.5-1.8 4.4-4.2 4.9A5 5 0 0 1 13 15.9V18h3v2H8v-2h3v-2.1a5 5 0 0 1-2.8-3C5.8 12.4 4 10.5 4 8V5h3V3zm-1 4v1c0 1.3.8 2.4 2 2.8V7H6zm12 0h-2v3.8c1.2-.4 2-1.5 2-2.8V7z"/></svg>'
const MEDAL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 2h8l-2 6h-4L8 2zm4 7a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 2.5-1.2 2.4-2.6.4 1.9 1.8-.5 2.6L12 17.5l2.4 1.2-.5-2.6 1.9-1.8-2.6-.4L12 11.5z"/></svg>'
const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l2.9 6.6 7.1.7-5.4 4.8 1.6 7L12 17.4 5.8 21l1.6-7L2 9.3l7.1-.7L12 2z"/></svg>'
const FLAG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 2h2v20H5V2zm3 1h11l-2 4 2 4H8V3z"/></svg>'
type TrophyKind = 'regional' | 'intl' | 'world' | 'fmvp' | 'cap' | 'owwc'
const TROPHY_INFO: Record<TrophyKind, { svg: string; name: string; metal: 'gold' | 'silver' | 'bronze' }> = {
  regional: { svg: CUP_SVG, name: '赛区冠军', metal: 'gold' },
  intl: { svg: MEDAL_SVG, name: '国际赛前二', metal: 'silver' },
  world: { svg: CUP_SVG, name: '世界冠军', metal: 'gold' },
  fmvp: { svg: STAR_SVG, name: 'FMVP', metal: 'gold' },
  cap: { svg: FLAG_SVG, name: '国家队', metal: 'bronze' },
  owwc: { svg: CUP_SVG, name: '世界杯冠军', metal: 'gold' },
}
let trophyShown: Record<TrophyKind, number> = { regional: 0, intl: 0, world: 0, fmvp: 0, cap: 0, owwc: 0 }
function trophyCounts(): Record<TrophyKind, number> {
  const t = meta.pro.titles
  return { regional: t.regional, intl: Math.max(0, t.intl - t.world), world: t.world, fmvp: t.fmvp, cap: Math.max(0, t.worldCup - t.owwc), owwc: t.owwc }
}
function renderTrophies(id: string, animate: boolean) {
  const box = $(id)
  if (!box) return
  const now = trophyCounts()
  const order: TrophyKind[] = ['fmvp', 'world', 'owwc', 'intl', 'regional', 'cap']
  let html = ''
  let total = 0
  for (const k of order) {
    for (let i = 0; i < now[k]; i++) {
      total++
      const fresh = animate && i >= (trophyShown[k] ?? 0)
      const metal = TROPHY_INFO[k].metal
      html += `<span class="trophy t-${k} metal-${metal}${fresh ? ' new' : ''}" title="${TROPHY_INFO[k].name}">${TROPHY_INFO[k].svg}</span>`
    }
  }
  box.innerHTML = total ? `<div class="trophy-row">${html}</div>` : ''
  trophyShown = { ...now }
}

/* ———————————— 首页 ———————————— */

/** 下辈子天赋：条 + 等级加成，少废话 */
function talentBar() {
  const shift = currentShift(meta)
  const probs = talentProbs(shift)
  const hi = probs.genius + probs.monster
  const legend = TALENT_ORDER.map((t) => `<span class="${TALENT_INFO[t].cls}">${TALENT_INFO[t].name}</span>`).join('')
  return `<div class="home-tal">
    <div class="home-tal-head">
      <span class="label">投胎</span>
      ${expLine()}
      ${levelBonusHtml()}
      <span class="tal-hi-inline">天才+怪物 <b class="num">${pct1(hi)}%</b></span>
    </div>
    ${talentStack(shift)}
    <div class="tal-legend">${legend}</div>
  </div>`
}

/** 成就奖励：只亮已解锁 + 下一档 */
function perkLine() {
  const n = achCount(meta)
  const got = ACH_PERKS.filter((p) => n >= p.n)
  const next = ACH_PERKS.find((p) => n < p.n)
  if (!got.length && !next && !achBonusHtml()) return ''
  const chips = got.map((p) => `<span class="perk-chip" title="${p.desc}">${p.name}</span>`).join('')
  const nextChip = next ? `<span class="perk-chip next">还差 ${next.n - n} · ${next.name}</span>` : ''
  return `<div class="home-perks">
    <div class="home-perks-head"><span class="label">成就</span><span class="tip">${got.length}/${ACH_PERKS.length}</span>${achBonusHtml()}</div>
    <div class="perk-chips">${chips}${nextChip}</div>
  </div>`
}

function renderHome() {
  stopTimer()
  stopProTimer()
  fastForward = false
  life = null
  syncDarkChrome(false)
  const achN = achCount(meta)
  const p = meta.pro
  const best = meta.bestPeakScore ? rankInline(scoreToRank(meta.bestPeakScore)) : '<span class="sys">—</span>'
  const blockBanner = meta.proBlockLives > 0
    ? `<div class="mute-line on"><span>职业拉黑 · ${meta.proBlockLives} 辈子</span></div>`
    : ''
  const proNow = p.active
    ? `<div class="home-pro">
        ${teamBadge(teamOf(p.teamId))}
        <button class="btn btn-pro btn-gold" id="btn-pro">继续职业生涯</button>
      </div>`
    : ''
  const lastEnd = meta.lastEndingId ? ENDING_NAME[meta.lastEndingId] ?? meta.lastEndingId : ''
  app.innerHTML = `<div class="reveal home">
    <h1>守望天梯人生</h1>
    ${blockBanner}
    <div class="home-hud">
      <div class="hud-cell"><i>人生</i><b class="num">${meta.runs}</b><small>${lastEnd || '尚未开局'}</small></div>
      <div class="hud-cell"><i>峰值</i><b>${best}</b><small>职业 ${meta.scoutedTimes}</small></div>
      <div class="hud-cell"><i>成就</i><b class="num">${achN}<em>/${ACHIEVEMENTS.length}</em></b><small>${meta.bestTalent ? TALENT_INFO[meta.bestTalent].name : '—'}</small></div>
    </div>
    ${talentBar()}
    ${perkLine()}
    ${proNow}
    <div class="home-actions">
      <button class="btn btn-primary" id="btn-start" ${p.active ? 'disabled' : ''}>${p.active ? '先把职业生涯打完' : '开始一段人生'}</button>
      <div class="grid-3">
        <button class="btn" id="btn-ach">成就</button>
        <button class="btn" id="btn-settings">设置</button>
        <button class="btn" id="btn-about">说明</button>
      </div>
      <button class="btn btn-ghost btn-wipe" id="btn-wipe">删档重来</button>
    </div>
  </div>`
  $('btn-start')!.onclick = startLife
  $('btn-pro')?.addEventListener('click', renderPro)
  $('btn-ach')!.onclick = renderAchievements
  $('btn-about')!.onclick = renderAbout
  $('btn-settings')!.onclick = renderSettings
  $('btn-wipe')!.onclick = () => {
    if (!confirm('删档重来：等级、职业生涯、职业拉黑全部清零，成就与结局收集保留。确定？')) return
    const keep = { speed: meta.speed, manual: meta.manual, achievements: meta.achievements, endings: meta.endings, theme: meta.theme }
    clearAllSaves()
    replaceMeta(Object.assign(freshMeta(), keep))
    meta.darkEntered = false
    meta.darkPrompted = false
    meta.startDark = false
    meta.proDark = false
    writeMeta(meta)
    life = null
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
    ['完全重制', () => {
      if (!confirm('完全重制：清空 localStorage 全部存档（成就/结局/等级/黑暗标记全没）。确定？')) return
      replaceMeta(hardResetMeta())
      life = null
      committed = false
      commitResult = null
      renderHome()
    }],
    ['清黑暗标记', () => {
      meta.darkEntered = false
      meta.darkPrompted = false
      meta.startDark = false
      meta.proDark = false
      writeMeta(meta)
      syncDarkChrome(false)
      alert('已清黑暗标记')
    }],
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
    <p class="tip">每个成就都让下辈子摇到天才 / 怪物的概率高 0.1%。攒到下面的档位，还会解锁下辈子永久带着的 buff——前期多打几季、中后期给隐藏天赋和职业高光铺路。✦ 为职业生涯荣誉，？为隐藏。开挂之后这辈子解锁的成就不计。</p>
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
  bannerShownLife = 0
  beginLife(meta, life)
  renderLife()
  tickLife()
}

let hudPrev: { passion: number; cash: number; fans: number } | null = null


function refreshHud() {
  if (!life) return
  const g = life
  const set = (id: string, html: string) => { const el = $(id); if (el) el.innerHTML = html }
  const peak = scoreToRank(g.peakScore)
  set('hud-meta', `<span>S<span class="num">${g.season}</span> · <span class="num">${g.age}</span> 岁 · ${STAGE_INFO[g.stage].name}</span><span>峰值 ${rankInline(peak)}</span><span class="num tip">${fmt(g.gamesTotal)} 把${fastForward ? ' · 快进' : ''}</span>`)
  set('hud-rank', rankHtml(g.rank))
  const per = Math.max(1, STAGE_INFO[g.stage].games)
  const left = Math.floor(g.passion / per)
  setHp('hud-hp', g.passion, g.passionMax, left <= 0 ? '快撑不住了' : `还能打 ${left} 季`, hudPrev?.passion ?? null)
  if (!$('res-cash')) set('hud-res', `${resBar('cash', g.cash, 'res-cash')}${resBar('fans', g.fans, 'res-fans')}`)
  else { paintRes('cash', g.cash, 'res-cash'); paintRes('fans', g.fans, 'res-fans') }
  hudPrev = { passion: g.passion, cash: g.cash, fans: g.fans }
}

function renderLife() {
  if (!life) return
  const g = life
  syncDarkChrome(!!g.darkPath)
  app.innerHTML = `
    <div class="top">
      <h2>天梯人生</h2>
      <div class="actions"><button class="btn btn-sm" id="btn-pause">暂停</button></div>
    </div>
    <div class="stat" id="hud-meta"></div>
    <div class="hero-row">
      ${talentPlate(g.talent, g.hidden)}
      <div class="rank-hero" id="hud-rank"></div>
    </div>
    <div class="tip persona-line">【${g.persona.name}】${g.persona.tagline}</div>
    ${hpBar('hud-hp')}
    <div class="res-row">
      <div class="res-group" id="hud-res"></div>
    </div>
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
  hudPrev = null
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
  if (life.awaitingDark) {
    stopTimer()
    showDarkChoice()
    return
  }
  const r = lifeStep()
  flushLogs()
  refreshHud()
  bannerFromLife()
  if (life.awaitingDark) {
    stopTimer()
    showDarkChoice()
    return
  }
  if (r === 'done') { stopTimer(); timer = window.setTimeout(renderLifeSettle, 1400); return }
  if (!meta.manual) timer = window.setTimeout(tickLife, tickMs('life'))
}

function showDarkChoice() {
  if (document.getElementById('dark-mask')) return
  if (!life?.awaitingDark) return
  const el = document.createElement('div')
  el.id = 'dark-mask'
  el.className = 'mask'
  el.innerHTML = `<div class="mask-box dark-box">
    <div class="mask-title">堕入黑暗？</div>
    <p class="tip" style="color:var(--bone);margin:0 0 12px">只会问这一次。上分更快，被永封 / 职业禁赛的风险也更高。</p>
    <button class="btn btn-danger" id="dark-boost">请代练</button>
    <button class="btn btn-danger" id="dark-cheat">开挂</button>
    <button class="btn" id="dark-no">算了</button>
  </div>`
  document.body.appendChild(el)
  const done = (pick: 'refuse' | 'boost' | 'cheat') => {
    if (!life) return
    chooseDark(life, pick)
    meta.darkPrompted = true
    if (pick !== 'refuse') meta.darkEntered = true
    writeMeta(meta)
    el.remove()
    flushLogs()
    refreshHud()
    if (!meta.manual) tickLife()
  }
  $('dark-boost')!.onclick = () => done('boost')
  $('dark-cheat')!.onclick = () => done('cheat')
  $('dark-no')!.onclick = () => done('refuse')
}

/* ———————————— 人生结算 ———————————— */

/**
 * 结算里的成长卡：经验 +N、升级，然后是下辈子的天赋条从旧概率滑到新概率。
 * 天才 / 怪物的加成那一截变宽 = 这辈子攒下来的东西。
 */
function expCard(exp: number, ups: number, achBefore: number) {
  const levelBefore = meta.growth.level - ups
  const shiftBefore = talentShift(achBefore, levelBefore)
  const shiftNow = currentShift(meta)
  const pb = talentProbs(shiftBefore)
  const pn = talentProbs(shiftNow)
  const hiB = pb.genius + pb.monster
  const hiN = pn.genius + pn.monster
  const delta = Math.round((hiN - hiB) * 10) / 10
  const legend = TALENT_ORDER.map((t) => `<span class="${TALENT_INFO[t].cls}">${TALENT_INFO[t].name}</span>`).join('')
  const lvHtml = ups
    ? `<span class="lv-jump"><span class="num">Lv ${levelBefore}</span><span class="arrow">→</span><span class="num up">Lv ${meta.growth.level}</span></span>`
    : `<span class="lv-jump"><span class="num">Lv ${meta.growth.level}</span></span>`
  return `<div class="section grow-card">
    <div class="row" style="border-bottom:0;padding:0 0 8px">
      <span class="label" style="margin:0">经验 <b class="exp-gain">+${exp}</b>${ups ? ` <span class="win">升 ${ups} 级</span>` : ''}</span>
      ${expLine(meta.growth.level, meta.growth.exp, exp)}
    </div>
    <div class="grow-row">
      ${lvHtml}
      <span class="grow-hi">天才 + 怪物 <b class="num">${pct1(hiB)}%</b><span class="arrow">→</span><b class="num ${delta > 0 ? 'up' : ''}">${pct1(hiN)}%</b>${delta > 0 ? `<span class="delta">+${pct1(delta)}%</span>` : ''}</span>
    </div>
    ${talentStack(shiftNow, shiftBefore)}
    <div class="tal-legend">${legend}</div>
  </div>`
}

/** 路人评论：弹幕 / 贴吧 / 队友视角的几句话，按这辈子的数据挑 */
function crowdTalk(g: LifeState, toPro: boolean): Array<{ who: string; text: string }> {
  const peak = scoreToRank(g.peakScore)
  const m = peak.major
  const pool: Array<{ who: string; text: string; w: number }> = []
  const add = (who: string, text: string, w = 1) => pool.push({ who, text, w })
  const hi = m === 'gm' || m === 'champ' || m === 'top'
  const low = m === 'bronze' || m === 'silver' || m === 'gold'
  if (toPro) add('弹幕', '以后看比赛能说「这人我加过好友」了。', 3)
  if (g.banned) { add('官方公告', '账号因使用第三方程序被永久封禁。', 3); add('你队友', '就说他有问题，那枪法根本不像人。', 2) }
  if (hi) { add('贴吧老哥', '这段位还打天梯？去打职业啊。', 2); add('路人', '宗师大佬带带我，我可以当挂件。') }
  if (m === 'top') add('主播', '500 强榜上有个眼熟的 ID……哦是你。', 2)
  if (low) { add('贴吧老哥', '黄金以下都是一个段位，别争了。'); add('你队友', '你是不是用脚打的？') }
  if (g.stuckTotal >= 8) add('弹幕', `X1·99 卡了 ${g.stuckTotal} 季，实力就在那儿了，别挣扎。`, 2)
  if (g.stuckTotal === 0 && g.season >= 12) add('路人', '从来没卡过分？账号租出去了吧。', 2)
  if (g.dirty.hires) add('贴吧老哥', '陪玩上的分早晚掉回去，这个我熟。')
  if (g.dirty.boostJobs) add('买家', '师傅，号什么时候能打完？我还等着炫。')
  if (g.fans >= 50000) add('粉丝', '开播吧，我们真的会看。', 2)
  else if (g.fans >= 5000) add('粉丝', '你那个集锦我转了三遍。')
  if (g.talent === 'monster' || g.talent === 'genius') add('你队友', '这就是天赋碾压，我练十年也打不出这枪。', 2)
  if (g.talent === 'barrel') add('你队友', '操作是真的没有，意识倒是挺好。')
  if (g.injured) add('你妈', '手都这样了还打？')
  if (g.cash < 0) add('你妈', `欠着 ${fmt(-g.cash)}，游戏删了没？`, 2)
  if (g.ending?.id.startsWith('cloudmud')) add('路人', '差一分上大段。这游戏是不是故意的？', 2)
  if (g.ending?.id.startsWith('quit')) add('你队友', '删了好。删了就是上岸。')
  if (g.tally.verified) add('官方', '经人工复核，该账号无违规行为。', 3)
  if (g.hidden === 'late') add('弹幕', '这人越老越妖，什么情况。')
  if (!pool.length) add('路人', '路过，什么都没发生。')
  // 权重高的先挑，最多三条，其余随机
  pool.sort((a, b) => b.w - a.w || Math.random() - 0.5)
  return pool.slice(0, 3).map(({ who, text }) => ({ who, text }))
}

/** 年表：高光按年龄分组 */
function lifeTimeline(g: LifeState) {
  const groups = new Map<number, LogLine[]>()
  for (const l of g.highlights) {
    const at = l.at ?? g.age
    if (!groups.has(at)) groups.set(at, [])
    groups.get(at)!.push(l)
  }
  if (!groups.size) return ''
  const rows = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([age, ls]) => `<div class="tl-row">
    <div class="tl-age"><span class="num">${age}</span><small>岁</small></div>
    <div class="tl-body">${ls.slice(0, 4).map((l) => `<div class="hl ${l.cls}">${l.text}</div>`).join('')}</div>
  </div>`).join('')
  return `<div class="section"><div class="label">年表</div><div class="tl">${rows}</div></div>`
}

/** 新成就：隐藏 > 荣誉 > 普通排前面，隐藏和荣誉做大卡 */
function newAchCards(list: AchLike[]) {
  if (!list.length) return ''
  const sorted = [...list].sort((a, b) => achWeight(b) - achWeight(a))
  return `<div class="section"><div class="label">新成就 · ${sorted.length}</div>
    ${sorted.map((a) => { const w = achWeight(a); return `<div class="ach-row got ${w === 3 ? 'secret big' : w === 2 ? 'pro big' : ''}"><b>${a.name}</b><span>${a.desc}</span></div>` }).join('')}
  </div>`
}

let commitAchBefore = 0

function renderLifeSettle() {
  if (!life) return
  const g = life
  stopTimer()
  fastForward = false
  if (!committed) {
    committed = true
    commitAchBefore = achCount(meta)
    commitResult = commitLife(g, meta)
    writeMeta(meta)
  }
  const toPro = commitResult?.toPro ?? g.scouted

  const peak = scoreToRank(g.peakScore)
  const real = scoreToRank(g.peakMmr)
  const newAch = g.newAchievements.map((id) => ACH_MAP[id]).filter(Boolean)
  const talk = crowdTalk(g, toPro)
  const years = g.age - START_AGE

  const isDark = !!g.darkPath
  const darkBan = isDark && !!(g.banned || g.ending?.id === 'dark_scorn')
  syncDarkChrome(isDark)
  const darkTitle = g.ending?.title ?? (darkBan ? '万人唾弃' : '黑暗线退坑')
  const endingCard = g.ending ? `<div class="section ending-card${isDark ? ' dark-end' : ''}">
        <h2>${g.ending.title}</h2>
        <div class="tip">${g.ending.rankLabel}</div>
        ${g.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}
      </div>` : ''

  const head = isDark
    ? `<div class="dark-banner${darkBan ? ' stamped' : ''}">
        ${darkBan ? '<div class="dark-stamp">永久封停</div>' : '<div class="dark-stamp soft">黑暗线</div>'}
        <div class="sub">黑暗线 · ${g.age} 岁${darkBan ? ' · 永封' : ''}</div>
        <div class="rank-hero"><span class="ban">${darkTitle}</span></div>
        ${darkBan ? '<div class="dark-id">该账号因使用第三方程序被永久封停 · 申诉入口是灰的</div>' : '<div class="dark-id">捷径走完了。档案上多了一笔洗不掉的记录。</div>'}
      </div>`
    : toPro
    ? `<div class="sub" style="margin:0 0 6px">试训通过 · ${g.age} 岁</div>
       <div class="rank-hero" style="text-align:center;font-size:2rem"><span class="career">进入职业生涯</span></div>`
    : `<div class="sub" style="margin:0 0 6px">${START_AGE} → ${g.age} 岁 · 打了 ${years} 年 · ${g.banned ? '<span class="ban">永封</span>' : '退坑'}</div>
       <div class="rank-hero" style="text-align:center;font-size:2.8rem">${rankHtml(peak)}</div>`

  app.innerHTML = `<div class="reveal${isDark ? ' dark-settle' : ''}">
    ${head}
    <div class="stat" style="justify-content:center;margin-top:6px">
      <span>${talentBadge(g.talent, g.hidden)}</span>
      <span>真实峰值 ${rankInline(real)}</span>
      <span>${g.season} 季 · ${fmt(g.gamesTotal)} 把</span>
      ${dirtyN(g) ? `<span class="ban">黑历史 ${dirtyN(g)}</span>` : ''}
    </div>
    ${isDark ? endingCard : ''}
    <div class="btn-row settle-next">
      ${!toPro
        ? settleAgainRow('<button class="btn btn-primary" id="again">再来一辈子 · 摇天赋</button>')
        : '<button class="btn btn-pro btn-gold" id="go-pro">进入职业生涯</button>'}
      <button class="btn" id="home">回首页</button>
    </div>
    ${commitResult ? expCard(commitResult.exp, commitResult.ups, commitAchBefore) : ''}
    <div class="rule-brass"></div>
    ${toPro ? `<div class="section ending-card">
        <h2>有人找你</h2>
        <div class="tip">${g.age} 岁 · ${rankInline(g.rank)}</div>
        <div class="verse">教练说：「下周来报到。」天梯到此为止，接下来是 OWCS。</div>
        <div class="verse">这辈子的天赋会带进去：${TALENT_INFO[g.talent].name}。现金、人气、${dirtyN(g) ? '<span class="warn">还有黑历史</span>' : '干净的档案'}也一起。</div>
      </div>` : ''}
    ${!isDark ? endingCard : ''}
    <div class="dossier four">
      <div class="cell"><div class="label">钱包</div><div>${resBar('cash', g.cash, 'settle-cash')}</div></div>
      <div class="cell"><div class="label">人气</div><div>${resBar('fans', g.fans, 'settle-fans')}</div></div>
      <div class="cell"><div class="label">卡分</div><div class="num">${g.stuckTotal}</div><small>季</small></div>
      <div class="cell"><div class="label">阶段</div><div style="font-family:var(--display);font-size:1rem;line-height:1.5">${STAGE_INFO[g.stage].name}</div><small>${g.persona.name}${dirtyN(g) ? ` · 黑历史 ${dirtyN(g)}` : ''}</small></div>
    </div>
    <div class="section crowd">
      <div class="label">他们怎么说</div>
      ${talk.map((c) => `<div class="crowd-row"><span class="who">${c.who}</span><span class="say">${c.text}</span></div>`).join('')}
    </div>
    ${newAchCards(newAch)}
    ${lifeTimeline(g)}
    <div class="section"><div class="label">人生</div><div class="log-box" id="log-box" style="max-height:40vh"></div></div>
  </div>`
  appendTo('log-box', g.logs)
  animateStacks()
  $('again')?.addEventListener('click', startLife)
  bindDarkBtn()
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
  syncDarkChrome(!!(meta.pro.active && meta.proDark))
  const p = meta.pro
  const top = pageTop('职业生涯', renderHome)
  const t = teamOf(p.teamId)
  const titles = `地区冠军 ${p.titles.regional} · 国际赛前二 ${p.titles.intl}${p.titles.world ? ` · 国际赛冠军 ${p.titles.world}` : ''}${p.titles.fmvp ? ` · FMVP ${p.titles.fmvp}` : ''}${p.titles.worldCup ? ` · 国家队 ${p.titles.worldCup}` : ''}${p.titles.owwc ? ` · 世界杯冠军 ${p.titles.owwc}` : ''}`
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
        <div class="cell"><div class="label">队伍</div><div style="margin:4px 0">${teamBadge(t)}</div><small>${t ? `底子 ${teamRating(t)}` : '年初等报价'}</small></div>
        <div class="cell"><div class="label">人气</div><div class="num">${fmt(p.fame)}</div><small>现金 ${fmt(meta.cash)}</small></div>
      </div>
      <div class="section">
        <p class="tip" style="color:var(--bone)">${titles}${p.suspended ? ` · <span class="ban">禁赛剩 ${p.suspended} 个 Stage</span>` : ''}</p>
        <p class="tip" style="margin-top:6px">背调档案：${dirtyText}</p>
        <button class="btn btn-primary" id="btn-year" style="margin-top:12px">${p.year === 0 ? '开始职业生涯' : `从第 ${p.year + 1} 年继续`}</button>
        ${p.year > 0 ? '<button class="btn btn-danger" id="btn-retire">现在退役</button>' : ''}
      </div>
      ${proTalentBar()}
      <div class="section"><div class="label">履历</div>${historyLedger()}</div>`
  }

  app.innerHTML = `<div class="reveal">${top.html}${body}</div>`
  top.bind()
  $('btn-year')?.addEventListener('click', startProRun)
  $('btn-retire')?.addEventListener('click', () => {
    if (!confirm('现在退役：按目前的履历结算，不能反悔。确定？')) return
    retireNow(meta)
    renderProSettle()
  })
  mountDebug()
}

function proLogs() {
  const p = meta.pro
  if (proShownLog < p.log.length) { appendTo('pro-log', p.log.slice(proShownLog)); proShownLog = p.log.length }
  if (proShownHl < p.highlights.length) { appendTo('pro-hl', p.highlights.slice(proShownHl)); proShownHl = p.highlights.length }
}

/** 五格实力条 */
function proHud() {
  const p = meta.pro
  const set = (id: string, html: string) => { const el = $(id); if (el) el.innerHTML = html }
  const t = teamOf(p.teamId)
  const fi = FORM_INFO[p.form]
  const talent = p.talent ?? 'normal'
  set('pro-title', teamBadge(t))
  set('pro-meta', `<span>第 <span class="num">${p.year + 1}</span> 年 · <span class="num">${p.age}</span> 岁 · ${p.stageAt ? `Stage <span class="num">${p.stageAt}</span>/3` : '年初'}</span><span>峰值 <span class="${PRO_LEVEL_CLASS[p.peakLevel]}">${PRO_LEVELS[p.peakLevel]}</span></span>${p.suspended ? `<span class="ban">禁赛 ${p.suspended}</span>` : ''}`)
  set('pro-level', `<span class="${PRO_LEVEL_CLASS[p.level]}"><span class="cn">${PRO_LEVELS[p.level]}</span></span><small class="lv-note">${p.lvNote || ''}</small>`)
  set('pro-side', `${proTalentPlate(talent, p.hidden ?? null)}<span class="form-chip ${fi.cls}">${fi.name}</span>`)
  renderTrophies('pro-trophies', true)
  if (!$('pres-cash')) set('pro-res', `${resBar('cash', meta.cash, 'pres-cash')}${resBar('fans', p.fame, 'pres-fans')}`)
  else { paintRes('cash', meta.cash, 'pres-cash'); paintRes('fans', p.fame, 'pres-fans') }
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
  bannerShownPro = p.highlights.length
  trophyShown = { regional: 0, intl: 0, world: 0, fmvp: 0, cap: 0, owwc: 0 }
  app.innerHTML = `
    <div class="top team-top">
      <div id="pro-title"></div>
      <div class="actions"><button class="btn btn-sm" id="btn-pro-pause">暂停</button></div>
    </div>
    <div class="stat" id="pro-meta"></div>
    <div class="rank-hero" id="pro-level"></div>
    <div class="pro-side" id="pro-side"></div>
    <div class="trophies" id="pro-trophies"></div>
    <div class="res-row"><div class="res-group" id="pro-res"></div></div>
    <div class="bar"><i id="pro-bar" style="width:0%"></i></div>
    <div class="tip" style="margin-bottom:10px">OWCS 中国赛区${meta.manual ? ' · 点赛程推进' : ''}</div>
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
  else proTimer = window.setTimeout(tickPro, tickMs('pro'))
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
  bannerFromPro()
  // 滚过一年就落盘一次：刷新只丢当前这一年
  if (meta.pro.year !== proSavedYear) { proSavedYear = meta.pro.year; writeMeta(meta) }
  if (r === 'done') { stopProTimer(); proTimer = window.setTimeout(renderProSettle, 1200); return }
  if (!meta.manual) proTimer = window.setTimeout(tickPro, tickMs('pro'))
}

/** 生涯结算：一辈子的职业路走完了 */
function renderProSettle() {
  stopProTimer()
  fastForward = false
  const p = meta.pro
  writeMeta(meta)
  const newAch = p.highlights.filter((l) => l.cls === 'ach').map((l) => ACHIEVEMENTS.find((a) => a.name === l.text.replace(/^成就【|】$/g, ''))).filter((a): a is AchLike => !!a)
  const big = (l: LogLine) => l.cls === 'ending' || l.cls === 'ban' || l.cls === 'ach'
  const hl = [...p.highlights.filter(big), ...p.highlights.filter((l) => !big(l))].slice(0, 14)
  trophyShown = { regional: 0, intl: 0, world: 0, fmvp: 0, cap: 0, owwc: 0 }
  const shame = !!(p.lifetimeBan || !p.clean || p.ending?.id === 'lifetime_ban' || p.ending?.id === 'fix_ruin')
  const banHard = !!(p.lifetimeBan || p.ending?.id === 'lifetime_ban' || p.ending?.id === 'fix_ruin')
  syncDarkChrome(shame)
  const title = p.ending?.title ?? '退役'
  const head = shame
    ? `<div class="dark-banner${banHard ? ' stamped' : ''}">
        <div class="dark-stamp${banHard ? '' : ' soft'}">${banHard ? '永久封停' : '背调不过'}</div>
        <div class="sub">职业生涯 · ${p.yearsPlayed} 年 · ${p.age} 岁</div>
        <div class="rank-hero"><span class="ban">${title}</span></div>
        <div class="dark-id">${banHard ? (p.banReason || '该选手被永久禁止参加 OWCS 及其附属赛事。') : '共享账号 / 代练记录被翻了出来。这个赛区记住你了。'}</div>
      </div>`
    : `<div class="sub" style="margin:0 0 6px">职业生涯 · ${p.yearsPlayed} 年 · ${p.age} 岁</div>
       <div class="rank-hero" style="text-align:center;font-size:2rem"><span class="career">${title}</span></div>`
  const endingCard = p.ending ? `<div class="section ending-card${shame ? ' dark-end' : ''}">
        <h2>${p.ending.title}</h2>
        <div class="tip">${p.ending.rankLabel}</div>
        ${p.ending.verse.map((v) => `<div class="verse">${v}</div>`).join('')}
      </div>` : ''
  app.innerHTML = `<div class="reveal${shame ? ' dark-settle' : ''}">
    ${head}
    <div class="trophies settle-cups" id="settle-trophies"></div>
    ${shame ? endingCard : ''}
    <div class="btn-row settle-next">
      ${settleAgainRow('<button class="btn btn-primary" id="again">再来一辈子 · 摇天赋</button>')}
      <button class="btn" id="home">回首页</button>
    </div>
    <div class="rule-brass"></div>
    ${!shame ? endingCard : ''}
    ${newAchCards(newAch)}
    ${p.endExp != null ? expCard(p.endExp, p.endUps ?? 0, achCount(meta) - newAch.length) : ''}
    ${hl.length ? `<div class="section"><div class="label">生涯高光</div>${hl.map((l) => `<div class="hl ${l.cls}">${l.text}</div>`).join('')}</div>` : ''}
    <div class="section"><div class="label">履历</div>${historyLedger(30)}</div>
    <div class="section"><div class="label">赛程</div><div class="log-box" id="pro-log" style="max-height:40vh"></div></div>
  </div>`
  appendTo('pro-log', p.log)
  renderTrophies('settle-trophies', false)
  animateStacks()
  $('again')?.addEventListener('click', startLife)
  bindDarkBtn()
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
      <div class="label">天赋与卡分</div>
      <p class="tip" style="color:var(--bone)">天赋开局摇一档，一辈子不变，决定隐藏实力涨多快。极小概率会在天赋之外再摇到一个隐藏天赋，摇到了你会知道，它有自己的结局。大段不是直接跨的：实力到了，还得那几把打得顺。顺了就上去，不顺就卡在 X1·99，差一分。卡久了会自己想办法：换英雄池、找人复盘，都是事件。</p>
    </div>
    <div class="section">
      <div class="label">系统控分</div>
      <p class="tip" style="color:var(--bone)">段位跟着实力慢慢走。实力高于段位时系统欠你分（逆风局 / 安慰奖），低于时段位虚高（预期 / 大逆转）。每年软重置一次重新定级。</p>
    </div>
    <div class="section">
      <div class="label">被发掘</div>
      <p class="tip" style="color:var(--bone)">${SCOUT_MAX_AGE} 岁前打到宗师以上，有概率收到青训教练的私信。试训前有背调，账号干净才好过。通过就单开一段职业生涯：OWCS 中国赛区，从网吧赛打到 EWC 和世界总决赛，签约、转会、板凳、审查、热搜全是事件，不用你点。履历有保底：打过 OWCS 就不会再回杯赛，拿过赛区冠亚军直接常规赛。</p>
    </div>
    <div class="section">
      <div class="label">黑市</div>
      <p class="tip" style="color:var(--bone)">热情快见底、分又一直上不去的时候，会有人私信你。你会怎么选也是摇的：环境越脏、手头越有钱，越容易走歪。整个游戏没有任何要你点的抉择。代练能把分抬上去，但留下记录：天梯里可能被封 30 天，职业里被翻出来就是禁赛解约，还连累下几辈子。开挂上分最快，但几季之内必被永封，从那一刻起这辈子的成就不再计入。</p>
    </div>
    <div class="section">
      <div class="label">经验与等级</div>
      <p class="tip" style="color:var(--bone)">每辈子结束按最高段位给经验，进职业、拿冠军再加。每一级、每一个成就，下辈子天才 / 怪物多一点（很克制）。成就攒到档位会解锁 buff（成就页有明细）。</p>
    </div>
    <div class="section">
      <div class="label">会发生什么</div>
      <p class="tip" style="color:var(--bone)">打了才知道。</p>
    </div>
  </div>`
  top.bind()
}

function speedText() {
  const k = speedScale()
  return `×${k} · ${(LIFE_TICK_MS * k / 1000).toFixed(1)}s`
}

function settingsBody() {
  const themes = THEMES.map((t) => `<button class="${t.id === currentTheme() ? 'on' : ''}" data-theme-pick="${t.id}" title="${t.desc}">${t.name}</button>`).join('')
  return `
    <label class="row"><span class="k">手动模式（点日志推进一季 / 一场）</span><input type="checkbox" id="set-manual" ${meta.manual ? 'checked' : ''}></label>
    <div class="row" style="border-bottom:0"><span class="k">速度</span><span class="v num" id="speed-val">${speedText()}</span></div>
    <input type="range" id="set-speed" min="${MIN_SPEED}" max="${MAX_SPEED}" step="0.5" value="${speedScale()}">
    <div class="tip" style="margin-top:6px">往右更慢。职业 ×${PRO_TICK_RATIO.toFixed(1)}</div>
    <div class="row" style="border-bottom:0;padding-top:14px"><span class="k">外观</span><span class="v tip" id="theme-desc">${THEMES.find((t) => t.id === currentTheme())?.desc ?? ''}</span></div>
    <div class="seg" id="theme-seg" style="margin-top:6px;flex-wrap:wrap">${themes}</div>
  `
}

function bindSpeed() {
  $('theme-seg')?.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.onclick = () => {
      meta.theme = b.dataset.themePick
      const u = new URL(location.href)
      if (u.searchParams.has('theme')) { u.searchParams.delete('theme'); history.replaceState(null, '', u.toString()) }
      applyTheme()
      writeMeta(meta)
      $('theme-seg')!.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))
      $('theme-desc')!.textContent = THEMES.find((t) => t.id === meta.theme)?.desc ?? ''
    }
  })
  $('set-manual')!.onchange = (e) => { meta.manual = (e.target as HTMLInputElement).checked; writeMeta(meta) }
  const range = $('set-speed') as HTMLInputElement
  range.oninput = () => {
    meta.speed = Number(range.value)
    $('speed-val')!.textContent = speedText()
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
