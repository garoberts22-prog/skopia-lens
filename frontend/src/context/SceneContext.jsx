// ── SceneContext.jsx ──────────────────────────────────────────────────────────
//
// Manages "Scenes" — saved view layout snapshots for the Schedule Gantt.
// A Scene captures: column visibility/order/widths, filter mode, WBS grouping
// settings, all Customise panel tweaks, duration units, and date format.
//
// Behaviour rules (per spec):
//  - DEFAULT scene is applied ONLY when a new schedule is uploaded, or when
//    the user explicitly selects Default from the Scene Manager.
//  - Navigating away from ScheduleView and back does NOT reset to Default.
//  - Saved user scenes persist in localStorage across sessions.
//  - The Default scene can never be deleted.
//
// Usage:
//   Wrap your app (in main.jsx) with <SceneProvider> INSIDE <AnalysisProvider>.
//   ScheduleView reads scene state via useScene() and writes via scene actions.
//
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

// ── Default column definitions (must match DEFAULT_COLS in ScheduleView.jsx) ─
// Duplicated here so SceneContext has no import dependency on ScheduleView.
// If DEFAULT_COLS changes in ScheduleView, update this list too.
const SCENE_DEFAULT_COLS = [
  { key:'id',              label:'Activity ID',           category:'Identity',  width:130, fixed:true,  visible:true  },
  { key:'name',            label:'Activity Name',         category:'Identity',  width:230, fixed:true,  visible:true  },
  { key:'rem_dur',         label:'Rem Dur',               category:'Durations', width:72,  fixed:false, visible:true  },
  { key:'orig_dur',        label:'Orig Dur',              category:'Durations', width:72,  fixed:false, visible:false },
  { key:'start',           label:'Start',                 category:'Dates',     width:96,  fixed:false, visible:true  },
  { key:'finish',          label:'Finish',                category:'Dates',     width:96,  fixed:false, visible:true  },
  { key:'exp_finish',      label:'Finish By',             category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'base_start',      label:'Baseline Start',        category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'base_finish',     label:'Baseline Finish',       category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'var_bl_start',    label:'Var BL Start',          category:'Dates',     width:80,  fixed:false, visible:false },
  { key:'var_bl_finish',   label:'Var BL Finish',         category:'Dates',     width:80,  fixed:false, visible:false },
  { key:'act_start',       label:'Actual Start',          category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'act_finish',      label:'Actual Finish',         category:'Dates',     width:96,  fixed:false, visible:false },
  { key:'total_float',     label:'Total Float',           category:'Float',     width:80,  fixed:false, visible:true  },
  { key:'free_float',      label:'Free Float',            category:'Float',     width:72,  fixed:false, visible:false },
  { key:'status',          label:'Status',                category:'Progress',  width:86,  fixed:false, visible:false },
  { key:'type',            label:'Type',                  category:'Progress',  width:72,  fixed:false, visible:false },
  { key:'cstr_type',       label:'Constraint',            category:'General',   width:160, fixed:false, visible:false },
  { key:'calendar',        label:'Calendar',              category:'General',   width:140, fixed:false, visible:false },
  { key:'num_activities',  label:'# Activities',          category:'General',   width:80,  fixed:false, visible:false },
  { key:'predecessors',    label:'Predecessors',          category:'Lists',     width:180, fixed:false, visible:false },
  { key:'successors',      label:'Successors',            category:'Lists',     width:180, fixed:false, visible:false },
  { key:'budget_units',    label:'Budget Units',          category:'Units',     width:96,  fixed:false, visible:false },
  { key:'actual_units',    label:'Actual Units',          category:'Units',     width:96,  fixed:false, visible:false },
  { key:'remaining_units', label:'Remaining Units',       category:'Units',     width:96,  fixed:false, visible:false },
  { key:'at_comp_units',   label:'At Completion Units',   category:'Units',     width:110, fixed:false, visible:false },
  { key:'var_budget_units',label:'Var to BL Budget Units',category:'Units',     width:120, fixed:false, visible:false },
  { key:'resource_id',     label:'Resource ID',           category:'Resources', width:110, fixed:false, visible:false },
  { key:'resource_name',   label:'Resource Name',         category:'Resources', width:150, fixed:false, visible:false },
]

