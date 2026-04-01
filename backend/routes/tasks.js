const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../database');
const auth = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();
router.use(auth);

// GET ALL TASKS
router.get('/', async (req, res) => {
  try {
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*, task_reminders(remind_before, notified)')
      .eq('user_id', req.user.id)
      .order('due_date', { ascending: true })
      .order('due_time', { ascending: true });

    if (error) throw error;

    // Supabase returns nested reminders as an array due to 1:1 or 1:N join
    const parsedTasks = tasks.map(t => ({
      ...t,
      remind_before: (t.task_reminders?.[0]?.remind_before) || [],
      notified:      (t.task_reminders?.[0]?.notified)      || []
    }));

    return res.json({ tasks: parsedTasks });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not fetch tasks.' });
  }
});

// ADD TASK
router.post('/', async (req, res) => {
  const { title, category, priority, due_date, due_time, notes, remind_before } = req.body;
  if (!title || !category || !priority) return res.status(400).json({ error: 'Missing required fields.' });

  try {
    const id = uuidv4();
    const { error: insertErr } = await supabase
      .from('tasks')
      .insert([{
        id,
        user_id:  req.user.id,
        title:    title.trim(),
        category,
        priority,
        due_date: due_date || null,
        due_time: due_time || null,
        notes:    notes?.trim() || ''
      }]);

    if (insertErr) throw insertErr;

    if (Array.isArray(remind_before) && remind_before.length > 0) {
      await supabase
        .from('task_reminders')
        .insert([{
          id:            uuidv4(),
          task_id:       id,
          user_id:       req.user.id,
          remind_before
        }]);
    }

    return res.status(201).json({ message: 'Task added successfully.', id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not add task.' });
  }
});

// UPDATE TASK
router.patch('/:id', async (req, res) => {
  const { title, category, priority, due_date, due_time, notes, done, remind_before } = req.body;
  const tid = req.params.id;

  try {
    // Check ownership
    const { data: task, error: fetchErr } = await supabase
      .from('tasks')
      .select('user_id')
      .eq('id', tid)
      .single();

    if (fetchErr) throw fetchErr;
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    if (task.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized.' });

    // Update task
    const updates = { updated_at: new Date().toISOString() };
    if (title !== undefined)    updates.title    = title.trim();
    if (category !== undefined) updates.category = category;
    if (priority !== undefined) updates.priority = priority;
    if (due_date !== undefined) updates.due_date = due_date;
    if (due_time !== undefined) updates.due_time = due_time;
    if (notes !== undefined)    updates.notes    = notes || null;
    if (done !== undefined)     updates.done     = !!done;

    const { error: updateErr } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', tid);

    if (updateErr) throw updateErr;

    // Update reminders
    if (remind_before !== undefined) {
      // Supabase's upsert is better here
      const rb = Array.isArray(remind_before) && remind_before.length > 0 ? remind_before : [];
      await supabase
        .from('task_reminders')
        .upsert({
          task_id: tid,
          user_id: req.user.id,
          remind_before: rb,
          updated_at: new Date().toISOString()
        }, { onConflict: 'task_id' });
    }

    return res.json({ message: 'Task updated.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not update task.' });
  }
});

// DELETE TASK
router.delete('/:id', async (req, res) => {
  try {
    const tid = req.params.id;
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', tid)
      .eq('user_id', req.user.id);

    if (error) throw error;
    return res.json({ message: 'Task deleted.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not delete task.' });
  }
});

module.exports = router;
