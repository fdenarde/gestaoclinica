// src/features/psychology-pilot/psychologyServiceCatalog.ts
var PSYCHOLOGY_SERVICE_CATALOG = [
  { id: "psychotherapy-individual", name: "Psicoterapia Individual", defaultDurationMinutes: 50, defaultPrice: 0, modality: "BOTH", sortOrder: 1 },
  { id: "therapy-couple", name: "Terapia de Casal", defaultDurationMinutes: 50, defaultPrice: 0, modality: "BOTH", sortOrder: 2 },
  { id: "mentoring", name: "Mentoria", defaultDurationMinutes: 50, defaultPrice: 0, modality: "BOTH", sortOrder: 3 },
  { id: "eneagram-test", name: "Teste de Eneagrama", defaultDurationMinutes: 50, defaultPrice: 0, modality: "BOTH", sortOrder: 4 },
  { id: "psychotherapy-adolescent", name: "Psicoterapia Adolescente", defaultDurationMinutes: 50, defaultPrice: 0, modality: "BOTH", sortOrder: 5 }
];
var LEGACY_SERVICE_ID_ALIASES = {
  "psychology-service-psychotherapy": "psychotherapy-individual"
};
function canonicalPsychologyServiceId(value) {
  const id = String(value || "").trim();
  return LEGACY_SERVICE_ID_ALIASES[id] || id;
}
function psychologyCatalogEntry(id) {
  const canonicalId = canonicalPsychologyServiceId(id);
  return PSYCHOLOGY_SERVICE_CATALOG.find((service) => service.id === canonicalId);
}

