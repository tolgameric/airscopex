// app.js — AirScopeX
// Adds: callsign fallback for ADB + aircraft image in drawer

const ADB_KEY  = "37dbf3947emsh89f66726bee44c9p1dfd62jsn8b5d8cef2eeb"; // kendi key'in
const ADB_HOST = "aerodatabox.p.rapidapi.com";

/* ===== Theme ===== */
const themeToggle = document.getElementById("themeToggle");
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "light") document.body.classList.add("light-mode");
themeToggle?.addEventListener("click", () => {
  document.body.classList.toggle("light-mode");
  localStorage.setItem("theme", document.body.classList.contains("light-mode") ? "light" : "dark");
});

/* ===== i18n (light) ===== */
const langSelect = document.getElementById("langSelect");
const qsa = (sel) => [...document.querySelectorAll(sel)];
async function applyI18n(lang) {
  try {
    const res = await fetch("lang.json", { cache: "no-store" });
    const dict = await res.json();
    const t = dict[lang] || dict.tr;
    const keys = ["nav.map","nav.about","filtersTitle","mapTitle","flightsTitle","airline","all","altitude","speed","apply","altitudeHint","speedHint","settings","refresh","units","save","about.title","about.desc"];
    keys.forEach((k)=> qsa(`[data-i18n="${k}"]`).forEach(el => {
      const parts = k.split(".");
      let v = t; for (const p of parts) v = v?.[p];
      if (typeof v === "string") el.textContent = v;
    }));
    localStorage.setItem("lang", lang);
  } catch {}
}
const savedLang = localStorage.getItem("lang") || "tr";
if (langSelect) { langSelect.value = savedLang; langSelect.addEventListener("change", (e)=>applyI18n(e.target.value)); }
applyI18n(savedLang);

/* ===== Settings ===== */
const refreshInput = document.getElementById("refreshSec");
const unitsSel = document.getElementById("unitsSel");
const saveBtn = document.getElementById("saveSettings");
let REFRESH_MS = (parseInt(localStorage.getItem("refreshSec") || "60", 10) || 60) * 1000;
let UNITS = localStorage.getItem("units") || "metric";
if (refreshInput) refreshInput.value = Math.max(10, REFRESH_MS / 1000);
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
const map = L.map("map").setView([39.0, 35.0], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
const planeIcon = L.icon({ iconUrl: "plane.png", iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20] });
const markers = new Map();
const flightListEl = document.getElementById("flightList");

const m2ft = (m) => (m == null ? null : Math.round(m * 3.28084));
const ms2kt = (v) => (v == null ? null : Math.round(v * 1.94384));
const toLocale = (n) => (n == null ? "N/A" : n.toLocaleString());

