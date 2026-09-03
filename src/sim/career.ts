import type { Career, DirtyHistory, GameState, LogLine, MetaSave, StageResult, Team } from '../types'
import {
  DEBT_HEAVY, GROWTH_TRAINING_CAP, INTL_MULT, INTL_NAME, INTL_PLACE, INTL_PRIZE, MATE_NAMES, OWN_TEAM_MIN_FANS,
  OWN_TEAM_PRIZE_MULT, OWN_TEAM_SETUP_COST, PRO_UNLOCK_SEASONS, RETIRE_AGE, SALARY, SCOUT_MIN_MATCHES,
  SCOUT_MIN_SCORE, SCOUT_VETERAN_SCORE, STAGE_PRIZE, TEAMS,
} from '../data/constants'
import { clamp, irand, rand, rankScore } from './rank'
import { unlock } from './ach'
import { buildLifetimeBanEnding } from '../data/endings'

export function freshCareer(): Career {
  return { phase: 'none', seasonsSigned: 0, history: [], yearScore: 0, worldCup: 0, disbands: 0 }
}

const MAPS = ['里阿尔托', '努巴尼', '好莱坞', '国王大道', '漓江塔', '伊利奥斯', '尼泊尔', '直布罗陀', '66号公路', '巴黎', '新皇后街', '科洛塞', '伊斯佩兰萨', '多拉多', '花村', '阿努比斯神殿']
const MOMENTS = ['最后一波抢下决胜点', '推车差 0.3 米', '被对面辅助大招翻盘', '你一个大招清了三个', '加时守住了', '教练喊了暂停也没救回来', '对面 C 位手感爆炸', '你的英雄被 ban 了，换手打得别扭']
const OWN_TEAM_NAMES = ['夜航电竞', '白鸟俱乐部', '三十七号', '风暴俱乐部', '不睡觉电竞', '直播间一队']

function map() { return MAPS[irand(0, MAPS.length - 1)] }
function moment() { return MOMENTS[irand(0, MOMENTS.length - 1)] }
function mate() { return MATE_NAMES[irand(0, MATE_NAMES.length - 1)] }

export function addFans(g: GameState, n: number) {
  g.fans = Math.max(0, Math.round(g.fans + n))
}

/* ———————————— 解锁 / 报名 ———————————— */

export function proUnlocked(meta: MetaSave): boolean {
  return meta.reachedGM || meta.seasonsPlayed >= PRO_UNLOCK_SEASONS
}

export function canApply(meta: MetaSave): { ok: boolean; why: string } {
  const c = meta.career
  if (c.phase === 'banned') return { ok: false, why: '终身禁赛。本存档的职业线到此为止，只能删档重来。' }
  if (c.dreamGiven) return { ok: false, why: '你已经选了正业。战队不会再联系一个上班的人。' }
  if (c.phase === 'signed') return { ok: false, why: '你已经在队里了。' }
  if (c.phase === 'scouted') return { ok: false, why: '下赛季开局就是试训。' }
  if (c.phase === 'retired') return { ok: false, why: '退役选手不再报名新人试训。想回来，等主播队。' }
  if (meta.age >= 27) return { ok: false, why: '27 岁。青训教练看了一眼年龄就划走了。' }
  if (!proUnlocked(meta)) return { ok: false, why: `触及宗师，或累计打满 ${PRO_UNLOCK_SEASONS} 个赛季后解锁（现在 ${meta.seasonsPlayed} 季）。` }
  return { ok: true, why: '' }
}

/** 主动报名试训：按上赛季段位挑一支队，下赛季开局打训练赛 */
export function applyTrial(meta: MetaSave): LogLine {
  const chk = canApply(meta)
  if (!chk.ok) return { cls: 'sys', text: chk.why }
  const score = meta.lastRank ? rankScore(meta.lastRank) : 0
  const pool = TEAMS.filter((t) => (score >= 8 * 500 ? true : !t.partner))
  const team = pool[irand(0, pool.length - 1)]
  meta.career.phase = 'scouted'
  meta.career.team = team
  meta.achievements['career_apply'] = true
  return { cls: 'career', text: `你给${team.name}的经理发了战绩截图。回复：「下赛季开局来打三场训练赛。」` }
}

/* ———————————— 黑历史 / 终身禁赛 ———————————— */

export function exposureP(d: DirtyHistory): number {
  return Math.min(0.6, d.boostJobs * 0.05 + d.hires * 0.015 + d.cheatSeasons * 0.12)
}

