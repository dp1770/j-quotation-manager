========================================================================
             QUOTATION MANAGER - QUICK-START GUIDE
========================================================================

Welcome to Quotation Manager SaaS.
This application runs natively on the 100% Cloudflare Ecosystem
(Cloudflare Workers + Cloudflare D1 Database + Cloudflare Turnstile).

------------------------------------------------------------------------
LOCAL DEVELOPMENT
------------------------------------------------------------------------

1. Start local dev server with Wrangler:
   npm run dev
   (or: npx wrangler dev)

2. Run automated test suite:
   npm test

------------------------------------------------------------------------
CLOUDFLARE DEPLOYMENT
------------------------------------------------------------------------

1. Set your JWT Secret:
   npx wrangler secret put JWT_SECRET

2. (Optional) Set your Turnstile Secret:
   npx wrangler secret put TURNSTILE_SECRET

3. Execute Remote D1 Database Schema:
   npx wrangler d1 execute quotation-manager-db --remote --file=./schema.sql

4. Deploy Worker:
   npx wrangler deploy

For complete documentation, see README.md.
========================================================================
