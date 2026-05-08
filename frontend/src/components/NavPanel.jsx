// ── NavPanel.jsx ──────────────────────────────────────────────────────────────
//
// The collapsible left navigation panel.
//
// BEHAVIOUR (matches SKOPIA_Lens.html prototype):
//   - Starts collapsed (48px wide, icons only)
//   - Hovering expands to 200px and shows labels + badges
//   - Pin button locks it open so it stays expanded without hovering
//   - Active item has a cyan→blue gradient left-border accent
//   - Badges: Schedule shows activity count, Dashboard shows grade letter
//   - Items without data are shown but not disabled — user can still navigate
//     to them and see the empty state (which has a CTA to upload a schedule)
//
// PROPS:
//   activeView   string  — current view: 'upload' | 'schedule' | 'health' | 'convert'
//   setView      fn      — called with the new view string on item click
//   analysis     object  — the API response (or null). Used for badge values.
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

export default function NavPanel({ activeView, setView, analysis }) {
  // hover = mouse is over the nav (controls expand when not pinned)
  const [hover, setHover]   = useState(false)
  const [pinned, setPinned] = useState(false)

  // Nav is expanded when pinned OR when mouse is over it
  const expanded = pinned || hover

  // Derive badge values from the analysis object (null = no file loaded yet)
  const activityCount = analysis?.summary_stats?.total_activities ?? null
  const grade         = analysis?.overall_grade ?? null

  // Navigation items — icon is a text emoji/symbol matching the prototype
  // badge: null = no badge shown; a value = shown in the badge chip
  const navItems = [
    { id: 'upload',    icon: '⬆',  label: 'Upload',    badge: null },
    { id: 'schedule',  icon: '▦',   label: 'Schedule',  badge: activityCount },
    { id: 'health',    icon: '◈',   label: 'Health Check', badge: grade },
    { id: 'convert',   icon: '⇄',   label: 'Convert',   badge: null },
  ]

  return (
    // Outer nav container — width animates via CSS transition defined in theme.css
    <nav
      style={{
        width:           expanded ? 200 : 48,
        flexShrink:      0,
        background:      'var(--sk-nav)',        // #16213e dark navy
        display:         'flex',
        flexDirection:   'column',
        overflow:        'hidden',
        transition:      'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        borderRight:     '1px solid #1e2d4a',
        position:        'relative',
        zIndex:          100,
      }}
      onMouseEnter={() => !pinned && setHover(true)}
      onMouseLeave={() => !pinned && setHover(false)}
    >

      {/* ── Header-height strip ────────────────────────────────────────────
          This block sits at the top of the nav and visually aligns with the
          app header bar (48px) + gradient accent strip (3px) = 51px total.
          It uses the same charcoal background so the top-left corner looks
          like a unified dark band across the full top of the screen.
          ─────────────────────────────────────────────────────────────────── */}
      <div style={{
        height:          51,  // 48px header + 3px gradient strip
        flexShrink:      0,
        background:      'var(--sk-header)',      // charcoal — matches app header
        borderBottom:    '1px solid #1e2d4a',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        overflow:        'hidden',
      }}>
        {/* Small gradient logo mark — visible in both collapsed and expanded states */}
        
	<div style={{ width: 26, height: 26, flexShrink: 0 }} />
      </div>

      {/* ── Navigation items ──────────────────────────────────────────────── */}
      <div style={{
        flex:           1,
        display:        'flex',
        flexDirection:  'column',
        padding:        '8px 0',
        gap:            2,
        overflow:       'hidden',
      }}>
        {navItems.map(item => {
          const isActive = activeView === item.id

          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              title={!expanded ? item.label : undefined}  // tooltip when collapsed
              style={{
                display:        'flex',
                alignItems:     'center',
                gap:            10,
                padding:        '0 12px',
                height:         40,
                cursor:         'pointer',
                border:         'none',
                background:     isActive ? 'rgba(74, 111, 232, 0.15)' : 'transparent',
                color:          isActive ? '#fff' : '#64748b',
                textAlign:      'left',
                fontFamily:     'var(--font-body)',
                fontSize:       12,
                fontWeight:     600,
                whiteSpace:     'nowrap',
                overflow:       'hidden',
                width:          '100%',
                // Left accent bar for active item — gradient strip on left edge
                // We use boxShadow inset trick to avoid a separate element
                boxShadow:      isActive
                  ? 'inset 3px 0 0 0 #1EC8D4'  // cyan left border
                  : 'none',
                transition:     'background 0.12s, color 0.12s',
                position:       'relative',
              }}
            >
              {/* Icon — always visible (collapsed and expanded) */}
              <span style={{
                flexShrink:    0,
                width:         20, height: 20,
                display:       'flex', alignItems: 'center', justifyContent: 'center',
                fontSize:      15,
              }}>
                {item.icon}
              </span>

              {/* Label — only when expanded */}
              {expanded && (
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.label}
                </span>
              )}

              {/* Badge — only when expanded AND a badge value exists */}
              {expanded && item.badge != null && (
                <span style={{
                  fontFamily:  'var(--font-mono)',
                  fontSize:    9,
                  fontWeight:  700,
                  background:  'rgba(74, 111, 232, 0.3)',
                  color:       '#7C9EFF',
                  borderRadius: 3,
                  padding:     '1px 5px',
                  flexShrink:  0,
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Pin / unpin toggle ─────────────────────────────────────────────
          At the bottom of the nav. Click to lock the panel open.
          Arrow direction indicates the current state:
            ▶ = collapsed / unpinned  → click to pin
            ◀ = pinned (expanded)     → click to unpin
          ─────────────────────────────────────────────────────────────────── */}
      <div
        onClick={() => setPinned(v => !v)}
        title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
        style={{
          height:          36,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          borderTop:       '1px solid #1e2d4a',
          flexShrink:      0,
          cursor:          'pointer',
          color:           pinned ? '#4A6FE8' : '#334155',
          transition:      'color 0.12s',
          fontSize:        14,
          userSelect:      'none',
        }}
      >
        {/* Show ◀ when expanded+pinned, ▶ otherwise */}
        {expanded && pinned ? '◀' : '▶'}
      </div>
    </nav>
  )
}
