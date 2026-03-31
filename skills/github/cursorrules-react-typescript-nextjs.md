---
name: cursorrules-react-typescript-nextjs
description: React + TypeScript + Next.js patterns — functional components, error handling, RSC conventions, Zod validation
category: frontend
source: github
source_url: https://github.com/PatrickJS/awesome-cursorrules/tree/main/rules/react-typescript-nextjs-nodejs-cursorrules-prompt-
tags: [react, typescript, nextjs, shadcn, zod]
scope: [node, build]
priority: 75
---

# React + TypeScript + Next.js Patterns

## Core Principles
- Write concise, technical code with accurate TypeScript examples
- Use functional, declarative programming — avoid classes
- Prefer iteration and modularization over duplication
- Use descriptive variable names with auxiliary verbs: `isLoading`, `hasError`, `canSubmit`
- Use lowercase with dashes for directories: `components/auth-wizard`
- Favor named exports for components
- Use the RORO pattern (Receive an Object, Return an Object) for multi-param functions

## TypeScript Conventions
- Use `function` keyword for pure functions (benefits from hoisting and clarity)
- Prefer `interface` over `type` for extendable object shapes
- Use `type` for unions, intersections, and primitive compositions
- Avoid `enum` — use `const` maps instead for better tree-shaking and type safety
- File structure order: exported component → subcomponents → helpers → static content → types
- Use `import type` for type-only imports
- Avoid `any`; use `unknown` with runtime narrowing

## Error Handling Pattern
- Handle errors and edge cases at the top of functions (guard clauses)
- Use early returns for error conditions — avoid deeply nested `if` statements
- Place the happy path last for readability
- Avoid unnecessary `else` blocks — prefer `if return`
- Implement proper error logging with user-friendly messages
- Use custom error types or error factories for consistent error shapes

## React / Next.js Component Rules
- Use `function` declarations for components, not `const` arrow functions
- Use declarative JSX — avoid imperative DOM manipulation
- Minimize `'use client'`, `useEffect`, and `useState` — favor React Server Components
- Use `'use client'` only for Web API access in small, leaf components
- Place static content and interfaces at end of file
- Extract static content to `const` variables outside the render function
- Wrap client components in `<Suspense fallback={...}>`
- Use dynamic loading (`next/dynamic`) for non-critical components
- Optimize images: WebP format, `sizes` attribute, lazy loading via `next/image`

## Forms and Validation
- Use Zod for all schema validation
- Use `useActionState` + `react-hook-form` for form validation in client components
- Model expected errors as return values from Server Actions — do not `throw` for expected cases
- Use `useActionState` to propagate Server Action errors to the UI
- Use `error.tsx` and `global-error.tsx` for unexpected errors (error boundaries)

## Server Actions
- Annotate with `'use server'` at file or function level
- Validate all inputs with Zod before processing
- Return a typed `ActionResponse` — consistent `{ success, data?, error? }` shape
- Services in `services/` always throw user-friendly errors that TanStack Query can catch
- Never mix server action logic with UI rendering logic

## Performance Conventions
- Rely on Next.js App Router for state changes rather than client-side routing
- Prioritize Web Vitals: LCP, CLS, FID
- Avoid data fetching in client components when a server component can do it
