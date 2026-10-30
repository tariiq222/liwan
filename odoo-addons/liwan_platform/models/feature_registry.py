# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import ValidationError

FEATURE_TYPES = ('boolean', 'limit')


class LiwanFeatureRegistry(models.AbstractModel):
    _name = 'liwan.feature.registry'
    _description = 'LiwanOS feature and module registry'
    _liwan_scope = 'global'

    @api.model
    def _liwan_feature_definitions(self):
        """Pure descriptors composed through super(); never a process-global set."""
        return (
            {
                'key': 'users.limit',
                'type': 'limit',
                'owner': 'liwan_platform',
                'module': 'liwan_platform',
            },
            {
                'key': 'storage.limit_mb',
                'type': 'limit',
                'owner': 'liwan_platform',
                'module': 'liwan_platform',
            },
            {
                'key': 'branches.extra_limit',
                'type': 'limit',
                'owner': 'liwan_platform',
                'module': 'liwan_platform',
            },
        )

    @api.model
    def _liwan_module_definitions(self):
        return ()

    @api.model
    def _liwan_validate_definitions(self, definitions, kind):
        seen = {}
        for item in definitions:
            key = item.get('key') if kind == 'feature' else item.get('id')
            if not key or not isinstance(key, str):
                raise ValidationError(self.env._(
                    'liwan_platform: %(kind)s definition is missing an id',
                    kind=kind,
                ))
            if key in seen:
                raise ValidationError(self.env._(
                    'liwan_platform: duplicate %(kind)s key %(key)s',
                    kind=kind, key=key,
                ))
            seen[key] = item
            if kind == 'feature':
                if item.get('type') not in FEATURE_TYPES:
                    raise ValidationError(self.env._(
                        'liwan_platform: feature %(key)s has invalid type',
                        key=key,
                    ))
                if not item.get('owner') or not item.get('module'):
                    raise ValidationError(self.env._(
                        'liwan_platform: feature %(key)s is missing owner or module',
                        key=key,
                    ))
        return seen

    @api.model
    def _liwan_feature_map(self):
        definitions = self._liwan_feature_definitions()
        return self._liwan_validate_definitions(definitions, 'feature')

    @api.model
    def _liwan_module_map(self):
        definitions = self._liwan_module_definitions()
        return self._liwan_validate_definitions(definitions, 'module')

    @api.model
    def _liwan_installed_module_ids(self):
        declared = tuple(self._liwan_module_map())
        if not declared:
            return ()
        # The stock cached map of installed modules: it serves every caller, including the public
        # user of a feature-gated public route, who has no read access to ir.module.module.
        installed = self.env['ir.module.module']._installed()
        return tuple(module_id for module_id in sorted(declared) if module_id in installed)

    @api.model
    def _liwan_boolean_keys(self):
        return tuple(
            key for key, item in self._liwan_feature_map().items()
            if item['type'] == 'boolean'
        )

    @api.model
    def _liwan_limit_keys(self):
        return tuple(
            key for key, item in self._liwan_feature_map().items()
            if item['type'] == 'limit'
        )
