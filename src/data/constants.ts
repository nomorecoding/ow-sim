import type { Form, HiddenTalent, LifeStage, MajorTier, Persona, RankState, TalentTier, Team } from '../types'

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
  top: '500 强',
}

/** 带 5 小段的大段（1 档满分 = 差 1 分升下一大段） */
export const GATE_MAJORS: MajorTier[] = [
  'bronze', 'silver', 'gold', 'plat', 'emerald', 'diamond', 'master', 'gm', 'champ',
]

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

export const DEFAULT_SPEED = 0.35
export const MIN_SPEED = 0.05

/* ———————————— 人生 ———————————— */

export const START_AGE = 16
export const SEASONS_PER_YEAR = 4
/** 强制退坑年龄 */
export const QUIT_AGE = 31
/** 被发掘的年龄上限 */
export const SCOUT_MAX_AGE = 21

/** 开局热情 */
export const PASSION_START: [number, number] = [1000, 1300]
/** 新的一年：新赛季新鲜感 */
export const NEW_YEAR_PASSION = 40
/** 热情预警：低于下季消耗 × 此倍数 */
export const PASSION_WARN_MULT = 1.5

/** 人生阶段：每季热情消耗（≈ 把数）、斜率系数 */
export const STAGE_INFO: Record<LifeStage, { name: string; games: number; slope: number; desc: string }> = {
  student: { name: '学生', games: 100, slope: 1.0, desc: '课少时间多' },
  fulltime: { name: '全职', games: 150, slope: 1.2, desc: '全天肝，房租自己付' },
  worker: { name: '上班', games: 55, slope: 0.75, desc: '下班才能打' },
  free: { name: '自由', games: 90, slope: 1.0, desc: '不用上班了' },
}

/** 财富自由门槛（基本只有职业奖金能达到） */
export const FREE_CASH = 300000

/* ———————————— 天赋（终身） ———————————— */

export const TALENT_ORDER: TalentTier[] = ['barrel', 'normal', 'something', 'genius', 'monster']

export const TALENT_INFO: Record<TalentTier, {
  name: string; base: number; cls: string
  /** 季斜率均值（分）与噪声 σ */
  slope: number; sigma: number
  /** 突破检定加成 */
  breakBonus: number
  /** 起点分区间 */
  start: [number, number]
  range: string
}> = {
  barrel:    { name: '木桶',     base: 32,  cls: 'tal-0', slope: 50,  sigma: 60,  breakBonus: -0.10, start: [0, 700],     range: '天花板在黄金附近' },
  normal:    { name: '普通',     base: 41,  cls: 'tal-1', slope: 100, sigma: 70,  breakBonus: 0,     start: [200, 1000],  range: '白金–翡翠是常态' },
  something: { name: '有点东西', base: 18,  cls: 'tal-2', slope: 160, sigma: 80,  breakBonus: 0.08,  start: [700, 1300],  range: '钻石–大师可期' },
  genius:    { name: '天才',     base: 7,   cls: 'tal-3', slope: 240, sigma: 90,  breakBonus: 0.16,  start: [900, 1600],  range: '宗师–英杰' },
  monster:   { name: '怪物',     base: 2,   cls: 'tal-4', slope: 340, sigma: 100, breakBonus: 0.25,  start: [1250, 1800], range: '500 强的料' },
}

/* ———————————— 经验 / 等级：只改天才、怪物的概率 ———————————— */
/** 每个成就、每一级 → 天才 + 怪物合计 +0.1%（从木桶 / 普通里挪） */
export const TALENT_SHIFT_PER = 0.1
/** 挪出去的部分里，天才 : 怪物 */
export const TALENT_SHIFT_GENIUS = 0.65
/** 合计最多挪多少个百分点 */
export const TALENT_SHIFT_CAP = 15
/** 升级所需经验：第 n 级 = BASE + n × STEP（线性递增） */
export const LEVEL_EXP_BASE = 30
export const LEVEL_EXP_STEP = 10
/** 一辈子的经验 = 最高段位 + 职业成就（线性） */
export const EXP_BY_MAJOR: Record<MajorTier, number> = {
  bronze: 4, silver: 6, gold: 9, plat: 12, emerald: 16, diamond: 21, master: 28, gm: 36, champ: 46, top: 58,
}
export const EXP_PRO = { scouted: 15, year: 4, regional: 12, intl: 20, world: 35, fmvp: 25 }

/** 段位衰减：越高涨得越慢 */
export const SLOPE_DECAY: Record<MajorTier, number> = {
  bronze: 1.0, silver: 0.95, gold: 0.9, plat: 0.8, emerald: 0.7, diamond: 0.55, master: 0.42, gm: 0.32, champ: 0.25, top: 0.2,
}

