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

/** 滚屏节奏：基准一季 0.1s；职业按系数加长；设置里的速度是统一倍率 */
export const LIFE_TICK_MS = 100
export const PRO_TICK_MS = 150
export const PRO_TICK_RATIO = PRO_TICK_MS / LIFE_TICK_MS
export const DEFAULT_SPEED = 1
export const MIN_SPEED = 0.5
export const MAX_SPEED = 10

/* ———————————— 人生 ———————————— */

export const START_AGE = 16
export const SEASONS_PER_YEAR = 4
/** 强制退坑年龄（热情见底更常见；能熬到这边靠热情 up 方差） */
export const QUIT_AGE = 52
/** 被发掘的年龄上限 */
export const SCOUT_MAX_AGE = 23
/** 第几季后首次询问是否堕入黑暗 */
export const DARK_OFFER_SEASON = 10

/** 开局热情：方差拉大；略抬高以把单局墙钟再拉长约 2s */
export const PASSION_START: [number, number] = [1100, 2000]
/** 新的一年：新赛季新鲜感 */
export const NEW_YEAR_PASSION = 90
/** 热情预警：低于下季消耗 × 此倍数 */
export const PASSION_WARN_MULT = 1.5

/** 人生阶段：每季热情消耗（≈ 把数）、斜率系数 */
export const STAGE_INFO: Record<LifeStage, { name: string; games: number; slope: number; desc: string }> = {
  student: { name: '学生', games: 88, slope: 0.95, desc: '课少时间多' },
  fulltime: { name: '全职', games: 120, slope: 1.1, desc: '全天肝，房租自己付' },
  worker: { name: '上班', games: 45, slope: 0.7, desc: '下班才能打' },
  free: { name: '自由', games: 75, slope: 0.95, desc: '不用上班了' },
}

/** 财富自由门槛（基本只有职业奖金能达到） */
export const FREE_CASH = 300000

/* ———————————— 天赋（终身） ———————————— */

export const TALENT_ORDER: TalentTier[] = ['barrel', 'scrub', 'normal', 'solid', 'something', 'genius', 'monster']

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
  barrel:    { name: '木桶',     base: 28,  cls: 'tal-0', slope: 42,  sigma: 55,  breakBonus: -0.12, start: [0, 600],     range: '天花板在黄金附近' },
  scrub:     { name: '平庸',     base: 22,  cls: 'tal-1', slope: 70,  sigma: 60,  breakBonus: -0.05, start: [100, 850],   range: '白金上下晃' },
  normal:    { name: '普通',     base: 25,  cls: 'tal-2', slope: 95,  sigma: 65,  breakBonus: 0,     start: [250, 1050],  range: '翡翠是常态' },
  solid:     { name: '扎实',     base: 14,  cls: 'tal-3', slope: 125, sigma: 70,  breakBonus: 0.04,  start: [500, 1200],  range: '钻石可期' },
  something: { name: '有点东西', base: 8,   cls: 'tal-4', slope: 155, sigma: 75,  breakBonus: 0.08,  start: [700, 1350],  range: '大师可期' },
  genius:    { name: '天才',     base: 2.2, cls: 'tal-5', slope: 210, sigma: 85,  breakBonus: 0.14,  start: [950, 1550],  range: '宗师–英杰的料' },
  monster:   { name: '怪物',     base: 0.8, cls: 'tal-6', slope: 290, sigma: 95,  breakBonus: 0.22,  start: [1250, 1750], range: '万里挑一' },
}

/**
 * 职业档位：天梯天赋带进职业后的叫法。
 * 木桶→蓝领 … 天才→国一，怪物→GOAT。国一 / GOAT 极稀。
 */
export const PRO_TALENT_INFO: Record<TalentTier, { name: string }> = {
  barrel:    { name: '蓝领' },
  scrub:     { name: '替补边缘' },
  normal:    { name: '路人王' },
  solid:     { name: '稳定主力' },
  something: { name: '城市天才' },
  genius:    { name: '国一' },
  monster:   { name: 'GOAT' },
}

