/* app.js — AirScopeX (Aviation Edge Entegrasyonu) */

/* ===== API KEYS ===== */
const AVIATION_EDGE_API_KEY = "33d1ff-b345f6";
const AVIATION_EDGE_BASE = "https://aviation-edge.com/v2/public";

/* ===== OPTIONAL PROXY (CORS için Firebase Functions) =====
 * Firebase'te rewrite yaptıysan bunu "/api/ae" bırak.
 * Proxy yoksa null yap, doğrudan AE'ye istek atar.
 */
// Firebase proxy'si yerine genel bir CORS proxy'si kullanalım
// Firebase proxy'si yerine genel bir CORS proxy'si kullanalım
const AE_PROXY_BASE = "https://cors-anywhere.herokuapp.com/https://aviation-edge.com/v2/public";

/* ===== Theme ===== */
const themeToggle = document.getElementById("themeToggle");
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "light") document.body.classList.add("light-mode");
themeToggle?.addEventListener("click", () => {
  document.body.classList.toggle("light-mode");
  localStorage.setItem("theme",
    document.body.classList.contains("light-mode") ? "light" : "dark");
});

/* ===== Basic i18n ===== */
const langSelect = document.getElementById("langSelect");
(async function initI18n(){
  const sel = localStorage.getItem("lang") || "tr";
  try{
    const dict = await (await fetch("lang.json", {cache:"no-store"})).json();
    const t = dict[sel] || dict.tr; window.__T__ = t;
    [
      "nav.map","nav.about","filtersTitle","mapTitle","flightsTitle",
      "airline","all","altitude","speed","apply",
      "altitudeHint","speedHint","settings","refresh","units","save",
      "about.title","about.desc"
    ].forEach(k=>{
      document.querySelectorAll(`[data-i18n="${k}"]`)
        .forEach(el=>{
          const parts=k.split("."); let v=t; parts.forEach(p=>v=v?.[p]);
          if(typeof v==="string") el.textContent=v;
        });
    });
  }catch{}
  if (langSelect){
    langSelect.value = sel;
    langSelect.onchange = e=>{
      localStorage.setItem("lang", e.target.value);
      location.reload();
    };
  }
})();

/* ===== Settings ===== */
const refreshInput = document.getElementById("refreshSec");
const unitsSel = document.getElementById("unitsSel");
const saveBtn = document.getElementById("saveSettings");
let REFRESH_MS = (parseInt(localStorage.getItem("refreshSec") || "60", 10) || 60) * 1000;
let UNITS = localStorage.getItem("units") || "imperial";
if (refreshInput) refreshInput.value = Math.max(10, REFRESH_MS/1000);
if (unitsSel) unitsSel.value = UNITS;
saveBtn?.addEventListener("click", () => {
  const sec = Math.max(10, parseInt(refreshInput.value || "60", 10));
  localStorage.setItem("refreshSec", sec);
  localStorage.setItem("units", unitsSel.value);
  location.reload();
});

/* ===== Toast ===== */
function showToast(msg) {
  const el = document.getElementById("appToast");
  const body = document.getElementById("toastMsg");
  if (!el || !body) return;
  body.textContent = msg;
  new bootstrap.Toast(el).show();
}

/* ===== Map ===== */
let map;
if (document.getElementById("map")) {
  map = L.map("map").setView([39.0, 35.0], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
}
const planeIcon = L.icon({ iconUrl: "plane.png", iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20] });
const markers = new Map();
const flightListEl = document.getElementById("flightList");

/* ===== Helpers ===== */
const kmh2kt = v => (v == null ? null : Math.round(v * 0.539957));
const m2ft = m => (m == null ? null : Math.round(m * 3.28084));
const toLocale = n => (n == null ? "N/A" : n.toLocaleString());
const ft2m  = ft => (ft == null || ft === "" ? null : Number(ft) / 3.28084);
const kts2ms = kt => (kt == null || kt === "" ? null : Number(kt) / 1.94384);

