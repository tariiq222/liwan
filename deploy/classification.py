# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Write and validate the disposable CI classification fixture; no DB or network I/O."""
import argparse
import importlib.util
import json
import os
import re
import tempfile
from pathlib import Path

PARSER = Path(__file__).resolve().parents[1] / 'odoo-addons/liwan_platform/commercial_config.py'
spec = importlib.util.spec_from_file_location('liwan_commercial_config', PARSER)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


def validate_bytes(raw, database, expected, *, fresh=False):
    if len(raw) > 16384:
        message = 'classification exceeds 16 KiB'
        raise ValueError(message)
    # Validate exactly the bytes later mounted, not a source file that can change.
    with tempfile.TemporaryDirectory(prefix='liwan-classification-check-') as tmp:
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


def fixture(database, mode, output):
    """Explicit disposable CI input, never a production classification generator."""
    if (not re.fullmatch(r'liwan_[a-zA-Z0-9_]*scratch[a-zA-Z0-9_]*', database)
            or any(word in database.lower() for word in ('odoo19', 'production', 'postgres'))):
        message = 'fixture requires a liwan_*scratch* disposable database name'
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
    fixtures = sub.add_parser('fixture')
    fixtures.add_argument('--database', required=True)
    fixtures.add_argument('--mode', choices=tuple(config.SOURCES), required=True)
    fixtures.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        fixture(args.database, args.mode, args.output)
    except (OSError, ValueError, KeyError) as exc:
        parser.exit(2, f'classification preflight failed: {exc}\n')


if __name__ == '__main__':
    main()
