---
name: react-patterns
description: React 组件模式 — 函数式组件、自定义 Hooks、状态管理、性能优化
category: frontend
source: local
tags: [React, 前端, Hooks, 组件设计, 状态管理]
scope: [node, build]
priority: 80
---

# React Patterns

- Prefer functional components with hooks
- Keep components small and focused; extract custom hooks for logic
- Co-locate state with the component that owns it
- Use React.memo / useMemo / useCallback sparingly and only when measured
- Prop types should be explicit interfaces, never `any`
