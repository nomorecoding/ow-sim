import type { GameState, Helper, LogLine, MetaSave } from '../types'
import { BOOST_JOBS, ESCORT_MAX_COUNT, GEAR_LEVELS, HELPER_PACK_GAMES, HELPER_TIERS } from '../data/constants'
import { unlock } from './ach'

export function helperCost(kind: 'boost' | 'escort', tierId: string, count: number): number {
  const t = HELPER_TIERS.find((x) => x.id === tierId)
  if (!t) return 0
  const per = kind === 'boost' ? t.boostPrice : t.escortPrice
  return per * HELPER_PACK_GAMES * (kind === 'escort' ? count : 1)
}

/** 请代练：替你打 10 把（可续单叠加） */
export function hireBooster(g: GameState, tierId: string): LogLine {
  const t = HELPER_TIERS.find((x) => x.id === tierId)
  if (!t || !t.boost) return { cls: 'sys', text: '这个档没有代练服务。' }
  if (g.identity === 'cheat') return { cls: 'sys', text: '开着挂请代练？代练看到你的号直接跑了。' }
  if (g.career.phase === 'signed') return { cls: 'sys', text: '职业选手的号给代练？被查到就是终身禁赛。你没敢。' }
  const cost = helperCost('boost', tierId, 1)
  if (g.cash < cost) return { cls: 'sys', text: `现金不足：${t.name}代练 ${HELPER_PACK_GAMES} 把需要 ${cost}，你只有 ${g.cash}` }
  g.cash -= cost
  const carry = g.helper?.kind === 'boost' && g.helper.tier === tierId ? g.helper.left : 0
  g.helper = { kind: 'boost', tier: tierId, count: 1, left: HELPER_PACK_GAMES + carry }
  g.lastHelper = { ...g.helper, left: HELPER_PACK_GAMES }
  g.helperDone = false
  g.envPollution += 6
  g.dirtyThisSeason = true
  g.dirty.hires++
  unlock(g, 'first_escort')
  return {
    cls: 'ev',
    text: `【代练】${t.name}代练上号，现金 −${cost}。接下来 ${g.helper.left} 把你不用打。账号共享有被检测风险，也会进黑历史。污染 +6。`,
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
  const carry = g.helper?.kind === 'escort' && g.helper.tier === tierId && g.helper.count === n ? g.helper.left : 0
  g.helper = { kind: 'escort', tier: tierId, count: n, left: HELPER_PACK_GAMES + carry }
  g.lastHelper = { ...g.helper, left: HELPER_PACK_GAMES }
  g.helperDone = false
  const pol = 3 * n
  g.envPollution += pol
  g.dirtyThisSeason = true
  g.dirty.hires++
  unlock(g, 'first_escort')
  if (t.id === 'owl') unlock(g, 'escort_388')
  return {
    cls: 'ev',
    text: `【陪玩】${n} 个${t.name}陪你 ${HELPER_PACK_GAMES} 把，现金 −${cost}。${n >= 4 ? '5 排 4 陪 1，基本躺赢。' : ''}宽组减收益，污染 +${pol}。`,
  }
}

/** 开赛前预订：钱从档案里扣，下赛季第一把就上号 */
export function preorderHelper(meta: MetaSave, kind: 'boost' | 'escort', tierId: string, count: number): LogLine {
  const t = HELPER_TIERS.find((x) => x.id === tierId)
  if (!t) return { cls: 'sys', text: '这个档不存在。' }
  if (kind === 'boost' && !t.boost) return { cls: 'sys', text: '这个档没有代练服务。' }
  if (meta.career.phase === 'signed') return { cls: 'sys', text: '职业选手预订代练陪玩？被查到就是终身禁赛。' }
  if (meta.preorder) return { cls: 'sys', text: '已经有一份预订了，先取消再换。' }
  const n = kind === 'escort' ? Math.max(1, Math.min(ESCORT_MAX_COUNT, count)) : 1
  const cost = helperCost(kind, tierId, n)
  if (meta.cash < cost) return { cls: 'sys', text: `现金不足：需要 ${cost}，你只有 ${meta.cash}` }
  meta.cash -= cost
  meta.preorder = { kind, tier: tierId, count: n, left: HELPER_PACK_GAMES }
  meta.achievements['preorder'] = true
  return { cls: 'ev', text: `【预订】${kind === 'boost' ? `${t.name}代练` : `${n} 个${t.name}陪玩`}，现金 −${cost}。下赛季开局即上号，定级赛一起打。` }
}

export function cancelPreorder(meta: MetaSave): LogLine {
  const p = meta.preorder
  if (!p) return { cls: 'sys', text: '没有预订。' }
  const refund = helperCost(p.kind, p.tier, p.count)
  meta.cash += refund
  meta.preorder = undefined
  return { cls: 'sys', text: `预订取消，退回 ${refund}。` }
}

/** 一键续同款 */
export function rehire(g: GameState): LogLine {
  const h = g.lastHelper
  if (!h) return { cls: 'sys', text: '本季还没买过套餐。' }
  return h.kind === 'boost' ? hireBooster(g, h.tier) : hireEscort(g, h.tier, h.count)
}

export function describeHelper(h: Helper): string {
  const t = HELPER_TIERS.find((x) => x.id === h.tier)
  return h.kind === 'boost' ? `${t?.name ?? ''}代练` : `${h.count} 个${t?.name ?? ''}陪玩`
}

/** 接代练单：来钱快，进黑历史；签约后会被翻出来 */
export function takeBoostJob(g: GameState, jobId: string): LogLine {
  const job = BOOST_JOBS.find((j) => j.id === jobId)
  if (!job) return { cls: 'sys', text: '单子不存在。' }
  if (g.identity === 'cheat') return { cls: 'sys', text: '开着挂接单？老板不敢用你。' }
  if (g.career.phase === 'signed') return { cls: 'sys', text: '职业选手接代练？被拍到就是解约加终身禁赛。你没敢。' }
  g.identity = 'boost'
  g.dirty.boostJobs++
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
    text: `你接了【${job.name}】，入账 +${job.payout}，污染 +${job.pollution}。这一单会留在账号记录里——以后打职业，背调可能翻出来。`,
  }
}

export function enableCheat(g: GameState): LogLine {
  if (g.identity === 'cheat') return { cls: 'sys', text: '已经在开了。' }
  g.identity = 'cheat'
  g.dirtyThisSeason = true
  g.cheatedThisSeason = true
  unlock(g, 'cheat_on')
  return { cls: 'ban', text: '你开挂了。无门槛、无花费。官方抽检与每局举报已启动。' }
}

export function purifyEnv(g: GameState): LogLine {
  if (g.credit < 25) return { cls: 'sys', text: '信誉不足 25，无法净修。现金买不了信誉。' }
  g.credit -= 25
  g.envPollution = Math.max(0, g.envPollution - 18)
  g.redBox = false
  g.muteLeft = 0
  return { cls: 'sys', text: '花费 25 信誉净修。环境污染 −18，禁言红框解除。' }
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
  return { cls: 'ev', text: `【设备】${next.name}，现金 −${next.cost}。天赋分布上移（成长 +1）。` }
}
