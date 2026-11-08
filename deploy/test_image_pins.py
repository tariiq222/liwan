# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The image-pin gate must fail on each thing it exists to catch.

Every assertion here fails when the rule it names is removed from
``deploy/image_pins.py``: a third-party image with only a tag, a published digest on
a service the stack still builds here, a compose digest that disagrees with the
manifest, a declared service the manifest forgot, a recorded service the stack does
not declare, an unpublished pin in a release, a malformed digest, a duplicated
entry. The last class pins today's repository state, so a silent change to either a
real pin or the real manifest is caught by the suite rather than by a release.
"""
from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from deploy import image_pins

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
        status=image_pins.PUBLISHED, reason=None):
    """One manifest entry as JSON, so the validator sees real manifest input."""
    entry = {'service': service, 'reference': reference, 'status': status, 'evidence': evidence}
    if digest is not None:
        entry['digest'] = digest
    if reason is not None:
        entry['reason'] = reason
    return entry


def unpublished(service, reference='liwan-image', reason='not published yet'):
    return pin(service, digest=None, reference=reference, status=image_pins.UNPUBLISHED,
               reason=reason)


def manifest(entries, registry=None):
    """A validated manifest from JSON-shaped entries."""
    return image_pins.parse_manifest(
        {'schemaVersion': image_pins.SCHEMA_VERSION, 'registry': registry, 'images': entries},
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

    def test_a_locally_built_image_with_only_a_tag_is_reported_as_unpublished_not_tag_only(self):
        # The repository builds liwan-* itself, so the missing fact is publication,
        # not a tag that needs a digest in the compose file.
        report = image_pins.check(
            {'base.yml': compose({'odoo': 'liwan-odoo:release'})},
            manifest([unpublished('odoo', reference='liwan-odoo')]),
        )
        self.assertEqual(rules(report), [image_pins.UNPUBLISHED_PIN])


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


class TestUnpublishedPin(unittest.TestCase):
    def setUp(self):
        self.report = image_pins.check(
            {'base.yml': compose({'odoo': 'liwan-odoo:release'})},
            manifest([unpublished('odoo', reference='liwan-odoo')]),
        )

    def test_an_unpublished_pin_fails_the_release_check(self):
        self.assertTrue(self.report.failures(release=True))

    def test_an_unpublished_pin_does_not_fail_the_report_before_a_registry_is_chosen(self):
        self.assertEqual(self.report.failures(release=False), ())

    def test_the_finding_names_the_next_action(self):
        finding = self.report.findings[0]
        self.assertEqual(finding.rule, image_pins.UNPUBLISHED_PIN)
        self.assertIn('publish liwan-odoo', finding.action)
        self.assertIn('docker buildx imagetools inspect', finding.action)
        self.assertIn('deploy/production-images.json', finding.action)
        self.assertIn('not published yet', finding.detail)

    def test_the_rendered_report_lists_the_service_and_its_action(self):
        text = image_pins.render_report(self.report, manifest([unpublished('odoo')]))
        self.assertIn('unpublished: odoo', text)
        self.assertIn('next: publish liwan-odoo', text)
        self.assertIn('1 image(s) are not published yet', text)


class TestFullyPinnedStack(unittest.TestCase):
    def setUp(self):
        self.manifest = manifest([pin('db', reference='pgvector/pgvector:pg16'),
                                  pin('pgbouncer', digest=OTHER_DIGEST,
                                      reference='edoburu/pgbouncer:v1.24.1-p0')])
        self.texts = {
            'base.yml': compose({'db': 'pgvector/pgvector:pg16@' + DIGEST}),
            'production.yml': compose({'pgbouncer': PGBOUNCER_REFERENCE + '@' + OTHER_DIGEST}),
        }

    def test_a_fully_pinned_and_published_stack_passes_both_modes(self):
        report = image_pins.check(self.texts, self.manifest)
        self.assertEqual(report.findings, ())
        self.assertEqual(report.failures(release=True), ())
        self.assertEqual(report.failures(release=False), ())
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

    def test_an_unpublished_entry_must_state_a_reason_and_no_digest(self):
        self.assertRefused([pin('odoo', digest=None, status=image_pins.UNPUBLISHED)], 'reason')
        self.assertRefused([{**unpublished('odoo'), 'digest': DIGEST}], 'digest is null')

    def test_only_an_owned_image_may_be_recorded_as_unpublished(self):
        self.assertRefused([unpublished('db', reference='pgvector/pgvector:pg16')], 'liwan-*')

    def test_an_owned_image_keeps_its_ownership_once_it_gains_a_registry_prefix(self):
        entry = unpublished('odoo', reference='ghcr.io/liwan/liwan-odoo')
        self.assertEqual(manifest([entry]).by_service()['odoo'].reference,
                         'ghcr.io/liwan/liwan-odoo')

    def test_evidence_is_required(self):
        self.assertRefused([{**pin('db'), 'evidence': '  '}], 'evidence')

    def test_the_schema_version_and_registry_are_checked(self):
        with self.assertRaises(image_pins.ManifestError):
            image_pins.parse_manifest({'schemaVersion': 2, 'images': [pin('db')]})
        with self.assertRaises(image_pins.ManifestError):
            image_pins.parse_manifest({'schemaVersion': 1, 'registry': '', 'images': [pin('db')]})

    def test_an_unknown_status_is_refused(self):
        self.assertRefused([{**pin('db'), 'status': 'maybe'}], 'status')


class TestCommandLine(unittest.TestCase):
    def run_cli(self, texts, entries, *arguments, registry=None):
        """Run ``main`` against fixture files, capturing its output and exit code."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / 'production-images.json'
            manifest_path.write_text(json.dumps(
                {'schemaVersion': image_pins.SCHEMA_VERSION, 'registry': registry,
                 'images': entries},
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

    def test_report_exits_zero_while_only_unpublished_owned_images_remain(self):
        code, text = self.run_cli({'base.yml': compose({'odoo': 'liwan-odoo:release'})},
                                  [unpublished('odoo', reference='liwan-odoo')])
        self.assertEqual(code, image_pins.EXIT_OK)
        self.assertIn('not published yet', text)

    def test_report_fails_once_the_manifest_claims_a_registry(self):
        # The moment a registry account is recorded, the unpublished entries are
        # claimed to exist there, so the honest report fails.
        code, text = self.run_cli({'base.yml': compose({'odoo': 'liwan-odoo:release'})},
                                  [unpublished('odoo', reference='liwan-odoo')],
                                  registry='registry.example.com/liwan')
        self.assertEqual(code, image_pins.EXIT_FAILED)
        self.assertIn('registry.example.com/liwan', text)

    def test_check_fails_while_a_pin_is_unpublished(self):
        code, _ = self.run_cli({'base.yml': compose({'odoo': 'liwan-odoo:release'})},
                               [unpublished('odoo', reference='liwan-odoo')], '--check')
        self.assertEqual(code, image_pins.EXIT_FAILED)

    def test_check_passes_a_fully_published_stack(self):
        code, _ = self.run_cli(
            {'base.yml': compose({'db': 'pgvector/pgvector:pg16@' + DIGEST})},
            [pin('db', reference='pgvector/pgvector:pg16')], '--check',
        )
        self.assertEqual(code, image_pins.EXIT_OK)

    def test_an_unreadable_manifest_is_a_usage_error_not_a_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'broken.json'
            path.write_text('{not json', encoding='utf-8')
            with contextlib.redirect_stderr(io.StringIO()):
                code = image_pins.main(['--manifest', str(path), '--check'])
        self.assertEqual(code, image_pins.EXIT_BAD_INPUT)


class TestRecordedRepositoryState(unittest.TestCase):
    """Today's real manifest and the real production stack, read from disk."""

    @classmethod
    def setUpClass(cls):
        cls.manifest = image_pins.load_manifest()
        cls.texts = {str(path): path.read_text(encoding='utf-8')
                     for path in image_pins.COMPOSE_FILES}
        cls.report = image_pins.check(cls.texts, cls.manifest)

    def test_every_finding_is_an_unpublished_owned_image(self):
        self.assertEqual({finding.rule for finding in self.report.findings},
                         {image_pins.UNPUBLISHED_PIN})
        self.assertEqual(len(self.report.findings), 8)

    def test_the_stack_declares_every_service_the_manifest_covers(self):
        self.assertEqual(services_in(self.report),
                         ['ai', 'ai-egress', 'db', 'guard', 'odoo', 'pgbouncer', 'proxy',
                          'restore-db', 'restore-odoo', 'tiktok-relay', 'web'])
        self.assertEqual(len(self.manifest.entries), 11)

    def test_the_vendor_console_is_not_a_production_stack_service(self):
        # apps/vendor-admin is built and smoke-tested by deploy/ci/image.sh, but no
        # customer's production stack starts it, so recording a pin for it would be a
        # stale entry (the finding this class also forbids).
        self.assertNotIn('vendor-admin', services_in(self.report))
        self.assertNotIn('vendor-admin', self.manifest.by_service())

    def test_no_registry_is_claimed_while_the_owned_images_are_unpublished(self):
        self.assertIsNone(self.manifest.registry)
        self.assertEqual(self.report.failures(release=False), ())
        self.assertEqual(len(self.report.failures(release=True)), 8)

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
