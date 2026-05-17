import { blend } from './src/blend-engine'
import { BlendOptions, MainMessage, UIMessage } from './src/types'

// Shape types that can be converted to vectors for blending
const BLENDABLE_TYPES = new Set([
  'VECTOR', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'LINE',
])

// Plugin entry point: show the UI
figma.showUI(__html__, {
  width: 320,
  height: 360,
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
    post({ type: 'SELECTION', count: 2, valid: false, message: `不支持的图形类型（${types.join(', ')}）。支持：矩形、椭圆、多边形、星形、直线、矢量` })
    return
  }

  post({ type: 'SELECTION', count: 2, valid: true, message: `已选中 2 个图形（${types.join(', ')}）` })
}

// Convert a node to a VectorNode if it isn't already.
// parent must be provided to avoid accessing .parent on potentially stale nodes.
// Returns [vectorNode, tempNodeToCleanUp | null]
function ensureVectorNode(
  node: BaseNode,
  parent: BaseNode & ChildrenMixin
): [VectorNode, VectorNode | null] {
  if (node.type === 'VECTOR') {
    return [node as VectorNode, null]
  }

  // Flatten non-vector shapes into a vector node placed right after the original.
  const srcIndex = parent.children.findIndex((c) => c.id === node.id)
  const vec = figma.flatten([node], parent, srcIndex + 1)
  vec.visible = false
  return [vec, vec]
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

  // Save references before any document modifications to avoid stale node errors
  const originalA = sel[0]
  const originalB = sel[1]
  const parent = originalA.parent ?? figma.currentPage

  try {
    post({ type: 'PROGRESS', current: 0, total: options.steps })

    // Convert non-vector shapes to vectors for geometry extraction
    const [vecA, tempA] = ensureVectorNode(originalA, parent)
    const [vecB, tempB] = ensureVectorNode(originalB, parent)

    const intermediates = await blend({ nodeA: vecA, nodeB: vecB, parent }, options)

    // Group originals with intermediates using the saved references
    if (options.shouldGroup) {
      const allNodes = [originalA, ...intermediates, originalB]
      const group = figma.group(allNodes, parent)
      group.name = 'Blend Group'
    }

    // Clean up temporary flattened nodes AFTER grouping
    if (tempA) { try { tempA.remove() } catch (_) { /* already removed */ } }
    if (tempB) { try { tempB.remove() } catch (_) { /* already removed */ } }

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
