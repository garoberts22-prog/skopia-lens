/** @type {import('tailwindcss').Config} */

// SKOPIA Brand Manual v1.0 — April 2026
// These tokens are consumed via className="bg-sk-card text-sk-text" etc.
// DO NOT change colour values without updating the brand manual.

export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        sk: {
          // Brand gradient stops — always apply as linear-gradient(135deg,...)
          // Use inline style var(--grad) for gradients; these are for flat usage.
          cyan:   '#1EC8D4',  // Gradient start / Lens tier
          peri:   '#4A6FE8',  // Gradient mid  / active states
          blue:   '#2A4DCC',  // Gradient end  / flat brand blue

          // Dark surfaces
          header: '#1E1E1E',  // Charcoal — top app bar
          nav:    '#16213e',  // Dark navy — left nav panel

          // Light UI surfaces
          bg:     '#F7F8FC',  // Page / content background
          card:   '#FFFFFF',  // Card / panel backgrounds
          border: '#E2E6F0',  // Borders and dividers
          grid:   '#E2E6F0',  // Chart gridlines

          // Typography
          text:   '#1A1A2E',  // Primary text
          muted:  '#6B7280',  // Labels, secondary text

          // Status — functional only, never decorative
          pass:   '#16A34A',  // Pass / Grade A–B
          warn:   '#D97706',  // Warn / Grade C
          fail:   '#DC2626',  // Fail / Grade D–F
          info:   '#2563EB',  // Neutral info / blue
        },
      },
      fontFamily: {
        // Reference via className="font-head" etc.
        head: ['Montserrat', 'Arial', 'sans-serif'],
        body: ['Open Sans', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