/* ———————————— 经验 / 等级：只改天才、怪物的概率 ———————————— */
/** 每个成就、每一级 → 天才 + 怪物合计挪一点（更克制） */
export const TALENT_SHIFT_PER = 0.06
/** 挪出去的部分里，天才 : 怪物 */
export const TALENT_SHIFT_GENIUS = 0.78
/** 合计最多挪多少个百分点 */
export const TALENT_SHIFT_CAP = 8
/** 升级所需经验：第 n 级 = BASE + n × STEP（线性递增） */
export const LEVEL_EXP_BASE = 40
export const LEVEL_EXP_STEP = 14
/** 一辈子的经验 = 最高段位 + 职业成就（线性） */
export const EXP_BY_MAJOR: Record<MajorTier, number> = {
  bronze: 3, silver: 4, gold: 6, plat: 8, emerald: 11, diamond: 15, master: 20, gm: 26, champ: 34, top: 44,
}
export const EXP_PRO = { scouted: 12, year: 3, regional: 10, intl: 16, world: 28, fmvp: 20 }

/** 段位衰减：越高涨得越慢 */
export const SLOPE_DECAY: Record<MajorTier, number> = {
  bronze: 1.0, silver: 0.95, gold: 0.9, plat: 0.8, emerald: 0.7, diamond: 0.55, master: 0.42, gm: 0.32, champ: 0.25, top: 0.2,
}

/** 年龄系数：25 起分水岭，30 后上分很难，越往后几乎只掉不涨 */
export function ageMult(age: number): number {
  if (age <= 18) return 1.12
  if (age <= 21) return 1.05
  if (age <= 24) return 0.92
  if (age <= 26) return 0.55   // 25–26：开始明显下滑
  if (age <= 29) return 0.28
  if (age <= 34) return 0.1
  if (age <= 40) return 0.03
  return 0.01
}
/** 过分水岭后每季额外掉分（随年龄加重） */
export const AGE_DECAY_START = 25
export const AGE_DECAY_PER_SEASON = 36
export const AGE_DECAY_PER_YEAR = 6
/** 掉峰多少分以上算「掉下去了」（约大半个大段） */
export const STRUGGLE_GAP = 280
/** 连续挣扎几季后开始滚脱坑概率 */
export const STRUGGLE_QUIT_MIN = 2
/** 脱坑基础概率；每多挣扎一季、每大一岁再叠 */
export const STRUGGLE_QUIT_BASE = 0.12
export const STRUGGLE_QUIT_PER_SEASON = 0.1
export const STRUGGLE_QUIT_PER_AGE = 0.022
export const STRUGGLE_QUIT_CAP = 0.65
/** 没直接脱坑时，软削热情的概率 */
export const STRUGGLE_PASSION_P = 0.4
export const STRUGGLE_PASSION_HIT: [number, number] = [90, 200]

/** 高龄过墙额外惩罚（加在突破概率上） */
export function ageWallPenalty(age: number): number {
  if (age < 25) return 0
  if (age < 30) return (age - 24) * 0.02
  return 0.1 + (age - 29) * 0.035
}

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
export const SCOUT_P: Partial<Record<MajorTier, number>> = { gm: 0.11, champ: 0.26, top: 0.48 }
/** 试训通过基础概率（天赋加成另算） */
export const TRIAL_BASE = 0.62
/** 有代练 / 陪玩记录时试训通过率的折扣（开挂记录直接政审不过） */
export const TRIAL_DIRTY_MULT = 0.55

/* ———————————— 成就奖励：成就攒到一定数量，下辈子永久带着的 buff ————————————
 * 曲线：前期加的是「多打几季 / 更容易上去」，中后期加的是给那批小概率成就铺路——
 * 隐藏天赋、大龄新人、世界冠军、FMVP。攒得越多，够得着的越远。 */
export const ACH_PERKS: Array<{ n: number; id: string; name: string; desc: string }> = [
  { n: 5,  id: 'passion', name: '更能打',   desc: '每辈子起始热情 +80，多打两三季' },
  { n: 10, id: 'rich',    name: '富裕出身', desc: '每辈子 30% 生在有钱人家：热情 +150、现金 +20000、不用交房租' },
  { n: 15, id: 'wall',    name: '老油条',   desc: '升大段那几把更容易打顺（+4%）' },
  { n: 20, id: 'scout',   name: '教练人脉', desc: '被青训教练私信的概率 ×1.5' },
  { n: 28, id: 'pro',     name: '职业底子', desc: '进职业后状态成长起点 +3' },
  { n: 36, id: 'late',    name: '舍不得删', desc: '退坑年龄 +2，被发掘的年龄上限 +1' },
  { n: 44, id: 'hidden1', name: '天选',     desc: '摇到隐藏天赋的概率 ×1.5' },
  { n: 52, id: 'offers',  name: '经纪人',   desc: '合作战队给报价的概率 ×1.4' },
  { n: 60, id: 'clutch',  name: '关键局',   desc: '国际赛实力 +2，FMVP 概率 ×1.5' },
  { n: 70, id: 'newyear', name: '热爱',     desc: '每年过年多回 +30 热情' },
  { n: 80, id: 'hidden2', name: '命定',     desc: '隐藏天赋概率再 ×1.5（叠加到 ×2.25）' },
  { n: 90, id: 'legend',  name: '传奇底子', desc: '进职业后状态成长起点再 +4' },
]

