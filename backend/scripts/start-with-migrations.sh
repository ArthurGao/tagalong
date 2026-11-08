#!/bin/sh
# Start command for a Render instance without a pre-deploy step (free instances; RUNBOOK §3):
# apply pending migrations, then replace this shell with the API so it receives SIGTERM directly.
# A failed migration exits non-zero before the API starts; Render switches traffic only to an instance that passes
# its health check, so the previous version keeps serving (RUNBOOK §3).
set -e
node_modules/.bin/prisma migrate deploy
exec node dist/main.js
