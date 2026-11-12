-- =====================================================================
-- Cloudflare D1 Database Schema for Quotation Manager SaaS
-- Database Type: SQLite (Serverless Cloudflare D1)
-- =====================================================================

-- 1. Users Table (Super Admin & Sub-Admins with Granular RBAC Permissions)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Sub-Admin',
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  permissions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for instant username lookup during login
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 2. Clients Table
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  gst_number TEXT,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients(created_at);
CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_name);

-- 3. Items Master Table (Industrial Roofing Sheets, Purlins & Accessories)
CREATE TABLE IF NOT EXISTS items_master (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'NOS',
  rate REAL NOT NULL DEFAULT 0.0,
  default_width TEXT,
  image_url TEXT,
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_name ON items_master(name);

-- 4. Quotations Table (Complete 4-Part Structure + Measurements + Financials)
CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  quote_number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL DEFAULT (date('now')),
  valid_until TEXT,
  client_id TEXT,
  client_name TEXT NOT NULL,
  client_company TEXT,
  client_phone TEXT,
  client_email TEXT,
  client_gst TEXT,
  client_address TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  calculations_json TEXT DEFAULT '[]',
  material_total REAL NOT NULL DEFAULT 0.0,
  loading_charges REAL NOT NULL DEFAULT 0.0,
  additional_charges_json TEXT DEFAULT '[]',
  charges_total REAL NOT NULL DEFAULT 0.0,
  gst_type TEXT NOT NULL DEFAULT 'CGST_SGST',
  gst_rate REAL NOT NULL DEFAULT 18.0,
  gst_amount REAL NOT NULL DEFAULT 0.0,
  round_off REAL NOT NULL DEFAULT 0.0,
  grand_total REAL NOT NULL DEFAULT 0.0,
  grand_total_words TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quotations_date ON quotations(date);
CREATE INDEX IF NOT EXISTS idx_quotations_number ON quotations(quote_number);
CREATE INDEX IF NOT EXISTS idx_quotations_client_id ON quotations(client_id);

-- 5. System Settings Table (Company Details, Bank Accounts, Terms & Signature)
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  company_json TEXT NOT NULL DEFAULT '{}',
  bank_json TEXT NOT NULL DEFAULT '{}',
  terms_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- Seed Initial Default Data
-- =====================================================================

-- Default Super Admin Credentials:
-- Username: jalaram
-- Password: jalaram@2026
-- SHA-256 Hash: d9bc47a5fad6ba64112f7d87a4ec566caff796e1032793ee9a18ad0202482126
INSERT OR IGNORE INTO users (
  id, username, password_hash, full_name, role, is_super_admin, permissions_json, created_at, updated_at
) VALUES (
  'user_super_admin_jalaram',
  'jalaram',
  'd9bc47a5fad6ba64112f7d87a4ec566caff796e1032793ee9a18ad0202482126',
  'Jalaram Super Admin',
  'Super Admin',
  1,
  '{"canManageClients":true,"canCreateQuotations":true,"canEditQuotes":true,"canManageItems":true,"canDeleteQuotes":true,"canManageSettings":true,"canManageUsers":true,"canBackupDatabase":true}',
  datetime('now'),
  datetime('now')
);

-- Seed Default Company, Bank & Terms Settings
INSERT OR IGNORE INTO settings (
  id, company_json, bank_json, terms_json, media_json, updated_at
) VALUES (
  'global',
  '{"name":"JALARAM ENTERPRISE","tagline":"Leading Manufacturers & Traders of Industrial Roofing Sheets, Purlins & Accessories","address":"Survey No.39/2, Plot No.3, Dharti Gate, Sadak Pipliya, National Highway, Shapar, Gujarat 360026","phone":"+91 99134 93999","phoneSecondary":"+91 98252 12345","email":"jalaramenterprise@gmail.com","website":"www.jalaramenterprise.com","gstin":"24AAHFJ9913A1ZP","state":"Gujarat","stateCode":"24"}',
  '{"bankName":"CENTRAL BANK OF INDIA","accountName":"JALARAM ENTERPRISE","accountNumber":"5786682221","ifscCode":"CBIN0280569","branch":"BHUPENDRA ROAD, RAJKOT"}',
  '["Customer will be billed after indicating acceptance of this quote.","Payment 50% Advance And 50% before goods Dispatched.","Transport Transaction Extra","The Responsibility Of All the Material Will Be With That Company. There Will Be No Responsibility Of The Distributor I.E. JALARAM ENTERPRISE.","SUBJECT TO GONDAL JURISDICTION."]',
  '{"bannerUrl":"assets/product-gallery-page7.svg","headerLogoUrl":"assets/header-roof-logo.svg","signatureImageUrl":"assets/sample-signature.svg","signatureTitle":"Authorized Signatory","showSignatureInPdf":true,"showBannerInPdf":true}',
  datetime('now')
);
