/**
 * 一段人生。一季一步：生活消耗热情 → 实力成长 → 段位墙检定 → 段位跟随 → 事件 → 抉择 / 被发掘。
 * 被发掘后职业阶段接在同一条时间线上继续滚（pro.ts 全自动）。
 * 生成器驱动，UI 每 tick 调一次 lifeStep；遇到抉择停下等 lifeChoose。
 * 局内不写档；结束才 commit。刷新 = 这辈子重来。
 */
import type { Growth, LifeState, LogLine, MajorTier, MetaSave } from '../types'
import {
  ACH_PERKS, AGE_DECAY_PER_SEASON, BOOSTER_QUOTE, BOOST_LANDED_CASH, BOOST_SUSPEND_P, CHEAT_CATCH_MAX,
  CHEAT_CATCH_P, CREW_BONUS, DEFAULT_SPEED, EXP_BY_MAJOR, EXP_PRO, MAJOR_NAME,
  MARKET_BOOST_PASS, MARKET_CHEAT_PASS, MOMENTUM_PER_PCT, NEW_YEAR_PASSION, PASSION_START,
  PASSION_WARN_MULT, PERSONAS, QUIT_AGE, SCOUT_MAX_AGE, SCOUT_P, SEASONS_PER_YEAR, SLOPE_DECAY, STAGE_INFO, START_AGE,
  SWITCH_POOL_MULT, TALENT_INFO, TALENT_ORDER, TOP_MIN_GAMES, TRIAL_BASE,
  TRIAL_DIRTY_MULT, WALL_BASE, WALL_PASSION, ageMult, majorIndex, nextMajor, rankLabel,
} from '../data/constants'
import { clamp, gauss, irand, majorFloor, majorOf, rand, rankScore, scoreToRank } from './rank'
import { COMMON_EVENTS, DIRTY_EVENTS, EGG_EVENTS, LIFE_EVENTS, pickEvent } from '../data/events'
import { unlock } from './ach'
import { ACHIEVEMENTS } from '../data/achievements'
import { addExp, rollTalent, talentShift } from '../data/talent'
import { freshPro, startCareer } from './pro'
import { buildLifeEnding, type LifeEndReason } from '../data/endings'

const SAVE_KEY = 'ow-sim-meta-v5'
const OLD_KEYS = ['ow-sim-meta-v4', 'ow-sim-meta-v3', 'ow-sim-meta-v2', 'ow-sim-meta-v1']

/* ———————————— 档 ———————————— */

export function freshMeta(): MetaSave {
  return {
    runs: 0,
    achievements: {},
    endings: {},
    speed: DEFAULT_SPEED,
    manual: false,
    growth: { level: 0, exp: 0 },
    talentLog: { barrel: 0, normal: 0, something: 0, genius: 0, monster: 0 },
    reached: {},
    proBlockLives: 0,
    cheatLives: 0,
    bestPeakScore: 0,
    scoutedTimes: 0,
    cash: 0,
    fans: 0,
    dirty: { boostJobs: 0, hires: 0, cheatSeasons: 0 },
    cashLow: 0,
    pro: freshPro(),
  }
}

export function loadMeta(): MetaSave {
  const fresh = freshMeta()
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) {
      const m = { ...fresh, ...JSON.parse(raw) as MetaSave }
      // 旧成长（人生 / 英雄池 / 里程碑）折算成等级
      const og = (m.growth ?? {}) as Partial<Growth> & { runs?: number; heroPool?: number; milestones?: number }
      m.growth = typeof og.level === 'number'
        ? { level: og.level, exp: og.exp ?? 0 }
        : { level: Math.floor(((og.runs ?? 0) + (og.heroPool ?? 0) + (og.milestones ?? 0)) / 2), exp: 0 }
      m.pro = { ...fresh.pro, ...(m.pro ?? {}) }
      m.pro.titles = { ...fresh.pro.titles, ...(m.pro.titles ?? {}) }
      m.pro.log = []
      m.pro.highlights = []
      m.pro.choice = null
      m.pro.active = false
      m.talentLog = { ...fresh.talentLog, ...m.talentLog }
      m.dirty = { ...fresh.dirty, ...m.dirty }
      m.reached = m.reached ?? {}
      return m
    }
    // 迁移旧档：只保留成就 / 结局收集 / 设置
    for (const k of OLD_KEYS) {
      const old = localStorage.getItem(k)
      if (!old) continue
      const o = JSON.parse(old) as Partial<MetaSave> & { seasonsPlayed?: number }
      const m: MetaSave = { ...fresh, achievements: o.achievements ?? {}, endings: o.endings ?? {}, speed: o.speed ?? DEFAULT_SPEED, manual: o.manual ?? false }
      m.growth.level = Math.min(6, Math.floor((o.seasonsPlayed ?? 0) / 6))
      return m
    }
  } catch { /* ignore */ }
  return fresh
}

