/**
 * 职业阶段：从天梯人生被发掘后接上。以「年」为单位：年初摇状态 → 三个 Stage 逐场滚动 → 年末转会窗（自动挑）。
 * 全程滚屏，没有抉择；转会 / 板凳 / 假赛 / 宫斗 / 解散全是随机事件。
 * 由 main.ts 驱动：beginCareerRun → proStep 直到 'done'（退役 / 永封），签约到退役一路滚完。
 */
import type { Form, HiddenTalent, LogLine, MetaSave, ProOffer, ProState, StageResult, TalentTier, Team } from '../types'
import {
  CUPS, CUP_PLACE, EXPOSED_BLOCK_LIVES, EXPOSED_SUSPEND, EXP_PRO, FMVP_P, FORM_INFO, FORM_ORDER, HELL_DEBT, HELL_RETURN_INCOME, HIDDEN_INFO, INTL_MULT, INTL_NAME, INTL_PLACE, INTL_PRIZE, LV, MATE_NAMES, OWWC_PLACE,
  PRO_DECLINE_AGE, PRO_FORCE_RETIRE_AGE, PRO_GROWTH_CAP, PRO_IDLE_EXPENSE, PRO_LEVELS, PRO_RETIRE_MIN_AGE,
  SALARY, STAGE_PRIZE, TALENT_PRO_BONUS, TEAMS,
} from '../data/constants'
import { clamp, irand, rand } from './rank'
import { ACH_MAP } from '../data/achievements'
import { perks } from './perks'
import { afterlife, buildProEnding, type ProEndReason } from '../data/endings'
import { addExp } from '../data/talent'

/* ———————————— 档 ———————————— */

export function freshPro(): ProState {
  return {
    runs: 0, active: false, age: 17, year: 0, teamId: null, salary: 0,
    form: 'ok', skill: 55, fame: 0, benchYears: 0, idleYears: 0, yearScore: 0, history: [],
    titles: { regional: 0, intl: 0, world: 0, worldCup: 0, owwc: 0, fmvp: 0 }, fixes: 0, suspended: 0, growth: 0, talentBonus: 0, income: 0,
    talent: 'normal', hidden: null, clean: true, ending: null, lifetimeBan: false, yearsPlayed: 0, log: [], highlights: [],
    yearDone: false, stageAt: 0, level: 0, peakLevel: 0, lvNote: '', endings: {},
  }
}

/** 赛事高度往上跳：只升不降（年初回到履历决定的保底）；note 是具体赛事与名次 */
function levelUp(meta: MetaSave, lv: number, note: string) {
  const p = meta.pro
  if (lv >= p.level) { p.level = lv; p.lvNote = note }
  if (lv > p.peakLevel) p.peakLevel = lv
}

export function teamOf(id: string | null | undefined): Team | null {
  return TEAMS.find((t) => t.id === id) ?? null
}

/** 本生涯内的队伍底子修正（被挖 / 补强） */
const teamMods: Record<string, number> = {}
export function teamRating(t: Team): number {
  return clamp(t.rating + (teamMods[t.id] ?? 0), 30, 96)
}

/* ———————————— 状态档（职业模式的天赋） ———————————— */

/** 年龄在职业里的「体感」：晚熟的人身体晚四年报警 */
export function proAge(p: ProState): number {
  return p.hidden === 'late' ? p.age - 4 : p.age
}

export function formProbs(growth: number, age: number): Record<Form, number> {
  const pen = age >= PRO_DECLINE_AGE ? (age - PRO_DECLINE_AGE + 1) * 3 + (age >= 28 ? (age - 27) * 3 : 0) : 0
  const pts = Math.max(-15, Math.min(PRO_GROWTH_CAP, growth) - pen)
  const w = FORM_ORDER.map((f) => Math.max(0.3, FORM_INFO[f].base * (1 + FORM_INFO[f].grow * pts)))
  const s = w.reduce((a, b) => a + b, 0)
  const out = {} as Record<Form, number>
  FORM_ORDER.forEach((f, i) => { out[f] = Math.round((w[i] / s) * 1000) / 10 })
  return out
}

function rollForm(growth: number, age: number): Form {
  const probs = formProbs(growth, age)
  let r = rand() * 100
  for (const f of FORM_ORDER) { r -= probs[f]; if (r <= 0) return f }
  return 'ok'
}

/* ———————————— 生涯开始 / 结束 ———————————— */

/** 试训通过 → 开始生涯。年龄与天赋从天梯人生带入 */
export function startCareer(meta: MetaSave, age: number, talent: TalentTier, hidden: HiddenTalent | null = null) {
  const p = meta.pro
  const keep = { runs: p.runs + 1, growth: p.growth, lifetimeBan: p.lifetimeBan, endings: p.endings }
  Object.assign(p, freshPro(), keep)
  p.age = age
  p.talent = talent
  p.hidden = hidden
  p.talentBonus = TALENT_PRO_BONUS[talent] + (hidden ? HIDDEN_INFO[hidden].proBonus : 0)
  p.fame = meta.fans
  p.active = true
  for (const k of Object.keys(teamMods)) delete teamMods[k]
  deadTeams.clear()
  gen = null
}

/* ———————————— 生成器驱动 ———————————— */

type Tick = 'step'
let gen: Generator<Tick, void, void> | null = null

/** 开始一段连续滚动：从当前年一路滚到退役（刷新后从最近写档的那一年重来） */
export function beginCareerRun(meta: MetaSave) {
  const p = meta.pro
  p.log = []
  p.highlights = []
  p.yearDone = false
  p.stageAt = 0
  gen = careerGen(meta)
}

