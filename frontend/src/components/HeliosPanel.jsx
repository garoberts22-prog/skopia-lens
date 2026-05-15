// ── HeliosPanel.jsx ───────────────────────────────────────────────────────────
//
// v1.3 — Layout: centred landscape modal (75vw × auto, max 860px wide).
//         "What Helios can do" tiles are now selectable — clicking one
//         switches the active tab and shows the correct prompt.
//
// CHANGES FROM v1.2:
//   - Panel is now a centred landscape modal (fixed, centred, up to 75vw wide)
//     rather than a right-edge slide-in. Animates scale+fade in/out.
//   - Left column (300px): prompt line, loading, error, PDF notice.
//   - Right column (flex:1): insight content card OR feature tiles.
//   - Feature tiles are now <button> elements. Clicking one:
//       1. Switches activeTab to that mode (if not locked)
//       2. Updates the terminal prompt line in the left column
//       3. Active tile gets accent border + tinted background
//   - All API logic, context hooks, and props preserved exactly from v1.2.
//
// PROPS:
//   open      bool    — controls show/hide
//   onClose   fn      — called when × or backdrop clicked
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useAnalysis } from '../context/AnalysisContext'

// ── Colour tokens ─────────────────────────────────────────────────────────────
const P = {
  bg:           '#0A0B1A',
  surface:      '#0F1029',
  surfaceHigh:  '#141530',
  surfaceActive:'#1A1D40',           // selected feature tile background
  border:       'rgba(74,111,232,0.2)',
  borderSubtle: 'rgba(255,255,255,0.06)',
  text:         '#CBD5E1',
  textBright:   '#E2E8F0',
  muted:        '#475569',
  mutedMid:     '#64748B',
  cyan:         '#1EC8D4',
  cyanDim:      'rgba(30,200,212,0.15)',
  peri:         '#4A6FE8',
  grad:         'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
  pass:         '#16A34A',
  warn:         '#D97706',
  fail:         '#DC2626',
  forensic:     '#DC2626',
  online:       '#22C55E',
}

// ── API call helper ───────────────────────────────────────────────────────────
async function callHelios(mode, analysis, baseline) {
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  const resp = await fetch(`${API_BASE}/api/helios`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ mode, analysis, baseline: baseline ?? null }),
  })
  const body = await resp.json()
  if (!resp.ok) {
    throw new Error(body?.detail?.message || body?.detail || `HTTP ${resp.status}`)
  }
  return body   // { mode, content, generated_at }
}

// ── Activity ID chip renderer ─────────────────────────────────────────────────
const ACTIVITY_ID_PATTERN = /\b([A-Z]{1,5}[\d]{3,}|[A-Z]{2,}(?:\.[A-Z0-9]+){2,})\b/g

function renderTextWithChips(text) {
  const parts = []
  let lastIndex = 0
  let match
  ACTIVITY_ID_PATTERN.lastIndex = 0
  while ((match = ACTIVITY_ID_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    parts.push({ type: 'chip', value: match[0] })
    lastIndex = ACTIVITY_ID_PATTERN.lastIndex
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) })

  return parts.map((part, i) => {
    if (part.type === 'chip') {
      return (
        <code key={i} style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, background: P.cyanDim, color: P.cyan,
          border: `1px solid rgba(30,200,212,0.3)`, borderRadius: 3, padding: '0px 5px',
          letterSpacing: '0.02em', verticalAlign: 'baseline', display: 'inline', whiteSpace: 'nowrap',
        }}>
          {part.value}
        </code>
      )
    }
    return <span key={i}>{part.value}</span>
  })
}

