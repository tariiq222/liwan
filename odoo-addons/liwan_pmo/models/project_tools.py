# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Live company policy and the sole effective project-tool decision."""
import re
from contextlib import contextmanager

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Domain

from .access_service import FINANCE_READ_PERMISSION
from .project_constants import CHARTER_MANAGER_FIELDS

# A field-map key beside the tool keys: the fields behind the pmo.finance.read capability, read per project.
FINANCE_READ = 'finance_read'
TOOL_KEYS = ('planning', 'governance', 'finance')
TOOL_FIELDS = {f'liwan_{key}_enabled': key for key in TOOL_KEYS}
FINANCE_FIELDS = {'liwan_budget_state', 'liwan_budget_amount'}
PLANNING_FIELDS = {'allow_task_dependencies', 'allow_milestones'}
CHILD_PROJECT_QUERY_MARKER = 'liwan_pmo.child_project_query_actor'


class ProjectTools(models.Model):
    _inherit = 'project.project'

    liwan_planning_enabled = fields.Boolean(default=False, copy=True)
    liwan_governance_enabled = fields.Boolean(default=False, copy=True)
    liwan_finance_enabled = fields.Boolean(default=False, copy=True)

    def _liwan_tool_policies(self):
        self.ensure_one()
        values = self.env['liwan.pmo.settings'].with_company(self.company_id)._core_values()
        return {key: values[f'{key}_tool_policy'] for key in TOOL_KEYS}

    def _liwan_tool_enabled(self, key):
        self.ensure_one()
        if key not in TOOL_KEYS:
            msg = self.env._('Unknown project tool.')
            raise ValidationError(msg)
        if not self.env['liwan.entitlement.service']._liwan_feature_read('pmo.enabled'):
            return False
        policy = self._liwan_tool_policies()[key]
        return policy == 'enabled' or (policy == 'optional' and bool(self[f'liwan_{key}_enabled']))

    def _liwan_tool_state(self):
        self.ensure_one()
        writable = self.env['liwan.entitlement.service']._liwan_feature_write('pmo.enabled')
        policies = self._liwan_tool_policies()
        return {
            key: {'policy': policies[key], 'enabled': self._liwan_tool_enabled(key),
                  'can_toggle': bool(policies[key] == 'optional' and self.active and self.company_id == self.env.company and writable and self._liwan_can_manage())}
            for key in TOOL_KEYS
        }

    def _liwan_tool_domain(self, key):
        """SQL-ready project domain, resolved fresh for each pinned readable company."""
        if key == FINANCE_READ:
            return self._liwan_finance_readable_domain()
        if key not in TOOL_KEYS:
            msg = self.env._('Unknown project tool.')
            raise ValidationError(msg)
        if not self.env['liwan.entitlement.service']._liwan_feature_read('pmo.enabled'):
            return Domain.FALSE
        domain = Domain.FALSE
        for company in self.env.companies:
            policy = self.env['liwan.pmo.settings'].with_company(company)._core_values()[f'{key}_tool_policy']
            branch = Domain('company_id', '=', company.id)
            if policy == 'enabled':
                domain |= branch
            elif policy == 'optional':
                domain |= branch & Domain(f'liwan_{key}_enabled', '=', True)
        return domain

    def _liwan_member_domain(self):
        """Projects the caller works on: manages or sponsors, follows, or holds one of their tasks."""
        # The sponsor is a governance field: resolved here, outside the tool restriction, it never narrows the caller's query.
        with self._liwan_tool_restriction_lifted():
            sponsored = self._search([('liwan_sponsor_id', '=', self.env.uid)])
        member = (Domain('user_id', '=', self.env.uid)
                  | Domain('id', 'in', sponsored)
                  | Domain('message_follower_ids.partner_id', '=', self.env.user.partner_id.id))
        Task = self.env['project.task'].with_context(active_test=False)
        if Task.has_access('read') and self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'pmo.tasks.read'):
            tasks = Task._search([('user_ids', 'in', self.env.uid), ('company_id', 'in', self.env.companies.ids)])
            member |= Domain('id', 'in', tasks.select(Task._field_to_sql(Task._table, 'project_id', tasks)))
        return member

    def _liwan_archived_child_project_query(self):
        """Readable core children retain archived member access without widening project ACLs."""
        domain = Domain('company_id', 'in', self.env.companies.ids)
        if not self._liwan_is_manager():
            domain &= Domain('active', '=', True) | (Domain('active', '=', False) & self._liwan_member_domain())
        with self._liwan_tool_restriction_lifted():
            return self.with_context(active_test=False)._search(domain)

    @contextmanager
    def _liwan_tool_restriction_lifted(self):
        marker = self.env.cr.precommit.data
        previous = marker.get(CHILD_PROJECT_QUERY_MARKER)
        # This private, server-owned scope permits sponsor membership to be queried
        # even when governance is off. Normal project capabilities/rules still run;
        # neither an RPC context nor a caller domain can create this marker.
        marker[CHILD_PROJECT_QUERY_MARKER] = self.env.uid
        try:
            yield
        finally:
            if previous is None:
                marker.pop(CHILD_PROJECT_QUERY_MARKER, None)
            else:
                marker[CHILD_PROJECT_QUERY_MARKER] = previous

    def _liwan_can_read_finance(self):
        """Whether the caller may read this project's budget, expenses and cost figures."""
        self.ensure_one()
        return self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, FINANCE_READ_PERMISSION, record=self,
        )

    def _liwan_check_finance_read(self):
        for project in self:
            if not project._liwan_can_read_finance():
                raise AccessError(self.env._('You are not allowed to read the finance of this project.'))

    def _liwan_finance_readable_domain(self):
        """SQL-ready domain of the projects whose finance the caller may read: the same decision as the capability."""
        # Decided per allowed company: the capability, the setting and the grant of one company never open another's.
        service = self.env['liwan.access.service']
        user = self.env.user
        domain = Domain.FALSE
        for company in self.env.companies:
            readable = Domain('user_id', '=', self.env.uid)
            if service._liwan_has_capability(user, FINANCE_READ_PERMISSION, company=company):
                readable = Domain.TRUE
            elif (
                self.env['liwan.pmo.settings'].with_company(company)._core_values()['finance_readers'] == 'members'
                and service._liwan_has_capability(user, 'pmo.projects.read', company=company)
            ):
                readable |= self._liwan_member_domain()
            domain |= Domain('company_id', '=', company.id) & readable
        return domain

    def _liwan_finance_readable(self):
        """The projects of this recordset whose finance the caller may read, in one query."""
        return self.browse(self._search(Domain('id', 'in', self.ids) & self._liwan_finance_readable_domain()))

    def _liwan_check_tool(self, key):
        self.ensure_one()
        self.check_access('read')
        if not self.company_id or self.company_id.id not in self.env.companies.ids:
            raise AccessError(self.env._('Project is outside the allowed companies.'))
        if not self._liwan_tool_enabled(key):
            raise AccessError(self.env._('This project tool is not enabled.'))

    def _liwan_check_tool_write(self, key):
        self._liwan_check_visible_current()
        self._liwan_check_tool(key)
        if not self.active:
            raise AccessError(self.env._('Archived projects are read-only.'))
        self.env['liwan.entitlement.service'].require('pmo.enabled')

    def _liwan_check_tool_preference_vals(self, vals):
        names = TOOL_FIELDS.keys() & vals.keys()
        if not names:
            return
        for name in names:
            if not isinstance(vals[name], bool):
                msg = self.env._('Tool preferences must be booleans.')
                raise ValidationError(msg)
        for project in self:
            project._liwan_check_visible_current()
            project._liwan_check_manage()
            self.env['liwan.entitlement.service'].require('pmo.enabled')
            policies = project._liwan_tool_policies()
            if not project.active or any(policies[TOOL_FIELDS[name]] != 'optional' for name in names):
                raise AccessError(self.env._('Only optional tools may be changed on an active project.'))

    def _liwan_check_tool_content_vals(self, vals):
        if self.env.su:
            return
        groups = {
            'finance': FINANCE_FIELDS,
            'planning': PLANNING_FIELDS,
            'governance': CHARTER_MANAGER_FIELDS - FINANCE_FIELDS,
        }
        for project in self:
            for key, names in groups.items():
                if names.intersection(vals):
                    project._liwan_check_tool_write(key)
            if FINANCE_FIELDS.intersection(vals):
                project._liwan_check_finance_read()

    def _liwan_check_tool_create_vals(self, vals):
        policies = self.env['liwan.pmo.settings']._core_values()
        vals = {**{key[8:]: value for key, value in self.env.context.items() if key.startswith('default_')}, **vals}
        for name, key in TOOL_FIELDS.items():
            if name in vals and (not isinstance(vals[name], bool) or policies[f'{key}_tool_policy'] != 'optional'):
                raise AccessError(self.env._('Only optional project tool preferences are writable.'))
        groups = {'finance': FINANCE_FIELDS, 'planning': {'allow_task_dependencies'},
                  'governance': CHARTER_MANAGER_FIELDS - FINANCE_FIELDS}
        for key, names in groups.items():
            if names.intersection(vals):
                policy = policies[f'{key}_tool_policy']
                if policy != 'enabled' and not (policy == 'optional' and vals.get(f'liwan_{key}_enabled')):
                    raise AccessError(self.env._('This project tool is not enabled.'))
        # A budget is entered by who will read it: a finance reader, or the project's own manager.
        if FINANCE_FIELDS.intersection(vals) and vals.get('user_id', self.env.uid) != self.env.uid and not self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, FINANCE_READ_PERMISSION,
        ):
            raise AccessError(self.env._('You are not allowed to read the finance of this project.'))

    def read(self, fields=None, load='_classic_read'):
        fields = tool_read_fields(self, fields)
        return super().read(fields, load=load)

    def export_data(self, fields_to_export):
        check_tool_fields(self, fields_to_export)
        return super().export_data(fields_to_export)

    @api.model
    @api.readonly
    def read_group(self, domain, fields, groupby, offset=0, limit=None, orderby=False, lazy=True):
        domain = tool_group_domain(self, domain, [*fields, *(groupby if isinstance(groupby, list) else [groupby]), orderby or ''])
        return super().read_group(domain, fields, groupby, offset=offset, limit=limit, orderby=orderby, lazy=lazy)

    @api.model
    @api.readonly
    def formatted_read_group(self, domain, groupby=(), aggregates=(), having=(), offset=0, limit=None, order=None):
        domain = tool_group_domain(self, domain, [*groupby, *aggregates, *tool_domain_fields(having), order or ''])
        return super().formatted_read_group(domain, groupby, aggregates, having, offset, limit, order)

    _liwan_tool_field_map = {
        'planning': {'allow_task_dependencies', 'allow_milestones', 'milestone_ids'},
        'governance': (CHARTER_MANAGER_FIELDS - FINANCE_FIELDS) | {
            'liwan_phase', 'liwan_charter_state', 'liwan_charter_submitted_by_id',
            'liwan_charter_submitted_at', 'liwan_charter_approved_by_id',
            'liwan_charter_approved_at', 'liwan_charter_return_note',
        },
        'finance': FINANCE_FIELDS | {'currency_id'},
        FINANCE_READ: FINANCE_FIELDS,
    }


