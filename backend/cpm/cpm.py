"""
CPM Engine — Critical Path Method Calculations

Implements:
  1. Forward Pass  — calculates Early Start / Early Finish for all items
  2. Backward Pass — calculates Late Start / Late Finish for all items
  3. Float Calculation — Total Float and Free Float
  4. Critical Path — identifies critical items (TF <= sensitivity)

Supports:
  - FS/SS/FF/SF link types with lag
  - Working-day calendars with exceptions
  - Fixed milestones (constraints)
  - As-Late-As-Possible scheduling
  - No-Later-Than date constraints
"""
from __future__ import annotations
from datetime import date, timedelta
from dataclasses import dataclass
from typing import Optional

from .models import (
    ScheduleNetwork, ScheduleItem, Link, WorkCalendar,
    ItemType, LinkType
)


@dataclass
class CPMResult:
    """Results from a CPM calculation run."""
    network: ScheduleNetwork
    project_finish: Optional[date] = None
    critical_path_items: list[int] = None
    errors: list[str] = None
    warnings: list[str] = None

    def __post_init__(self):
        if self.critical_path_items is None:
            self.critical_path_items = []
        if self.errors is None:
            self.errors = []
        if self.warnings is None:
            self.warnings = []

    def summary(self) -> str:
        lines = [
            f"CPM Result:",
            f"  Project Finish: {self.project_finish}",
            f"  Critical Items: {len(self.critical_path_items)} of {len(self.network.items)}",
            f"  Errors: {len(self.errors)}",
            f"  Warnings: {len(self.warnings)}",
        ]
        if self.critical_path_items:
            names = []
            for item_no in self.critical_path_items:
                item = self.network.items[item_no]
                names.append(f"    {item_no}: {item.name} (TF={item.total_float})")
            lines.append("  Critical Path:")
            lines.extend(names)
        return "\n".join(lines)


def _get_link_driven_date(
    pred: ScheduleItem,
    link: Link,
    calendar: WorkCalendar,
) -> date:
    """
    Calculate the date driven by a predecessor through a specific link type.

    P6 convention:
    - FS: successor starts on next work day after predecessor EF (+ lag)
    - SS: successor starts on same day as predecessor ES (+ lag)
    - FF: successor finishes on same day as predecessor EF (+ lag)
    - SF: successor finishes on same day as predecessor ES (+ lag)
    """
    lag = int(link.lag_days)

    if link.link_type == LinkType.FS:
        # FS: successor ES = next work day after pred EF + lag
        # Exception: if predecessor is a milestone (dur=0), successor starts
        # on the same day (P6 convention — milestones don't consume a day)
        base = pred.early_finish
        if base is None:
            return None
        if pred.effective_duration == 0:
            # Milestone: successor starts same day
            driven = base
        else:
            # Activity: successor starts next work day after EF
            driven = calendar.next_work_day(base)
        if lag > 0:
            driven = calendar.add_work_days(driven, lag - 1)
        return driven

    elif link.link_type == LinkType.SS:
        # SS: successor ES = pred ES + lag work days
        base = pred.early_start
        if base is None:
            return None
        if lag > 0:
            return calendar.add_work_days(base, lag)
        return base

    elif link.link_type == LinkType.FF:
        # FF: successor EF = pred EF + lag work days
        base = pred.early_finish
        if base is None:
            return None
        if lag > 0:
            return calendar.add_work_days(base, lag)
        return base

    elif link.link_type == LinkType.SF:
        # SF: successor EF = pred ES + lag work days
        base = pred.early_start
        if base is None:
            return None
        if lag > 0:
            return calendar.add_work_days(base, lag)
        return base

    return None


