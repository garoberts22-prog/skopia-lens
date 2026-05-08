# SKOPIA Lens — Changelog

---

## v0.9.1 (May 2026)

### XER Parser: Switched to MPXJ (GPL removed)

**File:** `parsers/xer_adapter_mpxj.py` (replaces `parsers/xer_adapter.py`)

- **Replaced xerparser (GPL-3.0) with MPXJ** for XER parsing — now LGPL across the board, safe for commercial SaaS
- `XERMPXJParserAdapter` reads XER via the same Java bridge used for MPP — consistent parsing behaviour between formats
- `_build_wbs_code_map()` implements three-route WBS name resolution:
  - Route A: `wbs_entity.getCode()` — direct (MPXJ 12+)
  - Route B: parent-chain name breadcrumb from `getName()`
  - Route C: depth-based fallback (handled in `main.py` via `model.wbs_nodes`)
- `wbs_path` now set to a friendly breadcrumb when Route A succeeds; otherwise resolved in `main.py`
- Constraint map updated: all 10 P6 constraint codes mapped (`AS_SOON_AS_POSSIBLE` through `MANDATORY_FINISH`)
- Relationship type map handles both long-form (`FINISH_START`) and short-form (`FS`) strings from MPXJ

### Backend: WBS reconstruction fix (main.py v0.9)

- `_build_wbs_nodes()` rewritten: level computed from parent-chain depth, NOT dot-splitting the ID
  - Prevents wrong levels on non-numeric WBS codes like `RHB.1.1.1`
- Project root node excluded from display hierarchy — becomes implicit root
- Fallback path: if `model.wbs_nodes` is empty, reconstructs WBS tree from `wbs_path` breadcrumbs on activities
- `wbs_name` (friendly display name) added to every activity in `schedule_data`
- Activity→real WBS remapping (`act_wbs_remap`) applied before serialisation

### ScheduleView (v0.9.1)

- **Vertical divider fix:** left panel width now fixed in px, not %; table has its own scroll — no column stretching
- **Grouping panel:** added "Hide empty WBS bands" toggle
- **Critical-only mode:** skips WBS bands entirely, shows flat waterfall of critical activities
- **Column header sort:** click asc/desc (↑/↓) on all schedule table columns and relationship panel columns
- **Header styling:** table and relationship panel headers use `SK.bg (#F7F8FC)` with 2px bottom border — matches prototype
- **Relationship panel Columns button:** hover-to-open, hover-away-to-close, portal opens upward pinned to bottom-right of button

---

## v0.9.0 (May 2026)

### React Frontend: Full Build — SKOPIA Lens v0.9

Complete React frontend built from the v0.8 prototype. All four views wired into a single-SPA shell (no React Router — view state managed in `App.jsx`).

### App Shell (`App.jsx` + `main.jsx`)

- Single-page app with `useState` navigation — no React Router, no URL changes
- Four views: Upload, Health Check, Schedule, Convert
- `NavPanel` drives `setView()` — `EmptyState` gate on Health Check and Schedule until data loaded
- **Header:** charcoal `#1E1E1E` + 3px gradient accent strip, SKOPIA .lens wordmark with gradient fill, project name + format badge (XER cyan / MPP amber) + data date chip + activity count — all shown once analysis loaded
- Settings ⚙ button placeholder in header (hover state wired)
- Convert view has no data dependency — works standalone

### UploadView (`pages/UploadView.jsx`)

- Two-card upload layout: Current Schedule (left) + Baseline Schedule (right, disabled until schedule loaded)
- Drag-and-drop + click-to-browse on both cards
- File input accepts `.xer`, `.mpp`, `.xml`
- 4-stage animated progress overlay: Uploading → Parsing → Health checks → Analytics
  - Spinner + stage label + gradient progress bar + stage pipeline sub-label
- Baseline card: purple gradient accent (`#7C3AED → #4A6FE8`), disabled/greyed until schedule loaded
- Both cards show stats strip once loaded (activity count, relationship count, format badge)
- Clear baseline button in baseline stats strip
- Separate loading/error states for each card
- `AnalysisContext` stores both `analysis` and `baseline` independently

### HealthCheckView (`pages/HealthCheckView.jsx`)

