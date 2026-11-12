/**
 * Jalaram Enterprise - Quotation Manager
 * Standalone Cross-Platform Desktop Application (Electron.js)
 * 
 * Features:
 * 1. Persistent immutable data at app.getPath('userData') + '/local_database.json'
 * 2. Manual in-app OTA-style asset updater (extracts update.zip to userData/app-bundle and relaunches)
 * 3. Native File Dialogs for Backup Export & Restore
 * 4. macOS & Windows cross-platform lifecycle management
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

let mainWindow = null;

// Paths for persistent data and dynamic asset updates
const USER_DATA_PATH = app.getPath('userData');
const DB_FILE_PATH = path.join(USER_DATA_PATH, 'local_database.json');
const DYNAMIC_BUNDLE_DIR = path.join(USER_DATA_PATH, 'app-bundle');
const DYNAMIC_INDEX_HTML = path.join(DYNAMIC_BUNDLE_DIR, 'index.html');
const FACTORY_INDEX_HTML = path.join(__dirname, 'index.html');

/**
 * Determine which frontend assets to load:
 * If an update has been installed to userData/app-bundle/index.html, load that.
 * Otherwise, load the bundled factory index.html.
 */
function getActiveEntryHtml() {
  if (fs.existsSync(DYNAMIC_INDEX_HTML)) {
    console.log('[Electron] Loading dynamic asset bundle from:', DYNAMIC_INDEX_HTML);
    return DYNAMIC_INDEX_HTML;
  }
  console.log('[Electron] Loading factory asset bundle from:', FACTORY_INDEX_HTML);
  return FACTORY_INDEX_HTML;
}

/**
 * Safe atomic file writer
 */
