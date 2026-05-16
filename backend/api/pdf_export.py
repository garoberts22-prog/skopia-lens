"""
SKOPIA Lens — PDF Export Endpoint (v2.0)
----------------------------------------
POST /api/export/pdf

Accepts the full analysis JSON that the frontend already has in
AnalysisContext (from /api/analyse). Generates a server-side PDF
using WeasyPrint + Jinja2 and returns it as a binary download.

STRUCTURE (v2.0 — complete rework):
  Page 1  — Cover, Grade & Stats
              Header · Grade ring · Stat tiles
              Two columns: DCMA checks table (left) | Spider chart SVG (right)
              Full-width: Actions Required block

  Page 2  — Helios AI Insights (only if _helios_insights present)
              Health block (cyan border)
              Baseline Variance block (periwinkle border)
              Forensic Risk Analysis block (red border, #FFF9F9 bg)

  Pages 3+— Per-check detail pages (one page per check in checks[])
              Header · Metric row · Description · Recommendation
              Optional graphic (SVG bar chart or table, rendered in Python)
              Flagged activities table

  Pages N+— Schedule Table (only if _scene_data present in payload)
              Activity ID · Name · Start · Finish · Duration · Float · Status
              Gantt bars as inline SVG (proportional, colour by status/critical)

WHY PRE-RENDERING GRAPHICS IN PYTHON:
  Jinja2 templates cannot do trigonometry (sin/cos for spider chart) or
  complex bar-chart scaling logic cleanly. Pre-rendering in Python and
  passing SVG strings to the template keeps the template as dumb HTML.

WEASYPRINT CONSTRAINTS RESPECTED:
  - No CSS Grid (use flex + tables)
  - No -webkit-background-clip: text
  - No border-image
  - No canvas / JavaScript
  - All graphics = inline SVG or HTML tables
  - Google Fonts via CDN (requires outbound internet at render time)
"""

from __future__ import annotations

import io
import math
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape

# WeasyPrint — C-library backed; requires system deps in Docker.
# Graceful fallback: endpoint returns 503 when not installed (Windows dev).
try:
    from weasyprint import HTML as WeasyHTML
    WEASYPRINT_AVAILABLE = True
except ImportError:
    WEASYPRINT_AVAILABLE = False

router = APIRouter()

# ── Template directory ────────────────────────────────────────────────────────
# __file__ = /app/api/pdf_export.py → parent.parent = /app/
TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
)


# ══════════════════════════════════════════════════════════════════════════════
# JINJA2 FILTERS
# ══════════════════════════════════════════════════════════════════════════════

def _format_num(value) -> str:
    """4988 → '4,988'"""
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value) if value is not None else "—"


def _format_date(value: str | None) -> str:
    """'2026-04-13T00:00:00' → '13 Apr 26'"""
    if not value:
        return "—"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", ""))
        return dt.strftime("%-d %b %y")
    except (ValueError, AttributeError):
        return str(value)[:10]


def _format_metric(value, label: str | None) -> str:
    """Format metric value, appending % when label contains it."""
    if value is None:
        return "—"
    label = label or ""
    try:
        fval = float(value)
        if "%" in label:
            return f"{fval:.1f}%"
        elif fval == int(fval):
            return str(int(fval))
        else:
            return f"{fval:.2f}"
    except (TypeError, ValueError):
        return str(value)


def _status_colour(status: str) -> str:
    return {
        "pass":  "#16A34A",
        "warn":  "#D97706",
        "fail":  "#DC2626",
        "info":  "#2563EB",
        "error": "#DC2626",
    }.get(str(status).lower(), "#6B7280")


def _grade_colour(grade: str) -> str:
    return {
        "A": "#16A34A",
        "B": "#16A34A",
        "C": "#D97706",
        "D": "#DC2626",
        "F": "#DC2626",
    }.get(str(grade).upper(), "#6B7280")


def _truncate(s: str, length: int = 80) -> str:
    s = str(s) if s else ""
    return s if len(s) <= length else s[: length - 1] + "…"


# Register all filters
jinja_env.filters["format_num"]    = _format_num
jinja_env.filters["format_date"]   = _format_date
jinja_env.filters["format_metric"] = _format_metric
jinja_env.filters["status_colour"] = _status_colour
jinja_env.filters["grade_colour"]  = _grade_colour
jinja_env.filters["truncate"]      = _truncate


# ══════════════════════════════════════════════════════════════════════════════
# SVG HELPERS — all graphics pre-rendered in Python, passed as strings
# ══════════════════════════════════════════════════════════════════════════════

