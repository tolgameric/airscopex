// i18n.js — site genelinde çeviriyi uygular ve aktif sözlüğü window.__T__ olarak paylaşır.
(async () => {
    const sel = localStorage.getItem("lang") || "tr";
    try {
      const res = await fetch("lang.json", { cache: "no-store" });
      const dict = await res.json();
      const t = dict[sel] || dict.tr;
  
      // Aktif sözlüğü global ver — drawer render'ı bunu kullanır
      window.__T__ = t;
  
      // NAV
      document.querySelectorAll('[data-i18n="nav.map"]').forEach(el => el.textContent = t.nav.map);
      document.querySelectorAll('[data-i18n="nav.about"]').forEach(el => el.textContent = t.nav.about);
  
      // ABOUT
      document.querySelectorAll('[data-i18n="about.title"]').forEach(el => el.textContent = t.about.title);
      document.querySelectorAll('[data-i18n="about.desc"]').forEach(el => el.textContent = t.about.desc);
  
      // Harita/filtre anahtarları (varsa sayfada)
      const mapKeys = {
        "filtersTitle": "filtersTitle",
        "mapTitle": "mapTitle",
        "flightsTitle": "flightsTitle",
        "airline": "airline",
        "all": "all",
        "altitude": "altitude",
        "speed": "speed",
        "apply": "apply",
        "altitudeHint": "altitudeHint",
        "speedHint": "speedHint",
        "settings": "settings",
        "refresh": "refresh",
        "units": "units",
        "save": "save"
      };
      Object.entries(mapKeys).forEach(([attrKey, tKey]) => {
        document.querySelectorAll(`[data-i18n="${attrKey}"]`).forEach(el => el.textContent = t[tKey]);
      });
  
    } catch (e) {
      // sessiz geç
    }
  })();
      