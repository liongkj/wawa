# Wawa website

The English and Bahasa Malaysia landing page includes a voiced story and email waitlist. Signups are stored in a private Cloudflare R2 bucket. The email binding is not enabled until the sending domain is onboarded; the page reports when confirmation cannot be sent. Repeated addresses are kept once. Removal requests go to `wawa@liongkj.com`, which uses the existing domain catch-all.

## Local development

```sh
npm ci
npm run build
wrangler dev --local --port 8787
```

Open the local address printed by Wrangler. R2 is a local simulation; no email is sent. To develop the frontend with Vite, keep Wrangler running, then run `npm run dev`. Vite proxies the waitlist endpoint to the local Worker.

## Operations

The `wawa-waitlist` R2 bucket contains one JSON object per address. Keys are the SHA-256 digest of the lowercased email address. Limit bucket access to the operator. To handle a removal request, calculate the digest locally and delete the matching object using the Cloudflare dashboard or Wrangler; verify it no longer exists. Retain signups only while they are needed for managed Wawa updates or until deletion is requested.

Email confirmation is disabled until `wawa.liongkj.com` is onboarded for Cloudflare Email Service and the account can send to arbitrary recipients. Add the `EMAIL` send binding and test delivery to an authorised address before claiming confirmation works. Email acceptance alone is not proof of inbox delivery.

Do not log signup addresses or email bodies. The page currently has temporary system-generated story voices, not final voice acting.
