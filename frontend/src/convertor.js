/**
 * SKOPIA Schedule Convertor — Conversion Logic (v0.6)
 *
 * Pure utility functions. No DOM references, no React, no side effects.
 * Safe to import anywhere.
 *
 * v0.6 fix (MSP→XER wbs_short_name):
 *   - Fix 6: wbs_short_name in PROJWBS now writes sequential integer code segments
 *     (1, 2, 3...) per parent level instead of the full task name.
 *     Root node wbs_short_name uses a sanitised project name abbreviation.
 *
 *     Root cause: P6 stores two separate PROJWBS fields:
 *       wbs_short_name → code segment P6 concatenates for the dotted WBS ID
 *       wbs_name       → friendly display name shown in the Gantt
 *     The previous code wrote t.name (e.g. 'Town Planning') into wbs_short_name.
 *     P6 then built paths as 'ResidentialHouseBuild.Planning.TownPlanning...'
 *     — the long WBS name string seen in the converted schedule.
 *
 *     Fix: childCounters{parentWbsId} generates sequential short codes per
 *     parent, producing 'RHB.1', 'RHB.1.1', 'RHB.1.1.1' etc. in P6.
 *     wbs_name continues to receive the full friendly name (t.name). ✓
 *     Ref: SKOPIA Lens WBS Name Fix lessons learnt document.
 *
 * v0.5 fix (production test — RHB_TEST.xer):
 *   - Fix 5: Root WBS node skipped in walkWbs() — eliminates duplicate project
 *     name in MSP Activity Name path column.
 *     The P6 root WBS (e.g. 'Residential House Build', wbs_id=100) is the project
 *     container. Emitting it as an OutlineLevel=0 summary task caused MSP to build
 *     the path as "[ProjectName] · [RootWBS] · [Child] ..." producing:
 *       "Residential House Build · Residential House Build · Planning · ..."
 *     Fix: walkWbs() now accepts an isRoot flag. When true, the root node is not
 *     emitted to orderedItems — its children are walked directly at level=1.
 *     This maps P6's WBS hierarchy to MSP OutlineLevels 1..N, with the MSP
 *     Project Summary sentinel (UID=0) acting as the implicit level-0 container.
 *     Result: "Planning · Town Planning · Planning Applications" — matching P6.
 *
 * v0.4 fixes (skill audit):
 *   - Fix 1: MSO vs SNET for FF/SF predecessor tasks.
 *     needsSnetAnchor boolean map replaced with needsMSO + needsSNET maps.
 *     FF/SF tasks now correctly write ConstraintType=2 (MSO) to pin the start
 *     date exactly and prevent MSP FF enforcement cascade. Previously all
 *     anchored tasks wrote SNET(4) regardless, allowing MSP to push tasks
 *     further than the floor on FF relationships. (Skill: Lesson 3 / Lesson 9)
 *   - Fix 2: Calendar fallback shift window derived from day_hr_cnt.
 *     Replaced hardcoded 07:00-17:00 fallback with defaultShifts(dayHrs):
 *     <=8hr split, <=10hr single, >10hr 06:00+(dayHrs). Prevents 20% duration
 *     inflation on 12-hour-calendar schedules. (Skill: Lesson 11)
 *   - Fix 3: Empty WBS nodes filtered before XML emission.
 *     wbsHasTasks() pre-computed recursively; WBS with no descendant detail
 *     tasks are skipped. Prevents MSP summary rollup contamination from
 *     childless summary tasks with bogus default dates. (Skill: Lesson 12)
 *   - Fix 4: Format A calendar parsing upgraded to paren-depth extraction.
 *     Replaced VIEW-anchored regex with whitespace-strip + paren-depth walk.
 *     Fixes silent failure on whitespace-formatted clndr_data and correctly
 *     captures all shifts in split-shift calendars. (Skill: Lesson 10)
 *
 * v0.2 additions:
 *   - Resource/assignment conversion in both directions
 *     XER→MSP: <Resources> + <Assignments> blocks (RSRC/TASKRSRC tables)
 *     MSP→XER: RSRC, RSRCRATE, TASKRSRC tables
 *   - parseMSPXML() now returns resources[] and assignments[]
 *   - parseXER() now extracts RSRC and TASKRSRC tables
 *   - Validation updated to report resource/assignment counts
 *   - Summary metrics updated in both converters
 *
 * v0.3 change:
 *   - No logic changes. Updated documentation only.
 *   - The mpp2xer direction is now handled entirely client-side:
 *       1. ConvertView POSTs the .mpp to /api/mpp-to-xml (FastAPI).
 *       2. The server uses MPXJ MSPDIWriter to return standard MSP XML bytes.
 *       3. ConvertView passes those bytes to validateMSPXML() + convertMSPtoXER()
 *          — identical to the xml2xer direction. No separate code path.
 *   - /api/mpp-to-xer and the Python _write_xer function have been removed from
 *     main.py. This module has no awareness of which direction triggered it.
 *
 * CRITICAL: The NM_* tag constants MUST be defined via string concatenation.
 * If '<Name>' appears as a raw string literal inside a script block, the HTML
 * parser consumes the tag before JS executes, leaving an empty string. The same
 * risk exists in JSX template literals. Always build via concatenation.
 * NM_CDATA_O is also used for resource <Name> elements in the MSP XML output.
 *
 * This module is 100% client-side. Conversion logic has NO interaction with
 * the FastAPI backend. The backend is only used to decode the binary .mpp
 * format — it returns MSP XML bytes, and this module converts those bytes
 * to XER using the same convertMSPtoXER() function as the xml2xer direction.
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

/**
 * Parse an ISO work-duration string (PT14H4M0S) to decimal hours.
 *
 * WHY this exists alongside parseISODuration: MSP assignment Work fields use
 * integer H and M components (PT14H4M0S = 14h 4m = 14.0667h). parseISODuration
 * above uses parseFloat on each group and works for task durations. This version
 * uses parseInt to match the H+M/60 semantics required by Skill §10.
 * Using parseFloat on M (e.g. "4" → 4.0/60 vs "04" → 4.0/60) gives the same
 * result numerically, but parseInt is explicit about intent here.
 */
