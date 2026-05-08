"""
ScheduleCheck - Core Data Model

The normalised ScheduleModel that all parsers (XER, MPP, XML) adapt into.
The analysis engine operates exclusively on these types.

Design principle: This model captures the UNION of data needed for all
health checks, not the intersection of what each format provides.
Fields that a parser can't populate are set to None — the checks
handle missing data gracefully.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, date, timedelta
from enum import Enum
from typing import Optional


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class ActivityStatus(Enum):
    """Activity completion status."""
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class ActivityType(Enum):
    """Activity type classification."""
    TASK = "task"                    # Normal work activity (P6: TT_Task)
    MILESTONE = "milestone"          # Zero-duration milestone (P6: TT_Mile)
    START_MILESTONE = "start_mile"   # Start milestone
    FINISH_MILESTONE = "finish_mile" # Finish milestone
    LOE = "loe"                      # Level of Effort (P6: TT_LOE)
    SUMMARY = "summary"              # Summary/WBS task (MSP summary tasks)
    HAMMOCK = "hammock"              # Hammock activity
    WBS_SUMMARY = "wbs_summary"      # P6 WBS Summary activity (TT_WBS)


class RelationshipType(Enum):
    """Dependency relationship types."""
    FS = "FS"   # Finish-to-Start
    SS = "SS"   # Start-to-Start
    FF = "FF"   # Finish-to-Finish
    SF = "SF"   # Start-to-Finish


class ConstraintType(Enum):
    """Schedule constraint types.
    
    Classified as 'hard' or 'soft' for DCMA purposes.
    Hard constraints override logic; soft constraints influence but don't break it.
    """
    # Hard constraints (DCMA flags these)
    MUST_START_ON = "MSO"
    MUST_FINISH_ON = "MFO"
    MANDATORY_START = "MS"       # P6 equivalent
    MANDATORY_FINISH = "MF"      # P6 equivalent

    # Semi-hard (context-dependent)
    START_NO_LATER_THAN = "SNLT"
    FINISH_NO_LATER_THAN = "FNLT"

    # Soft constraints (generally acceptable)
    START_NO_EARLIER_THAN = "SNET"
    FINISH_NO_EARLIER_THAN = "FNET"
    AS_SOON_AS_POSSIBLE = "ASAP"
    AS_LATE_AS_POSSIBLE = "ALAP"

    # No constraint
    NONE = "NONE"

    @property
    def is_hard(self) -> bool:
        """Whether this constraint type is considered 'hard' per DCMA."""
        return self in {
            ConstraintType.MUST_START_ON,
            ConstraintType.MUST_FINISH_ON,
            ConstraintType.MANDATORY_START,
            ConstraintType.MANDATORY_FINISH,
        }

    @property
    def is_semi_hard(self) -> bool:
        """Constraints that can override logic under certain conditions."""
        return self in {
            ConstraintType.START_NO_LATER_THAN,
            ConstraintType.FINISH_NO_LATER_THAN,
        }

    @property
    def is_soft(self) -> bool:
        """Constraints that influence but don't break logic."""
        return not self.is_hard and not self.is_semi_hard


# ──────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────

@dataclass
class Calendar:
    """Project calendar definition."""
    id: str
    name: str
    hours_per_day: float = 8.0
    hours_per_week: float = 40.0
    days_per_week: int = 5
    is_default: bool = False

    # Working days (0=Mon, 6=Sun). Default: Mon-Fri
    working_days: list[int] = field(default_factory=lambda: [0, 1, 2, 3, 4])

    # Non-working exceptions (holidays, shutdowns)
    exceptions: list[CalendarException] = field(default_factory=list)

    # Work exceptions — dates that ARE work days despite normally being non-work
    work_exceptions: list[date] = field(default_factory=list)

    # Source format metadata
    source_id: Optional[str] = None  # Original ID from source file


@dataclass
class CalendarException:
    """Non-working period in a calendar."""
    name: str
    start_date: date
    end_date: date