export function lifetimeBan(g: GameState, logs: LogLine[], reason: string) {
  const c = g.career
  const team = c.team?.name ?? ''
  c.phase = 'banned'
  c.team = undefined
  c.banReason = reason
  g.careerBanned = true
  addFans(g, -Math.round(g.fans * 0.6))
  logs.push({ cls: 'ban', text: `【终身禁赛】赛事官方公告：${reason}${team ? ` ${team} 已与你解约。` : ''}OWCS 及其附属赛事永久禁赛。` })
  unlock(g, 'career_lifetime_ban')
  g.ending = buildLifetimeBanEnding(g, reason)
}

/** 背调 / 赛前审查：黑历史越多越容易被翻出来 */
export function exposureCheck(g: GameState, logs: LogLine[], when: string): boolean {
  const p = exposureP(g.dirty)
  if (p <= 0 || rand() >= p) return false
  const d = g.dirty
  const what = d.cheatSeasons > 0 && rand() < 0.5 ? '该选手账号曾使用第三方程序' : d.boostJobs > 0 && rand() < 0.6 ? '该选手曾长期从事有偿代练' : '该选手账号存在账号共享（代练 / 陪玩）记录'
  lifetimeBan(g, logs, `${when}发现${what}。`)
  return true
}

/* ———————————— 发掘 / 试训 ———————————— */

/** 玩家对队伍战力的贡献：以 MMR 与训练为主；主播队吃人气赞助 */
export function teamStrength(g: GameState): number {
  const t = g.career.team
  if (!t) return 0
  // 钻石 −14 / 大师 −3 / 宗师 +8 / 英杰 +19；训练一年后 +9
  const you = (g.mmr - 3400) / 45 + Math.min(GROWTH_TRAINING_CAP, g.career.seasonsSigned / 2) * 1.5
  const fans = t.own ? Math.min(15, g.fans / 5000) : 0
  return t.rating + you + fans + irand(-6, 6)
}

/** 被发掘：本季 ≥ 宗师（老玩家 ≥ 大师）且已打 ≥ 40 把，每把小概率 */
export function checkScouting(g: GameState, events: LogLine[]) {
  const c = g.career
  if (c.phase !== 'none' || g.careerBanned || c.dreamGiven || g.identity !== 'casual' || g.scoutedThisSeason) return
  if (g.stage === 'coach') return
  if (g.age >= 27) return
  const min = g.season > PRO_UNLOCK_SEASONS ? SCOUT_VETERAN_SCORE : SCOUT_MIN_SCORE
  if (g.matchesThisSeason < SCOUT_MIN_MATCHES || rankScore(g.rank) < min) return
  if (rand() > 0.05) return
  const partnerOk = g.mmr >= 4300
  const pool = TEAMS.filter((t) => partnerOk || !t.partner)
  const team = pool[irand(0, pool.length - 1)]
  c.phase = 'scouted'
  c.team = team
  g.scoutedThisSeason = true
  events.push({ cls: 'career', text: `【私信】「你好，我是${team.name}的经理，看了你最近的对局，下赛季有兴趣来打几场训练赛吗？」` })
  unlock(g, 'career_scouted')
}

/** 试训：赛季开局打 3 场 BO3 训练赛，过了先背调再签 */
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
  if (!pass) {
    g.career.phase = 'none'
    g.career.team = undefined
    logs.push({ cls: 'warn', text: `【试训】${team.name}：「先回去打天梯吧，保持状态。」没签。` })
    return
  }
  if (exposureP(g.dirty) > 0) logs.push({ cls: 'sys', text: '签约前战队做了背调，翻你的账号记录。' })
  if (exposureCheck(g, logs, '签约背调')) return
  g.career.phase = 'signed'
  g.career.seasonsSigned = 0
  g.career.yearScore = 0
  logs.push({ cls: 'career', text: `【签约】${team.name} 给了合同。${team.partner ? '合作战队，底薪体面，Stage 1 免预选。' : '普通队，底薪不高，从公开预选打起。'}` })
  unlock(g, 'career_signed')
  if (team.partner) unlock(g, 'career_partner')
  addFans(g, 2000)
  if (g.stage === 'student' && rand() < 0.6) {
    g.stage = 'dropout'
    logs.push({ cls: 'sys', text: '为了打训练赛，你办了休学。' })
  }
}

/** 每赛季底薪（主播队老板没有底薪，反过来要付） */
export function salary(g: GameState): number {
  const t = g.career.team
  if (!t || g.career.phase !== 'signed' || t.own) return 0
  const [a, b] = t.partner ? SALARY.partner : SALARY.normal
  return irand(a, b)
}

