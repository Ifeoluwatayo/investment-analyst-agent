/*
 * Read the Calls
 * ==============
 * The analyst (Claude) answers in JSON: one call per company. This step turns that
 * answer into one clean row per ticker on the watchlist, ready to review and save.
 *
 * Safeguards:
 *   - Every watchlist ticker gets a row, even if the analyst skipped it ("No call").
 *   - If the analyst writes a company name where the ticker belongs (this happened
 *     once in testing: "TEXAS INSTRUMENTS INC" instead of "TXN"), it matches the
 *     call by company name instead of losing it.
 *   - Numbers are checked, and anything that is not a valid number is left blank.
 *
 * Runs in the "Read the Calls" step of workflows/investment-analyst-agent.json.
 * n8n code: $json and $('Step name') read data from earlier steps.
 */

// Turn the analyst's JSON answer into one Analyst Calls row per company on the watchlist
const { watchlist } = $('Your Settings').first().json;
const tickers = watchlist.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
const out = String($json.output ?? '');
let calls = [];
try { calls = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).calls || []; } catch (e) {}
const num = x => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const CALLS = ['Research', 'Watch', 'Pass', 'No call'];

// Company names for the watchlist tickers, used when a call's ticker doesn't match.
// Add a name here when you add a ticker to the watchlist.
const NAMES = { NVDA: 'nvidia', AVGO: 'broadcom', AMAT: 'applied materials', SNPS: 'synopsys',
  MU: 'micron', TXN: 'texas instruments' };
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const byTicker = ticker => calls.find(x => String(x.ticker ?? '').trim().toUpperCase() === ticker);
const byName = ticker => {
  const name = norm(NAMES[ticker]);
  if (!name) return undefined;
  return calls.find(x => !tickers.includes(String(x.ticker ?? '').trim().toUpperCase())
    && (norm(x.ticker).includes(name) || norm(x.company).includes(name)));
};

return tickers.map(ticker => {
  const c = byTicker(ticker) || byName(ticker) || {};
  return { json: { runDate: $now.toISODate(), ticker, company: c.company || ticker,
    price: num(c.price), growth: num(c.growth), exitMultiple: num(c.exitMultiple),
    annualReturn: num(c.annualReturn), call: CALLS.includes(c.call) ? c.call : 'No call',
    reason: c.reason || 'The analyst returned no call for this company.', savedBy: 'agent' } };
});
