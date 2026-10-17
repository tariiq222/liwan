# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest
from unittest.mock import patch

import upgrade_baseline


class UpgradeBaselineTest(unittest.TestCase):
    def test_pre_namespace_releases_are_not_upgrade_sources(self):
        def git(*arguments):
            return 'release/19.0.1.0.0' if arguments[0] == 'tag' else ''

        with patch.object(upgrade_baseline, 'git', side_effect=git):
            self.assertEqual(upgrade_baseline.compatible_release(), '')

    def test_selects_newest_compatible_release_without_requiring_future_addons(self):
        def git(*arguments):
            if arguments[0] == 'tag':
                return 'release/19.0.4.0.0\nrelease/19.0.3.0.0\nrelease/19.0.2.0.0'
            return upgrade_baseline.FOUNDATION_MANIFEST if arguments[3] != 'release/19.0.4.0.0' else ''

        with patch.object(upgrade_baseline, 'git', side_effect=git):
            self.assertEqual(upgrade_baseline.compatible_release(), 'release/19.0.3.0.0')

    def test_ci_selects_compatible_source_before_creating_runtime_resources(self):
        source = (upgrade_baseline.ROOT / 'deploy/ci/upgrade.sh').read_text()
        selector = 'BASE_TAG="$(python3 -B tools/upgrade_baseline.py)"'
        self.assertIn(selector, source)
        self.assertLess(source.index(selector), source.index('SCRATCH_DB="webvue_ci_upgrade_scratch"'))
        self.assertIn('no WebVue-namespace release baseline; fresh-install gate remains binding', source)
