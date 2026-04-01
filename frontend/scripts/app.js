

const API = '/api';


// These variables hold the current runtime state of the app.

let token           = localStorage.getItem('sap_token') || null; // JWT from login
let currentUser     = null;   // Logged-in user object
let tasks           = [];     // All tasks fetched from the server
let editingId       = null;   // Task ID currently being edited (null = new task)
let currentFilter   = 'all'; // Active filter on the All Tasks view
let currentDay      = new Date();  // Day shown in the Daily schedule
let currentWeekOffset = 0;   // Week offset from current week (0 = this week)
let notifItems      = [];    // In-app notification items


// Category colours — matches CSS variables for consistency
const CAT_COLOR = {
  lecture:    '#42a5f5',
  assignment: '#ff6b6b',
  meeting:    '#ffd166',
  exam:       '#b388ff',
};


/**
 * Wrapper around fetch() that:
 *  - Automatically attaches the JWT Authorization header
 *  - Always parses the JSON response
 *  - Throws a readable error if the server returns a non-2xx status
 */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res  = await fetch(API + path, { ...opts, headers });
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}


/**
 * Pings /api/health and updates the little status dot in the top bar.
 * Called once on launch and then every 30 seconds.
 */
async function checkAPIStatus() {
  try {
    await fetch(API + '/health');
    document.getElementById('api-dot').className   = 'api-dot online';
    document.getElementById('api-label').textContent = 'Backend online';
  } catch {
    const dot   = document.getElementById('api-dot');
    const label = document.getElementById('api-label');
    if (dot)   dot.className     = 'api-dot offline';
    if (label) label.textContent = 'Backend offline';
  }
}



/** Toggle between Log In and Register tabs on the auth screen */
function switchAuthTab(tab, btn) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('login-form').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
}

/** Log in with email + password */
async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('login-error');

  errEl.style.display = 'none';

  if (!email || !password) {
    showAuthError(errEl, 'Please enter your email and password.');
    return;
  }

  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ email, password }),
    });

    token       = data.token;
    currentUser = data.user;
    localStorage.setItem('sap_token', token);
    launchApp();
  } catch (e) {
    showAuthError(errEl, e.message);
  }
}

/** Register a new account */
async function doRegister() {
  const username = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-pass').value;
  const errEl    = document.getElementById('reg-error');

  errEl.style.display = 'none';

  if (!username || !email || !password) {
    showAuthError(errEl, 'All fields are required.');
    return;
  }
  if (username.length < 3) {
    showAuthError(errEl, 'Username must be at least 3 characters.');
    return;
  }
  if (password.length < 6) {
    showAuthError(errEl, 'Password must be at least 6 characters.');
    return;
  }

  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body:   JSON.stringify({ username, email, password }),
    });

    token       = data.token;
    currentUser = data.user;
    localStorage.setItem('sap_token', token);
    launchApp();
    toast('Welcome, ' + username + '! Your account is ready.', 'success');
  } catch (e) {
    showAuthError(errEl, e.message);
  }
}

/** Show a validation error under the auth form */
function showAuthError(el, msg) {
  el.textContent    = msg;
  el.style.display  = 'block';
}

/**
 * Silently try to restore a previous session using the stored JWT.
 * If the token is expired or invalid, we just clear it and stay on the auth screen.
 */
async function tryAutoLogin() {
  if (!token) return;

  try {
    const data  = await api('/auth/me');
    currentUser = data.user;
    launchApp();
  } catch {
    // Token is invalid or expired — clear it and show the login screen
    token = null;
    localStorage.removeItem('sap_token');
  }
}

/** Log out and return to the auth screen */
function doLogout() {
  token       = null;
  currentUser = null;
  tasks       = [];
  notifItems  = [];
  localStorage.removeItem('sap_token');

  document.getElementById('app').style.display         = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}



/** Called after a successful login/register — shows the main app */
function launchApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display         = 'flex';
  document.getElementById('user-display').textContent  = currentUser.name;

  updateGreeting();
  checkAPIStatus();
  loadTasks();

  // Re-check the backend status every 30 seconds
  setInterval(checkAPIStatus, 30_000);

  // Refresh in-app notification counts every minute
  setInterval(updateNotifications, 60_000);

  // Render Lucide icons that may have been injected into the DOM before now
  if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

