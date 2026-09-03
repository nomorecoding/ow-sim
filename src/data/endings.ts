import type { GameState, MajorTier, MetaSave, SeasonEnding } from '../types'
import { MAJOR_NAME, TEAMS, nextMajor, rankLabel } from './constants'

/** 白金→翡翠 经典判词；其它大段门用同一结构换词 */
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

export function buildCloudMudEnding(major: MajorTier): SeasonEnding | null {
  const nxt = nextMajor(major)
  if (!nxt) return null
  const from = MAJOR_NAME[major]
  const to = MAJOR_NAME[nxt]
  const verse = major === 'plat' ? PLAT_EMERALD_VERSE : genericVerse(from, to)
  return {
    id: `cloudmud_${major}`,
    title: `云泥之隔 · ${from}1·99`,
    verse,
    rankLabel: `${from}1 · 99分（差 1 分到${nxt === 'top' ? to : to + '5'}）`,
  }
}

/* ———————————— 职业模式结局 ———————————— */

export type ProEndReason = 'retire' | 'quit' | 'lifetime_ban' | 'fix_ruin' | 'hell_return'

/** 退役去向：只在结局里揭示 */
function afterlife(meta: MetaSave): string {
  const p = meta.pro
  if (p.lifetimeBan) return '直播平台也不签你。你在陪玩平台挂了个号，价格写的是 38。'
  if (p.fame >= 200000) return `退役直播首播 ${Math.round(p.fame / 40).toLocaleString()} 人在线。MCN 的合同比当年的年薪多一个零。以后的日子就是播。`
  if (p.fame >= 50000) return '你开了播。老粉还在，每晚几千人陪你打天梯。够活，也自在。'
  if (p.yearsPlayed >= 5) return '一家青训队请你当教练。你训人的方式和当年教练训你的一模一样。'
  if (p.titles.regional + p.titles.intl > 0) return '你去了一家俱乐部做数据分析。工牌上的照片还是打职业那年拍的。'
  return '你注销了陪玩平台的账号，回学校把剩下的课上完了。'
}

