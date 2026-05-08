// ── DetailDrillDown.jsx ───────────────────────────────────────────────────────
//
// Tabbed detail drill-down: one tab per check that has flagged items.
// Each tab shows a filterable, sortable, paginated table of flagged activities.
// CSV export button per tab.
//
// Props:
//   checks   array — all checks (backend + client-side extra)
//
// API flagged_items shape per item:
//   { activity_id, activity_name, wbs_path, issue_type, current_value, severity }
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react'
import CsvExport from './CsvExport'

const SK = {
  pass: '#16A34A', warn: '#D97706', fail: '#DC2626', peri: '#4A6FE8',
  text: '#1A1A2E', muted: '#6B7280', border: '#E2E6F0',
  bg: '#F7F8FC', card: '#FFFFFF', header: '#1E1E1E',
}

const PAGE_SIZE = 50

// Severity label colour
function sevColour(sev) {
  return sev === 'high' ? SK.fail : sev === 'medium' ? SK.warn : SK.muted
}

// ── Single tab's table ────────────────────────────────────────────────────────
function CheckTable({ check }) {
  const items = check.flagged_items ?? []

  const [filter,  setFilter]  = useState('')
  const [sortKey, setSortKey] = useState('severity')
  const [sortAsc, setSortAsc] = useState(false)
  const [page,    setPage]    = useState(0)

  // Sort priority: high > medium > low/info
  const sevOrder = { high: 0, medium: 1, low: 2, info: 3 }

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return items.filter(item =>
      !q ||
      (item.activity_id   ?? '').toLowerCase().includes(q) ||
      (item.activity_name ?? '').toLowerCase().includes(q) ||
      (item.wbs_path      ?? '').toLowerCase().includes(q) ||
      (item.issue_type    ?? '').toLowerCase().includes(q)
    )
  }, [items, filter])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va, vb
      if (sortKey === 'severity') {
        va = sevOrder[a.severity] ?? 9
        vb = sevOrder[b.severity] ?? 9
      } else {
        va = (a[sortKey] ?? '').toString().toLowerCase()
        vb = (b[sortKey] ?? '').toString().toLowerCase()
      }
      if (va < vb) return sortAsc ? -1 : 1
      if (va > vb) return sortAsc ?  1 : -1
      return 0
    })
  }, [filtered, sortKey, sortAsc])

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageSlice  = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function handleSort(key) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key !== 'severity') }
    setPage(0)
  }

  function SortIcon({ k }) {
    if (sortKey !== k) return <span style={{ color: SK.border, marginLeft: 3 }}>↕</span>
    return <span style={{ color: SK.peri, marginLeft: 3 }}>{sortAsc ? '↑' : '↓'}</span>
  }

  // Flatten for CSV export
  const csvData = sorted.map(item => ({
    'Activity ID':   item.activity_id   ?? '',
    'Activity Name': item.activity_name ?? '',
    'WBS':           item.wbs_path      ?? '',
    'Issue Type':    item.issue_type    ?? '',
    'Value':         item.current_value ?? '',
    'Severity':      item.severity      ?? '',
  }))

  if (!items.length) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 14, color: SK.pass, marginBottom: 4 }}>
          No issues found
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: SK.muted }}>
          {check.population_count ?? 0} activities checked — all clear.
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar: filter + export */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${SK.border}` }}>
        <input
          type="text"
          placeholder="Filter by ID, name, WBS, or issue…"
          value={filter}
          onChange={e => { setFilter(e.target.value); setPage(0) }}
          style={{
            flex: 1, fontFamily: 'var(--font-body)', fontSize: 12,
            border: `1px solid ${SK.border}`, borderRadius: 5,
            padding: '5px 10px', outline: 'none', color: SK.text,
            background: SK.bg,
          }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted, whiteSpace: 'nowrap' }}>
          {filtered.length} of {items.length}
        </span>
        <CsvExport
          data={csvData}
          filename={`${check.check_id}_flagged.csv`}
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${SK.border}`, background: SK.bg }}>
              {[
                { key: 'activity_id',   label: 'Activity ID'   },
                { key: 'activity_name', label: 'Name'          },
                { key: 'wbs_path',      label: 'WBS'           },
                { key: 'issue_type',    label: 'Issue'         },
                { key: 'current_value', label: 'Value'         },
                { key: 'severity',      label: 'Severity'      },
              ].map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  style={{
                    padding: '7px 10px', textAlign: 'left', cursor: 'pointer',
                    fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
                    textTransform: 'uppercase', letterSpacing: '0.05em', color: SK.muted,
                    userSelect: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  {label}<SortIcon k={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((item, i) => (
              <tr
                key={`${item.activity_id}-${i}`}
                style={{ borderBottom: `1px solid ${SK.border}`, background: i % 2 === 0 ? 'transparent' : SK.bg }}
              >
                <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.peri, whiteSpace: 'nowrap' }}>
                  {item.activity_id ?? '—'}
                </td>
                <td style={{ padding: '6px 10px', color: SK.text, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={item.activity_name}>
                  {item.activity_name ?? '—'}
                </td>
                <td style={{ padding: '6px 10px', color: SK.muted, fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={item.wbs_path}>
                  {item.wbs_path ?? '—'}
                </td>
                <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.text }}>
                  {item.issue_type ?? '—'}
                </td>
                <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted }}>
                  {item.current_value ?? '—'}
                </td>
                <td style={{ padding: '6px 10px' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                    color: sevColour(item.severity), textTransform: 'uppercase',
                  }}>
                    {item.severity ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', borderTop: `1px solid ${SK.border}` }}>
          <PagBtn disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</PagBtn>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: SK.muted }}>
            {page + 1} / {totalPages}
          </span>
          <PagBtn disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</PagBtn>
        </div>
      )}
    </div>
  )
}