/* ===== OpenSky helpers ===== */
function baseUrl(bounds) {
  const p = new URLSearchParams({
    lamin: bounds.getSouth().toFixed(2),
    lomin: bounds.getWest().toFixed(2),
    lamax: bounds.getNorth().toFixed(2),
    lomax: bounds.getEast().toFixed(2),
  });
  return `https://opensky-network.org/api/states/all?${p.toString()}`;
}
const PROXIES = [
  "https://cors.isomorphic-git.org/",
  "https://api.allorigins.win/raw?url=",
  "https://thingproxy.freeboard.io/fetch/",
];
async function fetchJsonWithFallback(url) {
  let err;
  for (const px of PROXIES) {
    const full = px.endsWith("url=") ? px + encodeURIComponent(url) : px + url;
    try {
      const res = await fetch(full, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try { return await res.json(); }
      catch { return JSON.parse(await res.text()); }
    } catch (e) { err = e; }
  }
  throw err || new Error("Failed to fetch");
}

/* ===== Filters ===== */
const airlineSel = document.getElementById("airlineSel");
const altMin = document.getElementById("altMin");
const altMax = document.getElementById("altMax");
const spdMin = document.getElementById("spdMin");
const spdMax = document.getElementById("spdMax");
const applyBtn = document.getElementById("applyBtn");

const AIRLINES = [
  { code: "AAL", name: "American Airlines" }, { code: "DAL", name: "Delta Air Lines" },
  { code: "UAL", name: "United Airlines" },   { code: "SIA", name: "Singapore Airlines" },
  { code: "UAE", name: "Emirates" },           { code: "QTR", name: "Qatar Airways" },
  { code: "THY", name: "Turkish Airlines" },   { code: "PGT", name: "Pegasus Airlines" },
  { code: "DLH", name: "Lufthansa" },          { code: "AFR", name: "Air France" },
  { code: "KLM", name: "KLM Royal Dutch" },    { code: "BAW", name: "British Airways" },
  { code: "RYR", name: "Ryanair" },            { code: "EZY", name: "easyJet" },
  { code: "WZZ", name: "Wizz Air" },           { code: "ANA", name: "All Nippon Airways" },
  { code: "JAL", name: "Japan Airlines" },     { code: "CPA", name: "Cathay Pacific" },
  { code: "ETD", name: "Etihad Airways" },     { code: "SWR", name: "SWISS International" },
];
if (airlineSel && airlineSel.children.length <= 1) {
  AIRLINES.forEach((a) => { const opt = document.createElement("option"); opt.value = a.code; opt.textContent = a.name; airlineSel.appendChild(opt); });
}

const savedFilters = JSON.parse(localStorage.getItem("filters") || "{}");
if (airlineSel) airlineSel.value = savedFilters.airline || "";
if (altMin) altMin.value = savedFilters.altMin ?? "";
if (altMax) altMax.value = savedFilters.altMax ?? "";
if (spdMin) spdMin.value = savedFilters.spdMin ?? "";
if (spdMax) spdMax.value = savedFilters.spdMax ?? "";

const ft2m  = (ft) => (ft == null || ft === "" ? null : Number(ft) / 3.28084);
const kts2ms = (kt) => (kt == null || kt === "" ? null : Number(kt) / 1.94384);
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
  fetchPlanes();
});

/* ===== Common helpers ===== */
function callsignToIcao(cs) { const s = (cs || "").trim().toUpperCase(); return s.length >= 3 ? s.slice(0, 3) : ""; }
function callsignToFlightIcao(cs) { if (!cs) return null; return String(cs).toUpperCase().replace(/\s+/g, ""); }
const pad2 = (n) => (n < 10 ? "0" + n : "" + n);
function todayIsoDate(offsetDays = 0) { const d = new Date(); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

// Extract ISO string from possibly nested time objects
function extractDateString(x) {
  if (!x) return null;
  if (typeof x === "string") return x;
  if (typeof x === "number") return new Date(x).toISOString();
  if (typeof x === "object") {
    return x.local || x.utc || x.scheduled || x.scheduledTimeLocal || x.estimated || x.actual || null;
  }
  return null;
}
function fmtTimeLocalSafe(any) {
  const s = extractDateString(any);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

// Prefer IATA → ICAO → Name → "—"
function airportCodeLabel(a = {}) {
  const code = a.iata || a.iataCode || a.icao || a.icaoCode;
  if (code) return String(code).toUpperCase();
  if (a.airport && (a.airport.iata || a.airport.icao)) {
    return (a.airport.iata || a.airport.icao).toUpperCase();
  }
  if (a.name) return a.name;
  return "—";
}

function normalizeFlight(item) {
  const dep = item.departure || item.depart || item.origin || {};
  const arrv = item.arrival || item.arrive || item.destination || {};
  return {
    status: item.status || item.flightStatus || "",
    airline: item.airline?.name || item.operator?.name || "",
    number: item.number || item.flight?.number || item.numberIcao || "",
    aircraft: item.aircraft || item.airplane || item.airframe || {},
    dep: {
      name: dep.airport?.name || dep.name || "",
      iata: dep.iata || dep.iataCode || dep.airport?.iata || "",
      icao: dep.icao || dep.icaoCode || dep.airport?.icao || "",
      sched: extractDateString(dep.scheduledTimeLocal || dep.scheduledTime || dep.scheduled),
      actual: extractDateString(dep.actualTimeLocal || dep.actualTime || dep.actual),
      est: extractDateString(dep.estimatedTimeLocal || dep.estimatedTime || dep.estimated),
      terminal: dep.terminal || "",
      gate: dep.gate || "",
    },
    arr: {
      name: arrv.airport?.name || arrv.name || "",
      iata: arrv.iata || arrv.iataCode || arrv.airport?.iata || "",
      icao: arrv.icao || arrv.icaoCode || arrv.airport?.icao || "",
      sched: extractDateString(arrv.scheduledTimeLocal || arrv.scheduledTime || arrv.scheduled),
      actual: extractDateString(arrv.actualTimeLocal || arrv.actualTime || arrv.actual),
      est: extractDateString(arrv.estimatedTimeLocal || arrv.estimatedTime || arrv.estimated),
      terminal: arrv.terminal || "",
      gate: arrv.gate || "",
    },
    raw: item,
  };
}

/* ===== AeroDataBox ===== */
async function adbFetch(path, qs = {}) {
  const url = new URL(`https://${ADB_HOST}${path}`);
  Object.entries(qs).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v); });
  const res = await fetch(url.toString(), {
    headers: { "X-RapidAPI-Key": ADB_KEY, "X-RapidAPI-Host": ADB_HOST },
    cache: "no-store",
  });
  if (!res.ok) { console.warn("AeroDataBox", res.status); return null; }
  try { return await res.json(); } catch { return null; }
}

