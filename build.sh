#!/bin/bash
set -e

DROPLET="root@137.184.155.181"
REMOTE_DIR="/var/www/admin-website"

echo "==> Building frontend..."
npm run build

echo "==> Deploying frontend to droplet..."
scp -r dist/* "$DROPLET:$REMOTE_DIR/dist/"

echo "==> Pushing backend changes..."
git push

echo "==> Pulling and restarting backend on droplet..."
ssh "$DROPLET" "cd $REMOTE_DIR && git pull && systemctl restart admin-backend"

echo "==> Done."
