# Leave

Adds the stock `hr_holidays` and `hr_work_entry_holidays` dependencies, four leave capability groups and
permissions, and `security/hr_leave_officer_group.xml`, which narrows the stock time-off officer group so
approving leave no longer implies `hr.group_hr_user` (every employee's bank account and private fields).
`data/hr_leave_type_data.xml` corrects stock Saudi leave types (`requires_allocation` and missing work entry
types). Those stock records are `noupdate`, so `post-apply_stock_leave_corrections.py` repeats both
corrections through the ORM for a database upgraded in place; a fresh install gets them from the XML.
