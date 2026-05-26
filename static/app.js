(function() {
  var t = localStorage.getItem('theme');
  if (t && t !== 'dark') document.body.classList.add(t);
})();

// State
let currentUser = null;
let allTasks = [];
let allProjects = [];
let allTags = [];
let chatHistory = [];
let activeFilter = 'all';
let expandedTaskId = null;
let editingTaskId = null;
let editingStepId = null;
let currentPage = 'tasks';
let chatOpen = false;
let drawerOpen = false;
let currentView = 'list';
let currentCalendarMonth = null;  // { year, month } — initialised in Task 8
let currentTimelineOffset = 0;    // days shifted — used in Task 9
let allStatuses = [];             // statuses for the active project filter (or default set)
let expandedProjectId = null;
let projectStatusMap = {};
var tableSort = { col: null, dir: 'asc' };
var tableExpanded = {};
var tableHiddenCols = JSON.parse(localStorage.getItem('tableHiddenCols') || '[]');
var tableColFilters = JSON.parse(localStorage.getItem('tableColFilters') || '{}');

var TABLE_COLS = [
  { key: 'title',      label: 'Title',      sortable: true,  always: true,  filterable: false },
  { key: 'status',     label: 'Status',     sortable: true,  always: false, filterable: true  },
  { key: 'priority',   label: 'Priority',   sortable: true,  always: false, filterable: true  },
  { key: 'start_date', label: 'Start Date', sortable: true,  always: false, filterable: false },
  { key: 'due_date',   label: 'Due Date',   sortable: true,  always: false, filterable: false },
  { key: 'project',    label: 'Project',    sortable: true,  always: false, filterable: true  },
  { key: 'tags',       label: 'Tags',       sortable: false, always: false, filterable: false },
  { key: 'notes',      label: 'Notes',      sortable: false, always: false, filterable: false }
];

function setMarkdownContent(el, mdText) {
  var html = DOMPurify.sanitize(marked.parse(mdText || ''));
  var doc = new DOMParser().parseFromString(html, 'text/html');
  el.textContent = '';
  Array.from(doc.body.childNodes).forEach(function(node) {
    el.appendChild(document.importNode(node, true));
  });
}

function renderNotesDisplay(notesText, container) {
  container.textContent = '';
  if (!notesText || !notesText.trim()) return;
  var label = document.createElement('div');
  label.className = 'notes-display-label';
  label.textContent = 'Notes';
  var body = document.createElement('div');
  body.className = 'notes-rendered';
  setMarkdownContent(body, notesText);
  container.appendChild(label);
  container.appendChild(body);
}

function buildNotesToggle(initialValue) {
  var wrapper = document.createElement('div');

  var tabs = document.createElement('div');
  tabs.className = 'notes-tabs';

  var editTab = document.createElement('button');
  editTab.className = 'notes-tab active';
  editTab.textContent = 'Edit';
  editTab.type = 'button';

  var previewTab = document.createElement('button');
  previewTab.className = 'notes-tab';
  previewTab.textContent = 'Preview';
  previewTab.type = 'button';

  tabs.appendChild(editTab);
  tabs.appendChild(previewTab);

  var textarea = document.createElement('textarea');
  textarea.className = 'notes-editor';
  textarea.value = initialValue || '';
  textarea.placeholder = 'Notes — markdown supported';

  var preview = document.createElement('div');
  preview.className = 'notes-preview';
  preview.style.display = 'none';

  editTab.addEventListener('click', function(e) {
    e.stopPropagation();
    editTab.classList.add('active');
    previewTab.classList.remove('active');
    textarea.style.display = '';
    preview.style.display = 'none';
  });

  previewTab.addEventListener('click', function(e) {
    e.stopPropagation();
    previewTab.classList.add('active');
    editTab.classList.remove('active');
    textarea.style.display = 'none';
    preview.style.display = '';
    setMarkdownContent(preview, textarea.value);
  });

  wrapper.appendChild(tabs);
  wrapper.appendChild(textarea);
  wrapper.appendChild(preview);

  return { el: wrapper, getValue: function() { return textarea.value; } };
}

// Auth
function getToken() { return localStorage.getItem('mytask_token'); }
function authHeaders() {
  return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
}

var THEMES = ['dark', 'light', 'forest', 'amber', 'midnight'];
var THEME_LABELS = { dark: 'Dark', light: 'Light', forest: 'Forest', amber: 'Amber', midnight: 'Midnight' };

function applyTheme(theme) {
  ['light', 'forest', 'amber', 'midnight'].forEach(function(c) { document.body.classList.remove(c); });
  if (theme !== 'dark') document.body.classList.add(theme);
  localStorage.setItem('theme', theme);
  var label = THEME_LABELS[theme] || 'Dark';
  var t1 = document.getElementById('theme-toggle');
  var t2 = document.getElementById('theme-toggle-drawer');
  if (t1) { t1.textContent = label; t1.setAttribute('data-theme', theme); }
  if (t2) { t2.textContent = label; t2.setAttribute('data-theme', theme); }
}

async function login() {
  var username = document.getElementById('login-username').value.trim();
  var password = document.getElementById('login-password').value;
  var errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    var resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      errEl.textContent = 'Invalid username or password.';
      errEl.style.display = 'block';
      return;
    }
    localStorage.setItem('mytask_token', (await resp.json()).access_token);
    await initApp();
  } catch (e) {
    errEl.textContent = 'Connection error.';
    errEl.style.display = 'block';
  }
}

function logout() {
  localStorage.removeItem('mytask_token');
  location.reload();
}

function relativeDate(iso) {
  var today = new Date().toISOString().split('T')[0];
  if (iso === today) return 'today';
  var d = new Date(iso + 'T00:00:00');
  var t = new Date(today + 'T00:00:00');
  var days = Math.round((d - t) / 86400000);
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return 'in ' + days + ' days';
  return Math.abs(days) + 'd overdue';
}

function showToast(msg, actionLabel, actionFn) {
  var t = document.createElement('div');
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
    'background:var(--bg-card);border:1px solid var(--border);color:var(--text);' +
    'padding:8px 18px;border-radius:var(--r);font-size:12px;z-index:500;' +
    'box-shadow:0 4px 12px rgba(0,0,0,.3);display:flex;align-items:center;gap:12px;white-space:nowrap;';
  var msgSpan = document.createElement('span');
  msgSpan.textContent = msg;
  t.appendChild(msgSpan);
  var duration = 2500;
  if (actionLabel && actionFn) {
    duration = 8000;
    var btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.style.cssText = 'background:none;border:none;color:var(--accent);font-size:12px;' +
      'font-weight:600;cursor:pointer;padding:0;text-decoration:underline;';
    btn.addEventListener('click', function() {
      clearTimeout(timer);
      t.remove();
      actionFn();
    });
    t.appendChild(btn);
  }
  document.body.appendChild(t);
  var timer = setTimeout(function() { if (document.body.contains(t)) t.remove(); }, duration);
}

async function initApp() {
  if (!getToken()) { showLogin(); return; }
  try {
    var resp = await fetch('/api/auth/me', { headers: authHeaders() });
    if (!resp.ok) { showLogin(); return; }
    currentUser = await resp.json();
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('sidebar-username').textContent = currentUser.username;
    document.getElementById('drawer-username').textContent = currentUser.username;
    if (currentUser.role === 'admin') {
      document.getElementById('admin-link').style.display = 'flex';
      document.getElementById('admin-link-drawer').style.display = 'flex';
    }
    fetch('/api/info').then(function(r) { return r.json(); }).then(function(d) {
      var el = document.getElementById('chat-model-label');
      if (el) el.textContent = d.model || '';
    }).catch(function() {});
    document.getElementById('chat-fab').style.display = 'flex';
    await loadProjects();
    await loadTags();
    await loadTasks();
    var now = new Date();
    currentCalendarMonth = { year: now.getFullYear(), month: now.getMonth() };
    navigateTo(currentPage);
    addAiMessage('Hello ' + currentUser.username + '! I am your AI assistant. Tell me what tasks you need help with.');
    applyTheme(localStorage.getItem('theme') || 'dark');
  } catch (e) { showLogin(); }
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('chat-fab').style.display = 'none';
  if (chatOpen) toggleChat();
}

function navigateTo(page) {
  currentPage = page;
  var pages = ['tasks', 'dashboard', 'projects', 'tags', 'kb'];
  pages.forEach(function(p) {
    var el = document.getElementById('page-' + p);
    if (el) el.style.display = p === page ? 'flex' : 'none';
  });
  // Update sidebar active state
  document.querySelectorAll('.sidebar-item[data-page]').forEach(function(el) {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.querySelectorAll('.drawer-item[data-page]').forEach(function(el) {
    el.classList.toggle('active', el.dataset.page === page);
  });
  // Update mobile page title
  var titles = { tasks: 'Tasks', dashboard: 'Dashboard', projects: 'Projects', tags: 'Tags', kb: 'Knowledge Base' };
  var titleEl = document.getElementById('mobile-page-title');
  if (titleEl) titleEl.textContent = titles[page] || page;
  // Load dashboard data when switching to that page
  if (page === 'dashboard') loadDashboard();
  if (page === 'projects') renderProjectsPage();
  if (page === 'tags') renderTagsPage();
  if (page === 'kb') renderKBPage();
}

function toggleChat() {
  chatOpen = !chatOpen;
  var widget = document.getElementById('chat-widget');
  var fab = document.getElementById('chat-fab');
  if (!widget || !fab) return;
  widget.style.display = chatOpen ? 'flex' : 'none';
  fab.textContent = chatOpen ? '✕' : '◈';
  if (chatOpen) {
    var msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('chat-input').focus();
  }
}

function toggleDrawer() {
  drawerOpen = !drawerOpen;
  var drawer = document.getElementById('mobile-drawer');
  var overlay = document.getElementById('drawer-overlay');
  drawer.classList.toggle('open', drawerOpen);
  overlay.style.display = drawerOpen ? 'block' : 'none';
}

// Colour helper
function hexToRgba(hex, alpha) {
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// Projects
async function loadProjects() {
  var resp = await fetch('/api/projects', { headers: authHeaders() });
  if (!resp.ok) { if (resp.status === 401) showLogin(); return; }
  allProjects = await resp.json();
  renderProjectFilters();
  populateProjectDropdown();
}

// Statuses
async function loadStatuses(projectId) {
  var url = '/api/statuses';
  if (projectId !== undefined && projectId !== null) url += '?project_id=' + projectId;
  var resp = await fetch(url, { headers: authHeaders() });
  if (!resp.ok) return;
  allStatuses = await resp.json();
}

function renderProjectFilters() {
  var container = document.getElementById('project-filters');
  while (container.firstChild) container.removeChild(container.firstChild);
  allProjects.forEach(function(p) {
    var btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.dataset.projectId = p.id;
    btn.textContent = p.name;
    btn.addEventListener('click', function() { setFilter('project:' + p.id, btn); });
    container.appendChild(btn);
  });
}

function populateProjectDropdown() {
  var sel = document.getElementById('mt-project');
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  allProjects.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

// Tags
async function loadTags() {
  var resp = await fetch('/api/tags', { headers: authHeaders() });
  if (!resp.ok) return;
  allTags = await resp.json();
  renderTagFilters();
}

function renderTagFilters() {
  var container = document.getElementById('tag-filters');
  while (container.firstChild) container.removeChild(container.firstChild);
  allTags.forEach(function(tag) {
    var wrap = document.createElement('span');
    wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center';

    var btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.dataset.tagId = tag.id;
    btn.textContent = tag.name;
    btn.style.cssText = (
      'background:' + hexToRgba(tag.color, 0.15) + ';' +
      'color:' + tag.color + ';' +
      'border:1px solid ' + hexToRgba(tag.color, 0.3) + ';' +
      'padding-right:18px;'
    );
    btn.addEventListener('click', function() { setFilter('tag:' + tag.id, btn); });

    var del = document.createElement('span');
    del.textContent = '×';
    del.title = 'Delete tag';
    del.style.cssText = (
      'position:absolute;right:4px;top:50%;transform:translateY(-50%);' +
      'font-size:11px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s;' +
      'color:' + tag.color + ';'
    );
    del.addEventListener('click', function(e) {
      e.stopPropagation();
      allTags = allTags.filter(function(tg) { return tg.id !== tag.id; });
      renderTagFilters();
      var undone = false;
      var timer = setTimeout(function() {
        if (!undone) fetch('/api/tags/' + tag.id, { method: 'DELETE', headers: authHeaders() }).then(function() { loadTags(); });
      }, 8000);
      showToast('Tag deleted', 'Undo', function() {
        undone = true; clearTimeout(timer); loadTags();
      });
    });

    wrap.addEventListener('mouseenter', function() { del.style.opacity = '1'; });
    wrap.addEventListener('mouseleave', function() { del.style.opacity = '0'; });

    wrap.appendChild(btn);
    wrap.appendChild(del);
    container.appendChild(wrap);
  });

  // "+ New tag" toggle button
  var addBtn = document.createElement('button');
  addBtn.className = 'filter-btn';
  addBtn.textContent = '+ Tag';
  addBtn.style.cssText = 'opacity:0.5;font-size:10px;';
  addBtn.addEventListener('click', function() {
    var existing = document.getElementById('new-tag-form');
    if (existing) { existing.remove(); return; }
    var form = document.createElement('span');
    form.id = 'new-tag-form';
    form.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin-left:4px';
    var nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.placeholder = 'Tag name';
    nameInp.style.cssText = 'font-size:11px;padding:2px 6px;width:90px';
    var colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.value = '#4a90d9';
    colorInp.style.cssText = 'width:26px;height:22px;padding:1px;cursor:pointer;border:none';
    var saveBtn = document.createElement('button');
    saveBtn.textContent = '✓';
    saveBtn.style.cssText = 'font-size:10px;padding:1px 6px';
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = '✕';
    cancelBtn.style.cssText = 'font-size:10px;padding:1px 6px';
    async function doCreate() {
      var name = nameInp.value.trim();
      if (!name) return;
      var resp = await fetch('/api/tags', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ name: name, color: colorInp.value }),
      });
      if (resp.ok) { await loadTags(); } else {
        var err = await resp.json().catch(function() { return {}; });
        showToast(err.detail || 'Failed to create tag');
      }
    }
    saveBtn.addEventListener('click', doCreate);
    cancelBtn.addEventListener('click', function() { form.remove(); });
    nameInp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doCreate();
      if (e.key === 'Escape') form.remove();
    });
    form.appendChild(nameInp);
    form.appendChild(colorInp);
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);
    container.appendChild(form);
    nameInp.focus();
  });
  container.appendChild(addBtn);
}

// Tasks
async function loadTasks() {
  try {
    var resp = await fetch('/api/tasks', { headers: authHeaders() });
    if (!resp.ok) { if (resp.status === 401) showLogin(); return; }
    allTasks = await resp.json();
    var _pid = activeFilter.indexOf('project:') === 0 ? parseInt(activeFilter.split(':')[1]) : undefined;
    await loadStatuses(_pid);
    renderCurrentView();
    updateOverdueBadge();
    loadDashboard();
  } catch (e) {
    var listEl = document.getElementById('task-list');
    if (listEl) {
      _clearEl(listEl);
      var errDiv = document.createElement('div');
      errDiv.className = 'load-error';
      var errMsg = document.createElement('span');
      errMsg.textContent = 'Could not load tasks. Check your connection. ';
      var retryBtn = document.createElement('button');
      retryBtn.textContent = 'Try again';
      retryBtn.addEventListener('click', loadTasks);
      errDiv.appendChild(errMsg);
      errDiv.appendChild(retryBtn);
      listEl.appendChild(errDiv);
    }
  }
}

function renderOnboardingTip() {
  var tip = document.getElementById('onboarding-tip');
  if (!tip) return;
  if (localStorage.getItem('mytask-tip-seen') || allTasks.length > 0) {
    tip.style.display = 'none';
    return;
  }
  if (tip.dataset.built) { tip.style.display = ''; return; }
  tip.dataset.built = '1';

  tip.className = 'onboarding-tip';

  var text = document.createElement('div');
  text.className = 'onboarding-tip-text';

  var kbd = document.createElement('kbd');
  kbd.textContent = 'N';
  var line1 = document.createTextNode(' = new task. AI chat (');
  var arrow = document.createTextNode('↘');
  var line2 = document.createTextNode(') can create and update tasks by description. Projects unlock Board view and custom statuses.');
  text.appendChild(kbd);
  text.appendChild(line1);
  text.appendChild(arrow);
  text.appendChild(line2);

  var dismiss = document.createElement('button');
  dismiss.className = 'onboarding-tip-dismiss';
  dismiss.textContent = 'Got it';
  dismiss.addEventListener('click', function() {
    localStorage.setItem('mytask-tip-seen', '1');
    tip.style.display = 'none';
  });

  tip.appendChild(text);
  tip.appendChild(dismiss);
  tip.style.display = 'flex';
}

