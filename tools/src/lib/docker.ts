/**
 * Image references honour HOT_DOCKER_MIRROR, e.g.
 * `HOT_DOCKER_MIRROR=docker.m.daocloud.io/library/` turns `mysql:5.7` into
 * `docker.m.daocloud.io/library/mysql:5.7`.
 */
export function image(name: string): string {
  return `${process.env.HOT_DOCKER_MIRROR ?? ''}${name}`;
}

export const images = {
  mysql57: () => image('mysql:5.7'),
  javaRuntime: () => image('eclipse-temurin:17-jre'),
};