- **Row 1:** Grade ring (SVG gauge, 140×140, colour by grade) + 3×2 stat tile grid (Total, Incomplete, Complete, In Progress, Milestones, Relationships)
- **Row 2:** Health Profile radar/spider chart (Recharts `RadarChart`, 260px fixed) + 4-column check card grid
- **All 14 DCMA checks shown:** backend returns 11; checks #9–14 computed client-side from API response
  - #9 Resources — proxy from summary stats (info only)
  - #10 Missed Tasks — incomplete tasks past data date (info only)
  - #11 CP Integrity Test — derived from `open_ends` + `longest_path` length
  - #12 CP Length — sum of durations on longest path (info)
  - #13 Near-Critical — activities with TF 0–20d from float histogram bins
  - #14 BEI — Baseline Execution Index placeholder (info, requires per-task actuals)
- **Check settings cog** (`CheckSettingsCog` component): per-check threshold and enabled/disabled toggle
- **Dirty banner:** "Settings changed — re-run to update results" spans all 4 columns with Re-run button
- **Check Detail Modal** (`CheckDetailModal`): opens on card click with check-specific visualisation and flagged activity table
- Grade ring and spider chart update immediately when checks are disabled/re-enabled
- Status colours: pass `#16A34A`, warn `#D97706`, fail `#DC2626`, info `#2563EB`
- Footer hint: "Click any health check card to view details, flagged activities, and visualisations"

### ScheduleView (`pages/ScheduleView.jsx`)

Full Gantt implementation ported from v0.8 prototype into React component.

**CPM Engine (client-side, JS):**
- Forward pass: FS/SS/FF/SF, constraints, calendar-aware
- Backward pass: Late Start/Finish, Total Float, Free Float, Critical flag
- `buildCalendarMap()` — converts API calendars (Python 1=Mon..7=Sun) to JS Day convention
- `cpmAdvanceWorkDays()` / `cpmRetreatWorkDays()` — calendar-aware day advancement
- As-of date picker, Recalculate/Reset, always from original snapshot
- MSP critical path derivation (backward walk when flags/float absent)

**Schedule Table:**
- 20 columns, 7 categories, Column Manager with reorder and column resize
- WBS bands with collapse/expand; "Hide empty WBS bands" toggle
- Var BL Start/Finish: calendar-aware variance columns (requires baseline loaded)
- Constraint Type column: code displayed, full name on hover tooltip
- Column sort (asc/desc), yellow row selection highlight, keyboard ↑/↓ navigation
- Row striping, configurable row height

**Gantt Chart:**
- Three-tier timeline (Year / Quarter / Month)
- Configurable bars: style (filled/outline), colour scheme (pastel/vivid), opacity, corner radius, labels
- WBS summary bars, baseline bars (purple), milestone diamonds, constraint markers
- As-of date line (cyan dashed), chart width slider
- Bar colour schemes: pastel (`#02787C` normal, `#DC2626` critical, `#16A34A` complete) / vivid

**Toolbar Controls (hover-to-open via HoverPanel, 300ms close delay):**
- Filter (Show All / Critical Only)
- Grouping (WBS + Hide empty toggle)
- Column Manager
- Duration Manager (Days / Weeks / Months)
- Date Format Manager (DD/MM/YYYY, DD/MM/YY, DD-Mon-YY)

**Relationship Panel (split pane, bottom):**
- Predecessors left, Successors right
- Per-pane Column Manager via `ReactDOM.createPortal` (opens upward, escapes `overflow: hidden`)
- Column visibility, reorder, resize, sort, Go-to navigation
- Draggable divider to resize panel height

**Customise Panel:**
- Slides in from right on ⚙ button; closes on mouse-leave
- Row height, striped rows, bar style, colour scheme, fill opacity, corner radius
- Bar labels, WBS summary bars, critical path highlight, milestone size, baseline bars, today line

**Footer:** version, visible activity count, active filter text, selected activity ID

### ConvertView (`pages/ConvertView.jsx`)

4-step wizard for client-side schedule format conversion. No backend calls — runs 100% in the browser.

- **Step 1 — Import:** direction selector (XER→MSP XML or MSP XML→XER) + drag-drop file zone
  - `.mpp` binary files blocked with helpful message ("Save As XML in MS Project first")
  - Extension validation against selected direction
- **Step 2 — Validate:** pass/fail/warn/info checklist from `convertor.js` validators
  - `validateXER()` / `validateMSPXML()` — pure functions
  - Fails block conversion; warns allow proceeding with confirmation
