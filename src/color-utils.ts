import { ColorSpace, SimplePaint } from './types'
import { lerp } from './geometry-utils'

// Clamp value to [0, 1]
function clamp(v: number): number {
  return Math.max(0, Math.min(1, v))
}

// Convert RGB to HSL
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l }
  }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

  let h = 0
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6
  } else {
    h = ((r - g) / d + 4) / 6
  }

  return { h, s, l }
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

// Convert HSL to RGB
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    return { r: l, g: l, b: l }
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  return {
    r: hueToRgb(p, q, h + 1 / 3),
    g: hueToRgb(p, q, h),
    b: hueToRgb(p, q, h - 1 / 3),
  }
}

// Interpolate between two hue angles, taking the shortest path
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a
  if (diff > 0.5) diff -= 1
  if (diff < -0.5) diff += 1
  let result = a + diff * t
  if (result < 0) result += 1
  if (result > 1) result -= 1
  return result
}

// Interpolate between two RGB colors
export function lerpColor(
  colorA: { r: number; g: number; b: number },
  colorB: { r: number; g: number; b: number },
  t: number,
  space: ColorSpace
): { r: number; g: number; b: number } {
  if (space === 'RGB') {
    return {
      r: clamp(lerp(colorA.r, colorB.r, t)),
      g: clamp(lerp(colorA.g, colorB.g, t)),
      b: clamp(lerp(colorA.b, colorB.b, t)),
    }
  }

  // HSL space — hue takes shortest path
  const hslA = rgbToHsl(colorA.r, colorA.g, colorA.b)
  const hslB = rgbToHsl(colorB.r, colorB.g, colorB.b)

  const h = lerpAngle(hslA.h, hslB.h, t)
  const s = clamp(lerp(hslA.s, hslB.s, t))
  const l = clamp(lerp(hslA.l, hslB.l, t))

  return hslToRgb(h, s, l)
}

// Simplify a Figma Paint to our internal SimplePaint format
export function simplifyPaint(paint: Paint): SimplePaint | null {
  if (paint.type !== 'SOLID' || !paint.color) return null
  return {
    type: 'SOLID',
    color: {
      r: paint.color.r,
      g: paint.color.g,
      b: paint.color.b,
    },
    opacity: paint.opacity ?? 1,
    visible: paint.visible !== false,
  }
}

// Interpolate between two SolidPaints
export function lerpSolidPaint(
  paintA: SimplePaint | null,
  paintB: SimplePaint | null,
  t: number,
  space: ColorSpace
): SolidPaint | null {
  // Handle cases where one or both paints are missing
  if (!paintA && !paintB) return null
  if (!paintA) {
    // Fade in paintB
    if (t < 0.5) return null
    const opacity = paintB!.opacity * ((t - 0.5) * 2)
    return {
      type: 'SOLID',
      color: { ...paintB!.color },
      opacity: clamp(opacity),
      visible: true,
    }
  }
  if (!paintB) {
    // Fade out paintA
    if (t > 0.5) return null
    const opacity = paintA.opacity * ((0.5 - t) * 2)
    return {
      type: 'SOLID',
      color: { ...paintA.color },
      opacity: clamp(opacity),
      visible: true,
    }
  }

  // Both present — interpolate
  const color = lerpColor(paintA.color, paintB.color, t, space)
  const opacity = clamp(lerp(paintA.opacity, paintB.opacity, t))

  return {
    type: 'SOLID',
    color,
    opacity,
    visible: true,
  }
}

// Build a Figma SolidPaint from SimplePaint
export function toFigmaPaint(paint: SimplePaint): SolidPaint {
  return {
    type: 'SOLID',
    color: { ...paint.color },
    opacity: paint.opacity,
    visible: paint.visible,
  }
}
