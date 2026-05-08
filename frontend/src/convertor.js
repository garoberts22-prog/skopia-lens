/**
 * SKOPIA Schedule Convertor — Conversion Logic (v0.1)
 *
 * Pure utility functions extracted from schedule-convertor.html.
 * No DOM references, no React, no side effects — safe to import anywhere.
 *
 * CRITICAL: The NM_* tag constants MUST be defined via string concatenation.
 * If '<Name>' appears as a raw string literal inside a script block, the HTML
 * parser consumes the tag before JS executes, leaving an empty string. The same
 * risk exists in JSX template literals. Always build via concatenation.
 *
 * This module is 100% client-side. It has NO interaction with the FastAPI
 * backend — the convertor runs entirely in the browser and is compatible with
 * the backend parsers (xer_adapter_mpxj.py, mpp_adapter.py) which operate on
 * the /api/analyse endpoint only.
 */

// ── XML name tag constants ────────────────────────────────────────────────────
// Constructed via concatenation — never raw string literals.
export const NM_O       = '<' + 'Name>';
export const NM_C       = '</' + 'Name>';
export const NM_CDATA_O = '<' + 'Name><![CDATA[';
export const NM_CDATA_C = ']]></' + 'Name>';

// ── Lookup tables ─────────────────────────────────────────────────────────────
export const REL_P6_TO_MSP = { PR_FF: 0, PR_FS: 1, PR_SF: 2, PR_SS: 3 };
export const REL_MSP_TO_P6 = { 0: 'PR_FF', 1: 'PR_FS', 2: 'PR_SF', 3: 'PR_SS' };

export const CSTR_P6_TO_MSP = {
  '': -1, 'CS_ASAP': -1, 'CS_ALAP': -1,
  'CS_MANDSTART': 2, 'CS_MSO': 2,
  'CS_MANDFIN':   3, 'CS_MEO': 3,
  'CS_MSOA':      4, 'CS_SNET': 4,
  'CS_MSOB':      5, 'CS_SNLT': 5,
  'CS_MEOA':      6, 'CS_FNET': 6,
  'CS_MEOB':      7, 'CS_FNLT': 7,
};
export const CSTR_MSP_TO_P6 = {
  0: '', 1: '',
  2: 'CS_MANDSTART', 3: 'CS_MANDFIN',
  4: 'CS_MSOA',      5: 'CS_MSOB',
  6: 'CS_MEOA',      7: 'CS_MEOB',
};

// Windows-1252 high-byte → ASCII replacements
const WIN1252_MAP = {
  0x85: '...', 0x91: "'",  0x92: "'",  0x93: '"',  0x94: '"',
  0x96: '-',   0x97: '-',  0xA0: ' ',  0xA9: '(c)', 0xAE: '(R)',
  0xB0: 'deg', 0xB7: '.',  0xBC: '1/4', 0xBD: '1/2', 0xBE: '3/4',
};

const OLE_EPOCH = new Date(1899, 11, 30);

// ── Sanitisation helpers ──────────────────────────────────────────────────────

/**
 * Sanitise string for use inside XML CDATA sections.
 * Strips non-ASCII chars (maps Win-1252 to ASCII equivalents).
 * Does NOT entity-encode & < > — CDATA handles these natively.
 */
export function sanitiseCDATA(str) {
  if (!str) return '';
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 32 && c <= 126) out += str[i];
    else if (c === 9 || c === 10 || c === 13) out += str[i];
    else if (WIN1252_MAP[c]) out += WIN1252_MAP[c];
  }
  return out;
}

/**
 * Sanitise string for bare XML text values (not in CDATA).
 * Applies Win-1252 stripping then entity-encodes & < > "
 */
export function sanitiseXMLValue(str) {
  if (!str) return '';
  return sanitiseCDATA(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sanitise for XER text output (MSP→XER direction).
 * Replaces non-ASCII with space. Never removes bytes (field alignment risk
 * in tab-delimited XER format).
 */
export function sanitiseBytesToAscii(str) {
  if (!str) return '';
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) out += str[i];
    else if (WIN1252_MAP[c]) out += WIN1252_MAP[c];
    else out += ' ';
  }
  return out;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function parseP6Date(s) {
  if (!s || !s.trim()) return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

export function formatMSPDate(dt) {
  if (!dt) return '';
  return dt.getFullYear() + '-'
    + String(dt.getMonth() + 1).padStart(2, '0') + '-'
    + String(dt.getDate()).padStart(2, '0') + 'T'
    + String(dt.getHours()).padStart(2, '0') + ':'
    + String(dt.getMinutes()).padStart(2, '0') + ':00';
}

export function formatP6Date(dt) {
  if (!dt) return '';
  return dt.getFullYear() + '-'
    + String(dt.getMonth() + 1).padStart(2, '0') + '-'
    + String(dt.getDate()).padStart(2, '0') + ' '
    + String(dt.getHours()).padStart(2, '0') + ':'
    + String(dt.getMinutes()).padStart(2, '0');
}

export function parseMSPDate(s) {
  if (!s || !s.trim()) return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

// MSP exports dates with 00:00 time — push to working hours
export function adjustStart(dt)  { if (dt && dt.getHours() === 0 && dt.getMinutes() === 0) dt.setHours(8);  return dt; }
export function adjustFinish(dt) { if (dt && dt.getHours() === 0 && dt.getMinutes() === 0) dt.setHours(17); return dt; }

export function oleToDate(serial) { return new Date(OLE_EPOCH.getTime() + serial * 86400000); }
export function dateToOle(dt)     { return Math.round((dt.getTime() - OLE_EPOCH.getTime()) / 86400000); }

export function parseISODuration(s) {
  if (!s) return 0;
  const m = s.match(/PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/);
  return m ? (parseFloat(m[1] || 0) + parseFloat(m[2] || 0) / 60 + parseFloat(m[3] || 0) / 3600) : 0;
}

export function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// GUID for P6 XER — 22-char base64-encoded 16-byte UUID (no dashes, no padding)
export function generateGuidBase64() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < 16; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '');
}

// ── XER Parser ────────────────────────────────────────────────────────────────
/**
 * Parse a Primavera P6 XER file from raw bytes.
 *
 * WHY byte-by-byte: XER files are Windows-1252. The clndr_data field contains
 * raw 0x7F bytes as field delimiters. TextDecoder with 'utf-8' errors on these;
 * with 'windows-1252' it up-converts them to U+007F which re-encodes differently.
 * Only byte-by-byte char code reading guarantees 0x7F bytes survive intact.
 */
export function parseXER(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);

  const lines = str.split('\n');
  const result = { tables: {}, ermhdr: null };
  let currentTable = null, fields = null;

  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    if (line.length && line[line.length - 1] === '\r') line = line.slice(0, -1);

    if (line.startsWith('ERMHDR')) { result.ermhdr = line.split('\t'); continue; }
    if (line.startsWith('%T')) {
      let tname = line.split('\t')[1];
      if (tname) tname = tname.trim();
      currentTable = tname;
      result.tables[currentTable] = { fields: [], rows: [] };
      fields = null;
      continue;
    }
    if (line.startsWith('%F') && currentTable) {
      fields = line.split('\t').slice(1).map(f => f.trim());
      result.tables[currentTable].fields = fields;
      continue;
    }
    if (line.startsWith('%R') && currentTable && fields) {
      const vals = line.split('\t').slice(1);
      const row = {};
      for (let fi = 0; fi < fields.length; fi++) {
        row[fields[fi]] = vals[fi] !== undefined ? vals[fi] : '';
      }
      result.tables[currentTable].rows.push(row);
    }
  }
  return result;
}

