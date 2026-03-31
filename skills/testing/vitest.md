---
name: vitest
description: Vitest 测试模式 — 测试命名、AAA 结构、Mock 策略、测试隔离
category: testing
source: local
tags: [Vitest, 测试, 单元测试, Mock, TDD]
scope: [build]
priority: 80
---

# Vitest Test Patterns

- Name tests: "it should [behavior] when [condition]"
- Arrange-Act-Assert structure in every test
- Mock only what crosses a boundary (I/O, external APIs)
- Keep tests independent; no shared mutable state
- Test behavior, not implementation details
