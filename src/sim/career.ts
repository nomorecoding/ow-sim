import type { Career, GameState, LogLine, StageResult, Team } from '../types'
import {
  GROWTH_TRAINING_CAP, INTL_NAME, INTL_PRIZE, RETIRE_AGE, SALARY, SCOUT_MIN_MATCHES, SCOUT_MIN_SCORE,
  STAGE_PRIZE, TEAMS,
} from '../data/constants'
import { clamp, irand, rand, rankScore } from './rank'
import { unlock } from './ach'

export function freshCareer(): Career {
  return { phase: 'none', seasonsSigned: 0, history: [], yearScore: 0, worldCup: 0 }
}

const MAPS = ['里阿尔托', '努巴尼', '好莱坞', '国王大道', '漓江塔', '伊利奥斯', '尼泊尔', '直布罗陀', '66号公路', '巴黎', '新皇后街', '科洛塞', '伊斯佩兰萨', '多拉多', '花村', '阿努比斯神殿']
const MOMENTS = ['最后一波抢下决胜点', '推车差 0.3 米', '被对面辅助大招翻盘', '你一个大招清了三个', '加时守住了', '教练喊了暂停也没救回来', '对面 C 位手感爆炸', '你的英雄被 ban 了，换手打得别扭']

function map() { return MAPS[irand(0, MAPS.length - 1)] }
function moment() { return MOMENTS[irand(0, MOMENTS.length - 1)] }

/** 玩家对队伍战力的贡献：以 MMR 与训练为主 */
export function teamStrength(g: GameState): number {
  const t = g.career.team
  if (!t) return 0
  const you = (g.mmr - 3800) / 40 + Math.min(GROWTH_TRAINING_CAP, g.career.seasonsSigned / 2) * 1.5
  return t.rating + you + irand(-6, 6)
}

/** 被发掘：本季 ≥ 宗师 1 且已打 ≥ 40 把，每把小概率 */
export function checkScouting(g: GameState, events: LogLine[]) {
  if (g.career.phase !== 'none' || g.careerBanned || g.identity !== 'casual' || g.scoutedThisSeason) return
  if (g.stage === 'coach') return
  if (g.age >= 27) return
  if (g.matchesThisSeason < SCOUT_MIN_MATCHES || rankScore(g.rank) < SCOUT_MIN_SCORE) return
  if (rand() > 0.05) return
  const partnerOk = g.mmr >= 4300
  const pool = TEAMS.filter((t) => partnerOk || !t.partner)
  const team = pool[irand(0, pool.length - 1)]
  g.career.phase = 'scouted'
  g.career.team = team
  g.scoutedThisSeason = true
  events.push({ cls: 'career', text: `【私信】「你好，我是${team.name}的经理，看了你最近的对局，下赛季有兴趣来打几场训练赛吗？」` })
  unlock(g, 'career_scouted')
}

/** 试训：赛季开局打 3 场 BO3 训练赛 */
export function runTrial(g: GameState, logs: LogLine[]) {
  const team = g.career.team!
  const p = clamp(0.35 + (g.mmr - 3800) / 1500 + (60 - team.rating) / 200, 0.15, 0.9)
  let wins = 0
  logs.push({ cls: 'career', text: `【试训】${team.name} 训练赛 · 三场 BO3` })
  for (let i = 1; i <= 3; i++) {
    const w = rand() < p
    if (w) wins++
    logs.push({ cls: w ? 'win' : 'lose', text: `训练赛 ${i} · ${map()} · ${w ? '2:1 胜' : '1:2 负'}，${moment()}。` })
  }
  const pass = wins >= 2 || (wins === 1 && rand() < 0.35)
  if (pass) {
    g.career.phase = 'signed'
    g.career.seasonsSigned = 0
    g.career.yearScore = 0
    logs.push({ cls: 'career', text: `【签约】${team.name} 给了合同。${team.partner ? '合作战队，底薪体面，Stage 1 免预选。' : '普通队，底薪不高，从公开预选打起。'}` })
    unlock(g, 'career_signed')
    if (team.partner) unlock(g, 'career_partner')
    if (g.stage === 'student' && rand() < 0.6) {
      g.stage = 'dropout'
      logs.push({ cls: 'sys', text: '为了打训练赛，你办了休学。' })
    }
  } else {
    g.career.phase = 'none'
    g.career.team = undefined
    logs.push({ cls: 'warn', text: `【试训】${team.name}：「先回去打天梯吧，保持状态。」没签。` })
  }
}

