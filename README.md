# Quotation Manager SaaS

A modern, serverless, 100% Cloudflare-native Quotation Management & Measurement System engineered for manufacturing, industrial roofing, fabrication, and commercial enterprises.

Built with **Cloudflare Pages / Workers Static Assets**, **Cloudflare Workers REST API**, **Cloudflare D1 (Serverless SQLite)**, and **Web Crypto JWT Authentication**.

---

## 🌟 Key Features

- **100% White-Label Architecture**: Fully dynamic company identity, address, phone numbers, GSTIN, bank details, terms & conditions, and promotional banners configurable via the Super Admin Settings UI.
- **Cloudflare D1 Serverless Database**: High-speed, edge-replicated SQLite relational database with indexed queries for quotations, clients, items master, and settings.
- **Strict JWT & Cloudflare Turnstile Security**:
  - Web Crypto HMAC-SHA256 JWT tokens.
  - Optional Cloudflare Turnstile Captcha verification on login to protect against automated bots and brute-force attacks.
  - Zero plaintext secrets in repository or client bundles.
- **Industrial Multi-Part Quotations**:
  - Main Line Items Pricing Table (Item Master integration with auto-fill).
  - Multi-Block Sheet Dimensions & Area Calculations (Feet/Inches $\rightarrow$ Sq. Meters / Sq. Feet).
  - Strict Financial Summary: Subtotal $\rightarrow$ Loading Charge $\rightarrow$ GST (18% / IGST / Custom) $\rightarrow$ Grand Total (with Words converter).
- **High-Fidelity PDF Generation**:
  - Clean table borders (1px solid black) and smart page-break controls (`break-inside: avoid`).
  - Integrated bank details, multi-point terms, and digital authorized signature footer.
  - Optional catalog / promotional banner attachment.
- **Advanced Filtering & Pagination**: Native SQL-backed date range, monthly, yearly, status, and client search filters.
- **Zero-Regression UI**: Direct DOM updates on measurement and financial inputs to eliminate cursor focus loss.
- **Offline & PWA Ready**: Installable Progressive Web App with background sync and IndexedDB offline persistence.

---

## 🛠️ Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JS (ES6+), HTML5, Tailwind CSS, FontAwesome 6 |
| **PDF Engine** | `html2pdf.js` / `jsPDF` |
| **API Runtime** | Cloudflare Workers (`nodejs_compat`, Web Crypto API) |
| **Database** | Cloudflare D1 (Edge SQLite) |
| **Bot Protection** | Cloudflare Turnstile (Server-side siteverify) |
| **Deployment** | GitHub Actions / Cloudflare Workers Builds CI |

---

## 🚀 Getting Started & Deployment

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- Cloudflare Account with Workers & D1 enabled
- [Cloudflare Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

```bash
npm install -g wrangler
```

---

### 2. Initialize Cloudflare D1 Database

1. Create your remote D1 database:
   ```bash
   npx wrangler d1 create quotation-manager-db
   ```
2. Note the generated `database_id` and update it in your [wrangler.toml](wrangler.toml):
   ```toml
   [[d1_databases]]
   binding = "Quotation_Manager"
   database_name = "quotation-manager-db"
   database_id = "your-actual-database-id-here"
   ```
3. Initialize the database schema and tables:
   ```bash
   npx wrangler d1 execute quotation-manager-db --remote --file=./schema.sql
   ```

> [!IMPORTANT]
> **Default Administrator Credentials**:
> For security, default credentials are not published in this public repository. Default administrative credentials must be securely configured by the administrator during D1 database initialization by executing `schema.sql` or updating the `users` table with your chosen username and SHA-256 password hash.

---

### 3. Configure Production Secrets

Never store sensitive credentials or keys in version control. Configure your secrets securely in Cloudflare:

```bash
# 1. JWT Secret for cryptographic session signing (min 32 characters)
npx wrangler secret put JWT_SECRET

# 2. (Optional) Cloudflare Turnstile Secret Key for bot protection
npx wrangler secret put TURNSTILE_SECRET
```

---

### 4. Deploy via GitHub / Cloudflare Workers Builds

1. Push your repository to GitHub:
   ```bash
   git push origin main
   ```
2. In the **Cloudflare Dashboard** $\rightarrow$ **Workers & Pages** $\rightarrow$ select your Worker:
   - Connect to your GitHub repository `your-org/your-repo`.
   - Build command: *(leave blank or `npm run test`)*
   - Deploy command: `npx wrangler deploy`
3. Cloudflare will automatically build and deploy your application.

---

### 5. Local Development

1. Create a local environment file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
2. Run the local development server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:8787` in your browser.

---

## 🔒 Security Best Practices

- **Zero Secrets in Git**: `.dev.vars` and local credentials are strictly excluded via `.gitignore`.
- **RBAC**: Sub-Admin permissions are enforced server-side in the Worker API on all mutating queries.
- **Creator Injection**: All database records automatically record the authenticated user ID and name in `created_by` columns.
- **Input Sanitization**: Database operations use SQLite prepared statements with parameter binding to prevent SQL injection.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
