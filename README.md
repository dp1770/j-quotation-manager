# Jalaram Enterprise - Quotation Manager (PWA)

A production-ready, responsive Progressive Web Application (PWA) engineered to replicate the exact layout, sequence, calculation logic, and design of industrial roofing quotations (as demonstrated in the sample 7-page quotation).

Designed for local-first execution on Desktop (macOS, Windows, Linux) and Mobile (Android, iOS), with seamless bi-directional synchronization to Google Sheets as a free, scalable cloud database.

---

## 📑 Exact 4-Part Sequential Structure Replicated from the PDF

The application interface, print engine, and PDF export strictly divide the quotation into 4 distinct editable parts:

### PART 1: Quotation Header & Main Summary Pricing Table (Page 1)
- **Top Header**:
  - Left: Jalaram Enterprise business info, address (Dharti Gate, Plot No 3, Shapar, Gujarat 360026), phone numbers (+91 99134 93999 / +91 98252 12345), email, and GSTIN (in bold cyan `GST NO. 24AAHFJ9913A1ZP`).
  - Right: High-resolution 3D corrugated color coated roofing sheets illustration.
- **Divider & Title**: Clean gradient divider line and centered cyan title `Quotation`.
- **Client & Quotation Meta**:
  - `To, [Client / Business Name, e.g. RUDRA CAST]`
  - `Quote Number: QT-2025-26-373`
  - `Quote Date: 2026-03-20`
  - `Valid Until: 2026-03-22`
  - `Mobile No. : ...`
- **Main Items Pricing Table (Cyan Header `#00a2e8`)**:
  - Columns: `No.` | `ITEM NAME` | `QUANTITY` | `PRICE` | `TOTAL AMOUNT`
  - Sub-items and line remarks (e.g., `(ROOFING SHEET)`, `(CRIMPING ROOFING SHEET)`, `(44" X 1 MTR = 14 PCS)`).
  - Nested accessories breakdown sub-table (as shown in Item 9):
    `Description` | `Inch/Kg` | `NOS` | `Weight` | `Remarks`
- **Financial Breakdown Block (Bottom Right of Table)**:
  - `TOTAL` (Material Subtotal, e.g. `1843549.40/-`)
  - `Loading Charge` (Editable, e.g. `1969.82/-`)
  - `GST 18% (SGST 9% CGST 9%)` (or `IGST 18%` toggle, e.g. `331838.89/-`)
  - `GRAND TOTAL` (Rounded off, e.g. `2177358/-`)
- **Page 1 Running Footer**:
  `JALARAM ENTERPRISE [ CONTACT NO. +91 99134 93999 / +91 98252 12345 ]`

---

### PART 2: Dynamic Multi-Block Sheet Calculation Tables (Pages 2 - 5)
- **Page 2 Top**: `GRAND TOTAL 2177358/-` bold header carried over from Page 1 with separator line.
- **Dynamic Multi-Block Support**:
  - Add multiple independent calculation tables for different sheet colors, profiles, or roof slopes (e.g. Roofing Sheet, Crimping Sheet, Polycarbonate Double Wally).
  - Customizable block title: `Calculation Details for : PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET`.
- **Configurable Sheet Width**: Default `3.50 Feet` (independently editable per block).
- **Exact 5-Column Color Coding Matching the Sample PDF**:
  1. `Feet` (Soft Pink `#fce4ec`)
  2. `Inch` (Soft Blue `#e1f5fe`)
  3. `Nos` (Soft Yellow/Amber `#fff9c4`)
  4. `Sq. Meter` (Soft Mint Green `#c8e6c9`)
  5. `Sq.Feet` (Soft Lilac `#e1bee7`)
- **Mathematical Formula & 4-Decimal Precision**:
  $$\text{Length in Feet} = \text{Feet} + \left(\frac{\text{Inch}}{12}\right)$$
  $$\text{Sq. Feet} = \left(\text{Feet} + \frac{\text{Inch}}{12}\right) \times \text{Width} \times \text{Nos}$$
  $$\text{Sq. Meter} = \frac{\text{Sq. Feet}}{10.76391042}$$
  *(e.g., Feet: 4.00, Inch: 5.00, Nos: 1, Width: 3.50 $\rightarrow$ Sq. Meter: `1.4363`, Sq.Feet: `15.4600`)*
- **Live 2-Way Reactive Binding**: Modifying any dimension immediately recalculates Sq. Feet, Sq. Meter, and block totals.
- **Actions**: Add Row, Duplicate Row, Delete Row, Add Another Block, and **"Apply Sq.Ft to Item Qty"** button.
- **Page Running Footer** on every page.

---

### PART 3: Bank Details, Terms and Conditions & Authorized Signatory (Page 6)
- **Bank Details**:
  - Bank Name: `CENTRAL BANK OF INDIA` (or custom in Settings)
  - Account Number: `5786682221`
  - IFSC Code: `CBIN0280569`
  - Branch: `BHUPENDRA ROAD, RAJKOT`
- **Numbered Terms and Conditions**:
  1. Customer will be billed after indicating acceptance of this quote.
  2. Payment 50% Advance And 50% before goods Dispatched.
  3. Transport Transaction Extra
  4. The Responsibility Of All the Material Will Be With That Company. There Will Be No Responsibility Of The Distributor I.E. JALARAM ENTERPRISE.
  5. `SUBJECT TO GONDAL JURISDICTION.`
- **Authorized Signatory Image**:
  - Uploaded signature image (dark blue cursive signature or company stamp) rendered directly above "Authorized Signatory" on the bottom right.
  - Centered System Disclaimer Note: *"This is a system-generated quotation."*

---

