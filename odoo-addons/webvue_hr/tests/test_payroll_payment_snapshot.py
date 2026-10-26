# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import hashlib
import importlib.util
from datetime import date
from unittest.mock import patch

from odoo.exceptions import AccessError, ConcurrencyError
from odoo.tests import tagged
from odoo.tools import mute_logger
from odoo.tools.misc import file_path
from odoo.tools.sql import get_foreign_keys

from .payroll_common import PayrollCase
from odoo.addons.webvue_hr.models.payroll_file import PROFILE_FK

RUNS = '/api/v1/hr/payroll/runs'
PROFILES = '/api/v1/hr/payroll/bank-profiles'
MONTH = '2026-11'
IBAN = 'SA0380000000608010167519'
NEW_IBAN = 'SA4420000001234567891234'
OLD_IBAN = 'SA0380000000608010167518'
IDENTIFICATION = '1012345678'
NEW_IDENTIFICATION = '1098765432'
SNAPSHOT_FIELDS = ('webvue_iban', 'webvue_bank_code', 'webvue_identification')
MIGRATION = 'webvue_hr/migrations/19.0.1.12.0/post-payment_snapshot.py'


def _load_migration():
    spec = importlib.util.spec_from_file_location('webvue_hr_post_payment_snapshot', file_path(MIGRATION))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollPaymentSnapshot(PayrollCase):
    """Owner decisions D-4 (أ) and D-10 (أ): the payment data is fixed at approval and every salary file is kept."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        base = ['hr.payroll.read', 'hr.employees.read']
        cls.officer = cls.payroll_user(cls, 'snap_officer', [*base, 'hr.payroll.manage'])
        # The approve capability depends on the read capabilities; no manage capability.
        cls.approver = cls.payroll_user(cls, 'snap_approver', [*base, 'hr.payroll.approve'])
        cls.reader = cls.payroll_user(cls, 'snap_reader', base)
        cls.own = cls.payroll_user(cls, 'snap_own', ['hr.employees.read'])
        cls.config = cls.payroll_user(cls, 'snap_config', [*base, 'hr.payroll.config'])
        cls.bank = cls.env['res.bank'].create({'name': 'Snapshot Bank', 'bic': 'RJHISARI'})
        cls.new_bank = cls.env['res.bank'].create({'name': 'Other Bank', 'bic': 'NCBKSAJE'})
        cls.worker = cls.make_employee(cls, 'Snap Worker', user=cls.own)
        cls.worker.version_id.identification_id = IDENTIFICATION
        cls.compensation = cls.set_compensation(
            cls, cls.worker, 10000, 2500, 1000, iban=IBAN, gosi_registration_date=date(2020, 1, 1),
        )
        cls.compensation.bank_id = cls.bank
        cls.profile = cls.env['webvue.hr.payroll.bank.profile'].create({
            'name': 'Snapshot layout', 'kind': 'bank', 'company_id': cls.env.company.id,
            'column_ids': [(0, 0, {'sequence': sequence, 'source': source, 'label': source}) for sequence, source in (
                (1, 'identification'), (2, 'iban'), (3, 'bank_code'), (4, 'net'), (5, 'value_date'),
            )],
        })
        cls.wps = cls.env.ref('webvue_hr.profile_mudad_wps')
        cls.File = cls.env['webvue.hr.payroll.file']
        cls.Event = cls.env['webvue.hr.audit.event']

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _computed_run(self, deduction_of=None):
        self._login(self.officer)
        res = self.api('POST', RUNS, json={'month': MONTH})
        self.assertEqual(res.status_code, 201, res.text)
        run = self.env['hr.payslip.run'].browse(res.json()['id'])
        if deduction_of:
            slip = run.slip_ids.filtered(lambda row: row.employee_id == deduction_of)
            run._webvue_set_inputs(slip, {'WV_DEDUCTION': 5000})
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/compute').status_code, 200)
        return run

    def _approve(self, run):
        self._login(self.approver)
        return self.api('POST', f'{RUNS}/{run.id}/approve')

    def _approved_run(self):
        run = self._computed_run()
        res = self._approve(run)
        self.assertEqual(res.status_code, 200, res.text)
        return run

    def _download(self, run, route, query=''):
        self._login(self.officer)
        res = self.api('GET', f'{RUNS}/{run.id}/{route}{query}')
        self.assertEqual(res.status_code, 200, res.text)
        return res.content

    def _bank_file(self, run, value_date='2026-12-01'):
        return self._download(run, 'bank-file', f'?profile_id={self.profile.id}&value_date={value_date}')

    def _slip(self, run, employee=None):
        return run.slip_ids.filtered(lambda slip: slip.employee_id == (employee or self.worker))

    def _row(self, run, employee):
        """The payslip row of ``employee`` as the logged-in payroll reader sees it."""
        rows = self.api('GET', f'{RUNS}/{run.id}/payslips').json()['items']
        return next(row for row in rows if row['employee']['id'] == employee.id)

    # --- D-10: no approval with a net to pay and no IBAN -----------------------------------------

    def test_approval_is_blocked_by_a_positive_net_without_an_iban(self):
        no_iban = self.make_employee('Snap No Iban')
        self.set_compensation(no_iban, 4000, gosi_registration_date=date(2020, 1, 1))
        run = self._computed_run()
        res = self._approve(run)
        self.assertEqual(res.status_code, 422, res.text)
        body = res.json()
        self.assertEqual((body['code'], body['field'], body['details']), ('missing_iban', 'iban', {'employee_ids': [no_iban.id]}))
        self.assertEqual(run.webvue_state, 'computed')
        self.assertFalse(self._slip(run).webvue_iban)
        # The warning still tells the officer before the approval.
        self._login(self.officer)
        warnings = self.api('GET', f'{RUNS}/{run.id}').json()['warnings']
        self.assertIn({'code': 'missing_iban', 'employee': {'id': no_iban.id, 'name': no_iban.name}}, warnings)

    def test_a_zero_net_without_an_iban_does_not_block(self):
        zero = self.make_employee('Snap Zero Net', country='EG')
        self.set_compensation(zero, 5000)
        run = self._computed_run(deduction_of=zero)
        self.assertEqual(run.slip_ids._webvue_amounts()[self._slip(run, zero).id]['net'], 0)
        res = self._approve(run)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertNotIn('missing_iban', [warning['code'] for warning in res.json()['warnings']])
        self.assertFalse(self._slip(run, zero).webvue_iban)

    # --- D-4: the snapshot ------------------------------------------------------------------------

    def test_an_approver_without_manage_approves_and_the_snapshot_is_filled(self):
        access = self.env['webvue.access.service']
        self.assertFalse(access._webvue_has_capability(self.approver, 'hr.payroll.manage'))
        run = self._approved_run()
        self.assertEqual(run.webvue_state, 'approved')
        slip = self._slip(run)
        self.assertEqual(
            (slip.webvue_iban, slip.webvue_bank_code, slip.webvue_identification), (IBAN, 'RJHISARI', IDENTIFICATION),
        )

    def test_salary_files_keep_the_approved_payment_data(self):
        run = self._approved_run()
        bank_before = self._bank_file(run)
        wps_before = self._download(run, 'wps-file', f'?profile_id={self.wps.id}')
        self.assertIn(IBAN, bank_before.decode())
        self.assertIn(IDENTIFICATION, bank_before.decode())
        self.assertIn('RJHISARI', bank_before.decode())
        self.compensation.write({'iban': NEW_IBAN, 'bank_id': self.new_bank.id})
        self.worker.version_id.identification_id = NEW_IDENTIFICATION
        self.assertEqual(self._bank_file(run), bank_before)
        self.assertEqual(self._download(run, 'wps-file', f'?profile_id={self.wps.id}'), wps_before)
        self.assertEqual(self.File.search_count([('run_id', '=', run.id)]), 2)

    def test_clearing_the_live_iban_leaves_an_approved_run_and_its_files_alone(self):
        """The snapshot is the only IBAN of a fixed run: clearing the live one warns nobody and blocks nothing."""
        run = self._approved_run()
        self.compensation.write({'iban': False})
        self._login(self.officer)
        detail = self.api('GET', f'{RUNS}/{run.id}').json()
        self.assertNotIn('missing_iban', [warning['code'] for warning in detail['warnings']])
        self.assertFalse(self._row(run, self.worker)['iban_missing'])
        self.assertIn(IBAN, self._bank_file(run).decode())

    def test_an_approved_run_with_an_empty_snapshot_warns_and_refuses_its_file(self):
        """A run approved with no stored IBAN keeps asking for one even while the live compensation has it."""
        run = self._approved_run()
        self._slip(run).write(dict.fromkeys(SNAPSHOT_FIELDS, False))
        self._login(self.officer)
        warnings = self.api('GET', f'{RUNS}/{run.id}').json()['warnings']
        self.assertIn({'code': 'missing_iban', 'employee': {'id': self.worker.id, 'name': self.worker.name}}, warnings)
        self.assertTrue(self._row(run, self.worker)['iban_missing'])
        res = self.api('GET', f'{RUNS}/{run.id}/bank-file?profile_id={self.profile.id}&value_date=2026-12-01')
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'missing_iban')
        self.assertEqual(res.json()['details'], {'employee_ids': [self.worker.id]})

    def test_the_snapshot_is_payroll_data_only(self):
        run = self._approved_run()
        slip = self.env['hr.payslip'].with_user(self.own).browse(self._slip(run).id)
        self.assertEqual(slip.state, 'done')
        self.assertTrue(slip.webvue_paid_days)
        for name in SNAPSHOT_FIELDS:
            self.assertNotIn(name, slip.fields_get())
            with self.assertRaises(AccessError):
                slip.read([name])
        self._login(self.own)
        paths = [
            f'/api/v1/hr/employees/{self.worker.id}', '/api/v1/hr/employees', '/api/v1/hr/payroll/payslips/mine',
            f'/api/v1/hr/payroll/payslips/mine/{slip.id}',
        ]
        if self.env['ir.module.module'].search_count([('name', '=', 'webvue_directory'), ('state', '=', 'installed')]):
            paths.append('/api/v1/people?q=Snap')
        for path in paths:
            res = self.api('GET', path)
            self.assertEqual(res.status_code, 200, (path, res.text))
            for leaked in (IBAN, 'RJHISARI', IDENTIFICATION, *SNAPSHOT_FIELDS):
                self.assertNotIn(leaked, res.text, path)

    # --- D-4: the kept salary files ---------------------------------------------------------------

    def test_each_distinct_file_is_kept_once_and_every_download_is_logged(self):
        run = self._approved_run()
        first = self._bank_file(run)
        self.assertEqual(self._bank_file(run), first)
        kept = self.File.search([('run_id', '=', run.id)])
        self.assertEqual(len(kept), 1)
        self.assertEqual(
            (kept.company_id, kept.kind, kept.profile_id, kept.value_date, kept.filename, kept.create_uid),
            (run.company_id, 'bank', self.profile, date(2026, 12, 1), 'salaries-2026-11.csv', self.officer),
        )
        self.assertEqual(kept.checksum, hashlib.sha256(first).hexdigest())
        self.assertEqual(base64.b64decode(kept.with_user(self.officer).content), first)
        self._bank_file(run, '2026-12-02')
        self.assertEqual(self.File.search_count([('run_id', '=', run.id)]), 2)
        events = self.Event.search([('action', '=', 'payment_file_generated')])
        self.assertEqual(len(events), 3)
        self.assertEqual(set(events.mapped('res_model')), {'webvue.hr.payroll.file'})
        self.assertEqual(set(events.mapped('create_uid')), {self.officer})
        for event in events:
            self.assertEqual(set(event.change_ids.mapped('field_name')), {'filename', 'kind', 'value_date'})
            values = ' '.join(filter(None, event.change_ids.mapped('new_value') + event.change_ids.mapped('old_value')))
            for secret in (IBAN, IDENTIFICATION, 'RJHISARI', '12281.25'):
                self.assertNotIn(secret, values)

    def test_a_kept_file_cannot_be_written_outside_its_helper(self):
        run = self._approved_run()
        self._bank_file(run)
        kept = self.File.search([('run_id', '=', run.id)]).with_user(self.officer)
        File = self.File.with_user(self.officer)
        with self.assertRaises(AccessError):
            File.create({
                'company_id': run.company_id.id, 'run_id': run.id, 'kind': 'bank', 'profile_id': self.profile.id,
                'value_date': date(2026, 12, 1), 'filename': 'forged.csv', 'checksum': 'x', 'content': b'eA==',
            })
        with self.assertRaises(AccessError):
            kept.write({'filename': 'forged.csv'})
        with self.assertRaises(AccessError):
            kept.unlink()
        with self.assertRaises(AccessError):
            self.File.with_user(self.own)._webvue_keep(run, 'bank', self.profile, date(2026, 12, 1), 'x.csv', b'x')

    def test_a_payroll_reader_downloads_and_reads_the_bytes_without_write(self):
        """The read capability alone generates a file and reads the kept bytes back; it changes nothing."""
        run = self._approved_run()
        self._login(self.reader)
        res = self.api('GET', f'{RUNS}/{run.id}/bank-file?profile_id={self.profile.id}&value_date=2026-12-01')
        self.assertEqual(res.status_code, 200, res.text)
        kept = self.File.with_user(self.reader).search([('run_id', '=', run.id)])
        self.assertEqual(len(kept), 1)
        self.assertEqual(base64.b64decode(kept.content), res.content)
        self.assertEqual(self.Event.search([('action', '=', 'payment_file_generated')]).create_uid, self.reader)
        with self.assertRaises(AccessError):
            kept.write({'filename': 'forged.csv'})
        with self.assertRaises(AccessError):
            kept.unlink()

    def test_a_profile_deleted_before_the_file_is_kept_is_refused(self):
        """The profile is resolved, then deleted before the file is kept: the download is a 409, never a 500."""
        run = self._approved_run()
        spare = self._spare_profile('Snapshot raced')
        export = self.env['webvue.hr.payroll.export']
        original = type(export)._webvue_render

        def render_then_delete(records, profile, lines, value_date):
            content = original(records, profile, lines, value_date)
            profile.with_user(self.config).unlink()
            return content
        self.patch(type(export), '_webvue_render', render_then_delete)
        self._login(self.officer)
        res = self.api('GET', f'{RUNS}/{run.id}/bank-file?profile_id={spare.id}&value_date=2026-12-01')
        self.assertEqual(res.status_code, 409, res.text)
        self.assertEqual(res.json()['code'], 'profile_unavailable')
        # This test injects the deletion in the download's own transaction, not a second connection. The API
        # savepoint rolls that deletion back too; a separately committed concurrent deletion would stay deleted.
        # The genuine FK refusal still keeps no file or hand-out event, and the transaction remains usable.
        self.assertTrue(self.env['webvue.hr.payroll.bank.profile'].browse(spare.id).exists())
        self.assertEqual(self.File.search_count([('run_id', '=', run.id)]), 0)
        self.assertEqual(self.Event.search_count([('action', '=', 'payment_file_generated')]), 0)
        self.assertEqual(self.api('GET', PROFILES).status_code, 200)

    def test_the_kept_bytes_refuse_a_write_or_unlink_for_the_officer_and_the_reader(self):
        """The attachment of a kept file follows its row: neither the officer nor a plain reader may change it."""
        run = self._approved_run()
        self._bank_file(run)
        kept = self.File.search([('run_id', '=', run.id)])
        original = base64.b64decode(kept.with_user(self.officer).content)
        attachment = self.env['ir.attachment'].search([
            ('res_model', '=', 'webvue.hr.payroll.file'), ('res_field', '=', 'content'), ('res_id', '=', kept.id),
        ])
        self.assertEqual(len(attachment), 1)
        for user in (self.officer, self.reader):
            linked = attachment.with_user(user)
            with self.assertRaises(AccessError):
                linked.write({'datas': base64.b64encode(b'forged')})
            with self.assertRaises(AccessError):
                linked.unlink()
        # The refused write left no forged bytes: after the cache is dropped the reader reads the kept content.
        self.env.invalidate_all()
        self.assertEqual(base64.b64decode(kept.with_user(self.officer).content), original)
        self.assertEqual(base64.b64decode(kept.with_user(self.reader).read(['content'])[0]['content']), original)

    def test_a_reader_of_another_company_never_sees_a_kept_file(self):
        run = self._approved_run()
        self._bank_file(run)
        kept = self.File.search([('run_id', '=', run.id)])
        other = self.env['res.company'].create({'name': 'Snapshot Other Co'})
        foreign = self.payroll_user('snap_foreign', [])
        foreign.write({'company_ids': [(4, other.id)], 'company_id': other.id})
        self.env['webvue.access.assignment'].create({
            'user_id': foreign.id, 'role_id': self.env.ref('webvue_hr.role_payroll_manager').id,
            'company_id': other.id,
        })
        File = self.File.with_user(foreign).with_company(other)
        self.assertFalse(File.search([]))
        with self.assertRaises(AccessError):
            File.browse(kept.id).read(['filename', 'content'])
        # The bytes live in the attachment of the kept row: the same reader cannot reach it either.
        attachments = self.env['ir.attachment'].search([
            ('res_model', '=', 'webvue.hr.payroll.file'), ('res_field', '=', 'content'), ('res_id', '=', kept.id),
        ])
        self.assertEqual(len(attachments), 1)
        with self.assertRaises(AccessError):
            attachments.with_user(foreign).with_company(other).read(['datas'])
        with self.assertRaisesRegex(AccessError, 'payroll_file_company_out_of_scope'):
            File._webvue_keep(run, 'bank', self.profile, date(2026, 12, 1), 'x.csv', b'x')

    def test_a_concurrent_keep_of_the_same_content_is_retried(self):
        """The loser of a UNIQUE race raises a retryable ``ConcurrencyError``; the retry finds the winner's row."""
        run = self._approved_run()
        File = self.File.with_user(self.officer)
        kept = File._webvue_keep(run, 'bank', self.profile, date(2026, 12, 1), 'a.csv', b'same')
        original = type(self.File).search

        def miss(records, domain, *args, **kwargs):
            return records.browse() if ('checksum', '=', kept.checksum) in domain else original(records, domain, *args, **kwargs)
        with patch.object(type(self.File), 'search', miss), mute_logger('odoo.sql_db'), self.assertRaises(ConcurrencyError):
            File._webvue_keep(run, 'bank', self.profile, date(2026, 12, 1), 'a.csv', b'same')
        self.assertEqual(File._webvue_keep(run, 'bank', self.profile, date(2026, 12, 1), 'a.csv', b'same'), kept)

    # --- the profile a kept file names ------------------------------------------------------------

    def _spare_profile(self, name='Snapshot spare'):
        return self.env['webvue.hr.payroll.bank.profile'].create({
            'name': name, 'kind': 'bank', 'company_id': self.env.company.id,
            'column_ids': [(0, 0, {'source': 'iban', 'label': 'IBAN'})],
        })

    def test_the_translated_refusal_is_the_real_kept_file_profile_key(self):
        """The translated violation is read back from the database, never inferred from the naming rule."""
        self.assertEqual(
            get_foreign_keys(
                self.env.cr, 'webvue_hr_payroll_file', 'profile_id',
                'webvue_hr_payroll_bank_profile', 'id', 'restrict',
            ),
            [PROFILE_FK],
        )

    def test_a_profile_a_kept_file_names_is_refused_and_an_unused_one_is_not(self):
        run = self._approved_run()
        content = self._bank_file(run)
        kept = self.File.search([('run_id', '=', run.id)])
        self._login(self.config)
        refused = self.api('DELETE', f'{PROFILES}/{self.profile.id}', json={'revision': 1})
        self.assertEqual(refused.status_code, 409, refused.text)
        self.assertEqual(refused.json()['code'], 'profile_in_use')
        # The profile, the kept row and its bytes stay, and the refusal is not logged as a delete.
        profile = self.env['webvue.hr.payroll.bank.profile'].browse(self.profile.id)
        self.assertTrue(profile.exists())
        self.assertEqual(profile.revision, 1)
        self.assertEqual(self.File.search_count([('run_id', '=', run.id)]), 1)
        self.assertEqual(self.Event.search_count([('action', '=', 'bank_profile_deleted')]), 0)
        self.env.invalidate_all()
        self.assertEqual(base64.b64decode(kept.with_user(self.officer).content), content)
        # A profile no kept file names still deletes with its own revision.
        spare = self._spare_profile()
        deleted = self.api('DELETE', f'{PROFILES}/{spare.id}', json={'revision': 1})
        self.assertEqual(deleted.status_code, 204, deleted.text)
        self.assertFalse(spare.exists())

    def test_a_stale_revision_is_refused_before_the_profile_is_known_to_be_in_use(self):
        """The revision the client sent is checked first: a stale delete is a conflict, not an in-use refusal."""
        run = self._approved_run()
        self._bank_file(run)
        self._login(self.config)
        stale = self.api('DELETE', f'{PROFILES}/{self.profile.id}', json={'revision': 2})
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()['code'], 'conflict')
        self.assertTrue(self.env['webvue.hr.payroll.bank.profile'].browse(self.profile.id).exists())
        self.assertEqual(self.Event.search_count([('action', '=', 'bank_profile_deleted')]), 0)

    def test_a_file_kept_after_the_check_is_answered_by_the_database_key(self):
        """The file kept between the count and the delete gets the same refusal, never a 500."""
        run = self._approved_run()
        self._bank_file(run)
        File = type(self.File)
        original = File.search_count

        def miss(records, domain, *args, **kwargs):
            return 0 if ('profile_id', '=', self.profile.id) in domain else original(records, domain, *args, **kwargs)
        self.patch(File, 'search_count', miss)
        self._login(self.config)
        raced = self.api('DELETE', f'{PROFILES}/{self.profile.id}', json={'revision': 1})
        self.assertEqual(raced.status_code, 409, raced.text)
        self.assertEqual(raced.json()['code'], 'profile_in_use')
        self.assertTrue(self.env['webvue.hr.payroll.bank.profile'].browse(self.profile.id).exists())
        self.assertEqual(self.Event.search_count([('action', '=', 'bank_profile_deleted')]), 0)
        # The violation was rolled back to its own savepoint: the request's transaction still answers.
        self.assertEqual(self.api('GET', PROFILES).status_code, 200)

    # --- the 19.0.1.12.0 migration ----------------------------------------------------------------

    def test_the_migration_fills_only_empty_snapshots_and_is_idempotent(self):
        other = self.make_employee('Snap Other')
        self.set_compensation(other, 6000, iban=NEW_IBAN, gosi_registration_date=date(2020, 1, 1))
        run = self._approved_run()
        empty, kept = self._slip(run), self._slip(run, other)
        empty.write(dict.fromkeys(SNAPSHOT_FIELDS, False))
        kept.write({'webvue_iban': OLD_IBAN, 'webvue_bank_code': False, 'webvue_identification': False})
        self._login(self.officer)
        draft = self.env['hr.payslip.run'].browse(self.api('POST', RUNS, json={'month': '2026-12'}).json()['id'])
        migration = _load_migration()
        migration.migrate(self.env.cr, None)
        self.env.invalidate_all()
        self.assertFalse(empty.webvue_iban)
        for _attempt in range(2):
            migration.migrate(self.env.cr, '19.0.1.11.0')
            self.env.invalidate_all()
            self.assertEqual(
                (empty.webvue_iban, empty.webvue_bank_code, empty.webvue_identification),
                (IBAN, 'RJHISARI', IDENTIFICATION),
            )
            self.assertEqual((kept.webvue_iban, kept.webvue_bank_code), (OLD_IBAN, False))
            self.assertFalse(any(draft.slip_ids.mapped('webvue_iban')))

    def test_a_repeat_over_an_all_empty_source_leaves_the_snapshot_empty(self):
        """A zero net paid with no IBAN keeps an empty snapshot; a repeat over the same live data changes nothing."""
        zero = self.make_employee('Snap Zero Snapshot', country='EG')
        self.set_compensation(zero, 5000)
        run = self._computed_run(deduction_of=zero)
        self.assertEqual(self._approve(run).status_code, 200)
        empty = self._slip(run, zero)
        self.assertEqual((empty.webvue_iban, empty.webvue_bank_code, empty.webvue_identification), (False, False, False))
        migration = _load_migration()
        for _attempt in range(2):
            migration.migrate(self.env.cr, '19.0.1.11.0')
            self.env.invalidate_all()
            self.assertEqual(
                (empty.webvue_iban, empty.webvue_bank_code, empty.webvue_identification), (False, False, False),
            )
            self.assertEqual(self._slip(run).webvue_iban, IBAN)

    # --- the mutation routes expose no snapshot write ----------------------------------------------

    def test_no_payroll_mutation_route_accepts_a_snapshot_key(self):
        run = self._computed_run()
        slip = self._slip(run)
        self._login(self.officer)
        for name in SNAPSHOT_FIELDS:
            res = self.api('PATCH', f'{RUNS}/{run.id}/payslips/{slip.id}/inputs', json={name: IBAN})
            self.assertEqual(res.status_code, 422, (name, res.text))
            self.assertEqual((res.json()['code'], res.json()['field']), ('invalid', name))
        self.assertEqual((slip.webvue_iban, slip.webvue_bank_code, slip.webvue_identification), (False, False, False))

    def test_a_fixed_run_refuses_every_mutation_route(self):
        run = self._approved_run()
        slip = self._slip(run)
        snapshot = (slip.webvue_iban, slip.webvue_bank_code, slip.webvue_identification)
        self._login(self.officer)
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/compute').status_code, 403)
        self.assertEqual(self.api('DELETE', f'{RUNS}/{run.id}').status_code, 403)
        self.assertEqual(
            self.api('PATCH', f'{RUNS}/{run.id}/payslips/{slip.id}/inputs', json={'bonus_amount': 1}).status_code, 403,
        )
        self._login(self.approver)
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/approve').status_code, 403)
        self.assertEqual((slip.webvue_iban, slip.webvue_bank_code, slip.webvue_identification), snapshot)
