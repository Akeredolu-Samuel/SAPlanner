const express = require('express');
const bcrypt  = require('bcryptjs');
const { supabase } = require('../database');
const auth = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();
router.use(auth);

// GET FULL PROFILE
router.get('/', async (req, res) => {
  try {
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, name, email, created_at')
      .eq('id', req.user.id)
      .single();

    if (userErr) throw userErr;
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { data: profile, error: profileErr } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    // Check stats
    const { data: tasks, error: statsErr } = await supabase
      .from('tasks')
      .select('done, due_date')
      .eq('user_id', req.user.id);

    const total     = tasks?.length || 0;
    const completed = tasks?.filter(t => t.done).length || 0;
    const overdue   = tasks?.filter(t => !t.done && t.due_date && t.due_date < new Date().toISOString().split('T')[0]).length || 0;

    return res.json({
      user: {
        ...user,
        institution:    profile?.institution    || '',
        department:     profile?.department     || '',
        year_of_study:  profile?.year_of_study  || '',
        phone:          profile?.phone          || '',
        bio:            profile?.bio            || '',
        email_reminders_enabled: profile?.email_reminders_enabled !== false,
        default_remind_before:   profile?.default_remind_before || [1440],
      },
      stats: {
        total,
        completed,
        overdue,
        completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// UPDATE PROFILE
router.patch('/', async (req, res) => {
  const { name, institution, department, year_of_study, phone, bio } = req.body;

  try {
    if (name && name.trim()) {
      await supabase
        .from('users')
        .update({ name: name.trim() })
        .eq('id', req.user.id);
    }

    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id:       req.user.id,
        institution:   institution?.trim() || null,
        department:    department?.trim()  || null,
        year_of_study: year_of_study       || null,
        phone:         phone?.trim()       || null,
        bio:           bio?.trim()         || null,
        updated_at:    new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) throw error;
    return res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not update profile.' });
  }
});

// CHANGE PASSWORD
router.patch('/password', async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password are required.' });
  if (new_password.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });

  try {
    const { data: user, error: findErr } = await supabase
      .from('users')
      .select('password')
      .eq('id', req.user.id)
      .single();

    const match = await bcrypt.compare(current_password, user.password);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hashed = await bcrypt.hash(new_password, 12);
    await supabase.from('users').update({ password: hashed }).eq('id', req.user.id);

    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not change password.' });
  }
});

// UPDATE NOTIFICATION SETTINGS
router.patch('/notifications', async (req, res) => {
  const { email_reminders_enabled, default_remind_before } = req.body;

  try {
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        user_id:                 req.user.id,
        email_reminders_enabled: !!email_reminders_enabled,
        default_remind_before:   Array.isArray(default_remind_before) ? default_remind_before : [1440],
        updated_at:              new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) throw error;
    return res.json({ message: 'Notification settings updated.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not update notification settings.' });
  }
});

// DELETE ACCOUNT
router.delete('/', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required to delete account.' });

  try {
    const { data: user, error: findErr } = await supabase
      .from('users')
      .select('password')
      .eq('id', req.user.id)
      .single();

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });

    // Supabase will handle cascade via foreign keys in DB
    const { error } = await supabase.from('users').delete().eq('id', req.user.id);
    if (error) throw error;

    return res.json({ message: 'Account permanently deleted.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not delete account.' });
  }
});

module.exports = router;
