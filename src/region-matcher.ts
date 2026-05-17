import { CubicBezierLoop, NormalizedRegion } from './types'
import { loopArea } from './geometry-utils'

// Match regions between path A and path B.
// Regions are paired by area (largest to largest).
// Unmatched regions are paired with a degenerate region (empty loop).
export interface MatchedRegion {
  regionA: NormalizedRegion
  regionB: NormalizedRegion
}

export function matchRegions(
  regionsA: NormalizedRegion[],
  regionsB: NormalizedRegion[]
): MatchedRegion[] {
  // Sort by total area (descending)
  const sortedA = [...regionsA].sort(
    (a, b) => totalRegionArea(b) - totalRegionArea(a)
  )
  const sortedB = [...regionsB].sort(
    (a, b) => totalRegionArea(b) - totalRegionArea(a)
  )

  const maxLen = Math.max(sortedA.length, sortedB.length)
  const matches: MatchedRegion[] = []

  for (let i = 0; i < maxLen; i++) {
    const ra = sortedA[i] ?? degenerateRegion()
    const rb = sortedB[i] ?? degenerateRegion()
    matches.push({ regionA: ra, regionB: rb })
  }

  return matches
}

function totalRegionArea(region: NormalizedRegion): number {
  return region.loops.reduce((sum, loop) => sum + loopArea(loop), 0)
}

function degenerateRegion(): NormalizedRegion {
  return {
    loops: [{ segments: [] }],
    windingRule: 'NONZERO',
    fills: [],
  }
}
