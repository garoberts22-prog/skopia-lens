// ── CheckSettingsCog.jsx ──────────────────────────────────────────────────────
//
// Gear icon on each check card. Opens a popover with:
//   - Enable/disable toggle
//   - Slider(s) for threshold values (check-specific)
//   - Reset + Re-run buttons
//
// PROPS:
//   checkId         string  — e.g. "logic_completeness"
//   settings        object  — current settings for this check
//   onSettingsChange fn     — called with (checkId, newSettings)
//   onRerun         fn      — called when user clicks Re-run
//   isDirty         bool    — settings changed since last run
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'

// Threshold parameter definitions per check.
// Maps check_id → array of slider params.
const CHECK_DEFS = {
  logic_completeness: {
    label: 'Logic Completeness',
    params: [{ key: 'threshold', label: 'Max % missing logic', min: 0, max: 20, step: 1, unit: '%', default: 5 }],
  },
  leads: { label: 'Leads', params: [] },
  lags: {
    label: 'Lags',
    params: [{ key: 'threshold', label: 'Max % with positive lag', min: 0, max: 20, step: 1, unit: '%', default: 5 }],
  },
  relationship_types: {
    label: 'Relationship Types',
    params: [{ key: 'threshold', label: 'Min % FS relationships', min: 70, max: 100, step: 1, unit: '%', default: 90 }],
  },
  hard_constraints: {
    label: 'Hard Constraints',
    params: [{ key: 'threshold', label: 'Max % constrained', min: 0, max: 20, step: 1, unit: '%', default: 5 }],
  },
  high_float: {
    label: 'High Float',
    params: [
      { key: 'high_float_days', label: 'Float days threshold', min: 10, max: 120, step: 5, unit: 'd', default: 44 },
      { key: 'threshold', label: 'Max % exceeding threshold', min: 0, max: 30, step: 1, unit: '%', default: 5 },
    ],
  },
  negative_float: { label: 'Negative Float', params: [] },
  duration: {
    label: 'Duration Analysis',
    params: [
      { key: 'duration_days', label: 'Max duration threshold', min: 10, max: 120, step: 5, unit: 'd', default: 44 },
      { key: 'threshold', label: 'Max % exceeding threshold', min: 0, max: 30, step: 1, unit: '%', default: 5 },
    ],
  },
  calendar_validation: { label: 'Calendar Validation', params: [] },
  logic_density:       { label: 'Logic Density', params: [] },
  bottlenecks:         { label: 'Bottleneck Detection', params: [] },
  resources:           { label: 'Resources', params: [] },
  missed_tasks:        { label: 'Missed Tasks', params: [] },
  cp_integrity_test:   { label: 'CP Integrity Test', params: [] },
  cp_length:           { label: 'CP Length', params: [] },
  near_critical:       { label: 'Near-Critical', params: [] },
  bei:                 { label: 'BEI', params: [] },
}

const SK = {
  peri: '#4A6FE8', pass: '#16A34A', warn: '#D97706', fail: '#DC2626',
  muted: '#6B7280', text: '#1A1A2E', border: '#E2E6F0', bg: '#F7F8FC',
  header: '#1E1E1E',
}

