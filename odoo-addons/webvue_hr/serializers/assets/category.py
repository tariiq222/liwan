# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_hr.serializers.assets.common import ref, reject_unknown


def dump_categories(categories):
    """The category catalog is a list of ``{id, name}`` references."""
    return [ref(category) for category in categories]


def parse_category_vals(payload):
    reject_unknown(payload, ('name',))
    name = payload.get('name')
    if not isinstance(name, str) or not name.strip():
        raise ApiError(422, 'invalid', 'name must not be empty', field='name')
    return {'name': name.strip()}
