---
name: cursorrules-tailwind-nextjs
description: Tailwind CSS + Next.js styling rules — utility-first, responsive design, component patterns, accessibility
category: frontend
source: github
source_url: https://github.com/PatrickJS/awesome-cursorrules/tree/main/rules/tailwind-css-nextjs-guide-cursorrules-prompt-file
tags: [tailwind, nextjs, responsive, accessibility, shadcn]
scope: [node, build]
priority: 75
---

# Tailwind CSS + Next.js Styling Rules

## Core Philosophy
- Use Tailwind utility classes for all styling — avoid custom CSS unless absolutely necessary
- When custom CSS is unavoidable, use CSS Modules (`.module.css`) scoped to the component
- Never use inline `style` props for values that Tailwind can express
- Define design tokens (colors, spacing, typography) in `tailwind.config.ts` — don't hardcode values

## Class Ordering Convention
Follow the Prettier Tailwind plugin order (or maintain consistently):
1. Layout (`flex`, `grid`, `block`, `hidden`)
2. Positioning (`relative`, `absolute`, `z-*`)
3. Sizing (`w-*`, `h-*`, `max-w-*`)
4. Spacing (`p-*`, `m-*`, `gap-*`)
5. Typography (`text-*`, `font-*`, `leading-*`, `tracking-*`)
6. Colors (`bg-*`, `text-*`, `border-*`)
7. Effects (`shadow-*`, `opacity-*`, `ring-*`)
8. State variants last (`hover:`, `focus:`, `active:`)

## Responsive Design
- **Mobile-first**: write base styles for mobile, then add `sm:`, `md:`, `lg:`, `xl:` overrides
- Use `sm:` (640px), `md:` (768px), `lg:` (1024px), `xl:` (1280px), `2xl:` (1536px)
- Avoid desktop-first overrides — they fight Tailwind's default cascade
- Test every layout at 320px, 768px, and 1280px minimum

## Component Patterns with shadcn/ui
- Use shadcn/ui primitives as the base for all interactive components (Button, Input, Dialog, etc.)
- Customize shadcn components via `className` prop — don't modify the component source
- Use `cn()` utility (from `clsx` + `tailwind-merge`) for conditional class composition:
  ```ts
  import { cn } from '@/lib/utils'

  function Button({ variant, className, ...props }) {
    return (
      <button
        className={cn(
          'rounded-md px-4 py-2 font-medium',
          variant === 'ghost' && 'bg-transparent hover:bg-muted',
          className
        )}
        {...props}
      />
    )
  }
  ```
- Never concatenate class strings with template literals — always use `cn()`

## TypeScript + Component Rules
- Enable strict TypeScript (`strict: true`)
- Analyze component requirements before building — check if a similar component already exists
- Type all props explicitly with interfaces
- Use Tailwind's `responsive variants` for adaptive designs, not JS-based media queries
- Prefer named exports for components

## Accessibility
- Ensure sufficient color contrast (WCAG AA minimum: 4.5:1 for text)
- Use semantic HTML elements (`button`, `nav`, `main`, `section`, `article`)
- Add `aria-label` to icon-only buttons
- Ensure all interactive elements are keyboard navigable
- Use `focus-visible:` instead of `focus:` for focus rings to avoid mouse-click outlines
- Test with keyboard navigation and screen reader

## Performance
- Use `next/image` for all images — eliminates layout shift, enables lazy loading
- Purge unused classes via Tailwind's `content` config (auto in Next.js)
- Avoid dynamic class generation — Tailwind's JIT cannot purge dynamic strings:
  ```ts
  // BAD: Tailwind can't detect this
  const color = `text-${variant}-500`

  // GOOD: use a map
  const colorMap = { primary: 'text-blue-500', danger: 'text-red-500' }
  ```

## Animation
- Use Tailwind's `transition-*` and `duration-*` for simple transitions
- Use `animate-*` for keyframe animations defined in `tailwind.config.ts`
- For complex animations, use `framer-motion` — integrate via `motion.div` with Tailwind classes for static styles
