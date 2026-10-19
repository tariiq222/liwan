# Leave

Adds the stock `hr_holidays` and `hr_work_entry_holidays` dependencies and four leave capability groups and
permissions. The new `data/hr_leave_type_data.xml` corrects stock Saudi leave types in place (`requires_allocation`
and missing work entry types), which hr_holidays creates at the same install; there are no existing WebVue rows to
carry forward, so no data migration is needed.
