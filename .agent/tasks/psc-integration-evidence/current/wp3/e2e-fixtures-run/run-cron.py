from datetime import datetime
env["project.task"]._nasq_run_deadline_notifications(now=datetime(2099, 6, 15, 10, 0, 0))
env.cr.commit()
print("CRON_OK")
