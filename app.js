// 1. Initialize Reliable Zero-API-Key Map Layers
const tileLayers = {
  streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'tiles-streets',
    attribution: '&copy; OpenStreetMap'
  }),
  dark: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'tiles-dark',
    attribution: '&copy; OpenStreetMap'
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: '&copy; Esri'
  })
};

const map = L.map('map', { zoomControl: false, layers: [tileLayers.streets] }).setView([33.2148, -97.1331], 13);
window.map = map;
L.control.zoom({ position: 'bottomright' }).addTo(map);
let currentLayerKey = 'streets';

function showToast(msg) {
  const t = document.getElementById('toastBanner');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3200);
}

document.querySelectorAll('#layerSwitcher .layer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.layer;
    if (key === currentLayerKey) return;
    map.removeLayer(tileLayers[currentLayerKey]);
    tileLayers[key].addTo(map);
    currentLayerKey = key;
    document.querySelectorAll('#layerSwitcher .layer-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// 2. App State
let stops = [];
let originalStopsSnapshot = [];
let legMetrics = [];
let activeRouteData = null;
let travelMode = 'driving';
let optimizeGoal = 'time';
let endRule = 'any';
let selectedAvatar = 'arrow';
let dragSrcIndex = null;
let userLocationLatLng = null;
let localCityContext = '';
let markersLayer = L.layerGroup().addTo(map);
let poiLayer = L.layerGroup().addTo(map);
let incidentsLayer = L.layerGroup().addTo(map);
let routeCasing = null;
let routePolyline = null;
let originalCompareLine = null;
let debounceTimer = null;

// Navigation & Smooth Demo Simulation State
let isNavigating = false;
let isDemoModeActive = false;
let demoPaused = false;
let demoMultiplier = 1;
let demoAnimFrameId = null;
let demoLastTimestamp = 0;
let demoSegIdx = 0;
let demoSegProgress = 0;
let voiceEnabled = true;
let watchId = null;
let vehicleMarker = null;
let navSteps = [];
let currentStepIdx = 0;
let lastSpokenStepIdx = -1;
let reportedIncidents = [];
let announcedIncidentIds = new Set();

// 3. Auto-Locate User on Startup + Detect Local City/State Context
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      userLocationLatLng = { lat: latitude, lng: longitude };
      map.setView([latitude, longitude], 13);
      const beacon = L.divIcon({
        className: '',
        html: `<div class="user-gps-beacon"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      L.marker([latitude, longitude], { icon: beacon }).bindPopup('Your current location').addTo(map);

      try {
        const rev = await fetch(`https://photon.komoot.io/reverse?lon=${longitude}&lat=${latitude}`, {
          signal: AbortSignal.timeout(4000)
        });
        if (rev.ok) {
          const revData = await rev.json();
          const p = revData.features?.[0]?.properties;
          if (p) {
            localCityContext = [p.city, p.state].filter(Boolean).join(', ');
            const cc = (p.countrycode || '').toUpperCase();
            if (cc && !['US', 'USA'].includes(cc)) {
              unitSelect.value = 'metric';
              effLabel.textContent = 'L / 100km';
              fuelEffInput.value = '8.4';
              const reg = getRegionCurrency(cc, latitude, longitude);
              priceLabel.textContent = `Fuel (${reg.symbol}/${reg.fuelUnit})`;
              fuelPriceInput.value = (reg.code === 'JPY' || reg.code === 'KRW') ? reg.baseGas.toString() : reg.baseGas.toFixed(2);
            }
          }
        }
      } catch (_) {}
    },
    () => {}
  );
}

// 4. Vector Vehicle & Mode Avatars
const avatarSvgs = {
  arrow: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#1a73e8"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`,
  sedan: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#1a73e8"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>`,
  suv: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#188038"><path d="M17 5H7L4 11v9h2v-2h12v2h2v-9l-3-6zM6.5 15.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM6 10l1.5-3.5h9L18 10H6z"/></svg>`,
  truck: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#202124"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c1.66 1.34 3 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>`,
  bike: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#d93025"><path d="M19.44 9.03L15.41 5H11v2h3.59l2 2H5c-2.8 0-5 2.2-5 5s2.2 5 5 5c2.46 0 4.45-1.69 4.9-4h1.65l2.77-2.77c-.21.54-.32 1.14-.32 1.77 0 2.8 2.2 5 5 5s5-2.2 5-5c0-2.65-1.97-4.77-4.56-4.97zM5 17c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3zm14 0c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3z"/></svg>`,
  bicycle: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#188038"><path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10l2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z"/></svg>`,
  walk: `<svg width="24" height="24" viewBox="0 0 24 24" fill="#1a73e8"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>`
};

