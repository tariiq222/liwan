"""Where a release comes from: the candidate commit on GitHub and its release document in the private GHCR registry.

Two read-only credentials reach them, both held in environment variables of the job. The registry credential
(``LIWAN_GHCR_READ_USER``, ``LIWAN_GHCR_READ_TOKEN``) is required. The source credential (``LIWAN_GITHUB_READ_TOKEN``)
is optional: the repository is public today, so without it every git call runs with no credential; with it git
authenticates through the environment of a credential helper. Tokens travel to git through that environment and to
docker on stdin; they are never in an argument, a URL or a log line.
"""
from __future__ import annotations

import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from deploy.ci.lib.release_manifest import REGISTRY, parse_release_document
from deploy.release.common import EXIT_OK, EXIT_REFUSED, CommandFailed, ReleaseError

REPOSITORY_URL = 'https://github.com/tariiq222/liwan.git'
REGISTRY_HOST = REGISTRY.partition('/')[0]
RELEASE_IMAGE = 'liwan-release'
RELEASE_FILE = '/release.json'
USER_VAR, TOKEN_VAR = 'LIWAN_GHCR_READ_USER', 'LIWAN_GHCR_READ_TOKEN'
GITHUB_TOKEN_VAR = 'LIWAN_GITHUB_READ_TOKEN'
GITHUB_USER = 'x-access-token'
# An environment's tag policy (LIWAN_RELEASE_TAG_POLICY in its env file): `highest` follows the highest release tag;
# `explicit` applies only the tag it is given. An environment exists when `<config root>/<name>.env` does.
TAG_POLICY_KEY = 'LIWAN_RELEASE_TAG_POLICY'
TAG_POLICIES = ('highest', 'explicit')
ENVIRONMENT_NAME = re.compile(r'^[a-z][a-z0-9-]{0,30}$')
ARCHITECTURES = {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}
RELEASE_PLATFORM = 'linux/arm64'
VERSION_PART = r'(0|[1-9][0-9]*)'  # ASCII digits, no leading zero
RELEASE_TAG = re.compile(rf'release/19\.0\.{VERSION_PART}\.{VERSION_PART}\.{VERSION_PART}')
COMMIT = re.compile(r'^[0-9a-f]{40}$')
# The helper runs inside git and reads the token from git's environment; the line holds no secret.
CREDENTIAL_HELPER = '!f() { echo "username=' + GITHUB_USER + '"; echo "password=$' + GITHUB_TOKEN_VAR + '"; }; f'


@dataclass(frozen=True)
class Credential:
    user: str
    token: str

    @staticmethod
    def from_environment(environment: dict) -> 'Credential':
        user, token = environment.get(USER_VAR, ''), environment.get(TOKEN_VAR, '')
        if not user or not token:
            raise ReleaseError('missing_credential', EXIT_REFUSED,
                               f'set {USER_VAR} and {TOKEN_VAR} in the job secrets (a read-only token of the private GHCR packages)')
        return Credential(user, token)


def host_architecture(machine: str) -> str:
    """The architecture name of the release document's platforms; any other machine is refused."""
    architecture = ARCHITECTURES.get(machine.lower())
    if architecture is None:
        raise ReleaseError('unsupported_architecture', EXIT_REFUSED, f'machine {machine!r} is not amd64 or arm64')
    return architecture


def parse_listing(text: str) -> dict[str, str]:
    """``git ls-remote`` output -> ref -> commit; an annotated tag's peeled ``^{}`` line wins over the tag object."""
    refs: dict[str, str] = {}
    peeled: dict[str, str] = {}
    for line in text.splitlines():
        commit, _, ref = line.partition('\t')
        if COMMIT.match(commit):
            (peeled if ref.endswith('^{}') else refs)[ref.removesuffix('^{}')] = commit
    return {ref: peeled.get(ref, commit) for ref, commit in refs.items()}


def highest_release_tag(refs: dict[str, str]) -> str | None:
    """The highest ``release/19.0.X.Y.Z`` tag name among ``refs/tags/...`` keys (None when there is none)."""
    tags = [ref.removeprefix('refs/tags/') for ref in refs if release_version(ref.removeprefix('refs/tags/'))]
    return max(tags, key=tag_order) if tags else None


