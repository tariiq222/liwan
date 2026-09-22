# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Validate a frozen local classification before provisioning; no DB or network I/O."""
import argparse
import importlib.util
import json
import os
import re
import tempfile
from datetime import date
from pathlib import Path

PARSER = Path(__file__).resolve().parents[1] / 'odoo-addons/nasq_platform/commercial_config.py'
spec = importlib.util.spec_from_file_location('nasq_commercial_config', PARSER)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


def validate_bytes(raw, database, expected, *, fresh=False):
    if len(raw) > 16384:
        message = 'classification exceeds 16 KiB'
        raise ValueError(message)
    # Validate exactly the bytes later mounted, not a source file that can change.
    with tempfile.TemporaryDirectory(prefix='nasq-classification-check-') as tmp:
        path = Path(tmp) / 'input.json'
        path.write_bytes(raw)
        previous = os.environ.get(config.CONFIG_ENV)
        os.environ[config.CONFIG_ENV] = str(path)
        try:
            result = config.load_classification(database, expected)
        finally:
            if previous is None:
                os.environ.pop(config.CONFIG_ENV, None)
            else:
                os.environ[config.CONFIG_ENV] = previous
    if fresh and (expected is not None or result['clear_valid_until']):
        message = 'fresh provisioning requires null expected cutoff and preserve action'
        raise ValueError(message)
    return result


def stage(source, output, database, expected, *, fresh=False):
    source, output = Path(source), Path(output)
    if not source.is_absolute() or not output.is_absolute():
        message = 'input and output paths must be absolute'
        raise ValueError(message)
    with source.open('rb') as stream:
        raw = stream.read(16385)
    validate_bytes(raw, database, expected, fresh=fresh)
    # Never overwrite an existing mapping. Host directory must be operator-owned.
    with output.open('xb') as stream:
        stream.write(raw)
    output.chmod(0o444)  # Non-secret mapping readable by the image's UID 10001.


def fixture(database, mode, output):
    """Explicit disposable CI input, never a production classification generator."""
    if (not re.fullmatch(r'nasq_[a-zA-Z0-9_]*scratch[a-zA-Z0-9_]*', database)
            or any(word in database.lower() for word in ('odoo19', 'production', 'postgres'))):
        message = 'fixture requires a nasq_*scratch* disposable database name'
        raise ValueError(message)
    payload = {
        'schema_version': 1, 'database': database, 'commercial_mode': mode,
        'entitlement_source': config.SOURCES[mode],
        'expected_valid_until': None, 'valid_until_action': 'preserve',
    }
    raw = json.dumps(payload).encode()
    validate_bytes(raw, database, None, fresh=True)
    output = Path(output)
    if not output.is_absolute():
        message = 'output path must be absolute'
        raise ValueError(message)
    with output.open('xb') as stream:
        stream.write(raw)
    output.chmod(0o444)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    staging = sub.add_parser('stage')
    staging.add_argument('--file', required=True)
    staging.add_argument('--output', required=True)
    staging.add_argument('--database', required=True)
    staging.add_argument('--expected-valid-until', required=True, help='observed YYYY-MM-DD or none')
    staging.add_argument('--fresh', action='store_true')
    fixtures = sub.add_parser('fixture')
    fixtures.add_argument('--database', required=True)
    fixtures.add_argument('--mode', choices=tuple(config.SOURCES), required=True)
    fixtures.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'fixture':
            fixture(args.database, args.mode, args.output)
        else:
            expected = None if args.expected_valid_until == 'none' else date.fromisoformat(args.expected_valid_until)
            stage(args.file, args.output, args.database, expected, fresh=args.fresh)
    except (OSError, ValueError, KeyError) as exc:
        parser.exit(2, f'classification preflight failed: {exc}\n')


if __name__ == '__main__':
    main()
