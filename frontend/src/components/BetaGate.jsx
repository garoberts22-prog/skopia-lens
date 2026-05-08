// BetaGate.jsx — wraps the entire app during beta
// Passcode is set via VITE_BETA_CODE env var in Vercel.
// Falls back to "skopia-beta" if env var is not set.

import { useState } from 'react'

const CORRECT_CODE = import.meta.env.VITE_BETA_CODE || 'skopia-beta'
const STORAGE_KEY  = 'skopia_beta_access'

export default function BetaGate({ children }) {
  // Check localStorage so users don't re-enter on refresh
  const [unlocked, setUnlocked] = useState(
    () => localStorage.getItem(STORAGE_KEY) === CORRECT_CODE
  )
  const [input,    setInput]    = useState('')
  const [error,    setError]    = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (input.trim().toLowerCase() === CORRECT_CODE.toLowerCase()) {
      localStorage.setItem(STORAGE_KEY, CORRECT_CODE)
      setUnlocked(true)
    } else {
      setError(true)
      setTimeout(() => setError(false), 2000)
    }
  }

  if (unlocked) return children

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#1E1E1E', gap: 24,
    }}>
      <div style={{
        background: 'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        backgroundClip: 'text', fontFamily: "'Montserrat',Arial,sans-serif",
        fontSize: 32, fontWeight: 900, letterSpacing: '-0.5px',
      }}>SKOPIA</div>

      <div style={{ color: '#94a3b8', fontFamily: "'Open Sans',Arial,sans-serif", fontSize: 13 }}>
        Beta Access — Enter your access code
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 280 }}>
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Beta access code"
          autoFocus
          style={{
            background: '#2d3748', border: `1px solid ${error ? '#DC2626' : '#475569'}`,
            borderRadius: 6, padding: '10px 14px', color: '#e2e8f0',
            fontFamily: "'JetBrains Mono',monospace", fontSize: 14, outline: 'none',
          }}
        />
        <button type="submit" style={{
          background: 'linear-gradient(135deg,#1EC8D4,#4A6FE8,#2A4DCC)',
          border: 'none', borderRadius: 6, padding: '10px 0', color: '#fff',
          fontFamily: "'Montserrat',Arial,sans-serif", fontWeight: 700, fontSize: 13, cursor: 'pointer',
        }}>
          Enter Beta
        </button>
        {error && <div style={{ color: '#f87171', fontSize: 12, textAlign: 'center',
          fontFamily: "'Open Sans',Arial,sans-serif" }}>
          Incorrect code — check with Gav
        </div>}
      </form>

      <div style={{ color: '#334155', fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>
        SKOPIA Lens · Beta · skopia.com.au
      </div>
    </div>
  )
}