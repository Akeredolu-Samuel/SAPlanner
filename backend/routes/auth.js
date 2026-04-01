const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../database');
require('dotenv').config();

const router = express.Router();

// REGISTER
router.post('/register', async (req, res) => {
  // The frontend sends `username` — we store it as `name` in the database
  const { username, email, password } = req.body;
  const name = (username || '').trim();

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // Check if this username is already taken
    const { data: takenByName } = await supabase
      .from('users')
      .select('id')
      .eq('name', name)
      .single();

    if (takenByName) {
      return res.status(400).json({ error: 'Username already taken. Please choose a different one.' });
    }

    // Check if the email is already registered
    const { data: takenByEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (takenByEmail) {
      return res.status(400).json({ error: 'Email already registered. Try logging in instead.' });
    }

    const id     = uuidv4();
    const hashed = await bcrypt.hash(password, 12);

    const { error: insertErr } = await supabase
      .from('users')
      .insert([{ id, name, email, password: hashed }]);

    if (insertErr) throw insertErr;

    // Create a blank profile row for this user
    await supabase.from('user_profiles').insert([{ user_id: id }]);

    const token = jwt.sign(
      { id, email, name },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    return res.status(201).json({ token, user: { id, name, email } });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  try {
    const { data: user, error: findErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '7d' });
    return res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not login.' });
  }
});

// ME (auto-login)
router.get('/me', require('../middleware/auth'), (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