// TRY ORDER: number → callsign (senin playground’da bu döndü) → dates: 0, -1, +1
async function fetchAeroFlightByNumber(flightIcao) {
  if (!ADB_KEY || !flightIcao) return null;

  const dateList = [todayIsoDate(0), todayIsoDate(-1), todayIsoDate(1)];
  const attempts = [
    (id, d) => adbFetch(`/flights/number/${encodeURIComponent(id)}/${d}`, { withLeg: "true", dateLocalRole: "Departure" }),
    (id, d) => adbFetch(`/flights/callsign/${encodeURIComponent(id)}/${d}`, { withLeg: "true", dateLocalRole: "Both" }),
  ];

  for (const fn of attempts) {
    for (const d of dateList) {
      const data = await fn(flightIcao, d);
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      if (arr?.length) return normalizeFlight(arr[0]);
    }
  }
  return null;
}

async function fetchAeroFlightByRegistration(icao24hex) {
  try {
    const ac = await adbFetch(`/aircraft/icao24/${encodeURIComponent(icao24hex)}`);
    const reg = ac?.registration || ac?.reg || ac?.tail;
    if (!reg) return null;
    const dates = [todayIsoDate(0), todayIsoDate(-1), todayIsoDate(1)];
    for (const d of dates) {
      const data = await adbFetch(`/flights/registration/${encodeURIComponent(reg)}/${d}`, { withLeg: "true" });
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      if (arr?.length) return normalizeFlight(arr[0]);
    }
  } catch {}
  return null;
}

/* ===== Drawer ===== */
const drawer = document.getElementById("flightDrawer");
const drawerBody = document.getElementById("drawerBody");
const drawerTitle = document.getElementById("drawerTitle");
const drawerStatus = document.getElementById("drawerStatus");
const drawerBackdrop = document.getElementById("drawerBackdrop");
const drawerClose = document.getElementById("drawerClose");

function lockMap(lock) {
  if (lock) {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
  } else {
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
  }
}
function openDrawer() {
  drawer.classList.add("open");
  drawerBackdrop.classList.add("open");
  lockMap(true);
}
function closeDrawer() {
  drawer.classList.remove("open");
  drawerBackdrop.classList.remove("open");
  lockMap(false);
}
drawerBackdrop?.addEventListener("click", closeDrawer);
drawerClose?.addEventListener("click", closeDrawer);

function statusBadgeClass(s="") {
  if (/en.?route|active|airborne/i.test(s)) return "bg-success";
  if (/landed|arrived/i.test(s)) return "bg-secondary";
  if (/cancel|divert|delay/i.test(s)) return "bg-danger";
  return "bg-warning";
}