/* ———————————— 正赛 ———————————— */

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

/** 花边：假赛 / 宫斗 / 被挖 / 补强 / 赞助跑路。返回本 Stage 是否被取消资格与临时战力修正 */
function teamDrama(g: GameState, logs: LogLine[], res: StageResult): { skip: boolean; temp: number } {
  const team = g.career.team!
  const r = rand()
  if (r < 0.05) {
    const who = mate()
    res.note = '队友假赛，全队取消资格'
    logs.push({ cls: 'ban', text: `【假赛】队友 ${who} 被查出在预选赛收钱放水。全队本 Stage 取消资格，${team.own ? '你作为老板被罚款 20000，' : ''}人气 −20%。` })
    addFans(g, -Math.round(g.fans * 0.2))
    if (team.own) g.cash -= 20000
    unlock(g, 'fixed_match')
    return { skip: true, temp: 0 }
  }
  if (r < 0.12) {
    res.note = '宫斗'
    logs.push({ cls: 'warn', text: `【宫斗】${mate()} 和 ${mate()} 为首发位置闹到教练组，训练赛打成两派。本 Stage 战力 −6。` })
    return { skip: false, temp: -6 }
  }
  if (r < 0.18) {
    team.rating = Math.max(30, team.rating - 4)
    res.note = '主力被挖'
    logs.push({ cls: 'warn', text: `【转会】主力 ${mate()} 被${TEAMS[irand(0, 3)].name}挖走。队伍底子 −4。` })
    return { skip: false, temp: 0 }
  }
  if (r < 0.24) {
    team.rating = Math.min(95, team.rating + 4)
    res.note = '补强'
    logs.push({ cls: 'career', text: `【转会】${team.own ? '你花人脉' : '战队'}签下了韩援 ${mate()}。队伍底子 +4。` })
    return { skip: false, temp: 0 }
  }
  if (team.own && r < 0.29) {
    g.cash -= 10000
    res.note = '赞助商跑路'
    logs.push({ cls: 'warn', text: '【赞助】赞助商尾款没到，跑了。你自己垫了 10000。' })
    return { skip: false, temp: 0 }
  }
  if (r < 0.33) {
    res.note = '队友直播口嗨禁赛一场'
    logs.push({ cls: 'warn', text: `【禁赛】${mate()} 直播口嗨对手，被官方禁赛一场。本 Stage 战力 −3。` })
    return { skip: false, temp: -3 }
  }
  return { skip: false, temp: 0 }
}

