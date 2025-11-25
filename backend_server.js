/**
 * The People's Platform - Backend Server Code
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
app.use(cors()); // Allow Frontend to connect
app.use(express.json({ limit: '50mb' })); // Increase limit for large images

// PostgreSQL Connection Pool (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // REQUIRED for Supabase connection
  }
});

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
        is_breaking BOOLEAN DEFAULT FALSE
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
        ad_headline TEXT
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

    console.log("PostgreSQL Tables initialized.");
  } catch (err) {
    console.error("Error creating tables:", err);
  }
};

initDb();

// --- ROOT ROUTE (The Welcome Page) ---
app.get('/', (req, res) => {
  res.send('The Platform API is running successfully! 🚀');
});

// --- API ROUTES ---

// 1. Get All Published Articles (Newest First)
app.get('/api/articles', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM articles WHERE status = 'published' ORDER BY date DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Submit New Article (Citizen Journalism)
app.post('/api/articles', async (req, res) => {
  const { title, category, author, image, excerpt, content } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO articles (title, category, author, image, excerpt, content) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, category, author || 'Citizen Reporter', image, excerpt, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 3. Admin: Get Pending Articles
app.get('/api/admin/pending-articles', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM articles WHERE status = 'pending' ORDER BY date DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. Admin: Approve Article
app.patch('/api/admin/articles/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { isBreaking } = req.body;
  try {
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
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. Submit Advertisement
app.post('/api/ads', async (req, res) => {
  const { clientName, email, plan, amount, receiptImage, adImage, adContent, adUrl, adHeadline } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO ads (client_name, email, plan, amount, receipt_image, ad_image, ad_content, ad_url, ad_headline)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [clientName, email, plan, amount, receiptImage, adImage, adContent, adUrl, adHeadline]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 6. Get Active Ads
app.get('/api/ads/active', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM ads WHERE status = 'active'");
    // Map DB columns (snake_case) to JSON keys (camelCase)
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
      adHeadline: ad.ad_headline
    }));
    res.json(mappedAds);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 7. Admin: Approve Ad
app.patch('/api/admin/ads/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "UPDATE ads SET status = 'active' WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Ad not found' });
    
    // Return mapped version immediately so UI updates cleanly
    const ad = result.rows[0];
    const mappedAd = {
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
      adHeadline: ad.ad_headline
    };
    res.json(mappedAd);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 8. Post Comment
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

// 9. Get Comments for Article
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));