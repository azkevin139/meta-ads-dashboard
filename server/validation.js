function badRequest(message) {
  const err = new Error(message);
  err.httpStatus = 400;
  return err;
}

function ensureObject(value, message = 'JSON body required') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(message);
  return value;
}

function ensureNonEmptyString(value, message) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(message);
  return value.trim();
}

function optionalTrimmedString(value, maxLen = 5000) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest('Expected string');
  return value.trim().slice(0, maxLen);
}

function ensureBoolean(value, message) {
  if (typeof value !== 'boolean') throw badRequest(message);
  return value;
}

function ensureArray(value, message) {
  if (!Array.isArray(value) || value.length === 0) throw badRequest(message);
  return value;
}

function ensureInteger(value, message) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw badRequest(message);
  return parsed;
}

function optionalInteger(value, message) {
  if (value === undefined || value === null || value === '') return undefined;
  return ensureInteger(value, message);
}

function ensureEnum(value, allowed, message) {
  if (!allowed.includes(value)) throw badRequest(message);
  return value;
}

function optionalNumber(value, message) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw badRequest(message);
  return parsed;
}

module.exports = {
  badRequest,
  ensureObject,
  ensureNonEmptyString,
  optionalTrimmedString,
  ensureBoolean,
  ensureArray,
  ensureInteger,
  optionalInteger,
  ensureEnum,
  optionalNumber,
};
