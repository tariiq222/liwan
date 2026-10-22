"""Tag only a complete successful twelve-stage CI run on current main."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from ci_scope import STAGES
from github_trust import require_main
from pr_delivery import run_jobs
from pr_review import api

TAG = re.compile(r'release/(19\.0\.\d+\.\d+\.\d+)\Z')


def next_tag(tags: list[str]) -> str:
    versions = [tuple(map(int, m.group(1).split('.'))) for t in tags if (m := TAG.fullmatch(t))]
    if not versions:
        msg = 'No existing release numbering baseline'
        raise ValueError(msg)
    current = max(versions)
    return 'release/' + '.'.join(map(str, (*current[:-1], current[-1] + 1)))


def full_success(jobs: list[dict]) -> bool:
    for stage in (*STAGES, 'ci-result'):
        group = [j for j in jobs if j['name'] == stage or j['name'].startswith(stage + ' (')]
        if not group or any(j['conclusion'] != 'success' for j in group):
            return False
    return True


def tag_run(repo: str, run_id: int) -> str:
    run = api(f'repos/{repo}/actions/runs/{run_id}')
    workflow = api(f'repos/{repo}/actions/workflows/ci.yml')
    head = api(f'repos/{repo}/git/ref/heads/main')['object']['sha']
    if (run['workflow_id'] != workflow['id'] or run['head_repository']['full_name'] != repo
            or run['head_branch'] != 'main' or run['head_sha'] != head or run['status'] != 'completed'
            or run['conclusion'] != 'success' or run['event'] not in ('push', 'workflow_dispatch')):
        msg = 'Release requires successful current-main CI from trusted workflow'
        raise RuntimeError(msg)
    jobs = run_jobs(repo, run_id)
    if not full_success(jobs):
        msg = 'All twelve CI stages must actually succeed before versioning'
        raise RuntimeError(msg)
    refs = api(f'repos/{repo}/git/matching-refs/tags/release/')
    for ref in refs:
        if not TAG.fullmatch(ref['ref'].removeprefix('refs/tags/')):
            continue
        obj = ref['object']
        if obj['type'] == 'tag':
            obj = api(f"repos/{repo}/git/tags/{obj['sha']}")['object']
        if obj['sha'] == head:
            return ref['ref'].removeprefix('refs/tags/')
    tag = next_tag([r['ref'].removeprefix('refs/tags/') for r in refs])
    if api(f'repos/{repo}/git/ref/heads/main')['object']['sha'] != head:
        msg = 'Main advanced before tag creation'
        raise RuntimeError(msg)
    api(f'repos/{repo}/git/refs', {'ref': f'refs/tags/{tag}', 'sha': head})
    return tag


def main():
    require_main()
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
    tag = tag_run(os.environ['GITHUB_REPOSITORY'], event['workflow_run']['id'])
    sys.stdout.write(tag + '\n')


if __name__ == '__main__':
    main()