def _get_link_driven_date_backward(
    succ: ScheduleItem,
    link: Link,
    calendar: WorkCalendar,
) -> date:
    """
    Calculate the latest date a predecessor can have based on a successor's
    late dates through a specific link type (backward pass).

    P6 convention (inverse of forward):
    - FS: predecessor LF = prev work day before successor LS (- lag)
    - SS: predecessor LS = successor LS - lag
    - FF: predecessor LF = successor LF - lag
    - SF: predecessor LS = successor LF - lag
    """
    lag = int(link.lag_days)

    if link.link_type == LinkType.FS:
        # FS: predecessor must finish by prev work day before succ LS
        # Exception: if predecessor is a milestone, LF = succ LS (same day)
        base = succ.late_start
        if base is None:
            return None
        # We don't know if the predecessor is a milestone here, so we use
        # prev_work_day unconditionally. The backward pass LS calculation
        # will handle milestones via dur=0 → LS=LF.
        driven = calendar.prev_work_day(base)
        if lag > 0:
            driven = calendar.subtract_work_days(driven, lag - 1)
        return driven

    elif link.link_type == LinkType.SS:
        # SS: predecessor must start by succ LS - lag
        base = succ.late_start
        if base is None:
            return None
        if lag > 0:
            return calendar.subtract_work_days(base, lag)
        return base

    elif link.link_type == LinkType.FF:
        # FF: predecessor must finish by succ LF - lag
        base = succ.late_finish
        if base is None:
            return None
        if lag > 0:
            return calendar.subtract_work_days(base, lag)
        return base

    elif link.link_type == LinkType.SF:
        # SF: predecessor must start by succ LF - lag
        base = succ.late_finish
        if base is None:
            return None
        if lag > 0:
            return calendar.subtract_work_days(base, lag)
        return base

    return None


def forward_pass(network: ScheduleNetwork) -> list[str]:
    """
    Forward Pass: Calculate Early Start and Early Finish for all items.

    Rules:
    - Completed items: locked to actual_start / actual_finish (skip calculation)
    - Items with no predecessors start at project_start (or data_date)
    - ES = max(all predecessor-driven dates)
    - SNET constraint: ES = max(ES, snet_date)  — floor, not lock
    - Fixed milestones: ES = nlt_date (hard lock)
    - EF = ES + duration (in working days per item's calendar)
    - Milestones have EF = ES (zero duration)
    """
    warnings = []
    start_date = network.data_date or network.project_start or date.today()

    try:
        order = network.topological_sort()
    except ValueError as e:
        return [str(e)]

    for item_no in order:
        item = network.items[item_no]
        cal = network.get_calendar(item.calendar_id)

        # Completed activities: lock to actual dates
        if item.completed and item.actual_finish:
            item.early_start = item.actual_start or item.actual_finish
            item.early_finish = item.actual_finish
            continue

        # In-progress with actual_start: lock start, calculate finish from remaining
        if item.actual_start and not item.completed:
            item.early_start = item.actual_start
            dur = int(item.effective_duration)
            if dur <= 1:
                item.early_finish = item.early_start
            else:
                item.early_finish = cal.add_work_days(item.early_start, dur - 1)
            # Ensure EF is not before data_date
            if item.early_finish < start_date:
                item.early_finish = start_date
            continue

        preds = network.predecessors(item_no)

        # Determine Early Start
        if not preds:
            # No predecessors — start at project start
            item.early_start = start_date
        else:
            # ES = latest of all predecessor-driven dates
            candidate_dates = []
            for pred, link in preds:
                driven = _get_link_driven_date(pred, link, cal)
                if driven is not None:
                    # P6 rule: successors of completed activities cannot
                    # start before the data date
                    if pred.completed and driven < start_date:
                        driven = start_date

                    if link.link_type in (LinkType.FS, LinkType.SS):
                        candidate_dates.append(driven)
                    elif link.link_type == LinkType.FF:
                        # FF constrains finish — back-calculate start
                        dur = int(item.effective_duration)
                        if dur <= 1:
                            es_from_ff = driven
                        else:
                            es_from_ff = cal.subtract_work_days(driven, dur - 1)
                        candidate_dates.append(es_from_ff)
                    elif link.link_type == LinkType.SF:
                        # SF constrains finish — back-calculate start
                        dur = int(item.effective_duration)
                        if dur <= 1:
                            es_from_sf = driven
                        else:
                            es_from_sf = cal.subtract_work_days(driven, dur - 1)
                        candidate_dates.append(es_from_sf)

            if candidate_dates:
                item.early_start = max(candidate_dates)
            else:
                item.early_start = start_date
                warnings.append(
                    f"Item {item_no} '{item.name}': no valid predecessor dates, "
                    f"defaulting to project start"
                )

        # P6 rule: no incomplete activity starts before data date
        if item.early_start < start_date:
            item.early_start = start_date

        # Apply SNET constraint (floor — ES cannot be before this date)
        if item.snet_date and item.early_start < item.snet_date:
            item.early_start = item.snet_date

        # Apply fixed milestone constraint (hard lock)
        if item.fixed_milestone and item.nlt_date:
            item.early_start = item.nlt_date

        # Calculate Early Finish
        # P6 convention: ES is day 1 of work, EF is the last day
        # So EF = ES + (dur - 1) additional work days
        dur = int(item.effective_duration)
        if dur == 0:
            item.early_finish = item.early_start
        elif dur == 1:
            item.early_finish = item.early_start  # 1-day task finishes on start day
        else:
            item.early_finish = cal.add_work_days(item.early_start, dur - 1)

    return warnings


