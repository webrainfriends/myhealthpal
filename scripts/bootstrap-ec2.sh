#!/usr/bin/env bash
# One-time setup for a fresh (or shared) Ubuntu EC2 instance before the
# "Deploy to EC2" GitHub Actions workflow (.github/workflows/deploy.yml) can
# run against it.
#
# Run this once, over SSH, as the ubuntu user:
#   ssh ubuntu@<host> 'bash -s' < scripts/bootstrap-ec2.sh
#
# It installs Node.js 20, pm2, Docker, nginx, and git. The app itself runs
# directly with Node.js + pm2 (no image build needed for it), fronted by
# nginx on port 5250 (the deploy workflow writes/updates that nginx site
# config itself). Postgres runs in a small dedicated Docker container - the
# deploy workflow creates it on first run - the same approach exambuddy's
# stack on this host already uses, rather than the host's native
# PostgreSQL, whose shared role/pg_hba.conf setup repeatedly caused
# unexplained auth failures.
#
# Idempotent - safe to re-run, and safe to run on a host that already runs
# other apps (e.g. it won't touch an existing Docker install or other
# containers' data).

set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y git
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installing pm2..."
  sudo npm install -g pm2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "${USER:-ubuntu}"
  echo "Added $USER to the docker group - log out and back in (or run 'newgrp docker') for it to take effect."
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Installing the Postgres client (psql) - used only to verify the myhealthpal-postgres container is reachable, not to run a server..."
  sudo apt-get update
  sudo apt-get install -y postgresql-client
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "Installing nginx..."
  sudo apt-get update
  sudo apt-get install -y nginx
  sudo systemctl enable --now nginx
fi

node --version
pm2 --version
docker --version
psql --version
nginx -v
echo "Bootstrap complete. The Deploy to EC2 workflow can now be run (push to the repo, or trigger it manually from the Actions tab) - it creates the myhealthpal-postgres container itself on first run."
