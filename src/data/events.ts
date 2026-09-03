import type { GameState, LogLine } from '../types'
import { irand, rand, rankScore } from '../sim/rank'
import { unlock } from '../sim/ach'
import { STAGE_INFO } from './constants'

export interface GameEvent {
  id: string
  weight: number
  when?: (g: GameState) => boolean
  run: (g: GameState) => string
}

const score = (g: GameState) => rankScore(g.rank)
const S = { diamond: 5 * 500, gm: 7 * 500 }

function setStage(g: GameState, stage: GameState['stage']) {
  g.stage = stage
  unlock(g, `stage_${stage}`)
}

function modQuota(g: GameState, d: number) {
  g.quotaModDelta += d
  g.quotaLeft = Math.max(1, g.quotaLeft + Math.round(d / 2))
  g.quotaMax = Math.max(g.quotaLeft, g.quotaMax + Math.round(d / 2))
}

const signed = (g: GameState) => g.career.phase === 'signed'

/* ———————————— 常规（干净）池 ———————————— */
export const CLEAN_EVENTS: GameEvent[] = [
  { id: 'parttime', weight: 10, when: (g) => g.stage === 'student' || g.stage === 'worker',
    run: (g) => { const c = g.stage === 'worker' ? irand(60, 110) : irand(30, 60); g.cash += c; return `${g.stage === 'worker' ? '工资' : '兼职'}到账，现金+${c}。` } },
  { id: 'credit_up', weight: 10, run: (g) => { g.credit += 3; return '净玩一段时间，信誉+3。' } },
  { id: 'persona', weight: 8, run: (g) => `人设发作：【${g.persona.name}】本局存在感爆炸。` },
  { id: 'clip', weight: 6, run: (g) => { const c = g.stage === 'streamer' ? irand(80, 180) : irand(15, 30); g.cash += c; return `直播切片有人打赏。现金+${c}。` } },
  { id: 'friend', weight: 5, run: (g) => { g.credit += 2; return '队友打完加了好友，约了明天再来。信誉+2。' } },
  { id: 'patch', weight: 4, run: () => '版本更新，本命被削。你对着补丁说明沉默了五分钟。' },
  { id: 'duo', weight: 4, run: (g) => { g.winStreak += 1; return '朋友上线双排，下一把状态拉满。' } },
  { id: 'report_thanks', weight: 5, run: () => '系统通知：「感谢您的举报，我们已对该玩家采取处理。」——上周那个挂哥。' },
  { id: 'fish_clean', weight: 3, run: (g) => { g.envPollution += 1; return '对局里有人代练炸鱼。匹配味道更浊，环境污染+1。' } },
  { id: 'forced50', weight: 4, when: (g) => g.winStreak >= 4,
    run: () => '连胜第五把，队友是四个刚定级的。你怀疑匹配系统觉得你该输一把了。' },
  { id: 'smurf', weight: 3, when: (g) => g.conf < 0.4 && g.mmr - score(g) > 600,
    run: () => '对面公屏：「这人绝对小号。」你没回。' },
]

/* ———————————— 竞逐 / 脏环境池 ———————————— */
export const DIRTY_EVENTS: GameEvent[] = [
  { id: 'fish', weight: 10, run: (g) => {
    const d = g.dirtyThisSeason ? 4 : g.envPollution >= 40 ? 0 : 2
    g.envPollution += d
    return d ? `对局里有人代练炸鱼。匹配味道更浊，环境污染+${d}。` : '对局里有人代练炸鱼。这池子已经这样了，你都不惊讶了。'
  } },
  { id: 'afk', weight: 9, run: (g) => { g.credit = Math.max(0, g.credit - 1); return '摆烂队友锁了你最不会的英雄。心态微崩，信誉-1。' } },
  { id: 'hacker', weight: 7, run: () => '对面一命十三，疑似外挂。你想骂——先掂量红框。' },
  { id: 'carried', weight: 5, run: (g) => { g.cash += 15; return '这把被挂哥送了，你还赚了点观看时长打赏。现金+15。' } },
  { id: 'false_report', weight: 5, when: (g) => g.envPollution > 20, run: (g) => { g.reportStacks++; return `脏匹配池里有人恶意举报你。举报+1（累计 ${g.reportStacks}）。` } },
  { id: 'ex_client', weight: 4, when: (g) => g.identity === 'boost', run: (g) => { g.envPollution += 4; return '排到了你上周带过的老板，他还是那么菜。污染+4。' } },
  { id: 'rage_quit', weight: 4, run: (g) => { g.loseStreak += 1; return '队友开局 2 分钟退了，你多输了一把心态。' } },
]

