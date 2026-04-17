// ============================================
// HARDCODE API KEY (sementara)
require('dotenv').config();

const ADMINS = [
  { username: process.env.ADMIN_1_USER, password: process.env.ADMIN_1_PASS },
  { username: process.env.ADMIN_2_USER, password: process.env.ADMIN_2_PASS },
  { username: process.env.ADMIN_3_USER, password: process.env.ADMIN_3_PASS },
].filter(a => a.username && a.password); // skip kalau env-nya kosong

// ============================================
// IMPORTS
// ============================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// SESSION STORAGE (in-memory)
// ============================================
const sessions = {};

// ============================================
// DATA FOLDER & FILE SETUP
// ============================================
const DATA_DIR = path.join(__dirname, 'data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CHATS_FILE)) fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
if (!fs.existsSync(CONTENT_FILE)) fs.writeFileSync(CONTENT_FILE, JSON.stringify({
  heroTitle: 'IT Solutions Built for Corporate Innovation',
  heroSubtitle: 'Empowering your vision with top-tier talent and streamlined consulting.',
  lastUpdated: new Date().toISOString()
}));

// ============================================
// SAVE CHAT HISTORY FUNCTION
// ============================================
function saveChat(userMessage, botResponse) {
  try {
    const chats = JSON.parse(fs.readFileSync(CHATS_FILE));
    chats.push({
      id: Date.now(),
      userMessage: userMessage || '',
      botResponse: botResponse || '',
      timestamp: new Date().toISOString()
    });
    if (chats.length > 1000) chats.shift();
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
  } catch (err) {
    console.error('Error saving chat:', err);
  }
}

// ============================================
// ADMIN AUTHENTICATION MIDDLEWARE (COOKIE-BASED)
// ============================================
function adminAuth(req, res, next) {
  const cookie = req.headers.cookie;
  const sessionId = cookie?.match(/adminSession=([^;]+)/)?.[1];
  
  if (sessionId && sessions[sessionId]) {
    req.sessionUser = sessions[sessionId].username;
    return next();
  }
  
  // Untuk API, return JSON error
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Untuk halaman, redirect ke login
  return res.redirect('/admin/login');
}

// ============================================
// SYSTEM PROMPT
// ============================================
const SYSTEM_PROMPT = `Kamu adalah Sagara, asisten AI yang sangat cerdas, ramah, dan serba bisa. Kamu menjawab pertanyaan tentang SEMUA topik tanpa terkecuali — teknologi, sains, sejarah, filsafat, hukum, kedokteran, bisnis, coding, bahasa, budaya, olahraga, seni, matematika, psikologi, ekonomi, politik, lingkungan, dan apapun lainnya.

Gaya komunikasimu:
- Santai, natural, dan hangat — seperti teman pintar yang enak diajak ngobrol
- Jawaban langsung ke poin, tidak bertele-tele
- Bahasa Indonesia yang enak dibaca, boleh campur Inggris kalau natural
- Gunakan contoh konkret dan analogi untuk hal yang kompleks
- Untuk jawaban panjang, beri struktur yang jelas (nomor, poin, pemisah)

Yang TIDAK boleh kamu lakukan (hanya ini):
1. Menjawab permintaan konten seksual, erotis, atau pornografi
2. Membuat konten yang melibatkan eksploitasi anak
3. Membuat konten hate speech yang menyerang kelompok tertentu

Semua topik lain TETAP boleh dijawab secara informatif dan berimbang.`;

// ============================================
// POST /api/chat
// ============================================
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'Field "messages" harus berupa array.' });
  if (!process.env.GROQ_API_KEY)
    return res.status(500).json({ error: 'GROQ_API_KEY belum dikonfigurasi di .env' });

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'Groq API error.' });

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return res.status(500).json({ error: 'Respons API tidak valid.' });
    
    const userMessage = messages[messages.length - 1]?.content || '';
    saveChat(userMessage, reply);
    
    return res.json({ reply, usage: data.usage });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ============================================
