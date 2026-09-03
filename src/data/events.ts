/**
 * 季级事件：一季结算后抽 0–2 条。只改单局曲线（实力 / 热情 / 段位显示 / 现金 / 人气 / 黑历史），
 * 全局影响只通过成就（→ 英雄池 → 天赋分布）。
 */
import type { LifeState, LogLine } from '../types'
import { irand, rand, rankScore } from '../sim/rank'
import { unlock } from '../sim/ach'
import { COACH_COST, COACH_MOMENTUM, FREE_CASH, SWITCH_POOL_DROP, SWITCH_POOL_SEASONS } from './constants'

export interface LifeEvent {
  id: string
  weight: number | ((g: LifeState) => number)
  when?: (g: LifeState) => boolean
  /** 返回文案；hl 为 true 时进高光 */
  run: (g: LifeState) => string
  hl?: boolean
  cls?: string
}

const sr = (g: LifeState) => rankScore(g.rank)
const S = { plat: 3 * 500, diamond: 5 * 500, master: 6 * 500, gm: 7 * 500 }
const fmt = (n: number) => n.toLocaleString()
const m = (g: LifeState) => g.persona.metrics

export function addFans(g: LifeState, n: number) {
  g.fans = Math.max(0, Math.round(g.fans + n))
}
function passion(g: LifeState, d: number) {
  g.passion = Math.max(0, g.passion + d)
  if (d > 0) g.passionMax = Math.max(g.passionMax, g.passion)
}
const pd = (d: number) => (d >= 0 ? `热情 +${d}` : `热情 −${-d}`)

