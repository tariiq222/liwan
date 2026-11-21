# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The production image pins: one recorded digest per image the production stack runs.

``deploy/test_container_hardening.py`` proves the shape of a reference (a Dockerfile
``FROM`` and a compose ``image:`` end in ``@sha256:``, except the images this
repository builds). That is not enough for a release: a compose file can be edited
from one valid digest to another valid digest, and a locally built ``liwan-*``
image can be started from a tag nobody published. This module owns the second
fact: for every image the production stack runs, ``deploy/production-images.json``
records the registry reference and the digest that was published, with the command
that resolved it. A pin that changes without the manifest changing is a failure.

Two kinds of image are kept apart, because only one of them has a digest the repository
can record:

* A third-party image (``published``) is pinned by the index digest recorded here, and
  the compose file must carry the same digest.
* An image this repository builds (``released``) is pushed to the private GitHub container registry
  named in ``registry`` by ``deploy/ci/publish.sh`` for every ``main`` commit. Its digest
  changes with the commit, so it is recorded in the release document of that commit
  (``liwan-release:<commit>``), never in this file. ``builds`` records how each one is built (Dockerfile, context, build
  arguments), so the publish workflow and this gate read one list.

``check`` answers whether every production image is pinned, recorded and consistent with
the manifest, and every failure is reported with its next action.

The report carries image references and digests only. Nothing here reads an
environment variable, a token or a credential, and the CLI must never print one.

The covered stack is every service ``deploy/docker-compose.yml`` declares, with the
shared-SaaS and production overlays applied, plus the control plane's own production
compose file (its services and the vendor console). A released image must be named in
its compose file: a service that only builds would be built on the server instead of
running the image the deploy script verified and tagged.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Mapping

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / 'deploy/production-images.json'
# The production stack: the base file, the shared SaaS overlay and the sizing override.
COMPOSE_FILES = (
    ROOT / 'deploy/docker-compose.yml',
    ROOT / 'deploy/docker-compose.shared.yml',
    ROOT / 'deploy/docker-compose.production.yml',
    ROOT / 'deploy/control-plane/compose.production.yml',
)
SCHEMA_VERSION = 1
DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')
# The only registry the publish workflow pushes to: the private GHCR namespace of the repository owner. Every other
# registry host is refused for LiwanOS images.
REGISTRY = re.compile(r'^ghcr\.io/tariiq222$')
# Images the repository builds itself: only these are ours to release. The registry comes
# from the manifest, so the name carries no registry prefix.
OWNED_REFERENCE = re.compile(r'^liwan-[a-z0-9-]+$')
# A build input path: relative, inside the repository, no parent segment.
BUILD_PATH = re.compile(r'^(?!/)(?!.*(?:^|/)\.\.(?:/|$))[A-Za-z0-9_./-]+$')
BUILD_ARG = re.compile(r'^[A-Z][A-Z0-9_]*$')
LOCAL_NAME = re.compile(r'^[a-z][a-z0-9-]*$')
SERVICE_LINE = re.compile(r'^ {2}([\w-]+):\s*$')
# A top-level `x-...: &name` block (a YAML anchor) and a service's `<<: *name` merge of it. The control plane's
# compose file declares its image once in an anchor that several services merge.
ANCHOR_LINE = re.compile(r'^x-[\w-]+:\s*&([\w-]+)\s*$')
ANCHOR_IMAGE_LINE = re.compile(r'^ {2}image:\s*(.+?)\s*$')
MERGE_LINE = re.compile(r'^ {4}<<:\s*(.+?)\s*$')
# Service properties sit at four spaces in every file of the production stack, so a
# nested `image:` key (a build argument, say) is never read as the service's image.
# The whole remainder is the value: these references interpolate a Compose variable
# whose default message contains spaces (`${LIWAN_IMAGE_TAG:?set LIWAN_IMAGE_TAG}`).
IMAGE_LINE = re.compile(r'^ {4}image:\s*(.+?)\s*$')

