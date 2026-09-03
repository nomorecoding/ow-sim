import type { LifeState, LogLine } from '../types'
import { ACH_MAP } from '../data/achievements'

/** 解锁成就：仅首次生效，写入高光栏 */
export function unlock(g: LifeState, id: string): LogLine | null {
  if (g.achieved[id]) return null
  const a = ACH_MAP[id]
  if (!a) return null
  g.achieved[id] = true
  g.newAchievements.push(id)
  const line: LogLine = { cls: 'ach', text: `成就【${a.name}】` }
  g.highlights.push(line)
  return line
}
