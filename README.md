# Quotation Manager SaaS

A high-performance, serverless Quotation Management & Measurement System engineered for manufacturing, roofing, fabrication, and industrial enterprises.

Built 100% on the **Cloudflare Ecosystem** (Pages, Workers, D1 Database, and Turnstile Bot Protection) — completely free with no payment method or credit card required.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JS (ES6+), HTML5, Tailwind CSS, FontAwesome 6 |
| **PDF & Print Engine** | `html2pdf.js` / `jsPDF` with smart pagebreak rules |
| **API Runtime** | Cloudflare Workers (`nodejs_compat`, Web Crypto API) |
| **Database** | Cloudflare D1 (Serverless Edge SQLite — 100% Free) |
| **Auth & Security** | Web Crypto HMAC-SHA256 JWT, Salted SHA-256 Passwords, Turnstile Captcha |
| **Deployment & CI/CD** | Cloudflare Workers Builds & GitHub Actions |

---

## 🚀 Quick Setup & Configuration

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- Free Cloudflare Account (Workers & D1 enabled)
- [Cloudflare Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

```bash
npm install -g wrangler
```

---

### 2. Initialize Cloudflare D1 Database

1. **Create your free D1 Database:**
   ```bash
   npx wrangler d1 create quotation-manager-db
   ```
   Add the generated `database_id` to your `wrangler.toml`:
   ```toml
   [[d1_databases]]
   binding = "Quotation_Manager"
   database_name = "quotation-manager-db"
   database_id = "<your-d1-database-id>"
   ```

2. **Initialize Database Schema:**
   ```bash
   npx wrangler d1 execute quotation-manager-db --remote --file=./schema.sql
   ```

---

### 3. Configure Production Secrets

Configure your secrets securely via Wrangler (never commit secrets to git):

```bash
# 1. Cryptographic session signing key (minimum 32 characters)
npx wrangler secret put JWT_SECRET

# 2. (Optional) Cloudflare Turnstile Secret Key for login bot protection
npx wrangler secret put TURNSTILE_SECRET
```

For local testing, create a `.dev.vars` file in the root directory:
```env
JWT_SECRET="your-local-jwt-secret-key-32-chars-min"
TURNSTILE_SECRET="1x0000000000000000000000000000000AA"
```

---

### 4. Local Development & Testing

```bash
# Install dependencies
npm install

# Run automated test suite
npm test

# Start local Cloudflare Worker development server
npm run dev
```

---

## 🚢 CI/CD Deployment

### Automated Deployment via GitHub
Pushing to the `main` branch automatically triggers deployment via Cloudflare Workers Builds:

```bash
git add .
git commit -m "feat: updates"
git push origin main
```

### Manual Production Deploy
```bash
npx wrangler deploy
```

---

## 🔒 Security & Architecture Highlights

- **Pure Data Backups:** Exported `.json` database backups skip/omit heavy image payloads. Backups contain strictly pure business data (quotes, calculations, clients, items, bank details, terms, tax rates), making export and restore instantaneous and lightweight.
- **Client-Side Image Compression:** Product images and signatures are automatically compressed in-browser via HTML5 `<canvas>` (800px max width, JPEG 0.75 quality) before saving to Cloudflare D1, consuming minimal storage.
- **Role-Based Access Control (RBAC):** Super Admin and Sub-Admin granular permissions are verified server-side on every mutating API endpoint.
- **Audit Trails:** All quotations, clients, and items automatically record the author's full name in `created_by` audit columns.
- **Zero Secrets in Git:** Sensitive tokens, keys, and credentials are strictly excluded from repository code.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
