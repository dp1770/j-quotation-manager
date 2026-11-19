import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const TEST_SECRET = 'super-secret-key-that-is-at-least-32-chars-long-123456';

// Helper to create a signed test JWT
async function createTestToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(payload)}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(TEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  const sigB64 = Buffer.from(signature).toString('base64url');
  return `${unsigned}.${sigB64}`;
}

// Mock D1 environment
function createMockEnv(overrides = {}) {
  return {
    JWT_SECRET: TEST_SECRET,
    CORS_ALLOW_ORIGIN: '*',
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id FROM quotations WHERE id = ?')) {
                  return args[0] === 'existing-quote-id' ? { id: 'existing-quote-id' } : null;
                }
                if (sql.includes('SELECT username, is_super_admin FROM users WHERE id = ?')) {
                  return { username: 'testuser', is_super_admin: 1 };
                }
                return null;
              },
              async all() {
                return { results: [] };
              },
              async run() {
                return { success: true };
              }
            };
          }
        };
      },
      async batch(stmts) {
        return stmts.map(() => ({ success: true }));
      }
    },
    MEDIA_BUCKET: {
      _files: new Map(),
      async put(key, value, opts = {}) {
        this._files.set(key, { value, opts });
        return { key };
      },
      async get(key) {
        if (!this._files.has(key)) return null;
        const item = this._files.get(key);
        return {
          body: item.value,
          httpEtag: '"mock-etag"',
          writeHttpMetadata(headers) {
            if (item.opts?.httpMetadata?.contentType) {
              headers.set('Content-Type', item.opts.httpMetadata.contentType);
            }
          }
        };
      }
    },
    ...overrides
  };
}

test('POST /api/users: Sub-admin is forbidden from managing users (403)', async () => {
  const token = await createTestToken({
    userId: 'user_sub_1',
    username: 'subadmin',
    isSuperAdmin: false,
    permissions: { canManageUsers: true } // even if forged in permissions object
  });

  const req = new Request('https://example.com/api/users', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username: 'newuser', password: 'password123' })
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /Only Super Admin can manage users/i);
});

