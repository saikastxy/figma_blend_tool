import { Vec2, CubicBezierSegment } from './types'

export function vec(x: number, y: number): Vec2 {
  return { x, y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s }
}

export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(distSq(a, b))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Evaluate cubic bezier at parameter t using De Casteljau
export function cubicBezierPoint(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number
): Vec2 {
  const mt = 1 - t
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  }
}

// Subdivide cubic bezier at t using De Casteljau
// Returns left and right halves, each as [P0, P1, P2, P3]
export function subdivideCubicBezier(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number
): { left: [Vec2, Vec2, Vec2, Vec2]; right: [Vec2, Vec2, Vec2, Vec2] } {
  const q0 = lerpVec2(p0, p1, t)
  const q1 = lerpVec2(p1, p2, t)
  const q2 = lerpVec2(p2, p3, t)
  const r0 = lerpVec2(q0, q1, t)
  const r1 = lerpVec2(q1, q2, t)
  const s = lerpVec2(r0, r1, t)

  return {
    left: [p0, q0, r0, s],
    right: [s, r1, q2, p3],
  }
}

// Extract a subsegment of a cubic bezier from t0 to t1
export function extractSubsegment(
  seg: CubicBezierSegment,
  t0: number,
  t1: number
): CubicBezierSegment {
  if (t0 <= 0.001 && t1 >= 0.999) return seg

  // Subdivide at t1, take left half
  const { left } = subdivideCubicBezier(seg.p0, seg.p1, seg.p2, seg.p3, t1)

  if (t0 <= 0.001) {
    return { p0: left[0], p1: left[1], p2: left[2], p3: left[3] }
  }

  // Subdivide left half at t0/t1 to get the portion from t0 to t1
  const t0prime = t0 / t1
  const { right } = subdivideCubicBezier(left[0], left[1], left[2], left[3], t0prime)

  return { p0: right[0], p1: right[1], p2: right[2], p3: right[3] }
}

// Approximate arc length of cubic bezier by sampling
export function cubicBezierLength(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2
): number {
  const steps = 20
  let length = 0
  let prev = p0
  for (let i = 1; i <= steps; i++) {
    const pt = cubicBezierPoint(p0, p1, p2, p3, i / steps)
    length += dist(prev, pt)
    prev = pt
  }
  return length
}

// Shoelace formula: signed area of polygon
// Positive = counter-clockwise, negative = clockwise
export function windingDirection(vertices: Vec2[]): number {
  let area = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += vertices[i].x * vertices[j].y
    area -= vertices[j].x * vertices[i].y
  }
  return area
}

// Compute total arc length of a CubicBezierLoop
export function loopArcLength(loop: { segments: CubicBezierSegment[] }): number {
  let total = 0
  for (const seg of loop.segments) {
    total += cubicBezierLength(seg.p0, seg.p1, seg.p2, seg.p3)
  }
  return total
}

// Sample a point on a CubicBezierLoop at arc-length parameter t (0-1)
// Returns null if the loop has no segments
export function sampleLoopAtParam(
  loop: { segments: CubicBezierSegment[] },
  t: number
): Vec2 | null {
  if (loop.segments.length === 0) return null

  const ct = Math.max(0, Math.min(1, t))
  const total = loopArcLength(loop)
  if (total < 0.0001) return { ...loop.segments[0].p0 }

  const targetDist = ct * total
  let cum = 0

  for (const seg of loop.segments) {
    const segLen = cubicBezierLength(seg.p0, seg.p1, seg.p2, seg.p3)
    if (cum + segLen >= targetDist || cum + segLen >= total - 0.0001) {
      const localT = segLen < 0.0001 ? 0 : (targetDist - cum) / segLen
      return cubicBezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, Math.max(0, Math.min(1, localT)))
    }
    cum += segLen
  }

  // Fallback: return end of last segment
  const last = loop.segments[loop.segments.length - 1]
  return { ...last.p3 }
}

// Calculate the approximate area of a closed cubic bezier loop
export function loopArea(loop: { segments: CubicBezierSegment[] }): number {
  // Sample each segment at several points and use shoelace
  const pts: Vec2[] = []
  for (const seg of loop.segments) {
    const samples = 8
    for (let i = 0; i < samples; i++) {
      pts.push(cubicBezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, i / samples))
    }
  }
  return Math.abs(windingDirection(pts)) / 2
}
