/**
 * Quotation Manager - Strict Cloud-Only Storage & Worker API Client
 * 100% Cloudflare Native Architecture: Cloudflare Workers + Cloudflare D1
 * NO LOCAL DATABASE CACHING (No IndexedDB, No LocalStorage for business entities)
 */

const StorageManager = {
  // In-memory data store for the active session (not stored on disk/localStorage)
  _quotations: [],
  _clients: [],
  _items: [],
  _users: [],
  _settings: null,
  _isOffline: false,
  _lastError: null,

  syncListeners: [],

  onSyncStatusChange(callback) {
    this.syncListeners.push(callback);
  },

  notifySyncStatus(status, message = '') {
    this._isOffline = (status === 'offline' || status === 'error');
    this.syncListeners.forEach(cb => {
      try { cb({ status, message, timestamp: new Date() }); } catch (e) {}
    });
  },

  isOffline() {
    return this._isOffline || !navigator.onLine;
  },

  getLastError() {
    return this._lastError;
  },

  // -------------------------------------------------------------
  // Initialization & Legacy Local Cache Cleanup
  // -------------------------------------------------------------
  async init() {
    // 1. Purge any legacy LocalStorage database caching
    const legacyKeys = [
      'je_quotations', 'je_clients', 'je_items', 'je_users', 'je_last_sync',
      'quotations', 'clients', 'items', 'users', 'qm_quotations_cache'
    ];
    legacyKeys.forEach(k => {
      try { localStorage.removeItem(k); } catch (e) {}
    });

    // 2. Permanently delete legacy IndexedDB databases
    if (typeof indexedDB !== 'undefined') {
      try {
        indexedDB.deleteDatabase('QuotationManagerDB');
        indexedDB.deleteDatabase('JalaramEnterpriseDB');
      } catch (e) {
        console.warn('[StorageManager] IndexedDB cleanup notice:', e);
      }
    }

    // 3. Monitor browser online/offline events
    window.addEventListener('online', () => {
      this._isOffline = false;
      this._lastError = null;
      this.notifySyncStatus('online', 'Connected to Cloudflare D1');
      if (window.App && typeof App.refreshCloudDataInBackground === 'function') {
        App.refreshCloudDataInBackground();
      }
    });

    window.addEventListener('offline', () => {
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', 'No Internet Connection');
      if (window.App && typeof App.renderActiveTab === 'function') {
        App.renderActiveTab();
      }
    });

    return true;
  },

  // -------------------------------------------------------------
  // API URL Configuration
  // -------------------------------------------------------------
  getApiUrl() {
    const custom = (localStorage.getItem('cf_worker_url') || localStorage.getItem('backend_url') || '').trim();
    if (custom && custom.startsWith('http')) {
      return custom.replace(/\/+$/, '');
    }
    return 'https://j-quotation-manager.pansuriyadhaval7.workers.dev';
  },

  setApiUrl(url) {
    const clean = (url || '').trim().replace(/\/+$/, '');
    localStorage.setItem('cf_worker_url', clean);
    localStorage.setItem('backend_url', clean);
    return clean;
  },

  hasApiUrl() {
    return !!this.getApiUrl();
  },

  // -------------------------------------------------------------
  // Authenticated Cloud Fetch Helper
  // -------------------------------------------------------------
  async fetchWithAuth(endpoint, options = {}) {
    if (!navigator.onLine) {
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', this._lastError);
      throw new Error(this._lastError);
    }

    const base = this.getApiUrl();
    const token = window.AuthManager ? AuthManager.getToken() : null;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const fullUrl = endpoint.startsWith('http') ? endpoint : `${base}${endpoint}`;

    try {
      const response = await fetch(fullUrl, { ...options, headers });

      if (response.status === 401 && !endpoint.includes('/api/auth/login')) {
        console.warn('[StorageManager] 401 Unauthorized received, logging out.');
        if (window.AuthManager) AuthManager.logout();
        throw new Error('Session expired. Please log in again.');
      }

      this._isOffline = false;
      this._lastError = null;
      return response;
    } catch (networkErr) {
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', this._lastError);
      throw networkErr;
    }
  },

  // -------------------------------------------------------------
  // Settings (Company Profile, Bank, Terms)
  // -------------------------------------------------------------
  getSettings() {
    if (this._settings) return this._settings;
    if (typeof DEFAULT_SETTINGS !== 'undefined') return DEFAULT_SETTINGS;
    return {
      company: { name: 'Quotation Manager', tagline: 'Professional Quotation Management' },
      bank: {},
      terms: [],
      media: {}
    };
  },

  async fetchSettingsFromCloud() {
    try {
      const res = await this.fetchWithAuth('/api/settings', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.settings) {
          this._settings = data.settings;
          return { success: true, settings: this._settings };
        }
      }
      return { success: false, message: 'Settings not returned' };
    } catch (err) {
      console.warn('[StorageManager] fetchSettings error:', err.message);
      return { success: false, error: err.message };
    }
  },

  async saveSettings(settings) {
    this._settings = settings;
    const res = await this.fetchWithAuth('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to save settings: HTTP ${res.status}`);
    }
    this.notifySyncStatus('online', 'Settings saved to Cloudflare D1');
    return settings;
  },

  // -------------------------------------------------------------
  // Quotations Operations (Strict Cloudflare D1)
  // -------------------------------------------------------------
  normalizeQuotation(q) {
    if (!q) return null;
    if (!Array.isArray(q.items)) {
      if (typeof q.itemsJson === 'string') {
        try { q.items = JSON.parse(q.itemsJson); } catch (e) { q.items = []; }
      } else if (Array.isArray(q.itemsJson)) {
        q.items = q.itemsJson;
      } else {
        q.items = [];
      }
    }
    if (!Array.isArray(q.calculations)) {
      if (typeof q.calculationsJson === 'string') {
        try { q.calculations = JSON.parse(q.calculationsJson); } catch (e) { q.calculations = []; }
      } else if (Array.isArray(q.calculationsJson)) {
        q.calculations = q.calculationsJson;
      } else {
        q.calculations = [];
      }
    }
    if (!Array.isArray(q.additionalCharges)) {
      if (typeof q.additionalChargesJson === 'string') {
        try { q.additionalCharges = JSON.parse(q.additionalChargesJson); } catch (e) { q.additionalCharges = []; }
      } else if (Array.isArray(q.additionalChargesJson)) {
        q.additionalCharges = q.additionalChargesJson;
      } else {
        q.additionalCharges = [];
      }
    }
    return q;
  },

  getQuotations() {
    return this._quotations.map(q => this.normalizeQuotation(q));
  },

  getQuotationById(id) {
    const found = this._quotations.find(q => q.id === id);
    return found ? this.normalizeQuotation(found) : null;
  },

  async fetchQuotationsFromCloud(filters = {}) {
    if (!navigator.onLine) {
      this._quotations = [];
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', this._lastError);
      return { success: false, offline: true, error: this._lastError, quotations: [], total: 0 };
    }

    try {
      const params = new URLSearchParams();
      if (filters.from || filters.startDate) params.set('from', filters.from || filters.startDate);
      if (filters.to || filters.endDate) params.set('to', filters.to || filters.endDate);
      if (filters.month && filters.month !== 'ALL') params.set('month', filters.month);
      if (filters.year && filters.year !== 'ALL') params.set('year', filters.year);
      if (filters.search) params.set('search', filters.search);
      if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
      params.set('limit', String(filters.limit || 500));
      if (filters.offset !== undefined) params.set('offset', String(filters.offset));

      const res = await this.fetchWithAuth(`/api/quotations?${params.toString()}`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.quotations)) {
          this._quotations = data.quotations.map(q => this.normalizeQuotation(q));
          this._isOffline = false;
          this._lastError = null;
          this.notifySyncStatus('online', 'Connected to Cloudflare D1');
          return { success: true, quotations: this._quotations, total: data.total || this._quotations.length };
        }
      }
      throw new Error(`Failed to load quotations (HTTP ${res.status})`);
    } catch (err) {
      this._quotations = [];
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', this._lastError);
      return { success: false, offline: true, error: this._lastError, quotations: [], total: 0 };
    }
  },

  async saveQuotation(quote) {
    if (!navigator.onLine) {
      throw new Error('No Internet Connection - Unable to save quotation to Cloudflare D1.');
    }

    if (!quote.id) {
      quote.id = 'qt_' + Date.now();
      quote.createdAt = new Date().toISOString();
    }
    quote.updatedAt = new Date().toISOString();

    if (!quote.quoteNumber) {
      quote.quoteNumber = this.generateNextQuoteNumber();
    }

    const res = await this.fetchWithAuth('/api/quotations', {
      method: 'POST',
      body: JSON.stringify(quote)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Save failed with HTTP ${res.status}`);
    }

    // Update in-memory active list
    const normalized = this.normalizeQuotation(quote);
    const idx = this._quotations.findIndex(q => q.id === quote.id);
    if (idx >= 0) {
      this._quotations[idx] = normalized;
    } else {
      this._quotations.unshift(normalized);
    }

    this.notifySyncStatus('online', `Quotation ${quote.quoteNumber} saved to D1`);
    return normalized;
  },

  async deleteQuotation(id) {
    if (!navigator.onLine) {
      throw new Error('No Internet Connection - Unable to delete quotation from Cloudflare D1.');
    }

    const res = await this.fetchWithAuth(`/api/quotations/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Delete failed with HTTP ${res.status}`);
    }

    this._quotations = this._quotations.filter(q => q.id !== id);
    this.notifySyncStatus('online', 'Quotation deleted from D1');
    return true;
  },

  generateNextQuoteNumber() {
    const year = new Date().getFullYear();
    const existing = this._quotations.filter(q => q.quoteNumber && q.quoteNumber.startsWith(`QT-${year}-`));
    let maxNum = 0;
    existing.forEach(q => {
      const parts = q.quoteNumber.split('-');
      const num = parseInt(parts[2], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    });
    return `QT-${year}-${String(maxNum + 1).padStart(4, '0')}`;
  },

  // -------------------------------------------------------------
  // Clients Operations (Strict Cloudflare D1)
  // -------------------------------------------------------------
  getClients() {
    return this._clients;
  },

  getClientById(id) {
    return this._clients.find(c => c.id === id) || null;
  },

  async fetchClientsFromCloud(search = '') {
    if (!navigator.onLine) {
      this._clients = [];
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', this._lastError);
      return { success: false, offline: true, error: this._lastError, clients: [] };
    }

    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('limit', '500');

      const res = await this.fetchWithAuth(`/api/clients?${params.toString()}`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.clients)) {
          this._clients = data.clients;
          return { success: true, clients: this._clients };
        }
      }
      throw new Error(`Failed to load clients (HTTP ${res.status})`);
    } catch (err) {
      this._clients = [];
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      return { success: false, offline: true, error: this._lastError, clients: [] };
    }
  },

  async saveClient(client) {
    if (!navigator.onLine) {
      throw new Error('No Internet Connection - Unable to save client to Cloudflare D1.');
    }

    if (!client.id) client.id = 'cli_' + Date.now();
    client.updatedAt = new Date().toISOString();

    const res = await this.fetchWithAuth('/api/clients', {
      method: 'POST',
      body: JSON.stringify(client)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Save client failed: HTTP ${res.status}`);
    }

    const idx = this._clients.findIndex(c => c.id === client.id);
    if (idx >= 0) {
      this._clients[idx] = client;
    } else {
      this._clients.unshift(client);
    }

    this.notifySyncStatus('online', 'Client saved to Cloudflare D1');
    return client;
  },

  async deleteClient(id) {
    if (!navigator.onLine) {
      throw new Error('No Internet Connection - Unable to delete client from Cloudflare D1.');
    }

    const res = await this.fetchWithAuth(`/api/clients/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Delete client failed: HTTP ${res.status}`);
    }

    this._clients = this._clients.filter(c => c.id !== id);
    this.notifySyncStatus('online', 'Client deleted from D1');
    return true;
  },

  // -------------------------------------------------------------
  // Items Master Operations (Strict Cloudflare D1)
  // -------------------------------------------------------------
  getItems() {
    return this._items;
  },

  getItemById(id) {
    return this._items.find(i => i.id === id) || null;
  },

  async fetchItemsFromCloud() {
    if (!navigator.onLine) {
      this._items = [];
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', this._lastError);
      return { success: false, offline: true, error: this._lastError, items: [] };
    }

    try {
      const res = await this.fetchWithAuth('/api/items', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.items)) {
          this._items = data.items;
          return { success: true, items: this._items };
        }
      }
      throw new Error(`Failed to load items (HTTP ${res.status})`);
    } catch (err) {
      this._items = [];
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      return { success: false, offline: true, error: this._lastError, items: [] };
    }
  },

  async saveItem(item) {
    if (!navigator.onLine) {
      throw new Error('No Internet Connection - Unable to save item to Cloudflare D1.');
    }

    if (!item.id) item.id = 'itm_' + Date.now();
    item.updatedAt = new Date().toISOString();

    const res = await this.fetchWithAuth('/api/items', {
      method: 'POST',
      body: JSON.stringify(item)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Save item failed: HTTP ${res.status}`);
    }

    const idx = this._items.findIndex(i => i.id === item.id);
    if (idx >= 0) {
      this._items[idx] = item;
    } else {
      this._items.push(item);
    }

    this.notifySyncStatus('online', 'Item saved to Cloudflare D1');
    return item;
  },

  async deleteItem(id) {
    if (!navigator.onLine) {
      throw new Error('No Internet Connection - Unable to delete item from Cloudflare D1.');
    }

    const res = await this.fetchWithAuth(`/api/items/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Delete item failed: HTTP ${res.status}`);
    }

    this._items = this._items.filter(i => i.id !== id);
    this.notifySyncStatus('online', 'Item deleted from D1');
    return true;
  },

  // -------------------------------------------------------------
  // Users Management (Super Admin via Worker API)
  // -------------------------------------------------------------
  getUsers() {
    return this._users;
  },

  async fetchUsersFromCloud() {
    if (!navigator.onLine) {
      this._users = [];
      return { success: false, offline: true, users: [] };
    }
    try {
      const res = await this.fetchWithAuth('/api/users', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.users)) {
          this._users = data.users;
          return { success: true, users: this._users };
        }
      }
    } catch (e) {
      console.warn('[StorageManager] fetchUsersFromCloud error:', e.message);
    }
    return { success: false, users: [] };
  },

  // -------------------------------------------------------------
  // Master Sync: Pull All Active Data from Cloudflare D1
  // -------------------------------------------------------------
  async pullAllFromCloud() {
    if (!navigator.onLine) {
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', this._lastError);
      return { success: false, offline: true, message: this._lastError };
    }

    this.notifySyncStatus('syncing', 'Fetching live data from Cloudflare D1...');

    try {
      await Promise.all([
        this.fetchSettingsFromCloud(),
        this.fetchQuotationsFromCloud({ limit: 500 }),
        this.fetchClientsFromCloud(),
        this.fetchItemsFromCloud()
      ]);

      if (window.AuthManager && AuthManager.isSuperAdmin()) {
        await this.fetchUsersFromCloud();
      }

      this._isOffline = false;
      this._lastError = null;
      this.notifySyncStatus('online', 'Connected to Cloudflare D1');
      return { success: true, message: 'Data loaded from Cloudflare D1' };
    } catch (err) {
      this._isOffline = true;
      this._lastError = 'No Internet Connection - Please check your network';
      this.notifySyncStatus('offline', this._lastError);
      return { success: false, offline: true, message: this._lastError };
    }
  },

  async testBackendConnection(url) {
    const targetUrl = (url || this.getApiUrl() || '').trim();
    const endpoint = targetUrl ? `${targetUrl.replace(/\/+$/, '')}/api/health` : '/api/health';
    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        const data = await res.json();
        return { success: true, message: data.service || 'Connected to Cloudflare Worker API' };
      } else {
        return { success: false, message: `Server returned HTTP ${res.status}` };
      }
    } catch (e) {
      return { success: false, message: 'Could not reach Worker: ' + e.message };
    }
  }
};
