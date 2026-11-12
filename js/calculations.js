/**
 * Jalaram Enterprise - Calculations Engine
 * Core mathematical functions for Roofing Sheet measurements and Quotation financials.
 */

const CalculationsEngine = {
  /**
   * Calculates a single sheet measurement row:
   * Total Length in Feet = Feet + (Inch / 12)
   * Total Sq. Feet = Total Length in Feet * Width * Nos
   * Total Sq. Meter = Total Sq. Feet / 10.76391042
   */
  calculateSheetRow(feet, inch, nos, width = 3.50) {
    const f = parseFloat(feet) || 0;
    const i = parseFloat(inch) || 0;
    const n = parseFloat(nos) || 0;
    const w = parseFloat(width) || 3.50;

    const lengthInFeet = f + (i / 12);
    const rawSqFeet = lengthInFeet * w * n;
    
    // In roofing trade practice (as seen in sample PDF), Sq. Feet is rounded to 2 decimals,
    // and Sq. Meter is derived as Sq.Feet / 10.76391042 rounded to 4 decimals.
    const sqFeet = parseFloat(rawSqFeet.toFixed(2));
    const sqMeters = parseFloat((sqFeet / 10.76391042).toFixed(4));

    return {
      feet: f,
      inch: i,
      nos: n,
      width: w,
      lengthInFeet: parseFloat(lengthInFeet.toFixed(4)),
      sqFeet: sqFeet,
      sqMeters: sqMeters,
      sqFeetDisplay: sqFeet.toFixed(4),
      sqMetersDisplay: sqMeters.toFixed(4)
    };
  },

  /**
   * Aggregates an entire sheet calculation block:
   * sums total pieces (Nos), total square feet, total square meters.
   */
  calculateSheetBlock(block) {
    if (!block || !Array.isArray(block.rows)) {
      return { totalNos: 0, totalSqFeet: 0, totalSqMeters: 0, rows: [] };
    }

    const width = parseFloat(block.sheetWidth) || 3.50;
    let totalNos = 0;
    let totalSqFeet = 0;
    let totalSqMeters = 0;

    const computedRows = block.rows.map((row) => {
      const res = this.calculateSheetRow(row.feet, row.inch, row.nos, width);
      totalNos += res.nos;
      totalSqFeet += res.sqFeet;
      totalSqMeters += res.sqMeters;
      return {
        ...row,
        lengthInFeet: res.lengthInFeet,
        sqFeet: res.sqFeet,
        sqMeters: res.sqMeters,
        sqFeetDisplay: res.sqFeetDisplay,
        sqMetersDisplay: res.sqMetersDisplay
      };
    });

    return {
      id: block.id,
      title: block.title || 'Calculation Details for : PPGL INDRADHANUS 0.50MM 70 GSM WHITE WIDTH 3.50 FEET',
      sheetWidth: width,
      linkedItemId: block.linkedItemId || null,
      rows: computedRows,
      totalNos: Math.round(totalNos),
      totalSqFeet: parseFloat(totalSqFeet.toFixed(2)),
      totalSqMeters: parseFloat(totalSqMeters.toFixed(4)),
      totalSqFeetDisplay: parseFloat(totalSqFeet.toFixed(2)).toFixed(4),
      totalSqMetersDisplay: parseFloat(totalSqMeters.toFixed(4)).toFixed(4)
    };
  },

  /**
   * Calculates overall Quotation totals matching the PDF layout:
   * - Material Subtotal (sum of item totals)
   * - Loading Charges
   * - GST (SGST 9% + CGST 9% or IGST 18%)
   * - Grand Total (Rounded off)
   */
  calculateQuotationTotals(items = [], loadingCharges = 0, additionalCharges = [], gstType = 'CGST_SGST', customGstRate = null, manualRoundOff = null) {
    // 1. Material subtotal
    let materialTotal = 0;
    const processedItems = items.map(item => {
      const qty = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.rate) || 0;
      const amount = parseFloat((qty * rate).toFixed(2));
      materialTotal += amount;
      return { ...item, quantity: qty, rate: rate, amount: amount };
    });
    materialTotal = parseFloat(materialTotal.toFixed(2));

    // 2. Loading Charges & Additional charges
    const loadCharge = parseFloat(loadingCharges) || 0;
    let otherChargesTotal = 0;
    const processedCharges = additionalCharges.map(chg => {
      const amt = parseFloat(chg.amount) || 0;
      otherChargesTotal += amt;
      return { ...chg, amount: amt };
    });
    const chargesTotal = parseFloat((loadCharge + otherChargesTotal).toFixed(2));

    // 3. Taxable Amount (Material total as in sample PDF)
    const taxableAmount = materialTotal;

    // 4. GST calculation (18% on Material Subtotal)
    let gstRate = 0;
    let cgstRate = 0;
    let sgstRate = 0;
    let igstRate = 0;
    let gstAmount = 0;

    if (gstType === 'CGST_SGST') {
      gstRate = 18;
      cgstRate = 9;
      sgstRate = 9;
      gstAmount = parseFloat((taxableAmount * 0.18).toFixed(2));
    } else if (gstType === 'IGST') {
      gstRate = 18;
      igstRate = 18;
      gstAmount = parseFloat((taxableAmount * 0.18).toFixed(2));
    } else if (gstType === 'CUSTOM') {
      gstRate = parseFloat(customGstRate) || 0;
      gstAmount = parseFloat((taxableAmount * (gstRate / 100)).toFixed(2));
    } else {
      gstRate = 0;
      gstAmount = 0;
    }

    // Grand Total before round off = Material + Loading/Charges + GST
    const preRoundTotal = materialTotal + chargesTotal + gstAmount;

    // 5. Round off calculation
    let roundOff = 0;
    let grandTotal = 0;

    if (manualRoundOff !== null && manualRoundOff !== undefined && manualRoundOff !== '') {
      roundOff = parseFloat(manualRoundOff) || 0;
      grandTotal = Math.round(preRoundTotal + roundOff);
    } else {
      const rounded = Math.round(preRoundTotal);
      roundOff = parseFloat((rounded - preRoundTotal).toFixed(2));
      grandTotal = rounded;
    }

    const cgstAmount = cgstRate > 0 ? parseFloat((taxableAmount * 0.09).toFixed(2)) : 0;
    const sgstAmount = sgstRate > 0 ? parseFloat((taxableAmount * 0.09).toFixed(2)) : 0;
    const igstAmount = igstRate > 0 ? gstAmount : 0;

    return {
      items: processedItems,
      loadingCharges: loadCharge,
      additionalCharges: processedCharges,
      materialTotal,
      chargesTotal,
      taxableAmount,
      gstType,
      gstRate,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      gstAmount,
      roundOff,
      grandTotal,
      grandTotalWords: this.numberToIndianWords(grandTotal)
    };
  },

  /**
   * Converts a numeric currency amount into formal Indian English words.
   * e.g., 2177358 => "Rupees Twenty-One Lakh Seventy-Seven Thousand Three Hundred Fifty-Eight Only"
   */
  numberToIndianWords(num) {
    if (isNaN(num) || num === null || num === undefined) return '';
    num = Math.round(Math.abs(num));
    if (num === 0) return 'Rupees Zero Only';

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
      'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function convertTwoDigits(n) {
      if (n === 0) return '';
      if (n < 20) return ones[n];
      const t = tens[Math.floor(n / 10)];
      const o = ones[n % 10];
      return (t + (o ? '-' + o : '')).trim();
    }

    function convertThreeDigits(n) {
      const h = Math.floor(n / 100);
      const rest = n % 100;
      let res = '';
      if (h > 0) {
        res += ones[h] + ' Hundred';
        if (rest > 0) res += ' ';
      }
      if (rest > 0) {
        res += convertTwoDigits(rest);
      }
      return res;
    }

    let words = '';
    const crore = Math.floor(num / 10000000);
    let remainder = num % 10000000;

    const lakh = Math.floor(remainder / 100000);
    remainder = remainder % 100000;

    const thousand = Math.floor(remainder / 1000);
    remainder = remainder % 1000;

    if (crore > 0) {
      words += convertThreeDigits(crore) + ' Crore ';
    }
    if (lakh > 0) {
      words += convertTwoDigits(lakh) + ' Lakh ';
    }
    if (thousand > 0) {
      words += convertTwoDigits(thousand) + ' Thousand ';
    }
    if (remainder > 0) {
      words += convertThreeDigits(remainder) + ' ';
    }

    return ('Rupees ' + words.trim() + ' Only').replace(/\s+/g, ' ');
  },

  formatCurrency(amount) {
    const val = parseFloat(amount) || 0;
    return '₹ ' + val.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
};

window.CalculationsEngine = CalculationsEngine;
