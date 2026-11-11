# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api
from odoo.tests import TransactionCase, new_test_user, tagged
from odoo.tools import mute_logger

from .test_read_only_excess import ExcessCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_platform.models.read_only_guard import (
    INBOUND_EVENT_CONTEXT,
    INBOUND_EVENT_TOKEN,
)


@tagged('post_install', '-at_install', 'liwan')
class TestReadOnlyUserGuard(ExcessCase):
    """The ORM fence: one rule under sudo, with_user, background code and the allow-list."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.readonly = new_test_user(cls.env, login='guard_readonly', groups='liwan_core.group_employee')
        cls.full = new_test_user(cls.env, login='guard_full', groups='liwan_core.group_employee')
        cls.attachment = cls.env['ir.attachment'].with_user(cls.readonly).create({
            'name': 'seed.txt', 'raw': b'x', 'mimetype': 'text/plain',
        })
        cls.service._liwan_apply_flags(cls.readonly, {'liwan_read_only': True})

    def _refused(self, action):
        with self.assertRaises(LiwanAccessRule) as caught:
            action()
        self.assertEqual((caught.exception.code, caught.exception.status), ('user_read_only', 403))

    def test_create_write_and_unlink_are_refused_for_the_read_only_identity(self):
        self._refused(lambda: self._write_as(self.readonly))
        self._refused(lambda: self.attachment.with_user(self.readonly).write({'name': 'x'}))
        self._refused(lambda: self.attachment.with_user(self.readonly).unlink())

    def test_sudo_keeps_the_identity_so_it_is_still_refused(self):
        self._refused(lambda: self.env['ir.attachment'].with_user(self.readonly).sudo().create({
            'name': 'sudo.txt', 'raw': b'x', 'mimetype': 'text/plain',
        }))

    def test_with_user_switches_the_identity_in_both_directions(self):
        records = self.env['ir.attachment'].with_user(self.full)
        self.assertTrue(records.create({'name': 'ok.txt', 'raw': b'x', 'mimetype': 'text/plain'}).exists())
        self._refused(lambda: records.with_user(self.readonly).create({
            'name': 'no.txt', 'raw': b'x', 'mimetype': 'text/plain',
        }))

    def test_a_scheduled_server_action_cannot_write_as_a_read_only_user(self):
        cron = self.env['ir.cron'].create({
            'name': 'Attachment scheduled action',
            'model_id': self.env.ref('base.model_ir_attachment').id,
            'state': 'code', 'user_id': self.readonly.id,
            'code': "model.create({'name': 'scheduled.txt', 'raw': b'scheduled'})",
        })
        action = cron.ir_actions_server_id
        self._refused(lambda: action.with_user(cron.user_id).sudo().run())
        action.sudo().run()
        self.assertTrue(self.env['ir.attachment'].search([('name', '=', 'scheduled.txt')]))

    def test_the_superuser_identity_is_never_fenced(self):
        """A cron of ``base.user_root``, the operator and installs run as the superuser identity."""
        root = self.env['ir.attachment'].with_user(SUPERUSER_ID)
        self.assertTrue(root.create({'name': 'cron.txt', 'raw': b'x', 'mimetype': 'text/plain'}).exists())
        self.readonly.with_user(SUPERUSER_ID).write({'lang': 'en_US'})

    def test_reads_exports_and_attachment_downloads_stay_open(self):
        attachments = self.env['ir.attachment'].with_user(self.readonly)
        attachments.search_count([])
        self.env['res.users'].with_user(self.readonly).browse(self.readonly.id).read(['name', 'login'])

    def test_the_allow_list_keeps_credentials_mobile_and_notification_state(self):
        self.access.with_user(self.readonly)._liwan_set_own_mobile('+966500000093')
        self.assertEqual(self.readonly.liwan_mobile, '+966500000093')
        own = self.env['res.users'].with_user(self.readonly).browse(self.readonly.id)
        own.write({'lang': 'en_US'})
        self.env['res.users.log'].with_user(self.readonly).sudo().create({})
        if 'mail.notification' in self.env:
            message = self.env['mail.message'].create({'body': 'ping', 'model': 'res.partner', 'res_id': self.readonly.partner_id.id})
            notification = self.env['mail.notification'].create({
                'mail_message_id': message.id, 'res_partner_id': self.readonly.partner_id.id,
                'notification_type': 'inbox',
            })
            notification.with_user(self.readonly).sudo().write({'is_read': True})
            self.assertTrue(notification.is_read)

    def test_the_allow_list_does_not_cover_other_users_or_other_fields(self):
        other = self.env['res.users'].with_user(self.readonly).sudo().browse(self.full.id)
        self._refused(lambda: other.write({'lang': 'en_US'}))
        own = self.env['res.users'].with_user(self.readonly).sudo().browse(self.readonly.id)
        self._refused(lambda: own.write({'name': 'renamed'}))

    def test_a_read_only_user_cannot_lift_their_own_flag(self):
        own = self.env['res.users'].with_user(self.readonly).sudo().browse(self.readonly.id)
        self._refused(lambda: own.write({'liwan_read_only': False}))
        self.assertTrue(self.readonly.liwan_read_only)

    def test_bus_notifications_and_the_font_size_preference_stay_writable(self):
        """`bus._sendone` queues as the acting user and `PATCH /me/appearance` writes the font size: both are the person's own."""
        self.env['bus.bus'].with_user(self.readonly)._sendone(self.readonly.partner_id, 'liwan_test', {'ok': True})
        own = self.env['res.users'].with_user(self.readonly).sudo().browse(self.readonly.id)
        own.write({'liwan_font_size': 'large'})
        self.assertEqual(self.readonly.liwan_font_size, 'large')

    def test_a_registered_allowance_covers_plumbing_models_and_seed_contexts_only(self):
        token = object()
        allowances = {'plumbing': frozenset({'res.partner.category'}), 'own': frozenset(), 'seed': {'liwan_test_seed': token}}
        self.patch(type(self.service), '_liwan_read_only_allowances', lambda model: allowances)
        categories = self.env['res.partner.category'].with_user(self.readonly).sudo()
        self.assertTrue(categories.create({'name': 'bookkeeping'}).exists())
        partners = self.env['res.partner'].with_user(self.readonly).sudo()
        self._refused(lambda: partners.create({'name': 'business'}))
        self.assertTrue(partners.with_context(liwan_test_seed=token).create({'name': 'seeded default'}).exists())
        self._refused(lambda: partners.with_context(liwan_test_seed=object()).create({'name': 'forged'}))


