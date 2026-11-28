# Part of Odoo. See LICENSE file for copyright and licensing details.
"""The recording settings page (design 4.4, 8): what a read answers before and after a save, who may save, what a
write refuses, and the one push the agent receives once the write is committed.

The policy is the database's: one record every company reads, changed only by a manager of the root company.
"""
import importlib.util
import json
import urllib.error
from pathlib import Path

from odoo import SUPERUSER_ID, api
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from .common import (
    AGENT_KEY,
    AGENT_URL,
    MANAGER_PASSWORD,
    PHONE_USER_PASSWORD,
    LiwanTelephonyCase,
    set_feature,
)
from .test_telephony_calls import assert_refused
from odoo.addons.liwan_telephony.models.agent_client import (
    DATABASE_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    _liwan_sign_reverse,
)
from odoo.addons.liwan_telephony.models.feature_registry import EVENTS_FEATURE

SETTINGS = '/api/v1/telephony/settings'
SWITCH_COMPANY = '/api/v1/me/company'
SETTINGS_LOGGER = 'odoo.addons.liwan_telephony.models.telephony_settings'
BRANCH_PHONE_USER = 'telephony_branch_phone_user'
BRANCH_MANAGER = 'telephony_branch_manager'
ROOT_GRANTED_BRANCH_MANAGER = 'telephony_root_granted_branch_manager'
BRANCH_PASSWORD = 'telephony_branch_pass_123'
DEFAULTS = {'recordingPolicy': 'off', 'recordingAnnouncement': True, 'recordingRetentionDays': 90}
SAVED = {'recordingPolicy': 'always', 'recordingAnnouncement': False, 'recordingRetentionDays': 30}
SAVED_MODEL = {'recording_policy': 'always', 'recording_announcement': False, 'recording_retention_days': 30}
BRANCH_VALUES = {'recordingPolicy': 'off', 'recordingAnnouncement': True, 'recordingRetentionDays': 3650}
MIGRATIONS = Path(__file__).parents[1] / 'migrations' / '19.0.1.2.0'
# The version whose settings were one row per company, and whose recording state still offered ``pending``.
PER_COMPANY_VERSION = '19.0.1.1.0'


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonySettings(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, EVENTS_FEATURE)
        self.sign_in(self.manager, MANAGER_PASSWORD)

    def sign_in_branch_user(self, login, role_xmlid):
        """A user whose only company is a branch of the database, holding ``role_xmlid`` there, signed in."""
        branch = self.env['res.company'].create({'name': f'Telephony settings branch of {login}'})
        user = new_test_user(
            self.env, login=login, password=BRANCH_PASSWORD, name=login, groups='liwan_core.group_employee',
            company_id=branch.id, company_ids=[Command.set([branch.id])],
        )
        self.env['liwan.access.assignment'].sudo().create({
            'user_id': user.id,
            'role_id': self.env.ref(role_xmlid).id,
            'company_id': branch.id,
        })
        self.authenticate(login, BRANCH_PASSWORD)
        return user, branch

    def saved_row(self):
        return self.env['liwan.telephony.settings']._liwan_current()

    def assert_saved_values(self, expected):
        row = self.saved_row()
        self.assertEqual(
            (row.recording_policy, row.recording_announcement, row.recording_retention_days),
            (expected['recordingPolicy'], expected['recordingAnnouncement'], expected['recordingRetentionDays']),
        )

    def test_the_database_has_one_settings_row_at_the_declared_defaults(self):
        """A fresh database answers the declared defaults from its one installed record, never a 404."""
        self.assertEqual(self.api('GET', SETTINGS).json(), DEFAULTS)
        self.assertEqual(self.env['liwan.telephony.settings'].search([]), self.saved_row())
        self.assert_saved_values(DEFAULTS)

    def test_a_save_persists_and_answers_the_new_values(self):
        saved = self.api('PATCH', SETTINGS, json=SAVED)
        self.assertEqual((saved.status_code, saved.json()), (200, SAVED))
        self.assertEqual(self.api('GET', SETTINGS).json(), SAVED)
        self.assert_saved_values(SAVED)
        # An omitted key keeps its saved value: the page only sends what it changed.
        partial = self.api('PATCH', SETTINGS, json={'recordingRetentionDays': 7})
        self.assertEqual((partial.status_code, partial.json()), (200, {**SAVED, 'recordingRetentionDays': 7}))
        self.assert_saved_values({**SAVED, 'recordingRetentionDays': 7})

    def test_only_a_manager_saves_the_settings(self):
        self.sign_in(self.phone_user, PHONE_USER_PASSWORD)
        self.assertEqual(self.api('GET', SETTINGS).json(), DEFAULTS)
        assert_refused(self, self.api('PATCH', SETTINGS, json=SAVED), 403, 'forbidden')
        self.assert_saved_values(DEFAULTS)

    def test_an_unknown_key_a_bad_enum_and_a_bad_value_answer_422(self):
        for payload, field in (
            ({'policy': 'always'}, 'policy'),
            ({'recordingPolicy': 'sometimes'}, 'recordingPolicy'),
            ({'recordingPolicy': None}, 'recordingPolicy'),
            ({'recordingPolicy': True}, 'recordingPolicy'),
            ({'recordingAnnouncement': 'yes'}, 'recordingAnnouncement'),
            ({'recordingAnnouncement': 1}, 'recordingAnnouncement'),
            ({'recordingRetentionDays': 0}, 'recordingRetentionDays'),
            ({'recordingRetentionDays': 3651}, 'recordingRetentionDays'),
            ({'recordingRetentionDays': '30'}, 'recordingRetentionDays'),
            ({'recordingRetentionDays': True}, 'recordingRetentionDays'),
        ):
            assert_refused(self, self.api('PATCH', SETTINGS, json=payload), 422, 'invalid', field)
        self.assert_saved_values(DEFAULTS)

    def test_a_root_company_manager_saves_for_every_company_of_the_database(self):
        """The one policy binds the database: a user of another company reads the root manager's saved values."""
        self.assertEqual(self.api('PATCH', SETTINGS, json=SAVED).status_code, 200)
        self.sign_in_branch_user(BRANCH_PHONE_USER, 'liwan_core.role_employee')
        self.assertEqual(self.api('GET', SETTINGS).json(), SAVED)
        self.assertEqual(self.env['liwan.telephony.settings'].search_count([]), 1)
        self.assert_saved_values(SAVED)

    def test_a_manager_of_a_non_root_company_cannot_change_the_policy(self):
        """A branch manager holds ``telephony.manage`` in the branch and reads the policy, but the write is refused:
        the effect is one pbx row for the whole database, so only the root company's managers change it."""
        self.assertEqual(self.api('PATCH', SETTINGS, json=SAVED).status_code, 200)
        self.sign_in_branch_user(BRANCH_MANAGER, 'liwan_telephony.role_telephony_manager')
        self.assertEqual(self.api('GET', SETTINGS).json(), SAVED)
        assert_refused(self, self.api('PATCH', SETTINGS, json=BRANCH_VALUES), 403, 'forbidden')
        self.assert_saved_values(SAVED)

    def test_a_branch_manager_with_the_root_membership_alone_cannot_save_at_the_root(self):
        """``telephony.manage`` held in a branch is not the database manager's capability.

        The gate accepts a capability held in any company of the current company's branch scope, so a user whose only
        grant is in a branch, and whose memberships include the root, could switch the current company to the root and
        write the tenant-wide policy. The write needs the capability in the root company itself.
        """
        self.assertEqual(self.api('PATCH', SETTINGS, json=SAVED).status_code, 200)
        root = self.env.company
        branch = self.env['res.company'].create({'name': 'Telephony policy branch', 'parent_id': root.id})
        user = new_test_user(
            self.env, login=ROOT_GRANTED_BRANCH_MANAGER, password=BRANCH_PASSWORD,
            name='Branch Manager At Root', groups='liwan_core.group_employee',
            company_id=branch.id, company_ids=[Command.set([branch.id, root.id])],
        )
        self.env['liwan.access.assignment'].sudo().create({
            'user_id': user.id,
            'role_id': self.env.ref('liwan_telephony.role_telephony_manager').id,
            'company_id': branch.id,
        })
        self.authenticate(ROOT_GRANTED_BRANCH_MANAGER, BRANCH_PASSWORD)
        switched = self.api('POST', SWITCH_COMPANY, json={'company_id': root.id})
        self.assertEqual(switched.status_code, 200, switched.text)
        assert_refused(self, self.api('PATCH', SETTINGS, json=BRANCH_VALUES), 403, 'forbidden')
        self.assert_saved_values(SAVED)

    def test_a_missing_settings_record_answers_404(self):
        """A database whose installed record is gone answers a structured 404, not a 500 with a traceback."""
        self.patch(
            type(self.env['liwan.telephony.settings']), '_liwan_current', lambda model: model.browse(),
        )
        refused = self.api('GET', SETTINGS)
        self.assertEqual((refused.status_code, refused.json()['code']), (404, 'not_found'))

    def test_a_save_queues_one_push_that_leaves_after_the_commit(self):
        """Under ``HttpCase`` a request's test cursor drops post-commit hooks, so the route is shown to queue the push
        and the queue itself is run here: nothing reaches the agent inside the transaction, exactly one push after."""
        self.set_agent()
        sent = []

        def record(method, url, payload, headers):
            sent.append((method, url, payload, headers))
            return {'ok': True}

        self.patch_agent(record)
        saved = self.api('PATCH', SETTINGS, json=SAVED)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(sent, [])
        self.saved_row()._liwan_queue_agent_push()
        self.assertEqual(sent, [])
        self.env.cr.postcommit.run()
        self.assertEqual(len(sent), 1)
        method, url, payload, headers = sent[0]
        self.assertEqual((method, url), ('PUT', f'{AGENT_URL}/recording/config'))
        self.assertEqual(json.loads(payload), {'database': self.env.cr.dbname, 'policy': 'always', 'announce': False})
        self.assertEqual(headers[DATABASE_HEADER], self.env.cr.dbname)
        self.assertEqual(
            headers[SIGNATURE_HEADER],
            _liwan_sign_reverse(AGENT_KEY, headers[TIMESTAMP_HEADER], 'PUT', '/recording/config', payload),
        )

    def test_a_rolled_back_save_never_reaches_the_agent(self):
        """The push is a post-commit hook: a transaction that rolls back carries neither the write nor the request."""
        self.set_agent()
        sent = []
        self.patch_agent(lambda method, url, payload, headers: sent.append((method, url, payload)) or {'ok': True})
        cursor = self.registry.cursor()
        try:
            env = api.Environment(cursor, SUPERUSER_ID, {'allowed_company_ids': [self.env.company.id]})
            settings = env['liwan.telephony.settings']._liwan_current()
            settings.write(SAVED_MODEL)
            settings._liwan_queue_agent_push()
            self.assertEqual(sent, [])
            cursor.rollback()
        finally:
            cursor.close()
        self.env.cr.postcommit.run()
        self.assertEqual(sent, [])
        self.env.invalidate_all()
        self.assert_saved_values(DEFAULTS)

    def test_a_failed_push_is_a_warning_naming_the_database_and_keeps_the_write(self):
        self.set_agent()

        def fail(method, url, payload, headers):
            reason = 'agent down'
            raise urllib.error.URLError(reason)

        self.patch_agent(fail)
        settings = self.saved_row()
        settings.write(SAVED_MODEL)
        settings._liwan_queue_agent_push()
        with self.assertLogs(SETTINGS_LOGGER, level='WARNING') as logs:
            self.env.cr.postcommit.run()
        self.assertIn(self.env.cr.dbname, logs.output[0])
        # The row is the record of the manager's choice; the agent keeps the previous policy until the next save.
        self.assert_saved_values(SAVED)
        sent = []
        self.patch_agent(lambda method, url, payload, headers: sent.append(json.loads(payload)) or {'ok': True})
        settings._liwan_queue_agent_push()
        self.env.cr.postcommit.run()
        self.assertEqual(sent, [{'database': self.env.cr.dbname, 'policy': 'always', 'announce': False}])


