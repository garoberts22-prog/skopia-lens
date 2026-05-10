// ── SceneManager.jsx ─────────────────────────────────────────────────────────
//
// Scene Manager panel — triggered by the Scenes button in the ScheduleView
// toolbar (between the As-of date chip and the ⚙ Customise cog).
//
// Features:
//  - Lists all scenes: Default (built-in) + user-saved scenes
//  - Apply: click any scene row to apply it to the current view
//  - Save current: name input + Save button → creates a new user scene
//  - Delete: trash icon on user scenes (Default cannot be deleted)
//  - Active scene highlighted with SKOPIA periwinkle accent
//  - Unsaved changes indicator when live state has diverged from any saved scene
//
// Props:
//   onClose  — () => void   — called when user clicks ✕ or presses Escape
//   btnRef   — ref          — the trigger button ref, used to anchor the popover
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import { useScene } from '../context/SceneContext'

// ── Brand colours (mirrored from ScheduleView SK constant) ───────────────────
const SK = {
  pass:   '#16A34A', warn: '#D97706', fail: '#DC2626',
  peri:   '#4A6FE8', cyan: '#1EC8D4', blue: '#2A4DCC',
  muted:  '#6B7280', text: '#1A1A2E', border: '#E2E6F0',
  bg:     '#F7F8FC', card: '#FFFFFF', header: '#1E1E1E',
  grad:   'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
  fHead:  "'Montserrat',Arial,sans-serif",
  fBody:  "'Open Sans',Arial,sans-serif",
  fMono:  "'JetBrains Mono',monospace",
}

// ── Date formatter for "created" label ───────────────────────────────────────
function fmtCreated(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' })
  } catch {
    return null
  }
}

