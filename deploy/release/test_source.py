"""Tests for deploy/release/source.py: candidate resolution, version order and the credential."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from deploy.release import source
from deploy.release.common import EXIT_FAILED, EXIT_REFUSED, CommandFailed, ReleaseError

A, B, C = 'a' * 40, 'b' * 40, 'c' * 40


class FakeGit:
    def __init__(self, output):
        self.output, self.calls = output, []

    def __call__(self, argv, *, stdin=None, env=None, check=True):
        self.calls.append((argv, env))
        return 0, self.output


def build(output, github_token=None, tag=None):
    runner = FakeGit(output)
    state = Path(tempfile.mkdtemp())
    credential = source.Credential('reader', 'tok')
    return source.Source(tag, state, credential, github_token, runner, lambda _: None, {}), runner


class PureListingTest(unittest.TestCase):
    def test_parse_listing_maps_refs_to_commits_and_the_peeled_line_wins(self):
        text = f'{A}\trefs/tags/release/19.0.1.0.1\n{B}\trefs/tags/release/19.0.1.0.1^{{}}\n{C}\trefs/tags/x\nnot-a-commit\trefs/tags/y\n'
        self.assertEqual(source.parse_listing(text), {'refs/tags/release/19.0.1.0.1': B, 'refs/tags/x': C})

    def test_highest_release_tag_orders_by_version_and_ignores_other_tags(self):
        refs = {'refs/tags/release/19.0.1.0.9': A, 'refs/tags/release/19.0.1.0.10': B, 'refs/tags/other': C}
        self.assertEqual(source.highest_release_tag(refs), 'release/19.0.1.0.10')
        self.assertIsNone(source.highest_release_tag({'refs/tags/other': C}))
        self.assertIsNone(source.highest_release_tag({}))


class SourceTest(unittest.TestCase):
    def test_candidate_is_the_highest_release_tag_by_version_not_by_text(self):
        subject, _ = build(f'{A}\trefs/tags/release/19.0.1.0.9\n{B}\trefs/tags/release/19.0.1.0.10\n'
                                         f'{C}\trefs/tags/release/19.0.1.0.2\n{C}\trefs/tags/release/other\n')
        self.assertEqual(subject.candidate(), {'commit': B, 'ref': 'refs/tags/release/19.0.1.0.10',
                                               'version': [1, 0, 10]})

    def test_staging_candidate_is_the_highest_release_tag_never_the_main_head(self):
        subject, runner = build(f'{A}\trefs/tags/release/19.0.1.0.2\n{B}\trefs/tags/release/19.0.1.0.11\n')
        self.assertEqual(subject.candidate(), {'commit': B, 'ref': 'refs/tags/release/19.0.1.0.11', 'version': [1, 0, 11]})
        self.assertEqual(runner.calls[0][0][-1], 'refs/tags/release/*')

    def test_an_annotated_tag_resolves_to_its_commit(self):
        subject, _ = build(f'{A}\trefs/tags/release/19.0.1.0.1\n{B}\trefs/tags/release/19.0.1.0.1^{{}}\n')
        self.assertEqual(subject.candidate()['commit'], B)

    def test_staging_without_a_tag_has_no_candidate(self):
        subject, _ = build('')
        self.assertIsNone(subject.candidate())

    def test_without_a_github_token_git_carries_no_credential(self):
        subject, runner = build(f'{A}\trefs/tags/release/19.0.1.0.1\n')
        subject.candidate()
        argv, env = runner.calls[0]
        self.assertEqual([part for part in argv if part.startswith('credential.helper=')], ['credential.helper='])
        self.assertNotIn(source.GITHUB_TOKEN_VAR, env)
        self.assertNotIn(source.TOKEN_VAR, env)
        self.assertEqual(env['GIT_TERMINAL_PROMPT'], '0')

    def test_a_github_token_reaches_git_only_through_the_helper_environment(self):
        subject, runner = build(f'{A}\trefs/tags/release/19.0.1.0.1\n', github_token='ghtok')
        subject.candidate()
        argv, env = runner.calls[0]
        self.assertNotIn('ghtok', ' '.join(argv))
        self.assertIn('$' + source.GITHUB_TOKEN_VAR, ' '.join(argv))
        self.assertIn('x-access-token', ' '.join(argv))
        self.assertEqual(env[source.GITHUB_TOKEN_VAR], 'ghtok')
        self.assertNotIn('tok', env.values())  # the registry token never reaches git
        self.assertEqual(env['GIT_TERMINAL_PROMPT'], '0')

    def test_the_registry_host_and_source_are_github_and_ghcr(self):
        self.assertEqual(source.REGISTRY_HOST, 'ghcr.io')
        self.assertEqual(source.REGISTRY, 'ghcr.io/tariiq222')
        self.assertEqual(source.REPOSITORY_URL, 'https://github.com/tariiq222/liwan.git')

    def test_production_candidate_is_exactly_the_named_tag(self):
        subject, runner = build(f'{B}\trefs/tags/release/19.0.1.0.7\n', tag='release/19.0.1.0.7')
        self.assertEqual(subject.candidate(), {'commit': B, 'ref': 'refs/tags/release/19.0.1.0.7', 'version': [1, 0, 7]})
        self.assertEqual(runner.calls[0][0][-2:], ['refs/tags/release/19.0.1.0.7', 'refs/tags/release/19.0.1.0.7^{}'])

    def test_a_named_annotated_tag_resolves_to_its_peeled_commit(self):
        subject, _ = build(f'{A}\trefs/tags/release/19.0.1.0.7\n{B}\trefs/tags/release/19.0.1.0.7^{{}}\n',
                           tag='release/19.0.1.0.7')
        self.assertEqual(subject.candidate()['commit'], B)

    def test_release_tag_names_are_strict(self):
        for tag in ('release/19.0.1.0.7', 'release/19.0.0.0.0', 'release/19.0.1.10.200'):
            self.assertIsNotNone(source.release_version(tag), tag)
        for tag in ('release/19.0.1.0.7\n', 'release/19.0.\u0661.0.7', 'release/19.0.01.0.7', 'release/19.0.1.0.07',
                    'x/release/19.0.1.0.7', 'release/19.0.1.0.7 '):
            self.assertIsNone(source.release_version(tag), repr(tag))

    def test_a_named_tag_that_is_missing_is_refused(self):
        subject, _ = build(f'{A}\trefs/tags/release/19.0.1.0.8\n', tag='release/19.0.1.0.7')
        with self.assertRaises(ReleaseError) as raised:
            subject.candidate()
        self.assertEqual((raised.exception.reason, raised.exception.exit_code), ('tag_not_found', EXIT_REFUSED))

    def test_explicit_tag_rules(self):
        self.assertEqual(source.explicit_tag('production', 'release/19.0.1.0.7'), 'release/19.0.1.0.7')
        self.assertIsNone(source.explicit_tag('staging', None))
        for environment, tag, reason in (('production', None, 'production_tag_required'),
                                         ('production', 'release/x', 'invalid_tag'),
                                         ('staging', 'release/19.0.1.0.7', 'tag_not_allowed')):
            with self.assertRaises(ReleaseError) as raised:
                source.explicit_tag(environment, tag)
            self.assertEqual((raised.exception.reason, raised.exception.exit_code), (reason, EXIT_REFUSED))

    def test_credential_needs_both_variables(self):
        self.assertEqual(source.Credential.from_environment({source.USER_VAR: 'u', source.TOKEN_VAR: 't'}),
                         source.Credential('u', 't'))
        for environment in ({}, {source.USER_VAR: 'u'}, {source.TOKEN_VAR: 't'}, {source.USER_VAR: '', source.TOKEN_VAR: 't'}):
            with self.assertRaises(ReleaseError) as raised:
                source.Credential.from_environment(environment)
            self.assertEqual((raised.exception.reason, raised.exception.exit_code), ('missing_credential', EXIT_REFUSED))
            self.assertIn(source.TOKEN_VAR, raised.exception.detail)
            self.assertIn(source.USER_VAR, raised.exception.detail)

    def test_host_architecture_names(self):
        self.assertEqual([source.host_architecture(m) for m in ('x86_64', 'AMD64', 'aarch64', 'arm64')],
                         ['amd64', 'amd64', 'arm64', 'arm64'])
        with self.assertRaises(ReleaseError) as raised:
            source.host_architecture('s390x')
        self.assertEqual(raised.exception.exit_code, EXIT_REFUSED)

    def test_required_platforms(self):
        self.assertEqual(source.required_platforms('arm64'), ['linux/arm64'])
        self.assertEqual(source.required_platforms('amd64'), ['linux/amd64', 'linux/arm64'])

    def test_unreachable_github_is_a_failure_not_a_refusal(self):
        subject, _ = build('')

        def unreachable(argv, **_):
            raise CommandFailed(argv, 128)

        subject.run_command = unreachable
        with self.assertRaises(ReleaseError) as raised:
            subject.candidate()
        self.assertEqual((raised.exception.reason, raised.exception.exit_code), ('github_unreachable', EXIT_FAILED))


if __name__ == '__main__':
    unittest.main()