export function careerInProgress(): boolean {
  return gen !== null
}

/** 推进一步。返回 'step'（继续）/ 'done'（生涯结束）。全自动，没有抉择。 */
export function proStep(): Tick | 'done' {
  if (!gen) return 'done'
  const r = gen.next()
  if (r.done) { gen = null; return 'done' }
  return r.value
}

/** 玩家主动退役：按目前履历结算 */
export function retireNow(meta: MetaSave) {
  const p = meta.pro
  if (!p.active) return
  gen = null
  p.log = []
  p.highlights = []
  L(meta, 'sys', '你发了条微博：「到这儿吧。」')
  endCareer(meta, 'retire')
}

function* careerGen(meta: MetaSave): Generator<Tick, void, void> {
  const p = meta.pro
  while (p.active) {
    yield* yearGen(meta)
    if (p.ending || !p.active) return
    commitYear(meta)
    L(meta, 'sys', '— 休赛期 —')
    yield 'step'
  }
}

/* ———————————— 工具 ———————————— */

const WIN_MOMENTS = ['最后一波抢下决胜点', '你一个大招清了三个', '加时守住了', '第三图打到 99:99 拿下', '对面换阵你们跟上了', '教练暂停之后连扳两图']
const LOSE_MOMENTS = ['推车差 0.3 米', '被对面辅助大招翻盘', '教练喊了暂停也没救回来', '对面 DPS 手感爆炸', '你的英雄被 ban 了，换手打得别扭', '对面换阵你们没跟上', '第三图打到 99:99 丢了']
const OPP = ['韩国队', '北美队', '欧洲队', '日本队', '沙特队']
const moment = (win: boolean) => (win ? WIN_MOMENTS : LOSE_MOMENTS)[irand(0, (win ? WIN_MOMENTS : LOSE_MOMENTS).length - 1)]
/** 本生涯里散掉 / 解约过的队：当年不再报价 */
const deadTeams = new Set<string>()
const mate = () => MATE_NAMES[irand(0, MATE_NAMES.length - 1)]
const fm = (n: number) => n.toLocaleString()

function L(meta: MetaSave, cls: string, text: string): LogLine {
  const line: LogLine = { cls, text, at: meta.pro.age }
  meta.pro.log.push(line)
  return line
}
function H(meta: MetaSave, line: LogLine) { if (line.at == null) line.at = meta.pro.age; meta.pro.highlights.push(line) }

function ach(meta: MetaSave, id: string) {
  if (meta.achievements[id]) return
  meta.achievements[id] = true
  const a = ACH_MAP[id]
  if (a) H(meta, { cls: 'ach', text: `成就【${a.name}】` })
}

function addFame(meta: MetaSave, n: number) {
  meta.pro.fame = Math.max(0, Math.round(meta.pro.fame + n))
  meta.fans = Math.max(meta.fans, meta.pro.fame)
}

/** 黑历史曝光概率（天梯里做的脏事 + 本生涯假赛） */
export function exposureP(meta: MetaSave): number {
  const d = meta.dirty
  return Math.min(0.5, d.boostJobs * 0.05 + d.hires * 0.04 + d.cheatSeasons * 0.2 + meta.pro.fixes * 0.12)
}

function endCareer(meta: MetaSave, reason: ProEndReason) {
  const p = meta.pro
  // 退役开播能不能爆，看底子也看运气：人气够高的老粉多，首播一晚就能冲上百万
  if (!p.lifetimeBan && reason !== 'fix_ruin' && p.fame >= 250000 && rand() < 0.35) {
    addFame(meta, Math.max(1000000, p.fame * 3) - p.fame)
  }
  p.ending = buildProEnding(meta, reason)
  p.active = false
  p.endings[p.ending.id] = (p.endings[p.ending.id] ?? 0) + 1
  meta.endings[p.ending.id] = (meta.endings[p.ending.id] ?? 0) + 1
  meta.lastEndingId = p.ending.id
  H(meta, { cls: 'ending', text: `【${p.ending.title}】` })
  ach(meta, `pro_end_${p.ending.id}`)
  // 退役去向 / 生涯形状
  const kind = afterlife(meta).kind
  if (kind === 'star') ach(meta, 'pro_kskbl')
  if (kind === 'boost') ach(meta, 'pro_zdjd')
  const clubs = new Set(p.history.map((r) => r.team)).size
  if (p.yearsPlayed >= 5 && clubs === 1) ach(meta, 'pro_one_club')
  if (clubs >= 4) ach(meta, 'pro_nomad')
  if (p.yearsPlayed >= 6 && p.benchYears === 0 && !p.history.some((r) => r.bench)) ach(meta, 'pro_ironman')
  // 职业成就 → 经验（线性）
  const t = p.titles
  const exp = p.yearsPlayed * EXP_PRO.year + t.regional * EXP_PRO.regional + t.intl * EXP_PRO.intl + t.world * EXP_PRO.world + t.fmvp * EXP_PRO.fmvp
  p.endExp = exp
  p.endUps = addExp(meta.growth, exp)
}

function lifetimeBan(meta: MetaSave, why: string) {
  const p = meta.pro
  p.lifetimeBan = true
  p.banReason = why
  p.teamId = null
  addFame(meta, -Math.round(p.fame * 0.6))
  L(meta, 'ban', `【官方公告】${why} 永久禁止参加 OWCS 及其附属赛事。`)
  endCareer(meta, 'lifetime_ban')
}

/**
 * 政审 / 被爆。返回 true 表示生涯到此结束。
 * 假赛、开挂 → 永封；代练 / 陪玩史 → 禁赛 + 解约 + 下几辈子没人私信你。
 */
