import { blend } from './src/blend-engine'
import { BlendOptions, CubicBezierLoop, MainMessage, UIMessage } from './src/types'
import { extractLoops } from './src/path-normalizer'

// Shape types that can be blended
const BLENDABLE_TYPES = new Set([
  'VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE', 'POLYGON', 'STAR',
])

// Plugin entry point: show the UI
figma.showUI(__html__, {
  width: 320,
  height: 400,
  title: 'Blend Tool',
})

// Handle messages from UI
figma.ui.onmessage = (msg: UIMessage) => {
  switch (msg.type) {
    case 'CHECK_SELECTION':
      handleCheckSelection(msg.useSpine)
      break
    case 'BLEND':
      handleBlend(msg.options).catch((err) => {
        const message = err instanceof Error ? err.message : '混合失败'
        figma.ui.postMessage({ type: 'ERROR', message })
        figma.notify(message, { error: true })
      })
      break
    case 'CANCEL':
      figma.closePlugin()
      break
  }
}

// Check current selection and report back to UI
function handleCheckSelection(useSpine: boolean = false) {
  const sel = figma.currentPage.selection
  const expected = useSpine ? 3 : 2

  if (sel.length !== expected) {
    const hint = useSpine
      ? `请选中 2 个图形 + 1 条轴线路径（当前选中 ${sel.length} 个）`
      : `请选中 2 个图形（当前选中 ${sel.length} 个）`
    post({ type: 'SELECTION', count: sel.length, valid: false, message: hint })
    return
  }

  const blendItems = sel.slice(0, 2)
  const types = blendItems.map((n) => n.type)
  const allBlendable = types.every((t) => BLENDABLE_TYPES.has(t))

  if (!allBlendable) {
    post({ type: 'SELECTION', count: sel.length, valid: false, message: `不支持的图形类型（${types.join(', ')}）。支持：矩形、椭圆、多边形、星形、直线、矢量` })
    return
  }

  // Check open/closed consistency for the two blend shapes
  const closedA = isPathClosed(blendItems[0])
  const closedB = isPathClosed(blendItems[1])
  if (closedA !== closedB) {
    post({ type: 'SELECTION', count: sel.length, valid: false, message: `不能混用封闭图形和未封闭图形。请选中两个封闭图形或两个未封闭图形。` })
    return
  }

  if (useSpine) {
    const spineNode = sel[2]
    if (!BLENDABLE_TYPES.has(spineNode.type)) {
      post({ type: 'SELECTION', count: sel.length, valid: false, message: `轴线路径类型不支持（${spineNode.type}）。请使用矢量、矩形、椭圆、直线等类型。` })
      return
    }
  }

  const descA = describeNode(blendItems[0])
  const descB = describeNode(blendItems[1])
  const spineDesc = useSpine ? ` → 轴线: ${describeNode(sel[2])}` : ''
  post({ type: 'SELECTION', count: sel.length, valid: true, message: `已选中：${descA} + ${descB}${spineDesc}` })
}

// Detect if a node represents an open or closed path
function isPathClosed(node: BaseNode): boolean {
  if (node.type === 'LINE') return false
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'POLYGON' || node.type === 'STAR') return true
  if (node.type === 'VECTOR') {
    const vn = node as VectorNode
    const net = vn.vectorNetwork
    if (!net || typeof net === 'symbol') return true // assume closed as safe default
    // Has regions = closed; no regions = open
    return !!(net.regions && net.regions.length > 0)
  }
  return true
}

// Human-readable description of a node
function describeNode(node: BaseNode): string {
  const typeNames: Record<string, string> = {
    VECTOR: '矢量', RECTANGLE: '矩形', ELLIPSE: '椭圆', LINE: '直线', POLYGON: '多边形', STAR: '星形',
  }
  const typeName = typeNames[node.type] ?? node.type
  const closed = isPathClosed(node)
  return closed ? `[闭]${typeName}` : `[开]${typeName}`
}

// Extract corner radii per vertex from any blendable node type
function getCornerRadii(node: BaseNode): number[] {
  if (node.type === 'VECTOR') {
    const vn = node as VectorNode
    const vnNet = vn.vectorNetwork
    if (!vnNet || typeof vnNet === 'symbol') return []
    return vnNet.vertices.map((v) => v.cornerRadius ?? 0)
  }

  if (node.type === 'RECTANGLE') {
    const r = node as RectangleNode
    return [r.topLeftRadius, r.topRightRadius, r.bottomRightRadius, r.bottomLeftRadius]
  }

  if (node.type === 'ELLIPSE') {
    const e = node as EllipseNode
    return [e.topLeftRadius, e.topRightRadius, e.bottomRightRadius, e.bottomLeftRadius]
  }

  if (node.type === 'POLYGON') {
    const p = node as PolygonNode
    const cr = typeof p.cornerRadius === 'number' ? p.cornerRadius : 0
    return new Array(p.pointCount).fill(cr)
  }

  if (node.type === 'STAR') {
    const s = node as StarNode
    const cr = typeof s.cornerRadius === 'number' ? s.cornerRadius : 0
    return new Array(s.pointCount * 2).fill(cr)
  }

  if (node.type === 'LINE') {
    return [0, 0]
  }

  return []
}

