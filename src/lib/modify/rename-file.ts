import { Project } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { FileEdit, RenamePlan } from './rename'

export interface FileMoveEdit {
  kind: 'fileMove'
  fromPath: string
  toPath: string
  content: string
}

export interface RenameFilePlan {
  fileEdits: FileEdit[]
  fileMoveEdits: FileMoveEdit[]
  conflicts: RenamePlan['conflicts']
  safetyChecks: {
    tsConfigFound: boolean
    allFilesInProject: boolean
  }
}

export async function planRenameFile(
  projectRoot: string,
  { fromPath, toPath }: { fromPath: string; toPath: string }
): Promise<RenameFilePlan> {
  const absFrom = path.resolve(projectRoot, fromPath)
  const absTo = path.resolve(projectRoot, toPath)
  const absRoot = path.resolve(projectRoot)

  if (!absFrom.startsWith(absRoot + path.sep) && absFrom !== absRoot) {
    return {
      fileEdits: [],
      fileMoveEdits: [],
      conflicts: [{ kind: 'not-found', message: `fromPath is outside projectRoot` }],
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  if (!absTo.startsWith(absRoot + path.sep) && absTo !== absRoot) {
    return {
      fileEdits: [],
      fileMoveEdits: [],
      conflicts: [{ kind: 'not-found', message: `toPath is outside projectRoot` }],
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  try {
    await fs.access(absFrom)
  } catch {
    return {
      fileEdits: [],
      fileMoveEdits: [],
      conflicts: [{ kind: 'not-found', message: `fromPath does not exist: ${fromPath}` }],
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  try {
    await fs.access(absTo)
    return {
      fileEdits: [],
      fileMoveEdits: [],
      conflicts: [{ kind: 'collision', message: `toPath already exists: ${toPath}` }],
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  } catch {
    // good — toPath must not exist
  }

  const tsConfigPath = path.join(absRoot, 'tsconfig.json')
  let tsConfigFound = false
  try {
    await fs.access(tsConfigPath)
    tsConfigFound = true
  } catch {
    // no tsconfig
  }

  const project = tsConfigFound
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { allowJs: true } })

  if (!tsConfigFound) {
    project.addSourceFilesAtPaths(path.join(absRoot, '**/*.{ts,tsx,js,jsx}'))
  }

  const sourceFiles = project.getSourceFiles()
  const allFilesInProject = sourceFiles.length > 0

  const movedSf = project.getSourceFile(absFrom)

  // Compute the new relative specifier an importer should use after the move.
  // importerPath: absolute path of the file that has the import
  // returns a POSIX-style relative specifier without extension
  function newSpecifier(importerPath: string): string {
    const rel = path.relative(path.dirname(importerPath), absTo)
    const noExt = rel.replace(/\.(ts|tsx|js|jsx)$/, '')
    const posix = noExt.split(path.sep).join('/')
    return posix.startsWith('.') ? posix : './' + posix
  }

  const fileEditsMap = new Map<string, FileEdit['edits']>()

  if (movedSf) {
    const referencingFiles = sourceFiles.filter((sf) => sf.getFilePath() !== absFrom)

    for (const sf of referencingFiles) {
      const sfPath = sf.getFilePath() as string
      if (sfPath.includes('node_modules')) continue

      const importDecls = sf.getImportDeclarations()
      for (const importDecl of importDecls) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue()
        // Resolve what the specifier points to from this file's directory
        const resolvedFromImporter = path.resolve(
          path.dirname(sfPath),
          moduleSpecifier
        )
        // Match with or without extension
        const resolvedNoExt = resolvedFromImporter.replace(/\.(ts|tsx|js|jsx)$/, '')
        const absFromNoExt = absFrom.replace(/\.(ts|tsx|js|jsx)$/, '')

        if (resolvedNoExt !== absFromNoExt) continue

        const specifierNode = importDecl.getModuleSpecifier()
        // The literal includes quotes — get inner span
        const start = specifierNode.getStart() + 1
        const end = specifierNode.getEnd() - 1
        const replacement = newSpecifier(sfPath)

        if (!fileEditsMap.has(sfPath)) fileEditsMap.set(sfPath, [])
        fileEditsMap.get(sfPath)!.push({
          start,
          end,
          original: moduleSpecifier,
          replacement,
        })
      }
    }
  }

  const fileEdits: FileEdit[] = []
  for (const [filePath, edits] of fileEditsMap.entries()) {
    fileEdits.push({ filePath, edits })
  }

  const originalContent = await fs.readFile(absFrom, 'utf8')

  const fileMoveEdits: FileMoveEdit[] = [
    { kind: 'fileMove', fromPath: absFrom, toPath: absTo, content: originalContent },
  ]

  return {
    fileEdits,
    fileMoveEdits,
    conflicts: [],
    safetyChecks: { tsConfigFound, allFilesInProject },
  }
}

export async function applyRenamePlanWithMoves(
  plan: RenameFilePlan
): Promise<void> {
  // Apply in-file import specifier rewrites first
  for (const fileEdit of plan.fileEdits) {
    const content = await fs.readFile(fileEdit.filePath, 'utf8')
    const sortedEdits = [...fileEdit.edits].sort((a, b) => b.start - a.start)

    let result = content
    for (const edit of sortedEdits) {
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
    }

    await fs.writeFile(fileEdit.filePath, result, 'utf8')
  }

  // Apply file moves
  for (const moveEdit of plan.fileMoveEdits) {
    await fs.mkdir(path.dirname(moveEdit.toPath), { recursive: true })
    await fs.rename(moveEdit.fromPath, moveEdit.toPath)
  }
}
