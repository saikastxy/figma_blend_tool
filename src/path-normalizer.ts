import { CubicBezierLoop, CubicBezierSegment, Vec2 } from './types'
import {
  cubicBezierLength,
  extractSubsegment,
  loopArea,
  sub,
  windingDirection,
} from './geometry-utils'

const EPSILON = 0.001

// Reverse a loop (flip direction)
export function reverseLoop(loop: CubicBezierLoop): CubicBezierLoop {
  const reversed: CubicBezierSegment[] = []
  for (let i = loop.segments.length - 1; i >= 0; i--) {
    const seg = loop.segments[i]
    reversed.push({
      p0: seg.p3,
      p1: seg.p2,
      p2: seg.p1,
      p3: seg.p0,
    })
  }
  return { segments: reversed }
}

// Get the vertex points of a loop in order (the p0 of each segment)
export function loopVertices(loop: CubicBezierLoop): Vec2[] {
  return loop.segments.map((s) => s.p0)
}

// Compute arc-length parameter for each vertex boundary [0, t1, t2, ..., 1]
export function segmentParams(loop: CubicBezierLoop): number[] {
  const lengths = loop.segments.map((s) => cubicBezierLength(s.p0, s.p1, s.p2, s.p3))
  const total = lengths.reduce((a, b) => a + b, 0)
  if (total < EPSILON) {
    // Degenerate — distribute evenly
    const n = loop.segments.length
    return Array.from({ length: n + 1 }, (_, i) => i / n)
  }

  const params: number[] = [0]
  let cum = 0
  for (const len of lengths) {
    cum += len
    params.push(cum / total)
  }
  // Last should be exactly 1
  params[params.length - 1] = 1
  return params
}

// Build param ranges for each segment: [[start, end], ...]
export function segmentParamRanges(loop: CubicBezierLoop): [number, number][] {
  const params = segmentParams(loop)
  const ranges: [number, number][] = []
  for (let i = 0; i < loop.segments.length; i++) {
    ranges.push([params[i], params[i + 1]])
  }
  return ranges
}

// Rebuild a loop so that vertices exist at all the given parameter values.
// Merged params must include 0 and 1 and must be sorted.
function rebuildLoopAtParams(
  loop: CubicBezierLoop,
  mergedParams: number[]
): CubicBezierLoop {
  const newSegments: CubicBezierSegment[] = []
  const ranges = segmentParamRanges(loop)

  let si = 0 // current segment index in source loop

  for (let pi = 0; pi < mergedParams.length - 1; pi++) {
    const p0 = mergedParams[pi]
    const p1 = mergedParams[pi + 1]
    if (p1 - p0 < EPSILON) continue

    // Advance to the segment containing p0
    while (si < ranges.length && ranges[si][1] < p0 + EPSILON) {
      si++
    }
    if (si >= ranges.length) break

    const [segStart, segEnd] = ranges[si]
    const localT0 = Math.max(0, (p0 - segStart) / (segEnd - segStart))
    const localT1 = Math.min(1, (p1 - segStart) / (segEnd - segStart))

    if (localT0 < EPSILON && localT1 > 1 - EPSILON) {
      newSegments.push(loop.segments[si])
    } else {
      newSegments.push(extractSubsegment(loop.segments[si], localT0, localT1))
    }

    // If p1 reached the end of this source segment, advance
    if (Math.abs(p1 - segEnd) < EPSILON) {
      si++
    }
  }

  return { segments: newSegments }
}

// Equalize two loops so they have the same number of segments
// by inserting vertices (subdividing segments) at matching arc-length positions
export function equalizeLoops(
  loopA: CubicBezierLoop,
  loopB: CubicBezierLoop
): [CubicBezierLoop, CubicBezierLoop] {
  if (loopA.segments.length === 0 || loopB.segments.length === 0) {
    return [loopA, loopB]
  }

  const paramsA = segmentParams(loopA)
  const paramsB = segmentParams(loopB)

  // Merge all unique param values, sorted
  const merged = [...new Set([...paramsA, ...paramsB])].sort((a, b) => a - b)

  return [
    rebuildLoopAtParams(loopA, merged),
    rebuildLoopAtParams(loopB, merged),
  ]
}