// ── Default tweaks (must match useState(tweaks) initial value in ScheduleView) ─
const SCENE_DEFAULT_TWEAKS = {
  rowHeight:         26,
  rowStripes:        true,
  barStyle:          'filled',
  barScheme:         'pastel',
  barOpacity:        85,
  barCornerRadius:   3,
  showBarLabels:     false,
  showWbsBars:       true,
  criticalHighlight: true,
  milestoneSize:     7,
  showBaselineBars:  true,
  showStatusIcons:   true,
  wbsIntensity:      25,
  showRelConnectors: false,
}

// ── The built-in Default scene ────────────────────────────────────────────────
// id:'default' is the sentinel — the Scene Manager checks this to prevent deletion.
const DEFAULT_SCENE = {
  id:           'default',
  name:         'Default',
  isDefault:    true,
  createdAt:    null,     // no date shown for the built-in scene
  cols:         SCENE_DEFAULT_COLS.map(c => ({ ...c })),
  critOnly:     false,
  showWbsBands: true,
  hideEmpty:    false,
  showWbsId:    false,
  durUnit:      'Days',
  dateFmt:      'DD-Mon-YY',
  tweaks:       { ...SCENE_DEFAULT_TWEAKS },
}

// ── localStorage key ──────────────────────────────────────────────────────────
const LS_KEY = 'skopia_lens_scenes'

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateId() {
  // Simple collision-resistant ID — no UUID dependency needed
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function loadScenesFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Validate: must be an array, each item must have id + name
    if (!Array.isArray(parsed)) return []
    return parsed.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string')
  } catch {
    return []
  }
}

function saveScenesToStorage(scenes) {
  try {
    // Never persist the built-in Default scene — it's always rebuilt from code
    const toSave = scenes.filter(s => s.id !== 'default')
    localStorage.setItem(LS_KEY, JSON.stringify(toSave))
  } catch {
    // localStorage full or unavailable — silently swallow
  }
}

// ── Context ───────────────────────────────────────────────────────────────────
const SceneContext = createContext(null)

