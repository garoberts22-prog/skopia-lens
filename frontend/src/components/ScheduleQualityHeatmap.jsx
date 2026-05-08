// ── ScheduleQualityHeatmap.jsx ────────────────────────────────────────────────
//
// Acumen Fuse-style schedule quality heatmap.
// Rows = health check metrics, Columns = time periods (quarterly or monthly).
// Cells = coloured tiles showing metric value for that period.
// Click a tile → activity table below filters to that check + period.
//
// Ported directly from the SKOPIA_Lens.html prototype LogicDensityHeatmap.
//
// Props:
//   analysis  object — full API response. Uses:
//     analysis.schedule_data.activities[]  — id, name, wbs_name, start, finish,
//                                            total_float, orig_dur, type, status,
//                                            cstr_type
//     analysis.schedule_data.relationships[] — from_id, to_id
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react'

const SK = {
  pass: '#16A34A', warn: '#D97706', fail: '#DC2626', info: '#2563EB',
  peri: '#4A6FE8', cyan: '#1EC8D4', text: '#1A1A2E', muted: '#6B7280',
  border: '#E2E6F0', bg: '#F7F8FC', card: '#FFFFFF',
}

const MONTH_ABBR = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const PAGE_SIZE = 50

// ── Cell colour map ───────────────────────────────────────────────────────────
function cellStyle(status, isSelected) {
  const base = {
    pass: { bg: '#DCFCE7', border: '#16A34A', text: '#15803D', selBg: '#BBF7D0' },
    warn: { bg: '#FEF3C7', border: '#D97706', text: '#B45309', selBg: '#FDE68A' },
    fail: { bg: '#FEE2E2', border: '#DC2626', text: '#B91C1C', selBg: '#FECACA' },
    info: { bg: '#DBEAFE', border: '#2563EB', text: '#1D4ED8', selBg: '#BFDBFE' },
  }[status] ?? { bg: SK.bg, border: SK.border, text: SK.muted, selBg: SK.bg }

  return {
    background: isSelected ? base.selBg : base.bg,
    border:     `1.5px solid ${isSelected ? base.border : base.border + '55'}`,
    color:      base.text,
    boxShadow:  isSelected ? `0 0 0 2px ${base.border}` : 'none',
  }
}

