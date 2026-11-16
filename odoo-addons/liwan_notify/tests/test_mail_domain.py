# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import hashlib
import os
from datetime import datetime, timedelta
from unittest.mock import patch

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_notify.models.mail_domain import (
    FROM_FILTER_PARAM,
    LiwanMailRefused,
    MailDomainBusy,
    MailDomainInputError,
)
from odoo.addons.liwan_notify.models.mail_domain_oci import (
    FINGERPRINT_ENV,
    PRIVATE_KEY_ENV,
    REQUIRED_ENV,
    signed_headers,
)
from odoo.addons.liwan_notify.models.mail_domain_provider import (
    MailDomainTaken,
    MailProviderError,
)
from odoo.addons.liwan_notify.models.mail_mail import (
    DAILY_CEILING_PARAM,
    MAX_ATTEMPTS,
    MINUTE_CEILING_PARAM,
)

PLATFORM_SENDER = 'no-reply@liwanos.example'
ROUTE = '/api/v1/mail/domain'


class FakeProvider:
    """The provider interface without a network: each test sets the states it needs."""

    def __init__(self):
        self.domain_active = True
        self.status = {'dkim': 'PENDING', 'spf': False, 'return_path': 'CREATING'}
        self.taken = set()
        self.deleted = []
        self.recreated = 0
        self.delivery = {}
        self.counter = 0
        self.fail_at = None  # a step name: the call fails there, after the earlier ids were written
        self.created = []
        self.extra_records = []

    def _id(self, kind):
        self.counter += 1
        return f'ocid.{kind}.{self.counter}'

    def _liwan_configured(self):
        return True

    def _step(self, domain, field, kind, **extra):
        if domain[field]:
            return
        if self.fail_at == kind:
            msg = 'provider down'
            raise MailProviderError(msg, 500)
        self.created.append(kind)
        domain.write({field: self._id(kind), **extra})

    def create_domain(self, domain):
        if not domain.provider_domain_id and domain.domain in self.taken:
            msg = 'taken'
            raise MailDomainTaken(msg, 409)
        self._step(domain, 'provider_domain_id', 'domain')
        if not self.domain_active:
            return
        self._step(domain, 'provider_dkim_id', 'dkim')
        self._step(domain, 'provider_return_path_id', 'rp', return_path_created_at=fields.Datetime.now())
        self._step(domain, 'provider_sender_id', 'sender')

    def read_records(self, domain):
        records = [{'kind': 'spf', 'type': 'TXT', 'name': domain.domain, 'value': 'v=spf1 include:rp.example ~all'}]
        if domain.provider_dkim_id:
            records.append({'kind': 'dkim', 'type': 'CNAME', 'name': f'sel._domainkey.{domain.domain}', 'value': 'dkim.target'})
        if domain.provider_return_path_id:
            records.append({'kind': 'return_path', 'type': 'CNAME', 'name': f'rp.{domain.domain}',
                            'value': f'target.{domain.provider_return_path_id}'})
        return records + self.extra_records

    def check(self, domain):
        return dict(self.status)

    def recreate_return_path(self, domain):
        self.recreated += 1
        return self._id('rp')

    def delete_domain(self, domain):
        self.deleted.append(domain.domain)

    def fetch_delivery_status(self, domain, message_ids, since):
        return {message_id: self.delivery[message_id] for message_id in message_ids if message_id in self.delivery}


class DomainFixture:

    def _install_provider(self):
        self.provider = FakeProvider()
        self.patch(type(self.env['liwan.mail.domain']), '_liwan_provider', lambda model: self.provider)
        self.env['ir.config_parameter'].sudo().set_param('mail.default.from', PLATFORM_SENDER)
        params = self.env['ir.config_parameter'].sudo()
        params.set_param(DAILY_CEILING_PARAM, 0)
        params.set_param(MINUTE_CEILING_PARAM, 0)

    def _verified(self, domain='acme.example'):
        row = self.env['liwan.mail.domain'].sudo()._liwan_start(domain, 'info')
        self.provider.status = {'dkim': 'ACTIVE', 'spf': True, 'return_path': 'ACTIVE'}
        row._liwan_check()
        return row


