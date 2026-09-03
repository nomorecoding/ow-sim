import type { GameState, Identity, LogLine, MatchResult, MetaSave, Persona, RankModifier, TalentTier } from '../types'
import {
  ACH_PER_HERO_POOL, BASE_QUOTA, BOOST_LANDED_CASH, BOOST_PER_MATCH, CP_PER_WIN, CP_SEASON_REWARD, DEBT_INTEREST,
  DEFAULT_SPEED, GUN_COST, HELL_DEBT, HELL_RETURN_INCOME, HELPER_TIERS, INIT_CASH, INIT_CREDIT, INTL_NAME, MAJOR_NAME,
  MOD_LABEL, OWN_TEAM_ROSTER_COST, OWN_TEAM_SPONSOR_PER_FAN, PERSONAS, PLACEMENT_GAMES, PRO_GROWTH_BONUS,
  PRO_TALENT_FLOOR, QUOTA_MOD_MAX, QUOTA_MOD_MIN, REGULAR_WEEKS, RIVALRY_WEEKS, SEASONS_PER_YEAR, SOFT_RESET_EVERY,
  STAGE_INFO, START_AGE_MAX, START_AGE_MIN, STREAM_INCOME_PER_FAN, TALENT_INFO, TALENT_ORDER, majorIndex, rankLabel,
} from '../data/constants'
import {
  applyRp, bumpConf, clamp, emptyRank, helperWinProb, irand, maybeEnableCloudMud, rand, rankScore, rpChange,
  scoreToRank, snapTowardCloudMud, temperedRpDelta, temperedShouldWin, tryFinishCloudMud, winProb, TOP_SCORE,
} from './rank'
import { BLACK_EVENTS, CAREER_EVENTS, CLEAN_EVENTS, DIRTY_EVENTS, LIFE_EVENTS, pickEvent } from '../data/events'
import { unlock } from './ach'
import { ACHIEVEMENTS } from '../data/achievements'
import { growthPoints, rollTalent } from '../data/talent'
import { addFans, checkScouting, freshCareer, runStage, runTrial, salary, yearEnd } from './career'
import { describeHelper } from './shop'
import {
  buildBannedEnding, buildBronzeEnding, buildHellReturnEnding, buildLandedEnding, buildRetireEnding, buildTopEnding,
  buildWorldChampEnding,
} from '../data/endings'

const SAVE_KEY = 'ow-sim-meta-v4'
const OLD_KEYS = ['ow-sim-meta-v3', 'ow-sim-meta-v2', 'ow-sim-meta-v1']

const POLLUTION_MAX = 100

/** 分数里程碑 */
const SC = {
  diamond: 5 * 500, master: 6 * 500, gm: 7 * 500, champ: 8 * 500, top: 9 * 500,
  /** 软重置回拉中心：白金 3 */
  center: 3 * 500 + 250,
}

export function freshMeta(): MetaSave {
  return {
    playtimeTotal: 0,
    seasonsPlayed: 0,
    achievements: {},
    endings: {},
    speed: DEFAULT_SPEED,
    manual: false,
    age: irand(START_AGE_MIN, START_AGE_MAX),
    year: 1,
    seasonInYear: 1,
    growth: { seasons: 0, heroPool: 0, gear: 0, training: 0 },
    career: freshCareer(),
    talentLog: { barrel: 0, normal: 0, something: 0, genius: 0, monster: 0 },
    cash: INIT_CASH,
    credit: INIT_CREDIT,
    compPoints: 0,
    fans: 0,
    dirty: { boostJobs: 0, hires: 0, cheatSeasons: 0 },
    cashLow: INIT_CASH,
    reachedGM: false,
    snooze: {},
    seen: {},
    goldGuns: 0,
    jadeGuns: 0,
    jadeThisYear: false,
    envPollution: 0,
    lastResetSeason: 0,
    quotaMod: 0,
    stage: 'student',
    careerBanned: false,
    boostEarnedTotal: 0,
    bansTotal: 0,
    accountNo: 1,
  }
}

export function loadMeta(): MetaSave {
  const fresh = freshMeta()
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (raw) {
      const m = { ...fresh, ...JSON.parse(raw) as MetaSave }
      m.growth = { ...fresh.growth, ...m.growth }
      m.career = { ...fresh.career, ...m.career }
      m.talentLog = { ...fresh.talentLog, ...m.talentLog }
      m.dirty = { ...fresh.dirty, ...m.dirty }
      m.snooze = m.snooze ?? {}
      m.seen = m.seen ?? {}
      return m
    }
    // 迁移旧档：保留赛季数 / 时长 / 成就 / 速度设置；数值尺度变了，钱重置
    for (const k of OLD_KEYS) {
      const old = localStorage.getItem(k)
      if (!old) continue
      const o = JSON.parse(old) as Partial<MetaSave>
      return {
        ...fresh,
        playtimeTotal: o.playtimeTotal ?? 0,
        seasonsPlayed: o.seasonsPlayed ?? 0,
        achievements: o.achievements ?? {},
        speed: o.speed ?? DEFAULT_SPEED,
        manual: o.manual ?? false,
      }
    }
  } catch { /* ignore */ }
  return fresh
}

