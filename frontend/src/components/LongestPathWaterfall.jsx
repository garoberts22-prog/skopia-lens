// ── LongestPathWaterfall.jsx ──────────────────────────────────────────────────
//
// Horizontal waterfall / Gantt of the longest (critical) path.
// Custom SVG — no Recharts needed.
//
// API field: longest_path[]
//   Each item: { id, name, start, finish, duration_days, float_days, is_milestone }
//
// Layout:
//   - Activity name column (left, fixed 200px)
//   - SVG bars (right, horizontally scrollable)
//   - Date axis at bottom
//   - Milestones = diamonds ◆, tasks = rounded bars
//   - Bars are SKOPIA fail colour (critical path = zero float)
//
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useState } from 'react'

const SK = {
  fail: '#DC2626', peri: '#4A6FE8', text: '#1A1A2E',
  muted: '#6B7280', border: '#E2E6F0', bg: '#F7F8FC', card: '#FFFFFF',
}

const ROW_H    = 28   // px per activity row
const BAR_H    = 14   // bar height inside the row
const AXIS_H   = 28   // bottom date axis height
const PAD_L    = 8    // left padding inside chart area
const PAD_R    = 16   // right padding

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function LongestPathWaterfall({ longestPath }) {
  const scrollRef = useRef(null)

  if (!longestPath?.length) return null

  // Parse dates — filter out items with no valid dates
  const items = longestPath.map(item => ({
    ...item,
    startDate:  item.start  ? new Date(item.start)  : null,
    finishDate: item.finish ? new Date(item.finish) : null,
  })).filter(item => item.startDate && item.finishDate)

  if (!items.length) return null

  // Date range across all items
  const minDate = new Date(Math.min(...items.map(i => i.startDate)))
  const maxDate = new Date(Math.max(...items.map(i => i.finishDate)))
  const totalMs = maxDate - minDate || 1

  // Chart dimensions
  const chartWidth  = Math.max(600, Math.min(1400, items.length * 40 + 100))
  const chartHeight = items.length * ROW_H + AXIS_H

  // Map a date to an X position within the chart
  function dateToX(date) {
    return PAD_L + ((date - minDate) / totalMs) * (chartWidth - PAD_L - PAD_R)
  }

  // Build date axis ticks — aim for ~6 evenly spaced labels
  function buildAxisTicks() {
    const ticks = []
    const count = Math.min(6, items.length)
    for (let i = 0; i <= count; i++) {
      const d = new Date(minDate.getTime() + (i / count) * totalMs)
      ticks.push({ date: d, x: dateToX(d) })
    }
    return ticks
  }
  const axisTicks = buildAxisTicks()

  return (
    <div style={{
      background: SK.card, border: `1px solid ${SK.border}`,
      borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${SK.border}` }}>
        <div style={{
          fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted,
        }}>
          Longest Path — {items.length} activities
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted, marginTop: 2 }}>
          {fmtDate(items[0]?.start)} → {fmtDate(items[items.length - 1]?.finish)}
        </div>
      </div>

      {/* Split layout: name column + scrollable chart */}
      <div style={{ display: 'flex', overflow: 'hidden' }}>

        {/* ── Name column (fixed, no scroll) ── */}
        <div style={{
          width: 200, flexShrink: 0, borderRight: `1px solid ${SK.border}`,
          background: SK.card, overflowY: 'hidden',
        }}>
          {items.map((item, i) => (
            <div
              key={item.id ?? i}
              style={{
                height: ROW_H, padding: '0 10px',
                display: 'flex', alignItems: 'center',
                borderBottom: i < items.length - 1 ? `1px solid ${SK.border}` : 'none',
                background: i % 2 === 0 ? 'transparent' : SK.bg,
              }}
            >
              {/* Milestone or task icon */}
              <span style={{
                color: SK.fail, fontSize: 9, marginRight: 5, flexShrink: 0,
              }}>
                {item.is_milestone ? '◆' : '●'}
              </span>
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 11, color: SK.text,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
                title={item.name}
              >
                {item.name}
              </span>
            </div>
          ))}
          {/* Spacer row to match axis height */}
          <div style={{ height: AXIS_H }} />
        </div>

        {/* ── Scrollable SVG chart ── */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}
        >
          <svg
            width={chartWidth}
            height={chartHeight}
            style={{ display: 'block' }}
          >
            {/* Row backgrounds + gridlines */}
            {items.map((item, i) => (
              <rect
                key={`bg-${i}`}
                x={0} y={i * ROW_H}
                width={chartWidth} height={ROW_H}
                fill={i % 2 === 0 ? 'transparent' : SK.bg}
              />
            ))}

            {/* Vertical gridlines at axis ticks */}
            {axisTicks.map((tick, i) => (
              <line
                key={`grid-${i}`}
                x1={tick.x} y1={0}
                x2={tick.x} y2={items.length * ROW_H}
                stroke={SK.border} strokeWidth={1} strokeDasharray="3 3"
              />
            ))}

            {/* Activity bars */}
            {items.map((item, i) => {
              const x1 = dateToX(item.startDate)
              const x2 = dateToX(item.finishDate)
              const w  = Math.max(x2 - x1, item.is_milestone ? 0 : 3)
              const y  = i * ROW_H + (ROW_H - BAR_H) / 2

              if (item.is_milestone) {
                // Diamond shape centred on the date
                const mx = x1, my = i * ROW_H + ROW_H / 2
                const s  = 6
                return (
                  <polygon
                    key={item.id ?? i}
                    points={`${mx},${my - s} ${mx + s},${my} ${mx},${my + s} ${mx - s},${my}`}
                    fill={SK.fail}
                  >
                    <title>{item.name} — {fmtDate(item.start)}</title>
                  </polygon>
                )
              }

              return (
                <g key={item.id ?? i}>
                  <rect
                    x={x1} y={y} width={w} height={BAR_H}
                    rx={3} ry={3}
                    fill={SK.fail} opacity={0.85}
                  />
                  {/* Duration label — only if bar is wide enough */}
                  {w > 30 && (
                    <text
                      x={x1 + w / 2} y={y + BAR_H / 2 + 1}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={9} fontFamily="'JetBrains Mono',monospace"
                      fill="#fff" fontWeight={600}
                    >
                      {item.duration_days}d
                    </text>
                  )}
                  <title>{item.name} — {fmtDate(item.start)} to {fmtDate(item.finish)} ({item.duration_days}d)</title>
                </g>
              )
            })}

            {/* Date axis */}
            <g transform={`translate(0, ${items.length * ROW_H})`}>
              <line x1={0} y1={0} x2={chartWidth} y2={0} stroke={SK.border} strokeWidth={1} />
              {axisTicks.map((tick, i) => (
                <g key={`tick-${i}`}>
                  <line x1={tick.x} y1={0} x2={tick.x} y2={5} stroke={SK.muted} strokeWidth={1} />
                  <text
                    x={tick.x} y={18}
                    textAnchor="middle" fontSize={9}
                    fontFamily="'JetBrains Mono',monospace"
                    fill={SK.muted}
                  >
                    {fmtDate(tick.date)}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}
