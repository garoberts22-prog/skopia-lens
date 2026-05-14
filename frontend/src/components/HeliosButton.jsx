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

          {/* Helios Orb */}
          <svg
            className="helios-sphere"
            width="76"
            height="76"
            viewBox="0 0 76 76"
            style={{
              animation: 'helios-bob 3s ease-in-out infinite',
              transition: 'all 0.22s ease',
              opacity: hasData ? 1 : 0.55,
              filter: active
                ? 'drop-shadow(0 0 18px rgba(75,120,255,0.55)) drop-shadow(0 12px 28px rgba(0,0,0,0.42))'
                : 'drop-shadow(0 12px 22px rgba(0,0,0,0.34))',
            }}
          >
            <defs>
              {/* Main Orb Gradient */}
              <radialGradient id="helios-core" cx="35%" cy="18%" r="72%">
                <stop offset="0%" stopColor="#DDFBFF" />
                <stop offset="22%" stopColor="#6BE8FF" />
                <stop offset="58%" stopColor="#2875FF" />
                <stop offset="100%" stopColor="#4129E8" />
              </radialGradient>

              {/* Cyan Wave */}
              <linearGradient id="wave-cyan" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#A8FFFF" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#17B6FF" stopOpacity="0.72" />
              </linearGradient>

              {/* Purple Wave */}
              <linearGradient id="wave-purple" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#C9C4FF" stopOpacity="0.82" />
                <stop offset="100%" stopColor="#9652FF" stopOpacity="0.72" />
              </linearGradient>

              {/* Glass Shine */}
              <radialGradient id="shine-top" cx="30%" cy="16%" r="50%">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.92" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </radialGradient>

              <clipPath id="heliosClip">
                <circle cx="38" cy="38" r="35" />
              </clipPath>
            </defs>

            {/* Base Orb */}
            <circle cx="38" cy="38" r="35" fill="url(#helios-core)" />

            {/* Layered Bands */}
            <g clipPath="url(#heliosClip)">
              {/* Top Cyan */}
              <path
                d="M-8 18 C16 8, 38 8, 86 22 L86 34 C54 28, 24 28, -8 32 Z"
                fill="url(#wave-cyan)"
                opacity="0.9"
              />

              {/* Purple Middle */}
              <path
                d="M-8 31 C18 24, 42 24, 86 32 L86 52 C56 46, 24 46, -8 50 Z"
                fill="url(#wave-purple)"
                opacity="0.92"
              />

              {/* Bottom Cyan */}
              <path
                d="M-8 52 C18 42, 42 44, 86 58 L86 86 L-8 86 Z"
                fill="url(#wave-cyan)"
                opacity="0.72"
              />

              {/* Large Gloss Reflection */}
              <ellipse
                cx="58"
                cy="24"
                rx="12"
                ry="22"
                fill="#FFFFFF"
                opacity="0.14"
              />

              {/* Secondary Reflection */}
              <ellipse
                cx="20"
                cy="58"
                rx="18"
                ry="8"
                fill="#8FFFFF"
                opacity="0.08"
              />
            </g>

            {/* Top Shine */}
            <circle cx="38" cy="38" r="35" fill="url(#shine-top)" />

            {/* Left Eye */}
            <g>
              {/* White Eye Base */}
              <ellipse cx="26" cy="34" rx="9" ry="10.5" fill="#FFFFFF" />

              {/* Iris */}
              <ellipse cx="27" cy="35" rx="6.2" ry="7.4" fill="#1841FF" />

              {/* Cyan Inner */}
              <ellipse cx="28" cy="38" rx="3.8" ry="4.6" fill="#32F2FF" />

              {/* Highlights */}
              <ellipse
                cx="24"
                cy="31"
                rx="3.2"
                ry="4.1"
                fill="#FFFFFF"
              />

              <circle
                cx="30"
                cy="39"
                r="1.5"
                fill="#FFFFFF"
                opacity="0.95"
              />
            </g>

            {/* Right Eye */}
            <g>
              {/* White Eye Base */}
              <ellipse cx="50" cy="34" rx="9" ry="10.5" fill="#FFFFFF" />

              {/* Iris */}
              <ellipse cx="51" cy="35" rx="6.2" ry="7.4" fill="#1841FF" />

              {/* Cyan Inner */}
              <ellipse cx="52" cy="38" rx="3.8" ry="4.6" fill="#32F2FF" />

              {/* Highlights */}
              <ellipse
                cx="48"
                cy="31"
                rx="3.2"
                ry="4.1"
                fill="#FFFFFF"
              />

              <circle
                cx="54"
                cy="39"
                r="1.5"
                fill="#FFFFFF"
                opacity="0.95"
              />
            </g>

            {/* Pink Cheeks */}
            <ellipse
              cx="17"
              cy="44"
              rx="4"
              ry="2.4"
              fill="#FFD7FF"
              opacity="0.72"
            />

            <ellipse
              cx="59"
              cy="44"
              rx="4"
              ry="2.4"
              fill="#FFD7FF"
              opacity="0.72"
            />

            {/* Smile Cut-Out Shadow */}
            <path
              d="M25 46 Q38 60 51 47"
              fill="none"
              stroke="rgba(0,0,0,0.22)"
              strokeWidth="4"
              strokeLinecap="round"
            />

            {/* Main White Smile */}
            <path
              d="M25 46 Q38 58 51 46"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2"
              strokeLinecap="round"
            />

            {/* Smile Highlight */}
            <path
              d="M26 45 Q38 56 50 45"
              fill="none"
              stroke="rgba(255,255,255,0.6)"
              strokeWidth="1"
              strokeLinecap="round"
            />

            {/* Outer Glass Ring */}
            <circle
              cx="38"
              cy="38"
              r="35"
              fill="none"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="1.2"
            />
          </svg>
        </div>
      </div>
    </>
  )
}