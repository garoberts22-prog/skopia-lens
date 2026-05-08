"""
SKOPIA Lens — FastAPI Application (v0.7)

Upload a schedule file (XER or MPP), get a health report card.
Product: SKOPIA Lens — "Schedule confidence, in seconds."
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.models import ScheduleModel
from parsers.base import get_parser_for_file, ParseError
from parsers.xer_adapter_mpxj import XERMPXJParserAdapter  # GPL-free (MPXJ/LGPL)
from parsers.mpp_adapter import MPPParserAdapter
from checks.engine import run_health_check, HealthReport


app = FastAPI(
    title="SKOPIA Lens API",
    description="Upload a P6 or MS Project schedule, get an instant health report card. SKOPIA Lens — schedule confidence, in seconds.",
    version="0.7.0",
)

# CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register available parsers
PARSERS = [
    XERMPXJParserAdapter(),   # XER via MPXJ (LGPL) — replaces xerparser (GPL-3.0)
    MPPParserAdapter(),
]


@app.get("/")
async def root():
    return {
        "service": "SKOPIA Lens",
        "version": "0.7.0",
        "tagline": "Schedule confidence, in seconds.",
        "supported_formats": [p.format_name for p in PARSERS],
        "supported_extensions": [
            ext for p in PARSERS for ext in p.supported_extensions
        ],
    }


@app.post("/api/analyse")
async def analyse_schedule(file: UploadFile = File(...)):
    """
    Upload a schedule file and receive a health report.
    
    Accepts: .xer (Primavera P6), .mpp (MS Project)
    Returns: JSON health report with check results and overall grade.
    """
    filename = file.filename or "unknown"

    # Find appropriate parser
    try:
        parser = get_parser_for_file(filename, PARSERS)
    except ParseError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "unsupported_format",
                "message": str(e),
                "details": e.details,
            },
        )

    # Save uploaded file to temp location
    suffix = Path(filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Parse schedule
        model = parser.parse(tmp_path, filename=filename)

        # Run health checks
        report = run_health_check(model)

        # Serialise response
        return _serialise_report(report)

    except ParseError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "parse_error",
                "message": str(e),
                "format": e.format_name,
                "details": e.details,
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "internal_error",
                "message": f"Analysis failed: {str(e)}",
            },
        )
    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _serialise_report(report: HealthReport) -> dict:
    """Convert HealthReport to JSON-serialisable dict."""
    return {
        "project_name": report.project_name,
        "source_format": report.source_format,
        "source_filename": report.source_filename,
        "data_date": report.data_date,
        "overall_grade": report.overall_grade,
        "overall_score": report.overall_score,
        "summary_stats": report.summary_stats,
        "pass_count": report.pass_count,
        "fail_count": report.fail_count,
        "warn_count": report.warn_count,
        "parse_warnings": report.parse_warnings,
        "float_histogram": report.float_histogram,
        "network_metrics": report.network_metrics,
        "relationship_breakdown": report.relationship_breakdown,
        "longest_path": report.longest_path,
        "checks": [
            {
                "check_id": c.check_id,
                "check_name": c.check_name,
                "dcma_ref": c.dcma_ref,
                "status": c.status.value,
                "metric_value": c.metric_value,
                "threshold_value": c.threshold_value,
                "metric_label": c.metric_label,
                "normalised_score": c.normalised_score,
                "population_count": c.population_count,
                "flagged_count": c.flagged_count,
                "description": c.description,
                "recommendation": c.recommendation,
                "error_message": c.error_message,
                "flagged_items": [
                    {
                        "activity_id": fi.activity_id,
                        "activity_name": fi.activity_name,
                        "wbs_path": fi.wbs_path,
                        "issue_type": fi.issue_type,
                        "current_value": fi.current_value,
                        "threshold": fi.threshold,
                        "severity": fi.severity,
                        "details": fi.details,
                    }
                    for fi in c.flagged_items
                ],
            }
            for c in report.checks
        ],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
