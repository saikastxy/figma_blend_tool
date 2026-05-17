import { BlendOptions, CubicBezierLoop } from './types'
import { extractLoops, normalizeLoopPair, sortLoopsByArea } from './path-normalizer'
import { interpolateLoop, interpolatePosition } from './path-interpolator'
import { interpolateFills, interpolateStrokes, interpolateOpacity } from './color-interpolator'
import { buildCompoundVectorNetwork } from './vector-builder'

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
  parent: BaseNode & ChildrenMixin
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
    parent,
  } = input
  const { steps, colorSpace } = options

  const loopsA = extractLoops(netA.vertices, netA.segments, netA.regions)
  const loopsB = extractLoops(netB.vertices, netB.segments, netB.regions)

  if (loopsA.length === 0 || loopsB.length === 0) {
    throw new Error('Could not extract path data from one of the nodes')
  }

  // steps = total count including originals (A + intermediates + B)
  const intermediateCount = Math.max(0, steps - 2)

  const results: VectorNode[] = []

  for (let i = 1; i <= intermediateCount; i++) {
    const t = i / (intermediateCount + 1)

    const interpolatedLoops = interpolateAllLoops(loopsA, loopsB, t)

    const net = buildCompoundVectorNetwork(
      interpolatedLoops,
      getWindingRules(netA)
    )

    const vecNode = figma.createVector()
    await vecNode.setVectorNetworkAsync(net)

    const pos = interpolatePosition(posA, posB, t)
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
  return { segments: [] }
}

function getWindingRules(net: VectorNetwork): WindingRule[] {
  return net.regions?.map((r) => r.windingRule) ?? ['NONZERO']
}