function writeJsonAtomic(filePath, dataObj) {
  const tempPath = filePath + '.tmp_' + Date.now();
  const jsonStr = typeof dataObj === 'string' ? dataObj : JSON.stringify(dataObj, null, 2);
  fs.writeFileSync(tempPath, jsonStr, 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * Self-contained ZIP extraction function.
 * Uses adm-zip if available, with built-in pure Node zlib parser as fallback.
 */
function extractZipSafely(zipBufferOrPath, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  // 1. Try adm-zip if installed
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipBufferOrPath);
    zip.extractAllTo(targetDir, true);
    return { success: true, method: 'adm-zip' };
  } catch (err) {
    // Fall back to pure Node extraction below
    console.log('[Updater] adm-zip not active or failed, using built-in Node zip unpacker:', err.message);
  }

  // 2. Pure Node.js ZIP Extractor using Central Directory & zlib
  const buf = Buffer.isBuffer(zipBufferOrPath) ? zipBufferOrPath : fs.readFileSync(zipBufferOrPath);
  
  // Locate End of Central Directory (EOCD)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid update file: Not a valid ZIP archive (EOCD signature missing).');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const resolvedTarget = path.resolve(targetDir);

  let pos = cdOffset;
  let extractedCount = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new Error(`Corrupted ZIP central directory at entry ${i}`);
    }

    const compressionMethod = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);

    const rawName = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;

    // Normalize path and protect against Zip Slip traversal
    const safeName = rawName.replace(/\\/g, '/');
    const outPath = path.resolve(targetDir, safeName);
    if (!outPath.startsWith(resolvedTarget)) {
      throw new Error(`Security Violation: Zip Slip detected in entry "${rawName}"`);
    }

    if (safeName.endsWith('/')) {
      fs.mkdirSync(outPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    // Read local file header to find exact data start
    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid local header for entry "${safeName}"`);
    }

    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    const compressedSlice = buf.subarray(dataOffset, dataOffset + compressedSize);
    let fileBytes;

    if (compressionMethod === 0) {
      // Store (uncompressed)
      fileBytes = compressedSlice;
    } else if (compressionMethod === 8) {
      // Deflate
      fileBytes = zlib.inflateRawSync(compressedSlice);
    } else {
      throw new Error(`Unsupported compression method ${compressionMethod} in "${safeName}"`);
    }

    fs.writeFileSync(outPath, fileBytes);
    extractedCount++;
  }

  return { success: true, method: 'pure-node', extractedFiles: extractedCount };
}

/**
 * Create the main application window
 */
function createMainWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon-512.png');

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Jalaram Enterprise - Quotation Manager',
    backgroundColor: '#0f172a',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false // Allows loading local SVG diagrams and print templates smoothly
    }
  });

  // Custom application menu (standard clipboard, view, reload, shortcuts)
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Export Database Backup...',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:export-backup')
        },
        {
          label: 'Import Database Backup...',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu:import-backup')
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Data Directory',
          click: () => shell.openPath(USER_DATA_PATH)
        },
        {
          label: 'About Jalaram Enterprise',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Jalaram Enterprise Quotation Manager',
              message: 'Jalaram Enterprise Quotation Manager v3.5.0',
              detail: 'Industrial Roofing & Sheet Quotation Management System\nDharti Gate, Plot No 3, Shapar, Gujarat 360026\nPhone: +91 99134 93999\n\nDatabase Path: ' + DB_FILE_PATH
            });
          }
        }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Load the active asset bundle
  const entryHtml = getActiveEntryHtml();
  mainWindow.loadFile(entryHtml);

  // External links open in default web browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// =========================================================================
// IPC HANDLERS: DATABASE STORAGE (IMMUTABLE IN USERDATA)
// =========================================================================

/**
 * Read the entire database from app.getPath('userData')/local_database.json
 */
ipcMain.handle('db:read', async () => {
  try {
    if (!fs.existsSync(DB_FILE_PATH)) {
      console.log('[Electron DB] local_database.json not found. Returning null (fresh run).');
      return null;
    }
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf8');
    const data = JSON.parse(raw);
    console.log('[Electron DB] Successfully read database from:', DB_FILE_PATH);
    return data;
  } catch (err) {
    console.error('[Electron DB] Failed to read database:', err);
    return null;
  }
});

/**
 * Save the entire database to app.getPath('userData')/local_database.json
 */
ipcMain.handle('db:write', async (event, dataObj) => {
  try {
    fs.mkdirSync(USER_DATA_PATH, { recursive: true });
    writeJsonAtomic(DB_FILE_PATH, dataObj);
    return { success: true, timestamp: new Date().toISOString() };
  } catch (err) {
    console.error('[Electron DB] Failed to write database:', err);
    return { success: false, error: err.message };
  }
});

/**
 * Export database backup via native Save Dialog
 */
ipcMain.handle('db:export', async (event, currentData) => {
  try {
    const desktopPath = app.getPath('desktop');
    const defaultFilename = `jalaram_backup_${new Date().toISOString().split('T')[0]}.json`;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Jalaram Enterprise Database Backup',
      defaultPath: path.join(desktopPath, defaultFilename),
      filters: [{ name: 'JSON Backup (*.json)', extensions: ['json'] }]
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    const payload = currentData || (fs.existsSync(DB_FILE_PATH) ? JSON.parse(fs.readFileSync(DB_FILE_PATH, 'utf8')) : {});
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

    return { success: true, filePath };
  } catch (err) {
    console.error('[Electron DB] Export failed:', err);
    return { success: false, error: err.message };
  }
});

/**
 * Import database backup via native Open Dialog
 */
ipcMain.handle('db:import', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Jalaram Enterprise Database Backup',
      defaultPath: app.getPath('desktop'),
      filters: [{ name: 'JSON Backup (*.json)', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = filePaths[0];
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);

    if (!data || (!data.quotations && !data.clients && !data.items && !data.settings)) {
      throw new Error('Invalid backup file. The selected JSON does not contain Jalaram Enterprise data.');
    }

    // Save directly to persistent storage
    writeJsonAtomic(DB_FILE_PATH, data);
    console.log('[Electron DB] Backup imported and replaced local_database.json from:', filePath);

    return { success: true, data, filePath };
  } catch (err) {
    console.error('[Electron DB] Import failed:', err);
    return { success: false, error: err.message };
  }
});

// =========================================================================
// IPC HANDLERS: IN-APP SOFTWARE UPDATER (OTA-STYLE MANUAL UPDATE)
// =========================================================================

/**
 * Trigger native file dialog to select an update.zip file
 */
ipcMain.handle('update:select-file', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Quotation Manager Update Package',
      defaultPath: app.getPath('downloads'),
      filters: [{ name: 'ZIP Archive (*.zip)', extensions: ['zip'] }],
      properties: ['openFile']
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, filePath: filePaths[0] };
  } catch (err) {
    return { canceled: true, error: err.message };
  }
});

/**
 * Apply the update from a file path or Buffer.
 * Extracts update.zip into app.getPath('userData')/app-bundle/,
 * validates that index.html exists, and prepares relaunch.
 */
ipcMain.handle('update:apply', async (event, payload) => {
  try {
    console.log('[Updater] Processing software update package...');
    let zipSource = null;

    if (payload.filePath) {
      zipSource = payload.filePath;
    } else if (payload.buffer) {
      zipSource = Buffer.from(payload.buffer);
    } else {
      throw new Error('No update file provided. Pass either filePath or buffer.');
    }

    // 1. Prepare clean extraction target in userData/app-bundle-temp
    const tempBundleDir = path.join(USER_DATA_PATH, 'app-bundle-temp_' + Date.now());
    fs.mkdirSync(tempBundleDir, { recursive: true });

    // 2. Extract ZIP
    const extractResult = extractZipSafely(zipSource, tempBundleDir);
    console.log('[Updater] Extracted successfully:', extractResult);

    // 3. Locate index.html (handle cases where root folder was wrapped inside zip)
    let finalBundleRoot = tempBundleDir;
    if (!fs.existsSync(path.join(tempBundleDir, 'index.html'))) {
      const subEntries = fs.readdirSync(tempBundleDir);
      for (const entry of subEntries) {
        const candidate = path.join(tempBundleDir, entry);
        if (fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, 'index.html'))) {
          finalBundleRoot = candidate;
          break;
        }
      }
    }

    if (!fs.existsSync(path.join(finalBundleRoot, 'index.html'))) {
      // Clean up temp
      fs.rmSync(tempBundleDir, { recursive: true, force: true });
      throw new Error('Update verification failed: "index.html" was not found in the update package.');
    }

    // 4. Move to permanent dynamic bundle directory
    if (fs.existsSync(DYNAMIC_BUNDLE_DIR)) {
      fs.rmSync(DYNAMIC_BUNDLE_DIR, { recursive: true, force: true });
    }

    if (finalBundleRoot === tempBundleDir) {
      fs.renameSync(tempBundleDir, DYNAMIC_BUNDLE_DIR);
    } else {
      fs.cpSync(finalBundleRoot, DYNAMIC_BUNDLE_DIR, { recursive: true });
      fs.rmSync(tempBundleDir, { recursive: true, force: true });
    }

    // 5. Write update manifest
    const metaInfo = {
      installedAt: new Date().toISOString(),
      updatedBy: 'In-App Manual OTA Updater',
      target: DYNAMIC_BUNDLE_DIR
    };
    fs.writeFileSync(path.join(DYNAMIC_BUNDLE_DIR, 'update_meta.json'), JSON.stringify(metaInfo, null, 2), 'utf8');

    console.log('[Updater] Software update installed to:', DYNAMIC_BUNDLE_DIR);

    return {
      success: true,
      message: 'Update applied successfully! Restarting the application now...'
    };
  } catch (err) {
    console.error('[Updater] Failed to apply update:', err);
    return { success: false, error: err.message };
  }
});

/**
 * Revert to factory assets (deletes userData/app-bundle and restarts)
 */
ipcMain.handle('update:rollback', async () => {
  try {
    if (fs.existsSync(DYNAMIC_BUNDLE_DIR)) {
      fs.rmSync(DYNAMIC_BUNDLE_DIR, { recursive: true, force: true });
      console.log('[Updater] Removed custom bundle. Reverted to factory assets.');
    }
    app.relaunch();
    app.exit(0);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Relaunch the application
 */
ipcMain.handle('app:restart', async () => {
  app.relaunch();
  app.exit(0);
});

/**
 * Return system and application metadata
 */
ipcMain.handle('app:get-info', async () => {
  return {
    version: app.getVersion(),
    name: app.getName(),
    userDataPath: USER_DATA_PATH,
    dbPath: DB_FILE_PATH,
    isCustomBundle: fs.existsSync(DYNAMIC_INDEX_HTML),
    customBundleDir: DYNAMIC_BUNDLE_DIR,
    factoryIndexHtml: FACTORY_INDEX_HTML,
    platform: process.platform,
    arch: process.arch
  };
});

/**
 * Safely open external link
 */
ipcMain.handle('shell:open-external', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:'))) {
    await shell.openExternal(url);
    return { success: true };
  }
  return { success: false };
});

// =========================================================================
// APPLICATION LIFECYCLE
// =========================================================================

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
