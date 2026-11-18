# sakana+ server deployment

This repository is being migrated from a browser-only prototype to a shared Cloudflare Workers application. The production backend stores accounts, sessions, posts, follows and notifications in D1; secrets must be configured outside Git.

## Local development

1. Install Node.js 20+ and run `npm install`.
2. Create a Cloudflare D1 database and put its database ID into `wrangler.toml`.
3. Apply the schema: `npx wrangler d1 execute sakana --local --file=./schema.sql`.
4. Run `npx wrangler dev`.

## Production deployment

Create a D1 database, set its ID in `wrangler.toml`, then apply `schema.sql` remotely. Configure `INITIAL_ADMIN_USERNAME` and `INITIAL_ADMIN_PASSWORD` with `wrangler secret put`; never commit credentials. Deploy using `npx wrangler deploy` after verifying account, database, and domain settings.

The current shared-site starter includes account registration/login, session cookies, shared posts, follows, CSRF/origin checks, and basic validation/rate limits. It is not yet a full replacement for the prototype: comments, direct messages, content uploads, backup/restore, and moderation workflows remain to be completed before broad public launch. The app is currently marked `noindex`; remove that only after security and functionality checks.
