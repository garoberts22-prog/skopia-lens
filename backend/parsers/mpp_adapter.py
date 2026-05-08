"""
ScheduleCheck - MPP Parser Adapter

Reads MS Project MPP files via MPXJ (Java bridge) and normalises
into the ScheduleModel.

This is Option A: direct extraction from MPP into the normalised
model. No intermediate XER conversion.

Requires: Java runtime + jpype1 + mpxj packages.
"""

from __future__ import annotations

from pathlib import Path
from datetime import datetime
from typing import Union, Optional

from core.models import (
    ScheduleModel, Activity, Relationship, Calendar, CalendarException, WBSNode,
    ActivityStatus, ActivityType, RelationshipType, ConstraintType,
)
from parsers.base import ParserAdapter, ParseError


# ── Mapping tables ──

_MSP_CONSTRAINT_MAP = {
    "AS_SOON_AS_POSSIBLE": ConstraintType.AS_SOON_AS_POSSIBLE,
    "AS_LATE_AS_POSSIBLE": ConstraintType.AS_LATE_AS_POSSIBLE,
    "MUST_START_ON": ConstraintType.MUST_START_ON,
    "MUST_FINISH_ON": ConstraintType.MUST_FINISH_ON,
    "START_NO_EARLIER_THAN": ConstraintType.START_NO_EARLIER_THAN,
    "START_NO_LATER_THAN": ConstraintType.START_NO_LATER_THAN,
    "FINISH_NO_EARLIER_THAN": ConstraintType.FINISH_NO_EARLIER_THAN,
    "FINISH_NO_LATER_THAN": ConstraintType.FINISH_NO_LATER_THAN,
}

_MSP_REL_TYPE_MAP = {
    "FINISH_START": RelationshipType.FS,
    "START_START": RelationshipType.SS,
    "FINISH_FINISH": RelationshipType.FF,
    "START_FINISH": RelationshipType.SF,
    # Short forms returned by some MPXJ versions
    "FS": RelationshipType.FS,
    "SS": RelationshipType.SS,
    "FF": RelationshipType.FF,
    "SF": RelationshipType.SF,
}


def _java_datetime_to_python(java_dt) -> Optional[datetime]:
    """Convert a Java LocalDateTime or Date to Python datetime."""
    if java_dt is None:
        return None
    try:
        # MPXJ returns java.time.LocalDateTime
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
            # Fallback: toString() and parse
            s = str(java_dt)
            return datetime.fromisoformat(s.replace("T", " ")[:19])
        except Exception:
            return None


def _java_duration_to_hours(java_dur, minutes_per_day: int = 480) -> Optional[float]:
    """Convert MPXJ Duration to hours.
    
    MPXJ returns units as short codes: 'w', 'd', 'h', 'm',
    'ew', 'ed', 'eh', 'em' (elapsed variants), or longer
    forms like 'WEEKS', 'DAYS', etc. depending on version.
    """
    if java_dur is None:
        return None
    try:
        val = float(java_dur.getDuration())
        units = str(java_dur.getUnits()).upper()
        hours_per_day = minutes_per_day / 60.0

        # Match both short (w, d, h, m) and long (WEEKS, DAYS) forms
        if units in ("H", "EH") or "HOUR" in units:
            return val
        elif units in ("D", "ED") or "DAY" in units:
            return val * hours_per_day
        elif units in ("W", "EW") or "WEEK" in units:
            return val * hours_per_day * 5
        elif units in ("M", "EM", "MO") or "MINUTE" in units:
            return val / 60.0
        elif units in ("MON", "EMON") or "MONTH" in units:
            return val * hours_per_day * 20
        else:
            # Last resort: assume days
            return val * hours_per_day
    except Exception:
        return None


