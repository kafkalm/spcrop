# Crop Selection Rotation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add free-angle crop selection rotation and Photoshop-like active-layer resize handles, while keeping crop-based actions working.

**Architecture:** Introduce pure geometry helpers (`src/crop-rotation.ts`, `src/layer-transform.ts`) and wire them into `src/main.ts` crop interaction/rendering, layer transform interaction, and extraction paths. Use transformed canvas sampling for rotated crop outputs.

**Tech Stack:** TypeScript, Vite, Vitest, HTML Canvas 2D

---

### Task 1: Geometry utilities (TDD)

**Files:**
- Create: `src/crop-rotation.ts`
- Test: `src/__tests__/crop-rotation.test.ts`

**Step 1: Write failing tests**
- point-in-rotated-rect
- rotate-handle hit test
- rotated crop intersects axis-aligned layer rect
- angle accumulation across `-PI`/`PI`

**Step 2: Run tests and verify failure**
- Run: `npm test -- src/__tests__/crop-rotation.test.ts`

**Step 3: Implement minimal utility code**
- corner generation
- inverse rotation hit test
- edge intersection + containment checks
- normalized angle delta

**Step 4: Run tests and verify pass**
- Run: `npm test -- src/__tests__/crop-rotation.test.ts`

### Task 2: Main crop interaction and rendering

**Files:**
- Modify: `src/main.ts`

**Step 1: Extend crop state and interaction modes**
- add rotation fields and rotating pointer tracking
- handle mousedown priority: rotate handle > drag crop > create crop

**Step 2: Update mousemove/mouseup flows**
- apply incremental angle update while rotating
- preserve existing drag/select behavior

**Step 3: Update crop overlay rendering**
- draw rotated rect
- draw 4 corner handles
- show angle in label

**Step 4: Run type check**
- Run: `npm run typecheck`

### Task 3: Rotated crop extraction integration

**Files:**
- Modify: `src/main.ts`

**Step 1: Replace axis-aligned crop slice extraction**
- add rotated crop extraction canvas path
- add rotated crop vs layer overlap check

**Step 2: Integrate into action paths**
- copy crop
- create layer from crop
- AI source crop
- erase crop content

**Step 3: Run full verification**
- `npm test`
- `npm run typecheck`
- `npm run build`

### Task 4: Layer resize handles integration

**Files:**
- Modify: `src/main.ts`
- Create: `src/layer-transform.ts`
- Create: `src/__tests__/layer-transform.test.ts`

**Step 1: Add failing tests for layer handle hit test and resize math**

**Step 2: Implement layer transform helpers**
- 8 handles (corners + edges)
- shift keep-aspect resize
- min-size clamp

**Step 3: Integrate into canvas events and rendering**
- mousedown: resize-handle priority before layer drag
- mousemove: apply resize deltas
- render active layer handles

**Step 4: Verify**
- `npm test -- src/__tests__/layer-transform.test.ts`
- `npm run typecheck`

### Task 5: Documentation update

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `index.html` tips text

**Step 1: Add rotation usage docs**
- mention corner rotate handles and free-angle rotation

**Step 2: Build verification**
- `npm run build`
