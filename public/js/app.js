import { api } from './api.js';
import { closeDrawer, esc, icon, initials, toast } from './ui.js';
import { AuthView } from './views-auth.js';
import { CitizenComplaints, CitizenDashboard, CitizenReport } from './views-citizen.js';
import {
  OfficialDashboard,
  OfficialInventory,
  OfficialQueue,
  OfficialWards,
  OfficialWorkOrders,
} from './views-official.js';

const ROUTES = {
  '/': { chrome: false, title: 'Access', view: AuthView },
  '/citizen': {
    role: 'citizen',
    nav: '/citizen',
    crumb: 'Citizen portal',
    title: 'Dashboard',
    view: CitizenDashboard,
  },
  '/citizen/report': {
    role: 'citizen',
    nav: '/citizen/report',
    parent: '/citizen',
    crumb: 'Citizen portal',
    title: 'Report a fault',
    view: CitizenReport,
  },
  '/citizen/complaints': {
    role: 'citizen',
    nav: '/citizen/complaints',
    parent: '/citizen',
    crumb: 'Citizen portal',
    title: 'My reports',
    view: CitizenComplaints,
  },
  '/official': {
    role: 'official',
    nav: '/official',
    crumb: 'Official portal',
    title: 'Control room',
    view: OfficialDashboard,
  },
  '/official/queue': {
    role: 'official',
    nav: '/official/queue',
    parent: '/official',
    crumb: 'Official portal',
    title: 'Complaint queue',
    view: OfficialQueue,
  },
  '/official/work-orders': {
    role: 'official',
    nav: '/official/work-orders',
    parent: '/official',
    crumb: 'Official portal',
    title: 'Work orders',
    view: OfficialWorkOrders,
  },
  '/official/inventory': {
    role: 'official',
    nav: '/official/inventory',
    parent: '/official',
    crumb: 'Official portal',
    title: 'Asset inventory',
    view: OfficialInventory,
  },
  '/official/wards': {
    role: 'official',
    nav: '/official/wards',
    parent: '/official',
    crumb: 'Official portal',
    title: 'Ward councils',
    view: OfficialWards,
  },
};

const NAV = {
  citizen: [
    { path: '/citizen', label: 'Dashboard', icon: 'grid' },
    { path: '/citizen/report', label: 'Report a fault', icon: 'plus' },
    { path: '/citizen/complaints', label: 'My reports', icon: 'list' },
  ],
  official: [
    { path: '/official', label: 'Control room', icon: 'grid' },
    { path: '/official/queue', label: 'Complaint queue', icon: 'list' },
    { path: '/official/work-orders', label: 'Work orders', icon: 'tool' },
    { path: '/official/inventory', label: 'Asset inventory', icon: 'bolt' },
    { path: '/official/wards', label: 'Ward councils', icon: 'map' },
  ],
};

const homeFor = (role) => (role === 'official' ? '/official' : '/citizen');

function currentPath() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const clean = raw.split('?')[0];
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

function healthMarkup(health) {
  if (!health) {
    return `
      <div class="db-status-head"><span class="status-dot pending"></span> Connecting…</div>
      <div class="db-metrics"><span>Engine <b>PostgreSQL</b></span><span>Link <b>—</b></span></div>`;
  }
  if (!health.ok) {
    return `
      <div class="db-status-head"><span class="status-dot down"></span> DB unreachable</div>
      <div class="db-metrics"><span>Engine <b>PostgreSQL</b></span><span>Retrying</span></div>`;
  }
  const counts = health.counts || {};
  return `
    <div class="db-status-head"><span class="status-dot"></span> LumiSafeDB live</div>
    <div class="db-metrics">
      <span>Tables <b>${Number(health.tableCount || 10)}</b></span>
      <span>Latency <b>${health.latencyMs} ms</b></span>
      <span>Tickets <b>${Number(counts.complaints || 0)}</b></span>
      <span>Size <b>${health.sizeKb} KB</b></span>
    </div>`;
}

function sidebar(user, route) {
  const items = NAV[user.role] || [];
  const subtitle =
    user.role === 'official' ? `${user.divName} · official` : `${user.wardName} · citizen`;
  return `
    <aside class="sidebar">
      <div class="brand-lockup">
        <span class="brand-lamp"></span>
        <div>
          <div class="brand-name">LUMISAFE</div>
          <div class="brand-sub">${user.role === 'official' ? 'Dispatch console' : 'Citizen portal'}</div>
        </div>
      </div>

      <div>
        <div class="nav-group-label">${user.role === 'official' ? 'Division operations' : 'My civic record'}</div>
        <nav>
          ${items
            .map(
              (item) => `
              <a class="nav-item ${route.nav === item.path ? 'active' : ''}" href="#${item.path}">
                ${icon(item.icon, 16)} ${esc(item.label)}
              </a>`,
            )
            .join('')}
        </nav>
      </div>

      <div class="sidebar-foot">
        <div class="db-status" id="db-status">${healthMarkup(App.state.health)}</div>
        <div class="user-chip">
          <div class="avatar">${esc(initials(user.name))}</div>
          <div class="who">
            <b>${esc(user.name)}</b>
            <span>${esc(subtitle)}</span>
          </div>
          <button class="icon-btn" id="logout" title="Sign out" aria-label="Sign out">
            ${icon('logout', 16)}
          </button>
        </div>
      </div>
    </aside>`;
}

