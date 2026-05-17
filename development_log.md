# Figma Blend Plugin — Development Log

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