### PART 4: Bottom Promotional & Product Banner Gallery (Page 7)
- Replicates Page 7 of the sample PDF:
  - Product showcase cards: Rooftop Air Ventilator, Polycarbonate Multiwall Sheet, Deck Sheet, Revarce Crimping sheet, Puf Panel Sheet, Polycarbonate Sheet, Tile Profile Roofing Sheet, Insulated Metal Roofing Sheets, Crimping accessories, Insulation Roofing sheet, Self Drilling Screws.
  - Official Brand Badges: TILARA, JSW Colouron+, JSW Silveron+, JSW Pragati+, AM/NS INDIA, PRIMUS Fastening Technology, Landmark Fasteners.
- Managed from Settings: toggle on/off, upload custom banners, or replace with new images.
- Print media rule (`page-break-before: always;`) ensures it renders on its own final page.

---

## 🧭 Navigation & Core Modules
The persistent Top Navbar contains exactly these 6 visible tabs:
1. **Dashboard:** Key metrics, quick quote action, recent activity overview.
2. **Quotations:** Quotation list, search, status filters, duplicate, PDF export, and direct email dispatch.
3. **Clients:** Client directory (Company, Contact Name, Phone, Email, GSTIN, Address).
4. **Items Master:** Dedicated product catalog to manage recurring items, default units, prices, standard widths (3.50 Ft), and cross-section profile diagram uploads.
5. **Settings:** Dynamic company profile, bank payment information, GST rates, customizable Terms & Conditions, promotional footer banner, and **Authorized Signatory Signature Image Upload**.
6. **Users & RBAC:** User accounts, role assignment (Super Admin / Sub-Admin), and granular privilege management.

---

## 📦 Key Modules & Features

### 1. Dedicated Items Master (`Items Master` tab)
- Standalone master catalog dashboard for admins to manage all products:
  - **Item Name**: e.g., `PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET`
  - **Description / Sub-Remarks**: e.g., `(ROOFING SHEET)`, `(CRIMPING ROOFING SHEET)`
  - **Default Unit**: `kg(approx.)`, `SQ.FEET`, `R.FEET`, `PCS`, `SET`, `NOS`
  - **Default Price**: Pre-loaded rate per unit
  - **Default Size / Width**: Configurable sheet width in Feet (e.g., `3.50 Ft`)
  - **Image / Profile Diagram Upload**: Upload cross-section diagrams or corrugated profiles (SVG / PNG / JPG) that automatically display beneath the item name in quotation tables and generated PDFs.
- **Smart Item Selection Dropdown**: The quotation editor renders a `<select>` dropdown populated dynamically from the Items Master. When an item is selected, it auto-fills the Unit Price, displays the product diagram directly below the item, and initializes the size calculation parameters without altering item quantity.

### 2. Informational Calculation Blocks (Strictly Decoupled)
- Size calculation blocks (Inputs: Feet, Inch, Nos -> Outputs: Sq. Feet, Sq. Meter) are **strictly for informational reference** for the customer.
- **Independent Main Items**: Does NOT automatically apply or alter main line item quantities or final amounts. Main item quantities and rates are handled independently.
- **Pure Dimensional Measurements**: Shows only dimensional measurements (Feet, Inch, Nos, Sq. Meter, Sq. Feet) and summary dimension totals, with no monetary boxes or pricing aggregates.
- **Removed "BLOCK AGGREGATE TOTAL" & "Apply to Item Qty"**: Cleaned of any aggregate monetary blocks or binding buttons.

### 3. Intelligent Layout & Whitespace Management
- Dynamic table rendering without artificial height constraints (`min-h-[1050px]` removed).
- Docked Totals: Grand Total and Tax summary dock immediately beneath the calculation blocks or pricing table without awkward blank vertical gaps.

### 4. Direct Email Dispatch ("Send via Email")
- Modal to review recipient email, subject, and personalized message body.
- When connected to Google Apps Script Web App, automatically renders and attaches the quotation PDF via `MailApp.sendEmail`.
- Instant fallback to native mail client (`mailto:`) if working 100% offline.

---

## 🚀 Running the PWA Locally

### Option 1: Python HTTP Server (Recommended)
From your terminal in `/Users/dhavalpansuriya/Desktop/Local/jalaram-patra/Quotation Manager`:
```bash
python3 server.py
```
Open **`http://localhost:8080`** in your browser.

### Option 2: Direct File Launch
Double-click [index.html](file:///Users/dhavalpansuriya/Desktop/Local/jalaram-patra/Quotation%20Manager/index.html) to open directly in Chrome, Safari, or Edge.

### Option 3: Node / npm
```bash
npm start
# or
npx serve .
```

---

## ☁️ Google Sheets Cloud Backend Setup

Follow [GOOGLE_SHEETS_SETUP.md](file:///Users/dhavalpansuriya/Desktop/Local/jalaram-patra/Quotation%20Manager/GOOGLE_SHEETS_SETUP.md):
1. Create a new Google Sheet at [sheets.new](https://sheets.new).
2. Go to **Extensions** > **Apps Script**.
3. Copy and paste the code from [google-apps-script/Code.gs](file:///Users/dhavalpansuriya/Desktop/Local/jalaram-patra/Quotation%20Manager/google-apps-script/Code.gs).
4. Run `initSheets` once to initialize the sheet tabs (`Quotations`, `Clients`, `Settings`, `Users`).
5. Click **Deploy** > **New deployment** > Choose **Web app** > Set **Who has access** to **Anyone**.
6. Copy the **Web App URL**, open the PWA, go to **Settings** > **Google Sheets Integration**, paste the URL, and click **Test Connection**.

---

## 🔒 Default Credentials

| Role | Username | Password | Privileges |
|---|---|---|---|
| **Super Admin** | `admin` | `password123` | Full Access (Protected from deletion or revocation) |
