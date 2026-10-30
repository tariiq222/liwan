# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextlib import contextmanager

from odoo import api, fields, models
from odoo.exceptions import AccessError
from odoo.fields import Domain
from odoo.tools import SQL

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MUTATIONS = 'liwan_documents.mutations'
CREATE_GRANTS = 'liwan_documents.creating_grants'
CREATING = 'liwan_documents.creating'
OPERATIONS = {
    'read': 'documents.items.read',
    'write': 'documents.items.manage',
    'archive': 'documents.items.archive',
    'access': 'documents.access.manage',
}


class Document(models.Model):
    _name = 'liwan.document'
    _description = 'Document'
    _liwan_scope = 'company'
    _check_company_auto = True
    _order = 'write_date desc, id desc'

    name = fields.Char(required=True)
    body = fields.Html()
    expiry_date = fields.Date(index=True)
    active = fields.Boolean(default=True, required=True)
    company_id = fields.Many2one(
        'res.company', required=True, index=True, default=lambda self: self.env.company,
    )
    visibility = fields.Selection(
        [('company', 'Company'), ('restricted', 'Restricted')],
        required=True,
        default='restricted',
        index=True,
    )
    revision = fields.Integer(required=True, default=1, readonly=True)
    directory_id = fields.Many2one(
        'dms.directory', check_company=True, ondelete='restrict', readonly=True,
    )
    grant_ids = fields.One2many('liwan.document.grant', 'document_id')
    _directory_unique = models.Constraint(
        'UNIQUE(directory_id)', 'A directory belongs to one document.',
    )
    _positive_revision = models.Constraint(
        'CHECK(revision > 0)', 'Revision must be positive.',
    )

    @api.model
    def _liwan_actor_allows(self, operation):
        if self.env.user._is_superuser():
            return True
        user = self.env.user
        if not user.active or user.share or self.env.company not in user.company_ids:
            return False
        entitlement = self.env['liwan.entitlement.service']
        try:
            entitlement._liwan_assert_lifecycle(write=operation != 'read')
        except AccessError:
            return False
        if (
            entitlement._liwan_is_support_user()
            and not entitlement._liwan_support_login_allowed()
        ):
            return False
        feature = (
            entitlement._liwan_feature_read
            if operation == 'read'
            else entitlement._liwan_feature_write
        )
        return feature('documents.enabled') and self.env[
            'liwan.access.service'
        ]._liwan_has_capability(user, OPERATIONS[operation])

    def _liwan_can(self, operation):
        self.ensure_one()
        if self.env.user._is_superuser():
            return True
        if not self._liwan_actor_allows(operation):
            return False
        self.flush_recordset(['company_id', 'visibility', 'active'])
        self.env['liwan.document.grant'].flush_model(
            ['document_id', 'user_id', 'access'],
        )
        # Read only owned policy columns; avoid recursive ORM reads while evaluating access.
        self.env.cr.execute(
            """SELECT document.company_id, document.active, document.visibility, grant_row.access
            FROM liwan_document document LEFT JOIN liwan_document_grant grant_row
              ON grant_row.document_id=document.id AND grant_row.user_id=%s
            WHERE document.id=%s""",
            [self.env.uid, self.id],
        )
        row = self.env.cr.fetchone()
        if not row or row[0] != self.env.company.id:
            return False
        _, active, visibility, grant = row
        if not active:
            if operation not in ('read', 'archive', 'access'):
                return False
            if not self.env['liwan.access.service']._liwan_has_capability(
                self.env.user, 'documents.items.archive',
            ):
                return False
        return visibility == 'company' or grant in (
            ('reader', 'editor') if operation == 'read' else ('editor',)
        )

    def _liwan_require(self, operation):
        if self and len(self._liwan_filter(operation)) != len(self):
            msg = 'document access is forbidden'
            raise AccessError(msg)
        if not self and not self._liwan_actor_allows(operation):
            msg = 'document capability is required'
            raise AccessError(msg)

    @api.model
    def _liwan_accessible_query(self, operation='read'):
        # Keep the complete policy in the database. Native DMS rules embed this
        # query too; caching a SQL predicate must never cache a list of granted IDs.
        if not self._liwan_actor_allows(operation):
            return SQL('SELECT id FROM liwan_document WHERE FALSE')
        self.flush_model(['company_id', 'active', 'visibility'])
        self.env['liwan.document.grant'].flush_model(
            ['document_id', 'user_id', 'access'],
        )
        archived = operation in ('read', 'archive', 'access') and self.env[
            'liwan.access.service'
        ]._liwan_has_capability(self.env.user, 'documents.items.archive')
        grants = ('reader', 'editor') if operation == 'read' else ('editor',)
        return SQL(
            """SELECT d.id FROM liwan_document d
            WHERE d.company_id=%s AND (d.active OR %s)
              AND (d.visibility='company' OR EXISTS (
                SELECT 1 FROM liwan_document_grant g
                WHERE g.document_id=d.id AND g.user_id=%s AND g.access IN %s
              ))""",
            self.env.company.id, bool(archived), self.env.uid, grants,
        )

    @api.model
    def _liwan_policy_domain(self):
        if self.env.user._is_superuser():
            return Domain.TRUE
        return Domain('id', 'in', self._liwan_accessible_query())

    @api.model
    def _search(
        self,
        domain,
        offset=0,
        limit=None,
        order=None,
        *,
        active_test=True,
        bypass_access=False,
    ):
        return super()._search(
            Domain(domain) & self._liwan_policy_domain(),
            offset=offset,
            limit=limit,
            order=order,
            active_test=active_test,
            bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if operation == 'create' and self.env.cr.precommit.data.get(CREATING):
            self.browse()._liwan_require('write')
        elif operation == 'write' and all(
            record.id in self.env.cr.precommit.data.get(MUTATIONS, {})
            for record in self
        ):
            # The protected operation already rechecked policy after locking. Restore and
            # self-revocation must finish atomically after their own state transition.
            pass
        else:
            self._liwan_require('read' if operation == 'read' else 'write')
        return super().check_access(operation)

    def _filtered_access(self, operation):
        return self._liwan_filter('read' if operation == 'read' else 'write')

    def _liwan_permissions(self):
        allowed = {operation: set(self._liwan_filter(operation).ids) for operation in OPERATIONS}
        return {record_id: {operation: record_id in ids for operation, ids in allowed.items()} for record_id in self.ids}

    def _liwan_filter(self, operation):
        # OCA supplies all linked candidate records to this owned hook. Check
        # their policy in one query instead of one actor/grant lookup per row.
        # Vendor discovery still materializes candidates; never cache this result.
        if not self or self.env.user._is_superuser():
            return self
        query = self._liwan_accessible_query(operation)
        self.env.cr.execute(SQL(
            'SELECT id FROM %s WHERE id=ANY(%s) AND id IN (%s)',
            SQL.identifier(self._table), self.ids, query,
        ))
        allowed = {record_id for record_id, in self.env.cr.fetchall()}
        return self.browse([record_id for record_id in self.ids if record_id in allowed])

    @api.model
    def _liwan_bootstrap_libraries(self):
        if not self.env.user._is_superuser():
            msg = 'document library bootstrap is operator-only'
            raise AccessError(msg)
        model = self.env['ir.model']._get(self._name)
        for company in self.env['res.company'].search([]):
            policy = self.env['liwan.document.policy']
            if not policy.search_count([('company_id', '=', company.id)]):
                policy.create({'company_id': company.id})
            name = 'liwan-documents-%s' % company.id
            storage = self.env['dms.storage'].search(
                [
                    ('liwan_documents_managed', '=', True),
                    ('company_id', '=', company.id),
                ],
                limit=1,
            )
            if not storage:
                storage = self.env['dms.storage'].create(
                    {
                        'name': name,
                        'company_id': company.id,
                        'save_type': 'attachment',
                        'liwan_documents_managed': True,
                        'model_ids': [fields.Command.set(model.ids)],
                        'inherit_access_from_parent_record': True,
                        'include_message_attachments': False,
                    },
                )
                self.env['dms.directory'].create(
                    {
                        'name': name,
                        'storage_id': storage.id,
                        'is_root_directory': True,
                        'res_model': self._name,
                    },
                )
        return True

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.user._is_superuser():
            company = self.env.company
            self.env['liwan.access.service']._liwan_lock_company(
                company,
                shared=True,
            )
            self.env['liwan.document.policy']._liwan_lock(
                company,
                shared=True,
            )
            self.env['liwan.entitlement.service']._liwan_profile()._liwan_lock(
                shared=True,
            )
            self.env.invalidate_all()
            self._liwan_require('write')
            allowed = {'name', 'body', 'expiry_date'} | set(
                self._liwan_context_fields(),
            )
            if any(set(values) - allowed for values in vals_list):
                msg = 'document internal fields cannot be supplied'
                raise AccessError(msg)
        if not self.env.user._is_superuser():
            vals_list = [
                {
                    **values,
                    'company_id': self.env.company.id,
                    'visibility': 'restricted',
                    'revision': 1,
                    'active': True,
                    'directory_id': False,
                    'grant_ids': [],
                }
                for values in vals_list
            ]
        # Native defaults are not part of the customer API and can otherwise inject
        # policy fields into nested DMS resources even when values are whitelisted.
        clean = self.with_context(
            {
                key: value
                for key, value in self.env.context.items()
                if not key.startswith('default_')
            },
        )
        data = self.env.cr.precommit.data
        data[CREATING] = data.get(CREATING, 0) + 1
        try:
            records = super(Document, clean).create(vals_list)
        finally:
            data[CREATING] -= 1
        for record in records:
            operations = self.env.cr.precommit.data.setdefault(MUTATIONS, {})
            operations[record.id] = 'create'
            try:
                record._liwan_initialize_resources()
            finally:
                operations.pop(record.id, None)
        return records

    def _liwan_initialize_resources(self):
        self.ensure_one()
        marker = self.env.cr.precommit.data.setdefault(CREATE_GRANTS, set())
        marker.add(self.id)
        try:
            self.env['liwan.document.grant'].create(
                {'document_id': self.id, 'user_id': self.env.uid, 'access': 'editor'},
            )
        finally:
            marker.discard(self.id)
        if self.env.user._is_superuser():
            self._liwan_bootstrap_libraries()
        storage = self.env['dms.storage'].search(
            [
                ('liwan_documents_managed', '=', True),
                ('company_id', '=', self.company_id.id),
            ],
            limit=1,
        )
        root = self.env['dms.directory'].search(
            [('storage_id', '=', storage.id), ('is_root_directory', '=', True)], limit=1,
        )
        if not root:
            msg = 'library_unavailable'
            raise LiwanAccessRule(
                msg,
                'document library requires operator initialization',
                status=403,
            )
        directory = self.env['dms.directory'].create(
            {
                'name': 'document-%s' % self.id,
                'parent_id': root.id,
                'res_model': self._name,
                'res_id': self.id,
            },
        )
        super().write({'directory_id': directory.id})

    @api.model
    def _liwan_context_fields(self):
        return ()

    @api.model
    def _liwan_create_document(self, values, context=None):
        values = dict(values)
        tags = values.pop('tag_ids', [])
        fields_for_context = (
            self.env['liwan.document.links']._liwan_prepare_context(context)
            if context is not None
            else {}
        )
        document = self.create({**values, **fields_for_context})
        if tags:
            operations = self.env.cr.precommit.data.setdefault(MUTATIONS, {})
            operations[document.id] = 'create'
            try:
                document.directory_id.write({'tag_ids': [fields.Command.set(tags)]})
            finally:
                operations.pop(document.id, None)
        return document

    def write(self, values):
        if not self.env.user._is_superuser():
            current = self.env.cr.precommit.data.get(MUTATIONS, {})
            if any(record.id not in current for record in self):
                msg = 'use a document operation with an expected revision'
                raise AccessError(msg)
            if (
                set(values)
                - {'name', 'body', 'expiry_date', 'active', 'visibility'}
                - set(self._liwan_context_fields())
            ):
                msg = 'document internal fields cannot be changed'
                raise AccessError(msg)
        return super().write(values)

    def unlink(self):
        if not self.env.user._is_superuser():
            msg = 'documents cannot be permanently deleted'
            raise AccessError(msg)
        return super().unlink()

    @contextmanager
    def _liwan_mutation(self, expected_revision, operation, *, after_revision=None, storage=False):
        self.ensure_one()
        if (
            isinstance(expected_revision, bool)
            or not isinstance(expected_revision, int)
            or expected_revision < 1
        ):
            msg = 'invalid'
            raise LiwanAccessRule(
                msg,
                'positive expected_revision is required',
                field='expected_revision',
            )
        self.env['liwan.access.service']._liwan_lock_company(self.env.company, shared=True)
        self.env['liwan.document.policy']._liwan_lock(self.env.company, shared=True)
        self.env.cr.execute(
            SQL(
                'SELECT id FROM %s WHERE id=%s FOR UPDATE',
                SQL.identifier(self._table),
                self.id,
            ),
        )
        self.env['liwan.entitlement.service']._liwan_profile()._liwan_lock(shared=not storage)
        self.env.invalidate_all()
        self._liwan_require(operation)
        if self.revision != expected_revision:
            msg = 'conflict'
            raise LiwanAccessRule(
                msg,
                'document was changed',
                status=409,
                details={'current_revision': self.revision},
            )
        operations = self.env.cr.precommit.data.setdefault(MUTATIONS, {})
        if self.id in operations:
            msg = 'nested document mutation'
            raise AccessError(msg)
        operations[self.id] = operation
        try:
            yield
            super().write({'revision': expected_revision + 1})
            if after_revision:
                after_revision()
            if operation in ('access', 'archive'):
                # DMS rules cache actor feature/capability gates alongside SQL predicates.
                # Invalidate now and after commit so a former cached reader and
                # a newly granted reader both see the committed policy.
                self.env.registry.clear_cache()
                self.env.cr.postcommit.add(self.env.registry.clear_cache)
        finally:
            operations.pop(self.id, None)

    def _liwan_update_document(self, patch, expected_revision):
        patch = dict(patch)
        if not patch or set(patch) - {
            'name',
            'body',
            'expiry_date',
            'context',
            'tag_ids',
        }:
            msg = 'invalid'
            raise LiwanAccessRule(msg, 'invalid or empty document patch')
        if 'context' in patch:
            patch.update(
                self.env['liwan.document.links']._liwan_prepare_context(
                    patch.pop('context'),
                ),
            )
        tag_ids = patch.pop('tag_ids', None)
        with self._liwan_mutation(expected_revision, 'write'):
            if patch:
                self.write(patch)
            if tag_ids is not None:
                self.directory_id.write({'tag_ids': [fields.Command.set(tag_ids)]})
        return self

    def _liwan_set_active(self, active, expected_revision):
        if not isinstance(active, bool):
            msg = 'invalid'
            raise LiwanAccessRule(msg, 'active must be boolean')
        with self._liwan_mutation(expected_revision, 'archive'):
            if self.active == active:
                msg = 'invalid'
                raise LiwanAccessRule(
                    msg,
                    'document is already active' if active else 'document is already archived',
                )
            self.write({'active': active})
        return self

    def _liwan_set_access(self, visibility, grants, expected_revision):
        if visibility not in ('company', 'restricted') or not isinstance(grants, list):
            msg = 'invalid'
            raise LiwanAccessRule(msg, 'invalid document access')
        final_changes = []

        def finish_self_revocation():
            for grant, access in final_changes:
                grant.write({'access': access}) if access else grant.unlink()

        with self._liwan_mutation(
            expected_revision, 'access', after_revision=finish_self_revocation,
        ):
            user_ids = [
                item.get('user_id') for item in grants if isinstance(item, dict)
            ]
            if (
                len(user_ids) != len(grants)
                or len(set(user_ids)) != len(user_ids)
                or any(isinstance(i, bool) or not isinstance(i, int) for i in user_ids)
                or any(
                    set(item) != {'user_id', 'access'}
                    or item['access'] not in ('reader', 'editor')
                    for item in grants
                )
            ):
                msg = 'invalid'
                raise LiwanAccessRule(msg, 'invalid or duplicate document grant')
            users = self.env['liwan.directory']._liwan_people(user_ids)
            if set(users.ids) != set(user_ids):
                msg = 'invalid'
                raise LiwanAccessRule(
                    msg,
                    'grant users must be active internal users of this company',
                )
            editors = {item['user_id'] for item in grants if item['access'] == 'editor'}
            service = self.env['liwan.access.service']
            if not any(
                user.id in editors
                and service._liwan_has_capability(user, 'documents.items.manage')
                for user in users
            ):
                msg = 'invalid'
                raise LiwanAccessRule(
                    msg, 'at least one active capable editor is required',
                )
            existing = {grant.user_id.id: grant for grant in self.grant_ids}
            proposed = {item['user_id']: item['access'] for item in grants}
            # Retain the caller's current grant until every document metadata
            # write is done, then revoke it before leaving the locked operation.
            # No permission elevation or post-revocation content read is needed.
            for user_id, grant in existing.items():
                access = proposed.get(user_id)
                if user_id == self.env.uid and access != grant.access:
                    final_changes.append((grant, access))
                elif not access:
                    grant.unlink()
                elif access != grant.access:
                    grant.write({'access': access})
            self.env['liwan.document.grant'].create(
                [
                    {'document_id': self.id, **item}
                    for item in grants
                    if item['user_id'] not in existing
                ],
            )
            self.write({'visibility': visibility})
        return self
