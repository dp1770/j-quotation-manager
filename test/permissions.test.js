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