- **Step 3 — Convert:** animated progress bar with 7-stage labels per direction
  - `convertXERtoMSP()` / `convertMSPtoXER()` from `convertor.js`
  - Staged rendering via `setTimeout` chain so progress bar animates
- **Step 4 — Download:** conversion summary grid + download button (green `#16A34A`)
  - v0.1 limitations callout: resources, baselines, activity codes, UDFs not converted
  - "Start New Conversion" ghost button resets wizard
- **Companion module:** `src/convertor.js` — all conversion logic. Pure functions, no React, no DOM.
- Works standalone — no schedule upload required

### Backend: `schedule_data` block added (main.py v0.8→v0.9)

New `schedule_data` key added to the API response for the Schedule view:

```
schedule_data: {
  project_start, project_finish,
  activities: [{ id, name, wbs, wbs_name, wbs_path, start, finish,
                 base_start, base_finish, act_start, act_finish,
                 orig_dur, rem_dur, total_float, free_float,
                 pct, status, type, cstr_type, cstr_date,
                 calendar, cal_id, critical }],
  wbs_nodes: [{ id, name, level, parent, code }],
  relationships: [{ from_id, to_id, type, lag_days }],
  calendars: { [cal_id]: { name, work_days, exceptions } }
}
```

- Summary tasks excluded from `activities` list
- `is_critical_source` flag used; falls back to `total_float_hours <= 0`
- Calendar exceptions: non-working dates → `false`, work exceptions → `true`
- `parse_warnings` added to serialised response

---

## v0.8.0 (April 2026)

### Frontend Prototype: Schedule Gantt v7.6.2

Complete single-file React prototype (`skopia_gantt_v7_6_2.html`) serving as the design reference for the React build.

- **Navigation:** collapsible sidebar, pin toggle, three nav items (Upload, Schedule, Dashboard placeholder)
- **App header:** SKOPIA .lens wordmark, project name, source badge, baseline badge, as-of date chip, CPM controls, Customise button
- **XER parser (client-side):** PROJECT, TASK, PROJWBS, TASKPRED, CALENDAR, CLNDREXCP tables; multi-project selector modal; full 10-code constraint mapping
- **MSP XML parser (client-side):** case-insensitive tags, WBS synthesis from codes, WeekDay/Exception calendar parsing, constraint parsing (numeric 0-8)
- **Baseline upload:** separate file input, purple baseline bars with end-cap ticks
- **Schedule table:** 20 columns, 7 categories, Column Manager with reorder + resize, WBS bands + collapse/expand, Var BL Start/Finish, Constraint Type tooltip, column sort, selection highlight, keyboard navigation
- **Gantt chart:** three-tier timeline, configurable bars, WBS summary bars, baseline bars, milestone diamonds, constraint markers, as-of date line, today line, chart width slider, legend
- **Toolbar:** Filter, Grouping, WBS Filter, Column Manager, Duration Manager, Date Format Manager (all hover-to-open)
- **Relationship panel:** split pane, per-pane column manager via `ReactDOM.createPortal`, Go-to navigation
- **CPM engine (JS):** forward + backward pass, calendar-aware 3-path day advancement, as-of date, Recalculate/Reset
- **Customise panel:** row height, striped rows, bar style/opacity/radius, labels, WBS bars, critical highlight, milestone size, baseline bars, today line
- **Footer:** version, visible activity count, filter status

No backend logic changes — v0.7 validation results remain valid.

---

## v0.7.0 (April 2026)

### Brand migration: ScheduleCheck → SKOPIA Lens

- Product renamed to SKOPIA Lens across all files
- **SKOPIA Brand Manual v1.0** formalised:
  - Primary gradient: `#1EC8D4` (Cyan) → `#4A6FE8` (Periwinkle) → `#2A4DCC` (Royal Blue) at 135°
  - Dark background: `#1E1E1E` (Charcoal)
  - Fonts: Montserrat Bold/Black (headings), Open Sans Regular/SemiBold (body), JetBrains Mono (data)
  - Status: Pass `#16A34A`, Warn `#D97706`, Fail `#DC2626`, Info `#2563EB`
- Skills captured and documented:
  - `skopia-branding` — colours, fonts, CSS variables, Tailwind config, React patterns
  - `schedule-gantt` — Gantt build patterns and lessons
  - `p6-xer-to-msp-xml` — P6 → MSP XML export lessons
  - `msp-p6-conversion` — MSP → P6 XER via MPXJ lessons
- Product tier naming formalised: SKOPIA Lens / SKOPIA Track / SKOPIA Build

