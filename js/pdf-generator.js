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
    if ((!settings || !settings.company) && window.StorageManager) {
      settings = StorageManager.getCompanySettingsForQuote(quote);
    }
    const comp = settings?.company || DEFAULT_SETTINGS.company;
    const bank = settings?.bank || DEFAULT_SETTINGS.bank;
    const terms = settings?.terms || DEFAULT_SETTINGS.terms;
    const media = settings?.media || DEFAULT_SETTINGS.media;

    // Recalculate totals for precision
    const customCgst = quote.cgstPercent !== undefined && quote.cgstPercent !== null ? quote.cgstPercent : (quote.cgst_percent !== undefined && quote.cgst_percent !== null ? quote.cgst_percent : (comp.cgstPercent !== undefined ? comp.cgstPercent : (comp.cgst_percent !== undefined ? comp.cgst_percent : 9)));
    const customSgst = quote.sgstPercent !== undefined && quote.sgstPercent !== null ? quote.sgstPercent : (quote.sgst_percent !== undefined && quote.sgst_percent !== null ? quote.sgst_percent : (comp.sgstPercent !== undefined ? comp.sgstPercent : (comp.sgst_percent !== undefined ? comp.sgst_percent : 9)));

    const totals = CalculationsEngine.calculateQuotationTotals(
      quote.items || [],
      quote.loadingCharges || 0,
      quote.additionalCharges || [],
      quote.gstType || 'CGST_SGST',
      quote.gstRate,
      quote.roundOff,
      customCgst,
      customSgst
    );

    let bannersList = [];
    if (Array.isArray(media.promotionalBanners) && media.promotionalBanners.length > 0) {
      bannersList = media.promotionalBanners;
    } else if (Array.isArray(media.bannerUrls) && media.bannerUrls.length > 0) {
      bannersList = media.bannerUrls;
    } else if (typeof media.promotionalBanner === 'string' && media.promotionalBanner.trim()) {
      try {
        const parsed = JSON.parse(media.promotionalBanner);
        if (Array.isArray(parsed)) bannersList = parsed;
        else bannersList = [media.promotionalBanner.trim()];
      } catch (e) {
        bannersList = [media.promotionalBanner.trim()];
      }
    } else if (typeof media.bannerUrl === 'string' && media.bannerUrl.trim()) {
      try {
        const parsed = JSON.parse(media.bannerUrl);
        if (Array.isArray(parsed)) bannersList = parsed;
        else bannersList = [media.bannerUrl.trim()];
      } catch (e) {
        bannersList = [media.bannerUrl.trim()];
      }
    }
    bannersList = bannersList.filter(b => typeof b === 'string' && b.trim());
    if (bannersList.length === 0 && (media.bannerUrl || media.promotionalBanner)) {
      bannersList = [media.bannerUrl || media.promotionalBanner];
    }
    if (bannersList.length === 0) {
      bannersList = ['assets/product-gallery-page7.svg'];
    }

    const headerLogo = (comp.companyLogo || comp.company_logo || comp.headerLogoUrl || media.companyLogo || media.company_logo || media.headerLogoUrl || '').trim();
    const signatureImg = media.signatureImageUrl || 'assets/sample-signature.svg';
    const showSignature = media.showSignatureInPdf !== false;
    const shouldIncludeBanner = (quote.includeBanner !== undefined ? Boolean(quote.includeBanner) : (quote.include_banner !== undefined ? (quote.include_banner === 1 || quote.include_banner === '1' || quote.include_banner === true) : true)) && (media.showBannerInPdf !== false);

    // -------------------------------------------------------------
    // PART 1: MAIN ITEMS PRICING TABLE & PRODUCT IMAGES GATHERING
    // -------------------------------------------------------------
    const imageCards = [];

    const itemRows = (quote.items || []).map((it, idx) => {
      const qNum = (parseFloat(it.quantity) || 0).toLocaleString('en-IN');
      const unitStr = it.unit || 'PCS';
      const rateStr = (parseFloat(it.rate) || 0).toFixed(2);
      const amtStr = ((parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0)).toFixed(2);

      // Collect product profile / item image with fallback to Items Master
      let itImg = (it.imageUrl || it.image_url || it.image || '').trim();
      if (!itImg && typeof StorageManager !== 'undefined' && StorageManager && typeof StorageManager.getItems === 'function') {
        try {
          const masterList = StorageManager.getItems();
          const itDesc = (it.description || it.name || '').trim().toLowerCase();
          const matched = masterList.find(m =>
            (it.masterItemId && String(m.id) === String(it.masterItemId)) ||
            (itDesc && m.name && itDesc === m.name.trim().toLowerCase())
          );
          if (matched) {
            itImg = (matched.imageUrl || matched.image_url || matched.image || '').trim();
          }
        } catch (e) {}
      }
      if (!itImg && it.description && it.description.toUpperCase().includes('POLY CARBONATE EMBOSSED CLEAR DOUBLE WALLY')) {
        itImg = 'assets/profile-polycarbonate.svg';
      }
      if (itImg) {
        imageCards.push({
          index: idx + 1,
          title: it.description || it.name || `Item ${idx + 1}`,
          subText: it.subRemarks || '',
          url: itImg
        });
      }

      // Check if item has sub-table breakdown (e.g. accessories Item 9 in PDF)
      let subTableHtml = '';
      if (it.subTable && Array.isArray(it.subTable) && it.subTable.length > 0) {
        const subRows = it.subTable.map(s => `
          <tr class="border-b border-slate-300 text-[10px]">
            <td class="py-0.5 px-1.5 font-medium">${this.escapeHtml(s.desc)}</td>
            <td class="py-0.5 px-1.5 text-center font-bold">${this.escapeHtml(s.inchKg)}</td>
            <td class="py-0.5 px-1.5 text-center font-bold">${s.nos}</td>
            <td class="py-0.5 px-1.5 text-right font-medium">${s.weight}</td>
            <td class="py-0.5 px-1.5 text-center text-slate-700">${this.escapeHtml(s.remarks)}</td>
          </tr>
        `).join('');

        subTableHtml = `
          <div class="mt-1 border border-slate-400 rounded overflow-hidden max-w-sm">
            <table class="w-full text-left border-collapse text-[10px]">
              <thead>
                <tr class="bg-slate-200 font-bold text-slate-800 border-b border-slate-400">
                  <th class="py-0.5 px-1.5">Description</th>
                  <th class="py-0.5 px-1.5 text-center">Inch/Kg</th>
                  <th class="py-0.5 px-1.5 text-center">NOS</th>
                  <th class="py-0.5 px-1.5 text-right">Weight</th>
                  <th class="py-0.5 px-1.5 text-center">Remarks</th>
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
        <tr class="border-b border-slate-300 text-xs" style="page-break-inside: avoid; break-inside: avoid;">
          <td class="py-1.5 px-2 text-center text-slate-700 font-bold align-top">${idx + 1}</td>
          <td class="py-1.5 px-2.5 text-slate-900 font-bold align-top">
            <div class="text-[12px] leading-snug">${this.escapeHtml(it.description)}</div>
            ${it.subRemarks ? `<div class="text-[10px] text-slate-600 font-semibold italic mt-0.5">${this.escapeHtml(it.subRemarks)}</div>` : ''}
            ${itImg ? `
              <div class="mt-1.5 mb-1">
                <img src="${itImg}" alt="${this.escapeHtml(it.description || 'Product Profile')}" style="max-height: 52px; max-width: 150px; object-fit: contain; display: block; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px; background-color: #ffffff;" />
              </div>
            ` : ''}
            ${subTableHtml}
          </td>
          <td class="py-1.5 px-2 text-center align-top">
            <div class="font-bold text-slate-900 text-[12px]">${qNum}</div>
            <div class="text-[10px] text-slate-600 font-semibold lowercase">${this.escapeHtml(unitStr)}</div>
          </td>
          <td class="py-1.5 px-2 text-center font-bold text-slate-900 align-top text-[12px]">
            ${rateStr}
          </td>
          <td class="py-1.5 px-2.5 text-right font-bold text-slate-900 align-top text-[12px]">
            ${amtStr}
          </td>
        </tr>
      `;
    }).join('');

    let taxLabel = `GST ${totals.gstRate}% (CGST ${totals.cgstRate}% + SGST ${totals.sgstRate}%)`;
    if (totals.gstType === 'IGST') {
      taxLabel = `IGST ${totals.igstRate}%`;
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

    // Running Footer line matching PDF (Rendered strictly once at the end)
    const footerLine = `
      <div class="mt-2.5 pt-2 border-t-2 border-slate-900 text-center text-[10px] sm:text-[11px] font-bold tracking-wider text-slate-800 uppercase">
        ${this.escapeHtml(comp.name)} [ CONTACT NO. ${this.escapeHtml(comp.phone)} ${comp.phoneSecondary ? '/ ' + this.escapeHtml(comp.phoneSecondary) : ''} ]
      </div>
    `;

    // -------------------------------------------------------------
    // PART 3: ITEM IMAGES 3-COLUMN HORIZONTAL GRID
    // -------------------------------------------------------------
    let imagesGridHtml = '';
    if (imageCards.length > 0) {
      imagesGridHtml = `
        <div class="quotation-images-section avoid-break mt-3 mb-3" style="page-break-inside: avoid; break-inside: avoid;">
          <div class="text-[11px] font-black uppercase tracking-wider text-slate-800 mb-2 flex items-center gap-1.5 border-b border-slate-300 pb-1">
            <i class="fa-solid fa-images text-blue-900"></i>
            <span>Product Profile &amp; Reference Specifications</span>
          </div>
          <div class="quotation-images-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
            ${imageCards.map(c => `
              <div class="quotation-image-card avoid-break bg-white rounded border border-slate-300 p-2 text-center flex flex-col justify-between" style="border: 1px solid #ddd; padding: 6px; page-break-inside: avoid; break-inside: avoid; background-color: #ffffff;">
                <div class="w-full flex items-center justify-center bg-slate-50 rounded" style="height: 130px; max-height: 130px; overflow: hidden; background-color: #f8fafc; border: 1px solid #eee;">
                  <img src="${c.url}" alt="${this.escapeHtml(c.title)}" style="height: 130px; max-height: 130px; width: 100%; object-fit: contain; padding: 4px;" />
                </div>
                <div class="mt-1.5 pt-1 border-t border-slate-100 text-left">
                  <div class="text-[10px] font-bold text-slate-900 leading-tight truncate" title="${this.escapeHtml(c.title)}">
                    <span class="text-blue-900 font-mono mr-1">#${c.index}</span>${this.escapeHtml(c.title)}
                  </div>
                  ${c.subText ? `<div class="text-[9px] text-slate-500 font-semibold truncate mt-0.5">${this.escapeHtml(c.subText)}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // -------------------------------------------------------------
    // PART 3B: OUR PRODUCTS - BORDERLESS 3-COLUMN IMAGE GALLERY
    // -------------------------------------------------------------
    let promotionalBannersHtml = '';
    if (shouldIncludeBanner && bannersList.length > 0) {
      if (bannersList.length === 1 && bannersList[0].includes('product-gallery-page7.svg')) {
        promotionalBannersHtml = `
          <div class="quotation-promotional-section avoid-break mt-3 text-center" style="page-break-inside: avoid; break-inside: avoid; border: none !important; padding: 0 !important; margin: 0 !important;">
            <img src="${bannersList[0]}" alt="${this.escapeHtml(comp.name)} Our Products" style="width: 100%; max-height: 480px; object-fit: contain; margin: 0 auto; border: none !important; padding: 0 !important; display: block;" />
          </div>
        `;
      } else {
        promotionalBannersHtml = `
          <div class="quotation-promotional-section avoid-break mt-3" style="page-break-inside: avoid; break-inside: avoid; border: none !important; padding: 0 !important;">
            <div class="text-[11px] font-black uppercase tracking-wider text-slate-800 mb-1 flex items-center gap-1.5 border-b border-slate-300 pb-1">
              <i class="fa-solid fa-boxes-stacked text-blue-900"></i>
              <span>Our Products</span>
            </div>
            <div class="quotation-banners-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 !important; padding: 0 !important; margin: 0 !important; border: none !important;">
              ${bannersList.map((bImg, bIdx) => `
                <div class="quotation-banner-card avoid-break" style="border: none !important; padding: 0 !important; margin: 0 !important; background: transparent !important; box-shadow: none !important; outline: none !important; page-break-inside: avoid; break-inside: avoid;">
                  <div style="width: 100%; height: 160px; max-height: 160px; overflow: hidden; border: none !important; padding: 0 !important; margin: 0 !important; background: transparent !important; display: flex; align-items: center; justify-content: center;">
                    <img src="${bImg}" alt="Product ${bIdx + 1}" style="width: 100%; height: 100%; object-fit: cover !important; border: none !important; padding: 0 !important; margin: 0 !important; display: block;" />
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }
    }

    // -------------------------------------------------------------
    // PART 4: BANK PAYMENT DETAILS BLOCK (Directly ABOVE Calculation)
    // -------------------------------------------------------------
    const bankDetailsHtml = `
      <div class="bank-details-box avoid-break mb-3 border border-slate-300 rounded-lg p-3 bg-slate-50/80 shadow-2xs" style="page-break-inside: avoid; break-inside: avoid;">
        <h3 class="text-xs font-black text-sky-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
          <i class="fa-solid fa-building-columns"></i> BANK PAYMENT DETAILS:
        </h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div>
            <span class="text-[10px] text-slate-500 font-bold block uppercase">Bank Name</span>
            <span class="text-xs font-black text-amber-700 uppercase">${this.escapeHtml(bank.bankName)}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 font-bold block uppercase">Account No</span>
            <span class="text-[11px] font-bold font-mono text-slate-950">${this.escapeHtml(bank.accountNumber)}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 font-bold block uppercase">IFSC Code</span>
            <span class="text-[11px] font-bold font-mono text-blue-900">${this.escapeHtml(bank.ifscCode)}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 font-bold block uppercase">Branch</span>
            <span class="text-[11px] font-bold text-slate-800 uppercase">${this.escapeHtml(bank.branch)}</span>
          </div>
        </div>
      </div>
    `;

    // -------------------------------------------------------------
    // PART 5: TERMS AND CONDITIONS & AUTHORIZED SIGNATURE
    // -------------------------------------------------------------
    const termsAndSignatureHtml = `
      <div class="quotation-terms-signature-block avoid-break mt-3 border border-slate-300 rounded-lg p-3.5 bg-white" style="page-break-inside: avoid; break-inside: avoid; position: static;">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          
          <!-- Left Column: Terms & Remarks -->
          <div class="space-y-3">
            <!-- Terms and Conditions -->
            <div>
              <h3 class="text-xs font-black text-rose-600 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <i class="fa-solid fa-list-check"></i> TERMS AND CONDITIONS:
              </h3>
              <div class="space-y-0.5 text-slate-800">
                ${termsHtml}
              </div>
            </div>

            ${quote.notes ? `
              <div class="text-left bg-slate-50 p-2 rounded border border-slate-200">
                <strong class="text-[11px] font-bold text-blue-950 block mb-0.5">Quotation Notes / Remarks:</strong>
                <p class="text-[11px] text-slate-700 whitespace-pre-line leading-relaxed">${this.escapeHtml(quote.notes)}</p>
              </div>
            ` : ''}
          </div>

          <!-- Right Column: Signature -->
          <div class="flex flex-col justify-end h-full space-y-3 md:text-right">
            <!-- Uploaded Signature Placement -->
            <div class="pt-2 self-end text-center min-w-[200px]">
              ${showSignature && signatureImg ? `
                <div class="mb-1 flex justify-center">
                  <img src="${signatureImg}" alt="Authorized Signature" class="max-h-14 max-w-[170px] object-contain" />
                </div>
              ` : `
                <div class="h-14"></div>
              `}
              <div class="border-t border-slate-400 pt-1">
                <div class="text-xs font-black text-slate-950 uppercase">For, ${this.escapeHtml(comp.name)}</div>
                <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${this.escapeHtml(media.signatureTitle || 'Authorized Signatory')}</div>
              </div>
            </div>

          </div>

        </div>

        <!-- Centered System Note -->
        <div class="text-center text-[10px] text-slate-400 italic mt-3 mb-1">
          This is a system-generated quotation.
        </div>

        <!-- Running Company Contact Footer Line (ONLY ONCE AT VERY END) -->
        ${footerLine}

      </div>
    `;

    return `
      <div id="print-quotation-root" class="bg-white text-slate-900 font-sans max-w-4xl mx-auto p-3 sm:p-6 print:p-0 print:max-w-none text-xs">
        <style>
          #print-quotation-root {
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
            color: #0f172a !important;
            background-color: #ffffff !important;
          }
          #print-quotation-root table {
            border-collapse: collapse !important;
            width: 100% !important;
            page-break-inside: auto !important;
            break-inside: auto !important;
          }
          #print-quotation-root thead {
            display: table-header-group !important;
          }
          #print-quotation-root tfoot {
            display: table-row-group !important;
          }
          #print-quotation-root table,
          #print-quotation-root th,
          #print-quotation-root td {
            border: 1px solid #000000 !important;
          }
          #print-quotation-root th,
          #print-quotation-root td {
            padding: 4px 6px !important;
            line-height: 1.25 !important;
          }
          #print-quotation-root tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          #print-quotation-root .avoid-break,
          #print-quotation-root .bank-details-box,
          #print-quotation-root .calc-block,
          #print-quotation-root .financial-summary-box,
          #print-quotation-root .quotation-terms-signature-block,
          #print-quotation-root .quotation-image-card,
          #print-quotation-root .quotation-banner-card,
          #print-quotation-root .quotation-final-footer {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          #print-quotation-root .quotation-images-grid {
            display: grid !important;
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 10px !important;
          }
          #print-quotation-root .quotation-image-card img {
            height: 130px !important;
            max-height: 130px !important;
            width: 100% !important;
            object-fit: contain !important;
          }
          #print-quotation-root .quotation-banners-grid {
            display: grid !important;
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
          }
          #print-quotation-root .quotation-banner-card {
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            outline: none !important;
          }
          #print-quotation-root .quotation-banner-card div {
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
          }
          #print-quotation-root .quotation-banner-card img {
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            height: 100% !important;
            max-height: 160px !important;
            object-fit: cover !important;
            display: block !important;
          }
          #print-quotation-root .quotation-final-footer {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            position: static !important;
          }
        </style>

        <!-- ======================================================= -->
        <!-- HEADER BLOCK                                            -->
        <!-- ======================================================= -->
        <div class="quotation-header-block mb-1.5">
          <!-- Top Header (Company Left, 3D Roofing Sheets Right) -->
          <div class="flex justify-between items-start gap-3 pb-1">
            <div class="flex-1">
              <h1 class="text-xl sm:text-2xl font-black tracking-tight text-slate-950 uppercase">${this.escapeHtml(comp.name)}</h1>
              <div class="mt-0.5 text-xs text-slate-800 space-y-0.5 font-medium leading-snug">
                <p><strong>Address :-</strong> ${this.escapeHtml(comp.address)}</p>
                <p><strong>E-mail:</strong> <span class="text-blue-900 font-semibold">${this.escapeHtml(comp.email)}</span></p>
                <p><strong>Mo.No.</strong> ${this.escapeHtml(comp.phone)} ${comp.phoneSecondary ? '/ ' + this.escapeHtml(comp.phoneSecondary) : ''}</p>
                <p class="text-sky-600 font-bold text-xs sm:text-sm tracking-wide">GST NO. ${this.escapeHtml(comp.gstin)}</p>
              </div>
            </div>

            <!-- Top Right Dynamic Company Logo -->
            ${headerLogo ? `
            <div class="w-44 sm:w-52 flex-shrink-0 text-right">
              <img src="${headerLogo}" alt="${this.escapeHtml(comp.name)} Logo" class="w-full max-h-20 object-contain ml-auto" />
            </div>
            ` : ''}
          </div>

          <!-- Divider Line -->
          <div class="w-full h-1 bg-gradient-to-r from-sky-400 via-blue-600 to-sky-400 my-1.5"></div>

          <!-- Title: Quotation (Centered Cyan) -->
          <div class="text-center my-1.5">
            <h2 class="text-xl sm:text-2xl font-bold tracking-wide" style="color: #00a2e8;">Quotation</h2>
          </div>

          <!-- Client & Quote Meta Details -->
          <div class="mb-2 text-xs font-semibold leading-relaxed grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-slate-50/70 p-2 rounded border border-slate-200">
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
        </div>

        <!-- ======================================================= -->
        <!-- MAIN ITEMS PRICING TABLE (Flows naturally across pages) -->
        <!-- ======================================================= -->
        <div class="overflow-x-auto mb-2" style="border: 1px solid #000000; border-collapse: collapse;">
          <table class="quotation-items-table w-full text-left" style="border-collapse: collapse; border: 1px solid #000000; width: 100%;">
            <thead>
              <tr class="text-white text-xs font-bold" style="background-color: #00a2e8;">
                <th class="py-1.5 px-2 text-center w-12" style="border: 1px solid #000000;">No.</th>
                <th class="py-1.5 px-2.5" style="border: 1px solid #000000;">ITEM NAME</th>
                <th class="py-1.5 px-2 text-center w-24" style="border: 1px solid #000000;">QUANTITY</th>
                <th class="py-1.5 px-2 text-center w-20" style="border: 1px solid #000000;">PRICE</th>
                <th class="py-1.5 px-2.5 text-right w-32" style="border: 1px solid #000000;">TOTAL AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>
        </div>

        <!-- ======================================================= -->
        <!-- 2. BANK PAYMENT DETAILS (Directly ABOVE Calculation)   -->
        <!-- ======================================================= -->
        ${bankDetailsHtml}

        <!-- ======================================================= -->
        <!-- 3. CALCULATION DETAILS (Subtotal, Loading, GST, Grand)  -->
        <!-- ======================================================= -->
        <div class="financial-summary-box avoid-break w-full max-w-sm ml-auto space-y-1 text-xs text-right font-bold text-slate-900 pt-1.5 mb-3 border border-slate-300 rounded-lg p-2.5 bg-slate-50/80 shadow-2xs" style="page-break-inside: avoid; break-inside: avoid;">
          <div class="flex justify-between items-center py-0.5 border-b border-slate-300 text-slate-700">
            <span class="uppercase tracking-wider font-bold">Quotation Subtotal (TOTAL):</span>
            <span class="font-mono text-xs sm:text-sm text-slate-950 font-black">${totals.materialTotal.toFixed(2)}/-</span>
          </div>
          <div class="flex justify-between items-center py-0.5 border-b border-slate-300 text-slate-700">
            <span class="font-bold">Loading Charge:</span>
            <span class="font-mono text-slate-950 font-black">${totals.loadingCharges.toFixed(2)}/-</span>
          </div>
          ${totals.gstType === 'CGST_SGST' ? `
          <div class="flex justify-between items-center py-0.5 border-b border-slate-300 text-slate-700">
            <span class="font-bold">CGST (${totals.cgstRate}%):</span>
            <span class="font-mono text-slate-950 font-black">${totals.cgstAmount.toFixed(2)}/-</span>
          </div>
          <div class="flex justify-between items-center py-0.5 border-b-2 border-slate-400 text-slate-700">
            <span class="font-bold">SGST (${totals.sgstRate}%):</span>
            <span class="font-mono text-slate-950 font-black">${totals.sgstAmount.toFixed(2)}/-</span>
          </div>
          ` : `
          <div class="flex justify-between items-center py-0.5 border-b-2 border-slate-400 text-slate-700">
            <span class="font-bold">${taxLabel}:</span>
            <span class="font-mono text-slate-950 font-black">${totals.gstAmount.toFixed(2)}/-</span>
          </div>
          `}
          <!-- FINAL CALCULATION ROW: GRAND TOTAL (Directly below GST row) -->
          <div class="flex justify-between items-center py-1.5 bg-blue-50/90 border border-blue-200 px-2 rounded mt-0.5 text-blue-950">
            <span class="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950">GRAND TOTAL:</span>
            <span class="text-base sm:text-lg font-black text-blue-950 font-mono">₹ ${Math.round(totals.grandTotal).toLocaleString('en-IN')}/-</span>
          </div>
          <div class="pt-1 text-[10px] text-slate-600 italic text-left border-t border-slate-200 mt-0.5">
            <span class="font-bold not-italic text-slate-800">Words:</span> ${totals.grandTotalWords}
          </div>
        </div>

        <!-- ======================================================= -->
        <!-- 4. TERMS & CONDITIONS + AUTHORIZED SIGNATURE            -->
        <!-- ======================================================= -->
        ${termsAndSignatureHtml}

        <!-- ======================================================= -->
        <!-- 5. SHEET CALCULATION DETAILS (Below Terms & Signature)  -->
        <!-- ======================================================= -->
        ${quote.calculations && quote.calculations.length > 0 ? `
          <div class="calculations-section pt-1">
            ${calculationsHtml}
          </div>
        ` : ''}

        <!-- ======================================================= -->
        <!-- 6. "OUR PRODUCTS" 3-COLUMN BORDERLESS IMAGE GALLERY     -->
        <!-- ======================================================= -->
        ${imagesGridHtml}
        ${promotionalBannersHtml}

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
        avoid: ['tr', '.avoid-break', '.bank-details-box', '.financial-summary-box', '.calc-block', '.quotation-terms-signature-block', '.quotation-image-card', '.quotation-banner-card', '.quotation-final-footer']
      }
    };

    // Ensure all images are fully loaded and decoded before rendering PDF canvas
    const imgs = Array.from(container.querySelectorAll('img'));
    await Promise.all(imgs.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));

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
        avoid: ['tr', '.avoid-break', '.bank-details-box', '.financial-summary-box', '.calc-block', '.quotation-terms-signature-block', '.quotation-image-card', '.quotation-banner-card', '.quotation-final-footer']
      }
    };

    // Ensure all images are fully loaded and decoded before rendering PDF canvas
    const imgs = Array.from(container.querySelectorAll('img'));
    await Promise.all(imgs.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));

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

  _isPrinting: false,

  printQuotation(quote, settings) {
    // 1. Guard against rapid duplicate clicks (Debounce Lock)
    if (this._isPrinting) {
      console.warn('[PdfGenerator] Print already in progress, ignoring duplicate call');
      return;
    }
    this._isPrinting = true;

    const contentHtml = this.generateQuotationHtml(quote, settings);

    // 2. Remove any leftover iframe before creating a new one
    const oldFrame = document.getElementById('print-isolation-frame');
    if (oldFrame) {
      try { oldFrame.remove(); } catch (e) {}
    }

    // 3. Create isolated hidden iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'print-isolation-frame';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    iframe.style.visibility = 'hidden';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    let hasTriggered = false;
    let isCleanedUp = false;

    // 4. Strict cleanup function that immediately destroys the iframe and ensures no ghost DOM remains
    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      this._isPrinting = false;

      try {
        const frame = document.getElementById('print-isolation-frame');
        if (frame && frame.parentNode) {
          frame.parentNode.removeChild(frame);
        }
      } catch (err) {
        console.warn('[PdfGenerator] Error removing print iframe:', err);
      }

      // Ensure printable-area in main body is never left visible
      const printArea = document.getElementById('printable-area');
      if (printArea) {
        printArea.innerHTML = '';
        printArea.classList.add('hidden');
        printArea.classList.remove('block');
      }
    };

    // 5. Trigger print exactly once and wire up afterprint listener
    const triggerPrint = () => {
      if (hasTriggered) return;
      hasTriggered = true;

      try {
        if (iframe && iframe.contentWindow) {
          // Listen for afterprint on both the iframe window and parent window
          iframe.contentWindow.addEventListener('afterprint', cleanup, { once: true });
          window.addEventListener('afterprint', cleanup, { once: true });

          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } else {
          cleanup();
        }
      } catch (printErr) {
        console.warn('[PdfGenerator] Iframe print error:', printErr);
        cleanup();
      }

      // Safety timeout: If browser does not dispatch afterprint (e.g. cancelled immediately), cleanup
      setTimeout(cleanup, 1200);
    };

    try {
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
      border-collapse: collapse !important;
      width: 100% !important;
      page-break-inside: auto !important;
      break-inside: auto !important;
    }
    thead {
      display: table-header-group !important;
    }
    tfoot {
      display: table-row-group !important;
    }
    th, td {
      border: 1px solid #000000 !important;
    }
    tr {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .avoid-break, .bank-details-box, .calc-block, .financial-summary-box, .quotation-terms-signature-block, .quotation-image-card, .quotation-banner-card, .quotation-final-footer {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .quotation-images-grid {
      display: grid !important;
      grid-template-columns: repeat(3, 1fr) !important;
      gap: 10px !important;
    }
    .quotation-image-card img {
      height: 130px !important;
      max-height: 130px !important;
      width: 100% !important;
      object-fit: contain !important;
    }
    .quotation-banners-grid {
      display: grid !important;
      grid-template-columns: repeat(3, 1fr) !important;
      gap: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      border: none !important;
    }
    .quotation-banner-card {
      border: none !important;
      padding: 0 !important;
      margin: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      outline: none !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .quotation-banner-card div {
      border: none !important;
      padding: 0 !important;
      margin: 0 !important;
      background: transparent !important;
    }
    .quotation-banner-card img {
      border: none !important;
      padding: 0 !important;
      margin: 0 !important;
      width: 100% !important;
      height: 100% !important;
      max-height: 160px !important;
      object-fit: cover !important;
      display: block !important;
    }
    .quotation-terms-signature-block,
    .quotation-final-footer {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      position: static !important;
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

      // Trigger print once ready (single-fire only)
      if (iframe.contentWindow.tailwind) {
        setTimeout(triggerPrint, 150);
      } else {
        iframe.onload = () => setTimeout(triggerPrint, 180);
        // Fallback safety if onload doesn't fire
        setTimeout(triggerPrint, 350);
      }
    } catch (iframeErr) {
      console.warn('[PdfGenerator] Iframe setup error, fallback to window.print():', iframeErr);
      cleanup();
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