/* === Zaman alanı yakalayıcılar === */
function pick(obj, keys){ if(!obj) return null; for(const k of keys){ if(obj[k]!=null && obj[k]!=="") return obj[k]; } return null; }
function pickTime(obj, variants){
  const v = pick(obj, variants);
  return v ? fmtTimeLocalSafe(String(v)) : "—";
}

/* === Saat formatlayıcı (TR için) === */
function fmtTimeLocalSafe(timeStr) {
  if (!timeStr) return "—";
  const isoLike = String(timeStr).trim().replace(" ", "T");
  const endsZ = /Z$/.test(isoLike);
  const isoTimeStr = endsZ ? isoLike : (isoLike + "Z");
  const date = new Date(isoTimeStr);
  if (isNaN(date.getTime())) return "—";
  date.setHours(date.getHours() + 3); // UTC+3
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
function getDelay(scheduled, actual) {
  if (!scheduled || !actual) return null;
  const diff = new Date(actual) - new Date(scheduled);
  const minutes = Math.round(diff / 60000);
  if (minutes <= 5 && minutes >= -5) return { text: "On Time", class: "text-success" };
  if (minutes > 5) return { text: `${minutes} min delay`, class: "text-danger" };
  return { text: `${-minutes} min early`, class: "text-info" };
}

/** Haversine formülü ile iki koordinat arası mesafe (km) */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Dünya yarıçapı km cinsinden
  const toRad = (x) => x * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Mesafe km cinsinden
}

/** Tahmini uçuş süresi (dk) */
function calculateFlightTime(distanceKm, speedKmh) {
  if (!distanceKm || !speedKmh || speedKmh === 0) return null;
  return Math.round((distanceKm / speedKmh) * 60); // Dakika
}

/* ===== Filters ===== */
const airlineSel = document.getElementById("airlineSel");
const altMin = document.getElementById("altMin");
const altMax = document.getElementById("altMax");
const spdMin = document.getElementById("spdMin");
const spdMax = document.getElementById("spdMax");
const applyBtn = document.getElementById("applyBtn");
const AIRLINES = [
  { code: "THY", name: "Turkish Airlines" }, { code: "PGT", name: "Pegasus Airlines" },
  { code: "AAL", name: "American Airlines" }, { code: "DAL", name: "Delta Air Lines" },
  { code: "UAL", name: "United Airlines" },   { code: "SIA", name: "Singapore Airlines" },
  { code: "UAE", name: "Emirates" },          { code: "QTR", name: "Qatar Airways" },
  { code: "DLH", name: "Lufthansa" },         { code: "AFR", name: "Air France" },
  { code: "KLM", name: "KLM Royal Dutch" },   { code: "BAW", name: "British Airways" },
  { code: "RYR", name: "Ryanair" },           { code: "EZY", name: "easyJet" },
  { code: "WZZ", name: "Wizz Air" },          { code: "ANA", name: "All Nippon Airways" },
  { code: "JAL", name: "Japan Airlines" },    { code: "CPA", name: "Cathay Pacific" },
  { code: "ETD", name: "Etihad Airways" },    { code: "SWR", name: "SWISS" },
];
if (airlineSel && airlineSel.children.length <= 1) {
  AIRLINES.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.code; opt.textContent = a.name; airlineSel.appendChild(opt);
  });
}
const savedFilters = JSON.parse(localStorage.getItem("filters") || "{}");
if (airlineSel) airlineSel.value = savedFilters.airline || "";
if (altMin) altMin.value = savedFilters.altMin ?? "";
if (altMax) altMax.value = savedFilters.altMax ?? "";
if (spdMin) spdMin.value = savedFilters.spdMin ?? "";
if (spdMax) spdMax.value = savedFilters.spdMax ?? "";
function currentFilters() {
  return {
    airline: airlineSel?.value || "",
    altMin: ft2m(altMin?.value),
    altMax: ft2m(altMax?.value),
    spdMin: kts2ms(spdMin?.value),
    spdMax: kts2ms(spdMax?.value),
  };
}
applyBtn?.addEventListener("click", () => {
  localStorage.setItem("filters", JSON.stringify({
    airline: airlineSel?.value || "",
    altMin: altMin?.value || "",
    altMax: altMax?.value || "",
    spdMin: spdMin?.value || "",
    spdMax: spdMax?.value || "",
  }));
  fetchFlights();
});


