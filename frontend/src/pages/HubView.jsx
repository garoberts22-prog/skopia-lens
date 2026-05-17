// ── HubView.jsx ───────────────────────────────────────────────────────────────
//
// The new landing page / central workspace for SKOPIA Lens.
// Replaces the standalone Upload and Convert nav items with a single "Hub"
// experience — a horizontal carousel of four modules.
//
// MODULES (in carousel order):
//   1. Upload          — opens UploadView in a modal
//   2. Convert         — opens ConvertView in a modal
//   3. Build Wizard    — "Coming Soon" modal placeholder
//   4. Project Console — "Coming Soon" modal placeholder
//
// INTERACTION:
//   - Arrow keys (←/→) and on-screen buttons cycle between modules
//   - Clicking the active module card opens its modal
//   - ESC or clicking the darkened backdrop closes any open modal
//   - Smooth CSS transitions throughout
//
// ARCHITECTURE:
//   - UploadView and ConvertView are imported and rendered AS-IS inside modal
//     wrappers — no logic is altered
//   - onNavigate prop passed to UploadView so successful upload can still
//     switch the main view to 'schedule' or 'health'
//
// PROPS:
//   onNavigate   fn   — passed from App.jsx; calls setView() in the main shell
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import UploadView  from './UploadView'
import ConvertView from './ConvertView'

// ── Brand tokens (mirrors SK object used in ScheduleView / HealthCheckView) ──
const SK = {
  grad:    'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
  cyan:    '#1EC8D4',
  peri:    '#4A6FE8',
  blue:    '#2A4DCC',
  header:  '#1E1E1E',
  bg:      '#F7F8FC',
  card:    '#FFFFFF',
  border:  '#E2E6F0',
  text:    '#1A1A2E',
  muted:   '#6B7280',
  nav:     '#16213E',
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG graphic components — 3D-style icons rendered inline as SVG.
// Each returns a self-contained SVG visual for its module card.
// ─────────────────────────────────────────────────────────────────────────────

// Upload icon: a floating portal / upload vortex
function UploadGraphic({ glowing }) {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ filter: glowing ? 'drop-shadow(0 0 18px rgba(30,200,212,0.55))' : 'drop-shadow(0 4px 12px rgba(30,200,212,0.25))', transition: 'filter 0.3s' }}>
      <defs>
        <linearGradient id="ug-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1EC8D4" />
          <stop offset="50%" stopColor="#4A6FE8" />
          <stop offset="100%" stopColor="#2A4DCC" />
        </linearGradient>
        <linearGradient id="ug-glow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1EC8D4" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2A4DCC" stopOpacity="0.05" />
        </linearGradient>
        <radialGradient id="ug-radial" cx="50%" cy="55%" r="45%">
          <stop offset="0%" stopColor="#1EC8D4" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#2A4DCC" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Outer glow ring */}
      <ellipse cx="60" cy="68" rx="44" ry="18" fill="url(#ug-radial)" />

      {/* Portal rings — concentric ovals suggesting depth */}
      <ellipse cx="60" cy="72" rx="44" ry="16" stroke="url(#ug-grad)" strokeWidth="1.5" strokeOpacity="0.25" fill="none" />
      <ellipse cx="60" cy="72" rx="34" ry="12" stroke="url(#ug-grad)" strokeWidth="1.5" strokeOpacity="0.4" fill="none" />
      <ellipse cx="60" cy="72" rx="22" ry="8"  stroke="url(#ug-grad)" strokeWidth="1.5" strokeOpacity="0.6" fill="none" />
      <ellipse cx="60" cy="72" rx="10" ry="4"  fill="url(#ug-grad)" fillOpacity="0.4" />

      {/* Document shape — floating above the portal */}
      <rect x="38" y="24" width="36" height="46" rx="5" fill="#16213E" stroke="url(#ug-grad)" strokeWidth="1.5" />
      {/* Document fold corner */}
      <path d="M66 24 L74 32 L66 32 Z" fill="url(#ug-grad)" fillOpacity="0.6" />
      <line x1="66" y1="24" x2="66" y2="32" stroke="url(#ug-grad)" strokeWidth="1.5" />
      <line x1="66" y1="32" x2="74" y2="32" stroke="url(#ug-grad)" strokeWidth="1.5" />
      {/* Document lines */}
      <line x1="46" y1="40" x2="66" y2="40" stroke="#1EC8D4" strokeWidth="1.2" strokeOpacity="0.6" />
      <line x1="46" y1="47" x2="68" y2="47" stroke="#4A6FE8" strokeWidth="1.2" strokeOpacity="0.5" />
      <line x1="46" y1="54" x2="62" y2="54" stroke="#4A6FE8" strokeWidth="1.2" strokeOpacity="0.4" />

      {/* Upload arrow — rising from document into portal zone */}
      <path d="M60 20 L60 10" stroke="url(#ug-grad)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M54 16 L60 10 L66 16" stroke="url(#ug-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* Sparkle dots */}
      <circle cx="30" cy="35" r="2" fill="#1EC8D4" fillOpacity="0.5" />
      <circle cx="92" cy="48" r="1.5" fill="#4A6FE8" fillOpacity="0.6" />
      <circle cx="25" cy="60" r="1.2" fill="#2A4DCC" fillOpacity="0.4" />
      <circle cx="96" cy="30" r="1"   fill="#1EC8D4" fillOpacity="0.5" />
    </svg>
  )
}

