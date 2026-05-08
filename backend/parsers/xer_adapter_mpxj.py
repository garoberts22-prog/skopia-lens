"""
SKOPIA Lens — XER Parser Adapter (MPXJ version) v0.9.1

Reads Primavera P6 XER files via MPXJ (Java bridge) instead of xerparser.
This replaces xer_adapter.py and removes the GPL-3.0 xerparser dependency.

MPXJ is LGPL — safe for commercial SaaS use.

v0.9.1 WBS Fix:
  Previously: task.getWBS() returned a code string (e.g. "RHB.1.1"), stored as
  both wbs_id AND wbs_path → _build_wbs_nodes() saw them equal → numeric names.

  Now: _build_wbs_code_map() tries three routes to build a code→name lookup:
    a) wbs_entity.getCode() — direct (MPXJ 12+)
    b) Parent-chain name breadcrumb (always works if getName() works)
    c) Depth-based fallback (handled in main.py via model.wbs_nodes)

  When route (a) succeeds, wbs_path is set to a friendly breadcrumb.
  When routes (a)/(b) fail, main.py's _build_wbs_name_map() handles it via
  depth-based matching against model.wbs_nodes (which has proper names).
"""

from __future__ import annotations

from pathlib import Path
from datetime import datetime
from typing import Union, Optional

from core.models import (
    ScheduleModel, Activity, Relationship, Calendar,
    CalendarException, WBSNode,
    ActivityStatus, ActivityType, RelationshipType, ConstraintType,
)
from parsers.base import ParserAdapter, ParseError


# ── Mapping tables ──────────────────────────────────────────────────────────

_XER_CONSTRAINT_MAP = {
    "AS_SOON_AS_POSSIBLE":    ConstraintType.AS_SOON_AS_POSSIBLE,
    "AS_LATE_AS_POSSIBLE":    ConstraintType.AS_LATE_AS_POSSIBLE,
    "MUST_START_ON":          ConstraintType.MUST_START_ON,
    "MUST_FINISH_ON":         ConstraintType.MUST_FINISH_ON,
    "START_NO_EARLIER_THAN":  ConstraintType.START_NO_EARLIER_THAN,
    "START_NO_LATER_THAN":    ConstraintType.START_NO_LATER_THAN,
    "FINISH_NO_EARLIER_THAN": ConstraintType.FINISH_NO_EARLIER_THAN,
    "FINISH_NO_LATER_THAN":   ConstraintType.FINISH_NO_LATER_THAN,
    "MANDATORY_START":        ConstraintType.MANDATORY_START,
    "MANDATORY_FINISH":       ConstraintType.MANDATORY_FINISH,
}

_XER_REL_TYPE_MAP = {
    "FINISH_START":  RelationshipType.FS,
    "START_START":   RelationshipType.SS,
    "FINISH_FINISH": RelationshipType.FF,
    "START_FINISH":  RelationshipType.SF,
    "FS": RelationshipType.FS,
    "SS": RelationshipType.SS,
    "FF": RelationshipType.FF,
    "SF": RelationshipType.SF,
}


# ── Helpers ─────────────────────────────────────────────────────────────────

def _java_dt(java_dt) -> Optional[datetime]:
    """Convert a MPXJ Java LocalDateTime to Python datetime."""
    if java_dt is None:
        return None
    try:
        return datetime(
            int(java_dt.getYear()),
            int(java_dt.getMonthValue()),
            int(java_dt.getDayOfMonth()),
            int(java_dt.getHour()),
            int(java_dt.getMinute()),
            int(java_dt.getSecond()),
        )
    except Exception:
        try:
            return datetime.fromisoformat(str(java_dt).replace("T", " ")[:19])
        except Exception:
            return None