test('DELETE /api/users/:id: Super Admin cannot delete own account (400)', async () => {
  const token = await createTestToken({
    userId: 'admin_123',
    username: 'admin',
    isSuperAdmin: true
  });

  const req = new Request('https://example.com/api/users/admin_123', {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /cannot delete your own Super Admin account/i);
});

test('POST /api/quotations: Sub-admin without canCreateQuotations cannot create quote (403)', async () => {
  const token = await createTestToken({
    userId: 'sub_1',
    username: 'subadmin',
    isSuperAdmin: false,
    permissions: { canCreateQuotations: false, canEditQuotes: false }
  });

  const req = new Request('https://example.com/api/quotations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ id: 'new-quote-1', quoteNumber: 'QT-001' })
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /do not have permission to create quotations/i);
});

test('POST /api/quotations: Sub-admin without canEditQuotes cannot edit existing quote (403)', async () => {
  const token = await createTestToken({
    userId: 'sub_1',
    username: 'subadmin',
    isSuperAdmin: false,
    permissions: { canCreateQuotations: false, canEditQuotes: false }
  });

  const req = new Request('https://example.com/api/quotations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ id: 'existing-quote-id', quoteNumber: 'QT-999' })
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /do not have permission to edit quotations/i);
});

test('DELETE /api/quotations/:id: Sub-admin without canDeleteQuotes is forbidden (403)', async () => {
  const token = await createTestToken({
    userId: 'sub_1',
    username: 'subadmin',
    isSuperAdmin: false,
    permissions: { canDeleteQuotes: false }
  });

  const req = new Request('https://example.com/api/quotations/quote_123', {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 403);
});

test('DELETE /api/clients/:id: Sub-admin with canManageClients but without canDeleteQuotes is forbidden (403)', async () => {
  const token = await createTestToken({
    userId: 'sub_1',
    username: 'subadmin',
    isSuperAdmin: false,
    permissions: { canManageClients: true, canDeleteQuotes: false }
  });

  const req = new Request('https://example.com/api/clients/cli_123', {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /do not have permission to delete clients/i);
});

test('DELETE /api/items/:id: Sub-admin with canManageItems but without canDeleteQuotes is forbidden (403)', async () => {
  const token = await createTestToken({
    userId: 'sub_1',
    username: 'subadmin',
    isSuperAdmin: false,
    permissions: { canManageItems: true, canDeleteQuotes: false }
  });

  const req = new Request('https://example.com/api/items/itm_123', {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /do not have permission to delete items/i);
});

test('POST /api/settings: Sub-admin without canManageSettings is forbidden (403)', async () => {
  const token = await createTestToken({
    userId: 'sub_1',
    username: 'subadmin',
    isSuperAdmin: false,
    permissions: { canManageSettings: false }
  });

  const req = new Request('https://example.com/api/settings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ company: { name: 'Hacked' } })
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /do not have permission to modify settings/i);
});

test('POST /api/backup/import: Executes batch import of quotations, clients, and items', async () => {
  let batchCalls = 0;
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  const customEnv = createMockEnv({
    DB: {
      prepare() {
        return {
          bind() {
            return { sql: 'mock-statement' };
          }
        };
      },
      async batch(stmts) {
        batchCalls++;
        return stmts.map(() => ({ success: true }));
      }
    }
  });

  const req = new Request('https://example.com/api/backup/import', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clients: [{ id: 'c1', name: 'Client 1' }],
      items: [{ id: 'i1', name: 'Item 1' }],
      quotations: [{ id: 'q1', quoteNumber: 'QT-1' }]
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.counts.quotations, 1);
  assert.equal(body.counts.clients, 1);
  assert.equal(body.counts.items, 1);
  assert.ok(batchCalls >= 1, 'env.DB.batch must be called');
});

test('GET /api/backup/export: Skips and strips all image fields so exported JSON is pure data', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async all() {
            if (sql.includes('FROM items_master')) {
              return { results: [{ id: 'i1', name: 'Sheet', image_url: 'data:image/jpeg;base64,AAA...' }] };
            }
            if (sql.includes('FROM quotations')) {
              return { results: [{ id: 'q1', quote_number: 'QT-1', items_json: JSON.stringify([{ name: 'Sheet', imageUrl: 'data:image/jpeg;base64,BBB...' }]) }] };
            }
            if (sql.includes('FROM company_settings')) {
              return { results: [{ id: 'primary', company_name: 'Test Co', banner_url: 'data:image/jpeg;base64,CCC...', signature_image_url: 'data:image/png;base64,DDD...' }] };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes('company_settings WHERE id = "primary"')) {
              return { id: 'primary', company_name: 'Test Co', banner_url: 'data:image/jpeg;base64,CCC...' };
            }
            if (sql.includes('settings WHERE id = "global"')) {
              return {
                id: 'global',
                company_json: '{"name":"Test"}',
                bank_json: '{}',
                terms_json: '[]',
                media_json: '{"bannerUrl":"[\\"data:image/jpeg;base64,EEE...\\"]"}'
              };
            }
            return null;
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/backup/export', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const data = await res.json();
  // Items must not contain image_url
  assert.equal(data.items[0].image_url, undefined);
  // Quotation line items must not contain imageUrl
  const quoteItems = JSON.parse(data.quotations[0].items_json);
  assert.equal(quoteItems[0].imageUrl, undefined);
  // Company settings must have empty image fields
  assert.equal(data.companies[0].banner_url, '');
  assert.equal(data.companies[0].signature_image_url, '');
  // Legacy settings media_json must be stripped to empty object
  assert.equal(data.settings.media_json, '{}');
  // Entire exported payload must have zero data:image occurrences
  assert.ok(!JSON.stringify(data).includes('data:image/'));
});

test('POST /api/auth/login: Rejects unhashed plaintext stored password', async () => {
  const customEnv = createMockEnv({
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                // User row where password_hash was stored in plaintext as 'plainPass123'
                return {
                  id: 'u1',
                  username: 'insecure_user',
                  password_hash: 'plainPass123',
                  full_name: 'Test Insecure',
                  role: 'Sub-Admin',
                  is_super_admin: 0,
                  permissions_json: '{}'
                };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'insecure_user', password: 'plainPass123' })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.match(body.error, /invalid username or password/i);
});

test('POST /api/auth/forgot-password: Generates 6-digit OTP for registered user', async () => {
  let insertedReset = null;
  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id, username, full_name FROM users')) {
                  return { id: 'u123', username: 'john_doe', full_name: 'John Doe' };
                }
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO password_resets')) {
                  insertedReset = { id: args[0], email: args[1], otpHash: args[2], expiresAt: args[3] };
                }
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'john@example.com' })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(insertedReset, 'password_resets record must be inserted');
  assert.equal(insertedReset.email, 'john@example.com');
  assert.ok(insertedReset.expiresAt > Date.now());
});

