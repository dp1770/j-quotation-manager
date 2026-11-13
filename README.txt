========================================================================
             QUOTATION MANAGER - QUICK-START GUIDE
========================================================================

Welcome to Quotation Manager SaaS.
This application runs natively on the 100% Cloudflare Ecosystem
(Cloudflare Workers + Cloudflare D1 Database + Cloudflare Turnstile).

------------------------------------------------------------------------
LOCAL SERVER LAUNCH (WINDOWS / LINUX / MAC)
------------------------------------------------------------------------

1. WINDOWS:
   Double-click "start.bat" to start the portable local server.
   Your default browser will open to:
   http://localhost:8000

2. LINUX / MAC:
   Run:
   python3 server.py

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
