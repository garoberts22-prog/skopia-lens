// ── App.jsx ───────────────────────────────────────────────────────────────────
//
// v0.9.3 changes:
//   - Report Wizard modal (was "Export Health Report"):
//     • Renamed to "Report Wizard"
//     • Section order: Cover/Grade/Stats → Schedule → Critical Path → Analytics
//     • DCMA Checks section removed from wizard (always included in payload;
//       the backend template renders it as part of the cover section)
//     • New "Page Settings" section: page size (A4/A3/Letter/Legal) +
//       orientation (Portrait/Landscape) — sent as _page_settings in payload
//       for the Jinja2 template @page rule
//     • Schedule section note: "Reflects current activity listing"
//   - PdfExportButton unchanged (still in header, opens wizard on click)
//   - All App shell logic unchanged
// v0.9.4 chnages:
//   - Addition of Helios
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useAnalysis } from './context/AnalysisContext'
import { exportPdf }   from './api'
import NavPanel        from './components/NavPanel'
import UploadView      from './pages/UploadView'
import HealthCheckView from './pages/HealthCheckView'
import ScheduleView    from './pages/ScheduleView'
import ConvertView     from './pages/ConvertView'
import HeliosButton    from './components/HeliosButton'
import HeliosPanel     from './components/HeliosPanel'

