<?php
// Replaces server/config/db.php inside the legacy container (Linux paths, compose service names).

ini_set('include_path', ini_get('include_path') . PATH_SEPARATOR . '../lib');

define('db_persistent', 0);
define('db_RDBMS', 'mysql');
define('db_Username', getenv('LEGACY_DB_USER') ?: 'legacy');
define('db_Password', getenv('LEGACY_DB_PASSWORD') ?: 'legacy');
define('db_Server', getenv('LEGACY_DB_HOST') ?: 'db');
define('db_Port', '3306');
define('db_Database', 'bloodwar');

$GLOBALS['dbcharset'] = 'utf8';

define('chat_host', '127.0.0.1');
define('chat_port', '5308');
define('SERVER_ID', 1);
define('ENCRYPT_PROTOCOL', false);

define('THE_SERVER_ID', 'legacy');
define('SERVER_NAME', 'legacy');
$BATTLE_NET_URL = '';
$BATTLE_NET_URL_9001 = '';
define('BATTLE_NET_ENABLE', false);

define('CHIBI_NET_URL', '');
define('chibi_chat_host', '127.0.0.1');
define('chibi_chat_port', '7308');
define('CHIBI_NET_ENABLE', false);
