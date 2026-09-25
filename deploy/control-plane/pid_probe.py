#!/usr/bin/env python3
"""Return 0 only when PID is absent with ESRCH; all ambiguity is failure."""
import errno
import os
import sys

if len(sys.argv) != 2 or not sys.argv[1].isdigit() or int(sys.argv[1]) <= 1:
    raise SystemExit(2)
try:
    os.kill(int(sys.argv[1]), 0)
except OSError as exc:
    if exc.errno == errno.ESRCH:
        raise SystemExit(0)
    raise SystemExit(1)
raise SystemExit(1)
