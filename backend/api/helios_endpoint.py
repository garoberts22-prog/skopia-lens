"""
SKOPIA Lens — Helios AI Endpoint (v1.1)
----------------------------------------
POST /api/helios

Accepts the analysis JSON (and optionally a baseline JSON) from the
frontend AnalysisContext and calls the Anthropic API to generate
plain-English schedule insights.

Three insight modes:
  - health   : Ranks top risks from checks, float, bottlenecks, longest path
  - baseline : Compares current schedule against baseline for finish date
                movement, float erosion, and new/removed critical activities
  - forensic : Deep EPC/EPCM forensic audit — float distribution, near-critical
                path exposure, ranked risks (High/Medium), and actionable
                recommendations. Modelled on forensic planning standards.

The API key is read from the ANTHROPIC_API_KEY environment variable.
Set it in your .env file locally and in Railway environment variables
for production.

USAGE (from frontend):
  POST /api/helios
  Content-Type: application/json
  Body: { "mode": "health"|"baseline"|"forensic", "analysis": {...}, "baseline": {...}|null }

  Response: { "mode": "health"|"baseline"|"forensic", "content": "...", "generated_at": "..." }

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
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-sonnet-4-5"
MAX_TOKENS        = 1500   # Increased for forensic mode — longer structured output


# ── Request / response models ─────────────────────────────────────────────────

class HeliosRequest(BaseModel):
    """
    Payload sent from the frontend HeliosPanel.
    mode:     'health' | 'baseline' | 'forensic'
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

# Forensic mode system prompt — positions Helios as an experienced EPC/EPCM
# forensic planner. Direct, evidence-based, no hedging.
SYSTEM_FORENSIC = """You are Helios, acting as a senior forensic planner and scheduler
with deep EPC/EPCM project delivery experience. You conduct forensic schedule audits
for project controls professionals, planners, and project managers.

Your role is to critically examine the schedule data provided and produce a structured
forensic risk report. You are direct, evidence-based, and do not hedge findings.

Forensic standards:
- If float is zero, state it is zero — do not say "may be critical".
- Cite specific activity IDs, float values, durations, and path groupings from the data.
- Distinguish between schedule quality issues (logic gaps, constraints) and delivery risks
  (near-critical paths, float erosion, bottleneck exposure).
- Never invent data. All assertions must reference values present in the provided JSON.
- Do not describe things as "potential" risks if the data shows a direct exposure.

Required output structure (use exactly these bold headings, in this order):

**Float Distribution Assessment**
2–3 sentences on the float profile — what the distribution reveals about schedule health,
absorption capacity, and whether the critical path is realistic.

**Near-Critical Path Exposure**
Identify the activities or path chains with the least float. Cite activity IDs and float
values. State what they drive and what the consequence of delay is.

**Top Schedule Risks**
List the top 3–5 risks ranked by severity. For each:
  RISK [n] — [Short specific title] — Severity: High/Medium
  Evidence: [specific data — IDs, float, durations, constraints]
  Impact: [what happens if this risk materialises]

**Schedule Quality Flags**
2–3 sentences on any logic, constraint, or relationship integrity issues that reduce
schedule reliability (high lags, hard constraints on near-critical activities,
SF relationships, open ends, low logic density).

**Recommended Actions**
Exactly 4–6 numbered action items, each specific and actionable. Reference the data.
Prioritise by urgency — immediate actions first.

Total response: under 500 words. No preamble. Start directly with the first heading."""


# ── Context builders ──────────────────────────────────────────────────────────

def _build_health_context(analysis: dict) -> str:
    """Build a compact health context string from the analysis object."""
    s     = analysis.get("summary_stats", {})
    chks  = analysis.get("checks", [])
    hist  = analysis.get("float_histogram", {})
    net   = analysis.get("network_metrics", {})
    lpath = analysis.get("longest_path", [])

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

    bins = hist.get("bins", [])
    hist_lines = [f"  {b['label']}: {b['count']} activities" for b in bins[:5]]
    hist_str = "\n".join(hist_lines)

    bots = net.get("top_bottlenecks", [])[:3]
    bot_lines = [
        f"  - {b.get('name','?')} (score {b.get('score','?')}, "
        f"float {b.get('float_days','?')}d, "
        f"{'CRITICAL' if b.get('is_critical') else 'non-critical'})"
        for b in bots
    ]
    bot_str = "\n".join(bot_lines) if bot_lines else "  None identified."

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

    float_delta_mean   = round(mean_float(analysis) - mean_float(baseline), 1)
    float_delta_median = round(median_float(analysis) - median_float(baseline), 1)

    curr_cp_ids = {a.get("id") for a in analysis.get("longest_path", [])}
    base_cp_ids = {a.get("id") for a in baseline.get("longest_path", [])}
    new_critical     = curr_cp_ids - base_cp_ids
    dropped_critical = base_cp_ids - curr_cp_ids

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


