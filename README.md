# spcrop

Image cropping, arranging, and exporting tool.

> Built by the author for fast sprite slicing workflows.

[中文 README](./README.zh.md)

## Index

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Scripts](#scripts)
- [Typical Workflow](#typical-workflow)
- [Canvas Controls](#canvas-controls)
- [Default Shortcuts (Editable in UI)](#default-shortcuts-editable-in-ui)
- [Project Structure](#project-structure)

## Features

- Drag and drop PNG/JPG files as layers
- Multi-select layers, drag to move, arrow key nudging (Shift for faster step)
- Crop a region and resize to target size (contain) as a new layer
- One-click fixed-size crop box (default `128x128`)
- Real-time crop box pixel size and angle label
- Drag the crop box after creating it
- Rotate crop by dragging corner handles (free angle)
- Hold Shift while drawing crop box to lock `1:1`
- Active layer supports 8 resize handles (corners + edges)
- Hold Shift while resizing a layer to keep aspect ratio
- Mouse wheel pans canvas (vertical/horizontal)
- Middle mouse button pans canvas
- Modifier + wheel to zoom (configurable)
- Top/left pixel rulers around canvas
- Auto horizontal/vertical arrangement for selected layers
- Export selected layers (or all when none selected)
- Shortcut editor (record new keys, persist, restore defaults)

## Requirements

- Node.js 18+
- npm 9+

## Quick Start

```bash
npm install
npm run dev
```

Default URL: `http://127.0.0.1:5173`

## Scripts

```bash
npm run dev       # start dev server
npm run typecheck # TypeScript type check
npm run build     # production build
npm run preview   # preview build output
```

## Typical Workflow

1. Drop one or multiple images.
2. Select a layer and start cropping (or use one-click fixed-size crop).
3. Set target size (for example `128x128`) and create a new layer.
4. Multi-select layers and align horizontally.
5. Export PNG.

Example: 6 layers of `128x128` aligned horizontally export to `768x128`.

## Canvas Controls

- Wheel: pan canvas
- Middle button drag: pan canvas
- Zoom: `zoom modifier + wheel`
  - Default modifier: `Alt/Option(⌥)`
  - In UI, you can switch to `Ctrl` / `Meta(Command)` / `Shift` / `None`
- Crop mode: drag corners to rotate crop freely
- Layer transform: drag active layer handles to resize (`Shift` = keep aspect)

## Default Shortcuts (Editable in UI)

- `C`: start/stop crop mode
- `X` or `Esc`: clear crop box
- `R` or `Enter`: create new layer from crop
- `B`: create fixed-size crop box
- `G`: spread selected layers
- `H`: align horizontally
- `V`: align vertically
- `Delete` or `Backspace`: delete selected layers
- `E`: export PNG
- `Arrow keys`: move selected layers (`Shift + Arrows` = 10px step)

## Project Structure

```text
index.html
src/
  main.ts
  styles.css
vite.config.ts
tsconfig.json
```
