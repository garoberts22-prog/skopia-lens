"""
SKOPIA Lens — PDF Export Endpoint (v1.0)
----------------------------------------
POST /api/export/pdf

Accepts the full analysis JSON that the frontend already has in
AnalysisContext (from /api/analyse). Generates a server-side PDF
using WeasyPrint + Jinja2 and returns it as a binary download.

WHY JSON PAYLOAD (not re-uploading the file):
  The frontend already has the complete analysis result in memory.
  Re-uploading the file would require another parse + health-check
  run (slow, expensive). Accepting the JSON payload is instant.

USAGE (from frontend api.js):
  POST /api/export/pdf
  Content-Type: application/json
  Body: { ...the full analysis object from AnalysisContext... }

  Response: application/pdf — binary PDF blob

WEASYPRINT NOTES:
  WeasyPrint renders HTML/CSS to PDF server-side. The Jinja2 template
  at templates/report.html is the layout source. All brand colours,
  fonts, and layout are defined there.

  WeasyPrint supports:
    - @page rules (size, margins, running headers/footers)
    - CSS flex (for basic layouts — not full grid)
    - CSS linear-gradient on elements (NOT on text / background-clip)
    - SVG inlined in HTML

  WeasyPrint does NOT support:
    - -webkit-background-clip: text (gradient text effects)
    - CSS Grid layout
    - Horizontal overflow pagination (must pre-split)
    - canvas or WebGL
"""

from __future__ import annotations

import io
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

# Jinja2 is bundled with FastAPI (it's a dependency of Starlette)
from jinja2 import Environment, FileSystemLoader, select_autoescape

# WeasyPrint — installed via pip. Required apt packages in Dockerfile:
#   libpango-1.0-0, libpangoft2-1.0-0, libcairo2, libgdk-pixbuf2.0-0
#   (see Dockerfile additions in the deployment instructions)
try:
    from weasyprint import HTML as WeasyHTML, CSS
    WEASYPRINT_AVAILABLE = True
except ImportError:
    WEASYPRINT_AVAILABLE = False

router = APIRouter()


# ── Jinja2 environment ────────────────────────────────────────────────────────
#
# Loads templates from the `templates/` directory, which lives at the
# same level as `api/`. In Docker: /app/templates/
#
# __file__ is /app/api/pdf_export.py → parent is /app/api/ → parent is /app/
#
TEMPLATE_DIR = Path(__file__).parent.parent / "templates"

jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
)


# ── Custom Jinja2 filters ─────────────────────────────────────────────────────
#
# These handle data formatting inside the template so the template itself
# stays clean. Register each filter on jinja_env.filters.

def format_num(value) -> str:
    """Format integer with thousands separator: 4988 → '4,988'"""
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value) if value is not None else "—"


def format_date(value: str | None) -> str:
    """
    Convert ISO datetime string → 'DD-Mon-YY' display format.
    e.g. '2026-04-13T00:00:00' → '13 Apr 26'
    """
    if not value:
        return "—"
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", ""))
        return dt.strftime("%-d %b %y")  # Linux: '13 Apr 26'
    except (ValueError, AttributeError):
        return str(value)[:10]           # fallback: first 10 chars of ISO string


def format_metric(value, label: str | None) -> str:
    """
    Format a metric value for the checks table.
    Appends '%' if the metric label references a percentage.
    """
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


def status_colour(status: str) -> str:
    """Return the brand colour hex for a check status string."""
    return {
        "pass": "#16A34A",
        "warn": "#D97706",
        "fail": "#DC2626",
        "info": "#2563EB",
        "error": "#DC2626",
    }.get(str(status).lower(), "#6B7280")


def grade_colour(grade: str) -> str:
    """Return brand colour for an overall grade letter."""
    return {
        "A": "#16A34A",  # pass green
        "B": "#16A34A",  # pass green
        "C": "#D97706",  # warn amber
        "D": "#DC2626",  # fail red
        "F": "#DC2626",  # fail red
    }.get(str(grade).upper(), "#6B7280")


def truncate(s: str, length: int = 80) -> str:
    """Truncate a string to `length` chars with ellipsis."""
    s = str(s) if s else ""
    return s if len(s) <= length else s[:length - 1] + "…"


# Register all filters on the Jinja2 environment
jinja_env.filters["format_num"]    = format_num
jinja_env.filters["format_date"]   = format_date
jinja_env.filters["format_metric"] = format_metric
jinja_env.filters["status_colour"] = status_colour
jinja_env.filters["truncate"]      = truncate


# ── PDF generation helper ─────────────────────────────────────────────────────

