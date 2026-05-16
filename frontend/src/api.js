// ── api.js ────────────────────────────────────────────────────────────────────
//
// Single responsibility: POST the schedule file to the FastAPI backend and
// return the parsed JSON response.
//
// The Vite proxy (vite.config.js) rewrites /api/* → http://localhost:8000/api/*
// so we use a relative URL here. That means this file needs zero changes when
// you deploy — just update the proxy target (or set an env var).
//
// HOW TO USE:
//   import { uploadSchedule } from '../api'
//   const data = await uploadSchedule(file)  // throws on error
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * uploadSchedule — POST a .xer or .mpp file to the analysis endpoint.
 *
 * @param {File}     file       — The File object from the drag-drop / input event
 * @param {Function} onProgress — Optional callback(stageName) called as stages advance.
 *                                Used by UploadView to show the progress indicator.
 *                                Stages: 'uploading' | 'parsing' | 'checking' | 'building'
 * @returns {Promise<Object>}    — The full JSON response from /api/analyse
 * @throws  {Error}              — On network failure or non-2xx HTTP status
 */
export async function uploadSchedule(file, onProgress) {
  // Validate extension before sending — give the user an error instantly
  // rather than waiting for the server to reject it.
  const ext = file.name.split('.').pop().toLowerCase()
  if (!['xer', 'mpp', 'xml'].includes(ext)) {
    throw new Error(`Unsupported file type ".${ext}". Please upload a .xer or .mpp file.`)
  }

  // Stage 1 — notify UI we're uploading
  onProgress?.('uploading')

  // multipart/form-data — the field name must match FastAPI's parameter name.
  // In api/main.py: `async def analyse_schedule(file: UploadFile = File(...))`
  // So the form field must be named "file".
  const formData = new FormData()
  formData.append('file', file)

  // Stage 2 — file is being sent; notify UI
  onProgress?.('parsing')

  let response
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

    response = await fetch(`${API_BASE}/api/analyse`, {
      method: 'POST',
      body: formData,
    })

  // Stage 3 — server responded, parse JSON
  onProgress?.('checking')

  const body = await response.json()

  if (!response.ok) {
    // The FastAPI backend returns structured error objects:
    // { error: "parse_error" | "unsupported_format" | "internal_error", message: "...", ... }
    const msg = body?.detail?.message || body?.detail || `HTTP ${response.status}`
    throw new Error(msg)
  }

  // Stage 4 — building response
  onProgress?.('building')

  return body
}
/**
 * exportPdf — POST the analysis JSON to /api/export/pdf and download the PDF.
 *
 * @param {Object}   analysis    — The full analysis object from AnalysisContext
 * @param {string}   projectName — Display name for the PDF filename (optional)
 * @returns {Promise<void>}      — Resolves when the download starts
 * @throws  {Error}              — On network failure or non-2xx HTTP status
 */
export async function exportPdf(analysis, projectName = 'Schedule') {
  // The backend accepts JSON — not FormData. Use application/json.
  let response
  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

    response = await fetch(`${API_BASE}/api/export/pdf`, {
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
    } catch (_) { /* ignore parse errors on error bodies */ }
    throw new Error(msg)
  }

  // The backend returns a binary PDF blob. Convert the response body to a
  // Blob, create an object URL, simulate a link click → triggers download.
  const blob = await response.blob()

  // Build filename: "SKOPIA_Report_ProjectName_YYYYMMDD.pdf"
  const safe = projectName
    .replace(/[^a-zA-Z0-9 ._-]/g, '_')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40)
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `SKOPIA_Report_${safe}_${today}.pdf`

  // Trigger browser download without navigating away
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // Release the object URL after a short delay so the browser can start
  // the download before we revoke it
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
/**
 * exportScene — POST the scene view model to /api/export/scene and download the PDF.
 *
 * Scene pipeline — separate from exportPdf. The backend renders exactly what
 * the frontend provides (rows, columns, styles). No activity reconstruction.
 *
 * @param {Object} scenePayload — The sceneExport object from ScheduleView via AnalysisContext
 * @param {string} projectName  — Display name used in the fallback filename
 * @returns {Promise<void>}     — Resolves when the download starts
 * @throws  {Error}             — On network failure or non-2xx HTTP status
 */
export async function exportScene(scenePayload, projectName = 'Schedule') {
  let response
  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

    response = await fetch(`${API_BASE}/api/export/scene`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(scenePayload),
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
    } catch (_) { /* ignore parse errors on error bodies */ }
    throw new Error(msg)
  }

  const blob = await response.blob()

  // Prefer the server-supplied filename from Content-Disposition.
  // Fall back to a generated name using the project name + today's date.
  const cd        = response.headers.get('Content-Disposition') || ''
  const nameMatch = cd.match(/filename="([^"]+)"/)
  const filename  = nameMatch
    ? nameMatch[1]
    : `SKOPIA_Scene_${projectName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.pdf`

  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
