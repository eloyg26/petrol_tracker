const API_URL = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
const HISTORY_KEY = 'gasolina-coruna-history';
const ALERT_KEY = 'gasolina-coruna-alert';

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

function getCheapestStationRows(stations) {
  return stations
    .map((station) => ({
      name: station['Rótulo'] || station.Localidad || 'Estación',
      locality: station.Localidad || '-',
      address: station.Dirección || station.Direccion || station['Dirección'] || station['Direccion'] || 'Sin dirección',
      mapsUrl: getMapsUrl(station),
      gasolina95: getStationFuel(station, ['Precio Gasolina 95 E5', 'Precio Gasolina 95 E10', 'Precio Gasolina 95 E25']),
      diesel: getStationFuel(station, ['Precio Gasoleo A', 'Precio Gasoleo B'])
    }))
    .filter((item) => item.gasolina95 !== null || item.diesel !== null)
    .sort((a, b) => {
      const priceA = a.gasolina95 ?? a.diesel ?? 99;
      const priceB = b.gasolina95 ?? b.diesel ?? 99;
      return priceA - priceB;
    });
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
      <tr>
        <td>${station.name}</td>
        <td>${station.locality}</td>
        <td><a href="${station.mapsUrl}" target="_blank" rel="noopener noreferrer">${station.address}</a></td>
        <td>${formatEuro(station.gasolina95)}</td>
        <td>${formatEuro(station.diesel)}</td>
      </tr>
    `)
    .join('');
}

async function loadSummary() {
  try {
    const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Error de API');
    const payload = await response.json();
    const stations = (payload.ListaEESSPrecio || []).map(normalizeStation);
    const localitySelect = document.getElementById('localityFilter');
    const selectedLocality = localitySelect ? localitySelect.value : 'Todas';
    const options = getLocalityOptions(stations.filter(isCorunaStation));

    if (localitySelect) {
      const currentValue = options.includes(selectedLocality) ? selectedLocality : 'Todas';
      localitySelect.innerHTML = options.map((locality) => `<option value="${locality}">${locality}</option>`).join('');
      localitySelect.value = currentValue;
    }

    const summary = calculateSummary(stations, localitySelect ? localitySelect.value : 'Todas');

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
  document.getElementById('refreshBtn').addEventListener('click', loadSummary);
  localityFilter.addEventListener('change', async () => {
    const select = document.getElementById('localityFilter');
    const selected = select ? select.value : 'Todas';
    try {
      const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      const stations = (payload.ListaEESSPrecio || []).map(normalizeStation);
      renderSummary(calculateSummary(stations, selected));
    } catch (error) {
      console.error('Error al filtrar por localidad', error);
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
  setInterval(checkScheduledAlert, 60000);
});
