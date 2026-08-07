import unittest

from scripts.local_rewriter import build_manual_profile, rewrite_chunk_with_mapping, rewrite_line


class LocalRewriterTests(unittest.TestCase):
    def test_preserves_dates_currency_and_citation(self):
        text = "The budget is £18,600 and approval begins on 18 November 2025 (Smith, 2024)."
        result = rewrite_line(text, "natural")
        self.assertIn("£18,600", result.rewritten)
        self.assertIn("18 November 2025", result.rewritten)
        self.assertIn("(Smith, 2024)", result.rewritten)
        self.assertTrue(result.accepted)

    def test_simplifies_safe_phrases(self):
        result = rewrite_line("Utilise the system in order to improve results.", "natural")
        self.assertEqual(result.rewritten, "Use the system to improve results.")
        self.assertTrue(result.changed)

    def test_rewrite_compress_removes_padding(self):
        text = (
            "It is important to note that the proposed framework is capable of "
            "providing an explanation of the final classification decision."
        )
        result = rewrite_line(text, "rewrite_compress")
        self.assertTrue(result.accepted, result.reasons)
        self.assertLess(result.metrics["rewritten_words"], result.metrics["original_words"])
        self.assertIn("can explain", result.rewritten.lower())
        self.assertNotIn("can providing", result.rewritten.lower())

    def test_table_mode_disables_contractions(self):
        result = rewrite_line("Configuration and integration support", "plain", mode="table_cell")
        self.assertNotIn("don't", result.rewritten.lower())
        self.assertTrue(result.accepted)

    def test_reserved_marker_is_never_added(self):
        result = rewrite_line("Therefore, the project can begin.", "natural")
        self.assertNotIn("|sec|", result.rewritten)

    def test_intentional_expansion_is_capped(self):
        text = "The project uses interviews and surveys to improve access for employees."
        result = rewrite_line(text, "expanded")
        self.assertTrue(result.accepted, result.reasons)
        self.assertGreaterEqual(result.metrics["word_ratio"], 1.0)
        self.assertLessEqual(result.metrics["cumulative_word_ratio"], 1.25)
        self.assertEqual(result.metrics["original_sentence_count"], result.metrics["rewritten_sentence_count"])

    def test_expanded_profile_keeps_one_clean_candidate(self):
        text = "However, the organisation uses evidence to improve its planning and reduce risk."
        result = rewrite_line(text, "expanded")
        self.assertTrue(result.accepted, result.reasons)
        self.assertNotRegex(result.rewritten, r"(?i)rewritten text|candidate [ab]|output:")
        self.assertNotIn("??", result.rewritten)

    def test_prompt_like_leak_is_not_introduced(self):
        text = "Internal budgets, brands and channels support corporate ventures."
        result = rewrite_line(text, "expanded", mode="table_cell")
        self.assertNotRegex(result.rewritten, r"(?i)why not take a look|what is it that you|number three should")

    def test_contextual_table_handling_preserves_source_content(self):
        context = {
            "column_header": "Main benefits",
            "row_values": ["Large corporation", "Strategic renewal and asset leverage"],
        }
        result = rewrite_line(
            "Strategic renewal and asset leverage",
            "expanded",
            mode="table_cell",
            context=context,
        )
        self.assertTrue(result.accepted, result.reasons)
        self.assertIn("strategic renewal and asset leverage", result.rewritten.lower())

    def test_expanded_table_cell_preserves_anchor(self):
        text = "Revenue growth from PKR 30 million to PKR 400 million"
        result = rewrite_line(text, "expanded", mode="table_cell")
        self.assertIn("PKR 30 million", result.rewritten)
        self.assertIn("PKR 400 million", result.rewritten)
        self.assertTrue(result.accepted)

    def test_manual_profile_supports_compression_and_controlled_expansion(self):
        compact = build_manual_profile({
            "target_change_percent": -15,
            "compression_intensity": 100,
            "max_cumulative_increase": 0,
        })
        longer = build_manual_profile({
            "target_change_percent": 15,
            "compression_intensity": 0,
            "max_cumulative_increase": 20,
        })
        self.assertLess(compact.target_ratio, 1.0)
        self.assertGreater(longer.target_ratio, 1.0)
        self.assertEqual(compact.max_cumulative_ratio, 1.0)
        self.assertEqual(longer.max_cumulative_ratio, 1.20)

    def test_manual_profile_clamps_v14_controls(self):
        profile = build_manual_profile({
            "target_change_percent": 500,
            "candidate_count": 0,
            "content_preservation": 10,
            "table_preservation": 200,
            "max_cumulative_increase": 100,
        })
        self.assertEqual(profile.target_ratio, 1.20)
        self.assertEqual(profile.candidate_count, 2)
        self.assertEqual(profile.paragraph_overlap, 0.60)
        self.assertEqual(profile.table_overlap, 1.00)
        self.assertEqual(profile.max_cumulative_ratio, 1.25)

    def test_old_expansion_setting_cannot_recreate_runaway_growth(self):
        profile = build_manual_profile({"expansion_percent": 60})
        self.assertLessEqual(profile.target_ratio, 1.05)
        self.assertLessEqual(profile.max_cumulative_ratio, 1.05)

    def test_manual_profile_keeps_protected_anchors_locked(self):
        profile = build_manual_profile({
            "target_change_percent": -10,
            "compression_intensity": 100,
            "content_preservation": 65,
        })
        text = "The budget is £18,600 and approval starts on 18 November 2025 (Smith, 2024)."
        result = rewrite_line(text, "manual", profile_override=profile)
        self.assertTrue(result.accepted, result.reasons)
        self.assertIn("£18,600", result.rewritten)
        self.assertIn("18 November 2025", result.rewritten)
        self.assertIn("(Smith, 2024)", result.rewritten)

    def test_cycle_uses_current_text_but_original_baseline(self):
        mapping = {
            "sections": [{
                "section_type": "paragraph_group",
                "items": [{"original_text": "The original sentence uses evidence."}],
            }]
        }
        chunk = {"section_indices": [0], "text": "|sec|\nThe original sentence uses evidence.\n|sec|"}
        current = "|sec|\nThe current rewritten sentence uses evidence and planning.\n|sec|"
        result = rewrite_chunk_with_mapping(mapping, chunk, profile_name="natural", source_text=current)
        line_log = result["logs"][0]
        self.assertEqual(line_log["original"], "The current rewritten sentence uses evidence and planning.")
        self.assertEqual(line_log["context"]["rewrite_source"], "current_edited_text")
        self.assertEqual(line_log["context"]["baseline_original_text"], "The original sentence uses evidence.")

    def test_cycle_rejects_invalid_section_structure(self):
        mapping = {
            "sections": [{
                "section_type": "paragraph_group",
                "items": [{"original_text": "One line."}],
            }]
        }
        chunk = {"section_indices": [0], "text": "|sec|\nOne line.\n|sec|"}
        with self.assertRaises(ValueError):
            rewrite_chunk_with_mapping(
                mapping,
                chunk,
                profile_name="natural",
                source_text="|sec|\nOne line.\nUnexpected second line.\n|sec|",
            )


if __name__ == "__main__":
    unittest.main()