def _build_spider_svg(checks: list[dict]) -> str:
    """
    Build an inline SVG radar/spider chart from checks[].normalised_score.

    Layout:
      - Fixed canvas: 260 × 260 px
      - Centre: (130, 130), outer radius: 100px
      - N axes = number of checks (up to 14)
      - Polygon drawn from normalised_score values (0–100 mapped to 0–100px radius)
      - Axis labels rendered at outer radius + small gap
      - 4 concentric reference rings at 25/50/75/100% radius

    WeasyPrint constraint: pure SVG geometry only, no JavaScript.
    """
    if not checks:
        return ""

    W, H = 260, 260
    cx, cy = 130, 130
    R = 95          # outer ring radius (px)
    label_r = 105   # label placement radius

    n = len(checks)
    if n < 3:
        # Need at least 3 points for a meaningful polygon
        return ""

    # ── Helper: angle for axis i (start at top, clockwise) ──
    def axis_angle(i: int) -> float:
        return math.radians(-90 + 360 * i / n)

    # ── Reference ring radii ──
    rings = [R * 0.25, R * 0.5, R * 0.75, R]

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" style="display:block;">',
    ]

    # ── Background ──
    lines.append(f'<rect width="{W}" height="{H}" fill="#F7F8FC" rx="6"/>')

    # ── Reference rings ──
    ring_colours = ["#E2E6F0", "#E2E6F0", "#E2E6F0", "#D1D5DB"]
    for ri, rr in enumerate(rings):
        pts = " ".join(
            f"{cx + rr * math.cos(axis_angle(i)):.1f},{cy + rr * math.sin(axis_angle(i)):.1f}"
            for i in range(n)
        )
        lines.append(
            f'<polygon points="{pts}" fill="none" stroke="{ring_colours[ri]}" stroke-width="0.8"/>'
        )

    # ── Axis spokes ──
    for i in range(n):
        a = axis_angle(i)
        x_end = cx + R * math.cos(a)
        y_end = cy + R * math.sin(a)
        lines.append(
            f'<line x1="{cx}" y1="{cy}" x2="{x_end:.1f}" y2="{y_end:.1f}" '
            f'stroke="#E2E6F0" stroke-width="0.8"/>'
        )

    # ── Data polygon ──
    poly_pts = []
    for i, chk in enumerate(checks):
        score = float(chk.get("normalised_score", 0) or 0)
        # Map 0–100 score to 0–R radius
        r_val = (score / 100.0) * R
        a = axis_angle(i)
        poly_pts.append(
            f"{cx + r_val * math.cos(a):.1f},{cy + r_val * math.sin(a):.1f}"
        )
    pts_str = " ".join(poly_pts)
    lines.append(
        f'<polygon points="{pts_str}" '
        f'fill="rgba(30,200,212,0.18)" stroke="#1EC8D4" stroke-width="1.5"/>'
    )

    # ── Data dots ──
    for i, chk in enumerate(checks):
        score = float(chk.get("normalised_score", 0) or 0)
        r_val = (score / 100.0) * R
        a = axis_angle(i)
        x = cx + r_val * math.cos(a)
        y = cy + r_val * math.sin(a)
        status = str(chk.get("status", "info")).lower()
        dot_col = _status_colour(status)
        lines.append(
            f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.5" fill="{dot_col}" stroke="#fff" stroke-width="0.8"/>'
        )

    # ── Axis labels (short — first 12 chars to avoid overlap) ──
    for i, chk in enumerate(checks):
        a = axis_angle(i)
        lx = cx + label_r * math.cos(a)
        ly = cy + label_r * math.sin(a)
        label = str(chk.get("check_name", ""))[:14]
        # Text anchor: left for right half, right for left half, middle at top/bottom
        cos_a = math.cos(a)
        if cos_a > 0.15:
            anchor = "start"
        elif cos_a < -0.15:
            anchor = "end"
        else:
            anchor = "middle"
        lines.append(
            f'<text x="{lx:.1f}" y="{ly:.1f}" '
            f'font-family="Open Sans,Arial,sans-serif" font-size="5.5" '
            f'fill="#6B7280" text-anchor="{anchor}" dominant-baseline="middle">'
            f'{label}</text>'
        )

    lines.append("</svg>")
    return "\n".join(lines)


