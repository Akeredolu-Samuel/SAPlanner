# Smart Academic Planner (SAPlanner)

## Project Overview
SAPlanner is a web-based task management system designed specifically for students. It helps in tracking academic assignments, lectures, meetings, and exams with an integrated email reminder system.

## Features
- **User Authentication**: Secure login and registration system.
- **Task Management**: Create, edit, and delete academic tasks with categories and priority levels.
- **Dashboard**: Quick view of total, today's, overdue, and completed tasks.
- **Responsive Design**: Fully functional on mobile, tablet, and desktop devices.
- **Email Reminders**: Automated background system that sends reminders via Gmail/Nodemailer based on user preferences (e.g., 5 min, 1 hour before).
- **Schedule Views**: Daily timeline and Weekly grid views for better planning.

## Tech Stack
- **Frontend**: HTML5, Vanilla CSS3 (Custom design system), Vanilla JavaScript (ES6+).
- **Backend**: Node.js with Express.js framework.
- **Database**: Supabase (PostgreSQL) for real-time data storage.
- **Background Jobs**: Node-cron for scheduling reminder checks.
- **Email Service**: Nodemailer with Gmail SMTP.

## Setup Instructions
1. Clone the repository.
2. Install dependencies: `pnpm install`
3. Set up your `.env` file in the `backend/` directory with:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `JWT_SECRET`
   - `MAIL_USER` (Gmail)
   - `MAIL_PASS` (App Password)
4. Run the development server: `pnpm run dev`
5. Open `http://localhost:3000` in your browser.

## Project Structure
- `frontend/`: Static assets, styles, and client-side logic.
- `backend/`: API routes, database configuration, and the scheduler job.
- `vercel.json`: Deployment configuration for Vercel.
