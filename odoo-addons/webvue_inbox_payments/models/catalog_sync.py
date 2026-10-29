# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The push of catalog items to Meta, the follow-up of its batches and of its item review (cron)."""
from odoo import api, fields, models

from .catalog_item import ERROR_TEXT_LENGTH
from .constants import REVIEW_REFRESH, SYNC_TIMEOUT
from odoo.addons.webvue_inbox.adapters.whatsapp import ProviderError
from odoo.addons.webvue_inbox.models.batch import process_each
from odoo.addons.webvue_inbox_payments.adapters import meta_catalog

REVIEW_STATUS = {'approved': 'approved', 'pending': 'pending', 'rejected': 'rejected'}


class WebVueInboxCatalogSync(models.Model):
    _inherit = 'webvue.inbox.catalog'

    @api.model
    def _webvue_run_sync(self):
        """Sync every catalog: a provider failure is recorded on the catalog and retried by the next run."""
        process_each(self.search([]), lambda catalog: catalog._webvue_sync(), self._webvue_unexpected_failure)

    @api.model
    def _webvue_unexpected_failure(self, catalog, error):
        catalog._webvue_fail(type(error).__name__)

    def _webvue_fail(self, message):
        self.write({'state': 'error', 'last_error': message[:ERROR_TEXT_LENGTH]})

    def _webvue_sync(self):
        self.ensure_one()
        credentials = self._webvue_credentials()
        if not credentials:
            self._webvue_fail(self.env._('No connected channel with an access token.'))
            return
        try:
            more = self._webvue_push(credentials)
            self._webvue_poll(credentials)
            self._webvue_review(credentials)
        except ProviderError as error:
            self._webvue_fail(str(error))
            return
        self.write({'state': 'connected', 'last_error': False, 'last_sync_at': fields.Datetime.now()})
        if more:
            self._webvue_request_sync()

    def _webvue_items(self, *domain):
        return self.env['webvue.inbox.catalog.item'].with_context(active_test=False).search(
            [('catalog_id', '=', self.id), *domain], order='id',
        )

    def _webvue_push(self, credentials):
        """Send the pending and removing items in one batch; True when more are waiting for the next one."""
        waiting = self._webvue_items(('sync_state', 'in', ('pending', 'removing')))
        channel = self._webvue_usable_channel()
        if waiting and not self.default_link and not channel.commerce_phone:
            # The click-to-chat link of an item with no page of its own names the number as customers see it.
            channel.commerce_phone = meta_catalog.get_display_phone(credentials) or False
        requests, sent = [], self.env['webvue.inbox.catalog.item']
        for item in waiting[:meta_catalog.MAX_BATCH]:
            request = item._webvue_request()
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

    def _webvue_poll(self, credentials):
        """Settle the items of every open batch: synced, or failed with the reason Meta gave for that item."""
        syncing = self._webvue_items(('sync_state', '=', 'syncing'))
        now = fields.Datetime.now()
        for handle in sorted(set(syncing.mapped('batch_handle'))):
            batch = syncing.filtered(lambda item: item.batch_handle == handle)
            status, errors = meta_catalog.batch_status(credentials, self.meta_catalog_id, handle)
            if status not in (meta_catalog.FINISHED, meta_catalog.FAILED):
                batch.filtered(lambda item: now - item.write_date > SYNC_TIMEOUT).write({
                    'sync_state': 'error', 'sync_error': self.env._('Meta did not answer in time.'),
                })
                continue
            for item in batch:
                if item.retailer_id in errors or status == meta_catalog.FAILED:
                    item.write({
                        'sync_state': 'error', 'batch_handle': False,
                        'sync_error': errors.get(item.retailer_id) or self.env._('The batch failed.'),
                    })
                elif item.listed and item.active:
                    item.write({
                        'sync_state': 'synced', 'synced_hash': item.pushed_hash, 'last_synced_at': now,
                        'batch_handle': False, 'sync_error': False, 'review_status': 'pending', 'review_reason': False,
                        'reviewed_at': False,
                    })
                else:
                    item._webvue_removed()

    def _webvue_review(self, credentials):
        """Read Meta's review of the synced items still open and of the others once a day."""
        now = fields.Datetime.now()
        due = self._webvue_items(
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