def _build_histogram_svg(float_histogram: dict) -> str:
    """
    Horizontal bar chart SVG for the float distribution.
    Used on the High Float per-check detail page.
    Width 300px, bar height 14px per bin.
    """
    bins = (float_histogram or {}).get("bins", [])
    if not bins:
        return ""

    bar_area_w = 160   # width of the bar drawing area
    label_w    = 62    # left label column width
    count_w    = 32    # right count column width
    bar_h      = 14
    gap        = 4
    W          = label_w + bar_area_w + count_w + 16   # total svg width
    H          = len(bins) * (bar_h + gap) + 10

    max_count = max((b.get("count", 0) for b in bins), default=1) or 1

    sev_col = {
        "fail": "#DC2626",
        "warn": "#D97706",
        "pass": "#16A34A",
    }

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" style="display:block;">',
        f'<rect width="{W}" height="{H}" fill="#FFFFFF" rx="4"/>',
    ]

    for idx, bin_ in enumerate(bins):
        y = 6 + idx * (bar_h + gap)
        count  = bin_.get("count", 0)
        label  = bin_.get("label", "")
        sev    = bin_.get("severity", "pass")
        bar_w  = int((count / max_count) * bar_area_w) if max_count else 0
        col    = sev_col.get(sev, "#4A6FE8")

        # Label (right-aligned in label column)
        lines.append(
            f'<text x="{label_w - 4}" y="{y + bar_h // 2 + 1}" '
            f'font-family="JetBrains Mono,monospace" font-size="6.5" '
            f'fill="#6B7280" text-anchor="end" dominant-baseline="middle">'
            f'{label}</text>'
        )

        # Background bar
        lines.append(
            f'<rect x="{label_w}" y="{y}" width="{bar_area_w}" height="{bar_h}" '
            f'fill="#E2E6F0" rx="3"/>'
        )

        # Filled bar
        if bar_w > 0:
            lines.append(
                f'<rect x="{label_w}" y="{y}" width="{bar_w}" height="{bar_h}" '
                f'fill="{col}" rx="3"/>'
            )

        # Count text
        lines.append(
            f'<text x="{label_w + bar_area_w + 6}" y="{y + bar_h // 2 + 1}" '
            f'font-family="JetBrains Mono,monospace" font-size="6.5" '
            f'fill="#1A1A2E" dominant-baseline="middle">'
            f'{count:,}</text>'
        )

    lines.append("</svg>")
    return "\n".join(lines)


def _build_fan_distribution_svg(network_metrics: dict) -> str:
    """
    Bar chart SVG for fan-in / fan-out distribution.
    Used on the Logic Density per-check detail page.
    Shows activity counts by fan degree bucket.
    """
    dist = (network_metrics or {}).get("fan_distribution", [])
    if not dist:
        return ""

    bar_area_w = 160
    label_w    = 50
    count_w    = 32
    bar_h      = 12
    gap        = 3
    W          = label_w + bar_area_w + count_w + 16
    H          = len(dist) * (bar_h + gap) + 10

    max_count = max((d.get("count", 0) for d in dist), default=1) or 1

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" style="display:block;">',
        f'<rect width="{W}" height="{H}" fill="#FFFFFF" rx="4"/>',
    ]

    for idx, bucket in enumerate(dist):
        y      = 6 + idx * (bar_h + gap)
        count  = bucket.get("count", 0)
        label  = bucket.get("label", str(bucket.get("degree", idx)))
        bar_w  = int((count / max_count) * bar_area_w) if max_count else 0

        lines.append(
            f'<text x="{label_w - 4}" y="{y + bar_h // 2 + 1}" '
            f'font-family="JetBrains Mono,monospace" font-size="6" '
            f'fill="#6B7280" text-anchor="end" dominant-baseline="middle">'
            f'{label}</text>'
        )
        lines.append(
            f'<rect x="{label_w}" y="{y}" width="{bar_area_w}" height="{bar_h}" '
            f'fill="#E2E6F0" rx="2"/>'
        )
        if bar_w > 0:
            lines.append(
                f'<rect x="{label_w}" y="{y}" width="{bar_w}" height="{bar_h}" '
                f'fill="#4A6FE8" rx="2"/>'
            )
        lines.append(
            f'<text x="{label_w + bar_area_w + 6}" y="{y + bar_h // 2 + 1}" '
            f'font-family="JetBrains Mono,monospace" font-size="6" '
            f'fill="#1A1A2E" dominant-baseline="middle">'
            f'{count:,}</text>'
        )

    lines.append("</svg>")
    return "\n".join(lines)