/* ———————————— 生活 / 生涯阶段池（低频，永久） ———————————— */
export const LIFE_EVENTS: GameEvent[] = [
  { id: 'graduate', weight: 3, when: (g) => g.stage === 'student' && g.age >= 22 && !signed(g),
    run: (g) => { setStage(g, 'worker'); return `毕业了，开始上班。以后只能下班打，赛季额度永久 ${STAGE_INFO.worker.quota}。` } },
  { id: 'dropout', weight: 2, when: (g) => g.stage === 'student' && score(g) >= S.diamond && g.age >= 18,
    run: (g) => { setStage(g, 'dropout'); g.cash -= 100; return `你辍学了，全职打天梯。额度永久 +${STAGE_INFO.dropout.quota}，但爸妈断了生活费。现金-100。` } },
  { id: 'free', weight: 2, when: (g) => g.stage !== 'free' && g.cash >= 8000 && !signed(g),
    run: (g) => { setStage(g, 'free'); return `存款过八千，你辞了职——「财富自由」。额度永久 +${STAGE_INFO.free.quota}。` } },
  { id: 'streamer', weight: 2, when: (g) => g.stage !== 'streamer' && g.stage !== 'free' && g.stage !== 'coach' && !signed(g) && (score(g) >= S.gm || g.muteCount >= 2),
    run: (g) => { setStage(g, 'streamer'); return score(g) >= S.gm ? '高分局切片火了，你开了直播。转型主播。' : '你骂人的切片火了，你顺势开播。转型主播（喷子出圈）。' } },
  { id: 'stream_boom', weight: 4, when: (g) => g.stage === 'streamer', run: (g) => { const c = irand(200, 450); g.cash += c; return `直播间爆了一晚，打赏+${c}。` } },
  { id: 'stream_crash', weight: 3, when: (g) => g.stage === 'streamer', run: (g) => { g.credit = Math.max(0, g.credit - 8); g.cash -= 120; return '直播翻车被挂到热榜。信誉-8，掉了一批订阅，现金-120。' } },
  { id: 'parents', weight: 3, when: (g) => g.stage === 'dropout' && !signed(g), run: (g) => { g.cash -= 150; return '房租到期，爸妈不接电话。现金-150。' } },
  { id: 'gf', weight: 3, run: (g) => { modQuota(g, -8); return '谈恋爱了。额度永久 -8。' } },
  { id: 'gf_ow', weight: 2, run: (g) => { modQuota(g, 12); return '对象也玩守望。额度永久 +12。' } },
  { id: 'overtime', weight: 3, when: (g) => g.stage === 'worker', run: (g) => { modQuota(g, -10); g.cash += 200; return '接了个加班项目。现金+200，额度永久 -10。' } },
  { id: 'back', weight: 2, when: (g) => g.age >= 22, run: (g) => { modQuota(g, -12); return '腰突了。医生说少坐。额度永久 -12。' } },
  { id: 'netbar', weight: 2, run: (g) => { modQuota(g, 10); return '搬到网吧楼上。额度永久 +10。' } },
  { id: 'coach_gig', weight: 3, when: (g) => g.stage === 'coach', run: (g) => { const c = irand(150, 300); g.cash += c; return `带的队打完训练赛，教练工资+${c}。` } },
]