// Extract geometry from any blendable node type
function extractGeometry(node: BaseNode): {
  vectorNetwork: VectorNetwork
  fills: readonly Paint[]
  strokes: readonly Paint[]
  strokeWeight: number
  opacity: number
  x: number
  y: number
  cornerRadii: number[]
} {
  const sceneNode = node as SceneNode

  if (node.type === 'VECTOR') {
    const vn = node as VectorNode
    const vnNet = vn.vectorNetwork
    if (!vnNet || typeof vnNet === 'symbol') {
      throw new Error('Vector node has no accessible vectorNetwork')
    }
    return {
      vectorNetwork: vnNet,
      fills: vn.fills as readonly Paint[],
      strokes: vn.strokes as readonly Paint[],
      strokeWeight: vn.strokeWeight as number,
      opacity: vn.opacity,
      x: vn.x,
      y: vn.y,
      cornerRadii: getCornerRadii(node),
    }
  }

  return {
    vectorNetwork: buildShapeVectorNetwork(node),
    fills: (sceneNode as DefaultShapeMixin).fills as readonly Paint[],
    strokes: (sceneNode as DefaultShapeMixin).strokes as readonly Paint[],
    strokeWeight: (sceneNode as DefaultShapeMixin).strokeWeight as number,
    opacity: (sceneNode as MinimalBlendMixin).opacity,
    x: sceneNode.x,
    y: sceneNode.y,
    cornerRadii: getCornerRadii(node),
  }
}

// Build a VectorNetwork from basic shape types
function buildShapeVectorNetwork(node: BaseNode): VectorNetwork {
  if (node.type === 'RECTANGLE') {
    const r = node as RectangleNode
    return rectToVectorNetwork(r.width, r.height)
  }
  if (node.type === 'ELLIPSE') {
    const e = node as EllipseNode
    return ellipseToVectorNetwork(e.width, e.height)
  }
  if (node.type === 'LINE') {
    const l = node as LineNode
    return lineToVectorNetwork(l.width, l.height)
  }
  if (node.type === 'POLYGON') {
    const p = node as PolygonNode
    return polygonToVectorNetwork(p.width, p.height, p.pointCount)
  }
  if (node.type === 'STAR') {
    const s = node as StarNode
    return starToVectorNetwork(s.width, s.height, s.pointCount, s.innerRadius)
  }
  throw new Error(`Cannot build VectorNetwork for type: ${node.type}`)
}