export function writeMeta(m: MetaSave) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(m))
}

export function achCount(meta: MetaSave): number {
  return Object.keys(meta.achievements).filter((k) => ACHIEVEMENTS.some((a) => a.id === k)).length
}

/** 下辈子天才 / 怪物合计上移的百分点 */
export function currentShift(meta: MetaSave): number {
  return talentShift(achCount(meta), meta.growth.level)
}

/** 已解锁的成就传承 */
export function perks(meta: MetaSave): Set<string> {
  const n = achCount(meta)
  return new Set(ACH_PERKS.filter((p) => n >= p.n).map((p) => p.id))
}

/* ———————————— 开局 ———————————— */

export function createLife(meta: MetaSave): LifeState {
  const persona = PERSONAS[irand(0, PERSONAS.length - 1)]
  const shift = currentShift(meta)
  const pk = perks(meta)
  let talent = meta.debugTalent
    ? { tier: meta.debugTalent, mmr: irand(TALENT_INFO[meta.debugTalent].start[0], TALENT_INFO[meta.debugTalent].start[1]) }
    : rollTalent(shift)
  let rerolled = false
  if (!meta.debugTalent && pk.has('reroll')) {
    const t2 = rollTalent(shift)
    if (TALENT_ORDER.indexOf(t2.tier) > TALENT_ORDER.indexOf(talent.tier)) { talent = t2; rerolled = true }
  }
  meta.debugTalent = undefined
  meta.pro.active = false
  const rich = pk.has('rich') && rand() < 0.3
  let passion = irand(PASSION_START[0], PASSION_START[1]) + (rich ? 150 : 0) + (pk.has('passion') ? 100 : 0)
  const ti = TALENT_INFO[talent.tier]
  const g: LifeState = {
    persona,
    talent: talent.tier,
    mmr: talent.mmr,
    rank: scoreToRank(talent.mmr * 0.85),
    momentum: 0,
    stuckSeasons: 0,
    stuckTotal: 0,
    peakScore: 0,
    peakMmr: talent.mmr,
    age: START_AGE,
    season: 0,
    seasonInYear: 0,
    stage: 'student',
    passion,
    passionMax: passion,
    gamesThisSeason: 0,
    gamesTotal: 0,
    cash: irand(800, 2000) + (rich ? 20000 : 0),
    fans: 0,
    pollution: 0,
    muteCount: 0,
    tally: {},
    reportStacks: 0,
    cheatClock: 0,
    spurtSeasons: 0,
    crewSeasons: 0,
    suspendedNext: false,
    achLocked: false,
    rich,
    fakeBoost: 0,
    dirty: { boostJobs: 0, hires: 0, cheatSeasons: 0 },
    boostEarned: 0,
    usedMarket: false,
    banned: false,
    scouted: false,
    refusedTrials: 0,
    choiceUsed: {},
    logs: [],
    highlights: [],
    choice: null,
    achieved: { ...meta.achievements },
    newAchievements: [],
    over: false,
  }
  g.logs.push({ cls: 'sys', text: `${START_AGE} 岁，第一次打排位。人设【${persona.name}】——${persona.tagline}。${rich ? '家里有钱，网费不是问题。' : ''}` })
  g.logs.push({ cls: 'talent', text: `天赋【${ti.name}】。${ti.range}——但没人告诉你。${rerolled ? '（传承：重摇取高）' : ''}` })
  g.highlights.push({ cls: 'talent', text: `天赋【${ti.name}】` })
  if (talent.tier === 'something') unlock(g, 'talent_something')
  if (talent.tier === 'genius') unlock(g, 'talent_genius')
  if (talent.tier === 'monster') unlock(g, 'talent_monster')
  if (rich) unlock(g, 'born_rich')
  return g
}

