// ── ScheduleView.jsx (v0.9.2) ────────────────────────────────────────────────
//
// Fixes applied vs v0.9:
//  1. Vertical divider no longer stretches table columns — uses flex layout
//     with fixed left panel width in px, not %. Table has its own scroll.
//  2. Grouping panel has "Hide empty WBS bands" toggle
//  3. Critical-only mode preserves WBS bands — toggled via Grouping panel
//  4. Column header click sorts asc/desc (↑/↓) — schedule table + rel panel
//  5. Table and relationship panel headers use SK.bg (#F7F8FC) with
//     2px bottom border — matching prototype exactly
//  6. Relationship panel Columns button: hover-to-open, hover-away-to-close,
//     portal opens UPWARD pinned to bottom-right of the button
//  7. Scenes — saved view layout snapshots. SceneContext lifts scene state so
//     it survives navigation. SceneManager panel added between As-of chip and
//     the Customise cog. Default applied only on new schedule upload or explicit
//     selection. User scenes persist in localStorage across sessions.
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { useAnalysis } from '../context/AnalysisContext'
import { useScene }    from '../context/SceneContext'
import SceneManager    from '../components/SceneManager'

// ── Brand colours ─────────────────────────────────────────────────────────────
const SK = {
  pass:'#16A34A', warn:'#D97706', fail:'#DC2626',
  peri:'#4A6FE8', cyan:'#1EC8D4', blue:'#2A4DCC',
  muted:'#6B7280', text:'#1A1A2E', border:'#E2E6F0',
  bg:'#F7F8FC', card:'#FFFFFF', header:'#1E1E1E', nav:'#16213e',
  grad:'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
  sel:'rgba(253,224,71,0.28)',
  bar:'#02787C',
  fHead:"'Montserrat',Arial,sans-serif",
  fBody:"'Open Sans',Arial,sans-serif",
  fMono:"'JetBrains Mono',monospace",
}

// ── Timeline layout constants (match prototype) ───────────────────────────────
const TL_YEAR_H  = 18
const TL_QTR_H   = 16
const TL_MONTH_H = 16
const HDR_H      = TL_YEAR_H + TL_QTR_H + TL_MONTH_H + 3
const DAY_MS     = 86400000
const GANTT_W_MIN     = 200
const GANTT_W_MAX     = 2000
const GANTT_W_DEFAULT = 600
const pxToLabel = (px) => Math.round(((px - GANTT_W_MIN) / (GANTT_W_MAX - GANTT_W_MIN)) * 100) + '%'

// Bar colour schemes
// Pastel — the SKOPIA defaults (teal, matching brand)
// Vivid  — high-contrast field palette, deliberately diverges from brand colours
//   Normal    → Steel Blue   (#4682B4) — clear, high-contrast, readable in field conditions
//   Critical  → Burnt Orange (#CC5500) — distinct from both brand red and normal blue
//   Complete  → Forest Green (#228B22) — deeper green than brand pass colour, clearly "done"
const BAR_SCHEMES = {
  pastel: { normal:'#02787C', critical:'#DC2626', complete:'#16A34A' },
  vivid:  { normal:'#4682B4', critical:'#CC5500', complete:'#228B22' },
}

// WBS band colour palettes — one per scheme.
// Levels 1-7 are fully specified. Level 8+ wraps back to SKOPIA brand blues (both schemes).
const WBS_COLS_PASTEL = [
  '#4A6FE8', // L1 — Periwinkle Blue  (SKOPIA brand)
  '#3AACE0', // L2 — Sky Blue
  '#1EC8D4', // L3 — Cyan
  '#5AD4DC', // L4 — Light Cyan
  '#8BBFE8', // L5 — Powder Blue
  '#A8D4F0', // L6 — Ice Blue
  '#6B9ED4', // L7 — Muted Blue
]
const WBS_COLS_VIVID = [
  '#4682B4', // L1 — Steel Blue      (vivid palette)
  '#228B22', // L2 — Forest Green
  '#CC5500', // L3 — Burnt Orange
  '#708090', // L4 — Slate Grey
  '#7851A9', // L5 — Royal Purple
  '#008080', // L6 — Teal
  '#DAA520', // L7 — Deep Gold
  // L8+ → SKOPIA brand blues (same as pastel fallback)
]
// SKOPIA brand blues used as overflow for both schemes (level 8+)
const WBS_COLS_OVERFLOW = ['#4A6FE8','#3AACE0','#1EC8D4','#5AD4DC','#8BBFE8','#A8D4F0']

// wbsCol is now scheme-aware. Pass tweaks.barScheme (or 'pastel' default).
// The standalone WbsFilterPanel always uses pastel — it's chrome, not data.
const wbsColPastel = (lv) => {
  if (lv <= WBS_COLS_PASTEL.length) return WBS_COLS_PASTEL[lv - 1]
  return WBS_COLS_OVERFLOW[(lv - WBS_COLS_PASTEL.length - 1) % WBS_COLS_OVERFLOW.length]
}
const wbsColVivid = (lv) => {
  if (lv <= WBS_COLS_VIVID.length) return WBS_COLS_VIVID[lv - 1]
  return WBS_COLS_OVERFLOW[(lv - WBS_COLS_VIVID.length - 1) % WBS_COLS_OVERFLOW.length]
}
// Legacy helper used by WbsFilterPanel (always pastel — filter UI is chrome not data)
const wbsCol = wbsColPastel

// ── Formatters ────────────────────────────────────────────────────────────────
const FMTS = {
  'DD/MM/YYYY': (d) => d.toLocaleDateString('en-AU',{day:'2-digit',month:'2-digit',year:'numeric'}),
  'DD/MM/YY':   (d) => d.toLocaleDateString('en-AU',{day:'2-digit',month:'2-digit',year:'2-digit'}),
  'DD-Mon-YY':  (d) => {
    const s = d.toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'2-digit'})
    return s.replace(/ /g,'-')
  },
}
function fmtDate(iso, fmt='DD-Mon-YY') {
  if (!iso) return '—'
  const d = new Date(iso); if (isNaN(d)) return '—'
  return (FMTS[fmt]||FMTS['DD-Mon-YY'])(d)
}

const DUR_DIV = { Days:1, Weeks:5, Months:21 }
const DUR_SFX = { Days:'d', Weeks:'w', Months:'m' }

// ══════════════════════════════════════════════════════════════════════════
// CPM ENGINE — Forward + Backward Pass + Float Calculation
// Ported from SKOPIA_Lens.html prototype. Module-level pure functions.
// Operate on the schedule_data activity/relationship format from the API.
// ══════════════════════════════════════════════════════════════════════════

/**
 * buildCalendarMap — converts analysis.schedule_data.calendars into a lookup
 * that advanceWorkDays / retreatWorkDays can use.
 *
 * API calendars shape: { [cal_id]: { name, work_days: [1-7], exceptions: { "YYYY-MM-DD": bool } } }
 * work_days uses 1=Mon … 7=Sun  (Python convention from the backend)
 * JS Date.getDay() uses 0=Sun, 1=Mon … 6=Sat
 * We normalise to JS convention here.
 *
 * Returns: Map<calId, { workDays: Set<jsDay 0-6>, exceptions: Map<"YYYY-MM-DD", bool> }>
 */
function buildCalendarMap(apiCalendars) {
  const map = {}
  if (!apiCalendars) return map

  Object.entries(apiCalendars).forEach(([calId, cal]) => {
    // Convert Python work_days (1=Mon..7=Sun) to JS days (0=Sun..6=Sat)
    const PY_TO_JS = { 1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:0 }
    const workDays = new Set((cal.work_days || []).map(d => PY_TO_JS[d]).filter(d => d !== undefined))

    // Exceptions: { "YYYY-MM-DD": true=working, false=non-working }
    const exceptions = new Map(Object.entries(cal.exceptions || {}))

    map[calId] = { name: cal.name, workDays, exceptions }
  })
  return map
}

/**
 * advanceWorkDays — advance a date forward by N working days on a given calendar.
 * calId is the activity's cal_id string. calMap is from buildCalendarMap().
 * If N=0 snaps forward to next working day if on a non-working day.
 */
function cpmAdvanceWorkDays(fromDate, nDays, calId, calMap) {
  const cal = calMap[calId] || null
  const cur = new Date(fromDate)
  cur.setHours(0, 0, 0, 0)
  let remaining = nDays

  if (!cal || cal.workDays.size === 0) {
    // No calendar — Mon-Fri fallback
    while (remaining > 0) {
      cur.setDate(cur.getDate() + 1)
      const d = cur.getDay()
      if (d !== 0 && d !== 6) remaining--
    }
    if (nDays === 0) {
      let s = 0
      while ((cur.getDay() === 0 || cur.getDay() === 6) && s++ < 7) cur.setDate(cur.getDate() + 1)
    }
    return cur
  }

  while (remaining > 0) {
    cur.setDate(cur.getDate() + 1)
    const iso = cur.toISOString().substring(0, 10)
    const jsDay = cur.getDay()
    const isWorking = cal.exceptions.has(iso) ? cal.exceptions.get(iso) : cal.workDays.has(jsDay)
    if (isWorking) remaining--
  }
  if (nDays === 0) {
    let s = 0
    while (s++ < 14) {
      const iso = cur.toISOString().substring(0, 10)
      const jsDay = cur.getDay()
      const isWorking = cal.exceptions.has(iso) ? cal.exceptions.get(iso) : cal.workDays.has(jsDay)
      if (isWorking) break
      cur.setDate(cur.getDate() + 1)
    }
  }
  return cur
}

/**
 * retreatWorkDays — retreat a date backward by N working days.
 * Used in the backward pass to compute Late Start from Late Finish.
 */
function cpmRetreatWorkDays(fromDate, nDays, calId, calMap) {
  const cal = calMap[calId] || null
  const cur = new Date(fromDate)
  cur.setHours(0, 0, 0, 0)
  let remaining = nDays

  if (!cal || cal.workDays.size === 0) {
    while (remaining > 0) {
      cur.setDate(cur.getDate() - 1)
      const d = cur.getDay()
      if (d !== 0 && d !== 6) remaining--
    }
    return cur
  }

  while (remaining > 0) {
    cur.setDate(cur.getDate() - 1)
    const iso = cur.toISOString().substring(0, 10)
    const jsDay = cur.getDay()
    const isWorking = cal.exceptions.has(iso) ? cal.exceptions.get(iso) : cal.workDays.has(jsDay)
    if (isWorking) remaining--
  }
  return cur
}

/**
 * cpmCountWorkDays — count working days between two dates.
 * Used to compute Total Float and Free Float.
 */
function cpmCountWorkDays(fromDate, toDate, calId, calMap) {
  if (!fromDate || !toDate) return 0
  const a = new Date(fromDate); a.setHours(0,0,0,0)
  const b = new Date(toDate);   b.setHours(0,0,0,0)
  if (b <= a) return 0
  const cal = calMap[calId] || null
  let count = 0
  const cur = new Date(a)
  while (cur < b) {
    cur.setDate(cur.getDate() + 1)
    const iso = cur.toISOString().substring(0, 10)
    const jsDay = cur.getDay()
    const isWorking = cal
      ? (cal.exceptions.has(iso) ? cal.exceptions.get(iso) : cal.workDays.has(jsDay))
      : (jsDay !== 0 && jsDay !== 6)
    if (isWorking) count++
  }
  return count
}

function cpmToISO(d) {
  if (!d) return null
  const y  = d.getFullYear()
  const mo = String(d.getMonth()+1).padStart(2,'0')
  const dy = String(d.getDate()).padStart(2,'0')
  return `${y}-${mo}-${dy}`
}

/**
 * runCPM — full forward + backward pass CPM calculation.
 *
 * @param {Array}  tasks      — activity objects from schedule_data.activities (deep-copied internally)
 * @param {Array}  preds      — relationship objects { from_id, to_id, type, lag_days }
 * @param {Date}   asOf       — new data date / as-of date
 * @param {Date}   projStart  — original project planned start (network anchor)
 * @param {Object} calMap     — from buildCalendarMap()
 *
 * Returns a new tasks array with updated start, finish, total_float, free_float, critical, _recalc.
 * Original tasks array is NOT mutated — internal deep copy only.
 */
function runCPM(tasks, preds, asOf, projStart, calMap) {
  // Deep copy — never mutate originals
  const T   = tasks.map(t => ({ ...t }))
  const byId = {}
  T.forEach(t => { byId[t.id] = t })

  // Network anchor — original project start, never changes with as-of
  const networkStart = new Date(projStart)

  // Build pred/succ indexes
  const predsByTask = {}, succsByTask = {}
  T.forEach(t => { predsByTask[t.id] = []; succsByTask[t.id] = [] })
  preds.forEach(p => {
    if (predsByTask[p.to_id]   !== undefined) predsByTask[p.to_id].push(p)
    if (succsByTask[p.from_id] !== undefined) succsByTask[p.from_id].push(p)
  })

  // ── Forward Pass ────────────────────────────────────────────────────────
  const ES = {}, EF = {}
  const resolved = new Set()
  const maxIter  = T.length + 10
  let iterations = 0

  while (resolved.size < T.length && iterations++ < maxIter) {
    T.forEach(t => {
      if (resolved.has(t.id)) return
      const inPreds    = predsByTask[t.id]
      const allResolved = inPreds.every(p => resolved.has(p.from_id) || !byId[p.from_id])
      if (!allResolved) return

      let earlyStart

      if (t.pct >= 100) {
        // Complete: actuals are fixed
        earlyStart = new Date(t.act_start || t.start || asOf)
        ES[t.id]   = earlyStart
        EF[t.id]   = new Date(t.act_finish || t.finish || earlyStart)
        resolved.add(t.id)
        return
      }

      if (t.pct > 0 && t.act_start) {
        // In progress: actual start fixed, remaining starts from asOf
        earlyStart = new Date(t.act_start)
      } else {
        // Not started: driven by predecessor chain, then clamped to asOf.
        //
        // LESSON LEARNED — unstarted activity behaviour when asOf moves:
        //
        // When asOf moves FORWARD (later):
        //   The P6 "data date floor" prevents any not-started task from being
        //   scheduled before the data date. candidateStart is pushed UP to asOf
        //   if the predecessor chain would place it earlier.
        //
        // When asOf moves BACKWARD (earlier):
        //   The same floor logic must still apply — but tasks should be FREE to
        //   move backward with their predecessor chain. The fix is to initialise
        //   candidateStart from the EARLIER of networkStart and asOf, not always
        //   from networkStart. This means a task with no predecessors will anchor
        //   to asOf (allowing it to move back) rather than being stuck at the
        //   original project start when asOf is moved earlier.
        //
        //   Exception: hard constraints (SNET, MSO, FNET, FNLT) are applied AFTER
        //   the predecessor chain and override the asOf floor — constrained activities
        //   do NOT move freely with the asOf date.
        //
        // Rule: candidateStart = min(networkStart, asOf) as initial anchor.
        // Predecessor chain then pushes it forward. asOf floor applied after.
        // This correctly handles both directions of asOf movement.
        let candidateStart = new Date(Math.min(networkStart.getTime(), asOf.getTime()))

        inPreds.forEach(p => {
          const predEF = EF[p.from_id], predES = ES[p.from_id]
          if (!predEF && !predES) return
          let driverDate
          switch (p.type) {
            case 'FS': driverDate = predEF; break
            case 'SS': driverDate = predES; break
            case 'FF': // handled in EF calc below
            case 'SF': driverDate = predES; break
            default:   driverDate = predEF
          }
          if (!driverDate) return
          const lagged = p.lag_days > 0
            ? cpmAdvanceWorkDays(driverDate, p.lag_days, t.cal_id, calMap)
            : p.lag_days < 0
            ? cpmRetreatWorkDays(driverDate, -p.lag_days, t.cal_id, calMap)
            : new Date(driverDate)
          if (lagged > candidateStart) candidateStart = lagged
        })

        // Data date floor — applies in BOTH directions.
        // When asOf is later: pushes candidateStart forward to asOf.
        // When asOf is earlier: candidateStart already starts from asOf (or earlier),
        //   so the predecessor chain drives the result and this has no effect.
        if (asOf > candidateStart) candidateStart = new Date(asOf)

        // Hard constraints applied after asOf floor — these override free movement.
        // SNET: task cannot start before constraint date
        if (t.cstr_type === 'CS_SNET' || t.cstr_type === 'START_NO_EARLIER_THAN') {
          if (t.cstr_date) {
            const cd = new Date(t.cstr_date)
            if (cd > candidateStart) candidateStart = cd
          }
        }
        // MSO (Must Start On): pin to constraint date exactly
        if (t.cstr_type === 'CS_MSO' || t.cstr_type === 'MUST_START_ON') {
          if (t.cstr_date) candidateStart = new Date(t.cstr_date)
        }

        earlyStart = cpmAdvanceWorkDays(candidateStart, 0, t.cal_id, calMap)
      }

      ES[t.id] = earlyStart

      // Compute EF from remaining duration
      let dur = t.pct > 0 ? (t.rem_dur ?? t.orig_dur ?? 0) : (t.orig_dur ?? 0)
      if (dur == null || dur < 0) dur = 0

      const efBase = (t.pct > 0 && t.act_start)
        ? new Date(Math.max(earlyStart.getTime(), asOf.getTime()))
        : earlyStart

      let earlyFinish = cpmAdvanceWorkDays(efBase, dur, t.cal_id, calMap)

      // FF predecessor drives finish
      inPreds.forEach(p => {
        if (p.type !== 'FF') return
        const predEF = EF[p.from_id]
        if (!predEF) return
        const lagged = p.lag_days > 0
          ? cpmAdvanceWorkDays(predEF, p.lag_days, t.cal_id, calMap)
          : new Date(predEF)
        if (lagged > earlyFinish) earlyFinish = lagged
      })

      // FNET constraint
      if ((t.cstr_type === 'CS_FNET' || t.cstr_type === 'FINISH_NO_EARLIER_THAN') && t.cstr_date) {
        const cd = new Date(t.cstr_date)
        if (cd > earlyFinish) earlyFinish = cd
      }

      EF[t.id] = earlyFinish
      resolved.add(t.id)
    })
  }

  // Fallback: any unresolved tasks (cycles) get network start
  T.forEach(t => {
    if (!ES[t.id]) {
      ES[t.id] = new Date(networkStart)
      EF[t.id] = cpmAdvanceWorkDays(networkStart, t.orig_dur || 0, t.cal_id, calMap)
    }
  })

  // Project finish = max EF across all tasks
  const projFinish = new Date(Math.max(...T.map(t => EF[t.id]?.getTime() || 0)))

  // ── Backward Pass ────────────────────────────────────────────────────────
  const LF = {}, LS = {}
  const bResolved = new Set()
  let bIter = 0

  while (bResolved.size < T.length && bIter++ < maxIter) {
    T.forEach(t => {
      if (bResolved.has(t.id)) return

      if (t.pct >= 100) {
        LF[t.id] = EF[t.id]; LS[t.id] = ES[t.id]
        bResolved.add(t.id); return
      }

      const outSuccs      = succsByTask[t.id]
      const allSuccResolved = outSuccs.every(p => bResolved.has(p.to_id) || !byId[p.to_id])
      if (!allSuccResolved) return

      let lateFinish = new Date(projFinish)

      // FNLT constraint caps LF
      if ((t.cstr_type === 'CS_FNLT' || t.cstr_type === 'FINISH_NO_LATER_THAN') && t.cstr_date) {
        const cd = new Date(t.cstr_date)
        if (cd < lateFinish) lateFinish = cd
      }

      outSuccs.forEach(p => {
        const succLS = LS[p.to_id], succLF = LF[p.to_id]
        if (!succLS && !succLF) return
        let driverDate
        switch (p.type) {
          case 'FS': driverDate = succLS; break
          case 'SS': driverDate = succLS; break
          case 'FF': driverDate = succLF; break
          case 'SF': driverDate = succLF; break
          default:   driverDate = succLS
        }
        if (!driverDate) return
        const lagged = p.lag_days > 0
          ? cpmRetreatWorkDays(driverDate, p.lag_days, t.cal_id, calMap)
          : new Date(driverDate)
        if (lagged < lateFinish) lateFinish = lagged
      })

      LF[t.id] = lateFinish
      let dur = t.pct > 0 ? (t.rem_dur ?? 0) : (t.orig_dur ?? 0)
      if (dur == null || dur < 0) dur = 0
      LS[t.id] = cpmRetreatWorkDays(lateFinish, dur, t.cal_id, calMap)
      bResolved.add(t.id)
    })
  }

  // Fallback
  T.forEach(t => {
    if (!LF[t.id]) {
      LF[t.id] = projFinish
      LS[t.id] = cpmRetreatWorkDays(projFinish, t.orig_dur || 0, t.cal_id, calMap)
    }
  })

  // ── Float + Critical ──────────────────────────────────────────────────────
  T.forEach(t => {
    const tf = t.pct >= 100 ? 0 : cpmCountWorkDays(ES[t.id], LS[t.id], t.cal_id, calMap)
    t.total_float = tf

    const outSuccs = succsByTask[t.id]
    if (outSuccs.length === 0) {
      t.free_float = tf
    } else {
      const minSuccESTime = Math.min(...outSuccs.map(p => ES[p.to_id]?.getTime() || Infinity))
      if (isFinite(minSuccESTime)) {
        t.free_float = cpmCountWorkDays(EF[t.id], new Date(minSuccESTime), t.cal_id, calMap)
      } else {
        t.free_float = tf
      }
    }

    t.critical = t.pct < 100 && tf <= 0

    // Update date strings (ISO date only — no time component)
    t.start  = cpmToISO(ES[t.id])
    t.finish = cpmToISO(EF[t.id])

    // Mark as recalculated for row highlight
    t._recalc = true
  })

  return T
}

function fmtDur(days, unit='Days') {
  if (days==null) return '—'
  const v = Math.round(days/DUR_DIV[unit]*10)/10
  return v + DUR_SFX[unit]
}