/* ===== DRAWER (CONSOLIDATED LOGIC) ===== */
const drawer = document.getElementById("flightDrawer");
const drawerBody = document.getElementById("drawerBody");
const drawerTitle = document.getElementById("drawerTitle");
const drawerStatus = document.getElementById("drawerStatus");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const drawerClose = document.getElementById("drawerClose");

function lockMap(lock) {
  if (!map) return;
  const action = lock ? "disable" : "enable";
  map.dragging[action]();
  map.scrollWheelZoom[action]();
  map.doubleClickZoom[action]();
  map.boxZoom[action]();
  map.keyboard[action]();
}

function openDrawer() {
  if (!drawer) return;
  drawer.style.transform = ''; // Clear any inline styles from gestures
  drawer.classList.add("is-open");
  drawerBackdrop.classList.add("is-open");
  lockMap(true);
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  if (!drawer) return;
  drawer.classList.remove("is-open");
  drawerBackdrop.classList.remove("is-open");
  drawer.style.transform = ''; // Ensure clean state
  lockMap(false);
  document.body.style.overflow = '';
}

// Initialize drawer events and gestures
(function initDrawer() {
  if (!drawer) return;
  
  drawerBackdrop?.addEventListener("click", closeDrawer);
  drawerClose?.addEventListener("click", closeDrawer);

  // Swipe-down to close gesture for mobile
  let startY = null;
  let currentY = null;
  let isDragging = false;
  const header = drawer.querySelector('.drawer-header') || drawer;

  header.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      startY = e.touches[0].clientY;
      isDragging = true;
    }
  }, { passive: true });

  header.addEventListener('touchmove', (e) => {
    if (!isDragging || !startY) return;
    
    currentY = e.touches[0].clientY;
    const diffY = currentY - startY;
    
    // Only apply transform if dragging down and on mobile view
    if (diffY > 0 && window.matchMedia('(max-width: 768px)').matches) {
      drawer.style.transform = `translateY(${diffY}px)`;
    }
  }, { passive: true });

  header.addEventListener('touchend', () => {
    if (!isDragging) return;
    
    isDragging = false;
    const diffY = currentY - startY;
    
    // If dragged more than a threshold, close it
    if (diffY > 100) {
      closeDrawer();
    } else {
      // Otherwise, snap back to the open position
      drawer.style.transform = '';
    }
    
    startY = null;
    currentY = null;
  });
})();


function statusBadgeClass(s="") {
  const status = (s || "").toLowerCase();
  if (status === 'en-route' || status === 'started') return "bg-success";
  if (status === 'landed') return "bg-primary";
  if (status.includes('cancel')) return "bg-danger";
  if (status.includes('delay')) return "bg-warning";
  if (status === 'scheduled') return "bg-info";
  return "bg-secondary";
}