function exposureCheck(meta: MetaSave, when: string, mult = 1): boolean {
  const pr = exposureP(meta) * mult
  if (pr <= 0 || rand() >= pr) return false
  const p = meta.pro
  const d = meta.dirty
  const severe = p.fixes > 0 || d.cheatSeasons > 0
  if (severe) {
    const what = p.fixes > 0 && (d.cheatSeasons === 0 || rand() < 0.5) ? '该选手涉嫌操纵比赛' : '该选手账号曾使用第三方程序'
    lifetimeBan(meta, `${when}查实：${what}。`)
    return true
  }
  const who = [
    '经理翻账号登录记录时发现两个省同时在线',
    '一个被踢出首发的队友把你的代练截图发进了赛区群',
    '老粉扒出你当年直播里说过的「号给朋友打了」',
    '一个路人在论坛贴出和你 ID 对局时的战绩截图',
  ][irand(0, 3)]
  const t = teamOf(p.teamId)
  p.suspended += EXPOSED_SUSPEND
  p.clean = false
  addFame(meta, -Math.round(p.fame * 0.4))
  L(meta, 'ban', `【被爆】${who}。${when}认定账号存在共享（代练 / 陪玩）记录：禁赛 ${EXPOSED_SUSPEND} 个 Stage。${t ? `${t.name} 当天解约。` : ''}`)
  H(meta, { cls: 'ban', text: '代练史被爆，禁赛解约' })
  ach(meta, 'pro_exposed')
  if (t) deadTeams.add(t.id)
  p.teamId = null
  p.salary = 0
  meta.proBlockLives = EXPOSED_BLOCK_LIVES
  // 爆过一次就没什么可爆的了
  d.hires = 0
  d.boostJobs = 0
  return false
}

function teamStrength(meta: MetaSave, temp = 0): number {
  const p = meta.pro
  const t = teamOf(p.teamId)
  if (!t) return 0
  return teamRating(t) * 0.55 + p.skill * 0.45 + temp + irand(-5, 5)
}

function series(you: number, opp: number, bo: number): { win: boolean; score: string } {
  const need = Math.ceil(bo / 2)
  let a = 0
  let b = 0
  const pr = clamp(0.5 + (you - opp) / 80, 0.15, 0.85)
  while (a < need && b < need) { if (rand() < pr) a++; else b++ }
  return { win: a > b, score: `${a}:${b}` }
}

/* ———————————— 报价 / 转会窗 ———————————— */

function makeOffers(meta: MetaSave, window: boolean): ProOffer[] {
  const p = meta.pro
  const out: ProOffer[] = []
  const cur = teamOf(p.teamId)
  const value = p.skill + Math.min(8, p.fame / 10000) + p.titles.regional * 3 + p.titles.intl * 5 - Math.max(0, p.age - 25) * 4
  for (const t of TEAMS) {
    if (cur && t.id === cur.id) continue
    if (deadTeams.has(t.id)) continue
    const need = teamRating(t) - 8
    const pr = t.partner ? clamp((value - need) / 40 + 0.1, 0, 0.6) * (perks(meta).has('offers') ? 1.4 : 1) : clamp((value - need) / 30 + 0.22, 0.03, 0.75)
    if (rand() < pr) {
      const bench = p.skill < teamRating(t) - 15
      const [a, b] = bench ? SALARY.bench : t.partner ? SALARY.partner : SALARY.normal
      out.push({ teamId: t.id, salary: irand(a, b), role: bench ? 'bench' : 'starter' })
    }
  }
  // 续约：年度积分够（合作战队要求更高；年纪大了要求再高）
  const needScore = (cur?.partner ? 14 : 10) + Math.max(0, p.age - 26) * 2
  if (window && cur && p.yearScore >= needScore) {
    const [a, b] = cur.partner ? SALARY.partner : SALARY.normal
    out.unshift({ teamId: cur.id, salary: Math.round(irand(a, b) * (p.yearScore >= 16 ? 1.3 : 1)), role: 'starter' })
  }
  // 出道那年保底：总有一支普通队肯给青训合同，别让第一年就「没人要」
  if (!out.length && p.year === 0 && !window) {
    const pool = TEAMS.filter((t) => !t.partner && !deadTeams.has(t.id))
    const t = pool.sort((a, b) => teamRating(a) - teamRating(b))[0]
    if (t) {
      const [a] = SALARY.normal
      out.push({ teamId: t.id, salary: irand(Math.round(a * 0.6), a), role: 'starter' })
    }
  }
  out.sort((x, y) => y.salary - x.salary)
  return out.slice(0, 3)
}

/**
 * 自动选合同：不让玩家点。首发 > 替补，钱多 > 钱少，合作战队加分；
 * 但选手也是人：偶尔为了钱去坐板凳，偶尔为了上场去小队。
 */
function pickOffer(meta: MetaSave, offers: ProOffer[]): ProOffer | null {
  if (!offers.length) return null
  const cur = meta.pro.teamId
  const score = (o: ProOffer) => {
    const t = teamOf(o.teamId)!
    return o.salary / 1000 + (t.partner ? 25 : 0) + (o.role === 'starter' ? 30 : 0) + (o.teamId === cur ? 12 : 0) + irand(0, 20)
  }
  return offers.slice().sort((a, b) => score(b) - score(a))[0]
}

