# Part of Odoo. See LICENSE file for full copyright and licensing details.


class NasqHrRule(Exception):
    """A business rule failure raised by the HR model helpers."""

    def __init__(self, code, message, field=None, status=422, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.field = field
        self.status = status
        self.details = details