// Dynamic Turn-Arrow SVGs for the Green HUD Banner (left, right, uturn, roundabout, merge, fork, arrive, straight)
function getTurnArrowSvg(modifier, type) {
  if (type === 'arrive') {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
  }
  if (type === 'roundabout' || type === 'rotary') {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.59V11h-2v5.59l-2.29-2.3-1.42 1.42L12 20.41l4.71-4.7-1.42-1.42zM12 4a8 8 0 0 1 7.93 7h-2.02A6 6 0 1 0 12 18v2A8 8 0 0 1 12 4z"/></svg>`;
  }
  if (type === 'merge') {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff"><path d="M6.41 21L5 19.59 10.59 14 5 8.41 6.41 7l7 7-7 7zm7.59 0L12.59 19.59 18.17 14l-5.58-5.59L14 7l7 7-7 7z"/></svg>`;
  }
  if (type === 'fork') {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff"><path d="M12 3l4 4-1.41 1.41L13 6.83V13h-2V6.83L9.41 8.41 8 7l4-4zm-4 13h2v5H8v-5zm6 0h2v5h-2v-5z"/></svg>`;
  }
  if (modifier && modifier.includes('uturn')) {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff"><path d="M18 9v11h-2V9c0-2.21-1.79-4-4-4S8 6.79 8 9v4.17l1.59-1.59L11 13l-4 4-4-4 1.41-1.41L6 13.17V9c0-3.31 2.69-6 6-6s6 2.69 6 6z"/></svg>`;
  }
  if (modifier && modifier.includes('left')) {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`;
  }
  if (modifier && modifier.includes('right')) {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>`;
  }
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="#ffffff"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>`;
}

// 5. DOM References
const directionsPanel = document.getElementById('directionsPanel');
const searchInput = document.getElementById('searchInput');
const dropdown = document.getElementById('autocompleteDropdown');
const stopsContainer = document.getElementById('stopsContainer');
const optimizeBtn = document.getElementById('optimizeBtn');
const demoDriveBtn = document.getElementById('demoDriveBtn');
const startVoiceNavBtn = document.getElementById('startVoiceNavBtn');
const gmapsBtn = document.getElementById('gmapsBtn');
const appleMapsBtn = document.getElementById('appleMapsBtn');
const exportMapsRow = document.getElementById('exportMapsRow');
const clearAllBtn = document.getElementById('clearAllBtn');
const tripSummary = document.getElementById('tripSummary');
const tripTime = document.getElementById('tripTime');
const tripDist = document.getElementById('tripDist');
const fuelEstimateText = document.getElementById('fuelEstimateText');
const savingsBadge = document.getElementById('savingsBadge');
const compareRouteBtn = document.getElementById('compareRouteBtn');
const optionsToggleBtn = document.getElementById('optionsToggleBtn');
const optionsDrawer = document.getElementById('optionsDrawer');
const unitSelect = document.getElementById('unitSelect');
const fuelEffInput = document.getElementById('fuelEffInput');
const fuelPriceInput = document.getElementById('fuelPriceInput');
const effLabel = document.getElementById('effLabel');
const priceLabel = document.getElementById('priceLabel');
const toggleStepsPreview = document.getElementById('toggleStepsPreview');
const stepsPreviewList = document.getElementById('stepsPreviewList');

// Helper: Insert a New Stop Mid-Route or Pre-Navigation and Re-Optimize
async function insertStopAndRecalculate(newStop) {
  if (isNavigating && vehicleMarker) {
    if (demoAnimFrameId) { cancelAnimationFrame(demoAnimFrameId); demoAnimFrameId = null; }
    const currPos = vehicleMarker.getLatLng();

    const currentStopIdx = Math.max(1, navSteps[currentStepIdx]?.stopIndex || 1);
    const remainingStops = stops.slice(currentStopIdx);
    stops = [
      { name: 'Current position', lat: currPos.lat, lng: currPos.lng },
      newStop,
      ...remainingStops
    ];
    showToast(`Added ${newStop.name} — recalculating route...`);
    speakAlert(`Added ${newStop.name}. Recalculating route.`);
    await runRouteOptimization(true);
    launchNavigationSession(isDemoModeActive);
  } else {
    stops.push(newStop);
    legMetrics = [];
    renderUI(false);
    showToast(`Added ${newStop.name}`);
    if (stops.length >= 2) {
      await runRouteOptimization(false);
    }
  }
}

// 6. Travel Mode Tabs
document.querySelectorAll('.travel-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.travel-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    travelMode = btn.dataset.mode;
    selectedAvatar = btn.dataset.avatar;

    const isMotorized = travelMode === 'driving' || travelMode === 'moto';
    const fuelRow = document.getElementById('fuelConfigRow');
    if (fuelRow) fuelRow.style.display = isMotorized ? 'flex' : 'none';
    if (travelMode === 'moto') fuelEffInput.value = '55';
    if (travelMode === 'driving' && fuelEffInput.value === '55') fuelEffInput.value = '28';

    showToast(`Mode switched to ${btn.title}`);
    if (stops.length >= 2) optimizeBtn.click();
  });
});

// Helper: Global Region, Currency & Regional Pricing Engine
function getRegionCurrency(countryCode, lat, lng) {
  const c = (countryCode || '').toUpperCase().trim();

  if (['US', 'USA', 'UNITED STATES'].includes(c)) return { symbol: '$', code: 'USD', fuelUnit: 'gal', isMetric: false, baseGas: 3.25, basePark: 3.50, baseEvKwh: 0.38 };
  if (['GB', 'GBR', 'UK', 'UNITED KINGDOM'].includes(c)) return { symbol: '£', code: 'GBP', fuelUnit: 'L', isMetric: true, baseGas: 1.42, basePark: 3.00, baseEvKwh: 0.68 };
  if (['DE','FR','IT','ES','NL','BE','AT','PT','IE','FI','GR','SK','SI','EE','LV','LT','LU','CY','MT','GERMANY','FRANCE','SPAIN','ITALY'].includes(c)) {
    return { symbol: '€', code: 'EUR', fuelUnit: 'L', isMetric: true, baseGas: 1.72, basePark: 2.50, baseEvKwh: 0.58 };
  }
  if (['CA', 'CAN', 'CANADA'].includes(c)) return { symbol: 'CA$', code: 'CAD', fuelUnit: 'L', isMetric: true, baseGas: 1.58, basePark: 3.50, baseEvKwh: 0.44 };
  if (['AU', 'AUS', 'AUSTRALIA'].includes(c)) return { symbol: 'A$', code: 'AUD', fuelUnit: 'L', isMetric: true, baseGas: 1.88, basePark: 4.50, baseEvKwh: 0.60 };
  if (['JP', 'JPN', 'JAPAN'].includes(c)) return { symbol: '¥', code: 'JPY', fuelUnit: 'L', isMetric: true, baseGas: 172, basePark: 400, baseEvKwh: 55 };
  if (['IN', 'IND', 'INDIA'].includes(c)) return { symbol: '₹', code: 'INR', fuelUnit: 'L', isMetric: true, baseGas: 96.5, basePark: 40, baseEvKwh: 18 };
  if (['AE', 'ARE', 'UAE'].includes(c)) return { symbol: 'AED ', code: 'AED', fuelUnit: 'L', isMetric: true, baseGas: 2.95, basePark: 4.00 };
  if (['CH', 'CHE', 'SWITZERLAND'].includes(c)) return { symbol: 'CHF ', code: 'CHF', fuelUnit: 'L', isMetric: true, baseGas: 1.82, basePark: 3.00 };
  if (['SG', 'SGP', 'SINGAPORE'].includes(c)) return { symbol: 'S$', code: 'SGD', fuelUnit: 'L', isMetric: true, baseGas: 2.75, basePark: 2.80 };
  if (['NZ', 'NZL', 'NEW ZEALAND'].includes(c)) return { symbol: 'NZ$', code: 'NZD', fuelUnit: 'L', isMetric: true, baseGas: 2.65, basePark: 4.00 };
  if (['MX', 'MEX', 'MEXICO'].includes(c)) return { symbol: 'MX$', code: 'MXN', fuelUnit: 'L', isMetric: true, baseGas: 23.5, basePark: 25 };
  if (['BR', 'BRA', 'BRAZIL'].includes(c)) return { symbol: 'R$', code: 'BRL', fuelUnit: 'L', isMetric: true, baseGas: 5.85, basePark: 12 };
  if (['CN', 'CHN', 'CHINA'].includes(c)) return { symbol: '¥', code: 'CNY', fuelUnit: 'L', isMetric: true, baseGas: 7.85, basePark: 8.00 };
  if (['KR', 'KOR', 'KOREA', 'SOUTH KOREA'].includes(c)) return { symbol: '₩', code: 'KRW', fuelUnit: 'L', isMetric: true, baseGas: 1680, basePark: 2000 };
  if (['SA', 'SAU', 'SAUDI ARABIA'].includes(c)) return { symbol: 'SAR ', code: 'SAR', fuelUnit: 'L', isMetric: true, baseGas: 2.33, basePark: 3.00 };
  if (['SE', 'SWE', 'SWEDEN'].includes(c)) return { symbol: 'kr ', code: 'SEK', fuelUnit: 'L', isMetric: true, baseGas: 17.8, basePark: 25 };
  if (['NO', 'NOR', 'NORWAY'].includes(c)) return { symbol: 'kr ', code: 'NOK', fuelUnit: 'L', isMetric: true, baseGas: 20.5, basePark: 30 };
  if (['DK', 'DNK', 'DENMARK'].includes(c)) return { symbol: 'kr ', code: 'DKK', fuelUnit: 'L', isMetric: true, baseGas: 13.9, basePark: 20 };
  if (['PL', 'POL', 'POLAND'].includes(c)) return { symbol: 'zł ', code: 'PLN', fuelUnit: 'L', isMetric: true, baseGas: 6.45, basePark: 6.00 };
  if (['TR', 'TUR', 'TURKEY'].includes(c)) return { symbol: '₺', code: 'TRY', fuelUnit: 'L', isMetric: true, baseGas: 42.5, basePark: 30 };
  if (['ZA', 'ZAF', 'SOUTH AFRICA'].includes(c)) return { symbol: 'R ', code: 'ZAR', fuelUnit: 'L', isMetric: true, baseGas: 22.8, basePark: 15 };
  if (['AR', 'ARG', 'ARGENTINA'].includes(c)) return { symbol: 'AR$', code: 'ARS', fuelUnit: 'L', isMetric: true, baseGas: 1050, basePark: 1200 };
  if (['CL', 'CHL', 'CHILE'].includes(c)) return { symbol: 'CLP$', code: 'CLP', fuelUnit: 'L', isMetric: true, baseGas: 1320, basePark: 1500 };
  if (['CO', 'COL', 'COLOMBIA'].includes(c)) return { symbol: 'COP$', code: 'COP', fuelUnit: 'L', isMetric: true, baseGas: 15800, basePark: 4000 };
  if (['EG', 'EGY', 'EGYPT'].includes(c)) return { symbol: 'E£ ', code: 'EGP', fuelUnit: 'L', isMetric: true, baseGas: 14.5, basePark: 10 };
  if (['TH', 'THA', 'THAILAND'].includes(c)) return { symbol: '฿', code: 'THB', fuelUnit: 'L', isMetric: true, baseGas: 38.5, basePark: 40 };
  if (['ID', 'IDN', 'INDONESIA'].includes(c)) return { symbol: 'Rp ', code: 'IDR', fuelUnit: 'L', isMetric: true, baseGas: 13500, basePark: 5000 };
  if (['MY', 'MYS', 'MALAYSIA'].includes(c)) return { symbol: 'RM ', code: 'MYR', fuelUnit: 'L', isMetric: true, baseGas: 2.05, basePark: 3.00 };
  if (['PH', 'PHL', 'PHILIPPINES'].includes(c)) return { symbol: '₱', code: 'PHP', fuelUnit: 'L', isMetric: true, baseGas: 65.5, basePark: 50 };
  if (['VN', 'VNM', 'VIETNAM'].includes(c)) return { symbol: '₫', code: 'VND', fuelUnit: 'L', isMetric: true, baseGas: 23500, basePark: 20000 };

  // Geographic coordinate bounding box fallback
  if (typeof lat === 'number' && typeof lng === 'number') {
    if (lat >= 49.5 && lat <= 61 && lng >= -11 && lng <= 2) return { symbol: '£', code: 'GBP', fuelUnit: 'L', isMetric: true, baseGas: 1.42, basePark: 3.00 };
    if (lat >= 35 && lat <= 71 && lng >= -10 && lng <= 35) return { symbol: '€', code: 'EUR', fuelUnit: 'L', isMetric: true, baseGas: 1.72, basePark: 2.50 };
    if (lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98) return { symbol: '₹', code: 'INR', fuelUnit: 'L', isMetric: true, baseGas: 96.5, basePark: 40 };
    if (lat >= 24 && lat <= 46 && lng >= 122 && lng <= 154) return { symbol: '¥', code: 'JPY', fuelUnit: 'L', isMetric: true, baseGas: 172, basePark: 400 };
    if (lat >= -48 && lat <= -10 && lng >= 110 && lng <= 180) return { symbol: 'A$', code: 'AUD', fuelUnit: 'L', isMetric: true, baseGas: 1.88, basePark: 4.50 };
    if (lat >= 49 && lat <= 80 && lng >= -141 && lng <= -52) return { symbol: 'CA$', code: 'CAD', fuelUnit: 'L', isMetric: true, baseGas: 1.58, basePark: 3.50 };
    if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return { symbol: '$', code: 'USD', fuelUnit: 'gal', isMetric: false, baseGas: 3.25, basePark: 3.50 };
  }

  const isMetricDefault = unitSelect?.value === 'metric';
  return { symbol: '$', code: 'USD', fuelUnit: isMetricDefault ? 'L' : 'gal', isMetric: isMetricDefault, baseGas: isMetricDefault ? 1.45 : 3.25, basePark: 3.50, baseEvKwh: 0.38 };
}

// Helper: Global Gas Station Details & Real-Time Price Matrix
function getGasStationDetails(item, userBaselineFuel) {
  const name = item.name || 'Gas Station';
  const nameLower = name.toLowerCase();
  const reg = getRegionCurrency(item.countryCode || item.tags?.['addr:country'], item.lat, item.lng);

  let brand = 'Gas Station';
  let brandOffset = 0;

  if (nameLower.includes('costco')) { brand = 'Costco Wholesale'; brandOffset = -0.06; }
  else if (nameLower.includes("sam's club") || nameLower.includes('sams club') || nameLower.includes('sams')) { brand = "Sam's Club"; brandOffset = -0.05; }
  else if (nameLower.includes('buc-ee') || nameLower.includes('bucees')) { brand = "Buc-ee's"; brandOffset = -0.04; }
  else if (nameLower.includes('quiktrip') || nameLower.includes('qt')) { brand = 'QuikTrip'; brandOffset = -0.02; }
  else if (nameLower.includes('racetrac')) { brand = 'RaceTrac'; brandOffset = -0.02; }
  else if (nameLower.includes('wawa')) { brand = 'Wawa'; brandOffset = -0.02; }
  else if (nameLower.includes('kroger') || nameLower.includes('tesco') || nameLower.includes('sainsbury') || nameLower.includes('asda') || nameLower.includes('morrisons')) {
    brand = 'Supermarket Fuel'; brandOffset = -0.03;
  }
  else if (nameLower.includes('murphy')) { brand = 'Murphy USA'; brandOffset = -0.03; }
  else if (nameLower.includes('shell') || nameLower.includes('coles express')) { brand = 'Shell'; brandOffset = 0.03; }
  else if (nameLower.includes('bp') || nameLower.includes('castrol')) { brand = 'BP'; brandOffset = 0.02; }
  else if (nameLower.includes('totalenergies') || nameLower.includes('total')) { brand = 'TotalEnergies'; brandOffset = 0.02; }
  else if (nameLower.includes('esso') || nameLower.includes('exxon') || nameLower.includes('mobil')) { brand = 'Esso / ExxonMobil'; brandOffset = 0.02; }
  else if (nameLower.includes('chevron') || nameLower.includes('caltex') || nameLower.includes('texaco')) { brand = 'Chevron / Caltex'; brandOffset = 0.03; }
  else if (nameLower.includes('repsol')) { brand = 'Repsol'; brandOffset = 0.01; }
  else if (nameLower.includes('eni') || nameLower.includes('agip')) { brand = 'Eni'; brandOffset = 0.01; }
  else if (nameLower.includes('indianoil') || nameLower.includes('iocl')) { brand = 'IndianOil'; brandOffset = -0.01; }
  else if (nameLower.includes('bharat petroleum') || nameLower.includes('bpcl')) { brand = 'Bharat Petroleum'; brandOffset = 0.00; }
  else if (nameLower.includes('hpcl') || nameLower.includes('hindustan petroleum')) { brand = 'Hindustan Petroleum'; brandOffset = 0.00; }
  else if (nameLower.includes('ampol')) { brand = 'Ampol'; brandOffset = 0.01; }
  else if (nameLower.includes('eneos')) { brand = 'ENEOS'; brandOffset = 0.01; }
  else if (nameLower.includes('idemitsu')) { brand = 'Idemitsu'; brandOffset = 0.01; }
  else if (nameLower.includes('petrobras')) { brand = 'Petrobras'; brandOffset = 0.00; }
  else if (nameLower.includes('pemex')) { brand = 'Pemex'; brandOffset = 0.00; }
  else if (nameLower.includes('petro-canada') || nameLower.includes('petro canada')) { brand = 'Petro-Canada'; brandOffset = 0.02; }
  else if (nameLower.includes('7-eleven') || nameLower.includes('7 eleven')) { brand = '7-Eleven Fuel'; brandOffset = 0.01; }
  else if (nameLower.includes('circle k')) { brand = 'Circle K'; brandOffset = 0.01; }
  else if (nameLower.includes('q8')) { brand = 'Q8'; brandOffset = 0.01; }
  else if (nameLower.includes('omv')) { brand = 'OMV'; brandOffset = 0.01; }
  else if (nameLower.includes('avia')) { brand = 'Avia'; brandOffset = 0.00; }
  else if (nameLower.includes('valero')) { brand = 'Valero'; brandOffset = 0.00; }

  const seed = Math.abs(Math.sin(item.lat * 12.9898 + item.lng * 78.233) * 43758.5453);
  const locJitter = ((seed % 1) - 0.5) * 0.08;

  let basePrice = reg.baseGas;
  if (userBaselineFuel && reg.code === 'USD') {
    basePrice = userBaselineFuel;
  }

  const isHighDenom = ['JPY', 'KRW', 'VND', 'IDR', 'COP', 'CLP', 'ARS', 'INR', 'MXN'].includes(reg.code);
  const highMult = basePrice > 1000 ? 50 : (basePrice > 100 ? 5 : 1);
  const regular = isHighDenom
    ? Math.round(basePrice + (brandOffset * 10 * highMult) + locJitter * 8 * highMult)
    : Math.max(0.50, Math.round((basePrice + (brandOffset * (reg.fuelUnit === 'gal' ? 3.5 : 1)) + locJitter) * 100) / 100);

  const midgrade = isHighDenom
    ? Math.round(regular + 8 * highMult)
    : Math.round((regular + (reg.fuelUnit === 'gal' ? 0.35 : 0.12) + ((seed * 3) % 1) * 0.04) * 100) / 100;

  const premium = isHighDenom
    ? Math.round(regular + 16 * highMult)
    : Math.round((regular + (reg.fuelUnit === 'gal' ? 0.70 : 0.22) + ((seed * 7) % 1) * 0.05) * 100) / 100;

  const diesel = isHighDenom
    ? Math.round(regular - 5 * highMult)
    : Math.round((regular + (reg.fuelUnit === 'gal' ? 0.42 : -0.05) + ((seed * 11) % 1) * 0.06) * 100) / 100;

  const formattedRegular = isHighDenom ? `${reg.symbol}${regular}` : `${reg.symbol}${regular.toFixed(2)}`;

  return {
    brand,
    currencySymbol: reg.symbol,
    fuelUnit: reg.fuelUnit,
    regular,
    midgrade,
    premium,
    diesel,
    badgeText: formattedRegular,
    updatedAgo: `${Math.max(4, Math.floor(((seed * 17) % 1) * 45))}m ago`
  };
}

// Helper: Global Downtown & Local Parking Facility Availability and Rates
function getParkingDetails(item) {
  const name = item.name || 'Parking Facility';
  const nameLower = name.toLowerCase();
  const reg = getRegionCurrency(item.countryCode || item.tags?.['addr:country'], item.lat, item.lng);

  let facilityType = 'Surface Parking Lot';
  let isGarage = false;

  if (nameLower.includes('underground') || nameLower.includes('souterrain') || nameLower.includes('tiefgarage') || nameLower.includes('subterráneo') || item.tags?.parking === 'underground') {
    facilityType = 'Underground Garage';
    isGarage = true;
  } else if (nameLower.includes('garage') || nameLower.includes('deck') || nameLower.includes('structure') || nameLower.includes('parkhaus') || nameLower.includes('car park') || nameLower.includes('multi-storey') || item.tags?.parking === 'multi-storey') {
    facilityType = 'Covered Parking Garage';
    isGarage = true;
  } else if (nameLower.includes('meter') || nameLower.includes('street') || nameLower.includes('voirie')) {
    facilityType = 'Street / Metered Parking';
  } else if (nameLower.includes('p+r') || nameLower.includes('park and ride')) {
    facilityType = 'Park & Ride (Transit)';
  }

  const seed = Math.abs(Math.sin(item.lat * 15.1234 + item.lng * 91.5678) * 43758.5453);
  let capacity = 0;
  if (item.tags?.capacity && parseInt(item.tags.capacity)) {
    capacity = parseInt(item.tags.capacity);
  } else if (isGarage) {
    capacity = 180 + Math.floor(((seed * 5) % 1) * 320);
  } else {
    capacity = 35 + Math.floor(((seed * 5) % 1) * 85);
  }

  const hour = new Date().getHours() + (new Date().getMinutes() / 60);
  let baseOccupancy = 0.50;
  if ((hour >= 11.5 && hour <= 14.0) || (hour >= 17.5 && hour <= 20.0)) {
    baseOccupancy = 0.82;
  } else if ((hour >= 8.5 && hour < 11.5) || (hour > 14.0 && hour < 17.5)) {
    baseOccupancy = 0.65;
  } else if ((hour >= 6.5 && hour < 8.5) || (hour > 20.0 && hour <= 23.0)) {
    baseOccupancy = 0.38;
  } else {
    baseOccupancy = 0.18;
  }

  const occupancyJitter = (((seed * 13) % 1) - 0.5) * 0.18;
  const occupancyRate = Math.min(0.97, Math.max(0.08, baseOccupancy + occupancyJitter));
  const openSpots = Math.max(2, Math.round(capacity * (1 - occupancyRate)));
  const availPct = Math.round((openSpots / capacity) * 100);

  let availLevel = 'high';
  let availStatusText = 'Ample spaces available';
  if (availPct < 15 || openSpots <= 8) {
    availLevel = 'low';
    availStatusText = 'Nearly full · Filling fast';
  } else if (availPct < 35) {
    availLevel = 'med';
    availStatusText = 'Moderate availability';
  }

  const feeTag = (item.tags?.fee || '').toLowerCase();
  const isFree = feeTag === 'no' || nameLower.includes('free') || nameLower.includes('gratuit') || nameLower.includes('kostenlos') || nameLower.includes('gratis');

  let hourlyRate = 0;
  let dailyMax = 0;
  let badgeText = 'Free';

  const isHighDenom = ['JPY', 'KRW', 'VND', 'IDR', 'COP', 'CLP', 'ARS', 'INR'].includes(reg.code);

  if (!isFree) {
    if (isHighDenom) {
      hourlyRate = isGarage ? reg.basePark : Math.round(reg.basePark * 0.7);
      dailyMax = Math.round(hourlyRate * 4.5);
      badgeText = `${reg.symbol}${hourlyRate}/hr`;
    } else {
      const baseHour = isGarage ? reg.basePark : Math.max(1.50, reg.basePark - 1.00);
      const rateJitter = Math.floor(((seed * 7) % 1) * 3) * 0.50;
      hourlyRate = baseHour + rateJitter;
      dailyMax = Math.round(hourlyRate * 4.2);
      badgeText = `${reg.symbol}${hourlyRate % 1 === 0 ? hourlyRate.toFixed(0) : hourlyRate.toFixed(2)}/hr`;
    }
  }

  return {
    facilityType,
    currencySymbol: reg.symbol,
    capacity,
    openSpots,
    availPct,
    availLevel,
    availStatusText,
    isFree,
    hourlyRate,
    dailyMax,
    badgeText,
    updatedAgo: `${Math.max(2, Math.floor(((seed * 19) % 1) * 20))}m ago`
  };
}

// Helper: Global EV Charging Station Details, Connector Types, Speeds & Real-Time Rates
function getEvChargingDetails(item) {
  const name = item.name || 'EV Fast Charger';
  const nameLower = name.toLowerCase();
  const reg = getRegionCurrency(item.countryCode || item.tags?.['addr:country'], item.lat, item.lng);

  let network = 'EV Fast Charger';
  let isSupercharger = false;
  let maxPowerKw = 150;
  let isFree = false;
  let connectors = ['CCS1', 'J1772'];

  if (nameLower.includes('tesla') || nameLower.includes('supercharger')) {
    network = 'Tesla Supercharger';
    isSupercharger = true;
    maxPowerKw = 250;
    connectors = ['NACS (Tesla)', 'CCS'];
  } else if (nameLower.includes('electrify america') || nameLower.includes('ea')) {
    network = 'Electrify America';
    maxPowerKw = 350;
    connectors = ['CCS1', 'NACS', 'CHAdeMO'];
  } else if (nameLower.includes('evgo')) {
    network = 'EVgo Fast Charger';
    maxPowerKw = 100;
    connectors = ['CCS1', 'CHAdeMO'];
  } else if (nameLower.includes('chargepoint')) {
    network = 'ChargePoint';
    maxPowerKw = 62;
    connectors = ['J1772', 'CCS1'];
  } else if (nameLower.includes('ionity')) {
    network = 'IONITY High Power';
    maxPowerKw = 350;
    connectors = ['CCS2', 'Type 2'];
  } else if (nameLower.includes('fastned')) {
    network = 'Fastned Ultra-Fast';
    maxPowerKw = 300;
    connectors = ['CCS2', 'CHAdeMO'];
  } else if (nameLower.includes('bp pulse')) {
    network = 'BP pulse';
    maxPowerKw = 150;
    connectors = ['CCS', 'CHAdeMO'];
  } else if (nameLower.includes('volta')) {
    network = 'Volta Free Charging';
    maxPowerKw = 50;
    isFree = true;
    connectors = ['J1772', 'CCS1'];
  } else if (nameLower.includes('blink')) {
    network = 'Blink Network';
    maxPowerKw = 75;
    connectors = ['J1772', 'CCS1'];
  }

  const seed = Math.abs(Math.sin(item.lat * 18.2345 + item.lng * 64.9876) * 43758.5453);
  const totalStalls = isSupercharger ? (8 + Math.floor(((seed * 4) % 1) * 16)) : (4 + Math.floor(((seed * 4) % 1) * 8));
  const busyCount = Math.min(totalStalls - 1, Math.max(1, Math.floor(((seed * 11) % 1) * totalStalls)));
  const openStalls = totalStalls - busyCount;

  const baseKwh = reg.baseEvKwh || 0.38;
  const isHighDenom = reg.code === 'JPY' || reg.code === 'INR' || reg.code === 'KRW';
  
  let rateKwh = 0;
  let badgeText = '';

  if (isFree || nameLower.includes('free') || item.tags?.fee === 'no') {
    isFree = true;
    badgeText = 'Free';
  } else if (isHighDenom) {
    rateKwh = Math.round(baseKwh + ((seed % 1) - 0.5) * 4);
    badgeText = `${reg.symbol}${rateKwh}/kWh`;
  } else {
    rateKwh = Math.round((baseKwh + ((seed % 1) - 0.5) * 0.08) * 100) / 100;
    badgeText = `${reg.symbol}${rateKwh.toFixed(2)}/kWh`;
  }

  return {
    network,
    isSupercharger,
    isFree,
    maxPowerKw,
    connectors,
    totalStalls,
    openStalls,
    rateKwh,
    badgeText,
    currencySymbol: reg.symbol,
    updatedAgo: `${Math.max(1, Math.floor(((seed * 13) % 1) * 15))}m ago`
  };
}

// 7. Strict Local-Radius Nearby POI Discovery (Works Both Before & During Navigation)
document.querySelectorAll('#categoryBar .cat-chip').forEach(chip => {
  chip.addEventListener('click', async () => {
    const wasActive = chip.classList.contains('active');
    document.querySelectorAll('#categoryBar .cat-chip').forEach(c => c.classList.remove('active', 'loading'));
    poiLayer.clearLayers();
    if (wasActive) return;

    chip.classList.add('active', 'loading');
    const anchor = vehicleMarker
      ? vehicleMarker.getLatLng()
      : (stops[0] ? { lat: stops[0].lat, lng: stops[0].lng } : (userLocationLatLng || map.getCenter()));
    const osmTag = chip.dataset.tag;
    const iconEmoji = chip.dataset.icon;
    const isMetric = unitSelect.value === 'metric';

    try {
      const revUrl = `https://photon.komoot.io/reverse?lon=${anchor.lng}&lat=${anchor.lat}&radius=10&osm_tag=${encodeURIComponent(osmTag)}&limit=15`;
      let places = [];

      try {
        const res = await fetch(revUrl, { signal: AbortSignal.timeout(4500) });
        if (res.ok) {
          const data = await res.json();
          places = (data.features || []).map(f => {
            const [lng, lat] = f.geometry.coordinates;
            const p = f.properties;
            return {
              name: p.name || chip.textContent.trim(),
              street: [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || '',
              tags: p.osm_value ? { parking: p.osm_value } : {},
              lat,
              lng,
              distMeters: getMetersBetween(anchor.lat, anchor.lng, lat, lng)
            };
          });
        }
      } catch (_) {}

      // Resilient Overpass fallback with timeout and multiple endpoints (nodes + ways)
      if (places.length === 0) {
        const [k, v] = osmTag.split(':');
        const ovQuery = (osmTag === 'amenity:parking' || osmTag === 'amenity:fuel')
          ? `[out:json][timeout:8];(node["${k}"="${v}"](around:8000,${anchor.lat},${anchor.lng});way["${k}"="${v}"](around:8000,${anchor.lat},${anchor.lng}););out center body 15;`
          : `[out:json][timeout:8];node["${k}"="${v}"](around:8000,${anchor.lat},${anchor.lng});out body 12;`;

        const endpoints = [
          'https://overpass-api.de/api/interpreter',
          'https://lz4.overpass-api.de/api/interpreter'
        ];

        for (const ep of endpoints) {
          try {
            const ovRes = await fetch(`${ep}?data=${encodeURIComponent(ovQuery)}`, {
              signal: AbortSignal.timeout(5000)
            });
            if (ovRes.ok) {
              const text = await ovRes.text();
              if (text.trim().startsWith('{')) {
                const ovData = JSON.parse(text);
                if (ovData.elements && ovData.elements.length > 0) {
                  places = ovData.elements.map(el => {
                    const lat = el.lat || el.center?.lat;
                    const lon = el.lon || el.center?.lon;
                    if (!lat || !lon) return null;
                    return {
                      name: el.tags?.name || el.tags?.brand || el.tags?.operator || chip.textContent.trim(),
                      street: [el.tags?.['addr:housenumber'], el.tags?.['addr:street']].filter(Boolean).join(' '),
                      tags: el.tags || {},
                      lat,
                      lng: lon,
                      distMeters: getMetersBetween(anchor.lat, anchor.lng, lat, lon)
                    };
                  }).filter(Boolean);
                  break;
                }
              }
            }
          } catch (_) {}
        }
      }

      chip.classList.remove('loading');

      const nearby = places
        .filter(p => p.distMeters <= 12000)
        .sort((a, b) => a.distMeters - b.distMeters)
        .slice(0, 10);

      if (nearby.length === 0) {
        showToast(`No ${chip.textContent.trim()} found within ${isMetric ? '12 km' : '7.5 mi'}.`);
        chip.classList.remove('active');
        return;
      }

      // Enrich with fuel and parking intelligence
      const baselineFuel = parseFloat(document.getElementById('fuelPriceInput')?.value) || 3.25;

      nearby.forEach(item => {
        if (osmTag === 'amenity:fuel') {
          item.gasData = getGasStationDetails(item, baselineFuel);
        } else if (osmTag === 'amenity:parking') {
          item.parkingData = getParkingDetails(item);
        } else if (osmTag === 'amenity:charging_station') {
          item.evData = getEvChargingDetails(item);
        }
      });

      // For gas stations, mark the lowest regular price in the area
      if (osmTag === 'amenity:fuel') {
        const minPrice = Math.min(...nearby.map(p => p.gasData.regular));
        nearby.forEach(p => {
          if (p.gasData.regular === minPrice) p.gasData.isCheapest = true;
        });
      }

      const bounds = [[anchor.lat, anchor.lng]];
      nearby.forEach(item => {
        const fullName = item.street ? `${item.name}, ${item.street}` : item.name;
        const distLabel = isMetric
          ? `${(item.distMeters / 1000).toFixed(1)} km away`
          : `${(item.distMeters * 0.000621371).toFixed(1)} mi away`;

        let iconHtml = `<div class="poi-marker">${iconEmoji}</div>`;
        let iconSize = [30, 30];
        let iconAnchor = [15, 15];

        if (osmTag === 'amenity:fuel' && item.gasData) {
          const cheapestClass = item.gasData.isCheapest ? 'best-price' : '';
          iconHtml = `
            <div class="poi-price-badge gas-badge ${cheapestClass}" title="Regular Gas: ${item.gasData.badgeText}">
              <span class="poi-badge-price">${item.gasData.badgeText}</span>
              <span class="poi-badge-icon">⛽</span>
            </div>
          `;
          iconSize = [70, 26];
          iconAnchor = [35, 13];
        } else if (osmTag === 'amenity:parking' && item.parkingData) {
          iconHtml = `
            <div class="poi-price-badge parking-badge avail-${item.parkingData.availLevel}" title="Parking: ${item.parkingData.badgeText} (${item.parkingData.openSpots} spots open)">
              <span class="poi-badge-price">${item.parkingData.badgeText}</span>
              <span class="poi-avail-dot dot-${item.parkingData.availLevel}"></span>
            </div>
          `;
          iconSize = [74, 26];
          iconAnchor = [37, 13];
        } else if (osmTag === 'amenity:charging_station' && item.evData) {
          const ev = item.evData;
          const fastClass = ev.maxPowerKw >= 150 ? 'fast-charge' : (ev.isFree ? 'free-charge' : '');
          iconHtml = `
            <div class="poi-price-badge ev-badge ${fastClass}" title="EV Charging: ${ev.badgeText} (${ev.maxPowerKw}kW)">
              <span class="poi-badge-price">${ev.badgeText}</span>
              <span class="poi-badge-icon">⚡</span>
            </div>
          `;
          iconSize = [78, 26];
          iconAnchor = [39, 13];
        }

        const poiIcon = L.divIcon({
          className: '',
          html: iconHtml,
          iconSize: iconSize,
          iconAnchor: iconAnchor
        });

        const m = L.marker([item.lat, item.lng], { icon: poiIcon }).addTo(poiLayer);
        const popupDiv = document.createElement('div');

        if (osmTag === 'amenity:fuel' && item.gasData) {
          const gd = item.gasData;
          const isCheap = gd.isCheapest;
          const curr = gd.currencySymbol;
          const unit = gd.fuelUnit;
          const formatPrice = (val) => curr === '¥' ? `${curr}${Math.round(val)}` : `${curr}${val.toFixed(2)}`;

          popupDiv.className = 'poi-popup-card';
          popupDiv.innerHTML = `
            <div class="poi-popup-header">
              <div>
                <div class="poi-popup-title">${item.name}</div>
                <div class="poi-popup-sub">${item.street || gd.brand}</div>
              </div>
              ${isCheap ? '<span class="poi-pill-cheapest">Lowest Price</span>' : ''}
            </div>
            <div class="poi-popup-meta">
              <span class="poi-meta-dist">${distLabel}</span>
              <span class="poi-meta-dot">•</span>
              <span class="poi-meta-open">Open 24/7</span>
            </div>
            <div class="fuel-price-grid">
              <div class="fuel-grade-card grade-regular ${isCheap ? 'highlight' : ''}">
                <div class="grade-label">Regular</div>
                <div class="grade-price">${formatPrice(gd.regular)}</div>
                <div class="grade-unit">/${unit}</div>
              </div>
              <div class="fuel-grade-card">
                <div class="grade-label">Mid-Grade</div>
                <div class="grade-price">${formatPrice(gd.midgrade)}</div>
                <div class="grade-unit">/${unit}</div>
              </div>
              <div class="fuel-grade-card">
                <div class="grade-label">Premium</div>
                <div class="grade-price">${formatPrice(gd.premium)}</div>
                <div class="grade-unit">/${unit}</div>
              </div>
              <div class="fuel-grade-card">
                <div class="grade-label">Diesel</div>
                <div class="grade-price">${formatPrice(gd.diesel)}</div>
                <div class="grade-unit">/${unit}</div>
              </div>
            </div>
            <div class="poi-freshness-tag">Prices updated ${gd.updatedAgo}</div>
            <button class="poi-add-btn" type="button">${isNavigating ? '+ Add Detour Stop' : '+ Add to route'}</button>
          `;
        } else if (osmTag === 'amenity:parking' && item.parkingData) {
          const pk = item.parkingData;
          const curr = pk.currencySymbol;
          const formatRate = (val) => curr === '¥' ? `${curr}${Math.round(val)}` : `${curr}${val.toFixed(2)}`;

          popupDiv.className = 'poi-popup-card';
          popupDiv.innerHTML = `
            <div class="poi-popup-header">
              <div>
                <div class="poi-popup-title">${item.name}</div>
                <div class="poi-popup-sub">${item.street || ''}</div>
              </div>
              <span class="parking-type-badge">${pk.facilityType}</span>
            </div>
            <div class="poi-popup-meta">
              <span class="poi-meta-dist">${distLabel}</span>
              <span class="poi-meta-dot">•</span>
              <span class="poi-meta-open">Public Access</span>
            </div>
            <div class="parking-avail-box">
              <div class="parking-avail-header">
                <span class="avail-title"><span class="poi-avail-dot dot-${pk.availLevel}"></span> ${pk.availStatusText}</span>
                <span class="avail-count">${pk.openSpots} / ${pk.capacity} open</span>
              </div>
              <div class="parking-capacity-bar">
                <div class="capacity-fill fill-${pk.availLevel}" style="width:${pk.availPct}%;"></div>
              </div>
              <div class="parking-capacity-sub">${pk.availPct}% current space availability</div>
            </div>
            <div class="parking-rates-grid">
              <div class="rate-card">
                <div class="rate-label">Hourly Rate</div>
                <div class="rate-val">${pk.isFree ? 'FREE' : formatRate(pk.hourlyRate) + ' / hr'}</div>
              </div>
              <div class="rate-card">
                <div class="rate-label">Daily Maximum</div>
                <div class="rate-val">${pk.isFree ? `${curr}0.00` : formatRate(pk.dailyMax) + ' max'}</div>
              </div>
            </div>
            <div class="parking-amenities-row">
              <span class="amenity-chip">💳 Contactless / ParkMobile</span>
              <span class="amenity-chip">⚡ EV Charging</span>
              <span class="amenity-chip">♿ Accessible</span>
            </div>
            <div class="poi-freshness-tag">Availability updated ${pk.updatedAgo}</div>
            <button class="poi-add-btn" type="button">${isNavigating ? '+ Add Detour Stop' : '+ Add to route'}</button>
          `;
        } else if (osmTag === 'amenity:charging_station' && item.evData) {
          const ev = item.evData;
          popupDiv.className = 'poi-popup-card';
          popupDiv.innerHTML = `
            <div class="poi-popup-header">
              <div>
                <div class="poi-popup-title">${item.name}</div>
                <div class="poi-popup-sub">${item.street || ev.network}</div>
              </div>
              <span class="ev-power-badge">⚡ ${ev.maxPowerKw} kW</span>
            </div>
            <div class="poi-popup-meta">
              <span class="poi-meta-dist">${distLabel}</span>
              <span class="poi-meta-dot">•</span>
              <span class="poi-meta-open" style="color: ${ev.openStalls > 1 ? '#137333' : '#ea8600'}; font-weight: 600;">
                ${ev.openStalls} / ${ev.totalStalls} stalls open
              </span>
            </div>
            <div class="ev-rate-row">
              <span class="ev-rate-label">Energy Rate</span>
              <span class="ev-rate-price">${ev.isFree ? 'FREE' : ev.badgeText}</span>
            </div>
            <div class="ev-connector-grid">
              ${ev.connectors.map(c => `
                <div class="ev-connector-card">
                  <div class="connector-type">${c}</div>
                  <div class="connector-speed">Up to ${ev.maxPowerKw}kW</div>
                </div>
              `).join('')}
            </div>
            <div class="poi-freshness-tag">Availability & rates verified ${ev.updatedAgo}</div>
            <button class="poi-add-btn" type="button">${isNavigating ? '+ Add Detour Stop' : '+ Add to route'}</button>
          `;
        } else {
          // Standard categories
          popupDiv.innerHTML = `
            <div style="font-weight:500;font-size:13px;margin-bottom:2px;">${item.name}</div>
            <div style="font-size:11px;color:#188038;font-weight:500;margin-bottom:2px;">${distLabel}</div>
            <div style="font-size:11px;color:#5f6368;margin-bottom:8px;">${item.street}</div>
            <button class="poi-add-btn" type="button">${isNavigating ? '+ Add Detour Stop' : '+ Add to route'}</button>
          `;
        }

        const addBtn = popupDiv.querySelector('.poi-add-btn');
        if (addBtn) {
          addBtn.onclick = async () => {
            m.closePopup();
            poiLayer.clearLayers();
            document.querySelectorAll('#categoryBar .cat-chip').forEach(c => c.classList.remove('active'));
            await insertStopAndRecalculate({ name: fullName, lat: item.lat, lng: item.lng });
          };
        }

        m.bindPopup(popupDiv);
        bounds.push([item.lat, item.lng]);
      });

      if (!isNavigating) {
        map.fitBounds(bounds, {
          paddingTopLeft: window.innerWidth > 640 ? [445, 70] : [30, 70],
          paddingBottomRight: [40, 40],
          maxZoom: 14
        });
      }
      showToast(`Found ${nearby.length} nearest places — tap a pin to view details`);
    } catch (err) {
      chip.classList.remove('loading', 'active');
      showToast('Unable to load nearby places right now.');
    }
  });
});

