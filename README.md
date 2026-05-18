# Blend Tool — Figma Plugin

A Figma plugin that blends/morphs between two vector shapes, inspired by Adobe Illustrator's Blend Tool.

## Features

- **Shape Morphing** — smooth geometric transitions between two vector shapes with different vertex counts (using De Casteljau subdivision)
- **Color Interpolation** — fill, stroke, and opacity blending in RGB or HSL color space
- **Position Blending** — interpolates x/y position between the two shapes
- **Auto-grouping** — optionally groups the originals and intermediates into a named group
- **Open Path Support** — blends between open paths (lines, open vectors) in addition to closed shapes
- **Broad Shape Support** — Rectangle, Ellipse, Polygon, Star, Line, and Vector nodes all work without manual flattening

## How It Works

1. Select **two shapes** in Figma
2. Run **Blend Tool** from the Plugins menu
3. Set the **total number of shapes** (including the originals) and choose a color space
4. Click **Execute Blend**

The plugin extracts the VectorNetwork geometry from each shape, normalizes the two paths (matching vertex counts via De Casteljau subdivision, aligning winding directions), then linearly interpolates vertices, Bézier control points, colors, and positions at each step.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch
```

### Project Structure

```
├── code.ts              # Plugin main-thread entry point
├── src/
│   ├── blend-engine.ts      # Core blend orchestration
│   ├── path-normalizer.ts   # Path extraction, winding detection, vertex equalization
│   ├── path-interpolator.ts # Vertex and control-point interpolation
│   ├── color-interpolator.ts# Fill/stroke/opacity interpolation
│   ├── color-utils.ts       # RGB ↔ HSL conversion
│   ├── region-matcher.ts    # Multi-region compound path matching
│   ├── vector-builder.ts    # Build Figma VectorNetwork from normalized data
│   ├── geometry-utils.ts    # Vector math, De Casteljau subdivision, arc length
│   └── types.ts             # Shared type definitions
├── ui/
│   └── ui.html              # Plugin settings panel
├── manifest.json            # Figma plugin manifest
├── package.json
└── tsconfig.json
```

### Loading in Figma

1. In Figma, go to **Plugins → Development → Import plugin from manifest...**
2. Select `manifest.json` from this project
3. The plugin will appear under **Plugins → Development → Blend Tool**

## Requirements

- Figma desktop app or web app
- `documentAccess: "dynamic-page"` (required by modern Figma Plugin API)

## Tech Stack

- TypeScript
- esbuild (bundling)
- Figma Plugin API v1.0.0+

## License

MIT