/** Show a time-aware greeting and today's date in the dashboard header */
function updateGreeting() {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' :
    hour < 17 ? 'Good afternoon' :
                'Good evening';

  document.getElementById('dash-greeting').textContent =
    greeting + ', ' + currentUser.name + ' 👋';

  document.getElementById('dash-date').textContent =
    new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
}



/** Fetch all tasks from the server and refresh every view */
async function loadTasks() {
  document.getElementById('dash-tasks').innerHTML =
    '<div class="loading"><div class="spinner"></div>Loading tasks…</div>';

  try {
    const data = await api('/tasks');
    tasks      = data.tasks;
    refreshAll();
  } catch (e) {
    toast('Could not load tasks: ' + e.message, 'error');
  }
}

/** Re-render everything that depends on the tasks array */
function refreshAll() {
  renderStats();
  renderDashboard();
  renderAllTasks();
  renderDaily();
  updateNotifications();
  if (typeof lucide !== 'undefined') { lucide.createIcons(); } // Re-scan DOM for any new icon placeholders
}



/** Update the four summary cards at the top of the Dashboard */
function renderStats() {
  const today = new Date().toISOString().split('T')[0];

  document.getElementById('stat-total').textContent =
    tasks.length;

  document.getElementById('stat-today').textContent =
    tasks.filter(t => t.due_date === today && !t.done).length;

  document.getElementById('stat-overdue').textContent =
    tasks.filter(t => isTaskOverdue(t)).length;

  document.getElementById('stat-done').textContent =
    tasks.filter(t => t.done).length;
}



/** Show the next 6 upcoming (not-done, not-overdue) tasks on the dashboard */
function renderDashboard() {
  const upcoming = tasks
    .filter(t => !t.done && !isTaskOverdue(t))
    .sort(byDueDateTime)
    .slice(0, 6);

  const el = document.getElementById('dash-tasks');
  el.innerHTML = upcoming.length
    ? upcoming.map(taskCardHTML).join('')
    : emptyState('check-check', 'All caught up — no upcoming tasks.');
}



/** Apply a filter and re-render the All Tasks list */
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderAllTasks();
}

/** Jump to the All Tasks view filtered by a specific category */
function filterByCategory(cat) {
  showView('tasks', document.getElementById('nav-tasks'));
  setFilter(cat, null);
}

/** Render the filtered task list */
function renderAllTasks() {
  const today = new Date().toISOString().split('T')[0];
  let filtered = tasks;

  if (currentFilter === 'pending') {
    filtered = tasks.filter(t => !t.done);
  } else if (currentFilter === 'done') {
    filtered = tasks.filter(t => t.done);
  } else if (['lecture', 'assignment', 'meeting', 'exam'].includes(currentFilter)) {
    filtered = tasks.filter(t => t.category === currentFilter);
  }

  filtered = filtered.sort(byDueDateTime);

  const el = document.getElementById('all-tasks');
  el.innerHTML = filtered.length
    ? filtered.map(taskCardHTML).join('')
    : emptyState('inbox', 'No tasks match this filter.');
}



/**
 * Build the HTML string for a single task card.
 * Lucide icons are used via data-lucide attributes (rendered by lucide.createIcons()).
 */
