/**
 * eval-multi.test.ts
 *
 * Unit tests for run-eval-multi.mjs logic, exercised without hitting a real LLM.
 * The script's core functions are extracted / re-implemented inline here so we
 * can inject stub fetch responses.
 *
 * Covered cases:
 *   1. Single-model fallback — VIBE_LLM_MODELS unset, VIBE_LLM_MODEL set
 *   2. Two models compared side-by-side
 *   3. Model-specific failure (one model errors on every fixture)
 *   4. Malformed VIBE_LLM_MODELS (whitespace, empty segments, trailing comma)
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { EvalFixture } from './load-fixtures'
import { INTENTS } from '@/lib/orchestrator/types'
import type { Intent } from '@/lib/orchestrator/types'

// ---- inline subset of script logic to keep tests fast & hermetic ----

interface FixtureResult {
  id: string
  expected: Intent
  actual: string | null
  confidence: number | null
  pass: boolean
  error?: string
}

interface ModelResult {
  model: string
  pass: number
  total: number
  accuracy: number
  byIntent: Record<Intent, { total: number; pass: number }>
  perFixture: FixtureResult[]
}

type ClassifyResponse =
  | { ok: true; intent: string; confidence: number }
  | { ok: false; error: string }

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

async function classifyOne(
  fixture: EvalFixture,
  model: string,
  apiBase: string,
  apiKey: string,
  timeoutMs: number,
  fetchFn: FetchLike,
): Promise<ClassifyResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [], temperature: 0 }),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = await res.json()
    const content: string = body?.choices?.[0]?.message?.content ?? ''
    const m = /\{[\s\S]*\}/.exec(content)
    if (!m) return { ok: false, error: 'no JSON in response' }
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(m[0]) as Record<string, unknown> } catch { return { ok: false, error: 'JSON parse fail' } }
    if (!(INTENTS as readonly string[]).includes(parsed.intent as string)) {
      return { ok: false, error: `invalid intent: ${String(parsed.intent)}` }
    }
    return { ok: true, intent: parsed.intent as string, confidence: (parsed.confidence as number) ?? 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function evalModel(
  model: string,
  fixtures: EvalFixture[],
  apiBase: string,
  apiKey: string,
  timeoutMs: number,
  fetchFn: FetchLike,
): Promise<ModelResult> {
  const perFixture: FixtureResult[] = []
  let pass = 0

  await Promise.all(
    fixtures.map(async (f, idx) => {
      const result = await classifyOne(f, model, apiBase, apiKey, timeoutMs, fetchFn)
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
    }),
  )

  const accuracy = fixtures.length === 0 ? 0 : pass / fixtures.length
  const byIntent = Object.fromEntries(INTENTS.map((i) => [i, { total: 0, pass: 0 }])) as Record<
    Intent,
    { total: number; pass: number }
  >
  for (let i = 0; i < fixtures.length; i++) {
    const intent = fixtures[i].expectedIntent
    byIntent[intent].total++
    if (perFixture[i].pass) byIntent[intent].pass++
  }
  return { model, pass, total: fixtures.length, accuracy, byIntent, perFixture }
}

/** Parse model list the same way the script does. */
function parseModels(env: { VIBE_LLM_MODELS?: string; VIBE_LLM_MODEL?: string }): string[] {
  const multi = env.VIBE_LLM_MODELS
  if (multi !== undefined && multi !== null) {
    const parsed = multi.split(',').map((m) => m.trim()).filter(Boolean)
    if (parsed.length > 0) return parsed
  }
  const single = env.VIBE_LLM_MODEL
  if (single && single.trim()) return [single.trim()]
  return []
}

// ---- test fixtures ----

const FIXTURES: EvalFixture[] = [
  {
    id: 'f1',
    userPrompt: 'explain the system',
    expectedIntent: 'explain',
    irSummary: { topContainers: [{ name: 'UI' }], topEdges: [], blocks: [] } as unknown as EvalFixture['irSummary'],
  },
  {
    id: 'f2',
    userPrompt: 'build new service',
    expectedIntent: 'build',
    irSummary: { topContainers: [], topEdges: [], blocks: [] } as unknown as EvalFixture['irSummary'],
  },
]

function makeOkFetch(intentByFixture: Record<string, string>): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(init.body as string) as { model: string }
    // derive fixture id from the messages if needed — here we always return the canned intent
    // by using a simple counter approach via model name embedded in body
    const model = body.model
    void model
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ intent: 'explain', confidence: 0.9, rationale: 'stub' }) } }] }),
    } as unknown as Response
  }
}

function makeFetchAlwaysOk(intent: string): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ intent, confidence: 0.92, rationale: 'stub' }) } }] }),
  } as unknown as Response)
}