export default function CheckSettingsCog({ checkId, settings, onSettingsChange, onRerun, isDirty }) {
  const [open, setOpen] = useState(false)
  const popoverRef      = useRef(null)
  const buttonRef       = useRef(null)

  const def        = CHECK_DEFS[checkId] ?? { label: checkId, params: [] }
  const cur        = settings ?? {}
  const isDisabled = cur.disabled === true

  // Has the user changed anything from defaults?
  const hasChanges = isDisabled || def.params.some(p => cur[p.key] != null && cur[p.key] !== p.default)

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) &&
          buttonRef.current  && !buttonRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Position popover after it renders
  useEffect(() => {
    if (!open || !popoverRef.current || !buttonRef.current) return
    const btn    = buttonRef.current.getBoundingClientRect()
    const pop    = popoverRef.current
    const popH   = pop.offsetHeight
    const left   = Math.max(8, btn.right - 264)
    const top    = Math.max(8, btn.top - popH - 6)
    pop.style.left = left + 'px'
    pop.style.top  = top  + 'px'
  }, [open])

  function getVal(p) {
    return cur[p.key] != null ? cur[p.key] : p.default
  }

  function setParam(key, val) {
    onSettingsChange(checkId, { ...cur, [key]: val })
  }

  function reset() {
    onSettingsChange(checkId, {})
  }

  return (
    <div
      style={{ position: 'relative' }}
      onClick={e => e.stopPropagation()}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Cog button */}
      <button
        ref={buttonRef}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        title="Check settings"
        style={{
          width: 22, height: 22, borderRadius: 4, border: 'none',
          background: open ? SK.peri : hasChanges ? '#FEF3C7' : 'transparent',
          color: open ? '#fff' : hasChanges ? SK.warn : SK.muted,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, flexShrink: 0,
          transition: 'background 0.12s, color 0.12s',
        }}
      >
        ⚙
      </button>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          style={{
            position: 'fixed', zIndex: 9000,
            background: '#fff',
            border: `1px solid ${SK.border}`,
            borderRadius: 10,
            boxShadow: '0 8px 28px rgba(42,77,204,0.22)',
            width: 264, overflow: 'hidden',
          }}
        >
          {/* Popover header */}
          <div style={{ background: SK.header, padding: '10px 14px 8px' }}>
            <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 12, color: '#fff', marginBottom: 1 }}>
              {def.label}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
              Check settings
            </div>
          </div>
          <div style={{ height: 2, background: 'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)' }} />

          <div style={{ padding: '12px 14px' }}>
            {/* Enable / disable toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: SK.text }}>Enable check</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: SK.muted, marginTop: 1 }}>Include in scoring + grade</div>
              </div>
              {/* Toggle pill */}
              <div
                onClick={() => setParam('disabled', !isDisabled)}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: !isDisabled ? SK.pass : SK.border,
                  cursor: 'pointer', position: 'relative',
                  transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 8, background: '#fff',
                  position: 'absolute', top: 3,
                  left: !isDisabled ? 21 : 3,
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
            </div>

            {/* Parameter sliders */}
            {def.params.length > 0 && (
              <div style={{ borderTop: `1px solid ${SK.border}`, paddingTop: 10, marginBottom: 4 }}>
                {def.params.map(p => {
                  const v         = getVal(p)
                  const isDefault = v === p.default
                  return (
                    <div key={p.key} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: SK.text, fontWeight: 600 }}>
                          {p.label}
                        </span>
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
                          color: isDefault ? SK.muted : SK.peri,
                          background: isDefault ? SK.bg : SK.peri + '12',
                          border: `1px solid ${isDefault ? SK.border : SK.peri + '44'}`,
                          borderRadius: 4, padding: '1px 7px',
                          minWidth: 36, textAlign: 'center',
                        }}>
                          {v}{p.unit}
                        </span>
                      </div>
                      <input
                        type="range" min={p.min} max={p.max} step={p.step} value={v}
                        onChange={e => setParam(p.key, Number(e.target.value))}
                        style={{ width: '100%', accentColor: SK.peri, height: 4 }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9, color: SK.muted, marginTop: 2 }}>
                        <span>{p.min}{p.unit}</span>
                        <span style={{ color: isDefault ? SK.border : SK.muted + '88' }}>default: {p.default}{p.unit}</span>
                        <span>{p.max}{p.unit}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Footer buttons */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8, borderTop: `1px solid ${SK.border}`, paddingTop: 10 }}>
              <button
                onClick={reset}
                style={{
                  flex: 1, fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
                  padding: '5px 0', borderRadius: 5,
                  border: `1px solid ${SK.border}`,
                  background: SK.bg, color: hasChanges ? SK.text : SK.muted, cursor: 'pointer',
                }}
              >
                Reset
              </button>
              <button
                onClick={() => { onRerun(); setOpen(false) }}
                style={{
                  flex: 2, fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
                  padding: '5px 0', borderRadius: 5, border: 'none',
                  background: isDirty ? 'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)' : SK.border,
                  color: isDirty ? '#fff' : SK.muted,
                  cursor: isDirty ? 'pointer' : 'default',
                }}
              >
                {isDirty ? '↺ Re-run checks' : 'Checks current'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
