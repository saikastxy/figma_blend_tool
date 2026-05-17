// Internal representation of a 2D vector
export interface Vec2 {
  x: number
  y: number
}

// A cubic bezier segment defined by four control points
export interface CubicBezierSegment {
  p0: Vec2 // start point
  p1: Vec2 // first control point (handle out from start)
  p2: Vec2 // second control point (handle in to end)
  p3: Vec2 // end point
}

// A closed loop of cubic bezier segments
export interface CubicBezierLoop {
  segments: CubicBezierSegment[]
}

// A region groups one or more loops with shared fill
export interface NormalizedRegion {
  loops: CubicBezierLoop[]
  windingRule: WindingRule
  fills: Paint[]
  fillStyleId?: string
}

// Full normalized representation of a vector node
export interface NormalizedPath {
  regions: NormalizedRegion[]
  strokes: Paint[]
  strokeWeight: number
  strokeAlign?: string
}

export type ColorSpace = 'RGB' | 'HSL'

export type WindingRule = 'NONZERO' | 'EVENODD'

// Simplified Paint type for color operations
export interface SimplePaint {
  type: 'SOLID'
  color: { r: number; g: number; b: number }
  opacity: number
  visible: boolean
}

export interface BlendOptions {
  steps: number
  colorSpace: ColorSpace
  shouldGroup: boolean
}

// Messages between UI (iframe) and main thread
export type UIMessage =
  | { type: 'CHECK_SELECTION' }
  | { type: 'BLEND'; options: BlendOptions }
  | { type: 'CANCEL' }

export type MainMessage =
  | { type: 'SELECTION'; count: number; valid: boolean; message: string }
  | { type: 'RESULT'; success: true; nodeCount: number }
  | { type: 'ERROR'; message: string }
  | { type: 'PROGRESS'; current: number; total: number }
