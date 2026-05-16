// ── AnalysisContext.jsx ───────────────────────────────────────────────────────
//
// v1.3 — Added sceneActivities for PDF export scene passthrough.
//
// WHAT IT STORES:
//   analysis        — full JSON from POST /api/analyse (null before upload)
//   baseline        — second upload response for baseline comparison (null until uploaded)
//   heliosInsights  — AI-generated insights from POST /api/helios, stored so
//                     they survive navigation and can be included in PDF export.
//   sceneActivities — the currently visible/filtered activity list from ScheduleView,
//                     set whenever the active Scene or filter changes. Used by
//                     ReportWizard to export the exact view the user is looking at
//                     rather than the full raw activity list.
//
//   heliosInsights shape:
//     {
//       health:   { content: string, generatedAt: string } | null,
//       baseline: { content: string, generatedAt: string } | null,
//       forensic: { content: string, generatedAt: string } | null,
//     }
//
//   All three modes are cleared when a new schedule is uploaded (setAnalysis).
//   Baseline mode is also cleared independently when setBaseline(null) is called.
//   Forensic mode operates on the current schedule only — not cleared on baseline change.
//   sceneActivities is cleared on new schedule upload.
//
// HOW TO USE:
//   import { useAnalysis } from '../context/AnalysisContext'
//   const { analysis, setAnalysis, baseline, setBaseline,
//           heliosInsights, setHeliosInsights,
//           sceneActivities, setSceneActivities } = useAnalysis()
//
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useCallback } from 'react'

const AnalysisContext = createContext(null)

export function AnalysisProvider({ children }) {
  const [analysis,  setAnalysisRaw]  = useState(null)
  const [baseline,  setBaselineRaw]  = useState(null)

  // heliosInsights — persisted across views, included in PDF payload.
  // All three modes start null. Each is set independently when Helios runs.
  const [heliosInsights, setHeliosInsights] = useState({
    health:   null,   // { content: string, generatedAt: string }
    baseline: null,   // { content: string, generatedAt: string }
    forensic: null,   // { content: string, generatedAt: string }
  })

  // sceneActivities — the activity list currently visible in ScheduleView.
  // ScheduleView writes this via setSceneActivities whenever the active Scene
  // or filter changes. ReportWizard reads it to export exactly what the user sees.
  // Stored as a flat array of activity objects (same shape as schedule_data.activities).
  const [sceneActivities, setSceneActivities] = useState(null)

  // ── Wrapped setters ───────────────────────────────────────────────────────
  //
  // When a new schedule is uploaded, clear ALL derived state so stale AI
  // content never persists against a new file.

  const setAnalysis = useCallback((data) => {
    setAnalysisRaw(data)
    // Clear all three Helios insight modes and scene state on new schedule upload
    setHeliosInsights({ health: null, baseline: null, forensic: null })
    setSceneActivities(null)
  }, [])

  const setBaseline = useCallback((data) => {
    setBaselineRaw(data)
    // Clear only the baseline insight when baseline changes.
    // Health and forensic insights are still valid for the current schedule.
    if (!data) {
      setHeliosInsights(prev => ({ ...prev, baseline: null }))
    }
  }, [])

  return (
    <AnalysisContext.Provider value={{
      analysis,
      setAnalysis,
      baseline,
      setBaseline,
      heliosInsights,
      setHeliosInsights,
      sceneActivities,
      setSceneActivities,
    }}>
      {children}
    </AnalysisContext.Provider>
  )
}

export function useAnalysis() {
  const ctx = useContext(AnalysisContext)
  if (!ctx) {
    throw new Error('useAnalysis must be used inside <AnalysisProvider>')
  }
  return ctx
}
