/**
 * Quotation Manager - Main Application Controller
 * Handles UI routing, reactivity, modals, quotation lifecycle, Item Master CRUD,
 * email dispatch, and PWA installation.
 */

const App = {
  currentTab: 'dashboard',
  currentQuotation: null,
  emailTargetQuote: null,
  deferredInstallPrompt: null,
  quotesPage: 1,
  quotesPageSize: 15,
  clientsPage: 1,
  clientsPageSize: 15,
  itemsPage: 1,
  itemsPageSize: 15,
  pendingClientCsvData: null,
  pendingItemCsvData: null,

  async init() {
    try {
      await StorageManager.init();
    } catch (e) {
      console.warn('[App] StorageManager.init error:', e);
    }
    this.registerServiceWorker();
    this.initSyncStatusListener();
    this.setupEventListeners();

    // Check authentication and setup gates
    const isReady = this.checkGatekeepers();
    if (isReady) {
      this.refreshCloudDataInBackground();
    }
  },

  async refreshCloudDataInBackground() {
    if (!AuthManager.isAuthenticated()) return;
    try {
      console.log('[App] Refreshing live data from Cloudflare D1...');
      const res = await StorageManager.pullAllFromCloud();
      this.renderActiveTab();
      if (!res.success && res.offline) {
        this.showToast('No Internet Connection - Please check your network', 'error');
      }
    } catch (err) {
      console.warn('[App] Background cloud refresh note:', err);
      this.renderActiveTab();
    }
  },

  async refreshDataLive() {
    this.showToast('Connecting to Cloudflare D1...', 'info');
    const res = await StorageManager.pullAllFromCloud();
    this.renderActiveTab();
    if (res.success) {
      this.showToast('Connected to Cloudflare D1!', 'success');
    } else {
      this.showToast('No Internet Connection - Please check your network', 'error');
    }
  },

  renderActiveTab() {
    switch (this.currentTab) {
      case 'dashboard': this.renderDashboard(); break;
      case 'quotations': this.renderQuotationsList(); break;
      case 'clients': this.renderClientsList(); break;
      case 'items': this.renderItemsList(); break;
      case 'users': this.renderUsersList(); break;
      case 'settings': this.renderSettings(); break;
    }
  },

  // -------------------------------------------------------------
  // Service Worker
  // -------------------------------------------------------------
  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('Service Worker registered with scope:', reg.scope))
          .catch(err => console.log('Service Worker registration failed:', err));
      });
    }
  },

  // -------------------------------------------------------------
  // Sync Status & Online / Offline Monitors
  // -------------------------------------------------------------
  initSyncStatusListener() {
    const updateSyncBadge = (statusInfo) => {
      const badge = document.getElementById('cloud-sync-badge');
      if (!badge) return;

      if (!navigator.onLine) {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-400"></span> <span class="hidden sm:inline">Offline Mode</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-300';
        return;
      }

      if (statusInfo.status === 'syncing') {
        badge.innerHTML = `<i class="fa-solid fa-rotate fa-spin text-blue-600"></i> <span class="hidden sm:inline">Syncing...</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200';
      } else if (statusInfo.status === 'online') {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> <span class="hidden sm:inline">Cloudflare D1 Synced</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200';
      } else {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> <span class="hidden sm:inline">Local Cache Active</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 cursor-pointer';
        badge.title = 'Operating with local database';
        badge.onclick = () => App.switchTab('settings');
      }
    };

    StorageManager.onSyncStatusChange(updateSyncBadge);
    window.addEventListener('online', () => updateSyncBadge({ status: 'online' }));
    window.addEventListener('offline', () => updateSyncBadge({ status: 'offline' }));
    updateSyncBadge({ status: 'ready' });
  },

  // -------------------------------------------------------------
  // Security, RBAC & Login Gatekeeper Handlers
  // -------------------------------------------------------------
  checkGatekeepers() {
    const appShell = document.getElementById('app-shell');

    // Strict Login gate (if session token is missing)
    if (!AuthManager.isAuthenticated()) {
      if (appShell) appShell.classList.add('hidden');
      this.showSetupGate(false);
      this.showLoginGate(true);
      return false;
    }

    // User is authenticated: reveal app shell
    this.showLoginGate(false);
    this.showSetupGate(false);
    if (appShell) appShell.classList.remove('hidden');

    this.updateUserInterfaceForAuth();
    this.renderCurrentTab();
    return true;
  },

  showSetupGate(show) {
    // Deprecated: Login Gate is strictly enforced on initial load
  },

  showLoginGate(show) {
    const modal = document.getElementById('login-gate-modal');
    if (!modal) return;
    if (show) {
      modal.classList.remove('hidden');
      const userInput = document.getElementById('login-username-input');
      if (userInput) setTimeout(() => userInput.focus(), 100);
    } else {
      modal.classList.add('hidden');
    }
  },

  async handleLoginSubmit(e) {
    e.preventDefault();
    const userInp = document.getElementById('login-username-input');
    const passInp = document.getElementById('login-password-input');
    const alertBox = document.getElementById('login-gate-alert');
    const btn = document.getElementById('btn-login-submit');

    const username = userInp?.value || '';
    const password = passInp?.value || '';

    if (alertBox) {
      alertBox.classList.add('hidden');
      alertBox.className = 'text-xs p-3 rounded-xl mb-4 font-semibold';
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...`;
    }

    try {
      const res = await AuthManager.login(username, password);
      if (res.success) {
        if (alertBox) {
          alertBox.innerText = res.message || 'Login successful!';
          alertBox.classList.remove('hidden');
          alertBox.className = 'text-xs p-3 rounded-xl mb-4 font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200';
        }
        setTimeout(() => {
          this.showLoginGate(false);
          const appShell = document.getElementById('app-shell');
          if (appShell) appShell.classList.remove('hidden');
          this.updateUserInterfaceForAuth();
          this.renderCurrentTab();
          this.refreshCloudDataInBackground();
          this.showToast('Welcome, ' + (res.user?.fullName || res.user?.username) + '!', 'success');
        }, 300);
      } else {
        if (alertBox) {
          alertBox.innerText = res.message || 'Invalid username or password.';
          alertBox.classList.remove('hidden');
          alertBox.className = 'text-xs p-3 rounded-xl mb-4 font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        }
        this.showToast(res.message || 'Login failed', 'error');
      }
    } catch (err) {
      if (alertBox) {
        alertBox.innerText = err.message || 'An error occurred during authentication.';
        alertBox.classList.remove('hidden');
        alertBox.className = 'text-xs p-3 rounded-xl mb-4 font-semibold bg-rose-50 text-rose-800 border border-rose-200';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-right-to-bracket text-amber-400"></i> <span>Sign In to Dashboard</span>`;
      }
    }
  },

  handleAuthRequired() {
    const appShell = document.getElementById('app-shell');
    if (appShell) appShell.classList.add('hidden');
    this.showLoginGate(true);
  },

  togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (btnEl) btnEl.innerHTML = '<i class="fa-solid fa-eye-slash text-xs"></i>';
    } else {
      input.type = 'password';
      if (btnEl) btnEl.innerHTML = '<i class="fa-solid fa-eye text-xs"></i>';
    }
  },

  updateUserInterfaceForAuth() {
    const user = AuthManager.getCurrentUser();
    if (!user) return;

    // Header user display
    const headerWrapper = document.getElementById('header-user-wrapper');
    const headerName = document.getElementById('header-user-name');
    const headerRole = document.getElementById('header-user-role-badge');
    if (headerWrapper) headerWrapper.classList.remove('hidden');
    if (headerName) headerName.textContent = user.fullName || user.username;
    if (headerRole) {
      headerRole.textContent = user.role || (user.isSuperAdmin ? 'Super Admin' : 'Sub-Admin');
      if (user.isSuperAdmin) {
        headerRole.className = 'bg-amber-400 text-blue-950 font-black text-[9px] px-1.5 py-0.5 rounded uppercase';
      } else {
        headerRole.className = 'bg-purple-200 text-purple-950 font-black text-[9px] px-1.5 py-0.5 rounded uppercase';
      }
    }

    // Settings user profile
    const profUser = document.getElementById('settings-profile-username');
    const profRole = document.getElementById('settings-profile-role');
    if (profUser) profUser.textContent = user.username;
    if (profRole) profRole.textContent = user.role || (user.isSuperAdmin ? 'Super Admin' : 'Sub-Admin');

    // Nav Users tab: only visible to Super Admin
    const usersTabBtn = document.getElementById('nav-btn-users');
    if (usersTabBtn) {
      if (AuthManager.isSuperAdmin()) {
        usersTabBtn.classList.remove('hidden');
      } else {
        usersTabBtn.classList.add('hidden');
        if (this.currentTab === 'users') {
          this.switchTab('dashboard');
        }
      }
    }

    // Enforce action permissions
    const btnCreateQuoteDash = document.getElementById('btn-create-quote-dash');
    const btnCreateQuoteList = document.getElementById('btn-create-quote-list');
    if (btnCreateQuoteDash) btnCreateQuoteDash.style.display = AuthManager.canCreateQuotations() ? '' : 'none';
    if (btnCreateQuoteList) btnCreateQuoteList.style.display = AuthManager.canCreateQuotations() ? '' : 'none';

    const btnAddClient = document.getElementById('btn-add-client');
    const btnImportClientCsv = document.getElementById('btn-import-client-csv');
    if (btnAddClient) btnAddClient.style.display = AuthManager.canManageClients() ? '' : 'none';
    if (btnImportClientCsv) btnImportClientCsv.style.display = AuthManager.canManageClients() ? '' : 'none';

    const btnAddItem = document.getElementById('btn-add-item');
    const btnImportItemCsv = document.getElementById('btn-import-item-csv');
    if (btnAddItem) btnAddItem.style.display = AuthManager.canManageItems() ? '' : 'none';
    if (btnImportItemCsv) btnImportItemCsv.style.display = AuthManager.canManageItems() ? '' : 'none';
  },

  openChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    const alertBox = document.getElementById('change-pass-alert');
    if (alertBox) alertBox.classList.add('hidden');
    const oldP = document.getElementById('change-pass-old');
    const newP = document.getElementById('change-pass-new');
    const confP = document.getElementById('change-pass-confirm');
    if (oldP) oldP.value = '';
    if (newP) newP.value = '';
    if (confP) confP.value = '';
    if (modal) modal.classList.remove('hidden');
  },

  closeChangePasswordModal() {
    const modal = document.getElementById('change-password-modal');
    if (modal) modal.classList.add('hidden');
  },

  async handleChangePasswordSubmit(e) {
    e.preventDefault();
    const oldP = document.getElementById('change-pass-old')?.value || '';
    const newP = document.getElementById('change-pass-new')?.value || '';
    const confP = document.getElementById('change-pass-confirm')?.value || '';
    const alertBox = document.getElementById('change-pass-alert');

    if (newP !== confP) {
      if (alertBox) {
        alertBox.textContent = 'New passwords do not match!';
        alertBox.className = 'text-xs p-2.5 rounded-lg font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    const res = await AuthManager.changePassword(oldP, newP);
    if (res.success) {
      this.showToast(res.message, 'success');
      this.closeChangePasswordModal();
    } else {
      if (alertBox) {
        alertBox.textContent = res.message;
        alertBox.className = 'text-xs p-2.5 rounded-lg font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
    }
  },

  // -------------------------------------------------------------
  // Users & Roles (RBAC) Dashboard Controller
  // -------------------------------------------------------------
  renderUsersList() {
    if (!AuthManager.isSuperAdmin()) {
      this.switchTab('dashboard');
      return;
    }
    const users = AuthManager.getUsers();
    const tbody = document.getElementById('users-list-tbody');
    if (!tbody) return;

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => {
      const isSuper = !!(u.isSuperAdmin || u.role === 'Super Admin');
      const perms = u.permissions || {};
      const permBadges = isSuper ? 
        `<span class="bg-amber-100 text-amber-900 px-2 py-0.5 rounded text-[10px] font-bold">FULL ACCESS (SUPER ADMIN)</span>` :
        `
          <div class="flex flex-wrap gap-1">
            ${perms.canManageClients ? '<span class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">Clients</span>' : ''}
            ${perms.canCreateQuotations ? '<span class="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">Quotes</span>' : ''}
            ${perms.canManageItems ? '<span class="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">Items</span>' : ''}
            ${perms.canDeleteQuotes ? '<span class="bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">Delete</span>' : ''}
            ${perms.canManageSettings ? '<span class="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">Settings</span>' : ''}
          </div>
        `;

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors text-xs">
          <td class="py-3 px-3 font-bold text-slate-900">
            ${this.escapeHtml(u.fullName || u.username)}
          </td>
          <td class="py-3 px-3 font-mono font-bold text-blue-900">
            ${this.escapeHtml(u.username)}
          </td>
          <td class="py-3 px-3">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${isSuper ? 'bg-amber-100 text-amber-900' : 'bg-purple-100 text-purple-900'}">
              ${u.role || (isSuper ? 'Super Admin' : 'Sub-Admin')}
            </span>
          </td>
          <td class="py-3 px-3">
            ${permBadges}
          </td>
          <td class="py-3 px-3 text-slate-500">
            ${PdfGenerator.formatDate(u.createdAt || new Date().toISOString())}
          </td>
          <td class="py-3 px-3 text-right">
            ${isSuper ? '<span class="text-[11px] font-bold text-slate-400 italic">Protected</span>' : `
              <div class="inline-flex items-center gap-1">
                <button onclick="App.openUserEditorModal('${u.id}')" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Edit Permissions">
                  <i class="fa-solid fa-user-pen text-sm"></i>
                </button>
                <button onclick="App.deleteUser('${u.id}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Delete User">
                  <i class="fa-solid fa-trash-can text-sm"></i>
                </button>
              </div>
            `}
          </td>
        </tr>
      `;
    }).join('');
  },

  openUserEditorModal(userId) {
    const modal = document.getElementById('user-editor-modal');
    const title = document.getElementById('user-modal-title');
    const idInp = document.getElementById('edit-user-id');
    const nameInp = document.getElementById('edit-user-fullname');
    const userInp = document.getElementById('edit-user-username');
    const roleInp = document.getElementById('edit-user-role');
    const passInp = document.getElementById('edit-user-password');

    const permClients = document.getElementById('perm-manage-clients');
    const permQuotes = document.getElementById('perm-create-quotes');
    const permItems = document.getElementById('perm-manage-items');
    const permDelete = document.getElementById('perm-delete-records');
    const permSettings = document.getElementById('perm-manage-settings');

    if (userId) {
      const users = AuthManager.getUsers();
      const u = users.find(x => x.id === userId);
      if (!u) return;

      if (idInp) idInp.value = u.id;
      if (nameInp) nameInp.value = u.fullName || '';
      if (userInp) {
        userInp.value = u.username || '';
        userInp.disabled = true;
      }
      if (roleInp) roleInp.value = u.role || 'Sub-Admin';
      if (passInp) passInp.value = '';
      if (title) title.innerHTML = '<i class="fa-solid fa-user-pen"></i> <span>Edit Sub-Admin Permissions</span>';

      const perms = u.permissions || {};
      if (permClients) permClients.checked = !!perms.canManageClients;
      if (permQuotes) permQuotes.checked = !!perms.canCreateQuotations;
      if (permItems) permItems.checked = !!perms.canManageItems;
      if (permDelete) permDelete.checked = !!perms.canDeleteQuotes;
      if (permSettings) permSettings.checked = !!perms.canManageSettings;
    } else {
      if (idInp) idInp.value = '';
      if (nameInp) nameInp.value = '';
      if (userInp) {
        userInp.value = '';
        userInp.disabled = false;
      }
      if (roleInp) roleInp.value = 'Sub-Admin';
      if (passInp) passInp.value = '';
      if (title) title.innerHTML = '<i class="fa-solid fa-user-plus"></i> <span>Add New Sub-Admin</span>';

      if (permClients) permClients.checked = true;
      if (permQuotes) permQuotes.checked = true;
      if (permItems) permItems.checked = false;
      if (permDelete) permDelete.checked = false;
      if (permSettings) permSettings.checked = false;
    }

    if (modal) modal.classList.remove('hidden');
  },

  closeUserEditorModal() {
    const modal = document.getElementById('user-editor-modal');
    if (modal) modal.classList.add('hidden');
  },

  async handleSaveUserSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-user-id')?.value;
    const fullName = document.getElementById('edit-user-fullname')?.value || '';
    const username = document.getElementById('edit-user-username')?.value || '';
    const role = document.getElementById('edit-user-role')?.value || 'Sub-Admin';
    const password = document.getElementById('edit-user-password')?.value || '';

    if (!username.trim()) {
      this.showToast('Username is required.', 'error');
      document.getElementById('edit-user-username')?.focus();
      return;
    }

    // Strict Password Validation (Min 6 Characters)
    if (!id) {
      if (!password || password.length < 6) {
        this.showToast('Password must be at least 6 characters long.', 'error');
        document.getElementById('edit-user-password')?.focus();
        return;
      }
    } else {
      if (password && password.length < 6) {
        this.showToast('Password must be at least 6 characters long.', 'error');
        document.getElementById('edit-user-password')?.focus();
        return;
      }
    }

    const permissions = {
      canManageClients: !!document.getElementById('perm-manage-clients')?.checked,
      canCreateQuotations: !!document.getElementById('perm-create-quotes')?.checked,
      canEditQuotes: !!document.getElementById('perm-create-quotes')?.checked,
      canManageItems: !!document.getElementById('perm-manage-items')?.checked,
      canDeleteQuotes: !!document.getElementById('perm-delete-records')?.checked,
      canManageSettings: !!document.getElementById('perm-manage-settings')?.checked
    };

    const userData = {
      id: id || ('user_sub_' + Date.now()),
      fullName,
      username: username.trim().toLowerCase(),
      role,
      permissions
    };

    if (password) {
      userData.password = password;
      userData.passwordHash = await AuthManager.hashPassword(password);
    } else if (id) {
      const existing = AuthManager.getUsers().find(u => u.id === id);
      if (existing && existing.passwordHash) {
        userData.passwordHash = existing.passwordHash;
      }
    }

    try {
      await AuthManager.saveUser(userData);
      await StorageManager.pullAllFromCloud();
      this.showToast('Sub-admin saved successfully!', 'success');
      this.closeUserEditorModal();
      this.renderUsersList();
    } catch (err) {
      this.showToast(err.message || 'Error saving user', 'error');
    }
  },

  async deleteUser(userId) {
    if (confirm('Are you sure you want to delete this sub-admin account?')) {
      try {
        await AuthManager.deleteUser(userId);
        await StorageManager.pullAllFromCloud();
        this.showToast('Sub-admin account deleted.', 'info');
        this.renderUsersList();
      } catch (err) {
        this.showToast(err.message || 'Error deleting user', 'error');
      }
    }
  },

  // -------------------------------------------------------------
  // Full Cloudflare D1 Database Backup & Restore Handlers
  // -------------------------------------------------------------
  async handleDatabaseBackupExport() {
    if (!AuthManager.isSuperAdmin() && !AuthManager.hasPermission('canBackupDatabase')) {
      this.showToast('Permission denied: Only Super Admin can export database backups.', 'error');
      return;
    }
    try {
      this.showToast('Preparing Cloudflare D1 database export...', 'info');
      const res = await StorageManager.exportBackup();
      this.showToast(res.message || 'Database exported successfully!', 'success');
    } catch (err) {
      this.showToast('Export failed: ' + (err.message || err), 'error');
    }
  },

  async handleDatabaseBackupImport(event) {
    if (!AuthManager.isSuperAdmin() && !AuthManager.hasPermission('canBackupDatabase')) {
      this.showToast('Permission denied: Only Super Admin can import database backups.', 'error');
      if (event?.target) event.target.value = '';
      return;
    }

    const file = event?.target?.files && event.target.files[0];
    if (!file) return;

    if (!confirm('Warning: Restoring this backup will update and merge records in your Cloudflare D1 database. Continue?')) {
      if (event.target) event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        this.showToast('Uploading & restoring database into Cloudflare D1...', 'info');
        const content = e.target.result;
        const res = await StorageManager.importBackup(content);
        if (res && res.success) {
          alert(res.message || 'Database restored successfully to Cloudflare D1!');
          this.renderActiveTab();
        } else {
          alert(res?.error || 'Database restore failed.');
        }
      } catch (err) {
        alert('Failed restoring database: ' + (err.message || err));
      } finally {
        if (event?.target) event.target.value = '';
      }
    };
    reader.readAsText(file);
  },

  // -------------------------------------------------------------
  // Navigation & Tab Switching
  // -------------------------------------------------------------
  switchTab(tabName) {
    this.currentTab = tabName;
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      const t = btn.getAttribute('data-tab');
      if (t === tabName) {
        btn.classList.add('bg-blue-900', 'text-white');
        btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
      } else {
        btn.classList.remove('bg-blue-900', 'text-white');
        btn.classList.add('text-slate-600', 'hover:bg-slate-100');
      }
    });

    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.add('hidden');
    });

    const activeSec = document.getElementById(`view-${tabName}`);
    if (activeSec) {
      activeSec.classList.remove('hidden');
    }

    this.renderCurrentTab();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  renderCurrentTab() {
    switch (this.currentTab) {
      case 'dashboard':
        this.renderDashboard();
        break;
      case 'quotations':
        this.renderQuotationsList();
        break;
      case 'clients':
        this.renderClientsList();
        break;
      case 'items':
        this.renderItemsList();
        break;
      case 'users':
        this.renderUsersList();
        break;
      case 'settings':
        this.renderSettings();
        break;
    }
  },

  setupEventListeners() {
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      });
    });

    const btnSaveTop = document.getElementById('btn-save-quotation-top');
    if (btnSaveTop) {
      btnSaveTop.addEventListener('click', () => this.saveCurrentQuotation());
    }

    const btnSaveBottom = document.getElementById('btn-save-quotation-bottom');
    if (btnSaveBottom) {
      btnSaveBottom.addEventListener('click', () => this.saveCurrentQuotation());
    }

    const btnTestBackend = document.getElementById('btn-test-backend');
    if (btnTestBackend) {
      btnTestBackend.addEventListener('click', () => this.testBackendConnection());
    }

    const btnSyncNow = document.getElementById('btn-sync-now');
    if (btnSyncNow) {
      btnSyncNow.addEventListener('click', () => this.syncNow());
    }
  },

  // -------------------------------------------------------------
  // Dashboard View
  // -------------------------------------------------------------
  renderDashboard() {
    if (StorageManager.isOffline()) {
      const qEl = document.getElementById('dash-total-quotes');
      const vEl = document.getElementById('dash-total-value');
      const cEl = document.getElementById('dash-total-clients');
      const mEl = document.getElementById('dash-month-value');
      if (qEl) qEl.innerText = '—';
      if (vEl) vEl.innerText = '₹ 0.00';
      if (cEl) cEl.innerText = '—';
      if (mEl) mEl.innerText = '₹ 0.00';

      const recentTable = document.getElementById('dash-recent-quotes-table');
      if (recentTable) {
        recentTable.innerHTML = `<tr><td colspan="5" class="py-10 text-center">
          <div class="inline-flex flex-col items-center justify-center p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 max-w-md mx-auto">
            <i class="fa-solid fa-wifi-slash text-2xl text-rose-500 mb-2"></i>
            <div class="font-bold text-sm">No Internet Connection - Please check your network</div>
            <p class="text-xs text-rose-600 mt-1 mb-3">Live connection to Cloudflare D1 is required.</p>
            <button onclick="App.refreshDataLive()" class="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition">
              <i class="fa-solid fa-rotate-right mr-1"></i> Retry Connection
            </button>
          </div>
        </td></tr>`;
      }
      return;
    }

    const quotes = StorageManager.getQuotations();
    const clients = StorageManager.getClients();
    const items = StorageManager.getItems();

    const totalCount = quotes.length;
    const totalValue = quotes.reduce((sum, q) => sum + (parseFloat(q.grandTotal) || 0), 0);

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const thisMonthQuotes = quotes.filter(q => {
      const d = new Date(q.date);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const thisMonthVal = thisMonthQuotes.reduce((sum, q) => sum + (parseFloat(q.grandTotal) || 0), 0);

    document.getElementById('dash-total-quotes').innerText = totalCount;
    document.getElementById('dash-total-value').innerText = CalculationsEngine.formatCurrency(totalValue);
    document.getElementById('dash-total-clients').innerText = clients.length;
    document.getElementById('dash-month-value').innerText = CalculationsEngine.formatCurrency(thisMonthVal);

    const recentTable = document.getElementById('dash-recent-quotes-table');
    if (recentTable) {
      const topQuotes = quotes.slice(0, 5);
      if (topQuotes.length === 0) {
        recentTable.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400">No quotations found. Click "New Quotation" to create one.</td></tr>`;
      } else {
        recentTable.innerHTML = topQuotes.map(q => `
          <tr class="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
            <td class="py-3 px-3 font-mono font-bold text-blue-900">${q.quoteNumber}</td>
            <td class="py-3 px-3">
              <div class="font-semibold text-slate-800">${q.clientCompany || q.clientName}</div>
              <div class="text-xs text-slate-400">${q.clientName || ''}</div>
            </td>
            <td class="py-3 px-3 text-xs text-slate-500">${PdfGenerator.formatDate(q.date)}</td>
            <td class="py-3 px-3 font-bold text-slate-900">${CalculationsEngine.formatCurrency(q.grandTotal)}</td>
            <td class="py-3 px-3 text-right space-x-1">
              <button onclick="App.openPrintPreview('${q.id}')" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Print/Preview">
                <i class="fa-solid fa-eye"></i>
              </button>
              <button onclick="App.editQuotation('${q.id}')" class="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Edit">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
            </td>
          </tr>
        `).join('');
      }
    }
  },

  // -------------------------------------------------------------
  // Quotations List View & Advanced Filters
  // -------------------------------------------------------------
  renderQuotationsList() {
    const quotes = StorageManager.getQuotations();
    const searchVal = (document.getElementById('quote-search-input')?.value || '').toLowerCase().trim();
    const statusVal = document.getElementById('quote-filter-status')?.value || 'ALL';
    const monthVal = document.getElementById('quote-filter-month')?.value || 'ALL';
    const yearVal = document.getElementById('quote-filter-year')?.value || 'ALL';
    const fromDateVal = document.getElementById('quote-filter-from-date')?.value || '';
    const toDateVal = document.getElementById('quote-filter-to-date')?.value || '';

    const filtered = quotes.filter(q => {
      const matchSearch = !searchVal ||
        (q.quoteNumber && q.quoteNumber.toLowerCase().includes(searchVal)) ||
        (q.clientName && q.clientName.toLowerCase().includes(searchVal)) ||
        (q.clientCompany && q.clientCompany.toLowerCase().includes(searchVal));

      const matchStatus = statusVal === 'ALL' || (q.status || 'Draft') === statusVal;

      let matchDate = true;
      if (q.date) {
        const qD = new Date(q.date);
        if (monthVal !== 'ALL' && (qD.getMonth() + 1) !== parseInt(monthVal, 10)) {
          matchDate = false;
        }
        if (yearVal !== 'ALL' && qD.getFullYear() !== parseInt(yearVal, 10)) {
          matchDate = false;
        }
        if (fromDateVal && q.date < fromDateVal) {
          matchDate = false;
        }
        if (toDateVal && q.date > toDateVal) {
          matchDate = false;
        }
      }

      return matchSearch && matchStatus && matchDate;
    });

    const infoEl = document.getElementById('quote-filter-result-info');
    if (infoEl) {
      infoEl.textContent = `Showing ${filtered.length} of ${quotes.length} total quotations`;
    }

    const tbody = document.getElementById('quotes-list-tbody');
    const paginationBar = document.getElementById('quotes-pagination-bar');
    if (!tbody) return;

    if (StorageManager.isOffline()) {
      tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center">
        <div class="inline-flex flex-col items-center justify-center p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 max-w-md mx-auto">
          <i class="fa-solid fa-wifi-slash text-2xl text-rose-500 mb-2"></i>
          <div class="font-bold text-sm">No Internet Connection - Please check your network</div>
          <p class="text-xs text-rose-600 mt-1 mb-3">Cannot load quotations without an active Cloudflare D1 connection.</p>
          <button onclick="App.refreshDataLive()" class="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition">
            <i class="fa-solid fa-rotate-right mr-1"></i> Retry Connection
          </button>
        </div>
      </td></tr>`;
      if (paginationBar) paginationBar.innerHTML = '';
      return;
    }

    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / this.quotesPageSize));
    if (this.quotesPage > totalPages) this.quotesPage = totalPages;
    if (this.quotesPage < 1) this.quotesPage = 1;

    if (totalRecords === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400">No matching quotations found.</td></tr>`;
      if (paginationBar) paginationBar.innerHTML = `<span class="text-xs text-slate-400">0 quotations found</span>`;
      return;
    }

    const startIdx = (this.quotesPage - 1) * this.quotesPageSize;
    const endIdx = Math.min(startIdx + this.quotesPageSize, totalRecords);
    const paginated = filtered.slice(startIdx, endIdx);

    const canDelete = AuthManager.canDeleteQuotes();

    tbody.innerHTML = paginated.map(q => {
      let statusColor = 'bg-slate-100 text-slate-700';
      if (q.status === 'Sent') statusColor = 'bg-blue-100 text-blue-800';
      if (q.status === 'Accepted') statusColor = 'bg-emerald-100 text-emerald-800';
      if (q.status === 'Rejected') statusColor = 'bg-rose-100 text-rose-800';

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors text-xs">
          <td class="py-3 px-3 font-mono font-bold text-blue-900">${q.quoteNumber}</td>
          <td class="py-3 px-3">
            <div class="font-bold text-slate-800 text-sm">${q.clientCompany || q.clientName}</div>
            <div class="text-[11px] text-slate-500">${q.clientName ? 'Attn: ' + q.clientName : ''} ${q.clientPhone ? '• ' + q.clientPhone : ''}</div>
          </td>
          <td class="py-3 px-3 text-slate-600">${PdfGenerator.formatDate(q.date)}</td>
          <td class="py-3 px-3 text-slate-500">${PdfGenerator.formatDate(q.validUntil)}</td>
          <td class="py-3 px-3 font-bold text-slate-900 text-sm">${CalculationsEngine.formatCurrency(q.grandTotal)}</td>
          <td class="py-3 px-3">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusColor}">
              ${q.status || 'Draft'}
            </span>
          </td>
          <td class="py-3 px-3">
            <span class="inline-flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
              <i class="fa-solid fa-user-pen text-slate-400 text-[10px]"></i>
              ${q.createdBy || 'Super Admin'}
            </span>
          </td>
          <td class="py-3 px-3 text-right">
            <div class="inline-flex items-center gap-1">
              <button onclick="App.openPrintPreview('${q.id}')" class="p-1.5 text-blue-700 hover:bg-blue-50 rounded" title="View / Print PDF">
                <i class="fa-solid fa-file-pdf text-sm"></i>
              </button>
              <button onclick="App.editQuotation('${q.id}')" class="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Edit Quote">
                <i class="fa-solid fa-pen-to-square text-sm"></i>
              </button>
              <button onclick="App.duplicateQuote('${q.id}')" class="p-1.5 text-purple-600 hover:bg-purple-50 rounded" title="Duplicate Quote">
                <i class="fa-solid fa-copy text-sm"></i>
              </button>
              ${canDelete ? `
                <button onclick="App.deleteQuote('${q.id}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Delete Quote">
                  <i class="fa-solid fa-trash-can text-sm"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (paginationBar) {
      this.renderPaginationControls(
        paginationBar,
        this.quotesPage,
        totalPages,
        startIdx + 1,
        endIdx,
        totalRecords,
        this.quotesPageSize,
        'App.setQuotesPage',
        'App.setQuotesPageSize',
        'quotations'
      );
    }
  },

  handleQuotationFilterChange() {
    this.quotesPage = 1;
    this.renderQuotationsList();
  },

  resetQuotationFilters() {
    const sInp = document.getElementById('quote-search-input');
    const stInp = document.getElementById('quote-filter-status');
    const mInp = document.getElementById('quote-filter-month');
    const yInp = document.getElementById('quote-filter-year');
    const fInp = document.getElementById('quote-filter-from-date');
    const tInp = document.getElementById('quote-filter-to-date');

    if (sInp) sInp.value = '';
    if (stInp) stInp.value = 'ALL';
    if (mInp) mInp.value = 'ALL';
    if (yInp) yInp.value = 'ALL';
    if (fInp) fInp.value = '';
    if (tInp) tInp.value = '';

    this.quotesPage = 1;
    this.renderQuotationsList();
  },

  // -------------------------------------------------------------
  // ITEM MASTER (CRUD & Profile Image Uploads)
  // -------------------------------------------------------------
  renderItemsList() {
    const items = StorageManager.getItems();
    const searchVal = (document.getElementById('item-search-input')?.value || '').toLowerCase().trim();

    // Metric stats strip
    const totalStatEl = document.getElementById('items-stat-total');
    if (totalStatEl) totalStatEl.textContent = items.length;

    const imgStatEl = document.getElementById('items-stat-images');
    if (imgStatEl) imgStatEl.textContent = items.filter(it => it.imageUrl).length;

    const filtered = items.filter(it => {
      return !searchVal ||
        (it.name && it.name.toLowerCase().includes(searchVal)) ||
        (it.description && it.description.toLowerCase().includes(searchVal)) ||
        (it.unit && it.unit.toLowerCase().includes(searchVal));
    });

    const tbody = document.getElementById('items-list-tbody');
    const paginationBar = document.getElementById('items-pagination-bar');
    if (!tbody) return;

    if (StorageManager.isOffline()) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center">
        <div class="inline-flex flex-col items-center justify-center p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 max-w-md mx-auto">
          <i class="fa-solid fa-wifi-slash text-2xl text-rose-500 mb-2"></i>
          <div class="font-bold text-sm">No Internet Connection - Please check your network</div>
          <p class="text-xs text-rose-600 mt-1 mb-3">Cannot load Item Master without an active Cloudflare D1 connection.</p>
          <button onclick="App.refreshDataLive()" class="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition">
            <i class="fa-solid fa-rotate-right mr-1"></i> Retry Connection
          </button>
        </div>
      </td></tr>`;
      if (paginationBar) paginationBar.innerHTML = '';
      return;
    }

    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / this.itemsPageSize));
    if (this.itemsPage > totalPages) this.itemsPage = totalPages;
    if (this.itemsPage < 1) this.itemsPage = 1;

    if (totalRecords === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No items found in Item Master. Click "Add Product" or "Import CSV" to create one.</td></tr>`;
      if (paginationBar) paginationBar.innerHTML = `<span class="text-xs text-slate-400">0 products found</span>`;
      return;
    }

    const startIdx = (this.itemsPage - 1) * this.itemsPageSize;
    const endIdx = Math.min(startIdx + this.itemsPageSize, totalRecords);
    const paginated = filtered.slice(startIdx, endIdx);

    tbody.innerHTML = paginated.map(it => `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors text-xs">
        <td class="py-2.5 px-3 w-20 text-center">
          ${it.imageUrl ? `
            <img src="${it.imageUrl}" alt="Profile" class="h-8 max-w-16 object-contain mx-auto border border-slate-200 rounded p-0.5 bg-white shadow-xs" />
          ` : `
            <div class="h-8 w-12 bg-slate-100 border border-slate-200 rounded flex items-center justify-center text-[10px] text-slate-400 mx-auto">No Img</div>
          `}
        </td>
        <td class="py-2.5 px-3">
          <div class="font-bold text-slate-900">${this.escapeHtml(it.name)}</div>
          ${it.description ? `<div class="text-[11px] text-slate-500 italic">${this.escapeHtml(it.description)}</div>` : ''}
        </td>
        <td class="py-2.5 px-3 font-semibold text-slate-700">
          <span class="bg-blue-50 text-blue-900 px-2 py-0.5 rounded text-[11px] font-bold">${this.escapeHtml(it.unit || 'PCS')}</span>
        </td>
        <td class="py-2.5 px-3 font-bold text-slate-900 font-mono text-sm">
          ₹ ${parseFloat(it.rate || 0).toFixed(2)}
        </td>
        <td class="py-2.5 px-3 font-semibold text-slate-800 font-mono text-xs">
          ${(parseFloat(it.defaultWidth) || 3.50).toFixed(2)} Ft
        </td>
        <td class="py-2.5 px-3">
          <span class="inline-flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
            <i class="fa-solid fa-user-pen text-slate-400 text-[10px]"></i>
            ${it.createdBy || 'Super Admin'}
          </span>
        </td>
        <td class="py-2.5 px-3 text-right space-x-1">
          <button onclick="App.openItemModal('${it.id}')" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Edit Item">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button onclick="App.deleteItem('${it.id}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Delete Item">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `).join('');

    if (paginationBar) {
      this.renderPaginationControls(
        paginationBar,
        this.itemsPage,
        totalPages,
        startIdx + 1,
        endIdx,
        totalRecords,
        this.itemsPageSize,
        'App.setItemsPage',
        'App.setItemsPageSize',
        'products'
      );
    }
  },

  openItemModal(itemId = null) {
    const modal = document.getElementById('item-modal');
    if (!modal) return;

    if (itemId) {
      const it = StorageManager.getItemById(itemId);
      if (it) {
        document.getElementById('item-form-id').value = it.id;
        document.getElementById('item-form-name').value = it.name || '';
        document.getElementById('item-form-desc').value = it.description || '';
        document.getElementById('item-form-unit').value = it.unit || 'SQ.FEET';
        document.getElementById('item-form-rate').value = it.rate || 0;
        document.getElementById('item-form-width').value = it.defaultWidth !== undefined ? it.defaultWidth : 3.50;
        document.getElementById('item-form-image-data').value = it.imageUrl || '';
        this.renderItemModalPreview(it.imageUrl || '');
      }
    } else {
      document.getElementById('item-form-id').value = '';
      document.getElementById('item-form').reset();
      document.getElementById('item-form-width').value = 3.50;
      document.getElementById('item-form-image-data').value = '';
      this.renderItemModalPreview('');
    }

    modal.classList.remove('hidden');
  },

  closeItemModal() {
    const modal = document.getElementById('item-modal');
    if (modal) modal.classList.add('hidden');
  },

  renderItemModalPreview(url) {
    const preview = document.getElementById('item-form-image-preview');
    if (!preview) return;
    if (url) {
      preview.innerHTML = `<img src="${url}" alt="Profile Preview" class="max-h-16 object-contain mx-auto" />`;
    } else {
      preview.innerHTML = `<span class="text-xs text-slate-400">No profile image uploaded yet</span>`;
    }
  },

  handleItemImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result;
      document.getElementById('item-form-image-data').value = base64;
      this.renderItemModalPreview(base64);
    };
    reader.readAsDataURL(file);
  },

  async saveItemFromModal(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('item-form-id').value;
    const itemData = {
      id: id || undefined,
      name: document.getElementById('item-form-name').value.trim(),
      description: document.getElementById('item-form-desc').value.trim(),
      unit: document.getElementById('item-form-unit').value.trim(),
      rate: parseFloat(document.getElementById('item-form-rate').value) || 0,
      defaultWidth: parseFloat(document.getElementById('item-form-width').value) || 3.50,
      imageUrl: document.getElementById('item-form-image-data').value.trim()
    };

    if (!itemData.name) {
      this.showToast('Please provide an Item Name.', 'error');
      return;
    }

    try {
      await StorageManager.saveItem(itemData);
      this.showToast(`Product "${itemData.name}" saved to Item Master!`, 'success');
      this.closeItemModal();
      this.renderItemsList();
    } catch (err) {
      this.showToast(err.message || 'No Internet Connection - Unable to save item', 'error');
    }
  },

  async deleteItem(itemId) {
    if (!AuthManager.hasPermission('canManageItems') && !AuthManager.isSuperAdmin()) {
      this.showToast('Permission denied: You cannot delete items.', 'error');
      return;
    }
    if (confirm('Are you sure you want to delete this product from Item Master?')) {
      try {
        await StorageManager.deleteItem(itemId);
        this.showToast('Item deleted from master catalog.', 'info');
        this.renderItemsList();
      } catch (err) {
        this.showToast(err.message || 'No Internet Connection - Unable to delete item', 'error');
      }
    }
  },

  // -------------------------------------------------------------
  // Quotation Editor (Create & Edit)
  // -------------------------------------------------------------
  createNewQuotation() {
    const nextNo = StorageManager.generateNextQuoteNumber();
    const today = new Date().toISOString().split('T')[0];
    const exp = new Date();
    exp.setDate(exp.getDate() + 7);

    // Grab first item from master if available
    const masterItems = StorageManager.getItems();
    const firstMaster = masterItems[0] || {
      name: 'PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
      description: '(ROOFING SHEET)',
      unit: 'kg(approx.)',
      rate: 82.00,
      imageUrl: 'assets/profile-indradhanus.svg'
    };

    this.currentQuotation = {
      id: 'qt_' + Date.now(),
      quoteNumber: nextNo,
      date: today,
      validUntil: exp.toISOString().split('T')[0],
      clientId: '',
      clientName: '',
      clientCompany: '',
      clientPhone: '',
      clientEmail: '',
      clientGst: '',
      clientAddress: '',
      items: [
        {
          id: 'item_' + Date.now(),
          description: firstMaster.name,
          subRemarks: firstMaster.description || '',
          imageUrl: firstMaster.imageUrl || '',
          quantity: 100,
          unit: firstMaster.unit || 'SQ.FEET',
          rate: firstMaster.rate || 82.00,
          amount: (100 * (firstMaster.rate || 82.00))
        }
      ],
      loadingCharges: 0,
      additionalCharges: [],
      gstType: 'CGST_SGST',
      customGstRate: 18,
      roundOff: 0,
      notes: '',
      status: 'Draft',
      calculations: [
        {
          id: 'calc_' + Date.now(),
          title: 'Calculation Details for : ' + firstMaster.name,
          sheetWidth: parseFloat(firstMaster.defaultWidth) || 3.50,
          rows: [
            { feet: 10.00, inch: 0.00, nos: 1 }
          ]
        }
      ]
    };

    this.openQuotationEditorModal();
  },

  editQuotation(id) {
    console.log('[App] Opening editQuotation for ID:', id);
    const quote = StorageManager.getQuotationById(id);
    if (!quote) {
      console.error('[App] Quotation not found for ID:', id);
      this.showToast('Quotation not found.', 'error');
      return;
    }
    this.currentQuotation = StorageManager.normalizeQuotation(JSON.parse(JSON.stringify(quote)));
    this.openQuotationEditorModal();
  },

  duplicateQuote(id) {
    const copy = StorageManager.duplicateQuotation(id);
    if (copy) {
      this.showToast(`Quotation duplicated as ${copy.quoteNumber}`, 'success');
      this.renderQuotationsList();
      this.renderDashboard();
    }
  },

  async deleteQuote(id) {
    if (!AuthManager.canDeleteQuotes()) {
      this.showToast('Permission denied: You cannot delete quotations.', 'error');
      return;
    }
    if (confirm('Are you sure you want to delete this quotation permanently?')) {
      try {
        await StorageManager.deleteQuotation(id);
        this.showToast('Quotation deleted.', 'info');
        this.renderQuotationsList();
        this.renderDashboard();
      } catch (err) {
        this.showToast(err.message || 'No Internet Connection - Unable to delete quotation', 'error');
      }
    }
  },

  openQuotationEditorModal() {
    const modal = document.getElementById('quote-editor-modal');
    if (!modal || !this.currentQuotation) return;

    const q = this.currentQuotation;

    // Normalize items, calculations, and additional charges
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

    // Header inputs
    const elNum = document.getElementById('edit-quote-number');
    const elDate = document.getElementById('edit-quote-date');
    const elValid = document.getElementById('edit-quote-valid');
    const elStatus = document.getElementById('edit-quote-status');

    if (elNum) elNum.value = q.quoteNumber || '';
    if (elDate) elDate.value = q.date || '';
    if (elValid) elValid.value = q.validUntil || '';
    if (elStatus) elStatus.value = q.status || 'Draft';

    // Client fields
    this.populateClientDropdown();
    const elCliSel = document.getElementById('edit-client-select');
    const elCliComp = document.getElementById('edit-client-company');
    const elCliName = document.getElementById('edit-client-name');
    const elCliPhone = document.getElementById('edit-client-phone');
    const elCliEmail = document.getElementById('edit-client-email');
    const elCliGst = document.getElementById('edit-client-gst');
    const elCliAddr = document.getElementById('edit-client-address');

    if (elCliSel) elCliSel.value = q.clientId || '';
    if (elCliComp) elCliComp.value = q.clientCompany || '';
    if (elCliName) elCliName.value = q.clientName || '';
    if (elCliPhone) elCliPhone.value = q.clientPhone || '';
    if (elCliEmail) elCliEmail.value = q.clientEmail || '';
    if (elCliGst) elCliGst.value = q.clientGst || '';
    if (elCliAddr) elCliAddr.value = q.clientAddress || '';

    // Financial & Loading charges inputs
    const elLoading = document.getElementById('edit-quote-loading');
    const elGstType = document.getElementById('edit-quote-gst-type');
    const elNotes = document.getElementById('edit-quote-notes');

    if (elLoading) elLoading.value = q.loadingCharges !== undefined ? q.loadingCharges : 0;
    if (elGstType) elGstType.value = q.gstType || 'CGST_SGST';
    if (elNotes) elNotes.value = q.notes || '';

    // Render items and calculation blocks
    this.renderEditorItemsTable();
    this.renderEditorCalculations();
    this.recalculateEditorFinancials();

    modal.classList.remove('hidden');
  },

  closeQuotationEditorModal() {
    const modal = document.getElementById('quote-editor-modal');
    if (modal) modal.classList.add('hidden');
    this.currentQuotation = null;
  },

  populateClientDropdown() {
    const sel = document.getElementById('edit-client-select');
    if (!sel) return;
    const clients = StorageManager.getClients();
    sel.innerHTML = `<option value="">-- Select Existing Client (or type details) --</option>` +
      clients.map(c => `<option value="${c.id}">${c.companyName ? c.companyName + ' (' + c.name + ')' : c.name}</option>`).join('');
  },

  onClientDropdownChange(clientId) {
    if (!clientId) return;
    const client = StorageManager.getClients().find(c => c.id === clientId);
    if (client && this.currentQuotation) {
      this.currentQuotation.clientId = client.id;
      this.currentQuotation.clientName = client.name;
      this.currentQuotation.clientCompany = client.companyName;
      this.currentQuotation.clientPhone = client.phone;
      this.currentQuotation.clientEmail = client.email;
      this.currentQuotation.clientGst = client.gstNumber;
      this.currentQuotation.clientAddress = client.address;

      document.getElementById('edit-client-company').value = client.companyName || '';
      document.getElementById('edit-client-name').value = client.name || '';
      document.getElementById('edit-client-phone').value = client.phone || '';
      document.getElementById('edit-client-email').value = client.email || '';
      document.getElementById('edit-client-gst').value = client.gstNumber || '';
      document.getElementById('edit-client-address').value = client.address || '';
    }
  },

  // -------------------------------------------------------------
  // Line Items in Editor (with Item Master picker & Product Images)
  // -------------------------------------------------------------
  renderEditorItemsTable() {
    const tbody = document.getElementById('editor-items-tbody');
    if (!tbody || !this.currentQuotation) return;

    const masterItems = StorageManager.getItems();

    tbody.innerHTML = this.currentQuotation.items.map((item, idx) => {
      const amt = ((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)).toFixed(2);

      // Master Items Options
      const masterOptions = masterItems.map(m => {
        const isSelected = (item.masterItemId === m.id) || (item.description === m.name && !item.isCustom);
        return `<option value="${m.id}" ${isSelected ? 'selected' : ''}>
          ${this.escapeHtml(m.name)} (₹${parseFloat(m.rate).toFixed(2)} / ${this.escapeHtml(m.unit)})
        </option>`;
      }).join('');

      // Check for accessories nested sub-table
      let subTableRows = '';
      if (item.subTable && Array.isArray(item.subTable)) {
        subTableRows = item.subTable.map((s, sIdx) => `
          <div class="flex items-center gap-1.5 py-1 text-[11px] bg-slate-50 p-1.5 rounded border border-slate-200 mt-1">
            <input type="text" value="${PdfGenerator.escapeHtml(s.desc)}" onchange="App.updateSubTableRow(${idx}, ${sIdx}, 'desc', this.value)" placeholder="Desc" class="w-24 text-[10px] border rounded px-1 py-0.5" />
            <input type="text" value="${PdfGenerator.escapeHtml(s.inchKg)}" onchange="App.updateSubTableRow(${idx}, ${sIdx}, 'inchKg', this.value)" placeholder="Inch/Kg" class="w-16 text-[10px] border rounded px-1 py-0.5 text-center font-bold" />
            <input type="number" value="${s.nos}" oninput="App.updateSubTableRow(${idx}, ${sIdx}, 'nos', this.value)" placeholder="NOS" class="w-12 text-[10px] border rounded px-1 py-0.5 text-center font-bold" />
            <input type="text" value="${s.weight}" onchange="App.updateSubTableRow(${idx}, ${sIdx}, 'weight', this.value)" placeholder="Weight" class="w-16 text-[10px] border rounded px-1 py-0.5 text-right font-mono" />
            <input type="text" value="${PdfGenerator.escapeHtml(s.remarks)}" onchange="App.updateSubTableRow(${idx}, ${sIdx}, 'remarks', this.value)" placeholder="Remarks" class="flex-1 text-[10px] border rounded px-1 py-0.5" />
            <button type="button" onclick="App.deleteSubTableRow(${idx}, ${sIdx})" class="text-rose-500 hover:text-rose-700 p-0.5"><i class="fa-solid fa-xmark text-xs"></i></button>
          </div>
        `).join('');
      }

      return `
        <tr class="border-b border-slate-200 hover:bg-slate-50/50 transition-colors" data-item-idx="${idx}">
          <td class="py-2.5 px-2 text-center text-slate-500 font-bold align-top pt-3">${idx + 1}</td>
          <td class="py-2.5 px-3 align-top">
            
            <!-- Item Selection Dropdown (Populated Dynamically from Items Master) -->
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-blue-900 uppercase tracking-wider block">
                <i class="fa-solid fa-boxes-stacked mr-1 text-blue-700"></i> Select Product / Item:
              </label>
              <select onchange="App.selectItemFromMaster(${idx}, this.value)" class="w-full text-xs font-bold border-2 border-blue-500 bg-white rounded-lg px-2.5 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs cursor-pointer">
                <option value="" disabled ${!item.description ? 'selected' : ''}>-- ⚡ Select Product from Items Master --</option>
                ${masterOptions}
                <option value="__custom__" ${item.isCustom ? 'selected' : ''}>+ Custom Product / Item (Manual Entry)</option>
              </select>
            </div>

            <!-- Custom Product Name Input (Shown when custom item chosen) -->
            ${item.isCustom ? `
              <div class="mt-2">
                <label class="text-[10px] font-semibold text-slate-600 block mb-0.5">Custom Product Description:</label>
                <input type="text" class="w-full text-xs font-bold border border-slate-300 rounded px-2.5 py-1.5 focus:border-cyan-500" 
                       value="${PdfGenerator.escapeHtml(item.description)}" 
                       onchange="App.updateItemField(${idx}, 'description', this.value)" 
                       placeholder="Enter custom product name / description..."/>
              </div>
            ` : ''}

            <!-- Sub-Remarks / Line Details (e.g. ROOFING SHEET) -->
            <div class="mt-1.5">
              <input type="text" class="w-full text-[11px] italic text-slate-700 border border-slate-200 rounded px-2 py-1 bg-slate-50/80" 
                     value="${PdfGenerator.escapeHtml(item.subRemarks || '')}" 
                     onchange="App.updateItemField(${idx}, 'subRemarks', this.value)" 
                     placeholder="Specification remarks e.g. (ROOFING SHEET)"/>
            </div>

            <!-- Product Image Displayed Directly Below Selected Item in HTML Table -->
            <div class="mt-2">
              ${item.imageUrl ? `
                <div class="p-2 bg-blue-50/70 border border-blue-200 rounded-lg flex items-center justify-between gap-3 shadow-2xs max-w-md">
                  <div class="flex items-center gap-2.5">
                    <img src="${item.imageUrl}" alt="Product Profile" class="h-10 max-w-44 object-contain bg-white rounded p-1 border border-blue-200 shadow-2xs" />
                    <div>
                      <span class="text-[11px] font-bold text-blue-950 block">Product Profile Diagram</span>
                      <span class="text-[10px] text-blue-700 italic">Displayed on quotation PDF table</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <label class="text-[10px] text-blue-600 hover:text-blue-800 cursor-pointer p-1 font-semibold" title="Change Image">
                      <i class="fa-solid fa-camera"></i>
                      <input type="file" accept="image/*" class="hidden" onchange="App.handleLineItemImageUpload(${idx}, event)" />
                    </label>
                    <button type="button" onclick="App.removeItemImage(${idx})" class="text-rose-500 hover:text-rose-700 p-1 text-xs" title="Remove Profile Image">
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </div>
              ` : `
                <label class="text-[10px] font-semibold text-blue-700 hover:text-blue-900 cursor-pointer inline-flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-md transition-colors">
                  <i class="fa-solid fa-image text-blue-600"></i> Attach Product Profile Image
                  <input type="file" accept="image/*" class="hidden" onchange="App.handleLineItemImageUpload(${idx}, event)" />
                </label>
              `}
            </div>

            <!-- Nested Accessories Breakdown Subtable Accordion -->
            <div class="mt-1.5">
              ${subTableRows}
              <button type="button" onclick="App.addSubTableRow(${idx})" class="text-[10px] font-bold text-sky-700 hover:underline mt-1">
                <i class="fa-solid fa-plus-circle mr-1"></i> Add Accessories Breakdown Row
              </button>
            </div>
          </td>
          <td class="py-2.5 px-2 w-28 align-top">
            <input type="number" step="any" class="w-full text-xs font-black text-center border border-slate-300 rounded px-2 py-1.5 focus:border-cyan-500 mt-4" 
                   value="${item.quantity}" 
                   oninput="App.updateItemField(${idx}, 'quantity', this.value)"/>
          </td>
          <td class="py-2.5 px-2 w-28 align-top">
            <select class="w-full text-xs font-medium border border-slate-300 rounded px-1 py-1.5 bg-white mt-4"
                    onchange="App.updateItemField(${idx}, 'unit', this.value)">
              <option value="kg(approx.)" ${item.unit === 'kg(approx.)' ? 'selected' : ''}>kg(approx.)</option>
              <option value="PCS" ${item.unit === 'PCS' ? 'selected' : ''}>PCS</option>
              <option value="SQ.FEET" ${item.unit === 'SQ.FEET' ? 'selected' : ''}>SQ.FEET</option>
              <option value="R.FEET" ${item.unit === 'R.FEET' ? 'selected' : ''}>R.FEET</option>
              <option value="MTR" ${item.unit === 'MTR' ? 'selected' : ''}>MTR</option>
              <option value="BUNDLE" ${item.unit === 'BUNDLE' ? 'selected' : ''}>BUNDLE</option>
            </select>
          </td>
          <td class="py-2.5 px-2 w-24 align-top">
            <input type="number" step="0.01" class="w-full text-xs font-bold text-center border border-slate-300 rounded px-2 py-1.5 focus:border-cyan-500 mt-4 font-mono" 
                   value="${item.rate}" 
                   oninput="App.updateItemField(${idx}, 'rate', this.value)"/>
          </td>
          <td id="line-item-amount-${idx}" class="py-2.5 px-3 w-32 text-right font-black text-slate-900 text-xs align-top pt-5 font-mono">
            ₹ ${amt}
          </td>
          <td class="py-2.5 px-2 text-center w-10 align-top pt-4">
            <button type="button" onclick="App.removeLineItem(${idx})" class="text-rose-500 hover:text-rose-700 p-1" title="Delete Row">
              <i class="fa-solid fa-trash-can text-xs"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  selectItemFromMaster(itemIdx, masterItemId) {
    if (!masterItemId || !this.currentQuotation || !this.currentQuotation.items[itemIdx]) return;
    const item = this.currentQuotation.items[itemIdx];

    if (masterItemId === '__custom__') {
      item.isCustom = true;
      item.masterItemId = '';
      this.renderEditorItemsTable();
      return;
    }

    const masterItem = StorageManager.getItemById(masterItemId);
    if (!masterItem) return;

    item.isCustom = false;
    item.masterItemId = masterItem.id;
    item.description = masterItem.name;
    item.subRemarks = masterItem.description || '';
    item.unit = masterItem.unit || 'SQ.FEET';
    item.rate = parseFloat(masterItem.rate) || 0; // Automatically fill Unit Price!
    item.imageUrl = masterItem.imageUrl || '';   // Automatically display Product Image below item!

    // Smartly initialize corresponding size calculation parameters (strictly informational reference)
    if (!this.currentQuotation.calculations) this.currentQuotation.calculations = [];
    let targetBlock = this.currentQuotation.calculations[itemIdx];
    if (!targetBlock && this.currentQuotation.calculations.length > 0) {
      targetBlock = this.currentQuotation.calculations[0];
    }
    if (targetBlock) {
      targetBlock.title = `Calculation Details for : ${masterItem.name}`;
      targetBlock.sheetWidth = parseFloat(masterItem.defaultWidth) || 3.50;
    }

    this.renderEditorItemsTable();
    this.renderEditorCalculations();
    this.recalculateEditorFinancials();
    this.showToast(`Selected "${masterItem.name}" • Unit Price auto-filled: ₹${item.rate}`, 'success');
  },

  handleLineItemImageUpload(itemIdx, event) {
    const file = event.target.files[0];
    if (!file || !this.currentQuotation || !this.currentQuotation.items[itemIdx]) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.currentQuotation.items[itemIdx].imageUrl = e.target.result;
      this.renderEditorItemsTable();
    };
    reader.readAsDataURL(file);
  },

  removeItemImage(itemIdx) {
    if (!this.currentQuotation || !this.currentQuotation.items[itemIdx]) return;
    this.currentQuotation.items[itemIdx].imageUrl = '';
    this.renderEditorItemsTable();
  },

  updateItemField(idx, field, val) {
    if (!this.currentQuotation || !this.currentQuotation.items[idx]) return;
    this.currentQuotation.items[idx][field] = val;

    if (field === 'quantity' || field === 'rate') {
      const q = parseFloat(this.currentQuotation.items[idx].quantity) || 0;
      const r = parseFloat(this.currentQuotation.items[idx].rate) || 0;
      const amtStr = (q * r).toFixed(2);
      this.currentQuotation.items[idx].amount = parseFloat(amtStr);
      const amtEl = document.getElementById(`line-item-amount-${idx}`);
      if (amtEl) amtEl.textContent = '₹ ' + amtStr;
    }

    this.recalculateEditorFinancials();
  },

  addLineItem() {
    if (!this.currentQuotation) return;
    this.currentQuotation.items.push({
      id: 'item_' + Date.now(),
      description: '',
      subRemarks: '',
      imageUrl: '',
      quantity: 1,
      unit: 'SQ.FEET',
      rate: 0,
      amount: 0
    });
    this.renderEditorItemsTable();
    this.recalculateEditorFinancials();
  },

  removeLineItem(idx) {
    if (!this.currentQuotation) return;
    if (this.currentQuotation.items.length <= 1) {
      this.showToast('Quotation must contain at least one line item.', 'info');
      return;
    }
    this.currentQuotation.items.splice(idx, 1);
    this.renderEditorItemsTable();
    this.recalculateEditorFinancials();
  },

  addSubTableRow(itemIdx) {
    if (!this.currentQuotation || !this.currentQuotation.items[itemIdx]) return;
    if (!this.currentQuotation.items[itemIdx].subTable) {
      this.currentQuotation.items[itemIdx].subTable = [];
    }
    this.currentQuotation.items[itemIdx].subTable.push({
      desc: 'Standard Size',
      inchKg: '16"',
      nos: 1,
      weight: '0.000',
      remarks: 'LENTH 8 FEET'
    });
    this.renderEditorItemsTable();
  },

  updateSubTableRow(itemIdx, subIdx, field, val) {
    if (!this.currentQuotation || !this.currentQuotation.items[itemIdx] || !this.currentQuotation.items[itemIdx].subTable[subIdx]) return;
    this.currentQuotation.items[itemIdx].subTable[subIdx][field] = val;
  },

  deleteSubTableRow(itemIdx, subIdx) {
    if (!this.currentQuotation || !this.currentQuotation.items[itemIdx] || !this.currentQuotation.items[itemIdx].subTable) return;
    this.currentQuotation.items[itemIdx].subTable.splice(subIdx, 1);
    this.renderEditorItemsTable();
  },

  // -------------------------------------------------------------
  // Dynamic Calculation Blocks in Editor
  // -------------------------------------------------------------
  renderEditorCalculations() {
    const container = document.getElementById('editor-calculations-container');
    if (!container || !this.currentQuotation) return;

    if (!this.currentQuotation.calculations || this.currentQuotation.calculations.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 bg-slate-50 border border-dashed border-slate-300 rounded-xl">
          <p class="text-xs text-slate-500 mb-2 font-medium">No calculation tables attached to this quote.</p>
          <button type="button" onclick="App.addCalculationBlock()" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg shadow-sm">
            <i class="fa-solid fa-calculator mr-1.5"></i> Add Sheet Size Calculator
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = this.currentQuotation.calculations.map((block, bIdx) => {
      const computed = CalculationsEngine.calculateSheetBlock(block);

      const rowsHtml = block.rows.map((row, rIdx) => {
        const rowCalc = CalculationsEngine.calculateSheetRow(row.feet, row.inch, row.nos, block.sheetWidth);

        return `
          <tr class="border-b border-slate-300 text-xs">
            <td class="py-1 px-1 text-center font-bold text-slate-400 w-10">${rIdx + 1}</td>
            <td class="py-1 px-1.5" style="background-color: #fce4ec;">
              <input type="number" step="any" min="0" class="w-full text-center font-bold text-slate-900 bg-transparent border border-pink-300 rounded px-1.5 py-1"
                     value="${row.feet}" 
                     oninput="App.updateCalcRow(${bIdx}, ${rIdx}, 'feet', this.value)" placeholder="Feet"/>
            </td>
            <td class="py-1 px-1.5" style="background-color: #e1f5fe;">
              <input type="number" step="any" min="0" max="11.99" class="w-full text-center font-bold text-slate-900 bg-transparent border border-sky-300 rounded px-1.5 py-1"
                     value="${row.inch}" 
                     oninput="App.updateCalcRow(${bIdx}, ${rIdx}, 'inch', this.value)" placeholder="Inch"/>
            </td>
            <td class="py-1 px-1.5" style="background-color: #fff9c4;">
              <input type="number" step="1" min="1" class="w-full text-center font-black text-slate-900 bg-transparent border border-amber-300 rounded px-1.5 py-1"
                     value="${row.nos}" 
                     oninput="App.updateCalcRow(${bIdx}, ${rIdx}, 'nos', this.value)" placeholder="Nos"/>
            </td>
            <td id="calc-row-sqmeter-${bIdx}-${rIdx}" class="py-1 px-2 text-center font-semibold text-slate-900 font-mono" style="background-color: #c8e6c9;">
              ${rowCalc.sqMetersDisplay}
            </td>
            <td id="calc-row-sqfeet-${bIdx}-${rIdx}" class="py-1 px-2 text-center font-bold text-slate-900 font-mono" style="background-color: #e1bee7;">
              ${rowCalc.sqFeetDisplay}
            </td>
            <td class="py-1 px-2 text-center space-x-1 w-20">
              <button type="button" onclick="App.duplicateCalcRow(${bIdx}, ${rIdx})" class="text-purple-600 hover:text-purple-800 p-1" title="Duplicate row">
                <i class="fa-solid fa-copy text-xs"></i>
              </button>
              <button type="button" onclick="App.removeCalcRow(${bIdx}, ${rIdx})" class="text-rose-500 hover:text-rose-700 p-1" title="Remove row">
                <i class="fa-solid fa-xmark text-xs"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      return `
        <div class="mb-5 border-2 border-cyan-400 rounded-xl overflow-hidden bg-white shadow-sm">
          <div class="px-4 py-2.5 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-3" style="background-color: #0084c7;">
            <div class="flex-1 w-full">
              <div class="flex items-center gap-2">
                <span class="text-[10px] uppercase font-bold text-amber-300 tracking-wider">CALCULATION BLOCK #${bIdx + 1}</span>
                <span class="bg-white/20 text-white text-[9px] font-bold px-2 py-0.5 rounded uppercase">Informational Reference Only</span>
              </div>
              <input type="text" class="w-full bg-white/10 border border-white/30 rounded px-2.5 py-1 text-xs font-bold text-white focus:bg-white/20 mt-1 placeholder-cyan-100"
                     value="${PdfGenerator.escapeHtml(block.title)}"
                     onchange="App.updateCalcBlockMeta(${bIdx}, 'title', this.value)"
                     placeholder="Calculation Details for : ..."/>
            </div>

            <div class="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
              <div class="flex items-center gap-1.5 bg-black/20 px-2.5 py-1 rounded-md border border-white/20">
                <label class="text-[11px] font-semibold text-white whitespace-nowrap">Width (Ft):</label>
                <input type="number" step="0.01" class="w-16 bg-white text-slate-950 font-black text-xs text-center rounded px-1.5 py-0.5"
                       value="${block.sheetWidth || 3.50}"
                       oninput="App.updateCalcBlockMeta(${bIdx}, 'sheetWidth', this.value)"/>
              </div>

              <button type="button" onclick="App.removeCalculationBlock(${bIdx})" class="text-white hover:text-rose-200 p-1.5 rounded" title="Delete Block">
                <i class="fa-solid fa-trash-can text-sm"></i>
              </button>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse border border-slate-300">
              <thead>
                <tr class="text-white text-xs font-bold uppercase" style="background-color: #00a2e8;">
                  <th class="py-2 px-1 text-center w-10">#</th>
                  <th class="py-2 px-2 text-center w-24">Feet</th>
                  <th class="py-2 px-2 text-center w-24">Inch</th>
                  <th class="py-2 px-2 text-center w-24">Nos</th>
                  <th class="py-2 px-2 text-center w-32">Sq. Meter</th>
                  <th class="py-2 px-2 text-center w-32">Sq.Feet</th>
                  <th class="py-2 px-2 text-center w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
              <tfoot>
                <tr class="bg-slate-50 font-bold text-xs text-slate-800 border-t-2 border-slate-300">
                  <td colspan="3" class="py-2 px-3 text-right font-bold text-[11px] text-slate-600">
                    <span class="inline-flex items-center gap-1.5"><i class="fa-solid fa-ruler-combined text-slate-600"></i> Dimensions Total:</span>
                  </td>
                  <td id="calc-block-total-nos-${bIdx}" class="py-2 px-2 text-center font-bold" style="background-color: #fff9c4;">
                    ${computed.totalNos} Pcs
                  </td>
                  <td id="calc-block-total-sqmeters-${bIdx}" class="py-2 px-2 text-center font-bold" style="background-color: #c8e6c9;">
                    ${computed.totalSqMetersDisplay}
                  </td>
                  <td id="calc-block-total-sqfeet-${bIdx}" class="py-2 px-2 text-center font-bold" style="background-color: #e1bee7;">
                    ${computed.totalSqFeetDisplay}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="p-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-between items-center gap-2 text-xs">
            <button type="button" onclick="App.addCalcRow(${bIdx})" class="px-3 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-bold rounded shadow-sm">
              <i class="fa-solid fa-plus mr-1"></i> Add Measurement Row
            </button>

            <span class="text-[11px] text-slate-500 font-semibold italic flex items-center gap-1">
              <i class="fa-solid fa-circle-info text-sky-600"></i> Informational reference only • Does not alter main quotation item quantity or price
            </span>
          </div>

        </div>
      `;
    }).join('') + `
      <div class="mt-2 text-right">
        <button type="button" onclick="App.addCalculationBlock()" class="px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold rounded-lg shadow-sm">
          <i class="fa-solid fa-calculator mr-1.5"></i> Add Sheet Size Calculator
        </button>
      </div>
    `;
  },

  addCalculationBlock() {
    if (!this.currentQuotation) return;
    if (!this.currentQuotation.calculations) this.currentQuotation.calculations = [];

    this.currentQuotation.calculations.push({
      id: 'calc_' + Date.now(),
      title: 'Calculation Details for : PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
      sheetWidth: 3.50,
      rows: [
        { feet: 10.00, inch: 0.00, nos: 1 }
      ]
    });

    this.renderEditorCalculations();
  },

  removeCalculationBlock(bIdx) {
    if (!this.currentQuotation || !this.currentQuotation.calculations) return;
    if (confirm('Delete this calculation table block?')) {
      this.currentQuotation.calculations.splice(bIdx, 1);
      this.renderEditorCalculations();
    }
  },

  updateCalcBlockMeta(bIdx, field, val) {
    if (!this.currentQuotation || !this.currentQuotation.calculations[bIdx]) return;
    this.currentQuotation.calculations[bIdx][field] = val;
    this.renderEditorCalculations();
  },

  addCalcRow(bIdx) {
    if (!this.currentQuotation || !this.currentQuotation.calculations[bIdx]) return;
    this.currentQuotation.calculations[bIdx].rows.push({
      feet: 0,
      inch: 0,
      nos: 1
    });
    this.renderEditorCalculations();
  },

  duplicateCalcRow(bIdx, rIdx) {
    if (!this.currentQuotation || !this.currentQuotation.calculations[bIdx]) return;
    const target = this.currentQuotation.calculations[bIdx].rows[rIdx];
    this.currentQuotation.calculations[bIdx].rows.splice(rIdx + 1, 0, {
      feet: target.feet,
      inch: target.inch,
      nos: target.nos
    });
    this.renderEditorCalculations();
  },

  removeCalcRow(bIdx, rIdx) {
    if (!this.currentQuotation || !this.currentQuotation.calculations[bIdx]) return;
    if (this.currentQuotation.calculations[bIdx].rows.length <= 1) {
      this.showToast('Calculation table must have at least one row.', 'info');
      return;
    }
    this.currentQuotation.calculations[bIdx].rows.splice(rIdx, 1);
    this.renderEditorCalculations();
  },

  updateCalcRow(bIdx, rIdx, field, val) {
    if (!this.currentQuotation || !this.currentQuotation.calculations || !this.currentQuotation.calculations[bIdx]) return;
    const block = this.currentQuotation.calculations[bIdx];
    if (!block.rows || !block.rows[rIdx]) return;

    block.rows[rIdx][field] = parseFloat(val) || 0;

    // Direct DOM node update: Retains cursor focus by avoiding parent container re-render
    const row = block.rows[rIdx];
    const rowCalc = CalculationsEngine.calculateSheetRow(row.feet, row.inch, row.nos, block.sheetWidth);

    const sqmMtrEl = document.getElementById(`calc-row-sqmeter-${bIdx}-${rIdx}`);
    const sqFtEl = document.getElementById(`calc-row-sqfeet-${bIdx}-${rIdx}`);
    if (sqmMtrEl) sqmMtrEl.textContent = rowCalc.sqMetersDisplay;
    if (sqFtEl) sqFtEl.textContent = rowCalc.sqFeetDisplay;

    const blockTotals = CalculationsEngine.calculateSheetBlock(block);
    const totNosEl = document.getElementById(`calc-block-total-nos-${bIdx}`);
    const totMtrEl = document.getElementById(`calc-block-total-sqmeters-${bIdx}`);
    const totFtEl = document.getElementById(`calc-block-total-sqfeet-${bIdx}`);

    if (totNosEl) totNosEl.textContent = blockTotals.totalNos + ' Pcs';
    if (totMtrEl) totMtrEl.textContent = blockTotals.totalSqMetersDisplay;
    if (totFtEl) totFtEl.textContent = blockTotals.totalSqFeetDisplay;
  },

  // -------------------------------------------------------------
  // Financial Recalculation
  // -------------------------------------------------------------
  recalculateEditorFinancials() {
    if (!this.currentQuotation) return;

    const loadingVal = parseFloat(document.getElementById('edit-quote-loading')?.value) || 0;
    this.currentQuotation.loadingCharges = loadingVal;

    const gstType = document.getElementById('edit-quote-gst-type')?.value || this.currentQuotation.gstType || 'CGST_SGST';
    this.currentQuotation.gstType = gstType;

    const totals = CalculationsEngine.calculateQuotationTotals(
      this.currentQuotation.items || [],
      loadingVal,
      this.currentQuotation.additionalCharges || [],
      gstType,
      this.currentQuotation.customGstRate,
      this.currentQuotation.roundOff
    );

    const subEl = document.getElementById('calc-summary-subtotal');
    const loadEl = document.getElementById('calc-summary-loading');
    const taxEl = document.getElementById('calc-summary-tax');
    const grandEl = document.getElementById('calc-summary-grand');
    const wordsEl = document.getElementById('calc-summary-words');

    if (subEl) subEl.innerText = totals.materialTotal.toFixed(2) + '/-';
    if (loadEl) loadEl.innerText = totals.loadingCharges.toFixed(2) + '/-';
    if (taxEl) taxEl.innerText = totals.gstAmount.toFixed(2) + '/-';
    if (grandEl) grandEl.innerText = Math.round(totals.grandTotal) + '/-';
    if (wordsEl) wordsEl.innerText = totals.grandTotalWords;

    this.currentQuotation.materialTotal = totals.materialTotal;
    this.currentQuotation.gstAmount = totals.gstAmount;
    this.currentQuotation.roundOff = totals.roundOff;
    this.currentQuotation.grandTotal = totals.grandTotal;
    this.currentQuotation.grandTotalWords = totals.grandTotalWords;
  },

  async saveCurrentQuotation() {
    try {
      console.log('[App] saveCurrentQuotation triggered...');
      if (!this.currentQuotation) {
        console.error('[App] currentQuotation is null or undefined.');
        this.showToast('Unable to save: No active quotation loaded.', 'error');
        return;
      }

      // Safely read meta & header inputs
      const numEl = document.getElementById('edit-quote-number');
      const dateEl = document.getElementById('edit-quote-date');
      const validEl = document.getElementById('edit-quote-valid');
      const statusEl = document.getElementById('edit-quote-status');

      this.currentQuotation.quoteNumber = numEl?.value?.trim() || this.currentQuotation.quoteNumber || StorageManager.generateNextQuoteNumber();
      this.currentQuotation.date = dateEl?.value || this.currentQuotation.date || new Date().toISOString().split('T')[0];
      this.currentQuotation.validUntil = validEl?.value || this.currentQuotation.validUntil || '';
      this.currentQuotation.status = statusEl?.value || this.currentQuotation.status || 'Draft';

      // Safely read client inputs
      const compEl = document.getElementById('edit-client-company');
      const nameEl = document.getElementById('edit-client-name');
      const phoneEl = document.getElementById('edit-client-phone');
      const emailEl = document.getElementById('edit-client-email');
      const gstEl = document.getElementById('edit-client-gst');
      const addrEl = document.getElementById('edit-client-address');
      const notesEl = document.getElementById('edit-quote-notes');
      const loadEl = document.getElementById('edit-quote-loading');
      const gstTypeEl = document.getElementById('edit-quote-gst-type');

      this.currentQuotation.clientCompany = compEl?.value?.trim() || '';
      this.currentQuotation.clientName = nameEl?.value?.trim() || '';
      this.currentQuotation.clientPhone = phoneEl?.value?.trim() || '';
      this.currentQuotation.clientEmail = emailEl?.value?.trim() || '';
      this.currentQuotation.clientGst = gstEl?.value?.trim() || '';
      this.currentQuotation.clientAddress = addrEl?.value?.trim() || '';
      this.currentQuotation.notes = notesEl?.value?.trim() || '';
      this.currentQuotation.loadingCharges = parseFloat(loadEl?.value) || 0;
      this.currentQuotation.gstType = gstTypeEl?.value || this.currentQuotation.gstType || 'CGST_SGST';

      // Require Client or Company Name
      if (!this.currentQuotation.clientCompany && !this.currentQuotation.clientName) {
        this.showToast('Please specify a Client Contact or Company name.', 'error');
        if (compEl) compEl.focus();
        return;
      }

      // Ensure client is saved to Client Master if not already linked
      if (!this.currentQuotation.clientId && (this.currentQuotation.clientCompany || this.currentQuotation.clientName)) {
        try {
          const newCli = await StorageManager.saveClient({
            name: this.currentQuotation.clientName,
            companyName: this.currentQuotation.clientCompany,
            phone: this.currentQuotation.clientPhone,
            email: this.currentQuotation.clientEmail,
            address: this.currentQuotation.clientAddress,
            gstNumber: this.currentQuotation.clientGst
          });
          if (newCli && newCli.id) {
            this.currentQuotation.clientId = newCli.id;
          }
        } catch (cliErr) {
          console.warn('[App] Client master save notice:', cliErr);
        }
      }

      // Ensure items array exists and has at least one item
      if (!Array.isArray(this.currentQuotation.items) || this.currentQuotation.items.length === 0) {
        this.showToast('Please add at least one line item to the quotation.', 'error');
        return;
      }

      // Harvest current values from item table inputs if user just typed without blurring
      const itemRows = document.querySelectorAll('#editor-items-tbody tr[data-item-idx]');
      itemRows.forEach(row => {
        const idx = parseInt(row.getAttribute('data-item-idx'), 10);
        if (!isNaN(idx) && this.currentQuotation.items[idx]) {
          const item = this.currentQuotation.items[idx];
          const qtyInput = row.querySelector('input[type="number"][oninput*="quantity"]');
          const rateInput = row.querySelector('input[type="number"][oninput*="rate"]');
          const unitSelect = row.querySelector('select[onchange*="unit"]');
          const descInput = row.querySelector('input[onchange*="description"]');
          const subInput = row.querySelector('input[onchange*="subRemarks"]');

          if (qtyInput && qtyInput.value !== '') item.quantity = parseFloat(qtyInput.value) || 0;
          if (rateInput && rateInput.value !== '') item.rate = parseFloat(rateInput.value) || 0;
          if (unitSelect) item.unit = unitSelect.value;
          if (descInput && item.isCustom) item.description = descInput.value.trim();
          if (subInput) item.subRemarks = subInput.value.trim();
          item.amount = parseFloat(((parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0)).toFixed(2));
        }
      });

      // Recalculate all financials right before saving
      this.recalculateEditorFinancials();

      // Ensure calculations array
      if (!Array.isArray(this.currentQuotation.calculations)) {
        this.currentQuotation.calculations = [];
      }

      console.log('[App] Saving quotation object to storage:', this.currentQuotation);
      const saved = await StorageManager.saveQuotation(this.currentQuotation);
      console.log('[App] Successfully saved quotation:', saved.quoteNumber);

      this.showToast(`Quotation ${saved.quoteNumber} saved successfully!`, 'success');
      this.closeQuotationEditorModal();
      this.renderQuotationsList();
      this.renderDashboard();
    } catch (err) {
      console.error('[App] Fatal error in saveCurrentQuotation:', err);
      this.showToast(err.message || 'No Internet Connection - Unable to save quotation', 'error');
    }
  },

  // -------------------------------------------------------------
  // Print & PDF Preview Modal
  // -------------------------------------------------------------
  openPrintPreview(quoteId) {
    const quote = StorageManager.getQuotationById(quoteId);
    if (!quote) return;

    const settings = StorageManager.getSettings();
    const html = PdfGenerator.generateQuotationHtml(quote, settings);

    const previewModal = document.getElementById('pdf-preview-modal');
    const container = document.getElementById('pdf-preview-container');
    if (previewModal && container) {
      container.innerHTML = html;
      previewModal.classList.remove('hidden');

      const printBtn = document.getElementById('btn-modal-print');
      if (printBtn) {
        printBtn.onclick = (e) => {
          if (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          PdfGenerator.printQuotation(quote, settings);
        };
      }
      const downloadBtn = document.getElementById('btn-modal-download');
      if (downloadBtn) {
        downloadBtn.onclick = (e) => {
          if (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          PdfGenerator.downloadPdf(quote, settings);
        };
      }
    }
  },

  closePrintPreview() {
    const previewModal = document.getElementById('pdf-preview-modal');
    if (previewModal) previewModal.classList.add('hidden');
  },

  // -------------------------------------------------------------
  // Clients Management View & Advanced Filters
  // -------------------------------------------------------------
  renderClientsList() {
    const clients = StorageManager.getClients();
    const searchVal = (document.getElementById('client-search-input')?.value || '').toLowerCase().trim();
    const monthVal = document.getElementById('client-filter-month')?.value || 'ALL';
    const yearVal = document.getElementById('client-filter-year')?.value || 'ALL';

    const filtered = clients.filter(c => {
      const matchSearch = !searchVal ||
        (c.name && c.name.toLowerCase().includes(searchVal)) ||
        (c.companyName && c.companyName.toLowerCase().includes(searchVal)) ||
        (c.phone && c.phone.toLowerCase().includes(searchVal)) ||
        (c.gstNumber && c.gstNumber.toLowerCase().includes(searchVal));

      let matchDate = true;
      if (c.createdAt) {
        const cD = new Date(c.createdAt);
        if (monthVal !== 'ALL' && (cD.getMonth() + 1) !== parseInt(monthVal, 10)) {
          matchDate = false;
        }
        if (yearVal !== 'ALL' && cD.getFullYear() !== parseInt(yearVal, 10)) {
          matchDate = false;
        }
      }

      return matchSearch && matchDate;
    });

    const infoEl = document.getElementById('client-filter-result-info');
    if (infoEl) {
      infoEl.textContent = `Showing ${filtered.length} of ${clients.length} total clients`;
    }

    const tbody = document.getElementById('clients-list-tbody');
    const paginationBar = document.getElementById('clients-pagination-bar');
    if (!tbody) return;

    if (StorageManager.isOffline()) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center">
        <div class="inline-flex flex-col items-center justify-center p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 max-w-md mx-auto">
          <i class="fa-solid fa-wifi-slash text-2xl text-rose-500 mb-2"></i>
          <div class="font-bold text-sm">No Internet Connection - Please check your network</div>
          <p class="text-xs text-rose-600 mt-1 mb-3">Cannot load clients without an active Cloudflare D1 connection.</p>
          <button onclick="App.refreshDataLive()" class="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition">
            <i class="fa-solid fa-rotate-right mr-1"></i> Retry Connection
          </button>
        </div>
      </td></tr>`;
      if (paginationBar) paginationBar.innerHTML = '';
      return;
    }

    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / this.clientsPageSize));
    if (this.clientsPage > totalPages) this.clientsPage = totalPages;
    if (this.clientsPage < 1) this.clientsPage = 1;

    if (totalRecords === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">No clients found. Click "Add Client" to create one.</td></tr>`;
      if (paginationBar) paginationBar.innerHTML = `<span class="text-xs text-slate-400">0 clients found</span>`;
      return;
    }

    const startIdx = (this.clientsPage - 1) * this.clientsPageSize;
    const endIdx = Math.min(startIdx + this.clientsPageSize, totalRecords);
    const paginated = filtered.slice(startIdx, endIdx);

    tbody.innerHTML = paginated.map(c => `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors text-xs">
        <td class="py-3 px-3">
          <div class="font-bold text-slate-900 text-sm">${c.companyName || c.name}</div>
          ${c.companyName ? `<div class="text-slate-500 font-medium">Contact: ${c.name}</div>` : ''}
        </td>
        <td class="py-3 px-3 font-semibold text-blue-900">${c.phone || 'N/A'}</td>
        <td class="py-3 px-3 text-slate-600">${c.email || 'N/A'}</td>
        <td class="py-3 px-3 font-mono text-slate-700">${c.gstNumber || 'Unregistered'}</td>
        <td class="py-3 px-3 text-slate-500 max-w-xs truncate">${c.address || ''}</td>
        <td class="py-3 px-3">
          <span class="inline-flex items-center gap-1 font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
            <i class="fa-solid fa-user-pen text-slate-400 text-[10px]"></i>
            ${c.createdBy || 'Super Admin'}
          </span>
        </td>
        <td class="py-3 px-3 text-right space-x-1">
          <button onclick="App.openClientModal('${c.id}')" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Edit Client">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button onclick="App.deleteClient('${c.id}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Delete Client">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `).join('');

    if (paginationBar) {
      this.renderPaginationControls(
        paginationBar,
        this.clientsPage,
        totalPages,
        startIdx + 1,
        endIdx,
        totalRecords,
        this.clientsPageSize,
        'App.setClientsPage',
        'App.setClientsPageSize',
        'clients'
      );
    }
  },

  handleClientFilterChange() {
    this.clientsPage = 1;
    this.renderClientsList();
  },

  resetClientFilters() {
    const sInp = document.getElementById('client-search-input');
    const mInp = document.getElementById('client-filter-month');
    const yInp = document.getElementById('client-filter-year');

    if (sInp) sInp.value = '';
    if (mInp) mInp.value = 'ALL';
    if (yInp) yInp.value = 'ALL';

    this.clientsPage = 1;
    this.renderClientsList();
  },

  setQuotesPage(page) {
    this.quotesPage = Math.max(1, page);
    this.renderQuotationsList();
  },
  setQuotesPageSize(size) {
    this.quotesPageSize = parseInt(size, 10) || 15;
    this.quotesPage = 1;
    this.renderQuotationsList();
  },
  setClientsPage(page) {
    this.clientsPage = Math.max(1, page);
    this.renderClientsList();
  },
  setClientsPageSize(size) {
    this.clientsPageSize = parseInt(size, 10) || 15;
    this.clientsPage = 1;
    this.renderClientsList();
  },
  setItemsPage(page) {
    this.itemsPage = Math.max(1, page);
    this.renderItemsList();
  },
  setItemsPageSize(size) {
    this.itemsPageSize = parseInt(size, 10) || 15;
    this.itemsPage = 1;
    this.renderItemsList();
  },

  renderPaginationControls(container, currentPage, totalPages, fromNum, toNum, totalCount, pageSize, pageFn, sizeFn, entityName) {
    let pageButtons = '';
    const startP = Math.max(1, currentPage - 2);
    const endP = Math.min(totalPages, startP + 4);

    for (let p = startP; p <= endP; p++) {
      const active = p === currentPage;
      pageButtons += `
        <button onclick="${pageFn}(${p})" class="px-2.5 py-1 rounded text-xs font-bold transition-all ${active ? 'bg-blue-900 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'}">
          ${p}
        </button>
      `;
    }

    container.innerHTML = `
      <div class="flex items-center gap-2">
        <span>Showing <strong class="font-bold text-slate-900">${fromNum}</strong> to <strong class="font-bold text-slate-900">${toNum}</strong> of <strong class="font-bold text-slate-900">${totalCount}</strong> ${entityName}</span>
        <span class="text-slate-300">|</span>
        <label class="flex items-center gap-1 text-[11px] text-slate-500">
          <span>Per page:</span>
          <select onchange="${sizeFn}(this.value)" class="border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white text-slate-800 font-semibold focus:outline-none focus:border-blue-600">
            <option value="15" ${pageSize === 15 ? 'selected' : ''}>15</option>
            <option value="30" ${pageSize === 30 ? 'selected' : ''}>30</option>
            <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
            <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
          </select>
        </label>
      </div>

      <div class="flex items-center gap-1.5">
        <button onclick="${pageFn}(${currentPage - 1})" ${currentPage <= 1 ? 'disabled class="px-2.5 py-1 rounded text-xs font-bold bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"' : 'class="px-2.5 py-1 rounded text-xs font-bold bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"'} title="Previous Page">
          <i class="fa-solid fa-chevron-left text-[10px]"></i> Prev
        </button>
        ${pageButtons}
        <button onclick="${pageFn}(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled class="px-2.5 py-1 rounded text-xs font-bold bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"' : 'class="px-2.5 py-1 rounded text-xs font-bold bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"'} title="Next Page">
          Next <i class="fa-solid fa-chevron-right text-[10px]"></i>
        </button>
      </div>
    `;
  },

  // -------------------------------------------------------------
  // CSV Bulk Import & Export Controller
  // -------------------------------------------------------------
  exportQuotationsCsv() {
    const quotes = StorageManager.getQuotations();
    if (!quotes || quotes.length === 0) {
      this.showToast('No quotations available to export.', 'info');
      return;
    }
    CsvHelper.exportQuotations(quotes);
    this.showToast(`Exported ${quotes.length} quotations to CSV!`, 'success');
  },

  exportClientsCsv() {
    const clients = StorageManager.getClients();
    if (!clients || clients.length === 0) {
      this.showToast('No clients available to export.', 'info');
      return;
    }
    CsvHelper.exportClients(clients);
    this.showToast(`Exported ${clients.length} clients to CSV!`, 'success');
  },

  exportItemsCsv() {
    const items = StorageManager.getItems();
    if (!items || items.length === 0) {
      this.showToast('No products available to export.', 'info');
      return;
    }
    CsvHelper.exportItems(items);
    this.showToast(`Exported ${items.length} products to CSV!`, 'success');
  },

  openClientCsvImportModal() {
    this.pendingClientCsvData = null;
    const fileInp = document.getElementById('client-csv-file-input');
    if (fileInp) fileInp.value = '';
    const prev = document.getElementById('client-csv-preview-container');
    if (prev) prev.classList.add('hidden');
    const submitBtn = document.getElementById('btn-submit-client-csv');
    if (submitBtn) submitBtn.disabled = true;
    const modal = document.getElementById('client-csv-import-modal');
    if (modal) modal.classList.remove('hidden');
  },

  closeClientCsvImportModal() {
    const modal = document.getElementById('client-csv-import-modal');
    if (modal) modal.classList.add('hidden');
  },

  handleClientCsvFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const parsed = CsvHelper.parseCsv(text);
      const normalized = CsvHelper.normalizeClients(parsed.rows);

      if (normalized.length === 0) {
        this.showToast('No valid client rows found in the CSV file.', 'error');
        return;
      }

      this.pendingClientCsvData = normalized;

      const rowCountEl = document.getElementById('client-csv-row-count');
      if (rowCountEl) rowCountEl.textContent = normalized.length;

      const prevContent = document.getElementById('client-csv-preview-content');
      if (prevContent) {
        prevContent.innerHTML = normalized.slice(0, 5).map((c, i) => `
          <div class="truncate text-slate-700">#${i+1}: <strong>${this.escapeHtml(c.companyName)}</strong> (${this.escapeHtml(c.name)}) • ${this.escapeHtml(c.phone || 'No phone')} • GST: ${this.escapeHtml(c.gstNumber || 'N/A')}</div>
        `).join('') + (normalized.length > 5 ? `<div class="text-slate-400 italic font-sans">+ ${normalized.length - 5} more records...</div>` : '');
      }

      const prevContainer = document.getElementById('client-csv-preview-container');
      if (prevContainer) prevContainer.classList.remove('hidden');

      const submitBtn = document.getElementById('btn-submit-client-csv');
      if (submitBtn) submitBtn.disabled = false;
    };
    reader.readAsText(file);
  },

  processClientCsvImport() {
    if (!this.pendingClientCsvData || this.pendingClientCsvData.length === 0) {
      this.showToast('No data to import.', 'error');
      return;
    }

    const saved = StorageManager.bulkSaveClients(this.pendingClientCsvData);
    this.closeClientCsvImportModal();
    this.renderClientsList();
    this.showToast(`Successfully imported ${saved.length} clients to local database!`, 'success');
  },

  openItemCsvImportModal() {
    this.pendingItemCsvData = null;
    const fileInp = document.getElementById('item-csv-file-input');
    if (fileInp) fileInp.value = '';
    const prev = document.getElementById('item-csv-preview-container');
    if (prev) prev.classList.add('hidden');
    const submitBtn = document.getElementById('btn-submit-item-csv');
    if (submitBtn) submitBtn.disabled = true;
    const modal = document.getElementById('item-csv-import-modal');
    if (modal) modal.classList.remove('hidden');
  },

  closeItemCsvImportModal() {
    const modal = document.getElementById('item-csv-import-modal');
    if (modal) modal.classList.add('hidden');
  },

  handleItemCsvFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const parsed = CsvHelper.parseCsv(text);
      const normalized = CsvHelper.normalizeItems(parsed.rows);

      if (normalized.length === 0) {
        this.showToast('No valid product rows found in the CSV file.', 'error');
        return;
      }

      this.pendingItemCsvData = normalized;

      const rowCountEl = document.getElementById('item-csv-row-count');
      if (rowCountEl) rowCountEl.textContent = normalized.length;

      const prevContent = document.getElementById('item-csv-preview-content');
      if (prevContent) {
        prevContent.innerHTML = normalized.slice(0, 5).map((it, i) => `
          <div class="truncate text-slate-700">#${i+1}: <strong>${this.escapeHtml(it.name)}</strong> • ₹${it.rate.toFixed(2)} / ${this.escapeHtml(it.unit)} • Width: ${it.defaultWidth} Ft</div>
        `).join('') + (normalized.length > 5 ? `<div class="text-slate-400 italic font-sans">+ ${normalized.length - 5} more items...</div>` : '');
      }

      const prevContainer = document.getElementById('item-csv-preview-container');
      if (prevContainer) prevContainer.classList.remove('hidden');

      const submitBtn = document.getElementById('btn-submit-item-csv');
      if (submitBtn) submitBtn.disabled = false;
    };
    reader.readAsText(file);
  },

  processItemCsvImport() {
    if (!this.pendingItemCsvData || this.pendingItemCsvData.length === 0) {
      this.showToast('No product data to import.', 'error');
      return;
    }

    const saved = StorageManager.bulkSaveItems(this.pendingItemCsvData);
    this.closeItemCsvImportModal();
    this.renderItemsList();
    this.showToast(`Successfully imported ${saved.length} products into Items Master!`, 'success');
  },

  openClientModal(clientId = null) {
    const modal = document.getElementById('client-modal');
    if (!modal) return;

    if (clientId) {
      const client = StorageManager.getClients().find(c => c.id === clientId);
      if (client) {
        document.getElementById('client-form-id').value = client.id;
        document.getElementById('client-form-company').value = client.companyName || '';
        document.getElementById('client-form-name').value = client.name || '';
        document.getElementById('client-form-phone').value = client.phone || '';
        document.getElementById('client-form-email').value = client.email || '';
        document.getElementById('client-form-gst').value = client.gstNumber || '';
        document.getElementById('client-form-address').value = client.address || '';
      }
    } else {
      document.getElementById('client-form-id').value = '';
      document.getElementById('client-form').reset();
    }

    modal.classList.remove('hidden');
  },

  closeClientModal() {
    const modal = document.getElementById('client-modal');
    if (modal) modal.classList.add('hidden');
  },

  async saveClientFromModal(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('client-form-id').value;
    const clientData = {
      id: id || undefined,
      companyName: document.getElementById('client-form-company').value.trim(),
      name: document.getElementById('client-form-name').value.trim(),
      phone: document.getElementById('client-form-phone').value.trim(),
      email: document.getElementById('client-form-email').value.trim(),
      gstNumber: document.getElementById('client-form-gst').value.trim(),
      address: document.getElementById('client-form-address').value.trim()
    };

    if (!clientData.name && !clientData.companyName) {
      this.showToast('Please provide a Client Name or Company Name.', 'error');
      return;
    }

    try {
      await StorageManager.saveClient(clientData);
      this.showToast('Client record saved successfully!', 'success');
      this.closeClientModal();
      this.renderClientsList();
      this.renderDashboard();
    } catch (err) {
      this.showToast(err.message || 'No Internet Connection - Unable to save client', 'error');
    }
  },

  async deleteClient(clientId) {
    if (!AuthManager.canManageClients()) {
      this.showToast('Permission denied: You cannot delete clients.', 'error');
      return;
    }
    if (confirm('Are you sure you want to delete this client?')) {
      try {
        await StorageManager.deleteClient(clientId);
        this.showToast('Client deleted.', 'info');
        this.renderClientsList();
        this.renderDashboard();
      } catch (err) {
        this.showToast(err.message || 'No Internet Connection - Unable to delete client', 'error');
      }
    }
  },

  // -------------------------------------------------------------
  // Settings View (including Signature Upload)
  // -------------------------------------------------------------
  renderSettings() {
    const settings = StorageManager.getSettings();

    document.getElementById('set-company-name').value = settings.company?.name || '';
    document.getElementById('set-company-tagline').value = settings.company?.tagline || '';
    document.getElementById('set-company-address').value = settings.company?.address || '';
    document.getElementById('set-company-phone').value = settings.company?.phone || '';
    document.getElementById('set-company-phone2').value = settings.company?.phoneSecondary || '';
    document.getElementById('set-company-email').value = settings.company?.email || '';
    document.getElementById('set-company-gstin').value = settings.company?.gstin || '';

    document.getElementById('set-bank-name').value = settings.bank?.bankName || '';
    document.getElementById('set-bank-acname').value = settings.bank?.accountName || '';
    document.getElementById('set-bank-acno').value = settings.bank?.accountNumber || '';
    document.getElementById('set-bank-ifsc').value = settings.bank?.ifscCode || '';
    document.getElementById('set-bank-branch').value = settings.bank?.branch || '';

    const workerInput = document.getElementById('set-worker-url');
    if (workerInput) workerInput.value = settings.integration?.workerUrl || localStorage.getItem('cf_worker_url') || '';

    // Signature Settings
    const sigPreview = document.getElementById('set-signature-preview');
    const sigToggle = document.getElementById('set-signature-toggle');
    const sigTitle = document.getElementById('set-signature-title');
    if (sigPreview) sigPreview.src = settings.media?.signatureImageUrl || 'assets/sample-signature.svg';
    if (sigToggle) sigToggle.checked = settings.media?.showSignatureInPdf !== false;
    if (sigTitle) sigTitle.value = settings.media?.signatureTitle || 'Authorized Signatory';

    this.renderSettingsTerms(settings.terms || []);
    this.renderSettingsBanners(settings.media);

    const backupCard = document.getElementById('settings-db-backup-card');
    if (backupCard) {
      if (AuthManager.isSuperAdmin() || AuthManager.hasPermission('canBackupDatabase')) {
        backupCard.classList.remove('hidden');
      } else {
        backupCard.classList.add('hidden');
      }
    }
  },

  handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result;
      const settings = StorageManager.getSettings();
      if (!settings.media) settings.media = {};
      settings.media.signatureImageUrl = base64;
      StorageManager.saveSettings(settings);
      
      const sigPreview = document.getElementById('set-signature-preview');
      if (sigPreview) sigPreview.src = base64;
      this.showToast('Authorized signature image updated!', 'success');
    };
    reader.readAsDataURL(file);
  },

  renderSettingsTerms(terms) {
    const container = document.getElementById('settings-terms-list');
    if (!container) return;

    container.innerHTML = terms.map((t, idx) => `
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xs font-bold text-slate-500 w-6 text-center">${idx + 1}.</span>
        <input type="text" class="flex-1 text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:border-blue-500"
               value="${PdfGenerator.escapeHtml(t)}"
               data-term-idx="${idx}"
               onchange="App.updateTermInSettings(${idx}, this.value)"/>
        <button type="button" onclick="App.removeTermFromSettings(${idx})" class="text-rose-500 hover:text-rose-700 p-1.5">
          <i class="fa-solid fa-trash-can text-xs"></i>
        </button>
      </div>
    `).join('');
  },

  addTermToSettings() {
    const settings = StorageManager.getSettings();
    if (!settings.terms) settings.terms = [];
    settings.terms.push('New custom term & condition.');
    StorageManager.saveSettings(settings);
    this.renderSettingsTerms(settings.terms);
  },

  updateTermInSettings(idx, val) {
    const settings = StorageManager.getSettings();
    if (settings.terms && settings.terms[idx] !== undefined) {
      settings.terms[idx] = val;
      StorageManager.saveSettings(settings);
    }
  },

  removeTermFromSettings(idx) {
    const settings = StorageManager.getSettings();
    if (settings.terms) {
      settings.terms.splice(idx, 1);
      StorageManager.saveSettings(settings);
      this.renderSettingsTerms(settings.terms);
    }
  },

  renderSettingsBanners(media = {}) {
    const preview = document.getElementById('set-banner-preview');
    const toggle = document.getElementById('set-banner-toggle');
    if (preview) {
      preview.src = media.bannerUrl || 'assets/product-gallery-page7.svg';
    }
    if (toggle) {
      toggle.checked = media.showBannerInPdf !== false;
    }
  },

  handleBannerUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result;
      const settings = StorageManager.getSettings();
      if (!settings.media) settings.media = {};
      settings.media.bannerUrl = base64;
      StorageManager.saveSettings(settings);
      this.renderSettingsBanners(settings.media);
      this.showToast('Promotional banner updated successfully!', 'success');
    };
    reader.readAsDataURL(file);
  },

  async saveAllSettings() {
    if (!AuthManager.canManageSettings()) {
      this.showToast('Permission denied: You cannot edit settings.', 'error');
      return;
    }

    const settings = StorageManager.getSettings();

    settings.company = {
      name: document.getElementById('set-company-name').value.trim(),
      tagline: document.getElementById('set-company-tagline').value.trim(),
      address: document.getElementById('set-company-address').value.trim(),
      phone: document.getElementById('set-company-phone').value.trim(),
      phoneSecondary: document.getElementById('set-company-phone2').value.trim(),
      email: document.getElementById('set-company-email').value.trim(),
      gstin: document.getElementById('set-company-gstin').value.trim(),
      state: 'Gujarat',
      stateCode: '24'
    };

    settings.bank = {
      bankName: document.getElementById('set-bank-name').value.trim(),
      accountName: document.getElementById('set-bank-acname').value.trim(),
      accountNumber: document.getElementById('set-bank-acno').value.trim(),
      ifscCode: document.getElementById('set-bank-ifsc').value.trim(),
      branch: document.getElementById('set-bank-branch').value.trim()
    };

    const workerUrlVal = document.getElementById('set-worker-url') ? document.getElementById('set-worker-url').value.trim() : '';

    settings.integration = {
      ...settings.integration,
      workerUrl: workerUrlVal
    };
    if (workerUrlVal) {
      localStorage.setItem('cf_worker_url', workerUrlVal);
      localStorage.setItem('backend_url', workerUrlVal);
    }

    const sigTitleInput = document.getElementById('set-signature-title');
    const sigToggleInput = document.getElementById('set-signature-toggle');

    settings.media = {
      ...settings.media,
      showBannerInPdf: document.getElementById('set-banner-toggle').checked,
      showSignatureInPdf: sigToggleInput ? sigToggleInput.checked : true,
      signatureTitle: sigTitleInput ? sigTitleInput.value.trim() : 'Authorized Signatory'
    };

    try {
      await StorageManager.saveSettings(settings);
      this.showToast('Settings saved successfully to Cloudflare D1!', 'success');
    } catch (err) {
      this.showToast(err.message || 'No Internet Connection - Unable to save settings', 'error');
    }
  },

  async testBackendConnection() {
    const btn = document.getElementById('btn-test-backend');
    const resultBox = document.getElementById('backend-test-result');
    const workerInput = document.getElementById('set-worker-url');
    const workerUrl = workerInput ? workerInput.value.trim() : '';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Testing...';
    }

    if (resultBox) {
      resultBox.className = 'mt-2.5 p-3 rounded-lg text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-800 animate-pulse';
      resultBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Testing connection to Cloudflare Worker API...';
      resultBox.classList.remove('hidden');
    }

    try {
      if (workerUrl) {
        StorageManager.setApiUrl(workerUrl);
      }
      const res = await StorageManager.testBackendConnection(workerUrl);
      if (res.success) {
        this.showToast(res.message, 'success');
        if (resultBox) {
          resultBox.className = 'mt-2.5 p-3.5 rounded-lg text-xs bg-emerald-50 border border-emerald-300 text-emerald-950 shadow-xs';
          resultBox.innerHTML = `
            <div class="flex items-start gap-2.5">
              <i class="fa-solid fa-circle-check text-emerald-600 text-base mt-0.5"></i>
              <div>
                <p class="font-bold text-emerald-900">${this.escapeHtml(res.message)}</p>
                <p class="text-[11px] text-emerald-700 font-medium mt-0.5">Your PWA is connected to the Cloudflare Worker &amp; D1 Database.</p>
              </div>
            </div>`;
          resultBox.classList.remove('hidden');
        }
      } else {
        this.showToast(res.message || 'Connection test failed', 'error');
        if (resultBox) {
          resultBox.className = 'mt-2.5 p-3.5 rounded-lg text-xs bg-rose-50 border border-rose-300 text-rose-950 shadow-xs';
          resultBox.innerHTML = `
            <div class="flex items-start gap-2.5">
              <i class="fa-solid fa-triangle-exclamation text-rose-600 text-base mt-0.5"></i>
              <div>
                <p class="font-bold text-rose-900">Connection Notice</p>
                <p class="text-[11px] text-rose-800 font-medium mt-0.5">${this.escapeHtml(res.message)}</p>
              </div>
            </div>`;
          resultBox.classList.remove('hidden');
        }
      }
    } catch (err) {
      this.showToast('Test failed: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-bolt"></i> <span>Test Connection</span>';
      }
    }
  },

  async syncNow() {
    const btn = document.getElementById('btn-sync-now');
    const resultBox = document.getElementById('backend-test-result');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Syncing...';
    }

    try {
      this.showToast('Synchronizing with Cloud Database...', 'info');
      await StorageManager.pullAllFromCloud();
      this.renderCurrentTab();
      this.showToast('Database synchronized with Cloud Database!', 'success');
      if (resultBox) {
        resultBox.className = 'mt-2.5 p-3 rounded-lg text-xs bg-emerald-50 border border-emerald-300 text-emerald-950';
        resultBox.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600 mr-1.5"></i> Cloud database synchronized successfully!`;
        resultBox.classList.remove('hidden');
      }
    } catch (e) {
      console.error('[App] syncNow failed:', e);
      const errMsg = e.message || String(e);
      this.showToast('Sync failed: ' + errMsg.split('\n')[0], 'error');
      if (resultBox) {
        resultBox.className = 'mt-2.5 p-3.5 rounded-lg text-xs bg-rose-50 border border-rose-300 text-rose-950';
        resultBox.innerHTML = `
          <div class="flex items-start gap-2.5">
            <i class="fa-solid fa-triangle-exclamation text-rose-600 text-base mt-0.5"></i>
            <div class="space-y-1">
              <p class="font-bold text-rose-900">Sync Failed</p>
              <div class="whitespace-pre-line text-[11px] leading-relaxed text-rose-800 font-mono bg-white/70 p-2 rounded border border-rose-200">${this.escapeHtml(errMsg)}</div>
            </div>
          </div>`;
        resultBox.classList.remove('hidden');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate mr-1"></i> Sync All Data Now';
      }
    }
  },



  // -------------------------------------------------------------
  // Toast Notifications
  // -------------------------------------------------------------
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    let bg = 'bg-slate-900 text-white';
    let icon = 'fa-circle-info';
    if (type === 'success') {
      bg = 'bg-emerald-600 text-white';
      icon = 'fa-circle-check';
    } else if (type === 'error') {
      bg = 'bg-rose-600 text-white';
      icon = 'fa-circle-exclamation';
    }

    toast.className = `flex items-center gap-2.5 px-4 py-2.5 rounded-lg shadow-xl text-xs font-semibold animate-fade-in ${bg}`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => container.removeChild(toast), 300);
    }, 3200);
  },

  escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
