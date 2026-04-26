import { describe, it, expect } from 'vitest'
import { planSplit } from '@/lib/modify/split'
import { makeTmpProject } from '@/lib/modify/test-fixtures'
import { applyRenamePlan } from '@/lib/modify/apply'
import { promises as fs } from 'node:fs'
import path from 'node:path'

describe('planSplit', () => {
  it('Test 1: 2-way split of a function produces 2 helpers + call sites', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/main.ts':
        `function run(): void {\n  console.log("a")\n  console.log("b")\n  console.log("c")\n  console.log("d")\n  console.log("e")\n}\n`,
    })
    try {
      const plan = await planSplit(projectRoot, {
        filePath: 'src/main.ts',
        splits: [
          { startLine: 2, endLine: 3, newFunctionName: 'logAB' },
          { startLine: 5, endLine: 6, newFunctionName: 'logDE' },
        ],
      })
      expect(plan.conflicts).toEqual([])
      expect(plan.fileEdits).toHaveLength(1)
      // Each extract emits 2 edits (replace + insert), so 2 splits = 4 edits.
      expect(plan.fileEdits[0].edits.length).toBeGreaterThanOrEqual(4)

      await applyRenamePlan(projectRoot, plan)
      const final = await fs.readFile(path.join(projectRoot, 'src/main.ts'), 'utf8')
      expect(final).toContain('function logAB(')
      expect(final).toContain('function logDE(')
      expect(final).toContain('logAB()')
      expect(final).toContain('logDE()')
    } finally {
      await cleanup()
    }
  })

  it('Test 2: empty splits array rejected', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts': 'function f(){}\n',
    })
    try {
      const plan = await planSplit(projectRoot, { filePath: 'src/x.ts', splits: [] })
      expect(plan.conflicts.find((c) => c.message.includes('at least 1'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 3: overlapping ranges rejected', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts': 'function f(): void {\n  a()\n  b()\n  c()\n}\n',
    })
    try {
      const plan = await planSplit(projectRoot, {
        filePath: 'src/x.ts',
        splits: [
          { startLine: 2, endLine: 3, newFunctionName: 'h1' },
          { startLine: 3, endLine: 4, newFunctionName: 'h2' },
        ],
      })
      expect(plan.conflicts.find((c) => c.message.includes('overlap'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 4: duplicate newFunctionName rejected', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts': 'function f(): void {\n  a()\n  b()\n}\n',
    })
    try {
      const plan = await planSplit(projectRoot, {
        filePath: 'src/x.ts',
        splits: [
          { startLine: 2, endLine: 2, newFunctionName: 'helper' },
          { startLine: 3, endLine: 3, newFunctionName: 'helper' },
        ],
      })
      expect(plan.conflicts.find((c) => c.message.includes('duplicate'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 5: forwards a sub-extract conflict (e.g. invalid identifier)', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts': 'function f(): void {\n  a()\n  b()\n}\n',
    })
    try {
      const plan = await planSplit(projectRoot, {
        filePath: 'src/x.ts',
        splits: [{ startLine: 2, endLine: 2, newFunctionName: 'not valid' }],
      })
      expect(plan.conflicts.find((c) => c.message.includes('not valid'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })
})