test('POST /api/auth/reset-password: Validates OTP and updates user password', async () => {
  let updatedPasswordHash = null;
  let otpMarkedUsed = false;

  // Let's compute SHA-256 of OTP '654321'
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode('654321'));
  const otpHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('FROM password_resets')) {
                  return { id: 'reset_1', expires_at: Date.now() + 500000, used: 0, otp_hash: otpHash, attempts: 0 };
                }
                if (sql.includes('SELECT id, username FROM users')) {
                  return { id: 'u123', username: 'john_doe' };
                }
                return null;
              },
              async run() {
                if (sql.includes('UPDATE users SET password_hash =')) {
                  updatedPasswordHash = args[0];
                }
                if (sql.includes('UPDATE password_resets SET used = 1')) {
                  otpMarkedUsed = true;
                }
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'john@example.com',
      otp: '654321',
      newPassword: 'newSecretPassword123'
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(updatedPasswordHash, 'Password hash must be updated');
  assert.equal(otpMarkedUsed, true, 'OTP must be marked as used');
});

test('POST /api/users/reset-password: Super Admin can directly reset Sub-Admin password without current password', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  let updatedHash = null;
  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (sql.includes('UPDATE users SET password_hash =')) {
                  updatedHash = args[0];
                }
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/users/reset-password', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId: 'user_sub_999',
      newPassword: 'brandNewPassword999'
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(updatedHash, 'Password hash must be updated directly by Super Admin');
});

test('POST /api/quotations: Saves author full name in created_by and created_by_name', async () => {
  const token = await createTestToken({
    userId: 'user_123',
    username: 'rpatel',
    fullName: 'Ramesh Patel',
    isSuperAdmin: true,
    permissions: { canCreateQuotations: true }
  });

  let savedCreatedBy = null;
  let savedCreatedByName = null;

  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id FROM quotations')) return null;
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO quotations')) {
                  savedCreatedBy = args[28];
                  savedCreatedByName = args[29];
                }
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/quotations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'q_test_1',
      quoteNumber: 'QT-2026-999',
      clientCompany: 'ABC Corp',
      grandTotal: 5000
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  assert.equal(savedCreatedBy, 'Ramesh Patel');
  assert.equal(savedCreatedByName, 'Ramesh Patel');
});

test('POST /api/companies: Enforces maximum limit of 3 company profiles (400)', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id FROM company_settings WHERE id = ?')) return null;
                if (sql.includes('COUNT')) return { count: 3 };
                return null;
              },
              async run() {
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/companies', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'comp_4',
      companyName: 'Fourth Company'
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Maximum.*3 company profiles/i);
});

test('POST /api/companies: Successfully saves company profile with banner preference and default flag (200)', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  let savedCompanyId = null;
  let savedShowBanner = null;
  let savedIsDefault = null;

  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          first() {
            if (sql.includes('COUNT')) return { count: 1 };
            return null;
          },
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id FROM company_settings WHERE id = ?')) return null;
                if (sql.includes('COUNT')) return { count: 1 };
                if (sql.includes('WHERE is_default = 1')) return { id: 'primary' };
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO company_settings')) {
                  savedCompanyId = args[0];
                  savedShowBanner = args[22];
                  savedIsDefault = args[23];
                }
                return { success: true };
              }
            };
          },
          async run() {
            return { success: true };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/companies', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'comp_test_2',
      companyName: 'Balaji Industries Ltd',
      showBannerInPdf: true,
      isDefault: true
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(savedCompanyId, 'comp_test_2');
  assert.equal(savedShowBanner, 1);
  assert.equal(savedIsDefault, 1);
});

