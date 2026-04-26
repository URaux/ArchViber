import { describe, it, expect } from 'vitest'
import { swiftAdapter } from '../../../../src/lib/ingest/languages/swift'
import type { SwiftParsedSymbol } from '../../../../src/lib/ingest/languages/swift'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await swiftAdapter.loadParser()
  const tree = parser.parse(source)
  const result = swiftAdapter.extractFacts(tree, '/fake/File.swift')
  tree.delete()
  return result
}

describe('swiftAdapter', () => {
  it('Test 1: public class → class fact, exported', async () => {
    const src = `public class MyViewController {}\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('MyViewController')
    expect(result.exports).toContain('MyViewController')
  })

  it('Test 2: internal class (no public) is NOT exported', async () => {
    const src = `class Helper {}\n`
    const result = await parse(src)
    const h = result.symbols.find((s) => s.name === 'Helper')
    expect(h?.kind).toBe('class')
    expect(result.exports).not.toContain('Helper')
  })

  it('Test 3: protocol_declaration → interface fact', async () => {
    const src = `public protocol Greetable {\n  func greet() -> String\n}\n`
    const result = await parse(src)
    const ifaces = result.symbols.filter((s) => s.kind === 'interface')
    expect(ifaces).toHaveLength(1)
    expect(ifaces[0].name).toBe('Greetable')
    expect(result.exports).toContain('Greetable')
  })

  it('Test 4: struct_declaration → class fact', async () => {
    const src = `public struct Point { var x: Double; var y: Double }\n`
    const result = await parse(src)
    const s = result.symbols.find((s) => s.name === 'Point')
    expect(s?.kind).toBe('class')
    expect(result.exports).toContain('Point')
  })

  it('Test 5: enum_declaration → class fact', async () => {
    const src = `public enum Direction { case north, south, east, west }\n`
    const result = await parse(src)
    const e = result.symbols.find((s) => s.name === 'Direction')
    expect(e?.kind).toBe('class')
    expect(result.exports).toContain('Direction')
  })

  it('Test 6: actor_declaration → class fact', async () => {
    const src = `public actor DataStore {\n  var items: [String] = []\n}\n`
    const result = await parse(src)
    const a = result.symbols.find((s) => s.name === 'DataStore')
    expect(a?.kind).toBe('class')
    expect(result.exports).toContain('DataStore')
  })

  it('Test 7: top-level function_declaration → function fact', async () => {
    const src = `public func greet(name: String) -> String { return "Hello, \\(name)" }\n`
    const result = await parse(src)
    const fn = result.symbols.find((s) => s.name === 'greet')
    expect(fn?.kind).toBe('function')
    expect(result.exports).toContain('greet')
  })

  it('Test 8: method inside class carries parentClass attribute', async () => {
    const src = `public class Foo {\n  func doWork() {}\n}\n`
    const result = await parse(src)
    const method = result.symbols.find((s) => s.name === 'doWork') as SwiftParsedSymbol | undefined
    expect(method).toBeDefined()
    expect(method?.kind).toBe('function')
    expect(method?.attributes?.parentClass).toBe('Foo')
  })

  it('Test 9: import_declaration → import fact', async () => {
    const src = `import Foundation\n`
    const result = await parse(src)
    const imp = result.imports.find((i) => i.from === 'Foundation')
    expect(imp).toBeDefined()
  })

  it('Test 10: open class → exported (open is public-like)', async () => {
    const src = `open class BaseController {}\n`
    const result = await parse(src)
    expect(result.exports).toContain('BaseController')
  })

  it('Test 11: private class → NOT exported', async () => {
    const src = `private class InternalHelper {}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('InternalHelper')
  })

  it('inferTechStack: SwiftUI import → Swift/SwiftUI', async () => {
    const src = `import SwiftUI\n`
    const result = await parse(src)
    expect(swiftAdapter.inferTechStack([result])).toBe('Swift/SwiftUI')
  })

  it('inferTechStack: UIKit import → Swift/UIKit', async () => {
    const src = `import UIKit\n`
    const result = await parse(src)
    expect(swiftAdapter.inferTechStack([result])).toBe('Swift/UIKit')
  })

  it('inferTechStack: Vapor import → Swift/Vapor', async () => {
    const src = `import Vapor\n`
    const result = await parse(src)
    expect(swiftAdapter.inferTechStack([result])).toBe('Swift/Vapor')
  })

  it('inferTechStack: Alamofire import → Swift/Alamofire', async () => {
    const src = `import Alamofire\n`
    const result = await parse(src)
    expect(swiftAdapter.inferTechStack([result])).toBe('Swift/Alamofire')
  })

  it('inferTechStack: plain Foundation → Swift fallback', async () => {
    const src = `import Foundation\n`
    const result = await parse(src)
    expect(swiftAdapter.inferTechStack([result])).toBe('Swift')
  })
})
