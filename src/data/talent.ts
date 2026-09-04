import type { Growth, HiddenTalent, TalentTier } from '../types'
import {
  HIDDEN_INFO, HIDDEN_LEVEL_CAP, HIDDEN_ORDER, HIDDEN_PER_LEVEL,
  LEVEL_EXP_BASE, LEVEL_EXP_STEP, TALENT_INFO, TALENT_ORDER, TALENT_SHIFT_CAP, TALENT_SHIFT_GENIUS, TALENT_SHIFT_PER,
} from './constants'
import { irand, rand } from '../sim/rank'

/** 隐藏天赋：合计约 3%，每级再加一点点；摇不到就是 null */
export function rollHidden(level: number, mult = 1): HiddenTalent | null {
  const extra = Math.min(HIDDEN_LEVEL_CAP, level * HIDDEN_PER_LEVEL) / HIDDEN_ORDER.length
  let r = rand() * 100
  for (const h of HIDDEN_ORDER) {
    r -= (HIDDEN_INFO[h].p + extra) * mult
    if (r < 0) return h
  }
  return null
}

/** 升到下一级需要的经验（线性递增） */
export function levelNeed(level: number): number {
  return LEVEL_EXP_BASE + level * LEVEL_EXP_STEP
}

/** 加经验，逐级结算；返回升了几级 */
export function addExp(g: Growth, exp: number): number {
  g.exp += exp
  let ups = 0
  while (g.exp >= levelNeed(g.level)) {
    g.exp -= levelNeed(g.level)
    g.level++
    ups++
  }
  return ups
}

/** 天才 + 怪物合计挪过来多少个百分点：成就数 + 等级，各 0.1% */
export function talentShift(achievements: number, level: number): number {
  return Math.min(TALENT_SHIFT_CAP, (achievements + level) * TALENT_SHIFT_PER)
}

/** 各档概率（百分比）：底盘固定，天才 / 怪物随 shift 上移，从木桶 / 普通里按比例扣 */
export function talentProbs(shift: number): Record<TalentTier, number> {
  const out = {} as Record<TalentTier, number>
  for (const t of TALENT_ORDER) out[t] = TALENT_INFO[t].base
  const low = out.barrel + out.normal
  out.barrel -= shift * (out.barrel / low)
  out.normal -= shift * (out.normal / low)
  out.genius += shift * TALENT_SHIFT_GENIUS
  out.monster += shift * (1 - TALENT_SHIFT_GENIUS)
  for (const t of TALENT_ORDER) out[t] = Math.round(out[t] * 10) / 10
  return out
}

function rollTier(shift: number): TalentTier {
  const w = talentProbs(shift)
  let r = rand() * TALENT_ORDER.reduce((a, t) => a + w[t], 0)
  for (const t of TALENT_ORDER) {
    r -= w[t]
    if (r <= 0) return t
  }
  return 'normal'
}

/** 摇一辈子的天赋：返回档位与起点实力 */
export function rollTalent(shift: number): { tier: TalentTier; mmr: number } {
  const tier = rollTier(shift)
  const info = TALENT_INFO[tier]
  return { tier, mmr: irand(info.start[0], info.start[1]) }
}
