// ── main.jsx ──────────────────────────────────────────────────────────────────
//
// App entry point — the first file Vite loads.
//
// WHAT HAPPENS HERE:
//   1. Import the SKOPIA theme CSS (CSS variables + Tailwind base + Google Fonts)
//   2. Wrap the whole app in <AnalysisProvider> so every component can access
//      the analysis state via useAnalysis()
//   3. Wrap inside <SceneProvider> so ScheduleView can access scene state via
//      useScene() — SceneProvider sits inside AnalysisProvider (no dependency
//      on AnalysisContext, but keeps providers co-located for clarity)
//   4. Mount <App> into the #root div in index.html
//
// ─────────────────────────────────────────────────────────────────────────────

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// ── Theme first — imports Google Fonts + CSS variables + Tailwind directives
import './styles/theme.css'

// ── Context providers
import { AnalysisProvider } from './context/AnalysisContext'
import { SceneProvider }    from './context/SceneContext'

// ── Root component
import App from './App'

// createRoot is the React 18 way to mount the app.
// StrictMode renders components twice in development to catch side-effects —
// this is normal and won't happen in production builds.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AnalysisProvider>
      <SceneProvider>
        <App />
      </SceneProvider>
    </AnalysisProvider>
  </StrictMode>
)
