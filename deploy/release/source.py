"""Where a release comes from: the candidate commit on Forgejo and its release document in the Forgejo registry.

Everything here reaches Forgejo with one read-only credential held in two environment variables of the job
(``LIWAN_FORGEJO_READ_USER``, ``LIWAN_FORGEJO_READ_TOKEN``). The token travels to git through the environment of a
credential helper and to docker on stdin; it is never in an argument, a URL or a log line.
"""
from __future__ import annotations

import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from deploy.ci.lib.release_manifest import REGISTRY, parse_release_document
from deploy.release.common import EXIT_OK, EXIT_REFUSED, CommandFailed, ReleaseError

FORGEJO_HOST = 'git.liwanos.com'
REPOSITORY_URL = f'https://{FORGEJO_HOST}/liwanos/liwan.git'
RELEASE_IMAGE = 'liwan-release'
RELEASE_FILE = '/release.json'
USER_VAR, TOKEN_VAR = 'LIWAN_FORGEJO_READ_USER', 'LIWAN_FORGEJO_READ_TOKEN'
CHANNELS = {'staging': 'main', 'production': 'release'}
ARCHITECTURES = {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}
PRODUCTION_PLATFORM = 'linux/arm64'
RELEASE_TAG = re.compile(r'^release/19\.0\.(\d+)\.(\d+)\.(\d+)$')
COMMIT = re.compile(r'^[0-9a-f]{40}$')
# The helper runs inside git and reads the credential from git's environment; the line holds no secret.
CREDENTIAL_HELPER = ('!f() { echo "username=$' + USER_VAR + '"; echo "password=$' + TOKEN_VAR + '"; }; f')


@dataclass(frozen=True)
class Credential:
    user: str
    token: str

    @staticmethod
    def from_environment(environment: dict) -> 'Credential':
        user, token = environment.get(USER_VAR, ''), environment.get(TOKEN_VAR, '')
        if not user or not token:
            raise ReleaseError('missing_credential', EXIT_REFUSED,
                               f'set {USER_VAR} and {TOKEN_VAR} in the job secrets (a read-only Forgejo token)')
        return Credential(user, token)


def host_architecture(machine: str) -> str:
    """The architecture name of the release document's platforms; any other machine is refused."""
    architecture = ARCHITECTURES.get(machine.lower())
    if architecture is None:
        raise ReleaseError('unsupported_architecture', EXIT_REFUSED, f'machine {machine!r} is not amd64 or arm64')
    return architecture


def release_version(tag: str) -> tuple[int, int, int] | None:
    match = RELEASE_TAG.match(tag)
    return tuple(int(part) for part in match.groups()) if match else None


def tag_order(tag: str) -> tuple[int, int, int]:
    return release_version(tag) or (-1, -1, -1)


def required_platforms(environment: str, host: str) -> list[str]:
    """The host's own architecture, and for production always arm64 as well (production runs on Arm)."""
    wanted = [f'linux/{host}']
    if CHANNELS[environment] == 'release' and PRODUCTION_PLATFORM not in wanted:
        wanted.append(PRODUCTION_PLATFORM)
    return wanted


