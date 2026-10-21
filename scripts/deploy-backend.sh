#!/usr/bin/env bash
# Deploy the Nudged backend to the Supabase project from a Mac with the Supabase CLI logged in.
#   scripts/deploy-backend.sh            migrations + all functions
#   scripts/deploy-backend.sh functions  functions only
#   scripts/deploy-backend.sh migrate    migrations only
# Secrets are NOT set here; see README "1.1.0 rollout" and "WhatsApp rollout" for the list.
set -euo pipefail
cd "$(dirname "$0")/../backend"
REF=sdtbdrrcppjeilwhvwbw
MODE="${1:-all}"

command -v supabase >/dev/null || { echo "supabase CLI not found: brew install supabase/tap/supabase && supabase login"; exit 1; }
supabase link --project-ref "$REF" >/dev/null 2>&1 || true

if [[ "$MODE" == "all" || "$MODE" == "migrate" ]]; then
  # Earlier migrations were applied by hand, so the remote has no migration history;
  # run the new files directly instead of `db push`.
  for f in supabase/migrations/0003_free_plan.sql supabase/migrations/0004_channels.sql; do
    echo "== $f"
    if supabase db query --help >/dev/null 2>&1; then
      supabase db query --linked --file "$f"
    else
      echo "This CLI has no 'db query'. Paste $f into the SQL editor at https://supabase.com/dashboard/project/$REF/sql"; exit 1
    fi
  done
fi

if [[ "$MODE" == "all" || "$MODE" == "functions" ]]; then
  # Functions that authenticate themselves (signature, licence key, cron secret, browser redirect).
  for fn in license-check free-signup stripe-webhook nudged-sync whatsapp-webhook google-auth account-delete; do
    echo "== deploy $fn (no JWT)"
    supabase functions deploy "$fn" --project-ref "$REF" --no-verify-jwt
  done
  # Functions that require a signed-in app user.
  for fn in ingest channel-link; do
    echo "== deploy $fn (JWT)"
    supabase functions deploy "$fn" --project-ref "$REF"
  done
fi
echo "done. Remember the secrets: SITE_ORIGIN (free-signup CORS) and the WHATSAPP_* set when the number exists."
