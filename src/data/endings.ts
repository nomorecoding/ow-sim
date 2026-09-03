import type { LifeState, MajorTier, MetaSave, SeasonEnding } from '../types'
import { MAJOR_NAME, TEAMS, isAtMajorGate, majorIndex, nextMajor, rankLabel } from './constants'
import { scoreToRank } from '../sim/rank'

/* ———————————— 云泥之隔 ———————————— */

const PLAT_EMERALD_VERSE = [
  '白金是白金，翡翠是翡翠，是云泥之别，是天壤之别，是判若云泥，是霄壤之隔，是天差地别，是迥然不同，是泾渭分明，是高下立判，是鸿泥之隔，是天渊之别，是人鬼殊途，是仙凡有别，是生殖隔离。',
  '差 1 分都不一样，差 1 分你也是白金，说什么接近翡翠，终归只是白金而已，颜色都不一样。',
  '别拿白金当翡翠，你白金，我翡翠，此生注定是遗憾。',
  '山外山，天外天，翡翠拷打臭白金。',
  '天上一天，地上一年，时间不困翡翠仙，历经浮沉志更坚。',
]

function genericVerse(fromMajor: string, toMajor: string): string[] {
  return [
    `${fromMajor}是${fromMajor}，${toMajor}是${toMajor}，是云泥之别，是天壤之别，是判若云泥，是霄壤之隔，是天差地别，是迥然不同，是泾渭分明，是高下立判，是鸿泥之隔，是天渊之别，是人鬼殊途，是仙凡有别，是生殖隔离。`,
    `差 1 分都不一样，差 1 分你也是${fromMajor}，说什么接近${toMajor}，终归只是${fromMajor}而已，颜色都不一样。`,
    `别拿${fromMajor}当${toMajor}，你${fromMajor}，我${toMajor}，此生注定是遗憾。`,
    `山外山，天外天，${toMajor}拷打臭${fromMajor}。`,
    `天上一天，地上一年，时间不困${toMajor}仙，历经浮沉志更坚。`,
  ]
}

export function buildCloudMudEnding(major: MajorTier, age: number): SeasonEnding | null {
  const nxt = nextMajor(major)
  if (!nxt) return null
  const from = MAJOR_NAME[major]
  const to = MAJOR_NAME[nxt]
  const verse = major === 'plat' ? PLAT_EMERALD_VERSE : genericVerse(from, to)
  return {
    id: `cloudmud_${major}`,
    title: `云泥之隔 · ${from}1·99`,
    verse: [...verse, `${age} 岁退坑。最后一把停在 ${from}1 · 99 分。`],
    rankLabel: `${from}1 · 99分（差 1 分到${nxt === 'top' ? ' ' + to : to + '5'}）`,
  }
}

/* ———————————— 天梯人生结局 ———————————— */

export type LifeEndReason = 'quit' | 'age' | 'banned' | 'landed'

const PEAK_TITLE: Record<MajorTier, [string, string]> = {
  bronze: ['青铜养老', '你在青铜打了一辈子。队友换了几百个，没一个记得你。'],
  silver: ['白银人', '白银是大多数人的家。你也是。'],
  gold: ['黄金守门员', '黄金 1 到白金 5 之间，你来回走了很多年。'],
  plat: ['白金人', '白金。你这辈子的段位。'],
  emerald: ['翡翠', '翡翠是你的顶。往上看过一眼，没上去。'],
  diamond: ['钻石守门员', '钻石墙。多少人在这儿和你一样，抬头看大师。'],
  master: ['大师', '大师。在网吧里够吹一辈子的段位。'],
  gm: ['路人王', '宗师。没进职业，但排到你的人都知道你是谁。'],
  champ: ['英杰路人', '英杰。离 500 强差一个榜单，离职业差一条私信。'],
  top: ['500 强 · 路人王', '榜单上有你的名字。没人来签你，或者来了你没去。'],
}

