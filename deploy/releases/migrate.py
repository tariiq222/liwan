"""Run stock Odoo maintenance and read-only ORM verification locally.

No SQL against Odoo tables, private model overrides or alternative agent engine.
The operator owns admission/fencing and source/image provenance.
"""
import json
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
from .backup import _path, _tool, _run, _quiescent
from .manifest import validate_manifest
from .postgres import identifier

MARKER = 'WEBVUE_RELEASE_OBSERVATION='
PROFILE_FIELDS = {'commercial_mode', 'entitlement_source', 'status', 'root_company_id'}


def pinned_oca_dirs(webvue_root, oca_dir):
    """Directories of the pinned OCA repositories under ``oca_dir``, verified at their pins.

    Pins and verifier come from the verified WebVue source root. Empty when no ``ocaDir`` is configured.
    """
    if oca_dir is None: return set()
    script = webvue_root / 'tools' / 'oca_addons.py'
    spec = importlib.util.spec_from_file_location('webvue_oca_addons', script)
    if spec is None or spec.loader is None or not script.is_file(): raise ValueError('addons_paths_rejected')
    oca = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oca)
    try:
        pins = oca.load_pins(webvue_root / 'deploy' / 'oca-addons.json')
        oca.verify_all(pins, oca_dir)
    except oca.OcaError:
        raise ValueError('addons_paths_rejected') from None
    return {str(oca.repo_dir(oca_dir, entry['repo'])) for entry in pins['repos']}


def source_tree_digest(webvue_root):
    """Identify the exact local addon bytes, including authorized uncommitted work."""
    root = _path(webvue_root, exists=True, directory=True) / 'odoo-addons'
    if not root.is_dir() or root.is_symlink(): raise ValueError('source_tree_rejected')
    digest = hashlib.sha256()
    for directory, folders, files in os.walk(root, followlinks=False):
        folders[:] = sorted(name for name in folders if name not in {'__pycache__', '.git'})
        for name in [*folders, *files]:
            if (Path(directory) / name).is_symlink(): raise ValueError('source_tree_rejected')
        for name in sorted(files):
            path = Path(directory) / name
            if path.suffix in {'.pyc', '.pyo'}: continue
            relative = path.relative_to(root).as_posix().encode()
            data = path.read_bytes()
            digest.update(len(relative).to_bytes(8, 'big')); digest.update(relative)
            digest.update(len(data).to_bytes(8, 'big')); digest.update(data)
    return digest.hexdigest()


def _local(binding, manifest, config):
    if config.get('mode') != 'local': raise ValueError('unsupported_runtime_mode')
    identifier(binding.get('database'))
    if not binding['database'].startswith('webvue_scratch_'): raise ValueError('protected_database_rejected')
    identity = config.get('sourceIdentity', {})
    if (identity.get('webvueCommit') != manifest['webvueCommit'] or identity.get('odooCommit') != manifest['odooCommit']
            or identity.get('image') != manifest['images']['odoo']): raise ValueError('source_identity_mismatch')
    if identity.get('treeDigest') != source_tree_digest(config['webvueRoot']):
        raise ValueError('source_identity_mismatch')
    roots = {key: _path(config[key], exists=True, directory=True) for key in ('odooRoot', 'webvueRoot')}
    git = shutil.which('git')
    if not git: raise ValueError('source_verification_unavailable')
    for key, commit_key in (('odooRoot', 'odooCommit'), ('webvueRoot', 'webvueCommit')):
        actual = _run([git, '-C', str(roots[key]), 'rev-parse', 'HEAD'], config).strip()
        if actual != manifest[commit_key]: raise ValueError('source_identity_mismatch')
        if key == 'odooRoot' and _run([git, '-C', str(roots[key]), 'status', '--porcelain', '--untracked-files=all'], config).strip():
            raise ValueError('source_tree_dirty')
    python, launcher = _tool(config['python']), str(_path(config['launcher'], exists=True))
    conf = str(_path(config['odooConfig'], exists=True))
    data = str(_path(config['dataDir'], exists=True, directory=True))
    state = _path(config['stateDir'], exists=True, directory=True)
    if 'scratch' not in state.name: raise ValueError('scratch_state_rejected')
    addons = config.get('addonsPaths')
    if not isinstance(addons, (list, tuple)) or not addons: raise ValueError('addons_paths_rejected')
    addons = [str(_path(path, exists=True, directory=True)) for path in addons]
    allowed_addons = {str(roots['webvueRoot'] / 'odoo-addons'), str(roots['odooRoot'] / 'addons'),
                      str(roots['odooRoot'] / 'odoo' / 'addons')}
    oca_dir = config.get('ocaDir')
    allowed_addons |= pinned_oca_dirs(roots['webvueRoot'], _path(oca_dir, exists=True, directory=True) if oca_dir else None)
    if (set(addons) - allowed_addons or str(roots['webvueRoot'] / 'odoo-addons') not in addons
            or any(',' in path for path in addons)):
        raise ValueError('addons_paths_rejected')
    profile = config.get('expectedProfile')
    if not isinstance(profile, dict) or not profile or set(profile) - PROFILE_FIELDS: raise ValueError('profile_expectation_rejected')
    return [python, launcher, '--odoo-root', str(roots['odooRoot'])], [
        '--config=' + conf, '--addons-path=' + ','.join(addons), '--data-dir=' + data,
        '--database=' + binding['database'], '--no-http', '--max-cron-threads=0', '--logfile=' + str(state / 'odoo.log')]


