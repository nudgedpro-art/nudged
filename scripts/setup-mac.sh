#!/bin/zsh
# One-shot developer setup for Nudged on a fresh Mac (tested target: Mac Studio, macOS 26+).
# Run from anywhere:  zsh <(curl -fsSL https://raw.githubusercontent.com/nudgedpro-art/nudged/main/scripts/setup-mac.sh)
# or after cloning:   zsh scripts/setup-mac.sh
# Idempotent: safe to run again. Secrets are NOT in the repo; see docs/dev-setup.md step 4.
set -euo pipefail

say() { print -P "%F{green}▶%f $*"; }
need_sudo_msg() { print -P "%F{yellow}!%f $*"; }

# 1. Xcode (App Store) must already be installed; finish its first launch (needs your password).
if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
  need_sudo_msg "Xcode first-launch not done. Running: sudo xcodebuild -runFirstLaunch"
  sudo xcodebuild -runFirstLaunch
fi
if ! xcrun simctl list runtimes 2>/dev/null | grep -q "iOS"; then
  say "Downloading the iOS simulator platform (several GB, one time)"
  xcodebuild -downloadPlatform iOS
fi

# 2. Homebrew + tools
if ! command -v brew >/dev/null; then
  say "Installing Homebrew"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi
say "Installing node, cocoapods, supabase, gh, watchman"
brew install node cocoapods supabase/tap/supabase gh watchman 2>&1 | grep -vE "already installed|^==>" || true

# CocoaPods on Ruby 4 crashes without a UTF-8 locale.
grep -q 'LANG=en_US.UTF-8' ~/.zshrc 2>/dev/null || print 'export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8' >> ~/.zshrc
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# 3. Repo
if [[ ! -d ~/nudged/.git ]]; then
  say "Cloning nudgedpro-art/nudged into ~/nudged"
  git clone https://github.com/nudgedpro-art/nudged.git ~/nudged
fi
cd ~/nudged && git pull --ff-only

# 4. App dependencies + native iOS project
say "Installing app dependencies"
cd ~/nudged/app && npm install --no-audit --no-fund
say "Generating the iOS project and installing pods"
npx expo prebuild --platform ios --no-install
(cd ios && pod install)

# 5. Logins (interactive; each opens a browser once)
cd ~/nudged
gh auth status >/dev/null 2>&1 || { say "GitHub login: choose the nudgedpro-art account"; gh auth login; }
supabase projects list >/dev/null 2>&1 || { say "Supabase login"; supabase login; }

# 6. Secrets check
if [[ ! -f ~/nudged/.env.local ]]; then
  need_sudo_msg "~/nudged/.env.local is missing. Copy it from the old Mac (docs/dev-setup.md step 4). Nothing in it is in git."
fi
if [[ ! -f ~/.claude/nudged/config.json ]]; then
  need_sudo_msg "~/.claude/nudged/config.json is missing (the Claude plugin's config). Copy it from the old Mac or run /nudged:setup again."
fi

say "Done. Next: open the Claude desktop app in ~/nudged, then 'npx expo run:ios' from ~/nudged/app to launch the app in the simulator."
