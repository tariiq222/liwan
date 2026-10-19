"""Readiness cannot silently accept stale, failed or incomplete evidence."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from tools import project_readiness as readiness


class ReadinessTests(unittest.TestCase):
    def test_failed_missing_or_stale_scenario_keeps_gate_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            artifact = root / 'receipt.json'; artifact.write_text(json.dumps({'schemaVersion':1,'case':'restore','sourceDigest':'a'*64,'exitCode':0,'checks':{'restored':True}}))
            case = {'status': 'passed', 'sourceDigest': 'a' * 64, 'artifact': str(artifact),
                    'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()}
            self.assertFalse(readiness.evaluate({'sourceDigest':'a'*64,'cases':{}}, ['restore'], root)['ready'])
            report = {'sourceDigest': 'a' * 64, 'cases': {'restore': case}}
            self.assertTrue(readiness.evaluate(report, ['restore'], root)['ready'])
            for patch in ({'status':'blocked'}, {'sourceDigest':'b'*64}, {'sha256':'b'*64}):
                with self.subTest(patch=patch):
                    changed = {**report, 'cases': {'restore': {**case, **patch}}}
                    self.assertFalse(readiness.evaluate(changed, ['restore'], root)['ready'])
            artifact.write_text('changed after acceptance')
            self.assertFalse(readiness.evaluate(report, ['restore'], root)['ready'])

    def test_unknown_status_or_empty_requirements_cannot_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            result = readiness.evaluate({'sourceDigest':'a'*64,'cases':{'restore':{'status':'skipped'}}}, ['restore'], Path(temp))
            self.assertFalse(result['ready'])
            with self.assertRaises(ValueError): readiness.evaluate({'cases':{}}, [], Path(temp))

    def test_claimed_pass_cannot_override_failed_command_or_empty_checks(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();artifact=root/'receipt.json'
            for receipt in ({'exitCode':1,'checks':{'restored':True}}, {'exitCode':0,'checks':{}}, {'exitCode':0,'checks':{'restored':False}}):
                value={'schemaVersion':1,'case':'restore','sourceDigest':'a'*64,**receipt}
                artifact.write_text(json.dumps(value))
                case={'status':'passed','sourceDigest':'a'*64,'artifact':str(artifact),'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest()}
                self.assertFalse(readiness.evaluate({'sourceDigest':'a'*64,'cases':{'restore':case}},['restore'],root)['ready'])
