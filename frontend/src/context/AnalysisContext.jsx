// ── AnalysisContext.jsx ───────────────────────────────────────────────────────
//
// v1.1 — Added heliosInsights state for Helios AI panel.
//
// WHAT IT STORES:
//   analysis        — full JSON from POST /api/analyse (null before upload)
//   baseline        — second upload response for baseline comparison (null until uploaded)
//   heliosInsights  — AI-generated insights from POST /api/helios, stored so
//                     they survive navigation and can be included in PDF export.
//
//   heliosInsights shape:
//     {
//       health:   { content: string, generatedAt: string } | null,
//       baseline: { content: string, generatedAt: string } | null,
//     }
//
//   Cleared automatically when a new schedule is uploaded (setAnalysis resets it).
//   Baseline insights cleared when setBaseline(null) is called.
//
// HOW TO USE:
//   import { useAnalysis } from '../context/AnalysisContext'
//   const { analysis, setAnalysis, baseline, setBaseline,
//           heliosInsights, setHeliosInsights } = useAnalysis()
//
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useCallback } from 'react'

const AnalysisContext = createContext(null)

export function AnalysisProvider({ children }) {
  const [analysis,  setAnalysisRaw]  = useState(null)
  const [baseline,  setBaselineRaw]  = useState(null)

  // heliosInsights — persisted across views, included in PDF payload
  // Both modes start null. Each is set independently when Helios runs.
  const [heliosInsights, setHeliosInsights] = useState({
    health:   null,   // { content: string, generatedAt: string }
    baseline: null,   // { content: string, generatedAt: string }
  })

  // ── Wrapped setters ───────────────────────────────────────────────────────
  //
  // When a new schedule is uploaded, clear all derived state (Helios insights)
  // so stale AI content doesn't persist against a new file.

  const setAnalysis = useCallback((data) => {
    setAnalysisRaw(data)
    // Clear both Helios insight modes on new schedule upload
    setHeliosInsights({ health: null, baseline: null })
  }, [])

  const setBaseline = useCallback((data) => {
    setBaselineRaw(data)
    // Clear only the baseline insight when baseline changes
    // Health insight is still valid for the current schedule
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