// ── MSP XML Parser ────────────────────────────────────────────────────────────
/**
 * Parse a Microsoft Project XML (.xml) file from raw bytes.
 * MSP XML is UTF-8 — TextDecoder is safe here (unlike XER).
 */
export function parseMSPXML(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes);
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) return { error: 'XML parse error: ' + err.textContent.substring(0, 200) };
  const root = doc.documentElement;
  if (root.localName !== 'Project') return { error: 'Not a valid MSP XML file — root element is <' + root.localName + '>' };

  function txt(parent, tag) {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  }

  const result = { project: {}, calendars: [], tasks: [] };
  result.project.name       = txt(root, 'Name') || txt(root, 'Title') || 'Converted Project';
  result.project.startDate  = txt(root, 'StartDate');
  result.project.finishDate = txt(root, 'FinishDate');
  result.project.statusDate = txt(root, 'StatusDate');
  result.project.minPerDay  = parseInt(txt(root, 'MinutesPerDay'))  || 480;
  result.project.minPerWeek = parseInt(txt(root, 'MinutesPerWeek')) || 2400;

  // Calendars — skip nested Calendar elements (only top-level)
  const calEls = root.getElementsByTagName('Calendar');
  for (let ci = 0; ci < calEls.length; ci++) {
    const ce = calEls[ci];
    if (ce.parentElement && ce.parentElement.localName === 'Calendar') continue;
    const cal = {
      uid: parseInt(txt(ce, 'UID')) || 0,
      name: txt(ce, 'Name'),
      isBase: txt(ce, 'IsBaseCalendar') === '1',
      weekDays: [],
      exceptions: [],
    };
    // Resource calendar heuristic: semicolons in name = merged resource calendar
    cal._isResource = (cal.name.includes(';') || /\([^)]{3,}\)/.test(cal.name)) && !cal.isBase;

    const wds = ce.getElementsByTagName('WeekDay');
    for (let wi = 0; wi < wds.length; wi++) {
      const wd = wds[wi];
      if (wd.parentElement && wd.parentElement.parentElement &&
          wd.parentElement.parentElement.localName === 'Exception') continue;
      const times = [];
      const wts = wd.getElementsByTagName('WorkingTime');
      for (let ti = 0; ti < wts.length; ti++) {
        times.push({ from: txt(wts[ti], 'FromTime'), to: txt(wts[ti], 'ToTime') });
      }
      cal.weekDays.push({ dayType: parseInt(txt(wd, 'DayType')) || 0, working: txt(wd, 'DayWorking') === '1', times });
    }

    const excCont = ce.getElementsByTagName('Exceptions')[0];
    if (excCont) {
      for (let ei = 0; ei < excCont.children.length; ei++) {
        const exc = excCont.children[ei];
        if (exc.localName !== 'Exception') continue;
        const tp = exc.getElementsByTagName('TimePeriod')[0];
        cal.exceptions.push({
          from: tp ? txt(tp, 'FromDate') : txt(exc, 'FromDate'),
          to:   tp ? txt(tp, 'ToDate')   : txt(exc, 'ToDate'),
          dayWorking: txt(exc, 'DayWorking') === '1',
          name: txt(exc, 'Name') || 'Exception',
        });
      }
    }
    result.calendars.push(cal);
  }

  // Tasks
  const taskEls = root.querySelectorAll('Tasks > Task');
  for (let tei = 0; tei < taskEls.length; tei++) {
    const te = taskEls[tei];
    const extAttrs = {};
    const eaEls = te.getElementsByTagName('ExtendedAttribute');
    for (let eai = 0; eai < eaEls.length; eai++) {
      const fid = txt(eaEls[eai], 'FieldID'), val = txt(eaEls[eai], 'Value');
      if (fid && val) extAttrs[fid] = val;
    }
    const preds = [];
    const plEls = te.getElementsByTagName('PredecessorLink');
    for (let pi = 0; pi < plEls.length; pi++) {
      preds.push({
        uid:  parseInt(txt(plEls[pi], 'PredecessorUID')) || 0,
        type: parseInt(txt(plEls[pi], 'Type')),
        lag:  parseInt(txt(plEls[pi], 'LinkLag')) || 0,
      });
    }
    let cstrType = parseInt(txt(te, 'ConstraintType'));
    if (isNaN(cstrType)) cstrType = 0;
    result.tasks.push({
      uid: parseInt(txt(te, 'UID')),
      id: parseInt(txt(te, 'ID')),
      name: txt(te, 'Name'),
      outlineLevel: parseInt(txt(te, 'OutlineLevel')) || 0,
      summary: txt(te, 'Summary') === '1',
      milestone: txt(te, 'Milestone') === '1',
      start: txt(te, 'Start'),
      finish: txt(te, 'Finish'),
      duration: txt(te, 'Duration'),
      pctComplete: parseInt(txt(te, 'PercentComplete')) || 0,
      actualStart: txt(te, 'ActualStart'),
      actualFinish: txt(te, 'ActualFinish'),
      constraintType: cstrType,
      constraintDate: txt(te, 'ConstraintDate'),
      calendarUID: parseInt(txt(te, 'CalendarUID')) || -1,
      extendedAttributes: extAttrs,
      predecessors: preds,
    });
  }
  return result;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateXER(bytes) {
  const results = [];
  let parsedData = null;

  try { parsedData = parseXER(bytes); }
  catch (e) { return { results: [{ severity: 'fail', label: 'File Parse', desc: 'Failed: ' + e.message }], parsedData: null }; }

  const d = parsedData;
  if (!d.ermhdr) {
    results.push({ severity: 'fail', label: 'File Parse', desc: 'No ERMHDR found — not a valid XER file' });
    return { results, parsedData: null };
  }
  results.push({ severity: 'pass', label: 'File Parse', desc: 'Valid XER file (v' + (d.ermhdr[1] || '?').trim() + ')' });

  const projects = d.tables.PROJECT ? d.tables.PROJECT.rows : [];
  if (!projects.length) { results.push({ severity: 'fail', label: 'Project', desc: 'No PROJECT table found' }); return { results, parsedData: null }; }
  if (projects.length > 1) { results.push({ severity: 'fail', label: 'Project', desc: 'Multi-project XER not supported in v0.1' }); return { results, parsedData: null }; }
  results.push({ severity: 'pass', label: 'Project', desc: projects[0].proj_short_name || projects[0].proj_id });

  const allTasks = d.tables.TASK ? d.tables.TASK.rows : [];
  const ttWbs   = allTasks.filter(t => t.task_type === 'TT_WBS');
  const detail  = allTasks.filter(t => t.task_type !== 'TT_WBS');
  if (!detail.length) { results.push({ severity: 'fail', label: 'Activities', desc: 'No TASK rows found' }); return { results, parsedData: null }; }
  results.push({ severity: 'pass', label: 'Activities', desc: `${detail.length} activities (${ttWbs.length} TT_WBS excluded)` });

  const cals = d.tables.CALENDAR ? d.tables.CALENDAR.rows : [];
  results.push({ severity: cals.length ? 'pass' : 'fail', label: 'Calendars', desc: `${cals.length} calendar(s) defined` });

  const preds = d.tables.TASKPRED ? d.tables.TASKPRED.rows : [];
  results.push({ severity: preds.length ? 'pass' : 'warn', label: 'Relationships', desc: `${preds.length} predecessor links` });

  const wbs = d.tables.PROJWBS ? d.tables.PROJWBS.rows : [];
  results.push({ severity: wbs.length ? 'pass' : 'warn', label: 'WBS', desc: `${wbs.length} WBS nodes` });

  if (ttWbs.length) results.push({ severity: 'info', label: 'TT_WBS', desc: `${ttWbs.length} WBS Summary activities will be excluded from output` });

  return { results, parsedData: d };
}

