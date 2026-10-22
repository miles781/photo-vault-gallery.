const express = require('express');
const cors = require('cors');
const path = require('path');
const requestLogger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const photoRoutes = require('./routes/photoRoutes');

const app = express();
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/photos', photoRoutes);
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'PhotoVault API', timestamp: new Date() }));
app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

app.use(errorHandler);
module.exports = app;
