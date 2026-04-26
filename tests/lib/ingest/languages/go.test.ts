/**
 * Go adapter tests — W2.D3.
 *
 * Each test parses an inline Go source string via goAdapter.loadParser()
 * + extractFacts(). No fixture files needed.
 */

import { describe, it, expect } from 'vitest'
import { goAdapter } from '../../../../src/lib/ingest/languages/go'
import type { GoParsedSymbol } from '../../../../src/lib/ingest/languages/go'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await goAdapter.loadParser()
  const tree = parser.parse(source)
  const result = goAdapter.extractFacts(tree, '/fake/main.go')
  tree.delete()
  return result
}

describe('goAdapter', () => {
  it('Test 1: type Foo struct → 1 class fact named Foo', async () => {
    const src = `package main\n\ntype Foo struct {\n\tName string\n}\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Foo')
  })

  it('Test 2: type Bar interface → 1 interface fact', async () => {
    const src = `package main\n\ntype Bar interface {\n\tDo()\n}\n`
    const result = await parse(src)
    const ifaces = result.symbols.filter((s) => s.kind === 'interface')
    expect(ifaces).toHaveLength(1)
    expect(ifaces[0].name).toBe('Bar')
  })

  it('Test 3: top-level func Greet → 1 function, exported', async () => {
    const src = `package main\n\nfunc Greet() string { return "hi" }\n`
    const result = await parse(src)
    const fns = result.symbols.filter((s) => s.kind === 'function')
    expect(fns).toHaveLength(1)
    expect(fns[0].name).toBe('Greet')
    expect(result.exports).toContain('Greet')
  })

  it('Test 4: lowercase func is NOT exported', async () => {
    const src = `package main\n\nfunc helper() {}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('helper')
  })

  it('Test 5: method declaration carries receiverType attribute', async () => {
    const src =
      `package main\n\ntype User struct { Name string }\n\nfunc (u *User) Greet() string {\n\treturn u.Name\n}\n`
    const result = await parse(src)
    const greet = result.symbols.find((s) => s.name === 'Greet') as GoParsedSymbol | undefined
    expect(greet).toBeDefined()
    expect(greet?.kind).toBe('function')
    expect(greet?.attributes?.receiverType).toBe('User')
  })

  it('Test 6: import "fmt" → 1 import fact', async () => {
    const src = `package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("hi") }\n`
    const result = await parse(src)
    const importFact = result.imports.find((i) => i.from === 'fmt')
    expect(importFact).toBeDefined()
  })

  it('Test 7: grouped imports parse as multiple facts', async () => {
    const src = `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n`
    const result = await parse(src)
    expect(result.imports.find((i) => i.from === 'fmt')).toBeDefined()
    expect(result.imports.find((i) => i.from === 'net/http')).toBeDefined()
  })

  it('Test 8: aliased import preserves alias as name', async () => {
    const src = `package main\n\nimport ht "net/http"\n`
    const result = await parse(src)
    const httpImport = result.imports.find((i) => i.from === 'net/http')
    expect(httpImport).toBeDefined()
    expect(httpImport?.names).toContain('ht')
  })

  it('Test 9: var/const declarations emit const facts', async () => {
    const src = `package main\n\nconst Pi = 3.14\nvar Name = "world"\n`
    const result = await parse(src)
    const pi = result.symbols.find((s) => s.name === 'Pi')
    const name = result.symbols.find((s) => s.name === 'Name')
    expect(pi?.kind).toBe('const')
    expect(name?.kind).toBe('const')
  })

  it('inferTechStack returns Go/Gin for gin import', async () => {
    const src = `package main\n\nimport "github.com/gin-gonic/gin"\n`
    const result = await parse(src)
    expect(goAdapter.inferTechStack([result])).toBe('Go/Gin')
  })

  it('inferTechStack returns Go/Echo for echo import', async () => {
    const src = `package main\n\nimport "github.com/labstack/echo/v4"\n`
    const result = await parse(src)
    expect(goAdapter.inferTechStack([result])).toBe('Go/Echo')
  })

  it('inferTechStack returns Go/Fiber for fiber import', async () => {
    const src = `package main\n\nimport "github.com/gofiber/fiber/v2"\n`
    const result = await parse(src)
    expect(goAdapter.inferTechStack([result])).toBe('Go/Fiber')
  })

  it('inferTechStack returns Go/GORM for gorm.io/gorm', async () => {
    const src = `package main\n\nimport "gorm.io/gorm"\n`
    const result = await parse(src)
    expect(goAdapter.inferTechStack([result])).toBe('Go/GORM')
  })

  it('inferTechStack returns plain Go when no known framework', async () => {
    const src = `package main\n\nimport "fmt"\n`
    const result = await parse(src)
    // 'fmt' alone is stdlib; net/http is the only stdlib-net we tag, so 'fmt' → 'Go'
    expect(goAdapter.inferTechStack([result])).toBe('Go')
  })
})
