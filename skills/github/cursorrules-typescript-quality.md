---
name: cursorrules-typescript-quality
description: TypeScript 代码质量 — 命名规范、判别联合、SOLID 原则、不可变性
category: core
source: github
source_url: https://github.com/PatrickJS/awesome-cursorrules/tree/main/rules/typescript-nestjs-best-practices-cursorrules-promp
tags: [TypeScript, 代码质量, SOLID, 类型系统, 通用]
scope: [node, build]
priority: 75
---

# TypeScript Code Quality Standards

## Naming Conventions
- `PascalCase` for classes, interfaces, types, enums, and React components
- `camelCase` for variables, functions, methods, and object properties
- `kebab-case` for file and directory names
- `UPPER_SNAKE_CASE` for environment variables and true module-level constants
- Replace magic numbers with named constants
- **Start each function name with a verb**: `getUserById`, `saveDocument`, `validateInput`
- Boolean variables/functions use prefix: `isVisible`, `hasPermission`, `canDelete`
- Use complete words — abbreviate only for universally understood terms: `API`, `URL`, `err`, `ctx`, `req`, `res`

## Function Design
- Write short functions with a **single purpose** — target under 20 instructions
- Reduce nesting through early returns and utility extraction
- Use higher-order functions (`map`, `filter`, `reduce`) over imperative loops
- Use arrow functions for inline/simple callbacks; named `function` declarations for exported utilities
- Use default parameter values over null/undefined runtime checks
- RORO pattern: when a function takes multiple params or returns multiple values, use objects
  ```ts
  function createUser({ name, email, role }: CreateUserInput): UserResult { ... }
  ```
- Maintain a single level of abstraction per function — don't mix high-level orchestration with low-level details

## Type System Usage
- Enable strict mode in `tsconfig.json` (`strict: true`)
- Explicitly type all variables, function parameters, and return values — never rely on inference for public APIs
- Prefer `interface` for extendable shapes; use `type` for unions, intersections, and conditional types
- Use utility types: `Partial<T>`, `Readonly<T>`, `Pick<T, K>`, `Record<K, V>`, `NonNullable<T>`
- Avoid `any` — use `unknown` with type guards or narrowing
- Use discriminated unions for state modeling:
  ```ts
  type Result<T> = { success: true; data: T } | { success: false; error: string }
  ```
- Use `readonly` and `as const` for immutable data
- Document complex types with JSDoc

## Data Modeling
- Encapsulate related data in composite types — avoid primitive obsession
- Prefer immutability by default; mutate only when justified
- Use classes with internal validation for domain objects with invariants
- For plain data transfer, use interfaces/types (no class overhead)

## Error Handling
- Use exceptions only for **unexpected** errors — not for expected control flow
- Catch exceptions only to: fix the specific problem, add context, or re-throw
- Otherwise use global error handlers / middleware
- For expected failures (validation, not-found), model as return values:
  ```ts
  type FindResult<T> = { found: true; data: T } | { found: false; reason: string }
  ```

## Code Organization
- One export per file — colocate the type with its implementation
- Place types and interfaces at the bottom of the file
- Use `import type` for type-only imports
- Organize imports: stdlib → third-party → internal, separated by blank lines
- Keep files under 200 lines; extract when they grow larger

## SOLID in Practice
- **S**ingle Responsibility: one reason to change per module
- **O**pen/Closed: extend via composition, not modification
- **L**iskov: subtypes must be substitutable for their base type
- **I**nterface Segregation: small, focused interfaces over large monolithic ones
- **D**ependency Inversion: depend on abstractions; inject concrete implementations
- Keep classes small: under 200 instructions, under 10 public methods, under 10 properties