class MPPParserAdapter(ParserAdapter):
    """Adapter for MS Project MPP files using MPXJ/JPype."""

    @property
    def supported_extensions(self) -> list[str]:
        return [".mpp", ".xml"]

    @property
    def format_name(self) -> str:
        return "MS Project MPP"

    def parse(
        self,
        file_path: Union[str, Path],
        filename: str = "",
    ) -> ScheduleModel:
        # Start JVM if needed
        try:
            import jpype
            import mpxj
            import os
            if not jpype.isJVMStarted():
                # Find MPXJ jar files for classpath
                mpxj_pkg = os.path.dirname(mpxj.__file__)
                lib_dir = os.path.join(mpxj_pkg, "lib")
                if os.path.isdir(lib_dir):
                    jars = [os.path.join(lib_dir, f)
                            for f in os.listdir(lib_dir) if f.endswith(".jar")]
                    jpype.startJVM(classpath=jars)
                else:
                    jpype.startJVM()
            import jpype.imports
            from org.mpxj.reader import UniversalProjectReader
        except ImportError:
            raise ParseError(
                "MPXJ/JPype libraries not installed",
                format_name=self.format_name,
                details="Install with: pip install mpxj jpype1",
            )
        except Exception as e:
            raise ParseError(
                f"Failed to start Java VM: {e}",
                format_name=self.format_name,
            )

        file_path = Path(file_path)
        if not file_path.exists():
            raise ParseError(f"File not found: {file_path}")

        # Read MPP
        try:
            reader = UniversalProjectReader()
            project = reader.read(str(file_path))
        except Exception as e:
            raise ParseError(
                f"Failed to read MPP file: {e}",
                format_name=self.format_name,
                details=str(e),
            )

        # Project properties
        props = project.getProjectProperties()
        mpd = int(props.getMinutesPerDay() or 480)

        model = ScheduleModel(
            project_name=str(props.getName() or "Unnamed"),
            source_format="mpp",
            source_filename=filename or file_path.name,
            data_date=_java_datetime_to_python(props.getStatusDate()),
            planned_start=_java_datetime_to_python(props.getStartDate()),
            planned_finish=_java_datetime_to_python(props.getFinishDate()),
        )

        # Calendars
        cal_map = {}
        default_cal = project.getDefaultCalendar()
        default_cal_id = str(default_cal.getUniqueID()) if default_cal else None

        # Need DayOfWeek enum for calendar inspection
        from java.time import DayOfWeek as JavaDayOfWeek
        _JAVA_DOW_TO_INT = {
            "MONDAY": 0, "TUESDAY": 1, "WEDNESDAY": 2,
            "THURSDAY": 3, "FRIDAY": 4, "SATURDAY": 5, "SUNDAY": 6,
        }

        for cal in project.getCalendars():
            cal_id = str(cal.getUniqueID())
            cal_name = str(cal.getName() or "Unnamed")

            # Extract working days and hours from calendar shifts
            working_days = []
            total_weekly_hours = 0.0
            day_hours_list = []

            for d in JavaDayOfWeek.values():
                hours = cal.getCalendarHours(d)
                if hours:
                    ranges = list(hours)
                    if ranges:
                        day_minutes = 0
                        for r in ranges:
                            start = r.getStart()
                            end = r.getEnd()
                            if start and end:
                                s_min = int(start.getHour()) * 60 + int(start.getMinute())
                                e_min = int(end.getHour()) * 60 + int(end.getMinute())
                                day_minutes += (e_min - s_min)
                        if day_minutes > 0:
                            day_int = _JAVA_DOW_TO_INT.get(str(d))
                            if day_int is not None:
                                working_days.append(day_int)
                            day_hours = day_minutes / 60.0
                            total_weekly_hours += day_hours
                            day_hours_list.append(day_hours)

            working_days.sort()
            hours_per_day = (sum(day_hours_list) / len(day_hours_list)) if day_hours_list else (mpd / 60.0)
            hours_per_week = total_weekly_hours if total_weekly_hours > 0 else hours_per_day * max(len(working_days), 5)

            if not working_days:
                working_days = [0, 1, 2, 3, 4]  # Fallback Mon-Fri

            # Extract calendar exceptions (holidays)
            exceptions_list = []
            java_exceptions = cal.getCalendarExceptions()
            if java_exceptions:
                for exc in list(java_exceptions):
                    is_working = bool(exc.getWorking()) if exc.getWorking() is not None else False
                    if not is_working:
                        from_date = _java_datetime_to_python(exc.getFromDate())
                        to_date = _java_datetime_to_python(exc.getToDate())
                        exc_name = str(exc.getName() or "Holiday")
                        if from_date and to_date:
                            from_d = from_date.date() if hasattr(from_date, 'date') else from_date
                            to_d = to_date.date() if hasattr(to_date, 'date') else to_date
                            exceptions_list.append(CalendarException(
                                name=exc_name,
                                start_date=from_d,
                                end_date=to_d,
                            ))

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

        # Tasks
        activity_map = {}  # Java UID -> Activity
        uid_to_id = {}     # Java UID -> activity.id

        for task in project.getTasks():
            uid = task.getUniqueID()
            if uid is None:
                continue
            uid_str = str(int(uid))

            # Skip the phantom row 0 (MSP root summary)
            if int(uid) == 0:
                continue

            name = str(task.getName() or "")
            outline_level = int(task.getOutlineLevel() or 0)

            # Determine activity type
            is_summary = bool(task.getSummary() if task.getSummary() is not None else False)
            is_milestone = bool(task.getMilestone() if task.getMilestone() is not None else False)

            duration = task.getDuration()
            dur_hours = _java_duration_to_hours(duration, mpd)
            is_zero_dur = (dur_hours is not None and dur_hours == 0)

            if is_summary:
                act_type = ActivityType.SUMMARY
            elif is_milestone or is_zero_dur:
                act_type = ActivityType.MILESTONE
            else:
                act_type = ActivityType.TASK

            # Status
            pct = float(task.getPercentageComplete() or 0)
            actual_finish = _java_datetime_to_python(task.getActualFinish())
            if pct >= 100 or actual_finish is not None:
                act_status = ActivityStatus.COMPLETED
            elif pct > 0 or _java_datetime_to_python(task.getActualStart()):
                act_status = ActivityStatus.IN_PROGRESS
            else:
                act_status = ActivityStatus.NOT_STARTED

            # Constraint
            constraint_type_java = task.getConstraintType()
            constraint_str = str(constraint_type_java) if constraint_type_java else ""
            constraint_type = _MSP_CONSTRAINT_MAP.get(
                constraint_str, ConstraintType.NONE
            )
            constraint_date = _java_datetime_to_python(task.getConstraintDate())

            # MSP defaults all tasks to SNET with constraint date = start date.
            # Detect this pattern and treat as ASAP (no real constraint).
            if constraint_type == ConstraintType.START_NO_EARLIER_THAN:
                task_start = _java_datetime_to_python(task.getStart())
                if constraint_date and task_start:
                    diff = abs((constraint_date - task_start).total_seconds())
                    if diff < 86400:  # Within 1 day = MSP default
                        constraint_type = ConstraintType.AS_SOON_AS_POSSIBLE
                        constraint_date = None

            # Float
            total_float = task.getTotalSlack()
            tf_hours = _java_duration_to_hours(total_float, mpd)
            free_float = task.getFreeSlack()
            ff_hours = _java_duration_to_hours(free_float, mpd)

            # Calendar
            task_cal = task.getCalendar()
            cal_id = str(task_cal.getUniqueID()) if task_cal else default_cal_id

            # WBS code (MSP uses outline structure, not separate WBS)
            wbs_code = str(task.getWBS() or "")

            # Build activity ID from task ID or UID
            task_id_field = task.getID()
            act_id = str(int(task_id_field)) if task_id_field else uid_str

            act = Activity(
                id=act_id,
                name=name,
                activity_type=act_type,
                status=act_status,
                wbs_id=wbs_code or None,
                wbs_path=wbs_code or None,
                planned_start=_java_datetime_to_python(task.getStart()),
                planned_finish=_java_datetime_to_python(task.getFinish()),
                actual_start=_java_datetime_to_python(task.getActualStart()),
                actual_finish=actual_finish,
                early_start=_java_datetime_to_python(task.getEarlyStart()),
                early_finish=_java_datetime_to_python(task.getEarlyFinish()),
                late_start=_java_datetime_to_python(task.getLateStart()),
                late_finish=_java_datetime_to_python(task.getLateFinish()),
                baseline_start=_java_datetime_to_python(task.getBaselineStart()),
                baseline_finish=_java_datetime_to_python(task.getBaselineFinish()),
                original_duration_hours=dur_hours,
                remaining_duration_hours=_java_duration_to_hours(
                    task.getRemainingDuration(), mpd
                ),
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
                source_format="mpp",
            )

            # ── Extended fields (stored as dynamic attributes) ────────────────
            # Expected Finish — MSP: task Deadline field (closest equivalent to P6's
            # Expected Finish). Falls back to None if not set.
            try:
                act.exp_finish = _java_datetime_to_python(task.getDeadline())
            except Exception:
                act.exp_finish = None

            # Resource assignments — primary resource ID/name + aggregated work units.
            # MSP stores Work, ActualWork, RemainingWork on assignments.
            # Units are in hours; main.py converts to days for display.
            act.resource_id   = None
            act.resource_name = None
            act.budget_units_hours    = None
            act.actual_units_hours    = None
            act.remaining_units_hours = None
            act.at_comp_units_hours   = None
            try:
                assignments = task.getResourceAssignments()
                if assignments:
                    asgn_list = list(assignments)
                    if asgn_list:
                        primary = asgn_list[0]
                        res = primary.getResource()
                        if res is not None:
                            act.resource_id   = str(res.getName() or "")
                            act.resource_name = str(res.getName() or "")
                        total_budget = 0.0
                        total_actual = 0.0
                        total_remain = 0.0
                        has_any = False
                        for asgn in asgn_list:
                            bw = _java_duration_to_hours(asgn.getWork(), mpd)
                            aw = _java_duration_to_hours(asgn.getActualWork(), mpd)
                            rw = _java_duration_to_hours(asgn.getRemainingWork(), mpd)
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
            uid_to_id[uid_str] = act.id

        # ── WBS Nodes ─────────────────────────────────────────────────────────────
        #
        # MSP has no separate WBS table. WBS names ARE the summary task names.
        # First pass: scan all tasks to build wbs_code → name map from summary tasks.
        # Second pass: build WBSNode entries and breadcrumb wbs_path for activities.
        #
        # For both MPP (binary) and MSP XML: MPXJ exposes summary tasks via
        # task.getSummary() == True. The WBS name is simply task.getName().
        # task.getWBS() returns the dotted outline code e.g. "1", "1.1", "1.1.3".

        # Step 1 — collect all summary tasks, build wbs_code → name lookup
        wbs_name_map: dict[str, str] = {}   # "1.1" → "Planning"
        wbs_level_map: dict[str, int] = {}  # "1.1" → 2
        wbs_parent_map: dict[str, str] = {} # "1.1.3" → "1.1"

        for task in project.getTasks():
            uid = task.getUniqueID()
            if uid is None or int(uid) == 0:
                continue
            is_sum = bool(task.getSummary() if task.getSummary() is not None else False)
            if not is_sum:
                continue
            wbs_code = str(task.getWBS() or "")
            name     = str(task.getName() or "")
            level    = int(task.getOutlineLevel() or 1)
            if not wbs_code:
                continue
            wbs_name_map[wbs_code]  = name
            wbs_level_map[wbs_code] = level
            # Parent = all segments except the last
            parts = wbs_code.split(".")
            parent = ".".join(parts[:-1]) if len(parts) > 1 else None
            wbs_parent_map[wbs_code] = parent

        # Step 2 — build WBSNode entries from the map
        for wbs_code, name in wbs_name_map.items():
            parent_id = wbs_parent_map.get(wbs_code)
            level     = wbs_level_map.get(wbs_code, 1)
            node = WBSNode(
                id=wbs_code,
                name=name,
                parent_id=parent_id,
                source_id=wbs_code,
            )
            node.level = level
            model.wbs_nodes.append(node)

        # Step 3 — build friendly wbs_path breadcrumb for each activity.
        # Walk up wbs_parent_map collecting names, join with " / ".
        def build_breadcrumb(code: str) -> str:
            parts = []
            cur = code
            while cur:
                nm = wbs_name_map.get(cur, "")
                if nm:
                    parts.insert(0, nm)
                cur = wbs_parent_map.get(cur)
            return " / ".join(parts) if parts else code

        # Update activities — replace bare wbs_code path with friendly breadcrumb
        for act in model.activities:
            if act.wbs_id:
                act.wbs_path = build_breadcrumb(str(act.wbs_id))

        # Relationships
        # In MPXJ, task.getPredecessors() returns Relation objects.
        # Each Relation has getPredecessorTask() and getSuccessorTask().
        # getType() returns short strings like "FS", "SS", "FF", "SF".
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

                # Relationship type — MPXJ returns "FS", "SS", "FF", "SF"
                rel_type_java = rel.getType()
                rel_type_str = str(rel_type_java) if rel_type_java else "FS"
                # Map both long and short forms
                rel_type = _MSP_REL_TYPE_MAP.get(
                    rel_type_str,
                    _MSP_REL_TYPE_MAP.get(
                        f"FINISH_START",  # fallback
                        RelationshipType.FS
                    )
                )

                # Lag
                lag = rel.getLag()
                lag_hours = _java_duration_to_hours(lag, mpd) or 0

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

        return model