def backward_pass(network: ScheduleNetwork) -> list[str]:
    """
    Backward Pass: Calculate Late Start and Late Finish for all items.

    Rules:
    - Items with no successors have LF = project finish date
    - FS/FF links constrain the predecessor's FINISH (LF candidates)
    - SS/SF links constrain the predecessor's START (LS candidates)
    - When both exist, take the most restrictive combination
    - LS = LF - duration, unless a direct LS constraint is tighter
    """
    warnings = []

    # Project finish = latest Early Finish across all items
    project_finish = None
    for item in network.items.values():
        if item.early_finish and (project_finish is None or item.early_finish > project_finish):
            project_finish = item.early_finish

    if project_finish is None:
        return ["No early finish dates found — run forward pass first"]

    try:
        order = network.topological_sort()
    except ValueError as e:
        return [str(e)]

    # Process in reverse topological order
    for item_no in reversed(order):
        item = network.items[item_no]
        cal = network.get_calendar(item.calendar_id)
        dur = int(item.effective_duration)

        # Completed activities: lock late dates = early dates (zero float)
        if item.completed and item.actual_finish:
            item.late_start = item.early_start
            item.late_finish = item.early_finish
            continue

        # In-progress with locked start
        if item.actual_start and not item.completed:
            # Still need to calculate late dates from successors
            pass  # Fall through to normal backward pass logic

        succs = network.successors(item_no)

        # Separate constraints into finish-driven and start-driven
        lf_candidates = []   # dates constraining this item's Late Finish
        ls_candidates = []   # dates constraining this item's Late Start

        if not succs:
            # No successors — LF = project finish
            lf_candidates.append(project_finish)
        else:
            for succ, link in succs:
                driven = _get_link_driven_date_backward(succ, link, cal)
                if driven is None:
                    continue

                if link.link_type == LinkType.FS:
                    # FS: predecessor must FINISH by succ.late_start - lag
                    lf_candidates.append(driven)
                elif link.link_type == LinkType.FF:
                    # FF: predecessor must FINISH by succ.late_finish - lag
                    lf_candidates.append(driven)
                elif link.link_type == LinkType.SS:
                    # SS: predecessor must START by succ.late_start - lag
                    ls_candidates.append(driven)
                elif link.link_type == LinkType.SF:
                    # SF: predecessor must START by succ.late_finish - lag
                    ls_candidates.append(driven)

            if not lf_candidates and not ls_candidates:
                lf_candidates.append(project_finish)
                warnings.append(
                    f"Item {item_no} '{item.name}': no valid successor dates, "
                    f"defaulting to project finish"
                )

        # Resolve Late Finish and Late Start
        # Start with finish-driven constraints
        if lf_candidates:
            lf_from_finish = min(lf_candidates)
        else:
            lf_from_finish = project_finish

        # Derive LS from LF (P6: LS = LF - (dur-1) work days)
        if dur <= 1:
            ls_from_finish = lf_from_finish
        else:
            ls_from_finish = cal.subtract_work_days(lf_from_finish, dur - 1)

        # Check if any start-driven constraint is tighter
        if ls_candidates:
            ls_from_start = min(ls_candidates)
            # Take the earlier (more restrictive) of the two LS values
            if ls_from_start < ls_from_finish:
                item.late_start = ls_from_start
                # Derive LF from the start constraint
                if dur <= 1:
                    item.late_finish = item.late_start
                else:
                    item.late_finish = cal.add_work_days(item.late_start, dur - 1)
                # But LF can't exceed the finish-driven constraint
                if lf_candidates and item.late_finish > lf_from_finish:
                    item.late_finish = lf_from_finish
                    item.late_start = ls_from_finish
            else:
                item.late_start = ls_from_finish
                item.late_finish = lf_from_finish
        else:
            item.late_start = ls_from_finish
            item.late_finish = lf_from_finish

        # Apply NLT constraint
        if item.fixed_milestone and item.nlt_date:
            if item.late_finish > item.nlt_date:
                item.late_finish = item.nlt_date
                if dur <= 1:
                    item.late_start = item.late_finish
                else:
                    item.late_start = cal.subtract_work_days(item.late_finish, dur - 1)

    return warnings


