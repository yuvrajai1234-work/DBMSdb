import { api } from './api.js';
import { esc, icon, todayInput } from './ui.js';
import { App } from './app.js';

let portal = 'citizen';
let mode = 'signin';
let reference = { divisions: [], wards: [], totals: {} };

const OFFICIAL_DESIGNATIONS = [
  'Electrical Engineer',
  'Street-Light Technician / Electrician',
  'Lineman / Electrical Maintenance Worker',
  'Pole Maintenance Worker / Structural Repairer',
  'Complaint / Maintenance Supervisor',
  'Safety Inspector / Quality Control Officer',
];

function optionList(items, { valueKey, label }) {
  return items.map((item) => `<option value="${esc(item[valueKey])}">${esc(label(item))}</option>`).join('');
}

/** Divisions are master data: the web forms can only pick an existing one. */
function divisionNotice() {
  return `<div class="callout" style="margin-top:12px">
    No electrical divisions are registered yet. Divisions are added by the LumiSafe developer
    directly in the database — ask the administrator to create your division before signing up.
  </div>`;
}

function brandPanel() {
  const totals = reference.totals || {};
  const health = App.state.health;
  return `
    <section class="auth-brand">
      <div class="brand-lockup">
        <span class="brand-lamp"></span>
        <div>
          <div class="brand-name">LUMISAFE</div>
          <div class="brand-sub">Street light operations</div>
        </div>
      </div>

      <div class="auth-hero">
        <h1>Every dark street lamp<br />is a ticket the city<br /><em>can actually close.</em></h1>
        <p class="lead">
          Citizens report faults on the exact pole outside their door. Electrical officials verify,
          dispatch a contractor and track the repair until it is resolved — all on one relational record.
        </p>

        <div class="hero-facts">
          <div class="hero-fact"><b>${Number(totals.divisions || 0)}</b><span>Electrical divisions</span></div>
          <div class="hero-fact"><b>${Number(totals.wards || 0)}</b><span>Ward councils</span></div>
          <div class="hero-fact"><b>${Number(totals.poles || 0)}</b><span>Poles inventoried</span></div>
          <div class="hero-fact"><b>${Number(totals.complaints || 0)}</b><span>Faults reported</span></div>
        </div>

        <div class="auth-flow">
          <span>DIVISION</span><i>→</i><span>WARD</span><i>→</i><span>POLE</span><i>→</i>
          <span>COMPLAINT</span><i>→</i><span>WORK ORDER</span><i>→</i><span>CLOSURE</span>
        </div>
      </div>

      <div class="row" style="gap:8px">
        <span class="status-dot ${health && health.ok ? '' : 'down'}"></span>
        <span class="mono">${health && health.ok ? 'LumiSafeDB online' : 'LumiSafeDB unreachable'} · ${esc(
          health && health.engine ? health.engine : 'PostgreSQL',
        )}</span>
      </div>
    </section>`;
}

function citizenForm() {
  const divisions = reference.divisions || [];
  const noDivisions = divisions.length === 0;
  return `
    <form id="citizen-form" novalidate>
      <div class="form-grid">
        <div class="field">
          <label for="first-name">First name</label>
          <input id="first-name" name="firstName" autocomplete="given-name" placeholder="Aarav" maxlength="50" required />
        </div>
        <div class="field">
          <label for="last-name">Last name</label>
          <input id="last-name" name="lastName" autocomplete="family-name" placeholder="Sharma" maxlength="50" required />
        </div>
        <div class="field span-2">
          <label for="citizen-email">Email address</label>
          <input id="citizen-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" maxlength="100" required />
        </div>
        <div class="field">
          <label for="phone">Phone number</label>
          <input id="phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="10–15 digits" maxlength="15" required />
        </div>
        <div class="field">
          <label for="dob">Date of birth</label>
          <input id="dob" name="dateOfBirth" type="date" max="${todayInput()}" required />
        </div>
        <div class="field">
          <label for="citizen-division">Electrical division</label>
          <select id="citizen-division" name="divId" ${noDivisions ? 'disabled' : ''} required>
            <option value="">Select division</option>
            ${optionList(divisions, {
              valueKey: 'divId',
              label: (div) => `${div.divName} (${div.district})`,
            })}
          </select>
          <small>Select your area division first.</small>
        </div>
        <div class="field">
          <label for="ward-select">Home ward / locality</label>
          <select id="ward-select" name="wardId" disabled required>
            <option value="">Select a division first</option>
          </select>
          <small>Select your ward — complaint routing depends on it.</small>
        </div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="field span-2">
          <label for="citizen-password">Password</label>
          <input id="citizen-password" name="password" type="password" autocomplete="new-password" placeholder="At least 6 characters" minlength="6" maxlength="72" required />
        </div>
      </div>
      <div id="citizen-error" class="form-error" style="margin-top:14px" hidden></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:16px">
        Create citizen account ${icon('arrow', 15)}
      </button>
      <p class="tiny dim" style="text-align:center;margin-top:12px">
        Your ward decides which electrical division handles your report.
      </p>
    </form>`;
}

