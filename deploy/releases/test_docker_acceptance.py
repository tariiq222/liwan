"""Image evidence must describe the copied bytes, never a mutable source label."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools.continuous_updates_acceptance import docker_odoo as lab


class DockerAcceptanceBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        self.source = root / 'source'
        self.output = root / 'output'
        self.output.mkdir()
        self.paths = ['odoo-addons/liwan_core/__manifest__.py',
            'deploy/security/odoo_secure.py', 'deploy/shared/launch_odoo.py',
            'deploy/shared/validate_odoo_config.py', 'deploy/odoo/entrypoint.sh',
            'tools/oca_addons.py', 'deploy/oca-addons.json']
        for name in self.paths:
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('original bytes\n')
        self.base = {'Id': 'sha256:' + 'a' * 64,
            'RepoDigests': ['local/base@sha256:' + 'b' * 64],
            'Config': {'Labels': {'sa.liwan.odoo-commit': lab.STOCK}},
            'RootFS': {'Layers': ['sha256:base-layer']}}

    def test_source_mutation_after_copy_is_rejected_before_image_build(self):
        copy = lab.shutil.copyfile
        def changed(source, destination, **options):
            result = copy(source, destination, **options)
            if str(source).endswith('entrypoint.sh'):
                Path(source).write_text('changed after copy\n')
            return result
        with patch.object(lab, 'docker_json', return_value=[self.base]), \
                patch.object(lab.shutil, 'copyfile', side_effect=changed), \
                patch.object(lab.subprocess, 'run') as build:
            with self.assertRaisesRegex(ValueError, 'source_changed_during_copy'):
                lab.build(self.source, self.output, {})
            build.assert_not_called()

    def test_built_image_must_contain_exact_inspected_base_layers(self):
        wrong_image = {**self.base, 'RootFS': {'Layers': ['sha256:different-base']}}
        with patch.object(lab, 'docker_json', side_effect=[[self.base], [self.base], [wrong_image]]), \
                patch.object(lab.subprocess, 'run') as build:
            build.return_value.returncode = 0
            with self.assertRaisesRegex(ValueError, 'built_image_base_mismatch'):
                lab.build(self.source, self.output, {})

    def test_cached_base_requires_content_digest_before_copy_or_build(self):
        self.base['RepoDigests'] = []
        with patch.object(lab, 'docker_json', return_value=[self.base]), \
                patch.object(lab.subprocess, 'run') as build:
            with self.assertRaisesRegex(ValueError, 'cached_base_digest_required'):
                lab.build(self.source, self.output, {})
            build.assert_not_called()
        self.assertFalse((self.output / 'build-context').exists())


if __name__ == '__main__':
    unittest.main()
