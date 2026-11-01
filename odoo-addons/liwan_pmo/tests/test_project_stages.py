# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanPmoCase

STAGE_KEYS = {'id', 'name', 'sequence', 'fold', 'task_count'}


@tagged('post_install', '-at_install', 'liwan')
class TestProjectStages(LiwanPmoCase):

    def _url(self, suffix=''):
        return f'/api/v1/projects/{self.project.id}/stages{suffix}'

    def test_employee_forbidden(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', self._url(), {'name': 'X'})
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))

    def test_lifecycle(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        a = self.api('POST', self._url(), {'name': 'A'})
        self.assertEqual(a.status_code, 201)
        self.assertEqual(set(a.json()), STAGE_KEYS)
        b = self.api('POST', self._url(), {'name': 'B', 'fold': True}).json()
        self.assertTrue(b['fold'])
        ids = [s['id'] for s in self.api('GET', f'/api/v1/projects/{self.project.id}').json()['stages']]
        self.assertEqual(ids[-2:], [a.json()['id'], b['id']])
        res = self.api('PUT', self._url('/order'), {'ids': list(reversed(ids))})
        self.assertEqual(res.status_code, 200)
        self.assertEqual([s['id'] for s in res.json()], list(reversed(ids)))
        res = self.api('PUT', self._url('/order'), {'ids': ids[:1]})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'ids'))
        res = self.api('PATCH', self._url(f"/{a.json()['id']}"), {'name': 'A2', 'fold': True})
        self.assertEqual((res.json()['name'], res.json()['fold']), ('A2', True))
        self.assertEqual(self.api('POST', self._url(), {'name': ''}).status_code, 422)

    def test_a_stage_name_edited_in_either_ui_language_is_stored_for_both(self):
        self.env['res.lang']._activate_lang('ar_001')
        self.env['res.lang']._activate_lang('en_US')
        self.authenticate('api_mgr', 'api_mgr_pass_123')

        def names(stage_id):
            stage = self.env['project.task.type'].browse(stage_id)
            stage.invalidate_recordset()
            return stage.with_context(lang='ar_001').name, stage.with_context(lang='en_US').name

        created = self.url_open(self._url(), json={'name': 'مراجعة'}, headers={'X-Liwan-Ui-Locale': 'ar'})
        self.assertEqual(created.status_code, 201, created.text)
        stage_id = created.json()['id']
        self.assertEqual(names(stage_id), ('مراجعة', 'مراجعة'))
        edited = self.url_open(self._url(f'/{stage_id}'), json={'name': 'Review'}, headers={'X-Liwan-Ui-Locale': 'en'}, method='PATCH')
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(names(stage_id), ('Review', 'Review'))

    def test_delete_rules(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        s = self.api('POST', self._url(), {'name': 'S'}).json()
        self.env['project.task'].create({'name': 't', 'project_id': self.project.id, 'stage_id': s['id']})
        res = self.api('DELETE', self._url(f"/{s['id']}"))
        self.assertEqual((res.status_code, res.json()['code']), (422, 'stage_not_empty'))
        self.assertEqual(self.api('GET', f'/api/v1/projects/{self.project.id}').json()['stages'][-1]['task_count'], 1)
        empty = self.api('POST', self._url(), {'name': 'E'}).json()
        res = self.api('DELETE', self._url(f"/{empty['id']}"))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(self.env['project.task.type'].browse(empty['id']).exists())
        other = self.env['project.project'].create({'name': 'O'})
        foreign = self.env['project.task.type'].create({'name': 'F', 'project_ids': [(4, other.id)]})
        self.assertEqual(self.api('DELETE', self._url(f'/{foreign.id}')).status_code, 422)