export function buildProEnding(meta: MetaSave, reason: ProEndReason): SeasonEnding {
  const p = meta.pro
  const t = p.titles
  const team = TEAMS.find((x) => x.id === p.teamId)?.name ?? ''
  const label = `${p.age} 岁 · ${p.yearsPlayed} 年${team ? ` · ${team}` : ''}`
  const record = `地区冠军 ${t.regional} · 国际赛 ${t.intl} · 世界冠军 ${t.world}${t.worldCup ? ` · 国家队 ${t.worldCup}` : ''}`

  if (reason === 'lifetime_ban') {
    return {
      id: 'lifetime_ban', title: '终身禁赛', rankLabel: label,
      verse: [p.banReason ?? '', '公告只有三行，你的名字在第二行。', '当年那几单代练、那几套陪玩，每一笔都在账号记录里。', '这个存档的职业模式到此为止。天梯还能打，只是再没有人会私信你了。', afterlife(meta)],
    }
  }
  if (reason === 'fix_ruin') {
    return {
      id: 'fix_ruin', title: '那笔钱', rankLabel: label,
      verse: ['投注数据比你的操作诚实。', '公告出来那天，队友把你从群里踢了。收的钱还在卡里，但没有一个人再叫你的 ID。', `${record}。全部作废。`, afterlife(meta)],
    }
  }
  if (reason === 'hell_return') {
    return {
      id: 'hell_return', title: '地狱归来', rankLabel: label,
      verse: [`最低的时候，账上是 ${meta.cashLow.toLocaleString()}。房租、利息、家里的电话。`, '你没接单，没请人，没开挂，没收那笔钱。就是打。', `本生涯职业收入 ${p.income.toLocaleString()}。${record}。`, '从负债到领奖台，中间没有捷径。王者风范，地狱归来。'],
    }
  }
  if (reason === 'quit') {
    return {
      id: 'quit', title: '回家', rankLabel: label,
      verse: [`负债 ${(-meta.cash).toLocaleString()}。你妈说家里给你找了份工作。`, '你把队服叠好放进箱底，训练赛群改成免打扰。', `${record}。`, '几年后同事问你会不会打这个游戏，你说：会一点。'],
    }
  }
  // retire：按履历分层
  if (t.world >= 1 && t.regional >= 3) {
    return {
      id: 'legend', title: '一代传奇', rankLabel: label,
      verse: [`${record}。`, '退役赛最后一图，全场起立。对面的选手是看你比赛长大的。', '你的 ID 进了名人堂，你的出装教程还在被人搬运。', afterlife(meta)],
    }
  }
  if (t.world >= 1) {
    return {
      id: 'world_champion', title: '世界冠军', rankLabel: label,
      verse: [`${record}。`, '决胜图最后一波，你按下了那个键。教练在后台哭得比你还凶。', '那个当年在路人局骂你的人，正在弹幕里打「牛」。', afterlife(meta)],
    }
  }
  if (t.intl >= 1 || t.regional >= 2) {
    return {
      id: 'regional_king', title: '赛区名将', rankLabel: label,
      verse: [`${record}。`, '国际赛没能更进一步，但这个赛区没人不知道你。', '退役那天，热搜上挂了半天。', afterlife(meta)],
    }
  }
  if (p.yearsPlayed >= 10) {
    return {
      id: 'evergreen', title: '常青树', rankLabel: label,
      verse: [`${p.yearsPlayed} 年。${record}。`, '没拿过冠军，也没被裁过。队友换了四轮，你还在。', '解说说你是「赛区活化石」。你觉得挺好。', afterlife(meta)],
    }
  }
  if (p.yearsPlayed <= 3 && t.regional + t.intl === 0) {
    return {
      id: 'bench', title: '板凳', rankLabel: label,
      verse: [p.benchYears ? `${p.yearsPlayed} 年，${p.benchYears} 年替补。` : `${p.yearsPlayed} 年，走得比来得快。`, '你上过场的比赛，视频合集不到十分钟。', '退役公告发出来，评论区第一条是：「这谁？」', afterlife(meta)],
    }
  }
  return {
    id: 'journeyman', title: '打工人', rankLabel: label,
    verse: [`${p.yearsPlayed} 年。${record}。`, '你换过队，坐过板凳，也打过季后赛。', '不算成功，也不算失败。这个赛区大多数人都是这样退役的。', afterlife(meta)],
  }
}

export function buildTopEnding(g: GameState): SeasonEnding {
  return {
    id: 'top500',
    title: '顶尖 500',
    rankLabel: rankLabel(g.rank),
    verse: [
      '榜单刷新的那一秒，你的 ID 出现在了一个只有五百个名字的地方。',
      '你截了图，没发。',
      '天梯登顶，和排到你的每一个人，都是云泥之别。',
    ],
  }
}

export function buildBannedEnding(g: GameState): SeasonEnding {
  const cheat = g.identity === 'cheat'
  return {
    id: 'banned',
    title: cheat ? '封号 · 官方验证通过' : '封号 · 代练账号',
    rankLabel: rankLabel(g.rank),
    verse: cheat
      ? [
          '登录时跳出一行字：该账号因使用第三方程序被永久封停。',
          '你打过的每一把，被举报过的每一次，都算数。',
          `本赛季最高触及 ${rankLabel(g.rank)}。段位归零，换号重来，时长照旧。`,
        ]
      : [
          '那个老板的号被封了，连带你上过的所有账号一起查。',
          '代练收入到账了，段位没了。',
          '换号重来。战队永远不会再看你的号。',
        ],
  }
}

export function buildLandedEnding(g: GameState): SeasonEnding {
  return {
    id: 'landed',
    title: '上岸',
    rankLabel: rankLabel(g.rank),
    verse: [
      '代练累计收入过了六千。你把最后一个老板拉黑，付了首付。',
      '从抖音炸鱼到大师墙高价单，每一单都在匹配池里留下了味道。',
      '你以后再排到代练，也没资格骂了。',
    ],
  }
}

export function buildBronzeEnding(g: GameState): SeasonEnding {
  return {
    id: 'bronze',
    title: '地心探索',
    rankLabel: rankLabel(g.rank),
    verse: [
      '青铜五。你以为下面没有了。',
      '系统告诉你：还有 0 分。',
      `人设【${g.persona.name}】——${g.persona.tagline}。`,
    ],
  }
}
