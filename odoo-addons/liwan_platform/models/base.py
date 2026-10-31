# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

# Set by api_handler on a writing /api/v1 request: the text values the caller sent. An edit made in the UI is
# one name for everyone, so a translated field written with one of those texts is stored for every installed
# language. Text the server writes itself (seeded translations, presets) is not in the list and stays as written.
MIRROR_CONTEXT = 'liwan_mirror_texts'


class LiwanBase(models.AbstractModel):
    _inherit = 'base'

    def write(self, vals):
        result = super().write(vals)
        self._liwan_mirror_translations(vals)
        return result

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for record, vals in zip(records, vals_list, strict=True):
            record._liwan_mirror_translations(vals)
        return records

    def _liwan_mirror_translations(self, vals):
        """Store each translated text the caller sent under every other installed language.

        The copy goes through the stock ``write`` of the base model only (``super(LiwanBase, ...)``), so
        the overrides of the model itself (versions, tracking, side effects) run once, for the real edit.
        """
        sent = self.env.context.get(MIRROR_CONTEXT)
        if not sent or not self:
            return
        texts = {
            name: value for name, value in vals.items()
            if (field := self._fields.get(name)) is not None and field.translate is True
            and isinstance(value, str) and value.strip() in sent
        }
        if not texts:
            return
        for code, _name in self.env['res.lang'].get_installed():
            if code != self.env.lang:
                super(LiwanBase, self.with_context(lang=code, **{MIRROR_CONTEXT: ()})).write(texts)
