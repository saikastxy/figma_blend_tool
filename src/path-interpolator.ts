import { CubicBezierLoop, CubicBezierSegment, Vec2 } from './types'
import { lerpVec2 } from './geometry-utils'

// Linearly interpolate two cubic bezier segments
export function interpolateSegment(
  segA: CubicBezierSegment,
  segB: CubicBezierSegment,
  t: number
): CubicBezierSegment {
  return {
    p0: lerpVec2(segA.p0, segB.p0, t),
    p1: lerpVec2(segA.p1, segB.p1, t),
    p2: lerpVec2(segA.p2, segB.p2, t),
    p3: lerpVec2(segA.p3, segB.p3, t),
  }
}

// Interpolate two loops with the same number of segments
export function interpolateLoop(
  loopA: CubicBezierLoop,
  loopB: CubicBezierLoop,
  t: number
): CubicBezierLoop {
  const n = Math.min(loopA.segments.length, loopB.segments.length)
  const segments: CubicBezierSegment[] = []
  for (let i = 0; i < n; i++) {
    segments.push(interpolateSegment(loopA.segments[i], loopB.segments[i], t))
  }
  return { segments, closed: loopA.closed }
}

// Interpolate node position
export function interpolatePosition(
  posA: { x: number; y: number },
  posB: { x: number; y: number },
  t: number
): { x: number; y: number } {
  return {
    x: posA.x + (posB.x - posA.x) * t,
    y: posA.y + (posB.y - posA.y) * t,
  }
}
