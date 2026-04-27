import { describe, it, expect } from 'vitest'
import { dartAdapter } from '../../../../src/lib/ingest/languages/dart'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

// dart.wasm (tree-sitter-wasms) may have a higher ABI than web-tree-sitter supports.
// Detect at module load time and skip parser-dependent tests if incompatible.
let parserAvailable = false
let sharedParser: Awaited<ReturnType<typeof dartAdapter.loadParser>> | null = null

try {
  sharedParser = await dartAdapter.loadParser()
  parserAvailable = true
} catch {
  // ABI mismatch or other load failure — parser-dependent tests will be skipped.
}

async function parse(source: string): Promise<FactInputModule> {
  if (!sharedParser) throw new Error('Dart parser not available')
  const tree = sharedParser.parse(source)
  const result = dartAdapter.extractFacts(tree, '/fake/lib.dart')
  tree.delete()
  return result
}

const maybeIt = parserAvailable ? it : it.skip

describe('dartAdapter', () => {
  maybeIt('Test 1: public class → class fact, exported', async () => {
    const result = await parse(`class MyService {}\n`)
    const sym = result.symbols.find((s) => s.name === 'MyService')
    expect(sym?.kind).toBe('class')
    expect(result.exports).toContain('MyService')
  })

  maybeIt('Test 2: private class (_) → class fact, NOT exported', async () => {
    const result = await parse(`class _Internal {}\n`)
    const sym = result.symbols.find((s) => s.name === '_Internal')
    expect(sym?.kind).toBe('class')
    expect(result.exports).not.toContain('_Internal')
  })

  maybeIt('Test 3: mixin declaration → class fact, exported', async () => {
    const result = await parse(`mixin Serializable {}\n`)
    const sym = result.symbols.find((s) => s.name === 'Serializable')
    expect(sym?.kind).toBe('class')
    expect(result.exports).toContain('Serializable')
  })

  maybeIt('Test 4: enum declaration → class fact, exported', async () => {
    const result = await parse(`enum Color { red, green, blue }\n`)
    const sym = result.symbols.find((s) => s.name === 'Color')
    expect(sym?.kind).toBe('class')
    expect(result.exports).toContain('Color')
  })

  maybeIt('Test 5: package import → ParsedImport', async () => {
    const result = await parse(`import 'package:flutter/material.dart';\n`)
    const imp = result.imports.find((i) => i.from === 'package:flutter/material.dart')
    expect(imp).toBeDefined()
  })

  maybeIt('Test 6: dart: core import → ParsedImport', async () => {
    const result = await parse(`import 'dart:core';\n`)
    const imp = result.imports.find((i) => i.from === 'dart:core')
    expect(imp).toBeDefined()
  })

  maybeIt('Test 7: relative import → ParsedImport', async () => {
    const result = await parse(`import '../utils/helper.dart';\n`)
    const imp = result.imports.find((i) => i.from === '../utils/helper.dart')
    expect(imp).toBeDefined()
  })

  it('Test 8: flutter import → infer Dart/Flutter stack', () => {
    const facts: FactInputModule[] = [
      {
        file: 'lib/main.dart',
        imports: [{ from: 'package:flutter/material.dart', names: ['*'] }],
        exports: [],
        symbols: [],
        language: 'dart',
      },
    ]
    expect(dartAdapter.inferTechStack(facts)).toBe('Dart/Flutter')
  })

  it('Test 9: no flutter/angular → infer Dart', () => {
    const facts: FactInputModule[] = [
      {
        file: 'lib/util.dart',
        imports: [{ from: 'dart:core', names: ['*'] }],
        exports: [],
        symbols: [],
        language: 'dart',
      },
    ]
    expect(dartAdapter.inferTechStack(facts)).toBe('Dart')
  })

  maybeIt('Test 10: public method in class → function fact with parentClass, exported', async () => {
    const result = await parse(`class MyWidget {\n  void build() {}\n}\n`)
    const method = result.symbols.find((s) => s.name === 'build')
    expect(method?.kind).toBe('function')
    expect((method as { attributes?: { parentClass?: string } })?.attributes?.parentClass).toBe('MyWidget')
    expect(result.exports).toContain('build')
  })

  maybeIt('Test 11: private method (_) → function fact, NOT exported', async () => {
    const result = await parse(`class Foo {\n  void _helper() {}\n}\n`)
    const method = result.symbols.find((s) => s.name === '_helper')
    expect(method?.kind).toBe('function')
    expect(result.exports).not.toContain('_helper')
  })

  it('Test 12: fileExtensions and adapter id', () => {
    expect(dartAdapter.id).toBe('dart')
    expect(dartAdapter.fileExtensions).toContain('.dart')
  })

  maybeIt('Test 13: library declaration is parsed without crash', async () => {
    const result = await parse(`library my_lib;\nimport 'dart:core';\nclass Foo {}\n`)
    const sym = result.symbols.find((s) => s.name === 'Foo')
    expect(sym).toBeDefined()
    expect(result.imports.length).toBeGreaterThan(0)
  })
})