/* ———————————— 常规池 ———————————— */
export const COMMON_EVENTS: LifeEvent[] = [
  { id: 'persona', weight: 5, run: (g) => `人设发作：【${g.persona.name}】——${g.persona.tagline}。` },
  { id: 'mute', weight: (g) => 2 + m(g).rage / 20, run: (g) => {
    g.muteCount++
    passion(g, -30)
    if (g.muteCount >= 3) unlock(g, 'muted3')
    return `你喷了疑似挂哥，对方没事，你被红框禁言一周。${pd(-30)}。`
  } },
  { id: 'patch_nerf', weight: 4, run: (g) => { passion(g, -60); g.mmr -= 30; return `版本更新，本命被削。你对着补丁说明沉默了五分钟。${pd(-60)}。` } },
  { id: 'patch_buff', weight: 3, run: (g) => { g.mmr += 50; passion(g, 20); return `版本更新，本命加强。这季手感异常顺。${pd(20)}。` } },
  { id: 'crew', weight: 3, when: (g) => g.crewSeasons <= 0, run: (g) => { g.crewSeasons = 3; return '加了个车队，每晚五排。接下来三季有人带节奏。' } },
  { id: 'crew_off', weight: 4, when: (g) => g.crewSeasons > 0, run: (g) => { g.crewSeasons = 0; passion(g, -50); return `车队散了，群里最后一条消息是「我先退了」。${pd(-50)}。` } },
  { id: 'holiday', weight: 4, when: (g) => g.stage === 'student' || g.stage === 'worker', run: (g) => { passion(g, 100); return `放假了。${pd(100)}。` } },
  { id: 'netbar', weight: 2, run: (g) => { passion(g, 80); return `搬到网吧楼上。${pd(80)}。` } },
  { id: 'gf', weight: 3, run: (g) => { passion(g, -80); return `谈恋爱了。${pd(-80)}。` } },
  { id: 'gf_ow', weight: 2, run: (g) => { passion(g, 60); return `对象也玩守望。${pd(60)}。` } },
  { id: 'breakup', weight: 2, run: (g) => { g.mmr += 40; passion(g, -40); return `分手了。这季疯狂上分，打完更空。${pd(-40)}。` } },
  { id: 'back', weight: 2, when: (g) => g.age >= 22, run: (g) => { passion(g, -100); g.cash -= 800; return `腰突了。医生说少坐。${pd(-100)}，医药费 −800。` } },
  { id: 'forced50', weight: 4, run: () => '连胜第五把，队友是四个刚定级的。你怀疑匹配系统觉得你该输一把了。' },
  { id: 'smurf', weight: 3, when: (g) => g.mmr - sr(g) > 600, run: () => '对面公屏：「这人绝对小号。」你没回。' },
  { id: 'delusion', weight: (g) => m(g).delusion / 30, run: () => '你觉得自己该是宗师。系统不同意。' },
  { id: 'rot', weight: (g) => m(g).rot / 30, run: () => '你蹲了一整局角落，队友以为你掉线了。' },
  { id: 'trash', weight: (g) => m(g).trash / 30, run: () => '被队友举报「消极比赛」。系统提示：已受理。' },
  { id: 'brainless', weight: (g) => m(g).brainless / 35, run: (g) => { g.mmr -= 20; return '你在对面重生点门口站了一波。' } },
  // —— 卡墙时的自救（原抉择改成自动事件，一辈子各一次）——
  { id: 'switch_pool', weight: 5, when: (g) => g.stuckSeasons >= 1 && !g.tally.switch_pool, hl: true, run: (g) => {
    g.mmr -= SWITCH_POOL_DROP
    g.spurtSeasons = SWITCH_POOL_SEASONS
    g.stuckSeasons = 0
    g.momentum = 0
    unlock(g, 'switch_pool')
    return `卡得太久，你把本命锁进英雄池最底下开始练新东西。前两周被喷得很惨，之后 ${SWITCH_POOL_SEASONS} 季涨得飞快。`
  } },
  { id: 'coached', weight: 4, when: (g) => g.stuckSeasons >= 1 && g.cash >= COACH_COST && !g.tally.coached, hl: true, run: (g) => {
    g.cash -= COACH_COST
    g.momentum += COACH_MOMENTUM
    unlock(g, 'coached')
    return `你花 ${fmt(COACH_COST)} 找了个退役选手复盘。他说：「你每一波都在同一个位置死。」下季突破概率高了一截。`
  } },
  { id: 'streak_win', weight: 3, run: (g) => { passion(g, 40); g.mmr += 15; unlock(g, 'streak10'); return `十连胜。你截了图发朋友圈，没人点赞。${pd(40)}。` } },
  { id: 'streak_lose', weight: 3, run: (g) => { passion(g, -45); return `十连跪。你把鼠标扣在桌上，垫子裂了。${pd(-45)}。` } },
  { id: 'afk_mate', weight: 3, run: (g) => { passion(g, -20); return `决胜图队友挂机。你一个人守了两分钟。${pd(-20)}。` } },
  { id: 'new_hero', weight: 2, run: (g) => { g.mmr += 25; passion(g, 30); return `新英雄出了，你第一天就把它练成本命。${pd(30)}。` } },
  { id: 'old_clip', weight: 2, when: (g) => g.season >= 8, run: (g) => { passion(g, 25); return `翻到三年前自己的录像。那时候打得真烂，也真开心。${pd(25)}。` } },
  { id: 'friend_quit', weight: 2, when: (g) => g.season >= 6, run: (g) => { passion(g, -50); return `一起打了几年的朋友退坑了，说「有空再约」。你们没再约过。${pd(-50)}。` } },
  { id: 'server_down', weight: 2, run: (g) => { passion(g, -10); return `国服维护。你打了一晚上亚服，200 ping。${pd(-10)}。` } },
  { id: 'anniversary', weight: 2, run: (g) => { passion(g, 30); return `周年庆。登录送了个皮肤，你居然有点感动。${pd(30)}。` } },
  { id: 'mouse_break', weight: 2, run: (g) => { g.cash -= 400; return `鼠标微动双击了。换了个新的，−400。` } },
  { id: 'fake_scout', weight: 2, when: (g) => sr(g) >= S.diamond, run: (g) => { g.cash -= 300; return `私信「职业青训选拔」，聊了三天发现是卖课的。−300。` } },
  { id: 'stream_start', weight: 3, when: (g) => g.fans >= 2000 && g.fans < 20000, run: (g) => { const n = irand(200, 800); addFans(g, n); return `你开播了。第一晚 ${irand(8, 30)} 个人，其中三个是你亲戚。人气 +${n}。` } },
  { id: 'stream_raid', weight: 2, when: (g) => g.fans >= 20000, run: (g) => { const n = irand(3000, 9000); addFans(g, n); g.cash += irand(1000, 4000); return `大主播连麦排到你，蹭了一晚上流量。人气 +${n}。` } },
  { id: 'lan', weight: 2, when: (g) => sr(g) >= S.master, run: (g) => { const c = irand(2000, 6000); g.cash += c; addFans(g, 500); passion(g, 40); return `线下城市赛。坐在舞台上打的第一把，手一直在抖。奖金 +${c}，${pd(40)}。` } },
  { id: 'college_team', weight: 2, when: (g) => g.stage === 'student' && g.age >= 18 && sr(g) >= S.diamond, hl: true, run: (g) => { passion(g, 80); addFans(g, 300); unlock(g, 'college_team'); return `进了校队。第一次有人叫你「队长」。${pd(80)}。` } },
  { id: 'wedding', weight: (g) => (g.age >= 26 ? 2 : 0), when: (g) => !g.tally.wedding, hl: true, run: (g) => { passion(g, -150); g.cash -= 20000; unlock(g, 'married'); return `你结婚了。婚礼当天队友在群里问「今晚打不打」。${pd(-150)}，现金 −20000。` } },
  { id: 'kid', weight: (g) => (g.tally.wedding ? 3 : 0), when: (g) => !g.tally.kid, hl: true, run: (g) => { passion(g, -200); return `孩子出生了。你把游戏时间改到了凌晨一点以后。${pd(-200)}。` } },
  { id: 'promotion', weight: 2, when: (g) => g.stage === 'worker', run: (g) => { g.cash += 5000; passion(g, -60); return `升职了。钱多了，时间没了。现金 +5000，${pd(-60)}。` } },
  { id: 'layoff', weight: 1, when: (g) => g.stage === 'worker' && g.age >= 25, hl: true, run: (g) => { g.cash -= 3000; passion(g, 120); return `被裁了。赔了 N+1，你决定先打两个月再说。${pd(120)}。` } },
  // —— 正经赚钱 / 人气（段位越高越值钱）——
  { id: 'clip', weight: 3, when: (g) => sr(g) >= S.diamond, run: (g) => { const n = irand(800, 2500); addFans(g, n); return `高分局切片火了，评论区全是「开播吧」。人气 +${n}。` } },
  { id: 'coaching', weight: 3, when: (g) => sr(g) >= S.diamond, run: (g) => { const c = sr(g) >= S.gm ? irand(600, 1200) : irand(200, 500); g.cash += c; return `有人找你 1v1 教学。现金 +${c}。教人打和替人打是两回事。` } },
  { id: 'netbar_cup', weight: 2, when: (g) => sr(g) >= S.diamond, run: (g) => { const w = rand() < 0.4; const c = w ? irand(1500, 4000) : irand(200, 500); g.cash += c; addFans(g, w ? 300 : 50); passion(g, w ? 40 : 0); return w ? `网吧赛夺冠，奖金 +${c}。${pd(40)}。` : `网吧赛止步四强，车马费 +${c}。` } },
  { id: 'creator', weight: 2, when: (g) => g.fans >= 5000, run: (g) => { const c = Math.round(g.fans * 0.03); g.cash += c; return `官方创作者激励到账 +${fmt(c)}。` } },
]