def _build_rel_breakdown_svg(relationship_breakdown: dict) -> str:
    """
    Horizontal bar chart SVG for relationship type breakdown.
    Used on the Relationship Types per-check detail page.
    FS / SS / FF / SF with proportional bars.
    """
    rb = relationship_breakdown or {}
    total = rb.get("total", 0) or 1

    items = [
        ("FS", rb.get("FS", 0), "#4A6FE8"),
        ("SS", rb.get("SS", 0), "#1EC8D4"),
        ("FF", rb.get("FF", 0), "#D97706"),
        ("SF", rb.get("SF", 0), "#DC2626"),
    ]

    bar_area_w = 160
    label_w    = 30
    count_w    = 50
    bar_h      = 18
    gap        = 6
    W          = label_w + bar_area_w + count_w + 16
    H          = len(items) * (bar_h + gap) + 10

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" style="display:block;">',
        f'<rect width="{W}" height="{H}" fill="#FFFFFF" rx="4"/>',
    ]

    for idx, (label, count, col) in enumerate(items):
        y      = 6 + idx * (bar_h + gap)
        pct    = (count / total) * 100
        bar_w  = int((count / total) * bar_area_w)

        lines.append(
            f'<text x="{label_w - 4}" y="{y + bar_h // 2 + 1}" '
            f'font-family="JetBrains Mono,monospace" font-size="8" '
            f'fill="#6B7280" text-anchor="end" dominant-baseline="middle" font-weight="600">'
            f'{label}</text>'
        )
        lines.append(
            f'<rect x="{label_w}" y="{y}" width="{bar_area_w}" height="{bar_h}" '
            f'fill="#E2E6F0" rx="3"/>'
        )
        if bar_w > 0:
            lines.append(
                f'<rect x="{label_w}" y="{y}" width="{bar_w}" height="{bar_h}" '
                f'fill="{col}" rx="3"/>'
            )
        lines.append(
            f'<text x="{label_w + bar_area_w + 6}" y="{y + bar_h // 2 + 1}" '
            f'font-family="JetBrains Mono,monospace" font-size="7" '
            f'fill="#1A1A2E" dominant-baseline="middle">'
            f'{count:,} ({pct:.1f}%)</text>'
        )

    lines.append("</svg>")
    return "\n".join(lines)


def _build_scene_gantt_svg(activities: list[dict], project_start: str, project_finish: str) -> str:
    """
    Inline SVG Gantt bar chart for the scene activity table.
    One bar per activity, proportional to the project timescale.

    Parameters:
        activities    — list of activity dicts from _scene_data
        project_start — ISO date string
        project_finish — ISO date string

    Returns: SVG string with width=300, height = n_activities * row_h
    Bar colours:
        Critical (critical=True or total_float<=0) → #DC2626 (red)
        Complete (status='Complete' or pct=100)    → #16A34A (green)
        Normal                                      → #02787C (teal)
    """
    if not activities or not project_start or not project_finish:
        return ""

    try:
        ps = datetime.fromisoformat(str(project_start).replace("Z", ""))
        pf = datetime.fromisoformat(str(project_finish).replace("Z", ""))
    except (ValueError, TypeError):
        return ""

    total_days = (pf - ps).days or 1
    W      = 300
    row_h  = 12
    gap    = 2
    H      = len(activities) * (row_h + gap) + 4

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" style="display:block;">',
        f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>',
    ]

    for idx, act in enumerate(activities):
        y = 2 + idx * (row_h + gap)

        # Parse dates
        try:
            a_start = datetime.fromisoformat(str(act.get("start", "") or "").replace("Z", ""))
            a_finish = datetime.fromisoformat(str(act.get("finish", "") or "").replace("Z", ""))
        except (ValueError, TypeError):
            continue

        x1 = max(0, int(((a_start - ps).days / total_days) * W))
        x2 = min(W, int(((a_finish - ps).days / total_days) * W))
        bw = max(2, x2 - x1)

        # Colour logic
        is_complete = (
            str(act.get("status", "")).lower() in ("complete", "completed")
            or float(act.get("pct", 0) or 0) >= 100
        )
        is_critical = (
            act.get("critical", False)
            or (act.get("total_float") is not None and float(act.get("total_float", 1)) <= 0)
        )
        is_mile = (
            str(act.get("type", "")).lower() in ("milestone",)
            or (act.get("rem_dur") is not None and float(act.get("rem_dur", 1)) == 0)
        )

        if is_complete:
            col = "#16A34A"
        elif is_critical:
            col = "#DC2626"
        else:
            col = "#02787C"

        if is_mile:
            # Diamond milestone marker
            mx = x1
            my = y + row_h // 2
            d  = row_h // 2
            lines.append(
                f'<polygon points="{mx},{my - d} {mx + d},{my} {mx},{my + d} {mx - d},{my}" '
                f'fill="{col}"/>'
            )
        else:
            lines.append(
                f'<rect x="{x1}" y="{y + 2}" width="{bw}" height="{row_h - 4}" '
                f'fill="{col}" rx="2" opacity="0.85"/>'
            )

    lines.append("</svg>")
    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# CHECK GRAPHICS MAP
