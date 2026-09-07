from datetime import datetime
from pathlib import Path
ready = Path('/var/folders/17/rgg6yjtn60d3jf_3xszmvtw00000gn/T/opencode/psc-loop2-wp3/psc-race-dmg66rxu/digest-ready-a')
go = Path('/var/folders/17/rgg6yjtn60d3jf_3xszmvtw00000gn/T/opencode/psc-loop2-wp3/psc-race-dmg66rxu/digest-go')
ready.write_text("1", encoding="utf-8")
while not go.exists():
    pass
env["project.task"]._nasq_run_deadline_notifications(now=datetime(2099, 6, 15, 10, 0, 0))
env.cr.commit()
print("DIGEST_WORKER_OK")
