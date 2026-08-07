from __future__ import annotations

from typing import Any, Dict

from .local_rewriter import RewriteProfile

ROLLBACK_POLICIES = {
    "strict": {
        "label": "Strict",
        "description": "Accept only a clearly better combined style-and-length objective.",
    },
    "balanced": {
        "label": "Balanced",
        "description": "Accept useful score or compression gains and tolerate a small neutral objective change.",
    },
    "permissive": {
        "label": "Permissive",
        "description": "Keep any structurally valid result inside the hard word budget, with warnings if metrics worsen.",
    },
}


def document_objective(score: Dict[str, Any], original_words: int, profile: RewriteProfile) -> Dict[str, float]:
    words = int(score.get("word_count") or 0)
    baseline = max(int(original_words or 0), 1)
    ratio = words / baseline
    length_deviation = abs(ratio - profile.target_ratio) * 100.0
    hard_excess = max(0.0, ratio - profile.max_cumulative_ratio) * 2000.0
    growth_penalty = max(0.0, ratio - 1.0) * (85.0 if profile.target_ratio <= 1.0 else 10.0)
    style_score = float(score.get("style_risk_score", score.get("ai_style_score", 0.0)) or 0.0)
    total = style_score * profile.style_weight + length_deviation * profile.length_weight + hard_excess + growth_penalty
    return {
        "style_score": round(style_score, 4),
        "word_count": words,
        "word_ratio": round(ratio, 6),
        "length_deviation": round(length_deviation, 4),
        "hard_excess_penalty": round(hard_excess, 4),
        "growth_penalty": round(growth_penalty, 4),
        "objective": round(total, 4),
    }


def word_budget_report(original_score: Dict[str, Any], source_score: Dict[str, Any], output_score: Dict[str, Any], profile: RewriteProfile) -> Dict[str, Any]:
    original_words = max(int(original_score.get("word_count") or 0), 1)
    source_words = int(source_score.get("word_count") or 0)
    output_words = int(output_score.get("word_count") or 0)
    target_words = round(original_words * profile.target_ratio)
    hard_max_words = max(1, int(original_words * profile.max_cumulative_ratio))
    return {
        "original_words": original_words,
        "source_words": source_words,
        "output_words": output_words,
        "target_words": target_words,
        "hard_max_words": hard_max_words,
        "target_ratio": profile.target_ratio,
        "max_cumulative_ratio": profile.max_cumulative_ratio,
        "source_change_percent": round((source_words / original_words - 1.0) * 100.0, 2),
        "output_change_percent": round((output_words / original_words - 1.0) * 100.0, 2),
        "within_budget": output_words <= hard_max_words,
    }


def evaluate_pass(
    original_score: Dict[str, Any],
    source_score: Dict[str, Any],
    output_score: Dict[str, Any],
    profile: RewriteProfile,
    rollback_policy: str = "balanced",
) -> Dict[str, Any]:
    policy = rollback_policy if rollback_policy in ROLLBACK_POLICIES else "balanced"
    original_words = max(int(original_score.get("word_count") or 0), 1)
    source_objective = document_objective(source_score, original_words, profile)
    output_objective = document_objective(output_score, original_words, profile)
    improvement = source_objective["objective"] - output_objective["objective"]
    budget = word_budget_report(original_score, source_score, output_score, profile)

    source_style = float(source_objective["style_score"])
    output_style = float(output_objective["style_score"])
    style_improvement = source_style - output_style
    source_distance = abs(source_objective["word_ratio"] - profile.target_ratio)
    output_distance = abs(output_objective["word_ratio"] - profile.target_ratio)
    target_progress = source_distance - output_distance
    changed = (
        int(source_score.get("word_count") or 0) != int(output_score.get("word_count") or 0)
        or abs(source_style - output_style) >= 0.05
    )

    accepted = False
    warning = None
    if not budget["within_budget"]:
        reason = "output_exceeded_original_based_word_budget"
    elif policy == "strict":
        accepted = improvement >= max(profile.min_objective_improvement, 0.25)
        reason = "accepted" if accepted else "no_meaningful_score_and_length_improvement"
    elif policy == "permissive":
        accepted = changed or improvement >= -0.01
        reason = "accepted_permissive" if accepted else "rewrite_produced_no_material_change"
        if accepted and (style_improvement < 0 or improvement < 0):
            warning = "The result was kept under Permissive policy even though one or more diagnostic metrics worsened."
    else:
        # Balanced accepts any clear score improvement, clear movement towards
        # the length target, or a small objective regression within tolerance.
        accepted = bool(
            improvement >= 0.05
            or style_improvement >= 0.15
            or target_progress >= 0.005
            or (changed and improvement >= -0.75 and style_improvement >= -0.35)
        )
        reason = "accepted_balanced" if accepted else "no_useful_score_or_length_progress"
        if accepted and improvement < 0:
            warning = "Balanced policy accepted a small objective trade-off because the pass remained within safeguards."

    return {
        "accepted": accepted,
        "reason": reason,
        "rollback_policy": policy,
        "policy_description": ROLLBACK_POLICIES[policy]["description"],
        "warning": warning,
        "objective_improvement": round(improvement, 4),
        "style_improvement": round(style_improvement, 4),
        "target_progress": round(target_progress, 6),
        "minimum_required_improvement": profile.min_objective_improvement,
        "source_objective": source_objective,
        "output_objective": output_objective,
        "word_budget": budget,
    }
