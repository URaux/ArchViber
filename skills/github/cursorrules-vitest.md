---
name: cursorrules-vitest
description: Vitest unit testing best practices — mocking, Arrange-Act-Assert, TypeScript test patterns
category: testing
source: github
source_url: https://github.com/PatrickJS/awesome-cursorrules/tree/main/rules/vitest-unit-testing-cursorrules-prompt-file
tags: [vitest, testing, mocking, typescript]
scope: [node]
priority: 75
---

# Vitest Unit Testing Best Practices

## Core Strategy
- Focus tests on critical business logic and utility functions — not implementation details
- Mock all external dependencies (API calls, modules, timers) with `vi.mock()`
- Mock dependencies **before** any imports that use them
- Auto-detect TypeScript via `tsconfig.json` and adjust syntax accordingly

## Test Organization
- Group related tests in `describe()` blocks with descriptive names indicating behavior
- Use `beforeEach(() => vi.clearAllMocks())` to reset mocks between tests
- Limit to **3-5 focused tests per file** — avoid bloated test files
- Name tests to describe expected behavior: `'should return forecast when data is available'`

## The Arrange-Act-Assert Pattern
Every test should have three clear sections:
```ts
it('should format date correctly', () => {
  // Arrange
  const date = new Date('2023-10-15')

  // Act
  const result = formatDate(date)

  // Assert
  expect(result).toBe('2023-10-15')
})
```

## Mocking Patterns
```ts
// Mock a module before imports
vi.mock('../api/weatherService', () => ({
  getWeatherData: vi.fn(),
}))

import { getWeatherData } from '../api/weatherService'

// In test: set mock return value
;(getWeatherData as ReturnType<typeof vi.fn>).mockResolvedValue(mockData)
```

## Coverage Requirements
- Test valid inputs, invalid inputs, and edge cases for every public function
- Always test: `undefined` inputs, type mismatches, empty arrays/strings, API errors
- For async functions: test success path, rejection path, and partial data path

## TypeScript Test Typing
```ts
interface MockData {
  temperature: number
  humidity: number
  conditions: string
}

const mockWeather: MockData = {
  temperature: 25,
  humidity: 65,
  conditions: 'sunny',
}
```

## Async Testing
```ts
it('should handle API errors gracefully', async () => {
  ;(getWeatherData as any).mockRejectedValue(new Error('Service unavailable'))
  await expect(getForecast('Tokyo')).rejects.toThrow('Failed to get forecast: Service unavailable')
})
```

## What NOT to Test
- Implementation details (internal variable names, private methods)
- Framework internals (React's rendering mechanism, Next.js routing)
- Third-party library behavior
- Trivial getters/setters with no logic
