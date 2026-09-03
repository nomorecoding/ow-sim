import type { LifeStage, MajorTier, Persona, RankModifier, RankState, TalentTier, Team } from '../types'

export const MAJOR_ORDER: MajorTier[] = [
  'bronze', 'silver', 'gold', 'plat', 'emerald', 'diamond', 'master', 'gm', 'champ', 'top',
]

export const MAJOR_NAME: Record<MajorTier, string> = {
  bronze: '青铜',
  silver: '白银',
  gold: '黄金',
  plat: '白金',
  emerald: '翡翠',
  diamond: '钻石',
  master: '大师',
  gm: '宗师',
  champ: '英杰',
  top: '顶尖500',
}

/** 带 5 小段的大段（1 档满分 = 差 1 分升下一大段） */
export const GATE_MAJORS: MajorTier[] = [
  'bronze', 'silver', 'gold', 'plat', 'emerald', 'diamond', 'master', 'gm', 'champ',
]

export const BASE_QUOTA = 200
export const PLACEMENT_GAMES = 10
export const REGULAR_WEEKS = 7
export const RIVALRY_WEEKS = 1
/** 每 N 赛季一次软重置（定级锚点向黄金/白金回拉） */
export const SOFT_RESET_EVERY = 3
/** 一年 6 个天梯赛季；OWCS 三个 Stage 落在第 2/4/6 季末 */
export const SEASONS_PER_YEAR = 6
export const DEFAULT_SPEED = 0.1
export const MIN_SPEED = 0.05

/** 初始资源 */
export const INIT_CASH = 1600
export const INIT_CREDIT = 60
export const START_AGE_MIN = 16
export const START_AGE_MAX = 18

/** 竞技点 */
export const CP_PER_WIN = 15
export const CP_SEASON_REWARD: Record<MajorTier, number> = {
  bronze: 65, silver: 125, gold: 250, plat: 500, emerald: 600, diamond: 750, master: 1200, gm: 1750, champ: 1750, top: 1750,
}
export const GUN_COST = 3000

/**
 * 生涯阶段：额度修正 + 每赛季固定收支（单位：元；一个天梯赛季 ≈ 两个月）。
 * 主播收入另按人气算，见 STREAM_INCOME_PER_FAN。
 */
export const STAGE_INFO: Record<LifeStage, { name: string; quota: number; desc: string; income: [number, number]; expense: number }> = {
  student: { name: '学生', quota: 20, desc: '课少时间多，靠生活费', income: [1200, 2000], expense: 0 },
  worker: { name: '上班', quota: -40, desc: '下班才能打，工资稳', income: [9000, 14000], expense: 5000 },
  dropout: { name: '辍学全职', quota: 60, desc: '全天肝，没收入，房租照付', income: [0, 0], expense: 2500 },
  streamer: { name: '主播', quota: 30, desc: '边播边打，收入看人气', income: [0, 600], expense: 2500 },
  free: { name: '财富自由', quota: 70, desc: '理财收益够花', income: [6000, 9000], expense: 5000 },
  coach: { name: '教练', quota: -20, desc: '带队为主，偶尔上号', income: [6000, 9000], expense: 3000 },
}

/** 主播：每赛季收入 = 人气 × 此系数（人气 1 万 ≈ 5000/季；10 万 ≈ 5 万/季） */
export const STREAM_INCOME_PER_FAN = 0.5
/** 组主播队门槛与开销 */
export const OWN_TEAM_MIN_FANS = 30000
export const OWN_TEAM_SETUP_COST = 50000
/** 主播队每赛季付队友底薪 */
export const OWN_TEAM_ROSTER_COST = 15000
/** 主播队老板拿奖金的倍数 */
export const OWN_TEAM_PRIZE_MULT = 2
/** 主播队赞助：每赛季人气 × 系数 */
export const OWN_TEAM_SPONSOR_PER_FAN = 0.3

/** 负债：每赛季利息 */
export const DEBT_INTEREST = 0.06
/** 负债到此：签约选手年末退役概率 +，主播队可能解散 */
export const DEBT_HEAVY = -30000
/** 财富自由门槛 */
export const FREE_CASH = 300000
/** 「地狱归来」：曾负债到此以下，后来单季职业收入 ≥ HELL_RETURN_INCOME 或拿国际赛冠军 */
export const HELL_DEBT = -20000
export const HELL_RETURN_INCOME = 300000
/** 报名试训解锁：触及宗师，或累计赛季数 ≥ 此 */
export const PRO_UNLOCK_SEASONS = 10

