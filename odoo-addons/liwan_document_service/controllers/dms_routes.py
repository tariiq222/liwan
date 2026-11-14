# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError

from odoo.addons.dms.controllers.main import OnboardingController
from odoo.addons.dms.controllers.portal import CustomerPortal


class DocumentPortal(CustomerPortal):
    @http.route()
    def portal_my_dms(self, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)

    @http.route()
    def portal_my_dms_directory(self, dms_directory_id=False, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)

    @http.route()
    def portal_my_dms_file_download(self, dms_file_id, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)


class DocumentNativeUpload(OnboardingController):
    @http.route()
    def forbidden_extensions(self, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)

    @http.route()
    def upload_dms_file(self, ufile=None, directory_id=None, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)