PUBLISHED = 'published'
RELEASED = 'released'
STATUSES = (PUBLISHED, RELEASED)

# One rule name per way a production image can be unusable, so a report line and a
# test name the same thing.
TAG_ONLY = 'tag_only'
BUILT_LOCALLY = 'built_locally'
DIGEST_MISMATCH = 'digest_mismatch'
MISSING_ENTRY = 'missing_entry'
STALE_ENTRY = 'stale_entry'
IMAGE_NAME_MISMATCH = 'image_name_mismatch'

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_BAD_INPUT = 2


class ManifestError(Exception):
    """``deploy/production-images.json`` is not a manifest this gate can trust."""


@dataclass(frozen=True)
class Entry:
    """One image the production stack runs, as the manifest records it."""

    service: str
    reference: str
    status: str
    evidence: str
    digest: str | None = None

    @property
    def published(self) -> bool:
        return self.status == PUBLISHED


@dataclass(frozen=True)
class Build:
    """How one owned image is built: the inputs ``deploy/ci/publish.sh`` hands to buildx."""

    reference: str
    dockerfile: str
    context: str
    # The name CI's image stage (``deploy/ci/image.sh``) checks and scans the image under (tag ``liwan-<local>:ci-<run>``).
    local: str
    args: tuple[str, ...] = ()
    # False for an image CI builds and checks but the production stack never runs (the vendor console).
    published: bool = True


@dataclass(frozen=True)
class Manifest:
    """The recorded pins, the registry organization owned images are pushed to, and their builds."""

    entries: tuple[Entry, ...]
    registry: str
    builds: tuple[Build, ...] = ()

    def by_service(self) -> dict[str, Entry]:
        return {entry.service: entry for entry in self.entries}


@dataclass(frozen=True)
class DeclaredImage:
    """One window of the stack: the service, its effective image, and where that came from."""

    service: str
    image: str | None
    compose: str

    @property
    def digest(self) -> str | None:
        """The digest the reference carries, or ``None`` when it carries only a tag."""
        return self.image.rsplit('@', 1)[1] if self.image and '@' in self.image else None


@dataclass(frozen=True)
class Finding:
    """One reason a production image cannot be trusted, with the action that fixes it."""

    rule: str
    service: str
    subject: str
    detail: str
    action: str


@dataclass(frozen=True)
class Report:
    """Every declared image and every finding, in a stable order."""

    declared: tuple[DeclaredImage, ...]
    findings: tuple[Finding, ...]


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ManifestError(message)


def parse_manifest(document: object) -> Manifest:
    """Validate the manifest document, or name the first field that breaks it."""
    _require(isinstance(document, dict), 'the manifest is a JSON object')
    _require(document.get('schemaVersion') == SCHEMA_VERSION,
             f'schemaVersion must be {SCHEMA_VERSION}')
    registry = document.get('registry')
    _require(isinstance(registry, str) and bool(REGISTRY.match(registry)),
             'registry is the ghcr.io/tariiq222 namespace')
    entries = document.get('images')
    _require(isinstance(entries, list) and entries, 'images is a non-empty list')
    parsed: list[Entry] = []
    for position, raw in enumerate(entries):
        parsed.append(_parse_entry(raw, position))
    names = [entry.service for entry in parsed]
    duplicated = sorted({name for name in names if names.count(name) > 1})
    _require(not duplicated, f'duplicate service entries: {", ".join(duplicated)}')
    builds = _parse_builds(document.get('builds'))
    _require_builds_match(parsed, builds)
    return Manifest(entries=tuple(parsed), registry=registry, builds=builds)


