import type { Growth, TalentTier } from '../types'
import { GROWTH_CAP, GROWTH_SEASONS_CAP, PRO_DECLINE_AGE, TALENT_INFO, TALENT_ORDER } from './constants'
import { irand, rand } from '../sim/rank'

/** 成长点：只改天赋分布 */
export function growthPoints(g: Growth, age: number): number {
  // 赛季经验每 2 季 +1
  let p = Math.min(GROWTH_SEASONS_CAP, Math.floor(g.seasons / 2)) + g.heroPool + g.gear
  // 年龄：25 岁后每年 -1，30 岁后每年再 -1
  if (age >= PRO_DECLINE_AGE) p -= age - PRO_DECLINE_AGE + 1
  if (age >= 30) p -= age - 30 + 1
  return Math.max(-10, Math.min(GROWTH_CAP, p))
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

/** 摇本季天赋：返回档位与隐藏 MMR */
export function rollTalent(points: number): { tier: TalentTier; mmr: number } {
  const tier = rollTier(points)
  const info = TALENT_INFO[tier]
  return { tier, mmr: irand(info.min, info.max) }
}
