"""
SKOPIA Lens — Helios AI Endpoint (v1.0)
----------------------------------------
POST /api/helios

Accepts the analysis JSON (and optionally a baseline JSON) from the
frontend AnalysisContext and calls the Anthropic API to generate
plain-English schedule insights.

Two insight modes:
  - health   : Ranks top risks from checks, float, bottlenecks, longest path
  - baseline : Compares current schedule against baseline for finish date
                movement, float erosion, and new/removed critical activities

The API key is read from the ANTHROPIC_API_KEY environment variable.
Set it in your .env file locally and in Railway environment variables
for production.

USAGE (from frontend):
  POST /api/helios
  Content-Type: application/json
  Body: { "mode": "health"|"baseline", "analysis": {...}, "baseline": {...}|null }

  Response: { "mode": "health"|"baseline", "content": "...", "generated_at": "..." }

REGISTER IN main.py:
  from api.helios_endpoint import router as helios_router
  app.include_router(helios_router)
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# ── Anthropic API config ──────────────────────────────────────────────────────
# Key must be set in environment — never hardcoded.
# Local: add ANTHROPIC_API_KEY=sk-ant-... to your .env file in the backend root.
# Production (Railway): set via Railway dashboard → Variables tab.
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-sonnet-4-5"   # Sonnet — fast, cost-efficient
MAX_TOKENS        = 1024                           # Generous for a structured insight response


# ── Request / response models ─────────────────────────────────────────────────

class HeliosRequest(BaseModel):
    """
    Payload sent from the frontend HeliosPanel.
    mode:     'health' | 'baseline'
    analysis: the full analysis object from AnalysisContext
    baseline: the baseline analysis object (only required for 'baseline' mode)
    """
    mode:     str
    analysis: dict[str, Any]
    baseline: Optional[dict[str, Any]] = None


class HeliosResponse(BaseModel):
    mode:         str
    content:      str
    generated_at: str


# ── System prompts ────────────────────────────────────────────────────────────
#
# These prompts define Helios's persona and constrain the response format.
# Critical rule: never invent data. Only reference fields present in the JSON.

SYSTEM_HEALTH = """You are Helios, SKOPIA's schedule intelligence assistant.
You analyse construction and engineering schedule health data and return
plain-English insights for project managers and planners.

Rules:
- Never invent data. Only reference metrics present in the provided JSON.
- Be specific — cite activity IDs, float values, check names, and percentages.
- Use concise professional language. No filler phrases.
- Structure your response as exactly 3 insight blocks, each covering one risk area.
- Each block: one bolded heading line (the risk), then 2–3 sentences of evidence and impact.
- End with a single "Recommended Actions" block: exactly 3 numbered action items.
- Total response: under 350 words."""

SYSTEM_BASELINE = """You are Helios, SKOPIA's schedule intelligence assistant.
You compare a current schedule against a baseline and identify schedule variance
for project managers and planners.

Rules:
- Never invent data. Only reference fields present in the provided JSON.
- Focus on: finish date movement, float erosion, and critical path changes.
- Be specific — cite dates, days of variance, activity counts, float values.
- Structure your response as exactly 3 variance insight blocks.
- Each block: one bolded heading line (the variance finding), then 2–3 sentences
  of evidence and magnitude.
- End with a single "Watch List" block: the top 3 activities most at risk of
  further slippage, with their current float and reason.
