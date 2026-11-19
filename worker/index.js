/**
 * Cloudflare Worker API for Quotation Manager SaaS
 * Fully Native Cloudflare Ecosystem: Cloudflare Workers + Cloudflare D1 (SQLite) + Web Crypto JWT + Cloudflare Turnstile
 * 100% White-Label & Production Secure
 */

// =====================================================================
// Web Crypto Utilities: SHA-256 Hashing & HMAC-SHA256 JWT
// =====================================================================

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function sha256(text) {
  if (!text) return '';
  const clean = String(text).trim();
  if (/^[a-f0-9]{64}$/i.test(clean)) return clean.toLowerCase();
  const data = new TextEncoder().encode(clean);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

async function hashPassword(plainText, salt = null) {
  if (!plainText) return '';
  const randomSalt = salt || Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const data = new TextEncoder().encode(`${randomSalt}:${String(plainText).trim()}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
  return `s256:${randomSalt}:${hashHex}`;
}

async function verifyPassword(plainText, storedHash) {
  if (!plainText || !storedHash) return false;
  const stored = String(storedHash).trim();

  // Modern salted hash: `s256:salt:hashHex`
  if (stored.startsWith('s256:')) {
    const parts = stored.split(':');
    if (parts.length === 3) {
      const salt = parts[1];
      const expected = await hashPassword(plainText, salt);
      return stored === expected;
    }
  }

  // Legacy raw 64-character SHA-256 hex fallback
  const clean = String(plainText).trim();
  const data = new TextEncoder().encode(clean);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const legacyHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
  return stored.toLowerCase() === legacyHash;
}

async function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataToSign));
  const signatureBytes = new Uint8Array(signature);
  let binarySig = '';
  for (let i = 0; i < signatureBytes.byteLength; i++) {
    binarySig += String.fromCharCode(signatureBytes[i]);
  }
  const encodedSignature = btoa(binarySig)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${dataToSign}.${encodedSignature}`;
}

async function verifyJwt(token, secret) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const dataToVerify = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    let base64Sig = encodedSignature.replace(/-/g, '+').replace(/_/g, '/');
    while (base64Sig.length % 4) {
      base64Sig += '=';
    }
    const binarySig = atob(base64Sig);
    const sigBytes = new Uint8Array(binarySig.length);
    for (let i = 0; i < binarySig.length; i++) {
      sigBytes[i] = binarySig.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(dataToVerify)
    );

    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // Token expired
    }
    return payload;
  } catch (e) {
    return null;
  }
}

// =====================================================================
// Response Helpers & CORS Middleware
// =====================================================================

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.CORS_ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, CF-Turnstile-Token',
    'Access-Control-Max-Age': '86400'
  };
}

function jsonResponse(data, status = 200, env = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(env)
    }
  });
}

function errorResponse(message, status = 400, env = {}) {
  return jsonResponse({ success: false, error: message }, status, env);
}

let schemaInitialized = false;
let schemaInitPromise = null;
async function ensureDatabaseSchema(env) {
  if (schemaInitialized || !env || !env.DB) return;
  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      const execSql = async (sql) => {
        try {
          const s = env.DB.prepare(sql);
          if (typeof s.run === 'function') {
            await s.run();
          } else if (typeof s.bind === 'function') {
            const b = s.bind();
            if (typeof b?.run === 'function') await b.run();
          }
        } catch (e) {}
      };

      try {
        // 1. Ensure core tables exist first
        await Promise.all([
          execSql(`
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              full_name TEXT NOT NULL,
              email TEXT DEFAULT '',
              role TEXT NOT NULL DEFAULT 'Sub-Admin',
              is_super_admin INTEGER NOT NULL DEFAULT 0,
              permissions_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
          `),
          execSql(`
            CREATE TABLE IF NOT EXISTS company_settings (
              id TEXT PRIMARY KEY DEFAULT 'primary',
              company_name TEXT NOT NULL DEFAULT 'Quotation Manager',
              tagline TEXT DEFAULT '',
              address TEXT DEFAULT '',
              phone TEXT DEFAULT '',
              phone_secondary TEXT DEFAULT '',
              email TEXT DEFAULT '',
              website TEXT DEFAULT '',
              gstin TEXT DEFAULT '',
              state TEXT DEFAULT 'Gujarat',
              state_code TEXT DEFAULT '24',
              bank_name TEXT DEFAULT '',
              account_name TEXT DEFAULT '',
              account_number TEXT DEFAULT '',
              ifsc_code TEXT DEFAULT '',
              branch TEXT DEFAULT '',
              terms_json TEXT DEFAULT '[]',
              banner_url TEXT DEFAULT '',
              promotional_banners TEXT DEFAULT '[]',
              header_logo_url TEXT DEFAULT '',
              company_logo TEXT DEFAULT '',
              signature_image_url TEXT DEFAULT '',
              signature_title TEXT DEFAULT 'Authorized Signatory',
              show_signature_in_pdf INTEGER DEFAULT 1,
              show_banner_in_pdf INTEGER DEFAULT 1,
              turnstile_site_key TEXT DEFAULT '',
              is_default INTEGER DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
          `),
          execSql(`
            CREATE TABLE IF NOT EXISTS password_resets (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL,
              otp_hash TEXT NOT NULL,
              expires_at INTEGER NOT NULL,
              used INTEGER NOT NULL DEFAULT 0,
              attempts INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
          `)
        ]);

        // 2. Concurrently run column migrations
        await Promise.all([
          execSql('ALTER TABLE users ADD COLUMN email TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN is_default INTEGER DEFAULT 0'),
          execSql('ALTER TABLE company_settings ADD COLUMN created_at TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN updated_at TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN phone_secondary TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN website TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN state TEXT DEFAULT "Gujarat"'),
          execSql('ALTER TABLE company_settings ADD COLUMN state_code TEXT DEFAULT "24"'),
          execSql('ALTER TABLE company_settings ADD COLUMN banner_url TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN promotional_banners TEXT DEFAULT "[]"'),
          execSql('ALTER TABLE company_settings ADD COLUMN header_logo_url TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN company_logo TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN signature_image_url TEXT DEFAULT ""'),
          execSql('ALTER TABLE company_settings ADD COLUMN signature_title TEXT DEFAULT "Authorized Signatory"'),
          execSql('ALTER TABLE company_settings ADD COLUMN show_signature_in_pdf INTEGER DEFAULT 1'),
          execSql('ALTER TABLE company_settings ADD COLUMN show_banner_in_pdf INTEGER DEFAULT 1'),
          execSql('ALTER TABLE quotations ADD COLUMN company_id TEXT DEFAULT "primary"'),
          execSql('ALTER TABLE quotations ADD COLUMN company_name TEXT DEFAULT ""'),
          execSql('ALTER TABLE quotations ADD COLUMN created_by_name TEXT DEFAULT ""'),
          execSql('ALTER TABLE clients ADD COLUMN created_by_name TEXT DEFAULT ""'),
          execSql('ALTER TABLE items_master ADD COLUMN created_by_name TEXT DEFAULT ""'),
          execSql('ALTER TABLE password_resets ADD COLUMN attempts INTEGER DEFAULT 0'),
          execSql('ALTER TABLE password_resets ADD COLUMN created_at TEXT DEFAULT ""'),
          execSql('ALTER TABLE quotations ADD COLUMN include_banner INTEGER DEFAULT 1'),
          execSql('CREATE INDEX IF NOT EXISTS idx_quotations_created_at ON quotations(created_at)'),
          execSql('CREATE INDEX IF NOT EXISTS idx_quotations_company_id ON quotations(company_id)'),
          execSql('CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)')
        ]);

        schemaInitialized = true;
      } catch (err) {
        schemaInitPromise = null;
        console.warn('[Schema Init Warning]:', err.message);
      }
    })();
  }
  await schemaInitPromise;
}

// =====================================================================
// Cloudflare Worker Handler
// =====================================================================

