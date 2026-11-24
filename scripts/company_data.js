/*
 * Company Data
 * ============
 * Gets the seven numbers the model needs for one company, from free public sources:
 *   - SEC EDGAR (the company's latest annual 10-K filing): revenue, operating income,
 *     cash, long-term debt and shares outstanding
 *   - Yahoo Finance: today's share price
 *
 * It runs in two n8n Code steps inside the "Tool - Return Model" workflow
 * (workflows/tool-return-model.json):
 *   Part 1, "Plan Data Requests": builds one web request per figure, using the
 *           company's SEC ID number (CIK) looked up from its ticker.
 *   Part 2, "Company Data": reads the answers, keeps only full-year 10-K figures,
 *           and flags anything missing, for example "cash missing" or
 *           "operating loss in latest 10-K, model return not meaningful".
 *
 * The flags travel with the company all the way to the brief, so a gap in the data
 * shows up in the "Why" column instead of silently skewing the result.
 *
 * This is n8n code: $input and $('Step name') read data from earlier steps in the
 * workflow, so it runs inside n8n rather than on its own.
 */

// ---- Part 1: Plan Data Requests ----
// One SEC request per field, plus one Yahoo price request, for the one ticker the agent asked about
const s = $('When Called by Agent').first().json;
const ciks = Object.fromEntries(Object.values($input.first().json)
  .map(c => [c.ticker, String(c.cik_str).padStart(10, '0')]));
const FIELDS = ['us-gaap/Revenues', 'us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax',
  'us-gaap/OperatingIncomeLoss',
  'us-gaap/IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  'us-gaap/CashAndCashEquivalentsAtCarryingValue', 'us-gaap/LongTermDebt', 'us-gaap/LongTermDebtNoncurrent',
  'dei/EntityCommonStockSharesOutstanding'];
const UA = 'CBS AI Club Workshop you@example.com';

const ticker = String(s.ticker || '').trim().toUpperCase();
return [
  ...FIELDS.map(field => ({ json: { ticker, field, ua: UA,
    url: `https://data.sec.gov/api/xbrl/companyconcept/CIK${ciks[ticker] || '0000000000'}/${field}.json` } })),
  { json: { ticker, field: 'price', ua: 'Mozilla/5.0', url: `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}` } }
];


// ---- Part 2: Company Data ----
// Rebuild the model's 7 company inputs from the SEC and Yahoo responses, flagging gaps
const s = $('When Called by Agent').first().json;
const requests = $('Plan Data Requests').all(), responses = $input.all();

const byTicker = {};
requests.forEach((q, i) => {
  const { ticker, field } = q.json, r = responses[i].json;
  const c = byTicker[ticker] ??= { ticker, name: ticker, price: null, tags: {} };
  if (field === 'price') c.price = r?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
  else if (r?.units) { c.name = r.entityName; c.tags[r.tag] = r.units; }
});

// Most recent full-year 10-K value across one or more tags (first tag wins a tie)
const latest = (c, tags, unit = 'USD') => tags
  .flatMap(t => (c.tags[t]?.[unit] || []).filter(v => v.form === '10-K' &&
    (!v.start || new Date(v.end) - new Date(v.start) > 300 * 864e5)))
  .sort((a, b) => b.end.localeCompare(a.end))[0];
const m = v => (v ? v.val / 1e6 : null);

const companies = Object.values(byTicker).map(c => {
  const flags = [];
  const rev = latest(c, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']);
  let oi = latest(c, ['OperatingIncomeLoss']);
  if (!oi) {
    oi = latest(c, ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest']);
    if (oi) flags.push('used pre-tax income (no operating income line)');
  }
  const cash = latest(c, ['CashAndCashEquivalentsAtCarryingValue']);
  const debt = latest(c, ['LongTermDebt', 'LongTermDebtNoncurrent']);
  // Shares: add up every share class reported on the latest cover page
  const sh = latest(c, ['EntityCommonStockSharesOutstanding'], 'shares');
  const sharesM = sh ? c.tags.EntityCommonStockSharesOutstanding.shares
    .filter(v => v.accn === sh.accn && v.end === sh.end).reduce((a, v) => a + v.val, 0) / 1e6 : null;

  [['revenue', rev], ['operating income', oi], ['cash', cash], ['shares', sharesM], ['price', c.price]]
    .forEach(([n, v]) => { if (!v) flags.push(n + ' missing'); });
  if (!debt) flags.push('no long-term debt reported, used 0');
  if (oi && oi.val <= 0) flags.push('operating loss in latest 10-K, model return not meaningful');

  return { ticker: c.ticker, name: c.name, fiscalYearEnd: rev?.end || null, price: c.price, sharesM,
    revenueM: m(rev), opIncomeM: m(oi), cashM: m(cash), debtM: debt ? m(debt) : 0, flags };
});

// Add the agent's assumptions and hurdle to the company
return companies.map(co => ({ json: { ...co, company: co.name, hurdle: s.hurdle,
  growth: s.growth, exitMultiple: s.exitMultiple } }));