function PagBtn({ disabled, onClick, children }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-head)', fontSize: 11, fontWeight: 700,
        padding: '4px 12px', borderRadius: 4,
        border: `1px solid ${SK.border}`,
        background: SK.bg,
        color: disabled ? SK.border : SK.text,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DetailDrillDown({ checks }) {
  // Only show tabs for checks that have flagged items
  const tabChecks = (checks ?? []).filter(c => (c.flagged_items?.length ?? 0) > 0)
  const [activeTab, setActiveTab] = useState(0)

  if (!tabChecks.length) {
    return (
      <div style={{
        background: SK.card, border: `1px solid ${SK.border}`,
        borderRadius: 12, padding: 32, textAlign: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 15, color: SK.pass, marginBottom: 6 }}>
          No flagged activities
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: SK.muted }}>
          All checks passed with no items to review.
        </div>
      </div>
    )
  }

  const activeCheck = tabChecks[Math.min(activeTab, tabChecks.length - 1)]

  return (
    <div style={{
      background: SK.card, border: `1px solid ${SK.border}`,
      borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Section heading */}
      <div style={{ padding: '14px 16px 0', borderBottom: `1px solid ${SK.border}` }}>
        <div style={{
          fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 10,
          textTransform: 'uppercase', letterSpacing: '0.08em', color: SK.muted,
          marginBottom: 10,
        }}>
          Detail Drill-Down — Flagged Activities
        </div>

        {/* Tab bar — one tab per check with flagged items */}
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto' }}>
          {tabChecks.map((check, i) => {
            const isActive = i === activeTab
            const sc = { pass: SK.pass, warn: SK.warn, fail: SK.fail, info: SK.peri }[check.status] ?? SK.muted
            return (
              <button
                key={check.check_id}
                onClick={() => setActiveTab(i)}
                style={{
                  fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 11,
                  padding: '7px 12px',
                  border: 'none',
                  borderBottom: isActive ? `2px solid ${SK.peri}` : '2px solid transparent',
                  background: isActive ? SK.card : 'transparent',
                  color: isActive ? SK.text : SK.muted,
                  cursor: 'pointer',
                  borderRadius: '4px 4px 0 0',
                  whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', gap: 5,
                  transition: 'color 0.12s',
                }}
              >
                <span style={{ color: sc, fontSize: 8 }}>●</span>
                {check.check_name}
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                  background: isActive ? '#FEE2E2' : SK.bg,
                  color: isActive ? SK.fail : SK.muted,
                  borderRadius: 3, padding: '1px 5px',
                }}>
                  {check.flagged_items.length}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Active tab content */}
      <CheckTable key={activeCheck.check_id} check={activeCheck} />
    </div>
  )
}