/* ———————————— 生成器驱动 ———————————— */

type Tick = 'step' | 'choice'
let gen: Generator<Tick, void, void> | null = null
let answer: string | null = null
const usedEvents = new Set<string>()

export function beginLife(meta: MetaSave, g: LifeState) {
  answer = null
  usedEvents.clear()
  gen = lifeGen(meta, g)
}

export function lifeStep(): Tick | 'done' {
  if (!gen) return 'done'
  const r = gen.next()
  if (r.done) { gen = null; return 'done' }
  return r.value
}

export function lifeChoose(g: LifeState, optionId: string) {
  g.choice = null
  answer = optionId
}

/* ———————————— 工具 ———————————— */

function L(g: LifeState, cls: string, text: string): LogLine {
  const l = { cls, text }
  g.logs.push(l)
  return l
}
function H(g: LifeState, l: LogLine) { g.highlights.push(l) }

function wallOf(mmr: number): { score: number; into: MajorTier } | null {
  const m = majorOf(mmr)
  const nxt = nextMajor(m)
  if (!nxt) return null
  return { score: majorFloor(nxt), into: nxt }
}

function breakChance(g: LifeState, into: MajorTier): number {
  const base = WALL_BASE[into] ?? 0.5
  const p = base + g.momentum / (MOMENTUM_PER_PCT * 100) + TALENT_INFO[g.talent].breakBonus + (g.crewSeasons > 0 ? CREW_BONUS : 0)
  return clamp(p, 0.03, 0.95)
}

function passionAdd(g: LifeState, d: number) {
  g.passion = Math.max(0, g.passion + d)
  if (d > 0) g.passionMax = Math.max(g.passionMax, g.passion)
}

function dirtyCount(g: LifeState) {
  return g.dirty.boostJobs + g.dirty.hires + g.dirty.cheatSeasons
}

function checkMilestones(g: LifeState) {
  const s = rankScore(g.rank)
  if (s > g.peakScore) g.peakScore = s
  if (g.mmr > g.peakMmr) g.peakMmr = g.mmr
  const mi = majorIndex(g.rank.major)
  if (mi >= majorIndex('diamond')) unlock(g, 'reach_diamond')
  if (mi >= majorIndex('master')) unlock(g, 'reach_master')
  if (mi >= majorIndex('gm')) unlock(g, 'reach_gm')
  if (mi >= majorIndex('champ')) unlock(g, 'reach_champ')
  if (g.rank.major === 'top') unlock(g, 'reach_top')
  if (g.fans >= 10000) unlock(g, 'fans_10k')
  if (g.fans >= 100000) unlock(g, 'fans_100k')
  if (g.stuckTotal >= 5) unlock(g, 'stuck5')
  if (g.cash <= 0 && g.stage === 'fulltime') unlock(g, 'broke')
}

function endLife(g: LifeState, reason: LifeEndReason) {
  // 开了挂还没被查到就想退坑？封号通知会追到邮箱里
  if (g.cheatClock > 0 && (reason === 'quit' || reason === 'age')) {
    L(g, 'ban', '退坑三个月后，邮箱里多了一封「账号处罚通知」。永久封停。')
    g.banned = true
    reason = 'banned'
  }
  g.ending = buildLifeEnding(g, reason)
  g.over = true
  L(g, 'ending', `【结局】${g.ending.title}`)
  for (const v of g.ending.verse) L(g, 'verse', v)
  H(g, { cls: 'ending', text: `【${g.ending.title}】` })
  const wasLocked = g.achLocked
  g.achLocked = false
  unlock(g, `end_${g.ending.id.replace(/_.*$/, '')}`)
  if (g.ending.id.startsWith('cloudmud')) {
    unlock(g, 'cloudmud_any')
    if (g.rank.major === 'plat') unlock(g, 'cloudmud_plat')
    if (g.rank.major === 'master') unlock(g, 'cloudmud_master')
  }
  g.achLocked = wasLocked
}

/* ———————————— 一辈子 ———————————— */

