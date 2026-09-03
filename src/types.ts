/** 大段：青铜→英杰均有 5 小段；顶尖500 为榜单，无小段 */
export type MajorTier =
  | 'bronze' | 'silver' | 'gold' | 'plat' | 'emerald' | 'diamond' | 'master' | 'gm' | 'champ' | 'top'

export interface RankState {
  major: MajorTier
  /** 5=最低档 … 1=最高档；顶尖500 固定 1 */
  div: number
  /** 0–100，100 进下一小段 */
  rp: number
}

/** 身份：路人 / 代练 / 外挂 */
export type Identity = 'casual' | 'boost' | 'cheat'

export type SeasonPhase = 'placement' | 'regular' | 'rivalry' | 'settle'

/** 人生阶段（天梯模式背景）：决定赛季额度与收支 */
export type LifeStage = 'student' | 'worker' | 'dropout' | 'free'

/** 本季天赋档（= 隐藏 MMR 区间） */
export type TalentTier = 'barrel' | 'normal' | 'something' | 'genius' | 'monster'

export interface PersonaMetrics {
  brainless: number
  rot: number
  rage: number
  delusion: number
  trash: number
}

export interface Persona {
  id: string
  name: string
  tagline: string
  metrics: PersonaMetrics
}

export interface LogLine {
  cls: string
  text: string
}

/** 雇来的帮手：代练（替你打）或陪玩（和你一起打，可多人） */
export interface Helper {
  kind: 'boost' | 'escort'
  /** HELPER_TIERS 的 id */
  tier: string
  /** 陪玩人数 1–4；代练固定 1 */
  count: number
  /** 剩余把数 */
  left: number
}

/** 一把对局后系统给出的修正词（对应 OW2 真实标签） */
export type RankModifier =
  | 'calibration' | 'uphill' | 'consolation' | 'reversal' | 'expected'
  | 'pressure_up' | 'pressure_down' | 'win_trend' | 'lose_trend'
  | 'demotion_protect' | 'demotion' | 'wide'

export interface MatchResult {
  win: boolean
  rpDelta: number
  modifiers: RankModifier[]
  log: LogLine[]
  events: LogLine[]
}

export interface SeasonEnding {
  id: string
  title: string
  verse: string[]
  rankLabel: string
}

export interface Achievement {
  id: string
  name: string
  desc: string
  /** 职业模式荣誉：金框展示，解锁前连描述都不给 */
  honor?: boolean
}

/** 天梯全局成长项：只改天赋分布，不改单季胜率 */
export interface Growth {
  /** 赛季经验（每季 +1，上限 15） */
  seasons: number
  /** 英雄池（每 5 个成就 +1） */
  heroPool: number
  /** 设备等级 0–3（现金买） */
  gear: number
}

/** 黑历史：天梯里做的脏事，职业模式里付账 */
export interface DirtyHistory {
  /** 接过的代练单数 */
  boostJobs: number
  /** 请过的代练 / 陪玩套数 */
  hires: number
  /** 开过挂的赛季数 */
  cheatSeasons: number
}

/* ———————————————————— 天梯模式：一个赛季 ———————————————————— */

export interface GameState {
  persona: Persona
  identity: Identity
  rank: RankState
  /** 本季天赋档 */
  talent: TalentTier
  /** 本季隐藏 MMR（分数尺度） */
  mmr: number
  /** 匹配系统对你的置信度 0–1，前 ~30 把校准 */
  conf: number
  /** 定级锚点分（来自上赛季 / 软重置） */
  anchorScore: number
  /** 当前小段是否已用掉保级保护 */
  protectedDiv: string | null

  age: number
  year: number
  /** 年内第几个赛季 1–6 */
  seasonInYear: number

  cash: number
  credit: number
  compPoints: number
  /** 人气：只影响收入事件，职业模式带入 */
  fans: number
  playtime: number
  envPollution: number
  redBox: boolean
  muteLeft: number
  muteCount: number
  dirty: DirtyHistory
  /** 本季是否开过挂（写入黑历史） */
  cheatedThisSeason: boolean
  /** 历史最低现金 */
  cashLow: number
  reportStacks: number
  banned: boolean
  season: number
  phase: SeasonPhase
  week: number
  quotaLeft: number
  quotaMax: number
  placementLeft: number
  placementWins: number
  matchesThisSeason: number
  wins: number
  cloudMudAim: boolean
  logs: LogLine[]
  events: LogLine[]
  helper: Helper | null
  /** 本季最近一次买的套餐（一键续同款） */
  lastHelper: Helper | null
  /** 本季是否已弹过黑市提醒 */
  marketPrompted: boolean
  /** 待弹出的黑市提醒文案（UI 消费后清空） */
  marketHint: string | null
  /** 帮手刚打完套餐：UI 弹「续单 / 提前结束 / 自己打」 */
  helperDone: boolean
  /** 提前结束赛季锁定段位 */
  endedEarly: boolean
  /** 赛季高光（结算页展示） */
  highlights: LogLine[]
  winStreak: number
  loseStreak: number
  bestStreak: number
  worstStreak: number
  stage: LifeStage
  dirtyThisSeason: boolean
  boostEarned: number
  quotaModDelta: number
  achieved: Record<string, boolean>
  newAchievements: string[]
  peakScore: number
  /** 修正词计数（成就用） */
  modCount: Partial<Record<RankModifier, number>>
  ending?: SeasonEnding
}

