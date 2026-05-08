"""
ScheduleCheck - Parser Validation Script

Run this against your real XER and MPP files to validate that
the parsers correctly extract data into the ScheduleModel.

Usage:
    python validate.py /path/to/schedule.xer
    python validate.py /path/to/schedule.mpp
    python validate.py /path/to/schedule.xer /path/to/schedule.mpp

Cross-check the output against what you see in P6 / MS Project.
Any discrepancy is a parser bug to fix before building the frontend.
"""

from __future__ import annotations

import sys
import json
from pathlib import Path
from datetime import datetime
from collections import Counter

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).parent))

from core.models import (
    ScheduleModel, Activity, Relationship,
    ActivityStatus, ActivityType, RelationshipType, ConstraintType,
)
from parsers.base import get_parser_for_file, ParseError
from parsers.xer_adapter import XERParserAdapter
from parsers.mpp_adapter import MPPParserAdapter
from checks.engine import run_health_check, CheckStatus


PARSERS = [XERParserAdapter(), MPPParserAdapter()]

DIVIDER = "=" * 70
SECTION = "-" * 50


def fmt_date(dt: datetime | None) -> str:
    return dt.strftime("%d-%b-%Y %H:%M") if dt else "—"


def fmt_pct(val: float | None) -> str:
    return f"{val:.1f}%" if val is not None else "—"


def fmt_hours(val: float | None) -> str:
    if val is None:
        return "—"
    days = val / 8.0
    return f"{val:.0f}h ({days:.1f}d)"