// Dashboard
async function loadDashboard() {
  try {
    var resp = await fetch('/api/dashboard', { headers: authHeaders() });
    if (!resp.ok) return;
    var data = await resp.json();

    var strip = document.getElementById('dashboard-strip');
    if (strip) {
      strip.style.display = 'block';
      document.getElementById('stat-overdue-num').textContent = data.overdue;
      document.getElementById('stat-today-num').textContent = data.due_today;
      document.getElementById('stat-week-num').textContent = data.due_week;
      document.getElementById('stat-coming-num').textContent = data.due_30;
      var briefingEl = document.getElementById('dashboard-briefing');
      if (briefingEl) {
        if (data.ai_briefing) {
          document.getElementById('briefing-text').textContent = data.ai_briefing;
          briefingEl.style.display = 'flex';
        } else {
          briefingEl.style.display = 'none';
        }
      }
    }

    renderOnboardingTip();
    if (currentPage !== 'dashboard') return;
    renderDashTaskLists(data);
    renderDashProjects(data);
    renderDashSparkline(data);
    renderDashActivity(data);
  } catch (e) { console.warn('Dashboard load failed:', e); }
}

function _clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function renderDashTaskLists(data) {
  var container = document.getElementById('dashboard-task-lists');
  if (!container) return;
  _clearEl(container);

  function makeList(tasks, title, dueLabelFn) {
    if (!tasks || tasks.length === 0) return;
    var wrap = document.createElement('div');
    wrap.className = 'dash-task-list';
    var h = document.createElement('div');
    h.className = 'dash-section-title';
    h.textContent = title + ' (' + tasks.length + ')';
    wrap.appendChild(h);
    tasks.forEach(function(t) {
      var row = document.createElement('div');
      row.className = 'dash-task-item';
      var dot = document.createElement('span');
      dot.className = 'dash-priority-dot ' + (t.priority || 'medium');
      row.appendChild(dot);
      var titleEl = document.createElement('span');
      titleEl.className = 'dash-task-title';
      titleEl.textContent = t.title;
      row.appendChild(titleEl);
      if (t.project_name) {
        var proj = document.createElement('span');
        proj.className = 'dash-task-project';
        proj.textContent = t.project_name;
        row.appendChild(proj);
      }
      if (t.due_date) {
        var due = document.createElement('span');
        due.className = 'dash-task-due';
        due.textContent = dueLabelFn(t.due_date);
        row.appendChild(due);
      }
      row.addEventListener('click', function() {
        expandedTaskId = t.id;
        navigateTo('tasks');
      });
      wrap.appendChild(row);
    });
    container.appendChild(wrap);
  }

  function overdueLabel(d) {
    var days = Math.round((new Date() - new Date(d + 'T00:00:00')) / 86400000);
    return days <= 0 ? 'today' : days === 1 ? '1 day overdue' : days + ' days overdue';
  }

  makeList(data.overdue_tasks, 'Overdue', overdueLabel);
  makeList(data.today_tasks, 'Due Today', function() { return 'today'; });

  var hasLists = (data.overdue_tasks && data.overdue_tasks.length > 0) ||
                 (data.today_tasks && data.today_tasks.length > 0);
  if (!hasLists) {
    var emptyDash = document.createElement('div');
    emptyDash.className = 'dash-empty-state';
    var emptyText = document.createElement('p');
    emptyText.textContent = 'Nothing overdue or due today.';
    var emptyHint = document.createElement('p');
    emptyHint.className = 'dash-empty-hint';
    emptyHint.textContent = 'Use the Tasks page to plan ahead, or tell the AI what to add.';
    emptyDash.appendChild(emptyText);
    emptyDash.appendChild(emptyHint);
    container.appendChild(emptyDash);
  }
}

function renderDashProjects(data) {
  var container = document.getElementById('dashboard-projects');
  if (!container) return;
  _clearEl(container);
  if (!data.projects || data.projects.length === 0) return;

  var title = document.createElement('div');
  title.className = 'dash-section-title';
  title.textContent = 'Project Progress';
  container.appendChild(title);

  var grid = document.createElement('div');
  grid.className = 'dash-project-grid';

  data.projects.forEach(function(proj) {
    var card = document.createElement('div');
    card.className = 'dash-project-card';

    var name = document.createElement('div');
    name.className = 'dash-project-name';
    name.textContent = proj.name;
    card.appendChild(name);

    var counts = document.createElement('div');
    counts.className = 'dash-project-counts';
    counts.textContent = proj.done + ' / ' + proj.total + ' done';
    card.appendChild(counts);

    var track = document.createElement('div');
    track.className = 'dash-progress-track';
    var fill = document.createElement('div');
    fill.className = 'dash-progress-fill';
    fill.style.transform = 'scaleX(' + (proj.total > 0 ? proj.done / proj.total : 0) + ')';
    track.appendChild(fill);
    card.appendChild(track);

    card.addEventListener('click', function() {
      navigateTo('tasks');
      var btn = document.querySelector('[data-project-id="' + proj.id + '"]');
      if (btn) btn.click();
    });

    grid.appendChild(card);
  });
  container.appendChild(grid);
}
function renderDashSparkline(data) {
  var container = document.getElementById('dashboard-sparkline');
  if (!container) return;
  _clearEl(container);
  if (!data.completed_7d) return;

  var title = document.createElement('div');
  title.className = 'dash-section-title';
  title.textContent = 'Completed Last 7 Days';
  container.appendChild(title);

  var chart = document.createElement('div');
  chart.className = 'dash-sparkline';
  var maxVal = Math.max.apply(null, data.completed_7d) || 1;
  var dayLabels = ['6d', '5d', '4d', '3d', '2d', 'Yest', 'Today'];
  data.completed_7d.forEach(function(count, i) {
    var wrap = document.createElement('div');
    wrap.className = 'dash-spark-bar-wrap';
    var bar = document.createElement('div');
    bar.className = 'dash-spark-bar';
    bar.style.height = Math.round((count / maxVal) * 100) + '%';
    bar.title = count + ' completed';
    wrap.appendChild(bar);
    var lbl = document.createElement('div');
    lbl.className = 'dash-spark-label';
    lbl.textContent = dayLabels[i];
    wrap.appendChild(lbl);
    chart.appendChild(wrap);
  });
  container.appendChild(chart);

  var total = data.completed_7d.reduce(function(a, b) { return a + b; }, 0);
  var tot = document.createElement('div');
  tot.className = 'dash-sparkline-total';
  tot.textContent = total + ' task' + (total !== 1 ? 's' : '') + ' completed this week';
  container.appendChild(tot);
}

function renderDashActivity(data) {
  var container = document.getElementById('dashboard-activity');
  if (!container) return;
  _clearEl(container);
  if (!data.recent_activity || data.recent_activity.length === 0) return;

  var title = document.createElement('div');
  title.className = 'dash-section-title';
  title.textContent = 'Recent Activity';
  container.appendChild(title);

  function relTime(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    return days === 1 ? 'yesterday' : days + 'd ago';
  }

  data.recent_activity.forEach(function(t) {
    var row = document.createElement('div');
    row.className = 'dash-activity-item';
    var dot = document.createElement('span');
    dot.className = 'dash-priority-dot ' + (t.priority || 'medium');
    row.appendChild(dot);
    var ttl = document.createElement('span');
    ttl.className = 'dash-activity-title-text';
    ttl.textContent = t.title;
    row.appendChild(ttl);
    var time = document.createElement('span');
    time.className = 'dash-activity-time';
    time.textContent = relTime(t.updated_at);
    row.appendChild(time);
    row.addEventListener('click', function() {
      expandedTaskId = t.id;
      navigateTo('tasks');
    });
    container.appendChild(row);
  });
}

// Filters
function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  // Reload statuses for the selected project (or defaults if "All")
  if (filter.indexOf('project:') === 0) {
    var pid = parseInt(filter.split(':')[1]);
    loadStatuses(pid).then(function() { renderCurrentView(); });
  } else {
    loadStatuses().then(function() { renderCurrentView(); });
  }
}

function filteredTasks() {
  var today = new Date().toISOString().split('T')[0];
  if (activeFilter === 'today') {
    return allTasks.filter(function(t) { return t.due_date === today; });
  }
  if (activeFilter === 'overdue') {
    return allTasks.filter(function(t) {
      return t.due_date && t.due_date < today && t.status_name !== 'Done';
    });
  }
  if (activeFilter.indexOf('project:') === 0) {
    var pid = parseInt(activeFilter.split(':')[1]);
    return allTasks.filter(function(t) { return t.project_id === pid; });
  }
  if (activeFilter.indexOf('tag:') === 0) {
    var tid = parseInt(activeFilter.split(':')[1]);
    return allTasks.filter(function(t) {
      return t.tags && t.tags.some(function(tag) { return tag.id === tid; });
    });
  }
  return allTasks;
}

// Task cards
function buildTaskCard(t) {
  var today = new Date().toISOString().split('T')[0];
  var card = document.createElement('div');
  card.className = 'task-card priority-' + t.priority + (t.status_name === 'Done' ? ' status-done' : '');
  card.id = 'task-card-' + t.id;
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', t.title);
  card.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTask(t.id); }
  });

  var top = document.createElement('div');
  top.className = 'task-card-top';
  var titleEl = document.createElement('div');
  titleEl.className = 'task-title';
  titleEl.textContent = t.title;
  var badge = document.createElement('span');
  badge.className = 'priority-badge ' + t.priority;
  badge.textContent = t.priority.toUpperCase();
  top.appendChild(titleEl);
  top.appendChild(badge);
  card.appendChild(top);

  // Due date / project meta
  var metaParts = [];
  if (t.project_name) metaParts.push(t.project_name);
  if (t.start_date) metaParts.push('Start ' + relativeDate(t.start_date));
  if (t.due_date) metaParts.push('Due ' + relativeDate(t.due_date));
  if (metaParts.length) {
    var meta = document.createElement('div');
    meta.className = 'task-meta';
    meta.textContent = metaParts.join(' · ');
    card.appendChild(meta);
  }

  // Tag pills + subtask indicator row
  var hasInfo = false;
  var infoRow = document.createElement('div');
  infoRow.className = 'tag-pills';
  if (t.tags && t.tags.length > 0) {
    t.tags.forEach(function(tag) {
      var pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = tag.name;
      pill.style.cssText = (
        'background:' + hexToRgba(tag.color, 0.2) + ';' +
        'color:' + tag.color + ';' +
        'border-color:' + hexToRgba(tag.color, 0.35) + ';'
      );
      infoRow.appendChild(pill);
      hasInfo = true;
    });
  }
  if (t.subtask_count > 0) {
    var indicator = document.createElement('span');
    indicator.className = 'subtask-indicator';
    indicator.textContent = '☑ ' + t.completed_subtasks + '/' + t.subtask_count + ' steps';
    infoRow.appendChild(indicator);
    hasInfo = true;
  }
  if (hasInfo) card.appendChild(infoRow);

  // Expanded detail
  var detail = document.createElement('div');
  detail.className = 'task-detail' + (expandedTaskId === t.id ? ' open' : '');
  detail.id = 'task-detail-' + t.id;
  detail.addEventListener('click', function(e) { e.stopPropagation(); });

  // Status + delete actions
  var actions = document.createElement('div');
  actions.className = 'task-detail-actions';
  var statusSel = document.createElement('select');
  allStatuses.forEach(function(s) {
    var opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    if (t.status_id === s.id) opt.selected = true;
    statusSel.appendChild(opt);
  });
  statusSel.addEventListener('change', function() {
    updateTaskStatus(t.id, parseInt(statusSel.value));
  });
  var delBtn = document.createElement('button');
  delBtn.className = 'btn-danger';
  delBtn.textContent = 'Delete';
  delBtn.style.marginLeft = 'auto';
  delBtn.addEventListener('click', function() { deleteTask(t.id); });
  var editBtn = document.createElement('button');
  editBtn.className = 'btn-secondary';
  editBtn.textContent = '✏ Edit';
  editBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (editingTaskId === t.id) {
      hideTaskEditForm(t.id);
    } else {
      if (editingTaskId !== null) {
        var prevForm = document.getElementById('task-edit-form-' + editingTaskId);
        if (prevForm) prevForm.remove();
        editingTaskId = null;
      }
      editingTaskId = t.id;
      showTaskEditForm(t, detail);
    }
  });
  actions.appendChild(statusSel);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  detail.appendChild(actions);

  var notesContainer = document.createElement('div');
  notesContainer.className = 'task-notes-container';
  renderNotesDisplay(t.notes, notesContainer);
  detail.appendChild(notesContainer);

  // Tag picker
  if (allTags.length > 0) {
    var tagSection = document.createElement('div');
    tagSection.className = 'tag-picker-section';
    var tagLabel = document.createElement('div');
    tagLabel.className = 'tag-picker-label';
    tagLabel.textContent = 'Tags';
    tagSection.appendChild(tagLabel);
    var tagList = document.createElement('div');
    tagList.className = 'tag-picker-list';
    allTags.forEach(function(tag) {
      var assigned = t.tags && t.tags.some(function(tt) { return tt.id === tag.id; });
      var item = document.createElement('span');
      item.className = 'tag-picker-item' + (assigned ? ' assigned' : '');
      item.textContent = tag.name;
      item.style.cssText = (
        'background:' + hexToRgba(tag.color, 0.2) + ';' +
        'color:' + tag.color + ';' +
        'border-color:' + hexToRgba(tag.color, 0.35) + ';'
      );
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        if (assigned) {
          removeTagFromTask(t.id, tag.id);
        } else {
          addTagToTask(t.id, tag.id);
        }
      });
      tagList.appendChild(item);
    });
    tagSection.appendChild(tagList);
    detail.appendChild(tagSection);
  }

  // Subtask checklist
  var subtaskSection = document.createElement('div');
  subtaskSection.className = 'subtask-section';
  if (expandedTaskId === t.id) {
    loadAndRenderSubtasks(t.id, subtaskSection);
    renderTaskDocs(t, detail);
    renderTaskAIActions(t, detail);
  }
  detail.appendChild(subtaskSection);

  card.appendChild(detail);
  card.addEventListener('click', function() { toggleTask(t.id); });
  return card;
}

function buildInlineAddRow(statusId, projectId) {
  var row = document.createElement('div');
  row.className = 'inline-add-row';

  var trigger = document.createElement('button');
  trigger.className = 'inline-add-trigger';
  var plus = document.createElement('span');
  plus.textContent = '+';
  var lbl = document.createElement('span');
  lbl.textContent = 'Add a task…';
  trigger.appendChild(plus);
  trigger.appendChild(lbl);
  row.appendChild(trigger);

  trigger.addEventListener('click', function() {
    trigger.style.display = 'none';
    var form = document.createElement('div');
    form.className = 'inline-add-form';
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Task title…';
    form.appendChild(inp);
    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:4px;flex-shrink:0';
    var saveBtn = document.createElement('button');
    saveBtn.className = 'inline-add-save';
    saveBtn.textContent = 'Add';
    btns.appendChild(saveBtn);
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'inline-add-cancel';
    cancelBtn.textContent = '✕';
    btns.appendChild(cancelBtn);
    form.appendChild(btns);
    row.appendChild(form);
    inp.focus();

    function cancel() { form.remove(); trigger.style.display = ''; }
    async function submit() {
      var title = inp.value.trim();
      if (!title) { inp.focus(); return; }
      saveBtn.disabled = true;
      var body = { title: title };
      if (statusId) body.status_id = statusId;
      if (projectId) body.project_id = projectId;
      var resp = await fetch('/api/tasks', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      if (resp.ok) {
        localStorage.setItem('mytask-tip-seen', '1');
        await loadTasks();
      } else {
        saveBtn.disabled = false;
        inp.focus();
      }
    }

    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { cancel(); }
    });
    saveBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
  });

  return row;
}

function renderTasks() {
  var tasks = filteredTasks();
  var today = new Date().toISOString().split('T')[0];
  var container = document.getElementById('task-list');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (tasks.length === 0) {
    var emptyWrap = document.createElement('div');
    emptyWrap.className = 'task-list-empty';
    var emptyMsg = document.createElement('p');
    emptyMsg.textContent = activeFilter === 'all' ? 'No tasks yet.' : 'No tasks match this filter.';
    emptyWrap.appendChild(emptyMsg);
    if (activeFilter === 'all') {
      var emptyBtn = document.createElement('button');
      emptyBtn.textContent = '+ New Task';
      emptyBtn.addEventListener('click', function() { openNewTaskModal(null, null, null); });
      emptyWrap.appendChild(emptyBtn);
    }
    container.appendChild(emptyWrap);
    return;
  }

  var overdueGroup = tasks.filter(function(t) {
    return t.due_date && t.due_date < today && t.status_name !== 'Done';
  });
  var remaining = tasks.filter(function(t) {
    return !(t.due_date && t.due_date < today && t.status_name !== 'Done');
  });

  if (overdueGroup.length > 0) {
    var label = document.createElement('div');
    label.className = 'task-group-label overdue';
    label.textContent = 'OVERDUE';
    container.appendChild(label);
    overdueGroup.forEach(function(t) { container.appendChild(buildTaskCard(t)); });
  }

  // Group remaining tasks by status name
  var statusOrder = allStatuses.length > 0
    ? allStatuses.map(function(s) { return s.name; })
    : ['Todo', 'In Progress', 'Done'];

  var showInlineAdd = activeFilter === 'all' || activeFilter.indexOf('project:') === 0;
  var inlineAddPid = activeFilter.indexOf('project:') === 0 ? parseInt(activeFilter.split(':')[1]) : null;

  statusOrder.forEach(function(sName) {
    var group = remaining.filter(function(t) { return t.status_name === sName; });
    if (group.length === 0) return;
    var label = document.createElement('div');
    var cssKey = sName === 'Done' ? 'done' : sName === 'In Progress' ? 'in-progress' : 'todo';
    label.className = 'task-group-label ' + cssKey;
    label.textContent = sName.toUpperCase();
    container.appendChild(label);
    group.forEach(function(t) { container.appendChild(buildTaskCard(t)); });
    if (showInlineAdd) {
      var status = allStatuses.find(function(s) { return s.name === sName; });
      if (status) container.appendChild(buildInlineAddRow(status.id, inlineAddPid));
    }
  });

  // Tasks whose status_name doesn't match any known status
  var knownNames = new Set(statusOrder);
  var unknown = remaining.filter(function(t) { return !knownNames.has(t.status_name); });
  unknown.forEach(function(t) { container.appendChild(buildTaskCard(t)); });
}

