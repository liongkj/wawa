# Pair a computer with a short code

This document describes how the desktop app should connect to a server workspace by entering a short code instead of an HTTPS address and a password. It builds on the published server image and self-updating installer (PR #31) and on the existing Chrome companion pairing. Nothing here is implemented yet.

## Problem

Today a person who installs the server must choose and remember a workspace password, copy a long Tailscale HTTPS address, and type both into the Mac app. Every other computer repeats that. Sign-in is a 30-day cookie bound to the password, so changing the password signs out every computer, and there is no way to disconnect one computer without changing it for all.

The companion already has a better model: the workspace shows a one-time code, the browser enters it, and gets its own long-lived, revocable device token. The desktop should use the same model.

## Usage

1. The installer asks one question, how other computers reach this server (Tailscale, a public domain, a public IP address, or Cloudflare Tunnel), then installs what it needs and finishes with the server name and an eight-digit code valid for ten minutes. It no longer asks for a password or a WhatsApp engine; Standard is the default and the engine can be changed in Settings.
2. In the Mac app, choose **Use another computer**. On a tailnet the app lists the Wawa servers it finds, so only the code is typed. Otherwise type the domain, IP address, or tunnel hostname, and the code. The app exchanges the code for a device token and opens the workspace. No password is typed.
3. A second Mac pairs the same way. Anyone already connected creates a new code from **Settings → Workspaces → Pair another computer**. On the server, `update.sh pair` prints one.
4. **Settings → Workspaces → Paired computers** lists each computer with its last use and a **Disconnect** button. A disconnected computer returns to the picker on its next request.

The password still exists for browsers and for existing installations. The installer generates it instead of asking, stores it in the server folder, and shows it only on request.

## Shape

### Why there is no relay

bb pairs with a code alone because every daemon dials out to a hosted relay that maps codes to machines. Wawa has no hosted component and should not need one: both computers are already on the same tailnet, which gives private HTTPS, stable names, and MagicDNS. The design therefore keeps a server name in the flow and removes everything else. The name is short because MagicDNS resolves `wa-service` to `wa-service.tailb4401b.ts.net` on any device in the tailnet.

### Finding the server

The picker accepts a bare MagicDNS name, a full host name, or a complete `https://` URL. For a name without a port, the app probes `https://NAME:PORT/api/pair/info` for ports 8443 to 8462 in parallel with a two-second timeout. The installer always takes the first free port from 8443 upward, so the first probe succeeds in practice; the range exists for servers sharing a node with other services. The info endpoint is unauthenticated and returns only `{ "pairing": true, "name": "Wawa" }`, enough to tell a Wawa server from another HTTPS service and nothing else.

When the Tailscale app is installed on the Mac, the picker probes every online peer from `tailscale status --json` at the same ports. Most tailnets hold one Wawa server, so the picker shows it by name and asks for the code alone. Typing a name remains possible for public routes and tailnets without the Tailscale app on the Mac.

### Access routes

Tailscale is recommended, not required. The installer asks one question first: how should other computers reach this server. The recommendation depends on where the server is and what the owner already has.

| Route                   | Best for                                       | Needs                                                    | Name in the picker            |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------------- | ----------------------------- |
| Tailscale (recommended) | A computer at home                             | Tailscale on the server and on each Mac                  | MagicDNS name, found by probe |
| Public domain           | A rented server with a domain                  | An A record to the server, ports 80 and 443 open         | The domain                    |
| Public IP address       | A rented server without a domain               | A static public IPv4 address, ports 80 and 443 open      | The IP address                |
| Cloudflare Tunnel       | A computer at home with a domain on Cloudflare | A Cloudflare account, a domain on it, and a tunnel token | The tunnel hostname           |

A computer at home sits behind a router, so the public routes need a port forward and an address that follows a changing home IP; Tailscale or Cloudflare Tunnel is simpler there. A rented server has a public address already, so a public route is simpler than installing Tailscale on every Mac.

On every route other than Tailscale the Mac needs nothing installed, pairing is unchanged, and the code is the only path because the identity-header shortcut below is unavailable. The lockouts matter more there because the endpoint is reachable from anywhere. Behind Caddy or Cloudflare the server must count failures by the forwarded client address, `X-Forwarded-For` from Caddy or `CF-Connecting-IP` from Cloudflare, and trust that header only from its own proxy container; otherwise every attempt appears to come from the proxy and one stranger locks everyone out.

**Public domain.** A Caddy container obtains a Let’s Encrypt certificate and proxies to Wawa. Before starting it, the installer checks that the domain resolves to this machine and that ports 80 and 443 answer from outside, and prints the exact fix when either fails.

**Public IP address.** The same Caddy container, with no domain. Let’s Encrypt issues certificates for IP addresses only under its `shortlived` profile, valid for about six days, and Caddy selects it with `issuer acme { profile shortlived }`. Caddy renews well before expiry, so the short life costs nothing while the server runs, but a server that is off for a week starts with an expired certificate and renews on boot. Caddy marks ACME profiles experimental, so this route needs its own manual pass on a fresh VPS before the installer offers it. An address that changes breaks every paired computer, so the installer refuses addresses it can tell are dynamic or private and recommends a domain instead. Self-signed certificates with a pinned fingerprint were considered and rejected: the desktop app could pin, but browsers and the companion would show certificate warnings.

**Cloudflare Tunnel.** `cloudflared` dials out to Cloudflare, so a home computer needs no port forward and no public address. A named tunnel needs a domain whose DNS is on Cloudflare; the owner creates the tunnel and its public hostname in the Cloudflare dashboard, points the hostname at `http://wawa:PORT`, and pastes the tunnel token into the installer. The installer runs a `cloudflared` container with that token and confirms the hostname reaches the pairing info endpoint. The token is a credential, so it is read from a prompt or stdin and written only to the server folder’s `.env`, never accepted as a command argument. Quick Tunnels, the account-free `trycloudflare.com` addresses, were rejected: the hostname changes every time `cloudflared` restarts, which would break every paired computer after each update, they carry no uptime guarantee, and they do not deliver Server-Sent Events, which the MCP endpoint’s streamable HTTP transport can answer with.

### Code only, and no code

Tailscale Serve adds the caller’s tailnet identity to each proxied request as headers. The installer records the Tailscale login that installed the server. A request on the private route from that same login may connect without a code: the server binds a device token to the identity and the picker shows a single Connect button. This needs one check before it ships: that the serve proxy replaces, rather than passes through, identity headers supplied by the client. If that holds, codes become the fallback for shared tailnets, browsers and public routes. If it does not, the code path alone stays.

### Codes and devices

Pairing codes and paired devices become one mechanism for browsers and computers. The `companion_codes` and `companion_devices` tables gain a `kind` column with the values `browser` and `desktop`; existing rows are `browser`. A code is created for one kind and cannot pair the other.

Desktop codes are eight decimal digits so they can be read aloud and typed on a phone keyboard. Only one desktop code is live at a time; creating a new one replaces it. A code expires after ten minutes or on first use.

Guessing is bounded, not prevented, by the code length: ten million possibilities against a ten-minute window. The server counts failed pairing attempts per client address and refuses further attempts for fifteen minutes after five failures. After twenty failures from any address within the window, the live code is deleted and a notice appears in the workspace. Pairing is refused over plain HTTP unless the host is loopback.

A successful exchange creates a device row with a random name supplied by the app, such as `KJ's MacBook Air`, and returns a token of the existing `c2t_` form valid for one year. The server extends a token that is used with fewer than thirty days remaining and sends the replacement in a response header, so a computer in regular use never re-pairs.

### Signing the window in

The remote window is a plain web view of the server's own UI, and the session is an HttpOnly cookie. That stays. What changes is how the cookie is obtained.

The Tauri shell keeps the device token in the app data directory next to `workspace-target.json`, with owner-only permissions. It never places the token in a URL. The remote window loads `/desktop-sign-in` as it does now, and the shell gives that window an initialisation script that exposes the token on `window.wawaDevice` only while the page origin matches the paired server. The sign-in page, served by the server, posts the token to `POST /desktop-sign-in/device` and receives the session cookie. The cookie is bound to the device row instead of the password, so validation is one indexed lookup and revocation is immediate.

When the device is revoked or expired the server answers `401` with a page that says the computer was disconnected. The shell watches navigation; on `/desktop-sign-in?disconnected=1` it clears the stored token and opens the workspace picker. The password form remains on the same page for browsers.

The macOS Keychain was considered for the token. It would need a new plugin and a prompt on first use, for a token that already lives inside the app's private directory and is revocable from the workspace. A file is enough for now; the storage lives behind one function so a Keychain backend can be added later.

### Creating codes without a browser

`update.sh pair` runs `docker compose exec wawa node dist/server/pair-cli.js` and prints the code and the server name. The installer calls the same command at the end of a first install. Creating a code from the server shell needs no authentication because shell access already implies ownership of the data volume.

### Settings

The **Workspaces** page gains a **Paired computers** group using the same rows as **Paired browsers**: name, last used, and a Disconnect button. A **Pair another computer** action shows the code with a countdown and a copy button. The code is also readable on the server, so the UI never needs to be the only route.

## Design decision

Keep the server name in the flow and remove the password and the long address, rather than building or renting a relay. A relay would make Wawa depend on a hosted service for sign-in, which contradicts the project's bring-your-own-server stance and adds an operations burden. MagicDNS gives most of the benefit for free, and the port probe hides the rest.

Reuse the companion's code and device tables rather than adding a second mechanism. One revocation list, one expiry policy, one set of tests.

Do not move the remote window to an injected bearer header. The window is the server's web app and the cookie model already handles origin checks, CSRF, and the companion. Posting the token from the sign-in page keeps that model intact and keeps the token out of URLs and logs.

## Verification

- Unit tests on the pairing service: eight-digit codes, single use, expiry, kind mismatch refused, per-address lockout, global lockout deletes the live code, token extension near expiry, revocation ends the session.
- Server tests for `/api/pair/info`, `/api/pair`, and `/desktop-sign-in/device`, including refusal over plain HTTP on a non-loopback host and the disconnected page.
- Lockout tests behind a proxy: failures are counted per forwarded client address, and a forwarded-address header from anything other than the configured proxy is ignored.
- Playwright coverage for the Paired computers rows and the code dialog.
- The Tauri runtime test gains a picker case: short name resolution, probe over a stubbed port range, token storage, automatic sign-in, and return to the picker after revocation.
- A manual pass on a fresh Linux VM with the installer, then pairing from a Mac on the same tailnet.

## Release work

1. Server: `kind` column and migration, desktop codes, lockouts, `/api/pair/*`, device-bound session cookie, `pair-cli`, Settings UI. Ships alone; nothing changes for existing clients.
2. Desktop: picker with peer discovery, name, code, and probe; identity-based connect if the header check passes; token storage; initialisation script; disconnected handling. Needs a desktop build, published through the existing preview workflow.
3. Installer: the route question with the Caddy domain path and the Cloudflare Tunnel path, random password instead of a prompt, Standard engine by default, final pairing code, `update.sh pair`. Docs in README, `docs/desktop.md`, and `docs/docker-stack.md`.
4. Installer: the public IP route, after a manual pass on a fresh VPS confirms Caddy obtains and renews a `shortlived` IP certificate.

Open questions for the owner: whether the generated password should be printed at install time or only on request, and whether one year is the right token lifetime for a personal server.
