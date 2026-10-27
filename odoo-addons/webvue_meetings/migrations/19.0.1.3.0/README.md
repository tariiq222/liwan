# الترحيل 19.0.1.3.0 — webvue_meetings

حقل مخزَّن جديد `webvue.meeting.series.active` (الافتراضي True)، فتصبح كل السلاسل القائمة نشطة دون خطوة بيانات.
وتضييق الـACL: الصفان `access_webvue_meeting_minute_manage` و`access_webvue_meeting_resolution_manage` بلا `perm_unlink`
(ملفات `security/*.csv` تُحمَّل عند `-u` فلا حاجة لسكربت).