def _tool_field_paths(names):
    """Normalize export paths and ORM aggregate/order expressions without losing hops."""
    for expression in names:
        for ordered in expression.split(','):
            name = ordered.strip().split(' ', 1)[0]
            if ':' in name:
                field, aggregate = name.split(':', 1)
                name = aggregate.split('(', 1)[1].removesuffix(')') if '(' in aggregate else field
            # Native exports ignore tails after scalar fields, so retain them
            # while checking every valid prefix rather than rejecting the path.
            if re.match(r'[a-zA-Z_][a-zA-Z_0-9]*', name):
                yield tuple(re.split(r'[./]', name))


def tool_field_requirements(model, names, *, property_paths=None):
    """Resolve each gate at its owning model and relation path, including related aliases."""
    row_tool = getattr(model, '_liwan_tool_key', None)
    row_features = set(getattr(model, '_liwan_required_features', ()))
    requirements = {((), model._name): [model, {row_tool} if row_tool else set(), row_features]} if row_tool or row_features else {}

    def walk(owner, parts, relations, seen):
        if not parts or (owner._name, parts) in seen:
            return
        field_name, *tail = parts
        field = owner._fields.get(field_name)
        if field is None:
            # Let Odoo report malformed/unknown fields; they cannot reach an export sink.
            return
        tools = {key for key, mapped in getattr(owner, '_liwan_tool_field_map', {}).items() if field_name in mapped}
        row_tool = getattr(owner, '_liwan_tool_key', None)
        if row_tool:
            tools.add(row_tool)
        features = set(getattr(owner, '_liwan_required_features', ()))
        if owner._name == 'project.task' and field_name == 'liwan_percent_complete':
            features.add('pmo.evm')
        if tools or features:
            entry = requirements.setdefault((relations, owner._name), [owner, set(), set()])
            entry[1].update(tools)
            entry[2].update(features)
        seen = seen | {(owner._name, parts)}
        if field.related:
            walk(owner, (*field.related, *tail), relations, seen)
        elif tail and field.relational:
            walk(owner.env[field.comodel_name], tuple(tail), (*relations, field_name), seen)
        elif field.type == 'properties' and len(tail) > 1 and property_paths is not None:
            property_paths.append((relations, field, tail[0], tuple(tail[1:])))

    for path in _tool_field_paths(names):
        walk(model, path, (), set())
    return [(relations, *entry) for (relations, _model_name), entry in requirements.items()]


