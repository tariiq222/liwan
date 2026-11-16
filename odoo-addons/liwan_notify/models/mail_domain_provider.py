# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class MailProviderError(Exception):
    """A provider call failed. The message never carries a key, a signature or a recipient address."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class MailDomainTaken(MailProviderError):
    """The provider already holds this domain, for this tenant or another one; who holds it is never told."""


class LiwanMailDomainProvider(models.AbstractModel):
    """The sending provider of tenant domains: the interface ``liwan.mail.domain`` calls and never more.

    Every method takes the ``liwan.mail.domain`` row; ``create_domain`` writes the ids it creates on it, the others return plain values.
    Provider ids live on the row as ``provider_domain_id``, ``provider_dkim_id``, ``provider_return_path_id``,
    ``provider_sender_id`` and ``provider_log_id``. A failure raises ``MailProviderError`` (or
    ``MailDomainTaken`` from ``create_domain``).
    """
    _name = 'liwan.mail.domain.provider'
    _description = 'LiwanOS tenant mail domain provider'
    _liwan_scope = 'global'

    @api.model
    def _liwan_configured(self):
        """True when the operator configuration this provider needs is present."""
        raise NotImplementedError

    @api.model
    def create_domain(self, domain):
        """Create what is still missing for ``domain``, writing each provider id on the row as soon as it exists.

        Creation is asynchronous at the provider: a child resource is created only once its parent is active, so a
        later call (the verify cron) carries on where this one stopped. A retry finds a child an earlier call created
        before creating it again, so a failure part way never leaves a duplicate or a lost id.
        """
        raise NotImplementedError

    @api.model
    def read_records(self, domain):
        """The DNS records the tenant must add: ``[{kind, type, name, value}]`` for the resources that exist."""
        raise NotImplementedError

    @api.model
    def check(self, domain):
        """``{'dkim': state, 'spf': bool, 'return_path': state}`` with the provider's lifecycle states, or ``None`` each."""
        raise NotImplementedError

    @api.model
    def recreate_return_path(self, domain):
        """Delete the return path of ``domain`` and create it again; return its new id."""
        raise NotImplementedError

    @api.model
    def delete_domain(self, domain):
        """Delete every provider resource of ``domain``; a resource already gone is not an error."""
        raise NotImplementedError

    @api.model
    def fetch_delivery_status(self, domain, message_ids, since):
        """``{message_id: status}`` for the given Message-Ids sent since ``since``, with ``liwan_provider_status`` values."""
        raise NotImplementedError