export function writeMeta(m: MetaSave) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(m))
}

export function pickPersona(): Persona {
  return PERSONAS[irand(0, PERSONAS.length - 1)]
}

export function labelIdentity(id: Identity) {
  return ({ casual: '路人', boost: '代练', cheat: '外挂' } as const)[id]
}

export function isSoftResetSeason(meta: MetaSave): boolean {
  return meta.seasonsPlayed > 0 && meta.seasonsPlayed - meta.lastResetSeason >= SOFT_RESET_EVERY
}

/** 本季是哪个 OWCS Stage（第 2/4/6 季末），否则 0 */
export function stageOfSeason(seasonInYear: number): 0 | 1 | 2 | 3 {
  if (seasonInYear === 2) return 1
  if (seasonInYear === 4) return 2
  if (seasonInYear === 6) return 3
  return 0
}

export function createSeason(meta: MetaSave, identity: Identity): GameState {
  const p = pickPersona()
  const stage = meta.stage
  const quota = Math.max(60, BASE_QUOTA + STAGE_INFO[stage].quota + meta.quotaMod + irand(-10, 15))

  const points = growthPoints(meta.growth, meta.age)
  // 签约期间：战队训练环境 → 成长加成 + 硬兜底「有点东西」，职业选手在钻石–英杰浮动
  const pro = meta.career.phase === 'signed'
  const talent = meta.debugTalent
    ? { tier: meta.debugTalent, mmr: irand(TALENT_INFO[meta.debugTalent].min, TALENT_INFO[meta.debugTalent].max) }
    : rollTalent(pro ? points + PRO_GROWTH_BONUS : points, pro ? PRO_TALENT_FLOOR : undefined)
  meta.debugTalent = undefined

  const softReset = isSoftResetSeason(meta)
  let anchor: number
  if (!meta.lastRank) anchor = SC.center + irand(-150, 150)
  else if (softReset) anchor = SC.center + (rankScore(meta.lastRank) - SC.center) * 0.35
  else anchor = rankScore(meta.lastRank) - 120

  const logs: LogLine[] = [
    { cls: 'sys', text: `S${meta.seasonsPlayed + 1} 开赛 · 第 ${meta.year} 年第 ${meta.seasonInYear} 季 · ${meta.age} 岁 · ${STAGE_INFO[stage].name}` },
    { cls: 'sys', text: `人设【${p.name}】——${p.tagline}。额度 ${quota} 把，先打 ${PLACEMENT_GAMES} 把定级。` },
  ]
  const ti = TALENT_INFO[talent.tier]
  logs.push({ cls: 'talent', text: `本季天赋：【${ti.name}】（${ti.range}）。系统会慢慢知道你有多强。` })
  if (!meta.lastRank && meta.seasonsPlayed > 0) logs.push({ cls: 'sys', text: `新账号 #${meta.accountNo}。段位从零开始。` })
  else if (softReset) logs.push({ cls: 'sys', text: '本赛季软重置：定级向黄金/白金回拉。' })
  else if (meta.lastRank) logs.push({ cls: 'sys', text: `上赛季 ${rankLabel(meta.lastRank)}，定级参考此锚点。` })

  const g: GameState = {
    persona: p,
    identity,
    rank: emptyRank('gold', 3, 20),
    talent: talent.tier,
    mmr: talent.mmr,
    conf: 0,
    anchorScore: anchor,
    protectedDiv: null,
    age: meta.age,
    year: meta.year,
    seasonInYear: meta.seasonInYear,
    cash: meta.cash,
    credit: meta.credit,
    compPoints: meta.compPoints,
    fans: meta.fans,
    playtime: 0,
    envPollution: meta.envPollution,
    redBox: false,
    muteLeft: 0,
    muteCount: 0,
    careerBanned: meta.careerBanned,
    dirty: { ...meta.dirty },
    cheatedThisSeason: false,
    proIncome: 0,
    cashLow: meta.cashLow,
    reportStacks: 0,
    banned: false,
    season: meta.seasonsPlayed + 1,
    phase: 'placement',
    week: 1,
    quotaLeft: quota,
    quotaMax: quota,
    placementLeft: PLACEMENT_GAMES,
    placementWins: 0,
    matchesThisSeason: 0,
    wins: 0,
    cloudMudAim: false,
    logs,
    events: [],
    helper: null,
    lastHelper: null,
    marketPrompted: false,
    marketHint: null,
    helperDone: false,
    endedEarly: false,
    highlights: [],
    winStreak: 0,
    loseStreak: 0,
    bestStreak: 0,
    worstStreak: 0,
    stage,
    dirtyThisSeason: false,
    boostEarned: 0,
    quotaModDelta: 0,
    achieved: { ...meta.achievements },
    newAchievements: [],
    peakScore: 0,
    modCount: {},
    career: JSON.parse(JSON.stringify(meta.career)),
    scoutedThisSeason: false,
  }
  g.highlights.push({ cls: 'talent', text: `天赋【${ti.name}】` })

  if (talent.tier === 'something') unlock(g, 'talent_something')
  if (talent.tier === 'genius') unlock(g, 'talent_genius')
  if (talent.tier === 'monster') unlock(g, 'talent_monster')

  // 开赛前预订的帮手：第一把就上号
  if (meta.preorder) {
    g.helper = { ...meta.preorder }
    g.lastHelper = { ...meta.preorder }
    g.dirtyThisSeason = true
    g.dirty.hires++
    g.envPollution += meta.preorder.kind === 'boost' ? 6 : 3 * meta.preorder.count
    logs.push({ cls: 'ev', text: `【预订到位】${describeHelper(g.helper)}已上号，定级赛一起打。` })
    meta.preorder = undefined
  }
  if (identity === 'boost') g.dirty.boostJobs++

  // 试训
  if (g.career.phase === 'scouted' && g.career.team) {
    if (identity !== 'casual') {
      g.career.phase = 'none'
      g.career.team = undefined
      logs.push({ cls: 'warn', text: '战队看到你在接代练单，试训取消。' })
    } else runTrial(g, logs)
  }
  if (g.career.phase === 'signed') {
    logs.push({ cls: 'career', text: `${g.career.team!.name} 选手。${stageOfSeason(g.seasonInYear) ? `本季末打 OWCS Stage ${stageOfSeason(g.seasonInYear)}。` : '本季是训练季，赛季末没有正赛。'}` })
  }
  return g
}