/* ———————————— 职业选手池（签约期间） ———————————— */
export const CAREER_EVENTS: GameEvent[] = [
  { id: 'scrim', weight: 8, run: (g) => { g.credit += 2; return '训练赛加练到凌晨。信誉+2。' } },
  { id: 'team_fight', weight: 6, run: (g) => { g.credit = Math.max(0, g.credit - 3); return '队内因为分锅吵了一架。信誉-3。' } },
  { id: 'stream_contract', weight: 4, run: (g) => { g.cash += 400; return '直播平台给了选手合约。现金+400。' } },
  { id: 'fix_offer', weight: 3, run: (g) => { g.credit += 5; return '有人私聊让你打假赛。你截图发给了队长。信誉+5。' } },
  { id: 'coach_praise', weight: 4, run: (g) => { g.winStreak += 1; return '教练复盘时点名夸你。下一把气势拉满。' } },
  { id: 'injury', weight: 2, run: (g) => { g.quotaLeft = Math.max(1, g.quotaLeft - 10); return '手腕腱鞘炎。本赛季额度 -10。' } },
  { id: 'bootcamp', weight: 2, when: (g) => g.career.team?.partner === true, run: () => '二月去首尔集训。韩国队的训练赛让你知道差距在哪。' },
  { id: 'fan', weight: 3, run: (g) => { g.credit += 3; return '路人局有人认出你的 ID，全场没人骂人。信誉+3。' } },
]

/* ———————————— 黑化 / 外挂 / 请帮手池 ———————————— */
export const BLACK_EVENTS: GameEvent[] = [
  { id: 'boss_rush', weight: 8, when: (g) => g.identity === 'boost', run: (g) => { g.cash += 60; g.boostEarned += 60; g.envPollution += 3; return '老板催单，加钱赶进度。现金+60，污染+3。' } },
  { id: 'boss_scam', weight: 4, when: (g) => g.identity === 'boost', run: (g) => { g.cash -= 80; return '老板打完拒付，还威胁举报你。现金-80。' } },
  { id: 'rival_report', weight: 5, when: (g) => g.identity === 'boost' || g.identity === 'cheat', run: (g) => { g.reportStacks += 2; return `被同行/对面组队举报。举报+2（累计 ${g.reportStacks}）。` } },
  { id: 'anticheat', weight: 6, when: (g) => g.identity === 'cheat', run: (g) => { g.reportStacks += 1; return '反作弊更新，外挂作者连夜改版。举报+1。' } },
  { id: 'cheat_fail', weight: 4, when: (g) => g.identity === 'cheat', run: (g) => { g.loseStreak += 1; return '本局外挂失效，你打出了真实水平。' } },
  { id: 'escort_leak', weight: 4, when: (g) => g.helper?.kind === 'escort', run: (g) => { g.credit = Math.max(0, g.credit - 4); return '队友发现你是被带的，公屏挂了你。信誉-4。' } },
  { id: 'booster_chat', weight: 4, when: (g) => g.helper?.kind === 'boost', run: () => '代练发来截图：「老板这把 40 杀，放心。」你在手机上看着自己的号在飞。' },
  { id: 'login_alert', weight: 3, when: (g) => g.helper?.kind === 'boost', run: (g) => { g.reportStacks += 1; return '战网提示：账号在异地登录。举报+1（账号共享被标记）。' } },
]

/** 加权抽取一条事件并执行 */
export function pickEvent(g: GameState, pool: GameEvent[]): LogLine | null {
  const cands = pool.filter((e) => !e.when || e.when(g))
  if (!cands.length) return null
  const weights = cands.map((e) => e.weight)
  let r = rand() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i]
    if (r <= 0) {
      const text = cands[i].run(g)
      return { cls: 'ev', text }
    }
  }
  return null
}
