import { BlendOptions, CubicBezierLoop, Vec2 } from './types'
import { extractLoops, normalizeLoopPair, sortLoopsByArea } from './path-normalizer'
import { interpolateLoop, interpolatePosition } from './path-interpolator'
import { interpolateFills, interpolateStrokes, interpolateOpacity } from './color-interpolator'
import { buildCompoundVectorNetwork } from './vector-builder'
import { sampleLoopAtParam, verticesCenter, lerpVec2 } from './geometry-utils'

export interface BlendInput {
  netA: VectorNetwork
  netB: VectorNetwork
  fillsA: readonly Paint[]
  fillsB: readonly Paint[]
  strokesA: readonly Paint[]
  strokesB: readonly Paint[]
  strokeWeightA: number
  strokeWeightB: number
  opacityA: number
  opacityB: number
  posA: { x: number; y: number }
  posB: { x: number; y: number }
  cornerRadiiA: number[]
  cornerRadiiB: number[]
  ratioA: number
  ratioB: number
  parent: BaseNode & ChildrenMixin
  spineLoops?: CubicBezierLoop[]
  spineOrigin?: { x: number; y: number }
}

// Creates intermediate vector nodes between A and B.
// All geometry data is passed explicitly — no temporary document nodes needed.
export async function blend(
  input: BlendInput,
  options: BlendOptions
): Promise<VectorNode[]> {
  const {
    netA, netB,
    fillsA, fillsB,
    strokesA, strokesB,
    strokeWeightA, strokeWeightB,
    opacityA, opacityB,
    posA, posB,
    cornerRadiiA, cornerRadiiB,
    ratioA, ratioB,
    parent,
    spineLoops,
    spineOrigin,
  } = input
  const { steps, colorSpace, useSpine } = options

  const loopsA = extractLoops(netA.vertices, netA.segments, netA.regions)
  const loopsB = extractLoops(netB.vertices, netB.segments, netB.regions)

  if (loopsA.length === 0 || loopsB.length === 0) {
    throw new Error('Could not extract path data from one of the nodes')
  }

  // steps = total count including originals (A + intermediates + B)
  const intermediateCount = Math.max(0, steps - 2)

  // Compute local centers for spine centering
  const centerA = verticesCenter(netA.vertices)
  const centerB = verticesCenter(netB.vertices)

  const results: VectorNode[] = []

  for (let i = 1; i <= intermediateCount; i++) {
    const t = i / (intermediateCount + 1)

    const interpolatedLoops = interpolateAllLoops(loopsA, loopsB, t)

    const net = buildCompoundVectorNetwork(
      interpolatedLoops,
      getWindingRules(netA)
    )

    // Interpolate corner radii per vertex
    applyCornerRadii(net, cornerRadiiA, cornerRadiiB, t)

    // Adjust inner vertices for star ratio interpolation
    applyStarRatio(net, ratioA, ratioB, t)

    const vecNode = figma.createVector()
    await vecNode.setVectorNetworkAsync(net)

    const interpCenter = lerpVec2(centerA, centerB, t)
    const pos = useSpine && spineLoops && spineLoops.length > 0
      ? (() => {
          const spinePt = computeSpinePosition(spineLoops, spineOrigin ?? { x: 0, y: 0 }, t)
          return { x: spinePt.x - interpCenter.x, y: spinePt.y - interpCenter.y }
        })()
      : interpolatePosition(posA, posB, t)
    vecNode.x = pos.x
    vecNode.y = pos.y

    const fills = interpolateFills(fillsA, fillsB, t, colorSpace)
    if (fills.length > 0) vecNode.fills = fills

    const strokes = interpolateStrokes(strokesA, strokesB, t, colorSpace)
    if (strokes.length > 0) vecNode.strokes = strokes

    vecNode.strokeWeight = strokeWeightA + (strokeWeightB - strokeWeightA) * t
    vecNode.opacity = interpolateOpacity(opacityA, opacityB, t)

    parent.appendChild(vecNode)
    results.push(vecNode)
  }

  return results
}

