import unittest

from experiment import SYSTEM_PROMPT, run_experiment


class ContextCompressionExperimentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.results = {result.strategy: result for result in run_experiment()}

    def test_no_compression_retains_information_but_does_not_reduce_size(self) -> None:
        result = self.results["no_compression"]
        self.assertTrue(result.retention_passed)
        self.assertFalse(result.size_reduction_passed)
        self.assertFalse(result.passes_all_conditions)

    def test_sliding_window_loses_early_task_information(self) -> None:
        result = self.results["sliding_window"]
        failed_checks = {check.name for check in result.checks if not check.passed}
        self.assertIn("hard_constraint", failed_checks)
        self.assertIn("exact_identifier", failed_checks)
        self.assertIn("failed_path", failed_checks)
        self.assertIn("evidence", failed_checks)
        self.assertFalse(result.passes_all_conditions)

    def test_task_aware_structured_strategy_passes_all_conditions(self) -> None:
        result = self.results["task_aware_structured"]
        self.assertTrue(result.retention_passed)
        self.assertTrue(result.size_reduction_passed)
        self.assertTrue(result.passes_all_conditions)
        self.assertLessEqual(result.compression_ratio, 0.5)

    def test_task_aware_strategy_keeps_system_prompt_unchanged(self) -> None:
        result = self.results["task_aware_structured"]
        self.assertTrue(result.rendered_context.startswith("[SYSTEM]\n" + SYSTEM_PROMPT))


if __name__ == "__main__":
    unittest.main()
