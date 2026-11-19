# Quotation Manager SaaS

A high-performance, serverless Quotation Management & Measurement System engineered for manufacturing, roofing, fabrication, and industrial enterprises.

Built 100% on the **Cloudflare Ecosystem** (Pages, Workers, D1 Database, R2 Object Storage, and Turnstile Bot Protection).

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JS (ES6+), HTML5, Tailwind CSS, FontAwesome 6 |
| **PDF & Print Engine** | `html2pdf.js` / `jsPDF` with smart print break rules |
| **API Runtime** | Cloudflare Workers (`nodejs_compat`, Web Crypto API) |
| **Relational Database** | Cloudflare D1 (Serverless Edge SQLite) |
| **Media & Object Storage** | Cloudflare R2 (`MEDIA_BUCKET` for compressed images & signatures) |
| **Auth & Security** | Web Crypto HMAC-SHA256 JWT, Salted SHA-256 Passwords, Turnstile Captcha |
| **Deployment & CI/CD** | Cloudflare Workers Builds & GitHub Actions |

---

## 🚀 Quick Setup & Configuration

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- Cloudflare Account with Workers, D1, and R2 enabled
- [Cloudflare Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

```bash
npm install -g wrangler
```

---

### 2. Initialize Cloudflare D1 & R2 Storage

1. **Create the D1 Database:**
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

3. **Create the Cloudflare R2 Media Bucket:**
   ```bash
   npx wrangler r2 bucket create quotation-media
   ```
   Ensure the R2 binding is declared in `wrangler.toml`:
   ```toml
   [[r2_buckets]]
   binding = "MEDIA_BUCKET"
   bucket_name = "quotation-media"
   ```

---

### 3. Configure Production Secrets

Set production secrets securely via Wrangler (never commit secrets to git):

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

### Automated Deployment via GitHub Actions
Pushing to the `main` branch automatically triggers deployment via GitHub Actions or Cloudflare Workers Builds:

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

## 🔒 Security & Architecture Notes

- **Direct R2 Storage:** Images (Item diagrams, Company signatures, and Gallery photos) are stored in Cloudflare R2 and served via `/api/media/:filename`, keeping D1 databases and JSON exports lightweight.
- **Role-Based Access Control (RBAC):** Super Admin and Sub-Admin granular permissions are verified server-side on every mutating API endpoint.
- **Audit Trails:** All quotations, clients, and items automatically capture the author's full name in `created_by` audit columns.
- **Zero Secrets in Git:** Sensitive tokens, keys, and credentials are strictly excluded and injected via Cloudflare runtime bindings.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
