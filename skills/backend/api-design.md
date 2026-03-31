---
name: api-design
description: REST API 设计规范 — 资源命名、HTTP 方法、错误格式、分页
category: backend
source: local
tags: [REST-API, 后端, HTTP, Express, FastAPI, Node.js]
scope: [node, build]
priority: 80
---

# REST API Conventions

- Resource-based URLs: nouns not verbs (/users not /getUsers)
- Use appropriate HTTP methods (GET/POST/PUT/PATCH/DELETE)
- Return consistent error shapes: { error: string, code?: string }
- Paginate list endpoints; never return unbounded arrays
- Validate all request bodies before processing
