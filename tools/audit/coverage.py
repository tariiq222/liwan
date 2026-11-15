"""The 48 audit axes, their owners and the evidence each one needs.

The matrix is data, not prose: an axis names the stage and probe that can produce its evidence, the
component roots it covers, and what a real verification would require. `score_for` refuses to turn a
listed potential or a single scanner run into a full score; a missing evidence key stays Not Verified.
"""
from __future__ import annotations

QUALITY_AXES = (
    ('scalability', 'Scalability', ('performance',)),
    ('maintainability', 'Maintainability', ('static-analysis', 'architecture')),
    ('extensibility', 'Extensibility', ('architecture',)),
    ('modularity', 'Modularity', ('architecture', 'dependencies')),
    ('performance', 'Performance', ('performance',)),
    ('reliability', 'Reliability', ('tests', 'reliability')),
    ('availability', 'Availability', ('deployment', 'reliability')),
    ('security', 'Security', ('security', 'static-analysis')),
    ('testability', 'Testability', ('tests', 'coverage')),
    ('observability', 'Observability', ('observability',)),
    ('resilience', 'Resilience', ('reliability', 'failure')),
    ('data-integrity', 'Data Integrity', ('database', 'contracts')),
    ('code-quality', 'Code Quality', ('static-analysis',)),
    ('architecture', 'Architecture', ('architecture',)),
    ('interoperability', 'Interoperability', ('contracts', 'api')),
    ('portability', 'Portability', ('deployment',)),
    ('deployability', 'Deployability', ('deployment',)),
    ('cost-efficiency', 'Cost Efficiency', ('cost',)),
    ('disaster-recovery', 'Disaster Recovery', ('recovery',)),
    ('documentation', 'Documentation', ('documentation',)),
    ('technical-debt', 'Technical Debt', ('technical-debt',)),
    ('multi-tenancy', 'Multi-Tenancy', ('tenancy', 'security')),
    ('concurrency', 'Concurrency', ('concurrency',)),
    ('backward-compatibility', 'Backward Compatibility', ('migrations', 'contracts')),
)

FUNCTION_AXES = (
    ('business-logic', 'Business Logic Integrity', ('tests', 'logic')),
    ('e2e-workflows', 'End-to-End Workflows', ('e2e',)),
    ('permissions', 'Permissions & Organizational Hierarchy', ('authorization', 'security')),
    ('cross-app', 'Cross-App Consistency', ('contracts', 'isolation')),
    ('state-management', 'State Management', ('frontend', 'state')),
    ('transactions', 'Transaction Integrity', ('database', 'concurrency')),
    ('tenant-lifecycle', 'Tenant Lifecycle', ('tenancy', 'recovery')),
    ('data-lifecycle', 'Data Lifecycle', ('database', 'retention')),
    ('migration-safety', 'Database Migration Safety', ('migrations',)),
    ('entitlements', 'Subscription & Entitlement Logic', ('entitlements',)),
    ('billing', 'Billing & Payment Integrity', ('billing', 'entitlements')),
    ('audit-trails', 'Audit Trails', ('audit',)),
    ('ci-integrity', 'CI/CD Pipeline Integrity', ('ci',)),
    ('supply-chain', 'Software Supply Chain', ('supply-chain',)),
    ('config-secrets', 'Configuration & Secrets', ('secrets', 'static-analysis')),
    ('jobs-queues', 'Background Jobs & Queues', ('jobs', 'reliability')),
    ('api-contracts', 'API Contract Testing', ('contracts', 'api')),
    ('flags-rollbacks', 'Feature Flags & Rollbacks', ('deployment', 'release')),
    ('incident-management', 'Incident Management', ('operations',)),
    ('restore', 'Restore Verification', ('recovery',)),
    ('ux-usability', 'UX & Functional Usability', ('e2e', 'frontend')),
    ('accessibility', 'Accessibility & Compatibility', ('accessibility', 'frontend')),
    ('privacy', 'Privacy & Regulatory Compliance', ('privacy',)),
    ('integration-failure', 'External Integration Failure Handling', ('failure', 'integrations')),
)

