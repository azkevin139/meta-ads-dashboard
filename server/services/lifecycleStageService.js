function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function normalizeStage(stage, context = {}) {
  const revenue = Number(context.revenue) || 0;
  if (revenue > 0) return 'closed_won';

  const raw = clean(stage);
  if (!raw) {
    if (context.metaLeadId || context.sourceEventType) return 'new_lead';
    return null;
  }

  const text = raw.toLowerCase();

  if (includesAny(text, ['closed won', 'won', 'sale', 'sold', 'purchase', 'paid'])) return 'closed_won';
  if (includesAny(text, ['closed lost', 'lost', 'dead', 'disqual', 'not interested', 'no sale'])) return 'closed_lost';
  if (includesAny(text, ['no show', 'no-show'])) return 'booked';
  if (includesAny(text, ['showed', 'show up', 'show-up', 'attended'])) return 'showed';
  if (includesAny(text, ['booked', 'appointment', 'appt', 'meeting', 'call booked', 'call scheduled', 'schedule'])) return 'booked';
  if (includesAny(text, ['qualif', 'sql', 'mql'])) return 'qualified';
  if (includesAny(text, ['contacted', 'reached', 'follow up', 'follow-up', 'called', 'sms sent', 'email sent'])) return 'contacted';
  if (includesAny(text, ['lead', 'new', 'created', 'captured'])) return 'new_lead';

  return raw.toLowerCase().replace(/\s+/g, '_').slice(0, 64);
}

module.exports = {
  normalizeStage,
};
