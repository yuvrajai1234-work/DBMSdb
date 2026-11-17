import { api } from './api.js';
import {
  addDaysInput,
  barChart,
  closeDrawer,
  debounce,
  emptyState,
  esc,
  fmtDate,
  fmtDateTime,
  icon,
  money,
  openDrawer,
  priorityBadge,
  statCard,
  statusBadge,
  subtypeBadge,
  toast,
} from './ui.js';
import { App } from './app.js';

const ref = (id) => `#${String(id).padStart(4, '0')}`;
const PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];

/* ------------------------------ dashboard ---------------------------- */
export async function OfficialDashboard(mount) {
  const data = await api('/api/official/overview');
  const { profile, stats, byIssue, byPriority, overdue, recent, wards, budget } = data;

  const priorityRows = PRIORITY_ORDER.map((label) => ({
    label,
    count: byPriority.find((row) => row.label === label)?.count || 0,
  }));

  mount.innerHTML = `
    <div class="page">
      <section class="card" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;background:
        radial-gradient(620px 240px at 92% -30%, rgba(255,198,92,.12), transparent 70%),
        linear-gradient(180deg, rgba(17,26,43,.7), rgba(12,18,32,.92));">
        <div style="flex:1;min-width:260px">
          <div class="mono">${esc(profile.designation)} · ${esc(profile.district)}</div>
          <h2 style="font-size:25px;font-weight:500;margin-top:8px">${esc(profile.divName)} division</h2>
          <p class="muted" style="margin-top:6px;font-size:13.5px">
            ${stats.total === 0
              ? 'No faults reported yet. Add pole inventory so citizens can report.'
              : `${stats.awaitingDispatch} ticket${stats.awaitingDispatch === 1 ? '' : 's'} still need a contractor, ${stats.overdue} work order${stats.overdue === 1 ? '' : 's'} past target.`}
          </p>
        </div>
        <div class="row wrap">
          <button class="btn btn-primary" data-action="queue">${icon('list', 15)} Open queue</button>
          <button class="btn btn-ghost" data-action="inventory">${icon('bolt', 15)} Assets</button>
        </div>
      </section>

      <div class="stat-grid">
        ${statCard({ label: 'Open tickets', value: stats.open, foot: 'Not yet dispatched', tone: 'amber' })}
        ${statCard({ label: 'In progress', value: stats.inProgress, foot: 'Contractor assigned', tone: 'blue' })}
        ${statCard({ label: 'Resolved', value: stats.resolved, foot: 'Closed to audit trail', tone: 'green' })}
        ${statCard({ label: 'Past target', value: stats.overdue, foot: 'Work orders overdue', tone: 'red' })}
      </div>

      ${
        stats.poles === 0
          ? `<div class="callout">${icon('alert', 14)} <strong>No light poles inventoried.</strong>
               Citizens cannot file a report until you register poles for this division.</div>`
          : ''
      }

      <div class="grid-2">
        <section class="card">
          <div class="card-head">
            <div><h3>Fault mix</h3><div class="sub">All complaints by issue type</div></div>
          </div>
          ${barChart(byIssue, { empty: 'No complaints recorded yet.' })}
        </section>
        <section class="card">
          <div class="card-head">
            <div><h3>Open load by priority</h3><div class="sub">Tickets not yet resolved</div></div>
          </div>
          ${barChart(priorityRows, { empty: 'No open tickets.' })}
        </section>
      </div>

      <div class="grid-side">
        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>Latest faults</h3><div class="sub">Highest priority first in the queue</div></div>
              <span class="spacer"></span>
              <button class="btn btn-ghost btn-sm" data-action="queue">Queue</button>
            </div>
            ${
              recent.length
                ? `<div class="table-wrap"><table class="data">
                     <thead><tr><th>Ticket</th><th>Pole</th><th>Fault</th><th>Priority</th><th>Status</th><th>Filed</th></tr></thead>
                     <tbody>${recent
                       .map(
                         (item) => `
                         <tr data-complaint="${item.complaintId}">
                           <td class="mono-cell">${ref(item.complaintId)}</td>
                           <td><span class="pole-ref ${item.isHighRisk ? 'risk' : ''}"><span class="lamp"></span>${esc(
                             item.poleName,
                           )}</span></td>
                           <td>${esc(item.issueType)}</td>
                           <td>${priorityBadge(item.priority)}</td>
                           <td>${statusBadge(item.status)}</td>
                           <td class="mono-cell">${fmtDate(item.createdAt)}</td>
                         </tr>`,
                       )
                       .join('')}</tbody>
                   </table></div>`
                : emptyState({
                    title: 'Queue is empty',
                    body: 'Citizen reports will appear here the moment they are filed in your division.',
                  })
            }
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h3>Work order repair budget</h3>
                <div class="sub">Total repair budget &amp; contractor allocation</div>
              </div>
              <span class="spacer"></span>
              <div style="text-align:right">
                <div class="mono" style="font-size:11px;color:var(--muted)">TOTAL REPAIR BUDGET</div>
                <div style="font-size:19px;font-weight:700;color:var(--amber);font-family:var(--mono);margin-top:2px">
                  ${money(budget?.totalBudget || 0)}
                </div>
              </div>
            </div>
            ${
              budget?.vendors?.length
                ? `<div class="table-wrap">
                     <table class="data">
                       <thead>
                         <tr>
                           <th>Vendor</th>
                           <th>Service specialization</th>
                           <th style="text-align:center">Orders</th>
                           <th style="text-align:right">Total budget issued</th>
                         </tr>
                       </thead>
                       <tbody>
                         ${budget.vendors
                           .map(
                             (v) => `
                             <tr>
                               <td><strong>${esc(v.vendorName)}</strong></td>
                               <td class="dim" style="font-size:12px">${esc(v.serviceType)}</td>
                               <td style="text-align:center"><span class="badge ${v.orderCount ? 'progress' : 'low'}">${v.orderCount} order${v.orderCount === 1 ? '' : 's'}</span></td>
                               <td class="mono-cell" style="text-align:right;font-weight:600;color:var(--amber)">${money(v.totalBudget)}</td>
                             </tr>`,
                           )
                           .join('')}
                       </tbody>
                     </table>
                   </div>`
                : '<div class="dim tiny">No work orders issued yet in this division.</div>'
            }
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card-head"><div><h3>Division assets</h3><div class="sub">Live inventory counts</div></div></div>
            <div class="kv-grid">
              <div class="kv"><label>Light poles</label><b style="font-size:17px">${stats.poles}</b></div>
              <div class="kv"><label>High risk</label><b style="font-size:17px;color:${stats.highRisk ? 'var(--red)' : 'inherit'}">${stats.highRisk}</b></div>
              <div class="kv"><label>Ward councils</label><b style="font-size:17px">${stats.wards}</b></div>
              <div class="kv"><label>Citizens</label><b style="font-size:17px">${stats.citizens}</b></div>
            </div>
            <button class="btn btn-ghost btn-sm btn-block" style="margin-top:16px" data-action="inventory">
              Manage inventory
            </button>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Overdue work orders</h3><div class="sub">Past target completion</div></div></div>
            ${
              overdue.length
                ? `<div class="list">${overdue
                    .map(
                      (item) => `
                      <div class="list-row" data-complaint="${item.complaintId}">
                        <div style="min-width:0">
                          <div class="list-title">${esc(item.poleName)}</div>
                          <div class="list-meta">${esc(item.vendorName || 'Unassigned')} · issued ${fmtDate(
                            item.issuedDate,
                          )}</div>
                        </div>
                        <div class="tail"><span class="badge overdue">${item.daysOverdue}d late</span></div>
                      </div>`,
                    )
                    .join('')}</div>`
                : '<div class="dim tiny">Every dispatched repair is inside its target date.</div>'
            }
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Ward load</h3><div class="sub">Open tickets per ward</div></div></div>
            ${
              wards.length
                ? `<div class="list">${wards
                    .map(
                      (ward) => `
                      <div class="list-row" style="cursor:default">
                        <div style="min-width:0">
                          <div class="list-title">${esc(ward.wardName)}</div>
                          <div class="list-meta">${ward.citizenCount} citizen${
                            ward.citizenCount === 1 ? '' : 's'
                          } registered</div>
                        </div>
                        <div class="tail"><span class="badge ${ward.openCount ? 'open' : 'low'}">${
                          ward.openCount
                        } open</span></div>
                      </div>`,
                    )
                    .join('')}</div>`
                : '<div class="dim tiny">No ward councils registered yet.</div>'
            }
          </section>
        </div>
      </div>
    </div>`;

  mount.querySelectorAll('[data-complaint]').forEach((row) => {
    row.addEventListener('click', () =>
      openOfficialComplaint(Number(row.dataset.complaint), () => App.render()),
    );
  });
  mount.querySelectorAll('[data-action="queue"]').forEach((button) =>
    button.addEventListener('click', () => App.navigate('/official/queue')),
  );
  mount.querySelectorAll('[data-action="inventory"]').forEach((button) =>
    button.addEventListener('click', () => App.navigate('/official/inventory')),
  );
}