@tagged('post_install', '-at_install', 'liwan')
class TestReadOnlyBranches(ExcessCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='branch_employee', groups='liwan_core.group_employee')
        cls.manager = new_test_user(cls.env, login='branch_manager', groups='base.group_system')
        cls._set_limit(cls, 'branches.extra_limit', 3)

    def _apply(self, uids, op='op-1'):
        return self.record.sudo().with_context(**{OPERATOR_CONTEXT: True})._liwan_apply_branches(
            op, 'rev-1', [{'branch_id': uid, 'name': f'Branch {uid}'} for uid in uids],
        )

    def _branch(self, uid):
        return self.env['liwan.tenant.branch'].search([('branch_uid', '=', uid)])

    def test_branches_above_the_limit_turn_read_only_oldest_kept_and_reopen_on_purchase(self):
        self._apply(['b1', 'b2', 'b3'])
        self._set_limit('branches.extra_limit', 2)
        self.assertEqual(
            [self._branch(uid).read_only for uid in ('b1', 'b2', 'b3')], [False, False, True],
        )
        self.assertEqual(self.service._liwan_count_usage('branches.extra_limit'), 2)
        self.assertEqual(self.service._liwan_excess_counts()['branches.extra_limit'], 1)
        self.assertEqual(self._branch('b3').state, 'active')
        with self.assertRaises(LiwanAccessRule):
            self._apply(['b4'], 'op-2')
        self._set_limit('branches.extra_limit', 3)
        self.assertFalse(self._branch('b3').read_only)

    def test_a_customer_choice_survives_a_purchase_and_a_second_settle(self):
        self._apply(['b1', 'b2'])
        self.service._liwan_apply_flags(self._branch('b1'), {'read_only': True, 'seat_choice': 'customer'})
        self._set_limit('branches.extra_limit', 5)
        self.assertTrue(self._branch('b1').read_only)
        self.assertFalse(self.service._liwan_settle_excess())

    def test_records_of_a_read_only_branch_refuse_writes_but_headquarters_and_root_keep_working(self):
        company = self.env['res.company'].browse(self._apply(['b1'])[0]['odoo_company_id'])
        self.service._liwan_apply_flags(self._branch('b1'), {'read_only': True})
        partners = self.env['res.partner'].with_user(self.manager)
        with self.assertRaises(LiwanAccessRule) as caught:
            partners.create({'name': 'in branch', 'company_id': company.id})
        self.assertEqual((caught.exception.code, caught.exception.status), ('branch_read_only', 403))
        self.assertTrue(partners.create({
            'name': 'in headquarters', 'company_id': self.record.root_company_id.id,
        }).exists())
        # A write to the branch company itself and to a record of it is refused for every non-root identity.
        companies = self.env['res.company'].with_user(self.manager)
        with self.assertRaises(LiwanAccessRule) as caught:
            companies.browse(company.id).write({'name': 'renamed'})
        self.assertEqual(caught.exception.code, 'branch_read_only')
        companies.browse(self.record.root_company_id.id).write({'name': self.record.root_company_id.name})
        # The superuser identity (a cron of base.user_root, the operator) keeps writing there.
        self.env['res.partner'].create({'name': 'seeded', 'company_id': company.id})
        company.write({'name': 'renamed by the operator'})

    def test_archiving_a_branch_reopens_the_next_read_only_one(self):
        self._apply(['b1', 'b2', 'b3'])
        self._set_limit('branches.extra_limit', 2)
        self.assertTrue(self._branch('b3').read_only)
        self._branch('b1').write({'state': 'archived'})
        self.assertFalse(self._branch('b3').read_only)

    def test_identity_records_of_a_read_only_branch_stay_administrable(self):
        company = self.env['res.company'].browse(self._apply(['b1'])[0]['odoo_company_id'])
        self.service._liwan_apply_flags(self._branch('b1'), {'read_only': True})
        self.assertTrue(company.liwan_read_only)
        self.assertFalse(self.record.root_company_id.liwan_read_only)

    def test_set_branch_seat_needs_company_administration_and_respects_the_limit(self):
        company = self.env['res.company'].browse(self._apply(['b1', 'b2'])[0]['odoo_company_id'])
        with self.assertRaises(LiwanAccessRule) as caught:
            self.service.with_user(self.employee)._liwan_set_branch_seat(company.id, read_only=True)
        self.assertEqual(caught.exception.status, 403)
        self.patch(type(self.access), '_liwan_has_capability', lambda *args, **kwargs: True)
        self.service._liwan_set_branch_seat(company.id, read_only=True)
        self.assertTrue(self._branch('b1').read_only)
        self.assertEqual(self._branch('b1').seat_choice, 'customer')
        self._set_limit('branches.extra_limit', 1)
        self.service._liwan_set_branch_seat(self._branch('b2').company_id.id, read_only=False)
        with self.assertRaises(LiwanAccessRule):
            self.service._liwan_set_branch_seat(company.id, read_only=False)

    def test_attachments_messages_and_followers_hang_on_the_company_of_their_record(self):
        """Their own company column is the uploader's or empty: the record they hang on binds them."""
        company = self.env['res.company'].browse(self._apply(['b1'])[0]['odoo_company_id'])
        partner = self.env['res.partner'].create({'name': 'branch contact', 'company_id': company.id})
        headquarters = self.env['res.partner'].create({
            'name': 'hq contact', 'company_id': self.record.root_company_id.id,
        })
        self.service._liwan_apply_flags(self._branch('b1'), {'read_only': True})
        attachments = self.env['ir.attachment'].with_user(self.manager).sudo()
        values = {'name': 'a.txt', 'raw': b'x', 'mimetype': 'text/plain', 'res_model': 'res.partner'}
        actions = [lambda: attachments.create({**values, 'res_id': partner.id})]
        if 'mail.message' in self.env:
            actions.extend([
                lambda: partner.with_user(self.manager).sudo().message_post(body='hello'),
                lambda: partner.with_user(self.manager).sudo().message_subscribe(partner_ids=self.manager.partner_id.ids),
            ])
        for action in actions:
            with self.assertRaises(LiwanAccessRule) as caught:
                action()
            self.assertEqual(caught.exception.code, 'branch_read_only')
        self.assertTrue(attachments.create({**values, 'res_id': headquarters.id}).exists())
        if 'mail.message' in self.env:
            self.assertTrue(headquarters.with_user(self.manager).sudo().message_post(body='hello').exists())

    def test_an_attachment_remains_outside_a_read_only_branch_when_relinked(self):
        company = self.env['res.company'].browse(self._apply(['b1'])[0]['odoo_company_id'])
        contacts = self.env['res.partner']
        hq = contacts.create({'name': 'HQ parent', 'company_id': self.record.root_company_id.id})
        branch = contacts.create({'name': 'Branch parent', 'company_id': company.id})
        attachment = self.env['ir.attachment'].create({
            'name': 'parent.txt', 'raw': b'x', 'res_model': 'res.partner', 'res_id': hq.id,
            'company_id': self.record.root_company_id.id,
        })
        self.service._liwan_apply_flags(self._branch('b1'), {'read_only': True})
        with self.assertRaises(LiwanAccessRule) as caught:
            attachment.with_user(self.manager).sudo().write({'res_id': branch.id})
        self.assertEqual(caught.exception.code, 'branch_read_only')
        self.assertEqual(attachment.res_id, hq.id)

    def test_an_inbound_event_is_recorded_in_a_read_only_branch_for_its_own_request_only(self):
        company = self.env['res.company'].browse(self._apply(['b1'])[0]['odoo_company_id'])
        self.service._liwan_apply_flags(self._branch('b1'), {'read_only': True})
        partners = self.env['res.partner'].with_user(self.manager).sudo()
        recorded = partners.with_context(**{INBOUND_EVENT_CONTEXT: INBOUND_EVENT_TOKEN}).create({
            'name': 'inbound', 'company_id': company.id,
        })
        self.assertTrue(recorded.exists())
        for forged in ('1', True, object()):
            with self.assertRaises(LiwanAccessRule):
                partners.with_context(**{INBOUND_EVENT_CONTEXT: forged}).create({'name': 'forged', 'company_id': company.id})


