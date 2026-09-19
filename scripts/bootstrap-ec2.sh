#!/usr/bin/env bash
# One-time setup for a fresh (or shared) Ubuntu EC2 instance before the
# "Deploy to EC2" GitHub Actions workflow (.github/workflows/deploy.yml) can
# run against it.
#
# Run this once, over SSH, as the ubuntu user:
#   ssh ubuntu@<host> 'bash -s' < scripts/bootstrap-ec2.sh
#
# It installs Node.js 20, pm2, PostgreSQL, and git, and creates the
# myhealthpal database/role used by server/.env.example's DATABASE_URL.
# Idempotent - safe to re-run, and safe to run on a host that already runs
# other apps (e.g. it won't touch an existing Postgres install/data).

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

if ! command -v psql >/dev/null 2>&1; then
  echo "Installing PostgreSQL..."
  sudo apt-get update
  sudo apt-get install -y postgresql postgresql-contrib
fi
sudo systemctl enable --now postgresql

DB_NAME="myhealthpal"
DB_USER="myhealthpal"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN;"
  echo "Created Postgres role '${DB_USER}' with no password yet - the deploy workflow sets one (via ALTER ROLE) the first time it runs and writes it into server/.env."
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

node --version
pm2 --version
psql --version
echo "Bootstrap complete. The Deploy to EC2 workflow can now be run (push to the repo, or trigger it manually from the Actions tab)."
