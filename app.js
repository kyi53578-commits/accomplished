/* ── State ─────────────────────────────────────────────────────────────────── */
const state = {
  currentView: 'calendar',
  currentMonth: new Date(),
  selectedDate: null,
  today: new Date().toLocaleDateString('en-CA'),
  tasks: [],
  nonNeg: [],
  events: [],
  allEvents: [],
  selectedColor: '#6366f1',
  editingTaskId: null,
  editingEventId: null,
};

/* ── API ───────────────────────────────────────────────────────────────────── */
const api = {
  get: (url) => fetch(url).then(r => r.json()),
  post: (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  put: (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  patch: (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json()),
  del: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
};

/* ── Init ──────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Theme
  const savedTheme = localStorage.getItem('theme') || 'dark';
  if (savedTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  document.getElementById('themeToggle').textContent = savedTheme === 'light' ? '☀️' : '🌙';

  // Set today's date picker
  document.getElementById('taskDatePicker').value = state.today;

  // Load data
  await loadAll();

  // Render
  renderSidebar();
  renderCalendar();

  // Events
  bindEvents();

  // Socket.io for real-time updates
  const socket = io();
  socket.on('data_changed', async () => {
    await loadAll();
    renderSidebar();
    if (state.currentView === 'calendar') renderCalendar();
    if (state.currentView === 'tasks') renderTasksView();
    if (state.currentView === 'events') renderEventsView();
    if (state.selectedDate) renderDayPanel(state.selectedDate);
  });
});

async function loadAll() {
  const [tasks, nns, events] = await Promise.all([
    api.get(`/api/tasks?date=${state.today}`),
    api.get(`/api/non-negotiables?date=${state.today}`),
    api.get('/api/events'),
  ]);
  state.tasks = tasks;
  state.nonNeg = nns;
  state.allEvents = events;
}

/* ── Sidebar ───────────────────────────────────────────────────────────────── */
function renderSidebar() {
  // Date
  document.getElementById('statDate').textContent = formatDateDisplay(state.today);

  // Stats
  const done = state.tasks.filter(t => t.completed).length;
  const total = state.tasks.length;
  const nnDone = state.nonNeg.filter(n => n.done_today).length;
  const nnTotal = state.nonNeg.length;

  document.getElementById('taskCount').textContent = `${done}/${total}`;
  document.getElementById('nnCount').textContent = `${nnDone}/${nnTotal}`;
  document.getElementById('taskProgress').style.width = total ? `${(done / total) * 100}%` : '0%';
  document.getElementById('nnProgress').style.width = nnTotal ? `${(nnDone / nnTotal) * 100}%` : '0%';

  // Non-negotiables
  const nnList = document.getElementById('nnList');
  if (state.nonNeg.length === 0) {
    nnList.innerHTML = '<div class="empty-msg">None yet — add your daily musts</div>';
  } else {
    nnList.innerHTML = state.nonNeg.map(n => `
      <div class="nn-item ${n.done_today ? 'done' : ''}" data-id="${n.id}">
        <div class="nn-check">${n.done_today ? '✓' : ''}</div>
        <span class="nn-title">${esc(n.title)}</span>
        <button class="btn-del" data-nn-del="${n.id}" title="Delete">×</button>
      </div>
    `).join('');
  }

  // Today's events
  const todayEvents = state.allEvents.filter(e => e.event_date === state.today);
  const tel = document.getElementById('todayEventsList');
  if (todayEvents.length === 0) {
    tel.innerHTML = '<div class="empty-msg">No events today</div>';
  } else {
    tel.innerHTML = todayEvents.map(e => `
      <div class="event-mini" style="border-left-color:${e.color}">
        <div class="event-mini-dot">📌</div>
        <div>
          <div class="event-mini-title">${esc(e.title)}</div>
          ${e.event_time ? `<div class="event-mini-time">${formatTime(e.event_time)}</div>` : ''}
        </div>
      </div>
    `).join('');
  }
}

/* ── Calendar ──────────────────────────────────────────────────────────────── */
function renderCalendar() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();

  document.getElementById('calendarTitle').textContent =
    state.currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const body = document.getElementById('calendarBody');
  const cells = [];

  // Prev month days
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ day: daysInPrev - i, month: month - 1, year, other: true });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month, year, other: false });
  }
  // Next month fill
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, month: month + 1, year, other: true });
  }

  body.innerHTML = cells.map(cell => {
    const dateStr = new Date(cell.year, cell.month, cell.day).toLocaleDateString('en-CA');
    const isToday = dateStr === state.today;
    const isSelected = dateStr === state.selectedDate;

    // Gather items for this date
    const dayEvents = state.allEvents.filter(e => e.event_date === dateStr);
    const dayTasks = []; // Would need all tasks to show — we'll show event dots only

    const pills = dayEvents.slice(0, 2).map(e =>
      `<div class="cal-pill event" style="background:${e.color}22;color:${e.color}">${esc(e.title)}</div>`
    ).join('');

    const more = dayEvents.length > 2 ? `<div class="cal-more">+${dayEvents.length - 2} more</div>` : '';

    return `
      <div class="cal-day ${cell.other ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}"
           data-date="${dateStr}">
        <div class="cal-day-num">${cell.day}</div>
        ${pills}${more}
      </div>
    `;
  }).join('');

  // Click handler for calendar days
  body.querySelectorAll('.cal-day').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedDate = el.dataset.date;
      renderCalendar(); // re-render to update selected
      openDayPanel(el.dataset.date);
    });
  });
}

