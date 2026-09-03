import type { LifeState, LogLine } from '../types'
import { ACH_MAP } from '../data/achievements'

/** 解锁成就：仅首次生效，写入高光栏 */
export function unlock(g: LifeState, id: string): LogLine | null {
  if (g.achieved[id]) return null
  // 开挂之后这辈子的成就不再计入（结局成就除外，由 endLife 临时解锁）
  if (g.achLocked) return null
  const a = ACH_MAP[id]
  if (!a) return null
  g.achieved[id] = true
  g.newAchievements.push(id)
  const line: LogLine = { cls: 'ach', text: `成就【${a.name}】` }
  g.highlights.push(line)
  return line
}
