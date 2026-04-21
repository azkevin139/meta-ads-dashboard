const crypto = require('crypto');
const config = require('../config');

function sign(sessionTokenHash, nonce) {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`${sessionTokenHash}.${nonce}`)
    .digest('base64url');
}

function createToken(sessionTokenHash) {
  if (!sessionTokenHash) return null;
  const nonce = crypto.randomBytes(24).toString('base64url');
  return `${nonce}.${sign(sessionTokenHash, nonce)}`;
}

function verifyToken(sessionTokenHash, token) {
  if (!sessionTokenHash || !token || typeof token !== 'string') return false;
  const [nonce, signature] = token.split('.');
  if (!nonce || !signature) return false;
  const expected = sign(sessionTokenHash, nonce);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  createToken,
  verifyToken,
};
