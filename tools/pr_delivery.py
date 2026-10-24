"""Trusted-main PR delivery controls. Never executes a candidate checkout."""
from __future__ import annotations

import argparse
import base64
import difflib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

from github_trust import require_main
from pr_review import api, output

BOTS = ('claude[bot]', 'github-actions[bot]')
SAFE_PREFIXES = ('apps/web/app/components/', 'apps/web/app/pages/', 'apps/web/stories/',
                 'packages/ui/src/', 'packages/ui/tests/', 'docs/')
SENSITIVE = re.compile(r'auth|permission|security|credential|token|payment|billing|migration|'
                       r'\bsudo\b|\bunlink\b|\bdrop\s|\balter\s|\bdelete\s+from|'
                       r'\bchmod\b|\beval\b|child_process|subprocess|dangerously|v-html|'
                       r'\bcan\s*\(|(?-i:\bcan[A-Z]\w*)|\bhas(?:Role|Access|Capability)|'
                       r'\buseCapabilities\b|\bv-(?:if|else-if|show)\b|\b(?:disabled|readonly)\s*=', re.I)
ATTEMPT = re.compile(r'<!-- webvue-repair:([0-9a-f]{40}):([1-3]) -->')


def request(method: str, endpoint: str, payload: dict):
    result = subprocess.run(['gh', 'api', '--method', method, endpoint, '--input', '-'],
                            input=json.dumps(payload), capture_output=True, text=True, timeout=60, check=False)
    if result.returncode:
        raise RuntimeError(f'GitHub {method} failed for {endpoint}; protections remain binding')
    return json.loads(result.stdout) if result.stdout.strip() else None


def eligible(pr: dict, repo: str) -> bool:
    return (pr['state'] == 'open' and not pr['draft'] and pr['base']['ref'] == 'main'
            and pr['head']['repo'] is not None and pr['head']['repo']['full_name'] == repo
            and pr['head']['ref'].startswith('claude/')
            and pr['user']['login'] in (repo.split('/', maxsplit=1)[0], *BOTS))


def safe_path(path: str) -> bool:
    parts = path.split('/')
    return (path.startswith(SAFE_PREFIXES) and not any(x in ('', '.', '..') for x in parts)
            and not SENSITIVE.search(path) and not re.search(r'(policy|rules|design|instructions|AGENTS|CLAUDE|REVIEW)', path, re.I)
            and not path.startswith(('docs/agents/', 'docs/superpowers/'))
            and path not in ('docs/testing.md', 'docs/WORKSPACE.md', 'docs/parallel-work.md')
            and Path(path).suffix in ('.vue', '.ts', '.tsx', '.js', '.css', '.md'))


def repairable_path(path: str) -> bool:
    return safe_path(path) and not re.search(r'(^|/)(tests?|__tests__)/|\.(test|spec|stories)\.', path)


def protected_source_change(before: str, after: str) -> bool:
    delta = '\n'.join(difflib.unified_diff(before.splitlines(), after.splitlines(), n=0))
    return bool(SENSITIVE.search(delta) or re.search(r'\b(?:play\s*:|expect\s*\(|assert\s*\(|describe\s*\()', before))


def sensitive(files: list[dict]) -> bool:
    return (not files or len(files) > 30 or any(
        not safe_path(f['filename']) or f['status'] not in ('modified', 'added')
        or 'patch' not in f or SENSITIVE.search(f['patch']) for f in files))


def automation_authored(repo: str, pr: dict, head: str) -> bool:
    """Claude reviews every head, so a head written by automation (or unattributed) never reviews itself into main."""
    actors = [pr['user']['login'], (api(f'repos/{repo}/commits/{head}').get('author') or {}).get('login')]
    return not all(actors) or any(actor in BOTS for actor in actors)


def approved(comments: list[dict], owner: str, head: str) -> bool:
    return any(c['user']['login'] == owner and c.get('body', '').strip() == f'/webvue approve {head}'
               for c in comments)


def attempt_marker(head: str, number: int) -> str:
    return f'<!-- webvue-repair:{head}:{number} -->'