# ══════════════════════════════════════════════════════════════════════════════

def _build_check_graphics(analysis: dict) -> dict[str, str]:
    """
    Build a map of check_id → SVG/HTML string for checks that have graphics.

    Called once per render. Returns a dict that the template can look up
    with `check_graphics[check.check_id]`.

    Mapping:
        high_float         → float histogram bar chart SVG
        logic_density      → fan distribution bar chart SVG
        bottleneck*        → raw structured data (passed separately as table)
        relationship_types → relationship breakdown bar chart SVG
        All others         → empty string (no graphic rendered)
    """
    graphics: dict[str, str] = {}

    fh = analysis.get("float_histogram", {})
    if fh:
        graphics["high_float"] = _build_histogram_svg(fh)

    nm = analysis.get("network_metrics", {})
    if nm:
        graphics["logic_density"] = _build_fan_distribution_svg(nm)

    rb = analysis.get("relationship_breakdown", {})
    if rb:
        graphics["relationship_types"] = _build_rel_breakdown_svg(rb)

    # Bottleneck activities: pass data directly as structured dict (template renders table)
    # We don't SVG-encode a table; we let the template loop over nm.top_bottlenecks.
    # Mark the presence so template knows to show the bottleneck section.
    if nm.get("top_bottlenecks"):
        graphics["bottleneck_activities"] = "__table__"

    return graphics


# ══════════════════════════════════════════════════════════════════════════════
# MAIN RENDER FUNCTION
# ══════════════════════════════════════════════════════════════════════════════