/** 生平里值得写一笔的事（按 tally 计数） */
const TALLY_LABEL: Array<[string, (n: number) => string]> = [
  ['mute', (n) => `被红框禁言 ${n} 次`],
  ['streak_lose', (n) => `十连跪 ${n} 回`],
  ['streak_win', (n) => `十连胜 ${n} 回`],
  ['crew_off', (n) => `散过 ${n} 个车队`],
  ['breakup', (n) => `分过 ${n} 次手`],
  ['gf_ow', () => '找到过一个也玩守望的人'],
  ['wedding', () => '结了婚'],
  ['kid', () => '当了爸'],
  ['dropout', () => '辍过学'],
  ['layoff', () => '被裁过'],
  ['college_team', () => '当过校队队长'],
  ['clip', (n) => `切片火过 ${n} 次`],
  ['lan', (n) => `上过 ${n} 次线下舞台`],
  ['netbar_cup', (n) => `打过 ${n} 届网吧赛`],
  ['boost_rent', (n) => `为房租接过 ${n} 单`],
  ['escort_taste', () => '被 4 陪 1 带过一季'],
  ['met_388', () => '排到过 388 一小时的陪玩'],
  ['back', () => '腰突了'],
  ['friend_quit', () => '送走过一起打的朋友'],
  ['patch_nerf', (n) => `本命被削 ${n} 次`],
]

function lifeStory(g: LifeState): string {
  const items: string[] = []
  for (const [k, f] of TALLY_LABEL) {
    const n = g.tally[k] ?? 0
    if (n > 0) items.push(f(n))
  }
  if (g.stuckTotal >= 3) items.unshift(`卡墙 ${g.stuckTotal} 季`)
  if (g.usedMarket) items.push(g.dirty.cheatSeasons ? '开过挂' : '请过代练')
  const picked = items.slice(0, 4)
  if (!picked.length) return `一辈子没什么大事。人设【${g.persona.name}】——${g.persona.tagline}`
  return `这一生：${picked.join('，')}。`
}

const EULOGY = [
  '你不是最强的，但你排到过最强的。',
  '这游戏给过你几个凌晨三点的好夜晚。够了。',
  '没人记得你的 ID。你自己记得。',
  '你后来再没找到一个能让你连输十把还想再来的东西。',
  '朋友问你玩了多少小时。你说：不多。',
  '你删过三次，装回来四次。',
]

export function buildLifeEnding(g: LifeState, reason: LifeEndReason): SeasonEnding {
  const peak = scoreToRank(g.peakScore)
  const real = scoreToRank(g.peakMmr)
  const label = `${g.age} 岁 · 峰值 ${rankLabel(peak)} · 真实峰值 ${rankLabel(real)}`
  const bio = `16 岁开局，${g.age} 岁封盘。${g.season} 季，${g.gamesTotal.toLocaleString()} 把。`
  const story = lifeStory(g)
  const eulogy = EULOGY[Math.floor(Math.random() * EULOGY.length)]

  if (reason === 'banned') {
    return {
      id: 'banned', title: '永封 · 官方验证通过', rankLabel: label,
      verse: [
        '登录时跳出一行字：该账号因使用第三方程序被永久封停。申诉入口是灰的。',
        bio + '最后一道墙没自己过去。',
        story,
        '开挂之后解锁的成就一个没算。这个 ID 以后没有战队会看。',
      ],
    }
  }
  if (reason === 'landed') {
    return {
      id: 'landed', title: '上岸', rankLabel: label,
      verse: ['接单收入过了十万。你把最后一个老板拉黑，付了首付。', bio, story, '你以后再排到代练，也没资格骂了。'],
    }
  }
  // 云泥：退坑时停在 X1·99
  if (isAtMajorGate(g.rank) && g.rank.rp === 99) {
    const cm = buildCloudMudEnding(g.rank.major, g.age)
    if (cm) return { ...cm, verse: [...cm.verse, story] }
  }
  // 隐藏结局：只有带隐藏天赋、又走到了那一步的人才会看到
  const hid = buildHiddenEnding(g, label, bio, story)
  if (hid) return hid
  const [title, line] = PEAK_TITLE[peak.major]
  const gapLine = g.peakMmr - g.peakScore > 300
    ? `系统一直欠你分：真实峰值 ${rankLabel(real)}，段位从没追上过。`
    : g.peakScore - g.peakMmr > 300
      ? `段位比实力高了一截。${g.usedMarket ? '你知道为什么。' : '陪玩那次。'}`
      : ''
  const how = reason === 'age'
    ? `${g.age} 岁。游戏还在硬盘里，你只是不再点开。`
    : g.stage === 'worker' ? '下班太累了。最后几季都是周末打两把。' : g.stage === 'fulltime' ? '全职打了几年，房租把热情烧完了。' : g.rich ? '家里给你安排了别的事。' : '不想打了。就是不想打了。'
  return {
    id: `quit_${peak.major}`, title, rankLabel: label,
    verse: [line, bio + how, story, gapLine, eulogy].filter(Boolean),
  }
}