// ── Shared style tokens ───────────────────────────────────────────────────────
const W = {
  text:   '#1A1A2E',
  muted:  '#6B7280',
  border: '#E2E6F0',
  bg:     '#F7F8FC',
  card:   '#FFFFFF',
  peri:   '#4A6FE8',
  pass:   '#16A34A',
  fail:   '#DC2626',
  grad:   'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Wizard
//
// Three panels inside the modal:
//   A. Report Details  — company name
//   B. Content         — section toggles (ordered per spec)
//   C. Page Settings   — size + orientation
//
// Section order in PDF:
//   1. Cover / Grade / Stats   (always included, can be toggled off)
//   2. Schedule Table          (only shown if schedule_data.activities exists)
//   3. Critical Path Trace
//   4. Analytics
//
// DCMA Checks table is always sent in the payload — the template renders it
// on the same page as the cover stats. It is not exposed as a separate toggle
// because users found it confusing to separate grade from the check evidence.
//
// Page settings are passed as payload._page_settings:
//   { size: 'A4'|'A3'|'Letter'|'Legal', orientation: 'landscape'|'portrait' }
// The backend pdf_export.py must inject these into the @page CSS rule.
//
// ─────────────────────────────────────────────────────────────────────────────
function ReportWizard({ analysis, baselineProp, heliosInsightsProp, onClose }) {
  const hasScheduleData = !!(analysis?.schedule_data?.activities?.length)

  // ── State ──────────────────────────────────────────────────────────────────
  const [companyName,  setCompanyName]  = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [success,      setSuccess]      = useState(false)

  // Content section toggles — ordered as per spec
  // DCMA Checks is always included, not a user toggle
  const [sections, setSections] = useState({
    summary:       true,                // 1. Cover / Grade / Stats
    schedule_data: hasScheduleData,     // 2. Schedule Table (only if data exists)
    longest_path:  true,                // 3. Critical Path Trace
    analytics:     true,                // 4. Analytics
  })

  // Page settings
  const [pageSize,        setPageSize]        = useState('A4')
  const [pageOrientation, setPageOrientation] = useState('landscape')

  // ── Section definitions — rendered in order ────────────────────────────────
  const SECTIONS = [
    {
      key:   'summary',
      label: 'Cover, Grade & Stats',
      desc:  'Project overview, overall health grade, summary statistics, and DCMA check results table',
      icon:  '①',
    },
    // Only show Schedule section when activity data is present
    ...(hasScheduleData ? [{
      key:   'schedule_data',
      label: 'Schedule (Table & Gantt)',
      desc:  'Full activity listing with start, finish, duration, float, and status — reflects current activity listing',
      icon:  '②',
    }] : []),
    {
      key:   'longest_path',
      label: 'Critical Path Trace',
      desc:  'Ordered list of all activities on the longest driving path from start to finish',
      icon:  hasScheduleData ? '③' : '②',
    },
    {
      key:   'analytics',
      label: 'Analytics',
      desc:  'Float distribution histogram, relationship type breakdown, and bottleneck top-10',
      icon:  hasScheduleData ? '④' : '③',
    },
  ]

  // ── Page size options ──────────────────────────────────────────────────────
  const PAGE_SIZES = [
    { value: 'A4',     label: 'A4',     dim: '210 × 297mm' },
    { value: 'A3',     label: 'A3',     dim: '297 × 420mm' },
    { value: 'Letter', label: 'Letter', dim: '8.5 × 11in'  },
    { value: 'Legal',  label: 'Legal',  dim: '8.5 × 14in'  },
  ]

  // ── Helpers ────────────────────────────────────────────────────────────────
  function toggleSection(key) {
    setSections(prev => {
      const next  = { ...prev, [key]: !prev[key] }
      const anyOn = Object.values(next).some(Boolean)
      if (!anyOn) return prev   // always keep at least one section
      return next
    })
  }

  async function handleGenerate() {
    setError(null)
    setLoading(true)

    // Build filtered payload — strip data for unchecked sections
        const payload = { ...analysis }

    // Include Helios AI insights in the PDF payload so the template can
    // render them. Both modes are passed — the template decides what to show.
    // heliosInsights is read from AnalysisContext via the prop passed to
    // ReportWizard (see CHANGE 5 below for the prop threading).
    if (heliosInsightsProp) {
      payload._helios_insights = heliosInsightsProp
    }

    // Fix: include baseline data in payload for variance section
    if (baselineProp) {
      payload._baseline = {
        project_name:    baselineProp.project_name,
        data_date:       baselineProp.data_date,
        overall_grade:   baselineProp.overall_grade,
        overall_score:   baselineProp.overall_score,
        schedule_data:   baselineProp.schedule_data,
        float_histogram: baselineProp.float_histogram,
        longest_path:    baselineProp.longest_path,
        summary_stats:   baselineProp.summary_stats,
      }
    }

    if (!sections.schedule_data) payload.schedule_data    = null
    if (!sections.longest_path)  payload.longest_path     = []
    if (!sections.analytics) {
      payload.float_histogram        = null
      payload.relationship_breakdown = null
      payload.network_metrics        = { ...(payload.network_metrics ?? {}), top_bottlenecks: [] }
    }
    // Note: checks are always included — they're part of the cover/stats page

    // Metadata for the Jinja2 template
    payload._sections     = sections
    payload._company_name = companyName.trim() || null
    payload._page_settings = {
      size:        pageSize,
      orientation: pageOrientation,
      // CSS @page value e.g. "A4 landscape" or "Letter portrait"
      css_size:    `${pageSize} ${pageOrientation}`,
    }

    try {
      await exportPdf(payload, analysis.project_name ?? 'Schedule')
      setSuccess(true)
      setTimeout(() => onClose(), 2200)
    } catch (err) {
      setError(err.message || 'PDF generation failed. Check the backend server is running.')
    } finally {
      setLoading(false)
    }
  }

  function handleBackdrop(e) {
    if (e.target === e.currentTarget && !loading) onClose()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(15,20,40,0.58)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        background: W.card,
        border: `1px solid ${W.border}`,
        borderRadius: 14,
        width: 520,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 48px)',
        overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.24)',
      }}>
        {/* Gradient accent strip */}
        <div style={{ height: 3, background: W.grad, borderRadius: '14px 14px 0 0' }} />

        {/* ── Modal header ─────────────────────────────────────────────────── */}
        <div style={{
          padding: '16px 20px 14px',
          borderBottom: `1px solid ${W.border}`,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 900, fontSize: 15, color: W.text }}>
              Report Wizard
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: W.muted, marginTop: 2 }}>
              {analysis?.project_name ?? 'Schedule'} · Configure your PDF report
            </div>
          </div>
          {!loading && (
            <button
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: W.muted, fontSize: 20, lineHeight: 1, padding: '0 2px', marginTop: -2 }}
              title="Close"
            >×</button>
          )}
        </div>

        {/* ── Modal body ───────────────────────────────────────────────────── */}
        <div style={{ padding: '18px 20px 20px' }}>

          {/* ── Success ────────────────────────────────────────────────────── */}
          {success ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '28px 0' }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14, color: W.pass }}>
                PDF Downloaded
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: W.muted, textAlign: 'center', lineHeight: 1.5 }}>
                Your report has been saved to your downloads folder.
              </div>
            </div>
          ) : (
            <>
              {/* ══ A. Report Details ═══════════════════════════════════════ */}
              <SectionHeader label="Report Details" />

              <div style={{ marginBottom: 20 }}>
                <FieldLabel label="Company Name" optional />
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. Roberts Civil Pty Ltd"
                  maxLength={60}
                  style={{
                    width: '100%', fontFamily: 'var(--font-body)', fontSize: 12,
                    padding: '8px 10px', border: `1px solid ${W.border}`, borderRadius: 6,
                    color: W.text, background: W.bg, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: W.muted, marginTop: 4 }}>
                  Shown in the report header alongside the SKOPIA branding.
                </div>
              </div>

              {/* ══ B. Content ══════════════════════════════════════════════ */}
              <SectionHeader label="Content" />
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: W.muted, marginBottom: 8 }}>
                  Select which sections to include. Sections appear in this order in the PDF.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SECTIONS.map(({ key, label, desc, icon }) => {
                    const checked       = sections[key]
                    const isLast        = checked && Object.values(sections).filter(Boolean).length === 1
                    return (
                      <div
                        key={key}
                        onClick={() => !isLast && toggleSection(key)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '9px 11px', borderRadius: 8,
                          border: `1px solid ${checked ? W.peri : W.border}`,
                          background: checked ? 'rgba(74,111,232,0.05)' : W.card,
                          cursor: isLast ? 'not-allowed' : 'pointer',
                          opacity: isLast ? 0.55 : 1,
                          transition: 'border-color 0.12s, background 0.12s',
                          userSelect: 'none',
                        }}
                      >
                        {/* Order number badge */}
                        <div style={{
                          width: 20, height: 20, borderRadius: 4, flexShrink: 0, marginTop: 1,
                          background: checked ? W.peri : W.border,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
                          color: checked ? '#fff' : W.muted,
                          transition: 'background 0.12s, color 0.12s',
                        }}>
                          {icon}
                        </div>
                        {/* Checkbox */}
                        <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2,
                          border: `1.5px solid ${checked ? W.peri : '#9CA3AF'}`,
                          background: checked ? W.peri : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'background 0.12s, border-color 0.12s',
                        }}>
                          {checked && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                        </div>
                        {/* Text */}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, color: W.text }}>
                            {label}
                          </div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: W.muted, marginTop: 2, lineHeight: 1.45 }}>
                            {desc}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ══ C. Page Settings ════════════════════════════════════════ */}
              <SectionHeader label="Page Settings" />
              <div style={{ marginBottom: 20 }}>

                {/* Page size */}
                <FieldLabel label="Page Size" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 14 }}>
                  {PAGE_SIZES.map(({ value, label, dim }) => {
                    const sel = pageSize === value
                    return (
                      <div
                        key={value}
                        onClick={() => setPageSize(value)}
                        style={{
                          padding: '8px 6px', borderRadius: 7, textAlign: 'center',
                          border: `1px solid ${sel ? W.peri : W.border}`,
                          background: sel ? 'rgba(74,111,232,0.07)' : W.card,
                          cursor: 'pointer', userSelect: 'none',
                          transition: 'border-color 0.12s, background 0.12s',
                        }}
                      >
                        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, color: sel ? W.peri : W.text }}>{label}</div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: W.muted, marginTop: 2 }}>{dim}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Orientation */}
                <FieldLabel label="Orientation" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { value: 'landscape', label: 'Landscape', icon: '⬜', note: 'Recommended for schedule tables' },
                    { value: 'portrait',  label: 'Portrait',  icon: '⬜', note: 'Recommended for short reports' },
                  ].map(({ value, label, note }) => {
                    const sel = pageOrientation === value
                    return (
                      <div
                        key={value}
                        onClick={() => setPageOrientation(value)}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 9,
                          padding: '9px 11px', borderRadius: 7,
                          border: `1px solid ${sel ? W.peri : W.border}`,
                          background: sel ? 'rgba(74,111,232,0.05)' : W.card,
                          cursor: 'pointer', userSelect: 'none',
                          transition: 'border-color 0.12s, background 0.12s',
                        }}
                      >
                        {/* Orientation diagram */}
                        <div style={{
                          flexShrink: 0, marginTop: 1,
                          width:  value === 'landscape' ? 22 : 16,
                          height: value === 'landscape' ? 16 : 22,
                          border: `2px solid ${sel ? W.peri : '#9CA3AF'}`,
                          borderRadius: 2,
                          transition: 'border-color 0.12s',
                        }} />
                        <div>
                          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, color: sel ? W.peri : W.text }}>{label}</div>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: W.muted, marginTop: 2 }}>{note}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── Error ────────────────────────────────────────────────── */}
              {error && (
                <div style={{ marginBottom: 14, padding: '9px 12px', background: '#FEF2F2', border: `1px solid ${W.fail}`, borderRadius: 6, fontFamily: 'var(--font-body)', fontSize: 11, color: W.fail }}>
                  ⚠ {error}
                </div>
              )}

              {/* ── Actions ──────────────────────────────────────────────── */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={onClose}
                  disabled={loading}
                  style={{
                    fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12,
                    padding: '9px 18px', borderRadius: 7,
                    border: `1px solid ${W.border}`, background: W.bg,
                    color: W.muted, cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  style={{
                    fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12,
                    padding: '9px 22px', borderRadius: 7, border: 'none',
                    background: loading ? '#E5E7EB' : W.grad,
                    color: loading ? '#9CA3AF' : '#ffffff',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 7,
                    minWidth: 148, justifyContent: 'center',
                    transition: 'background 0.15s',
                  }}
                >
                  {loading ? (
                    <>
                      <span style={{
                        display: 'inline-block', width: 12, height: 12,
                        border: '2px solid #D1D5DB', borderTopColor: '#6B7280',
                        borderRadius: '50%', animation: 'pdfSpin 0.7s linear infinite',
                      }} />
                      Generating…
                    </>
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Generate PDF
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>

        <style>{`@keyframes pdfSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}

// ── Small shared sub-components ───────────────────────────────────────────────

// Section divider header inside the wizard body
function SectionHeader({ label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
    }}>
      <div style={{ height: 1, background: W.border, flex: 1 }} />
      <div style={{
        fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
        color: W.muted, textTransform: 'uppercase', letterSpacing: '0.07em',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </div>
      <div style={{ height: 1, background: W.border, flex: 1 }} />
    </div>
  )
}

// Field label with optional "optional" tag
function FieldLabel({ label, optional }) {
  return (
    <div style={{
      fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
      color: W.muted, textTransform: 'uppercase', letterSpacing: '0.07em',
      marginBottom: 6,
    }}>
      {label}
      {optional && (
        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 4, fontSize: 10 }}>
          (optional)
        </span>
      )}
    </div>
  )
}

// ── Header Export PDF button ───────────────────────────────────────────────────
// Opens the wizard on click — does NOT fire the export directly.
function PdfExportButton({ onOpenWizard }) {
  return (
    <button
      onClick={onOpenWizard}
      title="Open Report Wizard to configure and export PDF"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 14px', height: 30,
        border: 'none', borderRadius: 6,
        background: W.grad, color: '#ffffff',
        fontFamily: 'var(--font-head)',
        fontSize: 11, fontWeight: 700,
        cursor: 'pointer',
        letterSpacing: '0.04em', whiteSpace: 'nowrap',
        flexShrink: 0, transition: 'opacity 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export PDF
    </button>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────
function EmptyState({ label, onUpload }) {
  return (
    <div style={{ flex: 1, background: '#F7F8FC', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: 48, opacity: 0.12 }}>◈</div>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 16, color: '#6B7280' }}>{label}</div>
      <button onClick={onUpload} style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, background: W.grad, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer' }}>
        Upload Schedule
      </button>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [view,           setView]          = useState('upload')
  const [showWizard,     setShowWizard]    = useState(false)
  const { analysis, baseline, heliosInsights } = useAnalysis()
  const [showHelios, setShowHelios] = useState(false)
  const hasData = !!analysis

  function fmtDataDate(isoStr) {
    if (!isoStr) return null
    const d = new Date(isoStr)
    if (isNaN(d)) return null
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── App header ──────────────────────────────────────────────────────── */}
      <div style={{ background: '#1E1E1E', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 65 }}>

          <span style={{ fontFamily: 'var(--font-head)', fontSize: 25, fontWeight: 900, background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', flexShrink: 0 }}>
            SKOPIA
          </span>
          <span style={{ color: '#475569', fontSize: 17, fontFamily: 'var(--font-head)', fontWeight: 700, flexShrink: 0 }}>
            .lens
          </span>

          {hasData && <>
            <div style={{ width: 1, height: 18, background: '#334155', flexShrink: 0 }} />
            <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-head)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {analysis.project_name}
            </span>
            <span style={{
              background: analysis.source_format === 'xer' ? 'linear-gradient(135deg,#1EC8D4,#3AACE0)' : 'linear-gradient(135deg,#D97706,#B45309)',
              color: '#fff', fontSize: 10, fontFamily: 'var(--font-mono)',
              fontWeight: 700, padding: '2px 8px', borderRadius: 4, flexShrink: 0,
            }}>
              {analysis.source_format?.toUpperCase()}
            </span>

          </>}

          <div style={{ flex: 1 }} />

          {/* Export PDF — opens wizard, visible on health + schedule views */}
          {hasData && (view === 'health' || view === 'schedule') && (
            <PdfExportButton onOpenWizard={() => setShowWizard(true)} />
          )}
        </div>
        <div style={{ background: 'var(--grad)', height: 3 }} />
      </div>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <NavPanel activeView={view} setView={setView} analysis={analysis} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {view === 'upload'   && <UploadView onNavigate={setView} />}
          {view === 'health'   && (hasData ? <HealthCheckView onNavigate={setView} /> : <EmptyState label="No schedule loaded" onUpload={() => setView('upload')} />)}
          {view === 'schedule' && (hasData ? <ScheduleView onNavigate={setView} />    : <EmptyState label="No schedule loaded" onUpload={() => setView('upload')} />)}
          {view === 'convert'  && <ConvertView />}
        </div>
      </div>

      {/* ── Report Wizard modal ──────────────────────────────────────────────── */}
      {showWizard && analysis && (
        <ReportWizard
          analysis={analysis}
          baselineProp={baseline}
          heliosInsightsProp={heliosInsights}
          onClose={() => setShowWizard(false)}
        />
      )}
      {/* ── Helios FAB + Panel ────────────────────────────────────────────── */}
      <HeliosButton
        onClick={() => setShowHelios(v => !v)}
        hasData={hasData}
        active={showHelios}
        hasNew={
          // Show new-insight dot when insights exist but panel is closed
          !showHelios && (
            !!(heliosInsights?.health) || !!(heliosInsights?.baseline)
          )
        }
      />
      <HeliosPanel
        open={showHelios}
        onClose={() => setShowHelios(false)}
      />

    </div>
  )
}