// POST /api/chat/stream
// ============================================
app.post('/api/chat/stream', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'Field "messages" harus berupa array.' });
  if (!process.env.GROQ_API_KEY)
    return res.status(500).json({ error: 'GROQ_API_KEY belum dikonfigurasi.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullResponse = '';

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        stream: true,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      res.write(`data: ${JSON.stringify({ error: err?.error?.message || 'API error' })}\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') { 
          res.write('data: [DONE]\n\n'); 
          continue; 
        }
        try {
          const event = JSON.parse(raw);
          const text = event?.choices?.[0]?.delta?.content;
          if (text) {
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        } catch (_) {}
      }
    }
    
    const userMessage = messages[messages.length - 1]?.content || '';
    saveChat(userMessage, fullResponse);
    res.end();

  } catch (err) {
    console.error(err);
    res.write(`data: ${JSON.stringify({ error: 'Streaming gagal.' })}\n\n`);
    res.end();
  }
});

// ============================================
// ADMIN API ROUTES (dilindungi adminAuth)
// ============================================

app.get('/api/admin/stats', adminAuth, (req, res) => {
  try {
    const chats = JSON.parse(fs.readFileSync(CHATS_FILE));
    const today = new Date().toISOString().split('T')[0];
    const todayChats = chats.filter(c => c.timestamp.startsWith(today));
    
    res.json({
      totalChats: chats.length,
      todayChats: todayChats.length,
      lastChat: chats[chats.length - 1] || null,
      systemUptime: process.uptime(),
      hasApiKey: !!process.env.GROQ_API_KEY
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

app.get('/api/admin/chats', adminAuth, (req, res) => {
  try {
    const chats = JSON.parse(fs.readFileSync(CHATS_FILE));
    const limit = parseInt(req.query.limit) || 50;
    res.json(chats.slice(-limit).reverse());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

app.delete('/api/admin/chats', adminAuth, (req, res) => {
  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
    res.json({ success: true, message: 'All chats cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear chats' });
  }
});

app.get('/api/admin/content', adminAuth, (req, res) => {
  try {
    const content = JSON.parse(fs.readFileSync(CONTENT_FILE));
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load content' });
  }
});

app.post('/api/admin/content', adminAuth, (req, res) => {
  try {
    const newContent = { 
      ...req.body, 
      lastUpdated: new Date().toISOString() 
    };
    fs.writeFileSync(CONTENT_FILE, JSON.stringify(newContent, null, 2));
    res.json({ success: true, content: newContent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save content' });
  }
});

// ============================================
// ADMIN FRONTEND ROUTES
// ============================================

// Serve static files admin
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Halaman login (GET)
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

// Proses login (POST) - dengan pilihan redirect
app.post('/admin/login', (req, res) => {
  const { username, password, redirectTo } = req.body;
  
  const isValid = ADMINS.some(admin => admin.username === username && admin.password === password);
  
  if (isValid) {
    const sessionId = Date.now() + '-' + Math.random().toString(36).substring(2);
    sessions[sessionId] = { username, loginAt: new Date() };
    
    res.setHeader('Set-Cookie', `adminSession=${sessionId}; HttpOnly; Path=/; Max-Age=86400`);
    
    // Redirect sesuai pilihan user
    const target = redirectTo === 'homepage' ? '/' : '/admin/dashboard';
    res.redirect(target);
  } else {
    res.send(`
      <script>
        alert('Username atau password salah!');
        window.location='/admin/login';
      </script>
    `);
  }
});

// Halaman dashboard (dilindungi)
app.get('/admin/dashboard', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// Redirect /admin ke dashboard jika sudah login
app.get('/admin', (req, res) => {
  const cookie = req.headers.cookie;
  const sessionId = cookie?.match(/adminSession=([^;]+)/)?.[1];
  
  if (sessionId && sessions[sessionId]) {
    res.redirect('/admin/dashboard');
  } else {
    res.redirect('/admin/login');
  }
});

// Logout (GET)
app.get('/admin/logout', (req, res) => {
  const cookie = req.headers.cookie;
  const sessionId = cookie?.match(/adminSession=([^;]+)/)?.[1];
  
  if (sessionId) {
    delete sessions[sessionId];
  }
  
  res.setHeader('Set-Cookie', 'adminSession=; Max-Age=0; Path=/; HttpOnly');
  res.redirect('/admin/login');
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    provider: 'Groq', 
    hasApiKey: !!process.env.GROQ_API_KEY,
    chatsCount: JSON.parse(fs.readFileSync(CHATS_FILE)).length,
    activeSessions: Object.keys(sessions).length
  });
});

// ============================================
// SERVE FRONTEND (catch all)
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🚀 SERVER BERHASIL DIJALANKAN!`);
  console.log(`${'='.repeat(50)}`);
  console.log(`📍 Website Utama    : http://localhost:${PORT}`);
  console.log(`🤖 Muffin Chatbot   : http://localhost:${PORT}`);
  console.log(`👑 Admin Login      : http://localhost:${PORT}/admin/login`);
  console.log(`📋 Admin Dashboard  : http://localhost:${PORT}/admin/dashboard`);
  console.log(`${'='.repeat(50)}`);
  console.log(`🔑 AKUN LOGIN ADMIN:`);
  ADMINS.forEach(admin => {
    console.log(`   → ${admin.username} / ${admin.password}`);
  });
  console.log(`${'='.repeat(50)}`);
  console.log(`📊 Groq API Key     : ${process.env.GROQ_API_KEY ? '✅ OK' : '❌ Missing'}`);
  console.log(`💾 Data folder      : ${DATA_DIR}`);
  console.log(`${'='.repeat(50)}\n`);
});