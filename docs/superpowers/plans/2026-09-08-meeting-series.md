> **سياق تاريخي للمنتج والتنفيذ.** قرارات الشكل القديمة هنا ليست تعليمات واجهة؛ اتبع [DESIGN.md](../../../DESIGN.md). تبقى العقود وقيود الأمن والبيانات خاضعة للمصادر الحالية في المشروع.

# Meeting series plan

Single isolated worktree: `/Users/tariq/code/nasq-meetings-series`. Coordinator owns Git. No commit.

## Slice A — foundation + scheduling

- Model `nasq.meeting.series` + meeting `series_id`/`project_id`
- Record rules that do not leak hidden occurrences
- Recurrence via `calendar.event`; this / this-and-following
- List filters + month window (2000)
- Contracts + Odoo tests
- Calendar month query persist

Later slices: lifecycle UI, resolutions follow-up, series pages, notifications/PDF.
