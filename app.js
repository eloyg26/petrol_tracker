const API_URL = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
const HISTORY_KEY = 'gasolina-coruna-history';
const ALERT_KEY = 'gasolina-coruna-alert';
const FAVORITES_KEY = 'gasolina-coruna-favorites';
const A_CORUNA_CENTER = [43.3623, -8.4115];
const PRICE_REFRESH_MS = 60000;
let stationMap = null;
let stationMarkersLayer = null;
let latestStations = [];
let userLocation = null;

function formatEuro(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(3).replace('.', ',')} €/L`;
}

function parsePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).trim().replace('.', '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStation(station) {
  const normalized = {};
  Object.entries(station).forEach(([key, value]) => {
    normalized[key.trim()] = value;
  });
  return normalized;
}

function isCorunaStation(station) {
  const province = String(station.Provincia || '').toUpperCase();
  const municipality = String(station.Municipio || '').toUpperCase();
  return province.includes('CORUÑA') || province.includes('CORUNA') || municipality.includes('CORUÑA') || municipality.includes('CORUNA');
}

function normalizeLocality(value) {
  return String(value || '').trim();
}

function getLocalityOptions(stations) {
  return ['Todas', ...new Set(
    stations
      .map((station) => normalizeLocality(station.Localidad))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  )];
}

function getFilteredStations(stations, locality) {
  const list = stations.filter(isCorunaStation);
  if (!locality || locality === 'Todas') return list;
  return list.filter((station) => normalizeLocality(station.Localidad) === locality);
}

function getStationFuel(station, keys) {
  for (const key of keys) {
    const value = station[key];
    if (value !== undefined && value !== null && value !== '') {
      return parsePrice(value);
    }
  }
  return null;
}

function getMapsUrl(station) {
  const locality = station.Localidad || '';
  const address = station.Dirección || station.Direccion || station['Dirección'] || station['Direccion'] || '';
  const query = [station['Rótulo'] || 'Gasolinera', address, locality].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function getStationCoords(station) {
  const coordinates = parseCoordinates(station);
  if (!coordinates) return null;
  return { lat: coordinates[0], lng: coordinates[1] };
}

function getDistanceKm(from, to) {
  if (!from || !to) return null;
  const earthRadiusKm = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function getStationDistanceKm(station) {
  if (!userLocation) return null;
  const stationCoords = getStationCoords(station);
  if (!stationCoords) return null;
  return getDistanceKm(userLocation, stationCoords);
}

function getStationRouteUrl(station) {
  const coords = getStationCoords(station);
  if (!coords) return getMapsUrl(station);
  if (!userLocation) return getMapsUrl(station);
  return `https://www.google.com/maps/dir/${userLocation.lat},${userLocation.lng}/${coords.lat},${coords.lng}`;
}

