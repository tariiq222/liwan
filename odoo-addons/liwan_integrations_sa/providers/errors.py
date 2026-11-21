# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The one provider error every provider function raises."""


class ProviderError(Exception):
    """The provider refused or could not be reached; `retryable` says whether a later attempt may succeed.

    `retryable` is set only when the request certainly did not reach the provider (connection refused, DNS) or the
    provider asked to slow down (429). `unconfirmed` is set when it may have reached the provider (a timeout after the
    request was written, a 5xx): an action that costs money is then never repeated automatically.
    """

    def __init__(self, message, retryable, code=None, unconfirmed=False):
        super().__init__(message)
        self.retryable = retryable
        self.unconfirmed = unconfirmed
        # The provider's own error code (Meta's numeric code, TikTok's `code`), when the answer carried one.
        self.code = code
