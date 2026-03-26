export function clampMaxParallel(value: number) {
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.min(5, Math.max(1, Math.round(value)))
}
