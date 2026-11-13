-- =====================================================================
-- Cloudflare D1 Database Schema for Quotation Manager SaaS
-- Database Type: SQLite (Serverless Cloudflare D1)
-- 100% White-Label & Production Secure Schema
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

-- 3. Items Master Table (Products, Units & Rates)
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

-- 4. Quotations Table (4-Part Structure, Calculations & Financial Totals)
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

-- 5. Company Settings Table (100% White-Label Business Identity & Bank Details)
CREATE TABLE IF NOT EXISTS company_settings (
  id TEXT PRIMARY KEY DEFAULT 'primary',
  company_name TEXT NOT NULL DEFAULT 'Quotation Manager',
  tagline TEXT DEFAULT 'Professional Quotation Management',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  phone_secondary TEXT DEFAULT '',
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  state TEXT DEFAULT '',
  state_code TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  account_name TEXT DEFAULT '',
  account_number TEXT DEFAULT '',
  ifsc_code TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  terms_json TEXT DEFAULT '["Customer will be billed after acceptance of this quote.","Payment terms as mutually agreed.","Transport & freight charges extra as applicable.","Subject to local jurisdiction."]',
  banner_url TEXT DEFAULT '',
  header_logo_url TEXT DEFAULT '',
  signature_image_url TEXT DEFAULT '',
  signature_title TEXT DEFAULT 'Authorized Signatory',
  show_signature_in_pdf INTEGER DEFAULT 1,
  show_banner_in_pdf INTEGER DEFAULT 1,
  turnstile_site_key TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Backward Compatibility Settings Table
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  company_json TEXT NOT NULL DEFAULT '{}',
  bank_json TEXT NOT NULL DEFAULT '{}',
  terms_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- Seed Initial Safe Default Data (White-Label)
-- =====================================================================

-- Default Super Admin seed:
-- Username: admin
-- Password must be securely configured during deployment.
-- Initial SHA-256 for default 'admin@2026':
-- a679cb086580f4949ad453e00bb982d1598f804791522f7c088ef577ef3724ff
INSERT OR IGNORE INTO users (
  id, username, password_hash, full_name, role, is_super_admin, permissions_json, created_at, updated_at
) VALUES (
  'user_super_admin_primary',
  'admin',
  'a679cb086580f4949ad453e00bb982d1598f804791522f7c088ef577ef3724ff',
  'System Administrator',
  'Super Admin',
  1,
  '{"canManageClients":true,"canCreateQuotations":true,"canEditQuotes":true,"canManageItems":true,"canDeleteQuotes":true,"canManageSettings":true,"canManageUsers":true,"canBackupDatabase":true}',
  datetime('now'),
  datetime('now')
);

-- Seed Initial White-Label Settings
INSERT OR IGNORE INTO company_settings (
  id, company_name, tagline, address, phone, phone_secondary, email, website, gstin, state, state_code,
  bank_name, account_name, account_number, ifsc_code, branch, terms_json, updated_at
) VALUES (
  'primary',
  'Quotation Manager',
  'Professional Industrial & Commercial Quotation Management',
  'Business Address Here',
  '+91 00000 00000',
  '',
  'info@company.com',
  'www.company.com',
  '24AAAAA0000A1Z5',
  'Gujarat',
  '24',
  'Primary Bank Name',
  'Enterprise Account',
  '000000000000',
  'BANK0000000',
  'Main Branch',
  '["Customer will be billed after acceptance of this quote.","Payment terms as mutually agreed.","Transport & freight charges extra as applicable.","Subject to local jurisdiction."]',
  datetime('now')
);

INSERT OR IGNORE INTO settings (
  id, company_json, bank_json, terms_json, media_json, updated_at
) VALUES (
  'global',
  '{"name":"Quotation Manager","tagline":"Professional Industrial & Commercial Quotation Management","address":"Business Address Here","phone":"+91 00000 00000","phoneSecondary":"","email":"info@company.com","website":"www.company.com","gstin":"24AAAAA0000A1Z5","state":"Gujarat","stateCode":"24"}',
  '{"bankName":"Primary Bank Name","accountName":"Enterprise Account","accountNumber":"000000000000","ifscCode":"BANK0000000","branch":"Main Branch"}',
  '["Customer will be billed after acceptance of this quote.","Payment terms as mutually agreed.","Transport & freight charges extra as applicable.","Subject to local jurisdiction."]',
  '{"bannerUrl":"assets/sample-banner.svg","headerLogoUrl":"assets/header-roof-logo.svg","signatureImageUrl":"assets/sample-signature.svg","signatureTitle":"Authorized Signatory","showSignatureInPdf":true,"showBannerInPdf":true}',
  datetime('now')
);
