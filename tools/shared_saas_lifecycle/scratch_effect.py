# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Scratch-only driver for the Phase 3 packages acceptance (plan 2026-10-07-phase-3b).

Runs the real provisioning policy script and the real subscription effect
(observe, reconfigure) against one scratch tenant through a local ``odoo shell``
command named by NASQ_SCRATCH_ODOO_SHELL (it takes the database name and reads
the script on stdin). It never installs a module: a reconfigure that asks for an
install fails with ``install_requested``, which is the spec 3.6 proof that a plan
change needs no install job. Database names must be ``nasq_scratch_<32 hex>``.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from tools.nasq_cli.managed_verify import build_policy_script, parse_snapshot
from tools.shared_saas_lifecycle import odoo_effect
from tools.shared_saas_lifecycle.odoo_effect import EffectError
from tools.shared_saas_lifecycle.subscription_effect import SubscriptionEffect


class ScratchShellRunner:
    """The SubscriptionEffect runner protocol over a local scratch ``odoo shell``."""

    def __init__(self, database, shell):
        self.database = odoo_effect.validate_database(database)
        self.shell = shell

    def database_exists(self):
        sql = "SELECT 1 FROM pg_database WHERE datname = '" + self.database + "'"
        done = subprocess.run(['psql', '-d', 'postgres', '-Atc', sql], capture_output=True, text=True,
                              timeout=60, check=False)
        return done.stdout.strip() == '1'

    def run_script(self, script, stage, mutate=False):
        done = subprocess.run([self.shell, self.database], input=script, capture_output=True, text=True,
                              timeout=900, check=False)
        return done.stdout

    def install_modules(self, names):
        raise EffectError('install_requested')


def main():
    request = json.loads(sys.stdin.read())
    runner = ScratchShellRunner(request['tenant']['database'], os.environ['NASQ_SCRATCH_ODOO_SHELL'])
    try:
        if request['action'] == 'provision':
            policy = request['policy']
            output = runner.run_script(build_policy_script(policy, runner.database), 'policy', mutate=True)
            result = parse_snapshot(output, policy, runner.database)
        else:
            effect = SubscriptionEffect(runner, Path(os.environ['NASQ_SCRATCH_JOURNAL']).resolve())
            result = effect.observe(request) if request['action'] == 'observe' else effect.reconfigure(request)
    except EffectError as error:
        print(json.dumps({'error_code': str(error)}))
        return 1
    except Exception as error:  # noqa: BLE001 -- acceptance evidence, scratch only
        print(json.dumps({'error_code': type(error).__name__ + ':' + str(getattr(error, 'code', ''))}))
        return 1
    print(json.dumps({'result': result}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
