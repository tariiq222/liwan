from datetime import datetime
from pathlib import Path
ready = Path('/Users/tariq/code/nasq/.agent/tasks/psc-integration-evidence/current/wp3/race-run/digest-ready-b')
go = Path('/Users/tariq/code/nasq/.agent/tasks/psc-integration-evidence/current/wp3/race-run/digest-go')
ready.write_text("1", encoding="utf-8")
while not go.exists():
    pass
env["project.task"]._nasq_run_deadline_notifications(now=datetime(2099, 6, 15, 10, 0, 0))
env.cr.commit()
print("DIGEST_WORKER_OK")
