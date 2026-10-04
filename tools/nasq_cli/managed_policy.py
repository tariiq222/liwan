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
# One grammar: boolean:<key> | limit:<key> | limit:<key>:<int> (schema 2 only).
_FEATURE = re.compile(r'(boolean|limit):([a-z][a-z0-9_.]*)(?::(0|[1-9][0-9]{0,8}|1000000000))?')
_MAX_CEILING = 1000000000
DESCRIPTOR_GRAMMAR_V2 = 'limit:key | limit:key:<int> | boolean:key'
_DEFAULT_LIMITS = ('users.limit', 'storage.limit_mb')
# The complete set of stable, non-secret refusal codes PolicyError may carry.
# Nothing else (no raw output, no exception text) ever crosses the boundary.
POLICY_ERROR_CODES = frozenset({
    'policy_invalid', 'policy_too_large', 'policy_duplicate_key',
    'policy_channel_mismatch', 'commercial_mode_unsupported',
    'catalog_reference_invalid', 'catalog_unavailable',
    'catalog_digest_mismatch', 'catalog_invalid',
    'policy_composition_mismatch', 'package_authority_invalid',
    'package_authority_mismatch',
})


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
            or catalog['schema_version'] not in (1, 2)
            or not _module_list(catalog.get('base_modules'))
            or not catalog['base_modules']
            or type(catalog.get('tiers')) is not list or not catalog['tiers']):
        _fail('catalog_invalid')
    compositions = []
    tier_ids = set()
    schema = catalog['schema_version']
    if schema == 2 and catalog.get('descriptor_grammar') != DESCRIPTOR_GRAMMAR_V2:
        _fail('catalog_invalid')
    core = next((t for t in catalog['tiers'] if type(t) is dict and t.get('id') == 'core'), None)
    if schema == 2 and core is None:
        _fail('catalog_invalid')  # schema 2 composes every tier from `core`; no fallback
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
        # Legacy bytes seed the two default limits; schema 2 derives the complete
        # set purely from descriptors (every tier inherits the core tier's set).
        features = dict.fromkeys(_DEFAULT_LIMITS) if schema == 1 else {}
        feature_keys = set()
        descriptors = list(tier['features'])
        if schema == 2 and tier is not core:
            if type(core.get('features')) is not list:
                _fail('catalog_invalid')
            descriptors = core['features'] + descriptors
        for descriptor in descriptors:
            match = _FEATURE.fullmatch(descriptor) if type(descriptor) is str else None
            if match is None:
                _fail('catalog_invalid')
            kind, key, ceiling = match.groups()
            if (key in feature_keys or (key in _DEFAULT_LIMITS and kind != 'limit')
                    or (ceiling is not None and (kind != 'limit' or schema != 2))):
                _fail('catalog_invalid')
            feature_keys.add(key)
            features[key] = (True if kind == 'boolean'
                             else None if ceiling is None else int(ceiling))
        if schema == 2 and not set(_DEFAULT_LIMITS) <= set(features):
            _fail('catalog_invalid')
        compositions.append((modules, features))
    return compositions


def _same_features(actual: dict, expected: dict) -> bool:
    return (set(actual) == set(expected)
            and all(type(actual[key]) is type(value) and actual[key] == value
                    for key, value in expected.items()))


