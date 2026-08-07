import tempfile
import unittest
from pathlib import Path

from scripts.local_rewriter import get_profile, rewrite_chunk_with_mapping
from scripts.pipeline_engine import create_extraction_package, validate_edited_chunks
from scripts.rewrite_optimizer import evaluate_pass
from scripts.style_score import original_chunk_texts, score_document


class DocxRewriterV14RegressionTests(unittest.TestCase):
    def test_natural_profile_preserves_structure_and_word_budget(self):
        source = Path(__file__).resolve().parents[1] / "docs" / "sample_1_org.docx"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            extract_dir = root / "extract"
            logs_dir = root / "logs"
            extract_dir.mkdir()
            logs_dir.mkdir()
            mapping = create_extraction_package(
                source,
                extract_dir,
                logs_dir / "map.json",
                max_words=5000,
            )
            original = original_chunk_texts(mapping)
            initial_score = score_document(mapping, original)
            attempted = {}
            for chunk in mapping["chunks"]:
                result = rewrite_chunk_with_mapping(mapping, chunk, profile_name="natural")
                attempted[int(chunk["chunk_number"])] = result["text"]

            validation = validate_edited_chunks(mapping, attempted)
            attempted_score = score_document(mapping, attempted)
            evaluation = evaluate_pass(
                initial_score,
                initial_score,
                attempted_score,
                get_profile("natural"),
            )

            self.assertTrue(validation["valid"])
            self.assertLessEqual(
                attempted_score["word_count"],
                int(initial_score["word_count"] * get_profile("natural").max_cumulative_ratio),
            )
            self.assertIn(evaluation["reason"], {
            "accepted",
            "accepted_balanced",
            "accepted_permissive",
            "no_meaningful_score_and_length_improvement",
            "no_useful_score_or_length_progress",
        })


if __name__ == "__main__":
    unittest.main()