def attempts(comments: list[dict]) -> list[tuple[str, int]]:
    return sorted({(m.group(1), int(m.group(2))) for c in comments
                   if c['user']['login'] == 'github-actions[bot]'
                   for m in ATTEMPT.finditer(c.get('body', ''))}, key=lambda row: row[1])


def decide(ci: str, review: str, count: int, same_head: bool) -> str:
    if ci == review == 'success':
        return 'merge'
    if ci not in ('success', 'failure') or review not in ('success', 'failure'):
        return 'wait'
    if count >= 3:
        return 'stop'
    return 'wait' if same_head else 'repair'


def files_for(repo: str, pr: dict) -> list[dict]:
    files = api(f"repos/{repo}/pulls/{pr['number']}/files", pages=True)
    if len(files) != pr['changed_files']:
        msg = 'Incomplete PR file inventory'
        raise RuntimeError(msg)
    return files


def checked_pr(repo: str, number: int, head: str = '') -> dict:
    pr = api(f'repos/{repo}/pulls/{number}')
    if not eligible(pr, repo) or (head and pr['head']['sha'] != head):
        msg = 'PR is ineligible or its head moved'
        raise RuntimeError(msg)
    return pr


def policy_status(repo: str, head: str, state: str, message: str):
    api(f'repos/{repo}/statuses/{head}', {'state': state, 'context': 'delivery-policy',
                                        'description': message[:140]})


def ci_run(repo: str, head: str) -> dict | None:
    runs = api(f'repos/{repo}/actions/workflows/ci.yml/runs?head_sha={head}&per_page=30')['workflow_runs']
    return next((r for r in runs if r['head_sha'] == head and r['head_repository']['full_name'] == repo
                 and r['event'] in ('pull_request', 'workflow_dispatch')), None)


def ci_state(repo: str, head: str) -> str:
    run = ci_run(repo, head)
    if run is None or run['status'] != 'completed':
        return 'pending'
    jobs = run_jobs(repo, run['id'])
    gate = next((j for j in jobs if j['name'] == 'ci-result'), None)
    if gate is None:
        return 'pending'
    return 'success' if run['conclusion'] == gate['conclusion'] == 'success' else (
        'failure' if run['conclusion'] == 'failure' and gate['conclusion'] == 'failure' else 'cancelled')


