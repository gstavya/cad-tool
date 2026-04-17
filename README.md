# CAD Tool

Browser-based CAD sandbox for 2D sketching, extrusion, and basic 3D boolean operations.

## Run

```bash
npm start
```

Then open the local URL shown in terminal.

## Core Workflow

1. Pick a plane (`XY`, `XZ`, `YZ`) or `3D`.
2. Draw sketches (`Rectangle`, `Circle`, `Polygon`).
3. Use `Extrude (Fill)` or `Extrude (Cut)`:
   - click button first
   - select regions
   - press `Enter`
   - enter depth
4. Use booleans in 3D:
   - `Union`: click `Union` -> select solids -> `Enter`
   - `Subtract`: click `Subtract` -> select base solid -> `Enter` -> select cutter solids -> `Enter`

## Controls

- `Select`: select sketches/solids
- `Delete` or `Backspace`: delete current selection
- `Escape`: cancel active drawing/selection mode
- `Enter`: confirm polygon, extrusion mode, union mode, or subtract step
- `Save` / `Load`: persist project JSON
- `Reset All`: clear everything

## Notes

- Sketch lines are red; selected sketch outline is blue.
- Solids use a silvery gray material.
- You can select a solid face in 3D and sketch on that face workplane.
