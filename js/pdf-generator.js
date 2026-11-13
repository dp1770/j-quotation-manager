/**
 * Quotation Manager - PDF Generation & Print Layout Engine
 * Optimized for whitespace management, docking totals directly beneath tables,
 * rendering item master product profile images, uploaded signatures, and system-generated footers.
 */

const PdfGenerator = {
  /**
   * Builds the complete HTML string for the printable quotation
   */
  generateQuotationHtml(quote, settings) {
    const comp = settings?.company || DEFAULT_SETTINGS.company;
    const bank = settings?.bank || DEFAULT_SETTINGS.bank;
    const terms = settings?.terms || DEFAULT_SETTINGS.terms;
    const media = settings?.media || DEFAULT_SETTINGS.media;

    // Recalculate totals for precision
    const totals = CalculationsEngine.calculateQuotationTotals(
      quote.items || [],
      quote.loadingCharges || 0,
      quote.additionalCharges || [],
      quote.gstType || 'CGST_SGST',
      quote.gstRate,
      quote.roundOff
    );

    const bannerImg = media.bannerUrl || 'assets/product-gallery-page7.svg';
    const headerLogo = media.headerLogoUrl || 'assets/header-roof-logo.svg';
    const signatureImg = media.signatureImageUrl || 'assets/sample-signature.svg';
    const showSignature = media.showSignatureInPdf !== false;

    // -------------------------------------------------------------
    // PART 1: MAIN ITEMS PRICING TABLE (PAGE 1)
    // -------------------------------------------------------------
    const itemRows = (quote.items || []).map((it, idx) => {
      const qNum = (parseFloat(it.quantity) || 0).toLocaleString('en-IN');
      const unitStr = it.unit || 'PCS';
      const rateStr = (parseFloat(it.rate) || 0).toFixed(2);
      const amtStr = ((parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0)).toFixed(2);

      // Check if item has product image / profile diagram (from Item Master or custom upload)
      let productImgHtml = '';
      if (it.imageUrl) {
        productImgHtml = `
          <div class="my-1.5 flex items-center gap-2">
            <img src="${it.imageUrl}" alt="Product Profile" class="max-h-8 max-w-xs object-contain border border-slate-200 rounded px-1 bg-white shadow-xs" />
          </div>
        `;
      } else if (it.description && it.description.toUpperCase().includes('POLY CARBONATE EMBOSSED CLEAR DOUBLE WALLY')) {
        productImgHtml = `
          <div class="my-1.5">
            <img src="assets/profile-polycarbonate.svg" alt="Profile Diagram" class="max-h-6 max-w-xs object-contain" />
          </div>
        `;
      }

      // Check if item has sub-table breakdown (e.g. accessories Item 9 in PDF)
      let subTableHtml = '';
      if (it.subTable && Array.isArray(it.subTable) && it.subTable.length > 0) {
        const subRows = it.subTable.map(s => `
          <tr class="border-b border-slate-300 text-[10px]">
            <td class="py-1 px-1.5 font-medium">${this.escapeHtml(s.desc)}</td>
            <td class="py-1 px-1.5 text-center font-bold">${this.escapeHtml(s.inchKg)}</td>
            <td class="py-1 px-1.5 text-center font-bold">${s.nos}</td>
            <td class="py-1 px-1.5 text-right font-medium">${s.weight}</td>
            <td class="py-1 px-1.5 text-center text-slate-700">${this.escapeHtml(s.remarks)}</td>
          </tr>
        `).join('');

        subTableHtml = `
          <div class="mt-2 border border-slate-400 rounded overflow-hidden max-w-sm">
            <table class="w-full text-left border-collapse text-[10px]">
              <thead>
                <tr class="bg-slate-200 font-bold text-slate-800 border-b border-slate-400">
                  <th class="py-1 px-1.5">Description</th>
                  <th class="py-1 px-1.5 text-center">Inch/Kg</th>
                  <th class="py-1 px-1.5 text-center">NOS</th>
                  <th class="py-1 px-1.5 text-right">Weight</th>
                  <th class="py-1 px-1.5 text-center">Remarks</th>
                </tr>
              </thead>
              <tbody>
                ${subRows}
              </tbody>
            </table>
          </div>
        `;
      }

      return `
        <tr class="border-b border-slate-300 text-xs">
          <td class="py-2.5 px-2 text-center text-slate-700 font-bold align-top">${idx + 1}</td>
          <td class="py-2.5 px-3 text-slate-900 font-bold align-top">
            <div class="text-[12px] leading-snug">${this.escapeHtml(it.description)}</div>
            ${it.subRemarks ? `<div class="text-[11px] text-slate-600 font-semibold italic mt-0.5">${this.escapeHtml(it.subRemarks)}</div>` : ''}
            ${productImgHtml}
            ${subTableHtml}
          </td>
          <td class="py-2.5 px-2 text-center align-top">
            <div class="font-bold text-slate-900 text-[12px]">${qNum}</div>
            <div class="text-[10px] text-slate-600 font-semibold lowercase">${this.escapeHtml(unitStr)}</div>
          </td>
          <td class="py-2.5 px-2 text-center font-bold text-slate-900 align-top text-[12px]">
            ${rateStr}
          </td>
          <td class="py-2.5 px-3 text-right font-bold text-slate-900 align-top text-[12px]">
            ${amtStr}
          </td>
        </tr>
      `;
    }).join('');

    let taxLabel = 'GST 18% (SGST 9% CGST 9%)';
    if (totals.gstType === 'IGST') {
      taxLabel = 'IGST 18%';
    } else if (totals.gstType === 'CUSTOM') {
      taxLabel = `GST ${totals.gstRate}%`;
    }

    // -------------------------------------------------------------
    // PART 2: DYNAMIC MULTI-BLOCK SHEET CALCULATION TABLES
    // -------------------------------------------------------------
    let calculationsHtml = '';
    if (quote.calculations && quote.calculations.length > 0) {
      calculationsHtml = quote.calculations.map((calcBlock, bIdx) => {
        const computed = CalculationsEngine.calculateSheetBlock(calcBlock);
        if (computed.rows.length === 0) return '';

        const calcRows = computed.rows.map((r) => `
          <tr class="border-b border-slate-300 text-[11px] font-medium leading-tight">
            <!-- 1. Feet Column (Pastel Soft Pink Tint) -->
            <td class="py-1 px-2 text-center font-semibold text-slate-900" style="background-color: #fce4ec;">
              ${r.feet.toFixed(2)}
            </td>
            <!-- 2. Inch Column (Pastel Soft Light Blue Tint) -->
            <td class="py-1 px-2 text-center font-semibold text-slate-900" style="background-color: #e1f5fe;">
              ${r.inch.toFixed(2)}
            </td>
            <!-- 3. Nos Column (Pastel Soft Cream/Yellow Tint) -->
            <td class="py-1 px-2 text-center font-black text-slate-900" style="background-color: #fff9c4;">
              ${r.nos}
            </td>
            <!-- 4. Sq. Meter Column (Pastel Soft Mint Green Tint) -->
            <td class="py-1 px-2 text-center font-semibold text-slate-900" style="background-color: #c8e6c9;">
              ${r.sqMetersDisplay}
            </td>
            <!-- 5. Sq. Feet Column (Pastel Soft Lilac/Purple Tint) -->
            <td class="py-1 px-2 text-center font-bold text-slate-900" style="background-color: #e1bee7;">
              ${r.sqFeetDisplay}
            </td>
          </tr>
        `).join('');

        return `
          <div class="mt-4 mb-4 avoid-break calc-block">
            <div class="text-[12px] font-bold text-slate-900 mb-1.5 flex justify-between items-center">
              <span>${this.escapeHtml(computed.title)}</span>
              <span class="text-[11px] text-slate-500 font-semibold">Width: ${computed.sheetWidth.toFixed(2)} Ft</span>
            </div>

            <table class="w-full text-left border-collapse" style="border: 1px solid #000000; border-collapse: collapse;">
              <thead>
                <tr class="text-white text-[12px] font-bold" style="background-color: #00a2e8;">
                  <th class="py-2 px-2 text-center w-1/5" style="border: 1px solid #000000;">Feet</th>
                  <th class="py-2 px-2 text-center w-1/5" style="border: 1px solid #000000;">Inch</th>
                  <th class="py-2 px-2 text-center w-1/5" style="border: 1px solid #000000;">Nos</th>
                  <th class="py-2 px-2 text-center w-1/5" style="border: 1px solid #000000;">Sq. Meter</th>
                  <th class="py-2 px-2 text-center w-1/5" style="border: 1px solid #000000;">Sq.Feet</th>
                </tr>
              </thead>
              <tbody>
                ${calcRows}
              </tbody>
              <tfoot>
                <tr class="bg-slate-100 font-black text-[11px] text-slate-900" style="border-top: 2px solid #000000;">
                  <td colspan="2" class="py-1.5 px-3 text-right" style="border: 1px solid #000000;">TOTAL:</td>
                  <td class="py-1.5 px-2 text-center font-black" style="border: 1px solid #000000; background-color: #fff59d;">${computed.totalNos}</td>
                  <td class="py-1.5 px-2 text-center font-black" style="border: 1px solid #000000; background-color: #a5d6a7;">${computed.totalSqMetersDisplay}</td>
                  <td class="py-1.5 px-2 text-center font-black" style="border: 1px solid #000000; background-color: #ce93d8;">${computed.totalSqFeetDisplay}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
      }).join('');
    }

    // -------------------------------------------------------------
    // PART 3: TERMS AND CONDITIONS
    // -------------------------------------------------------------
    const termsHtml = terms.map((t, idx) => `
      <p class="mb-1 text-slate-900 text-[11px] font-semibold leading-relaxed">
        ${idx + 1}. ${this.escapeHtml(t)}
      </p>
    `).join('');

    // Running Footer line matching PDF
    const footerLine = `
      <div class="mt-6 pt-2 border-t-2 border-slate-900 text-center text-[10px] sm:text-[11px] font-bold tracking-wider text-slate-800 uppercase avoid-break">
        ${this.escapeHtml(comp.name)} [ CONTACT NO. ${this.escapeHtml(comp.phone)} ${comp.phoneSecondary ? '/ ' + this.escapeHtml(comp.phoneSecondary) : ''} ]
      </div>
    `;

    return `
      <div id="print-quotation-root" class="bg-white text-slate-900 font-sans max-w-4xl mx-auto p-4 sm:p-8 print:p-0 print:max-w-none text-xs">
        <style>
          #print-quotation-root {
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
            color: #0f172a !important;
            background-color: #ffffff !important;
          }
          #print-quotation-root table {
            border-collapse: collapse !important;
            width: 100% !important;
          }
          #print-quotation-root table,
          #print-quotation-root th,
          #print-quotation-root td {
            border: 1px solid #000000 !important;
          }
          #print-quotation-root tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          #print-quotation-root .avoid-break,
          #print-quotation-root .calc-block,
          #print-quotation-root .pdf-section,
          #print-quotation-root .keep-together {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        </style>

        <!-- ======================================================= -->
        <!-- PART 1: HEADER & MAIN ITEMS PRICING TABLE               -->
        <!-- ======================================================= -->
        <div class="pdf-section keep-together">
          <!-- Top Header (Company Left, 3D Roofing Sheets Right) -->
          <div class="flex justify-between items-start gap-4 pb-2">
            <div class="flex-1">
              <h1 class="text-2xl font-black tracking-tight text-slate-950 uppercase">${this.escapeHtml(comp.name)}</h1>
              <div class="mt-1 text-xs text-slate-800 space-y-0.5 font-medium leading-snug">
                <p><strong>Address :-</strong> ${this.escapeHtml(comp.address)}</p>
                <p><strong>E-mail:</strong> <span class="text-blue-900 font-semibold">${this.escapeHtml(comp.email)}</span></p>
                <p><strong>Mo.No.</strong> ${this.escapeHtml(comp.phone)} ${comp.phoneSecondary ? '/ ' + this.escapeHtml(comp.phoneSecondary) : ''}</p>
                <p class="text-sky-600 font-bold text-sm tracking-wide">GST NO. ${this.escapeHtml(comp.gstin)}</p>
              </div>
            </div>

            <!-- Top Right 3D Roofing Sheets Illustration -->
            <div class="w-48 sm:w-56 flex-shrink-0 text-right">
              <img src="${headerLogo}" alt="${this.escapeHtml(comp.name)} Logo" class="w-full max-h-24 object-contain ml-auto" />
            </div>
          </div>

          <!-- Divider Line -->
          <div class="w-full h-1 bg-gradient-to-r from-sky-400 via-blue-600 to-sky-400 my-2"></div>

          <!-- Title: Quotation (Centered Cyan) -->
          <div class="text-center my-2.5">
            <h2 class="text-2xl font-bold tracking-wide" style="color: #00a2e8;">Quotation</h2>
          </div>

          <!-- Client & Quote Meta Details -->
          <div class="mb-3.5 text-xs font-semibold leading-relaxed grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50/70 p-2.5 rounded border border-slate-200">
            <div>
              <div class="text-slate-500 uppercase text-[10px] font-bold">Quotation To:</div>
              <div class="text-sm font-black text-slate-950 tracking-wide">${this.escapeHtml(quote.clientCompany || quote.clientName || 'Valued Customer')}</div>
              ${quote.clientCompany && quote.clientName ? `<div class="font-bold text-slate-800">Attn: ${this.escapeHtml(quote.clientName)}</div>` : ''}
              <div class="text-slate-600 mt-0.5">${this.escapeHtml(quote.clientAddress || '')}</div>
            </div>
            <div class="sm:text-right space-y-0.5">
              <div class="text-slate-700">Quote Number: <span class="font-bold text-slate-950 font-mono">${this.escapeHtml(quote.quoteNumber)}</span></div>
              <div class="text-slate-700">Quote Date: <span class="font-bold text-slate-950">${quote.date}</span></div>
              <div class="text-slate-700">Valid Until: <span class="font-bold text-slate-950">${quote.validUntil}</span></div>
              <div class="text-slate-700">Mobile No. : <span class="font-bold text-slate-950">${this.escapeHtml(quote.clientPhone || 'N/A')}</span></div>
              ${quote.clientGst ? `<div class="text-slate-700">Client GSTIN: <span class="font-bold font-mono text-slate-950">${this.escapeHtml(quote.clientGst)}</span></div>` : ''}
            </div>
          </div>

          <!-- Main Items Pricing Table (Cyan Header #00a2e8) -->
          <div class="overflow-x-auto mb-3" style="border: 1px solid #000000; border-collapse: collapse;">
            <table class="w-full text-left" style="border-collapse: collapse; border: 1px solid #000000;">
              <thead>
                <tr class="text-white text-xs font-bold" style="background-color: #00a2e8;">
                  <th class="py-2 px-2 text-center w-12" style="border: 1px solid #000000;">No.</th>
                  <th class="py-2 px-3" style="border: 1px solid #000000;">ITEM NAME</th>
                  <th class="py-2 px-2 text-center w-28" style="border: 1px solid #000000;">QUANTITY</th>
                  <th class="py-2 px-2 text-center w-24" style="border: 1px solid #000000;">PRICE</th>
                  <th class="py-2 px-3 text-right w-36" style="border: 1px solid #000000;">TOTAL AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows}
              </tbody>
            </table>
          </div>

          <!-- Summary Breakdown Docked Directly Below Main Pricing Table -->
          <!-- Sequence strictly: 1. Subtotal -> 2. Loading Charge -> 3. GST -> 4. GRAND TOTAL -->
          <div class="w-full max-w-sm ml-auto space-y-1.5 text-xs text-right font-bold text-slate-900 pt-2 mb-4 avoid-break border border-slate-300 rounded-lg p-3 bg-slate-50/80 shadow-2xs">
            <div class="flex justify-between items-center py-1 border-b border-slate-300 text-slate-700">
              <span class="uppercase tracking-wider font-bold">Quotation Subtotal (TOTAL):</span>
              <span class="font-mono text-sm text-slate-950 font-black">${totals.materialTotal.toFixed(2)}/-</span>
            </div>
            <div class="flex justify-between items-center py-1 border-b border-slate-300 text-slate-700">
              <span class="font-bold">Loading Charge:</span>
              <span class="font-mono text-slate-950 font-black">${totals.loadingCharges.toFixed(2)}/-</span>
            </div>
            <div class="flex justify-between items-center py-1 border-b-2 border-slate-400 text-slate-700">
              <span class="font-bold">${taxLabel}:</span>
              <span class="font-mono text-slate-950 font-black">${totals.gstAmount.toFixed(2)}/-</span>
            </div>
            <!-- FINAL CALCULATION ROW: GRAND TOTAL (Directly below GST row) -->
            <div class="flex justify-between items-center py-2 bg-blue-50/90 border border-blue-200 px-2.5 rounded mt-1 text-blue-950">
              <span class="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950">GRAND TOTAL:</span>
              <span class="text-base sm:text-lg font-black text-blue-950 font-mono">₹ ${Math.round(totals.grandTotal).toLocaleString('en-IN')}/-</span>
            </div>
            <div class="pt-1.5 text-[10px] text-slate-600 italic text-left border-t border-slate-200 mt-1">
              <span class="font-bold not-italic text-slate-800">Words:</span> ${totals.grandTotalWords}
            </div>
          </div>
        </div>

        <!-- ======================================================= -->
        <!-- PART 2: DYNAMIC MULTI-BLOCK SHEET CALCULATION TABLES   -->
        <!-- ======================================================= -->
        ${quote.calculations && quote.calculations.length > 0 ? `
          <div class="pdf-section pt-2">
            ${calculationsHtml}
          </div>
        ` : ''}

        <!-- ======================================================= -->
        <!-- PART 3: BANK DETAILS, TERMS & AUTHORIZED SIGNATURE      -->
        <!-- ======================================================= -->
        <div class="pdf-section avoid-break mt-4 border border-slate-300 rounded-lg p-4 bg-white">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            
            <!-- Left Column: Bank Details & Terms -->
            <div class="space-y-4">
              <!-- Bank Details -->
              <div>
                <h3 class="text-xs font-black text-sky-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <i class="fa-solid fa-building-columns"></i> BANK DETAILS:
                </h3>
                <div class="text-xs font-black text-amber-700 uppercase">${this.escapeHtml(bank.bankName)}</div>
                <div class="text-[11px] font-bold text-slate-800">A/C NO: <span class="font-mono text-slate-950">${this.escapeHtml(bank.accountNumber)}</span></div>
                <div class="text-[11px] font-bold text-slate-800">IFSC CODE: <span class="font-mono text-blue-900 font-bold">${this.escapeHtml(bank.ifscCode)}</span></div>
                <div class="text-[11px] font-bold text-slate-800">BRANCH: <span class="uppercase">${this.escapeHtml(bank.branch)}</span></div>
              </div>

              <!-- Terms and Conditions -->
              <div>
                <h3 class="text-xs font-black text-rose-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <i class="fa-solid fa-list-check"></i> TERMS AND CONDITIONS:
                </h3>
                <div class="space-y-0.5 text-slate-800">
                  ${termsHtml}
                </div>
              </div>
            </div>

            <!-- Right Column: Remarks & Signature -->
            <div class="flex flex-col justify-between h-full space-y-4 md:text-right">
              ${quote.notes ? `
                <div class="text-left bg-slate-50 p-2.5 rounded border border-slate-200">
                  <strong class="text-[11px] font-bold text-blue-950 block mb-0.5">Quotation Notes / Remarks:</strong>
                  <p class="text-[11px] text-slate-700 whitespace-pre-line leading-relaxed">${this.escapeHtml(quote.notes)}</p>
                </div>
              ` : '<div></div>'}

              <!-- Uploaded Signature Placement -->
              <div class="pt-4 self-end text-center min-w-[210px]">
                ${showSignature && signatureImg ? `
                  <div class="mb-1 flex justify-center">
                    <img src="${signatureImg}" alt="Authorized Signature" class="max-h-16 max-w-[180px] object-contain" />
                  </div>
                ` : `
                  <div class="h-16"></div>
                `}
                <div class="border-t border-slate-400 pt-1">
                  <div class="text-xs font-black text-slate-950 uppercase">For, ${this.escapeHtml(comp.name)}</div>
                  <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${this.escapeHtml(media.signatureTitle || 'Authorized Signatory')}</div>
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- Centered System Note (Prompt Requirement) -->
        <div class="text-center text-[10px] text-slate-400 italic mt-3 mb-2 avoid-break">
          This is a system-generated quotation.
        </div>

        <!-- Page Running Footer -->
        ${footerLine}

        <!-- ======================================================= -->
        <!-- PART 4: PROMOTIONAL & PRODUCT BANNER GALLERY           -->
        <!-- ======================================================= -->
        ${media.showBannerInPdf && bannerImg ? `
          <div class="mt-8 pt-4 avoid-break" style="page-break-before: always;">
            <div class="text-center">
              <img src="${bannerImg}" alt="${this.escapeHtml(comp.name)} Promotional Banner" class="w-full max-h-[960px] object-contain mx-auto rounded shadow-sm border border-slate-200" />
            </div>
            ${footerLine}
          </div>
        ` : ''}

      </div>
    `;
  },

  /**
   * Generates Base64 PDF data string for email attachment
   */
  async generatePdfBase64(quote, settings) {
    if (!window.html2pdf) return null;
    const container = document.createElement('div');
    container.innerHTML = this.generateQuotationHtml(quote, settings);
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '820px';
    document.body.appendChild(container);

    const opt = {
      margin: [6, 6, 6, 6],
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: {
        mode: ['css', 'legacy'],
        avoid: ['tr', '.keep-together', '.avoid-break', '.pdf-section', '.calc-block']
      }
    };

    try {
      const pdfBlob = await window.html2pdf().set(opt).from(container.querySelector('#print-quotation-root')).outputPdf('datauristring');
      return pdfBlob;
    } catch (e) {
      console.warn('PDF Base64 generation warning:', e);
      return null;
    } finally {
      document.body.removeChild(container);
    }
  },

  /**
   * Triggers client-side high-resolution PDF download using html2pdf.js
   */
  async downloadPdf(quote, settings) {
    const container = document.createElement('div');
    container.innerHTML = this.generateQuotationHtml(quote, settings);
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '820px';
    document.body.appendChild(container);

    const clientSlug = (quote.clientCompany || quote.clientName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${quote.quoteNumber || 'Quotation'}_${clientSlug}.pdf`;

    const opt = {
      margin: [6, 6, 6, 6],
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: {
        mode: ['css', 'legacy'],
        avoid: ['tr', '.keep-together', '.avoid-break', '.pdf-section', '.calc-block']
      }
    };

    try {
      if (window.html2pdf) {
        await window.html2pdf().set(opt).from(container.querySelector('#print-quotation-root')).save();
      } else {
        this.printQuotation(quote, settings);
      }
    } catch (e) {
      console.error('PDF generation error:', e);
      window.print();
    } finally {
      document.body.removeChild(container);
    }
  },

  printQuotation(quote, settings) {
    const contentHtml = this.generateQuotationHtml(quote, settings);

    // 1. Also update #printable-area in main DOM as fallback and unhide it
    const printArea = document.getElementById('printable-area');
    if (printArea) {
      printArea.innerHTML = contentHtml;
      printArea.classList.remove('hidden');
      printArea.classList.add('block');
    }

    // 2. High-reliability Iframe-based Print Isolation
    try {
      let iframe = document.getElementById('print-isolation-frame');
      if (iframe) {
        iframe.remove();
      }

      iframe = document.createElement('iframe');
      iframe.id = 'print-isolation-frame';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${PdfGenerator.escapeHtml(quote.quoteNumber || 'Quotation')}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <style>
    @page {
      size: A4 portrait;
      margin: 6mm 8mm 6mm 8mm;
    }
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      background: #ffffff !important;
      color: #000000 !important;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #000000 !important;
    }
    .avoid-break, .pdf-section, .calc-block {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .pdf-page-container {
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: always;
      break-after: page;
      min-height: 275mm;
    }
    .pdf-page-container:last-child {
      page-break-after: auto;
      break-after: auto;
    }
  </style>
</head>
<body>
  <div class="quotation-print-root">
    ${contentHtml}
  </div>
</body>
</html>`);
      doc.close();

      const triggerPrint = () => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (printErr) {
          console.warn('[PdfGenerator] Iframe print fallback to window.print():', printErr);
          window.print();
        } finally {
          setTimeout(() => {
            if (iframe && iframe.parentNode) {
              iframe.parentNode.removeChild(iframe);
            }
            if (printArea) {
              printArea.classList.add('hidden');
              printArea.classList.remove('block');
            }
          }, 30000);
        }
      };

      // Check if tailwind or DOM is ready
      if (iframe.contentWindow.tailwind) {
        setTimeout(triggerPrint, 150);
      } else {
        iframe.onload = () => setTimeout(triggerPrint, 200);
        setTimeout(triggerPrint, 400);
      }
    } catch (iframeErr) {
      console.warn('[PdfGenerator] Iframe setup error, falling back to window.print():', iframeErr);
      window.print();
      if (printArea) {
        setTimeout(() => {
          printArea.classList.add('hidden');
          printArea.classList.remove('block');
        }, 3000);
      }
    }
  },

  formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

window.PdfGenerator = PdfGenerator;
