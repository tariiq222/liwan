# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

BATCH = 1000


def migrate(cr, version):
    """Give every stored delivery its channel-and-body dedupe key, so a replay of an old event is refused too."""
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    Event = env['liwan.inbox.event'].with_context(active_test=False)
    # The key is derived from the exact bytes Odoo stored as `payload`, which is what `_liwan_store` hashes, so a
    # re-delivery after the upgrade matches the row a previous delivery left. Two rows may carry one delivery
    # (concurrent retries before the key existed): the older keeps the key and the later one goes, because the
    # pair is one delivery and the unique key admits one row only.
    seen = set()
    rows = Event.search([('dedupe_key', '=', False)], order='id')
    for start in range(0, len(rows), BATCH):
        for event in rows[start:start + BATCH]:
            key = Event._liwan_dedupe_key(event.channel_id, event.payload.encode())
            if key in seen:
                event.unlink()
            else:
                event.write({'dedupe_key': key})
                seen.add(key)
        env.flush_all()
        # Each batch's payloads are read once and never again: drop the cache so a 1000-row batch does not keep
        # its event bodies loaded for the whole run.
        env.invalidate_all()