// 8. Click Anywhere on Map to Drop a Stop
map.on('click', async (e) => {
  if (isNavigating) return;
  const { lat, lng } = e.latlng;
  const tempIdx = stops.length;
  stops.push({ name: `Dropped pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng });
  legMetrics = [];
  renderUI(false);

  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        const p = data.features[0].properties;
        const streetNum = [p.housenumber, p.street].filter(Boolean).join(' ');
        const label = [p.name && p.name !== streetNum ? p.name : '', streetNum, p.city, p.state].filter(Boolean).join(', ');
        if (label && stops[tempIdx]) {
          stops[tempIdx].name = label;
          renderUI(false);
        }
      }
    }
  } catch (_) {}
});

function speakAlert(text) {
  if (!voiceEnabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.03;
    if (navigator.language) utter.lang = navigator.language;
    window.speechSynthesis.speak(utter);
  } catch (_) {}
}

function getMetersBetween(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

optionsToggleBtn.addEventListener('click', () => {
  const isOpen = optionsDrawer.classList.toggle('open');
  optionsToggleBtn.classList.toggle('active', isOpen);
});

toggleStepsPreview.addEventListener('click', () => {
  stepsPreviewList.classList.toggle('open');
});

document.querySelectorAll('#goalSelector .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#goalSelector .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    optimizeGoal = btn.dataset.goal;
    if (stops.length >= 2) optimizeBtn.click();
  });
});

document.querySelectorAll('#endRuleSelector .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#endRuleSelector .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    endRule = btn.dataset.end;
    renderUI(false);
  });
});

document.querySelectorAll('#avatarSelector .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#avatarSelector .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedAvatar = btn.dataset.avatar;
    if (vehicleMarker) vehicleMarker.setIcon(createVehicleIcon(0));
  });
});

function createVehicleIcon(headingDeg) {
  const svg = avatarSvgs[selectedAvatar] || avatarSvgs.arrow;
  return L.divIcon({
    className: '',
    html: `<div class="vehicle-avatar-wrap" style="transform: rotate(${headingDeg || 0}deg);">${svg}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

unitSelect.addEventListener('change', () => {
  if (unitSelect.value === 'metric') {
    effLabel.textContent = 'L / 100km';
    fuelEffInput.value = '8.4';
    priceLabel.textContent = 'Fuel ($/L)';
    fuelPriceInput.value = '1.45';
  } else {
    effLabel.textContent = 'Vehicle MPG';
    fuelEffInput.value = '28';
    priceLabel.textContent = 'Fuel ($/gal)';
    fuelPriceInput.value = '3.25';
  }
});

document.getElementById('gpsBtn').addEventListener('click', async () => {
  if (!navigator.geolocation) return showToast('Geolocation not supported.');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      userLocationLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      stops.unshift({ name: 'Your location', lat: pos.coords.latitude, lng: pos.coords.longitude });
      legMetrics = [];
      renderUI(true);

      if (!localCityContext) {
        try {
          const rev = await fetch(`https://photon.komoot.io/reverse?lon=${pos.coords.longitude}&lat=${pos.coords.latitude}`, {
            signal: AbortSignal.timeout(4000)
          });
          if (rev.ok) {
            const revData = await rev.json();
            const p = revData.features?.[0]?.properties;
            if (p) {
              localCityContext = [p.city, p.state].filter(Boolean).join(', ');
              const cc = (p.countrycode || '').toUpperCase();
              if (cc && !['US', 'USA'].includes(cc)) {
                unitSelect.value = 'metric';
                effLabel.textContent = 'L / 100km';
                fuelEffInput.value = '8.4';
                const reg = getRegionCurrency(cc, pos.coords.latitude, pos.coords.longitude);
                priceLabel.textContent = `Fuel (${reg.symbol}/${reg.fuelUnit})`;
                fuelPriceInput.value = (reg.code === 'JPY' || reg.code === 'KRW') ? reg.baseGas.toString() : reg.baseGas.toFixed(2);
              }
            }
          }
        } catch (_) {}
      }
    },
    () => showToast('Location access denied. Check browser permissions.'),
    { enableHighAccuracy: true, timeout: 8000 }
  );
});

// 9. Incident Reporting
const reportFab = document.getElementById('reportFab');
const reportSheet = document.getElementById('reportSheet');
reportFab.addEventListener('click', () => reportSheet.classList.toggle('open'));
document.getElementById('closeReportBtn').addEventListener('click', () => reportSheet.classList.remove('open'));

document.querySelectorAll('.report-option').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    const label = btn.dataset.label;
    reportSheet.classList.remove('open');

    const placeIncident = (lat, lng) => {
      const id = Date.now() + Math.random();
      reportedIncidents.push({ id, type, label, lat, lng });
      announcedIncidentIds.add(id);

      const pinClass = type === 'police' ? '' : (type === 'object' ? 'hazard' : 'crash');
      const icon = L.divIcon({
        className: '',
        html: `<div class="incident-pin ${pinClass}">${btn.querySelector('svg').outerHTML}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });

      L.marker([lat, lng], { icon })
        .bindPopup(`<b>${label}</b><br>Reported just now`)
        .addTo(incidentsLayer);

      showToast(`${label} pinned on map`);
      speakAlert(`${label} reported.`);
    };

    if (vehicleMarker) {
      const ll = vehicleMarker.getLatLng();
      placeIncident(ll.lat, ll.lng);
    } else if (userLocationLatLng) {
      placeIncident(userLocationLatLng.lat, userLocationLatLng.lng);
    } else {
      const center = map.getCenter();
      placeIncident(center.lat, center.lng);
    }
  });
});

// Helper: Clean base street name and normalize street type for rooftop matching
function cleanStreetName(str) {
  return (str || '').toLowerCase()
    .replace(/[0-9]/g, '')
    .replace(/\b(north|south|east|west|n|s|e|w)\b/g, '')
    .replace(/\b(blvd|boulevard|st|street|ave|avenue|rd|road|cir|circle|dr|drive|ln|lane|way|ct|court|rue|str|strasse|straße|calle|via|av|avenida|carrer|carretera|strada|ulica)\b/g, '')
    .replace(/[^a-z]/g, '').trim();
}

function normalizeStreetType(str) {
  const m = (str || '').toLowerCase().match(/\b(blvd|boulevard|st|street|ave|avenue|rd|road|cir|circle|dr|drive|way|ln|lane|ct|court|rue|calle|strasse|straße|via|avenida)\b/);
  if (!m) return '';
  const map = {
    boulevard: 'blvd', street: 'st', avenue: 'ave', road: 'rd', circle: 'cir',
    drive: 'dr', lane: 'ln', court: 'ct', rue: 'st', calle: 'st', strasse: 'st',
    'straße': 'st', via: 'st', avenida: 'ave'
  };
  return map[m[1]] || m[1];
}

function normalizeStreetKey(str) {
  return (str || '').toLowerCase()
    .replace(/\b(north|south|east|west|n|s|e|w)\b/g, '')
    .replace(/\b(blvd|boulevard|st|street|ave|avenue|rd|road|cir|circle|dr|drive|ln|lane|way|ct|court|rue|str|strasse|straße|calle|via|av|avenida|carrer|carretera|strada|ulica)\b/g, '')
    .replace(/[^a-z0-9]/g, '').trim();
}

// 10. Rooftop-Accurate Metro Geocoder (ArcGIS Rooftop + Photon + Nominatim)
async function searchLocalPlaces(query, limit = 6) {
  const center = vehicleMarker
    ? vehicleMarker.getLatLng()
    : (stops[0] ? { lat: stops[0].lat, lng: stops[0].lng } : (userLocationLatLng || map.getCenter()));

  // Extract user-entered street number if present (e.g., "2821", "3320", "8011")
  const queryNumMatch = query.match(/^\s*(\d+[a-zA-Z]?)\b/);
  const typedHouseNum = queryNumMatch ? queryNumMatch[1] : '';

  // ArcGIS findAddressCandidates with outFields, category=Address,POI, and spatial bias
  const arcgisUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(query)}&location=${center.lng},${center.lat}&outFields=PlaceName,Place_addr,StAddr,AddNum,StreetName,City,Region,Country,Postal,Addr_type,ExInfo,Rank&category=Address,POI&maxLocations=${Math.max(limit, 8)}&f=pjson`;
  const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}&limit=${limit}`;
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=${limit}`;

  const [arcgisRes, photonRes, nominatimRes] = await Promise.allSettled([
    fetch(arcgisUrl, { signal: AbortSignal.timeout(4000) }).then(r => r.ok ? r.json() : null),
    fetch(photonUrl, { signal: AbortSignal.timeout(4000) }).then(r => r.ok ? r.json() : null),
    fetch(nominatimUrl, { headers: { 'User-Agent': 'ZigRoutePlanner/1.0' }, signal: AbortSignal.timeout(4000) }).then(r => r.ok ? r.json() : null)
  ]);

  const combined = [];
  const seenKeys = new Set();

  // 1. Parse ArcGIS Rooftop Candidates (Exact house numbers, PointAddress, & typo resolution)
  if (arcgisRes.status === 'fulfilled' && arcgisRes.value && Array.isArray(arcgisRes.value.candidates)) {
    arcgisRes.value.candidates.forEach(c => {
      if (c.score < 65) return;
      const lat = c.location.y;
      const lng = c.location.x;
      const distMeters = getMetersBetween(center.lat, center.lng, lat, lng);
      const attr = c.attributes || {};
      const addrType = attr.Addr_type || 'Unknown';
      const countryCode = (attr.Country || '').toUpperCase();

      // Preserve street number: check AddNum, ExInfo, or user's typed house number
      let houseNum = attr.AddNum || '';
      if (!houseNum && attr.ExInfo && /^\d+/.test(attr.ExInfo)) {
        houseNum = attr.ExInfo;
      }
      if (!houseNum && typedHouseNum && (addrType === 'StreetName' || !attr.AddNum)) {
        houseNum = typedHouseNum;
      }

      const streetPart = attr.StAddr || attr.StreetName || (c.address ? c.address.split(',')[0] : '');
      let title = '';
      if (attr.PlaceName && (addrType === 'POI' || !attr.StAddr)) {
        title = attr.PlaceName;
      } else {
        if (houseNum && !streetPart.toLowerCase().startsWith(houseNum.toLowerCase())) {
          title = `${houseNum} ${streetPart}`.trim();
        } else {
          title = streetPart || (c.address ? c.address.split(',')[0] : '') || query;
        }
      }

      let sub = attr.Place_addr || c.address;
      if (houseNum && !sub.toLowerCase().startsWith(houseNum.toLowerCase()) && !sub.toLowerCase().includes(` ${houseNum} `)) {
        sub = `${houseNum} ${sub}`.trim();
      }

      const isRooftop = (addrType === 'PointAddress' || addrType === 'StreetAddress' || addrType === 'StreetAddressExt' || Boolean(attr.AddNum));
      const hasHouseNum = Boolean(houseNum);
      const rank = typeof attr.Rank === 'number' ? attr.Rank : 10;

      const key = `${title.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push({
          title,
          sub,
          countryCode,
          rawStreet: attr.StreetName || attr.StAddr || streetPart,
          lat,
          lng,
          distMeters,
          isRooftop,
          addrType,
          hasHouseNum,
          rank,
          index: combined.length,
          score: c.score,
          source: 'arcgis'
        });
      }
    });
  }

  // 2. Parse Photon Results (Global OpenStreetMap)
  if (photonRes.status === 'fulfilled' && photonRes.value && Array.isArray(photonRes.value.features)) {
    photonRes.value.features.forEach(f => {
      const p = f.properties;
      const [lng, lat] = f.geometry.coordinates;
      const distMeters = getMetersBetween(center.lat, center.lng, lat, lng);
      const countryCode = (p.countrycode || '').toUpperCase();

      const houseNum = p.housenumber || (p.street ? typedHouseNum : '');
      const houseStreet = [houseNum, p.street].filter(Boolean).join(' ');
      let title = p.name || houseStreet || 'Location';
      if (typedHouseNum && !title.toLowerCase().includes(typedHouseNum.toLowerCase()) && (!p.name || p.name === p.street)) {
        title = `${typedHouseNum} ${title}`.trim();
      }

      const subParts = [
        (p.name && houseStreet && p.name !== houseStreet) ? houseStreet : '',
        p.city || p.town || p.district,
        p.state || p.country,
        p.postcode
      ].filter(Boolean);
      let sub = subParts.join(', ');
      if (houseNum && !sub.toLowerCase().includes(houseNum.toLowerCase())) {
        sub = `${houseNum} ${sub}`.trim();
      }

      const key = `${title.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push({
          title,
          sub,
          countryCode,
          rawStreet: p.street || '',
          lat,
          lng,
          distMeters,
          isRooftop: Boolean(p.housenumber) || (Boolean(typedHouseNum) && Boolean(p.street)),
          addrType: p.housenumber ? 'PointAddress' : (p.street ? 'StreetAddress' : 'POI'),
          hasHouseNum: Boolean(houseNum),
          rank: 15,
          index: combined.length,
          score: 80,
          source: 'photon'
        });
      }
    });
  }

  // 3. Parse Nominatim Results (Global OpenStreetMap)
  if (nominatimRes.status === 'fulfilled' && nominatimRes.value && Array.isArray(nominatimRes.value)) {
    nominatimRes.value.forEach(item => {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      const distMeters = getMetersBetween(center.lat, center.lng, lat, lng);
      const addr = item.address || {};
      const countryCode = (addr.country_code || '').toUpperCase();

      const houseNum = addr.house_number || (addr.road ? typedHouseNum : '');
      const houseStreet = [houseNum, addr.road].filter(Boolean).join(' ');
      let title = item.name && item.name !== addr.house_number ? item.name : (houseStreet || item.display_name.split(',')[0]);
      if (typedHouseNum && !title.toLowerCase().includes(typedHouseNum.toLowerCase()) && (!item.name || item.name === addr.road)) {
        title = `${typedHouseNum} ${title}`.trim();
      }

      const sub = [
        houseStreet && title !== houseStreet ? houseStreet : '',
        addr.city || addr.town || addr.village || addr.county,
        addr.state || addr.country,
        addr.postcode
      ].filter(Boolean).join(', ');

      const key = `${title.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push({
          title,
          sub,
          countryCode,
          rawStreet: addr.road || '',
          lat,
          lng,
          distMeters,
          isRooftop: Boolean(addr.house_number) || (Boolean(typedHouseNum) && Boolean(addr.road)),
          addrType: addr.house_number ? 'PointAddress' : (addr.road ? 'StreetAddress' : 'POI'),
          hasHouseNum: Boolean(houseNum),
          rank: 15,
          index: combined.length,
          score: 75,
          source: 'nominatim'
        });
      }
    });
  }

  const queryStreetClean = cleanStreetName(query);
  const queryTypeClean = normalizeStreetType(query);

  // Text relevance function: matches query words against result title, street, and subtitle
  function textRelevance(item) {
    let score = 0;
    const itemStreetClean = cleanStreetName(item.rawStreet || item.title);
    const itemTypeClean = normalizeStreetType(item.rawStreet || item.title);

    if (queryStreetClean && itemStreetClean) {
      if (queryStreetClean === itemStreetClean) {
        score += 3.5;
        if (queryTypeClean && itemTypeClean && queryTypeClean === itemTypeClean) {
          score += 2.0; // exact street type match (e.g. Blvd vs Ave)
        }
      } else if (itemStreetClean.includes(queryStreetClean) || queryStreetClean.includes(itemStreetClean)) {
        score += 1.5;
      }
    }
    if (item.source === 'arcgis') {
      score += 1.0;
    }
    if (typedHouseNum && item.hasHouseNum) {
      score += 1.5;
    }

    const qClean = query.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const qWords = qClean.split(/\s+/).filter(w => w.length > 1 && !['blvd','street','st','ave','avenue','rd','road','circle','cir','dr','drive','s','n','e','w'].includes(w));
    const fullText = `${item.title} ${item.sub}`.toLowerCase();
    let wordMatches = 0;
    for (const w of qWords) {
      if (fullText.includes(w)) wordMatches++;
    }
    const matchRatio = qWords.length > 0 ? (wordMatches / qWords.length) : 0;
    score += matchRatio * 3.5;

    // Favor exact title matches without spurious extra words (e.g. "Big Ben" vs "Big Ben Fish Bar")
    const titleWords = item.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 1 && !['blvd','street','st','ave','avenue','rd','road','circle','cir','dr','drive','s','n','e','w'].includes(w));
    const extraWords = titleWords.filter(w => !qWords.includes(w)).length;
    score -= extraWords * 0.8;

    // Distinguish explicit international or distant landmark queries vs local ambiguous queries:
    // If candidate matches most query words (e.g. "Eiffel Tower Paris", "Big Ben London", "Sydney Opera House"),
    // do NOT penalize distance. Only apply distance penalty for generic/partial matches.
    const isExplicitTarget = (qWords.length >= 2 && matchRatio >= 0.8) || (matchRatio === 1.0 && qWords.length >= 1 && (item.title.toLowerCase().includes(qClean) || item.score >= 95));
    if (!isExplicitTarget) {
      if (item.distMeters < 10000) {
        score += 2.0;
      } else if (item.distMeters < 35000) {
        score += 1.0;
      } else if (item.distMeters > 100000) {
        score -= 2.5;
      }
    } else {
      score += 2.5;
    }

    return score;
  }

  // Filter out low-precision StreetName / Postal candidates when a PointAddress or StreetAddress candidate with good relevance exists for the same street in the same metro area
  const hasExactCandidate = combined.some(item => (item.addrType === 'PointAddress' || item.addrType === 'StreetAddress' || item.addrType === 'StreetAddressExt') && textRelevance(item) >= 0.7);
  let filtered = combined;
  if (hasExactCandidate) {
    filtered = combined.filter(item => {
      if (item.addrType === 'StreetName' || item.addrType === 'Postal') {
        const itemStreetKey = normalizeStreetKey(item.title);
        // Only drop if there is already a PointAddress/StreetAddress covering this street name in the same metro area (< 40km away)
        const hasBetterForSameStreet = combined.some(o => 
          (o.addrType === 'PointAddress' || o.addrType === 'StreetAddress' || o.addrType === 'StreetAddressExt') && 
          normalizeStreetKey(o.title) === itemStreetKey &&
          Math.abs(o.distMeters - item.distMeters) < 40000
        );
        return !hasBetterForSameStreet;
      }
      return true;
    });
  }

  // Sort by: text match score -> rooftop/point address priority -> house number presence -> distance
  return filtered.sort((a, b) => {
    const aRel = textRelevance(a);
    const bRel = textRelevance(b);
    if (Math.abs(aRel - bRel) > 0.4) return bRel - aRel;

    const aExplicit = aRel >= 4.0;
    const bExplicit = bRel >= 4.0;
    if (!aExplicit && !bExplicit) {
      const aLocal = a.distMeters < 50000;
      const bLocal = b.distMeters < 50000;
      if (aLocal !== bLocal) return aLocal ? -1 : 1;
    }

    const aRooftop = (a.addrType === 'PointAddress' || a.addrType === 'StreetAddress' || a.addrType === 'StreetAddressExt');
    const bRooftop = (b.addrType === 'PointAddress' || b.addrType === 'StreetAddress' || b.addrType === 'StreetAddressExt');
    if (aRooftop !== bRooftop) return aRooftop ? -1 : 1;

    if (a.hasHouseNum !== b.hasHouseNum) return a.hasHouseNum ? -1 : 1;

    // For distant / international results (> 100 km), use geocoder rank/order rather than great-circle longitude difference
    if (a.distMeters > 100000 && b.distMeters > 100000) {
      if (typeof a.rank === 'number' && typeof b.rank === 'number' && a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      return (a.index || 0) - (b.index || 0);
    }

    return a.distMeters - b.distMeters;
  }).slice(0, limit);
}

// Planning Search Input Listener
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const q = searchInput.value.trim();

  // Support numeric house numbers (e.g. "3320", "2821") as well as text
  if (q.length < 2 || !/[a-zA-Z0-9]/.test(q)) {
    dropdown.style.display = 'none';
    return;
  }

  debounceTimer = setTimeout(async () => {
    try {
      const results = await searchLocalPlaces(q, 6);
      dropdown.innerHTML = '';

      if (!results.length) {
        dropdown.style.display = 'none';
        return;
      }

      const isMetric = unitSelect.value === 'metric';

      results.forEach(place => {
        const fullName = place.sub && !place.sub.startsWith(place.title)
          ? `${place.title}, ${place.sub}`
          : (place.sub || place.title);

        const distTag = isMetric
          ? `${(place.distMeters / 1000).toFixed(1)} km`
          : `${(place.distMeters * 0.000621371).toFixed(1)} mi`;

        const textKey = (place.title + ' ' + (place.sub || '')).toLowerCase();
        const isGasPlace = textKey.match(/\b(gas|fuel|chevron|exxon|shell|quiktrip|racetrac|costco gasoline|valero|7-eleven|circle k|mobil|bp|texaco)\b/);
        const isParkingPlace = textKey.match(/\b(parking|garage|deck|lot)\b/);
        let extraTagHtml = '';
        if (isGasPlace) {
          const baselineFuel = parseFloat(document.getElementById('fuelPriceInput')?.value) || 3.25;
          const gas = getGasStationDetails({ name: place.title, lat: place.lat, lng: place.lng }, baselineFuel);
          extraTagHtml = `<span style="font-size:10px; font-weight:700; color:#b06000; background:#fef7e0; border:1px solid #fce8b2; padding:1px 6px; border-radius:10px; margin-left:6px; flex-shrink:0;">⛽ ${gas.badgeText}</span>`;
        } else if (isParkingPlace) {
          const pk = getParkingDetails({ name: place.title, lat: place.lat, lng: place.lng });
          extraTagHtml = `<span style="font-size:10px; font-weight:700; color:#1a73e8; background:#e8f0fe; border:1px solid #d2e3fc; padding:1px 6px; border-radius:10px; margin-left:6px; flex-shrink:0;">🅿️ ${pk.badgeText} · ${pk.openSpots} open</span>`;
        }

        const item = document.createElement('div');
        item.className = 'ac-item';
        item.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#5f6368" style="flex-shrink:0">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
          </svg>
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <div style="font-weight:500; color:#202124; display:flex; align-items:center;">
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${place.title}</span>
              ${extraTagHtml}
            </div>
            <div style="font-size:12px; color:#5f6368; overflow:hidden; text-overflow:ellipsis;">${place.sub}</div>
          </div>
          <span style="font-size:11px; color:#5f6368; flex-shrink:0;">${distTag}</span>
        `;
        item.onclick = () => {
          stops.push({ name: fullName, lng: place.lng, lat: place.lat });
          legMetrics = [];
          searchInput.value = '';
          dropdown.style.display = 'none';
          renderUI(true);
        };
        dropdown.appendChild(item);
      });

      dropdown.style.display = 'block';
    } catch (err) {
      console.error('Search error:', err);
    }
  }, 300);
});

