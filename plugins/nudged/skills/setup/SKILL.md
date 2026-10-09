---
name: setup
description: Set up Nudged on this account. Checks the licence key, confirms Gmail and Google Calendar are connected, publishes the user's private board, pre-approves the tools the hourly routine needs, and creates the routine. Run once; safe to run again.
allowed-tools: Bash, ToolSearch, Read, Artifact, ArtifactData, mcp__scheduled-tasks__list_scheduled_tasks, mcp__scheduled-tasks__create_scheduled_task, mcp__scheduled-tasks__update_scheduled_task
---

Walk the user through setup in plain language. Before each step say in one line what you are about to do. If a step fails, stop and explain; do not improvise around it. Never send email, never delete anything, never touch calendar events.

## 0. Where am I running

Load `mcp__scheduled-tasks__create_scheduled_task`, `mcp__scheduled-tasks__list_scheduled_tasks` and `mcp__scheduled-tasks__update_scheduled_task` with ToolSearch (`select:` by exact name). If they are not found, stop and say: "Nudged's hourly routine can only be created from the Claude desktop app's Code tab, not from a terminal. Open the desktop app, start a session there, and run /nudged:setup again." Do not continue.

## 1. Licence key

Ask for the licence key from the purchase email (format `ND-XXXX-XXXX-XXXX-XXXX`). If `~/.claude/nudged/founder-key.txt` exists, offer its contents as the default. Check it:

```bash
curl -s -w '\n%{http_code}' "https://sdtbdrrcppjeilwhvwbw.supabase.co/functions/v1/license-check?key=<key>"
```

- HTTP 200 and `"valid": true` → continue.
- HTTP 200 and `"valid": false` → tell the user the `message` and say: "Manage or restart your subscription from the link in your Stripe receipt, or email hello@nudged.pro." Stop.
- Anything else (no response, 5xx) → say the licence service could not be reached, ask them to try again in a few minutes. Stop.

## 2. What Nudged does with your accounts

Say this, then ask "OK to continue?" and wait for a yes:

"Every hour, inside your own Claude, Nudged reads Gmail threads from the last two days (skipping promotions, social and forum mail), looks for promises and dated plans, and tags each message it has read with a hidden Gmail label so it is never read twice. It writes notes to a private board page that only you can open, and creates calendar events for confirmed plans, each marked so it only ever edits its own. It never sends, replies to, forwards, archives or deletes email, never deletes a calendar event, and your mail never leaves your Claude."

## 3. Connectors

Find the Gmail and Google Calendar connector tools with ToolSearch: `+search_threads`, `+list_labels`, `+list_calendars`, `+create_event`. Connector tools are named `mcp__<id>__<tool>`; the `<id>` differs on every machine, so never assume it. If more than one server offers Gmail or Calendar tools, prefer the claude.ai connector (an id that looks like a UUID), call `list_labels` and `list_calendars` on each candidate, keep the one that answers, and if two answer, show both and ask which account to use.

Record:
- `gmail_prefix` and `calendar_prefix`: the `mcp__<id>__` part of the working tools.
- `calendar_id` and `timezone`: from the calendar marked primary in `list_calendars`.
- `email`: the primary calendar's id (it is the account's address). Confirm it with the user in one line.

If either connector is missing, say: "Connect Gmail and Google Calendar in Claude's connector settings, then run /nudged:setup again." Stop.

Seen label: in `list_labels`, look for `Nudged/Seen`; if absent, look for `Post-it/Seen` (older installs); if neither exists, `create_label` with displayName `Nudged/Seen`, colorPreset `LABEL_COLOR_PRESET_YELLOW`, labelListVisibility `LABEL_HIDE`. Record its id as `seen_label_id`.

## 4. The board

If `~/.claude/nudged/config.json` already has a `board_url`, verify it: ArtifactData `list` collection `postits` limit 1 with that url. If it works, keep it. If it fails, tell the user the board is no longer reachable and ask whether to publish a new empty one (old notes cannot be recovered); on yes, continue below; on no, stop.

Otherwise publish the board page shipped with this plugin:

```bash
cp "${CLAUDE_PLUGIN_ROOT}/assets/board.html" /tmp/nudged-board.html
```

Read `/tmp/nudged-board.html`, then publish it with the Artifact tool: `file_path` `/tmp/nudged-board.html`, `capabilities` `{"db": {}, "user": {}}`, `icon` `note`, `description` "Your commitments and dated plans, pulled from email by the hourly routine, as living notes that nudge you." Keep the URL the publish returns as `board_url`.

## 5. Save config

Write `~/.claude/nudged/config.json` (create the folder; chmod 700 on the folder, 600 on the file):

```json
{ "config_version": 1, "license_key": "...", "board_url": "https://claude.ai/artifact/...", "calendar_id": "...", "timezone": "...", "email": "...", "gmail_prefix": "mcp__...__", "calendar_prefix": "mcp__...__", "seen_label_id": "Label_...", "installed_at": "<ISO now>" }
```

## 6. Pre-approve the routine's tools

The routine runs unattended, so every tool it uses must be approved in advance or the run stalls on a prompt nobody answers. Show the user this list and ask "May I add these to your Claude permissions allow list?":

- `ArtifactData`
- `Bash(cat ~/.claude/nudged/config.json)`
- `Bash(curl -s -w * https://sdtbdrrcppjeilwhvwbw.supabase.co/functions/v1/license-check?key=*)`
- `<gmail_prefix>search_threads`, `<gmail_prefix>get_thread`, `<gmail_prefix>label_message`, `<gmail_prefix>update_message_labels`, `<gmail_prefix>list_labels`
- `<calendar_prefix>create_event`, `<calendar_prefix>update_event`, `<calendar_prefix>get_event`

On yes: read `~/.claude/settings.json` (create `{}` if missing), merge the entries into `permissions.allow` without removing anything that is already there, and write it back with the same formatting. On no: continue, but say the first run will ask for each approval and later runs reuse them.

## 7. The routine

`list_scheduled_tasks`. If a task with id `nudged-hourly` exists, keep it. Otherwise create it:

- taskId `nudged-hourly`, title `📌 Nudged (hourly)`
- description `Hourly Nudged routine: reads new email for promises and dated plans, updates the board and Google Calendar.`
- cronExpression `0 7-22 * * *` (local time)
- notifyOnCompletion false
- prompt, exactly: `Use the Skill tool to load the skill "nudged:run" and follow it completely. This task explicitly asks you to perform these writes every run: add the Seen label to Gmail messages you read; create and update Google Calendar events whose description contains "— Nudged," or "— Post-it,"; create and update documents in the board's "postits" collection with ArtifactData. Never send or delete email, never delete a calendar event.`

Then, for every other task in the list, Read its `path`; if that file mentions the configured `board_url` or the Seen label, call `update_scheduled_task` with `enabled: false` on it and tell the user it was paused because Nudged now does that job.

## 8. First run

Tell the user, and do not soften it: "One required step: open Scheduled in the sidebar, click Run now on '📌 Nudged (hourly)', and click Allow on any prompt that appears. That one run records the approvals every later run reuses. The routine runs hourly from 7am to 10pm while the Claude desktop app is open."

Finish with the board link and one line on what will appear there. Mention `/nudged:board` for a quick summary any time.