function* lifeGen(meta: MetaSave, g: LifeState): Generator<Tick, void, void> {
  yield 'step'
  while (!g.over) {
    yield* season(meta, g)
  }
}

function* season(meta: MetaSave, g: LifeState): Generator<Tick, void, void> {
  g.season++
  g.seasonInYear++
  if (g.seasonInYear > SEASONS_PER_YEAR) {
    g.seasonInYear = 1
    g.age++
    // 毕业：22 岁第一季
    if (g.age === 22 && g.stage === 'student') {
      g.stage = g.rich ? 'free' : 'worker'
      const l = L(g, 'warn', g.rich ? `【${g.age} 岁】毕业了。家里说不着急上班。` : `【${g.age} 岁】毕业上班。以后只能下班打，每季把数少了，但也不再靠生活费。`)
      H(g, l)
      unlock(g, g.rich ? 'stage_free' : 'stage_worker')
      yield 'step'
    }
    if (g.age >= QUIT_AGE) {
      L(g, 'sys', `${g.age} 岁。你把游戏留在硬盘里，很久没点开。`)
      yield 'step'
      endLife(g, 'age')
      return
    }
    // 软重置：显示段位对齐实力
    if (g.season > 1) {
      const before = rankScore(g.rank)
      const target = clamp(g.mmr + g.fakeBoost, 0, wallCap(g))
      g.rank = scoreToRank(before + (target - before) * 0.7)
      passionAdd(g, NEW_YEAR_PASSION)
      L(g, 'sys', `【${g.age} 岁】新的一年。软重置，重新定级。热情 +${NEW_YEAR_PASSION}。`)
      yield 'step'
    }
  }

  // 0. 被封 30 天：这季停打
  if (g.suspendedNext) {
    g.suspendedNext = false
    passionAdd(g, -40)
    g.rank = scoreToRank(Math.max(0, rankScore(g.rank) - 60))
    L(g, 'ban', `S${g.season} · 被封的 30 天。你在直播间看别人打。热情 −40。`)
    yield 'step'
    if (g.passion <= 0) { endLife(g, 'quit'); return }
    return
  }

  // 1. 生活消耗热情
  const info = STAGE_INFO[g.stage]
  const want = Math.round(info.games * (0.9 + rand() * 0.2))
  const games = Math.min(want, g.passion)
  g.gamesThisSeason = games
  g.gamesTotal += games
  passionAdd(g, -games)
  const lowNote = g.passion <= 0 ? ' · 热情见底' : g.passion < info.games * PASSION_WARN_MULT ? ' · 有点不想打了' : ''
  L(g, 'sys', `S${g.season} · ${g.age} 岁 · ${info.name} · 打了 ${games} 把${lowNote}`)

  // 2. 实力成长
  const ti = TALENT_INFO[g.talent]
  const polMult = g.pollution > 30 ? 0.95 : 1
  const gamesMult = Math.sqrt(Math.max(1, games) / 100)
  const spurt = g.spurtSeasons > 0 ? SWITCH_POOL_MULT : 1
  let delta = ti.slope * SLOPE_DECAY[majorOf(g.mmr)] * ageMult(g.age) * info.slope * gamesMult * polMult * spurt + gauss(ti.sigma)
  if (g.age > 30) delta -= AGE_DECAY_PER_SEASON
  if (games < 20) delta = Math.min(delta, 0)
  if (g.spurtSeasons > 0) g.spurtSeasons--
  const before = rankScore(g.rank)
  const beforeMajor = g.rank.major

  // 3. 墙
  const wall = wallOf(g.mmr)
  let wallLine: LogLine | null = null
  if (wall && g.mmr + delta >= wall.score) {
    g.momentum += g.mmr + delta - (wall.score - 1)
    g.mmr = wall.score - 1
    const needGames = wall.into === 'top' && games < TOP_MIN_GAMES
    const p = needGames ? 0 : breakChance(g, wall.into)
    if (rand() < p) {
      g.mmr = wall.score + Math.max(10, g.momentum * 0.6)
      const bonus = WALL_PASSION[wall.into] ?? 50
      passionAdd(g, bonus)
      g.momentum = 0
      g.stuckSeasons = 0
      wallLine = { cls: 'win', text: `【突破】${MAJOR_NAME[wall.into]}！这游戏又好玩了。热情 +${bonus}。` }
      H(g, { cls: 'win', text: `突破 ${MAJOR_NAME[wall.into]}` })
    } else {
      g.stuckSeasons++
      g.stuckTotal++
      wallLine = { cls: 'warn', text: needGames ? `顶尖 500 是榜单，这季只打了 ${games} 把，胜场不够上榜。` : `卡在${MAJOR_NAME[wall.into]}门口。${g.stuckSeasons > 1 ? `第 ${g.stuckSeasons} 季了。` : '差一口气。'}` }
    }
  } else {
    if (delta < 0 && g.momentum > 0) g.momentum *= 0.5
    g.mmr = clamp(g.mmr + delta, 0, 4600)
    if (g.stuckSeasons > 0 && g.mmr < (wall?.score ?? 0) - 150) g.stuckSeasons = 0
  }
  if (g.crewSeasons > 0) g.crewSeasons--

  // 4. 段位跟随
  const target = clamp(g.mmr + g.fakeBoost, 0, 4600)
  let sr = before + (target - before) * (g.season <= 1 ? 0.85 : 0.55) + gauss(40)
  const cap = wallCap(g)
  if (g.fakeBoost <= 0) {
    sr = Math.min(sr, cap)
    if (g.stuckSeasons > 0) sr = cap - (rand() < 0.4 ? 0 : irand(1, 12))
  }
  g.rank = scoreToRank(clamp(sr, 0, 4600))
  if (g.fakeBoost !== 0) g.fakeBoost = Math.abs(g.fakeBoost) < 30 ? 0 : g.fakeBoost * 0.5
  const after = rankScore(g.rank)
  const gap = g.mmr - after
  const mods = g.season <= 1 ? '校准' : gap > 200 ? `逆风局 ×${irand(4, 12)} · 安慰奖 ×${irand(3, 9)}，系统欠你分` : gap < -200 ? '预期 · 大逆转，段位虚高' : after >= 4000 ? '压力，顶端分难涨' : '五五开'
  const cls = after > before + 20 ? 'win' : after < before - 20 ? 'lose' : 'sys'
  L(g, cls, `${rankLabel(scoreToRank(before))} → ${rankLabel(g.rank)} ｜ ${mods}`)
  if (g.rank.major !== beforeMajor && !wallLine) {
    const up = majorIndex(g.rank.major) > majorIndex(beforeMajor)
    const l = L(g, up ? 'ev' : 'warn', `${up ? '【升段】' : '【掉段】'}${MAJOR_NAME[beforeMajor]} → ${MAJOR_NAME[g.rank.major]}`)
    if (!up) H(g, l)
  }
  if (wallLine) L(g, wallLine.cls, wallLine.text)
  yield 'step'

  // 5. 黑市的账
  if (g.cheatClock > 0) {
    g.cheatClock--
    if (g.cheatClock === 0 || rand() < CHEAT_CATCH_P) {
      L(g, 'ban', '【封号】登录时跳出一行字：该账号因使用第三方程序被永久封停。申诉入口是灰的。')
      g.banned = true
      yield 'step'
      endLife(g, 'banned')
      return
    }
  } else if (g.reportStacks > 0 && rand() < BOOST_SUSPEND_P) {
    g.reportStacks--
    g.suspendedNext = true
    const who = ['对面举报了共享账号', '代练同一时段登录了两个省', '有人把你的对局录像发给了客服'][irand(0, 2)]
    L(g, 'ban', `【封号 30 天】${who}。段位保留，下季停打。`)
    unlock(g, 'suspended')
    yield 'step'
  }

  // 6. 事件
  const n = rand() < 0.25 ? 0 : rand() < 0.7 ? 1 : 2
  for (let i = 0; i < n; i++) {
    const r = rand()
    const dirtyP = 0.15 + Math.min(0.35, g.pollution / 100)
    let ev: LogLine | null
    if (r < 0.06) ev = pickEvent(g, EGG_EVENTS, usedEvents)
    else if (r < 0.2) ev = pickEvent(g, LIFE_EVENTS, usedEvents)
    else if (r < 0.2 + dirtyP) ev = pickEvent(g, DIRTY_EVENTS, new Set())
    else ev = pickEvent(g, COMMON_EVENTS, new Set())
    if (ev) { g.logs.push(ev); yield 'step' }
  }
  g.pollution = Math.max(0, g.pollution - 3)
  checkMilestones(g)

  // 7. 上岸
  if (g.boostEarned >= BOOST_LANDED_CASH) { endLife(g, 'landed'); return }

  // 8. 被发掘：开挂 / 被职业圈拉黑的人，没人私信
  if (!g.scouted && g.age <= SCOUT_MAX_AGE && !g.banned && g.dirty.cheatSeasons === 0 && meta.proBlockLives <= 0) {
    const pr = SCOUT_P[g.rank.major]
    const mult = perks(meta).has('scout') ? 1.5 : 1
    if (pr && rand() < pr * mult + Math.min(0.1, g.fans / 100000)) {
      yield* scouting(g)
      if (g.over) return
    }
  }

  // 9. 死线（唯一会弹出来的抉择）：热情不够下一季，且卡墙
  const nextGames = STAGE_INFO[g.stage].games
  const wallNow = wallOf(g.mmr)
  if (g.passion < nextGames && g.passion > 0 && (g.stuckSeasons > 0 || g.momentum > 0) && wallNow && !g.choiceUsed.deadline) {
    g.choiceUsed.deadline = true
    yield* deadline(g, wallNow.into)
    if (g.over) return
  }

  // 10. 退坑
  if (g.passion <= 0) {
    L(g, 'sys', '你卸载了。')
    yield 'step'
    endLife(g, 'quit')
    return
  }
}