export function validateMSPXML(bytes) {
  const results = [];
  let parsedData = null;

  try { parsedData = parseMSPXML(bytes); }
  catch (e) { return { results: [{ severity: 'fail', label: 'File Parse', desc: 'Failed: ' + e.message }], parsedData: null }; }

  const d = parsedData;
  if (d.error) { results.push({ severity: 'fail', label: 'XML Schema', desc: d.error }); return { results, parsedData: null }; }
  results.push({ severity: 'pass', label: 'XML Schema', desc: 'Valid MSP XML document' });

  const detail  = (d.tasks || []).filter(t => !t.summary && t.uid !== 0);
  const summary = (d.tasks || []).filter(t => t.summary);
  if (!detail.length) { results.push({ severity: 'fail', label: 'Tasks', desc: 'No detail tasks found' }); return { results, parsedData: null }; }
  results.push({ severity: 'pass', label: 'Tasks', desc: `${detail.length} detail tasks, ${summary.length} summary tasks` });

  const baseCals = (d.calendars || []).filter(c => !c._isResource);
  const rsrcCals = (d.calendars || []).filter(c => c._isResource);
  results.push({ severity: baseCals.length ? 'pass' : 'fail', label: 'Calendars', desc: `${baseCals.length} base calendar(s)` + (rsrcCals.length ? ` (${rsrcCals.length} resource calendars will be dropped)` : '') });

  const predCount = detail.reduce((n, t) => n + t.predecessors.length, 0);
  results.push({ severity: predCount ? 'pass' : 'warn', label: 'Relationships', desc: `${predCount} predecessor links` });
  results.push({ severity: 'pass', label: 'Outline', desc: `${summary.length} summary tasks → WBS nodes` });

  const withText30 = detail.filter(t => t.extendedAttributes['188744016']);
  if (withText30.length) results.push({ severity: 'info', label: 'Activity IDs', desc: `${withText30.length} tasks carry Text30 Activity IDs (P6 round-trip source)` });

  return { results, parsedData: d };
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

/**
 * Parse P6 clndr_data field to extract per-day work patterns.
 *
 * Handles TWO formats:
 *   A) Legacy parenthesis format — older P6 versions:
 *      (0||CalendarData()((0||DaysOfWeek()(...
 *   B) XML format — P6 v22.12+ simplified exports:
 *      <calendars><calendar id="1"><work_week><day id="1" work="1">...
 *
 * If neither format is detected, returns generic 5-day defaults.
 */
export function parseCalendarWorkPattern(clndrData, is7Day, dayHrs) {
  const result = { days: {} };
  // Set defaults first (overwritten if data is found)
  for (let d = 1; d <= 7; d++) {
    const isWorkday = is7Day ? true : (d >= 2 && d <= 6);
    result.days[d] = {
      working: isWorkday,
      shifts: isWorkday
        ? (dayHrs >= 10 ? [{ from: '07:00', to: '17:00' }] : [{ from: '08:00', to: '12:00' }, { from: '13:00', to: '17:00' }])
        : [],
    };
  }
  if (!clndrData) return result;

  // ── Format B: XML-format clndr_data (P6 v22.12+) ──────────────────────────
  // Detect by presence of <work_week> or <day id=
  if (clndrData.includes('<work_week>') || clndrData.includes('<day id=')) {
    // P6 day ids: 1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat,7=Sun
    // MSP/convertor day numbers match this 1-7 scheme
    const dayMatches = clndrData.matchAll(/<day id="(\d)"\s+work="(\d)"[^>]*>([\s\S]*?)<\/day>|<day id="(\d)"\s+work="(\d)"[^/]*\/>/g);
    for (const m of dayMatches) {
      // Two capture groups for open-tag vs self-closing forms
      const dayId   = parseInt(m[1] || m[4]);
      const working = (m[2] || m[5]) === '1';
      const inner   = m[3] || '';
      const shifts  = [];
      if (working) {
        const hourMatches = inner.matchAll(/<hour start="([^"]+)" end="([^"]+)"/g);
        for (const h of hourMatches) {
          // Normalise HH:MM (strip seconds if present)
          shifts.push({
            from: h[1].substring(0, 5),
            to:   h[2].substring(0, 5),
          });
        }
        // If no explicit hours, use default working hours
        if (!shifts.length) {
          shifts.push(dayHrs >= 10 ? { from: '07:00', to: '17:00' } : { from: '08:00', to: '17:00' });
        }
      }
      result.days[dayId] = { working, shifts };
    }
    return result;
  }

  // ── Format A: Legacy parenthesis format ───────────────────────────────────
  const dowMatch = clndrData.match(/DaysOfWeek\(\)\([\s\S]*?\)\)[\x7F]/);
  if (!dowMatch) return result;
  const block = dowMatch[0];

  const dayRe = /\(0\|\|(\d)\(\)\(([\s\S]*?)\)\)/g;
  let dm;
  while ((dm = dayRe.exec(block)) !== null) {
    const dayNum   = parseInt(dm[1]);
    const shiftBlk = dm[2].trim();
    if (!shiftBlk) { result.days[dayNum] = { working: false, shifts: [] }; continue; }
    const shifts = [];
    const shiftRe = /\(s\|(\d{2}:\d{2})\|f\|(\d{2}:\d{2})\)/g;
    let sm;
    while ((sm = shiftRe.exec(shiftBlk)) !== null) shifts.push({ from: sm[1], to: sm[2] });
    result.days[dayNum] = { working: shifts.length > 0, shifts };
  }
  return result;
}

export function parseCalendarExceptions(clndrData) {
  if (!clndrData) return [];
  const out = [];

  // XML format (P6 v22.12+): <exception date="YYYY-MM-DD" type="0"/>
  // type=0 = non-working, type=1 = working exception
  if (clndrData.includes('<exception') || clndrData.includes('<exceptions>')) {
    const re = /<exception date="([^"]+)" type="(\d)"/g;
    let m;
    while ((m = re.exec(clndrData)) !== null) {
      const parts = m[1].split('-');
      if (parts.length === 3) {
        const dt = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        out.push({ date: dt, isWorking: m[2] === '1' });
      }
    }
    return out;
  }

  // Legacy parenthesis format
  const re  = /\(0\|\|\d+\(d\|(\d+)\)\(([\s\S]*?)\)\)/g;
  let m;
  while ((m = re.exec(clndrData)) !== null) {
    out.push({ date: oleToDate(parseInt(m[1])), isWorking: m[2].trim().includes('(s|') });
  }
  return out;
}

export function groupExceptionRanges(exceptions) {
  const nw = exceptions.filter(e => !e.isWorking).sort((a, b) => a.date - b.date);
  if (!nw.length) return [];
  const ranges = [];
  let s = nw[0].date, e = nw[0].date;
  for (let i = 1; i < nw.length; i++) {
    if ((nw[i].date - e) / 86400000 <= 1.5) e = nw[i].date;
    else { ranges.push({ from: new Date(s), to: new Date(e) }); s = nw[i].date; e = nw[i].date; }
  }
  ranges.push({ from: new Date(s), to: new Date(e) });
  ranges.forEach(r => { r.from.setHours(0, 0, 0, 0); r.to.setHours(23, 59, 0, 0); });
  return ranges;
}

