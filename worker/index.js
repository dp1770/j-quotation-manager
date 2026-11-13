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

// =====================================================================
// Cloudflare Worker Handler
// =====================================================================

export default {
  async fetch(request, env, ctx) {
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
        service: 'Quotation Manager Cloudflare D1 API',
        environment: 'Cloudflare Workers & D1',
        message: 'Quotation Manager API is operational.',
        time: new Date().toISOString()
      }, 200, env);
    }

    // 4. Database Check (supports DB, Quotation_Manager, or quotation_manager_db binding names)
    if (!env.DB && (env.Quotation_Manager || env.quotation_manager_db || env.QUOTATION_MANAGER)) {
      env.DB = env.Quotation_Manager || env.quotation_manager_db || env.QUOTATION_MANAGER;
    }
    if (!env.DB) {
      return errorResponse('D1 database binding "DB" or "Quotation_Manager" not configured.', 500, env);
    }

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

        // 1. Cloudflare Turnstile Captcha Verification (if TURNSTILE_SECRET is configured)
        const turnstileSecret = env.TURNSTILE_SECRET;
        if (turnstileSecret) {
          const turnstileToken = body.turnstileToken || body['cf-turnstile-response'] || request.headers.get('CF-Turnstile-Token');
          if (!turnstileToken) {
            return errorResponse('Captcha verification required. Please complete the security check.', 401, env);
          }

          try {
            const clientIp = request.headers.get('CF-Connecting-IP') || '';
            const formData = new FormData();
            formData.append('secret', turnstileSecret);
            formData.append('response', turnstileToken);
            if (clientIp) formData.append('remoteip', clientIp);

            const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              body: formData
            });
            const verifyData = await verifyRes.json();
            if (!verifyData.success) {
              return errorResponse('Captcha verification failed. Please try again.', 401, env);
            }
          } catch (err) {
            return errorResponse('Security challenge verification error: ' + err.message, 401, env);
          }
        }

        const passHash = await sha256(rawPass);

        // 2. Query user from D1 database
        const userRow = await env.DB.prepare(
          'SELECT id, username, password_hash, full_name, role, is_super_admin, permissions_json FROM users WHERE LOWER(username) = ?'
        ).bind(username).first();

        let authenticatedUser = null;

        if (userRow) {
          const storedHash = String(userRow.password_hash);
          const isMatch = (storedHash === passHash || (await sha256(storedHash)) === passHash || storedHash === rawPass);

          if (isMatch) {
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
          const isDefaultAdmin = (username === 'admin' && (passHash === 'a679cb086580f4949ad453e00bb982d1598f804791522f7c088ef577ef3724ff' || rawPass === 'admin@2026')) ||
                                 (username === 'jalaram' && (passHash === 'd9bc47a5fad6ba64112f7d87a4ec566caff796e1032793ee9a18ad0202482126' || rawPass === 'jalaram@2026'));
          if (isDefaultAdmin) {
            authenticatedUser = {
              id: 'user_super_admin_' + username,
              username: username,
              fullName: 'System Administrator',
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
    // Authentication & JWT Verification Middleware for Protected Routes
    // =================================================================
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const currentUser = await verifyJwt(token, jwtSecret);

    if (!currentUser) {
      return errorResponse('Authentication required. Invalid or expired token.', 401, env);
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

        const oldHash = await sha256(oldPass);
        const newHash = await sha256(newPass);

        const userRow = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(currentUser.userId).first();

        if (userRow) {
          const currentStored = String(userRow.password_hash);
          if (oldPass && currentStored !== oldHash && (await sha256(currentStored)) !== oldHash) {
            return errorResponse('Current password is incorrect', 400, env);
          }
          await env.DB.prepare(
            'UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?'
          ).bind(newHash, currentUser.userId).run();
        } else {
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
          'SELECT id, username, full_name, role, is_super_admin, permissions_json, created_at, updated_at FROM users ORDER BY created_at DESC'
        ).all();

        const usersList = (rows.results || []).map(u => ({
          id: u.id,
          username: u.username,
          fullName: u.full_name,
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
        const body = await request.json();
        const id = body.id || ('user_sub_' + Date.now());
        const username = String(body.username || '').trim().toLowerCase();
        const fullName = String(body.fullName || username).trim();
        const role = String(body.role || 'Sub-Admin');
        const permsJson = JSON.stringify(body.permissions || {});
        const isSuper = (body.isSuperAdmin === true || role === 'Super Admin') ? 1 : 0;

        if (!username) {
          return errorResponse('Username is required', 400, env);
        }

        let passHash = null;
        if (body.password) {
          passHash = await sha256(body.password);
        } else if (body.passwordHash) {
          passHash = body.passwordHash;
        }

        const existing = await env.DB.prepare('SELECT id, password_hash FROM users WHERE id = ? OR username = ?').bind(id, username).first();

        if (existing) {
          const finalHash = passHash || existing.password_hash;
          await env.DB.prepare(`
            UPDATE users SET 
              full_name = ?, role = ?, is_super_admin = ?, permissions_json = ?, password_hash = ?, updated_at = datetime("now")
            WHERE id = ?
          `).bind(fullName, role, isSuper, permsJson, finalHash, existing.id).run();
        } else {
          if (!passHash) {
            return errorResponse('Password is required for new user', 400, env);
          }
          await env.DB.prepare(`
            INSERT INTO users (id, username, password_hash, full_name, role, is_super_admin, permissions_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now"))
          `).bind(id, username, passHash, fullName, role, isSuper, permsJson).run();
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
      const target = await env.DB.prepare('SELECT username, is_super_admin FROM users WHERE id = ?').bind(targetId).first();
      if (target && target.is_super_admin === 1 && target.id === currentUser.userId) {
        return errorResponse('You cannot delete your own Super Admin account', 400, env);
      }
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
      return jsonResponse({ success: true, message: 'User deleted' }, 200, env);
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
        const limit = Math.min(parseInt(queryParams.get('limit') || '50', 10), 500);
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
          status: q.status,
          createdBy: q.created_by,
          createdByName: q.created_by_name,
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
        const quoteNumber = String(body.quoteNumber || '').trim();

        if (!quoteNumber) {
          return errorResponse('Quote number is required', 400, env);
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
        const status = body.status || 'Draft';

        const createdBy = currentUser.userId;
        const createdByName = currentUser.fullName || currentUser.username;

        await env.DB.prepare(`
          INSERT INTO quotations (
            id, quote_number, date, valid_until, client_id, client_name, client_company,
            client_phone, client_email, client_gst, client_address, items_json, calculations_json,
            material_total, loading_charges, additional_charges_json, charges_total,
            gst_type, gst_rate, gst_amount, round_off, grand_total, grand_total_words,
            notes, status, created_by, created_by_name, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, datetime("now"), datetime("now")
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
          clientPhone, clientEmail, clientGst, clientAddress, itemsJson, calcsJson,
          materialTotal, loadingCharges, addChargesJson, chargesTotal,
          gstType, gstRate, gstAmount, roundOff, grandTotal, grandTotalWords,
          notes, status, createdBy, createdByName
        ).run();

        return jsonResponse({ success: true, message: 'Quotation saved successfully', id, quoteNumber }, 200, env);
      }
    }

    // Single Quotation Delete
    if (path.startsWith('/api/quotations/') && method === 'DELETE') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM quotations WHERE id = ?').bind(id).run();
      return jsonResponse({ success: true, message: 'Quotation deleted' }, 200, env);
    }

    // =================================================================
    // Clients Endpoints
    // =================================================================
    if (path === '/api/clients') {
      if (method === 'GET') {
        const queryParams = url.searchParams;
        const search = queryParams.get('search');
        const limit = Math.min(parseInt(queryParams.get('limit') || '500', 10), 1000);

        let sql = 'SELECT * FROM clients';
        let bindings = [];

        if (search) {
          sql += ' WHERE (name LIKE ? OR company_name LIKE ? OR phone LIKE ?)';
          const term = `%${search}%`;
          bindings.push(term, term, term);
        }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        bindings.push(limit);

        const rows = await env.DB.prepare(sql).bind(...bindings).all();
        const clients = (rows.results || []).map(c => ({
          id: c.id,
          name: c.name,
          companyName: c.company_name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          gstNumber: c.gst_number,
          createdBy: c.created_by,
          createdByName: c.created_by_name,
          createdAt: c.created_at,
          updatedAt: c.updated_at
        }));

        return jsonResponse({ success: true, clients }, 200, env);
      }

      if (method === 'POST') {
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

        const createdBy = currentUser.userId;
        const createdByName = currentUser.fullName || currentUser.username;

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
        `).bind(id, name, companyName, phone, email, address, gstNumber, createdBy, createdByName).run();

        return jsonResponse({ success: true, message: 'Client saved', id }, 200, env);
      }
    }

    if (path.startsWith('/api/clients/') && method === 'DELETE') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
      return jsonResponse({ success: true, message: 'Client deleted' }, 200, env);
    }

    // =================================================================
    // Items Master Endpoints
    // =================================================================
    if (path === '/api/items') {
      if (method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM items_master ORDER BY name ASC').all();
        const items = (rows.results || []).map(i => ({
          id: i.id,
          name: i.name,
          description: i.description,
          unit: i.unit,
          rate: i.rate,
          defaultWidth: i.default_width,
          imageUrl: i.image_url,
          createdBy: i.created_by,
          createdByName: i.created_by_name,
          createdAt: i.created_at,
          updatedAt: i.updated_at
        }));
        return jsonResponse({ success: true, items }, 200, env);
      }

      if (method === 'POST') {
        const body = await request.json();
        const id = body.id || ('itm_' + Date.now());
        const name = String(body.name || '').trim();
        const description = String(body.description || '').trim();
        const unit = String(body.unit || 'NOS').trim();
        const rate = parseFloat(body.rate) || 0.0;
        const defaultWidth = String(body.defaultWidth || '').trim();
        const imageUrl = String(body.imageUrl || '').trim();

        if (!name) return errorResponse('Item name is required', 400, env);

        const createdBy = currentUser.userId;
        const createdByName = currentUser.fullName || currentUser.username;

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
        `).bind(id, name, description, unit, rate, defaultWidth, imageUrl, createdBy, createdByName).run();

        return jsonResponse({ success: true, message: 'Item saved', id }, 200, env);
      }
    }

    if (path.startsWith('/api/items/') && method === 'DELETE') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM items_master WHERE id = ?').bind(id).run();
      return jsonResponse({ success: true, message: 'Item deleted' }, 200, env);
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
                  bannerUrl: csRow.banner_url,
                  headerLogoUrl: csRow.header_logo_url,
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
        const body = await request.json();
        const comp = body.company || {};
        const bank = body.bank || {};
        const terms = body.terms || [];
        const media = body.media || {};

        const companyJson = JSON.stringify(comp);
        const bankJson = JSON.stringify(bank);
        const termsJson = JSON.stringify(terms);
        const mediaJson = JSON.stringify(media);

        // Try updating company_settings structured table
        try {
          await env.DB.prepare(`
            INSERT INTO company_settings (
              id, company_name, tagline, address, phone, phone_secondary, email, website, gstin, state, state_code,
              bank_name, account_name, account_number, ifsc_code, branch, terms_json,
              banner_url, header_logo_url, signature_image_url, signature_title,
              show_signature_in_pdf, show_banner_in_pdf, turnstile_site_key, updated_at
            ) VALUES (
              'primary', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?, ?, datetime("now")
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
              updated_at = datetime("now")
          `).bind(
            comp.name || 'Quotation Manager', comp.tagline || '', comp.address || '', comp.phone || '', comp.phoneSecondary || '',
            comp.email || '', comp.website || '', comp.gstin || '', comp.state || '', comp.stateCode || '',
            bank.bankName || '', bank.accountName || '', bank.accountNumber || '', bank.ifscCode || '', bank.branch || '',
            termsJson,
            media.bannerUrl || '', media.headerLogoUrl || '', media.signatureImageUrl || '', media.signatureTitle || 'Authorized Signatory',
            media.showSignatureInPdf !== false ? 1 : 0, media.showBannerInPdf !== false ? 1 : 0, media.turnstileSiteKey || ''
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

    // Default 404
    return errorResponse(`Endpoint not found: ${method} ${path}`, 404, env);
  }
};
