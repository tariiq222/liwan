# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError


class NasqPlatformIrBinary(models.AbstractModel):
    _inherit = 'ir.binary'

    def _find_record(self, xmlid=None, res_model='ir.attachment', res_id=None,
                     access_token=None, field=None):
        record = super()._find_record(
            xmlid=xmlid, res_model=res_model, res_id=res_id,
            access_token=access_token, field=field,
        )
        service = self.env['nasq.entitlement.service'].sudo()
        user = self.env.user
        if service._nasq_session_forbidden(user):
            msg = 'tenant_suspended'
            raise AccessError(msg)
        if (
            access_token
            and service._nasq_effective_state() == 'suspended'
            and not service._nasq_support_login_allowed(user)
            and not self._nasq_public_branding_record(record)
        ):
            msg = 'tenant_suspended'
            raise AccessError(msg)
        return record

    def _nasq_public_branding_record(self, record):
        if record._name == 'res.company':
            return True
        if record._name == 'ir.attachment':
            return record.res_model == 'res.company' and record.res_field in ('logo', 'logo_web')
        return False