function applySign(meta: MetaSave, o: ProOffer, window = false) {
  const p = meta.pro
  const t = teamOf(o.teamId)!
  const wasCur = p.teamId === o.teamId
  const prev = teamOf(p.teamId)
  p.teamId = o.teamId
  p.salary = o.salary
  meta.cash += p.salary
  p.income += p.salary
  p.idleYears = 0
  const verb = wasCur ? '续约' : window && prev ? '转会' : '签约'
  const flavor = wasCur
    ? (rand() < 0.5 ? '老板说明年再冲一冲。' : '你没看合同就签了。')
    : t.partner && prev && !prev.partner
      ? '从小队跳到大队，群里有人说你抱团。'
      : o.role === 'bench'
        ? '合同上写的是替补。经理说「先适应一下」。'
        : prev ? `${prev.name} 的队友在群里发了个「走好」。` : '你把训练室的照片发了朋友圈。'
  L(meta, 'career', `【${verb}】${t.name}，年薪 ${fm(p.salary)}。${flavor}`)
  H(meta, { cls: 'career', text: `${verb} ${t.name}` })
  ach(meta, 'pro_signed')
  if (t.partner) ach(meta, 'pro_partner')
  if (!wasCur && prev) ach(meta, 'pro_transfer')
  if (o.role === 'bench') p.benchYears++
}

/* ———————————— 一年 ———————————— */

function* yearGen(meta: MetaSave): Generator<Tick, void, void> {
  const p = meta.pro
  p.yearScore = 0
  // 年初回到保底：打过 OWCS 的人不用再从网吧赛爬
  p.level = floorLevel(p)
  p.lvNote = p.level === LV.regular ? '赛区冠亚军 · 直接常规赛' : p.level === LV.qualifier ? '打过 OWCS · 预选起步' : p.teamId ? '新赛季' : '自由人'
  // 年初：摇状态
  p.form = rollForm(p.growth + p.talentBonus, proAge(p))
  p.skill = irand(FORM_INFO[p.form].min, FORM_INFO[p.form].max)
  L(meta, 'talent', `【第 ${p.year + 1} 年 · ${p.age} 岁】状态【${FORM_INFO[p.form].name}】`)
  H(meta, { cls: 'talent', text: `状态【${FORM_INFO[p.form].name}】` })
  if (p.form === 'god') ach(meta, 'pro_form_god')
  yield 'step'

  // 无队：看有没有人要
  if (!p.teamId) {
    const offers = makeOffers(meta, false)
    const pick = pickOffer(meta, offers)
    if (pick) applySign(meta, pick)
    else {
      p.idleYears++
      meta.cash -= PRO_IDLE_EXPENSE
      addFame(meta, -Math.round(p.fame * 0.2))
      L(meta, 'warn', `没有队。这一年在网吧赛、陪练和直播里过去了。开销 −${fm(PRO_IDLE_EXPENSE)}。`)
    }
    yield 'step'
  }

  if (p.teamId) {
    if (exposureP(meta) > 0) {
      L(meta, 'sys', '赛季注册，官方复核选手账号记录。')
      yield 'step'
      if (exposureCheck(meta, '赛季注册复核', 0.6)) return
    }
    for (const stage of [1, 2, 3] as const) {
      if (!p.teamId) break
      p.stageAt = stage
      if (p.suspended > 0) {
        p.suspended--
        const t = teamOf(p.teamId)!
        p.history.push({ year: p.year + 1, stage, team: t.name, place: 0, intl: 0, prize: 0, note: '禁赛' })
        L(meta, 'ban', `S${stage} · 禁赛期。你在看台上看完了整个 Stage。`)
        yield 'step'
        continue
      }
      const ev = yield* stageEvent(meta, stage)
      if (p.ending) return
      if (ev.skip) continue
      yield* runStage(meta, stage, ev.temp, ev.bench)
      if (p.ending) return
    }
  }
  yield* yearEnd(meta)
  p.yearDone = true
}

interface EventOut { skip: boolean; temp: number; bench: boolean }

