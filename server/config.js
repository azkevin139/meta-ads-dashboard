require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    connectionString: process.env.DATABASE_URL || 'postgresql://meta_dash:password@localhost:5432/meta_dashboard',
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
    model: 'gpt-4o',
  },

  authSecret: process.env.AUTH_SECRET || 'dev-secret',
};