/* -------------------------------- queue ------------------------------ */
export async function OfficialQueue(mount) {
  const state = { status: '', priority: '', dispatch: '', search: '' };

  mount.innerHTML = `
    <div class="page">
      <section class="card">
        <div class="card-head">
          <div>
            <h3>Complaint queue</h3>
            <div class="sub">Triage, dispatch and close fault tickets</div>
          </div>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" data-action="refresh">${icon('clock', 14)} Refresh</button>
        </div>

        <div class="filter-bar">
          <div class="chips" id="status-chips">
            ${['Active queue', 'Open', 'In Progress', 'Closed']
              .map(
                (label) =>
                  `<button class="chip ${label === 'Active queue' ? 'active' : ''}" data-status="${
                    label === 'Active queue' ? '' : label
                  }">${label}</button>`,
              )
              .join('')}
          </div>
          <select class="input" id="priority-filter" style="width:auto">
            <option value="">Any priority</option>
            ${PRIORITY_ORDER.map((priority) => `<option value="${priority}">${priority}</option>`).join('')}
          </select>
          <select class="input" id="dispatch-filter" style="width:auto">
            <option value="">All tickets</option>
            <option value="unassigned">Awaiting dispatch</option>
            <option value="overdue">Overdue only</option>
          </select>
          <span class="spacer"></span>
          <div class="search-input">
            ${icon('search', 14)}
            <input class="input" id="queue-search" placeholder="Pole, fault, citizen or ward" />
          </div>
        </div>

        <div id="queue-results"></div>
      </section>
    </div>`;

  const results = mount.querySelector('#queue-results');

  const load = async () => {
    results.innerHTML = '<div class="dim tiny" style="padding:14px 0">Loading queue…</div>';
    const params = new URLSearchParams();
    if (state.status) params.set('status', state.status);
    if (state.priority) params.set('priority', state.priority);
    if (state.dispatch) params.set('dispatch', state.dispatch);
    if (state.search) params.set('search', state.search);
    try {
      const { complaints } = await api(`/api/official/complaints?${params.toString()}`);
      renderQueue(results, complaints, load);
    } catch (error) {
      results.innerHTML = `<div class="form-error">${esc(error.message)}</div>`;
    }
  };

  mount.querySelectorAll('[data-status]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.status = chip.dataset.status;
      mount.querySelectorAll('[data-status]').forEach((item) => item.classList.toggle('active', item === chip));
      load();
    });
  });
  mount.querySelector('#priority-filter').addEventListener('change', (event) => {
    state.priority = event.target.value;
    load();
  });
  mount.querySelector('#dispatch-filter').addEventListener('change', (event) => {
    state.dispatch = event.target.value;
    load();
  });
  mount
    .querySelector('#queue-search')
    .addEventListener('input', debounce((event) => {
      state.search = event.target.value.trim();
      load();
    }, 220));
  mount.querySelector('[data-action="refresh"]').addEventListener('click', load);

  await load();
}

function renderQueue(container, complaints, reload) {
  if (!complaints.length) {
    container.innerHTML = emptyState({
      title: 'Nothing in this view',
      body: 'No complaints match the current filters for your division.',
    });
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Ticket</th><th>Pole</th><th>Citizen · ward</th><th>Fault</th>
            <th>Priority</th><th>Status</th><th>Dispatch</th><th>Filed</th>
          </tr>
        </thead>
        <tbody>
          ${complaints
            .map(
              (item) => `
              <tr data-complaint="${item.complaintId}">
                <td class="mono-cell">${ref(item.complaintId)}</td>
                <td><span class="pole-ref ${item.isHighRisk ? 'risk' : ''}"><span class="lamp"></span>${esc(
                  item.poleName,
                )}</span></td>
                <td>${esc(item.citizenName)}<div class="list-meta">${esc(item.wardName)}</div></td>
                <td>${esc(item.issueType)}</td>
                <td>${priorityBadge(item.priority)}</td>
                <td>${statusBadge(item.status)}</td>
                <td class="mono-cell">${
                  item.workOrderId
                    ? `${esc(item.vendorName)}${
                        item.daysOverdue > 0
                          ? ` <span class="badge overdue">${item.daysOverdue}d late</span>`
                          : ''
                      }`
                    : '<span class="badge low plain">Unassigned</span>'
                }</td>
                <td class="mono-cell">${fmtDate(item.createdAt)}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('tr[data-complaint]').forEach((row) => {
    row.addEventListener('click', () => openOfficialComplaint(Number(row.dataset.complaint), reload));
  });
}

