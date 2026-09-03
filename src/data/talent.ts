import type { Growth, TalentTier } from '../types'
import { GROWTH_CAP, GROWTH_RUNS_CAP, TALENT_INFO, TALENT_ORDER } from './constants'
import { irand, rand } from '../sim/rank'

/** 成长点：只改天赋分布 */
export function growthPoints(g: Growth): number {
  const p = Math.min(GROWTH_RUNS_CAP, g.runs) + g.heroPool + g.milestones
  return Math.max(0, Math.min(GROWTH_CAP, p))
}

/** 各档权重 */
export function talentWeights(points: number): Record<TalentTier, number> {
  const out = {} as Record<TalentTier, number>
  for (const t of TALENT_ORDER) {
    const info = TALENT_INFO[t]
    out[t] = Math.max(0.2, info.base * (1 + info.grow * points))
  }
  return out
}

/** 各档概率（百分比，保留一位） */
export function talentProbs(points: number): Record<TalentTier, number> {
  const w = talentWeights(points)
  const sum = TALENT_ORDER.reduce((a, t) => a + w[t], 0)
  const out = {} as Record<TalentTier, number>
  for (const t of TALENT_ORDER) out[t] = Math.round((w[t] / sum) * 1000) / 10
  return out
}

function rollTier(points: number): TalentTier {
  const w = talentWeights(points)
  let r = rand() * TALENT_ORDER.reduce((a, t) => a + w[t], 0)
  for (const t of TALENT_ORDER) {
    r -= w[t]
    if (r <= 0) return t
  }
  return 'normal'
}

/** 摇一辈子的天赋：返回档位与起点实力 */
export function rollTalent(points: number): { tier: TalentTier; mmr: number } {
  const tier = rollTier(points)
  const info = TALENT_INFO[tier]
  return { tier, mmr: irand(info.start[0], info.start[1]) }
}
