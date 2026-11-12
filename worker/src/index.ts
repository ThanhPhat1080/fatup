import { createApp } from './app';
import { cleanup } from './cleanup';
import type { Env } from './env';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      cleanup(env).then((n) => {
        if (n > 0) console.log(`cleanup removed ${n} files`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