/** Stage 前的随机事件：一半的 Stage 什么都不发生，发生了也只有一行 */
function* stageEvent(meta: MetaSave, stage: 1 | 2 | 3): Generator<Tick, EventOut, void> {
  const p = meta.pro
  const t = teamOf(p.teamId)!
  const out: EventOut = { skip: false, temp: 0, bench: false }
  const r = rand()
  const push = (cls: string, text: string, hl = false) => { const l = L(meta, cls, `S${stage} · ${text}`); if (hl) H(meta, l) }

  // 玻璃手：手腕随时可能罢工
  if (p.hidden === 'glass' && rand() < 0.08) {
    push('warn', '【手腕】训练赛打到第三张图，右手又开始麻。这个 Stage 看台见。', true)
    out.bench = true
    p.benchYears++
    yield 'step'
    return out
  }

  if (r < 0.05) {
    // 假赛邀约：缺钱的人更容易点头
    const money = irand(8, 25) * 10000
    const takeP = meta.cash < -20000 ? 0.55 : meta.cash < 0 ? 0.25 : 0.06
    if (rand() < takeP) {
      meta.cash += money
      p.income += money
      p.fixes++
      p.clean = false
      out.temp = -15
      push('ban', `【假赛】陌生人私信：「小组赛放两场，${fm(money)}。」你收了。该输的都输了。`, true)
      ach(meta, 'pro_fix')
      if (rand() < 0.35) {
        yield 'step'
        push('ban', '【官方公告】监察部门比对投注数据，认定你参与操纵比赛。永久禁赛。', true)
        p.lifetimeBan = true
        p.banReason = '参与操纵比赛。'
        p.teamId = null
        addFame(meta, -Math.round(p.fame * 0.7))
        endCareer(meta, 'fix_ruin')
        return out
      }
    } else {
      addFame(meta, 800)
      push('career', `【假赛】陌生人私信：「小组赛放两场，${fm(money)}。」你把截图发给了队长。人气 +800。`, true)
      ach(meta, 'pro_fix_refused')
    }
    yield 'step'
    return out
  }
  if (r < 0.09) { push('warn', `【宫斗】${mate()} 和 ${mate()} 为首发位置闹到教练组，训练赛打成两派。你在中间。`); out.temp = -6; yield 'step'; return out }
  if (r < 0.12) { teamMods[t.id] = (teamMods[t.id] ?? 0) - 4; push('warn', `【被挖】主力 ${mate()} 被${TEAMS[irand(0, 3)].name}挖走。`); yield 'step'; return out }
  if (r < 0.15) { teamMods[t.id] = (teamMods[t.id] ?? 0) + 4; push('career', `【补强】战队签下韩援 ${mate()}。训练赛开始赢了。`); yield 'step'; return out }
  if (r < 0.18) {
    const big = TEAMS[irand(0, 3)]
    if (big.id !== t.id) { teamMods[big.id] = (teamMods[big.id] ?? 0) + 6; push('warn', `【抱团】${big.name} 一口气签了三个国家队选手。`); yield 'step'; return out }
  }
  if (r < 0.21) { push('warn', `【enjoy】老板不投钱了，训练赛改成每天两小时。${mate()} 直播比训练时间长。`); out.temp = -8; yield 'step'; return out }
  if (r < 0.24) { push('warn', `【板凳】教练换体系，这个 Stage 你坐替补席。首发是刚签的 ${mate()}。`, true); out.bench = true; p.benchYears++; yield 'step'; return out }
  if (r < 0.26) { addFame(meta, -Math.round(p.fame * 0.25)); push('warn', '【脱粉】你直播说了句「这游戏也就这样」，粉丝群一夜掉了四分之一。'); yield 'step'; return out }
  if (r < 0.28) {
    push('ban', '【优化】俱乐部签了新人，经理约你谈话：「合同剩下的部分照付。」你被挂上转会名单。', true)
    p.teamId = null
    p.yearScore = 0
    ach(meta, 'pro_cut')
    out.skip = true
    yield 'step'
    return out
  }
  if (r < 0.30) { push('career', `【首发】首发 ${mate()} 手伤，你顶上。教练：「打出来就是你的。」`); out.temp = 4; yield 'step'; return out }
  if (r < 0.33) {
    push('ban', `【连坐】队友 ${mate()} 被查出在预选赛收钱放水。${t.name} 本 Stage 取消资格。`, true)
    addFame(meta, -Math.round(p.fame * 0.2))
    p.history.push({ year: p.year + 1, stage, team: t.name, place: 0, intl: 0, prize: 0, note: '全队取消资格' })
    ach(meta, 'pro_teammate_fix')
    if (rand() < 0.2) {
      yield 'step'
      push('ban', '监察部门认为你知情不报。追加禁赛两个 Stage。', true)
      p.suspended = 2
      addFame(meta, -Math.round(p.fame * 0.3))
    }
    out.skip = true
    yield 'step'
    return out
  }
  if (r < 0.35) { push('warn', '【伤病】手腕腱鞘炎复发。医生说这个 Stage 别碰鼠标。', true); out.bench = true; yield 'step'; return out }
  if (r < 0.37) {
    push('ban', '【丑闻】你的私聊记录被人挂上热搜。俱乐部连夜公告：「经协商，双方解除合同。」', true)
    addFame(meta, -Math.round(p.fame * 0.3))
    deadTeams.add(t.id)
    p.teamId = null
    p.yearScore = 0
    ach(meta, 'pro_scandal')
    out.skip = true
    yield 'step'
    return out
  }
  if (r < 0.39) {
    push('ban', `【解散】${t.name} 老板失联，队员在宿舍等了一周。欠薪 ${fm(Math.round(p.salary / 2))} 没了。`, true)
    meta.cash -= Math.round(p.salary / 2)
    deadTeams.add(t.id)
    p.teamId = null
    p.yearScore = 0
    ach(meta, 'pro_disband')
    out.skip = true
    yield 'step'
    return out
  }
  if (r < 0.43) { const c = irand(5, 20) * 1000; meta.cash += c; p.income += c; push('career', `【赞助】外设品牌个人代言到账 +${fm(c)}。`); yield 'step'; return out }
  // —— 梗：少量，一行 ——
  if (r < 0.55) {
    const fans = (n: number) => { addFame(meta, n); return `人气 +${fm(n)}。` }
    const memes: Array<() => void> = [
      () => push('career', `【切片】解说喊「他不是人，他是神！」切片播放量破百万。${fans(irand(3000, 9000))}`, true),
      () => push('career', `【表情包】你赛后采访皱眉的一帧被做成了表情包。${fans(irand(1500, 4000))}`),
      () => push('sys', `【热搜】你的 ID 上了热搜第 38 位，评论区第一条：「这谁？」${fans(irand(500, 1500))}`),
      () => { out.temp = -3; push('warn', '【三英雄选手】解说说你是「三英雄选手」，对面 ban 位从此固定。') },
      () => { const c = irand(3, 12) * 1000; meta.cash += c; p.income += c; push('career', `【带货】休赛期直播带货，卖出 ${irand(30, 400)} 包螺蛳粉。现金 +${fm(c)}。`) },
      () => { out.temp = -4; push('warn', '【拉肚子】决赛日拉肚子。回来对面已经换阵了。') },
      () => push('career', `【握手】赛后握手，对面 ${mate()} 没伸手。第二天热搜上骂的是他。${fans(irand(1000, 3000))}`),
      () => { out.temp = 3; push('career', '【推特】对面外援在推特 @ 你：「easy」。这个 Stage 你每一把都在找他。') },
      () => push('career', `【猴子】你的猴子跳大砸空，解说：「他在测量场地。」切片火了。${fans(irand(2000, 6000))}`, true),
      () => { out.temp = -4; push('warn', '【ban 位】你的本命被 ban 了一整个 Stage。教练：「换手。」') },
      () => push('career', `【拆家】决胜图最后一波你一个人守住点。解说：「这是地形杀。」${fans(irand(1500, 4000))}`, true),
      () => push('sys', '【采访】赛后采访问你怎么看对手。你说：「他们也很努力。」被做成了鬼畜。'),
    ]
    memes[irand(0, memes.length - 1)]()
    yield 'step'
    return out
  }
  return out
}