def validate_file(filepath: str) -> bool:
    """Parse a file and print detailed validation output."""
    path = Path(filepath)
    if not path.exists():
        print(f"\n  ✗ File not found: {filepath}")
        return False

    print(f"\n{DIVIDER}")
    print(f"  FILE: {path.name}")
    print(f"  SIZE: {path.stat().st_size:,} bytes")
    print(DIVIDER)

    # ── Parse ──
    try:
        parser = get_parser_for_file(path.name, PARSERS)
        print(f"\n  Parser: {parser.format_name}")
    except ParseError as e:
        print(f"\n  ✗ No parser for this file: {e}")
        return False

    try:
        model = parser.parse(path, filename=path.name)
    except ParseError as e:
        print(f"\n  ✗ Parse failed: {e}")
        if e.details:
            print(f"    Details: {e.details}")
        return False
    except Exception as e:
        print(f"\n  ✗ Unexpected error: {type(e).__name__}: {e}")
        return False

    print(f"  ✓ Parsed successfully\n")

    # ── Parse warnings ──
    if model.parse_warnings:
        print(f"  ⚠ Parse warnings ({len(model.parse_warnings)}):")
        for w in model.parse_warnings[:10]:
            print(f"    • {w}")
        if len(model.parse_warnings) > 10:
            print(f"    ... and {len(model.parse_warnings) - 10} more")
        print()

    # ── Project metadata ──
    print(f"  {SECTION}")
    print(f"  PROJECT METADATA")
    print(f"  {SECTION}")
    print(f"  Name:          {model.project_name}")
    print(f"  ID:            {model.project_id or '—'}")
    print(f"  Source format:  {model.source_format}")
    print(f"  Data date:     {fmt_date(model.data_date)}")
    print(f"  Project start: {fmt_date(model.planned_start)}")
    print(f"  Project finish:{fmt_date(model.planned_finish)}")
    print()

    # ── Calendars ──
    print(f"  {SECTION}")
    print(f"  CALENDARS ({len(model.calendars)})")
    print(f"  {SECTION}")
    if model.calendars:
        print(f"  {'ID':<8} {'Name':<30} {'Hrs/Day':<10} {'Hrs/Wk':<10} {'Default'}")
        for cal in model.calendars:
            default = "  ★" if cal.is_default else ""
            print(f"  {cal.id:<8} {cal.name[:29]:<30} {cal.hours_per_day:<10.1f} "
                  f"{cal.hours_per_week:<10.1f} {default}")
    else:
        print("  (no calendars found)")
    print()

    # CHECK: Cross-reference with P6/MSP
    print(f"  → VERIFY: Do calendar names and hours/day match your P6/MSP project?")
    print()

    # ── Activity summary ──
    print(f"  {SECTION}")
    print(f"  ACTIVITIES ({len(model.activities)})")
    print(f"  {SECTION}")

    type_counts = Counter(a.activity_type.value for a in model.activities)
    status_counts = Counter(a.status.value for a in model.activities)

    print(f"  By type:")
    for t, c in sorted(type_counts.items()):
        print(f"    {t:<20} {c:>6}")

    print(f"\n  By status:")
    for s, c in sorted(status_counts.items()):
        print(f"    {s:<20} {c:>6}")
    print()

    # CHECK: Total should match P6 Activity Count / MSP Task Count
    print(f"  → VERIFY: Total activity count matches P6/MSP")
    print(f"    Detail tasks (non-summary, non-LOE): "
          f"{len(model.detail_activities)}")
    print(f"    Incomplete tasks: {len(model.incomplete_tasks)}")
    print()

    # ── Sample activities ──
    print(f"  {SECTION}")
    print(f"  SAMPLE ACTIVITIES (first 15 detail tasks)")
    print(f"  {SECTION}")
    sample = [a for a in model.activities if a.is_task][:15]
    if sample:
        print(f"  {'ID':<12} {'Name':<35} {'Type':<10} {'Status':<12} "
              f"{'Dur(d)':<8} {'TF(d)':<8} {'Cstr'}")
        for a in sample:
            dur = f"{a.original_duration_days:.0f}" if a.original_duration_days is not None else "—"
            tf = f"{a.total_float_days:.0f}" if a.total_float_days is not None else "—"
            cstr = a.constraint_type.value if a.constraint_type != ConstraintType.NONE else "—"
            print(f"  {a.id:<12} {a.name[:34]:<35} {a.activity_type.value:<10} "
                  f"{a.status.value:<12} {dur:<8} {tf:<8} {cstr}")
    print()

    # CHECK: Spot-check durations and float against P6/MSP
    print(f"  → VERIFY: Pick 3-4 activities and compare Duration, Total Float,")
    print(f"    and Constraint Type against P6/MSP. If these match, the parser")
    print(f"    is working correctly.")
    print()

    # ── Relationships ──
    print(f"  {SECTION}")
    print(f"  RELATIONSHIPS ({len(model.relationships)})")
    print(f"  {SECTION}")

    rel_type_counts = Counter(r.type.value for r in model.relationships)
    print(f"  By type:")
    for t, c in sorted(rel_type_counts.items()):
        pct = (c / len(model.relationships)) * 100 if model.relationships else 0
        print(f"    {t:<8} {c:>6}  ({pct:.1f}%)")

    neg_lags = [r for r in model.relationships if r.has_negative_lag]
    pos_lags = [r for r in model.relationships if r.has_positive_lag]
    print(f"\n  Negative lags (leads):  {len(neg_lags)}")
    print(f"  Positive lags:         {len(pos_lags)}")

    if neg_lags:
        print(f"\n  Negative lag detail:")
        for r in neg_lags[:5]:
            pred = model.get_activity(r.predecessor_id)
            succ = model.get_activity(r.successor_id)
            print(f"    {r.predecessor_id} → {r.successor_id}: "
                  f"{r.type.value} lag={r.lag_hours}h "
                  f"({pred.name[:25] if pred else '?'} → "
                  f"{succ.name[:25] if succ else '?'})")
    print()

    # CHECK: Relationship count
    print(f"  → VERIFY: Total relationship count matches P6 (Relationships tab)")
    print(f"    or MSP (predecessors column). Also verify the FS/SS/FF/SF split.")
    print()

    # ── Constraints ──
    constrained = [a for a in model.incomplete_tasks
                   if a.constraint_type not in (ConstraintType.NONE,
                                                 ConstraintType.AS_SOON_AS_POSSIBLE)]
    print(f"  {SECTION}")
    print(f"  CONSTRAINTS ({len(constrained)} constrained incomplete tasks)")
    print(f"  {SECTION}")

    cstr_counts = Counter(a.constraint_type.value for a in constrained)
    for t, c in sorted(cstr_counts.items()):
        print(f"    {t:<8} {c:>6}")

    if constrained:
        print(f"\n  Detail (first 10):")
        for a in constrained[:10]:
            hard = " ← HARD" if a.has_hard_constraint else ""
            print(f"    {a.id:<12} {a.constraint_type.value:<8} "
                  f"{fmt_date(a.constraint_date)}  "
                  f"{a.name[:35]}{hard}")
    print()

    # ── Float distribution ──
    print(f"  {SECTION}")
    print(f"  FLOAT DISTRIBUTION (incomplete tasks)")
    print(f"  {SECTION}")

    float_tasks = [a for a in model.incomplete_tasks
                   if a.total_float_hours is not None]

    if float_tasks:
        neg = len([a for a in float_tasks if a.total_float_hours < 0])
        zero = len([a for a in float_tasks if a.total_float_hours == 0])
        low = len([a for a in float_tasks if 0 < a.total_float_hours <= 80])
        med = len([a for a in float_tasks if 80 < a.total_float_hours <= 352])
        high = len([a for a in float_tasks if a.total_float_hours > 352])

        print(f"    Negative (<0d):      {neg:>6}")
        print(f"    Zero (0d):           {zero:>6}")
        print(f"    Low (1-10d):         {low:>6}")
        print(f"    Medium (11-44d):     {med:>6}")
        print(f"    High (>44d):         {high:>6}")
    else:
        print("    (no float data available)")
    print()

    # ══════════════════════════════════════════
    # RUN HEALTH CHECKS
    # ══════════════════════════════════════════
    print(f"\n{DIVIDER}")
    print(f"  HEALTH CHECK RESULTS")
    print(DIVIDER)

    report = run_health_check(model)

    # Overall grade
    grade_display = {
        "A": "🟢 A — Excellent",
        "B": "🟢 B — Good",
        "C": "🟡 C — Fair",
        "D": "🟠 D — Poor",
        "F": "🔴 F — Failing",
    }
    print(f"\n  OVERALL GRADE: {grade_display.get(report.overall_grade, report.overall_grade)}"
          f" ({report.overall_score}%)")
    print(f"  Pass: {report.pass_count} | Warn: {report.warn_count}"
          f" | Fail: {report.fail_count}")
    print()

    # Individual checks
    for check in report.checks:
        icon = {
            "pass": "✓",
            "fail": "✗",
            "warn": "⚠",
            "info": "ℹ",
            "error": "☠",
        }.get(check.status.value, "?")

        dcma = f" [{check.dcma_ref}]" if check.dcma_ref else ""

        metric = ""
        if check.metric_value is not None and check.threshold_value is not None:
            metric = f"  {check.metric_value}% (threshold: {check.threshold_value}%)"
        elif check.metric_value is not None:
            metric = f"  {check.metric_value}%"

        print(f"  {icon} {check.check_name}{dcma}: "
              f"{check.status.value.upper()}"
              f"{metric}"
              f"  [{check.flagged_count}/{check.population_count}]")

        if check.flagged_items and check.status in (CheckStatus.FAIL, CheckStatus.WARN):
            shown = check.flagged_items[:5]
            for fi in shown:
                val = f" = {fi.current_value}" if fi.current_value else ""
                print(f"      {fi.activity_id}: {fi.issue_type}{val}"
                      f"  [{fi.severity}]")
            if len(check.flagged_items) > 5:
                print(f"      ... +{len(check.flagged_items) - 5} more")

    print()

    # ── Export JSON for comparison ──
    json_path = path.with_suffix(".health.json")
    try:
        from api.main import _serialise_report
        with open(json_path, "w") as f:
            json.dump(_serialise_report(report), f, indent=2, default=str)
        print(f"  → Full report saved: {json_path}")
    except Exception as e:
        print(f"  → Could not save JSON report: {e}")

    print(f"\n{DIVIDER}\n")
    return True


