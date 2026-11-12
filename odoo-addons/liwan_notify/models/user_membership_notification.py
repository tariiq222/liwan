# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The bell rows of a company membership: the person is told, and so are the administrators of their home company.

The person gets the platform's ``access_changed`` kind with a text that names the company. The holders of
``access.users.read`` in the person's home company get a kind of their own, ``access_membership``, that names the
person, the company and the administrator who acted. Neither belongs to an application, so neither has a feature key.
"""
from odoo import api, fields, models
from odoo.tools import html2plaintext

from .user_access_notification import KIND as ACCESS_CHANGED
from .user_access_notification import USER_MODEL
from odoo.addons.liwan_api.serializers.common import iso

KIND = 'access_membership'
READ_PERMISSION = 'access.users.read'
PERSON_BODIES = {
    True: 'تمت إضافتك إلى %(company)s. بدّل الشركة من قائمة المستخدم لتعمل فيها.',
    False: 'أُزيلت عضويتك في %(company)s.',
}
READER_BODIES = {
    True: 'أضاف %(actor)s حساب %(person)s إلى %(company)s. الشركة الأصلية للحساب: %(home)s.',
    False: 'أزال %(actor)s حساب %(person)s من %(company)s. الشركة الأصلية للحساب: %(home)s.',
}


class LiwanNotifyMembershipMessage(models.Model):
    _inherit = 'mail.message'

    liwan_notification_kind = fields.Selection(
        selection_add=[(KIND, 'Company membership changed')], ondelete={KIND: 'cascade'},
    )


class LiwanNotifyMembershipTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            {'kind': KIND, 'owner': 'liwan_notify', 'model': USER_MODEL},
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        return [
            *super()._liwan_notify_visible_domain(),
            [('mail_message_id.liwan_notification_kind', '=', KIND), ('mail_message_id.model', '=', USER_MODEL)],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind == KIND:
            return {
                'id': row.id,
                'kind': KIND,
                'title': html2plaintext(message.body).strip(),
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._liwan_notify_dump(row, extra)


class LiwanNotifyMembershipService(models.AbstractModel):
    _inherit = 'liwan.access.service'

    @api.model
    def _liwan_membership_changed(self, user, company, added):
        """Tell the person and the readers of their home company; nobody is told about their own act."""
        super()._liwan_membership_changed(user, company, added)
        actor = self.env.user
        notify = self.env['liwan.notify.service']
        if user != actor and user.active:
            notify._liwan_deliver(USER_MODEL, user.id, ACCESS_CHANGED, user.partner_id, PERSON_BODIES[added] % {
                'company': company.name,
            })
        body = READER_BODIES[added] % {
            'actor': actor.name, 'person': user.name, 'company': company.name, 'home': user.company_id.name,
        }
        companies = user.company_id
        if self.env.company != company:
            # The administrator of the root acts on a branch they may not belong to: the branch's readers hear of it.
            companies |= company
        for partner in self._liwan_membership_reader_partners(user, actor, companies):
            notify._liwan_deliver(USER_MODEL, user.id, KIND, partner, body)

    @api.model
    def _liwan_membership_reader_partners(self, user, actor, companies):
        """The contacts of the active internal users who hold the read capability in any of COMPANIES.

        Neither USER nor ACTOR is among them. The holders are homed in companies the acting administrator cannot see,
        so they are found elevated and only their contacts leave this function. What each holds in a company is
        decided as the candidate would see it, with the root of that company as the root company, whatever company the
        caller works in, so that roles a branch inherits from its root count.
        """
        excluded = set(self.env['liwan.entitlement.service']._liwan_excluded_user_ids()) | {user.id, actor.id}
        candidates = self.env.ref('liwan_core.group_cap_access_users_read').sudo().all_user_ids.filtered(
            lambda candidate: candidate.active and not candidate.share and candidate.id not in excluded,
        )
        partners = self.env['res.partner']
        for company in companies:
            holders = candidates.browse()
            for candidate in candidates.filtered(lambda candidate: company in candidate.company_ids):
                # The candidate's own view of the company: their memberships, with the root of the company as the root.
                # Only a root member can hold inherited roles, and only then does the root matter.
                root = company.root_id if company.root_id in candidate.company_ids else company
                service = candidate.env['liwan.access.service']
                service = service.with_env(service.env(user=candidate.id)).with_context(allowed_company_ids=[root.id])
                if READ_PERMISSION in service._liwan_capability_keys(candidate, company=company):
                    holders |= candidate
            partners |= holders.partner_id
        return partners
