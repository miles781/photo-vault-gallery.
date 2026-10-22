const multer = require('multer');

// Centralised four-argument error middleware
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  if (err instanceof multer.MulterError) {
    statusCode = 400;
    if (err.code === 'LIMIT_FILE_SIZE') message = 'File too large. Maximum size exceeded.';
    else if (err.code === 'LIMIT_UNEXPECTED_FILE') message = `Unexpected file field "${err.field}". Upload the image using the "image" field.`;
    else if (err.code === 'LIMIT_FILE_COUNT') message = 'Too many files uploaded.';
    else if (err.code === 'LIMIT_FIELD_VALUE') message = 'One of the form fields is too large.';
    else message = `Upload failed: ${err.message}`;
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Malformed JSON body.';
  } else if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request body too large.';
  }
  if (process.env.NODE_ENV !== 'test') console.error('[Error Middleware]:', message);
  res.status(statusCode).json({ success: false, error: message });
};
module.exports = errorHandler;