def load_migration(name):
    """The migration script ``name`` of this version, as a module with its ``migrate(cr, version)``."""
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), MIGRATIONS / f'{name}.py')
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonySettingsMigration(TransactionCase):
    """The 19.0.1.2.0 migration: the per-company rows and the column behind them are gone, one record is left."""

    def setUp(self):
        super().setUp()
        self.pre = load_migration('pre-drop-settings-company')
        self.post = load_migration('post-single-settings-row')
        self.settings = self.env['liwan.telephony.settings']

    def has_company_column(self):
        self.env.cr.execute(
            """SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'liwan_telephony_settings'
                 AND column_name = 'company_id'""",
        )
        return bool(self.env.cr.fetchone())

    def per_company_row(self, retention_days):
        """One row of the old shape: a settings row of a company, written under the NOT NULL ``company_id``."""
        if not self.has_company_column():
            self.env.cr.execute('ALTER TABLE liwan_telephony_settings ADD COLUMN company_id integer')
        self.env.cr.execute(
            """INSERT INTO liwan_telephony_settings
                   (company_id, recording_policy, recording_announcement, recording_retention_days)
               VALUES (%s, %s, %s, %s)""",
            [self.env.company.id, 'always', False, retention_days],
        )

    def test_the_old_per_company_rows_leave_one_installed_record(self):
        self.env.flush_all()
        self.per_company_row(30)
        self.per_company_row(3650)
        self.pre.migrate(self.env.cr, PER_COMPANY_VERSION)
        self.post.migrate(self.env.cr, PER_COMPANY_VERSION)
        self.assertFalse(self.has_company_column())
        installed = self.env.ref('liwan_telephony.telephony_settings')
        self.assertEqual(self.settings.search([]), installed)
        # The leftover rows never were a tenant policy: the one record keeps the declared defaults.
        self.assertEqual(
            (installed.recording_policy, installed.recording_announcement, installed.recording_retention_days),
            ('off', True, 90),
        )

    def test_a_fresh_install_migrates_nothing(self):
        self.env.flush_all()
        self.per_company_row(30)
        self.pre.migrate(self.env.cr, False)
        self.post.migrate(self.env.cr, False)
        self.assertTrue(self.has_company_column())
        self.assertEqual(self.settings.search_count([]), 2)

    def test_a_recording_state_the_selection_dropped_becomes_none(self):
        """A database that stored the removed ``pending`` value would raise ``KeyError`` in the ladder on the next
        event and be refused by the contract enum: the migration states the same thing ``none`` does."""
        self.env.flush_all()
        call = self.env['liwan.telephony.call'].create({
            'linkedid': '1764300000.1', 'direction': 'in', 'state': 'ringing',
        })
        self.env.cr.execute("UPDATE liwan_telephony_call SET recording_state = 'pending' WHERE id = %s", [call.id])
        migration = load_migration('post-reset-pending-recording-state')
        migration.migrate(self.env.cr, False)
        self.assertEqual(self.stored_recording_state(call), 'pending')
        migration.migrate(self.env.cr, PER_COMPANY_VERSION)
        self.assertEqual(self.stored_recording_state(call), 'none')

    def stored_recording_state(self, call):
        """The column itself: the ORM cannot name a value outside the field's selection."""
        self.env.cr.execute('SELECT recording_state FROM liwan_telephony_call WHERE id = %s', [call.id])
        return self.env.cr.fetchone()[0]