function officialForm() {
  const divisions = reference.divisions || [];
  return `
    <form id="official-form" novalidate>
      <div class="form-grid">
        <div class="field">
          <label for="official-name">Full name</label>
          <input id="official-name" name="officialName" placeholder="Suresh Kumar" maxlength="50" required />
        </div>
        <div class="field">
          <label for="designation">Designation / Role</label>
          <select id="designation" name="designation" required>
            <option value="">Select job role</option>
            ${OFFICIAL_DESIGNATIONS.map((role) => `<option value="${esc(role)}">${esc(role)}</option>`).join('')}
          </select>
        </div>
        <div class="field span-2">
          <label for="official-email">Government email</label>
          <input id="official-email" name="email" type="email" autocomplete="email" placeholder="name@utility.gov.in" maxlength="100" required />
        </div>
        <div class="field span-2">
          <label for="official-division">Electrical division</label>
          ${
            divisions.length
              ? `<select id="official-division" name="divId" required>
                   <option value="">Select your division</option>
                   ${optionList(divisions, {
                     valueKey: 'divId',
                     label: (div) => `${div.divName} — ${div.district}`,
                   })}
                 </select>
                 <small>Officials only see complaints raised on poles inside their own division.</small>`
              : divisionNotice()
          }
        </div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="field span-2">
          <label for="official-password">Password</label>
          <input id="official-password" name="password" type="password" autocomplete="new-password" placeholder="At least 6 characters" minlength="6" maxlength="72" required />
        </div>
      </div>
      <div id="official-error" class="form-error" style="margin-top:14px" hidden></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:16px">
        Create official account ${icon('arrow', 15)}
      </button>
      <p class="tiny dim" style="text-align:center;margin-top:12px">
        Electrical divisions are maintained by the LumiSafe developer in the database.
      </p>
    </form>`;
}

function signinForm() {
  const isOfficial = portal === 'official';
  return `
    <form id="signin-form" novalidate>
      <div class="field">
        <label for="login-email">${isOfficial ? 'Government email' : 'Email address'}</label>
        <input id="login-email" name="email" type="email" autocomplete="email"
          placeholder="${isOfficial ? 'name@utility.gov.in' : 'you@example.com'}" required />
      </div>
      <div class="field" style="margin-top:14px">
        <label for="login-password">Password</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Your password" required />
      </div>
      <div id="signin-error" class="form-error" style="margin-top:14px" hidden></div>
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:16px">
        Sign in to ${isOfficial ? 'official portal' : 'citizen portal'} ${icon('arrow', 15)}
      </button>
      <p class="tiny dim" style="text-align:center;margin-top:14px">
        ${
          isOfficial
            ? 'Only registered electrical officials can open the dispatch console.'
            : 'Your email identifies your complaint history and ward.'
        }
      </p>
    </form>`;
}

function cardBody() {
  const isOfficial = portal === 'official';
  const signingUp = mode === 'signup';
  const totalDivisions = Number(reference.totals.divisions || 0);
  const totalWards = Number(reference.totals.wards || 0);

  let heading = isOfficial ? 'Official sign in' : 'Citizen sign in';
  let hint = isOfficial
    ? 'Verify faults, dispatch contractors and close work orders for your division.'
    : 'Report a broken street light and follow the repair to closure.';

  if (signingUp) {
    heading = isOfficial ? 'Register an official account' : 'Create a citizen account';
    hint = isOfficial
      ? 'Pick the division you work for. You can manage pole inventory and work orders right after.'
      : 'Tell us where you live so your report reaches the right ward and division.';
  }

  let notice = '';
  if (signingUp && !isOfficial && totalWards === 0) {
    notice = `<div class="callout" style="margin-bottom:16px">No ward councils exist yet. Wards are provisioned by the LumiSafe developer.</div>`;
  }

  return `
    <div class="auth-card">
      <div class="portal-switch" role="tablist">
        <button type="button" data-portal="citizen" class="${!isOfficial ? 'active' : ''}">Citizen portal</button>
        <button type="button" data-portal="official" class="${isOfficial ? 'active' : ''}">Official portal</button>
      </div>

      <h2>${esc(heading)}</h2>
      <p class="auth-hint">${esc(hint)}</p>
      ${notice}

      ${signingUp ? (isOfficial ? officialForm() : citizenForm()) : signinForm()}

      <div class="divider" style="margin:20px 0"></div>
      <p class="tiny" style="text-align:center;color:var(--muted)">
        ${signingUp ? 'Already have an account?' : 'New to LumiSafe?'}
        <button class="btn-link" type="button" data-mode="${signingUp ? 'signin' : 'signup'}">
          ${signingUp ? 'Sign in instead' : 'Create an account'}
        </button>
      </p>
    </div>`;
}