function renderDrawerContent({ callsign, icao24, altOut, spdOut }, info) {
  const depCode = airportCodeLabel(info.dep);
  const arrCode = airportCodeLabel(info.arr);
  const depTime = fmtTimeLocalSafe(info.dep.actual || info.dep.est || info.dep.sched);
  const arrTime = fmtTimeLocalSafe(info.arr.actual || info.arr.est || info.arr.sched);

  drawerTitle.textContent = (callsign || info.number || "Flight").toString().replace(/\s+/g,"");
  drawerStatus.className = `badge ms-2 ${statusBadgeClass(info.status)}`;
  drawerStatus.textContent = info.status || "";

  // Aircraft card (image if present)
  const acModel = info.aircraft?.model || info.aircraft?.icao || "";
  const img = info.aircraft?.image;
  const imgHtml = img?.url ? `
    <div class="drawer-section">
      <a href="${img.webUrl || img.url}" target="_blank" rel="noreferrer">
        <img src="${img.url}" alt="${acModel || 'aircraft'}"
             style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;border:1px solid #20304a;"/>
      </a>
      ${acModel ? `<div style="margin-top:6px;font-weight:600">${acModel}</div>` : ``}
    </div>` : ``;

  drawerBody.innerHTML = `
    <div class="route-line">
      <span class="code" title="${info.dep.name || ""}">${depCode}</span>
      <i class="bi bi-arrow-right"></i>
      <span class="code" title="${info.arr.name || ""}">${arrCode}</span>
    </div>

    ${imgHtml}

    <div class="drawer-meta drawer-section">
      <div class="k">Airline</div><div class="v">${info.airline || "—"}</div>
      <div class="k">Flight</div><div class="v">${(callsign||"").replace(/\s+/g,"") || info.number || "—"}</div>
      <div class="k">Departure</div><div class="v">${depTime}</div>
      <div class="k">Arrival</div><div class="v">${arrTime}</div>
      <div class="k">DEP Term./Gate</div><div class="v">${info.dep.terminal || "—"} ${info.dep.gate ? ("• Gate " + info.dep.gate) : ""}</div>
      <div class="k">ARR Term./Gate</div><div class="v">${info.arr.terminal || "—"} ${info.arr.gate ? ("• Gate " + info.arr.gate) : ""}</div>
    </div>

    <div class="drawer-section stat-cards">
      <div class="stat-card"><div class="k">Altitude</div><div class="v">${altOut}</div></div>
      <div class="stat-card"><div class="k">Speed</div><div class="v">${spdOut}</div></div>
      <div class="stat-card"><div class="k">ICAO24</div><div class="v">${icao24}</div></div>
    </div>
  `;
}

