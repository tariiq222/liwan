# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timezone

from odoo import api, models
from odoo.exceptions import AccessDenied, AccessError, UserError, ValidationError
from odoo.http import request

from odoo.addons.nasq_core.models.access_service import NasqAccessRule

POLICY_FIELDS = frozenset({
    'solution', 'tier', 'status', 'valid_until', 'features',
    'retained_read_features', 'terminology', 'policy_revision',
    'quota_revision', 'support_access_enabled', 'commercial_mode', 'entitlement_source',
    'commercial_revision_id', 'commercial_digest', 'commercial_applied_at',
})
OPERATOR_CONTEXT = 'nasq_platform.operator_policy'
TERMINOLOGY_LOCALES = ('ar', 'en')
TERMINOLOGY_MAX_KEYS = 64
TERMINOLOGY_MAX_CHARS = 120
TERMINOLOGY_KEYS = frozenset({
    'nav.projects', 'nav.allProjects', 'nav.myProjects', 'nav.projectTemplates',
    'nav.projectTasks', 'nav.tasks', 'projects.title', 'tasks.title',
    'nav.meetings', 'nav.meetingCalendar', 'nav.meetingSeries',
    'nav.organization', 'nav.employees', 'nav.departments', 'nav.documents',
    'hr.directory.title', 'hr.depts.title', 'hr.docs.title',
    'nav.chat', 'chat.title',
})
FORBIDDEN_TERM_CHARS = frozenset('{}@|')
FORBIDDEN_TERM_SEGMENTS = frozenset({'__proto__', 'constructor', 'prototype'})