function formatDistance(distanceKm) {
  if (distanceKm === null || distanceKm === undefined || Number.isNaN(distanceKm)) return 'Sin ubicación';
  return `${distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`}`;
}

function getPriceColor(price) {
  if (price === null || price === undefined || !Number.isFinite(price)) {
    return '#64748b';
  }

  if (price <= 1.45) return '#22c55e';
  if (price <= 1.60) return '#84cc16';
  if (price <= 1.73) return '#f59e0b';
  if (price <= 1.85) return '#f97316';
  return '#ef4444';
}

function parseCoordinates(station) {
  const lat = Number(String(station.Latitud || station.Latitude || '').replace(',', '.'));
  const lng = Number(String(station.Longitud || station['Longitud (WGS84)'] || station.Longitude || '').replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

function initStationMap() {
  if (stationMap) return;
  stationMap = L.map('stationMap', {
    zoomControl: true,
    scrollWheelZoom: true,
    attributionControl: true
  }).setView(A_CORUNA_CENTER, 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(stationMap);

  stationMarkersLayer = L.layerGroup().addTo(stationMap);
}

function renderStationMap(stations) {
  initStationMap();
  stationMarkersLayer.clearLayers();

  const validStations = stations.filter((station) => parseCoordinates(station));
  validStations.forEach((station) => {
    const coords = parseCoordinates(station);
    const fuel95 = getStationFuel(station, ['Precio Gasolina 95 E5', 'Precio Gasolina 95 E10', 'Precio Gasolina 95 E25']);
    const fuelDiesel = getStationFuel(station, ['Precio Gasoleo A', 'Precio Gasoleo B']);
    const priceForColor = fuel95 ?? fuelDiesel;
    const address = station.Dirección || station.Direccion || station['Dirección'] || station['Direccion'] || 'Sin dirección';

    const marker = L.circleMarker(coords, {
      radius: 9,
      color: '#ffffff',
      weight: 1.5,
      fillColor: getPriceColor(priceForColor),
      fillOpacity: 0.95
    });

    marker.bindPopup(`
      <div style="min-width: 200px; line-height: 1.5; font-family: sans-serif;">
        <strong>${station['Rótulo'] || 'Gasolinera'}</strong><br>
        <span>${address}</span><br>
        <span>95: ${formatEuro(fuel95)}</span><br>
        <span>Diésel: ${formatEuro(fuelDiesel)}</span>
      </div>
    `);

    marker.addTo(stationMarkersLayer);
  });

  if (validStations.length > 0) {
    const bounds = L.latLngBounds(validStations.map((station) => parseCoordinates(station)));
    stationMap.fitBounds(bounds.pad(0.25));
  } else {
    stationMap.setView(A_CORUNA_CENTER, 12);
  }
}

function findLocalityCoordinates(locality, stations) {
  const normalizedQuery = String(locality || '').trim().toLowerCase();
  if (!normalizedQuery) return null;

  const matches = stations.filter((station) => {
    const stationLocality = normalizeLocality(station.Localidad || '').toLowerCase();
    return stationLocality === normalizedQuery || stationLocality.includes(normalizedQuery);
  });

  if (!matches.length) return null;

  const coordinates = matches
    .map((station) => parseCoordinates(station))
    .filter(Boolean);

  if (!coordinates.length) return null;

  const lat = coordinates.reduce((sum, [latValue]) => sum + latValue, 0) / coordinates.length;
  const lon = coordinates.reduce((sum, [, lngValue]) => sum + lngValue, 0) / coordinates.length;
  return [lat, lon];
}

async function searchMapByLocation(query) {
  const value = (query || '').trim();
  if (!value) return;

  initStationMap();

  const localFallback = findLocalityCoordinates(value, latestStations);
  if (localFallback) {
    stationMap.setView(localFallback, 13);
    L.marker(localFallback).addTo(stationMarkersLayer)
      .bindPopup(`<strong>${value}</strong>`)
      .openPopup();
    return;
  }

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(value)}`);
    const result = await response.json();
    if (!result || !result.length) {
      alert('No se encontró esa ubicación en el mapa.');
      return;
    }

    const lat = Number(result[0].lat);
    const lon = Number(result[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    stationMap.setView([lat, lon], 13);
    L.marker([lat, lon]).addTo(stationMarkersLayer)
      .bindPopup(`<strong>${result[0].display_name}</strong>`)
      .openPopup();
  } catch (error) {
    console.error('Error buscando ubicación', error);
    alert('No se pudo buscar la ubicación en el mapa.');
  }
}

