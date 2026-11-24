# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""No Docker/database operations: validate frozen input and the CI classification targets."""
import json
import tempfile
import unittest
from pathlib import Path

from deploy import classification

ROOT = Path(__file__).resolve().parents[1]


class TestClassification(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'input.json'
        self.output = self.root / 'snapshot.json'
        self.data = {
            'schema_version': 1, 'database': 'liwan_test_scratch',
            'commercial_mode': 'non_saas', 'entitlement_source': 'local_policy',
            'expected_valid_until': None, 'valid_until_action': 'preserve',
        }

    def test_fixture_is_explicit_scratch_only_and_never_overwrites(self):
        for db in ('customer', 'odoo19', 'liwan_production_scratch'):
            with self.assertRaises(ValueError):
                classification.fixture(db, 'saas', self.output)
        classification.fixture('liwan_test_scratch', 'saas', self.output)
        self.assertEqual(json.loads(self.output.read_text())['entitlement_source'], 'control_plane')
        with self.assertRaises(FileExistsError):
            classification.fixture('liwan_test_scratch', 'non_saas', self.output)

    def test_invalid_json_and_wrong_pairs_are_fail_closed(self):
        for raw in (b'bad', b'{"database":"a","database":"b"}', b'x' * 16385):
            with self.assertRaises(ValueError):
                classification.validate_bytes(raw, self.data['database'], None)
        for update in ({'database': 'other'}, {'entitlement_source': 'control_plane'},
                       {'valid_until_action': 'clear'}, {'commercial_mode': 'guess'}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                classification.validate_bytes(json.dumps({**self.data, **update}).encode(),
                                              self.data['database'], None, fresh=True)


class TestCiClassification(unittest.TestCase):
    """CI is the GitHub Actions workflow running deploy/ci/<stage>.sh: the same invariants hold there."""

    def test_the_base_stack_carries_no_classification_and_ci_targets_are_explicit(self):
        base = (ROOT / 'deploy/docker-compose.yml').read_text()
        self.assertNotIn('LIWAN_COMMERCIAL_CONFIG', base)
        pipeline = ''.join((ROOT / 'deploy' / 'ci' / (stage + '.sh')).read_text()
                           for stage in ('odoo', 'upgrade', 'restore-drill', 'image'))
        # The stage scripts use shell variables for DB names; verify
        # the fixture invocations are present with the expected modes.
        self.assertIn('fixture --database "$SCRATCH_DB" --mode saas', pipeline)
        self.assertIn('fixture --database "$SCRATCH_DB" --mode non_saas', pipeline)
        self.assertIn('fixture --database "$SRC_DB" --mode non_saas', pipeline)
        # The previous-release install never inherits a classification from the
        # environment: it gets its own explicit fixture, and only the upgrade step
        # points at the upgrade fixture.
        previous = pipeline.split('# Install the previous release', 1)[1].split('# Upgrade to this commit', 1)[0]
        upgrade = pipeline.split('# Upgrade to this commit', 1)[1].split('# Post-upgrade smoke', 1)[0]
        self.assertIn('previous release must not inherit a commercial classification', previous)
        self.assertIn('LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/baseline-classification.json"', previous)
        self.assertNotIn('upgrade-classification.json', previous)
        self.assertIn('LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/upgrade-classification.json"', upgrade)
        self.assertIn('-e LIWAN_COMMERCIAL_CONFIG=/run/liwan/classification.json', pipeline)
        # The CI target is explicit: the file is baked into a throwaway derived image
        # at the same path (read-only in effect, never bind-mounted from the job).
        self.assertIn('classification.json:/run/liwan/classification.json', pipeline)
        self.assertIn('derive odoo "$IMAGE" odoo.conf:/etc/odoo/odoo.conf classification.json:/run/liwan/classification.json', pipeline)
        self.assertNotIn('classification.json:/run/liwan/classification.json:ro', pipeline)
        self.assertNotRegex(pipeline, r'-v\s+\S*classification\.json')
        self.assertIn('unset LIWAN_COMMERCIAL_CONFIG', pipeline)
        self.assertIn('negative case passed unexpectedly', pipeline)
        self.assertIn('tools/upgrade_log_guard.py', pipeline)

    def test_the_shared_acceptance_stack_mounts_the_validated_classification_read_only(self):
        """A tenant install reads one database-bound file from a directory mounted read-only, never a job-local path."""
        overlay = (ROOT / 'tools/shared_acceptance_live/acceptance.override.yml').read_text()
        self.assertIn('${LIWAN_COMMERCIAL_CONFIG_DIR:?set LIWAN_COMMERCIAL_CONFIG_DIR}:/etc/liwan-commercial:ro', overlay)
        self.assertIn('LIWAN_COMMERCIAL_CONFIG: ""', overlay)  # the steady-state server reads none
        script = (ROOT / 'tools/shared_acceptance_live/up.sh').read_text()
        # One file per tenant database, generated by the repository's own guarded fixture.
        self.assertIn('deploy/classification.py" fixture', script)
        self.assertIn('--output "$LIWAN_COMMERCIAL_CONFIG_DIR/$DBT.json"', script)
        self.assertIn('-e LIWAN_COMMERCIAL_CONFIG="/etc/liwan-commercial/$DBT.json"', script)


if __name__ == '__main__':
    unittest.main()