/** 一场杯赛：16 强淘汰赛，一行。打进 4 强才有下一级的名额 */
function* cup(meta: MetaSave, stage: number, lv: number, you: number): Generator<Tick, boolean, void> {
  const p = meta.pro
  const c = CUPS[lv]
  const name = c.names[irand(0, c.names.length - 1)]
  let round = 0
  let lastScore = ''
  while (round < 4) {
    const s = series(you, irand(c.opp[0] + round * 4, c.opp[1] + round * 4), 3)
    lastScore = s.score
    if (!s.win) break
    round++
  }
  const place = CUP_PLACE[round]
  const prize = round === 4 ? c.prize : round === 3 ? Math.round(c.prize / 2) : round === 2 ? Math.round(c.prize / 5) : 0
  meta.cash += prize
  p.income += prize
  addFame(meta, Math.round(c.fame * [0.1, 0.25, 0.5, 0.7, 1][round]))
  levelUp(meta, lv, `${name} · ${place}`)
  const through = round >= 2
  const cls = round === 4 ? 'win' : through ? 'career' : 'lose'
  const tail = through ? `晋级${PRO_LEVELS[lv + 1]}。` : `${moment(false)}。这个 Stage 到此为止。`
  const l = L(meta, cls, `S${stage} · 【${PRO_LEVELS[lv]}】${name} · ${place}${lastScore && round < 4 ? `（${lastScore}）` : ''}${prize ? `，奖金 +${fm(prize)}` : ''}。${tail}`)
  if (round === 4) H(meta, l)
  yield 'step'
  return through
}

/** 你的履历决定从哪一级起步：打过 OWCS 就不回杯赛；拿过赛区冠亚军就直接常规赛 */
function floorLevel(p: ProState): number {
  if (p.history.some((r) => r.place > 0 && r.place <= 2)) return LV.regular
  if (p.peakLevel >= LV.qualifier) return LV.qualifier
  return 0
}

