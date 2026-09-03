import type { GameState, LogLine } from '../types'
import { irand, rand, rankScore } from '../sim/rank'
import { unlock } from '../sim/ach'
import { FREE_CASH, STAGE_INFO } from './constants'
import { addFans } from '../sim/career'

export interface GameEvent {
  id: string
  weight: number
  when?: (g: GameState) => boolean
  run: (g: GameState) => string
}

const score = (g: GameState) => rankScore(g.rank)
const S = { diamond: 5 * 500, master: 6 * 500, gm: 7 * 500 }

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
const fmt = (n: number) => n.toLocaleString()

/* ———————————— 常规（干净）池 ———————————— */
export const CLEAN_EVENTS: GameEvent[] = [
  { id: 'parttime', weight: 8, when: (g) => g.stage === 'student' || g.stage === 'worker',
    run: (g) => { const c = g.stage === 'worker' ? irand(800, 1500) : irand(200, 500); g.cash += c; return `${g.stage === 'worker' ? '项目奖金' : '兼职'}到账，现金 +${c}。` } },
  { id: 'credit_up', weight: 10, run: (g) => { g.credit += 3; return '净玩一段时间，信誉 +3。' } },
  { id: 'persona', weight: 8, run: (g) => `人设发作：【${g.persona.name}】本局存在感爆炸。` },
  { id: 'clip', weight: 6, run: (g) => { const c = Math.round(30 + g.fans * 0.005) + irand(0, 60); g.cash += c; addFans(g, irand(5, 40)); return `直播切片有人打赏。现金 +${c}，人气 +。` } },
  { id: 'friend', weight: 5, run: (g) => { g.credit += 2; return '队友打完加了好友，约了明天再来。信誉 +2。' } },
  { id: 'patch', weight: 4, run: () => '版本更新，本命被削。你对着补丁说明沉默了五分钟。' },
  { id: 'duo', weight: 4, run: (g) => { g.winStreak += 1; return '朋友上线双排，下一把状态拉满。' } },
  { id: 'report_thanks', weight: 5, run: () => '系统通知：「感谢您的举报，我们已对该玩家采取处理。」——上周那个挂哥。' },
  { id: 'fish_clean', weight: 3, run: (g) => { g.envPollution += 1; return '对局里有人代练炸鱼。匹配味道更浊，环境污染 +1。' } },
  { id: 'forced50', weight: 4, when: (g) => g.winStreak >= 4,
    run: () => '连胜第五把，队友是四个刚定级的。你怀疑匹配系统觉得你该输一把了。' },
  { id: 'smurf', weight: 3, when: (g) => g.conf < 0.4 && g.mmr - score(g) > 600,
    run: () => '对面公屏：「这人绝对小号。」你没回。' },
  // —— 正经赚钱（段位 / 人气越高越值钱，不脏环境）——
  { id: 'coaching', weight: 4, when: (g) => score(g) >= S.diamond,
    run: (g) => { const c = score(g) >= S.gm ? irand(600, 1200) : irand(200, 500); g.cash += c; return `有人找你 1v1 教学，一小时。现金 +${c}。教人打和替人打是两回事。` } },
  { id: 'netbar_cup', weight: 3, when: (g) => score(g) >= S.diamond,
    run: (g) => { const w = rand() < 0.4; const c = w ? irand(1500, 4000) : irand(200, 500); g.cash += c; addFans(g, w ? 300 : 50); return w ? `网吧赛夺冠，奖金 +${c}，人气 +。` : `网吧赛止步四强，车马费 +${c}。` } },
  { id: 'college_cup', weight: 2, when: (g) => g.stage === 'student' && score(g) >= S.diamond,
    run: (g) => { const c = irand(1000, 3000); g.cash += c; addFans(g, 200); return `高校联赛拿了名次，奖金 +${c}，学校论坛有人认识你了。` } },
  { id: 'creator', weight: 2, when: (g) => g.fans >= 5000,
    run: (g) => { const c = Math.round(g.fans * 0.03); g.cash += c; return `官方创作者激励到账 +${fmt(c)}。` } },
  { id: 'sponsor_small', weight: 1, when: (g) => g.fans >= 30000,
    run: (g) => { const c = irand(1500, 4000); g.cash += c; return `外设品牌找你挂链接，一个赛季 +${fmt(c)}。` } },
  { id: 'guide_video', weight: 3, when: (g) => score(g) >= S.master,
    run: (g) => { const c = irand(300, 900); g.cash += c; addFans(g, irand(100, 500)); return `你剪的英雄教学视频小爆，平台分成 +${c}，人气 +。` } },
]

