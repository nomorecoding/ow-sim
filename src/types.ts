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

/** 身份：路人 / 代练 / 外挂。职业选手是 career 状态，不是身份。 */
export type Identity = 'casual' | 'boost' | 'cheat'

export type SeasonPhase = 'placement' | 'regular' | 'rivalry' | 'settle'

/** 生涯阶段：决定赛季额度与事件池 */
export type LifeStage = 'student' | 'worker' | 'dropout' | 'streamer' | 'free' | 'coach'

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
  /** 职业线 / 荣誉类：金框展示 */
  honor?: boolean
}

/** 全局成长项：只改天赋分布，不改单季胜率 */
export interface Growth {
  /** 赛季经验（每季 +1，上限 15） */
  seasons: number
  /** 英雄池（每 5 个成就 +1） */
  heroPool: number
  /** 设备等级 0–3（现金买） */
  gear: number
  /** 战队训练（签约期间每 Stage +1，上限 6） */
  training: number
}

/** 战队 */
export interface Team {
  id: string
  name: string
  /** 合作战队：Stage 1 免预选，底薪高 */
  partner: boolean
  /** 队伍底子 0–100 */
  rating: number
  /** 你自己组的主播队：自付底薪，奖金翻倍 */
  own?: boolean
}

/** banned = 终身禁赛（黑历史被翻出来），本存档职业线永闭 */
export type CareerPhase = 'none' | 'scouted' | 'trial' | 'signed' | 'retired' | 'banned'

export interface StageResult {
  year: number
  stage: 1 | 2 | 3
  team: string
  /** 地区名次；0 = 预选淘汰 */
  place: number
  /** 国际赛名次；0 = 未出线 */
  intl: number
  prize: number
  /** 花边：假赛 / 宫斗 / 解散 等 */
  note?: string
}

export interface Career {
  phase: CareerPhase
  team?: Team
  /** 签约赛季数 */
  seasonsSigned: number
  history: StageResult[]
  /** 本年度累计名次得分，转会窗用 */
  yearScore: number
  worldCup: number
  /** 退役后的去向 */
  afterlife?: 'streamer' | 'coach' | 'escort'
  /** 退役发生的年份（结局只触发一次） */
  retiredYear?: number
  /** 终身禁赛原因 */
  banReason?: string
  /** 主动放弃职业梦（负债选了正业）：不再被发掘、不能报名 */
  dreamGiven?: boolean
  /** 主播队累计解散次数 */
  disbands?: number
}

/** 黑历史：签约后每次正赛都有被翻出来的概率 */
export interface DirtyHistory {
  /** 接过的代练单数 */
  boostJobs: number
  /** 请过的代练 / 陪玩套数 */
  hires: number
  /** 开过挂的赛季数 */
  cheatSeasons: number
}

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
  /** 人气（粉丝数量级）：主播收入、组队门槛 */
  fans?: number
  playtime: number
  envPollution: number
  redBox: boolean
  muteLeft: number
  muteCount: number
  /** 终身禁赛（= career.phase === 'banned'） */
  careerBanned: boolean
  dirty?: DirtyHistory
  /** 本季是否开过挂（写入黑历史） */
  cheatedThisSeason?: boolean
  /** 本季职业收入（底薪 + 奖金），地狱归来判定用 */
  proIncome?: number
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
  /** 本季是否已弹过黑市提醒 */
  marketPrompted: boolean
  /** 待弹出的黑市提醒文案（UI 消费后清空） */
  marketHint: string | null
  /** 帮手刚打完套餐：UI 弹「续单 / 提前结束 / 自己打」 */
  helperDone?: boolean
  /** 提前结束赛季锁定段位 */
  endedEarly?: boolean
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
  career: Career
  /** 本季是否触发被发掘 */
  scoutedThisSeason: boolean
  ending?: SeasonEnding
}

export interface MetaSave {
  playtimeTotal: number
  seasonsPlayed: number
  achievements: Record<string, boolean>
  endings: Record<string, number>
  lastEndingId?: string
  speed: number
  manual: boolean

  /* —— 人生 —— */
  age: number
  year: number
  seasonInYear: number
  growth: Growth
  career: Career
  /** 历史天赋记录（各档次数） */
  talentLog: Record<TalentTier, number>
  bestTalent?: TalentTier

  /* —— 跨赛季延续 —— */
  cash: number
  credit: number
  compPoints: number
  fans?: number
  dirty?: DirtyHistory
  /** 历史最低现金（负债深度，地狱归来判定） */
  cashLow?: number
  /** 是否曾触及宗师（解锁报名试训） */
  reachedGM?: boolean
  /** 开赛前预订的帮手（已付款，开赛即上号） */
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
  careerBanned: boolean
  boostEarnedTotal: number
  bansTotal: number
  accountNo: number
}