/**
 * Build P6 clndr_data string from MSP calendar object.
 * 0x7F (char 127) is the required P6 field delimiter.
 */
export function buildClndrData(cal) {
  const D = String.fromCharCode(127) + String.fromCharCode(127);
  let data = '(0||CalendarData()(' + D + '(0||DaysOfWeek()(' + D;
  for (let d = 1; d <= 7; d++) {
    const wd = cal.weekDays.find(w => w.dayType === d);
    if (wd && wd.working && wd.times.length) {
      data += '(0||' + d + '()(';
      wd.times.forEach((t, i) => {
        data += '(0||' + i + '(s|' + (t.from || '08:00').substring(0, 5)
                                + '|f|' + (t.to   || '17:00').substring(0, 5) + ')())';
      });
      data += '))' + D;
    } else {
      data += '(0||' + d + '()())' + D;
    }
  }
  data += '))' + D + '(0||VIEW(ShowTotal|Y)())' + D;

  if (cal.exceptions && cal.exceptions.length) {
    data += '(0||Exceptions()(' + D;
    let idx = 0;
    cal.exceptions.forEach(exc => {
      if (exc.dayWorking) return;
      const from = parseMSPDate(exc.from);
      const to   = parseMSPDate(exc.to);
      if (!from) return;
      const cur = new Date(from), end = to || from;
      while (cur <= end) {
        data += '(0||' + idx + '(d|' + dateToOle(cur) + ')())' + D;
        idx++;
        cur.setDate(cur.getDate() + 1);
      }
    });
    data += '))' + D;
  }
  data += '))';
  return data;
}

export function estimateDayHours(cal) {
  for (let i = 0; i < cal.weekDays.length; i++) {
    const wd = cal.weekDays[i];
    if (wd.working && wd.times.length) {
      let mins = 0;
      wd.times.forEach(t => {
        const p = s => { const a = s.split(':'); return parseInt(a[0]) * 60 + (parseInt(a[1]) || 0); };
        if (t.from && t.to) mins += p(t.to) - p(t.from);
      });
      if (mins > 0) return Math.round(mins / 60);
    }
  }
  return 8;
}

export function estimateWeekHours(cal, dayHrs) {
  const wDays = cal.weekDays.filter(w => w.dayType >= 1 && w.dayType <= 7 && w.working).length;
  return (wDays || 5) * dayHrs;
}

export function resolveCalendarNames(calIds, calMap) {
  const nameMap = {}, used = {};
  calIds.forEach(cid => {
    const cal = calMap[cid];
    if (!cal) return;
    let base = sanitiseCDATA(cal.clndr_name);
    if (used[base]) {
      let suf = 2;
      while (used[base + ' (' + suf + ')']) suf++;
      base = base + ' (' + suf + ')';
    }
    used[base] = true;
    nameMap[cid] = base;
  });
  return nameMap;
}

// ── XER → MSP XML Converter ───────────────────────────────────────────────────