/* ———————————— 脏池：污染越高越常见 ———————————— */
export const DIRTY_EVENTS: LifeEvent[] = [
  { id: 'fish', weight: 6, run: (g) => { g.pollution += 3; return '这局对面有个代练炸鱼，你们被打成 0-3。' } },
  { id: 'pwdl_ad', weight: 4, when: (g) => g.stuckSeasons >= 1, run: () => '有人私信你：「哥，卡段了吧？钻石代练 12 一把。」你没回。' },
  { id: 'escort_taste', weight: 2, when: (g) => g.fakeBoost <= 0 && sr(g) >= S.plat, hl: true, run: (g) => {
    g.fakeBoost += 250
    unlock(g, 'escort_taste')
    return '朋友请你体验了一次 4 陪 1。五排四个宗师带你，这季段位飞了，实力一点没动。'
  } },
  { id: 'met_388', weight: 2, when: (g) => sr(g) >= S.diamond, hl: true, run: (g) => {
    g.fakeBoost -= 150
    unlock(g, 'met_388')
    return '对面五排带老板，那个 388 一小时的 OWL 级陪玩一枪一个。这季分掉了一截。'
  } },
  { id: 'hacker', weight: 3, run: () => '对面一命十三，疑似外挂。你打了两行字，删了，怕红框。' },
  { id: 'false_report', weight: 2, when: (g) => g.pollution > 20, run: () => '一局没说话，赛后收到「举报已受理」。有人在乱举报。' },
  { id: 'sold_alt', weight: 2, when: (g) => g.stage === 'fulltime' && g.cash < 0, run: (g) => { g.cash += 1500; g.pollution += 5; return '把一个小号卖了。买家问「能上分吗」，你说能。现金 +1500。' } },
  { id: 'streamer_boost', weight: 2, when: (g) => sr(g) >= S.diamond, run: () => '排到一个开播的主播，他带着两个代练。你打完看了眼弹幕，全在夸他。' },
]

