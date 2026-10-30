# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The push of catalog items to Meta, the follow-up of its batches and of its item review (cron)."""
from odoo import api, fields, models

from .catalog_item import ERROR_TEXT_LENGTH
from .constants import REVIEW_REFRESH, SYNC_TIMEOUT
from odoo.addons.liwan_inbox.adapters.whatsapp import ProviderError
from odoo.addons.liwan_inbox.models.batch import process_each
from odoo.addons.liwan_inbox_payments.adapters import meta_catalog

REVIEW_STATUS = {'approved': 'approved', 'pending': 'pending', 'rejected': 'rejected'}


class LiwanInboxCatalogSync(models.Model):
    _inherit = 'liwan.inbox.catalog'

    @api.model
    def _liwan_run_sync(self):
        """Sync every catalog: a provider failure is recorded on the catalog and retried by the next run."""
        if not self._liwan_enabled():
            return
        process_each(self.search([]), lambda catalog: catalog._liwan_sync(), self._liwan_unexpected_failure)

    @api.model
    def _liwan_unexpected_failure(self, catalog, error):
        catalog._liwan_fail(type(error).__name__)

    def _liwan_fail(self, message):
        self.write({'state': 'error', 'last_error': message[:ERROR_TEXT_LENGTH]})

    def _liwan_sync(self):
        self.ensure_one()
        credentials = self._liwan_credentials()
        if not credentials:
            self._liwan_fail(self.env._('No connected channel with an access token.'))
            return
        try:
            more = self._liwan_push(credentials)
            self._liwan_poll(credentials)
            more = more or bool(self._liwan_items(('sync_state', 'in', ('pending', 'removing')), ('batch_handle', '=', False)))
            self._liwan_review(credentials)
        except ProviderError as error:
            self._liwan_fail(str(error))
            return
        self.write({'state': 'connected', 'last_error': False, 'last_sync_at': fields.Datetime.now()})
        if more:
            self._liwan_request_sync()

    def _liwan_items(self, *domain):
        return self.env['liwan.inbox.catalog.item'].with_context(active_test=False).search(
            [('catalog_id', '=', self.id), *domain], order='id',
        )

    def _liwan_push(self, credentials):
        """Send the pending and removing items in one batch; True when more are waiting for the next one."""
        waiting = self._liwan_items(('sync_state', 'in', ('pending', 'removing')), ('batch_handle', '=', False))
        channel = self._liwan_usable_channel()
        if waiting and not self.default_link and not channel.commerce_phone:
            # The click-to-chat link of an item with no page of its own names the number as customers see it.
            channel.commerce_phone = meta_catalog.get_display_phone(credentials) or False
        requests, sent = [], self.env['liwan.inbox.catalog.item']
        for item in waiting[:meta_catalog.MAX_BATCH]:
            request = item._liwan_request()
            if request:
                requests.append(request)
                sent |= item
        if requests:
            handle, errors = meta_catalog.items_batch(credentials, self.meta_catalog_id, requests)
            for item in sent:
                if item.retailer_id in errors:
                    item.write({'sync_state': 'error', 'sync_error': errors[item.retailer_id]})
                elif handle:
                    item.write({'sync_state': 'syncing', 'batch_handle': handle, 'sync_error': False})
                else:
                    item.write({'sync_state': 'error', 'sync_error': self.env._('Meta did not accept the batch.')})
        return len(waiting) > meta_catalog.MAX_BATCH

    def _liwan_poll(self, credentials):
        """Settle the items of every open batch: confirmed, or failed with the reason Meta gave for that item.

        An item changed while its batch was open keeps its new state (a removal, a relisting); a confirmed item whose
        data differs from what was pushed goes back to `pending`. A confirmed DELETE leaves the item off Meta.
        """
        in_flight = self._liwan_items(('batch_handle', '!=', False))
        now = fields.Datetime.now()
        for handle in sorted(set(in_flight.mapped('batch_handle'))):
            batch = in_flight.filtered(lambda item: item.batch_handle == handle)
            status, errors = meta_catalog.batch_status(credentials, self.meta_catalog_id, handle)
            if status not in (meta_catalog.FINISHED, meta_catalog.FAILED):
                for item in batch.filtered(lambda item: now - item.write_date > SYNC_TIMEOUT):
                    item._liwan_batch_failed(self.env._('Meta did not answer in time.'))
                continue
            for item in batch:
                if item.retailer_id in errors or status == meta_catalog.FAILED:
                    item._liwan_batch_failed(errors.get(item.retailer_id) or self.env._('The batch failed.'))
                else:
                    item._liwan_batch_confirmed(now)

    def _liwan_review(self, credentials):
        """Read Meta's review of the synced items still open and of the others once a day."""
        now = fields.Datetime.now()
        due = self._liwan_items(
            ('sync_state', '=', 'synced'), ('listed', '=', True), ('active', '=', True), ('synced_hash', '!=', False),
            '|', '|', ('review_status', 'in', ('pending', 'unknown')), ('reviewed_at', '=', False),
            ('reviewed_at', '<', now - REVIEW_REFRESH),
        )[:meta_catalog.REVIEW_PAGE]
        if not due:
            return
        reviews = meta_catalog.list_item_reviews(credentials, self.meta_catalog_id, due.mapped('retailer_id'))
        for item in due:
            word, reason = reviews.get(item.retailer_id, ('', None))
            item.write({
                'review_status': REVIEW_STATUS.get(word, 'unknown'), 'review_reason': reason or False, 'reviewed_at': now,
            })
