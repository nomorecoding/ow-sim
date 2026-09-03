import type { MajorTier, RankState } from '../types'
import { GATE_MAJORS, MAJOR_ORDER } from '../data/constants'

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

export function rand() {
  return Math.random()
}

export function irand(a: number, b: number) {
  return a + Math.floor(rand() * (b - a + 1))
}

/** 近似正态噪声（Box–Muller） */
export function gauss(sigma: number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rand()
  while (v === 0) v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma
}

export function emptyRank(major: MajorTier = 'gold', div = 3, rp = 40): RankState {
  return { major, div, rp }
}

/** 把 rank 编成可比分数：大段*500 + (5-div)*100 + rp */
export function rankScore(r: RankState): number {
  const mi = MAJOR_ORDER.indexOf(r.major)
  const divPart = GATE_MAJORS.includes(r.major) ? (5 - r.div) * 100 : 0
  return mi * 500 + divPart + r.rp
}

/** 顶尖500 只有 0–100 分一段 */
export const MAX_SCORE = (MAJOR_ORDER.length - 1) * 500 + 100
export const TOP_SCORE = (MAJOR_ORDER.length - 1) * 500

export function scoreToRank(score: number): RankState {
  const s = clamp(Math.round(score), 0, MAX_SCORE)
  const mi = clamp(Math.floor(s / 500), 0, MAJOR_ORDER.length - 1)
  const major = MAJOR_ORDER[mi]
  const rem = s % 500
  if (!GATE_MAJORS.includes(major)) {
    return { major, div: 1, rp: clamp(rem, 0, 100) }
  }
  const divIdx = clamp(Math.floor(rem / 100), 0, 4) // 0=div5 … 4=div1
  const div = 5 - divIdx
  const rp = rem % 100
  return { major, div, rp }
}

/** 某大段的起点分 */
export function majorFloor(m: MajorTier): number {
  return MAJOR_ORDER.indexOf(m) * 500
}

/** 分数所在大段 */
export function majorOf(score: number): MajorTier {
  return MAJOR_ORDER[clamp(Math.floor(clamp(score, 0, MAX_SCORE) / 500), 0, MAJOR_ORDER.length - 1)]
}