@dataclass
class WBSNode:
    """Work Breakdown Structure node."""
    id: str
    name: str
    parent_id: Optional[str] = None
    level: int = 1
    source_id: Optional[str] = None


@dataclass
class Relationship:
    """Dependency relationship between two activities."""
    predecessor_id: str
    successor_id: str
    type: RelationshipType = RelationshipType.FS
    lag_hours: float = 0.0       # Lag in hours (normalised from source)
    lag_days: Optional[float] = None  # Lag in working days (for display)

    # Computed flag for convenience
    @property
    def has_negative_lag(self) -> bool:
        return self.lag_hours < 0

    @property
    def has_positive_lag(self) -> bool:
        return self.lag_hours > 0


@dataclass
class Activity:
    """
    Normalised schedule activity.
    
    This is the core unit of analysis. Every field needed by any health
    check is represented here. Parsers populate what they can; checks
    handle None gracefully.
    """
    id: str                          # Activity ID (task_code in P6, UID in MSP)
    name: str                        # Activity name
    activity_type: ActivityType = ActivityType.TASK
    status: ActivityStatus = ActivityStatus.NOT_STARTED

    # WBS
    wbs_id: Optional[str] = None
    wbs_path: Optional[str] = None   # "Project / Phase / Package" breadcrumb

    # Dates (all Optional — not all activities have all dates)
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_finish: Optional[datetime] = None
    early_start: Optional[datetime] = None
    early_finish: Optional[datetime] = None
    late_start: Optional[datetime] = None
    late_finish: Optional[datetime] = None
    baseline_start: Optional[datetime] = None
    baseline_finish: Optional[datetime] = None

    # Duration
    original_duration_hours: Optional[float] = None
    remaining_duration_hours: Optional[float] = None
    actual_duration_hours: Optional[float] = None

    @property
    def original_duration_days(self) -> Optional[float]:
        """Duration in working days, using calendar hours_per_day."""
        if self.original_duration_hours is None:
            return None
        # Default 8hr day if no calendar context
        return self.original_duration_hours / 8.0

    # Float
    total_float_hours: Optional[float] = None
    free_float_hours: Optional[float] = None

    @property
    def total_float_days(self) -> Optional[float]:
        if self.total_float_hours is None:
            return None
        return self.total_float_hours / 8.0

    # Constraint
    constraint_type: ConstraintType = ConstraintType.NONE
    constraint_date: Optional[datetime] = None

    # Calendar
    calendar_id: Optional[str] = None

    # Relationships (populated during model assembly)
    predecessors: list[Relationship] = field(default_factory=list)
    successors: list[Relationship] = field(default_factory=list)

    # Progress
    percent_complete: float = 0.0

    # Resource loading flag
    has_resources: bool = False

    # Critical flag from source (may differ from calculated)
    is_critical_source: bool = False

    # Source format metadata
    source_id: Optional[str] = None   # Original unique ID from source
    source_format: Optional[str] = None  # "xer" or "mpp"

    # ── Convenience properties for analysis ──

    @property
    def is_incomplete(self) -> bool:
        return self.status != ActivityStatus.COMPLETED

    @property
    def is_task(self) -> bool:
        """True if this is a regular work activity (not LOE/summary/WBS)."""
        return self.activity_type in {
            ActivityType.TASK,
            ActivityType.MILESTONE,
            ActivityType.START_MILESTONE,
            ActivityType.FINISH_MILESTONE,
        }

    @property
    def is_milestone(self) -> bool:
        return self.activity_type in {
            ActivityType.MILESTONE,
            ActivityType.START_MILESTONE,
            ActivityType.FINISH_MILESTONE,
        }

    @property
    def is_loe(self) -> bool:
        return self.activity_type == ActivityType.LOE

    @property
    def is_summary(self) -> bool:
        return self.activity_type in {
            ActivityType.SUMMARY,
            ActivityType.WBS_SUMMARY,
        }

    @property
    def has_predecessor(self) -> bool:
        return len(self.predecessors) > 0

    @property
    def has_successor(self) -> bool:
        return len(self.successors) > 0

    @property
    def has_hard_constraint(self) -> bool:
        return self.constraint_type.is_hard

    @property
    def has_negative_float(self) -> bool:
        return (self.total_float_hours is not None
                and self.total_float_hours < 0)

    @property
    def has_high_float(self) -> bool:
        """Float > 44 working days (352 hours at 8hr/day)."""
        return (self.total_float_hours is not None
                and self.total_float_hours > 352)