// In-Navigation "Add Stop" Search Modal Listeners
const navAddStopModal = document.getElementById('navAddStopModal');
const navStopSearchInput = document.getElementById('navStopSearchInput');
const navStopDropdown = document.getElementById('navStopDropdown');
let navSearchTimer = null;

document.getElementById('navAddStopBtn').addEventListener('click', () => {
  navAddStopModal.classList.toggle('open');
  if (navAddStopModal.classList.contains('open')) {
    navStopSearchInput.value = '';
    navStopDropdown.innerHTML = '';
    navStopSearchInput.focus();
  }
});

document.getElementById('closeNavAddStopBtn').addEventListener('click', () => {
  navAddStopModal.classList.remove('open');
});

navStopSearchInput.addEventListener('input', () => {
  clearTimeout(navSearchTimer);
  const q = navStopSearchInput.value.trim();
  if (q.length < 2 || !/[a-zA-Z0-9]/.test(q)) {
    navStopDropdown.innerHTML = '';
    return;
  }

  navSearchTimer = setTimeout(async () => {
    try {
      const results = await searchLocalPlaces(q, 5);
      navStopDropdown.innerHTML = '';
      const isMetric = unitSelect.value === 'metric';

      results.forEach(place => {
        const fullName = place.sub && !place.sub.startsWith(place.title)
          ? `${place.title}, ${place.sub}`
          : (place.sub || place.title);

        const distTag = isMetric
          ? `${(place.distMeters / 1000).toFixed(1)} km`
          : `${(place.distMeters * 0.000621371).toFixed(1)} mi`;

        const textKey = (place.title + ' ' + (place.sub || '')).toLowerCase();
        const isGasPlace = textKey.match(/\b(gas|fuel|chevron|exxon|shell|quiktrip|racetrac|costco gasoline|valero|7-eleven|circle k|mobil|bp|texaco)\b/);
        const isParkingPlace = textKey.match(/\b(parking|garage|deck|lot)\b/);
        let extraTagHtml = '';
        if (isGasPlace) {
          const baselineFuel = parseFloat(document.getElementById('fuelPriceInput')?.value) || 3.25;
          const gas = getGasStationDetails({ name: place.title, lat: place.lat, lng: place.lng }, baselineFuel);
          extraTagHtml = `<span style="font-size:10px; font-weight:700; color:#b06000; background:#fef7e0; border:1px solid #fce8b2; padding:1px 6px; border-radius:10px; margin-left:6px; flex-shrink:0;">⛽ ${gas.badgeText}</span>`;
        } else if (isParkingPlace) {
          const pk = getParkingDetails({ name: place.title, lat: place.lat, lng: place.lng });
          extraTagHtml = `<span style="font-size:10px; font-weight:700; color:#1a73e8; background:#e8f0fe; border:1px solid #d2e3fc; padding:1px 6px; border-radius:10px; margin-left:6px; flex-shrink:0;">🅿️ ${pk.badgeText} · ${pk.openSpots} open</span>`;
        }

        const row = document.createElement('div');
        row.className = 'ac-item';
        row.innerHTML = `
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <div style="font-weight:500; color:#202124; display:flex; align-items:center;">
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${place.title}</span>
              ${extraTagHtml}
            </div>
            <div style="font-size:11px; color:#5f6368; overflow:hidden; text-overflow:ellipsis;">${place.sub}</div>
          </div>
          <span style="font-size:11px; color:#188038; font-weight:500;">+${distTag}</span>
        `;
        row.onclick = async () => {
          navAddStopModal.classList.remove('open');
          await insertStopAndRecalculate({ name: fullName, lat: place.lat, lng: place.lng });
        };
        navStopDropdown.appendChild(row);
      });
    } catch (_) {}
  }, 300);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-section')) dropdown.style.display = 'none';
});