/** 年龄系数（斜率乘数，超过 30 岁额外每季自然退化） */
export function ageMult(age: number): number {
  if (age <= 18) return 1.15
  if (age <= 21) return 1.05
  if (age <= 24) return 0.9
  if (age <= 27) return 0.65
  if (age <= 30) return 0.35
  return 0
}
export const AGE_DECAY_PER_SEASON = 40

/* ———————————— 段位墙 ———————————— */

/** 墙的基础突破概率：key 为要进入的大段 */
export const WALL_BASE: Partial<Record<MajorTier, number>> = {
  silver: 0.85, gold: 0.8, plat: 0.7, emerald: 0.6, diamond: 0.4, master: 0.3, gm: 0.22, champ: 0.15, top: 0.1,
}
/** 过墙热情奖励 */
export const WALL_PASSION: Partial<Record<MajorTier, number>> = {
  silver: 60, gold: 90, plat: 120, emerald: 150, diamond: 200, master: 260, gm: 320, champ: 380, top: 450,
}
/** 「势」换概率：每 N 分 +1% */
export const MOMENTUM_PER_PCT = 4
/** 顶尖墙额外要求本季把数 */
export const TOP_MIN_GAMES = 40

/** 瓶颈抉择：换英雄池（先掉分，再爆发） / 找教练复盘（花钱堆势） */
export const SWITCH_POOL_DROP = 80
export const SWITCH_POOL_SEASONS = 3
export const SWITCH_POOL_MULT = 1.5
export const COACH_COST = 1500
export const COACH_MOMENTUM = 120
export const CREW_BONUS = 0.1

/* ———————————— 死线抉择：黑市 ———————————— */

/** 代练价格文案：按你的段位选档 */
export const BOOSTER_QUOTE: Array<{ maxMajor: MajorTier; name: string; price: number }> = [
  { maxMajor: 'plat', name: '钻石代练', price: 12 },
  { maxMajor: 'emerald', name: '大师代练', price: 20 },
  { maxMajor: 'diamond', name: '宗师代练', price: 35 },
  { maxMajor: 'master', name: '英杰代练', price: 60 },
  { maxMajor: 'top', name: 'OWCS 选手代练', price: 120 },
]
export const MARKET_BOOST_PASS = 0.9
export const MARKET_CHEAT_PASS = 0.97
/** 代练留下的举报堆栈：每季被查概率 → 封 30 天（停一季） */
export const BOOST_SUSPEND_P = 0.1
/** 开挂：每季被查概率，且最迟 N 季内必被查 → 永封 */
export const CHEAT_CATCH_P = 0.35
export const CHEAT_CATCH_MAX = 4
/** 代练 / 陪玩史在职业期被爆：禁赛 Stage 数、下几辈子没人私信 */
export const EXPOSED_SUSPEND = 2
export const EXPOSED_BLOCK_LIVES = 2
/** 代练收入到此 → 「上岸」结局 */
export const BOOST_LANDED_CASH = 100000

/* ———————————— 被发掘 ———————————— */
export const SCOUT_P: Partial<Record<MajorTier, number>> = { gm: 0.05, champ: 0.15, top: 0.3 }
/** 试训通过基础概率（天赋加成另算） */
export const TRIAL_BASE = 0.55
/** 有代练 / 陪玩记录时试训通过率的折扣（开挂记录直接政审不过） */
export const TRIAL_DIRTY_MULT = 0.6

/* ———————————— 成就奖励：成就攒到一定数量，下辈子永久带着的 buff ———————————— */
export const ACH_PERKS: Array<{ n: number; id: string; name: string; desc: string }> = [
  { n: 10, id: 'reroll', name: '天赋重摇', desc: '每辈子开局摇两次天赋，取高的那次' },
  { n: 20, id: 'rich', name: '富裕出身', desc: '每辈子 30% 生在有钱人家：热情 +150、现金 +20000、不用交房租' },
  { n: 30, id: 'scout', name: '教练人脉', desc: '被青训教练私信的概率 ×1.5' },
  { n: 40, id: 'passion', name: '更能打', desc: '每辈子起始热情 +100（多打两三季）' },
  { n: 50, id: 'pro', name: '职业底子', desc: '进职业后状态成长起点 +3（更容易摇到好状态）' },
]