def _parse_entry(raw: object, position: int) -> Entry:
    where = f'images[{position}]'
    _require(isinstance(raw, dict), f'{where} is an object')
    service = raw.get('service')
    _require(isinstance(service, str) and service.strip(), f'{where}.service is a non-empty name')
    where = f'images[{position}] ({service})'
    reference = raw.get('reference')
    _require(isinstance(reference, str) and reference.strip(), f'{where}.reference is non-empty')
    evidence = raw.get('evidence')
    _require(isinstance(evidence, str) and evidence.strip(), f'{where}.evidence is non-empty')
    status = raw.get('status')
    _require(status in STATUSES, f'{where}.status is one of {", ".join(STATUSES)}')
    digest = raw.get('digest')
    if status == PUBLISHED:
        _require(isinstance(digest, str) and DIGEST.match(digest),
                 f'{where}.digest is a sha256:<64 lowercase hex> index digest')
    else:
        _require(digest is None,
                 f'{where}.digest is null: a released image is identified by the release '
                 'document of each commit, never by a digest recorded here')
        _require(bool(OWNED_REFERENCE.match(reference)),
                 f'{where}.reference is a bare liwan-* name (the registry comes from `registry`): '
                 'a third-party image is published by someone else and must carry a digest')
    return Entry(service=service, reference=reference, status=status, evidence=evidence, digest=digest)


def _parse_builds(raw: object) -> tuple[Build, ...]:
    _require(isinstance(raw, list), 'builds is a list')
    builds: list[Build] = []
    for position, item in enumerate(raw):
        where = f'builds[{position}]'
        _require(isinstance(item, dict), f'{where} is an object')
        reference = item.get('reference')
        _require(isinstance(reference, str) and bool(OWNED_REFERENCE.match(reference)),
                 f'{where}.reference is a bare liwan-* name')
        where = f'builds[{position}] ({reference})'
        for field in ('dockerfile', 'context'):
            value = item.get(field)
            _require(isinstance(value, str) and bool(BUILD_PATH.match(value)),
                     f'{where}.{field} is a relative path inside the repository')
        args = item.get('args', [])
        _require(isinstance(args, list) and all(isinstance(arg, str) and BUILD_ARG.match(arg) for arg in args),
                 f'{where}.args is a list of build argument names')
        local = item.get('local')
        _require(isinstance(local, str) and bool(LOCAL_NAME.match(local)),
                 f'{where}.local is a lowercase image stage name')
        published = item.get('published', True)
        _require(isinstance(published, bool), f'{where}.published is true or false')
        builds.append(Build(reference=reference, dockerfile=item['dockerfile'], context=item['context'],
                            args=tuple(args), local=local, published=published))
    for label, names in (('builds', [build.reference for build in builds]),
                         ('local names', [build.local for build in builds])):
        duplicated = sorted({name for name in names if names.count(name) > 1})
        _require(not duplicated, f'duplicate {label}: {", ".join(duplicated)}')
    return tuple(builds)


def _require_builds_match(entries: list[Entry], builds: tuple[Build, ...]) -> None:
    """Every released image has exactly one build and every build serves a released image."""
    released = {entry.reference for entry in entries if not entry.published}
    built = {build.reference for build in builds if build.published}
    _require(released <= built, f'released images without a build: {", ".join(sorted(released - built))}')
    _require(built <= released, f'builds for no released image: {", ".join(sorted(built - released))}')


def load_manifest(path: Path = MANIFEST_PATH) -> Manifest:
    """Read and validate the manifest from disk."""
    try:
        document = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as error:
        raise ManifestError(f'{path.name} is not valid JSON: {error}') from error
    return parse_manifest(document)


def services(compose_text: str) -> dict[str, str]:
    """Map each service name in one compose file to its block of text.

    Line based on purpose: the overlays use the ``!override`` and ``!reset`` tags, so
    the file is read the way ``deploy/test_container_hardening.py`` reads it rather
    than through a YAML loader that would have to be taught those tags.
    """
    blocks: dict[str, list[str]] = {}
    name = None
    in_services = False
    for line in compose_text.splitlines():
        if re.match(r'^\S', line):
            in_services = line.startswith('services:')
            name = None
        elif in_services and (match := SERVICE_LINE.match(line)):
            name = match.group(1)
            blocks[name] = []
        elif in_services and name:
            blocks[name].append(line)
    return {key: '\n'.join(value) for key, value in blocks.items()}