def _observation_script(modules, profile_fields):
    """Use installed DB version (latest_version), not the confusing disk field."""
    return "\n".join([
        'import json',
        'env.cr.rollback()',
        'env.cr.execute("SET TRANSACTION READ ONLY")',
        'names = ' + repr(list(modules)),
        "rows = env['ir.module.module'].search_read([('name', 'in', names)], ['name', 'state', 'latest_version'])",
        "pending = env['ir.module.module'].search_count([('state', 'in', ['to upgrade', 'to install', 'to remove'])])",
        "profiles = env['webvue.tenant.profile'].search_read([], " + repr(list(profile_fields)) + ', limit=2)',
        "profile = {key: (value[0] if key == 'root_company_id' and value else value) for key, value in profiles[0].items() if key != 'id'} if len(profiles) == 1 else {}",
        "observation = {'database': env.cr.dbname, 'moduleVersions': {row['name']: row['latest_version'] for row in rows}, 'moduleStatesReady': pending == 0 and len(rows) == len(names) and all(row['state'] == 'installed' for row in rows), 'profile': profile, 'readOnly': True}",
        "print('" + MARKER + "' + json.dumps(observation, sort_keys=True))",
        'env.cr.rollback()',
    ]) + '\n'


def verify_tenant(binding, manifest, config):
    """Read module states/installed versions/profile through stock Odoo shell."""
    manifest = validate_manifest(manifest)
    launcher, options = _local(binding, manifest, config)
    script = _observation_script(sorted(manifest['moduleVersions']), sorted(config['expectedProfile']))
    output = _run([*launcher, 'shell', *options, '--shell-interface=python'], config, input=script, read_only=True)
    try:
        lines = [line[len(MARKER):] for line in output.splitlines() if line.startswith(MARKER)]
        if len(lines) != 1: raise ValueError()
        observed = json.loads(lines[0])
        if (observed.get('database') != binding['database'] or observed.get('moduleStatesReady') is not True
                or observed.get('readOnly') is not True or observed.get('moduleVersions') != manifest['moduleVersions']
                or any(observed.get('profile', {}).get(key) != value for key, value in config['expectedProfile'].items())):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError('odoo_verification_failed') from None
    return observed


def migrate_tenant(binding, manifest, config, fence):
    """Run one explicit upgrade/install; never retry a partially failed upgrade."""
    manifest = validate_manifest(manifest)
    if (type(fence) is not int or fence < 1 or fence != binding.get('fence')
            or manifest['mode'] != 'tenant_maintenance'):
        raise ValueError('migration_fence_rejected')
    _quiescent(binding, config.get('quiescence'))
    if config.get('recheck'): _quiescent(binding, config['recheck'](binding))
    upgrades, installs = manifest['upgradeModules'], manifest['installModules']
    if not upgrades and not installs: raise ValueError('migration_operations_missing')
    launcher, options = _local(binding, manifest, config)
    operations = []
    if upgrades: operations.append('--update=' + ','.join(sorted(upgrades)))
    if installs: operations.append('--init=' + ','.join(sorted(installs)))
    _run([*launcher, 'server', *options, '--stop-after-init', *operations], config)
    if config.get('recheck'): _quiescent(binding, config['recheck'](binding))
    observed = verify_tenant(binding, manifest, config)
    return {'migrated': True, 'database': binding['database'], 'fence': fence,
            'releaseId': manifest['releaseId'], 'runtimeMode': 'local-source',
            'image': manifest['images']['odoo'], 'treeDigest': config['sourceIdentity']['treeDigest'], 'verification': observed}


def readiness_probe(config_for_binding, manifest, pool_identity_probe):
    """Build the probe_pool callback using ORM and independent runtime evidence.

    config_for_binding(binding) supplies that tenant's trusted local config.
    pool_identity_probe(pool,binding) must independently inspect running services,
    pinned images, existing session/filestore readability and AI/assets versions.
    Local source verification cannot prove a running container's image identity.
    """
    manifest = validate_manifest(manifest)
    def probe(pool, binding):
        observed = verify_tenant(binding, manifest, config_for_binding(binding))
        identity = pool_identity_probe(pool, binding)
        if not isinstance(identity, dict): raise ValueError('runtime_identity_missing')
        return {**identity, 'database': observed['database'], 'moduleVersions': observed['moduleVersions'],
                'moduleStatesReady': observed['moduleStatesReady'], 'databaseReady': True, 'readOnly': True}
    return probe
