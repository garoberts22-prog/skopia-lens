"""
CPM Engine — Data Models
Defines the core data structures that map to the the XLSM workbook.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Optional


class ItemType(Enum):
    ACTIVITY = "Activity"
    MILESTONE = "Milestone"
    DISCRETE_EVENT = "Discrete Event"
    CONNECTOR = "Connector Milestone"
    BRANCH = "Branch Milestone"


class DistributionType(Enum):
    TRIGEN = "TriGen"          # Triangular / PERT
    UNIFORM = "Uniform"
    FIXED = "Fixed"


class LinkType(Enum):
    FS = "FS"   # Finish-to-Start (default)
    SS = "SS"   # Start-to-Start
    FF = "FF"   # Finish-to-Finish
    SF = "SF"   # Start-to-Finish


@dataclass
class WorkCalendar:
    """Maps to the Calendars sheet in the workbook."""
    calendar_id: int = 1
    name: str = "Default"
    work_days: list[int] = field(default_factory=lambda: [0, 1, 2, 3, 4])  # Mon-Fri
    hours_per_day: float = 8.0
    exceptions: list[tuple[date, date, str]] = field(default_factory=list)  # start, end, title

    def is_work_day(self, d: date) -> bool:
        """Check if a date is a working day (not weekend, not exception)."""
        if d.weekday() not in self.work_days:
            return False
        for exc_start, exc_end, _ in self.exceptions:
            if exc_start <= d <= exc_end:
                return False
        return True

    def add_work_days(self, start: date, work_days: int) -> date:
        """Add N working days to a start date. Returns the end date."""
        if work_days <= 0:
            return start
        current = start
        remaining = work_days
        while remaining > 0:
            current += timedelta(days=1)
            if self.is_work_day(current):
                remaining -= 1
        return current

    def subtract_work_days(self, end: date, work_days: int) -> date:
        """Subtract N working days from an end date. Returns the start date."""
        if work_days <= 0:
            return end
        current = end
        remaining = work_days
        while remaining > 0:
            current -= timedelta(days=1)
            if self.is_work_day(current):
                remaining -= 1
        return current

    def next_work_day(self, d: date) -> date:
        """Return the next working day after d."""
        current = d
        while True:
            current += timedelta(days=1)
            if self.is_work_day(current):
                return current

    def prev_work_day(self, d: date) -> date:
        """Return the previous working day before d."""
        current = d
        while True:
            current -= timedelta(days=1)
            if self.is_work_day(current):
                return current

    def work_days_between(self, start: date, end: date) -> int:
        """Count working days between two dates (exclusive of start, inclusive of end)."""
        if end <= start:
            return 0
        count = 0
        current = start
        while current < end:
            current += timedelta(days=1)
            if self.is_work_day(current):
                count += 1
        return count


@dataclass
class Link:
    """A predecessor/successor relationship between two schedule items."""
    from_id: int              # Predecessor item number
    to_id: int                # Successor item number
    link_type: LinkType = LinkType.FS
    lag_days: float = 0.0     # Lag in working days (negative = lead)

    def __repr__(self):
        lag_str = f"+{self.lag_days}d" if self.lag_days else ""
        return f"Link({self.from_id}->{self.to_id} {self.link_type.value}{lag_str})"


@dataclass
class ScheduleItem:
    """
    A single schedule item — maps to one row of PERTChart_Data.
    Column mapping matches the v2.05 XLSM structure.
    """
    # Identity (Col A, B, Q)
    item_no: int
    name: str
    item_type: ItemType = ItemType.ACTIVITY

    # Duration (Col E, F, G) — in calendar days
    duration_base: float = 0.0
    duration_low: float = 0.0
    duration_high: float = 0.0

    # Deterministic override (Col BX, BY)
    use_deterministic: bool = False
    duration_deterministic: float = 0.0

    # Distribution (Col R)
    distribution: DistributionType = DistributionType.TRIGEN

    # Discrete event factors (Col BS, BT, BU)
    discrete_factor_low: float = 1.0
    discrete_factor_base: float = 1.0
    discrete_factor_high: float = 1.0

    # Discrete probabilities (Col S, T, U)
    discrete_prob_low: float = 0.0
    discrete_prob_base: float = 1.0
    discrete_prob_high: float = 0.0

    # Delay chance (Col J) — for discrete events
    delay_chance: float = 0.0

    # Correlation (Col V, W)
    correlation_group: str = ""
    correlation_factor: float = 0.0

    # Scheduling flags (Col I, AA, BN)
    fixed_milestone: bool = False
    as_late_as_possible: bool = False
    probabilistic_branch: Optional[str] = None

    # Calendar (Col BW)
    calendar_id: int = 1

    # Connections — stored as comma-separated item numbers in XLSM (Col Y, Z)
    connections_to: list[int] = field(default_factory=list)    # successors
    connections_from: list[int] = field(default_factory=list)  # predecessors

    # Quantity-based duration (Col BZ, CA-CH)
    use_quantity_rate: bool = False
    qty_deterministic: float = 0.0
    qty_low: float = 0.0
    qty_base: float = 0.0
    qty_high: float = 0.0
    rate_deterministic: float = 0.0
    rate_low: float = 0.0
    rate_base: float = 0.0
    rate_high: float = 0.0

    # Scope (Col X) — WBS assignment
    scope: str = ""

    # Calculated dates — populated by CPM engine
    early_start: Optional[date] = None
    early_finish: Optional[date] = None
    late_start: Optional[date] = None
    late_finish: Optional[date] = None
    total_float: Optional[float] = None
    free_float: Optional[float] = None
    is_critical: bool = False

    # NLT constraint (Col BO)
    nlt_date: Optional[date] = None

    # SNET constraint — ES must be >= this date (floor, not lock)
    snet_date: Optional[date] = None

    # Actual dates for completed/in-progress locking
    actual_start: Optional[date] = None
    actual_finish: Optional[date] = None

    # Completion (Col DD)
    completed: bool = False

    @property
    def effective_duration(self) -> float:
        """Return the duration to use for deterministic CPM calculation."""
        if self.item_type == ItemType.MILESTONE:
            return 0.0
        if self.use_deterministic and self.duration_deterministic > 0:
            return self.duration_deterministic
        if self.use_quantity_rate and self.rate_base > 0:
            return self.qty_base / self.rate_base
        return self.duration_base

    def __repr__(self):
        return f"Item({self.item_no}: '{self.name}' {self.item_type.value} dur={self.effective_duration}d)"


@dataclass
class ScheduleNetwork:
    """
    The complete schedule network — items + links + calendars.
    This is the input to the CPM engine.
    """
    items: dict[int, ScheduleItem] = field(default_factory=dict)
    links: list[Link] = field(default_factory=list)
    calendars: dict[int, WorkCalendar] = field(default_factory=dict)
    data_date: Optional[date] = None

    # Settings from the Settings table
    project_start: Optional[date] = None
    float_sensitivity_days: float = 1.0
    round_end_to_next_day: bool = False

    def add_item(self, item: ScheduleItem):
        self.items[item.item_no] = item

    def add_link(self, link: Link):
        self.links.append(link)
        # Also update the item connection lists
        if link.from_id in self.items:
            if link.to_id not in self.items[link.from_id].connections_to:
                self.items[link.from_id].connections_to.append(link.to_id)
        if link.to_id in self.items:
            if link.from_id not in self.items[link.to_id].connections_from:
                self.items[link.to_id].connections_from.append(link.from_id)

    def get_calendar(self, cal_id: int) -> WorkCalendar:
        """Get a calendar by ID, falling back to a default 5-day calendar."""
        if cal_id in self.calendars:
            return self.calendars[cal_id]
        # Return default Mon-Fri calendar
        return WorkCalendar(calendar_id=cal_id)

    def predecessors(self, item_no: int) -> list[tuple[ScheduleItem, Link]]:
        """Get all predecessors of an item with their link details."""
        result = []
        for link in self.links:
            if link.to_id == item_no and link.from_id in self.items:
                result.append((self.items[link.from_id], link))
        return result

    def successors(self, item_no: int) -> list[tuple[ScheduleItem, Link]]:
        """Get all successors of an item with their link details."""
        result = []
        for link in self.links:
            if link.from_id == item_no and link.to_id in self.items:
                result.append((self.items[link.to_id], link))
        return result

    def topological_sort(self) -> list[int]:
        """
        Topological sort of the network (Kahn's algorithm).
        Returns item numbers in forward-pass order.
        Raises ValueError if a cycle is detected.
        """
        # Build in-degree map
        in_degree: dict[int, int] = {item_no: 0 for item_no in self.items}
        for link in self.links:
            if link.to_id in in_degree:
                in_degree[link.to_id] += 1

        # Start with items that have no predecessors
        queue = [item_no for item_no, deg in in_degree.items() if deg == 0]
        queue.sort()  # Deterministic ordering
        result = []

        while queue:
            current = queue.pop(0)
            result.append(current)
            for succ, _ in self.successors(current):
                in_degree[succ.item_no] -= 1
                if in_degree[succ.item_no] == 0:
                    queue.append(succ.item_no)
                    queue.sort()

        if len(result) != len(self.items):
            missing = set(self.items.keys()) - set(result)
            raise ValueError(f"Cycle detected in network. Items involved: {missing}")

        return result

    def summary(self) -> str:
        """Return a text summary of the network."""
        types = {}
        for item in self.items.values():
            t = item.item_type.value
            types[t] = types.get(t, 0) + 1

        lines = [
            f"Schedule Network: {len(self.items)} items, {len(self.links)} links",
            f"  Calendars: {len(self.calendars)}",
            f"  Data Date: {self.data_date}",
            f"  Project Start: {self.project_start}",
            f"  Item types: {types}",
        ]
        return "\n".join(lines)
