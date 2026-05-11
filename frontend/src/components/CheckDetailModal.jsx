// ── CheckDetailModal.jsx ──────────────────────────────────────────────────────
//
// Modal that opens when a check card is clicked.
// Renders check-specific content:
//   - relationship_types → donut chart
//   - high_float / negative_float → float histogram (horizontal bars)
//   - logic_density / bottlenecks → heatmap grid
//   - all others → flagged activities table (or "no issues" state)
//
// PROPS:
//   check    object  — the check object from analysis.checks[]
//   analysis object  — full API response (for histogram bins, rel breakdown etc)
//   onClose  fn      — called when Close is clicked or backdrop clicked
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import LongestPathWaterfall    from './LongestPathWaterfall'
import ScheduleQualityHeatmap  from './ScheduleQualityHeatmap'

const SK = {
  pass: '#16A34A', warn: '#D97706', fail: '#DC2626', info: '#2563EB',
  peri: '#4A6FE8', cyan: '#1EC8D4', muted: '#6B7280', text: '#1A1A2E',
  border: '#E2E6F0', bg: '#F7F8FC', card: '#FFFFFF', header: '#1E1E1E',
}

// Severity colour helpers
const sevColour = (s) =>
  s === 'high' ? SK.fail : s === 'medium' ? SK.warn : SK.muted

const statusColour = (s) =>
  ({ pass: SK.pass, warn: SK.warn, fail: SK.fail, info: SK.peri }[s] ?? SK.muted)

const statusBg = (s) =>
  ({ pass: '#DCFCE7', warn: '#FEF3C7', fail: '#FEE2E2', info: '#DBEAFE' }[s] ?? SK.bg)

const statusIcon = (s) =>
  ({ pass: '✓', warn: '⚠', fail: '✕', info: 'ℹ' }[s] ?? '?')

