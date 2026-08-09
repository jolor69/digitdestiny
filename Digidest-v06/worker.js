// Digit Destiny — Cloudflare Worker
// Routes: /api/calculate  /api/reading  /api/compatibility  /api/daily/:number
//         /api/telegram/webhook  /api/warm  /api/hero  /api/synthesis
//         /api/weton/calculate  /api/weton/reading  /api/weton/jodoh  /api/weton/petungan
//         /api/donate/stripe/checkout  /api/donate/stripe/webhook  /api/donate/paypal/log
// Cron:   0 1 * * * daily insight push, 0 0 * * * hero rotation cursor
// Cache:  v2 keys — bump to v3 when prompts change next time

var APP_DOMAIN = 'https://digitdestiny.neulab.xyz';

var ARCHETYPES = {
  1: 'The Leader',
  2: 'The Peacemaker',
  3: 'The Creator',
  4: 'The Builder',
  5: 'The Explorer',
  6: 'The Nurturer',
  7: 'The Seeker',
  8: 'The Achiever',
  9: 'The Humanitarian'
};

var READING_TYPES = ['core', 'strengths', 'shadow', 'love_work'];

// ── CORS ──
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: corsHeaders()
  });
}

function errorResponse(code, message, status) {
  return jsonResponse({ error: true, code: code, message: message }, status || 400);
}

// ── NUMEROLOGY ──
function calculateNumber(birthDate) {
  var parts = birthDate.split('-');
  if (parts.length !== 3) return null;
  var year  = parts[0];
  var month = parts[1];
  var day   = parts[2];
  var dateStr = year + month + day;

  var digits = [];
  for (var i = 0; i < dateStr.length; i++) {
    var d = parseInt(dateStr[i], 10);
    if (d > 0) digits.push(d);
  }

  var steps = [];
  var current = digits.slice();

  while (current.length > 1) {
    var sum = 0;
    for (var j = 0; j < current.length; j++) sum += current[j];
    var stepStr = current.join(' + ') + ' = ' + sum;
    steps.push(stepStr);
    current = sumToDigits(sum);
  }

  return {
    digits: digits,
    steps: steps,
    number: current[0]
  };
}

function sumToDigits(n) {
  var result = [];
  var s = String(n);
  for (var i = 0; i < s.length; i++) {
    var d = parseInt(s[i], 10);
    if (d > 0) result.push(d);
  }
  return result;
}

function isValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  var parts = dateStr.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  if (y < 1900 || y > new Date().getFullYear()) return false;
  if (m < 1 || m > 12) return false;
  var date = new Date(y, m - 1, d);
  if (date > new Date()) return false;
  if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) return false;
  return true;
}

// ── WETON / PRIMBON CALC ──
// Deterministic only — zero AI. Date -> weekday -> pasaran -> neptu -> weton
// name -> wuku position -> jodoh category -> petungan rule match.
//
// Epoch anchor: 8 July 1633 CE (Gregorian) — the start of the Sultan Agung
// Javanese calendar reform (1 Sura, Alip year 1555 AJ), traditionally cited
// as Jumat Legi (Friday, pasaran Legi).
//
// PASARAN_EPOCH_JDN — VERIFIED 2026-08-10 against 4 independent reference
// points: (1) the epoch date itself, corroborated by historia.id and
// kratonjogja.id as "Jumat Legi, 1 Sura Alip 1555"; (2) 17 Aug 1945
// (Indonesian independence day), a widely-documented "Jumat Legi" per
// ki-demang.com's Javanese almanac and multiple Indonesian news sources;
// (3) 1 Jan 1990 = Senin Wage per ki-demang.com; (4) 10 Aug 2026 = Senin
// Wage (neptu 8) per kompas.com's Aug 2026 Javanese calendar. This
// worker's gregorianToJDN + PASARAN_EPOCH_JDN reproduced all four exactly
// — no change needed.
//
// WUKU_EPOCH_JDN — the original placeholder reused the pasaran epoch
// (8 July 1633, a Friday) as day 0 of wuku Sinta. Cross-checking against
// ki-demang.com (1 Jan 2020 = wuku "Kurantil"/Kulantir) and Indonesian
// Javanese-calendar sources for Aug 2026 (1 Aug 2026 = Wuku "Kuruwelut"
// /Krulut per a Tribunnews-syndicated calendar roundup; 8 Aug 2026 =
// "Marakeh"/Merakih and 9 Aug 2026 = "Tambir" per kalenderbali.org) showed
// the placeholder was WRONG: it produced the wrong wuku name for all of
// these dates, off by a consistent 16-day / Friday-vs-Sunday offset. Every
// source agrees wuku boundaries fall on a Sunday (day-in-wuku 0 = Sunday,
// day 6 = Saturday), which 8 July 1633 (a Friday) cannot satisfy. Shifting
// the wuku epoch 16 days later, to 24 July 1633 (a Sunday), reproduces all
// four independent data points above exactly. CORRECTED 2026-08-10 —
// WUKU_EPOCH_JDN now anchors to 24 July 1633, not 8 July 1633. This is a
// derived correction (no primary source states "wuku Sinta began 24 July
// 1633" directly) rather than a directly-cited historical date, so treat
// it as verified-against-modern-calendars rather than verified-against-
// primary-history; if a primary source ever surfaces for the original
// wuku start date, re-check against it.

function mod(n, m) {
  return ((n % m) + m) % m;
}

// Gregorian civil date -> Julian Day Number. Pure integer math, no Date
// object involved, so it can't drift with timezone/DST handling.
function gregorianToJDN(y, m, d) {
  var a = Math.floor((14 - m) / 12);
  var y2 = y + 4800 - a;
  var m2 = m + 12 * a - 3;
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 +
    Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
}

function dateStrToJDN(dateStr) {
  var p = dateStr.split('-');
  return gregorianToJDN(parseInt(p[0], 10), parseInt(p[1], 10), parseInt(p[2], 10));
}

function formatDateUTC(d) {
  var mm = d.getUTCMonth() + 1;
  var dd = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);
}

var WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

var WEEKDAY_NEPTU = {
  0: 5, // Sunday / Minggu
  1: 4, // Monday / Senin
  2: 3, // Tuesday / Selasa
  3: 7, // Wednesday / Rabu
  4: 8, // Thursday / Kamis
  5: 6, // Friday / Jumat
  6: 9  // Saturday / Sabtu
};

var PASARAN_ORDER = ['Legi', 'Pahing', 'Pon', 'Wage', 'Kliwon'];

var PASARAN_NEPTU = { Legi: 5, Pahing: 9, Pon: 7, Wage: 4, Kliwon: 8 };

var PASARAN_EPOCH_JDN = gregorianToJDN(1633, 7, 8); // Jumat Legi, index 0 = Legi — VERIFIED, see comment block above

var WUKU_EPOCH_JDN = gregorianToJDN(1633, 7, 24); // start of wuku Sinta — CORRECTED from 1633-07-08, see comment block above

// Standard 30-wuku Pawukon cycle (shared with the well-published Balinese
// wuku calendar — a useful independent cross-check source since continuous
// Javanese wuku tracking is less commonly published).
var WUKU_NAMES = [
  'Sinta', 'Landep', 'Ukir', 'Kulantir', 'Tolu', 'Gumbreg', 'Wariga',
  'Warigadian', 'Julungwangi', 'Sungsang', 'Dungulan', 'Kuningan', 'Langkir',
  'Medangsia', 'Pujut', 'Pahang', 'Krulut', 'Merakih', 'Tambir', 'Medangkungan',
  'Matal', 'Uye', 'Menail', 'Prangbakat', 'Bala', 'Ugu', 'Wayang', 'Kelawu',
  'Dukut', 'Watugunung'
];

var JODOH_CATEGORIES = ['Pegat', 'Ratu', 'Jodoh', 'Topo', 'Tinari', 'Padu', 'Sujanan', 'Pesthi'];

// Fixed reference table of category meanings — the AI narrative is only
// allowed to elaborate on these, never invent new claims (PRD Section 3).
// PROPOSED boundaries/meanings — verify against Primbon Betaljemur Adammakna
// before trusting in production (PRD Section 6 risk item 2).
var JODOH_MEANING = {
  Pegat: 'Separation risk — this pairing tends toward friction and needs deliberate effort to sustain harmony.',
  Ratu: 'A partnership of equals — mutual respect and admiration, well-matched standing.',
  Jodoh: 'A natural match — the traditional sense of well-suited compatibility.',
  Topo: 'A pairing tested by hardship before reward — patience is the defining lesson.',
  Tinari: 'An easy, favorable pairing — fortune tends to flow smoothly.',
  Padu: 'A pairing prone to frequent friction and quarrels — needs active conflict management.',
  Sujanan: 'A pairing where trust needs continual tending — traditionally associated with infidelity risk, so communication matters most.',
  Pesthi: 'A stable, enduring pairing — harmony and longevity are the hallmark.'
};