function openDayPanel(date) {
  const panel = document.getElementById('dayPanel');
  panel.classList.add('open');
  document.getElementById('dayPanelTitle').textContent = formatDateDisplay(date);
  renderDayPanel(date);
}

async function renderDayPanel(date) {
  const [tasks, events] = await Promise.all([
    api.get(`/api/tasks?date=${date}`),
    api.get(`/api/events?date=${date}`),
  ]);

  const content = document.getElementById('dayPanelContent');

  let html = '';

  // Events section
  html += `<div class="panel-section">
    <div class="panel-section-title">
      <span>📅 Events</span>
      <button class="panel-add-btn" onclick="openAddEvent('${date}')">+ Add</button>
    </div>`;

  if (events.length === 0) {
    html += '<div class="empty-msg">No events</div>';
  } else {
    events.forEach(e => {
      html += `
        <div class="event-card" style="margin-bottom:8px">
          <div class="event-color-bar" style="background:${e.color}"></div>
          <div class="event-info">
            <div class="event-title">${esc(e.title)}</div>
            <div class="event-meta">${e.event_time ? formatTime(e.event_time) : 'All day'}${e.location ? ' · ' + esc(e.location) : ''}</div>
          </div>
          <div class="event-actions">
            <button class="task-action-btn delete" onclick="deleteEvent(${e.id})">🗑</button>
          </div>
        </div>`;
    });
  }
  html += '</div>';

  // Tasks section
  html += `<div class="panel-section">
    <div class="panel-section-title">
      <span>✅ Tasks</span>
      <button class="panel-add-btn" onclick="openAddTask('${date}')">+ Add</button>
    </div>`;

  if (tasks.length === 0) {
    html += '<div class="empty-msg">No tasks</div>';
  } else {
    tasks.forEach(t => {
      html += `
        <div class="task-item ${t.completed ? 'done' : ''} ${t.is_non_neg ? 'non-neg' : ''}" style="margin-bottom:6px" onclick="toggleTask(${t.id})">
          <div class="task-check">${t.completed ? '✓' : ''}</div>
          <div class="task-info">
            <div class="task-title">${esc(t.title)}</div>
            ${t.is_non_neg ? '<span class="task-badge nn">⭐ Non-neg</span>' : ''}
          </div>
          <button class="task-action-btn delete" onclick="event.stopPropagation();deleteTask(${t.id})">🗑</button>
        </div>`;
    });
  }
  html += '</div>';

  content.innerHTML = html;
}

