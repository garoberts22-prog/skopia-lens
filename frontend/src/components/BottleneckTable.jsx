// ── BottleneckTable.jsx ───────────────────────────────────────────────────────
//
// Top-10 bottleneck activities ranked by fan-in × fan-out score.
// Matches prototype table style exactly.
//
// API field: network_metrics.top_bottlenecks[]
//   Each item: { id, name, wbs, fan_in, fan_out, score, float_days, critical }
//
// ─────────────────────────────────────────────────────────────────────────────

const SK = {
  pass: '#16A34A', warn: '#D97706', fail: '#DC2626', peri: '#4A6FE8',
  text: '#1A1A2E', muted: '#6B7280', border: '#E2E6F0', bg: '#F7F8FC', card: '#FFFFFF',
}

export default function BottleneckTable({ bottlenecks }) {
  if (!bottlenecks?.length) return null

  const top10 = bottlenecks.slice(0, 10)

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
        marginBottom: 10,
      }}>
        Top Bottlenecks — Fan-in × Fan-out Score
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${SK.border}` }}>
              {['#', 'Activity ID', 'Name', 'Fan In', 'Fan Out', 'Score', 'Float', 'Crit'].map(h => (
                <th key={h} style={{
                  padding: '6px 10px',
                  textAlign: h === '#' ? 'center' : 'left',
                  fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.05em', color: SK.muted,
                  whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top10.map((b, i) => {
              const scoreColour = b.score >= 12 ? SK.fail : b.score >= 6 ? SK.warn : SK.text
              const floatColour = b.float_days != null && b.float_days <= 0 ? SK.fail : SK.muted

              return (
                <tr key={b.id ?? i} style={{
                  borderBottom: `1px solid ${SK.border}`,
                  background: i % 2 === 0 ? 'transparent' : SK.bg,
                }}>
                  {/* Rank */}
                  <td style={{ padding: '6px 10px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted, fontWeight: 600 }}>
                    {i + 1}
                  </td>
                  {/* Activity ID */}
                  <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.peri, whiteSpace: 'nowrap' }}>
                    {b.id ?? '—'}
                  </td>
                  {/* Name — truncated */}
                  <td style={{ padding: '6px 10px', color: SK.text, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.name ?? '—'}
                  </td>
                  {/* Fan In */}
                  <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', textAlign: 'center', color: SK.text }}>
                    {b.fan_in ?? '—'}
                  </td>
                  {/* Fan Out */}
                  <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', textAlign: 'center', color: SK.text }}>
                    {b.fan_out ?? '—'}
                  </td>
                  {/* Score — colour coded */}
                  <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: scoreColour }}>
                    {b.score ?? '—'}
                  </td>
                  {/* Float */}
                  <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', color: floatColour }}>
                    {b.float_days != null ? `${b.float_days}d` : '—'}
                  </td>
                  {/* Critical dot */}
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    {b.critical && <span style={{ color: SK.fail, fontWeight: 700, fontSize: 10 }}>●</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