function rivalry(g: GameState) {
  return g.phase === 'rivalry'
}

function advancePhase(g: GameState) {
  const played = g.quotaMax - g.quotaLeft
  const regularQuota = Math.floor(g.quotaMax * (REGULAR_WEEKS / (REGULAR_WEEKS + RIVALRY_WEEKS)))
  if (g.phase === 'placement') return
  if (g.phase === 'regular' && played >= regularQuota) {
    g.phase = 'rivalry'
    g.week = REGULAR_WEEKS + 1
    const mi = majorIndex(g.rank.major)
    g.events.push({ cls: 'sys', text: `进入竞逐周：负面事件↑，胜率承压${mi >= 6 ? '（高段位竞逐更狠）' : ''}。` })
  }
}

function countMod(g: GameState, m: RankModifier) {
  g.modCount[m] = (g.modCount[m] ?? 0) + 1
}

function checkMilestones(g: GameState) {
  const s = rankScore(g.rank)
  if (s > g.peakScore) g.peakScore = s
  if (s >= SC.diamond) unlock(g, 'reach_diamond')
  if (s >= SC.master) unlock(g, 'reach_master')
  if (s >= SC.gm) unlock(g, 'reach_gm')
  if (s >= SC.champ) unlock(g, 'reach_champ')
  if (g.rank.major === 'top') unlock(g, 'reach_top')
  if (g.winStreak >= 10) unlock(g, 'streak10')
  if (g.loseStreak >= 10) unlock(g, 'lose10')
  if (g.muteCount >= 3) unlock(g, 'muted3')
  if (g.cash >= 100000) unlock(g, 'rich')
  if (g.cash >= 1000000) unlock(g, 'millionaire')
  if (g.cash <= 0) unlock(g, 'broke')
  if (g.fans >= 10000) unlock(g, 'fans_10k')
  if (g.fans >= 100000) unlock(g, 'fans_100k')
  g.cashLow = Math.min(g.cashLow, g.cash)
  if ((g.modCount.reversal ?? 0) >= 40) unlock(g, 'reversal10')
  if ((g.modCount.uphill ?? 0) >= 80) unlock(g, 'uphill20')
  if ((g.modCount.demotion_protect ?? 0) >= 25) unlock(g, 'protect5')
  if ((g.modCount.pressure_down ?? 0) + (g.modCount.pressure_up ?? 0) > 0) unlock(g, 'pressure')
}

function modText(mods: RankModifier[]): string {
  if (!mods.length) return ''
  return ' ｜ ' + mods.map((m) => `${MOD_LABEL[m].text}${MOD_LABEL[m].dir === 'up' ? '↑' : MOD_LABEL[m].dir === 'down' ? '↓' : '·'}`).join(' ')
}

