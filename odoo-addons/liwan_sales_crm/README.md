# liwan_sales_crm

Bridge (rank 5, `auto_install` on `liwan_sales` and `liwan_crm`): a quotation written from a CRM opportunity, and the
opportunity won when one of its orders is confirmed. It defines no model (R3) and neither application names the other. It
extends the Sales hooks (`_liwan_staff_extras`, `_liwan_move`, the settings parsers and wire extras) and one extension
point of CRM (`crm.lead._liwan_win_with_amount`, `_liwan_win_by_order`).

## The link

`sale.order.liwan_lead_id` is a many2one to `crm.lead` (`ondelete='set null'`, `copy=False`): deleting the opportunity
leaves the order, and a duplicate does not carry the link. Stock `sale_crm` installs beside Sales and CRM with its own
`opportunity_id`; LiwanOS never sets it, so its confirm hook (`_update_revenues_from_so`) finds no opportunity and does
nothing, and ours is the only writer of the opportunity's revenue. Only the bridge's create route sets the link; the Sales create and edit bodies refuse `opportunity_id` (422), so
the link has one writer.

## Routes

Both need the `crm.enabled` and `sales.enabled` features. The opportunity is found through CRM's own visibility (404 for a
hidden, foreign or missing one, and for one of another company or branch).

- `GET /api/v1/crm/opportunities/<id>/orders` (`crm.leads.read`, `sales.read`): `{items, total}` in the Sales list shape,
  under Sales' own visibility, so a row the caller cannot read in Sales is neither listed nor counted.
- `POST /api/v1/crm/opportunities/<id>/orders` (`crm.leads.read`, `sales.quotations.manage`), no body. Linking is a write
  on the opportunity, because the win that follows runs elevated: the caller must be its agent or hold `crm.leads.assign`,
  else 403 as for any CRM write (a reader under visibility `all` can list but not link): a draft staff
  quotation of the caller with no line, for the opportunity's linked customer, answered in the Sales order shape. 422
  `invalid` with `details.reason` `crm_opportunity_closed` for a lost or archived opportunity (a won one takes more
  orders), and `crm_opportunity_without_customer` on `customer_id` when the opportunity has no customer the caller sees.
  The customer is the opportunity's, so a quotation for another customer is written in Sales by hand and carries no link.

The staff order shape gains `opportunity`: `{id, contact_name, status, active}` only for a caller who reads that opportunity
in CRM (the feature is on, they hold `crm.leads.read` in the working company and CRM's visibility shows it to them);
otherwise `null`, and the name never leaves the server.

## Winning

Every way an order enters or leaves the confirmed state ends in a write of `sale.order.state`, so the bridge extends
`write` and nothing else: a staff confirm or cancel, the customer's confirming acceptance, a payment's confirmation
(`liwan_sales_payments`), the customer's decline and the unpaid-order expiry (both call stock `_action_cancel`), a reopen.

- An order that enters `sale` wins the opportunity (`crm.lead._liwan_win_with_amount`) when `opportunity_win` is
  `order_confirmed` and CRM can be written. No package is needed: the final price, and so the expected revenue, is the
  amount, and the win clears the follow-up as a package win does. A won opportunity that carried a package loses the package,
  its list price and its discount together with taking the order amount. No customer is linked or changed.
- The amount is the sum, in the company's currency, of the opportunity's confirmed orders, untaxed or taxed as
  `opportunity_win_amount` says, recomputed whenever an order of the opportunity enters or leaves `sale`. A second order adds.
  An order that leaves (cancelled, declined, expired, reopened) drops out; the opportunity stays won, a person decides what
  that means, and when no confirmed order remains the amount is 0. The chatter of the opportunity says so.
- A lost or archived opportunity stays as it is; the chatter says the order was confirmed but the opportunity was not won.
  A tenant whose CRM cannot be written (not included, read-only) confirms the order and leaves the opportunity, and the
  chatter is not written either.
- The CRM side runs in a savepoint. When it refuses for a reason of its own (validation, constraint, access, a missing record
  or won stage) the order still confirms or cancels and its chatter says the opportunity was not updated and why. Programming
  errors are not caught.
- The linker was authorised to write the opportunity when the link was made; the confirmer needs no CRM right. The elevated
  win, its tracking and its notes are authored by the system user (`base.user_root`), never by the public user's partner. One
  documented `sudo()` (`tools/arch_documented_sudo.json`).

## Settings

Two fields added to `liwan.sales.settings` (tenant scope, `sales.settings.manage`, through `PATCH /api/v1/sales/settings`),
present in the settings only while the tenant has CRM; writing one without CRM is 403 `feature_not_included`:

| Setting | Values | Default | Effect |
| --- | --- | --- | --- |
| `opportunity_win` | `order_confirmed`, `manual` | `order_confirmed` | Read at each confirmation. `manual`: confirming changes nothing and the opportunity is won with a package, as in a tenant without Sales |
| `opportunity_win_amount` | `untaxed`, `total` | `untaxed` | Read at each confirmation: what the sum of the confirmed orders counts |

## The package form steps aside

`crm.lead._liwan_win_by_order()` is `False` in CRM and `True` here while `sales.enabled` and `crm.enabled` are readable and
`opportunity_win` is `order_confirmed`: a tenant fact, not the caller's rights. While it is true `crm.lead._liwan_mark_won`
refuses before any write with 409 `conflict` and `details.reason` `crm_win_by_order`, for both callers (the `/won` route and
a call logged with a sold outcome, which is refused before the call is recorded). `crm.lead._liwan_can_quote()` is the
caller's `sales.quotations.manage` in the working company. The opportunity shape carries both as `win_by_order` and
`can_quote`, read once for a whole list; the page hides the package form and the sold outcome, offers the quotation, and
tells a caller who cannot quote to ask a sales manager (decision 5 of the Sales design). With `opportunity_win: manual` the
package win is open again, as in a tenant without Sales.

## Both modes

Every route and field works in `saas` and `non_saas`. With either application off, the other shows nothing: the order
shape carries `opportunity: null`, the settings carry neither value, and the two routes answer 403 `feature_not_included`.