@tagged('post_install', '-at_install', 'liwan')
class TestMailDomain(DomainFixture, TransactionCase):

    def setUp(self):
        super().setUp()
        self._install_provider()
        self.domains = self.env['liwan.mail.domain']
        self.send = self.env['liwan.mail.send']
        self.partner = self.env['res.partner'].create({'name': 'Mail source'})

    def _send(self):
        return self.send._liwan_send('res.partner', self.partner.id, 'test.kind', ['a@example.com'], 'S', '<p>B</p>')

    def test_bad_public_and_platform_domains_and_bad_local_parts_are_refused(self):
        for domain, local, field in (
            ('not a domain', 'info', 'domain'), ('example', 'info', 'domain'), ('gmail.com', 'info', 'domain'),
            ('mail.outlook.com', 'info', 'domain'), ('liwanos.example', 'info', 'domain'),
            ('tenant.liwanos.example', 'info', 'domain'), ('acme.example', 'a..b', 'from_local_part'),
            ('acme.example', 'a b', 'from_local_part'), ('acme.example', '.info', 'from_local_part'),
            ('acme.example', '"x"@y', 'from_local_part'), ('acme.example', '', 'from_local_part'),
        ):
            with self.subTest(domain=domain, local=local), self.assertRaises(MailDomainInputError) as caught:
                self.domains._liwan_normalize(domain, local)
            self.assertEqual(caught.exception.field, field)
        self.assertEqual(self.domains._liwan_normalize(' Acme.Example. ', 'Sales.Team'), ('acme.example', 'sales.team'))

    def test_start_creates_one_row_on_the_root_with_its_records(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self.assertEqual((row.state, row.company_id), ('pending_dns', self.domains._liwan_root()))
        self.assertEqual({record['kind'] for record in row.records}, {'spf', 'dkim', 'return_path'})
        self.assertTrue(row.return_path_created_at)
        with self.assertRaises(MailDomainInputError):
            self.domains._liwan_start('other.example', 'info')

    def test_a_domain_held_elsewhere_leaves_nothing(self):
        self.provider.taken.add('acme.example')
        with self.assertRaises(MailDomainTaken), self.env.cr.savepoint():
            self.domains._liwan_start('acme.example', 'info')
        self.assertFalse(self.domains.search([]))

    def test_an_inactive_provider_domain_waits_for_the_cron(self):
        self.provider.domain_active = False
        row = self.domains._liwan_start('acme.example', 'info')
        self.assertTrue(row.provider_domain_id)
        self.assertFalse(row.provider_dkim_id)
        self.provider.domain_active = True
        self.domains._liwan_cron_verify()
        self.assertTrue(row.provider_dkim_id and row.provider_return_path_id and row.provider_sender_id)
        self.assertEqual(row.state, 'pending_dns')

    def test_verified_when_dkim_spf_and_return_path_are_active_and_the_filter_is_written(self):
        row = self._verified()
        self.assertEqual(row.state, 'verified')
        self.assertTrue(row.verified_at)
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param(FROM_FILTER_PARAM), 'liwanos.example,acme.example')

    def test_a_verified_domain_that_stops_validating_fails_and_refuses_sends(self):
        row = self._verified()
        self.provider.status['spf'] = False
        self.domains._liwan_cron_verify()
        self.assertEqual(row.state, 'failed')
        self.assertTrue(row.last_error)
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param(FROM_FILTER_PARAM), 'liwanos.example')
        with self.assertRaises(LiwanMailRefused) as caught:
            self._send()
        self.assertEqual(caught.exception.code, 'mail_domain_unverified')

    def test_a_return_path_still_pending_after_72_hours_is_recreated(self):
        row = self.domains._liwan_start('acme.example', 'info')
        old_path = row.provider_return_path_id
        row.return_path_created_at = fields.Datetime.now() - timedelta(hours=71)
        self.domains._liwan_cron_verify()
        self.assertEqual(self.provider.recreated, 0)
        row.return_path_created_at = fields.Datetime.now() - timedelta(hours=73)
        self.domains._liwan_cron_verify()
        self.assertEqual(self.provider.recreated, 1)
        self.assertNotEqual(row.provider_return_path_id, old_path)
        self.assertTrue(row.return_path_recreated_at)
        self.assertEqual(row.state, 'pending_dns')
        path = next(record for record in row.records if record['kind'] == 'return_path')
        self.assertEqual(path['value'], f'target.{row.provider_return_path_id}')

    def test_a_failed_return_path_is_recreated_at_once(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self.provider.status['return_path'] = 'FAILED'
        row._liwan_check()
        self.assertEqual(self.provider.recreated, 1)

    def test_the_sender_is_the_company_on_the_verified_domain(self):
        self._verified()
        mail = self._send().sudo()
        company = self.domains._liwan_root().name
        self.assertIn('info@acme.example', mail.email_from)
        self.assertIn(company, mail.email_from)
        self.assertTrue(mail.message_id.endswith('@acme.example>'))

    def test_no_domain_or_a_pending_one_refuses_and_creates_nothing(self):
        with self.assertRaises(LiwanMailRefused):
            self._send()
        self.domains._liwan_start('acme.example', 'info')
        with self.assertRaises(LiwanMailRefused):
            self._send()
        self.assertFalse(self.env['mail.mail'].sudo().search([('liwan_kind', '=', 'test.kind')]))

    def test_a_paused_domain_refuses_with_its_reason(self):
        row = self._verified()
        row.write({'paused': True, 'pause_reason': 'bounces'})
        with self.assertRaises(LiwanMailRefused) as caught:
            self._send()
        self.assertEqual((caught.exception.code, caught.exception.reason), ('mail_paused', 'bounces'))

    def test_without_a_configured_provider_the_operator_sender_is_used(self):
        self.patch(type(self.domains), '_liwan_provider_configured', lambda model: False)
        self.assertEqual(self._send().sudo().email_from, PLATFORM_SENDER)

    def test_a_queued_row_is_held_at_send_time_when_the_domain_changed_state(self):
        row = self._verified()
        mail = self._send().sudo()
        row.write({'paused': True, 'pause_reason': 'bounces'})
        with patch.object(type(self.env['ir.mail_server']), 'send_email', autospec=True) as smtp:
            mail.send()
        smtp.assert_not_called()
        self.assertEqual((mail.state, mail.failure_reason), ('exception', 'mail_paused'))
        self.env['mail.mail']._liwan_retry_failed()
        self.assertEqual((mail.state, mail.liwan_attempts), ('exception', 1))
        row._liwan_resume()
        self.env['mail.mail']._liwan_retry_failed()
        self.assertEqual((mail.state, mail.liwan_attempts), ('outgoing', 1))  # a hold spends no attempt

    def test_removal_deletes_provider_resources_and_clears_the_filter(self):
        row = self._verified()
        row._liwan_remove()
        self.assertEqual(self.provider.deleted, ['acme.example'])
        self.assertEqual((row.state, row.domain), ('not_started', 'acme.example'))
        self.assertFalse(row.provider_domain_id or row.records)
        self.assertEqual(self.env['ir.config_parameter'].sudo().get_param(FROM_FILTER_PARAM), 'liwanos.example')

    def test_offboarding_deletes_and_raises_on_a_provider_failure(self):
        self._verified()
        self.patch(FakeProvider, 'delete_domain', lambda provider, domain: (_ for _ in ()).throw(MailDomainTaken('x', 500)))
        with self.assertRaises(MailDomainTaken):
            self.domains._liwan_offboard()

    def _sent_rows(self, count):
        rows = self.env['mail.mail'].sudo()
        for _index in range(count):
            rows |= self._send().sudo()
        rows.write({'state': 'sent'})
        return rows

    def test_the_status_cron_fills_the_provider_status_by_message_id(self):
        self._verified()
        first, second = self._sent_rows(2)
        self.provider.delivery = {first.message_id: 'relayed'}
        self.env['mail.mail']._liwan_fetch_delivery_status()
        self.assertEqual((first.liwan_provider_status, second.liwan_provider_status), ('relayed', 'submitted'))
        self.assertTrue(first.liwan_provider_checked_at)

    def test_a_high_bounce_rate_pauses_the_domain(self):
        row = self._verified()
        rows = self._sent_rows(50)
        self.provider.delivery = {mail.message_id: 'bounced' for mail in rows[:3]}
        self.env['mail.mail']._liwan_fetch_delivery_status()
        self.assertTrue(row.paused)
        self.assertTrue(row.pause_reason)

    def test_a_rate_under_the_threshold_or_too_few_sends_does_not_pause(self):
        row = self._verified()
        rows = self._sent_rows(49)
        self.provider.delivery = {mail.message_id: 'bounced' for mail in rows[:10]}
        self.env['mail.mail']._liwan_fetch_delivery_status()
        self.assertFalse(row.paused)
        more = self._sent_rows(51)
        self.provider.delivery = {mail.message_id: 'relayed' for mail in more}
        self.env['mail.mail']._liwan_fetch_delivery_status()
        self.assertTrue(row.paused)  # 10 of 100 bounced
        row._liwan_resume()
        row.resumed_at = fields.Datetime.now() + timedelta(seconds=1)  # the rows above were sent before the review
        self.env['mail.mail']._liwan_fetch_delivery_status()
        self.assertFalse(row.paused)

    def test_one_complaint_in_fifty_pauses(self):
        row = self._verified()
        rows = self._sent_rows(50)
        self.provider.delivery = {rows[0].message_id: 'complained'}
        self.env['mail.mail']._liwan_fetch_delivery_status()
        self.assertTrue(row.paused)


@tagged('post_install', '-at_install', 'liwan')
class TestMailDomainRecovery(DomainFixture, TransactionCase):
    """A provider failure part way never loses an id, never duplicates a resource and never blocks the tenant."""

    def setUp(self):
        super().setUp()
        self._install_provider()
        self.domains = self.env['liwan.mail.domain']

    def test_a_failure_after_the_domain_is_created_keeps_its_id_and_the_cron_resumes(self):
        self.provider.fail_at = 'rp'
        row = self.domains._liwan_start('acme.example', 'info')
        self.assertEqual(row.state, 'pending_dns')
        self.assertTrue(row.provider_domain_id and row.provider_dkim_id and row.last_error)
        self.assertFalse(row.provider_return_path_id)
        domain_id = row.provider_domain_id
        self.provider.fail_at = None
        self.domains._liwan_cron_verify()
        self.assertEqual(row.provider_domain_id, domain_id)
        self.assertTrue(row.provider_return_path_id and row.provider_sender_id)
        self.assertEqual(self.provider.created, ['domain', 'dkim', 'rp', 'sender'])

    def test_a_failed_first_call_keeps_the_row_for_the_cron(self):
        self.provider.fail_at = 'domain'
        row = self.domains._liwan_start('acme.example', 'info')
        self.assertTrue(row.exists() and row.last_error)
        self.provider.fail_at = None
        self.domains._liwan_cron_verify()
        self.assertTrue(row.provider_domain_id)

    def test_a_busy_row_is_skipped_by_the_cron(self):
        row = self.domains._liwan_start('acme.example', 'info')
        row._liwan_lock()  # the real lock, taken by this transaction, is reentrant
        self.patch(type(self.domains), '_liwan_lock', lambda record: (_ for _ in ()).throw(MailDomainBusy('busy')))
        self.provider.status = {'dkim': 'ACTIVE', 'spf': True, 'return_path': 'ACTIVE'}
        self.domains._liwan_cron_verify()
        self.assertEqual(row.state, 'pending_dns')
        with self.assertRaises(MailDomainBusy):
            row._liwan_remove()

    def test_the_cron_continues_past_a_raising_row(self):
        first = self.domains._liwan_start('acme.example', 'info')
        other_company = self.env['res.company'].create({'name': 'Second tenant root'})
        second = self.domains.create({
            'company_id': other_company.id, 'domain': 'beta.example', 'from_local_part': 'info', 'state': 'pending_dns',
        })
        original = type(self.domains)._liwan_check

        def check(record):
            if record == second:
                msg = 'provider down'
                raise MailProviderError(msg, 500)
            return original(record)
        self.patch(type(self.domains), '_liwan_check', check)
        third_company = self.env['res.company'].create({'name': 'Third tenant root'})
        third = self.domains.create({
            'company_id': third_company.id, 'domain': 'gamma.example', 'from_local_part': 'info', 'state': 'pending_dns',
        })
        for domain in ('beta.example', 'gamma.example'):
            self.env['liwan.mail.domain.attempt']._liwan_begin(domain)
        first.write({'provider_domain_id': False})
        self.provider.taken.add('acme.example')
        self.domains._liwan_cron_verify()
        self.assertEqual(first.state, 'failed')
        self.assertTrue(second.last_error)
        self.assertTrue(third.provider_domain_id)

    def _two_pending_rows(self):
        rows = self.domains._liwan_start('acme.example', 'info')
        other_company = self.env['res.company'].create({'name': 'Second tenant root'})
        second = self.domains.create({
            'company_id': other_company.id, 'domain': 'beta.example', 'from_local_part': 'info', 'state': 'pending_dns',
        })
        self.env['liwan.mail.domain.attempt']._liwan_begin('beta.example')
        return rows, second

    def _oci_with_key(self, pem):
        env = {name: 'value' for name in REQUIRED_ENV}
        env[FINGERPRINT_ENV] = 'aa:bb'
        env[PRIVATE_KEY_ENV] = pem
        self.patch(os, 'environ', {**os.environ, **env})
        oci = self.env['liwan.mail.domain.provider.oci']
        self.patch(type(self.domains), '_liwan_provider', lambda model: oci)

    def test_the_cron_continues_past_a_malformed_provider_key(self):
        first, second = self._two_pending_rows()
        self._oci_with_key('not a pem key')
        self.domains._liwan_cron_verify()
        self.assertTrue(first.last_error and second.last_error)
        self.assertNotIn('not a pem key', f'{first.last_error}{second.last_error}')

    def test_the_cron_continues_past_a_non_json_provider_answer(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self._oci_with_key(key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
        ).decode())
        first, second = self._two_pending_rows()
        answer = requests.Response()
        answer.status_code = 200
        answer._content = b'<html>gateway page</html>'
        with patch('odoo.addons.liwan_notify.models.mail_domain_oci.requests.request', return_value=answer):
            self.domains._liwan_cron_verify()
        self.assertTrue(first.last_error and second.last_error)

    def _attempt(self, domain='acme.example'):
        return self.env['liwan.mail.domain.attempt']._liwan_for(domain)

    def _age(self, days, domain='acme.example'):
        self._attempt(domain).first_started_at = fields.Datetime.now() - timedelta(days=days)

    def _cool(self, domain='acme.example'):
        self._attempt(domain).expired_at = fields.Datetime.now() - timedelta(days=8)

    def _fresh(self, domain='acme.example'):
        return self._attempt(domain).first_started_at > fields.Datetime.now() - timedelta(minutes=1)

    def test_a_domain_not_verified_in_time_expires_and_frees_the_name(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self._age(6)
        self.domains._liwan_cron_verify()
        self.assertEqual(row.state, 'pending_dns')
        self._age(8)
        self.domains._liwan_cron_verify()
        self.assertEqual(self.provider.deleted, ['acme.example'])
        self.assertEqual(row.state, 'not_started')
        self.assertFalse(row.provider_domain_id or row.records)
        self.assertIn('7', row.last_error)
        self.assertTrue(self._attempt().expired_at)
        self._cool()
        again = self.domains._liwan_start('acme.example', 'info')
        self.assertEqual((again, again.state), (row, 'pending_dns'))
        self.assertTrue(again.provider_domain_id and self._fresh())
        self.assertFalse(self._attempt().expired_at)

    def test_expiry_retries_after_a_provider_failure(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self._age(8)

        def refuse(provider, domain):
            msg = 'provider down'
            raise MailProviderError(msg, 500)
        self.patch(FakeProvider, 'delete_domain', refuse)
        self.domains._liwan_cron_verify()
        self.assertEqual(row.state, 'pending_dns')
        self.assertTrue(row.provider_domain_id and row.last_error)
        self.assertFalse(self._attempt().expired_at)

    def test_a_once_verified_domain_does_not_expire_and_has_no_clock(self):
        row = self._verified()
        self.assertFalse(self._attempt())
        self.provider.status['spf'] = False
        self.domains._liwan_cron_verify()
        self.domains._liwan_cron_verify()
        self.assertEqual(row.state, 'failed')
        self.assertFalse(self.provider.deleted)

    def test_a_pending_domain_without_a_clock_expires(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self._attempt().unlink()
        self.domains._liwan_cron_verify()
        self.assertEqual(row.state, 'not_started')
        self.assertTrue(self._attempt().expired_at)

    def test_removing_and_restarting_the_same_domain_keeps_the_clock(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self._age(6)
        started = self._attempt().first_started_at
        row._liwan_remove()
        self.assertEqual((row.state, row.domain), ('not_started', 'acme.example'))
        self.domains._liwan_start('acme.example', 'info')
        self.assertEqual(self._attempt().first_started_at, started)
        self._age(8)
        self.domains._liwan_cron_verify()
        self.assertEqual(row.state, 'not_started')

    def test_alternating_domains_keeps_each_clock(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self._age(6)
        started = self._attempt().first_started_at
        row._liwan_remove()
        self.domains._liwan_start('beta.example', 'info')
        self.assertTrue(self._fresh('beta.example'))
        row._liwan_remove()
        self.domains._liwan_start('acme.example', 'info')
        self.assertEqual(self._attempt().first_started_at, started)
        self._age(8)
        self.domains._liwan_cron_verify()
        self.assertEqual(row.state, 'not_started')

    def test_expire_a_start_b_then_a_waits_the_cooldown(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self._age(8)
        self.domains._liwan_cron_verify()
        other = self.domains._liwan_start('beta.example', 'info')
        self.assertEqual((other, other.state), (row, 'pending_dns'))
        self.assertTrue(self._fresh('beta.example'))
        row._liwan_remove()
        with self.assertRaises(MailDomainInputError) as caught:
            self.domains._liwan_start('acme.example', 'info')
        self.assertEqual(caught.exception.field, 'domain')
        self._cool()
        self.domains._liwan_start('acme.example', 'info')
        self.assertTrue(self._fresh())

    def test_a_taken_domain_leaves_the_reused_row_as_it_was(self):
        row = self.domains._liwan_start('acme.example', 'info')
        self._age(8)
        self.domains._liwan_cron_verify()
        error = row.last_error
        self.provider.taken.add('held.example')
        with self.assertRaises(MailDomainTaken):
            self.domains._liwan_start('held.example', 'info')
        self.assertEqual((row.exists(), row.domain, row.state, row.last_error), (row, 'acme.example', 'not_started', error))

    def test_a_domain_manager_only_reads_the_clock(self):
        user = new_test_user(self.env, login='attempt_reader', groups='liwan_core.group_employee,liwan_notify.group_cap_mail_domain_manage')
        self.domains._liwan_start('acme.example', 'info')
        attempt = self._attempt().with_user(user)
        self.assertTrue(attempt.first_started_at)
        with self.assertRaises(AccessError):
            attempt.write({'first_started_at': fields.Datetime.now()})

    def test_a_once_verified_domain_removed_starts_fresh(self):
        row = self._verified()
        row._liwan_remove()
        again = self.domains._liwan_start('acme.example', 'info')
        self.assertTrue(self._fresh())
        self.assertFalse(again.verified_at)

    def test_a_bad_pending_days_parameter_falls_back(self):
        for value in ('abc', '0', '-3', '2.5'):
            self.env['ir.config_parameter'].sudo().set_param('liwan_notify.mail_domain_pending_days', value)
            with self.subTest(value=value):
                self.assertEqual(self.domains._liwan_pending_days(), 7)
        self.env['ir.config_parameter'].sudo().set_param('liwan_notify.mail_domain_pending_days', '3')
        self.assertEqual(self.domains._liwan_pending_days(), 3)

    def test_a_paused_domain_is_not_removed_but_offboarding_removes_it(self):
        row = self._verified()
        row.write({'paused': True, 'pause_reason': 'bounces'})
        with self.assertRaises(LiwanMailRefused) as caught:
            row._liwan_remove()
        self.assertEqual(caught.exception.code, 'mail_paused')
        with self.assertRaises(LiwanMailRefused):
            self.domains._liwan_start('other.example', 'info')
        self.domains._liwan_offboard()
        self.assertFalse(row.exists())
        self.assertEqual(self.provider.deleted, ['acme.example'])

    def test_a_held_row_spends_no_attempt_even_at_the_cap(self):
        self.env['ir.config_parameter'].sudo().set_param('mail.default.from', PLATFORM_SENDER)
        row = self.domains._liwan_start('acme.example', 'info')
        self.provider.status = {'dkim': 'ACTIVE', 'spf': True, 'return_path': 'ACTIVE'}
        row._liwan_check()
        partner = self.env['res.partner'].create({'name': 'Mail source'})
        mail = self.env['liwan.mail.send']._liwan_send(
            'res.partner', partner.id, 'test.kind', ['a@example.com'], 'S', '<p>B</p>',
        ).sudo()
        mail.liwan_attempts = MAX_ATTEMPTS
        row.write({'paused': True, 'pause_reason': 'bounces'})
        mail.send()
        self.assertEqual((mail.state, mail.failure_reason), ('exception', 'mail_paused'))
        row._liwan_resume()
        self.env['mail.mail']._liwan_retry_failed()
        self.assertEqual((mail.state, mail.liwan_attempts, mail.failure_reason), ('outgoing', MAX_ATTEMPTS, False))


@tagged('post_install', '-at_install', 'liwan')
class TestOciCreateSteps(TransactionCase):
    """The OCI client looks a child up before creating it, and writes each id as soon as it has it."""

    def setUp(self):
        super().setUp()
        self.oci = self.env['liwan.mail.domain.provider.oci']
        self.calls = []
        self.ours = {'liwan-db': self.env['ir.config_parameter'].sudo().get_param('database.uuid')}
        self.existing_dkim = {'items': [
            {'id': 'ocid.dkim.foreign', 'lifecycleState': 'ACTIVE', 'emailDomainId': 'ocid.domain.1',
             'freeformTags': {'liwan-db': 'another-database'}},
            {'id': 'ocid.dkim.untagged', 'lifecycleState': 'ACTIVE', 'emailDomainId': 'ocid.domain.1'},
            {'id': 'ocid.dkim.wrongparent', 'lifecycleState': 'ACTIVE', 'emailDomainId': 'ocid.domain.2',
             'freeformTags': self.ours},
            {'id': 'ocid.dkim.old', 'lifecycleState': 'ACTIVE', 'emailDomainId': 'ocid.domain.1', 'freeformTags': self.ours},
        ]}
        self.domain_post_conflict = False
        self.listed_domains = []
        self.posted = []

    def _fake(self, method, path, body=None, params=None):
        self.calls.append((method, path))
        if method == 'GET' and path.startswith('/emailDomains/'):
            return {'lifecycleState': 'ACTIVE'}
        if method == 'GET' and path == '/dkims':
            return self.existing_dkim
        if method == 'GET' and path == '/emailDomains':
            return {'items': self.listed_domains}
        if method == 'POST':
            self.posted.append((path, body))
        if method == 'POST' and path == '/emailDomains' and self.domain_post_conflict:
            msg = 'conflict'
            raise MailProviderError(msg, 409)
        if method == 'GET':
            return {'items': [{'id': 'ocid.gone', 'lifecycleState': 'DELETED'}]}
        if path == '/senders':
            msg = 'sender refused'
            raise MailProviderError(msg, 500)
        return {'id': f'ocid.new{path}'}

    def test_existing_children_are_reused_and_ids_survive_a_later_failure(self):
        self.patch(type(self.oci), '_liwan_email', self._fake)
        row = self.env['liwan.mail.domain'].create({
            'company_id': self.env['liwan.mail.domain']._liwan_root().id, 'domain': 'acme.example',
            'from_local_part': 'info', 'state': 'pending_dns', 'provider_domain_id': 'ocid.domain.1',
        })
        # Not assertRaises: Odoo's rolls its savepoint back, and the ids written before the failure are the point.
        failure = None
        try:
            self.oci.create_domain(row)
        except MailProviderError as error:
            failure = error
        self.assertEqual(failure.status, 500)
        self.assertEqual(row.provider_dkim_id, 'ocid.dkim.old')
        self.assertEqual(row.provider_return_path_id, 'ocid.new/emailReturnPaths')
        self.assertNotIn(('POST', '/dkims'), self.calls)
        self.assertNotIn(('POST', '/emailDomains'), self.calls)
        self.assertTrue(all(body['freeformTags'] == self.ours for _path, body in self.posted))

    def _new_row(self):
        return self.env['liwan.mail.domain'].create({
            'company_id': self.env['liwan.mail.domain']._liwan_root().id, 'domain': 'acme.example',
            'from_local_part': 'info', 'state': 'pending_dns',
        })

    def test_a_lost_answer_adopts_our_own_tagged_domain(self):
        self.patch(type(self.oci), '_liwan_email', self._fake)
        self.domain_post_conflict = True
        self.listed_domains = [
            {'id': 'ocid.domain.other', 'name': 'other.example', 'compartmentId': None, 'freeformTags': self.ours,
             'lifecycleState': 'ACTIVE'},
            {'id': 'ocid.domain.ours', 'name': 'acme.example', 'compartmentId': None, 'freeformTags': self.ours,
             'lifecycleState': 'ACTIVE'},
        ]
        self.assertEqual(self.oci._liwan_create_email_domain('acme.example', None)['id'], 'ocid.domain.ours')

    def test_a_conflict_on_a_foreign_or_untagged_domain_stays_taken(self):
        self.patch(type(self.oci), '_liwan_email', self._fake)
        self.domain_post_conflict = True
        for tags in ({'liwan-db': 'another-database'}, None):
            self.listed_domains = [{'id': 'ocid.domain.x', 'name': 'acme.example', 'compartmentId': None,
                                    'freeformTags': tags, 'lifecycleState': 'ACTIVE'}]
            with self.subTest(tags=tags), self.assertRaises(MailDomainTaken):
                self.oci._liwan_create_email_domain('acme.example', None)

    def test_find_ignores_a_wrong_parent_and_a_missing_or_foreign_tag(self):
        self.patch(type(self.oci), '_liwan_email', self._fake)
        found = self.oci._liwan_find('/dkims', {'emailDomainId': 'ocid.domain.1'}, {'emailDomainId': 'ocid.domain.1'})
        self.assertEqual(found['id'], 'ocid.dkim.old')
        self.existing_dkim['items'].pop()
        self.assertIsNone(self.oci._liwan_find('/dkims', {'emailDomainId': 'ocid.domain.1'}, {'emailDomainId': 'ocid.domain.1'}))


@tagged('post_install', '-at_install', 'liwan')
class TestOciSigner(TransactionCase):

    def setUp(self):
        super().setUp()
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.now = datetime(2026, 11, 16, 12, 0).timestamp()

    def _parts(self, headers):
        auth = headers['authorization']
        return dict(part.split('=', 1) for part in auth[len('Signature '):].split(','))

    def test_get_and_delete_sign_date_target_and_host(self):
        for method in ('GET', 'DELETE'):
            headers = signed_headers(method, 'https://ctrl.example/20170907/dkims/x?a=1', None, 'k', self.key, self.now)
            self.assertEqual(self._parts(headers)['headers'], '"date (request-target) host"')
            self.assertNotIn('x-content-sha256', headers)

    def test_post_signs_the_body_headers_and_the_signature_verifies(self):
        body = b'{"name": "acme.example"}'
        url = 'https://ctrl.example/20170907/emailDomains'
        headers = signed_headers('POST', url, body, 'tenancy/user/fp', self.key, self.now)
        again = signed_headers('POST', url, body, 'tenancy/user/fp', self.key, self.now)
        self.assertEqual(headers, again)
        parts = self._parts(headers)
        self.assertEqual(parts['headers'], '"date (request-target) host x-content-sha256 content-type content-length"')
        self.assertEqual(parts['keyId'], '"tenancy/user/fp"')
        self.assertEqual(headers['x-content-sha256'], base64.b64encode(hashlib.sha256(body).digest()).decode())
        self.assertEqual(headers['content-length'], str(len(body)))
        signing = '\n'.join([
            f'date: {headers["date"]}', '(request-target): post /20170907/emailDomains', 'host: ctrl.example',
            f'x-content-sha256: {headers["x-content-sha256"]}', 'content-type: application/json',
            f'content-length: {len(body)}',
        ]).encode()
        signature = base64.b64decode(parts['signature'].strip('"'))
        self.key.public_key().verify(signature, signing, padding.PKCS1v15(), hashes.SHA256())


@tagged('post_install', '-at_install', 'liwan')
class TestMailDomainRoutes(DomainFixture, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_provider()
        self.set_mode('saas')
        self.manager = new_test_user(
            self.env, login='mail_domain_manager', password='mail_domain_pass_123', name='Mail manager',
            email='manager@acme.example', groups='liwan_core.group_employee',
        )
        permission = self.env['liwan.access.permission'].search([('key', '=', 'mail.domain.manage')])
        role = self.env['liwan.access.role'].create({
            'key': 'test_mail_domain', 'name_ar': 'Mail domain', 'type': 'built_in', 'permission_ids': [(6, 0, permission.ids)],
        })
        self.env['liwan.access.service']._liwan_replace_assignments(self.manager, [{
            'role_id': role.id, 'company_id': self.env.company.id,
        }])

    def set_mode(self, mode):
        profile = self.env.ref('liwan_platform.tenant_profile')
        source = {'saas': 'control_plane', 'non_saas': 'local_policy'}[mode]
        self.env.cr.execute(
            'UPDATE liwan_tenant_profile SET commercial_mode=%s, entitlement_source=%s, valid_until=NULL WHERE id=%s',
            [mode, source, profile.id],
        )
        profile.invalidate_recordset()

    def _login(self):
        self.authenticate('mail_domain_manager', 'mail_domain_pass_123')

    def test_the_capability_is_required_and_system_admin_does_not_hold_it(self):
        admin_role = self.env.ref('liwan_core.role_system_admin')
        self.assertNotIn('mail.domain.manage', admin_role.permission_ids.mapped('key'))
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', ROUTE).status_code, 403)

    def test_non_saas_answers_commercial_unavailable(self):
        self.set_mode('non_saas')
        self._login()
        response = self.api('GET', ROUTE)
        self.assertEqual((response.status_code, response.json()['code']), (404, 'commercial_unavailable'))

    def test_the_full_cycle_through_the_routes(self):
        self._login()
        self.assertEqual(self.api('GET', ROUTE).json()['state'], 'not_started')
        started = self.api('POST', f'{ROUTE}/start', {'domain': 'acme.example', 'from_local_part': 'info'})
        self.assertEqual(started.status_code, 200)
        body = started.json()
        self.assertEqual(set(body), {
            'state', 'domain', 'from_local_part', 'sender_address', 'records', 'return_path_expires_at',
            'return_path_recreated_at', 'verified_at', 'last_error', 'paused', 'pause_reason', 'provider_configured',
        })
        self.assertEqual((body['state'], body['sender_address']), ('pending_dns', 'info@acme.example'))
        self.assertTrue(body['return_path_expires_at'])
        refused = self.api('POST', f'{ROUTE}/test-send', {})
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'mail_domain_unverified'))
        self.provider.status = {'dkim': 'ACTIVE', 'spf': True, 'return_path': 'ACTIVE'}
        self.assertEqual(self.api('POST', f'{ROUTE}/verify', {}).json()['state'], 'verified')
        sent = self.api('POST', f'{ROUTE}/test-send', {})
        self.assertEqual(sent.status_code, 200)
        self.assertEqual(set(sent.json()), {'mail_id', 'state'})
        usage = self.api('GET', f'{ROUTE}/usage').json()
        self.assertEqual(set(usage), {'today', 'ceiling', 'near_ceiling', 'deferred'})
        self.assertEqual(usage['today'], 1)
        removed = self.api('DELETE', ROUTE)
        self.assertEqual((removed.status_code, removed.json()['state']), (200, 'not_started'))
        current = self.api('GET', ROUTE)
        self.assertEqual(current.status_code, 200)
        self.assertEqual((current.json()['state'], current.json()['domain']), ('not_started', 'acme.example'))
        self.assertEqual(self.api('DELETE', ROUTE).status_code, 404)

    def test_invalid_and_taken_domains(self):
        self._login()
        for payload, field in (
            ({'domain': 'gmail.com', 'from_local_part': 'info'}, 'domain'),
            ({'domain': 'liwanos.example', 'from_local_part': 'info'}, 'domain'),
            ({'domain': 'acme.example', 'from_local_part': 'a b'}, 'from_local_part'),
            ({'domain': 7, 'from_local_part': 'info'}, 'domain'),
        ):
            with self.subTest(payload=payload):
                response = self.api('POST', f'{ROUTE}/start', payload)
                self.assertEqual((response.status_code, response.json()['code'], response.json()['field']), (422, 'invalid', field))
        self.provider.taken.add('held.example')
        taken = self.api('POST', f'{ROUTE}/start', {'domain': 'held.example', 'from_local_part': 'info'})
        self.assertEqual((taken.status_code, taken.json()['code']), (409, 'domain_taken'))
        self.assertNotIn('held', taken.json().get('message', '').replace('held.example', ''))

    def test_records_not_ready_are_left_out(self):
        self._login()
        self.provider.extra_records = [{'kind': 'dkim', 'type': 'CNAME', 'name': 'x.acme.example', 'value': ''}]
        body = self.api('POST', f'{ROUTE}/start', {'domain': 'acme.example', 'from_local_part': 'info'}).json()
        self.assertTrue(body['records'])
        self.assertTrue(all(record['name'] and record['value'] for record in body['records']))
        self.assertNotIn('x.acme.example', [record['name'] for record in body['records']])

    def test_verify_after_the_name_was_taken_answers_the_failed_row(self):
        self._login()
        self.provider.fail_at = 'domain'
        self.api('POST', f'{ROUTE}/start', {'domain': 'acme.example', 'from_local_part': 'info'})
        self.provider.fail_at = None
        self.provider.taken.add('acme.example')
        response = self.api('POST', f'{ROUTE}/verify', {})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['state'], 'failed')
        self.assertTrue(response.json()['last_error'])

    def test_a_busy_domain_answers_409(self):
        self._login()
        self.api('POST', f'{ROUTE}/start', {'domain': 'acme.example', 'from_local_part': 'info'})
        self.patch(type(self.env['liwan.mail.domain']), '_liwan_lock', lambda record: (_ for _ in ()).throw(MailDomainBusy('busy')))
        for method, path in (('POST', f'{ROUTE}/verify'), ('DELETE', ROUTE)):
            response = self.api(method, path, {} if method == 'POST' else None)
            self.assertEqual((response.status_code, response.json()['code']), (409, 'busy'))

    def _every_route(self):
        return (
            ('GET', ROUTE, None), ('POST', f'{ROUTE}/start', {'domain': 'acme.example', 'from_local_part': 'info'}),
            ('POST', f'{ROUTE}/verify', {}), ('POST', f'{ROUTE}/test-send', {}), ('DELETE', ROUTE, None),
            ('GET', f'{ROUTE}/usage', None),
        )

    def test_every_route_is_closed_when_the_registry_holds_no_kind(self):
        self._login()
        self.patch(type(self.env['liwan.notify.registry']), '_liwan_notification_types', lambda model: ())
        for method, path, body in self._every_route():
            response = self.api(method, path, body)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'), path)
            self.assertEqual(response.json()['details'], {'reason': 'feature', 'feature': None}, path)

    def test_a_read_only_tenant_keeps_the_reads_and_refuses_the_writes(self):
        self._login()
        self.patch(type(self.env['liwan.entitlement.service']), '_liwan_effective_state', lambda model, profile=None: 'payment_suspended')
        for method, path, body in self._every_route():
            response = self.api(method, path, body)
            if method == 'GET':
                self.assertEqual(response.status_code, 200, path)
            else:
                self.assertEqual((response.status_code, response.json()['code']), (403, 'tenant_read_only'), path)

    def test_a_suspended_tenant_is_refused(self):
        self._login()
        self.patch(type(self.env['liwan.entitlement.service']), '_liwan_effective_state', lambda model, profile=None: 'suspended')
        response = self.api('GET', ROUTE)
        self.assertEqual((response.status_code, response.json()['code']), (403, 'tenant_suspended'))

    def test_the_return_path_route_is_gone(self):
        self._login()
        self.assertEqual(self.api('POST', f'{ROUTE}/recreate-return-path', {}).status_code, 404)

    def test_a_paused_domain_answers_409_on_remove_and_start(self):
        self._login()
        self.api('POST', f'{ROUTE}/start', {'domain': 'acme.example', 'from_local_part': 'info'})
        self.env['liwan.mail.domain']._liwan_current().write({'paused': True, 'pause_reason': 'bounces'})
        for method, path, body in (
            ('DELETE', ROUTE, None),
            ('POST', f'{ROUTE}/start', {'domain': 'other.example', 'from_local_part': 'info'}),
        ):
            response = self.api(method, path, body)
            self.assertEqual((response.status_code, response.json()['code']), (409, 'mail_paused'))
        self.assertTrue(self.env['liwan.mail.domain']._liwan_current())
