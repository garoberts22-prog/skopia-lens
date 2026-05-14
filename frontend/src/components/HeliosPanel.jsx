// ── HeliosPanel.jsx ───────────────────────────────────────────────────────────
//
// Slide-in AI insights panel — triggered by HeliosButton.
//
// LAYOUT:
//   Fixed panel, right edge of viewport, full height.
//   Slides in from right on open. Dark theme (#1E1E1E background).
//   Two tab modes: Health Insights | Baseline Variance.
//   Baseline tab is greyed out with a prompt when no baseline is loaded.
//
// DATA FLOW:
//   Reads analysis + baseline + heliosInsights from AnalysisContext.
//   On "Generate", POSTs to /api/helios and stores the result in context
//   via setHeliosInsights — persists across navigation and feeds PDF export.
//
// PROPS:
//   open      bool    — controls slide-in/out
//   onClose   fn      — called when × is clicked or backdrop is clicked
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useAnalysis } from '../context/AnalysisContext'

// ── Colour tokens — dark theme for the panel ─────────────────────────────────
const P = {
  bg:       '#1E1E1E',          // charcoal — matches app header
  surface:  '#262637',          // slightly lighter card surface
  border:   'rgba(74,111,232,0.25)',
  text:     '#E2E8F0',
  muted:    '#64748B',
  cyan:     '#1EC8D4',
  peri:     '#4A6FE8',
  grad:     'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
  pass:     '#16A34A',
  warn:     '#D97706',
  fail:     '#DC2626',
}

// ── API call helper ────────────────────────────────────────────────────────────
async function callHelios(mode, analysis, baseline) {
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

  const resp = await fetch(`${API_BASE}/api/helios`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ mode, analysis, baseline: baseline ?? null }),
  })

  const body = await resp.json()

  if (!resp.ok) {
    // Surface backend error message where possible
    throw new Error(
      body?.detail?.message ||
      body?.detail ||
      `HTTP ${resp.status}`
    )
  }

  return body   // { mode, content, generated_at }
}