export function convertXERtoMSP(parsedData, origFilename) {
  const d       = parsedData;
  const project = d.tables.PROJECT.rows[0];
  const projId  = project.proj_id;
  const cals    = (d.tables.CALENDAR || { rows: [] }).rows;
  const wbsRows = (d.tables.PROJWBS  || { rows: [] }).rows;
  const allTasks= (d.tables.TASK     || { rows: [] }).rows;
  const preds   = (d.tables.TASKPRED || { rows: [] }).rows;

  const tasks   = allTasks.filter(t => t.proj_id === projId && t.task_type !== 'TT_WBS');
  const skipped = allTasks.filter(t => t.proj_id === projId && t.task_type === 'TT_WBS');

  // Calendar usage — dominant calendar becomes project default
  const calUsage = {};
  tasks.forEach(t => { if (t.clndr_id) calUsage[t.clndr_id] = (calUsage[t.clndr_id] || 0) + 1; });
  const calIds     = Object.keys(calUsage).sort((a, b) => calUsage[b] - calUsage[a]);
  const calUidMap  = {};
  calIds.forEach((cid, i) => { calUidMap[cid] = i + 1; });
  const dominantCalId = calIds[0] || '';
  const calMap        = {};
  cals.forEach(c => { calMap[c.clndr_id] = c; });
  const domCal        = calMap[dominantCalId] || cals[0] || {};
  const minsPerDay    = (parseInt(domCal.day_hr_cnt)  || 8)  * 60;
  const minsPerWeek   = (parseInt(domCal.week_hr_cnt) || 40) * 60;

  // WBS map
  const wbsMap = {};
  wbsRows.forEach(w => { wbsMap[w.wbs_id] = w; });

  // Build WBS tree
  const projWbs    = wbsRows.filter(w => w.proj_id === projId);
  const wbsChildren = {};
  let rootWbs = null;

  // Root detection — two strategies:
  //   1. proj_node_flag === 'Y'  (standard P6 full export)
  //   2. empty/absent parent_wbs_id (simplified P6 exports e.g. v22.12)
  // Strategy 1 takes priority; strategy 2 is the fallback.
  projWbs.forEach(w => {
    if (w.proj_node_flag === 'Y') { rootWbs = w; return; }
    const pid = w.parent_wbs_id || '';
    if (!wbsChildren[pid]) wbsChildren[pid] = [];
    wbsChildren[pid].push(w);
  });
  // Fallback: if no proj_node_flag found, root = the row with no parent
  if (!rootWbs) {
    rootWbs = projWbs.find(w => !w.parent_wbs_id || w.parent_wbs_id.trim() === '') || null;
    // Re-build wbsChildren excluding the root node
    if (rootWbs) {
      Object.keys(wbsChildren).forEach(k => delete wbsChildren[k]);
      projWbs.forEach(w => {
        if (w.wbs_id === rootWbs.wbs_id) return;
        const pid = w.parent_wbs_id || '';
        if (!wbsChildren[pid]) wbsChildren[pid] = [];
        wbsChildren[pid].push(w);
      });
    }
  }
  for (const k in wbsChildren) {
    wbsChildren[k].sort((a, b) => (parseInt(a.seq_num) || 0) - (parseInt(b.seq_num) || 0));
  }

  const tasksByWbs = {};
  tasks.forEach(t => {
    if (!tasksByWbs[t.wbs_id]) tasksByWbs[t.wbs_id] = [];
    tasksByWbs[t.wbs_id].push(t);
  });

  const orderedItems = [];
  function walkWbs(wbsId, level) {
    orderedItems.push({ type: 'wbs', data: wbsMap[wbsId], level });
    (tasksByWbs[wbsId] || []).forEach(t => orderedItems.push({ type: 'task', data: t, level: level + 1 }));
    (wbsChildren[wbsId] || []).forEach(c => walkWbs(c.wbs_id, level + 1));
  }
  if (rootWbs) walkWbs(rootWbs.wbs_id, 0);

  // Pre-assign UIDs
  let uidCtr = 1;
  const taskUidMap = {}, wbsUidMap = {};
  orderedItems.forEach(item => {
    if (item.type === 'wbs') wbsUidMap[item.data.wbs_id]  = uidCtr++;
    else                     taskUidMap[item.data.task_id] = uidCtr++;
  });

  // Predecessors indexed by task_id
  const predsByTask = {};
  preds.forEach(p => {
    if (p.proj_id !== projId) return;
    if (!predsByTask[p.task_id]) predsByTask[p.task_id] = [];
    predsByTask[p.task_id].push(p);
  });

  // Selective SNET anchoring — only where MSP engine diverges from P6
  const needsSnetAnchor = {};
  tasks.filter(t => t.task_type !== 'TT_WBS').forEach(t => {
    const tid    = t.task_id;
    const tpreds = predsByTask[tid] || [];
    if (tpreds.length === 0)                                                                        { needsSnetAnchor[tid] = true; return; }
    if (tpreds.some(p => p.pred_type === 'PR_FF' || p.pred_type === 'PR_SF'))                       { needsSnetAnchor[tid] = true; }
    if ((t.cstr_type || '') === 'CS_ALAP')                                                          { needsSnetAnchor[tid] = true; }
  });

  const calNameMap = resolveCalendarNames(calIds, calMap);

  // Build XML
  const xml = [];
  xml.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  xml.push('<Project xmlns="http://schemas.microsoft.com/project">');
  xml.push(NM_CDATA_O + sanitiseCDATA(project.proj_short_name || 'P6 Export') + NM_CDATA_C);
  xml.push('<MinutesPerDay>'  + minsPerDay  + '</MinutesPerDay>');
  xml.push('<MinutesPerWeek>' + minsPerWeek + '</MinutesPerWeek>');
  xml.push('<NewTasksAreManual>0</NewTasksAreManual>');
  xml.push('<CalendarUID>' + (calUidMap[dominantCalId] || 1) + '</CalendarUID>');

  xml.push('<ExtendedAttributes>');
  xml.push('<ExtendedAttribute><FieldID>188744016</FieldID><FieldName>Text30</FieldName><Alias>' + sanitiseXMLValue('Activity ID')       + '</Alias></ExtendedAttribute>');
  xml.push('<ExtendedAttribute><FieldID>188744015</FieldID><FieldName>Text29</FieldName><Alias>' + sanitiseXMLValue('P6 Constraint Type') + '</Alias></ExtendedAttribute>');
  xml.push('<ExtendedAttribute><FieldID>188744014</FieldID><FieldName>Text28</FieldName><Alias>' + sanitiseXMLValue('P6 Constraint Date') + '</Alias></ExtendedAttribute>');
  xml.push('<ExtendedAttribute><FieldID>188744013</FieldID><FieldName>Text27</FieldName><Alias>' + sanitiseXMLValue('P6 Task Type')       + '</Alias></ExtendedAttribute>');
  xml.push('</ExtendedAttributes>');

  xml.push('<Calendars>');
  calIds.forEach(cid => {
    const cal    = calMap[cid];
    if (!cal) return;
    const dayHrs = parseInt(cal.day_hr_cnt)  || 8;
    const weekHrs= parseInt(cal.week_hr_cnt) || 40;
    const is7Day = weekHrs > 50;
    const wp     = parseCalendarWorkPattern(cal.clndr_data, is7Day, dayHrs);
    xml.push('<Calendar>');
    xml.push('<UID>' + calUidMap[cid] + '</UID>');
    xml.push(NM_CDATA_O + calNameMap[cid] + NM_CDATA_C);
    xml.push('<IsBaseCalendar>1</IsBaseCalendar>');
    xml.push('<WeekDays>');
    for (let day = 1; day <= 7; day++) {
      const dw = wp.days[day];
      xml.push('<WeekDay><DayType>' + day + '</DayType><DayWorking>' + (dw && dw.working ? '1' : '0') + '</DayWorking>');
      if (dw && dw.working && dw.shifts.length) {
        xml.push('<WorkingTimes>');
        dw.shifts.forEach(sh => { xml.push('<WorkingTime><FromTime>' + sh.from + ':00</FromTime><ToTime>' + sh.to + ':00</ToTime></WorkingTime>'); });
        xml.push('</WorkingTimes>');
      }
      xml.push('</WeekDay>');
    }
    xml.push('</WeekDays>');
    const excepts = parseCalendarExceptions(cal.clndr_data);
    if (excepts.length) {
      const ranges = groupExceptionRanges(excepts);
      xml.push('<Exceptions>');
      ranges.forEach(rng => {
        xml.push('<Exception>');
        xml.push('<EnteredByOccurrences>0</EnteredByOccurrences>');
        xml.push('<TimePeriod><FromDate>' + formatMSPDate(rng.from) + '</FromDate><ToDate>' + formatMSPDate(rng.to) + '</ToDate></TimePeriod>');
        xml.push('<Occurrences>0</Occurrences>');
        xml.push(NM_O + 'Non-Working' + NM_C);
        xml.push('<Type>1</Type><DayWorking>0</DayWorking>');
        xml.push('</Exception>');
      });
      xml.push('</Exceptions>');
    }
    xml.push('</Calendar>');
  });
  xml.push('</Calendars>');

  xml.push('<Tasks>');
  // UID 0 sentinel — MSP requires this as the first Task element.
  xml.push('<Task><UID>0</UID><ID>0</ID>' + NM_O + 'Project Summary' + NM_C +
    '<Type>1</Type><IsNull>0</IsNull><OutlineLevel>0</OutlineLevel><Priority>500</Priority>' +
    '<Milestone>0</Milestone><Summary>1</Summary><PercentComplete>0</PercentComplete>' +
    '<IsManuallyScheduled>0</IsManuallyScheduled></Task>');

  let idCtr = 1, snetCount = 0, predsConverted = 0;

  orderedItems.forEach(item => {
    const uid    = item.type === 'wbs' ? wbsUidMap[item.data.wbs_id] : taskUidMap[item.data.task_id];
    const id     = idCtr++;
    const row    = item.data;
    const isSumm = item.type === 'wbs';

    xml.push('<Task>');
    xml.push('<UID>' + uid + '</UID>');
    xml.push('<ID>' + id + '</ID>');

    if (isSumm) {
      xml.push(NM_CDATA_O + sanitiseCDATA(row.wbs_name || row.wbs_short_name || '') + NM_CDATA_C);
      xml.push('<Type>1</Type><IsNull>0</IsNull>');
      xml.push('<OutlineLevel>' + item.level + '</OutlineLevel>');
      xml.push('<Priority>500</Priority><Milestone>0</Milestone><Summary>1</Summary>');
      xml.push('<PercentComplete>0</PercentComplete>');
      xml.push('<IsManuallyScheduled>0</IsManuallyScheduled>');
    } else {
      const isMile  = row.task_type === 'TT_Mile' || row.task_type === 'TT_FinMile';
      const targHrs = parseFloat(row.target_drtn_hr_cnt) || 0;
      const remHrs  = parseFloat(row.remain_drtn_hr_cnt) || 0;
      const actHrs  = Math.max(0, targHrs - remHrs);
      const pct     = parseInt(row.phys_complete_pct) || 0;
      const status  = row.status_code || '';

      let startDt  = adjustStart(parseP6Date(row.early_start_date)  || parseP6Date(row.target_start_date));
      let finishDt = adjustFinish(parseP6Date(row.early_end_date)   || parseP6Date(row.target_end_date));
      let actSD    = adjustStart(parseP6Date(row.act_start_date));
      let actFD    = adjustFinish(parseP6Date(row.act_end_date));

      if ((status === 'TK_Complete' || pct >= 100) && !actFD) {
        actFD = isMile ? (actSD ? new Date(actSD.getTime()) : null) : (finishDt ? new Date(finishDt.getTime()) : null);
      }

      xml.push(NM_CDATA_O + sanitiseCDATA(row.task_name || '') + NM_CDATA_C);
      xml.push('<Type>0</Type><IsNull>0</IsNull>');
      xml.push('<OutlineLevel>' + item.level + '</OutlineLevel>');
      xml.push('<Priority>500</Priority>');
      if (startDt)  xml.push('<Start>'  + formatMSPDate(startDt)  + '</Start>');
      if (finishDt) xml.push('<Finish>' + formatMSPDate(finishDt) + '</Finish>');
      xml.push('<Duration>PT' + Math.round(targHrs) + 'H0M0S</Duration>');
      xml.push('<DurationFormat>9</DurationFormat>');
      xml.push('<Work>PT0H0M0S</Work><EffortDriven>0</EffortDriven>');
      xml.push('<Milestone>' + (isMile ? '1' : '0') + '</Milestone>');
      xml.push('<Summary>0</Summary>');
      xml.push('<PercentComplete>' + pct + '</PercentComplete>');
      if (actSD) xml.push('<ActualStart>'  + formatMSPDate(actSD) + '</ActualStart>');
      if (actFD) xml.push('<ActualFinish>' + formatMSPDate(actFD) + '</ActualFinish>');
      xml.push('<ActualDuration>PT'    + Math.round(actHrs) + 'H0M0S</ActualDuration>');
      xml.push('<RemainingDuration>PT' + Math.round(remHrs) + 'H0M0S</RemainingDuration>');

      // Constraint mapping
      const cstr = (row.cstr_type || '').trim();
      let mspC   = CSTR_P6_TO_MSP[cstr];
      if (mspC === undefined) mspC = -1;
      let cstrDate = '';
      if (mspC === -1) {
        if (needsSnetAnchor[row.task_id] && startDt) { mspC = 4; cstrDate = formatMSPDate(startDt); snetCount++; }
      } else if (mspC > 0) {
        const cd = parseP6Date(row.cstr_date);
        cstrDate = cd ? formatMSPDate(adjustStart(cd)) : (startDt ? formatMSPDate(startDt) : '');
      }
      if (mspC >= 0) {
        xml.push('<ConstraintType>' + mspC + '</ConstraintType>');
        if (cstrDate) xml.push('<ConstraintDate>' + cstrDate + '</ConstraintDate>');
      }

      if (row.clndr_id && calUidMap[row.clndr_id]) xml.push('<CalendarUID>' + calUidMap[row.clndr_id] + '</CalendarUID>');
      xml.push('<IgnoreResourceCalendar>1</IgnoreResourceCalendar>');
      xml.push('<IsManuallyScheduled>0</IsManuallyScheduled>');

      if (row.task_code)    xml.push('<ExtendedAttribute><FieldID>188744016</FieldID><Value>' + sanitiseXMLValue(row.task_code) + '</Value></ExtendedAttribute>');
      const origCstrType = (row.cstr_type || '').trim();
      const origCstrDate = (row.cstr_date || '').trim();
      const origTaskType = (row.task_type || '').trim();
      if (origCstrType) xml.push('<ExtendedAttribute><FieldID>188744015</FieldID><Value>' + sanitiseXMLValue(origCstrType) + '</Value></ExtendedAttribute>');
      if (origCstrDate) xml.push('<ExtendedAttribute><FieldID>188744014</FieldID><Value>' + sanitiseXMLValue(origCstrDate) + '</Value></ExtendedAttribute>');
      if (origTaskType) xml.push('<ExtendedAttribute><FieldID>188744013</FieldID><Value>' + sanitiseXMLValue(origTaskType) + '</Value></ExtendedAttribute>');

      (predsByTask[row.task_id] || []).forEach(pred => {
        const puid  = taskUidMap[pred.pred_task_id];
        if (!puid) return;
        const rtype = REL_P6_TO_MSP[pred.pred_type];
        if (rtype === undefined) return;
        xml.push('<PredecessorLink>');
        xml.push('<PredecessorUID>' + puid + '</PredecessorUID>');
        xml.push('<Type>' + rtype + '</Type>');
        xml.push('<LinkLag>' + Math.round((parseFloat(pred.lag_hr_cnt) || 0) * 600) + '</LinkLag>');
        xml.push('<LagFormat>7</LagFormat>');
        xml.push('</PredecessorLink>');
        predsConverted++;
      });
    }
    xml.push('</Task>');
  });

  xml.push('</Tasks>');
  xml.push('</Project>');

  const blob     = new Blob([xml.join('\n')], { type: 'application/xml' });
  const filename = origFilename.replace(/\.[^.]+$/, '') + '_converted.xml';
  const detailCt = orderedItems.filter(i => i.type === 'task').length;

  return {
    blob, filename,
    summary: {
      'Activities converted':       detailCt,
      'WBS bands (summary)':        orderedItems.filter(i => i.type === 'wbs').length,
      'TT_WBS skipped':             skipped.length,
      'Calendars':                  calIds.length,
      'Relationships':              predsConverted,
      'SNET anchors (FF/SF risk)':  snetCount,
    },
  };
}