function rectToVectorNetwork(w: number, h: number): VectorNetwork {
  const vertices: VectorVertex[] = [
    { x: 0, y: 0, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
    { x: w, y: 0, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
    { x: w, y: h, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
    { x: 0, y: h, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
  ]

  const segments: VectorSegment[] = [
    { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
    { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
  ]

  return {
    vertices,
    segments,
    regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]], fills: [] }],
  }
}

function ellipseToVectorNetwork(w: number, h: number): VectorNetwork {
  const rx = w / 2
  const ry = h / 2
  const k = 0.5522847498

  const vertices: VectorVertex[] = [
    { x: rx, y: 0, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
    { x: w, y: ry, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
    { x: rx, y: h, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
    { x: 0, y: ry, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
  ]

  const segments: VectorSegment[] = [
    { start: 0, end: 1, tangentStart: { x: k * rx, y: 0 }, tangentEnd: { x: 0, y: -k * ry } },
    { start: 1, end: 2, tangentStart: { x: 0, y: k * ry }, tangentEnd: { x: -k * rx, y: 0 } },
    { start: 2, end: 3, tangentStart: { x: -k * rx, y: 0 }, tangentEnd: { x: 0, y: k * ry } },
    { start: 3, end: 0, tangentStart: { x: 0, y: -k * ry }, tangentEnd: { x: k * rx, y: 0 } },
  ]

  return {
    vertices,
    segments,
    regions: [{ windingRule: 'NONZERO', loops: [[0, 1, 2, 3]], fills: [] }],
  }
}

function lineToVectorNetwork(w: number, h: number): VectorNetwork {
  // Line from (0, 0) to (w, h) in local coords — open path, 2 vertices, 1 segment
  const vertices: VectorVertex[] = [
    { x: 0, y: 0, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
    { x: w, y: h, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' },
  ]

  const segments: VectorSegment[] = [
    { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
  ]

  // Open path: no regions
  return { vertices, segments }
}

function polygonToVectorNetwork(w: number, h: number, pointCount: number): VectorNetwork {
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(cx, cy)
  const n = Math.max(3, pointCount)

  const vertices: VectorVertex[] = []
  const loop: number[] = []

  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    vertices.push({ x, y, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' })
  }

  const segments: VectorSegment[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    segments.push({ start: i, end: j, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } })
    loop.push(i)
  }

  return { vertices, segments, regions: [{ windingRule: 'NONZERO', loops: [loop], fills: [] }] }
}

function starToVectorNetwork(w: number, h: number, pointCount: number, innerRadius: number): VectorNetwork {
  const cx = w / 2
  const cy = h / 2
  const outerR = Math.min(cx, cy)
  const innerR = outerR * innerRadius
  const n = Math.max(3, pointCount)

  const vertices: VectorVertex[] = []
  const loop: number[] = []

  for (let i = 0; i < n * 2; i++) {
    const angle = (Math.PI * 2 * i) / (n * 2) - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    vertices.push({ x, y, strokeCap: 'NONE', strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' })
  }

  const segments: VectorSegment[] = []
  for (let i = 0; i < n * 2; i++) {
    const j = (i + 1) % (n * 2)
    segments.push({ start: i, end: j, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } })
    loop.push(i)
  }

  return { vertices, segments, regions: [{ windingRule: 'NONZERO', loops: [loop], fills: [] }] }
}

// Execute blend operation
async function handleBlend(options: BlendOptions) {
  const sel = figma.currentPage.selection
  const expected = options.useSpine ? 3 : 2

  if (sel.length !== expected) {
    post({ type: 'ERROR', message: options.useSpine ? '请选中 2 个图形 + 1 条轴线路径' : '请选中 2 个图形' })
    return
  }

  const blendNodes = [sel[0], sel[1]]
  const types = blendNodes.map((n) => n.type)
  const allBlendable = types.every((t) => BLENDABLE_TYPES.has(t))
  if (!allBlendable) {
    post({ type: 'ERROR', message: `不支持的图形类型（${types.join(', ')}）` })
    return
  }

  // Reject mixing open and closed paths
  const closedA = isPathClosed(blendNodes[0])
  const closedB = isPathClosed(blendNodes[1])
  if (closedA !== closedB) {
    post({ type: 'ERROR', message: '不能混用封闭图形和未封闭图形。请选中两个封闭图形或两个未封闭图形。' })
    return
  }

  // Extract spine if enabled
  let spineLoops: CubicBezierLoop[] | undefined
  let spineOrigin: { x: number; y: number } | undefined
  if (options.useSpine) {
    const spineGeom = extractGeometry(sel[2])
    spineLoops = extractLoops(
      spineGeom.vectorNetwork.vertices,
      spineGeom.vectorNetwork.segments,
      spineGeom.vectorNetwork.regions
    )
    if (spineLoops.length === 0) {
      post({ type: 'ERROR', message: '无法从轴线路径中提取路径数据' })
      return
    }
    spineOrigin = { x: spineGeom.x, y: spineGeom.y }
  }

  // Save original references and parent before any document modifications
  const originalA = blendNodes[0]
  const originalB = blendNodes[1]
  const parent = originalA.parent ?? figma.currentPage

  try {
    post({ type: 'PROGRESS', current: 0, total: options.steps })

    const geomA = extractGeometry(originalA)
    const geomB = extractGeometry(originalB)

    const intermediates = await blend({
      netA: geomA.vectorNetwork,
      netB: geomB.vectorNetwork,
      fillsA: geomA.fills,
      fillsB: geomB.fills,
      strokesA: geomA.strokes,
      strokesB: geomB.strokes,
      strokeWeightA: geomA.strokeWeight,
      strokeWeightB: geomB.strokeWeight,
      opacityA: geomA.opacity,
      opacityB: geomB.opacity,
      posA: { x: geomA.x, y: geomA.y },
      posB: { x: geomB.x, y: geomB.y },
      cornerRadiiA: geomA.cornerRadii,
      cornerRadiiB: geomB.cornerRadii,
      parent,
      spineLoops,
      spineOrigin,
    }, options)

    // Group originals with intermediates
    if (options.shouldGroup && intermediates.length > 0) {
      const allNodes = [originalA, ...intermediates, originalB]
      const group = figma.group(allNodes, parent)
      group.name = 'Blend Group'
    }

    post({
      type: 'RESULT',
      success: true,
      nodeCount: intermediates.length,
    })

    figma.notify(`混合完成，生成了 ${intermediates.length} 个中间图形`)
  } catch (err) {
    const message = err instanceof Error ? err.message : '混合失败'
    post({ type: 'ERROR', message })
    figma.notify(message, { error: true })
  }
}

function post(msg: MainMessage) {
  figma.ui.postMessage(msg)
}
