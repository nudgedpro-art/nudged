---
name: board
description: Show what is on the Nudged board right now, add a note to watch for, or mark one done. Use when the user asks what they are waiting on, what needs them, or says "watch for X".
allowed-tools: Read(~/.claude/nudged/config.json), ToolSearch, ArtifactData
---

Read `~/.claude/nudged/config.json` with the Read tool. If the file is missing, say `Run /nudged:setup first.` and stop. Load `ArtifactData` with ToolSearch (`select:ArtifactData`); every call uses `url` = `board_url`.

- **Summary (default):** `list` collection `postits`, limit 500. Group by: needs you (`pending` and `needs_me`, or `expected` in the past), waiting on them (other `pending`), on calendar (`scheduled`). Print each group as a short bulleted list: title, when, who, the `note`. Skip done/dismissed/cancelled unless asked. End with the board link.
- **"Watch for X":** doc_id = a kebab slug of X (append `-2` if it exists). `set` the document with the full shape: `title: X`, `kind: "commitment"`, `status: "pending"`, `manual: true`, `needs_me: false`, `who: ""`, `expected`, `expected_end`, `time`, `time_end`, `location`, `event`, `event_url`, `source_url`, `subject`, `nudged` all `null`, `threads: []`, `msgs: 0`, `clips: []`, `note: "Added by hand. The next hourly run looks for a matching email thread."`, `created_at` and `updated_at` now. Confirm in one line.
- **"Done with X" / "dismiss X":** find the best-matching document by title, `update` it with `status` `done` or `dismissed`, `closed_at` and `updated_at` now, passing the `if_version` you read. Confirm in one line. If two documents match equally, list them and ask which.

Never delete documents. Never touch email or the calendar from this skill.
