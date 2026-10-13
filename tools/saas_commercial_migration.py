#!/usr/bin/env python3
"""Thin driver for `admin migrate-saas-commercial`. Refuses non-scratch databases unless --allow-target."""
import argparse, os, re, subprocess, sys
from urllib.parse import urlparse

def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--run", action="store_true")
    ap.add_argument("--report")
    ap.add_argument("--database-url", default=os.environ.get("CONTROL_DATABASE_URL"))
    ap.add_argument("--allow-target", action="store_true", help="permit a database not named nasq_control_scratch_*")
    a = ap.parse_args()
    if not a.database_url:
        print("database URL required (--database-url or CONTROL_DATABASE_URL)", file=sys.stderr); return 64
    db = urlparse(a.database_url).path.lstrip("/")
    if not re.match(r"^nasq_control_scratch_", db) and not a.allow_target:
        print(f"refusing database {db!r}: not nasq_control_scratch_* (use --allow-target)", file=sys.stderr); return 65
    env = dict(os.environ, CONTROL_DATABASE_URL=a.database_url)
    cmd = ["npm", "-w", "apps/control-plane", "run", "admin", "--", "migrate-saas-commercial", "--run" if a.run else "--dry-run"]
    if a.report: cmd += ["--report", a.report]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args -- fixed argv list; env carries only the validated database URL
    return subprocess.call(cmd, cwd=root, env=env)

if __name__ == "__main__":
    sys.exit(main())
