// ── FloatHistogram.jsx ────────────────────────────────────────────────────────
//
// Horizontal bar histogram of total float distribution.
// Matches the prototype's inline bar style exactly — NOT a Recharts chart.
//
// API field: float_histogram.bins[]
//   Each bin: { label: string, count: number, severity: "pass"|"warn"|"fail" }
// Also uses: float_histogram.mean_float_days, float_histogram.median_float_days
//
// ─────────────────────────────────────────────────────────────────────────────

const SK = {
  pass: '#16A34A', warn: '#D97706', fail: '#DC2626', peri: '#4A6FE8',
  text: '#1A1A2E', muted: '#6B7280', border: '#E2E6F0', bg: '#F7F8FC', card: '#FFFFFF',
}

const SEV_COLOUR = { pass: SK.pass, warn: SK.warn, fail: SK.fail }

export default function FloatHistogram({ histogram }) {
  if (!histogram?.bins?.length) return null

  const bins     = histogram.bins
  const maxCount = Math.max(...bins.map(b => b.count), 1)
  const mean     = histogram.mean_float_days
  const median   = histogram.median_float_days

  return (
    <div style={{
      background: SK.card, border: `1px solid ${SK.border}`,
      borderRadius: 12, padding: '14px 16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{
          fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted,
        }}>
          Float Distribution
        </div>
        {/* Mean / Median chips */}
        <div style={{ display: 'flex', gap: 8 }}>
          {mean != null && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: SK.muted }}>
              Mean <strong style={{ color: SK.text }}>{Math.round(mean)}d</strong>
            </span>
          )}
          {median != null && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: SK.muted }}>
              Median <strong style={{ color: SK.text }}>{Math.round(median)}d</strong>
            </span>
          )}
        </div>
      </div>

      {/* Bars — one row per bin */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {bins.map((bin, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Label — right-aligned, fixed width */}
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: SK.muted,
              width: 64, textAlign: 'right', flexShrink: 0,
            }}>
              {bin.label}
            </span>

            {/* Bar track */}
            <div style={{
              flex: 1, height: 18, background: SK.bg,
              borderRadius: 4, overflow: 'hidden',
            }}>
              <div style={{
                width: `${(bin.count / maxCount) * 100}%`,
                height: '100%',
                background: SEV_COLOUR[bin.severity] ?? SK.peri,
                borderRadius: 4,
                minWidth: bin.count > 0 ? 3 : 0,
                transition: 'width 0.3s ease',
              }} />
            </div>

            {/* Count — fixed width, right-aligned */}
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
              color: SK.text, width: 44, textAlign: 'right', flexShrink: 0,
            }}>
              {bin.count.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 12, justifyContent: 'flex-end' }}>
        {[['pass', 'Within threshold'], ['warn', 'Moderate'], ['fail', 'Exceeds threshold']].map(([sev, label]) => (
          <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: SEV_COLOUR[sev] }} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: SK.muted }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
