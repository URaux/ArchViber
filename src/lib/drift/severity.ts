/**
 * Drift severity scoring — phase3/drift-severity
 *
 * Heuristic point values:
 *   removed block      +5  (high signal: diagram is stale)
 *   removed container +10  (structural regression)
 *   anchor change      +1  (per changed block)
 *   removed edge       +0.5
 *
 * Score is capped at 100.
 * Levels: <10 → minor, 10–50 → major, >50 → critical.
 */

import type { DriftReport } from './detect'

export type SeverityLevel = 'minor' | 'major' | 'critical'

export interface DriftSeverity {
  score: number
  level: SeverityLevel
  reasons: string[]
}

export function computeDriftSeverity(report: DriftReport): DriftSeverity {
  let raw = 0
  const reasons: string[] = []

  if (report.removedBlocks.length > 0) {
    const pts = report.removedBlocks.length * 5
    raw += pts
    reasons.push(`${report.removedBlocks.length} removed block(s) (+${pts})`)
  }

  if (report.removedContainers.length > 0) {
    const pts = report.removedContainers.length * 10
    raw += pts
    reasons.push(`${report.removedContainers.length} removed container(s) (+${pts})`)
  }

  if (report.changedBlocks.length > 0) {
    const pts = report.changedBlocks.length * 1
    raw += pts
    reasons.push(`${report.changedBlocks.length} anchor change(s) (+${pts})`)
  }

  if (report.removedEdges.length > 0) {
    const pts = report.removedEdges.length * 0.5
    raw += pts
    reasons.push(`${report.removedEdges.length} removed edge(s) (+${pts})`)
  }

  const score = Math.min(100, Math.round(raw * 10) / 10)

  let level: SeverityLevel
  if (score >= 50) level = 'critical'
  else if (score >= 10) level = 'major'
  else level = 'minor'

  return { score, level, reasons }
}
