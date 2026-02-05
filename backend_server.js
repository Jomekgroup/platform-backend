/**
 * The Platform - Backend Server Code
 * database: Supabase (PostgreSQL)
 * host: Render
 */

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'https://theplatform-lyart.vercel.app',
      'https://theplatform.vercel.app'
    ];
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
})); // Allow Frontend to connect securely
app.use(express.json({ limit: '50mb' })); // Increase limit for large images/files

// PostgreSQL Connection Pool (Supabase)
const rawDbUrl = process.env.DATABASE_URL || '';
const connectionString = rawDbUrl ? rawDbUrl.trim() : undefined;

if (!connectionString) {
  console.warn('Warning: DATABASE_URL is not set or is empty.');
} else {
  try {
    const parsed = new URL(connectionString);
    console.log(`Connecting to DB host: ${parsed.hostname}`);
  } catch (e) {
    // ignore parse errors; do not log sensitive full connection string
  }
}

const dns = require('dns').promises;

// Create PG pool. Try resolving DB host to IPv4 to avoid IPv6 ENETUNREACH on some hosts.
let pool;
if (connectionString) {
  try {
    const parsed = new URL(connectionString);
    const host = parsed.hostname;
    const port = parsed.port || 5432;
    const user = parsed.username;
    const password = parsed.password;
    const database = parsed.pathname ? parsed.pathname.replace(/^\//, '') : undefined;

    let resolvedHost = host;
    try {
      const lookup = await dns.lookup(host, { family: 4 });
      if (lookup && lookup.address) {
        resolvedHost = lookup.address;
        console.log(`Resolved DB host ${host} -> ${resolvedHost} (IPv4)`);
      }
    } catch (dnsErr) {
      console.warn('IPv4 lookup failed for DB host, will try hostname directly:', dnsErr && dnsErr.message);
    }

    pool = new Pool({
      host: resolvedHost,
      port: parseInt(port, 10),
      user,
      password,
      database,
      ssl: { rejectUnauthorized: false }
    });
  } catch (e) {
    // fallback to connection string if parsing/lookup fails
    console.warn('Falling back to connectionString for PG Pool:', e && e.message);
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
} else {
  pool = new Pool({ ssl: { rejectUnauthorized: false } });
}

// Quick connection test for debugging (temporary)
(async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('Database connection test successful. Server time:', res.rows[0].now);
  } catch (err) {
    console.error('Database connection test failed:', err && err.message);
    console.error(err && err.stack);
  }
})();

// --- Database Initialization ---
const initDb = async () => {
  try {
    // 1. Articles Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        author TEXT DEFAULT 'Citizen Reporter',
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        image TEXT,
        excerpt TEXT,
        content TEXT,
        views INTEGER DEFAULT 0,
        status TEXT CHECK (status IN ('pending', 'published', 'rejected')) DEFAULT 'pending',
        is_breaking BOOLEAN DEFAULT FALSE,
        sub_headline TEXT
      );
    `);

    // 2. Ads Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ads (
        id SERIAL PRIMARY KEY,
        client_name TEXT NOT NULL,
        email TEXT NOT NULL,
        plan TEXT NOT NULL,
        amount NUMERIC,
        status TEXT CHECK (status IN ('pending', 'active', 'rejected')) DEFAULT 'pending',
        date_submitted TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        receipt_image TEXT,
        ad_image TEXT,
        ad_content TEXT,
        ad_url TEXT,
        ad_headline TEXT,
        ad_content_file TEXT
      );
    `);

    // 3. Comments Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
        author TEXT NOT NULL,
        email TEXT NOT NULL,
        content TEXT NOT NULL,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Support Messages Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        subject TEXT,
        message TEXT NOT NULL,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'unread'
      );
    `);

    // Migrations for existing tables
    try {
        await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS sub_headline TEXT");
        await pool.query("ALTER TABLE ads ADD COLUMN IF NOT EXISTS ad_content_file TEXT");
    } catch (e) { /* ignore */ }

    console.log("PostgreSQL Tables initialized.");
  } catch (err) {
    console.error("Error creating tables:", err && err.stack ? err.stack : err);
  }
};

initDb();

// --- Error Handling Middleware ---
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('The Platform API is running successfully! 🚀');
});

// --- API ROUTES ---

// 1. Get All Published Articles
app.get('/api/articles', asyncHandler(async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM articles WHERE status = 'published' OR status IS NULL ORDER BY date DESC"
  );
  res.json(result.rows);
}));

// 2. Submit New Article
app.post('/api/articles', asyncHandler(async (req, res) => {
  const { title, subHeadline, category, author, image, excerpt, content, status } = req.body;
  
  // Input validation
  if (!title || !category || !content) {
    return res.status(400).json({ message: 'Title, category, and content are required' });
  }
  
  const finalStatus = status || 'pending';

  const result = await pool.query(
    `INSERT INTO articles (title, sub_headline, category, author, image, excerpt, content, status) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [title, subHeadline || '', category, author || 'Citizen Reporter', image, excerpt, content, finalStatus]
  );
  res.status(201).json(result.rows[0]);
}));