/** 一个 Stage：杯赛（底子差的队）→ 预选 → 常规 → 季后 → 国际赛。每一级一行，赛事高度跟着跳 */
function* runStage(meta: MetaSave, stage: 1 | 2 | 3, temp: number, bench: boolean): Generator<Tick, void, void> {
  const p = meta.pro
  const t = teamOf(p.teamId)!
  const res: StageResult = { year: p.year + 1, stage, team: t.name, place: 0, intl: 0, prize: 0, bench }
  const you = teamStrength(meta, temp) + (bench ? -8 : 0)
  const say = (cls: string, text: string) => L(meta, cls, `S${stage} · ${text}`)
  const tag = bench ? '（你在替补席）' : ''
  const rating = teamRating(t)
  const floor = floorLevel(p)

  // 杯赛：从哪一级开始打，看队伍底子；打过 OWCS 的人不用再打
  let alive = true
  if (!t.partner && floor < LV.qualifier) {
    const from = rating < 48 ? 0 : rating < 62 ? 1 : 2
    for (let lv = from; lv <= 2 && alive; lv++) alive = yield* cup(meta, stage, lv, you)
  }

  // 预选赛：一行。合作队 S1 免；拿过赛区冠亚军的人所在队直接有名额
  if (alive && !(t.partner && stage === 1) && floor < LV.regular) {
    let w = 0
    for (let i = 0; i < 3; i++) if (series(you, irand(35, 78), 3).win) w++
    const pl = w === 3 ? irand(1, 2) : w === 2 ? irand(3, 5) : w === 1 ? irand(6, 7) : 8
    levelUp(meta, LV.qualifier, `OWCS 预选 · 第 ${pl}`)
    if (pl <= 6) say('career', `【预选赛】OWCS 预选 · 瑞士轮 ${w}-${3 - w} · 第 ${pl}，晋级常规赛。${tag}`)
    else { alive = false; res.place = pl; say('lose', `【预选赛】OWCS 预选 · 瑞士轮 ${w}-${3 - w} · 第 ${pl}，止步预选。${tag}`) }
    yield 'step'
  }

  if (alive) {
    let rw = 0
    let best: string | null = null
    for (let i = 0; i < 5; i++) { const s = series(you, irand(45, 86), 3); if (s.win) { rw++; if (!best) best = moment(true) } }
    ach(meta, 'pro_regular')
    let pl = rw >= 4 ? irand(1, 2) : rw === 3 ? irand(2, 4) : rw === 2 ? irand(4, 5) : irand(5, 6)
    // 世界冠军的底子：常规赛至少四强
    if (p.titles.world > 0) pl = Math.min(pl, 4)
    levelUp(meta, LV.regular, `OWCS 常规赛 · 第 ${pl}`)
    if (pl <= 4) {
      say('career', `【常规赛】OWCS 常规赛 · ${rw} 胜 ${5 - rw} 负 · 第 ${pl}，进季后赛。${best ? best + '。' : ''}${tag}`)
      ach(meta, 'pro_playoffs')
      yield 'step'
      const semi = series(you, irand(60, 92), 5)
      let text = `胜者组 ${semi.score}`
      if (semi.win) {
        const final = series(you, irand(68, 95), 5)
        text += ` → 决赛 ${final.score}`
        res.place = final.win ? 1 : 2
      } else {
        const lower = series(you, irand(55, 88), 5)
        text += ` → 败者组 ${lower.score}`
        if (lower.win) {
          const final = series(you, irand(68, 95), 5)
          text += ` → 决赛 ${final.score}`
          res.place = final.win ? 2 : 3
        } else res.place = 4
      }
      res.prize = STAGE_PRIZE[res.place] ?? 0
      if (bench) res.prize = Math.round(res.prize * 0.4)
      const place = res.place === 1 ? '冠军' : res.place === 2 ? '亚军' : res.place === 3 ? '季军' : '第四'
      levelUp(meta, LV.playoffs, `OWCS 季后赛 · ${place}`)
      const l = say(res.place === 1 ? 'ending' : res.place === 2 ? 'win' : 'career', `【季后赛】OWCS 季后赛 · ${text}，${place}${res.prize ? `，奖金 +${fm(res.prize)}` : ''}。${res.place === 1 ? moment(true) + '。' : ''}${tag}`)
      if (res.place <= 2) H(meta, l)
      yield 'step'
    } else {
      res.place = pl
      res.prize = STAGE_PRIZE[pl] ?? 0
      if (bench) res.prize = Math.round(res.prize * 0.4)
      say('sys', `【常规赛】OWCS 常规赛 · ${rw} 胜 ${5 - rw} 负 · 第 ${pl}，无缘季后赛。${res.prize ? `奖金 +${fm(res.prize)}。` : ''}${tag}`)
      yield 'step'
    }
  }

  const fameGain = (res.place === 1 ? 15000 : res.place === 2 ? 8000 : res.place <= 4 && res.place > 0 ? 3000 : 500) * (bench ? 0.3 : 1)
  addFame(meta, fameGain)
  if (res.place === 1) { p.titles.regional++; ach(meta, 'pro_regional_champ'); if (bench) ach(meta, 'pro_bench_champ') }

  if (res.place > 0 && res.place <= 2) {
    const name = INTL_NAME[stage]
    if (exposureCheck(meta, '国际赛资格审查')) return
    if (!p.teamId) { say('warn', `队伍带着替补去了${name}。你在家看的直播。`); yield 'step'; return }
    const tier = stage === 1 ? LV.intl : LV.worlds
    const opps = Array.from({ length: 7 }, () => irand(stage === 1 ? 68 : 72, 94) - (perks(meta).has('clutch') ? 2 : 0))
    const foes = [...OPP].sort(() => Math.random() - 0.5)
    let gw = 0
    for (let i = 0; i < 2; i++) if (series(you, opps[i], 5).win) gw++
    let ip: number
    let text = `${INTL_PLACE[stage]} · 小组 ${gw}-${2 - gw}`
    if (gw === 0) ip = irand(7, 8)
    else if (gw === 1) {
      const dec = series(you, opps[2], 5)
      text += ` · 决胜 ${dec.score}`
      ip = dec.win ? 0 : irand(5, 6)
    } else ip = 0
    if (ip === 0) {
      const semi = series(you, opps[5], 5)
      text += ` · 半决赛 ${semi.score} ${foes[3]}`
      if (semi.win) {
        const fin = series(you, opps[6], 5)
        text += ` · 决赛 ${fin.score} ${foes[4]}`
        ip = fin.win ? 1 : 2
      } else ip = irand(3, 4)
    }
    res.intl = ip
    const ipz = Math.round((INTL_PRIZE[ip] ?? 0) * INTL_MULT[stage]) * (bench ? 0.4 : 1)
    res.prize += ipz
    addFame(meta, (ip === 1 ? (stage === 1 ? 60000 : 100000) : ip <= 4 ? 30000 : 10000) * (bench ? 0.3 : 1))
    ach(meta, 'pro_intl')
    if (stage === 3 && ip <= 4) ach(meta, 'pro_world_top4')
    if (ip <= 2) p.titles.intl++
    const place = ip === 1 ? (stage === 1 ? '冠军' : '世界冠军') : ip === 2 ? '亚军' : ip <= 4 ? '4 强' : ip <= 6 ? '8 强' : '小组出局'
    if (ip === 1) {
      if (stage === 1) ach(meta, 'pro_intl_champ')
      else {
        p.titles.world++
        ach(meta, stage === 3 ? 'pro_world_champ' : 'pro_ewc_champ')
      }
    }
    levelUp(meta, ip === 1 && stage > 1 ? LV.champion : tier, `${name} · ${place}`)
    const il = say(ip <= 2 ? 'ending' : ip <= 4 ? 'win' : 'career', `【${PRO_LEVELS[tier]}】${name} · ${text}，${place}${ip === 1 ? '！' : ''}${ipz ? `，奖金 +${fm(ipz)}` : ''}。${tag}`)
    H(meta, il)
    yield 'step'
    // FMVP：世界总决赛冠军且状态在线以上才有资格摇
    if (ip === 1 && stage === 3 && !bench && rand() < (FMVP_P[p.form] ?? 0) * (p.hidden === 'clutch' ? 2 : 1) * (perks(meta).has('clutch') ? 1.5 : 1)) {
      p.titles.fmvp++
      addFame(meta, 150000)
      levelUp(meta, LV.fmvp, `${name} · FMVP`)
      const fl = L(meta, 'ending', '【FMVP】颁奖台的灯打在你一个人身上。')
      H(meta, fl)
      ach(meta, 'pro_fmvp')
      yield 'step'
    }
  }

  meta.cash += res.prize
  p.income += res.prize
  p.history.push(res)
  p.yearScore += Math.max(0, 9 - (res.place || 9)) + (res.intl ? Math.max(0, 9 - res.intl) : 0)
}

