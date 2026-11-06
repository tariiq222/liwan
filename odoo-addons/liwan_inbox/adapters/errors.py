# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one provider error both channel adapters raise."""


class ProviderError(Exception):
    """The provider refused or could not be reached; `retryable` says whether a later attempt may succeed."""

    def __init__(self, message, retryable, code=None, unconfirmed=False):
        super().__init__(message)
        self.retryable = retryable
        # The provider's own error code (Meta's numeric code, TikTok's `code`), when the answer carried one.
        self.code = code
        # The request may have been carried out even though no answer arrived: never retried automatically.
        self.unconfirmed = unconfirmed
