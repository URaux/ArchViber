import { describe, it, expect } from 'vitest'
import { hclAdapter, parseHcl } from '../../../../src/lib/ingest/languages/hcl'
import type { FactInputModule } from '../../../../src/lib/ingest/facts'
import type Parser from 'web-tree-sitter'

function makeTree(text: string): Parser.Tree {
  return { rootNode: { text } } as unknown as Parser.Tree
}

function extractFacts(source: string, filePath = '/infra/main.tf'): FactInputModule {
  return hclAdapter.extractFacts(makeTree(source), filePath)
}

describe('parseHcl', () => {
  it('Test 1: resource block maps to <type>.<name>', () => {
    const src = 'resource "aws_instance" "web" {\n  ami = "ami-123"\n}\n'
    const entries = parseHcl(src)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('aws_instance.web')
    expect(entries[0].blockType).toBe('resource')
    expect(entries[0].line).toBe(1)
  })

  it('Test 2: variable block maps to var.<name>', () => {
    const src = 'variable "region" {\n  default = "us-east-1"\n}\n'
    const entries = parseHcl(src)
    expect(entries[0].name).toBe('var.region')
    expect(entries[0].blockType).toBe('variable')
  })

  it('Test 3: module block maps to module.<name>', () => {
    const src = 'module "vpc" {\n  source = "./vpc"\n}\n'
    const entries = parseHcl(src)
    expect(entries[0].name).toBe('module.vpc')
    expect(entries[0].blockType).toBe('module')
  })

  it('Test 4: output block maps to output.<name>', () => {
    const src = 'output "instance_ip" {\n  value = aws_instance.web.public_ip\n}\n'
    const entries = parseHcl(src)
    expect(entries[0].name).toBe('output.instance_ip')
    expect(entries[0].blockType).toBe('output')
  })

  it('Test 5: locals block maps to local.<key> for each key', () => {
    const src = 'locals {\n  env = "prod"\n  region = "us-east-1"\n}\n'
    const entries = parseHcl(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('local.env')
    expect(names).toContain('local.region')
    expect(entries.every((e) => e.blockType === 'locals')).toBe(true)
  })

  it('Test 6: multiple block types in one file', () => {
    const src = [
      'resource "aws_s3_bucket" "assets" {}',
      'variable "bucket_name" {}',
      'module "cdn" { source = "./cdn" }',
      'output "bucket_arn" { value = aws_s3_bucket.assets.arn }',
    ].join('\n')
    const entries = parseHcl(src)
    const names = entries.map((e) => e.name)
    expect(names).toContain('aws_s3_bucket.assets')
    expect(names).toContain('var.bucket_name')
    expect(names).toContain('module.cdn')
    expect(names).toContain('output.bucket_arn')
  })

  it('Test 7: comment lines are skipped', () => {
    const src = '# This is a comment\n// another comment\nresource "aws_lambda_function" "fn" {}\n'
    const entries = parseHcl(src)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('aws_lambda_function.fn')
  })
})

describe('hclAdapter.extractFacts', () => {
  it('all symbols are exported and kind=const', () => {
    const src = 'resource "google_compute_instance" "vm" {}\nvariable "zone" {}\n'
    const result = extractFacts(src)
    expect(result.language).toBe('hcl')
    for (const sym of result.symbols) {
      expect(sym.kind).toBe('const')
      expect((sym as { exported?: boolean }).exported).toBe(true)
    }
    expect(result.exports).toContain('google_compute_instance.vm')
    expect(result.exports).toContain('var.zone')
  })

  it('file path uses forward slashes', () => {
    const result = extractFacts('resource "aws_vpc" "main" {}\n', 'C:\\infra\\main.tf')
    expect(result.file).not.toContain('\\')
  })
})

describe('hclAdapter.inferTechStack', () => {
  it('infers AWS/Terraform from aws_ resources', () => {
    const facts = [extractFacts('resource "aws_instance" "web" {}\n')]
    expect(hclAdapter.inferTechStack(facts)).toBe('AWS/Terraform')
  })

  it('infers GCP/Terraform from google_ resources', () => {
    const facts = [extractFacts('resource "google_compute_instance" "vm" {}\n')]
    expect(hclAdapter.inferTechStack(facts)).toBe('GCP/Terraform')
  })

  it('returns Terraform for unknown provider', () => {
    const facts = [extractFacts('variable "env" {}\n')]
    expect(hclAdapter.inferTechStack(facts)).toBe('Terraform')
  })
})

describe('hclAdapter.loadParser', () => {
  it('throws a helpful error', async () => {
    await expect(hclAdapter.loadParser()).rejects.toThrow(/tree-sitter-hcl/)
  })
})