def _java_dur_hours(java_dur, minutes_per_day: int = 480) -> Optional[float]:
    """Convert MPXJ Duration to hours."""
    if java_dur is None:
        return None
    try:
        val = float(java_dur.getDuration())
        units = str(java_dur.getUnits()).upper()
        hours_per_day = minutes_per_day / 60.0

        if units in ("H", "EH") or "HOUR" in units:
            return val
        elif units in ("D", "ED") or "DAY" in units:
            return val * hours_per_day
        elif units in ("W", "EW") or "WEEK" in units:
            return val * hours_per_day * 5
        elif units in ("M", "EM") or "MINUTE" in units:
            return val / 60.0
        elif units in ("MON", "EMON") or "MONTH" in units:
            return val * hours_per_day * 20
        else:
            return val * hours_per_day
    except Exception:
        return None


def _start_jvm():
    """Start the JVM with MPXJ jars if not already running."""
    try:
        import jpype
        import mpxj
        import os

        if not jpype.isJVMStarted():
            mpxj_pkg = os.path.dirname(mpxj.__file__)
            lib_dir = os.path.join(mpxj_pkg, "lib")
            if os.path.isdir(lib_dir):
                jars = [
                    os.path.join(lib_dir, f)
                    for f in os.listdir(lib_dir)
                    if f.endswith(".jar")
                ]
                jpype.startJVM(classpath=jars)
            else:
                jpype.startJVM()

        import jpype.imports
        from org.mpxj.reader import UniversalProjectReader
        return UniversalProjectReader

    except ImportError:
        raise ParseError(
            "MPXJ/JPype libraries not installed",
            format_name="Primavera XER (MPXJ)",
            details="Install with: pip install mpxj jpype1  (requires Java runtime)",
        )
    except Exception as e:
        raise ParseError(
            f"Failed to start Java VM: {e}",
            format_name="Primavera XER (MPXJ)",
            details="Ensure Java 11+ is installed and JAVA_HOME is set.",
        )


def _parse_xer_wbs(file_path: str) -> tuple[dict, dict, dict]:
    """
    Parse PROJWBS from the XER text file directly. Returns three maps:

    1. mpxj_code_to_name:   maps MPXJ's dotted code → wbs_name
       e.g. "RHB.1.1.1" → "Town Planning"

    2. mpxj_code_to_parent: maps MPXJ's dotted code → parent's MPXJ dotted code
       e.g. "RHB.1.1.1" → "RHB.1"  (P6's actual parent, not intermediate nodes)

    3. mpxj_code_to_depth:  maps MPXJ's dotted code → actual P6 depth (1-based)
       e.g. "RHB" → 1, "RHB.1" → 2, "RHB.1.1.1" → 3

    WHY THIS IS NEEDED:
    P6 stores wbs_short_name as a multi-segment code like "1.1", "1.1.1".
    MPXJ builds dotted codes by concatenating parent short_names:
      root "RHB" → child short="1" → "RHB.1"
      grandchild short="1.1" → "RHB.1.1.1"  (note: "1.1" is the short_name, not two levels)
    This creates 6-7 level codes for what P6 considers 4 levels.

    We replicate MPXJ's concatenation to match task.getWBS() output,
    but use P6's actual parent_wbs_id chain for depth and parent relationships.
    """
    mpxj_code_to_name: dict[str, str] = {}
    mpxj_code_to_parent: dict[str, str | None] = {}
    mpxj_code_to_depth: dict[str, int] = {}

    try:
        with open(file_path, encoding="cp1252", errors="replace") as f:
            content = f.read()
        lines = content.splitlines()

        in_projwbs = False
        headers: list[str] = []
        raw_rows: list[dict] = []

        for line in lines:
            if line.startswith("%T\t"):
                table_name = line.split("\t", 1)[1].strip()
                if in_projwbs and raw_rows:
                    break
                in_projwbs = (table_name == "PROJWBS")
                headers = []
                continue
            if not in_projwbs:
                continue
            if line.startswith("%F\t"):
                headers = line.split("\t")[1:]
                continue
            if line.startswith("%R\t"):
                values = line.split("\t")[1:]
                row = dict(zip(headers, values))
                raw_rows.append({
                    "wbs_id":        row.get("wbs_id", "").strip(),
                    "parent_wbs_id": row.get("parent_wbs_id", "").strip(),
                    "short_name":    row.get("wbs_short_name", "").strip(),
                    "name":          row.get("wbs_name", "").strip(),
                })

        if not raw_rows:
            return mpxj_code_to_name, mpxj_code_to_parent, mpxj_code_to_depth

        id_to_row = {r["wbs_id"]: r for r in raw_rows}

        # Build the MPXJ-style dotted code (parent short_name concatenation)
        # This replicates what MPXJ returns from task.getWBS()
        _code_cache: dict[str, str] = {}
        def _mpxj_code(wbs_id: str) -> str:
            if wbs_id in _code_cache:
                return _code_cache[wbs_id]
            row = id_to_row.get(wbs_id)
            if not row:
                return ""
            short = row["short_name"]
            parent = row["parent_wbs_id"]
            if not parent or parent not in id_to_row:
                _code_cache[wbs_id] = short
                return short
            parent_code = _mpxj_code(parent)
            result = f"{parent_code}.{short}" if parent_code else short
            _code_cache[wbs_id] = result
            return result

        # Build P6 actual depth from parent chain
        _depth_cache: dict[str, int] = {}
        def _p6_depth(wbs_id: str) -> int:
            if wbs_id in _depth_cache:
                return _depth_cache[wbs_id]
            row = id_to_row.get(wbs_id)
            if not row:
                return 0
            parent = row["parent_wbs_id"]
            if not parent or parent not in id_to_row:
                _depth_cache[wbs_id] = 1
                return 1
            result = 1 + _p6_depth(parent)
            _depth_cache[wbs_id] = result
            return result

        # Build all three maps
        wbs_id_to_mpxj: dict[str, str] = {}  # P6 wbs_id → MPXJ code
        for row in raw_rows:
            wid = row["wbs_id"]
            code = _mpxj_code(wid)
            depth = _p6_depth(wid)
            name = row["name"] or row["short_name"]
            wbs_id_to_mpxj[wid] = code
            mpxj_code_to_name[code] = name
            mpxj_code_to_depth[code] = depth

            # Map parent using P6's actual parent_wbs_id
            parent_wid = row["parent_wbs_id"]
            if parent_wid and parent_wid in id_to_row:
                parent_code = wbs_id_to_mpxj.get(parent_wid) or _mpxj_code(parent_wid)
                mpxj_code_to_parent[code] = parent_code
            else:
                mpxj_code_to_parent[code] = None

    except Exception:
        pass

    return mpxj_code_to_name, mpxj_code_to_parent, mpxj_code_to_depth

