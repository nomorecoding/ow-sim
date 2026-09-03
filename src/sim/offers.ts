import type { LogLine, MetaSave } from '../types'
import { STAGE_INFO } from '../data/constants'
import { proUnlocked } from './pro'

export interface OfferButton {
  label: string
  /** 'primary' | 'warn' | 'danger' | '' */
  cls?: string
  /** 返回 'market' 表示点完去黑市；'play' 直接开局；'pro' 去职业模式；其余留在当前页 */
  run: (meta: MetaSave) => LogLine | 'market' | 'play' | 'pro' | void
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

/** 负债时找份正业：上班阶段 */
export function takeJob(meta: MetaSave): LogLine {
  meta.stage = 'worker'
  meta.achievements['dream_given'] = true
  meta.achievements['stage_worker'] = true
  return { cls: 'sys', text: `你找了份正业。以后每季有工资，额度 ${STAGE_INFO.worker.quota}。` }
}

/** 按优先级返回当前该弹的邀约（首页 / 结算页逐个弹） */
export function pendingOffers(meta: MetaSave): Offer[] {
  const out: Offer[] = []
  const fm = (n: number) => n.toLocaleString()

  if (proUnlocked(meta) && !meta.seen['pro_unlocked'] && !meta.pro.lifetimeBan) {
    out.push({
      id: 'pro_unlocked', snooze: 0,
      title: '职业模式解锁',
      body: `${meta.reachedGM ? '你触及过宗师' : '你打了这么多赛季'}，青训教练回了消息。职业模式是单独的一条线：17 岁起步，一年一局，转会窗自己选队。天梯里的黑历史会带过去。`,
      buttons: [
        { label: '去看看', cls: 'primary', run: (m) => { m.seen['pro_unlocked'] = true; return 'pro' } },
        { label: '先打天梯', run: (m) => { m.seen['pro_unlocked'] = true } },
      ],
    })
  }

  if (meta.cash < 0 && meta.stage !== 'worker' && !snoozed(meta, 'debt')) {
    out.push({
      id: 'debt', snooze: 2, danger: true,
      title: `负债 ${fm(-meta.cash)}`,
      body: '每季 6% 利息。三条路，选一条就行：',
      buttons: [
        { label: '找份正业 · 上班拿工资', run: (m) => takeJob(m) },
        { label: '去黑市接单 · 来钱快，进黑历史', cls: 'warn', run: () => 'market' },
        { label: '咬牙坚持 · 干净打上去', cls: 'primary', run: () => 'play' },
      ],
    })
  }

  return out
}

export function snoozeOffer(meta: MetaSave, o: Offer) {
  if (o.snooze > 0) meta.snooze[o.id] = meta.seasonsPlayed + o.snooze
  else meta.seen[o.id] = true
}