// Convert icon: a holographic transformation cube
function ConvertGraphic({ glowing }) {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ filter: glowing ? 'drop-shadow(0 0 18px rgba(74,111,232,0.55))' : 'drop-shadow(0 4px 12px rgba(74,111,232,0.25))', transition: 'filter 0.3s' }}>
      <defs>
        <linearGradient id="cg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1EC8D4" />
          <stop offset="60%" stopColor="#4A6FE8" />
          <stop offset="100%" stopColor="#2A4DCC" />
        </linearGradient>
        <linearGradient id="cg-face-top" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4A6FE8" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#2A4DCC" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="cg-face-left" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1EC8D4" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#4A6FE8" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="cg-face-right" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#2A4DCC" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#4A6FE8" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      {/* Left cube — XER/P6 */}
      {/* Top face */}
      <path d="M20 48 L38 38 L56 48 L38 58 Z" fill="url(#cg-face-top)" stroke="url(#cg-grad)" strokeWidth="1.2" />
      {/* Left face */}
      <path d="M20 48 L20 70 L38 80 L38 58 Z" fill="url(#cg-face-left)" stroke="url(#cg-grad)" strokeWidth="1.2" />
      {/* Right face */}
      <path d="M56 48 L56 70 L38 80 L38 58 Z" fill="url(#cg-face-right)" stroke="url(#cg-grad)" strokeWidth="1.2" />
      {/* Label on top face */}
      <text x="38" y="50" textAnchor="middle" fill="#1EC8D4" fontSize="7" fontFamily="JetBrains Mono, monospace" fontWeight="700" opacity="0.9">XER</text>

      {/* Right cube — MSP XML */}
      <path d="M64 48 L82 38 L100 48 L82 58 Z" fill="url(#cg-face-top)" stroke="url(#cg-grad)" strokeWidth="1.2" />
      <path d="M64 48 L64 70 L82 80 L82 58 Z" fill="url(#cg-face-left)" stroke="url(#cg-grad)" strokeWidth="1.2" />
      <path d="M100 48 L100 70 L82 80 L82 58 Z" fill="url(#cg-face-right)" stroke="url(#cg-grad)" strokeWidth="1.2" />
      <text x="82" y="50" textAnchor="middle" fill="#4A6FE8" fontSize="7" fontFamily="JetBrains Mono, monospace" fontWeight="700" opacity="0.9">XML</text>

      {/* Transfer arrows between cubes */}
      <path d="M57 54 L63 54" stroke="url(#cg-grad)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M61 50 L65 54 L61 58" stroke="url(#cg-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M63 54 L57 54" stroke="#1EC8D4" strokeWidth="1" strokeOpacity="0.4" strokeLinecap="round" strokeDasharray="2 2" />

      {/* Horizontal scan line — holographic effect */}
      <line x1="18" y1="63" x2="102" y2="63" stroke="url(#cg-grad)" strokeWidth="0.8" strokeOpacity="0.3" strokeDasharray="3 2" />
      <line x1="18" y1="68" x2="102" y2="68" stroke="url(#cg-grad)" strokeWidth="0.5" strokeOpacity="0.15" strokeDasharray="4 3" />

      {/* Corner sparkles */}
      <circle cx="18" cy="38" r="1.5" fill="#1EC8D4" fillOpacity="0.6" />
      <circle cx="102" cy="38" r="1.5" fill="#4A6FE8" fillOpacity="0.6" />
      <circle cx="60" cy="22" r="2" fill="#2A4DCC" fillOpacity="0.5" />
      <circle cx="60" cy="28" r="1" fill="#1EC8D4" fillOpacity="0.4" />
    </svg>
  )
}