/** 卡墙时段位的天花板：墙下 1 分 */
function wallCap(g: LifeState): number {
  const w = wallOf(g.mmr)
  return w ? w.score - 1 : 4600
}

/* ———————————— 死线抉择 ———————————— */

function* deadline(g: LifeState, into: MajorTier): Generator<Tick, void, void> {
  const q = BOOSTER_QUOTE.find((b) => majorIndex(g.rank.major) <= majorIndex(b.maxMajor)) ?? BOOSTER_QUOTE[BOOSTER_QUOTE.length - 1]
  g.choice = {
    id: 'deadline',
    title: '再打一季，可能就不想打了',
    body: `热情只剩 ${g.passion}，卡在${MAJOR_NAME[into]}门口。私信里那条代练广告还在。`,
    options: [
      { id: 'grind', label: '硬肝最后一季', cls: 'primary', sub: `突破概率 ${Math.round(breakChance(g, into) * 100)}%` },
      { id: 'boost', label: `${q.name}带过去`, cls: 'warn', sub: `${q.price} 一把 · 过墙 ${Math.round(MARKET_BOOST_PASS * 100)}% · 留下举报记录，职业背调能翻到` },
      { id: 'cheat', label: '开挂', cls: 'danger', sub: `免费 · 过墙 ${Math.round(MARKET_CHEAT_PASS * 100)}% · 迟早永封，成就不再计入` },
      { id: 'quit', label: '就此退坑' },
    ],
  }
  yield 'choice'
  const a = answer ?? 'grind'
  answer = null
  if (a === 'quit') { L(g, 'sys', '你想了想，把游戏删了。'); yield 'step'; endLife(g, 'quit'); return }
  if (a === 'grind') { L(g, 'sys', '你决定自己打。'); yield 'step'; return }
  const cheat = a === 'cheat'
  g.usedMarket = true
  if (cheat) {
    g.dirty.cheatSeasons++
    unlock(g, 'cheat_on')
    g.achLocked = true
    g.cheatClock = CHEAT_CATCH_MAX
  } else {
    g.dirty.hires++
    g.reportStacks += 3
    g.cash -= q.price * 20
    unlock(g, 'first_hire')
  }
  const l = L(g, 'warn', cheat ? '你下了个东西。第一把就 40 杀。从这一刻起，这辈子的成就不再计入。' : `你把号给了${q.name}。手机上看着自己的 ID 在飞。`)
  H(g, l)
  yield 'step'
  if (rand() < (cheat ? MARKET_CHEAT_PASS : MARKET_BOOST_PASS)) {
    const wall = wallOf(g.mmr)!
    g.fakeBoost = wall.score + irand(30, 90) - g.mmr
    g.rank = scoreToRank(g.mmr + g.fakeBoost)
    const bonus = Math.round((WALL_PASSION[into] ?? 50) * 0.5)
    passionAdd(g, bonus)
    L(g, 'win', `${MAJOR_NAME[into]}到了。不是你打的，但图标是真的。热情 +${bonus}。`)
    L(g, 'sys', cheat ? '举报在堆。反作弊不是不查，是攒着查。' : '实力没变。接下来系统会一季一季把分修正回去——除非你自己追上来。')
    unlock(g, 'fake_wall')
  } else {
    L(g, 'lose', '没过。钱花了，段位还在原地。')
  }
  yield 'step'
}