@tagged('post_install', '-at_install', 'liwan', 'liwan_seat_concurrency')
class TestSeatToggleConcurrency(TransactionCase):
    """Two administrators claiming the last free seat: one wins, the limit holds."""

    def _fixture(self):
        if not self.env.cr.dbname.startswith('liwan_scratch_'):
            self.fail('Committed concurrency fixtures require a liwan_scratch_ database.')
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
            profile = env['liwan.entitlement.service']._liwan_profile()
            profile._liwan_initialize_legacy_policy(env['liwan.feature.registry']._liwan_installed_module_ids())
            service = env['liwan.entitlement.service']
            base = service._liwan_count_users()
            users = env['res.users'].browse()
            profile.write({'features': {**profile.features, 'users.limit': base + 2}})
            for index in range(2):
                users |= new_test_user(env, login=f'seat_race_{index}', groups='liwan_core.group_employee')
            profile.write({'features': {**profile.features, 'users.limit': base + 1}})
            self.assertEqual([user.liwan_read_only for user in users], [False, True])
            service._liwan_apply_flags(users, {'liwan_read_only': True})
            profile.write({'features': {**profile.features, 'users.limit': base + 1}})
            result = users.ids, base
            cursor.commit()
            return result

    def _cleanup(self, user_ids, base):
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
            users = env['res.users'].with_context(active_test=False).browse(user_ids)
            partners = users.partner_id
            users.unlink()
            partners.unlink()
            profile = env['liwan.entitlement.service']._liwan_profile()
            profile.write({'features': {**profile.features, 'users.limit': None}})
            cursor.commit()

    def test_a_concurrent_claim_cannot_exceed_the_limit(self):
        user_ids, base = self._fixture()
        try:
            with mute_logger('odoo.sql_db'), self.registry.cursor() as cursor_b:
                env_b = api.Environment(cursor_b, SUPERUSER_ID, {})
                env_b['res.users'].browse(user_ids).mapped('liwan_read_only')
                with self.registry.cursor() as cursor_a:
                    env_a = api.Environment(cursor_a, SUPERUSER_ID, {})
                    env_a['res.users'].browse(user_ids[0])._liwan_access_write({'liwan_read_only': False}, 'access.users.grant')
                    cursor_a.commit()
                # B started before A committed: it fails to serialize or finds the seat taken; both refusals are correct.
                # Odoo's assertRaises takes one class, so the two accepted refusals are caught explicitly.
                try:
                    env_b['res.users'].browse(user_ids[1])._liwan_access_write({'liwan_read_only': False}, 'access.users.grant')
                except (SerializationFailure, LiwanAccessRule):
                    pass
                else:
                    self.fail('the second claim must be refused')
            with self.registry.cursor() as cursor:
                env = api.Environment(cursor, SUPERUSER_ID, {})
                full = [user for user in env['res.users'].browse(user_ids) if not user.liwan_read_only]
                self.assertLessEqual(len(full), 1)
                self.assertLessEqual(env['liwan.entitlement.service']._liwan_count_users(), base + 1)
        finally:
            self._cleanup(user_ids, base)


