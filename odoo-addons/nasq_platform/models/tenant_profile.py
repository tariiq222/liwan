# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.nasq_platform.commercial_config import SOURCES, load_classification
from odoo.addons.nasq_platform.models.entitlement_service import (
    OPERATOR_CONTEXT,
    POLICY_FIELDS,
)


class NasqTenantProfile(models.Model):
    _name = 'nasq.tenant.profile'
    _description = 'Nasq tenant profile'
    _nasq_scope = 'tenant'

    singleton_key = fields.Char(default='tenant', required=True)
    root_company_id = fields.Many2one(
        'res.company', required=True, ondelete='restrict', index=True,
    )
    commercial_mode = fields.Selection(
        [('saas', 'SaaS'), ('non_saas', 'Independent')], required=True,
    )
    entitlement_source = fields.Selection(
        [('control_plane', 'Control plane'), ('local_policy', 'Local policy')], required=True,
    )
    _commercial_pair = models.Constraint(
        "CHECK ((commercial_mode = 'saas' AND entitlement_source = 'control_plane') "
        "OR (commercial_mode = 'non_saas' AND entitlement_source = 'local_policy'))",
        'nasq commercial mode and entitlement source must match',
    )
    _independent_cutoff = models.Constraint(
        "CHECK (commercial_mode != 'non_saas' OR valid_until IS NULL)",
        'independent installations cannot have a subscription expiry',
    )

    solution = fields.Char()
    tier = fields.Char()
    status = fields.Selection(
        [('active', 'Active'), ('suspended', 'Suspended')],
        default='active', required=True,
    )
    valid_until = fields.Date()
    features = fields.Json()
    retained_read_features = fields.Json()
    terminology = fields.Json()
    policy_revision = fields.Integer(default=0, required=True)
    quota_revision = fields.Integer(default=0, required=True)
    support_access_enabled = fields.Boolean(default=True, required=True)

    _singleton = models.Constraint(
        'UNIQUE(singleton_key)',
        'nasq tenant profile is a singleton',
    )
    _singleton_key = models.Constraint(
        "CHECK(singleton_key = 'tenant')",
        "nasq tenant profile only accepts the 'tenant' key",
    )
    _policy_revision_positive = models.Constraint(
        'CHECK(policy_revision >= 0)',
        'nasq tenant policy revision cannot be negative',
    )
    _quota_revision_positive = models.Constraint(
        'CHECK(quota_revision >= 0)',
        'nasq tenant quota revision cannot be negative',
    )

    @api.model
    def _nasq_xmlid_vals(self, profile):
        return {
            'module': 'nasq_platform',
            'name': 'tenant_profile',
            'model': 'nasq.tenant.profile',
            'res_id': profile.id,
            'noupdate': True,
        }

    @api.model
    def _nasq_ensure_xmlid(self, profile):
        existing = self.env.ref('nasq_platform.tenant_profile', raise_if_not_found=False)
        if existing:
            if existing != profile:
                raise ValidationError(self.env._(
                    'nasq_platform: tenant_profile xmlid points at a different record.',
                ))
            return existing
        self.env['ir.model.data'].create(self._nasq_xmlid_vals(profile))
        return profile

    @api.model
    def _nasq_ensure_root_company(self):
        existing = self.search([], limit=2)
        if existing:
            if len(existing) != 1:
                raise ValidationError(self.env._(
                    'nasq_platform: multiple tenant profiles exist; refuse to guess.',
                ))
            self._nasq_ensure_xmlid(existing)
            return existing
        self.env.cr.execute(
            'SELECT id, name FROM res_company WHERE parent_id IS NULL ORDER BY id',
        )
        roots = self.env.cr.fetchall()
        if len(roots) != 1:
            names = ', '.join(f'{row[0]}:{row[1]}' for row in roots) or '(none)'
            raise ValidationError(self.env._(
                'nasq_platform: cannot guess root company; found %(count)s roots (%(names)s). '
                'Set nasq.tenant.profile.root_company_id explicitly.',
                count=len(roots),
                names=names,
            ))
        profile = self.create({
            'singleton_key': 'tenant',
            'root_company_id': roots[0][0],
        })
        self._nasq_ensure_xmlid(profile)
        return profile

    @api.model
    def _nasq_policy_initialized(self, profile=None):
        profile = profile or self.search([], limit=1)
        return bool(profile and profile.policy_revision >= 1 and profile.features)

    @api.model
    def _nasq_initialize_legacy_policy(self, selected_modules):
        """One-shot grants for a freshly installed product. Never rewrites a configured tenant."""
        profile = self._nasq_ensure_root_company()
        if self._nasq_policy_initialized(profile):
            return profile
        unknown = set(selected_modules) - {'nasq_pmo', 'nasq_hr', 'nasq_chat'}
        if unknown:
            raise ValidationError(self.env._(
                'nasq_platform: unknown selected modules %(modules)s',
                modules=', '.join(sorted(unknown)),
            ))
        service = self.env['nasq.entitlement.service']
        features = service._nasq_legacy_features_for(selected_modules)
        retained = [
            key for key, value in features.items()
            if value is True
        ]
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'status': 'active',
            'valid_until': False,
            'features': features,
            'retained_read_features': retained,
            'terminology': {},
            'support_access_enabled': True,
            'policy_revision': 1,
            'quota_revision': profile.quota_revision or 0,
        })
        return profile

    def _nasq_lock(self):
        self.ensure_one()
        self.env.cr.execute(
            'SELECT id FROM nasq_tenant_profile WHERE id = %s FOR UPDATE',
            [self.id],
        )
        self.invalidate_recordset()
        return self.browse(self.id)

    def _nasq_bump_quota_revision(self):
        self.ensure_one()
        locked = self._nasq_lock()
        locked.with_context(**{OPERATOR_CONTEXT: True}).write({
            'quota_revision': locked.quota_revision + 1,
        })
        return locked.quota_revision

    def _nasq_require_policy_source(self, source):
        """Internal service boundary, never an RPC or caller-supplied context grant."""
        self.ensure_one()
        if not self.env.su:
            raise AccessError(self.env._('A trusted local operator is required.'))
        if source not in SOURCES.values() or self.entitlement_source != source:
            raise AccessError(self.env._('Policy source is not permitted for this installation.'))
        return True

    @api.constrains('commercial_mode', 'entitlement_source', 'valid_until')
    def _nasq_check_commercial_mode(self):
        for record in self:
            if SOURCES.get(record.commercial_mode) != record.entitlement_source:
                raise ValidationError(self.env._('Commercial mode and policy source must match.'))
            if record.commercial_mode == 'non_saas' and record.valid_until:
                raise ValidationError(self.env._('Independent installations cannot have a subscription expiry.'))

    @api.model_create_multi
    def create(self, vals_list):
        if self.search([], limit=1) or len(vals_list) != 1:
            raise ValidationError(self.env._('nasq tenant profile is a singleton.'))
        if not self.env.su:
            raise AccessError(self.env._('A trusted local operator is required.'))
        vals = dict(vals_list[0])
        classification = load_classification(self.env.cr.dbname, fields.Date.to_date(vals.get('valid_until')))
        for key in ('commercial_mode', 'entitlement_source'):
            if key in vals and vals[key] != classification[key]:
                raise ValidationError(self.env._('Classification differs from the local operator input.'))
            vals[key] = classification[key]
        if classification['clear_valid_until']:
            vals['valid_until'] = False
        vals.setdefault('status', 'active')
        vals.setdefault('support_access_enabled', True)
        vals.setdefault('policy_revision', 0)
        vals.setdefault('quota_revision', 0)
        vals.setdefault('features', {})
        vals.setdefault('retained_read_features', [])
        vals.setdefault('terminology', {})
        return super().create([vals])

    def write(self, vals):
        if {'commercial_mode', 'entitlement_source'}.intersection(vals):
            raise AccessError(self.env._('Commercial classification is immutable; conversion requires a separate procedure.'))
        if vals.get('valid_until') and any(record.commercial_mode == 'non_saas' for record in self):
            raise ValidationError(self.env._('Independent installations cannot have a subscription expiry.'))
        policy_keys = POLICY_FIELDS.intersection(vals)
        trusted = self.env.su and self.env.context.get(OPERATOR_CONTEXT)
        if policy_keys and not trusted:
            raise AccessError(self.env._(
                'nasq tenant policy can only be changed by a trusted operator.',
            ))
        if not policy_keys:
            return super().write(vals)
        if len(self) != 1:
            raise ValidationError(self.env._('nasq tenant profile is a singleton.'))
        service = self.env['nasq.entitlement.service']
        next_vals = dict(vals)
        if 'status' in next_vals and next_vals['status'] not in ('active', 'suspended'):
            raise ValidationError(self.env._('nasq_platform: status must be active or suspended'))
        if 'features' in next_vals:
            next_vals['features'] = service._nasq_validate_features(next_vals['features'])
            previous = self.retained_read_features or []
            if 'retained_read_features' in next_vals:
                retained = service._nasq_validate_retained(
                    next_vals['retained_read_features'], next_vals['features'],
                )
            else:
                retained = service._nasq_merge_retained(previous, next_vals['features'])
            next_vals['retained_read_features'] = retained
        elif 'retained_read_features' in next_vals:
            next_vals['retained_read_features'] = service._nasq_validate_retained(
                next_vals['retained_read_features'], self.features or {},
            )
        if 'terminology' in next_vals:
            next_vals['terminology'] = service._nasq_validate_terminology(next_vals['terminology'])
        policy_touch = set(next_vals) & (
            POLICY_FIELDS - {'quota_revision', 'policy_revision'}
        )
        if policy_touch and 'policy_revision' not in next_vals:
            next_vals['policy_revision'] = (self.policy_revision or 0) + 1
        if 'policy_revision' in next_vals and next_vals['policy_revision'] < 0:
            raise ValidationError(self.env._('nasq_platform: revisions cannot be negative'))
        if 'quota_revision' in next_vals and next_vals['quota_revision'] < 0:
            raise ValidationError(self.env._('nasq_platform: revisions cannot be negative'))
        return super().write(next_vals)

    def unlink(self):
        raise ValidationError(self.env._('nasq tenant profile cannot be deleted.'))