/** 黑市提醒：首次 4 连败，或系统已识别你却还低于真实水平一个大段 */
function maybeMarketHint(g: GameState) {
  if (g.marketPrompted || g.helper || g.identity !== 'casual' || g.phase === 'placement') return
  if (g.career.phase === 'signed') return
  const sr = rankScore(g.rank)
  if (g.loseStreak >= 4) {
    g.marketPrompted = true
    g.marketHint = `${g.loseStreak} 连败。私信弹出来一条：「哥，看你连跪了，钻石陪玩 8 块一把，要不要试试？」`
  } else if (g.conf >= 0.5 && g.mmr - sr >= 500) {
    g.marketPrompted = true
    g.marketHint = '你明显打得比段位好，但分就是上不去。有人私信：「兄弟这段位卡你了，代练上分要不要？」'
  }
}

export function playMatch(g: GameState): MatchResult {
  const logs: LogLine[] = []
  const events: LogLine[] = []
  if (g.banned || g.quotaLeft <= 0) {
    return { win: false, rpDelta: 0, modifiers: [], log: [{ cls: 'sys', text: '无法继续对局。' }], events: [] }
  }

  maybeEnableCloudMud(g)

  const rivalryOn = rivalry(g) || (g.phase !== 'placement' && g.quotaLeft <= Math.ceil(g.quotaMax * 0.15))
  const boosting = g.helper?.kind === 'boost' && g.helper.left > 0
  let p = winProb(g, rivalryOn)
  if (g.phase === 'placement' && !boosting) p = clamp(0.5 + (p - 0.5) * 0.7, 0.3, 0.7)

  const win = temperedShouldWin(g, p)
  const rc = rpChange(g, win)
  let rpDelta = temperedRpDelta(g, win, rc.delta)
  const mods = [...rc.mods]

  if (win) { g.winStreak++; g.loseStreak = 0; g.wins++; g.compPoints += CP_PER_WIN }
  else { g.loseStreak++; g.winStreak = 0 }
  g.bestStreak = Math.max(g.bestStreak, g.winStreak)
  g.worstStreak = Math.max(g.worstStreak, g.loseStreak)

  const n = g.matchesThisSeason + 1
  const who = boosting ? `代练 · ${HELPER_TIERS.find((t) => t.id === g.helper!.tier)?.name ?? ''}` : g.helper?.kind === 'escort' && g.helper.left > 0 ? `${g.helper.count} 陪 1` : ''

  if (g.phase === 'placement') {
    if (win) g.placementWins++
    g.placementLeft--
    logs.push({
      cls: win ? 'win' : 'lose',
      text: `第${n}把 · 定级 ${PLACEMENT_GAMES - g.placementLeft}/${PLACEMENT_GAMES} · ${win ? '胜利' : '失败'}${who ? ` · ${who}` : ''}`,
    })
    if (g.placementLeft <= 0) finishPlacement(g, logs)
  } else {
    const before = g.rank.major
    const dm = applyRp(g, rpDelta)
    if (dm) mods.push(dm)
    for (const m of mods) countMod(g, m)
    const tag = rivalryOn ? '竞逐' : '常规'
    const streak = g.winStreak >= 3 ? ` · ${g.winStreak}连胜` : g.loseStreak >= 3 ? ` · ${g.loseStreak}连败` : ''
    logs.push({
      cls: win ? 'win' : 'lose',
      text: `第${n}把 · ${tag} · ${win ? '胜利' : '失败'} · ${rankLabel(g.rank)}（${rpDelta >= 0 ? '+' : ''}${rpDelta}）${who ? ` · ${who}` : ''}${streak}${modText(mods)}`,
    })
    if (g.rank.major !== before) {
      const up = majorIndex(g.rank.major) > majorIndex(before)
      const line = { cls: up ? 'ev' : 'warn', text: `${up ? '【升段】' : '【掉段】'}${MAJOR_NAME[before]} → ${MAJOR_NAME[g.rank.major]}` }
      events.push(line)
      g.highlights.push(line)
    }
    if (g.rank.major === 'top' && !g.achieved['reach_top']) {
      const line = { cls: 'ending', text: '【顶尖 500】你的 ID 上榜了。' }
      events.push(line)
      g.highlights.push(line)
    }
  }
  bumpConf(g)

  // 举报
  const pol = Math.min(POLLUTION_MAX, g.envPollution)
  let reportP = 0
  if (g.identity === 'cheat') reportP = 0.07 + g.reportStacks * 0.002
  else if (g.identity === 'boost') reportP = 0.035 + pol * 0.0006
  else if (boosting) reportP = 0.04
  else if (g.helper?.kind === 'escort' && g.helper.left > 0) reportP = 0.015 + pol * 0.0004
  else if (pol > 30) reportP = 0.01 + pol * 0.0003
  if (reportP > 0 && rand() < reportP) {
    g.reportStacks++
    const why = g.identity === 'cheat' ? '开挂局更容易被点。' : g.identity === 'boost' ? '老板的号在被盯。' : boosting ? '账号共享被标记。' : g.helper ? '被带的号总有人看不惯。' : '脏匹配池在反噬。'
    events.push({ cls: 'warn', text: `举报+1（累计 ${g.reportStacks}）。${why}` })
  }

  // 禁言
  if (g.redBox) {
    g.muteLeft--
    if (g.muteLeft <= 0) {
      g.redBox = false
      g.muteLeft = 0
      events.push({ cls: 'sys', text: '禁言到期，红框解除。下次骂人前先掂量。' })
    }
  } else if (g.identity !== 'cheat' && !boosting) {
    const rageP = 0.012 + g.persona.metrics.rage * 0.0003 + (rivalryOn ? 0.03 : 0) + (g.loseStreak >= 3 ? 0.02 : 0)
    if (rand() < rageP) {
      g.redBox = true
      g.muteCount++
      g.muteLeft = irand(12, 24)
      g.credit = Math.max(0, g.credit - 2)
      const line = { cls: 'red', text: `【禁言 ${g.muteLeft} 把】你骂了疑似挂哥，对方没事，你被红框禁言。信誉-2。` }
      events.push(line)
      if (g.muteCount === 1) g.highlights.push(line)
    }
  }

  // 封号
  if (g.identity === 'cheat' && (g.reportStacks >= 14 || rand() < 0.0015 + g.reportStacks * 0.0005)) {
    g.banned = true
    events.push({ cls: 'ban', text: '【封号】官方验证通过，本号已封。赛季强制结束。' })
  } else if ((g.identity === 'boost' || boosting) && g.reportStacks >= 12) {
    g.banned = true
    events.push({ cls: 'ban', text: boosting ? '【封号】账号共享被判定，连带封停。赛季强制结束。' : '【封号】代练账号被连带查封。赛季强制结束。' })
  }

  // 钱：代练身份按把结算；路人的钱来自赛季收支与事件
  if (g.identity === 'boost') { const c = irand(BOOST_PER_MATCH[0], BOOST_PER_MATCH[1]); g.cash += c; g.boostEarned += c }
  g.credit = Math.min(200, g.credit)

  // 帮手计数：打完套餐 → UI 弹「续单 / 提前结束 / 自己打」
  if (g.helper && g.helper.left > 0) {
    g.helper.left--
    if (g.helper.left === 0) {
      events.push({ cls: 'ev', text: g.helper.kind === 'boost' ? '代练下号了。接下来这个段位得你自己守，系统会慢慢把分修正回真实水平。' : '陪玩下线了。之后得靠自己了。' })
      g.helper = null
      if (g.quotaLeft > 1 && !g.banned) g.helperDone = true
    }
  }

  // 环境：封顶；不碰黑市时每 10 把自净 1
  g.envPollution = Math.min(POLLUTION_MAX, g.envPollution)
  if (!g.dirtyThisSeason && g.envPollution > 0 && g.matchesThisSeason % 10 === 9) g.envPollution--

  g.quotaLeft--
  g.matchesThisSeason++
  g.playtime++
  advancePhase(g)

  if (g.phase !== 'placement') {
    checkScouting(g, events)
    if (rand() < (rivalryOn ? 0.32 : 0.2)) {
      const ev = rollEvent(g, rivalryOn)
      if (ev) events.push(ev)
    }
    checkMilestones(g)
    maybeMarketHint(g)
  }

  if (g.quotaLeft <= 0 || g.banned) logs.push(...settleSeason(g))

  g.logs.push(...logs)
  g.events.push(...events)
  return { win, rpDelta, modifiers: mods, log: logs, events }
}