def release_version(tag: str) -> tuple[int, int, int] | None:
    match = RELEASE_TAG.fullmatch(tag)
    return tuple(int(part) for part in match.groups()) if match else None


def tag_order(tag: str) -> tuple[int, int, int]:
    return release_version(tag) or (-1, -1, -1)


def explicit_tag(policy: str | None, tag: str | None) -> str | None:
    """The release tag an `explicit` environment was told to apply. It never picks one itself; a `highest` one takes none."""
    if policy not in TAG_POLICIES:
        raise ReleaseError('invalid_tag_policy', EXIT_REFUSED, f'set {TAG_POLICY_KEY} to one of {list(TAG_POLICIES)}')
    if policy == 'highest':
        if tag is not None:
            raise ReleaseError('tag_not_allowed', EXIT_REFUSED, f'--tag is only for an environment with {TAG_POLICY_KEY}=explicit')
        return None
    if tag is None:
        raise ReleaseError('tag_required', EXIT_REFUSED,
                           'this environment applies only a named release: pass --tag release/19.0.X.Y.Z')
    if release_version(tag) is None:
        raise ReleaseError('invalid_tag', EXIT_REFUSED, f'{tag!r} is not a release/19.0.X.Y.Z tag')
    return tag


def required_platforms(host: str) -> list[str]:
    """The host's own architecture, and always arm64 as well (staging and production both run on Arm)."""
    wanted = [f'linux/{host}']
    if RELEASE_PLATFORM not in wanted:
        wanted.append(RELEASE_PLATFORM)
    return wanted


