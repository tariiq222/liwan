#!/usr/bin/env python3
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Manage the platform TikTok app's single direct-message webhook (D14).

    python3 deploy/tiktok_webhook.py register|show|delete

The app key, app secret and OAuth redirect URI come from the environment
(`LIWAN_TIKTOK_CLIENT_KEY`, `LIWAN_TIKTOK_CLIENT_SECRET`, `LIWAN_TIKTOK_REDIRECT_URI`); the webhook
URL is derived from the redirect URI, because the same host that receives the OAuth callback receives
the deliveries: the platform hooks host in shared hosting, the tenant's own host in a direct
(non_saas) deployment. No secret is accepted in argv or printed.
"""
from __future__ import annotations

import argparse
import os
from urllib.parse import urlparse, urlunparse

import requests

API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'
WEBHOOK_EVENT = 'DIRECT_MESSAGE'
TIMEOUT_SECONDS = 15
ENVIRONMENT_KEYS = ('LIWAN_TIKTOK_CLIENT_KEY', 'LIWAN_TIKTOK_CLIENT_SECRET', 'LIWAN_TIKTOK_REDIRECT_URI')
# The two deployment shapes of D13: the shared relay host, and a tenant's own server.
WEBHOOK_PATHS = {
    '/tiktok/oauth/callback': '/tiktok/webhook',
    '/api/v1/inbox/tiktok/callback': '/api/v1/inbox/hooks/tiktok',
}
COMMANDS = ('register', 'show', 'delete')


def environment(environ):
    """The three operator variables; a missing one is named, never a value."""
    config = {key: (environ.get(key) or '').strip() for key in ENVIRONMENT_KEYS}
    missing = [key for key, value in config.items() if not value]
    if missing:
        raise SystemExit(f'missing environment: {", ".join(missing)}')
    return config


def webhook_url(redirect_uri):
    """The webhook URL of the deployment that owns `redirect_uri`."""
    parsed = urlparse(redirect_uri)
    path = WEBHOOK_PATHS.get(parsed.path)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.query or parsed.fragment or path is None:
        raise SystemExit('LIWAN_TIKTOK_REDIRECT_URI must be the https OAuth callback of a known deployment')
    return urlunparse((parsed.scheme, parsed.netloc, path, '', '', ''))


def _answer(method, path, request, **kwargs):
    """The `data` object of a TikTok answer; a refused or malformed answer ends the command."""
    response = request(method, API_BASE + path, timeout=TIMEOUT_SECONDS, **kwargs)
    if response.status_code >= 400:
        raise SystemExit(f'tiktok answered HTTP {response.status_code}')
    try:
        payload = response.json()
    except ValueError:
        raise SystemExit('tiktok answered a malformed payload') from None
    if not isinstance(payload, dict):
        raise SystemExit('tiktok answered a malformed payload')
    if payload.get('code') not in (0, '0'):
        message = str(payload.get('message') or 'request refused')[:200]
        raise SystemExit(f'tiktok refused the request: {message}')
    data = payload.get('data')
    return data if isinstance(data, dict) else {}


def register(config, callback_url, request=requests.request):
    """Subscribe the app's direct-message webhook to `callback_url`."""
    _answer('POST', '/business/webhook/update/', request, json={
        'app_id': config['LIWAN_TIKTOK_CLIENT_KEY'],
        'secret': config['LIWAN_TIKTOK_CLIENT_SECRET'],
        'event_type': WEBHOOK_EVENT,
        'callback_url': callback_url,
    })


def show(config, request=requests.request):
    """The callback URL TikTok currently holds for the app, or None."""
    data = _answer('GET', '/business/webhook/list/', request, params={
        'app_id': config['LIWAN_TIKTOK_CLIENT_KEY'],
        'secret': config['LIWAN_TIKTOK_CLIENT_SECRET'],
        'event_type': WEBHOOK_EVENT,
    })
    callback_url = data.get('callback_url')
    return callback_url if isinstance(callback_url, str) and callback_url else None


def delete(config, request=requests.request):
    """Remove the app's direct-message subscription."""
    _answer('POST', '/business/webhook/delete/', request, json={
        'app_id': config['LIWAN_TIKTOK_CLIENT_KEY'],
        'secret': config['LIWAN_TIKTOK_CLIENT_SECRET'],
        'event_type': WEBHOOK_EVENT,
    })


def main(argv=None, environ=None, request=requests.request):
    parser = argparse.ArgumentParser(
        description='Register, show or delete the TikTok direct-message webhook.',
        epilog='Environment: ' + ', '.join(ENVIRONMENT_KEYS),
    )
    parser.add_argument('command', choices=COMMANDS)
    arguments = parser.parse_args(argv)
    config = environment(os.environ if environ is None else environ)
    callback_url = webhook_url(config['LIWAN_TIKTOK_REDIRECT_URI'])
    if arguments.command == 'register':
        register(config, callback_url, request)
        print(f'webhook registered: {callback_url}')  # noqa: T201
    elif arguments.command == 'delete':
        delete(config, request)
        print(f'webhook deleted: {callback_url}')  # noqa: T201
    else:
        print(show(config, request) or 'no webhook registered')  # noqa: T201
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
