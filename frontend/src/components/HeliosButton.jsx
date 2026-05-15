// ── HeliosButton.jsx ──────────────────────────────────────────────────────────
// SKOPIA Helios Floating Assistant Button
// Final refined version matching approved glossy orb reference
// ─────────────────────────────────────────────────────────────────────────────

export default function HeliosButton({
  onClick,
  hasData = false,
  active = false,
  hasNew = false,
}) {
  return (
    <>
      <style>{`
        @keyframes helios-bob {
          0%, 100% {
            transform: translateY(0px) scale(1);
          }
          50% {
            transform: translateY(-4px) scale(1.015);
          }
        }

        @keyframes helios-pulse-ring {
          0% {
            transform: scale(1);
            opacity: 0.65;
          }
          100% {
            transform: scale(1.55);
            opacity: 0;
          }
        }

        @keyframes helios-new-dot {
          0%,100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }

        .helios-fab:hover .helios-sphere {
          transform: scale(1.05);
          filter:
            brightness(1.05)
            saturate(1.08)
            drop-shadow(0 0 18px rgba(0,214,255,0.35))
            drop-shadow(0 12px 28px rgba(0,0,0,0.42));
        }

        .helios-fab:hover .helios-label {
          opacity: 1;
          transform: translateX(0);
        }
      `}</style>

      <div
        className="helios-fab"
        onClick={onClick}
        title={
          hasData
            ? 'Helios — AI Schedule Insights'
            : 'Upload a schedule to unlock Helios insights'
        }
        style={{
          position: 'fixed',
          bottom: 28,
          right: 24,
          zIndex: 800,
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* Hover Label */}
        <div
          className="helios-label"
          style={{
            fontFamily: 'var(--font-head)',
            fontWeight: 700,
            fontSize: 11,
            color: '#ffffff',
            background: 'rgba(15,18,40,0.92)',
            border: '1px solid rgba(83,177,255,0.32)',
            borderRadius: 8,
            padding: '6px 12px',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
            opacity: 0,
            transform: 'translateX(8px)',
            transition: 'all 0.18s ease',
            pointerEvents: 'none',
          }}
        >
          {hasData ? 'Helios · AI Insights' : 'Upload a schedule first'}
        </div>

        {/* Orb Wrapper */}
        <div
          style={{
            position: 'relative',
            width: 76,
            height: 76,
          }}
        >
          {/* Active Pulse */}
          {active && (
            <div
              style={{
                position: 'absolute',
                inset: -8,
                borderRadius: '50%',
                border: '2px solid rgba(69,210,255,0.55)',
                animation: 'helios-pulse-ring 1.5s ease-out infinite',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Notification Dot */}
          {hasNew && !active && (
            <div
              style={{
                position: 'absolute',
                top: 5,
                right: 5,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: '#31E6FF',
                border: '2px solid #101828',
                animation: 'helios-new-dot 1.6s ease-in-out infinite',
                zIndex: 10,
                boxShadow: '0 0 12px rgba(49,230,255,0.65)',
              }}
            />
          )}

          {/* Helios Orb Asset */}
          <img
            className="helios-sphere"
            src={active ? '/assets/helios-static.png' : '/assets/helios-static.png'}
            alt="Helios"
            draggable={false}
            style={{
              width: '76px',
              height: '76px',
              objectFit: 'contain',
              animation: 'helios-bob 3s ease-in-out infinite',
              transition: 'all 0.22s ease',
              opacity: hasData ? 1 : 0.55,
              filter: active
                ? 'drop-shadow(0 0 18px rgba(75,120,255,0.55)) drop-shadow(0 12px 28px rgba(0,0,0,0.42))'
                : 'drop-shadow(0 12px 22px rgba(0,0,0,0.34))',
              pointerEvents: 'none',
            userSelect: 'none',
            }}
          />
        </div>
      </div>
    </>
  )
}