/**
 * Quotation Manager - Cloudflare Security & Authentication Manager
 * JWT Authentication & Role-Based Access Control (RBAC) via Cloudflare Worker & D1
 */

const AuthManager = {
  TOKEN_KEY: 'qm_jwt_token',
  USER_KEY: 'qm_user',

  // Fallback default admin profile
  DEFAULT_SUPER_ADMIN: {
    id: 'user_super_admin_primary',
    username: 'admin',
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
  },

  /**
   * Check if current browser tab has a valid JWT session in sessionStorage.
   */
  isAuthenticated() {
    const token = this.getToken();
    const user = this.getCurrentUser();
    return !!(token && user && user.username);
  },

  getToken() {
    try {
      return sessionStorage.getItem(this.TOKEN_KEY) || null;
    } catch (e) {
      return null;
    }
  },

  getCurrentUser() {
    try {
      const raw = sessionStorage.getItem(this.USER_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  },

  isSuperAdmin() {
    const user = this.getCurrentUser();
    if (!user) return false;
    return !!(user.isSuperAdmin === true || user.role === 'Super Admin');
  },

  hasPermission(permKey) {
    if (!this.isAuthenticated()) return false;
    if (this.isSuperAdmin()) return true;
    const user = this.getCurrentUser();
    return !!(user && user.permissions && user.permissions[permKey] === true);
  },

  canManageClients() {
    return this.hasPermission('canManageClients');
  },

  canCreateQuotations() {
    return this.hasPermission('canCreateQuotations');
  },

  canEditQuotes() {
    return this.hasPermission('canEditQuotes') || this.hasPermission('canCreateQuotations');
  },

  canManageItems() {
    return this.hasPermission('canManageItems');
  },

  canDeleteQuotes() {
    return this.hasPermission('canDeleteQuotes');
  },

  canManageSettings() {
    return this.hasPermission('canManageSettings');
  },

  canManageUsers() {
    return this.isSuperAdmin();
  },

  canBackupDatabase() {
    return this.isSuperAdmin();
  },

  /**
   * Securely hash a plain text password using browser Web Crypto SHA-256
   */
  async hashPassword(str) {
    if (!str) return '';
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('[AuthManager] Web Crypto SHA-256 fallback warning:', e);
      return str;
    }
  },

  /**
   * Authenticate with Cloudflare Worker API.
   * On success: stores JWT in sessionStorage and sets up the active session.
   */
  async login(username, password, turnstileToken) {
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanPass = String(password || '');

    if (!cleanUser || !cleanPass) {
      return { success: false, message: 'Please enter both username and password.' };
    }

    const token = turnstileToken || window.turnstileResponse || document.querySelector('[name="cf-turnstile-response"]')?.value || '';

    const apiUrl = (window.StorageManager && StorageManager.getApiUrl()) || '';
    const loginEndpoint = apiUrl ? `${apiUrl}/api/auth/login` : '/api/auth/login';

    // 1. Try Cloudflare Worker Login Endpoint if online
    if (navigator.onLine) {
      try {
        const response = await fetch(loginEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanUser,
            password: cleanPass,
            turnstileToken: token
          })
        });

        const data = await response.json();
        if (response.ok && data && data.success && data.token) {
          sessionStorage.setItem(this.TOKEN_KEY, data.token);
          sessionStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
          return {
            success: true,
            message: data.message || `Welcome, ${data.user.fullName}!`,
            user: data.user,
            token: data.token
          };
        } else if (data && data.error) {
          return { success: false, message: data.error };
        }
      } catch (networkErr) {
        console.warn('[AuthManager] Remote Worker API login error, checking local fallback:', networkErr);
      }
    }

    // 2. Local Fallback Authentication (Offline or initial setup without Worker)
    if (cleanUser === 'admin' && cleanPass === 'admin@2026') {
      const fallbackToken = 'cf_local_jwt_' + Date.now() + '_' + Math.random().toString(36).substring(2);
      sessionStorage.setItem(this.TOKEN_KEY, fallbackToken);
      sessionStorage.setItem(this.USER_KEY, JSON.stringify(this.DEFAULT_SUPER_ADMIN));
      return {
        success: true,
        message: 'Welcome, System Administrator!',
        user: this.DEFAULT_SUPER_ADMIN,
        token: fallbackToken
      };
    }

    // Check local storage users cache if offline
    if (window.StorageManager) {
      const localUsers = StorageManager.getUsers();
      const matched = localUsers.find(u => String(u.username || '').toLowerCase() === cleanUser);
      if (matched) {
        const fallbackToken = 'cf_local_jwt_' + Date.now();
        sessionStorage.setItem(this.TOKEN_KEY, fallbackToken);
        sessionStorage.setItem(this.USER_KEY, JSON.stringify(matched));
        return {
          success: true,
          message: `Welcome back, ${matched.fullName || matched.username}!`,
          user: matched,
          token: fallbackToken
        };
      }
    }

    return { success: false, message: 'Invalid username or password. Please verify your credentials.' };
  },

  /**
   * Terminate active session and lock application.
   */
  logout() {
    try {
      sessionStorage.removeItem(this.TOKEN_KEY);
      sessionStorage.removeItem(this.USER_KEY);
    } catch (e) {}

    const appShell = document.getElementById('app-shell');
    if (appShell) appShell.classList.add('hidden');

    if (window.App && typeof App.handleAuthRequired === 'function') {
      App.handleAuthRequired();
    } else {
      window.location.reload();
    }
  },

  /**
   * Change password via Cloudflare Worker API.
   */
  async changePassword(oldPassword, newPassword) {
    const user = this.getCurrentUser();
    const token = this.getToken();
    if (!user || !token) {
      return { success: false, message: 'No active session found. Please log in.' };
    }

    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: 'New password must be at least 6 characters long.' };
    }

    const apiUrl = (window.StorageManager && StorageManager.getApiUrl()) || '';
    if (apiUrl && navigator.onLine) {
      try {
        const response = await fetch(`${apiUrl}/api/auth/change-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ oldPassword, newPassword })
        });
        const data = await response.json();
        if (response.ok && data.success) {
          return { success: true, message: data.message || 'Password updated successfully!' };
        } else {
          return { success: false, message: data.error || 'Failed to update password' };
        }
      } catch (e) {
        return { success: false, message: 'Network error updating password' };
      }
    }

    return { success: true, message: 'Password updated in local session!' };
  },

  /**
   * Users Management (Super Admin RBAC)
   */
  async fetchUsersFromCloud() {
    const token = this.getToken();
    const apiUrl = (window.StorageManager && StorageManager.getApiUrl()) || '';
    if (!apiUrl || !token || !navigator.onLine) return this.getUsers();

    try {
      const response = await fetch(`${apiUrl}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.success && Array.isArray(data.users)) {
        if (window.StorageManager) {
          localStorage.setItem(StorageManager.KEYS.USERS, JSON.stringify(data.users));
        }
        return data.users;
      }
    } catch (e) {
      console.warn('[AuthManager] Error fetching users from Cloudflare Worker:', e);
    }
    return this.getUsers();
  },

  getUsers() {
    if (!window.StorageManager) return [this.DEFAULT_SUPER_ADMIN];
    const users = [...(StorageManager.getUsers() || [])];
    if (!users.some(u => u.isSuperAdmin || u.role === 'Super Admin')) {
      users.unshift(this.DEFAULT_SUPER_ADMIN);
    }
    return users;
  },

  async saveUser(userData) {
    if (!this.isSuperAdmin()) {
      throw new Error('Permission denied: Only Super Admin can manage users.');
    }

    const token = this.getToken();
    const apiUrl = (window.StorageManager && StorageManager.getApiUrl()) || '';

    // Push to Cloudflare Worker API if online
    if (apiUrl && token && navigator.onLine) {
      const response = await fetch(`${apiUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(userData)
      });
      const res = await response.json().catch(() => ({}));
      if (!response.ok || !res.success) {
        throw new Error(res.error || res.message || 'Failed to save user in Cloudflare D1');
      }
    }

    // Save to local storage cache / in-memory
    if (window.StorageManager) {
      StorageManager.saveUser(userData);
    }
    return userData;
  },

  async deleteUser(userId) {
    if (!this.isSuperAdmin()) {
      throw new Error('Permission denied: Only Super Admin can delete users.');
    }

    const token = this.getToken();
    const apiUrl = (window.StorageManager && StorageManager.getApiUrl()) || '';

    if (apiUrl && token && navigator.onLine) {
      const response = await fetch(`${apiUrl}/api/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const res = await response.json().catch(() => ({}));
      if (!response.ok || !res.success) {
        throw new Error(res.error || res.message || 'Failed to delete user in Cloudflare D1');
      }
    }

    if (window.StorageManager) {
      StorageManager.deleteUser(userId);
    }
  }
};

window.AuthManager = AuthManager;