---

## v0.6.0 (April 2026)

### CPM Engine, Calendar Parsing, Backend Hardening

**CPM Engine (`cpm/cpm.py`):**
- Forward pass: topological sort, FS/SS/FF/SF relationship types, constraint handling
- Backward pass: Late Start/Finish, Total Float, Free Float calculation
- Calendar-aware day advancement
- Critical path identification

**Validation vs P6 (Sample Schedule):**

| Source | ±1 day match | Project finish |
|---|---|---|
| XER | 86.8% (2,080/2,395) | 2028-09-22 ✓ exact |
| MPP | 89.2% (2,147/2,406) | 2028-09-22 ✓ exact |

**Known CPM gaps (documented, not bugs):**
- ALAP scheduling not yet implemented (~20 activities affected)
- Date-level granularity vs P6's hour-level (causes ~1-day EF rounding on ~85% of activities)
- Negative lag (leads) not tested in CPM engine

**Backend additions:**
- `build_longest_path()` — driving path trace using CPM results
- `build_float_histogram()` — 9-bin distribution with severity colours
- `build_network_metrics()` — fan distribution + top-10 bottlenecks
- `build_relationship_breakdown()` — FS/SS/FF/SF counts
- `_apply_normalised_scores()` — 0-100 per check for spider chart
- `run_health_check()` orchestrator updated to include all analytics

---

## v0.5.0 (April 2026)

### Initial Backend — XER + MPP Parsing, 11 Health Checks, FastAPI

**Core data model (`core/models.py`):**
- `ScheduleModel`, `Activity`, `Relationship`, `Calendar`, `WBSNode`, `CalendarException`
- Full enum set: `ActivityStatus`, `ActivityType`, `RelationshipType`, `ConstraintType`
- `get_calendar()` lookup, `is_summary` property

**XER Parser (`parsers/xer_adapter.py`, now superseded by `xer_adapter_mpxj.py`):**
- Built on xerparser 0.13.9 (GPL-3.0) — later replaced in v0.9.1
- Validated against XER Reader on Sample Schedule (2,448 activities, 4,988 relationships)
- Exact match on all 8 DCMA metrics

**MPP Parser (`parsers/mpp_adapter.py`):**
- MPXJ via JPype (LGPL) — JVM required
- SNET default filtering: reduces 2,334 raw constraints → 21 real constraints
- Week-unit duration conversion (`_java_duration_to_hours()`)
- Phantom root task (UID=0) skipped
- `StatusDate` None-handling for P6-exported MPP files
- Validated: same grade, same pass/fail, same relationship count as XER parse of same schedule

**11 Health Checks (`checks/engine.py`):**
- DCMA #1 Logic completeness — missing predecessors/successors (threshold ≤5%)
- DCMA #2 Leads (negative lags) — hard fail at any count
- DCMA #3 Lags — positive lag overuse (threshold ≤5%)
- DCMA #4 Relationship types — FS dominance (threshold ≥90% FS)
- DCMA #5 Hard constraints — constrained incomplete tasks (threshold ≤5%)
- DCMA #6 High float — TF >44 working days (threshold ≤5%)
- DCMA #7 Negative float — hard fail at any count
- DCMA #8 Duration — activities >44 working days (threshold ≤5%)
- Calendar validation — missing/invalid calendar assignments
- Logic density — relationship-to-task ratio + fan-in/fan-out hub detection
- Bottleneck detection — fan_in × fan_out scoring, fragile hub flagging

**API (`api/main.py`):**
- `POST /api/analyse` — single multipart upload, returns complete dashboard JSON
- Docker deployment config
- CORS: `allow_origins=["*"]` for dev

**Validation Results (Sample Schedule vs XER Reader):**

| Metric | XER Reader | SKOPIA | Match |
|---|---|---|---|
| Logic | 0.00% PASS | 0.0% PASS | ✓ |
| Leads | 0 PASS | 0.0% PASS | ✓ |
| Lags | 0.40% PASS | 0.4% PASS | ✓ |
| Rel types (non-FS) | 5.00% PASS | 5.0% PASS | ✓ |
| Hard constraints | 0.00% PASS | 0.0% PASS | ✓ |
| High float | 83.00% FAIL | 83.0% FAIL | ✓ |
| Negative float | 0 PASS | 0.0% PASS | ✓ |
| Long durations | 3.70% PASS | 3.9% PASS | ~ |
