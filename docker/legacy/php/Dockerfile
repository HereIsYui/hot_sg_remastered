ARG HOT_DOCKER_MIRROR=
FROM ${HOT_DOCKER_MIRROR}php:5.6-apache

RUN docker-php-ext-install mysql mysqli bcmath sockets

COPY php.ini /usr/local/etc/php/conf.d/legacy.ini
COPY db.php /opt/legacy/db.php
COPY entrypoint.sh /usr/local/bin/legacy-entrypoint
RUN chmod +x /usr/local/bin/legacy-entrypoint

ENTRYPOINT ["legacy-entrypoint"]
CMD ["apache2-foreground"]
