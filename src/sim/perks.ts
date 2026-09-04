import type { MetaSave } from '../types'
import { ACHIEVEMENTS } from '../data/achievements'
import { ACH_PERKS } from '../data/constants'

/** 已解锁成就数（只数仍存在的成就） */
export function achCount(meta: MetaSave): number {
  return Object.keys(meta.achievements).filter((k) => ACHIEVEMENTS.some((a) => a.id === k)).length
}

/** 已解锁的成就奖励 */
export function perks(meta: MetaSave): Set<string> {
  const n = achCount(meta)
  return new Set(ACH_PERKS.filter((p) => n >= p.n).map((p) => p.id))
}
