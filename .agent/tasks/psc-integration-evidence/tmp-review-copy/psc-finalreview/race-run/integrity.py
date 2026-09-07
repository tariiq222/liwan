from datetime import date
from psycopg2 import IntegrityError
key = 'overdue_digest:1:3:2099-06-15'
partner = env.user.partner_id
first = env["project.task"]._nasq_create_digest_notification(company=env.company, partner=partner, body="dup", key=key, overdue_count=1, local_date=date(2099, 6, 15))
second = env["project.task"]._nasq_create_digest_notification(company=env.company, partner=partner, body="dup", key=key, overdue_count=1, local_date=date(2099, 6, 15))
assert second is False, second
raised = False
try:
    with env.cr.savepoint():
        env["res.users"].create({"login": env.user.login})
except IntegrityError:
    raised = True
except Exception as error:
    name = type(error).__name__
    raised = "Integrity" in name or "Unique" in name or "Validation" in name
assert raised, "unrelated integrity/unique failure was swallowed"
print("INTEGRITY_OK")