/* ----------------------------- work orders --------------------------- */
export async function OfficialWorkOrders(mount) {
  let state = '';

  mount.innerHTML = `
    <div class="page">
      <section class="card">
        <div class="card-head">
          <div>
            <h3>Work orders</h3>
            <div class="sub">Contractor assignments triggered by complaints</div>
          </div>
          <span class="spacer"></span>
          <div class="seg" id="wo-seg">
            <button data-state="" class="active">All</button>
            <button data-state="active">Open repairs</button>
            <button data-state="overdue">Overdue</button>
            <button data-state="done">Completed</button>
          </div>
        </div>
        <div id="wo-results"></div>
      </section>
    </div>`;

  const results = mount.querySelector('#wo-results');

  let vendors = [];
  try {
    const res = await api('/api/vendors');
    vendors = res.vendors || [];
  } catch (_) {}

  const load = async () => {
    results.innerHTML = '<div class="dim tiny" style="padding:14px 0">Loading work orders…</div>';
    try {
      const { workOrders } = await api(
        `/api/official/work-orders${state ? `?state=${encodeURIComponent(state)}` : ''}`,
      );
      renderWorkOrders(results, workOrders, load, vendors);
    } catch (error) {
      results.innerHTML = `<div class="form-error">${esc(error.message)}</div>`;
    }
  };

  mount.querySelectorAll('#wo-seg button').forEach((button) => {
    button.addEventListener('click', () => {
      state = button.dataset.state;
      mount.querySelectorAll('#wo-seg button').forEach((item) => item.classList.toggle('active', item === button));
      load();
    });
  });

  await load();
}

