// ── UploadView.jsx ────────────────────────────────────────────────────────────
//
// The Upload page — first thing the user sees.
//
// WHAT IT DOES:
//   1. Shows two upload cards side by side: Current Schedule + Baseline (greyed
//      out until a schedule is loaded — matches prototype behaviour).
//   2. Accepts drag-and-drop or click-to-browse for .xer and .mpp/.xml files.
//   3. When a file is dropped, calls uploadSchedule() from api.js.
//   4. Shows a progress overlay with animated stages while the API call runs.
//   5. On success: stores the result in AnalysisContext.
//   6. On error: shows an inline error message with the server's error detail.
//
// PROPS:
//   onNavigate   fn  — called with 'schedule' to change view
//                      (the App shell owns navigation state, not the router)
//
// ─────────────────────────────────────────────────────────────────────────────

import { useRef, useState } from 'react'
import { useAnalysis } from '../context/AnalysisContext'
import { uploadSchedule } from '../api'

// Progress stages — shown sequentially in the loading overlay.
// Each stage gets a label and a rough % to animate the progress bar.
const STAGES = [
  { key: 'uploading', label: 'Uploading file…',          pct: 15 },
  { key: 'parsing',   label: 'Loading Schedule…',        pct: 40 },
  { key: 'checking',  label: 'Running health checks…',   pct: 70 },
  { key: 'building',  label: 'Building analytics…',      pct: 90 },
]