function taskCardHTML(t) {
  const isOverdue   = isTaskOverdue(t);
  const color       = CAT_COLOR[t.category] || '#888';
  const hasReminders = t.remind_before && t.remind_before.length > 0;

  // Priority badge: arrow icon + colour class
  const priorClass = t.priority === 'high' ? 'priority-high' : t.priority === 'medium' ? 'priority-med' : 'priority-low';
  const priorIcon  = t.priority === 'high' ? 'arrow-up'      : t.priority === 'medium' ? 'minus'         : 'arrow-down';

  return `
  <div class="task-card ${t.done ? 'done' : ''}" id="tc-${t.id}">
    <div class="task-check" onclick="toggleDone('${t.id}')" title="${t.done ? 'Mark incomplete' : 'Mark complete'}">
      ${t.done ? '<i data-lucide="check" style="width:12px;height:12px"></i>' : ''}
    </div>
    <div class="task-cat-bar" style="background:${color}"></div>
    <div class="task-body">
      <div class="task-title">${t.title}</div>
      <div class="task-meta">
        <span>${t.due_date ? formatDate(t.due_date) : 'No date'}${t.due_time ? ' · ' + formatTime(t.due_time) : ''}</span>
        <span class="task-badge" style="background:${color}22;color:${color}">${t.category}</span>
        <span class="${priorClass}">
          <i data-lucide="${priorIcon}" style="width:10px;height:10px;display:inline-block;vertical-align:middle"></i>
          ${t.priority}
        </span>
        ${isOverdue   ? '<span style="color:var(--accent3);font-weight:500">● overdue</span>' : ''}
        ${hasReminders ? '<span style="color:var(--accent4)" title="Email reminders set"><i data-lucide="mail" style="width:11px;height:11px;display:inline-block;vertical-align:middle"></i></span>' : ''}
      </div>
    </div>
    <div class="task-actions">
      <button class="btn-icon edit" onclick="openEditModal('${t.id}')" title="Edit">
        <i data-lucide="pencil" style="width:13px;height:13px"></i>
      </button>
      <button class="btn-icon bell" onclick="openReminderModal('${t.id}')" title="Set Reminders">
        <i data-lucide="bell" style="width:13px;height:13px"></i>
      </button>
      <button class="btn-icon del" onclick="deleteTask('${t.id}')" title="Delete">
        <i data-lucide="trash-2" style="width:13px;height:13px"></i>
      </button>
    </div>
  </div>`;
}



/** Open the modal ready to add a brand-new task */
function openAddModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add Task';
  document.getElementById('t-title').value    = '';
  document.getElementById('t-cat').value      = 'assignment';
  document.getElementById('t-priority').value = 'high';
  document.getElementById('t-date').value     = new Date().toISOString().split('T')[0];
  document.getElementById('t-time').value     = '';
  document.getElementById('t-notes').value    = '';
  clearReminderChips();
  document.getElementById('task-modal').classList.add('open');
  setTimeout(() => document.getElementById('t-title').focus(), 50);
  if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

/** Open the modal pre-filled with an existing task's data */
function openEditModal(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;

  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit Task';
  document.getElementById('t-title').value    = t.title;
  document.getElementById('t-cat').value      = t.category;
  document.getElementById('t-priority').value = t.priority;
  document.getElementById('t-date').value     = t.due_date || '';
  document.getElementById('t-time').value     = t.due_time || '';
  document.getElementById('t-notes').value    = t.notes || '';
  setReminderChips(t.remind_before || []);
  document.getElementById('task-modal').classList.add('open');
  if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

/**
 * Open the edit modal and scroll straight to the reminder section.
 * Triggered from the bell icon on a task card.
 */
function openReminderModal(id) {
  openEditModal(id);
  setTimeout(() => {
    document.querySelector('.reminder-section')?.scrollIntoView({ behavior: 'smooth' });
  }, 120);
}

/** Close the task add/edit modal */
function closeModal() {
  document.getElementById('task-modal').classList.remove('open');
  editingId = null;
}

/** Uncheck every reminder chip and remove the selected styling */
function clearReminderChips() {
  document.querySelectorAll('#reminder-options .reminder-chip').forEach(chip => {
    const input = chip.querySelector('input');
    if (input) input.checked = false;
    chip.classList.remove('selected');
  });
}

/** Check the chips that correspond to the given array of minute values */
function setReminderChips(values) {
  clearReminderChips();
  document.querySelectorAll('#reminder-options .reminder-chip').forEach(chip => {
    const v = parseInt(chip.dataset.val);
    if (values.includes(v)) {
      const input = chip.querySelector('input');
      if (input) input.checked = true;
      chip.classList.add('selected');
    }
  });
}

/** Read the currently selected reminder offsets from the modal chips */
function getSelectedReminders() {
  const values = [];
  document.querySelectorAll('#reminder-options input:checked')
    .forEach(cb => values.push(parseInt(cb.value)));
  return values;
}

/**
 * Wire up checkbox → visual chip state for both the task modal
 * and the profile default-reminder chips.
 * Called once on DOMContentLoaded.
 */
function setupReminderChipToggle() {
  ['reminder-options', 'default-reminder-chips'].forEach(containerId => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('change', e => {
      if (e.target.type === 'checkbox') {
        e.target.closest('.reminder-chip')?.classList.toggle('selected', e.target.checked);
      }
    });
  });
}

