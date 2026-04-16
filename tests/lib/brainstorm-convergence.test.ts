import { describe, expect, it } from 'vitest'
import { buildSystemContext } from '@/lib/context-engine'

type Locale = 'en' | 'zh'

function buildBrainstormContext(
  locale: Locale,
  brainstormRound?: number,
  sessionPhase: 'brainstorm' | 'design' = 'brainstorm'
) {
  return buildSystemContext({
    agentType: 'canvas',
    task: 'discuss',
    locale,
    sessionPhase,
    brainstormRound,
  })
}

/**
 * v2 brainstorm prompt: 3 batches (WHAT / HOW / DEPS) + convergence, max 4
 * rounds. Option cards as `json:user-choice` fenced blocks. Control comments
 * use batch=N/3 round=N/4 mode=novice|expert.
 */
describe('buildSystemContext brainstorm (v2 protocol)', () => {
  it('round 1 starts with Batch 1 · WHAT and mode-switch card', () => {
    const context = buildBrainstormContext('en', 1)

    expect(context).toContain('Brainstorm Phase (v2 Protocol)')
    expect(context).toContain('This is round 1.')
    expect(context).toContain('Batch 1 · WHAT')
    expect(context).toContain('json:user-choice')
    // v1 relics must be gone
    expect(context).not.toContain('6 dimensions')
    expect(context).not.toContain('1 question per turn')
    expect(context).not.toContain('dimensions_covered')
    // canvas-action is still prohibited
    expect(context).toContain('Do NOT emit any ```json:canvas-action')
    expect(context).not.toContain('Put ALL ```json:canvas-action blocks FIRST')
  })

  it('round 2 targets Batch 2 · HOW', () => {
    const context = buildBrainstormContext('en', 2)

    expect(context).toContain('This is round 2.')
    expect(context).toContain('Batch 2 · HOW')
    expect(context).toContain('derived from batch-1 answers')
  })

  it('round 3 targets Batch 3 · DEPS', () => {
    const context = buildBrainstormContext('en', 3)

    expect(context).toContain('This is round 3.')
    expect(context).toContain('Batch 3 · DEPS')
  })

  it('round 4 forbids option cards and triggers convergence', () => {
    const context = buildBrainstormContext('en', 4)

    expect(context).toContain('This is round 4 (convergence)')
    expect(context).toMatch(/Do NOT emit any `{0,3}json:user-choice/i)
    expect(context).toContain('Start Designing')
    expect(context).toContain('batch=3/3 round=4/4')
  })

  it('rounds beyond the limit keep convergence behavior', () => {
    const context = buildBrainstormContext('en', 7)

    expect(context).toContain('This is round 7 (convergence)')
    expect(context).toMatch(/Do NOT emit any `{0,3}json:user-choice/i)
    expect(context).toContain('Start Designing')
  })

  it('undefined brainstormRound behaves like round 1', () => {
    const context = buildBrainstormContext('en')

    expect(context).toContain('This is round 1.')
    expect(context).toContain('Batch 1 · WHAT')
  })

  it('design phase uses canvas-action instructions instead of brainstorm prompt', () => {
    const context = buildBrainstormContext('en', 1, 'design')

    expect(context).not.toContain('Brainstorm Phase (v2 Protocol)')
    expect(context).toContain('```json:canvas-action')
    expect(context).toContain('Put ALL ```json:canvas-action blocks FIRST')
  })

  it('zh locale emits a Chinese-language body with identical control syntax', () => {
    const zhContext = buildBrainstormContext('zh', 1)
    const enContext = buildBrainstormContext('en', 1)

    expect(enContext).toContain('This is round 1.')
    expect(zhContext).not.toContain('This is round 1.')
    expect(zhContext).toMatch(/[\u4e00-\u9fff]/)
    expect(zhContext).toMatch(/需求讨论阶段|协议总览|批次结构/u)

    // Control-comment syntax is language-neutral — both locales document it.
    for (const ctx of [zhContext, enContext]) {
      expect(ctx).toContain('batch=N/3 round=N/4 mode=novice|expert')
      expect(ctx).toContain('json:user-choice')
      expect(ctx).toContain('externalDeps')
      expect(ctx).toContain('decisions')
    }
  })

  it('documents the decisions merge contract (features full set, tech_preferences per-key)', () => {
    const context = buildBrainstormContext('en', 1)

    // features MUST be re-emitted in full — hard rule
    expect(context).toMatch(/features.*FULL final set/i)
    // tech_preferences is per-key merge
    expect(context).toMatch(/tech_preferences.*shallow per-key merge|shallow per-key merge/i)
  })

  it('documents externalDeps event-stream schema (append-only with A/B/C groups)', () => {
    const context = buildBrainstormContext('en', 2)

    expect(context).toContain('append-only')
    expect(context).toContain('data-input')
    expect(context).toContain('human-action')
    expect(context).toContain('approval')
    expect(context).toMatch(/"op":\s*"add"/)
  })

  it('advises the LLM to respect prior-state injection from formatStateForPrompt', () => {
    const context = buildBrainstormContext('en', 2)

    // The brainstorm state prefix (from formatStateForPrompt) uses a Chinese
    // section header regardless of locale. Prompt must tell Claude it's
    // authoritative and not to re-ask.
    expect(context).toContain('本次 brainstorm 已知状态')
    expect(context).toMatch(/Do NOT re-ask|not re-ask|不要重新发卡问/i)
  })
})