/** 每赛季底薪 */
export function salary(g: GameState): number {
  const t = g.career.team
  if (!t || g.career.phase !== 'signed') return 0
  const [a, b] = t.partner ? SALARY.partner : SALARY.normal
  return irand(a, b)
}

/** 名次模拟：把你的队伍和 n 个对手按战力排序，返回名次 1..n+1 */
function placeAmong(strength: number, opps: number[]): number {
  return 1 + opps.filter((o) => o + irand(-8, 8) > strength).length
}

function series(you: number, opp: number, bo: number): { win: boolean; score: string } {
  const need = Math.ceil(bo / 2)
  let a = 0
  let b = 0
  const p = clamp(0.5 + (you - opp) / 80, 0.15, 0.85)
  while (a < need && b < need) {
    if (rand() < p) a++
    else b++
  }
  return { win: a > b, score: `${a}:${b}` }
}

/** OWCS Stage：预选（瑞士轮 8 队）→ 循环赛 6 队 → 双败 4 队 → 国际赛 */
export function runStage(g: GameState, stage: 1 | 2 | 3, logs: LogLine[]) {
  if (g.career.phase !== 'signed' || !g.career.team) return
  const team = g.career.team
  const you = teamStrength(g)
  const res: StageResult = { year: g.year, stage, team: team.name, place: 0, intl: 0, prize: 0 }
  logs.push({ cls: 'career', text: `【OWCS 中国赛区 · 第 ${g.year} 年 Stage ${stage}】${team.name}` })

  // 预选：合作战队 Stage 1 免；其他 8 队瑞士轮，前 6 进循环赛
  let inRR = true
  if (!(team.partner && stage === 1)) {
    const opps = Array.from({ length: 7 }, () => irand(38, 82))
    const p = placeAmong(you, opps)
    const s1 = series(you, opps[0], 3)
    logs.push({ cls: s1.win ? 'win' : 'lose', text: `公开预选 · 瑞士轮首轮 · ${map()} ${s1.score}，${moment()}。` })
    if (p <= 6) logs.push({ cls: 'career', text: `瑞士轮第 ${p}，晋级常规赛循环。` })
    else {
      inRR = false
      res.place = p
      logs.push({ cls: 'warn', text: `瑞士轮第 ${p}，7–8 名淘汰。本 Stage 到此为止。` })
    }
  } else {
    logs.push({ cls: 'sys', text: '合作战队 Stage 1 免预选，直接进常规赛。' })
  }

  if (inRR) {
    const opps = Array.from({ length: 5 }, () => irand(50, 90))
    const p = placeAmong(you, opps)
    const s = series(you, opps[irand(0, 4)], 3)
    logs.push({ cls: s.win ? 'win' : 'lose', text: `常规赛循环 · 对阵${TEAMS[irand(0, TEAMS.length - 1)].name} · ${map()} ${s.score}。` })
    unlock(g, 'career_regular')
    if (p <= 4) {
      logs.push({ cls: 'career', text: `循环赛第 ${p}，进入 4 队双败季后赛。` })
      unlock(g, 'career_playoffs')
      // 双败：胜者组 → 决赛
      const semi = series(you, irand(60, 92), 5)
      logs.push({ cls: semi.win ? 'win' : 'lose', text: `季后赛胜者组 · ${map()} ${semi.score}，${moment()}。` })
      let final: { win: boolean; score: string } | null = null
      if (semi.win) {
        final = series(you, irand(68, 95), 5)
        logs.push({ cls: final.win ? 'win' : 'lose', text: `地区决赛 · ${map()} ${final.score}，${moment()}。` })
        res.place = final.win ? 1 : 2
      } else {
        const lower = series(you, irand(55, 88), 5)
        logs.push({ cls: lower.win ? 'win' : 'lose', text: `败者组 · ${map()} ${lower.score}。` })
        if (lower.win) {
          final = series(you, irand(68, 95), 5)
          logs.push({ cls: final.win ? 'win' : 'lose', text: `败者组决赛 · ${map()} ${final.score}。` })
          res.place = final.win ? 2 : 3
        } else res.place = 4
      }
    } else {
      res.place = p
      logs.push({ cls: 'sys', text: `循环赛第 ${p}，无缘季后赛。` })
    }
  }

  res.prize = STAGE_PRIZE[res.place] ?? 0
  if (res.place === 1) unlock(g, 'career_regional_champ')
  logs.push({ cls: 'career', text: `Stage ${stage} 地区名次 ${res.place}${res.prize ? `，奖金分成 +${res.prize}` : ''}。` })

  // 地区前 2 出线国际赛
  if (res.place <= 2) {
    const name = INTL_NAME[stage]
    const opps = Array.from({ length: 7 }, () => irand(72, 96))
    const ip = placeAmong(you + 4, opps)
    const s = series(you, opps[0], 5)
    logs.push({ cls: s.win ? 'win' : 'lose', text: `【${name}】小组赛 · 对阵韩国队 · ${map()} ${s.score}，${moment()}。` })
    res.intl = ip
    const ipz = INTL_PRIZE[ip] ?? 0
    res.prize += ipz
    logs.push({ cls: ip <= 2 ? 'ending' : 'career', text: `${name} 最终名次 ${ip}${ipz ? `，奖金 +${ipz}` : ''}。` })
    unlock(g, 'career_intl')
    if (ip === 1) unlock(g, 'career_world_champ')
  }

  g.cash += res.prize
  g.career.history.push(res)
  g.career.yearScore += Math.max(0, 9 - res.place) + (res.intl ? Math.max(0, 9 - res.intl) : 0)
  g.career.seasonsSigned++
}