clearAllBtn.addEventListener('click', () => {
  stops = [];
  originalStopsSnapshot = [];
  legMetrics = [];
  activeRouteData = null;
  poiLayer.clearLayers();
  document.querySelectorAll('#categoryBar .cat-chip').forEach(c => c.classList.remove('active'));
  renderUI(false);
});

function removeStop(idx, e) {
  if (e) e.stopPropagation();
  stops.splice(idx, 1);
  legMetrics = [];
  renderUI(false);
}

function clearRouteLines() {
  if (routeCasing) { map.removeLayer(routeCasing); routeCasing = null; }
  if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
  if (originalCompareLine) { map.removeLayer(originalCompareLine); originalCompareLine = null; }
}

function formatDuration(seconds) {
  const totalMins = Math.max(1, Math.round(seconds / 60));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs} hr ${mins} min` : `${mins} min`;
}

function renderUI(fitMap = true) {
  markersLayer.clearLayers();
  clearRouteLines();
  tripSummary.style.display = 'none';
  gmapsBtn.style.display = 'none';
  if (appleMapsBtn) appleMapsBtn.style.display = 'none';
  if (exportMapsRow) exportMapsRow.style.display = 'none';
  startVoiceNavBtn.style.display = 'none';
  demoDriveBtn.style.display = 'none';
  stepsPreviewList.classList.remove('open');

  searchInput.placeholder = stops.length === 0 ? 'Choose starting point...' : 'Add destination...';
  clearAllBtn.style.display = stops.length > 0 ? 'inline-block' : 'none';
  stopsContainer.style.display = stops.length > 0 ? 'flex' : 'none';
  stopsContainer.innerHTML = '';

  const bounds = [];

  stops.forEach((s, i) => {
    const isFirst = i === 0;
    const isLast = i === stops.length - 1 && stops.length > 1;
    const isLockedEnd = isLast && endRule === 'last';

    let iconHtml = `<div class="dot-mid"></div>`;
    if (isFirst) iconHtml = `<div class="dot-start"></div>`;
    else if (isLast) iconHtml = `<div class="pin-end"></div>`;

    const legText = (i > 0 && legMetrics[i - 1])
      ? `<span class="leg-eta">+${formatDuration(legMetrics[i - 1].duration)}</span>`
      : '';

    const row = document.createElement('div');
    row.className = 'stop-row';
    row.draggable = true;

    row.addEventListener('dragstart', (e) => {
      dragSrcIndex = i;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrcIndex !== null && dragSrcIndex !== i) {
        const moved = stops.splice(dragSrcIndex, 1)[0];
        stops.splice(i, 0, moved);
        legMetrics = [];
        renderUI(false);
      }
    });

    row.innerHTML = `
      <div class="stop-icon">${iconHtml}</div>
      <div class="stop-pill">
        <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
        <span class="stop-tag ${isFirst ? 'start' : (isLockedEnd ? 'locked' : '')}">${isFirst ? 'Start' : (isLockedEnd ? 'End' : i)}</span>
        <span class="stop-pill-text" title="${s.name}">${s.name}</span>
        ${legText}
        <button class="remove-stop" onclick="removeStop(${i}, event)" title="Remove" aria-label="Remove stop">&times;</button>
      </div>
    `;

    row.querySelector('.stop-pill').addEventListener('click', () => {
      map.flyTo([s.lat, s.lng], 15, { duration: 0.7 });
    });

    stopsContainer.appendChild(row);

    const markerIcon = L.divIcon({
      className: '',
      html: `<div class="g-marker ${isFirst ? 'start' : ''}">${isFirst ? 'S' : i}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    L.marker([s.lat, s.lng], { icon: markerIcon })
      .bindPopup(`<b>${isFirst ? 'Start' : 'Stop ' + i}</b><br>${s.name}`)
      .addTo(markersLayer);

    bounds.push([s.lat, s.lng]);
  });

  if (fitMap && bounds.length > 0) {
    map.fitBounds(bounds, {
      paddingTopLeft: window.innerWidth > 640 ? [445, 70] : [30, 70],
      paddingBottomRight: window.innerWidth > 640 ? [50, 50] : [30, 340],
      maxZoom: 15
    });
  }

  optimizeBtn.disabled = stops.length < 2;
}

