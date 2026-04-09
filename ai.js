require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { tasksDB, nnDB, eventsDB, chatDB } = require('./database');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TIMEZONE = process.env.TIMEZONE || 'America/New_York';
const USER_NAME = process.env.USER_NAME || 'Boss';

function getTodayDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function buildContextBlock(date) {
  const tasks = tasksDB.getByDate(date);
  const nns = nnDB.getCompletionsForDate(date);
  const events = eventsDB.getByDate(date);
  const upcoming = eventsDB.getUpcoming(7);

  const pendingTasks = tasks.filter(t => !t.completed);
  const doneTasks = tasks.filter(t => t.completed);
  const pendingNN = nns.filter(n => !n.done_today);
  const doneNN = nns.filter(n => n.done_today);

  let ctx = `Today is ${date}.\n\n`;

  if (nns.length > 0) {
    ctx += `NON-NEGOTIABLES (${doneNN.length}/${nns.length} done):\n`;
    for (const n of nns) ctx += `  ${n.done_today ? '✅' : '⬜'} ${n.title}\n`;
    ctx += '\n';
  }

  if (tasks.length > 0) {
    ctx += `TO-DO LIST (${doneTasks.length}/${tasks.length} done):\n`;
    for (const t of pendingTasks) ctx += `  ⬜ [${t.id}] ${t.title}${t.is_non_neg ? ' ⭐' : ''}\n`;
    for (const t of doneTasks) ctx += `  ✅ [${t.id}] ${t.title}\n`;
    ctx += '\n';
  }

  if (events.length > 0) {
    ctx += `TODAY'S CALENDAR EVENTS:\n`;
    for (const e of events) ctx += `  📅 ${e.title}${e.event_time ? ` at ${formatTime(e.event_time)}` : ''}${e.location ? ` @ ${e.location}` : ''}\n`;
    ctx += '\n';
  }

  if (upcoming.filter(e => e.event_date !== date).length > 0) {
    ctx += `UPCOMING EVENTS (next 7 days):\n`;
    for (const e of upcoming.filter(e => e.event_date !== date)) {
      ctx += `  📅 ${e.event_date}: ${e.title}${e.event_time ? ` at ${formatTime(e.event_time)}` : ''}\n`;
    }
  }

  return ctx;
}