test('POST /api/companies: Saves and parses multiple promotional banner images as JSON array', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  let savedBannersJson = null;

  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          first() {
            if (sql.includes('COUNT')) return { count: 1 };
            return null;
          },
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id FROM company_settings WHERE id = ?')) return null;
                if (sql.includes('COUNT')) return { count: 1 };
                if (sql.includes('WHERE is_default = 1')) return { id: 'primary' };
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO company_settings')) {
                  savedBannersJson = args[17];
                }
                return { success: true };
              }
            };
          },
          async run() {
            return { success: true };
          }
        };
      }
    }
  });

  const testBanners = [
    'data:image/jpeg;base64,IMAGE_ONE_DATA',
    'data:image/jpeg;base64,IMAGE_TWO_DATA',
    'data:image/jpeg;base64,IMAGE_THREE_DATA'
  ];

  const req = new Request('https://example.com/api/companies', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'comp_test_banners',
      companyName: 'Multi Banner Test Corp',
      promotionalBanners: testBanners,
      showBannerInPdf: true,
      isDefault: false
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  assert.ok(savedBannersJson, 'savedBannersJson should not be null');
  const parsedSaved = JSON.parse(savedBannersJson);
  assert.equal(Array.isArray(parsedSaved), true);
  assert.equal(parsedSaved.length, 3);
  assert.equal(parsedSaved[0], testBanners[0]);
  assert.equal(parsedSaved[2], testBanners[2]);
});

test('POST /api/users: Saves user email and preserves Super Admin role on edit', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  let updatedEmail = null;
  let updatedRole = null;
  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id, password_hash, is_super_admin, role FROM users')) {
                  return { id: 'admin_1', is_super_admin: 1, role: 'Super Admin', password_hash: 'hash123' };
                }
                return null;
              },
              async run() {
                if (sql.includes('UPDATE users SET')) {
                  updatedEmail = args[1];
                  updatedRole = args[2];
                }
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/users', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'admin_1',
      username: 'admin',
      fullName: 'Super Administrator',
      email: 'new_admin@company.com',
      role: 'Sub-Admin' // Attempt to demote Super Admin via edit
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  assert.equal(updatedEmail, 'new_admin@company.com');
  assert.equal(updatedRole, 'Super Admin', 'Super Admin role must be preserved');
});

test('POST /api/auth/reset-password: Rate limits after 5 failed OTP attempts (400)', async () => {
  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('FROM password_resets')) {
                  return { id: 'reset_locked', expires_at: Date.now() + 500000, used: 0, attempts: 5, otp_hash: 'expected_hash' };
                }
                return null;
              },
              async run() {
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'locked@example.com',
      otp: '111111',
      newPassword: 'newSecretPassword123'
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /too many failed attempts/i);
});

test('POST /api/quotations: Atomically assigns next sequential quote number on collision', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true,
    permissions: { canCreateQuotations: true }
  });

  let savedQuoteNumber = null;
  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id FROM quotations WHERE id = ?')) return null;
                if (sql.includes('SELECT id FROM quotations WHERE quote_number = ?')) {
                  return { id: 'other_quote_id' };
                }
                return null;
              },
              async all() {
                if (sql.includes('SELECT quote_number FROM quotations WHERE quote_number LIKE ?')) {
                  return { results: [{ quote_number: 'QT-2026-0005' }] };
                }
                return { results: [] };
              },
              async run() {
                if (sql.includes('INSERT INTO quotations')) {
                  savedQuoteNumber = args[1];
                }
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/quotations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'qt_new_collision_test',
      quoteNumber: 'QT-2026-0005',
      clientName: 'Test Client',
      grandTotal: 1000
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.quoteNumber, 'QT-2026-0006');
  assert.equal(savedQuoteNumber, 'QT-2026-0006');
});

test('POST /api/quotations: Saves include_banner preference (0 or 1)', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true,
    permissions: { canCreateQuotations: true }
  });

  let savedIncludeBanner = null;
  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO quotations')) {
                  savedIncludeBanner = args[26];
                }
                return { success: true };
              }
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/quotations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'qt_banner_test',
      quoteNumber: 'QT-2026-101',
      includeBanner: 0,
      clientName: 'Test Client',
      grandTotal: 1000
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  assert.equal(savedIncludeBanner, 0);
});