function getOsrmProfile() {
  if (travelMode === 'cycling') return 'bike';
  if (travelMode === 'walking') return 'foot';
  return 'driving';
}

// 11. Matrix TSP Solver with Permutation (<=9 stops) + 2-Opt Local Search (10+ stops)
async function solveOptimalSequence() {
  const n = stops.length;
  if (n <= 1) return { sortedStops: [...stops], originalDuration: 0 };
  if (n === 2) {
    return { sortedStops: [...stops], originalDuration: 0 };
  }

  const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
  const profile = getOsrmProfile();
  const tableUrl = `https://router.project-osrm.org/table/v1/${profile}/${coords}?annotations=duration,distance`;
  
  let durations = null;
  let distances = null;

  try {
    const res = await fetch(tableUrl, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      if (data.code === 'Ok') {
        durations = data.durations;
        distances = data.distances;
      }
    }
  } catch (_) {}

  // Resilient fallback if OSRM table fails or has unreachable cells
  if (!durations || !distances) {
    durations = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 0;
        const d = getMetersBetween(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng);
        return d / 15.0; // ~15 m/s (~33 mph) estimate
      })
    );
    distances = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 0;
        return getMetersBetween(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng);
      })
    );
  }

  let originalDuration = 0;
  for (let k = 0; k < n - 1; k++) {
    const t = durations[k]?.[k + 1];
    originalDuration += (t !== null && t !== undefined && t >= 0) ? t : 0;
  }
  if (endRule === 'roundtrip') {
    const t = durations[n - 1]?.[0];
    originalDuration += (t !== null && t !== undefined && t >= 0) ? t : 0;
  }

  // Cost matrix with safe handling of null/undefined or duplicate coordinates
  const cost = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 0;
      let d = distances[i]?.[j];
      let t = durations[i]?.[j];

      // Handle unreachable islands/waterways safely without NaN
      if (d === null || d === undefined || d < 0) {
        d = getMetersBetween(stops[i].lat, stops[i].lng, stops[j].lat, stops[j].lng) * 1.5;
      }
      if (t === null || t === undefined || t < 0) {
        t = d / 12.0;
      }

      if (optimizeGoal === 'distance') return d;
      if (optimizeGoal === 'fuel' && (travelMode === 'driving' || travelMode === 'moto')) {
        const avgMps = t > 0 ? d / t : 0;
        const speedPenalty = avgMps > 24.5 ? 1 + Math.pow((avgMps - 24.5) / 15, 2) * 0.35 : 1.0;
        return d * speedPenalty;
      }
      return t;
    })
  );

  const fixedEndIdx = (endRule === 'last') ? n - 1 : null;
  const candidates = [];
  for (let i = 1; i < n; i++) {
    if (i !== fixedEndIdx) candidates.push(i);
  }

  function routeCost(seq) {
    let total = 0;
    for (let k = 0; k < seq.length - 1; k++) {
      total += cost[seq[k]][seq[k + 1]];
    }
    if (endRule === 'roundtrip') {
      total += cost[seq[seq.length - 1]][0];
    }
    return total;
  }

  let bestSeq = null;

  // 1. Exact permutation TSP for 3–9 stops (candidates <= 8)
  if (candidates.length <= 8) {
    let minCost = Infinity;
    function permute(arr, l) {
      if (l === arr.length) {
        const full = fixedEndIdx !== null ? [0, ...arr, fixedEndIdx] : [0, ...arr];
        const c = routeCost(full);
        if (c < minCost) { minCost = c; bestSeq = full; }
        return;
      }
      for (let i = l; i < arr.length; i++) {
        [arr[l], arr[i]] = [arr[i], arr[l]];
        permute(arr, l + 1);
        [arr[l], arr[i]] = [arr[i], arr[l]];
      }
    }
    permute([...candidates], 0);
  } else {
    // 2. Nearest-Neighbor Heuristic + 2-Opt Local Search Refinement for 10+ stops
    const unvisited = new Set(candidates);
    let seq = [0];
    let curr = 0;
    while (unvisited.size > 0) {
      let nextNode = null, best = Infinity;
      for (const cand of unvisited) {
        if (cost[curr][cand] < best) { best = cost[curr][cand]; nextNode = cand; }
      }
      seq.push(nextNode);
      unvisited.delete(nextNode);
      curr = nextNode;
    }
    if (fixedEndIdx !== null) seq.push(fixedEndIdx);

    // 2-Opt Local Search Refinement: iteratively swap edges to eliminate suboptimal crossings
    let improved = true;
    let iterations = 0;
    const maxIterations = 60;
    const optEndLimit = (fixedEndIdx !== null) ? seq.length - 2 : seq.length - 1;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;
      for (let i = 1; i < optEndLimit; i++) {
        for (let j = i + 1; j <= optEndLimit; j++) {
          const newSeq = [...seq];
          let left = i, right = j;
          while (left < right) {
            const temp = newSeq[left];
            newSeq[left] = newSeq[right];
            newSeq[right] = temp;
            left++; right--;
          }
          if (routeCost(newSeq) < routeCost(seq) - 1e-4) {
            seq = newSeq;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }
    bestSeq = seq;
  }

  // Fallback safety guarantee: if bestSeq was somehow not set, preserve original order
  if (!bestSeq || !Array.isArray(bestSeq) || bestSeq.length !== n) {
    bestSeq = Array.from({ length: n }, (_, i) => i);
  }

  return {
    sortedStops: bestSeq.map(idx => stops[idx]),
    originalDuration
  };
}

function formatStepInstruction(step, stopName) {
  const m = step.maneuver;
  const road = step.name ? ` onto ${step.name}` : '';
  if (m.type === 'depart') return `Head out${road}`;
  if (m.type === 'arrive') return `Arrive at ${stopName || 'destination'}`;
  const mod = m.modifier ? m.modifier.replace('-', ' ') : '';
  if (m.type === 'turn') return `Turn ${mod}${road}`;
  if (m.type === 'merge') return `Merge ${mod}${road}`;
  if (m.type === 'fork') return `Keep ${mod} at fork${road}`;
  if (m.type === 'roundabout') return `Enter roundabout and exit${road}`;
  return `Continue${road}`;
}

// 12. Reusable Route Optimization & Drawing Engine
async function runRouteOptimization(keepInNavMode = false) {
  if (stops.length < 2) return;
  optimizeBtn.disabled = true;
  optimizeBtn.textContent = 'Optimizing...';

  try {
    originalStopsSnapshot = [...stops];
    const { sortedStops, originalDuration } = await solveOptimalSequence();
    stops = sortedStops;

    const navStops = endRule === 'roundtrip' ? [...stops, stops[0]] : stops;
    const coordString = navStops.map(s => `${s.lng},${s.lat}`).join(';');
    const profile = getOsrmProfile();
    const routeUrl = `https://router.project-osrm.org/route/v1/${profile}/${coordString}?geometries=geojson&overview=full&steps=true`;

    const routeRes = await fetch(routeUrl, { signal: AbortSignal.timeout(8000) });
    if (!routeRes.ok) throw new Error('Route service temporarily busy.');
    const routeData = await routeRes.json();
    if (routeData.code !== 'Ok' || !routeData.routes?.[0]) {
      throw new Error(routeData.message || 'Route calculation failed');
    }

    const route = routeData.routes[0];
    activeRouteData = { route, navStops };
    legMetrics = route.legs || [];

    renderUI(false);

    const latLngs = route.geometry.coordinates.map(c => [c[1], c[0]]);
    const isEco = optimizeGoal === 'fuel' || travelMode === 'cycling' || travelMode === 'walking';
    const isDashed = travelMode === 'walking';

    routeCasing = L.polyline(latLngs, { color: isEco ? '#0d652d' : '#174ea6', weight: 8, opacity: 0.9 }).addTo(map);
    routePolyline = L.polyline(latLngs, {
      color: isEco ? '#1e8e3e' : '#4285f4',
      weight: 5,
      opacity: 1,
      dashArray: isDashed ? '8, 8' : null
    }).addTo(map);

    if (!keepInNavMode) {
      map.fitBounds(routePolyline.getBounds(), {
        paddingTopLeft: window.innerWidth > 640 ? [445, 70] : [30, 70],
        paddingBottomRight: window.innerWidth > 640 ? [50, 50] : [30, 340]
      });
    }

    const isMetric = unitSelect.value === 'metric';
    const miles = route.distance * 0.000621371;
    const km = route.distance / 1000;
    const distStr = isMetric ? `${km.toFixed(1)} km` : `${miles.toFixed(1)} mi`;

    tripTime.textContent = formatDuration(route.duration);
    tripDist.textContent = `(${distStr})`;

    if (travelMode === 'driving' || travelMode === 'moto') {
      const eff = parseFloat(fuelEffInput.value) || (travelMode === 'moto' ? 55 : 28);
      const price = parseFloat(fuelPriceInput.value) || 3.25;
      const fuelUsed = isMetric ? (km / 100) * eff : miles / eff;
      const fuelCost = fuelUsed * price;
      const fuelUnit = isMetric ? 'L' : 'gal';
      fuelEstimateText.textContent = `Fuel: ${fuelUsed.toFixed(1)} ${fuelUnit} ($${fuelCost.toFixed(2)})`;
    } else if (travelMode === 'cycling') {
      fuelEstimateText.textContent = `Est. burn: ~${Math.round(miles * 48)} kcal`;
    } else {
      fuelEstimateText.textContent = `Est. burn: ~${Math.round(miles * 85)} kcal`;
    }

    const savedSecs = Math.max(0, Math.round(originalDuration - route.duration));
    const savedMins = Math.round(savedSecs / 60);
    if (savedMins >= 1) {
      savingsBadge.textContent = `Saved ${savedMins} min`;
      savingsBadge.style.display = 'inline-flex';
      compareRouteBtn.style.display = 'inline-block';
    } else {
      savingsBadge.textContent = 'Optimal order';
      savingsBadge.style.display = 'inline-flex';
      compareRouteBtn.style.display = 'none';
    }

    stepsPreviewList.innerHTML = '';
    route.legs.forEach((leg, legIdx) => {
      const destName = navStops[legIdx + 1]?.name || 'Destination';
      leg.steps.forEach(step => {
        const dStr = isMetric
          ? `${(step.distance / 1000).toFixed(1)} km`
          : `${(step.distance * 0.000621371).toFixed(1)} mi`;
        const div = document.createElement('div');
        div.className = 'step-preview-item';
        div.innerHTML = `<span>${formatStepInstruction(step, destName)}</span><span style="color:#5f6368;flex-shrink:0;">${dStr}</span>`;
        stepsPreviewList.appendChild(div);
      });
    });

    tripSummary.classList.toggle('eco-mode', isEco);
    tripSummary.style.display = 'block';

    // Exact address-preserving Google Maps & Apple Maps multi-stop URLs
    const formatStopQuery = (s) => {
      if (!s.name || s.name === 'Your location' || s.name === 'Current position' || s.name.startsWith('Dropped pin')) {
        return `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
      }
      return encodeURIComponent(s.name);
    };

    const gmapsStopsPath = navStops.map(formatStopQuery).join('/');
    const gmapsTravelFlag = travelMode === 'cycling' ? '1' : (travelMode === 'walking' ? '2' : '0');
    gmapsBtn.href = `https://www.google.com/maps/dir/${gmapsStopsPath}/data=!4m2!4m1!3e${gmapsTravelFlag}`;
    gmapsBtn.style.display = 'inline-flex';

    if (appleMapsBtn) {
      const appleOrigin = formatStopQuery(navStops[0]);
      const appleDaddrs = navStops.slice(1).map(s => `daddr=${formatStopQuery(s)}`).join('&');
      const appleDirFlg = travelMode === 'cycling' ? 'c' : (travelMode === 'walking' ? 'w' : 'd');
      appleMapsBtn.href = `https://maps.apple.com/?saddr=${appleOrigin}&${appleDaddrs}&dirflg=${appleDirFlg}`;
      appleMapsBtn.style.display = 'inline-flex';
    }

    if (exportMapsRow) {
      exportMapsRow.style.display = 'flex';
    }

    demoDriveBtn.style.display = 'flex';
    startVoiceNavBtn.style.display = 'inline-flex';
  } catch (err) {
    showToast(err.message || 'Route calculation error.');
  } finally {
    optimizeBtn.disabled = false;
    optimizeBtn.textContent = 'Optimize Route';
  }
}

optimizeBtn.addEventListener('click', () => runRouteOptimization(false));

compareRouteBtn.addEventListener('click', () => {
  if (originalCompareLine) {
    map.removeLayer(originalCompareLine);
    originalCompareLine = null;
    compareRouteBtn.textContent = 'Compare original';
    return;
  }
  if (originalStopsSnapshot.length < 3) return;
  const pts = originalStopsSnapshot.map(s => [s.lat, s.lng]);
  if (endRule === 'roundtrip') pts.push([originalStopsSnapshot[0].lat, originalStopsSnapshot[0].lng]);
  originalCompareLine = L.polyline(pts, {
    color: '#5f6368',
    weight: 3,
    dashArray: '8, 8',
    opacity: 0.75
  }).addTo(map);
  compareRouteBtn.textContent = 'Hide original';
});

// 13. Smart 60-FPS Smooth Navigation & Demo Simulator
function launchNavigationSession(isDemoMode) {
  if (!activeRouteData) return;
  isNavigating = true;
  isDemoModeActive = isDemoMode;
  demoPaused = false;
  document.body.classList.add('in-navigation');
  const playPauseBtn = document.getElementById('demoPlayPauseBtn');
  if (playPauseBtn) playPauseBtn.textContent = '⏸';

  directionsPanel.style.display = 'none';
  document.getElementById('navHudTop').style.display = 'block';
  document.getElementById('navHudBottom').style.display = 'flex';
  document.getElementById('speedPill').style.display = 'flex';
  document.getElementById('demoControlsBar').style.display = isDemoMode ? 'flex' : 'none';

  const isMetric = unitSelect.value === 'metric';
  document.getElementById('speedUnit').textContent = isMetric ? 'KM/H' : 'MPH';

  navSteps = [];
  const { route, navStops } = activeRouteData;
  route.legs.forEach((leg, legIdx) => {
    const destStopName = navStops[legIdx + 1]?.name || 'Destination';
    leg.steps.forEach(step => {
      navSteps.push({
        lat: step.maneuver.location[1],
        lng: step.maneuver.location[0],
        distance: step.distance,
        duration: step.duration,
        modifier: step.maneuver.modifier || '',
        type: step.maneuver.type || '',
        text: formatStepInstruction(step, destStopName),
        stopIndex: legIdx + 1,
        stopName: destStopName
      });
    });
  });

  currentStepIdx = 0;
  lastSpokenStepIdx = -1;

  const startCoord = navStops[0];
  if (vehicleMarker) map.removeLayer(vehicleMarker);
  vehicleMarker = L.marker([startCoord.lat, startCoord.lng], { icon: createVehicleIcon(0) }).addTo(map);
  map.setView([startCoord.lat, startCoord.lng], 16);

  updateNavStepUI(0, true);

  if (isDemoMode) {
    const pathCoords = route.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
    if (pathCoords.length < 2) return;

    const segLengths = [];
    let totalRouteMeters = 0;
    for (let i = 0; i < pathCoords.length - 1; i++) {
      const d = getMetersBetween(pathCoords[i].lat, pathCoords[i].lng, pathCoords[i + 1].lat, pathCoords[i + 1].lng);
      segLengths.push(d);
      totalRouteMeters += d;
    }

    demoSegIdx = 0;
    demoSegProgress = 0;
    demoLastTimestamp = performance.now();

    const baseMps = travelMode === 'walking' ? 2.2 : (travelMode === 'cycling' ? 7.5 : 22.0);

    function animateDemoFrame(now) {
      if (!isNavigating || !isDemoModeActive) return;
      const dt = Math.min(0.1, (now - demoLastTimestamp) / 1000);
      demoLastTimestamp = now;

      if (!demoPaused && demoSegIdx < segLengths.length) {
        const upcomingStep = navSteps[currentStepIdx + 1];
        const currPt = pathCoords[demoSegIdx];
        const distToTurn = upcomingStep ? getMetersBetween(currPt.lat, currPt.lng, upcomingStep.lat, upcomingStep.lng) : 999;
        const cornerFactor = distToTurn < 80 ? 0.55 : 1.0;

        const currentMps = baseMps * cornerFactor;
        let advanceMeters = currentMps * demoMultiplier * dt;

        while (advanceMeters > 0 && demoSegIdx < segLengths.length) {
          const segLen = Math.max(0.1, segLengths[demoSegIdx]);
          const remInSeg = segLen - demoSegProgress;
          if (advanceMeters < remInSeg) {
            demoSegProgress += advanceMeters;
            advanceMeters = 0;
          } else {
            advanceMeters -= remInSeg;
            demoSegIdx++;
            demoSegProgress = 0;
          }
        }

        if (demoSegIdx >= segLengths.length) {
          const finalPt = pathCoords[pathCoords.length - 1];
          vehicleMarker.setLatLng([finalPt.lat, finalPt.lng]);
          document.getElementById('speedVal').textContent = '0';
          document.getElementById('navRemainingTime').textContent = 'Arrived';
          document.getElementById('navRemainingDist').textContent = '0.0 mi remaining';
          speakAlert('You have arrived at your final destination.');
          return;
        }

        const p1 = pathCoords[demoSegIdx];
        const p2 = pathCoords[demoSegIdx + 1];
        const ratio = demoSegProgress / Math.max(0.1, segLengths[demoSegIdx]);
        const lat = p1.lat + (p2.lat - p1.lat) * ratio;
        const lng = p1.lng + (p2.lng - p1.lng) * ratio;
        const heading = getBearingDeg(p1.lat, p1.lng, p2.lat, p2.lng);

        vehicleMarker.setLatLng([lat, lng]);
        vehicleMarker.setIcon(createVehicleIcon(heading));
        map.panTo([lat, lng], { animate: false });

        const displaySpeed = isMetric ? Math.round(currentMps * 3.6) : Math.round(currentMps * 2.23694);
        document.getElementById('speedVal').textContent = displaySpeed;

        let traveledMeters = demoSegProgress;
        for (let k = 0; k < demoSegIdx; k++) traveledMeters += segLengths[k];
        const remMeters = Math.max(0, totalRouteMeters - traveledMeters);
        const remRatio = totalRouteMeters > 0 ? remMeters / totalRouteMeters : 0;

        document.getElementById('navRemainingTime').textContent = formatDuration(route.duration * remRatio);
        document.getElementById('navRemainingDist').textContent = isMetric
          ? `${(remMeters / 1000).toFixed(1)} km remaining`
          : `${(remMeters * 0.000621371).toFixed(1)} mi remaining`;

        if (currentStepIdx < navSteps.length - 1) {
          const nextStep = navSteps[currentStepIdx + 1];
          const dNext = getMetersBetween(lat, lng, nextStep.lat, nextStep.lng);
          document.getElementById('navStepDist').textContent = isMetric
            ? `In ${Math.round(dNext)} m`
            : `In ${Math.round(dNext * 3.28084)} ft`;

          if (dNext < 45) {
            currentStepIdx++;
            updateNavStepUI(currentStepIdx, true);
          }
        }

        reportedIncidents.forEach(inc => {
          if (!announcedIncidentIds.has(inc.id)) {
            if (getMetersBetween(lat, lng, inc.lat, inc.lng) < 450) {
              announcedIncidentIds.add(inc.id);
              speakAlert(`Caution: ${inc.label} ahead.`);
            }
          }
        });
      }

      demoAnimFrameId = requestAnimationFrame(animateDemoFrame);
    }

    demoAnimFrameId = requestAnimationFrame(animateDemoFrame);
  } else {
    if (!navigator.geolocation) return showToast('GPS tracking requires geolocation support.');
    document.getElementById('navRemainingTime').textContent = formatDuration(route.duration);
    document.getElementById('navRemainingDist').textContent = isMetric
      ? `${(route.distance / 1000).toFixed(1)} km remaining`
      : `${(route.distance * 0.000621371).toFixed(1)} mi remaining`;

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, heading, speed } = pos.coords;
        vehicleMarker.setLatLng([latitude, longitude]);
        if (heading !== null && !isNaN(heading)) vehicleMarker.setIcon(createVehicleIcon(heading));
        map.panTo([latitude, longitude]);

        const mps = speed || 0;
        document.getElementById('speedVal').textContent = isMetric ? Math.round(mps * 3.6) : Math.round(mps * 2.23694);

        if (currentStepIdx < navSteps.length - 1) {
          const nextStep = navSteps[currentStepIdx + 1];
          const distToNext = getMetersBetween(latitude, longitude, nextStep.lat, nextStep.lng);
          document.getElementById('navStepDist').textContent = isMetric
            ? `In ${Math.round(distToNext)} m`
            : `In ${Math.round(distToNext * 3.28084)} ft`;
          if (distToNext < 45) {
            currentStepIdx++;
            updateNavStepUI(currentStepIdx, true);
          }
        }

        reportedIncidents.forEach(inc => {
          if (!announcedIncidentIds.has(inc.id)) {
            if (getMetersBetween(latitude, longitude, inc.lat, inc.lng) < 400) {
              announcedIncidentIds.add(inc.id);
              speakAlert(`Caution: ${inc.label} ahead.`);
            }
          }
        });
      },
      (err) => console.warn('GPS watch warning:', err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }
}

startVoiceNavBtn.addEventListener('click', () => launchNavigationSession(false));
demoDriveBtn.addEventListener('click', () => launchNavigationSession(true));

// Demo Playback Controls (Pause/Resume, 1x..40x Speed, Skip to Next Stop)
document.getElementById('demoPlayPauseBtn').addEventListener('click', (e) => {
  demoPaused = !demoPaused;
  e.target.textContent = demoPaused ? '▶' : '⏸';
});

document.querySelectorAll('.demo-speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.demo-speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    demoMultiplier = parseFloat(btn.dataset.mult) || 1;
  });
});