/* ———————————— 生活池：低频，改阶段 ———————————— */
export const LIFE_EVENTS: LifeEvent[] = [
  { id: 'dropout', weight: 2, when: (g) => g.stage === 'student' && g.age >= 18 && g.age <= 20 && g.mmr >= S.diamond, hl: true,
    run: (g) => { g.stage = 'fulltime'; g.cash -= 1000; unlock(g, 'stage_fulltime'); return '你辍学了，全职打天梯。爸妈断了生活费，房租自己付。' } },
  { id: 'rent', weight: 5, when: (g) => g.stage === 'fulltime' && !g.rich, run: (g) => { g.cash -= 1500; return `房租到期。现金 −1500（${fmt(g.cash)}）。` } },
  { id: 'boost_rent', weight: 4, when: (g) => g.stage === 'fulltime' && g.cash < 0, hl: true, run: (g) => {
    const c = irand(900, 1500)
    g.cash += c
    g.boostEarned += c
    g.dirty.boostJobs++
    g.pollution += 8
    unlock(g, 'first_boost')
    return `为了房租接了两单炸鱼。现金 +${c}。这两单会留在账号记录里。`
  } },
  { id: 'parents', weight: 3, when: (g) => g.stage === 'fulltime' && !g.rich, run: (g) => { passion(g, -30); return `你妈打电话问什么时候找工作。${pd(-30)}。` } },
  { id: 'parttime', weight: 3, when: (g) => g.stage === 'student', run: (g) => { const c = irand(200, 500); g.cash += c; return `兼职到账 +${c}。` } },
  { id: 'bonus', weight: 3, when: (g) => g.stage === 'worker', run: (g) => { const c = irand(800, 1500); g.cash += c; return `项目奖金 +${c}。` } },
  { id: 'overtime', weight: 3, when: (g) => g.stage === 'worker', run: (g) => { passion(g, -40); g.cash += 3000; return `接了个加班项目。现金 +3000，${pd(-40)}。` } },
  { id: 'free', weight: 5, when: (g) => g.stage !== 'free' && g.cash >= FREE_CASH, hl: true, run: (g) => { g.stage = 'free'; unlock(g, 'stage_free'); return '存款过三十万，你辞了职。朋友圈只发了两个字：自由。' } },
]

