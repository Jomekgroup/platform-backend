import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/peoples_platform';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Could not connect to MongoDB', err));

// --- Schemas & Models ---

const articleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, required: true },
  author: { type: String, default: 'Citizen Reporter' },
  date: { type: Date, default: Date.now },
  image: String,
  excerpt: String,
  content: String,
  views: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'published', 'rejected'], default: 'pending' },
  isBreaking: { type: Boolean, default: false }
});

const adSchema = new mongoose.Schema({
  clientName: { type: String, required: true },
  email: { type: String, required: true },
  plan: { type: String, required: true },
  amount: Number,
  status: { type: String, enum: ['pending', 'active', 'rejected'], default: 'pending' },
  dateSubmitted: { type: Date, default: Date.now },
  receiptImage: String,
  adImage: String,
  adContent: String,
  adUrl: String,
  adHeadline: String
});

const commentSchema = new mongoose.Schema({
  articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Article', required: true },
  author: { type: String, required: true },
  email: { type: String, required: true },
  content: { type: String, required: true },
  date: { type: Date, default: Date.now }
});

const Article = mongoose.model('Article', articleSchema);
const Ad = mongoose.model('Ad', adSchema);
const Comment = mongoose.model('Comment', commentSchema);

// --- Routes ---

// 1. Get All Published Articles
app.get('/api/articles', async (req, res) => {
  try {
    const articles = await Article.find({ status: 'published' }).sort({ date: -1 });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Submit New Article
app.post('/api/articles', async (req, res) => {
  const { title, category, author, image, excerpt, content } = req.body;
  const article = new Article({ title, category, author, image, excerpt, content });
  try {
    const newArticle = await article.save();
    res.status(201).json(newArticle);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 3. Admin: Get Pending Articles
app.get('/api/admin/pending-articles', async (req, res) => {
  try {
    const articles = await Article.find({ status: 'pending' });
    res.json(articles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. Admin: Approve Article
app.patch('/api/admin/articles/:id/approve', async (req, res) => {
  const { isBreaking } = req.body;
  try {
    const article = await Article.findByIdAndUpdate(
      req.params.id,
      { status: 'published', isBreaking: isBreaking || false },
      { new: true }
    );
    if (!article) return res.status(404).json({ message: 'Article not found' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. Submit Advertisement
app.post('/api/ads', async (req, res) => {
  const ad = new Ad(req.body);
  try {
    const newAd = await ad.save();
    res.status(201).json(newAd);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 6. Get Active Ads
app.get('/api/ads/active', async (req, res) => {
  try {
    const ads = await Ad.find({ status: 'active' });
    res.json(ads);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 7. Admin: Approve Ad
app.patch('/api/admin/ads/:id/approve', async (req, res) => {
  try {
    const ad = await Ad.findByIdAndUpdate(req.params.id, { status: 'active' }, { new: true });
    if (!ad) return res.status(404).json({ message: 'Ad not found' });
    res.json(ad);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 8. Post Comment
app.post('/api/comments', async (req, res) => {
  const comment = new Comment(req.body);
  try {
    const newComment = await comment.save();
    res.status(201).json(newComment);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// 9. Get Comments for Article
app.get('/api/articles/:id/comments', async (req, res) => {
  try {
    const comments = await Comment.find({ articleId: req.params.id }).sort({ date: -1 });
    res.json(comments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
