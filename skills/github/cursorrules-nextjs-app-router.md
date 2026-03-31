---
name: cursorrules-nextjs-app-router
description: Next.js App Router 规范 — 文件约定、Server/Client 组件、数据获取、ISR
category: frontend
source: github
source_url: https://github.com/PatrickJS/awesome-cursorrules/tree/main/rules/nextjs-app-router-cursorrules-prompt-file
tags: [Next.js, App-Router, SSR, React, 前端框架]
scope: [node, build]
priority: 75
---

# Next.js App Router Best Practices

## Server vs Client Components
- Use server components by default — they reduce client bundle size and enable direct data access
- Add `'use client'` only when the component needs: browser APIs, event listeners, useState, useEffect
- Never use `'use client'` for data fetching or state management that could live server-side
- Wrap client components in `<Suspense>` with a meaningful fallback

## File-Based Routing Conventions
- `layout.tsx` — persistent shell around route segments; use for nav, providers, shared UI
- `page.tsx` — the unique content for a route; always a default export
- `loading.tsx` — automatic Suspense boundary shown during segment load
- `error.tsx` — error boundary for the segment; must be a client component (`'use client'`)
- `global-error.tsx` — catches errors in the root layout
- `route.ts` — API route handlers; replaces `pages/api/`
- `not-found.tsx` — rendered when `notFound()` is called in a server component

## Recommended Directory Structure
```
app/
  layout.tsx          # root layout with providers
  page.tsx            # home route
  (marketing)/        # route group — no URL segment
  dashboard/
    layout.tsx
    page.tsx
    loading.tsx
    error.tsx
  api/
    [resource]/
      route.ts
components/           # shared UI (server-safe by default)
lib/                  # utilities, data fetchers, server actions
hooks/                # client-only hooks
types/                # shared TypeScript interfaces
```

## Data Fetching
- Fetch data directly in server components using `async/await` — no useEffect, no client state
- Use `cache()` from React or Next.js `unstable_cache` for deduplication across a request
- Prefer `fetch` with `{ next: { revalidate: N } }` for ISR-style caching
- Use Server Actions for mutations — annotate with `'use server'`, validate with Zod

## Performance
- Use `next/image` for all images — always provide `width`, `height`, or `fill` + `sizes`
- Use `next/font` for fonts — eliminates layout shift from font loading
- Use dynamic imports (`next/dynamic`) for heavy client components
- Set `<meta>` via the `metadata` export or `generateMetadata()` — never in `<head>` directly

## TypeScript
- Use TypeScript for all files including route handlers and server actions
- Type `params` and `searchParams` explicitly in page props
- Use `import type` for type-only imports
