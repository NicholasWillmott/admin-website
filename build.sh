#!/bin/bash
set -e

DROPLET="root@137.184.155.181"
REMOTE_DIR="/var/www/admin-website"

echo "==> Building frontend..."
npm run build

echo "==> Deploying frontend to droplet..."
rsync -az --delete dist/ "$DROPLET:$REMOTE_DIR/dist/"

echo "==> Staging and committing changes..."
git add -A
git diff --cached --quiet || git commit -m "deploy"

echo "==> Pushing backend changes..."
git push

echo "==> Syncing .env to droplet..."
rsync -az src/backend/.env "$DROPLET:$REMOTE_DIR/src/backend/.env"

echo "==> Pulling and restarting backend on droplet..."
ssh "$DROPLET" "cd $REMOTE_DIR && git pull && systemctl restart admin-backend"

echo "==> Done."