/** 定级：上赛季锚点 + 本季天赋 + 胜场；新号最高落点宗师 5 */
function finishPlacement(g: GameState, logs: LogLine[]) {
  const w = g.placementWins
  let score = g.anchorScore * 0.6 + g.mmr * 0.4 + (w - 5) * 40 + irand(-40, 40)
  if (g.identity === 'cheat' && w >= 6) score += 150
  score = clamp(score, 0, SC.gm + 40)
  g.rank = scoreToRank(score)
  g.peakScore = score
  g.phase = 'regular'
  g.week = 1
  g.conf = 0.3
  const line = { cls: 'sys', text: `定级结束：${w} 胜。落点 ${rankLabel(g.rank)}。进入常规赛季。` }
  logs.push(line)
  g.highlights.push({ cls: 'sys', text: `定级 ${rankLabel(g.rank)}` })
}

function rollEvent(g: GameState, rivalryOn: boolean): LogLine | null {
  const r = rand()
  if (r < 0.1) return pickEvent(g, LIFE_EVENTS)
  if (g.career.phase === 'signed' && r < 0.4) return pickEvent(g, CAREER_EVENTS)
  if ((g.identity === 'boost' || g.identity === 'cheat' || g.helper) && r < 0.45) return pickEvent(g, BLACK_EVENTS)
  const dirty = g.envPollution > 35 || g.dirtyThisSeason
  return pickEvent(g, rivalryOn || dirty ? DIRTY_EVENTS : CLEAN_EVENTS)
}

