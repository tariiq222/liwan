# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class DocumentsTenantProfile(models.Model):
    _inherit = 'liwan.tenant.profile'

    def write(self, values):
        result = super().write(values)
        if {'features', 'retained_read_features', 'status', 'valid_until',
                'support_access_enabled'}.intersection(values):
            # Managed DMS/attachment rule domains contain actor-visible document
            # IDs. Policy changes must invalidate domains in this transaction and
            # after commit so persistent HTTP workers observe reopen/revoke alike.
            registry = self.env.registry
            registry.clear_cache()

            def publish_policy():
                registry.clear_cache()
                # Local operator CLI paths may commit without the HTTP service's
                # final signaling step. Notify persistent workers after commit.
                if registry.ready:
                    registry.signal_changes()

            self.env.cr.postcommit.add(publish_policy)
        return result
