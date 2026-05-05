require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

function envOrDefault(name, fallback, { productionRequired = false } = {}) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction && productionRequired) {
    throw new Error(`${name} must be set in production`);
  }
  return fallback;
}

function secretOrThrow(value, message, fallback = 'dev-secret') {
  if (value) return value;
  if (isProduction) throw new Error(message);
  return fallback;
}

function secretList(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const legacyAuthSecret = process.env.AUTH_SECRET || '';
const sessionSecret = secretOrThrow(
  process.env.SESSION_SIGNING_SECRET || legacyAuthSecret,
  'SESSION_SIGNING_SECRET or AUTH_SECRET must be set in production'
);
const accountTokenSecret = secretOrThrow(
  process.env.ACCOUNT_TOKEN_ENCRYPTION_SECRET || legacyAuthSecret,
  'ACCOUNT_TOKEN_ENCRYPTION_SECRET or AUTH_SECRET must be set in production'
);
const legacySessionSecrets = Array.from(new Set([
  ...(legacyAuthSecret && legacyAuthSecret !== sessionSecret ? [legacyAuthSecret] : []),
  ...secretList('LEGACY_SESSION_SIGNING_SECRETS'),
])).filter((value) => value !== sessionSecret);
const legacyAccountTokenSecrets = Array.from(new Set([
  ...(legacyAuthSecret && legacyAuthSecret !== accountTokenSecret ? [legacyAuthSecret] : []),
  ...secretList('LEGACY_ACCOUNT_TOKEN_ENCRYPTION_SECRETS'),
])).filter((value) => value !== accountTokenSecret);

module.exports = {
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv,

  db: {
    connectionString: envOrDefault('DATABASE_URL', 'postgresql://meta_dash:password@localhost:5432/meta_dashboard', {
      productionRequired: true,
    }),
  },

  meta: {
    accessToken: process.env.META_ACCESS_TOKEN,
    adAccountId: process.env.META_AD_ACCOUNT_ID,
    apiVersion: process.env.META_API_VERSION || 'v21.0',
    baseUrl: function () {
      return `https://graph.facebook.com/${this.apiVersion}`;
    },
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    projectId: process.env.OPENAI_PROJECT_ID || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },

  touchSequences: {
    monitorIntervalMs: parseInt(process.env.TOUCH_SEQUENCE_MONITOR_INTERVAL_MS || '', 10) || 30 * 60 * 1000,
    webhookSigningSecret: process.env.TOUCH_SEQUENCE_WEBHOOK_SIGNING_SECRET || '',
  },

  revisitAutomation: {
    enabled: process.env.REVISIT_AUTOMATION_ENABLED === 'true',
    webhookUrl: process.env.REVISIT_AUTOMATION_WEBHOOK_URL || '',
    webhookSigningSecret: process.env.REVISIT_AUTOMATION_WEBHOOK_SIGNING_SECRET || '',
    cooldownHours: parseInt(process.env.REVISIT_AUTOMATION_COOLDOWN_HOURS || '', 10) || 24,
    delaySeconds: parseInt(process.env.REVISIT_AUTOMATION_DELAY_SECONDS || '', 10) || 60,
    intervalMs: parseInt(process.env.REVISIT_AUTOMATION_INTERVAL_MS || '', 10) || 30 * 1000,
    maxAttempts: parseInt(process.env.REVISIT_AUTOMATION_MAX_ATTEMPTS || '', 10) || 3,
    targetAdsetId: process.env.REVISIT_AUTOMATION_TARGET_ADSET_ID || '',
    keyPaths: String(process.env.REVISIT_AUTOMATION_KEY_PATHS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },

  authSecret: sessionSecret,
  sessionSecret,
  accountTokenSecret,
  legacySessionSecrets,
  legacyAccountTokenSecrets,
  allowSelfSignup: process.env.ALLOW_SELF_SIGNUP === 'true',
  cspReportOnly: boolEnv('CSP_REPORT_ONLY', true),
  isProduction,
};
