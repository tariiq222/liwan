#!/usr/bin/env python3
"""Run a manual, scratch-only concurrent fiscal-year close drill."""

import argparse
import json
import sys
import threading
import time
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener

DOCUMENTED_REFUSAL_CODES = frozenset({"already_closed"})
MAX_BODY_LENGTH = 16_384


def _remaining_budget(deadline, clock=time.monotonic):
    return max(0.0, deadline - clock())


def _read_limited(response, deadline):
    chunks = bytearray()
    raw = getattr(getattr(response, "fp", None), "raw", None)
    sock = getattr(raw, "_sock", None)
    while len(chunks) < MAX_BODY_LENGTH:
        remaining = _remaining_budget(deadline)
        if remaining <= 0:
            raise TimeoutError
        if sock is not None:
            sock.settimeout(remaining)
        chunk = response.read1(MAX_BODY_LENGTH - len(chunks))
        if not chunk:
            break
        chunks.extend(chunk)
    return bytes(chunks)


def _request(opener, url, payload, deadline):
    timeout = _remaining_budget(deadline)
    if timeout <= 0:
        return {"error": "timeout"}
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            return {
                "status": response.status,
                "body": _parse_body(_read_limited(response, deadline)),
            }
    except HTTPError as error:
        return {
            "status": error.code,
            "body": _parse_body(_read_limited(error, deadline)),
        }
    except (TimeoutError, URLError, OSError):
        return {
            "error": "timeout"
            if _remaining_budget(deadline) <= 0
            else "transport failure",
        }


def _parse_body(raw_body):
    text = raw_body.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _session(base_url):
    return build_opener(HTTPCookieProcessor(CookieJar())), base_url.rstrip("/")


def authenticate(base_url, db, login, password, deadline):
    opener, root_url = _session(base_url)
    result = _request(
        opener,
        f"{root_url}/web/session/authenticate",
        {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {"db": db, "login": login, "password": password},
        },
        deadline,
    )
    body = result.get("body")
    response = body.get("result", body) if isinstance(body, dict) else {}
    if (
        result.get("status") != 200
        or not isinstance(response, dict)
        or not response.get("uid")
    ):
        auth_error = (
            "authentication failed (credentials/database/HTTP status; details withheld)"
        )
        raise RuntimeError(auth_error)
    return opener, root_url


def _body_summary(body):
    serialized = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    if len(serialized) <= MAX_BODY_LENGTH:
        return body
    return serialized[:MAX_BODY_LENGTH] + "…"


def classify_results(results):
    """Return (invariant_holds, explanation) for two HTTP call result records."""
    if len(results) != 2:
        return False, "expected exactly two close results"
    if any("error" in result for result in results):
        return False, "a close request timed out or failed at transport level"
    successes = [result for result in results if result.get("status") in (200, 201)]
    refusals = [result for result in results if result.get("status") == 422]
    if len(successes) != 1:
        return False, "expected exactly one successful close (200/201)"
    if len(refusals) != 1:
        return False, "expected exactly one structured 422 refusal"
    body = refusals[0].get("body")
    if not isinstance(body, dict) or body.get("code") not in DOCUMENTED_REFUSAL_CODES:
        return False, "422 refusal did not contain a documented code"
    return (
        True,
        "one close succeeded and the concurrent request was refused as already_closed",
    )


def _collect_worker_results(workers, deadline, clock=time.monotonic):
    results = []
    for worker in workers:
        worker.join(timeout=_remaining_budget(deadline, clock))
        if worker.is_alive():
            return [{"error": "timeout"}]
        results.append(worker.result)
    return results


def run_race(base_url, db, login, password, year, timeout):
    started = time.monotonic()
    deadline = started + timeout
    clients = [authenticate(base_url, db, login, password, deadline) for _ in range(2)]
    barrier = threading.Barrier(2)

    def close(session):
        opener, root_url = session
        try:
            remaining = _remaining_budget(deadline)
            if remaining <= 0:
                return {"error": "timeout"}
            barrier.wait(timeout=remaining)
            return _request(
                opener,
                f"{root_url}/api/v1/finance/fiscal-years/{year}/close",
                {"jsonrpc": "2.0", "method": "call", "params": {}},
                deadline,
            )
        except (TimeoutError, URLError, OSError):
            return {
                "error": "timeout"
                if _remaining_budget(deadline) <= 0
                else "transport failure",
            }
        except threading.BrokenBarrierError:
            return {"error": "timeout"}

    workers = []
    for session in clients:

        def run_worker(target_session=session):
            worker = threading.current_thread()
            worker.result = close(target_session)

        worker = threading.Thread(target=run_worker, daemon=True)
        worker.result = None
        workers.append(worker)
    for worker in workers:
        worker.start()
    results = _collect_worker_results(workers, deadline)
    elapsed = round(time.monotonic() - started, 3)
    valid, message = classify_results(results)
    return {
        "valid": valid,
        "message": message,
        "statuses": [result.get("status") for result in results],
        "results": [
            {
                key: _body_summary(value) if key == "body" else value
                for key, value in result.items()
            }
            for result in results
        ],
        "elapsed_seconds": elapsed,
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--login", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--json-out", help="also write the summary JSON to this file")
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        summary = run_race(
            args.base_url,
            args.db,
            args.login,
            args.password,
            args.year,
            args.timeout,
        )
    except (RuntimeError, URLError, OSError) as error:
        summary = {
            "valid": False,
            "message": str(error)
            if isinstance(error, RuntimeError)
            else "request failed (details withheld)",
            "results": [],
        }
    rendered = json.dumps(summary, ensure_ascii=False, indent=2)
    sys.stdout.write(rendered + "\n")
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as output:
            output.write(rendered + "\n")
    return 0 if summary["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