/** Save a new task or update an existing one */
async function saveTask() {
  const title = document.getElementById('t-title').value.trim();
  if (!title) {
    toast('Please enter a task title.', 'error');
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.textContent = 'Saving…';
  btn.disabled    = true;

  const payload = {
    title,
    category:      document.getElementById('t-cat').value,
    priority:      document.getElementById('t-priority').value,
    due_date:      document.getElementById('t-date').value   || null,
    due_time:      document.getElementById('t-time').value   || null,
    notes:         document.getElementById('t-notes').value.trim() || null,
    remind_before: getSelectedReminders(),
  };

  try {
    if (editingId) {
      await api('/tasks/' + editingId, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('Task updated successfully.', 'success');
    } else {
      await api('/tasks', { method: 'POST', body: JSON.stringify(payload) });
      const reminderNote = payload.remind_before.length
        ? ` Email reminders set for ${payload.remind_before.map(fmtOffset).join(', ')} before.`
        : '';
      toast('Task added.' + reminderNote, 'success');
    }
    closeModal();
    loadTasks();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Save Task';
    btn.disabled    = false;
  }
}

/** Mark a task done (or undo it) */
async function toggleDone(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;

  try {
    await api('/tasks/' + id, { method: 'PATCH', body: JSON.stringify({ done: !t.done }) });
    loadTasks();
    if (!t.done) toast('"' + t.title + '" marked complete ✓', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

/** Delete a single task (with a browser confirm dialog) */
async function deleteTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  if (!confirm('Delete "' + t.title + '"? This cannot be undone.')) return;

  try {
    await api('/tasks/' + id, { method: 'DELETE' });
    toast('"' + t.title + '" deleted.', 'warn');
    loadTasks();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}



/** Switch to a named view (dashboard | tasks | schedule | profile) */
function showView(name, navEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  if (navEl) navEl.classList.add('active');

  if (name === 'schedule') renderDaily();
  if (name === 'profile')  loadProfile();
  if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}



function changeDay(n) {
  currentDay = new Date(currentDay);
  currentDay.setDate(currentDay.getDate() + n);
  renderDaily();
}

function goToday() {
  currentDay = new Date();
}

/** Render the daily timeline for currentDay */
function renderDaily() {
  const dateStr = currentDay.toISOString().split('T')[0];
  const label   = document.getElementById('day-label');
  if (label) {
    label.textContent = currentDay.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }

  const dayTasks = tasks
    .filter(t => t.due_date === dateStr)
    .sort((a, b) => (a.due_time || '00:00').localeCompare(b.due_time || '00:00'));

  const el = document.getElementById('daily-list');
  if (!dayTasks.length) {
    el.innerHTML = emptyState('calendar-x', 'No tasks for this day.');
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
    return;
  }

  el.innerHTML = dayTasks.map(t => {
    const color = CAT_COLOR[t.category] || '#888';
    return `
    <div class="daily-item">
      <div class="daily-time">${t.due_time ? formatTime(t.due_time) : '–'}</div>
      <div class="daily-body" style="border-left-color:${color};${t.done ? 'opacity:.5' : ''}">
        <div class="daily-title" style="${t.done ? 'text-decoration:line-through' : ''}">${t.title}</div>
        <div class="daily-desc">${t.category}${t.notes ? ' · ' + t.notes : ''}</div>
      </div>
    </div>`;
  }).join('');

  if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function switchSchedTab(tab, btn) {
  document.querySelectorAll('.sched-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sched-daily').style.display  = tab === 'daily'  ? 'block' : 'none';
  document.getElementById('sched-weekly').style.display = tab === 'weekly' ? 'block' : 'none';
  if (tab === 'weekly') renderWeekly();
  if (typeof lucide !== 'undefined') { lucide.createIcons(); }
}

function changeWeek(n) {
  currentWeekOffset += n;
  renderWeekly();
}

/** Render the weekly grid starting from currentWeekOffset */
function renderWeekly() {
  const today     = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1 + currentWeekOffset * 7);

  // Build an array of the 7 day objects for this week
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const label = document.getElementById('week-label');
  if (label) {
    label.textContent =
      days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' +
      days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const todayStr  = today.toISOString().split('T')[0];
  const hours     = ['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00'];
  const shortDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  // Column headers
  let html = '<div class="week-header"></div>';
  days.forEach((d, i) => {
    const ds = d.toISOString().split('T')[0];
    html += `<div class="week-header ${ds === todayStr ? 'today-col' : ''}">${shortDays[i]}<br><span style="font-size:9px;font-weight:400">${d.getDate()}</span></div>`;
  });

  // Time rows
  hours.forEach(hr => {
    html += `<div class="week-timeslot">${hr}</div>`;
    days.forEach(d => {
      const ds        = d.toISOString().split('T')[0];
      const slotTasks = tasks.filter(t => t.due_date === ds && t.due_time && t.due_time.slice(0, 2) === hr.slice(0, 2));
      html += `<div class="week-cell ${ds === todayStr ? 'today-col' : ''}">`;
      slotTasks.forEach(t => {
        const color = CAT_COLOR[t.category] || '#888';
        html += `<div class="week-event" style="background:${color};${t.done ? 'opacity:.4' : ''}" title="${t.title}">${t.title}</div>`;
      });
      html += '</div>';
    });
  });

  const grid = document.getElementById('week-grid');
  if (grid) grid.innerHTML = html;
}



/**
 * Scan the task list for anything due soon or overdue and
 * populate the notification panel + badge count.
 * This is purely for in-app alerts — separate from the email reminder system.
 */
function updateNotifications() {
  const now   = new Date();
  const today = now.toISOString().split('T')[0];
  notifItems  = [];

  tasks.filter(t => !t.done).forEach(t => {
    if (!t.due_date) return;

    const dueDate = new Date(t.due_date + 'T' + (t.due_time || '23:59') + ':00');
    const diffMin = (dueDate - now) / 60_000; // minutes until due

    if (diffMin < 0) {
      // Already past the due date/time
      notifItems.push({ title: t.title, msg: 'OVERDUE', type: 'urgent' });
    } else if (diffMin > 0 && diffMin <= 60) {
      // Due within the next hour
      notifItems.push({ title: t.title, msg: 'Due in ' + Math.round(diffMin) + ' min', type: 'urgent' });
    } else if (diffMin > 0 && diffMin <= 1440) {
      // Due today
      const timeStr = t.due_time ? ' at ' + formatTime(t.due_time) : '';
      notifItems.push({ title: t.title, msg: 'Due today' + timeStr, type: 'soon' });
    } else if (t.due_date === addDays(today, 1)) {
      // Due tomorrow
      notifItems.push({ title: t.title, msg: 'Due tomorrow', type: 'soon' });
    }
  });

  renderNotifPanel();

  // Update the badge number
  const badge = document.getElementById('notif-badge');
  if (badge) {
    if (notifItems.length) {
      badge.style.display  = 'flex';
      badge.textContent    = notifItems.length > 9 ? '9+' : notifItems.length;
    } else {
      badge.style.display  = 'none';
    }
  }
}

/** Render the notification list inside the slide-down panel */
function renderNotifPanel() {
  const el = document.getElementById('notif-list');
  if (!el) return;

  el.innerHTML = notifItems.length
    ? notifItems.map(n =>
        `<div class="notif-item ${n.type}">
          <div class="notif-item-title">${n.title}</div>
          <div class="notif-item-time">${n.msg}</div>
        </div>`
      ).join('')
    : '<div style="padding:20px 18px;font-size:11px;color:var(--muted)">No alerts right now 🎉</div>';
}

function toggleNotifPanel() {
  document.getElementById('notif-panel').classList.toggle('open');
}

function clearNotifs() {
  notifItems = [];
  renderNotifPanel();
  document.getElementById('notif-badge').style.display = 'none';
  document.getElementById('notif-panel').classList.remove('open');
}



/** Load profile data from the server and populate all sections */
async function loadProfile() {
  try {
    const data = await api('/profile');
    renderProfileCard(data);
    populateProfileForm(data.user);
    populateNotifForm(data.user);
    if (typeof lucide !== 'undefined') { lucide.createIcons(); }
  } catch (e) {
    toast('Could not load profile: ' + e.message, 'error');
  }
}

/** Render the left-side profile summary card */
function renderProfileCard(data) {
  const u        = data.user;
  const initials = u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  document.getElementById('profile-avatar').textContent     = initials;
  document.getElementById('profile-card-name').textContent  = u.name;
  document.getElementById('profile-card-email').textContent = u.email;
  document.getElementById('profile-since').textContent = u.created_at
    ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—';

  // Helper to show/hide optional rows (institution, dept, year)
  const showRow = (rowId, valId, val) => {
    const row = document.getElementById(rowId);
    if (!row) return;
    if (val) {
      document.getElementById(valId).textContent = val;
      row.style.display = 'flex';
    } else {
      row.style.display = 'none';
    }
  };

  showRow('profile-institution-row', 'profile-card-institution', u.institution);
  showRow('profile-dept-row',        'profile-card-dept',        u.department);
  showRow('profile-year-row',        'profile-card-year',        u.year_of_study);

  const bioEl = document.getElementById('profile-card-bio');
  if (bioEl) {
    bioEl.textContent  = u.bio || '';
    bioEl.style.display = u.bio ? 'block' : 'none';
  }

  // Mini stats
  const s = data.stats;
  document.getElementById('ps-total').textContent = s.total;
  document.getElementById('ps-done').textContent  = s.completed;
  document.getElementById('ps-rate').textContent  = s.completion_rate + '%';
}

/** Fill the profile edit form with the user's current data */
function populateProfileForm(u) {
  document.getElementById('p-name').value        = u.name        || '';
  document.getElementById('p-email').value       = u.email       || '';
  document.getElementById('p-phone').value       = u.phone       || '';
  document.getElementById('p-institution').value = u.institution || '';
  document.getElementById('p-department').value  = u.department  || '';
  document.getElementById('p-year').value        = u.year_of_study || '';
  document.getElementById('p-bio').value         = u.bio         || '';
}

/** Pre-select the user's saved notification preferences */
function populateNotifForm(u) {
  const enabled = u.email_reminders_enabled !== false;
  document.getElementById('notif-enabled').checked = enabled;
  updateNotifToggleState();

  // Default reminder times (fallback: 1 day before)
  const defaults = u.default_remind_before || [1440];
  document.querySelectorAll('#default-reminder-chips .reminder-chip').forEach(chip => {
    const v     = parseInt(chip.dataset.val);
    const on    = defaults.includes(v);
    const input = chip.querySelector('input');
    if (input) input.checked = on;
    chip.classList.toggle('selected', on);
  });
}

/** Save personal info changes to the server */
async function saveProfile() {
  const btn = document.getElementById('btn-save-profile');
  btn.textContent = 'Saving…';
  btn.disabled    = true;

  try {
    await api('/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        name:          document.getElementById('p-name').value.trim(),
        phone:         document.getElementById('p-phone').value.trim(),
        institution:   document.getElementById('p-institution').value.trim(),
        department:    document.getElementById('p-department').value.trim(),
        year_of_study: document.getElementById('p-year').value,
        bio:           document.getElementById('p-bio').value.trim(),
      }),
    });

    // Update the display name in the top bar immediately
    currentUser.name = document.getElementById('p-name').value.trim() || currentUser.name;
    document.getElementById('user-display').textContent = currentUser.name;

    await loadProfile();
    toast('Profile updated successfully! 🎉', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Save Changes';
    btn.disabled    = false;
  }
}

/** Save a new password */
async function changePassword() {
  const current = document.getElementById('pw-current').value;
  const newPw   = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;

  if (!current || !newPw || !confirm) {
    toast('All password fields are required.', 'error');
    return;
  }
  if (newPw !== confirm) {
    toast('New passwords do not match.', 'error');
    return;
  }
  if (newPw.length < 6) {
    toast('New password must be at least 6 characters.', 'error');
    return;
  }

  const btn = document.getElementById('btn-save-pw');
  btn.textContent = 'Updating…';
  btn.disabled    = true;

  try {
    await api('/profile/password', {
      method: 'PATCH',
      body:   JSON.stringify({ current_password: current, new_password: newPw }),
    });

    // Clear the inputs
    ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('pw-strength-label').textContent = '';

    toast('Password changed successfully! 🔐', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Update Password';
    btn.disabled    = false;
  }
}

/** Live password-strength indicator while typing */
function checkPwStrength() {
  const pw  = document.getElementById('pw-new').value;
  const el  = document.getElementById('pw-strength-label');

  if (!pw) { el.textContent = ''; return; }

  // Check four strength criteria
  const criteria = [pw.length >= 8, /[A-Z]/.test(pw), /[0-9]/.test(pw), /[^A-Za-z0-9]/.test(pw)];
  const score    = criteria.filter(Boolean).length;

  const labels = ['', 'Weak — add more characters', 'Fair — try mixing letters and numbers', 'Good', 'Strong ✓'];
  const colors  = ['', 'var(--accent3)', 'var(--accent4)', 'var(--accent2)', 'var(--accent)'];

  el.textContent = labels[score] || '';
  el.style.color = colors[score] || '';
}

/** Save notification preferences (on/off + default reminder times) */
async function saveNotifSettings() {
  const enabled  = document.getElementById('notif-enabled').checked;
  const defaults = [];
  document.querySelectorAll('#default-reminder-chips input:checked')
    .forEach(cb => defaults.push(parseInt(cb.value)));

  const btn = document.getElementById('btn-save-notif');
  btn.textContent = 'Saving…';
  btn.disabled    = true;

  try {
    await api('/profile/notifications', {
      method: 'PATCH',
      body:   JSON.stringify({ email_reminders_enabled: enabled, default_remind_before: defaults }),
    });
    toast('Notification settings saved.', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Save Notification Settings';
    btn.disabled    = false;
  }
}

/** Grey out the reminder chips when email notifications are disabled */
function updateNotifToggleState() {
  const enabled = document.getElementById('notif-enabled').checked;
  const body    = document.getElementById('notif-settings-body');
  if (body) {
    body.style.opacity       = enabled ? '1'    : '0.35';
    body.style.pointerEvents = enabled ? ''     : 'none';
  }
}

/** Accordion toggle for settings section panels */
function toggleSection(id) {
  const body = document.getElementById(id);
  const chev = document.getElementById('chev-' + id);
  if (!body || !chev) return;

  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  chev.classList.toggle('open', !isOpen);
}



let confirmCallback = null;

/** Open a re-usable confirmation modal before dangerous actions */
function openConfirm(title, msg, needsPassword, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent   = msg;

  const pwGroup = document.getElementById('confirm-pw-group');
  pwGroup.style.display = needsPassword ? 'block' : 'none';
  document.getElementById('confirm-pw').value = '';

  confirmCallback = onConfirm;
  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirm() {
  document.getElementById('confirm-modal').classList.remove('open');
  confirmCallback = null;
}

/** Delete ALL tasks one by one (with confirmation dialog) */
function confirmDeleteAllTasks() {
  openConfirm(
    'Delete All Tasks',
    'This will permanently delete all your tasks and email reminders. This cannot be undone.',
    false,
    async () => {
      try {
        for (const t of [...tasks]) {
          await api('/tasks/' + t.id, { method: 'DELETE' });
        }
        tasks = [];
        loadTasks();
        closeConfirm();
        toast('All tasks deleted.', 'warn');
      } catch (e) {
        toast('Error: ' + e.message, 'error');
      }
    }
  );
}

/** Delete the entire account (requires password confirmation) */
function confirmDeleteAccount() {
  openConfirm(
    'Delete Account',
    'This will permanently delete your account and ALL your data, including tasks and reminders. This cannot be undone. Enter your password to confirm.',
    true,
    async () => {
      const pw = document.getElementById('confirm-pw').value;
      if (!pw) { toast('Please enter your password.', 'error'); return; }
      try {
        await api('/profile', { method: 'DELETE', body: JSON.stringify({ password: pw }) });
        closeConfirm();
        toast('Account deleted. Goodbye! 👋', 'warn');
        setTimeout(doLogout, 1200);
      } catch (e) {
        toast('Error: ' + e.message, 'error');
      }
    }
  );
}



/** Add n days to a YYYY-MM-DD date string and return the new string */
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

/** 
 * Returns true if a task is not done and its due date/time has passed.
 */
function isTaskOverdue(t) {
  if (t.done || !t.due_date) return false;
  const now = new Date();
  const due = new Date(`${t.due_date}T${t.due_time || '23:59'}:00`);
  return due < now;
}

/** Human-friendly relative date label: "Today", "Tomorrow", or "Jan 15" */
function formatDate(d) {
  if (!d) return '';
  const today = new Date().toISOString().split('T')[0];
  if (d === today)              return 'Today';
  if (d === addDays(today, 1)) return 'Tomorrow';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Convert a 24-hour time string to 12-hour AM/PM format */
function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Format a reminder offset (minutes) as a human-readable string */
function fmtOffset(min) {
  if (min < 60)   return min + ' min';
  if (min < 1440) return (min / 60) + ' hour' + (min > 60 ? 's' : '');
  return (min / 1440) + ' day' + (min > 1440 ? 's' : '');
}

/** Sort comparator — sorts tasks by due date then due time (nulls last) */
function byDueDateTime(a, b) {
  const ka = (a.due_date || '9999') + (a.due_time || '');
  const kb = (b.due_date || '9999') + (b.due_time || '');
  return ka.localeCompare(kb);
}

/** Show a brief toast pop-up in the bottom-right corner */
function toast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : type === 'warn' ? 'warn' : '');

  const icon = type === 'error' ? 'x-circle' : type === 'warn' ? 'alert-triangle' : 'circle-check';
  el.innerHTML = `<i data-lucide="${icon}" style="width:14px;height:14px;flex-shrink:0"></i> <span>${msg}</span>`;

  container.appendChild(el);
  if (typeof lucide !== 'undefined') { lucide.createIcons(); } // Render the icon inside the new toast
  setTimeout(() => el.remove(), 4000);
}

/** Render a styled empty-state placeholder with an icon */
function emptyState(iconName, text) {
  return `
  <div class="empty-state">
    <div class="empty-icon">
      <i data-lucide="${iconName}" style="width:40px;height:40px;opacity:.35"></i>
    </div>
    <p>${text}</p>
  </div>`;
}



document.addEventListener('DOMContentLoaded', () => {

  // Wire up reminder chip checkboxes
  setupReminderChipToggle();

  // Close task modal by clicking the backdrop
  const taskModal = document.getElementById('task-modal');
  if (taskModal) {
    taskModal.addEventListener('click', e => {
      if (e.target === taskModal) closeModal();
    });
  }

  // Trigger the confirm callback when the user clicks "Confirm"
  const confirmBtn = document.getElementById('confirm-action-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      if (confirmCallback) await confirmCallback();
    });
  }

  // Close confirm modal by clicking the backdrop
  const confirmModal = document.getElementById('confirm-modal');
  if (confirmModal) {
    confirmModal.addEventListener('click', e => {
      if (e.target === confirmModal) closeConfirm();
    });
  }

  // Close any open modal with Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeConfirm(); }
  });

  // Close the notification panel when clicking anywhere outside it
  document.addEventListener('click', e => {
    const panel = document.getElementById('notif-panel');
    if (panel && !panel.contains(e.target) && !e.target.closest('.notif-btn')) {
      panel.classList.remove('open');
    }
  });

    tryAutoLogin();
});
