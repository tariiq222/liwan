# Meeting engine absorbed — fresh database baseline

liwan_meetings now owns `liwan.meeting.minute` and `liwan.meeting.resolution`; the vendored
`cyan_meeting_minutes` addon is removed. Like the LiwanOS namespace baseline (19.0.1.1.0), this
version is installed on a new database. Upgrading a database that ran `cyan_meeting_minutes` is
unsupported, and no data migration or compatibility schema is provided.
