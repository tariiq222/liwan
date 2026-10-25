import unittest

from tools.finance_close_race import (
    _collect_worker_results,
    _remaining_budget,
    classify_results,
)


class DeadlineTests(unittest.TestCase):
    def test_remaining_budget_clamps_to_zero(self):
        self.assertEqual(_remaining_budget(10.0, clock=lambda: 12.0), 0.0)

    def test_stuck_worker_is_reported_as_timeout(self):
        class StuckWorker:
            def join(self, timeout):
                self.timeout = timeout

            def is_alive(self):
                return True

        worker = StuckWorker()
        results = _collect_worker_results([worker], 10.0, clock=lambda: 7.5)
        self.assertEqual(worker.timeout, 2.5)
        self.assertEqual(results, [{"error": "timeout"}])


class ClassifierTests(unittest.TestCase):
    def test_success_and_already_closed_pass(self):
        results = [
            {"status": 200, "body": {"result": {"state": "closed"}}},
            {"status": 422, "body": {"code": "already_closed", "message": "closed"}},
        ]
        self.assertTrue(classify_results(results)[0])

    def test_two_successes_fail(self):
        results = [
            {"status": 200, "body": {"result": {"state": "closed"}}},
            {"status": 201, "body": {"result": {"state": "closed"}}},
        ]
        self.assertFalse(classify_results(results)[0])

    def test_timeout_and_server_error_fail(self):
        self.assertFalse(
            classify_results([{"error": "timeout"}, {"status": 200, "body": {}}])[0],
        )
        self.assertFalse(
            classify_results(
                [{"status": 500, "body": {}}, {"status": 200, "body": {}}],
            )[0],
        )

    def test_unknown_refusal_code_fails(self):
        results = [
            {"status": 200, "body": {"result": {}}},
            {"status": 422, "body": {"code": "unexpected", "message": "no"}},
        ]
        self.assertFalse(classify_results(results)[0])


if __name__ == "__main__":
    unittest.main()
