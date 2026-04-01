

const cron       = require('node-cron');
const nodemailer = require('nodemailer');
const { supabase } = require('./database');
require('dotenv').config();


// We use Gmail via Nodemailer. MAIL_USER and MAIL_PASS come from .env
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});


/**
 * Format a reminder offset (minutes) into a human-readable label.
 * e.g. 5 → "5 minutes", 60 → "1 hour", 1440 → "1 day"
 */
function formatOffset(minutes) {
  if (minutes < 60)   return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  if (minutes < 1440) {
    const h = minutes / 60;
    return `${h} hour${h !== 1 ? 's' : ''}`;
  }
  const d = minutes / 1440;
  return `${d} day${d !== 1 ? 's' : ''}`;
}


/**
 * Returns a clean HTML email body for a task reminder.
 * This is what the student will actually see in their inbox.
 */
function buildEmailHTML(name, taskTitle, dueDate, dueTime, offsetMinutes) {
  const timeStr   = dueTime ? ` at ${dueTime}` : '';
  const offsetStr = formatOffset(offsetMinutes);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Reminder — SAPlanner</title>
</head>
<body style="margin:0;padding:0;background:#0e0f13;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#16181f;border:1px solid #2a2d38;border-top:3px solid #c8f542;">
    <!-- Header -->
    <div style="padding:28px 32px 20px;border-bottom:1px solid #2a2d38;">
      <div style="font-weight:800;font-size:18px;color:#c8f542;letter-spacing:-0.5px;">SAPlanner</div>
      <div style="font-size:11px;color:#6b7080;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Smart Academic Planner</div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <p style="color:#e8eaf0;font-size:15px;margin:0 0 8px;">Hi <strong>${name}</strong> 👋</p>
      <p style="color:#6b7080;font-size:13px;margin:0 0 28px;line-height:1.6;">
        This is a friendly reminder from SAPlanner. One of your tasks is coming up soon!
      </p>

      <!-- Task card -->
      <div style="background:#1e2029;border:1px solid #2a2d38;border-left:4px solid #c8f542;padding:20px 24px;margin-bottom:28px;">
        <div style="font-size:11px;color:#6b7080;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">Task</div>
        <div style="font-size:18px;font-weight:700;color:#e8eaf0;margin-bottom:12px;">${taskTitle}</div>
        <div style="font-size:12px;color:#6b7080;">
          📅 Due: <span style="color:#e8eaf0;">${dueDate}${timeStr}</span>
        </div>
        <div style="font-size:12px;color:#ffd166;margin-top:6px;">
          ⏰ This reminder fires <strong>${offsetStr}</strong> before the deadline
        </div>
      </div>

      <p style="color:#6b7080;font-size:12px;line-height:1.6;margin:0;">
        Log in to SAPlanner to update your task, mark it complete, or adjust your reminders.
        You're doing great — keep going! 💪
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;border-top:1px solid #2a2d38;font-size:10px;color:#6b7080;letter-spacing:0.5px;">
      This email was sent by SAPlanner because you set up email reminders for this task.
    </div>
  </div>
</body>
</html>
  `.trim();
}



function startScheduler() {
  console.log('⏰  Reminder scheduler started — checking every minute');

  // This runs once per minute (cron syntax: second minute hour day month weekday)
  cron.schedule('* * * * *', async () => {
    try {
      // Fetch all pending reminders, joining in the task and user data we need
      const { data: pendingReminders, error } = await supabase
        .from('task_reminders')
        .select('*, tasks(title, due_date, due_time, done), users(email, name)')
        .eq('tasks.done', false);

      if (error) throw error;
      if (!pendingReminders || pendingReminders.length === 0) return;

      const now = new Date();

      for (const reminder of pendingReminders) {
        // Skip if the task is done or the data is missing
        if (!reminder.tasks || reminder.tasks.done) continue;
        if (!reminder.users?.email)                  continue;

        // Build the time safely. From DB it might be '20:15:00' or '20:15'.
        let dTime = reminder.tasks.due_time || '00:00';
        if (dTime.split(':').length === 2) dTime += ':00'; // Make it safely HH:MM:SS

        const dueDateTime = new Date(`${reminder.tasks.due_date}T${dTime}`);
        const diffMinutes = Math.ceil((dueDateTime - now) / 1000 / 60);

        // Skip overdue tasks (already past the deadline — too late to remind!)
        if (diffMinutes < 0) {
           // console.log(`[SKIP] "${reminder.tasks.title}" is overdue (${diffMinutes}m late).`);
           continue;
        }

        const remindBefore = Array.isArray(reminder.remind_before) ? reminder.remind_before : [];
        const notified     = Array.isArray(reminder.notified)      ? reminder.notified      : [];

        let didSendAnyEmail = false;

        for (const offsetMinutes of remindBefore) {
          // Check: are we inside this reminder window AND has it not been sent yet?
          if (diffMinutes <= offsetMinutes && !notified.includes(offsetMinutes)) {

            // Build and send the email
            const htmlBody = buildEmailHTML(
              reminder.users.name,
              reminder.tasks.title,
              reminder.tasks.due_date,
              reminder.tasks.due_time,
              offsetMinutes
            );

            await transporter.sendMail({
              from:    `"SAPlanner 🎓" <${process.env.MAIL_USER}>`,
              to:      reminder.users.email,
              subject: `⏰ Reminder: "${reminder.tasks.title}" is due in ${formatOffset(offsetMinutes)}`,
              html:    htmlBody,
              // Plain-text fallback for email clients that don't render HTML
              text: `Hi ${reminder.users.name},\n\nReminder: "${reminder.tasks.title}" is due on ${reminder.tasks.due_date}${reminder.tasks.due_time ? ' at ' + reminder.tasks.due_time : ''}.\n\nThis reminder fires ${formatOffset(offsetMinutes)} before the deadline.\n\nGood luck! — SAPlanner`,
            });

            console.log(`✉️  Sent ${formatOffset(offsetMinutes)} reminder → ${reminder.users.email} for: "${reminder.tasks.title}"`);
            notified.push(offsetMinutes);
            didSendAnyEmail = true;
          }
        }

        // If we sent at least one email, update the notified list in Supabase so we
        // don't send the same reminder again next minute
        if (didSendAnyEmail) {
          await supabase
            .from('task_reminders')
            .update({ notified, updated_at: new Date().toISOString() })
            .eq('id', reminder.id);
        }
      }

    } catch (err) {
      console.error('Scheduler error:', err.message || err);
    }
  });
}


module.exports = { startScheduler };
