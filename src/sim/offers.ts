import type { LogLine, MetaSave } from '../types'
import { OWN_TEAM_MIN_FANS, OWN_TEAM_ROSTER_COST, OWN_TEAM_SETUP_COST, PRO_UNLOCK_SEASONS, STREAM_INCOME_PER_FAN } from '../data/constants'
import { applyTrial, canApply, canFormTeam, exposureP, formOwnTeam, giveUpDream } from './career'

/** 开播门槛：人气 */
export const STREAMER_FANS = 8000

export interface OfferButton {
  label: string
  /** 'primary' | 'warn' | 'danger' | '' */
  cls?: string
  /** 返回 'market' 表示点完去黑市；'play' 直接开局；其余留在当前页 */
  run: (meta: MetaSave) => LogLine | 'market' | 'play' | void
}

export interface Offer {
  id: string
  title: string
  body: string
  buttons: OfferButton[]
  /** 「下次再说」后多少赛季再弹；0 = 一次性 */
  snooze: number
  danger?: boolean
}

function snoozed(meta: MetaSave, id: string) {
  return (meta.snooze[id] ?? -1) > meta.seasonsPlayed
}

export function canStream(meta: MetaSave): { ok: boolean; why: string } {
  if (meta.stage === 'streamer') return { ok: false, why: '已经是主播。' }
  if (meta.stage === 'coach') return { ok: false, why: '教练不开播。' }
  if (meta.career.phase === 'signed' || meta.career.phase === 'scouted') return { ok: false, why: '签约选手由俱乐部安排直播，不单独转型。' }
  if (meta.fans < STREAMER_FANS && !meta.reachedGM) return { ok: false, why: `人气 ${meta.fans.toLocaleString()} / ${STREAMER_FANS.toLocaleString()}，或触及宗师。` }
  return { ok: true, why: '' }
}

export function becomeStreamer(meta: MetaSave): LogLine {
  const chk = canStream(meta)
  if (!chk.ok) return { cls: 'sys', text: chk.why }
  meta.stage = 'streamer'
  meta.fans += 1000
  meta.achievements['stage_streamer'] = true
  return { cls: 'ev', text: `你开播了。以后每季直播收入 ≈ 人气 × ${STREAM_INCOME_PER_FAN}，人气涨得更快；人气到 ${OWN_TEAM_MIN_FANS.toLocaleString()} 可以组自己的队。` }
}

/** 按优先级返回当前该弹的邀约（首页 / 结算页逐个弹） */
export function pendingOffers(meta: MetaSave): Offer[] {
  const out: Offer[] = []
  const c = meta.career
  const fm = (n: number) => n.toLocaleString()

  if (c.phase === 'banned' && !meta.seen['lifetime_ban']) {
    out.push({
      id: 'lifetime_ban', snooze: 0, danger: true,
      title: '这个档的职业线废了',
      body: `${c.banReason ?? ''}<br>官方终身禁赛：本存档以后不会再有试训、签约、主播队。天梯、黑市、成就照常。想再走职业路，只能<b>删档重来</b>（成就保留）。`,
      buttons: [{ label: '知道了，继续打天梯', cls: 'primary', run: (m) => { m.seen['lifetime_ban'] = true } }],
    })
  }

  if (meta.cash < 0 && !c.dreamGiven && c.phase !== 'signed' && !snoozed(meta, 'debt')) {
    out.push({
      id: 'debt', snooze: 2, danger: true,
      title: `负债 ${fm(-meta.cash)}`,
      body: '每季 6% 利息。三条路，选一条就行：',
      buttons: [
        { label: '找份正业 · 上班拿工资，放弃职业梦', run: (m) => giveUpDream(m) },
        { label: '去黑市接单 · 来钱快，进黑历史', cls: 'warn', run: () => 'market' },
        { label: '咬牙坚持 · 干净打上去，冲「地狱归来」', cls: 'primary', run: () => 'play' },
      ],
    })
  }

  const trial = canApply(meta)
  if (trial.ok && !snoozed(meta, 'trial')) {
    const expo = exposureP(meta.dirty)
    out.push({
      id: 'trial', snooze: 2,
      title: '有战队愿意给你试训',
      body: `你${meta.reachedGM ? '触及过宗师' : `打满了 ${PRO_UNLOCK_SEASONS} 个赛季`}，青训教练回了消息。下赛季开局三场 BO3 训练赛，过了就签。签约后天赋兜底「有点东西」，有底薪，第 2 / 4 / 6 季末打 OWCS。${expo > 0 ? `<br><span class="warn">你有黑历史，签约前背调翻出来的概率 ${Math.round(expo * 100)}% → 终身禁赛。</span>` : ''}`,
      buttons: [
        { label: '报名，下季试训', cls: 'primary', run: (m) => applyTrial(m) },
        { label: '下次再说', run: () => {} },
      ],
    })
  }

  const stream = canStream(meta)
  if (stream.ok && !snoozed(meta, 'streamer')) {
    out.push({
      id: 'streamer', snooze: 3,
      title: 'MCN 找你签约开播',
      body: `人气 ${fm(meta.fans)}${meta.reachedGM ? '，还打过宗师' : ''}。开播后每季直播收入 ≈ 人气 × ${STREAM_INCOME_PER_FAN}，人气涨速翻倍；人气到 ${fm(OWN_TEAM_MIN_FANS)} 可以花 ${fm(OWN_TEAM_SETUP_COST)} 组自己的主播队去打 OWCS。${meta.stage === 'student' ? '学生开播不影响上学。' : meta.stage === 'worker' ? '会辞职全职播，工资没了，靠人气吃饭。' : ''}`,
      buttons: [
        { label: '开播', cls: 'primary', run: (m) => becomeStreamer(m) },
        { label: '下次再说', run: () => {} },
      ],
    })
  }

  const team = canFormTeam(meta)
  if (team.ok && !snoozed(meta, 'own_team')) {
    out.push({
      id: 'own_team', snooze: 3,
      title: '人气够了，组自己的队？',
      body: `注册 + 首期底薪 ${fm(OWN_TEAM_SETUP_COST)}。你当老板兼首发，每季付队友底薪 ${fm(OWN_TEAM_ROSTER_COST)}、拿人气赞助，奖金双份。从公开预选打起；一年打不进正赛或负债太深会解散。`,
      buttons: [
        { label: '组队', cls: 'primary', run: (m) => formOwnTeam(m) },
        { label: '下次再说', run: () => {} },
      ],
    })
  }

  return out
}

export function snoozeOffer(meta: MetaSave, o: Offer) {
  if (o.snooze > 0) meta.snooze[o.id] = meta.seasonsPlayed + o.snooze
  else meta.seen[o.id] = true
}
