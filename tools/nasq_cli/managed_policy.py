# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Side-effect-free validation of catalog-bound managed SaaS create policies.

The only I/O is reading the supplied catalog once. This module neither installs
modules nor applies Odoo entitlements. The caller owns publication authority for
``catalog_sha256``; a matching digest alone does not establish publication.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import NoReturn

POLICY_MAX_BYTES = 16384
_POLICY_KEYS = frozenset({'schema_version', 'channel', 'modules', 'features'})
_DIGEST = re.compile(r'sha256:[0-9a-f]{64}')
_IDENTIFIER = re.compile(r'[a-z][a-z0-9_]*')
_FEATURE = re.compile(r'(boolean|limit):([a-z][a-z0-9_.]*)')
_DEFAULT_LIMITS = ('users.limit', 'storage.limit_mb')


class PolicyError(ValueError):
    """Validation refusal: ``code`` and the message are stable, safe identifiers."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _fail(code: str) -> NoReturn:
    raise PolicyError(code) from None


class _DuplicateKey(ValueError):
    """Internal JSON signal; never retains the offending key or value."""


def _unique_object(pairs: list) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKey
        result[key] = value
    return result


def _reject_constant(_value: str):
    raise ValueError


def _decode(raw: bytes, *, catalog: bool = False):
    invalid = 'catalog_invalid' if catalog else 'policy_invalid'
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
    except _DuplicateKey:
        _fail('catalog_invalid' if catalog else 'policy_duplicate_key')
    except (ValueError, RecursionError):
        # Never echo parser diagnostics: they can contain policy text or secrets.
        _fail(invalid)


def _module_list(value) -> bool:
    return (type(value) is list
            and all(type(item) is str and _IDENTIFIER.fullmatch(item) for item in value)
            and len(value) == len(set(value)))


def _catalog_compositions(catalog) -> list[tuple[list[str], dict]]:
    """Validate consumed catalog fields and derive exactly the worker defaults.

    This is not the catalog publisher's schema/manifest/registry validation gate.
    Descriptive metadata and optional add-ons are not create-policy inputs.
    """
    if (type(catalog) is not dict
            or type(catalog.get('schema_version')) is not int
            or catalog['schema_version'] != 1
            or not _module_list(catalog.get('base_modules'))
            or not catalog['base_modules']
            or type(catalog.get('tiers')) is not list or not catalog['tiers']):
        _fail('catalog_invalid')
    compositions = []
    tier_ids = set()
    for tier in catalog['tiers']:
        if (type(tier) is not dict
                or type(tier.get('id')) is not str
                or not _IDENTIFIER.fullmatch(tier['id'])
                or tier['id'] in tier_ids
                or not _module_list(tier.get('modules'))
                or type(tier.get('features')) is not list):
            _fail('catalog_invalid')
        tier_ids.add(tier['id'])
        modules = catalog['base_modules'] + tier['modules']
        if len(modules) != len(set(modules)):
            _fail('catalog_invalid')
        features = dict.fromkeys(_DEFAULT_LIMITS)
        feature_keys = set()
        for descriptor in tier['features']:
            match = _FEATURE.fullmatch(descriptor) if type(descriptor) is str else None
            if match is None:
                _fail('catalog_invalid')
            kind, key = match.groups()
            if key in feature_keys or (key in _DEFAULT_LIMITS and kind != 'limit'):
                _fail('catalog_invalid')
            feature_keys.add(key)
            features[key] = True if kind == 'boolean' else None
        compositions.append((modules, features))
    return compositions


def parse_create_policy(raw: bytes, *, catalog_path: Path,
                        catalog_sha256: str, commercial_mode: str) -> dict:
    """Return a validated policy or raise :class:`PolicyError` with a safe code.

    Accept only a UTF-8 JSON object of at most 16 KiB, exact policy keys,
    ``schema_version=1`` (not ``True``), and SaaS/control-plane classification.
    Modules must be the exact ordered base-plus-one-tier catalog list. Features
    must exactly match worker ``policyForCreate``: both base limits are null,
    tier booleans are true and tier limits are null, never numeric ceilings.

    Hash the catalog's original bytes before parsing those same bytes. No global
    state, environment lookup, subprocess, database, network or writes are used.
    """
    if type(raw) is not bytes:
        _fail('policy_invalid')
    if len(raw) > POLICY_MAX_BYTES:
        _fail('policy_too_large')
    policy = _decode(raw)
    if (type(policy) is not dict or set(policy) != _POLICY_KEYS
            or type(policy['schema_version']) is not int or policy['schema_version'] != 1
            or type(policy['modules']) is not list
            or any(type(item) is not str for item in policy['modules'])
            or type(policy['features']) is not dict
            or any(type(item) not in (bool, type(None)) for item in policy['features'].values())):
        _fail('policy_invalid')
    if type(commercial_mode) is not str or commercial_mode != 'saas':
        _fail('commercial_mode_unsupported')
    if type(policy['channel']) is not str or policy['channel'] != 'control_plane':
        _fail('policy_channel_mismatch')
    if type(catalog_sha256) is not str or not _DIGEST.fullmatch(catalog_sha256):
        _fail('catalog_reference_invalid')
    if not isinstance(catalog_path, Path):
        _fail('catalog_unavailable')
    try:
        catalog_raw = catalog_path.read_bytes()
    except (OSError, ValueError):
        _fail('catalog_unavailable')
    if 'sha256:' + hashlib.sha256(catalog_raw).hexdigest() != catalog_sha256:
        _fail('catalog_digest_mismatch')
    compositions = _catalog_compositions(_decode(catalog_raw, catalog=True))
    for modules, features in compositions:
        if policy['modules'] == modules and policy['features'] == features:
            return policy
    _fail('policy_composition_mismatch')