// ── Column definitions ────────────────────────────────────────────────────────
const DEFAULT_COLS = [
  { key:'id',              label:'Activity ID',        category:'Identity',  width:130, fixed:true,  visible:true  },
  { key:'name',            label:'Activity Name',      category:'Identity',  width:230, fixed:true,  visible:true  },
  { key:'rem_dur',         label:'Rem Dur',            category:'Durations', width:72,  fixed:false, visible:true  },
  { key:'orig_dur',        label:'Orig Dur',           category:'Durations', width:72,  fixed:false, visible:false },
  { key:'start',           label:'Start',              category:'Dates',     width:96,  fixed:false, visible:true  },
  { key:'finish',          label:'Finish',             category:'Dates',     width:96,  fixed:false, visible:true  },
  { key:'exp_finish',      label:'Finish By',          category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'base_start',      label:'Baseline Start',     category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'base_finish',     label:'Baseline Finish',    category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'var_bl_start',    label:'Var BL Start',       category:'Dates',     width:80,  fixed:false, visible:false },
  { key:'var_bl_finish',   label:'Var BL Finish',      category:'Dates',     width:80,  fixed:false, visible:false },
  { key:'act_start',       label:'Actual Start',       category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'act_finish',      label:'Actual Finish',      category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'total_float',     label:'Total Float',        category:'Float',     width:80,  fixed:false, visible:true  },
  { key:'free_float',      label:'Free Float',         category:'Float',     width:72,  fixed:false, visible:false },
  { key:'status',          label:'Status',             category:'Progress',  width:86,  fixed:false, visible:false },
  { key:'type',            label:'Type',               category:'Progress',  width:72,  fixed:false, visible:false },
  { key:'cstr_type',       label:'Constraint',         category:'General',   width:160, fixed:false, visible:false },
  { key:'calendar',        label:'Calendar',           category:'General',   width:140, fixed:false, visible:false },
  { key:'num_activities',  label:'# Activities',       category:'General',   width:80,  fixed:false, visible:false },
  // Lists — predecessor/successor ID strings, computed client-side from relationships array.
  // Display is a comma-separated list of activity IDs; cell truncates with ellipsis naturally.
  { key:'predecessors',    label:'Predecessors',       category:'Lists',     width:180, fixed:false, visible:false },
  { key:'successors',      label:'Successors',         category:'Lists',     width:180, fixed:false, visible:false },
  // Units — sourced from P6 resource assignments / MSP task work fields.
  // Requires api/main.py to serialise these fields from the parser (see backend note below).
  { key:'budget_units',    label:'Budget Units',       category:'Units',     width:96,  fixed:false, visible:false },
  { key:'actual_units',    label:'Actual Units',       category:'Units',     width:96,  fixed:false, visible:false },
  { key:'remaining_units', label:'Remaining Units',    category:'Units',     width:96,  fixed:false, visible:false },
  { key:'at_comp_units',   label:'At Completion Units',category:'Units',     width:110, fixed:false, visible:false },
  { key:'var_budget_units',label:'Var to BL Budget Units',category:'Units',  width:120, fixed:false, visible:false },
  // Resources — sourced from P6 resource assignments / MSP resource assignments.
  // Requires api/main.py to serialise these fields (see backend note below).
  { key:'resource_id',     label:'Resource ID',        category:'Resources', width:110, fixed:false, visible:false },
  { key:'resource_name',   label:'Resource Name',      category:'Resources', width:150, fixed:false, visible:false },
]

const REL_DEFAULT_COLS = [
  { key:'driving',  label:'Drv',          width:34,  visible:true,  align:'center' },
  { key:'critical', label:'Crit',         width:34,  visible:true,  align:'center' },
  { key:'id',       label:'Activity ID',  width:120, visible:true,  align:'left'   },
  { key:'name',     label:'Activity Name',width:190, visible:true,  align:'left'   },
  { key:'start',    label:'Start',        width:86,  visible:true,  align:'center' },
  { key:'finish',   label:'Finish',       width:86,  visible:true,  align:'center' },
  { key:'relType',  label:'Rel Type',     width:68,  visible:true,  align:'center' },
  { key:'lag',      label:'Lag',          width:52,  visible:true,  align:'center' },
  { key:'tf',       label:'TF',           width:52,  visible:true,  align:'center' },
  { key:'ff',       label:'FF',           width:52,  visible:false, align:'center' },
]

const DEFAULT_TABLE_W = DEFAULT_COLS
  .filter(c => c.visible)
  .reduce((sum, c) => sum + c.width, 0)

// ── Command manager state — click to open, hover only keeps open ─────────────
// One panel is allowed open at a time. Moving the mouse out of the trigger+panel
// area closes it after a short grace period, so users can interact without
// needing extra clicks but panels no longer stack or linger.
let _hpUid = 0
let _hpCurrent = null       // { id, setOpen }
let _hpTimer = null
const HP_CLOSE_MS = 140

function _hpClearClose() {
  clearTimeout(_hpTimer)
  _hpTimer = null
}

function _hpCloseCurrent() {
  _hpClearClose()
  if (_hpCurrent) {
    _hpCurrent.setOpen(false)
    _hpCurrent = null
  }
}

function _hpOpenPanel(id, setOpen) {
  _hpClearClose()
  if (_hpCurrent && _hpCurrent.id !== id) _hpCurrent.setOpen(false)
  _hpCurrent = { id, setOpen }
  setOpen(true)
}

function _hpScheduleClose(id, setOpen) {
  _hpClearClose()
  _hpTimer = setTimeout(() => {
    if (_hpCurrent?.id === id) {
      _hpCurrent = null
      setOpen(false)
    }
  }, HP_CLOSE_MS)
}

// ── HoverPanel component ──────────────────────────────────────────────────────
function HoverPanel({ trigger, panel, disabled=false }) {
  const [open, setOpen] = useState(false)
  const idRef = useRef(++_hpUid)   // stable per-instance id
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) _hpCloseCurrent()
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') _hpCloseCurrent()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (disabled) return <div style={{opacity:0.35,pointerEvents:'none'}}>{trigger(false)}</div>

  return (
    <div ref={wrapRef} style={{position:'relative'}}
      onMouseEnter={_hpClearClose}
      onMouseLeave={()=>_hpScheduleClose(idRef.current, setOpen)}>
      <div onClick={(e)=>{
        e.stopPropagation()
        open ? _hpCloseCurrent() : _hpOpenPanel(idRef.current, setOpen)
      }}>
        {trigger(open)}
      </div>
      {open && <div>{panel}</div>}
    </div>
  )
}

// ── Pill button ───────────────────────────────────────────────────────────────
function PillBtn({ active, children, style }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:5,
      padding:'3px 10px', height:26,
      border:`1px solid ${active?SK.peri:SK.border}`,
      background: active?'rgba(74,111,232,0.1)':SK.card,
      color: active?SK.peri:SK.text,
      borderRadius:5, cursor:'pointer',
      fontFamily:'var(--font-head)', fontWeight:700, fontSize:11,
      whiteSpace:'nowrap', userSelect:'none', ...style,
    }}>
      {children}
    </div>
  )
}

function dropStyle(w=280) {
  return {
    position:'absolute', top:30, left:0, zIndex:400,
    background:SK.card, border:`1px solid ${SK.border}`,
    borderRadius:8, boxShadow:'0 4px 20px rgba(42,77,204,0.14)',
    width:w, overflow:'hidden',
  }
}

// ── Grouping panel — FIX #2: added "Hide empty WBS bands" toggle ──────────────
function GroupingPanel({ wbsNodes, collapsed, setCollapsed, hideEmpty, setHideEmpty, showWbsBands, setShowWbsBands, showWbsId, setShowWbsId }) {
  // Compute display depth from parent chain — not stored level field.
  // This is correct even if backend level numbers don't match display depth.
  const nodeDepth = (id, memo={}) => {
    if(id in memo) return memo[id]
    const node = wbsNodes.find(w=>w.id===id)
    if(!node||!node.parent) return (memo[id]=1)
    return (memo[id]=1+nodeDepth(node.parent, memo))
  }
  const memo = {}
  const maxLv = Math.max(...wbsNodes.map(w=>nodeDepth(w.id,memo)), 1)
  // "Collapse to level N" means: collapse all nodes whose depth > N
  const toLv  = (lv) => setCollapsed(new Set(wbsNodes.filter(w=>nodeDepth(w.id,memo)>=lv).map(w=>w.id)))

  return (
    <div style={dropStyle(280)}>
      <div style={{padding:'10px 14px'}}>
        <div style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'0.07em',color:SK.muted,marginBottom:10}}>Grouping</div>

        <div style={{fontSize:10,color:SK.muted,fontFamily:'var(--font-mono)',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.06em'}}>Collapse to level</div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:12}}>
          {Array.from({length:maxLv},(_,i)=>i+1).map(lv=>(
            <button key={lv} onClick={()=>toLv(lv)} style={{padding:'4px 10px',fontSize:11,fontFamily:'var(--font-head)',fontWeight:700,background:SK.bg,border:`1px solid ${SK.border}`,color:SK.text,borderRadius:4,cursor:'pointer'}}>L{lv}</button>
          ))}
        </div>

        <div style={{height:1,background:SK.border,margin:'8px 0'}}/>

        <div style={{display:'flex',gap:6,marginBottom:12}}>
          <button onClick={()=>setCollapsed(new Set())} style={{flex:1,padding:'5px 0',fontSize:11,fontFamily:'var(--font-head)',fontWeight:700,background:SK.bg,border:`1px solid ${SK.border}`,color:SK.text,borderRadius:4,cursor:'pointer'}}>Expand All</button>
          <button onClick={()=>setCollapsed(new Set(wbsNodes.map(w=>w.id)))} style={{flex:1,padding:'5px 0',fontSize:11,fontFamily:'var(--font-head)',fontWeight:700,background:SK.bg,border:`1px solid ${SK.border}`,color:SK.text,borderRadius:4,cursor:'pointer'}}>Collapse All</button>
        </div>

        <div style={{height:1,background:SK.border,margin:'0 0 10px'}}/>

        {/* Hide WBS bands: list view */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div>
            <div style={{fontFamily:'var(--font-body)',fontSize:12,fontWeight:600,color:SK.text}}>Hide WBS Bands</div>
            <div style={{fontFamily:'var(--font-body)',fontSize:10,color:SK.muted,marginTop:2}}>Shows activities in a flat list view</div>
          </div>
          <div
            onClick={()=>setShowWbsBands(v=>!v)}
            style={{width:40,height:22,borderRadius:11,background:!showWbsBands?SK.peri:SK.border,cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}}
          >
            <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:3,left:!showWbsBands?21:3,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
          </div>
        </div>

        <div style={{height:1,background:SK.border,margin:'10px 0'}}/>

        {/* FIX #2: Hide empty WBS bands */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div>
            <div style={{fontFamily:'var(--font-body)',fontSize:12,fontWeight:600,color:SK.text}}>Hide empty WBS bands</div>
            <div style={{fontFamily:'var(--font-body)',fontSize:10,color:SK.muted,marginTop:2}}>Removes bands with no visible activities</div>
          </div>
          <div
            onClick={()=>setHideEmpty(v=>!v)}
            style={{width:40,height:22,borderRadius:11,background:hideEmpty?SK.peri:SK.border,cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}}
          >
            <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:3,left:hideEmpty?21:3,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
          </div>
        </div>

        <div style={{height:1,background:SK.border,margin:'10px 0'}}/>

        {/* WBS ID display toggle */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
          <div>
            <div style={{fontFamily:'var(--font-body)',fontSize:12,fontWeight:600,color:SK.text}}>Show WBS ID</div>
            <div style={{fontFamily:'var(--font-body)',fontSize:10,color:SK.muted,marginTop:2}}>Prefix band label with WBS code</div>
          </div>
          <div
            onClick={()=>setShowWbsId(v=>!v)}
            style={{width:40,height:22,borderRadius:11,background:showWbsId?SK.peri:SK.border,cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}}
          >
            <div style={{width:16,height:16,borderRadius:8,background:'#fff',position:'absolute',top:3,left:showWbsId?21:3,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── WBS Filter panel ──────────────────────────────────────────────────────────
function WbsFilterPanel({ wbsNodes, activities, hidden, setHidden }) {
  const [exp, setExp] = useState(()=>new Set(wbsNodes.filter(w=>w.level===1).map(w=>w.id)))

  function countDesc(id) {
    const d = activities.filter(a=>a.wbs===id).length
    return d + wbsNodes.filter(w=>w.parent===id).reduce((s,c)=>s+countDesc(c.id),0)
  }
  function allDesc(id) {
    const r=[]
    function walk(wid){wbsNodes.filter(w=>w.parent===wid).forEach(c=>{r.push(c.id);walk(c.id)})}
    walk(id); return r
  }
  function toggle(id) {
    setHidden(prev=>{
      const n=new Set(prev), desc=allDesc(id)
      if(n.has(id)){n.delete(id);desc.forEach(d=>n.delete(d))}
      else{n.add(id);desc.forEach(d=>n.add(d))}
      return n
    })
  }
  function TreeNode({ wbs, depth=0 }) {
    const children = wbsNodes.filter(w=>w.parent===wbs.id)
    const isExp = exp.has(wbs.id), excluded = hidden.has(wbs.id)
    const col = wbsCol(wbs.level), cnt = countDesc(wbs.id)
    return (
      <div>
        <div style={{display:'flex',alignItems:'center',gap:6,padding:`4px 14px 4px ${14+depth*14}px`,borderBottom:`1px solid ${SK.border}`,background:excluded?`${SK.muted}06`:'transparent'}}>
          <button onClick={()=>{if(children.length)setExp(prev=>{const n=new Set(prev);n.has(wbs.id)?n.delete(wbs.id):n.add(wbs.id);return n})}} style={{width:14,background:'none',border:'none',cursor:children.length?'pointer':'default',fontSize:8,color:SK.muted,padding:0,flexShrink:0}}>
            {children.length?(isExp?'▼':'▶'):'·'}
          </button>
          <div onClick={()=>toggle(wbs.id)} style={{width:14,height:14,borderRadius:3,flexShrink:0,cursor:'pointer',border:`2px solid ${!excluded?col:SK.border}`,background:!excluded?col:'transparent',display:'flex',alignItems:'center',justifyContent:'center'}}>
            {!excluded&&<span style={{color:'#fff',fontSize:7,lineHeight:1}}>✓</span>}
          </div>
          <div style={{width:7,height:7,borderRadius:2,background:col,opacity:excluded?0.3:1,flexShrink:0}}/>
          <span style={{fontFamily:'var(--font-body)',fontSize:12,color:excluded?SK.muted:SK.text,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{wbs.name}</span>
          <span style={{fontFamily:'var(--font-mono)',fontSize:9,color:SK.muted,background:SK.bg,border:`1px solid ${SK.border}`,borderRadius:3,padding:'1px 5px',flexShrink:0}}>{cnt}</span>
        </div>
        {isExp&&children.sort((a,b)=>a.id.localeCompare(b.id)).map(c=><TreeNode key={c.id} wbs={c} depth={depth+1}/>)}
      </div>
    )
  }
  const roots = wbsNodes.filter(w=>!w.parent).sort((a,b)=>a.id.localeCompare(b.id))
  const hiddenActs = activities.filter(a=>hidden.has(a.wbs)).length
  return (
    <div style={{...dropStyle(340),maxHeight:460,display:'flex',flexDirection:'column'}}>
      <div style={{padding:'10px 14px',borderBottom:`1px solid ${SK.border}`,flexShrink:0}}>
        <div style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'0.07em',color:SK.muted,marginBottom:8}}>WBS Filter</div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <button onClick={()=>setHidden(new Set())} style={{padding:'3px 10px',fontSize:11,fontFamily:'var(--font-head)',fontWeight:700,background:SK.bg,border:`1px solid ${SK.border}`,color:SK.text,borderRadius:4,cursor:'pointer'}}>Select All</button>
          <button onClick={()=>setHidden(new Set(wbsNodes.map(w=>w.id)))} style={{padding:'3px 10px',fontSize:11,fontFamily:'var(--font-head)',fontWeight:700,background:SK.bg,border:`1px solid ${SK.border}`,color:SK.fail,borderRadius:4,cursor:'pointer'}}>Clear All</button>
          {hiddenActs>0&&<span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:9,color:SK.warn,background:`${SK.warn}12`,border:`1px solid ${SK.warn}44`,borderRadius:4,padding:'2px 7px'}}>{hiddenActs} hidden</span>}
        </div>
      </div>
      <div style={{flex:1,overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
        {roots.map(r=><TreeNode key={r.id} wbs={r} depth={0}/>)}
      </div>
    </div>
  )
}

// ── Column Manager ────────────────────────────────────────────────────────────
function ColMgrPanel({ cols, setCols }) {
  const [tab, setTab] = useState('grouped')
  const [sel, setSel] = useState(null)

  const grouped = useMemo(()=>{
    const cats={}
    cols.forEach(c=>{ if(!cats[c.category])cats[c.category]=[]; cats[c.category].push(c) })
    return cats
  },[cols])

  function toggleVis(key){ setCols(prev=>prev.map(c=>c.key===key&&!c.fixed?{...c,visible:!c.visible}:c)) }
  function move(key,dir){ setCols(prev=>{ const i=prev.findIndex(c=>c.key===key),n=[...prev]; if(i<0||(dir===-1&&i===0)||(dir===1&&i===n.length-1))return prev; [n[i],n[i+dir]]=[n[i+dir],n[i]]; return n }) }

  return (
    <div style={{...dropStyle(300),maxHeight:500,display:'flex',flexDirection:'column'}}>
      <div style={{display:'flex',padding:'8px 10px 0',gap:4,borderBottom:`1px solid ${SK.border}`,flexShrink:0,alignItems:'center'}}>
        {['grouped','list'].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:'4px 12px',fontSize:11,fontFamily:'var(--font-head)',fontWeight:700,background:tab===t?SK.peri:SK.bg,color:tab===t?'#fff':SK.muted,border:'none',borderRadius:'4px 4px 0 0',cursor:'pointer',textTransform:'capitalize'}}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
        ))}
        {tab==='list'&&(
          <div style={{marginLeft:'auto',display:'flex',gap:4}}>
            {['↑','↓'].map((a,di)=>(
              <button key={a} onClick={()=>sel&&move(sel,di===0?-1:1)} style={{width:22,height:22,fontSize:12,background:sel?SK.peri:SK.bg,color:sel?'#fff':SK.muted,border:`1px solid ${SK.border}`,borderRadius:4,cursor:sel?'pointer':'default'}}>{a}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'6px 0',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
        {tab==='grouped'
          ? Object.entries(grouped).map(([cat,items])=>(
              <div key={cat}>
                <div style={{padding:'4px 14px',fontFamily:'var(--font-head)',fontWeight:700,fontSize:9,textTransform:'uppercase',letterSpacing:'0.07em',color:SK.muted}}>{cat}</div>
                {items.map(c=>(
                  <label key={c.key} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 14px',cursor:c.fixed?'default':'pointer'}}>
                    <input type="checkbox" checked={c.visible} onChange={()=>toggleVis(c.key)} disabled={c.fixed} style={{accentColor:SK.peri}}/>
                    <span style={{fontFamily:'var(--font-body)',fontSize:12,color:c.fixed?SK.muted:SK.text}}>{c.label}</span>
                    {c.fixed&&<span style={{fontFamily:'var(--font-mono)',fontSize:8,color:SK.muted,marginLeft:'auto'}}>fixed</span>}
                  </label>
                ))}
              </div>
            ))
          : cols.map((c,i)=>(
              <div key={c.key} onClick={()=>setSel(c.key)} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 14px',cursor:'pointer',background:sel===c.key?`${SK.peri}10`:'transparent'}}>
                <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:SK.muted,width:16,textAlign:'right'}}>{i+1}</span>
                <input type="checkbox" checked={c.visible} onChange={()=>toggleVis(c.key)} disabled={c.fixed} style={{accentColor:SK.peri}} onClick={e=>e.stopPropagation()}/>
                <span style={{fontFamily:'var(--font-body)',fontSize:12,color:SK.text,flex:1}}>{c.label}</span>
                <span style={{fontFamily:'var(--font-mono)',fontSize:9,color:SK.muted}}>{c.category}</span>
              </div>
            ))
        }
      </div>
      <div style={{borderTop:`1px solid ${SK.border}`,padding:'8px 14px',flexShrink:0}}>
        <button onClick={()=>setCols(DEFAULT_COLS.map(c=>({...c})))} style={{width:'100%',padding:'6px 0',fontSize:12,fontFamily:'var(--font-head)',fontWeight:700,background:SK.grad,color:'#fff',border:'none',borderRadius:5,cursor:'pointer'}}>Reset Defaults</button>
      </div>
    </div>
  )
}

// ── FormatsPanel — consolidated Duration Units + Date Format ──────────────────
// Replaces the two separate DurUnitPanel and DateFmtPanel toolbar buttons.
function FormatsPanel({ unit, setUnit, fmt, setFmt }) {
  return (
    <div style={dropStyle(240)}>
      <div style={{padding:'12px 14px'}}>

        {/* Duration Units section */}
        <div style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'0.07em',color:SK.muted,marginBottom:8}}>Duration Units</div>
        {['Days','Weeks','Months'].map(u=>(
          <label key={u} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',cursor:'pointer'}}>
            <input type="radio" checked={unit===u} onChange={()=>setUnit(u)} style={{accentColor:SK.peri}}/>
            <span style={{fontFamily:'var(--font-body)',fontSize:12,color:SK.text,flex:1}}>{u}</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:SK.muted}}>{u==='Days'?'5d':u==='Weeks'?'1.0w':'0.5m'}</span>
          </label>
        ))}

        {/* Divider */}
        <div style={{height:1,background:SK.border,margin:'10px 0'}}/>

        {/* Date Format section */}
        <div style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'0.07em',color:SK.muted,marginBottom:8}}>Date Format</div>
        {['DD/MM/YYYY','DD/MM/YY','DD-Mon-YY'].map(o=>(
          <label key={o} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',cursor:'pointer'}}>
            <input type="radio" checked={fmt===o} onChange={()=>setFmt(o)} style={{accentColor:SK.peri}}/>
            <span style={{fontFamily:'var(--font-body)',fontSize:12,color:SK.text,flex:1}}>{o}</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:SK.muted}}>{o==='DD/MM/YYYY'?'01/12/2026':o==='DD/MM/YY'?'01/12/26':'01-Dec-26'}</span>
          </label>
        ))}

      </div>
    </div>
  )
}

// ── StatusFilterPanel — filter by activity status ─────────────────────────────
// Statuses from API: 'Complete', 'In Progress', 'Not Started'.
// statusFilter is a Set of statuses to SHOW (empty Set = show all).
function StatusFilterPanel({ statusFilter, setStatusFilter }) {
  const ALL_STATUSES = [
    { value: 'Not Started', label: 'Not Started', color: '#CBD5E1' },
    { value: 'In Progress', label: 'In Progress', color: SK.warn     },
    { value: 'Complete',    label: 'Complete',    color: SK.pass     },
  ]

  function toggle(val) {
    setStatusFilter(prev => {
      const next = new Set(prev)
      if (next.has(val)) next.delete(val)
      else next.add(val)
      return next
    })
  }

  // All selected = no filter active (same as empty set)
  const allOn = statusFilter.size === 0 || statusFilter.size === ALL_STATUSES.length

  return (
    <div style={dropStyle(220)}>
      <div style={{padding:'12px 14px'}}>
        <div style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'0.07em',color:SK.muted,marginBottom:8}}>Activity Status</div>

        {/* Show All shortcut */}
        <div
          onClick={()=>setStatusFilter(new Set())}
          style={{
            display:'flex',alignItems:'center',gap:8,padding:'5px 0',
            cursor:'pointer',marginBottom:4,
          }}
        >
          <div style={{
            width:14,height:14,borderRadius:3,flexShrink:0,border:`2px solid ${allOn?SK.peri:SK.border}`,
            background:allOn?SK.peri:'transparent',
            display:'flex',alignItems:'center',justifyContent:'center',
          }}>
            {allOn&&<span style={{color:'#fff',fontSize:8,lineHeight:1}}>✓</span>}
          </div>
          <span style={{fontFamily:'var(--font-body)',fontSize:12,color:SK.text,flex:1}}>Show All</span>
        </div>

        <div style={{height:1,background:SK.border,margin:'4px 0 8px'}}/>

        {/* Individual status toggles */}
        {ALL_STATUSES.map(({value,label,color})=>{
          const isOn = statusFilter.size===0 || statusFilter.has(value)
          return (
            <div
              key={value}
              onClick={()=>toggle(value)}
              style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',cursor:'pointer'}}
            >
              <div style={{
                width:14,height:14,borderRadius:3,flexShrink:0,
                border:`2px solid ${isOn?color:SK.border}`,
                background:isOn?color:'transparent',
                display:'flex',alignItems:'center',justifyContent:'center',
              }}>
                {isOn&&<span style={{color:'#fff',fontSize:8,lineHeight:1}}>✓</span>}
              </div>
              <span style={{width:8,height:8,borderRadius:'50%',background:color,flexShrink:0,display:'inline-block'}}/>
              <span style={{fontFamily:'var(--font-body)',fontSize:12,color:SK.text,flex:1}}>{label}</span>
            </div>
          )
        })}

        {/* Active filter summary */}
        {statusFilter.size > 0 && statusFilter.size < ALL_STATUSES.length && (
          <div style={{
            marginTop:10,padding:'5px 8px',borderRadius:5,
            background:`${SK.peri}0C`,border:`1px solid ${SK.peri}30`,
            fontFamily:SK.fMono,fontSize:9,color:SK.peri,
          }}>
            Showing: {[...statusFilter].join(', ')}
          </div>
        )}
      </div>
    </div>
  )
}