function shell(user, route) {
  return `
    <div class="shell">
      ${sidebar(user, route)}
      <main class="main">
        <header class="topbar">
          <div>
            <div class="crumb">${esc(route.crumb || '')}</div>
            <h1>${esc(route.title)}</h1>
          </div>
          <div class="topbar-actions">
            <div class="live-pill" id="live-pill">
              <span class="status-dot ${App.state.health && App.state.health.ok ? '' : 'pending'}"></span>
              ${App.state.health && App.state.health.ok
                ? `DB live · ${App.state.health.latencyMs} ms`
                : 'Checking DB…'}
            </div>
            <button class="btn btn-ghost btn-sm" id="back" title="Go back">
              ${icon('back', 15)} Back
            </button>
            <button class="btn btn-ghost btn-sm" id="logout-top" title="Sign out">
              ${icon('logout', 15)} Sign out
            </button>
          </div>
        </header>
        <div id="view"></div>
      </main>
    </div>`;
}

let renderToken = 0;

export const App = {
  state: { user: null, health: null },

  async start() {
    try {
      const { user } = await api('/api/auth/me');
      this.state.user = user;
    } catch {
      this.state.user = null;
    }
    await this.refreshHealth();
    window.addEventListener('hashchange', () => this.render());
    await this.render();
    setInterval(() => this.refreshHealth(), 15000);
  },

  async refreshHealth() {
    try {
      this.state.health = await api('/api/health');
    } catch {
      this.state.health = { ok: false };
    }
    this.paintHealth();
  },

  paintHealth() {
    const block = document.getElementById('db-status');
    if (block) block.innerHTML = healthMarkup(this.state.health);
    const pill = document.getElementById('live-pill');
    if (pill) {
      const health = this.state.health;
      pill.innerHTML = health && health.ok
        ? `<span class="status-dot"></span> DB live · ${health.latencyMs} ms`
        : `<span class="status-dot down"></span> DB unreachable`;
    }
  },

  navigate(path) {
    closeDrawer();
    if (currentPath() === path) {
      this.render();
      return;
    }
    window.location.hash = path;
  },

  onAuthenticated(user) {
    this.state.user = user;
    closeDrawer();
    toast(`Signed in as ${user.name}.`, 'success');
    this.navigate(homeFor(user.role));
    this.refreshHealth();
  },

  async logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* session already gone */
    }
    this.state.user = null;
    closeDrawer();
    window.location.hash = '/';
    await this.render();
  },

  async render() {
    const token = ++renderToken;
    const path = currentPath();
    let route = ROUTES[path];

    if (!route) {
      window.location.hash = this.state.user ? homeFor(this.state.user.role) : '/';
      return;
    }

    if (!this.state.user && route.role) {
      window.location.hash = '/';
      return;
    }

    if (this.state.user && !route.role) {
      window.location.hash = homeFor(this.state.user.role);
      return;
    }

    if (route.role && this.state.user.role !== route.role) {
      window.location.hash = homeFor(this.state.user.role);
      return;
    }

    const root = document.getElementById('app');
    closeDrawer();

    if (route.chrome === false) {
      root.innerHTML = '<div class="boot-screen"><div class="boot-mark"></div><p class="mono">Opening portal…</p></div>';
      try {
        root.innerHTML = '';
        await route.view(root);
      } catch (error) {
        root.innerHTML = `<div class="auth-shell"><main class="auth-panel"><div class="auth-card">
          <h2>Cannot open the portal</h2>
          <p class="auth-hint">${esc(error.message)}</p>
          <button class="btn btn-primary" onclick="location.reload()">Reload LumiSafe</button>
        </div></main></div>`;
      }
      return;
    }

    root.innerHTML = shell(this.state.user, route);
    document.getElementById('logout').addEventListener('click', () => this.logout());
    document.getElementById('logout-top').addEventListener('click', () => this.logout());
    document.getElementById('back').addEventListener('click', () => {
      if (route.parent) this.navigate(route.parent);
      else if (window.history.length > 1) window.history.back();
      else this.navigate(homeFor(this.state.user.role));
    });

    const view = document.getElementById('view');
    view.innerHTML = '<div class="page"><div class="dim tiny">Loading…</div></div>';

    try {
      await route.view(view);
    } catch (error) {
      if (token !== renderToken) return;
      if (error.status === 401) {
        this.state.user = null;
        window.location.hash = '/';
        return;
      }
      view.innerHTML = `
        <div class="page">
          <section class="card">
            <div class="card-head"><div><h3>This view could not load</h3>
              <div class="sub">${esc(route.title)}</div></div></div>
            <div class="form-error">${esc(error.message)}</div>
            <div class="row" style="margin-top:16px">
              <button class="btn btn-primary btn-sm" id="retry">Try again</button>
              <button class="btn btn-ghost btn-sm" id="home">Back to dashboard</button>
            </div>
          </section>
        </div>`;
      view.querySelector('#retry').addEventListener('click', () => this.render());
      view.querySelector('#home').addEventListener('click', () => this.navigate(homeFor(this.state.user.role)));
    }
  },
};

// Keep the shell status fresh when the tab regains focus.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) App.refreshHealth();
});

App.start();
