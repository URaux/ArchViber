import { describe, it, expect } from 'vitest'
import { rustAdapter } from '../../../../src/lib/ingest/languages/rust'
import type { RustParsedSymbol } from '../../../../src/lib/ingest/languages/rust'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'

async function parse(source: string): Promise<FactInputModule> {
  const parser = await rustAdapter.loadParser()
  const tree = parser.parse(source)
  const result = rustAdapter.extractFacts(tree, '/fake/main.rs')
  tree.delete()
  return result
}

describe('rustAdapter', () => {
  it('Test 1: pub struct → class fact, exported', async () => {
    const src = `pub struct User { pub name: String }\n`
    const result = await parse(src)
    const classes = result.symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('User')
    expect(result.exports).toContain('User')
  })

  it('Test 2: private struct (no pub) is NOT exported', async () => {
    const src = `struct Helper {}\n`
    const result = await parse(src)
    expect(result.exports).not.toContain('Helper')
  })

  it('Test 3: pub trait → interface fact', async () => {
    const src = `pub trait Greet { fn say(&self) -> String; }\n`
    const result = await parse(src)
    const ifaces = result.symbols.filter((s) => s.kind === 'interface')
    expect(ifaces).toHaveLength(1)
    expect(ifaces[0].name).toBe('Greet')
  })

  it('Test 4: pub enum → class fact', async () => {
    const src = `pub enum Status { Ok, Err }\n`
    const result = await parse(src)
    const e = result.symbols.find((s) => s.name === 'Status')
    expect(e?.kind).toBe('class')
    expect(result.exports).toContain('Status')
  })

  it('Test 5: top-level pub fn → function, exported', async () => {
    const src = `pub fn greet() -> String { String::from("hi") }\n`
    const result = await parse(src)
    const fn = result.symbols.find((s) => s.name === 'greet')
    expect(fn?.kind).toBe('function')
    expect(result.exports).toContain('greet')
  })

  it('Test 6: impl block methods carry implFor', async () => {
    const src = `pub struct User;\n\nimpl User {\n    pub fn greet(&self) -> String { String::from("hi") }\n}\n`
    const result = await parse(src)
    const greet = result.symbols.find((s) => s.name === 'greet') as RustParsedSymbol | undefined
    expect(greet).toBeDefined()
    expect(greet?.attributes?.implFor).toBe('User')
  })

  it('Test 7: impl Trait for Type method carries traitName', async () => {
    const src = `pub trait Greet { fn say(&self) -> String; }\n\npub struct User;\n\nimpl Greet for User {\n    fn say(&self) -> String { String::from("hi") }\n}\n`
    const result = await parse(src)
    const say = result.symbols.find((s) => s.name === 'say') as RustParsedSymbol | undefined
    expect(say).toBeDefined()
    expect(say?.attributes?.implFor).toBe('User')
    expect(say?.attributes?.traitName).toBe('Greet')
  })

  it('Test 8: use declaration → import fact', async () => {
    const src = `use std::collections::HashMap;\n`
    const result = await parse(src)
    const importFact = result.imports.find((i) => i.from === 'std::collections::HashMap')
    expect(importFact).toBeDefined()
    expect(importFact?.names).toContain('HashMap')
  })

  it('Test 9: pub mod → class fact, exported', async () => {
    const src = `pub mod handlers {}\n`
    const result = await parse(src)
    const m = result.symbols.find((s) => s.name === 'handlers')
    expect(m?.kind).toBe('class')
    expect(result.exports).toContain('handlers')
  })

  it('Test 10: pub const → const fact', async () => {
    const src = `pub const PI: f64 = 3.14;\n`
    const result = await parse(src)
    const pi = result.symbols.find((s) => s.name === 'PI')
    expect(pi?.kind).toBe('const')
    expect(result.exports).toContain('PI')
  })

  it('inferTechStack: actix_web → Rust/Actix Web', async () => {
    const src = `use actix_web::HttpServer;\n`
    const result = await parse(src)
    expect(rustAdapter.inferTechStack([result])).toBe('Rust/Actix Web')
  })

  it('inferTechStack: axum → Rust/Axum', async () => {
    const src = `use axum::Router;\n`
    const result = await parse(src)
    expect(rustAdapter.inferTechStack([result])).toBe('Rust/Axum')
  })

  it('inferTechStack: tonic gRPC → Rust/Tonic', async () => {
    const src = `use tonic::transport::Server;\n`
    const result = await parse(src)
    expect(rustAdapter.inferTechStack([result])).toBe('Rust/Tonic')
  })

  it('inferTechStack: plain Rust with std imports', async () => {
    const src = `use std::io;\n`
    const result = await parse(src)
    expect(rustAdapter.inferTechStack([result])).toBe('Rust')
  })
})
