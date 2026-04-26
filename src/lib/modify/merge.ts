/**
 * Merge function — Phase 3 Modify v0.3.
 *
 * Inverse of split/extract: takes a helper function with EXACTLY ONE caller
 * inside the same file and folds the helper body back into the caller at the
 * call site, then removes the helper declaration.
 *
 * Scope (v0.3 — minimum viable):
 *   - Helper must be a top-level `function` declaration (not a method on a class)
 *   - Helper must have ZERO parameters (so no argument-substitution logic)
 *   - Helper must have NO return statement (call sites that consume a return
 *     value would need rewriting; out of scope for v0.3)
 *   - Helper must have EXACTLY ONE call site, in the SAME file. Multi-caller
 *     merge is ambiguous (which call to inline?) — reject.
 *   - The call statement must be a top-level expression statement, not nested
 *     inside an expression (e.g. `helper()` as its own statement, NOT `x = helper()`)
 */

import { Project, SyntaxKind, Node } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { RenamePlan, FileEdit, RenameConflict } from './rename'

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export interface MergeRequest {
  filePath: string
  helperName: string
}

export async function planMerge(
  projectRoot: string,
  req: MergeRequest,
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []

  if (!IDENTIFIER_RE.test(req.helperName)) {
    conflicts.push({ kind: 'reserved', message: `"${req.helperName}" is not a valid identifier` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  const tsConfigPath = path.join(projectRoot, 'tsconfig.json')
  let tsConfigFound = false
  try {
    await fs.access(tsConfigPath)
    tsConfigFound = true
  } catch {
    // none
  }

  const project = tsConfigFound
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { allowJs: true } })
  if (!tsConfigFound) {
    project.addSourceFilesAtPaths(path.join(projectRoot, '**/*.{ts,tsx,js,jsx}'))
  }

  const absPath = path.isAbsolute(req.filePath) ? req.filePath : path.join(projectRoot, req.filePath)
  const sourceFile = project.getSourceFile(absPath) ?? project.addSourceFileAtPathIfExists(absPath)
  if (!sourceFile) {
    conflicts.push({ kind: 'not-found', message: `source file not found: ${req.filePath}` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: false },
    }
  }

  // Find the top-level helper function declaration by name.
  const helperDecl = sourceFile.getFunctions().find((fn) => fn.getName() === req.helperName)
  if (!helperDecl) {
    conflicts.push({
      kind: 'not-found',
      message: `top-level function "${req.helperName}" not found in ${req.filePath}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // v0.3 scope checks: zero parameters, no return statements.
  if (helperDecl.getParameters().length > 0) {
    conflicts.push({
      kind: 'not-found',
      message: `merge v0.3 requires zero parameters; "${req.helperName}" has ${helperDecl.getParameters().length}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  let hasReturn = false
  helperDecl.forEachDescendant((n) => {
    if (hasReturn) return
    if (Node.isReturnStatement(n)) hasReturn = true
  })
  if (hasReturn) {
    conflicts.push({
      kind: 'not-found',
      message: `merge v0.3 does not support helpers with return statements`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Find call sites of the helper.
  const nameNode = helperDecl.getNameNode()
  if (!nameNode) {
    conflicts.push({ kind: 'not-found', message: `helper has no name node (anonymous?)` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  const refs = nameNode.findReferencesAsNodes()
  // Filter to call sites in the same file (exclude the declaration itself).
  const callSites = refs.filter((r) => {
    if (r.getSourceFile() !== sourceFile) return false
    const parent = r.getParent()
    if (!parent || !Node.isCallExpression(parent)) return false
    return parent.getExpression() === r
  })

  if (callSites.length === 0) {
    conflicts.push({
      kind: 'not-found',
      message: `no call sites for "${req.helperName}" in ${req.filePath}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }
  if (callSites.length > 1) {
    conflicts.push({
      kind: 'collision',
      message: `merge v0.3 requires exactly 1 call site; found ${callSites.length} for "${req.helperName}"`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // The single call site. Must be a top-level expression statement so we can
  // replace the whole statement with the helper body.
  const callExpr = callSites[0].getParent()!
  if (!Node.isCallExpression(callExpr)) {
    conflicts.push({ kind: 'not-found', message: 'call site is not a CallExpression' })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  const stmtAncestor = callExpr.getFirstAncestor(
    (n) => Node.isExpressionStatement(n) || Node.isStatement(n),
  )
  if (!stmtAncestor || !Node.isExpressionStatement(stmtAncestor)) {
    conflicts.push({
      kind: 'not-found',
      message: 'merge v0.3 requires the call to be a top-level expression statement (e.g. `helper()` on its own line)',
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Extract helper body text (statements inside the function block, not the braces).
  const body = helperDecl.getBody()
  if (!body || !Node.isBlock(body)) {
    conflicts.push({ kind: 'not-found', message: 'helper has no block body' })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }
  const bodyStmts = body.getStatements()
  if (bodyStmts.length === 0) {
    // Empty helper — just delete the call site and the decl.
  }
  const bodyText =
    bodyStmts.length === 0
      ? ''
      : bodyStmts.map((s) => s.getText()).join('\n')

  // Build edits.
  const edits: FileEdit['edits'] = []
  // 1. Replace the call statement with the helper body, indented to match.
  const stmtStart = stmtAncestor.getStart()
  const stmtEnd = stmtAncestor.getEnd()
  const fullText = sourceFile.getFullText()
  // Determine the indent of the call statement's line.
  const lineStart = fullText.lastIndexOf('\n', stmtStart - 1) + 1
  const indent = fullText.slice(lineStart, stmtStart).match(/^\s*/)?.[0] ?? ''
  const indentedBody = bodyText
    .split('\n')
    .map((line) => (line.length > 0 ? indent + line : line))
    .join('\n')
  edits.push({
    start: stmtStart,
    end: stmtEnd,
    original: stmtAncestor.getText(),
    replacement: indentedBody.trimStart(),
  })

  // 2. Remove the helper function declaration (and any trailing newline).
  const declStart = helperDecl.getStart()
  let declEnd = helperDecl.getEnd()
  // Eat one trailing newline if present, so we don't leave a blank line.
  if (fullText[declEnd] === '\n') declEnd += 1
  edits.push({
    start: declStart,
    end: declEnd,
    original: fullText.slice(declStart, declEnd),
    replacement: '',
  })

  return {
    fileEdits: [{ filePath: sourceFile.getFilePath(), edits }],
    conflicts,
    safetyChecks: { tsConfigFound, allFilesInProject: true },
  }
}
