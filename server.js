require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { tasksDB, nnDB, eventsDB } = require('./database');
const bot = require('./bot');
const scheduler = require('./scheduler');
const { getTodayDate } = require('./ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── API: Tasks ───────────────────────────────────────────────────────────────

app.get('/api/tasks', (req, res) => {
  const { date } = req.query;
  const tasks = date ? tasksDB.getByDate(date) : tasksDB.getAll();
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const { title, description, date, is_non_neg } = req.body;
  if (!title || !date) return res.status(400).json({ error: 'title and date required' });
  const task = tasksDB.create({ title, description, date, is_non_neg: !!is_non_neg });
  io.emit('data_changed', { type: 'task' });
  res.status(201).json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const task = tasksDB.update(parseInt(req.params.id), req.body);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  io.emit('data_changed', { type: 'task' });
  res.json(task);
});

app.patch('/api/tasks/:id/toggle', (req, res) => {
  const task = tasksDB.toggleComplete(parseInt(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  io.emit('data_changed', { type: 'task' });
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  tasksDB.delete(parseInt(req.params.id));
  io.emit('data_changed', { type: 'task' });
  res.json({ success: true });
});

// ─── API: Non-Negotiables ─────────────────────────────────────────────────────

app.get('/api/non-negotiables', (req, res) => {
  const { date } = req.query;
  if (date) {
    res.json(nnDB.getCompletionsForDate(date));
  } else {
    res.json(nnDB.getAll());
  }
});

app.post('/api/non-negotiables', (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const nn = nnDB.create({ title, description });
  io.emit('data_changed', { type: 'nn' });
  res.status(201).json(nn);
});

app.put('/api/non-negotiables/:id', (req, res) => {
  const nn = nnDB.update(parseInt(req.params.id), req.body);
  if (!nn) return res.status(404).json({ error: 'Not found' });
  io.emit('data_changed', { type: 'nn' });
  res.json(nn);
});

app.patch('/api/non-negotiables/:id/complete', (req, res) => {
  const { date, completed } = req.body;
  const result = nnDB.setCompletion(parseInt(req.params.id), date || getTodayDate(), completed !== false);
  io.emit('data_changed', { type: 'nn' });
  res.json(result);
});

app.delete('/api/non-negotiables/:id', (req, res) => {
  nnDB.delete(parseInt(req.params.id));
  io.emit('data_changed', { type: 'nn' });
  res.json({ success: true });
});

// ─── API: Calendar Events ─────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  const { date } = req.query;
  if (date) {
    res.json(eventsDB.getByDate(date));
  } else {
    res.json(eventsDB.getAll());
  }
});

app.post('/api/events', (req, res) => {
  const { title, event_date } = req.body;
  if (!title || !event_date) return res.status(400).json({ error: 'title and event_date required' });
  const event = eventsDB.create(req.body);
  io.emit('data_changed', { type: 'event' });
  res.status(201).json(event);
});

app.put('/api/events/:id', (req, res) => {
  const event = eventsDB.update(parseInt(req.params.id), req.body);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  io.emit('data_changed', { type: 'event' });
  res.json(event);
});

app.delete('/api/events/:id', (req, res) => {
  eventsDB.delete(parseInt(req.params.id));
  io.emit('data_changed', { type: 'event' });
  res.json({ success: true });
});

// ─── API: Today Stats ─────────────────────────────────────────────────────────

app.get('/api/today', (req, res) => {
  const today = getTodayDate();
  res.json({
    date: today,
    tasks: tasksDB.getByDate(today),
    non_negotiables: nnDB.getCompletionsForDate(today),
    events: eventsDB.getByDate(today),
    stats: tasksDB.getStats(today),
  });
});

// ─── Catch-all → index.html ───────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('🌐 Web client connected');
  socket.on('disconnect', () => console.log('🌐 Web client disconnected'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n🚀 Daily Tracker running at http://localhost:${PORT}`);
  console.log(`📱 Access from any device on your network via your IP:${PORT}\n`);

  // Init Telegram bot
  bot.init(io);

  // Init scheduler
  scheduler.init();
});

module.exports = { io };
