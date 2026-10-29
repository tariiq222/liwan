# الترحيل 19.0.1.4.0 — webvue_meetings

موديل جديد `webvue.meeting.settings` (صف واحد لكل شركة، يُنشأ عند أول حفظ، ولا صف يعني القيمة الافتراضية `organizers_only`)
وصلاحية جديدة `meetings.settings.manage` ودور مدمج جديد `meetings_organizer` (منظّم الاجتماعات): كلها بيانات XML/CSV تُحمَّل عند `-u`
فلا حاجة لسكربت. السلوك القائم لا يتغير: الافتراضي يطابق الحالي (الجدولة لمن يملك `meetings.create`).
وتغيير ACL: الصف `access_webvue_meeting_minute_manage` صار بـ`perm_unlink` لحذف المسودة، وصف قراءة السلاسل صار يكتب وينشئ
بدل صف `access_webvue_meeting_series_create` المحذوف (التحقق من القدرة يبقى في الموديل).
