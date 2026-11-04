# Beyond 90: visual design direction

## 1. Position: independent, and unmistakably not a vendor's product

Beyond 90 is an independent open source project, not affiliated with or endorsed by any vendor, and it must not look like any vendor's product: no logo, mark, brand colour, mascot or wordmark of a security company, and no vendor name in the interface.

## 2. Principles taken from the analysis

1. **Graph first.** The adoption pipeline is already a graph: cloud source, inventory, controls, findings. Draw it as nodes and edges, with the four leaks as the places where an edge thins.
2. **Quiet grid.** A faint graph-paper background at very low contrast, only behind the pipeline view, never behind tables.
3. **One accent against neutrals.** A single blue accent on warm-neutral surfaces; colour carries meaning, not decoration.
4. **Playful in small doses, serious in numbers.** Microcopy and empty states can be light; every figure, axis and label is plain and precise.
5. **Milestones, not trophies.** Borrow the idea of badges and streaks, as "checkpoints" at 90, 95, 98 and a streak of quarters with the bar raised. Nothing that suggests the job is finished.
6. **Show the gap.** The signature visual is the difference between the naive number and the real one.

## 3. Palette

Built on the validated default palette of the data-visualization method used for this project, so every chart colour is checked rather than eyeballed. The categorical order is fixed and never cycled.

### Stage colours (categorical, fixed order)

| Slot | Stage | Light | Dark |
|---|---|---|---|
| 1 | L1 Procurement | `#2a78d6` | `#3987e5` |
| 2 | L2 Processing | `#eb6834` | `#d95926` |
| 3 | L3 Tooling | `#1baf7a` | `#199e70` |
| 4 | L4 Findings | `#eda100` | `#c98500` |

Validation run (OKLab, adjacent pairs):
- Light on `#fcfcfb`: lightness band, chroma floor, colour-blind separation (worst 9.1, protan) and normal-vision floor (worst 22.9) all pass. Contrast against the surface warns for aqua (2.74) and yellow (2.11), so those two stages always carry visible direct labels and a table view is always available.
- Dark on `#1a1a19`: all checks pass (worst colour-blind separation 8.4, normal-vision 19.8, all slots at least 3:1).

Only four stages exist, so the all-pairs cap of three does not matter for adjacent encodings (bars, stacks, lines). If a form needs every pair distinguishable (scatter, small multiples), facet by stage instead of colouring four series.

### Naive versus real

| Encoding | Treatment |
|---|---|
| Naive (legacy) score | Muted ink outline bar, no fill, dashed label "legacy metric" |
| Real (Yield) | Solid blue `#2a78d6` / `#3987e5` |
| The gap between them | Hatched fill at 45 degrees in the blue ramp, labelled with the number of points lost |

### Neutrals and status

| Role | Light | Dark |
|---|---|---|
| Chart surface | `#fcfcfb` | `#1a1a19` |
| Page | `#f9f9f7` | `#0d0d0d` |
| Primary ink | `#0b0b0b` | `#f0efec` |
| Secondary ink | `#52514e` | `#c3c2b7` |
| Muted (axes, ticks) | `#898781` | `#898781` |
| Gridline | `#e1e0d9` | `#2c2c2a` |
| Baseline | `#c3c2b7` | `#383835` |

Status colours (good `#0ca30c`, warning `#fab219`, serious `#ec835a`, critical `#d03b3b`) are reserved for state, always with an icon and a label, and never reused as a series colour. Text always wears ink colours, never the series colour.

### Sequential and diverging

- Score heatmaps (portfolio by stage): one-hue blue ramp from light to dark. Ordinal use starts no lighter than step 250 (`#86b6ef`) on light.
- Change versus last quarter: blue and red poles with a grey midpoint (`#f0efec` light, `#383835` dark).

## 4. Typography

System sans only: `system-ui, -apple-system, "Segoe UI", sans-serif`. No display face. The hero score uses default proportional figures; tables and axis ticks use tabular numerals so columns align.

## 5. Signature views

1. **Score hero.** Large real Yield figure, the naive figure as a ghost outline beside it, the ceiling version as a small chip.
2. **Pipeline.** Left to right: cloud sources, inventory, controls, findings. Each stage is a node with its pass rate; the edge between nodes thins by the share lost. Hatched segments mark leaks.
3. **Waterfall.** Four bars from 100 down to Yield, one per stage, in stage colours, with the lost share labelled.
4. **Portfolio table.** One row per customer: Yield, stage rates, change versus last quarter, next playbook. Heatmap shading only on the four stage columns.
5. **Playbook queue.** Gap, owner, expected effect in points, due date.
6. **Checkpoint line.** 90, 95, 98 as marks on a track with the current Yield and the moving ceiling.

### Views added in 0.3

7. **What changed.** Diverging horizontal bars, one per factor, blue to the right and red to the left (the diverging pair of the palette, neutral midline). The "bar moved" factor is hatched so it reads as headroom and not as the customer's doing. The sum is stated in words under the chart.
8. **Roadmap.** A line of projected Yield by week with dashed checkpoint lines at 90, 95 and 98. Weeks where Yield dips are marked in the negative colour with a tooltip that names the cause; the J-curve is explained in plain text next to it.
9. **Universe.** A short paragraph and a table, no chart: the estimate is uncertain and a chart would suggest more precision than it has.

## 6. Chart rules (applied everywhere)

- One axis only; never a dual-axis chart. Two measures of different scale become two charts.
- Thin marks, rounded data-ends anchored on the baseline, 2 px gap between adjacent fills, 2 px surface ring on overlapping marks.
- Legend always present for two or more series; direct labels on at most four; never a number on every point.
- Hover tooltips on every chart; crosshair on lines; hit targets larger than the marks.
- A table view for each chart; texture fill (45 and 135 degree lines) switches on for print, forced-colors and the accessibility setting only.
- Dark mode is its own selected set of steps, validated against the dark surface, not an automatic inversion.
- Reserved status colours never double as series colours.

## 7. Voice

English, short, concrete. Labels say what happened ("7 accounts not connected"), not how to feel. Empty states may be light ("Nothing leaking here. Raising the bar."), but never in a number, a tooltip or a report.

## 8. Not decided yet

- Logo and name treatment for Beyond 90 itself (a simple wordmark; no mark until the pipeline view exists).
- Whether the graph-paper background survives a real screen test.
- Print layout for the QBR export.