def parse_create_policy(raw: bytes, *, catalog_path: Path,
                        catalog_sha256: str, commercial_mode: str) -> dict:
    """Return a validated policy or raise :class:`PolicyError` with a safe code.

    Accept only a UTF-8 JSON object of at most 16 KiB, exact policy keys,
    ``schema_version=1`` (not ``True``), and SaaS/control-plane classification.
    Modules must be the exact ordered base-plus-one-tier catalog list. Features
    must exactly match worker ``policyForCreate``: both base limits are null,
    tier booleans are true and tier limits are null; only schema-2 catalogs may
    declare a numeric ceiling (``limit:<key>:<int>``), which must match exactly.

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
            or any(type(item) not in (bool, int, type(None)) for item in policy['features'].values())):
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
    catalog = _decode(catalog_raw, catalog=True)
    compositions = _catalog_compositions(catalog)
    if (type(catalog) is dict and catalog.get('schema_version') == 1
            and any(type(item) is int for item in policy['features'].values())):
        _fail('policy_invalid')  # legacy bytes never carry numeric ceilings
    for modules, features in compositions:
        if policy['modules'] == modules and _same_features(policy['features'], features):
            return policy
    _fail('policy_composition_mismatch')


def parse_package_create_policy(raw: bytes, *, catalog_path: Path,
                                catalog_sha256: str, commercial_mode: str,
                                package_reference: dict, trusted_authority: dict) -> dict:
    """Validate v2 package authority independently resolved by the worker.

    ``trusted_authority`` is a separate IPC field supplied by the control worker
    after reading the tenant's pinned immutable server record and comparing the
    queued job. Never populate it from an HTTP caller or the job itself. The
    package digest identifies content; it is deliberately not a signature.
    Legacy ``parse_create_policy`` retains its null-only contract.
    """
    if type(raw) is not bytes or len(raw) > POLICY_MAX_BYTES:
        _fail('policy_invalid')
    policy = _decode(raw)
    keys = {'schemaVersion', 'revisionId', 'digest', 'catalog', 'policy'}
    authority = trusted_authority
    if (type(authority) is not dict or set(authority) != keys
            or type(authority['schemaVersion']) is not int or authority['schemaVersion'] != 2
            or type(authority['revisionId']) is not str
            or not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', authority['revisionId'])
            or type(authority['digest']) is not str or not re.fullmatch(r'[0-9a-f]{64}', authority['digest'])
            or type(authority['catalog']) is not dict
            or set(authority['catalog']) != {'version', 'tier', 'sourceSha256'}):
        _fail('package_authority_invalid')
    # Canonical JSON equality distinguishes true/1 and integer/fractional values.
    try:
        if (json.dumps(package_reference, sort_keys=True, allow_nan=False)
                != json.dumps(authority, sort_keys=True, allow_nan=False)
                or json.dumps(policy, sort_keys=True, allow_nan=False)
                != json.dumps(authority['policy'], sort_keys=True, allow_nan=False)):
            _fail('package_authority_mismatch')
    except (TypeError, ValueError):
        _fail('package_authority_mismatch')
    reference = authority['catalog']
    if (any(type(reference[k]) is not str for k in reference)
            or not re.fullmatch(r'[a-zA-Z0-9._-]{1,100}', reference['version'])
            or not re.fullmatch(r'[a-z][a-z0-9._-]{0,63}', reference['tier'])
            or 'sha256:' + reference['sourceSha256'] != catalog_sha256
            or not _DIGEST.fullmatch(catalog_sha256)):
        _fail('catalog_reference_invalid')
    if commercial_mode != 'saas':
        _fail('commercial_mode_unsupported')
    if (type(policy) is not dict or set(policy) != _POLICY_KEYS
            or type(policy['schema_version']) is not int or policy['schema_version'] != 1
            or policy['channel'] != 'control_plane' or not _module_list(policy['modules'])
            or type(policy['features']) is not dict):
        _fail('policy_invalid')
    try:
        catalog_raw = catalog_path.read_bytes()
    except (AttributeError, OSError, ValueError):
        _fail('catalog_unavailable')
    if 'sha256:' + hashlib.sha256(catalog_raw).hexdigest() != catalog_sha256:
        _fail('catalog_digest_mismatch')
    catalog = _decode(catalog_raw, catalog=True)
    compositions = _catalog_compositions(catalog)
    for tier, (modules, features) in zip(catalog['tiers'], compositions):
        if tier['id'] != reference['tier']:
            continue
        if policy['modules'] != modules or set(policy['features']) != set(features):
            _fail('policy_composition_mismatch')
        for key, expected in features.items():
            actual = policy['features'][key]
            if expected is True:
                if actual is not True:
                    _fail('policy_composition_mismatch')
            elif type(expected) is int and type(expected) is not bool:
                # A catalog-declared ceiling is fixed; operators cannot override it.
                if type(actual) is not int or actual != expected:
                    _fail('policy_composition_mismatch')
            elif actual is not None and (type(actual) is not int or not 0 <= actual <= 1000000000):
                _fail('policy_invalid')
        return policy
    _fail('policy_composition_mismatch')