/* ———————————— 被发掘 ———————————— */

function* scouting(g: LifeState): Generator<Tick, void, void> {
  const l = L(g, 'career', `【私信】一个自称青训教练的人：「看了你最近的场次，有兴趣来试训吗？」${dirtyCount(g) ? '你知道自己账号上有什么，还是回了「好」。' : '你回了「好」。'}`)
  H(g, l)
  yield 'step'
  L(g, 'career', '你坐了六个小时高铁。基地在写字楼十七层，训练室里六台电脑。')
  yield 'step'
  let p = clamp(TRIAL_BASE + TALENT_INFO[g.talent].breakBonus + (majorIndex(g.rank.major) >= majorIndex('champ') ? 0.15 : 0) + (g.rank.major === 'top' ? 0.15 : 0), 0.2, 0.95)
  if (g.dirty.hires + g.dirty.boostJobs > 0) {
    p *= TRIAL_DIRTY_MULT
    L(g, 'warn', '背调翻出了代练记录。教练看了你一眼，没说话。')
    yield 'step'
  }
  if (rand() < p) {
    const l2 = L(g, 'ending', '【试训通过】教练说：「下周来报到。」天梯到此为止。')
    H(g, l2)
    g.scouted = true
    g.scoutedAt = { age: g.age, rank: { ...g.rank } }
    unlock(g, 'scouted')
    g.over = true
    yield 'step'
  } else {
    L(g, 'warn', '试训没过。教练说：「再练练，明年再来。」')
    passionAdd(g, 40)
    yield 'step'
  }
}

