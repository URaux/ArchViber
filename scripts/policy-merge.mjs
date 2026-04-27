/**
 * policy-merge.mjs — phase3/policy-merge-cli
 *
 * Merges 2+ policy.yaml files into one:
 *   - Numeric thresholds: MIN of all values (most strict wins)
 *   - Boolean fail* flags: OR (any true wins)
 *   - Ignore ID lists: UNION (concat + dedup)
 *
 * Usage:
 *   node scripts/policy-merge.mjs --in a.yaml --in b.yaml --out merged.yaml
 *
 * All inputs and the result are validated via policySchema. Exits 1 on
 * validation failure or argument errors.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import jiti from '../node_modules/jiti/lib/jiti.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const jitiLoader = jiti(__filename, { interopDefault: true, esmResolve: true })
const { policySchema } = jitiLoader(path.join(__dirname, '../src/lib/policy/schema.ts'))

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const inputs = []
let outputPath = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--in' && args[i + 1]) {
    inputs.push(args[++i])
  } else if (args[i] === '--out' && args[i + 1]) {
    outputPath = args[++i]
  }
}

if (inputs.length < 2) {
  console.error('policy-merge: need at least 2 --in files')
  process.exit(1)
}
if (!outputPath) {
  console.error('policy-merge: --out is required')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Load + validate each input
// ---------------------------------------------------------------------------

function loadAndValidate(filePath) {
  let text
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    console.error(`policy-merge: cannot read ${filePath}: ${err.message}`)
    process.exit(1)
  }
  let raw
  try {
    raw = parseYaml(text)
  } catch (err) {
    console.error(`policy-merge: ${filePath} is not valid YAML: ${err.message}`)
    process.exit(1)
  }
  const result = policySchema.safeParse(raw ?? {})
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    console.error(`policy-merge: ${filePath} schema validation failed: ${issues}`)
    process.exit(1)
  }
  return result.data
}

const policies = inputs.map(loadAndValidate)

// ---------------------------------------------------------------------------
// Merge rules
// ---------------------------------------------------------------------------

/** MIN across all defined numeric values; undefined if none define it */
function mergeNumeric(key) {
  const vals = policies.map((p) => p.drift[key]).filter((v) => v !== undefined)
  if (vals.length === 0) return undefined
  return Math.min(...vals)
}

/** OR: true if any policy is true */
function mergeBoolean(key) {
  return policies.some((p) => p.drift[key] === true)
}

/** UNION of string arrays, preserving order, deduplicating */
function mergeList(key) {
  const seen = new Set()
  const out = []
  for (const p of policies) {
    for (const id of p.drift[key] ?? []) {
      if (!seen.has(id)) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

const mergedDrift = {
  failOnRemoved: mergeBoolean('failOnRemoved'),
  failOnAdded: mergeBoolean('failOnAdded'),
  failOnChanged: mergeBoolean('failOnChanged'),
  failOnRemovedContainers: mergeBoolean('failOnRemovedContainers'),
  failOnRemovedEdges: mergeBoolean('failOnRemovedEdges'),
  ignoreBlockIds: mergeList('ignoreBlockIds'),
  ignoreContainerIds: mergeList('ignoreContainerIds'),
  ignoreEdgeIds: mergeList('ignoreEdgeIds'),
}

const maxAdded = mergeNumeric('maxAddedBlocks')
if (maxAdded !== undefined) mergedDrift.maxAddedBlocks = maxAdded
const maxRemoved = mergeNumeric('maxRemovedBlocks')
if (maxRemoved !== undefined) mergedDrift.maxRemovedBlocks = maxRemoved
const maxChanged = mergeNumeric('maxChangedBlocks')
if (maxChanged !== undefined) mergedDrift.maxChangedBlocks = maxChanged

const merged = { drift: mergedDrift }

// ---------------------------------------------------------------------------
// Validate result
// ---------------------------------------------------------------------------

const check = policySchema.safeParse(merged)
if (!check.success) {
  const issues = check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  console.error(`policy-merge: merged result failed schema validation: ${issues}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

const outDir = path.dirname(outputPath)
if (outDir && outDir !== '.') fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outputPath, stringifyYaml(check.data), 'utf8')
console.log(`policy-merge: wrote ${outputPath}`)