/** OWCS Stage：预选（瑞士轮 8 队）→ 循环赛 6 队 → 双败 4 队 → 国际赛 */
export function runStage(g: GameState, stage: 1 | 2 | 3, logs: LogLine[]) {
  if (g.career.phase !== 'signed' || !g.career.team) return
  const team = g.career.team
  const res: StageResult = { year: g.year, stage, team: team.name, place: 0, intl: 0, prize: 0 }
  logs.push({ cls: 'career', text: `【OWCS 中国赛区 · 第 ${g.year} 年 Stage ${stage}】${team.name}${team.own ? '（你的队）' : ''}` })

  if (exposureCheck(g, logs, '赛前资格审查')) return

  const drama = teamDrama(g, logs, res)
  if (drama.skip) {
    g.career.history.push(res)
    g.career.seasonsSigned++
    return
  }
  const you = teamStrength(g) + drama.temp

  let inRR = true
  if (!(team.partner && stage === 1)) {
    const opps = Array.from({ length: 7 }, () => irand(35, 78))
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
    const opps = Array.from({ length: 5 }, () => irand(45, 86))
    const p = placeAmong(you, opps)
    const s = series(you, opps[irand(0, 4)], 3)
    logs.push({ cls: s.win ? 'win' : 'lose', text: `常规赛循环 · 对阵${TEAMS[irand(0, TEAMS.length - 1)].name} · ${map()} ${s.score}。` })
    unlock(g, 'career_regular')
    if (team.own) unlock(g, 'own_team_owcs')
    if (p <= 4) {
      logs.push({ cls: 'career', text: `循环赛第 ${p}，进入 4 队双败季后赛。` })
      unlock(g, 'career_playoffs')
      const semi = series(you, irand(60, 92), 5)
      logs.push({ cls: semi.win ? 'win' : 'lose', text: `季后赛胜者组 · ${map()} ${semi.score}，${moment()}。` })
      if (semi.win) {
        const final = series(you, irand(68, 95), 5)
        logs.push({ cls: final.win ? 'win' : 'lose', text: `地区决赛 · ${map()} ${final.score}，${moment()}。` })
        res.place = final.win ? 1 : 2
      } else {
        const lower = series(you, irand(55, 88), 5)
        logs.push({ cls: lower.win ? 'win' : 'lose', text: `败者组 · ${map()} ${lower.score}。` })
        if (lower.win) {
          const final = series(you, irand(68, 95), 5)
          logs.push({ cls: final.win ? 'win' : 'lose', text: `败者组决赛 · ${map()} ${final.score}。` })
          res.place = final.win ? 2 : 3
        } else res.place = 4
      }
    } else {
      res.place = p
      logs.push({ cls: 'sys', text: `循环赛第 ${p}，无缘季后赛。` })
    }
  }

  const mult = team.own ? OWN_TEAM_PRIZE_MULT : 1
  res.prize = (STAGE_PRIZE[res.place] ?? 0) * mult
  if (res.place === 1) { unlock(g, 'career_regional_champ'); if (team.own) unlock(g, 'own_team_champ') }
  addFans(g, res.place === 1 ? 15000 : res.place === 2 ? 8000 : res.place <= 4 ? 3000 : 500)
  logs.push({ cls: 'career', text: `Stage ${stage} 地区名次 ${res.place}${res.prize ? `，奖金${team.own ? '（老板分成 ×2）' : '分成'} +${res.prize}` : ''}。` })

  // 地区前 2 出线国际赛
  if (res.place <= 2) {
    const name = INTL_NAME[stage]
    // 国际赛：韩国 / 北美 / 欧洲头部队，整体高一档
    const opps = Array.from({ length: 7 }, () => irand(80, 100))
    const ip = placeAmong(you, opps)
    const s = series(you, opps[0], 5)
    logs.push({ cls: s.win ? 'win' : 'lose', text: `【${name} · ${INTL_PLACE[stage]}】小组赛 · 对阵韩国队 · ${map()} ${s.score}，${moment()}。` })
    res.intl = ip
    const ipz = Math.round((INTL_PRIZE[ip] ?? 0) * INTL_MULT[stage]) * mult
    res.prize += ipz
    logs.push({ cls: ip <= 2 ? 'ending' : 'career', text: `${name} 最终名次 ${ip}${ipz ? `，奖金 +${ipz}` : ''}。` })
    unlock(g, 'career_intl')
    addFans(g, ip === 1 ? 100000 : ip <= 4 ? 30000 : 10000)
    if (ip === 1) unlock(g, 'career_world_champ')
  }

  g.cash += res.prize
  g.proIncome += res.prize
  g.career.history.push(res)
  g.career.yearScore += Math.max(0, 9 - res.place) + (res.intl ? Math.max(0, 9 - res.intl) : 0)
  g.career.seasonsSigned++
}

/* ———————————— 年末 ———————————— */

