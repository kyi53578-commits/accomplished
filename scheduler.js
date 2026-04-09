require('dotenv').config();
const cron = require('node-cron');
const { eventsDB } = require('./database');
const { generateMorningBriefing, generateEveningSummary, generateMidDayCheck, getTodayDate, formatTime } = require('./ai');
const bot = require('./bot');

const TIMEZONE = process.env.TIMEZONE || 'America/New_York';

// Reminder schedule: every 2 hours from 6AM to 10PM
// 6 AM  = morning briefing
// 8 AM  = mid-day check
// 10 AM = mid-day check
// 12 PM = mid-day check
// 2 PM  = mid-day check
// 4 PM  = mid-day check
// 6 PM  = mid-day check
// 8 PM  = mid-day check
// 10 PM = evening summary

function init() {
  // ── 6 AM: Morning Briefing ──────────────────────────────────────────────────
  cron.schedule('0 6 * * *', async () => {
    console.log('⏰ Sending morning briefing...');
    try {
      const briefing = await generateMorningBriefing();
      await bot.sendMorningBriefing(briefing);
    } catch (err) {
      console.error('Morning briefing error:', err.message);
    }
  }, { timezone: TIMEZONE });

  // ── Every 2 hours 8AM–8PM: Mid-day checks ──────────────────────────────────
  const midDayHours = [8, 10, 12, 14, 16, 18, 20];
  for (const hour of midDayHours) {
    cron.schedule(`0 ${hour} * * *`, async () => {
      console.log(`⏰ Sending ${hour}:00 check-in...`);
      try {
        const message = await generateMidDayCheck(hour);
        await bot.sendMidDayReminder(message);
      } catch (err) {
        console.error(`${hour}:00 check-in error:`, err.message);
      }
    }, { timezone: TIMEZONE });
  }

  // ── 10 PM: Evening Summary ──────────────────────────────────────────────────
  cron.schedule('0 22 * * *', async () => {
    console.log('⏰ Sending evening summary...');
    try {
      const summary = await generateEveningSummary();
      await bot.sendEveningSummary(summary);
    } catch (err) {
      console.error('Evening summary error:', err.message);
    }
  }, { timezone: TIMEZONE });

  // ── Every minute: Check calendar event reminders ────────────────────────────
  cron.schedule('* * * * *', async () => {
    await checkEventReminders();
  }, { timezone: TIMEZONE });

  console.log(`✅ Scheduler started (timezone: ${TIMEZONE})`);
}

async function checkEventReminders() {
  const now = new Date();
  const today = getTodayDate();

  // Get events for the next 8 days
  const events = eventsDB.getUpcoming(8);

  for (const event of events) {
    if (!event.event_time) continue; // Skip all-day events for time reminders

    // Build event datetime
    const eventDatetime = new Date(`${event.event_date}T${event.event_time}:00`);

    // Convert to user's timezone offset approximation
    const diffMs = eventDatetime.getTime() - now.getTime();
    const diffMinutes = Math.round(diffMs / 60000);

    // Reminder thresholds in minutes
    const reminders = [
      { key: '1week', minutes: 7 * 24 * 60, label: '1 week' },
      { key: '1day',  minutes: 24 * 60,      label: '1 day' },
      { key: '4h',    minutes: 240,           label: '4 hours' },
      { key: '2h',    minutes: 120,           label: '2 hours' },
      { key: '1h',    minutes: 60,            label: '1 hour' },
      { key: '30m',   minutes: 30,            label: '30 minutes' },
      { key: '10m',   minutes: 10,            label: '10 minutes' },
    ];

    for (const reminder of reminders) {
      // Fire within 1-minute window of the reminder time
      if (diffMinutes >= reminder.minutes - 1 && diffMinutes <= reminder.minutes + 1) {
        const wasAlreadySent = eventsDB.wasReminderSent(event.id, reminder.key);
        if (!wasAlreadySent) {
          console.log(`📅 Sending ${reminder.label} reminder for: ${event.title}`);
          await bot.sendEventReminder(event, reminder.minutes);
          eventsDB.markReminderSent(event.id, reminder.key);
        }
      }
    }
  }
}

module.exports = { init };
