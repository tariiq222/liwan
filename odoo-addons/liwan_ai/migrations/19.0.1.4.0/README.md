# 19.0.1.4.0

No data migration. This version adds the agent and tool settings (`liwan_ai_agent_setting`, `liwan_ai_tool_setting`,
both empty until an administrator narrows an agent), two settings columns with defaults
(`messages_per_user_monthly` = 0, `external_send` = `draft_only`) that Odoo fills on update, and the nullable
`agent_key` audit column: audit rows recorded before it carry no agent and are counted by user and tool only.
