import { describe, it, expect } from 'vitest'
import { kotlinAdapter } from '../../../../src/lib/ingest/languages/kotlin'
import type { KotlinParsedSymbol } from '../../../../src/lib/ingest/languages/kotlin'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await kotlinAdapter.loadParser()
  const tree = parser.parse(source)
  const result = kotlinAdapter.extractFacts(tree, '/fake/Main.kt')
  tree.delete()
  return result
}

describe('kotlinAdapter', () => {
  it('Test 1: class declaration is exported by default (no modifier = public)', async () => {
    const src = `package com.example\n\nclass Foo\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Foo')
    expect(result.exports).toContain('Foo')
  })

  it('Test 2: data class declaration → kind class, exported', async () => {
    const src = `package com.example\n\ndata class Point(val x: Int, val y: Int)\n`
    const result = await parse(src)
    const cls = result.symbols.find((s) => s.name === 'Point')
    expect(cls?.kind).toBe('class')
    expect(result.exports).toContain('Point')
  })

  it('Test 3: object declaration → kind class (singleton)', async () => {
    const src = `object Singleton {\n  fun doSomething() {}\n}\n`
    const result = await parse(src)
    const obj = result.symbols.find((s) => s.name === 'Singleton')
    expect(obj?.kind).toBe('class')
    expect(result.exports).toContain('Singleton')
  })

  it('Test 4: enum class → kind class', async () => {
    const src = `enum class Status { OK, ERROR, PENDING }\n`
    const result = await parse(src)
    const e = result.symbols.find((s) => s.name === 'Status')
    expect(e?.kind).toBe('class')
  })

  it('Test 5: top-level function → kind function, exported', async () => {
    const src = `package com.example\n\nfun greet(name: String): String = "Hello \$name"\n`
    const result = await parse(src)
    const fn = result.symbols.find((s) => s.name === 'greet')
    expect(fn?.kind).toBe('function')
    expect(result.exports).toContain('greet')
  })

  it('Test 6: method inside class carries parentClass attribute', async () => {
    const src = `class User {\n  fun login(): Boolean = true\n}\n`
    const result = await parse(src)
    const method = result.symbols.find((s) => s.name === 'login') as KotlinParsedSymbol | undefined
    expect(method).toBeDefined()
    expect(method?.kind).toBe('function')
    expect(method?.attributes?.parentClass).toBe('User')
  })

  it('Test 7: import_header → ParsedImport with FQN', async () => {
    const src = `package com.example\n\nimport org.springframework.boot.autoconfigure.SpringBootApplication\nimport io.ktor.server.engine.embeddedServer\n\nclass App\n`
    const result = await parse(src)
    expect(result.imports).toHaveLength(2)
    const fqns = result.imports.map((i) => i.from).sort()
    expect(fqns).toContain('org.springframework.boot.autoconfigure.SpringBootApplication')
    expect(fqns).toContain('io.ktor.server.engine.embeddedServer')
  })

  it('Test 8: private class is NOT exported', async () => {
    const src = `private class Hidden\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('Hidden')
    expect(result.symbols.find((s) => s.name === 'Hidden')).toBeDefined()
  })

  it('Test 9: internal class is NOT exported', async () => {
    const src = `internal class InternalHelper\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('InternalHelper')
  })

  it('Test 10: top-level property_declaration → kind const', async () => {
    const src = `package com.example\n\nval BASE_URL = "https://api.example.com"\n`
    const result = await parse(src)
    const prop = result.symbols.find((s) => s.kind === 'const')
    expect(prop).toBeDefined()
    expect(result.exports).toContain(prop!.name)
  })

  it('Test 11: annotation captured on class symbol', async () => {
    const src = `import org.springframework.boot.autoconfigure.SpringBootApplication\n\n@SpringBootApplication\nclass App\n`
    const result = await parse(src)
    const cls = result.symbols.find((s) => s.name === 'App') as KotlinParsedSymbol | undefined
    expect(cls?.attributes?.annotations?.some((a) => a === '@SpringBootApplication')).toBe(true)
  })

  it('inferTechStack: Spring Boot import → Kotlin/Spring Boot', async () => {
    const src = `package x\n\nimport org.springframework.boot.autoconfigure.SpringBootApplication\n\nclass App\n`
    const result = await parse(src)
    expect(kotlinAdapter.inferTechStack([result])).toBe('Kotlin/Spring Boot')
  })

  it('inferTechStack: Ktor import → Kotlin/Ktor', async () => {
    const src = `package x\n\nimport io.ktor.server.engine.embeddedServer\n\nfun main() {}\n`
    const result = await parse(src)
    expect(kotlinAdapter.inferTechStack([result])).toBe('Kotlin/Ktor')
  })

  it('inferTechStack: Android import → Kotlin/Android', async () => {
    const src = `package x\n\nimport android.app.Activity\n\nclass MainActivity\n`
    const result = await parse(src)
    expect(kotlinAdapter.inferTechStack([result])).toBe('Kotlin/Android')
  })

  it('inferTechStack: no known framework → Kotlin', async () => {
    const src = `package x\n\nimport java.util.Date\n\nclass Scheduler\n`
    const result = await parse(src)
    expect(kotlinAdapter.inferTechStack([result])).toBe('Kotlin')
  })
})