AXES = tuple(
    {'group': 'quality', 'key': key, 'name': name, 'probes': probes}
    for key, name, probes in QUALITY_AXES
) + tuple(
    {'group': 'functions', 'key': key, 'name': name, 'probes': probes}
    for key, name, probes in FUNCTION_AXES
)

# Every probe is the name of a result a stage can record. The value is what a *partial* pass needs:
# the evidence kind a stage must supply before an axis can be scored at all.
PROBE_SOURCES = {
    'performance': ('performance', 'k6 smoke summary'),
    'static-analysis': ('static-analysis', 'lint and policy exit codes'),
    'architecture': ('static-analysis', 'arch_policy and dependency analysis'),
    'dependencies': ('static-analysis', 'import and dependency graph'),
    'tests': ('existing-tests', 'test runner counts'),
    'reliability': ('existing-tests', 'reliability probes'),
    'deployment': ('static-analysis', 'Compose and deployment validation'),
    'security': ('static-analysis', 'security policy gates'),
    'coverage': ('evidence-validation', 'test inventory coverage'),
    'observability': ('static-analysis', 'health and alert configuration'),
    'failure': ('evidence-validation', 'failure-path tests'),
    'database': ('static-analysis', 'migration and schema checks'),
    'contracts': ('existing-tests', 'contract and fixture tests'),
    'api': ('static-analysis', 'API surface and route gate'),
    'cost': ('evidence-validation', 'measured cost evidence'),
    'recovery': ('specialized-tests', 'restore drill evidence'),
    'documentation': ('static-analysis', 'docs policy'),
    'technical-debt': ('evidence-validation', 'baseline register'),
    'tenancy': ('existing-tests', 'isolation tests'),
    'concurrency': ('existing-tests', 'race and transaction tests'),
    'migrations': ('static-analysis', 'migration guard'),
    'logic': ('existing-tests', 'model unit tests'),
    'e2e': ('specialized-tests', 'isolated browser journey'),
    'authorization': ('existing-tests', 'capability and record-rule tests'),
    'isolation': ('existing-tests', 'app isolation matrix'),
    'frontend': ('existing-tests', 'web type check and unit tests'),
    'state': ('existing-tests', 'state and composable tests'),
    'retention': ('evidence-validation', 'retention tests'),
    'entitlements': ('existing-tests', 'commercial tests'),
    'billing': ('existing-tests', 'payment and invoice tests'),
    'audit': ('static-analysis', 'audit model coverage'),
    'ci': ('static-analysis', 'CI workflow parse and stage selection'),
    'supply-chain': ('static-analysis', 'dependency and image audit'),
    'secrets': ('static-analysis', 'secret scan'),
    'jobs': ('static-analysis', 'cron and queue definitions'),
    'release': ('evidence-validation', 'release checks'),
    'operations': ('evidence-validation', 'runbooks and alerts'),
    'accessibility': ('existing-tests', 'RTL and a11y suites'),
    'privacy': ('evidence-validation', 'data classification'),
    'integrations': ('existing-tests', 'integration failure tests'),
}

# The component roots an axis is judged over; these are read from the checkout, never hard-coded into
# a claim about implementation. A root that does not exist is reported, not silently dropped.
COMPONENTS = {
    'odoo': 'odoo-addons/',
    'web': 'apps/web/',
    'vendor': 'apps/vendor-admin/',
    'control': 'apps/control-plane/',
    'ai': 'apps/ai-service/',
    'contracts': 'packages/contracts/',
    'ui': 'packages/ui/',
    'deploy': 'deploy/',
    'tools': 'tools/',
    'e2e': 'e2e/',
}