// Build Wizard icon: blueprint/construction grid with gear
function BuildGraphic() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ filter: 'drop-shadow(0 4px 12px rgba(42,77,204,0.2))', opacity: 0.5 }}>
      <defs>
        <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4A6FE8" />
          <stop offset="100%" stopColor="#2A4DCC" />
        </linearGradient>
      </defs>
      {/* Blueprint grid */}
      {[30,45,60,75,90].map(x => (
        <line key={`v${x}`} x1={x} y1="25" x2={x} y2="95" stroke="#4A6FE8" strokeWidth="0.5" strokeOpacity="0.3" />
      ))}
      {[35,50,65,80].map(y => (
        <line key={`h${y}`} x1="22" y1={y} x2="98" y2={y} stroke="#4A6FE8" strokeWidth="0.5" strokeOpacity="0.3" />
      ))}
      {/* Gear shape — simplified */}
      <circle cx="60" cy="60" r="18" stroke="url(#bg-grad)" strokeWidth="2" fill="none" strokeOpacity="0.7" />
      <circle cx="60" cy="60" r="8"  fill="#16213E" stroke="url(#bg-grad)" strokeWidth="1.5" />
      {/* Gear teeth */}
      {[0,45,90,135,180,225,270,315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const x1 = 60 + Math.cos(rad) * 18
        const y1 = 60 + Math.sin(rad) * 18
        const x2 = 60 + Math.cos(rad) * 24
        const y2 = 60 + Math.sin(rad) * 24
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#4A6FE8" strokeWidth="3.5" strokeLinecap="round" strokeOpacity="0.7" />
      })}
      {/* Lock icon overlay */}
      <rect x="50" y="58" width="20" height="14" rx="3" fill="#16213E" stroke="#6B7280" strokeWidth="1.5" />
      <path d="M54 58 L54 54 Q60 49 66 54 L66 58" stroke="#6B7280" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="60" cy="65" r="2" fill="#6B7280" />
      <text x="60" y="95" textAnchor="middle" fill="#6B7280" fontSize="8" fontFamily="Montserrat, Arial, sans-serif" fontWeight="700" letterSpacing="1">COMING SOON</text>
    </svg>
  )
}

