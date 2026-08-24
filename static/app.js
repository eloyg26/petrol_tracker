const API_URL = '/api/summary';

const state = {
  summary: null,
};

function formatEuro(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(3).replace('.', ',')} €/L`;
}

function getDeltaClass(delta) {
  if (delta > 0) return 'negative';
  if (delta < 0) return 'positive';
  return '';
}

function renderSummary(summary) {
  if (!summary) return;

  const delta95El = document.querySelector('#delta95Text');
  const deltaDieselEl = document.querySelector('#deltaDieselText');

  document.querySelector('#updatedAt').textContent = summary.updated_at || '—';
  document.querySelector('#average95').textContent = formatEuro(summary.average_95);
  document.querySelector('#averageDiesel').textContent = formatEuro(summary.average_diesel);

  const delta95Text = summary.delta_95 === 0 ? 'Sin cambio respecto a ayer' : `${summary.delta_95 > 0 ? 'Sube' : 'Baja'} ${Math.abs(summary.delta_95).toFixed(3).replace('.', ',')} €/L`;
  delta95El.textContent = delta95Text;
  delta95El.className = getDeltaClass(summary.delta_95);

  const deltaDieselText = summary.delta_diesel === 0 ? 'Sin cambio respecto a ayer' : `${summary.delta_diesel > 0 ? 'Sube' : 'Baja'} ${Math.abs(summary.delta_diesel).toFixed(3).replace('.', ',')} €/L`;
  deltaDieselEl.textContent = deltaDieselText;
  deltaDieselEl.className = getDeltaClass(summary.delta_diesel);

  const tbody = document.querySelector('#cheapestTable');
  tbody.innerHTML = '';

  const stations = [...(summary.top_95 || []), ...(summary.top_diesel || [])];
  const uniqueStations = new Map();
  const rows = [];

  stations.forEach((station) => {
    const key = `${station.name}-${station.locality}`;
    if (!uniqueStations.has(key)) {
      uniqueStations.set(key, { ...station });
    }
  });

  const ordered = [...uniqueStations.values()].sort((a, b) => {
    const aPrice = a.gasolina95 ?? 99;
    const bPrice = b.gasolina95 ?? 99;
    return aPrice - bPrice;
  }).slice(0, 8);

  ordered.forEach((station) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${station.name || 'Estación'}</td>
      <td>${station.locality || '-'}</td>
      <td>${formatEuro(station.gasolina95)}</td>
      <td>${formatEuro(station.diesel)}</td>
    `;
    tbody.appendChild(tr);
  });

}

async function loadSummary() {
  try {
    const response = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error('No se pudo cargar el resumen');
    }
    const data = await response.json();
    state.summary = data;
    renderSummary(data);
  } catch (error) {
    console.error(error);
    document.querySelector('#subscriptionStatus').textContent = 'No se pudo recuperar la información del servicio en este momento.';
  }
}

async function handleSubscription(event) {
  event.preventDefault();
  const email = document.querySelector('#emailInput').value.trim();
  const fuel = document.querySelector('#fuelSelect').value;
  const province = document.querySelector('#provinceInput').value.trim() || 'A Coruña';

  const response = await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, fuel, province }),
  });

  const result = await response.json();
  const status = document.querySelector('#subscriptionStatus');
  status.textContent = result.message || 'Suscripción actualizada';
  if (result.ok) {
    status.classList.add('positive');
    status.classList.remove('negative');
    document.querySelector('#subscriptionForm').reset();
    document.querySelector('#provinceInput').value = 'A Coruña';
  } else {
    status.classList.add('negative');
    status.classList.remove('positive');
  }
}

document.querySelector('#refreshBtn').addEventListener('click', loadSummary);
document.querySelector('#subscriptionForm').addEventListener('submit', handleSubscription);
window.addEventListener('DOMContentLoaded', loadSummary);
