// ── GradeRing.jsx ─────────────────────────────────────────────────────────────
//
// Circular SVG gauge showing the overall schedule health grade.
//
// DESIGN:
//   - Large ring, colour-coded by grade (A/B=green, C=amber, D/F=red)
//   - Grade letter in the centre, large Montserrat Black
//   - Score % below the letter, monospace
//   - Thin grey track behind the coloured arc
//   - Arc fills clockwise from top, proportional to score (0–100)
//
// PROPS:
//   grade  string  — "A" | "B" | "C" | "D" | "F"
//   score  number  — 0–100
//
// ─────────────────────────────────────────────────────────────────────────────

export default function GradeRing({ grade, score }) {
  // Guard — render nothing if data isn't ready
  if (grade == null || score == null) return null

  // Ring geometry
  const SIZE   = 160   // SVG viewport size
  const CX     = SIZE / 2
  const CY     = SIZE / 2
  const R      = 62    // radius of the arc
  const STROKE = 10    // stroke width

  // Colour by grade — matches SKOPIA status palette
  const gradeColour = {
    A: '#16A34A',  // pass green
    B: '#16A34A',  // pass green
    C: '#D97706',  // warn amber
    D: '#DC2626',  // fail red
    F: '#DC2626',  // fail red
  }[grade] ?? '#6B7280'

  // Convert score (0–100) to arc length
  // Full circle circumference = 2πr
  const circumference = 2 * Math.PI * R
  // We draw the arc starting from the top (−90°).
  // dashoffset controls how much of the arc is visible.
  const dashOffset = circumference * (1 - score / 100)

  return (
    <div style={{
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
    }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ overflow: 'visible' }}
      >
        {/* Background track — full grey circle */}
        <circle
          cx={CX} cy={CY} r={R}
          fill="none"
          stroke="#E2E6F0"
          strokeWidth={STROKE}
        />

        {/* Coloured arc — rotated so it starts at top (−90°) */}
        <circle
          cx={CX} cy={CY} r={R}
          fill="none"
          stroke={gradeColour}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          // Rotate so arc starts at 12 o'clock
          transform={`rotate(-90 ${CX} ${CY})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />

        {/* Grade letter — centre, large */}
        <text
          x={CX} y={CY - 6}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={48}
          fontFamily="'Montserrat', Arial, sans-serif"
          fontWeight={900}
          fill={gradeColour}
        >
          {grade}
        </text>

        {/* Score % — below the letter */}
        <text
          x={CX} y={CY + 30}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={13}
          fontFamily="'JetBrains Mono', monospace"
          fontWeight={500}
          fill="#6B7280"
        >
          {Math.round(score)}%
        </text>
      </svg>

      {/* Label below the ring */}
      <div style={{
        fontFamily:    'var(--font-head)',
        fontWeight:    700,
        fontSize:      10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color:         'var(--sk-muted)',
        marginTop:     4,
      }}>
        Overall Grade
      </div>
    </div>
  )
}