# Which components each axis reads. Used in the report so a reader sees the evidence boundary.
AXIS_COMPONENTS = {
    'scalability': ('odoo', 'web', 'control', 'deploy'),
    'maintainability': ('odoo', 'web', 'control', 'ai', 'contracts'),
    'extensibility': ('odoo', 'contracts'),
    'modularity': ('odoo', 'web', 'contracts'),
    'performance': ('odoo', 'web', 'control', 'ai'),
    'reliability': ('odoo', 'web', 'control', 'deploy'),
    'availability': ('deploy',),
    'security': ('odoo', 'web', 'vendor', 'control', 'ai'),
    'testability': ('odoo', 'web', 'contracts', 'e2e'),
    'observability': ('deploy', 'control'),
    'resilience': ('deploy', 'control'),
    'data-integrity': ('odoo', 'control'),
    'code-quality': ('odoo', 'web', 'control', 'ai'),
    'architecture': ('odoo', 'web', 'contracts'),
    'interoperability': ('odoo', 'contracts', 'web'),
    'portability': ('deploy',),
    'deployability': ('deploy',),
    'cost-efficiency': ('deploy', 'control'),
    'disaster-recovery': ('deploy', 'control'),
    'documentation': ('contracts', 'deploy'),
    'technical-debt': ('odoo', 'web', 'tools'),
    'multi-tenancy': ('odoo', 'control', 'deploy'),
    'concurrency': ('odoo', 'control', 'ai'),
    'backward-compatibility': ('odoo', 'contracts'),
    'business-logic': ('odoo',),
    'e2e-workflows': ('e2e', 'web'),
    'permissions': ('odoo',),
    'cross-app': ('odoo', 'web', 'contracts'),
    'state-management': ('web',),
    'transactions': ('odoo', 'control'),
    'tenant-lifecycle': ('control', 'odoo', 'deploy'),
    'data-lifecycle': ('odoo', 'control'),
    'migration-safety': ('odoo', 'control'),
    'entitlements': ('control', 'odoo'),
    'billing': ('control',),
    'audit-trails': ('odoo', 'control'),
    'ci-integrity': ('deploy', 'tools'),
    'supply-chain': ('odoo', 'web', 'control', 'ai'),
    'config-secrets': ('deploy', 'odoo', 'web'),
    'jobs-queues': ('odoo', 'deploy'),
    'api-contracts': ('odoo', 'contracts', 'web'),
    'flags-rollbacks': ('deploy',),
    'incident-management': ('deploy',),
    'restore': ('deploy', 'control'),
    'ux-usability': ('web', 'e2e'),
    'accessibility': ('web', 'ui'),
    'privacy': ('odoo', 'control', 'deploy'),
    'integration-failure': ('odoo', 'control'),
}


def coverage_entry(axis, evidence):
    """One matrix row: axis, available probe evidence, score and the reason for the score."""
    proof = [probe for probe in axis['probes'] if evidence.get(probe, {}).get('status') == 'passed']
    return {
        'group': axis['group'],
        'key': axis['key'],
        'name': axis['name'],
        'components': list(AXIS_COMPONENTS[axis['key']]),
        'probes': {probe: evidence.get(probe, {'status': 'not_verified', 'reason': 'no probe ran'}) for probe in axis['probes']},
        'verified_probes': proof,
        'score': score_for(axis, proof),
        'reason': score_reason(axis, proof),
    }


def score_for(axis, verified):
    """A 0-5 evidence score, counted in probes rather than in scanners run.

    One passing policy probe is one unit of evidence, never a full score: an axis with one probe
    scores 2, two probes 3, and only a run that verified all five listed probes can reach 5. This
    keeps a policy exit code from reading as a quality grade for an axis nobody actually tested.
    """
    if not verified:
        return None
    return min(5, 1 + len(verified))


def score_reason(axis, verified):
    if not verified:
        return 'Not Verified: no listed probe produced passing evidence'
    return 'Partial: %d of %d probes verified (%s); missing %s' % (
        len(verified), len(axis['probes']), ', '.join(verified),
        ', '.join(probe for probe in axis['probes'] if probe not in verified))


def matrix(evidence):
    rows = [coverage_entry(axis, evidence) for axis in AXES]
    verified = sum(1 for row in rows if row['verified_probes'])
    return {
        'total': len(rows),
        'verified': verified,
        'partial': sum(1 for row in rows if row['verified_probes'] and len(row['verified_probes']) < len(row['probes'])),
        'not_verified': sum(1 for row in rows if not row['verified_probes']),
        'rows': rows,
    }