/* ———————————— 人设专属彩蛋（每局最多一次） ———————————— */
export const EGG_EVENTS: LifeEvent[] = [
  { id: 'egg_genji', weight: 2, when: (g) => g.persona.id === 'genji', hl: true, run: (g) => { addFans(g, 3000); unlock(g, 'egg_genji'); return '龙刃五杀，切片全网转。人气 +3000。' } },
  { id: 'egg_kfc', weight: 2, when: (g) => g.persona.id === 'kfc', hl: true, run: (g) => { unlock(g, 'egg_kfc'); return '你在公屏要求全队道歉。全队道歉了。' } },
  { id: 'egg_coach', weight: 2, when: (g) => g.persona.id === 'coach', hl: true, run: (g) => { g.mmr += 30; unlock(g, 'egg_coach'); return '你指挥了一整局，赢了。队友：「你打得真菜，但指挥得真好。」' } },
  { id: 'egg_liu6', weight: 2, when: (g) => g.persona.id === 'liu6', hl: true, run: (g) => { unlock(g, 'egg_liu6'); return '你蹲了六分钟，对面五个人从你面前走了过去。' } },
  { id: 'egg_atm', weight: 2, when: (g) => g.persona.id === 'atm', hl: true, run: (g) => { unlock(g, 'egg_atm'); return '0-13。对面加你好友说谢谢。' } },
  { id: 'egg_mercy', weight: 2, when: (g) => g.persona.id === 'mercy', hl: true, run: (g) => { unlock(g, 'egg_mercy'); return '队友在点上喊奶。你飞过去，落地就死了。' } },
  { id: 'egg_wall', weight: 2, when: (g) => g.persona.id === 'wall', hl: true, run: (g) => { g.mmr += 20; unlock(g, 'egg_wall'); return '你杵在点上挨了 40 秒，队友复活回来，点守住了。' } },
  { id: 'egg_rage', weight: 2, when: (g) => g.persona.id === 'rage', hl: true, run: (g) => { addFans(g, 1500); unlock(g, 'egg_rage'); return '你骂人的切片火了。喷子出圈，人气 +1500。' } },
  { id: 'egg_diva', weight: 2, when: (g) => g.persona.id === 'diva', hl: true, run: (g) => { unlock(g, 'egg_diva'); return '你让全队给你让路。全队真让了。你走进去，死了。' } },
  { id: 'egg_chuan', weight: 2, when: (g) => g.persona.id === 'chuan', hl: true, run: (g) => { unlock(g, 'egg_chuan'); return '你在公屏说「这游戏比隔壁好玩」，然后用隔壁的术语报点，被识破了。' } },
  { id: 'egg_fool', weight: 2, when: (g) => g.persona.id === 'fool', hl: true, run: (g) => { passion(g, -20); unlock(g, 'egg_fool'); return `一局被卖三次。第三次你没骂，只是叹了口气。${pd(-20)}。` } },
  { id: 'egg_push', weight: 2, when: (g) => g.persona.id === 'push', hl: true, run: (g) => { unlock(g, 'egg_push'); return '你从第一波开始教全队做人。第三波开始，全队开始教你。' } },
  { id: 'egg_idle', weight: 2, when: (g) => g.persona.id === 'idle', hl: true, run: (g) => { unlock(g, 'egg_idle'); return '一局零输出，赢了。你说：「赢就行。」' } },
  { id: 'egg_greed', weight: 2, when: (g) => g.persona.id === 'greed', hl: true, run: (g) => { unlock(g, 'egg_greed'); return '你一个人吃了全队的血包。奶妈退了。' } },
]

function w(e: LifeEvent, g: LifeState) {
  return typeof e.weight === 'function' ? e.weight(g) : e.weight
}

/** 加权抽取一条事件并执行 */
export function pickEvent(g: LifeState, pool: LifeEvent[], used: Set<string>): LogLine | null {
  const cands = pool.filter((e) => !used.has(e.id) && (!e.when || e.when(g)))
  if (!cands.length) return null
  const weights = cands.map((e) => Math.max(0, w(e, g)))
  let r = rand() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < cands.length; i++) {
    r -= weights[i]
    if (r <= 0) {
      const e = cands[i]
      used.add(e.id)
      g.tally[e.id] = (g.tally[e.id] ?? 0) + 1
      const text = e.run(g)
      const line = { cls: e.cls ?? 'ev', text }
      if (e.hl) g.highlights.push(line)
      return line
    }
  }
  return null
}