// 3. Admin: Get Pending Articles
app.get('/api/admin/pending-articles', asyncHandler(async (req, res) => {
  const result = await pool.query("SELECT * FROM articles WHERE status = 'pending' ORDER BY date DESC");
  res.json(result.rows);
}));

// 4. Admin: Approve Article
app.patch('/api/admin/articles/:id/approve', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isBreaking } = req.body;
  
  const result = await pool.query(
    `UPDATE articles 
     SET status = 'published', is_breaking = $1, date = NOW() 
     WHERE id = $2 RETURNING *`,
    [isBreaking || false, id]
  );
  
  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'Article not found' });
  }
  res.json(result.rows[0]);
}));

// 5. Admin: Update Article
app.put('/api/articles/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, subHeadline, category, author, image, content, isBreaking } = req.body;
  
  const result = await pool.query(
    `UPDATE articles 
     SET title = $1, sub_headline = $2, category = $3, author = $4, image = $5, content = $6, is_breaking = $7
     WHERE id = $8 RETURNING *`,
    [title, subHeadline, category, author, image, content, isBreaking, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ message: 'Article not found' });
  res.json(result.rows[0]);
}));

// 6. Admin: Delete Article
app.delete('/api/articles/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM articles WHERE id = $1", [id]);
  res.json({ message: "Article deleted successfully" });
}));

// 7. Submit Advertisement
app.post('/api/ads', asyncHandler(async (req, res) => {
  const { clientName, email, plan, amount, receiptImage, adImage, adContent, adUrl, adHeadline, adContentFile } = req.body;
  
  // Input validation
  if (!clientName || !email || !plan) {
    return res.status(400).json({ message: 'Client name, email, and plan are required' });
  }
  
  const result = await pool.query(
    `INSERT INTO ads (client_name, email, plan, amount, receipt_image, ad_image, ad_content, ad_url, ad_headline, ad_content_file)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [clientName, email, plan, amount, receiptImage, adImage, adContent, adUrl, adHeadline, adContentFile]
  );
  res.status(201).json(result.rows[0]);
}));

// 8. Get Active Ads (Public)
app.get('/api/ads/active', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM ads WHERE status = 'active'");
    // Map snake_case to camelCase
    const mappedAds = result.rows.map(ad => ({
      id: ad.id,
      clientName: ad.client_name,
      email: ad.email,
      plan: ad.plan,
      amount: ad.amount,
      status: ad.status,
      dateSubmitted: ad.date_submitted,
      receiptImage: ad.receipt_image,
      adImage: ad.ad_image,
      adContent: ad.ad_content,
      adUrl: ad.ad_url,
      adHeadline: ad.ad_headline,
      adContentFile: ad.ad_content_file
    }));
    res.json(mappedAds);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 8b. Get ALL Ads (Admin)
app.get('/api/admin/ads', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM ads ORDER BY date_submitted DESC");
    const mappedAds = result.rows.map(ad => ({
      id: ad.id,
      clientName: ad.client_name,
      email: ad.email,
      plan: ad.plan,
      amount: ad.amount,
      status: ad.status, 
      dateSubmitted: ad.date_submitted,
      receiptImage: ad.receipt_image,
      adImage: ad.ad_image,
      adContent: ad.ad_content,
      adUrl: ad.ad_url,
      adHeadline: ad.ad_headline,
      adContentFile: ad.ad_content_file
    }));
    res.json(mappedAds);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 9. Admin: Approve Ad
app.patch('/api/admin/ads/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "UPDATE ads SET status = 'active' WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Ad not found' });
    res.json(result.rows[0]); 
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 9b. Admin: Delete Ad (NEW - Solves the removal issue)
app.delete('/api/ads/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM ads WHERE id = $1", [id]);
    res.json({ message: "Ad deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 10. Post Comment
app.post('/api/comments', async (req, res) => {
  const { articleId, author, email, content } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO comments (article_id, author, email, content) VALUES ($1, $2, $3, $4) RETURNING *",
      [articleId, author, email, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 11. Get Comments
app.get('/api/articles/:id/comments', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM comments WHERE article_id = $1 ORDER BY date DESC",
      [id]
    );
    const mappedComments = result.rows.map(c => ({
      id: c.id,
      articleId: c.article_id,
      author: c.author,
      email: c.email,
      content: c.content,
      date: c.date
    }));
    res.json(mappedComments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 12. Submit Support Message
app.post('/api/support', async (req, res) => {
  const { name, email, subject, message } = req.body;
  try {
    await pool.query(
      "INSERT INTO support_messages (name, email, subject, message) VALUES ($1, $2, $3, $4)",
      [name, email, subject, message]
    );
    res.status(201).json({ message: "Support message sent" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 13. Admin: Get Support Messages
app.get('/api/admin/support', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM support_messages ORDER BY date DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('Error:', err && err.stack ? err.stack : err);
  res.status(err && err.status ? err.status : 500).json({
    message: err && err.message ? err.message : 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// --- 404 Handler ---
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));