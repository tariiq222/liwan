"""Classification must fail before an update can close tenant admission."""
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from .source_gate import snapshot_digest, verify_sources
from .state import ReleaseConflict
from .test_manifest import release


class SourceGateTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        for name in ('base', 'target'):
            addon = self.root/name/'odoo-addons/base'; addon.mkdir(parents=True)
            (addon/'__manifest__.py').write_text("{'version':'1.0','depends':[]}")
        self.gate = {'scope':'odoo','baseRoot':str(self.root/'base'),'targetRoot':str(self.root/'target')}
        evidence = {**release()['compatibilityEvidence'], 'baseSourceDigest':snapshot_digest(self.root/'base'),
                    'targetSourceDigest':snapshot_digest(self.root/'target')}
        self.manifest = release(affectedServices=['odoo'], moduleVersions={'base':'19.0.1.0'}, compatibilityEvidence=evidence)

    def check(self, manifest=None, gate=None):
        return verify_sources({}, manifest or self.manifest, self.gate if gate is None else gate, self.manifest,
                              {'webvueRoot':self.root/'base'}, {'webvueRoot':self.root/'target'})

    def test_observed_inventory_and_matching_complete_sources_are_required(self):
        with patch('deploy.releases.source_gate.installed_modules',return_value=['base']) as observation:
            self.assertTrue(self.check()['ready']); observation.assert_called_once()

    def test_missing_gate_or_narrow_scope_cannot_approve_web_change(self):
        with self.assertRaises(ReleaseConflict): self.check(gate={})
        with self.assertRaises(ReleaseConflict): self.check(manifest={**self.manifest,'affectedServices':['web']})

    def test_changed_snapshot_is_rejected_before_database_observation(self):
        (self.root/'target/odoo-addons/base/hazard.py').write_text('unsafe = True')
        with patch('deploy.releases.source_gate.installed_modules') as observation:
            with self.assertRaises(ReleaseConflict): self.check()
            observation.assert_not_called()

    def test_unknown_source_path_remains_blocked_even_with_correct_digest(self):
        (self.root/'target/unknown.bin').write_bytes(b'new')
        manifest={**self.manifest,'compatibilityEvidence':{**self.manifest['compatibilityEvidence'],
                  'targetSourceDigest':snapshot_digest(self.root/'target')}}
        with patch('deploy.releases.source_gate.installed_modules',return_value=['base']):
            with self.assertRaises(ReleaseConflict): self.check(manifest)


if __name__ == '__main__': unittest.main()
