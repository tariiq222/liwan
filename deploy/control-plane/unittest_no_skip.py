#!/usr/bin/env python3
"""Run unittest modules and fail when any test skipped, errored, failed or when no test ran.

Usage (from the repository root): PYTHONPATH=. unittest_no_skip.py <dotted.module>...
CI uses it for live suites whose precondition (a scratch database) the stage provides, so a missing
precondition fails instead of skipping.
"""
import sys
import unittest


def run(modules: list[str]) -> int:
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromNames(modules))
    if result.skipped:
        for test, reason in result.skipped:
            print(f'skipped: {test} ({reason})', file=sys.stderr)
    if result.testsRun == 0:
        print('no tests ran', file=sys.stderr)
    return 0 if result.wasSuccessful() and not result.skipped and result.testsRun else 1


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: unittest_no_skip.py <dotted.module>...', file=sys.stderr)
        sys.exit(2)
    sys.exit(run(sys.argv[1:]))
