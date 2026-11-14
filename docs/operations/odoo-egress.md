# Odoo outbound route (shared overlay)

In the shared deployment (`deploy/docker-compose.shared.yml`) every network Odoo sits on is internal, so Odoo has no
route off the host. Its provider calls leave through one allow-listing forward proxy, the `odoo-egress` service. This
page describes the route and how to add a host. It states what the files do; it is not a release or deployment approval.

## How it works

- `odoo-egress` is a second instance of the image that `ai-egress` uses (`deploy/ai-egress`, Squid). It has its own
  allow-list, so the AI service gains none of Odoo's hosts and Odoo gains none of the AI providers' hosts. Odoo never
  joins `ai_internal`.
- Network layout: `odoo` and `odoo-egress` share the internal network `odoo_egress`. `odoo-egress` is also on `edge`,
  the only routed network it has. Nothing else is on `odoo_egress`. `restore-odoo` has no route at all, on purpose:
  it opens restored customer data.
- Odoo's HTTP calls use `requests`, which reads `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` from the environment. The
  overlay sets the first two to `http://odoo-egress:3128` and `NO_PROXY=db,pgbouncer,tiktok-relay,localhost,127.0.0.1`,
  so the TikTok relay (plain HTTP on `relay_odoo`) and the local health probe stay direct. No addon code names the proxy.
- Default deny. A host is reachable by `CONNECT` to port 443 only. `EGRESS_DENY_PRIVATE=yes` also refuses, before any
  allow rule, every destination in a private, loopback, link-local (this covers the cloud metadata address
  169.254.169.254), CGNAT, multicast or reserved range, checked by Squid when it connects. So a listed name that
  resolves into the host's networks is refused too, and Odoo cannot reach another tenant's service, a database or
  the control plane through the proxy.
- The single-customer template (`deploy/docker-compose.yml`) needs nothing: Odoo is on the routed `default` network there.

## Hosts

| Host | Called from |
| --- | --- |
| `api.authentica.sa` | `odoo-addons/liwan_core/models/sms_gateway.py:24` (`AUTHENTICA_ENDPOINT`, sign-in SMS) |
| `graph.facebook.com` | `odoo-addons/liwan_inbox/adapters/whatsapp.py:19` (`GRAPH_BASE`); `liwan_inbox_payments/adapters/meta_catalog.py` calls it through `graph_request` |
| `lookaside.fbsbx.com` | `odoo-addons/liwan_inbox/adapters/whatsapp.py:26` (`MEDIA_HOSTS`, WhatsApp media download) |
| `business-api.tiktok.com` | `odoo-addons/liwan_inbox/adapters/tiktok.py:15` (`API_BASE`, including the OAuth token calls) |
| `.tiktokcdn.com`, `.tiktokcdn-us.com`, `.tiktokv.com` | `odoo-addons/liwan_inbox/adapters/tiktok.py:59` (`MEDIA_DOMAINS`; the media URL is named by TikTok's answer, so these are domain suffixes) |
| `ksa.paymob.com`, `uae.paymob.com`, `accept.paymob.com`, `oman.paymob.com` | stock `payment_paymob/const.py` `API_MAPPING`, one per account country that `liwan_payments` offers (default `SA`) |

`www.tiktok.com` (`AUTHORIZE_URL`, tiktok.py:16) is a browser redirect, not an Odoo call, and `tiktok.com` itself is not
listed.

## Add a host

1. Confirm in the code that Odoo itself calls the host. AI provider hosts belong to `AI_EGRESS_HOSTS`, not here.
2. Set `ODOO_EGRESS_HOSTS` in `deploy/.env` to the whole list (a value replaces the built-in default in
   `docker-compose.shared.yml`: copy it, then append). Items are comma-separated, lowercase, with no spaces:
   `host` for one exact name, `.domain` for the domain and all its subdomains. Use `.domain` only when the provider
   serves from many names.
3. Recreate the proxy: `docker compose ... up -d odoo-egress`. A malformed list stops the container at start and
   leaves nothing half applied.
4. Update the table above and the expected list in `tools/test_odoo_egress.py` in the same change.

## Check

- `python3 -B -m unittest tools.test_odoo_egress tools.test_ai_egress` (static; no container is started).
- `LIWAN_AI_EGRESS_IMAGE_TEST=1 python3 -B -m unittest tools.test_ai_egress.SquidParseCase` builds the image and has
  Squid parse the rendered Odoo configuration (needs docker).
- A live check after deployment: from the `odoo` container, `python -c "import requests; print(requests.get('https://api.authentica.sa', timeout=5).status_code)"`
  answers, and the same call to an unlisted host or to `http://169.254.169.254/` fails with a proxy `403`.
  The proxy log (`docker compose logs odoo-egress`) shows one line per request with the decision.