def calculate_float(network: ScheduleNetwork) -> None:
    """
    Calculate Total Float and Free Float for all items.

    Total Float = LS - ES (or LF - EF), expressed in working days
    Free Float = min(successor ES) - EF for FS links (simplified)
    """
    for item_no, item in network.items.items():
        cal = network.get_calendar(item.calendar_id)

        # Total Float
        if item.late_finish and item.early_finish:
            item.total_float = cal.work_days_between(item.early_finish, item.late_finish)
            # If late < early, float is negative
            if item.late_finish < item.early_finish:
                item.total_float = -cal.work_days_between(item.late_finish, item.early_finish)
        else:
            item.total_float = None

        # Free Float — how much this item can slip without affecting any successor
        succs = network.successors(item_no)
        if succs and item.early_finish:
            min_gap = None
            for succ, link in succs:
                if link.link_type == LinkType.FS and succ.early_start:
                    # P6: FS gap = work days between EF and succ ES, minus 1
                    # (because the next-work-day transition is the FS link itself)
                    gap = cal.work_days_between(item.early_finish, succ.early_start)
                    gap -= 1  # The FS link accounts for 1 day
                    gap -= int(link.lag_days)
                    if min_gap is None or gap < min_gap:
                        min_gap = gap
            item.free_float = max(0, min_gap) if min_gap is not None else item.total_float
        else:
            item.free_float = item.total_float


def identify_critical_path(
    network: ScheduleNetwork,
    sensitivity: float = None,
) -> list[int]:
    """
    Identify critical path items.
    An item is critical if Total Float <= sensitivity (default from settings).
    """
    if sensitivity is None:
        sensitivity = network.float_sensitivity_days

    critical = []
    for item_no, item in network.items.items():
        if item.total_float is not None and item.total_float <= sensitivity:
            item.is_critical = True
            critical.append(item_no)
        else:
            item.is_critical = False

    return critical


def run_cpm(network: ScheduleNetwork) -> CPMResult:
    """
    Run the full CPM calculation:
      1. Forward Pass
      2. Backward Pass
      3. Float Calculation
      4. Critical Path Identification
    """
    result = CPMResult(network=network)

    # Forward pass
    fw_warnings = forward_pass(network)
    result.warnings.extend(fw_warnings)

    # Backward pass
    bw_warnings = backward_pass(network)
    result.warnings.extend(bw_warnings)

    # Float
    calculate_float(network)

    # Critical path
    result.critical_path_items = identify_critical_path(network)

    # Project finish
    result.project_finish = None
    for item in network.items.values():
        if item.early_finish:
            if result.project_finish is None or item.early_finish > result.project_finish:
                result.project_finish = item.early_finish

    return result
