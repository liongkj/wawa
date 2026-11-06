const messages = {
  en: {
    subject: 'You are on the Wawa waitlist',
    text: 'Thanks for your interest in managed Wawa. You are on the waitlist. We will email you with updates if the service becomes available.\n\nWawa is currently an open-source self-hosted preview. Managed hosting is not yet available.\n',
  },
  ms: {
    subject: 'Anda dalam senarai menunggu Wawa',
    text: 'Terima kasih kerana berminat dengan Wawa terurus. Anda telah menyertai senarai menunggu. Kami akan menghantar perkembangan melalui e-mel jika perkhidmatan ini tersedia.\n\nWawa kini merupakan pratonton sumber terbuka yang dihos sendiri. Pengehosan terurus belum tersedia.\n',
  },
};

const reply = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/api/waitlist')
      return reply({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    let input;
    try {
      input = await request.json();
    } catch {
      return reply({ error: 'Invalid request' }, 400);
    }
    const email = typeof input?.email === 'string' ? input.email.trim() : '';
    const locale = input?.locale === 'ms' ? 'ms' : 'en';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return reply({ error: 'Invalid email' }, 400);
    let result;
    try {
      result = await env.WAITLIST.prepare(
        'INSERT INTO signups (email, locale) VALUES (?, ?) ON CONFLICT(email) DO NOTHING',
      )
        .bind(email, locale)
        .run();
    } catch {
      return reply({ error: 'Unable to save signup' }, 503);
    }
    if (result.meta.changes === 0) return reply({ status: 'already' });
    try {
      await env.EMAIL.send({
        from: 'no-reply@wawa.liongkj.com',
        to: email,
        subject: messages[locale].subject,
        text: messages[locale].text,
      });
      return reply({ status: 'saved', confirmation: 'accepted' });
    } catch {
      // The signup is already durable even if the email service is unavailable.
      console.error('Waitlist confirmation email was not accepted');
      return reply({ status: 'saved', confirmation: 'not_sent' });
    }
  },
};
