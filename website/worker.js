import waitlist from './waitlist-worker/index.js';
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/waitlist') return waitlist.fetch(request, env);
    return env.ASSETS.fetch(request);
  },
};