// ── Insight content renderer ──────────────────────────────────────────────────
// Renders the plain-text response from Helios with basic formatting:
//   **Bold heading** → styled heading
//   Numbered lists (1. 2. 3.) → preserved
//   Blank lines → paragraph breaks
function InsightContent({ content }) {
  if (!content) return null

  // Split into lines, convert **text** to bold spans
  const lines = content.split('\n')

  return (
    <div style={{
      fontFamily: 'var(--font-body)',
      fontSize:   13,
      color:      P.text,
      lineHeight: 1.7,
    }}>
      {lines.map((line, i) => {
        // Empty line → spacer
        if (!line.trim()) {
          return <div key={i} style={{ height: 8 }} />
        }

        // Bold heading (wrapped in **...**)
        if (/^\*\*(.+)\*\*$/.test(line.trim())) {
          const heading = line.trim().replace(/\*\*/g, '')
          return (
            <div key={i} style={{
              fontFamily:  'var(--font-head)',
              fontWeight:  700,
              fontSize:    12,
              color:       P.cyan,
              marginTop:   12,
              marginBottom: 4,
              letterSpacing: '0.02em',
            }}>
              {heading}
            </div>
          )
        }

        // Inline bold within a line — replace **x** with <strong>
        const parts = line.split(/(\*\*[^*]+\*\*)/)
        return (
          <div key={i} style={{ marginBottom: 2 }}>
            {parts.map((part, j) =>
              /^\*\*(.+)\*\*$/.test(part)
                ? <strong key={j} style={{ color: P.text, fontWeight: 600 }}>
                    {part.replace(/\*\*/g, '')}
                  </strong>
                : <span key={j}>{part}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Timestamp display ─────────────────────────────────────────────────────────
function GeneratedAt({ isoStr }) {
  if (!isoStr) return null
  try {
    const d = new Date(isoStr)
    const fmt = d.toLocaleString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: P.muted, marginBottom: 12 }}>
        Generated {fmt}
      </div>
    )
  } catch {
    return null
  }
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function HeliosPanel({ open, onClose }) {
  const { analysis, baseline, heliosInsights, setHeliosInsights } = useAnalysis()

  // 'health' | 'baseline'
  const [activeTab, setActiveTab] = useState('health')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)

  const hasBaseline    = !!baseline
  const healthInsight  = heliosInsights?.health   ?? null
  const baselineInsight= heliosInsights?.baseline ?? null

  // ── Generate handler ────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!analysis) return
    if (activeTab === 'baseline' && !hasBaseline) return

    setError(null)
    setLoading(true)

    try {
      const result = await callHelios(activeTab, analysis, baseline)

      // Store in context — persists across navigation, feeds PDF export
      setHeliosInsights(prev => ({
        ...prev,
        [activeTab]: {
          content:     result.content,
          generatedAt: result.generated_at,
        },
      }))
    } catch (err) {
      setError(err.message || 'Helios encountered an error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Current tab's stored insight ────────────────────────────────────────────
  const currentInsight = activeTab === 'health' ? healthInsight : baselineInsight
  const canGenerate    = analysis && (activeTab === 'health' || hasBaseline)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes helios-panel-slide {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes helios-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* ── Backdrop (click to close) ──────────────────────────────────── */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position:   'fixed',
            inset:      0,
            zIndex:     799,
            background: 'rgba(0,0,0,0.25)',
          }}
        />
      )}

      {/* ── Panel ─────────────────────────────────────────────────────── */}
      <div style={{
        position:   'fixed',
        top:        0,
        right:      0,
        bottom:     0,
        width:      380,
        zIndex:     800,
        background: P.bg,
        borderLeft: `1px solid ${P.border}`,
        display:    'flex',
        flexDirection: 'column',
        boxShadow:  '-8px 0 32px rgba(0,0,0,0.4)',
        transform:  open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
        // Panel stays in DOM (just off-screen) so state persists on close
      }}>

        {/* ── Gradient accent strip ──────────────────────────────────────── */}
        <div style={{ height: 3, background: P.grad, flexShrink: 0 }} />

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{
          padding:      '14px 16px 12px',
          borderBottom: `1px solid ${P.border}`,
          flexShrink:   0,
          display:      'flex',
          alignItems:   'center',
          gap:          10,
        }}>
          {/* Helios mini-avatar */}
<svg
  width="34"
  height="34"
  viewBox="0 0 76 76"
  style={{
    flexShrink: 0,
    filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.28))',
  }}
>
  <defs>
    {/* Main Orb Gradient */}
    <radialGradient id="panel-helios-core" cx="35%" cy="18%" r="72%">
      <stop offset="0%" stopColor="#DDFBFF" />
      <stop offset="22%" stopColor="#6BE8FF" />
      <stop offset="58%" stopColor="#2875FF" />
      <stop offset="100%" stopColor="#4129E8" />
    </radialGradient>

    {/* Cyan Wave */}
    <linearGradient id="panel-wave-cyan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor="#A8FFFF" stopOpacity="0.95" />
      <stop offset="100%" stopColor="#17B6FF" stopOpacity="0.72" />
    </linearGradient>

    {/* Purple Wave */}
    <linearGradient id="panel-wave-purple" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor="#C9C4FF" stopOpacity="0.82" />
      <stop offset="100%" stopColor="#9652FF" stopOpacity="0.72" />
    </linearGradient>

    {/* Glass Shine */}
    <radialGradient id="panel-shine-top" cx="30%" cy="16%" r="50%">
      <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.92" />
      <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
    </radialGradient>

    <clipPath id="panel-heliosClip">
      <circle cx="38" cy="38" r="35" />
    </clipPath>
  </defs>

  {/* Base Orb */}
  <circle cx="38" cy="38" r="35" fill="url(#panel-helios-core)" />

  {/* Layered Bands */}
  <g clipPath="url(#panel-heliosClip)">
    {/* Top Cyan */}
    <path
      d="M-8 18 C16 8, 38 8, 86 22 L86 34 C54 28, 24 28, -8 32 Z"
      fill="url(#panel-wave-cyan)"
      opacity="0.9"
    />

    {/* Purple Middle */}
    <path
      d="M-8 31 C18 24, 42 24, 86 32 L86 52 C56 46, 24 46, -8 50 Z"
      fill="url(#panel-wave-purple)"
      opacity="0.92"
    />

    {/* Bottom Cyan */}
    <path
      d="M-8 52 C18 42, 42 44, 86 58 L86 86 L-8 86 Z"
      fill="url(#panel-wave-cyan)"
      opacity="0.72"
    />

    {/* Large Gloss Reflection */}
    <ellipse
      cx="58"
      cy="24"
      rx="12"
      ry="22"
      fill="#FFFFFF"
      opacity="0.14"
    />

    {/* Secondary Reflection */}
    <ellipse
      cx="20"
      cy="58"
      rx="18"
      ry="8"
      fill="#8FFFFF"
      opacity="0.08"
    />
  </g>

  {/* Top Shine */}
  <circle cx="38" cy="38" r="35" fill="url(#panel-shine-top)" />

  {/* Left Eye */}
  <g>
    <ellipse cx="26" cy="34" rx="9" ry="10.5" fill="#FFFFFF" />
    <ellipse cx="27" cy="35" rx="6.2" ry="7.4" fill="#1841FF" />
    <ellipse cx="28" cy="38" rx="3.8" ry="4.6" fill="#32F2FF" />

    <ellipse
      cx="24"
      cy="31"
      rx="3.2"
      ry="4.1"
      fill="#FFFFFF"
    />

    <circle
      cx="30"
      cy="39"
      r="1.5"
      fill="#FFFFFF"
      opacity="0.95"
    />
  </g>

  {/* Right Eye */}
  <g>
    <ellipse cx="50" cy="34" rx="9" ry="10.5" fill="#FFFFFF" />
    <ellipse cx="51" cy="35" rx="6.2" ry="7.4" fill="#1841FF" />
    <ellipse cx="52" cy="38" rx="3.8" ry="4.6" fill="#32F2FF" />

    <ellipse
      cx="48"
      cy="31"
      rx="3.2"
      ry="4.1"
      fill="#FFFFFF"
    />

    <circle
      cx="54"
      cy="39"
      r="1.5"
      fill="#FFFFFF"
      opacity="0.95"
    />
  </g>

  {/* Pink Cheeks */}
  <ellipse
    cx="17"
    cy="44"
    rx="4"
    ry="2.4"
    fill="#FFD7FF"
    opacity="0.72"
  />

  <ellipse
    cx="59"
    cy="44"
    rx="4"
    ry="2.4"
    fill="#FFD7FF"
    opacity="0.72"
  />

  {/* Smile Shadow */}
  <path
    d="M25 46 Q38 60 51 47"
    fill="none"
    stroke="rgba(0,0,0,0.22)"
    strokeWidth="4"
    strokeLinecap="round"
  />

  {/* Main Smile */}
  <path
    d="M25 46 Q38 58 51 46"
    fill="none"
    stroke="#FFFFFF"
    strokeWidth="2"
    strokeLinecap="round"
  />

  {/* Smile Highlight */}
  <path
    d="M26 45 Q38 56 50 45"
    fill="none"
    stroke="rgba(255,255,255,0.6)"
    strokeWidth="1"
    strokeLinecap="round"
  />

  {/* Outer Glass Ring */}
  <circle
    cx="38"
    cy="38"
    r="35"
    fill="none"
    stroke="rgba(255,255,255,0.22)"
    strokeWidth="1.2"
  />
</svg>

          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 900, fontSize: 14, color: P.text }}>
              Helios
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: P.muted, marginTop: 1 }}>
              AI Schedule Intelligence
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: P.muted, fontSize: 20, cursor: 'pointer',
              padding: '2px 4px', lineHeight: 1,
            }}
            title="Close"
          >×</button>
        </div>

        {/* ── Mode tabs ──────────────────────────────────────────────────── */}
        <div style={{
          display:      'flex',
          borderBottom: `1px solid ${P.border}`,
          flexShrink:   0,
          padding:      '0 16px',
          gap:          2,
        }}>
          {[
            { id: 'health',   label: 'Health Insights', icon: '◈' },
            { id: 'baseline', label: 'Baseline Variance', icon: '⇄',
              locked: !hasBaseline },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => !tab.locked && setActiveTab(tab.id)}
              title={tab.locked ? 'Upload a baseline schedule to enable variance analysis' : undefined}
              style={{
                fontFamily:     'var(--font-head)',
                fontWeight:     700,
                fontSize:       11,
                padding:        '10px 10px 9px',
                background:     'transparent',
                border:         'none',
                borderBottom:   activeTab === tab.id
                  ? `2px solid ${P.cyan}`
                  : '2px solid transparent',
                color:          tab.locked
                  ? P.muted
                  : activeTab === tab.id ? P.cyan : '#94A3B8',
                cursor:         tab.locked ? 'not-allowed' : 'pointer',
                opacity:        tab.locked ? 0.45 : 1,
                transition:     'color 0.12s, border-color 0.12s',
                display:        'flex',
                alignItems:     'center',
                gap:            5,
                whiteSpace:     'nowrap',
              }}
            >
              <span style={{ fontSize: 13 }}>{tab.icon}</span>
              {tab.label}
              {tab.locked && (
                <span style={{
                  fontFamily:   'var(--font-mono)',
                  fontSize:     8,
                  background:   'rgba(255,255,255,0.08)',
                  borderRadius: 3,
                  padding:      '1px 5px',
                  marginLeft:   2,
                  color:        P.muted,
                }}>
                  no baseline
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div style={{
          flex:       1,
          overflowY:  'auto',
          padding:    '16px',
          display:    'flex',
          flexDirection: 'column',
          gap:        12,
        }}>

          {/* ── No schedule loaded state ─────────────────────────────────── */}
          {!analysis && (
            <div style={{
              flex:           1,
              display:        'flex',
              flexDirection:  'column',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            12,
              opacity:        0.55,
              paddingBottom:  40,
            }}>
              <div style={{ fontSize: 36, opacity: 0.3 }}>◈</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: P.muted, textAlign: 'center' }}>
                Upload a schedule to generate AI insights
              </div>
            </div>
          )}

          {/* ── Baseline tab: no baseline prompt ─────────────────────────── */}
          {analysis && activeTab === 'baseline' && !hasBaseline && (
            <div style={{
              background:   'rgba(74,111,232,0.08)',
              border:       `1px solid ${P.border}`,
              borderRadius: 8,
              padding:      '14px 14px',
              display:      'flex',
              gap:          10,
              alignItems:   'flex-start',
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>⬆</span>
              <div>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, color: P.text, marginBottom: 4 }}>
                  No baseline loaded
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: P.muted, lineHeight: 1.6 }}>
                  Upload a baseline schedule in the Upload view to enable
                  variance analysis — finish date movement, float erosion,
                  and critical path changes.
                </div>
              </div>
            </div>
          )}

          {/* ── Mode description chip ─────────────────────────────────────── */}
          {analysis && (activeTab === 'health' || hasBaseline) && (
            <div style={{
              background:   'rgba(30,200,212,0.07)',
              border:       `1px solid rgba(30,200,212,0.2)`,
              borderRadius: 6,
              padding:      '8px 12px',
              fontFamily:   'var(--font-body)',
              fontSize:     11,
              color:        '#94DCDF',
              lineHeight:   1.5,
            }}>
              {activeTab === 'health'
                ? '◈  Helios will rank the top schedule risks from your health check data, float distribution, and critical path.'
                : '⇄  Helios will compare your current schedule against the baseline — finish date movement, float erosion, and critical path changes.'
              }
            </div>
          )}

          {/* ── Error display ─────────────────────────────────────────────── */}
          {error && (
            <div style={{
              background:   'rgba(220,38,38,0.1)',
              border:       `1px solid rgba(220,38,38,0.3)`,
              borderRadius: 6,
              padding:      '9px 12px',
              fontFamily:   'var(--font-body)',
              fontSize:     12,
              color:        '#FCA5A5',
              lineHeight:   1.5,
            }}>
              ⚠ {error}
            </div>
          )}

          {/* ── Stored insight content ─────────────────────────────────────── */}
          {currentInsight && (
            <div style={{
              background:   P.surface,
              border:       `1px solid ${P.border}`,
              borderRadius: 8,
              padding:      '14px',
            }}>
              <GeneratedAt isoStr={currentInsight.generatedAt} />
              <InsightContent content={currentInsight.content} />
            </div>
          )}

          {/* ── Saved to PDF notice ────────────────────────────────────────── */}
          {currentInsight && (
            <div style={{
              display:    'flex',
              alignItems: 'center',
              gap:        6,
              fontFamily: 'var(--font-body)',
              fontSize:   10,
              color:      P.muted,
              padding:    '4px 2px',
            }}>
              <span style={{ fontSize: 12 }}>✓</span>
              Insights saved — included in next PDF export
            </div>
          )}

        </div>

        {/* ── Footer: Generate button ────────────────────────────────────── */}
        {analysis && (activeTab === 'health' || hasBaseline) && (
          <div style={{
            padding:    '12px 16px',
            borderTop:  `1px solid ${P.border}`,
            flexShrink: 0,
            display:    'flex',
            gap:        8,
          }}>
            <button
              onClick={handleGenerate}
              disabled={loading || !canGenerate}
              style={{
                flex:        1,
                fontFamily:  'var(--font-head)',
                fontWeight:  700,
                fontSize:    12,
                padding:     '10px 0',
                borderRadius: 7,
                border:      'none',
                background:  loading || !canGenerate ? 'rgba(255,255,255,0.08)' : P.grad,
                color:       loading || !canGenerate ? P.muted : '#ffffff',
                cursor:      loading || !canGenerate ? 'not-allowed' : 'pointer',
                display:     'flex',
                alignItems:  'center',
                justifyContent: 'center',
                gap:         7,
                transition:  'background 0.15s, opacity 0.15s',
              }}
            >
              {loading ? (
                <>
                  <div style={{
                    width: 12, height: 12,
                    border: '2px solid rgba(255,255,255,0.2)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'helios-spin 0.7s linear infinite',
                  }} />
                  Analysing…
                </>
              ) : (
                <>
                  ✦&nbsp;{currentInsight ? 'Regenerate Insights' : 'Generate Insights'}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
