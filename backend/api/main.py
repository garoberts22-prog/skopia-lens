"""
SKOPIA Lens — FastAPI Application (v1.1)

Upload a schedule file (XER or MPP), get a health report card.
Product: SKOPIA Lens — "Schedule confidence, in seconds."

v0.8: Added schedule_data block (activities, wbs_nodes, relationships, calendars).
v0.9: Fixed wbs_nodes reconstruction from wbs_path breadcrumbs.
v1.0: Added /api/mpp-to-xml (MPXJ MSPDIWriter approach — retired).
v1.1: Replaced /api/mpp-to-xml with /api/mpp-to-xer. MPP files are now
      converted entirely server-side: MPPParserAdapter → ScheduleModel →
      Python XER writer → XER bytes returned directly.
      No MSP XML intermediary, no ByteArrayOutputStream, no JVM warmup polling.
      The existing /api/analyse MPP parser is reused — same code path, proven
      to work on Render. The XER writer (_write_xer) is pure Python.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from datetime import datetime, date

from fastapi import FastAPI, UploadFile, File, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from core.models import (
    ScheduleModel, Activity, Relationship, WBSNode, Calendar,
    ActivityStatus, ActivityType, RelationshipType, ConstraintType,
)
from parsers.base import get_parser_for_file, ParseError
from parsers.xer_adapter_mpxj import XERMPXJParserAdapter
from parsers.mpp_adapter import MPPParserAdapter
from checks.engine import run_health_check, HealthReport
import logging
from api.pdf_export import router as pdf_router

app = FastAPI(
    title="SKOPIA Lens API",
    description="Upload a P6 or MS Project schedule, get an instant health report card. SKOPIA Lens — schedule confidence, in seconds.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[    
        "http://localhost:5173",
        "https://skopia-lens-frontend.onrender.com",
        "https://www.skopia.com.au",
        "https://skopia.com.au",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PARSERS = [
    XERMPXJParserAdapter(),
    MPPParserAdapter(),
]
# Register PDF export endpoint
app.include_router(pdf_router)

@app.get("/")
async def root():
    return {
        "service": "SKOPIA Lens",
        "version": "1.0.0",
        "tagline": "Schedule confidence, in seconds.",
        "supported_formats": [p.format_name for p in PARSERS],
        "supported_extensions": [ext for p in PARSERS for ext in p.supported_extensions],
    }


@app.post("/api/analyse")
async def analyse_schedule(file: UploadFile = File(...)):
    """
    Upload a schedule file and receive a health report.
    Accepts: .xer (Primavera P6), .mpp (MS Project)
    """
    filename = file.filename or "unknown"

    try:
        parser = get_parser_for_file(filename, PARSERS)
    except ParseError as e:
        raise HTTPException(status_code=400, detail={
            "error": "unsupported_format", "message": str(e), "details": e.details,
        })

    suffix = Path(filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        model  = parser.parse(tmp_path, filename=filename)
        report = run_health_check(model)
        return _serialise_report(report, model)

    except ParseError as e:
        raise HTTPException(status_code=422, detail={
            "error": "parse_error", "message": str(e),
            "format": e.format_name, "details": e.details,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": "internal_error", "message": f"Analysis failed: {str(e)}",
        })
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/api/mpp-to-xer")
async def mpp_to_xer(file: UploadFile = File(...)):
    """
    Convert a binary MS Project .mpp file directly to Primavera P6 XER format.

    Architecture (v1.1 — replaces the /api/mpp-to-xml approach):
      1. Read the .mpp via MPPParserAdapter → ScheduleModel.
         This is the same parser used by /api/analyse — proven to work on Render.
      2. Serialise the ScheduleModel to XER format using _write_xer() — a pure
         Python function, no JVM involvement, no byte conversion issues.
      3. Return XER bytes directly as text/plain for download.

    Why this is better than the old MPP→XML→client approach:
      - No MPXJ MSPDIWriter involved — eliminates the ByteArrayOutputStream/
        JPype byte[] conversion bug that caused the 0-byte responses.
      - No XML intermediary — the client never needs to parse and re-convert.
      - No JVM warmup polling — MPPParserAdapter already handles JVM startup
        correctly (same as /api/analyse).
      - Round-trip fidelity matches the XER→MSP XML path since both go through
        the same ScheduleModel normalisation layer.
    """
    filename = file.filename or "schedule.mpp"

    if not filename.lower().endswith(".mpp"):
        raise HTTPException(status_code=400, detail={
            "error": "unsupported_format",
            "message": f"Expected a .mpp file, got: {filename}",
        })

    suffix = Path(filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Reuse the existing MPP parser — same code path as /api/analyse
        parser = MPPParserAdapter()
        model  = parser.parse(tmp_path, filename=filename)
    except ParseError as e:
        raise HTTPException(status_code=422, detail={
            "error": "parse_error", "message": str(e), "details": e.details,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": "parse_error", "message": f"Failed to read MPP: {e}",
        })
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # Serialise ScheduleModel → XER (pure Python, no JVM)
    try:
        xer_bytes = _write_xer(model, filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": "serialisation_error",
            "message": f"XER serialisation failed: {e}",
        })

    stem        = Path(filename).stem
    out_filename = f"{stem}_converted.xer"

    return Response(
        content=xer_bytes,
        media_type="text/plain; charset=windows-1252",
        headers={"Content-Disposition": f'attachment; filename="{out_filename}"'},
    )


def _write_xer(model: ScheduleModel, source_filename: str = "schedule") -> bytes:
    """
    Serialise a ScheduleModel to Primavera P6 XER format (bytes, Windows-1252).

    XER is a tab-delimited text format. Each table starts with %T <TableName>,
    followed by %F <field list>, then %R <row> for each record.
    The file ends with %E.

    This function mirrors the logic in convertor.js convertMSPtoXER() but runs
    server-side in Python, operating on the ScheduleModel rather than parsed
    MSP XML. Field counts and ordering match P6 import expectations.

    Limitations (same as the client-side converter):
      - Cost data not included (no RSRC cost rates)
      - Baselines not included
      - Activity codes not included
    """
    from datetime import datetime, timezone

    now_str  = datetime.now().strftime("%Y-%m-%d %H:%M")
    proj_id  = "1"      # single-project XER always uses proj_id=1
    guid     = _xer_guid()

    # ── Date helpers ─────────────────────────────────────────────────────────
    def p6dt(dt) -> str:
        """Format a Python date/datetime as P6's 'YYYY-MM-DD HH:MM' string."""
        if dt is None:
            return ""
        if hasattr(dt, "strftime"):
            return dt.strftime("%Y-%m-%d %H:%M")
        return str(dt)

    def hrs(h) -> str:
        """Format hours as a string, defaulting to 0."""
        if h is None:
            return "0"
        return f"{float(h):.4f}"

    # ── Constraint type mapping ───────────────────────────────────────────────
    _CSTR_MAP = {
        "ALAP":                  "CS_ALAP",
        "FNLT":                  "CS_FNLT",
        "FNET":                  "CS_FNET",
        "SNLT":                  "CS_SNLT",
        "SNET":                  "CS_SNET",
        "MSO":                   "CS_MSO",
        "MFO":                   "CS_MFO",
        "NONE":                  "CS_ASAP",
        "AS_SOON_AS_POSSIBLE":   "CS_ASAP",
        "AS_LATE_AS_POSSIBLE":   "CS_ALAP",
        "START_NO_EARLIER_THAN": "CS_SNET",
        "START_NO_LATER_THAN":   "CS_SNLT",
        "FINISH_NO_EARLIER_THAN":"CS_FNET",
        "FINISH_NO_LATER_THAN":  "CS_FNLT",
        "MUST_START_ON":         "CS_MSO",
        "MUST_FINISH_ON":        "CS_MFO",
    }

    def cstr_type(ct) -> str:
        if ct is None:
            return "CS_ASAP"
        key = ct.value if hasattr(ct, "value") else str(ct)
        return _CSTR_MAP.get(key.upper(), "CS_ASAP")

    # ── Activity type mapping ─────────────────────────────────────────────────
    _ATYPE_MAP = {
        "TASK":             "TT_Task",
        "MILESTONE":        "TT_Mile",
        "START_MILESTONE":  "TT_Mile",
        "FINISH_MILESTONE": "TT_FinMile",
        "LOE":              "TT_LOE",
        "SUMMARY":          "TT_WBS",
        "WBS_SUMMARY":      "TT_WBS",
        "HAMMOCK":          "TT_Task",
    }

    def act_type(at) -> str:
        if at is None:
            return "TT_Task"
        key = at.value if hasattr(at, "value") else str(at)
        return _ATYPE_MAP.get(key.upper(), "TT_Task")

    # ── Status mapping ────────────────────────────────────────────────────────
    def task_status(act) -> str:
        if act.actual_finish:
            return "TK_Complete"
        if act.actual_start:
            return "TK_Active"
        return "TK_NotStart"

    # ── Relationship type mapping ─────────────────────────────────────────────
    _REL_MAP = {
        "FS": "PR_FS", "SS": "PR_SS", "FF": "PR_FF", "SF": "PR_SF",
    }

    def rel_type(rt) -> str:
        key = rt.value if hasattr(rt, "value") else str(rt)
        return _REL_MAP.get(key.upper(), "PR_FS")

    # ── Assign integer IDs to WBS nodes and activities ───────────────────────
    # XER requires integer PKs for relational joins.
    wbs_nodes   = list(model.wbs_nodes) if model.wbs_nodes else []
    activities  = [a for a in model.activities]
    calendars   = list(model.calendars) if model.calendars else []
    rels        = list(model.relationships) if model.relationships else []

    wbs_id_map  = {str(w.id): (i + 100) for i, w in enumerate(wbs_nodes)}
    act_id_map  = {str(a.id): (i + 1000) for i, a in enumerate(activities)}
    cal_id_map  = {str(c.id): (i + 200) for i, c in enumerate(calendars)}

    # Default calendar — first calendar, or a fallback ID
    default_cal = cal_id_map[str(calendars[0].id)] if calendars else 200

    # ── Project start/finish ──────────────────────────────────────────────────
    proj_start  = model.planned_start  or (activities[0].planned_start  if activities else None)
    proj_finish = model.planned_finish or (activities[-1].planned_finish if activities else None)

    lines = []
    lines.append("ERMHDR	19.12	2023-01-01	Project	admin	Admin				1	0.0	")

    # ── PROJECT table ─────────────────────────────────────────────────────────
    stem = Path(source_filename).stem[:40]
    lines.append("%T	PROJECT")
    lines.append("%F	proj_id	ext_proj_id	proj_short_name	clndr_id	"
                 "last_recalc_date	plan_start_date	plan_end_date	"
                 "scd_end_date	act_start_date	act_end_date	"
                 "orig_proj_id	guid	create_date	create_user	"
                 "proj_url	proj_desc")
    lines.append("%R	" + "	".join([
        proj_id, stem, stem, str(default_cal),
        now_str, p6dt(proj_start), p6dt(proj_finish),
        p6dt(proj_finish), "", "",
        "", guid, now_str, "ADMIN", "", "",
    ]))

    # ── CALENDAR table ────────────────────────────────────────────────────────
    lines.append("%T	CALENDAR")
    lines.append("%F	clndr_id	default_flag	clndr_name	proj_id	"
                 "base_clndr_id	last_chng_date	day_hr_cnt	wk_hr_cnt	"
                 "month_hr_cnt	clndr_type	clndr_data")

    # Day index: 0=Sun,1=Mon...6=Sat. ScheduleModel working_days uses 0=Mon...6=Sun.
    # Mapping: model 0→P6 2, 1→3, 2→4, 3→5, 4→6, 5→7, 6→1
    _DAY_REMAP = {0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 1}

    for cal in calendars:
        cid   = cal_id_map[str(cal.id)]
        is_df = "1" if cid == default_cal else "0"
        hpd   = cal.hours_per_day if hasattr(cal, "hours_per_day") else 8.0
        hpw   = hpd * len(cal.working_days) if cal.working_days else hpd * 5

        # Build clndr_data — P6's compact calendar encoding
        # Format: (d|WD|s|hh:mm|f|hh:mm)(d|WD|...) for each working day
        # Exceptions omitted for simplicity (holiday support is future work)
        working_p6 = sorted([_DAY_REMAP.get(d, d + 1) for d in (cal.working_days or [0,1,2,3,4])])
        day_blocks = ""
        for d in working_p6:
            day_blocks += f"(d|{d})(s|08:00)(f|{int(hpd):02d}:{int((hpd%1)*60):02d})"
        clndr_data = day_blocks if day_blocks else "(d|2)(s|08:00)(f|08:00)(d|3)(s|08:00)(f|08:00)(d|4)(s|08:00)(f|08:00)(d|5)(s|08:00)(f|08:00)(d|6)(s|08:00)(f|08:00)"

        lines.append("%R	" + "	".join([
            str(cid), is_df, cal.name or "Standard",
            proj_id, "", now_str,
            f"{hpd:.2f}", f"{hpw:.2f}", f"{hpd*20:.2f}",
            "CA_Base", clndr_data,
        ]))

    # ── PROJWBS table ─────────────────────────────────────────────────────────
    lines.append("%T	PROJWBS")
    lines.append("%F	wbs_id	proj_id	obs_id	seq_num	status_code	"
                 "wbs_short_name	wbs_name	phase_id	parent_wbs_id	"
                 "ev_user_pct	ev_etc_user_value	original_cost	"
                 "at_completion_cost	forecast_cost	indep_remain_total_cost	"
                 "ann_dscnt_rate_pct	dscnt_period_type	indep_remain_work_qty	"
                 "anticip_start_date	anticip_end_date	ev_compute_type	"
                 "ev_etc_compute_type	guid	pv_qty_sum	ac_qty_sum	"
                 "ev_qty_sum	summ_base_proj_id	path_flag	levl_code")

    for w in wbs_nodes:
        wid    = wbs_id_map[str(w.id)]
        pid    = wbs_id_map.get(str(w.parent_id), "") if w.parent_id else ""
        short  = _xer_safe((getattr(w, "short_name", None) or str(w.id))[:24])
        name   = _xer_safe(w.name or str(w.id))
        lines.append("%R	" + "	".join([
            str(wid), proj_id, "", "", "WS_Open",
            short, name, "", str(pid),
            "", "", "0", "0", "0", "0",
            "", "", "0", "", "", "EV_TL", "EV_TL",
            _xer_guid(), "0", "0", "0", "", "N", "",
        ]))

    # ── TASK table ───────────────────────────────────────────────────────────
    lines.append("%T	TASK")
    lines.append("%F	task_id	proj_id	wbs_id	clndr_id	phys_complete_pct	"
                 "rev_fdbk_flag	act_this_per_work_qty	act_ot_work_qty	"
                 "target_start_date	target_end_date	act_start_date	"
                 "act_end_date	target_dur_hr_cnt	rem_dur_hr_cnt	"
                 "act_work_qty	remain_work_qty	target_work_qty	"
                 "orig_task_id	at_compl_work_qty	name	task_type	"
                 "duration_type	status_code	task_code	drive_type	"
                 "status_reviewer	pct_complete_type	constraint_date	"
                 "actual_drtn_hr_cnt	cstr_type	priority_num	suspend_date	"
                 "resume_date	cstr_type2	cstr_date2	drtn_type	"
                 "guid	template_guid	rsrc_id")

    for act in activities:
        tid      = act_id_map[str(act.id)]
        wid      = wbs_id_map.get(str(act.wbs_id), "") if act.wbs_id else ""
        cid      = cal_id_map.get(str(act.calendar_id), str(default_cal)) if act.calendar_id else str(default_cal)
        pct      = str(int(act.percent_complete or 0))
        tstart   = p6dt(act.planned_start or act.early_start)
        tfinish  = p6dt(act.planned_finish or act.early_finish)
        astart   = p6dt(act.actual_start)
        afinish  = p6dt(act.actual_finish)
        odur     = hrs(act.original_duration_hours  or 0)
        rdur     = hrs(act.remaining_duration_hours or 0)
        cdt      = p6dt(act.constraint_date)
        atype    = act_type(act.activity_type)
        status   = task_status(act)
        ctype    = cstr_type(act.constraint_type)
        code     = _xer_safe(act.id)[:40]
        name     = _xer_safe(act.name or "")

        lines.append("%R	" + "	".join([
            str(tid), proj_id, str(wid), cid, pct,
            "N", "0", "0",
            tstart, tfinish, astart, afinish,
            odur, rdur, "0", rdur, odur,
            "", "0",
            name, atype, "DT_FixedDrtn", status, code,
            "DT_Cpm", "", "PC_TotalPct",
            cdt, "0", ctype, "500", "", "",
            "CS_ASAP", "", "DT_FixedDrtn",
            _xer_guid(), "", "",
        ]))

    # ── TASKPRED table ────────────────────────────────────────────────────────
    lines.append("%T	TASKPRED")
    lines.append("%F	task_pred_id	task_id	pred_task_id	proj_id	"
                 "pred_proj_id	pred_type	lag_hr_cnt	comments	"
                 "float_path	aref	arls")

    pred_id = 5000
    for rel in rels:
        succ_int = act_id_map.get(str(rel.successor_id))
        pred_int = act_id_map.get(str(rel.predecessor_id))
        if not succ_int or not pred_int:
            continue   # skip orphaned relationships
        lag = hrs(rel.lag_hours or 0)
        lines.append("%R	" + "	".join([
            str(pred_id), str(succ_int), str(pred_int),
            proj_id, proj_id,
            rel_type(rel.type), lag,
            "", "", "", "",
        ]))
        pred_id += 1

    # ── SCHEDOPTIONS table ───────────────────────────────────────────────────
    lines.append("%T	SCHEDOPTIONS")
    lines.append("%F	schedoptions_id	proj_id	sched_type	sched_calendar_on_relationship_lag	"
                 "sched_open_critical_flag	use_total_float_multiple_longest_path	"
                 "enable_multiple_longest_paths_generation	"
                 "number_longest_paths	sched_use_expect_end_flag	"
                 "sched_lag_early_start_flag	sched_retained_logic	"
                 "sched_setplantoforecast	sched_float_type	sched_calendar_on_relationship_lag2	"
                 "sched_progress_override")
    lines.append("%R	" + "	".join([
        "1", proj_id, "SE_SCHEDULE", "Y", "N", "N", "N",
        "1", "N", "Y", "Y", "N", "total_float", "Y", "N",
    ]))

    lines.append("%E")

    raw = "\n".join(lines) + "\n"
    return raw.encode("windows-1252", errors="replace")