def check_tool_fields(records, names):
    if records.env.su:
        return
    property_paths = []
    requirements = tool_field_requirements(records, names, property_paths=property_paths)
    if not requirements and not property_paths:
        return
    records.check_access('read')
    for relations, owner, keys, features in requirements:
        if any(not owner.env['liwan.entitlement.service']._liwan_feature_read(key) for key in features):
            raise AccessError(records.env._('This project tool is not enabled.'))
        targets = records.mapped('.'.join(relations)) if relations else records
        if not targets:
            continue
        targets.check_access('read')
        if keys:
            projects = targets if owner._name == 'project.project' else targets.project_id
            if owner._name != 'project.project' and any(not target.project_id for target in targets):
                raise AccessError(records.env._('This project tool is not enabled.'))
            for project in projects:
                for key in keys:
                    if key == FINANCE_READ:
                        project._liwan_check_finance_read()
                    else:
                        project._liwan_check_tool(key)

    for relations, field, property_name, tail in property_paths:
        owners = records.mapped('.'.join(relations)) if relations else records
        getter = field.expression_getter(f'{field.name}.{property_name}')
        for owner in owners:
            target = getter(owner)
            if isinstance(target, models.BaseModel):
                check_tool_fields(target, ['/'.join(tail)])


def _field_group_open(project, key):
    """Whether the fields of a field-map group may be read on PROJECT: the tool is on, or the caller reads its finance."""
    return project._liwan_can_read_finance() if key == FINANCE_READ else project._liwan_tool_enabled(key)