/* ———————————— 隐藏天赋：极小概率叠在天赋之上，各自通向一个隐藏结局 ———————————— */
export const HIDDEN_ORDER: HiddenTalent[] = ['aim', 'clutch', 'late', 'glass']
export const HIDDEN_INFO: Record<HiddenTalent, { name: string; p: number; line: string; proBonus: number }> = {
  aim:    { name: '天生神枪', p: 0.8, line: '第一把就有人在公屏问你开没开。你没有。', proBonus: 4 },
  clutch: { name: '大心脏',   p: 0.8, line: '越是决胜局手越稳。别人卡分的地方你一把就过。', proBonus: 2 },
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
/** 晚熟：退坑年龄与被发掘年龄上限放宽；热情烧得慢（开局多给、每年多补） */
export const LATE_QUIT_AGE = 58
export const LATE_SCOUT_MAX_AGE = 30
/** 晚熟的年龄分水岭比常人晚约 5 年 */
export const LATE_AGE_OFFSET = 5
export const LATE_PASSION_START = 300
export const LATE_PASSION_YEAR = 130

/* ———————————— 职业线（OWCS 中国赛区） ———————————— */

/**
 * 战队池（分层对齐 OWCS 2026 中国赛区 + Midseason）：
 * amateur = 网吧/社区/城市虚构队；cn_* = 中国预选→常规赛真实队；world_* = 国际赛档。
 * 中国天花板 Weibo Gaming；国际前四档参考 Midseason：ZETA / Twisted Minds / T1 / WBG 等。
 */
export const TEAMS: Team[] = [
  // —— 虚构草根 ——
  { id: 'netbar', name: '网吧一队', short: '网吧', partner: false, rating: 36, tier: 'amateur', region: 'cn', logo: 'netbar.svg' },
  { id: 'college', name: '高校社联', short: '高校', partner: false, rating: 44, tier: 'amateur', region: 'cn', logo: 'college.svg' },
  { id: 'street', name: '街电青年', short: '街电', partner: false, rating: 50, tier: 'amateur', region: 'cn', logo: 'street.svg' },
  { id: 'village', name: '花村游击', short: '花村', partner: false, rating: 56, tier: 'amateur', region: 'cn', logo: 'village.svg' },
  // —— 中国预选 / 常规赛中下游（OWCS CN；队徽自 Liquipedia）——
  { id: 'rtz', name: 'ReturnZ', short: 'RTZ', partner: false, rating: 62, tier: 'cn_q', region: 'cn', logo: 'rtz.png' },
  { id: 'kk', name: 'Kitsune Kage', short: 'KK', partner: false, rating: 64, tier: 'cn_q', region: 'cn', logo: 'kk.png' },
  { id: 'homie', name: 'Homie E', short: 'Homie', partner: false, rating: 68, tier: 'cn_q', region: 'cn', logo: 'homie.png' },
  { id: 'milktea', name: 'Milk Tea', short: 'MT', partner: false, rating: 69, tier: 'cn_mid', region: 'cn', logo: 'milktea.png' },
  { id: 'hng', name: 'HUNENG Gaming', short: 'HNG', partner: false, rating: 70, tier: 'cn_mid', region: 'cn', logo: 'hng.png' },
  { id: 'fam', name: 'Four Angry Men', short: '4AM', partner: false, rating: 72, tier: 'cn_mid', region: 'cn', logo: 'fam.png' },
  { id: 'sv', name: 'Solus Victorem', short: 'SV', partner: true, rating: 76, tier: 'cn_mid', region: 'cn', logo: 'sv.png' },
  { id: 'ag', name: 'All Gamers', short: 'AG', partner: true, rating: 80, tier: 'cn_mid', region: 'cn', logo: 'ag.png' },
  // —— 中国天花板 ——
  { id: 'jdg', name: 'JD Gaming', short: 'JDG', partner: true, rating: 88, tier: 'cn_top', region: 'cn', logo: 'jdg.png' },
  { id: 'wbg', name: 'Weibo Gaming', short: 'WBG', partner: true, rating: 92, tier: 'cn_top', region: 'cn', logo: 'wbg.png' },
  // —— 国际 13–16 ——
  { id: 'liquid', name: 'Team Liquid', short: 'TL', partner: false, rating: 78, tier: 'world_c', region: 'na', logo: 'liquid.png' },
  { id: 'secret', name: 'Team Secret', short: 'TS', partner: false, rating: 77, tier: 'world_c', region: 'emea', logo: 'secret.png' },
  { id: 'ninez', name: '9z Team', short: '9Z', partner: false, rating: 76, tier: 'world_c', region: 'latam', logo: 'ninez.png' },
  // —— 国际 9–12 ——
  { id: 'vp', name: 'Virtus.pro', short: 'VP', partner: false, rating: 84, tier: 'world_b', region: 'emea', logo: 'vp.png' },
  { id: 'falcons', name: 'Team Falcons', short: 'FAL', partner: false, rating: 86, tier: 'world_b', region: 'emea', logo: 'falcons.png' },
  { id: 'varrel', name: 'VARREL', short: 'VAR', partner: false, rating: 83, tier: 'world_b', region: 'jp', logo: 'varrel.png' },
  // —— 国际 5–8 ——
  { id: 'cr', name: 'Crazy Raccoon', short: 'CR', partner: false, rating: 90, tier: 'world_a', region: 'kr', logo: 'cr.png' },
  { id: 'dallas', name: 'Dallas Fuel', short: 'DAL', partner: false, rating: 88, tier: 'world_a', region: 'na', logo: 'dallas.png' },
  { id: 'ssg', name: 'Spacestation Gaming', short: 'SSG', partner: false, rating: 87, tier: 'world_a', region: 'na', logo: 'ssg.png' },
  { id: 'geekay', name: 'Geekay Esports', short: 'GK', partner: false, rating: 85, tier: 'world_a', region: 'emea', logo: 'geekay.png' },
  // —— 国际前四（天花板）——
  { id: 'zeta', name: 'ZETA DIVISION', short: 'ZETA', partner: false, rating: 96, tier: 'world_s', region: 'jp', logo: 'zeta.png' },
  { id: 'tm', name: 'Twisted Minds', short: 'TM', partner: false, rating: 94, tier: 'world_s', region: 'emea', logo: 'tm.png' },
  { id: 't1', name: 'T1', short: 'T1', partner: false, rating: 95, tier: 'world_s', region: 'kr', logo: 't1.png' },
]

/** 年薪：按档位；外援合同再乘一截 */
export const SALARY = {
  amateur: [18000, 40000] as const,
  cn_q: [35000, 70000] as const,
  cn_mid: [60000, 120000] as const,
  cn_top: [100000, 200000] as const,
  world: [120000, 280000] as const,
  bench: [15000, 35000] as const,
} as const
export const TEAM_TIER_ORDER = ['amateur', 'cn_q', 'cn_mid', 'cn_top', 'world_c', 'world_b', 'world_a', 'world_s'] as const
export const TEAM_TIER_CLASS: Record<Team['tier'], string> = {
  amateur: 'tm-amateur',
  cn_q: 'tm-cn-q',
  cn_mid: 'tm-cn-mid',
  cn_top: 'tm-cn-top',
  world_c: 'tm-world-c',
  world_b: 'tm-world-b',
  world_a: 'tm-world-a',
  world_s: 'tm-world-s',
}

/**
 * 战队档位硬封顶：队档 = 成绩天花板。个人再强也不能替二线队越阶夺冠。
 * place / intl 数字越小越好（1 = 冠军）；null = 根本摸不到这层。
 */
export type TierCap = {
  /** 常规赛最好名次（1 最好）；进不了季后则 ≥5 */
  regBest: number
  /** 能否进季后赛 */
  playoffs: boolean
  /** 赛区最好名次；null = 无季后名次 */
  regionalBest: number | null
  /** 赛区冠（place=1）出线后能否打国际赛 */
  intl: boolean
  /** 国际赛最好名次；null = 不出线 */
  intlBest: number | null
  /** 能否拿 EWC / 总决赛冠军（titles.world） */
  worldTitle: boolean
  /** 能否摇 FMVP */
  fmvp: boolean
}

export const TIER_CAP: Record<Team['tier'], TierCap> = {
  // 草根：常规赛末游，无季后
  amateur: { regBest: 6, playoffs: false, regionalBest: null, intl: false, intlBest: null, worldTitle: false, fmvp: false },
  // 预选档：常规中下游，无季后
  cn_q:    { regBest: 5, playoffs: false, regionalBest: null, intl: false, intlBest: null, worldTitle: false, fmvp: false },
  // 二线：最多赛区亚军出线，国际赛止步中游；不能赛区冠 / 世界冠
  cn_mid:  { regBest: 2, playoffs: true,  regionalBest: 2,    intl: true,  intlBest: 5,    worldTitle: false, fmvp: false },
  // 中国一线：赛区冠 + 可冲击世界冠
  cn_top:  { regBest: 1, playoffs: true,  regionalBest: 1,    intl: true,  intlBest: 1,    worldTitle: true,  fmvp: true },
  // 外援：按国际席次封顶；世界冠只给 S 档
  world_c: { regBest: 4, playoffs: true,  regionalBest: 4,    intl: true,  intlBest: 7,    worldTitle: false, fmvp: false },
  world_b: { regBest: 3, playoffs: true,  regionalBest: 3,    intl: true,  intlBest: 5,    worldTitle: false, fmvp: false },
  world_a: { regBest: 2, playoffs: true,  regionalBest: 2,    intl: true,  intlBest: 3,    worldTitle: false, fmvp: false },
  world_s: { regBest: 1, playoffs: true,  regionalBest: 1,    intl: true,  intlBest: 1,    worldTitle: true,  fmvp: true },
}
/** 地区名次奖金（人均分成） */
export const STAGE_PRIZE = [0, 60000, 30000, 15000, 8000, 3000, 1500, 0, 0]
/** 国际赛名次奖金（人均分成，基准）× 各站倍数 */
export const INTL_PRIZE = [0, 300000, 150000, 80000, 80000, 40000, 40000, 20000, 20000]
export const INTL_MULT: Record<1 | 2 | 3, number> = { 1: 0.6, 2: 1.2, 3: 1.5 }
export const INTL_NAME: Record<1 | 2 | 3, string> = { 1: 'Champions Clash', 2: 'EWC', 3: 'OWCS 总决赛' }
export const INTL_PLACE: Record<1 | 2 | 3, string> = { 1: '首尔', 2: '利雅得', 3: '斯德哥尔摩' }

/** 赛事高度：职业页的「段位」。颜色借段位色，一格一格往上跳。EWC 和世界总决赛同一级 */
export const PRO_LEVELS = ['网吧赛', '社区赛', '城市赛', '预选赛', '常规赛', '季后赛', '国际赛', '总决赛', '世界冠军', 'FMVP'] as const
export const PRO_LEVEL_CLASS: string[] = MAJOR_ORDER.map((m) => RANK_COLOR_CLASS[m])
export const LV = { netbar: 0, community: 1, city: 2, qualifier: 3, regular: 4, playoffs: 5, intl: 6, worlds: 7, champion: 8, fmvp: 9 } as const
/** 杯赛（低底子的队要先从这儿打出来）：名字、对手底子区间、冠军奖金、人气 */
export const CUPS: Array<{ lv: number; names: string[]; opp: [number, number]; prize: number; fame: number }> = [
  { lv: 0, names: ['网鱼杯', '网咖联赛', '街电杯', '雷蛇网吧赛'], opp: [22, 46], prize: 2000, fame: 200 },
  { lv: 1, names: ['大锤杯', '薯条杯', '守望者杯', '花村杯'], opp: [32, 58], prize: 6000, fame: 800 },
  { lv: 2, names: ['成都站', '上海站', '广州站', '西安站', '武汉站', '杭州站'], opp: [42, 68], prize: 15000, fame: 2000 },
]
/** 杯赛名次（16 强淘汰赛）：打到第几轮 */
export const CUP_PLACE = ['16 强', '8 强', '4 强', '亚军', '冠军'] as const
/** OWWC 世界杯（娱乐性质）：中国队一路能打到哪 */
export const OWWC_PLACE = ['小组出局', '8 强', '4 强', '亚军', '冠军'] as const

/** 职业模式：可主动退役年龄、身体开始下滑年龄、强制收官年龄 */
export const PRO_RETIRE_MIN_AGE = 22
/** 职业分水岭：25 起状态档明显变差 */
export const PRO_DECLINE_AGE = 25
export const PRO_FORCE_RETIRE_AGE = 30
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
export const TALENT_PRO_BONUS: Record<TalentTier, number> = {
  barrel: -5, scrub: -2, normal: 0, solid: 2, something: 4, genius: 7, monster: 11,
}

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
