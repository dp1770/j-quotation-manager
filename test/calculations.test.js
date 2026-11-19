import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load js/calculations.js in a sandbox context
const calcCode = fs.readFileSync(path.join(__dirname, '../js/calculations.js'), 'utf8');
const context = { window: {}, globalThis: {} };
vm.createContext(context);
vm.runInContext(calcCode, context);
const CalculationsEngine = context.CalculationsEngine || context.window.CalculationsEngine;

test('calculateSheetRow: computes length, sqFeet, and sqMeters accurately', () => {
  // 10 feet 6 inches, 4 pieces, width 3.50 ft
  // Length in feet = 10 + 6/12 = 10.5 ft
  // SqFeet = 10.5 * 3.50 * 4 = 147 sq. ft
  // SqMeters = 147 / 10.76391042 = 13.6567 sq. m
  const res = CalculationsEngine.calculateSheetRow(10, 6, 4, 3.50);

  assert.equal(res.lengthInFeet, 10.5);
  assert.equal(res.sqFeet, 147);
  assert.equal(res.sqMeters, 13.6567);
  assert.equal(res.nos, 4);
});

test('calculateSheetRow: handles edge cases (zero values, missing width)', () => {
  const zeroRes = CalculationsEngine.calculateSheetRow(0, 0, 0);
  assert.equal(zeroRes.lengthInFeet, 0);
  assert.equal(zeroRes.sqFeet, 0);
  assert.equal(zeroRes.sqMeters, 0);

  // Missing width defaults to 3.50
  const defaultWidthRes = CalculationsEngine.calculateSheetRow(12, 0, 1);
  assert.equal(defaultWidthRes.sqFeet, 42); // 12 * 3.50 * 1 = 42
});

test('calculateSheetBlock: aggregates multi-row sheet blocks', () => {
  const block = {
    id: 'block_1',
    sheetWidth: 3.50,
    rows: [
      { feet: 10, inch: 0, nos: 2 }, // 10 * 3.50 * 2 = 70 sq. ft
      { feet: 8, inch: 6, nos: 4 }   // 8.5 * 3.50 * 4 = 119 sq. ft
    ]
  };

  const calculated = CalculationsEngine.calculateSheetBlock(block);
  assert.equal(calculated.totalNos, 6);
  assert.equal(calculated.totalSqFeet, 189); // 70 + 119
  assert.equal(calculated.rows.length, 2);
  assert.ok(calculated.totalSqMeters > 0);
});

test('calculateQuotationTotals: CGST + SGST tax split and loading charges', () => {
  const items = [
    { name: 'Color Coated Sheet', quantity: 100, rate: 50 }, // 5,000
    { name: 'Self Drilling Screws', quantity: 200, rate: 2.5 } // 500
  ];
  const loadingCharges = 300;
  const additionalCharges = [{ description: 'Transport', amount: 200 }];

  const totals = CalculationsEngine.calculateQuotationTotals(
    items,
    loadingCharges,
    additionalCharges,
    'CGST_SGST'
  );

  assert.equal(totals.materialTotal, 5500);
  assert.equal(totals.chargesTotal, 500); // 300 + 200
  assert.equal(totals.gstRate, 18);
  assert.equal(totals.cgstRate, 9);
  assert.equal(totals.sgstRate, 9);
  assert.equal(totals.gstAmount, 990); // 18% on 5500 = 990
  assert.equal(totals.cgstAmount, 495); // 9% on 5500 = 495
  assert.equal(totals.sgstAmount, 495);
  // Pre-round total = 5500 + 500 + 990 = 6990
  assert.equal(totals.grandTotal, 6990);
});

test('calculateQuotationTotals: IGST interstate tax calculation', () => {
  const items = [{ name: 'Industrial Coil', quantity: 10, rate: 1000 }];
  const totals = CalculationsEngine.calculateQuotationTotals(items, 0, [], 'IGST');

  assert.equal(totals.materialTotal, 10000);
  assert.equal(totals.igstRate, 18);
  assert.equal(totals.igstAmount, 1800);
  assert.equal(totals.cgstAmount, 0);
  assert.equal(totals.sgstAmount, 0);
  assert.equal(totals.grandTotal, 11800);
});

test('numberToIndianWords: converts amounts to Indian Rupee word format', () => {
  assert.equal(CalculationsEngine.numberToIndianWords(0), 'Rupees Zero Only');
  assert.equal(CalculationsEngine.numberToIndianWords(5500), 'Rupees Five Thousand Five Hundred Only');
  assert.equal(CalculationsEngine.numberToIndianWords(100500), 'Rupees One Lakh Five Hundred Only');
});

test('PdfGenerator.generateQuotationHtml: Dynamic company logo rendering in header', () => {
  const pdfGenCode = fs.readFileSync(path.join(__dirname, '../js/pdf-generator.js'), 'utf8');
  const defaultDataCode = fs.readFileSync(path.join(__dirname, '../js/default-data.js'), 'utf8');

  const pdfContext = {
    window: { CalculationsEngine },
    globalThis: { CalculationsEngine },
    CalculationsEngine
  };
  vm.createContext(pdfContext);
  vm.runInContext(defaultDataCode, pdfContext);
  vm.runInContext(pdfGenCode, pdfContext);
  const PdfGenerator = pdfContext.PdfGenerator || pdfContext.window.PdfGenerator;

  const quote = {
    quoteNumber: 'QT-2026-0001',
    companyId: 'comp_balaji',
    items: [{ name: 'PPGL Sheet', quantity: 2, rate: 500 }]
  };

  // Case 1: Company HAS a company logo uploaded
  const settingsWithLogo = {
    company: {
      name: 'Balaji Industries',
      address: 'Industrial Area',
      email: 'balaji@example.com',
      phone: '9876543210',
      gstin: '24ABCDE1234F1Z5',
      companyLogo: 'https://cdn.example.com/balaji-logo.png'
    },
    bank: {},
    terms: [],
    media: {
      companyLogo: 'https://cdn.example.com/balaji-logo.png',
      showSignatureInPdf: false,
      showBannerInPdf: false
    }
  };

  const htmlWithLogo = PdfGenerator.generateQuotationHtml(quote, settingsWithLogo);
  assert.match(htmlWithLogo, /https:\/\/cdn\.example\.com\/balaji-logo\.png/);
  assert.match(htmlWithLogo, /Balaji Industries Logo/);
  assert.doesNotMatch(htmlWithLogo, /header-roof-logo\.svg/);

  // Case 2: Company has NO logo uploaded (must remain completely clean, no placeholder)
  const settingsWithoutLogo = {
    company: {
      name: 'Balaji Industries',
      address: 'Industrial Area',
      email: 'balaji@example.com',
      phone: '9876543210',
      gstin: '24ABCDE1234F1Z5',
      companyLogo: ''
    },
    bank: {},
    terms: [],
    media: {
      companyLogo: '',
      headerLogoUrl: '',
      showSignatureInPdf: false,
      showBannerInPdf: false
    }
  };

  const htmlWithoutLogo = PdfGenerator.generateQuotationHtml(quote, settingsWithoutLogo);
  assert.doesNotMatch(htmlWithoutLogo, /header-roof-logo\.svg/);
  assert.doesNotMatch(htmlWithoutLogo, /Balaji Industries Logo/);
});
