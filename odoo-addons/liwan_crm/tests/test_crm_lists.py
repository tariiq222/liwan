# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanCrmCase

BASE = '/api/v1/crm'
OUTCOME_EFFECTS = {
    'outcome_no_answer': 'follow_up',
    'outcome_thinking': 'follow_up',
    'outcome_call_later': 'follow_up',
    'outcome_sold': 'won',
    'outcome_not_interested': 'lost',
    'outcome_wrong_number': 'lost',
}


@tagged('post_install', '-at_install', 'liwan')
class TestCrmLists(LiwanCrmCase):

    def _ref(self, name):
        return self.env.ref(f'liwan_crm.{name}')

    def _ids(self, resource, **query):
        suffix = ''.join(f'?{key}={value}' for key, value in query.items())
        return [item['id'] for item in self.api('GET', f'{BASE}/{resource}{suffix}').json()['items']]

    def test_seed_is_present_and_exactly_one_stage_is_won(self):
        stages = self.env['crm.stage'].search([])
        self.assertEqual(stages.mapped('name'), ['New', 'Contacted', 'Interested', 'Won'])
        self.assertEqual(stages.filtered('is_won'), self._ref('stage_won'))
        for name, effect in OUTCOME_EFFECTS.items():
            self.assertEqual(self._ref(name).effect, effect)
        self.assertTrue(self._ref('lost_reason_attempts_exhausted').active)

    def test_the_source_list_starts_arabic_and_without_unsuitable_stock_sources(self):
        sources = self.env['utm.source'].search([])
        for name in ('واتساب', 'اتصال هاتفي', 'الموقع الإلكتروني', 'زيارة للفرع', 'توصية من عميل', 'إنستغرام', 'سناب شات'):
            self.assertIn(name, sources.mapped('name'))
        for stock in ('Search engine', 'Lead Recall', 'Newsletter', 'Monster', 'Glassdoor', 'Craigslist'):
            self.assertNotIn(stock, sources.mapped('name'))
            self.assertTrue(self.env['utm.source'].with_context(active_test=False).search([('name', '=', stock)]))
        # Run again as a later update would: a stock source the tenant brought back stays.
        returned = self.env.ref('utm.utm_source_newsletter')
        returned.active = True
        self.env['utm.source']._liwan_retire_stock_sources()
        self.assertTrue(returned.active)

    def test_seeded_names_are_translated_to_arabic(self):
        self.env['res.lang']._activate_lang('ar_001')
        self.env['ir.module.module']._load_module_terms(['liwan_crm'], ['ar_001'])
        arabic = {
            'stage_new': 'جديد', 'stage_contacted': 'تم التواصل', 'stage_interested': 'مهتم',
            'stage_won': 'تم البيع', 'lost_reason_attempts_exhausted': 'انتهت محاولات التواصل',
            'outcome_sold': 'تم البيع',
        }
        for name, expected in arabic.items():
            self.assertEqual(self._ref(name).with_context(lang='ar_001').name, expected, name)
        self.assertEqual(self._ref('stage_new').with_context(lang='en_US').name, 'New')

    def test_agent_reads_every_list_but_writes_none(self):
        self.as_agent()
        for resource in ('stages', 'outcomes', 'lost-reasons', 'sources', 'packages'):
            self.assertEqual(self.api('GET', f'{BASE}/{resource}').status_code, 200, resource)
            self.assertEqual(self.api('POST', f'{BASE}/{resource}', {'name': 'x'}).status_code, 403, resource)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{self._ref("stage_new").id}', {'name': 'x'}).status_code, 403)
        self.assertEqual(self.api('DELETE', f'{BASE}/stages/{self._ref("stage_new").id}').status_code, 403)
        self.assertEqual(self.api('POST', f'{BASE}/stages/order', {'ids': []}).status_code, 403)

    def test_outsider_reads_nothing(self):
        self.as_user(self.outsider)
        for resource in ('stages', 'outcomes', 'lost-reasons', 'sources', 'packages'):
            self.assertEqual(self.api('GET', f'{BASE}/{resource}').status_code, 403, resource)

    def test_stage_crud_and_shape(self):
        self.as_manager()
        listing = self.api('GET', f'{BASE}/stages').json()
        self.assertEqual(listing['total'], 4)
        first = listing['items'][0]
        self.assertEqual(set(first), {'id', 'name', 'sequence', 'is_won', 'active'})
        created = self.api('POST', f'{BASE}/stages', {'name': 'Qualified'})
        self.assertEqual(created.status_code, 200, created.text)
        stage = created.json()
        self.assertFalse(stage['is_won'])
        self.assertGreater(stage['sequence'], listing['items'][-1]['sequence'])
        renamed = self.api('PATCH', f'{BASE}/stages/{stage["id"]}', {'name': 'Qualified lead'}).json()
        self.assertEqual(renamed['name'], 'Qualified lead')
        archived = self.api('DELETE', f'{BASE}/stages/{stage["id"]}')
        self.assertEqual(archived.status_code, 200)
        self.assertFalse(archived.json()['active'])
        self.assertNotIn(stage['id'], self._ids('stages', active='true'))
        self.assertIn(stage['id'], self._ids('stages', active='false'))
        restored = self.api('PATCH', f'{BASE}/stages/{stage["id"]}', {'active': True}).json()
        self.assertTrue(restored['active'])

    def test_stage_validation_is_422(self):
        self.as_manager()
        stage_id = self._ref('stage_new').id
        for body in ({}, {'name': ''}, {'name': 3}, {'name': 'x' * 201}, {'name': 'x', 'is_won': 'yes'}, {'name': 'x', 'sequence': 1}):
            self.assertEqual(self.api('POST', f'{BASE}/stages', body).status_code, 422, body)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{stage_id}', {}).status_code, 422)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/999999999', {'name': 'x'}).status_code, 404)

    def test_the_last_won_stage_cannot_be_archived_or_unflagged(self):
        self.as_manager()
        won = self._ref('stage_won')
        self.assertEqual(self.api('DELETE', f'{BASE}/stages/{won.id}').status_code, 422)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{won.id}', {'is_won': False}).status_code, 422)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{won.id}', {'active': False}).status_code, 422)
        self.assertTrue(won.active and won.is_won)

    def test_flagging_another_stage_won_moves_the_flag_when_the_old_one_is_empty(self):
        self.as_manager()
        interested = self._ref('stage_interested')
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{interested.id}', {'is_won': True}).status_code, 200)
        self.assertEqual(self.env['crm.stage'].search([('is_won', '=', True)]), interested)
        created = self.api('POST', f'{BASE}/stages', {'name': 'Closed', 'is_won': True}).json()
        self.assertEqual(self.env['crm.stage'].search([('is_won', '=', True)]).ids, [created['id']])

    def _lead(self, stage):
        return self.env['crm.lead'].create({'name': 'Lead', 'type': 'opportunity', 'stage_id': stage.id})

    def test_won_flag_moves_only_when_the_old_won_stage_holds_no_opportunities(self):
        self.as_manager()
        won, interested = self._ref('stage_won'), self._ref('stage_interested')
        deal = self._lead(won)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{interested.id}', {'is_won': True}).status_code, 422)
        self.assertEqual(self.api('POST', f'{BASE}/stages', {'name': 'Closed', 'is_won': True}).status_code, 422)
        self.assertEqual(self.env['crm.stage'].search([('is_won', '=', True)]), won)
        self.assertEqual(deal.stage_id, won)
        deal.active = False  # archived opportunities count too
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{interested.id}', {'is_won': True}).status_code, 422)
        deal.unlink()
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{interested.id}', {'is_won': True}).status_code, 200)
        self.assertEqual(self.env['crm.stage'].search([('is_won', '=', True)]), interested)

    def test_a_stage_with_opportunities_cannot_be_archived(self):
        self.as_manager()
        stage = self._ref('stage_contacted')
        lead = self._lead(stage)
        for method, body in (('DELETE', None), ('PATCH', {'active': False})):
            response = self.api(method, f'{BASE}/stages/{stage.id}', body)
            self.assertEqual(response.status_code, 422, method)
            self.assertEqual(response.json()['field'], 'id')
        self.assertTrue(stage.active)
        lead.active = False
        self.assertEqual(self.api('DELETE', f'{BASE}/stages/{stage.id}').status_code, 422)
        lead.unlink()
        self.assertEqual(self.api('DELETE', f'{BASE}/stages/{stage.id}').status_code, 200)

    def test_a_deal_of_another_company_blocks_the_archive_and_the_won_flag_move(self):
        self.as_manager()
        contacted, interested = self._ref('stage_contacted'), self._ref('stage_interested')
        won = self._ref('stage_won')
        self.make_lead(company=self.other_company, stage_id=contacted.id)
        self.make_lead(company=self.other_company, stage_id=won.id)
        self.assertEqual(self.api('DELETE', f'{BASE}/stages/{contacted.id}').status_code, 422)
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{interested.id}', {'is_won': True}).status_code, 422)
        self.assertTrue(contacted.active)
        self.assertEqual(self.env['crm.stage'].search([('is_won', '=', True)]), won)

    def test_retiring_stock_stages_moves_their_leads_and_skips_missing_stages(self):
        stock = self.env.ref('crm.stage_lead1')
        stock.active = True
        lead = self._lead(stock)
        self.env['crm.stage']._liwan_retire_stock_stages()
        self.assertEqual(lead.stage_id, self._ref('stage_new'))
        self.assertFalse(stock.active)
        self.env.ref('crm.stage_lead3').unlink()
        self.env['crm.stage']._liwan_retire_stock_stages()
        self.assertFalse(self.env.ref('crm.stage_lead2').active)

    def test_source_names_clash_in_any_letter_case(self):
        self.as_manager()
        first = self.api('POST', f'{BASE}/sources', {'name': 'crm source x'}).json()
        self.assertEqual(self.api('POST', f'{BASE}/sources', {'name': 'CRM SOURCE X'}).status_code, 409)
        other = self.api('POST', f'{BASE}/sources', {'name': 'Other'}).json()
        self.assertEqual(self.api('PATCH', f'{BASE}/sources/{other["id"]}', {'name': 'CRM Source X'}).status_code, 409)
        self.assertEqual(self.api('PATCH', f'{BASE}/sources/{first["id"]}', {'name': 'Crm Source X'}).status_code, 200)

    def test_source_named_like_an_archived_source_is_409(self):
        self.as_manager()
        source = self.api('POST', f'{BASE}/sources', {'name': 'Expo'}).json()
        self.api('DELETE', f'{BASE}/sources/{source["id"]}')
        again = self.api('POST', f'{BASE}/sources', {'name': 'Expo'})
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()['code'], 'conflict')
        self.assertEqual(self.env['utm.source'].with_context(active_test=False).search_count([('name', '=', 'Expo')]), 1)

    def test_stage_order_must_list_every_active_stage_once(self):
        self.as_manager()
        ids = self._ids('stages')
        reordered = [ids[2], ids[1], ids[0], ids[3]]
        response = self.api('POST', f'{BASE}/stages/order', {'ids': reordered})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item['id'] for item in response.json()['items']], reordered)
        self.assertEqual(self._ids('stages'), reordered)
        for bad in (ids[:-1], [*ids, ids[0]], [*ids[:-1], 999999999], 'x'):
            self.assertEqual(self.api('POST', f'{BASE}/stages/order', {'ids': bad}).status_code, 422, bad)

    def test_the_won_stage_cannot_be_first(self):
        self.as_manager()
        ids = self._ids('stages')
        won = self._ref('stage_won')
        response = self.api('POST', f'{BASE}/stages/order', {'ids': [won.id, *ids[:-1]]})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'ids'))
        self.assertEqual(self._ids('stages'), ids)
        for stage in ids[:-1]:
            if stage != ids[0]:
                self.assertEqual(self.api('DELETE', f'{BASE}/stages/{stage}').status_code, 200)
        first = self._ref('stage_new')
        self.assertEqual(self.api('PATCH', f'{BASE}/stages/{first.id}', {'is_won': True}).status_code, 422)

    def test_the_last_open_stage_cannot_be_archived(self):
        self.as_manager()
        new, contacted, interested = (self._ref(name) for name in ('stage_new', 'stage_contacted', 'stage_interested'))
        for stage in (new, contacted):
            self.assertEqual(self.api('DELETE', f'{BASE}/stages/{stage.id}').status_code, 200)
        response = self.api('DELETE', f'{BASE}/stages/{interested.id}')
        self.assertEqual((response.status_code, response.json()['field']), (422, 'active'))
        self.assertTrue(interested.active)

    def test_outcome_crud(self):
        self.as_manager()
        reason = self._ref('lost_reason_attempts_exhausted')
        created = self.api('POST', f'{BASE}/outcomes', {'name': 'Busy', 'effect': 'lost', 'lost_reason_id': reason.id})
        self.assertEqual(created.status_code, 200, created.text)
        outcome = created.json()
        self.assertEqual(set(outcome), {'id', 'name', 'effect', 'lost_reason_id', 'active'})
        self.assertEqual(outcome['lost_reason_id'], reason.id)
        moved = self.api('PATCH', f'{BASE}/outcomes/{outcome["id"]}', {'effect': 'none'}).json()
        self.assertEqual((moved['effect'], moved['lost_reason_id']), ('none', None))
        self.assertFalse(self.api('DELETE', f'{BASE}/outcomes/{outcome["id"]}').json()['active'])
        self.assertIn(outcome['id'], self._ids('outcomes', active='false'))

    def test_outcome_with_archived_or_misplaced_reason_is_422(self):
        self.as_manager()
        archived = self.env['crm.lost.reason'].create({'name': 'Gone', 'active': False})
        live = self.env['crm.lost.reason'].create({'name': 'Live'})
        for body in (
            {'name': 'A', 'effect': 'lost', 'lost_reason_id': archived.id},
            {'name': 'B', 'effect': 'follow_up', 'lost_reason_id': live.id},
            {'name': 'C', 'effect': 'lost', 'lost_reason_id': 999999999},
            {'name': 'D', 'effect': 'sold'},
            {'name': 'E'},
        ):
            self.assertEqual(self.api('POST', f'{BASE}/outcomes', body).status_code, 422, body)
        outcome = self.api('POST', f'{BASE}/outcomes', {'name': 'F', 'effect': 'lost', 'lost_reason_id': live.id}).json()
        self.assertEqual(self.api('DELETE', f'{BASE}/lost-reasons/{live.id}').status_code, 422)
        self.assertTrue(live.active)
        self.api('DELETE', f'{BASE}/outcomes/{outcome["id"]}')
        self.assertEqual(self.api('DELETE', f'{BASE}/lost-reasons/{live.id}').status_code, 200)

    def test_protected_lost_reason_cannot_be_archived_but_can_be_renamed(self):
        self.as_manager()
        reason = self._ref('lost_reason_attempts_exhausted')
        item = next(i for i in self.api('GET', f'{BASE}/lost-reasons').json()['items'] if i['id'] == reason.id)
        self.assertEqual(set(item), {'id', 'name', 'active', 'protected'})
        self.assertTrue(item['protected'])
        self.assertEqual(self.api('DELETE', f'{BASE}/lost-reasons/{reason.id}').status_code, 422)
        self.assertEqual(self.api('PATCH', f'{BASE}/lost-reasons/{reason.id}', {'active': False}).status_code, 422)
        self.assertEqual(self.api('PATCH', f'{BASE}/lost-reasons/{reason.id}', {'name': 'Exhausted'}).status_code, 200)
        self.assertTrue(reason.active)

    def test_source_crud_archive_and_duplicate_rename(self):
        self.as_manager()
        first = self.api('POST', f'{BASE}/sources', {'name': 'Fair'}).json()
        second = self.api('POST', f'{BASE}/sources', {'name': 'Referral list'}).json()
        self.assertEqual(set(first), {'id', 'name', 'active'})
        clash = self.api('PATCH', f'{BASE}/sources/{second["id"]}', {'name': 'Fair'})
        self.assertEqual(clash.status_code, 409)
        self.assertEqual(clash.json()['code'], 'conflict')
        self.assertFalse(self.api('DELETE', f'{BASE}/sources/{first["id"]}').json()['active'])
        self.assertNotIn(first['id'], self._ids('sources', active='true'))

    def test_package_crud_and_validation(self):
        self.as_manager()
        created = self.api('POST', f'{BASE}/packages', {'name': 'Basic', 'price': 150.5, 'description': 'Monthly'})
        self.assertEqual(created.status_code, 200, created.text)
        package = created.json()
        self.assertEqual(package, {'id': package['id'], 'name': 'Basic', 'price': 150.5, 'description': 'Monthly', 'active': True})
        template = self.env['product.template'].browse(package['id'])
        self.assertTrue(template.liwan_crm_package)
        self.assertEqual(template.company_id, self.company)
        for name in ('taxes_id', 'supplier_taxes_id'):
            if name in template._fields:
                self.assertFalse(template[name])
        patched = self.api('PATCH', f'{BASE}/packages/{package["id"]}', {'price': 0, 'description': ''}).json()
        self.assertEqual((patched['price'], patched['description']), (0, ''))
        for body in (
            {'name': 'N', 'price': -1}, {'name': 'N', 'price': '5'}, {'name': 'N', 'price': True},
            {'name': 'N'}, {'price': 5}, {'name': 'N', 'price': 1, 'company_id': 1},
        ):
            self.assertEqual(self.api('POST', f'{BASE}/packages', body).status_code, 422, body)
        self.assertEqual(self.api('PATCH', f'{BASE}/packages/{package["id"]}', {'price': -0.01}).status_code, 422)
        self.assertFalse(self.api('DELETE', f'{BASE}/packages/{package["id"]}').json()['active'])
        self.assertTrue(template.exists())

    def test_agent_reads_packages_of_the_current_company_only(self):
        template = self.env['product.template']
        mine = template.create({'name': 'Mine', 'list_price': 10, 'liwan_crm_package': True, 'company_id': self.company.id})
        shared = template.create({'name': 'Shared', 'list_price': 20, 'liwan_crm_package': True})
        foreign = template.create({'name': 'Foreign', 'list_price': 30, 'liwan_crm_package': True, 'company_id': self.other_company.id})
        plain = template.create({'name': 'Plain product', 'list_price': 40})
        self.as_agent()
        ids = self._ids('packages')
        self.assertIn(mine.id, ids)
        self.assertIn(shared.id, ids)
        self.assertNotIn(foreign.id, ids)
        self.assertNotIn(plain.id, ids)
        self.as_manager()
        for hidden in (foreign, plain):
            self.assertEqual(self.api('PATCH', f'{BASE}/packages/{hidden.id}', {'price': 1}).status_code, 404)
            self.assertEqual(self.api('DELETE', f'{BASE}/packages/{hidden.id}').status_code, 404)
        self.assertEqual((plain.list_price, foreign.list_price), (40, 30))