async function chat(userMessage, isInternal = false) {
  const date = getTodayDate();
  const context = buildContextBlock(date);

  const systemPrompt = `You are a sharp, direct personal productivity assistant for ${USER_NAME}. You manage their daily tasks, non-negotiables, and calendar events.

CURRENT STATE:
${context}

CAPABILITIES - You can tell the user what to do or interpret requests as commands. When the user asks you to add/update/delete tasks or events, respond with a JSON action block at the END of your message:

\`\`\`action
{"action": "add_task", "title": "...", "date": "YYYY-MM-DD", "is_non_neg": false}
{"action": "complete_task", "id": 123}
{"action": "delete_task", "id": 123}
{"action": "add_event", "title": "...", "event_date": "YYYY-MM-DD", "event_time": "HH:MM", "location": "..."}
{"action": "add_non_neg", "title": "..."}
{"action": "complete_non_neg", "id": 123, "date": "YYYY-MM-DD"}
\`\`\`

Rules:
- Be concise and direct. No fluff.
- Use emojis sparingly for clarity.
- When completing the morning briefing or evening summary, be motivating but brief.
- Always use the exact date format YYYY-MM-DD.
- Today's date: ${date}`;

  // Build conversation history
  const history = chatDB.getRecent(10);
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  if (!isInternal) {
    chatDB.add('user', userMessage);
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const reply = response.content[0].text;

  if (!isInternal) {
    chatDB.add('assistant', reply);
  }

  return reply;
}

async function generateMorningBriefing() {
  const date = getTodayDate();
  const context = buildContextBlock(date);

  const prompt = `Generate a sharp morning briefing for ${USER_NAME}. Start with "Good morning!" Include:
1. Today's non-negotiables (emphasize these are mandatory)
2. Today's to-do list
3. Any calendar events today
4. One motivational sentence

Context:
${context}

Keep it under 300 words. Be direct and energizing.`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

async function generateEveningSummary() {
  const date = getTodayDate();
  const context = buildContextBlock(date);

  // Get tomorrow's data
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  const tomorrowTasks = tasksDB.getByDate(tomorrowDate);
  const tomorrowEvents = eventsDB.getByDate(tomorrowDate);

  let tomorrowCtx = '';
  if (tomorrowTasks.length > 0) {
    tomorrowCtx += `TOMORROW'S TASKS:\n${tomorrowTasks.map(t => `  - ${t.title}`).join('\n')}\n`;
  }
  if (tomorrowEvents.length > 0) {
    tomorrowCtx += `TOMORROW'S EVENTS:\n${tomorrowEvents.map(e => `  - ${e.title}${e.event_time ? ` at ${formatTime(e.event_time)}` : ''}`).join('\n')}\n`;
  }

  const prompt = `Generate an evening summary for ${USER_NAME}. Include:
1. What was accomplished today (be specific about completed tasks)
2. What wasn't completed and should carry over
3. One insight on what could have gone better
4. Preview of tomorrow

Today's data:
${context}

${tomorrowCtx}

Keep it under 300 words. Be honest and constructive, not harsh.`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

async function generateMidDayCheck(hour) {
  const date = getTodayDate();
  const stats = tasksDB.getStats(date);
  const nns = nnDB.getCompletionsForDate(date);
  const doneNN = nns.filter(n => n.done_today).length;
  const pending = tasksDB.getByDate(date).filter(t => !t.completed);

  let message = `⏰ *${hour}:00 Check-in*\n\n`;
  message += `📊 Progress: ${stats.completed}/${stats.total} tasks done`;
  if (stats.nonNeg > 0) message += ` | Non-negotiables: ${stats.nonNegCompleted}/${stats.nonNeg}`;
  message += '\n';

  if (pending.length > 0) {
    message += `\n📋 Still on your list:\n`;
    pending.slice(0, 5).forEach(t => {
      message += `  ${t.is_non_neg ? '⭐' : '•'} ${t.title}\n`;
    });
    if (pending.length > 5) message += `  ... and ${pending.length - 5} more\n`;
  }

  if (pending.length === 0 && stats.total > 0) {
    message += `\n🎉 Everything's done! You're crushing it today.`;
  } else if (pending.length > 0) {
    const pendingNN = nns.filter(n => !n.done_today);
    if (pendingNN.length > 0) {
      message += `\n⚠️ Non-negotiables pending: ${pendingNN.map(n => n.title).join(', ')}`;
    }
  }

  return message;
}

// Parse and execute action from AI response
async function parseAndExecuteAction(reply, io) {
  const actionMatch = reply.match(/```action\n([\s\S]*?)```/);
  if (!actionMatch) return;

  const lines = actionMatch[1].trim().split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const action = JSON.parse(line);
      const date = getTodayDate();

      switch (action.action) {
        case 'add_task':
          tasksDB.create({ title: action.title, date: action.date || date, is_non_neg: action.is_non_neg || false });
          break;
        case 'complete_task':
          tasksDB.update(action.id, { completed: true });
          break;
        case 'delete_task':
          tasksDB.delete(action.id);
          break;
        case 'add_event':
          eventsDB.create({ title: action.title, event_date: action.event_date, event_time: action.event_time, location: action.location });
          break;
        case 'add_non_neg':
          nnDB.create({ title: action.title });
          break;
        case 'complete_non_neg':
          nnDB.setCompletion(action.id, action.date || date, true);
          break;
      }

      if (io) io.emit('data_changed', { type: 'task' });
    } catch (e) {
      // Invalid JSON line, skip
    }
  }
}

module.exports = { chat, generateMorningBriefing, generateEveningSummary, generateMidDayCheck, parseAndExecuteAction, getTodayDate, formatTime };
