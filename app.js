/* ══════════════════════════════════════════
   app.js  –  PesoFlow Tracker main logic
   ══════════════════════════════════════════ */

'use strict';

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 1];

/* ── State (mirrors IndexedDB, kept in memory for speed) ── */
let balance = 0;
let pocket  = 0;
let bills   = {};          // { 1000: 0, 500: 0, … }
DENOMS.forEach(d => bills[d] = 0);

/* ── Chart instance ── */
let spendChart = null;

/* ── Modal action tracker ── */
let currentAction = null;

/* ════════════════════════
   INIT
   ════════════════════════ */
async function init() {
  await initDB();

  /* load saved state */
  balance = await getState('balance', 0);
  pocket  = await getState('pocket', 0);
  const savedBills = await getState('bills', {});
  DENOMS.forEach(d => { bills[d] = savedBills[d] ?? 0; });

  renderBalance();
  renderPocket();
  renderBills();
  await renderTransactions();
  initChart();
  await updateChart();

  /* register service worker */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.warn('SW error', e));
  }
}

/* ════════════════════════
   RENDER HELPERS
   ════════════════════════ */
function fmt(n) {
  return parseFloat(n).toLocaleString('en-PH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function renderBalance() {
  document.getElementById('balance-amount').textContent = fmt(balance);
}

function renderPocket() {
  document.getElementById('pocket-amount').textContent = fmt(pocket);
}

function renderBills() {
  DENOMS.forEach(d => {
    const input = document.getElementById(`d${d}`);
    const sub   = document.getElementById(`s${d}`);
    if (input) input.value = bills[d];
    if (sub)   sub.textContent = '₱' + fmt(bills[d] * d);
  });
}

/* ── Live recalc when user edits bill qty ── */
function recalcPocket() {
  let total = 0;
  DENOMS.forEach(d => {
    const qty = parseInt(document.getElementById(`d${d}`).value) || 0;
    bills[d] = qty < 0 ? 0 : qty;
    document.getElementById(`s${d}`).textContent = '₱' + fmt(bills[d] * d);
    total += bills[d] * d;
  });
  pocket = total;
  renderPocket();
}

async function saveBills() {
  recalcPocket();
  await setState('bills', bills);
  await setState('pocket', pocket);
  showToast('Bills saved ✓');
}

/* ════════════════════════
   TRANSACTIONS UI
   ════════════════════════ */
const TYPE_META = {
  deposit:   { label: 'Deposit',        sign: '+', cls: 'deposit',   color: 'positive' },
  withdraw:  { label: 'Withdraw',       sign: '-', cls: 'withdraw',  color: 'negative' },
  topocket:  { label: 'Move to Pocket', sign: '-', cls: 'topocket',  color: 'negative' },
  addpocket: { label: 'Add to Pocket',  sign: '+', cls: 'addpocket', color: 'positive' },
  spend:     { label: 'Pocket Spend',   sign: '-', cls: 'spend',     color: 'negative' }
};

async function renderTransactions() {
  const list = document.getElementById('txn-list');
  const txns = await getAllTransactions();

  if (!txns.length) {
    list.innerHTML = '<p class="empty-msg">No transactions yet.</p>';
    return;
  }

  list.innerHTML = txns.map(t => {
    const m    = TYPE_META[t.type] || { label: t.type, sign: '', cls: '', color: '' };
    const d    = new Date(t.date);
    const date = d.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
    const time = d.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' });
    return `
      <div class="txn-item ${m.cls}">
        <div>
          <div class="txn-label">${m.label}${t.note ? ' – ' + t.note : ''}</div>
          <div class="txn-date">${date} ${time}</div>
        </div>
        <div class="txn-amount ${m.color}">${m.sign}₱${fmt(t.amount)}</div>
      </div>`;
  }).join('');
}

async function clearTransactions() {
  if (!confirm('Clear all transaction history?')) return;
  await clearAllTransactions();
  await renderTransactions();
  await updateChart();
}

/* ════════════════════════
   MODAL
   ════════════════════════ */
const MODAL_TITLES = {
  deposit:   '💵 Deposit to Savings',
  withdraw:  '💸 Withdraw from Savings',
  topocket:  '👛 Move Savings → Pocket',
  addpocket: '➕ Add Cash to Pocket',
  spend:     '🛒 Record Pocket Spend'
};

function openModal(action) {
  currentAction = action;
  document.getElementById('modal-title').textContent = MODAL_TITLES[action] || 'Enter Amount';
  document.getElementById('modal-input').value = '';
  document.getElementById('modal-error').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-input').focus(), 80);
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModalDirect();
}

function closeModalDirect() {
  document.getElementById('modal-overlay').classList.add('hidden');
  currentAction = null;
}

async function confirmModal() {
  const raw = parseFloat(document.getElementById('modal-input').value);
  const err = document.getElementById('modal-error');

  if (!raw || raw <= 0) { err.classList.remove('hidden'); return; }

  const amt = Math.round(raw * 100) / 100;
  err.classList.add('hidden');

  switch (currentAction) {

    case 'deposit':
      balance += amt;
      await setState('balance', balance);
      await addTransaction('deposit', amt);
      renderBalance();
      break;

    case 'withdraw':
      if (amt > balance) { err.textContent = 'Insufficient savings balance.'; err.classList.remove('hidden'); return; }
      balance -= amt;
      await setState('balance', balance);
      await addTransaction('withdraw', amt);
      renderBalance();
      break;

    case 'topocket':
      if (amt > balance) { err.textContent = 'Insufficient savings balance.'; err.classList.remove('hidden'); return; }
      balance -= amt;
      pocket  += amt;
      await setState('balance', balance);
      await setState('pocket', pocket);
      await addTransaction('topocket', amt);
      renderBalance();
      renderPocket();
      break;

    case 'addpocket':
      pocket += amt;
      await setState('pocket', pocket);
      await addTransaction('addpocket', amt);
      renderPocket();
      break;

    case 'spend':
      if (amt > pocket) { err.textContent = 'Insufficient pocket money.'; err.classList.remove('hidden'); return; }
      pocket -= amt;
      await setState('pocket', pocket);
      await addTransaction('spend', amt);
      renderPocket();
      await updateChart();
      break;
  }

  await renderTransactions();
  closeModalDirect();
  showToast('Done ✓');
}

/* Enter key confirms modal */
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && currentAction) confirmModal();
  if (e.key === 'Escape' && currentAction) closeModalDirect();
});

