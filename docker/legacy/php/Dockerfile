ARG HOT_DOCKER_MIRROR=
FROM ${HOT_DOCKER_MIRROR}php:5.6-apache

RUN docker-php-ext-install mysql mysqli bcmath sockets

# uopz (PHP 5.x branch) lets the differential tests override rand()/mt_rand() per request so a
# scripted sequence makes random outcomes comparable; see rng-prepend.php. No-op without the
# X-Difftest-Rng header, so ordinary play and the legacy tick are unaffected.
RUN printf "\n" | pecl install uopz-2.0.7 \
  && docker-php-ext-enable uopz

COPY php.ini /usr/local/etc/php/conf.d/legacy.ini
COPY rng-prepend.php /opt/difftest/rng-prepend.php
COPY db.php /opt/legacy/db.php
COPY entrypoint.sh /usr/local/bin/legacy-entrypoint
RUN chmod +x /usr/local/bin/legacy-entrypoint

ENTRYPOINT ["legacy-entrypoint"]
CMD ["apache2-foreground"]
