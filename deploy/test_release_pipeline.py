"""Release HTTP unit tests need installed jiti and canonical package imports."""
import unittest

from deploy.test_ci_stages import commands


class ReleasePipelineTests(unittest.TestCase):
    def test_static_installs_dependencies_before_canonical_release_discovery(self):
        script = commands('static')
        release = "python3 -B -m unittest discover -s deploy/releases -t . -p 'test_*.py'"
        self.assertIn(release, script)
        self.assertIn('PYTHONPATH=deploy python3 -B -m unittest deploy/test_*.py', script)
        self.assertLess(script.index('npm ci --ignore-scripts'), script.index(release))
        self.assertNotIn("discover -s deploy -p 'test_*.py'", script)

    def test_static_keeps_dedicated_and_shared_guard_regressions(self):
        script = commands('static')
        # The glob picks up release-guard, release-assets, release-routes and every later deploy/shared test.
        for name in ('deploy/shared/*.test.mjs', 'deploy/releases/test_dedicated_guard.mjs'):
            self.assertIn(name, script)


if __name__ == '__main__':
    unittest.main()
