========================================================================
     JALARAM ENTERPRISE - INDUSTRIAL ROOFING QUOTATION MANAGER
                 Portable Client Quick-Start Guide
========================================================================

Welcome to the Jalaram Enterprise Quotation Management Application.
This software runs locally on your PC, works 100% offline using an
internal IndexedDB database, and synchronizes to Google Sheets when
connected to the internet.

------------------------------------------------------------------------
DESKTOP APPLICATION BUILD COMMANDS (ELECTRON.JS)
------------------------------------------------------------------------
To run or build standalone desktop applications:

1. RUN IN DESKTOP MODE:
   npm start

2. BUILD WINDOWS INSTALLER (.exe & Portable):
   npm run build:win
   -> Creates Windows NSIS installer and standalone portable .exe in "dist/"

3. BUILD MACOS INSTALLER (.dmg & .zip):
   npm run build:mac
   -> Creates macOS DMG installer and universal application bundle in "dist/"

4. MANUAL IN-APP SOFTWARE UPDATES (ZERO DATA CONFLICTS):
   - User data is permanently preserved in:
     app.getPath('userData')/local_database.json
   - To update frontend UI/logic without touching database:
     Go to Settings -> Software Update -> Select "update.zip".
     The app extracts assets and automatically restarts with zero downtime!

------------------------------------------------------------------------
HOW TO RUN ON ANY WINDOWS PC (3 SIMPLE STEPS WITHOUT NODE/NPM)
------------------------------------------------------------------------

STEP 1: UNZIP THIS FOLDER
   Extract this entire folder anywhere on your computer:
   (For example: Desktop or C:\Jalaram-Quotation-Manager)

STEP 2: DOUBLE-CLICK "start.bat"
   Double-click the "start.bat" file inside this folder.
   - It will automatically launch a lightweight local server.
   - Your web browser (Edge, Chrome, Brave) will immediately open:
     http://localhost:8000
   - TIP: Click the "Install App to Windows" button in the top navigation
     bar to install it as a standalone Windows Desktop application!

STEP 3: RESTORE YOUR DATA (PC MIGRATION / REFORMAT)
   If you are setting up on a new PC or formatted computer:
   1. Open the app and click the "Settings" tab in the top menu.
   2. Scroll down to the "Local Database Backup & Restore" section.
   3. Click "Import Database (JSON)" and select your saved "jalaram_backup.json" file.
   4. All your previous Quotations, Clients, Item Master catalog,
      and business settings will instantly be restored!

------------------------------------------------------------------------
DAILY USAGE & FEATURES
------------------------------------------------------------------------
- Quotations: Create, duplicate, edit, and print high-resolution PDFs.
- Items Master: Manage pre-defined roofing sheets, profile images, and prices.
- Clients: Manage contact details and GST numbers. Bulk import/export with CSV.
- Sheet Size Calculator: Informational Feet/Inch to Sq.Ft & Sq.Meter calculator.
- Backup Anytime: Go to Settings -> "Export Database (JSON)" to save a fresh
  copy of all your data to a USB flash drive or cloud folder.

------------------------------------------------------------------------
SUPPORT & CONTACT
------------------------------------------------------------------------
Jalaram Enterprise
Address: Dharti Gate, Plot No 3, Shapar, Gujarat 360026
Phone:   +91 99134 93999 / +91 98252 12345
========================================================================