def declared_images(texts: Mapping[str, str]) -> tuple[DeclaredImage, ...]:
    """Every service the stack declares, with its effective image across the overlays.

    ``texts`` maps each compose file to its text in the order Compose applies them
    (base first, each overlay after), which is why the mapping's order matters: an
    overlay that restates a service without an ``image:`` inherits the one from the
    file below it, exactly as Compose merges the files. A service that declares no
    image of its own is built locally and recorded under its service name.
    """
    effective: dict[str, DeclaredImage] = {}
    for name, text in texts.items():
        anchors = anchor_images(text)
        for service, block in services(text).items():
            image = _image_of(block) or _merged_image(block, anchors)
            if image is not None or service not in effective:
                effective[service] = DeclaredImage(service=service, image=image, compose=name)
    return tuple(effective[service] for service in sorted(effective))


def anchor_images(compose_text: str) -> dict[str, str]:
    """Map each top-level YAML anchor of one compose file to the image it declares, if any."""
    images: dict[str, str] = {}
    name = None
    for line in compose_text.splitlines():
        if re.match(r'^\S', line):
            match = ANCHOR_LINE.match(line)
            name = match.group(1) if match else None
        elif name and (match := ANCHOR_IMAGE_LINE.match(line)):
            images[name] = _uncommented(match.group(1)).strip('\'"')
    return images


def _merged_image(block: str, anchors: Mapping[str, str]) -> str | None:
    for line in block.splitlines():
        if MERGE_LINE.match(line):
            for name in re.findall(r'\*([\w-]+)', line):
                if name in anchors:
                    return anchors[name]
    return None


def _image_of(block: str) -> str | None:
    for line in block.splitlines():
        match = IMAGE_LINE.match(line)
        if match:
            return _uncommented(match.group(1)).strip('\'"')
    return None


def _uncommented(value: str) -> str:
    """Drop a trailing `` # comment`` from a scalar, as YAML reads it."""
    return value.split(' #', 1)[0].strip()


def check(texts: Mapping[str, str], manifest: Manifest) -> Report:
    """Compare the declared production images with the recorded pins."""
    declared = declared_images(texts)
    entries = manifest.by_service()
    declared_services = {item.service for item in declared}
    findings: list[Finding] = []
    for item in declared:
        entry = entries.get(item.service)
        if entry is None:
            findings.append(_missing_entry(item))
        else:
            findings.extend(_entry_findings(item, entry, manifest.registry))
    findings.extend(_stale_entry(entry) for entry in manifest.entries
                    if entry.service not in declared_services)
    return Report(declared=declared, findings=tuple(findings))


def _declared_subject(item: DeclaredImage) -> str:
    """How the report names a service whose compose file declares no image of its own."""
    return item.image or f'built locally by {item.compose}'


def _entry_findings(item: DeclaredImage, entry: Entry, registry: str) -> tuple[Finding, ...]:
    if not entry.published:
        return _released_findings(item, entry, registry)
    if item.image is None:
        return (_built_locally(item, entry),)
    if item.digest is None:
        return (_undigested(item, entry),)
    if item.digest != entry.digest:
        return (_mismatched(item, entry),)
    return ()


def _released_findings(item: DeclaredImage, entry: Entry, registry: str) -> tuple[Finding, ...]:
    """A released image is run under the name the publish workflow pushes, so a typo is caught here."""
    if item.image is None:
        return (_released_but_built(item, entry, registry),)
    name = item.image.split('@', 1)[0].split(':', 1)[0]
    if name in (entry.reference, f'{registry}/{entry.reference}'):
        return ()
    return (Finding(
        rule=IMAGE_NAME_MISMATCH,
        service=item.service,
        subject=item.image,
        detail=f'{item.compose} runs this service as {name} but the manifest releases it as {entry.reference}',
        action=f'use `image: {entry.reference}:<tag>` (or {registry}/{entry.reference}) in {item.compose}',
    ),)