/* ———————————— 竞逐 / 脏环境池 ———————————— */
export const DIRTY_EVENTS: GameEvent[] = [
  { id: 'fish', weight: 10, run: (g) => {
    const d = g.dirtyThisSeason ? 4 : g.envPollution >= 40 ? 0 : 2
    g.envPollution += d
    return d ? `对局里有人代练炸鱼。匹配味道更浊，环境污染 +${d}。` : '对局里有人代练炸鱼。这池子已经这样了，你都不惊讶了。'
  } },
  { id: 'afk', weight: 9, run: (g) => { g.credit = Math.max(0, g.credit - 1); return '摆烂队友锁了你最不会的英雄。心态微崩，信誉 −1。' } },
  { id: 'hacker', weight: 7, run: () => '对面一命十三，疑似外挂。你想骂——先掂量红框。' },
  { id: 'carried', weight: 5, run: (g) => { g.cash += 50; return '这把被挂哥送了，你还赚了点观看时长打赏。现金 +50。' } },
  { id: 'false_report', weight: 5, when: (g) => g.envPollution > 20, run: (g) => { g.reportStacks++; return `脏匹配池里有人恶意举报你。举报 +1（累计 ${g.reportStacks}）。` } },
  { id: 'ex_client', weight: 4, when: (g) => g.identity === 'boost', run: (g) => { g.envPollution += 4; return '排到了你上周带过的老板，他还是那么菜。污染 +4。' } },
  { id: 'rage_quit', weight: 4, run: (g) => { g.loseStreak += 1; return '队友开局 2 分钟退了，你多输了一把心态。' } },
]

/* ———————————— 生活 / 生涯阶段池（低频，永久） ———————————— */
export const LIFE_EVENTS: GameEvent[] = [
  { id: 'graduate', weight: 3, when: (g) => g.stage === 'student' && g.age >= 22 && !signed(g),
    run: (g) => { setStage(g, 'worker'); return `毕业了，开始上班。以后只能下班打，赛季额度永久 ${STAGE_INFO.worker.quota}，但每季有工资。` } },
  { id: 'dropout', weight: 2, when: (g) => g.stage === 'student' && score(g) >= S.diamond && g.age >= 18,
    run: (g) => { setStage(g, 'dropout'); g.cash -= 1000; return `你辍学了，全职打天梯。额度永久 +${STAGE_INFO.dropout.quota}，但爸妈断了生活费，房租自己付。现金 −1000。` } },
  { id: 'free', weight: 2, when: (g) => g.stage !== 'free' && g.cash >= FREE_CASH && !signed(g),
    run: (g) => { setStage(g, 'free'); return `存款过三十万，你辞了职——「财富自由」。额度永久 +${STAGE_INFO.free.quota}。` } },
  { id: 'streamer', weight: 2, when: (g) => g.stage !== 'streamer' && g.stage !== 'free' && g.stage !== 'coach' && !signed(g) && (score(g) >= S.gm || (g.muteCount >= 2 && g.fans >= 2000) || g.fans >= 8000),
    run: (g) => { setStage(g, 'streamer'); addFans(g, 1000); return score(g) >= S.gm ? '高分局切片火了，你开了直播。转型主播。' : g.fans >= 8000 ? '粉丝催了半年，你终于开播。转型主播。' : '你骂人的切片火了，你顺势开播。转型主播（喷子出圈）。' } },
  { id: 'stream_boom', weight: 4, when: (g) => g.stage === 'streamer', run: (g) => { const c = Math.round(500 + g.fans * 0.03) + irand(0, 800); g.cash += c; addFans(g, irand(200, 1000)); return `直播间爆了一晚，打赏 +${fmt(c)}，人气 +。` } },
  { id: 'stream_crash', weight: 3, when: (g) => g.stage === 'streamer', run: (g) => { g.credit = Math.max(0, g.credit - 8); addFans(g, -Math.round(g.fans * 0.08)); return '直播翻车被挂到热榜。信誉 −8，掉了一批订阅，人气 −8%。' } },
  { id: 'parents', weight: 3, when: (g) => g.stage === 'dropout' && !signed(g), run: (g) => { g.cash -= 1500; return '房租到期，爸妈不接电话。现金 −1500。' } },
  { id: 'debt_call', weight: 4, when: (g) => g.cash < 0, run: (g) => { g.credit = Math.max(0, g.credit - 2); return `催收电话打到家里。负债 ${fmt(-g.cash)}，信誉 −2。` } },
  { id: 'gf', weight: 3, run: (g) => { modQuota(g, -8); return '谈恋爱了。额度永久 −8。' } },
  { id: 'gf_ow', weight: 2, run: (g) => { modQuota(g, 12); return '对象也玩守望。额度永久 +12。' } },
  { id: 'overtime', weight: 3, when: (g) => g.stage === 'worker', run: (g) => { modQuota(g, -10); g.cash += 3000; return '接了个加班项目。现金 +3000，额度永久 −10。' } },
  { id: 'back', weight: 2, when: (g) => g.age >= 22, run: (g) => { modQuota(g, -12); g.cash -= 800; return '腰突了。医生说少坐。额度永久 −12，医药费 −800。' } },
  { id: 'netbar', weight: 2, run: (g) => { modQuota(g, 10); return '搬到网吧楼上。额度永久 +10。' } },
  { id: 'coach_gig', weight: 3, when: (g) => g.stage === 'coach', run: (g) => { const c = irand(1500, 3000); g.cash += c; return `带的队打完训练赛，教练奖金 +${c}。` } },
]