/* ===== Fetch + render ===== */
async function fetchPlanes() {
  try {
    const url = baseUrl(map.getBounds());

    if (flightListEl && !flightListEl.dataset.loaded) {
      flightListEl.innerHTML = `
        <div class="list-group-item skeleton"></div>
        <div class="list-group-item skeleton"></div>
        <div class="list-group-item skeleton"></div>`;
    }

    const data = await fetchJsonWithFallback(url);
    const F = currentFilters();
    const seen = new Set();
    const items = [];

    (data.states || []).forEach((s) => {
      const icao24 = s[0];
      const callsign = (s[1] || "").trim();
      const origin = s[2] || "";
      const lon = s[5], lat = s[6];
      const vel = s[9];      // m/s
      const track = s[10];
      const alt = s[13];     // m
      if (lat == null || lon == null) return;

      // Filters
      const icaoCode = callsignToIcao(callsign);
      if (F.airline && icaoCode !== F.airline) return;
      if (F.altMin != null && alt != null && alt < F.altMin) return;
      if (F.altMax != null && alt != null && alt > F.altMax) return;
      if (F.spdMin != null && vel != null && vel < F.spdMin) return;
      if (F.spdMax != null && vel != null && vel > F.spdMax) return;

      // Display units
      const altOut = (UNITS === "imperial")
        ? (alt != null ? `${toLocale(m2ft(alt))} ft` : "N/A")
        : (alt != null ? `${toLocale(Math.round(alt))} m` : "N/A");
      const spdOut = (UNITS === "imperial")
        ? (vel != null ? `${toLocale(ms2kt(vel))} kts` : "N/A")
        : (vel != null ? `${toLocale(Math.round(vel))} m/s` : "N/A");

      const basePopup = `
        <div>
          <strong>${callsign || "N/A"}</strong> <span class="badge bg-info">${origin}</span><br/>
          <span data-i18n="altitude">${altOut}</span><br/>
          <span data-i18n="speed">${spdOut}</span><br/>
          <small>ICAO24: ${icao24} • Airline: ${icaoCode || "N/A"}</small>
        </div>`;

      let m = markers.get(icao24);
      if (!m) {
        m = L.marker([lat, lon], {
          icon: planeIcon,
          rotationAngle: Number.isFinite(track) ? track : 0,
          rotationOrigin: "center center",
        }).bindPopup(basePopup).addTo(map);
        markers.set(icao24, m);
      } else {
        m.setLatLng([lat, lon]);
        m.setPopupContent(basePopup);
        if (Number.isFinite(track) && typeof m.setRotationAngle === "function") m.setRotationAngle(track);
      }
      seen.add(icao24);

      // List
      items.push({ callsign: callsign || "N/A", origin, altOut, spdOut });

      // Click → drawer
      m.off("click");
      m.on("click", async () => {
        const flightIcao = callsignToFlightIcao(callsign);
        openDrawer();

        // Skeleton
        drawerTitle.textContent = callsign || flightIcao || "Flight";
        drawerStatus.className = "badge ms-2";
        drawerStatus.textContent = "";
        drawerBody.innerHTML = `
          <div class="drawer-skeleton">
            <div class="sk-line"></div><div class="sk-line"></div><div class="sk-line"></div><div class="sk-line"></div>
          </div>
        `;

        // 1) Try by flight number; 2) fallback by callsign; 3) fallback by registration
        let info = flightIcao ? await fetchAeroFlightByNumber(flightIcao) : null;
        if (!info) info = await fetchAeroFlightByRegistration(icao24);

        if (!info) {
          drawerBody.innerHTML = `
            <div class="route-line">
              <span class="code">N/A</span><i class="bi bi-arrow-right"></i><span class="code">N/A</span>
            </div>
            <div class="drawer-section text-warning">No live schedule data (Private/GA veya askeri olabilir)</div>
            <div class="drawer-section stat-cards">
              <div class="stat-card"><div class="k">Altitude</div><div class="v">${altOut}</div></div>
              <div class="stat-card"><div class="k">Speed</div><div class="v">${spdOut}</div></div>
              <div class="stat-card"><div class="k">ICAO24</div><div class="v">${icao24}</div></div>
            </div>
          `;
          return;
        }
        renderDrawerContent({ callsign, icao24, altOut, spdOut }, info);
      });
    });

    // Cleanup markers
    for (const [key, marker] of markers.entries()) {
      if (!seen.has(key)) { marker.remove(); markers.delete(key); }
    }

    if (flightListEl) {
      flightListEl.dataset.loaded = "1";
      flightListEl.innerHTML = items.length
        ? items.map(it => `
            <div class="list-group-item">
              <div class="d-flex justify-content-between">
                <div>
                  <strong>${it.callsign}</strong>
                  <span class="badge bg-info">${it.origin}</span>
                </div>
                <div class="text-end">
                  ${it.altOut}<br/>${it.spdOut}
                </div>
              </div>
            </div>`).join("")
        : `<div class="list-group-item">No flights</div>`;
    }
  } catch (e) {
    console.error(e);
    showToast(`Error: ${e.message}`);
    if (flightListEl) {
      flightListEl.innerHTML = `<div class="list-group-item bg-danger text-light">Error: ${e.message}</div>`;
    }
  }
}

// start
fetchPlanes();
setInterval(fetchPlanes, REFRESH_MS);