// ── SceneManager ──────────────────────────────────────────────────────────────
export default function SceneManager({ onClose, btnRef }) {
  const {
    scenes,
    activeSceneId,
    applyScene,
    saveCurrentAsScene,
    deleteScene,
  } = useScene()

  // Save-new form state
  const [saveName,    setSaveName]    = useState('')
  const [saveError,   setSaveError]   = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Delete confirmation: stores the scene id being confirmed, or null
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const panelRef    = useRef(null)
  const nameInputRef = useRef(null)

  // ── Close on Escape ───────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      // Ignore clicks inside the panel or on the trigger button
      if (panelRef.current?.contains(e.target)) return
      if (btnRef?.current?.contains(e.target)) return
      onClose()
    }
    // Use capture:true so we catch it before anything stops propagation
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [onClose, btnRef])

  // ── Position panel below the button ──────────────────────────────────────
  // Anchored to the bottom-right of the trigger button, drops down.
  useEffect(() => {
    if (!panelRef.current || !btnRef?.current) return
    const rect = btnRef.current.getBoundingClientRect()
    panelRef.current.style.top   = (rect.bottom + 6) + 'px'
    panelRef.current.style.right = (window.innerWidth - rect.right) + 'px'
  }, [btnRef])

  // ── Focus the name input when panel opens ─────────────────────────────────
  useEffect(() => {
    setTimeout(() => nameInputRef.current?.focus(), 80)
  }, [])

  // ── Save handler ──────────────────────────────────────────────────────────
  function handleSave() {
    const result = saveCurrentAsScene(saveName)
    if (!result.ok) {
      setSaveError(result.error || 'Invalid name')
      return
    }
    setSaveName('')
    setSaveError('')
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2000)
  }

  function handleSaveKeyDown(e) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onClose()
  }

  // ── Delete flow ───────────────────────────────────────────────────────────
  function handleDeleteClick(e, sceneId) {
    e.stopPropagation()           // don't trigger row apply
    setConfirmDeleteId(sceneId)
  }

  function handleDeleteConfirm(e, sceneId) {
    e.stopPropagation()
    deleteScene(sceneId)
    setConfirmDeleteId(null)
  }

  function handleDeleteCancel(e) {
    e.stopPropagation()
    setConfirmDeleteId(null)
  }

  // ── Unsaved indicator ─────────────────────────────────────────────────────
  const isUnsaved = activeSceneId === '_unsaved'

  return (
    <div
      ref={panelRef}
      style={{
        position:     'fixed',
        zIndex:       500,
        width:        320,
        background:   SK.card,
        border:       `1px solid ${SK.border}`,
        borderRadius: 10,
        boxShadow:    '0 8px 32px rgba(42,77,204,0.18)',
        fontFamily:   SK.fBody,
        overflow:     'hidden',
      }}
    >
      {/* ── Panel header ─────────────────────────────────────────────────── */}
      <div style={{ background: SK.header, padding: '11px 14px 9px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Film-strip icon — distinguishes Scenes from the ⚙ cog */}
        <span style={{ fontSize: 14, opacity: 0.85 }}>⊞</span>
        <span style={{
          fontFamily: SK.fHead, fontWeight: 700, fontSize: 13,
          color: '#fff', letterSpacing: '-0.2px', flex: 1,
        }}>
          Scenes
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none',
            color: 'rgba(255,255,255,0.45)', cursor: 'pointer',
            fontSize: 16, lineHeight: 1, padding: '2px 4px',
          }}
          title="Close"
        >✕</button>
      </div>

      {/* Gradient accent strip */}
      <div style={{ height: 3, background: SK.grad, flexShrink: 0 }} />

      {/* ── Save current view section ─────────────────────────────────────── */}
      <div style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${SK.border}` }}>
        <div style={{
          fontFamily: SK.fHead, fontWeight: 700, fontSize: 9,
          textTransform: 'uppercase', letterSpacing: '0.07em',
          color: SK.muted, marginBottom: 8,
        }}>
          Save Current View as New Scene
        </div>

        {/* Unsaved changes nudge */}
        {isUnsaved && (
          <div style={{
            fontSize: 10, color: SK.warn,
            background: `${SK.warn}10`, border: `1px solid ${SK.warn}33`,
            borderRadius: 5, padding: '5px 9px', marginBottom: 8,
            fontFamily: SK.fBody, lineHeight: 1.5,
          }}>
            You have unsaved changes to the current view.
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={nameInputRef}
            type="text"
            value={saveName}
            onChange={e => { setSaveName(e.target.value); setSaveError('') }}
            onKeyDown={handleSaveKeyDown}
            placeholder="Scene name…"
            maxLength={60}
            style={{
              flex: 1,
              fontFamily: SK.fBody, fontSize: 12,
              color: SK.text, background: SK.bg,
              border: `1px solid ${saveError ? SK.fail : SK.border}`,
              borderRadius: 6, padding: '6px 10px',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={handleSave}
            disabled={!saveName.trim()}
            style={{
              fontFamily: SK.fHead, fontWeight: 700, fontSize: 11,
              background: saveName.trim() ? SK.grad : SK.border,
              color: saveName.trim() ? '#fff' : SK.muted,
              border: 'none', borderRadius: 6,
              padding: '6px 14px', cursor: saveName.trim() ? 'pointer' : 'default',
              whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}
          >
            {saveSuccess ? '✓ Saved' : 'Save'}
          </button>
        </div>

        {/* Inline error */}
        {saveError && (
          <div style={{ fontSize: 10, color: SK.fail, marginTop: 4, fontFamily: SK.fBody }}>
            {saveError}
          </div>
        )}
      </div>

      {/* ── Scene list ───────────────────────────────────────────────────── */}
      <div style={{
        maxHeight: 320,
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: `${SK.border} transparent`,
      }}>
        {/* Section label */}
        <div style={{
          padding: '8px 14px 4px',
          fontFamily: SK.fHead, fontWeight: 700, fontSize: 9,
          textTransform: 'uppercase', letterSpacing: '0.07em', color: SK.muted,
        }}>
          Saved Scenes
        </div>

        {scenes.map((scene) => {
          const isActive  = activeSceneId === scene.id
          const isConfirm = confirmDeleteId === scene.id
          const created   = fmtCreated(scene.createdAt)

          return (
            <div
              key={scene.id}
              onClick={() => {
                // If confirming delete, don't apply on row click
                if (isConfirm) return
                applyScene(scene)
              }}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          10,
                padding:      '8px 14px',
                cursor:       isConfirm ? 'default' : 'pointer',
                background:   isActive ? `${SK.peri}0F` : 'transparent',
                borderLeft:   `3px solid ${isActive ? SK.peri : 'transparent'}`,
                borderBottom: `1px solid ${SK.border}`,
                transition:   'background 0.12s',
              }}
              onMouseEnter={e => { if (!isActive && !isConfirm) e.currentTarget.style.background = SK.bg }}
              onMouseLeave={e => { if (!isActive && !isConfirm) e.currentTarget.style.background = 'transparent' }}
            >
              {/* Scene icon — filled square for active, outline for others */}
              <span style={{
                fontSize: 11,
                color: isActive ? SK.peri : SK.muted,
                flexShrink: 0,
                lineHeight: 1,
              }}>
                {isActive ? '◼' : '◻'}
              </span>

              {/* Scene name + metadata */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: SK.fHead, fontWeight: 700, fontSize: 12,
                  color: isActive ? SK.peri : SK.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {scene.name}
                </div>
                {/* Created date for user scenes; "Built-in" label for Default */}
                <div style={{ fontFamily: SK.fMono, fontSize: 9, color: SK.muted, marginTop: 2 }}>
                  {scene.isDefault
                    ? 'Built-in · cannot be deleted'
                    : created
                      ? `Saved ${created}`
                      : 'User scene'
                  }
                </div>
              </div>

              {/* Active badge */}
              {isActive && activeSceneId !== '_unsaved' && (
                <span style={{
                  fontFamily: SK.fMono, fontWeight: 700, fontSize: 8,
                  color: SK.peri, background: `${SK.peri}14`,
                  border: `1px solid ${SK.peri}44`,
                  borderRadius: 4, padding: '2px 7px', flexShrink: 0,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  Active
                </span>
              )}

              {/* Delete controls — only for user-created scenes */}
              {!scene.isDefault && (
                isConfirm ? (
                  /* Confirmation state — two small buttons */
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={(e) => handleDeleteConfirm(e, scene.id)}
                      style={{
                        fontFamily: SK.fHead, fontWeight: 700, fontSize: 10,
                        background: SK.fail, color: '#fff',
                        border: 'none', borderRadius: 4,
                        padding: '3px 9px', cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                    <button
                      onClick={handleDeleteCancel}
                      style={{
                        fontFamily: SK.fHead, fontWeight: 700, fontSize: 10,
                        background: 'transparent', color: SK.muted,
                        border: `1px solid ${SK.border}`, borderRadius: 4,
                        padding: '3px 9px', cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  /* Normal state — single trash icon */
                  <button
                    onClick={(e) => handleDeleteClick(e, scene.id)}
                    title="Delete scene"
                    style={{
                      background: 'none', border: 'none',
                      color: SK.muted, cursor: 'pointer',
                      fontSize: 13, padding: '2px 4px', flexShrink: 0,
                      lineHeight: 1, borderRadius: 3,
                      transition: 'color 0.12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = SK.fail }}
                    onMouseLeave={e => { e.currentTarget.style.color = SK.muted }}
                  >
                    🗑
                  </button>
                )
              )}
            </div>
          )
        })}

        {/* Empty state — only user scenes list is empty (Default always shows) */}
        {scenes.length === 1 && (
          <div style={{
            padding: '12px 14px',
            fontFamily: SK.fBody, fontSize: 12, color: SK.muted,
            textAlign: 'center', lineHeight: 1.6,
          }}>
            No saved scenes yet.<br />
            Customise your view and save it above.
          </div>
        )}
      </div>

      {/* ── Footer hint ───────────────────────────────────────────────────── */}
      <div style={{
        padding: '7px 14px',
        borderTop: `1px solid ${SK.border}`,
        fontFamily: SK.fBody, fontSize: 10, color: SK.muted,
        background: SK.bg, lineHeight: 1.5,
      }}>
        Scenes save column layout, filters, grouping, and display settings.
        They persist across sessions.
      </div>
    </div>
  )
}