def _build_forensic_context(analysis: dict) -> str:
    """
    Build a detailed forensic context from the analysis object.

    Extracts more data than the health context — near-critical activities,
    full float distribution, constraint summary, and relationship quality
    indicators — to support the forensic AI's deeper analysis.
    """
    s     = analysis.get("summary_stats", {})
    chks  = analysis.get("checks", [])
    hist  = analysis.get("float_histogram", {})
    net   = analysis.get("network_metrics", {})
    lpath = analysis.get("longest_path", [])
    rb    = analysis.get("relationship_breakdown", {})
    sd    = analysis.get("schedule_data", {})
    acts  = sd.get("activities", []) if sd else []

    # ── Float distribution — all bins ────────────────────────────────────────
    bins = hist.get("bins", [])
    hist_lines = [f"  {b['label']}: {b['count']} activities" for b in bins]
    hist_str = "\n".join(hist_lines) if hist_lines else "  No float data."

    # ── Near-critical activities (TF < 80 hours = 10 working days) ───────────
    # 80 hrs = 2 weeks on a 5-day/40hr calendar. Flag as near-critical.
    NEAR_CRITICAL_DAYS = 10   # working days — equivalent to 80 hrs on 8hr calendar
    near_critical = [
        a for a in acts
        if (
            a.get("status") not in ("complete", "Complete", "TK_Complete")
            and a.get("total_float") is not None
            and 0 < float(a.get("total_float", 999)) <= NEAR_CRITICAL_DAYS
        )
    ]
    # Sort ascending by float so the most exposed are first
    near_critical.sort(key=lambda a: float(a.get("total_float", 999)))

    nc_lines = [
        f"  {a.get('id','?'):20s}  TF={float(a.get('total_float',0)):.1f}d  "
        f"dur={a.get('orig_dur','?')}d  {str(a.get('name',''))[:50]}"
        for a in near_critical[:15]   # top 15 most exposed
    ]
    nc_str = "\n".join(nc_lines) if nc_lines else "  None identified."
    nc_count = len(near_critical)

    # ── Critical path summary (longest path) ─────────────────────────────────
    cp_finish = lpath[-1].get("finish","?") if lpath else "?"
    cp_dur    = sum(a.get("duration_days", 0) for a in lpath)
    cp_lines  = [
        f"  {a.get('id','?'):20s}  dur={a.get('duration_days','?')}d  "
        f"float={a.get('float_days','?')}d  {str(a.get('name',''))[:40]}"
        for a in lpath[:10]   # first 10 activities on the critical path
    ]
    cp_str = "\n".join(cp_lines) if cp_lines else "  No critical path data."

    # ── Top bottlenecks ───────────────────────────────────────────────────────
    bots = net.get("top_bottlenecks", [])[:10]
    bot_lines = [
        f"  {b.get('id','?'):20s}  score={b.get('score','?')}  "
        f"in={b.get('fan_in','?')} out={b.get('fan_out','?')}  "
        f"float={b.get('float_days','?')}d  "
        f"{'CRITICAL' if b.get('is_critical') else 'non-critical'}  "
        f"{str(b.get('name',''))[:40]}"
        for b in bots
    ]
    bot_str = "\n".join(bot_lines) if bot_lines else "  None identified."

    # ── Failing/warning health checks ────────────────────────────────────────
    check_lines = []
    for c in chks:
        if c.get("status") in ("fail", "warn"):
            check_lines.append(
                f"  [{c['status'].upper()}] {c['check_name']} ({c.get('dcma_ref','')}) — "
                f"metric={c.get('metric_value','?')} threshold={c.get('threshold_value','?')} "
                f"flagged={c.get('flagged_count',0)}"
            )
    checks_str = "\n".join(check_lines) if check_lines else "  All checks passing."

    # ── Constraint summary (from flagged items on constraints check) ──────────
    cstr_check = next(
        (c for c in chks if c.get("check_id") == "hard_constraints"), None
    )
    cstr_count  = cstr_check.get("flagged_count", 0) if cstr_check else "unknown"
    cstr_status = cstr_check.get("status", "unknown") if cstr_check else "unknown"

    # ── Relationship quality ──────────────────────────────────────────────────
    total_rels = rb.get("total", 0) or 1   # avoid div/0
    fs_pct  = round(rb.get("FS",  0) / total_rels * 100, 1)
    sf_count = rb.get("SF", 0)

    # Lag check details
    lag_check = next(
        (c for c in chks if c.get("check_id") == "lags"), None
    )
    lag_pct = lag_check.get("metric_value", "?") if lag_check else "?"

    lead_check = next(
        (c for c in chks if c.get("check_id") == "leads"), None
    )
    lead_count = lead_check.get("flagged_count", 0) if lead_check else "?"

    return f"""FORENSIC SCHEDULE AUDIT DATA
Project:          {analysis.get("project_name","?")}
Source format:    {analysis.get("source_format","?").upper()}
Data date:        {analysis.get("data_date","?")[:10]}
Project start:    {sd.get("project_start","?")[:10] if sd else "?"}
Project finish:   {sd.get("project_finish","?")[:10] if sd else "?"}
Overall grade:    {analysis.get("overall_grade","?")} ({analysis.get("overall_score","?")}%)

ACTIVITY SUMMARY
Total activities:     {s.get("total_activities","?")}
Detail tasks:         {s.get("detail_tasks","?")}
Incomplete tasks:     {s.get("incomplete_tasks","?")}
Completed tasks:      {s.get("completed_tasks","?")}
In-progress tasks:    {s.get("in_progress_tasks","?")}
Milestones:           {s.get("milestones","?")}
Total relationships:  {s.get("total_relationships","?")}

FLOAT DISTRIBUTION (all bins)
Mean float:  {hist.get("mean_float_days","?")} days
Median float:{hist.get("median_float_days","?")} days
{hist_str}

NEAR-CRITICAL ACTIVITIES (TF 0–{NEAR_CRITICAL_DAYS} working days, incomplete only)
Count: {nc_count}
{nc_str}

CRITICAL PATH (longest path, first 10 activities)
Activities on CP: {len(lpath)}
CP duration:      {cp_dur} working days
Forecast finish:  {cp_finish}
{cp_str}

TOP BOTTLENECKS (fan-in × fan-out score)
{bot_str}

NETWORK QUALITY
Open starts (no predecessor):  {net.get("open_starts","?")}
Open ends (no successor):       {net.get("open_ends","?")}
Logic density (rels/task):      {net.get("ratio","?")}
FS relationships:               {rb.get("FS",0)} ({fs_pct}% of total)
SF relationships:               {sf_count} (SF almost always indicates error)
Positive lags (% of rels):      {lag_pct}%
Negative lags (leads) count:    {lead_count}

CONSTRAINTS
Hard constraint count (flagged): {cstr_count}  Status: {cstr_status}

FAILING / WARNING HEALTH CHECKS
{checks_str}"""


