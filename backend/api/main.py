"""
# ╔══════════════════════════════════════════════════════╗
# ║  SKOPIA Lens — main.py  v1.2  CLEAN BUILD           ║
# ║  Verify: grep for /api/mpp-to-xml (no _write_xer)   ║
# ╚══════════════════════════════════════════════════════╝
SKOPIA Lens — FastAPI Application (v1.2)

Upload a schedule file (XER or MPP), get a health report card.
Product: SKOPIA Lens — "Schedule confidence, in seconds."

v0.8: Added schedule_data block (activities, wbs_nodes, relationships, calendars).
v0.9: Fixed wbs_nodes reconstruction from wbs_path breadcrumbs.
v1.0: Added /api/mpp-to-xml (MPXJ MSPDIWriter approach — first attempt, retired).
v1.1: Replaced with /api/mpp-to-xer. MPP → ScheduleModel → Python _write_xer.
v1.2: Simplified. Removed _write_xer (Python XER writer) entirely. Reverted to
      MPXJ MSPDIWriter for /api/mpp-to-xml — returns MSP XML bytes to client.
      Client then runs the existing convertMSPtoXER() from convertor.js.
      This is architecturally identical to the xml2xer direction — consistent,
      tested, and removes ~280 lines of duplicate serialisation logic.
"""

from __future__ import annotations

import io
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
from api.pdf_export       import router as pdf_router
from api.helios_endpoint  import router as helios_router

app = FastAPI(
    title="SKOPIA Lens API",
    description="Upload a P6 or MS Project schedule, get an instant health report card. SKOPIA Lens — schedule confidence, in seconds.",
    version="1.2.0",
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
app.include_router(helios_router)


@app.get("/")
async def root():
    return {
        "service": "SKOPIA Lens",
        "version": "1.2.0",
        "tagline": "Schedule confidence, in seconds.",
        "supported_formats": [p.format_name for p in PARSERS],
        "supported_extensions": [ext for p in PARSERS for ext in p.supported_extensions],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Health check analysis endpoint
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# MPP → MSP XML export endpoint  (v1.2 — replaces mpp-to-xer)
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/mpp-to-xml")
async def mpp_to_xml(file: UploadFile = File(...)):
    """
    Convert a binary MS Project .mpp file to MSP XML format.

    Architecture (v1.2):
      1. Read the .mpp into a temp file.
      2. Use MPXJ's MSPDIWriter (already on the JVM from /api/analyse) to write
         MSP XML into a Java StringWriter, then return the UTF-8 string as bytes.
      3. The client receives standard MSP XML and runs convertMSPtoXER() from
         convertor.js — identical to the xml2xer direction.

    Why this is better than the old Python _write_xer approach (v1.1):
      - No duplicate serialisation logic. convertor.js convertMSPtoXER() is
        already tested and validated. No need for a parallel Python XER writer.
      - MSPDIWriter produces the same MSP XML as "File > Save As > XML" in MSP,
        which is exactly what convertMSPtoXER() was designed to consume.
      - Consistent with xml2xer: same validator, same converter, same output.
      - Removes ~280 lines of Python from main.py.

    StringWriter vs ByteArrayOutputStream:
      MSPDIWriter.write() writes to a Java Writer (character stream). We use
      java.io.StringWriter — its toString() gives us a Python-safe UTF-8 string.
      This avoids the JPype byte[] conversion bug that caused 0-byte responses
      in the original /api/mpp-to-xml (v1.0) which used ByteArrayOutputStream.
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
        # Start JVM if not already running (MPPParserAdapter handles this too,
        # so the JVM is shared — no double-start on a busy server).
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

        # Read the MPP file
        reader  = UniversalProjectReader()
        project = reader.read(tmp_path)

        # Write to MSP XML via MSPDIWriter → StringWriter
        # StringWriter is a character stream — toString() is safe from JPype.
        sw = StringWriter()
        writer = MSPDIWriter()
        writer.write(project, sw)
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

    stem        = Path(filename).stem
    out_filename = f"{stem}.xml"
    xml_bytes   = xml_str.encode("utf-8")

    return Response(
        content=xml_bytes,
        media_type="application/xml; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{out_filename}"'},
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
# WBS reconstruction — v0.9
# ─────────────────────────────────────────────────────────────────────────────

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
        def has_real_name(w):
            name = w.name or ""
            return any(c.isalpha() for c in name)

        real_nodes = {str(w.id) for w in model.wbs_nodes if has_real_name(w)}
        real_nodes |= roots

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

        level_offset = 0

        # Find which real WBS nodes are needed (referenced by activities + ancestors)
        referenced = {str(a.wbs_id) for a in model.activities if a.wbs_id}

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

        nodes = []
        for w in model.wbs_nodes:
            wid = str(w.id)
            if wid not in needed:
                continue
            raw_depth = depth_cache.get(wid, 1)
            display_level = raw_depth - level_offset
            pid = real_parent_map.get(wid)
            nodes.append({
                "id":     wid,
                "name":   w.name or wid,
                "level":  max(1, display_level),
                "parent": pid,
                "code":   getattr(w, 'short_name', None) or wid,
            })

        if nodes:
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

    return list(node_map.values()), {}


# ─────────────────────────────────────────────────────────────────────────────
# schedule_data serialiser
# ─────────────────────────────────────────────────────────────────────────────

def _serialise_schedule_data(model: ScheduleModel) -> dict:
    """Build the schedule_data block for the API response."""

    wbs_nodes, act_wbs_remap = _build_wbs_nodes(model)
    wbs_name_map = {w["id"]: w["name"] for w in wbs_nodes}
    wbs_id_set   = {w["id"] for w in wbs_nodes}

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

        raw_wbs  = str(a.wbs_id)
        real_wbs = act_wbs_remap.get(raw_wbs, raw_wbs)
        if real_wbs and real_wbs not in wbs_id_set:
            real_wbs = raw_wbs

        wbs_display = wbs_name_map.get(real_wbs, a.wbs_path or raw_wbs)

        activities.append({
            "id":          a.id,
            "name":        a.name,
            "wbs":         real_wbs,
            "wbs_name":    wbs_display,
            "wbs_path":    a.wbs_path,
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
            "resource_id":      getattr(a, 'resource_id',   None) or None,
            "resource_name":    getattr(a, 'resource_name', None) or None,
            "budget_units":     _hours_to_days(getattr(a, 'budget_units_hours',    None)),
            "actual_units":     _hours_to_days(getattr(a, 'actual_units_hours',    None)),
            "remaining_units":  _hours_to_days(getattr(a, 'remaining_units_hours', None)),
            "at_comp_units":    _hours_to_days(getattr(a, 'at_comp_units_hours',   None)),
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


# ─────────────────────────────────────────────────────────────────────────────
# Report serialiser
# ─────────────────────────────────────────────────────────────────────────────

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