export default {
  async fetch(request, env, ctx) {
    try {
      // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env)
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 2. Static Assets Handler (Serves Frontend UI: HTML, JS, CSS, PWA assets)
    if (!path.startsWith('/api') && path !== '/health' && env.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
      } catch (e) {
        // Fall through to API handlers if assets error
      }
    }

    // 3. Health Check & Root Info
    if (path === '/' || path === '/api/health' || path === '/health') {
      return jsonResponse({
        status: 'online',
        service: 'Quotation Manager API',
        environment: 'Cloud Native',
        message: 'Quotation Manager API is operational.',
        time: new Date().toISOString()
      }, 200, env);
    }

    // =================================================================
    // Public Endpoint: Serve Images from Cloudflare R2 Bucket
    // =================================================================
    if (path.startsWith('/api/media/') && (method === 'GET' || method === 'HEAD')) {
      const filename = path.replace('/api/media/', '').trim();
      if (!filename || !/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
        return errorResponse('Invalid media filename', 400, env);
      }

      if (!env.MEDIA_BUCKET) {
        return errorResponse('Cloudflare R2 bucket "MEDIA_BUCKET" binding is not configured.', 500, env);
      }

      try {
        const object = await env.MEDIA_BUCKET.get(filename);
        if (!object) {
          return errorResponse('Media file not found', 404, env);
        }

        const clientEtag = request.headers.get('if-none-match');
        if (clientEtag && clientEtag === object.httpEtag) {
          return new Response(null, {
            status: 304,
            headers: corsHeaders(env)
          });
        }

        const headers = new Headers(corsHeaders(env));
        if (typeof object.writeHttpMetadata === 'function') {
          object.writeHttpMetadata(headers);
        }
        headers.set('etag', object.httpEtag || `"${filename}"`);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');

        if (!headers.get('Content-Type')) {
          const ext = filename.split('.').pop().toLowerCase();
          const mimeTypes = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
            gif: 'image/gif',
            svg: 'image/svg+xml'
          };
          headers.set('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        }

        return new Response(method === 'HEAD' ? null : object.body, { headers });
      } catch (err) {
        return errorResponse(`Failed to retrieve media: ${err.message}`, 500, env);
      }
    }

    // 4. Database Check (supports DB, Quotation_Manager, or quotation_manager_db binding names)
    if (!env.DB && (env.Quotation_Manager || env.quotation_manager_db || env.QUOTATION_MANAGER)) {
      env.DB = env.Quotation_Manager || env.quotation_manager_db || env.QUOTATION_MANAGER;
    }
    if (!env.DB) {
      return errorResponse('D1 database binding "DB" or "Quotation_Manager" not configured.', 500, env);
    }

    await ensureDatabaseSchema(env);

    const jwtSecret = env.JWT_SECRET;
    if (!jwtSecret) {
      return errorResponse('Server configuration error: JWT_SECRET secret binding is missing in Cloudflare environment. Run `npx wrangler secret put JWT_SECRET`.', 500, env);
    }

    // =================================================================
    // Public Endpoint: Unauthenticated Settings (For Login UI & Branding)
    // =================================================================
    if (path === '/api/settings/public' && method === 'GET') {
      try {
        let companyName = 'Quotation Manager';
        let tagline = 'Professional Quotation Management';
        let turnstileSiteKey = '';

        const csRow = await env.DB.prepare('SELECT company_name, tagline, turnstile_site_key FROM company_settings WHERE id = "primary"').first();
        if (csRow) {
          companyName = csRow.company_name || companyName;
          tagline = csRow.tagline || tagline;
          turnstileSiteKey = csRow.turnstile_site_key || '';
        } else {
          const sRow = await env.DB.prepare('SELECT company_json FROM settings WHERE id = "global"').first();
          if (sRow && sRow.company_json) {
            const comp = JSON.parse(sRow.company_json);
            companyName = comp.name || companyName;
            tagline = comp.tagline || tagline;
          }
        }

        return jsonResponse({
          success: true,
          companyName,
          tagline,
          turnstileRequired: !!env.TURNSTILE_SECRET,
          turnstileSiteKey
        }, 200, env);
      } catch (err) {
        return jsonResponse({ success: true, companyName: 'Quotation Manager', turnstileRequired: !!env.TURNSTILE_SECRET }, 200, env);
      }
    }

    // =================================================================
    // Public Endpoint: Login (with Cloudflare Turnstile Verification)
    // =================================================================
    if (path === '/api/auth/login' && method === 'POST') {
      try {
        const body = await request.json();
        const username = String(body.username || '').trim().toLowerCase();
        const rawPass = String(body.password || body.passwordHash || '');

        if (!username || !rawPass) {
          return errorResponse('Username and password are required', 400, env);
        }

        const reqHost = (url.hostname || request.headers.get('Host') || '').toLowerCase();
        const isLocalhost = reqHost.includes('localhost') || reqHost.includes('127.0.0.1');

        // 1. Cloudflare Turnstile Captcha Verification (if TURNSTILE_SECRET is configured)
        const turnstileSecret = env.TURNSTILE_SECRET;
        if (turnstileSecret) {
          const turnstileToken = body.turnstileToken || body['cf-turnstile-response'] || request.headers.get('CF-Turnstile-Token');
          if (!turnstileToken) {
            if (!isLocalhost) {
              return errorResponse('Captcha verification required. Please complete the security check.', 401, env);
            }
          } else {
            try {
              const clientIp = request.headers.get('CF-Connecting-IP') || '';
              const formData = new FormData();
              formData.append('secret', turnstileSecret);
              formData.append('response', turnstileToken);
              if (clientIp) {
                formData.append('remoteip', clientIp);
              }

              const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                body: formData
              });
              const verifyData = await verifyRes.json();
              if (!verifyData.success) {
                const errCodes = (verifyData['error-codes'] || []).join(', ');
                console.warn('[Turnstile Verification Note]', errCodes, verifyData);
                if (!isLocalhost) {
                  return errorResponse('Captcha verification failed. Please complete the security check.', 401, env);
                }
              }
            } catch (err) {
              console.warn('[Turnstile Error]', err.message);
              if (!isLocalhost) {
                return errorResponse('Security verification service unavailable. Please try again.', 500, env);
              }
            }
          }
        }

        // 2. Query user from D1 database
        const userRow = await env.DB.prepare(
          'SELECT id, username, password_hash, full_name, email, role, is_super_admin, permissions_json FROM users WHERE LOWER(username) = ?'
        ).bind(username).first();

        let authenticatedUser = null;

        if (userRow) {
          const isMatch = await verifyPassword(rawPass, userRow.password_hash);

          if (isMatch) {
            // Transparently upgrade legacy un-salted SHA-256 hash to modern salted format
            if (!String(userRow.password_hash || '').startsWith('s256:')) {
              try {
                const upgradedHash = await hashPassword(rawPass);
                await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(upgradedHash, userRow.id).run();
              } catch (e) {}
            }

            let perms = {};
            try {
              perms = JSON.parse(userRow.permissions_json || '{}');
            } catch (e) {
              perms = {};
            }

            const isSuper = !!(userRow.is_super_admin === 1 || userRow.role === 'Super Admin');
            authenticatedUser = {
              id: userRow.id,
              username: userRow.username,
              fullName: userRow.full_name,
              email: userRow.email || '',
              role: userRow.role,
              isSuperAdmin: isSuper,
              permissions: isSuper ? {
                canManageClients: true,
                canCreateQuotations: true,
                canEditQuotes: true,
                canManageItems: true,
                canDeleteQuotes: true,
                canManageSettings: true,
                canManageUsers: true,
                canBackupDatabase: true
              } : perms
            };
          }
        } else {
          // Fresh Database Fallback (allows initial Super Admin setup)
          const isDefaultAdmin = (username === 'admin' && (rawPass === 'admin@2026' || rawPass === 'a679cb086580f4949ad453e00bb982d1598f804791522f7c088ef577ef3724ff'));
          if (isDefaultAdmin) {
            authenticatedUser = {
              id: 'user_super_admin_' + username,
              username: username,
              fullName: 'System Administrator',
              email: 'admin@company.com',
              role: 'Super Admin',
              isSuperAdmin: true,
              permissions: {
                canManageClients: true,
                canCreateQuotations: true,
                canEditQuotes: true,
                canManageItems: true,
                canDeleteQuotes: true,
                canManageSettings: true,
                canManageUsers: true,
                canBackupDatabase: true
              }
            };

            // Transparently seed admin user in D1 database so account permanently persists
            try {
              const defaultHash = await hashPassword('admin@2026');
              await env.DB.prepare(`
                INSERT OR IGNORE INTO users (id, username, password_hash, full_name, email, role, is_super_admin, permissions_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'Super Admin', 1, ?, datetime('now'), datetime('now'))
              `).bind(
                authenticatedUser.id,
                username,
                defaultHash,
                authenticatedUser.fullName,
                authenticatedUser.email,
                JSON.stringify(authenticatedUser.permissions)
              ).run();
            } catch (e) {}
          }
        }

        if (!authenticatedUser) {
          return errorResponse('Invalid username or password', 401, env);
        }

        // 3. Generate JWT (valid for 7 days)
        const tokenPayload = {
          userId: authenticatedUser.id,
          username: authenticatedUser.username,
          fullName: authenticatedUser.fullName,
          email: authenticatedUser.email || '',
          role: authenticatedUser.role,
          isSuperAdmin: authenticatedUser.isSuperAdmin,
          permissions: authenticatedUser.permissions,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
        };

        const token = await signJwt(tokenPayload, jwtSecret);

        return jsonResponse({
          success: true,
          message: `Welcome, ${authenticatedUser.fullName}!`,
          token,
          user: authenticatedUser
        }, 200, env);
      } catch (err) {
        return errorResponse(`Login error: ${err.message}`, 500, env);
      }
    }

    // =================================================================
    // Public Endpoint: Forgot Password - Request 6-Digit OTP
    // =================================================================
    if (path === '/api/auth/forgot-password' && method === 'POST') {
      try {
        const body = await request.json();
        const email = String(body.email || body.username || '').trim().toLowerCase();

        if (!email) {
          return errorResponse('Registered email address or username is required', 400, env);
        }

        // 1. Check if user exists in D1 database
        let userRow = null;
        try {
          userRow = await env.DB.prepare(
            'SELECT id, username, full_name FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?'
          ).bind(email, email).first();
        } catch (e) {
          userRow = await env.DB.prepare(
            'SELECT id, username, full_name FROM users WHERE LOWER(username) = ?'
          ).bind(email).first();
        }

        // Check company settings email for admin fallback
        if (!userRow) {
          try {
            const compRow = await env.DB.prepare('SELECT email FROM company_settings WHERE id = "primary"').first();
            if (compRow && compRow.email && compRow.email.trim().toLowerCase() === email) {
              userRow = await env.DB.prepare('SELECT id, username, full_name FROM users WHERE LOWER(username) = "admin"').first();
            }
          } catch (e) {}
        }

        if (!userRow) {
          return errorResponse('No account registered with that email address or username', 404, env);
        }

        // 2. Generate secure 6-digit numeric OTP using Web Crypto API
        const randomValues = new Uint32Array(1);
        crypto.getRandomValues(randomValues);
        const otp = String(100000 + (randomValues[0] % 900000));
        const otpHash = await sha256(otp);
        const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes expiry

        const idBytes = new Uint8Array(4);
        crypto.getRandomValues(idBytes);
        const idSuffix = Array.from(idBytes, b => b.toString(16).padStart(2, '0')).join('');
        const resetId = `reset_${Date.now()}_${idSuffix}`;

        // Ensure table exists (auto-migration)
        try {
          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS password_resets (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL,
              otp_hash TEXT NOT NULL,
              expires_at INTEGER NOT NULL,
              used INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
          `).run();
        } catch (e) {}

        // Invalidate previous unused OTPs for this email/user
        try {
          await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE LOWER(email) = ? AND used = 0').bind(email).run();
        } catch (e) {}

        // Store new OTP hash
        await env.DB.prepare(`
          INSERT INTO password_resets (id, email, otp_hash, expires_at, used, created_at)
          VALUES (?, ?, ?, ?, 0, datetime('now'))
        `).bind(resetId, email, otpHash, expiresAt).run();

        // 3. Dispatch email via Resend or MailChannels if configured
        if (env.RESEND_API_KEY) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: env.EMAIL_FROM || 'Quotation Manager <onboarding@resend.dev>',
                to: [email.includes('@') ? email : 'admin@company.com'],
                subject: 'Quotation Manager - Password Reset OTP',
                html: `<div style="font-family:sans-serif;padding:20px;color:#1e293b;">
                  <h2>Password Reset Code</h2>
                  <p>Your one-time password reset code is:</p>
                  <div style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#1e3a8a;margin:16px 0;">${otp}</div>
                  <p>This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
                </div>`
              })
            });
          } catch (e) {
            console.warn('[AUTH-OTP] Resend dispatch note:', e.message);
          }
        } else {
          try {
            await fetch('https://api.mailchannels.net/tx/v1/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                personalizations: [{ to: [{ email: email.includes('@') ? email : 'admin@company.com' }] }],
                from: { email: env.EMAIL_FROM || 'security@quotationmanager.com', name: 'Quotation Manager' },
                subject: 'Quotation Manager - Password Reset OTP',
                content: [{
                  type: 'text/html',
                  value: `<div style="font-family:sans-serif;padding:20px;color:#1e293b;">
                    <h2>Password Reset Code</h2>
                    <p>Your one-time password reset code is:</p>
                    <div style="font-size:28px;font-weight:bold;letter-spacing:4px;color:#1e3a8a;margin:16px 0;">${otp}</div>
                    <p>This code will expire in 10 minutes.</p>
                  </div>`
                }]
              })
            });
          } catch (e) {
            console.warn('[AUTH-OTP] MailChannels dispatch note:', e.message);
          }
        }

        return jsonResponse({
          success: true,
          message: '6-digit OTP code has been generated and sent to your email. (Check server logs if in development mode)',
          email,
          expiresInMinutes: 10
        }, 200, env);
      } catch (err) {
        return errorResponse(`Forgot password error: ${err.message}`, 500, env);
      }
    }

    // =================================================================
    // Public Endpoint: Reset Password - Verify OTP & Set New Password
    // =================================================================
    if (path === '/api/auth/reset-password' && method === 'POST') {
      try {
        const body = await request.json();
        const email = String(body.email || body.username || '').trim().toLowerCase();
        const otp = String(body.otp || '').trim();
        const newPassword = String(body.newPassword || body.password || '').trim();

        if (!email || !otp || !newPassword) {
          return errorResponse('Email/Username, 6-digit OTP, and new password are required', 400, env);
        }

        if (newPassword.length < 6) {
          return errorResponse('New password must be at least 6 characters long', 400, env);
        }

        const otpHash = await sha256(otp);
        const now = Date.now();

        // 1. Verify OTP in password_resets table with rate limiting (max 5 attempts)
        const resetRow = await env.DB.prepare(
          'SELECT id, otp_hash, expires_at, used, attempts FROM password_resets WHERE LOWER(email) = ? AND used = 0 ORDER BY expires_at DESC LIMIT 1'
        ).bind(email).first();

        if (!resetRow) {
          return errorResponse('Invalid OTP code or email. Please check the code and try again.', 400, env);
        }

        const attempts = (resetRow.attempts || 0);
        if (attempts >= 5) {
          try {
            await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(resetRow.id).run();
          } catch (e) {}
          return errorResponse('Too many failed attempts. This OTP code has been invalidated for security. Please request a new code.', 400, env);
        }

        if (resetRow.expires_at < now) {
          return errorResponse('This OTP code has expired (10-minute limit). Please request a new code.', 400, env);
        }

        if (resetRow.otp_hash !== otpHash) {
          const newAttempts = attempts + 1;
          const remaining = Math.max(0, 5 - newAttempts);
          try {
            await env.DB.prepare('UPDATE password_resets SET attempts = ? WHERE id = ?').bind(newAttempts, resetRow.id).run();
            if (remaining <= 0) {
              await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(resetRow.id).run();
            }
          } catch (e) {}
          if (remaining <= 0) {
            return errorResponse('Too many failed attempts. This OTP code has been invalidated for security. Please request a new code.', 400, env);
          }
          return errorResponse(`Invalid OTP code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, 400, env);
        }

        // 2. Find the user account
        let userRow = null;
        try {
          userRow = await env.DB.prepare(
            'SELECT id, username FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?'
          ).bind(email, email).first();
        } catch (e) {
          userRow = await env.DB.prepare(
            'SELECT id, username FROM users WHERE LOWER(username) = ?'
          ).bind(email).first();
        }

        if (!userRow) {
          try {
            const compRow = await env.DB.prepare('SELECT email FROM company_settings WHERE id = "primary"').first();
            if (compRow && compRow.email && compRow.email.trim().toLowerCase() === email) {
              userRow = await env.DB.prepare('SELECT id, username FROM users WHERE LOWER(username) = "admin"').first();
            }
          } catch (e) {}
        }

        if (!userRow) {
          return errorResponse('User account not found', 404, env);
        }

        // 3. Update user password in D1
        const newHash = await hashPassword(newPassword);
        await env.DB.prepare(
          'UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?'
        ).bind(newHash, userRow.id).run();

        // 4. Mark OTP as used
        await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(resetRow.id).run();

        return jsonResponse({
          success: true,
          message: 'Password reset successfully! You can now log in with your new password.'
        }, 200, env);
      } catch (err) {
        return errorResponse(`Reset password error: ${err.message}`, 500, env);
      }
    }

    // =================================================================
    // Authentication & JWT Verification Middleware for Protected Routes
    // =================================================================
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const currentUser = await verifyJwt(token, jwtSecret);

    if (!currentUser) {
      return errorResponse('Authentication required. Invalid or expired token.', 401, env);
    }

    // =================================================================
    // Authenticated Endpoint: Direct Image Upload to Cloudflare R2
    // =================================================================
    if (path === '/api/upload' && method === 'POST') {
      try {
        let fileBuffer;
        let contentType = 'image/jpeg';
        let originalName = '';

        const reqContentType = request.headers.get('Content-Type') || '';

        if (reqContentType.includes('multipart/form-data') || reqContentType.includes('application/x-www-form-urlencoded')) {
          const formData = await request.formData();
          const file = formData.get('file') || formData.get('image');
          if (!file) {
            return errorResponse('No image file provided. Form field must be "file" or "image".', 400, env);
          }
          if (typeof file === 'string') {
            if (file.startsWith('data:')) {
              const match = file.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                contentType = match[1];
                fileBuffer = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
              }
            } else {
              fileBuffer = Uint8Array.from(atob(file), c => c.charCodeAt(0));
            }
          } else {
            contentType = file.type || 'image/jpeg';
            originalName = file.name || '';
            fileBuffer = await file.arrayBuffer();
          }
        } else if (reqContentType.includes('application/json')) {
          const jsonBody = await request.json();
          const base64Data = jsonBody.image || jsonBody.data || jsonBody.file;
          originalName = jsonBody.filename || '';
          if (base64Data && typeof base64Data === 'string') {
            const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              contentType = match[1];
              fileBuffer = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
            } else {
              fileBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
            }
          }
        } else {
          contentType = reqContentType || 'image/jpeg';
          fileBuffer = await request.arrayBuffer();
        }

        if (!fileBuffer || fileBuffer.byteLength === 0) {
          return errorResponse('Invalid or empty image file.', 400, env);
        }

        if (fileBuffer.byteLength > 10 * 1024 * 1024) {
          return errorResponse('Image file size exceeds 10MB limit.', 400, env);
        }

        // Graceful fallback if R2 MEDIA_BUCKET is not yet activated on account
        if (!env.MEDIA_BUCKET) {
          const bytes = new Uint8Array(fileBuffer);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          const base64Url = `data:${contentType};base64,${btoa(binary)}`;
          return jsonResponse({
            success: true,
            ok: true,
            filename: 'embedded',
            url: base64Url
          }, 201, env);
        }

        let ext = 'jpg';
        if (originalName && originalName.includes('.')) {
          ext = originalName.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
        } else if (contentType) {
          const mimeMap = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'image/svg+xml': 'svg'
          };
          ext = mimeMap[contentType] || 'jpg';
        }

        const uniqueFilename = `img_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;

        await env.MEDIA_BUCKET.put(uniqueFilename, fileBuffer, {
          httpMetadata: {
            contentType: contentType || 'image/jpeg',
            cacheControl: 'public, max-age=31536000, immutable'
          }
        });

        return jsonResponse({
          success: true,
          ok: true,
          filename: uniqueFilename,
          url: `/api/media/${uniqueFilename}`
        }, 201, env);
      } catch (err) {
        return errorResponse(`Upload failed: ${err.message}`, 500, env);
      }
    }

    // Helper: Verify Super Admin permission
    const isSuperAdmin = !!(currentUser.isSuperAdmin || currentUser.role === 'Super Admin');

    // =================================================================
    // Auth Profile & Change Password Endpoints
    // =================================================================
    if (path === '/api/auth/profile' && method === 'GET') {
      return jsonResponse({
        success: true,
        user: {
          id: currentUser.userId,
          username: currentUser.username,
          fullName: currentUser.fullName,
          role: currentUser.role,
          isSuperAdmin: currentUser.isSuperAdmin,
          permissions: currentUser.permissions
        }
      }, 200, env);
    }

    if (path === '/api/auth/change-password' && method === 'POST') {
      try {
        const body = await request.json();
        const oldPass = String(body.oldPassword || '');
        const newPass = String(body.newPassword || '');

        if (!newPass || newPass.length < 6) {
          return errorResponse('New password must be at least 6 characters long', 400, env);
        }

        const userRow = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(currentUser.userId).first();

        if (userRow) {
          const isOldValid = await verifyPassword(oldPass, userRow.password_hash);
          if (oldPass && !isOldValid) {
            return errorResponse('Current password is incorrect', 400, env);
          }
          const newHash = await hashPassword(newPass);
          await env.DB.prepare(
            'UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?'
          ).bind(newHash, currentUser.userId).run();
        } else {
          const newHash = await hashPassword(newPass);
          await env.DB.prepare(`
            INSERT INTO users (id, username, password_hash, full_name, role, is_super_admin, permissions_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))
          `).bind(
            currentUser.userId,
            currentUser.username,
            newHash,
            currentUser.fullName || 'System Administrator',
            currentUser.role || 'Super Admin',
            currentUser.isSuperAdmin ? 1 : 0,
            JSON.stringify(currentUser.permissions || {})
          ).run();
        }

        return jsonResponse({ success: true, message: 'Password updated successfully' }, 200, env);
      } catch (err) {
        return errorResponse(`Change password error: ${err.message}`, 500, env);
      }
    }

    // =================================================================
    // Users & Roles Management (Super Admin Only)
    // =================================================================
    if (path === '/api/users') {
      if (!isSuperAdmin) {
        return errorResponse('Access denied: Only Super Admin can manage users', 403, env);
      }

      // GET: List all users
      if (method === 'GET') {
        const rows = await env.DB.prepare(
          'SELECT id, username, full_name, email, role, is_super_admin, permissions_json, created_at, updated_at FROM users ORDER BY created_at DESC'
        ).all();

        const usersList = (rows.results || []).map(u => ({
          id: u.id,
          username: u.username,
          fullName: u.full_name,
          email: u.email || '',
          role: u.role,
          isSuperAdmin: !!u.is_super_admin,
          permissions: JSON.parse(u.permissions_json || '{}'),
          createdAt: u.created_at,
          updatedAt: u.updated_at
        }));

        return jsonResponse({ success: true, users: usersList }, 200, env);
      }

      // POST: Create or Update User
      if (method === 'POST') {
        if (!isSuperAdmin) {
          return errorResponse('Access denied: Only Super Admin can manage user accounts', 403, env);
        }
        const body = await request.json();
        const id = body.id || ('user_sub_' + Date.now());
        const username = String(body.username || '').trim().toLowerCase();
        const fullName = String(body.fullName || username).trim();
        const email = String(body.email || '').trim().toLowerCase();
        const role = String(body.role || 'Sub-Admin');
        const permsJson = JSON.stringify(body.permissions || {});
        const isSuper = (body.isSuperAdmin === true || role === 'Super Admin') ? 1 : 0;

        if (!username) {
          return errorResponse('Username is required', 400, env);
        }

        const existing = await env.DB.prepare('SELECT id, password_hash, is_super_admin, role FROM users WHERE id = ? OR username = ?').bind(id, username).first();

        let passHash = null;
        if (body.password) {
          if (String(body.password).length < 6) {
            return errorResponse('Password must be at least 6 characters long', 400, env);
          }
          passHash = await hashPassword(body.password);
        } else if (body.passwordHash) {
          passHash = body.passwordHash;
        }

        if (existing) {
          const isExistingSuper = (existing.is_super_admin === 1 || existing.role === 'Super Admin');
          const finalIsSuper = isExistingSuper ? 1 : isSuper;
          const finalRole = isExistingSuper ? 'Super Admin' : role;
          const finalHash = passHash || existing.password_hash;
          await env.DB.prepare(`
            UPDATE users SET 
              full_name = ?, email = ?, role = ?, is_super_admin = ?, permissions_json = ?, password_hash = ?, updated_at = datetime("now")
            WHERE id = ?
          `).bind(fullName, email, finalRole, finalIsSuper, permsJson, finalHash, existing.id).run();
        } else {
          if (!passHash) {
            return errorResponse('Password is required and must be at least 6 characters long', 400, env);
          }
          await env.DB.prepare(`
            INSERT INTO users (id, username, password_hash, full_name, email, role, is_super_admin, permissions_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))
          `).bind(id, username, passHash, fullName, email, role, isSuper, permsJson).run();
        }

        return jsonResponse({ success: true, message: 'User saved successfully' }, 200, env);
      }
    }

    // DELETE: Remove User
    if (path.startsWith('/api/users/') && method === 'DELETE') {
      if (!isSuperAdmin) {
        return errorResponse('Access denied: Only Super Admin can delete users', 403, env);
      }
      const targetId = path.split('/').pop();
      if (targetId === currentUser.userId) {
        return errorResponse('You cannot delete your own Super Admin account', 400, env);
      }
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
      return jsonResponse({ success: true, message: 'User deleted' }, 200, env);
    }

    // POST: Quick Reset Password for Sub-Admin by Super Admin (No Current Password Required)
    if (path === '/api/users/reset-password' && method === 'POST') {
      if (!isSuperAdmin) {
        return errorResponse('Access denied: Only Super Admin can reset user passwords', 403, env);
      }
      try {
        const body = await request.json();
        const userId = String(body.userId || body.id || '').trim();
        const newPassword = String(body.newPassword || body.password || '').trim();

        if (!userId || !newPassword) {
          return errorResponse('User ID and new password are required', 400, env);
        }

        if (newPassword.length < 6) {
          return errorResponse('Password must be at least 6 characters long', 400, env);
        }

        const newHash = await hashPassword(newPassword);
        const result = await env.DB.prepare(
          'UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?'
        ).bind(newHash, userId).run();

        return jsonResponse({ success: true, message: 'Password reset successfully' }, 200, env);
      } catch (err) {
        return errorResponse(`Reset user password error: ${err.message}`, 500, env);
      }
    }

    // =================================================================
    // Quotations Endpoints (With Advanced Filters & Pagination)
    // =================================================================
    if (path === '/api/quotations') {
      // GET: Query quotations with native SQL filters and pagination
      if (method === 'GET') {
        const queryParams = url.searchParams;
        const fromDate = queryParams.get('from') || queryParams.get('startDate');
        const toDate = queryParams.get('to') || queryParams.get('endDate');
        const month = queryParams.get('month'); // e.g., '01', '02', '11'
        const year = queryParams.get('year');   // e.g., '2026'
        const status = queryParams.get('status');
        const search = queryParams.get('search');
        const limit = Math.min(parseInt(queryParams.get('limit') || '50', 10), 5000);
        const offset = Math.max(parseInt(queryParams.get('offset') || '0', 10), 0);

        let whereClauses = [];
        let bindings = [];

        if (fromDate) {
          whereClauses.push('date >= ?');
          bindings.push(fromDate);
        }
        if (toDate) {
          whereClauses.push('date <= ?');
          bindings.push(toDate);
        }
        if (month && month !== 'ALL') {
          whereClauses.push("strftime('%m', date) = ?");
          bindings.push(String(month).padStart(2, '0'));
        }
        if (year && year !== 'ALL') {
          whereClauses.push("strftime('%Y', date) = ?");
          bindings.push(String(year));
        }
        if (status && status !== 'ALL') {
          whereClauses.push('status = ?');
          bindings.push(status);
        }
        if (search) {
          whereClauses.push('(quote_number LIKE ? OR client_name LIKE ? OR client_company LIKE ?)');
          const term = `%${search}%`;
          bindings.push(term, term, term);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Count total matching records
        const countSql = `SELECT COUNT(*) as total FROM quotations ${whereSql}`;
        const countStmt = env.DB.prepare(countSql);
        const countRes = bindings.length > 0 ? await countStmt.bind(...bindings).first() : await countStmt.first();
        const total = countRes ? countRes.total : 0;

        // Fetch paginated records
        const listSql = `
          SELECT * FROM quotations 
          ${whereSql} 
          ORDER BY date DESC, created_at DESC 
          LIMIT ? OFFSET ?
        `;
        const listStmt = env.DB.prepare(listSql);
        const listBindings = [...bindings, limit, offset];

        const rows = await listStmt.bind(...listBindings).all();

        const quotations = (rows.results || []).map(q => ({
          id: q.id,
          quoteNumber: q.quote_number,
          date: q.date,
          validUntil: q.valid_until,
          clientId: q.client_id,
          clientName: q.client_name,
          clientCompany: q.client_company,
          clientPhone: q.client_phone,
          clientEmail: q.client_email,
          clientGst: q.client_gst,
          clientAddress: q.client_address,
          companyId: q.company_id || 'primary',
          companyName: q.company_name || '',
          items: JSON.parse(q.items_json || '[]').map(it => {
            if (it && it.imageUrl && it.imageUrl.startsWith('data:image/') && it.imageUrl.length > 500) {
              return { ...it, imageUrl: '' };
            }
            return it;
          }),
          calculations: JSON.parse(q.calculations_json || '[]'),
          materialTotal: q.material_total,
          loadingCharges: q.loading_charges,
          additionalCharges: JSON.parse(q.additional_charges_json || '[]'),
          chargesTotal: q.charges_total,
          gstType: q.gst_type,
          gstRate: q.gst_rate,
          gstAmount: q.gst_amount,
          roundOff: q.round_off,
          grandTotal: q.grand_total,
          grandTotalWords: q.grand_total_words,
          notes: q.notes,
          includeBanner: q.include_banner === 1 || q.include_banner === '1' || q.include_banner === true || q.include_banner === null || q.include_banner === undefined,
          include_banner: q.include_banner === 0 || q.include_banner === '0' || q.include_banner === false ? 0 : 1,
          status: q.status,
          createdBy: q.created_by_name || q.created_by || 'System Administrator',
          createdByName: q.created_by_name || q.created_by || 'System Administrator',
          createdAt: q.created_at,
          updatedAt: q.updated_at
        }));

        return jsonResponse({
          success: true,
          quotations,
          total,
          limit,
          offset
        }, 200, env);
      }

      // POST: Create or Update Quotation
      if (method === 'POST') {
        const body = await request.json();
        const id = body.id || ('qt_' + Date.now());
        const rawQuoteNumber = String(body.quoteNumber || '').trim();

        const isExisting = await env.DB.prepare('SELECT id FROM quotations WHERE id = ?').bind(id).first();
        const canCreate = isSuperAdmin || !!currentUser.permissions?.canCreateQuotations;
        const canEdit = isSuperAdmin || !!currentUser.permissions?.canEditQuotes || !!currentUser.permissions?.canCreateQuotations;

        if (isExisting && !canEdit) {
          return errorResponse('Access denied: You do not have permission to edit quotations', 403, env);
        }
        if (!isExisting && !canCreate) {
          return errorResponse('Access denied: You do not have permission to create quotations', 403, env);
        }

        // Determine unique sequential quote number (atomic collision resolution)
        let finalQuoteNumber = rawQuoteNumber;
        if (isExisting) {
          finalQuoteNumber = rawQuoteNumber || isExisting.quote_number;
        } else {
          let isCollision = false;
          if (finalQuoteNumber) {
            try {
              const conflict = await env.DB.prepare('SELECT id FROM quotations WHERE quote_number = ? AND id != ?').bind(finalQuoteNumber, id).first();
              if (conflict) isCollision = true;
            } catch (e) {}
          }
          if (!finalQuoteNumber || isCollision) {
            const dateStr = body.date || new Date().toISOString().split('T')[0];
            const year = dateStr.slice(0, 4);
            const prefix = `QT-${year}-`;
            let maxSeq = 0;
            try {
              const prep = env.DB.prepare(
                'SELECT quote_number FROM quotations WHERE quote_number LIKE ? ORDER BY LENGTH(quote_number) DESC, quote_number DESC LIMIT 1'
              ).bind(`${prefix}%`);
              const row = (await prep.first()) || ((await prep.all())?.results?.[0]);
              if (row && row.quote_number) {
                const parts = String(row.quote_number).split('-');
                const seq = parseInt(parts[2], 10);
                if (!isNaN(seq)) maxSeq = seq;
              }
            } catch (e) {}
            finalQuoteNumber = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
          }
        }

        const date = body.date || new Date().toISOString().split('T')[0];
        const validUntil = body.validUntil || '';
        const clientId = body.clientId || null;
        const clientName = body.clientName || 'Valued Customer';
        const clientCompany = body.clientCompany || '';
        const clientPhone = body.clientPhone || '';
        const clientEmail = body.clientEmail || '';
        const clientGst = body.clientGst || '';
        const clientAddress = body.clientAddress || '';

        const companyId = String(body.companyId || body.company_id || 'primary').trim();
        const companyName = String(body.companyName || body.company_name || '').trim();

        const itemsJson = JSON.stringify(body.items || []);
        const calcsJson = JSON.stringify(body.calculations || []);
        const addChargesJson = JSON.stringify(body.additionalCharges || []);

        const materialTotal = parseFloat(body.materialTotal) || 0.0;
        const loadingCharges = parseFloat(body.loadingCharges) || 0.0;
        const chargesTotal = parseFloat(body.chargesTotal) || 0.0;
        const gstType = body.gstType || 'CGST_SGST';
        const gstRate = parseFloat(body.gstRate) || 18.0;
        const gstAmount = parseFloat(body.gstAmount) || 0.0;
        const roundOff = parseFloat(body.roundOff) || 0.0;
        const grandTotal = parseFloat(body.grandTotal) || 0.0;
        const grandTotalWords = body.grandTotalWords || '';
        const notes = body.notes || '';
        const includeBanner = (body.includeBanner === false || body.includeBanner === 0 || body.include_banner === 0 || body.include_banner === false) ? 0 : 1;
        const status = body.status || 'Draft';

        // Audit Trail: Store user's actual Full Name (e.g. Ramesh Patel) instead of Role
        const authorName = (currentUser.fullName || currentUser.username || 'System Administrator').trim();

        await env.DB.prepare(`
          INSERT INTO quotations (
            id, quote_number, date, valid_until, client_id, client_name, client_company,
            client_phone, client_email, client_gst, client_address, company_id, company_name,
            items_json, calculations_json, material_total, loading_charges, additional_charges_json, charges_total,
            gst_type, gst_rate, gst_amount, round_off, grand_total, grand_total_words,
            notes, include_banner, status, created_by, created_by_name, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, datetime("now"), datetime("now")
          )
          ON CONFLICT(id) DO UPDATE SET
            quote_number = excluded.quote_number,
            date = excluded.date,
            valid_until = excluded.valid_until,
            client_id = excluded.client_id,
            client_name = excluded.client_name,
            client_company = excluded.client_company,
            client_phone = excluded.client_phone,
            client_email = excluded.client_email,
            client_gst = excluded.client_gst,
            client_address = excluded.client_address,
            company_id = excluded.company_id,
            company_name = excluded.company_name,
            items_json = excluded.items_json,
            calculations_json = excluded.calculations_json,
            material_total = excluded.material_total,
            loading_charges = excluded.loading_charges,
            additional_charges_json = excluded.additional_charges_json,
            charges_total = excluded.charges_total,
            gst_type = excluded.gst_type,
            gst_rate = excluded.gst_rate,
            gst_amount = excluded.gst_amount,
            round_off = excluded.round_off,
            grand_total = excluded.grand_total,
            grand_total_words = excluded.grand_total_words,
            notes = excluded.notes,
            include_banner = excluded.include_banner,
            status = excluded.status,
            updated_at = datetime("now")
        `).bind(
          id, finalQuoteNumber, date, validUntil, clientId, clientName, clientCompany,
          clientPhone, clientEmail, clientGst, clientAddress, companyId, companyName,
          itemsJson, calcsJson, materialTotal, loadingCharges, addChargesJson, chargesTotal,
          gstType, gstRate, gstAmount, roundOff, grandTotal, grandTotalWords,
          notes, includeBanner, status, authorName, authorName
        ).run();

        return jsonResponse({ success: true, message: 'Quotation saved successfully', id, quoteNumber: finalQuoteNumber }, 200, env);
      }
    }

    // Single Quotation Retrieval & Delete
    if (path.startsWith('/api/quotations/')) {
      const targetId = path.split('/').pop();
      if (method === 'GET') {
        const q = await env.DB.prepare('SELECT * FROM quotations WHERE id = ?').bind(targetId).first();
        if (!q) {
          return errorResponse('Quotation not found', 404, env);
        }
        const quotation = {
          id: q.id,
          quoteNumber: q.quote_number,
          date: q.date,
          validUntil: q.valid_until,
          clientId: q.client_id,
          clientName: q.client_name,
          clientCompany: q.client_company,
          clientPhone: q.client_phone,
          clientEmail: q.client_email,
          clientGst: q.client_gst,
          clientAddress: q.client_address,
          companyId: q.company_id || 'primary',
          companyName: q.company_name || '',
          items: JSON.parse(q.items_json || '[]'),
          calculations: JSON.parse(q.calculations_json || '[]'),
          materialTotal: q.material_total,
          loadingCharges: q.loading_charges,
          additionalCharges: JSON.parse(q.additional_charges_json || '[]'),
          chargesTotal: q.charges_total,
          gstType: q.gst_type,
          gstRate: q.gst_rate,
          gstAmount: q.gst_amount,
          roundOff: q.round_off,
          grandTotal: q.grand_total,
          grandTotalWords: q.grand_total_words,
          notes: q.notes,
          includeBanner: q.include_banner === 1 || q.include_banner === '1' || q.include_banner === true || q.include_banner === null || q.include_banner === undefined,
          include_banner: q.include_banner === 0 || q.include_banner === '0' || q.include_banner === false ? 0 : 1,
          status: q.status,
          createdBy: q.created_by_name || q.created_by || 'System Administrator',
          createdByName: q.created_by_name || q.created_by || 'System Administrator',
          createdAt: q.created_at,
          updatedAt: q.updated_at
        };
        return jsonResponse({ success: true, quotation }, 200, env);
      }

      if (method === 'DELETE') {
        if (!isSuperAdmin && !currentUser.permissions?.canDeleteQuotes) {
          return errorResponse('Access denied: You do not have permission to delete quotations', 403, env);
        }
        await env.DB.prepare('DELETE FROM quotations WHERE id = ?').bind(targetId).run();
        return jsonResponse({ success: true, message: 'Quotation deleted' }, 200, env);
      }
    }

    // =================================================================
    // Clients Endpoints
    // =================================================================
    if (path === '/api/clients') {
      if (method === 'GET') {
        const queryParams = url.searchParams;
        const search = queryParams.get('search');
        const limit = Math.min(parseInt(queryParams.get('limit') || '500', 10), 1000);
        const offset = Math.max(parseInt(queryParams.get('offset') || '0', 10), 0);

        let whereClause = '';
        let bindings = [];

        if (search) {
          whereClause = ' WHERE (name LIKE ? OR company_name LIKE ? OR phone LIKE ?)';
          const term = `%${search}%`;
          bindings.push(term, term, term);
        }

        let total = 0;
        try {
          const countSql = `SELECT COUNT(*) as total FROM clients ${whereClause}`;
          const countRes = bindings.length > 0
            ? await env.DB.prepare(countSql).bind(...bindings).first()
            : await env.DB.prepare(countSql).first();
          total = countRes ? countRes.total : 0;
        } catch (e) {}

        const sql = `SELECT * FROM clients ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        const rows = await env.DB.prepare(sql).bind(...bindings, limit, offset).all();
        const clients = (rows.results || []).map(c => ({
          id: c.id,
          name: c.name,
          companyName: c.company_name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          gstNumber: c.gst_number,
          createdBy: c.created_by_name || c.created_by || 'System Administrator',
          createdByName: c.created_by_name || c.created_by || 'System Administrator',
          createdAt: c.created_at,
          updatedAt: c.updated_at
        }));

        return jsonResponse({ success: true, clients, total, limit, offset }, 200, env);
      }

      if (method === 'POST') {
        if (!isSuperAdmin && !currentUser.permissions?.canManageClients) {
          return errorResponse('Access denied: You do not have permission to manage clients', 403, env);
        }
        const body = await request.json();
        const id = body.id || ('cli_' + Date.now());
        const name = String(body.name || '').trim();
        const companyName = String(body.companyName || '').trim();
        const phone = String(body.phone || '').trim();
        const email = String(body.email || '').trim();
        const address = String(body.address || '').trim();
        const gstNumber = String(body.gstNumber || '').trim();

        if (!name && !companyName) {
          return errorResponse('Client name or company name is required', 400, env);
        }

        // Audit Trail: Store user's actual Full Name instead of Role
        const authorName = (currentUser.fullName || currentUser.username || 'System Administrator').trim();

        await env.DB.prepare(`
          INSERT INTO clients (id, name, company_name, phone, email, address, gst_number, created_by, created_by_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            company_name = excluded.company_name,
            phone = excluded.phone,
            email = excluded.email,
            address = excluded.address,
            gst_number = excluded.gst_number,
            updated_at = datetime("now")
        `).bind(id, name, companyName, phone, email, address, gstNumber, authorName, authorName).run();

        return jsonResponse({ success: true, message: 'Client saved', id }, 200, env);
      }
    }

    if (path.startsWith('/api/clients/') && method === 'DELETE') {
      if (!isSuperAdmin && !currentUser.permissions?.canDeleteQuotes) {
        return errorResponse('Access denied: You do not have permission to delete clients', 403, env);
      }
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
      return jsonResponse({ success: true, message: 'Client deleted' }, 200, env);
    }

    // =================================================================
    // Items Master Endpoints
    // =================================================================
    if (path === '/api/items') {
      if (method === 'GET') {
        const queryParams = url.searchParams;
        const search = queryParams.get('search');
        const limit = Math.min(parseInt(queryParams.get('limit') || '500', 10), 1000);
        const offset = Math.max(parseInt(queryParams.get('offset') || '0', 10), 0);

        let whereClause = '';
        let bindings = [];

        if (search) {
          whereClause = ' WHERE (name LIKE ? OR description LIKE ?)';
          const term = `%${search}%`;
          bindings.push(term, term);
        }

        let total = 0;
        try {
          const countSql = `SELECT COUNT(*) as total FROM items_master ${whereClause}`;
          const countRes = bindings.length > 0
            ? await env.DB.prepare(countSql).bind(...bindings).first()
            : await env.DB.prepare(countSql).first();
          total = countRes ? countRes.total : 0;
        } catch (e) {}

        const sql = `SELECT * FROM items_master ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`;
        const rows = await env.DB.prepare(sql).bind(...bindings, limit, offset).all();
        const items = (rows.results || []).map(i => ({
          id: i.id,
          name: i.name,
          description: i.description,
          unit: i.unit,
          rate: i.rate,
          defaultWidth: i.default_width,
          imageUrl: i.image_url,
          createdBy: i.created_by_name || i.created_by || 'System Administrator',
          createdByName: i.created_by_name || i.created_by || 'System Administrator',
          createdAt: i.created_at,
          updatedAt: i.updated_at
        }));
        return jsonResponse({ success: true, items, total, limit, offset }, 200, env);
      }

      if (method === 'POST') {
        if (!isSuperAdmin && !currentUser.permissions?.canManageItems) {
          return errorResponse('Access denied: You do not have permission to manage Items Master', 403, env);
        }
        const body = await request.json();
        const id = body.id || ('itm_' + Date.now());
        const name = String(body.name || '').trim();
        const description = String(body.description || '').trim();
        const unit = String(body.unit || 'NOS').trim();
        const rate = parseFloat(body.rate) || 0.0;
        const defaultWidth = String(body.defaultWidth || '').trim();
        const imageUrl = String(body.imageUrl || '').trim();

        if (!name) return errorResponse('Item name is required', 400, env);

        // Audit Trail: Store user's actual Full Name instead of Role
        const authorName = (currentUser.fullName || currentUser.username || 'System Administrator').trim();

        await env.DB.prepare(`
          INSERT INTO items_master (id, name, description, unit, rate, default_width, image_url, created_by, created_by_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            unit = excluded.unit,
            rate = excluded.rate,
            default_width = excluded.default_width,
            image_url = excluded.image_url,
            updated_at = datetime("now")
        `).bind(id, name, description, unit, rate, defaultWidth, imageUrl, authorName, authorName).run();

        return jsonResponse({ success: true, message: 'Item saved', id }, 200, env);
      }
    }

    if (path.startsWith('/api/items/') && method === 'DELETE') {
      if (!isSuperAdmin && !currentUser.permissions?.canDeleteQuotes) {
        return errorResponse('Access denied: You do not have permission to delete items from Items Master', 403, env);
      }
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM items_master WHERE id = ?').bind(id).run();
      return jsonResponse({ success: true, message: 'Item deleted' }, 200, env);
    }

    // =================================================================
    // Multi-Company Management Endpoints (Up to 3 Distinct Profiles)
    // =================================================================
    // Multi-Company Profile Management Endpoints (Up to 3 Companies)
    // =================================================================
    if (path === '/api/companies') {
      // GET: List all company profiles (up to 3)
      if (method === 'GET') {
        let rows = await env.DB.prepare('SELECT * FROM company_settings ORDER BY is_default DESC, created_at ASC LIMIT 3').all().catch(() => ({ results: [] }));
        let list = rows.results || [];

        // If no records exist, seed the primary default profile
        if (list.length === 0) {
          try {
            await env.DB.prepare(`
              INSERT OR IGNORE INTO company_settings (
                id, company_name, tagline, address, phone, email, website, gstin,
                bank_name, account_name, account_number, ifsc_code, branch, terms_json, is_default, created_at, updated_at
              ) VALUES (
                'primary', 'Quotation Manager', 'Professional Quotation Management', 'Business Address Here',
                '+91 00000 00000', 'info@company.com', 'www.company.com', '24AAAAA0000A1Z5',
                'Primary Bank Name', 'Enterprise Account', '000000000000', 'BANK0000000', 'Main Branch',
                '["Customer will be billed after acceptance of this quote.","Payment terms as mutually agreed.","Transport & freight charges extra as applicable.","Subject to local jurisdiction."]',
                1, datetime('now'), datetime('now')
              )
            `).run();
            const recheck = await env.DB.prepare('SELECT * FROM company_settings WHERE id = "primary"').all();
            list = recheck.results || [];
          } catch (e) {}
        }

        const companies = list.map((c, idx) => {
          let banners = [];
          if (c.promotional_banners) {
            try {
              const p = JSON.parse(c.promotional_banners);
              if (Array.isArray(p)) banners = p;
            } catch (e) {}
          }
          if (banners.length === 0 && c.banner_url) {
            try {
              const p = JSON.parse(c.banner_url);
              if (Array.isArray(p)) {
                banners = p;
              } else if (typeof p === 'string' && p.trim()) {
                banners = [p.trim()];
              }
            } catch (e) {
              banners = [c.banner_url.trim()];
            }
          }
          banners = banners.filter(b => typeof b === 'string' && b.trim());

          return {
            id: c.id,
            companyName: c.company_name || 'Company Profile',
            name: c.company_name || 'Company Profile',
            tagline: c.tagline || '',
            subtitle: c.tagline || '',
            address: c.address || '',
            phone: c.phone || '',
            phoneSecondary: c.phone_secondary || '',
            email: c.email || '',
            website: c.website || '',
            gstin: c.gstin || '',
            state: c.state || 'Gujarat',
            stateCode: c.state_code || '24',
            bankName: c.bank_name || '',
            accountName: c.account_name || '',
            accountNumber: c.account_number || '',
            accountNo: c.account_number || '',
            ifscCode: c.ifsc_code || '',
            branch: c.branch || '',
            terms: JSON.parse(c.terms_json || '[]'),
            bannerUrl: banners[0] || c.banner_url || '',
            promotionalBanner: banners[0] || c.banner_url || '',
            bannerUrls: banners,
            promotionalBanners: banners,
            headerLogoUrl: c.company_logo || c.header_logo_url || '',
            companyLogo: c.company_logo || c.header_logo_url || '',
            company_logo: c.company_logo || c.header_logo_url || '',
            signatureImageUrl: c.signature_image_url || '',
            authorizedSignature: c.signature_image_url || '',
            signatureTitle: c.signature_title || 'Authorized Signatory',
            showSignatureInPdf: c.show_signature_in_pdf !== 0,
            showBannerInPdf: c.show_banner_in_pdf !== 0,
            isDefault: c.is_default === 1 || (idx === 0 && !list.some(x => x.is_default === 1)),
            createdAt: c.created_at,
            updatedAt: c.updated_at
          };
        });

        return jsonResponse({ success: true, companies }, 200, env);
      }

      // POST or PUT: Create or Update Company Profile (Max 3 Enforced)
      if (method === 'POST' || method === 'PUT') {
        if (!isSuperAdmin && !currentUser.permissions?.canManageSettings) {
          return errorResponse('Access denied: You do not have permission to manage company profiles', 403, env);
        }

        try {
          const body = await request.json();
          const id = (body.id && body.id !== 'new') ? String(body.id).trim() : ('comp_' + Date.now());
          const existing = await env.DB.prepare('SELECT id FROM company_settings WHERE id = ?').bind(id).first();

          // Enforce strict maximum limit of 3 companies on insert
          if (!existing) {
            const countStmt = env.DB.prepare('SELECT COUNT(*) as count FROM company_settings');
            const countRes = typeof countStmt.first === 'function' ? await countStmt.first() : await countStmt.bind().first();
            const currentCount = (countRes && (countRes.count ?? countRes.cnt)) ? parseInt(countRes.count ?? countRes.cnt, 10) : 0;
            if (currentCount >= 3) {
              return errorResponse('Maximum limit of 3 company profiles reached. You must edit or delete an existing profile.', 400, env);
            }
          }

          const companyName = String(body.companyName || body.name || 'Company Profile').trim();
          const tagline = String(body.tagline || body.subtitle || '').trim();
          const address = String(body.address || '').trim();
          const phone = String(body.phone || '').trim();
          const phoneSecondary = String(body.phoneSecondary || '').trim();
          const email = String(body.email || '').trim();
          const website = String(body.website || '').trim();
          const gstin = String(body.gstin || '').trim();
          const state = String(body.state || 'Gujarat').trim();
          const stateCode = String(body.stateCode || '24').trim();

          const bankName = String(body.bankName || '').trim();
          const accountName = String(body.accountName || '').trim();
          const accountNumber = String(body.accountNumber || body.accountNo || '').trim();
          const ifscCode = String(body.ifscCode || '').trim();
          const branch = String(body.branch || '').trim();

          const termsJson = JSON.stringify(body.terms || []);

          // Parse and sanitize multiple promotional banners (up to 6)
          let banners = [];
          if (Array.isArray(body.promotionalBanners)) {
            banners = body.promotionalBanners.filter(b => typeof b === 'string' && b.trim());
          } else if (Array.isArray(body.bannerUrls)) {
            banners = body.bannerUrls.filter(b => typeof b === 'string' && b.trim());
          } else if (typeof body.promotionalBanner === 'string' && body.promotionalBanner.trim()) {
            try {
              const p = JSON.parse(body.promotionalBanner);
              banners = Array.isArray(p) ? p.filter(b => typeof b === 'string' && b.trim()) : [body.promotionalBanner.trim()];
            } catch (e) {
              banners = [body.promotionalBanner.trim()];
            }
          } else if (typeof body.bannerUrl === 'string' && body.bannerUrl.trim()) {
            try {
              const p = JSON.parse(body.bannerUrl);
              banners = Array.isArray(p) ? p.filter(b => typeof b === 'string' && b.trim()) : [body.bannerUrl.trim()];
            } catch (e) {
              banners = [body.bannerUrl.trim()];
            }
          }
          if (banners.length > 12) banners = banners.slice(0, 12);

          // Store as JSON array string for multi-image, or fallback if empty
          const bannerUrl = banners.length > 0 ? JSON.stringify(banners) : '';
          const promotionalBannersJson = JSON.stringify(banners);

          const companyLogo = String(body.companyLogo || body.company_logo || body.headerLogoUrl || body.header_logo_url || '').trim();
          const headerLogoUrl = companyLogo;
          const signatureImageUrl = body.signatureImageUrl || body.authorizedSignature || '';
          const signatureTitle = body.signatureTitle || 'Authorized Signatory';
          const showSig = body.showSignatureInPdf !== false ? 1 : 0;
          const showBanner = body.showBannerInPdf !== false ? 1 : 0;
          let isDefault = body.isDefault ? 1 : 0;

          // If marked as default, clear default on other profiles
          if (isDefault) {
            try {
              await env.DB.prepare('UPDATE company_settings SET is_default = 0').run();
            } catch (e) {}
          } else {
            // If not marked default, verify at least one other company is default
            try {
              const otherDefault = await env.DB.prepare('SELECT id FROM company_settings WHERE is_default = 1 AND id != ?').bind(id).first();
              if (!otherDefault) {
                isDefault = 1; // Keep default if no other company is default
              }
            } catch (e) {}
          }

          await env.DB.prepare(`
            INSERT INTO company_settings (
              id, company_name, tagline, address, phone, phone_secondary, email, website, gstin, state, state_code,
              bank_name, account_name, account_number, ifsc_code, branch, terms_json,
              banner_url, header_logo_url, signature_image_url, signature_title,
              show_signature_in_pdf, show_banner_in_pdf, is_default, company_logo, created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?, datetime("now"), datetime("now")
            )
            ON CONFLICT(id) DO UPDATE SET
              company_name = excluded.company_name,
              tagline = excluded.tagline,
              address = excluded.address,
              phone = excluded.phone,
              phone_secondary = excluded.phone_secondary,
              email = excluded.email,
              website = excluded.website,
              gstin = excluded.gstin,
              state = excluded.state,
              state_code = excluded.state_code,
              bank_name = excluded.bank_name,
              account_name = excluded.account_name,
              account_number = excluded.account_number,
              ifsc_code = excluded.ifsc_code,
              branch = excluded.branch,
              terms_json = excluded.terms_json,
              banner_url = excluded.banner_url,
              header_logo_url = excluded.header_logo_url,
              signature_image_url = excluded.signature_image_url,
              signature_title = excluded.signature_title,
              show_signature_in_pdf = excluded.show_signature_in_pdf,
              show_banner_in_pdf = excluded.show_banner_in_pdf,
              is_default = excluded.is_default,
              company_logo = excluded.company_logo,
              updated_at = datetime("now")
          `).bind(
            id, companyName, tagline, address, phone, phoneSecondary, email, website, gstin, state, stateCode,
            bankName, accountName, accountNumber, ifscCode, branch, termsJson,
            bannerUrl, headerLogoUrl, signatureImageUrl, signatureTitle,
            showSig, showBanner, isDefault, companyLogo
          ).run();

          // Sync promotional_banners column if migrated
          try {
            await env.DB.prepare('UPDATE company_settings SET promotional_banners = ? WHERE id = ?').bind(promotionalBannersJson, id).run();
          } catch (e) {}

          return jsonResponse({
            success: true,
            message: 'Company profile saved successfully',
            id,
            company_logo: companyLogo,
            companyLogo
          }, 200, env);
        } catch (postErr) {
          console.error('[API /api/companies POST Error]:', postErr);
          return errorResponse(`Failed to save company profile: ${postErr.message || postErr}`, 500, env);
        }
      }
    }

    // DELETE /api/companies/:id
    if (path.startsWith('/api/companies/') && method === 'DELETE') {
      if (!isSuperAdmin && !currentUser.permissions?.canManageSettings) {
        return errorResponse('Access denied: You do not have permission to delete company profiles', 403, env);
      }
      const targetId = path.split('/').pop();
      const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM company_settings').first();
      const currentCount = (countRes && countRes.count) ? parseInt(countRes.count, 10) : 0;
      if (currentCount <= 1) {
        return errorResponse('Cannot delete the only remaining company profile.', 400, env);
      }

      await env.DB.prepare('DELETE FROM company_settings WHERE id = ?').bind(targetId).run();

      // Ensure at least one remaining company is marked default
      const defaultCheck = await env.DB.prepare('SELECT id FROM company_settings WHERE is_default = 1').first();
      if (!defaultCheck) {
        await env.DB.prepare('UPDATE company_settings SET is_default = 1 WHERE id IN (SELECT id FROM company_settings LIMIT 1)').run();
      }

      return jsonResponse({ success: true, message: 'Company profile deleted' }, 200, env);
    }

    // =================================================================
    // Settings & Company Settings Endpoints (100% White-Label)
    // =================================================================
    if (path === '/api/settings' || path === '/api/company-settings') {
      if (method === 'GET') {
        try {
          const csRow = await env.DB.prepare('SELECT * FROM company_settings WHERE id = "primary"').first();
          if (csRow) {
            return jsonResponse({
              success: true,
              settings: {
                company: {
                  name: csRow.company_name,
                  tagline: csRow.tagline,
                  address: csRow.address,
                  phone: csRow.phone,
                  phoneSecondary: csRow.phone_secondary,
                  email: csRow.email,
                  website: csRow.website,
                  gstin: csRow.gstin,
                  state: csRow.state,
                  stateCode: csRow.state_code
                },
                bank: {
                  bankName: csRow.bank_name,
                  accountName: csRow.account_name,
                  accountNumber: csRow.account_number,
                  ifscCode: csRow.ifsc_code,
                  branch: csRow.branch
                },
                terms: JSON.parse(csRow.terms_json || '[]'),
                media: {
                  companyLogo: csRow.company_logo || csRow.header_logo_url || '',
                  company_logo: csRow.company_logo || csRow.header_logo_url || '',
                  bannerUrl: csRow.banner_url,
                  headerLogoUrl: csRow.company_logo || csRow.header_logo_url || '',
                  signatureImageUrl: csRow.signature_image_url,
                  signatureTitle: csRow.signature_title,
                  showSignatureInPdf: csRow.show_signature_in_pdf === 1,
                  showBannerInPdf: csRow.show_banner_in_pdf === 1,
                  turnstileSiteKey: csRow.turnstile_site_key || ''
                },
                updatedAt: csRow.updated_at
              }
            }, 200, env);
          }
        } catch (e) {
          // Fallback to legacy settings table if company_settings table not yet migrated
        }

        const row = await env.DB.prepare('SELECT company_json, bank_json, terms_json, media_json, updated_at FROM settings WHERE id = "global"').first();
        if (row) {
          return jsonResponse({
            success: true,
            settings: {
              company: JSON.parse(row.company_json || '{}'),
              bank: JSON.parse(row.bank_json || '{}'),
              terms: JSON.parse(row.terms_json || '[]'),
              media: JSON.parse(row.media_json || '{}'),
              updatedAt: row.updated_at
            }
          }, 200, env);
        }
        return jsonResponse({ success: true, settings: null }, 200, env);
      }

      if (method === 'POST') {
        if (!isSuperAdmin && !currentUser.permissions?.canManageSettings) {
          return errorResponse('Access denied: You do not have permission to modify settings', 403, env);
        }
        const body = await request.json();
        const comp = body.company || {};
        const bank = body.bank || {};
        const terms = body.terms || [];
        const media = body.media || {};

        const companyJson = JSON.stringify(comp);
        const bankJson = JSON.stringify(bank);
        const termsJson = JSON.stringify(terms);
        const mediaJson = JSON.stringify(media);

        const compLogo = (comp.companyLogo || comp.company_logo || media.companyLogo || media.company_logo || media.headerLogoUrl || '').trim();

        // Try updating company_settings structured table
        try {
          await env.DB.prepare(`
            INSERT INTO company_settings (
              id, company_name, tagline, address, phone, phone_secondary, email, website, gstin, state, state_code,
              bank_name, account_name, account_number, ifsc_code, branch, terms_json,
              banner_url, header_logo_url, signature_image_url, signature_title,
              show_signature_in_pdf, show_banner_in_pdf, turnstile_site_key, company_logo, updated_at
            ) VALUES (
              'primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?, datetime("now")
            )
            ON CONFLICT(id) DO UPDATE SET
              company_name = excluded.company_name,
              tagline = excluded.tagline,
              address = excluded.address,
              phone = excluded.phone,
              phone_secondary = excluded.phone_secondary,
              email = excluded.email,
              website = excluded.website,
              gstin = excluded.gstin,
              state = excluded.state,
              state_code = excluded.state_code,
              bank_name = excluded.bank_name,
              account_name = excluded.account_name,
              account_number = excluded.account_number,
              ifsc_code = excluded.ifsc_code,
              branch = excluded.branch,
              terms_json = excluded.terms_json,
              banner_url = excluded.banner_url,
              header_logo_url = excluded.header_logo_url,
              signature_image_url = excluded.signature_image_url,
              signature_title = excluded.signature_title,
              show_signature_in_pdf = excluded.show_signature_in_pdf,
              show_banner_in_pdf = excluded.show_banner_in_pdf,
              turnstile_site_key = excluded.turnstile_site_key,
              company_logo = excluded.company_logo,
              updated_at = datetime("now")
          `).bind(
            comp.name || 'Quotation Manager', comp.tagline || '', comp.address || '', comp.phone || '', comp.phoneSecondary || '',
            comp.email || '', comp.website || '', comp.gstin || '', comp.state || '', comp.stateCode || '',
            bank.bankName || '', bank.accountName || '', bank.accountNumber || '', bank.ifscCode || '', bank.branch || '',
            termsJson,
            media.bannerUrl || '', compLogo, media.signatureImageUrl || '', media.signatureTitle || 'Authorized Signatory',
            media.showSignatureInPdf !== false ? 1 : 0, media.showBannerInPdf !== false ? 1 : 0, media.turnstileSiteKey || '', compLogo
          ).run();
        } catch (e) {
          // If company_settings doesn't exist yet, silently continue to legacy table
        }

        // Also update legacy settings table for backward compatibility
        try {
          await env.DB.prepare(`
            INSERT INTO settings (id, company_json, bank_json, terms_json, media_json, updated_at)
            VALUES ('global', ?, ?, ?, ?, datetime("now"))
            ON CONFLICT(id) DO UPDATE SET
              company_json = excluded.company_json,
              bank_json = excluded.bank_json,
              terms_json = excluded.terms_json,
              media_json = excluded.media_json,
              updated_at = datetime("now")
          `).bind(companyJson, bankJson, termsJson, mediaJson).run();
        } catch (e) {}

        return jsonResponse({ success: true, message: 'Company settings saved successfully' }, 200, env);
      }
    }

    // =================================================================
    // Cloudflare D1 Database Backup & Restore (Super Admin Only)
    // =================================================================
    if (path === '/api/backup/export' && method === 'GET') {
      if (!isSuperAdmin && !currentUser.permissions?.canBackupDatabase) {
        return errorResponse('Access denied: Only Super Admin can export database backups', 403, env);
      }

      try {
        const quotesRes = await env.DB.prepare('SELECT * FROM quotations ORDER BY date DESC, created_at DESC LIMIT 5000').all();
        const clientsRes = await env.DB.prepare('SELECT * FROM clients ORDER BY created_at DESC LIMIT 5000').all();
        const itemsRes = await env.DB.prepare('SELECT * FROM items_master ORDER BY name ASC LIMIT 5000').all();
        const companiesRes = await env.DB.prepare('SELECT * FROM company_settings ORDER BY is_default DESC, created_at ASC').all().catch(() => ({ results: [] }));
        const csRow = await env.DB.prepare('SELECT * FROM company_settings WHERE id = "primary"').first().catch(() => null);
        const sRow = await env.DB.prepare('SELECT * FROM settings WHERE id = "global"').first().catch(() => null);
        const usersRes = await env.DB.prepare('SELECT id, username, full_name, role, is_super_admin, permissions_json, created_at, updated_at FROM users').all().catch(() => ({ results: [] }));

        // Data-Only Export: Strip heavy image data so the backup .json is 100% lightweight data (no images)
        const sanitizedItems = (itemsRes.results || []).map(it => {
          const clean = { ...it };
          delete clean.image_url;
          delete clean.imageUrl;
          return clean;
        });

        const sanitizedQuotes = (quotesRes.results || []).map(q => {
          const clean = { ...q };
          if (clean.items_json) {
            try {
              const parsed = JSON.parse(clean.items_json);
              if (Array.isArray(parsed)) {
                clean.items_json = JSON.stringify(parsed.map(item => {
                  const itCopy = { ...item };
                  delete itCopy.imageUrl;
                  delete itCopy.image_url;
                  return itCopy;
                }));
              }
            } catch (e) {}
          }
          return clean;
        });

        const sanitizeCompany = (c) => {
          if (!c) return null;
          const clean = { ...c };
          clean.banner_url = '';
          clean.promotional_banners = '[]';
          clean.header_logo_url = '';
          clean.company_logo = '';
          clean.signature_image_url = '';
          delete clean.bannerUrl;
          delete clean.promotionalBanners;
          delete clean.bannerUrls;
          delete clean.headerLogoUrl;
          delete clean.companyLogo;
          delete clean.signatureImageUrl;
          delete clean.authorizedSignature;
          return clean;
        };

        const sanitizedCompanies = (companiesRes.results || []).map(sanitizeCompany);
        const sanitizedCompanySettings = sanitizeCompany(csRow);

        let sanitizedSettings = null;
        if (sRow) {
          sanitizedSettings = { ...sRow, media_json: '{}' };
        }

        const backupData = {
          version: '2.0.0',
          exportedAt: new Date().toISOString(),
          exportedBy: currentUser.username,
          service: 'Database Export',
          counts: {
            quotations: sanitizedQuotes.length,
            clients: clientsRes.results ? clientsRes.results.length : 0,
            items: sanitizedItems.length,
            companies: sanitizedCompanies.length,
            users: usersRes.results ? usersRes.results.length : 0
          },
          companySettings: sanitizedCompanySettings,
          companies: sanitizedCompanies,
          settings: sanitizedSettings,
          quotations: sanitizedQuotes,
          clients: clientsRes.results || [],
          items: sanitizedItems,
          users: usersRes.results || []
        };

        // Guarantee 100% pure data: strip any surviving data:image Base64 strings from entire export
        const cleanJsonString = JSON.stringify(backupData, null, 2)
          .replace(/data:image\/[^"'\s\\]+/g, '');

        return new Response(cleanJsonString, {
          status: 200,
          headers: {
            ...corsHeaders(env),
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="quotation_backup_${new Date().toISOString().split('T')[0]}.json"`
          }
        });
      } catch (err) {
        return errorResponse(`Database export failed: ${err.message}`, 500, env);
      }
    }

    if (path === '/api/backup/import' && method === 'POST') {
      if (!isSuperAdmin && !currentUser.permissions?.canBackupDatabase) {
        return errorResponse('Access denied: Only Super Admin can import database backups', 403, env);
      }

      try {
        const body = await request.json();
        const data = body.data || body;

        let importedQuotations = 0;
        let importedClients = 0;
        let importedItems = 0;
        const statements = [];

        // 1. Prepare Clients statements
        const clientsList = Array.isArray(data.clients) ? data.clients : [];
        for (const c of clientsList) {
          const id = c.id || ('cli_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
          const name = String(c.name || '').trim();
          if (!name) continue;
          const companyName = c.company_name || c.companyName || '';
          const phone = c.phone || '';
          const email = c.email || '';
          const address = c.address || '';
          const gstNumber = c.gst_number || c.gstNumber || '';
          const createdBy = c.created_by || c.createdBy || currentUser.userId;
          const createdByName = c.created_by_name || c.createdByName || currentUser.fullName;
          const createdAt = c.created_at || c.createdAt || new Date().toISOString();

          statements.push(env.DB.prepare(`
            INSERT INTO clients (id, name, company_name, phone, email, address, gst_number, created_by, created_by_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              company_name = excluded.company_name,
              phone = excluded.phone,
              email = excluded.email,
              address = excluded.address,
              gst_number = excluded.gst_number,
              updated_at = datetime("now")
          `).bind(id, name, companyName, phone, email, address, gstNumber, createdBy, createdByName, createdAt));
          importedClients++;
        }

        // 2. Prepare Items Master statements
        const itemsList = Array.isArray(data.items) ? data.items : (Array.isArray(data.items_master) ? data.items_master : []);
        for (const it of itemsList) {
          const id = it.id || ('item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
          const name = String(it.name || '').trim();
          if (!name) continue;
          const desc = it.description || '';
          const unit = it.unit || 'NOS';
          const rate = parseFloat(it.rate) || 0;
          const defaultWidth = it.default_width || it.defaultWidth || '3.50';
          const imageUrl = it.image_url || it.imageUrl || '';
          const createdBy = it.created_by || it.createdBy || currentUser.userId;
          const createdByName = it.created_by_name || it.createdByName || currentUser.fullName;
          const createdAt = it.created_at || it.createdAt || new Date().toISOString();

          statements.push(env.DB.prepare(`
            INSERT INTO items_master (id, name, description, unit, rate, default_width, image_url, created_by, created_by_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              unit = excluded.unit,
              rate = excluded.rate,
              default_width = excluded.default_width,
              image_url = COALESCE(NULLIF(excluded.image_url, ''), items_master.image_url),
              updated_at = datetime("now")
          `).bind(id, name, desc, unit, rate, String(defaultWidth), imageUrl, createdBy, createdByName, createdAt));
          importedItems++;
        }

        // 3. Prepare Quotations statements
        const quotesList = Array.isArray(data.quotations) ? data.quotations : [];
        for (const q of quotesList) {
          const id = q.id || ('qt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
          const quoteNumber = q.quote_number || q.quoteNumber || '';
          if (!quoteNumber) continue;

          const date = q.date || new Date().toISOString().split('T')[0];
          const validUntil = q.valid_until || q.validUntil || '';
          const clientId = q.client_id || q.clientId || null;
          const clientName = q.client_name || q.clientName || 'Valued Customer';
          const clientCompany = q.client_company || q.clientCompany || '';
          const clientPhone = q.client_phone || q.clientPhone || '';
          const clientEmail = q.client_email || q.clientEmail || '';
          const clientGst = q.client_gst || q.clientGst || '';
          const clientAddress = q.client_address || q.clientAddress || '';

          const itemsJson = typeof q.items_json === 'string' ? q.items_json : JSON.stringify(q.items || []);
          const calcsJson = typeof q.calculations_json === 'string' ? q.calculations_json : JSON.stringify(q.calculations || []);
          const addChargesJson = typeof q.additional_charges_json === 'string' ? q.additional_charges_json : JSON.stringify(q.additionalCharges || []);

          const materialTotal = parseFloat(q.material_total !== undefined ? q.material_total : q.materialTotal) || 0;
          const loadingCharges = parseFloat(q.loading_charges !== undefined ? q.loading_charges : q.loadingCharges) || 0;
          const chargesTotal = parseFloat(q.charges_total !== undefined ? q.charges_total : q.chargesTotal) || 0;
          const gstType = q.gst_type || q.gstType || 'CGST_SGST';
          const gstRate = parseFloat(q.gst_rate !== undefined ? q.gst_rate : q.gstRate) || 18.0;
          const gstAmount = parseFloat(q.gst_amount !== undefined ? q.gst_amount : q.gstAmount) || 0;
          const roundOff = parseFloat(q.round_off !== undefined ? q.round_off : q.roundOff) || 0;
          const grandTotal = parseFloat(q.grand_total !== undefined ? q.grand_total : q.grandTotal) || 0;
          const grandTotalWords = q.grand_total_words || q.grandTotalWords || '';
          const notes = q.notes || '';
          const status = q.status || 'Draft';
          const createdBy = q.created_by || q.createdBy || currentUser.userId;
          const createdByName = q.created_by_name || q.createdByName || currentUser.fullName;
          const createdAt = q.created_at || q.createdAt || new Date().toISOString();

          statements.push(env.DB.prepare(`
            INSERT INTO quotations (
              id, quote_number, date, valid_until, client_id, client_name, client_company,
              client_phone, client_email, client_gst, client_address,
              items_json, calculations_json, material_total, loading_charges,
              additional_charges_json, charges_total, gst_type, gst_rate, gst_amount,
              round_off, grand_total, grand_total_words, notes, status,
              created_by, created_by_name, created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, datetime("now")
            )
            ON CONFLICT(id) DO UPDATE SET
              quote_number = excluded.quote_number,
              date = excluded.date,
              valid_until = excluded.valid_until,
              client_id = excluded.client_id,
              client_name = excluded.client_name,
              client_company = excluded.client_company,
              client_phone = excluded.client_phone,
              client_email = excluded.client_email,
              client_gst = excluded.client_gst,
              client_address = excluded.client_address,
              items_json = excluded.items_json,
              calculations_json = excluded.calculations_json,
              material_total = excluded.material_total,
              loading_charges = excluded.loading_charges,
              additional_charges_json = excluded.additional_charges_json,
              charges_total = excluded.charges_total,
              gst_type = excluded.gst_type,
              gst_rate = excluded.gst_rate,
              gst_amount = excluded.gst_amount,
              round_off = excluded.round_off,
              grand_total = excluded.grand_total,
              grand_total_words = excluded.grand_total_words,
              notes = excluded.notes,
              status = excluded.status,
              updated_at = datetime("now")
          `).bind(
            id, quoteNumber, date, validUntil, clientId, clientName, clientCompany,
            clientPhone, clientEmail, clientGst, clientAddress,
            itemsJson, calcsJson, materialTotal, loadingCharges,
            addChargesJson, chargesTotal, gstType, gstRate, gstAmount,
            roundOff, grandTotal, grandTotalWords, notes, status,
            createdBy, createdByName, createdAt
          ));
          importedQuotations++;
        }

        // 4. Prepare Company Settings statements if present
        const companiesList = Array.isArray(data.companies) && data.companies.length > 0
          ? data.companies
          : (data.companySettings || data.company_settings ? [data.companySettings || data.company_settings] : []);

        for (const cs of companiesList) {
          const compId = cs.id || 'primary';
          statements.push(env.DB.prepare(`
            INSERT INTO company_settings (
              id, company_name, tagline, address, phone, phone_secondary, email, website, gstin, state, state_code,
              bank_name, account_name, account_number, ifsc_code, branch, terms_json,
              banner_url, promotional_banners, header_logo_url, signature_image_url, signature_title,
              show_signature_in_pdf, show_banner_in_pdf, turnstile_site_key, is_default, company_logo, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, datetime("now")
            )
            ON CONFLICT(id) DO UPDATE SET
              company_name = excluded.company_name,
              tagline = excluded.tagline,
              address = excluded.address,
              phone = excluded.phone,
              phone_secondary = excluded.phone_secondary,
              email = excluded.email,
              website = excluded.website,
              gstin = excluded.gstin,
              state = excluded.state,
              state_code = excluded.state_code,
              bank_name = excluded.bank_name,
              account_name = excluded.account_name,
              account_number = excluded.account_number,
              ifsc_code = excluded.ifsc_code,
              branch = excluded.branch,
              terms_json = excluded.terms_json,
              banner_url = COALESCE(NULLIF(excluded.banner_url, ''), company_settings.banner_url),
              promotional_banners = CASE WHEN excluded.promotional_banners != '[]' AND excluded.promotional_banners != '' THEN excluded.promotional_banners ELSE company_settings.promotional_banners END,
              header_logo_url = COALESCE(NULLIF(excluded.header_logo_url, ''), company_settings.header_logo_url),
              company_logo = COALESCE(NULLIF(excluded.company_logo, ''), company_settings.company_logo),
              signature_image_url = COALESCE(NULLIF(excluded.signature_image_url, ''), company_settings.signature_image_url),
              signature_title = excluded.signature_title,
              show_signature_in_pdf = excluded.show_signature_in_pdf,
              show_banner_in_pdf = excluded.show_banner_in_pdf,
              turnstile_site_key = excluded.turnstile_site_key,
              is_default = excluded.is_default,
              updated_at = datetime("now")
          `).bind(
            compId,
            cs.company_name || cs.companyName || 'Quotation Manager',
            cs.tagline || '',
            cs.address || '',
            cs.phone || '',
            cs.phone_secondary || cs.phoneSecondary || '',
            cs.email || '',
            cs.website || '',
            cs.gstin || '',
            cs.state || 'Gujarat',
            cs.state_code || cs.stateCode || '24',
            cs.bank_name || cs.bankName || '',
            cs.account_name || cs.accountName || '',
            cs.account_number || cs.accountNumber || '',
            cs.ifsc_code || cs.ifscCode || '',
            cs.branch || '',
            typeof cs.terms_json === 'string' ? cs.terms_json : JSON.stringify(cs.terms || []),
            cs.banner_url || cs.bannerUrl || '',
            typeof cs.promotional_banners === 'string' ? cs.promotional_banners : JSON.stringify(cs.promotionalBanners || cs.bannerUrls || []),
            cs.header_logo_url || cs.headerLogoUrl || '',
            cs.signature_image_url || cs.signatureImageUrl || '',
            cs.signature_title || cs.signatureTitle || 'Authorized Signatory',
            cs.show_signature_in_pdf !== undefined ? (cs.show_signature_in_pdf ? 1 : 0) : 1,
            cs.show_banner_in_pdf !== undefined ? (cs.show_banner_in_pdf ? 1 : 0) : 1,
            cs.turnstile_site_key || cs.turnstileSiteKey || '',
            cs.is_default ? 1 : 0,
            cs.company_logo || cs.companyLogo || cs.header_logo_url || cs.headerLogoUrl || ''
          ));
        }

        // Execute all collected statements in atomic D1 batches (chunks of 50)
        const BATCH_SIZE = 50;
        for (let i = 0; i < statements.length; i += BATCH_SIZE) {
          const chunk = statements.slice(i, i + BATCH_SIZE);
          if (chunk.length > 0) {
            await env.DB.batch(chunk);
          }
        }

        return jsonResponse({
          success: true,
          message: `Database successfully restored! (${importedQuotations} quotations, ${importedClients} clients, ${importedItems} items imported)`,
          counts: {
            quotations: importedQuotations,
            clients: importedClients,
            items: importedItems
          }
        }, 200, env);
      } catch (err) {
        return errorResponse(`Database import failed: ${err.message}`, 500, env);
      }
    }

    // Default 404
    return errorResponse(`Endpoint not found: ${method} ${path}`, 404, env);
    } catch (unhandledErr) {
      console.error('[Worker Fatal Error]:', unhandledErr);
      return errorResponse(unhandledErr.message || String(unhandledErr), 500, env);
    }
  }
};
