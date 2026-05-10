// ── App.jsx ───────────────────────────────────────────────────────────────────
//
// v1.3 changes (lazy schedule_data):
//   - Calls loadScheduleData() from AnalysisContext when user navigates to
//     the Schedule view (view === 'schedule'). Idempotent — safe to call
//     on every navigation, context no-ops if already loaded.
//   - ReportWizard now reads scheduleData from context separately and merges
//     it into the PDF payload only when generating. The wizard's
//     hasScheduleData check now reads from context.scheduleData rather than
//     analysis.schedule_data (which no longer exists in v1.3).
//   - All other App shell logic unchanged from v0.9.3.
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useAnalysis } from './context/AnalysisContext'
import { exportPdf }   from './api'
import NavPanel        from './components/NavPanel'
import UploadView      from './pages/UploadView'
import HealthCheckView from './pages/HealthCheckView'
import ScheduleView    from './pages/ScheduleView'
import ConvertView     from './pages/ConvertView'

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
// v1.3: scheduleData is no longer in analysis — it's separate context state.
// The wizard receives it as a prop and merges it into the payload on generate.
// hasScheduleData is derived from the scheduleData prop (not analysis).
// ─────────────────────────────────────────────────────────────────────────────
function ReportWizard({ analysis, scheduleData, onClose }) {
  // scheduleData may be null if the user hasn't opened Schedule view yet
  // (session still valid but Gantt not fetched). The wizard shows the Schedule
  // section as unavailable in that case, matching the previous behaviour when
  // schedule_data was absent from the analysis object.
  const hasScheduleData = !!(scheduleData?.activities?.length)

  const [companyName,  setCompanyName]  = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [success,      setSuccess]      = useState(false)

  const [sections, setSections] = useState({
    summary:       true,
    schedule_data: hasScheduleData,
    longest_path:  true,
    analytics:     true,
  })

  const [pageSize,        setPageSize]        = useState('A4')
  const [pageOrientation, setPageOrientation] = useState('landscape')

  const SECTIONS = [
    {
      key:   'summary',
      label: 'Cover, Grade & Stats',
      desc:  'Project overview, overall health grade, summary statistics, and DCMA check results table',
      icon:  '①',
    },
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

  const PAGE_SIZES = [
    { value: 'A4',     label: 'A4',     dim: '210 × 297mm' },
    { value: 'A3',     label: 'A3',     dim: '297 × 420mm' },
    { value: 'Letter', label: 'Letter', dim: '8.5 × 11in'  },
    { value: 'Legal',  label: 'Legal',  dim: '8.5 × 14in'  },
  ]

  function toggleSection(key) {
    setSections(prev => {
      const next  = { ...prev, [key]: !prev[key] }
      const anyOn = Object.values(next).some(Boolean)
      if (!anyOn) return prev
      return next
    })
  }

  async function handleGenerate() {
    setError(null)
    setLoading(true)

    // Merge scheduleData into the payload — backend PDF template expects
    // analysis.schedule_data if the Schedule section is included.
    const payload = {
      ...analysis,
      // Attach scheduleData under the key the PDF template expects.
      // If the section is toggled off, this stays null (filtered below).
      schedule_data: scheduleData ?? null,
    }

    if (!sections.schedule_data) payload.schedule_data    = null
    if (!sections.longest_path)  payload.longest_path     = []
    if (!sections.analytics) {
      payload.float_histogram        = null
      payload.relationship_breakdown = null
      payload.network_metrics        = { ...(payload.network_metrics ?? {}), top_bottlenecks: [] }
    }

    payload._sections      = sections
    payload._company_name  = companyName.trim() || null
    payload._page_settings = {
      size:        pageSize,
      orientation: pageOrientation,
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

        {/* ── Modal header ──────────────────────────────────────────────────── */}
        <div style={{
          padding: '16px 20px 14px',
          borderBottom: `1px solid ${W.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 900, fontSize: 15, color: W.text }}>
              Report Wizard
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: W.muted, marginTop: 2 }}>
              Configure and export your SKOPIA health report
            </div>
          </div>
          <button
            onClick={() => !loading && onClose()}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: W.muted, fontSize: 18, lineHeight: 1, padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Modal body ────────────────────────────────────────────────────── */}
        <div style={{ padding: '18px 20px 20px' }}>

          {success ? (
            // ── Success state ───────────────────────────────────────────────
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{
                fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 15,
                color: W.pass, marginBottom: 6,
              }}>
                PDF downloaded
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: W.muted }}>
                Check your Downloads folder
              </div>
            </div>
          ) : (
            <>
              {/* ── A. Report Details ──────────────────────────────────────── */}
              <SectionHeader label="Report Details" />
              <div style={{ marginBottom: 18 }}>
                <FieldLabel label="Company name" optional />
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="Your company name (appears on cover)"
                  disabled={loading}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    border: `1px solid ${W.border}`, borderRadius: 6,
                    padding: '8px 11px', fontSize: 13,
                    fontFamily: 'var(--font-body)', color: W.text,
                    background: loading ? W.bg : W.card, outline: 'none',
                  }}
                />
              </div>

              {/* ── B. Content ────────────────────────────────────────────── */}
              <SectionHeader label="Content" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
                {SECTIONS.map(sec => (
                  <label
                    key={sec.key}
                    style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start',
                      background: sections[sec.key] ? '#F0F7FF' : W.bg,
                      border: `1px solid ${sections[sec.key] ? '#BFDBFE' : W.border}`,
                      borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                      transition: 'all 0.12s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!sections[sec.key]}
                      onChange={() => toggleSection(sec.key)}
                      disabled={loading}
                      style={{ marginTop: 2, accentColor: W.peri, flexShrink: 0 }}
                    />
                    <div>
                      <div style={{
                        fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12,
                        color: W.text, marginBottom: 2,
                      }}>
                        {sec.icon} {sec.label}
                      </div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: W.muted, lineHeight: 1.5 }}>
                        {sec.desc}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* ── C. Page Settings ──────────────────────────────────────── */}
              <SectionHeader label="Page Settings" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>

                {/* Page size */}
                <div>
                  <FieldLabel label="Page size" />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {PAGE_SIZES.map(ps => (
                      <button
                        key={ps.value}
                        onClick={() => setPageSize(ps.value)}
                        disabled={loading}
                        style={{
                          fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
                          padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
                          border: `1.5px solid ${pageSize === ps.value ? W.peri : W.border}`,
                          background: pageSize === ps.value ? '#EEF2FF' : W.card,
                          color: pageSize === ps.value ? W.peri : W.muted,
                        }}
                      >
                        {ps.label}
                        <span style={{ fontWeight: 400, fontSize: 9, display: 'block', opacity: 0.8 }}>
                          {ps.dim}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientation */}
                <div>
                  <FieldLabel label="Orientation" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {['landscape', 'portrait'].map(orient => (
                      <label
                        key={orient}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12,
                          color: pageOrientation === orient ? W.text : W.muted,
                        }}
                      >
                        <input
                          type="radio"
                          name="orientation"
                          value={orient}
                          checked={pageOrientation === orient}
                          onChange={() => setPageOrientation(orient)}
                          disabled={loading}
                          style={{ accentColor: W.peri }}
                        />
                        {orient.charAt(0).toUpperCase() + orient.slice(1)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Error ─────────────────────────────────────────────────── */}
              {error && (
                <div style={{
                  background: '#FEF2F2', border: `1px solid #FECACA`,
                  borderRadius: 7, padding: '10px 13px', marginBottom: 16,
                  fontFamily: 'var(--font-body)', fontSize: 12.5, color: W.fail,
                }}>
                  {error}
                </div>
              )}

              {/* ── Generate button ───────────────────────────────────────── */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  onClick={() => !loading && onClose()}
                  disabled={loading}
                  style={{
                    fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12,
                    padding: '9px 18px', borderRadius: 7, cursor: 'pointer',
                    border: `1px solid ${W.border}`,
                    background: W.card, color: W.muted,
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

function SectionHeader({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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
  const [view,       setView]       = useState('upload')
  const [showWizard, setShowWizard] = useState(false)

  // v1.3: pull scheduleData + loadScheduleData from context
  const { analysis, scheduleData, loadScheduleData } = useAnalysis()
  const hasData = !!analysis

  // ── Navigate to a view — trigger lazy Gantt fetch when going to Schedule ──
  function handleSetView(newView) {
    setView(newView)
    // Kick off the lazy fetch when the user navigates to Schedule view.
    // loadScheduleData() is idempotent — safe to call on every nav click.
    if (newView === 'schedule' && analysis) {
      loadScheduleData()
    }
  }

  function fmtDataDate(isoStr) {
    if (!isoStr) return null
    const d = new Date(isoStr)
    if (isNaN(d)) return null
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── App header ────────────────────────────────────────────────────── */}
      <div style={{ background: '#1E1E1E', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 48 }}>

          <span style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900, background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', flexShrink: 0 }}>
            SKOPIA
          </span>
          <span style={{ color: '#475569', fontSize: 13, fontFamily: 'var(--font-head)', fontWeight: 700, flexShrink: 0 }}>
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

          {hasData && (view === 'health' || view === 'schedule') && (
            <PdfExportButton onOpenWizard={() => setShowWizard(true)} />
          )}
        </div>
        <div style={{ background: 'var(--grad)', height: 3 }} />
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* NavPanel uses handleSetView so Schedule nav triggers the lazy fetch */}
        <NavPanel activeView={view} setView={handleSetView} analysis={analysis} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {view === 'upload'   && <UploadView   onNavigate={handleSetView} />}
          {view === 'health'   && (hasData ? <HealthCheckView onNavigate={handleSetView} /> : <EmptyState label="No schedule loaded" onUpload={() => handleSetView('upload')} />)}
          {view === 'schedule' && (hasData ? <ScheduleView   onNavigate={handleSetView} /> : <EmptyState label="No schedule loaded" onUpload={() => handleSetView('upload')} />)}
          {view === 'convert'  && <ConvertView />}
        </div>
      </div>

      {/* ── Report Wizard modal ────────────────────────────────────────────── */}
      {/* v1.3: pass scheduleData as separate prop so wizard can merge it into PDF payload */}
      {showWizard && analysis && (
        <ReportWizard
          analysis={analysis}
          scheduleData={scheduleData}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  )
}