def compare_models(model_a: ScheduleModel, model_b: ScheduleModel):
    """
    Compare two ScheduleModels side-by-side.
    Useful for: same schedule exported as XER and MPP,
    verifying both parsers produce consistent results.
    """
    print(f"\n{DIVIDER}")
    print(f"  COMPARISON: {model_a.source_filename} vs {model_b.source_filename}")
    print(DIVIDER)

    fields = [
        ("Project name", model_a.project_name, model_b.project_name),
        ("Activities", len(model_a.activities), len(model_b.activities)),
        ("Detail tasks", len(model_a.detail_activities), len(model_b.detail_activities)),
        ("Relationships", len(model_a.relationships), len(model_b.relationships)),
        ("Calendars", len(model_a.calendars), len(model_b.calendars)),
        ("Data date", fmt_date(model_a.data_date), fmt_date(model_b.data_date)),
        ("Project start", fmt_date(model_a.planned_start), fmt_date(model_b.planned_start)),
        ("Project finish", fmt_date(model_a.planned_finish), fmt_date(model_b.planned_finish)),
    ]

    print(f"\n  {'Field':<20} {'A ('+model_a.source_format+')':<25} {'B ('+model_b.source_format+')':<25} {'Match'}")
    for name, a, b in fields:
        match = "✓" if str(a) == str(b) else "✗ DIFF"
        print(f"  {name:<20} {str(a):<25} {str(b):<25} {match}")

    # Compare health check results
    report_a = run_health_check(model_a)
    report_b = run_health_check(model_b)

    print(f"\n  Health check comparison:")
    print(f"  {'Check':<25} {'A Grade':<12} {'A Score':<10} {'B Grade':<12} {'B Score':<10} {'Match'}")
    print(f"  {'Overall':<25} {report_a.overall_grade:<12} "
          f"{report_a.overall_score:<10} {report_b.overall_grade:<12} "
          f"{report_b.overall_score:<10} "
          f"{'✓' if report_a.overall_grade == report_b.overall_grade else '✗ DIFF'}")

    for ca, cb in zip(report_a.checks, report_b.checks):
        match = "✓" if ca.status == cb.status else "✗ DIFF"
        print(f"  {ca.check_name[:24]:<25} {ca.status.value:<12} "
              f"{str(ca.metric_value or ''):<10} {cb.status.value:<12} "
              f"{str(cb.metric_value or ''):<10} {match}")

    print()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("Examples:")
        print("  python validate.py my_schedule.xer")
        print("  python validate.py my_schedule.mpp")
        print("  python validate.py schedule.xer schedule.mpp  # compare both")
        sys.exit(1)

    files = sys.argv[1:]

    if len(files) == 1:
        success = validate_file(files[0])
        sys.exit(0 if success else 1)

    elif len(files) == 2:
        # Validate both individually
        for f in files:
            validate_file(f)

        # Then compare
        models = []
        for f in files:
            try:
                parser = get_parser_for_file(Path(f).name, PARSERS)
                model = parser.parse(f, filename=Path(f).name)
                models.append(model)
            except Exception as e:
                print(f"  ✗ Could not parse {f} for comparison: {e}")

        if len(models) == 2:
            compare_models(models[0], models[1])

    else:
        for f in files:
            validate_file(f)


if __name__ == "__main__":
    main()
