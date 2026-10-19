#!/bin/sh
# Copies the read-only legacy web root into the container and applies the minimal
# PHP 5.2 -> 5.6 compatibility fixes, so the original files on the host stay untouched.
set -eu

SRC=/src
WEB=/var/www/html

if [ ! -f "$SRC/server/game/Command.php" ]; then
  echo "legacy htdocs not mounted at $SRC; run 'pnpm legacy:extract' first" >&2
  exit 1
fi

if [ ! -f "$WEB/.legacy-ready" ]; then
  rm -rf "$WEB/server"
  cp -a "$SRC/server" "$WEB/server"
  cp "$SRC"/*.php "$SRC"/*.swf "$SRC"/*.html "$SRC"/*.js "$WEB/" 2>/dev/null || true

  cp /opt/legacy/db.php "$WEB/server/config/db.php"
  printf '<?php define("chat_host","127.0.0.1");?>' > "$WEB/server/config/chathost.php"

  # Call-time pass-by-reference is a fatal error since PHP 5.4.
  sed -i 's/doMethodCall(\$body, &\$classConstruct,/doMethodCall($body, $classConstruct,/' \
    "$WEB/server/amfphp/core/json/app/Actions.php"

  # E_ALL gained E_STRICT in PHP 5.4; amfphp turns every reported level into an exception.
  sed -i "s/^\$amfphp\['errorLevel'\] = E_ALL ^ E_NOTICE;/\$amfphp['errorLevel'] = E_ALL \& ~E_NOTICE \& ~E_STRICT \& ~E_DEPRECATED;/" \
    "$WEB/server/amfphp/core/shared/app/Globals.php"

  for dir in game amfphp; do
    mkdir -p "$WEB/server/$dir/sessions" "$WEB/server/$dir/userlock" "$WEB/server/$dir/cron"
  done
  chown -R www-data:www-data "$WEB/server"
  touch "$WEB/.legacy-ready"
fi

exec docker-php-entrypoint "$@"
