"""Local-only operator entry point. Never fetches, commits, publishes or deploys."""
import argparse
import json
from pathlib import Path
import sys

from .engine import ReleaseEngine
from .manifest import NAME, classify_release, load_manifest, manifest_digest
from .runtime import LocalRuntime
from .state import ReleaseState, safe_directory, sync_directory, validate_route


def canonical_path(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or path.resolve() != path or path.is_symlink():
        raise ValueError('operator_path_rejected')
    return path


def local_path(value, *, directory=False):
    path = canonical_path(value)
    if not (path.is_dir() if directory else path.is_file()):
        raise ValueError('operator_path_rejected')
    return path


def document(path):
    path = local_path(path)
    if path.stat().st_size > 1048576:
        raise ValueError('operator_document_rejected')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('operator_document_rejected')
            result[key] = value
        return result
    return json.loads(path.read_text(), object_pairs_hook=unique)


def bootstrap_evidence(binding, route, evidence):
    """Explicit offline observations, supplied by the trusted local operator.

    This records observations; it cannot itself stop the edge or prove that a
    remote service was stopped. Never bootstrap an admitted live tenant.
    """
    fields = {'schemaVersion', 'tenantId', 'database', 'filestore', 'identityRevision',
              'poolId', 'releaseId', 'fence', 'edgeOffline', 'cronStopped',
              'admittedWriters', 'activeTransactions', 'oldConnections', 'reviewer', 'reference'}
    if (not isinstance(evidence, dict) or set(evidence) != fields
            or type(evidence['schemaVersion']) is not int or evidence['schemaVersion'] != 1):
        raise ValueError('offline_bootstrap_evidence_rejected')
    expected = {**{key: binding[key] for key in ('tenantId', 'database', 'filestore')},
                **{key: route[key] for key in ('identityRevision', 'poolId', 'releaseId', 'fence')}}
    if any(evidence[key] != value for key, value in expected.items()):
        raise ValueError('offline_bootstrap_evidence_rejected')
    if (any(type(evidence[key]) is not int or evidence[key] < 1 for key in ('identityRevision', 'fence'))
            or evidence['edgeOffline'] is not True or evidence['cronStopped'] is not True
            or any(type(evidence[key]) is not int or evidence[key] != 0
                   for key in ('admittedWriters', 'activeTransactions', 'oldConnections'))
            or any(not isinstance(evidence[key], str) or not NAME.fullmatch(evidence[key])
                   for key in ('reviewer', 'reference'))):
        raise ValueError('offline_bootstrap_evidence_rejected')


def arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    required = {
        'classify': ('base', 'target', 'manifest', 'installed-modules'),
        'bundle-prepare': ('source-output', 'releases', 'release-id', 'source-digest'),
        'bundle-verify': ('bundle', 'source-digest'),
        'backup-current': ('state', 'binding', 'runtime', 'request-id', 'output'),
        'render': ('manifest', 'operator-config'),
        'restore': ('backup', 'binding', 'runtime'),
        'bootstrap': ('state', 'binding', 'route', 'bootstrap-evidence'),
        'status': ('state', 'request'),
        'schedule-once': ('state', 'manifest', 'runtime'),
        'plan': ('state', 'request', 'manifest', 'runtime'),
        'apply': ('state', 'request', 'manifest', 'runtime'),
        'reconcile': ('state', 'request', 'manifest', 'runtime'),
        'ai-apply': ('state', 'request', 'manifest', 'runtime'),
    }
    for action, options in required.items():
        command = actions.add_parser(action)
        for option in options:
            command.add_argument('--' + option, required=True)
        if action == 'ai-apply':
            command.add_argument('--migration-adapter')
    return parser.parse_args(argv)


def main(argv=None):
    args = arguments(argv)
    try:
        if args.action == 'backup-current':
            from .backup_operation import backup_current
            state = ReleaseState(local_path(args.state, directory=True))
            binding = document(args.binding)
            runtime = LocalRuntime(state, document(args.runtime))
            output = canonical_path(args.output)
            # backup_current validates the capture itself, inside its one budget.
            result = backup_current(state, runtime, binding, args.request_id, output)
            print(json.dumps(result, sort_keys=True))
            return 0
        if args.action == 'bundle-prepare':
            from .bundle import prepare_bundle
            result = prepare_bundle(local_path(args.source_output, directory=True), canonical_path(args.releases), args.release_id, args.source_digest)
            print(json.dumps(result, sort_keys=True))
            return 0
        if args.action == 'bundle-verify':
            from .bundle import verify_bundle
            result = verify_bundle(local_path(args.bundle, directory=True), args.source_digest)
            print(json.dumps(result, sort_keys=True))
            return 0
        if args.action == 'classify':
            installed = document(args.installed_modules)
            if not isinstance(installed, list) or len(installed) != len(set(installed)):
                raise ValueError('installed_modules_rejected')
            result = classify_release(local_path(args.base, directory=True), local_path(args.target, directory=True),
                                      load_manifest(local_path(args.manifest)), installed_modules=installed)
            print(json.dumps(result, sort_keys=True))
            return 0 if result['eligible'] else 1
        if args.action == 'render':
            from .compose import render_pool
            result = render_pool(load_manifest(local_path(args.manifest)), document(args.operator_config))
            print(json.dumps(result, sort_keys=True))
            return 0
        if args.action == 'restore':
            from .backup import restore_tenant
            binding, config = document(args.binding), document(args.runtime)
            if not isinstance(binding.get('database'), str) or not binding['database'].startswith('webvue_scratch_'):
                raise ValueError('protected_database_rejected')
            result = restore_tenant(local_path(args.backup, directory=True), binding, config)
            print(json.dumps(result, sort_keys=True))
            return 0
        if args.action == 'bootstrap':
            binding, route = document(args.binding), document(args.route)
            if not binding['database'].startswith('webvue_scratch_'):
                raise ValueError('protected_database_rejected')
            validate_route(route)
            if (binding['filestore'] != binding['database'] or binding['tenantId'] != route['tenantId']
                    or type(binding['registryRevision']) is not int or binding['registryRevision'] != route['identityRevision']):
                raise ValueError('tenant_binding_mismatch')
            bootstrap_evidence(binding, route, document(args.bootstrap_evidence))
            state = ReleaseState(canonical_path(args.state))
            safe_directory(state.routes / 'leases')
            sync_directory(state.routes)
            state.register(binding, route)
            result = {'registered': True, 'tenantId': binding['tenantId'], 'maintenanceRequired': True,
                      'offlineBootstrap': True}
            print(json.dumps(result, sort_keys=True))
            return 0
        state = ReleaseState(canonical_path(args.state))
        if args.action=='status':
            result=state.receipt(document(args.request)['requestId'])
        else:
            manifest=load_manifest(local_path(args.manifest))
            if args.action=='ai-apply':
                from .ai_maintenance import AiMaintenanceCoordinator,ReviewedAiMigration
                import hashlib
                import subprocess
                config=document(args.runtime)
                migration=None
                if args.migration_adapter:
                    path=local_path(args.migration_adapter)
                    adapter_digest=hashlib.sha256(path.read_bytes()).hexdigest()
                    if adapter_digest!=manifest['compatibilityEvidence'].get('aiMigrationDigest'):raise ValueError('migration_adapter_unreviewed')
                    adapter_bytes=path.read_bytes()
                    if hashlib.sha256(adapter_bytes).hexdigest()!=adapter_digest:raise ValueError('migration_adapter_changed')
                    def action(context):
                        # Execute the exact bytes reviewed above; never reread a mutable path after drain.
                        result=subprocess.run([sys.executable,'-c',adapter_bytes.decode('utf-8')],input=json.dumps(context),text=True,capture_output=True,timeout=600,check=True)
                        return json.loads(result.stdout)
                    migration=ReviewedAiMigration(config['sharedStateId'],config['oldServices'][0]['aiStateVersion'],manifest['aiStateVersion'],manifest['compatibilityEvidence']['reference'],adapter_digest,action)
                result=AiMaintenanceCoordinator(state,config,migration).apply(document(args.request),manifest)
                print(json.dumps(result,sort_keys=True));return 0
            runtime=LocalRuntime(state,document(args.runtime))
            engine=ReleaseEngine(state,runtime)
            if args.action=='schedule-once':
                from .odoo_gateway import OdooBookingGateway
                from .scheduler import MaintenanceScheduler,ReleaseEngineAdapter,ReleaseTarget
                target=ReleaseTarget(manifest,manifest_digest(manifest),runtime.config['targetPool'],manifest['mode'])
                scheduler=MaintenanceScheduler(OdooBookingGateway(state,runtime,manifest),ReleaseEngineAdapter(engine,{manifest['releaseId']:target}),capacity=runtime.config.get('maintenanceCapacity',1))
                result={'results':scheduler.run_once()}
            else:
                request=document(args.request)
                if request['targetPool']!=runtime.config['targetPool']:raise ValueError('target_pool_mismatch')
                result=getattr(engine,args.action)(request,manifest)
        print(json.dumps(result,sort_keys=True));return 0
    except Exception as error:
        # Inputs, DB/HTTP/subprocess errors may contain secrets. Public CLI emits a class only.
        print(json.dumps({'error':'local_release_refused','errorType':type(error).__name__}),file=sys.stderr)
        return 1


if __name__=='__main__':raise SystemExit(main())
