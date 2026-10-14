# Developer setup on a new Mac

Everything that is code lives in this repository. Everything that is a secret or a login does not, and has to be moved by hand once. This page is the complete list.

## 1. Install Xcode from the App Store first

Open it once, accept the licence, and let it install components. Or in Terminal:

```bash
sudo xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS
```

## 2. Run the setup script

```bash
zsh <(curl -fsSL https://raw.githubusercontent.com/nudgedpro-art/nudged/main/scripts/setup-mac.sh)
```

It installs Homebrew, Node, CocoaPods, the Supabase CLI, the GitHub CLI and watchman, clones the repo to `~/nudged`, installs the app's packages, generates the iOS project, and asks you to sign in to GitHub (choose the **nudgedpro-art** account, never dockhandadmin-tech) and Supabase.

## 3. Claude desktop app

Sign in with the same Claude account. Open `~/nudged` as the working folder. Connect these connectors in Claude's settings: Gmail, Google Calendar, Supabase, Stripe, Netlify. The Claude in Chrome extension is useful for the Google Cloud console and the Stripe dashboard.

Install the plugin for your own use:

```
/plugin marketplace add nudgedpro-art/nudged
/plugin install nudged@nudged
```

## 4. Move the secrets (one time, by hand)

On the old Mac these live in two places, both outside git:

| File | What it holds |
|---|---|
| `~/nudged/.env.local` | Stripe webhook secrets (live + sandbox), Resend key, Google OAuth client id + secret, Anthropic key, cron secret, app URLs |
| `~/.claude/nudged/config.json` and `founder-key.txt` | The Claude plugin's config for your own account (licence key, board URL, connector ids) |

Copy them with AirDrop or a USB stick, never by email or chat. Put them at the same paths on the new Mac, then:

```bash
chmod 600 ~/nudged/.env.local ~/.claude/nudged/*
```

If a file is lost, nothing is unrecoverable: Stripe and Google let you roll new secrets, Resend and Anthropic let you create new keys, and `/nudged:setup` rebuilds the plugin config. Push any new values with:

```bash
cd ~/nudged && supabase secrets set --env-file .env.local --project-ref sdtbdrrcppjeilwhvwbw
```

## 5. Claude's memory of this project

Claude Code keeps per-machine notes in `~/.claude/projects/<folder>/memory/`. The file that matters for Nudged is `postit-follow-through.md` plus its line in `MEMORY.md`. Copy that file across too, into the matching folder on the new Mac, so the next session starts with the full history.

## 6. Day-to-day commands

| Task | Command |
|---|---|
| Deploy an edge function | `cd backend && supabase functions deploy <name> --project-ref sdtbdrrcppjeilwhvwbw --no-verify-jwt` |
| Apply a migration | paste the SQL through the Supabase connector, or `supabase db push` once the project is linked |
| Deploy the site | Netlify connector's deploy-site, or `netlify deploy --prod --dir site` after `netlify login` |
| Run the phone app | `cd app && npx expo run:ios` |
| Typecheck the app | `cd app && npx tsc --noEmit` |
| Validate the plugin | `npx -y @anthropic-ai/claude-code@latest plugin validate --strict ./plugins/nudged` |

## Accounts, for reference

- GitHub: nudgedpro-art (repo nudgedpro-art/nudged)
- Supabase: org "Nudged", project `nudged` (sdtbdrrcppjeilwhvwbw, ca-central-1)
- Stripe: live account acct_1UOVqTLVL1WC6XD2 under Dockhand Inc.; sandbox acct_1UOVqdL7UJxkBEe7
- Google Cloud: project `nudged-511109` under nudged.pro@gmail.com
- Netlify: site `nudged-pro`; domain nudged.pro at GoDaddy
- Resend: domain nudged.pro