/* ———————————— 隐藏结局（天梯） ———————————— */

function buildHiddenEnding(g: LifeState, label: string, bio: string, story: string): SeasonEnding | null {
  if (!g.hidden) return null
  const peak = scoreToRank(g.peakScore)
  const pi = majorIndex(peak.major)
  if (g.hidden === 'aim' && pi >= majorIndex('champ') && !g.scouted) {
    return {
      id: 'aimbot', title: '人形自走挂', rankLabel: label,
      verse: [
        '你退坑那天，论坛还有人在发你的录像问「这真没开？」。官方复核过，没开。',
        bio + '没有任何一支战队私信过你。他们也觉得你开了。',
        story,
        '几年后有人在网吧认出你的 ID。他说：「我当年举报过你。」你说：「谢谢。」',
      ],
    }
  }
  if (g.hidden === 'clutch' && g.stuckTotal === 0 && pi >= majorIndex('master')) {
    return {
      id: 'unstuck', title: '从没卡过', rankLabel: label,
      verse: [
        '别人卡墙卡出心理阴影，你一辈子没在任何一道门口停过一季。',
        bio + '每一次「差一口气」，你都刚好有那口气。',
        story,
        '你不理解为什么有人说这游戏有墙。',
      ],
    }
  }
  if (g.hidden === 'late' && g.age >= 30 && pi >= majorIndex('gm')) {
    return {
      id: 'latebloom', title: '越老越妖', rankLabel: label,
      verse: [
        `三十岁那年你还在涨分。一起打过的人早就退坑、结婚、生小孩了。`,
        bio + `峰值 ${rankLabel(peak)}，是在别人都说「这年纪该收手了」之后打到的。`,
        story,
        '你的直播间标题一直没改：「叔叔还能打」。',
      ],
    }
  }
  if (g.hidden === 'glass' && g.injured && majorIndex(scoreToRank(g.peakMmr).major) >= majorIndex('master')) {
    return {
      id: 'glasshand', title: '伤仲永', rankLabel: label,
      verse: [
        '受伤前那几季，认识你的人都说你是他们见过最有天赋的。',
        bio + '手腕废了之后，你又打了很久，分再没回到过去。',
        story,
        '你现在偶尔还会打开录像，看受伤前那个人的操作。你不确定那还是不是你。',
      ],
    }
  }
  return null
}

/* ———————————— 职业结局 ———————————— */

export type ProEndReason = 'retire' | 'quit' | 'lifetime_ban' | 'fix_ruin' | 'hell_return'

export type AfterKind = 'boost' | 'star' | 'stream' | 'coach' | 'analyst' | 'school'

/** 退役去向：只在结局里揭示。kind 给成就用 */
export function afterlife(meta: MetaSave): { kind: AfterKind; text: string } {
  const p = meta.pro
  if (p.lifetimeBan) return { kind: 'boost', text: '直播平台也不签你。你在陪玩平台挂了个号，价格写的是 38。' }
  if (p.fame >= 1000000) return { kind: 'star', text: `首播 ${Math.round(p.fame / 40).toLocaleString()} 人在线，弹幕刷了一晚上「开神开播了？」。MCN 的合同比当年的年薪多一个零。` }
  if (meta.cash < 0 && p.fame < 50000) return { kind: 'boost', text: `欠的 ${(-meta.cash).toLocaleString()} 要还。你在代练平台挂了号，简介写「前 OWCS 选手」。第一单把一个白金带到钻石，打了一晚上，收了 200。` }
  if (p.fame >= 200000) return { kind: 'stream', text: `退役直播首播 ${Math.round(p.fame / 40).toLocaleString()} 人在线。签了 MCN，以后的日子就是播。` }
  if (p.fame >= 50000) return { kind: 'stream', text: '你开了播。老粉还在，每晚几千人陪你打天梯。够活。' }
  if (p.yearsPlayed >= 5) return { kind: 'coach', text: '一家青训队请你当教练。你训人的方式和当年教练训你的一模一样。' }
  if (p.titles.regional + p.titles.intl > 0) return { kind: 'analyst', text: '你去了一家俱乐部做数据分析。工牌上的照片还是打职业那年拍的。' }
  return { kind: 'school', text: '你回学校把剩下的课上完了。同学不知道你打过职业。' }
}