// Project Console icon: radar/dashboard display
function ConsoleGraphic() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ filter: 'drop-shadow(0 4px 12px rgba(42,77,204,0.2))', opacity: 0.5 }}>
      <defs>
        <linearGradient id="cng-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1EC8D4" />
          <stop offset="100%" stopColor="#2A4DCC" />
        </linearGradient>
      </defs>
      {/* Radar circles */}
      {[10,20,30,40].map((r, i) => (
        <circle key={i} cx="60" cy="58" r={r} stroke="#4A6FE8" strokeWidth="0.8" strokeOpacity={0.15 + i * 0.08} fill="none" />
      ))}
      {/* Radar sweep line */}
      <line x1="60" y1="58" x2="90" y2="38" stroke="#1EC8D4" strokeWidth="1.5" strokeOpacity="0.5" />
      {/* Cross hairs */}
      <line x1="20" y1="58" x2="100" y2="58" stroke="#4A6FE8" strokeWidth="0.7" strokeOpacity="0.3" />
      <line x1="60" y1="18" x2="60" y2="98" stroke="#4A6FE8" strokeWidth="0.7" strokeOpacity="0.3" />
      {/* Data blips */}
      <circle cx="78" cy="42" r="2.5" fill="#1EC8D4" fillOpacity="0.8" />
      <circle cx="48" cy="48" r="2" fill="#4A6FE8" fillOpacity="0.7" />
      <circle cx="70" cy="70" r="1.5" fill="#2A4DCC" fillOpacity="0.6" />
      {/* Center dot */}
      <circle cx="60" cy="58" r="4" fill="url(#cng-grad)" fillOpacity="0.7" />
      <circle cx="60" cy="58" r="1.5" fill="#1EC8D4" />
      {/* Lock overlay */}
      <rect x="50" y="88" width="20" height="12" rx="2.5" fill="#16213E" stroke="#6B7280" strokeWidth="1.2" />
      <path d="M54 88 L54 85 Q60 80 66 85 L66 88" stroke="#6B7280" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <circle cx="60" cy="94" r="1.8" fill="#6B7280" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Module definitions — drives the carousel