// src/features/psychology-online-booking/bookingDomain.ts
var LOCAL_ONLINE_BOOKING_PROFESSIONAL_ID = "psychology-local-professional";
var LOCAL_ONLINE_BOOKING_DEFAULT_SLUG = "leila-chaves";
var DEFAULT_MANAGEMENT_TOKEN_TTL_DAYS = 180;
var PUBLIC_BOOKING_START_GRID_MINUTES = 60;
function normalizeProfessionalSlug(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
function normalizeSourceChannel(value) {
  const normalized = String(value || "").trim().toLocaleLowerCase();
  return normalized === "google" || normalized === "whatsapp" || normalized === "site" || normalized === "direct" ? normalized : "direct";
}
function serviceAllowsModality(service, modality) {
  if (modality === "ONLINE") return service.onlineEnabled ?? Boolean(service.modalities?.includes("ONLINE"));
  return service.inPersonEnabled ?? Boolean(service.modalities?.includes("PRESENCIAL"));
}
function isValidGoogleMapsUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return true;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && (parsed.hostname === "www.google.com" || parsed.hostname === "google.com" || parsed.hostname === "maps.google.com" || parsed.hostname === "maps.app.goo.gl" || parsed.hostname === "goo.gl");
  } catch {
    return false;
  }
}
function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : -1;
}
function minutesToTime(value) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN((/* @__PURE__ */ new Date(`${value}T12:00:00`)).getTime());
}
function dateToLocalDateTime(date, time) {
  if (!isValidIsoDate(date) || timeToMinutes(time) < 0) return null;
  const parsed = /* @__PURE__ */ new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function weekdayOf(date) {
  return (/* @__PURE__ */ new Date(`${date}T12:00:00`)).getDay();
}
function overlaps(startTime, durationMinutes, block) {
  const start = timeToMinutes(startTime);
  const end = start + durationMinutes;
  const blockStart = timeToMinutes(block.startTime);
  const blockEnd = blockStart + Math.max(1, block.durationMinutes);
  return start < blockEnd && blockStart < end;
}
function exceptionApplies(exception, modality, locationId) {
  return (!exception.modality || exception.modality === modality) && (!exception.locationId || exception.locationId === locationId);
}
function exceptionRange(exception) {
  const start = timeToMinutes(exception.startTime || "");
  const end = timeToMinutes(exception.endTime || "");
  return start >= 0 && end > start ? { start, end } : null;
}
function subtractBlockedPeriods(period, blocked) {
  let remaining = [period];
  blocked.forEach((block) => {
    remaining = remaining.flatMap((item) => {
      if (block.end <= item.start || block.start >= item.end) return [item];
      const pieces = [];
      if (item.start < block.start) pieces.push({ ...item, end: block.start });
      if (block.end < item.end) pieces.push({ ...item, start: block.end });
      return pieces.filter((piece) => piece.end > piece.start);
    });
  });
  return remaining;
}
function effectivePublicPeriods(settings, date, modality, locationId) {
  const exceptions = settings.publicBookingExceptions.filter((exception) => exception.civilDate === date && exceptionApplies(exception, modality, locationId));
  if (exceptions.some((exception) => exception.type === "BLOCK_DAY")) return [];
  const habitual = settings.publicBookingAvailability.filter((period) => period.enabled && period.dayOfWeek === weekdayOf(date) && period.modalities.includes(modality) && (modality === "ONLINE" || !period.locationIds?.length || Boolean(locationId && period.locationIds.includes(locationId)))).map((period) => ({ start: timeToMinutes(period.startTime), end: timeToMinutes(period.endTime), extra: false })).filter((period) => period.start >= 0 && period.end > period.start);
  const extras = exceptions.filter((exception) => exception.type === "OPEN_PERIOD").map((exception) => exceptionRange(exception)).filter((range) => Boolean(range)).map((range) => ({ ...range, extra: true }));
  const blocked = exceptions.filter((exception) => exception.type === "BLOCK_PERIOD").map((exception) => exceptionRange(exception)).filter((range) => Boolean(range));
  return [...habitual, ...extras].flatMap((period) => subtractBlockedPeriods(period, blocked));
}
function getPublishedSlots(input) {
  const { settings } = input;
  const service = settings.publishedServices.find((item) => item.id === input.serviceId && item.active);
  const location = input.modality === "PRESENCIAL" ? settings.locations.find((item) => item.id === input.locationId && item.active) : void 0;
  if (!settings.active || !service || !serviceAllowsModality(service, input.modality) || !settings.publishedModalities.some((item) => item.id === input.modality && item.active)) return [];
  if (input.modality === "PRESENCIAL" && (!location || !service.allowedLocationIds.includes(location.id))) return [];
  if (!isValidIsoDate(input.fromDate) || !isValidIsoDate(input.throughDate)) return [];
  const startDate = /* @__PURE__ */ new Date(`${input.fromDate}T12:00:00`);
  const endDate = /* @__PURE__ */ new Date(`${input.throughDate}T12:00:00`);
  if (startDate > endDate) return [];
  const now = input.now || /* @__PURE__ */ new Date();
  const earliest = new Date(now.getTime() + settings.minNoticeHours * 60 * 60 * 1e3);
  const latest = new Date(now.getTime() + Math.min(90, settings.maxAdvanceDays) * 24 * 60 * 60 * 1e3);
  const blocks = [...input.existingBlocks || [], ...input.holds || []];
  const slots = [];
  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setDate(cursor.getDate() + 1)) {
    const date = formatDateKey(cursor);
    const dayStart = /* @__PURE__ */ new Date(`${date}T00:00:00`);
    if (dayStart > latest) continue;
    const publicPeriods = effectivePublicPeriods(settings, date, input.modality, input.locationId);
    for (const period of publicPeriods) {
      const firstPublicStart = Math.ceil(period.start / PUBLIC_BOOKING_START_GRID_MINUTES) * PUBLIC_BOOKING_START_GRID_MINUTES;
      for (let minute = firstPublicStart; minute + service.durationMinutes <= period.end; minute += PUBLIC_BOOKING_START_GRID_MINUTES) {
        const time = minutesToTime(minute);
        const dateTime = dateToLocalDateTime(date, time);
        if (!dateTime || dateTime < earliest || dateTime > latest) continue;
        if (minute % PUBLIC_BOOKING_START_GRID_MINUTES !== 0) continue;
        if (blocks.some((block) => block.date === date && overlaps(time, service.durationMinutes, block))) continue;
        slots.push({ date, time, endTime: minutesToTime(minute + service.durationMinutes), durationMinutes: service.durationMinutes, serviceId: service.id, modality: input.modality, locationId: input.locationId });
      }
    }
  }
  return slots.filter((slot, index, all) => all.findIndex((item) => item.date === slot.date && item.time === slot.time && item.modality === slot.modality && item.locationId === slot.locationId) === index);
}
function createRandomBytes(size) {
  const bytes = new Uint8Array(size);
  if (!globalThis.crypto?.getRandomValues) throw new Error("Web Crypto indispon\xEDvel para gerar o link seguro.");
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}
function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const encoded = typeof btoa === "function" ? btoa(binary) : "";
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function createManagementToken() {
  return bytesToBase64Url(createRandomBytes(32));
}
function createMapsNavigationRef() {
  return `maps_${bytesToBase64Url(createRandomBytes(32))}`;
}
async function hashManagementToken(token) {
  if (!token || !globalThis.crypto?.subtle) throw new Error("Web Crypto indispon\xEDvel para validar o link seguro.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
async function hashMapsNavigationRef(ref) {
  if (!ref || !globalThis.crypto?.subtle) throw new Error("Web Crypto indispon\xEDvel para validar a navega\xE7\xE3o do mapa.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(ref));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
function getAppointmentManagementUrl(appointmentId, managementToken) {
  if (!appointmentId || !managementToken) throw new Error("O link de gerenciamento exige appointmentId e token bruto tempor\xE1rio.");
  const path = `/consulta/${encodeURIComponent(managementToken)}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}
function getMapsNavigationUrl(navigationRef) {
  if (!navigationRef) throw new Error("A navega\xE7\xE3o do mapa exige uma capability v\xE1lida.");
  const path = `/maps/${encodeURIComponent(navigationRef)}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}
function buildRescheduleRequestMessage(summary) {
  const date = summary.date.split("-").reverse().join("/");
  return `Ol\xE1, preciso reagendar meu atendimento com ${summary.professionalName}, atualmente marcado para ${date} \xE0s ${summary.time}. Poderia me informar outros hor\xE1rios dispon\xEDveis?`;
}
function buildAppointmentMessagingContext(summary) {
  const base = {
    appointmentModality: summary.modality,
    professionalDisplayName: summary.professionalName,
    date: summary.date,
    time: summary.time
  };
  return summary.modality === "PRESENCIAL" ? { ...base, locationDisplayName: summary.locationName, locationFullAddress: summary.locationAddress, locationGoogleMapsUrl: summary.googleMapsUrl, mapsNavigationUrl: summary.mapsNavigationUrl } : base;
}
function buildWhatsAppRescheduleUrl(phoneE164, message) {
  const phone = String(phoneE164 || "").replace(/\D/g, "");
  if (phone.length < 8 || phone.length > 15) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
function createDefaultPublicBookingSettings(now = /* @__PURE__ */ new Date()) {
  const updatedAt = now.toISOString();
  const weekdays = [1, 2, 3, 4, 5];
  const weeklyAvailability = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    enabled: weekdays.includes(dayOfWeek),
    periods: weekdays.includes(dayOfWeek) ? [{ startTime: "09:00", endTime: "18:00" }] : []
  }));
  const locations = [{
    id: "psychology-location-primary-office",
    professionalId: LOCAL_ONLINE_BOOKING_PROFESSIONAL_ID,
    displayName: "Shopping Moxuara",
    fullAddress: "",
    city: "Cariacica",
    state: "ES",
    googleMapsUrl: "",
    active: true,
    sortOrder: 1
  }, {
    id: "psychology-location-external-office",
    professionalId: LOCAL_ONLINE_BOOKING_PROFESSIONAL_ID,
    displayName: "SPAC \u2014 Centro de Sa\xFAde e Movimento",
    fullAddress: "",
    city: "Vila Velha",
    state: "ES",
    googleMapsUrl: "",
    active: true,
    sortOrder: 2
  }];
  const allowedLocationIds = locations.map((location) => location.id);
  const services = PSYCHOLOGY_SERVICE_CATALOG.map((entry) => ({
    id: entry.id,
    name: entry.name,
    durationMinutes: entry.defaultDurationMinutes,
    active: true,
    sortOrder: entry.sortOrder,
    onlineEnabled: entry.modality !== "PRESENTIAL",
    inPersonEnabled: entry.modality !== "ONLINE",
    allowedLocationIds
  }));
  const publicBookingAvailability = weekdays.map((dayOfWeek) => ({
    dayOfWeek,
    enabled: true,
    startTime: "10:00",
    endTime: "17:00",
    modalities: ["ONLINE", "PRESENCIAL"],
    locationIds: allowedLocationIds
  }));
  return {
    id: "online-booking",
    context: "PSICOLOGIA",
    professionalId: LOCAL_ONLINE_BOOKING_PROFESSIONAL_ID,
    professionalSlug: LOCAL_ONLINE_BOOKING_DEFAULT_SLUG,
    professionalName: "Leila Chaves",
    clinicDisplayName: "Gest\xE3o Cl\xEDnica",
    timezone: "America/Sao_Paulo",
    active: true,
    maxAdvanceDays: 21,
    minNoticeHours: 24,
    cancellationEnabled: true,
    cancellationCutoffHours: 16,
    whatsappContactPhoneE164: "552799529638",
    slotIntervalMinutes: 30,
    weeklyAvailability,
    publicBookingAvailability,
    publicBookingExceptions: [],
    publishedServices: services,
    publishedModalities: [
      { id: "ONLINE", label: "Online", active: true },
      { id: "PRESENCIAL", label: "Presencial", active: true }
    ],
    locations,
    updatedAt
  };
}
function normalizePublicBookingSettings(value, now = /* @__PURE__ */ new Date()) {
  const fallback = createDefaultPublicBookingSettings(now);
  const input = value && typeof value === "object" ? value : {};
  const professionalSlug = normalizeProfessionalSlug(String(input.professionalSlug || fallback.professionalSlug)) || fallback.professionalSlug;
  const maxAdvanceDays = Math.max(1, Math.min(90, Number(input.maxAdvanceDays) || fallback.maxAdvanceDays));
  const minNoticeHours = Math.max(0, Math.min(168, Number(input.minNoticeHours) || 0));
  const cancellationCutoffHours = Math.max(0, Math.min(168, Number(input.cancellationCutoffHours) || 0));
  const slotIntervalMinutes = Math.max(5, Math.min(180, Number(input.slotIntervalMinutes) || fallback.slotIntervalMinutes));
  const rawServices = Array.isArray(input.publishedServices) ? input.publishedServices : [];
  const migrateLegacyServices = rawServices.length === 1 && ["psychotherapy-individual", "psychology-service-psychotherapy"].includes(String(rawServices[0].id || "")) && !("onlineEnabled" in rawServices[0]);
  const activeLocationIds = fallback.locations.map((location) => location.id);
  const rawLocations = Array.isArray(input.locations) ? input.locations : [];
  const migrateLegacyLocations = rawLocations.length === 1 && rawLocations[0].id === "consultorio-gestao-clinica" && !("fullAddress" in rawLocations[0]);
  const legacyLocationIdMap = {
    "location-shopping-moxuara": "psychology-location-primary-office",
    "location-spac-centro-saude-movimento": "psychology-location-external-office"
  };
  const locations = (migrateLegacyLocations || !rawLocations.length ? fallback.locations : rawLocations.map((item, index) => ({
    id: legacyLocationIdMap[String(item.id || "")] || String(item.id || `location-${index + 1}`),
    professionalId: fallback.professionalId,
    displayName: String(item.displayName || item.name || `Local ${index + 1}`).trim() || `Local ${index + 1}`,
    fullAddress: String(item.fullAddress ?? item.address ?? "").trim(),
    city: String(item.city || "").trim(),
    state: String(item.state || "").trim().toUpperCase(),
    googleMapsUrl: isValidGoogleMapsUrl(String(item.googleMapsUrl || "").trim()) ? String(item.googleMapsUrl || "").trim() : "",
    active: item.active !== false,
    sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index + 1
  }))).sort((a, b) => a.sortOrder - b.sortOrder);
  const locationIds = locations.map((location) => location.id);
  const services = (migrateLegacyServices || !rawServices.length ? fallback.publishedServices : rawServices.map((item, index) => {
    const legacyModalities = Array.isArray(item.modalities) ? item.modalities : [];
    const id = canonicalPsychologyServiceId(item.id || `public-service-${index + 1}`);
    const catalogEntry = psychologyCatalogEntry(id);
    return {
      id,
      name: catalogEntry?.name || String(item.name || `Atendimento ${index + 1}`).trim() || `Atendimento ${index + 1}`,
      durationMinutes: Math.max(5, Number(item.durationMinutes) || catalogEntry?.defaultDurationMinutes || 50),
      active: item.active !== false,
      sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : index + 1,
      onlineEnabled: item.onlineEnabled ?? legacyModalities.includes("ONLINE"),
      inPersonEnabled: item.inPersonEnabled ?? legacyModalities.includes("PRESENCIAL"),
      allowedLocationIds: Array.isArray(item.allowedLocationIds) && item.allowedLocationIds.length ? item.allowedLocationIds.map((id2) => legacyLocationIdMap[String(id2)] || String(id2)).filter((id2) => locationIds.includes(id2)).length ? item.allowedLocationIds.map((id2) => legacyLocationIdMap[String(id2)] || String(id2)).filter((id2) => locationIds.includes(id2)) : locationIds : locationIds
    };
  })).sort((a, b) => a.sortOrder - b.sortOrder);
  const rawAvailability = Array.isArray(input.publicBookingAvailability) ? input.publicBookingAvailability : fallback.publicBookingAvailability;
  const fallbackPublicModalities = fallback.publishedModalities.filter((item) => item.active).map((item) => item.id);
  const publicBookingAvailability = rawAvailability.map((period) => ({
    ...period,
    modalities: Array.isArray(period.modalities) ? period.modalities : fallbackPublicModalities,
    locationIds: period.locationIds?.some((id) => locationIds.includes(id)) ? period.locationIds.filter((id) => locationIds.includes(id)) : locationIds
  }));
  const rawExceptions = Array.isArray(input.publicBookingExceptions) ? input.publicBookingExceptions : [];
  const publicBookingExceptions = rawExceptions.flatMap((item, index) => {
    const type = item.type === "BLOCK_DAY" || item.type === "BLOCK_PERIOD" || item.type === "OPEN_PERIOD" ? item.type : null;
    const civilDate = String(item.civilDate || "").trim();
    const startTime = item.startTime ? String(item.startTime).trim() : void 0;
    const endTime = item.endTime ? String(item.endTime).trim() : void 0;
    const rangeIsValid = type === "BLOCK_DAY" || timeToMinutes(startTime || "") >= 0 && timeToMinutes(endTime || "") > timeToMinutes(startTime || "");
    if (!type || !isValidIsoDate(civilDate) || !rangeIsValid) return [];
    return [{
      id: String(item.id || `public-exception-${index + 1}`),
      professionalId: fallback.professionalId,
      civilDate,
      type,
      startTime,
      endTime,
      modality: item.modality === "ONLINE" || item.modality === "PRESENCIAL" ? item.modality : void 0,
      locationId: item.locationId && locationIds.includes(item.locationId) ? item.locationId : void 0,
      note: String(item.note || "").trim() || void 0,
      createdAt: String(item.createdAt || now.toISOString()),
      updatedAt: String(item.updatedAt || now.toISOString())
    }];
  });
  return {
    ...fallback,
    ...clone(input),
    id: "online-booking",
    context: "PSICOLOGIA",
    professionalId: fallback.professionalId,
    professionalSlug,
    professionalName: String(input.professionalName || fallback.professionalName).trim() || fallback.professionalName,
    clinicDisplayName: String(input.clinicDisplayName || fallback.clinicDisplayName).trim() || fallback.clinicDisplayName,
    active: input.active !== false,
    maxAdvanceDays,
    minNoticeHours: Number.isFinite(Number(input.minNoticeHours)) ? Math.max(0, Math.min(168, Number(input.minNoticeHours))) : fallback.minNoticeHours,
    cancellationEnabled: input.cancellationEnabled !== false,
    cancellationCutoffHours: Number.isFinite(Number(input.cancellationCutoffHours)) ? cancellationCutoffHours : fallback.cancellationCutoffHours,
    whatsappContactPhoneE164: String(input.whatsappContactPhoneE164 || fallback.whatsappContactPhoneE164) === "5527999990000" ? fallback.whatsappContactPhoneE164 : String(input.whatsappContactPhoneE164 || fallback.whatsappContactPhoneE164).replace(/\D/g, "").slice(0, 15),
    slotIntervalMinutes,
    weeklyAvailability: Array.isArray(input.weeklyAvailability) ? input.weeklyAvailability : fallback.weeklyAvailability,
    publicBookingAvailability,
    publicBookingExceptions,
    publishedServices: services,
    publishedModalities: Array.isArray(input.publishedModalities) ? input.publishedModalities : fallback.publishedModalities,
    locations,
    updatedAt: String(input.updatedAt || now.toISOString())
  };
}

// shared/phoneNormalization.js
var PHONE_APOSTROPHES = /['’]/gu;
var PHONE_INVISIBLE = /[\u0000-\u001F\u007F\u00A0\u00AD\u061C\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u2066-\u2069\u3000\uFEFF]/gu;
var PHONE_FORMATTING = /[\s().,\-–—‑−/]/u;
var KNOWN_COUNTRY_CODES = /* @__PURE__ */ new Set([
  "1",
  "20",
  "27",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "39",
  "40",
  "41",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "52",
  "53",
  "54",
  "55",
  "56",
  "57",
  "58",
  "60",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "81",
  "82",
  "84",
  "86",
  "90",
  "91",
  "92",
  "93",
  "94",
  "95",
  "98",
  "211",
  "212",
  "213",
  "216",
  "218",
  "220",
  "221",
  "222",
  "223",
  "224",
  "225",
  "226",
  "227",
  "228",
  "229",
  "230",
  "231",
  "232",
  "233",
  "234",
  "235",
  "236",
  "237",
  "238",
  "239",
  "240",
  "241",
  "242",
  "243",
  "244",
  "245",
  "246",
  "248",
  "249",
  "250",
  "251",
  "252",
  "253",
  "254",
  "255",
  "256",
  "257",
  "258",
  "260",
  "261",
  "262",
  "263",
  "264",
  "265",
  "266",
  "267",
  "268",
  "269",
  "290",
  "291",
  "297",
  "298",
  "299",
  "350",
  "351",
  "352",
  "353",
  "354",
  "355",
  "356",
  "357",
  "358",
  "359",
  "370",
  "371",
  "372",
  "373",
  "374",
  "375",
  "376",
  "377",
  "378",
  "379",
  "380",
  "381",
  "382",
  "383",
  "385",
  "386",
  "387",
  "389",
  "420",
  "421",
  "423",
  "500",
  "501",
  "502",
  "503",
  "504",
  "505",
  "506",
  "507",
  "508",
  "509",
  "590",
  "591",
  "592",
  "593",
  "594",
  "595",
  "596",
  "597",
  "598",
  "599",
  "670",
  "672",
  "673",
  "674",
  "675",
  "676",
  "677",
  "678",
  "679",
  "680",
  "681",
  "682",
  "683",
  "685",
  "686",
  "687",
  "688",
  "689",
  "690",
  "691",
  "692",
  "850",
  "852",
  "853",
  "855",
  "856",
  "880",
  "886",
  "960",
  "961",
  "962",
  "963",
  "964",
  "965",
  "966",
  "967",
  "968",
  "970",
  "971",
  "972",
  "973",
  "974",
  "975",
  "976",
  "977",
  "992",
  "993",
  "994",
  "995",
  "996",
  "998"
]);
var PhoneNormalizationError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PhoneNormalizationError";
    this.code = code;
  }
};
function fail(code, message) {
  throw new PhoneNormalizationError(code, message);
}
function rawText(value) {
  return value === null || value === void 0 ? "" : String(value);
}
function anomalyFlags(raw, cleaned) {
  const anomalies = [];
  if (raw.includes("'")) anomalies.push("ASCII_APOSTROPHE");
  if (raw.includes("\u2019")) anomalies.push("TYPOGRAPHIC_APOSTROPHE");
  if (/[\u00A0\u202F\u2000-\u200D\u2060\u3000\uFEFF]/u.test(raw)) anomalies.push("UNICODE_SPACE_OR_INVISIBLE");
  if (cleaned.includes("++") || (cleaned.match(/\+/gu) || []).length > 1) anomalies.push("DOUBLE_PLUS");
  if (/[()\-–—‑−./\s]/u.test(cleaned)) anomalies.push("DISPLAY_MASK");
  return anomalies;
}
function cleanPhoneText(value) {
  const rawImportedPhone = rawText(value);
  const cleaned = rawImportedPhone.normalize("NFKC").replace(PHONE_APOSTROPHES, "").replace(PHONE_INVISIBLE, "").trim();
  return { rawImportedPhone, cleaned, anomalies: anomalyFlags(rawImportedPhone, cleaned) };
}
function findExplicitCountryCode(digits) {
  for (const length of [3, 2, 1]) {
    const candidate = digits.slice(0, length);
    const nationalLength = digits.length - length;
    if (KNOWN_COUNTRY_CODES.has(candidate) && nationalLength >= 7 && nationalLength <= 12) return candidate;
  }
  return null;
}
function ensureCountryCode(value) {
  const code = String(value || "").replace(/\D/g, "");
  if (!KNOWN_COUNTRY_CODES.has(code)) fail("INVALID_COUNTRY_CODE", "C\xF3digo do pa\xEDs inv\xE1lido.");
  return code;
}
function validateStructure(cleaned) {
  const withoutFormatting = [...cleaned].filter((character) => !PHONE_FORMATTING.test(character)).join("");
  const plusCount = (withoutFormatting.match(/\+/gu) || []).length;
  if (plusCount > 1) fail("DOUBLE_PLUS", "Telefone possui mais de um sinal de +.");
  if (plusCount === 1 && !withoutFormatting.startsWith("+")) fail("PLUS_POSITION", "O sinal de + deve estar no in\xEDcio do telefone.");
  if (/[^\d+]/u.test(withoutFormatting)) fail("INVALID_CHARACTERS", "Telefone possui caracteres n\xE3o permitidos.");
  const digits = withoutFormatting.replace(/\D/g, "");
  if (!digits) fail("EMPTY_PHONE", "Telefone vazio.");
  if (digits.length < 8 || digits.length > 15) fail("INVALID_LENGTH", "Telefone fora do comprimento permitido.");
  return { digits, explicitPlus: plusCount === 1 };
}
function normalizePhone(value, { defaultCountryCode = null, requireCountryCode = false } = {}) {
  const { rawImportedPhone, cleaned, anomalies } = cleanPhoneText(value);
  const { digits, explicitPlus } = validateStructure(cleaned);
  let countryCode = null;
  let nationalNumber = digits;
  if (explicitPlus) {
    countryCode = findExplicitCountryCode(digits);
    if (!countryCode) fail("INVALID_COUNTRY_CODE", "N\xE3o foi poss\xEDvel validar o c\xF3digo do pa\xEDs.");
    nationalNumber = digits.slice(countryCode.length);
  } else if (digits.startsWith("55") && /^55\d{10,11}$/.test(digits)) {
    countryCode = "55";
    nationalNumber = digits.slice(2);
  } else if ((digits.length > 11 || digits.length === 11 && digits.startsWith("1")) && findExplicitCountryCode(digits)) {
    countryCode = findExplicitCountryCode(digits);
    if (countryCode) nationalNumber = digits.slice(countryCode.length);
  } else if (defaultCountryCode) {
    countryCode = ensureCountryCode(defaultCountryCode);
    if (countryCode === "55" && !/^\d{10,11}$/.test(digits)) fail("INVALID_BRAZILIAN_NATIONAL_NUMBER", "Telefone brasileiro deve conter DDD e n\xFAmero v\xE1lidos.");
    nationalNumber = digits;
  }
  if (requireCountryCode && !countryCode) fail("MISSING_COUNTRY_CODE", "Telefone sem country code expl\xEDcito ou configurado.");
  if (nationalNumber.length < 7 || nationalNumber.length > 12) fail("INVALID_NATIONAL_NUMBER", "N\xFAmero nacional fora do comprimento permitido.");
  const canonicalPhone = countryCode ? `${countryCode}${nationalNumber}` : digits;
  return {
    rawImportedPhone,
    displayPhone: cleaned,
    canonicalPhone,
    canonicalDigits: canonicalPhone,
    countryCode,
    nationalNumber,
    countryCodeResolved: Boolean(countryCode),
    missingCountryCode: !countryCode,
    anomalies,
    whatsappRecipientId: countryCode ? canonicalPhone : null,
    metaRecipientId: countryCode ? canonicalPhone : null
  };
}

// src/lib/psychologyPatientAdministrative.ts
function civilParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
function isValidPhoneInput(value) {
  try {
    normalizePhone(value);
    return true;
  } catch {
    return false;
  }
}
function isValidCivilDate(value) {
  const parts = civilParts(value);
  if (!parts) return false;
  const [year, month, day] = parts;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}
function validateDateOfBirth(dateOfBirth, referenceCivilDate) {
  if (!String(dateOfBirth || "").trim()) return "Informe a data de nascimento.";
  if (!isValidCivilDate(dateOfBirth)) return "Informe uma data de nascimento v\xE1lida.";
  if (!isValidCivilDate(referenceCivilDate)) return "N\xE3o foi poss\xEDvel validar a data de refer\xEAncia.";
  if (dateOfBirth > referenceCivilDate) return "A data de nascimento n\xE3o pode ser futura.";
  return null;
}
function validateAdministrativeResponsible(value) {
  const errors = {};
  const phone = String(value?.phone || "").trim();
  const email = String(value?.email || "").trim();
  if (phone && !isValidPhoneInput(phone)) errors.phone = "Informe um telefone v\xE1lido para o respons\xE1vel.";
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.email = "Informe um e-mail v\xE1lido para o respons\xE1vel.";
  return errors;
}
function validatePsychologyPatientAdministrativeInput(input, referenceCivilDate) {
  const errors = {};
  if (!String(input.name || "").trim()) errors.name = "Informe o nome completo do paciente.";
  if (String(input.dateOfBirth || "").trim()) {
    const dateError = validateDateOfBirth(input.dateOfBirth, referenceCivilDate);
    if (dateError) errors.dateOfBirth = dateError;
  }
  if (!isValidPhoneInput(input.phone)) errors.phone = "Informe um telefone v\xE1lido.";
  if (String(input.email || "").trim() && !/^\S+@\S+\.\S+$/.test(String(input.email || "").trim())) errors.email = "Informe um e-mail v\xE1lido.";
  const responsibleHasData = Boolean(input.administrativeResponsible && Object.values(input.administrativeResponsible).some((value) => String(value || "").trim()));
  if (responsibleHasData) {
    const responsibleErrors = validateAdministrativeResponsible(input.administrativeResponsible);
    Object.entries(responsibleErrors).forEach(([field, message]) => {
      errors[`administrativeResponsible.${field}`] = message;
    });
  }
  return errors;
}

// src/features/psychology-online-booking/publicServerRepository.ts
function clone2(value) {
  return JSON.parse(JSON.stringify(value));
}
function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}
function normalize(value, maxLength = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}
function normalizeEmail(value) {
  return String(value || "").trim().toLocaleLowerCase();
}
function scopeKey(professionalId) {
  return normalize(professionalId, 128) || "psychology-local-professional";
}
function isActiveAppointment(appointment) {
  return appointment.appointmentStatus === "SCHEDULED";
}
function appointmentBlocks(state, excludeAppointmentId) {
  return [...state.appointments.values()].filter((item) => item.id !== excludeAppointmentId && isActiveAppointment(item)).map((item) => ({ date: item.date, startTime: item.time, durationMinutes: item.durationMinutes, source: "public-booking" }));
}
function endTimeFor(appointment) {
  const [hours, minutes] = appointment.time.split(":").map(Number);
  const total = hours * 60 + minutes + appointment.durationMinutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function summaryFor(appointment, settings) {
  const location = appointment.locationId ? settings.locations.find((item) => item.id === appointment.locationId) : void 0;
  return {
    id: appointment.id,
    professionalName: settings.professionalName,
    clinicDisplayName: settings.clinicDisplayName,
    serviceName: settings.publishedServices.find((service) => service.id === appointment.serviceId)?.name,
    modality: appointment.modality,
    locationName: location?.displayName,
    locationAddress: location?.fullAddress || void 0,
    googleMapsUrl: location?.googleMapsUrl || void 0,
    date: appointment.date,
    time: appointment.time,
    endTime: endTimeFor(appointment),
    appointmentStatus: appointment.appointmentStatus,
    patientConfirmationStatus: appointment.patientConfirmationStatus,
    cancellationEnabled: settings.cancellationEnabled,
    cancellationCutoffHours: settings.cancellationCutoffHours
  };
}
function genericManagementError() {
  return { ok: false, code: "not-found", message: "N\xE3o foi poss\xEDvel localizar este link de gerenciamento." };
}
function capabilityFor(state, hash, type, now) {
  const capability = state.capabilities.get(hash);
  if (!capability || capability.capabilityType !== type || capability.revokedAt || new Date(capability.expiresAt).getTime() <= now.getTime()) return null;
  return capability;
}
function appointmentError(appointment, now) {
  if (!appointment) return genericManagementError();
  if (appointment.managementTokenRevokedAt) return { ok: false, code: "revoked", message: "Este link de gerenciamento n\xE3o est\xE1 mais ativo." };
  if (new Date(appointment.managementTokenExpiresAt).getTime() <= now.getTime()) return { ok: false, code: "expired", message: "Este link de gerenciamento expirou." };
  return null;
}
function bodyObject(body) {
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}
function responsibleForStorage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const responsible = value;
  return {
    fullName: normalize(responsible.fullName, 160),
    relationship: normalize(responsible.relationship, 80),
    phone: normalize(responsible.phone, 32),
    email: normalizeEmail(String(responsible.email || ""))
  };
}
function canonicalBookingRecord(appointment, input, now) {
  const nowIso = now.toISOString();
  const modality = input.modality === "ONLINE" ? "online" : "presencial";
  const responsible = responsibleForStorage(input.administrativeResponsible);
  const patient = {
    id: appointment.patientId,
    professionalId: appointment.professionalId,
    context: "PSICOLOGIA",
    name: normalize(input.name, 160),
    dateOfBirth: normalize(input.dateOfBirth, 32),
    phone: normalize(input.phone, 32),
    email: normalizeEmail(input.email),
    preferredModality: modality,
    active: true,
    ...responsible ? { administrativeResponsible: responsible } : {},
    administrativeNote: "Criada pelo agendamento p\xFAblico; sem pagamento nesta etapa.",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  const session = {
    id: appointment.sessionId,
    professionalId: appointment.professionalId,
    context: "PSICOLOGIA",
    patientId: appointment.patientId,
    date: appointment.date,
    time: appointment.time,
    durationMinutes: appointment.durationMinutes,
    modality,
    serviceId: appointment.serviceId,
    ...modality === "presencial" && appointment.locationId ? { locationId: appointment.locationId, locationType: "PRIMARY_OFFICE" } : {},
    administrativeNote: "Criada pelo agendamento p\xFAblico; sem pagamento nesta etapa.",
    status: "agendada",
    bookingOrigin: "PATIENT_SELF_BOOKING",
    createdAt: nowIso,
    updatedAt: nowIso
  };
  return { patient, session };
}
function createMemoryPublicBookingServerStore(initialSettings, now = /* @__PURE__ */ new Date()) {
  const initial = normalizePublicBookingSettings(initialSettings || createDefaultPublicBookingSettings(now), now);
  const states = /* @__PURE__ */ new Map();
  const getState = (professionalId = initial.professionalId) => {
    const key = scopeKey(professionalId);
    const existing = states.get(key);
    if (existing) return existing;
    const state = { settings: clone2(initial), appointments: /* @__PURE__ */ new Map(), capabilities: /* @__PURE__ */ new Map() };
    states.set(key, state);
    return state;
  };
  return { getState };
}
function createServerPublicBookingRepository({ state, now: nowFactory = () => /* @__PURE__ */ new Date(), capabilityLookup, appointmentLookup }) {
  const getNow = () => nowFactory();
  const findManagementAppointment = async (token, now) => {
    if (!token || token.length < 20) return void 0;
    const capabilityHash = await hashManagementToken(token);
    const capability = capabilityLookup ? await capabilityLookup(capabilityHash) : capabilityFor(state, capabilityHash, "MANAGEMENT", now);
    if (!capability || capability.capabilityType !== "MANAGEMENT" || capability.revokedAt || new Date(capability.expiresAt).getTime() <= now.getTime()) return void 0;
    const appointment = appointmentLookup ? await appointmentLookup(capability.appointmentId) : state.appointments.get(capability.appointmentId);
    if (appointment && !state.appointments.has(appointment.id)) state.appointments.set(appointment.id, appointment);
    return appointment;
  };
  return {
    async getSettings(slug) {
      return !slug || state.settings.professionalSlug === slug ? clone2(state.settings) : null;
    },
    async updateSettings(patch) {
      const next = normalizePublicBookingSettings({ ...state.settings, ...patch, updatedAt: getNow().toISOString() }, getNow());
      state.settings = next;
      return clone2(next);
    },
    async listPublishedSlots(input) {
      const now = input.now || getNow();
      if (state.settings.professionalSlug !== input.professionalSlug) return [];
      return getPublishedSlots({ settings: state.settings, ...input, existingBlocks: appointmentBlocks(state), holds: [], now });
    },
    async createBooking(input, requestedNow) {
      const now = requestedNow || getNow();
      const settings = state.settings;
      const service = settings.publishedServices.find((item) => item.id === input.serviceId && item.active && serviceAllowsModality(item, input.modality));
      const location = input.modality === "PRESENCIAL" ? settings.locations.find((item) => item.id === input.locationId && item.active) : void 0;
      const validLocation = input.modality === "ONLINE" || Boolean(location && service?.allowedLocationIds.includes(location.id));
      if (settings.professionalSlug !== input.professionalSlug || !settings.active || !service || !validLocation) return { conflict: true, message: "Este agendamento n\xE3o est\xE1 dispon\xEDvel." };
      const candidate = getPublishedSlots({ settings, serviceId: input.serviceId, modality: input.modality, locationId: input.modality === "PRESENCIAL" ? input.locationId : void 0, fromDate: input.date, throughDate: input.date, now, existingBlocks: appointmentBlocks(state) }).find((slot) => slot.time === input.time);
      if (!candidate) return { conflict: true, message: "Este hor\xE1rio acabou de ser ocupado. Escolha outro hor\xE1rio." };
      const name = normalize(input.name, 160);
      const phone = normalize(input.phone, 32);
      const email = normalize(input.email, 160);
      const patientValidation = validatePsychologyPatientAdministrativeInput({
        name,
        dateOfBirth: normalize(input.dateOfBirth, 32),
        phone,
        email,
        administrativeResponsible: input.administrativeResponsible
      }, candidate.date);
      if (Object.keys(patientValidation).length > 0) return { conflict: true, message: Object.values(patientValidation)[0] || "Confira os dados administrativos." };
      const nowIso = now.toISOString();
      const managementToken = createManagementToken();
      const mapsNavigationRef = input.modality === "PRESENCIAL" ? createMapsNavigationRef() : void 0;
      const managementTokenHash = await hashManagementToken(managementToken);
      const mapsNavigationRefHash = mapsNavigationRef ? await hashMapsNavigationRef(mapsNavigationRef) : void 0;
      const appointmentId = createId("appointment");
      const appointment = {
        id: appointmentId,
        context: "PSICOLOGIA",
        professionalId: settings.professionalId,
        patientId: createId("patient"),
        sessionId: createId("session"),
        serviceId: service.id,
        modality: input.modality,
        locationId: input.modality === "PRESENCIAL" ? input.locationId : void 0,
        date: candidate.date,
        time: candidate.time,
        durationMinutes: candidate.durationMinutes,
        appointmentStatus: "SCHEDULED",
        patientConfirmationStatus: "PENDING",
        source: normalizeSourceChannel(input.source),
        bookingOrigin: "PATIENT_SELF_BOOKING",
        mapsNavigationRefHash,
        managementTokenHash,
        managementTokenExpiresAt: new Date(now.getTime() + DEFAULT_MANAGEMENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1e3).toISOString(),
        createdAt: nowIso,
        updatedAt: nowIso,
        auditEvents: [{ id: createId("audit"), type: "PUBLIC_BOOKING_CREATED", createdAt: nowIso, metadata: { source: normalizeSourceChannel(input.source) } }]
      };
      state.appointments.set(appointment.id, clone2(appointment));
      state.capabilities.set(managementTokenHash, { capabilityHash: managementTokenHash, capabilityType: "MANAGEMENT", appointmentId, context: "PSICOLOGIA", professionalId: settings.professionalId, createdAt: nowIso, expiresAt: appointment.managementTokenExpiresAt });
      if (mapsNavigationRefHash) state.capabilities.set(mapsNavigationRefHash, { capabilityHash: mapsNavigationRefHash, capabilityType: "MAPS_NAVIGATION", appointmentId, context: "PSICOLOGIA", professionalId: settings.professionalId, createdAt: nowIso, expiresAt: appointment.managementTokenExpiresAt });
      const responseAppointment = { ...clone2(appointment), ...mapsNavigationRef ? { mapsNavigationRef } : {} };
      return { appointment: responseAppointment, managementToken, managementUrl: getAppointmentManagementUrl(appointment.id, managementToken), mapsNavigationRef, mapsNavigationUrl: mapsNavigationRef ? getMapsNavigationUrl(mapsNavigationRef) : void 0 };
    },
    async getAppointmentByManagementToken(token, requestedNow) {
      const now = requestedNow || getNow();
      const appointment = await findManagementAppointment(token, now);
      if (!appointment || appointment.managementTokenRevokedAt || new Date(appointment.managementTokenExpiresAt).getTime() <= now.getTime()) return null;
      return summaryFor(appointment, state.settings);
    },
    async confirmByManagementToken(token, requestedNow) {
      const now = requestedNow || getNow();
      const appointment = await findManagementAppointment(token, now);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === "CANCELLED_BY_PATIENT") return { ok: false, code: "invalid", message: "Esta consulta n\xE3o pode mais ser confirmada." };
      if (appointment.patientConfirmationStatus !== "CONFIRMED") {
        appointment.patientConfirmationStatus = "CONFIRMED";
        appointment.updatedAt = now.toISOString();
        appointment.auditEvents = [...appointment.auditEvents, { id: createId("audit"), type: "PATIENT_CONFIRMED", createdAt: now.toISOString() }];
      }
      return { ok: true, summary: summaryFor(appointment, state.settings) };
    },
    async cancelByManagementToken(token, requestedNow) {
      const now = requestedNow || getNow();
      const appointment = await findManagementAppointment(token, now);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === "CANCELLED_BY_PATIENT") return { ok: true, summary: summaryFor(appointment, state.settings) };
      const appointmentDate = dateToLocalDateTime(appointment.date, appointment.time);
      if (!appointmentDate || !state.settings.cancellationEnabled) return { ok: false, code: "invalid", message: "O cancelamento online n\xE3o est\xE1 dispon\xEDvel para esta consulta." };
      const hoursUntil = (appointmentDate.getTime() - now.getTime()) / (60 * 60 * 1e3);
      if (hoursUntil < state.settings.cancellationCutoffHours) return { ok: false, code: "cutoff", message: `O cancelamento online fica dispon\xEDvel at\xE9 ${state.settings.cancellationCutoffHours} horas antes do hor\xE1rio.` };
      appointment.appointmentStatus = "CANCELLED_BY_PATIENT";
      appointment.updatedAt = now.toISOString();
      appointment.auditEvents = [...appointment.auditEvents, { id: createId("audit"), type: "PATIENT_CANCELLED", createdAt: now.toISOString() }];
      return { ok: true, summary: summaryFor(appointment, state.settings) };
    },
    async requestRescheduleByManagementToken(token, requestedNow) {
      const now = requestedNow || getNow();
      const appointment = await findManagementAppointment(token, now);
      const error = appointmentError(appointment, now);
      if (error) return error;
      if (!appointment || appointment.appointmentStatus === "CANCELLED_BY_PATIENT") return { ok: false, code: "invalid", message: "Esta consulta n\xE3o pode receber uma solicita\xE7\xE3o de reagendamento." };
      const summary = summaryFor(appointment, state.settings);
      const whatsappUrl = buildWhatsAppRescheduleUrl(state.settings.whatsappContactPhoneE164, buildRescheduleRequestMessage(summary));
      if (!whatsappUrl) return { ok: false, code: "invalid", message: "O contato de atendimento ainda n\xE3o foi configurado." };
      appointment.updatedAt = now.toISOString();
      appointment.auditEvents = [...appointment.auditEvents, { id: createId("audit"), type: "RESCHEDULE_REQUEST_INITIATED", createdAt: now.toISOString() }];
      const messagingContext = buildAppointmentMessagingContext(summary);
      return { ok: true, summary, messagingContext, whatsappUrl };
    },
    async getMapsNavigationDestination(navigationRef, requestedNow) {
      const now = requestedNow || getNow();
      const ref = String(navigationRef || "");
      if (!ref || ref.length < 20) return { ok: false, code: "unavailable", message: "Este atendimento n\xE3o possui localiza\xE7\xE3o presencial dispon\xEDvel." };
      const capabilityHash = await hashMapsNavigationRef(ref);
      const capability = capabilityLookup ? await capabilityLookup(capabilityHash) : capabilityFor(state, capabilityHash, "MAPS_NAVIGATION", now);
      if (!capability || capability.capabilityType !== "MAPS_NAVIGATION") return { ok: false, code: "unavailable", message: "Este atendimento n\xE3o possui localiza\xE7\xE3o presencial dispon\xEDvel." };
      const appointment = capability ? appointmentLookup ? await appointmentLookup(capability.appointmentId) : state.appointments.get(capability.appointmentId) : void 0;
      if (appointment && !state.appointments.has(appointment.id)) state.appointments.set(appointment.id, appointment);
      if (!appointment || appointment.appointmentStatus === "CANCELLED_BY_PATIENT" || appointment.modality !== "PRESENCIAL" || !appointment.locationId) return { ok: false, code: "unavailable", message: "Este atendimento n\xE3o possui localiza\xE7\xE3o presencial dispon\xEDvel." };
      const location = state.settings.locations.find((item) => item.id === appointment.locationId);
      const locationName = location?.displayName || "Local presencial";
      const locationAddress = location?.fullAddress || void 0;
      if (!location || !location.googleMapsUrl || !isValidGoogleMapsUrl(location.googleMapsUrl)) return { ok: false, code: "invalid", message: "N\xE3o foi poss\xEDvel abrir o mapa deste local.", locationName, locationAddress };
      return { ok: true, destinationUrl: location.googleMapsUrl, locationName, locationAddress };
    }
  };
}
function createPublicBookingServerHandler(options) {
  const now = options.now || (() => /* @__PURE__ */ new Date());
  const response = (status, body) => ({ status, body });
  const error = (status, message, code = "public-booking/unavailable") => response(status, { error: { code, message } });
  return async (request) => {
    const method = request.method.toUpperCase();
    const query = request.query || {};
    const resource = normalize(query.resource, 64);
    try {
      const state = options.store.loadState ? await options.store.loadState(query.professionalId) : options.store.getState(query.professionalId);
      const repository = createServerPublicBookingRepository({
        state,
        now,
        capabilityLookup: options.store.getCapability ? options.store.getCapability.bind(options.store) : void 0,
        appointmentLookup: options.store.getAppointment ? options.store.getAppointment.bind(options.store) : void 0
      });
      const persist = async () => {
        if (options.store.saveState) await options.store.saveState(state);
      };
      if (resource === "settings" && method === "GET") {
        const settings = await repository.getSettings(query.slug);
        return settings ? response(200, { settings }) : error(404, "Agendamento p\xFAblico indispon\xEDvel.", "public-booking/not-found");
      }
      if (resource === "settings" && method === "PUT") {
        if (!options.allowSettingsWrite) return error(403, "A publica\xE7\xE3o local de ajustes est\xE1 desativada.", "public-booking/settings-write-disabled");
        const body = bodyObject(request.body);
        const settings = await repository.updateSettings(body.settings && typeof body.settings === "object" ? body.settings : body);
        await persist();
        return response(200, { settings });
      }
      if (resource === "slots" && method === "GET") {
        const slots = await repository.listPublishedSlots({ professionalSlug: normalize(query.professionalSlug, 80), serviceId: normalize(query.serviceId, 128), modality: query.modality === "ONLINE" ? "ONLINE" : "PRESENCIAL", locationId: normalize(query.locationId, 128) || void 0, fromDate: normalize(query.fromDate, 32), throughDate: normalize(query.throughDate, 32), now: now() });
        return response(200, { slots });
      }
      if (resource === "create-booking" && method === "POST") {
        const input = bodyObject(request.body);
        const requestedNow = now();
        const result = await repository.createBooking(input, requestedNow);
        if (!("conflict" in result)) {
          const record = canonicalBookingRecord(result.appointment, input, requestedNow);
          if (options.store.persistBooking) {
            const persisted = await options.store.persistBooking(state, { ...record, appointment: result.appointment });
            if (persisted?.appointment) result.appointment = { ...result.appointment, ...persisted.appointment };
          } else {
            await persist();
          }
        }
        return "conflict" in result ? response(409, { result }) : response(201, { result });
      }
      if (resource === "management" && method === "GET") {
        const summary = await repository.getAppointmentByManagementToken(normalize(query.token, 240), now());
        return summary ? response(200, { summary }) : error(404, "N\xE3o foi poss\xEDvel localizar este link de gerenciamento.", "public-booking/not-found");
      }
      if (resource === "management-action" && method === "POST") {
        const body = bodyObject(request.body);
        const action = normalize(body.action, 40);
        const token = normalize(body.token, 240);
        if (!["confirm", "cancel", "request-reschedule"].includes(action)) return error(422, "A a\xE7\xE3o solicitada n\xE3o est\xE1 dispon\xEDvel.", "public-booking/invalid-action");
        const result = action === "confirm" ? await repository.confirmByManagementToken(token, now()) : action === "cancel" ? await repository.cancelByManagementToken(token, now()) : await repository.requestRescheduleByManagementToken(token, now());
        if (result.ok) await persist();
        return result.ok ? response(200, { result }) : response(422, { result });
      }
      if (resource === "maps" && method === "GET") {
        const result = await repository.getMapsNavigationDestination(normalize(query.navigationRef, 240), now());
        if (!("code" in result)) return response(200, { result });
        return response(404, { result: { ok: false, code: result.code, message: result.message } });
      }
      return error(404, "Rota p\xFAblica n\xE3o encontrada.", "public-booking/route-not-found");
    } catch {
      return error(500, "N\xE3o foi poss\xEDvel processar esta solicita\xE7\xE3o p\xFAblica.", "public-booking/internal-error");
    }
  };
}
export {
  PSYCHOLOGY_SERVICE_CATALOG,
  canonicalPsychologyServiceId,
  createDefaultPublicBookingSettings,
  createMemoryPublicBookingServerStore,
  createPublicBookingServerHandler,
  createServerPublicBookingRepository,
  normalizePublicBookingSettings,
  psychologyCatalogEntry
};