// ── Row definitions — each mirrors the corresponding backend check ─────────────
// compute(periodTasks, predMap, succMap, preds) → { value, raw, status, flaggedIds[] }
const ROWS = [
  {
    id: 'missing_logic', label: 'Missing Logic', dcma: '#1',
    compute(periodTasks, predMap, succMap) {
      const flagged = []
      periodTasks.forEach(t => {
        const hasPred = (predMap[t.id] ?? []).length > 0
        const hasSucc = (succMap[t.id] ?? []).length > 0
        const isStartMile  = t.type === 'milestone' && /^(start|begin|kick)/i.test(t.name ?? '')
        const isFinishMile = t.type === 'milestone' && /^(finish|end|complete|handover)/i.test(t.name ?? '')
        if (!hasPred && !isStartMile)  flagged.push(t)
        else if (!hasSucc && !isFinishMile) flagged.push(t)
      })
      const pct = periodTasks.length > 0 ? Math.round((flagged.length / periodTasks.length) * 100) : 0
      return {
        value: pct + '%', raw: pct,
        status: pct === 0 ? 'pass' : pct <= 5 ? 'warn' : 'fail',
        flaggedIds: flagged.map(t => t.id),
      }
    },
  },
  {
    id: 'logic_density', label: 'Logic Density', dcma: null,
    compute(periodTasks, predMap, succMap, allPreds) {
      const incIds   = new Set(periodTasks.map(t => t.id))
      const relCount = allPreds.filter(p => incIds.has(p.from_id) || incIds.has(p.to_id)).length
      const ratio    = periodTasks.length > 0 ? relCount / periodTasks.length : 0
      const rnd      = Math.round(ratio * 100) / 100
      const flagged  = periodTasks.filter(t => {
        const fi = (predMap[t.id] ?? []).length
        const fo = (succMap[t.id] ?? []).length
        return fi + fo >= 5
      })
      const status = ratio < 0.5 ? 'fail' : ratio <= 4.0 ? 'pass' : 'warn'
      return {
        value: rnd.toFixed(2), raw: rnd, status,
        flaggedIds: flagged.map(t => t.id),
      }
    },
  },
  {
    id: 'hard_constraints', label: 'Hard Constraints', dcma: '#5',
    compute(periodTasks) {
      const hard    = new Set(['MSO','MFO','FNLT','SNLT','CS_MSO','CS_MFO','CS_FNLT','CS_SNLT','CS_MANDSTART','CS_MANDFIN'])
      const flagged = periodTasks.filter(t => t.cstr_type && hard.has(t.cstr_type))
      const pct     = periodTasks.length > 0 ? Math.round((flagged.length / periodTasks.length) * 100) : 0
      return {
        value: pct + '%', raw: pct,
        status: pct === 0 ? 'pass' : pct <= 5 ? 'warn' : 'fail',
        flaggedIds: flagged.map(t => t.id),
      }
    },
  },
  {
    id: 'high_float', label: 'High Float', dcma: '#6',
    compute(periodTasks) {
      const withFloat = periodTasks.filter(t => t.total_float != null)
      const flagged   = withFloat.filter(t => t.total_float > 44)
      const pct       = withFloat.length > 0 ? Math.round((flagged.length / withFloat.length) * 100) : 0
      return {
        value: pct + '%', raw: pct,
        status: pct === 0 ? 'pass' : pct <= 5 ? 'warn' : 'fail',
        flaggedIds: flagged.map(t => t.id),
      }
    },
  },
  {
    id: 'neg_float', label: 'Negative Float', dcma: '#7',
    compute(periodTasks) {
      const withFloat = periodTasks.filter(t => t.total_float != null)
      const flagged   = withFloat.filter(t => t.total_float < 0)
      const pct       = withFloat.length > 0 ? Math.round((flagged.length / withFloat.length) * 100) : 0
      return {
        value: pct + '%', raw: pct,
        status: flagged.length === 0 ? 'pass' : 'fail',
        flaggedIds: flagged.map(t => t.id),
      }
    },
  },
  {
    id: 'long_duration', label: 'Long Duration', dcma: '#8',
    compute(periodTasks) {
      const nonMile = periodTasks.filter(t => t.type !== 'milestone')
      const flagged = nonMile.filter(t => t.orig_dur != null && t.orig_dur > 44)
      const pct     = nonMile.length > 0 ? Math.round((flagged.length / nonMile.length) * 100) : 0
      return {
        value: pct + '%', raw: pct,
        status: pct <= 5 ? 'pass' : pct <= 10 ? 'warn' : 'fail',
        flaggedIds: flagged.map(t => t.id),
      }
    },
  },
  {
    id: 'near_critical', label: 'Near-Critical', dcma: '#13',
    compute(periodTasks) {
      const withFloat = periodTasks.filter(t => t.total_float != null)
      const flagged   = withFloat.filter(t => t.total_float >= 0 && t.total_float <= 20)
      const pct       = withFloat.length > 0 ? Math.round((flagged.length / withFloat.length) * 100) : 0
      return {
        value: pct + '%', raw: pct, status: 'info',
        flaggedIds: flagged.map(t => t.id),
      }
    },
  },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function ScheduleQualityHeatmap({ analysis }) {
  const [granularity,  setGranularity]  = useState('quarter')
  const [selectedCell, setSelectedCell] = useState(null)   // { rowId, period } | null
  const [detailPage,   setDetailPage]   = useState(0)

  // ── Extract activities + relationships from schedule_data ─────────────────
  // The API response includes schedule_data.activities[] and .relationships[]
  // which have full per-activity detail needed for per-period computation.
  const allActivities   = analysis?.schedule_data?.activities   ?? []
  const allRelationships= analysis?.schedule_data?.relationships ?? []

  // Filter to incomplete non-summary tasks only
  const incomplete = useMemo(() =>
    allActivities.filter(t => t.type !== 'summary' && t.status !== 'Complete'),
    [allActivities]
  )

  // Build predecessor/successor maps keyed by activity id
  const { predMap, succMap } = useMemo(() => {
    const pm = {}, sm = {}
    incomplete.forEach(t => { pm[t.id] = []; sm[t.id] = [] })
    allRelationships.forEach(r => {
      if (pm[r.to_id]   !== undefined) pm[r.to_id].push(r)
      if (sm[r.from_id] !== undefined) sm[r.from_id].push(r)
    })
    return { predMap: pm, succMap: sm }
  }, [incomplete, allRelationships])

  // ── Period helpers ─────────────────────────────────────────────────────────
  function periodKey(dateStr) {
    if (!dateStr) return null
    const yr = dateStr.substring(0, 4)
    const mo = parseInt(dateStr.substring(5, 7))
    if (granularity === 'month') return dateStr.substring(0, 7)
    return `${yr}-Q${Math.ceil(mo / 3)}`
  }

  function periodLabel(key) {
    if (!key) return ''
    if (granularity === 'month') {
      const mo = parseInt(key.substring(5, 7))
      return MONTH_ABBR[mo] + ' ' + key.substring(0, 4)
    }
    // Quarter: "2026-Q3" → "2026 Q3"
    return key.replace('-', ' ')
  }

  // Build sorted unique periods from task start dates
  const periods = useMemo(() => {
    const set = new Set()
    incomplete.forEach(t => { const k = periodKey(t.start); if (k) set.add(k) })
    return [...set].sort()
  }, [incomplete, granularity]) // eslint-disable-line react-hooks/exhaustive-deps

  // Map each task to its period
  const taskPeriod = useMemo(() => {
    const map = {}
    incomplete.forEach(t => { map[t.id] = periodKey(t.start) })
    return map
  }, [incomplete, granularity]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pre-compute all cells ──────────────────────────────────────────────────
  const cells = useMemo(() => {
    const c = {}
    ROWS.forEach(row => {
      c[row.id] = {}
      periods.forEach(p => {
        const periodTasks = incomplete.filter(t => taskPeriod[t.id] === p)
        c[row.id][p] = row.compute(periodTasks, predMap, succMap, allRelationships)
      })
    })
    return c
  }, [periods, incomplete, taskPeriod, predMap, succMap, allRelationships])

  // Row total = unique flagged activities across all periods
  function rowTotal(rowId) {
    const seen = new Set()
    periods.forEach(p => { (cells[rowId]?.[p]?.flaggedIds ?? []).forEach(id => seen.add(id)) })
    return seen.size
  }

  // ── Selected cell → activity table ────────────────────────────────────────
  const selCell  = selectedCell ? cells[selectedCell.rowId]?.[selectedCell.period] : null
  const selRow   = selectedCell ? ROWS.find(r => r.id === selectedCell.rowId) : null
  const selTasks = selCell
    ? incomplete.filter(t => new Set(selCell.flaggedIds).has(t.id))
    : []
  const totalPages  = Math.ceil(selTasks.length / PAGE_SIZE)
  const tableSlice  = selTasks.slice(detailPage * PAGE_SIZE, (detailPage + 1) * PAGE_SIZE)

  // ── Fallback: no date data ─────────────────────────────────────────────────
  if (!periods.length) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: SK.muted, fontFamily: 'var(--font-body)', fontSize: 13 }}>
        No date data available to build heatmap.
      </div>
    )
  }

  // Column width — dynamic, capped between 52–72px
  const LABEL_W = 148
  const CELL_W  = Math.max(52, Math.min(72, Math.floor((window.innerWidth * 0.75 - LABEL_W - 80) / Math.max(periods.length, 1))))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderTop: `1px solid #E2E6F0` }}>

      {/* ── Granularity + legend controls ───────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px', borderBottom: `1px solid ${SK.border}`,
        flexShrink: 0, background: SK.bg,
      }}>
        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: SK.muted }}>
          Granularity
        </span>

        {/* Quarterly / Monthly toggle buttons */}
        {['quarter', 'month'].map(g => (
          <button
            key={g}
            onClick={() => { setGranularity(g); setSelectedCell(null); setDetailPage(0) }}
            style={{
              padding: '4px 12px', fontSize: 11,
              fontFamily: 'var(--font-head)', fontWeight: 700, borderRadius: 5,
              border: `1.5px solid ${granularity === g ? SK.peri : SK.border}`,
              background: granularity === g ? SK.peri : '#fff',
              color: granularity === g ? '#fff' : SK.muted,
              cursor: 'pointer',
            }}
          >
            {g === 'quarter' ? 'Quarterly' : 'Monthly'}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {/* Status legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {[['pass', SK.pass, 'Pass'], ['warn', SK.warn, 'Warn'], ['fail', SK.fail, 'Fail'], ['info', SK.info, 'Info']].map(([s, c, l]) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: c + '22', border: `1.5px solid ${c}55` }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: SK.muted }}>{l}</span>
            </div>
          ))}
        </div>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: SK.muted, marginLeft: 8 }}>
          Click any tile to filter activities below
        </span>
      </div>

      {/* ── Heatmap grid ────────────────────────────────────────────────────── */}
      <div style={{ overflowX: 'auto', flexShrink: 0, background: SK.card }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ background: SK.bg }}>
              {/* Sticky label column header */}
              <th style={{
                width: LABEL_W, padding: '7px 14px', textAlign: 'left',
                fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9,
                textTransform: 'uppercase', letterSpacing: '0.07em', color: SK.muted,
                borderBottom: `2px solid ${SK.border}`, borderRight: `2px solid ${SK.border}`,
                whiteSpace: 'nowrap', position: 'sticky', left: 0, background: SK.bg, zIndex: 2,
              }}>
                Check / Period
              </th>

              {/* Period column headers */}
              {periods.map(p => (
                <th key={p} style={{
                  width: CELL_W, padding: '6px 4px', textAlign: 'center',
                  fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9, color: SK.muted,
                  borderBottom: `2px solid ${SK.border}`, borderRight: `1px solid ${SK.border}66`,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {periodLabel(p)}
                </th>
              ))}

              {/* Total column header */}
              <th style={{
                width: 60, padding: '6px 4px', textAlign: 'center',
                fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9, color: SK.muted,
                borderBottom: `2px solid ${SK.border}`, borderLeft: `2px solid ${SK.border}`,
              }}>
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {ROWS.map((row, ri) => (
              <tr key={row.id} style={{ background: ri % 2 === 0 ? '#fff' : SK.bg + '88' }}>
                {/* Sticky row label */}
                <td style={{
                  padding: '6px 14px',
                  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: SK.text,
                  borderBottom: `1px solid ${SK.border}`, borderRight: `2px solid ${SK.border}`,
                  whiteSpace: 'nowrap', position: 'sticky', left: 0,
                  background: ri % 2 === 0 ? '#fff' : SK.bg, zIndex: 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {row.label}
                    {row.dcma && (
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 9, color: SK.muted,
                        background: SK.bg, border: `1px solid ${SK.border}`,
                        borderRadius: 3, padding: '0 4px', flexShrink: 0,
                      }}>
                        {row.dcma}
                      </span>
                    )}
                  </div>
                </td>

                {/* Data cells */}
                {periods.map(p => {
                  const cell  = cells[row.id][p]
                  const isSel = selectedCell?.rowId === row.id && selectedCell?.period === p
                  const cs    = cellStyle(cell.status, isSel)
                  const periodTasks = incomplete.filter(t => taskPeriod[t.id] === p)

                  return (
                    <td key={p} style={{
                      padding: '3px',
                      borderBottom: `1px solid ${SK.border}`,
                      borderRight: `1px solid ${SK.border}44`,
                      textAlign: 'center',
                    }}>
                      <div
                        onClick={() => {
                          if (isSel) { setSelectedCell(null) }
                          else { setSelectedCell({ rowId: row.id, period: p }); setDetailPage(0) }
                        }}
                        title={`${row.label} — ${periodLabel(p)}\n${cell.value} | ${cell.flaggedIds.length} flagged of ${periodTasks.length} tasks`}
                        style={{
                          ...cs, borderRadius: 5, padding: '5px 4px',
                          cursor: 'pointer', transition: 'box-shadow 0.12s',
                          userSelect: 'none',
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          minHeight: 36,
                        }}
                      >
                        {/* Primary value — metric % or ratio */}
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, lineHeight: 1 }}>
                          {cell.value}
                        </div>
                        {/* Flagged count — shown when > 0 */}
                        {cell.flaggedIds.length > 0 && (
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, opacity: 0.7, marginTop: 2 }}>
                            {cell.flaggedIds.length}
                          </div>
                        )}
                      </div>
                    </td>
                  )
                })}

                {/* Row total */}
                <td style={{
                  padding: '3px 6px',
                  borderBottom: `1px solid ${SK.border}`,
                  borderLeft: `2px solid ${SK.border}`,
                  textAlign: 'center',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12,
                    color: rowTotal(row.id) > 0 ? SK.fail : SK.pass,
                  }}>
                    {rowTotal(row.id)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Activity table — filtered by selected cell ─────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, borderTop: `2px solid ${SK.border}` }}>
        {selectedCell && selRow ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

            {/* Filter bar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 20px 8px',
              background: SK.bg, borderBottom: `1px solid ${SK.border}`,
              flexShrink: 0, position: 'sticky', top: 0, zIndex: 2,
            }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: cellStyle(selCell?.status).color ?? SK.peri }} />
              <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, color: SK.text }}>
                {selRow.label}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: SK.muted,
                background: SK.bg, border: `1px solid ${SK.border}`,
                borderRadius: 4, padding: '1px 7px',
              }}>
                {periodLabel(selectedCell.period)}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted, marginLeft: 4 }}>
                {selTasks.length} {selTasks.length === 1 ? 'activity' : 'activities'}
              </span>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => { setSelectedCell(null); setDetailPage(0) }}
                style={{
                  fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
                  padding: '3px 10px', borderRadius: 4,
                  border: `1px solid ${SK.border}`, background: '#fff',
                  color: SK.muted, cursor: 'pointer',
                }}
              >
                Clear filter ✕
              </button>
            </div>

            {/* Table */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
              {selTasks.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: SK.pass, fontFamily: 'var(--font-body)', fontSize: 13 }}>
                  ✓ No flagged activities in this period.
                </div>
              ) : (
                <>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: SK.bg }}>
                        {['Activity ID', 'Name', 'WBS', 'Start', 'Finish', 'Float', 'Type', 'Severity'].map(h => (
                          <th key={h} style={{
                            padding: '7px 10px', textAlign: 'left',
                            fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9,
                            textTransform: 'uppercase', letterSpacing: '0.05em', color: SK.muted,
                            borderBottom: `2px solid ${SK.border}`,
                            position: 'sticky', top: 0, background: SK.bg, zIndex: 1,
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableSlice.map((t, i) => {
                        const floatVal = t.total_float
                        const floatCol = floatVal == null ? SK.muted
                          : floatVal < 0 ? SK.fail
                          : floatVal === 0 ? SK.fail
                          : floatVal <= 20 ? SK.warn
                          : SK.pass

                        // Severity heuristic — row-aware
                        let sev = 'medium'
                        if (selectedCell.rowId === 'neg_float' || (selectedCell.rowId === 'high_float' && floatVal > 88)) {
                          sev = 'high'
                        } else if (selectedCell.rowId === 'missing_logic') {
                          const hp = (predMap[t.id] ?? []).length
                          const hs = (succMap[t.id] ?? []).length
                          if (!hp && !hs) sev = 'high'
                        }
                        const sevCol = sev === 'high' ? SK.fail : SK.warn

                        return (
                          <tr key={t.id} style={{ borderBottom: `1px solid ${SK.border}`, background: i % 2 === 0 ? '#fff' : SK.bg }}>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.peri, whiteSpace: 'nowrap' }}>
                              {t.id}
                            </td>
                            <td style={{ padding: '6px 10px', color: SK.text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={t.name}>
                              {t.name}
                            </td>
                            <td style={{ padding: '6px 10px', color: SK.muted, fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={t.wbs_name}>
                              {t.wbs_name ?? '—'}
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted, whiteSpace: 'nowrap' }}>
                              {t.start ? t.start.substring(0, 10) : '—'}
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted, whiteSpace: 'nowrap' }}>
                              {t.finish ? t.finish.substring(0, 10) : '—'}
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: floatCol }}>
                              {floatVal != null ? floatVal + 'd' : '—'}
                            </td>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, color: SK.muted, textTransform: 'uppercase' }}>
                              {t.type === 'milestone' ? 'Mile' : 'Task'}
                            </td>
                            <td style={{ padding: '6px 10px' }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: sevCol, textTransform: 'uppercase' }}>
                                {sev}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 0', borderTop: `1px solid ${SK.border}`, background: SK.bg }}>
                      <button
                        disabled={detailPage === 0}
                        onClick={() => setDetailPage(p => p - 1)}
                        style={{ fontFamily: 'var(--font-head)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 4, border: `1px solid ${SK.border}`, background: '#fff', cursor: detailPage === 0 ? 'default' : 'pointer', color: detailPage === 0 ? SK.border : SK.text }}
                      >
                        Prev
                      </button>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted }}>
                        {detailPage + 1} / {totalPages}
                      </span>
                      <button
                        disabled={detailPage >= totalPages - 1}
                        onClick={() => setDetailPage(p => p + 1)}
                        style={{ fontFamily: 'var(--font-head)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 4, border: `1px solid ${SK.border}`, background: '#fff', cursor: detailPage >= totalPages - 1 ? 'default' : 'pointer', color: detailPage >= totalPages - 1 ? SK.border : SK.text }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        ) : (
          // Empty state — no cell selected yet
          <div style={{ padding: '24px 20px', textAlign: 'center', color: SK.muted, fontFamily: 'var(--font-body)', fontSize: 12 }}>
            ↑ Click any coloured tile above to view flagged activities for that check and period
          </div>
        )}
      </div>
    </div>
  )
}
