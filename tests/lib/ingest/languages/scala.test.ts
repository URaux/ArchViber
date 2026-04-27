import { describe, it, expect } from 'vitest'
import { scalaAdapter } from '../../../../src/lib/ingest/languages/scala'
import type { ScalaParsedSymbol } from '../../../../src/lib/ingest/languages/scala'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string, file = '/fake/Main.scala'): Promise<FactInputModule> {
  const parser = await scalaAdapter.loadParser()
  const tree = parser.parse(source)
  const result = scalaAdapter.extractFacts(tree, file)
  tree.delete()
  return result
}

describe('scalaAdapter', () => {
  it('Test 1: class_definition is exported by default', async () => {
    const src = `package com.example\n\nclass Foo {}\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes.some((c) => c.name === 'Foo')).toBe(true)
    expect(result.exports).toContain('Foo')
  })

  it('Test 2: private class is NOT exported', async () => {
    const src = `private class Hidden {}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('Hidden')
  })

  it('Test 3: object_definition → kind class', async () => {
    const src = `object MySingleton {}\n`
    const result = await parse(src)
    const obj = result.symbols.find((s) => s.name === 'MySingleton')
    expect(obj?.kind).toBe('class')
    expect(result.exports).toContain('MySingleton')
  })

  it('Test 4: trait_definition → kind interface', async () => {
    const src = `trait Describable { def describe(): String }\n`
    const result = await parse(src)
    const t = result.symbols.find((s) => s.name === 'Describable')
    expect(t?.kind).toBe('interface')
    expect(result.exports).toContain('Describable')
  })

  it('Test 5: top-level function_definition → kind function', async () => {
    const src = `def greet(name: String): String = s"Hello, $name"\n`
    const result = await parse(src)
    const fn = result.symbols.find((s) => s.name === 'greet')
    expect(fn?.kind).toBe('function')
    expect(result.exports).toContain('greet')
  })

  it('Test 6: private function is NOT exported', async () => {
    const src = `private def helper(): Unit = {}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('helper')
  })

  it('Test 7: nested function carries parentClass attribute', async () => {
    const src = `class Service {\n  def execute(): Unit = {}\n}\n`
    const result = await parse(src)
    const exec = result.symbols.find((s) => s.name === 'execute') as ScalaParsedSymbol | undefined
    expect(exec).toBeDefined()
    expect(exec?.kind).toBe('function')
    expect(exec?.attributes?.parentClass).toBe('Service')
  })

  it('Test 8: val_definition → kind const', async () => {
    const src = `val MaxRetries = 3\n`
    const result = await parse(src)
    const v = result.symbols.find((s) => s.name === 'MaxRetries')
    expect(v?.kind).toBe('const')
  })

  it('Test 9: import_declaration → ParsedImport', async () => {
    const src = `import akka.actor.ActorSystem\nclass App {}\n`
    const result = await parse(src)
    const imp = result.imports.find((i) => i.from.includes('akka'))
    expect(imp).toBeDefined()
    expect(imp?.names).toContain('ActorSystem')
  })

  it('Test 10: package clause captured in language field', async () => {
    const src = `package com.example\nclass Foo {}\n`
    const result = await parse(src)
    expect(result.language).toBe('scala')
  })

  it('Test 11: .sc extension maps to scala language', async () => {
    const src = `val x = 42\n`
    const result = await parse(src, '/fake/script.sc')
    expect(result.language).toBe('scala')
  })

  it('Test 12: inferTechStack detects Akka', () => {
    const facts: FactInputModule[] = [
      {
        file: '/a.scala',
        imports: [{ from: 'akka.actor.ActorRef', names: ['ActorRef'] }],
        exports: [],
        symbols: [],
        language: 'scala',
      },
    ]
    expect(scalaAdapter.inferTechStack!(facts)).toBe('Scala/Akka')
  })

  it('Test 13: inferTechStack detects ZIO', () => {
    const facts: FactInputModule[] = [
      {
        file: '/a.scala',
        imports: [{ from: 'zio.App', names: ['App'] }],
        exports: [],
        symbols: [],
        language: 'scala',
      },
    ]
    expect(scalaAdapter.inferTechStack!(facts)).toBe('Scala/ZIO')
  })

  it('Test 14: inferTechStack detects Spark', () => {
    const facts: FactInputModule[] = [
      {
        file: '/a.scala',
        imports: [{ from: 'org.apache.spark.sql.SparkSession', names: ['SparkSession'] }],
        exports: [],
        symbols: [],
        language: 'scala',
      },
    ]
    expect(scalaAdapter.inferTechStack!(facts)).toBe('Scala/Spark')
  })

  it('Test 15: inferTechStack fallback to Scala', () => {
    const facts: FactInputModule[] = [
      {
        file: '/a.scala',
        imports: [],
        exports: [],
        symbols: [],
        language: 'scala',
      },
    ]
    expect(scalaAdapter.inferTechStack!(facts)).toBe('Scala')
  })
})