def tool_read_fields(records, names):
    if names is not None:
        check_tool_fields(records, names)
        return names
    if records.env.su:
        return None
    projects = records if records._name == 'project.project' else records.project_id
    hidden = set()
    if 'liwan_percent_complete' in records._fields and not records.env['liwan.entitlement.service']._liwan_feature_read('pmo.evm'):
        hidden.add('liwan_percent_complete')
    for key, tool_fields in records._liwan_tool_field_map.items():
        if any(not project.has_access('read') or not _field_group_open(project, key) for project in projects):
            hidden.update(tool_fields)
    return [name for name in records._fields if name not in hidden]


def tool_group_domain(model, domain, names):
    domain = Domain(domain)
    if model.env.su:
        return domain
    Project = model.env['project.project']
    for relations, owner, keys, features in tool_field_requirements(model, names):
        if any(not owner.env['liwan.entitlement.service']._liwan_feature_read(key) for key in features):
            return Domain.FALSE
        for key in keys:
            project_domain = Project._liwan_tool_domain(key)
            allowed = (project_domain if owner._name == 'project.project'
                       else Domain('project_id', 'in', Project._search(project_domain)))
            if relations:
                # A raw relational projection/query may inspect every reached row.
                # Exclude a source with any disallowed target, so a second allowed
                # target cannot authorize a predicate matching the hidden one.
                domain &= Domain('.'.join(relations), 'not any', ~allowed)
            else:
                domain &= allowed
    return domain


def tool_domain_fields(domain, prefix=()):
    names = []
    for condition in Domain(domain).iter_conditions():
        path = (*prefix, condition.field_expr)
        names.append('.'.join(path))
        if condition.operator in ('any', 'not any', 'any!', 'not any!') and isinstance(condition.value, (list, Domain)):
            names.extend(tool_domain_fields(condition.value, path))
    return names