// ── FIX #6: Relationship pane column manager
// Uses ReactDOM.createPortal to escape overflow:hidden clipping.
// Opens UPWARD (bottom anchor) on click, closes on outside click/Escape or
// shortly after the mouse leaves the button/dropdown area.
// ─────────────────────────────────────────────────────────────────────────────
let _relColUid = 0
let _relColCurrent = null
let _relColTimer = null
const REL_COL_CLOSE_MS = 140

function _relColClearClose() {
  clearTimeout(_relColTimer)
  _relColTimer = null
}

function _relColCloseCurrent() {
  _relColClearClose()
  if (_relColCurrent) {
    _relColCurrent.setOpen(false)
    _relColCurrent = null
  }
}

function _relColOpenPanel(id, setOpen) {
  _relColClearClose()
  if (_relColCurrent && _relColCurrent.id !== id) _relColCurrent.setOpen(false)
  _relColCurrent = { id, setOpen }
  setOpen(true)
}

function _relColScheduleClose(id, setOpen) {
  _relColClearClose()
  _relColTimer = setTimeout(() => {
    if (_relColCurrent?.id === id) {
      _relColCurrent = null
      setOpen(false)
    }
  }, REL_COL_CLOSE_MS)
}

function RelColMgrBtn({ cols, setCols }) {
  const [open, setOpen]   = useState(false)
  const [pos,  setPos]    = useState({bottom:0, right:0})
  const [selKey, setSelKey] = useState(null)
  const btnRef  = useRef(null)
  const dropRef = useRef(null)
  const idRef   = useRef(++_relColUid)

  function calcPos() {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    // bottom anchor = distance from button TOP to viewport bottom + gap
    setPos({ bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right })
  }

  const openPanel = () => {
    calcPos()
    _relColOpenPanel(idRef.current, setOpen)
  }
  const closeLater = () => _relColScheduleClose(idRef.current, setOpen)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      const path = e.composedPath?.() ?? []
      const insideButton = btnRef.current?.contains(e.target) || path.includes(btnRef.current)
      const insideDrop = dropRef.current?.contains(e.target) || path.includes(dropRef.current)
      const insideMarked = path.some(el => el?.dataset?.relColManager === 'true')
      if (!insideButton && !insideDrop && !insideMarked) _relColCloseCurrent()
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') _relColCloseCurrent()
    }
    const onResize = () => calcPos()
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [open])

  function toggleVis(key) { setCols(prev=>prev.map(c=>c.key===key?{...c,visible:!c.visible}:c)) }
  function move(key,dir) {
    setCols(prev=>{
      const i=prev.findIndex(c=>c.key===key), n=[...prev]
      if(i<0||(dir===-1&&i===0)||(dir===1&&i===n.length-1)) return prev
      ;[n[i],n[i+dir]]=[n[i+dir],n[i]]; return n
    })
  }

  const selIdx = selKey ? cols.findIndex(c=>c.key===selKey) : -1
  const canUp   = selIdx > 0
  const canDown = selIdx >= 0 && selIdx < cols.length - 1

  const dropdown = open ? ReactDOM.createPortal(
    <div
      ref={dropRef}
      data-rel-col-manager="true"
      onPointerDown={(e)=>{_relColClearClose();e.stopPropagation()}}
      onMouseEnter={_relColClearClose}
      onMouseLeave={closeLater}
      style={{
        position:'fixed', bottom:pos.bottom, right:pos.right,
        zIndex:9999, background:SK.card, border:`1px solid ${SK.border}`,
        borderRadius:8, boxShadow:'0 -4px 20px rgba(42,77,204,0.18)',
        width:220, maxHeight:360, display:'flex', flexDirection:'column',
      }}
    >
      {/* Header with reorder buttons */}
      <div style={{padding:'8px 10px 6px',borderBottom:`1px solid ${SK.border}`,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
          <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'0.07em',color:SK.text}}>Columns</span>
          <div style={{display:'flex',gap:3}}>
            {[[-1,'↑'],[1,'↓']].map(([dir,arrow])=>(
              <button key={dir}
                onPointerDown={e=>{e.preventDefault();e.stopPropagation();_relColClearClose();if(selKey&&(dir===-1?canUp:canDown))move(selKey,dir)}}
                style={{width:24,height:24,borderRadius:4,fontSize:12,fontFamily:'var(--font-head)',fontWeight:700,cursor:(dir===-1?canUp:canDown)?'pointer':'not-allowed',border:`1px solid ${(dir===-1?canUp:canDown)?SK.peri:SK.border}`,background:(dir===-1?canUp:canDown)?`${SK.peri}18`:SK.bg,color:(dir===-1?canUp:canDown)?SK.peri:SK.muted,display:'flex',alignItems:'center',justifyContent:'center'}}
              >{arrow}</button>
            ))}
          </div>
        </div>
        <div style={{fontSize:9,color:selKey?SK.peri:SK.muted,fontFamily:'var(--font-body)'}}>
          {selKey?`${cols.find(c=>c.key===selKey)?.label} — use ↑↓ to reorder`:'Click a row to select, then use ↑↓'}
        </div>
      </div>

      {/* Column list */}
      <div style={{flex:1,overflowY:'auto',padding:'4px 0',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
        {cols.map((col,idx)=>{
          const isSel = selKey===col.key
          return (
            <div key={col.key}
              onPointerDown={(e)=>{e.preventDefault();e.stopPropagation();_relColClearClose();setSelKey(k=>k===col.key?null:col.key)}}
              style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',cursor:'pointer',borderLeft:`3px solid ${isSel?SK.peri:'transparent'}`,background:isSel?`${SK.peri}08`:SK.card,borderBottom:`1px solid ${SK.border}`}}
            >
              <span style={{fontFamily:'var(--font-mono)',fontSize:9,color:SK.muted,width:14,textAlign:'right'}}>{idx+1}</span>
              <input type="checkbox" checked={col.visible}
                onPointerDown={(e)=>{e.stopPropagation();_relColClearClose()}}
                onClick={(e)=>e.stopPropagation()}
                onChange={()=>toggleVis(col.key)}
                style={{accentColor:SK.peri}}/>
              <span style={{fontFamily:'var(--font-body)',fontSize:12,color:SK.text}}>{col.label}</span>
            </div>
          )
        })}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div style={{position:'relative'}} onMouseEnter={_relColClearClose} onMouseLeave={closeLater}>
      <button ref={btnRef}
        onClick={(e)=>{
          e.stopPropagation()
          open ? _relColCloseCurrent() : openPanel()
        }}
        style={{
        display:'flex',alignItems:'center',gap:4,padding:'2px 8px',
        fontSize:10,fontFamily:'var(--font-head)',fontWeight:700,
        background:open?SK.peri:SK.card,border:`1px solid ${open?SK.peri:SK.border}`,
        color:open?'#fff':SK.muted,borderRadius:4,cursor:'pointer',height:22,
      }}>
        ⊞ Columns
      </button>
      {dropdown}
    </div>
  )
}

// ── Sort hook for table/rel panel ─────────────────────────────────────────────
function RelColMgrBtnV2({ cols, setCols }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ bottom:0, right:0 })
  const [selKey, setSelKey] = useState(null)
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const closeTimer = useRef(null)

  function GridIcon({ active=false }) {
    const col = active ? '#fff' : SK.peri
    return (
      <span style={{display:'inline-grid',gridTemplateColumns:'repeat(2,4px)',gap:1,alignItems:'center',justifyContent:'center'}}>
        {[0,1,2,3].map(i=>(
          <span key={i} style={{width:4,height:4,border:`1px solid ${col}`,background:'transparent',boxSizing:'border-box'}} />
        ))}
      </span>
    )
  }

  function ArrowIcon({ dir='up', active=false }) {
    const col = active ? '#fff' : SK.peri
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{display:'block'}}>
        {dir==='up'
          ? <path d="M5 2 L8 5 H6 V8 H4 V5 H2 Z" fill={col}/>
          : <path d="M4 2 H6 V5 H8 L5 8 L2 5 H4 Z" fill={col}/>}
      </svg>
    )
  }

  function clearClose() {
    clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  function calcPos() {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right })
  }

  function openPanel() {
    clearClose()
    calcPos()
    setOpen(true)
  }

  function closePanel() {
    clearClose()
    setOpen(false)
  }

  function closeLater() {
    clearClose()
    closeTimer.current = setTimeout(() => setOpen(false), REL_COL_CLOSE_MS)
  }

  useEffect(() => () => clearClose(), [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closePanel()
    }
    const syncPos = () => calcPos()
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', syncPos)
    window.addEventListener('scroll', syncPos, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', syncPos)
      window.removeEventListener('scroll', syncPos, true)
    }
  }, [open])

  function toggleVis(key) {
    setCols(prev => prev.map(c => c.key === key ? { ...c, visible: !c.visible } : c))
  }

  function move(key, dir) {
    setCols(prev => {
      const i = prev.findIndex(c => c.key === key)
      const next = [...prev]
      if (i < 0 || (dir === -1 && i === 0) || (dir === 1 && i === next.length - 1)) return prev
      ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
      return next
    })
  }

  const selIdx = selKey ? cols.findIndex(c => c.key === selKey) : -1
  const canUp = selIdx > 0
  const canDown = selIdx >= 0 && selIdx < cols.length - 1

  const dropdown = open ? ReactDOM.createPortal(
    <div
      ref={panelRef}
      onPointerDown={(e)=>{ clearClose(); e.stopPropagation() }}
      onMouseEnter={clearClose}
      onMouseLeave={closeLater}
      style={{
        position:'fixed', bottom:pos.bottom, right:pos.right,
        zIndex:2147483646, background:SK.card, border:`1px solid ${SK.border}`,
        borderRadius:8, boxShadow:'0 -4px 20px rgba(42,77,204,0.18)',
        width:220, maxHeight:360, display:'flex', flexDirection:'column', pointerEvents:'auto',
      }}
    >
      <div style={{padding:'8px 10px 6px',borderBottom:`1px solid ${SK.border}`,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
          <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:10,textTransform:'uppercase',letterSpacing:'0.07em',color:SK.text}}>Columns</span>
          <div style={{marginLeft:'auto',display:'flex',gap:3}}>
            {['up','down'].map((dir, di)=>(
              <button key={dir}
                onClick={(e)=>{
                  e.preventDefault()
                  e.stopPropagation()
                  clearClose()
                  if (selKey && (di === 0 ? canUp : canDown)) move(selKey, di === 0 ? -1 : 1)
                }}
                style={{
                  width:24,height:24,fontSize:12,fontFamily:'var(--font-head)',fontWeight:700,
                  background:(di === 0 ? canUp : canDown) ? SK.peri : SK.bg,
                  color:(di === 0 ? canUp : canDown) ? '#fff' : SK.muted,
                  border:`1px solid ${SK.border}`,borderRadius:4,
                  cursor:(di === 0 ? canUp : canDown) ? 'pointer' : 'default',
                  display:'flex',alignItems:'center',justifyContent:'center',padding:0,
                }}
              ><ArrowIcon dir={dir} active={di === 0 ? canUp : canDown} /></button>
            ))}
          </div>
        </div>
        <div style={{fontSize:9,color:selKey?SK.peri:SK.muted,fontFamily:'var(--font-body)'}}>
          {selKey ? `${cols.find(c=>c.key===selKey)?.label} - use arrows to reorder` : 'Click a row to select, then use arrows'}
        </div>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'4px 0',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
        {cols.map((col, idx)=>(
          <div key={col.key}
            onClick={(e)=>{
              e.stopPropagation()
              clearClose()
              setSelKey(k => k === col.key ? null : col.key)
            }}
            style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',cursor:'pointer',background:selKey===col.key?`${SK.peri}10`:'transparent'}}
          >
            <span style={{fontFamily:'var(--font-mono)',fontSize:10,color:SK.muted,width:16,textAlign:'right'}}>{idx+1}</span>
            <input
              type="checkbox"
              checked={col.visible}
              onChange={()=>{
                clearClose()
                toggleVis(col.key)
              }}
              onClick={e=>e.stopPropagation()}
              style={{accentColor:SK.peri}}
            />
            <span style={{fontFamily:'var(--font-body)',fontSize:12,color:SK.text,flex:1}}>{col.label}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div style={{position:'relative'}} onMouseEnter={clearClose} onMouseLeave={closeLater}>
      <button
        ref={btnRef}
        onClick={(e)=>{
          e.stopPropagation()
          open ? closePanel() : openPanel()
        }}
        style={{
          display:'flex',alignItems:'center',gap:4,padding:'2px 8px',
          fontSize:10,fontFamily:'var(--font-head)',fontWeight:700,
          background:open?SK.peri:SK.card,border:`1px solid ${open?SK.peri:SK.border}`,
          color:open?'#fff':SK.muted,borderRadius:4,cursor:'pointer',height:22,
        }}
      >
        <GridIcon active={open} />
        Columns
      </button>
      {dropdown}
    </div>
  )
}

function useSortState() {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(1)
  const handleSort = (key) => {
    if (sortKey===key) setSortDir(d=>-d)
    else { setSortKey(key); setSortDir(1) }
  }
  const sortIndicator = (key) => sortKey===key?(sortDir===1?' ↑':' ↓'):''
  return { sortKey, sortDir, handleSort, sortIndicator }
}

// ── Column resize hook ────────────────────────────────────────────────────────
function useColResize(cols, setCols) {
  const dragKey = useRef(null); const x0=useRef(0); const w0=useRef(0)
  useEffect(()=>{
    const onMove=(e)=>{
      if(dragKey.current===null) return
      const nw=Math.max(36,w0.current+e.clientX-x0.current)
      const key=dragKey.current
      setCols(prev=>prev.map(c=>c.key===key?{...c,width:nw}:c))
    }
    const onUp=()=>{
      dragKey.current=null
      document.body.style.cursor=''
      document.body.style.userSelect=''
    }
    window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp)
    return ()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp)}
  },[setCols])
  return (key,e)=>{
    dragKey.current=key; x0.current=e.clientX
    w0.current=cols.find(c=>c.key===key)?.width||80
    document.body.style.cursor='col-resize'
    document.body.style.userSelect='none'
    e.stopPropagation()
    e.preventDefault()
  }
}

// ── FIX #5: Table header — SK.bg with 2px bottom border (matches prototype) ──
const TH_STYLE = {
  padding:'6px 6px 4px',   // top padding so text reads from top of tall header cell
  textAlign:'left', position:'relative', verticalAlign:'top',
  fontFamily:'var(--font-head)', fontWeight:700, fontSize:10,
  textTransform:'uppercase', letterSpacing:'0.05em', color:SK.muted,
  borderRight:`1px solid ${SK.border}`, borderBottom:`2px solid ${SK.border}`,
  cursor:'pointer', userSelect:'none', background:SK.bg,
  whiteSpace:'normal',     // wrap text when column is narrow
  wordBreak:'break-word',  // break long words if needed
  lineHeight:1.3,
  overflow:'hidden',
}

