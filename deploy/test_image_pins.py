# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The image-pin gate must fail on each thing it exists to catch.

Every assertion here fails when the rule it names is removed from
``deploy/image_pins.py``: a third-party image with only a tag, a published digest on
a service the stack still builds here, a compose digest that disagrees with the
manifest, a declared service the manifest forgot, a recorded service the stack does
not declare, a registry other than GHCR, a released image without a build or with a
recorded digest, a malformed digest, a duplicated entry. The last class pins today's repository state, so a silent change to either a
real pin or the real manifest is caught by the suite rather than by a release.
"""
from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
import unittest.mock
from pathlib import Path

from deploy import image_pins

REGISTRY = 'ghcr.io/liwan'
DIGEST = 'sha256:' + 'a' * 64
OTHER_DIGEST = 'sha256:' + 'b' * 64
# The digest deploy/docker-compose.production.yml pins for pgbouncer, resolved
# from the multi-arch index. Editing either side silently must fail here.
PGBOUNCER_DIGEST = 'sha256:53d98b3174b0842c475b9842fb0a733b2d9f7ec9da834ec42252aa553f48c628'
PGBOUNCER_REFERENCE = 'edoburu/pgbouncer:v1.24.1-p0'
PGVECTOR_DIGEST = 'sha256:0dd3149a06e4579a0d70d8fef9945636cd514005e7237deb27f9b67886f8dc4f'


def compose(images):
    """A compose file with one service per ``{name: image or None}``; None builds locally."""
    lines = ['services:']
    for service, image in images.items():
        lines.append(f'  {service}:')
        lines.append(f'    image: {image}' if image else '    build: .')
    return '\n'.join(lines) + '\n'


def pin(service, digest=DIGEST, reference='liwan-image', evidence='recorded by this test',
        status=image_pins.PUBLISHED):
    """One manifest entry as JSON, so the validator sees real manifest input."""
    entry = {'service': service, 'reference': reference, 'status': status, 'evidence': evidence}
    if digest is not None:
        entry['digest'] = digest
    return entry


def released(service, reference='liwan-image'):
    return pin(service, digest=None, reference=reference, status=image_pins.RELEASED)


def build(reference, **fields):
    return {'reference': reference, 'dockerfile': 'apps/x/Dockerfile', 'context': '.',
            'local': reference.removeprefix('liwan-'), **fields}


def manifest(entries, registry=REGISTRY, builds=None):
    """A validated manifest from JSON-shaped entries; every released image gets a build unless given."""
    if builds is None:
        builds = [build(reference) for reference in
                  sorted({entry['reference'] for entry in entries if entry['status'] == image_pins.RELEASED})]
    return image_pins.parse_manifest(
        {'schemaVersion': image_pins.SCHEMA_VERSION, 'registry': registry, 'images': entries,
         'builds': builds},
    )


def rules(report):
    return sorted(finding.rule for finding in report.findings)


def services_in(report):
    return sorted(item.service for item in report.declared)


class TestTagOnlyImage(unittest.TestCase):
    def test_a_third_party_image_with_only_a_tag_fails(self):
        report = image_pins.check(
            {'base.yml': compose({'db': 'pgvector/pgvector:pg16'})},
            manifest([pin('db', reference='pgvector/pgvector:pg16')]),
        )
        self.assertEqual(rules(report), [image_pins.TAG_ONLY])
        self.assertIn('pgvector/pgvector:pg16@' + DIGEST, report.findings[0].action)
        self.assertIn('pgvector/pgvector:pg16', report.findings[0].detail)

    def test_a_published_pin_on_a_service_that_still_builds_here_fails(self):
        # The manifest says the image was published, but this stack would build it
        # from source instead of running that image.
        report = image_pins.check(
            {'base.yml': compose({'web': None})},
            manifest([pin('web', reference='liwan-web')]),
        )
        self.assertEqual(rules(report), [image_pins.BUILT_LOCALLY])
        self.assertIn('`build:` block', report.findings[0].action)

    def test_a_released_image_with_only_a_tag_needs_no_digest_in_compose(self):
        # The repository builds liwan-* itself; its digest is per commit and lives in the
        # signed release manifest, so the compose tag is not a finding.
        report = image_pins.check(
            {'base.yml': compose({'odoo': 'liwan-odoo:release'})},
            manifest([released('odoo', reference='liwan-odoo')]),
        )
        self.assertEqual(report.findings, ())


class TestDigestMismatch(unittest.TestCase):
    def test_a_compose_digest_that_disagrees_with_the_manifest_fails(self):
        report = image_pins.check(
            {'base.yml': compose({'db': 'pgvector/pgvector:pg16@' + OTHER_DIGEST})},
            manifest([pin('db', reference='pgvector/pgvector:pg16')]),
        )
        self.assertEqual(rules(report), [image_pins.DIGEST_MISMATCH])
        self.assertIn(DIGEST, report.findings[0].detail)
        self.assertIn(OTHER_DIGEST, report.findings[0].detail)


class TestMissingAndStaleEntries(unittest.TestCase):
    def test_an_image_the_manifest_does_not_record_fails(self):
        report = image_pins.check(
            {'base.yml': compose({'db': 'pgvector/pgvector:pg16@' + DIGEST,
                                  'pgbouncer': PGBOUNCER_REFERENCE + '@' + OTHER_DIGEST})},
            manifest([pin('db', reference='pgvector/pgvector:pg16')]),
        )
        self.assertEqual([f.service for f in report.findings], ['pgbouncer'])
        self.assertEqual(report.findings[0].rule, image_pins.MISSING_ENTRY)
        self.assertIn('"pgbouncer"', report.findings[0].action)

    def test_a_recorded_image_the_stack_does_not_declare_fails(self):
        report = image_pins.check(
            {'base.yml': compose({'db': 'pgvector/pgvector:pg16@' + DIGEST})},
            manifest([pin('db', reference='pgvector/pgvector:pg16'),
                      pin('retired', digest=OTHER_DIGEST, reference='liwan-retired')]),
        )
        self.assertEqual(rules(report), [image_pins.STALE_ENTRY])
        self.assertEqual(report.findings[0].service, 'retired')


class TestReleasedImage(unittest.TestCase):
    def test_a_released_image_the_stack_does_not_declare_is_stale(self):
        report = image_pins.check(
            {'base.yml': compose({'db': 'pgvector/pgvector:pg16@' + DIGEST})},
            manifest([pin('db', reference='pgvector/pgvector:pg16'), released('odoo', reference='liwan-odoo')]),
        )
        self.assertEqual(rules(report), [image_pins.STALE_ENTRY])

    def test_the_rendered_report_says_where_a_released_digest_lives(self):
        entries = [released('odoo', reference='liwan-odoo')]
        report = image_pins.check({'base.yml': compose({'odoo': 'liwan-odoo:release'})}, manifest(entries))
        text = image_pins.render_report(report, manifest(entries))
        self.assertIn('per release (signed release manifest)', text)
        self.assertIn('registry: ' + REGISTRY, text)


class TestReleasedImageName(unittest.TestCase):
    def test_a_mistyped_released_image_name_fails(self):
        report = image_pins.check(
            {'base.yml': compose({'odoo': 'liwan-odoo-typo:${TAG}'})},
            manifest([released('odoo', reference='liwan-odoo')]),
        )
        self.assertEqual(rules(report), [image_pins.IMAGE_NAME_MISMATCH])
        self.assertIn('liwan-odoo', report.findings[0].action)

    def test_the_bare_and_the_registry_qualified_names_pass(self):
        for image in ('liwan-odoo:${TAG:?set}', REGISTRY + '/liwan-odoo:${TAG}', REGISTRY + '/liwan-odoo@' + DIGEST):
            with self.subTest(image=image):
                report = image_pins.check({'base.yml': compose({'odoo': image})},
                                          manifest([released('odoo', reference='liwan-odoo')]))
                self.assertEqual(report.findings, ())


class TestBuilds(unittest.TestCase):
    def test_a_ci_only_build_needs_no_released_entry_and_every_build_needs_a_local_name(self):
        entries = [released('odoo', reference='liwan-odoo')]
        builds = [build('liwan-odoo'), build('liwan-vendor-admin', published=False)]
        self.assertEqual(len(manifest(entries, builds=builds).builds), 2)
        without_local = {key: value for key, value in build('liwan-odoo').items() if key != 'local'}
        with self.assertRaises(image_pins.ManifestError):
            manifest(entries, builds=[without_local])

    def test_local_names_are_unique(self):
        entries = [released('odoo', reference='liwan-odoo'), released('web', reference='liwan-web')]
        with self.assertRaises(image_pins.ManifestError):
            manifest(entries, builds=[build('liwan-odoo', local='x'), build('liwan-web', local='x')])

    def test_the_printed_builds_resolve_arguments_and_mark_ci_only_images(self):
        entries = [released('odoo', reference='liwan-odoo')]
        document = manifest(entries, builds=[build('liwan-odoo', local='odoo', args=['LIWAN_REVISION']),
                                             build('liwan-vendor-admin', local='vendor-admin', published=False)])
        with unittest.mock.patch.dict('os.environ', {'GITHUB_SHA': 'f' * 40}):
            lines = image_pins.render_builds(document).splitlines()
        self.assertEqual(lines[0].split('\t'), [REGISTRY + '/liwan-odoo', 'liwan-odoo', 'odoo', 'apps/x/Dockerfile', '.',
                                                'LIWAN_REVISION=' + 'f' * 12])
        self.assertEqual(lines[1].split('\t')[:3], ['-', 'liwan-vendor-admin', 'vendor-admin'])


class TestFullyPinnedStack(unittest.TestCase):
    def setUp(self):
        self.manifest = manifest([pin('db', reference='pgvector/pgvector:pg16'),
                                  pin('pgbouncer', digest=OTHER_DIGEST,
                                      reference='edoburu/pgbouncer:v1.24.1-p0')])
        self.texts = {
            'base.yml': compose({'db': 'pgvector/pgvector:pg16@' + DIGEST}),
            'production.yml': compose({'pgbouncer': PGBOUNCER_REFERENCE + '@' + OTHER_DIGEST}),
        }

    def test_a_fully_pinned_and_published_stack_passes(self):
        report = image_pins.check(self.texts, self.manifest)
        self.assertEqual(report.findings, ())
        self.assertEqual(services_in(report), ['db', 'pgbouncer'])

    def test_an_overlay_restating_a_service_without_an_image_inherits_the_pin(self):
        texts = dict(self.texts)
        texts['shared.yml'] = compose({'db': None})
        report = image_pins.check(texts, self.manifest)
        self.assertEqual(report.findings, ())
        self.assertEqual(next(i for i in report.declared if i.service == 'db').compose, 'base.yml')

    def test_the_files_are_read_in_compose_order_not_alphabetical_order(self):
        # Compose applies the files in the order given, so the last image wins whatever
        # the file names are; sorting them would resolve this service to the wrong pin.
        manifest_with_pin = manifest([pin('db', reference='pgvector/pgvector:pg16')])
        texts = {
            'z-base.yml': compose({'db': 'pgvector/pgvector:pg16@' + DIGEST}),
            'a-production.yml': compose({'db': 'pgvector/pgvector:pg16@' + OTHER_DIGEST}),
        }
        report = image_pins.check(texts, manifest_with_pin)
        declared = next(item for item in report.declared if item.service == 'db')
        self.assertEqual(declared.digest, OTHER_DIGEST)
        self.assertEqual(declared.compose, 'a-production.yml')
        self.assertEqual(rules(report), [image_pins.DIGEST_MISMATCH])


class TestComposeReading(unittest.TestCase):
    def test_a_variable_reference_is_read_whole_and_a_trailing_comment_is_not_part_of_it(self):
        text = ('services:\n'
                '  odoo:\n'
                '    image: ${REGISTRY:-liwan}/odoo@' + DIGEST + '  # the published pin\n'
                '  web:\n'
                '    build: .\n')
        declared = image_pins.declared_images({'base.yml': text})
        self.assertEqual(declared[0].image, '${REGISTRY:-liwan}/odoo@' + DIGEST)
        self.assertEqual(declared[0].digest, DIGEST)
        self.assertIsNone(declared[1].image)

    def test_a_nested_image_key_is_not_the_service_image(self):
        text = ('services:\n'
                '  odoo:\n'
                '    build:\n'
                '      args:\n'
                '        image: ignored\n')
        self.assertIsNone(image_pins.declared_images({'base.yml': text})[0].image)


class TestManifestValidation(unittest.TestCase):
    def assertRefused(self, entries, message):
        with self.assertRaises(image_pins.ManifestError) as raised:
            manifest(entries)
        self.assertIn(message, str(raised.exception))

    def test_a_malformed_digest_is_refused(self):
        for digest in ('sha256:xyz', 'sha256:' + 'a' * 63, 'sha256:' + 'A' * 64, 'a' * 64,
                       'sha512:' + 'a' * 64):
            with self.subTest(digest=digest):
                self.assertRefused([pin('db', digest=digest)], 'digest')

    def test_duplicate_service_entries_are_refused(self):
        self.assertRefused([pin('db'), pin('db', digest=OTHER_DIGEST)], 'duplicate service entries: db')

    def test_a_released_entry_records_no_digest(self):
        self.assertRefused([{**released('odoo', reference='liwan-odoo'), 'digest': DIGEST}], 'digest is null')

    def test_only_an_owned_image_may_be_recorded_as_released(self):
        self.assertRefused([released('db', reference='pgvector/pgvector:pg16')], 'bare liwan-*')

    def test_a_released_reference_carries_no_registry_prefix(self):
        self.assertRefused([released('odoo', reference='ghcr.io/liwan/liwan-odoo')], 'bare liwan-*')

    def test_a_released_image_needs_a_build_and_a_build_needs_a_released_image(self):
        with self.assertRaises(image_pins.ManifestError) as raised:
            manifest([released('odoo', reference='liwan-odoo')], builds=[build('liwan-web')])
        self.assertIn('released images without a build: liwan-odoo', str(raised.exception))
        with self.assertRaises(image_pins.ManifestError) as raised:
            manifest([pin('db', reference='pgvector/pgvector:pg16')], builds=[build('liwan-web')])
        self.assertIn('builds for no released image: liwan-web', str(raised.exception))

    def test_a_build_is_checked(self):
        entries = [released('odoo', reference='liwan-odoo')]
        for fields in ({'dockerfile': '/abs/Dockerfile'}, {'context': '../up'}, {'args': ['lower']},
                       {'dockerfile': ''}):
            with self.subTest(fields=fields), self.assertRaises(image_pins.ManifestError):
                manifest(entries, builds=[build('liwan-odoo', **fields)])
        with self.assertRaises(image_pins.ManifestError) as raised:
            manifest(entries, builds=[build('liwan-odoo'), build('liwan-odoo')])
        self.assertIn('duplicate builds', str(raised.exception))

    def test_only_a_ghcr_account_is_a_registry(self):
        entries = [pin('db', reference='pgvector/pgvector:pg16')]
        for registry in (None, '', 'docker.io/liwan', 'registry.example.com/liwan', 'ghcr.io', 'ghcr.io/Liwan',
                         'ghcr.io/liwan/extra', 'ghcr.io/liwan:5000'):
            with self.subTest(registry=registry), self.assertRaises(image_pins.ManifestError):
                image_pins.parse_manifest({'schemaVersion': 1, 'registry': registry, 'images': entries,
                                           'builds': []})
        self.assertEqual(manifest(entries).registry, REGISTRY)

    def test_evidence_is_required(self):
        self.assertRefused([{**pin('db'), 'evidence': '  '}], 'evidence')

    def test_the_schema_version_and_registry_are_checked(self):
        with self.assertRaises(image_pins.ManifestError):
            image_pins.parse_manifest({'schemaVersion': 2, 'registry': REGISTRY, 'images': [pin('db')]})

    def test_an_unknown_status_is_refused(self):
        self.assertRefused([{**pin('db'), 'status': 'maybe'}], 'status')


class TestCommandLine(unittest.TestCase):
    def run_cli(self, texts, entries, *arguments):
        """Run ``main`` against fixture files, capturing its output and exit code."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / 'production-images.json'
            manifest_path.write_text(json.dumps(
                {'schemaVersion': image_pins.SCHEMA_VERSION, 'registry': REGISTRY, 'images': entries,
                 'builds': [build(entry['reference']) for entry in entries
                            if entry['status'] == image_pins.RELEASED]},
            ), encoding='utf-8')
            compose_paths = []
            for name, text in texts.items():
                path = root / name
                path.write_text(text, encoding='utf-8')
                compose_paths.append(str(path))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = image_pins.main(['--manifest', str(manifest_path),
                                        '--compose', *compose_paths, *arguments])
            return code, out.getvalue()

    def test_a_released_image_passes(self):
        code, text = self.run_cli({'base.yml': compose({'odoo': 'liwan-odoo:release'})},
                                  [released('odoo', reference='liwan-odoo')])
        self.assertEqual(code, image_pins.EXIT_OK)
        self.assertIn(REGISTRY, text)

    def test_a_broken_pin_fails(self):
        code, _ = self.run_cli({'base.yml': compose({'db': 'pgvector/pgvector:pg16'})},
                               [pin('db', reference='pgvector/pgvector:pg16')])
        self.assertEqual(code, image_pins.EXIT_FAILED)

    def test_a_fully_published_stack_passes(self):
        code, _ = self.run_cli(
            {'base.yml': compose({'db': 'pgvector/pgvector:pg16@' + DIGEST})},
            [pin('db', reference='pgvector/pgvector:pg16')],
        )
        self.assertEqual(code, image_pins.EXIT_OK)

    def test_the_builds_are_printed_for_the_publish_script(self):
        code, text = self.run_cli({'base.yml': compose({'odoo': 'liwan-odoo:release'})},
                                  [released('odoo', reference='liwan-odoo')], '--print-builds')
        self.assertEqual(code, image_pins.EXIT_OK)
        self.assertEqual(text, f'{REGISTRY}/liwan-odoo\tliwan-odoo\todoo\tapps/x/Dockerfile\t.\t\n')

    def test_an_unreadable_manifest_is_a_usage_error_not_a_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'broken.json'
            path.write_text('{not json', encoding='utf-8')
            with contextlib.redirect_stderr(io.StringIO()):
                code = image_pins.main(['--manifest', str(path)])
        self.assertEqual(code, image_pins.EXIT_BAD_INPUT)


