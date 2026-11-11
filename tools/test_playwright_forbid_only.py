"""Every Playwright config in the repository refuses a committed test.only under CI."""
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONFIGS = ('apps/web/playwright.config.ts', 'apps/web/playwright.rtl.config.ts',
           'apps/vendor-admin/playwright.config.ts', 'apps/vendor-admin/playwright.live.config.ts',
           'tools/shared_acceptance_live/playwright.config.mjs')


class ForbidOnlyTest(unittest.TestCase):
    def test_each_config_forbids_only_in_ci(self):
        for config in CONFIGS:
            with self.subTest(config=config):
                self.assertIn('forbidOnly: !!process.env.CI,', (REPO / config).read_text(encoding='utf-8'))

    def test_no_other_playwright_config_is_missing_from_the_list(self):
        tracked = subprocess.run(['git', '-C', str(REPO), 'ls-files', '*playwright*.config.*'], capture_output=True, text=True, check=True)
        found = set(tracked.stdout.split())
        self.assertEqual(found, set(CONFIGS))


if __name__ == '__main__':
    unittest.main()