/** 提前结束赛季：锁定当前段位，剩余额度作废（少了事件与竞技点，人气按峰值算） */
export function endSeasonEarly(g: GameState): boolean {
  if (g.phase === 'placement' || g.phase === 'settle' || g.banned) return false
  g.endedEarly = true
  g.helperDone = false
  g.marketHint = null
  const skipped = g.quotaLeft
  g.quotaLeft = 0
  g.logs.push({ cls: 'sys', text: `【提前收官】你不打了，锁定 ${rankLabel(g.rank)}。剩余 ${skipped} 把作废。` })
  unlock(g, 'ended_early')
  g.logs.push(...settleSeason(g))
  return true
}

const INCOME_NAME: Record<GameState['stage'], string> = {
  student: '生活费', worker: '工资', dropout: '', streamer: '零星打赏', free: '理财', coach: '教练工资',
}

/** 赛季固定收支：按人生阶段 + 主播人气 + 主播队 + 负债利息 */
function seasonFinance(g: GameState, logs: LogLine[]) {
  const info = STAGE_INFO[g.stage]
  const parts: string[] = []
  let income = irand(info.income[0], info.income[1])
  if (income && INCOME_NAME[g.stage]) parts.push(`${INCOME_NAME[g.stage]} +${income}`)
  const own = g.career.phase === 'signed' && g.career.team?.own
  if (g.stage === 'streamer' || own) {
    const s = Math.round(g.fans * STREAM_INCOME_PER_FAN)
    if (s) { income += s; parts.push(`直播 +${s}`) }
  }
  let expense = info.expense
  if (expense) parts.push(`生活开销 −${expense}`)
  if (own) {
    const sp = Math.round(g.fans * OWN_TEAM_SPONSOR_PER_FAN)
    income += sp
    g.proIncome += sp
    parts.push(`赞助 +${sp}`, `队友底薪 −${OWN_TEAM_ROSTER_COST}`)
    expense += OWN_TEAM_ROSTER_COST
  }
  g.cash += income - expense
  if (g.cash < 0) {
    const interest = Math.round(-g.cash * DEBT_INTEREST)
    g.cash -= interest
    parts.push(`利息 −${interest}`)
    unlock(g, 'debt')
    if (g.cash <= -100000) unlock(g, 'debt_deep')
  }
  g.cashLow = Math.min(g.cashLow, g.cash)
  if (parts.length) logs.push({ cls: g.cash < 0 ? 'warn' : 'sys', text: `赛季收支：${parts.join('，')}。现金 ${g.cash.toLocaleString()}${g.cash < 0 ? '（负债）' : ''}。` })
}

/** 人气：按峰值段位涨，主播 ×3；不播不打职业会慢慢掉 */
function fansSeason(g: GameState, logs: LogLine[]) {
  const mi = majorIndex(scoreToRank(g.peakScore).major)
  let gain = [5, 10, 20, 40, 70, 120, 250, 700, 1500, 5000][mi] ?? 5
  if (g.stage === 'streamer') gain *= 2
  if (g.bestStreak >= 10) gain += 200
  if (g.banned) gain = -Math.round(g.fans * 0.15)
  else if (g.stage !== 'streamer' && g.career.phase !== 'signed') gain -= Math.round(g.fans * 0.05)
  addFans(g, gain)
  if (Math.abs(gain) >= 100) logs.push({ cls: 'sys', text: `人气 ${gain >= 0 ? '+' : ''}${gain.toLocaleString()}（现在 ${g.fans.toLocaleString()}）。` })
}

