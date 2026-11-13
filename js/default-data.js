/**
 * Quotation Manager SaaS
 * 100% White-Label Default Configuration & Sample Data
 */

const DEFAULT_SETTINGS = {
  company: {
    name: 'Quotation Manager',
    tagline: 'Professional Quotation Management',
    address: 'Business Address Here',
    phone: '+91 00000 00000',
    phoneSecondary: '',
    email: 'info@company.com',
    website: 'www.company.com',
    gstin: '24AAAAA0000A1Z5',
    state: 'Gujarat',
    stateCode: '24'
  },
  bank: {
    bankName: 'Primary Bank Name',
    accountName: 'Enterprise Account',
    accountNumber: '000000000000',
    ifscCode: 'BANK0000000',
    branch: 'Main Branch'
  },
  terms: [
    'Customer will be billed after indicating acceptance of this quote.',
    'Payment terms as mutually agreed.',
    'Transport and freight charges extra as applicable.',
    'The responsibility of all material will be as per manufacturer warranties.',
    'Subject to local jurisdiction.'
  ],
  media: {
    bannerUrl: 'assets/sample-banner.svg',
    headerLogoUrl: 'assets/header-roof-logo.svg',
    signatureImageUrl: 'assets/sample-signature.svg',
    signatureTitle: 'Authorized Signatory',
    showSignatureInPdf: true,
    showBannerInPdf: true,
    turnstileSiteKey: '1x00000000000000000000AA',
    galleryImages: [
      { id: 'img_1', title: 'Product Gallery & Partner Brands', url: 'assets/sample-banner.svg', active: true }
    ]
  },
  integration: {
    workerUrl: 'https://j-quotation-manager.pansuriyadhaval7.workers.dev',
    autoSync: true,
    lastSyncTime: null
  }
};

