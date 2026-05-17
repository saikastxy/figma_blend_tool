import { blend } from './src/blend-engine'
import { BlendOptions, MainMessage, UIMessage } from './src/types'

// Shape types that can be blended
const BLENDABLE_TYPES = new Set([
  'VECTOR', 'RECTANGLE', 'ELLIPSE', 'LINE',
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
      handleCheckSelection()
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
function handleCheckSelection() {
  const sel = figma.currentPage.selection

  if (sel.length !== 2) {
    post({ type: 'SELECTION', count: sel.length, valid: false, message: `请选中 2 个图形（当前选中 ${sel.length} 个）` })
    return
  }

  const types = sel.map((n) => n.type)
  const allBlendable = types.every((t) => BLENDABLE_TYPES.has(t))

  if (!allBlendable) {
    post({ type: 'SELECTION', count: 2, valid: false, message: `不支持的图形类型（${types.join(', ')}）。支持：矩形、椭圆、直线、矢量` })
    return
  }

  // Check open/closed consistency
  const closedA = isPathClosed(sel[0])
  const closedB = isPathClosed(sel[1])
  if (closedA !== closedB) {
    post({ type: 'SELECTION', count: 2, valid: false, message: `不能混用封闭图形和未封闭图形。请选中两个封闭图形或两个未封闭图形。` })
    return
  }

  const descA = describeNode(sel[0])
  const descB = describeNode(sel[1])
  post({ type: 'SELECTION', count: 2, valid: true, message: `已选中：${descA} + ${descB}` })
}

// Detect if a node represents an open or closed path
function isPathClosed(node: BaseNode): boolean {
  if (node.type === 'LINE') return false
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') return true
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
    VECTOR: '矢量', RECTANGLE: '矩形', ELLIPSE: '椭圆', LINE: '直线',
  }
  const typeName = typeNames[node.type] ?? node.type
  const closed = isPathClosed(node)
  return closed ? `[闭]${typeName}` : `[开]${typeName}`
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

// Execute blend operation
async function handleBlend(options: BlendOptions) {
  const sel = figma.currentPage.selection

  if (sel.length !== 2) {
    post({ type: 'ERROR', message: '请选中 2 个图形' })
    return
  }

  const types = sel.map((n) => n.type)
  const allBlendable = types.every((t) => BLENDABLE_TYPES.has(t))
  if (!allBlendable) {
    post({ type: 'ERROR', message: `不支持的图形类型（${types.join(', ')}）` })
    return
  }

  // Reject mixing open and closed paths
  const closedA = isPathClosed(sel[0])
  const closedB = isPathClosed(sel[1])
  if (closedA !== closedB) {
    post({ type: 'ERROR', message: '不能混用封闭图形和未封闭图形。请选中两个封闭图形或两个未封闭图形。' })
    return
  }

  // Save original references and parent before any document modifications
  const originalA = sel[0]
  const originalB = sel[1]
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
      parent,
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