/** OWWC 世界杯：休赛期的国家队，娱乐性质，一行 */
function* worldCup(meta: MetaSave): Generator<Tick, void, void> {
  const p = meta.pro
  p.titles.worldCup++
  ach(meta, 'pro_worldcup')
  const you = clamp(p.skill * 0.5 + 40, 55, 92)
  let round = 0
  let lastScore = ''
  const foes = [...OPP].sort(() => Math.random() - 0.5)
  while (round < 4) {
    const s = series(you, irand(66 + round * 5, 88 + round * 3), round === 0 ? 3 : 5)
    lastScore = s.score
    if (!s.win) break
    round++
  }
  const place = OWWC_PLACE[round]
  addFame(meta, [20000, 30000, 45000, 60000, 120000][round])
  if (round === 4) { p.titles.owwc++; ach(meta, 'pro_owwc_champ') }
  const l = L(meta, round >= 3 ? 'ending' : 'career', `【国家队】OWWC 世界杯 · 中国队 · ${place}${round < 4 ? `（${lastScore} ${foes[round]}）` : `，决赛 ${lastScore} ${foes[3]}！`}。${round === 4 ? '国旗披在身上的照片挂了一周热搜。' : round === 3 ? '差一步。' : round === 0 ? '小组赛没出来，微博评论区全是问号。' : ''}`)
  H(meta, l)
  yield 'step'
}


/* ———————————— 年末 ———————————— */

function* yearEnd(meta: MetaSave): Generator<Tick, void, void> {
  const p = meta.pro
  const cur = teamOf(p.teamId)
  p.yearsPlayed++
  p.growth = Math.min(PRO_GROWTH_CAP, p.growth + 1 + (p.yearScore >= 16 ? 1 : 0))

  // OWWC 世界杯：成绩够好就进国家队名单，休赛期去打一趟
  if (cur && p.yearScore >= 14 && rand() < 0.3) yield* worldCup(meta)

  // 地狱归来：曾负债，干净，本生涯职业收入够或拿过国际赛冠军
  if (p.clean && meta.dirty.boostJobs + meta.dirty.hires + meta.dirty.cheatSeasons === 0 && meta.cashLow <= HELL_DEBT
    && (p.titles.world > 0 || p.income >= HELL_RETURN_INCOME) && !meta.achievements['pro_end_hell_return']) {
    L(meta, 'ending', '你翻了一下银行流水，最低那一行还在。')
    yield 'step'
    endCareer(meta, 'hell_return')
    return
  }

  p.age++
  // 年龄：强制收官 / 身体报警
  if (p.age >= PRO_FORCE_RETIRE_AGE) { L(meta, 'sys', `${p.age} 岁。没有转会窗了。`); yield 'step'; endCareer(meta, 'retire'); return }
  if (proAge(p) >= PRO_DECLINE_AGE && rand() < 0.12 * (proAge(p) - PRO_DECLINE_AGE + 1)) {
    L(meta, 'warn', `${p.age} 岁。反应慢了半拍，训练赛里年轻人开始打你的位置。`)
    yield 'step'
    endCareer(meta, 'retire')
    return
  }

  // 负债压力：家里的电话
  if (meta.cash < -30000) {
    L(meta, 'warn', `负债 ${fm(-meta.cash)}。家里的电话越来越频繁。`)
    yield 'step'
    if (rand() < 0.4) { L(meta, 'sys', '你妈说家里给你找了份工作。你没再说什么。'); yield 'step'; endCareer(meta, 'quit'); return }
    L(meta, 'sys', '你说再撑一年。')
  }

  // 主动退役：年纪到了、成绩一般，或者有的人就是想走
  if (p.age >= PRO_RETIRE_MIN_AGE && p.yearsPlayed >= 3) {
    const tired = (p.age >= 26 ? 0.12 : 0.03) + (p.yearScore < 6 ? 0.08 : 0) + (p.benchYears >= 2 ? 0.06 : 0)
    if (rand() < tired) {
      L(meta, 'sys', p.titles.world ? '你发了条微博：「该走了。谢谢每一个人。」' : '你发了条微博：「休息一下。」大家都懂。')
      yield 'step'
      endCareer(meta, 'retire')
      return
    }
  }

  // 转会窗：报价来了，自己挑
  const offers = makeOffers(meta, true)
  deadTeams.clear()
  if (cur && !offers.some((o) => o.teamId === cur.id)) {
    L(meta, 'warn', `【转会窗】${cur.name} 没给你续约。${rand() < 0.5 ? '经理发了段很长的话，意思是再见。' : '你从官博公告知道的。'}`)
    ach(meta, 'pro_cut')
    yield 'step'
  }
  const pick = pickOffer(meta, offers)
  if (pick) {
    if (offers.length > 1) L(meta, 'sys', `${offers.length} 份报价摆在桌上。`)
    applySign(meta, pick, true)
  } else {
    p.teamId = null
    p.idleYears++
    if (p.idleYears >= 2) {
      L(meta, 'warn', '连续两年没有队伍找你。')
      yield 'step'
      endCareer(meta, 'retire')
      return
    }
    L(meta, 'warn', '【转会窗】自由人。明年再看。')
  }
  yield 'step'
}

/** 年终写档 */
function commitYear(meta: MetaSave) {
  const p = meta.pro
  p.year++
  p.yearDone = false
  meta.cashLow = Math.min(meta.cashLow, meta.cash)
}
