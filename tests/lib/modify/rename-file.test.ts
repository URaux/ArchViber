import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { planRenameFile, applyRenamePlanWithMoves } from '@/lib/modify/rename-file'
import { makeTmpProject } from '@/lib/modify/test-fixtures'

describe('planRenameFile', () => {
  it('Test 1: happy path — updates importer specifiers, emits fileMove edit', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/utils.ts': `export function greet(): string { return 'hi' }\n`,
      'src/main.ts': `import { greet } from './utils'\ngreet()\n`,
    })

    try {
      const plan = await planRenameFile(projectRoot, {
        fromPath: 'src/utils.ts',
        toPath: 'src/helpers.ts',
      })

      expect(plan.conflicts).toHaveLength(0)
      expect(plan.fileMoveEdits).toHaveLength(1)
      expect(plan.fileMoveEdits[0].kind).toBe('fileMove')
      expect(plan.fileMoveEdits[0].content).toContain('greet')

      // main.ts import should be rewritten
      expect(plan.fileEdits).toHaveLength(1)
      expect(plan.fileEdits[0].filePath).toContain('main.ts')
      const edit = plan.fileEdits[0].edits[0]
      expect(edit.replacement).toMatch(/helpers/)
    } finally {
      await cleanup()
    }
  })

  it('Test 2: fromPath does not exist → conflict not-found', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
    })

    try {
      const plan = await planRenameFile(projectRoot, {
        fromPath: 'src/missing.ts',
        toPath: 'src/other.ts',
      })

      expect(plan.conflicts).toHaveLength(1)
      expect(plan.conflicts[0].kind).toBe('not-found')
      expect(plan.conflicts[0].message).toMatch(/missing\.ts/)
    } finally {
      await cleanup()
    }
  })

  it('Test 3: toPath already exists → conflict collision', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
      'src/a.ts': `export const a = 1\n`,
      'src/b.ts': `export const b = 2\n`,
    })

    try {
      const plan = await planRenameFile(projectRoot, {
        fromPath: 'src/a.ts',
        toPath: 'src/b.ts',
      })

      expect(plan.conflicts).toHaveLength(1)
      expect(plan.conflicts[0].kind).toBe('collision')
    } finally {
      await cleanup()
    }
  })

  it('Test 4: fromPath outside projectRoot → conflict not-found', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
    })

    try {
      const plan = await planRenameFile(projectRoot, {
        fromPath: '../../etc/passwd',
        toPath: 'src/safe.ts',
      })

      expect(plan.conflicts).toHaveLength(1)
      expect(plan.conflicts[0].message).toMatch(/outside projectRoot/)
    } finally {
      await cleanup()
    }
  })

  it('Test 5: no importers — zero fileEdits, one fileMoveEdit', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/standalone.ts': `export const x = 42\n`,
    })

    try {
      const plan = await planRenameFile(projectRoot, {
        fromPath: 'src/standalone.ts',
        toPath: 'src/moved.ts',
      })

      expect(plan.conflicts).toHaveLength(0)
      expect(plan.fileEdits).toHaveLength(0)
      expect(plan.fileMoveEdits).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  it('Test 6: multiple importers — all import specifiers updated', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/shared.ts': `export const VAL = 'shared'\n`,
      'src/a.ts': `import { VAL } from './shared'\nconsole.log(VAL)\n`,
      'src/b.ts': `import { VAL } from './shared'\nconsole.log(VAL)\n`,
    })

    try {
      const plan = await planRenameFile(projectRoot, {
        fromPath: 'src/shared.ts',
        toPath: 'src/common.ts',
      })

      expect(plan.conflicts).toHaveLength(0)
      expect(plan.fileEdits).toHaveLength(2)

      for (const fe of plan.fileEdits) {
        expect(fe.edits[0].replacement).toMatch(/common/)
      }
    } finally {
      await cleanup()
    }
  })
})

describe('applyRenamePlanWithMoves', () => {
  it('Test 7: applies import rewrites and renames file on disk', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/utils.ts': `export function greet(): string { return 'hi' }\n`,
      'src/main.ts': `import { greet } from './utils'\ngreet()\n`,
    })

    try {
      const absFrom = path.join(projectRoot, 'src/utils.ts')
      const absTo = path.join(projectRoot, 'src/helpers.ts')

      const plan = await planRenameFile(projectRoot, {
        fromPath: 'src/utils.ts',
        toPath: 'src/helpers.ts',
      })

      expect(plan.conflicts).toHaveLength(0)

      await applyRenamePlanWithMoves(plan)

      // utils.ts gone, helpers.ts exists
      await expect(fs.access(absFrom)).rejects.toThrow()
      await expect(fs.access(absTo)).resolves.toBeUndefined()

      // main.ts import updated
      const mainContent = await fs.readFile(path.join(projectRoot, 'src/main.ts'), 'utf8')
      expect(mainContent).toContain('./helpers')
      expect(mainContent).not.toContain('./utils')
    } finally {
      await cleanup()
    }
  })
})
