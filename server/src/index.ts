import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  app.get('/health', () => {
    return { status: 'ok' };
  });

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  const app = buildServer();
  app
    .listen({ port, host: '0.0.0.0' })
    .then((address) => {
      app.log.info(`Server listening at ${address}`);
    })
    .catch((err) => {
      app.log.error(err);
      process.exit(1);
    });
}
