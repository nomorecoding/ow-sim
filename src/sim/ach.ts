import type { GameState, LogLine } from '../types'
import { ACH_MAP } from '../data/achievements'

/** 解锁成就：仅首次生效，写入事件栏 */
export function unlock(g: GameState, id: string): LogLine | null {
  if (g.achieved[id]) return null
  const a = ACH_MAP[id]
  if (!a) return null
  g.achieved[id] = true
  g.newAchievements.push(id)
  const line: LogLine = { cls: 'ach', text: `【成就】${a.name} —— ${a.desc}` }
  g.events.push(line)
  return line
}