class Source:
    def __init__(self, tag: str | None, state: Path, credential: Credential, github_token: str | None,
                 runner, log, child_env: dict):
        self.tag = tag  # set for an `explicit` environment only (``explicit_tag``)
        self.repository = state / 'repo.git'
        self.credential = credential
        self.run_command = runner
        self.log = log
        self.child_env = child_env  # has DOCKER_CONFIG, no registry or GitHub credential; every call here passes an environment
        self.git_env = {**child_env, 'GIT_TERMINAL_PROMPT': '0'}
        self.git_options = ['-c', 'credential.helper=']  # an empty helper clears every inherited one
        if github_token:
            self.git_env[GITHUB_TOKEN_VAR] = github_token
            self.git_options += ['-c', f'credential.helper={CREDENTIAL_HELPER}']
        self.tmp = state / 'tmp'

    # --- git -----------------------------------------------------------------------------------------
    def remote(self, *args: str) -> str:
        return self.run_command(['git', *self.git_options, *args], env=self.git_env)[1]

    def local(self, *args: str, check: bool = True) -> tuple[int, str]:
        code, output = self.run_command(['git', '--git-dir', str(self.repository), *args], env=self.child_env, check=check)
        return code, output.strip()

    def candidate(self) -> dict | None:
        """The highest ``release/19.0.X.Y.Z`` tag (None when no tag exists) or exactly the tag an `explicit` environment was given."""
        try:
            refs = self.listing(*self.tag_patterns())
        except CommandFailed:
            raise ReleaseError('github_unreachable', detail='git ls-remote on GitHub failed') from None
        if self.tag:
            return self.named_candidate(refs)
        tag = highest_release_tag(refs)
        if tag is None:
            return None
        return {'commit': refs[f'refs/tags/{tag}'], 'ref': f'refs/tags/{tag}', 'version': list(tag_order(tag))}

    def tag_patterns(self) -> tuple[str, ...]:
        """An exact name lists only the tag object; its ``^{}`` twin is what peels an annotated tag to its commit."""
        if self.tag:
            return f'refs/tags/{self.tag}', f'refs/tags/{self.tag}^{{}}'
        return ('refs/tags/release/*',)

    def named_candidate(self, refs: dict[str, str]) -> dict:
        ref = f'refs/tags/{self.tag}'
        if ref not in refs:
            raise ReleaseError('tag_not_found', EXIT_REFUSED, f'GitHub has no tag {self.tag}')
        return {'commit': refs[ref], 'ref': ref, 'version': list(tag_order(self.tag))}

    def listing(self, *patterns: str) -> dict[str, str]:
        """ref -> commit; an annotated tag's peeled ``^{}`` line wins over the tag object."""
        return parse_listing(self.remote('ls-remote', REPOSITORY_URL, *patterns))

    def fetch(self, commit: str) -> None:
        """Bring the refs into the local bare repository (ancestry checks and ``git archive``); the commit must arrive."""
        if not self.repository.exists():
            self.run_command(['git', 'init', '--bare', '--quiet', str(self.repository)], env=self.child_env)
        try:
            self.remote('--git-dir', str(self.repository), 'fetch', '--quiet', '--prune', '--no-tags', REPOSITORY_URL,
                        '+refs/heads/main:refs/heads/main', '+refs/tags/release/*:refs/tags/release/*')
        except CommandFailed:
            raise ReleaseError('github_unreachable', detail='git fetch from GitHub failed') from None
        code, _ = self.local('cat-file', '-e', f'{commit}^{{commit}}', check=False)
        if code != 0:
            raise ReleaseError('candidate_not_fetched', EXIT_OK, f'{commit} is not reachable from the fetched refs')

    def is_ancestor(self, older: str, newer: str) -> bool:
        return self.local('merge-base', '--is-ancestor', older, newer, check=False)[0] == 0

    def refuse_older(self, candidate: dict, served: dict | None) -> None:
        if served is None:
            return
        if not self.is_ancestor(served['commit'], candidate['commit']):
            raise ReleaseError('older_candidate', EXIT_REFUSED, f'{candidate["commit"]} does not contain {served["commit"]}')
        if tuple(candidate['version']) <= tuple(served['version']):
            raise ReleaseError('older_candidate', EXIT_REFUSED, 'the release version is not above the served one')

    def require_on_main(self, candidate: dict) -> None:
        """A release tag must point at a commit that GitHub ``main`` contains."""
        if not self.is_ancestor(candidate['commit'], 'refs/heads/main'):
            raise ReleaseError('not_on_main', EXIT_REFUSED, f'{candidate["commit"]} is not part of GitHub main')

    def archive(self, commit: str, archive: Path) -> None:
        self.local('archive', '--format=tar', '-o', str(archive), commit)

    # --- registry ------------------------------------------------------------------------------------
    def login(self) -> None:
        """The token goes to ``docker login`` on stdin, into the private docker config of the state directory."""
        try:
            self.run_command(['docker', 'login', REGISTRY_HOST, '--username', self.credential.user, '--password-stdin'],
                             stdin=self.credential.token + '\n', env=self.child_env)
        except CommandFailed:
            raise ReleaseError('registry_login_failed', detail=f'docker login {REGISTRY_HOST} was refused') from None

    def document(self, candidate: dict, host: str) -> dict:
        """``/release.json`` of ``liwan-release:<commit>``, accepted only for exactly this commit."""
        commit = candidate['commit']
        image = f'{REGISTRY}/{RELEASE_IMAGE}:{commit}'
        try:
            self.run_command(['docker', 'pull', '--quiet', image], env=self.child_env)
        except CommandFailed:
            raise ReleaseError('document_not_published', EXIT_REFUSED, f'{image} cannot be pulled') from None
        self.tmp.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(dir=self.tmp))
        container = None
        try:
            container = self.run_command(['docker', 'create', image, RELEASE_FILE], env=self.child_env)[1].strip()
            self.run_command(['docker', 'cp', f'{container}:{RELEASE_FILE}', str(work / 'release.json')],
                             env=self.child_env)
            # The bytes as stored: the proof signs the exact document the registry published, so a file with CRLF
            # endings is digested as it lies on disk, never after a decode that would normalise it.
            data = (work / 'release.json').read_bytes()
            self.document_bytes = data
        except (CommandFailed, OSError):
            raise ReleaseError('document_unreadable', EXIT_REFUSED, f'{image} holds no readable {RELEASE_FILE}') from None
        finally:
            if container:
                self.run_command(['docker', 'rm', container], env=self.child_env, check=False)
            self.run_command(['docker', 'rmi', image], env=self.child_env, check=False)
            shutil.rmtree(work, ignore_errors=True)
        try:
            document = parse_release_document(data.decode('utf-8'), commit, tuple(required_platforms(host)))
        except ValueError as error:  # includes a document that is not UTF-8, named by the decoder's own message
            raise ReleaseError('document_invalid', EXIT_REFUSED, str(error)) from None
        if not document['release'].get('upgradeModules'):
            raise ReleaseError('document_invalid', EXIT_REFUSED, 'the release manifest lists no module to upgrade')
        return document
