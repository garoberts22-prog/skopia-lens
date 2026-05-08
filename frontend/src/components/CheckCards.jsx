// ── CheckCards.jsx ────────────────────────────────────────────────────────────
//
// Scrollable list of health check result cards — one per check.
// Each card shows: status indicator, check name, DCMA ref, metric vs threshold.
// Clicking a card scrolls the detail drill-down table into view.
//
// PROPS:
//   checks        array   — analysis.checks[]
//   onCheckClick  fn      — called with check_id when a card is clicked
//                           (DashboardView uses this to scroll to the detail table)
//
// STATUS COLOURS:
//   pass  → green   #16A34A
//   warn  → amber   #D97706
//   fail  → red     #DC2626
//   info  → blue    #2563EB
//
// ─────────────────────────────────────────────────────────────────────────────

// Map status → colour token
const STATUS_COLOUR = {
  pass: '#16A34A',
  warn: '#D97706',
  fail: '#DC2626',
  info: '#2563EB',
}

// Map status → background tint
const STATUS_BG = {
  pass: 'rgba(22, 163, 74,  0.08)',
  warn: 'rgba(217, 119, 6,  0.08)',
  fail: 'rgba(220, 38,  38, 0.08)',
  info: 'rgba(37,  99,  235, 0.08)',
}

// Map status → dot/icon symbol
const STATUS_ICON = {
  pass: '●',
  warn: '▲',
  fail: '✕',
  info: 'ℹ',
}

export default function CheckCards({ checks, onCheckClick }) {
  if (!checks?.length) return null

  return (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      gap:           6,
      // Allow this panel to scroll independently if there are many checks
      overflowY:     'auto',
      maxHeight:     420,
    }}>
      {checks.map(check => {
        const colour = STATUS_COLOUR[check.status] ?? '#6B7280'
        const bg     = STATUS_BG[check.status]    ?? 'rgba(107,114,128,0.08)'
        const icon   = STATUS_ICON[check.status]  ?? '●'

        // Format the metric display:
        //   pass: "3.1% ≤ 5%" 
        //   null metric (calendar, bottlenecks): just show flagged count
        function metricLabel() {
          if (check.metric_value == null) {
            return check.flagged_count > 0
              ? `${check.flagged_count} flagged`
              : 'OK'
          }
          const val = typeof check.metric_value === 'number'
            ? check.metric_value.toFixed(check.metric_value % 1 === 0 ? 0 : 1)
            : check.metric_value
          if (check.threshold_value != null) {
            const thr = check.threshold_value
            const op  = check.status === 'pass'
              ? (check.metric_value <= thr ? '≤' : '≥')
              : (check.metric_value <= thr ? '≤' : '>')
            return `${val} ${op} ${thr}`
          }
          return String(val)
        }

        return (
          <div
            key={check.check_id}
            onClick={() => onCheckClick?.(check.check_id)}
            style={{
              display:      'flex',
              alignItems:   'center',
              gap:          10,
              padding:      '8px 12px',
              borderRadius: 8,
              border:       `1px solid ${colour}30`,
              background:   bg,
              cursor:       'pointer',
              transition:   'box-shadow 0.12s, transform 0.1s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.boxShadow = `0 2px 8px ${colour}20`
              e.currentTarget.style.transform = 'translateX(2px)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.boxShadow = 'none'
              e.currentTarget.style.transform = 'none'
            }}
          >
            {/* Status dot */}
            <span style={{
              color:      colour,
              fontSize:   check.status === 'info' ? 13 : 10,
              fontWeight: 700,
              flexShrink: 0,
              width:      14,
              textAlign:  'center',
            }}>
              {icon}
            </span>

            {/* Check name + DCMA ref */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily:   'var(--font-head)',
                fontWeight:   700,
                fontSize:     12,
                color:        'var(--sk-text)',
                overflow:     'hidden',
                textOverflow: 'ellipsis',
                whiteSpace:   'nowrap',
              }}>
                {check.check_name}
              </div>
              {check.dcma_ref && (
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize:   9,
                  color:      'var(--sk-muted)',
                  marginTop:  1,
                }}>
                  {check.dcma_ref}
                </div>
              )}
            </div>

            {/* Metric value */}
            <div style={{
              fontFamily:  'var(--font-mono)',
              fontSize:    10,
              fontWeight:  700,
              color:       colour,
              flexShrink:  0,
              textAlign:   'right',
            }}>
              {metricLabel()}
            </div>

            {/* Status label */}
            <div style={{
              fontFamily:    'var(--font-head)',
              fontWeight:    700,
              fontSize:      9,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color:         colour,
              background:    `${colour}15`,
              borderRadius:  3,
              padding:       '2px 6px',
              flexShrink:    0,
              minWidth:      30,
              textAlign:     'center',
            }}>
              {check.status}
            </div>
          </div>
        )
      })}
    </div>
  )
}
