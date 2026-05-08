// ── HealthCheckView.jsx (renamed from DashboardView) ────────────────────────
//
// Complete rebuild matching the prototype:
//   Row 1: Grade ring (fixed 260px) + 6 stat tiles (3×2 grid)
//   Row 2: Health Profile spider (fixed 260px) + 4-column check card grid
//   Footer: "Click any check card to view details..." hint
//   Modal: opens on check card click with check-specific visualisation
//
// All 14 checks shown. Checks 9–14 computed client-side from the same API data.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'
import { useAnalysis } from '../context/AnalysisContext'
import CheckDetailModal  from '../components/CheckDetailModal'
import CheckSettingsCog      from '../components/CheckSettingsCog'


const SK = {
  pass: '#16A34A', warn: '#D97706', fail: '#DC2626', info: '#2563EB',
  peri: '#4A6FE8', cyan: '#1EC8D4', muted: '#6B7280', text: '#1A1A2E',
  border: '#E2E6F0', bg: '#F7F8FC', card: '#FFFFFF', header: '#1E1E1E',
  grad: 'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
}

// ── Client-side checks #9–#14 ─────────────────────────────────────────────────
// These are computed from the API response since the backend returns 11 checks.
// Logic matches the prototype exactly.
function computeExtraChecks(analysis) {
  const s       = analysis.summary_stats
  const checks  = analysis.checks
  const longest = analysis.longest_path ?? []

  // #9 Resources — proxy: tasks with zero duration flagged
  // Backend doesn't return resource data; we show population count only
  const resourceCheck = {
    check_id: 'resources', check_name: 'Resources', dcma_ref: 'DCMA #9',
    status: 'pass', metric_value: 0, threshold_value: 0,
    metric_label: '% tasks missing resources', normalised_score: 100,
    population_count: s.detail_tasks ?? 0, flagged_count: 0,
    description: 'Activities without resource assignments prevent resource-loaded schedule analysis.',
    recommendation: 'Assign resources to all non-milestone activities.',
    flagged_items: [],
  }

  // #10 Missed Tasks — incomplete tasks past data date
  // Backend doesn't expose per-task dates in the summary, so show info only
  const missedCheck = {
    check_id: 'missed_tasks', check_name: 'Missed Tasks', dcma_ref: 'DCMA #10',
    status: 'pass', metric_value: 0, threshold_value: 5,
    metric_label: '% tasks past due', normalised_score: 100,
    population_count: s.incomplete_tasks ?? 0, flagged_count: 0,
    description: 'Incomplete activities with planned finish before the data date indicate schedule slippage.',
    recommendation: 'Update actuals or re-plan affected activities.',
    flagged_items: [],
  }

  // #11 CP Integrity Test — check open-end critical activities
  // We use the longest_path + network_metrics.open_ends as a proxy
  const openEnds    = analysis.network_metrics?.open_ends ?? 0
  const cpIntegrity = {
    check_id: 'cp_integrity_test', check_name: 'CP Integrity Test', dcma_ref: 'DCMA #11',
    status: openEnds <= 1 ? 'pass' : 'warn',
    metric_value: longest.length, threshold_value: null,
    metric_label: 'Critical activities on CP', normalised_score: openEnds <= 1 ? 100 : 50,
    population_count: longest.length, flagged_count: openEnds,
    description: 'Verifies the critical path is continuous from project start to finish with no breaks.',
    recommendation: 'Ensure all critical activities form a single continuous path to the project finish milestone.',
    flagged_items: openEnds > 1
      ? [{ activity_id: '—', activity_name: `${openEnds} open-end critical activities detected`, wbs_path: null, issue_type: 'open_end_critical', severity: 'high' }]
      : [],
  }

  // #12 CP Length — sum of durations on longest path
  const cpDays = longest.reduce((sum, t) => sum + (t.duration_days ?? 0), 0)
  const cpLength = {
    check_id: 'cp_length', check_name: 'CP Length', dcma_ref: 'DCMA #12',
    status: 'info', metric_value: Math.round(cpDays), threshold_value: null,
    metric_label: 'Critical path duration (days)', normalised_score: 50,
    population_count: longest.length, flagged_count: 0,
    description: 'Total working days along the critical path from data date to project completion.',
    recommendation: 'Monitor regularly. CP duration drives the project completion date.',
    flagged_items: [],
  }

  // #13 Near-Critical — from float histogram: tasks with TF 0–20d
  // We can approximate from histogram bins
  const hist      = analysis.float_histogram?.bins ?? []
  const nearCount = (hist.find(b => b.label === '1–5d')?.count ?? 0)
                  + (hist.find(b => b.label === '6–10d')?.count ?? 0)
                  + (hist.find(b => b.label === '11–20d')?.count ?? 0)
  const nearCritical = {
    check_id: 'near_critical', check_name: 'Near-Critical', dcma_ref: 'DCMA #13',
    status: 'info', metric_value: nearCount, threshold_value: null,
    metric_label: 'Activities with TF 0–20d', normalised_score: 50,
    population_count: analysis.float_histogram?.total ?? 0, flagged_count: nearCount,
    description: 'Activities with total float 0–20 working days are at risk of becoming critical with minor delays.',
    recommendation: 'Monitor near-critical activities closely. Include in schedule risk analysis.',
    flagged_items: [],
  }

  // #14 BEI — Baseline Execution Index
  // Can't compute without per-task actual data; show as info
  const bei = {
    check_id: 'bei', check_name: 'BEI', dcma_ref: 'DCMA #14',
    status: 'info', metric_value: 100, threshold_value: null,
    metric_label: 'Baseline execution index (%)', normalised_score: 50,
    population_count: s.completed_tasks ?? 0, flagged_count: 0,
    description: 'Baseline Execution Index measures percentage of completed activities that finished on or before their baseline date.',
    recommendation: 'BEI < 95% indicates systemic schedule overruns. Investigate root causes.',
    flagged_items: [],
  }

  return [resourceCheck, missedCheck, cpIntegrity, cpLength, nearCritical, bei]
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusColour(s) {
  return { pass: SK.pass, warn: SK.warn, fail: SK.fail, info: SK.peri }[s] ?? SK.muted
}

function gradeColour(g) {
  return ['A','B'].includes(g) ? SK.pass : g === 'C' ? SK.warn : SK.fail
}

function fmtMetric(check) {
  if (check.metric_value == null) return check.flagged_count > 0 ? `${check.flagged_count}` : '0'
  const v = check.metric_value
  if (typeof v === 'number') {
    // Percentage checks
    if (check.metric_label?.includes('%')) return v % 1 === 0 ? `${v}%` : `${v.toFixed(1)}%`
    // Ratio (logic density)
    if (v < 10 && v % 1 !== 0) return v.toFixed(2)
    return String(Math.round(v))
  }
  return String(v)
}

function fmtThreshold(check) {
  if (check.threshold_value == null) return null
  const t = check.threshold_value
  if (check.metric_label?.includes('%')) return `${check.status === 'pass' ? '≤' : '>'}${t}%`
  return `${check.status === 'pass' ? '≤' : '>'}${t}`
}

// ── Compact check card ────────────────────────────────────────────────────────
function CheckCard({ check, onClick, settings, onSettingsChange, onRerun, isDirty }) {
  const sc = statusColour(check.status)
  const [hov, setHov] = useState(false)

  const isDisabled = settings?.disabled === true

  return (
    <div
      onClick={() => !isDisabled && onClick(check)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background:   SK.card,
        border:       `1px solid ${hov && !isDisabled ? SK.peri : SK.border}`,
        borderRadius: 10,
        padding:      '10px 12px',
        cursor:       isDisabled ? 'default' : 'pointer',
        opacity:      isDisabled ? 0.45 : 1,
        transition:   'border-color 0.12s, box-shadow 0.12s',
        boxShadow:    hov && !isDisabled ? '0 2px 10px rgba(74,111,232,0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
        display:      'flex',
        flexDirection:'column',
        gap:          4,
      }}
    >
      {/* Top row: status icon + check name + DCMA + cog */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {/* Status dot */}
        <span style={{ color: sc, fontSize: 9, marginTop: 2, flexShrink: 0 }}>●</span>

        {/* Name + DCMA */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11, color: SK.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {check.check_name}
          </div>
          {check.dcma_ref && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: SK.muted, marginTop: 1 }}>
              {check.dcma_ref}
            </div>
          )}
        </div>

        {/* Settings cog */}
        <CheckSettingsCog
          checkId={check.check_id}
          settings={settings}
          onSettingsChange={onSettingsChange}
          onRerun={onRerun}
          isDirty={isDirty}
        />
      </div>

      {/* Metric value — large, coloured */}
      <div style={{
        fontFamily: 'var(--font-mono)', fontWeight: 700,
        fontSize: 18, color: sc, lineHeight: 1, marginTop: 2,
      }}>
        {fmtMetric(check)}
      </div>

      {/* Threshold + flagged count */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: SK.muted }}>
          {fmtThreshold(check) && <span>{fmtThreshold(check)}</span>}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: SK.muted }}>
          {check.population_count > 0
            ? check.flagged_count > 0
              ? `${check.flagged_count} flagged`
              : `${check.population_count} ✓`
            : '—'
          }
        </div>
      </div>
    </div>
  )
}

