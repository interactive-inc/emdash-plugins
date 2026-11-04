import handler, { createScheduledHandler } from '@emdash-cms/cloudflare/worker';

/** Use EmDash's supported Worker entry point and scheduled maintenance handler. */
export default {
  ...handler,
  scheduled: createScheduledHandler(),
};