// View switching
function renderCurrentView() {
  if (currentView === 'list') renderTasks();
  else if (currentView === 'board') renderBoard();
  else if (currentView === 'calendar') renderCalendar();
  else if (currentView === 'timeline') renderTimeline();
  else if (currentView === 'table') renderTable();
}

function switchView(view) {
  currentView = view;
  ['list', 'board', 'calendar', 'timeline', 'table'].forEach(function(v) {
    var el = document.getElementById('view-' + v);
    if (el) el.style.display = v === view ? 'flex' : 'none';
  });
  document.querySelectorAll('.view-tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  renderCurrentView();
}

function renderCalendar() {
  var grid = document.getElementById('calendar-grid');
  var label = document.getElementById('cal-month-label');
  if (!grid || !label || !currentCalendarMonth) return;
  while (grid.firstChild) grid.removeChild(grid.firstChild);

  var y = currentCalendarMonth.year;
  var m = currentCalendarMonth.month;
  var monthNames = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  label.textContent = monthNames[m] + ' ' + y;

  var today = new Date().toISOString().split('T')[0];
  var firstDay = new Date(y, m, 1).getDay();
  var daysInMonth = new Date(y, m + 1, 0).getDate();
  var numWeeks = Math.ceil((firstDay + daysInMonth) / 7);
  var monthStr = y + '-' + String(m + 1).padStart(2, '0');

  // Day headers row
  var headerRow = document.createElement('div');
  headerRow.className = 'cal-header-row';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(d) {
    var h = document.createElement('div');
    h.className = 'cal-day-header';
    h.textContent = d;
    headerRow.appendChild(h);
  });
  grid.appendChild(headerRow);

  function cellDateStr(idx) {
    var dt = new Date(y, m, 1 - firstDay + idx);
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }

  // Collect task bars
  var taskBars = [];
  filteredTasks().forEach(function(t) {
    var from = t.start_date || t.due_date;
    var to = t.due_date || t.start_date;
    if (!from) return;
    taskBars.push({ task: t, from: from, to: to });
  });

  for (var week = 0; week < numWeeks; week++) {
    var weekStartIdx = week * 7;
    var weekStartDate = cellDateStr(weekStartIdx);
    var weekEndDate = cellDateStr(weekStartIdx + 6);
    var hasToday = today >= weekStartDate && today <= weekEndDate;

    var weekEl = document.createElement('div');
    weekEl.className = 'cal-week' + (hasToday ? ' has-today' : '');

    // Cells layer (date numbers + click to add)
    var cellsLayer = document.createElement('div');
    cellsLayer.className = 'cal-cells-layer';
    for (var col = 0; col < 7; col++) {
      var dateStr = cellDateStr(weekStartIdx + col);
      var isCurrentMonth = dateStr.slice(0, 7) === monthStr;
      var cell = document.createElement('div');
      cell.className = 'cal-cell' +
        (isCurrentMonth ? '' : ' other-month') +
        (dateStr === today ? ' today' : '');
      var dateEl = document.createElement('div');
      dateEl.className = 'cal-date';
      dateEl.textContent = parseInt(dateStr.slice(8), 10);
      cell.appendChild(dateEl);
      cell.addEventListener('click', function(ds) {
        return function() { openNewTaskModal(ds, null, null); };
      }(dateStr));
      cellsLayer.appendChild(cell);
    }
    weekEl.appendChild(cellsLayer);

    // Bars for tasks overlapping this week
    var weekBars = [];
    taskBars.forEach(function(tb) {
      if (tb.from > weekEndDate || tb.to < weekStartDate) return;
      var clampedFrom = tb.from < weekStartDate ? weekStartDate : tb.from;
      var clampedTo   = tb.to   > weekEndDate   ? weekEndDate   : tb.to;
      var colStart = new Date(clampedFrom + 'T00:00:00').getDay() + 1;
      var colEnd   = new Date(clampedTo   + 'T00:00:00').getDay() + 2;
      weekBars.push({ tb: tb, colStart: colStart, colEnd: colEnd,
        isStart: tb.from >= weekStartDate, isEnd: tb.to <= weekEndDate });
    });

    if (weekBars.length > 0) {
      weekBars.sort(function(a, b) {
        if (a.colStart !== b.colStart) return a.colStart - b.colStart;
        return (b.colEnd - b.colStart) - (a.colEnd - a.colStart);
      });
      // Greedy track assignment to avoid overlapping bars
      var trackEnds = [];
      weekBars.forEach(function(wb) {
        var track = -1;
        for (var ti = 0; ti < trackEnds.length; ti++) {
          if (trackEnds[ti] <= wb.colStart) { track = ti; trackEnds[ti] = wb.colEnd; break; }
        }
        if (track === -1) { track = trackEnds.length; trackEnds.push(wb.colEnd); }
        wb.track = track;
      });

      var barsLayer = document.createElement('div');
      barsLayer.className = 'cal-bars-layer';

      weekBars.forEach(function(wb) {
        var bar = document.createElement('div');
        bar.className = 'cal-bar priority-' + (wb.tb.task.priority || 'medium') +
          (wb.isStart ? ' cal-bar-start' : '') +
          (wb.isEnd   ? ' cal-bar-end'   : '');
        bar.title = wb.tb.task.title;
        if (wb.isStart) bar.textContent = wb.tb.task.title;
        bar.style.gridColumn = wb.colStart + ' / ' + wb.colEnd;
        bar.style.gridRow = (wb.track + 1) + '';
        bar.addEventListener('click', function(task) {
          return function(e) {
            e.stopPropagation();
            navigateTo('tasks');
            switchView('list');
            expandedTaskId = task.id;
            renderTasks();
          };
        }(wb.tb.task));
        barsLayer.appendChild(bar);
      });
      weekEl.appendChild(barsLayer);
    }

    grid.appendChild(weekEl);
  }
}

function renderTimeline() {
  var rowsEl = document.getElementById('timeline-rows');
  var rangeLabel = document.getElementById('tl-range-label');
  if (!rowsEl || !rangeLabel) return;
  while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild);

  var tasksWithDate = filteredTasks().filter(function(t) { return t.start_date || t.due_date; });
  var tasksNoDate   = filteredTasks().filter(function(t) { return !t.start_date && !t.due_date; });

  if (tasksWithDate.length === 0 && tasksNoDate.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'tl-empty';
    empty.textContent = 'No tasks with dates yet';
    rowsEl.appendChild(empty);
    rangeLabel.textContent = '';
    return;
  }

  // Compute date window from all start and due dates
  var dates = [];
  tasksWithDate.forEach(function(t) {
    if (t.start_date) dates.push(new Date(t.start_date + 'T00:00:00'));
    if (t.due_date)   dates.push(new Date(t.due_date   + 'T00:00:00'));
  });
  if (!dates.length) dates = [new Date()];
  var minDate = new Date(Math.min.apply(null, dates));
  var maxDate = new Date(Math.max.apply(null, dates));

  minDate.setDate(minDate.getDate() - 3 + currentTimelineOffset);
  maxDate.setDate(maxDate.getDate() + 7 + currentTimelineOffset);

  var windowDays = Math.max(14, Math.round((maxDate - minDate) / 86400000) + 1);
  maxDate = new Date(minDate);
  maxDate.setDate(minDate.getDate() + windowDays - 1);

  var fmt = function(d) { return (d.getMonth()+1) + '/' + d.getDate(); };
  rangeLabel.textContent = fmt(minDate) + ' — ' + fmt(maxDate);

  function dateToPercent(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    var diff = Math.round((d - minDate) / 86400000);
    return (diff / windowDays) * 100;
  }

  // Date header ticks (every 7 days)
  var header = document.createElement('div');
  header.className = 'tl-date-header';
  for (var i = 0; i < windowDays; i += 7) {
    var tick = document.createElement('div');
    tick.className = 'tl-date-tick';
    var d = new Date(minDate); d.setDate(minDate.getDate() + i);
    tick.textContent = fmt(d);
    tick.style.width = Math.min(7, windowDays - i) / windowDays * 100 + '%';
    header.appendChild(tick);
  }
  rowsEl.appendChild(header);

  // Task rows
  tasksWithDate.forEach(function(t) {
    var row = document.createElement('div');
    row.className = 'tl-row';
    var lbl = document.createElement('div');
    lbl.className = 'tl-row-label';
    lbl.textContent = t.title;
    lbl.title = t.title;
    row.appendChild(lbl);
    var barArea = document.createElement('div');
    barArea.className = 'tl-row-bar-area';
    var bar = document.createElement('div');
    bar.className = 'gantt-bar priority-' + t.priority;
    var barStart = t.start_date || t.due_date;
    var barEnd   = t.due_date   || t.start_date;
    var leftPct  = dateToPercent(barStart);
    var rightPct = dateToPercent(barEnd);
    var widthPct = Math.max((1 / windowDays) * 100, rightPct - leftPct + (1 / windowDays) * 100);
    bar.style.left  = leftPct + '%';
    bar.style.width = widthPct + '%';
    var titleParts = [t.title];
    if (t.start_date) titleParts.push('start ' + t.start_date);
    if (t.due_date)   titleParts.push('due ' + t.due_date);
    bar.title = titleParts.join(' · ');

    // Drag to shift bar (moves both start_date and due_date together)
    var dragStartX = null;
    var origLeft = null;
    bar.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragStartX = e.clientX;
      origLeft = leftPct;
      var barAreaRect = barArea.getBoundingClientRect();
      var barAreaWidth = barAreaRect.width;
      function onMove(ev) {
        var dx = ev.clientX - dragStartX;
        var daysDelta = Math.round((dx / barAreaWidth) * windowDays);
        var newPct = Math.max(0, Math.min(origLeft + (daysDelta / windowDays) * 100, 100 - widthPct));
        bar.style.left = newPct + '%';
      }
      function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        var dx = ev.clientX - dragStartX;
        var daysDelta = Math.round((dx / barAreaRect.width) * windowDays);
        if (daysDelta !== 0) {
          var updates = {};
          if (t.due_date) {
            var d1 = new Date(t.due_date + 'T00:00:00');
            d1.setDate(d1.getDate() + daysDelta);
            updates.due_date = d1.toISOString().split('T')[0];
          }
          if (t.start_date) {
            var d2 = new Date(t.start_date + 'T00:00:00');
            d2.setDate(d2.getDate() + daysDelta);
            updates.start_date = d2.toISOString().split('T')[0];
          }
          fetch('/api/tasks/' + t.id, {
            method: 'PUT', headers: authHeaders(),
            body: JSON.stringify(updates),
          }).then(function() { loadTasks(); });
        } else {
          bar.style.left = leftPct + '%';
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    barArea.appendChild(bar);
    row.appendChild(barArea);
    rowsEl.appendChild(row);
  });

  // "No due date" section
  if (tasksNoDate.length > 0) {
    var sep = document.createElement('div');
    sep.className = 'tl-separator';
    sep.textContent = 'No date set (' + tasksNoDate.length + ')';
    rowsEl.appendChild(sep);
    tasksNoDate.forEach(function(t) {
      var row = document.createElement('div');
      row.className = 'tl-row';
      var lbl = document.createElement('div');
      lbl.className = 'tl-row-label';
      lbl.textContent = t.title;
      row.appendChild(lbl);
      var dash = document.createElement('div');
      dash.style.cssText = 'flex:1;color:var(--text-dim);font-size:10px;display:flex;align-items:center;padding-left:8px';
      dash.textContent = '— no date';
      row.appendChild(dash);
      rowsEl.appendChild(row);
    });
  }
}

function renderBoard() {
  var container = document.getElementById('board-columns');
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  var tasks = filteredTasks();

  function buildBoardColumn(status, colTasks, showAddCard) {
    var col = document.createElement('div');
    col.className = 'board-column';
    col.dataset.statusId = status.id;

    var header = document.createElement('div');
    header.className = 'board-column-header';
    var dot = document.createElement('span');
    dot.className = 'board-column-dot';
    dot.style.background = status.color;
    var nameEl = document.createElement('span');
    nameEl.className = 'board-column-name';
    nameEl.textContent = status.name;
    var countEl = document.createElement('span');
    countEl.className = 'board-column-count';
    countEl.textContent = colTasks.length;
    header.appendChild(dot);
    header.appendChild(nameEl);
    header.appendChild(countEl);
    col.appendChild(header);

    var cards = document.createElement('div');
    cards.className = 'board-column-cards';
    colTasks.forEach(function(t) { cards.appendChild(buildBoardCard(t)); });
    col.appendChild(cards);

    col.addEventListener('dragover', function(e) { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', function() { col.classList.remove('drag-over'); });
    col.addEventListener('drop', function(e) {
      e.preventDefault();
      col.classList.remove('drag-over');
      var taskId = parseInt(e.dataTransfer.getData('text/plain'));
      if (taskId) {
        var prevStatusId = (allTasks.find(function(tt) { return tt.id === taskId; }) || {}).status_id;
        fetch('/api/tasks/' + taskId, {
          method: 'PUT', headers: authHeaders(),
          body: JSON.stringify({ status_id: status.id }),
        }).then(function(r) {
          if (!r.ok) { showToast('Failed to move task. Please try again.'); return loadTasks(); }
          loadTasks().then(function() {
            if (prevStatusId && prevStatusId !== status.id) {
              showToast('Moved to ' + status.name, 'Undo', function() {
                fetch('/api/tasks/' + taskId, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status_id: prevStatusId }) }).then(function() { loadTasks(); });
              });
            }
          });
        }).catch(function() { loadTasks(); });
      }
    });

    if (showAddCard) {
      var addBtn = document.createElement('button');
      addBtn.className = 'board-add-card-btn';
      addBtn.textContent = '+ Add card';
      addBtn.addEventListener('click', function() {
        var activePid = activeFilter.indexOf('project:') === 0 ? parseInt(activeFilter.split(':')[1]) : null;
        openNewTaskModal(null, activePid, status.id);
      });
      col.appendChild(addBtn);
    }

    return col;
  }

  // Primary columns from allStatuses
  // Build lookup by id AND by lowercase name so project-specific statuses
  // with the same name merge into the existing column rather than duplicate.
  var knownIds = {};
  var knownNames = {};
  allStatuses.forEach(function(s) {
    knownIds[s.id] = s;
    knownNames[s.name.toLowerCase()] = s;
  });

  // For each primary status, collect tasks matched by id OR by name (for project statuses)
  var extraTasksByPrimaryId = {};
  allStatuses.forEach(function(s) { extraTasksByPrimaryId[s.id] = []; });

  var trulyExtra = {};
  tasks.forEach(function(t) {
    if (knownIds[t.status_id]) return; // already in a primary column by id
    var nameMatch = knownNames[t.status_name ? t.status_name.toLowerCase() : ''];
    if (nameMatch) {
      extraTasksByPrimaryId[nameMatch.id].push(t); // merge into same-named column
    } else {
      if (!trulyExtra[t.status_id]) {
        trulyExtra[t.status_id] = { id: t.status_id, name: t.status_name, color: t.status_color || '#6b7280', tasks: [] };
      }
      trulyExtra[t.status_id].tasks.push(t);
    }
  });

  allStatuses.forEach(function(status) {
    var colTasks = tasks.filter(function(t) { return t.status_id === status.id; })
      .concat(extraTasksByPrimaryId[status.id]);
    container.appendChild(buildBoardColumn(status, colTasks, true));
  });

  // Columns for statuses with no name match at all
  Object.keys(trulyExtra).forEach(function(sid) {
    var entry = trulyExtra[sid];
    container.appendChild(buildBoardColumn(entry, entry.tasks, false));
  });

  // "+ Add status" column
  var addCol = document.createElement('div');
  addCol.className = 'board-add-column';
  var addColBtn = document.createElement('button');
  addColBtn.className = 'board-add-column-btn';
  addColBtn.textContent = '+ Add status';
  addColBtn.addEventListener('click', function() { showAddStatusForm(addCol, addColBtn); });
  addCol.appendChild(addColBtn);
  container.appendChild(addCol);
}

// ── Table view ──────────────────────────────────────────────────────────────