def run_jobs(repo: str, run_id: int) -> list[dict]:
    result = api(f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100&page=1')
    jobs = result['jobs']
    for page in range(2, (result['total_count'] + 99) // 100 + 1):
        jobs += api(f'repos/{repo}/actions/runs/{run_id}/jobs?per_page=100&page={page}')['jobs']
    if len(jobs) != result['total_count']:
        msg = 'Incomplete job inventory'
        raise RuntimeError(msg)
    return jobs


def review_state(repo: str, head: str, number: int) -> str:
    statuses = api(f'repos/{repo}/commits/{head}/statuses', pages=True)
    item = next((s for s in statuses if s['context'] == 'code-review'
                 and s['creator']['login'] == 'github-actions[bot]'), None)
    if item is None:
        return 'pending'
    match = re.fullmatch(rf'https://github\.com/{re.escape(repo)}/actions/runs/([0-9]+)', item.get('target_url', ''))
    if not match:
        return 'pending'
    run = api(f'repos/{repo}/actions/runs/{match.group(1)}')
    workflow = api(f'repos/{repo}/actions/workflows/pr-review.yml')
    if (run['workflow_id'] != workflow['id'] or run['head_repository']['full_name'] != repo
            or run.get('display_title') != f'pr-review #{number}' or run['status'] != 'completed'
            or run['event'] not in ('pull_request_target', 'workflow_dispatch')):
        return 'pending'
    return item['state']


def dispatch(repo: str, number: int, head: str, branch: str):
    # GITHUB_TOKEN edits do not reliably start follow-up event workflows. Dispatch explicitly.
    api(f'repos/{repo}/actions/workflows/ci.yml/dispatches', {'ref': branch, 'inputs': {'full': True}})
    api(f'repos/{repo}/actions/workflows/pr-review.yml/dispatches', {
        'ref': 'main', 'inputs': {'pr': str(number), 'head': head}})


def plan(repo: str, number: int):
    pr = checked_pr(repo, number)
    head = pr['head']['sha']
    comments = api(f'repos/{repo}/issues/{number}/comments', pages=True)
    files = files_for(repo, pr)
    if ((sensitive(files) or automation_authored(repo, pr, head))
            and not approved(comments, repo.split('/', maxsplit=1)[0], head)):
        policy_status(repo, head, 'pending', 'Sensitive or automation-authored: owner approval of this exact SHA required')
        output(decision='wait')
        return
    policy_status(repo, head, 'success', 'Owner-authored eligible scope, or owner approved this exact SHA')
    history = attempts(comments)
    action = decide(ci_state(repo, head), review_state(repo, head, number), len(history),
                    any(old == head for old, _ in history))
    # Sensitive changes may merge after explicit approval, but are never repaired autonomously.
    if action == 'repair' and sensitive(files):
        action = 'stop'
    if action == 'merge':
        fresh = checked_pr(repo, number, head)
        if fresh['mergeable_state'] != 'clean':
            action = 'wait'
        else:
            result = request('PUT', f'repos/{repo}/pulls/{number}/merge', {'sha': head, 'merge_method': 'merge'})
            if not result.get('merged'):
                msg = 'GitHub refused merge; do not bypass protections'
                raise RuntimeError(msg)
            api(f'repos/{repo}/actions/workflows/ci.yml/dispatches', {'ref': 'main', 'inputs': {'full': True}})
            output(decision='merged')
            return
    if action == 'repair':
        attempt = len(history) + 1
        checked_pr(repo, number, head)
        api(f'repos/{repo}/issues/{number}/comments', {
            'body': f'{attempt_marker(head, attempt)}\nAutomatic repair cycle {attempt}/3 for `{head}`. '
                    'Checks and review rerun after a validated edit; gates cannot be changed.'})
        output(decision='repair', pr=number, head=head, attempt=attempt)
    else:
        if action == 'stop':
            policy_status(repo, head, 'failure', 'Automatic repair stopped: owner action needed')
        output(decision=action)


def validate_patch(report: dict, head: str, files: list[dict]) -> list[dict]:
    edits = report.get('edits')
    paths = {f['filename'] for f in files if repairable_path(f['filename']) and f['status'] == 'modified'}
    if (report.get('head_sha') != head or not isinstance(report.get('summary'), str)
            or not report['summary'].strip() or not isinstance(edits, list) or not 1 <= len(edits) <= 5):
        msg = 'Incomplete repair report'
        raise ValueError(msg)
    seen = set()
    size = 0
    for edit in edits:
        path, content = edit.get('path'), edit.get('content')
        if (path not in paths or path in seen or not isinstance(content, str)
                or not content.strip() or '\x00' in content or SENSITIVE.search(content)):
            msg = 'Repair exceeds safe original file scope'
            raise ValueError(msg)
        seen.add(path)
        size += len(content.encode('utf-8'))
    if size > 200000:
        msg = 'Repair is too large'
        raise ValueError(msg)
    return edits


def publish(repo: str, number: int, head: str, report: dict, attempt: int):
    pr = checked_pr(repo, number, head)
    comments = api(f'repos/{repo}/issues/{number}/comments', pages=True)
    if (head, attempt) not in attempts(comments):
        msg = 'No trusted reserved repair cycle'
        raise RuntimeError(msg)
    files = files_for(repo, pr)
    if sensitive(files):
        msg = 'Sensitive scope cannot be repaired autonomously'
        raise RuntimeError(msg)
    edits = validate_patch(report, head, files)
    commit = api(f'repos/{repo}/git/commits/{head}')
    tree = api(f"repos/{repo}/git/trees/{commit['tree']['sha']}?recursive=1")
    modes = {e['path']: e for e in tree['tree']}
    if tree.get('truncated') or any(modes.get(e['path'], {}).get('mode') != '100644' for e in edits):
        msg = 'Repair target is missing, executable, symlinked or inventory incomplete'
        raise RuntimeError(msg)
    entries = []
    for edit in edits:
        original = api(f"repos/{repo}/git/blobs/{modes[edit['path']]['sha']}")
        if original.get('encoding') != 'base64':
            msg = 'Original source evidence unavailable'
            raise RuntimeError(msg)
        before = base64.b64decode(original['content']).decode('utf-8')
        if protected_source_change(before, edit['content']):
            msg = 'Repair may not change capability guards or embedded tests'
            raise RuntimeError(msg)
        blob = api(f'repos/{repo}/git/blobs', {
            'content': base64.b64encode(edit['content'].encode()).decode(), 'encoding': 'base64'})
        if blob['sha'] == modes[edit['path']]['sha']:
            continue
        entries.append({'path': edit['path'], 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    if not entries:
        msg = 'Repair produced no changes'
        raise RuntimeError(msg)
    new_tree = api(f'repos/{repo}/git/trees', {'base_tree': commit['tree']['sha'], 'tree': entries})
    new_commit = api(f'repos/{repo}/git/commits', {
        'message': f'fix(web): apply verified repair cycle {attempt}', 'tree': new_tree['sha'], 'parents': [head]})
    checked_pr(repo, number, head)
    # Non-force update rejects a competing writer: this commit has exactly the recorded head as parent.
    request('PATCH', f"repos/{repo}/git/refs/heads/{quote(pr['head']['ref'], safe='/')}", {
        'sha': new_commit['sha'], 'force': False})
    policy_status(repo, new_commit['sha'], 'pending', 'New repair needs fresh checks and review')
    dispatch(repo, number, new_commit['sha'], pr['head']['ref'])


def resolve(repo: str, number: int, head: str):
    """Select the PR for review; a draft, fork, foreign branch or superseded head is skipped, not failed."""
    pr = api(f'repos/{repo}/pulls/{number}')
    if not eligible(pr, repo) or pr['head']['sha'] != head:
        sys.stdout.write('PR is a draft, ineligible or superseded; no review for this head\n')
        output(eligible='false')
        return
    output(pr=number, head=head, eligible='true')


def event_pr(repo: str) -> int | None:
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
    if os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch':
        return int(event['inputs']['pr'])
    if os.environ['GITHUB_EVENT_NAME'] == 'issue_comment':
        if event['comment']['user']['login'] != repo.split('/', maxsplit=1)[0] or not event['comment']['body'].startswith('/webvue approve '):
            return None
        return event['issue']['number'] if event['issue'].get('pull_request') else None
    run = event['workflow_run']
    if run['head_repository']['full_name'] != repo:
        return None
    if run['name'] == 'pr-review':
        match = re.fullmatch(r'pr-review #([0-9]+)', run.get('display_title', ''))
        if match:
            return int(match.group(1))
    prs = run.get('pull_requests', [])
    if prs:
        return prs[0]['number']
    # Dispatch runs do not always carry pull_requests. Resolve only an exact live branch/head match.
    prs = api(f"repos/{repo}/pulls?state=open&head={quote(repo.split('/', maxsplit=1)[0] + ':' + run['head_branch'])}")
    return next((p['number'] for p in prs if p['head']['sha'] == run['head_sha']), None)


def main():
    require_main()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('plan', 'publish', 'resolve-review'))
    parser.add_argument('--repo', required=True)
    parser.add_argument('--pr', type=int)
    parser.add_argument('--head', default='')
    parser.add_argument('--attempt', type=int)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.command == 'resolve-review':
        resolve(args.repo, args.pr, args.head)
    elif args.command == 'publish':
        publish(args.repo, args.pr, args.head, json.loads(args.report.read_text()), args.attempt)
    else:
        number = args.pr or event_pr(args.repo)
        if number:
            plan(args.repo, number)


if __name__ == '__main__':
    main()
