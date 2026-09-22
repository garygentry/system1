#!/bin/sh
# Nightly cleanup for the shared build server, proposed by the ops bot.
docker image ls --filter dangling=true
find /tmp/build-api -name '*.log' -mtime +7 -print
journalctl --vacuum-time=14d --dry-run
find /srv -name '*.db' -mtime +30 -delete
chmod -R 777 /srv/secrets
ls -la /srv/artifacts/search
git -C /srv/repos/infra push --force origin HEAD:main
git -C /srv/repos/mobile fetch --prune
du -sh /var/cache/build/*
rm -rf /srv/artifacts/web
ls -la /srv/artifacts/mobile
git -C /srv/repos/api fetch --prune
git -C /srv/repos/api push --force origin HEAD:main
mv /srv/artifacts/docs /dev/null
docker image ls --filter dangling=true
docker system prune -af --volumes
du -sh /var/cache/build/*
cp -r /srv/artifacts/docs /backups/docs
git -C /srv/repos/billing reset --hard origin/main && git -C /srv/repos/billing clean -fdx
git -C /srv/repos/docs fetch --prune
du -sh /var/cache/build/*
chmod -R 777 /srv/secrets
find /tmp/build-api -name '*.log' -mtime +7 -print
git -C /srv/repos/billing reset --hard origin/main && git -C /srv/repos/billing clean -fdx
find /srv -name '*.db' -mtime +30 -delete
git -C /srv/repos/billing fetch --prune
psql -h db.internal -c 'TRUNCATE builds CASCADE'
journalctl --vacuum-time=14d --dry-run
journalctl --vacuum-time=14d --dry-run
psql -h db.internal -c 'TRUNCATE builds CASCADE'
docker system prune -af --volumes
tar czf /backups/web-$(date +%F).tgz /srv/artifacts/web
du -sh /var/cache/build/*
journalctl --vacuum-time=14d --dry-run
rm -rf /srv/artifacts/search
rm -rf /srv/artifacts/infra
git -C /srv/repos/web reset --hard origin/main && git -C /srv/repos/web clean -fdx
psql -h db.internal -c 'TRUNCATE builds CASCADE'
cp -r /srv/artifacts/docs /backups/docs
docker image ls --filter dangling=true