def _xer_safe(s: str) -> str:
    """Strip tab and newline characters — they would break XER field parsing."""
    if not s:
        return ""
    return str(s).replace("\t", " ").replace("\n", " ").replace("\r", "")


def _xer_guid() -> str:
    """Generate a random GUID string in P6 format (no braces, uppercase)."""
    import uuid
    return str(uuid.uuid4()).upper()




# ──────────────────────────────────────────────────────────────────────────────
# Serialisation helpers
# ──────────────────────────────────────────────────────────────────────────────

def _dt_iso(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    if isinstance(val, str):
        return val
    return None


def _hours_to_days(hours: float | None) -> int | None:
    if hours is None:
        return None
    return round(hours / 8.0)


def _hours_to_days_float(hours: float | None) -> float | None:
    if hours is None:
        return None
    return round(hours / 8.0, 1)


def _status_label(status: ActivityStatus) -> str:
    return {
        ActivityStatus.NOT_STARTED: "Not Started",
        ActivityStatus.IN_PROGRESS: "In Progress",
        ActivityStatus.COMPLETED:   "Complete",
    }.get(status, "Not Started")


def _type_label(activity_type: ActivityType) -> str:
    return {
        ActivityType.TASK:             "task",
        ActivityType.MILESTONE:        "milestone",
        ActivityType.START_MILESTONE:  "milestone",
        ActivityType.FINISH_MILESTONE: "milestone",
        ActivityType.LOE:              "loe",
        ActivityType.SUMMARY:          "summary",
        ActivityType.WBS_SUMMARY:      "summary",
        ActivityType.HAMMOCK:          "task",
    }.get(activity_type, "task")


def _constraint_code(ctype: ConstraintType) -> str | None:
    if ctype in (ConstraintType.NONE, ConstraintType.AS_SOON_AS_POSSIBLE):
        return None
    return ctype.value


# ──────────────────────────────────────────────────────────────────────────────
# WBS reconstruction — v0.9
# ──────────────────────────────────────────────────────────────────────────────

def _build_wbs_nodes(model: ScheduleModel) -> list[dict]:
    """
    Build WBS node list for the frontend.

    Uses model.wbs_nodes (from the PROJWBS table) as the primary source.
    Computes display level from the parent-child chain depth, NOT from
    dot-splitting the ID — because the parser may store dot-notation IDs
    like 'RHB.1.1.1' which would give wrong levels if counted by dots.

    The project root node (the one with no parent, or whose parent is not
    in the node set) is excluded from display — it becomes the implicit root.
    Activities are children of the next level down.

    FALLBACK: if model.wbs_nodes is empty, reconstruct from wbs_path breadcrumbs.
    """

    if model.wbs_nodes:
        # Build lookup: id → node
        all_nodes = {str(w.id): w for w in model.wbs_nodes}

        # Build parent map: id → parent_id (as strings)
        parent_map = {}
        for w in model.wbs_nodes:
            wid = str(w.id)
            pid = str(w.parent_id) if w.parent_id else None
            # Only set parent if parent actually exists in the node set
            parent_map[wid] = pid if (pid and pid in all_nodes) else None

        # Find the root node(s) — nodes with no valid parent
        roots = {wid for wid, pid in parent_map.items() if pid is None}

        # Compute depth from parent chain (memoised)
        depth_cache = {}
        def get_depth(wid):
            if wid in depth_cache:
                return depth_cache[wid]
            pid = parent_map.get(wid)
            if pid is None:
                depth_cache[wid] = 1
            else:
                depth_cache[wid] = get_depth(pid) + 1
            return depth_cache[wid]

        # Compute all depths first
        for wid in all_nodes:
            get_depth(wid)

        # If there's a single root, make its children level 1 for display.
        # This removes the top-level project node from the display hierarchy.
        level_offset = 0
        if len(roots) == 1:
            root_id = next(iter(roots))
            level_offset = depth_cache[root_id]  # subtract root depth from all

        # Filter: only keep nodes with meaningful names (at least one letter).
        # The parser may expand dot-notation IDs into intermediate nodes
        # like "1", "2" that aren't real WBS packages from the PROJWBS table.
        def has_real_name(w):
            name = w.name or ""
            # A name is "real" if it contains at least one letter
            return any(c.isalpha() for c in name)

        real_nodes = {str(w.id) for w in model.wbs_nodes if has_real_name(w)}

        # Also keep the root so we can calculate depths, even though we'll exclude it later
        real_nodes |= roots

        # For nodes we're removing, reparent their children to the nearest real ancestor
        def find_real_ancestor(wid):
            """Walk up the parent chain until we find a node in real_nodes."""
            cur = parent_map.get(wid)
            while cur and cur not in real_nodes:
                cur = parent_map.get(cur)
            return cur

        # Rebuild parent map pointing only to real ancestors
        real_parent_map = {}
        for wid in real_nodes:
            pid = parent_map.get(wid)
            if pid and pid in real_nodes:
                real_parent_map[wid] = pid
            else:
                real_parent_map[wid] = find_real_ancestor(wid)

        # Recompute depths from the real parent chain
        depth_cache = {}
        def get_real_depth(wid):
            if wid in depth_cache:
                return depth_cache[wid]
            pid = real_parent_map.get(wid)
            if pid is None or pid == wid:
                depth_cache[wid] = 1
            else:
                depth_cache[wid] = get_real_depth(pid) + 1
            return depth_cache[wid]

        for wid in real_nodes:
            get_real_depth(wid)

        # No level offset — display levels match P6 actual depth.
        # Root node is L1, its children L2, etc.
        level_offset = 0

        # Find which real WBS nodes are needed (referenced by activities + ancestors)
        referenced = {str(a.wbs_id) for a in model.activities if a.wbs_id}

        # Map each activity's wbs_id to its nearest real WBS ancestor
        act_to_real_wbs = {}
        for wid in referenced:
            if wid in real_nodes:
                act_to_real_wbs[wid] = wid
            else:
                act_to_real_wbs[wid] = find_real_ancestor(wid)

        def get_real_ancestors(wid):
            result = set()
            cur = wid
            while cur and cur in real_nodes:
                result.add(cur)
                cur = real_parent_map.get(cur)
            return result

        needed = set()
        for wid in act_to_real_wbs.values():
            if wid:
                needed |= get_real_ancestors(wid)

        # Keep root in display — it is a real named WBS node (e.g. project name band)
        # needed -= roots  ← removed: was hiding top-level WBS band

        nodes = []
        for w in model.wbs_nodes:
            wid = str(w.id)
            if wid not in needed:
                continue
            raw_depth = depth_cache.get(wid, 1)
            display_level = raw_depth - level_offset
            pid = real_parent_map.get(wid)
            # Root is a valid display node — don't clear parent pointer
            # if pid in roots: pid = None  ← removed
            nodes.append({
                "id":     wid,
                "name":   w.name or wid,
                "level":  max(1, display_level),
                "parent": pid,
                "code":   getattr(w, 'short_name', None) or wid,
            })

        if nodes:
            # Return nodes + the activity-to-real-WBS mapping
            return nodes, act_to_real_wbs

    # ── Fallback: reconstruct from wbs_path breadcrumbs ─────────────────────
    path_name_map = {}
    for act in model.activities:
        if not act.wbs_id or not act.wbs_path:
            continue
        if act.wbs_path == act.wbs_id:
            continue
        path_parts = [p.strip() for p in act.wbs_path.split('/') if p.strip()]
        wbs_parts  = str(act.wbs_id).split('.')
        for i in range(min(len(wbs_parts), len(path_parts))):
            ancestor_id = '.'.join(wbs_parts[:i+1])
            if ancestor_id not in path_name_map:
                path_name_map[ancestor_id] = path_parts[i]

    node_map = {}
    for act in model.activities:
        if not act.wbs_id:
            continue
        parts = str(act.wbs_id).split('.')
        for i in range(1, len(parts) + 1):
            node_id = '.'.join(parts[:i])
            if node_id in node_map:
                continue
            parent_id = '.'.join(parts[:i-1]) if i > 1 else None
            name = path_name_map.get(node_id) or parts[i-1]
            node_map[node_id] = {
                "id":     node_id,
                "name":   name,
                "level":  i,
                "parent": parent_id,
                "code":   node_id,
            }

    # No remapping needed for fallback — activities keep their original wbs_id
    return list(node_map.values()), {}


# ──────────────────────────────────────────────────────────────────────────────
# schedule_data serialiser
# ──────────────────────────────────────────────────────────────────────────────

def _serialise_schedule_data(model: ScheduleModel) -> dict:
    """Build the schedule_data block for the API response."""

    # Build WBS nodes + activity→real_wbs mapping
    wbs_nodes, act_wbs_remap = _build_wbs_nodes(model)
    wbs_name_map = {w["id"]: w["name"] for w in wbs_nodes}
    wbs_id_set   = {w["id"] for w in wbs_nodes}

    # ── DEBUG ────────────────────────────────────────────────────────────────

    # ── Activities ──────────────────────────────────────────────────────────
    activities = []
    for a in model.activities:
        if a.is_summary:
            continue

        start  = a.planned_start or a.early_start
        finish = a.planned_finish or a.early_finish

        cal_name = None
        if a.calendar_id:
            cal_obj = model.get_calendar(a.calendar_id)
            cal_name = cal_obj.name if cal_obj else None

        is_critical = a.is_critical_source
        if not is_critical and a.total_float_hours is not None:
            is_critical = a.total_float_hours <= 0

        # Map the activity to its nearest real WBS node
        raw_wbs = str(a.wbs_id)
        real_wbs = act_wbs_remap.get(raw_wbs, raw_wbs)
        # If remapped WBS isn't in the node set, use the raw one
        if real_wbs and real_wbs not in wbs_id_set:
            real_wbs = raw_wbs

        wbs_display = wbs_name_map.get(real_wbs, a.wbs_path or raw_wbs)

        activities.append({
            "id":          a.id,
            "name":        a.name,
            "wbs":         real_wbs,
            "wbs_name":    wbs_display,   # friendly name from WBS node
            "wbs_path":    a.wbs_path,    # full breadcrumb for tooltip
            "start":       _dt_iso(start),
            "finish":      _dt_iso(finish),
            "exp_finish":  _dt_iso(getattr(a, 'exp_finish', None)),
            "base_start":  _dt_iso(a.baseline_start),
            "base_finish": _dt_iso(a.baseline_finish),
            "act_start":   _dt_iso(a.actual_start),
            "act_finish":  _dt_iso(a.actual_finish),
            "orig_dur":    _hours_to_days(a.original_duration_hours),
            "rem_dur":     _hours_to_days(a.remaining_duration_hours),
            "total_float": _hours_to_days(a.total_float_hours),
            "free_float":  _hours_to_days(a.free_float_hours),
            "pct":         a.percent_complete,
            "status":      _status_label(a.status),
            "type":        _type_label(a.activity_type),
            "cstr_type":   _constraint_code(a.constraint_type),
            "cstr_date":   _dt_iso(a.constraint_date),
            "calendar":    cal_name,
            "cal_id":      a.calendar_id,
            "critical":    is_critical,
            # ── Resources & Units ───────────────────────────────────────────
            # Set by parsers as dynamic attributes; default to None if absent.
            # Units stored as hours in the parser, converted to whole-number days
            # here for display consistency with duration columns.
            "resource_id":      getattr(a, 'resource_id',   None) or None,
            "resource_name":    getattr(a, 'resource_name', None) or None,
            "budget_units":     _hours_to_days(getattr(a, 'budget_units_hours',    None)),
            "actual_units":     _hours_to_days(getattr(a, 'actual_units_hours',    None)),
            "remaining_units":  _hours_to_days(getattr(a, 'remaining_units_hours', None)),
            "at_comp_units":    _hours_to_days(getattr(a, 'at_comp_units_hours',   None)),
            # var_budget_units computed frontend-side from budget_units - at_comp_units
        })

    # ── Relationships ────────────────────────────────────────────────────────
    relationships = [
        {
            "from_id":  r.predecessor_id,
            "to_id":    r.successor_id,
            "type":     r.type.value,
            "lag_days": _hours_to_days_float(r.lag_hours),
        }
        for r in model.relationships
    ]

    # ── Calendars ────────────────────────────────────────────────────────────
    from datetime import timedelta
    calendars = {}
    for cal in model.calendars:
        work_days = [d + 1 for d in cal.working_days]
        exceptions = {}
        for exc in cal.exceptions:
            current = exc.start_date
            while current <= exc.end_date:
                exceptions[current.isoformat()] = False
                current = current + timedelta(days=1)
        for wd in cal.work_exceptions:
            exceptions[wd.isoformat()] = True
        calendars[cal.id] = {
            "name":       cal.name,
            "work_days":  work_days,
            "exceptions": exceptions,
        }

    return {
        "project_start":  _dt_iso(model.planned_start),
        "project_finish": _dt_iso(model.planned_finish),
        "activities":     activities,
        "wbs_nodes":      wbs_nodes,
        "relationships":  relationships,
        "calendars":      calendars,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report serialiser
# ──────────────────────────────────────────────────────────────────────────────

def _serialise_report(report: HealthReport, model: ScheduleModel) -> dict:
    """Convert HealthReport + ScheduleModel to JSON-serialisable dict."""
    return {
        "project_name":          report.project_name,
        "source_format":         report.source_format,
        "source_filename":       report.source_filename,
        "data_date":             report.data_date,
        "overall_grade":         report.overall_grade,
        "overall_score":         report.overall_score,
        "summary_stats":         report.summary_stats,
        "pass_count":            report.pass_count,
        "fail_count":            report.fail_count,
        "warn_count":            report.warn_count,
        "parse_warnings":        report.parse_warnings,
        "float_histogram":       report.float_histogram,
        "network_metrics":       report.network_metrics,
        "relationship_breakdown": report.relationship_breakdown,
        "longest_path":          report.longest_path,
        "checks": [
            {
                "check_id":         c.check_id,
                "check_name":       c.check_name,
                "dcma_ref":         c.dcma_ref,
                "status":           c.status.value,
                "metric_value":     c.metric_value,
                "threshold_value":  c.threshold_value,
                "metric_label":     c.metric_label,
                "normalised_score": c.normalised_score,
                "population_count": c.population_count,
                "flagged_count":    c.flagged_count,
                "description":      c.description,
                "recommendation":   c.recommendation,
                "error_message":    c.error_message,
                "flagged_items": [
                    {
                        "activity_id":   fi.activity_id,
                        "activity_name": fi.activity_name,
                        "wbs_path":      fi.wbs_path,
                        "issue_type":    fi.issue_type,
                        "current_value": fi.current_value,
                        "threshold":     fi.threshold,
                        "severity":      fi.severity,
                        "details":       fi.details,
                    }
                    for fi in c.flagged_items
                ],
            }
            for c in report.checks
        ],
        "schedule_data": _serialise_schedule_data(model),
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
