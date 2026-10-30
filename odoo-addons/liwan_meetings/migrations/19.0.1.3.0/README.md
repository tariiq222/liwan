# الترحيل 19.0.1.3.0 — liwan_meetings

حقل مخزَّن جديد `liwan.meeting.series.active` (الافتراضي True)، فتصبح كل السلاسل القائمة نشطة دون خطوة بيانات.
وتضييق الـACL: الصفان `access_liwan_meeting_minute_manage` و`access_liwan_meeting_resolution_manage` بلا `perm_unlink`
(ملفات `security/*.csv` تُحمَّل عند `-u` فلا حاجة لسكربت).
