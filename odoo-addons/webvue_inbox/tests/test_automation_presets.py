# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .automation_common import BASE, AutomationCase
from odoo.addons.webvue_inbox.models.presets import PRESETS


@tagged('post_install', '-at_install', 'webvue')
class TestAutomationPresets(AutomationCase):

    def apply(self, key, user=None):
        self.login(user or self.manager)
        result = self.api('POST', f'{BASE.replace("/inbox", "")}/settings/inbox/presets/{key}')
        self.assertEqual(result.status_code, 200, result.text)

    def rules(self):
        return self.env['webvue.inbox.rule'].with_context(active_test=False).search([])

    def test_every_sector_fills_the_welcome_menu_the_away_text_and_the_menu_rules(self):
        for key, preset in PRESETS.items():
            channel = self.make_channel(phone_id=f'84{len(key):010d}', name=f'{key} channel')
            self.apply(key)
            channel = self.reload(channel)
            welcome, away = channel._webvue_auto_message('welcome'), channel._webvue_auto_message('away')
            self.assertEqual((welcome.interactive_type, channel.welcome_enabled, channel.away_enabled), ('buttons', True, True), key)
            wanted = preset['automation']
            self.assertEqual(welcome.body, wanted['welcome']['body'])
            self.assertEqual(away.body, wanted['away']['body'])
            option_ids = welcome.option_ids.mapped('option_id')
            self.assertTrue(1 <= len(option_ids) <= 3)
            rules = self.rules().filtered(lambda rule: rule.name in {spec['name'] for spec in wanted['rules']})
            self.assertEqual({rule.option_id for rule in rules}, set(option_ids), key)
            for rule in rules:
                self.assertEqual((rule.match_kind, bool(rule.reply_ids), rule.stop), ('option', True, True))
            rules.unlink()

    def test_applying_twice_adds_nothing_and_never_overwrites(self):
        self.channel._webvue_set_auto_message('welcome', {'body': 'My own welcome'})
        self.apply('clinic')
        counts = (len(self.rules()), self.env['webvue.inbox.auto.message'].search_count([]))
        self.apply('clinic')
        self.assertEqual((len(self.rules()), self.env['webvue.inbox.auto.message'].search_count([])), counts)
        channel = self.reload(self.channel)
        self.assertEqual(channel._webvue_auto_message('welcome').body, 'My own welcome')
        self.assertFalse(channel.welcome_enabled)
        self.assertTrue(channel.away_enabled)

    def test_the_menu_rules_act_on_the_chosen_option(self):
        self.apply('clinic')
        first, _event = self.deliver('مرحبا')
        conversation = first.conversation_id
        self.assertEqual(len(self.automated(conversation)), 1)
        self.deliver('', option=('menu_book', 'حجز موعد'))
        self.assertEqual(conversation.department_id.name, 'المواعيد')
        self.assertEqual(conversation.tag_ids.mapped('name'), ['حجز موعد'])
        self.assertEqual(len(self.automated(conversation)), 2)

    def test_a_settings_manager_without_automation_applies_the_sector_without_the_automation(self):
        user = self.custom_user('preset_settings_only', 'inbox.settings.manage')
        self.apply('store', user)
        self.assertFalse(self.rules())
        self.assertFalse(self.reload(self.channel)._webvue_auto_message('welcome'))
        self.assertTrue(self.env['webvue.inbox.department'].search([('name', '=', 'الشحن')]))
