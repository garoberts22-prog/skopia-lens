// ── SpiderChart.jsx ───────────────────────────────────────────────────────────
//
// Radar/spider chart showing normalised_score (0–100) for each check.
// Built with Recharts RadarChart.
//
// PROPS:
//   checks  array  — analysis.checks[] — uses check_name + normalised_score
//
// ─────────────────────────────────────────────────────────────────────────────

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from 'recharts'

// Shorten check names so they fit on the radar axis labels
function shortName(name) {
  const MAP = {
    'Logic completeness':    'Logic',
    'Leads (negative lags)': 'Leads',
    'Lags':                  'Lags',
    'Relationship types':    'Rel Types',
    'Hard constraints':      'Constraints',
    'High float':            'High Float',
    'Negative float':        'Neg Float',
    'Long durations':        'Duration',
    'Calendar validation':   'Calendars',
    'Logic density':         'Density',
    'Bottleneck activities': 'Bottlenecks',
  }
  return MAP[name] ?? name
}

// Custom tooltip — shows check name + score on hover
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{
      background:   'var(--sk-header)',
      border:       '1px solid #334155',
      borderRadius: 6,
      padding:      '6px 10px',
      fontFamily:   'var(--font-mono)',
      fontSize:     11,
      color:        '#f1f5f9',
    }}>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, marginBottom: 2 }}>
        {d.check_name}
      </div>
      <div>Score: <b style={{ color: '#1EC8D4' }}>{d.score}</b> / 100</div>
    </div>
  )
}

export default function SpiderChart({ checks }) {
  if (!checks?.length) return null

  // Transform checks array into Recharts data format
  // Recharts RadarChart expects: [{ subject, score, fullMark }]
  const data = checks.map(c => ({
    subject:    shortName(c.check_name),
    check_name: c.check_name,
    score:      c.normalised_score ?? 0,
    fullMark:   100,
  }))

  return (
    <div style={{
      background:   'var(--sk-card)',
      border:       '1px solid var(--sk-border)',
      borderRadius: 12,
      padding:      '16px 12px 8px',
      boxShadow:    '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      {/* Card heading */}
      <div style={{
        fontFamily:    'var(--font-head)',
        fontWeight:    700,
        fontSize:      11,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color:         'var(--sk-muted)',
        marginBottom:  12,
      }}>
        Health Score Radar
      </div>

      {/* ResponsiveContainer fills the card width */}
      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>

          {/* Grid rings */}
          <PolarGrid stroke="#E2E6F0" strokeDasharray="3 3" />

          {/* Axis labels (check names) */}
          <PolarAngleAxis
            dataKey="subject"
            tick={{
              fontFamily: "'Montserrat', Arial, sans-serif",
              fontSize:   9,
              fontWeight: 700,
              fill:       '#6B7280',
            }}
          />

          {/* Radial scale — hidden ticks, just provides 0–100 range */}
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={false}
            axisLine={false}
          />

          {/* The filled radar shape */}
          <Radar
            name="Score"
            dataKey="score"
            stroke="#4A6FE8"
            strokeWidth={2}
            // Gradient fill — use a semi-transparent brand colour
            fill="#4A6FE8"
            fillOpacity={0.18}
            dot={{ r: 3, fill: '#4A6FE8', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#1EC8D4' }}
          />

          <Tooltip content={<CustomTooltip />} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
