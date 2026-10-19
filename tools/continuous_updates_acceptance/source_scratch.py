"""Actual source-process acceptance adapter, deliberately separate from Docker evidence.

The product operator uses Docker inspection. This lab adapter checks live local
processes, their configuration and source bytes; it never claims image proof or
production cron acceptance.
"""
import configparser
import hashlib
import os
from pathlib import Path
import shlex
import subprocess

from deploy.releases.migrate import source_tree_digest
from deploy.releases.runtime import LocalRuntime
from deploy.releases.state import ReleaseConflict


class SourceScratchRuntime(LocalRuntime):
    def __init__(self, state, config):
        if config.get('evidenceMode') != 'local-source' or config.get('jobsRequired') is not False:
            raise ValueError('source_acceptance_scope_required')
        super().__init__(state, config, inspector=self._source_pool, role_inspector=self._source_role,
                         inventory_inspector=lambda _: None)

    def _source_role(self, container, expected, **options):
        if options: raise ReleaseConflict('source_cron_not_verified')
        process = self.config['pools'][expected['poolId']]['sourceProcess']
        if type(process['pid']) is not int or process['pid'] < 2: raise ValueError('source_pid_invalid')
        os.kill(process['pid'], 0)
        argv = shlex.split(subprocess.check_output(['ps', '-p', str(process['pid']), '-o', 'command='], text=True))
        config = Path(process['configPath'])
        workers=process.get('workers',0)
        if (type(workers) is not int or not 0<=workers<=4
                or str(config) not in argv or '--max-cron-threads=0' not in argv or '--workers='+str(workers) not in argv
                or '--addons-path=' + process['addonsPath'] not in argv
                or hashlib.sha256(config.read_bytes()).hexdigest() != process['configDigest']
                or source_tree_digest(process['sourceRoot']) != process['treeDigest']):
            raise ReleaseConflict('source_process_changed')
        parser = configparser.ConfigParser(interpolation=None)
        parser.read(config)
        if parser['options']['db_user'] != expected['dbUser'] or parser['options']['db_host'] != '127.0.0.1':
            raise ReleaseConflict('source_runtime_role_mismatch')
        return {'ready': True, 'dbUser': expected['dbUser'], 'running': True,
                'bindingProof': 'local-source-process-and-config', 'pid': process['pid'], 'httpWorkers':workers}

    def _source_pool(self, pool, manifest):
        process = self.config['pools'][pool]['sourceProcess']
        if process['treeDigest'] != self.config['migration']['sourceIdentity']['treeDigest']:
            raise ReleaseConflict('source_manifest_mismatch')
        return {'ready': True, 'runtimeMode': 'local-source', 'releaseId': manifest['releaseId'], 'poolId': pool}

    def activate_jobs(self, binding, current):
        return {'ready': True, 'jobs': 0, 'scope': 'HTTP-only-source-lab-cron-excluded'}
