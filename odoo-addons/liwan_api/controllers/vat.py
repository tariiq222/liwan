# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import ApiError


def check_vat(country, vat, name, *, required=False):
    """Odoo's own VAT check for ``country`` (base_vat; each country's own number format).

    A number only saved is checked where ``base_vat`` is installed. A number a registration relies on (``required``)
    is refused where it is not: with no checker any text would pass, so the request fails closed.
    """
    if not (vat and country):
        return
    if not request.env['res.company']._liwan_vat_number_is_checked():
        if required:
            raise ApiError(
                422, 'vat_check_unavailable',
                'تعذّر التحقق من الرقم الضريبي في هذا التثبيت، فلا يمكن تسجيل الشركة في ضريبة القيمة المضافة.', field='vat',
            )
        return
    try:
        request.env['res.partner']._run_vat_checks(country, vat, name)
    except ValidationError:
        raise ApiError(422, 'invalid_vat', 'الرقم الضريبي غير صحيح لدولة الشركة.', field='vat') from None