class TestRecordedRepositoryState(unittest.TestCase):
    """Today's real manifest and the real production stack, read from disk."""

    @classmethod
    def setUpClass(cls):
        cls.manifest = image_pins.load_manifest()
        cls.texts = {str(path): path.read_text(encoding='utf-8')
                     for path in image_pins.COMPOSE_FILES}
        cls.report = image_pins.check(cls.texts, cls.manifest)

    def test_the_recorded_stack_has_no_finding(self):
        self.assertEqual(self.report.findings, ())

    def test_the_stack_declares_every_service_the_manifest_covers(self):
        self.assertEqual(services_in(self.report),
                         ['ai', 'ai-egress', 'db', 'guard', 'odoo', 'odoo-egress', 'odoo-mail', 'pgbouncer',
                          'proxy', 'restore-db', 'restore-odoo', 'tiktok-relay', 'web'])
        self.assertEqual(len(self.manifest.entries), 13)

    def test_the_vendor_console_is_not_a_production_stack_service(self):
        # apps/vendor-admin is built and smoke-tested by deploy/ci/image.sh, but no
        # customer's production stack starts it, so recording a pin for it would be a
        # stale entry (the finding this class also forbids).
        self.assertNotIn('vendor-admin', services_in(self.report))
        self.assertNotIn('vendor-admin', self.manifest.by_service())

    def test_the_registry_is_the_ghcr_account_of_the_repository(self):
        self.assertEqual(self.manifest.registry, 'ghcr.io/tariiq222')

    def test_every_owned_image_is_released_with_a_build_whose_files_exist(self):
        released_references = {entry.reference for entry in self.manifest.entries if not entry.published}
        self.assertEqual({build.reference for build in self.manifest.builds if build.published}, released_references)
        for build in self.manifest.builds:
            with self.subTest(image=build.reference):
                self.assertTrue(build.local)
                self.assertTrue((image_pins.ROOT / build.dockerfile).is_file())
                self.assertTrue((image_pins.ROOT / build.context).is_dir())

    def test_the_published_web_build_is_the_shared_one(self):
        # Staging and production run the shared stack only; apps/web refuses to start when its compiled tenancy mode
        # differs from the runtime LIWAN_TENANCY_MODE=shared of docker-compose.shared.yml.
        web = next(build for build in self.manifest.builds if build.reference == 'liwan-web')
        self.assertTrue(web.published)
        self.assertIn('LIWAN_TENANCY_MODE', web.args)
        line = next(line for line in image_pins.render_builds(self.manifest).splitlines() if '\tliwan-web\t' in line)
        self.assertIn('LIWAN_TENANCY_MODE=shared', line.split('\t')[-1].split(','))

    def test_the_pgbouncer_pin_is_the_digest_the_manifest_and_compose_both_carry(self):
        entry = self.manifest.by_service()['pgbouncer']
        self.assertEqual(entry.reference, PGBOUNCER_REFERENCE)
        self.assertEqual(entry.digest, PGBOUNCER_DIGEST)
        declared = next(item for item in self.report.declared if item.service == 'pgbouncer')
        self.assertEqual(declared.image, PGBOUNCER_REFERENCE + '@' + PGBOUNCER_DIGEST)

    def test_the_pgvector_pin_is_the_digest_the_manifest_and_compose_both_carry(self):
        entry = self.manifest.by_service()['db']
        self.assertEqual(entry.digest, PGVECTOR_DIGEST)
        declared = next(item for item in self.report.declared if item.service == 'db')
        self.assertEqual(declared.digest, PGVECTOR_DIGEST)

    def test_every_manifest_entry_carries_evidence(self):
        for entry in self.manifest.entries:
            with self.subTest(service=entry.service):
                self.assertTrue(entry.evidence.strip())


if __name__ == '__main__':
    unittest.main()
