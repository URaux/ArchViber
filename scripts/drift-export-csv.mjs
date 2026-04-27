/**
 * drift-export-csv.mjs
 *
 * Reads a drift result JSON file and emits CSV with columns:
 *   kind, id, name, change
 *
 * Usage:
 *   node scripts/drift-export-csv.mjs --input result.json [--output drift.csv] [--quiet]
 *
 * Exit codes:
 *   0  Success
 *   1  Bad arguments or file read error
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

function getFlag(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return null
  return args[i + 1] ?? null
}

function hasFlag(flag) {
  return args.includes(flag)
}

const inputPath = getFlag('--input')
const outputPath = getFlag('--output')
const quiet = hasFlag('--quiet')

if (!inputPath) {
  process.stderr.write('Usage: drift-export-csv.mjs --input <result.json> [--output <out.csv>] [--quiet]\n')
  process.exit(1)
}

let raw
try {
  raw = fs.readFileSync(inputPath, 'utf8')
} catch (err) {
  process.stderr.write(`Error reading ${inputPath}: ${err.message}\n`)
  process.exit(1)
}

let drift
try {
  drift = JSON.parse(raw)
} catch (err) {
  process.stderr.write(`Error parsing JSON from ${inputPath}: ${err.message}\n`)
  process.exit(1)
}

// CSV helpers
function escapeCsv(val) {
  const str = val == null ? '' : String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

function csvRow(kind, id, name, change) {
  return [escapeCsv(kind), escapeCsv(id), escapeCsv(name), escapeCsv(change)].join(',')
}

const lines = []
lines.push('kind,id,name,change')

// Support both drift-check.mjs --json output format ({ report: { addedBlocks, ... } })
// and a plain DriftReport object.
const report = drift.report ?? drift

const addedBlocks = report.addedBlocks ?? []
const removedBlocks = report.removedBlocks ?? []
const changedBlocks = report.changedBlocks ?? []
const addedContainers = report.addedContainers ?? []
const removedContainers = report.removedContainers ?? []
const addedEdges = report.addedEdges ?? []
const removedEdges = report.removedEdges ?? []

for (const b of addedBlocks) {
  lines.push(csvRow('block', b.id ?? '', b.name ?? '', 'added'))
}
for (const b of removedBlocks) {
  lines.push(csvRow('block', b.id ?? '', b.name ?? '', 'removed'))
}
for (const b of changedBlocks) {
  lines.push(csvRow('block', b.id ?? '', b.name ?? '', 'changed'))
}
for (const c of addedContainers) {
  lines.push(csvRow('container', c.id ?? '', c.name ?? '', 'added'))
}
for (const c of removedContainers) {
  lines.push(csvRow('container', c.id ?? '', c.name ?? '', 'removed'))
}
for (const e of addedEdges) {
  lines.push(csvRow('edge', `${e.from ?? ''}->${e.to ?? ''}`, '', 'added'))
}
for (const e of removedEdges) {
  lines.push(csvRow('edge', `${e.from ?? ''}->${e.to ?? ''}`, '', 'removed'))
}

const csv = lines.join('\n') + '\n'

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  fs.writeFileSync(outputPath, csv, 'utf8')
}

if (!quiet) {
  process.stdout.write(csv)
}
