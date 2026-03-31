---
name: cursorrules-nodejs-api
description: Node.js API 设计模式 — 路由处理、Zod 验证、服务层分离、错误处理
category: backend
source: github
source_url: https://github.com/PatrickJS/awesome-cursorrules/tree/main/rules/typescript-nestjs-best-practices-cursorrules-promp
tags: [Node.js, API, Express, Zod, 后端, 服务端]
scope: [node]
priority: 75
---

# Node.js API Design Standards

## Architecture
- Modular structure: one module/domain per route group
- Separate controllers (request/response), services (business logic), and data access
- Keep `app/api/[resource]/route.ts` thin — delegate to service layer
- Services throw user-friendly errors; never leak internal error details to clients

## Route Handler Pattern (Next.js App Router)
```ts
// app/api/documents/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { documentService } from '@/services/document-service'
import { createDocumentSchema } from '@/lib/schemas'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const input = createDocumentSchema.parse(body)  // throws ZodError if invalid
    const result = await documentService.create(input)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
```

## Input Validation with Zod
- Validate all external inputs at the boundary — route handlers, server actions, webhooks
- Define schemas in `lib/schemas/` colocated with types
- Use `.safeParse()` when you want to handle errors manually; `.parse()` when throwing is acceptable
```ts
const schema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().optional(),
  tags: z.array(z.string()).default([]),
})
type CreateInput = z.infer<typeof schema>
```

## Error Handling
- Use a central `handleApiError()` utility — standardizes response shape and avoids repetition:
```ts
function handleApiError(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 400 })
  }
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('[API Error]', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
```
- Create typed `AppError` with `statusCode` for expected HTTP errors (404, 403, 409)
- Log unexpected errors server-side with context; return generic message to client

## Service Layer
- Services contain all business logic — no HTTP concepts (`req`, `res`, status codes)
- Services throw `AppError` for domain failures (not-found, conflict, unauthorized)
- One service file per major entity: `user-service.ts`, `document-service.ts`
- Use dependency injection pattern — pass collaborators as function params or constructor args

## Response Conventions
- Success: `{ data: T }` wrapper OR direct object for simple cases — pick one and be consistent
- Error: `{ error: string, issues?: ZodIssue[] }` — never expose stack traces
- Lists: `{ data: T[], total: number, page: number, pageSize: number }`
- Always set appropriate HTTP status codes: 200, 201, 204, 400, 401, 403, 404, 409, 500

## Environment Variables
- Access via typed config module — never read `process.env` directly in business logic
- UPPER_SNAKE_CASE naming: `DATABASE_URL`, `NEXTAUTH_SECRET`
- Validate all required env vars at startup with Zod

## Testing API Routes
- Test the service layer with unit tests (mock DB/external calls)
- Test route handlers with integration tests using `fetch` against a test server or MSW
- Follow Arrange-Act-Assert; use descriptive test names with Given-When-Then language
- Test: valid input → expected response, invalid input → 400, unauthorized → 401, not-found → 404