export function settleSeason(g: GameState): LogLine[] {
  const logs: LogLine[] = []
  g.phase = 'settle'
  if (g.quotaLeft <= 0 && !g.banned && !g.endedEarly) snapTowardCloudMud(g)
  logs.push({ cls: 'sys', text: `赛季结算。最终 ${rankLabel(g.rank)}，最高 ${rankLabel(scoreToRank(g.peakScore))}，${g.wins}/${g.matchesThisSeason} 胜${g.endedEarly ? '，提前收官' : ''}。` })

  const ti = TALENT_INFO[g.talent]
  const real = scoreToRank(g.mmr)
  logs.push({ cls: 'talent', text: `本季真实水平（隐藏 MMR）：${rankLabel(real)}。天赋【${ti.name}】。${rankScore(g.rank) < g.mmr - 300 ? '系统还没给你应得的分。' : rankScore(g.rank) > g.mmr + 300 ? '你的段位高于真实水平，下赛季会被修正。' : '段位与水平基本一致。'}` })

  // 竞技点季末奖励
  if (!g.banned && g.matchesThisSeason >= PLACEMENT_GAMES) {
    const cp = CP_SEASON_REWARD[g.rank.major]
    g.compPoints += cp
    logs.push({ cls: 'sys', text: `赛季奖励：竞技点 +${cp}（累计 ${g.compPoints}）。` })
  }

  unlock(g, 'first_season')
  if (g.age >= 25) unlock(g, 'age_25')
  if (g.age >= 30) unlock(g, 'age_30')

  // 收支与人气
  seasonFinance(g, logs)
  fansSeason(g, logs)

  // 职业线
  const cleanRun = g.dirty.boostJobs === 0 && g.dirty.hires === 0 && g.dirty.cheatSeasons === 0 && !g.cheatedThisSeason
  if (g.career.phase === 'signed' && !g.banned) {
    const pay = salary(g)
    if (pay) {
      g.cash += pay
      g.proIncome += pay
      logs.push({ cls: 'career', text: `底薪到账 +${pay.toLocaleString()}。` })
    }
    const st = stageOfSeason(g.seasonInYear)
    if (st) {
      runStage(g, st, logs)
      const last = g.career.history[g.career.history.length - 1]
      const worldChamp = last?.intl === 1 && g.career.phase === 'signed'
      // 地狱归来：曾负债两万以下，干干净净，单季职业收入 30 万或国际赛冠军
      if (cleanRun && g.cashLow <= HELL_DEBT && (worldChamp || g.proIncome >= HELL_RETURN_INCOME) && !g.achieved['hell_return']) {
        unlock(g, 'hell_return')
        g.ending = buildHellReturnEnding(g, g.cashLow, g.proIncome)
      } else if (worldChamp) g.ending = buildWorldChampEnding(g, INTL_NAME[st])
    }
  }
  if (g.seasonInYear === SEASONS_PER_YEAR && !g.banned) {
    yearEnd(g, logs)
    if (g.career.phase === 'retired' && g.career.retiredYear === g.year && !g.ending) g.ending = buildRetireEnding(g)
  }

  const s = rankScore(g.rank)
  if (!g.ending && g.rank.major === 'top') g.ending = buildTopEnding(g)
  if (!g.ending && g.banned) g.ending = buildBannedEnding(g)
  if (!g.ending && g.identity === 'boost' && g.boostEarned >= BOOST_LANDED_CASH) {
    g.ending = buildLandedEnding(g)
    unlock(g, 'booster_landed')
  }
  if (!g.ending && !g.endedEarly) {
    const mud = tryFinishCloudMud(g)
    if (mud.length) {
      logs.push(...mud)
      unlock(g, 'cloudmud_any')
      if (g.rank.major === 'plat') unlock(g, 'cloudmud_plat')
      if (g.rank.major === 'master') unlock(g, 'cloudmud_master')
    } else if (g.cloudMudAim) {
      logs.push({ cls: 'temper', text: '命运想卡你 99 分，但你偏了——也许是幸事。' })
    }
  }
  if (!g.ending && g.rank.major === 'bronze' && s < 100) {
    g.ending = buildBronzeEnding(g)
    unlock(g, 'bronze_end')
  }

  if (g.identity === 'cheat' && !g.banned) unlock(g, 'cheat_survive')
  if (!g.dirtyThisSeason && g.credit >= 80) unlock(g, 'clean_season')

  if (g.ending) {
    logs.push({ cls: 'ending', text: `【结局】${g.ending.title}` })
    for (const v of g.ending.verse) logs.push({ cls: 'verse', text: v })
  }

  // 高光汇总
  if (g.bestStreak >= 6) g.highlights.push({ cls: 'win', text: `${g.bestStreak} 连胜` })
  if (g.worstStreak >= 6) g.highlights.push({ cls: 'lose', text: `${g.worstStreak} 连败` })
  for (const e of g.events) if (e.cls === 'career' || e.cls === 'ban') g.highlights.push(e)
  // 结算阶段的职业线大事：试训 / 签约 / 名次 / 国际赛 / 转会 / 解散 / 禁赛 / 退役
  for (const l of logs) {
    if (l.cls === 'ban' || l.cls === 'ending') g.highlights.push(l)
    else if ((l.cls === 'career' || l.cls === 'warn') && /名次|【签约】|【试训】.*没签|【转会窗】|【解散】|【退役】|【假赛】|【组队】|【年末】/.test(l.text)) g.highlights.push(l)
  }
  return logs
}

