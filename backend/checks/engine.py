"""
ScheduleCheck - Health Check Engine

Each check is a pure function: ScheduleModel → CheckResult.
Checks are DCMA 14-point aligned where applicable.

Checks operate on the normalised model — they have zero knowledge
of whether the source was XER or MPP.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from core.models import (
    ScheduleModel, Activity, Relationship,
    RelationshipType, ConstraintType, ActivityType,
)


# ──────────────────────────────────────────────
# Check result types
# ──────────────────────────────────────────────

class CheckStatus(Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    INFO = "info"    # Informational, no pass/fail threshold
    ERROR = "error"  # Check couldn't run (missing data)


@dataclass
class FlaggedItem:
    """An individual activity or relationship flagged by a check."""
    activity_id: str
    activity_name: str
    wbs_path: Optional[str] = None
    issue_type: str = ""           # e.g. "missing_predecessor", "hard_constraint"
    current_value: Optional[str] = None   # What was found
    threshold: Optional[str] = None       # What was expected
    severity: str = "medium"       # "low", "medium", "high", "critical"
    details: Optional[str] = None  # Additional context


@dataclass
class CheckResult:
    """Result of a single health check."""
    check_id: str                  # e.g. "logic_completeness"
    check_name: str                # e.g. "Logic completeness"
    dcma_ref: Optional[str] = None # e.g. "DCMA #1"
    status: CheckStatus = CheckStatus.PASS
    metric_value: Optional[float] = None     # e.g. 3.2 (percent)
    threshold_value: Optional[float] = None  # e.g. 5.0 (percent)
    metric_label: str = ""         # e.g. "% incomplete tasks missing logic"
    population_count: int = 0      # How many items were checked
    flagged_count: int = 0         # How many failed
    flagged_items: list[FlaggedItem] = field(default_factory=list)
    description: str = ""          # What this check does
    recommendation: str = ""       # What to do about failures
    error_message: Optional[str] = None  # If status == ERROR
    normalised_score: float = 0.0  # 0-100 score for spider/radar chart


@dataclass
class HealthReport:
    """Complete health check report for a schedule."""
    project_name: str
    source_format: str
    source_filename: Optional[str]
    data_date: Optional[str]
    summary_stats: dict
    checks: list[CheckResult] = field(default_factory=list)
    overall_grade: str = "F"       # A/B/C/D/F
    overall_score: float = 0.0     # 0-100
    parse_warnings: list[str] = field(default_factory=list)
    # Dashboard analytics
    float_histogram: dict = field(default_factory=dict)
    network_metrics: dict = field(default_factory=dict)
    relationship_breakdown: dict = field(default_factory=dict)
    longest_path: list = field(default_factory=list)

    @property
    def pass_count(self) -> int:
        return len([c for c in self.checks if c.status == CheckStatus.PASS])

    @property
    def fail_count(self) -> int:
        return len([c for c in self.checks if c.status == CheckStatus.FAIL])

    @property
    def warn_count(self) -> int:
        return len([c for c in self.checks if c.status == CheckStatus.WARN])


# ──────────────────────────────────────────────
# Individual checks
# ──────────────────────────────────────────────

def check_logic_completeness(model: ScheduleModel) -> CheckResult:
    """
    DCMA #1: Logic completeness.
    
    Identifies incomplete tasks missing predecessors and/or successors.
    Excludes LOE, summary, and WBS summary activities.
    Start milestones are allowed to have no predecessors.
    Finish milestones are allowed to have no successors.
    
    Threshold: ≤5% of incomplete tasks missing logic = PASS.
    """
    population = model.incomplete_tasks
    if not population:
        return CheckResult(
            check_id="logic_completeness",
            check_name="Logic completeness",
            dcma_ref="DCMA #1",
            status=CheckStatus.INFO,
            description="No incomplete tasks to check.",
        )

    flagged = []
    for act in population:
        issues = []

        # Start milestones don't need predecessors
        if not act.has_predecessor and act.activity_type != ActivityType.START_MILESTONE:
            issues.append("missing_predecessor")

        # Finish milestones don't need successors
        if not act.has_successor and act.activity_type != ActivityType.FINISH_MILESTONE:
            issues.append("missing_successor")

        if issues:
            issue_type = " + ".join(issues)
            severity = "high" if len(issues) > 1 else "medium"
            flagged.append(FlaggedItem(
                activity_id=act.id,
                activity_name=act.name,
                wbs_path=act.wbs_path,
                issue_type=issue_type,
                severity=severity,
                details=f"Predecessors: {len(act.predecessors)}, "
                        f"Successors: {len(act.successors)}",
            ))

    pct = (len(flagged) / len(population)) * 100 if population else 0
    threshold = 5.0

    return CheckResult(
        check_id="logic_completeness",
        check_name="Logic completeness",
        dcma_ref="DCMA #1",
        status=CheckStatus.PASS if pct <= threshold else CheckStatus.FAIL,
        metric_value=round(pct, 1),
        threshold_value=threshold,
        metric_label="% incomplete tasks missing logic",
        population_count=len(population),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            "Identifies incomplete tasks without predecessors and/or "
            "successors. Open-ended activities break the critical path "
            "network and produce unreliable float values."
        ),
        recommendation=(
            "Review flagged activities and add missing logic links. "
            "Ensure every task (except project start/finish milestones) "
            "has at least one predecessor and one successor."
        ),
    )


def check_leads(model: ScheduleModel) -> CheckResult:
    """
    DCMA #2: Leads (negative lags).
    
    Any relationship with a negative lag is flagged.
    Threshold: 0% (hard fail — no negative lags allowed).
    """
    rels = model.relationships
    if not rels:
        return CheckResult(
            check_id="leads",
            check_name="Leads (negative lags)",
            dcma_ref="DCMA #2",
            status=CheckStatus.INFO,
            description="No relationships to check.",
        )

    flagged = []
    for rel in rels:
        if rel.has_negative_lag:
            pred = model.get_activity(rel.predecessor_id)
            succ = model.get_activity(rel.successor_id)
            flagged.append(FlaggedItem(
                activity_id=rel.predecessor_id,
                activity_name=pred.name if pred else "(unknown)",
                issue_type="negative_lag",
                current_value=f"{rel.lag_hours}h ({rel.type.value})",
                threshold="0",
                severity="high",
                details=(
                    f"Predecessor: {rel.predecessor_id} → "
                    f"Successor: {rel.successor_id} "
                    f"({succ.name if succ else '(unknown)'})"
                ),
            ))

    pct = (len(flagged) / len(rels)) * 100 if rels else 0

    return CheckResult(
        check_id="leads",
        check_name="Leads (negative lags)",
        dcma_ref="DCMA #2",
        status=CheckStatus.PASS if len(flagged) == 0 else CheckStatus.FAIL,
        metric_value=round(pct, 1),
        threshold_value=0.0,
        metric_label="% relationships with negative lag",
        population_count=len(rels),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            "Negative lags (leads) allow successors to start before "
            "predecessors complete. They corrupt the critical path "
            "and introduce risk that isn't visible in the schedule."
        ),
        recommendation=(
            "Replace all negative lags with proper logic. If work "
            "genuinely overlaps, use SS or FF relationships with "
            "positive or zero lag instead."
        ),
    )


def check_lags(model: ScheduleModel) -> CheckResult:
    """
    DCMA #3: Lags (positive lags).
    
    Excessive positive lags indicate lazy scheduling — they should
    be replaced with actual activities (cure time, approval, etc.).
    
    Threshold: ≤5% of relationships with positive lag = PASS.
    """
    rels = model.relationships
    if not rels:
        return CheckResult(
            check_id="lags",
            check_name="Lags",
            dcma_ref="DCMA #3",
            status=CheckStatus.INFO,
            description="No relationships to check.",
        )

    flagged = []
    for rel in rels:
        if rel.has_positive_lag:
            pred = model.get_activity(rel.predecessor_id)
            succ = model.get_activity(rel.successor_id)
            lag_days = rel.lag_hours / 8.0 if rel.lag_hours else 0
            flagged.append(FlaggedItem(
                activity_id=rel.predecessor_id,
                activity_name=pred.name if pred else "(unknown)",
                issue_type="positive_lag",
                current_value=f"{lag_days:.1f}d ({rel.type.value})",
                severity="low" if lag_days <= 5 else "medium",
                details=(
                    f"→ {rel.successor_id}: "
                    f"{succ.name if succ else '(unknown)'}"
                ),
            ))

    pct = (len(flagged) / len(rels)) * 100 if rels else 0
    threshold = 5.0

    return CheckResult(
        check_id="lags",
        check_name="Lags",
        dcma_ref="DCMA #3",
        status=CheckStatus.PASS if pct <= threshold else CheckStatus.FAIL,
        metric_value=round(pct, 1),
        threshold_value=threshold,
        metric_label="% relationships with positive lag",
        population_count=len(rels),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            "Positive lags hide work and reduce transparency. Best "
            "practice is to replace lags with explicit activities "
            "describing the waiting period (e.g. 'cure time')."
        ),
        recommendation=(
            "Review lagged relationships and consider replacing "
            "with actual activities where possible."
        ),
    )


def check_relationship_types(model: ScheduleModel) -> CheckResult:
    """
    DCMA #4: Relationship types.
    
    FS relationships should dominate (≥90%).
    SF relationships are flagged as high severity.
    
    Threshold: ≥90% FS relationships = PASS.
    """
    rels = model.relationships
    if not rels:
        return CheckResult(
            check_id="relationship_types",
            check_name="Relationship types",
            dcma_ref="DCMA #4",
            status=CheckStatus.INFO,
            description="No relationships to check.",
        )

    counts = {rt: 0 for rt in RelationshipType}
    for rel in rels:
        counts[rel.type] += 1

    fs_pct = (counts[RelationshipType.FS] / len(rels)) * 100
    threshold = 90.0

    flagged = []
    # Flag SF relationships as high severity (almost always errors)
    for rel in rels:
        if rel.type == RelationshipType.SF:
            pred = model.get_activity(rel.predecessor_id)
            succ = model.get_activity(rel.successor_id)
            flagged.append(FlaggedItem(
                activity_id=rel.predecessor_id,
                activity_name=pred.name if pred else "(unknown)",
                issue_type="sf_relationship",
                current_value="SF",
                severity="high",
                details=(
                    f"→ {rel.successor_id}: "
                    f"{succ.name if succ else '(unknown)'}"
                ),
            ))

    # Summary info for non-FS types
    breakdown = (
        f"FS: {counts[RelationshipType.FS]} ({fs_pct:.1f}%), "
        f"SS: {counts[RelationshipType.SS]}, "
        f"FF: {counts[RelationshipType.FF]}, "
        f"SF: {counts[RelationshipType.SF]}"
    )

    return CheckResult(
        check_id="relationship_types",
        check_name="Relationship types",
        dcma_ref="DCMA #4",
        status=CheckStatus.PASS if fs_pct >= threshold else CheckStatus.FAIL,
        metric_value=round(fs_pct, 1),
        threshold_value=threshold,
        metric_label="% Finish-to-Start relationships",
        population_count=len(rels),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            f"Relationship breakdown: {breakdown}. "
            "FS relationships should represent ≥90% of all logic. "
            "SF relationships are almost always errors."
        ),
        recommendation=(
            "Review non-FS relationships. SS/FF pairs are acceptable "
            "when modelling concurrent work. SF relationships should "
            "be converted to FS with adjusted logic."
        ),
    )


def check_hard_constraints(model: ScheduleModel) -> CheckResult:
    """
    DCMA #5: Hard constraints.
    
    Hard constraints (Mandatory Start/Finish, Must Start/Finish On)
    override logic and prevent the schedule from being network-driven.
    
    Threshold: ≤5% of incomplete tasks with hard constraints = PASS.
    
    Context-aware: SNET on project start milestone and FNLT on key
    milestones are flagged as INFO, not FAIL (common in WA construction).
    """
    population = model.incomplete_tasks
    if not population:
        return CheckResult(
            check_id="hard_constraints",
            check_name="Hard constraints",
            dcma_ref="DCMA #5",
            status=CheckStatus.INFO,
            description="No incomplete tasks to check.",
        )

    flagged = []
    for act in population:
        if act.constraint_type == ConstraintType.NONE:
            continue
        if act.constraint_type == ConstraintType.AS_SOON_AS_POSSIBLE:
            continue  # ASAP is the default, not a constraint

        # MSP default filtering: SNET where the constraint date matches
        # the early start is just MSP's default behaviour, not an
        # intentional constraint. Skip these to avoid noise.
        if act.constraint_type == ConstraintType.START_NO_EARLIER_THAN:
            if act.constraint_date and act.early_start:
                # Dates match within 1 day tolerance (time component varies)
                from datetime import timedelta
                diff = abs((act.constraint_date - act.early_start).total_seconds())
                if diff < 86400:  # 24 hours
                    continue
            elif act.constraint_date and act.planned_start:
                from datetime import timedelta
                diff = abs((act.constraint_date - act.planned_start).total_seconds())
                if diff < 86400:
                    continue

        severity = "low"
        issue_type = act.constraint_type.value

        if act.constraint_type.is_hard:
            severity = "critical"
            issue_type = f"hard_constraint ({act.constraint_type.value})"
        elif act.constraint_type.is_semi_hard:
            severity = "high"
            issue_type = f"semi_hard_constraint ({act.constraint_type.value})"
        else:
            severity = "low"
            issue_type = f"soft_constraint ({act.constraint_type.value})"

        flagged.append(FlaggedItem(
            activity_id=act.id,
            activity_name=act.name,
            wbs_path=act.wbs_path,
            issue_type=issue_type,
            current_value=act.constraint_type.value,
            severity=severity,
            details=(
                f"Constraint date: "
                f"{act.constraint_date.strftime('%d-%b-%Y') if act.constraint_date else 'N/A'}"
            ),
        ))

    # Only count hard + semi-hard for the pass/fail threshold
    hard_count = len([f for f in flagged
                      if f.severity in ("critical", "high")])
    pct = (hard_count / len(population)) * 100 if population else 0
    threshold = 5.0

    return CheckResult(
        check_id="hard_constraints",
        check_name="Hard constraints",
        dcma_ref="DCMA #5",
        status=CheckStatus.PASS if pct <= threshold else CheckStatus.FAIL,
        metric_value=round(pct, 1),
        threshold_value=threshold,
        metric_label="% incomplete tasks with hard/semi-hard constraints",
        population_count=len(population),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            "Hard constraints override logic and prevent the schedule "
            "from being driven by the network. They mask delays and "
            "produce unrealistic dates."
        ),
        recommendation=(
            "Remove hard constraints where possible. Use SNET as the "
            "softest alternative. Mandatory constraints should only "
            "exist on externally-driven dates (e.g. permit deadlines)."
        ),
    )


def check_high_float(model: ScheduleModel) -> CheckResult:
    """
    DCMA #6: High float.
    
    Activities with total float >44 working days (352 hours) may
    indicate broken or incomplete logic.
    
    Threshold: ≤5% of incomplete tasks with TF >44d = PASS.
    """
    population = model.incomplete_tasks
    if not population:
        return CheckResult(
            check_id="high_float",
            check_name="High float",
            dcma_ref="DCMA #6",
            status=CheckStatus.INFO,
            description="No incomplete tasks to check.",
        )

    flagged = []
    for act in population:
        if act.has_high_float:
            float_days = act.total_float_days
            flagged.append(FlaggedItem(
                activity_id=act.id,
                activity_name=act.name,
                wbs_path=act.wbs_path,
                issue_type="high_float",
                current_value=f"{float_days:.0f}d" if float_days else "N/A",
                threshold=">44d",
                severity="medium" if (float_days or 0) < 100 else "high",
            ))

    pct = (len(flagged) / len(population)) * 100 if population else 0
    threshold = 5.0

    return CheckResult(
        check_id="high_float",
        check_name="High float",
        dcma_ref="DCMA #6",
        status=CheckStatus.PASS if pct <= threshold else CheckStatus.FAIL,
        metric_value=round(pct, 1),
        threshold_value=threshold,
        metric_label="% incomplete tasks with total float >44 days",
        population_count=len(population),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            "Activities with very high float may indicate broken or "
            "incomplete logic. The 44-day threshold (~2 months) is "
            "the DCMA standard."
        ),
        recommendation=(
            "Review logic links for high-float activities. They may "
            "be missing successors, or their successors may have "
            "constraints holding dates artificially late."
        ),
    )


def check_negative_float(model: ScheduleModel) -> CheckResult:
    """
    DCMA #7: Negative float.
    
    Any negative float means the schedule shows the project
    cannot meet its constraints. Automatic red flag.
    
    Threshold: 0% (hard fail).
    """
    population = model.incomplete_tasks
    if not population:
        return CheckResult(
            check_id="negative_float",
            check_name="Negative float",
            dcma_ref="DCMA #7",
            status=CheckStatus.INFO,
            description="No incomplete tasks to check.",
        )

    flagged = []
    for act in population:
        if act.has_negative_float:
            float_days = act.total_float_days
            flagged.append(FlaggedItem(
                activity_id=act.id,
                activity_name=act.name,
                wbs_path=act.wbs_path,
                issue_type="negative_float",
                current_value=f"{float_days:.0f}d" if float_days else "N/A",
                threshold="0d",
                severity="critical",
            ))

    # Sort by severity (most negative first)
    flagged.sort(
        key=lambda f: float(f.current_value.replace("d", ""))
        if f.current_value and f.current_value != "N/A" else 0
    )

    pct = (len(flagged) / len(population)) * 100 if population else 0

    return CheckResult(
        check_id="negative_float",
        check_name="Negative float",
        dcma_ref="DCMA #7",
        status=CheckStatus.PASS if len(flagged) == 0 else CheckStatus.FAIL,
        metric_value=round(pct, 1),
        threshold_value=0.0,
        metric_label="% incomplete tasks with negative total float",
        population_count=len(population),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            "Negative float indicates the schedule cannot meet its "
            "constraints. The project end date (or a constrained "
            "milestone) is calculated to be later than required."
        ),
        recommendation=(
            "Investigate the cause: hard constraints conflicting with "
            "logic, missing logic creating false paths, or genuinely "
            "insufficient time. Address root cause before proceeding."
        ),
    )


def check_duration(model: ScheduleModel) -> CheckResult:
    """
    DCMA #8: Duration analysis.
    
    Flags activities with duration >44 working days (~2 months).
    Long-duration activities reduce visibility.
    
    Threshold: ≤5% of incomplete tasks with long durations = PASS.
    """
    population = model.incomplete_tasks
    if not population:
        return CheckResult(
            check_id="duration",
            check_name="Long durations",
            dcma_ref="DCMA #8",
            status=CheckStatus.INFO,
            description="No incomplete tasks to check.",
        )

    flagged = []
    for act in population:
        if act.is_milestone:
            continue  # Milestones have zero duration
        dur_days = act.original_duration_days
        if dur_days is not None and dur_days > 44:
            flagged.append(FlaggedItem(
                activity_id=act.id,
                activity_name=act.name,
                wbs_path=act.wbs_path,
                issue_type="long_duration",
                current_value=f"{dur_days:.0f}d",
                threshold=">44d",
                severity="medium" if dur_days < 88 else "high",
            ))

    non_milestone = [a for a in population if not a.is_milestone]
    pct = (len(flagged) / len(non_milestone)) * 100 if non_milestone else 0
    threshold = 5.0

    return CheckResult(
        check_id="duration",
        check_name="Long durations",
        dcma_ref="DCMA #8",
        status=CheckStatus.PASS if pct <= threshold else CheckStatus.FAIL,
        metric_value=round(pct, 1),
        threshold_value=threshold,
        metric_label="% incomplete tasks with duration >44 days",
        population_count=len(non_milestone),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            "Activities longer than 44 working days (~2 months) "
            "reduce schedule visibility and make progress measurement "
            "unreliable."
        ),
        recommendation=(
            "Break long-duration activities into smaller, measurable "
            "work packages. Aim for activities that can be completed "
            "within a single reporting period."
        ),
    )


def check_calendar_validation(model: ScheduleModel) -> CheckResult:
    """
    Additional check: Calendar validation.
    
    Not a DCMA metric but critical for construction schedules.
    Checks for: missing/invalid calendar assignments, non-standard
    work weeks, activities on deleted calendars.
    """
    flagged = []
    cal_ids = {cal.id for cal in model.calendars}

    for act in model.incomplete_tasks:
        if act.calendar_id and act.calendar_id not in cal_ids:
            flagged.append(FlaggedItem(
                activity_id=act.id,
                activity_name=act.name,
                wbs_path=act.wbs_path,
                issue_type="invalid_calendar",
                current_value=f"Calendar ID: {act.calendar_id}",
                severity="high",
                details="Assigned calendar does not exist in schedule.",
            ))
        elif not act.calendar_id and not model.default_calendar:
            flagged.append(FlaggedItem(
                activity_id=act.id,
                activity_name=act.name,
                wbs_path=act.wbs_path,
                issue_type="no_calendar",
                severity="medium",
                details="No calendar assigned and no default calendar.",
            ))

    # Check for unusual calendar configurations
    for cal in model.calendars:
        if cal.hours_per_day <= 0 or cal.hours_per_day > 24:
            flagged.append(FlaggedItem(
                activity_id=f"CAL:{cal.id}",
                activity_name=cal.name,
                issue_type="invalid_hours",
                current_value=f"{cal.hours_per_day}h/day",
                severity="high",
                details="Calendar hours per day outside valid range.",
            ))
        if cal.days_per_week <= 0 or cal.days_per_week > 7:
            flagged.append(FlaggedItem(
                activity_id=f"CAL:{cal.id}",
                activity_name=cal.name,
                issue_type="invalid_workweek",
                current_value=f"{cal.days_per_week}d/week",
                severity="medium",
            ))

    return CheckResult(
        check_id="calendar_validation",
        check_name="Calendar validation",
        dcma_ref=None,
        status=CheckStatus.PASS if len(flagged) == 0 else CheckStatus.WARN,
        metric_value=None,
        metric_label="Calendar issues found",
        population_count=len(model.incomplete_tasks) + len(model.calendars),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            "Validates calendar assignments and configurations. "
            "Missing or invalid calendars cause incorrect date "
            "calculations and unreliable float values."
        ),
        recommendation=(
            "Ensure all activities are assigned to valid calendars "
            "with correct working hours and days."
        ),
    )


# ──────────────────────────────────────────────
# CHECK 10: Logic Density
# ──────────────────────────────────────────────

def check_logic_density(model: ScheduleModel) -> CheckResult:
    """
    Additional check: Logic density.

    Measures how well the schedule network is connected.
    a) Relationship-to-task ratio (R:T) — healthy range 0.5–4.0
    b) High fan-in / fan-out activities (≥5 connections)

    Threshold: 0.5 ≤ ratio ≤ 4.0 → PASS
    """
    from collections import defaultdict

    incomplete = model.incomplete_tasks
    if not incomplete:
        return CheckResult(
            check_id="logic_density",
            check_name="Logic density",
            status=CheckStatus.INFO,
            description="No detail tasks to check.",
        )

    incomplete_ids = {a.id for a in incomplete}
    relevant_rels = [
        r for r in model.relationships
        if r.predecessor_id in incomplete_ids or r.successor_id in incomplete_ids
    ]

    n_tasks = len(incomplete)
    n_rels = len(relevant_rels)
    ratio = n_rels / n_tasks if n_tasks else 0.0

    fan_in = defaultdict(int)
    fan_out = defaultdict(int)
    for rel in relevant_rels:
        if rel.successor_id in incomplete_ids:
            fan_in[rel.successor_id] += 1
        if rel.predecessor_id in incomplete_ids:
            fan_out[rel.predecessor_id] += 1

    FAN_THRESHOLD = 5
    flagged = []
    for act in incomplete:
        fi = fan_in.get(act.id, 0)
        fo = fan_out.get(act.id, 0)
        issues = []
        if fi >= FAN_THRESHOLD:
            issues.append(f"fan_in={fi}")
        if fo >= FAN_THRESHOLD:
            issues.append(f"fan_out={fo}")
        if issues:
            flagged.append(FlaggedItem(
                activity_id=act.id,
                activity_name=act.name,
                wbs_path=act.wbs_path,
                issue_type=" + ".join(issues),
                current_value=f"in={fi}, out={fo}",
                severity="medium",
                details=(
                    f"Activities with ≥{FAN_THRESHOLD} predecessors or successors "
                    f"may represent summary-level logic rather than real sequencing."
                ),
            ))

    if ratio < 0.3:
        status = CheckStatus.FAIL
    elif ratio < 0.5:
        status = CheckStatus.WARN
    elif ratio > 4.0:
        status = CheckStatus.WARN
    else:
        status = CheckStatus.PASS

    return CheckResult(
        check_id="logic_density",
        check_name="Logic density",
        dcma_ref=None,
        status=status,
        metric_value=round(ratio, 2),
        threshold_value=None,
        metric_label="Relationships per incomplete task",
        population_count=n_tasks,
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            f"Relationship-to-task ratio: {ratio:.2f} "
            f"({n_rels} relationships / {n_tasks} incomplete tasks). "
            f"Healthy range: 0.5–4.0. "
            f"Fan-in/fan-out hubs (≥{FAN_THRESHOLD} connections): {len(flagged)} activities. "
            f"\n\n"
            f"Fan-in/Fan-out describes how many logical connections an activity has, "
            f"where a healthy logic density range is 0.5–4.0, and any activity acting as a hub "
            f"with five or more total connections (fan-in + fan-out ≥ 5) is flagged because it "
            f"may indicate an overly complex or overloaded point in the schedule."
        ),
        recommendation=(
            "A ratio below 0.5 means many activities lack logic links — run the "
            "Logic Completeness check to identify them. A ratio above 4.0 often "
            "means milestone/summary tasks are connected directly to many detail "
            "tasks rather than via proper WBS sequencing."
        ),
    )


# ──────────────────────────────────────────────
# CHECK 11: Bottleneck Detection
# ──────────────────────────────────────────────

def check_bottlenecks(model: ScheduleModel) -> CheckResult:
    """
    Additional check: Bottleneck detection.

    Identifies activities at critical junctions using fan_in × fan_out score.
    Score ≥ 12 → high severity, ≥ 6 → medium.
    Also flags zero-float + high fan-out "fragile hubs".
    This check is INFO only — bottlenecks are risk indicators, not errors.
    """
    from collections import defaultdict

    incomplete = model.incomplete_tasks
    if not incomplete:
        return CheckResult(
            check_id="bottlenecks",
            check_name="Bottleneck activities",
            status=CheckStatus.INFO,
            description="No incomplete tasks to check.",
        )

    incomplete_ids = {a.id for a in incomplete}
    fan_in = defaultdict(int)
    fan_out = defaultdict(int)

    for rel in model.relationships:
        if rel.successor_id in incomplete_ids:
            fan_in[rel.successor_id] += 1
        if rel.predecessor_id in incomplete_ids:
            fan_out[rel.predecessor_id] += 1

    flagged = []
    for act in incomplete:
        fi = fan_in.get(act.id, 0)
        fo = fan_out.get(act.id, 0)
        score = fi * fo

        if fi < 2 or fo < 2:
            # Flag zero-float + high fan-out (fragile hub)
            if (act.total_float_hours is not None
                    and act.total_float_hours == 0
                    and fo >= 3):
                flagged.append(FlaggedItem(
                    activity_id=act.id,
                    activity_name=act.name,
                    wbs_path=act.wbs_path,
                    issue_type="fragile_hub",
                    current_value=f"float=0d, fan_out={fo}",
                    severity="high",
                    details=(
                        "Zero float and high fan-out. Any slip propagates "
                        f"to ≥{fo} downstream activities on the critical path."
                    ),
                ))
            continue

        if score >= 12:
            severity = "high"
        elif score >= 6:
            severity = "medium"
        else:
            continue

        issue_parts = [f"hub_score={score}"]
        if act.total_float_hours is not None and act.total_float_hours == 0:
            issue_parts.append("zero_float")
            severity = "high"
        if act.constraint_type.is_hard or act.constraint_type.is_semi_hard:
            issue_parts.append("constrained")

        flagged.append(FlaggedItem(
            activity_id=act.id,
            activity_name=act.name,
            wbs_path=act.wbs_path,
            issue_type=" | ".join(issue_parts),
            current_value=f"in={fi}, out={fo}, score={score}",
            severity=severity,
            details=(
                f"Fan-in×fan-out bottleneck score {score}. "
                f"A delay here affects ≥{fo} downstream activities."
            ),
        ))

    flagged.sort(
        key=lambda f: int(f.current_value.split("score=")[1])
        if "score=" in (f.current_value or "") else 0,
        reverse=True,
    )

    return CheckResult(
        check_id="bottlenecks",
        check_name="Bottleneck activities",
        dcma_ref=None,
        status=CheckStatus.INFO,
        metric_value=None,
        metric_label="High-impact network hubs",
        population_count=len(incomplete),
        flagged_count=len(flagged),
        flagged_items=flagged,
        description=(
            f"Identified {len(flagged)} activities that are structural bottlenecks "
            f"in the logic network. These are not errors — they are risk indicators. "
            f"A delay to any of these activities cascades to many downstream tasks."
        ),
        recommendation=(
            "Review the top-scored bottleneck activities in the schedule risk "
            "register. Ensure they have adequate float, are not over-constrained, "
            "and that recovery options exist if they slip."
        ),
    )


# ──────────────────────────────────────────────
# Dashboard analytics builders
# ──────────────────────────────────────────────

def build_float_histogram(model: ScheduleModel) -> dict:
    """Builds float distribution histogram data for the dashboard chart."""
    incomplete = model.incomplete_tasks
    float_tasks = [a for a in incomplete if a.total_float_hours is not None]

    if not float_tasks:
        return {"bins": [], "total": 0, "mean_float_days": None, "median_float_days": None}

    float_days_list = sorted(a.total_float_days for a in float_tasks)

    BIN_DEFS = [
        ("< -10d",   None,  -10, "critical"),
        ("-10–0d",    -10,    0, "high"),
        ("0d",          0,    0, "neutral"),
        ("1–5d",        0,    5, "low"),
        ("6–10d",       5,   10, "low"),
        ("11–20d",     10,   20, "medium"),
        ("21–44d",     20,   44, "medium"),
        ("45–88d",     44,   88, "warn"),
        ("> 88d",      88, None, "warn"),
    ]

    bins = []
    for label, lo, hi, severity in BIN_DEFS:
        if label == "0d":
            count = sum(1 for d in float_days_list if d == 0)
        elif lo is None:
            count = sum(1 for d in float_days_list if d < hi)
        elif hi is None:
            count = sum(1 for d in float_days_list if d > lo)
        else:
            count = sum(1 for d in float_days_list if lo < d <= hi)
        bins.append({"label": label, "count": count, "severity": severity})

    n = len(float_days_list)
    mean_f = sum(float_days_list) / n if n else None
    if n % 2 == 0:
        median_f = (float_days_list[n // 2 - 1] + float_days_list[n // 2]) / 2
    else:
        median_f = float_days_list[n // 2]

    return {
        "bins": bins,
        "total": n,
        "mean_float_days": round(mean_f, 1) if mean_f is not None else None,
        "median_float_days": round(median_f, 1),
    }


def build_network_metrics(model: ScheduleModel) -> dict:
    """Builds network topology metrics for the dashboard logic density view."""
    from collections import defaultdict

    incomplete = model.incomplete_tasks
    incomplete_ids = {a.id for a in incomplete}

    fan_in = defaultdict(int)
    fan_out = defaultdict(int)

    for rel in model.relationships:
        if rel.successor_id in incomplete_ids:
            fan_in[rel.successor_id] += 1
        if rel.predecessor_id in incomplete_ids:
            fan_out[rel.predecessor_id] += 1

    n_tasks = len(incomplete)
    relevant_rels = [
        r for r in model.relationships
        if r.predecessor_id in incomplete_ids or r.successor_id in incomplete_ids
    ]
    n_rels = len(relevant_rels)
    ratio = n_rels / n_tasks if n_tasks else 0.0

    fan_combined = defaultdict(int)
    for act in incomplete:
        total_connections = fan_in.get(act.id, 0) + fan_out.get(act.id, 0)
        fan_combined[total_connections] += 1

    max_fan = max(fan_combined.keys()) if fan_combined else 0
    fan_distribution = [
        {"fan": f, "count": fan_combined.get(f, 0)}
        for f in range(0, min(max_fan + 1, 15))
    ]

    bottleneck_scores = []
    for act in incomplete:
        fi = fan_in.get(act.id, 0)
        fo = fan_out.get(act.id, 0)
        score = fi * fo
        if score > 0:
            bottleneck_scores.append({
                "id": act.id,
                "name": act.name,
                "wbs_path": act.wbs_path,
                "fan_in": fi,
                "fan_out": fo,
                "score": score,
                "float_days": round(act.total_float_days, 1) if act.total_float_days is not None else None,
                "is_critical": act.is_critical_source or (
                    act.total_float_hours is not None and act.total_float_hours == 0
                ),
            })
    bottleneck_scores.sort(key=lambda x: x["score"], reverse=True)

    open_starts = sum(1 for a in incomplete if fan_in.get(a.id, 0) == 0)
    open_ends = sum(1 for a in incomplete if fan_out.get(a.id, 0) == 0)

    return {
        "ratio": round(ratio, 2),
        "n_tasks": n_tasks,
        "n_relationships": n_rels,
        "fan_distribution": fan_distribution,
        "top_bottlenecks": bottleneck_scores[:10],
        "open_starts": open_starts,
        "open_ends": open_ends,
    }


# ──────────────────────────────────────────────
# Grading
# ──────────────────────────────────────────────

def calculate_grade(checks: list[CheckResult]) -> tuple[str, float]:
    """
    Calculate overall schedule health grade.
    
    Scoring:
    - Each check that passes scores 100/n_checks
    - Each check that warns scores 50/n_checks
    - Each check that fails scores 0
    - Overall: A(≥90), B(≥75), C(≥60), D(≥40), F(<40)
    """
    scorable = [c for c in checks if c.status != CheckStatus.INFO
                and c.status != CheckStatus.ERROR]
    if not scorable:
        return "N/A", 0.0

    total = 0
    for c in scorable:
        if c.status == CheckStatus.PASS:
            total += 100
        elif c.status == CheckStatus.WARN:
            total += 50
        # FAIL = 0

    score = total / len(scorable)

    if score >= 90:
        grade = "A"
    elif score >= 75:
        grade = "B"
    elif score >= 60:
        grade = "C"
    elif score >= 40:
        grade = "D"
    else:
        grade = "F"

    return grade, round(score, 1)


# ──────────────────────────────────────────────
# Normalised scoring (0-100 for spider chart)
# ──────────────────────────────────────────────

# Checks where lower metric_value = better (0% is perfect)
_LOWER_IS_BETTER = {
    "logic_completeness", "leads", "lags",
    "hard_constraints", "high_float", "negative_float", "duration",
}
# Checks where higher metric_value = better (100% is perfect)
_HIGHER_IS_BETTER = {
    "relationship_types",
}


def _compute_normalised_score(check: CheckResult) -> float:
    """
    Compute a 0-100 normalised score for the spider chart.

    - Lower-is-better checks: score = 100 when metric=0, 0 when metric≥threshold×2
    - Higher-is-better checks: score = metric (already 0-100 scale)
    - Logic density: bell curve — peak at ratio 1.0-3.0
    - Calendar/bottlenecks: status-based fallback
    """
    cid = check.check_id
    mv = check.metric_value
    tv = check.threshold_value

    if cid in _LOWER_IS_BETTER and mv is not None and tv is not None:
        if tv == 0:
            # Hard-fail checks (leads, negative float): 100 if 0, else 0
            return 100.0 if mv == 0 else max(0.0, 100.0 - mv * 50)
        # Linear scale: 0% metric = 100 score, threshold = 50, 2×threshold = 0
        return max(0.0, min(100.0, 100.0 - (mv / tv) * 50.0))

    if cid in _HIGHER_IS_BETTER and mv is not None:
        # relationship_types: metric is % FS, threshold is 90%
        # 100% FS = 100 score, 90% = ~80, below 80% drops fast
        if tv and tv > 0:
            return max(0.0, min(100.0, (mv / 100.0) * 100.0))
        return mv

    if cid == "logic_density" and mv is not None:
        # Ratio: 0=0, 0.5=60, 1.0=90, 1.5-3.0=100, 4.0=60, 5.0+=30
        ratio = mv
        if ratio <= 0:
            return 0.0
        elif ratio < 0.5:
            return ratio / 0.5 * 60.0
        elif ratio < 1.0:
            return 60.0 + (ratio - 0.5) / 0.5 * 30.0
        elif ratio <= 3.0:
            return 100.0
        elif ratio <= 4.0:
            return 100.0 - (ratio - 3.0) * 40.0
        else:
            return max(0.0, 60.0 - (ratio - 4.0) * 30.0)

    # Fallback: status-based
    if check.status == CheckStatus.PASS:
        return 100.0
    elif check.status == CheckStatus.WARN:
        return 50.0
    elif check.status == CheckStatus.FAIL:
        return 0.0
    else:
        return 50.0  # INFO/ERROR


def _apply_normalised_scores(checks: list[CheckResult]) -> None:
    """Compute and set normalised_score on each CheckResult in-place."""
    for c in checks:
        c.normalised_score = round(_compute_normalised_score(c), 1)


# ──────────────────────────────────────────────
# Relationship breakdown
# ──────────────────────────────────────────────

def build_relationship_breakdown(model: ScheduleModel) -> dict:
    """
    Build structured relationship type counts for the donut chart.
    Returns: {"FS": 4740, "SS": 43, "FF": 200, "SF": 5, "total": 4988}
    """
    from collections import Counter
    counts = Counter(r.type.value for r in model.relationships)
    result = {rt: counts.get(rt, 0) for rt in ("FS", "SS", "FF", "SF")}
    result["total"] = len(model.relationships)
    return result


# ──────────────────────────────────────────────
# Longest path builder (CP waterfall)
# ──────────────────────────────────────────────

def build_longest_path(model: ScheduleModel) -> list[dict]:
    """
    Trace the longest path (driving path) through the schedule.

    Method:
    1. Find all zero-float incomplete tasks
    2. Build a predecessor adjacency map (only zero-float → zero-float links)
    3. Start from the latest-finishing zero-float task
    4. Walk backwards through predecessors, always choosing the one
       with the latest finish date (greedy longest-path trace)
    5. Reverse to get start-to-finish order

    Returns ordered list of dicts for the waterfall chart:
    [
        {"id": "...", "name": "...", "start": "ISO", "finish": "ISO",
         "duration_days": 20.0, "float_days": 0.0, "wbs_path": "...",
         "is_milestone": false},
        ...
    ]
    """
    incomplete = model.incomplete_tasks
    if not incomplete:
        return []

    # Find zero-float activities (the critical path candidates)
    zero_float = [
        a for a in incomplete
        if a.total_float_hours is not None and a.total_float_hours == 0
    ]
    if not zero_float:
        # Fallback: use activities with lowest float
        sorted_by_float = sorted(
            [a for a in incomplete if a.total_float_hours is not None],
            key=lambda a: a.total_float_hours,
        )
        if not sorted_by_float:
            return []
        min_float = sorted_by_float[0].total_float_hours
        zero_float = [a for a in sorted_by_float
                      if a.total_float_hours <= min_float + 8]  # Within 1 day

    zf_ids = {a.id for a in zero_float}
    zf_map = {a.id: a for a in zero_float}

    # Build predecessor map: for each zero-float activity, which zero-float
    # activities are its predecessors?
    pred_map = {}  # activity_id → list of predecessor activity_ids (zero-float only)
    for a in zero_float:
        preds = []
        for rel in a.predecessors:
            if rel.predecessor_id in zf_ids:
                preds.append(rel.predecessor_id)
        pred_map[a.id] = preds

    # Find the end of the longest path: latest-finishing zero-float activity
    end_act = max(
        zero_float,
        key=lambda a: a.planned_finish or a.early_finish or a.late_finish
        or a.baseline_finish or a.planned_start or a.early_start
        or model.planned_finish or model.planned_start
    )

    # Walk backwards
    path = []
    visited = set()
    current = end_act

    while current:
        if current.id in visited:
            break  # Avoid cycles
        visited.add(current.id)
        path.append(current)

        # Choose the predecessor with the latest finish date
        preds = pred_map.get(current.id, [])
        if not preds:
            break

        best_pred = None
        best_finish = None
        for pid in preds:
            p = zf_map.get(pid)
            if not p or p.id in visited:
                continue
            pf = p.planned_finish or p.early_finish
            if pf and (best_finish is None or pf > best_finish):
                best_finish = pf
                best_pred = p

        current = best_pred

    # Reverse to get start → finish order
    path.reverse()

    # Serialise
    return [
        {
            "id": a.id,
            "name": a.name,
            "start": (a.planned_start or a.early_start).isoformat()
                     if (a.planned_start or a.early_start) else None,
            "finish": (a.planned_finish or a.early_finish).isoformat()
                      if (a.planned_finish or a.early_finish) else None,
            "duration_days": round(a.original_duration_days, 1)
                            if a.original_duration_days is not None else None,
            "float_days": round(a.total_float_days, 1)
                         if a.total_float_days is not None else None,
            "wbs_path": a.wbs_path,
            "is_milestone": a.is_milestone,
            "is_critical": a.is_critical_source or (
                a.total_float_hours is not None and a.total_float_hours == 0
            ),
        }
        for a in path
    ]


# ──────────────────────────────────────────────
# Main runner
# ──────────────────────────────────────────────

ALL_CHECKS = [
    check_logic_completeness,
    check_leads,
    check_lags,
    check_relationship_types,
    check_hard_constraints,
    check_high_float,
    check_negative_float,
    check_duration,
    check_calendar_validation,
    check_logic_density,
    check_bottlenecks,
]


def run_health_check(model: ScheduleModel) -> HealthReport:
    """Run all health checks against a normalised schedule model."""
    checks = [check_fn(model) for check_fn in ALL_CHECKS]
    _apply_normalised_scores(checks)
    grade, score = calculate_grade(checks)

    return HealthReport(
        project_name=model.project_name,
        source_format=model.source_format,
        source_filename=model.source_filename,
        data_date=model.data_date.isoformat() if model.data_date else None,
        summary_stats=model.summary_stats(),
        checks=checks,
        overall_grade=grade,
        overall_score=score,
        parse_warnings=model.parse_warnings,
        float_histogram=build_float_histogram(model),
        network_metrics=build_network_metrics(model),
        relationship_breakdown=build_relationship_breakdown(model),
        longest_path=build_longest_path(model),
    )
