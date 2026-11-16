# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""OCI Email Delivery as the tenant mail domain provider, over its signed HTTPS control API.

The calls follow the facts read from the OCI SDK and docs on 2026-11-16 (spec 9, phase 2): every operation name, body
and lifecycle value below must be proven against a real tenancy in the first live cycle before it is relied upon. The
log search query syntax and the delivery log fields are the least certain part and are marked where they are used.
"""
import base64
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from email.utils import formatdate
from urllib.parse import urlencode, urlsplit

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from odoo import api, fields, models

from .mail_domain_provider import MailDomainTaken, MailProviderError

# Operator configuration, from the environment only (spec 5.5): never stored in a tenant database, never logged.
REGION_ENV = 'LIWAN_OCI_EMAIL_REGION'
DEFAULT_REGION = 'me-jeddah-1'
COMPARTMENT_ENV = 'LIWAN_OCI_EMAIL_COMPARTMENT_ID'
TENANCY_ENV = 'LIWAN_OCI_TENANCY_ID'
USER_ENV = 'LIWAN_OCI_USER_ID'
FINGERPRINT_ENV = 'LIWAN_OCI_KEY_FINGERPRINT'
PRIVATE_KEY_ENV = 'LIWAN_OCI_PRIVATE_KEY'
LOG_GROUP_ENV = 'LIWAN_OCI_LOG_GROUP_ID'
SPF_INCLUDE_ENV = 'LIWAN_OCI_EMAIL_SPF_INCLUDE'
REQUIRED_ENV = (COMPARTMENT_ENV, TENANCY_ENV, USER_ENV, FINGERPRINT_ENV, PRIVATE_KEY_ENV, SPF_INCLUDE_ENV)

EMAIL_API = 'https://ctrl.email.{region}.oci.oraclecloud.com/20170907'
LOGGING_API = 'https://logging.{region}.oci.oraclecloud.com/20200531'
LOG_SEARCH_API = 'https://logging.{region}.oci.oraclecloud.com/20190909/search'
TIMEOUT_SECONDS = 10
BODY_METHODS = ('POST', 'PUT', 'PATCH')
ACTIVE = 'ACTIVE'
GONE = ('DELETING', 'DELETED')
# The freeform tag naming the database (``database.uuid``) that created an OCI resource.
DB_TAG = 'liwan-db'
# The delivery log category (unverified until the first live cycle).
LOG_CATEGORY = 'outboundrelayed'
# OCI delivery log action -> liwan_provider_status (unverified until the first live cycle). A soft bounce is not final.
ACTION_STATUS = {
    'accept': 'accepted',
    'relay': 'relayed',
    'bounce': 'bounced',
    'complaint': 'complained',
    'suppress': 'suppressed',
}


def signed_headers(method, url, body, key_id, private_key, now=None):
    """The headers of one OCI request signed with ``private_key`` (RSA-SHA256, signature version 1).

    GET and DELETE sign ``date (request-target) host``; a request with a body also signs ``x-content-sha256
    content-type content-length``, which it always sends. ``now`` (a POSIX time) fixes the date for a test.
    """
    method = method.upper()
    parts = urlsplit(url)
    target = parts.path + (f'?{parts.query}' if parts.query else '')
    headers = {'date': formatdate(now if now is not None else time.time(), usegmt=True), 'host': parts.netloc}
    names = ['date', '(request-target)', 'host']
    if method in BODY_METHODS:
        body = body or b''
        headers['x-content-sha256'] = base64.b64encode(hashlib.sha256(body).digest()).decode()
        headers['content-type'] = 'application/json'
        headers['content-length'] = str(len(body))
        names += ['x-content-sha256', 'content-type', 'content-length']
    lines = [
        f'(request-target): {method.lower()} {target}' if name == '(request-target)' else f'{name}: {headers[name]}'
        for name in names
    ]
    signature = base64.b64encode(
        private_key.sign('\n'.join(lines).encode(), padding.PKCS1v15(), hashes.SHA256()),
    ).decode()
    headers['authorization'] = (
        f'Signature version="1",keyId="{key_id}",algorithm="rsa-sha256",'
        f'headers="{" ".join(names)}",signature="{signature}"'
    )
    return headers


def _bare_message_id(message_id):
    return (message_id or '').strip().strip('<>')


class LiwanMailDomainOci(models.AbstractModel):
    """OCI Email Delivery: EmailDomain, DKIM, custom return path, approved sender and the delivery log, per tenant."""
    _name = 'liwan.mail.domain.provider.oci'
    _inherit = 'liwan.mail.domain.provider'
    _description = 'LiwanOS tenant mail domain provider: OCI Email Delivery'

    @api.model
    def _liwan_configured(self):
        return all(os.environ.get(name) for name in REQUIRED_ENV)

    @api.model
    def _liwan_region(self):
        return os.environ.get(REGION_ENV) or DEFAULT_REGION

    @api.model
    def _liwan_call(self, method, url, body=None, params=None):
        """One signed call; the decoded JSON body (``{}`` when empty). Any failure is a ``MailProviderError`` with its status."""
        if not self._liwan_configured():
            msg = 'the mail provider is not configured'
            raise MailProviderError(msg)
        if params:
            url = f'{url}?{urlencode(params)}'
        payload = json.dumps(body).encode() if body is not None else None
        try:
            key = serialization.load_pem_private_key(os.environ[PRIVATE_KEY_ENV].replace('\\n', '\n').encode(), password=None)
        except ValueError:
            msg = 'the mail provider key is not a valid private key'
            raise MailProviderError(msg) from None
        key_id = f'{os.environ[TENANCY_ENV]}/{os.environ[USER_ENV]}/{os.environ[FINGERPRINT_ENV]}'
        headers = signed_headers(method, url, payload, key_id, key)
        try:
            # requests reads HTTPS_PROXY from the environment: the only route off the host is odoo-egress.
            response = requests.request(method, url, data=payload, headers=headers, timeout=TIMEOUT_SECONDS)
        except requests.RequestException as error:
            raise MailProviderError(f'the mail provider is unreachable ({type(error).__name__})') from None
        if response.status_code >= 400:
            raise MailProviderError(f'the mail provider refused the request ({response.status_code})', response.status_code)
        try:
            return response.json() if response.content else {}
        except ValueError:
            msg = 'the mail provider answered with a body that is not JSON'
            raise MailProviderError(msg, response.status_code) from None

    @api.model
    def _liwan_email(self, method, path, body=None, params=None):
        return self._liwan_call(method, EMAIL_API.format(region=self._liwan_region()) + path, body, params)

    @api.model
    def _liwan_delete(self, path):
        try:
            self._liwan_email('DELETE', path)
        except MailProviderError as error:
            if error.status != 404:
                raise

    @api.model
    def _liwan_selector(self):
        return f'liwan-{datetime.now(timezone.utc):%Y%m}'

    @api.model
    def _liwan_tags(self):
        """The tag every resource this database creates carries, so a retry adopts only its own resources."""
        return {DB_TAG: self.env['ir.config_parameter']._get_param('database.uuid')}

    @api.model
    def _liwan_ours(self, item):
        return (item.get('freeformTags') or {}).get(DB_TAG) == self._liwan_tags()[DB_TAG]

    @api.model
    def _liwan_find(self, path, params, match):
        """The first live resource of this database that a list call returns and whose fields equal ``match``, or ``None``.

        The server filter is not trusted: each field is compared here, and an untagged or foreign resource is never
        reused.
        """
        found = self._liwan_email('GET', path, params=params)
        items = found.get('items', []) if isinstance(found, dict) else found
        return next((
            item for item in items
            if item.get('lifecycleState') not in GONE
            and all(item.get(key) == value for key, value in match.items())
            and self._liwan_ours(item)
        ), None)

    @api.model
    def _liwan_create(self, path, body):
        return self._liwan_email('POST', path, {**body, 'freeformTags': self._liwan_tags()})

    @api.model
    def _liwan_create_email_domain(self, name, compartment):
        """POST the domain; on 409 adopt it only when this database created it (a lost answer), else it is taken."""
        try:
            return self._liwan_create('/emailDomains', {'name': name, 'compartmentId': compartment})
        except MailProviderError as error:
            if error.status != 409:
                raise
        own = self._liwan_find(
            '/emailDomains', {'compartmentId': compartment, 'name': name}, {'name': name, 'compartmentId': compartment},
        )
        if own:
            return own
        msg = 'the domain is already registered'
        raise MailDomainTaken(msg, 409)

    @api.model
    def create_domain(self, domain):
        """Each id is written on the row as soon as OCI returns it, and each child is looked up before it is created."""
        compartment = os.environ.get(COMPARTMENT_ENV)
        if not domain.provider_domain_id:
            domain.write({'provider_domain_id': self._liwan_create_email_domain(domain.domain, compartment)['id']})
        domain_id = domain.provider_domain_id
        if self._liwan_email('GET', f'/emailDomains/{domain_id}').get('lifecycleState') != ACTIVE:
            return
        if not domain.provider_dkim_id:
            dkim = self._liwan_find('/dkims', {'emailDomainId': domain_id}, {'emailDomainId': domain_id}) or self._liwan_create(
                '/dkims', {'name': self._liwan_selector(), 'emailDomainId': domain_id},
            )
            domain.write({'provider_dkim_id': dkim['id']})
        if not domain.provider_return_path_id:
            name = f'rp.{domain.domain}'
            path = self._liwan_find(
                '/emailReturnPaths', {'parentResourceId': domain_id, 'name': name}, {'parentResourceId': domain_id, 'name': name},
            )
            domain.write({
                'provider_return_path_id': path['id'] if path else self._liwan_create_return_path(domain.domain, domain_id),
                'return_path_created_at': fields.Datetime.now(),
            })
        if not domain.provider_sender_id:
            address = f'{domain.from_local_part}@{domain.domain}'
            sender = self._liwan_find(
                '/senders', {'compartmentId': compartment, 'emailAddress': address}, {'emailAddress': address},
            ) or self._liwan_create('/senders', {'compartmentId': compartment, 'emailAddress': address})
            domain.write({'provider_sender_id': sender['id']})
        if not domain.provider_log_id and os.environ.get(LOG_GROUP_ENV):
            log_id = self._liwan_delivery_log(domain.domain, domain_id)
            if log_id:
                domain.write({'provider_log_id': log_id})

    @api.model
    def _liwan_create_return_path(self, name, domain_id):
        return self._liwan_create('/emailReturnPaths', {'name': f'rp.{name}', 'parentResourceId': domain_id})['id']

    @api.model
    def _liwan_logs_url(self):
        return f'{LOGGING_API.format(region=self._liwan_region())}/logGroups/{os.environ[LOG_GROUP_ENV]}/logs'

    @api.model
    def _liwan_delivery_log(self, name, domain_id):
        """The id of the domain's delivery log, asking OCI to create it when it does not exist yet.

        CreateLog is asynchronous and answers no id, so the id is found by its display name on a later call.
        """
        display_name = f'liwan-{name}-{LOG_CATEGORY}'
        found = self._liwan_call('GET', self._liwan_logs_url(), params={'displayName': display_name})
        items = found.get('items', found if isinstance(found, list) else [])
        if items:
            return items[0]['id']
        self._liwan_call('POST', self._liwan_logs_url(), {
            'displayName': display_name,
            'logType': 'SERVICE',
            'isEnabled': True,
            'configuration': {
                'compartmentId': os.environ.get(COMPARTMENT_ENV),
                'source': {
                    'sourceType': 'OCISERVICE', 'service': 'emaildelivery',
                    'resource': domain_id, 'category': LOG_CATEGORY,
                },
            },
        })
        return None

    @api.model
    def read_records(self, domain):
        records = []
        if domain.provider_dkim_id:
            dkim = self._liwan_email('GET', f'/dkims/{domain.provider_dkim_id}')
            records.append({'kind': 'dkim', 'type': 'CNAME', 'name': dkim.get('dnsSubdomainName') or '',
                            'value': dkim.get('cnameRecordValue') or ''})
        records.append({'kind': 'spf', 'type': 'TXT', 'name': domain.domain,
                        'value': f'v=spf1 include:{os.environ.get(SPF_INCLUDE_ENV)} ~all'})
        if domain.provider_return_path_id:
            path = self._liwan_email('GET', f'/emailReturnPaths/{domain.provider_return_path_id}')
            records.append({'kind': 'return_path', 'type': 'CNAME', 'name': path.get('dnsSubdomainName') or '',
                            'value': path.get('cnameRecordValue') or ''})
        return records

    @api.model
    def check(self, domain):
        def state(path, resource_id):
            return self._liwan_email('GET', f'{path}/{resource_id}').get('lifecycleState') if resource_id else None

        email_domain = self._liwan_email('GET', f'/emailDomains/{domain.provider_domain_id}') if domain.provider_domain_id else {}
        return {
            'dkim': state('/dkims', domain.provider_dkim_id),
            'spf': bool(email_domain.get('isSpf')),
            'return_path': state('/emailReturnPaths', domain.provider_return_path_id),
        }

    @api.model
    def recreate_return_path(self, domain):
        if domain.provider_return_path_id:
            self._liwan_delete(f'/emailReturnPaths/{domain.provider_return_path_id}')
        return self._liwan_create_return_path(domain.domain, domain.provider_domain_id)

    @api.model
    def delete_domain(self, domain):
        if domain.provider_log_id and os.environ.get(LOG_GROUP_ENV):
            try:
                self._liwan_call('DELETE', f'{self._liwan_logs_url()}/{domain.provider_log_id}')
            except MailProviderError as error:
                if error.status != 404:
                    raise
        for path, resource_id in (
            ('/senders', domain.provider_sender_id),
            ('/emailReturnPaths', domain.provider_return_path_id),
            ('/dkims', domain.provider_dkim_id),
            ('/emailDomains', domain.provider_domain_id),
        ):
            if resource_id:
                self._liwan_delete(f'{path}/{resource_id}')

    @api.model
    def fetch_delivery_status(self, domain, message_ids, since):
        """Read the domain's delivery log. The query syntax and the log fields are unverified (see the module docstring)."""
        if not (message_ids and domain.provider_log_id and os.environ.get(LOG_GROUP_ENV)):
            return {}
        wanted = {_bare_message_id(message_id): message_id for message_id in message_ids}
        matches = ' or '.join(f"data.messageId = '{bare}'" for bare in wanted if "'" not in bare)
        source = f'{os.environ[COMPARTMENT_ENV]}/{os.environ[LOG_GROUP_ENV]}/{domain.provider_log_id}'
        found = self._liwan_call('POST', LOG_SEARCH_API.format(region=self._liwan_region()), {
            'timeStart': since.replace(tzinfo=timezone.utc).isoformat(),
            'timeEnd': datetime.now(timezone.utc).isoformat(),
            'searchQuery': f'search "{source}" | where {matches}',
            'isReturnFieldInfo': False,
        })
        statuses = {}
        for result in found.get('results', []):
            data = ((result.get('data') or {}).get('logContent') or {}).get('data') or {}
            message_id = wanted.get(_bare_message_id(data.get('messageId')))
            status = ACTION_STATUS.get((data.get('action') or '').lower())
            if status == 'bounced' and (data.get('bounceCategory') or '').lower() == 'soft':
                status = None
            if message_id and status:
                statuses[message_id] = status
        return statuses
