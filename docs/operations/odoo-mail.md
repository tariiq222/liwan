# Odoo outgoing mail (shared overlay)

In the shared deployment (`deploy/docker-compose.shared.yml`) every network Odoo sits on is internal, and the HTTP
proxy `odoo-egress` carries only HTTPS. SMTP is not HTTP, so the mail Odoo itself sends leaves through its own route:
the `odoo-mail` service. This page states what the files do. It is not a release or deployment approval, and no mail
has been sent through it yet (the protocol tests in `deploy/test_odoo_mail.py` ran, and Odoo mail was sent to the relay once on a scratch database, see below).

## What Odoo sends

All of it goes through `ir.mail_server.send_email`, so one server-wide SMTP setting covers every tenant database.

| Mail | Code | At launch |
| --- | --- | --- |
| Sign-in code by email | `liwan_core/models/sms_gateway.py:93` -> `account_mail.py:64` | Yes. The only other channel is SMS, and a user without a verified phone gets email |
| Invitation and password-reset links | `liwan_core/models/access_service.py:798` -> `account_mail.py:41` | Yes |
| Storage warnings at 80% and 95% | `liwan_notify/models/storage_limit_notification.py:124` -> `notify_mail.py:21` | Yes |
| Final payslip | `liwan_hr/models/hr_payslip.py:228` (`mail.mail`, queued by Odoo's mail cron) | No, payroll is outside release 1 |

The control plane sends its own mail (administrator invitation, owner alerts) through its own SMTP adapter and does not
use this route. `liwan_core/models/outbound_mail.py` reads the sender from `mail.default.from` or, when that is unset,
the server-wide `email_from`. Nothing in the repository sets `mail.default.from` for a tenant, so the server-wide value
below is the sender of every tenant.

## How it works

- `odoo-mail` is built from `deploy/odoo-mail` (standard-library Python on the same pinned base image as `odoo-egress`).
  It is not a mail server: no local delivery, no queue on disk, one upstream.
- Network layout: `odoo` and `odoo-mail` share the internal network `odoo_mail`; `odoo-mail` is also on `edge`, the only
  routed network it has, to reach the upstream. It binds only addresses that are not on the interface holding the default
  route, so nothing on `edge` can connect to it. Odoo gains no routed network.
- Odoo is pointed at it with three environment variables in the overlay: `ODOO_SMTP_SERVER=odoo-mail`,
  `ODOO_SMTP_PORT=2525`, `ODOO_EMAIL_FROM=${ODOO_MAIL_SENDER}`. Odoo 19 reads every server option from `ODOO_<NAME>`
  (`odoo/tools/config.py`), and the environment wins over the config file, so the secret config file
  (`LIWAN_SHARED_ODOO_CONFIG`) needs no mail lines and the shared startup validator is unaffected. No `ir.mail_server`
  record exists, so Odoo uses these options. Odoo to relay is plain SMTP without credentials on an internal network
  that holds only the two of them.
- The relay answers the client only after the upstream answered. A refused or unreachable upstream is a failed send in
  Odoo, so an account link is marked `failed`, not lost. There is no retry queue: that is Odoo's concern.
- The upstream leg requires STARTTLS and verifies the certificate and host name. A server without STARTTLS is refused
  (454); there is no plaintext fallback. Authentication is optional and used only over that TLS session.
- Sender policy: the envelope sender and the single `From` header must both be `ODOO_MAIL_SENDER`, and any `Sender`,
  `Resent-From`, `Resent-Sender` or `Return-Path` header must name it too (an empty `Return-Path` is allowed). Otherwise
  the relay answers 553 or 554 and sends nothing. It rejects instead of rewriting, so a message is never delivered under
  an identity its author did not pick and a misconfiguration shows up in Odoo's log. **The display name is not checked**:
  a tenant-controlled name such as `"Acme Billing" <no-reply@liwanos.com>` passes, so a name that impersonates someone
  is possible wherever the sending code lets a tenant choose it.
- Strict text. The data must be CRLF lines ending with `CRLF.CRLF`. A bare CR, a bare LF, a NUL byte or any other
  terminator refuses the message (554) and closes the connection (SMTP smuggling). The header block is parsed by hand:
  every line is `Name: value` with a token name and no space before the colon, or a continuation; one `From` with one
  address; no list, group or comment. Dot-stuffing is removed once on receipt and added once by the upstream client.
- All or nothing. The relay opens the upstream transaction itself and sends `RCPT` for every recipient before `DATA`.
  If the upstream refuses or defers any of them it resets the transaction and answers 451 (all deferrals) or 554, and
  nobody receives the message.
- Limits: 10 MB per message, 50 recipients, 8 handler threads (a ninth connection is answered 421 and closed), 60 s idle
  per read, 120 s for a DATA phase, 600 s per connection (applied to every recv, so a client sending one byte at a time is cut
  too), 10 s per upstream operation and 40 s in total for one delivery (the TLS handshake included). An upstream reply is
  capped at 50 lines and 16 KB. The container has `mem_limit: 384m`; a message is held in one buffer, not one object per line.
  Odoo's SMTP client gives up after 60 s without an answer (`SMTP_TIMEOUT`, `odoo/addons/base/models/ir_mail_server.py`),
  so the relay always answers first. If the 40 s were ever raised above that, Odoo would report a failure for a message
  the upstream may still deliver, and a resend would then arrive twice.
- Binding. It listens on every non-loopback address except the one on the interface that holds the default route. With no
  default route it refuses to start (and the healthcheck fails), so it can never listen on the routed network.
- Hardening is the same as `odoo-egress` (unprivileged numeric user `10002:10002`, `cap_drop: [ALL]`,
  `no-new-privileges`, read-only root, `/tmp` tmpfs). The differences: the user is numeric because the image has no
  account entry for it, and a mail daemon such as Postfix was not used because its master process must start as root and
  write a spool, which this hardening forbids. The relay needs neither.

## What real Odoo mail looks like (checked)

Checked on a scratch database with `mail` and `liwan_core` installed, Odoo's server options `smtp_server`, `smtp_port`
and `email_from` set from the environment as in the overlay, and the real relay on loopback with a recording upstream
(Odoo 19 source at the pinned checkout; throwaway scripts, database dropped afterwards).

| Message | Envelope sender | `From` | `Return-Path` | Relay |
| --- | --- | --- | --- | --- |
| Sign-in code (`liwan.outbound.mail`) | platform address | platform address | none | accepted |
| Storage warning, invitation, reset (same composer) | platform address | platform address | none | accepted |
| Stock `mail.mail` with `email_from` = platform address | platform address | platform address | empty header | accepted |
| Stock `mail.mail` with the author's own address (payslip as written) | platform address | the author's address | empty header | **refused 554** |
| Stock `mail.mail` with a bounce `Return-Path` (VERP, a mail alias domain) | the bounce address | platform address | bounce address | **refused 553** |

Odoo sets the envelope sender from `Return-Path` or else `email_from`, but it leaves the `From` header as the message
has it. So Liwan's own mail passes, and stock mail written by other code does not unless it carries the platform
address in `From`. The final payslip mail (`odoo-addons/liwan_hr/models/hr_payslip.py:228`) sets no `email_from`, so it
would be refused until that call passes `email_from` = `liwan.outbound.mail._liwan_sender()` (an addon change, not made
here; payroll is outside release 1). No bounce alias domain is configured for any tenant, so the third refusal does not
arise today; configuring one would need the relay's sender rule to change deliberately.

## Operator values

Set in `deploy/.env` (read like `DB_PASSWORD`; never in git or in the image). Unset values start the relay in
refuse-everything mode (554 `the mail relay is not configured`), never as an open relay.

| Variable | Meaning |
| --- | --- |
| `ODOO_MAIL_SENDER` | The one platform address, for example `no-reply@liwanos.com`. It must be an approved sender at the provider |
| `ODOO_MAIL_UPSTREAM_HOST` | The send-only provider's SMTP host (OCI Email Delivery in Jeddah) |
| `ODOO_MAIL_UPSTREAM_PORT` | Default `587` (STARTTLS) |
| `ODOO_MAIL_UPSTREAM_USER`, `ODOO_MAIL_UPSTREAM_PASSWORD` | The provider's SMTP credentials; both or neither |

Also needed outside this repository: SPF and DKIM for the sender's domain at the provider, and an egress rule that lets
the host reach the upstream host on its submission port. After changing a value: `docker compose ... up -d odoo-mail odoo`
(Odoo reads `ODOO_EMAIL_FROM` at start).

## Check

- `PYTHONPATH=deploy python3 -B -m unittest deploy/test_odoo_mail.py` runs the real relay on loopback (protocol, smuggling,
  header parsing, limits, deadlines) and `deliver_upstream` against a local TLS server with a self-signed certificate
  (needs `openssl`), plus static checks of the overlay and the Dockerfile.
- After deployment: `docker compose logs odoo-mail` shows `relaying to <host>:587 as <sender>`. Send a sign-in code to a
  test mailbox and confirm the log line `delivered ... bytes to 1 recipients`. A message with another `From` must be
  answered 553/554 in Odoo's log.
