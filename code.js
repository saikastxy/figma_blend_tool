"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // src/geometry-utils.ts
  function lerpVec2(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function distSq(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
  function dist(a, b) {
    return Math.sqrt(distSq(a, b));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function cubicBezierPoint(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
    };
  }
  function subdivideCubicBezier(p0, p1, p2, p3, t) {
    const q0 = lerpVec2(p0, p1, t);
    const q1 = lerpVec2(p1, p2, t);
    const q2 = lerpVec2(p2, p3, t);
    const r0 = lerpVec2(q0, q1, t);
    const r1 = lerpVec2(q1, q2, t);
    const s = lerpVec2(r0, r1, t);
    return {
      left: [p0, q0, r0, s],
      right: [s, r1, q2, p3]
    };
  }
  function extractSubsegment(seg, t0, t1) {
    if (t0 <= 1e-3 && t1 >= 0.999) return seg;
    const { left } = subdivideCubicBezier(seg.p0, seg.p1, seg.p2, seg.p3, t1);
    if (t0 <= 1e-3) {
      return { p0: left[0], p1: left[1], p2: left[2], p3: left[3] };
    }
    const t0prime = t0 / t1;
    const { right } = subdivideCubicBezier(left[0], left[1], left[2], left[3], t0prime);
    return { p0: right[0], p1: right[1], p2: right[2], p3: right[3] };
  }
  function cubicBezierLength(p0, p1, p2, p3) {
    const steps = 20;
    let length = 0;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const pt = cubicBezierPoint(p0, p1, p2, p3, i / steps);
      length += dist(prev, pt);
      prev = pt;
    }
    return length;
  }
  function windingDirection(vertices) {
    let area = 0;
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += vertices[i].x * vertices[j].y;
      area -= vertices[j].x * vertices[i].y;
    }
    return area;
  }
  function loopArea(loop) {
    const pts = [];
    for (const seg of loop.segments) {
      const samples = 8;
      for (let i = 0; i < samples; i++) {
        pts.push(cubicBezierPoint(seg.p0, seg.p1, seg.p2, seg.p3, i / samples));
      }
    }
    return Math.abs(windingDirection(pts)) / 2;
  }

  // src/path-normalizer.ts
  var EPSILON = 1e-3;
  function reverseLoop(loop) {
    const reversed = [];
    for (let i = loop.segments.length - 1; i >= 0; i--) {
      const seg = loop.segments[i];
      reversed.push({
        p0: seg.p3,
        p1: seg.p2,
        p2: seg.p1,
        p3: seg.p0
      });
    }
    return { segments: reversed };
  }
  function loopVertices(loop) {
    return loop.segments.map((s) => s.p0);
  }
  function segmentParams(loop) {
    const lengths = loop.segments.map((s) => cubicBezierLength(s.p0, s.p1, s.p2, s.p3));
    const total = lengths.reduce((a, b) => a + b, 0);
    if (total < EPSILON) {
      const n = loop.segments.length;
      return Array.from({ length: n + 1 }, (_, i) => i / n);
    }
    const params = [0];
    let cum = 0;
    for (const len of lengths) {
      cum += len;
      params.push(cum / total);
    }
    params[params.length - 1] = 1;
    return params;
  }
  function segmentParamRanges(loop) {
    const params = segmentParams(loop);
    const ranges = [];
    for (let i = 0; i < loop.segments.length; i++) {
      ranges.push([params[i], params[i + 1]]);
    }
    return ranges;
  }
  function rebuildLoopAtParams(loop, mergedParams) {
    const newSegments = [];
    const ranges = segmentParamRanges(loop);
    let si = 0;
    for (let pi = 0; pi < mergedParams.length - 1; pi++) {
      const p0 = mergedParams[pi];
      const p1 = mergedParams[pi + 1];
      if (p1 - p0 < EPSILON) continue;
      while (si < ranges.length && ranges[si][1] < p0 + EPSILON) {
        si++;
      }
      if (si >= ranges.length) break;
      const [segStart, segEnd] = ranges[si];
      const localT0 = Math.max(0, (p0 - segStart) / (segEnd - segStart));
      const localT1 = Math.min(1, (p1 - segStart) / (segEnd - segStart));
      if (localT0 < EPSILON && localT1 > 1 - EPSILON) {
        newSegments.push(loop.segments[si]);
      } else {
        newSegments.push(extractSubsegment(loop.segments[si], localT0, localT1));
      }
      if (Math.abs(p1 - segEnd) < EPSILON) {
        si++;
      }
    }
    return { segments: newSegments };
  }
  function equalizeLoops(loopA, loopB) {
    if (loopA.segments.length === 0 || loopB.segments.length === 0) {
      return [loopA, loopB];
    }
    const paramsA = segmentParams(loopA);
    const paramsB = segmentParams(loopB);
    const merged = [.../* @__PURE__ */ new Set([...paramsA, ...paramsB])].sort((a, b) => a - b);
    return [
      rebuildLoopAtParams(loopA, merged),
      rebuildLoopAtParams(loopB, merged)
    ];
  }
  function unifyDirection(loopA, loopB) {
    const vertsA = loopVertices(loopA);
    const vertsB = loopVertices(loopB);
    const dirA = windingDirection(vertsA);
    const dirB = windingDirection(vertsB);
    if (Math.sign(dirA) !== Math.sign(dirB) && Math.abs(dirB) > EPSILON) {
      return [loopA, reverseLoop(loopB)];
    }
    return [loopA, loopB];
  }
  function extractLoops(vertices, segments, regions) {
    if (regions && regions.length > 0) {
      const allLoops = [];
      for (const region of regions) {
        for (const loop of region.loops) {
          const bezierSegs2 = loopToBezierSegments(vertices, segments, [...loop]);
          if (bezierSegs2.length > 0) {
            allLoops.push({ segments: bezierSegs2 });
          }
        }
      }
      return allLoops;
    }
    const orderedSegIndices = traceSegments(segments);
    const bezierSegs = loopToBezierSegments(vertices, segments, orderedSegIndices);
    return bezierSegs.length > 0 ? [{ segments: bezierSegs }] : [];
  }
  function loopToBezierSegments(vertices, segments, loop) {
    const result = [];
    for (const segIdx of loop) {
      const seg = segments[segIdx];
      const vStart = vertices[seg.start];
      const vEnd = vertices[seg.end];
      const p0 = { x: vStart.x, y: vStart.y };
      const p3 = { x: vEnd.x, y: vEnd.y };
      const p1 = seg.tangentStart ? { x: vStart.x + seg.tangentStart.x, y: vStart.y + seg.tangentStart.y } : __spreadValues({}, p0);
      const p2 = seg.tangentEnd ? { x: vEnd.x + seg.tangentEnd.x, y: vEnd.y + seg.tangentEnd.y } : __spreadValues({}, p3);
      result.push({ p0, p1, p2, p3 });
    }
    return result;
  }
  function traceSegments(segments) {
    if (segments.length === 0) return [];
    const outgoing = /* @__PURE__ */ new Map();
    for (let i = 0; i < segments.length; i++) {
      outgoing.set(segments[i].start, i);
    }
    const order = [];
    const visited = /* @__PURE__ */ new Set();
    let current = 0;
    while (!visited.has(current) && order.length < segments.length) {
      visited.add(current);
      order.push(current);
      const nextStart = segments[current].end;
      const next = outgoing.get(nextStart);
      if (next === void 0 || visited.has(next)) break;
      current = next;
    }
    return order;
  }
  function sortLoopsByArea(loops) {
    return [...loops].sort((a, b) => loopArea(b) - loopArea(a));
  }
  function normalizeLoopPair(loopA, loopB) {
    const [dirA, dirB] = unifyDirection(loopA, loopB);
    return equalizeLoops(dirA, dirB);
  }

  // src/path-interpolator.ts
  function interpolateSegment(segA, segB, t) {
    return {
      p0: lerpVec2(segA.p0, segB.p0, t),
      p1: lerpVec2(segA.p1, segB.p1, t),
      p2: lerpVec2(segA.p2, segB.p2, t),
      p3: lerpVec2(segA.p3, segB.p3, t)
    };
  }
  function interpolateLoop(loopA, loopB, t) {
    const n = Math.min(loopA.segments.length, loopB.segments.length);
    const segments = [];
    for (let i = 0; i < n; i++) {
      segments.push(interpolateSegment(loopA.segments[i], loopB.segments[i], t));
    }
    return { segments };
  }
  function interpolatePosition(posA, posB, t) {
    return {
      x: posA.x + (posB.x - posA.x) * t,
      y: posA.y + (posB.y - posA.y) * t
    };
  }

  // src/color-utils.ts
  function clamp(v) {
    return Math.max(0, Math.min(1, v));
  }
  function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) {
      return { h: 0, s: 0, l };
    }
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) {
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / d + 2) / 6;
    } else {
      h = ((r - g) / d + 4) / 6;
    }
    return { h, s, l };
  }
  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hslToRgb(h, s, l) {
    if (s === 0) {
      return { r: l, g: l, b: l };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: hueToRgb(p, q, h + 1 / 3),
      g: hueToRgb(p, q, h),
      b: hueToRgb(p, q, h - 1 / 3)
    };
  }
  function lerpAngle(a, b, t) {
    let diff = b - a;
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    let result = a + diff * t;
    if (result < 0) result += 1;
    if (result > 1) result -= 1;
    return result;
  }
  function lerpColor(colorA, colorB, t, space) {
    if (space === "RGB") {
      return {
        r: clamp(lerp(colorA.r, colorB.r, t)),
        g: clamp(lerp(colorA.g, colorB.g, t)),
        b: clamp(lerp(colorA.b, colorB.b, t))
      };
    }
    const hslA = rgbToHsl(colorA.r, colorA.g, colorA.b);
    const hslB = rgbToHsl(colorB.r, colorB.g, colorB.b);
    const h = lerpAngle(hslA.h, hslB.h, t);
    const s = clamp(lerp(hslA.s, hslB.s, t));
    const l = clamp(lerp(hslA.l, hslB.l, t));
    return hslToRgb(h, s, l);
  }
  function simplifyPaint(paint) {
    var _a;
    if (paint.type !== "SOLID" || !paint.color) return null;
    return {
      type: "SOLID",
      color: {
        r: paint.color.r,
        g: paint.color.g,
        b: paint.color.b
      },
      opacity: (_a = paint.opacity) != null ? _a : 1,
      visible: paint.visible !== false
    };
  }
  function lerpSolidPaint(paintA, paintB, t, space) {
    if (!paintA && !paintB) return null;
    if (!paintA) {
      if (t < 0.5) return null;
      const opacity2 = paintB.opacity * ((t - 0.5) * 2);
      return {
        type: "SOLID",
        color: __spreadValues({}, paintB.color),
        opacity: clamp(opacity2),
        visible: true
      };
    }
    if (!paintB) {
      if (t > 0.5) return null;
      const opacity2 = paintA.opacity * ((0.5 - t) * 2);
      return {
        type: "SOLID",
        color: __spreadValues({}, paintA.color),
        opacity: clamp(opacity2),
        visible: true
      };
    }
    const color = lerpColor(paintA.color, paintB.color, t, space);
    const opacity = clamp(lerp(paintA.opacity, paintB.opacity, t));
    return {
      type: "SOLID",
      color,
      opacity,
      visible: true
    };
  }

  // src/color-interpolator.ts
  function interpolateFills(fillsA, fillsB, t, space) {
    const result = [];
    const maxLen = Math.max(fillsA.length, fillsB.length);
    for (let i = 0; i < maxLen; i++) {
      const paintA = i < fillsA.length ? simplifyPaint(fillsA[i]) : null;
      const paintB = i < fillsB.length ? simplifyPaint(fillsB[i]) : null;
      const interpolated = lerpSolidPaint(paintA, paintB, t, space);
      if (interpolated) {
        result.push(interpolated);
      }
    }
    return result;
  }
  function interpolateStrokes(strokesA, strokesB, t, space) {
    return interpolateFills(strokesA, strokesB, t, space);
  }
  function interpolateOpacity(opacityA, opacityB, t) {
    return opacityA + (opacityB - opacityA) * t;
  }

  // src/vector-builder.ts
  function buildVectorNetwork(loop) {
    const N = loop.segments.length;
    if (N === 0) {
      return { vertices: [], segments: [], regions: [] };
    }
    const vertices = [];
    const segments = [];
    for (let i = 0; i < N; i++) {
      const seg = loop.segments[i];
      vertices.push({
        x: seg.p0.x,
        y: seg.p0.y,
        strokeCap: "NONE",
        strokeJoin: "MITER",
        cornerRadius: 0,
        handleMirroring: "NONE"
      });
    }
    for (let i = 0; i < N; i++) {
      const seg = loop.segments[i];
      const endIdx = (i + 1) % N;
      segments.push({
        start: i,
        end: endIdx,
        tangentStart: {
          x: seg.p1.x - seg.p0.x,
          y: seg.p1.y - seg.p0.y
        },
        tangentEnd: {
          x: seg.p2.x - seg.p3.x,
          y: seg.p2.y - seg.p3.y
        }
      });
    }
    return {
      vertices,
      segments,
      regions: [
        {
          windingRule: "NONZERO",
          loops: [segments.map((_, i) => i)],
          fills: []
        }
      ]
    };
  }
  function buildCompoundVectorNetwork(loops, windingRules = []) {
    var _a;
    if (loops.length === 0) {
      return { vertices: [], segments: [], regions: [] };
    }
    if (loops.length === 1) {
      return buildVectorNetwork(loops[0]);
    }
    const allVertices = [];
    const allSegments = [];
    const regionLoops = [];
    let vertexOffset = 0;
    for (let li = 0; li < loops.length; li++) {
      const loop = loops[li];
      const N = loop.segments.length;
      if (N === 0) continue;
      for (let i = 0; i < N; i++) {
        const seg = loop.segments[i];
        allVertices.push({
          x: seg.p0.x,
          y: seg.p0.y,
          strokeCap: "NONE",
          strokeJoin: "MITER",
          cornerRadius: 0,
          handleMirroring: "NONE"
        });
      }
      const loopSegIndices = [];
      for (let i = 0; i < N; i++) {
        const seg = loop.segments[i];
        const localStart = vertexOffset + i;
        const localEnd = vertexOffset + (i + 1) % N;
        allSegments.push({
          start: localStart,
          end: localEnd,
          tangentStart: {
            x: seg.p1.x - seg.p0.x,
            y: seg.p1.y - seg.p0.y
          },
          tangentEnd: {
            x: seg.p2.x - seg.p3.x,
            y: seg.p2.y - seg.p3.y
          }
        });
        loopSegIndices.push(allSegments.length - 1);
      }
      regionLoops.push(loopSegIndices);
      vertexOffset += N;
    }
    return {
      vertices: allVertices,
      segments: allSegments,
      regions: [
        {
          windingRule: (_a = windingRules[0]) != null ? _a : "NONZERO",
          loops: regionLoops,
          fills: []
        }
      ]
    };
  }

  // src/blend-engine.ts
  async function blend(input, options) {
    var _a;
    const { nodeA, nodeB } = input;
    const { steps, colorSpace, shouldGroup } = options;
    const netA = nodeA.vectorNetwork;
    const netB = nodeB.vectorNetwork;
    if (!netA || !netB) {
      throw new Error("One of the selected nodes has no vector network");
    }
    const loopsA = extractLoops(netA.vertices, netA.segments, netA.regions);
    const loopsB = extractLoops(netB.vertices, netB.segments, netB.regions);
    if (loopsA.length === 0 || loopsB.length === 0) {
      throw new Error("Could not extract path data from one of the nodes");
    }
    const results = [];
    const parent = (_a = nodeA.parent) != null ? _a : figma.currentPage;
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const interpolatedLoops = interpolateAllLoops(loopsA, loopsB, t);
      const net = buildCompoundVectorNetwork(
        interpolatedLoops,
        getWindingRules(netA)
      );
      const vecNode = figma.createVector();
      await vecNode.setVectorNetworkAsync(net);
      const pos = interpolatePosition(nodeA, nodeB, t);
      vecNode.x = pos.x;
      vecNode.y = pos.y;
      const fills = interpolateFills(
        nodeA.fills,
        nodeB.fills,
        t,
        colorSpace
      );
      if (fills.length > 0) {
        vecNode.fills = fills;
      }
      const strokes = interpolateStrokes(
        nodeA.strokes,
        nodeB.strokes,
        t,
        colorSpace
      );
      if (strokes.length > 0) {
        vecNode.strokes = strokes;
      }
      vecNode.strokeWeight = nodeA.strokeWeight + (nodeB.strokeWeight - nodeA.strokeWeight) * t;
      vecNode.opacity = interpolateOpacity(nodeA.opacity, nodeB.opacity, t);
      parent.appendChild(vecNode);
      results.push(vecNode);
    }
    let group = null;
    if (shouldGroup) {
      const allNodes = [nodeA, ...results, nodeB];
      group = figma.group(allNodes, parent);
      group.name = "Blend Group";
    }
    return { nodes: results, group };
  }
  function interpolateAllLoops(loopsA, loopsB, t) {
    var _a, _b;
    const sortedA = sortLoopsByArea(loopsA);
    const sortedB = sortLoopsByArea(loopsB);
    const maxLen = Math.max(sortedA.length, sortedB.length);
    const result = [];
    for (let i = 0; i < maxLen; i++) {
      const la = (_a = sortedA[i]) != null ? _a : emptyLoop();
      const lb = (_b = sortedB[i]) != null ? _b : emptyLoop();
      if (la.segments.length === 0) {
        result.push(lb);
      } else if (lb.segments.length === 0) {
        result.push(la);
      } else {
        const [normA, normB] = normalizeLoopPair(la, lb);
        result.push(interpolateLoop(normA, normB, t));
      }
    }
    return result;
  }
  function emptyLoop() {
    return { segments: [] };
  }
  function getWindingRules(net) {
    var _a, _b;
    return (_b = (_a = net.regions) == null ? void 0 : _a.map((r) => r.windingRule)) != null ? _b : ["NONZERO"];
  }

  // code.ts
  var BLENDABLE_TYPES = /* @__PURE__ */ new Set([
    "VECTOR",
    "RECTANGLE",
    "ELLIPSE",
    "POLYGON",
    "STAR",
    "LINE"
  ]);
  figma.showUI(__html__, {
    width: 320,
    height: 360,
    title: "Blend Tool"
  });
  figma.ui.onmessage = (msg) => {
    switch (msg.type) {
      case "CHECK_SELECTION":
        handleCheckSelection();
        break;
      case "BLEND":
        handleBlend(msg.options).catch((err) => {
          const message = err instanceof Error ? err.message : "\u6DF7\u5408\u5931\u8D25";
          figma.ui.postMessage({ type: "ERROR", message });
          figma.notify(message, { error: true });
        });
        break;
      case "CANCEL":
        figma.closePlugin();
        break;
    }
  };
  function handleCheckSelection() {
    const sel = figma.currentPage.selection;
    if (sel.length !== 2) {
      post({ type: "SELECTION", count: sel.length, valid: false, message: `\u8BF7\u9009\u4E2D 2 \u4E2A\u56FE\u5F62\uFF08\u5F53\u524D\u9009\u4E2D ${sel.length} \u4E2A\uFF09` });
      return;
    }
    const types = sel.map((n) => n.type);
    const allBlendable = types.every((t) => BLENDABLE_TYPES.has(t));
    if (!allBlendable) {
      post({ type: "SELECTION", count: 2, valid: false, message: `\u4E0D\u652F\u6301\u7684\u56FE\u5F62\u7C7B\u578B\uFF08${types.join(", ")}\uFF09\u3002\u652F\u6301\uFF1A\u77E9\u5F62\u3001\u692D\u5706\u3001\u591A\u8FB9\u5F62\u3001\u661F\u5F62\u3001\u76F4\u7EBF\u3001\u77E2\u91CF` });
      return;
    }
    post({ type: "SELECTION", count: 2, valid: true, message: `\u5DF2\u9009\u4E2D 2 \u4E2A\u56FE\u5F62\uFF08${types.join(", ")}\uFF09` });
  }
  function ensureVectorNode(node) {
    var _a;
    if (node.type === "VECTOR") {
      return [node, null];
    }
    const parent = (_a = node.parent) != null ? _a : figma.currentPage;
    const index = parent.children.findIndex((c) => c.id === node.id);
    const vec = figma.flatten([node], parent, index + 1);
    vec.visible = false;
    return [vec, vec];
  }
  async function handleBlend(options) {
    const sel = figma.currentPage.selection;
    if (sel.length !== 2) {
      post({ type: "ERROR", message: "\u8BF7\u9009\u4E2D 2 \u4E2A\u56FE\u5F62" });
      return;
    }
    const types = sel.map((n) => n.type);
    const allBlendable = types.every((t) => BLENDABLE_TYPES.has(t));
    if (!allBlendable) {
      post({ type: "ERROR", message: `\u4E0D\u652F\u6301\u7684\u56FE\u5F62\u7C7B\u578B\uFF08${types.join(", ")}\uFF09` });
      return;
    }
    try {
      post({ type: "PROGRESS", current: 0, total: options.steps });
      const [vecA, tempA] = ensureVectorNode(sel[0]);
      const [vecB, tempB] = ensureVectorNode(sel[1]);
      const result = await blend({ nodeA: vecA, nodeB: vecB }, options);
      if (tempA) tempA.remove();
      if (tempB) tempB.remove();
      post({
        type: "RESULT",
        success: true,
        nodeCount: result.nodes.length
      });
      figma.notify(`\u6DF7\u5408\u5B8C\u6210\uFF0C\u751F\u6210\u4E86 ${result.nodes.length} \u4E2A\u4E2D\u95F4\u56FE\u5F62`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "\u6DF7\u5408\u5931\u8D25";
      post({ type: "ERROR", message });
      figma.notify(message, { error: true });
    }
  }
  function post(msg) {
    figma.ui.postMessage(msg);
  }
})();