class NasqEntitlementService(models.AbstractModel):
    _name = 'nasq.entitlement.service'
    _description = 'Nasq entitlement service'
    _nasq_scope = 'global'

    @api.model
    def _nasq_utc_today(self):
        return datetime.now(timezone.utc).date()

    @api.model
    def _nasq_profile(self):
        profiles = self.env['nasq.tenant.profile'].sudo().search([], limit=2)
        if len(profiles) != 1:
            raise UserError(self.env._(
                'nasq_platform: tenant profile is missing or not a singleton.',
            ))
        return profiles

    @api.model
    def _nasq_registry(self):
        return self.env['nasq.feature.registry']

    @api.model
    def _nasq_effective_state(self, profile=None):
        profile = profile or self._nasq_profile()
        if profile.status == 'suspended':
            return 'suspended'
        valid_until = profile.valid_until
        if valid_until and valid_until < self._nasq_utc_today():
            return 'expired'
        return 'active'

    @api.model
    def _nasq_is_support_user(self, user=None):
        user = user or self.env.user
        if not user or not user.id:
            return False
        group = self.env.ref('nasq_core.group_vendor_support')
        self.env.cr.execute(
            'SELECT 1 FROM res_groups_users_rel WHERE uid = %s AND gid = %s',
            [user.id, group.id],
        )
        return bool(self.env.cr.fetchone())

    @api.model
    def _nasq_support_login_allowed(self, user=None):
        user = user or self.env.user
        if not self._nasq_is_support_user(user) or not user.active:
            return False
        return bool(self._nasq_profile().support_access_enabled)

    @api.model
    def _nasq_assert_login_allowed(self, user):
        if self._nasq_is_support_user(user) and not self._nasq_support_login_allowed(user):
            raise AccessDenied()
        if self._nasq_effective_state() == 'suspended' and not self._nasq_support_login_allowed(user):
            raise AccessDenied()
        return True

    @api.model
    def _nasq_session_forbidden(self, user=None):
        user = user or self.env.user
        if not user or user._is_public():
            return False
        if self._nasq_is_support_user(user) and not self._nasq_support_login_allowed(user):
            return True
        return (
            self._nasq_effective_state() == 'suspended'
            and not self._nasq_support_login_allowed(user)
        )

    @api.model
    def _nasq_api_write_allowed(self, path):
        return path in {'/api/v1/me/password', '/api/v1/auth/totp'}

    @api.model
    def _nasq_guard_api(self):
        user = self.env.user
        if not user or user._is_public():
            return True
        path = request.httprequest.path
        method = (request.httprequest.method or 'GET').upper()
        write = method not in {'GET', 'HEAD', 'OPTIONS'} and not self._nasq_api_write_allowed(path)
        if path == '/api/v1/auth/totp':
            return True
        if self._nasq_session_forbidden(user):
            if request and request.session:
                request.session.logout(keep_db=True)
            code = 'tenant_suspended'
            raise NasqAccessRule(code, 'this tenant is suspended', status=403)
        self._nasq_assert_lifecycle(write=write)
        return True

    @api.model
    def _nasq_installed_modules(self):
        return self._nasq_registry()._nasq_installed_module_ids()

    @api.model
    def _nasq_features_payload(self, profile=None):
        profile = profile or self._nasq_profile()
        payload = profile.features or {}
        if not isinstance(payload, dict):
            code = 'tenant_configuration_invalid'
            raise NasqAccessRule(code, 'tenant features payload is invalid', status=503)
        return payload

    @api.model
    def _nasq_retained(self, profile=None):
        profile = profile or self._nasq_profile()
        retained = profile.retained_read_features or []
        if not isinstance(retained, list):
            code = 'tenant_configuration_invalid'
            raise NasqAccessRule(code, 'tenant retained-read payload is invalid', status=503)
        return tuple(retained)

    @api.model
    def _nasq_owner_installed(self, key):
        definition = self._nasq_registry()._nasq_feature_map().get(key)
        if not definition:
            return False
        module_id = definition['module']
        if module_id == 'nasq_platform':
            return True
        return module_id in self._nasq_installed_modules()

    @api.model
    def get(self, key, default=None):
        definition = self._nasq_registry()._nasq_feature_map().get(key)
        if not definition:
            return default
        payload = self._nasq_features_payload()
        if key not in payload:
            return default
        return payload[key]

    @api.model
    def _nasq_feature_read(self, key):
        definition = self._nasq_registry()._nasq_feature_map().get(key)
        if not definition or definition['type'] != 'boolean':
            return False
        if not self._nasq_owner_installed(key):
            return False
        payload = self._nasq_features_payload()
        if payload.get(key) is True:
            return True
        return key in self._nasq_retained()

    @api.model
    def _nasq_feature_write(self, key):
        definition = self._nasq_registry()._nasq_feature_map().get(key)
        if not definition or definition['type'] != 'boolean':
            return False
        if not self._nasq_owner_installed(key):
            return False
        if self._nasq_effective_state() != 'active':
            return False
        return self._nasq_features_payload().get(key) is True

    @api.model
    def _nasq_assert_lifecycle(self, write=False):
        state = self._nasq_effective_state()
        if state == 'suspended':
            if self._nasq_support_login_allowed():
                if write:
                    code = 'tenant_read_only'
                    raise NasqAccessRule(code, 'this tenant is read-only', status=403)
                return state
            code = 'tenant_suspended'
            raise NasqAccessRule(code, 'this tenant is suspended', status=403)
        if write and state == 'expired':
            code = 'tenant_read_only'
            raise NasqAccessRule(code, 'this tenant is read-only', status=403)
        return state

    @api.model
    def require(self, key):
        self._nasq_assert_lifecycle(write=True)
        if not self._nasq_feature_write(key):
            code = 'feature_not_included'
            raise NasqAccessRule(
                code, 'this feature is not included', status=403,
                details={'reason': 'feature', 'feature': key},
            )
        return True

    @api.model
    def require_read(self, key):
        self._nasq_assert_lifecycle(write=False)
        if not self._nasq_feature_read(key):
            code = 'feature_not_included'
            raise NasqAccessRule(
                code, 'this feature is not included', status=403,
                details={'reason': 'feature', 'feature': key},
            )
        return True

    @api.model
    def require_within_limit(self, key, count):
        self._nasq_assert_lifecycle(write=True)
        definition = self._nasq_registry()._nasq_feature_map().get(key)
        if not definition or definition['type'] != 'limit':
            code = 'feature_not_included'
            raise NasqAccessRule(
                code, 'this limit is not registered', status=403,
                details={'reason': 'limit', 'limit_key': key},
            )
        limit = self.get(key)
        if limit is None:
            return True
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 0:
            code = 'tenant_configuration_invalid'
            raise NasqAccessRule(code, 'tenant limit payload is invalid', status=503)
        if count > limit:
            code = 'feature_not_included'
            raise NasqAccessRule(
                code, 'this limit has been reached', status=403,
                details={'reason': 'limit', 'limit_key': key},
            )
        return True

    @api.model
    def _nasq_excluded_user_ids(self):
        ids = [self.env.ref('base.user_root').id]
        support = self.env.ref('nasq_core.group_vendor_support', raise_if_not_found=False)
        if support:
            self.env.cr.execute(
                'SELECT uid FROM res_groups_users_rel WHERE gid = %s',
                [support.id],
            )
            ids.extend(row[0] for row in self.env.cr.fetchall())
        return tuple(set(ids))

    @api.model
    def _nasq_count_users(self):
        excluded = self._nasq_excluded_user_ids()
        self.env.cr.execute(
            '''
                SELECT count(*) FROM res_users
                 WHERE active AND NOT share AND id != ALL(%s)
            ''',
            [list(excluded)],
        )
        return self.env.cr.fetchone()[0]

    @api.model
    def _nasq_count_usage(self, limit_key):
        """Usage counted against LIMIT_KEY, in the limit's own unit.

        The addon that registers a limit extends this through super(); an
        unknown key counts 0. Storage is whole MiB rounded up, so usage above a
        limit in MiB means the bytes exceed it.
        """
        if limit_key == 'users.limit':
            return self._nasq_count_users()
        if limit_key == 'storage.limit_mb':
            return -(-int(self._nasq_count_storage_bytes()) // 1048576)
        if limit_key == 'branches.extra_limit':
            return self.env['nasq.tenant.branch'].search_count([('state', '=', 'active')])
        return 0

    @api.model
    def _nasq_count_storage_bytes(self):
        self.env.cr.execute(
            """
                SELECT COALESCE(SUM(file_size), 0)
                  FROM ir_attachment
                 WHERE type = 'binary'
            """,
        )
        return self.env.cr.fetchone()[0]

    @api.model
    def _nasq_claim(self, key, current, delta):
        if delta <= 0:
            if delta < 0:
                self._nasq_profile()._nasq_bump_quota_revision()
            return True
        self._nasq_profile()._nasq_lock()
        self.require_within_limit(key, current + delta)
        self._nasq_profile()._nasq_bump_quota_revision()
        return True

    @api.model
    def _nasq_claim_users(self, delta):
        return self._nasq_claim('users.limit', self._nasq_count_users(), delta)

    @api.model
    def _nasq_claim_storage(self, delta_bytes):
        if delta_bytes <= 0:
            if delta_bytes < 0:
                self._nasq_profile()._nasq_bump_quota_revision()
            return True
        self._nasq_assert_lifecycle(write=True)
        self._nasq_profile()._nasq_lock()
        limit_mb = self.get('storage.limit_mb')
        if limit_mb is None:
            self._nasq_profile()._nasq_bump_quota_revision()
            return True
        if not isinstance(limit_mb, int) or isinstance(limit_mb, bool) or limit_mb < 0:
            code = 'tenant_configuration_invalid'
            raise NasqAccessRule(code, 'tenant limit payload is invalid', status=503)
        current = self._nasq_count_storage_bytes()
        if current + delta_bytes > limit_mb * 1048576:
            code = 'feature_not_included'
            raise NasqAccessRule(
                code, 'this limit has been reached', status=403,
                details={'reason': 'limit', 'limit_key': 'storage.limit_mb'},
            )
        self._nasq_profile()._nasq_bump_quota_revision()
        return True

    @api.model
    def _nasq_readable_features(self, profile=None):
        profile = profile or self._nasq_profile()
        keys = []
        for key, item in self._nasq_registry()._nasq_feature_map().items():
            if item['type'] != 'boolean':
                continue
            if self._nasq_feature_read(key):
                keys.append(key)
        return tuple(sorted(keys))

    @api.model
    def _nasq_writable_features(self, profile=None):
        profile = profile or self._nasq_profile()
        if self._nasq_effective_state(profile) != 'active':
            return ()
        keys = []
        for key, item in self._nasq_registry()._nasq_feature_map().items():
            if item['type'] != 'boolean':
                continue
            if self._nasq_feature_write(key):
                keys.append(key)
        return tuple(sorted(keys))

    @api.model
    def _nasq_dump_entitlements(self, profile=None):
        profile = profile or self._nasq_profile()
        return dict(self._nasq_features_payload(profile))

    @api.model
    def _nasq_assert_operator(self):
        if self.env.su and self.env.context.get(OPERATOR_CONTEXT):
            return True
        raise AccessError(self.env._(
            'nasq tenant policy can only be changed by a trusted operator.',
        ))

    @api.model
    def _nasq_assert_limit_value(self, key, value):
        if value is None:
            return
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValidationError(self.env._(
                'nasq_platform: limit %(key)s must be a non-negative integer or null',
                key=key,
            ))

    @api.model
    def _nasq_assert_boolean_value(self, key, value):
        if not isinstance(value, bool):
            raise ValidationError(self.env._(
                'nasq_platform: feature %(key)s must be a boolean',
                key=key,
            ))

    @api.model
    def _nasq_validate_features(self, features, installed_modules=None):
        if features is None:
            return {}
        if not isinstance(features, dict):
            raise ValidationError(self.env._('nasq_platform: features must be a flat object'))
        registry = self._nasq_registry()._nasq_feature_map()
        installed = set(installed_modules or self._nasq_installed_modules())
        cleaned = {}
        required_boolean = []
        required_limit = []
        for key, item in registry.items():
            module_id = item['module']
            required = module_id == 'nasq_platform' or module_id in installed
            if item['type'] == 'boolean' and required:
                required_boolean.append(key)
            if (item['type'] == 'limit' and required
                    and (key != 'branches.extra_limit' or key in features)):
                # Legacy signed policies omit only this later platform limit.
                required_limit.append(key)
        for key, value in features.items():
            definition = registry.get(key)
            if not definition:
                raise ValidationError(self.env._(
                    'nasq_platform: unknown feature %(key)s',
                    key=key,
                ))
            if definition['type'] == 'boolean':
                self._nasq_assert_boolean_value(key, value)
            else:
                self._nasq_assert_limit_value(key, value)
            cleaned[key] = value
        missing = [
            key for key in required_boolean + required_limit
            if key not in cleaned
        ]
        if missing:
            raise ValidationError(self.env._(
                'nasq_platform: features payload is missing required keys: %(keys)s',
                keys=', '.join(missing),
            ))
        return cleaned

    @api.model
    def _nasq_validate_retained(self, retained, features):
        if retained is None:
            return []
        if not isinstance(retained, list):
            raise ValidationError(self.env._(
                'nasq_platform: retained_read_features must be a list',
            ))
        registry = self._nasq_registry()._nasq_feature_map()
        cleaned = []
        seen = set()
        for key in retained:
            if key in seen:
                continue
            definition = registry.get(key)
            if not definition or definition['type'] != 'boolean':
                raise ValidationError(self.env._(
                    'nasq_platform: retained_read_features contains invalid key %(key)s',
                    key=key,
                ))
            seen.add(key)
            cleaned.append(key)
        return cleaned

    @api.model
    def _nasq_validate_terminology(self, terminology):
        if not terminology:
            return {}
        if not isinstance(terminology, dict):
            raise ValidationError(self.env._('nasq_platform: terminology must be an object'))
        cleaned = {}
        for locale, mapping in terminology.items():
            if locale not in TERMINOLOGY_LOCALES:
                raise ValidationError(self.env._(
                    'nasq_platform: unknown terminology locale %(locale)s',
                    locale=locale,
                ))
            if not isinstance(mapping, dict):
                raise ValidationError(self.env._(
                    'nasq_platform: terminology.%(locale)s must be an object',
                    locale=locale,
                ))
            if len(mapping) > TERMINOLOGY_MAX_KEYS:
                raise ValidationError(self.env._(
                    'nasq_platform: terminology.%(locale)s exceeds %(limit)s keys',
                    locale=locale, limit=TERMINOLOGY_MAX_KEYS,
                ))
            locale_map = {}
            for key, value in mapping.items():
                if key not in TERMINOLOGY_KEYS:
                    raise ValidationError(self.env._(
                        'nasq_platform: unknown terminology key %(key)s',
                        key=key,
                    ))
                if any(segment in FORBIDDEN_TERM_SEGMENTS for segment in key.split('.')):
                    raise ValidationError(self.env._(
                        'nasq_platform: terminology key %(key)s is not allowed',
                        key=key,
                    ))
                if not isinstance(value, str):
                    raise ValidationError(self.env._(
                        'nasq_platform: terminology value for %(key)s must be text',
                        key=key,
                    ))
                if len(value) > TERMINOLOGY_MAX_CHARS:
                    raise ValidationError(self.env._(
                        'nasq_platform: terminology value for %(key)s is too long',
                        key=key,
                    ))
                if any(char in value for char in FORBIDDEN_TERM_CHARS) or '<' in value:
                    raise ValidationError(self.env._(
                        'nasq_platform: terminology value for %(key)s contains forbidden markup',
                        key=key,
                    ))
                locale_map[key] = value
            cleaned[locale] = locale_map
        return cleaned

    @api.model
    def _nasq_merge_retained(self, previous, features):
        retained = list(previous or [])
        for key, value in (features or {}).items():
            definition = self._nasq_registry()._nasq_feature_map().get(key)
            if not definition or definition['type'] != 'boolean':
                continue
            if value is True and key not in retained:
                retained.append(key)
        return retained

    @api.model
    def _nasq_close_unlisted_features(self, features):
        """Return FEATURES plus the closed value of every installed application key it omits.

        A target lists what it grants. Every other key whose application is
        installed closes: booleans ``False``, limits ``0`` (default-deny). Keys
        the target lists are never changed, and platform keys are never filled
        in, so ``_nasq_validate_features`` still refuses a target without them.
        Operator scripts call this before a policy write; it writes nothing.
        """
        result = dict(features or {})
        installed = set(self._nasq_installed_modules())
        for key, item in sorted(self._nasq_registry()._nasq_feature_map().items()):
            module_id = item['module']
            if key in result or module_id == 'nasq_platform' or module_id not in installed:
                continue
            result[key] = False if item['type'] == 'boolean' else 0
        return result

    @api.model
    def _nasq_entitled_admin_roles(self):
        """Administrator role keys the current policy opens.

        A role holding any platform permission (a permission domain without a
        registered ``<domain>.enabled`` boolean, such as access or settings) is
        always open, including a mixed role like ``system_admin`` that also holds
        meetings permissions. A role made only
        of application permissions opens when every one of those applications'
        ``<domain>.enabled`` is granted. Installed modules never decide it: every
        application of the release is installed in every tenant.
        """
        registry = self._nasq_registry()._nasq_feature_map()
        payload = self._nasq_features_payload()
        roles = self.env['nasq.access.role']
        keys = []
        for key in self.env['nasq.access.service']._nasq_legacy_admin_roles():
            role = roles.search([('key', '=', key)], limit=1)
            if not role:
                continue
            gates = {f'{domain}.enabled' for domain in role.permission_ids.mapped('domain')}
            application = {gate for gate in gates if registry.get(gate, {}).get('type') == 'boolean'}
            if application == gates and not all(payload.get(gate) is True for gate in gates):
                continue
            keys.append(key)
        return keys

    @api.model
    def _nasq_legacy_features_for(self, selected_modules):
        """One-shot legacy grants, derived from the feature registry.

        Every feature an application registers is granted when the
        application is selected (booleans on, limits unlimited) and withheld
        when it is installed but not selected (booleans off, limits
        unlimited). Platform features are always present. Applications
        register their features, so the platform names none of them.
        """
        selected = set(selected_modules)
        installed = set(self._nasq_installed_modules())
        features = {}
        for key, item in sorted(self._nasq_registry()._nasq_feature_map().items()):
            module_id = item['module']
            boolean = item['type'] == 'boolean'
            if module_id == 'nasq_platform' or module_id in selected:
                features[key] = True if boolean else None
            elif module_id in installed:
                features[key] = False if boolean else None
        return features