export function SceneProvider({ children }) {
  // ── Scene list: [DEFAULT_SCENE, ...userScenes] ────────────────────────────
  // Default is always index 0, never stored in localStorage.
  const [userScenes, setUserScenes] = useState(() => loadScenesFromStorage())

  // ── Live view state — this IS the current scene applied to the Gantt ──────
  // Initialised from Default. Survives navigation (component stays mounted at
  // the context level, above the view router).
  const [cols,         setCols]         = useState(() => DEFAULT_SCENE.cols.map(c => ({ ...c })))
  const [critOnly,     setCritOnly]     = useState(DEFAULT_SCENE.critOnly)
  const [showWbsBands, setShowWbsBands] = useState(DEFAULT_SCENE.showWbsBands)
  const [hideEmpty,    setHideEmpty]    = useState(DEFAULT_SCENE.hideEmpty)
  const [showWbsId,    setShowWbsId]    = useState(DEFAULT_SCENE.showWbsId)
  const [durUnit,      setDurUnit]      = useState(DEFAULT_SCENE.durUnit)
  const [dateFmt,      setDateFmt]      = useState(DEFAULT_SCENE.dateFmt)
  const [tweaks,       setTweaks]       = useState(() => ({ ...DEFAULT_SCENE.tweaks }))

  // Track which scene is currently "active" — used to highlight in Scene Manager
  const [activeSceneId, setActiveSceneId] = useState('default')

  // ── Persist user scenes to localStorage whenever they change ─────────────
  useEffect(() => {
    saveScenesToStorage(userScenes)
  }, [userScenes])

  // ── Full scenes list exposed to consumers ─────────────────────────────────
  const scenes = [DEFAULT_SCENE, ...userScenes]

  // ── applyScene — applies a saved scene's settings to live state ───────────
  // Called by: Scene Manager (user picks a scene), resetToDefault (upload trigger).
  const applyScene = useCallback((scene) => {
    // Deep-copy cols so edits don't mutate the saved scene object
    setCols((scene.cols || DEFAULT_SCENE.cols).map(c => ({ ...c })))
    setCritOnly(scene.critOnly       ?? DEFAULT_SCENE.critOnly)
    setShowWbsBands(scene.showWbsBands ?? DEFAULT_SCENE.showWbsBands)
    setHideEmpty(scene.hideEmpty     ?? DEFAULT_SCENE.hideEmpty)
    setShowWbsId(scene.showWbsId     ?? DEFAULT_SCENE.showWbsId)
    setDurUnit(scene.durUnit         ?? DEFAULT_SCENE.durUnit)
    setDateFmt(scene.dateFmt         ?? DEFAULT_SCENE.dateFmt)
    setTweaks({ ...DEFAULT_SCENE.tweaks, ...(scene.tweaks || {}) })
    setActiveSceneId(scene.id)
  }, [])

  // ── resetToDefault — convenience wrapper, called on new schedule upload ───
  const resetToDefault = useCallback(() => {
    applyScene(DEFAULT_SCENE)
  }, [applyScene])

  // ── captureCurrentState — snapshots live state into a scene payload ───────
  // Used by saveCurrentAsScene() to package up what's on screen right now.
  const captureCurrentState = useCallback(() => ({
    cols:         cols.map(c => ({ ...c })),
    critOnly,
    showWbsBands,
    hideEmpty,
    showWbsId,
    durUnit,
    dateFmt,
    tweaks:       { ...tweaks },
  }), [cols, critOnly, showWbsBands, hideEmpty, showWbsId, durUnit, dateFmt, tweaks])

  // ── saveCurrentAsScene — creates a new named user scene ──────────────────
  const saveCurrentAsScene = useCallback((name) => {
    const trimmed = name?.trim()
    if (!trimmed) return { ok: false, error: 'Name cannot be empty' }

    const newScene = {
      id:        generateId(),
      name:      trimmed,
      isDefault: false,
      createdAt: new Date().toISOString(),
      ...captureCurrentState(),
    }

    setUserScenes(prev => [...prev, newScene])
    setActiveSceneId(newScene.id)
    return { ok: true, scene: newScene }
  }, [captureCurrentState])

  // ── deleteScene — removes a user scene; Default cannot be deleted ─────────
  const deleteScene = useCallback((sceneId) => {
    if (sceneId === 'default') return  // guard — should never be called with 'default'
    setUserScenes(prev => prev.filter(s => s.id !== sceneId))
    // If the deleted scene was active, fall back to Default
    setActiveSceneId(prev => prev === sceneId ? 'default' : prev)
  }, [])

  // ── setTweak — single-key tweak update (matches ScheduleView pattern) ─────
  const setTweak = useCallback((key, val) => {
    setTweaks(prev => ({ ...prev, [key]: val }))
    setActiveSceneId('_unsaved')  // mark as unsaved when user edits
  }, [])

  // Mark unsaved when any scene-tracked state changes directly
  // (e.g. user changes a column in the Column Manager without saving a scene)
  const markUnsaved = useCallback(() => setActiveSceneId('_unsaved'), [])

  const value = {
    // Scene list + management
    scenes,
    activeSceneId,
    applyScene,
    resetToDefault,
    saveCurrentAsScene,
    deleteScene,

    // Live view state — ScheduleView reads these instead of local useState
    cols,         setCols:         (v) => { setCols(v);         markUnsaved() },
    critOnly,     setCritOnly:     (v) => { setCritOnly(v);     markUnsaved() },
    showWbsBands, setShowWbsBands: (v) => { setShowWbsBands(v); markUnsaved() },
    hideEmpty,    setHideEmpty:    (v) => { setHideEmpty(v);    markUnsaved() },
    showWbsId,    setShowWbsId:    (v) => { setShowWbsId(v);    markUnsaved() },
    durUnit,      setDurUnit:      (v) => { setDurUnit(v);      markUnsaved() },
    dateFmt,      setDateFmt:      (v) => { setDateFmt(v);      markUnsaved() },
    tweaks,       setTweaks,       setTweak,
  }

  return (
    <SceneContext.Provider value={value}>
      {children}
    </SceneContext.Provider>
  )
}

// ── Consumer hook ─────────────────────────────────────────────────────────────
export function useScene() {
  const ctx = useContext(SceneContext)
  if (!ctx) throw new Error('useScene must be used inside <SceneProvider>')
  return ctx
}
