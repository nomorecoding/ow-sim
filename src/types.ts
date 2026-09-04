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

/** 天赋档：决定实力成长斜率分布与突破加成，一辈子不变 */
export type TalentTier = 'barrel' | 'normal' | 'something' | 'genius' | 'monster'
/** 隐藏天赋：极小概率叠在天赋之上，各自通向一个隐藏结局 */
export type HiddenTalent = 'aim' | 'clutch' | 'late' | 'glass'

/** 人生阶段：决定每季热情消耗与斜率 */
export type LifeStage = 'student' | 'fulltime' | 'worker' | 'free'

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
  /** 发生时的年龄（高光年表用） */
  at?: number
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
  /** 隐藏成就：解锁前只显示「？」 */
  secret?: boolean
}

/** 全局成长：只改天赋分布，不改单局曲线 */
export interface Growth {
  /** 等级：每级让天才 / 怪物概率 +0.1% */
  level: number
  /** 当前等级内已攒的经验 */
  exp: number
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

/* ———————————————————— 一段人生（天梯阶段） ———————————————————— */

export interface LifeState {
  persona: Persona
  talent: TalentTier
  /** 隐藏天赋（极小概率） */
  hidden: HiddenTalent | null
  /** 玻璃手：手腕已经废过一次 */
  injured: boolean
  /** 隐藏真实实力（分数尺度） */
  mmr: number
  /** 显示段位 */
  rank: RankState
  /** 实力顶到墙时累积的「势」 */
  momentum: number
  /** 连续卡墙季数 */
  stuckSeasons: number
  /** 本局卡过墙的总季数（成就） */
  stuckTotal: number
  /** 曾触及的最高段位分（显示段位） */
  peakScore: number
  /** 曾触及的最高实力 */
  peakMmr: number

  age: number
  /** 第几季（从 1 起） */
  season: number
  /** 年内第几季 1–4 */
  seasonInYear: number
  stage: LifeStage

  /** 热情：还愿意打多少把 */
  passion: number
  passionMax: number
  /** 本季打的把数 */
  gamesThisSeason: number
  gamesTotal: number

  cash: number
  fans: number
  /** 匹配环境污染（隐藏） */
  pollution: number
  muteCount: number
  /** 事件计数（生平用） */
  tally: Record<string, number>
  /** 黑市过墙后留下的举报堆栈 */
  reportStacks: number
  /** 开挂后的倒计时：几季内必被查 */
  cheatClock: number
  /** 换英雄池后的爆发期（剩余季数，斜率 ×1.5） */
  spurtSeasons: number
  /** 车队 buff（剩余季数） */
  crewSeasons: number
  /** 被封 30 天：下季停打 */
  suspendedNext: boolean
  /** 开挂后成就锁定 */
  achLocked: boolean
  /** 出身：富裕 */
  rich: boolean
  /** 段位虚高（陪玩体验）：本季 SR 额外 + */
  fakeBoost: number

  dirty: DirtyHistory
  boostEarned: number
  /** 是否用过黑市过墙 */
  usedMarket: boolean
  banned: boolean
  /** 被发掘 → 进职业（之后的日志继续滚在同一条时间线上） */
  scouted: boolean
  /** 进职业时的年龄 / 段位 */
  scoutedAt?: { age: number; rank: RankState }
  /** 拒绝过试训的次数 */
  refusedTrials: number
  /** 一辈子只触发一次的节点（死线等） */
  choiceUsed: Record<string, boolean>

  logs: LogLine[]
  highlights: LogLine[]
  achieved: Record<string, boolean>
  newAchievements: string[]
  ending?: SeasonEnding
  /** 本局结束（含转入职业） */
  over: boolean
}

/* ———————————————————— 职业阶段：一段生涯 ———————————————————— */

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

export interface ProTitles {
  regional: number
  intl: number
  world: number
  worldCup: number
  /** OWWC 世界杯冠军 */
  owwc: number
  fmvp: number
}

export interface ProState {
  /** 第几次生涯 */
  runs: number
  /** 生涯进行中 */
  active: boolean
  /** 从天梯带进来的隐藏天赋 */
  hidden?: HiddenTalent | null
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
  /** 接过的假赛次数 */
  fixes: number
  /** 禁赛剩余 Stage 数 */
  suspended: number
  /** 跨生涯成长点：只改状态档分布 */
  growth: number
  /** 本生涯天赋带来的成长修正 */
  talentBonus: number
  /** 本生涯职业收入（地狱归来判定） */
  income: number
  /** 本生涯是否始终干净 */
  clean: boolean
  /** 生涯结局（有则生涯结束） */
  ending: SeasonEnding | null
  /** 终身禁赛（跨生涯：本存档职业模式永闭） */
  lifetimeBan: boolean
  banReason?: string
  yearsPlayed: number
  /** 本段滚动的日志与高光（页面刷新丢失，无妨） */
  log: LogLine[]
  highlights: LogLine[]
  /** 生涯结束时获得的经验 / 升级数（结算页用） */
  endExp?: number
  endUps?: number
  /** 本年是否已滚完 */
  yearDone: boolean
  /** 本年内 Stage 进度 1–3，0 = 年初 */
  stageAt: number
  /** 今年打到的赛事高度（PRO_LEVELS 下标），年初归零 */
  level: number
  /** 生涯最高赛事高度 */
  peakLevel: number
  /** 当前赛事高度下的具体赛事与名次，如「大锤杯 · 16 强」 */
  lvNote: string
  /** 历史结局收集 */
  endings: Record<string, number>
}

/* ———————————————————— 全局档 ———————————————————— */

export interface MetaSave {
  runs: number
  achievements: Record<string, boolean>
  endings: Record<string, number>
  lastEndingId?: string
  speed: number
  manual: boolean
  /** 视觉主题 id（见 THEMES） */
  theme?: string

  growth: Growth
  /** 历史天赋记录（各档次数） */
  talentLog: Record<TalentTier, number>
  bestTalent?: TalentTier
  /** 首次触及各大段（里程碑成长点） */
  reached: Partial<Record<MajorTier, boolean>>
  /** 职业圈拉黑：还剩几辈子没人私信你（代练 / 陪玩史在职业期被爆） */
  proBlockLives: number
  /** 开过挂的人生数 */
  cheatLives: number
  /** 累计统计 */
  bestPeakScore: number
  scoutedTimes: number

  /* —— 本局带入职业阶段的东西（职业阶段结束后清零） —— */
  cash: number
  fans: number
  dirty: DirtyHistory
  cashLow: number

  /** 调试：下局强制天赋 */
  debugTalent?: TalentTier
  debugHidden?: HiddenTalent

  /* —— 职业阶段 —— */
  pro: ProState
}
