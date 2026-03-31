---
name: error-handling
description: 错误处理模式 — 输入验证、错误传播、用户友好的错误信息
category: core
source: local
tags: [错误处理, 可靠性, 输入验证, 通用]
scope: [global, node, build]
priority: 100
---

# Error Handling

- Validate inputs at boundaries; fail fast with clear messages
- No silent catches - always log or surface errors
- Use typed errors (custom Error subclasses) for recoverable cases
- Propagate errors upward; don't swallow them mid-stack
- User-facing errors must be human-readable
