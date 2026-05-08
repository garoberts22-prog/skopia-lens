// ── App.jsx ───────────────────────────────────────────────────────────────────
// Wires ConvertView into the app shell alongside Upload/Dashboard/Schedule.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useAnalysis } from './context/AnalysisContext'
import { exportPdf } from './api'
import NavPanel      from './components/NavPanel'
import UploadView    from './pages/UploadView'
import HealthCheckView from './pages/HealthCheckView'
import ScheduleView  from './pages/ScheduleView'
import ConvertView   from './pages/ConvertView'   // ← NEW

// ── PDF export button — lives in the header, visible on health + schedule views
function PdfExportButton({ analysis }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const handle = async () => {
    setLoading(true)
    setError(null)
    try {
      await exportPdf(analysis, analysis.project_name || 'Schedule')
    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      {error && (
        <span style={{
          fontSize: 10, color: '#FCA5A5',
          fontFamily: 'var(--font-mono)',
          background: 'rgba(220,38,38,0.15)',
          border: '1px solid rgba(220,38,38,0.3)',
          borderRadius: 4, padding: '2px 8px',
          whiteSpace: 'nowrap', maxWidth: 200,
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {error}
        </span>
      )}
      <button
        onClick={handle}
        disabled={loading}
        title="Export schedule health report as PDF"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0 14px', height: 30,
          border: 'none', borderRadius: 6,
          background: loading
            ? 'rgba(255,255,255,0.08)'
            : 'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
          color: loading ? 'rgba(255,255,255,0.35)' : '#ffffff',
          fontFamily: 'var(--font-head)',
          fontSize: 11, fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          letterSpacing: '0.04em', whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {/* Download arrow icon */}
        {!loading && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        )}
        {loading ? 'Generating…' : 'Export PDF'}
      </button>
    </div>
  )
}

function EmptyState({ label, onUpload }) {
  return (
    <div style={{
      flex: 1, background: '#F7F8FC',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
    }}>
      <div style={{ fontSize: 48, opacity: 0.12 }}>◈</div>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 16, color: '#6B7280' }}>
        {label}
      </div>
      <button onClick={onUpload} style={{
        fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12,
        background: 'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)', color: '#fff',
        border: 'none', borderRadius: 6, padding: '8px 20px', cursor: 'pointer',
      }}>
        Upload Schedule
      </button>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState('upload')
  const { analysis }    = useAnalysis()
  const hasData         = !!analysis

  function fmtDataDate(isoStr) {
    if (!isoStr) return null
    const d = new Date(isoStr)
    if (isNaN(d)) return null
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* App header */}
      <div style={{ background: '#1E1E1E', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 48 }}>
          {/* SKOPIA .lens wordmark */}
          <span style={{
            fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 900,
            background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            flexShrink: 0,
          }}>SKOPIA</span>
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
            {analysis.data_date && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#94a3b8', background: '#1a2a3a', border: '1px solid #334155', borderRadius: 4, padding: '2px 8px', flexShrink: 0 }}>
                DD: {fmtDataDate(analysis.data_date)}
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#64748b', flexShrink: 0 }}>
              {analysis.summary_stats?.total_activities} activities
            </span>
          </>}

          <div style={{ flex: 1 }} />

          {/* Export PDF — shown when a schedule is loaded, on health or schedule views */}
          {hasData && (view === 'health' || view === 'schedule') && (
            <PdfExportButton analysis={analysis} />
          )}
        </div>
        <div style={{ background: 'var(--grad)', height: 3 }} />
      </div>


      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <NavPanel activeView={view} setView={setView} analysis={analysis} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {view === 'upload' && <UploadView onNavigate={setView} />}

          {view === 'health' && (
            hasData
              ? <HealthCheckView onNavigate={setView} />
              : <EmptyState label="No schedule loaded" onUpload={() => setView('upload')} />
          )}

          {view === 'schedule' && (
            hasData
              ? <ScheduleView onNavigate={setView} />
              : <EmptyState label="No schedule loaded" onUpload={() => setView('upload')} />
          )}

          {/* Convert — no data dependency. Works standalone. */}
          {view === 'convert' && <ConvertView />}
        </div>
      </div>
    </div>
  )
}
