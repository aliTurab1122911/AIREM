import unittest

from scripts.local_rewriter import get_profile
from scripts.rewrite_optimizer import evaluate_pass


class RewriteOptimizerTests(unittest.TestCase):
    def _score(self, score, words):
        return {"style_risk_score": score, "ai_style_score": score, "word_count": words}

    def test_rejects_growth_beyond_original_budget(self):
        profile = get_profile("natural")
        result = evaluate_pass(
            self._score(40, 1000),
            self._score(30, 1000),
            self._score(5, 1100),
            profile,
        )
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "output_exceeded_original_based_word_budget")

    def test_accepts_score_improvement_without_growth(self):
        profile = get_profile("natural")
        result = evaluate_pass(
            self._score(40, 1000),
            self._score(30, 1000),
            self._score(20, 990),
            profile,
        )
        self.assertTrue(result["accepted"])
        self.assertGreater(result["objective_improvement"], 0)

    def test_original_remains_permanent_baseline(self):
        profile = get_profile("natural")
        result = evaluate_pass(
            self._score(40, 1000),
            self._score(25, 1040),
            self._score(20, 1060),
            profile,
        )
        self.assertFalse(result["accepted"])
        self.assertEqual(result["word_budget"]["hard_max_words"], 1050)


if __name__ == "__main__":
    unittest.main()