def _render_pdf(analysis: dict) -> bytes:
    """
    Build the Jinja2 template context, render HTML, pass to WeasyPrint.

    Steps:
        1. Extract metadata + analytics from analysis dict
        2. Pre-compute spider chart SVG (requires math.sin/cos)
        3. Pre-compute per-check graphic SVGs
        4. Build scene Gantt SVG if _scene_data present
        5. Render Jinja2 template → HTML string
        6. WeasyPrint → PDF bytes

    Raises:
        RuntimeError   — WeasyPrint not available
        KeyError/TypeError — malformed analysis dict
    """
    if not WEASYPRINT_AVAILABLE:
        raise RuntimeError(
            "WeasyPrint is not installed. "
            "Add 'weasyprint' to requirements.txt and system deps to Dockerfile."
        )

    # ── Metadata ──────────────────────────────────────────────────────────────
    grade = str(analysis.get("overall_grade", "?"))
    score = round(float(analysis.get("overall_score", 0) or 0), 1)

    raw_dd = analysis.get("data_date") or ""
    try:
        dd_display = datetime.fromisoformat(str(raw_dd).replace("Z", "")).strftime("%-d %b %Y")
    except (ValueError, AttributeError):
        dd_display = str(raw_dd)[:10] or "Unknown"

    checks          = analysis.get("checks", [])
    float_histogram = analysis.get("float_histogram", {})
    network_metrics = analysis.get("network_metrics", {})
    relationship_breakdown = analysis.get("relationship_breakdown", {})
    schedule_data   = analysis.get("schedule_data")
    helios_insights = analysis.get("_helios_insights")
    scene_data      = analysis.get("_scene_data")     # list of filtered activities from frontend

    # Fallback: if _scene_data not explicitly sent but schedule_data.activities exists
    # and the schedule section was not stripped by the wizard, use activities directly.
    # This keeps the endpoint working when called without the full wizard payload.
    if scene_data is None and schedule_data and schedule_data.get("activities"):
        scene_data = schedule_data["activities"]

    baseline        = analysis.get("_baseline")

    # ── Spider chart SVG ──────────────────────────────────────────────────────
    # Requires trig — done here, not in Jinja2
    spider_svg = _build_spider_svg(checks)

    # ── Per-check graphics ────────────────────────────────────────────────────
    check_graphics = _build_check_graphics(analysis)

    # ── Scene Gantt SVG (per-row, pre-rendered for each activity) ─────────────
    # Rather than one giant SVG, we pre-render individual row bars so the
    # template can place each one inline in the schedule table row.
    # This avoids the problem of WeasyPrint not paginating inside a single SVG.
    scene_activities_with_svg = []
    if scene_data and schedule_data:
        ps = schedule_data.get("project_start", "")
        pf = schedule_data.get("project_finish", "")
        for act in scene_data:
            gantt_svg = _build_scene_gantt_svg([act], ps, pf)
            scene_activities_with_svg.append({**act, "_gantt_svg": gantt_svg})

    # ── Format data_date for display ──────────────────────────────────────────
    # Build the template context
    context = {
        # Project metadata
        "project_name":    analysis.get("project_name", "Untitled Schedule"),
        "source_format":   analysis.get("source_format", ""),
        "source_filename": analysis.get("source_filename", ""),
        "data_date":       dd_display,
        "generated_at":    datetime.now().strftime("%-d %b %Y, %-I:%M%p"),

        # Grade
        "overall_grade":   grade,
        "overall_score":   score,
        "grade_colour":    _grade_colour(grade),

        # Summary stats
        "summary_stats":   analysis.get("summary_stats", {}),
        "pass_count":      analysis.get("pass_count", 0),
        "warn_count":      analysis.get("warn_count", 0),
        "fail_count":      analysis.get("fail_count", 0),

        # All checks — backend + any extras the frontend computed and re-sent
        "checks":          checks,

        # Analytics blocks
        "float_histogram":        float_histogram,
        "network_metrics":        network_metrics,
        "relationship_breakdown": relationship_breakdown,
        "longest_path":           analysis.get("longest_path", []),

        # Schedule data (project start/finish for context)
        "schedule_data":   schedule_data,

        # Pre-rendered graphics (SVG strings or '__table__' sentinel)
        "spider_svg":      spider_svg,          # Page 1 right column
        "check_graphics":  check_graphics,       # Per-check detail pages

        # Helios AI insights
        "helios_insights": helios_insights,

        # Scene table (schedule pages, conditional)
        "scene_activities": scene_activities_with_svg if scene_data else None,

        # Baseline snapshot
        "baseline":        baseline,
    }

    # ── Render HTML ───────────────────────────────────────────────────────────
    template = jinja_env.get_template("report.html")
    html_str = template.render(**context)

    # ── WeasyPrint → PDF ──────────────────────────────────────────────────────
    pdf_bytes = WeasyHTML(
        string=html_str,
        base_url=str(TEMPLATE_DIR),
    ).write_pdf()

    return pdf_bytes


# ══════════════════════════════════════════════════════════════════════════════
# FASTAPI ROUTE
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/api/export/pdf",
    response_class=StreamingResponse,
    summary="Export schedule health report as PDF",
    description=(
        "Accepts the full analysis JSON from /api/analyse and returns a "
        "branded, client-ready PDF health report.\n\n"
        "Optional payload keys:\n"
        "  _helios_insights — AI insight blocks {health, baseline, forensic}\n"
        "  _scene_data      — filtered activity list from active ScheduleView scene\n"
        "  _baseline        — baseline snapshot for comparison context\n\n"
        "The caller must POST the complete analysis object (not re-upload the "
        "schedule file). This avoids re-parsing, which is slow."
    ),
)
async def export_pdf(analysis: dict[str, Any]):
    """
    POST /api/export/pdf
    Body  : full analysis dict from AnalysisContext (JSON)
    Returns: application/pdf binary download
    """
    if not analysis:
        raise HTTPException(status_code=400, detail={
            "error": "missing_payload",
            "message": "Request body must be the complete analysis JSON from /api/analyse.",
        })

    try:
        pdf_bytes = _render_pdf(analysis)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail={
            "error": "pdf_unavailable",
            "message": str(e),
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": "pdf_render_error",
            "message": f"PDF generation failed: {str(e)}",
        })

    # Safe filename: SKOPIA_Report_ProjectName_YYYYMMDD.pdf
    project_name = analysis.get("project_name", "Schedule")
    safe_name = "".join(
        c if c.isalnum() or c in "._- " else "_" for c in project_name
    )
    safe_name = safe_name.strip().replace(" ", "_")[:40]
    date_str  = datetime.now().strftime("%Y%m%d")
    filename  = f"SKOPIA_Report_{safe_name}_{date_str}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length":      str(len(pdf_bytes)),
        },
    )