// ── Insight content renderer ──────────────────────────────────────────────────
function InsightContent({ content, mode }) {
  if (!content) return null
  const headingColour = mode === 'forensic' ? P.warn : P.cyan
  const lines = content.split('\n')
  return (
    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: P.text, lineHeight: 1.75 }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 10 }} />
        if (/^\*\*(.+)\*\*$/.test(line.trim())) {
          return (
            <div key={i} style={{
              fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 10, color: headingColour,
              marginTop: 16, marginBottom: 5, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {line.trim().replace(/\*\*/g, '')}
            </div>
          )
        }
        const parts = line.split(/(\*\*[^*]+\*\*)/)
        return (
          <div key={i} style={{ marginBottom: 3 }}>
            {parts.map((part, j) => {
              if (/^\*\*(.+)\*\*$/.test(part)) {
                return (
                  <strong key={j} style={{ color: P.textBright, fontWeight: 600 }}>
                    {renderTextWithChips(part.replace(/\*\*/g, ''))}
                  </strong>
                )
              }
              return <span key={j}>{renderTextWithChips(part)}</span>
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Typewriter loader ─────────────────────────────────────────────────────────
function AnalysingLabel({ mode }) {
  const label = mode === 'forensic' ? 'auditing' : 'analysing'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 12, color: P.mutedMid }}>
      <span style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
        background: P.cyan, animation: 'helios-pulse 1.2s ease-in-out infinite', flexShrink: 0,
      }} />
      <span>
        SKOPIA · {label}
        <span className="helios-dots" aria-hidden="true">
          <span style={{ animationDelay: '0ms' }}>.</span>
          <span style={{ animationDelay: '200ms' }}>.</span>
          <span style={{ animationDelay: '400ms' }}>.</span>
        </span>
      </span>
    </div>
  )
}

// ── Timestamp ─────────────────────────────────────────────────────────────────
function GeneratedAt({ isoStr }) {
  if (!isoStr) return null
  try {
    const d = new Date(isoStr)
    const fmt = d.toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: P.muted, marginBottom: 12, letterSpacing: '0.04em' }}>
        ── generated {fmt} ──
      </div>
    )
  } catch { return null }
}

// ── Tab / mode configuration ──────────────────────────────────────────────────
// accentColour and iconGrad added to drive consistent theming per mode
// across both the tab bar and the feature tiles.
const TABS = [
  {
    id:           'health',
    label:        'Health Insights',
    icon:         '◈',
    locked:       () => false,
    lockLabel:    null,
    prompt:       'Rank top schedule risks from health check data, float distribution, and critical path.',
    featureDesc:  'AI ranks risks across constraints, float, logic and pulls the top 5 to act on.',
    iconGrad:     'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
    accentColour: '#1EC8D4',
  },
  {
    id:           'baseline',
    label:        'Baseline Variance',
    icon:         '⇄',
    locked:       (hasBaseline) => !hasBaseline,
    lockLabel:    'no baseline',
    prompt:       'Compare current schedule against baseline — finish date movement, float erosion, and critical path changes.',
    featureDesc:  'Auto-drafted variance analysis with logic, float impact, and supporting evidence.',
    iconGrad:     'linear-gradient(135deg,#4A6FE8,#2A4DCC)',
    accentColour: '#4A6FE8',
  },
  {
    id:           'forensic',
    label:        'Forensic Analysis',
    icon:         '⚑',
    locked:       () => false,
    lockLabel:    null,
    prompt:       'Forensic examination — float distribution, near-critical exposure, ranked risks, and actionable recommendations. Modelled on EPC/EPCM standards.',
    featureDesc:  'Structured forensic examination modelled on EPC/EPCM planning standards.',
    iconGrad:     'linear-gradient(135deg,#DC2626,#D97706)',
    accentColour: '#DC2626',
  },
]

