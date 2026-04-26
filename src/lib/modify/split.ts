/**
 * Split function — Phase 3 Modify v0.3.
 *
 * Splits a single function into N helpers by extracting multiple
 * non-overlapping ranges. Each range becomes its own helper function;
 * the original function keeps its signature and the extracted ranges are
 * replaced by calls.
 *
 * Implementation: a thin orchestration over `planExtract`. Each split entry
 * is a separate extract; we run them all against the original file (offsets
 * stay valid because ranges are non-overlapping), then merge the resulting
 * `RenamePlan`s into one. `applyRenamePlan` sorts edits descending by start
 * within each FileEdit, so all the inserts at the same insertion point
 * accumulate cleanly.
 *
 * Constraints:
 *   - All ranges must lie inside the SAME enclosing function in the SAME file
 *   - Ranges must NOT overlap (we reject with a conflict if they do)
 *   - Each range gets its own newFunctionName (unique per split entry)
 */

import { planExtract } from './extract'
import type { RenamePlan, FileEdit, RenameConflict } from './rename'

export interface SplitEntry {
  startLine: number
  endLine: number
  newFunctionName: string
}

export interface SplitRequest {
  filePath: string
  splits: SplitEntry[]
}

function rangesOverlap(a: SplitEntry, b: SplitEntry): boolean {
  // Inclusive line ranges; overlap when starts/ends interleave.
  return a.startLine <= b.endLine && b.startLine <= a.endLine
}

export async function planSplit(
  projectRoot: string,
  req: SplitRequest,
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []

  if (req.splits.length === 0) {
    conflicts.push({ kind: 'not-found', message: 'split requires at least 1 entry' })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  // Detect overlaps (O(n^2) — splits are small in practice).
  const seenNames = new Set<string>()
  for (let i = 0; i < req.splits.length; i++) {
    if (seenNames.has(req.splits[i].newFunctionName)) {
      conflicts.push({
        kind: 'collision',
        message: `duplicate newFunctionName: ${req.splits[i].newFunctionName}`,
      })
      return {
        fileEdits: [],
        conflicts,
        safetyChecks: { tsConfigFound: false, allFilesInProject: false },
      }
    }
    seenNames.add(req.splits[i].newFunctionName)

    for (let j = i + 1; j < req.splits.length; j++) {
      if (rangesOverlap(req.splits[i], req.splits[j])) {
        conflicts.push({
          kind: 'collision',
          message: `split ranges overlap: lines ${req.splits[i].startLine}-${req.splits[i].endLine} and ${req.splits[j].startLine}-${req.splits[j].endLine}`,
        })
        return {
          fileEdits: [],
          conflicts,
          safetyChecks: { tsConfigFound: false, allFilesInProject: false },
        }
      }
    }
  }

  // Run planExtract per entry. All operate against the original file on disk,
  // so their edits use ORIGINAL offsets — applying them in desc-by-start order
  // works correctly since ranges don't overlap.
  const allFileEditsByPath = new Map<string, FileEdit['edits']>()
  let tsConfigFound = false
  let allFilesInProject = true

  for (const entry of req.splits) {
    const sub = await planExtract(projectRoot, {
      filePath: req.filePath,
      startLine: entry.startLine,
      endLine: entry.endLine,
      newFunctionName: entry.newFunctionName,
    })

    if (sub.conflicts.length > 0) {
      // Forward the first conflict from this sub-extract; abort the whole split.
      const first = sub.conflicts[0]
      conflicts.push({
        kind: first.kind,
        message: `split entry ${entry.newFunctionName} (lines ${entry.startLine}-${entry.endLine}): ${first.message}`,
      })
      return {
        fileEdits: [],
        conflicts,
        safetyChecks: sub.safetyChecks,
      }
    }

    tsConfigFound = sub.safetyChecks.tsConfigFound
    allFilesInProject = sub.safetyChecks.allFilesInProject

    for (const fe of sub.fileEdits) {
      const existing = allFileEditsByPath.get(fe.filePath) ?? []
      existing.push(...fe.edits)
      allFileEditsByPath.set(fe.filePath, existing)
    }
  }

  const fileEdits: FileEdit[] = []
  for (const [filePath, edits] of allFileEditsByPath.entries()) {
    fileEdits.push({ filePath, edits })
  }

  return {
    fileEdits,
    conflicts,
    safetyChecks: { tsConfigFound, allFilesInProject },
  }
}