def _render_pdf(analysis: dict) -> bytes:
    """
    Render the health report as a PDF byte string.

    1. Extract required fields from the analysis dict.
    2. Render the Jinja2 template to an HTML string.
    3. Pass the HTML to WeasyPrint → returns bytes.

    Returns:
        bytes — the raw PDF content

    Raises:
        RuntimeError — if WeasyPrint is not installed
        KeyError / TypeError — if the analysis dict is malformed
    """
    if not WEASYPRINT_AVAILABLE:
        raise RuntimeError(
            "WeasyPrint is not installed. "
            "Add 'weasyprint' to requirements.txt and the system "
            "dependencies to your Dockerfile (libpango, libcairo2, etc)."
        )

    # ── Build template context ────────────────────────────────────────────────
    grade   = str(analysis.get("overall_grade", "?"))
    score   = round(float(analysis.get("overall_score", 0)), 1)

    # Format data_date for display
    raw_dd = analysis.get("data_date") or ""
    try:
        dd_display = datetime.fromisoformat(str(raw_dd).replace("Z","")).strftime("%-d %b %Y")
    except (ValueError, AttributeError):
        dd_display = str(raw_dd)[:10] or "Unknown"

    context = {
        # Project metadata
        "project_name":     analysis.get("project_name", "Untitled Schedule"),
        "source_format":    analysis.get("source_format", ""),
        "source_filename":  analysis.get("source_filename", ""),
        "data_date":        dd_display,
        "generated_at":     datetime.now().strftime("%-d %b %Y, %-I:%M%p"),

        # Grade
        "overall_grade":    grade,
        "overall_score":    score,
        "grade_colour":     grade_colour(grade),

        # Summary stats
        "summary_stats":    analysis.get("summary_stats", {}),
        "pass_count":       analysis.get("pass_count", 0),
        "warn_count":       analysis.get("warn_count", 0),
        "fail_count":       analysis.get("fail_count", 0),

        # Checks list — all of them (both backend and any extras the
        # caller has already computed client-side and re-sent)
        "checks":           analysis.get("checks", []),

        # Analytics blocks
        "float_histogram":       analysis.get("float_histogram", {}),
        "network_metrics":       analysis.get("network_metrics", {}),
        "relationship_breakdown": analysis.get("relationship_breakdown", {}),
        "longest_path":          analysis.get("longest_path", []),

        # Schedule data (for project start/finish dates)
        "schedule_data":    analysis.get("schedule_data"),

        # Helios AI insights — included when frontend has generated them
        # Shape: { health: {content, generatedAt}, baseline: {content, generatedAt} }
        "helios_insights":  analysis.get("_helios_insights"),

        # Baseline snapshot — included when a baseline was loaded
        "baseline":         analysis.get("_baseline"),
    }

    # ── Render HTML ───────────────────────────────────────────────────────────
    template = jinja_env.get_template("report.html")
    html_str = template.render(**context)

    # ── WeasyPrint → PDF bytes ────────────────────────────────────────────────
    #
    # base_url is set to the template directory so that any relative assets
    # (e.g. an inlined logo image) resolve correctly.
    pdf_bytes = WeasyHTML(
        string=html_str,
        base_url=str(TEMPLATE_DIR),
    ).write_pdf()

    return pdf_bytes


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post(
    "/api/export/pdf",
    response_class=StreamingResponse,
    summary="Export schedule health report as PDF",
    description=(
        "Accepts the full analysis JSON from /api/analyse and returns a "
        "branded, client-ready PDF health report.\n\n"
        "The caller must POST the complete analysis object (not re-upload the "
        "schedule file). This avoids re-parsing the schedule, which is slow."
    ),
)
async def export_pdf(analysis: dict[str, Any]):
    """
    POST /api/export/pdf
    Body: the full analysis dict from AnalysisContext (JSON)
    Response: application/pdf download
    """
    if not analysis:
        raise HTTPException(status_code=400, detail={
            "error": "missing_payload",
            "message": "Request body must be the complete analysis JSON from /api/analyse.",
        })

    try:
        pdf_bytes = _render_pdf(analysis)
    except RuntimeError as e:
        # WeasyPrint not installed — config error, not a client error
        raise HTTPException(status_code=503, detail={
            "error": "pdf_unavailable",
            "message": str(e),
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": "pdf_render_error",
            "message": f"PDF generation failed: {str(e)}",
        })

    # Build a safe filename: "SKOPIA_Report_ProjectName_YYYYMMDD.pdf"
    project_name = analysis.get("project_name", "Schedule")
    safe_name = "".join(c if c.isalnum() or c in "._- " else "_" for c in project_name)
    safe_name = safe_name.strip().replace(" ", "_")[:40]
    date_str = datetime.now().strftime("%Y%m%d")
    filename = f"SKOPIA_Report_{safe_name}_{date_str}.pdf"

    # Return as streaming response — the PDF bytes stream directly to the
    # browser which triggers a file download (Content-Disposition: attachment)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