// ── Feature tile (selectable) ─────────────────────────────────────────────────
// Clicking a tile switches the activeTab. Locked tiles are disabled.
// Active tile: accent left border + tinted background + accent dot on label.
function FeatureTile({ tab, isActive, isLocked, onClick }) {
  return (
    <button
      className="helios-feature-tile"
      onClick={() => !isLocked && onClick(tab.id)}
      disabled={isLocked}
      title={isLocked ? 'Upload a baseline schedule to enable this mode' : `Switch to ${tab.label}`}
      style={{
        display:      'flex',
        alignItems:   'flex-start',
        gap:          14,
        padding:      '13px 16px',
        width:        '100%',
        textAlign:    'left',
        background:   isActive ? P.surfaceActive : P.surfaceHigh,
        border:       `1px solid ${isActive ? tab.accentColour + '55' : P.borderSubtle}`,
        borderLeft:   isActive ? `3px solid ${tab.accentColour}` : `3px solid transparent`,
        borderRadius: 6,
        cursor:       isLocked ? 'not-allowed' : 'pointer',
        opacity:      isLocked ? 0.45 : 1,
        transition:   'background 0.15s, border-color 0.15s',
        outline:      'none',
        fontFamily:   'inherit',
      }}
    >
      {/* Square gradient icon tile */}
      <div style={{
        width: 34, height: 34, borderRadius: 5,
        background: tab.iconGrad,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, flexShrink: 0, color: '#fff',
        boxShadow: isActive ? `0 2px 12px ${tab.accentColour}44` : 'none',
        transition: 'box-shadow 0.15s',
      }}>
        {tab.icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Mode label + active dot */}
        <div style={{
          fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 13,
          color: isActive ? tab.accentColour : P.textBright,
          marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7,
        }}>
          {tab.label}
          {/* Small dot indicates the currently selected mode */}
          {isActive && (
            <span style={{
              display: 'inline-block', width: 5, height: 5,
              borderRadius: '50%', background: tab.accentColour, flexShrink: 0,
            }} />
          )}
          {/* Lock badge */}
          {isLocked && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 8,
              background: 'rgba(255,255,255,0.06)', borderRadius: 2,
              padding: '1px 5px', color: P.muted, letterSpacing: '0.04em',
            }}>
              no baseline
            </span>
          )}
        </div>
        {/* Description */}
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 12,
          color: isActive ? P.text : P.mutedMid, lineHeight: 1.55,
        }}>
          {tab.featureDesc}
        </div>
      </div>
    </button>
  )
}