- Total response: under 350 words."""


# ── Context builders ──────────────────────────────────────────────────────────
#
# These functions extract the relevant fields from the analysis JSON and build
# a compact summary string to send to the AI. This keeps token usage low by
# avoiding sending the entire (potentially large) analysis object.

def _build_health_context(analysis: dict) -> str:
    """Build a compact health context string from the analysis object."""
    s     = analysis.get("summary_stats", {})
    chks  = analysis.get("checks", [])
    hist  = analysis.get("float_histogram", {})
    net   = analysis.get("network_metrics", {})
    lpath = analysis.get("longest_path", [])

    # Summarise checks — only include failing/warning ones to keep context tight
    check_lines = []
    for c in chks:
        if c.get("status") in ("fail", "warn"):
            check_lines.append(
                f"  - {c['check_name']} ({c.get('dcma_ref','')}) "
                f"[{c['status'].upper()}]: {c.get('metric_value','?')} "
                f"(threshold {c.get('threshold_value','?')}) — "
                f"{c.get('flagged_count',0)} flagged"
            )
    checks_str = "\n".join(check_lines) if check_lines else "  All checks passing."

    # Float histogram summary
    bins = hist.get("bins", [])
    hist_lines = [f"  {b['label']}: {b['count']} activities" for b in bins[:5]]
    hist_str = "\n".join(hist_lines)

    # Top 3 bottlenecks
    bots = net.get("top_bottlenecks", [])[:3]
    bot_lines = [
        f"  - {b.get('name','?')} (score {b.get('score','?')}, "
        f"float {b.get('float_days','?')}d, "
        f"{'CRITICAL' if b.get('is_critical') else 'non-critical'})"
        for b in bots
    ]
    bot_str = "\n".join(bot_lines) if bot_lines else "  None identified."

    # Critical path summary
    cp_finish = lpath[-1].get("finish","?") if lpath else "?"
    cp_dur    = sum(a.get("duration_days", 0) for a in lpath)

    return f"""SCHEDULE HEALTH SUMMARY
Project:        {analysis.get("project_name","?")}
Format:         {analysis.get("source_format","?").upper()}
Data Date:      {analysis.get("data_date","?")[:10]}
Overall Grade:  {analysis.get("overall_grade","?")} ({analysis.get("overall_score","?")}%)

SUMMARY STATS
Total activities:    {s.get("total_activities","?")}
Incomplete tasks:    {s.get("incomplete_tasks","?")}
Complete tasks:      {s.get("completed_tasks","?")}
Relationships:       {s.get("total_relationships","?")}
Mean float:          {hist.get("mean_float_days","?")} days
Median float:        {hist.get("median_float_days","?")} days

FAILING / WARNING CHECKS
{checks_str}

FLOAT DISTRIBUTION (top bins)
{hist_str}

TOP BOTTLENECKS
{bot_str}

CRITICAL PATH
Activities on CP:    {len(lpath)}
CP duration:         {cp_dur} working days
Forecast finish:     {cp_finish}
Open ends:           {net.get("open_ends","?")}
Logic density ratio: {net.get("ratio","?")}"""


def _build_baseline_context(analysis: dict, baseline: dict) -> str:
    """Build a compact baseline variance context from current vs baseline."""

    def finish_date(a: dict) -> str:
        sd = a.get("schedule_data", {})
        return sd.get("project_finish", "?")[:10] if sd else "?"

    def mean_float(a: dict) -> float:
        return a.get("float_histogram", {}).get("mean_float_days", 0) or 0

    def median_float(a: dict) -> float:
        return a.get("float_histogram", {}).get("median_float_days", 0) or 0

    def grade(a: dict) -> str:
        return f"{a.get('overall_grade','?')} ({a.get('overall_score','?')}%)"

    # Float erosion
    float_delta_mean   = round(mean_float(analysis) - mean_float(baseline), 1)
    float_delta_median = round(median_float(analysis) - median_float(baseline), 1)

    # Critical path activities in current but not in baseline (new risks)
    curr_cp_ids = {a.get("id") for a in analysis.get("longest_path", [])}
    base_cp_ids = {a.get("id") for a in baseline.get("longest_path", [])}
    new_critical  = curr_cp_ids - base_cp_ids
    dropped_critical = base_cp_ids - curr_cp_ids

    # Failing/warn checks in current
    curr_fail = [
        f"  - {c['check_name']}: {c.get('metric_value','?')} ({c['status'].upper()})"
        for c in analysis.get("checks", [])
        if c.get("status") in ("fail","warn")
    ]
    base_fail = [
        f"  - {c['check_name']}: {c.get('metric_value','?')} ({c['status'].upper()})"
        for c in baseline.get("checks", [])
        if c.get("status") in ("fail","warn")
    ]

    return f"""BASELINE VARIANCE SUMMARY
Project:             {analysis.get("project_name","?")}
Data Date (current): {analysis.get("data_date","?")[:10]}
Data Date (baseline):{baseline.get("data_date","?")[:10]}

FINISH DATE COMPARISON
Baseline finish:     {finish_date(baseline)}
Current finish:      {finish_date(analysis)}

HEALTH GRADE
Baseline:            {grade(baseline)}
Current:             {grade(analysis)}

