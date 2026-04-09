require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { tasksDB, nnDB, eventsDB, chatDB } = require('./database');
const { chat, parseAndExecuteAction, getTodayDate, formatTime } = require('./ai');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const USER_NAME = process.env.USER_NAME || 'Boss';

let bot = null;
let ioInstance = null;

function init(io) {
  if (!TOKEN || TOKEN === 'your_telegram_bot_token_here') {
    console.log('⚠️  Telegram bot not configured. Add TELEGRAM_BOT_TOKEN to .env');
    return null;
  }

  ioInstance = io;
  bot = new TelegramBot(TOKEN, { polling: true });

  bot.on('message', handleMessage);
  bot.on('callback_query', handleCallback);
  bot.on('polling_error', (err) => console.error('Telegram polling error:', err.message));

  console.log('✅ Telegram bot started');
  return bot;
}

function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

async function handleMessage(msg) {
  if (!msg.text) return;
  if (CHAT_ID && msg.chat.id.toString() !== CHAT_ID.toString()) return;

  const text = msg.text.trim();
  const chatId = msg.chat.id;

  // Commands
  if (text === '/start' || text === '/help') {
    return sendHelp(chatId);
  }
  if (text === '/today') {
    return sendTodaySummary(chatId);
  }
  if (text === '/tasks') {
    return sendTaskList(chatId);
  }
  if (text === '/events') {
    return sendEventList(chatId);
  }
  if (text === '/nonneg') {
    return sendNonNegList(chatId);
  }
  if (text === '/done') {
    return sendCompletionMenu(chatId);
  }
  if (text === '/clear') {
    chatDB.clear();
    return bot.sendMessage(chatId, '🧹 Conversation history cleared.');
  }

  // Natural language via Claude
  try {
    bot.sendChatAction(chatId, 'typing');
    const reply = await chat(text);

    // Strip action blocks from display
    const displayReply = reply.replace(/```action[\s\S]*?```/g, '').trim();

    await bot.sendMessage(chatId, displayReply, { parse_mode: 'Markdown' });

    // Execute any actions Claude decided on
    await parseAndExecuteAction(reply, ioInstance);

    // Notify web app
    if (ioInstance) ioInstance.emit('data_changed', { type: 'all' });

  } catch (err) {
    console.error('AI error:', err.message);
    bot.sendMessage(chatId, '❌ Something went wrong. Try again.');
  }
}

async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const date = getTodayDate();

  bot.answerCallbackQuery(query.id);

  if (data.startsWith('complete_task_')) {
    const id = parseInt(data.split('_')[2]);
    tasksDB.toggleComplete(id);
    if (ioInstance) ioInstance.emit('data_changed', { type: 'task' });
    return sendTaskList(chatId);
  }

  if (data.startsWith('complete_nn_')) {
    const id = parseInt(data.split('_')[2]);
    const current = nnDB.getCompletion(id, date);
    const newState = current ? !current.completed : true;
    nnDB.setCompletion(id, date, newState);
    if (ioInstance) ioInstance.emit('data_changed', { type: 'nn' });
    return sendNonNegList(chatId);
  }

  if (data.startsWith('delete_task_')) {
    const id = parseInt(data.split('_')[2]);
    tasksDB.delete(id);
    if (ioInstance) ioInstance.emit('data_changed', { type: 'task' });
    return bot.sendMessage(chatId, '🗑️ Task deleted.');
  }
}

