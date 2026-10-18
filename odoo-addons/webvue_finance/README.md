# webvue_finance

The Finance application: a read-only slice over stock `account` and `l10n_sa`.

## Routes (`/api/v1/finance`, GET only, `{items, total}` envelopes)

- `/invoices` and `/invoices/<id>`: `finance.invoices.read`
- `/payments`: `finance.payments.read`
- `/accounts`: `finance.accounts.read`
- `/journals`: `finance.journals.read`

Every route also requires the `finance.enabled` feature. The built-in `finance_manager`
role (and `webvue_core`'s vendor support role) holds all four capabilities.

## Deliberate ORM grant

Each capability group implies stock `account.group_account_readonly`. The routes read in the
caller's own environment (no `sudo()`), so the caller needs ORM read rights; stock ACLs and
multi-company record rules scope the data. Consequence: any one finance capability grants ORM
read of all accounting data, and only the route gates per capability
(`tests/test_finance_capability_isolation.py`). The same approach is used by `webvue_hr`
(`hr.group_hr_user`). Future write capabilities must not imply `account.group_account_invoice`
or `account.group_account_manager` without a review.
