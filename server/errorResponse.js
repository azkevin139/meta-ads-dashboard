function sendError(res, err) {
  const status = err.httpStatus || 500;
  const payload = {
    error: err.message || 'Unexpected error',
  };
  if (err.retryAfterSeconds) payload.retry_after_seconds = err.retryAfterSeconds;
  if (err.limitType) payload.limit_type = err.limitType;
  if (err.code) payload.code = err.code;
  return res.status(status).json(payload);
}

module.exports = { sendError };
