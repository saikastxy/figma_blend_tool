import { CubicBezierLoop } from './types'

// Build a Figma VectorNetwork from a CubicBezierLoop
export function buildVectorNetwork(loop: CubicBezierLoop): VectorNetwork {
  const N = loop.segments.length
  if (N === 0) {
    return { vertices: [], segments: [], regions: [] }
  }

  const vertices: VectorVertex[] = []
  const segments: VectorSegment[] = []

  // Create vertices (one per segment's start point)
  for (let i = 0; i < N; i++) {
    const seg = loop.segments[i]
    vertices.push({
      x: seg.p0.x,
      y: seg.p0.y,
      strokeCap: 'NONE',
      strokeJoin: 'MITER',
      cornerRadius: 0,
      handleMirroring: 'NONE',
    })
  }

  // Create segments connecting consecutive vertices
  for (let i = 0; i < N; i++) {
    const seg = loop.segments[i]
    const endIdx = (i + 1) % N

    segments.push({
      start: i,
      end: endIdx,
      tangentStart: {
        x: seg.p1.x - seg.p0.x,
        y: seg.p1.y - seg.p0.y,
      },
      tangentEnd: {
        x: seg.p2.x - seg.p3.x,
        y: seg.p2.y - seg.p3.y,
      },
    })
  }

  return {
    vertices,
    segments,
    regions: [
      {
        windingRule: 'NONZERO',
        loops: [segments.map((_, i) => i)],
        fills: [],
      },
    ],
  }
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

  const allVertices: VectorVertex[] = []
  const allSegments: VectorSegment[] = []
  const regionLoops: number[][] = []
  let vertexOffset = 0

  for (let li = 0; li < loops.length; li++) {
    const loop = loops[li]
    const N = loop.segments.length
    if (N === 0) continue

    // Add vertices
    for (let i = 0; i < N; i++) {
      const seg = loop.segments[i]
      allVertices.push({
        x: seg.p0.x,
        y: seg.p0.y,
        strokeCap: 'NONE',
        strokeJoin: 'MITER',
        cornerRadius: 0,
        handleMirroring: 'NONE',
      })
    }

    // Add segments
    const loopSegIndices: number[] = []
    for (let i = 0; i < N; i++) {
      const seg = loop.segments[i]
      const localStart = vertexOffset + i
      const localEnd = vertexOffset + (i + 1) % N

      allSegments.push({
        start: localStart,
        end: localEnd,
        tangentStart: {
          x: seg.p1.x - seg.p0.x,
          y: seg.p1.y - seg.p0.y,
        },
        tangentEnd: {
          x: seg.p2.x - seg.p3.x,
          y: seg.p2.y - seg.p3.y,
        },
      })

      loopSegIndices.push(allSegments.length - 1)
    }

    regionLoops.push(loopSegIndices)
    vertexOffset += N
  }

  return {
    vertices: allVertices,
    segments: allSegments,
    regions: [
      {
        windingRule: windingRules[0] ?? 'NONZERO',
        loops: regionLoops,
        fills: [],
      },
    ],
  }
}
