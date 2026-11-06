# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.models import knowledge_indexer
from odoo.addons.liwan_ai.models.access_service import AI_USE
from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_tasks.tests.common import LiwanTasksCase

MODEL = 'project.task'


@tagged('post_install', '-at_install', 'liwan')
class TestTasksAiKnowledge(AiProbe, LiwanTasksCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._install_knowledge(sources=None)
        self.patch(knowledge_indexer, 'SETTLE_SECONDS', 0)
        self.indexer_user = self.env.ref('liwan_ai.user_ai_indexer')
        self.env.cr.execute('DELETE FROM liwan_ai.ai_knowledge_queue')

    def test_the_tasks_source_is_declared_and_valid(self):
        source = self.env['liwan.ai.knowledge.registry']._liwan_ai_knowledge_map()[MODEL]
        self.assertEqual((source['owner'], source['feature_key'], source['title_field']), ('liwan_tasks', 'tasks.enabled', 'name'))

    def test_the_indexer_may_read_a_task_and_what_its_text_names_but_nothing_to_write(self):
        indexer = self.env.ref('liwan_ai.group_ai_indexer')
        for model in ('project.task', 'project.project', 'project.task.type'):
            self.env.cr.execute(
                'SELECT perm_read, perm_write, perm_create, perm_unlink FROM ir_model_access acl'
                ' JOIN ir_model model ON model.id = acl.model_id WHERE model.model = %s AND acl.group_id = %s',
                [model, indexer.id],
            )
            self.assertEqual(self.env.cr.fetchall(), [(True, False, False, False)], model)

    def test_deleting_a_task_queues_its_removal_from_the_index(self):
        project = self.env['project.project'].create({'name': 'Knowledge project'})
        task = self.env['project.task'].create({'name': 'Doomed', 'project_id': project.id})
        task_id = task.id
        self.env.cr.execute('DELETE FROM liwan_ai.ai_knowledge_queue')
        task.unlink()
        self.assertEqual(self._queue(MODEL), [('delete', MODEL, task_id, None, None)])

    def test_a_personal_task_is_resolved_for_its_participants_only(self):
        task = self.make_personal_task(self.alice)
        refs = {'refs': [{'model': MODEL, 'res_id': task.id, 'chunk_no': 0}]}
        for user in (self.alice, self.bob):
            self._grant_ai_use(user)
        self.authenticate('tasks_alice', 'tasks_alice_pass_123')
        self.assertEqual(self.api('POST', '/api/v1/ai/knowledge/resolve', refs).json()['total'], 1)
        self.authenticate('tasks_bob', 'tasks_bob_pass_123')
        self.assertEqual(self.api('POST', '/api/v1/ai/knowledge/resolve', refs).json()['total'], 0)

    def _task(self, company, name):
        project = self.env['project.project'].create({'name': f'{name} project', 'company_id': company.id})
        return self.env['project.task'].create({'name': name, 'project_id': project.id, 'description': f'<p>{name} body</p>'})

    def _upserts(self):
        return {(row[2], row[3]) for row in self._queue(MODEL) if row[0] == 'upsert'}

    def test_the_technical_user_itself_indexes_the_tasks_of_every_company(self):
        other = self.env['res.company'].create({'name': 'Second tasks company'})
        first = self._task(self.env.company, 'First company task')
        second = self._task(other, 'Second company task')
        # The technical user, not the superuser: its capability and read access rows are all it has.
        self.env['liwan.ai.knowledge.indexer'].with_user(self.indexer_user)._liwan_cron_tick()
        self.assertTrue({(first.id, self.env.company.id), (second.id, other.id)} <= self._upserts())
        rows = {row[2]: row[4] for row in self._queue(MODEL) if row[0] == 'upsert'}
        self.assertIn('First company task', rows[first.id][0])
        self.assertIn('Second company task body', ' '.join(rows[second.id]))

    def test_the_real_cron_path_runs_as_the_inactive_technical_user(self):
        task = self._task(self.env.company, 'Cron task')
        cron = self.env.ref('liwan_ai.ir_cron_ai_knowledge')
        self.assertFalse(cron.user_id.active)
        self.env.flush_all()
        self.patch(self.env.cr, 'commit', lambda: None)  # the cron commits its own transaction; a test must not
        env = api.Environment(self.env.cr, cron.user_id.id, {})
        env['ir.cron'].browse(cron.id)._callback(cron.cron_name, cron.ir_actions_server_id.id)
        self.assertIn((task.id, self.env.company.id), self._upserts())

    def test_a_personal_task_is_not_indexed(self):
        task = self.make_personal_task(self.alice)
        self.env['liwan.ai.knowledge.indexer'].with_user(self.indexer_user)._liwan_cron_tick()
        self.assertNotIn(task.id, {row[2] for row in self._queue(MODEL)})

    def test_the_technical_user_reads_only_what_a_source_declares(self):
        as_indexer = self.env(user=self.indexer_user)
        with self.assertRaises(AccessError):
            as_indexer['hr.employee'].search([])
        with self.assertRaises(AccessError):
            as_indexer['res.users'].search([('id', '!=', 0)]).mapped('login')
        with self.assertRaises(AccessError):
            as_indexer['project.task'].check_access('write')

    def _pmo_reader(self):
        """A user whose only role reads PMO projects and tasks: an ordinary project member without management rights."""
        user = new_test_user(
            self.env, login='tasks_pmo_reader', password='tasks_pmo_reader_pass_123', name='Reader',
            groups='liwan_core.group_employee',
        )
        role = self.env['liwan.access.role'].create({
            'key': 'tasks_pmo_reader', 'name_ar': 'قارئ المشاريع', 'name_en': 'Project reader', 'type': 'custom',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read'])]).ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': self.env.company.id}])
        return user

    def test_a_project_task_resolves_with_its_project_for_a_pmo_reader_and_for_a_tasks_only_employee(self):
        access = type(self.env['liwan.access.service'])
        original = access._liwan_has_capability
        # The roles under test carry no assistant capability of their own; what is under test is what each may read.
        self.patch(access, '_liwan_has_capability', lambda model, user, key, record=None, company=None: (
            key == AI_USE or original(model, user, key, record=record, company=company)
        ))
        task = self._task(self.env.company, 'Shared task')
        refs = {'refs': [{'model': MODEL, 'res_id': task.id, 'chunk_no': 0}]}
        reader = self._pmo_reader()
        self.authenticate(reader.login, 'tasks_pmo_reader_pass_123')
        body = self.api('POST', '/api/v1/ai/knowledge/resolve', refs).json()
        self.assertEqual(body['total'], 1, body)
        self.assertIn('Shared task project', body['items'][0]['text'])
        self._grant_ai_use(self.alice)
        self.authenticate('tasks_alice', 'tasks_alice_pass_123')
        body = self.api('POST', '/api/v1/ai/knowledge/resolve', refs).json()
        self.assertEqual(body['total'], 1, body)
        self.assertIn('Shared task project', body['items'][0]['text'])
