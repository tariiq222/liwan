# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company membership: an account of the tenant belongs to a second company, with roles there.

A membership is the company in the account's ``company_ids`` plus ``liwan.access.assignment`` rows in that company.
The account itself stays where it is: its home company (``company_id``), its seat and the administration that
belongs to the home company. Its access version and the receiving company's policy version do move, so the
person's open session refreshes its capabilities. The person who holds ``access.users.grant`` in the receiving
company adds and removes it; an administrator of the tenant's root company does the same for any branch below it.

The account is homed in another company, so the caller cannot see it: the record rule ``rule_access_users_company``
shows a grant holder only the users homed in the current company, and ``res_company_rule_employee`` hides the other
companies altogether. The few reads and writes that need to see it run in the one elevated environment of
``_liwan_membership_env``, and only after the checks below have decided in the caller's
own environment: the capability in the working company, the root-or-branch rule, the role rules, the last access
administrator.
"""
from odoo import api, models
from odoo.fields import Command, Domain

from .access_service import LiwanAccessRule

ADMIN_PERMISSION = 'access.users.assign_roles'


def _not_found(message='user does not exist'):
    return LiwanAccessRule('not_found', message, status=404)


COMPANY_NOT_FOUND = 'company does not exist'


class LiwanMembershipService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_membership_env(self):
        """The elevated environment of the few membership reads and writes the caller's record rules hide.

        Only the records of this module run in it: the account (found by login or id, homed elsewhere), the target
        branch, its roles and the list of the branches below the root for a root administrator who is not a member
        of them, the ``company_ids`` write and the assignment rows of the receiving company. Every decision is taken before, in the caller's environment, and
        the extension hooks, the audit and the capability checks run there too.
        """
        return self.env['res.users'].sudo().with_context(active_test=False).env

    @api.model
    def _liwan_membership_company(self, company_id=None):
        """The company a membership operation acts in, in the elevated environment.

        The working company by default, after the caller's grant there. Naming another company is the root path:
        only the tenant's root company may do it, and only for an active branch below it, in every branch mode. The
        root administrator need not belong to the branch, so the branch is looked up in the elevated environment.
        """
        self._liwan_require_capability('access.users.grant')
        current = self.env.company
        if company_id is None or company_id == current.id:
            return self._liwan_membership_env()['res.company'].browse(current.id)
        branch = self._liwan_membership_branch_model().search(self._liwan_membership_branch_domain() & Domain('id', '=', company_id))
        if not branch:
            raise _not_found(COMPANY_NOT_FOUND)
        return branch

    @api.model
    def _liwan_membership_branch_model(self):
        """``res.company`` in the elevated environment, active companies only: the root administrator need not belong."""
        return self._liwan_membership_env()['res.company'].with_context(active_test=True)

    @api.model
    def _liwan_membership_branch_domain(self):
        """The branches the root path accepts: the active companies strictly below the working company.

        Only the tenant's root company has a root path, so a working company that is itself a branch accepts none.
        The list of branches and every write that names one read this one domain, so they never disagree.
        """
        current = self.env.company
        if current.parent_id:
            return Domain.FALSE
        return Domain('id', 'child_of', current.id) & Domain('id', '!=', current.id)

    @api.model
    def _liwan_membership_branches(self, limit=None, offset=0):
        """(branches, total): the branches a root administrator may add members to, by name then id.

        The grant is checked in the caller's environment first; the branches are read elevated because the company
        record rule hides the ones the caller does not belong to, such as a new branch with no member yet.
        """
        self._liwan_require_capability('access.users.grant')
        domain = self._liwan_membership_branch_domain()
        Companies = self._liwan_membership_branch_model()
        return Companies.search(domain, order='name, id', limit=limit, offset=offset), Companies.search_count(domain)

    @api.model
    def _liwan_technical_user_ids(self):
        """Ids of the machine accounts an application keeps out of every administrator's reach (none by default)."""
        return set()

    @api.model
    def _liwan_membership_reserved(self, user):
        """Whether USER is an account no membership operation may touch or even confirm: share, root, vendor, machine."""
        return bool(
            not user or user.share or user._is_superuser() or user.id in self._liwan_technical_user_ids()
            or user.has_group('liwan_core.group_vendor_support'),
        )

    @api.model
    def _liwan_membership_addable(self, user):
        """Whether a membership may take USER: one predicate for the add and for the details of ``account_exists``.

        An active internal account that accepted its invitation and is managed by roles. A legacy account that is
        not managed yet keeps its capabilities from its groups in its home company, and the first assignment would
        mark it managed and silently drop them there.
        """
        return bool(
            not self._liwan_membership_reserved(user) and user.active
            and user.id not in self._liwan_awaiting_users(user)
            and self._liwan_identity_management_state(user)[0],
        )

    @api.model
    def _liwan_membership_active_account(self, user):
        """USER when it is an active account a membership operation may act on."""
        if self._liwan_membership_reserved(user) or not user.active:
            raise _not_found()
        return user

    @api.model
    def _liwan_membership_account(self, login, company):
        """The account LOGIN names, ready to join COMPANY.

        Every account that cannot be added answers the same ``not_found`` as an unknown login, so a typed email
        teaches nothing but the name and home company of an addable account. Only a login the caller could already
        know about answers ``already_member``: an account homed in the working company, whose accounts the caller
        administers, or an addable account that belongs to the company already. On the root path the named branch
        is not the working company, so an archived, pending or unmanaged account homed there stays ``not_found``.
        """
        user = self._liwan_membership_env()['res.users'].search([('login', '=', login)], limit=1)
        if self._liwan_membership_reserved(user):
            raise _not_found()
        if user.company_id == company == self.env.company:
            msg = 'already_member'
            raise LiwanAccessRule(msg, field='login', status=409)
        if not self._liwan_membership_addable(user):
            raise _not_found()
        if company in user.company_ids:
            msg = 'already_member'
            raise LiwanAccessRule(msg, field='login', status=409)
        return user

    @api.model
    def _liwan_membership_member(self, user_id, company):
        """The active member of COMPANY with id USER_ID whose home is another company."""
        user = self._liwan_membership_active_account(self._liwan_membership_env()['res.users'].browse(user_id).exists())
        if user.company_id == company:
            msg = 'home_company'
            raise LiwanAccessRule(msg, status=409)
        if company not in user.company_ids:
            raise _not_found()
        return user

    @api.model
    def _liwan_membership_assignments(self, user, company):
        return user.env['liwan.access.assignment'].search([('user_id', '=', user.id), ('company_id', '=', company.id)], order='id')

    @api.model
    def _liwan_membership_version(self, user, company):
        """What the roles in COMPANY are, so two administrators editing at once meet a conflict."""
        role_ids = sorted(self._liwan_membership_assignments(user, company).role_id.ids)
        return 'm%s-u%s-r%s' % (company.id, user.id, '.'.join(str(role_id) for role_id in role_ids))

    @api.model
    def _liwan_membership_role_ids(self, company, assignments, held=()):
        """The role ids ASSIGNMENTS give in COMPANY: assignable, active (or already held), built-in or of this company."""
        roles = self._liwan_membership_env()['liwan.access.role'].with_context(active_test=False)
        role_ids = []
        for item in assignments:
            if set(item) - {'role_id', 'company_id', 'scope'}:
                msg = 'unsupported_scope'
                raise LiwanAccessRule(msg, field='assignments')
            scope = item.get('scope', {})
            if (item.get('company_id') or scope.get('id')) != company.id or scope.get('kind', 'company') != 'company':
                msg = 'unsupported_scope'
                raise LiwanAccessRule(msg, field='assignments')
            role = roles.browse(item['role_id']).exists()
            if not role or not role.assignable or (role.company_id and role.company_id != company):
                msg = 'invalid'
                raise LiwanAccessRule(msg, 'role is not assignable', field='assignments')
            if not role.active and role.id not in held:
                msg = 'role_disabled'
                raise LiwanAccessRule(msg, field='assignments')
            role_ids.append(role.id)
        if len(role_ids) != len(set(role_ids)):
            msg = 'invalid'
            raise LiwanAccessRule(msg, 'duplicate assignment', field='assignments')
        return role_ids

    @api.model
    def _liwan_membership_holds_administration(self, user, company, role_ids=None):
        """Whether USER holds the role-assignment capability in COMPANY now, or with ROLE_IDS when they are given."""
        if role_ids is None:
            return ADMIN_PERMISSION in self._liwan_capability_keys(user, company=company)
        roles = self._liwan_membership_env()['liwan.access.role'].with_context(active_test=False).browse(role_ids)
        return any(ADMIN_PERMISSION in role.permission_ids.mapped('key') for role in roles)

    @api.model
    def _liwan_membership_assert_admin_survives(self, user, company):
        # Elevated: the accounts that can still administer the company are homed elsewhere, so the caller's
        # ``rule_access_users_company`` hides them from the count.
        self._liwan_membership_env()['liwan.access.service']._liwan_assert_admin_survives(company, excluding_user=user)

    @api.model
    def _liwan_membership_write_roles(self, user, company, role_ids):
        """Make the roles of USER in COMPANY exactly ROLE_IDS and return (before, after) as audit lists."""
        Assignment = user.env['liwan.access.assignment']
        existing = self._liwan_membership_assignments(user, company)
        before = self._liwan_membership_dump_roles(existing)
        held = set(existing.role_id.ids)
        existing.filtered(lambda assignment: assignment.role_id.id not in role_ids)._liwan_access_unlink()
        added = [role_id for role_id in role_ids if role_id not in held]
        if added:
            Assignment._liwan_access_create([
                {'user_id': user.id, 'role_id': role_id, 'company_id': company.id} for role_id in added
            ])
        return before, self._liwan_membership_dump_roles(self._liwan_membership_assignments(user, company))

    @api.model
    def _liwan_membership_dump_roles(self, assignments):
        return [{'role_id': assignment.role_id.id, 'role_key': assignment.role_id.key} for assignment in assignments]

    @api.model
    def _liwan_membership_audit(self, action, user, company, before, after):
        """One entry in the receiving company and one in the home company, both naming the person and both companies."""
        state = {
            'company': {'id': company.id, 'name': company.name},
            'home_company': {'id': user.company_id.id, 'name': user.company_id.name},
        }
        audit = self.env['liwan.access.audit']
        for scope in (company, user.company_id):
            audit._liwan_log(
                action, user, before={**state, **(before or {})} if before is not None else None,
                after={**state, **(after or {})} if after is not None else None, company=scope,
            )

    @api.model
    def _liwan_membership_link_employee(self, user, company, employee_id):
        """Link EMPLOYEE_ID, an employee of COMPANY, to USER. An application that owns employees extends this."""
        if employee_id is not None:
            msg = 'invalid'
            raise LiwanAccessRule(msg, 'employees are not available', field='employee_id')

    @api.model
    def _liwan_membership_unlink_employee(self, user, company):
        """Drop the link between USER and the employee of COMPANY. An application that owns employees extends this."""

    @api.model
    def _liwan_membership_changed(self, user, company, added):
        """USER was added to COMPANY (ADDED) or removed from it. A shared service extends this to tell people."""

    @api.model
    def _liwan_assert_login_not_homed_elsewhere(self, login):
        """Answer ``account_exists`` with the name and home of the account LOGIN belongs to, when it is homed elsewhere.

        The administrator then adds that account as a member instead of inviting a second person. Only an account
        that a membership would accept is named; any other login keeps the plain answer.
        """
        user = self._liwan_membership_env()['res.users'].search([('login', '=', login)], limit=1)
        if user and user.company_id != self.env.company and self._liwan_membership_addable(user):
            msg = 'account_exists'
            raise LiwanAccessRule(msg, field='login', status=409, details={'existing_account': {
                'name': user.name, 'home_company': {'id': user.company_id.id, 'name': user.company_id.name},
            }})

    @api.model
    def _liwan_add_membership(self, login, assignments, company_id=None, employee_id=None):
        """Add the active account LOGIN to a company with ASSIGNMENTS there and return the elevated account."""
        company = self._liwan_membership_company(company_id)
        if assignments:
            self._liwan_require_capability(ADMIN_PERMISSION)
        role_ids = self._liwan_membership_role_ids(company, assignments)
        user = self._liwan_membership_account(login, company)
        self._liwan_lock_company(company)
        self.env.invalidate_all()
        user = self._liwan_membership_account(login, company)
        if user == self.env.user:
            # The assignment rows are created in the elevated environment, where the self-grant check stands down:
            # a root administrator adding their own account meets the receiving company's policy here, as the caller.
            roles = self._liwan_membership_env()['liwan.access.role'].browse(role_ids)
            self._liwan_assert_self_grant(
                user, company, self._liwan_capability_keys(user, company=company),
                set(roles.permission_ids.mapped('key')), roles.mapped('key'),
            )
        with self.env.cr.savepoint():
            user.write({'company_ids': [Command.link(company.id)]})
            self._liwan_clear_branch_cache()
            _before, after = self._liwan_membership_write_roles(user, company, role_ids)
            self._liwan_membership_link_employee(user, company, employee_id)
            self._liwan_bump_policy(company)
        self._liwan_membership_audit('user.membership_added', user, company, None, {'assignments': after})
        self._liwan_membership_changed(user, company, added=True)
        return user

    @api.model
    def _liwan_list_memberships(self, company_id=None, limit=None, offset=0):
        """(company, members, total): the active members of a company whose home is another company."""
        company = self._liwan_membership_company(company_id)
        support = self.env.ref('liwan_core.group_vendor_support')
        domain = [
            ('company_ids', 'in', company.ids), ('company_id', '!=', company.id), ('active', '=', True),
            ('share', '=', False), ('id', 'not in', [self.env.ref('base.user_root').id, *self._liwan_technical_user_ids()]),
            ('group_ids', 'not in', support.ids),
        ]
        Users = self._liwan_membership_env()['res.users']
        return company, Users.search(domain, order='name, id', limit=limit, offset=offset), Users.search_count(domain)

    @api.model
    def _liwan_replace_membership_roles(self, user_id, assignments, expected_version, company_id=None):
        """Replace the roles of a member of another home in a company and return the elevated account."""
        company = self._liwan_membership_company(company_id)
        self._liwan_require_capability(ADMIN_PERMISSION)
        user = self._liwan_membership_member(user_id, company)
        if user == self.env.user:
            msg = 'self_access_change'
            raise LiwanAccessRule(msg)
        self._liwan_lock_company(company)
        self.env.invalidate_all()
        user = self._liwan_membership_member(user_id, company)
        current = self._liwan_membership_version(user, company)
        if expected_version != current:
            msg = 'conflict'
            raise LiwanAccessRule(msg, 'membership was changed', status=409, details={'current_version': current})
        held = set(self._liwan_membership_assignments(user, company).role_id.ids)
        role_ids = self._liwan_membership_role_ids(company, assignments, held)
        if (
            self._liwan_membership_holds_administration(user, company)
            and not self._liwan_membership_holds_administration(user, company, role_ids)
        ):
            self._liwan_membership_assert_admin_survives(user, company)
        with self.env.cr.savepoint():
            before, after = self._liwan_membership_write_roles(user, company, role_ids)
        if before != after:
            self.env['liwan.access.audit']._liwan_log(
                'user.membership_roles_changed', user, before={'assignments': before}, after={'assignments': after},
                company=company,
            )
            if before:
                self._liwan_access_changed(user)
        return user

    @api.model
    def _liwan_remove_membership(self, user_id, company_id=None):
        """Remove a member of another home from a company: their roles there and the company in their memberships."""
        company = self._liwan_membership_company(company_id)
        user = self._liwan_membership_member(user_id, company)
        if user == self.env.user:
            msg = 'self_access_change'
            raise LiwanAccessRule(msg)
        self._liwan_lock_company(company)
        self.env.invalidate_all()
        user = self._liwan_membership_member(user_id, company)
        if self._liwan_membership_assignments(user, company):
            # Deleting roles is changing roles: the grant alone removes only a member who holds none here.
            self._liwan_require_capability(ADMIN_PERMISSION)
        if self._liwan_membership_holds_administration(user, company):
            self._liwan_membership_assert_admin_survives(user, company)
        with self.env.cr.savepoint():
            before = self._liwan_membership_dump_roles(self._liwan_membership_assignments(user, company))
            # The company leaves first, so the capability groups the role removal syncs are those of the companies left.
            user.write({'company_ids': [Command.unlink(company.id)]})
            self._liwan_membership_assignments(user, company)._liwan_access_unlink()
            self._liwan_membership_unlink_employee(user, company)
            self._liwan_clear_branch_cache()
            self._liwan_bump_policy(company)
        self._liwan_membership_audit('user.membership_removed', user, company, {'assignments': before}, None)
        self._liwan_membership_changed(user, company, added=False)
        return user