function sendHelp(chatId) {
  const msg = `👋 *Daily Tracker Bot*

*Commands:*
/today — Full today overview
/tasks — View & manage tasks
/events — View calendar events
/nonneg — Non-negotiables status
/done — Quick complete tasks
/clear — Reset conversation

*Or just talk to me naturally:*
• "Add task: call accountant tomorrow"
• "Mark task 5 as done"
• "Add event: dentist on Friday at 2pm"
• "What do I have today?"
• "Add non-negotiable: workout"`;

  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

async function sendTodaySummary(chatId) {
  const date = getTodayDate();
  const tasks = tasksDB.getByDate(date);
  const nns = nnDB.getCompletionsForDate(date);
  const events = eventsDB.getByDate(date);

  let msg = `📅 *Today — ${date}*\n\n`;

  if (nns.length > 0) {
    const done = nns.filter(n => n.done_today).length;
    msg += `⭐ *Non-Negotiables (${done}/${nns.length}):*\n`;
    nns.forEach(n => msg += `  ${n.done_today ? '✅' : '⬜'} ${escapeMarkdown(n.title)}\n`);
    msg += '\n';
  }

  const pending = tasks.filter(t => !t.completed);
  const done = tasks.filter(t => t.completed);

  if (tasks.length > 0) {
    msg += `📋 *Tasks (${done.length}/${tasks.length}):*\n`;
    pending.forEach(t => msg += `  ⬜ ${escapeMarkdown(t.title)}\n`);
    done.forEach(t => msg += `  ✅ ~~${escapeMarkdown(t.title)}~~\n`);
    msg += '\n';
  }

  if (events.length > 0) {
    msg += `🗓️ *Events:*\n`;
    events.forEach(e => msg += `  📌 ${escapeMarkdown(e.title)}${e.event_time ? ` at ${formatTime(e.event_time)}` : ''}\n`);
  }

  if (tasks.length === 0 && nns.length === 0 && events.length === 0) {
    msg += '_Nothing scheduled for today. Add some tasks!_';
  }

  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

function sendTaskList(chatId) {
  const date = getTodayDate();
  const tasks = tasksDB.getByDate(date);

  if (tasks.length === 0) {
    return bot.sendMessage(chatId, '📋 No tasks for today. Send me something to add!');
  }

  const keyboard = tasks.map(t => ([{
    text: `${t.completed ? '✅' : '⬜'} ${t.is_non_neg ? '⭐' : ''} ${t.title.substring(0, 40)}`,
    callback_data: `complete_task_${t.id}`
  }]));

  bot.sendMessage(chatId, '📋 *Today\'s Tasks* — tap to toggle:', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

function sendNonNegList(chatId) {
  const date = getTodayDate();
  const nns = nnDB.getCompletionsForDate(date);

  if (nns.length === 0) {
    return bot.sendMessage(chatId, '⭐ No non-negotiables set. Tell me what\'s non-negotiable daily!');
  }

  const keyboard = nns.map(n => ([{
    text: `${n.done_today ? '✅' : '⬜'} ${n.title.substring(0, 50)}`,
    callback_data: `complete_nn_${n.id}`
  }]));

  const done = nns.filter(n => n.done_today).length;
  bot.sendMessage(chatId, `⭐ *Non-Negotiables (${done}/${nns.length}):*`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

function sendEventList(chatId) {
  const upcoming = eventsDB.getUpcoming(14);

  if (upcoming.length === 0) {
    return bot.sendMessage(chatId, '📅 No upcoming events. Add one by telling me about it!');
  }

  let msg = '📅 *Upcoming Events:*\n\n';
  upcoming.forEach(e => {
    msg += `📌 *${escapeMarkdown(e.title)}*\n`;
    msg += `   📆 ${e.event_date}${e.event_time ? ` at ${formatTime(e.event_time)}` : ''}\n`;
    if (e.location) msg += `   📍 ${escapeMarkdown(e.location)}\n`;
    msg += '\n';
  });

  bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

function sendCompletionMenu(chatId) {
  const date = getTodayDate();
  const pending = tasksDB.getByDate(date).filter(t => !t.completed);

  if (pending.length === 0) {
    return bot.sendMessage(chatId, '🎉 All tasks are done!');
  }

  const keyboard = pending.map(t => ([{
    text: `✅ ${t.title.substring(0, 50)}`,
    callback_data: `complete_task_${t.id}`
  }]));

  bot.sendMessage(chatId, '✅ *Mark as complete:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ─── Send functions (called by scheduler) ─────────────────────────────────────

async function sendMessage(text, opts = {}) {
  if (!bot || !CHAT_ID) return;
  try {
    await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', ...opts });
  } catch (err) {
    console.error('Telegram send error:', err.message);
  }
}

async function sendMorningBriefing(briefing) {
  await sendMessage(`🌅 *Good Morning, ${USER_NAME}!*\n\n${briefing}`);
}

async function sendEveningSummary(summary) {
  await sendMessage(`🌙 *Evening Wrap-Up*\n\n${summary}`);
}

async function sendMidDayReminder(message) {
  await sendMessage(message);
}

async function sendEventReminder(event, minutesBefore) {
  const when = minutesBefore >= 60 * 24 * 7
    ? '1 week'
    : minutesBefore >= 60 * 24
    ? '1 day'
    : minutesBefore >= 240
    ? '4 hours'
    : minutesBefore >= 120
    ? '2 hours'
    : minutesBefore >= 60
    ? '1 hour'
    : minutesBefore >= 30
    ? '30 minutes'
    : '10 minutes';

  let msg = `🔔 *Reminder: ${escapeMarkdown(event.title)}*\n`;
  msg += `⏰ Starting in *${when}*\n`;
  if (event.event_time) msg += `🕐 ${formatTime(event.event_time)}\n`;
  if (event.location) msg += `📍 ${escapeMarkdown(event.location)}\n`;

  await sendMessage(msg);
}

module.exports = { init, sendMessage, sendMorningBriefing, sendEveningSummary, sendMidDayReminder, sendEventReminder, sendTodaySummary };
