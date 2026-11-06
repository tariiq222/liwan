# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api
from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_crm.tests.common import LiwanCrmCase

MODEL = 'crm.lead'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmAiKnowledge(AiProbe, LiwanCrmCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._install_knowledge(sources=None)
        self.indexer_user = self.env.ref('liwan_ai.user_ai_indexer')
        self.env.cr.execute('DELETE FROM liwan_ai.ai_knowledge_queue')
        access = type(self.env['liwan.access.service'])
        original = access._liwan_has_capability
        # The CRM roles carry no assistant capability of their own; the visibility under test is the opportunity's.
        self.patch(access, '_liwan_has_capability', lambda model, user, key, record=None, company=None: (
            key == AI_USE or original(model, user, key, record=record, company=company)
        ))

    def test_the_source_is_declared_and_valid_and_names_no_contact_data(self):
        source = self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_map()[MODEL]
        self.assertEqual((source['owner'], source['feature_key'], source['title_field']), ('liwan_crm', 'crm.enabled', 'name'))
        self.assertFalse({'phone', 'mobile', 'email_from', 'email'} & set(source['fields']))

    def test_the_indexer_may_read_an_opportunity_and_its_stage_but_nothing_to_write(self):
        indexer = self.env.ref('liwan_ai.group_ai_indexer')
        for model in ('crm.lead', 'crm.stage'):
            self.env.cr.execute(
                'SELECT perm_read, perm_write, perm_create, perm_unlink FROM ir_model_access acl'
                ' JOIN ir_model model ON model.id = acl.model_id WHERE model.model = %s AND acl.group_id = %s',
                [model, indexer.id],
            )
            self.assertEqual(self.env.cr.fetchall(), [(True, False, False, False)], model)

    def test_deleting_an_opportunity_queues_its_removal_from_the_index(self):
        lead = self.make_lead(self.agent)
        lead_id = lead.id
        self.env.cr.execute('DELETE FROM liwan_ai.ai_knowledge_queue')
        lead.unlink()
        self.assertEqual(self._queue(MODEL), [('delete', MODEL, lead_id, None, None)])

    def test_an_opportunity_is_resolved_for_its_agent_but_not_for_another_agent(self):
        self.set_visibility('own')
        lead = self.make_lead(self.agent, description='<p>Wants a quote</p>')
        refs = {'refs': [{'model': MODEL, 'res_id': lead.id, 'chunk_no': 0}]}
        for user in (self.agent, self.agent2):
            self._grant_ai_use(user)
        self.as_user(self.agent)
        body = self.api('POST', '/api/v1/ai/knowledge/resolve', refs).json()
        self.assertEqual(body['total'], 1)
        self.assertIn('Wants a quote', body['items'][0]['text'])
        self.assertNotIn('@', body['items'][0]['text'])
        self.as_user(self.agent2)
        self.assertEqual(self.api('POST', '/api/v1/ai/knowledge/resolve', refs).json()['total'], 0)

    def _cold_cache(self):
        """Forget what the test's own (superuser) work loaded: the cron starts cold and must read everything as itself."""
        self.env.flush_all()
        self.env.invalidate_all()

    def _indexer_tick(self):
        self._cold_cache()
        self.env['liwan.ai.knowledge.indexer'].with_user(self.indexer_user)._liwan_cron_tick()

    def _upserts(self):
        return {(row[2], row[3]) for row in self._queue(MODEL) if row[0] == 'upsert'}

    def test_the_technical_user_itself_indexes_the_opportunities_of_every_company_whoever_owns_them(self):
        self.set_visibility('own')
        mine = self.make_lead(self.agent, description='<p>Owned by an agent</p>')
        unassigned = self.make_lead(None)
        foreign = self.make_lead(None, company=self.other_company)
        self._indexer_tick()
        self.assertTrue({
            (mine.id, self.company.id), (unassigned.id, self.company.id), (foreign.id, self.other_company.id),
        } <= self._upserts())
        text = ' '.join(next(row[4] for row in self._queue(MODEL) if row[2] == mine.id and row[0] == 'upsert'))
        self.assertIn('Owned by an agent', text)

    def test_the_real_cron_path_runs_as_the_inactive_technical_user(self):
        lead = self.make_lead(self.agent)
        cron = self.env.ref('liwan_ai.ir_cron_ai_knowledge')
        self._cold_cache()
        # The cron commits (and on failure rolls back) its own transaction; a test must do neither.
        self.patch(self.env.cr, 'commit', lambda: None)
        self.patch(self.env.cr, 'rollback', lambda: None)
        env = api.Environment(self.env.cr, cron.user_id.id, {})
        env['ir.cron'].browse(cron.id)._callback(cron.cron_name, cron.ir_actions_server_id.id)
        self.assertIn((lead.id, self.company.id), self._upserts())

    def test_the_technical_user_reads_only_what_a_source_declares(self):
        as_indexer = self.env(user=self.indexer_user)
        # Models no source declares, whichever of them this database has (HR is not installed beside every bridge).
        for model in ('hr.employee', 'mail.mail', 'res.partner'):
            if model in self.env:
                with self.subTest(model=model), self.assertRaises(AccessError):
                    as_indexer[model].search([])
        with self.assertRaises(AccessError):
            as_indexer['crm.lead'].check_access('write')

    def _pending(self):
        return {(row.res_id, row.source_company_id) for row in self.env['liwan.ai.knowledge.pending'].search([('model', '=', MODEL)])}

    def test_creating_and_writing_an_opportunity_marks_it_and_an_undeclared_write_does_not(self):
        lead = self.make_lead(self.agent)
        self.assertEqual(self._pending(), {(lead.id, self.company)})
        self.env['liwan.ai.knowledge.pending'].search([]).unlink()
        lead.write({'expected_revenue': 5, 'probability': 30})
        self.assertEqual(self._pending(), set())
        lead.write({'description': '<p>New</p>'})
        self.assertEqual(self._pending(), {(lead.id, self.company)})
