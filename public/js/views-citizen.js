import { api, uploadImage } from './api.js';
import {
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

const ISSUE_TYPES = [
  'Bulb Failure',
  'Dim Light',
  'Flickering Light',
  'Complete Outage',
  'Wiring Exposed',
  'Pole Damaged',
  'Other',
];

const ref = (id) => `#${String(id).padStart(4, '0')}`;

/* ------------------------------ dashboard ---------------------------- */
export async function CitizenDashboard(mount) {
  const data = await api('/api/citizen/overview');
  const { profile, stats, recent } = data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  mount.innerHTML = `
    <div class="page">
      <section class="card" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;background:
        radial-gradient(600px 240px at 92% -30%, rgba(255,198,92,.12), transparent 70%),
        linear-gradient(180deg, rgba(17,26,43,.7), rgba(12,18,32,.92));">
        <div style="flex:1;min-width:260px">
          <div class="mono">${esc(profile.wardName)} · ${esc(profile.divName)} division</div>
          <h2 style="font-size:25px;font-weight:500;margin-top:8px">${greeting}, ${esc(profile.firstName)}.</h2>
          <p class="muted" style="margin-top:6px;font-size:13.5px">
            ${stats.total === 0
              ? 'You have not reported a fault yet. A single report starts the repair chain.'
              : `You have ${stats.total} report${stats.total === 1 ? '' : 's'} on record, ${stats.resolved} resolved.`}
          </p>
        </div>
        <button class="btn btn-primary" data-action="report">${icon('plus', 15)} Report a fault</button>
      </section>

      <div class="stat-grid">
        ${statCard({ label: 'Total reports', value: stats.total, foot: 'All time', tone: 'amber' })}
        ${statCard({ label: 'Open', value: stats.open, foot: 'Awaiting dispatch', tone: 'amber' })}
        ${statCard({ label: 'In progress', value: stats.inProgress, foot: 'Contractor assigned', tone: 'blue' })}
        ${statCard({ label: 'Resolved', value: stats.resolved, foot: 'Repair closed', tone: 'green' })}
      </div>

      ${stats.urgent > 0
        ? `<div class="callout">${icon('alert', 14)} You have <strong>${stats.urgent}</strong> high or critical priority
             report${stats.urgent === 1 ? '' : 's'} still open. The division has been notified.</div>`
        : ''}

      <div class="grid-side">
        <section class="card">
          <div class="card-head">
            <div>
              <h3>Recent reports</h3>
              <div class="sub">Newest fault tickets first</div>
            </div>
            <span class="spacer"></span>
            <button class="btn btn-ghost btn-sm" data-action="all-reports">View all</button>
          </div>
          ${
            recent.length
              ? `<div class="list">${recent
                  .map(
                    (item) => `
                    <div class="list-row" data-complaint="${item.complaintId}">
                      <span class="pole-ref ${item.isHighRisk ? 'risk' : ''}">
                        <span class="lamp"></span>${esc(item.poleName)}
                      </span>
                      <div style="min-width:0">
                        <div class="list-title">${esc(item.issueType)}</div>
                        <div class="list-meta">${ref(item.complaintId)} · filed ${fmtDate(item.createdAt)}</div>
                      </div>
                      <div class="tail">
                        ${statusBadge(item.status)}
                        ${priorityBadge(item.priority)}
                      </div>
                    </div>`,
                  )
                  .join('')}</div>`
              : emptyState({
                  title: 'No reports yet',
                  body: 'When a light near you fails, report the exact pole and the division takes it from there.',
                  action: 'report',
                  actionLabel: 'Report your first fault',
                })
          }
        </section>

        <section class="card">
          <div class="card-head">
            <div>
              <h3>Your civic chain</h3>
              <div class="sub">Where your report travels</div>
            </div>
          </div>
          <div class="steps">
            <div class="step done">
              <span class="step-dot"></span>
              <div><b>${esc(profile.wardName)}</b><span>Ward councillor ${esc(profile.councillorName)}</span></div>
            </div>
            <div class="step done">
              <span class="step-dot"></span>
              <div><b>${esc(profile.divName)}</b><span>${esc(profile.district)} district · electrical division</span></div>
            </div>
            <div class="step ${stats.open + stats.inProgress > 0 ? 'current' : 'done'}">
              <span class="step-dot"></span>
              <div><b>Dispatch &amp; repair</b><span>Officials assign a third-party contractor</span></div>
            </div>
            <div class="step ${stats.resolved > 0 ? 'done' : ''}">
              <span class="step-dot"></span>
              <div><b>Closure</b><span>Work order completed, ticket resolved</span></div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="kv-grid">
            <div class="kv"><label>Registered email</label><b style="font-size:12.5px">${esc(profile.email)}</b></div>
            <div class="kv"><label>Phone</label><b style="font-size:12.5px">${esc(profile.phone)}</b></div>
          </div>
        </section>
      </div>
    </div>`;

  mount.querySelectorAll('[data-complaint]').forEach((row) => {
    row.addEventListener('click', () => openCitizenComplaint(Number(row.dataset.complaint)));
  });
  mount.querySelector('[data-action="report"]')?.addEventListener('click', () => App.navigate('/citizen/report'));
  mount.querySelector('[data-action="all-reports"]')?.addEventListener('click', () => App.navigate('/citizen/complaints'));
  mount.querySelector('.empty [data-action="report"]')?.addEventListener('click', () => App.navigate('/citizen/report'));
}

/* ------------------------------- report ------------------------------ */
export async function CitizenReport(mount) {
  const [{ poles }, profile] = await Promise.all([
    api('/api/citizen/poles'),
    api('/api/citizen/overview').then((data) => data.profile),
  ]);

  if (!poles.length) {
    mount.innerHTML = `
      <div class="page">
        <section class="card">
          ${emptyState({
            title: 'No poles inventoried in your division yet',
            body: `An electrical official in ${profile.divName} must register the pole inventory before faults can be pinned to a specific light. Your division record already exists — ask them to add poles, then come back.`,
            action: 'back',
            actionLabel: 'Back to dashboard',
          })}
        </section>
      </div>`;
    mount.querySelector('[data-action="back"]')?.addEventListener('click', () => App.navigate('/citizen'));
    return;
  }

  const state = { poleId: null, media: [], uploading: 0, issue: ISSUE_TYPES[0] };

  mount.innerHTML = `
    <div class="page">
      <div class="grid-side">
        <form class="card" id="report-form" novalidate>
          <div class="card-head">
            <div>
              <h3>Report a street light fault</h3>
              <div class="sub">${esc(profile.wardName)} · ${esc(profile.divName)}</div>
            </div>
          </div>

          <div class="stack">
            <div>
              <div class="section-label">1 · Which pole?</div>
              <div class="search-input" style="margin-bottom:10px">
                ${icon('search', 14)}
                <input class="input" id="pole-search" placeholder="Search pole name" autocomplete="off" />
              </div>
              <div class="pole-select" id="pole-list">
                ${poles
                  .map(
                    (pole) => `
                    <button type="button" class="pole-option" data-pole="${pole.poleId}" data-name="${esc(
                      pole.poleName.toLowerCase(),
                    )}">
                      <span class="lamp" style="width:6px;height:6px;border-radius:50%;background:${
                        pole.isHighRisk ? 'var(--red)' : 'var(--amber)'
                      };display:inline-block;flex:none"></span>
                      ${esc(pole.poleName)}
                      <span class="pole-meta">${esc(pole.subtype || '—')}${
                        pole.openComplaints ? ` · ${pole.openComplaints} open` : ''
                      }</span>
                    </button>`,
                  )
                  .join('')}
              </div>
              <div id="pole-empty" class="dim tiny" style="margin-top:8px" hidden>No pole matches that search.</div>
            </div>

            <div>
              <div class="section-label">2 · What is wrong?</div>
              <div class="field">
                <select id="issue-select">
                  ${ISSUE_TYPES.map((type) => `<option value="${esc(type)}">${esc(type)}</option>`).join('')}
                </select>
              </div>
              <div class="field" id="issue-other-wrap" style="margin-top:10px" hidden>
                <label for="issue-other">Describe the fault</label>
                <input id="issue-other" maxlength="100" placeholder="e.g. Fixture hanging over the footpath" />
              </div>
            </div>

            <div>
              <div class="section-label">3 · How urgent is it?</div>
              <div class="priority-pick" id="priority-pick">
                ${['Low', 'Medium', 'High', 'Critical']
                  .map(
                    (priority, index) => `
                    <label class="${index === 1 ? 'checked' : ''}">
                      <input type="radio" name="priority" value="${priority}" ${index === 1 ? 'checked' : ''} />
                      <span>${priority}</span>
                    </label>`,
                  )
                  .join('')}
              </div>
              <p class="tiny dim" style="margin-top:8px">
                Choose <b>Critical</b> for exposed wiring or a damaged pole — the division treats it as a safety hazard.
              </p>
            </div>

            <div>
              <div class="section-label">4 · Photo evidence <span class="dim">(optional)</span></div>
              <label class="dropzone" id="dropzone">
                ${icon('camera', 20)}
                <div style="margin-top:8px"><b>Click to attach</b> or drop an image here</div>
                <div class="tiny dim" style="margin-top:3px">PNG, JPEG, WEBP or GIF · up to 4 MB each · 5 images</div>
                <input id="media-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden />
              </label>
              <div class="thumb-row" id="thumbs"></div>
            </div>

            <div id="report-error" class="form-error" hidden></div>
            <div class="row">
              <button class="btn btn-primary" type="submit" id="submit-report">
                Submit report ${icon('arrow', 15)}
              </button>
              <button class="btn btn-ghost" type="button" data-action="cancel">Cancel</button>
            </div>
          </div>
        </form>

        <div class="stack">
          <section class="card" id="pole-detail">
            <div class="card-head">
              <div>
                <h3>Pole details</h3>
                <div class="sub">Select a pole</div>
              </div>
            </div>
            <div class="dim tiny">Nothing selected yet. Pick the pole from the list to see its record.</div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>What happens next</h3><div class="sub">Ticket lifecycle</div></div></div>
            <div class="steps">
              <div class="step current"><span class="step-dot"></span>
                <div><b>Open</b><span>Your ticket is queued for the division</span></div>
              </div>
              <div class="step"><span class="step-dot"></span>
                <div><b>In progress</b><span>An official dispatches a contractor</span></div>
              </div>
              <div class="step"><span class="step-dot"></span>
                <div><b>Resolved</b><span>Work order is marked complete</span></div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>`;

  const form = mount.querySelector('#report-form');
  const list = mount.querySelector('#pole-list');
  const search = mount.querySelector('#pole-search');
  const thumbs = mount.querySelector('#thumbs');
  const fileInput = mount.querySelector('#media-input');
  const dropzone = mount.querySelector('#dropzone');
  const errorBox = mount.querySelector('#report-error');

  const setError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  const selectPole = (button) => {
    list.querySelectorAll('.pole-option').forEach((item) => item.classList.toggle('selected', item === button));
    state.poleId = Number(button.dataset.pole);
    const pole = poles.find((item) => item.poleId === state.poleId);
    const detail = mount.querySelector('#pole-detail');
    const coords =
      pole.latitude !== null && pole.longitude !== null
        ? `${Number(pole.latitude).toFixed(5)}, ${Number(pole.longitude).toFixed(5)}`
        : 'No coordinates on record';
    detail.innerHTML = `
      <div class="card-head">
        <div><h3>${esc(pole.poleName)}</h3><div class="sub">Pole #${pole.poleId}</div></div>
        <span class="spacer"></span>
        ${subtypeBadge(pole.subtype)}
      </div>
      <div class="kv-grid">
        <div class="kv"><label>Location</label><b style="font-size:12.5px">${esc(coords)}</b></div>
        <div class="kv"><label>Safety flag</label><b style="font-size:12.5px">${
          pole.isHighRisk ? '<span style="color:var(--red)">High risk</span>' : 'Standard'
        }</b></div>
        <div class="kv"><label>Open tickets</label><b style="font-size:12.5px">${pole.openComplaints}</b></div>
        <div class="kv"><label>Division</label><b style="font-size:12.5px">${esc(profile.divName)}</b></div>
      </div>
      ${pole.openComplaints > 0
        ? `<div class="callout" style="margin-top:14px">${icon('alert', 13)} This pole already has an open ticket.
             A new report adds a separate record on the same asset.</div>`
        : ''}`;
  };

  list.querySelectorAll('.pole-option').forEach((button) => {
    button.addEventListener('click', () => selectPole(button));
  });

  search.addEventListener(
    'input',
    debounce(() => {
      const term = search.value.trim().toLowerCase();
      let visible = 0;
      list.querySelectorAll('.pole-option').forEach((button) => {
        const show = !term || button.dataset.name.includes(term);
        button.hidden = !show;
        if (show) visible += 1;
      });
      mount.querySelector('#pole-empty').hidden = visible > 0;
    }, 140),
  );

  form.querySelector('#issue-select').addEventListener('change', (event) => {
    state.issue = event.target.value;
    mount.querySelector('#issue-other-wrap').hidden = event.target.value !== 'Other';
  });

  const syncPriorities = () => {
    mount.querySelectorAll('#priority-pick label').forEach((label) => {
      label.classList.toggle('checked', label.querySelector('input').checked);
    });
  };
  mount.querySelectorAll('#priority-pick input').forEach((input) => input.addEventListener('change', syncPriorities));

  const renderThumbs = () => {
    thumbs.innerHTML = state.media
      .map(
        (url, index) => `
        <div class="thumb">
          <img src="${esc(url)}" alt="Evidence ${index + 1}" />
          <button type="button" data-remove="${index}" aria-label="Remove image">×</button>
        </div>`,
      )
      .join('');
    thumbs.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        state.media.splice(Number(button.dataset.remove), 1);
        renderThumbs();
      });
    });
  };

  const handleFiles = async (files) => {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    if (state.media.length + images.length > 5) {
      toast('You can attach up to 5 images per report.', 'error');
      return;
    }
    for (const file of images) {
      if (file.size > 4 * 1024 * 1024) {
        toast(`${file.name} is larger than 4 MB.`, 'error');
        continue;
      }
      try {
        state.uploading += 1;
        dropzone.style.opacity = '0.6';
        const { url } = await uploadImage(file);
        state.media.push(url);
        renderThumbs();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        state.uploading -= 1;
        dropzone.style.opacity = '1';
      }
    }
  };

  dropzone.addEventListener('click', (event) => {
    if (event.target.closest('input')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('drag');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('drag');
    handleFiles(event.dataTransfer.files);
  });

  mount.querySelector('[data-action="cancel"]').addEventListener('click', () => App.navigate('/citizen'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    if (!state.poleId) {
      setError('Select the street light you are reporting first.');
      list.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const selectedIssue = form.querySelector('#issue-select').value;
    const issueType =
      selectedIssue === 'Other'
        ? form.querySelector('#issue-other').value.trim()
        : selectedIssue;
    if (selectedIssue === 'Other' && issueType.length < 3) {
      setError('Describe the fault so the contractor knows what to expect.');
      return;
    }
    const priority = form.querySelector('input[name="priority"]:checked').value;
    const button = form.querySelector('#submit-report');
    button.disabled = true;
    button.textContent = state.uploading ? 'Uploading evidence…' : 'Submitting report…';
    try {
      await api('/api/citizen/complaints', {
        method: 'POST',
        body: { poleId: state.poleId, issueType, priority, mediaUrls: state.media },
      });
      toast('Fault reported. Your division can now dispatch a repair.', 'success');
      App.navigate('/citizen/complaints');
    } catch (error) {
      setError(error.message);
      button.disabled = false;
      button.innerHTML = `Submit report ${icon('arrow', 15)}`;
    }
  });
}

/* ----------------------------- complaints ---------------------------- */
export async function CitizenComplaints(mount) {
  const state = { status: '', search: '' };

  mount.innerHTML = `
    <div class="page">
      <section class="card">
        <div class="card-head">
          <div>
            <h3>My reports</h3>
            <div class="sub">Every fault ticket raised from your account</div>
          </div>
          <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" data-action="new">${icon('plus', 14)} New report</button>
        </div>
        <div class="filter-bar">
          <div class="chips" id="status-chips">
            ${['All', 'Open', 'In Progress', 'Closed']
              .map(
                (label) =>
                  `<button class="chip ${label === 'All' ? 'active' : ''}" data-status="${
                    label === 'All' ? '' : label
                  }">${label}</button>`,
              )
              .join('')}
          </div>
          <span class="spacer"></span>
          <div class="search-input">
            ${icon('search', 14)}
            <input class="input" id="complaint-search" placeholder="Search pole or fault type" />
          </div>
        </div>
        <div id="complaint-results"></div>
      </section>
    </div>`;

  const results = mount.querySelector('#complaint-results');

  const load = async () => {
    results.innerHTML = '<div class="dim tiny" style="padding:14px 0">Loading tickets…</div>';
    const params = new URLSearchParams();
    if (state.status) params.set('status', state.status);
    if (state.search) params.set('search', state.search);
    try {
      const { complaints } = await api(`/api/citizen/complaints?${params.toString()}`);
      renderResults(results, complaints);
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

  mount
    .querySelector('#complaint-search')
    .addEventListener('input', debounce((event) => {
      state.search = event.target.value.trim();
      load();
    }, 220));

  mount.querySelector('[data-action="new"]').addEventListener('click', () => App.navigate('/citizen/report'));

  await load();
}

function renderResults(container, complaints) {
  if (!complaints.length) {
    container.innerHTML = emptyState({
      title: 'No tickets match this view',
      body: 'Try a different status filter, or file a new fault report.',
    });
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Ticket</th><th>Pole</th><th>Fault</th><th>Priority</th>
            <th>Status</th><th>Work order</th><th>Filed</th><th></th>
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
                <td>${esc(item.issueType)}</td>
                <td>${priorityBadge(item.priority)}</td>
                <td>${statusBadge(item.status)}</td>
                <td class="mono-cell">${
                  item.workOrderId
                    ? `${esc(item.vendorName)}${item.daysOverdue > 0 ? ` <span class="badge overdue">${item.daysOverdue}d late</span>` : ''}`
                    : '<span class="dim">Not dispatched</span>'
                }</td>
                <td class="mono-cell">${fmtDate(item.createdAt)}</td>
                <td class="dim">${icon('chevron', 14)}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  container.querySelectorAll('tr[data-complaint]').forEach((row) => {
    row.addEventListener('click', () => openCitizenComplaint(Number(row.dataset.complaint)));
  });
}

/* ------------------------------ drawer ------------------------------- */
async function openCitizenComplaint(complaintId) {
  const body = openDrawer({
    title: `Ticket ${ref(complaintId)}`,
    kicker: 'Citizen complaint record',
    body: '<div class="dim tiny">Loading complaint…</div>',
  });
  if (!body) return;

  try {
    const { complaint, media } = await api(`/api/citizen/complaints/${complaintId}`);
    const coords =
      complaint.latitude !== null && complaint.longitude !== null
        ? `${Number(complaint.latitude).toFixed(5)}, ${Number(complaint.longitude).toFixed(5)}`
        : 'Not recorded';

    const dispatched = Boolean(complaint.workOrderId);
    const resolved = complaint.status === 'Resolved' || complaint.status === 'Closed';

    body.innerHTML = `
      <div class="row wrap" style="margin-bottom:6px">
        ${statusBadge(complaint.status)}
        ${priorityBadge(complaint.priority)}
        ${complaint.isHighRisk ? '<span class="badge critical">High-risk pole</span>' : ''}
      </div>
      <h3 style="font-size:17px;font-weight:500;margin-top:8px">${esc(complaint.issueType)}</h3>
      <p class="muted tiny" style="margin-top:4px">${esc(complaint.poleName)} · ${esc(complaint.wardName)} · ${esc(
        complaint.divName,
      )}</p>

      <div class="section-label">Ticket facts</div>
      <div class="kv-grid">
        <div class="kv"><label>Reported</label><b>${fmtDateTime(complaint.createdAt)}</b></div>
        <div class="kv"><label>Days open</label><b>${complaint.daysOpen}</b></div>
        <div class="kv"><label>Pole coordinates</label><b>${esc(coords)}</b></div>
        <div class="kv"><label>Evidence</label><b>${complaint.mediaCount} image${
          complaint.mediaCount === 1 ? '' : 's'
        }</b></div>
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
          : ''
      }

      <div class="section-label">Repair progress</div>
      <div class="steps">
        <div class="step done">
          <span class="step-dot"></span>
          <div><b>Fault reported</b><span>${fmtDateTime(complaint.createdAt)}</span></div>
        </div>
        <div class="step ${dispatched ? 'done' : 'current'}">
          <span class="step-dot"></span>
          <div><b>Contractor dispatch</b><span>${
            dispatched ? `${esc(complaint.vendorName)} · issued ${fmtDate(complaint.issuedDate)}` : 'Waiting for an official'
          }</span></div>
        </div>
        <div class="step ${resolved ? 'done' : dispatched ? 'current' : ''}">
          <span class="step-dot"></span>
          <div><b>Repair complete</b><span>${
            resolved ? 'Work order closed by the division' : 'Awaiting completion'
          }</span></div>
        </div>
      </div>

      ${
        dispatched
          ? `<div class="section-label">Work order</div>
             <div class="kv-grid">
               <div class="kv"><label>Contractor</label><b>${esc(complaint.vendorName)}</b></div>
               <div class="kv"><label>Estimated cost</label><b>${money(complaint.estCost)}</b></div>
               <div class="kv"><label>Issued</label><b>${fmtDate(complaint.issuedDate)}</b></div>
               <div class="kv"><label>Completed</label><b>${complaint.completedDate ? fmtDate(complaint.completedDate) : '—'}</b></div>
               <div class="kv"><label>Overdue</label><b>${
                 complaint.daysOverdue > 0
                   ? `<span style="color:var(--red)">${complaint.daysOverdue} day(s)</span>`
                   : 'On schedule'
               }</b></div>
             </div>`
          : `<div class="callout info" style="margin-top:16px">${icon('clock', 13)}
               No work order has been dispatched yet. ${esc(complaint.divName)} officials have your ticket in their queue.</div>`
      }

      <div class="section-label">Ward contact</div>
      <div class="kv-grid">
        <div class="kv"><label>Ward</label><b>${esc(complaint.wardName)}</b></div>
        <div class="kv"><label>Councillor</label><b>${esc(complaint.councillorName)}</b></div>
        <div class="kv"><label>Division</label><b>${esc(complaint.divName)}</b></div>
        <div class="kv"><label>District</label><b>${esc(complaint.district)}</b></div>
      </div>`;
  } catch (error) {
    body.innerHTML = `<div class="form-error">${esc(error.message)}</div>`;
  }
}
