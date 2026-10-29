# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command

from .access_service import WebVueAccessRule
from .protected_write import marked

BRANCH_POLICY_MARKER = 'webvue_core.branch_policy'
BRANCH_METADATA_MARKER = 'webvue_core.branch_metadata_company'
BRANCH_MODES = ('isolated', 'delegated', 'inherited')
# Layer 1 of the branch policy: one sentence a tenant picks, mapped onto the mode and the
# per-branch inheritance rules. The stored policy stays the only source of truth; the preset
# is derived from it and reads 'custom' as soon as the details no longer match any of them.
BRANCH_PRESET_MODES = {
    'single_company': 'delegated',
    'central_branches': 'inherited',
    'independent_branches': 'delegated',
    'group_of_companies': 'isolated',
}
UNPRESET_ROLE_KEYS = ('employee',)


class WebVueAccessBranchRule(models.Model):
    _name = 'webvue.access.branch.rule'
    _description = 'WebVue Branch Inheritance Rule'
    _webvue_scope = 'company'
    _check_company_auto = True

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    branch_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    inherit = fields.Boolean(default=False)
    role_ids = fields.Many2many('webvue.access.role', 'webvue_access_branch_role_rel', 'rule_id', 'role_id', check_company=True)
    _branch_unique = models.Constraint('UNIQUE(company_id, branch_id)', 'branch rule must be unique')

    @api.constrains('branch_id', 'company_id', 'role_ids')
    def _check_rule(self):
        for rule in self:
            if rule.branch_id == rule.company_id or not rule.branch_id.parent_path.startswith(rule.company_id.parent_path):
                msg = 'invalid_branch'
                raise ValidationError(msg)
            if any(role.type != 'built_in' or role.company_id or not role.assignable for role in rule.role_ids):
                msg = 'invalid_branch_role'
                raise ValidationError(msg)

    def _require_protected(self):
        if not self.env.is_superuser() and self.env.company.id not in self.env.cr.precommit.data.get(BRANCH_POLICY_MARKER, set()):
            msg = 'use_protected_webvue_access_operation'
            raise AccessError(msg)

    @api.model_create_multi
    def create(self, vals_list):
        self._require_protected()
        result = super().create(vals_list)
        self.env['webvue.access.service']._webvue_clear_branch_cache()
        return result

    def write(self, vals):
        self._require_protected()
        result = super().write(vals)
        self.env['webvue.access.service']._webvue_clear_branch_cache()
        return result

    def unlink(self):
        self._require_protected()
        result = super().unlink()
        self.env['webvue.access.service']._webvue_clear_branch_cache()
        return result


class WebVueBranchAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_membership_company_ids(self, user=None):
        """Stored, active memberships in the rollback-cleared transaction memo.

        Native _get_company_ids is process-cached and can retain a grant computed
        inside a rolled-back savepoint. Read native identity metadata separately
        from attachment targets; this environment never authorizes the target file.
        """
        user = user or self.env.user
        cache = self._webvue_branch_cache()
        key = ('membership', self.env.uid, self.env.su, user.id)
        if key not in cache:
            metadata = self.with_context(allowed_company_ids=[], active_test=False,
                                         webvue_attachment_target_check=False)
            try:
                target_ids = set(metadata.env['res.users'].browse(user.id).company_ids.ids)
                if not self.env.su:
                    target_ids &= set(metadata.env.user.company_ids.ids)
                companies = metadata.env['res.company'].browse(sorted(target_ids))
                cache[key] = tuple(companies.filtered('active').ids)
            except AccessError:
                cache[key] = ()
        return list(cache[key])

    @api.model
    def _webvue_descendant_memberships(self, user=None):
        user = user or self.env.user
        root = self.env.company
        memberships = sorted(set(self._webvue_membership_company_ids(user))
                             & set(self._webvue_membership_company_ids()))
        companies = self.env['res.company'].with_context(allowed_company_ids=memberships).browse(memberships)
        return companies.filtered(
            lambda company: company != root and company.parent_path.startswith(root.parent_path),
        ).sorted('id')

    @api.model
    def _webvue_branch_company_allowed(self, user, company):
        root = self.env.company
        if company.id not in self._webvue_membership_company_ids(user):
            return False
        return company == root or (
            root.webvue_branch_access_mode != 'isolated'
            and company in self._webvue_descendant_memberships(user)
        )

    @api.model
    def _webvue_inherited_capability_keys(self, user, company):
        root = self.env.company
        if company == root or root.webvue_branch_access_mode != 'inherited' or not self._webvue_branch_company_allowed(user, company):
            return set()
        # Owned policy/assignment tables only. No global-group cache participates in authorization.
        self.env['webvue.access.branch.rule'].flush_model(['company_id', 'branch_id', 'inherit', 'role_ids'])
        self.env['webvue.access.assignment'].flush_model(['user_id', 'company_id', 'role_id'])
        self.env['webvue.access.role'].flush_model(['active', 'assignable', 'type', 'company_id', 'permission_ids'])
        self.env.cr.execute('''
            SELECT DISTINCT permission.key
              FROM webvue_access_branch_rule rule
              JOIN webvue_access_branch_role_rel selected ON selected.rule_id = rule.id
              JOIN webvue_access_role role ON role.id = selected.role_id
              JOIN webvue_access_assignment assignment ON assignment.role_id = role.id
              JOIN webvue_access_role_permission_rel grant_rel ON grant_rel.role_id = role.id
              JOIN webvue_access_permission permission ON permission.id = grant_rel.permission_id
             WHERE rule.company_id = %s AND rule.branch_id = %s AND rule.inherit
               AND role.active AND role.assignable AND role.type = 'built_in' AND role.company_id IS NULL
               AND assignment.user_id = %s AND assignment.company_id = %s
        ''', [root.id, company.id, user.id, root.id])
        return {key for key, in self.env.cr.fetchall()}

    @api.model
    def _webvue_capability_company_ids(self, keys, match='all'):
        if not keys or match not in ('all', 'any'):
            return [self.env.company.id]
        user = self.env.user
        candidates = self.env.company | self._webvue_descendant_memberships()
        return [company.id for company in candidates if self._webvue_branch_company_allowed(user, company)
                and (all if match == 'all' else any)(
                    self._webvue_has_capability(user, key, company=company) for key in keys)]

    @api.model
    def _webvue_scoped_company_ids(self):
        scopes = self.env.context.get('webvue_capability_scope')
        cache = self._webvue_branch_cache()
        cache_key = ('scope', self.env.uid, self.env.su, self.env.company.id, scopes)
        if cache_key not in cache:
            cache[cache_key] = tuple(self._webvue_compute_scoped_company_ids(scopes))
        return list(cache[cache_key])

    @api.model
    def _webvue_compute_scoped_company_ids(self, scopes):
        # Cached environments must not preserve even the home baseline after an
        # inverse membership removal in this transaction.
        if not self.env.su and self.env.company.id not in self._webvue_membership_company_ids():
            return []
        if not scopes:
            return [self.env.company.id]
        companies = None
        for keys, match, *kind in scopes:
            granted = set(self._webvue_capability_company_ids(keys, match))
            if kind == ['contextual_read']:
                granted.add(self.env.company.id)
            companies = granted if companies is None else companies & granted
        return sorted(companies)

    @api.model
    def _webvue_operation_capability_company_ids(self, key, user=None):
        """Filter an existing operation scope; never declare or expand one.

        Recheck the exact key in each owning company, including contextual scopes whose
        current-company baseline carries no company-wide capability grant.
        """
        user = user or self.env.user
        return [company.id for company in self.env['res.company'].browse(self._webvue_scoped_company_ids())
                if self._webvue_has_capability(user, key, company=company)]

    @api.model
    def _webvue_has_operation_capability(self, user, key):
        return bool(self._webvue_operation_capability_company_ids(key, user=user))

    @api.model
    def _webvue_model_company_ids(self, model_name, operation):
        """Project native ACLs onto fresh per-company capability groups, never the global union.

        The request capability gate selects candidate companies; native ACLs select the operation.
        Native grants for unmanaged identities are retained only in their current home company;
        managed identities retain the internal-user baseline in the current company. Descendants require
        an actual capability group whose native ACL (including native implications) grants the operation.
        """
        candidates = self._webvue_scoped_company_ids()
        if operation != 'read' and any(
            gate[2:] == ('contextual_read',) for gate in (self.env.context.get('webvue_capability_scope') or ())
        ):
            candidates = [company_id for company_id in candidates if company_id == self.env.company.id]
        if not candidates:
            return []
        access = self.env['ir.model.access']._get_access_groups(model_name, operation)
        definitions = self.env['res.groups']._get_group_definitions()
        cache = self._webvue_branch_cache()
        cache_key = ('model', self.env.uid, self.env.su, self.env.company.id,
                     tuple(candidates), model_name, operation, access, definitions)
        if cache_key in cache:
            return list(cache[cache_key])
        # Native ACL/group-definition cache identities change when their definitions change.
        catalog_key = ('catalog', definitions)
        if catalog_key not in cache:
            # Permission catalog is our security metadata; no elevated ORM or stock SQL.
            self.env.cr.execute('SELECT key, group_xmlid FROM webvue_access_permission')
            cache[catalog_key] = {key: self.env.ref(xmlid, raise_if_not_found=False).id
                                  for key, xmlid in self.env.cr.fetchall()}
        group_by_key = cache[catalog_key]
        internal = self.env.ref('base.group_user').id
        managed, main_company_id = self._webvue_identity_management_state(self.env.user)
        allowed = []
        for company in self.env['res.company'].browse(candidates):
            groups = [group_by_key[key] for key in self._webvue_capability_keys(company=company)
                      if group_by_key.get(key)]
            projected = set(definitions.get_superset_ids(groups)) | set(groups)
            if company == self.env.company:
                projected.add(internal)
                if not managed and company.id == main_company_id:
                    # Legacy applications can authorize native roles without making their
                    # permission groups imply those roles. Preserve that identity's native
                    # ACLs only in its home company, as legacy capability fallback does.
                    projected.update(self.env.user._get_group_ids())
            if access.matches(projected):
                allowed.append(company.id)
        cache[cache_key] = tuple(allowed)
        return allowed

    @api.model
    def _webvue_require_branch_admin(self):
        self._webvue_require_capability('access.users.assign_roles')
        self._webvue_require_capability('access.roles.read')

    @api.model
    def _webvue_selected_branch_role_ids(self, branches, user=None):
        selected = {branch.id: [] for branch in branches}
        if user:
            for branch in branches:
                with marked(self.env, {BRANCH_METADATA_MARKER: {branch.id}}):
                    selected[branch.id] = self.env['webvue.access.assignment'].with_context(active_test=False).search([
                        ('user_id', '=', user.id), ('company_id', '=', branch.id),
                    ]).role_id.ids
        else:
            rules = self.env['webvue.access.branch.rule'].search([
                ('company_id', '=', self.env.company.id), ('branch_id', 'in', branches.ids),
            ])
            selected.update({rule.branch_id.id: rule.with_context(active_test=False).role_ids.ids for rule in rules})
        return selected

    @api.model
    def _webvue_branch_role_catalog(self, branches=None, *, selected=None):
        selected = selected or {}

        def dump(role):
            return {'id': role.id, 'key': role.key, 'name': {'ar': role.name_ar, 'en': role.name_en or None},
                    'company_id': role.company_id.id or None, 'active': role.active}

        Role = self.env['webvue.access.role'].with_context(active_test=False)
        retained_ids = sorted({role_id for role_ids in selected.values() for role_id in role_ids})
        builtins = Role.search([
            ('assignable', '=', True), ('type', '=', 'built_in'), ('company_id', '=', False),
            '|', ('active', '=', True), ('id', 'in', retained_ids),
        ])
        result = [dump(role) for role in builtins]
        for branch in branches or self.env['res.company']:
            with marked(self.env, {BRANCH_METADATA_MARKER: {branch.id}}):
                roles = Role.search([
                    ('assignable', '=', True), ('type', '=', 'custom'), ('company_id', '=', branch.id),
                    '|', ('active', '=', True), ('id', 'in', selected.get(branch.id, [])),
                ])
                result.extend(dump(role) for role in roles)
        return result

    @api.model
    def _webvue_branch_policy_version(self):
        return f'b{self.env.company.id}-v{self.env.company.webvue_access_policy_version}'

    @api.model
    def _webvue_branch_policy(self):
        self._webvue_require_branch_admin()
        rules = self.env['webvue.access.branch.rule'].search([('company_id', '=', self.env.company.id)])
        by_branch = {rule.branch_id.id: rule for rule in rules}
        branches = self._webvue_descendant_memberships()
        selected = self._webvue_selected_branch_role_ids(branches)
        items = [{'id': branch.id, 'name': branch.name,
                  'inherit': bool(by_branch.get(branch.id) and by_branch[branch.id].inherit),
                  'role_ids': selected[branch.id]}
                 for branch in branches]
        mode = self.env.company.webvue_branch_access_mode
        return {'version': self._webvue_branch_policy_version(), 'mode': mode,
                'preset': self._webvue_derive_branch_preset(mode, items), 'branches': items,
                'roles': self._webvue_branch_role_catalog(selected=selected)}

    @api.model
    def _webvue_preset_role_ids(self):
        """The parent's management roles: every assignable built-in role except the plain employee."""
        return self.env['webvue.access.role'].search([
            ('type', '=', 'built_in'), ('company_id', '=', False), ('assignable', '=', True),
            ('key', 'not in', UNPRESET_ROLE_KEYS),
        ]).ids

    @api.model
    def _webvue_derive_branch_preset(self, mode, branches):
        if mode == 'inherited':
            managed = set(self._webvue_preset_role_ids())
            matches = all(branch['inherit'] and set(branch['role_ids']) == managed for branch in branches)
            return 'central_branches' if matches else 'custom'
        if any(branch['inherit'] or branch['role_ids'] for branch in branches):
            return 'custom'
        if mode == 'isolated':
            return 'group_of_companies'
        return 'independent_branches' if branches else 'single_company'

    @api.model
    def _webvue_apply_branch_preset(self, expected, preset):
        """Write a preset through the one protected policy operation; it never bypasses it."""
        self._webvue_require_branch_admin()
        if not isinstance(preset, str) or preset not in BRANCH_PRESET_MODES:
            msg = 'invalid'
            raise WebVueAccessRule(msg, field='preset')
        branches = self._webvue_descendant_memberships()
        if preset == 'single_company' and branches:
            msg = 'invalid'
            raise WebVueAccessRule(msg, 'a company with branches cannot use the single company preset', field='preset')
        central = preset == 'central_branches'
        role_ids = self._webvue_preset_role_ids() if central else []
        changes = [{'id': branch.id, 'inherit': central, 'role_ids': role_ids} for branch in branches]
        return self._webvue_update_branch_policy(expected, BRANCH_PRESET_MODES[preset], changes)

    @api.model
    def _webvue_check_branch_version(self, expected, user=None):
        self._webvue_lock_company(self.env.company)
        self.env.invalidate_all()
        self._webvue_require_branch_admin()
        current = self._webvue_user_branch_version(user) if user else self._webvue_branch_policy_version()
        if not isinstance(expected, str) or expected != current:
            msg = 'conflict'
            raise WebVueAccessRule(msg, 'branch access was changed', status=409,
                                   details={'current_version': current})

    @api.model
    def _webvue_parse_branch_changes(self, changes, branches, *, inheritance=False, user=None):
        if not isinstance(changes, list):
            msg = 'invalid'
            raise WebVueAccessRule(msg, field='branches')
        selected = self._webvue_selected_branch_role_ids(branches, user=user)
        catalog = self._webvue_branch_role_catalog(None if inheritance else branches, selected=selected)
        allowed_roles = {role['id']: role for role in catalog}
        seen = set()
        for item in changes:
            fields = {'id', 'role_ids', 'inherit'} if inheritance else {'id', 'role_ids'}
            if not isinstance(item, dict) or set(item) != fields:
                msg = 'invalid'
                raise WebVueAccessRule(msg, field='branches')
            branch_id = item['id']
            role_ids = item['role_ids']
            if (type(branch_id) is not int or branch_id not in branches.ids or branch_id in seen
                    or not isinstance(role_ids, list) or any(type(role_id) is not int for role_id in role_ids)
                    or len(set(role_ids)) != len(role_ids) or not set(role_ids) <= set(allowed_roles)
                    or any(allowed_roles[role_id]['company_id'] not in (None, branch_id)
                           or (not allowed_roles[role_id]['active'] and role_id not in selected.get(branch_id, []))
                           for role_id in role_ids if role_id in allowed_roles)
                    or (inheritance and type(item['inherit']) is not bool)):
                msg = 'invalid'
                raise WebVueAccessRule(msg, 'invalid branch or role', field='branches')
            seen.add(branch_id)
        return changes

    @api.model
    def _webvue_update_branch_policy(self, expected, mode, changes):
        self._webvue_require_branch_admin()
        self._webvue_check_branch_version(expected)
        if mode not in BRANCH_MODES:
            msg = 'invalid'
            raise WebVueAccessRule(msg, field='mode')
        changes = self._webvue_parse_branch_changes(changes, self._webvue_descendant_memberships(), inheritance=True)
        before = self._webvue_branch_policy()
        root = self.env.company
        Rule = self.env['webvue.access.branch.rule']
        with marked(self.env, {BRANCH_POLICY_MARKER: {root.id}}):
            root.write({'webvue_branch_access_mode': mode})
            for item in changes:
                rule = Rule.search([('company_id', '=', root.id), ('branch_id', '=', item['id'])], limit=1)
                vals = {'inherit': item['inherit'], 'role_ids': [Command.set(item['role_ids'])]}
                if rule:
                    rule.write(vals)
                else:
                    Rule.create({'company_id': root.id, 'branch_id': item['id'], **vals})
        self._webvue_bump_policy(root)
        after = self._webvue_branch_policy()
        self.env['webvue.access.audit']._webvue_log('branch.policy_changed', root, before=before, after=after)
        return after

    @api.model
    def _webvue_user_branch_version(self, user):
        return f'{self._webvue_branch_policy_version()}-u{user.id}-r{user.webvue_access_version}'

    @api.model
    def _webvue_user_branch_access(self, user):
        self._webvue_require_branch_admin()
        self._webvue_assert_user_scope(user)
        branches = self._webvue_descendant_memberships() & user.company_ids
        selected = self._webvue_selected_branch_role_ids(branches, user=user)
        items = [{'id': branch.id, 'name': branch.name, 'role_ids': selected[branch.id]} for branch in branches]
        return {'version': self._webvue_user_branch_version(user), 'branches': items,
                'roles': self._webvue_branch_role_catalog(branches, selected=selected)}

    @api.model
    def _webvue_update_user_branch_access(self, user, expected, changes):
        self._webvue_require_branch_admin()
        self._webvue_assert_user_scope(user)
        self._webvue_check_branch_version(expected, user=user)
        branches = self._webvue_descendant_memberships() & user.company_ids
        changes = self._webvue_parse_branch_changes(changes, branches, user=user)
        if user.has_group('webvue_core.group_vendor_support'):
            msg = 'protected_user'
            raise WebVueAccessRule(msg, status=403)
        before = self._webvue_user_branch_access(user)
        for item in sorted(changes, key=lambda change: change['id']):
            branch = branches.browse(item['id'])
            self._webvue_lock_company(branch)
            with marked(self.env, {BRANCH_METADATA_MARKER: {branch.id}}):
                Assignment = self.env['webvue.access.assignment']
                existing = Assignment.search([('user_id', '=', user.id), ('company_id', '=', branch.id)])
                role_ids = set(item['role_ids'])
                old_role_ids = set(existing.role_id.ids)
                removed = existing.filtered(lambda assignment: assignment.role_id.id not in role_ids)
                future_admin = any('access.users.assign_roles' in role.permission_ids.mapped('key')
                                   for role in self.env['webvue.access.role'].browse(list(role_ids)))
                removed_admin = any('access.users.assign_roles' in assignment.role_id.permission_ids.mapped('key')
                                    for assignment in removed)
                if removed_admin and not future_admin:
                    self._webvue_assert_admin_survives(branch, excluding_user=user)
                removed._webvue_access_unlink()
                for role_id in role_ids - old_role_ids:
                    Assignment._webvue_access_create({
                        'user_id': user.id, 'company_id': branch.id, 'role_id': role_id,
                    })
        self._webvue_bump_policy(self.env.company)
        after = self._webvue_user_branch_access(user)
        self.env['webvue.access.audit']._webvue_log('user.branch_roles_changed', user, before=before, after=after)
        return after
