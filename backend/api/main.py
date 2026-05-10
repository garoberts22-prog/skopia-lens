"""
# ╔══════════════════════════════════════════════════════╗
# ║  SKOPIA Lens — main.py  v1.3  LAZY SCHEDULE DATA    ║
# ╚══════════════════════════════════════════════════════╝
SKOPIA Lens — FastAPI Application (v1.3)

v1.3 changes (performance):
  - /api/analyse no longer includes schedule_data in its response.
    Response drops from ~500KB to ~50KB → health check view loads ~10x faster.
  - Response now includes a `session_id` UUID token.
  - GET /api/schedule-data/{session_id} returns the Gantt payload on demand.
    Called lazily by ScheduleView only when the user navigates to that tab.
  - In-memory _schedule_cache holds parsed ScheduleModel objects keyed by
    session_id. Entries expire after 10 min. Pruned on each new upload.
  - GET /health — lightweight liveness endpoint for UptimeRobot keep-warm.
"""

from __future__ import annotations

import os
import uuid
import time
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
from api.pdf_export import router as pdf_router

app = FastAPI(
    title="SKOPIA Lens API",
    description="Upload a P6 or MS Project schedule, get an instant health report card.",
    version="1.3.0",
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

app.include_router(pdf_router)


# ─────────────────────────────────────────────────────────────────────────────
# In-memory schedule cache
#
# After /api/analyse parses the file, the ScheduleModel is kept in memory
# keyed by a UUID session_id that is returned to the client.
# When the user navigates to Schedule view, the client calls
# GET /api/schedule-data/{session_id} which serialises the cached model
# into the Gantt payload — no re-parse needed.
#
# TTL: 10 minutes. Pruned on each new write (no background thread required).
# ─────────────────────────────────────────────────────────────────────────────

_schedule_cache: dict[str, dict] = {}
CACHE_TTL_SECONDS = 600  # 10 minutes


def _cache_store(model: ScheduleModel) -> str:
    """Store a parsed model. Returns the session_id token."""
    _cache_prune()
    session_id = str(uuid.uuid4())
    _schedule_cache[session_id] = {
        "model":   model,
        "expires": time.monotonic() + CACHE_TTL_SECONDS,
    }
    return session_id


def _cache_get(session_id: str) -> ScheduleModel | None:
    """Retrieve model from cache. Returns None if expired or missing."""
    entry = _schedule_cache.get(session_id)
    if not entry:
        return None
    if time.monotonic() > entry["expires"]:
        del _schedule_cache[session_id]
        return None
    return entry["model"]


def _cache_prune():
    """Evict expired entries. Called on each write."""
    now = time.monotonic()
    for sid in [s for s, e in _schedule_cache.items() if now > e["expires"]]:
        del _schedule_cache[sid]


# ─────────────────────────────────────────────────────────────────────────────
# GET /health — keep-warm ping for UptimeRobot
#
# Point UptimeRobot (free tier) at https://your-backend.onrender.com/health
# with a 5-minute check interval to prevent Render containers from sleeping.
# This eliminates the 30-60s cold-start penalty between user sessions.
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status":        "ok",
        "version":       "1.3.0",
        "cached_models": len(_schedule_cache),
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET / — service root
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service":              "SKOPIA Lens",
        "version":              "1.3.0",
        "tagline":              "Schedule confidence, in seconds.",
        "supported_formats":    [p.format_name for p in PARSERS],
        "supported_extensions": [ext for p in PARSERS for ext in p.supported_extensions],
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/analyse — health checks only (NO schedule_data)
#
# The hot path. Parses the file, runs 11 health checks, returns the report.
# Response is ~50KB instead of ~500KB. The session_id token in the response
# allows the client to fetch the Gantt payload lazily when needed.
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/analyse")
async def analyse_schedule(file: UploadFile = File(...)):
    """
    Upload a schedule file → health report card + session_id.

    schedule_data (activities/relationships/calendars) is NOT included.
    Fetch it separately via GET /api/schedule-data/{session_id} when the
    user navigates to Schedule view.
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
        model      = parser.parse(tmp_path, filename=filename)
        report     = run_health_check(model)
        session_id = _cache_store(model)
        return _serialise_report(report, session_id)

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


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/schedule-data/{session_id} — lazy Gantt payload
#
# Returns the full Gantt block from the cached ScheduleModel.
# Called by ScheduleView on first navigation to the Schedule tab.
# Returns 404 if the session has expired (> 10 min) or is invalid.
# The frontend shows a re-upload prompt on 404.
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/schedule-data/{session_id}")
async def get_schedule_data(session_id: str):
    """Return Gantt payload for a previously-analysed schedule."""
    model = _cache_get(session_id)
    if model is None:
        raise HTTPException(status_code=404, detail={
            "error":   "session_expired",
            "message": "Session not found or expired. Please re-upload your schedule.",
        })
    return _serialise_schedule_data(model)


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/mpp-to-xml (unchanged from v1.2)
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/mpp-to-xml")
async def mpp_to_xml(file: UploadFile = File(...)):
    """Convert a binary .mpp file to MSP XML. Client runs convertMSPtoXER()."""
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
        import jpype
        import mpxj as mpxj_pkg
        if not jpype.isJVMStarted():
            lib_dir = os.path.join(os.path.dirname(mpxj_pkg.__file__), "lib")
            jars = [os.path.join(lib_dir, f) for f in os.listdir(lib_dir) if f.endswith(".jar")]
            jpype.startJVM(classpath=jars) if jars else jpype.startJVM()
        import jpype.imports

        from org.mpxj.reader import UniversalProjectReader
        from org.mpxj.writer import MSPDIWriter
        from java.io import StringWriter

        reader  = UniversalProjectReader()
        project = reader.read(tmp_path)
        sw      = StringWriter()
        MSPDIWriter().write(project, sw)
        xml_str = str(sw.toString())

    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": "conversion_error",
            "message": f"MPP to XML conversion failed: {e}",
        })
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return Response(
        content=xml_str.encode("utf-8"),
        media_type="application/xml; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{Path(filename).stem}.xml"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Serialisation helpers
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# WBS reconstruction (unchanged from v1.2)
# ─────────────────────────────────────────────────────────────────────────────

def _build_wbs_nodes(model: ScheduleModel) -> tuple[list[dict], dict]:
    """Build WBS node list for the frontend Gantt."""

    if model.wbs_nodes:
        all_nodes  = {str(w.id): w for w in model.wbs_nodes}
        parent_map = {}
        for w in model.wbs_nodes:
            wid = str(w.id)
            pid = str(w.parent_id) if w.parent_id else None
            parent_map[wid] = pid if (pid and pid in all_nodes) else None

        roots = {wid for wid, pid in parent_map.items() if pid is None}

        depth_cache: dict[str, int] = {}
        def get_depth(wid: str) -> int:
            if wid in depth_cache:
                return depth_cache[wid]
            pid = parent_map.get(wid)
            depth_cache[wid] = 1 if pid is None else get_depth(pid) + 1
            return depth_cache[wid]

        for wid in all_nodes:
            get_depth(wid)

        def has_real_name(w) -> bool:
            return any(c.isalpha() for c in (w.name or ""))

        real_nodes = {str(w.id) for w in model.wbs_nodes if has_real_name(w)} | roots

        def find_real_ancestor(wid: str) -> str | None:
            cur = parent_map.get(wid)
            while cur and cur not in real_nodes:
                cur = parent_map.get(cur)
            return cur

        real_parent_map: dict[str, str | None] = {}
        for wid in real_nodes:
            pid = parent_map.get(wid)
            real_parent_map[wid] = pid if (pid and pid in real_nodes) else find_real_ancestor(wid)

        depth_cache = {}
        def get_real_depth(wid: str) -> int:
            if wid in depth_cache:
                return depth_cache[wid]
            pid = real_parent_map.get(wid)
            depth_cache[wid] = 1 if (pid is None or pid == wid) else get_real_depth(pid) + 1
            return depth_cache[wid]

        for wid in real_nodes:
            get_real_depth(wid)

        referenced = {str(a.wbs_id) for a in model.activities if a.wbs_id}

        act_to_real_wbs: dict[str, str | None] = {}
        for wid in referenced:
            act_to_real_wbs[wid] = wid if wid in real_nodes else find_real_ancestor(wid)

        def get_real_ancestors(wid: str) -> set[str]:
            result, cur = set(), wid
            while cur and cur in real_nodes:
                result.add(cur)
                cur = real_parent_map.get(cur)
            return result

        needed: set[str] = set()
        for wid in act_to_real_wbs.values():
            if wid:
                needed |= get_real_ancestors(wid)

        nodes = []
        for w in model.wbs_nodes:
            wid = str(w.id)
            if wid not in needed:
                continue
            nodes.append({
                "id":     wid,
                "name":   w.name or wid,
                "level":  max(1, depth_cache.get(wid, 1)),
                "parent": real_parent_map.get(wid),
                "code":   getattr(w, 'short_name', None) or wid,
            })

        if nodes:
            return nodes, act_to_real_wbs

    # Fallback: reconstruct from wbs_path breadcrumbs
    path_name_map: dict[str, str] = {}
    for act in model.activities:
        if not act.wbs_id or not act.wbs_path or act.wbs_path == act.wbs_id:
            continue
        path_parts = [p.strip() for p in act.wbs_path.split('/') if p.strip()]
        wbs_parts  = str(act.wbs_id).split('.')
        for i in range(min(len(wbs_parts), len(path_parts))):
            ancestor_id = '.'.join(wbs_parts[:i+1])
            if ancestor_id not in path_name_map:
                path_name_map[ancestor_id] = path_parts[i]

    node_map: dict[str, dict] = {}
    for act in model.activities:
        if not act.wbs_id:
            continue
        parts = str(act.wbs_id).split('.')
        for i in range(1, len(parts) + 1):
            node_id = '.'.join(parts[:i])
            if node_id in node_map:
                continue
            node_map[node_id] = {
                "id":     node_id,
                "name":   path_name_map.get(node_id) or parts[i-1],
                "level":  i,
                "parent": '.'.join(parts[:i-1]) if i > 1 else None,
                "code":   node_id,
            }

    return list(node_map.values()), {}


# ─────────────────────────────────────────────────────────────────────────────
# schedule_data serialiser — called by GET /api/schedule-data/{session_id}
# ─────────────────────────────────────────────────────────────────────────────

def _serialise_schedule_data(model: ScheduleModel) -> dict:
    """Build the full Gantt payload from a ScheduleModel."""

    wbs_nodes, act_wbs_remap = _build_wbs_nodes(model)
    wbs_name_map = {w["id"]: w["name"] for w in wbs_nodes}
    wbs_id_set   = {w["id"] for w in wbs_nodes}

    activities = []
    for a in model.activities:
        if a.is_summary:
            continue

        start  = a.planned_start  or a.early_start
        finish = a.planned_finish or a.early_finish

        cal_name = None
        if a.calendar_id:
            cal_obj  = model.get_calendar(a.calendar_id)
            cal_name = cal_obj.name if cal_obj else None

        is_critical = a.is_critical_source
        if not is_critical and a.total_float_hours is not None:
            is_critical = a.total_float_hours <= 0

        raw_wbs  = str(a.wbs_id)
        real_wbs = act_wbs_remap.get(raw_wbs, raw_wbs)
        if real_wbs and real_wbs not in wbs_id_set:
            real_wbs = raw_wbs

        activities.append({
            "id":              a.id,
            "name":            a.name,
            "wbs":             real_wbs,
            "wbs_name":        wbs_name_map.get(real_wbs, a.wbs_path or raw_wbs),
            "wbs_path":        a.wbs_path,
            "start":           _dt_iso(start),
            "finish":          _dt_iso(finish),
            "exp_finish":      _dt_iso(getattr(a, 'exp_finish', None)),
            "base_start":      _dt_iso(a.baseline_start),
            "base_finish":     _dt_iso(a.baseline_finish),
            "act_start":       _dt_iso(a.actual_start),
            "act_finish":      _dt_iso(a.actual_finish),
            "orig_dur":        _hours_to_days(a.original_duration_hours),
            "rem_dur":         _hours_to_days(a.remaining_duration_hours),
            "total_float":     _hours_to_days(a.total_float_hours),
            "free_float":      _hours_to_days(a.free_float_hours),
            "pct":             a.percent_complete,
            "status":          _status_label(a.status),
            "type":            _type_label(a.activity_type),
            "cstr_type":       _constraint_code(a.constraint_type),
            "cstr_date":       _dt_iso(a.constraint_date),
            "calendar":        cal_name,
            "cal_id":          a.calendar_id,
            "critical":        is_critical,
            "resource_id":     getattr(a, 'resource_id',            None) or None,
            "resource_name":   getattr(a, 'resource_name',          None) or None,
            "budget_units":    _hours_to_days(getattr(a, 'budget_units_hours',    None)),
            "actual_units":    _hours_to_days(getattr(a, 'actual_units_hours',    None)),
            "remaining_units": _hours_to_days(getattr(a, 'remaining_units_hours', None)),
            "at_comp_units":   _hours_to_days(getattr(a, 'at_comp_units_hours',   None)),
        })

    relationships = [
        {
            "from_id":  r.predecessor_id,
            "to_id":    r.successor_id,
            "type":     r.type.value,
            "lag_days": _hours_to_days_float(r.lag_hours),
        }
        for r in model.relationships
    ]

    from datetime import timedelta
    calendars = {}
    for cal in model.calendars:
        work_days  = [d + 1 for d in cal.working_days]
        exceptions = {}
        for exc in cal.exceptions:
            current = exc.start_date
            while current <= exc.end_date:
                exceptions[current.isoformat()] = False
                current += timedelta(days=1)
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


# ─────────────────────────────────────────────────────────────────────────────
# Report serialiser — v1.3: NO schedule_data, YES session_id
# ─────────────────────────────────────────────────────────────────────────────

def _serialise_report(report: HealthReport, session_id: str) -> dict:
    """
    Serialise the health report to JSON.

    schedule_data is intentionally excluded — fetched lazily via session_id.
    """
    return {
        "session_id":             session_id,
        "project_name":           report.project_name,
        "source_format":          report.source_format,
        "source_filename":        report.source_filename,
        "data_date":              report.data_date,
        "overall_grade":          report.overall_grade,
        "overall_score":          report.overall_score,
        "pass_count":             report.pass_count,
        "fail_count":             report.fail_count,
        "warn_count":             report.warn_count,
        "summary_stats":          report.summary_stats,
        "parse_warnings":         report.parse_warnings,
        "float_histogram":        report.float_histogram,
        "network_metrics":        report.network_metrics,
        "relationship_breakdown": report.relationship_breakdown,
        "longest_path":           report.longest_path,
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
        # schedule_data intentionally absent — use GET /api/schedule-data/{session_id}
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