// Good-day (petungan) rule table, sourced from Primbon Betaljemur Adammakna
// per the project's confirmed single-source discipline (PRD Section 6 risk
// item 6 — do not blend other primbon texts).
//
// RESEARCH ATTEMPTED 2026-08-10, STILL PLACEHOLDER — searched extensively
// (Indonesian-language queries combining "Betaljemur Adammakna" with each
// of pernikahan/pindah rumah/membuka usaha/bepergian, plus general primbon
// news explainers and primary-source-claiming blogs) for a simple,
// specifically-attributed "these pasaran/weton are good, these are to
// avoid" list per event type, matching this table's shape. None found.
// What IS attested, repeatedly, across sources that name Betaljemur
// Adammakna specifically (portalmajalengka.pikiran-rakyat.com,
// plus.kapanlagi.com, solo.suaramerdeka.com, primbonjawa.com,
// agebuah.blogspot.com) is that the text's actual method for these
// decisions is NOT a static good/avoid pasaran list independent of the
// person — it is a formulaic combination of the individual's own birth
// weton/neptu with the candidate date, e.g.: neptu-sum-mod-7 "jodoh"
// categories (Pegat/Ratu/Jodoh/etc. — already implemented elsewhere in
// this file via JODOH_CATEGORIES) for pairing/wedding compatibility,
// a "Pancasuda" neptu-mod calculation for starting a business, and a
// directional "Naga Dina" (dragon-position) avoidance rule for travel
// that depends on compass direction, not pasaran identity. None of these
// map cleanly onto a fixed goodPasaran/avoidPasaran/avoidWeton array per
// event type, so nothing found can be transcribed here in good faith
// without misrepresenting the source or inventing content.
// RECOMMENDATION: before launch, consult a physical or scanned copy of
// Primbon Betaljemur Adammakna (R. Soemodidjojo) directly for the exact
// petungan tables for these four event types, and consider whether the
// data shape below (a flat good/avoid pasaran list) is even the right
// representation — the real method may need the neptu-formula approach
// used elsewhere in this file instead. The goodPasaran/avoidPasaran/
// avoidWeton values below remain INVENTED PLACEHOLDERS, not sourced from
// the text, and must not be trusted in production.
// verified: false on every entry below means "not attributable to a single
// primary text" — do not claim Primbon Betaljemur Adammakna as the source
// (research confirmed its actual method per event type is a neptu formula,
// not a static pasaran list; see comment block above). This flag is
// threaded through matchPetungan()'s response, the AI prompt, and the
// frontend so nobody downstream repeats the false attribution.
var PETUNGAN = {
  wedding: {
    goodPasaran: ['Legi', 'Kliwon'],
    avoidPasaran: [],
    avoidWeton: [],
    verified: false,
    notes: 'General traditional practice, not verified against a single primary source. Primbon Betaljemur Adammakna’s actual wedding-date method is a neptu-sum jodoh-category calculation (see JODOH_CATEGORIES / the Jodoh Compatibility feature) — consult that instead for a source-backed reading.'
  },
  moving_house: {
    goodPasaran: ['Pon', 'Wage'],
    avoidPasaran: [],
    avoidWeton: [],
    verified: false,
    notes: 'General traditional practice, not verified against a single primary source. Secondary sources describe Betaljemur Adammakna’s actual method as a personal-neptu-plus-day-neptu modulo calculation rather than a fixed pasaran list.'
  },
  starting_business: {
    goodPasaran: ['Legi', 'Pahing'],
    avoidPasaran: [],
    avoidWeton: [],
    verified: false,
    notes: 'General traditional practice, not verified against a single primary source. Betaljemur Adammakna’s actual method is described as a "Pancasuda" neptu calculation combining the owner’s birth weton with the opening date, not a fixed pasaran list.'
  },
  travel: {
    goodPasaran: ['Pahing', 'Pon'],
    avoidPasaran: [],
    avoidWeton: [],
    verified: false,
    notes: 'General traditional practice, not verified against a single primary source. Betaljemur Adammakna’s actual guidance is a directional "Naga Dina" rule keyed to compass direction plus an hour-of-day table, not pasaran identity.'
  }
};

var PETUNGAN_EVENT_TYPES = ['wedding', 'moving_house', 'starting_business', 'travel'];

var JAKARTA_LAT = -6.2088;
var JAKARTA_LON = 106.8456;

function getPasaran(dateStr) {
  var jdn = dateStrToJDN(dateStr);
  var idx = mod(jdn - PASARAN_EPOCH_JDN, 5);
  return PASARAN_ORDER[idx];
}

function getWukuPosition(dateStr) {
  var jdn = dateStrToJDN(dateStr);
  var daysSince = jdn - WUKU_EPOCH_JDN;
  var wukuIndex = mod(Math.floor(daysSince / 7), 30);
  var dayInWuku = mod(daysSince, 7);
  return { name: WUKU_NAMES[wukuIndex], index: wukuIndex, dayInWuku: dayInWuku };
}

function calculateWeton(dateStr) {
  var p = dateStr.split('-');
  var y = parseInt(p[0], 10);
  var m = parseInt(p[1], 10);
  var d = parseInt(p[2], 10);
  var dateObj = new Date(Date.UTC(y, m - 1, d));
  var weekdayIdx = dateObj.getUTCDay();
  var weekdayName = WEEKDAY_NAMES[weekdayIdx];
  var weekdayNeptu = WEEKDAY_NEPTU[weekdayIdx];
  var pasaran = getPasaran(dateStr);
  var pasaranNeptu = PASARAN_NEPTU[pasaran];
  var wuku = getWukuPosition(dateStr);

  return {
    birth_date: dateStr,
    weekday: weekdayName,
    weekday_neptu: weekdayNeptu,
    pasaran: pasaran,
    pasaran_neptu: pasaranNeptu,
    neptu: weekdayNeptu + pasaranNeptu,
    weton_name: weekdayName + ' ' + pasaran,
    wuku: wuku.name
  };
}

function calculateJodoh(dateA, dateB) {
  var wA = calculateWeton(dateA);
  var wB = calculateWeton(dateB);
  var combined = wA.neptu + wB.neptu;
  var remainder = mod(combined, 8);
  var categoryIndex = remainder === 0 ? 8 : remainder;
  var category = JODOH_CATEGORIES[categoryIndex - 1];

  return {
    weton_a: wA.weton_name,
    weton_b: wB.weton_name,
    neptu_a: wA.neptu,
    neptu_b: wB.neptu,
    combined_neptu: combined,
    category: category,
    meaning: JODOH_MEANING[category]
  };
}

function matchPetungan(eventType, dateStr) {
  var rule = PETUNGAN[eventType];
  if (!rule) return null;
  var w = calculateWeton(dateStr);
  var isGoodPasaran = rule.goodPasaran.indexOf(w.pasaran) !== -1;
  var isAvoidPasaran = rule.avoidPasaran.indexOf(w.pasaran) !== -1;
  var isAvoidWeton = rule.avoidWeton.indexOf(w.weton_name) !== -1;

  return {
    event_type: eventType,
    weton_name: w.weton_name,
    pasaran: w.pasaran,
    recommended: isGoodPasaran && !isAvoidPasaran && !isAvoidWeton,
    reasons: {
      good_pasaran: isGoodPasaran,
      avoid_pasaran: isAvoidPasaran,
      avoid_weton: isAvoidWeton
    },
    verified: !!rule.verified,
    notes: rule.notes
  };
}

// Real sunset-time (Maghrib) calculation via the standard sunrise/sunset
// equation (NOAA-derived), not a fixed clock approximation. Defaults to
// Jakarta coordinates when no location is supplied. Returns a UTC Date.
function getMaghribUTC(dateStr, lat, lon) {
  if (typeof lat !== 'number') lat = JAKARTA_LAT;
  if (typeof lon !== 'number') lon = JAKARTA_LON;

  var jdn = dateStrToJDN(dateStr);
  var n = jdn - 2451545.0 + 0.0008;
  var meanSolarNoon = n - lon / 360;
  var solarMeanAnomaly = mod(357.5291 + 0.98560028 * meanSolarNoon, 360);
  var Mrad = solarMeanAnomaly * Math.PI / 180;
  var equationOfCenter = 1.9148 * Math.sin(Mrad) + 0.0200 * Math.sin(2 * Mrad) + 0.0003 * Math.sin(3 * Mrad);
  var eclipticLongitude = mod(solarMeanAnomaly + equationOfCenter + 180 + 102.9372, 360);
  var Lrad = eclipticLongitude * Math.PI / 180;
  var solarTransit = 2451545.0 + meanSolarNoon + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * Lrad);
  var declination = Math.asin(Math.sin(Lrad) * Math.sin(23.44 * Math.PI / 180));
  var latRad = lat * Math.PI / 180;
  var cosHourAngle = (Math.sin(-0.83 * Math.PI / 180) - Math.sin(latRad) * Math.sin(declination)) /
    (Math.cos(latRad) * Math.cos(declination));
  if (cosHourAngle > 1) cosHourAngle = 1;
  if (cosHourAngle < -1) cosHourAngle = -1;
  var hourAngle = Math.acos(cosHourAngle) * 180 / Math.PI;
  var sunsetJulian = solarTransit + hourAngle / 360;

  return new Date((sunsetJulian - 2440587.5) * 86400000);
}

// Shifts the effective Javanese calendar date back one day when the supplied
// wall-clock time (assumed Asia/Jakarta, WIB/UTC+7) falls before that
// Gregorian date's Maghrib — the traditional day-change boundary, per the
// user's confirmed real-sunset-calculation decision (PRD Section 6 risk item 7).
function resolveJavaneseDate(dateStr, timeStr, lat, lon) {
  if (!timeStr) return dateStr;
  var tp = timeStr.split(':');
  var hh = parseInt(tp[0], 10);
  var mm = parseInt(tp[1], 10) || 0;
  if (isNaN(hh)) return dateStr;

  var p = dateStr.split('-');
  var y = parseInt(p[0], 10);
  var m = parseInt(p[1], 10);
  var d = parseInt(p[2], 10);

  var maghrib = getMaghribUTC(dateStr, lat, lon);
  var eventUTC = new Date(Date.UTC(y, m - 1, d, hh - 7, mm));

  if (eventUTC < maghrib) {
    var prevDay = new Date(Date.UTC(y, m - 1, d - 1));
    return formatDateUTC(prevDay);
  }
  return dateStr;
}

