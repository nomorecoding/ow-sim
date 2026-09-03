import type { GameState, MajorTier, SeasonEnding } from '../types'
import { MAJOR_NAME, nextMajor, rankLabel } from './constants'

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

export function buildWorldChampEnding(g: GameState, eventName: string): SeasonEnding {
  return {
    id: 'world_champion',
    title: `${eventName} 冠军`,
    rankLabel: `${g.career.team?.name ?? ''} · ${g.age} 岁`,
    verse: [
      '决胜图最后一波，你按下了那个键。',
      '教练在后台哭得比你还凶。那个当年在路人局骂你的人，正在弹幕里打「牛」。',
      `你想起第 1 个赛季的定级——${g.season > 1 ? '五胜五负，白金四' : '就在刚才'}。`,
      '白金是白金，冠军是冠军。原来路是能走通的。',
    ],
  }
}

export function buildRetireEnding(g: GameState): SeasonEnding {
  const h = g.career.history
  const best = h.length ? Math.min(...h.map((r) => r.place || 9)) : 9
  const intl = h.filter((r) => r.intl > 0).length
  return {
    id: 'retired',
    title: '退役',
    rankLabel: `${g.age} 岁 · 效力 ${h.length} 个 Stage`,
    verse: [
      `职业生涯最好成绩：地区第 ${best}${intl ? `，${intl} 次国际赛` : ''}${g.career.worldCup ? `，${g.career.worldCup} 次国家队` : ''}。`,
      '你把外设收进箱子，登录了那个很久没上的路人号。',
      '定级赛第一把，对面有人说：「这 ID 我好像见过。」',
    ],
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