/* ── Tasks View ────────────────────────────────────────────────────────────── */
async function renderTasksView() {
  const date = document.getElementById('taskDatePicker').value || state.today;
  const tasks = await api.get(`/api/tasks?date=${date}`);
  const list = document.getElementById('tasksList');

  if (tasks.length === 0) {
    list.innerHTML = `<div class="empty-msg" style="padding:40px;text-align:center;font-size:14px;color:var(--text3)">
      No tasks for ${formatDateDisplay(date)}.<br/>Click "+ Add Task" to get started.
    </div>`;
    return;
  }

  list.innerHTML = tasks.map(t => `
    <div class="task-item ${t.completed ? 'done' : ''} ${t.is_non_neg ? 'non-neg' : ''}" onclick="toggleTask(${t.id})">
      <div class="task-check">${t.completed ? '✓' : ''}</div>
      <div class="task-info">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">${t.description || ''} ${t.is_non_neg ? '⭐' : ''}</div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" onclick="event.stopPropagation();editTask(${t.id})" title="Edit">✏️</button>
        <button class="task-action-btn delete" onclick="event.stopPropagation();deleteTask(${t.id})" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
}

/* ── Events View ───────────────────────────────────────────────────────────── */
async function renderEventsView() {
  const events = await api.get('/api/events');
  const list = document.getElementById('allEventsList');

  if (events.length === 0) {
    list.innerHTML = `<div class="empty-msg" style="padding:40px;text-align:center;font-size:14px;color:var(--text3)">
      No events scheduled.<br/>Click "+ Add Event" to add one.
    </div>`;
    return;
  }

  list.innerHTML = events.map(e => `
    <div class="event-card">
      <div class="event-color-bar" style="background:${e.color}"></div>
      <div class="event-info">
        <div class="event-title">${esc(e.title)}</div>
        <div class="event-meta">
          📆 ${e.event_date}${e.event_time ? ' · ' + formatTime(e.event_time) : ' · All day'}
          ${e.location ? '<br>📍 ' + esc(e.location) : ''}
          ${e.description ? '<br>' + esc(e.description) : ''}
        </div>
      </div>
      <div class="event-actions">
        <button class="task-action-btn" onclick="editEvent(${e.id})" title="Edit">✏️</button>
        <button class="task-action-btn delete" onclick="deleteEvent(${e.id})" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
}

/* ── Actions ───────────────────────────────────────────────────────────────── */
async function toggleTask(id) {
  await api.patch(`/api/tasks/${id}/toggle`);
  await loadAll();
  renderSidebar();
  if (state.currentView === 'tasks') renderTasksView();
  if (state.selectedDate) renderDayPanel(state.selectedDate);
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  await api.del(`/api/tasks/${id}`);
  await loadAll();
  renderSidebar();
  if (state.currentView === 'tasks') renderTasksView();
  if (state.selectedDate) renderDayPanel(state.selectedDate);
  renderCalendar();
}

async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  await api.del(`/api/events/${id}`);
  await loadAll();
  renderSidebar();
  if (state.currentView === 'events') renderEventsView();
  if (state.selectedDate) renderDayPanel(state.selectedDate);
  renderCalendar();
}

async function toggleNN(id) {
  const nn = state.nonNeg.find(n => n.id === id);
  if (!nn) return;
  await api.patch(`/api/non-negotiables/${id}/complete`, { date: state.today, completed: !nn.done_today });
  await loadAll();
  renderSidebar();
}

async function deleteNN(id) {
  if (!confirm('Remove this non-negotiable?')) return;
  await api.del(`/api/non-negotiables/${id}`);
  await loadAll();
  renderSidebar();
}

function editTask(id) {
  const t = state.tasks.find(t => t.id === id) || { id };
  openTaskModal(t.date, t);
}

function editEvent(id) {
  const e = state.allEvents.find(e => e.id === id);
  if (e) openEventModal(e.event_date, e);
}

/* ── Modal Openers ─────────────────────────────────────────────────────────── */
function openAddTask(date) {
  openTaskModal(date || state.today, null);
}