const DEFAULT_USERS = [
  {
    id: 'user_super_admin_primary',
    username: 'admin',
    passwordHash: 'a679cb086580f4949ad453e00bb982d1598f804791522f7c088ef577ef3724ff',
    fullName: 'System Administrator',
    role: 'Super Admin',
    isSuperAdmin: true,
    permissions: {
      canManageSettings: true,
      canDeleteQuotes: true,
      canManageUsers: true,
      canManageClients: true,
      canCreateQuotations: true,
      canEditQuotes: true,
      canManageItems: true,
      canBackupDatabase: true
    },
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

const DEFAULT_CLIENTS = [
  {
    id: 'cli_sample_01',
    name: 'Sample Client',
    companyName: 'Sample Enterprise Pvt Ltd',
    phone: '+91 98000 00000',
    email: 'client@example.com',
    address: 'Industrial Estate, Phase 2, City, State',
    gstNumber: '24AAAAA0000A1Z5',
    createdBy: 'System Administrator',
    createdAt: '2026-03-20T10:00:00.000Z'
  },
  {
    id: 'cli_sample_02',
    name: 'Valued Customer',
    companyName: 'Pre-Engineered Buildings & Infra',
    phone: '+91 99000 00000',
    email: 'contact@infra.example.com',
    address: 'Highway Road, Industrial Zone',
    gstNumber: '24AABBB0000B1Z6',
    createdBy: 'System Administrator',
    createdAt: '2026-02-10T10:30:00.000Z'
  }
];

// ITEM MASTER (PRE-DEFINED PRODUCTS CATALOG)
const DEFAULT_ITEMS = [
  {
    id: 'item_mast_01',
    name: 'PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
    description: '(ROOFING SHEET)',
    unit: 'kg(approx.)',
    rate: 82.00,
    defaultWidth: 3.50,
    imageUrl: 'assets/profile-indradhanus.svg',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_02',
    name: 'PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
    description: '(CRIMPING ROOFING SHEET)',
    unit: 'kg(approx.)',
    rate: 82.00,
    defaultWidth: 3.50,
    imageUrl: 'assets/profile-crimping.svg',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_03',
    name: 'CRIMPING SHEET LABOUR CHARGE PER PCS',
    description: '(REVARCE CRIMPING)',
    unit: 'PCS',
    rate: 150.00,
    defaultWidth: 3.50,
    imageUrl: 'assets/profile-crimping.svg',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_04',
    name: 'CRIMPING SHEET LABOUR CHARGE PER PCS',
    description: '(REGULAR)',
    unit: 'PCS',
    rate: 100.00,
    defaultWidth: 3.50,
    imageUrl: 'assets/profile-crimping.svg',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_05',
    name: 'POLY CARBONATE EMBOSSED CLEAR DOUBLE WALLY.',
    description: 'High Tensile Anti-UV Clear Profile',
    unit: 'SQ.FEET',
    rate: 75.00,
    defaultWidth: 3.50,
    imageUrl: 'assets/profile-polycarbonate.svg',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_06',
    name: 'INDRADHANUS WINDOW LUVERS GREY',
    description: '(44" X 1 MTR = 14 PCS)',
    unit: 'SQ.FEET',
    rate: 160.00,
    defaultWidth: 3.50,
    imageUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_07',
    name: 'HYBRIDE GUTTER 4 MTR LENTH',
    description: '(9 PCS)',
    unit: 'R.FEET',
    rate: 145.00,
    defaultWidth: 4.00,
    imageUrl: 'assets/profile-gutter.svg',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_08',
    name: 'PPGL INDRADHANUS 0.50MM GRAPHITE GREY ACCESSARIES',
    description: 'Standard 8 Feet Length Flashing & Ridges',
    unit: 'kg(approx.)',
    rate: 90.20,
    defaultWidth: 3.50,
    imageUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_09',
    name: 'ROOFTOP TURBO AIR VENTILATOR',
    description: 'Stainless Steel 21" Grade with Polycarbonate Base',
    unit: 'PCS',
    rate: 2250.00,
    defaultWidth: 3.50,
    imageUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'item_mast_10',
    name: 'SELF DRILLING HEX SCREWS WITH EPDM WASHER 12x25MM',
    description: 'Class 3 Corroshield Coated Fasteners',
    unit: 'PCS',
    rate: 2.20,
    defaultWidth: 3.50,
    imageUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
];

// Exact Sample Quotation Replicating Pages 1 to 7 of the Attached PDF
const DEFAULT_SAMPLE_QUOTATIONS = [
  {
    id: 'qt_pdf_sample_01',
    quoteNumber: 'QT-2025-26-373',
    date: '2026-03-20',
    validUntil: '2026-03-22',
    clientId: 'cli_rudra_cast',
    clientName: '',
    clientCompany: 'RUDRA CAST',
    clientPhone: '+91 98791 09091',
    clientEmail: 'rudracast@gmail.com',
    clientAddress: 'GIDC Industrial Estate, Metoda, Rajkot, Gujarat',
    clientGst: '24AAMCC0264B1Z6',
    
    // PART 1: Items Pricing Table (Page 1)
    items: [
      {
        id: 'item_1',
        description: 'PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
        subRemarks: '(ROOFING SHEET)',
        imageUrl: 'assets/profile-indradhanus.svg',
        quantity: 2618,
        unit: 'kg(approx.)',
        rate: 82.00,
        amount: 214676.00
      },
      {
        id: 'item_2',
        description: 'PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
        subRemarks: '(ROOFING SHEET)',
        imageUrl: 'assets/profile-indradhanus.svg',
        quantity: 12974,
        unit: 'kg(approx.)',
        rate: 82.00,
        amount: 1063868.00
      },
      {
        id: 'item_3',
        description: 'PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
        subRemarks: '(CRIMPING ROOFING SHEET)',
        imageUrl: 'assets/profile-crimping.svg',
        quantity: 3719,
        unit: 'kg(approx.)',
        rate: 82.00,
        amount: 304958.00
      },
      {
        id: 'item_4',
        description: 'CRIMPING SHEET LABOUR CHARGE PER PCS',
        subRemarks: '(REVARCE CRIMPING)',
        imageUrl: 'assets/profile-crimping.svg',
        quantity: 88,
        unit: 'PCS',
        rate: 150.00,
        amount: 13200.00
      },
      {
        id: 'item_5',
        description: 'CRIMPING SHEET LABOUR CHARGE PER PCS',
        subRemarks: '(REGULAR)',
        imageUrl: '',
        quantity: 85,
        unit: 'PCS',
        rate: 100.00,
        amount: 8500.00
      },
      {
        id: 'item_6',
        description: 'POLY CARBONATE EMBOSSED CLEAR DOUBLE WALLY.',
        subRemarks: '',
        imageUrl: 'assets/profile-polycarbonate.svg',
        quantity: 2126,
        unit: 'SQ.FEET',
        rate: 75.00,
        amount: 159450.00
      },
      {
        id: 'item_7',
        description: 'INDRADHANUS WINDOW LUVERS GREY',
        subRemarks: '(44" X 1 MTR = 14 PCS)',
        imageUrl: '',
        quantity: 168,
        unit: 'SQ.FEET',
        rate: 160.00,
        amount: 26880.00
      },
      {
        id: 'item_8',
        description: 'HYBRIDE GUTTER 4 MTR LENTH',
        subRemarks: '(9 PCS)',
        imageUrl: 'assets/profile-gutter.svg',
        quantity: 118,
        unit: 'R.FEET',
        rate: 145.00,
        amount: 17110.00
      },
      {
        id: 'item_9',
        description: 'PPGL INDRADHANUS 0.50MM GRAPHITE GREY ACCESSARIES',
        subRemarks: '',
        imageUrl: '',
        quantity: 387,
        unit: 'kg(approx.)',
        rate: 90.20,
        amount: 34907.40,
        subTable: [
          { desc: 'Standard Size', inchKg: '16"', nos: 7, weight: '25.200', remarks: 'LENTH 8 FEET' },
          { desc: 'Standard Size', inchKg: '24"', nos: 67, weight: '361.800', remarks: 'LENTH 8 FEET' }
        ]
      }
    ],

    materialTotal: 1843549.40,
    loadingCharges: 1969.82,
    additionalCharges: [],
    gstType: 'CGST_SGST', // SGST 9% + CGST 9%
    gstRate: 18,
    gstAmount: 331838.89,
    roundOff: -0.11,
    grandTotal: 2177358.00,
    grandTotalWords: 'Rupees Twenty-One Lakh Seventy-Seven Thousand Three Hundred Fifty-Eight Only',

    // PART 2: Dynamic Multi-Block Calculation Tables (Pages 2, 3, 4, 5)
    calculations: [
      {
        id: 'calc_block_1',
        title: 'Calculation Details for : PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
        sheetWidth: 3.50,
        rows: [
          { feet: 4.00, inch: 0.00, nos: 1 },
          { feet: 4.00, inch: 5.00, nos: 1 },
          { feet: 4.00, inch: 10.00, nos: 1 },
          { feet: 5.00, inch: 3.00, nos: 1 },
          { feet: 5.00, inch: 8.00, nos: 1 },
          { feet: 6.00, inch: 1.00, nos: 1 },
          { feet: 6.00, inch: 6.00, nos: 1 },
          { feet: 6.00, inch: 11.00, nos: 1 },
          { feet: 7.00, inch: 4.00, nos: 1 },
          { feet: 7.00, inch: 9.00, nos: 1 },
          { feet: 8.00, inch: 2.00, nos: 1 },
          { feet: 8.00, inch: 7.00, nos: 1 },
          { feet: 9.00, inch: 0.00, nos: 1 },
          { feet: 9.00, inch: 5.00, nos: 1 },
          { feet: 9.00, inch: 10.00, nos: 1 },
          { feet: 10.00, inch: 3.00, nos: 1 },
          { feet: 10.00, inch: 8.00, nos: 1 },
          { feet: 11.00, inch: 1.00, nos: 1 },
          { feet: 11.00, inch: 6.00, nos: 1 },
          { feet: 11.00, inch: 11.00, nos: 1 },
          { feet: 12.00, inch: 4.00, nos: 1 },
          { feet: 12.00, inch: 9.00, nos: 1 },
          { feet: 13.00, inch: 2.00, nos: 1 },
          { feet: 13.00, inch: 7.00, nos: 1 },
          { feet: 14.00, inch: 0.00, nos: 1 },
          { feet: 14.00, inch: 5.00, nos: 1 },
          { feet: 14.00, inch: 10.00, nos: 1 },
          { feet: 15.00, inch: 3.00, nos: 1 },
          { feet: 15.00, inch: 8.00, nos: 1 },
          { feet: 16.00, inch: 1.00, nos: 1 },
          { feet: 16.00, inch: 6.00, nos: 1 },
          { feet: 16.00, inch: 11.00, nos: 1 },
          { feet: 17.00, inch: 4.00, nos: 1 },
          { feet: 17.00, inch: 9.00, nos: 1 },
          { feet: 18.00, inch: 2.00, nos: 1 },
          { feet: 18.00, inch: 7.00, nos: 1 },
          { feet: 19.00, inch: 0.00, nos: 1 },
          { feet: 19.00, inch: 5.00, nos: 1 },
          { feet: 19.00, inch: 10.00, nos: 1 },
          { feet: 20.00, inch: 3.00, nos: 1 }
        ]
      },
      {
        id: 'calc_block_2',
        title: 'Calculation Details for : PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
        sheetWidth: 3.50,
        rows: [
          { feet: 25.00, inch: 6.00, nos: 168 },
          { feet: 13.00, inch: 0.00, nos: 9 },
          { feet: 21.00, inch: 4.00, nos: 15 },
          { feet: 29.00, inch: 8.00, nos: 28 },
          { feet: 24.00, inch: 2.00, nos: 7 },
          { feet: 22.00, inch: 3.00, nos: 100 },
          { feet: 20.00, inch: 7.00, nos: 26 },
          { feet: 22.00, inch: 0.00, nos: 26 },
          { feet: 19.00, inch: 11.00, nos: 2 },
          { feet: 20.00, inch: 2.00, nos: 2 },
          { feet: 20.00, inch: 5.00, nos: 2 },
          { feet: 20.00, inch: 8.00, nos: 2 },
          { feet: 20.00, inch: 11.00, nos: 2 },
          { feet: 21.00, inch: 2.00, nos: 2 },
          { feet: 21.00, inch: 5.00, nos: 2 },
          { feet: 21.00, inch: 8.00, nos: 2 },
          { feet: 21.00, inch: 11.00, nos: 2 },
          { feet: 22.00, inch: 2.00, nos: 2 },
          { feet: 22.00, inch: 5.00, nos: 2 },
          { feet: 22.00, inch: 8.00, nos: 2 },
          { feet: 23.00, inch: 1.00, nos: 2 }
        ]
      },
      {
        id: 'calc_block_3',
        title: 'Calculation Details for : PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
        sheetWidth: 3.50,
        rows: [
          { feet: 31.00, inch: 0.00, nos: 40 },
          { feet: 9.00, inch: 9.00, nos: 72 },
          { feet: 11.00, inch: 3.00, nos: 48 },
          { feet: 21.00, inch: 0.00, nos: 13 }
        ]
      },
      {
        id: 'calc_block_4',
        title: 'Calculation Details for : POLY CARBONATE EMBOSSED CLEAR DOUBLE WALLY.',
        sheetWidth: 3.50,
        rows: [
          { feet: 29.00, inch: 8.00, nos: 6 },
          { feet: 24.00, inch: 2.00, nos: 1 },
          { feet: 22.00, inch: 3.00, nos: 16 },
          { feet: 20.00, inch: 7.00, nos: 8 },
          { feet: 22.00, inch: 0.00, nos: 8 },
          { feet: 20.00, inch: 5.00, nos: 1 },
          { feet: 21.00, inch: 5.00, nos: 1 },
          { feet: 22.00, inch: 5.00, nos: 1 },
          { feet: 23.00, inch: 1.00, nos: 1 },
          { feet: 10.00, inch: 6.00, nos: 1 },
          { feet: 14.00, inch: 0.00, nos: 1 },
          { feet: 15.00, inch: 6.00, nos: 1 },
          { feet: 17.00, inch: 6.00, nos: 1 },
          { feet: 19.00, inch: 6.00, nos: 1 }
        ]
      }
    ],

    notes: 'Material cut to customer specifications. All profiles rolled in high tensile Indradhanus coated sheet.',
    status: 'Sent',
    createdBy: 'admin',
    createdAt: '2026-03-20T10:00:00.000Z',
    updatedAt: '2026-03-20T10:00:00.000Z'
  }
];

if (typeof window !== 'undefined') {
  window.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  window.DEFAULT_USERS = DEFAULT_USERS;
  window.DEFAULT_CLIENTS = DEFAULT_CLIENTS;
  window.DEFAULT_ITEMS = DEFAULT_ITEMS;
  window.DEFAULT_SAMPLE_QUOTATIONS = DEFAULT_SAMPLE_QUOTATIONS;
}