/* ———————————— 隐藏天赋：极小概率叠在天赋之上，各自通向一个隐藏结局 ———————————— */
export const HIDDEN_ORDER: HiddenTalent[] = ['aim', 'clutch', 'late', 'glass']
export const HIDDEN_INFO: Record<HiddenTalent, { name: string; p: number; line: string; proBonus: number }> = {
  aim:    { name: '天生神枪', p: 0.8, line: '第一把就有人在公屏问你开没开。你没有。', proBonus: 4 },
  clutch: { name: '大心脏',   p: 0.8, line: '越是决胜局手越稳。墙对你来说只是一道门。', proBonus: 2 },
  late:   { name: '晚熟',     p: 0.8, line: '二十岁前平平无奇。别人退坑的年纪，你才开始涨。', proBonus: 0 },
  glass:  { name: '玻璃手',   p: 0.8, line: '手感好到吓人，但手腕是借来的。', proBonus: 3 },
}
/** 每级额外 +0.02%（合计），最多 +2% */
export const HIDDEN_PER_LEVEL = 0.02
export const HIDDEN_LEVEL_CAP = 2
/** 玻璃手：19 岁起每季受伤概率；伤后斜率打折 */
export const GLASS_INJURY_P = 0.05
export const GLASS_INJURY_MULT = 0.45
export const GLASS_INJURY_PASSION = 200
/** 晚熟：退坑年龄与被发掘年龄上限放宽；热情烧得慢（开局多给、每年多补） */
export const LATE_QUIT_AGE = 36
export const LATE_SCOUT_MAX_AGE = 27
export const LATE_PASSION_START = 300
export const LATE_PASSION_YEAR = 130

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

/** 年薪（现实里 OWCS 中国底薪不高；合作战队体面） */
export const SALARY = { partner: [80000, 160000] as const, normal: [30000, 60000] as const, bench: [15000, 30000] as const }
/** 地区名次奖金（人均分成） */
export const STAGE_PRIZE = [0, 60000, 30000, 15000, 8000, 3000, 1500, 0, 0]
/** 国际赛名次奖金（人均分成，基准）× 各站倍数 */
export const INTL_PRIZE = [0, 300000, 150000, 80000, 80000, 40000, 40000, 20000, 20000]
export const INTL_MULT: Record<1 | 2 | 3, number> = { 1: 0.6, 2: 1.2, 3: 1.5 }
export const INTL_NAME: Record<1 | 2 | 3, string> = { 1: 'Champions Clash', 2: '年中冠军赛 · EWC', 3: '世界总决赛' }
export const INTL_PLACE: Record<1 | 2 | 3, string> = { 1: '首尔', 2: '利雅得', 3: '斯德哥尔摩' }

/** 职业模式：可主动退役年龄、身体开始下滑年龄、强制收官年龄 */
export const PRO_RETIRE_MIN_AGE = 22
export const PRO_DECLINE_AGE = 25
export const PRO_FORCE_RETIRE_AGE = 31
/** 无队一年的生活开销 */
export const PRO_IDLE_EXPENSE = 15000
/** 「地狱归来」阈值：曾负债到此以下 / 之后单生涯职业收入 */
export const HELL_DEBT = -20000
export const HELL_RETURN_INCOME = 300000
/** FMVP：世界总决赛冠军且状态 ≥ 巅峰时摇 */
export const FMVP_P: Partial<Record<Form, number>> = { peak: 0.35, god: 0.6 }

/** 本年状态档（职业模式的天赋）：个人实力区间 + 基础权重 + 每成长点系数 */
export const FORM_ORDER: Form[] = ['slump', 'ok', 'online', 'peak', 'god']
export const FORM_INFO: Record<Form, { name: string; min: number; max: number; base: number; grow: number; cls: string }> = {
  slump:  { name: '低迷', min: 40, max: 54, base: 22, grow: -0.03, cls: 'tal-0' },
  ok:     { name: '一般', min: 52, max: 66, base: 40, grow: 0,     cls: 'tal-1' },
  online: { name: '在线', min: 62, max: 78, base: 26, grow: 0.05,  cls: 'tal-2' },
  peak:   { name: '巅峰', min: 74, max: 90, base: 10, grow: 0.07,  cls: 'tal-3' },
  god:    { name: '神仙', min: 86, max: 99, base: 2,  grow: 0.06,  cls: 'tal-4' },
}
export const PRO_GROWTH_CAP = 30
/** 天赋 → 职业成长起点修正 */
export const TALENT_PRO_BONUS: Record<TalentTier, number> = { barrel: -4, normal: 0, something: 3, genius: 6, monster: 10 }

/** 队友名池 */
export const MATE_NAMES = ['小北', '阿豪', 'Kiro', '沁沁', '老白', 'Zed', '丸子', 'Nine', '阿远', 'Lumi', '大只', 'Vex', '卷卷', 'Sora', '皮皮', 'Yuki']

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

/** 500 强榜单名次：0 分 = 第 500 名，100 分 = 第 1 名 */
export function topPlace(rp: number): number {
  return Math.max(1, 500 - Math.round(rp * 4.99))
}

export function rankLabel(r: RankState): string {
  const name = MAJOR_NAME[r.major]
  if (r.major === 'top') return `${name} · 第 ${topPlace(r.rp)} 名`
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
