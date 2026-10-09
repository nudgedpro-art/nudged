---
name: setup
description: Set up Nudged on this account. Checks the licence key, publishes the user's private post-it board, confirms Gmail and Google Calendar are connected, and creates the hourly routine. Run once; safe to run again.
allowed-tools: Bash, ToolSearch, WebFetch, Artifact
---

Walk the user through setup in plain language. Each step tells them what you are about to do before you do it. Stop and explain if a step fails; do not improvise around a failure.

## 1. Licence key

Ask for the licence key from their purchase email (format `ND-XXXX-XXXX-XXXX-XXXX`). Check it with WebFetch (or `curl -s` in Bash):

`https://bhalezzpzzqcbqjefgld.supabase.co/functions/v1/nudged-license-check?key=<key>`

Expect JSON `{ "valid": true, "plan": "...", "renews": "YYYY-MM-DD" }`. If `valid` is false, tell them the message and point to https://nudged.pro/account. Do not continue without a valid key.

## 2. Connectors

Load the Gmail and Google Calendar tools with ToolSearch (`list_labels`, `list_calendars`). Call each once. If either fails, tell the user to connect Gmail and Google Calendar in their claude.ai connector settings, then run `/nudged:setup` again. Record the primary calendar id and its timezone from `list_calendars`.

Create the Gmail label `Post-it/Seen` with `create_label` if it does not exist (colour yellow, hidden from the label list).

## 3. The board

If `~/.claude/nudged/config.json` already has a `board_url`, keep it. Otherwise publish the board page shipped with this plugin:

- File: `${CLAUDE_PLUGIN_ROOT}/assets/board.html`
- Artifact tool, `capabilities: {"db": {}, "user": {}}`, icon `note`, description "Your commitments and dated plans, pulled from email by the hourly routine, as living post-it notes."

The artifact is private to the user. Keep the URL the publish returns.

## 4. Save config

Write `~/.claude/nudged/config.json` (create the folder, mode 600):

```json
{ "license_key": "...", "board_url": "https://claude.ai/artifact/...", "calendar_id": "...", "timezone": "...", "email": "...", "installed_at": "<ISO now>" }
```

## 5. The routine

Load `mcp__scheduled-tasks__create_scheduled_task` with ToolSearch. If a task with id `nudged-hourly` already exists (`list_scheduled_tasks`), skip creation. Otherwise create it:

- taskId `nudged-hourly`, title `📌 Nudged (hourly)`
- cronExpression `0 7-22 * * *` (local time)
- notifyOnCompletion false
- prompt, exactly: `Use the Skill tool to load the skill "nudged:run" and follow it completely. It is the Nudged hourly routine.`

Tell the user: the routine runs while the Claude desktop app is open, and the first run will ask them to approve Gmail, Calendar and board access once; later runs reuse those approvals. Suggest they click "Run now" on it in the Scheduled sidebar section right away to grant those approvals and seed the board from the last two days of mail.

## 6. Finish

Show the board link and a two-line description of what will appear there. Offer `/nudged:board` for a quick summary any time.
