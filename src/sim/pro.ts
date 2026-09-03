/**
 * 职业阶段：从天梯人生被发掘后接上。以「年」为单位：年初摇状态 → 三个 Stage 逐场滚动 → 年末转会窗（自动挑）。
 * 全程滚屏，没有抉择；转会 / 板凳 / 假赛 / 宫斗 / 解散全是随机事件。
 * 由 life.ts 驱动：beginYear → proStep 直到 'done' → commitYear；生涯结束写 ending。
 */
import type { Form, LogLine, MetaSave, ProOffer, ProState, StageResult, TalentTier, Team } from '../types'
import {
  EXPOSED_BLOCK_LIVES, EXPOSED_SUSPEND, FMVP_P, FORM_INFO, FORM_ORDER, HELL_DEBT, HELL_RETURN_INCOME, INTL_MULT, INTL_NAME, INTL_PLACE, INTL_PRIZE, MATE_NAMES,
  PRO_DECLINE_AGE, PRO_FORCE_RETIRE_AGE, PRO_GROWTH_CAP, PRO_IDLE_EXPENSE, PRO_RETIRE_MIN_AGE,
  SALARY, STAGE_PRIZE, TALENT_PRO_BONUS, TEAMS,
} from '../data/constants'
import { clamp, irand, rand } from './rank'
import { ACH_MAP } from '../data/achievements'
import { buildProEnding, type ProEndReason } from '../data/endings'

/* ———————————— 档 ———————————— */