// ─────────────────────────────────────────────────────────────────────────────
const MODULES = [
  {
    id:          'upload',
    title:       'Upload & Analyse',
    subtitle:    'P6 XER · MS Project MPP · MSP XML',
    description: 'Upload your schedule file and get an instant DCMA 14-point health report. No install. No account needed. Results in under 60 seconds.',
    cta:         'Open Upload',
    graphic:     UploadGraphic,
    accentFrom:  '#1EC8D4',
    accentTo:    '#4A6FE8',
  },
  {
    id:          'convert',
    title:       'Format Converter',
    subtitle:    'XER → MSP XML · MSP XML → XER',
    description: 'Convert between Primavera P6 XER and MS Project XML formats. Client-side conversion — your file never leaves the browser.',
    cta:         'Open Converter',
    graphic:     ConvertGraphic,
    accentFrom:  '#4A6FE8',
    accentTo:    '#2A4DCC',
  },
  {
    id:          'build',
    title:       'Build Wizard',
    subtitle:    'Coming in SKOPIA Build',
    description: 'Generate compliant schedule templates and cost-load your WBS. Built for contractors.',
    cta:         'Coming Soon',
    graphic:     BuildGraphic,
    accentFrom:  '#6B7280',
    accentTo:    '#334155',
    locked:      true,
  },
  {
    id:          'console',
    title:       'Project Console',
    subtitle:    'Coming in SKOPIA Build',
    description: 'Store and manage your portfolio of projects.',
    cta:         'Coming Soon',
    graphic:     ConsoleGraphic,
    accentFrom:  '#6B7280',
    accentTo:    '#334155',
    locked:      true,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Modal wrapper — renders children inside a centered modal panel with:
//   - darkened, blurred backdrop
//   - smooth open/close animation (CSS opacity + scale)
//   - ESC key + backdrop click close
// ─────────────────────────────────────────────────────────────────────────────
function HubModal({ open, onClose, title, children, wide }) {
  // Handle ESC key
  useEffect(() => {
    if (!open) return
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return (
    // Backdrop — click to close
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'hubFadeIn 0.18s ease',
      }}
    >
      {/* Modal panel — stop propagation so clicking inside doesn't close */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:   SK.header,
          border:       '1px solid rgba(74,111,232,0.3)',
          borderRadius: 16,
          boxShadow:    '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(30,200,212,0.08)',
          width:        wide ? '90vw' : '82vw',
          maxWidth:     wide ? 1300 : 980,
          maxHeight:    '88vh',
          display:      'flex',
          flexDirection:'column',
          overflow:     'hidden',
          animation:    'hubSlideUp 0.22s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Modal header bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px 0', flexShrink: 0,
        }}>
          <span style={{
            fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 13,
            color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {title}
          </span>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, width: 28, height: 28, cursor: 'pointer', color: '#94a3b8',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
          >
            ✕
          </button>
        </div>

        {/* Gradient accent strip below modal header */}
        <div style={{ background: 'var(--grad)', height: 2, margin: '12px 0 0', flexShrink: 0 }} />

        {/* Modal content — scrollable */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Coming Soon modal content — lightweight placeholder for locked modules
// ─────────────────────────────────────────────────────────────────────────────
function ComingSoonContent({ module }) {
  const Graphic = module.graphic
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '48px 40px', gap: 24, textAlign: 'center',
    }}>
      <Graphic glowing={false} />

      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.15em', textTransform: 'uppercase',
        background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
      }}>
        {module.subtitle}
      </div>

      <div style={{
        fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 900,
        color: '#e2e8f0', letterSpacing: '-0.3px',
      }}>
        {module.title}
      </div>

      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 14, color: '#64748b',
        maxWidth: 480, lineHeight: 1.7,
      }}>
        {module.description}
      </div>

      {/* Tier badge */}
      <div style={{
        background: 'rgba(74,111,232,0.12)', border: '1px solid rgba(74,111,232,0.25)',
        borderRadius: 8, padding: '12px 24px', marginTop: 8,
      }}>
        <div style={{ fontFamily: 'var(--font-head)', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Planned for
        </div>
        <div style={{
          fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
          background: 'var(--grad)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          {module.subtitle.replace('Coming in ', '')}
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: '#475569' }}>
        In the meantime, try the free Upload &amp; Analyse or Format Converter tools.
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Module card — the individual tile in the carousel
// ─────────────────────────────────────────────────────────────────────────────
function ModuleCard({ module, isActive, onClick }) {
  const [hovered, setHovered] = useState(false)
  const Graphic = module.graphic
  const isLocked = !!module.locked

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // Card sizing — fixed so carousel doesn't reflow
        width:       isActive ? 340 : 240,
        flexShrink:  0,
        background:  isActive
          ? 'linear-gradient(160deg, rgba(22,33,62,0.95), rgba(26,26,46,0.98))'
          : 'rgba(22,33,62,0.5)',
        border:      isActive
          ? `1px solid rgba(74,111,232,0.45)`
          : '1px solid rgba(30,45,74,0.7)',
        borderRadius: 20,
        padding:     isActive ? '36px 32px' : '28px 24px',
        display:     'flex',
        flexDirection: 'column',
        alignItems:  isActive ? 'flex-start' : 'center',
        gap:         16,
        cursor:      isLocked ? 'default' : 'pointer',
        transition:  'all 0.3s cubic-bezier(0.4,0,0.2,1)',
        position:    'relative',
        overflow:    'hidden',
        opacity:     isActive ? 1 : (isLocked ? 0.55 : 0.75),
        boxShadow:   isActive
          ? '0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(30,200,212,0.12), inset 0 1px 0 rgba(255,255,255,0.04)'
          : 'none',
      }}
    >
      {/* Top accent gradient line */}
      {isActive && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${module.accentFrom}, ${module.accentTo})`,
          borderRadius: '20px 20px 0 0',
        }} />
      )}

      {/* Corner glow — active only */}
      {isActive && (
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 120, height: 120,
          background: `radial-gradient(circle, ${module.accentFrom}22 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Graphic */}
      <div style={{ display: 'flex', justifyContent: isActive ? 'flex-start' : 'center', width: '100%' }}>
        <Graphic glowing={isActive && hovered} />
      </div>

      {/* Module info */}
      <div style={{ width: '100%' }}>
        {/* Subtitle / tag */}
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: isActive ? module.accentFrom : '#475569',
          marginBottom: 8,
        }}>
          {module.subtitle}
        </div>

        {/* Title */}
        <div style={{
          fontFamily: 'var(--font-head)', fontWeight: 900,
          fontSize: isActive ? 22 : 16,
          color: isActive ? '#f1f5f9' : '#94a3b8',
          letterSpacing: '-0.2px',
          lineHeight: 1.2,
          marginBottom: isActive ? 12 : 0,
          transition: 'font-size 0.3s',
        }}>
          {module.title}
        </div>

        {/* Description — only shown when active */}
        {isActive && (
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 13, color: '#64748b',
            lineHeight: 1.65, marginBottom: 20,
          }}>
            {module.description}
          </div>
        )}

        {/* CTA button — only shown when active */}
        {isActive && (
          <button
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px',
              background: isLocked
                ? 'rgba(107,114,128,0.15)'
                : `linear-gradient(135deg, ${module.accentFrom}, ${module.accentTo})`,
              border: isLocked ? '1px solid rgba(107,114,128,0.3)' : 'none',
              borderRadius: 8, cursor: isLocked ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-head)', fontSize: 12, fontWeight: 700,
              color: isLocked ? '#6B7280' : '#fff',
              letterSpacing: '0.04em',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => !isLocked && (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => !isLocked && (e.currentTarget.style.opacity = '1')}
          >
            {!isLocked && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            )}
            {isLocked && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            )}
            {module.cta}
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HubView — main export
// ─────────────────────────────────────────────────────────────────────────────
export default function HubView({ onNavigate }) {
  // activeIndex: which module is centred in the carousel
  const [activeIndex, setActiveIndex] = useState(0)
  // openModal: id of the module whose modal is currently open, or null
  const [openModal, setOpenModal] = useState(null)

  // Keyboard navigation: ← / → arrows cycle the carousel
  useEffect(() => {
    function handleKey(e) {
      // Don't capture arrow keys when a modal is open (the modal handles its own ESC)
      if (openModal) return
      if (e.key === 'ArrowRight') setActiveIndex(i => (i + 1) % MODULES.length)
      if (e.key === 'ArrowLeft')  setActiveIndex(i => (i - 1 + MODULES.length) % MODULES.length)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [openModal])

  const activeModule = MODULES[activeIndex]

  function handleCardClick(module, index) {
    if (index !== activeIndex) {
      // First click on a non-active card: focus it
      setActiveIndex(index)
      return
    }
    // Click on already-active card: open its modal
    setOpenModal(module.id)
  }

  function closeModal() { setOpenModal(null) }

  // When upload succeeds and UploadView triggers onNavigate, close modal first
  function handleUploadNavigate(view) {
    setOpenModal(null)
    onNavigate(view)
  }

  return (
    <div style={{
      flex: 1,
      background: SK.header,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>

      {/* ── Keyframe animations injected once ─────────────────────────────── */}
      <style>{`
        @keyframes hubFadeIn   { from { opacity: 0 } to { opacity: 1 } }
        @keyframes hubSlideUp  { from { opacity: 0; transform: translateY(24px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes hubPulse    { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }
        @keyframes dotFloat    { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
      `}</style>

      {/* ── Background: subtle grid + radial glow ─────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `
          linear-gradient(rgba(74,111,232,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(74,111,232,0.04) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
        zIndex: 0,
      }} />
      <div style={{
        position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 300,
        background: `radial-gradient(ellipse at center, rgba(30,200,212,0.06) 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        flex: 1, overflow: 'hidden',
        padding: '32px 40px 0',
      }}>

        {/* ── Hub header ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 32, flexShrink: 0 }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.2em', textTransform: 'uppercase',
            color: '#475569', marginBottom: 6,
          }}>
            SKOPIA · Command Hub
          </div>
          <div style={{
            fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 900,
            color: '#f1f5f9', letterSpacing: '-0.5px', lineHeight: 1.1,
          }}>
            What would you like to do?
          </div>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 13, color: '#475569',
            marginTop: 6,
          }}>
            Select a module below or use ← → to navigate
          </div>
        </div>

        {/* ── Carousel ───────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          flex: 1, overflow: 'hidden',
        }}>

          {/* Left arrow */}
          <button
            onClick={() => setActiveIndex(i => (i - 1 + MODULES.length) % MODULES.length)}
            title="Previous (←)"
            style={{
              flexShrink: 0, width: 40, height: 40,
              background: 'rgba(74,111,232,0.1)', border: '1px solid rgba(74,111,232,0.2)',
              borderRadius: '50%', cursor: 'pointer', color: '#4A6FE8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(74,111,232,0.22)'; e.currentTarget.style.borderColor = 'rgba(74,111,232,0.5)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(74,111,232,0.1)'; e.currentTarget.style.borderColor = 'rgba(74,111,232,0.2)' }}
          >
            ‹
          </button>

          {/* Cards row — overflow hidden so non-active cards clip neatly */}
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            overflow: 'hidden',
            height: '100%',
            justifyContent: 'center',
          }}>
            {MODULES.map((module, index) => (
              <ModuleCard
                key={module.id}
                module={module}
                isActive={index === activeIndex}
                onClick={() => handleCardClick(module, index)}
              />
            ))}
          </div>

          {/* Right arrow */}
          <button
            onClick={() => setActiveIndex(i => (i + 1) % MODULES.length)}
            title="Next (→)"
            style={{
              flexShrink: 0, width: 40, height: 40,
              background: 'rgba(74,111,232,0.1)', border: '1px solid rgba(74,111,232,0.2)',
              borderRadius: '50%', cursor: 'pointer', color: '#4A6FE8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(74,111,232,0.22)'; e.currentTarget.style.borderColor = 'rgba(74,111,232,0.5)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(74,111,232,0.1)'; e.currentTarget.style.borderColor = 'rgba(74,111,232,0.2)' }}
          >
            ›
          </button>
        </div>

        {/* ── Dot indicators ─────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 8,
          padding: '20px 0 28px', flexShrink: 0,
        }}>
          {MODULES.map((module, index) => (
            <button
              key={module.id}
              onClick={() => setActiveIndex(index)}
              title={module.title}
              style={{
                width:       index === activeIndex ? 24 : 8,
                height:      8,
                borderRadius: 4,
                background:  index === activeIndex
                  ? `linear-gradient(90deg, ${module.accentFrom}, ${module.accentTo})`
                  : 'rgba(74,111,232,0.25)',
                border:      'none', cursor: 'pointer',
                transition:  'all 0.25s cubic-bezier(0.4,0,0.2,1)',
                padding:     0,
              }}
            />
          ))}
        </div>

      </div>

      {/* ── Upload modal ─────────────────────────────────────────────────── */}
      <HubModal
        open={openModal === 'upload'}
        onClose={closeModal}
        title="Upload & Analyse Schedule"
        wide={false}
      >
        {/* Render UploadView as-is. Pass handleUploadNavigate so it can switch
            the main app view to 'schedule' or 'health' on successful upload. */}
        <UploadView onNavigate={handleUploadNavigate} />
      </HubModal>

      {/* ── Convert modal ─────────────────────────────────────────────────── */}
      <HubModal
        open={openModal === 'convert'}
        onClose={closeModal}
        title="Format Converter"
        wide={false}
      >
        {/* ConvertView is fully self-contained — no props needed */}
        <ConvertView />
      </HubModal>

      {/* ── Coming Soon modals (Build + Console) ─────────────────────────── */}
      {MODULES.filter(m => m.locked).map(module => (
        <HubModal
          key={module.id}
          open={openModal === module.id}
          onClose={closeModal}
          title={module.title}
          wide={false}
        >
          <ComingSoonContent module={module} />
        </HubModal>
      ))}

    </div>
  )
}