export function yearEnd(g: GameState, logs: LogLine[]) {
  const c = g.career
  if (c.phase === 'signed' && c.team) {
    if (c.yearScore >= 14 && rand() < 0.3) {
      c.worldCup++
      addFans(g, 30000)
      logs.push({ cls: 'ending', text: '【世界杯】国家队名单公布，有你。9 月去暴雪嘉年华。' })
      unlock(g, 'career_worldcup')
    }
    const score = c.yearScore
    if (c.team.own) {
      // 主播队：老板不会被裁，但会破产 / 解散
      if (g.cash < DEBT_HEAVY * 3) disbandOwn(g, logs, '账上负债太深，队友底薪发不出。')
      else if (score < 4 && rand() < 0.5) disbandOwn(g, logs, '一年打不进正赛，队友各奔东西。')
      else {
        c.team.rating = clamp(c.team.rating + irand(-3, 3), 30, 95)
        logs.push({ cls: 'career', text: `【年末】${c.team.name} 续一年。队友底薪照付，${score >= 12 ? '有赞助商主动找上门。' : '赞助还得自己去跑。'}` })
      }
    } else if (rand() < 0.06) {
      logs.push({ cls: 'warn', text: `【解散】${c.team.name} 老板撤资，战队解散。` })
      unlock(g, 'career_disband')
      c.team = undefined
      c.phase = 'none'
      if (rand() < 0.5) {
        const next = TEAMS.filter((t) => !t.partner)[irand(0, 4)]
        c.phase = 'signed'
        c.team = next
        logs.push({ cls: 'career', text: `${next.name} 第二天就把你接走了。` })
      }
    } else if (score >= 16 && !c.team.partner && rand() < 0.6) {
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
      if (g.cash < 0 || (g.age >= 24 && rand() < 0.5)) retire(g, logs, g.cash < 0 ? '被裁，还背着债。家里说：回来吧。' : '被裁之后没有队伍再找你。')
    }
    c.yearScore = 0
  }
  // 负债压力：签约选手（非老板）年末更可能被家里劝退
  if (c.phase === 'signed' && !c.team?.own && g.cash < DEBT_HEAVY && rand() < 0.35) {
    retire(g, logs, `负债 ${-g.cash}，底薪填不上窟窿。`)
  }
  // 年龄退役
  if (c.phase === 'signed' && !c.team?.own && g.age >= RETIRE_AGE) {
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

function disbandOwn(g: GameState, logs: LogLine[], why: string) {
  const c = g.career
  const name = c.team?.name ?? '主播队'
  c.phase = 'none'
  c.team = undefined
  c.disbands = (c.disbands ?? 0) + 1
  logs.push({ cls: 'warn', text: `【解散】${why} ${name} 解散。你还是主播，队没了。` })
  unlock(g, 'own_team_disband')
}

/* ———————————— 主播队 ———————————— */

export function canFormTeam(meta: MetaSave): { ok: boolean; why: string } {
  const c = meta.career
  if (c.phase === 'banned') return { ok: false, why: '终身禁赛的人不能持有参赛队。' }
  if (c.phase === 'signed' || c.phase === 'scouted') return { ok: false, why: '你还在别人的队里。' }
  if (meta.fans < OWN_TEAM_MIN_FANS) return { ok: false, why: `人气不足：组队需要 ${OWN_TEAM_MIN_FANS.toLocaleString()} 人气，现在 ${meta.fans.toLocaleString()}。` }
  if (meta.cash < OWN_TEAM_SETUP_COST / 2) return { ok: false, why: `现金不足：注册 + 首期底薪 ${OWN_TEAM_SETUP_COST}，至少要有一半。` }
  return { ok: true, why: '' }
}

export function formOwnTeam(meta: MetaSave): LogLine {
  const chk = canFormTeam(meta)
  if (!chk.ok) return { cls: 'sys', text: chk.why }
  const name = OWN_TEAM_NAMES[irand(0, OWN_TEAM_NAMES.length - 1)]
  const team: Team = { id: 'own', name, partner: false, rating: 45 + Math.min(20, Math.floor(meta.fans / 10000)), own: true }
  meta.cash -= OWN_TEAM_SETUP_COST
  meta.career.phase = 'signed'
  meta.career.team = team
  meta.career.seasonsSigned = 0
  meta.career.yearScore = 0
  meta.career.dreamGiven = false
  meta.achievements['own_team'] = true
  return { cls: 'career', text: `【组队】${name} 注册成功。现金 −${OWN_TEAM_SETUP_COST}。你是老板兼首发，队友底薪每季 15000 由你付，奖金你拿双份。从公开预选打起。` }
}

/** 负债三条路之一：找份正业，放弃职业梦 */
export function giveUpDream(meta: MetaSave): LogLine {
  meta.career.dreamGiven = true
  if (meta.career.phase === 'scouted') { meta.career.phase = 'none'; meta.career.team = undefined }
  if (meta.stage !== 'streamer' && meta.stage !== 'coach') meta.stage = 'worker'
  meta.achievements['dream_given'] = true
  return { cls: 'sys', text: `你投了简历。${meta.stage === 'worker' ? '下个月开始上班，' : ''}以后战队不会再联系你。天梯还能打，只是下班以后。` }
}

export function careerLabel(c: Career): string {
  switch (c.phase) {
    case 'none': return c.dreamGiven ? '路人 · 已放弃职业' : '路人'
    case 'scouted': return `被${c.team?.name ?? '战队'}看上 · 待试训`
    case 'trial': return '试训中'
    case 'signed': return c.team?.own ? `${c.team.name} · 老板兼选手` : `${c.team?.name ?? ''} 选手`
    case 'retired': return `退役选手${c.afterlife === 'streamer' ? ' · 主播' : c.afterlife === 'coach' ? ' · 教练' : ' · 陪玩'}`
    case 'banned': return '终身禁赛'
  }
}

export function teamById(id: string): Team | undefined {
  return TEAMS.find((t) => t.id === id)
}