FLOAT EROSION
Mean float (baseline):   {mean_float(baseline)} days
Mean float (current):    {mean_float(analysis)} days
Change in mean float:    {float_delta_mean:+.1f} days
Change in median float:  {float_delta_median:+.1f} days

CRITICAL PATH CHANGES
New activities on CP (not in baseline):     {len(new_critical)}
Activities removed from CP vs baseline:     {len(dropped_critical)}
Sample new CP activities: {", ".join(list(new_critical)[:5]) or "none"}

FAILING / WARNING CHECKS
Current:
{chr(10).join(curr_fail) if curr_fail else "  All passing."}
Baseline:
{chr(10).join(base_fail) if base_fail else "  All passing."}

ACTIVITY COUNTS
Baseline total:      {baseline.get("summary_stats",{}).get("total_activities","?")}
Current total:       {analysis.get("summary_stats",{}).get("total_activities","?")}
Baseline incomplete: {baseline.get("summary_stats",{}).get("incomplete_tasks","?")}
Current incomplete:  {analysis.get("summary_stats",{}).get("incomplete_tasks","?")}"""


# ── Anthropic API call ────────────────────────────────────────────────────────

async def _call_anthropic(system_prompt: str, user_message: str) -> str:
    """
    Call the Anthropic Messages API with the given system and user prompts.
    Uses httpx async client — compatible with FastAPI's async event loop.

    Raises HTTPException on API errors so FastAPI handles them gracefully.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail={
                "error":   "helios_unavailable",
                "message": (
                    "ANTHROPIC_API_KEY environment variable is not set. "
                    "Add it to your .env file (local) or Railway Variables (production)."
                ),
            },
        )

    headers = {
        "x-api-key":         api_key,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
    }

    payload = {
        "model":      ANTHROPIC_MODEL,
        "max_tokens": MAX_TOKENS,
        "system":     system_prompt,
        "messages":   [{"role": "user", "content": user_message}],
    }

    # 30s timeout — schedule analysis is fast but Anthropic can be slow under load
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(ANTHROPIC_API_URL, json=payload, headers=headers)
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail={"error": "helios_timeout", "message": "Anthropic API timed out. Try again."},
            )
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=503,
                detail={"error": "helios_network_error", "message": str(e)},
            )

    if resp.status_code != 200:
        # Surface Anthropic's error message where possible
        try:
            err_body = resp.json()
            msg = err_body.get("error", {}).get("message", f"HTTP {resp.status_code}")
        except Exception:
            msg = f"Anthropic API returned HTTP {resp.status_code}"
        raise HTTPException(
            status_code=502,
            detail={"error": "helios_api_error", "message": msg},
        )

    # Extract the text content from the first content block
    data = resp.json()
    try:
        return data["content"][0]["text"]
    except (KeyError, IndexError) as e:
        raise HTTPException(
            status_code=502,
            detail={"error": "helios_parse_error", "message": f"Unexpected response shape: {e}"},
        )


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post(
    "/api/helios",
    response_model=HeliosResponse,
    summary="Helios — AI schedule insights",
    description=(
        "Accepts the current analysis (and optionally a baseline) and returns "
        "plain-English AI-generated schedule insights via Anthropic Claude.\n\n"
        "mode='health'   → ranks top 3 risks from health check data\n"
        "mode='baseline' → compares current vs baseline for schedule variance"
    ),
)
async def helios_insights(req: HeliosRequest):
    """
    POST /api/helios
    Body: { mode, analysis, baseline? }
    Response: { mode, content, generated_at }
    """
    # Validate mode
    if req.mode not in ("health", "baseline"):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_mode", "message": "mode must be 'health' or 'baseline'"},
        )

    # Baseline mode requires baseline data
    if req.mode == "baseline" and not req.baseline:
        raise HTTPException(
            status_code=400,
            detail={
                "error":   "missing_baseline",
                "message": "mode='baseline' requires a baseline analysis payload.",
            },
        )

    # Build context and select system prompt
    if req.mode == "health":
        system_prompt = SYSTEM_HEALTH
        user_message  = _build_health_context(req.analysis)
    else:
        system_prompt = SYSTEM_BASELINE
        user_message  = _build_baseline_context(req.analysis, req.baseline)

    # Call Anthropic
    content = await _call_anthropic(system_prompt, user_message)

    return HeliosResponse(
        mode=req.mode,
        content=content,
        generated_at=datetime.now().isoformat(),
    )
