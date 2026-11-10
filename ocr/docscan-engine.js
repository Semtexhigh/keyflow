/* ============================================================================
   DocScan Engine — ICAO 9303 MRZ, checksum correction, BAC key derivation,
   AAMVA PDF417 parsing, image quality analysis, perspective warp.
   Pure JavaScript. No DOM dependency except where noted (canvas helpers).
   ========================================================================== */
const DocScanEngine = (function () {
  'use strict';

  /* ----------------------------------------------------------------------
     1. Country / issuer code table (ISO 3166-1 alpha-3 + ICAO special codes)
     ---------------------------------------------------------------------- */
  const COUNTRIES = {
    AFG:'Afghanistan',ALB:'Albania',DZA:'Algeria',AND:'Andorra',AGO:'Angola',ARG:'Argentina',ARM:'Armenia',AUS:'Australia',AUT:'Austria',AZE:'Azerbaijan',
    BHS:'Bahamas',BHR:'Bahrain',BGD:'Bangladesh',BRB:'Barbados',BLR:'Belarus',BEL:'Belgium',BLZ:'Belize',BEN:'Benin',BTN:'Bhutan',BOL:'Bolivia',BIH:'Bosnia and Herzegovina',BWA:'Botswana',BRA:'Brazil',BRN:'Brunei',BGR:'Bulgaria',BFA:'Burkina Faso',BDI:'Burundi',
    KHM:'Cambodia',CMR:'Cameroon',CAN:'Canada',CPV:'Cabo Verde',CAF:'Central African Republic',TCD:'Chad',CHL:'Chile',CHN:'China',COL:'Colombia',COM:'Comoros',COG:'Congo',COD:'Congo (DRC)',CRI:'Costa Rica',CIV:"Côte d'Ivoire",HRV:'Croatia',CUB:'Cuba',CYP:'Cyprus',CZE:'Czechia',
    DNK:'Denmark',DJI:'Djibouti',DMA:'Dominica',DOM:'Dominican Republic',ECU:'Ecuador',EGY:'Egypt',SLV:'El Salvador',GNQ:'Equatorial Guinea',ERI:'Eritrea',EST:'Estonia',SWZ:'Eswatini',ETH:'Ethiopia',
    FJI:'Fiji',FIN:'Finland',FRA:'France',GAB:'Gabon',GMB:'Gambia',GEO:'Georgia',DEU:'Germany',GHA:'Ghana',GRC:'Greece',GRD:'Grenada',GTM:'Guatemala',GIN:'Guinea',GNB:'Guinea-Bissau',GUY:'Guyana',
    HTI:'Haiti',HND:'Honduras',HKG:'Hong Kong SAR',HUN:'Hungary',ISL:'Iceland',IND:'India',IDN:'Indonesia',IRN:'Iran',IRQ:'Iraq',IRL:'Ireland',ISR:'Israel',ITA:'Italy',JAM:'Jamaica',JPN:'Japan',JOR:'Jordan',
    KAZ:'Kazakhstan',KEN:'Kenya',KIR:'Kiribati',PRK:'North Korea',KOR:'South Korea',KWT:'Kuwait',KGZ:'Kyrgyzstan',LAO:'Laos',LVA:'Latvia',LBN:'Lebanon',LSO:'Lesotho',LBR:'Liberia',LBY:'Libya',LIE:'Liechtenstein',LTU:'Lithuania',LUX:'Luxembourg',
    MAC:'Macao SAR',MDG:'Madagascar',MWI:'Malawi',MYS:'Malaysia',MDV:'Maldives',MLI:'Mali',MLT:'Malta',MHL:'Marshall Islands',MRT:'Mauritania',MUS:'Mauritius',MEX:'Mexico',FSM:'Micronesia',MDA:'Moldova',MCO:'Monaco',MNG:'Mongolia',MNE:'Montenegro',MAR:'Morocco',MOZ:'Mozambique',MMR:'Myanmar',
    NAM:'Namibia',NRU:'Nauru',NPL:'Nepal',NLD:'Netherlands',NZL:'New Zealand',NIC:'Nicaragua',NER:'Niger',NGA:'Nigeria',MKD:'North Macedonia',NOR:'Norway',OMN:'Oman',PAK:'Pakistan',PLW:'Palau',PSE:'Palestine',PAN:'Panama',PNG:'Papua New Guinea',PRY:'Paraguay',PER:'Peru',PHL:'Philippines',POL:'Poland',PRT:'Portugal',QAT:'Qatar',
    ROU:'Romania',RUS:'Russia',RWA:'Rwanda',KNA:'Saint Kitts and Nevis',LCA:'Saint Lucia',VCT:'Saint Vincent and the Grenadines',WSM:'Samoa',SMR:'San Marino',STP:'Sao Tome and Principe',SAU:'Saudi Arabia',SEN:'Senegal',SRB:'Serbia',SYC:'Seychelles',SLE:'Sierra Leone',SGP:'Singapore',SVK:'Slovakia',SVN:'Slovenia',SLB:'Solomon Islands',SOM:'Somalia',ZAF:'South Africa',SSD:'South Sudan',ESP:'Spain',LKA:'Sri Lanka',SDN:'Sudan',SUR:'Suriname',SWE:'Sweden',CHE:'Switzerland',SYR:'Syria',
    TWN:'Taiwan',TJK:'Tajikistan',TZA:'Tanzania',THA:'Thailand',TLS:'Timor-Leste',TGO:'Togo',TON:'Tonga',TTO:'Trinidad and Tobago',TUN:'Tunisia',TUR:'Türkiye',TKM:'Turkmenistan',TUV:'Tuvalu',UGA:'Uganda',UKR:'Ukraine',ARE:'United Arab Emirates',GBR:'United Kingdom',USA:'United States',URY:'Uruguay',UZB:'Uzbekistan',VUT:'Vanuatu',VAT:'Vatican City',VEN:'Venezuela',VNM:'Vietnam',YEM:'Yemen',ZMB:'Zambia',ZWE:'Zimbabwe',
    // ICAO 9303 special codes
    D:'Germany', // D< issuer code used on German documents
    GBD:'British Overseas Territories Citizen',GBN:'British National (Overseas)',GBO:'British Overseas Citizen',GBP:'British Protected Person',GBS:'British Subject',
    UNO:'United Nations Organization',UNA:'UN specialized agency',UNK:'UN Interim Mission in Kosovo',
    RKS:'Kosovo',EUE:'European Union',
    XBA:'African Development Bank',XIM:'African Export-Import Bank',XCC:'Caribbean Community',XCO:'COMESA',XEC:'ECOWAS',XPO:'Interpol',XOM:'Sovereign Military Order of Malta',XDC:'Southern African Development Community',
    XXA:'Stateless person (1954 Convention)',XXB:'Refugee (1951 Convention)',XXC:'Refugee (other)',XXX:'Unspecified nationality',
    UTO:'Utopia (ICAO specimen)'
  };
  function countryName(code) {
    const c = String(code || '').replace(/</g, '').toUpperCase();
    if (!c) return 'Unknown';
    return COUNTRIES[c] || ('Unrecognized issuer (' + c + ')');
  }
  function countryKnown(code) {
    const c = String(code || '').replace(/</g, '').toUpperCase();
    return !!COUNTRIES[c];
  }

  /* ----------------------------------------------------------------------
     2. Check digits (ICAO 9303 Part 3, weights 7-3-1)
     ---------------------------------------------------------------------- */
  function charValue(ch) {
    if (ch === '<') return 0;
    if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
    if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
    return -1; // invalid
  }
  function checkDigit(str) {
    const w = [7, 3, 1];
    let s = 0;
    for (let i = 0; i < str.length; i++) {
      const v = charValue(str[i]);
      if (v < 0) return -1;
      s += v * w[i % 3];
    }
    return s % 10;
  }
  function cdOk(str, cd) {
    if (cd === '<' && /^<+$/.test(str)) return true; // optional empty field: filler check digit allowed
    const d = checkDigit(str);
    return d >= 0 && String(d) === cd;
  }

  /* ----------------------------------------------------------------------
     3. Checksum-guided correction of common OCR confusions
     ---------------------------------------------------------------------- */
  const CONFUSE = {
    O: ['0', 'Q', 'D'], '0': ['O', 'D', 'Q'], I: ['1', 'L', 'T'], '1': ['I', 'L', '7'], L: ['1', 'I'],
    B: ['8', '3'], '8': ['B', '3'], S: ['5'], '5': ['S', '6'], Z: ['2', '7'], '2': ['Z'],
    G: ['6', 'C'], '6': ['G', 'b'], Q: ['0', 'O'], D: ['0', 'O'], '7': ['Z', '1', 'T'], T: ['7', 'I'],
    '3': ['8', 'B'], '4': ['A'], A: ['4'], K: ['<'], '<': ['K', 'C', 'E', 'L'], C: ['<', 'G', 'O'], E: ['<', 'F'], '9': ['g', 'q'], U: ['V'], V: ['U', 'Y'], Y: ['V'], M: ['N', 'W'], N: ['M', 'H'], H: ['N', 'M'], R: ['P', 'K'], P: ['R', 'F'], F: ['P', 'E']
  };
  function candidatesForChar(ch, allowed) {
    const out = (CONFUSE[ch] || []).map(c => c.toUpperCase()).filter(c => c !== ch);
    return allowed ? out.filter(c => allowed.test(c)) : out;
  }
  /**
   * Try to make `field` satisfy its check digit `cd` by swapping ambiguous chars.
   * Returns {value, corrected:boolean, candidates:[...]} — all candidates that validate.
   */
  function correctField(field, cd, allowed) {
    if (cdOk(field, cd)) return { value: field, corrected: false, candidates: [field] };
    const found = [];
    const chars = field.split('');
    // single substitutions
    for (let i = 0; i < chars.length; i++) {
      for (const c of candidatesForChar(chars[i], allowed)) {
        const t = chars.slice(); t[i] = c; const s = t.join('');
        if (cdOk(s, cd)) found.push(s);
      }
    }
    // also try the check digit itself being misread (digit confusions)
    const cdAlt = candidatesForChar(cd, /[0-9]/);
    for (const c of cdAlt) if (cdOk(field, c)) found.push(field + '|cd=' + c);
    // double substitutions (bounded)
    if (!found.length && chars.length <= 12) {
      for (let i = 0; i < chars.length; i++) {
        const ci = candidatesForChar(chars[i], allowed); if (!ci.length) continue;
        for (let j = i + 1; j < chars.length; j++) {
          const cj = candidatesForChar(chars[j], allowed); if (!cj.length) continue;
          for (const a of ci) for (const b of cj) {
            const t = chars.slice(); t[i] = a; t[j] = b; const s = t.join('');
            if (cdOk(s, cd)) found.push(s);
          }
        }
      }
    }
    const uniq = [...new Set(found)];
    if (!uniq.length) return { value: field, corrected: false, failed: true, candidates: [] };
    const first = uniq.find(x => !x.includes('|cd=')) || uniq[0];
    return { value: first.split('|')[0], corrected: true, candidates: uniq, cdCorrected: first.includes('|cd=') ? first.split('|cd=')[1] : null };
  }

  /* ----------------------------------------------------------------------
     4. Date handling (YYMMDD, century inference, unknown dates)
     ---------------------------------------------------------------------- */
  function parseMrzDate(raw, kind, now) {
    now = now || new Date();
    const r = String(raw || '');
    const out = { raw: r, iso: null, display: 'Unknown', unknown: false, valid: false, year: null, month: null, day: null };
    const yy = r.slice(0, 2), mm = r.slice(2, 4), dd = r.slice(4, 6);
    const unk = s => /[<X]/i.test(s) || s === '00';
    if (!/^[0-9<X]{6}$/i.test(r)) return out;
    if (unk(yy) && unk(mm) && unk(dd)) { out.unknown = true; return out; }
    if (!/^\d{2}$/.test(yy)) { out.unknown = true; return out; }
    const nowY = now.getFullYear();
    let year = 2000 + parseInt(yy, 10);
    if (kind === 'dob') {
      if (year > nowY) year -= 100;
    } else { // expiry / issue: keep within ±20 years of today
      if (year > nowY + 20) year -= 100;
    }
    const month = unk(mm) ? null : parseInt(mm, 10);
    const day = unk(dd) ? null : parseInt(dd, 10);
    if (month !== null && (month < 1 || month > 12)) return out;
    if (day !== null && (day < 1 || day > 31)) return out;
    out.year = year; out.month = month; out.day = day; out.valid = true;
    out.partial = month === null || day === null;
    out.iso = year + '-' + (month === null ? 'XX' : String(month).padStart(2, '0')) + '-' + (day === null ? 'XX' : String(day).padStart(2, '0'));
    out.display = out.iso;
    if (kind === 'dob' && month !== null && day !== null) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (d > now) { out.valid = false; out.future = true; }
      else {
        let age = nowY - year; const m = now.getMonth() + 1 - month;
        if (m < 0 || (m === 0 && now.getDate() < day)) age--;
        out.age = age;
      }
    }
    return out;
  }
  function expiryStatus(exp, now) {
    now = now || new Date();
    if (!exp || !exp.valid || exp.month === null || exp.day === null) return 'Unknown';
    const d = new Date(exp.year, exp.month - 1, exp.day);
    const days = Math.floor((d - now) / 86400000);
    if (days < 0) return 'Expired';
    if (days <= 180) return 'Expiring soon';
    return 'Valid';
  }

  /* ----------------------------------------------------------------------
     5. Line normalisation and MRZ detection in OCR text
     ---------------------------------------------------------------------- */
  const MRZ_CHARS = /^[A-Z0-9<]+$/;
  function normalizeLine(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/[«]/g, '<<').replace(/[‹]/g, '<')
      .replace(/[\s_\-–—.,:;'"`´’]/g, '')
      .replace(/[(){}\[\]|\\\/]/g, '<')
      .replace(/[^A-Z0-9<]/g, '');
  }
  function mrzScore(line) {
    if (!line.length) return 0;
    const ok = (line.match(/[A-Z0-9<]/g) || []).length / line.length;
    const fillers = (line.match(/</g) || []).length / line.length;
    return ok * (0.6 + 0.4 * Math.min(1, fillers * 4));
  }
  function fitLength(line, len) {
    if (line.length === len) return line;
    if (line.length > len) {
      // trim junk from either end: prefer removing non-filler junk at the ends
      let s = line;
      while (s.length > len && !/[<]/.test(s[0]) && mrzScore(s.slice(1)) >= mrzScore(s)) s = s.slice(1);
      while (s.length > len) s = s.slice(0, -1);
      return s;
    }
    return line.padEnd(len, '<');
  }
  /**
   * From raw OCR text, extract the most likely MRZ line group.
   * Returns {format, lines} or null.
   */
  function extractMrzLines(text) {
    const raw = String(text || '').split(/\r?\n/).map(normalizeLine).filter(l => l.length >= 20);
    const cands = raw.map(l => ({ l, s: mrzScore(l) })).filter(c => c.s > 0.5);
    if (cands.length < 2) return null;
    const lines = cands.map(c => c.l);
    const tries = [];
    for (let i = 0; i + 2 < lines.length + 1; i++) {
      // 3-line TD1
      if (i + 2 < lines.length) {
        const g = lines.slice(i, i + 3);
        const d = g.reduce((a, l) => a + Math.abs(l.length - 30), 0);
        if (d <= 12) tries.push({ format: 'TD1', lines: g.map(l => fitLength(l, 30)), penalty: d });
      }
      if (i + 1 < lines.length) {
        const g = lines.slice(i, i + 2);
        const d44 = g.reduce((a, l) => a + Math.abs(l.length - 44), 0);
        const d36 = g.reduce((a, l) => a + Math.abs(l.length - 36), 0);
        if (d44 <= 12) tries.push({ format: 'TD3', lines: g.map(l => fitLength(l, 44)), penalty: d44 });
        if (d36 <= 12) tries.push({ format: g[0].startsWith('IDFRA') ? 'FRCNI' : 'TD2', lines: g.map(l => fitLength(l, 36)), penalty: d36 + 1 });
      }
    }
    if (!tries.length) return null;
    tries.sort((a, b) => a.penalty - b.penalty);
    // Prefer the candidate whose parse validates
    for (const t of tries) {
      const p = parseMRZ(t.lines, t.format);
      if (p && p.valid) return t;
    }
    return tries[0];
  }

  /* ----------------------------------------------------------------------
     6. MRZ parser — TD1, TD2, TD3, old French CNI (2×36)
     ---------------------------------------------------------------------- */
  function detectFormat(lines) {
    if (lines.length === 3) return 'TD1';
    if (lines.length === 2) {
      const L = Math.max(lines[0].length, lines[1].length);
      if (L >= 40) return 'TD3';
      if (lines[0].startsWith('IDFRA') && !/^[A-Z<]{2}FRA[A-Z<]{30}$/.test(lines[0].slice(0, 36)) || (lines[0].startsWith('IDFRA') && /^\d{4}/.test(lines[1]))) return 'FRCNI';
      return 'TD2';
    }
    return null;
  }
  function splitNames(nameField) {
    const parts = nameField.split('<<');
    const surname = (parts[0] || '').replace(/</g, ' ').trim();
    const given = (parts.slice(1).join(' ') || '').replace(/</g, ' ').replace(/\s+/g, ' ').trim();
    return { surname, given, truncated: nameField.length > 0 && nameField[nameField.length - 1] !== '<' };
  }
  // Alpha-only MRZ fields (issuer, nationality, names, sex) carry no check digit: map digit look-alikes back to letters.
  const DIGIT_TO_ALPHA = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z', '6': 'G', '4': 'A', '7': 'T', '3': 'B', '9': 'G' };
  function alphaFix(s) { return s.replace(/[0-9]/g, d => DIGIT_TO_ALPHA[d] || d); }
  function alphaZone(line, from, to, r, what) { const seg = line.slice(from, to); const fixed = alphaFix(seg); if (fixed !== seg) r.corrections.push({ field: what, from: seg, to: fixed, candidates: [fixed], kind: 'alpha-normalisation' }); return line.slice(0, from) + fixed + line.slice(to); }
  function parseMRZ(linesIn, formatHint, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    let lines = (Array.isArray(linesIn) ? linesIn : String(linesIn).split(/\r?\n/)).map(normalizeLine).filter(Boolean);
    const format = formatHint || detectFormat(lines);
    if (!format) return null;
    const len = { TD1: 30, TD2: 36, TD3: 44, FRCNI: 36 }[format];
    lines = lines.map(l => fitLength(l, len));
    const r = { format, lines, fields: {}, checks: {}, corrections: [], warnings: [], valid: false };
    // alpha-only zones
    if (format === 'TD3') { lines[0] = alphaZone(alphaZone(lines[0], 2, 5, r, 'issuer'), 5, 44, r, 'names'); lines[1] = alphaZone(lines[1], 10, 13, r, 'nationality'); }
    else if (format === 'TD2') { lines[0] = alphaZone(alphaZone(lines[0], 2, 5, r, 'issuer'), 5, 36, r, 'names'); lines[1] = alphaZone(lines[1], 10, 13, r, 'nationality'); }
    else if (format === 'TD1') { lines[0] = alphaZone(lines[0], 2, 5, r, 'issuer'); lines[1] = alphaZone(lines[1], 15, 18, r, 'nationality'); lines[2] = alphaZone(lines[2], 0, 30, r, 'names'); }
    else if (format === 'FRCNI') { lines[0] = alphaZone(lines[0], 0, 30, r, 'names'); lines[1] = alphaZone(lines[1], 13, 27, r, 'names'); }
    r.lines = lines;
    const F = r.fields;
    const fix = (name, field, cd, allowed) => {
      const c = correctField(field, cd, allowed);
      r.checks[name] = c.corrected ? 'corrected' : (c.failed ? 'fail' : 'pass');
      if (c.corrected) r.corrections.push({ field: name, from: field, to: c.value, candidates: c.candidates });
      return c.value;
    };
    const unpad = s => s.replace(/</g, '');
    let compositeStr = '', compositeCd = '';

    if (format === 'TD3') {
      const [l1, l2] = lines;
      F.documentType = unpad(l1.slice(0, 2)) || 'P';
      F.documentCode = l1.slice(0, 2);
      F.issuer = l1.slice(2, 5);
      Object.assign(F, splitNames(l1.slice(5, 44)));
      let doc = l2.slice(0, 9); const docCd = l2[9];
      doc = fix('documentNumber', doc, docCd, /[A-Z0-9<]/);
      F.documentNumber = unpad(doc);
      F.nationality = l2.slice(10, 13);
      let dob = fix('dateOfBirth', l2.slice(13, 19), l2[19], /[0-9<]/);
      F.sex = l2[20];
      let exp = fix('dateOfExpiry', l2.slice(21, 27), l2[27], /[0-9]/);
      let opt = l2.slice(28, 42); const optCd = l2[42];
      if (!/^<+$/.test(opt) || optCd !== '<') opt = fix('optionalData', opt, optCd, /[A-Z0-9<]/); else r.checks.optionalData = 'pass';
      F.optionalData = unpad(opt);
      compositeStr = doc + docCd + dob + l2[19] + exp + l2[27] + opt + optCd;
      compositeCd = l2[43];
      F.dateOfBirth = parseMrzDate(dob, 'dob', now);
      F.dateOfExpiry = parseMrzDate(exp, 'exp', now);
    } else if (format === 'TD2') {
      const [l1, l2] = lines;
      F.documentType = unpad(l1.slice(0, 2)); F.documentCode = l1.slice(0, 2);
      F.issuer = l1.slice(2, 5);
      Object.assign(F, splitNames(l1.slice(5, 36)));
      let doc = fix('documentNumber', l2.slice(0, 9), l2[9], /[A-Z0-9<]/);
      F.documentNumber = unpad(doc);
      F.nationality = l2.slice(10, 13);
      let dob = fix('dateOfBirth', l2.slice(13, 19), l2[19], /[0-9<]/);
      F.sex = l2[20];
      let exp = fix('dateOfExpiry', l2.slice(21, 27), l2[27], /[0-9]/);
      F.optionalData = unpad(l2.slice(28, 35));
      compositeStr = doc + l2[9] + dob + l2[19] + exp + l2[27] + l2.slice(28, 35);
      compositeCd = l2[35];
      F.dateOfBirth = parseMrzDate(dob, 'dob', now);
      F.dateOfExpiry = parseMrzDate(exp, 'exp', now);
    } else if (format === 'TD1') {
      const [l1, l2, l3] = lines;
      F.documentType = unpad(l1.slice(0, 2)); F.documentCode = l1.slice(0, 2);
      F.issuer = l1.slice(2, 5);
      let doc = fix('documentNumber', l1.slice(5, 14), l1[14], /[A-Z0-9<]/);
      F.documentNumber = unpad(doc);
      F.optionalData = unpad(l1.slice(15, 30));
      let dob = fix('dateOfBirth', l2.slice(0, 6), l2[6], /[0-9<]/);
      F.sex = l2[7];
      let exp = fix('dateOfExpiry', l2.slice(8, 14), l2[14], /[0-9]/);
      F.nationality = l2.slice(15, 18);
      F.optionalData2 = unpad(l2.slice(18, 29));
      Object.assign(F, splitNames(l3));
      compositeStr = doc + l1[14] + l1.slice(15, 30) + dob + l2[6] + exp + l2[14] + l2.slice(18, 29);
      compositeCd = l2[29];
      F.dateOfBirth = parseMrzDate(dob, 'dob', now);
      F.dateOfExpiry = parseMrzDate(exp, 'exp', now);
    } else if (format === 'FRCNI') {
      const [l1, l2] = lines;
      F.documentType = 'ID'; F.documentCode = l1.slice(0, 2); F.issuer = l1.slice(2, 5); F.nationality = 'FRA';
      F.surname = l1.slice(5, 30).replace(/</g, ' ').trim();
      F.adminCode = unpad(l1.slice(30, 36));
      const issue = l2.slice(0, 4), dept = l2.slice(4, 7), office = l2.slice(7, 12);
      const docField = fix('documentNumber', l2.slice(0, 12), l2[12], /[A-Z0-9]/);
      F.documentNumber = docField;
      F.issueYYMM = issue; F.department = dept; F.office = office;
      F.given = l2.slice(13, 27).replace(/</g, ' ').replace(/\s+/g, ' ').trim();
      let dob = fix('dateOfBirth', l2.slice(27, 33), l2[33], /[0-9]/);
      F.sex = l2[34];
      F.dateOfBirth = parseMrzDate(dob, 'dob', now);
      // Old CNI: valid 10 years from issue (15 for adults issued 2004-2013, handled as note)
      const iy = parseInt(issue.slice(0, 2), 10); const im = parseInt(issue.slice(2, 4), 10);
      if (!isNaN(iy) && !isNaN(im)) {
        let year = 2000 + iy; if (year > now.getFullYear()) year -= 100;
        F.dateOfIssue = { year, month: im, day: null, iso: year + '-' + String(im).padStart(2, '0') + '-XX', display: year + '-' + String(im).padStart(2, '0'), valid: true };
        F.dateOfExpiry = { year: year + 10, month: im, day: null, iso: (year + 10) + '-' + String(im).padStart(2, '0') + '-XX', display: (year + 10) + '-' + String(im).padStart(2, '0') + ' (derived: issue + 10y)', valid: true, derived: true };
        r.warnings.push('Old-format French CNI: expiry derived from issue date (+10 years; +15 years for adults issued 2004–2013).');
      }
      compositeStr = l1 + l2.slice(0, 35);
      compositeCd = l2[35];
    }

    // Composite check
    if (compositeStr) {
      const ok = cdOk(compositeStr, compositeCd);
      r.checks.composite = ok ? 'pass' : 'fail';
      if (!ok && r.corrections.length) {
        // try alternative candidates for corrected fields that satisfy the composite
        for (const corr of r.corrections) {
          for (const alt of corr.candidates) {
            const altV = alt.split('|')[0];
            const s2 = compositeStr.replace(corr.to, altV);
            if (cdOk(s2, compositeCd)) { compositeStr = s2; corr.to = altV; r.checks.composite = 'pass'; break; }
          }
          if (r.checks.composite === 'pass') break;
        }
      }
    }
    // Final values after any composite-driven alternatives
    for (const c of r.corrections) {
      if (c.field === 'documentNumber') F.documentNumber = unpad(c.to);
      if (c.field === 'dateOfBirth') F.dateOfBirth = parseMrzDate(c.to, 'dob', now);
      if (c.field === 'dateOfExpiry') F.dateOfExpiry = parseMrzDate(c.to, 'exp', now);
    }

    // Semantic checks and warnings
    F.issuerName = countryName(F.issuer);
    F.nationalityName = countryName(F.nationality);
    if (!countryKnown(F.issuer)) r.warnings.push('Issuer code "' + unpad(F.issuer) + '" not in the ICAO/ISO table.');
    if (F.nationality && /^XX[ABCX]$/.test(F.nationality)) r.warnings.push('Special nationality code: ' + F.nationalityName + '.');
    if (F.issuer === 'D<<') r.warnings.push('Issuer "D<" is the ICAO code for Germany (not DEU).');
    if (/^UN[OAK]$/.test(F.issuer)) r.warnings.push('Non-state issuer: ' + F.issuerName + '.');
    if (F.sex && !/[MF<X]/.test(F.sex)) r.warnings.push('Unexpected sex marker "' + F.sex + '".');
    F.sexDisplay = { M: 'Male', F: 'Female', '<': 'Unspecified', X: 'Unspecified' }[F.sex] || F.sex;
    if (F.dateOfBirth && F.dateOfBirth.unknown) r.warnings.push('Date of birth marked unknown on the document (accepted).');
    if (F.dateOfBirth && F.dateOfBirth.future) r.warnings.push('Date of birth resolves to the future — century inference failed or digits misread.');
    if (F.truncated) r.warnings.push('Name field appears truncated in the MRZ; use the visual zone for the full name.');
    if (F.dateOfExpiry) F.expiryStatus = expiryStatus(F.dateOfExpiry, now);
    if (F.documentCode) {
      const t = F.documentCode;
      F.documentTypeName = t[0] === 'P' ? (t[1] === 'D' ? 'Diplomatic passport' : t[1] === 'O' ? 'Official/Service passport' : 'Passport')
        : t[0] === 'I' ? 'Identity card' : t[0] === 'A' ? 'Residence/Crew document' : t[0] === 'C' ? 'Residence permit / card' : t[0] === 'V' ? 'Visa' : 'Document (' + unpad(t) + ')';
    }
    const vals = Object.values(r.checks);
    r.valid = vals.length > 0 && vals.every(v => v === 'pass' || v === 'corrected');
    r.clean = vals.every(v => v === 'pass');
    return r;
  }

  /* ----------------------------------------------------------------------
     7. BAC key derivation (ICAO 9303 Part 11) — for a native NFC companion
     ---------------------------------------------------------------------- */
  function mrzInformation(fields, lines, format) {
    // document number (9, padded) + cd, DOB (6) + cd, expiry (6) + cd — taken from the raw MRZ
    let doc, docCd, dob, dobCd, exp, expCd;
    if (format === 'TD3' || format === 'TD2') {
      const l2 = lines[1]; doc = l2.slice(0, 9); docCd = l2[9]; dob = l2.slice(13, 19); dobCd = l2[19]; exp = l2.slice(21, 27); expCd = l2[27];
    } else if (format === 'TD1') {
      const l1 = lines[0], l2 = lines[1]; doc = l1.slice(5, 14); docCd = l1[14]; dob = l2.slice(0, 6); dobCd = l2[6]; exp = l2.slice(8, 14); expCd = l2[14];
    } else return null;
    return doc + docCd + dob + dobCd + exp + expCd;
  }
  function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  function adjustParity(bytes) {
    return bytes.map(b => { let x = b & 0xFE, p = 0; for (let i = 1; i < 8; i++) p ^= (x >> i) & 1; return x | (p ? 0 : 1); });
  }
  async function deriveBacKeys(info) {
    if (!info) return null;
    const subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
    let sha1;
    if (subtle) sha1 = async (bytes) => new Uint8Array(await subtle.digest('SHA-1', new Uint8Array(bytes)));
    else if (typeof require === 'function') { const nc = require('crypto'); sha1 = async (bytes) => new Uint8Array(nc.createHash('sha1').update(Buffer.from(bytes)).digest()); }
    else return { mrzInformation: info, error: 'No SHA-1 implementation available' };
    const enc = [...info].map(c => c.charCodeAt(0));
    const kseed = (await sha1(enc)).slice(0, 16);
    const kd = async (c) => adjustParity([...(await sha1([...kseed, 0, 0, 0, c])).slice(0, 16)]);
    const kenc = await kd(1), kmac = await kd(2);
    return { mrzInformation: info, kSeed: hex(kseed), kEnc: hex(new Uint8Array(kenc)), kMac: hex(new Uint8Array(kmac)), note: 'Keys per ICAO 9303-11 §4.3 (3DES). Use with a native NFC reader; the browser cannot run ISO 14443-4 APDUs.' };
  }

  /* ----------------------------------------------------------------------
     8. AAMVA PDF417 (North American driver licences / ID cards)
     ---------------------------------------------------------------------- */
  const AAMVA_FIELDS = {
    DCS: 'surname', DAC: 'given', DAD: 'middleName', DCT: 'givenCombined', DBB: 'dateOfBirth', DBA: 'dateOfExpiry', DBD: 'dateOfIssue',
    DAQ: 'documentNumber', DBC: 'sex', DAG: 'address', DAI: 'city', DAJ: 'state', DAK: 'postalCode', DAU: 'height', DAY: 'eyeColour',
    DCG: 'country', DCF: 'discriminator', DCA: 'vehicleClass', DCB: 'restrictions', DCD: 'endorsements', DDE: 'surnameTruncated', DDF: 'givenTruncated', DAZ: 'hairColour', DCK: 'inventoryControl', DDB: 'cardRevisionDate', DDA: 'complianceType', DAW: 'weightLb', DCL: 'race'
  };
  function parseAAMVA(text) {
    const s = String(text || '');
    const hdr = s.indexOf('ANSI ');
    if (hdr < 0 && !/\bDAQ|DCS|DBB/.test(s)) return null;
    const out = { raw: s, fields: {}, elements: {}, format: 'AAMVA PDF417' };
    if (hdr >= 0) {
      out.iin = s.substr(hdr + 5, 6); out.version = s.substr(hdr + 11, 2);
      out.issuerName = { '636014': 'California', '636001': 'New York', '636015': 'Texas', '636010': 'Florida', '636012': 'Ontario', '636026': 'Arizona', '636035': 'Illinois', '636042': 'Washington', '636053': 'Colorado', '636003': 'Ohio', '636022': 'Georgia', '636023': 'Pennsylvania', '636004': 'Michigan', '636048': 'New Jersey', '636005': 'Massachusetts', '636028': 'British Columbia', '636016': 'Quebec', '636013': 'Alberta' }[out.iin] || ('IIN ' + out.iin);
    }
    // Known element codes first (handles the "DL"/"ID" subfile designator glued to the first element, e.g. "DLDAQ...")
    const known = Object.keys(AAMVA_FIELDS).join('|');
    const re = new RegExp('(' + known + '|Z[A-Z]{2}|D[A-Z]{2})([^\\n\\r\\x1e\\x1d]*)', 'g'); let m;
    let body = hdr >= 0 ? s.slice(hdr) : s;
    // Skip the header + subfile directory: data starts at the "DL"/"ID" designator immediately followed by the first element
    const start = body.search(/(DL|ID)(?=(DAQ|DCS|DAC|DBB|DBA|DCG|DBC|DAG|DBD|DCA|DCT))/);
    if (start >= 0) body = body.slice(start + 2);
    while ((m = re.exec(body))) { const k = m[1], v = m[2].trim(); if (!(k in out.elements)) out.elements[k] = v; if (AAMVA_FIELDS[k] && !(AAMVA_FIELDS[k] in out.fields)) out.fields[AAMVA_FIELDS[k]] = v; }
    const d8 = (v) => { if (!v) return null; v = v.replace(/\D/g, ''); if (v.length !== 8) return { raw: v, display: v };
      // US: MMDDCCYY ; Canada: CCYYMMDD
      let y, mo, d; if (/^(19|20)\d{2}/.test(v)) { y = +v.slice(0, 4); mo = +v.slice(4, 6); d = +v.slice(6, 8); } else { mo = +v.slice(0, 2); d = +v.slice(2, 4); y = +v.slice(4, 8); }
      return { raw: v, year: y, month: mo, day: d, iso: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'), display: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'), valid: mo >= 1 && mo <= 12 && d >= 1 && d <= 31 }; };
    for (const k of ['dateOfBirth', 'dateOfExpiry', 'dateOfIssue']) if (out.fields[k]) out.fields[k] = d8(out.fields[k]);
    if (out.fields.sex) out.fields.sexDisplay = { '1': 'Male', '2': 'Female', '9': 'Unspecified', M: 'Male', F: 'Female' }[out.fields.sex] || out.fields.sex;
    if (out.fields.dateOfExpiry) out.fields.expiryStatus = expiryStatus(out.fields.dateOfExpiry);
    return out;
  }

  /* ----------------------------------------------------------------------
     9. Visual-zone field heuristics (label → value) from OCR word boxes
     words: [{text, x0,y0,x1,y1, conf}]
     ---------------------------------------------------------------------- */
  const LABELS = [
    { key: 'surname', re: /^(SURNAME|SURNAMES|FAMILYNAME|LASTNAME|NOM|NOMS|APELLIDOS?|COGNOME|NACHNAME|NAAM|APELIDO|SOBRENOME|LASTNM|LN)$/ },
    { key: 'given', re: /^(GIVENNAMES?|GIVENNAME|FORENAMES?|FIRSTNAMES?|PRENOMS?|NOMBRES?|NOME|VORNAMEN?|VOORNAMEN|FIRSTNM|FN)$/ },
    { key: 'name', re: /^(NAME|FULLNAME|NAMES|HOLDER)$/ },
    { key: 'dateOfBirth', re: /^(DATEOFBIRTH|DOB|BIRTHDATE|BIRTH|DATEDENAISSANCE|FECHADENACIMIENTO|NACIMIENTO|GEBURTSDATUM|DATADINASCITA|NASCITA|GEBOORTEDATUM|BORN)$/ },
    { key: 'dateOfExpiry', re: /^(DATEOFEXPIRY|DATEOFEXPIRATION|EXPIRY|EXPIRES|EXP|EXPIRATION|EXPIRYDATE|DATEDEXPIRATION|FECHADECADUCIDAD|CADUCIDAD|VALIDUNTIL|VALIDTHROUGH|GULTIGBIS|VALABLEJUSQUAU|DATADISCADENZA|VENCIMIENTO|VALIDTO)$/ },
    { key: 'dateOfIssue', re: /^(DATEOFISSUE|ISSUED|ISSUE|ISS|ISSUEDATE|DATEDEDELIVRANCE|FECHADEEXPEDICION|EXPEDICION|AUSSTELLUNGSDATUM|DATADIRILASCIO|RILASCIO|VALIDFROM)$/ },
    { key: 'documentNumber', re: /^(PASSPORTNO|PASSPORTNUMBER|DOCUMENTNO|DOCUMENTNUMBER|IDNUMBER|IDNO|NO|NUMBER|NUMERO|NUMERODEPASSEPORT|NUMERODEPASAPORTE|DLNO|DL|LIC|LICENSENO|LICENCENO|LICENCENUMBER|CARDNO|CARDNUMBER|NUM|NR|IDENTITYNO|PASSEPORTNO|PERSONALNO|PERSONALNUMBER)$/ },
    { key: 'nationality', re: /^(NATIONALITY|NATIONALITE|NACIONALIDAD|STAATSANGEHORIGKEIT|CITTADINANZA|NATIONALITEIT|CITIZENSHIP)$/ },
    { key: 'sex', re: /^(SEX|SEXE|SEXO|GENDER|GESCHLECHT|SESSO|GESLACHT)$/ },
    { key: 'placeOfBirth', re: /^(PLACEOFBIRTH|LIEUDENAISSANCE|LUGARDENACIMIENTO|GEBURTSORT|LUOGODINASCITA|BIRTHPLACE|POB)$/ },
    { key: 'address', re: /^(ADDRESS|ADRESSE|DIRECCION|ANSCHRIFT|INDIRIZZO|ADRES|RESIDENCE)$/ },
    { key: 'issuingAuthority', re: /^(AUTHORITY|ISSUINGAUTHORITY|AUTORITE|AUTORIDAD|BEHORDE|AUTORITA)$/ },
    { key: 'height', re: /^(HEIGHT|HGT|TAILLE|ESTATURA|GROSSE|STATURA)$/ },
    { key: 'eyes', re: /^(EYES|EYECOLOUR|EYECOLOR|YEUX|OJOS|AUGEN)$/ }
  ];
  const DATE_RE = /^(\d{1,2})[\/\-. ](\d{1,2}|[A-ZÀ-Ü]{3})[\/\-. ](\d{2,4})$|^(\d{4})[\/\-.](\d{2})[\/\-.](\d{2})$|^(\d{1,2})\s?([A-ZÀ-Ü]{3,4})(?:\s?\/\s?[A-ZÀ-Ü]{3,5})?\s?(\d{2,4})$/i;
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12, JANV: 1, FEV: 2, FÉV: 2, MARS: 3, AVR: 4, MAI: 5, JUIN: 6, JUIL: 7, AOU: 8, AOÛ: 8, SEPT: 9, DÉC: 12, ENE: 1, ABR: 4, AGO: 8, DIC: 12, MRZ: 3, OKT: 10, DEZ: 12 };
  function normLabel(t) { return String(t || '').toUpperCase().replace(/[^A-Z]/g, ''); }
  /** Reject values that cannot be right for the field (OCR noise from the other language, stray glyphs) */
  function validValue(key, v) {
    const t = String(v || '').trim();
    if (key === 'sex') return /^(M|F|X|MALE|FEMALE|HOMME|FEMME|MASCULINO|FEMENINO|M\/M|F\/F)\b/i.test(t);
    if (key === 'dateOfBirth' || key === 'dateOfExpiry' || key === 'dateOfIssue') return !!parseVzDate(t.split(/\s{2,}/)[0]) || /\d{2}.*\d{2,4}/.test(t);
    if (key === 'documentNumber') return (t.replace(/[^A-Z0-9]/gi, '').length >= 5) && /\d{2}/.test(t);
    if (key === 'nationality' || key === 'surname' || key === 'given' || key === 'name' || key === 'placeOfBirth' || key === 'issuingAuthority') return /[A-Z]{2,}/i.test(t) && (t.replace(/[^A-Z]/gi, '').length / Math.max(1, t.replace(/\s/g, '').length)) > 0.6;
    return t.length >= 2;
  }
  function parseVzDate(text, prefer) {
    const t = String(text || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const m = t.match(DATE_RE); if (!m) return null;
    let d, mo, y;
    if (m[4]) { y = +m[4]; mo = +m[5]; d = +m[6]; }
    else if (m[7]) { d = +m[7]; mo = MONTHS[m[8].toUpperCase()] || 0; y = +m[9]; }
    else { const a = +m[1], b = /^\d+$/.test(m[2]) ? +m[2] : (MONTHS[m[2].toUpperCase()] || 0); y = +m[3];
      if (/^\d+$/.test(m[2])) { if (a > 12 && b <= 12) { d = a; mo = b; } else if (b > 12 && a <= 12) { mo = a; d = b; } else if (prefer === 'MDY') { mo = a; d = b; } else { d = a; mo = b; } } else { d = a; mo = b; } }
    if (y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    return { year: y, month: mo, day: d, iso: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'), display: y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0'), valid: true, raw: text };
  }
  /** Group OCR words into lines by vertical overlap */
  function groupLines(words) {
    const ws = words.filter(w => w.text && w.text.trim()).slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const lines = [];
    for (const w of ws) {
      const h = w.y1 - w.y0; let placed = false;
      for (const L of lines) { const cy = (L.y0 + L.y1) / 2; if (Math.abs((w.y0 + w.y1) / 2 - cy) < Math.max(h, L.y1 - L.y0) * 0.55) { L.words.push(w); L.y0 = Math.min(L.y0, w.y0); L.y1 = Math.max(L.y1, w.y1); placed = true; break; } }
      if (!placed) lines.push({ y0: w.y0, y1: w.y1, words: [w] });
    }
    for (const L of lines) { L.words.sort((a, b) => a.x0 - b.x0); L.text = L.words.map(w => w.text).join(' '); L.x0 = Math.min(...L.words.map(w => w.x0)); L.x1 = Math.max(...L.words.map(w => w.x1)); }
    return lines.sort((a, b) => a.y0 - b.y0);
  }
  function extractVisualFields(words, opts) {
    opts = opts || {};
    const prefer = opts.datePreference || 'DMY';
    const lines = groupLines(words);
    const found = {};
    const lineH = lines.length ? lines.reduce((a, L) => a + (L.y1 - L.y0), 0) / lines.length : 20;
    // Pass 1: labels then value below / to the right
    lines.forEach((L, li) => {
      // bilingual labels ('Surname/Nom', 'Date of birth/Date de naissance'): match on the segment before the slash
      const toks = L.words.map(w => ({ w, n: normLabel(String(w.text).split('/')[0]) }));
      for (let i = 0; i < toks.length; i++) {
        for (let span = 3; span >= 1; span--) {
          if (i + span > toks.length) continue;
          const n = toks.slice(i, i + span).map(t => t.n).join('');
          const hit = LABELS.find(l => l.re.test(n)); if (!hit || found[hit.key]) continue;
          const lx0 = toks[i].w.x0, lx1 = toks[i + span - 1].w.x1, ly1 = toks[i + span - 1].w.y1;
          // same-line remainder: only words adjacent to the label (gap < 3 line-heights) and not themselves a label
          const after = toks.slice(i + span);
          const rest = [];
          let prevX1 = lx1;
          for (const t2 of after) { if (t2.w.x0 - prevX1 > lineH * 3) break; rest.push(t2.w); prevX1 = t2.w.x1; }
          const isLabelStart = (ws) => { for (let sp = 3; sp >= 1; sp--) { if (ws.length < sp) continue; const nn = ws.slice(0, sp).map(w => normLabel(String(w.text).split('/')[0])).join(''); if (LABELS.some(l => l.re.test(nn))) return true; } return false; };
          let value = null, box = null;
          const restTxt = rest.map(w => w.text).join(' ').replace(/^[:.\-\s]+/, '').trim();
          const slashJunk = rest.length && (/^\//.test(rest[0].text) || /\/[^\s]*$/.test(toks[i + span - 1].w.text) && rest.length && !/[A-Z0-9]{3,}/i.test(restTxt));
          if (restTxt && !isLabelStart(rest) && !slashJunk && validValue(hit.key, restTxt)) { value = restTxt; box = bbox(rest); }
          else {
            // next 1–2 lines, horizontally overlapping the label
            for (let k = li + 1; k < Math.min(lines.length, li + 3) && !value; k++) {
              const N = lines[k]; if (N.y0 - ly1 > lineH * 2.2) break;
              const cand = N.words.filter(w => w.x1 > lx0 - lineH * 1.5 && w.x0 < lx1 + lineH * 6);
              const txt = cand.map(w => w.text).join(' ').trim();
              if (txt && !isLabelStart(cand) && validValue(hit.key, txt)) { value = txt; box = bbox(cand); }
            }
          }
          if (value) { found[hit.key] = { value, box, conf: avgConf(rest.length ? rest : []), source: 'label' }; i += span - 1; break; }
        }
      }
    });
    // Pass 2: standalone dates in reading order (DOB < issue < expiry by chronology)
    const dates = [];
    for (const L of lines) {
      const joined = L.text.replace(/\s+\/\s+/g, '/');
      const parts = joined.split(/\s{1,}/);
      for (let i = 0; i < parts.length; i++) for (let span = 3; span >= 1; span--) { const t = parts.slice(i, i + span).join(' '); const d = parseVzDate(t, prefer); if (d) { dates.push({ d, L }); i += span - 1; break; } }
    }
    for (const k of ['dateOfBirth', 'dateOfExpiry', 'dateOfIssue']) if (found[k] && typeof found[k].value === 'string') { const d = parseVzDate(found[k].value, prefer); if (d) found[k].date = d; }
    if (dates.length) {
      const sorted = dates.slice().sort((a, b) => a.d.iso.localeCompare(b.d.iso));
      if (!found.dateOfBirth) found.dateOfBirth = { value: sorted[0].d.display, date: sorted[0].d, box: lineBox(sorted[0].L), source: 'chronology', conf: 50 };
      if (!found.dateOfExpiry && sorted.length > 1) found.dateOfExpiry = { value: sorted[sorted.length - 1].d.display, date: sorted[sorted.length - 1].d, box: lineBox(sorted[sorted.length - 1].L), source: 'chronology', conf: 50 };
      if (!found.dateOfIssue && sorted.length > 2) found.dateOfIssue = { value: sorted[1].d.display, date: sorted[1].d, box: lineBox(sorted[1].L), source: 'chronology', conf: 40 };
    }
    return { fields: found, lines };
  }
  function bbox(ws) { if (!ws || !ws.length) return null; return { x0: Math.min(...ws.map(w => w.x0)), y0: Math.min(...ws.map(w => w.y0)), x1: Math.max(...ws.map(w => w.x1)), y1: Math.max(...ws.map(w => w.y1)) }; }
  function lineBox(L) { return { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 }; }
  function avgConf(ws) { if (!ws.length) return 0; return ws.reduce((a, w) => a + (w.conf || 0), 0) / ws.length; }

  /** Find a value string in OCR words (fuzzy) → bounding box */
  function levenshtein(a, b) { const m = a.length, n = b.length; if (!m) return n; if (!n) return m; let prev = Array.from({ length: n + 1 }, (_, i) => i); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
  function similarity(a, b) { a = normLabelNum(a); b = normLabelNum(b); if (!a.length || !b.length) return 0; return 1 - levenshtein(a, b) / Math.max(a.length, b.length); }
  function normLabelNum(t) { return String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function locateValue(words, value, minSim) {
    minSim = minSim || 0.75; const v = normLabelNum(value); if (v.length < 3) return null;
    let best = null;
    const lines = groupLines(words);
    for (const L of lines) {
      for (let i = 0; i < L.words.length; i++) for (let span = 1; span <= Math.min(4, L.words.length - i); span++) {
        const ws = L.words.slice(i, i + span); const t = ws.map(w => w.text).join('');
        const s = similarity(t, v); if (s >= minSim && (!best || s > best.sim)) best = { sim: s, box: bbox(ws), text: ws.map(w => w.text).join(' ') };
      }
    }
    return best;
  }

  /* ----------------------------------------------------------------------
     10. Image analysis (ImageData based, no DOM): luminance, glare, blur,
         card rectangle, skew, skin zone, saturation, copy/screen heuristics
     ---------------------------------------------------------------------- */
  function toGray(img) {
    const { data, width, height } = img; const g = new Float32Array(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return { g, width, height };
  }
  function meanLuminance(gray, rect) {
    const { g, width } = gray; const r = rect || { x: 0, y: 0, w: width, h: gray.height }; let s = 0, n = 0;
    for (let y = r.y; y < r.y + r.h; y += 2) for (let x = r.x; x < r.x + r.w; x += 2) { s += g[y * width + x]; n++; }
    return n ? s / n : 0;
  }
  function laplacianVariance(gray, rect) {
    const { g, width, height } = gray; const r = rect || { x: 1, y: 1, w: width - 2, h: height - 2 };
    let s = 0, s2 = 0, n = 0;
    const x0 = Math.max(1, r.x), y0 = Math.max(1, r.y), x1 = Math.min(width - 1, r.x + r.w), y1 = Math.min(height - 1, r.y + r.h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * width + x; const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - width] - g[i + width]; s += v; s2 += v * v; n++; }
    if (!n) return 0; const m = s / n; return s2 / n - m * m;
  }
  function glareAnalysis(img, rect) {
    const { data, width, height } = img; const r = rect || { x: 0, y: 0, w: width, h: height };
    const B = 16; const bx = Math.max(1, Math.floor(r.w / B)), by = Math.max(1, Math.floor(r.h / B));
    const blocks = []; let glareBlocks = 0;
    for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
      let hot = 0, n = 0;
      for (let y = r.y + j * B; y < r.y + (j + 1) * B && y < height; y += 2) for (let x = r.x + i * B; x < r.x + (i + 1) * B && x < width; x += 2) { const k = (y * width + x) * 4; if (data[k] > 250 && data[k + 1] > 250 && data[k + 2] > 250) hot++; n++; }
      const f = n ? hot / n : 0; if (f > 0.6) { glareBlocks++; blocks.push({ i, j, f }); }
    }
    const total = bx * by; const frac = total ? glareBlocks / total : 0;
    let region = null, onMrz = false;
    if (blocks.length) {
      const cx = blocks.reduce((a, b) => a + b.i, 0) / blocks.length / bx, cy = blocks.reduce((a, b) => a + b.j, 0) / blocks.length / by;
      region = (cy < 0.33 ? 'top' : cy > 0.66 ? 'bottom' : 'middle') + '-' + (cx < 0.33 ? 'left' : cx > 0.66 ? 'right' : 'centre');
      onMrz = blocks.filter(b => b.j / by > 0.68).length > Math.max(2, 0.02 * total);
    }
    return { fraction: frac, region, onMrz, blocks: glareBlocks };
  }
  function sobel(gray) {
    const { g, width, height } = gray; const mag = new Float32Array(width * height); const ang = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = -g[i - width - 1] + g[i - width + 1] - 2 * g[i - 1] + 2 * g[i + 1] - g[i + width - 1] + g[i + width + 1];
      const gy = -g[i - width - 1] - 2 * g[i - width] - g[i - width + 1] + g[i + width - 1] + 2 * g[i + width] + g[i + width + 1];
      mag[i] = Math.hypot(gx, gy); ang[i] = Math.atan2(gy, gx);
    }
    return { mag, ang, width, height };
  }
  /** Project edge energy onto rows/columns to find the strongest rectangle. Returns {x,y,w,h,confidence} or null */
  function detectCardRect(gray, opts) {
    opts = opts || {};
    const { width, height } = gray; const sb = sobel(gray);
    const col = new Float32Array(width), row = new Float32Array(height);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) { const m = sb.mag[y * width + x]; if (m > 40) { const a = Math.abs(sb.ang[y * width + x]); const vert = a < 0.5 || a > Math.PI - 0.5; if (vert) col[x] += m; else if (Math.abs(a - Math.PI / 2) < 0.5) row[y] += m; } }
    const smooth = (arr, k) => { const out = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) { let s = 0, n = 0; for (let j = -k; j <= k; j++) { const t = i + j; if (t >= 0 && t < arr.length) { s += arr[t]; n++; } } out[i] = s / n; } return out; };
    const cs = smooth(col, 2), rs = smooth(row, 2);
    const peak = (arr, from, to) => { let bi = -1, bv = 0; for (let i = from; i < to; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; } return { i: bi, v: bv }; };
    const cmax = Math.max(...cs), rmax = Math.max(...rs); if (cmax <= 0 || rmax <= 0) return null;
    const L = peak(cs, 0, Math.floor(width * 0.45)), R = peak(cs, Math.ceil(width * 0.55), width);
    const T = peak(rs, 0, Math.floor(height * 0.45)), Bt = peak(rs, Math.ceil(height * 0.55), height);
    const thr = 0.18;
    const conf = Math.min(L.v / cmax, R.v / cmax, T.v / rmax, Bt.v / rmax);
    if (L.i < 0 || R.i < 0 || T.i < 0 || Bt.i < 0 || conf < thr) return null;
    const w = R.i - L.i, h = Bt.i - T.i; if (w < width * 0.1 || h < height * 0.08) return null;
    const aspect = w / h;
    // Edge geometry: top/bottom edge position measured separately over the left and right thirds of the card
    // → in-plane rotation (both edges slant the same way) and perspective tilt (left/right edge heights differ).
    const rowsIn = (x0, x1) => { const arr = new Float32Array(height); for (let y = 1; y < height - 1; y++) { let s = 0; for (let x = x0; x < x1; x++) { const i = y * width + x; const a = Math.abs(sb.ang[i]); if (sb.mag[i] > 40 && Math.abs(a - Math.PI / 2) < 0.6) s += sb.mag[i]; } arr[y] = s; } return smooth(arr, 2); };
    const third = Math.max(4, Math.floor(w / 3)); const lx0 = Math.max(1, L.i + 2), rx1 = Math.min(width - 1, R.i - 2);
    const rl = rowsIn(lx0, lx0 + third), rr = rowsIn(rx1 - third, rx1);
    const band = Math.max(6, Math.round(h * 0.18));
    const tL = peak(rl, Math.max(0, T.i - band), T.i + band), tR = peak(rr, Math.max(0, T.i - band), T.i + band);
    const bL = peak(rl, Bt.i - band, Math.min(height, Bt.i + band)), bR = peak(rr, Bt.i - band, Math.min(height, Bt.i + band));
    let rotationDeg = 0, tiltDeg = 0;
    if (tL.i >= 0 && tR.i >= 0 && bL.i >= 0 && bR.i >= 0 && tL.v > 0 && tR.v > 0 && bL.v > 0 && bR.v > 0) {
      const dx = (rx1 - third / 2) - (lx0 + third / 2);
      const slantT = Math.atan2(tR.i - tL.i, dx), slantB = Math.atan2(bR.i - bL.i, dx);
      rotationDeg = Math.abs((slantT + slantB) / 2) * 180 / Math.PI;
      // heights are sampled at 1/6 and 5/6 of the width; extrapolate linearly to the corners (0 and 1)
      const hA = bL.i - tL.i, hB = bR.i - tR.i; const slope = (hB - hA) / (4 / 6); const h0 = hA - slope / 6, h1 = hB + slope / 6;
      const ratio = Math.min(h0, h1) / Math.max(h0, h1);
      // assume card width ≈ half the camera distance: ratio = 1/(1+0.5·sinθ)
      const sinT = Math.max(0, Math.min(1, 2 * (1 / Math.max(0.3, ratio) - 1))); tiltDeg = Math.asin(sinT) * 180 / Math.PI;
      if (Math.abs(hA - hB) < 2) tiltDeg = 0;
    }
    return { x: L.i, y: T.i, w, h, aspect, confidence: Math.min(1, conf / 0.6), areaFraction: (w * h) / (width * height), edgeStrength: { left: L.v / cmax, right: R.v / cmax, top: T.v / rmax, bottom: Bt.v / rmax }, rotationDeg, tiltDeg };
  }
  /** Does card-like content run off the frame edge? For each side: the band just inside the detected edge, the band between
      that edge and the frame border, and the border strip itself must all share the same luminance (the card continues out of frame). */
  function borderOverflow(gray, rect) {
    const { g, width, height } = gray; if (!rect) return { any: false, sides: [] };
    const mean = (x0, y0, x1, y1) => { x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(width, Math.round(x1)); y1 = Math.min(height, Math.round(y1)); let s = 0, n = 0; for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { s += g[y * width + x]; n++; } return n ? s / n : NaN; };
    const t = Math.max(2, Math.round(Math.min(width, height) * 0.015)); const bw = Math.max(3, Math.round(Math.min(rect.w, rect.h) * 0.08));
    const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
    const sides = {
      right: [mean(x1 - bw, y0 + bw, x1, y1 - bw), mean(x1 + 2, y0 + bw, width - t, y1 - bw), mean(width - t, y0 + bw, width, y1 - bw), width - x1],
      left: [mean(x0, y0 + bw, x0 + bw, y1 - bw), mean(t, y0 + bw, x0 - 2, y1 - bw), mean(0, y0 + bw, t, y1 - bw), x0],
      bottom: [mean(x0 + bw, y1 - bw, x1 - bw, y1), mean(x0 + bw, y1 + 2, x1 - bw, height - t), mean(x0 + bw, height - t, x1 - bw, height), height - y1],
      top: [mean(x0 + bw, y0, x1 - bw, y0 + bw), mean(x0 + bw, t, x1 - bw, y0 - 2), mean(x0 + bw, 0, x1 - bw, t), y0]
    };
    const interior = mean(x0 + bw, y0 + bw, x1 - bw, y1 - bw);
    const opposite = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' };
    const over = [];
    for (const [k, [inside, between, border, gap]] of Object.entries(sides)) {
      if (gap < Math.min(width, height) * 0.04) continue; // too close to the frame edge: handled by the frame-margin test
      if ([between, border, interior].some(v => isNaN(v))) continue;
      const oppBorder = sides[opposite[k]][2];
      // the strip beyond the detected edge looks like card paper all the way to the frame border, and unlike the opposite border
      if (Math.abs(between - border) < 18 && Math.abs(border - interior) < 60 && (isNaN(oppBorder) || Math.abs(border - oppBorder) > 40)) over.push(k);
    }
    return { any: over.length > 0, sides: over, detail: sides, interior };
  }
  /** Dominant edge orientation deviation from axis (degrees) */
  function skewAngle(gray, rect) {
    const sb = sobel(gray); const { width } = gray; const r = rect || { x: 0, y: 0, w: gray.width, h: gray.height };
    const hist = new Float32Array(180);
    for (let y = r.y + 1; y < r.y + r.h - 1; y += 2) for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) { const i = y * width + x; if (sb.mag[i] > 60) { let d = (sb.ang[i] * 180 / Math.PI + 180) % 180; hist[Math.floor(d)] += sb.mag[i]; } }
    let best = 0, bv = -1; for (let d = 0; d < 180; d++) if (hist[d] > bv) { bv = hist[d]; best = d; }
    let dev = best % 90; if (dev > 45) dev = 90 - dev;
    return dev;
  }
  function skinFraction(img, rect) {
    const { data, width, height } = img; let skin = 0, n = 0;
    for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.h); y += 2) for (let x = Math.max(0, rect.x); x < Math.min(width, rect.x + rect.w); x += 2) {
      const k = (y * width + x) * 4; const r = data[k], g = data[k + 1], b = data[k + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b) skin++; n++;
    }
    return n ? skin / n : 0;
  }
  function meanSaturation(img, rect) {
    const { data, width, height } = img; const r = rect || { x: 0, y: 0, w: width, h: height }; let s = 0, n = 0;
    for (let y = r.y; y < Math.min(height, r.y + r.h); y += 3) for (let x = r.x; x < Math.min(width, r.x + r.w); x += 3) { const k = (y * width + x) * 4; const mx = Math.max(data[k], data[k + 1], data[k + 2]), mn = Math.min(data[k], data[k + 1], data[k + 2]); s += mx ? (mx - mn) / mx : 0; n++; }
    return n ? s / n : 0;
  }
  /** Periodic high-frequency energy (screen/moiré heuristic). Returns 0..1 */
  function periodicityScore(gray, rect) {
    const { g, width } = gray; const r = rect || { x: 0, y: 0, w: gray.width, h: gray.height };
    const rows = []; const step = Math.max(1, Math.floor(r.h / 24));
    for (let y = r.y + step; y < r.y + r.h - step; y += step) { const line = []; for (let x = r.x; x < r.x + r.w; x++) line.push(g[y * width + x]); rows.push(line); }
    let bestPeak = 0;
    for (const line of rows) {
      const n = line.length; if (n < 64) continue;
      const z = new Float32Array(n); const K = 5;
      for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = -K; j <= K; j++) { const t = i + j; if (t >= 0 && t < n) { s += line[t]; c++; } } z[i] = line[i] - s / c; }
      let r0 = 0; for (let i = 0; i < n; i++) r0 += z[i] * z[i]; if (r0 < n * 4) continue;
      let peak = 0;
      for (let lag = 3; lag <= 10; lag++) { let s = 0; for (let i = 0; i + lag < n; i++) s += z[i] * z[i + lag]; const c = s / r0; if (c > peak) peak = c; }
      if (peak > bestPeak) bestPeak = peak;
    }
    return Math.max(0, Math.min(1, bestPeak));
  }
  function frameDifference(grayA, grayB) {
    if (!grayA || !grayB || grayA.width !== grayB.width) return 0; let s = 0; const n = grayA.g.length;
    for (let i = 0; i < n; i += 4) s += Math.abs(grayA.g[i] - grayB.g[i]);
    return s / (n / 4);
  }

  /* ----------------------------------------------------------------------
     11. Quality check engine — returns the coaching messages
     ---------------------------------------------------------------------- */
  const DEFAULT_THRESHOLDS = { minLuminance: 85, maxLuminance: 240, minBlur: 90, maxGlare: 0.04, maxSkewDeg: 8, maxTiltDeg: 12, minAreaFraction: 0.22, maxAreaFraction: 0.95, maxMotion: 9, minSkin: 0.06, minCardConf: 0.35, frameMargin: 0.012 };
  function qualityChecks(img, prevGray, thresholds, opts) {
    const T = Object.assign({}, DEFAULT_THRESHOLDS, thresholds || {}); opts = opts || {};
    const gray = toGray(img); const W = img.width, H = img.height;
    const checks = []; const add = (id, pass, msg, severity, detail) => checks.push({ id, pass, msg, severity: severity || 'block', detail });
    const card = detectCardRect(gray);
    const cardOk = !!card && card.confidence >= T.minCardConf;
    let rect = cardOk ? card : null;
    const region = rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : { x: Math.floor(W * 0.1), y: Math.floor(H * 0.1), w: Math.floor(W * 0.8), h: Math.floor(H * 0.8) };
    // 1 card detected / in frame
    if (!cardOk) add('card', false, 'Fit the whole card inside the frame', 'block', card ? 'weak edges' : 'no rectangle');
    else {
      const m = T.frameMargin; const inside = rect.x > W * m && rect.y > H * m && rect.x + rect.w < W * (1 - m) && rect.y + rect.h < H * (1 - m);
      const bo = borderOverflow(gray, rect);
      if (!inside) add('card', false, 'Fit the whole card inside the frame', 'block', 'card touches the frame edge');
      else if (bo.any) add('card', false, 'Fit the whole card inside the frame', 'block', 'card runs off the ' + bo.sides.join('/') + ' edge');
      else add('card', true, 'Card detected');
      // 2 distance (skipped when the card is cut off — the rectangle is not the card)
      if (bo.any) { }
      else if (rect.areaFraction < T.minAreaFraction) add('distance', false, 'Move closer', 'block', (rect.areaFraction * 100).toFixed(0) + '% of frame');
      else if (rect.areaFraction > T.maxAreaFraction) add('distance', false, 'Move back', 'block');
      else add('distance', true, 'Distance OK');
    }
    // 3 light
    const lum = meanLuminance(gray, region);
    if (lum < T.minLuminance) add('light', false, 'More light needed', 'block', lum.toFixed(0));
    else if (lum > T.maxLuminance) add('light', false, 'Too bright, reduce light', 'block', lum.toFixed(0));
    else add('light', true, 'Lighting OK', 'ok', lum.toFixed(0));
    // 4 glare
    const gl = glareAnalysis(img, region);
    if (gl.onMrz && gl.fraction > T.maxGlare * 0.5) add('glare', false, 'Glare on bottom lines, tilt slightly', 'block', gl.region);
    else if (gl.fraction > T.maxGlare) add('glare', false, 'Glare detected (' + gl.region + '), tilt slightly', 'block', (gl.fraction * 100).toFixed(1) + '%');
    else add('glare', true, 'No glare', 'ok', (gl.fraction * 100).toFixed(1) + '%');
    // 5 blur
    const blur = laplacianVariance(gray, region);
    if (blur < T.minBlur) add('blur', false, 'Image is blurry', 'block', blur.toFixed(0));
    else add('blur', true, 'Sharp', 'ok', blur.toFixed(0));
    // 6 motion
    const motion = prevGray ? frameDifference(gray, prevGray) : 0;
    if (motion > T.maxMotion) add('motion', false, 'Hold still', 'block', motion.toFixed(1));
    else add('motion', true, 'Steady', 'ok', motion.toFixed(1));
    // 7 skew: in-plane rotation + perspective tilt from the card edges; gradient-orientation fallback without a card
    let skew, skewDetail;
    if (rect) { const rot = rect.rotationDeg || 0, tilt = rect.tiltDeg || 0; skew = Math.max(rot, tilt * (T.maxSkewDeg / T.maxTiltDeg)); skewDetail = 'rot ' + rot.toFixed(1) + '° · tilt ' + tilt.toFixed(0) + '°'; if (tilt > T.maxTiltDeg) add('skew', false, 'Hold the card flat and straight', tilt > T.maxTiltDeg * 2.8 ? 'block' : 'warn', skewDetail); else if (rot > T.maxSkewDeg) add('skew', false, 'Hold the card flat and straight', rot > 25 ? 'block' : 'warn', skewDetail); else add('skew', true, 'Aligned', 'ok', skewDetail); }
    else { skew = skewAngle(gray, region); skewDetail = skew.toFixed(1) + '°'; if (skew > T.maxSkewDeg) add('skew', false, 'Hold the card flat and straight', skew > 25 ? 'block' : 'warn', skewDetail); else add('skew', true, 'Aligned', 'ok', skewDetail); }
    // 8 photo zone (heuristic: left portion of the card)
    if (rect) {
      const pz = { x: rect.x + Math.floor(rect.w * 0.03), y: rect.y + Math.floor(rect.h * 0.2), w: Math.floor(rect.w * 0.3), h: Math.floor(rect.h * 0.5) };
      const skin = skinFraction(img, pz);
      if (skin < T.minSkin) add('photo', false, 'Photo area not visible', 'warn', (skin * 100).toFixed(0) + '% skin-tone');
      else add('photo', true, 'Photo zone present', 'ok', (skin * 100).toFixed(0) + '%');
    }
    const blocked = checks.some(c => !c.pass && c.severity === 'block');
    return { checks, blocked, card: rect, metrics: { luminance: lum, blur, glare: gl.fraction, glareRegion: gl.region, skew, skewDetail, rotation: rect ? rect.rotationDeg : null, tilt: rect ? rect.tiltDeg : null, motion, areaFraction: rect ? rect.areaFraction : 0 }, gray };
  }
  /** Presentation-attack style flags (ISO/IEC 30107 vocabulary) — heuristics, never a verdict */
  function padFlags(img, rect) {
    const gray = toGray(img); const flags = [];
    const sat = meanSaturation(img, rect); const per = periodicityScore(gray, rect); const blur = laplacianVariance(gray, rect);
    if (sat < 0.08 && blur > 150) flags.push({ type: 'print-attack', label: 'Possible photocopy (low colour saturation)', confidence: Math.min(0.9, (0.08 - sat) * 10 + 0.4) });
    if (per > 0.5) flags.push({ type: 'replay-attack', label: 'Possible screen capture (periodic moiré pattern)', confidence: Math.min(0.9, per) });
    return { flags, metrics: { saturation: sat, periodicity: per, sharpness: blur } };
  }

  /* ----------------------------------------------------------------------
     12. Homography / perspective warp (canvas-free math + ImageData warp)
     ---------------------------------------------------------------------- */
  function solveLinear(A, b) { // Gaussian elimination, A n×n
    const n = b.length; const M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c]; if (Math.abs(d) < 1e-12) return null;
      for (let k = c; k <= n; k++) M[c][k] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map(r => r[n]);
  }
  /** src, dst: arrays of 4 {x,y}. Returns 3×3 H mapping src→dst */
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) { const { x, y } = src[i], { x: u, y: v } = dst[i]; A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
    const h = solveLinear(A, b); if (!h) return null; return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function invert3(m) {
    const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  /** Warp an ImageData so that quad (4 corners TL,TR,BR,BL) maps to a W×H rectangle. Returns ImageData-like {data,width,height} */
  function warpQuad(img, quad, W, H) {
    const Hm = homography([{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], quad); if (!Hm) return null;
    const out = new Uint8ClampedArray(W * H * 4); const { data, width, height } = img;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const w = Hm[6] * x + Hm[7] * y + 1; const sx = (Hm[0] * x + Hm[1] * y + Hm[2]) / w, sy = (Hm[3] * x + Hm[4] * y + Hm[5]) / w;
      const o = (y * W + x) * 4; if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) { out[o + 3] = 255; continue; }
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0; const i00 = (y0 * width + x0) * 4, i10 = i00 + 4, i01 = i00 + width * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) out[o + c] = (data[i00 + c] * (1 - fx) + data[i10 + c] * fx) * (1 - fy) + (data[i01 + c] * (1 - fx) + data[i11 + c] * fx) * fy;
      out[o + 3] = 255;
    }
    return { data: out, width: W, height: H };
  }

  /* ----------------------------------------------------------------------
     13. Standard output builders (mdoc-shaped, VC-shaped, plain JSON)
     ---------------------------------------------------------------------- */
  function buildOutputs(record) {
    const f = record.fields || {};
    const iso = d => (d && d.iso) ? d.iso : (typeof d === 'string' ? d : null);
    const base = {
      family_name: f.surname || null, given_name: f.given || null, birth_date: iso(f.dateOfBirth), expiry_date: iso(f.dateOfExpiry), issue_date: iso(f.dateOfIssue),
      issuing_country: (f.issuer || '').replace(/</g, '') || null, nationality: (f.nationality || '').replace(/</g, '') || null, document_number: f.documentNumber || null, sex: f.sexDisplay || null, document_type: f.documentTypeName || null
    };
    const mdoc = { docType: record.mrzFormat === 'TD3' ? 'org.iso.23220.photoid.1' : 'org.iso.18013.5.1.mDL', version: '1.0', status: 'SELF-ASSERTED — unsigned, authenticity NOT chip-verified',
      issuerSigned: { nameSpaces: { 'org.iso.18013.5.1': base } }, deviceSigned: null, note: 'Shape follows ISO/IEC 18013-5 namespaces; no issuer signature exists because this was produced from an optical scan.' };
    const vc = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential', 'ScannedIdentityDocumentRecord'], issuer: 'did:self:optical-scan', validFrom: new Date().toISOString(),
      credentialSubject: Object.assign({ id: 'did:self:holder' }, base), credentialStatus: { type: 'SelfAsserted', note: 'Unsigned (alg=none). Data consistency checked only. Document authenticity NOT verified.' },
      evidence: [{ type: 'OpticalScan', mrzChecks: record.checks || null, crossValidation: record.crossValidation || null, padFlags: record.padFlags || null, timestamp: record.timestamp }] };
    return { json: Object.assign({ record_version: '1.0', disclaimer: 'Digital record – not an identity document. Authenticity not verified.' }, record), mdoc, vc };
  }

  /* ----------------------------------------------------------------------
     14. Cross-validation MRZ ⇄ visual zone ⇄ barcode
     ---------------------------------------------------------------------- */
  function crossValidate(mrz, vz, bc) {
    const rows = []; const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cmp = (key, label, a, b, srcA, srcB, fuzzy) => {
      if (!a || !b) return; const na = norm(a), nb = norm(b); let status;
      if (na === nb) status = 'match'; else if (fuzzy && (na.includes(nb) || nb.includes(na) || similarity(na, nb) >= 0.8)) status = 'near'; else status = 'mismatch';
      rows.push({ key, label, a, b, srcA, srcB, status });
    };
    const mf = mrz && mrz.fields ? mrz.fields : null; const vf = vz && vz.fields ? vz.fields : null; const bf = bc && bc.fields ? bc.fields : null;
    const d = x => x && (x.iso || (x.date && x.date.iso)) || null;
    if (mf && vf) {
      cmp('surname', 'Surname', mf.surname, vf.surname && vf.surname.value, 'MRZ', 'Visual zone', true);
      cmp('given', 'Given names', mf.given, vf.given && vf.given.value, 'MRZ', 'Visual zone', true);
      { const vzNum = vf.documentNumber && vf.documentNumber.value; const opt = norm(mf.optionalData || '') + norm(mf.optionalData2 || '');
        if (vzNum && opt.length >= 6 && norm(vzNum) && (opt.includes(norm(vzNum)) || norm(vzNum).includes(opt))) rows.push({ key: 'documentNumber', label: 'ID number (MRZ optional data)', a: mf.optionalData || mf.optionalData2, b: vzNum, srcA: 'MRZ', srcB: 'Visual zone', status: 'match' });
        else cmp('documentNumber', 'Document no.', mf.documentNumber, vzNum, 'MRZ', 'Visual zone', true); }
      cmp('dateOfBirth', 'Date of birth', d(mf.dateOfBirth), d(vf.dateOfBirth), 'MRZ', 'Visual zone');
      cmp('dateOfExpiry', 'Expiry', d(mf.dateOfExpiry), d(vf.dateOfExpiry), 'MRZ', 'Visual zone');
    }
    if (bf) {
      const other = mf || (vf ? Object.fromEntries(Object.entries(vf).map(([k, v]) => [k, v.date || v.value])) : null); const src = mf ? 'MRZ' : 'Visual zone';
      if (other) { cmp('surname', 'Surname', other.surname, bf.surname, src, 'Barcode', true); cmp('given', 'Given names', other.given, bf.given, src, 'Barcode', true); cmp('documentNumber', 'Document no.', other.documentNumber, bf.documentNumber, src, 'Barcode', true); cmp('dateOfBirth', 'Date of birth', d(other.dateOfBirth), d(bf.dateOfBirth), src, 'Barcode'); cmp('dateOfExpiry', 'Expiry', d(other.dateOfExpiry), d(bf.dateOfExpiry), src, 'Barcode'); }
    }
    return { rows, mismatches: rows.filter(r => r.status === 'mismatch').length, compared: rows.length };
  }

  /* ----------------------------------------------------------------------
     15. Document-number format validation per issuer (well-formedness only)
     ---------------------------------------------------------------------- */
  const DOCNUM_PATTERNS = {
    USA: /^[A-Z0-9]{9}$/, GBR: /^\d{9}$/, CAN: /^[A-Z]{2}\d{6}$|^[A-Z]\d{6}[A-Z]{2}$/, DEU: /^[CFGHJKLMNPRTVWXYZ0-9]{9}$/, D: /^[CFGHJKLMNPRTVWXYZ0-9]{9}$/, FRA: /^\d{2}[A-Z]{2}\d{5}$/, ITA: /^[A-Z]{2}\d{7}$/, ESP: /^[A-Z]{3}\d{6}$/, NLD: /^[A-Z0-9]{9}$/,
    ARE: /^[A-Z0-9]{6,9}$/, SAU: /^[A-Z]\d{8}$/, PAK: /^[A-Z]{2}\d{7}$/, IND: /^[A-Z]\d{7}$/, CHN: /^[EG]\d{8}$|^E[A-Z]\d{7}$/, JPN: /^[A-Z]{2}\d{7}$/, KOR: /^[MS]\d{8}$|^M[0-9]{3}[A-Z][0-9]{4}$/, AUS: /^[A-Z]{1,2}\d{7}$/, BRA: /^[A-Z]{2}\d{6}$/, MEX: /^[A-Z]\d{8}$/, TUR: /^[A-Z]\d{8}$/, RUS: /^\d{9}$/, EGY: /^[A-Z]\d{8}$/, NGA: /^[A-Z]\d{8}$/, ZAF: /^[A-Z]\d{8}$/, PHL: /^[A-Z]\d{7}[A-Z]$/, IDN: /^[A-Z]\d{7}$/
  };
  function docNumberFormatCheck(issuer, num) {
    const c = String(issuer || '').replace(/</g, ''); const p = DOCNUM_PATTERNS[c]; const n = String(num || '').replace(/</g, '');
    if (!p) return { known: false, ok: null, note: 'No format rule on file for ' + c };
    return { known: true, ok: p.test(n), note: p.test(n) ? 'Number is well-formed for ' + countryName(c) : 'Number does not match the usual ' + countryName(c) + ' pattern (not proof of anything; patterns change by series)' };
  }

  return {
    COUNTRIES, countryName, countryKnown, checkDigit, cdOk, correctField, parseMrzDate, expiryStatus, normalizeLine, extractMrzLines, parseMRZ, detectFormat,
    mrzInformation, deriveBacKeys, parseAAMVA, extractVisualFields, groupLines, locateValue, similarity, parseVzDate,
    toGray, meanLuminance, laplacianVariance, glareAnalysis, detectCardRect, skewAngle, skinFraction, meanSaturation, periodicityScore, frameDifference,
    qualityChecks, padFlags, borderOverflow, DEFAULT_THRESHOLDS, homography, invert3, warpQuad, buildOutputs, crossValidate, docNumberFormatCheck
  };
})();
if (typeof module !== 'undefined') module.exports = DocScanEngine;

