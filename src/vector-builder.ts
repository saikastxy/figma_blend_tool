import { CubicBezierLoop } from './types'

function makeVertex(x: number, y: number): VectorVertex {
  return {
    x, y,
    strokeCap: 'NONE',
    strokeJoin: 'MITER',
    cornerRadius: 0,
    handleMirroring: 'NONE',
  }
}

// Build a Figma VectorNetwork from a CubicBezierLoop (open or closed)
export function buildVectorNetwork(loop: CubicBezierLoop): VectorNetwork {
  const N = loop.segments.length
  if (N === 0) {
    return { vertices: [], segments: [], regions: [] }
  }

  if (loop.closed) {
    return buildClosedNetwork(loop)
  }
  return buildOpenNetwork(loop)
}

function buildClosedNetwork(loop: CubicBezierLoop): VectorNetwork {
  const N = loop.segments.length
  const vertices: VectorVertex[] = []
  const segments: VectorSegment[] = []

  for (let i = 0; i < N; i++) {
    vertices.push(makeVertex(loop.segments[i].p0.x, loop.segments[i].p0.y))
  }

  for (let i = 0; i < N; i++) {
    const seg = loop.segments[i]
    segments.push({
      start: i,
      end: (i + 1) % N,
      tangentStart: { x: seg.p1.x - seg.p0.x, y: seg.p1.y - seg.p0.y },
      tangentEnd: { x: seg.p2.x - seg.p3.x, y: seg.p2.y - seg.p3.y },
    })
  }

  return {
    vertices,
    segments,
    regions: [{
      windingRule: 'NONZERO',
      loops: [segments.map((_, i) => i)],
      fills: [],
    }],
  }
}

function buildOpenNetwork(loop: CubicBezierLoop): VectorNetwork {
  const N = loop.segments.length
  const vertices: VectorVertex[] = []
  const segments: VectorSegment[] = []

  // Open: N+1 vertices (all segment starts + last segment's end)
  for (let i = 0; i < N; i++) {
    vertices.push(makeVertex(loop.segments[i].p0.x, loop.segments[i].p0.y))
  }
  // Add terminal point
  const last = loop.segments[N - 1]
  vertices.push(makeVertex(last.p3.x, last.p3.y))

  for (let i = 0; i < N; i++) {
    const seg = loop.segments[i]
    segments.push({
      start: i,
      end: i + 1,
      tangentStart: { x: seg.p1.x - seg.p0.x, y: seg.p1.y - seg.p0.y },
      tangentEnd: { x: seg.p2.x - seg.p3.x, y: seg.p2.y - seg.p3.y },
    })
  }

  // Open paths have no regions
  return { vertices, segments }
}

// Build a VectorNetwork from multiple loops (for compound paths)
export function buildCompoundVectorNetwork(
  loops: CubicBezierLoop[],
  windingRules: WindingRule[] = []
): VectorNetwork {
  if (loops.length === 0) {
    return { vertices: [], segments: [], regions: [] }
  }

  if (loops.length === 1) {
    return buildVectorNetwork(loops[0])
  }

  // All loops must be the same type (all closed or all open)
  const closed = loops[0].closed
  const allVertices: VectorVertex[] = []
  const allSegments: VectorSegment[] = []
  const regionLoops: number[][] = []
  let vertexOffset = 0

  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li]
    const N = loop.segments.length
    if (N === 0) continue

    if (closed) {
      // Closed: N vertices, N segments (last wraps to first)
      for (let i = 0; i < N; i++) {
        allVertices.push(makeVertex(loop.segments[i].p0.x, loop.segments[i].p0.y))
      }
      const loopSegIndices: number[] = []
      for (let i = 0; i < N; i++) {
        const seg = loop.segments[i]
        allSegments.push({
          start: vertexOffset + i,
          end: vertexOffset + (i + 1) % N,
          tangentStart: { x: seg.p1.x - seg.p0.x, y: seg.p1.y - seg.p0.y },
          tangentEnd: { x: seg.p2.x - seg.p3.x, y: seg.p2.y - seg.p3.y },
        })
        loopSegIndices.push(allSegments.length - 1)
      }
      regionLoops.push(loopSegIndices)
      vertexOffset += N
    } else {
      // Open: N+1 vertices, N segments
      for (let i = 0; i < N; i++) {
        allVertices.push(makeVertex(loop.segments[i].p0.x, loop.segments[i].p0.y))
      }
      allVertices.push(makeVertex(loop.segments[N - 1].p3.x, loop.segments[N - 1].p3.y))

      for (let i = 0; i < N; i++) {
        const seg = loop.segments[i]
        allSegments.push({
          start: vertexOffset + i,
          end: vertexOffset + i + 1,
          tangentStart: { x: seg.p1.x - seg.p0.x, y: seg.p1.y - seg.p0.y },
          tangentEnd: { x: seg.p2.x - seg.p3.x, y: seg.p2.y - seg.p3.y },
        })
      }
      vertexOffset += N + 1
    }
  }

  if (!closed) {
    // Open paths: no regions
    return { vertices: allVertices, segments: allSegments }
  }

  return {
    vertices: allVertices,
    segments: allSegments,
    regions: [{
      windingRule: windingRules[0] ?? 'NONZERO',
      loops: regionLoops,
      fills: [],
    }],
  }
}
