---
name: cursorrules-nextjs15-react19
description: Next.js 15 + React 19 patterns — RSC, useActionState, async APIs, Suspense, URL state
category: frontend
source: github
source_url: https://github.com/PatrickJS/awesome-cursorrules/tree/main/rules/nextjs15-react19-vercelai-tailwind-cursorrules-prompt-file
tags: [nextjs, react19, server-components, app-router, async]
scope: [node, build]
priority: 75
---

# Next.js 15 + React 19 Best Practices

## Component Architecture
- Default to React Server Components (RSC) — only add `'use client'` when browser APIs or interactivity require it
- Minimize `'use client'` directives; push them to the smallest possible leaf components
- Implement error boundaries at meaningful route segments (`error.tsx`, `global-error.tsx`)
- Use `<Suspense>` for all async operations in client components
- Optimize for Core Web Vitals: LCP, CLS, INP (replaces FID in CWV 2024)

## Naming Conventions
- Descriptive names with auxiliary verbs: `isLoading`, `hasError`, `canSubmit`
- Event handlers prefixed with `handle`: `handleClick`, `handleSubmit`, `handleKeyDown`
- Directories in lowercase with dashes: `components/auth-wizard`, `lib/data-access`
- Named exports for all components — avoid default exports in shared component files

## TypeScript
- Use TypeScript everywhere — interfaces over types for extendable shapes
- Avoid enums; use `as const` maps:
  ```ts
  const ROLES = { admin: 'admin', editor: 'editor', viewer: 'viewer' } as const
  type Role = (typeof ROLES)[keyof typeof ROLES]
  ```
- Use `satisfies` operator for type validation without widening:
  ```ts
  const config = { theme: 'dark', locale: 'en' } satisfies AppConfig
  ```

## React 19 State Patterns
- Use `useActionState` (replaces deprecated `useFormState`) for Server Action results
- Use enhanced `useFormStatus` — now exposes `data`, `method`, `action` in addition to `pending`
- Manage shareable URL state with `nuqs` — prefer over `useState` for filter/sort/pagination
- Minimize client-side state — if it can live in the URL or on the server, keep it there

## Next.js 15 Async Runtime APIs
In Next.js 15, cookies, headers, and params are async — always `await` them:
```ts
// In server components, layouts, and route handlers:
const cookieStore = await cookies()
const headersList = await headers()
const { id } = await params  // route params are now async too
```

## Data Fetching Patterns
```ts
// Server component — fetch directly, no useEffect
async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await getProduct(id)  // direct DB/API call
  return <ProductView product={product} />
}
```

## Code Structure per File
1. Exported component (default for pages, named for shared components)
2. Subcomponents used only in this file
3. Helper functions
4. Static content / constants
5. TypeScript types and interfaces

## Implementation Discipline
- Plan before coding: outline approach in comments or pseudocode for complex logic
- Write correct, complete, bug-free code — leave no TODOs or placeholders
- Reference file names in code comments when cross-file context matters
- Only write code necessary to complete the task — no speculative abstractions
- If the answer is uncertain, say so rather than guessing
