/**
 * Per-language anchor coverage — W2.D6.
 *
 * `CodeAnchorResult.coverage` is a single overall ratio. For polyglot
 * projects we want to know the coverage PER language so a single
 * fully-anchored TypeScript layer can't mask zero anchors on the Python side.
 *
 * Strategy: group clusters by their dominant language (majority of files in
 * the anchor → language map). Ties resolve by alphabetical language id for
 * stability. Clusters with no anchored files are bucketed under "unknown".
 *
 * Used by W2.D7 e2e tests on the vendored polyglot fixture.
 */

import type { CodeAnchorResult } from './code-anchors'
import { inferLanguageFromPath } from './name'

export interface LanguageCoverage {
  language: string
  totalClusters: number
  clustersWithFiles: number
  coverage: number
}

export interface PerLanguageCoverageReport {
  byLanguage: Record<string, LanguageCoverage>
  /** Languages observed across the entire anchor result, sorted. */
  languages: string[]
  /** Mirrors CodeAnchorResult.coverage so callers don't need both refs. */
  overallCoverage: number
}

function dominantLanguage(filePaths: string[]): string {
  if (filePaths.length === 0) return 'unknown'
  const counts = new Map<string, number>()
  for (const p of filePaths) {
    const lang = inferLanguageFromPath(p) ?? 'unknown'
    counts.set(lang, (counts.get(lang) ?? 0) + 1)
  }
  // Pick max-count, tie-break alphabetically.
  let best = 'unknown'
  let bestCount = -1
  for (const [lang, n] of counts) {
    if (n > bestCount || (n === bestCount && lang < best)) {
      best = lang
      bestCount = n
    }
  }
  return best
}

export function computePerLanguageCoverage(anchors: CodeAnchorResult): PerLanguageCoverageReport {
  const byLanguage: Record<string, { total: number; withFiles: number }> = {}

  for (const entry of anchors.entries) {
    const files = entry.anchor.files ?? []
    const filePaths = files.map((f) => f.path)
    const lang = dominantLanguage(filePaths)
    if (!byLanguage[lang]) byLanguage[lang] = { total: 0, withFiles: 0 }
    byLanguage[lang].total += 1
    if (filePaths.length > 0) byLanguage[lang].withFiles += 1
  }

  const reportByLang: Record<string, LanguageCoverage> = {}
  for (const [lang, agg] of Object.entries(byLanguage)) {
    reportByLang[lang] = {
      language: lang,
      totalClusters: agg.total,
      clustersWithFiles: agg.withFiles,
      coverage: agg.total === 0 ? 0 : agg.withFiles / agg.total,
    }
  }

  return {
    byLanguage: reportByLang,
    languages: Object.keys(reportByLang).sort(),
    overallCoverage: anchors.coverage,
  }
}

export interface CoverageAssertionFailure {
  language: string
  observed: number
  threshold: number
}

/**
 * Returns failures (empty array = all languages meet the threshold). When
 * `excludeLanguages` is provided, those buckets are skipped — useful to
 * exclude `'unknown'` from a strict gate.
 */
export function checkMinCoverage(
  report: PerLanguageCoverageReport,
  threshold: number,
  excludeLanguages: string[] = ['unknown'],
): CoverageAssertionFailure[] {
  const skip = new Set(excludeLanguages)
  const failures: CoverageAssertionFailure[] = []
  for (const lang of report.languages) {
    if (skip.has(lang)) continue
    const cov = report.byLanguage[lang]
    if (cov.coverage < threshold) {
      failures.push({ language: lang, observed: cov.coverage, threshold })
    }
  }
  return failures
}