// ── STRIP MARKDOWN ──
function stripMarkdown(text) {
  if (!text) return text;
  // Remove **bold** and *italic* markers
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  // Remove # headers
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Remove leading dashes/bullets
  text = text.replace(/^\s*[-*]\s+/gm, '');
  // Remove backtick code
  text = text.replace(/`([^`]+)`/g, '$1');
  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ── PROMPTS ──
function buildPrompt(type, number, archetype, extra, lang) {
  var isID = lang === 'id';

  var system = isID
    ? 'Kamu adalah juru tafsir numerologi. Tulis HANYA teks bacaan dalam satu paragraf mengalir. DILARANG KERAS menggunakan tanda bintang, tanda pagar, peluru, tebal, miring, atau format markdown apapun. Tulis sebagai prosa biasa yang hangat dan personal dalam Bahasa Indonesia.'
    : 'You are a numerology interpreter. Write ONLY the reading as flowing prose. NEVER use asterisks, hashtags, bullet points, bold, italics, labels, section headers, or any markdown formatting. Write as plain warm personal prose, as if speaking directly to the reader. Do not include titles, key lessons, mottos, or any labelled sections.';

  var user = '';

  if (type === 'core') {
    user = isID
      ? 'Tulis bacaan karakter inti untuk Angka Jalur Hidup ' + number + ', si ' + archetype + '. Satu paragraf mengalir, 120-150 kata. Tanpa judul, tanpa label, hanya prosa.'
      : 'Write a core character reading for Life Path Number ' + number + ', the ' + archetype + '. One flowing paragraph, 120-150 words. No titles, no labels, just prose.';
  } else if (type === 'strengths') {
    user = isID
      ? 'Tulis bacaan kekuatan untuk Angka Jalur Hidup ' + number + ', si ' + archetype + '. Satu paragraf mengalir, 80-100 kata. Fokus pada bakat alami. Tanpa judul atau label.'
      : 'Write a strengths reading for Life Path Number ' + number + ', the ' + archetype + '. One flowing paragraph, 80-100 words. Focus on natural talents. No titles or labels.';
  } else if (type === 'shadow') {
    user = isID
      ? 'Tulis bacaan sisi gelap untuk Angka Jalur Hidup ' + number + ', si ' + archetype + '. Satu paragraf mengalir, 80-100 kata. Fokus pada titik buta. Tanpa judul atau label.'
      : 'Write a shadow reading for Life Path Number ' + number + ', the ' + archetype + '. One flowing paragraph, 80-100 words. Focus on blind spots and growth edges. No titles or labels.';
  } else if (type === 'love_work') {
    user = isID
      ? 'Tulis bacaan cinta dan pekerjaan untuk Angka Jalur Hidup ' + number + ', si ' + archetype + '. Satu paragraf mengalir, 100-120 kata. Bagi rata antara hubungan dan karier. Tanpa judul atau label.'
      : 'Write a love and work reading for Life Path Number ' + number + ', the ' + archetype + '. One flowing paragraph, 100-120 words. Cover both relationships and career naturally. No titles or labels.';
  } else if (type === 'compatibility') {
    var numA = extra.number_a;
    var numB = extra.number_b;
    user = isID
      ? 'Tulis bacaan kompatibilitas untuk Angka Jalur Hidup ' + numA + ' dan Angka Jalur Hidup ' + numB + '. Baris pertama hanya: SCORE: [angka 0-100]. Lalu satu paragraf prosa, 100-130 kata Bahasa Indonesia. Tanpa label lain.'
      : 'Write a compatibility reading for Life Path Number ' + numA + ' and Life Path Number ' + numB + '. First line only: SCORE: [number 0-100]. Then one paragraph of plain prose, 100-130 words. No other labels.';
  } else if (type === 'daily') {
    user = isID
      ? 'Tulis wawasan harian untuk Angka Jalur Hidup ' + number + ' untuk ' + extra.date + '. Satu paragraf mengalir, 60-80 kata Bahasa Indonesia. Spesifik pada energi hari ini. Tanpa judul.'
      : 'Write a daily insight for Life Path Number ' + number + ' for ' + extra.date + '. One flowing paragraph, 60-80 words. Be specific to the energy of the day. No titles.';
  }

  return { system: system, user: user };
}

// Weton prompts are kept separate from buildPrompt() rather than extending
// its (type, number, archetype, extra, lang) signature — a differently
// shaped feature (weton/jodoh/petungan data, not a 1-9 number). Each type
// elaborates ONLY on the already-computed deterministic reference (weton
// traits, jodoh category meaning, or petungan match) — never introduces new
// claims (PRD Section 3).
function buildWetonPrompt(type, data, lang) {
  var isID = lang === 'id';

  var system = isID
    ? 'Kamu adalah juru tafsir primbon Jawa. Tulis HANYA teks bacaan dalam satu paragraf mengalir. DILARANG KERAS menggunakan tanda bintang, tanda pagar, peluru, tebal, miring, atau format markdown apapun. Jangan mengarang aturan atau makna baru di luar yang diberikan — hanya perluas makna yang sudah ditentukan. Tulis sebagai prosa biasa yang hangat dan personal dalam Bahasa Indonesia.'
    : 'You are an interpreter of Javanese weton/primbon tradition. Write ONLY the reading as flowing prose. NEVER use asterisks, hashtags, bullet points, bold, italics, labels, or markdown. Never invent new rules or meanings beyond what is given — only elaborate on the fixed meaning provided. Write as plain warm personal prose.';

  var user = '';

  if (type === 'weton_character') {
    user = isID
      ? 'Tulis bacaan karakter untuk seseorang dengan weton ' + data.weton_name + ' (neptu ' + data.neptu + ', wuku ' + data.wuku + '). Satu paragraf mengalir, 100-130 kata Bahasa Indonesia. Tanpa judul atau label, hanya prosa reflektif budaya, bukan ramalan pasti.'
      : 'Write a character reading for someone with weton ' + data.weton_name + ' (neptu ' + data.neptu + ', wuku ' + data.wuku + '). One flowing paragraph, 100-130 words. No titles or labels — reflective cultural prose, not a fixed prediction.';
  } else if (type === 'weton_compat') {
    user = isID
      ? 'Tulis bacaan hubungan untuk pasangan dengan kategori jodoh "' + data.category + '", yang bermakna: ' + data.meaning + ' Satu paragraf mengalir, 100-130 kata Bahasa Indonesia. Perluas makna ini saja, jangan menambahkan aturan baru.'
      : 'Write a relationship reading for a couple whose jodoh category is "' + data.category + '", meaning: ' + data.meaning + ' One flowing paragraph, 100-130 words. Elaborate only on this given meaning — do not introduce new rules or claims.';
  } else if (type === 'weton_goodday') {
    var verdict = data.recommended ? (isID ? 'hari yang baik' : 'a favorable day') : (isID ? 'hari yang perlu dipertimbangkan kembali' : 'a day worth reconsidering');
    // verified === false: this guidance is general traditional practice, not
    // attributable to one specific text — the prompt must not name or imply
    // a specific primbon source (PRD Section 6 risk item 6 discipline).
    var sourceNote = data.verified
      ? ''
      : (isID
        ? ' Jangan menyebut nama kitab atau sumber tertulis tertentu — sebut ini sebagai kebiasaan tradisional secara umum.'
        : ' Do not name any specific text or written source — refer to this as general traditional practice only.');
    user = isID
      ? 'Tulis panduan singkat untuk acara "' + data.event_type + '" pada weton ' + data.weton_name + ', yang dinilai sebagai ' + verdict + ' menurut petungan tradisional. Satu paragraf mengalir, 80-110 kata Bahasa Indonesia. Jangan menambahkan aturan di luar penilaian ini.' + sourceNote
      : 'Write a short good-day guidance note for a "' + data.event_type + '" event on weton ' + data.weton_name + ', assessed as ' + verdict + ' per traditional petungan. One flowing paragraph, 80-110 words. Do not introduce rules beyond this assessment.' + sourceNote;
  }

  return { system: system, user: user };
}

// ── AI CALL ──
async function callAI(env, system, user) {
  var model = env.DIGDEST_OPENROUTER_MODEL || 'deepseek/deepseek-chat';

  var body = JSON.stringify({
    model: model,
    max_tokens: 400,
    temperature: 0.75,
    messages: [
      { role: 'user', content: user }
    ],
    system: system
  });

  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 14000);

  try {
    var res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.DIGDEST_OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
        'HTTP-Referer': APP_DOMAIN,
        'X-Title': 'Digit Destiny'
      },
      body: body,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    var data = await res.json();
    var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return null;
    return text.trim();
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
}

// ── VALIDATE AI OUTPUT ──
function validateAIOutput(text) {
  if (!text || text.length < 40) return false;
  var forbidden = ['<', '>', 'http', 'undefined', 'null'];
  for (var i = 0; i < forbidden.length; i++) {
    if (text.indexOf(forbidden[i]) !== -1) return false;
  }
  return true;
}

function extractCompatScore(text) {
  var match = text.match(/^SCORE:\s*(\d+)/im);
  var score = match ? parseInt(match[1], 10) : 50;
  if (score < 0 || score > 100) score = 50;
  var clean = text.replace(/^SCORE:\s*\d+\s*/im, '').trim();
  return { score: score, text: clean };
}

// ── STATIC FALLBACKS ──
var FALLBACKS = {
  core: {
    1: 'You carry the energy of the pioneer. Independent and driven, you chart your own course where others wait for permission. Your challenge is learning that strength does not always mean solitude.',
    2: 'Yours is the energy of harmony. You feel what others cannot name, and your presence steadies those around you. Your challenge is believing your own needs matter as much as theirs.',
    3: 'You were born to create. Words, colour, sound — you shape the world through expression. Your challenge is finishing what your enthusiasm begins.',
    4: 'You are the foundation others build upon. Reliable, precise, devoted to craft — your work outlasts you. Your challenge is releasing control of what cannot be perfected.',
    5: 'Change is your element. You arrived restless and curious, drawn to every horizon. Your challenge is learning that freedom and depth are not opposites.',
    6: 'You are the caretaker. Love flows naturally from you toward home, family, and those who struggle. Your challenge is learning that caring for yourself is not selfishness.',
    7: 'You are the seeker behind the seeker. Questions drive you further than answers satisfy you. Your challenge is trusting that not everything must be understood to be true.',
    8: 'Power and material mastery are your lessons. You understand systems, resources, and what it takes to build something lasting. Your challenge is remembering that legacy is also built in quiet moments.',
    9: 'You carry the weight of the whole. Compassion, wisdom, and the long view are your gifts. Your challenge is releasing what is finished without grief.'
  },
  strengths: {
    1:'Your decisiveness and courage are rare. You act when others hesitate, and your self-reliance inspires those around you.',
    2:'Your empathy and diplomacy create safety wherever you go. People trust you instinctively and open themselves to your presence.',
    3:'Your creativity and ability to communicate open doors others cannot even find. You make difficult things feel accessible.',
    4:'Your discipline, precision, and reliability make you indispensable. What you build, you build to last.',
    5:'Your adaptability and curiosity mean you thrive where others flounder. Change energises rather than unsettles you.',
    6:'Your devotion and warmth make those around you feel genuinely seen and cared for. You create belonging.',
    7:'Your analytical depth reveals patterns and truths that others overlook entirely. Your insight is a gift.',
    8:'Your ambition and strategic clarity turn vision into tangible structure. You understand how the world actually works.',
    9:'Your wisdom and generosity elevate every room you enter. People leave your company feeling seen.'
  },
  shadow: {
    1:'Stubbornness and pride can isolate you precisely when you need support most. Vulnerability is not weakness.',
    2:'Codependency and indecision can leave you invisible in your own life. Your needs are not a burden.',
    3:'Scattered focus and superficiality can prevent your genuine gifts from landing with the depth they deserve.',
    4:'Rigidity and overwork can close you off from the joy and spontaneity that make a life worth building.',
    5:'Restlessness and avoidance can prevent deep roots from forming. Depth and freedom are not mutually exclusive.',
    6:'Martyrdom and over-giving can breed quiet resentment over time. Love given from depletion helps no one.',
    7:'Withdrawal and overthinking can keep you from the very life you spend so much time analysing.',
    8:'Ruthlessness and materialism can cost you the relationships that matter most when the work is done.',
    9:'Idealism and self-sacrifice can leave you depleted and overlooked. Your wellbeing matters too.'
  },
  love_work: {
    1:'In love you need a partner who respects your independence as much as your devotion. At work you excel when given autonomy and real responsibility.',
    2:'In love you give generously, sometimes at your own expense. At work you are the collaborator who makes teams function and feel human.',
    3:'In love you need stimulation, play, and someone who celebrates your ideas. At work you belong in roles where communication is the product.',
    4:'In love you show devotion through action rather than words. At work your reliability earns a depth of trust that others struggle to build.',
    5:'In love you need freedom and variety alongside real connection. At work you thrive in roles that keep you moving and continuously learning.',
    6:'In love you are devoted, protective, and deeply present. At work you are drawn naturally to roles involving care, teaching, or service.',
    7:'In love you need space and a partner who values depth over noise. At work you belong in research, analysis, or any field that rewards sustained thinking.',
    8:'In love you are loyal but require mutual respect as a foundation. At work you are built for leadership and long-term strategic vision.',
    9:'In love you are generous, romantic, and drawn to soulful connection. At work you are drawn to humanitarian fields and work with genuine meaning.'
  },
  daily: {
    1:'Lead with intention today. One decisive action carries more weight than ten deliberate ones.',
    2:'Listen before you speak today. The answer you are seeking may already be in the room with you.',
    3:'Create something today, even something small. Your best thinking lives inside the act of making.',
    4:'Slow down and do one thing well today. Quality is more honest than completion.',
    5:'Say yes to something unexpected today. The detour may turn out to be the whole point.',
    6:'Let someone care for you today. Receiving gracefully is also a form of love.',
    7:'Spend time alone with one question today. Do not rush toward the answer.',
    8:'Look at your long-term direction today. A small correction now prevents a large one later.',
    9:'Release something today that no longer belongs to you. Space is not emptiness — it is readiness.'
  }
};

function getFallback(type, number) {
  var section = FALLBACKS[type];
  if (!section) return 'Your reading is being prepared.';
  return section[number] || 'Your reading is being prepared.';
}

// ── WETON STATIC FALLBACKS ──
// Character fallback bucketed by neptu range (35 wetons would be unwieldy
// hand-written prose — same "small bucket count" spirit as numerology's 9).
var WETON_FALLBACKS = {
  character: {
    low: 'Your weton carries a quieter, grounded neptu. Tradition reads this as steadiness — a temperament suited to patience and careful, deliberate progress rather than sudden leaps.',
    mid: 'Your weton carries a balanced neptu. Tradition reads this as adaptability — a temperament that moves comfortably between steady work and open-hearted connection with others.',
    high: 'Your weton carries a strong, weighty neptu. Tradition reads this as intensity — a temperament suited to leadership and ambition, tempered best by patience with those who move more slowly.'
  },
  compat: {
    Pegat: 'This pairing carries a traditional caution toward separation — not a certainty, but a signal that harmony here takes deliberate, ongoing effort from both sides.',
    Ratu: 'This pairing carries a traditional sense of equal standing — mutual respect between partners who meet each other on level ground.',
    Jodoh: 'This pairing carries the traditional sense of a natural match — compatibility that tends to feel effortless once trust is established.',
    Topo: 'This pairing carries a traditional theme of trial before reward — patience through early difficulty tends to be rewarded with lasting closeness.',
    Tinari: 'This pairing carries a traditional sense of ease and favorable fortune — smoother going than most, by the old reading.',
    Padu: 'This pairing carries a traditional caution toward friction — frequent disagreement is the pattern to watch for, best met with active, honest communication.',
    Sujanan: 'This pairing carries a traditional caution around trust — the old reading emphasizes that consistent honesty matters more here than in most pairings.',
    Pesthi: 'This pairing carries the traditional sense of stability — a pattern read as enduring, steady, and built to last.'
  },
  goodday: {
    wedding: 'Traditional petungan guidance for wedding dates weighs pasaran and weton together — treat this as one cultural input among many practical considerations, not a fixed rule.',
    moving_house: 'Traditional petungan guidance for moving house weighs pasaran and weton together — treat this as one cultural input among many practical considerations, not a fixed rule.',
    starting_business: 'Traditional petungan guidance for opening a business weighs pasaran and weton together — treat this as one cultural input among many practical considerations, not a fixed rule.',
    travel: 'Traditional petungan guidance for travel dates weighs pasaran and weton together — treat this as one cultural input among many practical considerations, not a fixed rule.'
  }
};

function getWetonCharacterFallback(neptu) {
  if (neptu <= 10) return WETON_FALLBACKS.character.low;
  if (neptu <= 14) return WETON_FALLBACKS.character.mid;
  return WETON_FALLBACKS.character.high;
}

// ── HERO HEADLINE ROTATION (fixed 30-day cycle) ──
var HERO_VARIANT_COUNT = 30;

var HERO_FALLBACK = {
  en: {
    main: 'The number written',
    em: 'in your birth',
    lore: 'For five thousand years, mystics and scholars have read the hidden language of numbers. Every date of birth encodes a Life Path — a thread of character, purpose, and fate woven into the mathematics of your arrival.'
  },
  id: {
    main: 'Angka yang tertulis',
    em: 'dalam kelahiranmu',
    lore: 'Selama lima ribu tahun, para mistikus dan cendekiawan membaca bahasa tersembunyi angka. Setiap tanggal lahir menyimpan Jalur Hidup — benang karakter, tujuan, dan takdir yang terjalin dalam matematika kedatanganmu.'
  }
};

var HERO_ANGLES = [
  'ancient scrolls and forgotten libraries',
  'stars and constellations',
  'fingerprints and the uniqueness of arrival',
  'rivers of time',
  'woven threads and tapestries of fate',
  'geometry and sacred mathematics',
  'old maps and hidden paths',
  'candlelight and quiet ritual',
  'the turning of seasons',
  'echoes passed through generations'
];

function buildHeroPrompt(lang, idx) {
  var isID = lang === 'id';
  var angle = HERO_ANGLES[idx % HERO_ANGLES.length];

  var system = isID
    ? 'Kamu adalah penulis merek untuk aplikasi numerologi mewah bernama Digit Destiny. Tulis HANYA dalam format tiga baris yang diminta, SELURUHNYA dalam Bahasa Indonesia — termasuk judul dan paragraf, bukan hanya instruksinya. DILARANG KERAS menggunakan tanda bintang, tanda pagar, atau format markdown apapun, dan DILARANG menulis dalam Bahasa Inggris.'
    : 'You are the brand copywriter for a luxury numerology app called Digit Destiny. Write ONLY in the exact three-line format requested. NEVER use asterisks, hashtags, or any markdown formatting.';

  var user = isID
    ? 'Tulis ulang judul utama beranda dalam nada mistik yang hangat dan elegan, terinspirasi tema: ' + angle + '. Balas PERSIS dalam tiga baris ini, SELURUHNYA dalam Bahasa Indonesia (jangan gunakan Bahasa Inggris sama sekali untuk isinya), tanpa teks lain:\nMAIN: <baris judul utama dalam Bahasa Indonesia, 3-6 kata>\nEM: <baris kedua yang ditekankan dalam Bahasa Indonesia, 3-6 kata>\nLORE: <satu paragraf 40-70 kata dalam Bahasa Indonesia tentang kebijaksanaan numerologi kuno, nada hangat dan personal>'
    : 'Rewrite the homepage hero headline in a warm, elegant, mystical tone, inspired by the theme: ' + angle + '. Reply in EXACTLY this three-line format, no other text:\nMAIN: <main headline line, 3-6 words>\nEM: <emphasized second line, 3-6 words>\nLORE: <one paragraph, 40-70 words, about ancient numerological wisdom, warm and personal tone>';

  return { system: system, user: user };
}

function validateHeroLine(text) {
  if (!text || text.length < 2 || text.length > 60) return false;
  var forbidden = ['<', '>', 'http', 'undefined', 'null'];
  for (var i = 0; i < forbidden.length; i++) {
    if (text.indexOf(forbidden[i]) !== -1) return false;
  }
  return true;
}

function parseHeroResponse(text) {
  if (!text) return null;
  var mainMatch = text.match(/^MAIN:\s*(.+)$/im);
  var emMatch   = text.match(/^EM:\s*(.+)$/im);
  var loreMatch = text.match(/^LORE:\s*([\s\S]+)$/im);

  if (!mainMatch || !emMatch || !loreMatch) return null;

  var main = mainMatch[1].trim();
  var em   = emMatch[1].trim();
  var lore = loreMatch[1].trim();

  if (!validateHeroLine(main)) return null;
  if (!validateHeroLine(em)) return null;
  if (!validateAIOutput(lore)) return null;

  return { main: main, em: em, lore: lore };
}

async function generateHeroVariant(env, lang, idx) {
  var prompt = buildHeroPrompt(lang, idx);
  var text = await callAI(env, prompt.system, prompt.user);
  text = stripMarkdown(text);
  var parsed = parseHeroResponse(text);
  if (!parsed) return false;

  await kvSet(env.DIGIT_DESTINY_KV, 'v2:hero:' + lang + ':' + idx, JSON.stringify(parsed));
  return true;
}

// ── KV HELPERS ──
async function kvGet(kv, key) {
  try { return await kv.get(key); }
  catch (e) { return null; }
}

async function kvSet(kv, key, value, ttl) {
  try {
    if (ttl) {
      await kv.put(key, value, { expirationTtl: ttl });
    } else {
      await kv.put(key, value);
    }
  } catch (e) { console.error("sendTelegram error:", e, "token present:", !!env.DIGDEST_TELEGRAM_BOT_TOKEN); }
}

// ── ROUTE HANDLERS ──

async function handleCalculate(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body || !body.birth_date) {
    return errorResponse('INVALID_DATE', 'birth_date is required');
  }
  if (!isValidDate(body.birth_date)) {
    return errorResponse('INVALID_DATE', 'Invalid or future date');
  }

  var result = calculateNumber(body.birth_date);
  if (!result || result.number < 1 || result.number > 9) {
    return errorResponse('INVALID_NUMBER', 'Could not compute a valid number');
  }

  return jsonResponse({
    birth_date: body.birth_date,
    digits: result.digits,
    steps: result.steps,
    number: result.number,
    archetype: ARCHETYPES[result.number]
  });
}

async function handleReading(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body) return errorResponse('INVALID_TYPE', 'Invalid request body');

  var number = parseInt(body.number, 10);
  var type   = body.type;
  var lang   = body.lang === 'id' ? 'id' : 'en';

  if (!number || number < 1 || number > 9) {
    return errorResponse('INVALID_NUMBER', 'number must be 1-9');
  }
  if (!type || READING_TYPES.indexOf(type) === -1) {
    return errorResponse('INVALID_TYPE', 'type must be one of: ' + READING_TYPES.join(', '));
  }

  var cacheKey = 'v2:reading:' + lang + ':' + number + ':' + type;
  var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
  if (cached) {
    return jsonResponse({ number: number, type: type, text: cached, fallback: false, cached: true });
  }

  var archetype = ARCHETYPES[number];
  var prompt = buildPrompt(type, number, archetype, null, lang);
  var text = await callAI(env, prompt.system, prompt.user);
  text = stripMarkdown(text);

  if (!text || !validateAIOutput(text)) {
    return jsonResponse({
      number: number,
      type: type,
      text: getFallback(type, number),
      fallback: true,
      cached: false
    });
  }

  await kvSet(env.DIGIT_DESTINY_KV, cacheKey, text);
  return jsonResponse({ number: number, type: type, text: text, fallback: false, cached: false });
}

async function handleCompatibility(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body) return errorResponse('INVALID_NUMBER', 'Invalid request body');

  var numA = parseInt(body.number_a, 10);
  var numB = parseInt(body.number_b, 10);
  var lang = body.lang === 'id' ? 'id' : 'en';

  if (!numA || numA < 1 || numA > 9 || !numB || numB < 1 || numB > 9) {
    return errorResponse('INVALID_NUMBER', 'number_a and number_b must be 1-9');
  }

  var minNum = Math.min(numA, numB);
  var maxNum = Math.max(numA, numB);
  var cacheKey = 'v2:compat:' + lang + ':' + minNum + '_' + maxNum;

  var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
  if (cached) {
    var parsed = JSON.parse(cached);
    return jsonResponse({
      number_a: minNum,
      number_b: maxNum,
      score: parsed.score,
      text: parsed.text,
      fallback: false,
      cached: true
    });
  }

  var prompt = buildPrompt('compatibility', null, null, { number_a: minNum, number_b: maxNum }, lang);
  var text = await callAI(env, prompt.system, prompt.user);
  text = stripMarkdown(text);

  var score = 50;
  var readingText = '';

  if (!text || !validateAIOutput(text)) {
    readingText = lang === 'id'
      ? 'Kedua angka jalur hidup ini membawa energi yang saling melengkapi dan dapat menciptakan koneksi yang bermakna bila dijalani dengan kesadaran dan saling menghormati.'
      : 'These two life path numbers bring complementary energies that can create a balanced and meaningful connection when approached with awareness and mutual respect.';
    return jsonResponse({
      number_a: minNum,
      number_b: maxNum,
      score: score,
      text: readingText,
      fallback: true,
      cached: false
    });
  }

  var extracted = extractCompatScore(text);
  score = extracted.score;
  readingText = extracted.text;

  await kvSet(env.DIGIT_DESTINY_KV, cacheKey, JSON.stringify({ score: score, text: readingText }));
  return jsonResponse({
    number_a: minNum,
    number_b: maxNum,
    score: score,
    text: readingText,
    fallback: false,
    cached: false
  });
}

async function handleDaily(number, req, env) {
  var num = parseInt(number, 10);
  if (!num || num < 1 || num > 9) {
    return errorResponse('INVALID_NUMBER', 'number must be 1-9');
  }

  var url = new URL(req.url);
  var lang = url.searchParams.get('lang') === 'id' ? 'id' : 'en';

  var today = getTodayUTC();
  var cacheKey = 'v2:daily:' + lang + ':' + num + ':' + today;

  var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
  if (cached) {
    return jsonResponse({ number: num, date: today, text: cached, fallback: false, cached: true });
  }

  var archetype = ARCHETYPES[num];
  var prompt = buildPrompt('daily', num, archetype, { date: today }, lang);
  var text = await callAI(env, prompt.system, prompt.user);
  text = stripMarkdown(text);

  if (!text || !validateAIOutput(text)) {
    return jsonResponse({
      number: num,
      date: today,
      text: FALLBACKS.daily[num] || 'Today carries energy for reflection.',
      fallback: true,
      cached: false
    });
  }

  var secondsUntilMidnight = secondsUntilUTCMidnight();
  await kvSet(env.DIGIT_DESTINY_KV, cacheKey, text, secondsUntilMidnight);

  return jsonResponse({ number: num, date: today, text: text, fallback: false, cached: false });
}

function getTodayUTC() {
  var d = new Date();
  var mm = d.getUTCMonth() + 1;
  var dd = d.getUTCDate();
  return d.getUTCFullYear() + '-' +
    (mm < 10 ? '0' + mm : mm) + '-' +
    (dd < 10 ? '0' + dd : dd);
}

function secondsUntilUTCMidnight() {
  var now = new Date();
  var midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.floor((midnight - now) / 1000);
}

// ── TELEGRAM ──
async function handleTelegramWebhook(req, env, ctx) {
  var secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  var expectedSecret = env.DIGDEST_TELEGRAM_WEBHOOK_SECRET || "";
  if (expectedSecret && secret !== expectedSecret) {
    return new Response('Forbidden', { status: 403 });
  }

  var body = await req.json().catch(function() { return null; });
  if (!body || !body.message) return new Response('OK', { status: 200 });

  var message = body.message;
  var chatId  = message.chat && message.chat.id;
  var text    = message.text || '';

  if (!chatId) return new Response('OK', { status: 200 });

  // Process async — return 200 immediately
  await processTelegramMessage(chatId, text, env);

  return new Response('OK', { status: 200 });
}

async function processTelegramMessage(chatId, text, env) {
  text = text.trim();

  if (text.startsWith('/start')) {
    var parts = text.split(' ');
    var dateArg = parts[1] ? parts[1].trim() : '';

    if (!dateArg || !isValidDate(dateArg)) {
      await sendTelegram(env, chatId,
        'Welcome to Digit Destiny.\n\nTo discover your Life Path Number, send your birth date in this format:\n/start YYYY-MM-DD\n\nExample: /start 1990-03-15\n\nOr visit: ' + APP_DOMAIN);
      return;
    }

    var calc = calculateNumber(dateArg);
    if (!calc || calc.number < 1 || calc.number > 9) {
      await sendTelegram(env, chatId, 'That date could not be processed. Please try again with format YYYY-MM-DD.');
      return;
    }

    await kvSet(env.DIGIT_DESTINY_KV, 'tg:' + chatId, JSON.stringify({
      chat_id: chatId,
      number: calc.number,
      subscribed_at: new Date().toISOString(),
      active: true
    }));

    await sendTelegram(env, chatId,
      'Your Life Path Number is ' + calc.number + ' — ' + ARCHETYPES[calc.number] + '.\n\nYou are now subscribed to daily insights. I will send you a reading each morning.\n\nFor your full reading, visit:\n' + APP_DOMAIN + '\n\nCommands:\n/today — get today\'s insight\n/myprofile — see your number\n/weton YYYY-MM-DD — Javanese weton reading\n/jodoh YYYY-MM-DD YYYY-MM-DD — weton compatibility\n/stop — unsubscribe');

  } else if (text === '/today') {
    var sub = await getTelegramSub(chatId, env);
    if (!sub) {
      await sendTelegram(env, chatId, 'You are not registered yet. Send /start YYYY-MM-DD with your birth date.');
      return;
    }
    var daily = await getDailyText(sub.number, env);
    await sendTelegram(env, chatId, 'Life Path ' + sub.number + ' · Today\n\n' + daily);

  } else if (text === '/myprofile') {
    var sub = await getTelegramSub(chatId, env);
    if (!sub) {
      await sendTelegram(env, chatId, 'You are not registered yet. Send /start YYYY-MM-DD with your birth date.');
      return;
    }
    await sendTelegram(env, chatId,
      'Your Life Path Number: ' + sub.number + '\nArchetype: ' + ARCHETYPES[sub.number] +
      '\nSubscribed: ' + sub.subscribed_at.split('T')[0] +
      '\n\nFull reading: ' + APP_DOMAIN);

  } else if (text.startsWith('/weton')) {
    var wetonParts = text.split(' ');
    var wetonDateArg = wetonParts[1] ? wetonParts[1].trim() : '';

    if (!wetonDateArg || !isValidDate(wetonDateArg)) {
      await sendTelegram(env, chatId,
        'To discover your weton, send your birth date in this format:\n/weton YYYY-MM-DD\n\nExample: /weton 1990-03-15');
      return;
    }

    var wetonCalc = calculateWeton(wetonDateArg);
    var wetonCacheKey = 'v2:weton:reading:en:' + wetonCalc.weton_name;
    var wetonText = await kvGet(env.DIGIT_DESTINY_KV, wetonCacheKey);
    if (!wetonText) wetonText = getWetonCharacterFallback(wetonCalc.neptu);

    await sendTelegram(env, chatId,
      'Your weton is ' + wetonCalc.weton_name + ' (neptu ' + wetonCalc.neptu + ', wuku ' + wetonCalc.wuku + ').\n\n' +
      wetonText + '\n\nFor jodoh compatibility: /jodoh YYYY-MM-DD YYYY-MM-DD\nFull reading: ' + APP_DOMAIN);

  } else if (text.startsWith('/jodoh')) {
    var jodohParts = text.split(' ');
    var jodohDateA = jodohParts[1] ? jodohParts[1].trim() : '';
    var jodohDateB = jodohParts[2] ? jodohParts[2].trim() : '';

    if (!jodohDateA || !jodohDateB || !isValidDate(jodohDateA) || !isValidDate(jodohDateB)) {
      await sendTelegram(env, chatId,
        'To check jodoh compatibility, send two birth dates:\n/jodoh YYYY-MM-DD YYYY-MM-DD\n\nExample: /jodoh 1990-03-15 1992-07-04');
      return;
    }

    var jodohCalc = calculateJodoh(jodohDateA, jodohDateB);
    var jodohCacheKey = 'v2:weton:compat:en:' + jodohCalc.category;
    var jodohText = await kvGet(env.DIGIT_DESTINY_KV, jodohCacheKey);
    if (!jodohText) jodohText = WETON_FALLBACKS.compat[jodohCalc.category];

    await sendTelegram(env, chatId,
      'Jodoh category: ' + jodohCalc.category + ' (combined neptu ' + jodohCalc.combined_neptu + ')\n\n' +
      jodohText + '\n\nFull reading: ' + APP_DOMAIN);

  } else if (text === '/stop') {
    var subRaw = await kvGet(env.DIGIT_DESTINY_KV, 'tg:' + chatId);
    if (subRaw) {
      var sub = JSON.parse(subRaw);
      sub.active = false;
      await kvSet(env.DIGIT_DESTINY_KV, 'tg:' + chatId, JSON.stringify(sub));
    }
    await sendTelegram(env, chatId, 'You have unsubscribed from daily insights. Send /start to re-subscribe any time.');

  } else {
    await sendTelegram(env, chatId,
      'I don\'t understand that command.\n\n/today — today\'s insight\n/myprofile — your number\n/weton YYYY-MM-DD — Javanese weton reading\n/jodoh YYYY-MM-DD YYYY-MM-DD — weton compatibility\n/stop — unsubscribe');
  }
}

async function getTelegramSub(chatId, env) {
  var raw = await kvGet(env.DIGIT_DESTINY_KV, 'tg:' + chatId);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (e) { return null; }
}

async function getDailyText(number, env) {
  var today = getTodayUTC();
  var cacheKey = 'v2:daily:en:' + number + ':' + today;
  var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
  if (cached) return cached;
  return FALLBACKS.daily[number] || 'Today carries energy for reflection and intention.';
}

async function sendTelegram(env, chatId, text) {
  var url = 'https://api.telegram.org/bot' + env.DIGDEST_TELEGRAM_BOT_TOKEN + '/sendMessage';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text })
    });
  } catch (e) { console.error("sendTelegram error:", e, "token present:", !!env.DIGDEST_TELEGRAM_BOT_TOKEN); }
}

// ── CRON: DAILY INSIGHT PUSH ──
async function runDailyCron(env) {
  var today = getTodayUTC();

  // Pre-generate insights for all 9 numbers in both languages
  var cronLangs = ['en', 'id'];
  for (var cli = 0; cli < cronLangs.length; cli++) {
    var cronLang = cronLangs[cli];
    for (var n = 1; n <= 9; n++) {
      var cacheKey = 'v2:daily:' + cronLang + ':' + n + ':' + today;
      var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
      if (!cached) {
        var cronPrompt = buildPrompt('daily', n, ARCHETYPES[n], { date: today }, cronLang);
        var text = await callAI(env, cronPrompt.system, cronPrompt.user);
        text = stripMarkdown(text);
        if (text && validateAIOutput(text)) {
          var ttl = secondsUntilUTCMidnight();
          await kvSet(env.DIGIT_DESTINY_KV, cacheKey, text, ttl);
        }
      }
    }
  }

  // Send to all active subscribers
  var list = await env.DIGIT_DESTINY_KV.list({ prefix: 'tg:' });
  if (!list || !list.keys) return;

  for (var i = 0; i < list.keys.length; i++) {
    var key = list.keys[i].name;
    var subRaw = await kvGet(env.DIGIT_DESTINY_KV, key);
    if (!subRaw) continue;
    var sub;
    try { sub = JSON.parse(subRaw); }
    catch (e) { continue; }
    if (!sub.active) continue;

    var dailyText = await getDailyText(sub.number, env);
    await sendTelegram(env, sub.chat_id,
      'Life Path ' + sub.number + ' · ' + today + '\n\n' + dailyText);
  }
}

// ── CRON: HERO HEADLINE ROTATION ──
// Advances the fixed 30-day hero cursor by one each midnight UTC.
// No AI calls here — the 30 variants are generated once via /api/warm?n=hero.
async function runHeroCron(env) {
  var cursorRaw = await kvGet(env.DIGIT_DESTINY_KV, 'v2:hero:cursor');
  var cursor = cursorRaw ? parseInt(cursorRaw, 10) : 0;
  if (isNaN(cursor) || cursor < 0 || cursor >= HERO_VARIANT_COUNT) cursor = 0;
  var next = (cursor + 1) % HERO_VARIANT_COUNT;
  await kvSet(env.DIGIT_DESTINY_KV, 'v2:hero:cursor', String(next));
}

// ── WARM CACHE ──
// GET /api/warm?secret=X&n=1  — warms one number at a time (8 AI calls max per request)
// Run once per number 1-9, then once with n=daily to warm today's daily insights
// Re-running is safe — skips already-cached keys
// ?n=status returns cache coverage without generating anything
async function handleWarm(req, env) {
  var url = new URL(req.url);
  var secret = url.searchParams.get('secret');
  var adminSecret = env.DIGDEST_ADMIN_SECRET;

  if (adminSecret && secret !== adminSecret) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders() });
  }

  var n = url.searchParams.get('n');
  var today = getTodayUTC();
  var results = [];

  // ?n=status — show what is and isn't cached, no AI calls
  if (n === 'status') {
    var langs = ['en', 'id'];
    for (var li = 0; li < langs.length; li++) {
      var slang = langs[li];
      for (var sn = 1; sn <= 9; sn++) {
        for (var sti = 0; sti < READING_TYPES.length; sti++) {
          var skey = 'v2:reading:' + slang + ':' + sn + ':' + READING_TYPES[sti];
          var sv = await kvGet(env.DIGIT_DESTINY_KV, skey);
          results.push({ key: skey, cached: !!sv });
        }
      }
    }
    for (var sdn = 1; sdn <= 9; sdn++) {
      var sdlangs = ['en', 'id'];
      for (var sdli = 0; sdli < sdlangs.length; sdli++) {
        var sdkey = 'v2:daily:' + sdlangs[sdli] + ':' + sdn + ':' + today;
        var sdv = await kvGet(env.DIGIT_DESTINY_KV, sdkey);
        results.push({ key: sdkey, cached: !!sdv });
      }
    }
    var swlangs = ['en', 'id'];
    for (var swli = 0; swli < swlangs.length; swli++) {
      var swlang = swlangs[swli];
      for (var swi = 0; swi < WEEKDAY_NAMES.length; swi++) {
        for (var swpi = 0; swpi < PASARAN_ORDER.length; swpi++) {
          var swkey = 'v2:weton:reading:' + swlang + ':' + WEEKDAY_NAMES[swi] + ' ' + PASARAN_ORDER[swpi];
          var swv = await kvGet(env.DIGIT_DESTINY_KV, swkey);
          results.push({ key: swkey, cached: !!swv });
        }
      }
      for (var swci = 0; swci < JODOH_CATEGORIES.length; swci++) {
        var swckey = 'v2:weton:compat:' + swlang + ':' + JODOH_CATEGORIES[swci];
        var swcv = await kvGet(env.DIGIT_DESTINY_KV, swckey);
        results.push({ key: swckey, cached: !!swcv });
      }
    }
    var totalCached = results.filter(function(r) { return r.cached; }).length;
    return jsonResponse({ ok: true, coverage: totalCached + '/' + results.length, detail: results });
  }

  // ?n=daily — warm today's daily insights for both EN and ID
  if (n === 'daily') {
    var dlangs = ['en', 'id'];
    for (var dli = 0; dli < dlangs.length; dli++) {
      var dlang = dlangs[dli];
      for (var dn = 1; dn <= 9; dn++) {
        var dailyKey = 'v2:daily:' + dlang + ':' + dn + ':' + today;
        var dailyCached = await kvGet(env.DIGIT_DESTINY_KV, dailyKey);
        if (dailyCached && !force) {
          results.push({ key: dailyKey, status: 'already_cached' });
          continue;
        }
        var dailyPrompt = buildPrompt('daily', dn, ARCHETYPES[dn], { date: today }, dlang);
        var dailyText = await callAI(env, dailyPrompt.system, dailyPrompt.user);
        dailyText = stripMarkdown(dailyText);
        if (dailyText && validateAIOutput(dailyText)) {
          var ttl = secondsUntilUTCMidnight();
          await kvSet(env.DIGIT_DESTINY_KV, dailyKey, dailyText, ttl);
          results.push({ key: dailyKey, status: 'generated' });
        } else {
          results.push({ key: dailyKey, status: 'ai_failed' });
        }
      }
    }
    var dgen = results.filter(function(r) { return r.status === 'generated'; }).length;
    var dfail = results.filter(function(r) { return r.status === 'ai_failed'; }).length;
    return jsonResponse({ ok: true, number: 'daily', generated: dgen, failed: dfail, detail: results });
  }

  // ?n=hero — seed the fixed 30-day hero rotation. 30 variants x 2 langs = 60
  // slots total. Processes at most &batch= slots per call (default 10) so a
  // single request finishes quickly instead of blocking on up to 60
  // sequential AI calls. Re-running is safe and resumable — it skips
  // already-cached slots (unless &force=1) and picks up where it left off.
  if (n === 'hero') {
    var heroForce = url.searchParams.get('force') === '1';
    var heroBatch = parseInt(url.searchParams.get('batch'), 10);
    if (!heroBatch || heroBatch < 1) heroBatch = 10;

    var heroLangFilter = url.searchParams.get('lang');
    var heroLangs = (heroLangFilter === 'en' || heroLangFilter === 'id') ? [heroLangFilter] : ['en', 'id'];
    var heroStart = parseInt(url.searchParams.get('start'), 10);
    if (isNaN(heroStart) || heroStart < 0) heroStart = 0;
    var heroProcessed = 0;
    var heroDone = true;

    outer:
    for (var hli = 0; hli < heroLangs.length; hli++) {
      var hlang = heroLangs[hli];
      for (var hidx = heroStart; hidx < HERO_VARIANT_COUNT; hidx++) {
        var heroKey = 'v2:hero:' + hlang + ':' + hidx;
        if (!heroForce) {
          var heroCached = await kvGet(env.DIGIT_DESTINY_KV, heroKey);
          if (heroCached) {
            results.push({ key: heroKey, status: 'already_cached' });
            continue;
          }
        }
        if (heroProcessed >= heroBatch) {
          heroDone = false;
          break outer;
        }
        var heroOk = await generateHeroVariant(env, hlang, hidx);
        results.push({ key: heroKey, status: heroOk ? 'generated' : 'ai_failed' });
        heroProcessed++;
      }
    }
    var hgen = results.filter(function(r) { return r.status === 'generated'; }).length;
    var hfail = results.filter(function(r) { return r.status === 'ai_failed'; }).length;
    var halready = results.filter(function(r) { return r.status === 'already_cached'; }).length;
    return jsonResponse({
      ok: true,
      number: 'hero',
      generated: hgen,
      already_cached: halready,
      failed: hfail,
      done: heroDone,
      message: heroDone ? 'All 60 hero slots are seeded.' : 'More slots remain — re-run the same request to continue.',
      detail: results
    });
  }

  // ?n=weton — warm all 35 weton character readings + 8 jodoh categories,
  // both languages. Idempotent — skips already-cached keys unless &force=1.
  if (n === 'weton') {
    var wetonForce = url.searchParams.get('force') === '1';
    var wetonLangs = ['en', 'id'];

    for (var wli2 = 0; wli2 < wetonLangs.length; wli2++) {
      var wlang2 = wetonLangs[wli2];

      for (var wdi = 0; wdi < WEEKDAY_NAMES.length; wdi++) {
        for (var wpi = 0; wpi < PASARAN_ORDER.length; wpi++) {
          var wetonName = WEEKDAY_NAMES[wdi] + ' ' + PASARAN_ORDER[wpi];
          var wetonKey = 'v2:weton:reading:' + wlang2 + ':' + wetonName;
          if (!wetonForce) {
            var wetonCached = await kvGet(env.DIGIT_DESTINY_KV, wetonKey);
            if (wetonCached) {
              results.push({ key: wetonKey, status: 'already_cached' });
              continue;
            }
          }
          var wetonNeptu = WEEKDAY_NEPTU[wdi] + PASARAN_NEPTU[PASARAN_ORDER[wpi]];
          var wetonData = { weton_name: wetonName, neptu: wetonNeptu, wuku: '' };
          var wetonPrompt = buildWetonPrompt('weton_character', wetonData, wlang2);
          var wetonText = await callAI(env, wetonPrompt.system, wetonPrompt.user);
          wetonText = stripMarkdown(wetonText);
          if (wetonText && validateAIOutput(wetonText)) {
            await kvSet(env.DIGIT_DESTINY_KV, wetonKey, wetonText);
            results.push({ key: wetonKey, status: 'generated' });
          } else {
            results.push({ key: wetonKey, status: 'ai_failed' });
          }
        }
      }

      for (var wci = 0; wci < JODOH_CATEGORIES.length; wci++) {
        var category = JODOH_CATEGORIES[wci];
        var compatKey = 'v2:weton:compat:' + wlang2 + ':' + category;
        if (!wetonForce) {
          var compatCached = await kvGet(env.DIGIT_DESTINY_KV, compatKey);
          if (compatCached) {
            results.push({ key: compatKey, status: 'already_cached' });
            continue;
          }
        }
        var compatPrompt = buildWetonPrompt('weton_compat', { category: category, meaning: JODOH_MEANING[category] }, wlang2);
        var compatText = await callAI(env, compatPrompt.system, compatPrompt.user);
        compatText = stripMarkdown(compatText);
        if (compatText && validateAIOutput(compatText)) {
          await kvSet(env.DIGIT_DESTINY_KV, compatKey, compatText);
          results.push({ key: compatKey, status: 'generated' });
        } else {
          results.push({ key: compatKey, status: 'ai_failed' });
        }
      }
    }

    var wgen = results.filter(function(r) { return r.status === 'generated'; }).length;
    var walready = results.filter(function(r) { return r.status === 'already_cached'; }).length;
    var wfail = results.filter(function(r) { return r.status === 'ai_failed'; }).length;
    return jsonResponse({ ok: true, number: 'weton', generated: wgen, already_cached: walready, failed: wfail, detail: results });
  }

  // ?n=1..9 — warm one life path number (4 types x 2 langs = 8 AI calls max)
  var num = parseInt(n, 10);
  if (!num || num < 1 || num > 9) {
    return jsonResponse({
      ok: false,
      error: 'Pass ?n=1 through ?n=9 to warm one number, ?n=daily for daily insights, ?n=hero to seed the hero rotation, ?n=weton to seed weton/jodoh readings, or ?n=status to check coverage.'
    }, 400);
  }

  var force = url.searchParams.get('force') === '1';
  var archetype = ARCHETYPES[num];
  var wlangs = ['en', 'id'];
  for (var wli = 0; wli < wlangs.length; wli++) {
    var wlang = wlangs[wli];
    for (var wti = 0; wti < READING_TYPES.length; wti++) {
      var wtype = READING_TYPES[wti];
      var cacheKey = 'v2:reading:' + wlang + ':' + num + ':' + wtype;
      if (!force) {
        var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
        if (cached) {
          results.push({ key: cacheKey, status: 'already_cached' });
          continue;
        }
      }
      var prompt = buildPrompt(wtype, num, archetype, null, wlang);
      var text = await callAI(env, prompt.system, prompt.user);
      text = stripMarkdown(text);
      if (text && validateAIOutput(text)) {
        await kvSet(env.DIGIT_DESTINY_KV, cacheKey, text);
        results.push({ key: cacheKey, status: 'generated' });
      } else {
        results.push({ key: cacheKey, status: 'ai_failed' });
      }
    }
  }

  var generated = results.filter(function(r) { return r.status === 'generated'; }).length;
  var already = results.filter(function(r) { return r.status === 'already_cached'; }).length;
  var failed = results.filter(function(r) { return r.status === 'ai_failed'; }).length;

  return jsonResponse({ ok: true, number: num, generated: generated, already_cached: already, failed: failed, detail: results });
}

// ── SYNTHESIS ──
async function handleSynthesis(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body) return errorResponse('INVALID_REQUEST', 'Invalid request body');

  var lifepath  = parseInt(body.lifepath, 10);
  var zodiacKey = (body.zodiac_key || '').trim();
  var lang      = body.lang === 'id' ? 'id' : 'en';

  if (!lifepath || lifepath < 1 || lifepath > 9) {
    return errorResponse('INVALID_NUMBER', 'lifepath must be 1-9');
  }
  if (!zodiacKey) {
    return errorResponse('INVALID_ZODIAC', 'zodiac_key required');
  }

  var cacheKey = 'v2:synthesis:' + lang + ':' + lifepath + ':' + zodiacKey.replace(/\s+/g, '_');
  var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
  if (cached) {
    return jsonResponse({ text: cached, fallback: false, cached: true });
  }

  var archetype = ARCHETYPES[lifepath];
  var isID = lang === 'id';

  var system = isID
    ? 'Kamu adalah juru tafsir kepribadian. Tulis HANYA teks bacaan dalam satu paragraf mengalir. DILARANG KERAS menggunakan tanda bintang, tanda pagar, peluru, atau format markdown apapun. Tulis sebagai prosa biasa yang hangat dan personal dalam Bahasa Indonesia.'
    : 'You are a personality interpreter. Write ONLY the reading as flowing prose. NEVER use asterisks, hashtags, bullets, bold, italics, labels, or any markdown. Plain warm personal prose only. No titles, no section headers.';

  var user = isID
    ? 'Tulis potret kepribadian gabungan untuk seseorang yang merupakan Jalur Hidup ' + lifepath + ' (' + archetype + ') dan ' + zodiacKey + ' dalam zodiak Tionghoa. Gabungkan kedua sistem secara alami — jangan sebut nama sistem. Tunjukkan bagaimana keduanya menciptakan kepribadian yang unik, termasuk kekuatan dan tegangan di antara keduanya. Satu paragraf mengalir, 120-140 kata Bahasa Indonesia.'
    : 'Write a combined personality portrait for someone who is Life Path ' + lifepath + ' (' + archetype + ') and a ' + zodiacKey + ' in the Chinese zodiac. Weave both systems together naturally — do not name the systems. Show how they create a unique personality, including the strengths and tensions between them. One flowing paragraph, 120-140 words.';

  var text = await callAI(env, system, user);
  text = stripMarkdown(text);

  if (!text || !validateAIOutput(text)) {
    var fallback = isID
      ? 'Jalur Hidup ' + lifepath + ' dan ' + zodiacKey + ' membentuk perpaduan kepribadian yang kaya — satu sistem membawa struktur dan tujuan, yang lain membawa warna dan cara kamu bergerak di dunia. Keduanya bekerja sama untuk membentuk siapa dirimu sebenarnya.'
      : 'Life Path ' + lifepath + ' and the ' + zodiacKey + ' form a rich personality blend — one system bringing structure and purpose, the other bringing color and the way you move through the world. Together they shape who you actually are.';
    return jsonResponse({ text: fallback, fallback: true, cached: false });
  }

  await kvSet(env.DIGIT_DESTINY_KV, cacheKey, text);
  return jsonResponse({ text: text, fallback: false, cached: false });
}

// ── HERO HEADLINE ──
async function handleHero(req, env) {
  var url = new URL(req.url);
  var lang = url.searchParams.get('lang') === 'id' ? 'id' : 'en';

  var cursorRaw = await kvGet(env.DIGIT_DESTINY_KV, 'v2:hero:cursor');
  var cursor = cursorRaw ? parseInt(cursorRaw, 10) : 0;
  if (isNaN(cursor) || cursor < 0 || cursor >= HERO_VARIANT_COUNT) cursor = 0;

  var stored = await kvGet(env.DIGIT_DESTINY_KV, 'v2:hero:' + lang + ':' + cursor);
  if (stored) {
    try {
      var parsed = JSON.parse(stored);
      return jsonResponse({ main: parsed.main, em: parsed.em, lore: parsed.lore, index: cursor, fallback: false });
    } catch (e) {
      // fall through to fallback
    }
  }

  var fb = HERO_FALLBACK[lang];
  return jsonResponse({ main: fb.main, em: fb.em, lore: fb.lore, index: cursor, fallback: true });
}

// ── WETON / PRIMBON ROUTE HANDLERS ──

async function handleWetonCalculate(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body || !body.birth_date) {
    return errorResponse('INVALID_DATE', 'birth_date is required');
  }
  if (!isValidDate(body.birth_date)) {
    return errorResponse('INVALID_DATE', 'Invalid or future date');
  }

  var effectiveDate = resolveJavaneseDate(body.birth_date, body.birth_time, body.lat, body.lon);
  var result = calculateWeton(effectiveDate);
  result.input_date = body.birth_date;
  result.maghrib_shifted = effectiveDate !== body.birth_date;

  return jsonResponse(result);
}

async function handleWetonReading(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body || !body.birth_date) return errorResponse('INVALID_DATE', 'birth_date is required');
  if (!isValidDate(body.birth_date)) return errorResponse('INVALID_DATE', 'Invalid or future date');

  var lang = body.lang === 'id' ? 'id' : 'en';
  // Always recompute weton server-side from birth_date — never trust a
  // client-echoed weton, so the KV cache key can't be spoofed.
  var effectiveDate = resolveJavaneseDate(body.birth_date, body.birth_time, body.lat, body.lon);
  var weton = calculateWeton(effectiveDate);

  var cacheKey = 'v2:weton:reading:' + lang + ':' + weton.weton_name;
  var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
  if (cached) {
    return jsonResponse({ weton: weton, text: cached, fallback: false, cached: true });
  }

  var prompt = buildWetonPrompt('weton_character', weton, lang);
  var text = await callAI(env, prompt.system, prompt.user);
  text = stripMarkdown(text);

  if (!text || !validateAIOutput(text)) {
    return jsonResponse({ weton: weton, text: getWetonCharacterFallback(weton.neptu), fallback: true, cached: false });
  }

  await kvSet(env.DIGIT_DESTINY_KV, cacheKey, text);
  return jsonResponse({ weton: weton, text: text, fallback: false, cached: false });
}

async function handleWetonJodoh(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body || !body.birth_date_a || !body.birth_date_b) {
    return errorResponse('INVALID_DATE', 'birth_date_a and birth_date_b are required');
  }
  if (!isValidDate(body.birth_date_a) || !isValidDate(body.birth_date_b)) {
    return errorResponse('INVALID_DATE', 'Invalid or future date');
  }

  var lang = body.lang === 'id' ? 'id' : 'en';
  var jodoh = calculateJodoh(body.birth_date_a, body.birth_date_b);

  var cacheKey = 'v2:weton:compat:' + lang + ':' + jodoh.category;
  var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
  if (cached) {
    return jsonResponse({ jodoh: jodoh, text: cached, fallback: false, cached: true });
  }

  var prompt = buildWetonPrompt('weton_compat', jodoh, lang);
  var text = await callAI(env, prompt.system, prompt.user);
  text = stripMarkdown(text);

  if (!text || !validateAIOutput(text)) {
    return jsonResponse({ jodoh: jodoh, text: WETON_FALLBACKS.compat[jodoh.category], fallback: true, cached: false });
  }

  await kvSet(env.DIGIT_DESTINY_KV, cacheKey, text);
  return jsonResponse({ jodoh: jodoh, text: text, fallback: false, cached: false });
}

async function handleWetonPetungan(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body || !body.event_type || !body.event_date) {
    return errorResponse('INVALID_REQUEST', 'event_type and event_date are required');
  }
  if (PETUNGAN_EVENT_TYPES.indexOf(body.event_type) === -1) {
    return errorResponse('INVALID_EVENT_TYPE', 'event_type must be one of: ' + PETUNGAN_EVENT_TYPES.join(', '));
  }
  if (!isValidDate(body.event_date)) {
    return errorResponse('INVALID_DATE', 'Invalid or future date');
  }

  var lang = body.lang === 'id' ? 'id' : 'en';
  var match = matchPetungan(body.event_type, body.event_date);

  var outcomeKey = match.recommended ? 'good' : 'reconsider';
  var cacheKey = 'v2:weton:goodday:' + lang + ':' + body.event_type + ':' + outcomeKey;
  var cached = await kvGet(env.DIGIT_DESTINY_KV, cacheKey);
  if (cached) {
    return jsonResponse({ match: match, text: cached, fallback: false, cached: true });
  }

  var prompt = buildWetonPrompt('weton_goodday', match, lang);
  var text = await callAI(env, prompt.system, prompt.user);
  text = stripMarkdown(text);

  if (!text || !validateAIOutput(text)) {
    return jsonResponse({ match: match, text: WETON_FALLBACKS.goodday[body.event_type], fallback: true, cached: false });
  }

  await kvSet(env.DIGIT_DESTINY_KV, cacheKey, text);
  return jsonResponse({ match: match, text: text, fallback: false, cached: false });
}

// ── DONATIONS ──
// One-time + recurring monthly via Stripe, plus a PayPal option, for
// infrastructure/API cost support (free feature — no billing tied to any
// reading). No npm dependencies exist in this project, so Stripe is called
// directly via fetch() against its REST API (same no-SDK pattern as
// callAI()'s OpenRouter calls) rather than the stripe-node SDK.

function bufferToHex(buffer) {
  var bytes = new Uint8Array(buffer);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    hex += h.length === 1 ? '0' + h : h;
  }
  return hex;
}

// Manually verifies a Stripe webhook signature (t=...,v1=... scheme) via Web
// Crypto HMAC-SHA256, since there is no stripe SDK available to call
// constructEvent() for us.
async function verifyStripeSignature(payload, sigHeader, secret) {
  var parts = sigHeader.split(',');
  var timestamp = '';
  var signature = '';
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    if (kv[0] === 't') timestamp = kv[1];
    if (kv[0] === 'v1') signature = kv[1];
  }
  if (!timestamp || !signature) return false;

  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  var sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(timestamp + '.' + payload));
  return bufferToHex(sigBuffer) === signature;
}

async function handleStripeCheckout(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body || !body.amount) return errorResponse('INVALID_AMOUNT', 'amount is required');

  var amount = parseFloat(body.amount);
  if (!amount || amount < 1) return errorResponse('INVALID_AMOUNT', 'amount must be at least 1');

  var interval = body.interval === 'month' ? 'month' : null;
  var mode = interval ? 'subscription' : 'payment';
  var unitAmount = Math.round(amount * 100);

  // Inline price_data, not a pre-created Price catalog — the donor picks the
  // amount at checkout time, so there is nothing to keep in sync.
  var params = new URLSearchParams();
  params.set('mode', mode);
  params.set('success_url', APP_DOMAIN + '/support.html?donated=1');
  params.set('cancel_url', APP_DOMAIN + '/support.html?cancelled=1');
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(unitAmount));
  params.set('line_items[0][price_data][product_data][name]', interval ? 'Digit Destiny Monthly Support' : 'Digit Destiny Donation');
  if (interval) {
    params.set('line_items[0][price_data][recurring][interval]', interval);
  }

  var res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.DIGDEST_STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!res.ok) {
    return errorResponse('STRIPE_ERROR', 'Could not create checkout session', 502);
  }

  var data = await res.json();
  return jsonResponse({ checkout_url: data.url });
}

async function handleStripeWebhook(req, env) {
  var sigHeader = req.headers.get('stripe-signature');
  var rawBody = await req.text();

  if (!sigHeader || !env.DIGDEST_STRIPE_WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 400 });
  }

  var valid = await verifyStripeSignature(rawBody, sigHeader, env.DIGDEST_STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response('Invalid signature', { status: 400 });
  }

  var event = JSON.parse(rawBody);

  if (event.type === 'checkout.session.completed') {
    var session = event.data.object;
    await kvSet(env.DIGIT_DESTINY_KV, 'donation:stripe:' + session.id, JSON.stringify({
      amount: session.amount_total ? session.amount_total / 100 : null,
      interval: session.mode === 'subscription' ? 'month' : null,
      provider: 'stripe',
      created_at: new Date().toISOString()
    }));
  } else if (event.type === 'customer.subscription.deleted') {
    var sub = event.data.object;
    await kvSet(env.DIGIT_DESTINY_KV, 'donation:stripe:cancel:' + sub.id, JSON.stringify({
      subscription_id: sub.id,
      cancelled_at: new Date().toISOString()
    }));
  }

  return new Response('OK', { status: 200 });
}

// PayPal's JS SDK handles the capture flow client-side; this just logs a
// successful donation server-side for parity with the Stripe path, since
// PayPal's OAuth client-credentials REST flow is meaningfully more backend
// code than reusing the SDK's onApprove result.
async function handlePaypalLog(req, env) {
  var body = await req.json().catch(function() { return null; });
  if (!body || !body.order_id || !body.amount) {
    return errorResponse('INVALID_REQUEST', 'order_id and amount are required');
  }

  await kvSet(env.DIGIT_DESTINY_KV, 'donation:paypal:' + body.order_id, JSON.stringify({
    amount: body.amount,
    interval: body.interval === 'month' ? 'month' : null,
    provider: 'paypal',
    created_at: new Date().toISOString()
  }));

  return jsonResponse({ ok: true });
}

// ── MAIN HANDLER ──
export default {
  async fetch(req, env, ctx) {
    var url = new URL(req.url);
    var path = url.pathname;
    var method = req.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (path === '/api/calculate' && method === 'POST') {
      return handleCalculate(req, env);
    }

    if (path === '/api/reading' && method === 'POST') {
      return handleReading(req, env);
    }

    if (path === '/api/compatibility' && method === 'POST') {
      return handleCompatibility(req, env);
    }

    var dailyMatch = path.match(/^\/api\/daily\/(\d+)$/);
    if (dailyMatch && method === 'GET') {
      return handleDaily(dailyMatch[1], req, env);
    }

    if (path === '/api/telegram/webhook' && method === 'POST') {
      return handleTelegramWebhook(req, env, ctx);
    }

    if (path === '/api/warm' && method === 'GET') {
      return handleWarm(req, env);
    }

    if (path === '/api/synthesis' && method === 'POST') {
      return handleSynthesis(req, env);
    }

    if (path === '/api/hero' && method === 'GET') {
      return handleHero(req, env);
    }

    if (path === '/api/weton/calculate' && method === 'POST') {
      return handleWetonCalculate(req, env);
    }

    if (path === '/api/weton/reading' && method === 'POST') {
      return handleWetonReading(req, env);
    }

    if (path === '/api/weton/jodoh' && method === 'POST') {
      return handleWetonJodoh(req, env);
    }

    if (path === '/api/weton/petungan' && method === 'POST') {
      return handleWetonPetungan(req, env);
    }

    if (path === '/api/donate/stripe/checkout' && method === 'POST') {
      return handleStripeCheckout(req, env);
    }

    if (path === '/api/donate/stripe/webhook' && method === 'POST') {
      return handleStripeWebhook(req, env);
    }

    if (path === '/api/donate/paypal/log' && method === 'POST') {
      return handlePaypalLog(req, env);
    }

    return new Response(JSON.stringify({ error: true, code: 'NOT_FOUND', message: 'Route not found' }), {
      status: 404,
      headers: corsHeaders()
    });
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 0 * * *') {
      ctx.waitUntil(runHeroCron(env));
    } else {
      ctx.waitUntil(runDailyCron(env));
    }
  }
};