# ── Anthropic API call ────────────────────────────────────────────────────────

async def _call_anthropic(system_prompt: str, user_message: str) -> str:
    """
    Call the Anthropic Messages API with the given system and user prompts.
    Uses httpx async client — compatible with FastAPI's async event loop.
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

    async with httpx.AsyncClient(timeout=45.0) as client:  # 45s — forensic mode is longer
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
        try:
            err_body = resp.json()
            msg = err_body.get("error", {}).get("message", f"HTTP {resp.status_code}")
        except Exception:
            msg = f"Anthropic API returned HTTP {resp.status_code}"
        raise HTTPException(
            status_code=502,
            detail={"error": "helios_api_error", "message": msg},
        )

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
        "mode='baseline' → compares current vs baseline for schedule variance\n"
        "mode='forensic' → deep EPC/EPCM forensic audit with ranked risks and recommendations"
    ),
)
async def helios_insights(req: HeliosRequest):
    """
    POST /api/helios
    Body: { mode, analysis, baseline? }
    Response: { mode, content, generated_at }
    """
    if req.mode not in ("health", "baseline", "forensic"):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_mode", "message": "mode must be 'health', 'baseline', or 'forensic'"},
        )

    if req.mode == "baseline" and not req.baseline:
        raise HTTPException(
            status_code=400,
            detail={
                "error":   "missing_baseline",
                "message": "mode='baseline' requires a baseline analysis payload.",
            },
        )

    # Select system prompt and build context for the requested mode
    if req.mode == "health":
        system_prompt = SYSTEM_HEALTH
        user_message  = _build_health_context(req.analysis)
    elif req.mode == "baseline":
        system_prompt = SYSTEM_BASELINE
        user_message  = _build_baseline_context(req.analysis, req.baseline)
    else:  # forensic
        system_prompt = SYSTEM_FORENSIC
        user_message  = _build_forensic_context(req.analysis)

    content = await _call_anthropic(system_prompt, user_message)

    return HeliosResponse(
        mode=req.mode,
        content=content,
        generated_at=datetime.now().isoformat(),
    )
