/**
 * Quotation Manager - Main Application Controller
 * Handles UI routing, reactivity, modals, quotation lifecycle, Item Master CRUD,
 * email dispatch, and PWA installation.
 */

// Feature Toggle Flags (Clean configuration for production)
const ENABLE_FORGOT_PASSWORD = false;

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
  turnstileWidgetId: null,
  activeCompanyId: 'primary',
  isLoadingData: true,

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
      this.loadDashboardStats();
    }
  },

  async loadDashboardStats() {
    if (!AuthManager.isAuthenticated()) return;
    this.isLoadingData = true;
    this.renderDashboard();
    this.renderCurrentTab();
    try {
      await StorageManager.pullAllFromCloud();
    } catch (e) {
      console.warn('[App] Pull all error:', e);
    } finally {
      this.isLoadingData = false;
      this.renderDashboard();
      this.renderCurrentTab();
    }
  },

  async refreshCloudDataInBackground() {
    if (!AuthManager.isAuthenticated()) return;
    try {
      console.log('[App] Refreshing live data from server...');
      const res = await StorageManager.pullAllFromCloud();
      this.renderDashboard();
      this.renderActiveTab();
      if (!res.success && res.offline) {
        this.showToast('No Internet Connection - Please check your network', 'error');
      }
    } catch (err) {
      console.warn('[App] Background cloud refresh note:', err);
      this.renderDashboard();
      this.renderActiveTab();
    }
  },

  async refreshDataLive() {
    this.showToast('Connecting to server...', 'info');
    const res = await StorageManager.pullAllFromCloud();
    this.renderActiveTab();
    if (res.success) {
      this.showToast('Connected to database!', 'success');
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
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-stone-400"></span> <span class="hidden sm:inline">Offline</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-stone-100 text-stone-600 border border-stone-300';
        return;
      }

      if (statusInfo.status === 'syncing') {
        badge.innerHTML = `<i class="fa-solid fa-rotate fa-spin text-orange-700"></i> <span class="hidden sm:inline">Syncing...</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-800 border border-orange-200';
      } else if (statusInfo.status === 'online') {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> <span class="hidden sm:inline">Cloud Synced</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-800 border border-green-200';
      } else {
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span> <span class="hidden sm:inline">Offline</span>`;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 cursor-pointer';
        badge.title = 'Offline - Cloud database unreachable';
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
      this.showLoginGate(true);
      return false;
    }

    // User is authenticated: reveal app shell
    this.showLoginGate(false);
    if (appShell) appShell.classList.remove('hidden');

    this.updateUserInterfaceForAuth();
    this.applyRouteFromHash();
    this.renderDashboard();
    this.loadDashboardStats();
    return true;
  },

  showLoginGate(show) {
    const modal = document.getElementById('login-gate-modal');
    if (!modal) return;
    if (show) {
      modal.classList.remove('hidden');
      const userInput = document.getElementById('login-username-input');
      if (userInput) setTimeout(() => userInput.focus(), 100);
      this.renderTurnstileWidget();

      // Forgot Password UI feature toggle control
      const forgotBtn = document.getElementById('btn-forgot-password');
      if (forgotBtn) {
        if (ENABLE_FORGOT_PASSWORD) {
          forgotBtn.classList.remove('hidden');
        } else {
          forgotBtn.classList.add('hidden');
        }
      }
      this.showForgotPasswordView(false);
    } else {
      modal.classList.add('hidden');
      this.cleanupTurnstileWidget();
    }
  },

  renderTurnstileWidget() {
    const wrapper = document.getElementById('login-turnstile-wrapper');
    if (!wrapper) return;
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      if (this.turnstileWidgetId !== null) {
        try { window.turnstile.remove(this.turnstileWidgetId); } catch (e) {}
        this.turnstileWidgetId = null;
      }
      wrapper.innerHTML = '';
      try {
        this.turnstileWidgetId = window.turnstile.render(wrapper, {
          sitekey: '0x4AAAAAAF_JrYnpZJeO07cJ',
          theme: 'light',
          callback: (token) => {
            window.turnstileResponse = token || '';
          },
          'expired-callback': () => {
            window.turnstileResponse = '';
          },
          'error-callback': () => {
            window.turnstileResponse = '';
          }
        });
      } catch (e) {
        console.warn('[App] Turnstile render note:', e);
      }
    }
  },

  cleanupTurnstileWidget() {
    if (this.turnstileWidgetId !== null && window.turnstile && typeof window.turnstile.remove === 'function') {
      try { window.turnstile.remove(this.turnstileWidgetId); } catch (e) {}
      this.turnstileWidgetId = null;
    }
    const wrapper = document.getElementById('login-turnstile-wrapper');
    if (wrapper) wrapper.innerHTML = '';
    window.turnstileResponse = '';
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
          this.applyRouteFromHash();
          this.renderDashboard();
          this.loadDashboardStats();
          this.showToast('Welcome, ' + (res.user?.fullName || res.user?.username) + '!', 'success');
        }, 300);
      } else {
        if (alertBox) {
          alertBox.innerText = res.message || 'Invalid username or password.';
          alertBox.classList.remove('hidden');
          alertBox.className = 'text-xs p-3 rounded-xl mb-4 font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        }
        if (window.turnstile && typeof window.turnstile.reset === 'function') {
          try { window.turnstile.reset(); } catch (e) {}
        }
        window.turnstileResponse = '';
        this.showToast(res.message || 'Login failed', 'error');
      }
    } catch (err) {
      if (alertBox) {
        alertBox.innerText = err.message || 'An error occurred during authentication.';
        alertBox.classList.remove('hidden');
        alertBox.className = 'text-xs p-3 rounded-xl mb-4 font-semibold bg-rose-50 text-rose-800 border border-rose-200';
      }
      if (window.turnstile && typeof window.turnstile.reset === 'function') {
        try { window.turnstile.reset(); } catch (e) {}
      }
      window.turnstileResponse = '';
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

  showForgotPasswordView(show) {
    if (!ENABLE_FORGOT_PASSWORD && show) {
      return;
    }
    const normalView = document.getElementById('login-view-normal');
    const forgotView = document.getElementById('login-view-forgot');
    const alertBox = document.getElementById('forgot-pass-alert');
    const step1 = document.getElementById('forgot-step1-form');
    const step2 = document.getElementById('forgot-step2-form');

    if (alertBox) alertBox.classList.add('hidden');
    if (step1) step1.classList.remove('hidden');
    if (step2) step2.classList.add('hidden');

    if (show) {
      if (normalView) normalView.classList.add('hidden');
      if (forgotView) forgotView.classList.remove('hidden');
      const emailInput = document.getElementById('forgot-email-input');
      if (emailInput) {
        emailInput.value = '';
        setTimeout(() => emailInput.focus(), 100);
      }
    } else {
      if (forgotView) forgotView.classList.add('hidden');
      if (normalView) normalView.classList.remove('hidden');
      const userInput = document.getElementById('login-username-input');
      if (userInput) setTimeout(() => userInput.focus(), 100);
    }
  },

  async handleRequestOtpSubmit(e) {
    e.preventDefault();
    const emailInp = document.getElementById('forgot-email-input');
    const alertBox = document.getElementById('forgot-pass-alert');
    const btn = document.getElementById('btn-request-otp');
    const step1 = document.getElementById('forgot-step1-form');
    const step2 = document.getElementById('forgot-step2-form');

    const email = emailInp?.value?.trim() || '';
    if (!email) {
      if (alertBox) {
        alertBox.textContent = 'Please enter your registered email address or username.';
        alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Generating OTP...';
    }

    try {
      const res = await AuthManager.requestPasswordResetOtp(email);
      if (res.success) {
        if (alertBox) {
          alertBox.textContent = res.message || '6-digit OTP code has been generated and sent!';
          alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200';
          alertBox.classList.remove('hidden');
        }
        if (step1) step1.classList.add('hidden');
        if (step2) step2.classList.remove('hidden');
        const otpInp = document.getElementById('forgot-otp-input');
        if (otpInp) {
          otpInp.value = '';
          setTimeout(() => otpInp.focus(), 100);
        }
      } else {
        if (alertBox) {
          alertBox.textContent = res.message || 'Failed to send OTP code. Please check the email/username.';
          alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
          alertBox.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (alertBox) {
        alertBox.textContent = 'Error: ' + err.message;
        alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane text-amber-400"></i> <span>Send 6-Digit OTP</span>';
      }
    }
  },

  async handleVerifyOtpSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email-input')?.value?.trim() || '';
    const otp = document.getElementById('forgot-otp-input')?.value?.trim() || '';
    const newPass = document.getElementById('forgot-new-password')?.value || '';
    const alertBox = document.getElementById('forgot-pass-alert');
    const btn = document.getElementById('btn-verify-otp-submit');

    if (!otp || otp.length !== 6) {
      if (alertBox) {
        alertBox.textContent = 'Please enter a valid 6-digit numeric OTP code.';
        alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    if (!newPass || newPass.length < 6) {
      if (alertBox) {
        alertBox.textContent = 'New password must be at least 6 characters long.';
        alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Resetting Password...';
    }

    try {
      const res = await AuthManager.verifyOtpAndResetPassword(email, otp, newPass);
      if (res.success) {
        this.showToast('Password reset successfully! Please sign in with your new password.', 'success');
        this.showForgotPasswordView(false);
        const userInp = document.getElementById('login-username-input');
        const passInp = document.getElementById('login-password-input');
        if (userInp) userInp.value = email.includes('@') ? '' : email;
        if (passInp) {
          passInp.value = newPass;
          passInp.focus();
        }
      } else {
        if (alertBox) {
          alertBox.textContent = res.message || 'Failed to verify OTP code.';
          alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
          alertBox.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (alertBox) {
        alertBox.textContent = 'Error: ' + err.message;
        alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check text-white"></i> <span>Reset Password &amp; Login</span>';
      }
    }
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
        headerRole.className = 'bg-stone-800 text-stone-200 font-semibold text-[10px] px-2 py-0.5 rounded uppercase';
      } else {
        headerRole.className = 'bg-stone-100 text-stone-800 border border-stone-200 font-semibold text-[10px] px-2 py-0.5 rounded uppercase';
      }
    }

    // Settings user profile
    const profUser = document.getElementById('settings-profile-username');
    const profRole = document.getElementById('settings-profile-role');
    if (profUser) profUser.textContent = user.username;
    if (profRole) profRole.textContent = user.role || (user.isSuperAdmin ? 'Super Admin' : 'Sub-Admin');

    // Nav Users tab: only visible to Super Admin
    const usersTabBtn = document.getElementById('nav-btn-users');
    const mobileUsersBtn = document.getElementById('mobile-nav-users');
    if (AuthManager.isSuperAdmin()) {
      if (usersTabBtn) usersTabBtn.classList.remove('hidden');
      if (mobileUsersBtn) mobileUsersBtn.classList.remove('hidden');
    } else {
      if (usersTabBtn) usersTabBtn.classList.add('hidden');
      if (mobileUsersBtn) mobileUsersBtn.classList.add('hidden');
      if (this.currentTab === 'users') {
        this.switchTab('dashboard');
      }
    }

    // Nav Settings tab: only visible if user has canManageSettings
    const settingsTabBtn = document.getElementById('nav-btn-settings');
    const mobileSettingsBtn = document.getElementById('mobile-nav-settings');
    if (AuthManager.canManageSettings()) {
      if (settingsTabBtn) settingsTabBtn.classList.remove('hidden');
      if (mobileSettingsBtn) mobileSettingsBtn.classList.remove('hidden');
    } else {
      if (settingsTabBtn) settingsTabBtn.classList.add('hidden');
      if (mobileSettingsBtn) mobileSettingsBtn.classList.add('hidden');
      if (this.currentTab === 'settings') {
        this.switchTab('dashboard');
      }
    }

    // Nav Items tab: only visible if user has canManageItems
    const itemsTabBtn = document.getElementById('nav-btn-items');
    const mobileItemsBtn = document.getElementById('mobile-nav-items');
    if (AuthManager.canManageItems()) {
      if (itemsTabBtn) itemsTabBtn.classList.remove('hidden');
      if (mobileItemsBtn) mobileItemsBtn.classList.remove('hidden');
    } else {
      if (itemsTabBtn) itemsTabBtn.classList.add('hidden');
      if (mobileItemsBtn) mobileItemsBtn.classList.add('hidden');
      if (this.currentTab === 'items') {
        this.switchTab('dashboard');
      }
    }

    // Nav Clients tab: only visible if user has canManageClients
    const clientsTabBtn = document.getElementById('nav-btn-clients');
    const mobileClientsBtn = document.getElementById('mobile-nav-clients');
    if (AuthManager.canManageClients()) {
      if (clientsTabBtn) clientsTabBtn.classList.remove('hidden');
      if (mobileClientsBtn) mobileClientsBtn.classList.remove('hidden');
    } else {
      if (clientsTabBtn) clientsTabBtn.classList.add('hidden');
      if (mobileClientsBtn) mobileClientsBtn.classList.add('hidden');
      if (this.currentTab === 'clients') {
        this.switchTab('dashboard');
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
    const tbody = document.getElementById('users-list-tbody');
    if (!tbody) return;

    if (this.isLoadingData) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-16 text-stone-400 font-medium">
        <i class="fa-solid fa-spinner fa-spin mr-2 text-stone-500 text-base"></i> Loading users from Cloudflare D1...
      </td></tr>`;
      return;
    }

    const users = AuthManager.getUsers();

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-stone-400">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => {
      const isSuper = !!(u.isSuperAdmin || u.role === 'Super Admin');
      const perms = u.permissions || {};
      const permBadges = isSuper ? 
        `<span class="bg-stone-900 text-stone-100 px-2 py-0.5 rounded text-[10px] font-semibold">FULL ACCESS</span>` :
        `
          <div class="flex flex-wrap gap-1">
            ${perms.canManageClients ? '<span class="bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded text-[10px] font-medium">Clients</span>' : ''}
            ${perms.canCreateQuotations ? '<span class="bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded text-[10px] font-medium">Quotes</span>' : ''}
            ${perms.canManageItems ? '<span class="bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded text-[10px] font-medium">Items</span>' : ''}
            ${perms.canDeleteQuotes ? '<span class="bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded text-[10px] font-medium">Delete</span>' : ''}
            ${perms.canManageSettings ? '<span class="bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded text-[10px] font-medium">Settings</span>' : ''}
          </div>
        `;

      return `
        <tr class="border-b border-stone-100 hover:bg-stone-50/80 transition-colors text-xs">
          <td class="py-3 px-3 font-semibold text-stone-900">
            ${this.escapeHtml(u.fullName || u.username)}
          </td>
          <td class="py-3 px-3 font-code font-semibold text-stone-900">
            ${this.escapeHtml(u.username)}
          </td>
          <td class="py-3 px-3 text-stone-600 font-code text-[11px]">
            ${this.escapeHtml(u.email || '-')}
          </td>
          <td class="py-3 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${isSuper ? 'bg-stone-900 text-stone-100' : 'bg-stone-100 text-stone-800 border border-stone-200'}">
              ${u.role || (isSuper ? 'Super Admin' : 'Sub-Admin')}
            </span>
          </td>
          <td class="py-3 px-3">
            ${permBadges}
          </td>
          <td class="py-3 px-3 text-stone-500 font-code">
            ${PdfGenerator.formatDate(u.createdAt || new Date().toISOString())}
          </td>
          <td class="py-3 px-3 text-right">
            ${isSuper ? `
              <div class="inline-flex items-center gap-1">
                <button onclick="App.openUserEditorModal('${u.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors" title="Edit Admin">
                  <i class="fa-solid fa-user-pen text-sm"></i>
                </button>
                <button onclick="App.openAdminResetUserModal('${u.id}', '${this.escapeHtml(u.username)}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors" title="Reset Password">
                  <i class="fa-solid fa-key text-sm"></i>
                </button>
              </div>
            ` : `
              <div class="inline-flex items-center gap-1">
                <button onclick="App.openUserEditorModal('${u.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors" title="Edit Permissions">
                  <i class="fa-solid fa-user-pen text-sm"></i>
                </button>
                <button onclick="App.openAdminResetUserModal('${u.id}', '${this.escapeHtml(u.username)}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors" title="Reset Password">
                  <i class="fa-solid fa-key text-sm"></i>
                </button>
                <button onclick="App.deleteUser('${u.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-red-700 hover:bg-red-50 transition-colors" title="Delete User">
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
    const emailInp = document.getElementById('edit-user-email');
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

      const isSuper = !!(u.isSuperAdmin || u.role === 'Super Admin');

      if (idInp) idInp.value = u.id;
      if (nameInp) nameInp.value = u.fullName || '';
      if (emailInp) emailInp.value = u.email || '';
      if (userInp) {
        userInp.value = u.username || '';
        userInp.disabled = true;
      }
      if (roleInp) {
        roleInp.value = isSuper ? 'Super Admin' : (u.role || 'Sub-Admin');
        roleInp.disabled = isSuper;
      }
      if (passInp) {
        passInp.value = '';
        passInp.placeholder = 'New Password (min 6 chars, leave blank to keep unchanged)';
      }
      if (title) {
        title.innerHTML = isSuper
          ? '<i class="fa-solid fa-user-gear"></i> <span>Edit Super Admin Account</span>'
          : '<i class="fa-solid fa-user-pen"></i> <span>Edit Sub-Admin Permissions</span>';
      }

      const perms = u.permissions || {};
      if (permClients) { permClients.checked = isSuper ? true : !!perms.canManageClients; permClients.disabled = isSuper; }
      if (permQuotes) { permQuotes.checked = isSuper ? true : !!perms.canCreateQuotations; permQuotes.disabled = isSuper; }
      if (permItems) { permItems.checked = isSuper ? true : !!perms.canManageItems; permItems.disabled = isSuper; }
      if (permDelete) { permDelete.checked = isSuper ? true : !!perms.canDeleteQuotes; permDelete.disabled = isSuper; }
      if (permSettings) { permSettings.checked = isSuper ? true : !!perms.canManageSettings; permSettings.disabled = isSuper; }
    } else {
      if (idInp) idInp.value = '';
      if (nameInp) nameInp.value = '';
      if (emailInp) emailInp.value = '';
      if (userInp) {
        userInp.value = '';
        userInp.disabled = false;
      }
      if (roleInp) {
        roleInp.value = 'Sub-Admin';
        roleInp.disabled = false;
      }
      if (passInp) {
        passInp.value = '';
        passInp.placeholder = 'Min 6 characters';
      }
      if (title) title.innerHTML = '<i class="fa-solid fa-user-plus"></i> <span>Add New Sub-Admin</span>';

      if (permClients) { permClients.checked = true; permClients.disabled = false; }
      if (permQuotes) { permQuotes.checked = true; permQuotes.disabled = false; }
      if (permItems) { permItems.checked = false; permItems.disabled = false; }
      if (permDelete) { permDelete.checked = false; permDelete.disabled = false; }
      if (permSettings) { permSettings.checked = false; permSettings.disabled = false; }
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
    const email = document.getElementById('edit-user-email')?.value?.trim().toLowerCase() || '';
    const username = document.getElementById('edit-user-username')?.value || '';
    const role = document.getElementById('edit-user-role')?.value || 'Sub-Admin';
    const password = document.getElementById('edit-user-password')?.value || '';

    if (!username.trim()) {
      this.showToast('Username is required.', 'error');
      document.getElementById('edit-user-username')?.focus();
      return;
    }

    if (!email || !email.includes('@')) {
      this.showToast('A valid email address is required for user account and OTP recovery.', 'error');
      document.getElementById('edit-user-email')?.focus();
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
      email,
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

    const submitBtn = document.getElementById('btn-save-user-submit');
    const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';
    }

    try {
      await AuthManager.saveUser(userData);
      await StorageManager.pullAllFromCloud();
      this.showToast('User account saved successfully!', 'success');
      this.closeUserEditorModal();
      this.renderUsersList();
    } catch (err) {
      this.showToast(err.message || 'Error saving user', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnHtml;
      }
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

  openAdminResetUserModal(userId, username) {
    const modal = document.getElementById('admin-reset-user-modal');
    const idInp = document.getElementById('admin-reset-user-id');
    const label = document.getElementById('admin-reset-user-label');
    const passInp = document.getElementById('admin-reset-new-password');
    const alertBox = document.getElementById('admin-reset-alert');

    if (idInp) idInp.value = userId || '';
    if (label) label.textContent = username || userId;
    if (passInp) passInp.value = '';
    if (alertBox) alertBox.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');
    if (passInp) setTimeout(() => passInp.focus(), 100);
  },

  closeAdminResetUserModal() {
    const modal = document.getElementById('admin-reset-user-modal');
    if (modal) modal.classList.add('hidden');
  },

  async handleAdminResetUserSubmit(e) {
    e.preventDefault();
    const userId = document.getElementById('admin-reset-user-id')?.value;
    const newPass = document.getElementById('admin-reset-new-password')?.value || '';
    const alertBox = document.getElementById('admin-reset-alert');

    if (!newPass || newPass.length < 6) {
      if (alertBox) {
        alertBox.textContent = 'Password must be at least 6 characters long.';
        alertBox.className = 'text-xs p-2.5 rounded-lg font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
      return;
    }

    try {
      const res = await AuthManager.resetUserPasswordByAdmin(userId, newPass);
      if (res.success) {
        this.showToast('Sub-admin password reset successfully!', 'success');
        this.closeAdminResetUserModal();
      } else {
        if (alertBox) {
          alertBox.textContent = res.message || 'Failed to reset password.';
          alertBox.className = 'text-xs p-2.5 rounded-lg font-semibold bg-rose-50 text-rose-800 border border-rose-200';
          alertBox.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (alertBox) {
        alertBox.textContent = 'Error: ' + err.message;
        alertBox.className = 'text-xs p-2.5 rounded-lg font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
    }
  },

  // -------------------------------------------------------------
  // Database Backup & Restore Handlers
  // -------------------------------------------------------------
  async handleDatabaseBackupExport() {
    if (!AuthManager.isSuperAdmin() && !AuthManager.hasPermission('canBackupDatabase')) {
      this.showToast('Permission denied: Only Super Admin can export database backups.', 'error');
      return;
    }
    const btn = document.getElementById('btn-export-cloud-backup');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> <span>Exporting...</span>';
    }
    try {
      this.showToast('Preparing database export...', 'info');
      const res = await StorageManager.exportBackup();
      this.showToast(res.message || 'Database exported successfully!', 'success');
    } catch (err) {
      this.showToast('Export failed: ' + (err.message || err), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
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

    if (!confirm('Warning: Restoring this backup will update and merge records in your database. Continue?')) {
      if (event.target) event.target.value = '';
      return;
    }

    const label = document.getElementById('label-import-cloud-backup');
    if (label) {
      label.classList.add('opacity-75', 'pointer-events-none');
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        this.showToast('Uploading & restoring database...', 'info');
        const content = e.target.result;
        const res = await StorageManager.importBackup(content);
        if (res && res.success) {
          this.showToast(res.message || 'Database restored successfully!', 'success');
          this.renderCurrentTab();
        } else {
          this.showToast(res?.error || 'Database restore failed.', 'error');
        }
      } catch (err) {
        this.showToast('Failed restoring database: ' + (err.message || err), 'error');
      } finally {
        if (event?.target) event.target.value = '';
        if (label) {
          label.classList.remove('opacity-75', 'pointer-events-none');
        }
      }
    };
    reader.readAsText(file);
  },

  // -------------------------------------------------------------
  // Navigation, Persistent URL Hash Routing & Tab Switching
  // -------------------------------------------------------------
  getRouteFromHash() {
    const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
    if (!raw) return { tab: 'dashboard', page: 1 };
    const [tabPart, queryPart] = raw.split('?');
    const tab = (tabPart || 'dashboard').toLowerCase();
    let page = 1;
    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      const p = parseInt(params.get('page'), 10);
      if (!isNaN(p) && p >= 1) page = p;
    }
    const validTabs = ['dashboard', 'quotations', 'clients', 'items', 'users', 'settings'];
    return {
      tab: validTabs.includes(tab) ? tab : 'dashboard',
      page
    };
  },

  updateRouteHash(tab, page) {
    if (!tab) tab = this.currentTab || 'dashboard';
    let targetPage = page;
    if (targetPage === undefined) {
      if (tab === 'quotations') targetPage = this.quotesPage || 1;
      else if (tab === 'clients') targetPage = this.clientsPage || 1;
      else if (tab === 'items') targetPage = this.itemsPage || 1;
      else targetPage = 1;
    }

    let newHash = `#${tab}`;
    if (targetPage && targetPage > 1 && ['quotations', 'clients', 'items'].includes(tab)) {
      newHash = `#${tab}?page=${targetPage}`;
    }

    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  },

  applyRouteFromHash() {
    const route = this.getRouteFromHash();
    if (route.tab === 'quotations') {
      this.quotesPage = route.page;
    } else if (route.tab === 'clients') {
      this.clientsPage = route.page;
    } else if (route.tab === 'items') {
      this.itemsPage = route.page;
    }
    this.switchTab(route.tab, { updateHash: false });
  },

  switchTab(tabName, options = { updateHash: true }) {
    if (tabName === 'users' && !AuthManager.isSuperAdmin()) {
      tabName = 'dashboard';
    }
    if (tabName === 'settings' && !AuthManager.canManageSettings()) {
      this.showToast('Permission denied: You do not have permission to access Settings.', 'error');
      tabName = 'dashboard';
    }
    if (tabName === 'items' && !AuthManager.canManageItems()) {
      this.showToast('Permission denied: You do not have permission to access Items Master.', 'error');
      tabName = 'dashboard';
    }
    if (tabName === 'clients' && !AuthManager.canManageClients()) {
      this.showToast('Permission denied: You do not have permission to access Clients.', 'error');
      tabName = 'dashboard';
    }
    this.currentTab = tabName;

    // Desktop Nav Buttons
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      const t = btn.getAttribute('data-tab');
      if (t === tabName) {
        btn.classList.add('bg-stone-800', 'text-white', 'font-semibold');
        btn.classList.remove('text-stone-300', 'hover:bg-stone-800', 'hover:text-white');
      } else {
        btn.classList.remove('bg-stone-800', 'text-white', 'font-semibold');
        btn.classList.add('text-stone-300', 'hover:bg-stone-800', 'hover:text-white');
      }
    });

    // Mobile Bottom Nav Buttons
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      const t = btn.getAttribute('data-tab');
      if (t === tabName) {
        btn.classList.add('text-orange-700', 'bg-orange-50', 'font-semibold');
        btn.classList.remove('text-stone-600');
      } else {
        btn.classList.remove('text-orange-700', 'bg-orange-50', 'font-semibold');
        btn.classList.add('text-stone-600');
      }
    });

    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.add('hidden');
    });

    const activeSec = document.getElementById(`view-${tabName}`);
    if (activeSec) {
      activeSec.classList.remove('hidden');
    }

    if (options?.updateHash !== false) {
      this.updateRouteHash(tabName);
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
    window.addEventListener('hashchange', () => {
      this.applyRouteFromHash();
    });

    // Global Modal Escape Key Listener
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        this.closeTopmostModal();
      }
    });

    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      });
    });

    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
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

  closeTopmostModal() {
    const previewModal = document.getElementById('pdf-preview-modal');
    if (previewModal && !previewModal.classList.contains('hidden')) {
      this.closePrintPreview();
      return true;
    }

    const quoteEditor = document.getElementById('quote-editor-modal');
    if (quoteEditor && !quoteEditor.classList.contains('hidden')) {
      this.closeQuotationEditorModal();
      return true;
    }

    const itemModal = document.getElementById('item-modal');
    if (itemModal && !itemModal.classList.contains('hidden')) {
      this.closeItemModal();
      return true;
    }

    const clientModal = document.getElementById('client-modal');
    if (clientModal && !clientModal.classList.contains('hidden')) {
      this.closeClientModal();
      return true;
    }

    const userModal = document.getElementById('user-editor-modal');
    if (userModal && !userModal.classList.contains('hidden')) {
      this.closeUserEditorModal();
      return true;
    }

    const resetUserModal = document.getElementById('admin-reset-user-modal');
    if (resetUserModal && !resetUserModal.classList.contains('hidden')) {
      this.closeAdminResetUserModal();
      return true;
    }

    const changePassModal = document.getElementById('change-password-modal');
    if (changePassModal && !changePassModal.classList.contains('hidden')) {
      this.closeChangePasswordModal();
      return true;
    }

    const csvModal = document.getElementById('csv-import-modal');
    if (csvModal && !csvModal.classList.contains('hidden')) {
      this.closeCsvModal();
      return true;
    }

    const companyModal = document.getElementById('company-profile-modal');
    if (companyModal && !companyModal.classList.contains('hidden')) {
      this.closeCompanyModal();
      return true;
    }

    const deleteCompanyModal = document.getElementById('delete-company-modal');
    if (deleteCompanyModal && !deleteCompanyModal.classList.contains('hidden')) {
      this.closeDeleteCompanyModal();
      return true;
    }

    const forgotView = document.getElementById('login-view-forgot');
    if (forgotView && !forgotView.classList.contains('hidden')) {
      this.showForgotPasswordView(false);
      return true;
    }

    return false;
  },

  // -------------------------------------------------------------
  // Dashboard View
  // -------------------------------------------------------------
  renderDashboard() {
    if (this.isLoadingData) {
      const qEl = document.getElementById('dash-total-quotes');
      const vEl = document.getElementById('dash-total-value');
      const cEl = document.getElementById('dash-total-clients');
      const mEl = document.getElementById('dash-month-value');
      if (qEl) qEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-stone-400 text-sm"></i>';
      if (vEl) vEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-stone-400 text-sm"></i>';
      if (cEl) cEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-stone-400 text-sm"></i>';
      if (mEl) mEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-stone-400 text-sm"></i>';

      const recentTable = document.getElementById('dash-recent-quotes-table');
      if (recentTable) {
        recentTable.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-stone-400 font-medium">
          <i class="fa-solid fa-spinner fa-spin text-stone-500 mr-2 text-base"></i> Loading live metrics from Cloudflare D1...
        </td></tr>`;
      }
      return;
    }

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
          <div class="inline-flex flex-col items-center justify-center p-6 bg-red-50 border border-red-200 rounded-2xl text-red-800 max-w-md mx-auto">
            <i class="fa-solid fa-wifi-slash text-2xl text-red-500 mb-2"></i>
            <div class="font-bold text-sm">No Internet Connection - Please check your network</div>
            <p class="text-xs text-red-600 mt-1 mb-3">Live connection to server is required.</p>
            <button onclick="App.refreshDataLive()" class="px-3.5 py-1.5 bg-red-700 text-white rounded-xl text-xs font-semibold hover:bg-red-800 transition cursor-pointer">
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
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();

    const dateSubtitleEl = document.getElementById('dash-date-subtitle');
    if (dateSubtitleEl) {
      dateSubtitleEl.textContent = now.toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    }

    let totalValue = 0;
    let thisMonthVal = 0;
    let acceptedCount = 0;
    let sentCount = 0;
    let draftCount = 0;
    let rejectedCount = 0;
    const clientMap = {};

    quotes.forEach(q => {
      const gTotal = parseFloat(q.grandTotal) || 0;
      totalValue += gTotal;

      if (q.date) {
        const d = new Date(q.date);
        if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) {
          thisMonthVal += gTotal;
        }
      }

      const st = q.status || 'Draft';
      if (st === 'Accepted') acceptedCount++;
      else if (st === 'Sent') sentCount++;
      else if (st === 'Rejected') rejectedCount++;
      else draftCount++;

      const cName = q.clientCompany || q.clientName || 'Unknown Client';
      if (!clientMap[cName]) clientMap[cName] = { name: cName, total: 0, count: 0 };
      clientMap[cName].total += gTotal;
      clientMap[cName].count += 1;
    });

    const heroValEl = document.getElementById('dash-total-value');
    if (heroValEl) heroValEl.innerText = CalculationsEngine.formatCurrency(totalValue);

    const heroCountEl = document.getElementById('dash-hero-quote-count');
    if (heroCountEl) {
      heroCountEl.innerText = `${totalCount} quote${totalCount === 1 ? '' : 's'} in pipeline`;
    }

    const heroBarsEl = document.getElementById('dash-hero-bars');
    if (heroBarsEl) {
      const accPct = totalCount > 0 ? (acceptedCount / totalCount) * 100 : 0;
      const sentPct = totalCount > 0 ? (sentCount / totalCount) * 100 : 0;
      const draftPct = totalCount > 0 ? (draftCount / totalCount) * 100 : 0;
      const rejPct = totalCount > 0 ? (rejectedCount / totalCount) * 100 : 0;
      heroBarsEl.innerHTML = `
        <div class="bg-green-500 h-2 rounded-l-full transition-all" style="width: ${accPct}%" title="Accepted: ${acceptedCount}"></div>
        <div class="bg-blue-500 h-2 transition-all" style="width: ${sentPct}%" title="Sent: ${sentCount}"></div>
        <div class="bg-stone-500 h-2 transition-all" style="width: ${draftPct}%" title="Draft: ${draftCount}"></div>
        <div class="bg-red-500 h-2 rounded-r-full transition-all" style="width: ${rejPct}%" title="Rejected: ${rejectedCount}"></div>
      `;
    }

    const tqEl = document.getElementById('dash-total-quotes');
    if (tqEl) tqEl.innerText = totalCount;
    const tcEl = document.getElementById('dash-total-clients');
    if (tcEl) tcEl.innerText = clients.length;
    const mvEl = document.getElementById('dash-month-value');
    if (mvEl) mvEl.innerText = CalculationsEngine.formatCurrency(thisMonthVal);

    const recentTable = document.getElementById('dash-recent-quotes-table');
    if (recentTable) {
      const topQuotes = quotes.slice(0, 5);
      if (topQuotes.length === 0) {
        recentTable.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-stone-400">No quotations found. Click "+ New quotation" to create one.</td></tr>`;
      } else {
        recentTable.innerHTML = topQuotes.map(q => `
          <tr class="border-b border-stone-100 hover:bg-stone-50/80 transition-colors">
            <td class="py-3 px-3 font-code font-bold text-stone-900">${q.quoteNumber}</td>
            <td class="py-3 px-3">
              <div class="font-semibold text-stone-900">${this.escapeHtml(q.clientCompany || q.clientName)}</div>
              <div class="text-xs text-stone-500">${this.escapeHtml(q.clientName || '')}</div>
            </td>
            <td class="py-3 px-3 text-xs text-stone-500 font-code">${PdfGenerator.formatDate(q.date)}</td>
            <td class="py-3 px-3 font-semibold text-stone-900 font-code tabular-nums">${CalculationsEngine.formatCurrency(q.grandTotal)}</td>
            <td class="py-3 px-3 text-right">
              <div class="inline-flex items-center gap-1">
                <button onclick="App.openPrintPreview('${q.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer" title="Print/Preview">
                  <i class="fa-solid fa-eye text-sm"></i>
                </button>
                <button onclick="App.editQuotation('${q.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer" title="Edit">
                  <i class="fa-solid fa-pen-to-square text-sm"></i>
                </button>
              </div>
            </td>
          </tr>
        `).join('');
      }
    }

    const topClientsEl = document.getElementById('dash-top-clients-list');
    if (topClientsEl) {
      const topClients = Object.values(clientMap).sort((a, b) => b.total - a.total).slice(0, 5);
      if (topClients.length === 0) {
        topClientsEl.innerHTML = `<div class="p-6 text-center text-xs text-stone-400">No client quotations recorded yet.</div>`;
      } else {
        topClientsEl.innerHTML = topClients.map(c => `
          <div class="p-3.5 flex items-center justify-between hover:bg-stone-50 transition-colors">
            <div>
              <div class="font-semibold text-stone-900 text-sm">${this.escapeHtml(c.name)}</div>
              <div class="text-xs text-stone-500 font-code">${c.count} quotation${c.count > 1 ? 's' : ''}</div>
            </div>
            <div class="font-code font-semibold text-sm tabular-nums text-stone-900">${CalculationsEngine.formatCurrency(c.total)}</div>
          </div>
        `).join('');
      }
    }
  },

  // -------------------------------------------------------------
  // Quotations List View & Advanced Filters
  // -------------------------------------------------------------
  renderQuotationsList() {
    const tbody = document.getElementById('quotes-list-tbody');
    if (this.isLoadingData) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-16 text-stone-400 font-medium">
          <i class="fa-solid fa-spinner fa-spin mr-2 text-stone-500 text-base"></i> Loading quotations from Cloudflare D1...
        </td></tr>`;
      }
      return;
    }

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

    const paginationBar = document.getElementById('quotes-pagination-bar');
    if (!tbody) return;

    if (StorageManager.isOffline()) {
      tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center">
        <div class="inline-flex flex-col items-center justify-center p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 max-w-md mx-auto">
          <i class="fa-solid fa-wifi-slash text-2xl text-rose-500 mb-2"></i>
          <div class="font-bold text-sm">No Internet Connection - Please check your network</div>
          <p class="text-xs text-rose-600 mt-1 mb-3">Cannot load quotations without an active server connection.</p>
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
      tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-stone-400">No matching quotations found.</td></tr>`;
      if (paginationBar) paginationBar.innerHTML = `<span class="text-xs text-stone-400">0 quotations found</span>`;
      return;
    }

    const startIdx = (this.quotesPage - 1) * this.quotesPageSize;
    const endIdx = Math.min(startIdx + this.quotesPageSize, totalRecords);
    const paginated = filtered.slice(startIdx, endIdx);

    const canDelete = AuthManager.canDeleteQuotes();
    const canEdit = AuthManager.canEditQuotes();
    const canCreate = AuthManager.canCreateQuotations();

    tbody.innerHTML = paginated.map(q => {
      let statusColor = 'bg-stone-100 text-stone-700 border border-stone-200';
      if (q.status === 'Sent') statusColor = 'bg-blue-50 text-blue-800 border border-blue-200';
      if (q.status === 'Accepted') statusColor = 'bg-green-50 text-green-800 border border-green-200';
      if (q.status === 'Rejected') statusColor = 'bg-red-50 text-red-800 border border-red-200';

      return `
        <tr class="border-b border-stone-100 hover:bg-stone-50/80 transition-colors text-xs">
          <td class="py-3 px-3 font-code font-bold text-stone-900">${q.quoteNumber}</td>
          <td class="py-3 px-3">
            <div class="font-semibold text-stone-900 text-sm">${this.escapeHtml(q.clientCompany || q.clientName)}</div>
            <div class="text-[11px] text-stone-500">${q.clientName ? 'Attn: ' + this.escapeHtml(q.clientName) : ''} ${q.clientPhone ? '• ' + this.escapeHtml(q.clientPhone) : ''}</div>
          </td>
          <td class="py-3 px-3 text-stone-600 font-code">${PdfGenerator.formatDate(q.date)}</td>
          <td class="py-3 px-3 text-stone-500 font-code">${PdfGenerator.formatDate(q.validUntil)}</td>
          <td class="py-3 px-3 font-semibold text-stone-900 font-code tabular-nums text-sm">${CalculationsEngine.formatCurrency(q.grandTotal)}</td>
          <td class="py-3 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusColor}">
              ${q.status || 'Draft'}
            </span>
          </td>
          <td class="py-3 px-3">
            <span class="inline-flex items-center gap-1 font-medium text-stone-700 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded text-[11px]">
              <i class="fa-solid fa-user-pen text-stone-400 text-[10px]"></i>
              ${this.escapeHtml(q.createdByName || q.createdBy || 'System Administrator')}
            </span>
          </td>
          <td class="py-3 px-3 text-right">
            <div class="inline-flex items-center gap-1">
              <button onclick="App.openPrintPreview('${q.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer" title="View / Print PDF">
                <i class="fa-solid fa-file-pdf text-sm"></i>
              </button>
              ${canEdit ? `
              <button onclick="App.editQuotation('${q.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer" title="Edit Quote">
                <i class="fa-solid fa-pen-to-square text-sm"></i>
              </button>
              ` : ''}
              ${canCreate ? `
              <button onclick="App.duplicateQuote('${q.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer" title="Duplicate Quote">
                <i class="fa-solid fa-copy text-sm"></i>
              </button>
              ` : ''}
              ${canDelete ? `
                <button onclick="App.deleteQuote('${q.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-red-700 hover:bg-red-50 transition-colors cursor-pointer" title="Delete Quote">
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
    const tbody = document.getElementById('items-list-tbody');
    if (this.isLoadingData) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-16 text-stone-400 font-medium">
          <i class="fa-solid fa-spinner fa-spin mr-2 text-stone-500 text-base"></i> Loading items from Cloudflare D1...
        </td></tr>`;
      }
      return;
    }

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

    const paginationBar = document.getElementById('items-pagination-bar');
    if (!tbody) return;

    if (StorageManager.isOffline()) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center">
        <div class="inline-flex flex-col items-center justify-center p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 max-w-md mx-auto">
          <i class="fa-solid fa-wifi-slash text-2xl text-rose-500 mb-2"></i>
          <div class="font-bold text-sm">No Internet Connection - Please check your network</div>
          <p class="text-xs text-rose-600 mt-1 mb-3">Cannot load Item Master without an active server connection.</p>
          <button onclick="App.refreshDataLive()" class="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition">
            <i class="fa-solid fa-rotate-right mr-1"></i> Retry Connection
          </button>
        </div>
      </td></tr>`;
      if (paginationBar) paginationBar.innerHTML = '';
      return;
    }

    const canManageItems = AuthManager.canManageItems();
    const canDeleteRecords = AuthManager.canDeleteQuotes();

    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / this.itemsPageSize));
    if (this.itemsPage > totalPages) this.itemsPage = totalPages;
    if (this.itemsPage < 1) this.itemsPage = 1;

    if (totalRecords === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-stone-400">No items found in Item Master. Click "+ Add product" or "Import CSV" to create one.</td></tr>`;
      if (paginationBar) paginationBar.innerHTML = `<span class="text-xs text-stone-400">0 products found</span>`;
      return;
    }

    const startIdx = (this.itemsPage - 1) * this.itemsPageSize;
    const endIdx = Math.min(startIdx + this.itemsPageSize, totalRecords);
    const paginated = filtered.slice(startIdx, endIdx);

    tbody.innerHTML = paginated.map(it => `
      <tr class="border-b border-stone-100 hover:bg-stone-50/80 transition-colors text-xs">
        <td class="py-3 px-3 w-20 text-center">
          ${it.imageUrl ? `
            <img src="${it.imageUrl}" alt="Profile" class="h-8 max-w-16 object-contain mx-auto border border-stone-200 rounded p-0.5 bg-white shadow-xs" />
          ` : `
            <div class="h-8 w-12 bg-stone-100 border border-stone-200 rounded flex items-center justify-center text-[10px] text-stone-400 mx-auto">No Img</div>
          `}
        </td>
        <td class="py-3 px-3">
          <div class="font-semibold text-stone-900">${this.escapeHtml(it.name)}</div>
          ${it.description ? `<div class="text-[11px] text-stone-500 italic">${this.escapeHtml(it.description)}</div>` : ''}
        </td>
        <td class="py-3 px-3 font-semibold text-stone-700">
          <span class="bg-stone-100 text-stone-800 border border-stone-200 px-2 py-0.5 rounded text-[11px] font-semibold">${this.escapeHtml(it.unit || 'PCS')}</span>
        </td>
        <td class="py-3 px-3 font-semibold text-stone-900 font-code tabular-nums text-sm">
          ₹ ${parseFloat(it.rate || 0).toFixed(2)}
        </td>
        <td class="py-3 px-3 font-medium text-stone-700 font-code tabular-nums text-xs">
          ${(parseFloat(it.defaultWidth) || 3.50).toFixed(2)} Ft
        </td>
        <td class="py-3 px-3">
          <span class="inline-flex items-center gap-1 font-medium text-stone-700 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded text-[11px]">
            <i class="fa-solid fa-user-pen text-stone-400 text-[10px]"></i>
            ${this.escapeHtml(it.createdByName || it.createdBy || 'System Administrator')}
          </span>
        </td>
        <td class="py-3 px-3 text-right">
          <div class="inline-flex items-center gap-1">
            ${canManageItems ? `
              <button onclick="App.openItemModal('${it.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer" title="Edit Item">
                <i class="fa-solid fa-pen-to-square text-sm"></i>
              </button>
            ` : ''}
            ${canDeleteRecords ? `
              <button onclick="App.deleteItem('${it.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-red-700 hover:bg-red-50 transition-colors cursor-pointer" title="Delete Item">
                <i class="fa-solid fa-trash-can text-sm"></i>
              </button>
            ` : ''}
            ${!canManageItems && !canDeleteRecords ? `<span class="text-[11px] text-stone-400 font-medium">Read-Only</span>` : ''}
          </div>
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
    if (!AuthManager.canManageItems()) {
      this.showToast('Permission denied: You cannot manage items.', 'error');
      return;
    }
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

  async handleItemImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const preview = document.getElementById('item-form-image-preview');
    const hiddenData = document.getElementById('item-form-image-data');
    const origPreview = preview ? preview.innerHTML : '';

    if (preview) {
      preview.innerHTML = `
        <div class="flex items-center gap-2 text-xs text-orange-700 font-semibold">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <span>Compressing & uploading to cloud storage...</span>
        </div>
      `;
    }

    try {
      const compressedBase64 = await this.compressImage(file, 800, 0.75);
      const mediaUrl = await StorageManager.uploadMedia(compressedBase64, file.name);
      if (hiddenData) hiddenData.value = mediaUrl;
      this.renderItemModalPreview(mediaUrl);
      this.showToast('Product diagram uploaded to cloud storage!', 'success');
    } catch (err) {
      console.error('Item image upload error:', err);
      if (preview) preview.innerHTML = origPreview;
      this.showToast('Upload failed: ' + (err.message || 'Error uploading image'), 'error');
    } finally {
      event.target.value = '';
    }
  },

  async saveItemFromModal(e) {
    if (e) e.preventDefault();
    const id = document.getElementById('item-form-id').value;
    const currentUser = AuthManager.getCurrentUser();
    const authorName = (currentUser?.fullName || currentUser?.username || 'System Administrator').trim();

    const itemData = {
      id: id || undefined,
      name: document.getElementById('item-form-name').value.trim(),
      description: document.getElementById('item-form-desc').value.trim(),
      unit: document.getElementById('item-form-unit').value.trim(),
      rate: parseFloat(document.getElementById('item-form-rate').value) || 0,
      defaultWidth: parseFloat(document.getElementById('item-form-width').value) || 3.50,
      imageUrl: document.getElementById('item-form-image-data').value.trim(),
      createdBy: authorName,
      createdByName: authorName
    };

    if (!itemData.name) {
      this.showToast('Please provide an Item Name.', 'error');
      return;
    }

    const btn = document.getElementById('btn-save-item');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';
    }

    try {
      await StorageManager.saveItem(itemData);
      this.showToast(`Product "${itemData.name}" saved to Item Master!`, 'success');
      this.closeItemModal();
      this.renderItemsList();
    } catch (err) {
      this.showToast(err.message || 'No Internet Connection - Unable to save item', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  async deleteItem(itemId) {
    if (!AuthManager.canDeleteQuotes()) {
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
    if (!AuthManager.canCreateQuotations()) {
      this.showToast('Permission denied: You cannot create quotations.', 'error');
      return;
    }
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

    const defaultCompany = StorageManager.getDefaultCompany ? StorageManager.getDefaultCompany() : null;

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
      companyId: defaultCompany?.id || 'primary',
      companyName: defaultCompany?.companyName || defaultCompany?.name || '',
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
    if (!AuthManager.canEditQuotes()) {
      this.showToast('Permission denied: You cannot edit quotations.', 'error');
      return;
    }
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
    if (!AuthManager.canCreateQuotations()) {
      this.showToast('Permission denied: You cannot create quotations.', 'error');
      return;
    }
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

    // Restore and normalize product images across all items with master catalog fallback
    const masterCatalog = (StorageManager.getItems && typeof StorageManager.getItems === 'function') ? StorageManager.getItems() : [];
    q.items = (q.items || []).map(it => {
      let img = (it.imageUrl || it.image_url || it.image || '').trim();
      if (!img && masterCatalog.length > 0) {
        const itDesc = (it.description || it.name || '').trim().toLowerCase();
        const matched = masterCatalog.find(m =>
          (it.masterItemId && String(m.id) === String(it.masterItemId)) ||
          (itDesc && m.name && itDesc === m.name.trim().toLowerCase())
        );
        if (matched) {
          img = (matched.imageUrl || matched.image_url || matched.image || '').trim();
          if (!it.masterItemId) it.masterItemId = matched.id;
        }
      }
      return {
        ...it,
        imageUrl: img,
        image_url: img,
        image: img
      };
    });

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

    // Multi-Company Selector
    const defComp = StorageManager.getDefaultCompany ? StorageManager.getDefaultCompany() : null;
    const selectedCompanyId = q.companyId || defComp?.id || 'primary';
    this.populateQuotationCompanySelector(selectedCompanyId);

    const companies = StorageManager.getCompanies();
    const matchedComp = companies.find(c => c.id === selectedCompanyId) || companies[0] || {};
    const defaultCgst = matchedComp.cgstPercent !== undefined ? matchedComp.cgstPercent : (matchedComp.cgst_percent !== undefined ? matchedComp.cgst_percent : 9.0);
    const defaultSgst = matchedComp.sgstPercent !== undefined ? matchedComp.sgstPercent : (matchedComp.sgst_percent !== undefined ? matchedComp.sgst_percent : 9.0);

    const quoteCgst = (q.cgstPercent !== undefined && q.cgstPercent !== null) ? q.cgstPercent : ((q.cgst_percent !== undefined && q.cgst_percent !== null) ? q.cgst_percent : defaultCgst);
    const quoteSgst = (q.sgstPercent !== undefined && q.sgstPercent !== null) ? q.sgstPercent : ((q.sgst_percent !== undefined && q.sgst_percent !== null) ? q.sgst_percent : defaultSgst);
    const quoteIgst = (q.gstRate !== undefined && q.gstRate !== null) ? q.gstRate : 18.0;

    const elCgstInp = document.getElementById('edit-quote-cgst-percent');
    const elSgstInp = document.getElementById('edit-quote-sgst-percent');
    const elIgstInp = document.getElementById('edit-quote-igst-percent');
    if (elCgstInp) elCgstInp.value = quoteCgst;
    if (elSgstInp) elSgstInp.value = quoteSgst;
    if (elIgstInp) elIgstInp.value = quoteIgst;

    this.handleQuotationGstTypeChange();

    // Promotional Banner toggle
    const elBanner = document.getElementById('edit-quote-include-banner');
    if (elBanner) {
      elBanner.checked = (q.includeBanner !== undefined ? Boolean(q.includeBanner) : (q.include_banner !== undefined ? (q.include_banner === 1 || q.include_banner === '1' || q.include_banner === true) : true));
    }

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
      const itDesc = (item.description || item.name || '').trim().toLowerCase();
      const masterOptions = masterItems.map(m => {
        const isSelected = (item.masterItemId && String(item.masterItemId) === String(m.id)) || (itDesc && m.name && itDesc === m.name.trim().toLowerCase() && !item.isCustom);
        return `<option value="${m.id}" ${isSelected ? 'selected' : ''}>
          ${this.escapeHtml(m.name)} (₹${parseFloat(m.rate).toFixed(2)} / ${this.escapeHtml(m.unit)})
        </option>`;
      }).join('');

      // Check for image URL with master catalog fallback
      let itImg = (item.imageUrl || item.image_url || item.image || '').trim();
      if (!itImg && masterItems.length > 0) {
        const matched = masterItems.find(m =>
          (item.masterItemId && String(m.id) === String(item.masterItemId)) ||
          (itDesc && m.name && itDesc === m.name.trim().toLowerCase())
        );
        if (matched) {
          itImg = (matched.imageUrl || matched.image_url || matched.image || '').trim();
          item.imageUrl = itImg;
          item.image_url = itImg;
          item.image = itImg;
          if (!item.masterItemId) item.masterItemId = matched.id;
        }
      }

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
        <tr class="border-b border-stone-200 hover:bg-stone-50/50 transition-colors" data-item-idx="${idx}">
          <td class="py-2.5 px-2 text-center text-stone-500 font-semibold align-top pt-3">${idx + 1}</td>
          <td class="py-2.5 px-3 align-top">
            
            <!-- Item Selection Dropdown (Populated Dynamically from Items Master) -->
            <div class="space-y-1">
              <label class="text-[10px] font-semibold text-stone-600 uppercase tracking-wider block">
                <i class="fa-solid fa-boxes-stacked mr-1 text-stone-500"></i> Select Product / Item:
              </label>
              <select onchange="App.selectItemFromMaster(${idx}, this.value)" class="w-full text-xs font-semibold border border-stone-300 bg-stone-50 rounded-xl px-3 py-2 text-stone-900 focus:bg-white focus:border-stone-900 focus:outline-none transition-colors cursor-pointer">
                <option value="" disabled ${!item.description ? 'selected' : ''}>-- Select Product from Items Master --</option>
                ${masterOptions}
                <option value="__custom__" ${item.isCustom ? 'selected' : ''}>+ Custom Product / Item (Manual Entry)</option>
              </select>
            </div>

            <!-- Custom Product Name Input (Shown when custom item chosen) -->
            ${item.isCustom ? `
              <div class="mt-2">
                <label class="text-[10px] font-semibold text-stone-600 block mb-0.5">Custom Product Description:</label>
                <input type="text" class="w-full text-xs font-semibold border border-stone-300 rounded-xl px-2.5 py-1.5 bg-stone-50 focus:bg-white focus:border-stone-900 focus:outline-none transition-colors" 
                       value="${PdfGenerator.escapeHtml(item.description)}" 
                       onchange="App.updateItemField(${idx}, 'description', this.value)" 
                       placeholder="Enter custom product name / description..."/>
              </div>
            ` : ''}

            <!-- Sub-Remarks / Line Details (e.g. ROOFING SHEET) -->
            <div class="mt-1.5">
              <input type="text" class="w-full text-xs text-stone-700 border border-stone-200 rounded-xl px-2.5 py-1.5 bg-stone-50 focus:bg-white focus:border-stone-900 focus:outline-none transition-colors" 
                     value="${PdfGenerator.escapeHtml(item.subRemarks || '')}" 
                     onchange="App.updateItemField(${idx}, 'subRemarks', this.value)" 
                     placeholder="Specification remarks e.g. (ROOFING SHEET)"/>
            </div>

            <!-- Product Image Displayed Directly Below Selected Item in HTML Table -->
            <div class="mt-2">
              ${itImg ? `
                <div class="p-2 bg-stone-50 border border-stone-200 rounded-xl flex items-center justify-between gap-3 max-w-md">
                  <div class="flex items-center gap-2.5">
                    <img src="${itImg}" alt="Product Profile" class="h-10 max-w-44 object-contain bg-white rounded-lg p-1 border border-stone-200 shadow-2xs" />
                    <div>
                      <span class="text-xs font-semibold text-stone-900 block">Product Profile Diagram</span>
                      <span class="text-[11px] text-stone-500">Displayed on quotation PDF table</span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1">
                    <label class="h-8 w-8 rounded-lg inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 cursor-pointer transition-colors" title="Change Image">
                      <i class="fa-solid fa-camera text-xs"></i>
                      <input type="file" accept="image/*" class="hidden" onchange="App.handleLineItemImageUpload(${idx}, event)" />
                    </label>
                    <button type="button" onclick="App.removeItemImage(${idx})" class="h-8 w-8 rounded-lg inline-flex items-center justify-center text-red-700 hover:bg-red-50 text-xs transition-colors cursor-pointer" title="Remove Profile Image">
                      <i class="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </div>
              ` : `
                <label class="text-xs font-semibold text-stone-700 hover:text-stone-900 cursor-pointer inline-flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 border border-stone-300 px-3 py-1.5 rounded-xl transition-colors">
                  <i class="fa-solid fa-image text-stone-500"></i> Attach Product Profile Image
                  <input type="file" accept="image/*" class="hidden" onchange="App.handleLineItemImageUpload(${idx}, event)" />
                </label>
              `}
            </div>

            <!-- Nested Accessories Breakdown Subtable Accordion -->
            <div class="mt-1.5">
              ${subTableRows}
              <button type="button" onclick="App.addSubTableRow(${idx})" class="text-xs font-semibold text-orange-700 hover:underline inline-flex items-center gap-1 mt-1 cursor-pointer">
                <i class="fa-solid fa-plus-circle text-xs"></i> Add Accessories Breakdown Row
              </button>
            </div>
          </td>
          <td class="py-2.5 px-2 w-28 align-top">
            <input type="number" step="any" class="w-full text-xs font-semibold font-code tabular-nums text-center border border-stone-300 rounded-xl px-2 py-2 bg-stone-50 focus:bg-white focus:border-stone-900 focus:outline-none transition-colors mt-4" 
                   value="${item.quantity}" 
                   oninput="App.updateItemField(${idx}, 'quantity', this.value)"/>
          </td>
          <td class="py-2.5 px-2 w-28 align-top">
            <select class="w-full text-xs font-semibold border border-stone-300 rounded-xl px-2 py-2 bg-stone-50 text-stone-900 focus:bg-white focus:border-stone-900 focus:outline-none transition-colors mt-4 cursor-pointer"
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
            <input type="number" step="0.01" class="w-full text-xs font-semibold font-code tabular-nums text-center border border-stone-300 rounded-xl px-2 py-2 bg-stone-50 focus:bg-white focus:border-stone-900 focus:outline-none transition-colors mt-4" 
                   value="${item.rate}" 
                   oninput="App.updateItemField(${idx}, 'rate', this.value)"/>
          </td>
          <td id="line-item-amount-${idx}" class="py-2.5 px-3 w-32 text-right font-semibold text-stone-900 text-xs align-top pt-5 font-code tabular-nums">
            ₹ ${amt}
          </td>
          <td class="py-2.5 px-2 text-center w-10 align-top pt-4">
            <button type="button" onclick="App.removeLineItem(${idx})" class="h-8 w-8 rounded-lg inline-flex items-center justify-center text-red-700 hover:bg-red-50 text-xs transition-colors cursor-pointer" title="Delete Row">
              <i class="fa-solid fa-trash-can"></i>
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
    const masterImg = (masterItem.imageUrl || masterItem.image_url || masterItem.image || '').trim();
    item.imageUrl = masterImg;   // Automatically display Product Image below item!
    item.image_url = masterImg;
    item.image = masterImg;

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

  async handleLineItemImageUpload(itemIdx, event) {
    const file = event.target.files[0];
    if (!file || !this.currentQuotation || !this.currentQuotation.items[itemIdx]) return;

    this.showToast('Uploading product profile diagram to cloud storage...', 'info');
    try {
      const compressedBase64 = await this.compressImage(file, 800, 0.75);
      const mediaUrl = await StorageManager.uploadMedia(compressedBase64, file.name);
      this.currentQuotation.items[itemIdx].imageUrl = mediaUrl;
      this.currentQuotation.items[itemIdx].image_url = mediaUrl;
      this.currentQuotation.items[itemIdx].image = mediaUrl;
      this.renderEditorItemsTable();
      this.showToast('Profile image uploaded to cloud storage!', 'success');
    } catch (err) {
      console.error('Line item image upload error:', err);
      this.showToast('Failed to upload image: ' + err.message, 'error');
    } finally {
      event.target.value = '';
    }
  },

  removeItemImage(itemIdx) {
    if (!this.currentQuotation || !this.currentQuotation.items[itemIdx]) return;
    this.currentQuotation.items[itemIdx].imageUrl = '';
    this.currentQuotation.items[itemIdx].image_url = '';
    this.currentQuotation.items[itemIdx].image = '';
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
      image_url: '',
      image: '',
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
          <tr class="border-b border-stone-200 text-xs hover:bg-stone-50/70 transition-colors">
            <td class="py-2.5 px-2 text-center font-bold text-stone-400 w-12">${rIdx + 1}</td>
            <td class="py-2 px-2" style="background-color: #fce4ec;">
              <input type="number" step="any" min="0" class="h-11 w-full min-w-[90px] text-center font-bold text-stone-900 bg-white border border-pink-300 rounded-xl px-3 text-sm tabular-nums focus:outline-none focus:border-pink-600 focus:ring-2 focus:ring-pink-500/20 shadow-2xs"
                     value="${row.feet}" 
                     oninput="App.updateCalcRow(${bIdx}, ${rIdx}, 'feet', this.value)" placeholder="Feet"/>
            </td>
            <td class="py-2 px-2" style="background-color: #e1f5fe;">
              <input type="number" step="any" min="0" max="11.99" class="h-11 w-full min-w-[90px] text-center font-bold text-stone-900 bg-white border border-sky-300 rounded-xl px-3 text-sm tabular-nums focus:outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-500/20 shadow-2xs"
                     value="${row.inch}" 
                     oninput="App.updateCalcRow(${bIdx}, ${rIdx}, 'inch', this.value)" placeholder="Inch"/>
            </td>
            <td class="py-2 px-2" style="background-color: #fff9c4;">
              <input type="number" step="1" min="1" class="h-11 w-full min-w-[90px] text-center font-black text-stone-900 bg-white border border-amber-300 rounded-xl px-3 text-sm tabular-nums focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20 shadow-2xs"
                     value="${row.nos}" 
                     oninput="App.updateCalcRow(${bIdx}, ${rIdx}, 'nos', this.value)" placeholder="Nos"/>
            </td>
            <td id="calc-row-sqmeter-${bIdx}-${rIdx}" class="py-2 px-3 text-center font-semibold text-stone-900 font-code text-sm tabular-nums" style="background-color: #c8e6c9;">
              ${rowCalc.sqMetersDisplay}
            </td>
            <td id="calc-row-sqfeet-${bIdx}-${rIdx}" class="py-2 px-3 text-center font-bold text-stone-900 font-code text-sm tabular-nums" style="background-color: #e1bee7;">
              ${rowCalc.sqFeetDisplay}
            </td>
            <td class="py-2 px-2 text-center space-x-1.5 w-24">
              <button type="button" onclick="App.duplicateCalcRow(${bIdx}, ${rIdx})" class="h-9 w-9 rounded-lg inline-flex items-center justify-center text-stone-600 hover:text-stone-900 hover:bg-stone-200 transition-colors" title="Duplicate row">
                <i class="fa-solid fa-copy text-xs"></i>
              </button>
              <button type="button" onclick="App.removeCalcRow(${bIdx}, ${rIdx})" class="h-9 w-9 rounded-lg inline-flex items-center justify-center text-red-600 hover:text-red-800 hover:bg-red-50 transition-colors" title="Remove row">
                <i class="fa-solid fa-xmark text-sm"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      return `
        <div class="w-full border border-stone-200 rounded-2xl overflow-hidden bg-white shadow-xs">
          <!-- Calculation Block Header -->
          <div class="px-5 py-4 bg-stone-900 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1 w-full">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="text-xs uppercase font-bold text-orange-400 font-display tracking-wider">
                  <i class="fa-solid fa-calculator mr-1"></i> Calculation Block #${bIdx + 1}
                </span>
                <span class="bg-stone-800 text-stone-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-stone-700">
                  Cut-Length Dimensions
                </span>
              </div>
              <input type="text" class="h-11 w-full bg-stone-800 border border-stone-700 rounded-xl px-3.5 text-sm font-semibold text-white placeholder:text-stone-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
                     value="${PdfGenerator.escapeHtml(block.title)}"
                     onchange="App.updateCalcBlockMeta(${bIdx}, 'title', this.value)"
                     placeholder="Calculation Details for : ..."/>
            </div>

            <div class="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end shrink-0">
              <div class="flex items-center gap-2 bg-stone-800/90 px-3 py-1.5 rounded-xl border border-stone-700">
                <label class="text-xs font-semibold text-stone-300 whitespace-nowrap">Width (Ft):</label>
                <input type="number" step="0.01" class="h-11 w-24 bg-white text-stone-900 font-bold text-sm text-center rounded-xl px-2 border border-stone-300 tabular-nums focus:outline-none focus:border-orange-700 focus:ring-2 focus:ring-orange-700/20"
                       value="${block.sheetWidth || 3.50}"
                       oninput="App.updateCalcBlockMeta(${bIdx}, 'sheetWidth', this.value)"/>
              </div>

              <button type="button" onclick="App.removeCalculationBlock(${bIdx})" class="h-11 w-11 rounded-xl bg-stone-800 hover:bg-red-900/40 text-stone-300 hover:text-red-400 border border-stone-700 inline-flex items-center justify-center transition-colors cursor-pointer" title="Delete Calculation Block">
                <i class="fa-solid fa-trash-can text-sm"></i>
              </button>
            </div>
          </div>

          <!-- Measurement Rows Table -->
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-stone-100 border-b border-stone-200 text-xs font-bold uppercase tracking-wider text-stone-700">
                  <th class="py-3 px-2 text-center w-12">#</th>
                  <th class="py-3 px-2 text-center min-w-[100px] w-1/5" style="background-color: #fce4ec;">Feet</th>
                  <th class="py-3 px-2 text-center min-w-[100px] w-1/5" style="background-color: #e1f5fe;">Inch</th>
                  <th class="py-3 px-2 text-center min-w-[100px] w-1/5" style="background-color: #fff9c4;">Nos</th>
                  <th class="py-3 px-3 text-center min-w-[120px] w-1/5" style="background-color: #c8e6c9;">Sq. Meter</th>
                  <th class="py-3 px-3 text-center min-w-[120px] w-1/5" style="background-color: #e1bee7;">Sq.Feet</th>
                  <th class="py-3 px-2 text-center w-24">Action</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-200">
                ${rowsHtml}
              </tbody>
              <tfoot>
                <tr class="bg-stone-50 font-bold text-xs text-stone-900 border-t-2 border-stone-300">
                  <td colspan="3" class="py-3 px-3 text-right font-bold text-xs text-stone-600">
                    <span class="inline-flex items-center gap-1.5"><i class="fa-solid fa-ruler-combined text-stone-500"></i> Dimensions Total:</span>
                  </td>
                  <td id="calc-block-total-nos-${bIdx}" class="py-3 px-2 text-center font-bold text-sm text-stone-900 tabular-nums" style="background-color: #fff9c4;">
                    ${computed.totalNos} Pcs
                  </td>
                  <td id="calc-block-total-sqmeters-${bIdx}" class="py-3 px-3 text-center font-bold text-sm text-stone-900 font-mono tabular-nums" style="background-color: #c8e6c9;">
                    ${computed.totalSqMetersDisplay}
                  </td>
                  <td id="calc-block-total-sqfeet-${bIdx}" class="py-3 px-3 text-center font-bold text-sm text-stone-900 font-mono tabular-nums" style="background-color: #e1bee7;">
                    ${computed.totalSqFeetDisplay}
                  </td>
                  <td class="py-3 px-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Bottom Row: Add Row + Disclaimer -->
          <div class="p-3.5 bg-stone-50 border-t border-stone-200 flex flex-wrap justify-between items-center gap-3 text-xs">
            <button type="button" onclick="App.addCalcRow(${bIdx})" class="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-white border border-stone-300 hover:bg-stone-100 text-stone-900 text-xs font-semibold shadow-2xs transition-colors cursor-pointer">
              <i class="fa-solid fa-plus text-orange-700"></i>
              <span>Add Measurement Row</span>
            </button>

            <span class="text-xs text-stone-500 font-medium italic flex items-center gap-1.5">
              <i class="fa-solid fa-circle-info text-stone-400"></i> Informational reference only • Does not alter main quotation item quantity or price
            </span>
          </div>

        </div>
      `;
    }).join('');
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

    const cgstInpVal = document.getElementById('edit-quote-cgst-percent')?.value;
    const sgstInpVal = document.getElementById('edit-quote-sgst-percent')?.value;
    const igstInpVal = document.getElementById('edit-quote-igst-percent')?.value;

    const customCgstRate = cgstInpVal !== undefined && cgstInpVal !== '' ? (parseFloat(cgstInpVal) || 0) : 9.0;
    const customSgstRate = sgstInpVal !== undefined && sgstInpVal !== '' ? (parseFloat(sgstInpVal) || 0) : 9.0;
    const customGstRate = igstInpVal !== undefined && igstInpVal !== '' ? (parseFloat(igstInpVal) || 0) : 18.0;

    const totals = CalculationsEngine.calculateQuotationTotals(
      this.currentQuotation.items || [],
      loadingVal,
      this.currentQuotation.additionalCharges || [],
      gstType,
      customGstRate,
      this.currentQuotation.roundOff,
      customCgstRate,
      customSgstRate
    );

    const subEl = document.getElementById('calc-summary-subtotal');
    const loadEl = document.getElementById('calc-summary-loading');
    const cgstLabel = document.getElementById('calc-summary-cgst-label');
    const sgstLabel = document.getElementById('calc-summary-sgst-label');
    const igstLabel = document.getElementById('calc-summary-igst-label');
    const cgstEl = document.getElementById('calc-summary-cgst');
    const sgstEl = document.getElementById('calc-summary-sgst');
    const igstEl = document.getElementById('calc-summary-igst');
    const taxEl = document.getElementById('calc-summary-tax');
    const grandEl = document.getElementById('calc-summary-grand');
    const wordsEl = document.getElementById('calc-summary-words');

    if (subEl) subEl.innerText = totals.materialTotal.toFixed(2) + '/-';
    if (loadEl) loadEl.innerText = totals.loadingCharges.toFixed(2) + '/-';
    if (taxEl) taxEl.innerText = totals.gstAmount.toFixed(2) + '/-';

    if (cgstLabel) cgstLabel.textContent = `CGST (${totals.cgstRate}%):`;
    if (sgstLabel) sgstLabel.textContent = `SGST (${totals.sgstRate}%):`;
    if (igstLabel) igstLabel.textContent = `IGST (${totals.igstRate}%):`;
    if (cgstEl) cgstEl.innerText = totals.cgstAmount.toFixed(2) + '/-';
    if (sgstEl) sgstEl.innerText = totals.sgstAmount.toFixed(2) + '/-';
    if (igstEl) igstEl.innerText = totals.igstAmount.toFixed(2) + '/-';

    if (grandEl) grandEl.innerText = Math.round(totals.grandTotal) + '/-';
    if (wordsEl) wordsEl.innerText = totals.grandTotalWords;

    this.currentQuotation.materialTotal = totals.materialTotal;
    this.currentQuotation.gstType = gstType;
    this.currentQuotation.gstRate = totals.gstRate;
    this.currentQuotation.gstAmount = totals.gstAmount;
    this.currentQuotation.cgstPercent = totals.cgstRate;
    this.currentQuotation.sgstPercent = totals.sgstRate;
    this.currentQuotation.cgstAmount = totals.cgstAmount;
    this.currentQuotation.sgstAmount = totals.sgstAmount;
    this.currentQuotation.roundOff = totals.roundOff;
    this.currentQuotation.grandTotal = totals.grandTotal;
    this.currentQuotation.grandTotalWords = totals.grandTotalWords;
  },

  async saveCurrentQuotation() {
    const btnTop = document.getElementById('btn-save-quotation-top');
    const btnBottom = document.getElementById('btn-save-quotation-bottom');
    const origTopHtml = btnTop ? btnTop.innerHTML : '';
    const origBottomHtml = btnBottom ? btnBottom.innerHTML : '';

    if (btnTop) {
      btnTop.disabled = true;
      btnTop.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> <span>Saving...</span>';
    }
    if (btnBottom) {
      btnBottom.disabled = true;
      btnBottom.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> <span>Saving...</span>';
    }

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

      // Ensure all line items preserve their image properties and fallback to master if needed
      const masterCatalog = (StorageManager.getItems && typeof StorageManager.getItems === 'function') ? StorageManager.getItems() : [];
      this.currentQuotation.items = this.currentQuotation.items.map(item => {
        let img = (item.imageUrl || item.image_url || item.image || '').trim();
        if (!img && masterCatalog.length > 0) {
          const itDesc = (item.description || item.name || '').trim().toLowerCase();
          const matched = masterCatalog.find(m =>
            (item.masterItemId && String(m.id) === String(item.masterItemId)) ||
            (itDesc && m.name && itDesc === m.name.trim().toLowerCase())
          );
          if (matched) {
            img = (matched.imageUrl || matched.image_url || matched.image || '').trim();
            if (!item.masterItemId) item.masterItemId = matched.id;
          }
        }
        return {
          ...item,
          imageUrl: img,
          image_url: img,
          image: img
        };
      });

      // Recalculate all financials right before saving
      this.recalculateEditorFinancials();

      // Multi-Company Selection
      const compIdEl = document.getElementById('edit-quote-company-id');
      const selectedCompanyId = compIdEl?.value?.trim() || this.currentQuotation.companyId || 'primary';
      const companies = StorageManager.getCompanies();
      const matchedComp = companies.find(c => c.id === selectedCompanyId) || companies[0] || {};
      this.currentQuotation.companyId = selectedCompanyId;
      this.currentQuotation.companyName = matchedComp.companyName || matchedComp.name || '';

      // Promotional Banner Checkbox
      const bannerEl = document.getElementById('edit-quote-include-banner');
      this.currentQuotation.includeBanner = bannerEl ? (bannerEl.checked ? 1 : 0) : 1;
      this.currentQuotation.include_banner = this.currentQuotation.includeBanner;

      // Audit Trail Full Name Attribution
      const currentUser = AuthManager.getCurrentUser();
      const authorFullName = (currentUser?.fullName || currentUser?.username || 'System Administrator').trim();
      if (!this.currentQuotation.createdBy || this.currentQuotation.createdBy === 'Super Admin' || this.currentQuotation.createdBy === 'Sub-Admin') {
        this.currentQuotation.createdBy = authorFullName;
      }
      this.currentQuotation.createdByName = this.currentQuotation.createdByName || authorFullName;

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
    } finally {
      if (btnTop) {
        btnTop.disabled = false;
        btnTop.innerHTML = origTopHtml;
      }
      if (btnBottom) {
        btnBottom.disabled = false;
        btnBottom.innerHTML = origBottomHtml;
      }
    }
  },

  // -------------------------------------------------------------
  // Print & PDF Preview Modal
  // -------------------------------------------------------------
  openPrintPreview(quoteId) {
    const quote = StorageManager.getQuotationById(quoteId);
    if (!quote) return;

    const companySettings = StorageManager.getCompanySettingsForQuote(quote);
    const html = PdfGenerator.generateQuotationHtml(quote, companySettings);

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
          PdfGenerator.printQuotation(quote, companySettings);
        };
      }
      const downloadBtn = document.getElementById('btn-modal-download');
      if (downloadBtn) {
        downloadBtn.onclick = (e) => {
          if (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          PdfGenerator.downloadPdf(quote, companySettings);
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
    const tbody = document.getElementById('clients-list-tbody');
    if (this.isLoadingData) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-16 text-stone-400 font-medium">
          <i class="fa-solid fa-spinner fa-spin mr-2 text-stone-500 text-base"></i> Loading clients from Cloudflare D1...
        </td></tr>`;
      }
      return;
    }

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

    const paginationBar = document.getElementById('clients-pagination-bar');
    if (!tbody) return;

    if (StorageManager.isOffline()) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center">
        <div class="inline-flex flex-col items-center justify-center p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 max-w-md mx-auto">
          <i class="fa-solid fa-wifi-slash text-2xl text-rose-500 mb-2"></i>
          <div class="font-bold text-sm">No Internet Connection - Please check your network</div>
          <p class="text-xs text-rose-600 mt-1 mb-3">Cannot load clients without an active server connection.</p>
          <button onclick="App.refreshDataLive()" class="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition">
            <i class="fa-solid fa-rotate-right mr-1"></i> Retry Connection
          </button>
        </div>
      </td></tr>`;
      if (paginationBar) paginationBar.innerHTML = '';
      return;
    }

    const canManageClients = AuthManager.canManageClients();
    const canDeleteRecords = AuthManager.canDeleteQuotes();

    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / this.clientsPageSize));
    if (this.clientsPage > totalPages) this.clientsPage = totalPages;
    if (this.clientsPage < 1) this.clientsPage = 1;

    if (totalRecords === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-stone-400">No clients found. Click "+ Add client" or "Import CSV" to create one.</td></tr>`;
      if (paginationBar) paginationBar.innerHTML = `<span class="text-xs text-stone-400">0 clients found</span>`;
      return;
    }

    const startIdx = (this.clientsPage - 1) * this.clientsPageSize;
    const endIdx = Math.min(startIdx + this.clientsPageSize, totalRecords);
    const paginated = filtered.slice(startIdx, endIdx);

    tbody.innerHTML = paginated.map(c => `
      <tr class="border-b border-stone-100 hover:bg-stone-50/80 transition-colors text-xs">
        <td class="py-3 px-3">
          <div class="font-semibold text-stone-900 text-sm">${this.escapeHtml(c.companyName || c.name)}</div>
          ${c.companyName ? `<div class="text-stone-500 font-medium">Contact: ${this.escapeHtml(c.name)}</div>` : ''}
        </td>
        <td class="py-3 px-3 font-semibold text-stone-900 font-code">${this.escapeHtml(c.phone || 'N/A')}</td>
        <td class="py-3 px-3 text-stone-600 font-code">${this.escapeHtml(c.email || 'N/A')}</td>
        <td class="py-3 px-3 font-code text-stone-700">${this.escapeHtml(c.gstNumber || 'Unregistered')}</td>
        <td class="py-3 px-3 text-stone-500 max-w-xs truncate">${this.escapeHtml(c.address || '')}</td>
        <td class="py-3 px-3">
          <span class="inline-flex items-center gap-1 font-medium text-stone-700 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded text-[11px]">
            <i class="fa-solid fa-user-pen text-stone-400 text-[10px]"></i>
            ${this.escapeHtml(c.createdByName || c.createdBy || 'System Administrator')}
          </span>
        </td>
        <td class="py-3 px-3 text-right">
          <div class="inline-flex items-center gap-1">
            ${canManageClients ? `
              <button onclick="App.openClientModal('${c.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors cursor-pointer" title="Edit Client">
                <i class="fa-solid fa-pen-to-square text-sm"></i>
              </button>
            ` : ''}
            ${canDeleteRecords ? `
              <button onclick="App.deleteClient('${c.id}')" class="h-9 w-9 rounded-xl inline-flex items-center justify-center text-red-700 hover:bg-red-50 transition-colors cursor-pointer" title="Delete Client">
                <i class="fa-solid fa-trash-can text-sm"></i>
              </button>
            ` : ''}
            ${!canManageClients && !canDeleteRecords ? `<span class="text-[11px] text-stone-400 font-medium">Read-Only</span>` : ''}
          </div>
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
    this.updateRouteHash('quotations', this.quotesPage);
    this.renderQuotationsList();
  },
  setQuotesPageSize(size) {
    this.quotesPageSize = parseInt(size, 10) || 15;
    this.quotesPage = 1;
    this.updateRouteHash('quotations', 1);
    this.renderQuotationsList();
  },
  setClientsPage(page) {
    this.clientsPage = Math.max(1, page);
    this.updateRouteHash('clients', this.clientsPage);
    this.renderClientsList();
  },
  setClientsPageSize(size) {
    this.clientsPageSize = parseInt(size, 10) || 15;
    this.clientsPage = 1;
    this.updateRouteHash('clients', 1);
    this.renderClientsList();
  },
  setItemsPage(page) {
    this.itemsPage = Math.max(1, page);
    this.updateRouteHash('items', this.itemsPage);
    this.renderItemsList();
  },
  setItemsPageSize(size) {
    this.itemsPageSize = parseInt(size, 10) || 15;
    this.itemsPage = 1;
    this.updateRouteHash('items', 1);
    this.renderItemsList();
  },

  renderPaginationControls(container, currentPage, totalPages, fromNum, toNum, totalCount, pageSize, pageFn, sizeFn, entityName) {
    let pageButtons = '';
    const startP = Math.max(1, currentPage - 2);
    const endP = Math.min(totalPages, startP + 4);

    for (let p = startP; p <= endP; p++) {
      const active = p === currentPage;
      pageButtons += `
        <button onclick="${pageFn}(${p})" class="h-9 min-w-9 px-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${active ? 'bg-stone-900 text-white' : 'bg-white border border-stone-300 text-stone-900 hover:bg-stone-50'}">
          ${p}
        </button>
      `;
    }

    container.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-xs text-stone-600">Showing <strong class="font-semibold font-code text-stone-900">${fromNum}</strong> to <strong class="font-semibold font-code text-stone-900">${toNum}</strong> of <strong class="font-semibold font-code text-stone-900">${totalCount}</strong> ${entityName}</span>
        <span class="text-stone-300">|</span>
        <label class="flex items-center gap-1.5 text-xs text-stone-500">
          <span>Per page:</span>
          <select onchange="${sizeFn}(this.value)" class="h-9 border border-stone-300 rounded-xl px-2.5 text-xs bg-stone-50 text-stone-900 font-semibold focus:bg-white focus:border-stone-900 focus:outline-none transition-colors cursor-pointer">
            <option value="15" ${pageSize === 15 ? 'selected' : ''}>15</option>
            <option value="30" ${pageSize === 30 ? 'selected' : ''}>30</option>
            <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
            <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
          </select>
        </label>
      </div>

      <div class="flex items-center gap-1.5">
        <button onclick="${pageFn}(${currentPage - 1})" ${currentPage <= 1 ? 'disabled class="h-9 px-3 rounded-xl text-xs font-semibold bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed inline-flex items-center gap-1"' : 'class="h-9 px-3 rounded-xl text-xs font-semibold bg-white text-stone-900 border border-stone-300 hover:bg-stone-50 transition-colors inline-flex items-center gap-1 cursor-pointer"'} title="Previous Page">
          <i class="fa-solid fa-chevron-left text-[10px]"></i> Prev
        </button>
        ${pageButtons}
        <button onclick="${pageFn}(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled class="h-9 px-3 rounded-xl text-xs font-semibold bg-stone-100 text-stone-400 border border-stone-200 cursor-not-allowed inline-flex items-center gap-1"' : 'class="h-9 px-3 rounded-xl text-xs font-semibold bg-white text-stone-900 border border-stone-300 hover:bg-stone-50 transition-colors inline-flex items-center gap-1 cursor-pointer"'} title="Next Page">
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
    if (!AuthManager.canManageClients()) {
      this.showToast('Permission denied: You cannot manage clients.', 'error');
      return;
    }
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
    this.showToast(`Successfully imported ${saved.length} clients!`, 'success');
  },

  openItemCsvImportModal() {
    if (!AuthManager.canManageItems()) {
      this.showToast('Permission denied: You cannot manage items.', 'error');
      return;
    }
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
    if (!AuthManager.canManageClients()) {
      this.showToast('Permission denied: You cannot manage clients.', 'error');
      return;
    }
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
    const currentUser = AuthManager.getCurrentUser();
    const authorName = (currentUser?.fullName || currentUser?.username || 'System Administrator').trim();

    const clientData = {
      id: id || undefined,
      companyName: document.getElementById('client-form-company').value.trim(),
      name: document.getElementById('client-form-name').value.trim(),
      phone: document.getElementById('client-form-phone').value.trim(),
      email: document.getElementById('client-form-email').value.trim(),
      gstNumber: document.getElementById('client-form-gst').value.trim(),
      address: document.getElementById('client-form-address').value.trim(),
      createdBy: authorName,
      createdByName: authorName
    };

    if (!clientData.name && !clientData.companyName) {
      this.showToast('Please provide a Client Name or Company Name.', 'error');
      return;
    }

    const btn = document.getElementById('btn-save-client');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';
    }

    try {
      await StorageManager.saveClient(clientData);
      this.showToast('Client record saved successfully!', 'success');
      this.closeClientModal();
      this.renderClientsList();
      this.renderDashboard();
    } catch (err) {
      this.showToast(err.message || 'No Internet Connection - Unable to save client', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }
  },

  async deleteClient(clientId) {
    if (!AuthManager.canDeleteQuotes()) {
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
  // Settings View & Multi-Company Profile Management
  // -------------------------------------------------------------
  renderCompanyProfileTabs() {
    const bar = document.getElementById('settings-companies-tab-bar');
    if (!bar) return;

    const companies = StorageManager.getCompanies();
    if (!companies.some(c => c.id === this.activeCompanyId)) {
      this.activeCompanyId = companies[0]?.id || 'primary';
    }

    const addBtn = document.getElementById('btn-add-company-profile');
    if (addBtn) {
      if (companies.length >= 3) {
        addBtn.disabled = true;
        addBtn.classList.add('opacity-50', 'cursor-not-allowed');
        addBtn.title = 'Maximum limit of 3 Company Profiles reached';
      } else {
        addBtn.disabled = false;
        addBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        addBtn.title = 'Add new company profile (Up to 3)';
      }
    }

    const delBtn = document.getElementById('btn-delete-company-profile');
    if (delBtn) {
      if (companies.length <= 1) {
        delBtn.disabled = true;
        delBtn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        delBtn.disabled = false;
        delBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    bar.innerHTML = companies.map(c => {
      const isActive = c.id === this.activeCompanyId;
      const activeClasses = isActive
        ? 'bg-stone-900 text-white font-semibold border-stone-900'
        : 'bg-white text-stone-700 hover:bg-stone-100 border-stone-300';
      const label = this.escapeHtml(c.companyName || c.name || 'Company Profile');
      const badge = c.isDefault ? '<span class="text-[10px] uppercase px-1.5 py-0.5 bg-orange-100 text-orange-900 rounded font-semibold ml-1.5">Default</span>' : '';
      return `
        <button type="button" onclick="App.switchCompanyProfileTab('${c.id}')"
          class="h-10 px-3.5 rounded-xl text-xs border transition-colors flex items-center gap-2 cursor-pointer ${activeClasses}">
          <i class="fa-solid fa-building text-xs ${isActive ? 'text-white' : 'text-stone-500'}"></i>
          <span>${label}</span>
          ${badge}
        </button>
      `;
    }).join('');
  },

  switchCompanyProfileTab(companyId) {
    this.activeCompanyId = companyId;
    this.renderCompanyProfileTabs();

    const companies = StorageManager.getCompanies();
    const comp = companies.find(c => c.id === companyId) || companies[0] || {};

    const elName = document.getElementById('set-company-name');
    const elTag = document.getElementById('set-company-tagline');
    const elAddr = document.getElementById('set-company-address');
    const elPhone = document.getElementById('set-company-phone');
    const elPhone2 = document.getElementById('set-company-phone2');
    const elEmail = document.getElementById('set-company-email');
    const elGst = document.getElementById('set-company-gstin');

    if (elName) elName.value = comp.companyName || comp.name || '';
    if (elTag) elTag.value = comp.subtitle || comp.tagline || '';
    if (elAddr) elAddr.value = comp.address || '';
    if (elPhone) elPhone.value = comp.phone || '';
    if (elPhone2) elPhone2.value = comp.phoneSecondary || '';
    if (elEmail) elEmail.value = comp.email || '';
    if (elGst) elGst.value = comp.gstin || '';

    const elCgst = document.getElementById('set-company-cgst');
    const elSgst = document.getElementById('set-company-sgst');
    if (elCgst) elCgst.value = comp.cgstPercent !== undefined ? comp.cgstPercent : (comp.cgst_percent !== undefined ? comp.cgst_percent : 9);
    if (elSgst) elSgst.value = comp.sgstPercent !== undefined ? comp.sgstPercent : (comp.sgst_percent !== undefined ? comp.sgst_percent : 9);

    const elBank = document.getElementById('set-bank-name');
    const elAcName = document.getElementById('set-bank-acname');
    const elAcNo = document.getElementById('set-bank-acno');
    const elIfsc = document.getElementById('set-bank-ifsc');
    const elBranch = document.getElementById('set-bank-branch');

    if (elBank) elBank.value = comp.bankName || '';
    if (elAcName) elAcName.value = comp.accountName || comp.companyName || '';
    if (elAcNo) elAcNo.value = comp.accountNo || comp.accountNumber || '';
    if (elIfsc) elIfsc.value = comp.ifscCode || '';
    if (elBranch) elBranch.value = comp.branch || '';

    const elDefault = document.getElementById('set-company-is-default');
    if (elDefault) elDefault.checked = !!comp.isDefault;

    // Company Logo Preview
    const compLogo = comp.companyLogo || comp.company_logo || comp.headerLogoUrl || comp.header_logo_url || '';
    this.updateCompanyLogoPreview(compLogo);

    // Signature Preview
    const sigPreview = document.getElementById('set-signature-preview');
    if (sigPreview) {
      sigPreview.src = comp.authorizedSignature || 'assets/sample-signature.svg';
    }

    // Render active company's 3-column promotional banners grid
    this.renderSettingsBannersGrid();

    const elBannerToggle = document.getElementById('set-banner-toggle');
    if (elBannerToggle) {
      elBannerToggle.checked = (comp.showBannerInPdf !== undefined ? Boolean(comp.showBannerInPdf) : (comp.show_banner_in_pdf !== undefined ? Boolean(Number(comp.show_banner_in_pdf)) : true));
    }

    // Terms
    let terms = [];
    if (Array.isArray(comp.terms)) terms = comp.terms;
    else if (typeof comp.terms === 'string') {
      try { terms = JSON.parse(comp.terms); } catch (e) { terms = [comp.terms]; }
    }
    if (!terms.length) {
      const general = StorageManager.getSettings();
      terms = general.terms || [];
    }
    this.renderSettingsTerms(terms);
  },

  openAddCompanyModal() {
    const companies = StorageManager.getCompanies();
    if (companies.length >= 3) {
      this.showToast('Maximum of 3 Company Profiles reached. You must edit or delete an existing profile.', 'error');
      return;
    }
    const modal = document.getElementById('company-profile-modal');
    const form = document.getElementById('company-modal-form');
    const alertBox = document.getElementById('company-modal-alert');
    if (form) form.reset();
    if (alertBox) alertBox.classList.add('hidden');
    if (modal) modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-comp-name')?.focus(), 100);
  },

  closeCompanyModal() {
    const modal = document.getElementById('company-profile-modal');
    if (modal) modal.classList.add('hidden');
  },

  async handleSaveCompanyModal(e) {
    if (e) e.preventDefault();
    const nameInp = document.getElementById('modal-comp-name');
    const taglineInp = document.getElementById('modal-comp-tagline');
    const phoneInp = document.getElementById('modal-comp-phone');
    const gstinInp = document.getElementById('modal-comp-gstin');
    const emailInp = document.getElementById('modal-comp-email');
    const addrInp = document.getElementById('modal-comp-address');
    const isDefaultInp = document.getElementById('modal-comp-is-default');
    const btn = document.getElementById('btn-submit-company-modal');
    const alertBox = document.getElementById('company-modal-alert');

    const companyName = nameInp?.value?.trim() || '';
    if (!companyName) {
      if (alertBox) {
        alertBox.textContent = 'Company / Entity Name is required.';
        alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
      nameInp?.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';
    }

    const newComp = {
      id: 'comp_' + Date.now(),
      companyName: companyName,
      name: companyName,
      subtitle: taglineInp?.value?.trim() || '',
      tagline: taglineInp?.value?.trim() || '',
      phone: phoneInp?.value?.trim() || '',
      phoneSecondary: '',
      gstin: gstinInp?.value?.trim() || '',
      email: emailInp?.value?.trim() || '',
      address: addrInp?.value?.trim() || '',
      state: 'Gujarat',
      stateCode: '24',
      bankName: '',
      accountName: companyName,
      accountNo: '',
      accountNumber: '',
      ifscCode: '',
      branch: '',
      terms: ['Customer will be billed after acceptance of this quote.', 'Subject to local jurisdiction.'],
      companyLogo: '',
      company_logo: '',
      headerLogoUrl: '',
      authorizedSignature: 'assets/sample-signature.svg',
      promotionalBanner: '',
      promotionalBanners: [],
      bannerUrls: [],
      isDefault: !!isDefaultInp?.checked
    };

    try {
      await StorageManager.saveCompany(newComp);
      this.activeCompanyId = newComp.id;
      this.closeCompanyModal();
      this.renderCompanyProfileTabs();
      this.switchCompanyProfileTab(newComp.id);
      this.showToast(`Company profile "${companyName}" created successfully!`, 'success');
    } catch (err) {
      if (alertBox) {
        alertBox.textContent = err.message || 'Failed to save company profile';
        alertBox.className = 'text-xs p-3 rounded-xl font-semibold bg-rose-50 text-rose-800 border border-rose-200';
        alertBox.classList.remove('hidden');
      }
      this.showToast(err.message || 'Error creating company profile', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-plus text-amber-400"></i> <span>Create Company Profile</span>';
      }
    }
  },

  deleteCurrentCompanyProfile() {
    const companies = StorageManager.getCompanies();
    if (companies.length <= 1) {
      this.showToast('Cannot delete the only remaining company profile.', 'error');
      return;
    }

    const current = companies.find(c => c.id === this.activeCompanyId);
    const name = current?.companyName || current?.name || 'this company';

    const modal = document.getElementById('delete-company-modal');
    const text = document.getElementById('delete-company-name-text');
    if (text) {
      text.textContent = `Are you sure you want to permanently delete "${name}"? This action cannot be undone.`;
    }
    if (modal) modal.classList.remove('hidden');
  },

  closeDeleteCompanyModal() {
    const modal = document.getElementById('delete-company-modal');
    if (modal) modal.classList.add('hidden');
  },

  async confirmDeleteCompanyProfile() {
    const btn = document.getElementById('btn-confirm-delete-company');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Deleting...';
    }

    try {
      await StorageManager.deleteCompany(this.activeCompanyId);
      const remaining = StorageManager.getCompanies();
      this.activeCompanyId = remaining[0]?.id || 'primary';
      this.closeDeleteCompanyModal();
      this.renderCompanyProfileTabs();
      this.switchCompanyProfileTab(this.activeCompanyId);
      this.showToast('Company profile deleted successfully!', 'success');
    } catch (err) {
      this.showToast(err.message || 'Error deleting company profile', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-trash-can mr-1"></i> <span>Delete Profile</span>';
      }
    }
  },

  populateQuotationCompanySelector(selectedCompanyId) {
    const select = document.getElementById('edit-quote-company-id');
    if (!select) return;

    const companies = StorageManager.getCompanies();
    select.innerHTML = companies.map(c => {
      const isSel = (c.id === selectedCompanyId) || (!selectedCompanyId && c.isDefault);
      const label = this.escapeHtml(c.companyName || c.name || 'Company Profile');
      const defBadge = c.isDefault ? ' (Default)' : '';
      return `<option value="${c.id}" ${isSel ? 'selected' : ''}>${label}${defBadge}</option>`;
    }).join('');
  },

  handleQuotationCompanyChange(companyId) {
    if (!this.currentQuotation) return;
    const companies = StorageManager.getCompanies();
    const comp = companies.find(c => c.id === companyId) || companies[0] || {};
    this.currentQuotation.companyId = companyId;
    this.currentQuotation.companyName = comp.companyName || comp.name || '';

    const defaultCgst = comp.cgstPercent !== undefined ? comp.cgstPercent : (comp.cgst_percent !== undefined ? comp.cgst_percent : 9.0);
    const defaultSgst = comp.sgstPercent !== undefined ? comp.sgstPercent : (comp.sgst_percent !== undefined ? comp.sgst_percent : 9.0);

    const elCgstInp = document.getElementById('edit-quote-cgst-percent');
    const elSgstInp = document.getElementById('edit-quote-sgst-percent');
    if (elCgstInp) elCgstInp.value = defaultCgst;
    if (elSgstInp) elSgstInp.value = defaultSgst;

    this.recalculateEditorFinancials();
  },

  handleQuotationGstTypeChange() {
    const gstType = document.getElementById('edit-quote-gst-type')?.value || 'CGST_SGST';
    const cgstSgstInputs = document.getElementById('edit-quote-cgst-sgst-inputs');
    const igstInputs = document.getElementById('edit-quote-igst-inputs');
    const cgstRow = document.getElementById('calc-summary-cgst-row');
    const sgstRow = document.getElementById('calc-summary-sgst-row');
    const igstRow = document.getElementById('calc-summary-igst-row');
    const taxRow = document.getElementById('calc-summary-tax-row');

    if (gstType === 'CGST_SGST') {
      if (cgstSgstInputs) cgstSgstInputs.classList.remove('hidden');
      if (igstInputs) igstInputs.classList.add('hidden');
      if (cgstRow) cgstRow.classList.remove('hidden');
      if (sgstRow) sgstRow.classList.remove('hidden');
      if (igstRow) igstRow.classList.add('hidden');
      if (taxRow) taxRow.classList.add('hidden');
    } else if (gstType === 'IGST') {
      if (cgstSgstInputs) cgstSgstInputs.classList.add('hidden');
      if (igstInputs) igstInputs.classList.remove('hidden');
      if (cgstRow) cgstRow.classList.add('hidden');
      if (sgstRow) sgstRow.classList.add('hidden');
      if (igstRow) igstRow.classList.remove('hidden');
      if (taxRow) taxRow.classList.add('hidden');
    } else {
      // NONE or other
      if (cgstSgstInputs) cgstSgstInputs.classList.add('hidden');
      if (igstInputs) igstInputs.classList.add('hidden');
      if (cgstRow) cgstRow.classList.add('hidden');
      if (sgstRow) sgstRow.classList.add('hidden');
      if (igstRow) igstRow.classList.add('hidden');
      if (taxRow) taxRow.classList.add('hidden');
    }

    this.recalculateEditorFinancials();
  },

  renderSettings() {
    this.renderCompanyProfileTabs();
    this.switchCompanyProfileTab(this.activeCompanyId);

    const settings = StorageManager.getSettings();
    const workerInput = document.getElementById('set-worker-url');
    if (workerInput) workerInput.value = settings.integration?.workerUrl || localStorage.getItem('cf_worker_url') || '';

    const sigToggle = document.getElementById('set-signature-toggle');
    const sigTitle = document.getElementById('set-signature-title');
    if (sigToggle) sigToggle.checked = settings.media?.showSignatureInPdf !== false;
    if (sigTitle) sigTitle.value = settings.media?.signatureTitle || 'Authorized Signatory';

    const backupCard = document.getElementById('settings-db-backup-card');
    if (backupCard) {
      if (AuthManager.isSuperAdmin() || AuthManager.hasPermission('canBackupDatabase')) {
        backupCard.classList.remove('hidden');
      } else {
        backupCard.classList.add('hidden');
      }
    }
  },

  updateCompanyLogoPreview(url) {
    const preview = document.getElementById('set-company-logo-preview');
    const placeholder = document.getElementById('set-company-logo-placeholder');
    const removeBtn = document.getElementById('btn-remove-company-logo');
    const hiddenUrl = document.getElementById('set-company-logo-url');

    const cleanUrl = (url && typeof url === 'string') ? url.trim() : '';
    if (hiddenUrl) hiddenUrl.value = cleanUrl;

    if (cleanUrl) {
      if (preview) {
        preview.src = cleanUrl;
        preview.classList.remove('hidden');
      }
      if (placeholder) placeholder.classList.add('hidden');
      if (removeBtn) removeBtn.classList.remove('hidden');
    } else {
      if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
      }
      if (placeholder) placeholder.classList.remove('hidden');
      if (removeBtn) removeBtn.classList.add('hidden');
    }
  },

  async handleCompanyLogoUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    this.showToast('Uploading company logo to cloud storage...', 'info');

    try {
      const compressedBase64 = await this.compressImage(file, 800, 0.8);
      const mediaUrl = await StorageManager.uploadMedia(compressedBase64, file.name || 'company-logo.png');
      this.updateCompanyLogoPreview(mediaUrl);

      const companies = StorageManager.getCompanies();
      const current = companies.find(c => c.id === this.activeCompanyId);
      if (current) {
        current.companyLogo = mediaUrl;
        current.company_logo = mediaUrl;
        current.headerLogoUrl = mediaUrl;
        await StorageManager.saveCompany(current);
      }

      const settings = StorageManager.getSettings();
      if (this.activeCompanyId === 'primary' || (current && current.isDefault)) {
        if (!settings.company) settings.company = {};
        settings.company.companyLogo = mediaUrl;
        if (!settings.media) settings.media = {};
        settings.media.headerLogoUrl = mediaUrl;
        settings.media.companyLogo = mediaUrl;
        await StorageManager.saveSettings(settings);
      }

      this.showToast('Company logo uploaded and saved successfully!', 'success');
    } catch (err) {
      console.error('Company logo upload error:', err);
      this.showToast('Failed to upload logo: ' + err.message, 'error');
    } finally {
      event.target.value = '';
    }
  },

  async removeCompanyLogo() {
    this.updateCompanyLogoPreview('');

    const companies = StorageManager.getCompanies();
    const current = companies.find(c => c.id === this.activeCompanyId);
    if (current) {
      current.companyLogo = '';
      current.company_logo = '';
      current.headerLogoUrl = '';
      try {
        await StorageManager.saveCompany(current);
        this.showToast('Company logo removed', 'info');
      } catch (e) {
        console.warn('Could not auto-save company after removing logo:', e);
      }
    }

    const settings = StorageManager.getSettings();
    if (this.activeCompanyId === 'primary' || (current && current.isDefault)) {
      if (settings.company) settings.company.companyLogo = '';
      if (settings.media) {
        settings.media.headerLogoUrl = '';
        settings.media.companyLogo = '';
      }
      try {
        await StorageManager.saveSettings(settings);
      } catch (e) {}
    }
  },

  async handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const sigPreview = document.getElementById('set-signature-preview');
    const origSrc = sigPreview ? sigPreview.src : '';

    this.showToast('Uploading signature image to cloud storage...', 'info');

    try {
      const compressedBase64 = await this.compressImage(file, 800, 0.75);
      const mediaUrl = await StorageManager.uploadMedia(compressedBase64, file.name || 'signature.png');
      if (sigPreview) sigPreview.src = mediaUrl;

      const companies = StorageManager.getCompanies();
      const current = companies.find(c => c.id === this.activeCompanyId);
      if (current) {
        current.authorizedSignature = mediaUrl;
        await StorageManager.saveCompany(current);
      }

      const settings = StorageManager.getSettings();
      if (!settings.media) settings.media = {};
      settings.media.signatureImageUrl = mediaUrl;
      await StorageManager.saveSettings(settings);

      this.showToast('Authorized signature uploaded and saved for active company!', 'success');
    } catch (err) {
      console.error('Signature upload error:', err);
      if (sigPreview && origSrc) sigPreview.src = origSrc;
      this.showToast('Failed to upload signature: ' + err.message, 'error');
    } finally {
      event.target.value = '';
    }
  },

  renderSettingsTerms(terms) {
    const container = document.getElementById('settings-terms-list');
    if (!container) return;

    container.innerHTML = terms.map((t, idx) => `
      <div class="flex items-center gap-3 mb-3">
        <span class="text-xs font-semibold text-stone-500 w-6 text-right">${idx + 1}.</span>
        <input type="text" class="h-11 flex-1 text-sm bg-stone-50 border border-stone-300 rounded-xl px-3.5 text-stone-900 placeholder:text-stone-400 focus:bg-white focus:border-stone-900 focus:outline-none transition-colors"
               value="${PdfGenerator.escapeHtml(t)}"
               data-term-idx="${idx}"
               onchange="App.updateTermInSettings(${idx}, this.value)"/>
        <button type="button" onclick="App.removeTermFromSettings(${idx})" class="h-11 w-11 rounded-xl inline-flex items-center justify-center text-red-700 hover:bg-red-50 transition-colors cursor-pointer" title="Remove Term">
          <i class="fa-solid fa-trash-can text-sm"></i>
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

  /**
   * Compresses image using HTML5 canvas to max width & JPEG quality
   */
  compressImage(file, maxWidth = 800, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        };
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  },

  /**
   * Retrieves array of promotional/gallery banner images for the currently active company
   */
  getActiveCompanyBanners() {
    const companies = StorageManager.getCompanies();
    const current = companies.find(c => c.id === this.activeCompanyId) || companies[0];
    if (!current) return [];

    let banners = [];
    if (Array.isArray(current.promotionalBanners) && current.promotionalBanners.length > 0) {
      banners = current.promotionalBanners;
    } else if (Array.isArray(current.bannerUrls) && current.bannerUrls.length > 0) {
      banners = current.bannerUrls;
    } else if (typeof current.promotionalBanner === 'string' && current.promotionalBanner.trim()) {
      try {
        const parsed = JSON.parse(current.promotionalBanner);
        if (Array.isArray(parsed)) banners = parsed;
        else banners = [current.promotionalBanner.trim()];
      } catch (e) {
        banners = [current.promotionalBanner.trim()];
      }
    } else if (typeof current.bannerUrl === 'string' && current.bannerUrl.trim()) {
      try {
        const parsed = JSON.parse(current.bannerUrl);
        if (Array.isArray(parsed)) banners = parsed;
        else banners = [current.bannerUrl.trim()];
      } catch (e) {
        banners = [current.bannerUrl.trim()];
      }
    }

    return banners.filter(b => typeof b === 'string' && b.trim() && !b.includes('sample-banner.svg'));
  },

  /**
   * Renders the 3-column thumbnail grid of promotional images in Settings for active company
   */
  renderSettingsBannersGrid() {
    const grid = document.getElementById('set-banners-grid');
    const emptyBox = document.getElementById('set-banners-empty');
    const badge = document.getElementById('set-banners-count-badge');
    const toggle = document.getElementById('set-banner-toggle');
    if (!grid) return;

    const companies = StorageManager.getCompanies();
    const current = companies.find(c => c.id === this.activeCompanyId);
    const banners = this.getActiveCompanyBanners();

    if (badge) {
      badge.textContent = `${banners.length} / 12 Images`;
      badge.className = banners.length >= 12
        ? 'text-xs font-semibold text-orange-800 bg-orange-50 px-2.5 py-0.5 rounded-full border border-orange-200'
        : 'text-xs font-semibold text-stone-600 bg-stone-100 px-2.5 py-0.5 rounded-full border border-stone-200';
    }

    if (toggle && current) {
      toggle.checked = (current.showBannerInPdf !== undefined ? Boolean(current.showBannerInPdf) : (current.show_banner_in_pdf !== undefined ? Boolean(Number(current.show_banner_in_pdf)) : true));
    }

    if (!banners || banners.length === 0) {
      grid.innerHTML = '';
      if (emptyBox) emptyBox.classList.remove('hidden');
      return;
    }

    if (emptyBox) emptyBox.classList.add('hidden');

    grid.innerHTML = banners.map((bUrl, idx) => `
      <div class="relative group bg-white border border-stone-200 rounded-xl p-2.5 flex flex-col justify-between hover:border-stone-400 transition-colors">
        <div class="aspect-video w-full flex items-center justify-center bg-stone-50 rounded-lg overflow-hidden border border-stone-100">
          <img src="${bUrl}" alt="Product ${idx + 1}" class="max-h-28 w-full object-contain p-1" />
        </div>
        <div class="mt-2.5 pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
          <span class="font-semibold text-stone-700">Product #${idx + 1}</span>
          <button type="button" onclick="App.removeBannerImage(${idx})"
            title="Remove Product Image"
            class="h-7 px-2.5 rounded-lg text-red-700 bg-red-50 hover:bg-red-100 font-semibold text-xs transition-colors flex items-center gap-1 cursor-pointer">
            <i class="fa-solid fa-trash-can text-[10px]"></i>
            <span>Remove</span>
          </button>
        </div>
      </div>
    `).join('');
  },

  renderSettingsBanners(media = {}) {
    this.renderSettingsBannersGrid();
  },

  /**
   * Handles multi-image upload with client-side canvas compression (max 800px, 0.75 JPEG, up to 12 images)
   */
  async handleBannerUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const companies = StorageManager.getCompanies();
    const current = companies.find(c => c.id === this.activeCompanyId) || { id: this.activeCompanyId };
    let currentBanners = [...this.getActiveCompanyBanners()];

    if (currentBanners.length >= 12) {
      this.showToast('Maximum of 12 product images per company reached. Delete existing ones to add more.', 'warning');
      event.target.value = '';
      return;
    }

    const availableSlots = 12 - currentBanners.length;
    const filesToProcess = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, availableSlots);

    if (filesToProcess.length === 0) {
      this.showToast('Please select valid image files.', 'warning');
      event.target.value = '';
      return;
    }

    this.showToast(`Compressing & uploading ${filesToProcess.length} product image(s) to cloud storage...`, 'info');

    try {
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        if (filesToProcess.length > 1) {
          this.showToast(`Uploading image ${i + 1} of ${filesToProcess.length}...`, 'info');
        }
        const compressedBase64 = await this.compressImage(file, 800, 0.75);
        const mediaUrl = await StorageManager.uploadMedia(compressedBase64, file.name);
        currentBanners.push(mediaUrl);
      }

      current.promotionalBanners = currentBanners;
      current.bannerUrls = currentBanners;
      current.promotionalBanner = currentBanners.length > 0 ? JSON.stringify(currentBanners) : '';
      current.bannerUrl = current.promotionalBanner;

      await StorageManager.saveCompany(current);

      // Also update general settings if active company is primary or default
      if (this.activeCompanyId === 'primary' || current.isDefault) {
        const settings = StorageManager.getSettings();
        if (!settings.media) settings.media = {};
        settings.media.bannerUrl = current.bannerUrl;
        settings.media.bannerUrls = currentBanners;
        settings.media.promotionalBanners = currentBanners;
        await StorageManager.saveSettings(settings);
      }

      this.renderSettingsBannersGrid();
      this.showToast(`Successfully uploaded ${filesToProcess.length} product image(s) to cloud storage!`, 'success');
    } catch (err) {
      console.error('Banner upload error:', err);
      this.showToast('Failed to process uploaded images: ' + err.message, 'error');
      this.renderSettingsBannersGrid();
    } finally {
      event.target.value = '';
    }
  },

  /**
   * Deletes an individual promotional image by index and saves updated company profile
   */
  async removeBannerImage(index) {
    const companies = StorageManager.getCompanies();
    const current = companies.find(c => c.id === this.activeCompanyId);
    if (!current) return;

    let banners = [...this.getActiveCompanyBanners()];
    if (index >= 0 && index < banners.length) {
      banners.splice(index, 1);
      current.promotionalBanners = banners;
      current.bannerUrls = banners;
      current.promotionalBanner = banners.length > 0 ? JSON.stringify(banners) : '';
      current.bannerUrl = current.promotionalBanner;

      try {
        await StorageManager.saveCompany(current);

        if (this.activeCompanyId === 'primary' || current.isDefault) {
          const settings = StorageManager.getSettings();
          if (!settings.media) settings.media = {};
          settings.media.bannerUrl = current.bannerUrl;
          settings.media.bannerUrls = banners;
          settings.media.promotionalBanners = banners;
          await StorageManager.saveSettings(settings);
        }

        this.renderSettingsBannersGrid();
        this.showToast('Product image removed.', 'info');
      } catch (err) {
        this.showToast('Failed to update company banners: ' + err.message, 'error');
      }
    }
  },

  async saveAllSettings() {
    if (!AuthManager.canManageSettings()) {
      this.showToast('Permission denied: You cannot edit settings.', 'error');
      return;
    }

    const btn = document.getElementById('btn-save-settings');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> <span>Saving...</span>';
    }

    const settings = StorageManager.getSettings();

    const companyName = document.getElementById('set-company-name').value.trim();
    const tagline = document.getElementById('set-company-tagline').value.trim();
    const address = document.getElementById('set-company-address').value.trim();
    const phone = document.getElementById('set-company-phone').value.trim();
    const phoneSecondary = document.getElementById('set-company-phone2').value.trim();
    const email = document.getElementById('set-company-email').value.trim();
    const gstin = document.getElementById('set-company-gstin').value.trim();

    const bankName = document.getElementById('set-bank-name').value.trim();
    const accountName = document.getElementById('set-bank-acname').value.trim();
    const accountNumber = document.getElementById('set-bank-acno').value.trim();
    const ifscCode = document.getElementById('set-bank-ifsc').value.trim();
    const branch = document.getElementById('set-bank-branch').value.trim();
    const isDefault = !!document.getElementById('set-company-is-default')?.checked;

    // 1. Save Active Company Profile in Multi-Company Store
    const companies = StorageManager.getCompanies();
    const activeComp = companies.find(c => c.id === this.activeCompanyId) || { id: this.activeCompanyId };
    activeComp.companyName = companyName || activeComp.companyName || 'Primary Company';
    activeComp.name = activeComp.companyName;
    activeComp.subtitle = tagline;
    activeComp.tagline = tagline;
    activeComp.address = address;
    activeComp.phone = phone;
    activeComp.phoneSecondary = phoneSecondary;
    activeComp.email = email;
    activeComp.gstin = gstin;

    const elCgst = document.getElementById('set-company-cgst');
    const elSgst = document.getElementById('set-company-sgst');
    const cgstPercent = elCgst && elCgst.value !== '' ? (parseFloat(elCgst.value) || 0) : 9.0;
    const sgstPercent = elSgst && elSgst.value !== '' ? (parseFloat(elSgst.value) || 0) : 9.0;
    activeComp.cgstPercent = cgstPercent;
    activeComp.sgstPercent = sgstPercent;
    activeComp.cgst_percent = cgstPercent;
    activeComp.sgst_percent = sgstPercent;

    activeComp.bankName = bankName;
    activeComp.accountName = accountName;
    activeComp.accountNo = accountNumber;
    activeComp.accountNumber = accountNumber;
    activeComp.ifscCode = ifscCode;
    activeComp.branch = branch;
    activeComp.terms = settings.terms || [];
    activeComp.isDefault = isDefault;

    const logoUrlInput = document.getElementById('set-company-logo-url');
    const compLogo = logoUrlInput ? logoUrlInput.value.trim() : (activeComp.companyLogo || '');
    activeComp.companyLogo = compLogo;
    activeComp.company_logo = compLogo;
    activeComp.headerLogoUrl = compLogo;

    const sigPreview = document.getElementById('set-signature-preview');
    if (sigPreview && sigPreview.src && !sigPreview.src.includes('sample-signature.svg')) {
      activeComp.authorizedSignature = sigPreview.src;
    }
    const banners = this.getActiveCompanyBanners();
    activeComp.promotionalBanners = banners;
    activeComp.bannerUrls = banners;
    activeComp.promotionalBanner = banners.length > 0 ? JSON.stringify(banners) : '';
    activeComp.bannerUrl = activeComp.promotionalBanner;

    // 2. Only save general settings fallback if editing primary or default entity
    if (this.activeCompanyId === 'primary' || activeComp.isDefault) {
      settings.company = {
        name: companyName,
        tagline: tagline,
        address: address,
        phone: phone,
        phoneSecondary: phoneSecondary,
        email: email,
        gstin: gstin,
        state: 'Gujarat',
        stateCode: '24',
        cgstPercent: cgstPercent,
        sgstPercent: sgstPercent,
        companyLogo: compLogo,
        company_logo: compLogo
      };

      settings.bank = {
        bankName: bankName,
        accountName: accountName,
        accountNumber: accountNumber,
        ifscCode: ifscCode,
        branch: branch
      };

      if (!settings.media) settings.media = {};
      settings.media.bannerUrl = activeComp.bannerUrl;
      settings.media.bannerUrls = banners;
      settings.media.promotionalBanners = banners;
      settings.media.headerLogoUrl = compLogo;
      settings.media.companyLogo = compLogo;
      settings.media.company_logo = compLogo;
    }

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
    const bannerToggleInput = document.getElementById('set-banner-toggle');
    const showBannerVal = bannerToggleInput ? bannerToggleInput.checked : true;
    activeComp.showBannerInPdf = showBannerVal;
    activeComp.show_banner_in_pdf = showBannerVal ? 1 : 0;

    settings.media = {
      ...settings.media,
      showBannerInPdf: showBannerVal,
      showSignatureInPdf: sigToggleInput ? sigToggleInput.checked : true,
      signatureTitle: sigTitleInput ? sigTitleInput.value.trim() : 'Authorized Signatory'
    };

    try {
      await StorageManager.saveCompany(activeComp);
      await StorageManager.saveSettings(settings);
      this.renderCompanyProfileTabs();
      this.showToast('Company profile & settings saved successfully!', 'success');
    } catch (err) {
      this.showToast(err.message || 'No Internet Connection - Unable to save settings', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
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
    toast.className = 'flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold animate-fade-in bg-stone-900 text-white';
    let dotColor = 'bg-stone-400';
    if (type === 'success') dotColor = 'bg-green-400';
    if (type === 'error') dotColor = 'bg-red-400';
    if (type === 'warning' || type === 'info') dotColor = 'bg-orange-400';

    toast.innerHTML = `<span class="w-2.5 h-2.5 rounded-full ${dotColor} shrink-0"></span><span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => {
        if (toast.parentElement === container) {
          container.removeChild(toast);
        }
      }, 300);
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
