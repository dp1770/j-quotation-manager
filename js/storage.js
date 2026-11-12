/**
 * Quotation Manager - Storage & Cloudflare Sync Engine (100% Cloudflare Pages + Workers + D1)
 * Multi-layer persistence:
 * 1. Cloudflare D1 Database via Cloudflare Worker REST API (Remote Master Database)
 * 2. IndexedDB (Primary persistent offline database & sync queue)
 * 3. LocalStorage (Instant synchronous read cache / fast hydration)
 */

const IdbStore = {
  DB_NAME: 'JalaramEnterpriseDB',
  DB_VERSION: 1,
  dbInstance: null,

  async getDb() {
    if (this.dbInstance) return this.dbInstance;
    if (typeof indexedDB === 'undefined') return null;

    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('quotations')) db.createObjectStore('quotations', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('clients')) db.createObjectStore('clients', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'queueId', autoIncrement: true });
        };
        request.onsuccess = (e) => {
          this.dbInstance = e.target.result;
          resolve(this.dbInstance);
        };
        request.onerror = (e) => {
          console.warn('[IdbStore] Failed to open IndexedDB:', e);
          resolve(null);
        };
      } catch (err) {
        console.warn('[IdbStore] Exception opening IndexedDB:', err);
        resolve(null);
      }
    });
  },

  async put(storeName, item) {
    const db = await this.getDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(item);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        console.warn(`[IdbStore] Put error on ${storeName}:`, err);
        resolve(false);
      }
    });
  },

  async putAll(storeName, items) {
    const db = await this.getDb();
    if (!db || !Array.isArray(items)) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        items.forEach(it => store.put(it));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        console.warn(`[IdbStore] PutAll error on ${storeName}:`, err);
        resolve(false);
      }
    });
  },

  async getAll(storeName) {
    const db = await this.getDb();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (err) {
        console.warn(`[IdbStore] GetAll error on ${storeName}:`, err);
        resolve([]);
      }
    });
  },

  async delete(storeName, key) {
    const db = await this.getDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  },

  async clear(storeName) {
    const db = await this.getDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        console.warn(`[IdbStore] Clear error on ${storeName}:`, err);
        resolve(false);
      }
    });
  },

  async enqueueSync(action, payload) {
    const db = await this.getDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('syncQueue', 'readwrite');
        const store = tx.objectStore('syncQueue');
        store.add({ action, payload, createdAt: new Date().toISOString() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  },

  async getSyncQueue() {
    return this.getAll('syncQueue');
  },

  async clearSyncQueue() {
    const db = await this.getDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('syncQueue', 'readwrite');
        const store = tx.objectStore('syncQueue');
        store.clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        resolve(false);
      }
    });
  }
};