/* ———————————— 写档 ———————————— */

/** 这辈子的经验：最高段位 + 被发掘 */
export function lifeExp(g: LifeState): number {
  return EXP_BY_MAJOR[scoreToRank(g.peakScore).major] + (g.scouted ? EXP_PRO.scouted : 0)
}

/**
 * 人生结束写回全局档；返回是否进职业（进了就由 pro.ts 接手，另开一页）。
 * 返回值里带这辈子的经验与升级数，给结算页用。
 */
export function commitLife(g: LifeState, meta: MetaSave): { toPro: boolean; exp: number; ups: number } {
  meta.runs++
  meta.talentLog[g.talent] = (meta.talentLog[g.talent] ?? 0) + 1
  if (!meta.bestTalent || TALENT_ORDER.indexOf(g.talent) > TALENT_ORDER.indexOf(meta.bestTalent)) meta.bestTalent = g.talent
  meta.bestPeakScore = Math.max(meta.bestPeakScore, g.peakScore)
  if (g.dirty.cheatSeasons > 0) meta.cheatLives++
  if (meta.proBlockLives > 0) meta.proBlockLives--
  if (g.scouted) meta.scoutedTimes++

  for (const id of g.newAchievements) meta.achievements[id] = true

  const exp = lifeExp(g)
  const ups = addExp(meta.growth, exp)

  if (g.ending) {
    meta.lastEndingId = g.ending.id
    meta.endings[g.ending.id] = (meta.endings[g.ending.id] ?? 0) + 1
  }

  if (g.scouted) {
    meta.cash = g.cash
    meta.fans = g.fans
    meta.dirty = { ...g.dirty }
    meta.cashLow = Math.min(0, g.cash)
    startCareer(meta, g.age, g.talent)
    if (perks(meta).has('pro')) meta.pro.talentBonus += 3
  }
  return { toPro: g.scouted, exp, ups }
}
