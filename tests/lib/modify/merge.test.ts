import { describe, it, expect } from 'vitest'
import { planMerge } from '@/lib/modify/merge'
import { makeTmpProject } from '@/lib/modify/test-fixtures'
import { applyRenamePlan } from '@/lib/modify/apply'
import { promises as fs } from 'node:fs'
import path from 'node:path'

describe('planMerge', () => {
  it('Test 1: single-caller helper folds back inline', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/main.ts':
        `function logAB(): void {\n  console.log("a")\n  console.log("b")\n}\n\nfunction run(): void {\n  console.log("start")\n  logAB()\n  console.log("end")\n}\n`,
    })
    try {
      const plan = await planMerge(projectRoot, { filePath: 'src/main.ts', helperName: 'logAB' })
      expect(plan.conflicts).toEqual([])
      expect(plan.fileEdits).toHaveLength(1)

      await applyRenamePlan(projectRoot, plan)
      const final = await fs.readFile(path.join(projectRoot, 'src/main.ts'), 'utf8')
      expect(final).not.toContain('function logAB')
      expect(final).not.toContain('logAB()')
      expect(final).toContain('console.log("a")')
      expect(final).toContain('console.log("b")')
    } finally {
      await cleanup()
    }
  })

  it('Test 2: multi-caller rejected', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts':
        `function h(): void { console.log("h") }\nfunction a(): void { h() }\nfunction b(): void { h() }\n`,
    })
    try {
      const plan = await planMerge(projectRoot, { filePath: 'src/x.ts', helperName: 'h' })
      expect(plan.conflicts.find((c) => c.message.includes('exactly 1 call site'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 3: helper with parameters rejected', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts': `function h(x: number): void { console.log(x) }\nfunction r(): void { h(1) }\n`,
    })
    try {
      const plan = await planMerge(projectRoot, { filePath: 'src/x.ts', helperName: 'h' })
      expect(plan.conflicts.find((c) => c.message.includes('zero parameters'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 4: helper with return statement rejected', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts': `function h(): number { return 42 }\nfunction r(): void { h() }\n`,
    })
    try {
      const plan = await planMerge(projectRoot, { filePath: 'src/x.ts', helperName: 'h' })
      expect(plan.conflicts.find((c) => c.message.includes('return statements'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 5: helper not found returns not-found', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts': `function other(): void {}\n`,
    })
    try {
      const plan = await planMerge(projectRoot, { filePath: 'src/x.ts', helperName: 'missing' })
      expect(plan.conflicts.find((c) => c.message.includes('not found'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 6: helper called as part of an expression rejected', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/x.ts':
        `function h(): void { console.log("h") }\nfunction r(): void { const x = [h()]; void x }\n`,
    })
    try {
      const plan = await planMerge(projectRoot, { filePath: 'src/x.ts', helperName: 'h' })
      expect(plan.conflicts.find((c) => c.message.includes('expression statement'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })
})
