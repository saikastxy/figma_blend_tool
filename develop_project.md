# Figma Blend Plugin — Development Plan

> **版本**: v1.0  
> **更新日期**: 2026-05-17  
> **目标**: 在 Figma 中实现类似 Adobe Illustrator 混合（Blend）功能的插件

---

## 目录

1. [项目概述](#1-项目概述)
2. [Figma Plugin API 能力分析](#2-figma-plugin-api-能力分析)
3. [Adobe Illustrator 混合算法研究](#3-adobe-illustrator-混合算法研究)
4. [核心算法设计](#4-核心算法设计)
5. [插件架构设计](#5-插件架构设计)
6. [开发阶段规划](#6-开发阶段规划)
7. [技术难点与解决方案](#7-技术难点与解决方案)
8. [文件结构规划](#8-文件结构规划)
9. [UI 设计规划](#9-ui-设计规划)
10. [测试计划](#10-测试计划)
11. [待定与未来迭代](#11-待定与未来迭代)

---

## 1. 项目概述

### 1.1 功能需求

| 编号 | 功能 | 描述 |
|------|------|------|
| F1 | 矢量图形混合 | 在两个选中的矢量图形之间，按设定步数生成中间过渡形状 |
| F2 | 色彩属性混合 | 按设定步数对填充色、描边色、透明度等进行插值过渡 |
| F3 | 混合结果打组 | 混合完成后，用户可选择是否将原始对象与中间对象打组 |

### 1.2 非功能需求

- 跨平台：macOS 和 Windows 均可运行（基于 Figma 桌面端 / Web 端）
- 性能：对于 100 步以内的混合操作，完成时间 < 3 秒
- 兼容性：支持 Figma Plugin API v1.0.0+

---

## 2. Figma Plugin API 能力分析

### 2.1 矢量图形几何操作

Figma 提供两套矢量图形操作 API：

#### A. `vectorPaths`（推荐方案 — SVG 路径字符串）

```typescript
type VectorPaths = ReadonlyArray<VectorPath>

interface VectorPath {
  readonly windingRule: WindingRule | 'NONE'
  readonly data: string  // SVG 路径命令字符串
}
```

**支持的 path 命令**（仅大写/绝对坐标）：

| 命令 | 含义 |
|------|------|
| `M x y` | 绝对移动到 |
| `L x y` | 绝对画线到 |
| `Q x0 y0 x y` | 绝对二次贝塞尔（输入接受，内部转三次） |
| `C x0 y0 x1 y1 x y` | 绝对三次贝塞尔 |
| `Z` | 闭合路径 |

> **注意**: 不支持相对坐标（小写命令）。`data` 是字符串，以空格分隔命令。

#### B. `vectorNetwork`（高级方案 — 图结构）

```typescript
interface VectorNetwork {
  vertices: ReadonlyArray<VectorVertex>
  segments: ReadonlyArray<VectorSegment>
  regions?: ReadonlyArray<VectorRegion>
}

interface VectorVertex {
  x: number; y: number
  strokeCap?: StrokeCap
  strokeJoin?: StrokeJoin
  cornerRadius?: number
  handleMirroring?: HandleMirroring
}

interface VectorSegment {
  start: number; end: number        // 顶点索引
  tangentStart?: Vector  // 起始端三次贝塞尔控制柄, 默认 {x:0, y:0}
  tangentEnd?: Vector    // 结束端三次贝塞尔控制柄, 默认 {x:0, y:0}
}

interface VectorRegion {
  windingRule: WindingRule
  loops: ReadonlyArray<ReadonlyArray<number>>  // 线段索引的闭合环
  fills?: ReadonlyArray<Paint>
  fillStyleId?: string
}
```

**VectorNetwork 优势**：
- 每个顶点和贝塞尔控制柄独立可访问 — 适合逐顶点插值
- 支持多于两条线段共享同一顶点（分支拓扑）
- 支持 per-vertex 属性（strokeCap、cornerRadius 等）
- 这是实现混合算法的主要数据源

**关键方法**：
- `node.vectorNetwork` — 读写
- `await node.setVectorNetworkAsync(network)` — 异步设置（`dynamic-page` 模式必需）
- `figma.createVector()` — 创建新矢量节点

### 2.2 颜色 / 样式 API

```typescript
// SolidPaint
interface SolidPaint {
  readonly type: 'SOLID'
  readonly color: RGB      // { r: number, g: number, b: number } — 0~1 范围
  readonly opacity?: number  // 0~1
  readonly blendMode?: BlendMode
  readonly visible?: boolean
}

// 颜色工具函数
figma.util.solidPaint(colorString)          // 从 CSS 颜色字符串创建 SolidPaint
figma.util.rgb(colorString)                 // CSS → RGB
figma.util.rgba(colorString)                // CSS → RGBA（保留 alpha）
```

**颜色插值注意事项**：
- Figma 原生使用 RGB 空间
- 可在 RGB / HSL / OKLCH 空间进行插值
- `figma.util.solidPaint()` 接受 `#hex`、`rgb()`、`hsl()` 格式字符串

### 2.3 节点操作 API

```typescript
// 创建和组合
figma.createVector()                   // 创建矢量节点
figma.group(nodes, parent, index)      // 将节点打组
figma.flatten(nodes)                   // 扁平化/合并矢量

// 选择和页面
figma.currentPage.selection            // 当前选中节点
figma.currentPage.appendChild(node)    // 添加节点到页面

// 节点属性
node.x, node.y                         // 位置
node.relativeTransform                 // 相对变换矩阵
node.visible, node.locked              // 可见/锁定
node.fills, node.strokes               // 填充和描边
```

### 2.4 插件清单配置

```json
{
  "name": "Blend Tool",
  "id": "xxxxxxxxxx",
  "api": "1.0.0",
  "editorType": ["figma"],
  "main": "code.js",
  "ui": "ui.html",
  "documentAccess": "dynamic-page",
  "networkAccess": { "allowedDomains": ["none"] }
}
```

- `documentAccess: "dynamic-page"` — 新插件必需
- `networkAccess` — 无需外部网络请求，设为 `["none"]`
- 插件在 UI iframe 和主线程间通过 `postMessage` 通信

---

## 3. Adobe Illustrator 混合算法研究

### 3.1 Illustrator 混合的核心机制

Illustrator 的混合工具本质上是**贝塞尔控制点的逐顶点线性插值**：

```
对于每个步长 t ∈ [0, 1]:
  对每对匹配的锚点 (P₁, P₂):
    P_intermediate(t) = (1 - t) × P₁ + t × P₂
    （控制柄同样进行线性插值）
```

### 3.2 三种间距模式

| 模式 | 算法 |
|------|------|
| **平滑颜色** | 自动计算最佳步数，使颜色过渡在感知上平滑 |
| **指定步数** | 用户设定 n，生成 n 个中间形状 |
| **指定距离** | 用户设定间距 d，根据总距离计算步数 |

本插件将实现**指定步数**模式作为核心功能。

### 3.3 高级 Morphing 技术（Adobe 2024 专利 US 2024/0153177）

Adobe 的现代混合算法使用了更复杂的技术：

1. **可混合层级提取** — 按类型（简单形状、复合路径、剪切组）分组路径
2. **多成本 Morphing 评估** — 对每对候选路径计算：
   - 空间成本（距离）
   - 体积成本（大小/面积相似度）
   - 几何成本（形状/结构相似度）
3. **匈牙利算法最优配对** — 用 Munkres 算法找全局最优的一对一路径映射
4. **高成本离群值抑制** — 超出阈值的路径对丢弃，未匹配路径与退化路径配对
5. **三属性插值** — 几何 + 外观（颜色等）+ Z 顺序同时过渡

### 3.4 SVG 路径 Morphing 开源算法

| 库 | 核心方法 | 适用场景 |
|----|----------|----------|
| **Flubber** | 三角剖分（earcut）+ 顶点映射 + 三角形插值 | 任意形状之间的 morphing |
| **d3-interpolate-path** | De Casteljau 细分 + 全部归一化为三次贝塞尔 + 点对点线性插值 | 路径结构相似的情况 |
| **KUTE.js** | 全部转为三次贝塞尔 + 控制点插值 + 方向检测与自动翻转 | 路径结构不同的情况 |
| **svg-path-morph** | 要求相同命令结构 + 加权混合 | 结构相同的路径 |

---

## 4. 核心算法设计

### 4.1 总体流程

```
选中两个矢量节点 (Node A, Node B)
        │
        ▼
┌─────────────────────────────────┐
│  Step 1: 读取几何数据            │
│  - 读取 vectorNetwork            │
│  - 提取 vertices, segments,      │
│    tangents, regions             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Step 2: 规范化                  │
│  - 检测/统一路径方向             │
│  - 匹配对应 region               │
│  - 等化各 region 的顶点数        │
│  - 等化总 segment 数             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Step 3: 生成中间步骤            │
│  for i = 1 to steps:            │
│    t = i / (steps + 1)          │
│    - 插值顶点位置                │
│    - 插值贝塞尔控制柄            │
│    - 插值颜色（填充/描边）       │
│    - 插值透明度                  │
│    - 创建新的 VectorNode         │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Step 4: 后处理                  │
│  - 如果需要打组:                 │
│    figma.group([A, ...steps, B]) │
│  - 放置中间对象到页面            │
└─────────────────────────────────┘
```

### 4.2 路径规范化算法（核心）

#### 4.2.1 数据结构

```typescript
// 规范化后的路径表示
interface NormalizedPath {
  vertices: Vertex[]          // 顶点数组
  segments: NormalizedSegment[]  // 线段数组
  loops: number[][]           // region 的 loop
  windingRule: WindingRule
  fills: Paint[]
}

interface Vertex {
  x: number; y: number
  handleIn: Vector   // 入控制柄
  handleOut: Vector  // 出控制柄
}

interface NormalizedSegment {
  startIndex: number
  endIndex: number
  startTangent: Vector
  endTangent: Vector
}
```

#### 4.2.2 顶点数等化（De Casteljau 细分）

当两个路径的 segment 数不同时，需要对 segment 较少的路径进行细分：

```
算法：对 segment 数少的路径
  1. 计算每个 segment 沿路径的累计弧长
  2. 在较长路径的每个 segment 对应比例位置插入新顶点
  3. 用 De Casteljau 算法在 t 处细分三次贝塞尔曲线：
     P(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
     handle₀(t), handle₁(t) 由细分算法计算
  4. 更新 region loop 中的 segment 索引
```

**De Casteljau 细分**（细分三次贝塞尔于 t 处）：

```
给定三次贝塞尔: P₀, P₁, P₂, P₃  (P₀=起点, P₁=控制柄1末端, P₂=控制柄2末端, P₃=终点)

在 t 处细分：
  Q₀ = lerp(P₀, P₁, t)
  Q₁ = lerp(P₁, P₂, t)
  Q₂ = lerp(P₂, P₃, t)
  R₀ = lerp(Q₀, Q₁, t)
  R₁ = lerp(Q₁, Q₂, t)
  S  = lerp(R₀, R₁, t)   // S = P(t)，即曲线上的点

结果：
  左半段: P₀, Q₀, R₀, S     (控制点)
  右半段: S, R₁, Q₂, P₃     (控制点)
```

#### 4.2.3 路径方向检测与统一

```typescript
function windingDirection(vertices: Vertex[]): number {
  // 用 shoelace 公式计算有向面积
  let area = 0
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length
    area += vertices[i].x * vertices[j].y
    area -= vertices[j].x * vertices[i].y
  }
  return area  // > 0 → 逆时针, < 0 → 顺时针
}

// 如果方向不同，反转其中一个路径
if (Math.sign(areaA) !== Math.sign(areaB)) {
  reverseVertices(pathB)
}
```

### 4.3 顶点插值算法

```
对于每对匹配的顶点 (Va, Vb) 和时间 t：
  v(t).x = Va.x + (Vb.x - Va.x) * t
  v(t).y = Va.y + (Vb.y - Va.y) * t
  v(t).handleOut = lerp(Va.handleOut, Vb.handleOut, t)
  v(t).handleIn = lerp(Va.handleIn, Vb.handleIn, t)
```

注意：插值时以 Node A 的坐标系为参考。如果两个节点的位置不同，需要先将 Node B 的顶点变换到 Node A 的坐标系，插值后再根据位置变换摆放中间对象。

### 4.4 颜色插值算法

提供三种颜色插值模式：

#### 模式 1：RGB 线性插值（最简单、最快）
```
c(t) = { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.g, t) }
```

#### 模式 2：HSL 插值（色相过渡更自然）
```
1. RGB → HSL
2. hue(t) = lerpAngle(a.h, b.h, t)  // 角度插值（取最短弧）
3. sat(t) = lerp(a.s, b.s, t)
4. lit(t) = lerp(a.l, b.l, t)
5. HSL → RGB
```

#### 模式 3：OKLCH 插值（感知均匀性最佳）
```
1. RGB → OKLCH
2. 在 OKLCH 空间线性插值
3. OKLCH → RGB
```

**默认使用 HSL 插值**，因为它简单且效果不错，同时提供 RGB 和 OKLCH 作为可选项。

### 4.5 位置插值

中间对象的 `(x, y)` 位置在两个原始对象的位置之间线性插值：

```
intermediate.x = A.x + (B.x - A.x) * t
intermediate.y = A.y + (B.y - A.y) * t
```

### 4.6 多 Region / 复合路径处理

当 VectorNode 有多个 region 时：

```
1. 对每个对象的 region 按面积排序
2. 一对一匹配（按面积顺序）
3. 如果 region 数不同：
   - 较多的对象中，未匹配的 region 与"退化 region"（面积 0）配对
   - 退化 region 在插值过程中逐渐出现/消失
4. 每个 matched pair 独立进行顶点数等化和插值
```

---

## 5. 插件架构设计

### 5.1 Figma 插件双线程模型

```
┌──────────────────────┐       postMessage       ┌──────────────────────┐
│    Main Thread        │ ◄─────────────────────► │    UI Thread (iframe) │
│    (code.ts)          │                         │    (ui.html)          │
│                      │                         │                      │
│  - 读取选中节点       │                         │  - 用户参数输入       │
│  - 执行混合算法       │                         │  - 步数设置           │
│  - 创建新节点         │                         │  - 颜色空间选择       │
│  - figma API 访问     │                         │  - 打组选项           │
│  - 操作文档           │                         │  - 预览 / 执行按钮    │
└──────────────────────┘                         └──────────────────────┘
```

**通信协议**：

```typescript
// UI → Main
type UIMessage =
  | { type: 'BLEND', steps: number, colorSpace: string, shouldGroup: boolean }
  | { type: 'CANCEL' }

// Main → UI
type MainMessage =
  | { type: 'RESULT', success: true, nodeCount: number }
  | { type: 'ERROR', message: string }
  | { type: 'PROGRESS', current: number, total: number }
```

### 5.2 模块划分

```
┌──────────────────────────────┐
│         Plugin Entry          │
│         code.ts + ui.html     │
├──────────────────────────────┤
│  Blend Engine                 │
│  - 总控调度                   │
│  - 读取选中 / 创建结果        │
├──────────────┬───────────────┤
│ Path Utils   │ Color Utils   │
│ - 方向检测   │ - RGB ↔ HSL   │
│ - De Casteljau│ - RGB ↔ OKLCH │
│ - 顶点等化   │ - Paint 插值  │
│ - 路径规范化 │               │
├──────────────┴───────────────┤
│  Figma Plugin API (figma.*)  │
└──────────────────────────────┘
```

---

## 6. 开发阶段规划

### Phase 1: 项目基础设施搭建

**目标**: 可运行的空白插件，通过 Figma 开发模式加载

| 任务 | 描述 | 文件 |
|------|------|------|
| 1.1 | 创建插件项目结构 | `manifest.json`, `package.json`, `tsconfig.json` |
| 1.2 | 编写最小 `code.ts`（读取选中节点信息） | `code.ts` |
| 1.3 | 编写最小 `ui.html`（显示一个按钮和参数表单） | `ui.html` |
| 1.4 | 实现主线程与 UI 的 postMessage 通信 | `code.ts`, `ui.html` |
| 1.5 | 在 Figma 桌面端加载并验证 | — |

**验收标准**: 插件能在 Figma 中运行，选中两个矢量节点后能读取其类型和基本信息。

### Phase 2: 单路径混合（相同顶点数）

**目标**: 对两个顶点数相同的简单矢量图形完成形状 + 位置混合

| 任务 | 描述 |
|------|------|
| 2.1 | 实现 VectorNetwork 数据的读取和序列化 |
| 2.2 | 实现基本线性插值函数（顶点位置、控制柄） |
| 2.3 | 实现中间 VectorNode 的创建逻辑 |
| 2.4 | 实现位置（x, y）插值 |
| 2.5 | 在 UI 中添加步数输入和"执行混合"按钮 |

**验收标准**: 选中两个结构相同的矢量（如两个矩形、两个圆），可以生成指定步数的中间形状。

### Phase 3: 顶点数规范化

**目标**: 处理顶点数不同的两个路径之间的混合

| 任务 | 描述 |
|------|------|
| 3.1 | 实现 De Casteljau 三次贝塞尔细分函数 |
| 3.2 | 实现路径顶点数等化算法（segment 匹配与细分） |
| 3.3 | 实现路径方向检测与自动翻转 |
| 3.4 | 更新 region loop 索引在细分后的映射 |

**验收标准**: 选中一个三角形（3顶点）和一个圆形（多顶点），能正确生成中间过渡形状。

### Phase 4: 颜色和属性混合

**目标**: 实现填充色、描边色、透明度的插值

| 任务 | 描述 |
|------|------|
| 4.1 | 实现 RGB 颜色空间线性插值 |
| 4.2 | 实现 RGB ↔ HSL 转换及 HSL 空间插值 |
| 4.3 | 实现 SolidPaint 的插值（颜色 + 透明度） |
| 4.4 | 实现 fills 数组和 strokes 数组的插值 |
| 4.5 | 在 UI 中添加颜色空间选择（RGB / HSL / OKLCH） |

**验收标准**: 选中一个红色矩形和一个蓝色圆形，生成中间对象颜色从红平滑过渡到蓝。

### Phase 5: 复杂形状支持

**目标**: 支持多 region、带镂空（cutout）的复合路径

| 任务 | 描述 |
|------|------|
| 5.1 | 实现多 region 的匹配算法（按面积排序配对） |
| 5.2 | 实现退化 region 处理（region 数不等时） |
| 5.3 | 实现带 stroke 的矢量处理 |
| 5.4 | 实现填充规则（windingRule）的传递 |

**验收标准**: 选中两个带镂空的复合路径，中间形状正确过渡镂空区域。

### Phase 6: UI 完善

**目标**: 完整、美观、易用的插件界面

| 任务 | 描述 |
|------|------|
| 6.1 | 设计并实现完整的参数设置面板（步数、颜色模式、打组选项） |
| 6.2 | 添加输入验证（步数范围 1-100、必须选中两个矢量节点等） |
| 6.3 | 添加错误提示和状态显示 |
| 6.4 | 添加进度反馈（步数较多时可能需要异步处理） |
| 6.5 | 实现"预览"功能（可选） |

**验收标准**: 插件 UI 清晰直观，用户能方便地设置参数并执行混合。

### Phase 7: 打组功能与收尾

**目标**: 混合完成后可选择打组

| 任务 | 描述 |
|------|------|
| 7.1 | 实现 `figma.group()` 调用，将原始对象 + 中间对象打组 |
| 7.2 | 在 UI 中添加"混合后打组"复选框 |
| 7.3 | 处理边界情况（对象已在一个 group 中） |
| 7.4 | 代码清理和重构 |

**验收标准**: 勾选打组后，混合结果在一个 Group 中。

### Phase 8: 测试和跨平台验证

**目标**: 确保在 macOS 和 Windows 上正常运行

| 任务 | 描述 |
|------|------|
| 8.1 | macOS Figma 桌面端完整测试 |
| 8.2 | Windows 兼容性验证（如有条件） |
| 8.3 | Web 端 Figma 验证（浏览器环境） |
| 8.4 | 边界情况测试（不规则形状、极端步数、透明色等） |
| 8.5 | 性能测试 |

**验收标准**: 所有功能在目标平台上正常运行。

---

## 7. 技术难点与解决方案

### 7.1 顶点数不匹配

**问题**: 两个路径的顶点/segment 数不同时，无法直接进行一一对应的插值。

**方案**: 
1. 将两个路径的所有 segment 归一化为三次贝塞尔曲线
2. 计算每个 segment 的弧长占总路径的比例
3. 以 segment 数较多的路径为基准，对较少的路径在对应比例位置用 De Casteljau 算法细分
4. 细分后两个路径的顶点数相同，可以一一对应插值

### 7.2 路径方向不一致

**问题**: 一个路径顺时针、另一个逆时针时，直接插值会产生扭曲。

**方案**: 用 shoelace 公式计算有向面积，如果符号不同，则将其中一个路径的顶点/segment 顺序反转。

### 7.3 多 Region 不匹配

**问题**: 两个对象可能包含不同数量的 fill region（如一个对象有镂空，另一个没有）。

**方案**: 
1. 按面积降序排列两个对象的 region
2. 前 N 个 region 一一配对（N = min(countA, countB)）
3. 未配对的多余 region 与"退化 region"（面积 0 的单点路径）配对
4. 退化 region 在过渡中逐渐出现或消失（通过 scale 插值）

### 7.4 颜色空间选择

**问题**: RGB 线性插值可能产生不自然的中间色（如红→绿经过灰色）。

**方案**: 默认使用 HSL 插值（色相取最短路径），同时提供 RGB 和 OKLCH 选项。

### 7.5 开路径 vs 闭路径

**问题**: 开放路径（如线段）和闭合路径（如矩形）之间的混合。

**方案**: 初始版本要求两个路径都是闭合的（`Z` 结尾）。后续版本可考虑支持开放路径混合。

### 7.6 不同类型节点

**问题**: 如果用户选中的不是 VectorNode（而是 Frame、Text 等）。

**方案**: 
- 检查选中节点类型，非矢量节点时给出明确提示
- 如果选中节点可以被 `flatten()` 转为矢量，提供自动转换选项

---

## 8. 文件结构规划

```
figma_blend_addon/
├── develop_project.md          # 本开发计划文档
├── manifest.json               # Figma 插件清单
├── package.json                # npm 依赖配置
├── tsconfig.json               # TypeScript 编译配置
├── code.ts                     # 主线程入口
│
├── src/
│   ├── blend-engine.ts         # 混合引擎核心调度
│   ├── path-normalizer.ts      # 路径规范化（顶点等化、方向检测）
│   ├── path-interpolator.ts    # 路径插值（顶点、控制柄）
│   ├── color-interpolator.ts   # 颜色插值（RGB/HSL/OKLCH）
│   ├── region-matcher.ts       # 多 Region 匹配
│   ├── vector-builder.ts       # 从规范化数据构建 VectorNetwork
│   ├── geometry-utils.ts       # 几何工具（弧长、面积、向量运算）
│   ├── color-utils.ts          # 颜色空间转换工具
│   └── types.ts                # 类型定义
│
├── ui/
│   └── ui.html                 # 插件 UI（参数面板）
│
└── test/
    └── test-cases.md           # 测试用例说明
```

### 编译方案

由于 Figma 插件需要单个 `code.js` 文件作为入口，使用以下方案之一：

- **方案 A**（推荐）：使用 esbuild 或 rollup 将 TypeScript 模块打包为单个 `code.js`
- **方案 B**：使用 TypeScript 的 `outFile` + `--module amd` 编译为单个文件

推荐方案 A，利用 esbuild 的快速打包能力。

---

## 9. UI 设计规划

```
┌─────────────────────────────────┐
│         🎨 Blend Tool            │
│                                 │
│  选中对象: 2 个矢量节点          │
│                                 │
│  ┌─────────────────────────┐   │
│  │  混合步数                │   │
│  │  [  5  ]  (1 - 100)      │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │  颜色空间                │   │
│  │  ○ RGB  ● HSL  ○ OKLCH   │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │  ☑ 混合后自动打组         │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │      执 行 混 合          │   │
│  └─────────────────────────┘   │
│                                 │
│  状态: 就绪                     │
└─────────────────────────────────┘
```

---

## 10. 测试计划

### 10.1 功能测试

| 测试用例 | 输入 | 预期结果 |
|----------|------|----------|
| 两个相同矩形 | 2个100×100矩形，步数=3 | 生成3个过渡矩形，位置/大小线性过渡 |
| 矩形→圆形 | 1个矩形 + 1个圆形，步数=5 | 生成5个中间形状，从矩形逐渐变为圆形 |
| 红色→蓝色 | 红色矩形 + 蓝色矩形，步数=3 | 中间颜色从红→紫→蓝平滑过渡 |
| 不同透明度 | opacity=1 + opacity=0.2，步数=3 | 透明度逐渐降低 |
| 多Region复合路径 | 两个带镂空的形状，步数=4 | 镂空区域正确过渡 |
| 极端步数 | 步数=100 | 性能可接受，结果正确 |
| 选中非矢量节点 | 选中1个Frame | 显示错误提示 |
| 选中1个节点 | 仅选1个 | 显示提示需要选中2个节点 |
| 打组选项 | 勾选打组，执行混合 | 结果在一个Group中 |

### 10.2 平台测试

| 平台 | 状态 |
|------|------|
| macOS Figma 桌面端 | 待测试 |
| Windows Figma 桌面端 | 待测试 |
| Figma Web 端 (Chrome) | 待测试 |
| Figma Web 端 (Firefox) | 待测试 |

---

## 11. 待定与未来迭代

### 11.1 本次开发范围（v1.0）

- ✅ 两个闭合矢量图形之间的形状混合
- ✅ 指定步数模式
- ✅ 填充色、描边色、透明度混合
- ✅ RGB / HSL / OKLCH 颜色空间选择
- ✅ 混合后打组选项
- ✅ 基本 UI 面板

### 11.2 未来迭代 (v1.1+)

| 功能 | 优先级 | 描述 |
|------|--------|------|
| 自定义混合路径（Spine） | 中 | 沿用户绘制的路径排列混合结果 |
| 平滑颜色模式 | 低 | 自动计算最佳步数 |
| 指定距离模式 | 低 | 按固定间距排列混合结果 |
| 开放路径混合 | 低 | 支持线段、曲线等开放路径 |
| 非线性缓动 | 低 | 支持 ease-in/out 等过渡曲线 |
| 混合结果编辑 | 低 | 混合后仍可调整参数实时更新 |
| 多对象混合 | 低 | 支持 3 个以上的对象同时混合 |

---

## 附录 A: 参考资料

- [Figma Plugin API 文档](https://developers.figma.com/docs/plugins/)
- [VectorNode API 参考](https://developers.figma.com/docs/plugins/api/VectorNode/)
- [VectorPath API 参考](https://developers.figma.com/docs/plugins/api/VectorPath/)
- [VectorNetwork API 参考](https://developers.figma.com/docs/plugins/api/VectorNetwork/)
- [Figma 插件清单文档](https://developers.figma.com/docs/plugins/manifest/)
- [Figma 插件快速开始指南](https://developers.figma.com/docs/plugins/plugin-quickstart-guide/)
- [Adobe 混合对象专利 US 2024/0153177](https://www.freepatentsonline.com/y2024/0153177.html)
- [Flubber - 形状 Morphing 库](https://github.com/veltman/flubber)
- [d3-interpolate-path](https://github.com/pbeshai/d3-interpolate-path)
- [De Casteljau 算法](https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm)
- [Shoelace 公式（多边形面积）](https://en.wikipedia.org/wiki/Shoelace_formula)
- [OKLCH 颜色空间](https://bottosson.github.io/posts/oklab/)

---

> **本文档将持续更新**，作为整个项目的开发纲领。  
> 每个开发阶段的完成情况、遇到的问题和解决方案将记录在相应的 Phase 小节中。  
> 如发现计划需要调整，直接修改本文档并记录变更原因。
