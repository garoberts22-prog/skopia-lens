// ── App.jsx ───────────────────────────────────────────────────────────────────
//
// v0.9.5 changes (Report Wizard restructure + preview panel):
//   - Section list updated to match report.html v3.0 page structure:
//     • Cover, Grade & Stats (was: summary)
//     • Helios AI Insights — new, conditional on heliosInsightsProp
//     • Per-Check Detail Pages — new
//     • Schedule Table & Gantt (was: Schedule Table & Gantt, key unchanged)
//     • Critical Path Trace (unchanged)
//     • Analytics (unchanged)
//   - Wizard modal now two-column: 380px left panel + flex-1 right preview panel
//   - Modal expanded to 92vw × 90vh
//   - Preview panel: iframe srcdoc rendering lightweight HTML, reacts to section
//     toggles in real time, scrollable page stack
//   - Zoom slider (50%–150%, default 75%) above preview panel
//   - Page Settings moved into collapsible "Advanced Settings" section
//   - All existing export logic, payload construction, and Jinja field names
//     preserved unchanged
//
// v0.9.4 changes:
//   - Addition of Helios
// v0.9.3 changes:
//   - Report Wizard renamed + Section order + Page Settings
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useCallback } from 'react'
import { useAnalysis }   from './context/AnalysisContext'
import { exportPdf }     from './api'
import NavPanel          from './components/NavPanel'
import UploadView        from './pages/UploadView'
import HealthCheckView   from './pages/HealthCheckView'
import ScheduleView      from './pages/ScheduleView'
import ConvertView       from './pages/ConvertView'
import HeliosButton      from './components/HeliosButton'
import HeliosPanel       from './components/HeliosPanel'

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
// buildPreviewHtml
//
// Generates a lightweight static HTML string for the preview iframe.
// This is NOT a full render of report.html — it's a page-by-page thumbnail
// stack that gives the user a sense of what sections will be included.
//
// Each "page" is a fixed-aspect box (A4 landscape ratio ~1.41:1) with a
// labelled placeholder. The actual fidelity comes from the backend WeasyPrint
// render — this is only a structural preview.
//
// Parameters:
//   sections       — current sections state object { key: bool }
//   sectionDefs    — SECTIONS array with { key, label, pageLabel }
//   companyName    — string, shown on cover placeholder
//   projectName    — string from analysis
//   pageSize       — 'A4' | 'A3' | 'Letter' | 'Legal'
//   pageOrientation— 'landscape' | 'portrait'
// ─────────────────────────────────────────────────────────────────────────────
function buildPreviewHtml({ sections, sectionDefs, companyName, projectName, pageSize, pageOrientation }) {
  // Aspect ratio: A4 landscape = 297/210 ≈ 1.414. Portrait flips it.
  // We'll use CSS to maintain consistent preview widths and let height follow.
  const isLandscape = pageOrientation === 'landscape'
  const aspectRatio = isLandscape ? '1.414 / 1' : '1 / 1.414'

  // Colour for grade ring placeholder
  const gradeColour = '#16A34A'

  // Build pages — one per included section
  const pages = sectionDefs
    .filter(s => sections[s.key])
    .map((s, i) => {
      // Cover page gets richer placeholder content
      if (s.key === 'summary') {
        return `
          <div class="page">
            <div class="page-header">
              <div class="wordmark">SKOPIA.</div>
              <div class="page-meta">${projectName || 'Schedule'} · Schedule Health Report</div>
            </div>
            <div class="grad-strip"></div>
            <div class="cover-body">
              <div class="grade-ring">
                <div class="grade-letter">B</div>
                <div class="grade-pct">88.9%</div>
              </div>
              <div class="stat-grid">
                <div class="stat-tile"><div class="stat-val">—</div><div class="stat-lbl">Total Activities</div></div>
                <div class="stat-tile"><div class="stat-val">—</div><div class="stat-lbl">Incomplete</div></div>
                <div class="stat-tile"><div class="stat-val">—</div><div class="stat-lbl">Complete</div></div>
                <div class="stat-tile"><div class="stat-val">—</div><div class="stat-lbl">Milestones</div></div>
                <div class="stat-tile"><div class="stat-val">—</div><div class="stat-lbl">Relationships</div></div>
              </div>
            </div>
            <div class="checks-placeholder">
              <div class="checks-label">DCMA Check Results Table</div>
              <div class="checks-rows">
                ${['Logic Completeness','Leads','Lags','Relationship Types','Hard Constraints','High Float','Negative Float','Duration'].map(c => `
                  <div class="check-row-ph">
                    <div class="check-dot pass"></div>
                    <div class="check-name">${c}</div>
                    <div class="check-status">PASS</div>
                  </div>`).join('')}
              </div>
            </div>
            ${companyName ? `<div class="company-tag">${companyName}</div>` : ''}
          </div>`
      }

      // Helios page
      if (s.key === 'helios') {
        return `
          <div class="page">
            <div class="section-page-header helios">
              <div class="sp-icon">✦</div>
              <div class="sp-title">Helios AI Insights</div>
            </div>
            <div class="content-placeholder helios-ph">
              <div class="ph-lines">
                <div class="ph-line long"></div>
                <div class="ph-line medium"></div>
                <div class="ph-line long"></div>
                <div class="ph-line short"></div>
                <div class="ph-line medium"></div>
              </div>
            </div>
          </div>`
      }

      // Per-check detail pages (shown as 3 stacked mini-pages in preview)
      if (s.key === 'check_details') {
        return `
          <div class="page">
            <div class="section-page-header">
              <div class="sp-icon">◉</div>
              <div class="sp-title">Per-Check Detail Pages</div>
              <div class="sp-sub">One page per DCMA check</div>
            </div>
            <div class="mini-pages">
              ${['Logic Completeness — DCMA #1', 'Leads (Negative Lags) — DCMA #2', 'High Float — DCMA #6'].map(label => `
                <div class="mini-page">
                  <div class="mini-header">${label}</div>
                  <div class="mini-body">
                    <div class="ph-line long"></div>
                    <div class="ph-line medium"></div>
                  </div>
                </div>`).join('')}
              <div class="mini-ellipsis">· · · and more</div>
            </div>
          </div>`
      }

      // Schedule table page
      if (s.key === 'schedule_data') {
        return `
          <div class="page">
            <div class="section-page-header">
              <div class="sp-icon">≡</div>
              <div class="sp-title">Schedule Table &amp; Gantt</div>
              <div class="sp-sub">Full activity listing with inline Gantt bars</div>
            </div>
            <div class="table-placeholder">
              <div class="table-header-row">
                <div class="th">Activity ID</div>
                <div class="th">Activity Name</div>
                <div class="th">Start</div>
                <div class="th">Finish</div>
                <div class="th">Float</div>
                <div class="th flex-bar">Gantt</div>
              </div>
              ${Array.from({length:8}).map((_, i) => `
                <div class="table-data-row ${i % 2 === 0 ? 'even' : ''}">
                  <div class="td mono">A-${1000+i}</div>
                  <div class="td">Activity Name ${i+1}</div>
                  <div class="td mono">01-Jul-26</div>
                  <div class="td mono">30-Sep-26</div>
                  <div class="td mono right">0d</div>
                  <div class="td flex-bar"><div class="gantt-bar" style="width:${30+i*7}%;"></div></div>
                </div>`).join('')}
            </div>
          </div>`
      }

      // Critical path trace page
      if (s.key === 'longest_path') {
        return `
          <div class="page">
            <div class="section-page-header crit">
              <div class="sp-icon">⬥</div>
              <div class="sp-title">Critical Path Trace</div>
              <div class="sp-sub">Longest driving path from project start to finish</div>
            </div>
            <div class="cp-list">
              ${Array.from({length:6}).map((_, i) => `
                <div class="cp-row">
                  <div class="cp-num">${i+1}</div>
                  <div class="cp-name">Critical Activity ${i+1}</div>
                  <div class="cp-dur">— d</div>
                  <div class="cp-float crit">0d</div>
                </div>`).join('')}
              <div class="cp-ellipsis">… continued</div>
            </div>
          </div>`
      }

      // Analytics page
      if (s.key === 'analytics') {
        return `
          <div class="page">
            <div class="section-page-header">
              <div class="sp-icon">▦</div>
              <div class="sp-title">Analytics</div>
              <div class="sp-sub">Float distribution · Relationship types · Bottlenecks</div>
            </div>
            <div class="analytics-row">
              <div class="analytics-chart">
                <div class="chart-label">Float Distribution</div>
                <div class="bar-chart">
                  ${[60,85,90,70,45,30,20,15,10].map((h,i) => `
                    <div class="bar-col">
                      <div class="bar" style="height:${h}%;background:${i<2?'#DC2626':i<4?'#D97706':'#16A34A'};"></div>
                      <div class="bar-lbl">${i===0?'<0':i===1?'0':'+'}</div>
                    </div>`).join('')}
                </div>
              </div>
              <div class="analytics-chart">
                <div class="chart-label">Relationship Types</div>
                <div class="donut-placeholder">
                  <div class="donut-ring"></div>
                  <div class="donut-labels">
                    <div class="donut-lbl"><span class="dot fs"></span>FS</div>
                    <div class="donut-lbl"><span class="dot ss"></span>SS</div>
                    <div class="donut-lbl"><span class="dot ff"></span>FF</div>
                  </div>
                </div>
              </div>
            </div>
          </div>`
      }

      // Fallback generic page
      return `
        <div class="page">
          <div class="section-page-header">
            <div class="sp-icon">#</div>
            <div class="sp-title">${s.label}</div>
          </div>
        </div>`
    })

  // Full HTML with embedded styles — no external deps (srcdoc is sandboxed)
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #F3F4F6; font-family: Arial, Helvetica, sans-serif; padding: 16px; }

  /* ── Page container ── */
  .page {
    background: #fff;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.13);
    margin-bottom: 16px;
    overflow: hidden;
    aspect-ratio: ${aspectRatio};
    width: 100%;
    display: flex;
    flex-direction: column;
  }

  /* ── Cover header ── */
  .page-header {
    background: #1E1E1E;
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .wordmark {
    font-size: 14px;
    font-weight: 900;
    color: #1EC8D4;
    letter-spacing: -0.5px;
  }
  .page-meta { font-size: 7px; color: #94a3b8; }
  .grad-strip { height: 2px; background: linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC); }

  /* ── Cover body ── */
  .cover-body {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px 6px;
  }
  .grade-ring {
    width: 48px; height: 48px; border-radius: 50%;
    border: 4px solid #16A34A;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .grade-letter { font-size: 16px; font-weight: 900; color: #16A34A; line-height: 1; }
  .grade-pct    { font-size: 7px;  color: #16A34A; }
  .stat-grid { display: flex; gap: 5px; flex-wrap: wrap; flex: 1; }
  .stat-tile {
    background: #F7F8FC;
    border: 1px solid #E2E6F0;
    border-radius: 4px;
    padding: 4px 6px;
    min-width: 50px;
  }
  .stat-val { font-size: 10px; font-weight: 700; color: #1A1A2E; }
  .stat-lbl { font-size: 6px; color: #6B7280; margin-top: 1px; }

  /* ── DCMA checks placeholder ── */
  .checks-placeholder {
    margin: 0 12px 6px;
    border: 1px solid #E2E6F0;
    border-radius: 4px;
    overflow: hidden;
    flex: 1;
  }
  .checks-label {
    background: #1E1E1E;
    color: #E2E8F0;
    font-size: 6px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 3px 8px;
  }
  .checks-rows { padding: 2px 0; }
  .check-row-ph {
    display: flex; align-items: center; gap: 6px;
    padding: 2px 8px;
    border-bottom: 1px solid #F1F5F9;
  }
  .check-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .check-dot.pass { background: #16A34A; }
  .check-dot.fail { background: #DC2626; }
  .check-dot.warn { background: #D97706; }
  .check-name { flex: 1; font-size: 6.5px; color: #1A1A2E; }
  .check-status { font-size: 6px; font-weight: 700; color: #16A34A; }
  .company-tag {
    font-size: 7px; color: #6B7280; text-align: right;
    padding: 3px 12px 5px;
  }

  /* ── Section page header ── */
  .section-page-header {
    background: #F7F8FC;
    border-bottom: 2px solid #E2E6F0;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-page-header.helios { border-bottom-color: #4A6FE8; background: #EEF2FF; }
  .section-page-header.crit   { border-bottom-color: #DC2626; background: #FFF5F5; }
  .sp-icon  { font-size: 14px; color: #4A6FE8; flex-shrink: 0; }
  .sp-title { font-size: 11px; font-weight: 700; color: #1A1A2E; }
  .sp-sub   { font-size: 7px; color: #6B7280; margin-left: 4px; }

  /* ── Helios placeholder ── */
  .content-placeholder { padding: 12px; flex: 1; }
  .helios-ph { background: #F5F3FF; }
  .ph-lines { display: flex; flex-direction: column; gap: 5px; }
  .ph-line { height: 6px; background: #E2E6F0; border-radius: 3px; }
  .ph-line.long   { width: 85%; }
  .ph-line.medium { width: 65%; }
  .ph-line.short  { width: 45%; }

  /* ── Mini-pages (check details preview) ── */
  .mini-pages { padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .mini-page {
    border: 1px solid #E2E6F0; border-radius: 3px;
    overflow: hidden;
  }
  .mini-header {
    background: #1E1E1E; color: #E2E8F0;
    font-size: 6px; padding: 3px 7px;
  }
  .mini-body { padding: 4px 7px; display: flex; flex-direction: column; gap: 3px; }
  .mini-ellipsis { font-size: 7px; color: #9CA3AF; text-align: center; padding: 2px; }

  /* ── Schedule table placeholder ── */
  .table-placeholder { flex: 1; overflow: hidden; margin: 6px 8px; font-size: 6px; }
  .table-header-row {
    display: flex; background: #1E1E1E; color: #E2E8F0;
    padding: 2px 4px; gap: 3px;
  }
  .table-data-row { display: flex; padding: 2px 4px; gap: 3px; border-bottom: 1px solid #F1F5F9; }
  .table-data-row.even { background: #FAFBFF; }
  .th { font-weight: 700; font-size: 5.5px; text-transform: uppercase; flex: 1; }
  .td { font-size: 6px; color: #1A1A2E; flex: 1; overflow: hidden; white-space: nowrap; }
  .th.flex-bar, .td.flex-bar { flex: 2; }
  .td.mono { font-family: monospace; font-size: 5.5px; }
  .td.right { text-align: right; }
  .gantt-bar { height: 6px; background: #02787C; border-radius: 2px; }

  /* ── Critical path list ── */
  .cp-list { padding: 8px 12px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .cp-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; border-bottom: 1px solid #F1F5F9; }
  .cp-num   { width: 14px; height: 14px; border-radius: 50%; background: #DC2626; color: #fff; font-size: 6px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cp-name  { flex: 1; font-size: 7px; color: #1A1A2E; }
  .cp-dur   { font-size: 6px; color: #6B7280; font-family: monospace; }
  .cp-float { font-size: 6px; font-weight: 700; }
  .cp-float.crit { color: #DC2626; }
  .cp-ellipsis { font-size: 7px; color: #9CA3AF; text-align: center; margin-top: 2px; }

  /* ── Analytics charts ── */
  .analytics-row { display: flex; gap: 10px; padding: 10px 12px; flex: 1; }
  .analytics-chart { flex: 1; border: 1px solid #E2E6F0; border-radius: 4px; padding: 6px; display: flex; flex-direction: column; }
  .chart-label { font-size: 7px; font-weight: 700; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .bar-chart { display: flex; align-items: flex-end; gap: 3px; flex: 1; height: 60px; }
  .bar-col { display: flex; flex-direction: column; align-items: center; flex: 1; height: 100%; justify-content: flex-end; }
  .bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
  .bar-lbl { font-size: 4.5px; color: #9CA3AF; margin-top: 2px; }
  .donut-placeholder { display: flex; align-items: center; gap: 8px; flex: 1; justify-content: center; }
  .donut-ring { width: 50px; height: 50px; border-radius: 50%; border: 12px solid #4A6FE8; flex-shrink: 0; }
  .donut-labels { display: flex; flex-direction: column; gap: 4px; }
  .donut-lbl { display: flex; align-items: center; gap: 4px; font-size: 6.5px; color: #1A1A2E; }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .dot.fs { background: #4A6FE8; }
  .dot.ss { background: #1EC8D4; }
  .dot.ff { background: #D97706; }
</style>
</head>
<body>
${pages.join('\n')}
</body></html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportWizard
//
// Two-column modal:
//   Left  (380px fixed, scrollable) — options panel (Report Details, Content,
//          Advanced Settings)
//   Right (flex-1, min 400px)       — live preview panel with zoom slider
//
// Section keys (match _sections sent to backend / Jinja template):
//   summary        — Cover, Grade & Stats (always first)
//   helios         — Helios AI Insights (conditional: only shown if helios data)
//   check_details  — Per-Check Detail Pages (new)
//   schedule_data  — Schedule Table & Gantt (conditional: only if activities)
//   longest_path   — Critical Path Trace
//   analytics      — Analytics
// ─────────────────────────────────────────────────────────────────────────────
function ReportWizard({ analysis, baselineProp, heliosInsightsProp, sceneActivitiesProp, onClose }) {
  const hasScheduleData = !!(analysis?.schedule_data?.activities?.length)
  // Include all three Helios modes — forensic-only is valid (no health/baseline required)
  const hasHelios       = !!(heliosInsightsProp?.health || heliosInsightsProp?.baseline || heliosInsightsProp?.forensic)

  // ── State ──────────────────────────────────────────────────────────────────
  const [companyName,     setCompanyName]     = useState('')
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [success,         setSuccess]         = useState(false)
  const [previewLoading,  setPreviewLoading]  = useState(false)
  const [contentOpen,     setContentOpen]     = useState(true)   // Content accordion — open by default
  const [advancedOpen,    setAdvancedOpen]    = useState(false)  // Page Settings accordion
  const [zoomPct,         setZoomPct]         = useState(75)     // Preview zoom 50–150

  // Content section toggles — only sections that are still in the report
  const [sections, setSections] = useState({
    summary:       true,
    helios:        hasHelios,        // default-on only if insights exist
    check_details: true,
    schedule_data: hasScheduleData,  // default-on only if schedule data exists
  })

  // Page settings (moved into Advanced Settings accordion)
  const [pageSize,        setPageSize]        = useState('A4')
  const [pageOrientation, setPageOrientation] = useState('landscape')

  // ── Section definitions — ordered as they appear in PDF ───────────────────
  //
  // Critical Path Trace and Analytics are always included — they are not
  // user-togglable (removed from report structure). Only four sections remain.
  const SECTIONS = [
    {
      key:       'summary',
      label:     'Cover, Grade & Stats',
      desc:      'Project overview, overall health grade, summary statistics, and DCMA check results table',
      icon:      '①',
      available: true,
    },
    {
      key:       'helios',
      label:     'Helios AI Insights',
      desc:      hasHelios
        ? 'AI-generated health insights, baseline commentary, and recommendations'
        : 'Helios AI insights not yet generated — run Helios first to include this section',
      icon:      '②',
      available: hasHelios,
    },
    {
      key:       'check_details',
      label:     'Per-Check Detail Pages',
      desc:      'One page per DCMA check — description, metric, threshold, and flagged activity list',
      icon:      '③',
      available: true,
    },
    {
      key:       'schedule_data',
      label:     'Schedule Table & Gantt',
      desc:      hasScheduleData
        ? 'Full activity listing with start, finish, duration, float, and status — reflects the active Scene'
        : 'No schedule data available — upload a schedule file to enable this section',
      icon:      '④',
      available: hasScheduleData,
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
      // Prevent unchecking all sections
      const anyOn = Object.values(next).some(Boolean)
      if (!anyOn) return prev
      return next
    })
  }

  // ── Preview HTML — memoised on section / company / page settings changes ───
  // Re-builds whenever any control changes so the iframe stays in sync.
  const previewHtml = useMemo(() => {
    return buildPreviewHtml({
      sections,
      sectionDefs: SECTIONS,
      companyName,
      projectName: analysis?.project_name ?? 'Schedule',
      pageSize,
      pageOrientation,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, companyName, pageSize, pageOrientation, hasHelios, hasScheduleData])

  // ── Export handler ─────────────────────────────────────────────────────────
  async function handleGenerate() {
    setError(null)
    setLoading(true)

    const payload = { ...analysis }

    // Include Helios AI insights
    if (heliosInsightsProp) {
      payload._helios_insights = heliosInsightsProp
    }

    // Include baseline data for variance
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

    // ── Strip / populate data per section toggle ──────────────────────────────
    //
    // The Jinja2 template guards on data presence, not on _sections flags.
    // So we null out data for unchecked sections.
    //
    // Template conditional → what we do:
    //   {% if helios_insights %}      → null payload._helios_insights
    //   {% for check in checks %}     → empty payload.checks array
    //   {% if scene_activities %}     → populate payload._scene_data
    //
    // Critical Path Trace and Analytics are always included (not user-togglable).

    // Helios — null the insights object so template skips the page entirely
    if (!sections.helios) {
      payload._helios_insights = null
    }

    // Per-check detail pages — empty the checks array so the for-loop renders nothing
    if (!sections.check_details) {
      payload.checks = []
    }

    // Schedule Table — use the active Scene's filtered activity list if available.
    // sceneActivitiesProp comes from AnalysisContext.sceneActivities, which
    // ScheduleView writes whenever the visible activity list changes (scene switch,
    // filter change, etc.).
    //
    // Three cases:
    //   null       → ScheduleView was never mounted (user on Health view) — use full list
    //   []         → ScheduleView mounted but all rows collapsed or filtered — send empty
    //               (template gets no scene_activities → no schedule table rendered)
    //   [...]      → populated scene — use exactly what's visible
    if (sections.schedule_data && analysis.schedule_data?.activities?.length) {
      payload._scene_data = sceneActivitiesProp !== null
        ? sceneActivitiesProp                           // active Scene list (may be empty)
        : analysis.schedule_data.activities             // fallback: full list (never visited ScheduleView)
    } else {
      payload._scene_data   = null
      payload.schedule_data = null
    }

    // Template metadata
    payload._sections     = sections
    payload._company_name = companyName.trim() || null
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      onClick={handleBackdrop}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: 'rgba(15,20,40,0.62)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      {/* ── Modal shell — two-column ─────────────────────────────────────── */}
      <div style={{
        background: W.card,
        border: `1px solid ${W.border}`,
        borderRadius: 14,
        width: '92vw',
        maxWidth: 1180,
        height: '90vh',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
        overflow: 'hidden',
      }}>
        {/* Gradient accent strip */}
        <div style={{ height: 3, background: W.grad, borderRadius: '14px 14px 0 0', flexShrink: 0 }} />

        {/* ── Modal header ─────────────────────────────────────────────────── */}
        <div style={{
          padding: '14px 20px 12px',
          borderBottom: `1px solid ${W.border}`,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexShrink: 0,
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

        {/* ── Modal body — two columns ──────────────────────────────────────── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* ══ LEFT PANEL — Options (380px fixed, scrollable) ═══════════════ */}
          <div style={{
            width: 380,
            flexShrink: 0,
            borderRight: `1px solid ${W.border}`,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}>

            {success ? (
              /* ── Success state ─────────────────────────────────────────── */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 24px' }}>
                <div style={{ fontSize: 40 }}>✅</div>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14, color: W.pass }}>
                  PDF Downloaded
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: W.muted, textAlign: 'center', lineHeight: 1.5 }}>
                  Your report has been saved to your downloads folder.
                </div>
              </div>
            ) : (
              <div style={{ padding: '16px 18px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>

                {/* ══ A. Report Details ══════════════════════════════════════ */}
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

                {/* ══ B. Content (collapsible) ══════════════════════════════ */}
                {/* Accordion toggle — open by default */}
                <div
                  onClick={() => setContentOpen(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    cursor: 'pointer', marginBottom: contentOpen ? 12 : 20,
                    userSelect: 'none',
                  }}
                >
                  <div style={{ height: 1, background: W.border, flex: 1 }} />
                  <div style={{
                    fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
                    color: W.muted, textTransform: 'uppercase', letterSpacing: '0.07em',
                    whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    Content
                    <span style={{
                      display: 'inline-block',
                      transform: contentOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.18s',
                      fontSize: 9, lineHeight: 1,
                    }}>▼</span>
                  </div>
                  <div style={{ height: 1, background: W.border, flex: 1 }} />
                </div>

                {contentOpen && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: W.muted, marginBottom: 8 }}>
                    Select which sections to include. Sections appear in this order in the PDF.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {SECTIONS.map(({ key, label, desc, icon, available }) => {
                      const checked = sections[key]
                      // Prevent last-remaining checked section from being unchecked
                      const isLast  = checked && Object.values(sections).filter(Boolean).length === 1
                      // Unavailable = no data for this section; still shown but
                      // forced-off and styled dimmed with tooltip
                      const clickable = available && !isLast

                      return (
                        <div
                          key={key}
                          onClick={() => clickable && toggleSection(key)}
                          title={!available ? desc : undefined}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 9,
                            padding: '8px 10px', borderRadius: 7,
                            border: `1px solid ${checked && available ? W.peri : W.border}`,
                            background: checked && available ? 'rgba(74,111,232,0.05)' : W.card,
                            cursor: clickable ? 'pointer' : available ? 'not-allowed' : 'default',
                            opacity: !available ? 0.42 : isLast ? 0.55 : 1,
                            transition: 'border-color 0.12s, background 0.12s',
                            userSelect: 'none',
                          }}
                        >
                          {/* Order badge */}
                          <div style={{
                            width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                            background: checked && available ? W.peri : W.border,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9,
                            color: checked && available ? '#fff' : W.muted,
                            transition: 'background 0.12s, color 0.12s',
                          }}>
                            {icon}
                          </div>
                          {/* Checkbox */}
                          <div style={{
                            width: 15, height: 15, borderRadius: 4, flexShrink: 0, marginTop: 2,
                            border: `1.5px solid ${checked && available ? W.peri : '#9CA3AF'}`,
                            background: checked && available ? W.peri : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'background 0.12s, border-color 0.12s',
                          }}>
                            {checked && available && <span style={{ color: '#fff', fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                          </div>
                          {/* Text */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
                              color: W.text, display: 'flex', alignItems: 'center', gap: 5,
                            }}>
                              {label}
                              {/* "Helios" sparkle badge */}
                              {key === 'helios' && (
                                <span style={{
                                  fontSize: 8, background: 'linear-gradient(135deg,#4A6FE8,#2A4DCC)',
                                  color: '#fff', borderRadius: 3, padding: '1px 5px',
                                  fontFamily: 'var(--font-head)', fontWeight: 700,
                                }}>AI</span>
                              )}
                            </div>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: W.muted, marginTop: 2, lineHeight: 1.45 }}>
                              {desc}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                )}

                {/* ══ C. Advanced Settings (collapsible) ════════════════════ */}
                {/* Accordion toggle row */}
                <div
                  onClick={() => setAdvancedOpen(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    cursor: 'pointer', marginBottom: advancedOpen ? 14 : 20,
                    userSelect: 'none',
                  }}
                >
                  <div style={{ height: 1, background: W.border, flex: 1 }} />
                  <div style={{
                    fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
                    color: W.muted, textTransform: 'uppercase', letterSpacing: '0.07em',
                    whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    Page Settings
                    {/* Chevron rotates when open */}
                    <span style={{
                      display: 'inline-block',
                      transform: advancedOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.18s',
                      fontSize: 9, lineHeight: 1,
                    }}>▼</span>
                  </div>
                  <div style={{ height: 1, background: W.border, flex: 1 }} />
                </div>

                {/* Accordion body */}
                {advancedOpen && (
                  <div style={{ marginBottom: 20 }}>
                    {/* Page size */}
                    <FieldLabel label="Page Size" />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 12 }}>
                      {PAGE_SIZES.map(({ value, label, dim }) => {
                        const sel = pageSize === value
                        return (
                          <div
                            key={value}
                            onClick={() => setPageSize(value)}
                            style={{
                              padding: '7px 5px', borderRadius: 7, textAlign: 'center',
                              border: `1px solid ${sel ? W.peri : W.border}`,
                              background: sel ? 'rgba(74,111,232,0.07)' : W.card,
                              cursor: 'pointer', userSelect: 'none',
                              transition: 'border-color 0.12s, background 0.12s',
                            }}
                          >
                            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11, color: sel ? W.peri : W.text }}>{label}</div>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 8, color: W.muted, marginTop: 2 }}>{dim}</div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Orientation */}
                    <FieldLabel label="Orientation" />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                      {[
                        { value: 'landscape', label: 'Landscape', note: 'Recommended for schedule tables' },
                        { value: 'portrait',  label: 'Portrait',  note: 'Recommended for short reports' },
                      ].map(({ value, label, note }) => {
                        const sel = pageOrientation === value
                        return (
                          <div
                            key={value}
                            onClick={() => setPageOrientation(value)}
                            style={{
                              display: 'flex', alignItems: 'flex-start', gap: 8,
                              padding: '8px 10px', borderRadius: 7,
                              border: `1px solid ${sel ? W.peri : W.border}`,
                              background: sel ? 'rgba(74,111,232,0.05)' : W.card,
                              cursor: 'pointer', userSelect: 'none',
                              transition: 'border-color 0.12s, background 0.12s',
                            }}
                          >
                            {/* Orientation diagram */}
                            <div style={{
                              flexShrink: 0, marginTop: 1,
                              width:  value === 'landscape' ? 20 : 14,
                              height: value === 'landscape' ? 14 : 20,
                              border: `2px solid ${sel ? W.peri : '#9CA3AF'}`,
                              borderRadius: 2,
                              transition: 'border-color 0.12s',
                            }} />
                            <div>
                              <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11, color: sel ? W.peri : W.text }}>{label}</div>
                              <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: W.muted, marginTop: 2 }}>{note}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* ── Error ─────────────────────────────────────────────── */}
                {error && (
                  <div style={{ marginBottom: 14, padding: '9px 12px', background: '#FEF2F2', border: `1px solid ${W.fail}`, borderRadius: 6, fontFamily: 'var(--font-body)', fontSize: 11, color: W.fail }}>
                    ⚠ {error}
                  </div>
                )}

                {/* ── Actions ───────────────────────────────────────────── */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button
                    onClick={onClose}
                    disabled={loading}
                    style={{
                      fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12,
                      padding: '9px 16px', borderRadius: 7,
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
                      padding: '9px 20px', borderRadius: 7, border: 'none',
                      background: loading ? '#E5E7EB' : W.grad,
                      color: loading ? '#9CA3AF' : '#ffffff',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 7,
                      minWidth: 140, justifyContent: 'center',
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

              </div>
            )}
          </div>

          {/* ══ RIGHT PANEL — Preview ══════════════════════════════════════════ */}
          <div style={{
            flex: 1,
            minWidth: 400,
            background: '#F3F4F6',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Preview toolbar: zoom slider */}
            <div style={{
              height: 38,
              flexShrink: 0,
              background: W.card,
              borderBottom: `1px solid ${W.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0 14px',
            }}>
              {/* Preview label */}
              <div style={{
                fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
                color: W.muted, textTransform: 'uppercase', letterSpacing: '0.06em',
                flexShrink: 0,
              }}>
                Preview
              </div>

              <div style={{ flex: 1 }} />

              {/* Zoom label */}
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, color: W.text,
                flexShrink: 0, width: 38, textAlign: 'right',
              }}>
                {zoomPct}%
              </div>

              {/* Zoom slider — 50–150, step 5 */}
              <input
                type="range"
                min={50}
                max={150}
                step={5}
                value={zoomPct}
                onChange={e => setZoomPct(Number(e.target.value))}
                style={{ width: 100, cursor: 'pointer', accentColor: W.peri }}
              />

              {/* Reset zoom */}
              <button
                onClick={() => setZoomPct(75)}
                title="Reset zoom to 75%"
                style={{
                  fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 9,
                  color: W.muted, background: 'transparent', border: `1px solid ${W.border}`,
                  borderRadius: 4, padding: '2px 7px', cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Reset
              </button>
            </div>

            {/* iframe preview — srcdoc drives the content */}
            {/* Outer scroll container */}
            <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
              {/* Scale wrapper — zoom is applied to the iframe via CSS transform */}
              {/* We set a fixed iframe width of 100% of the unscaled viewport,
                  then scale it. The outer wrapper height accounts for the scaling
                  so scrolling still works correctly. */}
              <div style={{
                transformOrigin: 'top center',
                transform: `scale(${zoomPct / 100})`,
                // Compensate height so scroll container tracks actual scaled size
                // When zoomed out (<100%) the iframe shrinks — we need the wrapper
                // to also shrink so there's no empty scroll space.
                // height 0 + paddingBottom trick doesn't work for iframes;
                // instead we set width/minHeight and let the parent overflow handle it.
                width: `${(100 / zoomPct) * 100}%`,
                minHeight: `${(100 / zoomPct) * 100}%`,
                padding: '0 0 16px',
              }}>
                <iframe
                  key={previewHtml}  /* Force remount when content changes significantly */
                  srcDoc={previewHtml}
                  title="Report Preview"
                  sandbox="allow-same-origin"  /* No scripts in preview — pure HTML/CSS */
                  style={{
                    width: '100%',
                    // Height auto-expands to content — browsers respect this on iframes
                    // when sandbox="allow-same-origin" is set and content is static.
                    // For safety we also set a min-height so short previews don't collapse.
                    height: `${SECTIONS.filter(s => sections[s.key] && s.available).length * 520 + 32}px`,
                    border: 'none',
                    display: 'block',
                    background: '#F3F4F6',
                  }}
                />
              </div>
            </div>

          </div>
        </div>
      </div>

      <style>{`@keyframes pdfSpin { to { transform: rotate(360deg); } }`}</style>
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
  const [view,           setView]       = useState('upload')
  const [showWizard,     setShowWizard] = useState(false)
  const { analysis, baseline, heliosInsights, sceneActivities } = useAnalysis()
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
          sceneActivitiesProp={sceneActivities}
          onClose={() => setShowWizard(false)}
        />
      )}

      {/* ── Helios FAB + Panel ────────────────────────────────────────────── */}
      <HeliosButton
        onClick={() => setShowHelios(v => !v)}
        hasData={hasData}
        active={showHelios}
        hasNew={
          !showHelios && (
            !!(heliosInsights?.health) || !!(heliosInsights?.baseline) || !!(heliosInsights?.forensic)
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