function renderWorkOrders(container, rows, reload, vendors = []) {
  if (!rows.length) {
    container.innerHTML = emptyState({
      title: 'No work orders here',
      body: 'Work orders are automatically issued when tickets are raised.',
    });
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Work Order</th><th>Pole</th><th>Priority</th><th>Fault</th><th>Vendor</th>
            <th>Est. cost</th><th>Issued</th><th>Completed</th><th>Status</th><th style="text-align:right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (item) => {
                const isClosed = item.status === 'Closed' || item.status === 'Resolved';
                const isOpen = item.status === 'Open';

                return `
                <tr data-wo-row="${item.workOrderId}" data-complaint-id="${item.complaintId}">
                  <td class="mono-cell" data-complaint="${item.complaintId}" style="cursor:pointer;color:var(--amber)" title="Click to view ticket file">WO-${String(item.workOrderId).padStart(4, '0')}</td>
                  <td><span class="pole-ref ${item.isHighRisk ? 'risk' : ''}"><span class="lamp"></span>${esc(
                    item.poleName,
                  )}</span></td>
                  <td>${priorityBadge(item.priority)}</td>
                  <td>${esc(item.fault || item.issueType)}</td>
                  <td>
                    ${
                      isClosed
                        ? `<span>${esc(item.vendorName)}</span>`
                        : `<select class="input input-sm wo-vendor-select" style="width:auto;min-width:170px;font-size:12px;padding:4px 8px">
                             <option value="">Select vendor</option>
                             ${vendors
                               .map(
                                 (v) =>
                                   `<option value="${v.vendorId}" ${
                                     item.vendorId === v.vendorId ? 'selected' : ''
                                   }>${esc(v.vendorName)}</option>`,
                               )
                               .join('')}
                           </select>`
                    }
                  </td>
                  <td>
                    ${
                      isClosed
                        ? `<span class="mono-cell">${money(item.estCost)}</span>`
                        : `<div style="display:flex;align-items:center;gap:3px">
                             <span class="dim" style="font-size:12px">₹</span>
                             <input type="number" min="0" step="0.01" class="input input-sm wo-cost-input" value="${
                               item.estCost ?? 0
                             }" style="width:85px;font-size:12px;padding:4px 6px;text-align:right" />
                           </div>`
                    }
                  </td>
                  <td class="mono-cell">${fmtDate(item.issuedDate)}</td>
                  <td class="mono-cell">
                    ${
                      isClosed
                        ? (item.completedDate ? fmtDate(item.completedDate) : '<span class="dim">—</span>')
                        : isOpen
                        ? `<div style="display:inline-flex;align-items:center;gap:4px">
                             <span style="color:var(--amber);font-size:11px;font-weight:600" title="Target completion date">(Target)</span>
                             <input type="date" class="input input-sm wo-date-input" value="${
                               item.targetDate ? String(item.targetDate).slice(0, 10) : ''
                             }" style="width:130px;font-size:12px;padding:3px 6px" title="Optional completion date target" />
                           </div>`
                        : item.targetDate
                        ? `<span style="color:var(--amber);font-size:11px;font-weight:600;margin-right:4px">(Target)</span>${fmtDate(item.targetDate)}${
                            item.daysOverdue > 0 ? ` <span class="badge overdue">${item.daysOverdue}d late</span>` : ''
                          }`
                        : '<span class="dim">—</span>'
                    }
                  </td>
                  <td>${statusBadge(item.status)}</td>
                  <td style="text-align:right;white-space:nowrap">
                    ${
                      isClosed
                        ? '<span class="badge resolved">Closed</span>'
                        : isOpen
                        ? `<button class="btn btn-sm btn-primary" data-start="${item.workOrderId}">Start</button>
                           <button class="btn btn-sm" disabled style="opacity:0.4;cursor:not-allowed;margin-left:6px" title="Click Start first">Mark complete</button>`
                        : `<button class="btn btn-sm btn-primary" data-complete="${item.workOrderId}">Mark complete</button>`
                    }
                  </td>
                </tr>`;
              },
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-start]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = Number(button.dataset.start);
      const tr = button.closest('tr');
      const vendorSelect = tr.querySelector('.wo-vendor-select');
      const costInput = tr.querySelector('.wo-cost-input');
      const dateInput = tr.querySelector('.wo-date-input');
      const vendorId = vendorSelect && vendorSelect.value ? Number(vendorSelect.value) : null;
      const estCost = costInput && costInput.value !== '' ? Number(costInput.value) : 0;
      const targetDate = dateInput && dateInput.value ? dateInput.value : null;
      if (!vendorId) {
        toast('Please select a vendor from the dropdown before starting the repair.', 'error');
        if (vendorSelect) vendorSelect.focus();
        return;
      }
      button.disabled = true;
      try {
        await api(`/api/official/work-orders/${id}/start`, {
          method: 'PATCH',
          body: { vendorId, estCost, targetDate },
        });
        toast('Work order started. Status is now In Progress.', 'success');
        await reload();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  });

  container.querySelectorAll('[data-complete]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = Number(button.dataset.complete);
      if (!window.confirm('Mark this repair complete and close the ticket?')) return;
      button.disabled = true;
      try {
        await api(`/api/official/work-orders/${id}/complete`, { method: 'PATCH' });
        toast('Repair closed. Ticket status is now Closed and removed from active queue.', 'success');
        await reload();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  });

  // When vendor or cost changes on an in-progress row, update it
  container.querySelectorAll('tr[data-wo-row]').forEach((tr) => {
    const woId = Number(tr.dataset.woRow);
    const vendorSelect = tr.querySelector('.wo-vendor-select');
    const costInput = tr.querySelector('.wo-cost-input');
    const dateInput = tr.querySelector('.wo-date-input');

    const saveChanges = async () => {
      const vendorId = vendorSelect && vendorSelect.value ? Number(vendorSelect.value) : null;
      const estCost = costInput && costInput.value !== '' ? Number(costInput.value) : null;
      const targetDate = dateInput && dateInput.value ? dateInput.value : null;
      try {
        await api(`/api/official/work-orders/${woId}/update`, {
          method: 'PATCH',
          body: { vendorId, estCost, targetDate },
        });
        toast('Work order updated.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };

    if (vendorSelect) vendorSelect.addEventListener('change', saveChanges);
    if (costInput) costInput.addEventListener('change', saveChanges);
    if (dateInput) dateInput.addEventListener('change', saveChanges);
  });

  container.querySelectorAll('[data-complaint]').forEach((cell) => {
    cell.addEventListener('click', () => openOfficialComplaint(Number(cell.dataset.complaint), reload));
  });
}

/* ------------------------------ inventory ---------------------------- */
export async function OfficialInventory(mount) {
  const state = { search: '', subtype: '', risk: '' };

  mount.innerHTML = `
    <div class="page">
      <section class="card">
        <div class="card-head">
          <div>
            <h3>Register a light pole</h3>
            <div class="sub">Master asset inventory · SolarLightPoles / ElectricalLightPoles subtypes</div>
          </div>
        </div>
        <form id="pole-form" novalidate>
          <div class="form-grid">
            <div class="field">
              <label for="pole-name">Pole name</label>
              <input id="pole-name" name="poleName" placeholder="e.g. P-BLR-101" maxlength="50" required />
            </div>
            <div class="field">
              <label for="pole-subtype">Power subtype</label>
              <select id="pole-subtype" name="subtype">
                <option value="Electrical">Electrical (grid)</option>
                <option value="Solar">Solar</option>
              </select>
            </div>
            <div class="field">
              <label for="pole-lat">Latitude</label>
              <input id="pole-lat" name="latitude" type="number" step="0.00000001" min="-90" max="90" placeholder="12.97159900" />
            </div>
            <div class="field">
              <label for="pole-lng">Longitude</label>
              <input id="pole-lng" name="longitude" type="number" step="0.00000001" min="-180" max="180" placeholder="77.59456600" />
            </div>

            <div class="field span-2">
              <label style="display:flex;align-items:center;gap:9px;text-transform:none;letter-spacing:0;font-family:var(--sans);font-size:13px;color:var(--text)">
                <input id="high-risk" name="isHighRisk" type="checkbox" style="width:16px;height:16px;accent-color:var(--amber)" />
                Flag as high risk (unsafe location, repeated faults, exposed wiring)
              </label>
            </div>
          </div>
          <div id="pole-error" class="form-error" style="margin-top:14px" hidden></div>
          <button class="btn btn-primary" type="submit" style="margin-top:16px">${icon('plus', 15)} Add pole to inventory</button>
        </form>
      </section>

      <section class="card">
        <div class="card-head">
          <div><h3>Asset inventory</h3><div class="sub">Poles in your division</div></div>
          <span class="spacer"></span>
          <div class="filter-bar" style="margin:0">
            <div class="search-input">${icon('search', 14)}
              <input class="input" id="pole-search" placeholder="Search pole or circuit" />
            </div>
            <select class="input" id="subtype-filter" style="width:auto">
              <option value="">All subtypes</option>
              <option value="Solar">Solar only</option>
              <option value="Electrical">Electrical only</option>
            </select>
            <select class="input" id="risk-filter" style="width:auto">
              <option value="">Any risk</option>
              <option value="high">High risk</option>
            </select>
          </div>
        </div>
        <div id="pole-results"></div>
      </section>
    </div>`;

  const form = mount.querySelector('#pole-form');
  const subtype = form.querySelector('#pole-subtype');
  const errorBox = form.querySelector('#pole-error');
  const results = mount.querySelector('#pole-results');

  const load = async () => {
    results.innerHTML = '<div class="dim tiny" style="padding:14px 0">Loading inventory…</div>';
    const params = new URLSearchParams();
    if (state.search) params.set('search', state.search);
    if (state.subtype) params.set('subtype', state.subtype);
    if (state.risk) params.set('risk', state.risk);
    try {
      const { poles } = await api(`/api/official/poles?${params.toString()}`);
      renderPoles(results, poles, load);
    } catch (error) {
      results.innerHTML = `<div class="form-error">${esc(error.message)}</div>`;
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const data = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/official/poles', {
        method: 'POST',
        body: {
          poleName: String(data.get('poleName') || '').trim(),
          subtype: subtype.value,
          latitude: String(data.get('latitude') || '').trim(),
          longitude: String(data.get('longitude') || '').trim(),
          isHighRisk: form.querySelector('#high-risk').checked,
        },
      });
      toast('Pole added to the inventory.', 'success');
      form.reset();
      await load();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  mount.querySelector('#pole-search').addEventListener(
    'input',
    debounce((event) => {
      state.search = event.target.value.trim();
      load();
    }, 220),
  );
  mount.querySelector('#subtype-filter').addEventListener('change', (event) => {
    state.subtype = event.target.value;
    load();
  });
  mount.querySelector('#risk-filter').addEventListener('change', (event) => {
    state.risk = event.target.value;
    load();
  });

  await load();
}

function renderPoles(container, poles, reload) {
  if (!poles.length) {
    container.innerHTML = emptyState({
      title: 'No poles here yet',
      body: 'Add the first street light to the inventory. Citizens can only report poles that exist in your division.',
    });
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Pole</th><th>Subtype</th><th>Coordinates</th>
            <th>Risk</th><th>Tickets</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${poles
            .map(
              (pole) => `
              <tr>
                <td><span class="pole-ref ${pole.isHighRisk ? 'risk' : ''}"><span class="lamp"></span>${esc(
                  pole.poleName,
                )}</span></td>
                <td>${subtypeBadge(pole.subtype)}</td>
                <td class="mono-cell">${
                  pole.latitude !== null && pole.longitude !== null
                    ? `${Number(pole.latitude).toFixed(4)}, ${Number(pole.longitude).toFixed(4)}`
                    : '<span class="dim">—</span>'
                }</td>
                <td>${
                  pole.isHighRisk
                    ? '<span class="badge critical">High risk</span>'
                    : '<span class="badge low plain">Standard</span>'
                }</td>
                <td class="mono-cell">${pole.complaintCount} total${
                  pole.openCount ? ` · <span style="color:var(--amber)">${pole.openCount} open</span>` : ''
                }</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-sm btn-ghost" data-edit="${pole.poleId}" style="margin-right:6px">Edit</button>
                  <button class="btn btn-sm btn-danger" data-delete="${pole.poleId}" data-name="${esc(
                    pole.poleName,
                  )}">Remove</button>
                </td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const pole = poles.find((item) => item.poleId === Number(button.dataset.edit));
      if (!pole) return;

      const body = openDrawer({
        title: 'Edit light pole',
        kicker: `POLE-${String(pole.poleId).padStart(4, '0')}`,
        body: `
          <form id="pole-edit" novalidate>
            <div class="field">
              <label for="edit-pole-name">Pole name</label>
              <input id="edit-pole-name" name="poleName" maxlength="50" required />
            </div>
            <div class="field" style="margin-top:12px">
              <label for="edit-pole-subtype">Power subtype</label>
              <select id="edit-pole-subtype" name="subtype">
                <option value="Electrical">Electrical (grid)</option>
                <option value="Solar">Solar</option>
              </select>
            </div>
            <div class="form-grid" style="margin-top:12px">
              <div class="field">
                <label for="edit-pole-lat">Latitude</label>
                <input id="edit-pole-lat" name="latitude" type="number" step="0.00000001" min="-90" max="90" />
              </div>
              <div class="field">
                <label for="edit-pole-lng">Longitude</label>
                <input id="edit-pole-lng" name="longitude" type="number" step="0.00000001" min="-180" max="180" />
              </div>
            </div>
            <div class="field" style="margin-top:12px">
              <label class="checkbox">
                <input type="checkbox" id="edit-high-risk" name="isHighRisk" />
                <span>Mark as high risk (near junctions, schools, water bodies)</span>
              </label>
            </div>
            <div id="edit-error" class="form-error" style="margin-top:12px" hidden></div>
            <div class="drawer-actions" style="margin-top:18px">
              <button class="btn btn-primary" type="submit">Save changes</button>
              <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
            </div>
          </form>`,
      });

      const editForm = body.querySelector('#pole-edit');
      const errorBox = body.querySelector('#edit-error');
      const subtypeSelect = body.querySelector('#edit-pole-subtype');

      editForm.querySelector('#edit-pole-name').value = pole.poleName;
      subtypeSelect.value = pole.subtype;
      if (pole.latitude !== null) editForm.querySelector('#edit-pole-lat').value = pole.latitude;
      if (pole.longitude !== null) editForm.querySelector('#edit-pole-lng').value = pole.longitude;
      editForm.querySelector('#edit-high-risk').checked = !!pole.isHighRisk;

      body.querySelector('[data-cancel]').addEventListener('click', closeDrawer);

      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        const fieldData = new FormData(editForm);
        const submitBtn = editForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;

        try {
          await api(`/api/official/poles/${pole.poleId}`, {
            method: 'PATCH',
            body: {
              poleName: String(fieldData.get('poleName') || '').trim(),
              subtype: subtypeSelect.value,
              latitude: String(fieldData.get('latitude') || '').trim(),
              longitude: String(fieldData.get('longitude') || '').trim(),
              isHighRisk: editForm.querySelector('#edit-high-risk').checked,
            },
          });
          toast('Light pole updated.', 'success');
          closeDrawer();
          await reload();
        } catch (err) {
          errorBox.textContent = err.message;
          errorBox.hidden = false;
          submitBtn.disabled = false;
        }
      });
    });
  });

  container.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const name = button.dataset.name;
      if (!window.confirm(`Remove ${name} from the inventory? This cannot be undone.`)) return;
      button.disabled = true;
      try {
        await api(`/api/official/poles/${button.dataset.delete}`, { method: 'DELETE' });
        toast(`${name} removed from the inventory.`, 'success');
        await reload();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  });
}

/* -------------------------------- wards ------------------------------ */
export async function OfficialWards(mount) {
  mount.innerHTML = `
    <div class="page">
      <section class="card">
        <div class="card-head">
          <div>
            <h3>Ward councils</h3>
            <div class="sub">Wards provisioned for your division by the system developer</div>
          </div>
        </div>
        <div id="ward-results"></div>
      </section>
    </div>`;

  const results = mount.querySelector('#ward-results');

  const load = async () => {
    results.innerHTML = '<div class="dim tiny" style="padding:14px 0">Loading wards…</div>';
    try {
      const { wards } = await api('/api/official/wards');
      renderWards(results, wards, load);
    } catch (error) {
      results.innerHTML = `<div class="form-error">${esc(error.message)}</div>`;
    }
  };

  await load();
}

function renderWards(container, wards, reload) {
  if (!wards.length) {
    container.innerHTML = emptyState({
      title: 'No ward councils registered',
      body: 'Citizens cannot register until at least one ward exists. Add the first ward above.',
    });
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr><th>Ward</th><th>Councillor</th><th>Citizens</th><th>Complaints</th><th></th></tr>
        </thead>
        <tbody>
          ${wards
            .map(
              (ward) => `
              <tr>
                <td>${esc(ward.wardName)}<div class="list-meta">WARD-${String(ward.wardId).padStart(3, '0')}</div></td>
                <td>${esc(ward.councillorName)}</td>
                <td class="mono-cell">${ward.citizenCount}</td>
                <td class="mono-cell">${ward.complaintCount}</td>
                <td style="text-align:right">
                  <button class="btn btn-sm btn-ghost" data-edit="${ward.wardId}">Edit</button>
                </td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const ward = wards.find((item) => item.wardId === Number(button.dataset.edit));
      const body = openDrawer({
        title: 'Edit ward council',
        kicker: `WARD-${String(ward.wardId).padStart(3, '0')}`,
        body: `
          <form id="ward-edit" novalidate>
            <div class="field">
              <label for="edit-ward-name">Ward name</label>
              <input id="edit-ward-name" name="wardName" maxlength="100" required />
            </div>
            <div class="field" style="margin-top:14px">
              <label for="edit-councillor">Councillor name</label>
              <input id="edit-councillor" name="councillorName" maxlength="100" required />
            </div>
            <div id="edit-error" class="form-error" style="margin-top:14px" hidden></div>
            <div class="row" style="margin-top:18px">
              <button class="btn btn-primary" type="submit">Save changes</button>
              <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
            </div>
          </form>`,
      });
      if (!body) return;

      const editForm = body.querySelector('#ward-edit');
      editForm.querySelector('#edit-ward-name').value = ward.wardName;
      editForm.querySelector('#edit-councillor').value = ward.councillorName;
      body.querySelector('[data-cancel]').addEventListener('click', closeDrawer);

      editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const error = body.querySelector('#edit-error');
        error.hidden = true;
        const fieldData = new FormData(editForm);
        const submit = editForm.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          await api(`/api/official/wards/${ward.wardId}`, {
            method: 'PATCH',
            body: {
              wardName: String(fieldData.get('wardName') || '').trim(),
              councillorName: String(fieldData.get('councillorName') || '').trim(),
            },
          });
          toast('Ward council updated.', 'success');
          closeDrawer();
          await reload();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          submit.disabled = false;
        }
      });
    });
  });
}