function buildTableToolbar(toolbar) {
  toolbar.textContent = '';

  var colBtn = document.createElement('button');
  colBtn.className = 'btn-secondary';
  colBtn.style.cssText = 'font-size:11px;padding:4px 10px;position:relative';
  colBtn.textContent = 'Columns';
  colBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var existing = document.querySelector('.table-col-picker');
    if (existing) { existing.remove(); return; }
    var picker = document.createElement('div');
    picker.className = 'table-col-picker';
    TABLE_COLS.forEach(function(col) {
      if (col.always) return;
      var lbl = document.createElement('label');
      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = !tableHiddenCols.includes(col.key);
      chk.addEventListener('change', function() {
        if (this.checked) {
          tableHiddenCols = tableHiddenCols.filter(function(k) { return k !== col.key; });
        } else {
          if (!tableHiddenCols.includes(col.key)) tableHiddenCols.push(col.key);
        }
        localStorage.setItem('tableHiddenCols', JSON.stringify(tableHiddenCols));
        picker.remove();
        renderTable();
      });
      lbl.appendChild(chk);
      lbl.appendChild(document.createTextNode(' ' + col.label));
      picker.appendChild(lbl);
    });
    var rect = colBtn.getBoundingClientRect();
    picker.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    picker.style.left = rect.left + 'px';
    document.body.appendChild(picker);
    document.addEventListener('click', function removePicker() {
      picker.remove();
      document.removeEventListener('click', removePicker);
    });
  });
  toolbar.appendChild(colBtn);

  if (tableSort.col) {
    var sortIndicator = document.createElement('span');
    sortIndicator.style.cssText = 'font-size:11px;color:var(--text-dim);cursor:pointer';
    var col = TABLE_COLS.find(function(c) { return c.key === tableSort.col; });
    sortIndicator.textContent = '↕ ' + (col ? col.label : tableSort.col) + ' ' + (tableSort.dir === 'asc' ? '↑' : '↓') + '  \xd7';
    sortIndicator.addEventListener('click', function() {
      tableSort = { col: null, dir: 'asc' };
      renderTable();
    });
    toolbar.appendChild(sortIndicator);
  }

  Object.keys(tableColFilters).forEach(function(colKey) {
    var vals = tableColFilters[colKey];
    if (!vals || !vals.length) return;
    var colDef = TABLE_COLS.find(function(c) { return c.key === colKey; });
    var pill = document.createElement('span');
    pill.className = 'table-filter-pill';
    pill.appendChild(document.createTextNode((colDef ? colDef.label : colKey) + ': ' + vals.join(', ')));
    var x = document.createElement('button');
    x.className = 'table-filter-pill-clear';
    x.textContent = '\xd7';
    x.addEventListener('click', function() {
      delete tableColFilters[colKey];
      localStorage.setItem('tableColFilters', JSON.stringify(tableColFilters));
      renderTable();
    });
    pill.appendChild(x);
    toolbar.appendChild(pill);
  });
}

function getVisibleCols() {
  return TABLE_COLS.filter(function(c) { return c.always || !tableHiddenCols.includes(c.key); });
}

function openTableColFilter(colKey, colLabel, rect) {
  var existing = document.querySelector('.table-col-filter-picker');
  if (existing) { existing.remove(); return; }

  var values = [];
  allTasks.filter(function(t) { return !t.parent_id; }).forEach(function(t) {
    var v = getTableColValue(t, colKey);
    if (v && values.indexOf(v) === -1) values.push(v);
  });
  values.sort();

  var current = tableColFilters[colKey] || [];
  var picker = document.createElement('div');
  picker.className = 'table-col-filter-picker';

  var hdr = document.createElement('div');
  hdr.className = 'table-col-filter-picker-hdr';
  hdr.textContent = colLabel;
  picker.appendChild(hdr);

  var allLbl = document.createElement('label');
  var allChk = document.createElement('input');
  allChk.type = 'checkbox';
  allChk.checked = current.length === 0;
  allLbl.className = 'table-col-filter-all';
  allLbl.appendChild(allChk);
  allLbl.appendChild(document.createTextNode(' (All)'));
  picker.appendChild(allLbl);

  var checkboxes = {};
  values.forEach(function(v) {
    var lbl = document.createElement('label');
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = current.length === 0 || current.indexOf(v) !== -1;
    checkboxes[v] = chk;
    allChk.addEventListener('change', function() { chk.checked = allChk.checked; });
    chk.addEventListener('change', function() {
      var allChecked = values.every(function(val) { return checkboxes[val].checked; });
      allChk.checked = allChecked;
    });
    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode(' ' + v));
    picker.appendChild(lbl);
  });

  var applyBtn = document.createElement('button');
  applyBtn.className = 'table-col-filter-apply';
  applyBtn.textContent = 'Apply';
  applyBtn.addEventListener('click', function() {
    var selected = values.filter(function(v) { return checkboxes[v].checked; });
    if (selected.length === values.length) {
      delete tableColFilters[colKey];
    } else {
      tableColFilters[colKey] = selected;
    }
    localStorage.setItem('tableColFilters', JSON.stringify(tableColFilters));
    picker.remove();
    renderTable();
  });
  picker.appendChild(applyBtn);

  picker.style.top = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);
  setTimeout(function() {
    document.addEventListener('click', function removePicker(e) {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', removePicker); }
    });
  }, 0);
}

function getTableColValue(t, colKey) {
  if (colKey === 'priority') return t.priority || 'none';
  if (colKey === 'status') return t.status_name || 'Todo';
  if (colKey === 'project') return t.project_name || '(No Project)';
  return null;
}

function sortedFilteredTasks() {
  var tasks = filteredTasks().filter(function(t) { return !t.parent_id; });
  Object.keys(tableColFilters).forEach(function(colKey) {
    var allowed = tableColFilters[colKey];
    if (!allowed || !allowed.length) return;
    tasks = tasks.filter(function(t) { return allowed.indexOf(getTableColValue(t, colKey)) !== -1; });
  });
  if (!tableSort.col) return tasks;
  var col = tableSort.col;
  var dir = tableSort.dir === 'asc' ? 1 : -1;
  return tasks.slice().sort(function(a, b) {
    var va, vb;
    if (col === 'title') { va = (a.title || '').toLowerCase(); vb = (b.title || '').toLowerCase(); return va.localeCompare(vb) * dir; }
    if (col === 'status') { va = (a.status_name || '').toLowerCase(); vb = (b.status_name || '').toLowerCase(); return va.localeCompare(vb) * dir; }
    if (col === 'priority') {
      var order = { high: 0, medium: 1, low: 2 };
      va = order[a.priority] !== undefined ? order[a.priority] : 3;
      vb = order[b.priority] !== undefined ? order[b.priority] : 3;
      return (va - vb) * dir;
    }
    if (col === 'project') { va = (a.project_name || '').toLowerCase(); vb = (b.project_name || '').toLowerCase(); return va.localeCompare(vb) * dir; }
    if (col === 'start_date' || col === 'due_date') {
      va = a[col] || 'zzzz'; vb = b[col] || 'zzzz';
      return va.localeCompare(vb) * dir;
    }
    return 0;
  });
}

function buildTableCell(t, colKey) {
  var td = document.createElement('td');
  td.dataset.col = colKey;

  if (colKey === 'title') {
    td.style.fontWeight = '600';
    td.textContent = t.title || '';
    if (!tableExpanded[t.id] && t.subtask_count > 0) {
      var badge = document.createElement('span');
      badge.style.cssText = 'margin-left:6px;font-size:10px;color:var(--text-dim);font-weight:400';
      badge.textContent = '↳ ' + t.subtask_count;
      td.appendChild(badge);
    }
    return td;
  }

  if (colKey === 'status') {
    if (t.status_name) {
      var pill = document.createElement('span');
      pill.className = 'status-pill';
      pill.textContent = t.status_name;
      if (t.status_color) pill.style.background = t.status_color + '33';
      td.appendChild(pill);
    } else {
      td.textContent = '—';
    }
    return td;
  }

  if (colKey === 'priority') {
    if (t.priority) {
      var dot = document.createElement('span');
      dot.style.cssText = 'display:inline-flex;align-items:center;gap:4px';
      var colors = { high: 'var(--danger)', medium: 'var(--warning)', low: 'var(--text-dim)' };
      var dotCircle = document.createElement('span');
      dotCircle.style.cssText = 'width:7px;height:7px;border-radius:50%;background:' + (colors[t.priority] || 'var(--text-dim)');
      dot.appendChild(dotCircle);
      dot.appendChild(document.createTextNode(t.priority));
      td.appendChild(dot);
    } else {
      td.textContent = '—';
    }
    return td;
  }

  if (colKey === 'start_date' || colKey === 'due_date') {
    var val = t[colKey];
    if (!val) { td.textContent = '—'; return td; }
    var isOverdue = colKey === 'due_date' && val < new Date().toISOString().slice(0,10) && t.status_name !== 'Done';
    td.textContent = (isOverdue ? '⚠ ' : '') + val;
    if (isOverdue) td.style.color = 'var(--danger)';
    return td;
  }

  if (colKey === 'project') {
    td.textContent = t.project_name || '—';
    return td;
  }

  if (colKey === 'tags') {
    if (t.tags && t.tags.length) {
      t.tags.forEach(function(tag) {
        var p = document.createElement('span');
        p.className = 'tag-pill';
        p.textContent = tag.name;
        p.style.background = hexToRgba(tag.color, 0.2);
        p.style.color = tag.color;
        p.style.marginRight = '3px';
        td.appendChild(p);
      });
    } else {
      td.textContent = '—';
    }
    return td;
  }

  if (colKey === 'notes') {
    var notes = t.notes || '';
    td.textContent = notes.length > 40 ? notes.slice(0, 40) + '…' : (notes || '—');
    return td;
  }

  return td;
}

function buildTableRow(t, visibleCols) {
  var tr = document.createElement('tr');
  tr.className = 'table-row-root priority-' + (t.priority || 'none');
  tr.dataset.taskId = t.id;

  var expandTd = document.createElement('td');
  expandTd.className = 'col-expand';
  if (t.subtask_count > 0) {
    expandTd.textContent = tableExpanded[t.id] ? '▼' : '►';
    expandTd.addEventListener('click', function(e) {
      e.stopPropagation();
      if (tableExpanded[t.id]) {
        delete tableExpanded[t.id];
      } else {
        tableExpanded[t.id] = true;
      }
      renderTable();
    });
  }
  tr.appendChild(expandTd);

  visibleCols.forEach(function(col) {
    var td = buildTableCell(t, col.key);
    td.addEventListener('click', function() { openTableCellEdit(t, col.key, td); });
    tr.appendChild(td);
  });

  return tr;
}

function buildSubtaskRow(child, visibleCols) {
  var tr = document.createElement('tr');
  tr.className = 'table-row-sub';
  tr.dataset.taskId = child.id;

  var expandTd = document.createElement('td');
  expandTd.className = 'col-expand';
  tr.appendChild(expandTd);

  visibleCols.forEach(function(col) {
    var td;
    if (col.key === 'title') {
      td = document.createElement('td');
      td.style.paddingLeft = '28px';
      td.textContent = '↳ ' + (child.title || '');
    } else {
      td = buildTableCell(child, col.key);
    }
    td.addEventListener('click', function() { openTableCellEdit(child, col.key, td); });
    tr.appendChild(td);
  });

  return tr;
}

function saveTableCell(taskId, field, value, onDone) {
  var body = {};
  body[field] = value;
  fetch('/api/tasks/' + taskId, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify(body)
  }).then(function(r) { return r.json(); }).then(function() {
    loadTasks();
    if (onDone) onDone();
  }).catch(function(err) { console.error('saveTableCell failed', err); });
}

function openTableCellEdit(t, colKey, td) {
  if (td.classList.contains('table-cell-edit')) return;
  td.classList.add('table-cell-edit');
  var original = td.cloneNode(true);

  function cancel() {
    td.classList.remove('table-cell-edit');
    while (td.firstChild) td.removeChild(td.firstChild);
    Array.prototype.forEach.call(original.childNodes, function(node) {
      td.appendChild(node.cloneNode(true));
    });
  }

  if (colKey === 'title') {
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = t.title || '';
    while (td.firstChild) td.removeChild(td.firstChild);
    td.appendChild(inp);
    inp.focus();
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && inp.value.trim()) {
        saveTableCell(t.id, 'title', inp.value.trim());
      }
      if (e.key === 'Escape') cancel();
    });
    inp.addEventListener('blur', function() {
      if (inp.value.trim() && inp.value.trim() !== t.title) {
        saveTableCell(t.id, 'title', inp.value.trim());
      } else {
        cancel();
      }
    });
    return;
  }

  if (colKey === 'status') {
    var sel = document.createElement('select');
    allStatuses.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === t.status_id) opt.selected = true;
      sel.appendChild(opt);
    });
    while (td.firstChild) td.removeChild(td.firstChild);
    td.appendChild(sel);
    sel.focus();
    sel.addEventListener('change', function() { saveTableCell(t.id, 'status_id', parseInt(sel.value, 10)); });
    sel.addEventListener('blur', cancel);
    return;
  }

  if (colKey === 'priority') {
    var sel2 = document.createElement('select');
    ['high', 'medium', 'low'].forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p; opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
      if (p === t.priority) opt.selected = true;
      sel2.appendChild(opt);
    });
    while (td.firstChild) td.removeChild(td.firstChild);
    td.appendChild(sel2);
    sel2.focus();
    sel2.addEventListener('change', function() { saveTableCell(t.id, 'priority', sel2.value); });
    sel2.addEventListener('blur', cancel);
    return;
  }

  if (colKey === 'start_date' || colKey === 'due_date') {
    var dateinp = document.createElement('input');
    dateinp.type = 'date';
    dateinp.value = t[colKey] || '';
    while (td.firstChild) td.removeChild(td.firstChild);
    td.appendChild(dateinp);
    dateinp.focus();
    dateinp.addEventListener('blur', function() {
      saveTableCell(t.id, colKey, dateinp.value || null);
    });
    dateinp.addEventListener('keydown', function(e) { if (e.key === 'Escape') cancel(); });
    return;
  }

  if (colKey === 'project') {
    var sel3 = document.createElement('select');
    var noOpt = document.createElement('option');
    noOpt.value = ''; noOpt.textContent = 'No project';
    if (!t.project_id) noOpt.selected = true;
    sel3.appendChild(noOpt);
    allProjects.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      if (p.id === t.project_id) opt.selected = true;
      sel3.appendChild(opt);
    });
    while (td.firstChild) td.removeChild(td.firstChild);
    td.appendChild(sel3);
    sel3.focus();
    sel3.addEventListener('change', function() {
      saveTableCell(t.id, 'project_id', sel3.value ? parseInt(sel3.value, 10) : null);
    });
    sel3.addEventListener('blur', cancel);
    return;
  }

  if (colKey === 'tags') {
    var popover = document.createElement('div');
    popover.className = 'table-col-picker';
    var currentTagIds = (t.tags || []).map(function(tg) { return tg.id; });
    allTags.forEach(function(tag) {
      var lbl = document.createElement('label');
      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = currentTagIds.indexOf(tag.id) !== -1;
      chk.addEventListener('change', function() {
        if (this.checked) {
          currentTagIds.push(tag.id);
        } else {
          currentTagIds = currentTagIds.filter(function(id) { return id !== tag.id; });
        }
        saveTableCell(t.id, 'tag_ids', currentTagIds);
      });
      lbl.appendChild(chk);
      var dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + tag.color + ';margin:0 4px';
      lbl.appendChild(dot);
      lbl.appendChild(document.createTextNode(tag.name));
      popover.appendChild(lbl);
    });
    var rect2 = td.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top = (rect2.bottom + 4) + 'px';
    popover.style.left = rect2.left + 'px';
    document.body.appendChild(popover);
    td.classList.remove('table-cell-edit');
    var removePopover = function() {
      popover.remove();
      document.removeEventListener('click', removePopover);
    };
    setTimeout(function() { document.addEventListener('click', removePopover); }, 0);
    return;
  }

  if (colKey === 'notes') {
    var popover2 = document.createElement('div');
    popover2.className = 'table-notes-popover';
    popover2.style.position = 'fixed';
    var rect3 = td.getBoundingClientRect();
    popover2.style.top = (rect3.bottom + 4) + 'px';
    popover2.style.left = rect3.left + 'px';
    var ta = document.createElement('textarea');
    ta.value = t.notes || '';
    popover2.appendChild(ta);
    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'margin-top:6px;font-size:11px;padding:3px 8px;display:block';
    saveBtn.textContent = '✓ Save';
    saveBtn.addEventListener('click', function() {
      saveTableCell(t.id, 'notes', ta.value || null);
      popover2.remove();
    });
    popover2.appendChild(saveBtn);
    document.body.appendChild(popover2);
    ta.focus();
    td.classList.remove('table-cell-edit');
    var removeNotes = function(e) {
      if (!popover2.contains(e.target)) {
        saveTableCell(t.id, 'notes', ta.value || null);
        popover2.remove();
        document.removeEventListener('click', removeNotes);
      }
    };
    setTimeout(function() { document.addEventListener('click', removeNotes); }, 0);
    return;
  }

  cancel();
}