test('POST /api/upload: Rejects unauthenticated image upload (401)', async () => {
  const req = new Request('https://example.com/api/upload', {
    method: 'POST'
  });
  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 401);
});

test('POST /api/upload: Uploads image to R2 MEDIA_BUCKET and returns media URL (201)', async () => {
  const token = await createTestToken({
    userId: 'user_admin',
    username: 'admin',
    isSuperAdmin: true
  });

  const mockEnv = createMockEnv();
  const formData = new FormData();
  const dummyBlob = new Blob(['fake image binary content'], { type: 'image/jpeg' });
  formData.append('file', dummyBlob, 'product-sample.jpg');

  const req = new Request('https://example.com/api/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.ok, true);
  assert.match(data.url, /^\/api\/media\/img_\d+_[a-z0-9]+\.jpg$/);

  // Verify GET /api/media/:filename works without authentication
  const getReq = new Request(`https://example.com${data.url}`, {
    method: 'GET'
  });
  const getRes = await worker.fetch(getReq, mockEnv);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(getRes.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  const bodyText = await getRes.text();
  assert.equal(bodyText, 'fake image binary content');
});

test('POST /api/upload: Rejects upload when no file is attached (400)', async () => {
  const token = await createTestToken({
    userId: 'user_admin',
    username: 'admin',
    isSuperAdmin: true
  });

  const req = new Request('https://example.com/api/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: new FormData()
  });

  const res = await worker.fetch(req, createMockEnv());
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /No image file provided/i);
});

test('GET /api/media/:filename: Returns 404 for missing image and 400 for invalid filenames', async () => {
  const mockEnv = createMockEnv();

  // 1. Missing file -> 404
  const notFoundReq = new Request('https://example.com/api/media/nonexistent_image.jpg', { method: 'GET' });
  const notFoundRes = await worker.fetch(notFoundReq, mockEnv);
  assert.equal(notFoundRes.status, 404);

  // 2. Traversal / invalid characters -> 400
  const invalidReq = new Request('https://example.com/api/media/sub/path.jpg', { method: 'GET' });
  const invalidRes = await worker.fetch(invalidReq, mockEnv);
  assert.equal(invalidRes.status, 400);
});

test('POST /api/companies: Saves and returns dynamic company_logo', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  let savedLogo = null;
  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          first() {
            if (sql.includes('COUNT')) return { count: 1 };
            return null;
          },
          bind(...args) {
            return {
              async first() {
                if (sql.includes('SELECT id FROM company_settings WHERE id = ?')) return { id: 'primary' };
                if (sql.includes('COUNT')) return { count: 1 };
                return null;
              },
              async run() {
                if (sql.includes('INSERT INTO company_settings')) {
                  savedLogo = args[24];
                }
                return { success: true };
              }
            };
          },
          async run() {
            return { success: true };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/companies', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: 'comp_logo_test',
      companyName: 'Dynamic Logo Co',
      companyLogo: '/api/media/comp_logo_test.png'
    })
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.companyLogo, '/api/media/comp_logo_test.png');
  assert.equal(savedLogo, '/api/media/comp_logo_test.png');
});

test('GET /api/companies: Returns company_logo and companyLogo per company profile', async () => {
  const token = await createTestToken({
    userId: 'admin_1',
    username: 'admin',
    isSuperAdmin: true
  });

  const customEnv = createMockEnv({
    DB: {
      prepare(sql) {
        return {
          async all() {
            return {
              results: [
                {
                  id: 'primary',
                  company_name: 'Primary Enterprise',
                  company_logo: '/api/media/primary_logo.png',
                  header_logo_url: '',
                  is_default: 1
                },
                {
                  id: 'comp_secondary',
                  company_name: 'Secondary Traders',
                  company_logo: '',
                  header_logo_url: '',
                  is_default: 0
                }
              ]
            };
          }
        };
      }
    }
  });

  const req = new Request('https://example.com/api/companies', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const res = await worker.fetch(req, customEnv);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.companies.length, 2);
  assert.equal(body.companies[0].companyLogo, '/api/media/primary_logo.png');
  assert.equal(body.companies[0].company_logo, '/api/media/primary_logo.png');
  assert.equal(body.companies[1].companyLogo, '');
});
