"""
SKOPIA Lens — FastAPI Application (v1.0)

Upload a schedule file (XER or MPP), get a health report card.
Product: SKOPIA Lens — "Schedule confidence, in seconds."

v0.8: Added schedule_data block (activities, wbs_nodes, relationships, calendars).
v0.9: Fixed wbs_nodes — if model.wbs_nodes is empty or names are missing,
      reconstruct the WBS hierarchy from activity wbs_id/wbs_path data.
      Also adds wbs_name (friendly display name) to each activity.
v1.0: Added /api/mpp-to-xml endpoint. Accepts a binary .mpp file, converts it
      to MSP XML via MPXJ MSPDIWriter, returns the XML bytes for download.
      This enables the ConvertView mpp2xer direction: the frontend POSTs the
      MPP, receives MSP XML, then runs the client-side xml2xer converter.
      MPXJ/JVM is already running in-process — no new process or dependency.
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


@app.post("/api/mpp-to-xml")
async def mpp_to_xml(file: UploadFile = File(...)):
    """
    Convert a binary MS Project .mpp file to MSP XML format.

    Used by ConvertView's mpp2xer direction:
      1. Frontend POSTs the .mpp file here.
      2. This endpoint reads it via MPXJ UniversalProjectReader and writes
         MSP XML via MSPDIWriter (writes to temp file, read back as bytes),
      3. Returns the XML bytes as application/xml for direct download or
         for the client-side xml2xer converter to consume as the next step.

    MPXJ/JVM is already running in-process (started by xer_adapter_mpxj or
    mpp_adapter on the first /api/analyse call). The _ensure_jvm() helper
    handles the startup-once pattern safely.

    Accepts: .mpp only — .xml files should go straight to the client-side
             convertor without touching the backend.
    Returns: MSP XML bytes (application/xml)
             Content-Disposition: attachment; filename=<original_name>.xml
    """
    filename = file.filename or "schedule.mpp"

    # Reject anything that isn't an MPP file up-front
    if not filename.lower().endswith(".mpp"):
        raise HTTPException(status_code=400, detail={
            "error": "unsupported_format",
            "message": f"Expected a .mpp file, got: {filename}",
            "details": "Only binary MS Project .mpp files should be sent to this endpoint. "
                       "MSP XML files (.xml) are handled entirely client-side.",
        })

    # Write upload to a temp file so MPXJ can read it by path
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mpp") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        xml_bytes = _convert_mpp_to_xml_bytes(tmp_path)
    except HTTPException:
        raise   # re-raise structured errors from the converter
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": "conversion_error",
            "message": f"MPP to XML conversion failed: {str(e)}",
        })
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # Build output filename: replace .mpp extension with .xml
    stem = Path(filename).stem
    out_filename = f"{stem}.xml"

    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{out_filename}"'},
    )


def _convert_mpp_to_xml_bytes(mpp_path: str) -> bytes:
    """
    Read an MPP file via MPXJ and serialise it to MSP XML bytes.

    WHY TEMP FILE, NOT ByteArrayOutputStream:
    The original implementation used ByteArrayOutputStream and converted the
    returned Java byte[] to Python bytes via iteration:
        bytes([int(b) & 0xFF for b in baos.toByteArray()])
    This works in local testing but fails on some JVM/JPype/platform combinations
    (confirmed on Render) — the iterator over a Java byte[] returns zero items
    for large arrays, producing an empty bytes object and a silent 200 response.

    The fix: write to a temp file using MSPDIWriter.write(ProjectFile, String),
    then read the file back as Python bytes. No JPype type conversion needed —
    Python's open() reads the file natively. The temp file is always deleted in
    the finally block regardless of outcome.
    """
    _ensure_jvm()

    import jpype.imports
    from org.mpxj.reader import UniversalProjectReader
    from org.mpxj.mspdi  import MSPDIWriter

    # Read the MPP
    try:
        reader  = UniversalProjectReader()
        project = reader.read(mpp_path)
    except Exception as e:
        raise HTTPException(status_code=422, detail={
            "error":   "parse_error",
            "message": f"MPXJ could not read MPP file: {e}",
            "details": "Ensure the file is a valid MS Project binary (.mpp) file. "
                       "Password-protected files are not supported.",
        })

    # Write XML to a temp file — avoids JPype byte[] iteration entirely
    xml_tmp = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".xml") as f:
            xml_tmp = f.name

        writer = MSPDIWriter()
        writer.setMicrosoftProjectCompatibleOutput(True)
        writer.write(project, xml_tmp)   # write(ProjectFile, String path)

        xml_bytes = Path(xml_tmp).read_bytes()

        if not xml_bytes:
            raise HTTPException(status_code=500, detail={
                "error":   "empty_output",
                "message": "MSPDIWriter produced an empty XML file.",
                "details": "The MPP file may be corrupt or contain no tasks.",
            })

        return xml_bytes

    finally:
        if xml_tmp:
            try:
                os.unlink(xml_tmp)
            except OSError:
                pass


def _ensure_jvm() -> None:
    """
    Start the JVM with MPXJ jars if it is not already running.

    Safe to call multiple times — checks jpype.isJVMStarted() first.
    Mirrors the pattern in xer_adapter_mpxj._start_jvm() so both code
    paths share the same JVM instance (JPype only supports one per process).
    """
    try:
        import jpype
        import mpxj
    except ImportError:
        raise HTTPException(status_code=503, detail={
            "error":   "dependency_missing",
            "message": "MPXJ/JPype libraries are not installed.",
            "details": "Install with: pip install mpxj jpype1 (requires Java 11+ runtime).",
        })

    if jpype.isJVMStarted():
        return

    import os
    mpxj_pkg = os.path.dirname(mpxj.__file__)
    lib_dir  = os.path.join(mpxj_pkg, "lib")

    try:
        if os.path.isdir(lib_dir):
            jars = [os.path.join(lib_dir, f)
                    for f in os.listdir(lib_dir) if f.endswith(".jar")]
            jpype.startJVM(classpath=jars)
        else:
            jpype.startJVM()
    except Exception as e:
        raise HTTPException(status_code=503, detail={
            "error":   "jvm_start_failed",
            "message": f"Failed to start Java VM: {e}",
            "details": "Ensure Java 11+ is installed and JAVA_HOME is set correctly.",
        })


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
