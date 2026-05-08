// ── ConvertView.jsx ────────────────────────────────────────────────────────────
//
// SKOPIA Lens — Schedule Convertor view (v0.1)
//
// A 4-step wizard ported from schedule-convertor.html into React.
// ALL conversion logic lives in convertor.js — this file is UI only.
//
// Steps:
//   1  Import   — direction selector + drag-drop file zone
//   2  Validate — pass/fail checklist
//   3  Convert  — progress bar with animated stages
//   4  Download — summary grid + download button
//
// IMPORTANT: This tool is 100% client-side.
//   - No calls to the FastAPI backend (/api/analyse).
//   - Conversion runs entirely in the browser.
//   - Compatible with mpp_adapter.py / xer_adapter_mpxj.py — they are
//     completely separate code paths used only for the health check analysis.
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback } from 'react'

// Import all conversion utilities from the companion module.
// These are pure functions — no DOM references, no React.
import {
  formatBytes,
  validateXER,
  validateMSPXML,
  convertXERtoMSP,
  convertMSPtoXER,
  downloadBlob,
} from '../convertor'

// ── Brand constants ───────────────────────────────────────────────────────────
// Inline here so this component is self-contained and doesn't depend on Tailwind
// for the critical brand colours. Tailwind classes used for spacing/layout only.
const SK = {
  header:  '#1E1E1E',
  bg:      '#F7F8FC',
  card:    '#FFFFFF',
  border:  '#E2E6F0',
  text:    '#1A1A2E',
  muted:   '#6B7280',
  cyan:    '#1EC8D4',
  peri:    '#4A6FE8',
  blue:    '#2A4DCC',
  grad:    'linear-gradient(135deg, #1EC8D4, #4A6FE8, #2A4DCC)',
  pass:    '#16A34A',
  warn:    '#D97706',
  fail:    '#DC2626',
  info:    '#2563EB',
}

// Validation result icon + colour lookup
const SEV = {
  pass: { icon: '✓', color: SK.pass,  bg: '#EAF3DE' },
  fail: { icon: '✕', color: SK.fail,  bg: '#FCEBEB' },
  warn: { icon: '!', color: SK.warn,  bg: '#FAEEDA' },
  info: { icon: 'i', color: SK.info,  bg: '#E6F1FB' },
}

// XER → MSP XML conversion stage labels
const STAGES_XER = [
  'Parsing XER…',
  'Analysing calendars…',
  'Walking WBS tree…',
  'Assigning UIDs…',
  'Converting activities…',
  'Building XML…',
  'Finalising…',
]
// MSP XML → XER conversion stage labels
const STAGES_MSP = [
  'Parsing XML…',
  'Filtering calendars…',
  'Reconstructing WBS…',
  'Converting tasks…',
  'Mapping relationships…',
  'Generating XER…',
  'Encoding output…',
]

