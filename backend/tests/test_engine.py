"""
ScheduleCheck - Health Check Engine Tests

Tests the analysis engine using synthetic ScheduleModel data.
No actual XER/MPP files needed — validates pure check logic.
"""

import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.models import (
    ScheduleModel, Activity, Relationship, Calendar,
    ActivityStatus, ActivityType, RelationshipType, ConstraintType,
)
from checks.engine import (
    check_logic_completeness,
    check_leads,
    check_lags,
    check_relationship_types,
    check_hard_constraints,
    check_high_float,
    check_negative_float,
    check_duration,
    check_calendar_validation,
    run_health_check,
    CheckStatus,
)


def build_clean_schedule() -> ScheduleModel:
    """
    Build a synthetic 'clean' schedule that passes all checks.
    10 activities, fully linked FS, no constraints, reasonable float.
    """
    model = ScheduleModel(
        project_name="Test Project - Clean",
        source_format="test",
    )

    model.calendars.append(Calendar(
        id="1", name="Standard", hours_per_day=8, hours_per_week=40,
        is_default=True,
    ))

    # 10 sequential activities, fully linked
    for i in range(1, 11):
        act = Activity(
            id=f"A{i:04d}",
            name=f"Activity {i}",
            activity_type=ActivityType.TASK,
            status=ActivityStatus.NOT_STARTED,
            original_duration_hours=40.0,  # 5 days
            total_float_hours=80.0,         # 10 days (reasonable)
            calendar_id="1",
            constraint_type=ConstraintType.NONE,
        )
        model.activities.append(act)

    # Wire up FS relationships: A0001→A0002→...→A0010
    for i in range(1, 10):
        pred = model.activities[i - 1]
        succ = model.activities[i]
        rel = Relationship(
            predecessor_id=pred.id,
            successor_id=succ.id,
            type=RelationshipType.FS,
            lag_hours=0,
        )
        model.relationships.append(rel)
        pred.successors.append(rel)
        succ.predecessors.append(rel)

    return model


def build_dirty_schedule() -> ScheduleModel:
    """
    Build a synthetic 'dirty' schedule with multiple check failures.
    Used to validate that checks correctly detect issues.
    """
    model = ScheduleModel(
        project_name="Test Project - Dirty",
        source_format="test",
    )

    model.calendars.append(Calendar(
        id="1", name="Standard", hours_per_day=8, hours_per_week=40,
        is_default=True,
    ))

    # Activity 1: Missing predecessor (open start)
    a1 = Activity(
        id="D001", name="Open Start Activity",
        activity_type=ActivityType.TASK,
        status=ActivityStatus.NOT_STARTED,
        original_duration_hours=40,
        total_float_hours=80,
        calendar_id="1",
    )

    # Activity 2: Normal
    a2 = Activity(
        id="D002", name="Normal Activity",
        activity_type=ActivityType.TASK,
        status=ActivityStatus.NOT_STARTED,
        original_duration_hours=40,
        total_float_hours=80,
        calendar_id="1",
    )

    # Activity 3: Missing successor (open end)
    a3 = Activity(
        id="D003", name="Open End Activity",
        activity_type=ActivityType.TASK,
        status=ActivityStatus.NOT_STARTED,
        original_duration_hours=40,
        total_float_hours=80,
        calendar_id="1",
    )

    # Activity 4: Hard constraint
    a4 = Activity(
        id="D004", name="Hard Constrained Activity",
        activity_type=ActivityType.TASK,
        status=ActivityStatus.NOT_STARTED,
        original_duration_hours=40,
        total_float_hours=80,
        constraint_type=ConstraintType.MUST_START_ON,
        calendar_id="1",
    )

    # Activity 5: Negative float
    a5 = Activity(
        id="D005", name="Negative Float Activity",
        activity_type=ActivityType.TASK,
        status=ActivityStatus.NOT_STARTED,
        original_duration_hours=40,
        total_float_hours=-40,  # -5 days
        calendar_id="1",
    )

    # Activity 6: High float
    a6 = Activity(
        id="D006", name="High Float Activity",
        activity_type=ActivityType.TASK,
        status=ActivityStatus.NOT_STARTED,
        original_duration_hours=40,
        total_float_hours=800,  # 100 days
        calendar_id="1",
    )

    # Activity 7: Long duration
    a7 = Activity(
        id="D007", name="Long Duration Activity",
        activity_type=ActivityType.TASK,
        status=ActivityStatus.NOT_STARTED,
        original_duration_hours=480,  # 60 days
        total_float_hours=80,
        calendar_id="1",
    )

    # Activity 8: Invalid calendar
    a8 = Activity(
        id="D008", name="Bad Calendar Activity",
        activity_type=ActivityType.TASK,
        status=ActivityStatus.NOT_STARTED,
        original_duration_hours=40,
        total_float_hours=80,
        calendar_id="999",  # Doesn't exist
    )

    model.activities = [a1, a2, a3, a4, a5, a6, a7, a8]

    # Relationships: only a1→a2 (leaves a3 dangling)
    # Also add one negative lag and one SF relationship
    r1 = Relationship(
        predecessor_id="D001", successor_id="D002",
        type=RelationshipType.FS, lag_hours=0,
    )
    r2 = Relationship(
        predecessor_id="D002", successor_id="D003",
        type=RelationshipType.FS, lag_hours=-16,  # Negative lag!
    )
    r3 = Relationship(
        predecessor_id="D004", successor_id="D005",
        type=RelationshipType.SF,  # SF relationship!
        lag_hours=0,
    )
    r4 = Relationship(
        predecessor_id="D005", successor_id="D006",
        type=RelationshipType.FS, lag_hours=80,  # 10-day lag
    )
    r5 = Relationship(
        predecessor_id="D006", successor_id="D007",
        type=RelationshipType.SS, lag_hours=0,
    )

    model.relationships = [r1, r2, r3, r4, r5]

    # Wire relationships onto activities
    a1.successors.append(r1)
    a2.predecessors.append(r1)
    a2.successors.append(r2)
    a3.predecessors.append(r2)
    # a3 has no successor (dangling)
    a4.successors.append(r3)
    a5.predecessors.append(r3)
    a5.successors.append(r4)
    a6.predecessors.append(r4)
    a6.successors.append(r5)
    a7.predecessors.append(r5)
    # a1 has no predecessor (dangling)
    # a7 has no successor (dangling)
    # a8 has no relationships at all

    return model