// Detect winding direction of a loop and reverse one if they differ
export function unifyDirection(
  loopA: CubicBezierLoop,
  loopB: CubicBezierLoop
): [CubicBezierLoop, CubicBezierLoop] {
  const vertsA = loopVertices(loopA)
  const vertsB = loopVertices(loopB)

  const dirA = windingDirection(vertsA)
  const dirB = windingDirection(vertsB)

  if (Math.sign(dirA) !== Math.sign(dirB) && Math.abs(dirB) > EPSILON) {
    return [loopA, reverseLoop(loopB)]
  }

  return [loopA, loopB]
}

// Extract loops from a Figma VectorNetwork.
// If regions exist, use their loops. Otherwise, trace segments to build loops.
export function extractLoops(
  vertices: readonly VectorVertex[],
  segments: readonly VectorSegment[],
  regions: readonly VectorRegion[] | undefined
): CubicBezierLoop[] {
  if (regions && regions.length > 0) {
    const allLoops: CubicBezierLoop[] = []
    for (const region of regions) {
      for (const loop of region.loops) {
        const bezierSegs = loopToBezierSegments(vertices, segments, [...loop])
        if (bezierSegs.length > 0) {
          allLoops.push({ segments: bezierSegs })
        }
      }
    }
    return allLoops
  }

  // No regions — trace the segments to build the loop
  const orderedSegIndices = traceSegments(segments)
  const bezierSegs = loopToBezierSegments(vertices, segments, orderedSegIndices)
  return bezierSegs.length > 0 ? [{ segments: bezierSegs }] : []
}

// Convert a loop (ordered segment indices) to cubic bezier segments
function loopToBezierSegments(
  vertices: readonly VectorVertex[],
  segments: readonly VectorSegment[],
  loop: number[]
): CubicBezierSegment[] {
  const result: CubicBezierSegment[] = []
  for (const segIdx of loop) {
    const seg = segments[segIdx]
    const vStart = vertices[seg.start]
    const vEnd = vertices[seg.end]

    const p0 = { x: vStart.x, y: vStart.y }
    const p3 = { x: vEnd.x, y: vEnd.y }
    const p1 = seg.tangentStart
      ? { x: vStart.x + seg.tangentStart.x, y: vStart.y + seg.tangentStart.y }
      : { ...p0 }
    const p2 = seg.tangentEnd
      ? { x: vEnd.x + seg.tangentEnd.x, y: vEnd.y + seg.tangentEnd.y }
      : { ...p3 }

    result.push({ p0, p1, p2, p3 })
  }
  return result
}

// Trace segments into a continuous loop order by following start→end chain
function traceSegments(segments: readonly VectorSegment[]): number[] {
  if (segments.length === 0) return []

  // Build adjacency: start vertex → segment index
  const outgoing = new Map<number, number>()
  for (let i = 0; i < segments.length; i++) {
    outgoing.set(segments[i].start, i)
  }

  const order: number[] = []
  const visited = new Set<number>()
  let current = 0

  while (!visited.has(current) && order.length < segments.length) {
    visited.add(current)
    order.push(current)
    const nextStart = segments[current].end
    const next = outgoing.get(nextStart)
    if (next === undefined || visited.has(next)) break
    current = next
  }

  return order
}

// Sort loops by area (descending) for region matching
export function sortLoopsByArea(loops: CubicBezierLoop[]): CubicBezierLoop[] {
  return [...loops].sort((a, b) => loopArea(b) - loopArea(a))
}

// Fully normalize a loop for blending: unify direction, equalize vertices
export function normalizeLoopPair(
  loopA: CubicBezierLoop,
  loopB: CubicBezierLoop
): [CubicBezierLoop, CubicBezierLoop] {
  const [dirA, dirB] = unifyDirection(loopA, loopB)
  return equalizeLoops(dirA, dirB)
}
