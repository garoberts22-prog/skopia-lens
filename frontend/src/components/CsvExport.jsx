// ── CsvExport.jsx ─────────────────────────────────────────────────────────────
//
// Reusable CSV download utility.
// Renders a small download button. On click, converts data array to CSV
// and triggers a browser file download — no server needed.
//
// USAGE:
//   <CsvExport data={flaggedItems} filename="logic_completeness_flagged.csv" />
//
// Props:
//   data      Array of objects — keys become headers, values become row cells
//   filename  string — downloaded file name (should end in .csv)
//   label     string — optional button label (default: "Export CSV")
//   disabled  boolean — optional
//
// ─────────────────────────────────────────────────────────────────────────────

const SK = {
  pass: '#16A34A', text: '#1A1A2E', muted: '#6B7280',
  border: '#E2E6F0', bg: '#F7F8FC', card: '#FFFFFF',
}

export default function CsvExport({ data, filename = 'export.csv', label = 'Export CSV', disabled = false }) {
  if (!data?.length) return null

  function handleExport() {
    // Build header row from the keys of the first object
    const headers = Object.keys(data[0])

    // Escape a cell value for CSV:
    // - Wrap in quotes if it contains comma, newline, or double-quote
    // - Escape any double-quotes by doubling them
    function escapeCell(val) {
      const str = val == null ? '' : String(val)
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const rows = [
      headers.map(escapeCell).join(','),
      ...data.map(row => headers.map(h => escapeCell(row[h])).join(',')),
    ]

    const csv  = rows.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleExport}
      disabled={disabled}
      title={`Download ${filename}`}
      style={{
        fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
        background: disabled ? SK.bg : SK.card,
        color: disabled ? SK.muted : SK.pass,
        border: `1px solid ${disabled ? SK.border : SK.pass}`,
        borderRadius: 5, padding: '5px 12px', cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 5,
        transition: 'all 0.12s',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = SK.pass; e.currentTarget.style.color = '#fff' } }}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.background = SK.card; e.currentTarget.style.color = SK.pass } }}
    >
      ↓ {label}
    </button>
  )
}
