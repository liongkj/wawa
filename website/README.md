# Wawa website

The English and Bahasa Malaysia landing page includes a voiced story and email waitlist. Signups are saved in Cloudflare D1; Cloudflare Email Service sends a confirmation from `no-reply@wawa.liongkj.com`. A saved signup is not lost if confirmation fails, and the page reports that distinction. Repeated addresses are kept once. Email acceptance is not proof of inbox delivery.

## Local development

```sh
npm ci
npm run build
wrangler d1 migrations apply wawa-waitlist --local
wrangler dev --local --port 8787
```

Open the local address printed by Wrangler. Both D1 and email are local simulations; no email is sent. To develop the frontend with Vite, keep Wrangler running, then run `npm run dev`. Vite proxies the waitlist endpoint to the local Worker.

## Before deployment

1. Create a D1 database and replace the all-zero development ID in `wrangler.jsonc`; apply the migration to that database.
2. Onboard `wawa.liongkj.com` as a Cloudflare Email Service sender and ensure the account can send to arbitrary subscriber addresses. Sending to arbitrary addresses requires a Workers Paid plan.
3. Define and publish a privacy and deletion policy and limit access to waitlist data to authorised operators.
4. Build the site and deploy the Worker on the intended domain. Test confirmation delivery to an address whose owner has authorised the test; an accepted send alone does not prove inbox delivery.

Do not log signup addresses or email bodies. No confirmation is sent for an existing signup. The page currently has temporary system-generated story voices, not final voice acting.
