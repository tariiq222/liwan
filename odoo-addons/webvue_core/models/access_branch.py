# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command

from .access_service import WebVueAccessRule
from .protected_write import marked

BRANCH_POLICY_MARKER = 'webvue_core.branch_policy'
BRANCH_METADATA_MARKER = 'webvue_core.branch_metadata_company'
BRANCH_MODES = ('isolated', 'delegated', 'inherited')


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
        return super().create(vals_list)

    def write(self, vals):
        self._require_protected()
        return super().write(vals)

    def unlink(self):
        self._require_protected()
        return super().unlink()


class WebVueBranchAccessService(models.AbstractModel):
    _inherit = 'webvue.access.service'

    @api.model
    def _webvue_descendant_memberships(self, user=None):
        user = user or self.env.user
        root = self.env.company
        memberships = sorted(set(user._get_company_ids()) & set(self.env.user._get_company_ids()))
        companies = self.env['res.company'].with_context(allowed_company_ids=memberships).browse(memberships)
        return companies.filtered(
            lambda company: company != root and company.parent_path.startswith(root.parent_path),
        ).sorted('id')

    @api.model
    def _webvue_branch_company_allowed(self, user, company):
        root = self.env.company
        if company.id not in user._get_company_ids():
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
        if not scopes:
            return [self.env.company.id]
        companies = None
        for keys, match in scopes:
            granted = set(self._webvue_capability_company_ids(keys, match))
            companies = granted if companies is None else companies & granted
        return sorted(companies)

    @api.model
    def _webvue_model_company_ids(self, model_name, operation):
        """Project native ACLs onto fresh per-company capability groups, never the global union.

        The request capability gate selects candidate companies; native ACLs select the operation.
        The base internal-user group is retained in the current company only. Descendants require
        an actual capability group whose native ACL (including native implications) grants the operation.
        """
        candidates = self._webvue_scoped_company_ids()
        if not candidates:
            return []
        access = self.env['ir.model.access']._get_access_groups(model_name, operation)
        definitions = self.env['res.groups']._get_group_definitions()
        # Permission catalog is security metadata; reading only our owned table avoids elevated ORM.
        self.env.cr.execute('SELECT key, group_xmlid FROM webvue_access_permission')
        group_by_key = {key: self.env.ref(xmlid, raise_if_not_found=False).id for key, xmlid in self.env.cr.fetchall()}
        internal = self.env.ref('base.group_user').id
        allowed = []
        for company in self.env['res.company'].browse(candidates):
            groups = [group_by_key[key] for key in self._webvue_capability_keys(company=company)
                      if group_by_key.get(key)]
            projected = set(definitions.get_superset_ids(groups)) | set(groups)
            if company == self.env.company:
                projected.add(internal)
            else:
                projected.discard(internal)
            if access.matches(projected):
                allowed.append(company.id)
        return allowed

    @api.model
    def _webvue_require_branch_admin(self):
        self._webvue_require_capability('access.users.assign_roles')
        self._webvue_require_capability('access.roles.read')

    @api.model
    def _webvue_branch_roles(self):
        return self.env['webvue.access.role'].search([
            ('active', '=', True), ('assignable', '=', True),
            ('type', '=', 'built_in'), ('company_id', '=', False),
        ])

    @api.model
    def _webvue_branch_role_catalog(self, branches=None):
        def dump(role):
            return {'id': role.id, 'key': role.key, 'name': {'ar': role.name_ar, 'en': role.name_en or None},
                    'company_id': role.company_id.id or None}
        result = [dump(role) for role in self._webvue_branch_roles()]
        for branch in branches or self.env['res.company']:
            with marked(self.env, {BRANCH_METADATA_MARKER: {branch.id}}):
                roles = self.env['webvue.access.role'].search([
                    ('active', '=', True), ('assignable', '=', True),
                    ('type', '=', 'custom'), ('company_id', '=', branch.id),
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
        return {'version': self._webvue_branch_policy_version(), 'mode': self.env.company.webvue_branch_access_mode,
                'branches': [{'id': branch.id, 'name': branch.name,
                              'inherit': bool(by_branch.get(branch.id) and by_branch[branch.id].inherit),
                              'role_ids': by_branch[branch.id].role_ids.ids if branch.id in by_branch else []}
                             for branch in self._webvue_descendant_memberships()],
                'roles': self._webvue_branch_role_catalog()}

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
    def _webvue_parse_branch_changes(self, changes, branches, *, inheritance=False):
        if not isinstance(changes, list):
            msg = 'invalid'
            raise WebVueAccessRule(msg, field='branches')
        catalog = self._webvue_branch_role_catalog(None if inheritance else branches)
        allowed_roles = {role['id']: role['company_id'] for role in catalog}
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
                    or any(allowed_roles[role_id] not in (None, branch_id) for role_id in role_ids if role_id in allowed_roles)
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
        # Assignment rule remains current-company scoped; use each shared membership's ordinary environment.
        items = []
        for branch in branches:
            with marked(self.env, {BRANCH_METADATA_MARKER: {branch.id}}):
                role_ids = self.env['webvue.access.assignment'].search([
                    ('user_id', '=', user.id), ('company_id', '=', branch.id),
                ]).role_id.ids
            items.append({'id': branch.id, 'name': branch.name, 'role_ids': role_ids})
        return {'version': self._webvue_user_branch_version(user), 'branches': items,
                'roles': self._webvue_branch_role_catalog(branches)}

    @api.model
    def _webvue_update_user_branch_access(self, user, expected, changes):
        self._webvue_require_branch_admin()
        self._webvue_assert_user_scope(user)
        self._webvue_check_branch_version(expected, user=user)
        branches = self._webvue_descendant_memberships() & user.company_ids
        changes = self._webvue_parse_branch_changes(changes, branches)
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
                if self._webvue_has_capability(user, 'access.users.assign_roles', company=branch) and not future_admin:
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
