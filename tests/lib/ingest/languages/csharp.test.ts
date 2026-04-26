import { describe, it, expect } from 'vitest'
import { csharpAdapter } from '../../../../src/lib/ingest/languages/csharp'
import type { CSharpParsedSymbol } from '../../../../src/lib/ingest/languages/csharp'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await csharpAdapter.loadParser()
  const tree = parser.parse(source)
  const result = csharpAdapter.extractFacts(tree, '/fake/Program.cs')
  tree.delete()
  return result
}

describe('csharpAdapter', () => {
  it('Test 1: public class declaration is exported', async () => {
    const src = `namespace MyApp;\n\npublic class Foo {}\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Foo')
    expect(result.exports).toContain('Foo')
  })

  it('Test 2: internal class is NOT exported', async () => {
    const src = `namespace MyApp;\n\ninternal class Helper {}\n`
    const result = await parse(src)
    expect(result.symbols.find((s) => s.name === 'Helper')).toBeDefined()
    expect(result.exports).not.toContain('Helper')
  })

  it('Test 3: private/protected class is NOT exported', async () => {
    // Nested private class — scan children not namedChildren
    const src = `public class Outer {\n  private class Inner {}\n  protected class Base {}\n}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('Inner')
    expect(result.exports).not.toContain('Base')
  })

  it('Test 4: public interface → interface kind, exported', async () => {
    const src = `namespace MyApp;\n\npublic interface IRepository {}\n`
    const result = await parse(src)
    const ifaces = result.symbols.filter((s) => s.kind === 'interface')
    expect(ifaces).toHaveLength(1)
    expect(ifaces[0].name).toBe('IRepository')
    expect(result.exports).toContain('IRepository')
  })

  it('Test 5: public record → class kind, exported', async () => {
    const src = `namespace MyApp;\n\npublic record Point(int X, int Y);\n`
    const result = await parse(src)
    const r = result.symbols.find((s) => s.name === 'Point')
    expect(r).toBeDefined()
    expect(r?.kind).toBe('class')
    expect(result.exports).toContain('Point')
  })

  it('Test 6: public struct → class kind', async () => {
    const src = `namespace MyApp;\n\npublic struct Vector2 { public float X; public float Y; }\n`
    const result = await parse(src)
    const s = result.symbols.find((s) => s.name === 'Vector2')
    expect(s).toBeDefined()
    expect(s?.kind).toBe('class')
    expect(result.exports).toContain('Vector2')
  })

  it('Test 7: public method nested in class carries parentClass + is exported', async () => {
    const src = `public class UserService {\n  public string GetUser() { return ""; }\n}\n`
    const result = await parse(src)
    const method = result.symbols.find((s) => s.name === 'GetUser') as CSharpParsedSymbol | undefined
    expect(method).toBeDefined()
    expect(method?.kind).toBe('function')
    expect(method?.attributes?.parentClass).toBe('UserService')
    expect(result.exports).toContain('GetUser')
  })

  it('Test 8: using_directive → import fact (from = qualified name)', async () => {
    const src = `using System.Collections.Generic;\nusing System.Linq;\n\npublic class A {}\n`
    const result = await parse(src)
    const generic = result.imports.find((i) => i.from === 'System.Collections.Generic')
    const linq = result.imports.find((i) => i.from === 'System.Linq')
    expect(generic).toBeDefined()
    expect(linq).toBeDefined()
    expect(generic?.names).toEqual(['Generic'])
    expect(linq?.names).toEqual(['Linq'])
  })

  it('Test 9: [ApiController] attribute captured on class via attributes.annotations', async () => {
    const src =
      `using Microsoft.AspNetCore.Mvc;\n\n[ApiController]\n[Route("api/[controller]")]\npublic class WeatherController {}\n`
    const result = await parse(src)
    const cls = result.symbols.find((s) => s.name === 'WeatherController') as CSharpParsedSymbol | undefined
    expect(cls).toBeDefined()
    const annotations = cls?.attributes?.annotations ?? []
    expect(annotations.some((a) => a.includes('ApiController'))).toBe(true)
  })

  it('Test 10: inferTechStack — ASP.NET Core import → C#/ASP.NET Core', async () => {
    const src = `using Microsoft.AspNetCore.Mvc;\n\npublic class A {}\n`
    const result = await parse(src)
    expect(csharpAdapter.inferTechStack([result])).toBe('C#/ASP.NET Core')
  })

  it('Test 11: inferTechStack — Entity Framework import → C#/Entity Framework', async () => {
    const src = `using Microsoft.EntityFrameworkCore;\n\npublic class A {}\n`
    const result = await parse(src)
    expect(csharpAdapter.inferTechStack([result])).toBe('C#/Entity Framework')
  })

  it('Test 12: inferTechStack — Avalonia import → C#/Avalonia', async () => {
    const src = `using Avalonia.Controls;\n\npublic class A {}\n`
    const result = await parse(src)
    expect(csharpAdapter.inferTechStack([result])).toBe('C#/Avalonia')
  })

  it('Test 13: inferTechStack — plain System imports → C# fallback', async () => {
    const src = `using System;\nusing System.Collections.Generic;\n\npublic class A {}\n`
    const result = await parse(src)
    expect(csharpAdapter.inferTechStack([result])).toBe('C#')
  })
})