export default function UploadView({ onNavigate }) {
  const { analysis, setAnalysis, baseline, setBaseline } = useAnalysis()

  // Loading state — current schedule
  const [loading,  setLoading]  = useState(false)
  const [stage,    setStage]    = useState(null)
  const [error,    setError]    = useState(null)

  // Loading state — baseline schedule (separate indicators)
  const [blLoading, setBlLoading] = useState(false)
  const [blStage,   setBlStage]   = useState(null)
  const [blError,   setBlError]   = useState(null)

  // Hidden file input refs
  const fileInputRef   = useRef(null)
  const blFileInputRef = useRef(null)

  // Convenience flags
  const hasData     = !!analysis
  const hasBaseline = !!baseline

  // ── Handle baseline file selection ─────────────────────────────────────────
  async function handleBaselineFile(file) {
    setBlError(null)
    setBlLoading(true)
    setBlStage('uploading')
    try {
      const data = await uploadSchedule(file, (stageName) => setBlStage(stageName))
      setBaseline(data)
    } catch (err) {
      setBlError(err.message)
    } finally {
      setBlLoading(false)
      setBlStage(null)
    }
  }

  // ── Drag-and-drop handlers for baseline card ────────────────────────────────
  function onBlDragOver(e)  { e.preventDefault(); e.currentTarget.classList.add('drag-over') }
  function onBlDragLeave(e) { e.currentTarget.classList.remove('drag-over') }
  function onBlDrop(e) {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (file) handleBaselineFile(file)
  }

  // ── Handle file selection ───────────────────────────────────────────────────
  async function handleFile(file) {
    setError(null)
    setLoading(true)
    setStage('uploading')

    try {
      const data = await uploadSchedule(file, (stageName) => setStage(stageName))
      setAnalysis(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setStage(null)
    }
  }

  // ── Drag-and-drop handlers ──────────────────────────────────────────────────
  function onDragOver(e) {
    e.preventDefault()
    e.currentTarget.classList.add('drag-over')
  }
  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over')
  }
  function onDrop(e) {
    e.preventDefault()
    e.currentTarget.classList.remove('drag-over')
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // Derive current stage % for the progress bar
  const currentPct = STAGES.find(s => s.key === stage)?.pct ?? 0

  return (
    // Full-height content area — flex column to centre the upload UI
    <div style={{
      flex:           1,
      background:     'var(--sk-bg)',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      gap:            28,
      padding:        40,
      overflow:       'auto',
      position:       'relative',
    }}>

      {/* ── Loading overlay ─────────────────────────────────────────────────
          Sits on top of the upload UI while the API call is in progress.
          Uses a semi-transparent background with blur so the cards behind
          are still visible but clearly inactive.
          ─────────────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{
          position:       'absolute', inset: 0,
          background:     'rgba(247, 248, 252, 0.9)',
          backdropFilter: 'blur(4px)',
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            18,
          zIndex:         50,
        }}>
          {/* Spinning ring — border-top-color is the brand blue */}
          <div className="sk-spinner" />

          {/* Stage label — Montserrat bold, matches prototype */}
          <div style={{
            fontFamily: 'var(--font-head)',
            fontWeight: 700,
            fontSize:   14,
            color:      'var(--sk-text)',
          }}>
            {STAGES.find(s => s.key === stage)?.label ?? 'Processing…'}
          </div>

          {/* Progress bar — animates as stages advance */}
          <div style={{
            width:        320,
            height:       4,
            background:   'var(--sk-border)',
            borderRadius: 999,
            overflow:     'hidden',
          }}>
            <div
              className="sk-progress-bar"
              style={{ width: `${currentPct}%`, height: '100%' }}
            />
          </div>

          {/* Sub-label with all stage names so user sees what's coming */}
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize:   11,
            color:      'var(--sk-muted)',
          }}>
            Parsing → Health checks → Analytics → Done
          </div>
        </div>
      )}

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily:             'var(--font-head)',
          fontWeight:             900,
          fontSize:               22,
          background:             'var(--grad)',
          WebkitBackgroundClip:   'text',
          WebkitTextFillColor:    'transparent',
          marginBottom:           6,
        }}>
          Upload Schedules
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize:   13,
          color:      'var(--sk-muted)',
        }}>
          Load a schedule to run the DCMA health check
        </div>
      </div>

      {/* ── Two-card upload row ────────────────────────────────────────────── */}
      <div style={{
        display:         'flex',
        gap:             20,
        flexWrap:        'wrap',
        justifyContent:  'center',
        width:           '100%',
        maxWidth:        860,
      }}>

        {/* ── Current Schedule card ───────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 320, maxWidth: 400 }}>
          {/* Section label */}
          <div style={{
            fontFamily:     'var(--font-head)',
            fontWeight:     700,
            fontSize:       11,
            textTransform:  'uppercase',
            letterSpacing:  '0.07em',
            color:          'var(--sk-muted)',
            marginBottom:   10,
          }}>
            Current Schedule
          </div>

          {/* Drop zone */}
          <div
            className="sk-drop-zone"
            style={{ padding: '32px 24px', cursor: 'pointer', textAlign: 'center' }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {/* Upload icon with brand gradient stroke */}
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
              stroke="url(#uploadGrad1)" strokeWidth="1.5" style={{ marginBottom: 10 }}>
              <defs>
                <linearGradient id="uploadGrad1" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%"   stopColor="#1EC8D4" />
                  <stop offset="100%" stopColor="#2A4DCC" />
                </linearGradient>
              </defs>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>

            {/* Status text — changes once a file is loaded */}
            {hasData ? (
              <div style={{
                fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14,
                color: 'var(--sk-pass)', marginBottom: 4,
              }}>
                ✓ Loaded
              </div>
            ) : (
              <div style={{
                fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14,
                color: 'var(--sk-text)', marginBottom: 4,
              }}>
                Drop or click to upload
              </div>
            )}

            {/* Project name (loaded) or format hint (empty) */}
            <div style={{
              fontFamily: hasData ? 'var(--font-mono)' : 'var(--font-body)',
              fontSize: 12,
              color: 'var(--sk-muted)',
              marginBottom: 12,
            }}>
              {hasData
                ? analysis.project_name
                : 'P6 XER or MSP MPP/XML'
              }
            </div>

            {/* Format badges */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {['P6 XER', 'MSP MPP/XML'].map(fmt => (
                <span key={fmt} style={{
                  fontFamily:  'var(--font-mono)',
                  fontSize:    10,
                  color:       '#4A6FE8',
                  background:  'rgba(74, 111, 232, 0.08)',
                  border:      '1px solid rgba(74, 111, 232, 0.25)',
                  borderRadius: 4,
                  padding:     '2px 8px',
                }}>
                  {fmt}
                </span>
              ))}
            </div>
          </div>

          {/* Hidden file input — triggered by clicking the drop zone */}
          {/* accept includes .xml for MSP XML exports */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xer,.mpp,.xml"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ''  // reset so same file can be re-uploaded
            }}
          />

                    {/* Stats strip — shown once a file is loaded */}
          {hasData && (
            <div style={{
              marginTop:    8,
              padding:      '8px 12px',
              background:   'var(--sk-card)',
              border:       '1px solid var(--sk-border)',
              borderRadius: 8,
              fontSize:     11,
              fontFamily:   'var(--font-mono)',
              color:        'var(--sk-muted)',
              display:      'flex',
              gap:          16,
              alignItems:   'center',  // vertically align text + button
            }}>
              <span>
                <b style={{ color: 'var(--sk-text)' }}>
                  {analysis.schedule_data?.activities?.length ?? s.total_activities}
                </b> activities
              </span>
              <span>
                <b style={{ color: 'var(--sk-text)' }}>
                  {analysis.summary_stats.total_relationships}
                </b> relationships
              </span>
              <span>
                <b style={{
                  color: analysis.source_format === 'xer'
                    ? 'var(--sk-cyan)'
                    : '#D97706',
                }}>
                  {analysis.source_format?.toUpperCase()}
                </b>
              </span>

              {/* Clear current schedule — also clears baseline since it has no context without a current schedule */}
              <button
                onClick={() => { setAnalysis(null); setBaseline(null) }}
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  border:     'none',
                  color:      'var(--sk-muted)',
                  cursor:     'pointer',
                  fontSize:   11,
                  fontFamily: 'var(--font-body)',
                }}
                title="Remove schedule">
                ✕ Clear
              </button>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div style={{
              marginTop:    8,
              padding:      '8px 12px',
              background:   'rgba(220, 38, 38, 0.06)',
              border:       '1px solid rgba(220, 38, 38, 0.3)',
              borderRadius: 6,
              fontSize:     12,
              color:        'var(--sk-fail)',
              fontFamily:   'var(--font-body)',
            }}>
              ⚠ {error}
            </div>
          )}
        </div>

        {/* ── Baseline Schedule card — fully wired ─────────────────────────── */}
        <div style={{ flex: 1, minWidth: 320, maxWidth: 400 }}>
          <div style={{
            fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
            textTransform: 'uppercase', letterSpacing: '0.07em',
            color: 'var(--sk-muted)', marginBottom: 10,
          }}>
            Baseline Schedule
          </div>

          {/* Loading overlay for baseline */}
          {blLoading && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(247,248,252,0.9)', backdropFilter: 'blur(4px)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 18, zIndex: 50,
            }}>
              <div className="sk-spinner" />
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14, color: 'var(--sk-text)' }}>
                {STAGES.find(s => s.key === blStage)?.label ?? 'Processing…'}
              </div>
              <div style={{ width: 320, height: 4, background: 'var(--sk-border)', borderRadius: 999, overflow: 'hidden' }}>
                <div className="sk-progress-bar"
                  style={{ width: `${STAGES.find(s => s.key === blStage)?.pct ?? 0}%`, height: '100%' }} />
              </div>
            </div>
          )}

          {/* Drop zone — disabled until a schedule is loaded */}
          <div
            className="sk-drop-zone-baseline"
            style={{
              padding: '32px 24px', textAlign: 'center',
              cursor:  hasData ? 'pointer' : 'default',
              opacity: hasData ? 1 : 0.4,
              pointerEvents: hasData ? 'auto' : 'none',
            }}
            onClick={() => hasData && blFileInputRef.current?.click()}
            onDragOver={onBlDragOver}
            onDragLeave={onBlDragLeave}
            onDrop={onBlDrop}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
              stroke="url(#uploadGrad2)" strokeWidth="1.5" style={{ marginBottom: 10 }}>
              <defs>
                <linearGradient id="uploadGrad2" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%"   stopColor="#7C3AED" />
                  <stop offset="100%" stopColor="#4A6FE8" />
                </linearGradient>
              </defs>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>

            {/* Status text */}
            {hasBaseline ? (
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14, color: 'var(--sk-pass)', marginBottom: 4 }}>
                ✓ Baseline Loaded
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14, color: hasData ? 'var(--sk-text)' : 'var(--sk-muted)', marginBottom: 4 }}>
                {hasData ? 'Drop or click to upload' : 'Load schedule first'}
              </div>
            )}

            {/* Project name or format hint */}
            <div style={{ fontFamily: hasBaseline ? 'var(--font-mono)' : 'var(--font-body)', fontSize: 12, color: 'var(--sk-muted)', marginBottom: 12 }}>
              {hasBaseline ? baseline.project_name : 'P6 XER or MSP MPP/XML'}
            </div>

            {/* Format badges */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {['P6 XER', 'MSP MPP/XML'].map(fmt => (
                <span key={fmt} style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: '#7C3AED', background: 'rgba(124,58,237,0.08)',
                  border: '1px solid rgba(124,58,237,0.25)',
                  borderRadius: 4, padding: '2px 8px',
                }}>
                  {fmt}
                </span>
              ))}
            </div>
          </div>

          {/* Hidden file input for baseline */}
          <input
            ref={blFileInputRef}
            type="file"
            accept=".xer,.mpp,.xml"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleBaselineFile(file)
              e.target.value = ''
            }}
          />

          {/* Baseline stats strip */}
          {hasBaseline && (
            <div style={{
              marginTop: 8, padding: '8px 12px',
              background: 'var(--sk-card)', border: '1px solid var(--sk-border)',
              borderRadius: 8, fontSize: 11, fontFamily: 'var(--font-mono)',
              color: 'var(--sk-muted)', display: 'flex', gap: 16, alignItems: 'center',
            }}>
              <span><b style={{ color: 'var(--sk-text)' }}>{baseline.schedule_data?.activities?.length ?? s.total_activities}</b> activities</span>
              <span><b style={{ color: '#7C3AED' }}>{baseline.source_format?.toUpperCase()}</b></span>
              {/* Clear baseline button */}
              <button
                onClick={() => setBaseline(null)}
                style={{
                  marginLeft: 'auto', background: 'none', border: 'none',
                  color: 'var(--sk-muted)', cursor: 'pointer', fontSize: 11,
                  fontFamily: 'var(--font-body)',
                }}
                title="Remove baseline">
                ✕ Clear
              </button>
            </div>
          )}

          {/* Baseline error */}
          {blError && (
            <div style={{
              marginTop: 8, padding: '8px 12px',
              background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.3)',
              borderRadius: 6, fontSize: 12, color: 'var(--sk-fail)', fontFamily: 'var(--font-body)',
            }}>
              ⚠ {blError}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