// ── MSP XML → XER Converter ───────────────────────────────────────────────────

export function convertMSPtoXER(parsedData, origFilename) {
  const d          = parsedData;
  const allTasks   = d.tasks || [];
  const baseCals   = (d.calendars || []).filter(c => !c._isResource);
  const rsrcDropped= (d.calendars || []).filter(c =>  c._isResource).length;
  const summaries  = allTasks.filter(t => t.summary && t.uid !== 0);
  const detail     = allTasks.filter(t => !t.summary && t.uid !== 0);

  const projName = sanitiseBytesToAscii(d.project.name || 'Converted Project');

  // Calendar mapping
  let calIdCtr = 200;
  const calIdMap = {};
  baseCals.forEach(c => { calIdMap[c.uid] = calIdCtr++; });
  const defaultClndrId = baseCals.length ? calIdMap[baseCals[0].uid] : 200;

  // WBS reconstruction from MSP summary tasks
  let wbsIdCtr = 100, taskIdCtr = 1000, predIdCtr = 5000;
  const wbsRows = [], wbsByUid = {};
  const rootWbsId = wbsIdCtr++;
  wbsRows.push([rootWbsId, '1', '', '1', '1', 'Y', 'N', '',
    sanitiseBytesToAscii(projName.substring(0, 40)),
    sanitiseBytesToAscii(projName),
    '', '', '0', '0', '0', '0', '0', '', '0', '', '', 'EC_PctComp', 'EE_PF_at_1', generateGuidBase64(), '', '']);

  const sorted = allTasks.filter(t => t.uid !== 0).sort((a, b) => a.id - b.id);
  const parentStack = [{ uid: -1, wbsId: rootWbsId, level: 0 }];
  let seqNum = 0;

  sorted.forEach(t => {
    if (!t.summary) return;
    while (parentStack.length > 1 && parentStack[parentStack.length - 1].level >= t.outlineLevel) parentStack.pop();
    const parentWbsId = parentStack[parentStack.length - 1].wbsId;
    const wid = wbsIdCtr++;
    wbsByUid[t.uid] = wid;
    seqNum++;
    wbsRows.push([wid, '1', '', String(seqNum), '1', 'N', 'N', '',
      sanitiseBytesToAscii((t.name || 'WBS').substring(0, 40)),
      sanitiseBytesToAscii(t.name || 'WBS'),
      '', String(parentWbsId), '0', '0', '0', '0', '0', '', '0', '', '', 'EC_PctComp', 'EE_PF_at_1', generateGuidBase64(), '', '']);
    parentStack.push({ uid: t.uid, wbsId: wid, level: t.outlineLevel });
  });

  function getParentWbs(task) {
    const idx = sorted.indexOf(task);
    for (let i = idx - 1; i >= 0; i--) {
      if (sorted[i].summary && sorted[i].outlineLevel < task.outlineLevel)
        return wbsByUid[sorted[i].uid] || rootWbsId;
    }
    return rootWbsId;
  }

  const hasText30 = detail.some(t => t.extendedAttributes['188744016']);

  const TASK_FIELDS = [
    'task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct',
    'rev_fdbk_flag', 'est_wt', 'lock_plan_flag', 'auto_compute_act_flag',
    'complete_pct_type', 'task_type', 'duration_type', 'status_code', 'task_code', 'task_name',
    'rsrc_id', 'total_float_hr_cnt', 'free_float_hr_cnt', 'remain_drtn_hr_cnt', 'act_work_qty',
    'remain_work_qty', 'target_work_qty', 'target_drtn_hr_cnt', 'target_equip_qty', 'act_equip_qty',
    'remain_equip_qty', 'cstr_date', 'act_start_date', 'act_end_date', 'late_start_date', 'late_end_date',
    'expect_end_date', 'early_start_date', 'early_end_date', 'restart_date', 'reend_date',
    'target_start_date', 'target_end_date', 'rem_late_start_date', 'rem_late_end_date', 'cstr_type',
    'priority_type', 'suspend_date', 'resume_date', 'float_path', 'float_path_order', 'guid', 'tmpl_guid',
    'cstr_date2', 'cstr_type2', 'driving_path_flag', 'act_this_per_work_qty', 'act_this_per_equip_qty',
    'external_early_start_date', 'external_late_end_date', 'create_date', 'update_date',
    'create_user', 'update_user', 'location_id', 'crt_path_num',
  ];

  const taskRows = [], taskIdByUid = {};
  let earliest = null, latest = null;
  const now = formatP6Date(new Date());

  detail.forEach(t => {
    const tid   = taskIdCtr++;
    taskIdByUid[t.uid] = tid;
    const wbsId = getParentWbs(t);
    const isMile= t.milestone || parseISODuration(t.duration) === 0;
    const durHrs= parseISODuration(t.duration);
    const pct   = t.pctComplete || 0;

    // Task type — restore from Text27 passport if present
    const p6TaskType = t.extendedAttributes['188744013'] || '';
    const ttype = p6TaskType ? sanitiseBytesToAscii(p6TaskType) : (isMile ? 'TT_FinMile' : 'TT_Task');

    let scode = 'TK_NotStart';
    if (pct >= 100 && t.actualFinish) scode = 'TK_Complete';
    else if (pct > 0 || t.actualStart) scode = 'TK_Active';

    const tcode = hasText30 && t.extendedAttributes['188744016']
      ? t.extendedAttributes['188744016']
      : sanitiseBytesToAscii(projName).replace(/[^A-Za-z0-9]/g, '').substring(0, 8) + '_' + t.uid;

    const sd = parseMSPDate(t.start), fd = parseMSPDate(t.finish);
    const asd = parseMSPDate(t.actualStart), afd = parseMSPDate(t.actualFinish);
    if (sd && (!earliest || sd < earliest)) earliest = sd;
    if (fd && (!latest   || fd > latest))   latest   = fd;

    const remDur = isMile ? 0 : (scode === 'TK_Complete' ? 0 : durHrs * (1 - pct / 100));

    // Constraint mapping — two-tier logic
    const p6CstrType = t.extendedAttributes['188744015'] || '';
    const p6CstrDate = t.extendedAttributes['188744014'] || '';
    let ctype = '', cdate = '';

    if (p6CstrType) {
      ctype = sanitiseBytesToAscii(p6CstrType);
      cdate = p6CstrDate ? sanitiseBytesToAscii(p6CstrDate) : '';
    } else {
      ctype = CSTR_MSP_TO_P6[t.constraintType] || '';
      if (ctype && t.constraintDate) {
        const cd2 = parseMSPDate(t.constraintDate);
        if (cd2) cdate = formatP6Date(cd2);
      }
    }

    const clndrId = (t.calendarUID > 0 && calIdMap[t.calendarUID]) ? calIdMap[t.calendarUID] : defaultClndrId;
    const earlyS  = sd ? formatP6Date(sd) : '';
    const earlyF  = fd ? formatP6Date(fd) : '';

    const row = {
      task_id: String(tid), proj_id: '1', wbs_id: String(wbsId), clndr_id: String(clndrId),
      phys_complete_pct: String(pct), rev_fdbk_flag: 'N', est_wt: '1',
      lock_plan_flag: 'N', auto_compute_act_flag: 'N', complete_pct_type: 'CP_Phys',
      task_type: ttype, duration_type: 'DT_FixedDUR2', status_code: scode,
      task_code: sanitiseBytesToAscii(tcode), task_name: sanitiseBytesToAscii(t.name || ''), rsrc_id: '',
      total_float_hr_cnt: '0', free_float_hr_cnt: '0',
      remain_drtn_hr_cnt: String(Math.round(remDur)),
      act_work_qty: '0', remain_work_qty: '0', target_work_qty: '0',
      target_drtn_hr_cnt: String(Math.round(isMile ? 0 : durHrs)),
      target_equip_qty: '0', act_equip_qty: '0', remain_equip_qty: '0',
      cstr_date: cdate,
      act_start_date: asd ? formatP6Date(asd) : '', act_end_date: afd ? formatP6Date(afd) : '',
      late_start_date: earlyS, late_end_date: earlyF, expect_end_date: '',
      early_start_date: earlyS, early_end_date: earlyF,
      restart_date: asd ? formatP6Date(asd) : earlyS, reend_date: afd ? formatP6Date(afd) : earlyF,
      target_start_date: earlyS, target_end_date: earlyF,
      rem_late_start_date: earlyS, rem_late_end_date: earlyF,
      cstr_type: ctype, priority_type: 'PT_Normal',
      suspend_date: '', resume_date: '', float_path: '', float_path_order: '',
      guid: generateGuidBase64(), tmpl_guid: '',
      cstr_date2: '', cstr_type2: '', driving_path_flag: 'N',
      act_this_per_work_qty: '0', act_this_per_equip_qty: '0',
      external_early_start_date: '', external_late_end_date: '',
      create_date: now, update_date: now, create_user: 'ADMIN', update_user: 'ADMIN',
      location_id: '', crt_path_num: '',
    };
    taskRows.push(row);
  });

  // Predecessor rows
  const predRows = [];
  let predsConverted = 0;
  detail.forEach(t => {
    const tid = taskIdByUid[t.uid];
    if (!tid) return;
    t.predecessors.forEach(pred => {
      const ptid  = taskIdByUid[pred.uid];
      if (!ptid) return;
      const ptype = REL_MSP_TO_P6[pred.type];
      if (!ptype) return;
      predRows.push([String(predIdCtr++), String(tid), String(ptid), '1', '1', ptype,
        String(Math.round(pred.lag / 600)), '', '', '', '']);
      predsConverted++;
    });
  });

  // Calendar rows
  const calRows = [];
  baseCals.forEach(cal => {
    const xid    = calIdMap[cal.uid];
    const clndr  = buildClndrData(cal);
    const dayHrs = estimateDayHours(cal);
    const weekHrs= estimateWeekHours(cal, dayHrs);
    calRows.push([String(xid), 'N', sanitiseBytesToAscii(cal.name || 'Standard'), '', '',
      formatP6Date(new Date()), 'CA_Base', String(dayHrs), String(weekHrs),
      String(Math.round(weekHrs * 4.33)), String(weekHrs * 52), 'N', clndr]);
  });

  const planStart  = earliest || new Date();
  const planEnd    = latest   || new Date();
  const lastRecalc = parseMSPDate(d.project.statusDate) || new Date();
  const today      = new Date();
  const todayS     = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  const lines = [];
  lines.push('ERMHDR\t23.12\t' + todayS + '\tProject\tADMIN\tADMIN\tdbxDatabaseNoName\tProject Management\tUSD');

  lines.push('%T\tCURRTYPE');
  lines.push('%F\tcurr_id\tdecimal_digit_cnt\tcurr_symbol\tdecimal_symbol\tdigit_group_symbol\tpos_curr_fmt_type\tneg_curr_fmt_type\tcurr_type\tcurr_short_name\tgroup_digit_cnt\tbase_exch_rate');
  lines.push('%R\t1\t2\t$\t.\t,\t#1.1\t(#1.1)\tAustralian Dollar\tAUD\t3\t1');

  lines.push('%T\tPROJECT');
  lines.push('%F\tproj_id\tfy_start_month_num\trsrc_self_add_flag\tallow_complete_flag\trsrc_multi_assign_flag\tcheckout_flag\tproject_flag\tstep_complete_flag\tcost_qty_recalc_flag\tbatch_sum_flag\tname_sep_char\tdef_complete_pct_type\tproj_short_name\tacct_id\torig_proj_id\tsource_proj_id\tbase_type_id\tclndr_id\tsum_base_proj_id\ttask_code_base\ttask_code_step\tpriority_num\twbs_max_sum_level\tstrgy_priority_num\tlast_checksum\tcritical_drtn_hr_cnt\tdef_cost_per_qty\tlast_recalc_date\tplan_start_date\tplan_end_date\tscd_end_date\tadd_date\tlast_tasksum_date\tfcst_start_date\tdef_duration_type\ttask_code_prefix\tguid\tdef_qty_type\tadd_by_name\tweb_local_root_path\tproj_url\tdef_rate_type\tadd_act_remain_flag\tact_this_per_link_flag\tdef_task_type\tact_pct_link_flag\tcritical_path_type\ttask_code_prefix_flag\tdef_rollup_dates_flag\tuse_project_baseline_flag\trem_target_link_flag\treset_planned_flag\tallow_neg_act_flag\tsum_assign_level\tlast_fin_dates_id\tfintmpl_id\tlast_baseline_update_date\tcr_external_key\tapply_actuals_date\tlocation_id\tlast_schedule_date\tloaded_scope_level\texport_flag\tnew_fin_dates_id\tbaselines_to_export\tbaseline_names_to_export\tnext_data_date\tclose_period_flag\tsum_refresh_date\ttrsrcsum_loaded\tsumtask_loaded');
  lines.push('%R\t1\t1\tY\tY\tY\tN\tY\tN\tN\tY\t.\tCP_Drtn\t' + sanitiseBytesToAscii(projName) + '\t\t\t\t\t' + String(defaultClndrId) + '\t\t1000\t10\t100\t2\t500\t\t40\t0\t' + formatP6Date(lastRecalc) + '\t' + formatP6Date(planStart) + '\t' + formatP6Date(planEnd) + '\t' + formatP6Date(planEnd) + '\t' + formatP6Date(today) + '\t\t\tDT_FixedDUR2\t\t' + generateGuidBase64() + '\tQT_Hour\tADMIN\t\t\tCOST_PER_QTY\tN\tY\tTT_Task\tN\tCT_TotFloat\tY\tY\tY\tY\tN\tN\tSL_Taskrsrc\t\t\t\t\t\t\t\t7\tY\t\t\t\t\t\t1899-12-30 00:00\t\t');

  lines.push('%T\tCALENDAR');
  lines.push('%F\tclndr_id\tdefault_flag\tclndr_name\tproj_id\tbase_clndr_id\tlast_chng_date\tclndr_type\tday_hr_cnt\tweek_hr_cnt\tmonth_hr_cnt\tyear_hr_cnt\trsrc_private\tclndr_data');
  calRows.forEach(cr => lines.push('%R\t' + cr.join('\t')));

  lines.push('%T\tPROJWBS');
  lines.push('%F\twbs_id\tproj_id\tobs_id\tseq_num\test_wt\tproj_node_flag\tsum_data_flag\tstatus_code\twbs_short_name\twbs_name\tphase_id\tparent_wbs_id\tev_user_pct\tev_etc_user_value\torig_cost\tindep_remain_total_cost\tann_dscnt_rate_pct\tdscnt_period_type\tindep_remain_work_qty\tanticip_start_date\tanticip_end_date\tev_compute_type\tev_etc_compute_type\tguid\ttmpl_guid\tplan_open_state');
  wbsRows.forEach(w => lines.push('%R\t' + w.join('\t')));

  lines.push('%T\tTASK');
  lines.push('%F\t' + TASK_FIELDS.join('\t'));
  taskRows.forEach(tr => lines.push('%R\t' + TASK_FIELDS.map(f => tr[f] || '').join('\t')));

  lines.push('%T\tTASKPRED');
  lines.push('%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt\tcomments\tfloat_path\taref\tarls');
  predRows.forEach(pr => lines.push('%R\t' + pr.join('\t')));

  lines.push('%T\tSCHEDOPTIONS');
  lines.push('%F\tschedoptions_id\tproj_id\tsched_outer_depend_type\tsched_open_critical_flag\tsched_lag_early_start_flag\tsched_retained_logic\tsched_setplantoforecast\tsched_float_type\tsched_calendar_on_relationship_lag\tsched_use_expect_end_flag\tsched_use_project_end_date_for_float\tsched_level_float_thrs_cnt\tsched_level_outer_assign_flag\tsched_level_outer_assign_priority\tsched_level_over_allocation_pct\tsched_level_within_float_flag\tsched_level_keep_sched_date_flag\tsched_level_all_rsrc_flag\tsched_use_pcnt_as_actl_flag\tsched_type\tsched_calendar_type\tsched_progressed_activities\tsched_default_data_date_shift_cnt\tsched_level_priority_list\tenable_multiple_longest_path_calc');
  lines.push('%R\t1\t1\tSD_None\tN\tY\tSD_Retained\tN\tFT_TotFloat\tSC_Predecessor\tN\tN\t0\tN\t0\t0\tN\tN\tN\tN\tST_Retained\tSC_Project\tSP_ActualDates\t0\t\tN');
  lines.push('%E');

  // CRLF — some P6 versions reject LF-only
  const xerStr = lines.join('\r\n') + '\r\n';

  // Byte-by-byte copy — preserves 0x7F clndr_data delimiters intact.
  // Never use TextEncoder — it up-converts 0x7F → multi-byte.
  const bytes = new Uint8Array(xerStr.length);
  for (let i = 0; i < xerStr.length; i++) bytes[i] = xerStr.charCodeAt(i) & 0xFF;

  const blob     = new Blob([bytes], { type: 'application/octet-stream' });
  const filename = origFilename.replace(/\.[^.]+$/, '') + '_converted.xer';

  return {
    blob, filename,
    summary: {
      'Activities':             detail.length,
      'Milestones':             detail.filter(t => t.milestone).length,
      'WBS nodes':              wbsRows.length,
      'Calendars exported':     baseCals.length,
      'Resource cals dropped':  rsrcDropped,
      'Relationships':          predsConverted,
      'Activity IDs':           hasText30 ? 'Restored from Text30' : 'Generated',
    },
  };
}

/** Trigger a browser file download from a Blob */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