function renderTable() {
  var toolbar = document.getElementById('table-toolbar');
  var table = document.getElementById('task-table');
  if (!toolbar || !table) return;

  buildTableToolbar(toolbar);

  var visibleCols = getVisibleCols();
  var tasks = sortedFilteredTasks();

  // Build thead
  var thead = document.createElement('thead');
  var headerRow = document.createElement('tr');
  var expandTh = document.createElement('th');
  expandTh.className = 'col-expand';
  headerRow.appendChild(expandTh);
  visibleCols.forEach(function(col) {
    var th = document.createElement('th');
    th.dataset.col = col.key;
    var labelNode = document.createTextNode(col.label);
    th.appendChild(labelNode);
    if (col.sortable) {
      th.className = 'sortable';
      if (tableSort.col === col.key) {
        th.appendChild(document.createTextNode(' ' + (tableSort.dir === 'asc' ? '↑' : '↓')));
      }
      th.addEventListener('click', function() {
        if (tableSort.col === col.key) {
          if (tableSort.dir === 'asc') {
            tableSort = { col: col.key, dir: 'desc' };
          } else {
            tableSort = { col: null, dir: 'asc' };
          }
        } else {
          tableSort = { col: col.key, dir: 'asc' };
        }
        renderTable();
      });
    }
    if (col.filterable) {
      var isActive = tableColFilters[col.key] && tableColFilters[col.key].length;
      var filterBtn = document.createElement('button');
      filterBtn.className = 'table-col-filter-btn' + (isActive ? ' active' : '');
      filterBtn.textContent = '▽';
      filterBtn.title = 'Filter by ' + col.label;
      (function(colKey, colLabel) {
        filterBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          openTableColFilter(colKey, colLabel, filterBtn.getBoundingClientRect());
        });
      }(col.key, col.label));
      th.appendChild(filterBtn);
    }
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // Build tbody
  var tbody = document.createElement('tbody');
  tasks.forEach(function(t) {
    tbody.appendChild(buildTableRow(t, visibleCols));
    if (tableExpanded[t.id] && t.children && t.children.length) {
      t.children.forEach(function(child) {
        tbody.appendChild(buildSubtaskRow(child, visibleCols));
      });
    }
  });

  // New task row
  var newRow = document.createElement('tr');
  newRow.className = 'table-new-row';
  var newTd = document.createElement('td');
  newTd.colSpan = visibleCols.length + 1;
  newTd.textContent = '+ New task…';
  newRow.appendChild(newTd);
  newRow.addEventListener('click', function() {
    var projectId = null;
    if (activeFilter && activeFilter.startsWith('project:')) {
      projectId = parseInt(activeFilter.split(':')[1], 10);
    }
    openNewTaskModal(null, projectId);
  });
  tbody.appendChild(newRow);

  while (table.firstChild) table.removeChild(table.firstChild);
  table.appendChild(thead);
  table.appendChild(tbody);
}

// ── End table view ───────────────────────────────────────────────────────────

function buildBoardCard(t) {
  var card = document.createElement('div');
  card.className = 'board-card priority-' + t.priority;
  card.draggable = true;
  card.dataset.taskId = t.id;
  card.style.cursor = 'pointer';
  card.addEventListener('dragstart', function(e) {
    e.dataTransfer.setData('text/plain', t.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', function() { card.classList.remove('dragging'); });
  card.addEventListener('click', function(e) {
    if (card.classList.contains('dragging')) return;
    expandedTaskId = t.id;
    navigateTo('tasks');
  });
  var title = document.createElement('div');
  title.className = 'board-card-title';
  title.textContent = t.title;
  card.appendChild(title);
  var metaParts = [];
  if (t.start_date) metaParts.push('Start ' + relativeDate(t.start_date));
  if (t.due_date) metaParts.push('Due ' + relativeDate(t.due_date));
  if (metaParts.length) {
    var meta = document.createElement('div');
    meta.className = 'board-card-meta';
    meta.textContent = metaParts.join(' · ');
    card.appendChild(meta);
  }
  if (t.tags && t.tags.length > 0) {
    var pillRow = document.createElement('div');
    pillRow.className = 'tag-pills';
    t.tags.forEach(function(tag) {
      var pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = tag.name;
      pill.style.cssText = (
        'background:' + hexToRgba(tag.color, 0.2) + ';' +
        'color:' + tag.color + ';' +
        'border-color:' + hexToRgba(tag.color, 0.35) + ';'
      );
      pillRow.appendChild(pill);
    });
    card.appendChild(pillRow);
  }
  return card;
}

function showAddStatusForm(container, triggerBtn) {
  var existing = document.getElementById('add-status-form');
  if (existing) { existing.remove(); triggerBtn.style.display = 'block'; return; }
  triggerBtn.style.display = 'none';
  var form = document.createElement('div');
  form.id = 'add-status-form';
  form.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  var nameInp = document.createElement('input');
  nameInp.type = 'text'; nameInp.placeholder = 'Status name';
  nameInp.style.cssText = 'font-size:11px;padding:4px 8px';
  var colorInp = document.createElement('input');
  colorInp.type = 'color'; colorInp.value = '#4a90d9';
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:4px';
  var saveBtn = document.createElement('button');
  saveBtn.textContent = '✓'; saveBtn.style.cssText = 'font-size:10px;padding:2px 8px';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary'; cancelBtn.textContent = '✕';
  cancelBtn.style.cssText = 'font-size:10px;padding:2px 8px';
  row.appendChild(colorInp); row.appendChild(saveBtn); row.appendChild(cancelBtn);
  async function doCreate() {
    var name = nameInp.value.trim();
    if (!name) return;
    var pid = parseInt(activeFilter.split(':')[1]);
    if (isNaN(pid)) return;
    var resp = await fetch('/api/statuses', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name: name, color: colorInp.value, project_id: pid }),
    });
    if (!resp.ok) {
      var err = await resp.json().catch(function() { return {}; });
      showToast(err.detail || 'Failed to create status');
      return;
    }
    await loadStatuses(pid);
    await loadTasks();
  }
  saveBtn.addEventListener('click', doCreate);
  cancelBtn.addEventListener('click', function() { form.remove(); triggerBtn.style.display = 'block'; });
  nameInp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') { form.remove(); triggerBtn.style.display = 'block'; }
  });
  form.appendChild(nameInp); form.appendChild(row);
  container.insertBefore(form, triggerBtn);
  nameInp.focus();
}

function toggleTask(id) {
  editingTaskId = null;
  editingStepId = null;
  expandedTaskId = (expandedTaskId === id) ? null : id;
  renderTasks();
}

async function updateTaskStatus(id, statusId) {
  var task = allTasks.find(function(t) { return t.id === id; });
  var prevStatusId = task ? task.status_id : null;
  await fetch('/api/tasks/' + id, {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ status_id: statusId }),
  });
  await loadTasks();
  if (prevStatusId && prevStatusId !== statusId) {
    showToast('Status changed', 'Undo', async function() {
      await fetch('/api/tasks/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status_id: prevStatusId }) });
      await loadTasks();
    });
  }
}

function deleteTask(id) {
  // Optimistic removal — schedule actual delete after 5s to allow undo
  allTasks = allTasks.filter(function(t) { return t.id !== id; });
  renderCurrentView();
  updateOverdueBadge();
  var undone = false;
  var timer = setTimeout(function() {
    if (!undone) fetch('/api/tasks/' + id, { method: 'DELETE', headers: authHeaders() });
  }, 8000);
  showToast('Task deleted', 'Undo', function() {
    undone = true;
    clearTimeout(timer);
    loadTasks();
  });
}

function showTaskEditForm(t, detail) {
  var form = document.createElement('div');
  form.className = 'task-edit-form';
  form.id = 'task-edit-form-' + t.id;

  function field(labelText, inputEl) {
    var wrap = document.createElement('div');
    var lbl = document.createElement('div');
    lbl.className = 'edit-label';
    lbl.textContent = labelText;
    wrap.appendChild(lbl);
    wrap.appendChild(inputEl);
    return wrap;
  }

  var titleInp = document.createElement('input');
  titleInp.type = 'text';
  titleInp.value = t.title;

  var startInp = document.createElement('input');
  startInp.type = 'date';
  if (t.start_date) startInp.value = t.start_date;

  var dateInp = document.createElement('input');
  dateInp.type = 'date';
  if (t.due_date) dateInp.value = t.due_date;

  var priSel = document.createElement('select');
  ['high', 'medium', 'low'].forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
    if (t.priority === p) opt.selected = true;
    priSel.appendChild(opt);
  });

  var notesToggle = buildNotesToggle(t.notes);

  var projSel = document.createElement('select');
  var noProj = document.createElement('option');
  noProj.value = '';
  noProj.textContent = '— No project —';
  projSel.appendChild(noProj);
  allProjects.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (t.project_id === p.id) opt.selected = true;
    projSel.appendChild(opt);
  });

  var dateRow = document.createElement('div');
  dateRow.className = 'edit-row-2col';
  dateRow.appendChild(field('Start Date', startInp));
  dateRow.appendChild(field('Due Date', dateInp));

  var row2 = document.createElement('div');
  row2.className = 'edit-row-2col';
  row2.appendChild(field('Priority', priSel));
  row2.appendChild(field('Project', projSel));

  form.appendChild(field('Title', titleInp));
  form.appendChild(dateRow);
  form.appendChild(row2);
  form.appendChild(field('Notes', notesToggle.el));

  var actionsDiv = document.createElement('div');
  actionsDiv.className = 'edit-actions';

  var saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'font-size:11px;padding:4px 10px';
  saveBtn.disabled = !titleInp.value.trim();

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'font-size:11px;padding:4px 10px';

  titleInp.addEventListener('input', function() {
    saveBtn.disabled = !titleInp.value.trim();
  });

  cancelBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    hideTaskEditForm(t.id);
  });

  saveBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (!titleInp.value.trim()) return;
    saveTaskEdit(t.id, {
      title: titleInp.value.trim(),
      start_date: startInp.value || null,
      due_date: dateInp.value || null,
      priority: priSel.value,
      project_id: projSel.value ? parseInt(projSel.value) : null,
      notes: notesToggle.getValue().trim() || null,
    });
  });

  form.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.stopPropagation(); hideTaskEditForm(t.id); }
  });

  var editErrEl = document.createElement('div');
  editErrEl.className = 'task-edit-err';
  editErrEl.style.cssText = 'display:none;color:var(--danger);font-size:11px;margin-top:4px';

  actionsDiv.appendChild(cancelBtn);
  actionsDiv.appendChild(saveBtn);
  form.appendChild(actionsDiv);
  form.appendChild(editErrEl);

  detail.appendChild(form);
  titleInp.focus();
  titleInp.select();
}

function hideTaskEditForm(taskId) {
  editingTaskId = null;
  var form = document.getElementById('task-edit-form-' + taskId);
  if (form) form.remove();
}

async function saveTaskEdit(taskId, data) {
  var errEl = document.querySelector('#task-edit-form-' + taskId + ' .task-edit-err');
  if (errEl) { errEl.style.display = 'none'; }
  var resp = await fetch('/api/tasks/' + taskId, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    var msg = 'Save failed. Please try again.';
    try { var e = await resp.json(); if (e.detail) msg = e.detail; } catch(ex) {}
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    return;
  }
  editingTaskId = null;
  await loadTasks();
  showToast('Saved');
}

function updateOverdueBadge() {
  var today = new Date().toISOString().split('T')[0];
  var count = allTasks.filter(function(t) { return t.due_date && t.due_date < today && t.status_name !== 'Done'; }).length;
  var badge = document.getElementById('overdue-badge');
  if (count > 0) {
    badge.textContent = count + ' overdue';
    badge.setAttribute('aria-label', count + ' overdue tasks');
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

// Subtask checklist
async function loadAndRenderSubtasks(parentId, container) {
  try {
    var resp = await fetch('/api/tasks?parent_id=' + parentId, { headers: authHeaders() });
    if (!resp.ok) return;
    var children = await resp.json();
    while (container.firstChild) container.removeChild(container.firstChild);

    children.forEach(function(child) {
      var row = document.createElement('div');
      row.className = 'subtask-row' + (child.status_name === 'Done' ? ' done' : '');
      row.id = 'step-row-' + child.id;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = child.status_name === 'Done';
      cb.addEventListener('change', function(e) {
        e.stopPropagation();
        toggleSubtask(child.id, cb.checked, parentId, container);
      });
      var titleSpan = document.createElement('span');
      titleSpan.textContent = child.title;
      titleSpan.style.flex = '1';
      row.appendChild(cb);
      row.appendChild(titleSpan);
      if (child.start_date) {
        var startSpan = document.createElement('span');
        startSpan.className = 'subtask-nested-hint';
        startSpan.textContent = 'Start ' + child.start_date;
        row.appendChild(startSpan);
      }
      if (child.due_date) {
        var dateSpan = document.createElement('span');
        dateSpan.className = 'subtask-nested-hint';
        dateSpan.textContent = 'Due ' + child.due_date;
        row.appendChild(dateSpan);
      }
      if (child.subtask_count > 0) {
        var hint = document.createElement('span');
        hint.className = 'subtask-nested-hint';
        hint.textContent = '↳ ' + child.subtask_count + ' steps';
        row.appendChild(hint);
      }
      var editStepBtn = document.createElement('button');
      editStepBtn.className = 'step-edit-btn';
      editStepBtn.textContent = '✏';
      editStepBtn.title = 'Edit step';
      editStepBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        showStepEditRow(child, row, parentId, container);
      });
      row.appendChild(editStepBtn);
      container.appendChild(row);
    });

    // "＋ Add step" button
    var addRow = document.createElement('div');
    addRow.className = 'add-step-row';
    addRow.textContent = '+ Add step';
    addRow.addEventListener('click', function(e) {
      e.stopPropagation();
      showAddStepInput(parentId, container, addRow);
    });
    container.appendChild(addRow);
  } catch (e) { console.warn('Subtask load failed:', e); }
}

function findStatusId(name) {
  var s = allStatuses.find(function(s) { return s.name.toLowerCase() === name.toLowerCase(); });
  return s ? s.id : null;
}

async function toggleSubtask(id, isDone, parentId, container) {
  var prevTask = null;
  for (var _i = 0; _i < allTasks.length; _i++) {
    var _ch = (allTasks[_i].children || []).find(function(c) { return c.id === id; });
    if (_ch) { prevTask = _ch; break; }
  }
  var prevStatusId = prevTask ? prevTask.status_id : null;
  var statusId = isDone ? findStatusId('Done') : findStatusId('Todo');
  if (!statusId) return;
  await fetch('/api/tasks/' + id, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status_id: statusId }),
  });
  await loadAndRenderSubtasks(parentId, container);
  await loadTasks();
  if (prevStatusId && prevStatusId !== statusId) {
    showToast('Status changed', 'Undo', async function() {
      await fetch('/api/tasks/' + id, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ status_id: prevStatusId }) });
      await loadAndRenderSubtasks(parentId, container);
      await loadTasks();
    });
  }
}

function showAddStepInput(parentId, container, addRowEl) {
  addRowEl.style.display = 'none';
  var inputRow = document.createElement('div');
  inputRow.className = 'subtask-row';
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'Step title...';
  inp.style.cssText = 'flex:1;font-size:11px;padding:3px 6px';
  var cancelSpan = document.createElement('span');
  cancelSpan.textContent = '✕';
  cancelSpan.style.cssText = 'color:var(--text-dim);cursor:pointer;font-size:11px;flex-shrink:0';
  cancelSpan.addEventListener('click', function(e) {
    e.stopPropagation();
    inputRow.remove();
    addRowEl.style.display = '';
  });
  inp.addEventListener('keydown', async function(e) {
    e.stopPropagation();
    if (e.key === 'Enter' && inp.value.trim()) {
      await fetch('/api/tasks', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ title: inp.value.trim(), parent_id: parentId }),
      });
      await loadAndRenderSubtasks(parentId, container);
      await loadTasks();
    }
    if (e.key === 'Escape') { inputRow.remove(); addRowEl.style.display = ''; }
  });
  inputRow.appendChild(inp);
  inputRow.appendChild(cancelSpan);
  container.insertBefore(inputRow, addRowEl);
  inp.focus();
}