/* --------------------------- complaint drawer ------------------------ */
async function openOfficialComplaint(complaintId, reload) {
  const body = openDrawer({
    title: `Ticket ${ref(complaintId)}`,
    kicker: 'Division complaint file',
    body: '<div class="dim tiny">Loading complaint…</div>',
  });
  if (!body) return;

  try {
    const { complaint, media, workOrders } = await api(`/api/official/complaints/${complaintId}`);
    const hasWorkOrder = workOrders.length > 0;
    const resolved = complaint.status === 'Resolved' || complaint.status === 'Closed';

    body.innerHTML = `
      <div class="row wrap" style="margin-bottom:6px">
        ${statusBadge(complaint.status)}
        ${priorityBadge(complaint.priority)}
        ${complaint.isHighRisk ? '<span class="badge critical">High-risk pole</span>' : ''}
      </div>
      <h3 style="font-size:17px;font-weight:500;margin-top:8px">${esc(complaint.issueType)}</h3>
      <p class="muted tiny" style="margin-top:4px">${esc(complaint.poleName)} · ${esc(complaint.wardName)} · filed ${fmtDateTime(
        complaint.createdAt,
      )}</p>

      <div class="section-label">Citizen report</div>
      <div class="kv-grid">
        <div class="kv"><label>Citizen</label><b>${esc(complaint.citizenName)}</b></div>
        <div class="kv"><label>Phone</label><b>${esc(complaint.citizenPhone)}</b></div>
        <div class="kv"><label>Email</label><b style="font-size:12.5px">${esc(complaint.citizenEmail)}</b></div>
        <div class="kv"><label>Ward</label><b>${esc(complaint.wardName)}</b></div>
        <div class="kv"><label>Pole coordinates</label><b style="font-size:12.5px">${
          complaint.latitude !== null && complaint.longitude !== null
            ? `${Number(complaint.latitude).toFixed(5)}, ${Number(complaint.longitude).toFixed(5)}`
            : 'Not recorded'
        }</b></div>
        <div class="kv"><label>Days open</label><b>${complaint.daysOpen}</b></div>
      </div>

      ${
        media.length
          ? `<div class="section-label">Photo evidence</div>
             <div class="media-grid">
               ${media
                 .map(
                   (item) =>
                     `<a href="${esc(item.url)}" target="_blank" rel="noopener"><img src="${esc(
                       item.url,
                     )}" alt="Complaint evidence" /></a>`,
                 )
                 .join('')}
             </div>`
          : '<div class="dim tiny" style="margin-top:12px">No photo evidence was attached.</div>'
      }

      <div class="section-label">Ticket status</div>
      ${
        resolved
          ? `<div class="callout" style="border-color:rgba(79,211,154,.25);background:var(--green-soft);color:#bff2db">
               ${icon('check', 13)} Repair closed. Reopen only if the fault returns.</div>`
          : `<form id="status-form" class="row wrap">
               <select class="input" id="status-select" style="width:auto">
                 ${['Open', 'In Progress', 'Closed']
                   .map(
                     (status) =>
                       `<option value="${status}" ${status === complaint.status ? 'selected' : ''}>${status}</option>`,
                   )
                   .join('')}
               </select>
               <button class="btn btn-sm" type="submit">Update status</button>
             </form>
             <p class="tiny dim" style="margin-top:6px">A ticket needs a dispatched work order before it can move forward.</p>`
      }

      <div class="section-label">Contractor dispatch</div>
      ${
        hasWorkOrder
          ? workOrders
              .map(
                (order) => `
                <div class="card" style="padding:15px 16px;background:rgba(6,10,18,.5)">
                  <div class="row wrap">
                    <div>
                      <div class="mono">WO-${String(order.workOrderId).padStart(4, '0')}</div>
                      <div style="font-size:14px;margin-top:3px">${esc(order.vendorName)}</div>
                    </div>
                    <span class="spacer"></span>
                    ${complaint.daysOverdue > 0 && !resolved
                      ? `<span class="badge overdue">${complaint.daysOverdue}d overdue</span>`
                      : resolved
                        ? '<span class="badge resolved">Complete</span>'
                        : '<span class="badge progress">On schedule</span>'}
                  </div>
                  <div class="kv-grid" style="margin-top:14px">
                    <div class="kv"><label>Issued</label><b>${fmtDate(order.issuedDate)}</b></div>
                    <div class="kv"><label>Completed</label><b>${
                      order.completedDate
                        ? fmtDate(order.completedDate)
                        : order.targetDate
                        ? `<span style="color:var(--amber);font-size:11px;font-weight:600;margin-right:3px">(Target)</span>${fmtDate(order.targetDate)}`
                        : '—'
                    }</b></div>
                    <div class="kv"><label>Estimated cost</label><b>${money(order.estCost)}</b></div>
                    <div class="kv"><label>Dispatched by</label><b>${esc(order.officialName)}</b></div>
                  </div>
                  ${
                    resolved
                      ? ''
                      : `<button class="btn btn-primary btn-sm btn-block" style="margin-top:14px" data-complete="${order.workOrderId}">
                           Mark repair complete
                         </button>`
                  }
                </div>`,
              )
              .join('')
          : `<div class="callout info" style="margin-bottom:14px">${icon('clock', 13)}
               No contractor has been assigned to this fault yet.</div>
             <form id="dispatch-form" novalidate>
               <div class="form-grid">
                 <div class="field">
                   <label for="vendor">Vendor</label>
                   <select id="vendor" name="vendorId" required>
                     <option value="">Select vendor</option>
                   </select>
                 </div>
                 <div class="field">
                   <label for="cost">Estimated cost (₹)</label>
                   <input id="cost" name="estCost" type="number" min="0" step="0.01" value="0" required />
                 </div>
               </div>
               <div id="dispatch-error" class="form-error" style="margin-top:12px" hidden></div>
               <button class="btn btn-primary btn-block" type="submit" style="margin-top:14px">
                 Dispatch contractor ${icon('arrow', 14)}
               </button>
             </form>`
      }

      <div class="section-label">Ward &amp; division</div>
      <div class="kv-grid">
        <div class="kv"><label>Councillor</label><b>${esc(complaint.councillorName)}</b></div>
        <div class="kv"><label>Division</label><b>${esc(complaint.divName)}</b></div>
      </div>`;

    const refresh = async () => {
      await reload();
      await openOfficialComplaint(complaintId, reload);
    };

    const statusForm = body.querySelector('#status-form');
    if (statusForm) {
      statusForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = body.querySelector('#status-select').value;
        try {
          await api(`/api/official/complaints/${complaintId}/status`, {
            method: 'PATCH',
            body: { status: value },
          });
          toast(`Ticket moved to ${value}.`, 'success');
          await refresh();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }

    const dispatchForm = body.querySelector('#dispatch-form');
    if (dispatchForm) {
      /* populate vendor dropdown */
      try {
        const { vendors } = await api('/api/vendors');
        const vendorSelect = body.querySelector('#vendor');
        vendors.forEach((v) => {
          const opt = document.createElement('option');
          opt.value = v.vendorId;
          opt.textContent = v.serviceType ? `${v.vendorName} — ${v.serviceType}` : v.vendorName;
          vendorSelect.appendChild(opt);
        });
      } catch (_) { /* vendors list fetch failed – dropdown stays empty */ }

      dispatchForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(dispatchForm);
        const errorBox = body.querySelector('#dispatch-error');
        errorBox.hidden = true;
        const button = dispatchForm.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          await api(`/api/official/complaints/${complaintId}/work-orders`, {
            method: 'POST',
            body: {
              vendorId: Number(data.get('vendorId') || 0) || null,
              estCost: Number(data.get('estCost') || 0),
            },
          });
          toast('Work order issued. The complaint moved to In Progress.', 'success');
          await refresh();
        } catch (error) {
          errorBox.textContent = error.message;
          errorBox.hidden = false;
          button.disabled = false;
        }
      });
    }

    const completeButton = body.querySelector('[data-complete]');
    if (completeButton) {
      completeButton.addEventListener('click', async () => {
        if (!window.confirm('Mark this repair complete and resolve the complaint?')) return;
        completeButton.disabled = true;
        try {
          await api(`/api/official/work-orders/${completeButton.dataset.complete}/complete`, {
            method: 'PATCH',
          });
          toast('Repair closed. The complaint is now Closed and removed from active queue.', 'success');
          await refresh();
        } catch (error) {
          toast(error.message, 'error');
          completeButton.disabled = false;
        }
      });
    }
  } catch (error) {
    body.innerHTML = `<div class="form-error">${esc(error.message)}</div>`;
  }
}
