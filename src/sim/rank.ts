import type { GameState, LogLine, MajorTier, RankModifier, RankState } from '../types'
import {
  CLOUD_MUD_CHANCE, GATE_MAJORS, HELPER_TIERS, MAJOR_ORDER, TEMPER_LAST_N, isAtMajorGate, majorIndex, rankLabel,
} from '../data/constants'
import { buildCloudMudEnding } from '../data/endings'

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

export function rand() {
  return Math.random()
}

export function irand(a: number, b: number) {
  return a + Math.floor(rand() * (b - a + 1))
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
/** 顶尖 500 榜单需要的本季胜场 */
export const TOP_MIN_WINS = 25

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

function divKey(r: RankState) {
  return `${r.major}-${r.div}`
}

/**
 * 应用分数变化，带「保级保护」：
 * 某小段第一次要掉到 0 分以下时停在 0；再输一把才真正降段。
 */
export function applyRp(g: GameState, delta: number): RankModifier | null {
  const cur = rankScore(g.rank)
  let next = clamp(cur + delta, 0, MAX_SCORE)
  // 顶尖 500 是榜单：胜场不够就卡在英杰 1·99
  if (next >= TOP_SCORE && g.wins < TOP_MIN_WINS) next = TOP_SCORE - 1

  let mod: RankModifier | null = null
  if (delta < 0 && GATE_MAJORS.includes(g.rank.major)) {
    const floor = cur - g.rank.rp // 本小段 0 分
    if (next < floor) {
      const key = divKey(g.rank)
      if (g.protectedDiv !== key) {
        g.protectedDiv = key
        next = floor
        mod = 'demotion_protect'
      } else {
        mod = 'demotion'
      }
    }
  }
  const before = divKey(g.rank)
  g.rank = scoreToRank(next)
  if (divKey(g.rank) !== before && mod !== 'demotion') g.protectedDiv = null
  if (mod === 'demotion') g.protectedDiv = null
  return mod
}

/** 匹配系统对你的估计：SR 与 MMR 按置信度混合 */
export function systemEstimate(g: GameState): number {
  return rankScore(g.rank) * (1 - g.conf) + g.mmr * g.conf
}

/** 赛季末（竞逐周 / 最后 15% 额度）：对手更硬，帮手胜率打折 */
export const LATE_HELPER_PENALTY = 0.1

export function isLateSeason(g: GameState): boolean {
  return g.phase === 'rivalry' || (g.phase !== 'placement' && g.quotaLeft <= Math.ceil(g.quotaMax * 0.15))
}

/**
 * 代练 / 陪玩胜率。同一函数供对局与黑市价目表使用，保证展示与实际一致。
 * 代练：每高一大段 +8 点，上限 95。陪玩：同档比代练低 8 点，单人上限 90（OWL 级 388/h 顶到 90）；多人叠加，上限 95。
 * late：赛季末下单，−10 点。
 */
export function helperOdds(kind: 'boost' | 'escort', tierIdx: number, count: number, myMajorIdx: number, late = false): number {
  const diff = tierIdx - myMajorIdx
  const boostP = clamp(0.5 + 0.08 * diff, 0.35, 0.95)
  const pen = late ? LATE_HELPER_PENALTY : 0
  if (kind === 'boost') return clamp(boostP - pen, 0.3, 0.95)
  const solo = clamp(boostP - 0.08, 0.3, 0.9)
  return clamp(1 - (1 - solo) * Math.pow(0.55, count - 1) - pen, 0.3, 0.95)
}

export function helperWinProb(g: GameState): number | null {
  const h = g.helper
  if (!h || h.left <= 0) return null
  const tier = HELPER_TIERS.find((t) => t.id === h.tier)
  if (!tier) return null
  return helperOdds(h.kind, tier.idx, h.count, majorIndex(g.rank.major), isLateSeason(g))
}

/**
 * 胜率：系统按估计值找对手，你的真实水平与估计的差决定胜率。
 * 校准期估计跟着 SR 走 → 高胜率；识别后归于五五开（这就是被诟病的控胜率）。
 */
export function winProb(g: GameState, rivalryOn: boolean): number {
  const hp = helperWinProb(g)
  if (hp != null && g.helper?.kind === 'boost') return hp

  const est = systemEstimate(g)
  let p = 0.5 + clamp((g.mmr - est) / 1200, -0.25, 0.25)

  if (g.identity === 'cheat') p += 0.22
  if (g.identity === 'boost') p += 0.1
  if (hp != null) p = Math.max(p, hp)
  const pol = Math.min(100, g.envPollution)
  p -= pol * 0.0008
  if (rivalryOn) p -= 0.03 + majorIndex(g.rank.major) * 0.006
  if (g.winStreak >= 4) p += 0.02
  if (g.loseStreak >= 4) p -= 0.02
  return clamp(p, 0.2, 0.85)
}

/**
 * 分数变化与修正词。SR 靠修正词漂向 MMR：
 * 低于真实水平 → 赢多加（逆风局）输少扣（安慰奖）；高于 → 赢少加（预期）输多扣（大逆转）。
 */
export function rpChange(g: GameState, win: boolean): { delta: number; mods: RankModifier[] } {
  const mods: RankModifier[] = []
  const sr = rankScore(g.rank)
  const gap = g.mmr - sr
  const base = irand(18, 26)
  let mult = 1

  // 代练替你打：系统看到的是代练的水平，正常涨分，不吃你的修正词
  if (g.helper?.kind === 'boost' && g.helper.left > 0) {
    if (g.conf < 0.5) { mods.push('calibration'); mult *= 1.4 }
    if (sr >= 4000) { mods.push('pressure_down'); mult *= win ? 0.8 : 1.2 }
    return { delta: Math.max(1, Math.round(base * mult)) * (win ? 1 : -1), mods }
  }

  const gapFactor = clamp(Math.abs(gap) / 3200, 0, 0.3)
  if (Math.abs(gap) > 80) {
    if (win && gap > 0) { mods.push('uphill'); mult += gapFactor }
    else if (win) { mods.push('expected'); mult -= gapFactor }
    else if (gap > 0) { mods.push('consolation'); mult -= gapFactor }
    else { mods.push('reversal'); mult += gapFactor }
  } else if (win) {
    mods.push('expected')
  }

  if (g.conf < 0.5) { mods.push('calibration'); mult *= 1.6 }

  if (sr >= 4000) {
    mods.push('pressure_down')
    mult *= win ? 0.8 : 1.2
  } else if (sr <= 300) {
    mods.push('pressure_up')
    mult *= win ? 1.2 : 0.8
  }

  if (win && g.winStreak >= 3) { mods.push('win_trend'); mult += 0.15 }
  if (!win && g.loseStreak >= 3) { mods.push('lose_trend'); mult += 0.15 }

  // 陪玩 = 宽组：收益打折，人越多折越狠
  if (g.helper?.kind === 'escort' && g.helper.left > 0) {
    mods.push('wide')
    mult *= win ? Math.max(0.5, 0.85 - g.helper.count * 0.08) : 0.8
  }

  if (g.identity === 'cheat' && win) mult *= 1.2

  const delta = Math.max(1, Math.round(base * mult)) * (win ? 1 : -1)
  return { delta, mods }
}

/** 每把之后系统置信度上升：约 30 把完成校准 */
export function bumpConf(g: GameState) {
  g.conf = Math.min(1, g.conf + 1 / 30)
}

/* ———————————— 云泥之隔 ———————————— */

export function cloudMudTargetScore(major: MajorTier): number | null {
  if (!GATE_MAJORS.includes(major)) return null
  return rankScore({ major, div: 1, rp: 99 })
}

export function maybeEnableCloudMud(g: GameState): void {
  if (g.cloudMudAim) return
  if (g.quotaLeft !== TEMPER_LAST_N) return
  if (!isAtMajorGate(g.rank) && g.rank.div > 2) {
    if (rand() > CLOUD_MUD_CHANCE * 0.35) return
  } else if (rand() > CLOUD_MUD_CHANCE) {
    return
  }
  if (!GATE_MAJORS.includes(g.rank.major)) return
  g.cloudMudAim = true
  const line = { cls: 'temper', text: '赛季末空气开始诡异……命运似乎想把你按在「差 1 分」上。' }
  g.events.push(line)
  g.logs.push(line)
}

export function temperedShouldWin(g: GameState, baseP: number): boolean {
  if (!g.cloudMudAim || g.quotaLeft > TEMPER_LAST_N) return rand() < baseP
  const target = cloudMudTargetScore(g.rank.major)
  if (target == null) return rand() < baseP
  const cur = rankScore(g.rank)
  if (cur < target - 80) return rand() < clamp(baseP + 0.08, 0.2, 0.75)
  const diff = target - cur
  if (diff > 25) return rand() < clamp(baseP + 0.12, 0.25, 0.8)
  if (diff > 5) return rand() < clamp(baseP + 0.05, 0.2, 0.7)
  if (diff === 0) return false
  if (diff < 0) return rand() < 0.15
  return rand() < 0.55
}

export function temperedRpDelta(g: GameState, win: boolean, base: number): number {
  if (!g.cloudMudAim || g.quotaLeft > TEMPER_LAST_N) return base
  const target = cloudMudTargetScore(g.rank.major)
  if (target == null) return base
  const cur = rankScore(g.rank)
  const diff = target - cur
  if (win) {
    if (diff <= 0) return 0
    return clamp(diff, 1, Math.min(base, Math.max(1, diff)))
  }
  if (cur > target) return -clamp(cur - target, 1, 20)
  if (diff > 30) return -irand(8, 14)
  return base
}

export function tryFinishCloudMud(g: GameState): LogLine[] {
  const lines: LogLine[] = []
  if (!isAtMajorGate(g.rank) || g.rank.rp !== 99) return lines
  const ending = buildCloudMudEnding(g.rank.major)
  if (!ending) return lines
  g.ending = ending
  lines.push({ cls: 'ending', text: `【趣味结局】${ending.title}` })
  lines.push({ cls: 'ending', text: ending.rankLabel })
  for (const v of ending.verse) lines.push({ cls: 'verse', text: v })
  return lines
}

export function snapTowardCloudMud(g: GameState): void {
  if (!g.cloudMudAim) return
  if (!GATE_MAJORS.includes(g.rank.major)) return
  const target = cloudMudTargetScore(g.rank.major)
  if (target == null) return
  const cur = rankScore(g.rank)
  if (Math.abs(cur - target) <= 30 || (isAtMajorGate(g.rank) && g.rank.rp >= 88)) {
    g.rank = { major: g.rank.major, div: 1, rp: 99 }
    g.events.push({ cls: 'temper', text: `最后一刻，分数停在了 ${rankLabel(g.rank)}……` })
  }
}