/* ———————————— 职业选手池（签约期间） ———————————— */
export const CAREER_EVENTS: GameEvent[] = [
  { id: 'scrim', weight: 8, run: (g) => { g.credit += 2; return '训练赛加练到凌晨。信誉 +2。' } },
  { id: 'team_fight', weight: 6, run: (g) => { g.credit = Math.max(0, g.credit - 3); return '队内因为分锅吵了一架。信誉 −3。' } },
  { id: 'stream_contract', weight: 1, run: (g) => { const c = irand(1500, 4000); g.cash += c; g.proIncome += c; return `直播平台的选手合约分成到账，现金 +${fmt(c)}。` } },
  { id: 'fix_offer', weight: 3, run: (g) => { g.credit += 5; return '有人私聊让你打假赛，开价六位数。你截图发给了队长。信誉 +5。' } },
  { id: 'coach_praise', weight: 4, run: (g) => { g.winStreak += 1; return '教练复盘时点名夸你。下一把气势拉满。' } },
  { id: 'injury', weight: 2, run: (g) => { g.quotaLeft = Math.max(1, g.quotaLeft - 10); return '手腕腱鞘炎。本赛季额度 −10。' } },
  { id: 'bootcamp', weight: 2, when: (g) => g.career.team?.partner === true, run: () => '二月去首尔集训。韩国队的训练赛让你知道差距在哪。' },
  { id: 'fan', weight: 3, run: (g) => { g.credit += 3; addFans(g, irand(300, 1000)); return '路人局有人认出你的 ID，全场没人骂人。信誉 +3，人气 +。' } },
  { id: 'owner_sponsor', weight: 4, when: (g) => g.career.team?.own === true, run: (g) => { const c = irand(5000, 15000); g.cash += c; g.proIncome += c; return `你跑来的赞助到账 +${fmt(c)}。老板的活。` } },
  { id: 'owner_mate_quit', weight: 3, when: (g) => g.career.team?.own === true, run: (g) => { g.cash -= 5000; return '队友说家里不同意，退队了。违约金没收到，你还倒贴了 5000 找替补。' } },
  { id: 'owner_fan_war', weight: 3, when: (g) => g.career.team?.own === true, run: (g) => { addFans(g, -Math.round(g.fans * 0.05)); return '你的粉丝和队友的粉丝在评论区打起来了。人气 −5%。' } },
]

/* ———————————— 黑化 / 外挂 / 请帮手池 ———————————— */
export const BLACK_EVENTS: GameEvent[] = [
  { id: 'boss_rush', weight: 8, when: (g) => g.identity === 'boost', run: (g) => { g.cash += 300; g.boostEarned += 300; g.envPollution += 3; return '老板催单，加钱赶进度。现金 +300，污染 +3。' } },
  { id: 'boss_scam', weight: 4, when: (g) => g.identity === 'boost', run: (g) => { g.cash -= 400; return '老板打完拒付，还威胁举报你。现金 −400。' } },
  { id: 'rival_report', weight: 5, when: (g) => g.identity === 'boost' || g.identity === 'cheat', run: (g) => { g.reportStacks += 2; return `被同行/对面组队举报。举报 +2（累计 ${g.reportStacks}）。` } },
  { id: 'anticheat', weight: 6, when: (g) => g.identity === 'cheat', run: (g) => { g.reportStacks += 1; return '反作弊更新，外挂作者连夜改版。举报 +1。' } },
  { id: 'cheat_fail', weight: 4, when: (g) => g.identity === 'cheat', run: (g) => { g.loseStreak += 1; return '本局外挂失效，你打出了真实水平。' } },
  { id: 'escort_leak', weight: 4, when: (g) => g.helper?.kind === 'escort', run: (g) => { g.credit = Math.max(0, g.credit - 4); return '队友发现你是被带的，公屏挂了你。信誉 −4。' } },
  { id: 'booster_chat', weight: 4, when: (g) => g.helper?.kind === 'boost', run: () => '代练发来截图：「老板这把 40 杀，放心。」你在手机上看着自己的号在飞。' },
  { id: 'login_alert', weight: 3, when: (g) => g.helper?.kind === 'boost', run: (g) => { g.reportStacks += 1; return '战网提示：账号在异地登录。举报 +1（账号共享被标记）。' } },
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