// ── Horizontal float histogram (used by high_float + negative_float) ──────────
function FloatHistogram({ bins }) {
  if (!bins?.length) return null
  const maxCount = Math.max(...bins.map(b => b.count), 1)
  const barColour = { critical: SK.fail, high: '#EF4444', neutral: SK.peri, low: SK.pass, medium: SK.warn, warn: '#F59E0B' }

  return (
    <div style={{ padding: '16px 20px', borderBottom: `1px solid ${SK.border}` }}>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted, marginBottom: 10 }}>
        Float Distribution
      </div>
      {bins.map(bin => (
        <div key={bin.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
          <div style={{ width: 64, fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted, textAlign: 'right', flexShrink: 0 }}>
            {bin.label}
          </div>
          <div style={{ flex: 1, height: 18, background: SK.bg, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${(bin.count / maxCount) * 100}%`,
              height: '100%',
              background: barColour[bin.severity] ?? SK.peri,
              borderRadius: 3,
              minWidth: bin.count > 0 ? 4 : 0,
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ width: 32, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: bin.count > 0 ? SK.text : SK.border, textAlign: 'right', flexShrink: 0 }}>
            {bin.count}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Relationship donut (used by relationship_types) ───────────────────────────
function RelDonut({ breakdown }) {
  if (!breakdown) return null
  const { FS = 0, SS = 0, FF = 0, SF = 0 } = breakdown
  const total = FS + SS + FF + SF
  if (total === 0) return null

  const entries = [['FS', FS, SK.peri], ['SS', SS, SK.cyan], ['FF', FF, '#8B5CF6'], ['SF', SF, SK.fail]].filter(e => e[1] > 0)

  // SVG donut — manual arc segments
  const R = 50, CX = 60, CY = 60, STROKE = 18
  const circ = 2 * Math.PI * R
  let offset = 0
  const segments = entries.map(([type, count, colour]) => {
    const pct = count / total
    const seg = { type, count, colour, pct, offset }
    offset += pct
    return seg
  })

  return (
    <div style={{ padding: '16px 20px', borderBottom: `1px solid ${SK.border}`, display: 'flex', gap: 24, alignItems: 'center' }}>
      {/* SVG donut */}
      <svg width={120} height={120} viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke={SK.border} strokeWidth={STROKE} />
        {segments.map(seg => (
          <circle key={seg.type} cx={CX} cy={CY} r={R} fill="none"
            stroke={seg.colour} strokeWidth={STROKE}
            strokeDasharray={`${seg.pct * circ} ${circ}`}
            strokeDashoffset={-seg.offset * circ}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        ))}
        <text x={CX} y={CY - 4} textAnchor="middle" dominantBaseline="middle"
          fontSize={14} fontWeight={700} fontFamily="'JetBrains Mono',monospace" fill={SK.text}>
          {total}
        </text>
        <text x={CX} y={CY + 12} textAnchor="middle" dominantBaseline="middle"
          fontSize={9} fontFamily="'Open Sans',sans-serif" fill={SK.muted}>
          total
        </text>
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map(([type, count, colour]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: colour, flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: SK.text, fontWeight: 700, width: 24 }}>{type}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: SK.muted }}>
              {count.toLocaleString()} ({total > 0 ? Math.round(count / total * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main modal component ───────────────────────────────────────────────────────
export default function CheckDetailModal({ check, analysis, onClose }) {
  const [page, setPage] = useState(0)
  const pageSize = 50

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!check) return null

  const sc     = statusColour(check.status)
  const sbg    = statusBg(check.status)
  const si     = statusIcon(check.status)

  const flagged     = check.flagged_items ?? []
  const totalPages  = Math.ceil(flagged.length / pageSize)
  const pageSlice   = flagged.slice(page * pageSize, (page + 1) * pageSize)

  const isRelTypes   = check.check_id === 'relationship_types'
  const isFloat      = ['high_float', 'negative_float'].includes(check.check_id)
  const isBottleneck = check.check_id === 'bottlenecks'
  const isHeatmap    = check.check_id === 'logic_density'
  const isCpLength   = check.check_id === 'cp_length'

  // Bottleneck top-10 from network_metrics
  const topBottlenecks = analysis?.network_metrics?.top_bottlenecks ?? []

  return (
    // Backdrop — click to close
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26,26,46,0.65)',
        backdropFilter: 'blur(3px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      {/* Modal card — stop propagation so clicking inside doesn't close */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: SK.card,
          borderRadius: 12,
          boxShadow: '0 16px 56px rgba(42,77,204,0.25)',
          width: '75vw',
          maxWidth: '100%',
          maxHeight: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Modal header ──────────────────────────────────────────────────── */}
        <div style={{ background: SK.header, padding: '14px 20px 12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            {/* Status icon */}
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: sbg, color: sc, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, flexShrink: 0, marginTop: 1,
            }}>
              {si}
            </div>
            {/* Name + description */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 15, color: '#fff' }}>
                  {check.check_name}
                </span>
                {check.dcma_ref && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                    {check.dcma_ref}
                  </span>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
                {check.description}
              </div>
            </div>
            {/* Metric + status badge */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {check.metric_value != null && (
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18, color: sc }}>
                  {typeof check.metric_value === 'number'
                    ? (check.metric_value % 1 === 0 ? check.metric_value : check.metric_value.toFixed(1))
                    : check.metric_value}
                  {check.metric_label?.includes('%') ? '%' : ''}
                </div>
              )}
              {check.threshold_value != null && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                  threshold: {check.threshold_value}{check.metric_label?.includes('%') ? '%' : ''}
                </div>
              )}
              <span style={{
                fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
                background: sbg, color: sc,
                borderRadius: 4, padding: '2px 8px',
                textTransform: 'uppercase',
              }}>
                {check.status}
              </span>
            </div>
          </div>
        </div>

        {/* Cyan accent strip */}
        <div style={{ height: 2, background: 'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)', flexShrink: 0 }} />

        {/* ── Modal body — scrollable ────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

          {/* Recommendation */}
          {check.recommendation && (
            <div style={{ padding: '10px 20px', borderBottom: `1px solid ${SK.border}`, background: '#f0fdf4' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, color: SK.pass }}>
                Recommendation:
              </span>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#166534', marginLeft: 6 }}>
                {check.recommendation}
              </span>
            </div>
          )}

          {/* Relationship types donut */}
          {isRelTypes && <RelDonut breakdown={analysis?.relationship_breakdown} />}

          {/* Float histogram */}
          {isFloat && <FloatHistogram bins={analysis?.float_histogram?.bins} />}

          {/* Bottleneck top-10 table — uses network_metrics.top_bottlenecks */}
          {isBottleneck && topBottlenecks.length > 0 && (
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${SK.border}` }}>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted, marginBottom: 10 }}>
                Top {topBottlenecks.length} Bottleneck Activities (by Fan-In × Fan-Out Score)
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${SK.border}` }}>
                      {['Activity ID', 'Name', 'Fan-In', 'Fan-Out', 'Score', 'Float', 'Critical'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: SK.muted, whiteSpace: 'nowrap' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topBottlenecks.map((b, i) => (
                      <tr key={`${b.id}-${i}`} style={{ borderBottom: `1px solid ${SK.border}`, background: i % 2 === 0 ? 'transparent' : SK.bg }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.peri, whiteSpace: 'nowrap' }}>{b.id}</td>
                        <td style={{ padding: '6px 10px', color: SK.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.text, textAlign: 'center' }}>{b.fan_in}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.text, textAlign: 'center' }}>{b.fan_out}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: b.score >= 12 ? SK.fail : b.score >= 6 ? SK.warn : SK.muted, textAlign: 'center' }}>{b.score}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: b.float_days === 0 ? SK.fail : SK.muted, textAlign: 'center' }}>
                          {b.float_days != null ? `${b.float_days}d` : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                          {b.is_critical
                            ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: SK.fail }}>CP</span>
                            : <span style={{ color: SK.border }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Logic density heatmap */}
          {isHeatmap && (
            <ScheduleQualityHeatmap analysis={analysis} />
          )}

          {/* Longest path waterfall — shown for CP Length check */}
          {isCpLength && (
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${SK.border}` }}>
              <LongestPathWaterfall longestPath={analysis?.longest_path} />
            </div>
          )}

          {/* Flagged items table */}
          {pageSlice.length > 0 && (
            <div style={{ padding: '16px 20px' }}>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted, marginBottom: 10 }}>
                Flagged Activities ({flagged.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${SK.border}` }}>
                      {['Activity ID', 'Name', 'WBS', 'Issue', 'Severity'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: SK.muted }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice.map((item, i) => (
                      <tr key={`${item.activity_id}-${i}`} style={{ borderBottom: `1px solid ${SK.border}`, background: i % 2 === 0 ? 'transparent' : SK.bg }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.peri, whiteSpace: 'nowrap' }}>{item.activity_id}</td>
                        <td style={{ padding: '6px 10px', color: SK.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.activity_name}</td>
                        <td style={{ padding: '6px 10px', color: SK.muted, fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.wbs_path ?? '—'}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.text }}>{item.issue_type}</td>
                        <td style={{ padding: '6px 10px' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: sevColour(item.severity), textTransform: 'uppercase' }}>
                            {item.severity}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ fontFamily: 'var(--font-head)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 4, border: `1px solid ${SK.border}`, background: SK.bg, color: page === 0 ? SK.border : SK.text, cursor: page === 0 ? 'default' : 'pointer' }}>Prev</button>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted }}>{page + 1} / {totalPages}</span>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} style={{ fontFamily: 'var(--font-head)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 4, border: `1px solid ${SK.border}`, background: SK.bg, color: page >= totalPages - 1 ? SK.border : SK.text, cursor: page >= totalPages - 1 ? 'default' : 'pointer' }}>Next</button>
                </div>
              )}
            </div>
          )}

          {/* No issues state */}
          {!isHeatmap && !isBottleneck && flagged.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14, color: SK.pass, marginBottom: 4 }}>No issues found</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: SK.muted }}>
                {check.population_count} activities checked — all clear.
              </div>
            </div>
          )}
        </div>

        {/* ── Modal footer ─────────────────────────────────────────────────── */}
        <div style={{ padding: '10px 20px', borderTop: `1px solid ${SK.border}`, background: SK.bg, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, background: SK.header, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 20px', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
