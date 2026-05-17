// ── NavPanel.jsx ──────────────────────────────────────────────────────────────
//
// v0.9.6 — Hub restructure
//
// CHANGES from v0.9.5:
//   - Upload and Convert nav items REMOVED
//   - New "Hub" item added as FIRST item (above Schedule)
//   - Hub uses ◉ icon, matching the design spec
//
// Nav items (new order):
//   1. Hub          ◉   — default landing page
//   2. Schedule     ▦
//   3. Health Check ◈
//
// BEHAVIOUR (unchanged from previous):
//   - Starts collapsed (48px wide, icons only)
//   - Hovering expands to 200px and shows labels
//   - Pin button locks it open
//   - Active item has a cyan left-border accent
//   - Items without data are shown but show an EmptyState when clicked
//
// PROPS:
//   activeView   string  — current view: 'hub' | 'schedule' | 'health'
//   setView      fn      — called with the new view string on item click
//   analysis     object  — the API response (or null). Used for badge values.
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

export default function NavPanel({ activeView, setView, analysis }) {
  // hover = mouse is over the nav (controls expand when not pinned)
  const [hover,  setHover]  = useState(false)
  const [pinned, setPinned] = useState(false)

  // Nav is expanded when pinned OR when mouse is over it
  const expanded = pinned || hover

  // Navigation items — three items only after Hub restructure
  // badge: null = no badge shown; a value = shown in the badge chip
  const navItems = [
    { id: 'hub',      icon: '◉',  label: 'Hub',         badge: null },
    { id: 'schedule', icon: '▦',   label: 'Schedule',    badge: null },
    { id: 'health',   icon: '◈',   label: 'Health Check',badge: null },
  ]

  return (
    // Outer nav container — width animates via CSS transition
    <nav
      style={{
        width:          expanded ? 200 : 48,
        flexShrink:     0,
        background:     'var(--sk-nav)',        // #16213e dark navy
        display:        'flex',
        flexDirection:  'column',
        overflow:       'hidden',
        transition:     'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        borderRight:    '1px solid #1e2d4a',
        position:       'relative',
        zIndex:         100,
      }}
      onMouseEnter={() => !pinned && setHover(true)}
      onMouseLeave={() => !pinned && setHover(false)}
    >

      {/* ── Header-height strip ────────────────────────────────────────────
          Visually aligns with the app header bar (65px) + gradient strip (3px).
          Same charcoal background so the top-left corner reads as a unified
          dark band across the full top of the screen.
          ─────────────────────────────────────────────────────────────────── */}
      <div style={{
        height:         68,  // 65px header + 3px gradient strip
        flexShrink:     0,
        background:     'var(--sk-header)',      // charcoal — matches app header
        borderBottom:   '1px solid #1e2d4a',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        overflow:       'hidden',
      }}>
        {/* Logo mark placeholder spacer — 26×26 matches original */}
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
                // Left accent bar for active item — inset box-shadow on left edge
                boxShadow:      isActive
                  ? 'inset 3px 0 0 0 #1EC8D4'
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
                  fontFamily:   'var(--font-mono)',
                  fontSize:     9,
                  fontWeight:   700,
                  background:   'rgba(74, 111, 232, 0.3)',
                  color:        '#7C9EFF',
                  borderRadius: 3,
                  padding:      '1px 5px',
                  flexShrink:   0,
                }}>
                  {item.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Pin / unpin toggle ─────────────────────────────────────────────
          Arrow direction:
            ▶ = collapsed / unpinned → click to pin
            ◀ = pinned (expanded)    → click to unpin
          ─────────────────────────────────────────────────────────────────── */}
      <div
        onClick={() => setPinned(v => !v)}
        title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
        style={{
          height:         36,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          borderTop:      '1px solid #1e2d4a',
          flexShrink:     0,
          cursor:         'pointer',
          color:          pinned ? '#4A6FE8' : '#334155',
          transition:     'color 0.12s',
          fontSize:       14,
          userSelect:     'none',
        }}
      >
        {expanded && pinned ? '◀' : '▶'}
      </div>
    </nav>
  )
}