/* ===== Aviation Edge Fetch (proxy destekli) ===== */
async function aviationEdgeFetch(endpoint, params = {}) {
  const buildURL = () => {
    if (AE_PROXY_BASE) {
      // PROXY KULLANIMI İÇİN GÜNCELLENDİ
      const url = new URL(`${AE_PROXY_BASE}/${endpoint}`);
      url.searchParams.set('key', AVIATION_EDGE_API_KEY);
      Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
      return url.toString();
    } else {
      // Orijinal (proxy'siz) kullanım
      const url = new URL(`${AVIATION_EDGE_BASE}/${endpoint}`);
      url.searchParams.set('key', AVIATION_EDGE_API_KEY);
      Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
      return url.toString();
    }
  };
  const urlStr = buildURL();
  try {
    const res = await fetch(urlStr, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch(e) {
    console.error("Aviation Edge Fetch Error:", e);
    throw new Error("Aviation Edge fetch failed");
  }
}


/* ===== Flights In Bounds (repo uyumlu: merkez+yarıçap) ===== */
async function aviationEdgeGetFlightsInBounds(bounds) {
  try {
    const ne = bounds.getNorthEast();
    const center = bounds.getCenter();
    const R = 6371; // km
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(ne.lat - center.lat);
    const dLng = toRad(ne.lng - center.lng);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(center.lat))*Math.cos(toRad(ne.lat))*Math.sin(dLng/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const radiusKm = Math.max(20, Math.min(300, Math.round(R * c)));

    const data = await aviationEdgeFetch('flights', {
      lat: center.lat.toFixed(5),
      lng: center.lng.toFixed(5),
      distance: radiusKm
    });
    if (!Array.isArray(data)) return [];
    console.log(`[AviationEdge] InBounds: ${data.length} (r=${radiusKm}km)`);
    return data;
  } catch(e) { return []; }
}

/* ===== Uçuşları Çekme ve Haritayı Güncelleme ===== */
async function fetchFlights() {
  if (!map) return;
  const bounds = map.getBounds();
  try {
    if (flightListEl && !flightListEl.dataset.loaded) {
      flightListEl.innerHTML = `<div class="list-group-item skeleton"></div><div class="list-group-item skeleton"></div><div class="list-group-item skeleton"></div>`;
    }
    const liveFlightData = await aviationEdgeGetFlightsInBounds(bounds);
    const F = currentFilters();
    const seen = new Set();
    const items = [];
    liveFlightData.forEach((f) => {
      const icao24 = f.aircraft?.icao24 || f.flight?.icaoNumber;
      if (!icao24) return;
      const callsign = (f.flight?.icaoNumber || f.flight?.iataNumber || "N/A").trim();
      const origin = f.departure?.iataCode || "N/A";
      const lon = f.geography?.longitude;
      const lat = f.geography?.latitude;
      const vel_kmh = f.speed?.horizontal;
      const track = f.geography?.direction;
      const alt_m = f.geography?.altitude;
      if (lat == null || lon == null) return;
      const airlineIcao = f.airline?.icaoCode || callsign.substring(0, 3);
      if (F.airline && airlineIcao !== F.airline) return;
      if (F.altMin != null && alt_m != null && alt_m < F.altMin) return;
      if (F.altMax != null && alt_m != null && alt_m > F.altMax) return;
      if (F.spdMin != null && vel_kmh != null && (vel_kmh / 3.6) < F.spdMin) return;
      if (F.spdMax != null && vel_kmh != null && (vel_kmh / 3.6) > F.spdMax) return;
      const altOut = (UNITS === "imperial") ? (alt_m != null ? `${toLocale(m2ft(alt_m))} ft` : "N/A") : (alt_m != null ? `${toLocale(Math.round(alt_m))} m` : "N/A");
      const spdOut = (UNITS === "imperial") ? (vel_kmh != null ? `${toLocale(kmh2kt(vel_kmh))} kts` : "N/A") : (vel_kmh != null ? `${toLocale(Math.round(vel_kmh))} km/h` : "N/A");
      const basePopup = `<div><strong>${callsign}</strong> <span class="badge bg-info">${origin}</span><br/><span>${altOut}</span><br/><span>${spdOut}</span><br/><small>ICAO24: ${icao24}</small></div>`;
      let m = markers.get(icao24);
      if (!m) {
        m = L.marker([lat, lon], { icon: planeIcon, rotationAngle: Number.isFinite(track) ? track : 0, rotationOrigin: "center center", }).bindPopup(basePopup).addTo(map);
        markers.set(icao24, m);
      } else {
        m.setLatLng([lat, lon]);
        m.setPopupContent(basePopup);
        if (Number.isFinite(track) && typeof m.setRotationAngle === "function") m.setRotationAngle(track);
      }
      seen.add(icao24);
      items.push({ callsign: callsign, origin, altOut, spdOut, icao24 });
      m.off("click");
      m.on("click", () => { window.openDrawerForFlight(f); });
    });
    for (const [key, marker] of markers.entries()) {
      if (!seen.has(key)) { marker.remove(); markers.delete(key); }
    }
    if (flightListEl) {
      flightListEl.dataset.loaded = "1";
      flightListEl.innerHTML = items.length ? items.map(it => `<div class="list-group-item list-group-item-action" onclick="(() => { const m = markers.get('${it.icao24}'); if (m) { map.flyTo(m.getLatLng()); m.fire('click'); } })()"><div class="d-flex justify-content-between"><div><strong>${it.callsign}</strong><span class="badge bg-info">${it.origin}</span></div><div class="text-end small">${it.altOut}<br/>${it.spdOut}</div></div></div>`).join("") : `<div class="list-group-item">Bu alanda uçuş bulunamadı.</div>`;
    }
  } catch (e) {
    console.error(e);
    showToast(`Hata: ${e.message}`);
    if (flightListEl) { flightListEl.innerHTML = `<div class="list-group-item bg-danger text-light">Hata: ${e.message}</div>`; }
  }
}

/* ===============================================================
 * SAAT ZENGİNLEŞTİRME — Airport Schedules/Timetable
 * =============================================================== */

/** AE schedule/timetable'larda alan isimleri değişken -> olası key'ler */
const TIME_KEYS = {
  depSched: ["scheduledTime", "scheduledTimeLocal", "departureScheduledTime", "departureTime", "timeScheduled"],
  depAct:   ["actualTime", "actual", "off", "takeoffTime", "departureActualTime", "realTime"],
  arrSched: ["scheduledTime", "scheduledTimeLocal", "arrivalScheduledTime", "arrivalTime"],
  arrEst:   ["estimatedTime", "estimated", "eta", "estimatedGateTime", "estimatedRunwayTime"],
  arrAct:   ["actualTime", "actual", "on", "landingTime", "arrivalActualTime"]
};

/** Schedules listesinde uçuşu bulmak için flight numarasından normalize matcher */
function matchByFlightNumber(row, wanted) {
  if (!wanted) return false;
  const w = String(wanted).replace(/\s+/g,'').toUpperCase(); // PGT1234
  const cands = [
    row.flightNumber, row.flight?.number, row.flight?.iataNumber, row.flight?.icaoNumber,
    row.number, row.iataNumber, row.icaoNumber
  ].filter(Boolean).map(x=>String(x).replace(/\s+/g,'').toUpperCase());
  return cands.includes(w);
}

/** Airport schedules/timetable'dan departure/arrival saatlerini çek */
async function fetchAirportTimes(depIata, arrIata, flightNumLike){
  // 1) departure tarafı
  let depRow = null, arrRow = null;

  // schedules?iataCode=XXX&type=departure/arrival
  try {
    if (depIata) {
      const depList = await aviationEdgeFetch("schedules", { iataCode: depIata, type: "departure" });
      if (Array.isArray(depList) && depList.length) {
        depRow = depList.find(r => matchByFlightNumber(r, flightNumLike)) || null;
      }
    }
  } catch {}

  try {
    if (arrIata) {
      const arrList = await aviationEdgeFetch("schedules", { iataCode: arrIata, type: "arrival" });
      if (Array.isArray(arrList) && arrList.length) {
        arrRow = arrList.find(r => matchByFlightNumber(r, flightNumLike)) || null;
      }
    }
  } catch {}

  // 2) fallback: timetable endpoint isimli olan
  try {
    if (!depRow && depIata) {
      const depList2 = await aviationEdgeFetch("timetable", { iataCode: depIata, type: "departure" });
      if (Array.isArray(depList2) && depList2.length) {
        depRow = depList2.find(r => matchByFlightNumber(r, flightNumLike)) || null;
      }
      //console.log("DEP_LIST2", depList2)
    }
  } catch {}
  try {
    if (!arrRow && arrIata) {
      const arrList2 = await aviationEdgeFetch("timetable", { iataCode: arrIata, type: "arrival" });
      if (Array.isArray(arrList2) && arrList2.length) {
        arrRow = arrList2.find(r => matchByFlightNumber(r, flightNumLike)) || null;
      }
      //console.log("ARR_LIST2", arrList2)
    }
  } catch {}

  // 3) saatleri ayıkla
  const depSchedRaw = depRow && pick(depRow, TIME_KEYS.depSched);
  const depActRaw   = depRow && pick(depRow, TIME_KEYS.depAct);
  const arrSchedRaw = arrRow && pick(arrRow, TIME_KEYS.arrSched);
  const arrEstRaw   = arrRow && pick(arrRow, TIME_KEYS.arrEst);
  const arrActRaw   = arrRow && pick(arrRow, TIME_KEYS.arrAct);

  // UTC offset bilgisi çek
  const depTimezone = depRow?.departure?.timezone || depRow?.timezone || null;
  const arrTimezone = arrRow?.arrival?.timezone || arrRow?.timezone || null;
  const depUtcOffset = airports.find(a => a.iata === depIata)?.utc || null;
  const arrUtcOffset = airports.find(a => a.iata === arrIata)?.utc || null;

  return {
    dep: {
      scheduled: depSchedRaw || null,
      actual: depActRaw || null,
      timezone: depTimezone,
      utcOffset: depUtcOffset
    },
    arr: {
      scheduled: arrSchedRaw || null,
      estimated: arrEstRaw || null,
      actual: arrActRaw || null,
      timezone: arrTimezone,
      utcOffset: arrUtcOffset
    }
  };
}

/** Çekilen saatleri flightData içine _schedule alanı olarak bas */
function mergeScheduleIntoFlight(flightData, sched){
  if (!sched) return flightData;
  const copy = JSON.parse(JSON.stringify(flightData || {}));
  copy._schedule = {
    departure: {
      scheduledTime: sched.dep?.scheduled || null,
      actualTime:    sched.dep?.actual    || null,
      timezone:      sched.dep?.timezone  || null,
      utcOffset:     sched.dep?.utcOffset || null
    },
    arrival: {
      scheduledTime: sched.arr?.scheduled || null,
      estimatedTime: sched.arr?.estimated || null,
      actualTime:    sched.arr?.actual    || null,
      timezone:      sched.arr?.timezone  || null,
      utcOffset:     sched.arr?.utcOffset || null
    }
  };
  return copy;
}

/* ===============================================================
 * DRAWER CONTENT
 * =============================================================== */

/** Airport (airports.js'den) detayını getiren yardımcı fonksiyon */
function getAirportDetails(iataCode) {
  if (!iataCode) return null;
  return airports.find(a => a.iata === iataCode);
}

// app.js içindeki bu fonksiyonu güncelleyin

// app.js içindeki renderDrawerContent fonksiyonunu bununla değiştirin

function renderDrawerContent(flightData) {
  const flight    = flightData.flight    || {};
  const departure = flightData.departure || {};
  const arrival   = flightData.arrival   || {};
  const airline   = flightData.airline   || {};
  const aircraft  = flightData.aircraft  || {};
  const geography = flightData.geography || {};
  const speed     = flightData.speed     || {};
  const statusRaw = flightData.status    || "Unknown";

  const flightNum = (flight.iataNumber || flight.icaoNumber || "—").toUpperCase();
  const depCode   = departure.iataCode || departure.icaoCode || "???";
  const arrCode   = arrival.iataCode   || arrival.icaoCode   || "???";

  const depAirport = airports.find(a => a.iata === depCode);
  const arrAirport = airports.find(a => a.iata === arrCode);

  const depName = depAirport?.name || departure.airport || "Unknown Airport";
  const arrName = arrAirport?.name || arrival.airport || "Unknown Airport";
  
  const depTimezoneName = depAirport ? `UTC${depAirport.utc >= 0 ? '+' : ''}${depAirport.utc}` : 'N/A';
  const arrTimezoneName = arrAirport ? `UTC${arrAirport.utc >= 0 ? '+' : ''}${arrAirport.utc}` : 'N/A';

  drawerTitle.textContent = flightNum;
  drawerStatus.textContent = statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
  drawerStatus.className = `badge ms-2 ${statusBadgeClass(statusRaw)}`;

  const altOut = (UNITS === "imperial")
    ? (geography.altitude != null ? `${toLocale(m2ft(geography.altitude))} ft` : "—")
    : (geography.altitude != null ? `${toLocale(Math.round(geography.altitude))} m` : "—");
  const spdOut = (UNITS === "imperial")
    ? (speed.horizontal != null ? `${toLocale(kmh2kt(speed.horizontal))} kts` : "—")
    : (speed.horizontal != null ? `${toLocale(Math.round(speed.horizontal))} km/h` : "—");
  const heading = geography.direction != null ? `${Math.round(geography.direction)}°` : "—";
  
  let distanceKm = null;
  let distanceCoveredKm = null;
  let progressPercentage = 0;

  if (depAirport && arrAirport) {
    distanceKm = calculateDistance(depAirport.lat, depAirport.lon, arrAirport.lat, arrAirport.lon);
    if (geography.latitude && geography.longitude) {
      const remainingDistanceKm = calculateDistance(geography.latitude, geography.longitude, arrAirport.lat, arrAirport.lon);
      distanceCoveredKm = distanceKm - remainingDistanceKm;
      // İlerleme yüzdesini hesapla
      if (distanceKm > 0) {
        progressPercentage = Math.max(0, Math.min(100, (distanceCoveredKm / distanceKm) * 100));
      }
    }
  }

  const formatMinutes = (mins) => {
    if (mins == null) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  const formattedDistanceCovered = distanceCoveredKm != null ? `${toLocale(Math.round(distanceCoveredKm))} km` : "—";
  const formattedDistanceRemaining = distanceKm != null && distanceCoveredKm != null ? `${toLocale(Math.round(distanceKm - distanceCoveredKm))} km` : "—";
  
  const totalFlightTimeMinutes = calculateFlightTime(distanceKm, speed.horizontal);
  const remainingFlightTimeMinutes = calculateFlightTime(distanceKm - distanceCoveredKm, speed.horizontal);
  
  const formattedTotalFlightTime = formatMinutes(totalFlightTimeMinutes);
  const formattedRemainingFlightTime = formatMinutes(remainingFlightTimeMinutes);

  const depSchedRaw = pick(departure, TIME_KEYS.depSched);
  const depActRaw   = pick(departure, TIME_KEYS.depAct);
  const arrSchedRaw = pick(arrival,   TIME_KEYS.arrSched);
  const arrEstRaw   = pick(arrival,   TIME_KEYS.arrEst);

  const headerHTML = `
    <div class="flight-route-card">
      <div class="route-airports">
        <div class="airport-info">
          <span class="iata-code">${depCode}</span>
          <span class="airport-name">${depAirport?.name || '---'}</span>
          <span class="utc-info">${depTimezoneName}</span>
        </div>
        <div class="route-icon">
          <i class="bi bi-airplane-fill"></i>
        </div>
        <div class="airport-info text-end">
          <span class="iata-code">${arrCode}</span>
          <span class="airport-name">${arrAirport?.name || '---'}</span>
          <span class="utc-info">${arrTimezoneName}</span>
        </div>
      </div>
      
      <div class="flight-progress-container">
        <div class="progress-line">
          <div class="plane-icon" style="left: ${progressPercentage}%;">
            <i class="bi bi-airplane-fill"></i>
          </div>
        </div>
      </div>

      <div class="route-details">
        <div>${formattedDistanceCovered}<br><small>${formattedTotalFlightTime}</small></div>
        <div class="text-end">${formattedDistanceRemaining}<br><small>${formattedRemainingFlightTime}</small></div>
      </div>
    </div>

    <div class="drawer-section stat-cards">
      <div class="stat-card text-center"><div class="k">Altitude</div><div class="v">${altOut}</div></div>
      <div class="stat-card text-center"><div class="k">Speed</div><div class="v">${spdOut}</div></div>
      <div class="stat-card text-center"><div class="k">Heading</div><div class="v">${heading}</div></div>
    </div>
    <hr class="my-3"/>
    <div class="drawer-section">
      <h6 class="text-center mb-3">Schedule</h6>
      <div class="d-flex justify-content-between text-muted small px-1 mb-2">
        <div>Departure Scheduled: <strong>${pickTime({v:depSchedRaw}, ["v"])}</strong></div>
        <div>Actual: <strong class="text-white">${pickTime({v:depActRaw}, ["v"])}</strong></div>
      </div>
      <div class="d-flex justify-content-between text-muted small px-1">
        <div>Arrival Scheduled: <strong>${pickTime({v:arrSchedRaw}, ["v"])}</strong></div>
        <div>Estimated: <strong class="text-white">${pickTime({v:arrEstRaw}, ["v"])}</strong></div>
      </div>
    </div>
    <hr class="my-3"/>
  `;

  const equipmentHTML = `
    <div class="drawer-section">
      <h6 class="text-center mb-3">Flight Information</h6>
      <div class="drawer-meta">
        <div class="k">Airline</div><div class="v">${escapeHTML(airline.name || "—")}</div>
        <div class="k">Aircraft</div><div class="v">${escapeHTML(aircraft.model || "—")}</div>
        <div class="k">Registration</div><div class="v">${escapeHTML(aircraft.regNumber || aircraft.registration || "—")}</div>
      </div>
    </div>
  `;
  
  drawerBody.innerHTML = headerHTML + equipmentHTML;
}
 
function escapeHTML(s) {
  if (s === null || s === undefined) return "";
  return s.toString().replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));
}

/* ===== Drawer Opening Logic ===== */
window.openDrawerForFlight = async function(flightData){
  openDrawer();
  drawerTitle.textContent = (flightData?.flight?.iataNumber || flightData?.flight?.icaoNumber || "Flight").toUpperCase();
  drawerStatus.textContent = (flightData?.status || "Unknown");
  drawerStatus.className = "badge ms-2 " + statusBadgeClass(flightData?.status);
  drawerBody.innerHTML = `<div class="drawer-skeleton"><div class="sk-line"></div><div class="sk-line"></div><div class="sk-line"></div><div class="sk-line"></div></div>`;

  try {
    const depIata = flightData?.departure?.iataCode || null;
    const arrIata = flightData?.arrival?.iataCode || null;
    const flightNo = flightData?.flight?.iataNumber || flightData?.flight?.icaoNumber || flightData?.flight?.number || null;

    let enriched = flightData;
    // Sadece başlangıç ve bitiş havaalanı varsa schedule çekmeyi dene
    if (depIata && arrIata && flightNo) {
      try {
        const sched = await fetchAirportTimes(depIata, arrIata, flightNo);
        enriched = mergeScheduleIntoFlight(flightData, sched);
      } catch (e) {
        console.warn("Schedule enrichment failed:", e);
      }
    }
    renderDrawerContent(enriched);
  } catch (e) {
    console.error(e);
    drawerBody.innerHTML = `<div class="alert alert-danger m-3">Could not retrieve details.</div>`;
  }
};

/* ===== Başlat ===== */
if (document.getElementById("map")) {
  fetchFlights();
  setInterval(fetchFlights, REFRESH_MS);
}