/** 赛季写回档案（只调用一次） */
export function commitSeason(g: GameState, meta: MetaSave) {
  meta.playtimeTotal += g.playtime
  meta.seasonsPlayed++
  if (isSoftResetSeason({ ...meta, seasonsPlayed: meta.seasonsPlayed - 1 })) meta.lastResetSeason = meta.seasonsPlayed - 1

  meta.cash = g.cash
  meta.credit = g.credit
  meta.compPoints = g.compPoints
  meta.fans = g.fans
  meta.cashLow = Math.min(meta.cashLow, g.cashLow, g.cash)
  meta.dirty = { ...g.dirty, cheatSeasons: g.dirty.cheatSeasons + (g.cheatedThisSeason ? 1 : 0) }
  if (g.peakScore >= SC.gm) meta.reachedGM = true
  meta.envPollution = Math.max(0, Math.min(POLLUTION_MAX, g.envPollution - (g.dirtyThisSeason ? 3 : 8)))
  meta.stage = g.stage
  meta.quotaMod = clamp(meta.quotaMod + g.quotaModDelta, QUOTA_MOD_MIN, QUOTA_MOD_MAX)
  meta.boostEarnedTotal += g.boostEarned
  if (g.careerBanned) meta.careerBanned = true
  meta.career = JSON.parse(JSON.stringify(g.career))

  // 成长
  meta.growth.seasons++
  if (g.career.phase === 'signed' && stageOfSeason(g.seasonInYear)) meta.growth.training++
  meta.talentLog[g.talent] = (meta.talentLog[g.talent] ?? 0) + 1
  const order = TALENT_ORDER
  if (!meta.bestTalent || order.indexOf(g.talent) > order.indexOf(meta.bestTalent)) meta.bestTalent = g.talent

  // 年龄 / 年份
  meta.seasonInYear++
  if (meta.seasonInYear > SEASONS_PER_YEAR) {
    meta.seasonInYear = 1
    meta.year++
    meta.age++
    meta.jadeThisYear = false
  }

  if (g.banned) {
    meta.bansTotal++
    meta.lastRank = undefined
    meta.accountNo++
    meta.compPoints = 0
    if (meta.career.phase === 'signed' || meta.career.phase === 'scouted') {
      meta.career.phase = 'none'
      meta.career.team = undefined
    }
    meta.preorder = undefined
  } else {
    meta.lastRank = { ...g.rank }
  }

  for (const id of g.newAchievements) meta.achievements[id] = true
  if (meta.bansTotal >= 1) meta.achievements['banned_first'] = true
  if (meta.bansTotal >= 3) meta.achievements['banned_3'] = true
  const achCount = Object.keys(meta.achievements).filter((k) => ACHIEVEMENTS.some((a) => a.id === k)).length
  meta.growth.heroPool = Math.floor(achCount / ACH_PER_HERO_POOL)

  if (g.ending) {
    meta.lastEndingId = g.ending.id
    meta.endings[g.ending.id] = (meta.endings[g.ending.id] ?? 0) + 1
  }
}

/** 3000 竞技点换金枪 */
export function buyGoldGun(meta: MetaSave): LogLine {
  if (meta.compPoints < GUN_COST) return { cls: 'sys', text: `竞技点不足：金枪需要 ${GUN_COST}，你有 ${meta.compPoints}。` }
  meta.compPoints -= GUN_COST
  meta.goldGuns++
  meta.achievements['gold_gun'] = true
  if (meta.goldGuns >= 5) meta.achievements['gold_gun5'] = true
  return { cls: 'ev', text: `换了一把金枪（第 ${meta.goldGuns} 把）。` }
}

/** 玉枪：每年限一把 */
export function buyJadeGun(meta: MetaSave): LogLine {
  if (meta.jadeThisYear) return { cls: 'sys', text: '今年的玉枪已经换过了，明年再来。' }
  if (meta.compPoints < GUN_COST) return { cls: 'sys', text: `竞技点不足：玉枪需要 ${GUN_COST}。` }
  meta.compPoints -= GUN_COST
  meta.jadeGuns++
  meta.jadeThisYear = true
  meta.achievements['jade_gun'] = true
  return { cls: 'ev', text: `换了今年的限定玉枪（共 ${meta.jadeGuns} 把）。` }
}

export function talentName(t: TalentTier) {
  return TALENT_INFO[t].name
}

export { rankScore, helperWinProb, TOP_SCORE }
