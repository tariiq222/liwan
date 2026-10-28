# Chat

Pages: `/chat`, `/chat/new`, `/chat/[id]/[[panel]]`. Owner: `webvue_chat`.
Personas and status values: [README](README.md).

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| CHT-01 | Direct message to a colleague; message survives reload; colleague receives it | admin → employee | Delivered and persisted | automated | `e2e/tests/chat-journey.e2e.ts` |
| CHT-02 | Group with at least two others; channel with a name | staff1 | Created; group without two others refused; channel without name refused | planned | |
| CHT-03 | Reply, mention, react, pin, star, mark read | staff1, staff2 | Each action visible to members; mention limited to members | planned | |
| CHT-04 | Attachments and search | staff1 | File downloadable; search finds the message | planned | |
| CHT-05 | Filters all / unread / groups / channels / starred | staff1 | Lists match | planned | |
| CHT-06 | Edit own message; edit someone else's | staff1 | Own allowed, other refused | planned | |
| CHT-07 | Rename or add members to a direct conversation | staff1 | Refused | planned | |
| CHT-08 | Remove a member as non-creator; remove self; group under two members | staff2 | Refused; leave instead | planned | |
| CHT-09 | Non-member opens a conversation by link | staff2 | Refused | planned | |
