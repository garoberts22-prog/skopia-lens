"""
ScheduleCheck — ScheduleModel → CPM ScheduleNetwork Bridge

Converts the normalised ScheduleModel (from XER or MPP parsers) into the
CPM engine's ScheduleNetwork, runs the forward/backward pass, and
optionally writes results back to the ScheduleModel.

This bridge handles:
- Mapping activity IDs (strings) → item_no (ints) for the CPM engine
- Converting Calendar objects to WorkCalendar objects (work days, holidays)
- Duration conversion (hours → working days)
- Filtering: only incomplete, non-summary, non-LOE tasks
- Constraint mapping (hard constraints → fixed milestones)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

from core.models import (
    ScheduleModel, Activity, Calendar,
    ActivityStatus, ActivityType, ConstraintType, RelationshipType,
)
from cpm.models import (
    ScheduleNetwork, ScheduleItem, WorkCalendar, Link,
    ItemType, LinkType,
)
from cpm.cpm import run_cpm, CPMResult


# ── Type mappings ──

_REL_TYPE_MAP = {
    RelationshipType.FS: LinkType.FS,
    RelationshipType.SS: LinkType.SS,
    RelationshipType.FF: LinkType.FF,
    RelationshipType.SF: LinkType.SF,
}

_ACT_TYPE_MAP = {
    ActivityType.TASK: ItemType.ACTIVITY,
    ActivityType.MILESTONE: ItemType.MILESTONE,
    ActivityType.START_MILESTONE: ItemType.MILESTONE,
    ActivityType.FINISH_MILESTONE: ItemType.MILESTONE,
}


def _to_date(dt) -> Optional[date]:
    """Convert datetime or date to date."""
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.date()
    if isinstance(dt, date):
        return dt
    return None


def build_network(
    model: ScheduleModel,
) -> tuple[ScheduleNetwork, dict[str, int], dict[int, str]]:
    """
    Convert a ScheduleModel to a CPM ScheduleNetwork.

    All activities are included (completed/in-progress are locked to actual dates).

    Returns:
        (network, id_to_itemno, itemno_to_id)
        - network: The CPM ScheduleNetwork ready for run_cpm()
        - id_to_itemno: Maps activity ID (str) → item_no (int)
        - itemno_to_id: Maps item_no (int) → activity ID (str)
    """
    network = ScheduleNetwork()

    # Set project dates
    network.data_date = _to_date(model.data_date)
    network.project_start = _to_date(model.planned_start) or network.data_date
    # Fallback: if no data_date, use project_start
    if not network.data_date:
        network.data_date = network.project_start

    # ── Build calendars ──
    cal_id_map = {}  # ScheduleModel cal.id (str) → CPM calendar_id (int)
    for i, cal in enumerate(model.calendars, start=1):
        work_cal = WorkCalendar(
            calendar_id=i,
            name=cal.name,
            work_days=list(cal.working_days),
            hours_per_day=cal.hours_per_day,
        )
        # Add holidays as exceptions
        for exc in cal.exceptions:
            start = exc.start_date
            end = exc.end_date
            if isinstance(start, datetime):
                start = start.date()
            if isinstance(end, datetime):
                end = end.date()
            work_cal.exceptions.append((start, end, exc.name))

        network.calendars[i] = work_cal
        cal_id_map[cal.id] = i

    # Default calendar fallback
    default_cal_int = 1
    for cal in model.calendars:
        if cal.is_default and cal.id in cal_id_map:
            default_cal_int = cal_id_map[cal.id]
            break

    # ── Build activities → ScheduleItems ──
    id_to_itemno = {}
    itemno_to_id = {}
    item_counter = 0

    for act in model.activities:
        # Skip summaries, LOE, WBS summaries
        if act.activity_type in (
            ActivityType.SUMMARY, ActivityType.LOE,
            ActivityType.WBS_SUMMARY, ActivityType.HAMMOCK,
        ):
            continue

        item_counter += 1
        item_no = item_counter
        id_to_itemno[act.id] = item_no
        itemno_to_id[item_no] = act.id

        # Determine item type
        if act.is_milestone:
            item_type = ItemType.MILESTONE
        else:
            item_type = ItemType.ACTIVITY

        # Duration in working days
        # The ScheduleModel stores duration in hours
        cal_uid = act.calendar_id
        cal_int = cal_id_map.get(cal_uid, default_cal_int) if cal_uid else default_cal_int
        cal_obj = next((c for c in model.calendars if c.id == cal_uid), None)
        hpd = cal_obj.hours_per_day if cal_obj and cal_obj.hours_per_day > 0 else 8.0

        dur_hours = act.original_duration_hours or 0.0
        dur_days = dur_hours / hpd if hpd > 0 else 0.0

        # For completed activities: use remaining duration (0)
        # For in-progress: use remaining duration
        is_completed = (act.status == ActivityStatus.COMPLETED)
        is_in_progress = (act.status == ActivityStatus.IN_PROGRESS)

        if is_completed:
            dur_days = 0.0  # Already done
        elif is_in_progress:
            remain_hours = act.remaining_duration_hours or 0.0
            dur_days = remain_hours / hpd if hpd > 0 else 0.0

        # Constraint handling — separate into different mechanisms
        fixed_milestone = False
        nlt_date = None
        snet_date_val = None
        actual_start_val = None
        actual_finish_val = None

        if is_completed:
            # Lock to actual dates
            actual_start_val = _to_date(act.actual_start or act.early_start or act.planned_start)
            actual_finish_val = _to_date(act.actual_finish or act.early_finish or act.planned_finish)

        elif is_in_progress:
            # Lock start to actual start
            actual_start_val = _to_date(act.actual_start or act.early_start or act.planned_start)

        # Hard constraints (Must Start On, Must Finish On)
        if act.constraint_type in (
            ConstraintType.MUST_START_ON, ConstraintType.MUST_FINISH_ON,
            ConstraintType.MANDATORY_START, ConstraintType.MANDATORY_FINISH,
        ):
            fixed_milestone = True
            nlt_date = _to_date(act.constraint_date)

        # SNET: floor constraint — ES cannot be before this date
        elif act.constraint_type == ConstraintType.START_NO_EARLIER_THAN:
            if act.constraint_date:
                snet_date_val = _to_date(act.constraint_date)

        # SNLT: ceiling on start — use as NLT (latest allowable start)
        elif act.constraint_type == ConstraintType.START_NO_LATER_THAN:
            if act.constraint_date:
                nlt_date = _to_date(act.constraint_date)

        # FNLT: ceiling on finish — use as NLT constraint
        elif act.constraint_type == ConstraintType.FINISH_NO_LATER_THAN:
            if act.constraint_date:
                nlt_date = _to_date(act.constraint_date)

        # FNET: floor on finish — back-calculate to an SNET on start
        elif act.constraint_type == ConstraintType.FINISH_NO_EARLIER_THAN:
            if act.constraint_date:
                # FNET means finish >= date. Back-calculate: start >= date - duration
                fnet_date = _to_date(act.constraint_date)
                if fnet_date and dur_days > 1:
                    # Approximate: subtract dur-1 work days (simplified, no calendar lookup)
                    from datetime import timedelta
                    approx_start = fnet_date - timedelta(days=int(dur_days * 1.5))
                    snet_date_val = approx_start
                elif fnet_date:
                    snet_date_val = fnet_date

        # ALAP: ideally schedule as late as possible. For now, treat as
        # unconstrained (ASAP) — ALAP scheduling not yet implemented.
        # The skill notes this causes ~20 activity mismatches on Sample Schedule.
        elif act.constraint_type == ConstraintType.AS_LATE_AS_POSSIBLE:
            pass  # No constraint applied — scheduled ASAP by default

        item = ScheduleItem(
            item_no=item_no,
            name=act.name,
            item_type=item_type,
            duration_base=dur_days,
            calendar_id=cal_int,
            fixed_milestone=fixed_milestone,
            nlt_date=nlt_date,
            snet_date=snet_date_val,
            actual_start=actual_start_val,
            actual_finish=actual_finish_val,
            completed=is_completed,
            scope=act.wbs_path or "",
        )
        network.add_item(item)

    # ── Build relationships → Links ──
    for rel in model.relationships:
        from_no = id_to_itemno.get(rel.predecessor_id)
        to_no = id_to_itemno.get(rel.successor_id)

        if from_no is None or to_no is None:
            continue  # One end was filtered out (summary, LOE, completed)

        link_type = _REL_TYPE_MAP.get(rel.type, LinkType.FS)

        # Lag in working days
        lag_days = 0.0
        if rel.lag_hours and rel.lag_hours != 0:
            # Use the predecessor's calendar hours/day for conversion
            pred_act_id = rel.predecessor_id
            pred_act = model.get_activity(pred_act_id)
            if pred_act and pred_act.calendar_id:
                pred_cal = next(
                    (c for c in model.calendars if c.id == pred_act.calendar_id),
                    None,
                )
                hpd = pred_cal.hours_per_day if pred_cal and pred_cal.hours_per_day > 0 else 8.0
            else:
                hpd = 8.0
            lag_days = rel.lag_hours / hpd

        link = Link(
            from_id=from_no,
            to_id=to_no,
            link_type=link_type,
            lag_days=lag_days,
        )
        network.add_link(link)

    return network, id_to_itemno, itemno_to_id


def run_cpm_on_model(
    model: ScheduleModel,
) -> tuple[CPMResult, dict[int, str]]:
    """
    Run CPM on a ScheduleModel and return results.
    Always includes completed/in-progress tasks (locked to actual dates).

    Returns:
        (cpm_result, itemno_to_id)
    """
    network, id_to_itemno, itemno_to_id = build_network(model)
    result = run_cpm(network)
    return result, itemno_to_id


def compare_cpm_to_source(
    model: ScheduleModel,
    result: CPMResult,
    itemno_to_id: dict[int, str],
    tolerance_days: int = 1,
) -> dict:
    """
    Compare CPM-calculated dates against the source schedule's dates.
    Returns a comparison report dict.
    """
    act_map = {a.id: a for a in model.activities}
    network = result.network

    matches = 0
    mismatches = []
    total = 0
    es_diffs = []
    ef_diffs = []

    for item_no, item in network.items.items():
        act_id = itemno_to_id.get(item_no)
        if not act_id:
            continue
        act = act_map.get(act_id)
        if not act:
            continue

        total += 1

        # Compare early start
        source_es = _to_date(act.early_start or act.planned_start)
        cpm_es = item.early_start

        # Compare early finish
        source_ef = _to_date(act.early_finish or act.planned_finish)
        cpm_ef = item.early_finish

        es_ok = True
        ef_ok = True

        if source_es and cpm_es:
            diff_es = abs((cpm_es - source_es).days)
            es_diffs.append(diff_es)
            if diff_es > tolerance_days:
                es_ok = False
        elif source_es or cpm_es:
            es_ok = False

        if source_ef and cpm_ef:
            diff_ef = abs((cpm_ef - source_ef).days)
            ef_diffs.append(diff_ef)
            if diff_ef > tolerance_days:
                ef_ok = False
        elif source_ef or cpm_ef:
            ef_ok = False

        if es_ok and ef_ok:
            matches += 1
        else:
            mismatches.append({
                "id": act_id,
                "name": act.name[:50],
                "source_es": str(source_es) if source_es else None,
                "cpm_es": str(cpm_es) if cpm_es else None,
                "source_ef": str(source_ef) if source_ef else None,
                "cpm_ef": str(cpm_ef) if cpm_ef else None,
                "es_diff": abs((cpm_es - source_es).days) if source_es and cpm_es else None,
                "ef_diff": abs((cpm_ef - source_ef).days) if source_ef and cpm_ef else None,
            })

    # Sort mismatches by largest difference
    mismatches.sort(
        key=lambda m: max(m.get("es_diff") or 0, m.get("ef_diff") or 0),
        reverse=True,
    )

    return {
        "total_compared": total,
        "matches": matches,
        "match_pct": round(matches / total * 100, 1) if total else 0,
        "mismatches": len(mismatches),
        "avg_es_diff": round(sum(es_diffs) / len(es_diffs), 1) if es_diffs else 0,
        "avg_ef_diff": round(sum(ef_diffs) / len(ef_diffs), 1) if ef_diffs else 0,
        "max_es_diff": max(es_diffs) if es_diffs else 0,
        "max_ef_diff": max(ef_diffs) if ef_diffs else 0,
        "cpm_project_finish": str(result.project_finish) if result.project_finish else None,
        "source_project_finish": str(_to_date(model.planned_finish)) if model.planned_finish else None,
        "critical_path_count": len(result.critical_path_items),
        "top_mismatches": mismatches[:20],
    }
