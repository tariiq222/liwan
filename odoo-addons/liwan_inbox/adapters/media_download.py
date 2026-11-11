# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Download of a provider media file from a URL the provider's JSON named, without leaking the channel token.

Pure function over `requests`, no Odoo environment. The URL comes from an answer the tenant does not control, so
every hop (the URL and each redirect) must be https on a host the caller trusts before a request carrying the
token headers is sent to it. Redirects are followed by hand because `requests` forwards custom headers across hosts.
"""
import re
import time
from urllib.parse import urljoin, urlsplit

import requests
import urllib3

from odoo.addons.liwan_inbox.adapters import errors

MAX_REDIRECTS = 3
CHUNK_BYTES = 64 * 1024
HTTPS_PORT = 443
# A plain DNS name: `urlsplit` and urllib3 split an authority with a backslash or other odd characters
# differently, so `https://evil.example\.tiktok.com/` would pass a suffix check yet connect to evil.example.
DNS_HOST = re.compile(r'[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*')


def _trusted(url, allowed_host):
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        return False
    host = parts.hostname
    return (
        parts.scheme == 'https' and host is not None and DNS_HOST.fullmatch(host) is not None
        and '@' not in parts.netloc
        and port in (None, HTTPS_PORT) and allowed_host(host)
    )


def _get(url, allowed_host, headers, timeout):
    """The first non-redirect response from `url`, following at most `MAX_REDIRECTS` trusted hops."""
    for _hop in range(MAX_REDIRECTS + 1):
        if not _trusted(url, allowed_host):
            message = 'media url is not a trusted provider host'
            raise errors.ProviderError(message, retryable=False)
        try:
            response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=False, stream=True)
        except requests.RequestException as error:
            # A download is a read: a retry is safe. The message carries the exception name only, never the headers.
            raise errors.ProviderError(f'provider unreachable: {type(error).__name__}', retryable=True) from None
        if not 300 <= response.status_code < 400:
            return response
        location = response.headers.get('Location')
        response.close()
        if not location:
            message = 'media download redirected without a location'
            raise errors.ProviderError(message, retryable=False)
        url = urljoin(url, location)
    message = 'media download redirected too many times'
    raise errors.ProviderError(message, retryable=False)


def download(url, allowed_host, headers, timeout, deadline_seconds, max_bytes):
    """Return `(content, Content-Type header)` of `url`.

    `allowed_host(host)` says whether a lowercased host may receive `headers`; `timeout` is per socket operation and
    `deadline_seconds` bounds the whole download. A refusal or failure is a `ProviderError`: a read, so retryable
    when the provider or the network may recover, not when the URL, redirects or size are wrong.
    """
    deadline = time.monotonic() + deadline_seconds
    response = _get(url, allowed_host, headers, timeout)
    try:
        if response.status_code >= 400:
            retryable = response.status_code == 429 or response.status_code >= 500
            message = f'media download refused: HTTP {response.status_code}'
            raise errors.ProviderError(message, retryable=retryable)
        chunks = []
        size = 0
        try:
            for chunk in response.iter_content(CHUNK_BYTES):
                size += len(chunk)
                if size > max_bytes:
                    message = 'media is too large'
                    raise errors.ProviderError(message, retryable=False)
                if time.monotonic() > deadline:
                    message = 'media download timed out'
                    raise errors.ProviderError(message, retryable=True)
                chunks.append(chunk)
        except (requests.RequestException, urllib3.exceptions.HTTPError, OSError) as error:
            message = f'media download failed: {type(error).__name__}'
            raise errors.ProviderError(message, retryable=True) from None
        return b''.join(chunks), response.headers.get('Content-Type')
    finally:
        response.close()
