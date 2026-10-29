# 19.0.1.1.0

Adds the stored integer `mail.message.webvue_crm_count` (default 1) that a `crm.assigned` bell uses to say how many
opportunities it stands for, and the bell kind `crm.needs_manager` for the manager-decision alert. Existing rows take the
default through the column default, and the alert rows delivered before the split keep the kind `crm.assigned`, which
the bell still shows. No data migration is needed.
