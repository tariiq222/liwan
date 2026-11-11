"""Every Playwright config of a CI stage refuses a committed test.only."""
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONFIGS = ('apps/web/playwright.config.ts', 'apps/web/playwright.rtl.config.ts',
           'apps/vendor-admin/playwright.config.ts', 'apps/vendor-admin/playwright.live.config.ts')


class ForbidOnlyTest(unittest.TestCase):
    def test_each_config_forbids_only_in_ci(self):
        for config in CONFIGS:
            with self.subTest(config=config):
                self.assertIn('forbidOnly: !!process.env.CI,', (REPO / config).read_text(encoding='utf-8'))

    def test_no_other_playwright_config_in_the_apps_is_missing_from_the_list(self):
        found = {path.relative_to(REPO).as_posix() for path in (REPO / 'apps').glob('*/playwright*.config.ts')}
        self.assertEqual(found, set(CONFIGS))


if __name__ == '__main__':
    unittest.main()