@tagged('post_install', '-at_install', 'liwan', 'liwan_seat_concurrency')
class TestAcceptanceConcurrency(TransactionCase):
    """Two invitees accepting while one full seat is free: one takes it, the limit holds."""

    def _fixture(self):
        if not self.env.cr.dbname.startswith('liwan_scratch_'):
            self.fail('Committed concurrency fixtures require a liwan_scratch_ database.')
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
            profile = env['liwan.entitlement.service']._liwan_profile()
            profile._liwan_initialize_legacy_policy(env['liwan.feature.registry']._liwan_installed_module_ids())
            service = env['liwan.entitlement.service']
            base = service._liwan_count_users()
            profile.write({'features': {**profile.features, 'users.limit': base + 2}})
            access = env['liwan.access.service']
            invitees = [access._liwan_create_invitee(f'Race {name}', f'accept_race_{name}@example.com', False) for name in 'ab']
            tokens = [access._liwan_tokens()._liwan_issue(user, 'invite')[1] for user in invitees]
            profile.write({'features': {**profile.features, 'users.limit': base + 1}})
            result = [user.id for user in invitees], tokens, base
            cursor.commit()
            return result

    def _cleanup(self, user_ids):
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
            users = env['res.users'].with_context(active_test=False).browse(user_ids)
            partners = users.partner_id
            users.unlink()
            partners.unlink()
            profile = env['liwan.entitlement.service']._liwan_profile()
            profile.write({'features': {**profile.features, 'users.limit': None}})
            cursor.commit()

    def test_concurrent_acceptances_cannot_both_take_the_last_full_seat(self):
        user_ids, tokens, base = self._fixture()
        try:
            with mute_logger('odoo.sql_db'), self.registry.cursor() as cursor_b:
                env_b = api.Environment(cursor_b, SUPERUSER_ID, {})
                env_b['res.users'].with_context(active_test=False).browse(user_ids).mapped('liwan_read_only')
                with self.registry.cursor() as cursor_a:
                    env_a = api.Environment(cursor_a, SUPERUSER_ID, {})
                    env_a['liwan.access.service']._liwan_accept_invitation(tokens[0], '+966500000081', 'accepted_race_123')
                    cursor_a.commit()
                # B's snapshot predates A's commit: its acceptance fails to serialize, or finds the seat taken.
                try:
                    env_b['liwan.access.service']._liwan_accept_invitation(tokens[1], '+966500000082', 'accepted_race_123')
                except SerializationFailure:
                    pass
            with self.registry.cursor() as cursor:
                env = api.Environment(cursor, SUPERUSER_ID, {})
                self.assertEqual(env['liwan.entitlement.service']._liwan_count_users(), base + 1)
                self.assertFalse(env['res.users'].with_context(active_test=False).browse(user_ids[0]).liwan_read_only)
        finally:
            self._cleanup(user_ids)
