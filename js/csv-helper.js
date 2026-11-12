/**
 * Jalaram Enterprise - CSV Import & Export Engine
 * Enterprise CSV parser and generator for Quotations, Clients, and Item Master.
 * Handles quoted cells, commas, carriage returns, and character encoding.
 */

const CsvHelper = {
  /**
   * Properly escapes a cell value for CSV output
   */
  escape(val) {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  },

  /**
   * Triggers client-side browser download of CSV string
   */
  download(filename, csvContent) {
    // Add UTF-8 BOM so Excel on Windows properly displays characters
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /**
   * Export Quotations List to CSV
   */
  exportQuotations(quotes) {
    const headers = [
      'Quote Number', 'Date', 'Valid Until', 'Client Company', 'Contact Person',
      'Phone', 'GSTIN', 'Address', 'Material Total (INR)', 'Loading Charges (INR)',
      'GST Type', 'GST Rate (%)', 'GST Amount (INR)', 'Grand Total (INR)', 'Status', 'Notes'
    ];

    const rows = (quotes || []).map(q => [
      this.escape(q.quoteNumber || ''),
      this.escape(q.date || ''),
      this.escape(q.validUntil || ''),
      this.escape(q.clientCompany || ''),
      this.escape(q.clientName || ''),
      this.escape(q.clientPhone || ''),
      this.escape(q.clientGst || ''),
      this.escape(q.clientAddress || ''),
      this.escape(parseFloat(q.materialTotal || 0).toFixed(2)),
      this.escape(parseFloat(q.loadingCharges || 0).toFixed(2)),
      this.escape(q.gstType || 'CGST_SGST'),
      this.escape(q.gstRate || 18),
      this.escape(parseFloat(q.gstAmount || 0).toFixed(2)),
      this.escape(parseFloat(q.grandTotal || 0).toFixed(2)),
      this.escape(q.status || 'Draft'),
      this.escape(q.notes || '')
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const dateStr = new Date().toISOString().slice(0, 10);
    this.download(`jalaram_quotations_${dateStr}.csv`, csv);
  },

  /**
   * Export Clients Directory to CSV
   */
  exportClients(clients) {
    const headers = ['Company Name', 'Contact Name', 'Phone Number', 'Email Address', 'GSTIN', 'Billing Address'];
    const rows = (clients || []).map(c => [
      this.escape(c.companyName || ''),
      this.escape(c.name || ''),
      this.escape(c.phone || ''),
      this.escape(c.email || ''),
      this.escape(c.gstNumber || ''),
      this.escape(c.address || '')
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const dateStr = new Date().toISOString().slice(0, 10);
    this.download(`jalaram_clients_${dateStr}.csv`, csv);
  },

  /**
   * Export Items Master to CSV
   */
  exportItems(items) {
    const headers = ['Item Name', 'Description', 'Default Unit', 'Default Price (INR)', 'Default Size Width (Ft)', 'Image URL'];
    const rows = (items || []).map(it => [
      this.escape(it.name || ''),
      this.escape(it.description || ''),
      this.escape(it.unit || 'PCS'),
      this.escape(parseFloat(it.rate || 0).toFixed(2)),
      this.escape((parseFloat(it.defaultWidth) || 3.50).toFixed(2)),
      this.escape(it.imageUrl || '')
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    const dateStr = new Date().toISOString().slice(0, 10);
    this.download(`jalaram_items_master_${dateStr}.csv`, csv);
  },

  /**
   * Download sample Client CSV template
   */
  downloadClientTemplate() {
    const headers = ['Company Name', 'Contact Name', 'Phone Number', 'Email Address', 'GSTIN', 'Billing Address'];
    const samples = [
      ['Rudra Cast Private Limited', 'Hareshbhai Patel', '+91 98250 12345', 'rudracast@gmail.com', '24AAACR1234M1Z2', 'Survey No 245, Shapar, Rajkot, Gujarat 360026'],
      ['Shree Krishna Agro Sheds', 'Rameshbhai', '+91 94280 54321', 'krishnaagro@yahoo.com', '24AABCS5678P1Z5', 'National Highway 8B, Gondal Road, Rajkot']
    ];
    const rows = samples.map(s => s.map(v => this.escape(v)).join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    this.download('client_import_template.csv', csv);
  },

  /**
   * Download sample Item CSV template
   */
  downloadItemTemplate() {
    const headers = ['Item Name', 'Description', 'Default Unit', 'Default Price (INR)', 'Default Size Width (Ft)', 'Image URL'];
    const samples = [
      ['INDRADHANUS PROFILE COLOR COATED SHEET', 'PPGI / Galvalume 0.50mm Roofing Sheet with Protective Film', 'SQ.FEET', '52.50', '3.50', 'assets/profile-indradhanus.svg'],
      ['CRIMPING CURVED SHEET 0.50MM', 'Curved eaves & ridge canopy sheet 28 Gauge', 'SQ.FEET', '58.00', '3.50', 'assets/profile-crimping.svg'],
      ['HEAVY DUTY RAIN WATER GUTTER', 'Color coated pre-painted galvanized iron gutter 2.0mm', 'R.FT', '320.00', '1.50', 'assets/profile-gutter.svg']
    ];
    const rows = samples.map(s => s.map(v => this.escape(v)).join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    this.download('item_import_template.csv', csv);
  },

  /**
   * Universal CSV text parser supporting quoted multi-line fields
   */
  parseCsv(text) {
    if (!text || typeof text !== 'string') return { headers: [], rows: [] };

    // Standard CSV line splitting regex accounting for quotes
    const lines = [];
    let curLine = [];
    let curVal = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const nextCh = text[i + 1];

      if (ch === '"') {
        if (inQuotes && nextCh === '"') {
          curVal += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        curLine.push(curVal.trim());
        curVal = '';
      } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
        if (ch === '\r' && nextCh === '\n') {
          i++; // Skip \n in CRLF
        }
        curLine.push(curVal.trim());
        if (curLine.some(c => c !== '')) {
          lines.push(curLine);
        }
        curLine = [];
        curVal = '';
      } else {
        curVal += ch;
      }
    }

    if (curVal.length > 0 || curLine.length > 0) {
      curLine.push(curVal.trim());
      if (curLine.some(c => c !== '')) {
        lines.push(curLine);
      }
    }

    if (lines.length === 0) return { headers: [], rows: [] };

    const rawHeaders = lines[0].map(h => h.replace(/^["']|["']$/g, '').trim());
    const dataRows = [];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      const obj = {};
      rawHeaders.forEach((h, hIdx) => {
        let val = row[hIdx] !== undefined ? row[hIdx] : '';
        val = val.replace(/^["']|["']$/g, '').trim();
        obj[h] = val;
      });
      dataRows.push(obj);
    }

    return { headers: rawHeaders, rows: dataRows };
  },

  /**
   * Normalizes parsed client rows into system client model
   */
  normalizeClients(parsedRows) {
    return parsedRows.map(r => {
      // Find matching keys case-insensitively
      const getVal = (...keys) => {
        for (const k of keys) {
          const matchedKey = Object.keys(r).find(x => x.toLowerCase().replace(/[^a-z0-9]/g, '') === k.toLowerCase().replace(/[^a-z0-9]/g, ''));
          if (matchedKey && r[matchedKey]) return r[matchedKey];
        }
        return '';
      };

      const company = getVal('companyname', 'company', 'business', 'clientcompany');
      const contact = getVal('contactname', 'name', 'clientname', 'person');
      const phone = getVal('phonenumber', 'phone', 'mobile', 'cell', 'contactno');
      const email = getVal('emailaddress', 'email', 'mail');
      const gstin = getVal('gstin', 'gstnumber', 'gst', 'taxid');
      const address = getVal('billingaddress', 'address', 'location', 'city');

      return {
        companyName: company || contact || 'Unnamed Company',
        name: contact || company || 'Client',
        phone: phone || '',
        email: email || '',
        gstNumber: gstin || '',
        address: address || ''
      };
    }).filter(c => c.companyName || c.name || c.phone);
  },

  /**
   * Normalizes parsed item rows into system item master model
   */
  normalizeItems(parsedRows) {
    return parsedRows.map(r => {
      const getVal = (...keys) => {
        for (const k of keys) {
          const matchedKey = Object.keys(r).find(x => x.toLowerCase().replace(/[^a-z0-9]/g, '') === k.toLowerCase().replace(/[^a-z0-9]/g, ''));
          if (matchedKey && r[matchedKey]) return r[matchedKey];
        }
        return '';
      };

      const name = getVal('itemname', 'name', 'productname', 'title');
      const desc = getVal('description', 'desc', 'details', 'specification');
      const unit = getVal('defaultunit', 'unit', 'uom') || 'PCS';
      const price = parseFloat(getVal('defaultprice', 'price', 'rate', 'cost')) || 0;
      const width = parseFloat(getVal('defaultwidth', 'width', 'size', 'sheetwidth')) || 3.50;
      const img = getVal('imageurl', 'image', 'photo', 'diagram');

      return {
        name: name || 'Unnamed Product',
        description: desc || '',
        unit: unit.toUpperCase(),
        rate: price,
        defaultWidth: width,
        imageUrl: img || ''
      };
    }).filter(it => it.name && it.name !== 'Unnamed Product');
  }
};

window.CsvHelper = CsvHelper;