def _built_locally(item: DeclaredImage, entry: Entry) -> Finding:
    """The manifest names a published digest, but the stack still builds the service here."""
    return Finding(
        rule=BUILT_LOCALLY,
        service=item.service,
        subject=_declared_subject(item),
        detail=(f'the manifest records the published digest {entry.digest} but {item.compose} '
                'declares no image for this service, so the deployment builds it from source '
                'instead of running the image that was verified'),
        action=(f'add to {item.compose} for this service: '
                f'`image: {entry.reference}@{entry.digest}`, then drop its `build:` block so the '
                'deployment runs the image that was verified'),
    )


def _released_but_built(item: DeclaredImage, entry: Entry, registry: str) -> Finding:
    """A released image the stack does not name: a host would build it, or keep an old local build."""
    return Finding(
        rule=BUILT_LOCALLY,
        service=item.service,
        subject=_declared_subject(item),
        detail=(f'{item.compose} declares no image for this service, so Compose tags a local build '
                f'`<project>-<service>` and never selects the released {entry.reference}:<tag> the deploy script tagged'),
        action=f'add `image: {entry.reference}:${{LIWAN_IMAGE_TAG}}` to this service in {item.compose}',
    )


def _undigested(item: DeclaredImage, entry: Entry) -> Finding:
    """The image reference carries a tag where the recorded digest belongs."""
    return Finding(
        rule=TAG_ONLY,
        service=item.service,
        subject=_declared_subject(item),
        detail=(f'the manifest records the published digest {entry.digest} but {item.compose} '
                f'runs this service as {item.image}: a tag can be repointed after the release'),
        action=f'pin it in {item.compose}: `image: {entry.reference}@{entry.digest}`',
    )


def _mismatched(item: DeclaredImage, entry: Entry) -> Finding:
    """The compose file and the manifest name two different digests."""
    return Finding(
        rule=DIGEST_MISMATCH,
        service=item.service,
        subject=_declared_subject(item),
        detail=(f'{item.compose} pins {item.digest} while the manifest records {entry.digest} '
                'for this service'),
        action=('verify the digest you meant with `docker buildx imagetools inspect`, then '
                'correct deploy/production-images.json or the compose line so both name it'),
    )


def _missing_entry(item: DeclaredImage) -> Finding:
    return Finding(
        rule=MISSING_ENTRY,
        service=item.service,
        subject=_declared_subject(item),
        detail=f'{item.compose} declares this service but the manifest records no pin for it',
        action=f'add an entry for service "{item.service}" to deploy/production-images.json',
    )


def _stale_entry(entry: Entry) -> Finding:
    return Finding(
        rule=STALE_ENTRY,
        service=entry.service,
        subject=entry.reference,
        detail='the manifest records a pin for a service the production stack does not declare',
        action=f'remove the "{entry.service}" entry from deploy/production-images.json',
    )


def render_report(report: Report, manifest: Manifest) -> str:
    """The plain-text report CI logs and an operator both read.

    It names what is pinned, what is not, and the next action for each line, so a
    release engineer needs no other document to finish the work.
    """
    entries = manifest.by_service()
    recorded_count = f'{len(manifest.entries)} entries, {len(manifest.builds)} builds, schema {SCHEMA_VERSION}'
    lines = [
        'production image pins',
        '=====================',
        f'manifest: deploy/production-images.json ({recorded_count})',
        f'registry: {manifest.registry}',
        f'declared services: {len(report.declared)}; findings: {len(report.findings)}',
        '',
        '| service | declared image | recorded pin |',
        '| --- | --- | --- |',
    ]
    for item in report.declared:
        entry = entries.get(item.service)
        recorded = 'missing' if entry is None else (entry.digest or 'per release (release document)')
        lines.append(f'| {item.service} | {item.image or "(built locally)"} | {recorded} |')
    if report.findings:
        lines.extend(('', 'findings', '--------'))
        for finding in report.findings:
            lines.append(f'{finding.rule}: {finding.service} - {finding.subject}')
            lines.append(f'  {finding.detail}')
            lines.append(f'  next: {finding.action}')
    lines.extend(('', _summary(report)))
    return '\n'.join(lines) + '\n'


