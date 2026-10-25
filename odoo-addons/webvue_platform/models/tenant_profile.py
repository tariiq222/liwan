# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from odoo.addons.webvue_platform.commercial_config import SOURCES, load_classification
from odoo.addons.webvue_platform.models.entitlement_service import (
    OPERATOR_CONTEXT,
    POLICY_FIELDS,
)

_logger = logging.getLogger(__name__)


class WebVueTenantProfile(models.Model):
    _name = 'webvue.tenant.profile'
    _description = 'WebVue tenant profile'
    _webvue_scope = 'tenant'

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
        'webvue commercial mode and entitlement source must match',
    )
    _independent_cutoff = models.Constraint(
        "CHECK (commercial_mode != 'non_saas' OR valid_until IS NULL)",
        'independent installations cannot have a subscription expiry',
    )
    _independent_commercial_cutoff = models.Constraint(
        "CHECK (commercial_mode != 'non_saas' OR commercial_valid_until IS NULL)",
        'independent installations cannot have a commercial subscription expiry',
    )

    solution = fields.Char()
    tier = fields.Char()
    status = fields.Selection(
        [('active', 'Active'), ('suspended', 'Suspended')],
        default='active', required=True,
    )
    valid_until = fields.Date()
    # Commercial subscription expiry, written by the control plane; separate from the
    # classification cutoff `valid_until`, which stays the operator/migration record.
    commercial_valid_until = fields.Date()
    features = fields.Json()
    retained_read_features = fields.Json()
    terminology = fields.Json()
    policy_revision = fields.Integer(default=0, required=True)
    quota_revision = fields.Integer(default=0, required=True)
    support_access_enabled = fields.Boolean(default=True, required=True)
    commercial_revision_id = fields.Char()
    commercial_digest = fields.Char()
    commercial_applied_at = fields.Datetime()

    _singleton = models.Constraint(
        'UNIQUE(singleton_key)',
        'webvue tenant profile is a singleton',
    )
    _singleton_key = models.Constraint(
        "CHECK(singleton_key = 'tenant')",
        "webvue tenant profile only accepts the 'tenant' key",
    )
    _policy_revision_positive = models.Constraint(
        'CHECK(policy_revision >= 0)',
        'webvue tenant policy revision cannot be negative',
    )
    _quota_revision_positive = models.Constraint(
        'CHECK(quota_revision >= 0)',
        'webvue tenant quota revision cannot be negative',
    )

    @api.model
    def _webvue_xmlid_vals(self, profile):
        return {
            'module': 'webvue_platform',
            'name': 'tenant_profile',
            'model': 'webvue.tenant.profile',
            'res_id': profile.id,
            'noupdate': True,
        }

    @api.model
    def _webvue_ensure_xmlid(self, profile):
        existing = self.env.ref('webvue_platform.tenant_profile', raise_if_not_found=False)
        if existing:
            if existing != profile:
                raise ValidationError(self.env._(
                    'webvue_platform: tenant_profile xmlid points at a different record.',
                ))
            return existing
        self.env['ir.model.data'].create(self._webvue_xmlid_vals(profile))
        return profile

    @api.model
    def _webvue_ensure_root_company(self):
        existing = self.search([], limit=2)
        if existing:
            if len(existing) != 1:
                raise ValidationError(self.env._(
                    'webvue_platform: multiple tenant profiles exist; refuse to guess.',
                ))
            self._webvue_ensure_xmlid(existing)
            return existing
        self.env.cr.execute(
            'SELECT id, name FROM res_company WHERE parent_id IS NULL ORDER BY id',
        )
        roots = self.env.cr.fetchall()
        if len(roots) != 1:
            names = ', '.join(f'{row[0]}:{row[1]}' for row in roots) or '(none)'
            raise ValidationError(self.env._(
                'webvue_platform: cannot guess root company; found %(count)s roots (%(names)s). '
                'Set webvue.tenant.profile.root_company_id explicitly.',
                count=len(roots),
                names=names,
            ))
        profile = self.create({
            'singleton_key': 'tenant',
            'root_company_id': roots[0][0],
        })
        self._webvue_ensure_xmlid(profile)
        return profile

    @api.model
    def _webvue_policy_initialized(self, profile=None):
        profile = profile or self.search([], limit=1)
        return bool(profile and profile.policy_revision >= 1 and profile.features)

    @api.model
    def _webvue_initialize_legacy_policy(self, selected_modules):
        """One-shot grants for a freshly installed product. Never rewrites a configured tenant."""
        profile = self._webvue_ensure_root_company()
        if self._webvue_policy_initialized(profile):
            return profile
        unknown = set(selected_modules) - set(self.env['webvue.feature.registry']._webvue_module_map())
        if unknown:
            raise ValidationError(self.env._(
                'webvue_platform: unknown selected modules %(modules)s',
                modules=', '.join(sorted(unknown)),
            ))
        service = self.env['webvue.entitlement.service']
        features = service._webvue_legacy_features_for(selected_modules)
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

    def _register_hook(self):
        super()._register_hook()
        self._webvue_register_missing_features()

    @api.model
    def _webvue_register_missing_features(self):
        """Close, in the stored policy, every installed application key it lacks.

        Runs once per registry load, so an application installed (or a key an
        application adds in an upgrade) after the tenant's one-shot policy gets
        its default-closed value once, and the next full policy write is not
        refused for omitting it. It never grants and never changes a stored
        value. An uninitialized tenant is left to its first policy write; a
        policy that cannot be completed (a new platform key needs a migration)
        is logged and left unchanged rather than stopping the server.
        """
        try:
            return self._webvue_register_missing_features_unguarded()
        except ValidationError as error:
            _logger.warning('webvue_platform: the stored policy cannot take its closed keys: %s', error)
        except Exception:
            _logger.warning('webvue_platform: closed application keys were not registered', exc_info=True)
        return False

    @api.model
    def _webvue_register_missing_features_unguarded(self):
        profiles = self.search([], limit=2)
        if len(profiles) != 1 or not self._webvue_policy_initialized(profiles):
            return False
        service = self.env['webvue.entitlement.service']
        with self.env.cr.savepoint():
            # Unlocked fast path: nothing missing means no lock and no write. It
            # reads inside the savepoint so a failing read cannot poison the
            # registry-load transaction.
            if not self._webvue_missing_features(profiles, service):
                return False
            profile = profiles._webvue_lock()
            completed = self._webvue_missing_features(profile, service)
            if not completed:
                return False
            profile.with_context(**{OPERATOR_CONTEXT: True}).write({
                'features': completed,
                'retained_read_features': list(profile.retained_read_features or []),
            })
        return True

    @api.model
    def _webvue_missing_features(self, profile, service):
        """The completed feature map when the stored one lacks a key, else an empty dict."""
        current = profile.features
        if not isinstance(current, dict):
            return {}
        completed = service._webvue_close_unlisted_features(current)
        return completed if completed != current else {}

    def _webvue_lock(self, *, shared=False):
        self.ensure_one()
        self.env.cr.execute(
            ('SELECT id FROM webvue_tenant_profile WHERE id = %s FOR SHARE'
             if shared else 'SELECT id FROM webvue_tenant_profile WHERE id = %s FOR UPDATE'),
            [self.id],
        )
        self.invalidate_recordset()
        return self.browse(self.id)

    def _webvue_bump_quota_revision(self):
        self.ensure_one()
        locked = self._webvue_lock()
        locked.with_context(**{OPERATOR_CONTEXT: True}).write({
            'quota_revision': locked.quota_revision + 1,
        })
        return locked.quota_revision

    def _webvue_require_policy_source(self, source):
        """Internal service boundary, never an RPC or caller-supplied context grant."""
        self.ensure_one()
        if not self.env.su:
            raise AccessError(self.env._('A trusted local operator is required.'))
        if source not in SOURCES.values() or self.entitlement_source != source:
            raise AccessError(self.env._('Policy source is not permitted for this installation.'))
        return True

    @api.constrains('commercial_mode', 'entitlement_source', 'valid_until', 'commercial_valid_until')
    def _webvue_check_commercial_mode(self):
        for record in self:
            if SOURCES.get(record.commercial_mode) != record.entitlement_source:
                raise ValidationError(self.env._('Commercial mode and policy source must match.'))
            if record.commercial_mode == 'non_saas' and (record.valid_until or record.commercial_valid_until):
                raise ValidationError(self.env._('Independent installations cannot have a subscription expiry.'))

    @api.model_create_multi
    def create(self, vals_list):
        if self.search([], limit=1) or len(vals_list) != 1:
            raise ValidationError(self.env._('webvue tenant profile is a singleton.'))
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
        if (vals.get('valid_until') or vals.get('commercial_valid_until')) and any(record.commercial_mode == 'non_saas' for record in self):
            raise ValidationError(self.env._('Independent installations cannot have a subscription expiry.'))
        policy_keys = POLICY_FIELDS.intersection(vals)
        trusted = self.env.su and self.env.context.get(OPERATOR_CONTEXT)
        if policy_keys and not trusted:
            raise AccessError(self.env._(
                'webvue tenant policy can only be changed by a trusted operator.',
            ))
        if not policy_keys:
            return super().write(vals)
        if len(self) != 1:
            raise ValidationError(self.env._('webvue tenant profile is a singleton.'))
        service = self.env['webvue.entitlement.service']
        next_vals = dict(vals)
        if 'status' in next_vals and next_vals['status'] not in ('active', 'suspended'):
            raise ValidationError(self.env._('webvue_platform: status must be active or suspended'))
        if 'features' in next_vals:
            next_vals['features'] = service._webvue_validate_features(next_vals['features'])
            previous = self.retained_read_features or []
            if 'retained_read_features' in next_vals:
                retained = service._webvue_validate_retained(
                    next_vals['retained_read_features'], next_vals['features'],
                )
            else:
                retained = service._webvue_merge_retained(previous, next_vals['features'])
            next_vals['retained_read_features'] = retained
        elif 'retained_read_features' in next_vals:
            next_vals['retained_read_features'] = service._webvue_validate_retained(
                next_vals['retained_read_features'], self.features or {},
            )
        if 'terminology' in next_vals:
            next_vals['terminology'] = service._webvue_validate_terminology(next_vals['terminology'])
        policy_touch = set(next_vals) & (
            POLICY_FIELDS - {
                'quota_revision', 'policy_revision', 'commercial_revision_id',
                'commercial_digest', 'commercial_applied_at',
            }
        )
        if policy_touch and 'policy_revision' not in next_vals:
            next_vals['policy_revision'] = (self.policy_revision or 0) + 1
        if 'policy_revision' in next_vals and next_vals['policy_revision'] < 0:
            raise ValidationError(self.env._('webvue_platform: revisions cannot be negative'))
        if 'quota_revision' in next_vals and next_vals['quota_revision'] < 0:
            raise ValidationError(self.env._('webvue_platform: revisions cannot be negative'))
        return super().write(next_vals)

    def _webvue_require_operator(self):
        self.ensure_one()
        if not (self.env.su and self.env.context.get(OPERATOR_CONTEXT)):
            raise AccessError(self.env._('A trusted local operator is required.'))

    def _webvue_grant_opened_admin_roles(self, login, roles_before):
        """Give the enrolment administrator the roles a policy change newly opened.

        ROLES_BEFORE are the administrator roles the previous policy opened. Only
        the roles open now and not before are assigned, to the active internal
        user whose login the control plane recorded at enrolment, in the root
        company. Nothing is ever revoked; without a login or a matching user
        nothing is granted. Returns the granted role keys.
        """
        self._webvue_require_operator()
        previous = set(roles_before or ())
        opened = [
            key for key in self.env['webvue.entitlement.service']._webvue_entitled_admin_roles()
            if key not in previous
        ]
        if not opened:
            return []
        if not login or not isinstance(login, str):
            _logger.info('webvue_platform: no enrolment administrator login; opened roles %s not granted', opened)
            return []
        user = self.env['res.users'].search(
            [('login', '=', login), ('active', '=', True), ('share', '=', False)], limit=1,
        )
        if not user:
            _logger.info('webvue_platform: enrolment administrator is not an active internal user; roles not granted')
            return []
        company = self.root_company_id
        granted = []
        for key in opened:
            role = self.env['webvue.access.role'].search([('key', '=', key)], limit=1)
            if not role:
                continue
            assignment = self.env['webvue.access.assignment'].search([
                ('user_id', '=', user.id), ('role_id', '=', role.id), ('company_id', '=', company.id),
            ])
            if not assignment:
                self.env['webvue.access.assignment'].create({
                    'user_id': user.id, 'role_id': role.id, 'company_id': company.id,
                })
            granted.append(key)
        return granted

    def _webvue_apply_branches(self, operation_id, target_revision_id, branches):
        """Bind control-plane branches to child companies of the root company.

        Operator-only and idempotent per branch uid; returns the Odoo company id
        for each requested branch.
        """
        self._webvue_require_operator()
        if not operation_id or not isinstance(branches, (list, tuple)):
            raise ValidationError(self.env._('branch_binding_invalid'))
        requested = {}
        for item in branches:
            uid = item.get('branch_id') if isinstance(item, dict) else None
            name = item.get('name') if isinstance(item, dict) else None
            if not uid or not isinstance(uid, str) or not name or not isinstance(name, str):
                raise ValidationError(self.env._('branch_binding_invalid'))
            if uid in requested and requested[uid] != name:
                raise ValidationError(self.env._('branch_binding_conflict'))
            requested[uid] = name
        profile = self._webvue_lock()
        Branch = self.env['webvue.tenant.branch']
        existing = Branch.search([('branch_uid', 'in', list(requested))])
        by_uid = {branch.branch_uid: branch for branch in existing}
        for branch in existing:
            if (
                branch.state != 'active'
                or branch.company_id.parent_id != profile.root_company_id
            ):
                raise ValidationError(self.env._('branch_binding_conflict'))
        new_uids = [uid for uid in requested if uid not in by_uid]
        if new_uids:
            active_count = Branch.search_count([('state', '=', 'active')])
            self.env['webvue.entitlement.service'].require_within_limit(
                'branches.extra_limit', active_count + len(new_uids),
            )
        result = []
        for uid, name in requested.items():
            branch = by_uid.get(uid)
            if not branch:
                company = self.env['res.company'].create({
                    'name': name,
                    'parent_id': profile.root_company_id.id,
                })
                branch = Branch.create({
                    'branch_uid': uid,
                    'company_id': company.id,
                    'operation_id': operation_id,
                    'target_revision_id': target_revision_id,
                    'state': 'active',
                })
            result.append({'branch_id': uid, 'odoo_company_id': branch.company_id.id})
        return result

    def _webvue_archive_branch(self, operation_id, branch_uid):
        self._webvue_require_operator()
        self._webvue_lock()
        branch = self.env['webvue.tenant.branch'].search([('branch_uid', '=', branch_uid)])
        if not branch:
            raise ValidationError(self.env._('branch_not_found'))
        branch.write({'state': 'archived', 'operation_id': operation_id})
        branch.company_id.write({'active': False})
        return branch.company_id

    def _webvue_bind_user_to_branch(self, user, branch_uid):
        self._webvue_require_operator()
        branch = self.env['webvue.tenant.branch'].search([
            ('branch_uid', '=', branch_uid), ('state', '=', 'active'),
        ])
        if not branch or branch.company_id.root_id != self.root_company_id:
            raise ValidationError(self.env._('branch_binding_conflict'))
        user.write({
            'company_ids': [(6, 0, branch.company_id.ids)],
            'company_id': branch.company_id.id,
        })
        return user

    def unlink(self):
        raise ValidationError(self.env._('webvue tenant profile cannot be deleted.'))