// ── Helios avatar SVG ─────────────────────────────────────────────────────────
// Extracted to keep the main render tidy. IDs use unique prefix (hv13-)
// to avoid conflicts if multiple SVG instances exist on the page.
function HeliosAvatar({ size = 36 }) {
  return (
    <img
      src="/assets/helios-static.png"
      alt="Helios"
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
        userSelect: 'none',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.4))',
      }}
    />
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function HeliosPanel({ open, onClose }) {
  const { analysis, baseline, heliosInsights, setHeliosInsights } = useAnalysis()

  const [activeTab, setActiveTab] = useState('health')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)

  const hasBaseline     = !!baseline
  const healthInsight   = heliosInsights?.health   ?? null
  const baselineInsight = heliosInsights?.baseline ?? null
  const forensicInsight = heliosInsights?.forensic ?? null

  // ── Generate handler — preserved exactly from v1.1/v1.2 ───────────────────
  async function handleGenerate() {
    if (!analysis) return
    if (activeTab === 'baseline' && !hasBaseline) return
    setError(null)
    setLoading(true)
    try {
      const result = await callHelios(activeTab, analysis, baseline)
      setHeliosInsights(prev => ({
        ...prev,
        [activeTab]: { content: result.content, generatedAt: result.generated_at },
      }))
    } catch (err) {
      setError(err.message || 'Helios encountered an error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Derived state ───────────────────────────────────────────────────────────
  const currentInsight = { health: healthInsight, baseline: baselineInsight, forensic: forensicInsight }[activeTab]
  const activeTabDef   = TABS.find(t => t.id === activeTab)
  const tabIsLocked    = activeTabDef?.locked(hasBaseline) ?? false
  const canGenerate    = !!analysis && !tabIsLocked

  const projectName = analysis?.project_name ?? null
  const statusDot   = loading ? P.cyan : P.online
  const statusLabel = loading ? 'generating' : 'online'

  const buttonLabel = loading ? null
    : currentInsight
      ? (activeTab === 'forensic' ? '↺  Re-run Audit'  : '↺  Rerun')
      : (activeTab === 'forensic' ? '▶  Run Audit'      : '▶  Run Analysis')

  // Feature tiles show when: analysis loaded, no insight for this tab, not loading, tab not locked
  const showFeatureTiles = !!analysis && !currentInsight && !loading && !tabIsLocked

  // Tile click — switches the active tab (lock enforcement in FeatureTile)
  function handleTileSelect(tabId) {
    setActiveTab(tabId)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Component-scoped styles ──────────────────────────────────────── */}
      <style>{`
        @keyframes helios-modal-in {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1);    }
        }
        .helios-dots span {
          opacity: 0;
          animation: helios-dot-appear 1.2s ease-in-out infinite;
        }
        @keyframes helios-dot-appear {
          0%, 60%, 100% { opacity: 0; }
          20%, 40%      { opacity: 1; }
        }
        @keyframes helios-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%      { opacity: 0.4; transform: scale(0.75); }
        }
        @keyframes helios-fadein {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .helios-insight-card { animation: helios-fadein 0.25s ease-out; }
        .helios-tab:hover:not([data-locked="true"]) {
          background: rgba(255,255,255,0.04) !important;
        }
        /* Feature tile hover — not when locked or active */
        .helios-feature-tile:not(:disabled):hover {
          background: #1C2045 !important;
        }
        .helios-scroll::-webkit-scrollbar { width: 4px; }
        .helios-scroll::-webkit-scrollbar-track { background: transparent; }
        .helios-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .helios-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
      `}</style>

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      {open && (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 799, background: 'rgba(0,0,0,0.55)' }} />
      )}

      {/* ── Centred landscape modal ───────────────────────────────────────── */}
      {/*
        Positioned at 50%/50% with translate(-50%,-50%) — centred on screen.
        Width: min(75vw, 860px). Height: auto up to 82vh.
        Stays in DOM when closed (opacity+pointer-events) to preserve state.
        Scale+fade entrance animation.
      */}
      <div style={{
        position:      'fixed',
        top:           '50%',
        left:          '50%',
        transform:     'translate(-50%, -50%)',
        zIndex:        800,
        width:         'min(75vw, 860px)',
        maxHeight:     '82vh',
        background:    P.bg,
        border:        `1px solid ${P.border}`,
        borderRadius:  10,
        display:       'flex',
        flexDirection: 'column',
        boxShadow:     '0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(74,111,232,0.12)',
        opacity:        open ? 1 : 0,
        pointerEvents:  open ? 'auto' : 'none',
        animation:      open ? 'helios-modal-in 0.22s cubic-bezier(0.4,0,0.2,1) forwards' : 'none',
        transition:     'opacity 0.18s ease',
      }}>

        {/* ── Top gradient strip ────────────────────────────────────────── */}
        <div style={{ height: 3, background: P.grad, flexShrink: 0, borderRadius: '10px 10px 0 0' }} />

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{
          padding: '11px 16px 10px', borderBottom: `1px solid ${P.border}`,
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <HeliosAvatar size={34} />

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* SKOPIA · Helios — small-caps monospace label */}
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: P.muted,
              lineHeight: 1, marginBottom: 3,
            }}>
              SKOPIA · Helios
            </div>
            {/* Project name from analysis context */}
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 11,
              color: projectName ? P.mutedMid : P.muted,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {projectName ?? 'AI Schedule Intelligence'}
            </div>
          </div>

          {/* Status dot + label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: statusDot,
              animation: loading ? 'helios-pulse 1.2s ease-in-out infinite' : 'none',
              flexShrink: 0,
            }} />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
              color: loading ? P.cyan : P.online, textTransform: 'lowercase',
            }}>
              {statusLabel}
            </span>
          </div>

          {/* Close × */}
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: P.muted,
              fontSize: 20, cursor: 'pointer', padding: '2px 4px', lineHeight: 1,
              marginLeft: 6, flexShrink: 0, transition: 'color 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = P.textBright}
            onMouseLeave={e => e.currentTarget.style.color = P.muted}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* ── Tab bar ───────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', borderBottom: `1px solid ${P.border}`,
          flexShrink: 0, background: P.bg, padding: '0 2px',
        }}>
          {TABS.map(tab => {
            const isLocked = tab.locked(hasBaseline)
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                className="helios-tab"
                data-locked={isLocked ? 'true' : 'false'}
                onClick={() => !isLocked && setActiveTab(tab.id)}
                title={isLocked ? 'Upload a baseline schedule to enable variance analysis' : undefined}
                style={{
                  flex: 1, fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 10,
                  letterSpacing: '0.04em', padding: '10px 4px 9px', background: 'transparent', border: 'none',
                  borderBottom: isActive ? `2px solid ${tab.accentColour}` : '2px solid transparent',
                  color: isLocked ? P.muted : isActive ? tab.accentColour : '#64748B',
                  cursor: isLocked ? 'not-allowed' : 'pointer', opacity: isLocked ? 0.4 : 1,
                  transition: 'color 0.12s, border-color 0.12s, background 0.1s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 5, whiteSpace: 'nowrap', textTransform: 'uppercase',
                }}
              >
                <span style={{ fontSize: 11 }}>{tab.icon}</span>
                <span style={{ fontSize: 10 }}>{tab.label}</span>
                {isLocked && (
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 7, background: 'rgba(255,255,255,0.06)',
                    borderRadius: 2, padding: '1px 4px', marginLeft: 1, color: P.muted, letterSpacing: '0.04em',
                  }}>
                    {tab.lockLabel}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── Body — two-column landscape split ─────────────────────────── */}
        {/*
          Left (300px fixed): terminal prompt, loading state, error, PDF notice.
          Right (flex:1): insight content card OR selectable feature tiles.
          Both columns are independently scrollable.
          minHeight:0 on the row is required for flex children to scroll correctly.
        */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden', minHeight: 0 }}>

          {/* LEFT — prompt + status area */}
          <div className="helios-scroll" style={{
            width: 300, flexShrink: 0, borderRight: `1px solid ${P.border}`,
            overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10,
          }}>

            {/* No schedule loaded */}
            {!analysis && (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 14, paddingBottom: 40, opacity: 0.5,
              }}>
                <div style={{ fontSize: 32, opacity: 0.25 }}>◈</div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: P.muted,
                  textAlign: 'center', letterSpacing: '0.04em',
                }}>
                  Upload a schedule to generate AI insights
                </div>
              </div>
            )}

            {/* Baseline tab — no baseline uploaded */}
            {analysis && activeTab === 'baseline' && !hasBaseline && (
              <div style={{
                background: 'rgba(74,111,232,0.06)', border: `1px solid rgba(74,111,232,0.2)`,
                borderLeft: `3px solid ${P.peri}`, borderRadius: 4, padding: '12px 14px',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 16, flexShrink: 0, color: P.peri }}>⬆</span>
                <div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 10,
                    color: P.textBright, marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>
                    No baseline loaded
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: P.mutedMid, lineHeight: 1.6 }}>
                    Upload a baseline schedule in the Upload view to enable variance analysis —
                    finish date movement, float erosion, and critical path changes.
                  </div>
                </div>
              </div>
            )}

            {/* Terminal prompt line — shows active mode's prompt text */}
            {analysis && !tabIsLocked && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 10px',
                background: P.surfaceHigh, border: `1px solid ${P.borderSubtle}`, borderRadius: 4,
              }}>
                {/* > prompt character — coloured to match the active mode */}
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  color: activeTabDef?.accentColour ?? P.cyan,
                  flexShrink: 0, marginTop: 1, userSelect: 'none',
                }}>
                  &gt;
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: P.mutedMid, lineHeight: 1.55 }}>
                  {activeTabDef?.prompt}
                </span>
              </div>
            )}

            {/* Loading — typewriter style */}
            {loading && (
              <div style={{ padding: '14px 12px', background: P.surface, border: `1px solid ${P.borderSubtle}`, borderRadius: 4 }}>
                <AnalysingLabel mode={activeTab} />
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                background: 'rgba(220,38,38,0.08)', border: `1px solid rgba(220,38,38,0.25)`,
                borderLeft: `3px solid ${P.fail}`, borderRadius: 4, padding: '9px 12px',
                fontFamily: 'var(--font-mono)', fontSize: 11, color: '#FCA5A5',
                lineHeight: 1.5, letterSpacing: '0.02em',
              }}>
                ⚠  {error}
              </div>
            )}

            {/* PDF indexed notice — pinned to bottom of left column */}
            {currentInsight && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)',
                fontSize: 9, color: P.muted, padding: '3px 2px', letterSpacing: '0.03em', marginTop: 'auto',
              }}>
                <span style={{ color: P.pass, fontSize: 10 }}>✓</span>
                indexed · will appear in next export
              </div>
            )}
          </div>

          {/* RIGHT — insight content OR selectable feature tiles */}
          <div className="helios-scroll" style={{
            flex: 1, overflowY: 'auto', padding: '14px',
            display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
          }}>

            {/* Insight content card */}
            {currentInsight && (
              <div className="helios-insight-card" style={{
                background: P.surface, border: `1px solid ${P.borderSubtle}`,
                borderLeft: `3px solid ${activeTabDef?.accentColour ?? P.cyan}`,
                borderRadius: 4, padding: '14px',
              }}>
                <GeneratedAt isoStr={currentInsight.generatedAt} />
                <InsightContent content={currentInsight.content} mode={activeTab} />
              </div>
            )}

            {/* Selectable feature tiles — visible before first generation */}
            {showFeatureTiles && (
              <div>
                {/* Section label */}
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: P.muted, marginBottom: 10, padding: '0 2px',
                }}>
                  What Helios can do
                </div>

                {/* Three mode tiles — clicking switches activeTab */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {TABS.map(tab => (
                    <FeatureTile
                      key={tab.id}
                      tab={tab}
                      isActive={activeTab === tab.id}
                      isLocked={tab.locked(hasBaseline)}
                      onClick={handleTileSelect}
                    />
                  ))}
                </div>

                {/* Helper hint */}
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, color: P.muted,
                  marginTop: 14, padding: '0 2px', letterSpacing: '0.03em',
                }}>
                  Select a mode above, then click Run Analysis.
                </div>
              </div>
            )}

            {/* Right column empty state when no analysis loaded */}
            {!analysis && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: P.muted,
                  textAlign: 'center', letterSpacing: '0.04em', opacity: 0.5,
                }}>
                  Insights will appear here
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer — Run Analysis button (full width) ─────────────────── */}
        {analysis && !tabIsLocked && (
          <div style={{
            padding: '10px 16px 12px', borderTop: `1px solid ${P.border}`,
            flexShrink: 0, background: P.bg, borderRadius: '0 0 10px 10px',
          }}>
            <button
              onClick={handleGenerate}
              disabled={loading || !canGenerate}
              style={{
                width: '100%', fontFamily: 'var(--font-mono)', fontWeight: 500,
                fontSize: 12, letterSpacing: '0.05em', padding: '10px 0', borderRadius: 4,
                border: loading || !canGenerate
                  ? `1px solid ${P.borderSubtle}`
                  : `1px solid ${(activeTabDef?.accentColour ?? P.cyan)}55`,
                background: loading || !canGenerate
                  ? 'rgba(255,255,255,0.04)'
                  : `${activeTabDef?.accentColour ?? P.cyan}14`,
                color: loading || !canGenerate
                  ? P.muted
                  : activeTab === 'forensic' ? '#FCA5A5' : P.cyan,
                cursor: loading || !canGenerate ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => {
                if (!loading && canGenerate) e.currentTarget.style.background = `${activeTabDef?.accentColour ?? P.cyan}22`
              }}
              onMouseLeave={e => {
                if (!loading && canGenerate) e.currentTarget.style.background = `${activeTabDef?.accentColour ?? P.cyan}14`
              }}
            >
              {loading ? <AnalysingLabel mode={activeTab} /> : buttonLabel}
            </button>
          </div>
        )}

      </div>
    </>
  )
}
