import waitlist from './waitlist-worker/index.js';
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/region') {
      return Response.json({ malaysia: request.cf?.country === 'MY' }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (path === '/api/waitlist') return waitlist.fetch(request, env);
    return env.ASSETS.fetch(request);
  },
};