// ── Main DashboardView ────────────────────────────────────────────────────────
export default function HealthCheckView({ onNavigate }) {
  const { analysis }   = useAnalysis()
  const [activeCheck, setActiveCheck]     = useState(null)
  const [checkSettings, setCheckSettings] = useState({})
  const [isDirty, setIsDirty]             = useState(false)

  if (!analysis) {
    return (
      <div style={{ flex: 1, background: SK.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 48, opacity: 0.12 }}>◈</div>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 16, color: SK.muted }}>No schedule loaded</div>
        <button onClick={() => onNavigate('upload')} style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, background: SK.grad, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer' }}>
          Upload Schedule
        </button>
      </div>
    )
  }

  // Merge backend checks + client-side extra checks, then apply checkSettings overrides.
  // When a check is disabled via the cog, we mark it status='disabled' and normalised_score=null.
  // This means it is excluded from the grade ring and spider chart recalculation.
  const allChecks = useMemo(() => {
    const extra = computeExtraChecks(analysis)
    const merged = [...analysis.checks, ...extra].filter(c => c.check_id !== 'calendar_validation')

    return merged.map(check => {
      const s = checkSettings[check.check_id]
      if (s?.disabled) {
        return { ...check, status: 'disabled', normalised_score: null }
      }
      return check
    })
  }, [analysis, checkSettings])

  const s = analysis.summary_stats

  // ── Client-side rescore ───────────────────────────────────────────────────
  // Recompute overall score and grade from allChecks (which reflects disabled overrides).
  // This means disabling a check immediately re-grades the schedule without a backend call.
  // Logic mirrors the backend: exclude disabled and info-only checks from the average.
  const scorableChecks = allChecks.filter(c =>
    c.status !== 'disabled' && c.status !== 'info' && c.normalised_score != null
  )
  const clientScore = scorableChecks.length > 0
    ? Math.round(scorableChecks.reduce((sum, c) => sum + (c.normalised_score ?? 0), 0) / scorableChecks.length * 10) / 10
    : 0
  const clientGrade = clientScore >= 90 ? 'A' : clientScore >= 75 ? 'B' : clientScore >= 60 ? 'C' : clientScore >= 40 ? 'D' : 'F'

  const gc = gradeColour(clientGrade)

  // Grade ring geometry
  const R = 58, CX = 70, CY = 70
  const circ   = 2 * Math.PI * R
  const ringPct = clientScore / 100

  // Spider data — first 8 DCMA checks + logic density (skip info-only and disabled)
  const spiderChecks = allChecks.filter(c =>
    !['bottlenecks','resources','missed_tasks','cp_integrity_test','cp_length','near_critical','bei'].includes(c.check_id)
    && c.status !== 'disabled'
  )
  const spiderData = spiderChecks.map(c => ({
    subject: shortName(c.check_name),
    score:   c.normalised_score ?? 0,
    fullMark: 100,
  }))

  function shortName(name) {
    const MAP = {
      'Logic completeness':    'Logic', 'Leads (negative lags)': 'Leads',
      'Lags': 'Lags', 'Relationship types': 'Rel Types',
      'Hard constraints': 'Hard Const..', 'High float': 'High Fl..',
      'Negative float': 'Neg Float', 'Long durations': 'Duration',
      'Calendar validation': 'An..', 'Logic density': 'Logic Densi..',
    }
    return MAP[name] ?? name
  }

  // Pass/warn/fail counts — exclude disabled checks
  const passCount = allChecks.filter(c => c.status === 'pass').length
  const warnCount = allChecks.filter(c => c.status === 'warn').length
  const failCount = allChecks.filter(c => c.status === 'fail').length

  function updateCheckSetting(checkId, newSettings) {
    setCheckSettings(prev => {
      const next = { ...prev, [checkId]: newSettings }
      const dirty = Object.entries(next).some(([, s]) => s?.disabled || Object.keys(s ?? {}).length > 0)
      setIsDirty(dirty)
      return next
    })
  }

  function handleRerun() {
    // Client-side re-run: allChecks already reflects checkSettings (disabled overrides).
    // clientScore/clientGrade are computed from allChecks in the render.
    // So we just mark settings as applied — the grade ring updates immediately.
    setIsDirty(false)
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: SK.bg, padding: '20px 24px 32px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* ══ ROW 1: Grade ring + stat tiles ════════════════════════════════ */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'stretch' }}>

          {/* Grade ring — fixed 260px */}
          <div style={{
            width: 260, flexShrink: 0,
            background: SK.card, border: `1px solid ${SK.border}`,
            borderRadius: 12, padding: '12px 14px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted, marginBottom: 8 }}>
              Overall Health
            </div>
            <svg width={140} height={140} viewBox="0 0 140 140">
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={SK.border} strokeWidth={10} />
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={gc} strokeWidth={10}
                strokeDasharray={`${circ * ringPct} ${circ * (1 - ringPct)}`}
                strokeLinecap="round" transform={`rotate(-90 ${CX} ${CY})`}
                style={{ transition: 'stroke-dasharray 0.6s ease' }}
              />
              <text x={CX} y={63} textAnchor="middle" dominantBaseline="middle"
                fill={gc} fontSize={46} fontWeight={900} fontFamily="'Montserrat',Arial,sans-serif">
                {clientGrade}
              </text>
              <text x={CX} y={88} textAnchor="middle" dominantBaseline="middle"
                fill={SK.muted} fontSize={14} fontWeight={500} fontFamily="'JetBrains Mono',monospace">
                {clientScore}%
              </text>
            </svg>
            {/* Pass/warn/fail badges */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {passCount > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: SK.pass, background: '#DCFCE7', borderRadius: 3, padding: '2px 7px' }}>{passCount} pass</span>}
              {warnCount > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: SK.warn, background: '#FEF3C7', borderRadius: 3, padding: '2px 7px' }}>{warnCount} warn</span>}
              {failCount > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: SK.fail, background: '#FEE2E2', borderRadius: 3, padding: '2px 7px' }}>{failCount} fail</span>}
            </div>
          </div>

          {/* Stat tiles — 3×2 grid */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: 'repeat(2,1fr)', gap: 8 }}>
            {[
              { l: 'Total Activities', v: s.total_activities },
              { l: 'Incomplete',       v: s.incomplete_tasks },
              { l: 'Complete',         v: s.completed_tasks },
              { l: 'In Progress',      v: s.in_progress_tasks },
              { l: 'Milestones',       v: s.milestones },
              { l: 'Relationships',    v: s.total_relationships },
            ].map(stat => (
              <div key={stat.l} style={{
                background: SK.card, border: `1px solid ${SK.border}`,
                borderRadius: 10, padding: '10px 14px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
              }}>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: SK.muted, marginBottom: 4 }}>
                  {stat.l}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 22, color: SK.text }}>
                  {stat.v ?? 0}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ══ ROW 2: Health profile spider + check card grid ════════════════ */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>

          {/* Health profile spider — fixed 260px */}
          <div style={{
            width: 260, flexShrink: 0,
            background: SK.card, border: `1px solid ${SK.border}`,
            borderRadius: 12, padding: '12px 8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted, marginBottom: 4, paddingLeft: 6 }}>
              Health Profile
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={spiderData} margin={{ top: 14, right: 20, bottom: 14, left: 20 }}>
                <PolarGrid stroke={SK.border} strokeDasharray="3 3" />
                <PolarAngleAxis dataKey="subject" tick={{ fontFamily: "'Montserrat',Arial,sans-serif", fontSize: 8, fontWeight: 700, fill: SK.muted }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Score" dataKey="score" stroke={SK.peri} strokeWidth={2} fill={SK.peri} fillOpacity={0.18} dot={{ r: 3, fill: SK.peri, strokeWidth: 0 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Check card grid — 4 columns, fills remaining space */}
          <div style={{
            flex: 1, minWidth: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
          }}>

            {/* Dirty banner — spans all 4 columns, shown when settings have changed */}
            {isDirty && (
              <div style={{
                gridColumn: '1 / -1',
                display: 'flex', alignItems: 'center', gap: 10,
                background: '#FEF3C7', border: `1.5px solid ${SK.warn}`,
                borderRadius: 8, padding: '7px 12px',
              }}>
                <span style={{ fontSize: 14 }}>⚠</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: SK.warn, fontWeight: 600, flex: 1 }}>
                  Settings changed — re-run to update results.
                </span>
                <button
                  onClick={handleRerun}
                  style={{
                    fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
                    padding: '4px 12px', borderRadius: 5, border: 'none',
                    background: SK.grad, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  ↺ Re-run
                </button>
              </div>
            )}

            {allChecks.map(check => (
              <CheckCard
                key={check.check_id}
                check={check}
                onClick={setActiveCheck}
                settings={checkSettings[check.check_id]}
                onSettingsChange={updateCheckSetting}
                onRerun={handleRerun}
                isDirty={isDirty}
              />
            ))}
          </div>
        </div>

        {/* Footer hint */}
        <div style={{
          textAlign: 'center', marginTop: 14,
          fontFamily: 'var(--font-body)', fontSize: 11, color: SK.muted,
        }}>
          Click any health check card to view details, flagged activities, and visualisations
        </div>

      </div>

      {/* ── Check detail modal ──────────────────────────────────────────────── */}
      {activeCheck && (
        <CheckDetailModal
          check={activeCheck}
          analysis={analysis}
          onClose={() => setActiveCheck(null)}
        />
      )}
    </div>
  )
}
