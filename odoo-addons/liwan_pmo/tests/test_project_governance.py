# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

from psycopg2.errors import UniqueViolation

from odoo import sql_db
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged
from odoo.tools import SQL, mute_logger

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestProjectGovernance(LiwanPmoCase):

    def setUp(self):
        super().setUp()
        self.companyless_project = self.project
        self.project = self.env['project.project'].create({'name': 'Governance', 'company_id': self.env.company.id})
        self.task_overdue = self.env['project.task'].create({'name': 'Governance task', 'project_id': self.project.id, 'user_ids': [(4, self.employee.id)]})
        self.governance_url = f'/api/v1/projects/{self.project.id}'
        # These tests exercise the register's data rules, not its status policy (see test_policy_settings).
        self.env['ir.config_parameter'].sudo().set_param(f'liwan_pmo.register_status_transitions.{self.env.company.id}', 'free')

    def test_manager_crud_raci_and_register_roundtrip(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        stakeholders = self.api('GET', self.governance_url + '/stakeholders').json()
        self.assertEqual((stakeholders['items'], stakeholders['total']), ([], 0))
        created = self.api('POST', self.governance_url + '/stakeholders', {
            'name': 'External sponsor', 'organization': 'Acme', 'contact': 'sponsor@example.test',
        })
        self.assertEqual(created.status_code, 201, created.text)
        stakeholder = created.json()
        raci = self.api('POST', self.governance_url + '/raci', {
            'task_id': self.task_overdue.id, 'stakeholder_id': stakeholder['id'], 'role': 'A',
        })
        self.assertEqual(raci.status_code, 201, raci.text)
        duplicate = self.api('POST', self.governance_url + '/raci', {
            'task_id': self.task_overdue.id, 'stakeholder_id': stakeholder['id'], 'role': 'R',
        })
        self.assertEqual(duplicate.status_code, 422)
        risk = self.api('POST', self.governance_url + '/register', {
            'kind': 'risk', 'title': 'Late dependency', 'priority': 'high', 'probability': 4,
            'impact': 5, 'task_id': self.task_overdue.id,
        })
        self.assertEqual(risk.status_code, 201, risk.text)
        self.assertEqual(risk.json()['score'], 20)
        issue = self.api('POST', self.governance_url + '/register', {
            'kind': 'issue', 'title': 'Open blocker', 'priority': 'critical',
        })
        self.assertEqual(issue.status_code, 201, issue.text)
        self.assertIsNone(issue.json()['score'])
        blocked = self.api('DELETE', f"{self.governance_url}/stakeholders/{stakeholder['id']}")
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(self.api('DELETE', f"{self.governance_url}/raci/{raci.json()['id']}").status_code, 204)
        self.assertEqual(self.api('DELETE', f"{self.governance_url}/stakeholders/{stakeholder['id']}").status_code, 204)

    def test_employee_cannot_write_and_orm_parent_is_immutable(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('POST', self.governance_url + '/stakeholders', {'name': 'Denied'})
        self.assertEqual(response.status_code, 403)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        stakeholder = self.env['liwan.project.stakeholder'].with_user(self.manager).create({
            'project_id': self.project.id, 'name': 'ORM guard',
        })
        other = self.env['project.project'].create({'name': 'Other governance project'})
        with self.assertRaises(ValidationError):
            stakeholder.write({'project_id': other.id})

    def test_foreign_project_is_not_readable_from_project_scope(self):
        other_company = self.env['res.company'].create({'name': 'Governance Other Company'})
        other = self.env['project.project'].create({'name': 'Foreign', 'company_id': other_company.id})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('GET', f'/api/v1/projects/{other.id}/stakeholders')
        # Another company's project is not-found, not forbidden: the answer
        # must not reveal that the record exists.
        self.assertEqual(response.status_code, 404)

    def test_direct_orm_reader_cannot_unlink_batch(self):
        stakeholder = self.env['liwan.project.stakeholder'].with_user(self.manager).create({'project_id': self.project.id, 'name': 'Sponsor'})
        row = self.env['liwan.project.raci'].with_user(self.manager).create({'project_id': self.project.id, 'task_id': self.task_overdue.id, 'stakeholder_id': stakeholder.id, 'role': 'A'})
        items = self.env['liwan.project.register'].with_user(self.manager).create([{'project_id': self.project.id, 'kind': 'issue', 'title': title} for title in ('One', 'Two')])
        for records in (row, items, stakeholder):
            with self.assertRaises(AccessError):
                records.with_user(self.employee).unlink()
        items.unlink()
        row.unlink()
        stakeholder.unlink()

    def test_derived_columns_and_context_defaults_are_not_writable(self):
        stakeholder_model = self.env['liwan.project.stakeholder'].with_user(self.manager)
        stakeholder = stakeholder_model.create({'project_id': self.project.id, 'name': 'Sponsor'})
        values = {'project_id': self.project.id, 'task_id': self.task_overdue.id, 'stakeholder_id': stakeholder.id, 'role': 'A'}
        model = self.env['liwan.project.raci'].with_user(self.manager)
        row = model.create(values)
        risk_model = self.env['liwan.project.register'].with_user(self.manager)
        risk_values = {'project_id': self.project.id, 'kind': 'risk', 'title': 'Risk', 'probability': 5, 'impact': 5}
        risk = risk_model.create(risk_values)
        for record, field, value, create_values in ((row, 'accountable_task_id', False, values), (risk, 'score', 1, risk_values)):
            with self.assertRaises(ValidationError):
                record.write({field: value})
            with self.assertRaises(ValidationError):
                record.create(dict(create_values, **{field: value}))
            with self.assertRaises(ValidationError):
                record.with_context(**{'default_' + field: value}).create(create_values)
            with self.assertRaises(ValidationError):
                record.copy({field: value})
        other = self.env['project.project'].create({'name': 'Other', 'company_id': self.env.company.id})
        task = self.env['project.task'].create({'name': 'Other task', 'project_id': other.id})
        with self.assertRaises(ValidationError):
            risk_model.with_context(default_task_id=task.id).create(risk_values)
        portal = new_test_user(self.env, login='governance_portal', groups='base.group_portal')
        for model, defaults, vals in ((stakeholder_model, {'default_user_id': portal.id}, {'project_id': self.project.id, 'name': 'Invalid'}), (risk_model, {'default_owner_id': portal.id}, risk_values)):
            with self.assertRaises(ValidationError):
                model.with_context(**defaults).create(vals)
        self.assertEqual(risk.score, 25)
        self.assertEqual(row.accountable_task_id, self.task_overdue)

    def test_mixed_batches_preserve_metrics_and_date_only(self):
        model = self.env['liwan.project.register'].with_user(self.manager)
        issue, risk = model.create([{'project_id': self.project.id, 'kind': 'issue', 'title': 'Issue'}, {'project_id': self.project.id, 'kind': 'risk', 'title': 'Risk', 'probability': 4, 'impact': 5}])
        for records in (issue | risk, risk | issue):
            records.write({'status': 'closed'})
            self.assertEqual((risk.probability, risk.impact, risk.score), (4, 5, 20))
            self.assertEqual((issue.probability, issue.impact, issue.score), (0, 0, 0))
        for value in ('2026-02-29', '2026-04-31', '2026-01-01T00:00:00', datetime(2026, 1, 1), True):
            with self.assertRaises(ValidationError):
                risk.write({'due_date': value})
        risk.write({'due_date': date(2024, 2, 29)})
        self.assertEqual(risk.due_date, date(2024, 2, 29))

    def test_http_patch_details_filters_and_delete(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        stakeholder = self.api('POST', self.governance_url + '/stakeholders', {'name': 'Sponsor', 'user_id': self.manager.id}).json()
        stakeholder_url = f"{self.governance_url}/stakeholders/{stakeholder['id']}"
        response = self.api('PATCH', stakeholder_url, {'notes': 'Saved note', 'organization': 'Governance org'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.api('GET', stakeholder_url).json()['user']['id'], self.manager.id)
        self.assertEqual(self.api('GET', self.governance_url + '/stakeholders?q=Governance%20org').json()['total'], 1)
        self.assertEqual(self.api('GET', self.governance_url + '/stakeholders?limit=1&offset=1').json()['items'], [])
        row = self.api('POST', self.governance_url + '/raci', {'task_id': self.task_overdue.id, 'stakeholder_id': stakeholder['id'], 'role': 'R'}).json()
        row_url = f"{self.governance_url}/raci/{row['id']}"
        changed = self.api('PATCH', row_url, {'role': 'A'})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()['role'], 'A')
        self.assertEqual(self.api('GET', self.governance_url + f"/raci?task_ids={self.task_overdue.id}&stakeholder_ids={stakeholder['id']}").json()['total'], 1)
        item = self.api('POST', self.governance_url + '/register', {'kind': 'risk', 'title': 'Risk', 'probability': 4, 'impact': 5, 'due_date': '2024-02-29', 'owner_id': self.manager.id}).json()
        item_url = f"{self.governance_url}/register/{item['id']}"
        response = self.api('PATCH', item_url, {'status': 'closed', 'priority': 'critical', 'response': 'Mitigated'})
        self.assertEqual(response.status_code, 200, response.text)
        detail = self.api('GET', item_url).json()
        self.assertEqual((detail['status'], detail['response'], detail['due_date'], detail['owner']['id'], detail['score']), ('closed', 'Mitigated', '2024-02-29', self.manager.id, 20))
        filtered = self.api('GET', self.governance_url + '/register?kind=risk&status=closed&priority=critical&q=Mitigated').json()
        self.assertEqual([item['id'] for item in filtered['items']], [detail['id']])
        for payload in ({'due_date': '2026-02-29'}, {'due_date': '2026-01-01T12:30:00'}, {'kind': 'issue'}, {'score': 1}, {'task_id': 999999999}):
            rejected = self.api('PATCH', item_url, payload)
            self.assertEqual(rejected.status_code, 422, rejected.text)
        self.assertEqual(self.api('DELETE', item_url).status_code, 204)
        self.assertEqual(self.api('GET', item_url).status_code, 404)
        self.assertEqual(self.api('DELETE', row_url).status_code, 204)
        self.assertEqual(self.api('DELETE', stakeholder_url).status_code, 204)
        self.assertEqual(self.api('GET', stakeholder_url).status_code, 404)

    def test_companyless_private_and_archived_rules_and_contextual_owner(self):
        stranger = new_test_user(self.env, login='governance_stranger', groups='liwan_core.group_employee')
        owner = new_test_user(self.env, login='governance_owner', groups='liwan_core.group_employee')
        self.project.write({'user_id': owner.id})
        self.assertTrue(self.project.with_user(owner)._liwan_can_manage())
        self.assertFalse(self.companyless_project.with_user(owner)._liwan_can_manage())
        stakeholder = self.env['liwan.project.stakeholder'].with_user(owner).create({'project_id': self.project.id, 'name': 'Owner stakeholder'})
        row = self.env['liwan.project.raci'].with_user(owner).create({'project_id': self.project.id, 'task_id': self.task_overdue.id, 'stakeholder_id': stakeholder.id, 'role': 'R'})
        item = self.env['liwan.project.register'].with_user(owner).create({'project_id': self.project.id, 'kind': 'issue', 'title': 'Owner issue'})
        for record in (stakeholder, row, item):
            self.assertIn(record.id, record.with_user(stranger).search([('id', '=', record.id)]).ids)
        self.project.write({'privacy_visibility': 'followers'})
        self.task_overdue.write({'user_ids': [(5, 0, 0)]})
        self.assertFalse(self.project.with_user(stranger).has_access('read'))
        self.assertFalse(self.env['project.project'].with_user(stranger).search([('id', '=', self.project.id)]))
        for record in (stakeholder, row, item):
            reader = record.with_user(stranger)
            self.assertFalse(reader.search([('id', '=', record.id)]))
            self.assertFalse(reader.has_access('read'))
            with self.assertRaises(AccessError):
                reader.read(['project_id'])
            with self.assertRaises(AccessError):
                reader.unlink()
        self.project.write({'privacy_visibility': 'employees', 'active': False})
        for record in (stakeholder, row, item):
            self.assertFalse(record.with_user(owner).search([('id', '=', record.id)]))
            with self.assertRaises(AccessError):
                record.with_user(owner).unlink()
        self.project.write({'active': True})
        row.with_user(owner).unlink()
        item.with_user(owner).unlink()
        stakeholder.with_user(owner).unlink()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        hidden = self.env['project.project'].create({'name': 'Hidden company-less', 'company_id': False})
        for resource in ('stakeholders', 'raci', 'register'):
            denied = self.api('GET', f'/api/v1/projects/{hidden.id}/{resource}')
            self.assertEqual(denied.status_code, 403)
            self.assertEqual(denied.json()['code'], 'forbidden')

    def test_all_models_reject_foreign_company_and_mismatched_parents(self):
        other_company = self.env['res.company'].create({'name': 'Foreign governance company'})
        other = self.env['project.project'].create({'name': 'Foreign governance project', 'company_id': other_company.id})
        another = self.env['project.project'].create({'name': 'Another readable project', 'company_id': self.env.company.id})
        task = self.env['project.task'].create({'name': 'Wrong task', 'project_id': another.id})
        stakeholder = self.env['liwan.project.stakeholder'].with_user(self.manager).create({'project_id': self.project.id, 'name': 'Sponsor'})
        defaults = [
            ('liwan.project.stakeholder', {'name': 'Foreign'}),
            ('liwan.project.raci', {'task_id': self.task_overdue.id, 'stakeholder_id': stakeholder.id, 'role': 'R'}),
            ('liwan.project.register', {'kind': 'issue', 'title': 'Foreign'}),
        ]
        for name, vals in defaults:
            model = self.env[name].with_user(self.manager)
            with self.assertRaises(AccessError):
                model.create(dict(vals, project_id=other.id))
            with self.assertRaises(AccessError):
                model.with_context(default_project_id=other.id).create(vals)
            record = model.create(dict(vals, project_id=self.project.id))
            with self.assertRaises(ValidationError):
                record.write({'project_id': another.id})
            with self.assertRaises(ValidationError):
                record.copy({'project_id': other.id, 'score': 1})
            if name != 'liwan.project.stakeholder':
                with self.assertRaises(ValidationError):
                    record.write({'task_id': task.id})
                with self.assertRaises(ValidationError):
                    model.with_context(default_task_id=task.id).create({key: value for key, value in dict(vals, project_id=self.project.id).items() if key != 'task_id'})
        self.authenticate('api_emp', 'api_emp_pass_123')
        for resource in ('stakeholders', 'raci', 'register'):
            self.assertEqual(self.api('POST', f'{self.governance_url}/{resource}', {}).status_code, 403)
            # Another company's project is not-found, never a 403 that marks it real.
            self.assertEqual(self.api('GET', f'/api/v1/projects/{other.id}/{resource}').status_code, 404)

    def test_sql_uniqueness_rejects_second_a_and_duplicate_pair(self):
        model = self.env['liwan.project.raci'].with_user(self.manager)
        stakeholders = self.env['liwan.project.stakeholder'].with_user(self.manager).create([{'project_id': self.project.id, 'name': name} for name in ('One', 'Two')])
        values = {'project_id': self.project.id, 'task_id': self.task_overdue.id, 'stakeholder_id': stakeholders[0].id, 'role': 'A'}
        row = model.create(values)
        self.env.flush_all()
        for vals in (dict(values, role='R'), dict(values, stakeholder_id=stakeholders[1].id)):
            with self.assertRaises(ValidationError), self.env.cr.savepoint():
                model.create(vals)
                self.env.flush_all()
        row.write({'role': 'R'})
        other = model.create(dict(values, stakeholder_id=stakeholders[1].id))
        self.assertEqual(other.role, 'A')

    def test_installed_sql_indexes_arbitrate_concurrent_assignments(self):
        # Clone the installed RACI table/index definitions, not their source text.
        # Independent connections cannot see HttpCase's uncommitted fixtures.
        # A disposable table exercises the actual installed unique indexes while
        # leaving the business tables and HttpCase transaction untouched.
        table = 'liwan_governance_race_' + uuid.uuid4().hex
        connection = sql_db.db_connect(self.env.cr.dbname)
        with connection.cursor() as cursor:
            cursor.execute(SQL('CREATE TABLE %s (LIKE liwan_project_raci INCLUDING ALL)', SQL.identifier(table)))
            cursor.commit()
        try:
            for roles, stakeholders in ((('A', 'A'), (101, 102)), (('R', 'I'), (101, 101))):
                barrier = threading.Barrier(2, timeout=5)

                def contend(index):
                    with connection.cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '5s'")
                        cursor.execute("SET LOCAL statement_timeout = '8s'")
                        barrier.wait()
                        try:
                            with mute_logger('odoo.sql_db'):
                                cursor.execute(SQL(
                                    'INSERT INTO %s (id, project_id, task_id, stakeholder_id, role, accountable_task_id) VALUES (%s, 100, 100, %s, %s, NULL)',
                                    SQL.identifier(table), index + 1, stakeholders[index], roles[index],
                                ))
                            cursor.commit()
                            return 'created'
                        except UniqueViolation:
                            cursor.rollback()
                            return 'duplicate'

                with ThreadPoolExecutor(max_workers=2) as executor:
                    outcomes = list(executor.map(contend, (0, 1)))
                self.assertCountEqual(outcomes, ['created', 'duplicate'])
                with connection.cursor() as cursor:
                    cursor.execute(SQL('SELECT count(*) FROM %s', SQL.identifier(table)))
                    self.assertEqual(cursor.fetchone()[0], 1)
                    cursor.execute(SQL('TRUNCATE TABLE %s', SQL.identifier(table)))
                    cursor.commit()
        finally:
            with connection.cursor() as cursor:
                cursor.execute(SQL('DROP TABLE %s', SQL.identifier(table)))
                cursor.commit()

    def test_optional_users_reject_inactive_portal_foreign_and_batch_defaults(self):
        portal = new_test_user(self.env, login='governance_portal_optional', groups='base.group_portal')
        inactive = new_test_user(self.env, login='governance_inactive', groups='liwan_core.group_employee')
        inactive.active = False
        company = self.env['res.company'].create({'name': 'Governance user other company'})
        foreign = new_test_user(self.env, login='governance_foreign', groups='liwan_core.group_employee', company_id=company.id, company_ids=[(6, 0, company.ids)])
        for model_name, field, vals in (
            ('liwan.project.stakeholder', 'user_id', {'name': 'Sponsor'}),
            ('liwan.project.register', 'owner_id', {'kind': 'issue', 'title': 'Blocker'}),
        ):
            model = self.env[model_name].with_user(self.manager)
            values = dict(vals, project_id=self.project.id)
            item = model.create(values)
            for user in (portal, inactive, foreign):
                with self.assertRaises(ValidationError):
                    model.create(dict(values, **{field: user.id}))
                with self.assertRaises(ValidationError):
                    model.with_context(**{'default_' + field: user.id}).create([values, values])
                with self.assertRaises(ValidationError):
                    item.write({field: user.id})
                with self.assertRaises(ValidationError):
                    item.copy({field: user.id})

    def test_lists_expose_records_after_default_cap(self):
        self.env['liwan.project.stakeholder'].with_user(self.manager).create([{'project_id': self.project.id, 'name': 'Sponsor %03d' % index} for index in range(201)])
        self.env['liwan.project.register'].with_user(self.manager).create([{'project_id': self.project.id, 'kind': 'issue', 'title': 'Issue %03d' % index} for index in range(201)])
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        for resource in ('stakeholders', 'register'):
            response = self.api('GET', f'{self.governance_url}/{resource}?offset=200&limit=50')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual((response.json()['total'], len(response.json()['items'])), (201, 1))

    def test_archived_task_hides_linked_governance_but_preserves_unlinked_items(self):
        stakeholder = self.env['liwan.project.stakeholder'].with_user(self.manager).create({'project_id': self.project.id, 'name': 'Archive scope'})
        row = self.env['liwan.project.raci'].with_user(self.manager).create({'project_id': self.project.id, 'task_id': self.task_overdue.id, 'stakeholder_id': stakeholder.id, 'role': 'R'})
        linked, unlinked = self.env['liwan.project.register'].with_user(self.manager).create([
            {'project_id': self.project.id, 'kind': 'issue', 'title': 'Linked', 'task_id': self.task_overdue.id},
            {'project_id': self.project.id, 'kind': 'issue', 'title': 'Unlinked'},
        ])
        cached = [record.with_user(self.employee) for record in (row, linked)]
        for reader in cached:
            self.assertEqual(reader.read(['id']), [{'id': reader.id}])
            self.assertTrue(reader.has_access('read'))
        self.task_overdue.write({'active': False})
        self.assertTrue(self.project.with_user(self.employee).has_access('read'))
        for reader in cached:
            domain = [('id', '=', reader.id)]
            self.assertEqual(reader.search_count(domain), 0)
            self.assertEqual(reader.search_read(domain, ['id']), [])
            self.assertFalse(reader.has_access('read'))
            with self.assertRaises(AccessError):
                reader.read(['id'])
        visible = unlinked.with_user(self.employee)
        self.assertTrue(visible.has_access('read'))
        self.assertEqual(visible.search_count([('id', '=', visible.id)]), 1)
        self.assertEqual(visible.read(['id']), [{'id': visible.id}])
        self.assertTrue(stakeholder.with_user(self.employee).has_access('read'))