/** 永久额度修正的上下限（控制总期望） */
export const QUOTA_MOD_MIN = -50
export const QUOTA_MOD_MAX = 60

export const RANK_COLOR_CLASS: Record<MajorTier, string> = {
  bronze: 'rank-bronze',
  silver: 'rank-silver',
  gold: 'rank-gold',
  plat: 'rank-plat',
  emerald: 'rank-emerald',
  diamond: 'rank-diamond',
  master: 'rank-master',
  gm: 'rank-gm',
  champ: 'rank-champ',
  top: 'rank-top',
}

/* ———————————— 天赋（隐藏 MMR） ———————————— */

export const TALENT_ORDER: TalentTier[] = ['barrel', 'normal', 'something', 'genius', 'monster']

export const TALENT_INFO: Record<TalentTier, { name: string; range: string; min: number; max: number; base: number; grow: number; cls: string }> = {
  //                                                        分数区间（大段 500）        基础权重  每成长点系数
  barrel:    { name: '木桶',     range: '青铜–黄金',   min: 200,  max: 1500, base: 32, grow: -0.025, cls: 'tal-0' },
  normal:    { name: '普通',     range: '白金–翡翠',   min: 1500, max: 2500, base: 40, grow: 0,      cls: 'tal-1' },
  something: { name: '有点东西', range: '钻石–大师',   min: 2500, max: 3500, base: 18, grow: 0.04,   cls: 'tal-2' },
  genius:    { name: '天才',     range: '宗师–英杰',   min: 3500, max: 4500, base: 7,  grow: 0.06,   cls: 'tal-3' },
  monster:   { name: '怪物',     range: '顶尖 500',    min: 4500, max: 4600, base: 1.5, grow: 0.07,  cls: 'tal-4' },
}

export const GROWTH_CAP = 30
export const GROWTH_SEASONS_CAP = 15
export const GROWTH_TRAINING_CAP = 6
/** 每 N 个成就 → 英雄池 +1 */
export const ACH_PER_HERO_POOL = 5

export const GEAR_LEVELS = [
  { level: 1, name: '换鼠标 + 144Hz', cost: 1200, desc: '成长 +1' },
  { level: 2, name: '光纤 + 有线', cost: 3500, desc: '成长 +1' },
  { level: 3, name: '240Hz + 人体工学', cost: 9000, desc: '成长 +1' },
]

/* ———————————— 修正词（对应 OW2 真实标签） ———————————— */

export const MOD_LABEL: Record<RankModifier, { text: string; dir: 'up' | 'down' | 'both' }> = {
  calibration: { text: '校准', dir: 'both' },
  uphill: { text: '逆风局', dir: 'up' },
  consolation: { text: '安慰奖', dir: 'up' },
  reversal: { text: '大逆转', dir: 'down' },
  expected: { text: '预期', dir: 'down' },
  pressure_up: { text: '压力', dir: 'up' },
  pressure_down: { text: '压力', dir: 'down' },
  win_trend: { text: '连胜趋势', dir: 'up' },
  lose_trend: { text: '连败趋势', dir: 'down' },
  demotion_protect: { text: '保级保护', dir: 'up' },
  demotion: { text: '降级', dir: 'down' },
  wide: { text: '宽组', dir: 'down' },
}

/* ———————————— 职业线（OWCS 中国赛区） ———————————— */

export const TEAMS: Team[] = [
  { id: 'wb', name: '微播电竞', partner: true, rating: 86 },
  { id: 'jd', name: '京东味道', partner: true, rating: 82 },
  { id: 'ag', name: 'AG 全员', partner: true, rating: 80 },
  { id: 'mt', name: '奶茶战队', partner: true, rating: 74 },
  { id: 'lgd', name: '老干爹青训', partner: false, rating: 64 },
  { id: 'cq', name: '重庆火锅', partner: false, rating: 58 },
  { id: 'xa', name: '西安肉夹馍', partner: false, rating: 52 },
  { id: 'gz', name: '广州早茶', partner: false, rating: 48 },
  { id: 'nb', name: '网吧一队', partner: false, rating: 38 },
]

