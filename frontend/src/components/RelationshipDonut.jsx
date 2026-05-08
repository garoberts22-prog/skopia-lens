// ── RelationshipDonut.jsx ─────────────────────────────────────────────────────
//
// SVG donut chart of relationship type breakdown.
// Matches the prototype's hand-coded SVG donut — NOT Recharts PieChart.
//
// API field: relationship_breakdown { FS, SS, FF, SF, total }
//
// Colours match the prototype exactly:
//   FS → Periwinkle (#4A6FE8)
//   SS → Cyan       (#1EC8D4)
//   FF → Purple     (#8B5CF6)
//   SF → Red/fail   (#DC2626)
//
// ─────────────────────────────────────────────────────────────────────────────

const SK = {
  peri: '#4A6FE8', cyan: '#1EC8D4', text: '#1A1A2E',
  muted: '#6B7280', border: '#E2E6F0', bg: '#F7F8FC', card: '#FFFFFF',
}

const TYPE_COLOUR = {
  FS: SK.peri,
  SS: SK.cyan,
  FF: '#8B5CF6',
  SF: '#DC2626',
}

export default function RelationshipDonut({ breakdown }) {
  if (!breakdown) return null

  const { FS = 0, SS = 0, FF = 0, SF = 0 } = breakdown
  const total   = FS + SS + FF + SF
  const entries = [['FS', FS], ['SS', SS], ['FF', FF], ['SF', SF]].filter(([, n]) => n > 0)

  // SVG donut geometry — matches prototype (R=60, r=38, cx=80, cy=80)
  const R = 60, r = 38, cx = 80, cy = 80

  // Build arc paths
  let cum = -Math.PI / 2
  const arcs = entries.map(([type, count]) => {
    const ang = (count / total) * 2 * Math.PI
    const s   = cum
    cum      += ang
    const e   = cum
    const la  = ang > Math.PI ? 1 : 0

    // Full circle edge case (single type = 100%)
    if (ang >= 2 * Math.PI - 0.01) {
      return { type, count, isCircle: true }
    }

    const x1  = cx + R * Math.cos(s), y1 = cy + R * Math.sin(s)
    const x2  = cx + R * Math.cos(e), y2 = cy + R * Math.sin(e)
    const ix1 = cx + r * Math.cos(e), iy1 = cy + r * Math.sin(e)
    const ix2 = cx + r * Math.cos(s), iy2 = cy + r * Math.sin(s)

    const d = `M${x1},${y1} A${R},${R} 0 ${la} 1 ${x2},${y2} L${ix1},${iy1} A${r},${r} 0 ${la} 0 ${ix2},${iy2} Z`
    return { type, count, d, isCircle: false }
  })

  return (
    <div style={{
      background: SK.card, border: `1px solid ${SK.border}`,
      borderRadius: 12, padding: '14px 16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Header */}
      <div style={{
        fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
        textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted,
        marginBottom: 12,
      }}>
        Relationship Types
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        {/* SVG donut */}
        {total > 0 ? (
          <svg width={140} height={140} viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
            {arcs.map(arc =>
              arc.isCircle ? (
                <circle
                  key={arc.type}
                  cx={cx} cy={cy}
                  r={(R + r) / 2}
                  fill="none"
                  stroke={TYPE_COLOUR[arc.type]}
                  strokeWidth={R - r}
                  opacity={0.85}
                />
              ) : (
                <path
                  key={arc.type}
                  d={arc.d}
                  fill={TYPE_COLOUR[arc.type]}
                  opacity={0.85}
                />
              )
            )}
            {/* Centre total */}
            <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="middle"
              fontSize={18} fontWeight={700}
              fontFamily="'JetBrains Mono',monospace"
              fill={SK.text}>
              {total.toLocaleString()}
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle"
              fontSize={9} fontFamily="'Open Sans',Arial,sans-serif"
              fill={SK.muted}>
              total
            </text>
          </svg>
        ) : (
          <div style={{ width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: SK.muted, fontSize: 12 }}>
            No data
          </div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {entries.map(([type, count]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: TYPE_COLOUR[type], flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: SK.text, fontWeight: 700, width: 24 }}>
                {type}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: SK.muted }}>
                {count.toLocaleString()} ({total > 0 ? Math.round((count / total) * 100) : 0}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
