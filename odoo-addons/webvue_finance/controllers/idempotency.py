# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``Idempotency-Key`` for the routes that create a document or a payment: a retry returns the first answer, nothing is created twice."""
import functools
import hashlib
import json
import re

from psycopg2 import IntegrityError

from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError

HEADER = 'Idempotency-Key'
KEY = re.compile(r'[A-Za-z0-9_.:-]{8,128}', re.ASCII)


def _request_hash():
    body = json.dumps(request.get_json_data(), sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(body.encode()).hexdigest()


def _answer(status, text):
    body = json.loads(text) if text else ''
    return body if status == 200 else request.make_json_response(body, status=status)


def idempotent(func):
    """Replay the stored answer of a request that repeats an ``Idempotency-Key``; without the header nothing changes.

    The key is claimed before the route runs and the answer is stored after it, in the route's own transaction: a refused
    or failed request leaves no key, so it can be sent again corrected. The same key with another route, user or body is
    422 ``idempotency_key_reused``; two requests with one key racing each other are 409 ``duplicate_request`` for the loser.
    """
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        key = request.httprequest.headers.get(HEADER)
        if key is None:
            return func(*args, **kwargs)
        if not KEY.fullmatch(key):
            raise ApiError(422, 'invalid', f'{HEADER} must be 8 to 128 letters, digits or _ . : -', field=HEADER)
        Store = request.env['webvue.finance.idempotency']
        Store._webvue_purge()
        digest = _request_hash()
        stored = Store.search([('company_id', '=', request.env.company.id), ('key', '=', key)], limit=1)
        if stored:
            same = (stored.method, stored.path, stored.user_id, stored.request_hash) == (
                request.httprequest.method, request.httprequest.path, request.env.user, digest,
            )
            if not same:
                raise ApiError(422, 'idempotency_key_reused', f'this {HEADER} was used for another request')
            return _answer(stored.status, stored.body)
        try:
            with request.env.cr.savepoint():
                claim = Store.create({
                    'company_id': request.env.company.id, 'key': key, 'method': request.httprequest.method,
                    'path': request.httprequest.path, 'user_id': request.env.user.id, 'request_hash': digest,
                })
        except IntegrityError:
            raise ApiError(409, 'duplicate_request', 'a request with this key is being processed') from None
        result = func(*args, **kwargs)
        status = getattr(result, 'status_code', 200)
        claim.write({'status': status, 'body': result.get_data(as_text=True) if hasattr(result, 'get_data') else json.dumps(result)})
        return result
    return wrapper
