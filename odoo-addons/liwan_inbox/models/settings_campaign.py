# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The campaign policy of a company: who may be messaged, number format, and the stop and start keywords."""
from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .campaign_constants import (
    CONSENT_POLICIES,
    DEFAULT_KEYWORDS,
    DEFAULT_START_REPLY,
    DEFAULT_STOP_REPLY,
    MAX_DAILY_CAP,
)
from .normalization import normalize_text

MAX_REPLY_LENGTH = 1024


class LiwanInboxSettingsCampaign(models.Model):
    _inherit = 'liwan.inbox.settings'

    consent_policy = fields.Selection(CONSENT_POLICIES, required=True, default='opted_in_only')
    # Turns the local numbers of a contact import (a leading 0) into international ones; empty: imports need international numbers.
    default_country_code = fields.Char(size=3)
    keyword_opt_out = fields.Boolean(default=True)
    # The confirmation sent back to a customer who stopped or resumed marketing; empty sends none.
    stop_reply = fields.Text()
    start_reply = fields.Text()
    default_daily_cap = fields.Integer(default=0, help='The daily cap a new campaign starts with; 0 means only Meta\'s messaging limit.')

    @api.constrains('default_country_code', 'default_daily_cap', 'stop_reply', 'start_reply')
    def _check_campaign_values(self):
        for settings in self:
            code = settings.default_country_code
            if code and not (code.isdigit() and not code.startswith('0')):
                raise ValidationError(self.env._('default_country_code must be one to three digits without a leading zero.'))
            if not 0 <= settings.default_daily_cap <= MAX_DAILY_CAP:
                raise ValidationError(self.env._('default_daily_cap must be between 0 and %(max)s', max=MAX_DAILY_CAP))
            if any(len(text or '') > MAX_REPLY_LENGTH for text in (settings.stop_reply, settings.start_reply)):
                raise ValidationError(self.env._('A confirmation reply is at most %(max)s characters.', max=MAX_REPLY_LENGTH))

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [
            {'stop_reply': DEFAULT_STOP_REPLY, 'start_reply': DEFAULT_START_REPLY, **vals} for vals in vals_list
        ]
        settings = super().create(vals_list)
        for row in settings:
            row._liwan_add_keywords({kind: list(words) for kind, words in DEFAULT_KEYWORDS.items()})
        return settings

    def _liwan_keywords(self, kind):
        self.ensure_one()
        return self.env['liwan.inbox.opt.keyword'].search([('company_id', '=', self.company_id.id), ('kind', '=', kind)])

    def _liwan_add_keywords(self, words_by_kind):
        """Add the keywords the company does not have yet (compared normalized), per kind."""
        self.ensure_one()
        Keyword = self.env['liwan.inbox.opt.keyword']
        for kind, words in words_by_kind.items():
            known = set(self._liwan_keywords(kind).mapped('normalized'))
            fresh = {}
            for word in words:
                normalized = normalize_text(word)
                if normalized and normalized not in known:
                    fresh[normalized] = word
            Keyword.create([
                {'company_id': self.company_id.id, 'kind': kind, 'value': word} for word in fresh.values()
            ])

    def _liwan_replace_keywords(self, words_by_kind):
        """Make the company's keywords of each given kind exactly the given words (removals first, so a word may change kind)."""
        self.ensure_one()
        for kind, words in words_by_kind.items():
            wanted = {normalize_text(word) for word in words}
            self._liwan_keywords(kind).filtered(lambda keyword: keyword.normalized not in wanted).unlink()
        self._liwan_add_keywords(words_by_kind)

    def _liwan_fill_campaigns(self, campaigns):
        """A sector preset: add the keywords the company lacks and set the confirmation replies that are empty or still the default text."""
        self.ensure_one()
        self._liwan_add_keywords({kind: campaigns.get(f'{kind}_keywords', []) for kind in ('stop', 'start')})
        for field, default in (('stop_reply', DEFAULT_STOP_REPLY), ('start_reply', DEFAULT_START_REPLY)):
            if self[field] in (False, default) and campaigns.get(field):
                self[field] = campaigns[field]
