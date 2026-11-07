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

Two questions are kept apart, because only one of them the repository can answer:

* Is every production image pinned, recorded and consistent with the manifest?
  ``check`` answers that and every failure is reported with its next action.
* Has every owned image been published? Not today: no registry account is chosen,
  so the manifest records ``"status": "unpublished"`` for the images the CI builds
  locally, and ``--check`` (the release gate) exits non-zero while any remains.
  Without ``--check`` the report is printed and exits zero while only those
  unpublished entries remain; the moment the manifest claims a registry account
  they fail too, because claiming a registry claims the images are published.
  ``deploy/ci/static.sh`` runs that report form, so CI is honest about the pending
  decision without turning the whole stage red for a decision only the owner can make.

The report carries image references and digests only. Nothing here reads an
environment variable, a token or a credential, and the CLI must never print one.

The covered stack is every service ``deploy/docker-compose.yml`` declares, with the
shared-SaaS and production overlays applied. ``apps/vendor-admin`` has no entry
because it is the vendor console, built and smoke-tested by ``deploy/ci/image.sh``
but never started by a customer's production stack.
"""
from __future__ import annotations

import argparse
import json
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
)
SCHEMA_VERSION = 1
DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')
# Images the repository builds itself: only these may be recorded as unpublished,
# because only these are ours to publish. A registry prefix is allowed, so a name can
# gain `ghcr.io/<account>/` when the owner chooses the registry.
LOCAL_REFERENCE = re.compile(r'^(?:[a-z0-9.-]+(?:/[a-z0-9_.-]+)*/)?liwan-[a-z0-9-]+$')
SERVICE_LINE = re.compile(r'^ {2}([\w-]+):\s*$')
# Service properties sit at four spaces in every file of the production stack, so a
# nested `image:` key (a build argument, say) is never read as the service's image.
# The whole remainder is the value: these references interpolate a Compose variable
# whose default message contains spaces (`${LIWAN_IMAGE_TAG:?set LIWAN_IMAGE_TAG}`).
IMAGE_LINE = re.compile(r'^ {4}image:\s*(.+?)\s*$')

PUBLISHED = 'published'
UNPUBLISHED = 'unpublished'
STATUSES = (PUBLISHED, UNPUBLISHED)

# One rule name per way a production image can be unusable, so a report line and a
# test name the same thing.
TAG_ONLY = 'tag_only'
BUILT_LOCALLY = 'built_locally'
DIGEST_MISMATCH = 'digest_mismatch'
MISSING_ENTRY = 'missing_entry'
STALE_ENTRY = 'stale_entry'
UNPUBLISHED_PIN = 'unpublished'

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
    reason: str | None = None

    @property
    def published(self) -> bool:
        return self.status == PUBLISHED


@dataclass(frozen=True)
class Manifest:
    """The recorded pins and the registry account they belong to, if one is chosen."""

    entries: tuple[Entry, ...]
    registry: str | None = None

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

    def failures(self, release: bool) -> tuple[Finding, ...]:
        """The findings that fail this mode.

        The release gate fails every finding. Otherwise an unpublished owned image
        is reported, not failed: whether to buy a registry account is the owner's
        decision, not a defect in this repository.
        """
        if release:
            return self.findings
        return tuple(finding for finding in self.findings if finding.rule != UNPUBLISHED_PIN)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ManifestError(message)


def parse_manifest(document: object) -> Manifest:
    """Validate the manifest document, or name the first field that breaks it."""
    _require(isinstance(document, dict), 'the manifest is a JSON object')
    _require(document.get('schemaVersion') == SCHEMA_VERSION,
             f'schemaVersion must be {SCHEMA_VERSION}')
    registry = document.get('registry')
    _require(registry is None or (isinstance(registry, str) and registry.strip()),
             'registry is null (none chosen) or a non-empty account name')
    entries = document.get('images')
    _require(isinstance(entries, list) and entries, 'images is a non-empty list')
    parsed: list[Entry] = []
    for position, raw in enumerate(entries):
        parsed.append(_parse_entry(raw, position))
    names = [entry.service for entry in parsed]
    duplicated = sorted({name for name in names if names.count(name) > 1})
    _require(not duplicated, f'duplicate service entries: {", ".join(duplicated)}')
    return Manifest(entries=tuple(parsed), registry=registry)


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
    reason = raw.get('reason')
    if status == PUBLISHED:
        _require(isinstance(digest, str) and DIGEST.match(digest),
                 f'{where}.digest is a sha256:<64 lowercase hex> index digest')
        _require(reason is None, f'{where}.reason belongs to an unpublished entry only')
    else:
        _require(digest is None, f'{where}.digest is null while the image is unpublished')
        _require(isinstance(reason, str) and reason.strip(),
                 f'{where}.reason states why no digest is recorded yet')
        _require(bool(LOCAL_REFERENCE.match(reference)),
                 f'{where}.reference is a liwan-* image: a third-party image is published by '
                 'someone else and must carry a digest')
    return Entry(service=service, reference=reference, status=status, evidence=evidence,
                 digest=digest, reason=reason)


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
        for service, block in services(text).items():
            image = _image_of(block)
            if image is not None or service not in effective:
                effective[service] = DeclaredImage(service=service, image=image, compose=name)
    return tuple(effective[service] for service in sorted(effective))


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
            findings.extend(_entry_findings(item, entry))
    findings.extend(_stale_entry(entry) for entry in manifest.entries
                    if entry.service not in declared_services)
    return Report(declared=declared, findings=tuple(findings))


def _declared_subject(item: DeclaredImage) -> str:
    """How the report names a service whose compose file declares no image of its own."""
    return item.image or f'built locally by {item.compose}'


def _entry_findings(item: DeclaredImage, entry: Entry) -> tuple[Finding, ...]:
    if not entry.published:
        return (_unpublished(item, entry),)
    if item.image is None:
        return (_built_locally(item, entry),)
    if item.digest is None:
        return (_undigested(item, entry),)
    if item.digest != entry.digest:
        return (_mismatched(item, entry),)
    return ()


def _unpublished(item: DeclaredImage, entry: Entry) -> Finding:
    """The image this stack runs has never been published anywhere."""
    return Finding(
        rule=UNPUBLISHED_PIN,
        service=item.service,
        subject=_declared_subject(item),
        detail=f'{entry.reference} has no published digest yet: {entry.reason}',
        action=(f'publish {entry.reference} under the chosen registry account, resolve the index '
                'digest with `docker buildx imagetools inspect`, then record it in '
                f'deploy/production-images.json as reference "<registry>/{entry.reference}", '
                'digest "sha256:<64 hex>", status "published"'),
    )


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
    registry = manifest.registry or 'none chosen (every liwan-* image is still unpublished)'
    recorded_count = f'{len(manifest.entries)} entries, schema {SCHEMA_VERSION}'
    lines = [
        'production image pins',
        '=====================',
        f'manifest: deploy/production-images.json ({recorded_count})',
        f'registry: {registry}',
        f'declared services: {len(report.declared)}; findings: {len(report.findings)}',
        '',
        '| service | declared image | recorded pin |',
        '| --- | --- | --- |',
    ]
    for item in report.declared:
        entry = entries.get(item.service)
        recorded = 'missing' if entry is None else (entry.digest or entry.status)
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
        return 'Result: every production image is pinned by a digest the manifest records.'
    unpublished = tuple(f for f in report.findings if f.rule == UNPUBLISHED_PIN)
    others = tuple(f for f in report.findings if f.rule != UNPUBLISHED_PIN)
    parts = []
    if others:
        parts.append(f'{len(others)} finding(s) fail the check now (see above)')
    if unpublished:
        parts.append(f'{len(unpublished)} image(s) are not published yet and block a release')
    return 'Result: ' + '; '.join(parts) + '.'


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='image_pins.py',
        description='Check that every production image is pinned by a digest recorded in '
                    'deploy/production-images.json. The report is always printed; --check makes '
                    'it the release gate, which also fails an image that is not published yet.',
    )
    parser.add_argument('--check', action='store_true',
                        help='release gate: fail on an unpublished pin too, not only on a broken one')
    parser.add_argument('--manifest', default=str(MANIFEST_PATH), help='manifest to read')
    parser.add_argument('--compose', nargs='+', default=[str(path) for path in COMPOSE_FILES],
                        help='compose files that make up the production stack, in the order '
                             'Compose applies them')
    return parser


def main(argv=None) -> int:
    """Exit 0 when the stack is pinned as asked, 1 when it is not, 2 on unreadable input."""
    args = build_parser().parse_args(argv)
    try:
        manifest = load_manifest(Path(args.manifest))
        texts = {str(Path(path)): Path(path).read_text(encoding='utf-8') for path in args.compose}
    except (OSError, ManifestError) as error:
        sys.stderr.write(f'image_pins: {error}\n')
        return EXIT_BAD_INPUT
    report = check(texts, manifest)
    sys.stdout.write(render_report(report, manifest))
    return EXIT_OK if not report.failures(release=_is_release_gate(args, manifest)) else EXIT_FAILED


def _is_release_gate(args: argparse.Namespace, manifest: Manifest) -> bool:
    """Whether an unpublished pin fails this run.

    ``--check`` always fails it. Otherwise it fails as soon as the manifest claims a
    registry account, because then it claims those images exist there and a null
    digest is a contradiction, not a pending decision.
    """
    return args.check or manifest.registry is not None


if __name__ == '__main__':
    raise SystemExit(main())