/** 底薪（每天梯赛季 ≈ 两个月；现实里 OWCS 中国底薪不高） */
export const SALARY = { partner: [20000, 40000] as const, normal: [6000, 12000] as const }
/** 地区名次奖金（人均分成） */
export const STAGE_PRIZE = [0, 60000, 30000, 15000, 8000, 3000, 1500, 0, 0]
/** 国际赛名次奖金（人均分成，基准）× 各站倍数 */
export const INTL_PRIZE = [0, 300000, 150000, 80000, 80000, 40000, 40000, 20000, 20000]
export const INTL_MULT: Record<1 | 2 | 3, number> = { 1: 0.6, 2: 1.2, 3: 1.5 }
export const INTL_NAME: Record<1 | 2 | 3, string> = { 1: 'Champions Clash', 2: '年中冠军赛 · EWC', 3: '世界总决赛' }
export const INTL_PLACE: Record<1 | 2 | 3, string> = { 1: '首尔', 2: '利雅得', 3: '斯德哥尔摩' }

/** 被发掘条件：本季 ≥ 宗师 且已打 ≥ 40 把（老玩家 ≥10 季放宽到大师） */
export const SCOUT_MIN_SCORE = 7 * 500
export const SCOUT_VETERAN_SCORE = 6 * 500
export const SCOUT_MIN_MATCHES = 40
export const RETIRE_AGE = 25
/** 签约期间天赋兜底档 + 训练环境成长加成 */
export const PRO_TALENT_FLOOR = 'something' as const
export const PRO_GROWTH_BONUS = 8

/** 队友名池（主播队 / 花边用） */
export const MATE_NAMES = ['小北', '阿豪', 'Kiro', '沁沁', '老白', 'Zed', '丸子', 'Nine', '阿远', 'Lumi', '大只', 'Vex', '卷卷', 'Sora', '皮皮', 'Yuki']

/**
 * 帮手梯队（代练 / 陪玩共用）。idx 与大段序号同尺度：钻石 5 … 英杰 8，职业选手 10，OWL 级 11。
 * 胜率 = 0.5 + 0.08 × (帮手 idx − 你的大段 idx)：钻石代练打白金 ≈ 66%，英杰代练打白金 ≈ 90%，英杰代练打宗师 ≈ 58%。
 * 陪玩要和你一起打，同档比代练低 8 个点；可以 1–4 个人陪（5 排 4 陪 1 → 接近 95%），但宽组减收益。
 */
export const HELPER_TIERS = [
  { id: 'diamond', name: '钻石', idx: 5, boostPrice: 12, escortPrice: 8, boost: true },
  { id: 'master', name: '大师', idx: 6, boostPrice: 20, escortPrice: 14, boost: true },
  { id: 'gm', name: '宗师', idx: 7, boostPrice: 35, escortPrice: 25, boost: true },
  { id: 'champ', name: '英杰', idx: 8, boostPrice: 60, escortPrice: 45, boost: true },
  { id: 'pro', name: 'OWCS 选手', idx: 10, boostPrice: 120, escortPrice: 95, boost: true },
  { id: 'owl', name: 'OWL 级 · 388/h', idx: 11, boostPrice: 0, escortPrice: 388, boost: false },
] as const
export type HelperTierId = (typeof HELPER_TIERS)[number]['id']
/** 一次下单的把数 */
export const HELPER_PACK_GAMES = 10
export const ESCORT_MAX_COUNT = 4

export const BOOST_JOBS = [
  { id: 'fish', name: '接炸鱼单', payout: 300, pollution: 10, desc: '一单现金，污染+10' },
  { id: 'plat', name: '接白金代练', payout: 800, pollution: 18, desc: '来钱快，印记更重' },
  { id: 'high', name: '接大师墙高价单', payout: 2000, pollution: 28, desc: '连带封号风险最高' },
]
/** 代练身份每把入账 */
export const BOOST_PER_MATCH: [number, number] = [40, 120]
/** 代练累计收入到此 → 「上岸」结局 */
export const BOOST_LANDED_CASH = 100000

