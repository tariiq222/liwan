# Part of Odoo. See LICENSE file for full copyright and licensing details.
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).
"""Server-only capabilities; no JSON/RPC value can recreate their identity."""

_REVIEW_WORKFLOW_TOKEN = object()
_DOCUMENT_WRITE_TOKEN = object()


def _workflow_reviews(reviews):
    # Context defaults come from RPC clients too. Only workflow-provided values
    # and model defaults may initialize immutable review evidence.
    context = {
        key: value for key, value in reviews.env.context.items()
        if not key.startswith("default_")
    }
    return reviews.with_context(context, _tier_review_workflow=_REVIEW_WORKFLOW_TOKEN)


def _trusted_review_mutation(env):
    return env.su or env.context.get("_tier_review_workflow") is _REVIEW_WORKFLOW_TOKEN


def _trusted_document_write(env):
    value = env.context.get("skip_validation_check")
    return value is _DOCUMENT_WRITE_TOKEN