export function freshPro(): ProState {
  return {
    runs: 0, active: false, age: 17, year: 0, teamId: null, salary: 0,
    form: 'ok', skill: 55, fame: 0, benchYears: 0, idleYears: 0, yearScore: 0, history: [],
    titles: { regional: 0, intl: 0, world: 0, worldCup: 0, fmvp: 0 }, fixes: 0, suspended: 0, growth: 0, talentBonus: 0, income: 0,
    clean: true, ending: null, lifetimeBan: false, yearsPlayed: 0, log: [], highlights: [], choice: null,
    yearDone: false, stageAt: 0, endings: {},
  }
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
export function startCareer(meta: MetaSave, age: number, talent: TalentTier) {
  const p = meta.pro
  const keep = { runs: p.runs + 1, growth: p.growth, lifetimeBan: p.lifetimeBan, endings: p.endings }
  Object.assign(p, freshPro(), keep)
  p.age = age
  p.talentBonus = TALENT_PRO_BONUS[talent]
  p.fame = meta.fans
  p.active = true
  for (const k of Object.keys(teamMods)) delete teamMods[k]
  deadTeams.clear()
  gen = null
}

/* ———————————— 生成器驱动 ———————————— */

type Tick = 'step'
let gen: Generator<Tick, void, void> | null = null

/** 开始（或刷新后重打）本年 */
export function beginYear(meta: MetaSave) {
  const p = meta.pro
  p.log = []
  p.highlights = []
  p.choice = null
  p.yearDone = false
  p.stageAt = 0
  gen = yearGen(meta)
}

export function yearInProgress(): boolean {
  return gen !== null
}

/** 推进一步。返回 'step'（继续）/ 'done'（本年结束或生涯结束）。全自动，没有抉择。 */
export function proStep(): Tick | 'done' {
  if (!gen) return 'done'
  const r = gen.next()
  if (r.done) { gen = null; return 'done' }
  return r.value
}

/* ———————————— 工具 ———————————— */

const MAPS = ['里阿尔托', '努巴尼', '好莱坞', '国王大道', '漓江塔', '伊利奥斯', '尼泊尔', '直布罗陀', '66号公路', '巴黎', '新皇后街', '科洛塞', '伊斯佩兰萨', '多拉多', '花村', '阿努比斯神殿']
const WIN_MOMENTS = ['最后一波抢下决胜点', '你一个大招清了三个', '加时守住了', '第三图打到 99:99 拿下', '对面换阵你们跟上了', '教练暂停之后连扳两图']
const LOSE_MOMENTS = ['推车差 0.3 米', '被对面辅助大招翻盘', '教练喊了暂停也没救回来', '对面 C 位手感爆炸', '你的英雄被 ban 了，换手打得别扭', '对面换阵你们没跟上', '第三图打到 99:99 丢了']
const OPP = ['韩国队', '北美队', '欧洲队', '日本队', '沙特队']
const map = () => MAPS[irand(0, MAPS.length - 1)]
const moment = (win: boolean) => (win ? WIN_MOMENTS : LOSE_MOMENTS)[irand(0, (win ? WIN_MOMENTS : LOSE_MOMENTS).length - 1)]
/** 本生涯里散掉 / 解约过的队：当年不再报价 */
const deadTeams = new Set<string>()
const mate = () => MATE_NAMES[irand(0, MATE_NAMES.length - 1)]
const fm = (n: number) => n.toLocaleString()

function L(meta: MetaSave, cls: string, text: string): LogLine {
  const line = { cls, text }
  meta.pro.log.push(line)
  return line
}
function H(meta: MetaSave, line: LogLine) { meta.pro.highlights.push(line) }

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
  p.ending = buildProEnding(meta, reason)
  p.active = false
  p.endings[p.ending.id] = (p.endings[p.ending.id] ?? 0) + 1
  meta.endings[p.ending.id] = (meta.endings[p.ending.id] ?? 0) + 1
  meta.lastEndingId = p.ending.id
  H(meta, { cls: 'ending', text: `【${p.ending.title}】` })
  ach(meta, `pro_end_${p.ending.id}`)
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
    const pr = t.partner ? clamp((value - need) / 40 + 0.1, 0, 0.6) : clamp((value - need) / 30 + 0.22, 0.03, 0.75)
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
  // 年初：摇状态
  p.form = rollForm(p.growth + p.talentBonus, p.age)
  p.skill = irand(FORM_INFO[p.form].min, FORM_INFO[p.form].max)
  L(meta, 'talent', `【第 ${p.year + 1} 年 · ${p.age} 岁】本年状态【${FORM_INFO[p.form].name}】`)
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
      L(meta, 'warn', `没有队。这一年在网吧、陪练和直播里过去了。开销 −${fm(PRO_IDLE_EXPENSE)}。`)
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
      const t = teamOf(p.teamId)!
      L(meta, 'career', `【OWCS 中国赛区 · 第 ${p.year + 1} 年 Stage ${stage}】${t.name}`)
      yield 'step'
      if (p.suspended > 0) {
        p.suspended--
        const r: StageResult = { year: p.year + 1, stage, team: t.name, place: 0, intl: 0, prize: 0, note: '禁赛' }
        p.history.push(r)
        L(meta, 'ban', `【禁赛期】你在看台上看完了整个 Stage。`)
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

/** Stage 前的随机事件；可能带抉择 */
function* stageEvent(meta: MetaSave, stage: 1 | 2 | 3): Generator<Tick, EventOut, void> {
  const p = meta.pro
  const t = teamOf(p.teamId)!
  const out: EventOut = { skip: false, temp: 0, bench: false }
  const r = rand()
  const push = (cls: string, text: string, hl = false) => { const l = L(meta, cls, text); if (hl) H(meta, l) }

  if (r < 0.06) {
    // 假赛邀约：缺钱的人更容易点头
    const money = irand(8, 25) * 10000
    push('warn', `陌生人加了你：「这个 Stage 小组赛放两场，${fm(money)}，事成打款。」附一张转账截图当定金。`)
    yield 'step'
    const takeP = meta.cash < -20000 ? 0.55 : meta.cash < 0 ? 0.25 : 0.06
    if (rand() < takeP) {
      meta.cash += money
      p.income += money
      p.fixes++
      p.clean = false
      out.temp = -15
      push('ban', `你收了 ${fm(money)}。小组赛该输的都输了。`, true)
      ach(meta, 'pro_fix')
      if (rand() < 0.35) {
        push('ban', '【官方公告】赛事监察部门比对投注数据，认定你参与操纵比赛。永久禁赛。', true)
        p.lifetimeBan = true
        p.banReason = '参与操纵比赛。'
        p.teamId = null
        addFame(meta, -Math.round(p.fame * 0.7))
        endCareer(meta, 'fix_ruin')
        return out
      }
    } else {
      addFame(meta, 800)
      push('career', '你把截图发给了队长。队长转发给了官方。人气 +800。', true)
      ach(meta, 'pro_fix_refused')
    }
    yield 'step'
    return out
  }
  if (r < 0.10) { push('warn', `【宫斗】${mate()} 和 ${mate()} 为首发位置闹到教练组，训练赛打成两派。你在中间。`); out.temp = -6; yield 'step'; return out }
  if (r < 0.13) { teamMods[t.id] = (teamMods[t.id] ?? 0) - 4; push('warn', `【被挖】主力 ${mate()} 被${TEAMS[irand(0, 3)].name}挖走，队里少了个能开团的。`); yield 'step'; return out }
  if (r < 0.16) { teamMods[t.id] = (teamMods[t.id] ?? 0) + 4; push('career', `【补强】战队签下韩援 ${mate()}。训练赛开始赢了。`); yield 'step'; return out }
  if (r < 0.19) {
    // 抱团：别家凑出超级队
    const big = TEAMS[irand(0, 3)]
    if (big.id !== t.id) { teamMods[big.id] = (teamMods[big.id] ?? 0) + 6; push('warn', `【抱团】${big.name} 一口气签了三个国家队选手。解说说这个 Stage 悬念不大。`); yield 'step'; return out }
  }
  if (r < 0.22) {
    // enjoy：队伍摆烂
    push('warn', `【enjoy】老板不投钱了，队里训练赛改成每天两小时。${mate()} 直播比训练时间长。`)
    out.temp = -8
    yield 'step'
    return out
  }
  if (r < 0.25) {
    // 板凳
    push('warn', `【板凳】教练换了体系，这个 Stage 你坐替补席。首发是刚签的 ${mate()}。`, true)
    out.bench = true
    p.benchYears++
    yield 'step'
    return out
  }
  if (r < 0.27) {
    // 脱粉
    addFame(meta, -Math.round(p.fame * 0.25))
    push('warn', `【脱粉】你直播说了句「这游戏也就这样」，粉丝群一夜掉了四分之一。`)
    yield 'step'
    return out
  }
  if (r < 0.29) {
    // 被优化
    push('ban', `【优化】俱乐部签了新人，经理约你谈话：「合同剩下的部分我们照付。」你被挂上了转会名单。`, true)
    p.teamId = null
    p.yearScore = 0
    ach(meta, 'pro_cut')
    out.skip = true
    yield 'step'
    return out
  }
  if (r < 0.31) { push('career', `【首发】首发 ${mate()} 手伤，你顶上。教练说：「打出来就是你的。」`); out.temp = 4; yield 'step'; return out }
  if (r < 0.34) {
    push('ban', `【官方公告】队友 ${mate()} 被查出在预选赛收钱放水。${t.name} 本 Stage 取消资格。`, true)
    addFame(meta, -Math.round(p.fame * 0.2))
    const res: StageResult = { year: p.year + 1, stage, team: t.name, place: 0, intl: 0, prize: 0, note: '全队取消资格' }
    p.history.push(res)
    ach(meta, 'pro_teammate_fix')
    if (rand() < 0.2) {
      push('ban', '监察部门认为你知情不报。追加禁赛两个 Stage。', true)
      p.suspended = 2
      addFame(meta, -Math.round(p.fame * 0.3))
    }
    out.skip = true
    yield 'step'
    return out
  }
  if (r < 0.36) { push('warn', '【伤病】手腕腱鞘炎复发。医生说这个 Stage 别碰鼠标。', true); out.bench = true; yield 'step'; return out }
  if (r < 0.38) { push('warn', `【禁赛】你直播口嗨对手，被官方禁赛一场。`); out.temp = -3; yield 'step'; return out }
  if (r < 0.40) {
    push('ban', '【丑闻】你的私聊记录被人挂上热搜。俱乐部连夜发公告：「经协商，双方解除合同。」', true)
    addFame(meta, -Math.round(p.fame * 0.3))
    deadTeams.add(t.id)
    p.teamId = null
    p.yearScore = 0
    ach(meta, 'pro_scandal')
    out.skip = true
    yield 'step'
    return out
  }
  if (r < 0.42) {
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
  if (r < 0.47) { const c = irand(5, 20) * 1000; meta.cash += c; p.income += c; push('career', `【赞助】外设品牌个人代言到账 +${fm(c)}。`); yield 'step'; return out }
  return out
}

/** 一个 Stage：预选（合作队 S1 免）→ 循环赛 → 双败 → 国际赛。每个系列赛一步 */
function* runStage(meta: MetaSave, stage: 1 | 2 | 3, temp: number, bench: boolean): Generator<Tick, void, void> {
  const p = meta.pro
  const t = teamOf(p.teamId)!
  const res: StageResult = { year: p.year + 1, stage, team: t.name, place: 0, intl: 0, prize: 0, bench }
  const you = teamStrength(meta, temp) + (bench ? -8 : 0)
  const say = (cls: string, text: string) => L(meta, cls, text)
  const tag = bench ? '（你在替补席）' : ''

  let alive = true
  if (!(t.partner && stage === 1)) {
    const opps = Array.from({ length: 7 }, () => irand(35, 78))
    const s1 = series(you, opps[0], 3)
    say(s1.win ? 'win' : 'lose', `公开预选 · 瑞士轮首轮 · ${map()} ${s1.score}，${moment(s1.win)}。${tag}`)
    yield 'step'
    const s2 = series(you, opps[1], 3)
    say(s2.win ? 'win' : 'lose', `瑞士轮第二轮 · ${map()} ${s2.score}。`)
    yield 'step'
    let pl: number
    const wins = (s1.win ? 1 : 0) + (s2.win ? 1 : 0)
    if (wins === 2) pl = irand(1, 3)
    else if (wins === 0) pl = 8
    else {
      const s3 = series(you, opps[2], 3)
      say(s3.win ? 'win' : 'lose', `瑞士轮决胜轮 · ${map()} ${s3.score}，${moment(s3.win)}。`)
      yield 'step'
      pl = s3.win ? irand(4, 6) : 7
    }
    if (pl <= 6) say('career', `瑞士轮第 ${pl}，晋级常规赛。`)
    else { alive = false; res.place = pl; say('warn', `瑞士轮第 ${pl}，止步预选。`) }
    yield 'step'
  } else {
    say('sys', '合作战队 Stage 1 免预选，直接进常规赛。')
    yield 'step'
  }

  if (alive) {
    const opps = Array.from({ length: 5 }, () => irand(45, 86))
    const others = TEAMS.filter((x) => x.id !== t.id).sort(() => Math.random() - 0.5)
    let rw = 0
    for (let i = 0; i < 3; i++) {
      const s = series(you, opps[i], 3)
      if (s.win) rw++
      say(s.win ? 'win' : 'lose', `常规赛 · 对阵${others[i].name} · ${map()} ${s.score}，${moment(s.win)}。`)
      yield 'step'
    }
    ach(meta, 'pro_regular')
    // 名次跟着展示出来的三场走：3 胜前二，2 胜大多进季后赛，1 胜边缘，0 胜垫底
    const pl = rw === 3 ? irand(1, 2) : rw === 2 ? irand(2, 4) : rw === 1 ? irand(4, 5) : irand(5, 6)
    if (pl <= 4) {
      say('career', `常规赛第 ${pl}，进入四队双败季后赛。`)
      ach(meta, 'pro_playoffs')
      yield 'step'
      const semi = series(you, irand(60, 92), 5)
      say(semi.win ? 'win' : 'lose', `季后赛胜者组 · ${map()} ${semi.score}，${moment(semi.win)}。`)
      yield 'step'
      if (semi.win) {
        const final = series(you, irand(68, 95), 5)
        say(final.win ? 'win' : 'lose', `地区决赛 · ${map()} ${final.score}，${moment(final.win)}。`)
        res.place = final.win ? 1 : 2
      } else {
        const lower = series(you, irand(55, 88), 5)
        say(lower.win ? 'win' : 'lose', `败者组 · ${map()} ${lower.score}。`)
        yield 'step'
        if (lower.win) {
          const final = series(you, irand(68, 95), 5)
          say(final.win ? 'win' : 'lose', `败者组决赛 · ${map()} ${final.score}。`)
          res.place = final.win ? 2 : 3
        } else res.place = 4
      }
      yield 'step'
    } else {
      res.place = pl
      say('sys', `常规赛第 ${pl}，无缘季后赛。`)
      yield 'step'
    }
  }

  res.prize = STAGE_PRIZE[res.place] ?? 0
  if (bench) res.prize = Math.round(res.prize * 0.4)
  const fameGain = (res.place === 1 ? 15000 : res.place === 2 ? 8000 : res.place <= 4 && res.place > 0 ? 3000 : 500) * (bench ? 0.3 : 1)
  addFame(meta, fameGain)
  if (res.place === 1) { p.titles.regional++; ach(meta, 'pro_regional_champ') }
  const line = L(meta, res.place === 1 ? 'ending' : 'career', `Stage ${stage} 地区名次 ${res.place || '预选出局'}${res.prize ? `，奖金分成 +${fm(res.prize)}` : ''}。${tag}`)
  H(meta, line)
  yield 'step'

  if (res.place > 0 && res.place <= 2) {
    const name = INTL_NAME[stage]
    say('career', `【${name} · ${INTL_PLACE[stage]}】地区前二出线。`)
    yield 'step'
    if (exposureCheck(meta, '国际赛资格审查')) return
    if (!p.teamId) { say('warn', `队伍带着替补去了${name}。你在家看的直播。`); yield 'step'; return }
    const opps = Array.from({ length: 7 }, () => irand(stage === 3 ? 72 : 68, 94))
    const foes = [...OPP].sort(() => Math.random() - 0.5)
    let gw = 0
    for (let i = 0; i < 2; i++) {
      const s = series(you, opps[i], 5)
      if (s.win) gw++
      say(s.win ? 'win' : 'lose', `${name} 小组赛 · 对阵${foes[i]} · ${map()} ${s.score}，${moment(s.win)}。`)
      yield 'step'
    }
    let ip: number
    if (gw === 0) { ip = irand(7, 8); say('sys', `${name} 小组赛出局。`) }
    else if (gw === 1) {
      const dec = series(you, opps[2], 5)
      say(dec.win ? 'win' : 'lose', `${name} 小组决胜 · 对阵${foes[2]} · ${map()} ${dec.score}。`)
      yield 'step'
      if (!dec.win) { ip = irand(5, 6); say('sys', `${name} 小组赛出局。`) } else ip = 0
    } else ip = 0
    if (ip === 0) {
      const semi = series(you, opps[5], 5)
      say(semi.win ? 'win' : 'lose', `${name} 半决赛 · 对阵${foes[3]} · ${map()} ${semi.score}，${moment(semi.win)}。`)
      yield 'step'
      if (semi.win) {
        const fin = series(you, opps[6], 5)
        say(fin.win ? 'win' : 'lose', `${name} 决赛 · 对阵${foes[4]} · ${map()} ${fin.score}，${moment(fin.win)}。`)
        yield 'step'
        ip = fin.win ? 1 : 2
      } else ip = irand(3, 4)
    }
    res.intl = ip
    const ipz = Math.round((INTL_PRIZE[ip] ?? 0) * INTL_MULT[stage]) * (bench ? 0.4 : 1)
    res.prize += ipz
    addFame(meta, (ip === 1 ? 100000 : ip <= 4 ? 30000 : 10000) * (bench ? 0.3 : 1))
    ach(meta, 'pro_intl')
    if (ip <= 2) p.titles.intl++
    if (ip === 1) {
      p.titles.world++
      ach(meta, stage === 3 ? 'pro_world_champ' : 'pro_intl_champ')
    }
    const il = L(meta, ip <= 2 ? 'ending' : 'career', `${name} 最终名次 ${ip}${ipz ? `，奖金 +${fm(ipz)}` : ''}。`)
    H(meta, il)
    yield 'step'
    // FMVP：世界总决赛冠军且状态在线以上才有资格摇
    if (ip === 1 && stage === 3 && !bench && rand() < (FMVP_P[p.form] ?? 0)) {
      p.titles.fmvp++
      addFame(meta, 150000)
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

/* ———————————— 年末 ———————————— */

function* yearEnd(meta: MetaSave): Generator<Tick, void, void> {
  const p = meta.pro
  const cur = teamOf(p.teamId)
  p.yearsPlayed++
  p.growth = Math.min(PRO_GROWTH_CAP, p.growth + 1 + (p.yearScore >= 16 ? 1 : 0))

  if (cur && p.yearScore >= 14 && rand() < 0.3) {
    p.titles.worldCup++
    addFame(meta, 30000)
    const l = L(meta, 'ending', '【国家队】世界杯名单公布，有你。')
    H(meta, l)
    ach(meta, 'pro_worldcup')
    yield 'step'
  }

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
  if (p.age >= PRO_DECLINE_AGE && rand() < 0.12 * (p.age - PRO_DECLINE_AGE + 1)) {
    L(meta, 'warn', `${p.age} 岁，手速和反应都在告诉你：到时候了。`)
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
export function commitYear(meta: MetaSave) {
  const p = meta.pro
  p.year++
  p.yearDone = false
  meta.cashLow = Math.min(meta.cashLow, meta.cash)
}
