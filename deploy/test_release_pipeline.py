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
        for name in ('deploy/shared/release-guard.test.mjs',
                     'deploy/shared/release-assets.test.mjs',
                     'deploy/shared/release-routes.test.mjs',
                     'deploy/releases/test_dedicated_guard.mjs'):
            self.assertIn(name, script)


if __name__ == '__main__':
    unittest.main()
