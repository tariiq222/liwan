# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo.tests import tagged

from .campaign_common import CampaignCase
from odoo.addons.webvue_inbox.models.campaign_constants import DEFAULT_KEYWORDS
from odoo.addons.webvue_inbox.models.presets import PRESETS

URL = '/api/v1/settings/inbox/campaigns'
SETTINGS_KEYS = {
    'consent_policy', 'default_country_code', 'keyword_opt_out', 'stop_keywords', 'start_keywords', 'stop_reply', 'start_reply',
    'default_daily_cap',
}


@tagged('post_install', '-at_install', 'webvue')
class TestCampaignSettings(CampaignCase):

    def setUp(self):
        super().setUp()
        self.login(self.campaigns_only)

    def test_new_settings_start_with_the_default_policy_keywords_and_replies(self):
        settings = self.get(URL).json()
        self.assertEqual(set(settings), SETTINGS_KEYS)
        self.assertEqual(
            (settings['consent_policy'], settings['default_country_code'], settings['keyword_opt_out'], settings['default_daily_cap']),
            ('opted_in_only', None, True, 0),
        )
        self.assertEqual((settings['stop_keywords'], settings['start_keywords']), (list(DEFAULT_KEYWORDS['stop']), list(DEFAULT_KEYWORDS['start'])))
        self.assertIn('اشتراك', settings['stop_reply'])
        self.assertNotIn('إلغاء', settings['stop_keywords'])

    def test_the_policy_is_patched_field_by_field(self):
        patched = self.api('PATCH', URL, {
            'consent_policy': 'not_opted_out', 'default_country_code': '966', 'keyword_opt_out': False, 'stop_reply': None,
            'start_reply': 'Welcome back', 'default_daily_cap': 500,
        }).json()
        self.assertEqual(
            (patched['consent_policy'], patched['default_country_code'], patched['keyword_opt_out'], patched['stop_reply'], patched['start_reply'], patched['default_daily_cap']),
            ('not_opted_out', '966', False, None, 'Welcome back', 500),
        )
        cleared = self.api('PATCH', URL, {'default_country_code': None}).json()
        self.assertEqual(cleared['default_country_code'], None)

    def test_keywords_are_replaced_as_a_whole_and_may_change_kind(self):
        patched = self.api('PATCH', URL, {'stop_keywords': ['وقف', 'quit'], 'start_keywords': ['إيقاف']}).json()
        self.assertEqual((patched['stop_keywords'], patched['start_keywords']), (['وقف', 'quit'], ['إيقاف']))

    def test_every_invalid_value_answers_422_naming_the_field(self):
        cases = [
            ({'consent_policy': 'everyone'}, 'consent_policy'),
            ({'default_country_code': '0966'}, 'default_country_code'),
            ({'default_country_code': 966}, 'default_country_code'),
            ({'keyword_opt_out': 'yes'}, 'keyword_opt_out'),
            ({'stop_keywords': ['stop', 'STOP']}, 'stop_keywords'),
            ({'stop_keywords': ['a'] * 31}, 'stop_keywords'),
            ({'stop_keywords': ['x'], 'start_keywords': ['X']}, 'stop_keywords'),
            ({'start_keywords': ['']}, 'start_keywords'),
            ({'start_keywords': ['x' * 65]}, 'start_keywords'),
            ({'stop_reply': ''}, 'stop_reply'),
            ({'start_reply': 'x' * 1025}, 'start_reply'),
            ({'default_daily_cap': -1}, 'default_daily_cap'),
            ({'unknown': 1}, 'unknown'),
        ]
        for payload, field in cases:
            with self.subTest(payload=payload):
                response = self.api('PATCH', URL, payload)
                self.assertError(response, 422, 'invalid')
                self.assertEqual(response.json().get('field'), field)

    def test_only_the_campaign_capability_reaches_the_settings(self):
        self.login(self.agent)
        self.assertError(self.get(URL), 403, 'forbidden')

    # presets

    def test_a_preset_fills_the_keywords_and_replies_that_are_empty_and_keeps_the_rest(self):
        self.settings.write({'stop_reply': 'my own stop', 'start_reply': False})
        settings = self.settings
        settings._webvue_replace_keywords({'stop': ['وقف']})
        self.login(self.manager)
        result = self.api('POST', '/api/v1/settings/inbox/presets/clinic')
        self.assertEqual(result.status_code, 200, result.text)
        preset = PRESETS['clinic']['campaigns']
        self.assertEqual(settings.stop_reply, 'my own stop')
        self.assertEqual(settings.start_reply, preset['start_reply'])
        stop = settings._webvue_keywords('stop').mapped('value')
        self.assertEqual((stop, preset['stop_keywords'][0] in stop, 'وقف' in stop), (stop, True, True))
        again = self.api('POST', '/api/v1/settings/inbox/presets/clinic')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(len(settings._webvue_keywords('stop')), len(stop))
        self.assertEqual(settings.consent_policy, 'opted_in_only')

    # migration

    def test_the_migration_gives_existing_settings_the_default_keywords_and_replies(self):
        self.settings._webvue_keywords('stop').unlink()
        self.settings._webvue_keywords('start').unlink()
        self.settings.write({'stop_reply': False, 'start_reply': False})
        script = Path(__file__).resolve().parents[1] / 'migrations' / '19.0.1.7.0' / 'post-campaign-keywords.py'
        spec = importlib.util.spec_from_file_location('campaign_keywords_migration', script)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        migration.migrate(self.env.cr, None)
        self.assertFalse(self.settings._webvue_keywords('stop'))
        migration.migrate(self.env.cr, '19.0.1.6.0')
        self.assertEqual(self.settings._webvue_keywords('stop').mapped('value'), list(DEFAULT_KEYWORDS['stop']))
        self.assertEqual(self.settings._webvue_keywords('start').mapped('value'), list(DEFAULT_KEYWORDS['start']))
        self.assertTrue(self.settings.stop_reply and self.settings.start_reply)
        migration.migrate(self.env.cr, '19.0.1.6.0')
        self.assertEqual(len(self.settings._webvue_keywords('stop')), len(DEFAULT_KEYWORDS['stop']))