// ── Main component ────────────────────────────────────────────────────────────
export default function ConvertView() {
  // ── Wizard state ────────────────────────────────────────────────────────────
  // step: 1=Import, 2=Validate, 3=Convert, 4=Download
  const [step,       setStep]       = useState(1)

  // Conversion direction: 'xer2xml' (XER→MSP XML) or 'xml2xer' (MSP XML→XER)
  const [direction,  setDirection]  = useState('xer2xml')

  // Loaded file info
  const [file,       setFile]       = useState(null)   // File object
  const [fileBytes,  setFileBytes]  = useState(null)   // Uint8Array raw bytes

  // Validation results: [{ severity, label, desc }]
  const [valResults, setValResults] = useState([])
  const [hasFail,    setHasFail]    = useState(false)

  // Parsed data — set during validation, used during conversion
  const [parsedData, setParsedData] = useState(null)

  // Conversion progress
  const [progress,   setProgress]   = useState(0)      // 0-100
  const [progStatus, setProgStatus] = useState('')

  // Conversion result
  const [resultBlob, setResultBlob] = useState(null)
  const [resultName, setResultName] = useState('')
  const [summary,    setSummary]    = useState({})

  // Drag state
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef(null)

  // ── Direction selection ─────────────────────────────────────────────────────
  function handleSelectDirection(dir) {
    setDirection(dir)
    clearFile()  // reset file state when direction changes
  }

  // ── File handling ───────────────────────────────────────────────────────────
  function clearFile() {
    setFile(null)
    setFileBytes(null)
    setParsedData(null)
    setValResults([])
    setHasFail(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function startOver() {
    clearFile()
    setStep(1)
    setProgress(0)
    setProgStatus('')
    setResultBlob(null)
    setResultName('')
    setSummary({})
  }

  /**
   * handleFile — reads the file as ArrayBuffer, stores as Uint8Array,
   * then runs validation and moves to step 2.
   * Why Uint8Array: XER files are Windows-1252 and contain raw 0x7F bytes
   * in clndr_data. TextDecoder mangles these. Byte-by-byte is the only
   * safe way to read XER. MSP XML is then re-decoded in parseMSPXML().
   */
  function handleFile(f) {
    const ext      = f.name.split('.').pop().toLowerCase()
    const expected = direction === 'xer2xml' ? 'xer' : 'xml'

    // MPP binary files — give a specific message, not a generic error
    if (ext === 'mpp') {
      alert('MSP binary .mpp files are not supported.\nIn MS Project: File → Save As → XML Format (.xml), then upload the .xml file.')
      return
    }

    if (ext !== expected) {
      alert(`Expected a .${expected} file for this direction. Got .${ext}.`)
      return
    }

    setFile(f)

    // Read as ArrayBuffer → convert to Uint8Array
    const reader = new FileReader()
    reader.onload = (e) => {
      const bytes = new Uint8Array(e.target.result)
      setFileBytes(bytes)
      runValidation(bytes, f.name)
    }
    reader.readAsArrayBuffer(f)
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function runValidation(bytes, filename) {
    setStep(2)

    // Call the appropriate validator from convertor.js
    // Both return { results: [{severity, label, desc}], parsedData: obj|null }
    const { results, parsedData: pd } = direction === 'xer2xml'
      ? validateXER(bytes)
      : validateMSPXML(bytes)

    setValResults(results)
    setParsedData(pd)
    setHasFail(results.some(r => r.severity === 'fail'))
  }

  // ── Conversion ──────────────────────────────────────────────────────────────
  /**
   * runConversion — async so we can yield between stages (setTimeout 0)
   * to let React re-render the progress bar between each stage label update.
   * The actual conversion is synchronous but wrapped in a promise chain
   * so the progress bar animates step-by-step.
   */
  async function runConversion() {
    setStep(3)
    setProgress(0)

    const stages = direction === 'xer2xml' ? STAGES_XER : STAGES_MSP

    // Animate through stages with a short delay each
    for (let i = 0; i < stages.length; i++) {
      setProgStatus(stages[i])
      setProgress(Math.round(((i + 1) / stages.length) * 90))
      // Small delay so React can re-render before next stage
      await new Promise(r => setTimeout(r, 120))
    }

    try {
      // Run conversion — both functions are pure: they take parsed data and
      // return { blob, filename, summary }
      const result = direction === 'xer2xml'
        ? convertXERtoMSP(parsedData, file.name)
        : convertMSPtoXER(parsedData, file.name)

      setProgress(100)
      setProgStatus('Complete!')
      setResultBlob(result.blob)
      setResultName(result.filename)
      setSummary(result.summary)

      // Brief pause so user sees "Complete!" before moving to download
      await new Promise(r => setTimeout(r, 400))
      setStep(4)

    } catch (err) {
      setProgStatus('Error: ' + err.message)
      console.error('Conversion error:', err)
    }
  }

  // ── Drag-and-drop handlers ──────────────────────────────────────────────────
  const handleDragOver  = useCallback(e => { e.preventDefault(); setIsDragging(true)  }, [])
  const handleDragLeave = useCallback(e => { e.preventDefault(); setIsDragging(false) }, [])
  const handleDrop      = useCallback(e => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0])
  }, [direction]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Download ────────────────────────────────────────────────────────────────
  function handleDownload() {
    if (resultBlob && resultName) downloadBlob(resultBlob, resultName)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    // Full-height scroll container with SKOPIA page background
    <div
      style={{
        flex: 1,
        background: SK.bg,
        overflowY: 'auto',
        fontFamily: 'var(--font-body, "Open Sans", Arial, sans-serif)',
      }}
    >
      {/* ── Inner content wrapper — max-width centred ── */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px' }}>

        {/* ── Page title ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{
            fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
            fontWeight: 700,
            fontSize: 20,
            color: SK.text,
            margin: 0,
          }}>
            Schedule Convertor
          </h2>
          <p style={{ fontSize: 13, color: SK.muted, margin: '4px 0 0' }}>
            Convert between Primavera P6 XER and Microsoft Project XML — runs entirely in your browser.
          </p>
          {/* Gradient accent strip under title */}
          <div style={{ background: SK.grad, height: 2, marginTop: 12, borderRadius: 2 }} />
        </div>

        {/* ── Step indicator ─────────────────────────────────────────────── */}
        <StepBar step={step} />

        {/* ── Step panels — only the active step is rendered ─────────────── */}
        {step === 1 && (
          <StepImport
            direction={direction}
            onSelectDirection={handleSelectDirection}
            file={file}
            isDragging={isDragging}
            fileInputRef={fileInputRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onFileChange={e => { if (e.target.files.length) handleFile(e.target.files[0]) }}
            onClickZone={() => fileInputRef.current?.click()}
            onClearFile={clearFile}
          />
        )}

        {step === 2 && (
          <StepValidate
            results={valResults}
            hasFail={hasFail}
            onBack={() => setStep(1)}
            onConvert={runConversion}
          />
        )}

        {step === 3 && (
          <StepConvert progress={progress} status={progStatus} />
        )}

        {step === 4 && (
          <StepDownload
            filename={resultName}
            summary={summary}
            onDownload={handleDownload}
            onStartOver={startOver}
          />
        )}
      </div>

      {/* ── Version footer ─────────────────────────────────────────────────── */}
      <div style={{
        textAlign: 'center',
        padding: '10px 0 16px',
        fontSize: 11,
        color: SK.muted,
        fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        SKOPIA Schedule Convertor · v0.1
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── StepBar ──────────────────────────────────────────────────────────────────
// Four numbered steps with connector lines. Active = cyan, Done = green, Pending = grey.
function StepBar({ step }) {
  const steps = ['Import', 'Validate', 'Convert', 'Download']

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      marginBottom: 28,
    }}>
      {steps.map((label, i) => {
        const n      = i + 1
        const isDone = n < step
        const isAct  = n === step

        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            {/* Step dot + label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              {/* Numbered circle */}
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
                fontWeight: 700,
                fontSize: 12,
                // Done = green, Active = cyan, Pending = light grey
                background: isDone ? SK.pass : isAct ? SK.cyan : SK.border,
                color: (isDone || isAct) ? '#fff' : SK.muted,
                flexShrink: 0,
                transition: 'all 0.2s',
              }}>
                {isDone ? '✓' : n}
              </div>
              {/* Step label */}
              <span style={{
                fontSize: 12,
                fontWeight: isAct ? 700 : 400,
                color: isAct ? SK.text : isDone ? SK.pass : SK.muted,
                fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {label}
              </span>
            </div>
            {/* Connector line — not after the last step */}
            {i < steps.length - 1 && (
              <div style={{
                flex: 1,
                height: 2,
                background: isDone ? SK.pass : SK.border,
                margin: '0 12px',
                borderRadius: 1,
                transition: 'background 0.2s',
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── StepImport ────────────────────────────────────────────────────────────────
// Direction selector cards + drag-drop upload zone
function StepImport({
  direction, onSelectDirection,
  file, isDragging, fileInputRef,
  onDragOver, onDragLeave, onDrop,
  onFileChange, onClickZone, onClearFile,
}) {
  const isXer    = direction === 'xer2xml'
  const accept   = isXer ? '.xer' : '.xml,.mpp'
  const dropHint = isXer ? 'Accepts .xer files' : 'Accepts .xml files (MSP XML format)'
  const title    = isXer ? 'Import XER File' : 'Import MSP XML File'
  const sub      = isXer
    ? 'Drag and drop your .xer file or click to browse.'
    : 'Drag and drop your .xml file or click to browse. For .mpp files, export as XML from MS Project first.'

  return (
    <div>
      {/* ── Direction selector card ─────────────────────────────────────── */}
      <Card style={{ marginBottom: 16 }}>
        <h3 style={headingStyle}>Select Conversion Direction</h3>
        <p style={subStyle}>Choose the format you are converting from and to.</p>

        {/* Two direction buttons side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
          <DirBtn
            selected={direction === 'xer2xml'}
            onClick={() => onSelectDirection('xer2xml')}
            label="XER → MSP XML"
            sub="Primavera P6 to Microsoft Project"
            arrows="— →"
          />
          <DirBtn
            selected={direction === 'xml2xer'}
            onClick={() => onSelectDirection('xml2xer')}
            label="MSP XML → XER"
            sub="Microsoft Project to Primavera P6"
            arrows="— →"
          />
        </div>
      </Card>

      {/* ── File upload card ────────────────────────────────────────────── */}
      <Card>
        <h3 style={headingStyle}>{title}</h3>
        <p style={subStyle}>{sub}</p>

        {/* Hidden file input — triggered by clicking the drop zone */}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={onFileChange}
        />

        {/* Drag-drop zone — gradient dashed border using background-clip trick */}
        <div
          onClick={onClickZone}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          style={{
            marginTop: 16,
            borderRadius: 8,
            cursor: 'pointer',
            minHeight: 160,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            // Gradient dashed border: two background layers
            // 1) solid white padding-box (inner fill)
            // 2) gradient border-box (the dashed border colour)
            // border itself is transparent so background shows through
            border: '2px dashed transparent',
            background: `
              linear-gradient(${isDragging ? 'rgba(30,200,212,0.08)' : '#fff'}, ${isDragging ? 'rgba(30,200,212,0.08)' : '#fff'}) padding-box,
              linear-gradient(135deg, #1EC8D4, #4A6FE8, #2A4DCC) border-box
            `,
            transition: 'background 0.15s',
          }}
        >
          {/* Folder icon */}
          <svg width="48" height="40" viewBox="0 0 48 40" fill="none">
            <rect x="0" y="8" width="48" height="32" rx="4" fill="#F59E0B" opacity="0.8" />
            <rect x="0" y="4" width="20" height="10" rx="3" fill="#F59E0B" />
          </svg>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: SK.text, fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)' }}>
              Drop your file here, or click to browse
            </div>
            <div style={{ fontSize: 12, color: SK.muted, marginTop: 4 }}>{dropHint}</div>
          </div>
        </div>

        {/* File info row — shown once a file is selected */}
        {file && (
          <div style={{
            marginTop: 12,
            padding: '10px 14px',
            background: SK.bg,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: `1px solid ${SK.border}`,
          }}>
            {/* File icon */}
            <svg width="20" height="24" viewBox="0 0 20 24" fill="none">
              <rect x="0" y="0" width="14" height="24" rx="2" fill="#E2E6F0" />
              <path d="M14 0 L20 6 L14 6 Z" fill="#c8cde0" />
              <rect x="14" y="6" width="6" height="18" rx="1" fill="#c8cde0" />
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: SK.text, fontFamily: 'var(--font-mono, monospace)' }}>
                {file.name}
              </div>
              <div style={{ fontSize: 11, color: SK.muted }}>{formatBytes(file.size)}</div>
            </div>
            {/* Remove file button */}
            <button
              onClick={e => { e.stopPropagation(); onClearFile() }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: SK.muted, fontSize: 18, lineHeight: 1, padding: 4 }}
              title="Remove file"
            >
              ×
            </button>
          </div>
        )}

        {/* MPP warning */}
        <div style={{
          marginTop: 14,
          padding: '10px 14px',
          background: '#FFFBEB',
          border: '1px solid #FDE68A',
          borderLeft: `4px solid ${SK.warn}`,
          borderRadius: 6,
          fontSize: 12,
          color: '#92400E',
          lineHeight: 1.5,
        }}>
          <strong>MPP files not supported:</strong> MS Project binary (.mpp) files cannot be read in the browser.
          In MS Project: <strong>File → Save As → XML Format (.xml)</strong>, then upload the .xml file here.
        </div>
      </Card>
    </div>
  )
}

// ── DirBtn ────────────────────────────────────────────────────────────────────
// Direction selector card button
function DirBtn({ selected, onClick, label, sub }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'center',
        padding: '20px 16px',
        border: selected ? `2px solid ${SK.cyan}` : `1px solid ${SK.border}`,
        borderRadius: 8,
        background: selected ? 'rgba(30,200,212,0.04)' : SK.card,
        cursor: 'pointer',
        transition: 'all 0.15s',
        outline: 'none',
      }}
    >
      {/* Arrow icon */}
      <div style={{ color: SK.cyan, fontSize: 20, marginBottom: 8, letterSpacing: 4 }}>
        ←  →
      </div>
      <div style={{
        fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
        fontWeight: 700,
        fontSize: 14,
        color: selected ? SK.cyan : SK.text,
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: SK.muted }}>{sub}</div>
    </button>
  )
}

// ── StepValidate ──────────────────────────────────────────────────────────────
// Validation result checklist
function StepValidate({ results, hasFail, onBack, onConvert }) {
  return (
    <Card>
      <h3 style={headingStyle}>Validation Results</h3>
      <p style={subStyle}>
        {hasFail
          ? 'Critical issues found. Fix the problems below before converting.'
          : 'Validation passed. You can proceed with the conversion.'}
      </p>

      {/* Validation list */}
      <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
        {results.map((r, i) => {
          const sev = SEV[r.severity] || SEV.info
          return (
            <li
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '10px 0',
                borderBottom: i < results.length - 1 ? `1px solid ${SK.border}` : 'none',
              }}
            >
              {/* Severity icon */}
              <div style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: sev.bg,
                color: sev.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
              }}>
                {sev.icon}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: SK.text }}>
                  {r.label}
                </div>
                <div style={{ fontSize: 12, color: SK.muted, lineHeight: 1.5, marginTop: 2 }}>
                  {r.desc}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {/* Action buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
        <GhostBtn onClick={onBack}>← Back</GhostBtn>
        <PrimaryBtn onClick={onConvert} disabled={hasFail}>
          Convert →
        </PrimaryBtn>
      </div>
    </Card>
  )
}

// ── StepConvert ───────────────────────────────────────────────────────────────
// Animated progress bar with stage status labels
function StepConvert({ progress, status }) {
  return (
    <Card style={{ textAlign: 'center', padding: '40px 32px' }}>
      {/* Pulsing dots animation */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
        {[0, 150, 300].map((delay, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: [SK.cyan, SK.peri, SK.blue][i],
              animation: `pulse 1.2s ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </div>

      {/* Pulse animation keyframe — injected as a style tag */}
      <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.8)} }`}</style>

      {/* Stage status label */}
      <div style={{
        fontSize: 14,
        fontWeight: 600,
        color: SK.text,
        fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
        marginBottom: 20,
        minHeight: 22,
      }}>
        {status}
      </div>

      {/* Progress bar */}
      <div style={{
        height: 8,
        background: SK.border,
        borderRadius: 4,
        overflow: 'hidden',
        maxWidth: 400,
        margin: '0 auto',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: SK.grad,
          borderRadius: 4,
          transition: 'width 0.2s ease',
        }} />
      </div>

      <div style={{ fontSize: 12, color: SK.muted, marginTop: 8 }}>{progress}%</div>
    </Card>
  )
}

// ── StepDownload ──────────────────────────────────────────────────────────────
// Conversion summary grid + download button
function StepDownload({ filename, summary, onDownload, onStartOver }) {
  return (
    <Card>
      {/* Success header with gradient */}
      <div style={{
        background: SK.grad,
        borderRadius: '8px 8px 0 0',
        padding: '20px 24px',
        margin: '-24px -24px 20px',
      }}>
        <h3 style={{
          fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
          fontWeight: 700,
          fontSize: 18,
          color: '#fff',
          margin: 0,
        }}>
          Conversion Complete
        </h3>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', margin: '4px 0 0' }}>
          {filename}
        </p>
      </div>

      {/* Summary grid — one tile per summary key */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        {Object.entries(summary).map(([key, val]) => (
          <div
            key={key}
            style={{
              background: SK.bg,
              border: `1px solid ${SK.border}`,
              borderRadius: 8,
              padding: '12px 14px',
            }}
          >
            <div style={{ fontSize: 11, color: SK.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)', fontWeight: 700 }}>
              {key}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: SK.text, fontFamily: 'var(--font-mono, monospace)' }}>
              {String(val)}
            </div>
          </div>
        ))}
      </div>

      {/* Limitations notice */}
      <div style={{
        padding: '10px 14px',
        background: '#E6F1FB',
        border: `1px solid #93C5FD`,
        borderLeft: `4px solid ${SK.info}`,
        borderRadius: 6,
        fontSize: 12,
        color: '#1E40AF',
        lineHeight: 1.6,
        marginBottom: 24,
      }}>
        <strong>v0.1 limitations:</strong> Resources, baselines, activity codes, and UDFs are not converted.
        Dates may shift ±1 day on round-trips due to constraint type mapping (ASAP → SNET is expected and correct).
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <GhostBtn onClick={onStartOver}>Start New Conversion</GhostBtn>
        <DownloadBtn onClick={onDownload}>
          ↓  Download {filename.endsWith('.xer') ? 'XER' : 'XML'}
        </DownloadBtn>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ATOMIC UI COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// ── Card ──────────────────────────────────────────────────────────────────────
// White card with SKOPIA border — the fundamental container
function Card({ children, style }) {
  return (
    <div style={{
      background: SK.card,
      border: `1px solid ${SK.border}`,
      borderRadius: 8,
      padding: 24,
      marginBottom: 16,
      boxShadow: '0 1px 3px rgba(26,26,46,0.04)',
      ...style,
    }}>
      {children}
    </div>
  )
}

// ── PrimaryBtn ────────────────────────────────────────────────────────────────
// Gradient background, white text
function PrimaryBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? SK.border : SK.grad,
        color: disabled ? SK.muted : '#fff',
        border: 'none',
        borderRadius: 6,
        padding: '10px 24px',
        fontSize: 13,
        fontWeight: 700,
        fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        letterSpacing: '0.02em',
        opacity: disabled ? 0.7 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      {children}
    </button>
  )
}

// ── DownloadBtn ───────────────────────────────────────────────────────────────
// Green background (pass colour) — signals a safe/positive action
function DownloadBtn({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: SK.pass,
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        padding: '12px 28px',
        fontSize: 14,
        fontWeight: 700,
        fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
        cursor: 'pointer',
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </button>
  )
}

// ── GhostBtn ──────────────────────────────────────────────────────────────────
// White background with border — secondary action
function GhostBtn({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: SK.card,
        color: SK.text,
        border: `1.5px solid ${SK.border}`,
        borderRadius: 6,
        padding: '10px 20px',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'var(--font-body, "Open Sans", Arial, sans-serif)',
        cursor: 'pointer',
        letterSpacing: '0.01em',
      }}
    >
      {children}
    </button>
  )
}

// ── Shared style objects ──────────────────────────────────────────────────────
// Defined once — used in multiple sub-components.
const headingStyle = {
  fontFamily: 'var(--font-head, "Montserrat", Arial, sans-serif)',
  fontWeight: 700,
  fontSize: 16,
  color: '#1A1A2E',
  margin: 0,
}

const subStyle = {
  fontSize: 13,
  color: '#6B7280',
  margin: '4px 0 0',
  lineHeight: 1.5,
}