function showStepEditRow(child, originalRow, parentId, container) {
  if (editingStepId !== null) {
    var prev = document.getElementById('step-edit-' + editingStepId);
    if (prev) prev.remove();
    var prevRow = document.getElementById('step-row-' + editingStepId);
    if (prevRow) prevRow.style.display = '';
  }
  editingStepId = child.id;
  originalRow.style.display = 'none';

  var editRow = document.createElement('div');
  editRow.id = 'step-edit-' + child.id;
  editRow.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:4px';

  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px';

  var titleInp = document.createElement('input');
  titleInp.type = 'text';
  titleInp.value = child.title;
  titleInp.style.cssText = 'flex:1;font-size:11px;padding:3px 6px;min-width:0';

  var startInp2 = document.createElement('input');
  startInp2.type = 'date';
  if (child.start_date) startInp2.value = child.start_date;
  startInp2.style.cssText = 'font-size:10px;padding:3px 5px;width:110px;flex-shrink:0';
  startInp2.title = 'Start date (optional)';

  var dateInp = document.createElement('input');
  dateInp.type = 'date';
  if (child.due_date) dateInp.value = child.due_date;
  dateInp.style.cssText = 'font-size:10px;padding:3px 5px;width:110px;flex-shrink:0';
  dateInp.title = 'Due date (optional)';

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = '✕';
  cancelBtn.style.cssText = 'font-size:10px;padding:2px 7px;flex-shrink:0';

  var saveBtn = document.createElement('button');
  saveBtn.textContent = '✓';
  saveBtn.style.cssText = 'font-size:10px;padding:2px 7px;flex-shrink:0';

  var notesInp = document.createElement('textarea');
  notesInp.value = child.notes || '';
  notesInp.placeholder = 'Notes (optional)';
  notesInp.style.cssText = 'font-size:11px;padding:4px 6px;resize:vertical;min-height:40px;font-family:inherit;width:100%;box-sizing:border-box';

  function doCancel() {
    editingStepId = null;
    editRow.remove();
    originalRow.style.display = '';
  }

  function doSave() {
    if (!titleInp.value.trim()) return;
    saveStepEdit(child.id, titleInp.value.trim(), startInp2.value || null, dateInp.value || null,
                 notesInp.value.trim() || null,
                 parentId, container, editRow, originalRow);
  }

  cancelBtn.addEventListener('click', function(e) { e.stopPropagation(); doCancel(); });
  saveBtn.addEventListener('click', function(e) { e.stopPropagation(); doSave(); });
  titleInp.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') doCancel();
  });
  notesInp.addEventListener('keydown', function(e) { e.stopPropagation(); if (e.key === 'Escape') doCancel(); });

  topRow.appendChild(titleInp);
  topRow.appendChild(startInp2);
  topRow.appendChild(dateInp);
  topRow.appendChild(cancelBtn);
  topRow.appendChild(saveBtn);
  editRow.appendChild(topRow);
  editRow.appendChild(notesInp);

  container.insertBefore(editRow, originalRow.nextSibling);
  titleInp.focus();
  titleInp.select();
}

async function saveStepEdit(stepId, title, startDate, dueDate, notes, parentId, container, editRow, originalRow) {
  var errEl = editRow.querySelector('.step-edit-err');
  if (errEl) { errEl.style.display = 'none'; }
  var resp = await fetch('/api/tasks/' + stepId, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ title: title, start_date: startDate, due_date: dueDate, notes: notes }),
  });
  if (!resp.ok) {
    var msg = 'Save failed. Please try again.';
    try { var e = await resp.json(); if (e.detail) msg = e.detail; } catch(ex) {}
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'step-edit-err';
      errEl.style.cssText = 'color:var(--danger);font-size:11px;margin-top:2px';
      editRow.appendChild(errEl);
    }
    errEl.textContent = msg; errEl.style.display = 'block';
    return;
  }
  editingStepId = null;
  editRow.remove();
  originalRow.style.display = '';
  await loadTasks();
}

// Tag management on tasks
async function addTagToTask(taskId, tagId) {
  await fetch('/api/tasks/' + taskId + '/tags/' + tagId, { method: 'POST', headers: authHeaders() });
  await loadTasks();
}

async function removeTagFromTask(taskId, tagId) {
  await fetch('/api/tasks/' + taskId + '/tags/' + tagId, { method: 'DELETE', headers: authHeaders() });
  await loadTasks();
}

// New Task Modal
function openNewTaskModal(dueDate, projectId, statusId) {
  var modal = document.getElementById('task-modal');
  var dueDateInp = document.getElementById('mt-due');
  var projectSel = document.getElementById('mt-project');
  if (dueDate) dueDateInp.value = dueDate;
  if (projectId) projectSel.value = projectId;
  modal.dataset.preselectStatusId = statusId || '';
  modal.style.display = 'flex';
  var titleInp = document.getElementById('mt-title');
  titleInp.focus();
  document.getElementById('modal-create-btn').disabled = !titleInp.value.trim();
}

function closeModal() {
  document.getElementById('task-modal').style.display = 'none';
  document.getElementById('mt-title').value = '';
  document.getElementById('mt-notes').value = '';
  document.getElementById('mt-start').value = '';
  document.getElementById('mt-due').value = '';
  var mtErr = document.getElementById('mt-error');
  if (mtErr) { mtErr.style.display = 'none'; }
}

async function createTask() {
  var title = document.getElementById('mt-title').value.trim();
  var mtErr = document.getElementById('mt-error');
  if (mtErr) { mtErr.style.display = 'none'; }
  if (!title) {
    if (mtErr) { mtErr.textContent = 'Title is required.'; mtErr.style.display = 'block'; }
    return;
  }
  var preselectStatusId = document.getElementById('task-modal').dataset.preselectStatusId;
  var body = {
    title: title,
    priority: document.getElementById('mt-priority').value,
    start_date: document.getElementById('mt-start').value || null,
    due_date: document.getElementById('mt-due').value || null,
    project_id: parseInt(document.getElementById('mt-project').value) || null,
    notes: document.getElementById('mt-notes').value.trim() || null,
    tag_ids: [],
  };
  if (preselectStatusId) body.status_id = parseInt(preselectStatusId);
  var createResp = await fetch('/api/tasks', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  if (!createResp.ok) {
    var errData = await createResp.json().catch(function() { return {}; });
    var errMsg = errData.detail || 'Error creating task.';
    var mtErr2 = document.getElementById('mt-error');
    if (mtErr2) { mtErr2.textContent = errMsg; mtErr2.style.display = 'block'; }
    return;
  }
  localStorage.setItem('mytask-tip-seen', '1');
  closeModal();
  await loadTasks();
}

// Chat
function buildMsgEl(role, content) {
  var div = document.createElement('div');
  div.className = 'msg ' + role;

  var avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'ai' ? 'AI' : (currentUser ? currentUser.username.slice(0, 2).toUpperCase() : 'Me');

  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = content;

  div.appendChild(avatar);
  div.appendChild(bubble);
  return div;
}

function addAiMessage(content) {
  var container = document.getElementById('chat-messages');
  var el = buildMsgEl('ai', content);
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

async function sendMessage() {
  var input = document.getElementById('chat-input');
  var message = input.value.trim();
  if (!message) return;
  input.value = '';
  document.getElementById('send-btn').disabled = true;

  var container = document.getElementById('chat-messages');

  var userEl = buildMsgEl('user', message);
  container.appendChild(userEl);
  container.scrollTop = container.scrollHeight;

  var aiDiv = document.createElement('div');
  aiDiv.className = 'msg ai';
  var aiAvatar = document.createElement('div');
  aiAvatar.className = 'msg-avatar';
  aiAvatar.textContent = 'AI';
  var bubble = document.createElement('div');
  bubble.className = 'msg-bubble streaming';
  aiDiv.appendChild(aiAvatar);
  aiDiv.appendChild(bubble);
  container.appendChild(aiDiv);
  container.scrollTop = container.scrollHeight;

  var aiContent = '';
  try {
    var resp = await fetch('/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: message, history: chatHistory }),
    });

    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buf = '';

    while (true) {
      var read = await reader.read();
      if (read.done) break;
      buf += decoder.decode(read.value, { stream: true });
      var lines = buf.split('\n');
      buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('data: ') !== 0) continue;
        var data = JSON.parse(line.slice(6));
        if (data.type === 'token') {
          aiContent += data.content;
          bubble.textContent = aiContent;
          container.scrollTop = container.scrollHeight;
        } else if (data.type === 'tool_executed') {
          await loadTasks();
          var notice = document.createElement('div');
          notice.className = 'tool-notice';
          notice.textContent = 'Task list updated';
          aiDiv.appendChild(notice);
        }
      }
    }
  } catch (e) {
    bubble.textContent = 'Error connecting to AI. Please try again.';
  }

  bubble.classList.remove('streaming');
  chatHistory.push({ role: 'user', content: message });
  chatHistory.push({ role: 'assistant', content: aiContent });
  if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  document.getElementById('send-btn').disabled = false;
}

// ── Projects page ──────────────────────────────────────────────────────────

async function renderProjectsPage() {
  await Promise.all(allProjects.map(async function(p) {
    var resp = await fetch('/api/statuses?project_id=' + p.id, { headers: authHeaders() });
    if (resp.ok) projectStatusMap[p.id] = await resp.json();
  }));
  _renderProjectsList();
}

function _renderProjectsList() {
  var page = document.getElementById('page-projects');
  while (page.firstChild) page.removeChild(page.firstChild);

  var hdr = document.createElement('div');
  hdr.className = 'proj-page-header';
  var title = document.createElement('h2');
  title.textContent = 'Projects';
  var list = document.createElement('div');
  list.className = 'proj-list';
  var newBtn = document.createElement('button');
  newBtn.textContent = '+ New Project';
  newBtn.addEventListener('click', function() { showNewProjectForm(list); });
  hdr.appendChild(title);
  hdr.appendChild(newBtn);
  page.appendChild(hdr);

  if (allProjects.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'proj-empty';
    var emptyTitle = document.createElement('p');
    emptyTitle.textContent = 'No projects yet.';
    var emptyDesc = document.createElement('p');
    emptyDesc.className = 'proj-empty-desc';
    emptyDesc.textContent = 'Projects group tasks and give each one a board with custom status columns.';
    var emptyBtn = document.createElement('button');
    emptyBtn.textContent = '+ Create your first project';
    emptyBtn.addEventListener('click', function() { showNewProjectForm(list); });
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyDesc);
    empty.appendChild(emptyBtn);
    list.appendChild(empty);
  } else {
    allProjects.forEach(function(p) {
      list.appendChild(buildProjectCard(p, list));
    });
  }
  page.appendChild(list);
}

function showNewProjectForm(list) {
  var existing = document.getElementById('new-proj-form');
  if (existing) { existing.remove(); return; }
  var form = document.createElement('div');
  form.id = 'new-proj-form';
  form.className = 'proj-new-form';
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Project name';
  var saveBtn = document.createElement('button');
  saveBtn.textContent = 'Create';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  async function doCreate() {
    var name = input.value.trim();
    if (!name) return;
    var resp = await fetch('/api/projects', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name: name }),
    });
    if (resp.ok) {
      var created = await resp.json();
      projectStatusMap[created.id] = created.statuses;
      await loadProjects();
      _renderProjectsList();
    } else {
      showToast('Failed to create project');
    }
  }
  saveBtn.addEventListener('click', doCreate);
  cancelBtn.addEventListener('click', function() { form.remove(); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') form.remove();
  });
  form.appendChild(input);
  form.appendChild(saveBtn);
  form.appendChild(cancelBtn);
  list.insertBefore(form, list.firstChild);
  input.focus();
}

function buildProjectCard(p, list) {
  var statuses = projectStatusMap[p.id] || [];
  var taskCount = allTasks.filter(function(t) { return t.project_id === p.id; }).length;
  var isExpanded = expandedProjectId === p.id;

  var card = document.createElement('div');
  card.className = 'proj-card';

  var hdr = document.createElement('div');
  hdr.className = 'proj-card-header';
  var nameEl = document.createElement('span');
  nameEl.className = 'proj-card-name';
  nameEl.textContent = p.name;
  var countEl = document.createElement('span');
  countEl.className = 'proj-card-count';
  countEl.textContent = taskCount + ' task' + (taskCount !== 1 ? 's' : '');
  var chevron = document.createElement('span');
  chevron.className = 'proj-card-chevron';
  chevron.textContent = isExpanded ? '↑' : '↓';
  var viewTasksBtn = document.createElement('button');
  viewTasksBtn.className = 'proj-card-view-tasks';
  viewTasksBtn.textContent = 'View Tasks';
  viewTasksBtn.title = 'Go to Tasks filtered by this project';
  viewTasksBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    navigateTo('tasks');
    var filterBtn = document.querySelector('#project-filters [data-project-id="' + p.id + '"]');
    setFilter('project:' + p.id, filterBtn);
  });

  var delBtn = document.createElement('button');
  delBtn.className = 'proj-card-del';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete project';
  delBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    allProjects = allProjects.filter(function(pr) { return pr.id !== p.id; });
    if (expandedProjectId === p.id) expandedProjectId = null;
    _renderProjectsList();
    var undone = false;
    var timer = setTimeout(async function() {
      if (!undone) {
        await fetch('/api/projects/' + p.id, { method: 'DELETE', headers: authHeaders() });
        delete projectStatusMap[p.id];
        await loadProjects();
        await loadTasks();
        _renderProjectsList();
      }
    }, 8000);
    showToast('Project deleted', 'Undo', function() {
      undone = true; clearTimeout(timer);
      loadProjects().then(function() { _renderProjectsList(); });
    });
  });
  hdr.appendChild(nameEl);
  hdr.appendChild(countEl);
  hdr.appendChild(chevron);
  hdr.appendChild(viewTasksBtn);
  hdr.appendChild(delBtn);
  hdr.addEventListener('click', function() {
    expandedProjectId = isExpanded ? null : p.id;
    _renderProjectsList();
  });
  card.appendChild(hdr);

  var chips = document.createElement('div');
  chips.className = 'proj-status-chips';
  statuses.forEach(function(s) {
    var chip = document.createElement('span');
    chip.className = 'proj-status-chip';
    var dot = document.createElement('span');
    dot.className = 'proj-status-dot';
    dot.style.background = s.color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(s.name));
    chips.appendChild(chip);
  });
  card.appendChild(chips);

  if (isExpanded) {
    var body = document.createElement('div');
    body.className = 'proj-card-body';

    var renameRow = document.createElement('div');
    renameRow.className = 'proj-rename-row';
    var renameInput = document.createElement('input');
    renameInput.type = 'text';
    renameInput.value = p.name;
    var saveRename = document.createElement('button');
    saveRename.textContent = 'Save';
    var cancelRename = document.createElement('button');
    cancelRename.className = 'btn-secondary';
    cancelRename.textContent = 'Cancel';
    async function doRename() {
      var name = renameInput.value.trim();
      if (!name) return;
      var resp = await fetch('/api/projects/' + p.id, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ name: name }),
      });
      if (resp.ok) { await loadProjects(); _renderProjectsList(); }
      else { showToast('Failed to rename project'); }
    }
    saveRename.addEventListener('click', doRename);
    cancelRename.addEventListener('click', function() { expandedProjectId = null; _renderProjectsList(); });
    renameInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doRename();
      if (e.key === 'Escape') { expandedProjectId = null; _renderProjectsList(); }
    });
    renameRow.appendChild(renameInput);
    renameRow.appendChild(saveRename);
    renameRow.appendChild(cancelRename);
    body.appendChild(renameRow);

    var statusLabel = document.createElement('div');
    statusLabel.className = 'proj-section-label';
    statusLabel.textContent = 'Statuses';
    body.appendChild(statusLabel);

    var statusList = document.createElement('div');
    statusList.className = 'proj-status-list';
    statuses.forEach(function(s) {
      statusList.appendChild(buildStatusRow(s, statuses, p.id));
    });
    body.appendChild(statusList);

    var addStatusBtn = document.createElement('button');
    addStatusBtn.className = 'proj-add-status-btn';
    addStatusBtn.textContent = '+ Add Status';
    addStatusBtn.addEventListener('click', function() {
      var existing = statusList.querySelector('.proj-add-status-form');
      if (existing) { existing.remove(); return; }
      buildAddStatusForm(p.id, statusList);
    });
    body.appendChild(addStatusBtn);
    card.appendChild(body);
  }

  return card;
}

function buildStatusRow(s, allProjectStatuses, projectId) {
  var row = document.createElement('div');
  row.className = 'proj-status-row';
  var swatch = document.createElement('span');
  swatch.className = 'proj-status-swatch';
  swatch.style.background = s.color;
  var nameEl = document.createElement('span');
  nameEl.className = 'proj-status-name';
  nameEl.textContent = s.name;
  var controls = document.createElement('span');
  controls.className = 'proj-status-controls';

  var editBtn = document.createElement('button');
  editBtn.className = 'proj-status-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', function() {
    var editRow = buildStatusEditRow(s, projectId, row);
    row.replaceWith(editRow);
    editRow.querySelector('input[type="text"]').focus();
  });

  var idx = allProjectStatuses.findIndex(function(x) { return x.id === s.id; });

  var upBtn = document.createElement('button');
  upBtn.className = 'proj-status-btn';
  upBtn.textContent = '↑';
  upBtn.disabled = idx === 0;
  upBtn.addEventListener('click', async function() {
    var ids = allProjectStatuses.map(function(x) { return x.id; });
    ids.splice(idx - 1, 0, ids.splice(idx, 1)[0]);
    var resp = await fetch('/api/statuses/reorder', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ ids: ids }),
    });
    if (resp.ok) {
      var r2 = await fetch('/api/statuses?project_id=' + projectId, { headers: authHeaders() });
      if (r2.ok) projectStatusMap[projectId] = await r2.json();
      _renderProjectsList();
    }
  });

  var downBtn = document.createElement('button');
  downBtn.className = 'proj-status-btn';
  downBtn.textContent = '↓';
  downBtn.disabled = idx === allProjectStatuses.length - 1;
  downBtn.addEventListener('click', async function() {
    var ids = allProjectStatuses.map(function(x) { return x.id; });
    ids.splice(idx + 1, 0, ids.splice(idx, 1)[0]);
    var resp = await fetch('/api/statuses/reorder', {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ ids: ids }),
    });
    if (resp.ok) {
      var r2 = await fetch('/api/statuses?project_id=' + projectId, { headers: authHeaders() });
      if (r2.ok) projectStatusMap[projectId] = await r2.json();
      _renderProjectsList();
    }
  });

  var delBtn = document.createElement('button');
  delBtn.className = 'proj-status-btn';
  delBtn.textContent = '✕';
  delBtn.disabled = allProjectStatuses.length <= 1;
  delBtn.title = allProjectStatuses.length <= 1 ? 'Cannot delete the last status' : 'Delete status';
  delBtn.addEventListener('click', function() {
    if (allProjectStatuses.length <= 1) return;
    projectStatusMap[projectId] = allProjectStatuses.filter(function(st) { return st.id !== s.id; });
    _renderProjectsList();
    var undone = false;
    var timer = setTimeout(async function() {
      if (!undone) {
        await fetch('/api/statuses/' + s.id, { method: 'DELETE', headers: authHeaders() });
        var r2 = await fetch('/api/statuses?project_id=' + projectId, { headers: authHeaders() });
        if (r2.ok) projectStatusMap[projectId] = await r2.json();
        _renderProjectsList();
      }
    }, 8000);
    showToast('Status deleted', 'Undo', function() {
      undone = true; clearTimeout(timer);
      fetch('/api/statuses?project_id=' + projectId, { headers: authHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(data) { projectStatusMap[projectId] = data; _renderProjectsList(); });
    });
  });

  controls.appendChild(editBtn);
  controls.appendChild(upBtn);
  controls.appendChild(downBtn);
  controls.appendChild(delBtn);
  row.appendChild(swatch);
  row.appendChild(nameEl);
  row.appendChild(controls);
  return row;
}

