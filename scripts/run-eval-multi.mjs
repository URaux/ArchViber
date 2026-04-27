/**
 * run-eval-multi.mjs — parallel multi-model live eval.
 *
 * Runs the same fixture set against MULTIPLE configured models in parallel
 * and emits a side-by-side comparison snapshot.
 *
 * Required env:
 *   VIBE_LLM_API_BASE   OpenAI-compatible endpoint base (e.g. https://api.openai.com/v1)
 *   VIBE_LLM_API_KEY    bearer token
 *
 * Model selection (pick one):
 *   VIBE_LLM_MODELS     comma-separated list, e.g. "gpt-4o-mini,gpt-4o"
 *   VIBE_LLM_MODEL      single model (backward compat; used when VIBE_LLM_MODELS unset)
 *
 * Optional:
 *   EVAL_MULTI_OUT      output JSON path (default: eval-multi-results.json)
 *   EVAL_LIVE_FAIL_AT   per-model accuracy below which to exit 1 (default: 0.8)
 *   EVAL_LIVE_TIMEOUT   per-call timeout ms (default: 15000)
 *
 * Always writes the JSON snapshot. Exits 1 only when any model accuracy <
 * EVAL_LIVE_FAIL_AT and --enforce is passed.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jiti from '../node_modules/jiti/lib/jiti.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const apiBase = process.env.VIBE_LLM_API_BASE
const apiKey = process.env.VIBE_LLM_API_KEY

if (!apiBase || !apiKey) {
  console.error('[eval-multi] missing required env (VIBE_LLM_API_BASE, VIBE_LLM_API_KEY)')
  process.exit(1)
}

// Parse model list — VIBE_LLM_MODELS takes precedence; fall back to VIBE_LLM_MODEL.
function parseModels() {
  const multi = process.env.VIBE_LLM_MODELS
  if (multi !== undefined && multi !== null) {
    const parsed = multi.split(',').map((m) => m.trim()).filter(Boolean)
    if (parsed.length > 0) return parsed
  }
  const single = process.env.VIBE_LLM_MODEL
  if (single && single.trim()) return [single.trim()]
  return []
}

const models = parseModels()
if (models.length === 0) {
  console.error('[eval-multi] no models configured — set VIBE_LLM_MODELS or VIBE_LLM_MODEL')
  process.exit(1)
}

const outPath = process.env.EVAL_MULTI_OUT ?? path.join(repoRoot, 'eval-multi-results.json')
const failAt = Number(process.env.EVAL_LIVE_FAIL_AT ?? '0.8')
const timeoutMs = Number(process.env.EVAL_LIVE_TIMEOUT ?? '15000')
const enforce = process.argv.includes('--enforce')

const require = jiti(__filename, {
  alias: { '@': path.join(repoRoot, 'src') },
  interopDefault: true,
})

const { loadFixtures } = require(path.join(repoRoot, 'tests/eval/orchestrator/load-fixtures.ts'))
const { INTENTS } = require(path.join(repoRoot, 'src/lib/orchestrator/types.ts'))

const SYSTEM_PROMPT = [
  'You are an intent classifier for ArchViber.',
  'Choose exactly one intent from: design_edit, build, modify, deep_analyze, explain.',
  'Return ONLY minified JSON with keys intent, confidence, rationale.',
  'confidence must be a number from 0 to 1.',
  'rationale must be 15 words or fewer.',
  'No markdown, no code fences, no extra text.',
].join(' ')

/** Classify a single fixture against a single model. */
async function classifyOne(fixture, model) {
  const userPrompt = JSON.stringify({
    task: 'Classify the user request into one ArchViber intent.',
    userPrompt: fixture.userPrompt,
    irSummary: fixture.irSummary ?? null,
    allowedIntents: INTENTS,
    outputFormat: { intent: 'one allowed intent', confidence: 'number 0..1', rationale: '<=15 words' },
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = await res.json()
    const content = body?.choices?.[0]?.message?.content ?? ''
    const m = /\{[\s\S]*\}/.exec(content)
    if (!m) return { ok: false, error: 'no JSON in response', raw: content }
    let parsed
    try { parsed = JSON.parse(m[0]) } catch { return { ok: false, error: 'JSON parse fail', raw: content } }
    if (!INTENTS.includes(parsed.intent)) return { ok: false, error: `invalid intent: ${parsed.intent}`, raw: content }
    return { ok: true, intent: parsed.intent, confidence: parsed.confidence ?? 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/** Run all fixtures against a single model; returns per-fixture results + accuracy stats. */
async function evalModel(model, fixtures) {
  const perFixture = []
  let pass = 0

  await Promise.all(
    fixtures.map(async (f, idx) => {
      const result = await classifyOne(f, model)
      const matched = result.ok && result.intent === f.expectedIntent
      perFixture[idx] = {
        id: f.id,
        expected: f.expectedIntent,
        actual: result.ok ? result.intent : null,
        confidence: result.ok ? result.confidence : null,
        pass: matched,
        error: result.ok ? undefined : result.error,
      }
      if (matched) pass++
    })
  )

  const accuracy = fixtures.length === 0 ? 0 : pass / fixtures.length

  const byIntent = {}
  for (const i of INTENTS) byIntent[i] = { total: 0, pass: 0 }
  for (let i = 0; i < fixtures.length; i++) {
    const intent = fixtures[i].expectedIntent
    byIntent[intent].total++
    if (perFixture[i].pass) byIntent[intent].pass++
  }

  return { model, pass, total: fixtures.length, accuracy, byIntent, perFixture }
}

async function main() {
  console.log(`[eval-multi] models=[${models.join(', ')}] failAt=${failAt} enforce=${enforce}`)
  const fixtures = loadFixtures()
  console.log(`[eval-multi] loaded ${fixtures.length} fixtures`)

  // Run all models in parallel.
  const modelResults = await Promise.all(models.map((m) => evalModel(m, fixtures)))

  // Build side-by-side per-fixture comparison keyed by fixture id.
  const fixtureMap = {}
  for (const f of fixtures) {
    fixtureMap[f.id] = { id: f.id, expected: f.expectedIntent, models: {} }
  }
  for (const mr of modelResults) {
    for (const fr of mr.perFixture) {
      fixtureMap[fr.id].models[mr.model] = {
        actual: fr.actual,
        confidence: fr.confidence,
        pass: fr.pass,
        error: fr.error,
      }
    }
  }

  const comparison = Object.values(fixtureMap)

  // Per-model summary rows for console output.
  for (const mr of modelResults) {
    console.log(
      `[eval-multi] ${mr.model}: accuracy=${(mr.accuracy * 100).toFixed(1)}% (${mr.pass}/${mr.total})`
    )
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    apiBase,
    models,
    fixtureCount: fixtures.length,
    perModel: modelResults.map(({ model, pass, total, accuracy, byIntent }) => ({
      model,
      pass,
      total,
      accuracy,
      byIntent,
    })),
    comparison,
  }

  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8')
  console.log(`[eval-multi] snapshot written → ${outPath}`)

  if (enforce) {
    const failing = modelResults.filter((mr) => mr.accuracy < failAt)
    if (failing.length > 0) {
      for (const mr of failing) {
        console.error(
          `[eval-multi] ${mr.model} accuracy ${mr.accuracy.toFixed(2)} < failAt ${failAt}`
        )
      }
      console.error('[eval-multi] --enforce: exiting 1')
      process.exit(1)
    }
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('[eval-multi] fatal:', err)
  process.exit(1)
})