/* ============================================================
   Keyflow adapter — drives DocScan's engine from Keyflow's own
   offline Tesseract output and maps the result into the shape
   Keyflow's scan UI (showScanResult / applyScan) already expects.
   Loaded after engine.js; exposes window.DocScanMRZ.
   ============================================================ */
(function(g){
  "use strict";
  var E = g.DocScanEngine || (typeof DocScanEngine!=="undefined"?DocScanEngine:null);
  if(!E) return;
  try{ g.DocScanEngine = E; }catch(e){}
  function dmy(d){ if(!d) return ""; if(d.day&&d.month&&d.year) return String(d.day).padStart(2,"0")+"/"+String(d.month).padStart(2,"0")+"/"+d.year; return d.display||d.iso||""; }
  function countedChecks(ch){ var ks=Object.keys(ch||{}),p=0,f=0; ks.forEach(function(k){ if(ch[k]==="pass"||ch[k]==="corrected")p++; if(ch[k]==="fail")f++; }); return {passed:p,total:ks.length,failed:f}; }
  /* DocScan parseMRZ result -> Keyflow MRZ result */
  function toKeyflow(p){
    if(!p) return null;
    var F=p.fields||{}, cc=countedChecks(p.checks);
    var given=(F.given||"").trim(), surname=(F.surname||"").trim();
    var full=(given?given+" ":"")+surname;
    var warnings=[];
    if((p.checks||{}).documentNumber==="corrected") warnings.push("document number");
    (p.corrections||[]).forEach(function(c){ var n=(c&&c.field)||c; if(n&&warnings.indexOf(n)<0) warnings.push(n); });
    return {
      type:p.format, valid:!!p.valid,
      confident: !!p.valid && cc.failed===0 && (p.checks||{}).composite==="pass",
      checksPassed:cc.passed, checksTotal:cc.total, warnings:warnings,
      _docscan:p,
      fields:{
        fullName:full, givenNames:given, surname:surname,
        documentNumber:F.documentNumber||"",
        nationality:F.nationality||"", nationalityName:(F.nationality&&E.countryName(F.nationality))||F.nationality||"",
        issuingCountry:F.issuer||"", issuingCountryName:(F.issuer&&E.countryName(F.issuer))||F.issuer||"",
        dateOfBirth:(F.dateOfBirth&&F.dateOfBirth.iso)||"", dateOfBirthDisplay:dmy(F.dateOfBirth),
        dateOfExpiry:(F.dateOfExpiry&&F.dateOfExpiry.iso)||"", dateOfExpiryDisplay:dmy(F.dateOfExpiry),
        sex:F.sex||"", optional1:F.optionalData||""
      }
    };
  }
  /* parse raw OCR text (noisy) the way Keyflow's scan.js expects MRZ.parse to */
  function parse(text){
    try{
      var ex=E.extractMrzLines(text); if(!ex||!ex.lines||ex.lines.length<2) return null;
      var p=E.parseMRZ(ex.lines, ex.format); return toKeyflow(p);
    }catch(e){ return null; }
  }
  /* AAMVA barcode text -> a Keyflow driving-licence fields object */
  function parseBarcode(text){
    try{
      var a=E.parseAAMVA(text); if(!a||!a.fields) return null;
      var f=a.fields, dob=f.dateOfBirth, exp=f.expiry||f.dateOfExpiry, iss=f.issueDate;
      var addr=[f.street,f.city,f.state,f.postalCode].filter(Boolean).join(", ");
      var name=[f.firstName,f.middleName,f.lastName].filter(Boolean).join(" ").trim();
      return { valid:true, fields:{
        licenceNumber:f.documentNumber||f.licenseNumber||"", fullName:name||"", firstName:f.firstName||"",
        dobISO:(dob&&dob.iso)||"", dobDisplay:dmy(dob), expiryISO:(exp&&exp.iso)||"", expiryDisplay:dmy(exp),
        issuedISO:(iss&&iss.iso)||"", address:addr, addressState:f.state||"", country:a.issuerName||f.country||"",
        sex:f.sex===1||f.sex==="1"?"Male":f.sex===2||f.sex==="2"?"Female":(f.sex||""),
        vehicleClass:f.vehicleClass||"", restrictions:f.restrictions||"" } };
    }catch(e){ return null; }
  }
  g.DocScanMRZ = { parse:parse, parseBarcode:parseBarcode, toKeyflow:toKeyflow, engine:E,
                   extractVisualFields:E.extractVisualFields, crossValidate:E.crossValidate, qualityChecks:E.qualityChecks };
})(typeof window!=="undefined"?window:globalThis);