export function parseWorkHrs(s) {
  if (!s || s === 'PT0H0M0S') return 0;
  const m = s.match(/PT(\d+)H(\d+)M(\d+)S/);
  if (!m) return 0;
  return parseInt(m[1]) + parseInt(m[2]) / 60 + parseInt(m[3]) / 3600;
}

/**
 * Convert decimal hours to an ISO duration string for MSP XML Work fields.
 * Output: PTxHyM0S where x and y are integers.
 * e.g. 14.0667 → PT14H4M0S
 */
export function toWork(hrs) {
  const h = Math.floor(hrs);
  let   m = Math.round((hrs - h) * 60);
  if (m === 60) { return 'PT' + (h + 1) + 'H0M0S'; }
  return 'PT' + h + 'H' + m + 'M0S';
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
 *
 * DUAL NAMESPACE: P6's built-in XML export uses namespace
 * http://schemas.microsoft.com/project/2007 while our tool generates
 * http://schemas.microsoft.com/project. getElementsByTagName() is
 * namespace-agnostic in browsers — always use it. Do NOT use
 * querySelectorAll() with element names — it fails on the /2007 namespace.
 *
 * Returns: { project, calendars[], tasks[], resources[], assignments[] }
 */
export function parseMSPXML(bytes) {
  // Diagnostic: log byte count so we can confirm data arrived intact
  console.log('[parseMSPXML] received bytes:', bytes?.byteLength ?? bytes?.length ?? 'null');
  if (!bytes || bytes.length === 0) {
    return { error: 'parseMSPXML received empty bytes — nothing to parse.' };
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  // Log first 80 chars — distinguishes real XML from error HTML/JSON
  console.log('[parseMSPXML] first 80 chars:', JSON.stringify(text.substring(0, 80)));
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) return { error: 'XML parse error: ' + err.textContent.substring(0, 200) };
  const root = doc.documentElement;
  if (root.localName !== 'Project') return { error: 'Not a valid MSP XML file — root element is <' + root.localName + '>' };

  // getElementsByTagName is namespace-agnostic — safe for both MSP namespaces
  function txt(parent, tag) {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : '';
  }

  const result = { project: {}, calendars: [], tasks: [], resources: [], assignments: [] };
  result.project.name       = txt(root, 'Name') || txt(root, 'Title') || 'Converted Project';
  result.project.startDate  = txt(root, 'StartDate');
  result.project.finishDate = txt(root, 'FinishDate');
  result.project.statusDate = txt(root, 'StatusDate');
  result.project.minPerDay  = parseInt(txt(root, 'MinutesPerDay'))  || 480;
  result.project.minPerWeek = parseInt(txt(root, 'MinutesPerWeek')) || 2400;

  // ── Calendars ────────────────────────────────────────────────────────────
  // Skip nested Calendar elements (resource calendars nest inside base ones)
  const calEls = root.getElementsByTagName('Calendar');
  for (let ci = 0; ci < calEls.length; ci++) {
    const ce = calEls[ci];
    if (ce.parentElement && ce.parentElement.localName === 'Calendar') continue;
    const cal = {
      uid: parseInt(txt(ce, 'UID')) || 0,
      name: txt(ce, 'Name'),
      isBase: txt(ce, 'IsBaseCalendar') === '1',
      baseCalendarUID: parseInt(txt(ce, 'BaseCalendarUID')) || -1,
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

  // ── Tasks ─────────────────────────────────────────────────────────────────
  // getElementsByTagName then filter by direct Tasks parent — avoids namespace
  // issues that querySelectorAll('Tasks > Task') has with the /2007 namespace.
  const allTaskEls = root.getElementsByTagName('Task');
  for (let tei = 0; tei < allTaskEls.length; tei++) {
    const te = allTaskEls[tei];
    if (!te.parentElement || te.parentElement.localName !== 'Tasks') continue;

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

  // ── Resources ─────────────────────────────────────────────────────────────
  // Parse the <Resources> block. Each <Resource> maps to an RSRC row in XER.
  const rsrcContainer = root.getElementsByTagName('Resources')[0];
  if (rsrcContainer) {
    const rsrcEls = rsrcContainer.getElementsByTagName('Resource');
    for (let ri = 0; ri < rsrcEls.length; ri++) {
      const re   = rsrcEls[ri];
      const ruid = parseInt(txt(re, 'UID'));
      if (isNaN(ruid) || ruid < 0) continue;
      result.resources.push({
        uid:         ruid,
        name:        txt(re, 'Name'),
        initials:    txt(re, 'Initials'),
        type:        parseInt(txt(re, 'Type')) || 1,   // 1=Work(Labor), 2=Material(NonLabor)
        maxUnits:    parseFloat(txt(re, 'MaxUnits')) || 1.0,
        calendarUID: parseInt(txt(re, 'CalendarUID')) || -1,
        group:       txt(re, 'Group'),
      });
    }
  }

  // ── Assignments ───────────────────────────────────────────────────────────
  // Parse the <Assignments> block. Maps to TASKRSRC rows in XER.
  // Skip entries with no ResourceUID or negative ResourceUID (budget tasks).
  const asgContainer = root.getElementsByTagName('Assignments')[0];
  if (asgContainer) {
    const asgEls = asgContainer.getElementsByTagName('Assignment');
    for (let ai = 0; ai < asgEls.length; ai++) {
      const ae   = asgEls[ai];
      const tuid = parseInt(txt(ae, 'TaskUID'));
      const ruid = parseInt(txt(ae, 'ResourceUID'));
      if (isNaN(tuid) || isNaN(ruid) || ruid < 0) continue;
      result.assignments.push({
        uid:         parseInt(txt(ae, 'UID')) || ai,
        taskUID:     tuid,
        resourceUID: ruid,
        units:       parseFloat(txt(ae, 'Units')) || 0,
        work:        parseWorkHrs(txt(ae, 'Work')),
        actualWork:  parseWorkHrs(txt(ae, 'ActualWork')),
        remainWork:  parseWorkHrs(txt(ae, 'RemainingWork')),
        start:       txt(ae, 'Start'),
        finish:      txt(ae, 'Finish'),
      });
    }
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

  // Resources and assignments — informational, not blocking
  const rsrcRows    = d.tables.RSRC     ? d.tables.RSRC.rows     : [];
  const taskRsrcRows= d.tables.TASKRSRC ? d.tables.TASKRSRC.rows : [];
  const projId      = d.tables.PROJECT.rows[0].proj_id;
  const usedRsrcIds = new Set(taskRsrcRows.filter(tr => tr.proj_id === projId).map(tr => tr.rsrc_id));
  const rsrcCount   = rsrcRows.filter(r => usedRsrcIds.has(r.rsrc_id)).length;
  const asgCount    = taskRsrcRows.filter(tr => tr.proj_id === projId).length;
  if (rsrcCount > 0 || asgCount > 0) {
    results.push({ severity: 'info', label: 'Resources', desc: `${rsrcCount} resource(s), ${asgCount} assignment(s) will be converted` });
  } else {
    results.push({ severity: 'info', label: 'Resources', desc: 'No resource assignments found — schedule-only conversion' });
  }

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

  // Resources and assignments
  const rsrcs = (d.resources || []).filter(r => r.uid >= 0);
  const asgns = (d.assignments || []);
  if (rsrcs.length > 0 || asgns.length > 0) {
    results.push({ severity: 'info', label: 'Resources', desc: `${rsrcs.length} resource(s), ${asgns.length} assignment(s) will be converted` });
  } else {
    results.push({ severity: 'info', label: 'Resources', desc: 'No resource assignments found — schedule-only conversion' });
  }

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
  // Set defaults first (overwritten if data is found).
  //
  // Fallback shifts derived from day_hr_cnt — Skill Lesson 11:
  //   <= 8hr  → split shift 08:00-12:00 + 13:00-17:00
  //   <= 10hr → single shift 07:00-17:00
  //   > 10hr  → single shift 06:00 to (06:00 + dayHrs), e.g. 12hr = 06:00-18:00
  // WARNING: hardcoding 07:00-17:00 for all dayHrs>=10 was a production bug that
  // caused 20% duration inflation on 12-hour calendars due to 10hr vs 12hr mismatch.
  function defaultShifts(hrs) {
    if (hrs <= 8)  return [{ from: '08:00', to: '12:00' }, { from: '13:00', to: '17:00' }];
    if (hrs <= 10) return [{ from: '07:00', to: '17:00' }];
    // >10hr: anchor start at 06:00, derive end from hour count
    const endH = String(6 + hrs).padStart(2, '0');
    return [{ from: '06:00', to: endH + ':00' }];
  }
  for (let d = 1; d <= 7; d++) {
    const isWorkday = is7Day ? true : (d >= 2 && d <= 6);
    result.days[d] = {
      working: isWorkday,
      shifts: isWorkday ? defaultShifts(dayHrs) : [],
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

  // ── Format A: Legacy parenthesis format — paren-depth extraction ─────────
  //
  // WHY paren-depth instead of regex: Skill Lesson 10.
  // A VIEW-anchored regex fails silently on whitespace-formatted clndr_data
  // (produced by some P6 versions). The non-greedy inner match also stops at
  // the first ')' in a day with multiple shift entries, dropping split shifts.
  // Fix: strip all whitespace, find the DaysOfWeek()( marker, then walk forward
  // counting paren depth to extract the entire content block.
  const clean = clndrData.replace(/\s/g, '');  // strip whitespace — normalise format
  const DOW_MARKER = 'DaysOfWeek()(';
  const dowStart = clean.indexOf(DOW_MARKER);
  if (dowStart === -1) return result;  // marker not found — fall back to defaults

  // Walk forward from the opening ( of the DaysOfWeek block, counting depth,
  // to find the full matching close paren.
  let pos    = dowStart + DOW_MARKER.length - 1;  // position of the outer (
  let depth  = 0;
  let dowEnd = -1;
  for (let i = pos; i < clean.length; i++) {
    if (clean[i] === '(') depth++;
    else if (clean[i] === ')') { depth--; if (depth === 0) { dowEnd = i; break; } }
  }
  if (dowEnd === -1) return result;  // malformed — fall back to defaults

  const dowBlock = clean.slice(pos + 1, dowEnd);  // content between outer parens

  // Extract each day entry: (0||N()(...shifts...))
  // Use paren-depth walk per day to capture ALL shifts (handles split shifts).
  let di = 0;
  while (di < dowBlock.length) {
    // Find next (0||N()( pattern
    const dayMarkerRe = /\(0\|(\d)\(\)\(/g;
    dayMarkerRe.lastIndex = di;
    const dm = dayMarkerRe.exec(dowBlock);
    if (!dm) break;
    const dayNum = parseInt(dm[1]);
    // Walk from the inner ( to find the matching close
    const innerStart = dm.index + dm[0].length - 1;  // position of opening ( of shifts block
    let d2 = 0, shiftEnd = -1;
    for (let i = innerStart; i < dowBlock.length; i++) {
      if (dowBlock[i] === '(') d2++;
      else if (dowBlock[i] === ')') { d2--; if (d2 === 0) { shiftEnd = i; break; } }
    }
    const shiftBlk = shiftEnd > innerStart ? dowBlock.slice(innerStart + 1, shiftEnd) : '';
    if (!shiftBlk) {
      result.days[dayNum] = { working: false, shifts: [] };
    } else {
      const shifts = [];
      const shiftRe = /\(s\|(\d{2}:\d{2})\|f\|(\d{2}:\d{2})\)/g;
      let sm;
      while ((sm = shiftRe.exec(shiftBlk)) !== null) shifts.push({ from: sm[1], to: sm[2] });
      result.days[dayNum] = { working: shifts.length > 0, shifts };
    }
    di = shiftEnd > innerStart ? shiftEnd + 1 : dayMarkerRe.lastIndex;
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

  // Pre-compute which WBS nodes have at least one descendant detail task.
  // Skill Lesson 12 / Section 2: Empty WBS nodes in MSP XML have no children
  // for the auto-scheduler to roll up from — MSP assigns arbitrary default dates
  // that contaminate parent WBS rollup. Skip them entirely.
  function wbsHasTasks(wbsId) {
    if ((tasksByWbs[wbsId] || []).length > 0) return true;
    return (wbsChildren[wbsId] || []).some(c => wbsHasTasks(c.wbs_id));
  }

  const orderedItems = [];
  let emptyWbsSkipped = 0;

  // walkWbs emits a WBS node as an MSP summary task, then recurses into children.
  // The ROOT WBS node in P6 is the project container — it corresponds to the MSP
  // Project Summary (UID 0 sentinel), NOT a separate summary task.
  //
  // WHY skip the root: If the root WBS (e.g. wbs_name='Residential House Build') is
  // emitted at OutlineLevel=0, MSP shows the Activity Name path as:
  //   "Residential House Build · Residential House Build · Planning · ..."
  //   = [project <Name>] · [root WBS task] · [child WBS] ...
  // The project name and root WBS name are the same string, producing the
  // double-name duplication seen in production testing.
  //
  // Fix: skip the root node itself, walk only its children starting at level=1.
  // This maps P6's hierarchy directly to MSP outline levels 1..N, with the
  // MSP project root (sentinel UID=0) acting as the implicit level-0 container.
  function walkWbs(wbsId, level, isRoot) {
    if (!isRoot) {
      // Non-root node: emit as MSP summary task if it has descendant tasks
      if (!wbsHasTasks(wbsId)) { emptyWbsSkipped++; return; }
      orderedItems.push({ type: 'wbs', data: wbsMap[wbsId], level });
      (tasksByWbs[wbsId] || []).forEach(t => orderedItems.push({ type: 'task', data: t, level: level + 1 }));
      (wbsChildren[wbsId] || []).forEach(c => walkWbs(c.wbs_id, level + 1, false));
    } else {
      // Root node: skip self, walk children at level=1
      // Any tasks directly under the root WBS (unusual but valid) go at level=1
      (tasksByWbs[wbsId] || []).forEach(t => orderedItems.push({ type: 'task', data: t, level: 1 }));
      (wbsChildren[wbsId] || []).forEach(c => walkWbs(c.wbs_id, 1, false));
    }
  }
  if (rootWbs) walkWbs(rootWbs.wbs_id, 0, true);

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

  // Selective SNET/MSO anchoring — only where MSP engine diverges from P6.
  //
  // WHY two maps instead of one boolean:
  //   Pure FS/SS networks: schedule identically in both engines → no anchor needed.
  //   No-predecessor tasks: engine diverges at project start → SNET floor.
  //   ALAP tasks: MSP ALAP pushes to latest possible date (different from P6) → SNET floor.
  //   FF/SF predecessors: MSP enforces FF strictly (successor finish >= pred finish),
  //     pushing the successor's start forward. SNET is a floor and cannot prevent this.
  //     MSO (Must Start On, type=2) pins the start exactly. (Skill: Lesson 3 / Lesson 9)
  //
  // Result: needsMSO[tid]  → write ConstraintType=2 (MSO)  + P6 early start
  //         needsSNET[tid] → write ConstraintType=4 (SNET) + P6 early start
  const needsMSO  = {};  // tasks with FF or SF predecessors
  const needsSNET = {};  // tasks with no preds, ALAP, or FS/SS-only that still need anchoring
  tasks.filter(t => t.task_type !== 'TT_WBS').forEach(t => {
    const tid    = t.task_id;
    const tpreds = predsByTask[tid] || [];
    const hasFFSF = tpreds.some(p => p.pred_type === 'PR_FF' || p.pred_type === 'PR_SF');

    if (hasFFSF) {
      // FF/SF preds: MSO pins the start — prevents MSP FF enforcement cascade.
      // Also covers ALAP tasks with FF/SF (compound risk).
      needsMSO[tid] = true;
    } else if (tpreds.length === 0 || (t.cstr_type || '') === 'CS_ALAP') {
      // No preds: engine diverges at project anchor date.
      // ALAP: MSP ALAP produces different date than P6.
      needsSNET[tid] = true;
    }
    // Pure FS/SS networks: no anchor required — engines agree.
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

      // Constraint mapping — selective SNET/MSO anchoring for ASAP/ALAP tasks.
      //
      // CSTR_P6_TO_MSP maps hard P6 constraints (MSO, MEO, SNET, etc.) directly.
      // ASAP and ALAP return -1 — they enter the anchoring logic:
      //   FF/SF preds → MSO (2): pins start exactly, prevents FF enforcement cascade.
      //   No preds / ALAP   → SNET (4): floor anchor for engine divergence.
      //   Pure FS/SS         → no anchor written (engines agree).
      const cstr = (row.cstr_type || '').trim();
      let mspC   = CSTR_P6_TO_MSP[cstr];
      if (mspC === undefined) mspC = -1;
      let cstrDate = '';
      if (mspC === -1) {
        // ASAP or ALAP — apply selective anchor if this task is flagged
        if (needsMSO[row.task_id] && startDt) {
          mspC = 2;   // MSO — Must Start On: hard pin for FF/SF cascade prevention
          cstrDate = formatMSPDate(startDt);
          snetCount++;
        } else if (needsSNET[row.task_id] && startDt) {
          mspC = 4;   // SNET — floor anchor for no-pred / ALAP tasks
          cstrDate = formatMSPDate(startDt);
          snetCount++;
        }
      } else if (mspC > 0) {
        // Hard P6 constraint — preserve constraint date exactly
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

  // ── Resources block ────────────────────────────────────────────────────────
  // Only export resources that have at least one assignment in this project.
  // The RSRC table is global (all enterprise resources) — filtering by proj_id
  // via TASKRSRC prevents global resource spillover into the MSP file.
  const rsrcRows     = (d.tables.RSRC     || { rows: [] }).rows;
  const taskRsrcRows = (d.tables.TASKRSRC || { rows: [] }).rows;

  // Build set of rsrc_ids actually used in this project
  const usedRsrcIds = new Set(
    taskRsrcRows
      .filter(tr => tr.proj_id === projId)
      .map(tr => tr.rsrc_id)
  );

  // UID counter continues from where task UIDs left off (uidCtr already advanced)
  // uidCtr is still live from the task loop above — we continue it here.
  const rsrcUidMap = {};
  rsrcRows.forEach(r => {
    if (!usedRsrcIds.has(r.rsrc_id)) return;
    rsrcUidMap[r.rsrc_id] = uidCtr++;   // uidCtr shared with task pass
  });

  xml.push('<Resources>');
  rsrcRows.forEach(r => {
    if (!usedRsrcIds.has(r.rsrc_id)) return;
    const ruid  = rsrcUidMap[r.rsrc_id];
    const rtype = (r.rsrc_type === 'RT_Labor') ? 1 : 2;   // 1=Work, 2=Material
    xml.push('<Resource>');
    xml.push('<UID>' + ruid + '</UID>');
    // NM_CDATA_O/C used here — resource <Name> has same HTML-parser risk as task <Name>
    xml.push(NM_CDATA_O + sanitiseCDATA(r.rsrc_name || r.rsrc_short_name || '') + NM_CDATA_C);
    xml.push('<Initials>' + sanitiseXMLValue((r.rsrc_short_name || '').substring(0, 20)) + '</Initials>');
    xml.push('<Type>' + rtype + '</Type>');
    xml.push('<MaxUnits>1</MaxUnits>');
    // Only link CalendarUID if the resource's calendar was exported as a task calendar
    if (r.clndr_id && calUidMap[r.clndr_id]) {
      xml.push('<CalendarUID>' + calUidMap[r.clndr_id] + '</CalendarUID>');
    }
    xml.push('</Resource>');
  });
  xml.push('</Resources>');

  // ── Assignments block ──────────────────────────────────────────────────────
  // Maps TASKRSRC rows to MSP Assignment elements.
  // Skip any row where task_id or rsrc_id can't be resolved — orphaned rows
  // cause MSP import errors.
  let asgUidCtr    = uidCtr;   // continues from resource UIDs
  let asgConverted = 0;

  xml.push('<Assignments>');
  taskRsrcRows.forEach(tr => {
    if (tr.proj_id !== projId) return;
    const taskUid = taskUidMap[tr.task_id];
    const rsrcUid = rsrcUidMap[tr.rsrc_id];
    if (!taskUid || !rsrcUid) return;   // skip orphans — TT_WBS or unmapped resource

    const targetQty = parseFloat(tr.target_qty)     || 0;
    const remainQty = parseFloat(tr.remain_qty)      || 0;
    const actQty    = parseFloat(tr.act_reg_qty)     || 0;
    const qtyPerHr  = parseFloat(tr.target_qty_per_hr) || 1;

    // Use actual dates if available, fall back to target dates
    const asgStartDt  = parseP6Date(tr.act_start_date)    || parseP6Date(tr.target_start_date);
    const asgFinishDt = parseP6Date(tr.act_end_date)       || parseP6Date(tr.target_end_date);
    const asgStart    = asgStartDt  ? formatMSPDate(adjustStart(asgStartDt))   : '';
    const asgFinish   = asgFinishDt ? formatMSPDate(adjustFinish(asgFinishDt)) : '';

    xml.push('<Assignment>');
    xml.push('<UID>'          + (asgUidCtr++)             + '</UID>');
    xml.push('<TaskUID>'      + taskUid                   + '</TaskUID>');
    xml.push('<ResourceUID>'  + rsrcUid                   + '</ResourceUID>');
    xml.push('<Units>'        + qtyPerHr.toFixed(6)       + '</Units>');
    xml.push('<Work>'         + toWork(targetQty)         + '</Work>');
    xml.push('<ActualWork>'   + toWork(actQty)            + '</ActualWork>');
    xml.push('<RemainingWork>'+ toWork(remainQty)         + '</RemainingWork>');
    if (asgStart)  xml.push('<Start>'  + asgStart  + '</Start>');
    if (asgFinish) xml.push('<Finish>' + asgFinish + '</Finish>');
    xml.push('<ActualCost>0</ActualCost>');
    xml.push('<OvertimeWork>PT0H0M0S</OvertimeWork>');
    xml.push('<CostRateTable>0</CostRateTable>');
    xml.push('<WorkContour>8</WorkContour>');
    xml.push('</Assignment>');
    asgConverted++;
  });
  xml.push('</Assignments>');

  xml.push('</Project>');

  const blob     = new Blob([xml.join('\n')], { type: 'application/xml' });
  const filename = origFilename.replace(/\.[^.]+$/, '') + '_converted.xml';
  const detailCt = orderedItems.filter(i => i.type === 'task').length;
  const rsrcConverted = Object.keys(rsrcUidMap).length;

  return {
    blob, filename,
    summary: {
      'Activities converted':       detailCt,
      'WBS bands (summary)':        orderedItems.filter(i => i.type === 'wbs').length,
      'TT_WBS skipped':             skipped.length,
      'Empty WBS skipped':          emptyWbsSkipped,
      'Calendars':                  calIds.length,
      'Relationships':              predsConverted,
      'Resources':                  rsrcConverted,
      'Assignments':                asgConverted,
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

  // WBS reconstruction from MSP summary tasks.
  //
  // WHY wbs_short_name must be a short sequential code, NOT t.name:
  //   P6 builds the WBS path shown in the Gantt and Activity ID column by
  //   concatenating wbs_short_name values up the parent chain with dots:
  //     root.wbs_short_name + '.' + child.wbs_short_name + '.' + ...
  //   If wbs_short_name = t.name (e.g. 'Town Planning'), P6 produces:
  //     'Residential House Build.Planning.Town Planning.Planning Applications'
  //   instead of the expected:
  //     'RHB.1.1 · Town Planning'
  //
  //   Fix: generate sequential integer codes per parent level (1, 2, 3...).
  //   wbs_name gets the full friendly display name from t.name — unchanged.
  //   Root node wbs_short_name uses the project short name (e.g. 'RHB').
  //
  //   Ref: Lessons Learnt doc — P6 stores two separate fields:
  //     wbs_short_name → code segment ('1', '1.1') — what P6 concatenates for the ID
  //     wbs_name       → friendly display name ('Planning', 'Town Planning')

  let wbsIdCtr = 100, taskIdCtr = 1000, predIdCtr = 5000;
  const wbsRows = [], wbsByUid = {};
  const rootWbsId = wbsIdCtr++;

  // Root short name: use proj_short_name from MSP <Name> if ≤10 chars and no spaces,
  // otherwise derive a sanitised uppercase abbreviation (up to 8 chars).
  const rawProjShort = sanitiseBytesToAscii(projName).replace(/[^A-Za-z0-9]/g, '').substring(0, 8).toUpperCase() || 'PRJ';
  wbsRows.push([rootWbsId, '1', '', '1', '1', 'Y', 'N', '',
    rawProjShort,                          // wbs_short_name — root code segment
    sanitiseBytesToAscii(projName),        // wbs_name — full project name
    '', '', '0', '0', '0', '0', '0', '', '0', '', '', 'EC_PctComp', 'EE_PF_at_1', generateGuidBase64(), '', '']);

  const sorted = allTasks.filter(t => t.uid !== 0).sort((a, b) => a.id - b.id);
  const parentStack = [{ uid: -1, wbsId: rootWbsId, level: 0 }];
  let seqNum = 0;

  // Per-parent child counter — generates sequential short codes (1, 2, 3...)
  // within each parent WBS node, matching P6's expected code segment format.
  const childCounters = {};   // parentWbsId → next sequential int

  sorted.forEach(t => {
    if (!t.summary) return;
    while (parentStack.length > 1 && parentStack[parentStack.length - 1].level >= t.outlineLevel) parentStack.pop();
    const parentWbsId = parentStack[parentStack.length - 1].wbsId;
    const wid = wbsIdCtr++;
    wbsByUid[t.uid] = wid;
    seqNum++;

    // Generate sequential short code for this node within its parent
    childCounters[parentWbsId] = (childCounters[parentWbsId] || 0) + 1;
    const shortCode = String(childCounters[parentWbsId]);

    wbsRows.push([wid, '1', '', String(seqNum), '1', 'N', 'N', '',
      shortCode,                                         // wbs_short_name — sequential code segment
      sanitiseBytesToAscii(t.name || 'WBS'),             // wbs_name — friendly display name
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

  // ── RSRC table ─────────────────────────────────────────────────────────────
  // One row per resource from the MSP <Resources> block.
  // rsrc_id base: 8000 to avoid collisions with calendar/task/wbs ID ranges.
  // Resource calendar mapping: MSP resource calendars (IsBaseCalendar=0) have a
  // BaseCalendarUID pointing to a real base calendar. Map through that to get
  // the XER clndr_id. If not found, fall back to defaultClndrId.
  const mspResources = d.resources || [];
  const mspAssignments = d.assignments || [];

  // Build lookup: MSP calendar UID → XER clndr_id (for base calendars only)
  // Also map resource calendars through their BaseCalendarUID to the base
  const mspCalUidToXerClndrId = {};
  baseCals.forEach(c => {
    if (calIdMap[c.uid]) mspCalUidToXerClndrId[c.uid] = calIdMap[c.uid];
  });
  // Resource calendars: find their base and map through it
  const rsrcCals = (d.calendars || []).filter(c => c._isResource);
  rsrcCals.forEach(rc => {
    const baseXerClndr = mspCalUidToXerClndrId[rc.baseCalendarUID];
    if (baseXerClndr) mspCalUidToXerClndrId[rc.uid] = baseXerClndr;
  });

  let xerRsrcIdCtr = 8000;
  const xerRsrcIdMap = {};   // MSP resource UID → XER rsrc_id
  mspResources.forEach(r => { xerRsrcIdMap[r.uid] = xerRsrcIdCtr++; });

  if (mspResources.length > 0) {
    lines.push('%T\tRSRC');
    lines.push('%F\trsrc_id\tparent_rsrc_id\tclndr_id\trole_id\t' +
      'shift_id\tuser_id\tpobs_id\tguid\trsrc_seq_num\temail_addr\t' +
      'employee_code\toffice_phone\tother_phone\trsrc_name\trsrc_short_name\t' +
      'rsrc_title_name\tdef_qty_per_hr\tcost_qty_type\tot_factor\tactive_flag\t' +
      'auto_compute_act_flag\tdef_cost_qty_link_flag\tot_flag\tcurr_id\tunit_id\t' +
      'rsrc_type\tlocation_id\trsrc_notes\tload_tasks_flag\tlevel_flag\tlast_checksum');

    mspResources.forEach(r => {
      const xid    = xerRsrcIdMap[r.uid];
      // Map resource calendar through base: resource → base UID → XER clndr_id
      const xclndr = mspCalUidToXerClndrId[r.calendarUID] || defaultClndrId;
      const rtype  = (r.type === 2) ? 'RT_NonLabor' : 'RT_Labor';
      const short  = sanitiseBytesToAscii((r.initials || r.name || '').substring(0, 20));
      const full   = sanitiseBytesToAscii(r.name || '');
      const row = [
        String(xid), '', String(xclndr), '', '', '', '',
        generateGuidBase64(), String(r.uid),
        '', '', '', '',            // email, employee_code, office_phone, other_phone
        full, short, '',           // rsrc_name, rsrc_short_name, rsrc_title_name
        '1', 'QT_Hour', '1', 'Y', // def_qty_per_hr, cost_qty_type, ot_factor, active_flag
        'N', 'N', 'N', '1', '',   // auto_compute, def_cost_link, ot_flag, curr_id, unit_id
        rtype, '', '',             // rsrc_type, location_id, rsrc_notes
        'N', 'N', '',             // load_tasks_flag, level_flag, last_checksum
      ];
      lines.push('%R\t' + row.join('\t'));
    });

    // ── RSRCRATE table ───────────────────────────────────────────────────────
    // One row per resource. All cost fields zero — cost conversion is out of scope.
    let rsrcRateId = 9000;
    lines.push('%T\tRSRCRATE');
    lines.push('%F\trsrc_rate_id\trsrc_id\tmax_qty_per_hr\tcost_per_qty\t' +
      'start_date\tshift_period_id\tcost_per_qty2\tcost_per_qty3\tcost_per_qty4\tcost_per_qty5');

    mspResources.forEach(r => {
      lines.push('%R\t' + [
        String(rsrcRateId++), String(xerRsrcIdMap[r.uid]),
        '1', '0.0000', '2000-01-01 00:00', '',
        '0.0000', '0.0000', '0.0000', '0.0000',
      ].join('\t'));
    });
  }

  // ── TASKRSRC table ──────────────────────────────────────────────────────────
  // Maps MSP assignments to P6 TASKRSRC rows. 47 fields required.
  // CRITICAL: skip any assignment where taskIdByUid[taskUID] or
  // xerRsrcIdMap[resourceUID] is undefined — orphaned rows cause P6 import failure.
  // UID=0 (sentinel) and summary tasks are not in taskIdByUid, so they skip cleanly.
  if (mspAssignments.length > 0) {
    let taskRsrcIdBase = 50000;
    lines.push('%T\tTASKRSRC');
    lines.push('%F\ttaskrsrc_id\ttask_id\tproj_id\tcost_qty_link_flag\t' +
      'role_id\tacct_id\trsrc_id\tpobs_id\tskill_level\tremain_qty\ttarget_qty\t' +
      'remain_qty_per_hr\ttarget_lag_drtn_hr_cnt\ttarget_qty_per_hr\tact_ot_qty\t' +
      'act_reg_qty\trelag_drtn_hr_cnt\tot_factor\tcost_per_qty\ttarget_cost\t' +
      'act_reg_cost\tact_ot_cost\tremain_cost\tact_start_date\tact_end_date\t' +
      'restart_date\treend_date\ttarget_start_date\ttarget_end_date\t' +
      'rem_late_start_date\trem_late_end_date\trollup_dates_flag\ttarget_crv\t' +
      'remain_crv\tactual_crv\tts_pend_act_end_flag\tguid\trate_type\t' +
      'act_this_per_cost\tact_this_per_qty\tcurv_id\trsrc_type\t' +
      'cost_per_qty_source_type\tcreate_user\tcreate_date\thas_rsrchours\ttaskrsrc_sum_id');

    mspAssignments.forEach(a => {
      const xerTaskId = taskIdByUid[a.taskUID];
      const xerRsrcId = xerRsrcIdMap[a.resourceUID];
      if (!xerTaskId || !xerRsrcId) return;   // orphan guard — skip silently

      const tq   = a.work       || 0;
      const rq   = a.remainWork || 0;
      const aq   = a.actualWork || 0;
      // Clamp units to 10 max (P6 limit) — Units=0 becomes 1 (unassigned default)
      const qph  = (a.units > 0) ? Math.min(a.units, 10) : 1;

      // Dates: use assignment start/finish directly (already MSP format strings)
      const aS = a.start  ? formatP6Date(parseMSPDate(a.start))  : '';
      const aF = a.finish ? formatP6Date(parseMSPDate(a.finish)) : '';

      // rsrc_type — look up from the resource record
      const rsrcObj = mspResources.find(r => r.uid === a.resourceUID);
      const rtype   = (rsrcObj && rsrcObj.type === 2) ? 'RT_NonLabor' : 'RT_Labor';

      const row = [
        String(taskRsrcIdBase++),  // taskrsrc_id
        String(xerTaskId),         // task_id
        '1',                       // proj_id
        'N',                       // cost_qty_link_flag
        '', '',                    // role_id, acct_id
        String(xerRsrcId),         // rsrc_id
        '', '',                    // pobs_id, skill_level
        rq.toFixed(4),             // remain_qty
        tq.toFixed(4),             // target_qty
        qph.toFixed(6),            // remain_qty_per_hr
        '0',                       // target_lag_drtn_hr_cnt
        qph.toFixed(6),            // target_qty_per_hr
        '0',                       // act_ot_qty
        aq.toFixed(4),             // act_reg_qty
        '0',                       // relag_drtn_hr_cnt
        '1',                       // ot_factor
        '0.0000',                  // cost_per_qty
        '0.0000',                  // target_cost
        '0.0000',                  // act_reg_cost
        '0.0000',                  // act_ot_cost
        '0.0000',                  // remain_cost
        aS, aF,                    // act_start_date, act_end_date
        aS, aF,                    // restart_date, reend_date
        aS, aF,                    // target_start_date, target_end_date
        aS, aF,                    // rem_late_start_date, rem_late_end_date
        'N',                       // rollup_dates_flag
        '', '', '',                // target_crv, remain_crv, actual_crv
        'N',                       // ts_pend_act_end_flag
        generateGuidBase64(),      // guid
        'RR_ON',                   // rate_type
        '0.0000',                  // act_this_per_cost
        '0',                       // act_this_per_qty
        '',                        // curv_id
        rtype,                     // rsrc_type
        'CS_Rsrc',                 // cost_per_qty_source_type
        'ADMIN',                   // create_user
        now,                       // create_date
        'N',                       // has_rsrchours
        '',                        // taskrsrc_sum_id
      ];
      lines.push('%R\t' + row.join('\t'));
    });
  }

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

  const asgConverted = mspAssignments.filter(a => taskIdByUid[a.taskUID] && xerRsrcIdMap[a.resourceUID]).length;

  return {
    blob, filename,
    summary: {
      'Activities':             detail.length,
      'Milestones':             detail.filter(t => t.milestone).length,
      'WBS nodes':              wbsRows.length,
      'Calendars exported':     baseCals.length,
      'Resource cals dropped':  rsrcDropped,
      'Relationships':          predsConverted,
      'Resources':              mspResources.length,
      'Assignments':            asgConverted,
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