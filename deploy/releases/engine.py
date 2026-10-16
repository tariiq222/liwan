# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Rollout state machine. Runtime observations are required at every irreversible boundary."""
from __future__ import annotations

from .manifest import validate_manifest, manifest_digest
from .state import ReleaseConflict, name, digest


class ReleaseEngine:
    def __init__(self, state, runtime):
        self.state, self.runtime = state, runtime

    def plan(self, request, manifest):
        manifest = validate_manifest(manifest)
        if request.get('manifestDigest') != manifest_digest(manifest) or request.get('approvedMode') != manifest['mode']:
            raise ReleaseConflict('release_manifest_or_approval_mismatch')
        if manifest['mode'] not in ('online', 'tenant_maintenance'):
            raise ReleaseConflict('shared_service_requires_separate_approved_window')
        tenants = request.get('tenantIds')
        if not isinstance(tenants, (tuple, list)) or len(tenants) != 1:
            raise ValueError('release_tenant_list_invalid')
        name(request['targetPool']); name(request['requestId'])
        result = []
        for tenant in tenants:
            binding = self.state.binding(name(tenant)); route = self.state.route(tenant)
            if request.get('expectedRoutes', {}).get(tenant) != route['routeRevision']:
                raise ReleaseConflict('release_route_conflict')
            if route.get('draining'):
                raise ReleaseConflict('previous_release_not_drained')
            if route['releaseId'] == manifest['releaseId']:
                raise ReleaseConflict('release_already_current')
            self._ready(self.runtime.prepare(binding,manifest,request['targetPool']))
            result.append({'binding': binding, 'route': route})
        return {'requestId': request['requestId'], 'mode': manifest['mode'], 'tenants': result}

    def apply(self, request, manifest):
        # Exact retries consult a durable receipt before checking a now-advanced route.
        manifest = validate_manifest(manifest)
        if request.get('manifestDigest') != manifest_digest(manifest) or request.get('approvedMode') != manifest['mode']:
            raise ReleaseConflict('release_manifest_or_approval_mismatch')
        self.state.request(request['requestId'], request)
        receipt = self.state.receipt(request['requestId'])
        if receipt['stage'] == 'verified':
            return receipt
        if receipt['stage'] == 'needs_intervention':
            raise ReleaseConflict('release_requires_reconciliation')
        if receipt['stage'] in ('draining_old','retired_old'):
            return self._finish_drain(request, manifest)
        if receipt['tenants']:
            raise ReleaseConflict('release_interrupted_requires_reconciliation')
        plan = self.plan(request, manifest)
        manifest = validate_manifest(manifest)
        # One maintenance admission at a time on this coordinator, including other processes.
        with self.state.locked('global_maintenance' if plan['mode'] != 'online' else 'global_publication'):
            for item in plan['tenants']:
                binding, old = item['binding'], item['route']
                tenant = binding['tenantId']
                with self.state.locked(tenant):
                    if self.state.route(tenant)['routeRevision'] != old['routeRevision']:
                        raise ReleaseConflict('release_route_conflict')
                    self.state.stage(request['requestId'],tenant,'prepared',old['fence'])
                    try:
                        self._ready(self.runtime.prepare(binding,manifest,request['targetPool']))
                        if plan['mode'] != 'online':
                            self.state.maintenance(tenant,old['fence'])
                            self._ack(binding,old,maintenance=True)
                            proof = self.runtime.quiesce(binding,old)
                            self._quiescent(proof,binding,old)
                            backup = self.runtime.capture(binding,proof)
                            if backup.get('fence') != old['fence'] or not backup.get('digest'):
                                raise ReleaseConflict('release_backup_unverified')
                            self.state.stage(request['requestId'],tenant,'backed_up',old['fence'],backup_digest=backup['digest'])
                            self.state.stage(request['requestId'],tenant,'migrating',old['fence'])
                            migrated = self.runtime.migrate(binding,manifest,proof)
                            if migrated.get('fence') != old['fence'] or not migrated.get('digest'):
                                raise ReleaseConflict('release_migration_unverified')
                            self.state.stage(request['requestId'],tenant,'validating',old['fence'],migration_digest=migrated['digest'])
                        self._ready(self.runtime.verify(binding,manifest,request['targetPool']))
                        target = {**old,'routeRevision': old['routeRevision']+1,'releaseId':manifest['releaseId'], 'poolId':request['targetPool'],'fence':old['fence']+1,'state':'serving'}
                        target['draining'] = [*old.get('draining',[]),{key:old[key] for key in ('poolId','releaseId','routeRevision','fence')}]
                        if manifest.get('aiStateVersion'):
                            target['aiStateVersion'] = manifest['aiStateVersion']
                        self.state.publish(target,expected_revision=old['routeRevision'])
                        self._ack(binding,target,maintenance=plan['mode']!='online')
                        if plan['mode'] != 'online':
                            self.runtime.block_generation(binding,old)
                            self.state.resume(tenant,old['fence'])
                        self.state.stage(request['requestId'],tenant,'draining_old',target['fence'])
                        retired=self.runtime.retire(binding,old,target)
                        if retired.get('drained') is True:
                            self._complete_retirement(request['requestId'],tenant,target,retired)
                    except Exception as error:
                        # Never reopen a partially migrated database or replay a failed migration.
                        if self.state.receipt(request['requestId'])['stage'] != 'retired_old':
                            self.state.stage(request['requestId'],tenant,'needs_intervention',old['fence'],error=type(error).__name__)
                        raise
                    if self.state.receipt(request['requestId'])['stage'] != 'verified':
                        break
        return self.state.receipt(request['requestId'])

    def _finish_drain(self, request, manifest):
        if request.get('manifestDigest') != manifest_digest(validate_manifest(manifest)):
            raise ReleaseConflict('release_manifest_mismatch')
        receipt = self.state.receipt(request['requestId'])
        for operation in receipt['tenants']:
            if operation['stage'] == 'verified':
                continue
            tenant=operation['tenant_id']
            with self.state.locked(tenant):
                current=self.state.route(tenant)
                if current['releaseId']!=manifest['releaseId']:
                    raise ReleaseConflict('release_route_conflict')
                priors=current.get('draining',[])
                if operation['stage']=='retired_old' and operation.get('retirement_digest'):
                    self.state.retire_routes(tenant,current['routeRevision'])
                    self._ready(self.runtime.activate_jobs(self.state.binding(tenant),current))
                    self.state.stage(request['requestId'],tenant,'verified',current['fence'])
                    continue
                if not priors:
                    raise ReleaseConflict('release_drain_evidence_missing')
                evidence=[self.runtime.retire(self.state.binding(tenant),old,current) for old in priors]
                if all(item.get('drained') is True for item in evidence):
                    self._complete_retirement(request['requestId'],tenant,current,evidence)
        return self.state.receipt(request['requestId'])

    def _complete_retirement(self,request_id,tenant,current,evidence):
        self.state.stage(request_id,tenant,'retired_old',current['fence'],retirement_digest=digest(evidence))
        self.state.retire_routes(tenant,current['routeRevision'])
        self._ready(self.runtime.activate_jobs(self.state.binding(tenant),current))
        self.state.stage(request_id,tenant,'verified',current['fence'])

    def reconcile(self, request, manifest):
        manifest=validate_manifest(manifest)
        if request.get('manifestDigest')!=manifest_digest(manifest) or request.get('approvedMode')!=manifest['mode']:
            raise ReleaseConflict('release_manifest_or_approval_mismatch')
        self.state.request(request['requestId'],request)
        for tenant in request['tenantIds']:
            self.state.reconcile(tenant)
        receipt=self.state.receipt(request['requestId'])
        if receipt['stage'] in ('verified','draining_old','retired_old'):
            return self._finish_drain(request,manifest) if receipt['stage'] in ('draining_old','retired_old') else receipt
        # Automatic migration recovery requires verified external evidence, never just a phase label.
        raise ReleaseConflict('migration_evidence_requires_operator_review')

    @staticmethod
    def _ready(evidence):
        if not isinstance(evidence,dict) or evidence.get('ready') is not True:
            raise ReleaseConflict('release_readiness_failed')

    def _ack(self,binding,route,maintenance=False):
        evidence=self.runtime.acknowledge(binding,route,maintenance=maintenance)
        if evidence.get('ready') is not True or evidence.get('routeRevision')!=route['routeRevision'] or bool(evidence.get('maintenance'))!=maintenance:
            raise ReleaseConflict('release_guard_ack_missing')

    @staticmethod
    def _quiescent(proof,binding,route):
        if proof.get('tenantId')!=binding['tenantId'] or proof.get('database')!=binding['database'] or proof.get('fence')!=route['fence'] or proof.get('gateClosed') is not True or any(proof.get(k)!=0 for k in ('admittedWriters','activeTransactions','oldConnections')):
            raise ReleaseConflict('release_writers_not_drained')


def plan_rollout(request,observed):
    return ReleaseEngine(observed['state'],observed['runtime']).plan(request,observed['manifest'])


def advance_rollout(request_id,observations):
    request=observations['request']
    if request['requestId']!=request_id: raise ReleaseConflict('release_request_mismatch')
    return ReleaseEngine(observations['state'],observations['runtime']).apply(request,observations['manifest'])
