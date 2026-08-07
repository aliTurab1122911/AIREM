import unittest

from scripts.style_score import analyse_style, score_document


class StyleScoreTests(unittest.TestCase):
    def setUp(self):
        self.mapping = {
            "sections": [
                {"section_type": "paragraph_group", "items": [{"original_text": "placeholder"}]},
                {"section_type": "table_row", "items": [{"original_text": "placeholder"}]},
            ],
            "chunks": [
                {
                    "chunk_number": 1,
                    "section_indices": [0, 1],
                    "text": "|sec|\nplaceholder\n|sec|\nrow value\n|sec|",
                }
            ],
        }

    def _document(self, prose: str, table: str = "Strategic renewal; asset leverage"):
        return {1: f"|sec|\n{prose}\n|sec|\n{table}\n|sec|"}

    def test_ai_source_style_scores_above_rewritten_style(self):
        source = (
            "Entrepreneurship concerns the systematic identification, evaluation and exploitation of opportunities; "
            "therefore, organisational capability and institutional legitimacy remain significant. "
            "Furthermore, strategic implementation requires disciplined governance and measurable performance."
        )
        rewritten = (
            "Entrepreneurship is about how people can find an opportunity and work out whether it can help them create value, "
            "but it also depends on the way the organisation works and the support that people have around them. "
            "It isn't only about having an idea, because people also have to put that idea into practice and see whether it works."
        )
        source_score = score_document(self.mapping, self._document(source))["ai_style_score"]
        rewritten_score = score_document(self.mapping, self._document(rewritten))["ai_style_score"]
        self.assertGreater(source_score, rewritten_score)

    def test_score_is_bounded_and_exposes_disclaimer(self):
        result = score_document(self.mapping, self._document("A clear sentence explains the point."))
        self.assertGreaterEqual(result["ai_style_score"], 0)
        self.assertLessEqual(result["ai_style_score"], 100)
        self.assertIn("not an authorship probability", result["disclaimer"])

    def test_score_can_move_up_or_down(self):
        low_style = self._document(
            "It's useful to see how people can work with the idea, but they also need to know what they can do with it in practice."
        )
        high_style = self._document(
            "Strategic implementation therefore requires organisational coordination; furthermore, institutional capability remains significant."
        )
        low = score_document(self.mapping, low_style)["ai_style_score"]
        high = score_document(self.mapping, high_style)["ai_style_score"]
        self.assertGreater(high, low)

    def test_analyse_style_counts_expected_features(self):
        metrics = analyse_style("It isn't simple, but it is useful; therefore, the process continues.")
        self.assertGreater(metrics["contractions_per_1000"], 0)
        self.assertGreater(metrics["semicolons_per_1000"], 0)
        self.assertGreater(metrics["but_per_1000"], 0)
        self.assertGreater(metrics["formal_connectors_per_1000"], 0)


if __name__ == "__main__":
    unittest.main()