function buildStatusEditRow(s, projectId, originalRow) {
  var row = document.createElement('div');
  row.className = 'proj-status-row proj-status-edit-row';
  var swatch = document.createElement('span');
  swatch.className = 'proj-status-swatch';
  swatch.style.background = s.color;
  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = s.name;
  nameInput.style.cssText = 'font-size:12px;padding:3px 8px;width:120px;';
  var colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = s.color;
  colorInput.style.cssText = 'width:28px;height:24px;padding:1px;cursor:pointer;border:none;';
  colorInput.addEventListener('input', function() { swatch.style.background = colorInput.value; });
  var saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'font-size:11px;padding:3px 10px;';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = '✕';
  cancelBtn.style.cssText = 'font-size:11px;padding:3px 7px;';
  async function doSave() {
    var name = nameInput.value.trim();
    if (!name) return;
    var resp = await fetch('/api/statuses/' + s.id, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ name: name, color: colorInput.value }),
    });
    if (resp.ok) {
      var r2 = await fetch('/api/statuses?project_id=' + projectId, { headers: authHeaders() });
      if (r2.ok) projectStatusMap[projectId] = await r2.json();
      _renderProjectsList();
    } else {
      showToast('Failed to update status');
    }
  }
  saveBtn.addEventListener('click', doSave);
  cancelBtn.addEventListener('click', function() { row.replaceWith(originalRow); });
  nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') row.replaceWith(originalRow);
  });
  row.appendChild(swatch);
  row.appendChild(nameInput);
  row.appendChild(colorInput);
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
  return row;
}

function buildAddStatusForm(projectId, statusList) {
  var form = document.createElement('div');
  form.className = 'proj-add-status-form';
  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Status name';
  nameInput.style.cssText = 'font-size:12px;padding:3px 8px;width:120px;';
  var colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = '#4a90d9';
  colorInput.style.cssText = 'width:28px;height:24px;padding:1px;cursor:pointer;border:none;';
  var saveBtn = document.createElement('button');
  saveBtn.textContent = '✓';
  saveBtn.style.cssText = 'font-size:11px;padding:3px 8px;';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = '✕';
  cancelBtn.style.cssText = 'font-size:11px;padding:3px 7px;';
  async function doCreate() {
    var name = nameInput.value.trim();
    if (!name) return;
    var resp = await fetch('/api/statuses', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name: name, color: colorInput.value, project_id: projectId }),
    });
    if (resp.ok) {
      var r2 = await fetch('/api/statuses?project_id=' + projectId, { headers: authHeaders() });
      if (r2.ok) projectStatusMap[projectId] = await r2.json();
      _renderProjectsList();
    } else {
      var err = await resp.json().catch(function() { return {}; });
      showToast(err.detail || 'Failed to create status');
    }
  }
  saveBtn.addEventListener('click', doCreate);
  cancelBtn.addEventListener('click', function() { form.remove(); });
  nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') form.remove();
  });
  form.appendChild(nameInput);
  form.appendChild(colorInput);
  form.appendChild(saveBtn);
  form.appendChild(cancelBtn);
  statusList.appendChild(form);
  nameInput.focus();
}

// ── Tags page ──────────────────────────────────────────────────────────────

function renderTagsPage() {
  var page = document.getElementById('page-tags');
  while (page.firstChild) page.removeChild(page.firstChild);

  var hdr = document.createElement('div');
  hdr.className = 'tag-page-header';
  var title = document.createElement('h2');
  title.textContent = 'Tags';
  var list = document.createElement('div');
  list.className = 'tag-list-page';
  var newBtn = document.createElement('button');
  newBtn.textContent = '+ New Tag';
  newBtn.addEventListener('click', function() {
    var existing = document.getElementById('new-tag-page-form');
    if (existing) { existing.remove(); return; }
    var form = buildTagCreateForm(list);
    list.insertBefore(form, list.firstChild);
    form.querySelector('input[type="text"]').focus();
  });
  hdr.appendChild(title);
  hdr.appendChild(newBtn);
  page.appendChild(hdr);

  if (allTags.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'tag-empty';
    var emptyTitle = document.createElement('p');
    emptyTitle.textContent = 'No tags yet.';
    var emptyDesc = document.createElement('p');
    emptyDesc.className = 'tag-empty-desc';
    emptyDesc.textContent = 'Tags cross-cut projects; filter any view by tag.';
    var emptyBtn = document.createElement('button');
    emptyBtn.textContent = '+ Create your first tag';
    emptyBtn.addEventListener('click', function() {
      var existing = document.getElementById('new-tag-page-form');
      if (existing) { existing.remove(); return; }
      var form = buildTagCreateForm(list);
      list.insertBefore(form, list.firstChild);
      form.querySelector('input[type="text"]').focus();
    });
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyDesc);
    empty.appendChild(emptyBtn);
    list.appendChild(empty);
  } else {
    allTags.forEach(function(tag) {
      list.appendChild(buildTagRow(tag, list));
    });
  }
  page.appendChild(list);
}

function buildTagRow(tag, list) {
  var row = document.createElement('div');
  row.className = 'tag-row';
  var swatch = document.createElement('span');
  swatch.className = 'tag-swatch';
  swatch.style.background = tag.color;
  var nameEl = document.createElement('span');
  nameEl.className = 'tag-row-name';
  nameEl.textContent = tag.name;
  var controls = document.createElement('span');
  controls.className = 'tag-row-controls';
  var editBtn = document.createElement('button');
  editBtn.className = 'tag-row-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', function() {
    var existingEdit = list.querySelector('.tag-edit-row');
    if (existingEdit) existingEdit.remove();
    var editRow = buildTagEditRow(tag, list);
    row.after(editRow);
    editRow.querySelector('input[type="text"]').focus();
  });
  var delBtn = document.createElement('button');
  delBtn.className = 'tag-row-btn';
  delBtn.textContent = '✕';
  delBtn.title = 'Delete tag';
  delBtn.addEventListener('click', function() {
    allTags = allTags.filter(function(tg) { return tg.id !== tag.id; });
    renderTagsPage();
    var undone = false;
    var timer = setTimeout(function() {
      if (!undone) fetch('/api/tags/' + tag.id, { method: 'DELETE', headers: authHeaders() })
        .then(function() { loadTags().then(renderTagsPage); });
    }, 8000);
    showToast('Tag deleted', 'Undo', function() {
      undone = true; clearTimeout(timer); loadTags().then(renderTagsPage);
    });
  });
  controls.appendChild(editBtn);
  controls.appendChild(delBtn);
  row.appendChild(swatch);
  row.appendChild(nameEl);
  row.appendChild(controls);
  return row;
}

function buildTagEditRow(tag, list) {
  var row = document.createElement('div');
  row.className = 'tag-edit-row';
  var swatch = document.createElement('span');
  swatch.className = 'tag-swatch';
  swatch.style.background = tag.color;
  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = tag.name;
  nameInput.style.cssText = 'font-size:12px;padding:4px 8px;width:150px;';
  var colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = tag.color;
  colorInput.style.cssText = 'width:28px;height:26px;padding:1px;cursor:pointer;border:none;';
  colorInput.addEventListener('input', function() { swatch.style.background = colorInput.value; });
  var errEl = document.createElement('span');
  errEl.className = 'tag-inline-err';
  errEl.style.display = 'none';
  var saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'font-size:11px;padding:4px 10px;';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = '✕';
  cancelBtn.style.cssText = 'font-size:11px;padding:4px 7px;';
  async function doSave() {
    var name = nameInput.value.trim();
    if (!name) return;
    errEl.style.display = 'none';
    var resp = await fetch('/api/tags/' + tag.id, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ name: name, color: colorInput.value }),
    });
    if (resp.ok) { await loadTags(); renderTagsPage(); }
    else if (resp.status === 409) { errEl.textContent = 'Name already in use'; errEl.style.display = 'inline'; }
    else { showToast('Failed to update tag'); }
  }
  saveBtn.addEventListener('click', doSave);
  cancelBtn.addEventListener('click', function() { row.remove(); });
  nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') row.remove();
  });
  row.appendChild(swatch);
  row.appendChild(nameInput);
  row.appendChild(colorInput);
  row.appendChild(errEl);
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
  return row;
}

function buildTagCreateForm(list) {
  var form = document.createElement('div');
  form.id = 'new-tag-page-form';
  form.className = 'tag-create-form';
  var nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Tag name';
  nameInput.style.cssText = 'font-size:12px;padding:4px 8px;width:150px;';
  var colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = '#4a90d9';
  colorInput.style.cssText = 'width:28px;height:26px;padding:1px;cursor:pointer;border:none;';
  var errEl = document.createElement('span');
  errEl.className = 'tag-inline-err';
  errEl.style.display = 'none';
  var saveBtn = document.createElement('button');
  saveBtn.textContent = 'Create';
  saveBtn.style.cssText = 'font-size:11px;padding:4px 10px;';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = '✕';
  cancelBtn.style.cssText = 'font-size:11px;padding:4px 7px;';
  async function doCreate() {
    var name = nameInput.value.trim();
    if (!name) return;
    errEl.style.display = 'none';
    var resp = await fetch('/api/tags', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name: name, color: colorInput.value }),
    });
    if (resp.ok) { await loadTags(); renderTagsPage(); }
    else if (resp.status === 409) { errEl.textContent = 'Name already in use'; errEl.style.display = 'inline'; }
    else { showToast('Failed to create tag'); }
  }
  saveBtn.addEventListener('click', doCreate);
  cancelBtn.addEventListener('click', function() { form.remove(); });
  nameInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doCreate();
    if (e.key === 'Escape') form.remove();
  });
  form.appendChild(nameInput);
  form.appendChild(colorInput);
  form.appendChild(errEl);
  form.appendChild(saveBtn);
  form.appendChild(cancelBtn);
  return form;
}

function downloadKBDoc(doc) {
  fetch('/api/kb/' + doc.id + '/download', { headers: authHeaders() })
    .then(function(r) {
      if (!r.ok) throw new Error('Download failed');
      return r.blob();
    })
    .then(function(blob) {
      var url = URL.createObjectURL(blob);
      var viewInBrowser = ['pdf', 'jpg', 'jpeg', 'png'];
      if (viewInBrowser.indexOf(doc.file_type) !== -1) {
        window.open(url, '_blank');
        setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
      } else {
        var a = document.createElement('a');
        a.href = url;
        a.download = doc.title;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    })
    .catch(function() { showToast('Download failed'); });
}

// Task card: attached docs section
function renderTaskDocs(task, detailEl) {
  var existing = detailEl.querySelector('.task-docs-section');
  if (existing) existing.remove();

  var section = document.createElement('div');
  section.className = 'task-docs-section';

  var label = document.createElement('div');
  label.className = 'task-docs-label';
  label.textContent = 'Attached docs';
  section.appendChild(label);

  var pills = document.createElement('div');
  pills.className = 'task-doc-pills';
  section.appendChild(pills);

  fetch('/api/kb?task_id=' + task.id, { headers: authHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(docs) {
      docs.forEach(function(doc) {
        var pill = document.createElement('span');
        pill.className = 'task-doc-pill';
        var icons = { txt: 'TXT', md: 'MD' };
        var pillLabel = document.createElement('span');
        pillLabel.textContent = (icons[doc.file_type] || '📄') + ' ' + doc.title;
        pillLabel.style.cssText = 'cursor:pointer;text-decoration:underline;margin-right:4px';
        pillLabel.title = 'View / download';
        (function(d) {
          pillLabel.addEventListener('click', function(e) { e.stopPropagation(); downloadKBDoc(d); });
        })(doc);
        pill.appendChild(pillLabel);
        var del = document.createElement('button');
        del.className = 'task-doc-pill-del';
        del.textContent = '✕';
        del.addEventListener('click', function(e) {
          e.stopPropagation();
          fetch('/api/kb/' + doc.id, { method: 'DELETE', headers: authHeaders() })
            .then(function() { renderTaskDocs(task, detailEl); })
            .catch(function() { showToast('Delete failed.'); });
        });
        pill.appendChild(del);
        pills.appendChild(pill);
      });

      var attachBtn = document.createElement('button');
      attachBtn.className = 'task-attach-btn';
      attachBtn.textContent = '+ Attach';
      var fi = document.createElement('input');
      fi.type = 'file';
      fi.multiple = true;
      fi.accept = '.txt,.md';
      fi.style.display = 'none';
      fi.addEventListener('change', function() {
        var files = Array.from(fi.files);
        if (!files.length) return;
        attachBtn.textContent = 'Adding...';
        attachBtn.disabled = true;
        var promises = files.map(function(file) {
          var fd = new FormData();
          fd.append('file', file);
          fd.append('task_id', task.id);
          return fetch('/api/kb', { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }, body: fd });
        });
        Promise.all(promises).then(function() {
          fi.value = '';
          attachBtn.textContent = '+ Attach';
          attachBtn.disabled = false;
          renderTaskDocs(task, detailEl);
        }).catch(function() {
          attachBtn.textContent = '+ Attach';
          attachBtn.disabled = false;
          showToast('Text upload failed. Please use .txt or .md.');
        });
      });
      attachBtn.addEventListener('click', function() { fi.click(); });
      section.appendChild(fi);
      pills.appendChild(attachBtn);
    });

  detailEl.appendChild(section);
}

// Task card: AI actions section
function renderTaskAIActions(task, detailEl) {
  var existing = detailEl.querySelector('.task-ai-section');
  if (existing) existing.remove();

  var section = document.createElement('div');
  section.className = 'task-ai-section';

  var toggle = document.createElement('button');
  toggle.className = 'task-ai-toggle';
  toggle.textContent = '▸ AI Actions';
  section.appendChild(toggle);

  var aiBody = document.createElement('div');
  aiBody.className = 'task-ai-body';
  aiBody.style.display = 'none';
  section.appendChild(aiBody);

  toggle.addEventListener('click', function() {
    var open = aiBody.style.display !== 'none';
    aiBody.style.display = open ? 'none' : 'block';
    toggle.textContent = (open ? '▸' : '▾') + ' AI Actions';
  });

  var btnRow = document.createElement('div');
  btnRow.className = 'task-ai-buttons';
  aiBody.appendChild(btnRow);

  var customRow = document.createElement('div');
  customRow.style.cssText = 'display:flex;gap:6px;margin-top:6px';
  var customInput = document.createElement('textarea');
  customInput.placeholder = 'Ask anything about this task…';
  customInput.rows = 2;
  customInput.style.cssText = 'flex:1;font-size:11px;font-family:inherit;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--r);color:var(--text);padding:5px 8px;resize:vertical';
  var askBtn = document.createElement('button');
  askBtn.className = 'btn-primary task-ai-btn';
  askBtn.style.alignSelf = 'flex-end';
  askBtn.textContent = 'Ask';
  customRow.appendChild(customInput);
  customRow.appendChild(askBtn);
  aiBody.appendChild(customRow);

  var outputDiv = document.createElement('div');
  aiBody.appendChild(outputDiv);

  var actions = [
    { key: 'meeting_prep', label: 'Meeting prep' },
    { key: 'draft_email',  label: 'Draft email' },
    { key: 'summarise',    label: 'Summarise' },
    { key: 'action_items', label: 'Action items' }
  ];

  // Shared: render an AI result block with Copy, Regenerate, and Follow-up reply input
  function renderAIResult(result, headerLabel, onRegen) {
    outputDiv.textContent = '';
    var out = document.createElement('div');
    out.className = 'task-ai-output';

    var hdr = document.createElement('div');
    hdr.className = 'task-ai-output-header';
    hdr.textContent = headerLabel + ' — generated';

    var txt = document.createElement('div');
    txt.className = 'task-ai-output-text';
    txt.textContent = result;

    var actRow = document.createElement('div');
    actRow.className = 'task-ai-output-actions';

    var copyBtn = document.createElement('button');
    copyBtn.className = 'btn-primary task-ai-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function() {
      navigator.clipboard.writeText(result).then(function() {
        copyBtn.textContent = '✓ Copied';
        setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
      });
    });

    var regenBtn = document.createElement('button');
    regenBtn.className = 'btn-secondary task-ai-btn';
    regenBtn.textContent = 'Regenerate';
    regenBtn.addEventListener('click', onRegen);

    actRow.appendChild(copyBtn);
    actRow.appendChild(regenBtn);

    // Follow-up / feedback row
    var replyRow = document.createElement('div');
    replyRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;border-top:1px solid var(--border);padding-top:8px';
    var replyInput = document.createElement('textarea');
    replyInput.placeholder = 'Give feedback or ask a follow-up…';
    replyInput.rows = 2;
    replyInput.style.cssText = 'flex:1;font-size:11px;font-family:inherit;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--r);color:var(--text);padding:5px 8px;resize:vertical';
    var replyBtn = document.createElement('button');
    replyBtn.className = 'btn-primary task-ai-btn';
    replyBtn.style.alignSelf = 'flex-end';
    replyBtn.textContent = '↩ Reply';

    function sendReply() {
      var feedback = replyInput.value.trim();
      if (!feedback) return;
      replyBtn.disabled = true;
      replyBtn.textContent = '⏳';
      var composedPrompt = 'Previous AI response:\n---\n' + result + '\n---\n\nMy feedback: ' + feedback + '\n\nPlease revise your response based on this feedback.';
      fetch('/api/tasks/' + task.id + '/ai-action', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ action: 'custom', custom_prompt: composedPrompt })
      }).then(function(r) { return r.json(); }).then(function(data) {
        replyBtn.disabled = false;
        replyBtn.textContent = '↩ Reply';
        if (data.error || !data.result) {
          replyInput.style.borderColor = 'var(--danger)';
          replyInput.placeholder = 'AI unavailable, please try again.';
          return;
        }
        renderAIResult(data.result, headerLabel + ' (revised)', onRegen);
      }).catch(function() {
        replyBtn.disabled = false;
        replyBtn.textContent = '↩ Reply';
        replyInput.style.borderColor = 'var(--danger)';
      });
    }

    replyBtn.addEventListener('click', sendReply);
    replyInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply();
    });

    replyRow.appendChild(replyInput);
    replyRow.appendChild(replyBtn);

    out.appendChild(hdr);
    out.appendChild(txt);
    out.appendChild(actRow);
    out.appendChild(replyRow);
    outputDiv.appendChild(out);
  }

  function runAIAction(actionKey, actionLabel, btn) {
    btn.disabled = true;
    btn.textContent = '⏳ ' + actionLabel;
    outputDiv.textContent = '';
    fetch('/api/tasks/' + task.id + '/ai-action', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ action: actionKey })
    }).then(function(r) { return r.json(); }).then(function(data) {
      btn.disabled = false;
      btn.textContent = actionLabel;
      if (data.error || !data.result) {
        outputDiv.textContent = '';
        var errMsg = document.createElement('p');
        errMsg.style.cssText = 'font-size:11px;color:var(--danger);padding:6px 0';
        errMsg.textContent = 'AI unavailable, please try again.';
        outputDiv.appendChild(errMsg);
        return;
      }
      renderAIResult(data.result, actionLabel, function() { runAIAction(actionKey, actionLabel, btn); });
    }).catch(function() {
      btn.disabled = false;
      btn.textContent = actionLabel;
      var errMsg = document.createElement('p');
      errMsg.style.cssText = 'font-size:11px;color:var(--danger);padding:6px 0';
      errMsg.textContent = 'AI unavailable, please try again.';
      outputDiv.appendChild(errMsg);
    });
  }

  actions.forEach(function(action) {
    var btn = document.createElement('button');
    btn.className = 'btn-secondary task-ai-btn';
    btn.textContent = action.label;
    btn.addEventListener('click', function() { runAIAction(action.key, action.label, btn); });
    btnRow.appendChild(btn);
  });

  function runCustomAsk() {
    var prompt = customInput.value.trim();
    if (!prompt) return;
    askBtn.disabled = true;
    askBtn.textContent = '⏳ Asking…';
    outputDiv.textContent = '';
    fetch('/api/tasks/' + task.id + '/ai-action', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ action: 'custom', custom_prompt: prompt })
    }).then(function(r) { return r.json(); }).then(function(data) {
      askBtn.disabled = false;
      askBtn.textContent = 'Ask';
      if (data.error || !data.result) {
        outputDiv.textContent = '';
        var errMsg = document.createElement('p');
        errMsg.style.cssText = 'font-size:11px;color:var(--danger);padding:6px 0';
        errMsg.textContent = 'AI unavailable, please try again.';
        outputDiv.appendChild(errMsg);
        return;
      }
      renderAIResult(data.result, 'Custom', runCustomAsk);
    }).catch(function() {
      askBtn.disabled = false;
      askBtn.textContent = 'Ask';
      var errMsg = document.createElement('p');
      errMsg.style.cssText = 'font-size:11px;color:var(--danger);padding:6px 0';
      errMsg.textContent = 'AI unavailable, please try again.';
      outputDiv.appendChild(errMsg);
    });
  }

  askBtn.addEventListener('click', runCustomAsk);
  customInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runCustomAsk();
  });

  detailEl.appendChild(section);
}