/** 年末：转会窗 + 世界杯 + 退役判定 */
export function yearEnd(g: GameState, logs: LogLine[]) {
  const c = g.career
  if (c.phase === 'signed' && c.team) {
    // 世界杯：全年表现前列，小概率入选国家队
    if (c.yearScore >= 14 && rand() < 0.3) {
      c.worldCup++
      logs.push({ cls: 'ending', text: '【世界杯】国家队名单公布，有你。9 月去暴雪嘉年华。' })
      unlock(g, 'career_worldcup')
    }
    // 转会窗
    const score = c.yearScore
    if (score >= 16 && !c.team.partner && rand() < 0.6) {
      const better = TEAMS.filter((t) => t.partner)[irand(0, 3)]
      logs.push({ cls: 'career', text: `【转会窗】${better.name} 把你挖走了。合作战队，底薪翻倍。` })
      c.team = better
      unlock(g, 'career_partner')
    } else if (score >= 8) {
      logs.push({ cls: 'career', text: `【转会窗】${c.team.name} 续约一年。` })
    } else {
      logs.push({ cls: 'warn', text: `【转会窗】全年成绩不够，${c.team.name} 没给你续约。` })
      unlock(g, 'career_cut')
      c.phase = 'none'
      c.team = undefined
      if (g.age >= 24 && rand() < 0.5) retire(g, logs, '被裁之后没有队伍再找你。')
    }
    c.yearScore = 0
  }
  // 年龄退役
  if (c.phase === 'signed' && g.age >= RETIRE_AGE) {
    const p = 0.12 * (g.age - RETIRE_AGE + 1)
    if (rand() < p) retire(g, logs, '手速和反应都在告诉你：到时候了。')
  }
}

export function retire(g: GameState, logs: LogLine[], why: string) {
  const c = g.career
  c.phase = 'retired'
  c.team = undefined
  c.retiredYear = g.year
  const r = rand()
  c.afterlife = r < 0.6 ? 'streamer' : r < 0.85 ? 'coach' : 'escort'
  if (c.afterlife === 'streamer') g.stage = 'streamer'
  if (c.afterlife === 'coach') g.stage = 'coach'
  const after = { streamer: '开了直播，靠老粉和退役选手的名号吃饭。', coach: '留在圈子里当教练，带比你小八岁的孩子。', escort: '悄悄接了陪玩单——退役选手的号，老板很喜欢。' }[c.afterlife]
  logs.push({ cls: 'ending', text: `【退役】${why} ${g.age} 岁，${after}` })
  unlock(g, 'career_retired')
}

export function careerLabel(c: Career): string {
  switch (c.phase) {
    case 'none': return '路人'
    case 'scouted': return `被${c.team?.name ?? '战队'}看上 · 待试训`
    case 'trial': return '试训中'
    case 'signed': return `${c.team?.name ?? ''} 选手`
    case 'retired': return `退役选手${c.afterlife === 'streamer' ? ' · 主播' : c.afterlife === 'coach' ? ' · 教练' : ' · 陪玩'}`
    case 'banned': return '终身禁赛'
  }
}

export function teamById(id: string): Team | undefined {
  return TEAMS.find((t) => t.id === id)
}