function openTaskModal(date, task) {
  state.editingTaskId = task ? task.id : null;
  document.getElementById('taskModalTitle').textContent = task ? 'Edit Task' : 'Add Task';
  document.getElementById('taskId').value = task ? task.id : '';
  document.getElementById('taskTitle').value = task ? task.title : '';
  document.getElementById('taskDesc').value = task ? (task.description || '') : '';
  document.getElementById('taskDate').value = date || state.today;
  document.getElementById('taskNonNeg').checked = task ? !!task.is_non_neg : false;
  document.getElementById('taskModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('taskTitle').focus(), 50);
}

function openAddEvent(date) {
  openEventModal(date || state.today, null);
}

function openEventModal(date, event) {
  state.editingEventId = event ? event.id : null;
  state.selectedColor = event ? event.color : '#6366f1';
  document.getElementById('eventModalTitle').textContent = event ? 'Edit Event' : 'Add Event';
  document.getElementById('eventId').value = event ? event.id : '';
  document.getElementById('eventTitle').value = event ? event.title : '';
  document.getElementById('eventDesc').value = event ? (event.description || '') : '';
  document.getElementById('eventDate').value = date || state.today;
  document.getElementById('eventTime').value = event ? (event.event_time || '') : '';
  document.getElementById('eventLocation').value = event ? (event.location || '') : '';

  // Update color picker
  document.querySelectorAll('.color-opt').forEach(el => {
    el.classList.toggle('active', el.dataset.color === state.selectedColor);
  });

  document.getElementById('eventModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('eventTitle').focus(), 50);
}

function openNNModal() {
  document.getElementById('nnTitle').value = '';
  document.getElementById('nnDesc').value = '';
  document.getElementById('nnModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('nnTitle').focus(), 50);
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/* ── Form Submissions ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Task form
  document.getElementById('taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title: document.getElementById('taskTitle').value.trim(),
      description: document.getElementById('taskDesc').value.trim(),
      date: document.getElementById('taskDate').value,
      is_non_neg: document.getElementById('taskNonNeg').checked,
    };
    if (!data.title || !data.date) return;

    if (state.editingTaskId) {
      await api.put(`/api/tasks/${state.editingTaskId}`, data);
    } else {
      await api.post('/api/tasks', data);
    }

    closeModal('taskModal');
    await loadAll();
    renderSidebar();
    if (state.currentView === 'tasks') renderTasksView();
    if (state.selectedDate) renderDayPanel(state.selectedDate);
    renderCalendar();
  });

  // Event form
  document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title: document.getElementById('eventTitle').value.trim(),
      description: document.getElementById('eventDesc').value.trim(),
      event_date: document.getElementById('eventDate').value,
      event_time: document.getElementById('eventTime').value || null,
      location: document.getElementById('eventLocation').value.trim(),
      color: state.selectedColor,
    };
    if (!data.title || !data.event_date) return;

    if (state.editingEventId) {
      await api.put(`/api/events/${state.editingEventId}`, data);
    } else {
      await api.post('/api/events', data);
    }

    closeModal('eventModal');
    await loadAll();
    renderSidebar();
    if (state.currentView === 'events') renderEventsView();
    if (state.selectedDate) renderDayPanel(state.selectedDate);
    renderCalendar();
  });

  // NN form
  document.getElementById('nnForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title: document.getElementById('nnTitle').value.trim(),
      description: document.getElementById('nnDesc').value.trim(),
    };
    if (!data.title) return;
    await api.post('/api/non-negotiables', data);
    closeModal('nnModal');
    await loadAll();
    renderSidebar();
  });
});

/* ── Bind UI Events ────────────────────────────────────────────────────────── */
function bindEvents() {
  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      state.currentView = view;

      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

      if (view === 'calendar') {
        document.getElementById('calendarView').classList.remove('hidden');
        renderCalendar();
      } else if (view === 'tasks') {
        document.getElementById('tasksView').classList.remove('hidden');
        renderTasksView();
      } else if (view === 'events') {
        document.getElementById('eventsView').classList.remove('hidden');
        renderEventsView();
      }
    });
  });

  // Calendar nav
  document.getElementById('prevMonth').addEventListener('click', () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById('goToday').addEventListener('click', () => {
    state.currentMonth = new Date();
    state.selectedDate = state.today;
    renderCalendar();
    openDayPanel(state.today);
  });

  // Close day panel
  document.getElementById('closeDayPanel').addEventListener('click', () => {
    document.getElementById('dayPanel').classList.remove('open');
    state.selectedDate = null;
    renderCalendar();
  });

  // Add buttons
  document.getElementById('addNNBtn').addEventListener('click', openNNModal);
  document.getElementById('addEventBtn').addEventListener('click', () => openEventModal(state.today, null));
  document.getElementById('addTaskBtn').addEventListener('click', () => {
    const date = document.getElementById('taskDatePicker').value || state.today;
    openAddTask(date);
  });
  document.getElementById('addEventBtnMain').addEventListener('click', () => openEventModal(state.today, null));

  // Modal close buttons
  document.getElementById('closeTaskModal').addEventListener('click', () => closeModal('taskModal'));
  document.getElementById('cancelTaskModal').addEventListener('click', () => closeModal('taskModal'));
  document.getElementById('closeEventModal').addEventListener('click', () => closeModal('eventModal'));
  document.getElementById('cancelEventModal').addEventListener('click', () => closeModal('eventModal'));
  document.getElementById('closeNNModal').addEventListener('click', () => closeModal('nnModal'));
  document.getElementById('cancelNNModal').addEventListener('click', () => closeModal('nnModal'));

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Task date picker change
  document.getElementById('taskDatePicker').addEventListener('change', () => renderTasksView());

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.getElementById('themeToggle').textContent = next === 'light' ? '☀️' : '🌙';
    localStorage.setItem('theme', next);
  });

  // Color picker
  document.querySelectorAll('.color-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.color-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      state.selectedColor = opt.dataset.color;
    });
  });

  // NN list delegation
  document.getElementById('nnList').addEventListener('click', (e) => {
    const item = e.target.closest('.nn-item');
    const delBtn = e.target.closest('[data-nn-del]');
    if (delBtn) {
      e.stopPropagation();
      deleteNN(parseInt(delBtn.dataset.nnDel));
    } else if (item) {
      toggleNN(parseInt(item.dataset.id));
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
      document.getElementById('dayPanel').classList.remove('open');
    }
  });
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${m} ${ampm}`;
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// Make functions available globally for inline onclick handlers
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
window.deleteEvent = deleteEvent;
window.editTask = editTask;
window.editEvent = editEvent;
window.openAddTask = openAddTask;
window.openAddEvent = openAddEvent;
