"""The release document's identity: its fields, their formats and their validation.

Validation is a format check only; it does not establish semantic compatibility or
authorize a deployment.
"""
import json
from pathlib import Path
import re

NAME = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$')
MODULE = re.compile(r'^[a-z][a-z0-9_]*$')
IMAGE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$')
MODES = {'online', 'tenant_maintenance', 'service_maintenance', 'infrastructure_maintenance'}
SERVICES = {'odoo', 'web', 'guard', 'ai', 'database', 'edge', 'storage', 'host'}
FIELDS = {'releaseId', 'liwanCommit', 'odooCommit', 'images', 'assetsId', 'moduleVersions',
          'upgradeModules', 'installModules', 'mode', 'affectedServices', 'aiStateVersion',
          'compatibilityEvidence', 'rollbackPolicy'}


class FrozenDict(dict):
    """JSON-serializable immutable mapping, including its nested values."""
    def _reject(self, *args, **kwargs):
        raise TypeError('immutable_release')
    __setitem__ = __delitem__ = clear = pop = popitem = setdefault = update = __ior__ = _reject

    def __deepcopy__(self, memo):
        return self


def _freeze(value):
    if isinstance(value, dict):
        return FrozenDict({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _valid_name(value, pattern=NAME):
    return isinstance(value, str) and bool(pattern.fullmatch(value))


def validate_manifest(value):
    """Reject malformed or ambiguous identity; never include inputs in errors."""
    try:
        if not isinstance(value, dict) or set(value) != FIELDS:
            raise ValueError()
        for key in ('releaseId', 'assetsId', 'aiStateVersion'):
            if not _valid_name(value[key]):
                raise ValueError()
        for key in ('liwanCommit', 'odooCommit'):
            if not isinstance(value[key], str) or not re.fullmatch('[a-f0-9]{40}', value[key]):
                raise ValueError()
        images = value['images']
        if not isinstance(images, dict) or not {'odoo', 'web'} <= images.keys() or set(images) - {'odoo', 'web', 'guard', 'ai'}:
            raise ValueError()
        if any(not isinstance(image, str) or not IMAGE.fullmatch(image) for image in images.values()):
            raise ValueError()
        versions = value['moduleVersions']
        if not isinstance(versions, dict) or any(not _valid_name(key, MODULE) or not isinstance(version, str)
                or not re.fullmatch(r'19\.0(?:\.\d+){1,3}', version) for key, version in versions.items()):
            raise ValueError()
        for key in ('upgradeModules', 'installModules', 'affectedServices'):
            items = value[key]
            if not isinstance(items, (list, tuple)) or len(set(items)) != len(items):
                raise ValueError()
            if any(not _valid_name(item, MODULE) for item in items):
                raise ValueError()
        if (set(value['upgradeModules']) | set(value['installModules'])) - versions.keys():
            raise ValueError()
        if not value['affectedServices'] or set(value['affectedServices']) - SERVICES:
            raise ValueError()
        if value['mode'] not in MODES:
            raise ValueError()
        evidence, rollback = value['compatibilityEvidence'], value['rollbackPolicy']
        if not isinstance(evidence, dict) or not isinstance(rollback, dict):
            raise ValueError()
        if not _valid_name(evidence.get('reviewer')) or not _valid_name(evidence.get('reference')):
            raise ValueError()
        if 'reviewedPaths' in evidence:
            if not isinstance(evidence['reviewedPaths'], (list, tuple)) or any(
                    not isinstance(path, str) or Path(path).is_absolute() or '..' in Path(path).parts
                    or '\\' in path for path in evidence['reviewedPaths']):
                raise ValueError()
        if value['mode'] == 'online':
            if value['upgradeModules'] or value['installModules'] or rollback.get('oldWritesCompatible') is not True:
                raise ValueError()
            if any(evidence.get(key) is not True for key in (
                    'apiCompatible', 'sessionCompatible', 'concurrentWritesCompatible', 'jobsCompatible')):
                raise ValueError()
            if 'ai' in images and evidence.get('aiCompatible') is not True:
                raise ValueError()
        # JSON-only values: reject hidden executable/unserializable input.
        json.dumps(value, allow_nan=False)
    except (ValueError, TypeError, KeyError):
        raise ValueError('release_manifest_rejected') from None
    return _freeze(value)