/** 赛季末最后 N 把进入控温窗口 */
export const TEMPER_LAST_N = 12
/** 进入控温窗口且接近门闸时，导向云泥结局的基础概率 */
export const CLOUD_MUD_CHANCE = 0.36

export const PERSONAS: Persona[] = [
  { id: 'diva', name: 'C位少爷', tagline: '资源该围着我转', metrics: { brainless: 55, rot: 15, rage: 85, delusion: 90, trash: 50 } },
  { id: 'atm', name: 'ATM', tagline: '送人头凑一桌麻将', metrics: { brainless: 100, rot: 15, rage: 40, delusion: 70, trash: 60 } },
  { id: 'chuan', name: '串子', tagline: '本命锁死生死不换', metrics: { brainless: 35, rot: 20, rage: 15, delusion: 65, trash: 35 } },
  { id: 'fool', name: '冤种', tagline: '活最多干最累还被骂', metrics: { brainless: 35, rot: 5, rage: 20, delusion: 40, trash: 10 } },
  { id: 'push', name: '压力怪', tagline: '比对面还能压队友', metrics: { brainless: 30, rot: 0, rage: 90, delusion: 60, trash: 20 } },
  { id: 'rage', name: '喷子', tagline: '输出全在公屏', metrics: { brainless: 95, rot: 20, rage: 100, delusion: 70, trash: 50 } },
  { id: 'mercy', name: '摩西女', tagline: '大海为你分开', metrics: { brainless: 65, rot: 30, rage: 40, delusion: 90, trash: 50 } },
  { id: 'wall', name: '高坚果', tagline: '杵着挨揍也是贡献', metrics: { brainless: 40, rot: 10, rage: 15, delusion: 30, trash: 15 } },
  { id: 'liu6', name: '老六', tagline: '角落比景点多', metrics: { brainless: 25, rot: 70, rage: 3, delusion: 20, trash: 50 } },
  { id: 'idle', name: '混子', tagline: '在场但不在战场', metrics: { brainless: 80, rot: 85, rage: 10, delusion: 20, trash: 75 } },
  { id: 'greed', name: '资源怪', tagline: '全队资源都是你的', metrics: { brainless: 55, rot: 5, rage: 65, delusion: 85, trash: 35 } },
  { id: 'kfc', name: '肯德基公主', tagline: '全世界欠你道歉', metrics: { brainless: 85, rot: 20, rage: 95, delusion: 100, trash: 70 } },
  { id: 'genji', name: '国服源氏', tagline: '龙刃一开全场安静', metrics: { brainless: 20, rot: 10, rage: 55, delusion: 60, trash: 5 } },
  { id: 'coach', name: '公屏教练', tagline: '打得一般，指挥一流', metrics: { brainless: 25, rot: 15, rage: 60, delusion: 50, trash: 25 } },
]

export function rankLabel(r: RankState): string {
  const name = MAJOR_NAME[r.major]
  if (r.major === 'top') return `${name} · ${r.rp}分`
  return `${name}${r.div} · ${r.rp}分`
}

export function nextMajor(m: MajorTier): MajorTier | null {
  const i = MAJOR_ORDER.indexOf(m)
  if (i < 0 || i >= MAJOR_ORDER.length - 1) return null
  return MAJOR_ORDER[i + 1]
}

export function majorIndex(m: MajorTier): number {
  return MAJOR_ORDER.indexOf(m)
}

/** 是否处于「大段 1 档」门闸位置（再涨分就升大段） */
export function isAtMajorGate(r: RankState): boolean {
  if (!GATE_MAJORS.includes(r.major)) return false
  return r.div === 1
}

/** 云泥目标：当前大段 1·99 */
export function isCloudMudRank(r: RankState): boolean {
  return isAtMajorGate(r) && r.rp === 99
}

export function cloudMudPair(r: RankState): { from: string; to: string } | null {
  if (!isAtMajorGate(r)) return null
  const nxt = nextMajor(r.major)
  if (!nxt) return null
  return {
    from: `${MAJOR_NAME[r.major]}1`,
    to: nxt === 'top' ? MAJOR_NAME[nxt] : `${MAJOR_NAME[nxt]}5`,
  }
}
