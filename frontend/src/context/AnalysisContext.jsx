// ── AnalysisContext.jsx ───────────────────────────────────────────────────────
//
// PURPOSE: Shared state that lives above the React Router.
//
// Why context and not just useState in App.jsx?
// Because two separate *pages* (UploadView and DashboardView) need to read and
// write the same data. Prop-drilling through the router shell would be messy.
// Context is the React-idiomatic way to share state between sibling routes.
//
// WHAT IT STORES:
//   analysis — the raw JSON response from POST /api/analyse (or null before upload).
//              Shape matches the API spec in SKOPIA_PROJECT_INSTRUCTIONS.md.
//
// HOW TO USE IN A COMPONENT:
//   import { useAnalysis } from '../context/AnalysisContext';
//   const { analysis, setAnalysis } = useAnalysis();
//
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState } from 'react'

// 1. Create the context object with a default value of null.
//    The default is only used if a component renders outside the provider —
//    in practice every component is inside <AnalysisProvider>, so this is a
//    safety net.
const AnalysisContext = createContext(null)

// 2. Provider component — wrap the entire app in this (see main.jsx).
//    It owns the state and exposes both the value and the setter.
export function AnalysisProvider({ children }) {
  const [analysis,  setAnalysis]  = useState(null)
  // baseline — the API response from a second upload (the baseline schedule).
  // Activities are merged client-side into ScheduleView by matching on activity id.
  // null until the user uploads a baseline file.
  const [baseline,  setBaseline]  = useState(null)

  return (
    <AnalysisContext.Provider value={{ analysis, setAnalysis, baseline, setBaseline }}>
      {children}
    </AnalysisContext.Provider>
  )
}

// 3. Custom hook — the only way components should read the context.
//    Throws a helpful error if called outside the provider (easier to debug
//    than "cannot read property of undefined").
export function useAnalysis() {
  const ctx = useContext(AnalysisContext)
  if (!ctx) {
    throw new Error('useAnalysis must be used inside <AnalysisProvider>')
  }
  return ctx
}
