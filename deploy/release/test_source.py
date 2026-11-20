"""Tests for deploy/release/source.py: candidate resolution, version order and the credential."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from deploy.release import source
from deploy.release.common import EXIT_FAILED, EXIT_REFUSED, ReleaseError

A, B, C = 'a' * 40, 'b' * 40, 'c' * 40


class FakeGit:
    def __init__(self, output):
        self.output, self.calls = output, []

    def __call__(self, argv, *, stdin=None, env=None, check=True):
        self.calls.append((argv, env))
        return 0, self.output


def build(environment, output):
    runner = FakeGit(output)
    state = Path(tempfile.mkdtemp())
    return source.Source(environment, state, source.Credential('reader', 'tok'), runner, lambda _: None, {}), runner


class SourceTest(unittest.TestCase):
    def test_staging_candidate_is_the_main_head(self):
        subject, _ = build('staging', f'{A}\trefs/heads/main\n')
        self.assertEqual(subject.candidate(), {'commit': A, 'ref': 'refs/heads/main', 'version': None})

    def test_production_candidate_is_the_highest_release_tag_by_version_not_by_text(self):
        subject, _ = build('production', f'{A}\trefs/tags/release/19.0.1.0.9\n{B}\trefs/tags/release/19.0.1.0.10\n'
                                         f'{C}\trefs/tags/release/19.0.1.0.2\n{C}\trefs/tags/release/other\n')
        self.assertEqual(subject.candidate(), {'commit': B, 'ref': 'refs/tags/release/19.0.1.0.10',
                                               'version': [1, 0, 10]})

    def test_an_annotated_tag_resolves_to_its_commit(self):
        subject, _ = build('production', f'{A}\trefs/tags/release/19.0.1.0.1\n{B}\trefs/tags/release/19.0.1.0.1^{{}}\n')
        self.assertEqual(subject.candidate()['commit'], B)

    def test_production_without_a_tag_has_no_candidate(self):
        subject, _ = build('production', '')
        self.assertIsNone(subject.candidate())

    def test_the_remote_command_carries_a_reference_never_the_token(self):
        subject, runner = build('staging', f'{A}\trefs/heads/main\n')
        subject.candidate()
        argv, env = runner.calls[0]
        self.assertNotIn('tok', ' '.join(argv))
        self.assertEqual(env['LIWAN_FORGEJO_READ_TOKEN'], 'tok')
        self.assertEqual(env['GIT_TERMINAL_PROMPT'], '0')

    def test_credential_needs_both_variables(self):
        self.assertEqual(source.Credential.from_environment({source.USER_VAR: 'u', source.TOKEN_VAR: 't'}),
                         source.Credential('u', 't'))
        for environment in ({}, {source.USER_VAR: 'u'}, {source.TOKEN_VAR: 't'}, {source.USER_VAR: '', source.TOKEN_VAR: 't'}):
            with self.assertRaises(ReleaseError) as raised:
                source.Credential.from_environment(environment)
            self.assertEqual((raised.exception.reason, raised.exception.exit_code), ('missing_credential', EXIT_REFUSED))
            self.assertIn(source.TOKEN_VAR, raised.exception.detail)

    def test_host_architecture_names(self):
        self.assertEqual([source.host_architecture(m) for m in ('x86_64', 'AMD64', 'aarch64', 'arm64')],
                         ['amd64', 'amd64', 'arm64', 'arm64'])
        with self.assertRaises(ReleaseError) as raised:
            source.host_architecture('s390x')
        self.assertEqual(raised.exception.exit_code, EXIT_REFUSED)

    def test_required_platforms(self):
        self.assertEqual(source.required_platforms('staging', 'amd64'), ['linux/amd64'])
        self.assertEqual(source.required_platforms('production', 'arm64'), ['linux/arm64'])
        self.assertEqual(source.required_platforms('production', 'amd64'), ['linux/amd64', 'linux/arm64'])

    def test_unreachable_forgejo_is_a_failure_not_a_refusal(self):
        subject, _ = build('staging', '')
        with self.assertRaises(ReleaseError) as raised:
            subject.candidate()  # an empty listing has no main head
        self.assertEqual((raised.exception.reason, raised.exception.exit_code), ('forgejo_unreachable', EXIT_FAILED))


if __name__ == '__main__':
    unittest.main()
