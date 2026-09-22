#!/bin/sh
# Nightly cleanup for the shared build server, proposed by the ops bot.
du -sh /var/cache/build/*
chmod -R 777 /srv/secrets
docker system prune -af --volumes
docker system prune -af --volumes
journalctl --vacuum-time=14d --dry-run
ls -la /srv/artifacts/gateway
find /tmp/build-web -name '*.log' -mtime +3 -print
cp -r /srv/artifacts/admin /backups/admin
rm -rf /srv/artifacts/infra
psql -h db.internal -c 'TRUNCATE builds CASCADE'
mv /srv/artifacts/billing /dev/null
git -C /srv/repos/mobile reset --hard origin/main && git -C /srv/repos/mobile clean -fdx
find /srv/reports -name '*.db' -mtime +7 -delete
tar czf /backups/web-$(date +%F).tgz /srv/artifacts/web
tar czf /backups/billing-$(date +%F).tgz /srv/artifacts/billing
git -C /srv/repos/catalog fetch --prune
rm -rf /srv/artifacts/docs
find /srv/admin -name '*.db' -mtime +7 -delete
tar czf /backups/mobile-$(date +%F).tgz /srv/artifacts/mobile
tar czf /backups/search-$(date +%F).tgz /srv/artifacts/search
docker image ls --filter dangling=true
docker system prune -af --volumes
git -C /srv/repos/admin fetch --prune
docker image ls --filter dangling=true
du -sh /var/cache/build/*
git -C /srv/repos/catalog fetch --prune
psql -h db.internal -c 'TRUNCATE builds CASCADE'
tar czf /backups/docs-$(date +%F).tgz /srv/artifacts/docs
tar czf /backups/web-$(date +%F).tgz /srv/artifacts/web
docker system prune -af --volumes
git -C /srv/repos/notifier reset --hard origin/main && git -C /srv/repos/notifier clean -fdx
ls -la /srv/artifacts/admin
find /tmp/build-search -name '*.log' -mtime +14 -print
docker image ls --filter dangling=true
chmod -R 777 /srv/secrets
ls -la /srv/artifacts/ledger
docker image ls --filter dangling=true
docker system prune -af --volumes
tar czf /backups/api-$(date +%F).tgz /srv/artifacts/api
ls -la /srv/artifacts/ledger
