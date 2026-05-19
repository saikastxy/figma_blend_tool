# Figma Blend Plugin — Development Log

> **仓库**: [github.com/saikastxy/figma_blend_tool](https://github.com/saikastxy/figma_blend_tool)

## 2026-05-17: 项目初始化与 Phase 1-4 实现

### 项目搭建
- 创建项目结构：`manifest.json`, `package.json`, `tsconfig.json`
- 打包工具：esbuild，将 TypeScript 模块打包为单一 `code.js`
- Figma 插件类型定义：`@figma/plugin-typings`
- 确定 manifest 格式：`documentAccess: "dynamic-page"`, `networkAccess.allowedDomains: ["none"]`

### 核心模块实现
- `src/types.ts` — 所有共享类型定义
- `src/geometry-utils.ts` — 向量运算、De Casteljau 贝塞尔求值/细分、弧长近似、shoelace 公式
- `src/color-utils.ts` — RGB↔HSL 转换、颜色线性插值
- `src/path-normalizer.ts` — VectorNetwork 路径提取、方向检测与统一、顶点数等化算法
- `src/path-interpolator.ts` — 贝塞尔控制点线性插值
- `src/color-interpolator.ts` — 填充/描边/透明度插值
- `src/region-matcher.ts` — 复合路径 region 配对
- `src/vector-builder.ts` — 插值结果反向构建 Figma VectorNetwork
- `src/blend-engine.ts` — 混合引擎总调度
- `code.ts` — 插件主线程入口（消息分发、选中验证、自动形状转换）
- `ui/ui.html` — 插件面板 UI

### 已实现功能
- 两个闭合矢量图形之间的形状混合（指定步数）
- 不同顶点数的路径通过 De Casteljau 细分自动等化
- 路径方向自动检测与统一（shoelace 公式）
- RGB / HSL 颜色空间插值（色相走最短弧）
- 填充色、描边色、透明度同步过渡
- 节点位置（x, y）插值
- 混合后自动打组选项
- 多 region / 复合路径基础支持
- 步数范围 1-100，带输入校验

---

## 2026-05-17: Bug 修复记录

### Bug 1: UI 无法点击"执行混合"按钮（按钮始终 disabled）

**现象**: 选中两个矢量图形后，UI 显示 "已选中 2 个矢量节点"（绿色），但按钮仍然灰色不可点击。

**排查过程**:
1. 最初怀疑是 `code.ts` 中 `figma.ui.onmessage` 使用了 `async` 关键字。Figma Plugin API 的 `onmessage` 回调期望同步函数签名 `(message: any) => void`，`async` 函数返回 `Promise<void>` 类型不匹配。
2. UI 端使用了 `window.onmessage`，Figma 的 iframe 沙箱环境中全局作用域可能不等于 `window`，Figma 官方示例始终使用裸露的 `onmessage`。
3. `focus` 事件监听器在用户点击插件面板时触发选中状态重新检查，画布可能失去焦点导致误判。

**修复** (`code.ts` + `ui/ui.html`):
- `figma.ui.onmessage = async (msg) =>` → `figma.ui.onmessage = (msg) =>`，BLEND 分支改用 `.catch()` 处理异步错误
- `window.onmessage = (event) =>` → `onmessage = (event) =>`
- 移除 `window.addEventListener('focus', ...)` 自动刷新选中状态的逻辑

### Bug 2: 选中 Rectangle/Ellipse 等非 Vector 类型时报错

**现象**: 选中 Rectangle + Ellipse 后，UI 显示 "请选中 2 个矢量图形（当前选中类型：RECTANGLE, ELLIPSE）"，按钮禁用。

**原因**: Figma 中 Rectangle、Ellipse 等形状的 `type` 不是 `'VECTOR'`，而是各自的类型名。代码只检查了 `node.type !== 'VECTOR'`。

**修复** (`code.ts`):
- 新增 `BLENDABLE_TYPES` 集合：`VECTOR`, `RECTANGLE`, `ELLIPSE`, `POLYGON`, `STAR`, `LINE`
- 选中检查改为接受所有 `BLENDABLE_TYPES` 中的类型
- 新增 `ensureVectorNode()` 函数：对非 VECTOR 类型的节点调用 `figma.flatten()` 自动转为矢量
- 混合完成后删除临时生成的矢量节点（`tempNode.remove()`）
- 修正了 `strokeWeight` 的 TypeScript 类型转换 (`as number`)

### Bug 3: `dynamic-page` 模式下 `vectorNetwork` 直接赋值报错

**现象**: 点击"执行混合"后报错 `in set_vectorNetwork: Cannot call with documentAccess: dynamic-page. Use node.setVectorNetworkAsync instead.`

**原因**: `documentAccess: "dynamic-page"` 模式下，Figma 不允许直接对 `vectorNetwork` 属性赋值，必须使用异步方法 `setVectorNetworkAsync()`。

**修复** (`src/blend-engine.ts` + `code.ts`):
- `vecNode.vectorNetwork = net` → `await vecNode.setVectorNetworkAsync(net)`
- `blend()` 函数改为 `async`，返回 `Promise<BlendOutput>`
- `handleBlend()` 中调用处加 `await`

### Bug 4: Manifest 导入报错 `containsWidget`

**现象**: 导入 manifest 时报 `Manifest error: Expected "manifest.containsWidget" to have type true but got undefined instead`

**原因**: 用户在 Figma 中误用了 **Widgets → Development → Import widget from manifest...** 菜单导入，而非 **Plugins → Development → Import plugin from manifest...**。

**修复**: 无需修改代码，改为使用正确的菜单路径导入即可。

### Bug 5: `networkAccess.allowedDomains` 值错误

**现象**: 将 `allowedDomains` 设为 `[]` 时报 `Invalid value for allowedDomains. To block all network access, set allowedDomains: ["none"]`

**修复** (`manifest.json`): `allowedDomains` 保持为 `["none"]`，这是 Figma 要求的正确写法。

---

## 当前状态

- 插件可正常加载和运行
- 支持 Rectangle、Ellipse、Polygon、Star、Line、Vector 等形状
- 形状混合 + 颜色混合 + 打组功能均可用
- 模式：`documentAccess: "dynamic-page"`
- 颜色空间：RGB、HSL

---

## 2026-05-17（续）: 步数语义变更 + 原始图形保留 + 节点引用修复

### 迭代 1: 步数语义变更

**需求**: 步数应代表总共可见的图形数量（含首尾原始图形），而非只计中间过渡形。

**改动** (`src/blend-engine.ts` + `ui/ui.html`):
- `steps` 现在表示总数（A + 中间 n-2 个 + B）
- 中间过渡形数量 = `max(0, steps - 2)`
- UI 标签改为"图形总数（含首尾）"，最小值从 1 改为 2

### 迭代 2: 原始图形在分组中消失

**现象**: 混合后原始图形不在 group 中 / 消失，报错 `in get_parent: The node with id "xxx" does not exist`。

**原因分析**:
1. `blend()` 内部做 `figma.group()` 时用的是 `ensureVectorNode()` 返回的矢量节点。对于非 VECTOR 类型（Rectangle 等），这是不可见的临时 `flatten()` 副本，不是原始图形。
2. 临时副本在分组后被 `remove()` 删除，导致 group 中只剩中间过渡形。
3. `handleBlend()` 中 `sel[0].parent` 在文档已被修改（插入中间形、删除临时节点）后才访问，节点引用可能已失效。

**修复** (`code.ts` + `src/blend-engine.ts`):
- 分组逻辑从 `blend()` 移到 `handleBlend()`，使用原始选中节点 `sel[0]` / `sel[1]` 参与分组
- 在 `handleBlend()` 开头保存 `originalA`、`originalB`、`parent` 引用，后续不再访问 `.parent`
- `parent` 通过参数显式传入 `ensureVectorNode()` 和 `blend()`，消除对节点 `.parent` 的依赖
- 临时节点清理移到分组之后，并用 try-catch 包裹防止二次删除报错
- `blend()` 不再返回 `BlendOutput`，改为直接返回 `VectorNode[]`

---

## 2026-05-17（续 2）: 移除 figma.flatten()，改为直接构建 VectorNetwork

### Bug 6: `figma.group()` 报 "node does not exist" + 原始图形消失

**现象**: 混合完成后报 `in group: The node with id "513:262" does not exist`，原始图形消失。

**根因**: `ensureVectorNode()` 对非 VECTOR 类型（Rectangle/Ellipse）调用 `figma.flatten()`，这会创建一个临时 VectorNode 插入到文档中。`figma.group()` 在某些情况下无法正确处理这些临时节点和原始节点之间的关系，导致节点引用失效。

**修复方案**: 彻底移除 `figma.flatten()`，改为从形状参数直接构建 VectorNetwork 数据结构：
- 新增 `extractGeometry()` — 从任何可混合节点提取几何数据（VectorNetwork + fills + strokes + 位置等），不创建额外文档节点
- 新增 `buildShapeVectorNetwork()` — 从 Rectangle/Ellipse 的参数（width/height）直接构建顶点和线段
- `rectToVectorNetwork()` — 4 个顶点 + 4 条直线段
- `ellipseToVectorNetwork()` — 4 个顶点 + 4 条三次贝塞尔曲线（k=0.5522847498 近似圆弧）
- `blend()` 改为接收 `BlendInput` 原始数据（VectorNetwork、fills、strokes 等），不再依赖 VectorNode
- `handleBlend()` 中 `figma.group()` 直接使用原始选中节点 `[originalA, ...intermediates, originalB]`

**关键改进**: 整个混合过程中不再向文档插入任何临时节点。中间过渡形直接创建、配置、添加到文档。原始图形完全不受影响。

---

## 2026-05-17（续 3）: v0.1 — 开放路径（未封闭图形）混合支持

### 新功能: 开放路径 Blending

**需求**: 支持未封闭图形的混合，例如直线和开放曲线之间的过渡。

**实现范围**:
- 开放路径与开放路径之间的混合
- 封闭路径与封闭路径之间的混合（已有）
- 封闭/开放混用 → 明确报错提示

**核心改动**:

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `CubicBezierLoop` 新增 `closed: boolean` 字段 |
| `src/path-normalizer.ts` | `extractLoops()` 检测线段链是否闭合（首尾顶点是否相同）；`loopVertices()` 对开放路径返回 N+1 个顶点（含终点）；新增 `matchOpenPathEndpoints()` — 通过端点距离判断是否需要反转方向；`normalizeLoopPair()` 根据 `closed` 选择方向统一策略 |
| `src/path-interpolator.ts` | `interpolateLoop()` 传播 `closed` 字段 |
| `src/vector-builder.ts` | 开放路径构建：N+1 个顶点 + N 个线段，无 region；支持多路径复合 |
| `src/blend-engine.ts` | `emptyLoop()` 添加 `closed` 字段 |
| `src/region-matcher.ts` | `degenerateRegion()` 添加 `closed` 字段 |
| `code.ts` | 新增 LINE 类型支持；`isPathClosed()` 检测开放/封闭；`lineToVectorNetwork()` 构建开放线段（2顶点1线段）；选中检查增加开放/封闭一致性验证；UI 描述增加 `[开]`/`[闭]` 前缀 |
| `ui/ui.html` | 增加面板高度至 400px |

**版本标记**: 本次提交记为 **v0.1**，与之前的功能验证提交区分。

---

## 2026-05-18: v0.11 — 沿路径混合（Spine Blending）

### 新功能: 沿指定路径混合

**需求**: 增加一个 toggle 选项，勾选后可以选择一条指定的 vector/路径作为轴线（Spine），中间过渡图形沿该轴线路径排列，而非在首尾图形之间直线排列。

**实现范围**:

| 文件 | 改动 |
|------|------|
| `src/types.ts` | `BlendOptions` 新增 `useSpine: boolean`；`UIMessage` 的 `CHECK_SELECTION` 携带 `useSpine` 标志 |
| `src/geometry-utils.ts` | 新增 `loopArcLength()` — 计算 CubicBezierLoop 总弧长；新增 `sampleLoopAtParam()` — 在弧长参数 t (0-1) 处采样路径上的点 |
| `src/blend-engine.ts` | `BlendInput` 新增 `spineLoops?` 和 `spineOrigin?`；`blend()` 根据 `useSpine` 选择位置计算方式：轴线模式下调用 `computeSpinePosition()` 沿轴线采样，否则保持原有线性插值 |
| `code.ts` | `CHECK_SELECTION` 处理携带 `useSpine` 参数，轴线模式下要求选中 3 个节点（2 个混合图形 + 1 条轴线路径）；`handleBlend()` 中提取轴线几何并传入 `blend()` |
| `ui/ui.html` | 新增"沿路径混合"复选框；切换时自动重新检查选中状态；`CHECK_SELECTION` 和 `BLEND` 消息中传递 `useSpine` |

**使用方式**:
1. 勾选"沿路径混合"
2. 依次选中：图形 A → 图形 B → 轴线路径（共 3 个）
3. 点击"执行混合"，中间图形将沿轴线路径等距排列

**技术细节**:
- 轴线路径的几何数据通过 `extractGeometry()` + `extractLoops()` 提取，与混合图形使用同一套路径提取管线
- 位置采样基于弧长参数化（arc-length parameterization），确保中间图形沿轴线均匀分布
- 采样点从轴线本地坐标转换到文档坐标（+ spineOrigin offset）
- 不勾选时行为完全不变，保持向后兼容

---

## 2026-05-19: v0.12 — 轴线居中对齐 + 术语变更

### 术语变更: "脊柱" → "轴线"

将所有 UI 提示和错误信息中的"脊柱"统一改为"轴线"，更直观易懂。

### 功能修复: 轴线居中对齐

**问题**: v0.11 中沿轴线混合时，中间图形的 local origin 直接放置在轴线采样点上，导致图形相对轴线偏移，不是以轴线为中轴居中排列。

**修复** (`src/geometry-utils.ts` + `src/blend-engine.ts`):
- 新增 `verticesCenter()` — 计算 VectorNetwork 顶点的包围盒中心
- `blend()` 中计算 A/B 图形的 local 几何中心，并在每个中间步做线性插值
- 轴线模式下，用 `轴线采样点 - 插值后的 local 中心` 作为图形位置，使图形的几何中心精确对齐轴线路径
- 非轴线模式行为不变，保持向后兼容

---

## 项目仓库信息

- **GitHub**: [github.com/saikastxy/figma_blend_tool](https://github.com/saikastxy/figma_blend_tool)
- **SSH**: `git@github.com:saikastxy/figma_blend_tool.git`