/* ———————————————————— 职业模式：一段生涯 ———————————————————— */

/** 战队 */
export interface Team {
  id: string
  name: string
  /** 合作战队：Stage 1 免预选，底薪高 */
  partner: boolean
  /** 队伍底子 0–100 */
  rating: number
}

/** 本年状态档（职业模式的「天赋」） */
export type Form = 'slump' | 'ok' | 'online' | 'peak' | 'god'

export interface StageResult {
  year: number
  stage: 1 | 2 | 3
  team: string
  /** 地区名次；0 = 预选淘汰 / 未参赛 */
  place: number
  /** 国际赛名次；0 = 未出线 */
  intl: number
  prize: number
  /** 是否替补席看完 */
  bench?: boolean
  note?: string
}

export interface ProOffer {
  teamId: string
  /** 年薪 */
  salary: number
  role: 'starter' | 'bench'
}

/** 需要玩家点一下的抉择（转会窗 / 某些事件） */
export interface ProChoice {
  id: string
  title: string
  body: string
  options: Array<{ id: string; label: string; cls?: string; sub?: string }>
}

export interface ProTitles {
  regional: number
  intl: number
  world: number
  worldCup: number
}

export interface ProState {
  /** 天梯里触及宗师 / 打满 N 季后解锁 */
  unlocked: boolean
  /** 第几次生涯 */
  runs: number
  /** 生涯进行中 */
  active: boolean
  age: number
  /** 生涯第几年 */
  year: number
  teamId: string | null
  /** 本年年薪（已发） */
  salary: number
  form: Form
  /** 本年个人实力 0–100 */
  skill: number
  fame: number
  benchYears: number
  /** 连续无队年数 */
  idleYears: number
  yearScore: number
  history: StageResult[]
  titles: ProTitles
  /** 接过的假赛次数（每个 Stage 都可能被翻） */
  fixes: number
  /** 禁赛剩余 Stage 数 */
  suspended: number
  /** 跨生涯成长点：只改状态档分布 */
  growth: number
  /** 本生涯职业收入（地狱归来判定） */
  income: number
  /** 本生涯是否始终干净 */
  clean: boolean
  /** 生涯结局（有则生涯结束） */
  ending: SeasonEnding | null
  /** 终身禁赛（跨生涯：本存档职业模式永闭） */
  lifetimeBan: boolean
  banReason?: string
  /** 生涯统计（结局用） */
  yearsPlayed: number
  /** 本年日志与高光（页面刷新丢失，无妨） */
  log: LogLine[]
  highlights: LogLine[]
  /** 待处理抉择 */
  choice: ProChoice | null
  /** 本年是否已结算（等玩家点「下一年」） */
  yearDone: boolean
  /** 本年内 Stage 进度 1–3，0 = 年初 */
  stageAt: number
  /** 历史结局收集 */
  endings: Record<string, number>
}

/* ———————————————————— 全局档 ———————————————————— */

export interface MetaSave {
  playtimeTotal: number
  seasonsPlayed: number
  achievements: Record<string, boolean>
  endings: Record<string, number>
  lastEndingId?: string
  speed: number
  manual: boolean

  /* —— 人生（天梯模式背景） —— */
  age: number
  year: number
  seasonInYear: number
  growth: Growth
  /** 历史天赋记录（各档次数） */
  talentLog: Record<TalentTier, number>
  bestTalent?: TalentTier

  /* —— 跨赛季延续 —— */
  cash: number
  credit: number
  compPoints: number
  fans: number
  dirty: DirtyHistory
  /** 历史最低现金（负债深度） */
  cashLow: number
  /** 是否曾触及宗师（解锁职业模式） */
  reachedGM: boolean
  /** 开赛前在黑市预订的帮手（已付款，开局即上号） */
  preorder?: Helper
  goldGuns: number
  jadeGuns: number
  /** 今年是否已换过玉枪 */
  jadeThisYear: boolean
  envPollution: number
  lastRank?: RankState
  lastResetSeason: number
  quotaMod: number
  stage: LifeStage
  boostEarnedTotal: number
  bansTotal: number
  accountNo: number
  /** 弹窗邀约「下次再说」到第几个赛季为止 */
  snooze: Record<string, number>
  /** 一次性提示是否已看过 */
  seen: Record<string, boolean>
  /** 调试：下季强制天赋 */
  debugTalent?: TalentTier

  /* —— 职业模式 —— */
  pro: ProState
}