/* ════════════════════════
   CHART
   ════════════════════════ */
function initChart() {
  const ctx = document.getElementById('spendChart').getContext('2d');
  spendChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [{
      label: 'Pocket Spend (₱)',
      data: [],
      backgroundColor: 'rgba(231, 76, 60, 0.7)',
      borderColor:     'rgba(231, 76, 60, 1)',
      borderWidth: 1,
      borderRadius: 6,
    }]},
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => '₱' + fmt(ctx.parsed.y)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => '₱' + v.toLocaleString()
          }
        },
        x: {
          ticks: { font: { size: 10 } }
        }
      }
    }
  });
}

async function updateChart() {
  const spends = await getSpendHistory(14);
  const labels = spends.map(s => {
    const d = new Date(s.date);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  });
  const data = spends.map(s => s.amount);

  spendChart.data.labels  = labels;
  spendChart.data.datasets[0].data = data;
  spendChart.update();
}

/* ════════════════════════
   TOAST
   ════════════════════════ */
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:#2c3e50; color:#fff; padding:10px 22px;
      border-radius:24px; font-size:0.9rem; font-weight:600;
      box-shadow:0 4px 16px rgba(0,0,0,0.25); z-index:999;
      opacity:0; transition:opacity 0.3s;
    `;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.style.opacity = '0', 2000);
}

/* ── Start ── */
init();