// KB Page
function renderKBPage() {
  var container = document.getElementById('page-kb');
  if (!container) return;
  container.textContent = '';

  var header = document.createElement('div');
  header.className = 'page-header';
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px';
  var title = document.createElement('h2');
  title.textContent = 'Knowledge Base';
  title.style.cssText = 'font-size:16px;font-weight:700;color:var(--text)';
  header.appendChild(title);

  var uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn-primary kb-upload-btn';
  uploadBtn.textContent = '+ Add Text';
  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.txt,.md';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', function() {
    var files = Array.from(fileInput.files);
    if (!files.length) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Adding...';
    var promises = files.map(function(file) {
      var fd = new FormData();
      fd.append('file', file);
      return fetch('/api/kb', { method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }, body: fd });
    });
    Promise.all(promises).then(function() {
      fileInput.value = '';
      uploadBtn.disabled = false;
      uploadBtn.textContent = '+ Add Text';
      renderKBPage();
    }).catch(function() {
      fileInput.value = '';
      uploadBtn.disabled = false;
      uploadBtn.textContent = '+ Add Text';
      showToast('Text upload failed. Please use .txt or .md.');
    });
  });
  uploadBtn.addEventListener('click', function() { fileInput.click(); });
  header.appendChild(fileInput);
  header.appendChild(uploadBtn);
  container.appendChild(header);

  fetch('/api/kb', { headers: authHeaders() })
    .then(function(r) { return r.json(); })
    .then(function(docs) {
      var globalDocs = docs.filter(function(d) { return !d.task_id; });
      var taskDocs = docs.filter(function(d) { return d.task_id; });

      var glTitle = document.createElement('div');
      glTitle.className = 'kb-section-title';
      glTitle.textContent = 'Global Documents';
      container.appendChild(glTitle);

      if (!globalDocs.length) {
        var empty = document.createElement('div');
        empty.className = 'kb-drop-hint';
        var emptyIcon = document.createElement('div');
        emptyIcon.className = 'kb-drop-icon';
        emptyIcon.textContent = '↑';
        var emptyMain = document.createElement('div');
        emptyMain.textContent = 'No global documents yet.';
        var emptySub = document.createElement('div');
        emptySub.className = 'kb-drop-sub';
        emptySub.textContent = 'Add text or Markdown files. The AI will reference them across all tasks.';
        empty.appendChild(emptyIcon);
        empty.appendChild(emptyMain);
        empty.appendChild(emptySub);
        container.appendChild(empty);
      }
      globalDocs.forEach(function(doc) { container.appendChild(buildKBDocCard(doc)); });

      var tTitle = document.createElement('div');
      tTitle.className = 'kb-section-title';
      tTitle.style.marginTop = '16px';
      tTitle.textContent = 'Task-attached Documents';
      container.appendChild(tTitle);

      if (!taskDocs.length) {
        var empty2 = document.createElement('p');
        empty2.style.cssText = 'font-size:12px;color:var(--text-dim);padding:8px 4px';
        empty2.textContent = 'No task-attached documents yet. Attach docs from within a task card.';
        container.appendChild(empty2);
      }
      taskDocs.forEach(function(doc) { container.appendChild(buildKBDocCard(doc)); });
    });
}

function buildKBDocCard(doc) {
  var icons = { txt: 'TXT', md: 'MD' };
  var card = document.createElement('div');
  card.className = 'kb-doc-card';

  var icon = document.createElement('span');
  icon.className = 'kb-doc-icon';
  icon.textContent = icons[doc.file_type] || '📄';
  card.appendChild(icon);

  var info = document.createElement('div');
  info.className = 'kb-doc-info';
  var name = document.createElement('div');
  name.className = 'kb-doc-name';
  name.textContent = doc.title;
  info.appendChild(name);
  var meta = document.createElement('div');
  meta.className = 'kb-doc-meta';
  var sizeKB = Math.round(doc.file_size / 1024);
  var sizeStr = sizeKB > 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB';
  var dateStr = new Date(doc.created_at).toLocaleDateString();
  meta.textContent = doc.file_type.toUpperCase() + ' · ' + sizeStr + ' · uploaded ' + dateStr;
  if (!doc.has_text) meta.textContent += ' · no text extracted';
  info.appendChild(meta);
  card.appendChild(info);

  var dlBtn = document.createElement('button');
  dlBtn.className = 'kb-doc-download';
  dlBtn.textContent = '⬇';
  dlBtn.title = 'View / download';
  (function(d) {
    dlBtn.addEventListener('click', function() { downloadKBDoc(d); });
  })(doc);
  card.appendChild(dlBtn);

  var del = document.createElement('button');
  del.className = 'kb-doc-delete';
  del.textContent = '✕';
  del.addEventListener('click', function() {
    fetch('/api/kb/' + doc.id, { method: 'DELETE', headers: authHeaders() })
      .then(function() { renderKBPage(); })
      .catch(function() { showToast('Delete failed.'); });
  });
  card.appendChild(del);
  return card;
}

// Event wiring
document.addEventListener('DOMContentLoaded', function() {
  if (!document.getElementById('login-screen')) return;

  initApp();

  document.getElementById('login-btn').addEventListener('click', login);
  document.getElementById('logout-btn').addEventListener('click', logout);
  var drawerLogout = document.getElementById('drawer-logout-btn');
  if (drawerLogout) drawerLogout.addEventListener('click', logout);

  function openChangePasswordModal() {
    document.getElementById('cp-current').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
    var err = document.getElementById('cp-error');
    err.style.display = 'none';
    err.textContent = '';
    document.getElementById('change-password-modal').style.display = 'flex';
    document.getElementById('cp-current').focus();
    if (drawerOpen) toggleDrawer();
  }
  function closeChangePasswordModal() {
    document.getElementById('change-password-modal').style.display = 'none';
  }
  function saveChangePassword() {
    var current = document.getElementById('cp-current').value;
    var nw = document.getElementById('cp-new').value;
    var confirm = document.getElementById('cp-confirm').value;
    var err = document.getElementById('cp-error');
    err.style.display = 'none';
    if (!current || !nw || !confirm) {
      err.textContent = 'All fields are required.'; err.style.display = 'block'; return;
    }
    if (nw.length < 6) {
      err.textContent = 'New password must be at least 6 characters.'; err.style.display = 'block'; return;
    }
    if (nw !== confirm) {
      err.textContent = 'New passwords do not match.'; err.style.display = 'block'; return;
    }
    var saveBtn = document.getElementById('cp-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    fetch('/api/auth/password', {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ current_password: current, new_password: nw })
    }).then(function(r) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      if (r.ok) {
        closeChangePasswordModal();
        showToast('Password changed successfully');
      } else {
        return r.json().then(function(d) {
          err.textContent = d.detail || 'Failed to change password.';
          err.style.display = 'block';
        });
      }
    }).catch(function() {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      err.textContent = 'Network error, please try again.';
      err.style.display = 'block';
    });
  }

  document.getElementById('change-password-btn').addEventListener('click', openChangePasswordModal);
  var drawerCPBtn = document.getElementById('drawer-change-password-btn');
  if (drawerCPBtn) drawerCPBtn.addEventListener('click', openChangePasswordModal);
  document.getElementById('cp-save-btn').addEventListener('click', saveChangePassword);
  document.getElementById('cp-cancel-btn').addEventListener('click', closeChangePasswordModal);
  document.getElementById('change-password-modal').addEventListener('click', function(e) {
    if (e.target === this) closeChangePasswordModal();
  });
  document.getElementById('cp-confirm').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveChangePassword();
  });
  document.getElementById('login-password').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') login();
  });
  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
  });
  document.getElementById('chat-fab').addEventListener('click', toggleChat);
  document.getElementById('chat-close-btn').addEventListener('click', toggleChat);
  document.getElementById('hamburger-btn').addEventListener('click', toggleDrawer);
  document.getElementById('drawer-overlay').addEventListener('click', toggleDrawer);
  document.querySelectorAll('.sidebar-item[data-page]').forEach(function(el) {
    el.addEventListener('click', function() { navigateTo(el.dataset.page); });
  });
  document.querySelectorAll('.drawer-item[data-page]').forEach(function(el) {
    el.addEventListener('click', function() { navigateTo(el.dataset.page); if (drawerOpen) toggleDrawer(); });
  });
  document.getElementById('new-task-btn').addEventListener('click', function() {
    openNewTaskModal(null, null, null);
  });
  document.getElementById('modal-create-btn').addEventListener('click', createTask);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('task-modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
  var mtTitleInput = document.getElementById('mt-title');
  var modalCreateBtn = document.getElementById('modal-create-btn');
  function syncCreateBtn() { modalCreateBtn.disabled = !mtTitleInput.value.trim(); }
  mtTitleInput.addEventListener('input', syncCreateBtn);
  mtTitleInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });
  // Stat card click-through: navigate to Tasks with matching filter
  var statOverdue = document.getElementById('stat-overdue-num');
  if (statOverdue) statOverdue.closest('.dashboard-stat').addEventListener('click', function() {
    navigateTo('tasks'); setFilter('overdue', document.getElementById('filter-overdue'));
  });
  var statToday = document.getElementById('stat-today-num');
  if (statToday) statToday.closest('.dashboard-stat').addEventListener('click', function() {
    navigateTo('tasks'); setFilter('today', document.getElementById('filter-today'));
  });

  document.getElementById('filter-all').addEventListener('click', function() { setFilter('all', this); });
  document.getElementById('filter-today').addEventListener('click', function() { setFilter('today', this); });
  document.getElementById('filter-overdue').addEventListener('click', function() { setFilter('overdue', this); });
  // View tab listeners
  document.querySelectorAll('.view-tab[data-view]').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.disabled) return;
      switchView(tab.dataset.view);
    });
  });
  var calPrev = document.getElementById('cal-prev');
  var calNext = document.getElementById('cal-next');
  if (calPrev) calPrev.addEventListener('click', function() {
    if (!currentCalendarMonth) return;
    if (currentCalendarMonth.month === 0) {
      currentCalendarMonth = { year: currentCalendarMonth.year - 1, month: 11 };
    } else {
      currentCalendarMonth = { year: currentCalendarMonth.year, month: currentCalendarMonth.month - 1 };
    }
    renderCalendar();
  });
  if (calNext) calNext.addEventListener('click', function() {
    if (!currentCalendarMonth) return;
    if (currentCalendarMonth.month === 11) {
      currentCalendarMonth = { year: currentCalendarMonth.year + 1, month: 0 };
    } else {
      currentCalendarMonth = { year: currentCalendarMonth.year, month: currentCalendarMonth.month + 1 };
    }
    renderCalendar();
  });
  var tlPrev = document.getElementById('tl-prev');
  var tlNext = document.getElementById('tl-next');
  if (tlPrev) tlPrev.addEventListener('click', function() {
    currentTimelineOffset -= 7;
    renderTimeline();
  });
  if (tlNext) tlNext.addEventListener('click', function() {
    currentTimelineOffset += 7;
    renderTimeline();
  });
  document.addEventListener('keydown', function(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    var modalOpen = document.getElementById('task-modal').style.display !== 'none' ||
                    document.getElementById('change-password-modal').style.display !== 'none';
    if (e.key === 'Escape' && !inInput && !modalOpen && expandedTaskId !== null) {
      expandedTaskId = null;
      renderCurrentView();
    }
    if ((e.key === 'n' || e.key === 'N') && !inInput && !modalOpen && currentPage === 'tasks') {
      openNewTaskModal(null, null, null);
    }
  });

  function onThemeToggle() {
    var current = localStorage.getItem('theme') || 'dark';
    var idx = THEMES.indexOf(current);
    applyTheme(THEMES[(idx + 1) % THEMES.length]);
  }
  var tt = document.getElementById('theme-toggle');
  var ttd = document.getElementById('theme-toggle-drawer');
  if (tt) tt.addEventListener('click', onThemeToggle);
  if (ttd) ttd.addEventListener('click', onThemeToggle);
});