# ──────────────────────────────────────────────
# The top-level model
# ──────────────────────────────────────────────

@dataclass
class ScheduleModel:
    """
    Normalised schedule data model.
    
    This is the ONLY type the analysis engine sees.
    Parsers (XER adapter, MPP adapter) are responsible for
    populating this from their respective formats.
    """
    # Project metadata
    project_name: str = ""
    project_id: Optional[str] = None
    data_date: Optional[datetime] = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    baseline_finish: Optional[datetime] = None

    # Source info
    source_format: str = "unknown"   # "xer", "mpp", "xml"
    source_filename: Optional[str] = None
    export_date: Optional[datetime] = None

    # Schedule data
    activities: list[Activity] = field(default_factory=list)
    calendars: list[Calendar] = field(default_factory=list)
    wbs_nodes: list[WBSNode] = field(default_factory=list)

    # Relationships stored at model level AND on activities
    # (dual storage for different access patterns)
    relationships: list[Relationship] = field(default_factory=list)

    # Parsing warnings (non-fatal issues found during import)
    parse_warnings: list[str] = field(default_factory=list)

    # ── Convenience accessors ──

    @property
    def default_calendar(self) -> Optional[Calendar]:
        for cal in self.calendars:
            if cal.is_default:
                return cal
        return self.calendars[0] if self.calendars else None

    def get_calendar(self, calendar_id: str) -> Optional[Calendar]:
        for cal in self.calendars:
            if cal.id == calendar_id:
                return cal
        return None

    def get_activity(self, activity_id: str) -> Optional[Activity]:
        for act in self.activities:
            if act.id == activity_id:
                return act
        return None

    @property
    def incomplete_activities(self) -> list[Activity]:
        """All non-completed activities (the population most checks operate on)."""
        return [a for a in self.activities if a.is_incomplete]

    @property
    def incomplete_tasks(self) -> list[Activity]:
        """Incomplete tasks only — excludes LOE, summary, WBS summary."""
        return [a for a in self.activities
                if a.is_incomplete and a.is_task]

    @property
    def detail_activities(self) -> list[Activity]:
        """All non-summary, non-LOE activities (complete or not)."""
        return [a for a in self.activities
                if a.is_task]

    @property
    def total_activity_count(self) -> int:
        return len(self.activities)

    @property
    def total_relationship_count(self) -> int:
        return len(self.relationships)

    # ── Statistics ──

    def summary_stats(self) -> dict:
        """Quick stats for the dashboard header."""
        tasks = self.detail_activities
        incomplete = self.incomplete_tasks
        return {
            "total_activities": len(self.activities),
            "detail_tasks": len(tasks),
            "summaries": len([a for a in self.activities if a.is_summary]),
            "milestones": len([a for a in self.activities if a.is_milestone]),
            "loe_activities": len([a for a in self.activities if a.is_loe]),
            "incomplete_tasks": len(incomplete),
            "completed_tasks": len([a for a in tasks
                                    if a.status == ActivityStatus.COMPLETED]),
            "in_progress_tasks": len([a for a in tasks
                                      if a.status == ActivityStatus.IN_PROGRESS]),
            "total_relationships": len(self.relationships),
            "calendars": len(self.calendars),
            "data_date": self.data_date.isoformat() if self.data_date else None,
            "project_start": self.planned_start.isoformat() if self.planned_start else None,
            "project_finish": self.planned_finish.isoformat() if self.planned_finish else None,
            "source_format": self.source_format,
        }
