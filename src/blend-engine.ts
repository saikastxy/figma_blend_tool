import { BlendOptions, ColorSpace, CubicBezierLoop, NormalizedRegion } from './types'
import { extractLoops, normalizeLoopPair, sortLoopsByArea } from './path-normalizer'
import { interpolateLoop, interpolatePosition } from './path-interpolator'
import { interpolateFills, interpolateStrokes, interpolateOpacity } from './color-interpolator'
import { matchRegions } from './region-matcher'
import { buildVectorNetwork, buildCompoundVectorNetwork } from './vector-builder'

export interface BlendInput {
  nodeA: VectorNode
  nodeB: VectorNode
}

export interface BlendOutput {
  nodes: VectorNode[]
  group: GroupNode | null
}

// Main blend function: takes two vector nodes and options, returns intermediate nodes
export async function blend(input: BlendInput, options: BlendOptions): Promise<BlendOutput> {
  const { nodeA, nodeB } = input
  const { steps, colorSpace, shouldGroup } = options

  // Read geometry from both nodes
  const netA = nodeA.vectorNetwork
  const netB = nodeB.vectorNetwork

  if (!netA || !netB) {
    throw new Error('One of the selected nodes has no vector network')
  }

  // Extract loops from both networks
  const loopsA = extractLoops(netA.vertices, netA.segments, netA.regions)
  const loopsB = extractLoops(netB.vertices, netB.segments, netB.regions)

  if (loopsA.length === 0 || loopsB.length === 0) {
    throw new Error('Could not extract path data from one of the nodes')
  }

  // For simple single-region paths, interpolate directly
  // For multi-region paths, match and interpolate each pair
  const results: VectorNode[] = []
  const parent = nodeA.parent ?? figma.currentPage

  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1)

    // Normalize and interpolate each loop pair
    const interpolatedLoops = interpolateAllLoops(loopsA, loopsB, t)

    // Build the VectorNetwork
    const net = buildCompoundVectorNetwork(
      interpolatedLoops,
      getWindingRules(netA)
    )

    // Create the vector node and set its geometry (async in dynamic-page mode)
    const vecNode = figma.createVector()
    await vecNode.setVectorNetworkAsync(net)

    // Interpolate position
    const pos = interpolatePosition(nodeA, nodeB, t)
    vecNode.x = pos.x
    vecNode.y = pos.y

    // Interpolate fills
    const fills = interpolateFills(
      nodeA.fills as readonly Paint[],
      nodeB.fills as readonly Paint[],
      t,
      colorSpace
    )
    if (fills.length > 0) {
      vecNode.fills = fills
    }

    // Interpolate strokes
    const strokes = interpolateStrokes(
      nodeA.strokes as readonly Paint[],
      nodeB.strokes as readonly Paint[],
      t,
      colorSpace
    )
    if (strokes.length > 0) {
      vecNode.strokes = strokes
    }

    // Interpolate stroke weight
    vecNode.strokeWeight = (nodeA.strokeWeight as number) + ((nodeB.strokeWeight as number) - (nodeA.strokeWeight as number)) * t

    // Interpolate opacity
    vecNode.opacity = interpolateOpacity(nodeA.opacity, nodeB.opacity, t)

    // Insert into the page (after nodeB to maintain visual order)
    parent.appendChild(vecNode)

    results.push(vecNode)
  }

  // Group if requested
  let group: GroupNode | null = null
  if (shouldGroup) {
    const allNodes = [nodeA, ...results, nodeB]
    group = figma.group(allNodes, parent)
    group.name = 'Blend Group'
  }

  return { nodes: results, group }
}

// Interpolate all loops between two paths
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
      // Fade in loop B
      result.push(lb)
    } else if (lb.segments.length === 0) {
      // Fade out loop A
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