const StorageManager = {
  KEYS: {
    SETTINGS: 'je_settings',
    QUOTATIONS: 'je_quotations',
    CLIENTS: 'je_clients',
    ITEMS: 'je_items',
    USERS: 'je_users',
    LAST_SYNC: 'je_last_sync'
  },

  syncListeners: [],

  onSyncStatusChange(callback) {
    this.syncListeners.push(callback);
  },

  notifySyncStatus(status, message = '') {
    this.syncListeners.forEach(cb => cb({ status, message, timestamp: new Date() }));
  },

  getApiUrl() {
    const custom = (localStorage.getItem('cf_worker_url') || localStorage.getItem('backend_url') || this.getSettings()?.integration?.workerUrl || '').trim();
    if (custom && custom.startsWith('http')) {
      return custom.replace(/\/+$/, '');
    }
    return '';
  },

  setApiUrl(url) {
    const clean = (url || '').trim().replace(/\/+$/, '');
    localStorage.setItem('cf_worker_url', clean);
    localStorage.setItem('backend_url', clean);
    const settings = this.getSettings();
    if (!settings.integration) settings.integration = {};
    settings.integration.workerUrl = clean;
    this.saveSettings(settings);
    return clean;
  },

  hasApiUrl() {
    return !!this.getApiUrl();
  },

  getBackendUrl() {
    return this.getApiUrl();
  },

  setBackendUrl(url) {
    return this.setApiUrl(url);
  },

  hasBackendUrl() {
    return !!(this.getBackendUrl());
  },

  async fetchWithAuth(endpoint, options = {}) {
    const base = this.getApiUrl();
    const token = window.AuthManager ? AuthManager.getToken() : null;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = base ? `${base}${cleanEndpoint}` : cleanEndpoint;

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      if (window.AuthManager) AuthManager.logout();
      if (window.App && App.showLoginGate) App.showLoginGate(true);
      throw new Error('Session expired. Please log in again.');
    }
    return res;
  },

  isElectron() {
    return typeof window !== 'undefined' && !!(window.electronAPI && window.electronAPI.isElectron);
  },

  /**
   * Sync the current complete in-memory database to persistent local_database.json via Electron IPC
   */
  async syncToElectronDb() {
    if (!this.isElectron()) return;
    try {
      const fullData = {
        app: 'Jalaram Enterprise Quotation Manager',
        version: '3.5.0',
        updatedAt: new Date().toISOString(),
        settings: this.getSettings(),
        quotations: this.getQuotations(),
        clients: this.getClients(),
        items: this.getItems(),
        users: this.getUsers()
      };
      await window.electronAPI.writeDatabase(fullData);
      console.log('[StorageManager] Persistent local_database.json updated via Electron IPC');
    } catch (err) {
      console.warn('[StorageManager] Failed to write to local_database.json:', err);
    }
  },

  // -----------------------------------------------------------
  // Initialization & Local Retrieval (Electron IPC + IndexedDB + LocalStorage)
  // -----------------------------------------------------------
  async init() {
    // 0. If running inside Electron, hydrate directly from app.getPath('userData')/local_database.json
    if (this.isElectron()) {
      try {
        const electronData = await window.electronAPI.readDatabase();
        if (electronData && typeof electronData === 'object') {
          console.log('[StorageManager] Hydrated data from Electron persistent local_database.json');
          if (electronData.settings) localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(electronData.settings));
          if (Array.isArray(electronData.quotations)) localStorage.setItem(this.KEYS.QUOTATIONS, JSON.stringify(electronData.quotations));
          if (Array.isArray(electronData.clients)) localStorage.setItem(this.KEYS.CLIENTS, JSON.stringify(electronData.clients));
          if (Array.isArray(electronData.items)) localStorage.setItem(this.KEYS.ITEMS, JSON.stringify(electronData.items));
          if (Array.isArray(electronData.users)) localStorage.setItem(this.KEYS.USERS, JSON.stringify(electronData.users));
        } else {
          console.log('[StorageManager] Fresh Electron run. Seeding default data to local_database.json');
          await this.syncToElectronDb();
        }
      } catch (err) {
        console.warn('[StorageManager] Error reading Electron database:', err);
      }
    }

    // 1. Seed fallback defaults in localStorage if first visit
    if (!localStorage.getItem(this.KEYS.SETTINGS)) {
      localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
    }
    if (!localStorage.getItem(this.KEYS.USERS)) {
      localStorage.setItem(this.KEYS.USERS, JSON.stringify(DEFAULT_USERS));
    }
    if (!localStorage.getItem(this.KEYS.CLIENTS)) {
      localStorage.setItem(this.KEYS.CLIENTS, JSON.stringify(DEFAULT_CLIENTS));
    }
    if (!localStorage.getItem(this.KEYS.ITEMS)) {
      localStorage.setItem(this.KEYS.ITEMS, JSON.stringify(DEFAULT_ITEMS));
    }
    if (!localStorage.getItem(this.KEYS.QUOTATIONS)) {
      localStorage.setItem(this.KEYS.QUOTATIONS, JSON.stringify(DEFAULT_SAMPLE_QUOTATIONS));
    }

    // 2. Initialize IndexedDB & Hydrate
    try {
      await IdbStore.getDb();
      const idbQuotes = await IdbStore.getAll('quotations');
      if (idbQuotes && idbQuotes.length > 0) {
        localStorage.setItem(this.KEYS.QUOTATIONS, JSON.stringify(idbQuotes));
      } else {
        // Seed IndexedDB with initial quotations
        await IdbStore.putAll('quotations', this.getQuotations());
      }

      const idbClients = await IdbStore.getAll('clients');
      if (idbClients && idbClients.length > 0) {
        localStorage.setItem(this.KEYS.CLIENTS, JSON.stringify(idbClients));
      } else {
        await IdbStore.putAll('clients', this.getClients());
      }

      const idbItems = await IdbStore.getAll('items');
      if (idbItems && idbItems.length > 0) {
        localStorage.setItem(this.KEYS.ITEMS, JSON.stringify(idbItems));
      } else {
        await IdbStore.putAll('items', this.getItems());
      }

      const idbUsers = await IdbStore.getAll('users');
      if (idbUsers && idbUsers.length > 0) {
        localStorage.setItem(this.KEYS.USERS, JSON.stringify(idbUsers));
      } else {
        await IdbStore.putAll('users', this.getUsers());
      }

      const idbSettings = await IdbStore.getAll('settings');
      if (idbSettings && idbSettings.length > 0 && idbSettings[0].value) {
        localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(idbSettings[0].value));
      } else {
        await IdbStore.put('settings', { id: 'global', value: this.getSettings() });
      }

      console.log('[StorageManager] IndexedDB initialized and synchronized successfully.');
    } catch (idbInitErr) {
      console.warn('[StorageManager] IndexedDB init warning:', idbInitErr);
    }

    // 3. Register Global Online Event Listener for Auto-Sync
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[StorageManager] Connection restored (online event). Triggering auto-sync...');
        this.autoSyncOnOnline();
      });
    }
  },

  getSettings() {
    try {
      const data = localStorage.getItem(this.KEYS.SETTINGS);
      return data ? JSON.parse(data) : DEFAULT_SETTINGS;
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings) {
    localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(settings));
    IdbStore.put('settings', { id: 'global', value: settings });
    this.syncToElectronDb();

    if (!navigator.onLine) {
      IdbStore.enqueueSync('save_settings', settings);
      this.notifySyncStatus('offline', 'Settings saved offline (Pending sync queued)');
    } else {
      this.syncRemote('save_settings', settings);
    }
  },

  getUsers() {
    try {
      const data = localStorage.getItem(this.KEYS.USERS);
      return data ? JSON.parse(data) : DEFAULT_USERS;
    } catch (e) {
      return DEFAULT_USERS;
    }
  },

  saveUser(user) {
    const users = this.getUsers();
    // Ensure password is not stored in plaintext if passwordHash is available
    if (user.password && user.passwordHash) {
      delete user.password;
    }
    const idx = users.findIndex(u => u.id === user.id);
    if (idx >= 0) {
      if (users[idx].username === 'jalaram' || users[idx].username === 'admin') {
        user.isSuperAdmin = true;
        user.role = 'Super Admin';
      }
      users[idx] = { ...user, updatedAt: new Date().toISOString() };
    } else {
      user.createdAt = new Date().toISOString();
      user.updatedAt = user.createdAt;
      users.push(user);
    }
    localStorage.setItem(this.KEYS.USERS, JSON.stringify(users));
    IdbStore.put('users', user);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      IdbStore.enqueueSync('save_user', user);
      this.notifySyncStatus('offline', 'User saved offline (Pending sync queued)');
    } else {
      this.syncRemote('save_user', user);
    }
    return user;
  },

  deleteUser(userId) {
    const users = this.getUsers();
    const target = users.find(u => u.id === userId);
    if (target && (target.isSuperAdmin || target.username === 'jalaram' || target.username === 'admin')) {
      throw new Error('Super Admin user cannot be deleted!');
    }
    const filtered = users.filter(u => u.id !== userId);
    localStorage.setItem(this.KEYS.USERS, JSON.stringify(filtered));
    IdbStore.delete('users', userId);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      IdbStore.enqueueSync('delete_user', { id: userId });
      this.notifySyncStatus('offline', 'User deletion queued offline');
    } else {
      this.syncRemote('delete_user', { id: userId });
    }
  },

  // -----------------------------------------------------------
  // CLIENT MASTER (CRUD + IndexedDB + Auto-Sync)
  // -----------------------------------------------------------
  getClients() {
    try {
      const data = localStorage.getItem(this.KEYS.CLIENTS);
      return data ? JSON.parse(data) : DEFAULT_CLIENTS;
    } catch (e) {
      return DEFAULT_CLIENTS;
    }
  },

  saveClient(client) {
    const clients = this.getClients();
    if (!client.id) {
      client.id = 'cli_' + Date.now();
      client.createdAt = new Date().toISOString();
    }
    client.updatedAt = new Date().toISOString();

    if (!client.createdBy) {
      const activeUser = window.AuthManager && AuthManager.getCurrentUser();
      client.createdBy = (activeUser && (activeUser.fullName || activeUser.username)) || 'Super Admin';
    }

    const idx = clients.findIndex(c => c.id === client.id);
    if (idx >= 0) {
      clients[idx] = client;
    } else {
      clients.unshift(client);
    }
    localStorage.setItem(this.KEYS.CLIENTS, JSON.stringify(clients));
    IdbStore.put('clients', client);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      IdbStore.enqueueSync('save_client', client);
      this.notifySyncStatus('offline', 'Client saved offline (IndexedDB)');
    } else {
      this.syncRemote('save_client', client);
    }
    return client;
  },

  bulkSaveClients(newClients) {
    if (!Array.isArray(newClients) || newClients.length === 0) return [];
    const clients = this.getClients();
    const now = new Date().toISOString();
    const processed = [];

    newClients.forEach((c, idx) => {
      const client = Object.assign({}, c);
      if (!client.id) {
        client.id = 'cli_' + Date.now() + '_' + idx;
        client.createdAt = now;
      }
      client.updatedAt = now;
      const existingIdx = clients.findIndex(x => 
        (client.phone && x.phone === client.phone) || 
        (client.companyName && x.companyName && x.companyName.toLowerCase() === client.companyName.toLowerCase())
      );
      if (existingIdx >= 0) {
        clients[existingIdx] = Object.assign(clients[existingIdx], client);
        processed.push(clients[existingIdx]);
      } else {
        clients.unshift(client);
        processed.push(client);
      }
    });

    localStorage.setItem(this.KEYS.CLIENTS, JSON.stringify(clients));
    IdbStore.putAll('clients', clients);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      processed.forEach(p => IdbStore.enqueueSync('save_client', p));
      this.notifySyncStatus('offline', `${processed.length} clients imported offline (IndexedDB)`);
    } else {
      processed.forEach(p => this.syncRemote('save_client', p));
      this.notifySyncStatus('online', `${processed.length} clients imported & syncing to Cloud`);
    }

    return processed;
  },

  deleteClient(clientId) {
    const clients = this.getClients();
    const filtered = clients.filter(c => c.id !== clientId);
    localStorage.setItem(this.KEYS.CLIENTS, JSON.stringify(filtered));
    IdbStore.delete('clients', clientId);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      IdbStore.enqueueSync('delete_client', { id: clientId });
      this.notifySyncStatus('offline', 'Client deletion queued offline');
    } else {
      this.syncRemote('delete_client', { id: clientId });
    }
  },

  // -----------------------------------------------------------
  // ITEM MASTER (CRUD + IndexedDB + Auto-Sync)
  // -----------------------------------------------------------
  getItems() {
    try {
      const data = localStorage.getItem(this.KEYS.ITEMS);
      return data ? JSON.parse(data) : DEFAULT_ITEMS;
    } catch (e) {
      return DEFAULT_ITEMS;
    }
  },

  getItemById(id) {
    const items = this.getItems();
    return items.find(it => it.id === id) || null;
  },

  saveItem(item) {
    const items = this.getItems();
    if (!item.id) {
      item.id = 'item_' + Date.now();
      item.createdAt = new Date().toISOString();
    }
    item.updatedAt = new Date().toISOString();

    if (!item.createdBy) {
      const activeUser = window.AuthManager && AuthManager.getCurrentUser();
      item.createdBy = (activeUser && (activeUser.fullName || activeUser.username)) || 'Super Admin';
    }

    const idx = items.findIndex(it => it.id === item.id);
    if (idx >= 0) {
      items[idx] = item;
    } else {
      items.unshift(item);
    }
    localStorage.setItem(this.KEYS.ITEMS, JSON.stringify(items));
    IdbStore.put('items', item);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      IdbStore.enqueueSync('save_item', item);
      this.notifySyncStatus('offline', 'Product saved offline (IndexedDB)');
    } else {
      this.syncRemote('save_item', item);
    }
    return item;
  },

  bulkSaveItems(newItems) {
    if (!Array.isArray(newItems) || newItems.length === 0) return [];
    const items = this.getItems();
    const now = new Date().toISOString();
    const processed = [];

    newItems.forEach((it, idx) => {
      const item = Object.assign({}, it);
      if (!item.id) {
        item.id = 'item_' + Date.now() + '_' + idx;
        item.createdAt = now;
      }
      item.updatedAt = now;
      const existingIdx = items.findIndex(x => 
        x.name && item.name && x.name.toLowerCase() === item.name.toLowerCase()
      );
      if (existingIdx >= 0) {
        items[existingIdx] = Object.assign(items[existingIdx], item);
        processed.push(items[existingIdx]);
      } else {
        items.unshift(item);
        processed.push(item);
      }
    });

    localStorage.setItem(this.KEYS.ITEMS, JSON.stringify(items));
    IdbStore.putAll('items', items);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      processed.forEach(p => IdbStore.enqueueSync('save_item', p));
      this.notifySyncStatus('offline', `${processed.length} items imported offline (IndexedDB)`);
    } else {
      processed.forEach(p => this.syncRemote('save_item', p));
      this.notifySyncStatus('online', `${processed.length} items imported & syncing to Cloud`);
    }

    return processed;
  },

  saveLocalLicense(lic) {
    if (lic) {
      IdbStore.put('settings', { id: 'enterprise_license', value: lic });
    }
  },

  clearLocalLicense() {
    IdbStore.delete('settings', 'enterprise_license');
  },

  deleteItem(itemId) {
    const items = this.getItems();
    const filtered = items.filter(it => it.id !== itemId);
    localStorage.setItem(this.KEYS.ITEMS, JSON.stringify(filtered));
    IdbStore.delete('items', itemId);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      IdbStore.enqueueSync('delete_item', { id: itemId });
      this.notifySyncStatus('offline', 'Product deletion queued offline');
    } else {
      this.syncRemote('delete_item', { id: itemId });
    }
  },

  // -----------------------------------------------------------
  // QUOTATION MODULE (CRUD)
  // -----------------------------------------------------------
  normalizeQuotation(q) {
    if (!q) return q;
    // Ensure items array
    if (!Array.isArray(q.items)) {
      if (typeof q.itemsJson === 'string') {
        try { q.items = JSON.parse(q.itemsJson); } catch (e) { q.items = []; }
      } else if (Array.isArray(q.itemsJson)) {
        q.items = q.itemsJson;
      } else {
        q.items = [];
      }
    }
    // Ensure calculations array
    if (!Array.isArray(q.calculations)) {
      if (typeof q.calculationsJson === 'string') {
        try { q.calculations = JSON.parse(q.calculationsJson); } catch (e) { q.calculations = []; }
      } else if (Array.isArray(q.calculationsJson)) {
        q.calculations = q.calculationsJson;
      } else {
        q.calculations = [];
      }
    }
    // Ensure additionalCharges array
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
    try {
      const data = localStorage.getItem(this.KEYS.QUOTATIONS);
      const list = data ? JSON.parse(data) : DEFAULT_SAMPLE_QUOTATIONS;
      return list.map(q => this.normalizeQuotation(q));
    } catch (e) {
      console.warn('[StorageManager] Error parsing quotations:', e);
      return DEFAULT_SAMPLE_QUOTATIONS.map(q => this.normalizeQuotation(q));
    }
  },

  getQuotationById(id) {
    const quotes = this.getQuotations();
    return quotes.find(q => q.id === id) || null;
  },

  saveQuotation(quote) {
    try {
      console.log('[StorageManager] saveQuotation called with payload:', quote);
      const quotes = this.getQuotations();
      if (!quote.id) {
        quote.id = 'qt_' + Date.now();
        quote.createdAt = new Date().toISOString();
      }
      quote.updatedAt = new Date().toISOString();

      if (!quote.createdBy) {
        const activeUser = window.AuthManager && AuthManager.getCurrentUser();
        quote.createdBy = (activeUser && (activeUser.fullName || activeUser.username)) || 'Super Admin';
      }

      if (!quote.quoteNumber) {
        quote.quoteNumber = this.generateNextQuoteNumber();
      }

      // Attach JSON serialized strings for sheet compatibility
      if (quote.items) {
        quote.itemsJson = typeof quote.items === 'string' ? quote.items : JSON.stringify(quote.items);
      }
      if (quote.calculations) {
        quote.calculationsJson = typeof quote.calculations === 'string' ? quote.calculations : JSON.stringify(quote.calculations);
      }
      if (quote.additionalCharges) {
        quote.additionalChargesJson = typeof quote.additionalCharges === 'string' ? quote.additionalCharges : JSON.stringify(quote.additionalCharges);
      }

      const idx = quotes.findIndex(q => q.id === quote.id);
      if (idx >= 0) {
        quotes[idx] = quote;
      } else {
        quotes.unshift(quote);
      }

      try {
        localStorage.setItem(this.KEYS.QUOTATIONS, JSON.stringify(quotes));
      } catch (storageErr) {
        console.warn('[StorageManager] localStorage quota exceeded or error:', storageErr);
      }

      // 1. Immediately persist to IndexedDB & Electron local_database.json
      IdbStore.put('quotations', quote);
      this.syncToElectronDb();

      // 2. Network-aware sync / Offline queuing
      if (!navigator.onLine) {
        IdbStore.enqueueSync('save_quotation', quote);
        this.notifySyncStatus('offline', 'Quotation saved offline (IndexedDB)');
      } else {
        this.syncRemote('save_quotation', quote);
      }
      return quote;
    } catch (err) {
      console.error('[StorageManager] Failed to save quotation:', err);
      throw err;
    }
  },

  deleteQuotation(quoteId) {
    const quotes = this.getQuotations();
    const filtered = quotes.filter(q => q.id !== quoteId);
    localStorage.setItem(this.KEYS.QUOTATIONS, JSON.stringify(filtered));
    IdbStore.delete('quotations', quoteId);
    this.syncToElectronDb();

    if (!navigator.onLine) {
      IdbStore.enqueueSync('delete_quotation', { id: quoteId });
      this.notifySyncStatus('offline', 'Quotation deletion queued offline');
    } else {
      this.syncRemote('delete_quotation', { id: quoteId });
    }
  },

  duplicateQuotation(quoteId) {
    const source = this.getQuotationById(quoteId);
    if (!source) return null;

    const copy = JSON.parse(JSON.stringify(source));
    copy.id = 'qt_' + Date.now();
    copy.quoteNumber = this.generateNextQuoteNumber();
    copy.date = new Date().toISOString().split('T')[0];
    
    const exp = new Date();
    exp.setDate(exp.getDate() + 7);
    copy.validUntil = exp.toISOString().split('T')[0];
    copy.status = 'Draft';
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;

    return this.saveQuotation(copy);
  },

  generateNextQuoteNumber() {
    const quotes = this.getQuotations();
    const now = new Date();
    const currentYear = now.getFullYear();
    const month = now.getMonth();
    let fyStart = currentYear;
    let fyEnd = currentYear + 1;
    if (month < 3) {
      fyStart = currentYear - 1;
      fyEnd = currentYear;
    }
    const fyCode = `${fyStart}-${String(fyEnd).slice(-2)}`;

    const prefix = `QT-${fyCode}-`;
    let maxNum = 0;
    quotes.forEach(q => {
      if (q.quoteNumber && q.quoteNumber.startsWith(prefix)) {
        const parts = q.quoteNumber.split('-');
        const lastPart = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastPart) && lastPart > maxNum) {
          maxNum = lastPart;
        }
      }
    });

    const nextIndex = String(maxNum + 1).padStart(3, '0');
    return `${prefix}${nextIndex}`;
  },

  // -----------------------------------------------------------
  // Cloudflare D1 Remote Sync Engine
  // -----------------------------------------------------------

  async autoSyncOnOnline() {
    console.log('[StorageManager] Auto-sync triggered by online event.');
    if (!navigator.onLine) return;

    try {
      this.notifySyncStatus('syncing', 'Network restored. Synchronizing offline queue...');

      // 1. Flush any pending offline items from IndexedDB sync queue
      const queue = await IdbStore.getSyncQueue();
      if (queue && queue.length > 0) {
        console.log(`[StorageManager] Processing ${queue.length} offline queued actions...`);
        for (const item of queue) {
          try {
            await this.syncRemote(item.action, item.payload);
          } catch (qErr) {
            console.warn('[StorageManager] Queue item sync warning:', qErr);
          }
        }
        await IdbStore.clearSyncQueue();
      }

      // 2. Perform a full state sync to ensure local is up to date with Cloudflare D1
      await this.pullAllFromCloud();
      this.notifySyncStatus('online', 'Synchronized with Cloudflare D1');
      if (typeof App !== 'undefined' && App.showToast) {
        App.showToast('Internet restored! Local database synchronized with Cloudflare D1.', 'success');
      }
    } catch (e) {
      console.error('[StorageManager] Auto-sync error:', e);
      this.notifySyncStatus('offline', 'Auto-sync pending (will retry)');
    }
  },

  async syncRemote(action, payload) {
    console.log(`[StorageManager] syncRemote action="${action}"`, payload);
    if (!navigator.onLine) {
      console.log('[StorageManager] Device offline. Saved locally.');
      this.notifySyncStatus('offline', 'Offline (Saved locally)');
      return;
    }

    // 1. Cloudflare Worker REST API (Zero-Dependency Cloudflare Ecosystem)
    let workerSuccess = false;
    try {
      this.notifySyncStatus('syncing', `Syncing ${action} to Cloudflare D1...`);
      if (action === 'save_quotation' || action === 'saveQuotation' || action === 'updateQuotation') {
        const res = await this.fetchWithAuth('/api/quotations', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.ok) workerSuccess = true;
      } else if (action === 'delete_quotation' || action === 'deleteQuotation') {
        const quoteId = payload?.id || payload;
        const res = await this.fetchWithAuth(`/api/quotations/${quoteId}`, { method: 'DELETE' });
        if (res.ok) workerSuccess = true;
      } else if (action === 'save_client' || action === 'saveClient' || action === 'updateClient') {
        const res = await this.fetchWithAuth('/api/clients', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.ok) workerSuccess = true;
      } else if (action === 'delete_client' || action === 'deleteClient') {
        const clientId = payload?.id || payload;
        const res = await this.fetchWithAuth(`/api/clients/${clientId}`, { method: 'DELETE' });
        if (res.ok) workerSuccess = true;
      } else if (action === 'save_item' || action === 'saveItem' || action === 'updateItem') {
        const res = await this.fetchWithAuth('/api/items', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.ok) workerSuccess = true;
      } else if (action === 'delete_item' || action === 'deleteItem') {
        const itemId = payload?.id || payload;
        const res = await this.fetchWithAuth(`/api/items/${itemId}`, { method: 'DELETE' });
        if (res.ok) workerSuccess = true;
      } else if (action === 'save_settings' || action === 'saveSettings') {
        const res = await this.fetchWithAuth('/api/settings', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.ok) workerSuccess = true;
      } else if (action === 'save_user' || action === 'saveUser') {
        const res = await this.fetchWithAuth('/api/users', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (res.ok) workerSuccess = true;
      } else if (action === 'delete_user' || action === 'deleteUser') {
        const userId = payload?.id || payload;
        const res = await this.fetchWithAuth(`/api/users/${userId}`, { method: 'DELETE' });
        if (res.ok) workerSuccess = true;
      }

      if (workerSuccess) {
        this.notifySyncStatus('online', 'Synced with Cloudflare D1');
      }
    } catch (workerErr) {
      console.warn(`[StorageManager] Cloudflare Worker sync notice for ${action}:`, workerErr);
    }
  },

  async pullAllFromCloud() {
    if (!navigator.onLine) return { success: false, message: 'Offline' };
    this.notifySyncStatus('syncing', 'Synchronizing with Cloudflare D1...');

    try {
      // 1. Fetch Quotations
      const qRes = await this.fetchWithAuth('/api/quotations?limit=500', { method: 'GET' });
      if (qRes.ok) {
        const qData = await qRes.json();
        if (qData.success && Array.isArray(qData.quotations) && qData.quotations.length > 0) {
          const norm = qData.quotations.map(q => this.normalizeQuotation(q));
          localStorage.setItem(this.KEYS.QUOTATIONS, JSON.stringify(norm));
          IdbStore.putAll('quotations', norm).catch(() => {});
        }
      }

      // 2. Fetch Clients
      const cRes = await this.fetchWithAuth('/api/clients?limit=500', { method: 'GET' });
      if (cRes.ok) {
        const cData = await cRes.json();
        if (cData.success && Array.isArray(cData.clients) && cData.clients.length > 0) {
          localStorage.setItem(this.KEYS.CLIENTS, JSON.stringify(cData.clients));
          IdbStore.putAll('clients', cData.clients).catch(() => {});
        }
      }

      // 3. Fetch Items
      const iRes = await this.fetchWithAuth('/api/items?limit=500', { method: 'GET' });
      if (iRes.ok) {
        const iData = await iRes.json();
        if (iData.success && Array.isArray(iData.items) && iData.items.length > 0) {
          localStorage.setItem(this.KEYS.ITEMS, JSON.stringify(iData.items));
          IdbStore.putAll('items', iData.items).catch(() => {});
        }
      }

      // 4. Fetch Settings
      const sRes = await this.fetchWithAuth('/api/settings', { method: 'GET' });
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData.success && sData.settings) {
          const merged = { ...this.getSettings(), ...sData.settings };
          localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(merged));
          IdbStore.put('settings', { id: 'global', value: merged }).catch(() => {});
        }
      }

      // 5. Fetch Users (if Super Admin)
      if (window.AuthManager && AuthManager.isSuperAdmin()) {
        await AuthManager.fetchUsersFromCloud();
      }

      this.syncToElectronDb();
      const syncTime = new Date().toISOString();
      localStorage.setItem(this.KEYS.LAST_SYNC, syncTime);
      this.notifySyncStatus('online', `Last synced: ${new Date(syncTime).toLocaleTimeString()}`);
      return { success: true, message: 'Cloud database synchronized successfully!' };
    } catch (e) {
      console.warn('[StorageManager] Cloudflare Worker pull note:', e);
      return { success: false, message: e.message };
    }
  },

  async fetchQuotationsFromCloud(filters = {}) {
    if (!navigator.onLine) {
      return { quotations: this.getQuotations(), total: this.getQuotations().length };
    }
    try {
      const params = new URLSearchParams();
      if (filters.from || filters.startDate) params.set('from', filters.from || filters.startDate);
      if (filters.to || filters.endDate) params.set('to', filters.to || filters.endDate);
      if (filters.month && filters.month !== 'ALL') params.set('month', filters.month);
      if (filters.year && filters.year !== 'ALL') params.set('year', filters.year);
      if (filters.search) params.set('search', filters.search);
      if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
      if (filters.limit) params.set('limit', filters.limit);
      if (filters.offset !== undefined) params.set('offset', filters.offset);

      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await this.fetchWithAuth(`/api/quotations${qs}`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.quotations)) {
          const norm = data.quotations.map(q => this.normalizeQuotation(q));
          return { quotations: norm, total: data.total || norm.length };
        }
      }
    } catch (e) {
      console.warn('[StorageManager] fetchQuotationsFromCloud error:', e);
    }
    return { quotations: this.getQuotations(), total: this.getQuotations().length };
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
  },

  // -----------------------------------------------------------
  // JSON Backup & Restore (Full IndexedDB & Electron Storage Export & Import)
  // -----------------------------------------------------------
  async exportBackup() {
    let quotations = await IdbStore.getAll('quotations');
    if (!quotations || quotations.length === 0) quotations = this.getQuotations();

    let clients = await IdbStore.getAll('clients');
    if (!clients || clients.length === 0) clients = this.getClients();

    let items = await IdbStore.getAll('items');
    if (!items || items.length === 0) items = this.getItems();

    const settings = this.getSettings();

    const bundle = {
      app: 'Jalaram Enterprise Quotation Manager',
      company: settings.company?.name || 'Jalaram Enterprise',
      version: '3.5.0',
      exportedAt: new Date().toISOString(),
      settings: settings,
      quotations: quotations,
      clients: clients,
      items: items
    };

    // If running in Electron, use native Save Dialog
    if (this.isElectron()) {
      try {
        const res = await window.electronAPI.exportDatabase(bundle);
        if (res && res.success) {
          return { success: true, message: `Backup saved to ${res.filePath}` };
        } else if (res && res.canceled) {
          return { success: false, message: 'Export canceled by user' };
        }
      } catch (err) {
        console.warn('[StorageManager] Electron export dialog error, falling back to download:', err);
      }
    }

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jalaram_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { success: true, message: 'Backup file downloaded successfully' };
  },

  async importBackup(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data || (!data.quotations && !data.clients && !data.items && !data.settings)) {
        throw new Error('Invalid backup file format. Must be a valid jalaram_backup.json file.');
      }

      // 1. Clear IndexedDB stores
      await IdbStore.clear('quotations');
      await IdbStore.clear('clients');
      await IdbStore.clear('items');
      await IdbStore.clear('settings');

      // 2. Clear localStorage caches
      localStorage.removeItem(this.KEYS.QUOTATIONS);
      localStorage.removeItem(this.KEYS.CLIENTS);
      localStorage.removeItem(this.KEYS.ITEMS);
      localStorage.removeItem(this.KEYS.SETTINGS);

      // 3. Restore Settings
      if (data.settings) {
        localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(data.settings));
        await IdbStore.put('settings', { id: 'app_settings', value: data.settings });
      }

      // 4. Restore Quotations
      if (Array.isArray(data.quotations) && data.quotations.length > 0) {
        localStorage.setItem(this.KEYS.QUOTATIONS, JSON.stringify(data.quotations));
        await IdbStore.putAll('quotations', data.quotations);
      }

      // 5. Restore Clients
      if (Array.isArray(data.clients) && data.clients.length > 0) {
        localStorage.setItem(this.KEYS.CLIENTS, JSON.stringify(data.clients));
        await IdbStore.putAll('clients', data.clients);
      }

      // 6. Restore Items Master
      if (Array.isArray(data.items) && data.items.length > 0) {
        localStorage.setItem(this.KEYS.ITEMS, JSON.stringify(data.items));
        await IdbStore.putAll('items', data.items);
      }

      // 7. Sync to persistent Electron local_database.json
      await this.syncToElectronDb();

      return { success: true, message: 'Data restored successfully! Please refresh' };
    } catch (e) {
      return { success: false, message: 'Failed to restore backup: ' + e.message };
    }
  }
};

window.StorageManager = StorageManager;
window.IdbStore = IdbStore;