class Source:
    def __init__(self, environment: str, state: Path, credential: Credential, runner, log, child_env: dict):
        self.environment = environment
        self.repository = state / 'repo.git'
        self.credential = credential
        self.run_command = runner
        self.log = log
        self.child_env = child_env  # has DOCKER_CONFIG, no Forgejo credential
        self.git_env = {**child_env, USER_VAR: credential.user, TOKEN_VAR: credential.token,
                        'GIT_TERMINAL_PROMPT': '0'}
        self.tmp = state / 'tmp'

    # --- git -----------------------------------------------------------------------------------------
    def remote(self, *args: str) -> str:
        return self.run_command(['git', '-c', 'credential.helper=', '-c', f'credential.helper={CREDENTIAL_HELPER}',
                                 *args], env=self.git_env)[1]

    def local(self, *args: str, check: bool = True) -> tuple[int, str]:
        code, output = self.run_command(['git', '--git-dir', str(self.repository), *args], check=check)
        return code, output.strip()

    def candidate(self) -> dict | None:
        """The head of ``main`` (staging) or the highest ``release/19.0.X.Y.Z`` tag (production); None when no tag exists."""
        try:
            if CHANNELS[self.environment] == 'main':
                refs = self.listing('refs/heads/main')
                return {'commit': refs['refs/heads/main'], 'ref': 'refs/heads/main', 'version': None}
            refs = self.listing('refs/tags/release/*')
        except (CommandFailed, KeyError):
            raise ReleaseError('forgejo_unreachable', detail='git ls-remote on Forgejo failed') from None
        tags = [ref.removeprefix('refs/tags/') for ref in refs if release_version(ref.removeprefix('refs/tags/'))]
        if not tags:
            return None
        tag = max(tags, key=tag_order)
        return {'commit': refs[f'refs/tags/{tag}'], 'ref': f'refs/tags/{tag}', 'version': list(tag_order(tag))}

    def listing(self, pattern: str) -> dict[str, str]:
        """ref -> commit; an annotated tag's peeled ``^{}`` line wins over the tag object."""
        refs: dict[str, str] = {}
        peeled: dict[str, str] = {}
        for line in self.remote('ls-remote', REPOSITORY_URL, pattern).splitlines():
            commit, _, ref = line.partition('\t')
            if COMMIT.match(commit):
                (peeled if ref.endswith('^{}') else refs)[ref.removesuffix('^{}')] = commit
        return {ref: peeled.get(ref, commit) for ref, commit in refs.items()}

    def fetch(self, commit: str) -> None:
        """Bring the refs into the local bare repository (ancestry checks and ``git archive``); the commit must arrive."""
        if not self.repository.exists():
            self.run_command(['git', 'init', '--bare', '--quiet', str(self.repository)])
        try:
            self.remote('--git-dir', str(self.repository), 'fetch', '--quiet', '--prune', '--no-tags', REPOSITORY_URL,
                        '+refs/heads/main:refs/heads/main', '+refs/tags/release/*:refs/tags/release/*')
        except CommandFailed:
            raise ReleaseError('forgejo_unreachable', detail='git fetch from Forgejo failed') from None
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
        if candidate['version'] is not None and (served.get('version') is None
                                                 or tuple(candidate['version']) <= tuple(served['version'])):
            raise ReleaseError('older_candidate', EXIT_REFUSED, 'the release version is not above the served one')

    def require_on_main(self, candidate: dict) -> None:
        """A production tag must point at a commit that Forgejo ``main`` contains."""
        if CHANNELS[self.environment] == 'release' and not self.is_ancestor(candidate['commit'], 'refs/heads/main'):
            raise ReleaseError('not_on_main', EXIT_REFUSED, f'{candidate["commit"]} is not part of Forgejo main')

    def archive(self, commit: str, archive: Path) -> None:
        self.local('archive', '--format=tar', '-o', str(archive), commit)

    # --- registry ------------------------------------------------------------------------------------
    def login(self) -> None:
        """The token goes to ``docker login`` on stdin, into the private docker config of the state directory."""
        try:
            self.run_command(['docker', 'login', FORGEJO_HOST, '--username', self.credential.user, '--password-stdin'],
                             stdin=self.credential.token + '\n', env=self.child_env)
        except CommandFailed:
            raise ReleaseError('registry_login_failed', detail=f'docker login {FORGEJO_HOST} was refused') from None

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
            text = (work / 'release.json').read_text(encoding='utf-8')
        except (CommandFailed, OSError):
            raise ReleaseError('document_unreadable', EXIT_REFUSED, f'{image} holds no readable {RELEASE_FILE}') from None
        finally:
            if container:
                self.run_command(['docker', 'rm', container], env=self.child_env, check=False)
            self.run_command(['docker', 'rmi', image], env=self.child_env, check=False)
            shutil.rmtree(work, ignore_errors=True)
        try:
            document = parse_release_document(text, commit, tuple(required_platforms(self.environment, host)))
        except ValueError as error:
            raise ReleaseError('document_invalid', EXIT_REFUSED, str(error)) from None
        if not document['release'].get('upgradeModules'):
            raise ReleaseError('document_invalid', EXIT_REFUSED, 'the release manifest lists no module to upgrade')
        return document
