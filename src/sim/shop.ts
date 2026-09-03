import type { GameState, LogLine, MetaSave } from '../types'
import { BOOST_JOBS, ESCORT_MAX_COUNT, GEAR_LEVELS, HELPER_PACK_GAMES, HELPER_TIERS } from '../data/constants'
import { unlock } from './ach'

export function helperCost(kind: 'boost' | 'escort', tierId: string, count: number): number {
  const t = HELPER_TIERS.find((x) => x.id === tierId)
  if (!t) return 0
  const per = kind === 'boost' ? t.boostPrice : t.escortPrice
  return per * HELPER_PACK_GAMES * (kind === 'escort' ? count : 1)
}

/** 请代练：替你打 10 把 */
export function hireBooster(g: GameState, tierId: string): LogLine {
  const t = HELPER_TIERS.find((x) => x.id === tierId)
  if (!t || !t.boost) return { cls: 'sys', text: '这个档没有代练服务。' }
  if (g.identity === 'cheat') return { cls: 'sys', text: '开着挂请代练？代练看到你的号直接跑了。' }
  const cost = helperCost('boost', tierId, 1)
  if (g.cash < cost) return { cls: 'sys', text: `现金不足：${t.name}代练 ${HELPER_PACK_GAMES} 把需要 ${cost}，你只有 ${g.cash}` }
  g.cash -= cost
  g.helper = { kind: 'boost', tier: tierId, count: 1, left: HELPER_PACK_GAMES + (g.helper?.kind === 'boost' ? g.helper.left : 0) }
  g.envPollution += 6
  g.dirtyThisSeason = true
  unlock(g, 'first_escort')
  return {
    cls: 'ev',
    text: `【代练】${t.name}代练上号，现金-${cost}。接下来 ${HELPER_PACK_GAMES} 把你不用打。账号共享有被检测风险。污染+6。`,
  }
}

/** 请陪玩：和你一起打 10 把，1–4 人 */
export function hireEscort(g: GameState, tierId: string, count: number): LogLine {
  const t = HELPER_TIERS.find((x) => x.id === tierId)
  if (!t) return { cls: 'sys', text: '这个档不存在。' }
  const n = Math.max(1, Math.min(ESCORT_MAX_COUNT, count))
  const cost = helperCost('escort', tierId, n)
  if (g.cash < cost) return { cls: 'sys', text: `现金不足：${n} 个${t.name}陪玩 ${HELPER_PACK_GAMES} 把需要 ${cost}，你只有 ${g.cash}` }
  g.cash -= cost
  g.helper = { kind: 'escort', tier: tierId, count: n, left: HELPER_PACK_GAMES }
  const pol = 3 * n
  g.envPollution += pol
  g.dirtyThisSeason = true
  unlock(g, 'first_escort')
  if (t.id === 'owl') unlock(g, 'escort_388')
  return {
    cls: 'ev',
    text: `【陪玩】${n} 个${t.name}陪你 ${HELPER_PACK_GAMES} 把，现金-${cost}。${n >= 4 ? '5 排 4 陪 1，基本躺赢。' : ''}宽组减收益，污染+${pol}。`,
  }
}

export function takeBoostJob(g: GameState, jobId: string): LogLine {
  const job = BOOST_JOBS.find((j) => j.id === jobId)
  if (!job) return { cls: 'sys', text: '单子不存在。' }
  if (g.identity === 'cheat') return { cls: 'sys', text: '开着挂接单？老板不敢用你。' }
  if (g.career.phase === 'signed') return { cls: 'sys', text: '职业选手接代练？被拍到就是解约加禁赛。你没敢。' }
  g.identity = 'boost'
  g.careerBanned = true
  if (g.career.phase === 'scouted') {
    g.career.phase = 'none'
    g.career.team = undefined
  }
  g.cash += job.payout
  g.boostEarned += job.payout
  g.envPollution += job.pollution
  g.dirtyThisSeason = true
  unlock(g, 'first_boost')
  return {
    cls: 'warn',
    text: `你接了【${job.name}】，入账+${job.payout}，污染+${job.pollution}。这个存档不会再有战队找你。`,
  }
}

export function enableCheat(g: GameState): LogLine {
  if (g.identity === 'cheat') return { cls: 'sys', text: '已经在开了。' }
  g.identity = 'cheat'
  g.dirtyThisSeason = true
  unlock(g, 'cheat_on')
  return { cls: 'ban', text: '你开挂了。无门槛、无花费。官方抽检与每局举报已启动。' }
}

export function purifyEnv(g: GameState): LogLine {
  if (g.credit < 25) return { cls: 'sys', text: '信誉不足 25，无法净修。现金买不了信誉。' }
  g.credit -= 25
  g.envPollution = Math.max(0, g.envPollution - 18)
  g.redBox = false
  g.muteLeft = 0
  return { cls: 'sys', text: '花费 25 信誉净修。环境污染-18，禁言红框解除。' }
}

/** 买设备：唯一能用现金换成长的正经途径 */
export function buyGear(meta: MetaSave, g: GameState | null): LogLine {
  const next = GEAR_LEVELS[meta.growth.gear]
  if (!next) return { cls: 'sys', text: '设备已满级。' }
  const cash = g ? g.cash : meta.cash
  if (cash < next.cost) return { cls: 'sys', text: `现金不足：${next.name} 需要 ${next.cost}。` }
  if (g) g.cash -= next.cost
  else meta.cash -= next.cost
  meta.growth.gear = next.level
  if (meta.growth.gear >= GEAR_LEVELS.length) meta.achievements['gear_max'] = true
  return { cls: 'ev', text: `【设备】${next.name}，现金-${next.cost}。天赋分布上移（成长 +1）。` }
}