function openMapSearch(query) {
  const search = (query || '').trim();
  if (!search) return;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(search)}`, '_blank', 'noopener,noreferrer');
}

function getStationKey(station) {
  const name = station['Rótulo'] || 'Gasolinera';
  const address = station.Dirección || station.Direccion || station['Dirección'] || station['Direccion'] || 'Sin dirección';
  const locality = station.Localidad || 'Sin localidad';
  return `${name}|${address}|${locality}`.toLowerCase();
}

function readFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeFavorites(list) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
}

function isFavorite(station) {
  const key = getStationKey(station);
  return readFavorites().includes(key);
}

function toggleFavoriteByKey(key) {
  const favorites = readFavorites();
  const exists = favorites.includes(key);
  const nextFavorites = exists ? favorites.filter((item) => item !== key) : [...favorites, key];
  writeFavorites(nextFavorites);
  return !exists;
}

function getCheapestStationRows(stations) {
  return stations
    .map((station) => ({
      key: getStationKey(station),
      name: station['Rótulo'] || station.Localidad || 'Estación',
      locality: station.Localidad || '-',
      address: station.Dirección || station.Direccion || station['Dirección'] || station['Direccion'] || 'Sin dirección',
      mapsUrl: getMapsUrl(station),
      routeUrl: getStationRouteUrl(station),
      gasolina95: getStationFuel(station, ['Precio Gasolina 95 E5', 'Precio Gasolina 95 E10', 'Precio Gasolina 95 E25']),
      diesel: getStationFuel(station, ['Precio Gasoleo A', 'Precio Gasoleo B']),
      favorite: isFavorite(station),
      distanceKm: getStationDistanceKm(station)
    }))
    .filter((item) => item.gasolina95 !== null || item.diesel !== null)
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite);
      const priceA = a.gasolina95 ?? a.diesel ?? 99;
      const priceB = b.gasolina95 ?? b.diesel ?? 99;
      if (userLocation && a.distanceKm !== null && b.distanceKm !== null) {
        const scoreA = priceA + (a.distanceKm * 0.04);
        const scoreB = priceB + (b.distanceKm * 0.04);
        return scoreA - scoreB;
      }
      return priceA - priceB;
    });
}

function renderBestStations() {
  const container = document.getElementById('bestStationsList');
  if (!container) return;

  if (!userLocation) {
    container.innerHTML = '';
    return;
  }

  const bestStations = getCheapestStationRows(latestStations).slice(0, 4);

  if (!bestStations.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = bestStations
    .map((station, index) => {
      const price = station.gasolina95 ?? station.diesel ?? null;
      const routeText = station.distanceKm === null ? 'Ruta • sin datos' : `Ruta • ${formatDistance(station.distanceKm)}`;
      return `
        <a href="${station.routeUrl}" target="_blank" rel="noopener noreferrer" class="block rounded-xl border border-white/60 bg-white/35 px-2 py-2 transition hover:bg-white/60">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">#${index + 1}</span>
            <span class="text-[10px] uppercase tracking-[0.12em] text-amber-600">${station.favorite ? '★' : '•'}</span>
          </div>
          <div class="mt-1 font-medium text-slate-700">${station.name}</div>
          <div class="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
            <span>${station.locality}</span>
            <span>${price !== null ? formatEuro(price) : '—'}</span>
          </div>
          <div class="mt-1 text-[10px] text-sky-700">${routeText}</div>
        </a>
      `;
    })
    .join('');
}

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function readAlert() {
  try {
    return JSON.parse(localStorage.getItem(ALERT_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveAlert(data) {
  localStorage.setItem(ALERT_KEY, JSON.stringify(data));
}

function calculateSummary(stations, locality = 'Todas') {
  const filteredStations = getFilteredStations(stations, locality);
  const gasolinaPrices = filteredStations
    .map((station) => getStationFuel(station, ['Precio Gasolina 95 E5', 'Precio Gasolina 95 E10', 'Precio Gasolina 95 E25']))
    .filter((value) => value !== null);
  const dieselPrices = filteredStations
    .map((station) => getStationFuel(station, ['Precio Gasoleo A', 'Precio Gasoleo B']))
    .filter((value) => value !== null);

  const average95 = gasolinaPrices.length ? gasolinaPrices.reduce((a, b) => a + b, 0) / gasolinaPrices.length : 0;
  const averageDiesel = dieselPrices.length ? dieselPrices.reduce((a, b) => a + b, 0) / dieselPrices.length : 0;

  const history = readHistory();
  const previous = history[history.length - 1] || null;
  const delta95 = previous ? Number((average95 - previous.average95).toFixed(3)) : 0;
  const deltaDiesel = previous ? Number((averageDiesel - previous.averageDiesel).toFixed(3)) : 0;

  return {
    updated_at: new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }),
    average95,
    averageDiesel,
    delta95,
    deltaDiesel,
    top: getCheapestStationRows(filteredStations),
    locality
  };
}

function renderWeeklySummary(history) {
  const container = document.getElementById('weeklyHistoryList');
  if (!container) return;

  const entries = history.slice(-7);
  if (!entries.length) {
    container.innerHTML = '<div class="text-xs text-slate-500">Sin historial disponible.</div>';
    return;
  }

  container.innerHTML = entries
    .map((item) => `
      <div class="flex items-center justify-between rounded-2xl border border-white/60 bg-white/40 px-2.5 py-2 text-[11px] text-slate-600">
        <span class="font-medium text-slate-700">${new Date(item.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
        <span>${formatEuro(item.average95)}</span>
        <span>${formatEuro(item.averageDiesel)}</span>
      </div>
    `)
    .join('');
}

function renderFavoriteStations() {
  const list = document.getElementById('favoriteStationsList');
  if (!list) return;

  const favorites = readFavorites();
  if (!favorites.length) {
    list.innerHTML = '<div class="rounded-xl border border-dashed border-white/60 bg-white/20 px-2 py-2 text-[11px] text-slate-500">No tienes favoritas todavía.</div>';
    return;
  }

  const stationMapByKey = new Map((latestStations || []).map((station) => [getStationKey(station), station]));
  const favoriteStations = favorites
    .map((key) => stationMapByKey.get(key))
    .filter(Boolean)
    .slice(0, 5)
    .map((station) => ({
      key: getStationKey(station),
      name: station['Rótulo'] || 'Gasolinera',
      price95: getStationFuel(station, ['Precio Gasolina 95 E5', 'Precio Gasolina 95 E10', 'Precio Gasolina 95 E25']),
      priceDiesel: getStationFuel(station, ['Precio Gasoleo A', 'Precio Gasoleo B']),
      mapsUrl: getMapsUrl(station),
      locality: station.Localidad || '-'
    }));

  if (!favoriteStations.length) {
    list.innerHTML = '<div class="rounded-xl border border-dashed border-white/60 bg-white/20 px-2 py-2 text-[11px] text-slate-500">No tienes favoritas todavía.</div>';
    return;
  }

  list.innerHTML = favoriteStations
    .map((station) => `
      <a href="${station.mapsUrl}" target="_blank" rel="noopener noreferrer" class="block rounded-xl border border-white/60 bg-white/35 px-2 py-2 transition hover:bg-white/60">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-slate-700">${station.name}</span>
          <span class="text-[10px] uppercase tracking-[0.12em] text-amber-600">★</span>
        </div>
        <div class="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>${station.locality}</span>
          <span>${formatEuro(station.price95)}</span>
        </div>
        <div class="mt-1 text-right text-[10px] text-slate-500">${formatEuro(station.priceDiesel)}</div>
      </a>
    `)
    .join('');
}

function renderSummary(summary) {
  document.getElementById('updatedAt').textContent = summary.updated_at;
  document.getElementById('average95').textContent = formatEuro(summary.average95);
  document.getElementById('averageDiesel').textContent = formatEuro(summary.averageDiesel);

  const delta95Text = document.getElementById('delta95Text');
  const deltaDieselText = document.getElementById('deltaDieselText');

  delta95Text.textContent = summary.delta95 === 0 ? 'Sin cambio respecto a ayer' : `${summary.delta95 > 0 ? 'Sube' : 'Baja'} ${Math.abs(summary.delta95).toFixed(3).replace('.', ',')} €/L`;
  delta95Text.className = summary.delta95 > 0 ? 'negative' : (summary.delta95 < 0 ? 'positive' : '');

  deltaDieselText.textContent = summary.deltaDiesel === 0 ? 'Sin cambio respecto a ayer' : `${summary.deltaDiesel > 0 ? 'Sube' : 'Baja'} ${Math.abs(summary.deltaDiesel).toFixed(3).replace('.', ',')} €/L`;
  deltaDieselText.className = summary.deltaDiesel > 0 ? 'negative' : (summary.deltaDiesel < 0 ? 'positive' : '');

  const cheapest95Summary = document.getElementById('cheapest95Summary');
  const cheapestDieselSummary = document.getElementById('cheapestDieselSummary');
  const cheapestAddressSummary = document.getElementById('cheapestAddressSummary');
  const expensive95Summary = document.getElementById('expensive95Summary');
  const expensiveDieselSummary = document.getElementById('expensiveDieselSummary');
  const expensiveAddressSummary = document.getElementById('expensiveAddressSummary');

  const gasolineStations = summary.top.filter((station) => station.gasolina95 !== null);
  const dieselStations = summary.top.filter((station) => station.diesel !== null);
  const cheapestGasoline = [...gasolineStations].sort((a, b) => (a.gasolina95 ?? Infinity) - (b.gasolina95 ?? Infinity))[0];
  const cheapestDiesel = [...dieselStations].sort((a, b) => (a.diesel ?? Infinity) - (b.diesel ?? Infinity))[0];
  const expensiveGasoline = [...gasolineStations].sort((a, b) => (b.gasolina95 ?? 0) - (a.gasolina95 ?? 0))[0];
  const expensiveDiesel = [...dieselStations].sort((a, b) => (b.diesel ?? 0) - (a.diesel ?? 0))[0];

  cheapest95Summary.textContent = cheapestGasoline ? formatEuro(cheapestGasoline.gasolina95) : '—';
  cheapestDieselSummary.textContent = cheapestDiesel ? formatEuro(cheapestDiesel.diesel) : '—';
  cheapestAddressSummary.textContent = cheapestGasoline ? `${cheapestGasoline.name} · ${cheapestGasoline.address}` : 'Sin dirección disponible';

  expensive95Summary.textContent = expensiveGasoline ? formatEuro(expensiveGasoline.gasolina95) : '—';
  expensiveDieselSummary.textContent = expensiveDiesel ? formatEuro(expensiveDiesel.diesel) : '—';
  expensiveAddressSummary.textContent = expensiveGasoline ? `${expensiveGasoline.name} · ${expensiveGasoline.address}` : 'Sin dirección disponible';

  const tbody = document.getElementById('cheapestTable');
  tbody.innerHTML = summary.top
    .map((station) => `
      <tr class="${station.favorite ? 'bg-amber-50/60' : ''}">
        <td>
          <div class="flex items-center gap-2">
            <button type="button" class="favorite-toggle ${station.favorite ? 'favorite-active' : ''}" data-key="${station.key}" aria-label="Guardar favorito">${station.favorite ? '★' : '☆'}</button>
            <span>${station.name}</span>
          </div>
        </td>
        <td>${station.locality}</td>
        <td><a href="${station.routeUrl || station.mapsUrl}" target="_blank" rel="noopener noreferrer">${station.address}</a></td>
        <td>${userLocation && station.distanceKm !== null ? formatDistance(station.distanceKm) : '—'}</td>
        <td>${formatEuro(station.gasolina95)}</td>
        <td>${formatEuro(station.diesel)}</td>
      </tr>
    `)
    .join('');

  tbody.querySelectorAll('.favorite-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.key;
      const isActive = toggleFavoriteByKey(key);
      button.textContent = isActive ? '★' : '☆';
      button.classList.toggle('favorite-active', isActive);
      const currentSummary = { ...summary, top: getCheapestStationRows(getFilteredStations(latestStations, summary.locality)) };
      renderSummary(currentSummary);
      renderFavoriteStations();
    });
  });

  renderFavoriteStations();
}

function populateLocalitySelects(stations, selectedValue = 'Todas') {
  const options = getLocalityOptions(stations.filter(isCorunaStation));
  const validValue = options.includes(selectedValue) ? selectedValue : 'Todas';
  const selectors = [
    document.getElementById('localityFilter'),
    document.getElementById('sidebarLocalityFilter'),
    document.getElementById('mapZoneSelect')
  ].filter(Boolean);

  selectors.forEach((select) => {
    const currentValue = select.id === 'mapZoneSelect' ? (options.includes(select.value) ? select.value : 'Todas') : validValue;
    select.innerHTML = options.map((locality) => `<option value="${locality}">${locality}</option>`).join('');
    select.value = currentValue;
  });

  return validValue;
}

function updateBestAndSummary() {
  renderBestStations();
  const currentSummary = calculateSummary(latestStations, document.getElementById('localityFilter')?.value || 'Todas');
  renderSummary(currentSummary);
}

async function requestUserLocation() {
  if (!navigator.geolocation) {
    alert('Tu navegador no admite geolocalización.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
      if (latestStations.length) {
        updateBestAndSummary();
      }
      alert('Ubicación actualizada. Ahora veremos la mejor estación más cerca de ti.');
    },
    () => {
      userLocation = null;
      renderBestStations();
      const currentSummary = calculateSummary(latestStations, document.getElementById('localityFilter')?.value || 'Todas');
      renderSummary(currentSummary);
      alert('No se pudo acceder a tu ubicación. No se muestra ninguna recomendación por proximidad.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function loadSummary() {
  try {
    const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Error de API');
    const payload = await response.json();
    const stations = (payload.ListaEESSPrecio || []).map(normalizeStation);
    latestStations = stations;
    const localitySelect = document.getElementById('localityFilter');
    const sidebarLocalitySelect = document.getElementById('sidebarLocalityFilter');
    const selectedLocality = localitySelect && localitySelect.value ? localitySelect.value : (sidebarLocalitySelect && sidebarLocalitySelect.value ? sidebarLocalitySelect.value : 'Todas');
    const resolvedLocality = populateLocalitySelects(stations, selectedLocality);
    const summary = calculateSummary(stations, resolvedLocality);
    renderStationMap(getFilteredStations(stations, resolvedLocality));

    const history = readHistory();
    history.push({
      date: new Date().toISOString().slice(0, 10),
      average95: summary.average95,
      averageDiesel: summary.averageDiesel,
      updated_at: summary.updated_at,
    });
    if (history.length > 7) history.splice(0, history.length - 7);
    writeHistory(history);

    renderSummary(summary);
    renderBestStations();
  } catch (error) {
    console.error(error);
    const fallback = readHistory();
    if (fallback.length) {
      const last = fallback[fallback.length - 1];
      renderSummary({
        updated_at: last.updated_at || 'Sin datos',
        average95: last.average95,
        averageDiesel: last.averageDiesel,
        delta95: 0,
        deltaDiesel: 0,
        top: []
      });
    }
  }
}

function checkScheduledAlert() {
  const alert = readAlert();
  if (!alert || !alert.email || !alert.time) return;

  const now = new Date();
  const [hours, minutes] = alert.time.split(':').map(Number);
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  const diff = Math.abs(now.getTime() - target.getTime());
  if (diff < 60000) {
    if (Notification.permission === 'granted') {
      new Notification('Gasolina Coruña', {
        body: `Resumen diario para ${alert.fuel === 'diesel' ? 'diésel' : 'gasoil 95'} listo.`
      });
    }
    localStorage.removeItem(ALERT_KEY);
  }
}

function saveAlertConfig(event) {
  event.preventDefault();
  const email = document.getElementById('emailInput').value.trim();
  const fuel = document.getElementById('fuelSelect').value;
  const time = document.getElementById('alertTime').value;

  if (!email || !time) {
    document.getElementById('subscriptionStatus').textContent = 'Completa todos los campos.';
    return;
  }

  saveAlert({ email, fuel, time });
  document.getElementById('subscriptionStatus').textContent = `Alerta guardada para ${email} a las ${time}.`;

  if (!('Notification' in window)) {
    alert('Tu navegador no soporta notificaciones.');
    return;
  }

  Notification.requestPermission();
}

window.addEventListener('DOMContentLoaded', async () => {
  const localityFilter = document.getElementById('localityFilter');
  const sidebarLocalityFilter = document.getElementById('sidebarLocalityFilter');
  const mapSearchBtn = document.getElementById('mapSearchBtn');
  const mapSearchInput = document.getElementById('mapSearchInput');
  const mapZoneSelect = document.getElementById('mapZoneSelect');
  const mobileSummaryToggle = document.getElementById('mobileSummaryToggle');
  const summaryDrawerContent = document.getElementById('summaryDrawerContent');
  const mobileSummaryChevron = document.getElementById('mobileSummaryChevron');
  const useMyLocationBtn = document.getElementById('useMyLocationBtn');

  if (mobileSummaryToggle && summaryDrawerContent) {
    mobileSummaryToggle.addEventListener('click', () => {
      const isOpen = summaryDrawerContent.classList.toggle('is-open');
      summaryDrawerContent.classList.toggle('is-collapsed', !isOpen);
      mobileSummaryChevron.textContent = isOpen ? '▴' : '▾';
    });

    const syncSummaryState = () => {
      if (window.innerWidth >= 1024) {
        summaryDrawerContent.classList.remove('is-open', 'is-collapsed');
        mobileSummaryChevron.textContent = '▾';
        return;
      }
      summaryDrawerContent.classList.add('is-collapsed');
      summaryDrawerContent.classList.remove('is-open');
      mobileSummaryChevron.textContent = '▾';
    };

    window.addEventListener('resize', syncSummaryState);
    syncSummaryState();
  }

  const updateLocalityView = async (selected) => {
    try {
      const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      const stations = (payload.ListaEESSPrecio || []).map(normalizeStation);
      latestStations = stations;
      const resolved = populateLocalitySelects(stations, selected);
      renderSummary(calculateSummary(stations, resolved));
      renderStationMap(getFilteredStations(stations, resolved));
    } catch (error) {
      console.error('Error al filtrar por localidad', error);
    }
  };

  document.getElementById('refreshBtn').addEventListener('click', loadSummary);
  if (useMyLocationBtn) {
    useMyLocationBtn.addEventListener('click', requestUserLocation);
  }
  [localityFilter, sidebarLocalityFilter].filter(Boolean).forEach((select) => {
    select.addEventListener('change', () => updateLocalityView(select.value));
  });
  mapZoneSelect.addEventListener('change', () => {
    const selected = mapZoneSelect.value;
    if (selected && selected !== 'Todas') {
      searchMapByLocation(selected);
      return;
    }
    initStationMap();
    stationMap.setView(A_CORUNA_CENTER, 12);
  });
  mapSearchBtn.addEventListener('click', () => searchMapByLocation(mapSearchInput.value));
  mapSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchMapByLocation(mapSearchInput.value);
    }
  });
  document.getElementById('subscriptionForm').addEventListener('submit', saveAlertConfig);
  const saved = readAlert();
  if (saved) {
    document.getElementById('emailInput').value = saved.email || '';
    document.getElementById('fuelSelect').value = saved.fuel || 'gasolina95';
    document.getElementById('alertTime').value = saved.time || '08:00';
  }

  await loadSummary();
  setInterval(loadSummary, PRICE_REFRESH_MS);
  setInterval(checkScheduledAlert, 60000);
});