// ── Relationship panel ────────────────────────────────────────────────────────
function RelTablePanel({ rows, label, cols, setCols, relCell, onGoTo, tableFontSize=12 }) {
  const { sortKey, sortDir, handleSort, sortIndicator } = useSortState()
  const startResize = useColResize(cols, setCols)
  const visCols = cols.filter(c=>c.visible)

  const sorted = useMemo(()=>{
    if(!sortKey) return rows
    return [...rows].sort((a,b)=>{
      let av,bv
      const ta=a.task,tb=b.task
      switch(sortKey){
        case 'driving':  av=(a.rel.lag_days??0)<=0?0:1; bv=(b.rel.lag_days??0)<=0?0:1; break
        case 'critical': av=ta.critical?0:1; bv=tb.critical?0:1; break
        case 'id':       av=ta.id; bv=tb.id; break
        case 'name':     av=ta.name; bv=tb.name; break
        case 'start':    av=ta.start||''; bv=tb.start||''; break
        case 'finish':   av=ta.finish||''; bv=tb.finish||''; break
        case 'relType':  av=a.rel.type; bv=b.rel.type; break
        case 'lag':      av=a.rel.lag_days||0; bv=b.rel.lag_days||0; break
        case 'tf':       av=ta.total_float??9999; bv=tb.total_float??9999; break
        case 'ff':       av=ta.free_float??9999; bv=tb.free_float??9999; break
        default: return 0
      }
      if(av<bv) return -sortDir
      if(av>bv) return sortDir
      return 0
    })
  },[rows,sortKey,sortDir])

  return (
    <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'0 10px',height:28,background:SK.bg,borderBottom:`2px solid ${SK.border}`,flexShrink:0}}>
        <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:tableFontSize,textTransform:'uppercase',letterSpacing:'0.06em',color:SK.text}}>{label}</span>
        <span style={{fontFamily:'var(--font-mono)',fontSize:tableFontSize,fontWeight:700,background:`${SK.peri}14`,color:SK.peri,borderRadius:8,padding:'1px 6px'}}>{rows.length}</span>
        <div style={{flex:1}}/>
        <RelColMgrBtnV2 cols={cols} setCols={setCols}/>
      </div>

      <div style={{flex:1,overflowX:'auto',overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
        <table style={{borderCollapse:'collapse',fontFamily:'var(--font-body)',fontSize:tableFontSize,tableLayout:'fixed',width:visCols.reduce((s,c)=>s+c.width,0)+40}}>
          <colgroup>{visCols.map(c=><col key={c.key} style={{width:c.width}}/>)}<col style={{width:40}}/></colgroup>
          <thead>
            <tr style={{height:26,background:SK.bg,position:'sticky',top:0,zIndex:2}}>
              {visCols.map(c=>(
                <th key={c.key} onClick={()=>handleSort(c.key)} style={{...TH_STYLE,textAlign:c.align||'left',color:sortKey===c.key?SK.peri:SK.muted}}>
                  {c.label}{sortIndicator(c.key)}
                  <div onMouseDown={(e)=>startResize(c.key,e)} style={{position:'absolute',right:-5,top:0,width:10,height:'100%',cursor:'col-resize',zIndex:10}}/>
                </th>
              ))}
              <th style={{...TH_STYLE,cursor:'default',width:40}}/>
            </tr>
          </thead>
          <tbody>
            {sorted.length===0&&<tr><td colSpan={visCols.length+1} style={{padding:'12px 10px',textAlign:'center',color:SK.muted,fontSize:tableFontSize}}>No {label.toLowerCase()}</td></tr>}
            {sorted.map(({rel,task},i)=>(
              <tr key={`${task.id}-${i}`} style={{borderBottom:`1px solid ${SK.border}`,background:i%2===0?'transparent':SK.bg}}>
                {visCols.map(c=>(
                  <td key={c.key} style={{padding:'3px 6px',textAlign:c.align||'left',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',width:c.width}}>
                    {relCell({rel,task},c.key)}
                  </td>
                ))}
                <td style={{padding:'3px 6px',textAlign:'center'}}>
                  <button onClick={()=>onGoTo(task.id)} style={{background:SK.peri,border:'none',borderRadius:3,cursor:'pointer',padding:'2px 7px',fontFamily:'var(--font-mono)',fontSize:9,color:'#fff'}}>Go→</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RelPanel({ selectedAct, relationships, activities, onGoTo, onToggle, isOpen, height, onDragStart, dateFmt, durUnit, tableFontSize=12 }) {
  const [predCols, setPredCols] = useState(REL_DEFAULT_COLS.map(c=>({...c})))
  const [succCols, setSuccCols] = useState(REL_DEFAULT_COLS.map(c=>({...c})))

  const actById = useMemo(()=>{
    const m={}; activities.forEach(a=>{m[a.id]=a}); return m
  },[activities])

  const preds = relationships.filter(r=>r.to_id===selectedAct?.id).map(r=>({rel:r,task:actById[r.from_id]})).filter(x=>x.task)
  const succs = relationships.filter(r=>r.from_id===selectedAct?.id).map(r=>({rel:r,task:actById[r.to_id]})).filter(x=>x.task)

  function relCell(r, key) {
    const t=r.task
    switch(key) {
      case 'driving':  return (r.rel.lag_days??0)<=0?<span style={{color:SK.peri,fontWeight:700,fontSize:tableFontSize}}>D</span>:''
      case 'critical': return t.critical?<span style={{color:SK.fail,fontWeight:700,fontSize:tableFontSize}}>●</span>:''
      case 'id':       return <span style={{fontFamily:'var(--font-mono)',fontSize:tableFontSize,color:SK.peri}}>{t.id}</span>
      case 'name':     return t.name
      case 'start':    return <span style={{fontFamily:'var(--font-mono)',fontSize:tableFontSize}}>{fmtDate(t.start,dateFmt)}</span>
      case 'finish':   return <span style={{fontFamily:'var(--font-mono)',fontSize:tableFontSize}}>{fmtDate(t.finish,dateFmt)}</span>
      case 'relType':  return <span style={{fontFamily:'var(--font-mono)',fontSize:tableFontSize,background:`${SK.peri}14`,color:SK.peri,borderRadius:3,padding:'1px 5px'}}>{r.rel.type}{r.rel.lag_days?` +${r.rel.lag_days}d`:''}</span>
      case 'lag':      return r.rel.lag_days?`${r.rel.lag_days}d`:''
      case 'tf':       return t.total_float!=null?fmtDur(t.total_float,durUnit):'—'
      case 'ff':       return t.free_float!=null?fmtDur(t.free_float,durUnit):'—'
      default: return ''
    }
  }

  // FIX #4: Sort state per pane
  function RelTable({ rows, label, cols, setCols }) {
    const { sortKey, sortDir, handleSort, sortIndicator } = useSortState()
    const startResize = useColResize(cols, setCols)
    const visCols = cols.filter(c=>c.visible)

    const sorted = useMemo(()=>{
      if(!sortKey) return rows
      return [...rows].sort((a,b)=>{
        let av,bv
        const ta=a.task,tb=b.task
        switch(sortKey){
          case 'driving':  av=(a.rel.lag_days??0)<=0?0:1; bv=(b.rel.lag_days??0)<=0?0:1; break
          case 'critical': av=ta.critical?0:1; bv=tb.critical?0:1; break
          case 'id':       av=ta.id; bv=tb.id; break
          case 'name':     av=ta.name; bv=tb.name; break
          case 'start':    av=ta.start||''; bv=tb.start||''; break
          case 'finish':   av=ta.finish||''; bv=tb.finish||''; break
          case 'relType':  av=a.rel.type; bv=b.rel.type; break
          case 'lag':      av=a.rel.lag_days||0; bv=b.rel.lag_days||0; break
          case 'tf':       av=ta.total_float??9999; bv=tb.total_float??9999; break
          case 'ff':       av=ta.free_float??9999; bv=tb.free_float??9999; break
          default: return 0
        }
        if(av<bv) return -sortDir; if(av>bv) return sortDir; return 0
      })
    },[rows,sortKey,sortDir])

    return (
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* FIX #5: Pane sub-header — SK.bg with border */}
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'0 10px',height:28,background:SK.bg,borderBottom:`2px solid ${SK.border}`,flexShrink:0}}>
          <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:11,textTransform:'uppercase',letterSpacing:'0.06em',color:SK.text}}>{label}</span>
          <span style={{fontFamily:'var(--font-mono)',fontSize:10,fontWeight:700,background:`${SK.peri}14`,color:SK.peri,borderRadius:8,padding:'1px 6px'}}>{rows.length}</span>
          <div style={{flex:1}}/>
          <RelColMgrBtnV2 cols={cols} setCols={setCols}/>
        </div>

        <div style={{flex:1,overflowX:'auto',overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
          <table style={{borderCollapse:'collapse',fontFamily:'var(--font-body)',fontSize:11,tableLayout:'fixed',width:visCols.reduce((s,c)=>s+c.width,0)+40}}>
            <colgroup>{visCols.map(c=><col key={c.key} style={{width:c.width}}/>)}<col style={{width:40}}/></colgroup>
            <thead>
              {/* FIX #5: Light header matching prototype */}
              <tr style={{height:26,background:SK.bg,position:'sticky',top:0,zIndex:2}}>
                {visCols.map((c,i)=>(
                  <th key={c.key} onClick={()=>handleSort(c.key)} style={{...TH_STYLE,textAlign:c.align||'left',color:sortKey===c.key?SK.peri:SK.muted}}>
                    {c.label}{sortIndicator(c.key)}
                    <div onMouseDown={(e)=>startResize(c.key,e)} style={{position:'absolute',right:-5,top:0,width:10,height:'100%',cursor:'col-resize',zIndex:10}}/>
                  </th>
                ))}
                <th style={{...TH_STYLE,cursor:'default',width:40}}/>
              </tr>
            </thead>
            <tbody>
              {sorted.length===0&&<tr><td colSpan={visCols.length+1} style={{padding:'12px 10px',textAlign:'center',color:SK.muted,fontSize:11}}>No {label.toLowerCase()}</td></tr>}
              {sorted.map(({rel,task},i)=>(
                <tr key={`${task.id}-${i}`} style={{borderBottom:`1px solid ${SK.border}`,background:i%2===0?'transparent':SK.bg}}>
                  {visCols.map(c=>(
                    <td key={c.key} style={{padding:'3px 6px',textAlign:c.align||'left',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',width:c.width}}>
                      {relCell({rel,task},c.key)}
                    </td>
                  ))}
                  <td style={{padding:'3px 6px',textAlign:'center'}}>
                    <button onClick={()=>onGoTo(task.id)} style={{background:SK.peri,border:'none',borderRadius:3,cursor:'pointer',padding:'2px 7px',fontFamily:'var(--font-mono)',fontSize:9,color:'#fff'}}>Go→</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div style={{flexShrink:0,background:SK.card,display:'flex',flexDirection:'column',overflow:'hidden',borderTop:`2px solid ${SK.border}`}}>
      {/* Header — always visible regardless of open state */}
      <div style={{background:SK.header,padding:'5px 12px',display:'flex',alignItems:'center',gap:10,flexShrink:0,
        position:'relative',
        cursor: isOpen ? 'ns-resize' : 'default', userSelect:'none'}}
        onMouseDown={isOpen ? onDragStart : undefined}>
        {/* Left side — label + selected activity info */}
        <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:tableFontSize,color:SK.cyan,textTransform:'uppercase',letterSpacing:'0.06em'}}>Relationships</span>
        {selectedAct&&<>
          <span style={{color:'rgba(255,255,255,0.3)',fontSize:tableFontSize}}>|</span>
          <span style={{fontFamily:'var(--font-mono)',fontSize:tableFontSize,color:'rgba(255,255,255,0.7)'}}>{selectedAct.id}</span>
          <span style={{fontFamily:'var(--font-body)',fontSize:tableFontSize,color:'rgba(255,255,255,0.5)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedAct.name}</span>
        </>}
        {/* Spacer pushes chevron to horizontal centre */}
        <div style={{flex:1}}/>
        {/* Chevron toggle — centred in the header band */}
        <button
          onClick={onToggle}
          title={isOpen ? 'Close relationships' : 'Open relationships'}
          style={{
            position:'absolute', left:'50%', transform:'translateX(-50%)',
            background:'none',border:'none',cursor:'pointer',padding:'2px 16px',lineHeight:1,
            color:'rgba(255,255,255,0.6)',fontSize:16,transition:'color 0.15s',
          }}
          onMouseEnter={e=>e.currentTarget.style.color='#fff'}
          onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,0.6)'}>
          {isOpen ? '▼' : '▲'}
        </button>
        {/* Right spacer — mirrors left content width so chevron stays truly centred */}
        <div style={{flex:1}}/>
      </div>
      {/* Gradient accent strip */}
      <div style={{height:2,background:SK.grad,flexShrink:0}}/>

      {/* Body — only rendered when open */}
      {isOpen&&(
        <div style={{height,display:'flex',overflow:'hidden',minHeight:0}}>
          <RelTablePanel rows={preds} label="Predecessors" cols={predCols} setCols={setPredCols} relCell={relCell} onGoTo={onGoTo} tableFontSize={tableFontSize}/>
          <div style={{width:1,background:SK.border,flexShrink:0}}/>
          <RelTablePanel rows={succs} label="Successors" cols={succCols} setCols={setSuccCols} relCell={relCell} onGoTo={onGoTo} tableFontSize={tableFontSize}/>
        </div>
      )}
    </div>
  )
}

// ── Gantt timeline helpers (module-level, no hooks) ──────────────────────────
// ganttRange: { start: Date, end: Date } — set once per schedule load,
// used by d2x and buildTimeline. Stored as module var (mutated on each load).
let ganttStart = new Date()
let ganttEnd   = new Date()

function addMonths(d, n) {
  const r = new Date(d); r.setMonth(r.getMonth() + n); r.setDate(1); return r
}

// Convert a date to x-pixel within the gantt viewport of width gw
function d2x(date, gw) {
  const d = typeof date === 'string' ? new Date(date) : date
  const totalDays = Math.max(1, Math.ceil((ganttEnd - ganttStart) / DAY_MS))
  return Math.round(((d - ganttStart) / DAY_MS) * (gw / totalDays))
}

// Build year/quarter/month tick arrays for the timeline header
function buildTimeline(gw) {
  const years = [], quarters = [], months = []
  const QTR_MONTHS  = [0, 3, 6, 9]
  const QTR_LABELS  = ['Q1', 'Q2', 'Q3', 'Q4']
  const totalDays   = Math.max(1, Math.ceil((ganttEnd - ganttStart) / DAY_MS))
  const monthPx     = gw / (totalDays / 30.44)   // approx px per month

  let cur = new Date(ganttStart); cur.setDate(1)
  while (cur <= ganttEnd) {
    const y = cur.getFullYear(), mo = cur.getMonth()
    const x = d2x(new Date(cur), gw)
    if (!years.find(yr => yr.year === y)) years.push({ year: y, x })
    if (QTR_MONTHS.includes(mo))
      quarters.push({ label: QTR_LABELS[QTR_MONTHS.indexOf(mo)], x })
    months.push({ label: cur.toLocaleString('en-AU', { month: 'short' }), x, showLabel: monthPx >= 22 })
    cur.setMonth(cur.getMonth() + 1)
  }
  return { years, quarters, months }
}

// Initialise gantt viewport from array of activities — call on each schedule load
function initGanttRange(activities) {
  const valid = activities.filter(a => a.start && a.finish)
  if (!valid.length) return
  const minStart = Math.min(...valid.map(a => new Date(a.start)))
  // Also consider baseline start dates — when a baseline is loaded and
  // baseline bars are earlier than the current schedule, the Gantt needs
  // to start early enough to show them.
  const blStarts = valid.map(a => a.base_start).filter(Boolean).map(s => new Date(s).getTime())
  const minD = new Date(blStarts.length ? Math.min(minStart, ...blStarts) : minStart)
  const maxD = new Date(Math.max(...valid.map(a => new Date(a.finish))))
  ganttStart = addMonths(minD, -1)
  ganttEnd   = addMonths(maxD,  1)
}

// ── Main ScheduleView ─────────────────────────────────────────────────────────
export default function ScheduleView({ onNavigate }) {
  const rowHeight = 26
  const { analysis } = useAnalysis()

  // ── Scene state — read from SceneContext (persists across nav) ─────────────
  // SceneContext is the single source of truth for all view-layout preferences.
  // ScheduleView no longer owns these as local useState — it reads from context
  // so the active scene survives navigation to Upload / Health Check and back.
  const {
    cols,         setCols,
    critOnly,     setCritOnly,
    showWbsBands, setShowWbsBands,
    hideEmpty,    setHideEmpty,
    showWbsId,    setShowWbsId,
    durUnit,      setDurUnit,
    dateFmt,      setDateFmt,
    tweaks:       sceneTweaks, setTweaks: setSceneTweaks, setTweak: setSceneTweak,
  } = useScene()

  // Local UI state — NOT part of a Scene (transient / session-only)
  const [collapsed,    setCollapsed]  = useState(new Set())   // WBS expand/collapse per-schedule
  const [wbsHidden,    setWbsHidden]  = useState(new Set())   // WBS filter visibility
  const [filterText,   setFilterText] = useState('')          // search box text
  const [selectedId,   setSelectedId] = useState(null)        // highlighted row
  const [activeColKey, setActiveColKey] = useState('id')      // keyboard nav column

  // Scene Manager visibility
  const [showSceneManager, setShowSceneManager] = useState(false)
  // Status filter — Set of statuses to show; empty = show all
  const [statusFilter, setStatusFilter] = useState(new Set())
  const scenesBtnRef = useRef(null)
  const [relPanelH,  setRelPanelH]  = useState(220)
  const [tablePxW,   setTablePxW]   = useState(DEFAULT_TABLE_W)
  // Relationship panel — header is always visible; relOpen controls body expand/collapse.
  const [relOpen,    setRelOpen]    = useState(false)
  // Gantt hover — tracks which row.id is hovered; tooltip renders inline in SVG
  const [hoveredId, setHoveredId] = useState(null)
  // Gantt width in px (maps to % label via pxToLabel)
  const [ganttW,     setGanttW]     = useState(GANTT_W_DEFAULT)
  // Customise panel visibility
  const [showCustomise, setShowCustomise] = useState(false)

  // Tweaks — alias to SceneContext so Customise panel changes are captured in scene state.
  // setTweak writes through the context, which marks the active scene as unsaved.
  const tweaks   = sceneTweaks
  const setTweaks = setSceneTweaks
  const setTweak  = setSceneTweak
  const liveRowHeight = tweaks.rowHeight ?? rowHeight
  const tableFontSize = Math.max(10, Math.min(14, Math.round(liveRowHeight * 0.46)))
  // WBS bands are section headers — 1px larger than activity rows, same scaling formula, capped at 14
  const bandFontSize = Math.min(14, tableFontSize + 1)

  // ── WBS band colour intensity ─────────────────────────────────────────────
  // wbsIntensity (0-100) drives all WBS alpha values uniformly.
  // Max bg alpha is capped at 0.75 so text always remains readable at intensity=100.
  // Border and muted-text alphas scale proportionally above bg.
  // Gantt SVG stripe is lighter (0.55x bg) to keep the chart uncluttered.
  const wbsIntRaw    = (tweaks.wbsIntensity ?? 25) / 100
  const wbsAlphaBgF  = Math.min(0.75, wbsIntRaw * 0.75)          // 0–0.75 float
  const wbsAlphaBgHex    = Math.round(wbsAlphaBgF * 255).toString(16).padStart(2,'0')
  const wbsAlphaBorderHex= Math.round(Math.min(0.95, wbsAlphaBgF * 1.5) * 255).toString(16).padStart(2,'0')
  const wbsAlphaMutedHex = Math.round(Math.min(0.95, wbsAlphaBgF * 1.8) * 255).toString(16).padStart(2,'0')
  const wbsAlphaGanttHex = Math.round(Math.min(0.95, wbsAlphaBgF * 0.55) * 255).toString(16).padStart(2,'0')

  // Keep old names so all render sites below need no changes
  const wbsAlphaBg     = wbsAlphaBgHex
  const wbsAlphaBorder = wbsAlphaBorderHex
  const wbsAlphaMuted  = wbsAlphaMutedHex
  const wbsAlphaGantt  = wbsAlphaGanttHex

  // Dynamic text contrast: compute perceived luminance of `col` blended over white
  // at the current bg alpha. Switch to white text when background gets too dark.
  // Threshold 140/255 (~55%) is the WCAG AA inflection point for large text.
  const wbsTextColor = (hexCol) => {
    const r = parseInt(hexCol.slice(1,3), 16)
    const g = parseInt(hexCol.slice(3,5), 16)
    const b = parseInt(hexCol.slice(5,7), 16)
    const a = wbsAlphaBgF
    const lum = 0.299*(a*r+(1-a)*255) + 0.587*(a*g+(1-a)*255) + 0.114*(a*b+(1-a)*255)
    return lum < 185 ? '#ffffff' : SK.text
  }
  const ganttLabelFontSize = Math.max(8, Math.min(12, Math.round(liveRowHeight * 0.36)))


  // FIX #4: Sort state for main table
  const { sortKey, sortDir, handleSort, sortIndicator } = useSortState()

  // ── Ref-based drag system (matches prototype pattern) ──────────────────────
  // Single global useEffect for ALL drag operations — no closure staleness.
  // Each drag type stores state in refs, the shared mousemove handler reads them.
  const colDragIdx = useRef(null); const colDragX0 = useRef(0); const colDragW0 = useRef(0)
  const divDrag = useRef(false); const divX0 = useRef(0); const divW0 = useRef(0)
  const relDrag = useRef(false); const relY0 = useRef(0); const relH0 = useRef(0)
  const ganttWidthDrag = useRef(false); const ganttWidthX0 = useRef(0); const ganttWidthW0 = useRef(0)
  const tableScrollRef = useRef(null)
  const ganttScrollRef = useRef(null)
  const gttHdrRef      = useRef(null)  // synced scrollLeft with body

  // ── Virtualisation ─────────────────────────────────────────────────────────
  // scrollY drives both table and Gantt row windows. Stored as state so React
  // re-renders the visible slice when the user scrolls. We debounce via rAF to
  // avoid triggering a re-render on every pixel of scroll.
  const [scrollY, setScrollY] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    const onMove = (e) => {
      // Vertical split divider — clamp between 300px and 1000px (prototype's range)
      if (divDrag.current) {
        // MIN_TABLE_W = min px needed to show all toolbar controls without overlapping the filter box.
        // Approximately: ShowAll(90) + Grouping+WBS+Columns+Days+DateFmt(5×70=350) + Search(160) + padding(40) ≈ 640
        const MIN_TABLE_W = 640
        setTablePxW(Math.max(MIN_TABLE_W, Math.min(1200, divW0.current + e.clientX - divX0.current)))
      }
      // Column resize — update width for the column being dragged
      if (colDragIdx.current !== null) {
        const nw = Math.max(36, colDragW0.current + e.clientX - colDragX0.current)
        const key = colDragIdx.current  // stored as column KEY, not index
        setCols(prev => prev.map(c => c.key === key ? {...c, width: nw} : c))
      }
      if (ganttScrollDrag.current && ganttScrollRef.current) {
        const dx = ganttScrollX0.current - e.clientX   // reversed: drag left = scroll right
        ganttScrollRef.current.scrollLeft = Math.max(0, ganttScrollL0.current + dx)
        if (gttHdrRef.current) gttHdrRef.current.scrollLeft = ganttScrollRef.current.scrollLeft
      }
      if (ganttWidthDrag.current) {
        const nw = Math.max(GANTT_W_MIN, Math.min(GANTT_W_MAX, ganttWidthW0.current + e.clientX - ganttWidthX0.current))
        setGanttW(nw)
      }
      // Horizontal rel panel resize
      if (relDrag.current) {
        setRelPanelH(Math.max(80, Math.min(400, relH0.current - (e.clientY - relY0.current))))
      }
    }
    const onUp = () => {
      divDrag.current = false
      colDragIdx.current = null
      relDrag.current = false
      ganttWidthDrag.current  = false
      ganttScrollDrag.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
  const t = tableScrollRef.current
  const g = ganttScrollRef.current
  if (!t || !g) return

  const sync = () => {
    g.scrollTop = t.scrollTop
    // Update virtualisation window via rAF — batches scroll events, avoids
    // re-rendering on every pixel during fast scroll
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setScrollY(t.scrollTop)
    })
  }

  t.addEventListener('scroll', sync)
  return () => t.removeEventListener('scroll', sync)
}, [])

  // Vertical divider — mousedown just sets refs (no closure capture)
  const startVDivider = (e) => {
    e.preventDefault()
    divDrag.current = true
    divX0.current = e.clientX
    divW0.current = tablePxW
    document.body.style.cursor = 'col-resize'
  }

  // Horizontal rel panel divider — same pattern
  const startHDivider = (e) => {
    e.preventDefault()
    relDrag.current = true
    relY0.current = e.clientY
    relH0.current = relPanelH
    document.body.style.cursor = 'ns-resize'
  }

  const startGanttWidthDrag = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    ganttWidthDrag.current = true
    ganttWidthX0.current = e.clientX
    ganttWidthW0.current = ganttW
    document.body.style.cursor = 'ew-resize'
  }

  // ── Timeline top-half: grab to scroll the Gantt horizontally ────────────────
  const ganttScrollDrag    = useRef(false)
  const ganttScrollX0      = useRef(0)
  const ganttScrollL0      = useRef(0)

  const startGanttScrollDrag = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    ganttScrollDrag.current = true
    ganttScrollX0.current   = e.clientX
    ganttScrollL0.current   = ganttScrollRef.current?.scrollLeft ?? 0
    document.body.style.cursor = 'grabbing'
  }
  if (!analysis?.schedule_data) {
    return (
      <div style={{flex:1,background:SK.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
        <div style={{fontSize:48,opacity:0.12}}>▦</div>
        <div style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:16,color:SK.muted}}>No schedule loaded</div>
        <button onClick={()=>onNavigate('upload')} style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:12,background:SK.grad,color:'#fff',border:'none',borderRadius:6,padding:'8px 20px',cursor:'pointer'}}>Upload Schedule</button>
      </div>
    )
  }

  const { baseline, setSceneActivities } = useAnalysis()

  const { activities: rawActivities, wbs_nodes:rawWbs, relationships, calendars: rawCalendars } = analysis.schedule_data

  // ── Baseline merge (Option A — client-side) ──────────────────────────────
  // When a baseline file is uploaded via UploadView, its activities are matched
  // by id to the current schedule. base_start/base_finish are taken from the
  // baseline's planned start/finish, overriding any baseline dates in the
  // current file. This allows comparing any two schedule snapshots.
  const mergedRawActivities = useMemo(() => {
    if (!baseline?.schedule_data?.activities?.length) return rawActivities
    const blMap = {}
    baseline.schedule_data.activities.forEach(a => {
      blMap[a.id] = { base_start: a.start, base_finish: a.finish }
    })
    return rawActivities.map(a => {
      const bl = blMap[a.id]
      if (!bl) return a
      return { ...a, base_start: bl.base_start, base_finish: bl.base_finish }
    })
  }, [rawActivities, baseline])

  // Build calendar map for CPM engine — converts API calendar format to workDays/exceptions
  const calMap = buildCalendarMap(rawCalendars)

  // CPM state — fully self-contained in ScheduleView
  const [recalcActivities, setRecalcActivities] = useState(null)
  const [isRecalculated,   setIsRecalculated]   = useState(false)
  const [cpmRunning,       setCpmRunning]        = useState(false)
  const [cpmAsOf,          setCpmAsOf]           = useState('')
  const [showCpmPanel,     setShowCpmPanel]       = useState(false)

  // Active activities — recalculated version takes priority when available
  const activities = recalcActivities ?? mergedRawActivities

  // As-of date — updated after recalculation
  const [liveAsOfDate, setLiveAsOfDate] = useState(null)
  const asOfDate = liveAsOfDate ?? (analysis.data_date ? new Date(analysis.data_date) : new Date())

  // Original project start — anchor for CPM forward pass (never changes)
  const projStartDate = useMemo(() => {
    const starts = mergedRawActivities.map(a => a.start).filter(Boolean).sort()
    return starts.length ? new Date(starts[0]) : new Date(analysis.data_date || Date.now())
  }, [rawActivities])
  const wbsNodes = rawWbs&&rawWbs.length>0?rawWbs:[]

  // ── Reset to Default Scene on new schedule upload ─────────────────────────
  // Fires only when source_filename changes — i.e. a new file was uploaded.
  // Does NOT fire on nav away/back (filename doesn't change in that case).
  const { resetToDefault } = useScene()
  const lastFilenameRef = useRef(null)
  useEffect(() => {
    const newFile = analysis?.source_filename
    if (!newFile) return
    if (lastFilenameRef.current !== null && lastFilenameRef.current !== newFile) {
      // Genuinely new file — apply Default scene
      resetToDefault()
    }
    lastFilenameRef.current = newFile
  }, [analysis?.source_filename, resetToDefault])

  // ── FIX #2: Hide empty WBS — lookahead algorithm ──────────────────────────
  function hasVisibleTasks(wbsId) {
    const lc = filterText.toLowerCase()
    const match = (a) => {
      if(critOnly && !a.critical) return false
      // Status filter — only exclude when filter is active (non-empty) and status not selected
      if(statusFilter.size > 0 && statusFilter.size < 3 && !statusFilter.has(a.status)) return false
      if(wbsHidden.has(a.wbs)) return false
      if(lc) return a.id.toLowerCase().includes(lc)||a.name.toLowerCase().includes(lc)
      return true
    }
    const direct = activities.filter(a=>a.wbs===wbsId).some(match)
    if(direct) return true
    return wbsNodes.filter(w=>w.parent===wbsId).some(c=>hasVisibleTasks(c.id))
  }

  // ── Build rows ─────────────────────────────────────────────────────────────
  const rows = useMemo(()=>{
    const lc = filterText.toLowerCase()
    const match = (a) => {
      if(critOnly && !a.critical) return false
      // Status filter — only exclude when filter is active (non-empty) and status not selected
      if(statusFilter.size > 0 && statusFilter.size < 3 && !statusFilter.has(a.status)) return false
      if(wbsHidden.has(a.wbs)) return false
      if(lc) return a.id.toLowerCase().includes(lc)||a.name.toLowerCase().includes(lc)
      return true
    }
    const actsByWbs = {}
    activities.forEach(a=>{ const k=a.wbs||'__none__'; if(!actsByWbs[k])actsByWbs[k]=[]; actsByWbs[k].push(a) })

    // Critical-only: keep WBS bands so grouping is visible.
    // The match() function already filters non-critical tasks, so the normal
    // walk() below naturally omits them. WBS bands remain visible (controlled
    // by showWbsBands toggle in Grouping panel, same as Show All mode).
    // If showWbsBands is off, the walk still runs but renderBand=false — flat list.

    // Compute the deepest WBS level that has direct activities (globally).
    // Used to avoid rendering empty structural bands beyond the activity level.
    // This is dynamic — each WBS branch may stop at a different depth.
    // We compute per-branch: the deepest level with direct tasks in subtree.
    function deepestActiveLevel(wbsId, visited=new Set()) {
      if(visited.has(wbsId)) return 0
      visited.add(wbsId)
      const node = wbsNodes.find(w=>w.id===wbsId)
      if(!node) return 0
      const hasDirect = (actsByWbs[wbsId]||[]).some(match)
      if(hasDirect) return node.level
      const children = wbsNodes.filter(w=>w.parent===wbsId)
      if(children.length===0) return 0
      return Math.max(...children.map(c=>deepestActiveLevel(c.id, visited)))
    }

    const result=[]
    function walk(wbsId, branchMaxLevel=999) {
      const node=wbsNodes.find(w=>w.id===wbsId)
      if(!node) return
      const children = wbsNodes.filter(w=>w.parent===wbsId).sort((a,b)=>a.id.localeCompare(b.id))
      const childMax = Math.max(0, ...children.map(c=>deepestActiveLevel(c.id)))
      const isHidden = wbsHidden.has(wbsId)
      const passesDepth = node.level <= branchMaxLevel
      const hasTasks = hasVisibleTasks(wbsId)
      const renderBand = showWbsBands && !isHidden && passesDepth && (!hideEmpty || hasTasks)

      if(renderBand) result.push({_type:'wbs',...node})
      if(isHidden || !passesDepth || !showWbsBands || !collapsed.has(wbsId)) {
        ;(actsByWbs[wbsId]||[]).filter(match).forEach(a=>result.push({_type:'task',...a}))
        children.forEach(c=>walk(c.id, childMax))
      }
    }
    wbsNodes.filter(w=>!w.parent).sort((a,b)=>a.id.localeCompare(b.id)).forEach(w=>{
      const max = deepestActiveLevel(w.id)
      walk(w.id, max)
    })
    ;(actsByWbs['__none__']||[]).filter(match).forEach(a=>result.push({_type:'task',...a}))
    return result
  },[wbsNodes,activities,collapsed,wbsHidden,hideEmpty,showWbsBands,filterText,critOnly,statusFilter])

  // WBS rollup — for each WBS node, aggregate all descendant TASK values.
  // start = earliest, finish = latest, rem_dur / orig_dur = sum,
  // total_float / free_float = minimum (most constrained child).
  // Used by: Gantt summary bars, WBS table row cells, WBS tooltip.
  const wbsExtents = useMemo(() => {
    const map = {}
    // Collect all descendant tasks recursively (only _type=task equivalent: activities with this wbs)
    function allDescTasks(wbsId, visited=new Set()) {
      if (visited.has(wbsId)) return []
      visited.add(wbsId)
      const direct = activities.filter(a => a.wbs === wbsId)
      const children = wbsNodes.filter(w => w.parent === wbsId)
      return [...direct, ...children.flatMap(c => allDescTasks(c.id, visited))]
    }
    wbsNodes.forEach(node => {
      const tasks = allDescTasks(node.id)
      if (!tasks.length) return
      const withDates = tasks.filter(a => a.start && a.finish)
      if (!withDates.length) return
      const starts   = withDates.map(a => new Date(a.start).getTime())
      const finishes = withDates.map(a => new Date(a.finish).getTime())
      const remDurs  = tasks.map(a => a.rem_dur).filter(v => v != null)
      const origDurs = tasks.map(a => a.orig_dur).filter(v => v != null)
      const tfs      = tasks.map(a => a.total_float).filter(v => v != null)
      const ffs      = tasks.map(a => a.free_float).filter(v => v != null)
      // Baseline dates — earliest base_start, latest base_finish
      const bStarts  = tasks.map(a=>a.base_start).filter(Boolean).map(s=>new Date(s).getTime())
      const bFinishes= tasks.map(a=>a.base_finish).filter(Boolean).map(s=>new Date(s).getTime())
      // Actual dates — earliest act_start of started tasks, latest act_finish of completed
      const aStarts  = tasks.map(a=>a.act_start).filter(Boolean).map(s=>new Date(s).getTime())
      const aFinishes= tasks.map(a=>a.act_finish).filter(Boolean).map(s=>new Date(s).getTime())
      // Status rollup: Complete if all have act_finish, In Progress if any have act_start, else Not Started
      const allComplete  = tasks.every(a=>a.act_finish||a.status==='Complete')
      const anyInProgress= tasks.some(a=>a.act_start&&!a.act_finish||a.status==='In Progress')
      const wbsStatus    = allComplete?'Complete':anyInProgress?'In Progress':'Not Started'
      // Unit aggregation — sum across all descendant tasks (null if no data)
      const budgetU   = tasks.map(a=>a.budget_units).filter(v=>v!=null)
      const actualU   = tasks.map(a=>a.actual_units).filter(v=>v!=null)
      const remU      = tasks.map(a=>a.remaining_units).filter(v=>v!=null)
      const atCompU   = tasks.map(a=>a.at_comp_units ?? (a.actual_units!=null&&a.remaining_units!=null?a.actual_units+a.remaining_units:null)).filter(v=>v!=null)
      // exp_finish rollup — latest expected finish across descendants
      const expFinishes = tasks.map(a=>a.exp_finish).filter(Boolean).map(s=>new Date(s).getTime())
      map[node.id] = {
        start:       new Date(Math.min(...starts)).toISOString(),
        finish:      new Date(Math.max(...finishes)).toISOString(),
        rem_dur:     remDurs.length  ? remDurs.reduce((s,v)=>s+v,0)  : null,
        orig_dur:    origDurs.length ? origDurs.reduce((s,v)=>s+v,0) : null,
        total_float: tfs.length      ? Math.min(...tfs)              : null,
        free_float:  ffs.length      ? Math.min(...ffs)              : null,
        base_start:  bStarts.length  ? new Date(Math.min(...bStarts)).toISOString()  : null,
        base_finish: bFinishes.length? new Date(Math.max(...bFinishes)).toISOString(): null,
        act_start:   aStarts.length  ? new Date(Math.min(...aStarts)).toISOString()  : null,
        act_finish:  aFinishes.length? new Date(Math.max(...aFinishes)).toISOString(): null,
        status:      wbsStatus,
        count:       tasks.length,
        exp_finish:  expFinishes.length ? new Date(Math.max(...expFinishes)).toISOString() : null,
        budget_units:    budgetU.length   ? budgetU.reduce((s,v)=>s+v,0)   : null,
        actual_units:    actualU.length   ? actualU.reduce((s,v)=>s+v,0)   : null,
        remaining_units: remU.length      ? remU.reduce((s,v)=>s+v,0)      : null,
        at_comp_units:   atCompU.length   ? atCompU.reduce((s,v)=>s+v,0)   : null,
      }
    })
    return map
  }, [activities, wbsNodes])

  // Sort helper — extracts sort value from activity row
  function sortVal(a, key) {
    switch(key){
      case 'id':          return a.id??''
      case 'name':        return a.name??''
      case 'rem_dur':     return a.rem_dur??-1
      case 'orig_dur':    return a.orig_dur??-1
      case 'start':       return a.start??''
      case 'finish':      return a.finish??''
      case 'exp_finish':  return a.exp_finish??''
      case 'total_float': return a.total_float??9999
      case 'free_float':  return a.free_float??9999
      case 'status':      return a.status??''
      case 'type':        return a.type??''
      case 'num_activities': {
        return 1  // task row = 1 activity; WBS rows sort by ext.count in their own path
      }
      case 'budget_units':    return a.budget_units    ?? -1
      case 'actual_units':    return a.actual_units    ?? -1
      case 'remaining_units': return a.remaining_units ?? -1
      case 'at_comp_units':   return a.at_comp_units   ?? ((a.actual_units != null && a.remaining_units != null) ? a.actual_units + a.remaining_units : -1)
      case 'var_budget_units':return (a.budget_units != null && (a.at_comp_units ?? (a.actual_units != null && a.remaining_units != null ? a.actual_units + a.remaining_units : null)) != null) ? a.budget_units - (a.at_comp_units ?? (a.actual_units + a.remaining_units)) : 9999
      case 'resource_id':   return a.resource_id   ?? ''
      case 'resource_name': return a.resource_name ?? ''
      case 'predecessors':  return relsBySuccId[a.id]?.length || 0
      case 'successors':    return relsByPredId[a.id]?.length || 0
      default: return ''
    }
  }

  const sortedRows = useMemo(()=>{
    if(!sortKey) return rows

    // Sort all task rows globally
    const taskRows = rows.filter(r=>r._type==='task')
    const sorted   = [...taskRows].sort((a,b)=>{
      const av=sortVal(a,sortKey), bv=sortVal(b,sortKey)
      if(av<bv) return -sortDir; if(av>bv) return sortDir; return 0
    })

    // No WBS bands in data — just return flat sorted list
    if(!showWbsBands || !rows.some(r=>r._type==='wbs')) return sorted

    // With WBS bands — rebuild the interleaved structure using the globally sorted
    // task order. Walk rows in original order, replace each task slot with the
    // next task from the sorted list that belongs to the current WBS block.
    // Simpler approach: walk original row sequence; for each WBS band, collect its
    // tasks from the sorted array (preserving their relative sort order within each band).
    const sortedById = new Map(sorted.map((t,i)=>[t.id, i]))
    const result = []
    let i = 0
    while (i < rows.length) {
      const row = rows[i]
      if (row._type === 'wbs') {
        result.push(row)
        i++
        // Collect consecutive task rows for this WBS band
        const block = []
        while (i < rows.length && rows[i]._type === 'task') {
          block.push(rows[i])
          i++
        }
        // Sort this block by global sort order
        block.sort((a,b)=>{
          const ai=sortedById.get(a.id)??0, bi=sortedById.get(b.id)??0
          return ai-bi
        })
        result.push(...block)
      } else {
        result.push(row)
        i++
      }
    }
    return result
  },[rows,sortKey,sortDir,critOnly,showWbsBands])

  // ── Publish visible activities to AnalysisContext for PDF export ───────────
  // ReportWizard reads sceneActivities from context so the exported Schedule
  // Table reflects exactly what is visible here (active Scene, filters, sort).
  // Only task rows are published — WBS band header rows are excluded because
  // the PDF template iterates activities directly, not the interleaved structure.
  useEffect(() => {
    const taskRows = sortedRows.filter(r => r._type === 'task')
    setSceneActivities(taskRows)
  }, [sortedRows, setSceneActivities])

  const handleGoTo = useCallback((id) => {
    // ── Rule 1: Resolve the target activity ──────────────────────────────────
    // Find the activity in the full (unfiltered) activity list.
    // If the activity doesn't exist at all, bail out silently.
    const targetAct = activities.find(a => a.id === id)
    if (!targetAct) return

    // ── Rule 2: Ensure the activity's WBS ancestors are expanded ────────────
    // Walk up the wbsNodes parent chain from the activity's wbs, collecting
    // every ancestor ID. Remove all of them from `collapsed` so the band is
    // open and the activity row is actually in the DOM/sortedRows.
    const targetWbsId = targetAct.wbs
    if (targetWbsId) {
      const ancestorIds = []
      let cur = wbsNodes.find(w => w.id === targetWbsId)
      while (cur) {
        ancestorIds.push(cur.id)
        cur = cur.parent ? wbsNodes.find(w => w.id === cur.parent) : null
      }
      // Expand all collapsed ancestors (and the target WBS itself)
      if (ancestorIds.length > 0) {
        setCollapsed(prev => {
          const next = new Set(prev)
          ancestorIds.forEach(wid => next.delete(wid))  // delete = expanded
          return next
        })
      }

      // ── Rule 3: Ensure the activity's WBS is not hidden via WBS filter ────
      // If the target WBS (or any ancestor) was hidden in wbsHidden, unhide it.
      setWbsHidden(prev => {
        if (!ancestorIds.some(wid => prev.has(wid))) return prev  // nothing to do
        const next = new Set(prev)
        ancestorIds.forEach(wid => next.delete(wid))
        return next
      })
    }

    // ── Rule 4: Select the activity ─────────────────────────────────────────
    setSelectedId(id)

    // ── Rule 5: Scroll to vertically centre the row ──────────────────────────
    // We intentionally do NOT use el.offsetTop here.
    //
    // REASON: The table uses virtualisation — a top spacer <tr> fills the space
    // above the rendered window. When the target row is far down the schedule,
    // it may not be in the DOM yet (offsetTop would be wrong or the element
    // wouldn't exist). Even when it is in the DOM, offsetTop is relative to the
    // <tbody>/<table> — not to the scroll container — so it only works correctly
    // when the table starts at scrollTop=0.
    //
    // CORRECT APPROACH: compute position purely from the row's index in
    // sortedRows × rowHeight. This is reliable regardless of virtualisation state
    // or current scroll position. We use a two-phase timeout:
    //   Phase 1 (0ms): React state updates (expand WBS, select) are queued.
    //   Phase 2 (80ms): React has re-rendered with the expanded WBS bands,
    //     sortedRows is now updated, and we can find the correct index.
    //
    // The 80ms delay is enough for one React render cycle + the subsequent
    // sortedRows useMemo recalculation. Increase to 150ms if jank is observed
    // on very large schedules (>5,000 activities).
    setTimeout(() => {
      const container = tableScrollRef.current
      if (!container) return

      // Re-read sortedRows inside the timeout to get the post-expansion order.
      // sortedRows is captured in the outer closure but the ref is stale after
      // the state updates above — we can't safely read it here. Instead, we
      // recompute the target row's position from first principles using the
      // rowHeight tweak value, which is a stable scalar.
      //
      // Strategy: find the row's index in the DOM via its id attribute.
      // The <tr id="sr-${id}"> is rendered once the WBS has been expanded.
      // If it's still not in the DOM (e.g. filtered by critOnly / text search),
      // fall back to a best-effort DOM lookup using getBoundingClientRect.
      const el = document.getElementById(`sr-${id}`)
      if (el) {
        // DOM path: the row exists — use its offsetTop against the scroll
        // container. We traverse up the offsetParent chain to get the offset
        // relative to the tableScrollRef div (not just the nearest parent).
        let offset = 0
        let node = el
        while (node && node !== container) {
          offset += node.offsetTop
          node = node.offsetParent
        }
        const rowH      = el.offsetHeight || (tweaks.rowHeight ?? rowHeight)
        const containerH = container.clientHeight
        const targetTop  = offset - (containerH / 2) + (rowH / 2)
        container.scrollTop = Math.max(0, targetTop)
      } else {
        // Fallback: row is still not in the DOM (filtered out by critOnly or
        // text search). Compute position from index in the activity list instead.
        // This won't be pixel-perfect but gets the viewport to the right area.
        const rh    = tweaks.rowHeight ?? rowHeight
        // Best-effort: count activities before this one in the unfiltered list
        const approxIdx = activities.findIndex(a => a.id === id)
        if (approxIdx >= 0) {
          const containerH = container.clientHeight
          const targetTop  = approxIdx * rh - (containerH / 2) + (rh / 2)
          container.scrollTop = Math.max(0, targetTop)
        }
      }

      // Keep Gantt panel vertically in sync
      if (ganttScrollRef.current) {
        ganttScrollRef.current.scrollTop = container.scrollTop
      }
    }, 80)
  }, [activities, wbsNodes, tweaks.rowHeight, rowHeight])

  // ── Variance BL helpers ──────────────────────────────────────────────────
  // varDiff: signed working-day difference (current − baseline).
  // Positive = slipping, Negative = ahead of baseline.
  // 3-path: full calendar walk → XER density proxy → raw calendar days.
  function varDiff(currentDate, baselineDate, act) {
    if (!currentDate || !baselineDate) return null
    const a = new Date(currentDate), b = new Date(baselineDate)
    if (isNaN(a) || isNaN(b)) return null
    const sign    = a >= b ? 1 : -1
    const earlier = sign === 1 ? b : a
    const later   = sign === 1 ? a : b
    const cal     = calMap[act.cal_id] || null
    let result
    if (cal && cal.workDays.size > 0) {
      let count = 0
      const cur = new Date(earlier); cur.setHours(0,0,0,0)
      const end = new Date(later);   end.setHours(0,0,0,0)
      while (cur < end) {
        cur.setDate(cur.getDate() + 1)
        const iso = cur.toISOString().substring(0,10)
        const jsDay = cur.getDay()
        const isWorking = cal.exceptions.has(iso) ? cal.exceptions.get(iso) : cal.workDays.has(jsDay)
        if (isWorking) count++
      }
      result = sign * count
    } else if (act.orig_dur != null) {
      const rawDiff  = Math.round(Math.abs(a - b) / 86400000)
      const spanDays = (act.start && act.finish)
        ? Math.round(Math.abs(new Date(act.finish) - new Date(act.start)) / 86400000) : null
      const density  = (spanDays && spanDays > 0) ? Math.min(1, act.orig_dur / spanDays) : 5/7
      result = sign * Math.round(rawDiff * density)
    } else {
      result = sign * Math.round(Math.abs(a - b) / 86400000)
    }
    return result
  }

  // fmtVar: { text, color } — amber (+Xd slipping), green (-Xd ahead), null (on track / no data)
  function fmtVar(days) {
    if (days === null || days === undefined) return { text:'—', color:null }
    const div = durUnit==='Weeks'?5:durUnit==='Months'?21:1
    const sfx = durUnit==='Weeks'?'w':durUnit==='Months'?'m':'d'
    if (days === 0) return { text:'0'+sfx, color:null }
    const abs  = Math.abs(days)
    const disp = div>1?(abs/div).toFixed(1).replace(/\.0$/,'')+sfx:abs+sfx
    if (days > 0) return { text:'+'+disp, color:'#D97706' }
    return { text:'-'+disp, color:'#16A34A' }
  }

  function cellVal(act,key) {
    switch(key){
      case 'id':          return act.id
      case 'name':        return act.name
      case 'rem_dur':     return fmtDur(act.rem_dur,durUnit)
      case 'orig_dur':    return fmtDur(act.orig_dur,durUnit)
      case 'start':       return fmtDate(act.start,dateFmt)
      case 'finish':      return fmtDate(act.finish,dateFmt)
      case 'base_start':    return fmtDate(act.base_start,dateFmt)
      case 'base_finish':   return fmtDate(act.base_finish,dateFmt)
      case 'var_bl_start':  return fmtVar(varDiff(act.start,  act.base_start,  act))
      case 'var_bl_finish': return fmtVar(varDiff(act.finish, act.base_finish, act))
      case 'act_start':   return fmtDate(act.act_start,dateFmt)
      case 'act_finish':  return fmtDate(act.act_finish,dateFmt)
      case 'total_float': return fmtDur(act.total_float,durUnit)
      case 'free_float':  return fmtDur(act.free_float,durUnit)
      case 'status':      return act.status
      case 'type':        return act.type
      case 'cstr_type': {
        // Unified constraint label map — covers P6 (CS_* prefix) and MSP (long-form) codes.
        // Both formats arrive from the API depending on source file type.
        const CSTR_LABELS = {
          // P6 codes                         // MSP equivalents
          'CS_ASAP': 'As Soon As Possible',   'AS_SOON_AS_POSSIBLE': 'As Soon As Possible',
          'CS_ALAP': 'As Late As Possible',   'AS_LATE_AS_POSSIBLE': 'As Late As Possible',
          'CS_SNET': 'Start No Earlier Than', 'START_NO_EARLIER_THAN': 'Start No Earlier Than',
          'CS_SNLT': 'Start No Later Than',   'START_NO_LATER_THAN': 'Start No Later Than',
          'CS_FNET': 'Finish No Earlier Than','FINISH_NO_EARLIER_THAN': 'Finish No Earlier Than',
          'CS_FNLT': 'Finish No Later Than',  'FINISH_NO_LATER_THAN': 'Finish No Later Than',
          'CS_MSO':  'Must Start On',         'MUST_START_ON': 'Must Start On',
          'CS_MFO':  'Must Finish On',        'MUST_FINISH_ON': 'Must Finish On',
          // MSP-only numeric or alt strings
          'MANDATORY_START': 'Must Start On',
          'MANDATORY_FINISH': 'Must Finish On',
        }
        const raw = act.cstr_type
        if (!raw) return '—'
        return CSTR_LABELS[raw] || raw  // fallback: show raw if unmapped
      }
      case 'calendar':    return act.calendar||'—'

      // ── Finish By (Expected Finish) ──────────────────────────────────────
      // P6: expect_end_date / MSP: no direct equivalent — backend maps it.
      // Falls back to '—' if field not yet serialised by api/main.py.
      case 'exp_finish':  return act.exp_finish ? fmtDate(act.exp_finish, dateFmt) : '—'

      // ── # Activities ─────────────────────────────────────────────────────
      // Task row = always 1 (it is one activity).
      // WBS band rows show descendant activity count via ext.count — handled
      // in the WBS render path below, not here.
      case 'num_activities': {
        return '1'
      }

      // ── Units ─────────────────────────────────────────────────────────────
      // P6: task resource assignment units (budgeted/actual/remaining/at-completion).
      // MSP: task Work fields (Work, ActualWork, RemainingWork, etc.)
      // Backend must serialise these from parser — show '—' until available.
      // At Completion = actual + remaining; Var = budget - at_completion.
      case 'budget_units':    return act.budget_units    != null ? String(Math.round(act.budget_units))    : '—'
      case 'actual_units':    return act.actual_units    != null ? String(Math.round(act.actual_units))    : '—'
      case 'remaining_units': return act.remaining_units != null ? String(Math.round(act.remaining_units)) : '—'
      case 'at_comp_units': {
        const atComp = act.at_comp_units
          ?? ((act.actual_units != null && act.remaining_units != null)
              ? act.actual_units + act.remaining_units : null)
        return atComp != null ? String(Math.round(atComp)) : '—'
      }
      case 'var_budget_units': {
        const atComp = act.at_comp_units
          ?? ((act.actual_units != null && act.remaining_units != null)
              ? act.actual_units + act.remaining_units : null)
        const variance = (act.budget_units != null && atComp != null)
          ? act.budget_units - atComp : null
        return variance != null ? String(Math.round(variance)) : '—'
      }

      // ── Resources ─────────────────────────────────────────────────────────
      // P6: primary resource assignment short_name / name.
      // MSP: first resource assignment resource name.
      // Backend must serialise — show '—' until available.
      case 'resource_id':   return act.resource_id   || '—'
      case 'resource_name': return act.resource_name || '—'

      // ── Lists ─────────────────────────────────────────────────────────────
      // Predecessor/successor activity IDs — computed from relationships array.
      // Formatted as comma-separated IDs. Cell naturally truncates with ellipsis.
      // Full list visible on column resize or via tooltip title attr set in the td.
      case 'predecessors': {
        const rels = relsBySuccId[act.id] || []
        return rels.length ? rels.map(r => r.from_id).join(', ') : '—'
      }
      case 'successors': {
        const rels = relsByPredId[act.id] || []
        return rels.length ? rels.map(r => r.to_id).join(', ') : '—'
      }

      default: return '—'
    }
  }

  const visCols     = cols.filter(c=>c.visible)
  // WBS rows use 'wbs:'+id as selectedId — guard so selectedAct is only set for task rows
  const selectedAct = (!selectedId || selectedId.startsWith('wbs:')) ? null : activities.find(a=>a.id===selectedId)||null
  const visTaskCnt  = rows.filter(r=>r._type==='task').length

  // ── Virtualisation window ──────────────────────────────────────────────────
  // Computes the slice of sortedRows that is currently visible, plus overscan.
  // OVERSCAN: 8 rows above/below viewport — ensures smooth scrolling without
  // blank rows appearing during fast scroll.
  // Container height is not known statically so we use a fixed estimate (600px)
  // that will be overridden at runtime by the actual scrollY + containerHeight.
  const OVERSCAN = 8
  const virtWindow = useMemo(() => {
    const rh          = tweaks.rowHeight ?? rowHeight
    const total       = sortedRows.length
    const containerH  = tableScrollRef.current?.clientHeight ?? 600
    const firstVis    = Math.floor(scrollY / rh)
    const lastVis     = Math.ceil((scrollY + containerH) / rh)
    const startIdx    = Math.max(0, firstVis - OVERSCAN)
    const endIdx      = Math.min(total - 1, lastVis + OVERSCAN)
    const topSpacer   = startIdx * rh          // px to push rendered rows down
    const bottomSpacer= Math.max(0, (total - 1 - endIdx) * rh)
    return { startIdx, endIdx, topSpacer, bottomSpacer, rh, total }
  }, [scrollY, sortedRows.length, tweaks.rowHeight, rowHeight])

  // ── Relationship index maps ────────────────────────────────────────────────
  // Built once per relationships array change. Converts O(n) .filter() calls inside
  // cellVal, sortVal, wbsExtents, and connector rendering into O(1) lookups.
  // Critical for large schedules (ES1520: 4,988 rels × 2,448 activities = 12M ops/render).
  const relsBySuccId = useMemo(() => {
    const m = {}
    relationships.forEach(r => {
      if (!m[r.to_id])   m[r.to_id]   = []
      m[r.to_id].push(r)
    })
    return m
  }, [relationships])

  const relsByPredId = useMemo(() => {
    const m = {}
    relationships.forEach(r => {
      if (!m[r.from_id]) m[r.from_id] = []
      m[r.from_id].push(r)
    })
    return m
  }, [relationships])

  // Pre-filtered FS relationships for connector rendering — avoids re-filtering on every render
  const fsRelationships = useMemo(
    () => relationships.filter(r => r.type === 'FS' || r.type === 'fs'),
    [relationships]
  )

  useEffect(() => {
    if (!visCols.some(c => c.key === activeColKey)) {
      setActiveColKey(visCols[0]?.key ?? 'id')
    }
  }, [visCols, activeColKey])

  // Initialise gantt viewport whenever activities list changes (new schedule loaded)
  // initGanttRange is a pure side-effect on module-level vars — not a hook
  useMemo(() => { initGanttRange(activities) }, [activities])

  // Build timeline ticks — re-derives when ganttW or activities change
  const timeline = useMemo(() => buildTimeline(ganttW), [ganttW, activities])

  const ensureScheduleCellVisible = useCallback((rowId, colKey) => {
    const container = tableScrollRef.current
    const gantt = ganttScrollRef.current
    if (!container) return
    const rowIdx = sortedRows.findIndex(r => r._type === 'task' && r.id === rowId)
    if (rowIdx >= 0) {
      const rh = tweaks.rowHeight ?? rowHeight
      const rowTop = rowIdx * rh
      const rowBottom = rowTop + rh
      const viewTop = container.scrollTop
      const viewBottom = viewTop + container.clientHeight
      if (rowTop < viewTop) {
        container.scrollTop = rowTop
        if (gantt) gantt.scrollTop = rowTop
      } else if (rowBottom > viewBottom) {
        const nextTop = rowBottom - container.clientHeight
        container.scrollTop = nextTop
        if (gantt) gantt.scrollTop = nextTop
      }
    }

    const colIdx = visCols.findIndex(c => c.key === colKey)
    if (colIdx >= 0) {
      const colLeft = visCols.slice(0, colIdx).reduce((sum, c) => sum + c.width, 0)
      const colRight = colLeft + visCols[colIdx].width
      const viewLeft = container.scrollLeft
      const viewRight = viewLeft + container.clientWidth
      if (colLeft < viewLeft) container.scrollLeft = colLeft
      else if (colRight > viewRight) container.scrollLeft = colRight - container.clientWidth
    }
  }, [sortedRows, visCols, tweaks.rowHeight])

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!selectedId) return
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return
      if (document.activeElement && ['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName)) return

      // Navigate ALL visible rows — both WBS bands and task rows.
      // WBS selectedId is stored as 'wbs:'+row.id; task selectedId is plain row.id.
      const navRows = sortedRows  // all visible rows in display order
      if (!navRows.length) return

      // Find current position — match against both id formats
      const isWbsSel = selectedId.startsWith('wbs:')
      const rawSelId = isWbsSel ? selectedId.slice(4) : selectedId
      const rowIdx   = navRows.findIndex(r =>
        r._type === 'wbs' ? r.id === rawSelId && isWbsSel
                           : r.id === selectedId && !isWbsSel
      )
      if (rowIdx < 0) return

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const nextIdx = e.key === 'ArrowDown'
          ? Math.min(rowIdx + 1, navRows.length - 1)
          : Math.max(rowIdx - 1, 0)
        const nextRow = navRows[nextIdx]
        if (!nextRow) return
        const nextId = nextRow._type === 'wbs' ? `wbs:${nextRow.id}` : nextRow.id
        setSelectedId(nextId)
        // Scroll to row
        const elId = nextRow._type === 'wbs' ? `sr-wbs-${nextRow.id}` : `sr-${nextRow.id}`
        setTimeout(() => {
          const el = document.getElementById(elId)
          const container = tableScrollRef.current
          if (!el || !container) return
          const containerH = container.clientHeight
          const targetTop  = el.offsetTop - (containerH / 2) + (el.offsetHeight / 2)
          container.scrollTop = Math.max(0, targetTop)
          if (ganttScrollRef.current) ganttScrollRef.current.scrollTop = container.scrollTop
        }, 0)
        return
      }

      // Left/Right column nav — only meaningful for task rows
      if (isWbsSel) return
      const colIdx = visCols.findIndex(c => c.key === activeColKey)
      if (colIdx < 0) return
      e.preventDefault()
      const nextColIdx = e.key === 'ArrowRight'
        ? Math.min(colIdx + 1, visCols.length - 1)
        : Math.max(colIdx - 1, 0)
      const nextColKey = visCols[nextColIdx]?.key
      if (nextColKey) {
        setActiveColKey(nextColKey)
        ensureScheduleCellVisible(selectedId, nextColKey)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, activeColKey, visCols, sortedRows, ensureScheduleCellVisible])

  // ── Gantt helpers (closures over ganttW) ────────────────────────────────────
  // These are regular functions, not hooks, defined inside render so they close
  // over ganttW. Safe to define here because they're not hooks.
  const toX = (dateStr) => d2x(dateStr, ganttW)

  // ── Timeline header — SVG with year / quarter / month rows ─────────────────
  // Defined inside ScheduleView so it closes over timeline + ganttW (same as prototype).
  function TimelineHeader() {
    const { years, quarters, months } = timeline
    const y2 = TL_YEAR_H
    const y3 = TL_YEAR_H + TL_QTR_H
    const totalHdr = TL_YEAR_H + TL_QTR_H + TL_MONTH_H
    return (
      <svg width={ganttW} height={totalHdr} style={{display:'block'}}>
        <defs>
          <linearGradient id="tlGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#1EC8D4"/>
            <stop offset="50%"  stopColor="#4A6FE8"/>
            <stop offset="100%" stopColor="#2A4DCC"/>
          </linearGradient>
          {/* Tooltip accent strip — same brand gradient */}
          <linearGradient id="tipGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#1EC8D4"/>
            <stop offset="50%"  stopColor="#4A6FE8"/>
            <stop offset="100%" stopColor="#2A4DCC"/>
          </linearGradient>
          {/* Arrowhead markers for relationship connectors */}
          <marker id="arrow-normal" markerWidth="8" markerHeight="6"
            refX="8" refY="3" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L0,6 L8,3 z" fill="#333333"/>
          </marker>
          <marker id="arrow-critical" markerWidth="8" markerHeight="6"
            refX="8" refY="3" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L0,6 L8,3 z" fill="#DC2626"/>
          </marker>
        </defs>
        {/* Year row */}
        {years.map(yr => (
          <g key={yr.year}>
            <line x1={yr.x} y1={0} x2={yr.x} y2={totalHdr} stroke={SK.border} strokeWidth={1.5}/>
            <text x={yr.x+5} y={14} fontSize={11} fontWeight={700} fill={SK.text} fontFamily={SK.fHead}>{yr.year}</text>
          </g>
        ))}
        {/* Quarter row */}
        <line x1={0} y1={y2} x2={ganttW} y2={y2} stroke={SK.border} strokeWidth={1}/>
        {quarters.map((q,i) => (
          <g key={i}>
            <line x1={q.x} y1={y2} x2={q.x} y2={totalHdr} stroke={SK.border} strokeWidth={1}/>
            <text x={q.x+4} y={y2+12} fontSize={10} fontWeight={700} fill={SK.peri} fontFamily={SK.fHead}>{q.label}</text>
          </g>
        ))}
        {/* Month row — hidden when monthPx < 22 (showLabel=false) */}
        <line x1={0} y1={y3} x2={ganttW} y2={y3} stroke={SK.border} strokeWidth={1}/>
        {months.map((mo,i) => (
          <g key={i}>
            <line x1={mo.x} y1={y3} x2={mo.x} y2={totalHdr} stroke={SK.border} strokeWidth={0.5} opacity={0.5}/>
            {mo.showLabel && <text x={mo.x+2} y={y3+12} fontSize={9} fill={SK.muted} fontFamily={SK.fBody}>{mo.label}</text>}
          </g>
        ))}
      </svg>
    )
  }

  // ── Gantt bar renderer — SVG rect / diamond / wbs hammock ──────────────────
  // ── Inline SVG tooltip builder (prototype approach) ─────────────────────────
  // Renders a dark rect+text label directly inside the bar's <g> when isHov=true.
  // No floating div, no React state batching issues — appears/disappears instantly.
  function GanttTooltip({ row, x, y, rh, barW=0 }) {
    const isWbs = row._type === 'wbs'
    const ext   = isWbs ? wbsExtents[row.id] : null
    const start   = isWbs ? ext?.start   : row.start
    const finish  = isWbs ? ext?.finish  : row.finish
    const remDur  = isWbs ? ext?.rem_dur : row.rem_dur
    const tf      = isWbs ? ext?.total_float : row.total_float
    const status  = isWbs ? null : row.status
    const isCrit  = !isWbs && row.critical
    const isMile  = !isWbs && (row.type === 'milestone' || row.rem_dur === 0)

    const fmtD = (s) => s ? fmtDate(s, dateFmt) : '—'
    const fmtF = (d) => d != null ? fmtDur(d, durUnit) : '—'

    // ── Layout constants ────────────────────────────────────────────────────
    const PAD     = 8            // horizontal padding inside rect
    const ROW_H   = 18           // height per text row
    const TOP_PAD = 6            // top padding inside rect

    // Row 3 (status context) — only show when showStatusIcons is on AND status is meaningful
    const statusLabel = !isWbs && tweaks.showStatusIcons ? (
      status === 'Complete'   ? '● Complete' :
      status === 'In Progress'? '● In Progress' :
      isCrit                  ? '● Critical Path' : null
    ) : null

    const numRows  = 2 + (statusLabel ? 1 : 0)
    const TIP_H    = TOP_PAD + numRows * ROW_H + 4

    // ── Row content (computed before width, because width derives from content) ─
    // Row 1: Activity name — truncate at 38 chars to avoid excessive tooltip width
    const nameStr = row.name.length > 38 ? row.name.slice(0, 37) + '…' : row.name

    // Row 2: Start  Finish  Rem Dur  TF
    const r2parts = []
    if (start)  r2parts.push(`Start: ${fmtD(start)}`)
    if (finish) r2parts.push(`Fin: ${fmtD(finish)}`)
    if (!isMile && remDur != null) r2parts.push(`Rem: ${fmtF(remDur)}`)
    if (!isMile && tf != null)     r2parts.push(`TF: ${fmtF(tf)}`)
    const row2Str = r2parts.join('  ')

    // ── Dynamic width — size to the widest content row ──────────────────────
    // SVG has no DOM text measurement in the render path, so we use per-font
    // character-width estimates:
    //   Montserrat Bold 11px  ≈ 6.8px/char (row 1 — name)
    //   JetBrains Mono  10px  ≈ 6.0px/char (row 2 — metrics, monospace)
    //   Open Sans       10px  ≈ 5.8px/char (row 3 — status label)
    const row1W = Math.ceil(nameStr.length * 6.8)
    const row2W = Math.ceil(row2Str.length * 6.0)
    const row3W = statusLabel ? Math.ceil(statusLabel.length * 5.8) + 14 : 0  // +14 for dot
    const TIP_W = Math.min(340, Math.max(180, Math.max(row1W, row2W, row3W) + PAD * 2))

    // ── Positioning: appear to the right of the bar ─────────────────────────
    // x is bar left edge, barW is bar pixel width. Offset 8px right of bar end.
    // Clamp so it doesn't escape the right edge of the SVG viewport.
    const rawTipX = x + barW + 8
    const tipX    = Math.min(rawTipX, ganttW - TIP_W - 4)
    // Vertically centre on the bar row, clamp to top of SVG
    const tipY    = Math.max(2, y + (rh - TIP_H) / 2)

    // ── Colour ──────────────────────────────────────────────────────────────
    const dotCol = status === 'Complete' ? SK.pass
                 : status === 'In Progress' ? SK.warn
                 : isCrit ? SK.fail : '#94a3b8'

    return (
      <g style={{pointerEvents:'none'}}>
        {/* Shadow rect for depth */}
        <rect x={tipX+2} y={tipY+2} width={TIP_W} height={TIP_H} rx={4} fill="rgba(0,0,0,0.18)"/>
        {/* Main background */}
        <rect x={tipX} y={tipY} width={TIP_W} height={TIP_H} rx={4} fill={SK.header} opacity={0.96}/>
        {/* Top accent strip */}
        <rect x={tipX} y={tipY} width={TIP_W} height={3} rx={4} fill="url(#tipGrad)"/>
        {/* Row 1 — Activity name */}
        <text x={tipX+PAD} y={tipY+TOP_PAD+12}
          fontSize={11} fontWeight={700} fill="#f1f5f9" fontFamily={SK.fHead}>
          {nameStr}
        </text>
        {/* Row 2 — Start / Finish / Rem Dur / TF */}
        <text x={tipX+PAD} y={tipY+TOP_PAD+12+ROW_H}
          fontSize={10} fill="#94a3b8" fontFamily={SK.fMono}>
          {row2Str}
        </text>
        {/* Row 3 — Status context (only when statusLabel present) */}
        {statusLabel && (
          <g>
            <circle cx={tipX+PAD+4} cy={tipY+TOP_PAD+12+ROW_H*2-3} r={3} fill={dotCol}/>
            <text x={tipX+PAD+12} y={tipY+TOP_PAD+12+ROW_H*2}
              fontSize={10} fill={dotCol} fontFamily={SK.fBody}>
              {statusLabel}
            </text>
          </g>
        )}
      </g>
    )
  }

  // ── Gantt bar renderer ────────────────────────────────────────────────────────
  function GanttSvgBar({ row, y, isHov }) {
    // For WBS rows, derive dates from wbsExtents (descendant task span)
    const wbsExt = row._type === 'wbs' ? wbsExtents[row.id] : null
    const rowStart  = row._type === 'wbs' ? wbsExt?.start  : row.start
    const rowFinish = row._type === 'wbs' ? wbsExt?.finish : row.finish
    if (!rowStart || !rowFinish) return null

    const x1   = toX(rowStart)
    const x2   = toX(rowFinish)
    const barW  = Math.max(2, x2 - x1)
    const rh    = tweaks.rowHeight ?? rowHeight
    const barH  = Math.max(6, Math.min(18, Math.round(rh * 0.46)))
    const barY  = y + Math.floor((rh - barH) / 2)
    const rx    = tweaks.barCornerRadius ?? 3
    const opac  = (tweaks.barOpacity ?? 85) / 100

    // WBS summary bar — hammock with bracket end-caps (prototype style)
    if (row._type === 'wbs' && tweaks.showWbsBars) {
      const col = (tweaks.barScheme === 'vivid' ? wbsColVivid : wbsColPastel)(row.level)
      const hammockH = Math.max(4, Math.min(16, Math.round(rh * 0.44) - (row.level - 1) * 2))
      const capH     = Math.min(rh - 2, hammockH + Math.max(3, Math.round(rh * 0.16)))
      const hammY    = y + Math.floor((rh - hammockH) / 2)
      const capY     = y + Math.floor((rh - capH) / 2)
      return (
        <g>
          <rect x={x1+3} y={hammY} width={Math.max(0,barW-6)} height={hammockH} rx={2} fill={col} opacity={0.45}/>
          <rect x={x1} y={capY} width={4} height={capH} rx={1} fill={col} opacity={0.85}/>
          <rect x={x1+barW-4} y={capY} width={4} height={capH} rx={1} fill={col} opacity={0.85}/>
          {isHov && <GanttTooltip row={row} x={x1} y={hammY} rh={rh} barW={barW}/>}
        </g>
      )
    }
    if (row._type === 'wbs') return null

    // Milestone — diamond
    if (row.type === 'milestone' || row.rem_dur === 0) {
      const ms = tweaks.milestoneSize ?? 7
      const cx = toX(row.start)
      const cy = y + rh / 2
      const scheme = BAR_SCHEMES[tweaks.barScheme] ?? BAR_SCHEMES.pastel
      const col = row.critical && tweaks.criticalHighlight ? scheme.critical
                : row.status === 'Complete' ? scheme.complete : SK.text
      return (
        <g>
          <polygon points={`${cx},${cy-ms} ${cx+ms},${cy} ${cx},${cy+ms} ${cx-ms},${cy}`} fill={col}/>
          {tweaks.showBarLabels && (
            <text x={cx+ms+5} y={cy+4} fontSize={ganttLabelFontSize} fill={SK.text} fontFamily={SK.fBody} fontWeight={500}
              style={{pointerEvents:'none'}}>{row.name}</text>
          )}
          {isHov && <GanttTooltip row={row} x={cx-ms} y={cy-ms} rh={rh} barW={ms*2}/>}
        </g>
      )
    }

    // Normal activity bar
    const scheme = BAR_SCHEMES[tweaks.barScheme] ?? BAR_SCHEMES.pastel
    const col = row.critical && tweaks.criticalHighlight ? scheme.critical
              : row.status === 'Complete' ? scheme.complete : scheme.normal
    const pct   = (row.phys_complete_pct ?? 0) / 100
    const progW = barW * pct

    if (tweaks.barStyle === 'outline') {
      return (
        <g>
          <rect x={x1} y={barY} width={barW} height={barH} rx={rx} fill="none" stroke={col} strokeWidth={1.5} opacity={opac}/>
          {pct > 0 && <rect x={x1} y={barY} width={progW} height={barH} rx={rx} fill={col} opacity={opac * 0.4}/>}
          {isHov && <GanttTooltip row={row} x={x1} y={barY} rh={rh} barW={barW}/>}
        </g>
      )
    }
    // ── Baseline bar (purple tick-bar-tick) ──────────────────────────────────
    // Rendered BEFORE main bar so main bar paints on top.
    // Visible when toggle is on AND the activity has baseline dates.
    const showBL  = tweaks.showBaselineBars && row.base_start && row.base_finish
    const blCol   = '#7C3AED'
    const blBarH  = Math.max(3, Math.round(barH * 0.35))
    const blBarY  = y + rh - blBarH - 2
    const blX1    = showBL ? toX(row.base_start)  : 0
    const blX2    = showBL ? toX(row.base_finish) : 0
    const blW     = showBL ? Math.max(2, blX2 - blX1) : 0
    const capW    = 2
    const capH    = blBarH + 4

    // Outline style
    if (tweaks.barStyle === 'outline') {
      return (
        <g>
          {showBL && (
            <g opacity={0.75}>
              <rect x={blX1+capW} y={blBarY} width={Math.max(0,blW-capW*2)} height={blBarH} fill={blCol}/>
              <rect x={blX1} y={blBarY-2} width={capW} height={capH} rx={1} fill={blCol}/>
              <rect x={blX2-capW} y={blBarY-2} width={capW} height={capH} rx={1} fill={blCol}/>
            </g>
          )}
          <rect x={x1} y={barY} width={barW} height={barH} rx={rx} fill="none" stroke={col} strokeWidth={1.5} opacity={opac}/>
          {pct > 0 && <rect x={x1} y={barY} width={progW} height={barH} rx={rx} fill={col} opacity={opac * 0.4}/>}
          {isHov && <GanttTooltip row={row} x={x1} y={barY} rh={rh} barW={barW}/>}
        </g>
      )
    }
    // Filled (default)
    return (
      <g>
        {showBL && (
          <g opacity={0.75}>
            <rect x={blX1+capW} y={blBarY} width={Math.max(0,blW-capW*2)} height={blBarH} fill={blCol}/>
            <rect x={blX1} y={blBarY-2} width={capW} height={capH} rx={1} fill={blCol}/>
            <rect x={blX2-capW} y={blBarY-2} width={capW} height={capH} rx={1} fill={blCol}/>
          </g>
        )}
        <rect x={x1} y={barY} width={barW} height={barH} rx={rx} fill={col} opacity={opac * 0.65}/>
        {pct > 0 && <rect x={x1} y={barY} width={progW} height={barH} rx={rx} fill={col} opacity={opac}/>}
        <rect x={x1} y={barY} width={barW} height={barH} rx={rx} fill="none" stroke={col} strokeWidth={0.75} opacity={opac}/>
        {tweaks.showBarLabels && (
          <text x={x2+5} y={barY + Math.round(barH * 0.75)} fontSize={ganttLabelFontSize} fill={SK.text} fontFamily={SK.fBody} fontWeight={500}
            style={{pointerEvents:'none'}}>{row.name}</text>
        )}
        {isHov && <GanttTooltip row={row} x={x1} y={barY} rh={rh} barW={barW}/>}
      </g>
    )
  }

  // ── CPM Recalculation handlers ───────────────────────────────────────────────
  const handleRecalculate = useCallback(() => {
    const asOfStr = cpmAsOf || (analysis.data_date ? analysis.data_date.substring(0,10) : null)
    if (!asOfStr || !mergedRawActivities.length) return
    setCpmRunning(true)
    setTimeout(() => {
      try {
        const asOfDate_new  = new Date(asOfStr)
        const newActivities = runCPM(mergedRawActivities.map(a => ({...a})), relationships, asOfDate_new, projStartDate, calMap)
        setRecalcActivities(newActivities)
        setIsRecalculated(true)
        setLiveAsOfDate(asOfDate_new)
        setShowCpmPanel(false)
      } catch(err) {
        console.error('CPM error:', err)
      } finally {
        setCpmRunning(false)
      }
    }, 30)
  }, [cpmAsOf, rawActivities, relationships, projStartDate, calMap, analysis.data_date])

  const handleResetCPM = useCallback(() => {
    setRecalcActivities(null)
    setIsRecalculated(false)
    setLiveAsOfDate(null)
    setCpmAsOf('')
    setShowCpmPanel(false)
  }, [])

  return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden',background:SK.bg}}>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      {/* Left toolbar section is fixed-width matching the table panel.
          Right (Gantt) toolbar section overlays the Gantt panel as an absolute layer. */}
      <div style={{flexShrink:0,position:'relative',background:SK.card,borderBottom:`1px solid ${SK.border}`,display:'flex',alignItems:'stretch',zIndex:30}}>

        {/* Left section — fixed width matches table panel, contains filter/group controls */}
        <div style={{width:tablePxW,minWidth:tablePxW,maxWidth:tablePxW,flexShrink:0,display:'flex',alignItems:'center',gap:6,padding:'0 10px',position:'relative',zIndex:50,borderRight:`1px solid ${SK.border}`}}>

        {/* Show All / Critical pill */}
        <div style={{display:'flex',borderRadius:5,overflow:'hidden',border:`1px solid ${SK.border}`,flexShrink:0}}>
          <div onClick={()=>setCritOnly(false)} style={{padding:'3px 10px',fontSize:11,fontFamily:'var(--font-head)',fontWeight:700,background:!critOnly?SK.peri:SK.card,color:!critOnly?'#fff':SK.muted,cursor:'pointer'}}>Show All</div>
          <div onClick={()=>setCritOnly(true)}  style={{padding:'3px 10px',fontSize:11,fontFamily:'var(--font-head)',fontWeight:700,background:critOnly?SK.fail:SK.card,color:critOnly?'#fff':SK.muted,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
            <span style={{fontSize:8,color:critOnly?'#fff':SK.fail}}>●</span>Critical
          </div>
        </div>

        {/* Grouping — FIX #2 passes hideEmpty */}
        <HoverPanel
          trigger={(open)=><PillBtn active={open}>⊞ Grouping{collapsed.size>0&&<span style={{fontFamily:'var(--font-mono)',fontSize:9,background:SK.peri,color:'#fff',borderRadius:3,padding:'1px 4px',marginLeft:2}}>{collapsed.size}</span>}</PillBtn>}
          panel={<GroupingPanel wbsNodes={wbsNodes} collapsed={collapsed} setCollapsed={setCollapsed} hideEmpty={hideEmpty} setHideEmpty={setHideEmpty} showWbsBands={showWbsBands} setShowWbsBands={setShowWbsBands} showWbsId={showWbsId} setShowWbsId={setShowWbsId}/>}
        />

        {/* WBS Filter */}
        <HoverPanel
          trigger={(open)=><PillBtn active={open||wbsHidden.size>0}>⊟ WBS{wbsHidden.size>0&&<span style={{fontFamily:'var(--font-mono)',fontSize:9,background:SK.warn,color:'#fff',borderRadius:3,padding:'1px 4px',marginLeft:2}}>{wbsHidden.size}</span>}</PillBtn>}
          panel={<WbsFilterPanel wbsNodes={wbsNodes} activities={activities} hidden={wbsHidden} setHidden={setWbsHidden}/>}
        />

        {/* Columns */}
        <HoverPanel
          trigger={(open)=><PillBtn active={open}>⊞ Columns</PillBtn>}
          panel={<ColMgrPanel cols={cols} setCols={setCols}/>}
        />

        {/* Status filter — between Columns and Formats */}
        <HoverPanel
          trigger={(open)=>(
            <PillBtn active={open||statusFilter.size>0}>
              ◉ Status
              {statusFilter.size>0&&statusFilter.size<3&&(
                <span style={{fontFamily:'var(--font-mono)',fontSize:9,background:SK.peri,color:'#fff',borderRadius:3,padding:'1px 4px',marginLeft:2}}>
                  {statusFilter.size}
                </span>
              )}
            </PillBtn>
          )}
          panel={<StatusFilterPanel statusFilter={statusFilter} setStatusFilter={setStatusFilter}/>}
        />

        {/* Formats — consolidated Duration Units + Date Format */}
        <HoverPanel
          trigger={(open)=><PillBtn active={open}>⏱ Formats</PillBtn>}
          panel={<FormatsPanel unit={durUnit} setUnit={setDurUnit} fmt={dateFmt} setFmt={setDateFmt}/>}
        />
          {/* Search */}
          <div style={{position:'relative',marginLeft:4}}>
            <span style={{position:'absolute',left:7,top:'50%',transform:'translateY(-50%)',color:SK.muted,fontSize:12,pointerEvents:'none'}}>⌕</span>
            <input value={filterText} onChange={e=>setFilterText(e.target.value)} placeholder="Filter..." style={{paddingLeft:24,paddingRight:filterText?22:8,height:26,width:140,border:`1px solid ${SK.border}`,borderRadius:5,fontFamily:'var(--font-body)',fontSize:12,color:SK.text,background:SK.bg,outline:'none'}}/>
            {filterText&&<button onClick={()=>setFilterText('')} style={{position:'absolute',right:5,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:SK.muted,fontSize:11,padding:0}}>✕</button>}
          </div>
        </div>{/* end left toolbar */}

        {/* Right side — chart width slider + legend, stacked 2 rows */}
        <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',padding:'4px 12px',gap:3,minWidth:0,overflow:'hidden'}}>
          {/* Row 1 — Chart width slider */}
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:10,color:SK.muted,fontFamily:SK.fMono,whiteSpace:'nowrap',flexShrink:0}}>Chart width</span>
            <input type="range" min={GANTT_W_MIN} max={GANTT_W_MAX} step={50} value={ganttW}
              onChange={e=>setGanttW(Number(e.target.value))}
              style={{flex:1,minWidth:60,maxWidth:160,accentColor:SK.peri,cursor:'pointer',height:4}}/>
            <span style={{fontSize:10,fontFamily:SK.fMono,color:SK.peri,
              background:`${SK.peri}14`,border:`1px solid ${SK.peri}44`,
              borderRadius:4,padding:'1px 7px',width:44,textAlign:'center',flexShrink:0}}>
              {pxToLabel(ganttW)}
            </span>
          </div>
          {/* Row 2 — Legend chips */}
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'nowrap',overflow:'hidden'}}>
            {(()=>{
              const sc=BAR_SCHEMES[tweaks.barScheme]??BAR_SCHEMES.pastel
              return [
                {col:sc.normal,   label:'Normal'},
                {col:sc.critical, label:'Critical'},
                {col:sc.complete, label:'Complete'},
                {col:SK.warn,     label:'Constraint'},
                {col:SK.cyan,     label:'As-of Date', line:true},
              ].map(({col,label,line})=>(
                <span key={label} style={{display:'flex',alignItems:'center',gap:4,
                  fontSize:10,color:SK.muted,whiteSpace:'nowrap',flexShrink:0}}>
                  <span style={{width:line?2:9,height:line?12:7,background:col,
                    borderRadius:line?0:2,display:'inline-block',flexShrink:0,opacity:line?0.8:1}}/>
                  {label}
                </span>
              ))
            })()}
            {/* Baseline legend chip — tick-bar-tick */}
            <span style={{display:'flex',alignItems:'center',gap:4,fontSize:10,color:SK.muted,whiteSpace:'nowrap',flexShrink:0}}>
              <span style={{display:'inline-flex',alignItems:'center',flexShrink:0,opacity:0.7}}>
                <span style={{width:2,height:7,background:'#7C3AED',display:'inline-block',borderRadius:1}}/>
                <span style={{width:14,height:3,background:'#7C3AED',display:'inline-block'}}/>
                <span style={{width:2,height:7,background:'#7C3AED',display:'inline-block',borderRadius:1}}/>
              </span>
              Baseline
            </span>
          </div>
        </div>

        {/* ── CPM As-of chip + panel — left of the cog ─────────────────────── */}
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'0 8px',flexShrink:0,position:'relative'}}>

          {/* CPM RECALC badge — shown after recalculation */}
          {baseline?.schedule_data && (
            <span style={{fontFamily:'var(--font-mono)',fontSize:9,fontWeight:700,
              color:'#7C3AED',background:'rgba(124,58,237,0.08)',
              border:'1px solid rgba(124,58,237,0.25)',
              borderRadius:4,padding:'2px 7px',whiteSpace:'nowrap',flexShrink:0}}
              title={`Baseline: ${baseline.project_name}`}>
              BL ✓
            </span>
          )}

          {isRecalculated && (
            <span style={{fontFamily:'var(--font-mono)',fontSize:9,fontWeight:700,
              color:SK.fail,background:`${SK.fail}10`,border:`1px solid ${SK.fail}33`,
              borderRadius:4,padding:'2px 7px',whiteSpace:'nowrap',flexShrink:0}}>
              CPM RECALC
            </span>
          )}

          {/* As-of date chip — matches prototype: "AS-OF · date · ✎" */}
          <div
            onClick={()=>setShowCpmPanel(v=>!v)}
            title="Click to change As-of Date / Run CPM"
            style={{
              display:'flex',alignItems:'center',gap:5,
              fontFamily:'var(--font-mono)',fontSize:10,
              color:showCpmPanel||isRecalculated?SK.peri:'#94a3b8',
              background:showCpmPanel?`${SK.peri}10`:'#1a2a3a',
              border:`1px solid ${showCpmPanel?SK.peri:'#334155'}`,
              borderRadius:5,padding:'4px 9px',cursor:'pointer',flexShrink:0,
              transition:'all 0.15s',
            }}>
            <span style={{fontSize:9,color:showCpmPanel?SK.peri:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em'}}>AS-OF</span>
            <span>{fmtDate((liveAsOfDate||asOfDate).toISOString(), dateFmt)}</span>
            <span style={{fontSize:9,color:showCpmPanel?SK.peri:'#475569'}}>✎</span>
          </div>

          {/* CPM popover — closes ONLY via X, Recalculate, or Reset */}
          {showCpmPanel && (
            <div style={{
              position:'fixed',zIndex:600,
              background:SK.card,border:`1px solid ${SK.border}`,
              borderRadius:10,boxShadow:'0 8px 32px rgba(42,77,204,0.18)',
              padding:'18px 20px',width:320,
              fontFamily:'var(--font-body)',
            }} ref={el => {
              if (!el) return
              // Anchor popover: position above the chip, right-aligned
              const btn = el.previousSibling
              if (!btn) return
              const rect = btn.getBoundingClientRect()
              el.style.right = (window.innerWidth - rect.right) + 'px'
              el.style.top   = (rect.bottom + 6) + 'px'
            }}>
              {/* X close — only explicit close mechanism */}
              <button onClick={()=>setShowCpmPanel(false)}
                style={{position:'absolute',top:10,right:12,background:'none',border:'none',
                  color:SK.muted,cursor:'pointer',fontSize:16,lineHeight:1}}>✕</button>

              {/* Title */}
              <div style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:12,
                color:SK.text,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:14}}>
                CPM Recalculation
              </div>

              {/* Date picker */}
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:SK.muted,marginBottom:5}}>New As-of Date (Data Date)</div>
                <input
                  type="date"
                  value={cpmAsOf||(liveAsOfDate?liveAsOfDate.toISOString().substring(0,10):analysis.data_date?analysis.data_date.substring(0,10):'')}
                  onChange={e=>setCpmAsOf(e.target.value)}
                  style={{width:'100%',fontFamily:'var(--font-mono)',fontSize:12,
                    color:SK.text,background:SK.bg,
                    border:`1px solid ${SK.border}`,borderRadius:6,
                    padding:'7px 10px',outline:'none',boxSizing:'border-box'}}
                />
              </div>

              {/* Info */}
              <div style={{fontSize:10,color:SK.muted,
                background:`${SK.peri}08`,border:`1px solid ${SK.peri}22`,
                borderRadius:6,padding:'8px 10px',marginBottom:14,lineHeight:1.6}}>
                Full CPM forward + backward pass using activity calendars.
                In-progress tasks advance from the new date.
                Float and Critical Path recalculated.
              </div>

              {/* Buttons — Recalculate closes, Reset closes */}
              <div style={{display:'flex',gap:8}}>
                <button
                  onClick={handleRecalculate}
                  disabled={cpmRunning}
                  style={{flex:2,fontFamily:'var(--font-head)',fontWeight:700,fontSize:12,
                    background:cpmRunning?SK.border:SK.grad,color:'#fff',
                    border:'none',borderRadius:6,padding:'9px 0',
                    cursor:cpmRunning?'default':'pointer',
                    display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {cpmRunning ? 'Running…' : '▶ Recalculate'}
                </button>
                {isRecalculated && (
                  <button
                    onClick={handleResetCPM}
                    style={{flex:1,fontFamily:'var(--font-head)',fontWeight:700,fontSize:12,
                      background:'transparent',color:SK.muted,
                      border:`1px solid ${SK.border}`,borderRadius:6,
                      padding:'9px 0',cursor:'pointer'}}>
                    ↺ Reset
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ⊞ Scenes button — between As-of chip and ⚙ cog */}
        <div style={{display:'flex',alignItems:'center',padding:'0 4px',flexShrink:0,position:'relative'}}>
          <button
            ref={scenesBtnRef}
            onClick={()=>setShowSceneManager(v=>!v)}
            title="Scene Manager — save and load view layouts"
            style={{
              display:'flex',alignItems:'center',gap:5,
              height:30,padding:'0 10px',
              fontFamily:SK.fHead,fontWeight:700,fontSize:10,
              color:showSceneManager?SK.peri:SK.muted,
              background:showSceneManager?`${SK.peri}14`:SK.card,
              border:`1px solid ${showSceneManager?SK.peri:SK.border}`,
              borderRadius:6,cursor:'pointer',transition:'all 0.15s',
              whiteSpace:'nowrap',
            }}>
            <span style={{fontSize:13,lineHeight:1}}>⊞</span>
            <span>Scenes</span>
          </button>

          {/* Scene Manager popover — renders below button, closes on outside click */}
          {showSceneManager && (
            <SceneManager
              onClose={()=>setShowSceneManager(false)}
              btnRef={scenesBtnRef}
            />
          )}
        </div>


        {/* ⚙ Customise cog button — right edge of toolbar */}
        <div style={{display:'flex',alignItems:'center',padding:'0 8px',flexShrink:0}}>
          <button onClick={()=>setShowCustomise(v=>!v)}
            title="Customise SKOPIA Lens"
            style={{width:30,height:30,borderRadius:6,border:`1px solid ${showCustomise?SK.peri:SK.border}`,
              background:showCustomise?`${SK.peri}14`:SK.card,cursor:'pointer',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:15,color:showCustomise?SK.peri:SK.muted,transition:'all 0.15s'}}>
            ⚙
          </button>
        </div>
      </div>{/* end toolbar */}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>

        {/* Table + Gantt row */}
        <div style={{flex:1,display:'flex',overflow:'hidden',minHeight:0}}>

          {/* FIX #1: Left panel — fixed px width, NOT %, own scroll */}
          <div style={{width:tablePxW,flexShrink:0,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:300}}>
            <div ref={tableScrollRef} style={{flex:1,overflowX:'auto',overflowY:'auto',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
              <table style={{borderCollapse:'collapse',fontFamily:'var(--font-body)',fontSize:tableFontSize,tableLayout:'fixed',width:visCols.reduce((s,c)=>s+c.width,0)}}>
                <colgroup>{visCols.map(c=><col key={c.key} style={{width:c.width}}/>)}</colgroup>
                <thead>
                  {/* Header height matches timeline HDR_H = Year+Qtr+Month+3px strip */}
                  <tr style={{height:HDR_H,background:SK.bg,position:'sticky',top:0,zIndex:10}}>
                    {visCols.map((c,i)=>(
                      <th key={c.key} onClick={()=>handleSort(c.key)}
                        style={{...TH_STYLE,textAlign:(c.key==='id'||c.key==='name')?'left':'center',color:sortKey===c.key?SK.peri:SK.muted}}>
                        {c.label}{sortIndicator(c.key)}
                        <div onMouseDown={(e)=>{colDragIdx.current=c.key;colDragX0.current=e.clientX;colDragW0.current=c.width;document.body.style.cursor='col-resize';e.stopPropagation();e.preventDefault()}}
                          style={{position:'absolute',right:-3,top:0,width:6,height:'100%',cursor:'col-resize',zIndex:10}}/>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.length===0&&<tr><td colSpan={visCols.length} style={{padding:'28px 16px',textAlign:'center',color:SK.muted,fontSize:13}}>No activities match.</td></tr>}
                  {/* Top spacer — fills the space above the rendered window */}
                  {virtWindow.topSpacer > 0 && (
                    <tr key="__top_spacer" style={{height:virtWindow.topSpacer}}><td colSpan={visCols.length}/></tr>
                  )}
                  {sortedRows.slice(virtWindow.startIdx, virtWindow.endIdx + 1).map((row,localIdx)=>{
                    const idx = virtWindow.startIdx + localIdx
                    if(row._type==='wbs') {
                      const isCol=collapsed.has(row.id), col=(tweaks.barScheme==='vivid'?wbsColVivid:wbsColPastel)(row.level), indent=(row.level-1)*6
                      const bandLabel = showWbsId ? `${row.id} · ${row.name}` : row.name
                      const ext = wbsExtents[row.id]   // rollup values for this WBS node
                      // Helper: render a rollup value for a given column key
                      const wbsCell = (key) => {
                        if (!ext) return '—'
                        switch(key) {
                          case 'rem_dur':     return ext.rem_dur    != null ? fmtDur(ext.rem_dur,    durUnit) : '—'
                          case 'orig_dur':    return ext.orig_dur   != null ? fmtDur(ext.orig_dur,   durUnit) : '—'
                          case 'total_float': return ext.total_float!= null ? fmtDur(ext.total_float,durUnit) : '—'
                          case 'free_float':  return ext.free_float != null ? fmtDur(ext.free_float, durUnit) : '—'
                          case 'start':       return ext.start       ? fmtDate(ext.start,       dateFmt) : '—'
                          case 'finish':      return ext.finish      ? fmtDate(ext.finish,      dateFmt) : '—'
                          case 'base_start':    return ext.base_start  ? fmtDate(ext.base_start,  dateFmt) : '—'
                          case 'base_finish':   return ext.base_finish ? fmtDate(ext.base_finish, dateFmt) : '—'
                          case 'var_bl_start': {
                            const desc = sortedRows.filter(r=>r._type==='task'&&r.wbs===row.id)
                            const vals = desc.map(t=>varDiff(t.start,t.base_start,t)).filter(v=>v!==null)
                            return vals.length ? fmtVar(vals.reduce((a,b)=>a<b?a:b)) : {text:'—',color:null}
                          }
                          case 'var_bl_finish': {
                            const desc = sortedRows.filter(r=>r._type==='task'&&r.wbs===row.id)
                            const vals = desc.map(t=>varDiff(t.finish,t.base_finish,t)).filter(v=>v!==null)
                            return vals.length ? fmtVar(vals.reduce((a,b)=>a>b?a:b)) : {text:'—',color:null}
                          }
                          case 'act_start':     return ext.act_start   ? fmtDate(ext.act_start,   dateFmt) : '—'
                          case 'act_finish':    return ext.act_finish  ? fmtDate(ext.act_finish,  dateFmt) : '—'
                          case 'status':        return ext.status ?? '—'
                          case 'exp_finish':    return ext.exp_finish  ? fmtDate(ext.exp_finish,  dateFmt) : '—'
                          case 'num_activities':return String(ext.count ?? 0)
                          case 'budget_units':    return ext.budget_units    != null ? String(Math.round(ext.budget_units))    : '—'
                          case 'actual_units':    return ext.actual_units    != null ? String(Math.round(ext.actual_units))    : '—'
                          case 'remaining_units': return ext.remaining_units != null ? String(Math.round(ext.remaining_units)) : '—'
                          case 'at_comp_units':   return ext.at_comp_units   != null ? String(Math.round(ext.at_comp_units))   : '—'
                          case 'var_budget_units':{
                            const v = (ext.budget_units != null && ext.at_comp_units != null) ? ext.budget_units - ext.at_comp_units : null
                            return v != null ? String(Math.round(v)) : '—'
                          }
                          // type, cstr_type, calendar, resource_id, resource_name, predecessors, successors — not meaningful as WBS rollup
                          default:              return ''
                        }
                      }
                      const floatVal = ext?.total_float
                      return (
                        <tr key={`w-${row.id}`} id={`sr-wbs-${row.id}`}
                          onClick={()=>setSelectedId(prev => prev===`wbs:${row.id}` ? null : `wbs:${row.id}`)}
                          style={{height:tweaks.rowHeight??rowHeight,
                            background:selectedId===`wbs:${row.id}`?SK.sel:`${col}${wbsAlphaBg}`,
                            cursor:'pointer',borderBottom:`1px solid ${col}${wbsAlphaBorder}`,userSelect:'none',
                            borderLeft:selectedId===`wbs:${row.id}`?`3px solid ${col}`:'3px solid transparent'}}>
                          {visCols.map((c,ci)=>{
                            const isId   = c.key==='id'
                            const isName = c.key==='name'
                            // idIsVisible: true when the 'id' column is in visCols
                            const idIsVisible = visCols.some(col=>col.key==='id')

                            // The WBS label (chevron + name) always anchors to the FIRST column.
                            // If 'id' col is visible it's always ci===0 (fixed:true), so render label there.
                            // If 'id' col is hidden, 'name' will be ci===0, so render label there.
                            if (isId) {
                              // overflow:visible on a td is ignored by browsers in table-layout:fixed.
                              // Fix: position:relative on the td + position:absolute inner div whose
                              // width spans id+name columns exactly. Stops at name's right edge by geometry.
                              // pointerEvents:none so the TR onClick (collapse/expand) still fires normally.
                              const nameCol = visCols.find(col => col.key === 'name')
                              const nameColW = nameCol ? nameCol.width : 0
                              const spanW = c.width + nameColW
                              const isWbsSelId   = selectedId===`wbs:${row.id}`
                              const isActiveCellId = isWbsSelId && c.key===activeColKey
                              return (
                                <td key={c.key}
                                  onClick={e=>{e.stopPropagation();setSelectedId(`wbs:${row.id}`);setActiveColKey(c.key)}}
                                  style={{width:c.width,padding:0,overflow:'visible',position:'relative',
                                    background:isActiveCellId?'rgba(74,111,232,0.08)':`${col}${wbsAlphaBg}`,
                                    boxShadow:isActiveCellId?`inset 0 0 0 2px ${SK.peri}`:'none',
                                    cursor:'pointer'}}>
                                  <div style={{
                                    position:'absolute',top:0,left:0,
                                    width:spanW,height:'100%',
                                    display:'flex',alignItems:'center',
                                    paddingLeft:4+indent,gap:4,
                                    zIndex:1,pointerEvents:'none',
                                  }}>
                                    <span
                                      onClick={e=>{e.stopPropagation();setCollapsed(prev=>{const n=new Set(prev);n.has(row.id)?n.delete(row.id):n.add(row.id);return n})}}
                                      style={{fontFamily:'var(--font-mono)',fontSize:8,color:wbsTextColor(col),width:14,flexShrink:0,textAlign:'center',cursor:'pointer',pointerEvents:'all'}}>{isCol?'▶':'▼'}</span>
                                    <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:bandFontSize,color:wbsTextColor(col),whiteSpace:'nowrap',overflow:'hidden',flex:1}}>{bandLabel}</span>
                                  </div>
                                </td>
                              )
                            }
                            if (isName) {
                              if (idIsVisible) {
                                // id td holds the label via position:absolute — this cell is empty.
                                // position:relative keeps z-index stacking correct.
                                const isWbsSelNm   = selectedId===`wbs:${row.id}`
                                const isActiveCellNm = isWbsSelNm && c.key===activeColKey
                                return <td key={c.key}
                                  onClick={e=>{e.stopPropagation();setSelectedId(`wbs:${row.id}`);setActiveColKey(c.key)}}
                                  style={{width:c.width,padding:'2px 8px',overflow:'hidden',position:'relative',
                                    background:isActiveCellNm?'rgba(74,111,232,0.08)':`${col}${wbsAlphaBg}`,
                                    boxShadow:isActiveCellNm?`inset 0 0 0 2px ${SK.peri}`:'none',
                                    cursor:'pointer'}}/>
                              } else {
                                // 'id' col hidden — 'name' is ci===0, render label here
                                return (
                                  <td key={c.key} style={{width:c.width,padding:`2px 6px 2px ${4+indent}px`,overflow:'hidden',background:`${col}${wbsAlphaBg}`}}>
                                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                                      <span
                                      onClick={e=>{e.stopPropagation();setCollapsed(prev=>{const n=new Set(prev);n.has(row.id)?n.delete(row.id):n.add(row.id);return n})}}
                                      style={{fontFamily:'var(--font-mono)',fontSize:8,color:wbsTextColor(col),width:14,flexShrink:0,textAlign:'center',cursor:'pointer',pointerEvents:'all'}}>{isCol?'▶':'▼'}</span>
                                      <span style={{fontFamily:'var(--font-head)',fontWeight:700,fontSize:bandFontSize,color:wbsTextColor(col),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{bandLabel}</span>
                                    </div>
                                  </td>
                                )
                              }
                            }
                            // All other columns — show rollup value
                            const val = wbsCell(c.key)
                            const tfHi = c.key==='total_float'&&floatVal!=null?(floatVal<0?SK.fail:floatVal===0?SK.warn:col):col
                            const isWbsSel   = selectedId===`wbs:${row.id}`
                            const isActiveWbsCell = isWbsSel && c.key===activeColKey
                            return (
                              <td key={c.key}
                                onClick={e=>{
                                  e.stopPropagation()
                                  // Clicking a data cell on a WBS band selects the band AND sets active column
                                  setSelectedId(`wbs:${row.id}`)
                                  setActiveColKey(c.key)
                                }}
                                style={{
                                width:c.width,padding:'2px 8px',
                                fontFamily:'var(--font-mono)',fontSize:tableFontSize,
                                color: val&&typeof val==='object'?val.color||wbsTextColor(col):val?wbsTextColor(col):`${col}${wbsAlphaMuted}`,
                                fontWeight:700,textAlign:'center',
                                background:isActiveWbsCell?'rgba(74,111,232,0.08)':`${col}${wbsAlphaBg}`,
                                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                                boxShadow:isActiveWbsCell?`inset 0 0 0 2px ${SK.peri}`:'none',
                                cursor:'pointer',
                              }}>{val&&typeof val==='object'?val.text:val||'—'}</td>
                            )
                          })}
                        </tr>
                      )
                    }
                    const act=row, isSel=act.id===selectedId
                    const wbsLv=wbsNodes.find(w=>w.id===act.wbs)?.level??0
                    const indent=wbsLv*6+6
                    return (
                      <tr id={`sr-${act.id}`} key={`t-${act.id}`}
                        onClick={()=>{
                          // Row click selects the activity.
                          // Cell-level onClick (below) sets the active column — this keeps keyboard nav working.
                          // Row click: select/deselect activity. Panel open state is independent.
                          setSelectedId(prev=>prev===act.id?null:act.id)
                          if(!visCols.some(col=>col.key===activeColKey)) setActiveColKey(visCols[0]?.key ?? 'id')
                        }}
                        style={{height:tweaks.rowHeight??rowHeight,
                          background:isSel?SK.sel:tweaks.rowStripes?(idx%2===0?SK.card:SK.bg):SK.card,
                          cursor:'pointer',borderBottom:`1px solid ${SK.border}`,
                          borderLeft:isSel
                            ?`3px solid ${SK.warn}`
                            :isRecalculated&&act._recalc
                            ?`3px solid ${SK.peri}`
                            :'3px solid transparent'}}>
                        {visCols.map((c,ci)=>{
                          const val=cellVal(act,c.key)
                          const isDate=['start','finish','base_start','base_finish','act_start','act_finish','exp_finish'].includes(c.key)
                          const isDur=['rem_dur','orig_dur','total_float','free_float','budget_units','actual_units','remaining_units','at_comp_units','var_budget_units','num_activities'].includes(c.key)
                          const isVar=c.key==='var_bl_start'||c.key==='var_bl_finish'
                          const isId=c.key==='id', isName=c.key==='name'
                          const isActiveCell = isSel && c.key===activeColKey
                          const pl=ci===0?indent:8
                          // var_bl columns return {text,color} from fmtVar — extract for display
                          const varObj     = isVar && val && typeof val==='object' ? val : null
                          const displayVal = varObj ? varObj.text : val
                          return (
                            <td key={c.key}
                              onClick={(e)=>{
                                // Cell click — select this activity AND set this column as active.
                                // e.stopPropagation() prevents the <tr> onClick from toggling deselect.
                                e.stopPropagation()
                                setSelectedId(act.id)
                                setActiveColKey(c.key)
                              }}
                              style={{padding:`3px 8px 3px ${ci===0?pl:8}px`,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',width:c.width,
                              fontFamily:isDate||isDur||isId||isVar?'var(--font-mono)':'var(--font-body)',fontSize:tableFontSize,textAlign:isId||isName?'left':'center',
                              color:isVar?(varObj?.color||SK.muted):(c.key==='total_float'&&act.total_float!=null)?(act.total_float<0?SK.fail:act.total_float===0?SK.warn:SK.text):(c.key==='free_float'&&act.free_float!=null&&act.free_float<0)?SK.fail:(isId||isName)&&act.critical?SK.fail:SK.text,
                              fontWeight:isName&&act.critical?600:isVar&&varObj?.color?700:400,
                              boxShadow:isActiveCell?`inset 0 0 0 2px ${SK.peri}`:'none',
                              background:isActiveCell?'rgba(74,111,232,0.08)':'transparent',
                            }}>
                              {isName?(
                                <span style={{display:'flex',alignItems:'center',gap:4}}>
                                  {tweaks.showStatusIcons&&(
                                    <span style={{width:6,height:6,borderRadius:'50%',flexShrink:0,display:'inline-block',background:act.status==='Complete'?SK.pass:act.status==='In Progress'?SK.warn:act.critical?SK.fail:'#CBD5E1'}}/>
                                  )}
                                  {displayVal}
                                </span>
                              ):displayVal}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {/* Bottom spacer — fills space below rendered window */}
                  {virtWindow.bottomSpacer > 0 && (
                    <tr key="__bot_spacer" style={{height:virtWindow.bottomSpacer}}><td colSpan={visCols.length}/></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>


          {/* Vertical divider — draggable */}
          <div onMouseDown={startVDivider}
            style={{width:4,flexShrink:0,cursor:'col-resize',background:SK.border,zIndex:5,transition:'background 0.15s'}}
            onMouseEnter={e=>e.currentTarget.style.background=SK.grad}
            onMouseLeave={e=>e.currentTarget.style.background=SK.border}
          />

          {/* ── Gantt panel — timeline header (sticky) + SVG body ────────── */}
          <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',background:SK.card,overflow:'hidden'}}>

            {/* Sticky timeline header — same height as table header (HDR_H) */}
            {/* Separate div with hidden scrollbar, synced to body scrollLeft */}
            <div ref={gttHdrRef}
              style={{height:HDR_H,borderBottom:`2px solid ${SK.border}`,flexShrink:0,
                background:SK.bg,overflowX:'scroll',overflowY:'hidden',
                scrollbarWidth:'none',position:'relative'}}>
              <style>{`.sk-gtt-hdr::-webkit-scrollbar{display:none}`}</style>
              <div className="sk-gtt-hdr" style={{height:'100%'}}>
                <TimelineHeader/>
              </div>
              {/* ── Top half: grab to scroll horizontally ──
                  Covers the Year + Quarter rows. Cursor = grab/grabbing.
                  Tooltip via title attr — browser shows it on hover. */}
              <div
                onMouseDown={startGanttScrollDrag}
                title="Drag to scroll the Gantt chart"
                style={{
                  position:'absolute', top:0, left:0, right:0,
                  height:Math.floor(HDR_H/2),
                  cursor:'grab', zIndex:10,
                }}
              />
              {/* ── Bottom half: drag to resize Gantt width ──
                  Covers the Month row. Cursor = zoom-in (magnifying glass). */}
              <div
                onMouseDown={startGanttWidthDrag}
                title="Drag to resize the Gantt chart width"
                style={{
                  position:'absolute', bottom:0, left:0, right:0,
                  height:Math.ceil(HDR_H/2),
                  cursor:'zoom-in', zIndex:10,
                }}
              />
            </div>

            {/* 3px brand gradient accent strip — mirrors table header */}
            <div style={{height:3,background:SK.grad,flexShrink:0}}/>

            {/* Scrollable Gantt body */}
            <div ref={ganttScrollRef}
              onScroll={()=>{
                if(gttHdrRef.current) gttHdrRef.current.scrollLeft=ganttScrollRef.current.scrollLeft
                if(tableScrollRef.current) tableScrollRef.current.scrollTop=ganttScrollRef.current.scrollTop
                // Update virtualisation window
                if (rafRef.current) cancelAnimationFrame(rafRef.current)
                rafRef.current = requestAnimationFrame(() => {
                  setScrollY(ganttScrollRef.current?.scrollTop ?? 0)
                })
              }}
              onMouseLeave={()=>setHoveredId(null)}
              style={{flex:1,overflowY:'auto',overflowX:'auto',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
              <svg width={ganttW} height={Math.max(sortedRows.length * (tweaks.rowHeight??rowHeight), 400)} style={{display:'block'}}>

                {/* Row backgrounds + dividers — virtualised to visible window only.
                    Full SVG height is preserved by the svg height attr so the scrollbar is correct. */}
                {(()=>{
                  const { startIdx, endIdx, rh } = virtWindow
                  const slice = sortedRows.slice(startIdx, endIdx + 1)
                  return (<>
                    {slice.map((row, li) => {
                      const ri = startIdx + li
                      const isWbs = row._type === 'wbs'
                      const stripeFill = tweaks.rowStripes ? (ri % 2 === 0 ? SK.card : SK.bg) : SK.card
                      const isSelected = !isWbs && selectedId === row.id
                      return <rect key={(row.id||ri)+'_bg'} x={0} y={ri*rh} width={ganttW} height={rh}
                        fill={isSelected?'#FEF9C3':(!isWbs&&isRecalculated&&row._recalc)?`${SK.peri}08`:stripeFill}/>
                    })}
                    {slice.map((_, li) => {
                      const ri = startIdx + li
                      return <line key={'rl'+ri} x1={0} y1={(ri+1)*rh-1} x2={ganttW} y2={(ri+1)*rh-1}
                        stroke={SK.border} strokeWidth={1} opacity={0.4}/>
                    })}
                  </>)
                })()}

                {/* Quarter vertical gridlines */}
                {timeline.quarters.map((q,i)=>(
                  <line key={'qg'+i} x1={q.x} y1={0} x2={q.x} y2={sortedRows.length*(tweaks.rowHeight??rowHeight)}
                    stroke={SK.border} strokeWidth={1} opacity={0.8}/>
                ))}




                {/* Relationship connectors — FS lines with arrowheads.
                    Rendered AFTER row bg but BEFORE bars so bars paint on top of line bodies.
                    The arrowhead sits at the bar start edge so it remains visible.
                    Only FS relationships are drawn (most common; SS/FF/SF skipped for clarity).
                    Routing: right-exit from pred bar end → vertical jog → left-entry to succ bar start.
                    Corner radius 4px on the jog bend for a clean look. */}
                {tweaks.showRelConnectors && (()=>{
                  const rh     = tweaks.rowHeight ?? rowHeight
                  const ms     = tweaks.milestoneSize ?? 7
                  const barH   = Math.max(6, Math.min(18, Math.round(rh * 0.46)))

                  // Build row index map AND task row map — both O(1) lookups
                  // Replaces sortedRows.find() which was O(n) per relationship = O(n*m) total
                  const rowIndexMap = {}
                  const taskRowMap  = {}
                  sortedRows.forEach((r, i) => {
                    rowIndexMap[r.id] = i
                    if (r._type === 'task') taskRowMap[r.id] = r
                  })

                  return fsRelationships
                    .map(rel => {
                      const predRow = taskRowMap[rel.from_id]
                      const succRow = taskRowMap[rel.to_id]
                      if (!predRow || !succRow) return null

                      const predRi = rowIndexMap[predRow.id]
                      const succRi = rowIndexMap[succRow.id]
                      if (predRi === undefined || succRi === undefined) return null

                      // Skip connectors where BOTH ends are outside the visible window.
                      // Connectors that span the window boundary are still drawn so
                      // the line is visible as it exits/enters the viewport.
                      const { startIdx, endIdx } = virtWindow
                      const predVisible = predRi >= startIdx && predRi <= endIdx
                      const succVisible = succRi >= startIdx && succRi <= endIdx
                      if (!predVisible && !succVisible) return null

                      // Source: right edge of pred bar (or right tip of milestone diamond)
                      const predIsMile = predRow.type === 'milestone' || predRow.rem_dur === 0
                      const srcX = predIsMile
                        ? toX(predRow.start) + ms
                        : toX(predRow.finish)
                      const srcY = predRi * rh + rh / 2

                      // Target: left edge of succ bar (or left tip of milestone diamond)
                      const succIsMile = succRow.type === 'milestone' || succRow.rem_dur === 0
                      const tgtX = succIsMile
                        ? toX(succRow.start) - ms
                        : toX(succRow.start)
                      const tgtY = succRi * rh + rh / 2

                      // Skip if both on same row or off-screen
                      if (predRi === succRi) return null
                      if (srcX < 0 && tgtX < 0) return null
                      if (srcX > ganttW && tgtX > ganttW) return null

                      // Is this a critical connection? Both pred AND succ critical, and highlight toggle on.
                      const isCrit = predRow.critical && succRow.critical && tweaks.criticalHighlight

                      // Orthogonal routing with 4px corner radius.
                      // Path ends exactly at tgtX (bar left edge / milestone left tip).
                      // refX=8 on the marker aligns the arrowhead tip with the path endpoint —
                      // the arrow body extends left into open space, pointing right toward the bar.
                      const CURVE   = 4
                      const midX    = Math.max(srcX + 8, tgtX - 8)
                      const goDown  = tgtY > srcY
                      const d = [
                        `M ${srcX} ${srcY}`,
                        `L ${midX - CURVE} ${srcY}`,
                        `Q ${midX} ${srcY} ${midX} ${srcY + (goDown ? CURVE : -CURVE)}`,
                        `L ${midX} ${tgtY + (goDown ? -CURVE : CURVE)}`,
                        `Q ${midX} ${tgtY} ${midX + CURVE} ${tgtY}`,
                        `L ${tgtX} ${tgtY}`,
                      ].join(' ')

                      const strokeCol = isCrit ? '#DC2626' : '#333333'
                      // null omits the attribute entirely — SVG strokeDasharray="none" is invalid
                      const dashArr   = isCrit ? null : '3 3'
                      const markerEnd = isCrit ? 'url(#arrow-critical)' : 'url(#arrow-normal)'

                      return (
                        <path key={`conn-${rel.from_id}-${rel.to_id}`}
                          d={d}
                          fill="none"
                          stroke={strokeCol}
                          strokeWidth={1}
                          strokeDasharray={dashArr}
                          markerEnd={markerEnd}
                          opacity={0.65}
                          style={{pointerEvents:'none'}}
                        />
                      )
                    })
                })()}

                {/* Activity bars — virtualised to visible window */}
                {(()=>{
                  const { startIdx, endIdx, rh } = virtWindow
                  return sortedRows.slice(startIdx, endIdx + 1).map((row, li) => {
                    const ri = startIdx + li
                    if(row._type==='wbs'&&!tweaks.showWbsBars) return null
                    const rowId = row.id||ri
                    return (
                      <g key={rowId+'_bar'}
                        onMouseEnter={()=>setHoveredId(rowId)}
                        onMouseLeave={()=>setHoveredId(null)}>
                        <GanttSvgBar row={row} y={ri*rh} isHov={hoveredId===rowId}/>
                      </g>
                    )
                  })
                })()}

                {/* As-of date line — rendered LAST so it paints on top of all bars */}
                {(()=>{
                  const x=toX(asOfDate.toISOString())
                  const totalH=sortedRows.length*(tweaks.rowHeight??rowHeight)
                  if(x<0||x>ganttW) return null
                  return (
                    <g>
                      <line x1={x} y1={0} x2={x} y2={totalH}
                        stroke={SK.cyan} strokeWidth={2} strokeDasharray="5 4" opacity={0.9}/>
                      <rect x={x+3} y={4} width={70} height={16} rx={3} fill={'#475569'} opacity={0.75}/>
                      <text x={x+7} y={15} fontSize={9} fill={'#ffffff'} fontFamily={SK.fMono} fontWeight={600}>As-of Date</text>
                    </g>
                  )
                })()}
              </svg>
            </div>
          </div>
        </div>

        {/* Relationship panel — header always visible; body opens/closes via chevron */}
        <RelPanel
          selectedAct={selectedAct} relationships={relationships} activities={activities}
          onGoTo={handleGoTo}
          onToggle={()=>setRelOpen(v=>!v)}
          isOpen={relOpen}
          height={relPanelH} onDragStart={startHDivider}
          dateFmt={dateFmt} durUnit={durUnit}
          tableFontSize={tableFontSize}
        />
      </div>

      {/* ── Customise panel — slides in from right ──────────────────────── */}
      {showCustomise&&(
        <div
          onMouseLeave={()=>setShowCustomise(false)}
          style={{position:'fixed',top:0,right:0,bottom:0,width:300,
            background:SK.card,borderLeft:`1px solid ${SK.border}`,
            boxShadow:'-4px 0 24px rgba(42,77,204,0.12)',zIndex:200,
            display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {/* Panel header */}
          <div style={{background:SK.header,padding:'12px 16px 10px',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontFamily:SK.fHead,fontWeight:700,fontSize:14,color:'#fff'}}>Customise SKOPIA Lens</span>
              <button onClick={()=>setShowCustomise(false)}
                style={{background:'none',border:'none',color:'rgba(255,255,255,0.5)',cursor:'pointer',fontSize:16,lineHeight:1,padding:2}}>✕</button>
            </div>
          </div>
          <div style={{height:3,background:SK.grad,flexShrink:0}}/>
          {/* Scrollable settings */}
          <div style={{flex:1,overflowY:'auto',padding:'12px 16px',scrollbarWidth:'thin',scrollbarColor:`${SK.border} transparent`}}>
            {/* Helper components defined inline */}
            {[
              { section:'ROWS', items:[
                { type:'slider', label:'Row height',          key:'rowHeight',    min:20, max:48, step:2 },
                { type:'slider', label:'Colour intensity',    key:'wbsIntensity', min:0, max:100, step:5, unit:'%' },
                { type:'radio',  label:'Colour scheme',       key:'barScheme',  options:[{v:'pastel',l:'Pastel'},{v:'vivid',l:'Vivid'}] },
                { type:'toggle', label:'Striped rows',        key:'rowStripes' },
                { type:'toggle', label:'Status icons in name',key:'showStatusIcons' },
              ]},
              { section:'GANTT BARS', items:[
                { type:'radio',  label:'Bar style',           key:'barStyle',   options:[{v:'filled',l:'Filled'},{v:'outline',l:'Outline'}] },
                { type:'slider', label:'Fill opacity',        key:'barOpacity', min:20, max:100, step:5, unit:'%' },
                { type:'slider', label:'Corner radius',       key:'barCornerRadius', min:0, max:8, step:1, unit:'px' },
                { type:'toggle', label:'Activity labels on bars', key:'showBarLabels' },
                { type:'toggle', label:'WBS summary bars',    key:'showWbsBars' },
                { type:'toggle', label:'Critical path highlight', key:'criticalHighlight' },
                { type:'slider', label:'Milestone size',      key:'milestoneSize', min:4, max:12, step:1, unit:'px' },
              ]},
              { section:'OVERLAYS', items:[
                { type:'toggle', label:'Show baseline bars',     key:'showBaselineBars' },
                { type:'toggle', label:'Relationship connectors',key:'showRelConnectors' },
              ]},

            ].map(({section,items})=>(
              <div key={section} style={{marginBottom:16}}>
                <div style={{fontFamily:SK.fHead,fontWeight:700,fontSize:10,
                  textTransform:'uppercase',letterSpacing:'0.07em',
                  color:SK.muted,marginBottom:8}}>{section}</div>
                {items.map(item=>(
                  <div key={item.key} style={{marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                      <span style={{fontFamily:SK.fBody,fontSize:13,color:SK.text}}>{item.label}</span>
                      {item.type==='toggle'&&(
                        <div onClick={()=>setTweak(item.key,!tweaks[item.key])}
                          style={{width:36,height:20,borderRadius:10,cursor:'pointer',
                            background:tweaks[item.key]?SK.peri:SK.border,
                            position:'relative',transition:'background 0.15s',flexShrink:0}}>
                          <div style={{position:'absolute',top:2,left:tweaks[item.key]?18:2,width:16,height:16,
                            borderRadius:8,background:'#fff',transition:'left 0.15s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
                        </div>
                      )}
                      {item.type==='slider'&&(
                        <span style={{fontFamily:SK.fMono,fontSize:11,color:SK.peri}}>
                          {tweaks[item.key]}{item.unit||''}
                        </span>
                      )}
                    </div>
                    {item.type==='slider'&&(
                      <input type="range" min={item.min} max={item.max} step={item.step}
                        value={tweaks[item.key]}
                        onChange={e=>setTweak(item.key,Number(e.target.value))}
                        style={{width:'100%',accentColor:SK.peri,cursor:'pointer',height:4}}/>
                    )}
                    {item.type==='radio'&&(
                      <div style={{display:'flex',gap:6}}>
                        {item.options.map(opt=>(
                          <div key={opt.v} onClick={()=>setTweak(item.key,opt.v)}
                            style={{flex:1,padding:'4px 0',textAlign:'center',
                              border:`1px solid ${tweaks[item.key]===opt.v?SK.peri:SK.border}`,
                              borderRadius:5,cursor:'pointer',fontSize:12,fontFamily:SK.fBody,
                              background:tweaks[item.key]===opt.v?`${SK.peri}14`:SK.card,
                              color:tweaks[item.key]===opt.v?SK.peri:SK.muted}}>
                            {opt.l}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tooltip renders inline in SVG via GanttTooltip — no floating div needed */}

      {/* Footer */}
      <div style={{flexShrink:0,height:22,background:SK.header,borderTop:`1px solid #334155`,display:'flex',alignItems:'center',padding:'0 12px',gap:16}}>
        <span style={{fontFamily:SK.fMono,fontSize:9,color:'#475569'}}>SKOPIA Lens · v0.9</span>
        <span style={{fontFamily:SK.fMono,fontSize:9,color:'#475569'}}>{visTaskCnt} activities visible</span>
        {filterText&&<span style={{fontFamily:SK.fMono,fontSize:9,color:SK.warn}}>Filter: "{filterText}"</span>}
        {selectedAct&&<span style={{fontFamily:SK.fMono,fontSize:9,color:SK.cyan,marginLeft:'auto'}}>Selected: {selectedAct.id}</span>}
      </div>
    </div>
  )
}
