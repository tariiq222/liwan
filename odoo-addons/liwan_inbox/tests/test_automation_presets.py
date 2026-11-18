# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .automation_common import BASE, AutomationCase, hours
from odoo.addons.liwan_inbox.models.campaign_constants import START_KEYWORD
from odoo.addons.liwan_inbox.models.presets import PRESETS


@tagged('post_install', '-at_install', 'liwan')
class TestAutomationPresets(AutomationCase):

    def apply(self, key, user=None):
        self.login(user or self.manager)
        result = self.api('POST', f'{BASE.replace("/inbox", "")}/settings/inbox/presets/{key}')
        self.assertEqual(result.status_code, 200, result.text)

    def rules(self):
        return self.env['liwan.inbox.rule'].with_context(active_test=False).search([])

    def test_every_sector_fills_the_welcome_menu_the_away_text_and_the_menu_rules(self):
        for key, preset in PRESETS.items():
            channel = self.make_channel(phone_id=f'84{len(key):010d}', name=f'{key} channel')
            self.apply(key)
            channel = self.reload(channel)
            welcome, away = channel._liwan_auto_message('welcome'), channel._liwan_auto_message('away')
            self.assertEqual((welcome.interactive_type, channel.welcome_enabled, channel.away_enabled), ('buttons', False, False), key)
            wanted = preset['automation']
            self.assertEqual(welcome.body, wanted['welcome']['body'])
            self.assertEqual(away.body, wanted['away']['body'])
            option_ids = welcome.option_ids.mapped('option_id')
            self.assertTrue(1 <= len(option_ids) <= 3)
            rules = self.rules().filtered(lambda rule: rule.name in {spec['name'] for spec in wanted['rules']})
            self.assertEqual({rule.option_id for rule in rules}, set(option_ids), key)
            for rule in rules:
                self.assertEqual((rule.match_kind, bool(rule.reply_ids), rule.stop, rule.active), ('option', True, True, False))
            rules.unlink()

    def test_applying_twice_adds_nothing_and_never_overwrites(self):
        self.channel._liwan_set_auto_message('welcome', {'body': 'My own welcome'})
        self.apply('clinic')
        counts = (len(self.rules()), self.env['liwan.inbox.auto.message'].search_count([]))
        self.apply('clinic')
        self.assertEqual((len(self.rules()), self.env['liwan.inbox.auto.message'].search_count([])), counts)
        channel = self.reload(self.channel)
        self.assertEqual(channel._liwan_auto_message('welcome').body, 'My own welcome')
        self.assertEqual((channel.welcome_enabled, channel.away_enabled), (False, False))
        self.assertTrue(channel._liwan_auto_message('away'))

    def test_the_menu_rules_act_on_the_chosen_option_once_switched_on(self):
        self.apply('clinic')
        self.channel.welcome_enabled = True
        self.rules().write({'active': True})
        first, _event = self.deliver('مرحبا')
        conversation = first.conversation_id
        self.assertEqual(len(self.automated(conversation)), 1)
        self.deliver('', option=('menu_book', 'حجز موعد'))
        self.assertEqual(conversation.department_id.name, 'المواعيد')
        self.assertEqual(conversation.tag_ids.mapped('name'), ['حجز موعد'])
        self.assertEqual(len(self.automated(conversation)), 2)

    def test_applying_a_sector_switches_nothing_on(self):
        self.apply('clinic')
        message, _event = self.deliver('مرحبا')
        self.assertFalse(self.automated(message.conversation_id))
        self.assertFalse(self.rules().filtered('active'))

    def test_a_settings_manager_without_automation_applies_the_sector_without_the_automation(self):
        user = self.custom_user('preset_settings_only', 'inbox.settings.manage')
        self.apply('store', user)
        self.assertFalse(self.rules())
        self.assertFalse(self.reload(self.channel)._liwan_auto_message('welcome'))
        self.assertTrue(self.env['liwan.inbox.department'].search([('name', '=', 'الشحن')]))

    def test_the_hours_reply_and_the_menu_reply_follow_the_working_hours(self):
        self.env['liwan.inbox.working.hours']._liwan_write(self.settings, hours([
            {'weekday': day, 'from': '09:00', 'to': '21:00'} for day in (6, 0, 1, 2, 3)
        ]))
        self.apply('clinic')
        wanted = 'ساعات الدوام: من الأحد إلى الخميس، من 9:00 إلى 21:00.'
        self.assertEqual(self.env['liwan.inbox.canned.reply'].search([('shortcut', '=', 'hours')]).body, wanted)
        rule = self.rules().filtered(lambda row: row.option_id == 'menu_hours')
        self.assertEqual(rule.reply_ids.body, wanted)

    def test_without_working_hours_the_company_says_it_is_always_open(self):
        self.apply('clinic')
        self.assertEqual(
            self.env['liwan.inbox.canned.reply'].search([('shortcut', '=', 'hours')]).body,
            'ساعات الدوام: نستقبل رسائلكم في أي وقت.',
        )

    def test_an_existing_hours_reply_is_never_overwritten(self):
        self.env['liwan.inbox.canned.reply'].create({'shortcut': 'hours', 'body': 'My own hours', 'company_id': self.env.company.id})
        self.apply('clinic')
        self.assertEqual(self.env['liwan.inbox.canned.reply'].search([('shortcut', '=', 'hours')]).body, 'My own hours')

    def test_every_sector_registers_the_start_word_its_stop_reply_asks_for(self):
        for key, preset in PRESETS.items():
            self.assertIn(START_KEYWORD, preset['campaigns']['start_keywords'], key)
            self.assertIn(START_KEYWORD, preset['campaigns']['stop_reply'], key)
        self.env['liwan.inbox.settings']._get_for_company()._liwan_keywords('start').unlink()
        self.apply('store')
        self.assertIn(START_KEYWORD, self.env['liwan.inbox.settings']._get_for_company()._liwan_keywords('start').mapped('value'))
