// ── api.js ────────────────────────────────────────────────────────────────────
//
// v1.3 changes:
//   - uploadSchedule() unchanged in calling convention, but the response no
//     longer contains schedule_data. It now contains a session_id instead.
//   - fetchScheduleData(sessionId) — new. Calls GET /api/schedule-data/{id}
//     to retrieve the Gantt payload lazily. Called by AnalysisContext when
//     the user first navigates to Schedule view.
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * uploadSchedule — POST a .xer or .mpp file to the analysis endpoint.
 *
 * @param {File}     file       — The File object from the drag-drop / input event
 * @param {Function} onProgress — Optional callback(stageName) for progress UI.
 *                                Stages: 'uploading' | 'parsing' | 'checking' | 'building'
 * @returns {Promise<Object>}    — Health report JSON (includes session_id, no schedule_data)
 * @throws  {Error}              — On network failure or non-2xx HTTP status
 */
export async function uploadSchedule(file, onProgress) {
  // Validate extension before sending
  const ext = file.name.split('.').pop().toLowerCase()
  if (!['xer', 'mpp', 'xml'].includes(ext)) {
    throw new Error(`Unsupported file type ".${ext}". Please upload a .xer or .mpp file.`)
  }

  onProgress?.('uploading')

  const formData = new FormData()
  formData.append('file', file)

  onProgress?.('parsing')

  let response
  try {
    response = await fetch('/api/analyse', {
      method: 'POST',
      body: formData,
      // Do NOT set Content-Type manually with FormData — browser sets the boundary.
    })
  } catch (networkErr) {
    throw new Error(
      'Could not reach the SKOPIA Lens backend. ' +
      'Make sure the FastAPI server is running: uvicorn api.main:app --reload --port 8000'
    )
  }

  onProgress?.('checking')

  const body = await response.json()

  if (!response.ok) {
    const msg = body?.detail?.message || body?.detail || `HTTP ${response.status}`
    throw new Error(msg)
  }

  onProgress?.('building')

  // Response now contains session_id but NOT schedule_data.
  // ScheduleView fetches schedule_data lazily via fetchScheduleData().
  return body
}


/**
 * fetchScheduleData — GET the Gantt payload for a previously-analysed schedule.
 *
 * Called by AnalysisContext.loadScheduleData() when the user first navigates
 * to the Schedule view. The session_id was returned by uploadSchedule() and
 * stored in context.
 *
 * @param {string} sessionId   — UUID returned by /api/analyse
 * @returns {Promise<Object>}  — schedule_data block: { activities, wbs_nodes, relationships, calendars }
 * @throws  {Error}            — On network failure, 404 (expired), or non-2xx status
 */
export async function fetchScheduleData(sessionId) {
  let response
  try {
    response = await fetch(`/api/schedule-data/${sessionId}`)
  } catch (networkErr) {
    throw new Error(
      'Could not reach the SKOPIA Lens backend. ' +
      'Make sure the server is running.'
    )
  }

  const body = await response.json()

  if (response.status === 404) {
    // Session expired (> 10 min since upload) or invalid ID.
    // Caller should show a re-upload prompt.
    const err = new Error(
      body?.detail?.message ||
      'Session expired. Please re-upload your schedule to view the Gantt.'
    )
    err.code = 'SESSION_EXPIRED'
    throw err
  }

  if (!response.ok) {
    const msg = body?.detail?.message || body?.detail || `HTTP ${response.status}`
    throw new Error(msg)
  }

  return body
}


/**
 * exportPdf — POST the analysis JSON to /api/export/pdf and download the PDF.
 *
 * @param {Object}   analysis    — The full analysis object from AnalysisContext
 * @param {string}   projectName — Display name for the PDF filename (optional)
 * @returns {Promise<void>}
 * @throws  {Error}
 */
export async function exportPdf(analysis, projectName = 'Schedule') {
  let response
  try {
    response = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysis),
    })
  } catch (networkErr) {
    throw new Error(
      'Could not reach the SKOPIA Lens backend. ' +
      'Make sure the server is running.'
    )
  }

  if (!response.ok) {
    let msg = `HTTP ${response.status}`
    try {
      const errBody = await response.json()
      msg = errBody?.detail?.message || errBody?.detail || msg
    } catch (_) {}
    throw new Error(msg)
  }

  const blob = await response.blob()

  const safe = (projectName || 'Schedule')
    .replace(/[^a-zA-Z0-9 ._-]/g, '_')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40)
  const today    = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `SKOPIA_Report_${safe}_${today}.pdf`

  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}