export function buildProEnding(meta: MetaSave, reason: ProEndReason): SeasonEnding {
  const p = meta.pro
  const t = p.titles
  const team = TEAMS.find((x) => x.id === p.teamId)?.name ?? ''
  const label = `${p.age} 岁 · ${p.yearsPlayed} 年${team ? ` · ${team}` : ''}`
  const record = `地区冠军 ${t.regional} · 国际赛 ${t.intl} · 世界冠军 ${t.world}${t.fmvp ? ` · FMVP ${t.fmvp}` : ''}${t.worldCup ? ` · 国家队 ${t.worldCup}` : ''}`
  const after = afterlife(meta).text

  if (reason === 'lifetime_ban') {
    return {
      id: 'lifetime_ban', title: '终身禁赛', rankLabel: label,
      verse: [p.banReason ?? '', '公告只有三行，你的名字在第二行。', '当年那几单代练、那几套陪玩，每一笔都在账号记录里。', '这个存档的职业模式到此为止。天梯还能打，只是再没有人会私信你了。', after],
    }
  }
  if (reason === 'fix_ruin') {
    return {
      id: 'fix_ruin', title: '那笔钱', rankLabel: label,
      verse: ['投注数据比你的操作诚实。', '公告出来那天，队友把你从群里踢了。收的钱还在卡里，但没有一个人再叫你的 ID。', `${record}。全部作废。`, after],
    }
  }
  if (reason === 'hell_return') {
    return {
      id: 'hell_return', title: '地狱归来', rankLabel: label,
      verse: [`最低的时候，账上是 ${meta.cashLow.toLocaleString()}。房租、催收、家里的电话。`, '你没接单，没请人，没开挂，没收那笔钱。就是打。', `本生涯职业收入 ${p.income.toLocaleString()}。${record}。`, '从负债到领奖台，中间没有捷径。'],
    }
  }
  if (reason === 'quit') {
    return {
      id: 'quit', title: '回家', rankLabel: label,
      verse: [`负债 ${(-meta.cash).toLocaleString()}。你妈说家里给你找了份工作。`, '你把队服叠好放进箱底，训练赛群改成免打扰。', `${record}。`, '几年后同事问你会不会打这个游戏，你说：会一点。'],
    }
  }
  // retire：按履历分层
  if (t.fmvp >= 1 || t.world >= 2) {
    return {
      id: 'legend', title: '一代传奇', rankLabel: label,
      verse: [`${record}。`, '退役赛最后一图，全场起立。对面的选手是看你比赛长大的。', '你的 ID 进了名人堂。你当年的灵敏度设置，现在还有人在搜。', after],
    }
  }
  if (t.world >= 1) {
    return {
      id: 'world_champion', title: '世界冠军', rankLabel: label,
      verse: [`${record}。`, '决胜图最后一波，你的大招收了三个。教练在后台哭得比你还凶。', '那个当年在路人局骂你的人，正在弹幕里打「牛」。', after],
    }
  }
  if (t.intl >= 1 || t.regional >= 2) {
    return {
      id: 'regional_king', title: '赛区名将', rankLabel: label,
      verse: [`${record}。`, '国际赛没能更进一步，但这个赛区没人不知道你。', '退役那天，热搜上挂了半天。', after],
    }
  }
  if (p.yearsPlayed >= 10) {
    return {
      id: 'evergreen', title: '常青树', rankLabel: label,
      verse: [`${p.yearsPlayed} 年。${record}。`, '没拿过冠军，也没被裁过。队友换了四轮，你还在。', '解说说你是「赛区活化石」。你觉得挺好。', after],
    }
  }
  if (p.yearsPlayed <= 3 && t.regional + t.intl === 0) {
    return {
      id: 'bench', title: '板凳', rankLabel: label,
      verse: [p.benchYears ? `${p.yearsPlayed} 年，${p.benchYears} 年替补。` : `${p.yearsPlayed} 年，走得比来得快。`, '你上过场的比赛，视频合集不到十分钟。', '退役公告发出来，评论区第一条是：「这谁？」', after],
    }
  }
  return {
    id: 'journeyman', title: '打工人', rankLabel: label,
    verse: [`${p.yearsPlayed} 年。${record}。`, '你换过队，坐过板凳，也打过季后赛。', '不算成功，也不算失败。这个赛区大多数人都是这样退役的。', after],
  }
}
