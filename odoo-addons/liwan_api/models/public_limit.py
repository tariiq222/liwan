# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models

# One minute is the window of every public per-link budget; an application states its own limit and scope.
PUBLIC_LIMIT_WINDOW = timedelta(minutes=1)
# A row idle for a day holds a window long turned, so the daily vacuum drops it (a record deleted without its row).
IDLE_ROW_AGE = timedelta(days=1)


class LiwanApiPublicLimit(models.Model):
    """The one counter behind every per-link rate limit of a public route.

    The edge limit counts client addresses, and one holder of a link answers from many, so a route that opens one
    record by a token keeps a budget per record here. A row is one ``(scope, res_id)`` pair: the scope names the budget
    (``<app>.<what>``, owned by the application that charges it) and ``res_id`` is the record it follows, with no foreign
    key because the owning application's model is not this layer's. A read past the budget the caller states is the
    caller's refusal; this model only counts. The key is never a token, so no secret is stored here.
    """
    _name = 'liwan.api.public.limit'
    _description = 'Public route read counter'
    # A counter of one record's public reads, not company data: it follows the record, not a company.
    _liwan_scope = 'global'

    scope = fields.Char(required=True)
    res_id = fields.Integer(required=True)
    window_start = fields.Datetime(required=True)
    reads = fields.Integer(required=True, default=0)

    _scope_unique = models.Constraint('UNIQUE(scope, res_id)', 'a record has one public read counter per scope')

    @api.model
    def _liwan_count_read(self, scope, res_id, now=None):
        """Charge one public read of record ``res_id`` to budget ``scope`` and return the count inside the current window.

        One statement does the work, so two concurrent reads cannot both enter the window at a count inside the limit.
        The row is our own table, created here and locked by the statement itself, so the caller needs no access to it;
        a record without a row for this scope starts its window here, at one.
        """
        now = now or fields.Datetime.now()
        turned = now - PUBLIC_LIMIT_WINDOW
        self.env.cr.execute(
            """
            INSERT INTO liwan_api_public_limit (scope, res_id, window_start, reads)
            VALUES (%s, %s, %s, 1)
            ON CONFLICT (scope, res_id) DO UPDATE
            SET reads = CASE WHEN liwan_api_public_limit.window_start <= %s THEN 1
                             ELSE liwan_api_public_limit.reads + 1 END,
                window_start = CASE WHEN liwan_api_public_limit.window_start <= %s THEN %s
                                    ELSE liwan_api_public_limit.window_start END
            RETURNING reads
            """,
            [scope, res_id, now, turned, turned, now],
        )
        return self.env.cr.fetchone()[0]

    @api.autovacuum
    def _gc_idle_counters(self):
        self.search([('window_start', '<', fields.Datetime.now() - IDLE_ROW_AGE)]).unlink()