function makeFetchAlwaysError(status = 500): FetchLike {
  return async () => ({
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response)
}

// ---- tests ----

describe('eval-multi / parseModels', () => {
  it('case 4: malformed VIBE_LLM_MODELS — whitespace, empty segments, trailing comma', () => {
    const models = parseModels({ VIBE_LLM_MODELS: '  gpt-4o ,, gpt-4o-mini ,  ' })
    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini'])
  })

  it('case 4: trailing-comma-only VIBE_LLM_MODELS falls back to VIBE_LLM_MODEL', () => {
    const models = parseModels({ VIBE_LLM_MODELS: ',,,', VIBE_LLM_MODEL: 'gpt-4o' })
    expect(models).toEqual(['gpt-4o'])
  })

  it('case 1: VIBE_LLM_MODELS unset → uses VIBE_LLM_MODEL (single-model fallback)', () => {
    const models = parseModels({ VIBE_LLM_MODEL: 'deepseek-chat' })
    expect(models).toEqual(['deepseek-chat'])
  })

  it('returns empty list when both env vars are absent', () => {
    const models = parseModels({})
    expect(models).toEqual([])
  })
})

describe('eval-multi / evalModel', () => {
  const API_BASE = 'https://api.example.com/v1'
  const API_KEY = 'test-key'

  it('case 1: single-model fallback — one model, perfect accuracy on matching fixtures', async () => {
    const fetch = makeFetchAlwaysOk('explain')
    const result = await evalModel('gpt-4o', [FIXTURES[0]], API_BASE, API_KEY, 5000, fetch)
    expect(result.model).toBe('gpt-4o')
    expect(result.pass).toBe(1)
    expect(result.accuracy).toBe(1)
    expect(result.perFixture[0].pass).toBe(true)
  })

  it('case 2: two models compared — different accuracy across models', async () => {
    // model-a always returns 'explain' (passes f1, fails f2)
    // model-b always returns 'build' (fails f1, passes f2)
    const fetchA = makeFetchAlwaysOk('explain')
    const fetchB = makeFetchAlwaysOk('build')

    const [resultA, resultB] = await Promise.all([
      evalModel('model-a', FIXTURES, API_BASE, API_KEY, 5000, fetchA),
      evalModel('model-b', FIXTURES, API_BASE, API_KEY, 5000, fetchB),
    ])

    expect(resultA.pass).toBe(1) // f1=explain correct, f2=build wrong
    expect(resultB.pass).toBe(1) // f1=explain wrong, f2=build correct
    expect(resultA.accuracy).toBeCloseTo(0.5)
    expect(resultB.accuracy).toBeCloseTo(0.5)

    // Side-by-side: fixture f1 should pass for model-a but fail for model-b
    expect(resultA.perFixture.find((r) => r.id === 'f1')?.pass).toBe(true)
    expect(resultB.perFixture.find((r) => r.id === 'f1')?.pass).toBe(false)
  })

  it('case 3: model-specific failure — HTTP 500 yields 0 accuracy + error field on each fixture', async () => {
    const fetchOk = makeFetchAlwaysOk('explain')
    const fetchFail = makeFetchAlwaysError(500)

    const [ok, fail] = await Promise.all([
      evalModel('good-model', [FIXTURES[0]], API_BASE, API_KEY, 5000, fetchOk),
      evalModel('bad-model', FIXTURES, API_BASE, API_KEY, 5000, fetchFail),
    ])

    expect(ok.accuracy).toBe(1)
    expect(fail.accuracy).toBe(0)
    expect(fail.pass).toBe(0)
    for (const fr of fail.perFixture) {
      expect(fr.error).toBeDefined()
      expect(fr.actual).toBeNull()
    }
  })
})

describe('eval-multi / snapshot shape', () => {
  it('comparison map contains per-model entries for each fixture id', async () => {
    const fetchA = makeFetchAlwaysOk('explain')
    const fetchB = makeFetchAlwaysOk('build')
    const modelsToRun = ['model-a', 'model-b']
    const fetches: Record<string, FetchLike> = { 'model-a': fetchA, 'model-b': fetchB }

    const modelResults = await Promise.all(
      modelsToRun.map((m) => evalModel(m, FIXTURES, 'https://x/v1', 'k', 5000, fetches[m])),
    )

    const fixtureMap: Record<string, { id: string; expected: string; models: Record<string, unknown> }> = {}
    for (const f of FIXTURES) fixtureMap[f.id] = { id: f.id, expected: f.expectedIntent, models: {} }
    for (const mr of modelResults) {
      for (const fr of mr.perFixture) {
        fixtureMap[fr.id].models[mr.model] = { actual: fr.actual, pass: fr.pass }
      }
    }

    const comparison = Object.values(fixtureMap)
    expect(comparison).toHaveLength(FIXTURES.length)
    for (const row of comparison) {
      expect(Object.keys(row.models)).toEqual(modelsToRun)
    }
  })
})