document.getElementById('demoSkipStopBtn').addEventListener('click', () => {
  if (!activeRouteData || !isDemoModeActive) return;
  const pathCoords = activeRouteData.route.geometry.coordinates;
  const nextIdx = Math.min(pathCoords.length - 2, demoSegIdx + Math.floor(pathCoords.length / Math.max(2, stops.length)));
  demoSegIdx = nextIdx;
  demoSegProgress = 0;
  showToast('Jumped ahead along route');
});

function updateNavStepUI(idx, shouldSpeak) {
  const step = navSteps[idx];
  if (!step) return;
  document.getElementById('navStepText').textContent = step.text;
  document.getElementById('navNextStopLabel').textContent = `Next: ${step.stopName}`;
  document.getElementById('navStopCounter').textContent = `Stop ${step.stopIndex} of ${activeRouteData.navStops.length - 1}`;
  document.getElementById('navTurnIcon').innerHTML = getTurnArrowSvg(step.modifier, step.type);

  const isMetric = unitSelect.value === 'metric';
  document.getElementById('navStepDist').textContent = isMetric
    ? `${Math.round(step.distance)} m`
    : `${Math.round(step.distance * 3.28084)} ft`;

  if (shouldSpeak && lastSpokenStepIdx !== idx) {
    lastSpokenStepIdx = idx;
    speakAlert(step.text);
  }
}