# ── Adapter ──────────────────────────────────────────────────────────────────

class XERMPXJParserAdapter(ParserAdapter):
    """
    XER parser adapter using MPXJ (GPL-free replacement for xerparser).

    Reads Primavera P6 XER files via MPXJ's UniversalProjectReader.
    """

    @property
    def supported_extensions(self) -> list[str]:
        return [".xer"]

    @property
    def format_name(self) -> str:
        return "Primavera XER"

    def parse(
        self,
        file_path: Union[str, Path],
        filename: str = "",
    ) -> ScheduleModel:

        UniversalProjectReader = _start_jvm()

        file_path = Path(file_path)
        if not file_path.exists():
            raise ParseError(f"File not found: {file_path}")

        try:
            reader = UniversalProjectReader()
            project = reader.read(str(file_path))
        except Exception as e:
            raise ParseError(
                f"MPXJ failed to read XER file: {e}",
                format_name=self.format_name,
                details=str(e),
            )

        props = project.getProjectProperties()
        mpd = int(props.getMinutesPerDay() or 480)

        model = ScheduleModel(
            project_name=str(props.getName() or "Unnamed"),
            project_id=str(props.getUniqueID() or ""),
            source_format="xer",
            source_filename=filename or file_path.name,
            data_date=_java_dt(props.getStatusDate()),
        )

        if model.data_date is None:
            model.data_date = _java_dt(props.getStartDate())

        # ── Calendars ────────────────────────────────────────────────────────
        cal_map: dict[str, Calendar] = {}
        default_cal = project.getDefaultCalendar()
        default_cal_id = str(default_cal.getUniqueID()) if default_cal else None

        try:
            from java.time import DayOfWeek as JavaDayOfWeek
        except Exception:
            JavaDayOfWeek = None

        _JAVA_DOW_TO_INT = {
            "MONDAY": 0, "TUESDAY": 1, "WEDNESDAY": 2,
            "THURSDAY": 3, "FRIDAY": 4, "SATURDAY": 5, "SUNDAY": 6,
        }

        for cal in project.getCalendars():
            cal_id = str(cal.getUniqueID())
            cal_name = str(cal.getName() or "Unnamed")
            working_days = []
            total_weekly_hours = 0.0
            day_hours_list = []

            if JavaDayOfWeek:
                for d in JavaDayOfWeek.values():
                    hours = cal.getCalendarHours(d)
                    if hours:
                        ranges = list(hours)
                        if ranges:
                            day_minutes = 0
                            for r in ranges:
                                start_t = r.getStart()
                                end_t = r.getEnd()
                                if start_t and end_t:
                                    s = int(start_t.getHour()) * 60 + int(start_t.getMinute())
                                    e = int(end_t.getHour()) * 60 + int(end_t.getMinute())
                                    day_minutes += (e - s)
                            if day_minutes > 0:
                                day_int = _JAVA_DOW_TO_INT.get(str(d))
                                if day_int is not None:
                                    working_days.append(day_int)
                                day_hrs = day_minutes / 60.0
                                total_weekly_hours += day_hrs
                                day_hours_list.append(day_hrs)

            working_days.sort()
            hours_per_day = (
                sum(day_hours_list) / len(day_hours_list) if day_hours_list else mpd / 60.0
            )
            hours_per_week = (
                total_weekly_hours if total_weekly_hours > 0
                else hours_per_day * max(len(working_days), 5)
            )
            if not working_days:
                working_days = [0, 1, 2, 3, 4]

            exceptions_list = []
            try:
                java_exceptions = cal.getCalendarExceptions()
                if java_exceptions:
                    for exc in list(java_exceptions):
                        is_working = bool(exc.getWorking()) if exc.getWorking() is not None else False
                        if not is_working:
                            from_dt = _java_dt(exc.getFromDate())
                            to_dt = _java_dt(exc.getToDate())
                            exc_name = str(exc.getName() or "Holiday")
                            if from_dt and to_dt:
                                exceptions_list.append(CalendarException(
                                    name=exc_name,
                                    start_date=from_dt.date(),
                                    end_date=to_dt.date(),
                                ))
            except Exception:
                pass

            parsed_cal = Calendar(
                id=cal_id,
                name=cal_name,
                hours_per_day=hours_per_day,
                hours_per_week=hours_per_week,
                days_per_week=len(working_days),
                working_days=working_days,
                exceptions=exceptions_list,
                is_default=(cal_id == default_cal_id),
                source_id=cal_id,
            )
            model.calendars.append(parsed_cal)
            cal_map[cal_id] = parsed_cal

        # ── WBS — v0.9.3 ─────────────────────────────────────────────────────
        #
        # Parse WBS directly from XER text. Returns three maps keyed by MPXJ
        # dotted code (what task.getWBS() returns):
        #   code_to_name:   "RHB.1.1.1" → "Town Planning"
        #   code_to_parent: "RHB.1.1.1" → "RHB.1"  (P6's actual parent)
        #   code_to_depth:  "RHB.1.1.1" → 3  (P6's actual depth, not dot count)
        code_to_name, code_to_parent, code_to_depth = _parse_xer_wbs(str(file_path))

        # Build WBSNode entries using P6's real parent chain and depth
        for code, name in code_to_name.items():
            parent = code_to_parent.get(code)
            depth = code_to_depth.get(code, 1)
            node = WBSNode(
                id=code,
                name=name,
                parent_id=parent,
                source_id=code,
            )
            node.level = depth  # store depth for main.py
            model.wbs_nodes.append(node)


        # ── Tasks (Activities) ────────────────────────────────────────────────
        activity_map: dict[str, Activity] = {}

        for task in project.getTasks():
            uid = task.getUniqueID()
            if uid is None:
                continue
            uid_str = str(int(uid))

            if int(uid) == 0:
                continue

            # Activity ID: P6 task_code (getActivityID)
            activity_id = str(task.getActivityID() or "")
            if not activity_id:
                task_id_field = task.getID()
                activity_id = str(int(task_id_field)) if task_id_field else uid_str

            # Activity type
            is_summary = bool(task.getSummary() if task.getSummary() is not None else False)
            is_milestone = bool(task.getMilestone() if task.getMilestone() is not None else False)
            dur = task.getDuration()
            dur_hours = _java_dur_hours(dur, mpd)
            is_zero_dur = (dur_hours is not None and dur_hours == 0)

            if is_summary:
                act_type = ActivityType.WBS_SUMMARY
            elif is_milestone or is_zero_dur:
                act_type = ActivityType.MILESTONE
            else:
                act_type = ActivityType.TASK

            # Status
            pct = float(task.getPercentageComplete() or 0)
            actual_finish = _java_dt(task.getActualFinish())
            actual_start = _java_dt(task.getActualStart())
            if pct >= 100 or actual_finish is not None:
                act_status = ActivityStatus.COMPLETED
            elif pct > 0 or actual_start is not None:
                act_status = ActivityStatus.IN_PROGRESS
            else:
                act_status = ActivityStatus.NOT_STARTED

            # Constraint
            constraint_type_java = task.getConstraintType()
            constraint_str = str(constraint_type_java) if constraint_type_java else ""
            constraint_type = _XER_CONSTRAINT_MAP.get(constraint_str, ConstraintType.NONE)
            constraint_date = _java_dt(task.getConstraintDate())

            # Float
            tf_hours = _java_dur_hours(task.getTotalSlack(), mpd)
            ff_hours = _java_dur_hours(task.getFreeSlack(), mpd)

            # Calendar
            task_cal = task.getCalendar()
            cal_id = str(task_cal.getUniqueID()) if task_cal else default_cal_id

            # WBS — v0.9.3
            # task.getWBS() returns MPXJ's dotted code (e.g. "RHB.1.1.1.1.1.1").
            # code_to_name/parent/depth maps use the same codes, so direct lookup works.
            # wbs_path is a breadcrumb of named ancestors using P6's real parent chain.
            wbs_code = str(task.getWBS() or "")

            # Build breadcrumb from P6's actual parent chain (not dot-splitting)
            if wbs_code and code_to_name:
                breadcrumb_parts = []
                cur = wbs_code
                while cur:
                    name = code_to_name.get(cur, "")
                    if name:
                        breadcrumb_parts.insert(0, name)
                    cur = code_to_parent.get(cur)
                wbs_path = " / ".join(breadcrumb_parts) if breadcrumb_parts else wbs_code
            else:
                wbs_path = wbs_code

            act = Activity(
                id=activity_id,
                name=str(task.getName() or ""),
                activity_type=act_type,
                status=act_status,
                wbs_id=wbs_code or None,
                wbs_path=wbs_path or None,
                planned_start=_java_dt(task.getStart()),
                planned_finish=_java_dt(task.getFinish()),
                actual_start=actual_start,
                actual_finish=actual_finish,
                early_start=_java_dt(task.getEarlyStart()),
                early_finish=_java_dt(task.getEarlyFinish()),
                late_start=_java_dt(task.getLateStart()),
                late_finish=_java_dt(task.getLateFinish()),
                baseline_start=_java_dt(task.getBaselineStart()),
                baseline_finish=_java_dt(task.getBaselineFinish()),
                original_duration_hours=_java_dur_hours(task.getDuration(), mpd),
                remaining_duration_hours=_java_dur_hours(task.getRemainingDuration(), mpd),
                total_float_hours=tf_hours,
                free_float_hours=ff_hours,
                constraint_type=constraint_type,
                constraint_date=constraint_date,
                calendar_id=cal_id,
                percent_complete=pct,
                is_critical_source=bool(
                    task.getCritical() if task.getCritical() is not None else False
                ),
                source_id=uid_str,
                source_format="xer",
            )

            # ── Extended fields (stored as dynamic attributes) ────────────────
            # Expected Finish (P6: expect_end_date — the user-entered expected finish date).
            # MPXJ exposes this via task.getExpectedFinish() for XER files.
            try:
                act.exp_finish = _java_dt(task.getExpectedFinish())
            except Exception:
                act.exp_finish = None

            # Resource assignments — extract primary resource ID/name and unit totals.
            # P6 stores these on TASKRSRC records; MPXJ exposes via getResourceAssignments().
            # Units are in hours; we store raw hours and let main.py convert to days.
            act.resource_id   = None
            act.resource_name = None
            act.budget_units_hours    = None  # target_qty (budgeted)
            act.actual_units_hours    = None  # act_reg_qty + act_ot_qty
            act.remaining_units_hours = None  # remain_qty
            act.at_comp_units_hours   = None  # actual + remaining
            try:
                assignments = task.getResourceAssignments()
                if assignments:
                    asgn_list = list(assignments)
                    if asgn_list:
                        # Primary resource = first non-null assignment
                        primary = asgn_list[0]
                        res = primary.getResource()
                        if res is not None:
                            act.resource_id   = str(res.getCode()   or res.getName() or "")
                            act.resource_name = str(res.getName()   or "")
                        # Aggregate unit hours across all assignments on this task
                        total_budget = 0.0
                        total_actual = 0.0
                        total_remain = 0.0
                        has_any = False
                        for asgn in asgn_list:
                            bw = _java_dur_hours(asgn.getWork(), mpd)
                            aw = _java_dur_hours(asgn.getActualWork(), mpd)
                            rw = _java_dur_hours(asgn.getRemainingWork(), mpd)
                            if bw is not None:
                                total_budget += bw; has_any = True
                            if aw is not None:
                                total_actual += aw; has_any = True
                            if rw is not None:
                                total_remain += rw; has_any = True
                        if has_any:
                            act.budget_units_hours    = total_budget
                            act.actual_units_hours    = total_actual
                            act.remaining_units_hours = total_remain
                            act.at_comp_units_hours   = total_actual + total_remain
            except Exception:
                pass  # Resource data unavailable — fields stay None

            model.activities.append(act)
            activity_map[uid_str] = act

        # ── Relationships ─────────────────────────────────────────────────────
        id_to_activity = {act.id: act for act in model.activities}

        for task in project.getTasks():
            uid = task.getUniqueID()
            if uid is None or int(uid) == 0:
                continue

            uid_str = str(int(uid))
            succ_act = activity_map.get(uid_str)
            if not succ_act:
                continue

            preds = task.getPredecessors()
            if preds is None:
                continue

            for rel in preds:
                pred_task = rel.getPredecessorTask()
                if pred_task is None:
                    continue

                pred_uid = str(int(pred_task.getUniqueID()))
                pred_act = activity_map.get(pred_uid)
                if not pred_act:
                    model.parse_warnings.append(
                        f"Predecessor UID {pred_uid} not found for "
                        f"task {succ_act.id}: {succ_act.name}"
                    )
                    continue

                rel_type_java = rel.getType()
                rel_type_str = str(rel_type_java) if rel_type_java else "FINISH_START"
                rel_type = _XER_REL_TYPE_MAP.get(rel_type_str, RelationshipType.FS)

                lag = rel.getLag()
                lag_hours = _java_dur_hours(lag, mpd) or 0.0

                relationship = Relationship(
                    predecessor_id=pred_act.id,
                    successor_id=succ_act.id,
                    type=rel_type,
                    lag_hours=lag_hours,
                    lag_days=lag_hours / (mpd / 60.0) if mpd else 0,
                )

                model.relationships.append(relationship)
                pred_act.successors.append(relationship)
                succ_act.predecessors.append(relationship)

        # ── Project date bounds ───────────────────────────────────────────────
        starts = [a.planned_start for a in model.activities if a.planned_start and a.is_task]
        finishes = [a.planned_finish for a in model.activities if a.planned_finish and a.is_task]
        if starts:
            model.planned_start = min(starts)
        if finishes:
            model.planned_finish = max(finishes)

        return model