def run_tests():
    print("=" * 60)
    print("ScheduleCheck - Health Check Engine Tests")
    print("=" * 60)

    # ── Clean schedule tests ──
    print("\n--- Clean Schedule Tests ---")
    clean = build_clean_schedule()
    report = run_health_check(clean)

    passed = 0
    failed = 0

    # Clean schedule: first and last activities are allowed to be
    # open-ended (start/finish of chain), but by default DCMA still
    # flags them. So logic check may flag 2 out of 10.
    # The important thing is the engine RUNS without errors.

    for check in report.checks:
        status_icon = {
            "pass": "✓",
            "fail": "✗",
            "warn": "⚠",
            "info": "ℹ",
            "error": "☠",
        }.get(check.status.value, "?")

        print(f"  {status_icon} {check.check_name}: {check.status.value}"
              f" ({check.metric_value}% vs {check.threshold_value}%)"
              f" [{check.flagged_count} flagged of {check.population_count}]")

    print(f"\n  Overall: {report.overall_grade} ({report.overall_score}%)")
    print(f"  Pass: {report.pass_count} | Warn: {report.warn_count}"
          f" | Fail: {report.fail_count}")

    # ── Dirty schedule tests ──
    print("\n--- Dirty Schedule Tests ---")
    dirty = build_dirty_schedule()
    report_dirty = run_health_check(dirty)

    for check in report_dirty.checks:
        status_icon = {
            "pass": "✓",
            "fail": "✗",
            "warn": "⚠",
            "info": "ℹ",
            "error": "☠",
        }.get(check.status.value, "?")

        print(f"  {status_icon} {check.check_name}: {check.status.value}"
              f" ({check.metric_value}% vs {check.threshold_value}%)"
              f" [{check.flagged_count} flagged of {check.population_count}]")

        if check.flagged_items:
            for fi in check.flagged_items[:3]:
                print(f"      → {fi.activity_id}: {fi.issue_type}"
                      f" [{fi.severity}]"
                      f" {fi.current_value or ''}")

    print(f"\n  Overall: {report_dirty.overall_grade}"
          f" ({report_dirty.overall_score}%)")
    print(f"  Pass: {report_dirty.pass_count} | Warn: {report_dirty.warn_count}"
          f" | Fail: {report_dirty.fail_count}")

    # ── Assertions ──
    print("\n--- Assertions ---")
    tests = [
        ("Clean schedule has grade A or B",
         report.overall_grade in ("A", "B")),
        ("Dirty schedule has grade D or F",
         report_dirty.overall_grade in ("D", "F")),
        ("Dirty: leads check fails",
         any(c.check_id == "leads" and c.status == CheckStatus.FAIL
             for c in report_dirty.checks)),
        ("Dirty: negative float check fails",
         any(c.check_id == "negative_float" and c.status == CheckStatus.FAIL
             for c in report_dirty.checks)),
        ("Dirty: hard constraints check flags D004",
         any(c.check_id == "hard_constraints" and c.flagged_count > 0
             for c in report_dirty.checks)),
        ("Dirty: high float check flags D006",
         any(c.check_id == "high_float" and c.flagged_count > 0
             for c in report_dirty.checks)),
        ("Dirty: calendar check warns about D008",
         any(c.check_id == "calendar_validation" and c.flagged_count > 0
             for c in report_dirty.checks)),
        ("Dirty: duration check flags D007",
         any(c.check_id == "duration" and c.flagged_count > 0
             for c in report_dirty.checks)),
        ("Dirty: relationship types flags SF",
         any(c.check_id == "relationship_types" and c.flagged_count > 0
             for c in report_dirty.checks)),
    ]

    all_passed = True
    for desc, result in tests:
        icon = "✓" if result else "✗"
        print(f"  {icon} {desc}")
        if not result:
            all_passed = False

    print(f"\n{'=' * 60}")
    print(f"{'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")
    print(f"{'=' * 60}")

    return all_passed


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
