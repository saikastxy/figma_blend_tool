import { ColorSpace, SimplePaint } from './types'
import { lerpSolidPaint, simplifyPaint } from './color-utils'

// Interpolate arrays of fills, matching by index
export function interpolateFills(
  fillsA: readonly Paint[],
  fillsB: readonly Paint[],
  t: number,
  space: ColorSpace
): SolidPaint[] {
  const result: SolidPaint[] = []
  const maxLen = Math.max(fillsA.length, fillsB.length)

  for (let i = 0; i < maxLen; i++) {
    const paintA = i < fillsA.length ? simplifyPaint(fillsA[i]) : null
    const paintB = i < fillsB.length ? simplifyPaint(fillsB[i]) : null
    const interpolated = lerpSolidPaint(paintA, paintB, t, space)
    if (interpolated) {
      result.push(interpolated)
    }
  }

  return result
}

// Interpolate arrays of strokes, matching by index
export function interpolateStrokes(
  strokesA: readonly Paint[],
  strokesB: readonly Paint[],
  t: number,
  space: ColorSpace
): SolidPaint[] {
  return interpolateFills(strokesA, strokesB, t, space)
}

// Interpolate node opacity
export function interpolateOpacity(
  opacityA: number,
  opacityB: number,
  t: number
): number {
  return opacityA + (opacityB - opacityA) * t
}