export async function AuthView(mount) {
  reference = await api('/api/bootstrap').catch(() => reference);
  render(mount);
}

function render(mount) {
  mount.innerHTML = `
    <div class="auth-shell">
      ${brandPanel()}
      <main class="auth-panel">
        ${cardBody()}
      </main>
    </div>`;

  mount.querySelectorAll('[data-portal]').forEach((button) => {
    button.addEventListener('click', () => {
      portal = button.dataset.portal;
      mode = 'signin';
      render(mount);
    });
  });

  mount.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      render(mount);
    });
  });

  const signin = mount.querySelector('#signin-form');
  if (signin) {
    signin.addEventListener('submit', (event) => {
      event.preventDefault();
      submitSignin(mount, signin);
    });
  }

  const citizen = mount.querySelector('#citizen-form');
  if (citizen) {
    bindCitizenDivisionFilter(citizen);
    bindCitizenSubmit(mount, citizen);
  }

  const official = mount.querySelector('#official-form');
  if (official) bindOfficialSubmit(mount, official);
}

function bindCitizenDivisionFilter(form) {
  const divSelect = form.querySelector('#citizen-division');
  const wardSelect = form.querySelector('#ward-select');
  if (!divSelect || !wardSelect) return;

  divSelect.addEventListener('change', () => {
    const divId = Number(divSelect.value);
    if (!divId) {
      wardSelect.disabled = true;
      wardSelect.innerHTML = '<option value="">Select a division first</option>';
      return;
    }

    const filtered = (reference.wards || []).filter((w) => w.divId === divId);
    if (filtered.length === 0) {
      wardSelect.disabled = true;
      wardSelect.innerHTML = '<option value="">No wards in this division</option>';
      return;
    }

    wardSelect.disabled = false;
    wardSelect.innerHTML =
      '<option value="">Select your ward / locality</option>' +
      optionList(filtered, {
        valueKey: 'wardId',
        label: (w) => w.wardName,
      });
  });
}

function showError(form, selector, message) {
  const box = form.querySelector(selector);
  if (!box) return;
  box.textContent = message;
  box.hidden = !message;
}

function busy(button, label) {
  button.disabled = true;
  button.dataset.label = button.innerHTML;
  button.textContent = label;
}

function idle(button) {
  button.disabled = false;
  if (button.dataset.label) button.innerHTML = button.dataset.label;
}

async function submitSignin(mount, form) {
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  showError(form, '#signin-error', '');
  busy(button, 'Verifying credentials…');
  try {
    const response = await api('/api/auth/login', {
      method: 'POST',
      body: {
        portal,
        email: String(data.get('email') || '').trim(),
        password: String(data.get('password') || ''),
      },
    });
    App.onAuthenticated(response.user);
  } catch (error) {
    showError(form, '#signin-error', error.message);
    idle(button);
  }
}

function readDivisionChoice(form) {
  const select = form.querySelector('#official-division');
  if (!select || !select.value) return {};
  return { divId: Number(select.value) };
}

function bindCitizenSubmit(mount, form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    showError(form, '#citizen-error', '');

    const divSelect = form.querySelector('#citizen-division');
    if (divSelect && !divSelect.value) {
      showError(form, '#citizen-error', 'Please select an electrical division first.');
      return;
    }

    const select = form.querySelector('#ward-select');
    const wardValue = select && !select.disabled ? select.value : '';
    if (!wardValue) {
      showError(form, '#citizen-error', 'Please select your home ward / locality.');
      return;
    }

    const payload = {
      firstName: String(data.get('firstName') || '').trim(),
      lastName: String(data.get('lastName') || '').trim(),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      dateOfBirth: String(data.get('dateOfBirth') || ''),
      password: String(data.get('password') || ''),
      wardId: Number(wardValue),
    };

    busy(button, 'Creating your account…');
    try {
      const response = await api('/api/auth/register/citizen', { method: 'POST', body: payload });
      App.onAuthenticated(response.user);
    } catch (error) {
      showError(form, '#citizen-error', error.message);
      idle(button);
    }
  });
}

function bindOfficialSubmit(mount, form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const data = new FormData(form);
    showError(form, '#official-error', '');

    const payload = {
      officialName: String(data.get('officialName') || '').trim(),
      designation: String(data.get('designation') || '').trim(),
      email: String(data.get('email') || '').trim(),
      password: String(data.get('password') || ''),
      ...readDivisionChoice(form),
    };

    if (!payload.designation) {
      showError(form, '#official-error', 'Please select your job role designation.');
      return;
    }

    if (!payload.divId) {
      showError(
        form,
        '#official-error',
        'Select your electrical division. Divisions are added by the LumiSafe developer in the database.',
      );
      return;
    }

    busy(button, 'Creating your account…');
    try {
      const response = await api('/api/auth/register/official', { method: 'POST', body: payload });
      App.onAuthenticated(response.user);
    } catch (error) {
      showError(form, '#official-error', error.message);
      idle(button);
    }
  });
}