function computeSpinePosition(
  spineLoops: CubicBezierLoop[],
  spineOrigin: { x: number; y: number },
  t: number
): Vec2 {
  const best = spineLoops.reduce((a, b) =>
    a.segments.length >= b.segments.length ? a : b
  )
  const pt = sampleLoopAtParam(best, t)
  if (!pt) return { x: spineOrigin.x, y: spineOrigin.y }
  // Convert from spine local coords to document coords
  return { x: spineOrigin.x + pt.x, y: spineOrigin.y + pt.y }
}

function interpolateAllLoops(
  loopsA: CubicBezierLoop[],
  loopsB: CubicBezierLoop[],
  t: number
): CubicBezierLoop[] {
  const sortedA = sortLoopsByArea(loopsA)
  const sortedB = sortLoopsByArea(loopsB)

  const maxLen = Math.max(sortedA.length, sortedB.length)
  const result: CubicBezierLoop[] = []

  for (let i = 0; i < maxLen; i++) {
    const la = sortedA[i] ?? emptyLoop()
    const lb = sortedB[i] ?? emptyLoop()

    if (la.segments.length === 0) {
      result.push(lb)
    } else if (lb.segments.length === 0) {
      result.push(la)
    } else {
      const [normA, normB] = normalizeLoopPair(la, lb)
      result.push(interpolateLoop(normA, normB, t))
    }
  }

  return result
}

function emptyLoop(): CubicBezierLoop {
  return { segments: [], closed: true }
}

function getWindingRules(net: VectorNetwork): WindingRule[] {
  return net.regions?.map((r) => r.windingRule) ?? ['NONZERO']
}

// Apply interpolated corner radii to a built VectorNetwork.
// If vertex counts match both source arrays, lerp per-vertex.
// Otherwise (path equalization changed vertex count), fall back to 0.
function applyCornerRadii(
  net: VectorNetwork,
  radiiA: number[],
  radiiB: number[],
  t: number
): void {
  if (radiiA.length === 0 && radiiB.length === 0) return

  const n = net.vertices.length
  const matchA = n === radiiA.length
  const matchB = n === radiiB.length

  for (let i = 0; i < n; i++) {
    const crA = i < radiiA.length ? radiiA[i] : 0
    const crB = i < radiiB.length ? radiiB[i] : 0
    net.vertices[i].cornerRadius = (matchA || matchB)
      ? crA + (crB - crA) * t
      : 0
  }
}

// Adjust inner vertices of star-like intermediate shapes to match the
// interpolated star ratio. Only active when both source shapes are stars
// (ratio < 1.0). Inner vertices are those significantly closer to the
// shape center; they are scaled so their distance from center equals
// maxDistance * interpolatedRatio.
function applyStarRatio(
  net: VectorNetwork,
  ratioA: number,
  ratioB: number,
  t: number
): void {
  // Only apply when both source shapes are actual stars (ratio < 1)
  if (ratioA >= 1.0 && ratioB >= 1.0) return

  const vertices = net.vertices
  const n = vertices.length
  if (n < 6) return // stars have at least 6 vertices (3-pointed)

  // Compute center
  let cx = 0, cy = 0
  for (const v of vertices) { cx += v.x; cy += v.y }
  cx /= n
  cy /= n

  // Compute distances from center
  const distances = vertices.map((v) => Math.hypot(v.x - cx, v.y - cy))
  const maxDist = Math.max(...distances)
  if (maxDist < 0.001) return

  const targetRatio = ratioA + (ratioB - ratioA) * t

  for (let i = 0; i < n; i++) {
    const d = distances[i]
    // Inner vertices: closer to center than 90% of max distance
    if (d < maxDist * 0.9) {
      const targetDist = maxDist * targetRatio
      const scale = d > 0.001 ? targetDist / d : 1.0
      vertices[i].x = cx + (vertices[i].x - cx) * scale
      vertices[i].y = cy + (vertices[i].y - cy) * scale
    }
  }
}
