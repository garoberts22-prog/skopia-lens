// ── context/AnalysisContext.jsx ───────────────────────────────────────────────
//
// v1.3 changes:
//   - Stores session_id from the /api/analyse response.
//   - Adds scheduleData state — the Gantt payload (activities, wbs_nodes,
//     relationships, calendars). Initially null; populated on demand.
//   - Adds scheduleDataLoading and scheduleDataError state.
//   - Exposes loadScheduleData() — called by App.jsx when the user navigates
//     to Schedule view for the first time. Idempotent (no-ops if already loaded).
//   - setAnalysis() now resets scheduleData/session on each new upload so a
//     fresh upload always starts clean.
//   - baseline unchanged (second upload, same shape as analysis).
//
// USAGE:
//   const { analysis, setAnalysis,
//           scheduleData, scheduleDataLoading, scheduleDataError,
//           loadScheduleData,
//           baseline, setBaseline } = useAnalysis()
//
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { fetchScheduleData } from '../api'

// ── Context shape ─────────────────────────────────────────────────────────────
const AnalysisContext = createContext(null)

export function useAnalysis() {
  const ctx = useContext(AnalysisContext)
  if (!ctx) throw new Error('useAnalysis must be used inside <AnalysisProvider>')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function AnalysisProvider({ children }) {
  // ── Health check result (from /api/analyse) ──────────────────────────────
  const [analysis, _setAnalysis] = useState(null)

  // ── Session token (returned with analysis, used for lazy Gantt fetch) ────
  const [sessionId, setSessionId] = useState(null)

  // ── Gantt payload (from /api/schedule-data/{sessionId}) — lazy ───────────
  const [scheduleData,        setScheduleData]        = useState(null)
  const [scheduleDataLoading, setScheduleDataLoading] = useState(false)
  const [scheduleDataError,   setScheduleDataError]   = useState(null)

  // Track whether a fetch is already in-flight so loadScheduleData() is safe
  // to call multiple times (e.g. user rapidly clicks Schedule tab).
  const fetchingRef = useRef(false)

  // ── Baseline (second upload) ─────────────────────────────────────────────
  // The baseline analysis response (same shape as analysis, no schedule_data).
  // We auto-fetch baseline schedule_data immediately on baseline upload because
  // ScheduleView needs it for Var BL columns. Unlike the primary schedule, the
  // baseline Gantt payload is small and user-initiated, so eager fetch is fine.
  const [baseline,             _setBaseline]             = useState(null)
  const [baselineScheduleData, setBaselineScheduleData] = useState(null)

  // setBaseline — called by UploadView after baseline upload succeeds.
  // Auto-fetches the baseline's schedule_data using its session_id.
  const setBaseline = useCallback(async (data) => {
    _setBaseline(data)
    setBaselineScheduleData(null)

    const blSessionId = data?.session_id
    if (!blSessionId) return

    try {
      const blScheduleData = await fetchScheduleData(blSessionId)
      // Attach schedule_data directly onto the baseline object so ScheduleView's
      // existing baseline?.schedule_data references work without any changes.
      _setBaseline(prev => prev ? { ...prev, schedule_data: blScheduleData } : prev)
      setBaselineScheduleData(blScheduleData)
    } catch (_) {
      // Baseline schedule_data fetch failed — Var BL columns just won't show.
      // Not a fatal error; the health check data is still usable.
    }
  }, [])

  // ── setAnalysis — called by UploadView after a successful upload ──────────
  // Resets all derived state so switching schedules doesn't show stale data.
  const setAnalysis = useCallback((data) => {
    _setAnalysis(data)
    // Extract session_id from the response and store it separately.
    // This keeps AnalysisContext consumers from needing to know about session_id.
    setSessionId(data?.session_id ?? null)
    // Reset Gantt payload — it belongs to the previous upload's session.
    setScheduleData(null)
    setScheduleDataLoading(false)
    setScheduleDataError(null)
    fetchingRef.current = false
  }, [])

  // ── loadScheduleData — called when user navigates to Schedule view ────────
  // Idempotent: no-ops if data is already loaded or a fetch is in flight.
  // On session expiry (404), sets scheduleDataError with code SESSION_EXPIRED
  // so ScheduleView can show a "re-upload" prompt rather than a generic error.
  const loadScheduleData = useCallback(async () => {
    // Already loaded — nothing to do
    if (scheduleData) return

    // Already fetching — don't double-up
    if (fetchingRef.current) return

    // No session — analysis not yet loaded (shouldn't happen via normal flow)
    if (!sessionId) return

    fetchingRef.current  = true
    setScheduleDataLoading(true)
    setScheduleDataError(null)

    try {
      const data = await fetchScheduleData(sessionId)
      setScheduleData(data)
    } catch (err) {
      setScheduleDataError(err)
    } finally {
      setScheduleDataLoading(false)
      fetchingRef.current = false
    }
  }, [sessionId, scheduleData])

  // ── Context value ─────────────────────────────────────────────────────────
  const value = {
    // Health check result
    analysis,
    setAnalysis,

    // Gantt data (lazy)
    scheduleData,
    scheduleDataLoading,
    scheduleDataError,
    loadScheduleData,

    // Baseline (second upload — schedule_data auto-fetched and attached)
    baseline,
    setBaseline,
    baselineScheduleData,
  }

  return (
    <AnalysisContext.Provider value={value}>
      {children}
    </AnalysisContext.Provider>
  )
}