def _summary(report: Report) -> str:
    if not report.findings:
        return 'Result: every production image is pinned by a recorded digest or released per commit.'
    return f'Result: {len(report.findings)} finding(s) fail the check (see above).'


def build_argument_values() -> dict[str, str]:
    """The value of every build argument a ``builds`` entry may name, from the checkout and ``GITHUB_SHA``."""
    return {
        'ODOO_COMMIT': (ROOT / 'deploy/odoo/ODOO_COMMIT').read_text(encoding='utf-8').strip(),
        'LIWAN_REVISION': os.environ.get('GITHUB_SHA', '')[:12],
        # Every published stack that runs the web image is the shared one, and the build mode is compiled in:
        # apps/web/server/plugins/tenancy-build-mode.ts refuses to start when it differs from the runtime mode.
        'LIWAN_TENANCY_MODE': 'shared',
    }


def render_builds(manifest: Manifest) -> str:
    """One tab-separated line per build, for ``deploy/ci/publish.sh`` and ``deploy/ci/image.sh``.

    Fields: registry image name (``-`` for a CI-only build), reference, local name for the image stage, Dockerfile,
    context, comma-separated ``NAME=value`` build arguments.
    """
    values = build_argument_values()
    for build in manifest.builds:
        unknown = [arg for arg in build.args if arg not in values]
        if unknown:
            raise ManifestError(f'{build.reference} names build arguments with no value: {", ".join(unknown)}')
    return ''.join(
        '\t'.join((f'{manifest.registry}/{build.reference}' if build.published else '-', build.reference,
                   build.local, build.dockerfile, build.context,
                   ','.join(f'{arg}={values[arg]}' for arg in build.args))) + '\n'
        for build in manifest.builds
    )


def render_external(manifest: Manifest) -> str:
    """One ``reference@digest`` line per third-party image, the exact string the compose files run, for the release command."""
    pins = {f'{entry.reference}@{entry.digest}' for entry in manifest.entries if entry.published}
    return ''.join(f'{pin}\n' for pin in sorted(pins))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='image_pins.py',
        description='Check that every production image is pinned by a digest recorded in '
                    'deploy/production-images.json, or released per commit by the publish workflow. '
                    'The report is always printed; the exit status is non-zero on any finding.',
    )
    parser.add_argument('--manifest', default=str(MANIFEST_PATH), help='manifest to read')
    parser.add_argument('--compose', nargs='+', default=[str(path) for path in COMPOSE_FILES],
                        help='compose files that make up the production stack, in the order '
                             'Compose applies them')
    parser.add_argument('--print-builds', action='store_true',
                        help='print the builds for deploy/ci/publish.sh and deploy/ci/image.sh and exit')
    parser.add_argument('--print-external', action='store_true',
                        help='print every third-party image as reference@digest for deploy/release/release.py and exit')
    return parser


def main(argv=None) -> int:
    """Exit 0 when the stack is pinned as asked, 1 when it is not, 2 on unreadable input."""
    args = build_parser().parse_args(argv)
    try:
        manifest = load_manifest(Path(args.manifest))
        if args.print_builds:
            sys.stdout.write(render_builds(manifest))
            return EXIT_OK
        if args.print_external:
            sys.stdout.write(render_external(manifest))
            return EXIT_OK
        texts = {str(Path(path)): Path(path).read_text(encoding='utf-8') for path in args.compose}
    except (OSError, ManifestError) as error:
        sys.stderr.write(f'image_pins: {error}\n')
        return EXIT_BAD_INPUT
    report = check(texts, manifest)
    sys.stdout.write(render_report(report, manifest))
    return EXIT_OK if not report.findings else EXIT_FAILED


if __name__ == '__main__':
    raise SystemExit(main())
