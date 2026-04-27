#!/usr/bin/env node
/**
 * eval-alert.mjs — reads recent eval-live-results.json snapshots and alerts
 * when classifier accuracy drops below a threshold or drops suddenly.
 *
 * Usage:
 *   node scripts/eval-alert.mjs --dir eval-history --threshold 0.85 [--out alert.md]
 *
 * Exit 0: accuracy OK, no file written.
 * Exit 1: accuracy below threshold OR sudden drop > 5pp — alert.md written.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SUDDEN_DROP_THRESHOLD = 0.05

function parseArgs() {
  const args = process.argv.slice(2)
  let dir = 'eval-history'
  let threshold = 0.85
  let out = 'alert.md'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) dir = args[++i]
    else if (args[i] === '--threshold' && args[i + 1]) threshold = parseFloat(args[++i])
    else if (args[i] === '--out' && args[i + 1]) out = args[++i]
  }

  return { dir, threshold, out }
}

function loadSnapshots(dir) {
  if (!existsSync(dir)) return []

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()

  const snapshots = []
  for (const f of files) {
    try {
      const raw = readFileSync(join(dir, f), 'utf8')
      const parsed = JSON.parse(raw)
      const accuracy = parsed?.classifier?.accuracy
      const generatedAt = parsed?.generatedAt ?? f
      if (typeof accuracy === 'number') {
        snapshots.push({ file: f, accuracy, generatedAt })
      }
    } catch {
      // skip malformed
    }
  }
  return snapshots
}

function main() {
  const { dir, threshold, out } = parseArgs()

  const snapshots = loadSnapshots(dir)

  if (snapshots.length === 0) {
    process.stdout.write('No eval snapshots found. No alert generated.\n')
    process.exit(0)
  }

  const latest = snapshots[snapshots.length - 1]
  const previous = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null

  const belowThreshold = latest.accuracy < threshold
  const suddenDrop =
    previous !== null && previous.accuracy - latest.accuracy > SUDDEN_DROP_THRESHOLD

  if (!belowThreshold && !suddenDrop) {
    process.stdout.write(
      `Accuracy ${(latest.accuracy * 100).toFixed(1)}% — OK (threshold ${(threshold * 100).toFixed(0)}%)\n`,
    )
    process.exit(0)
  }

  const lines = ['# Eval Accuracy Alert', '']

  if (belowThreshold) {
    lines.push(
      `**BELOW THRESHOLD**: accuracy ${(latest.accuracy * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% threshold`,
    )
  }

  if (suddenDrop) {
    lines.push(
      `**SUDDEN DROP**: ${(previous.accuracy * 100).toFixed(1)}% → ${(latest.accuracy * 100).toFixed(1)}% (drop > ${(SUDDEN_DROP_THRESHOLD * 100).toFixed(0)}pp)`,
    )
  }

  lines.push('')
  lines.push(`| Snapshot | Accuracy |`)
  lines.push(`|----------|----------|`)
  for (const s of snapshots.slice(-5)) {
    const marker = s === latest ? ' ← latest' : ''
    lines.push(`| ${s.file}${marker} | ${(s.accuracy * 100).toFixed(1)}% |`)
  }

  const content = lines.join('\n') + '\n'
  writeFileSync(out, content)
  process.stdout.write(`Alert written to ${out}\n`)
  process.exit(1)
}

main()