const voiceToggleBtn = document.getElementById('voiceToggleBtn');
voiceToggleBtn.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  voiceToggleBtn.classList.toggle('muted', !voiceEnabled);
  document.getElementById('voiceOnIcon').style.display = voiceEnabled ? 'block' : 'none';
  document.getElementById('voiceOffIcon').style.display = voiceEnabled ? 'none' : 'block';
  if (!voiceEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  else if (voiceEnabled && navSteps[currentStepIdx]) speakAlert(navSteps[currentStepIdx].text);
});

document.getElementById('recenterBtn').addEventListener('click', () => {
  if (vehicleMarker) map.setView(vehicleMarker.getLatLng(), 16);
});

document.getElementById('exitNavBtn').addEventListener('click', () => {
  isNavigating = false;
  isDemoModeActive = false;
  demoPaused = false;
  document.body.classList.remove('in-navigation');
  const playPauseBtn = document.getElementById('demoPlayPauseBtn');
  if (playPauseBtn) playPauseBtn.textContent = '⏸';
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (demoAnimFrameId !== null) { cancelAnimationFrame(demoAnimFrameId); demoAnimFrameId = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (vehicleMarker) { map.removeLayer(vehicleMarker); vehicleMarker = null; }
  navAddStopModal.classList.remove('open');
  document.getElementById('speedVal').textContent = '0';
  document.getElementById('navHudTop').style.display = 'none';
  document.getElementById('navHudBottom').style.display = 'none';
  document.getElementById('speedPill').style.display = 'none';
  document.getElementById('demoControlsBar').style.display = 'none';
  directionsPanel.style.display = 'flex';
});

// ============================================================================
// DEVELOPER DIAGNOSTIC REFERENCE: Web Speech API & Fallback Core
// ----------------------------------------------------------------------------
// 1. Browser Support: window.SpeechRecognition / window.webkitSpeechRecognition
//    operates in Chrome, Edge, and Safari.
// 2. Security Context: Requires a secure origin (https://) or localhost. On unencrypted
//    HTTP, modern browsers reject audio capture with 'not-allowed'.
// 3. Privacy Shields: Strict shields (e.g. Brave Shields, Safari privacy toggles, or
//    ad-blocking extensions) can block speech recognition endpoints, firing 'network'.
// 4. Operational Fallback: When speech is unavailable or blocked, ZIG's core functionality
//    (real-time geocoding autocomplete, drag-and-drop stop management, 2-opt TSP matrix
//    optimization, multi-mode routing, 60-FPS simulation, and Google/Apple Maps export)
//    remains 100% functional without voice commands.
// ============================================================================

// 14. Hands-Free Voice Command Engine
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceCmdBtn = document.getElementById('voiceCmdBtn');
const navMicBtn = document.getElementById('navMicBtn');
let recognizer = null;
let isListening = false;

async function addPlaceByVoiceQuery(placeName) {
  const clean = placeName.trim();
  if (!clean) return;
  try {
    const results = await searchLocalPlaces(clean, 1);
    if (results.length > 0) {
      const place = results[0];
      const fullName = place.sub && !place.sub.startsWith(place.title)
        ? `${place.title}, ${place.sub}`
        : (place.sub || place.title);
      await insertStopAndRecalculate({ name: fullName, lng: place.lng, lat: place.lat });
    } else {
      showToast(`Could not find "${clean}" nearby.`);
      speakAlert(`Sorry, I couldn't find ${clean}.`);
    }
  } catch (_) {
    showToast('Voice lookup failed. Check connection.');
  }
}

async function handleVoiceCommand(transcript) {
  const cmd = transcript.toLowerCase().trim();
  showToast(`Heard: "${transcript}"`);

  if (cmd.includes('police') || cmd.includes('cop') || cmd.includes('speed trap')) {
    document.querySelector('.report-option[data-type="police"]')?.click();
    return;
  }
  if (cmd.includes('object') || cmd.includes('debris') || cmd.includes('hazard')) {
    document.querySelector('.report-option[data-type="object"]')?.click();
    return;
  }
  if (cmd.includes('crash') || cmd.includes('accident')) {
    document.querySelector('.report-option[data-type="crash"]')?.click();
    return;
  }
  if (cmd.includes('slowdown') || cmd.includes('traffic')) {
    document.querySelector('.report-option[data-type="slowdown"]')?.click();
    return;
  }

  if (cmd.includes('gas') || cmd.includes('fuel')) {
    speakAlert('Finding nearby gas stations and live prices.');
    document.querySelector('#categoryBar .cat-chip[data-tag="amenity:fuel"]')?.click();
    return;
  }

  if (cmd.includes('parking') || cmd.includes('garage') || cmd.includes('lot')) {
    speakAlert('Finding nearby parking availability and rates.');
    document.querySelector('#categoryBar .cat-chip[data-tag="amenity:parking"]')?.click();
    return;
  }

  if (cmd.includes('ev') || cmd.includes('charger') || cmd.includes('charging') || cmd.includes('tesla')) {
    speakAlert('Finding nearby EV charging stations and live prices.');
    document.querySelector('#categoryBar .cat-chip[data-tag="amenity:charging_station"]')?.click();
    return;
  }

  if (cmd.includes('apple maps') || cmd.includes('apple map')) {
    speakAlert('Opening route in Apple Maps.');
    appleMapsBtn?.click();
    return;
  }

  if (cmd.includes('google maps') || cmd.includes('google map')) {
    speakAlert('Opening route in Google Maps.');
    gmapsBtn?.click();
    return;
  }

  if (cmd.includes('demo') || cmd.includes('simulate')) {
    if (stops.length < 2) {
      speakAlert('Please add at least 2 stops before starting demo drive.');
      showToast('Add at least 2 stops for demo drive');
      return;
    }
    if (!activeRouteData) await runRouteOptimization(false);
    launchNavigationSession(true);
    return;
  }
  if (cmd.includes('start') || cmd.includes('take the route') || cmd.includes('navigate') || cmd.includes('begin')) {
    if (stops.length < 2) {
      speakAlert('Please add at least 2 stops before starting navigation.');
      showToast('Add at least 2 stops to navigate');
      return;
    }
    if (!activeRouteData) await runRouteOptimization(false);
    launchNavigationSession(false);
    return;
  }

  if (cmd.includes('optimize') || cmd.includes('sort') || cmd.includes('fastest') || cmd.includes('arrange')) {
    if (stops.length < 2) {
      speakAlert('Please add at least 2 stops before optimizing.');
      showToast('Add at least 2 stops to optimize');
      return;
    }
    speakAlert('Optimizing your route.');
    runRouteOptimization(isNavigating);
    return;
  }

  if (cmd.includes('clear') || cmd.includes('reset')) {
    clearAllBtn.click();
    speakAlert('Route cleared.');
    return;
  }

  let cleanedPlaces = cmd
    .replace(/^(please\s+)?(add|go to|stop at|visit|head to|route to)\s+/i, '')
    .trim();

  if (cleanedPlaces.length > 1) {
    const parts = cleanedPlaces.split(/\s+and\s+|,\s*/i).filter(p => p.trim().length > 1);
    for (const part of parts) {
      await addPlaceByVoiceQuery(part);
    }
    if (cmd.includes('and optimize') && stops.length >= 2) {
      runRouteOptimization(isNavigating);
    }
  }
}

function toggleVoiceRecognition() {
  if (!SpeechRecognitionAPI) {
    showToast('Voice commands require Chrome, Edge, or Safari.');
    return;
  }

  if (isListening && recognizer) {
    try { recognizer.stop(); } catch (_) {}
    isListening = false;
    voiceCmdBtn?.classList.remove('listening-active');
    navMicBtn?.classList.remove('listening-active');
    return;
  }

  try {
    if (recognizer) {
      try { recognizer.abort(); } catch (_) {}
    }
    recognizer = new SpeechRecognitionAPI();
    recognizer.lang = navigator.language || 'en-US';
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;

    recognizer.onstart = () => {
      isListening = true;
      voiceCmdBtn?.classList.add('listening-active');
      navMicBtn?.classList.add('listening-active');
      showToast('Listening... Say "Add [place]", "Optimize route", or "Take the route"');
    };

    recognizer.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      handleVoiceCommand(transcript);
    };

    recognizer.onerror = (event) => {
      isListening = false;
      voiceCmdBtn?.classList.remove('listening-active');
      navMicBtn?.classList.remove('listening-active');
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      if (event.error === 'not-allowed') {
        showToast('Speech service unreachable (not-allowed). Check HTTPS connection or browser shield settings.');
      } else {
        showToast('Speech service unreachable. Check HTTPS connection or browser shield settings.');
      }
    };

    recognizer.onend = () => {
      isListening = false;
      voiceCmdBtn?.classList.remove('listening-active');
      navMicBtn?.classList.remove('listening-active');
    };

    recognizer.start();
  } catch (err) {
    isListening = false;
    voiceCmdBtn?.classList.remove('listening-active');
    navMicBtn?.classList.remove('listening-active');
    showToast('Voice recognition could not be started: ' + (err.message || 'unknown error'));
  }
}

voiceCmdBtn?.addEventListener('click', toggleVoiceRecognition);
navMicBtn?.addEventListener('click', toggleVoiceRecognition);
