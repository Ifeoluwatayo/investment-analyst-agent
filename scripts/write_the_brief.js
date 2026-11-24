/*
 * Write the Brief
 * ===============
 * Builds the daily email: title and date, the thesis and hurdle, a count of
 * Research / Watch / Pass calls, and a table of every company ranked by annual
 * return, with the analyst's reason for each.
 *
 * The email is sent by the next step, "Email the Brief", with Approve and Decline
 * buttons. Approve saves all of that run's calls to the Analyst Calls table;
 * Decline, or no reply within 24 hours, saves nothing.
 *
 * Runs in the "Write the Email Brief" step of workflows/investment-analyst-agent.json.
 * n8n code: $input and $('Step name') read data from earlier steps.
 */

// Turn the scheduled run's proposed calls into one brief for the approval email
const rows = $input.all().map(i => i.json)
  .sort((a, b) => (b.annualReturn ?? -9) - (a.annualReturn ?? -9));
const { hurdleRate, thesis } = $('Your Settings').first().json;

const pct = x => (x === null || x === undefined ? '—' : (x * 100).toFixed(1) + '%');
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const color = { Research: '#1a7f37', Watch: '#9a6700', Pass: '#cf222e' };
const count = c => rows.filter(r => r.call === c).length;

const td = 'style="padding:8px;border-bottom:1px solid #e5e5e5;vertical-align:top;text-align:left"';
const th = h => `<th style="text-align:left;padding:8px;border-bottom:2px solid #222">${h}</th>`;
const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:1000px;text-align:left">
<h2 style="margin-bottom:4px">Investment Analyst Brief · ${$now.toFormat('MMMM d, yyyy')}</h2>
<p style="color:#555;margin-top:0">Thesis: ${esc(thesis)}<br>Hurdle ${pct(hurdleRate)} a year over 5 years · ${count('Research')} Research · ${count('Watch')} Watch · ${count('Pass')} Pass</p>
<table style="border-collapse:collapse;font-size:13px;width:100%"><tr>
${['Company', 'Price', 'Growth / yr', 'Exit multiple', 'Annual return', 'Call', 'Why'].map(th).join('')}</tr>
${rows.map(r => `<tr><td ${td}><b>${esc(r.ticker)}</b><br><small>${esc(r.company)}</small></td>
<td ${td}>${r.price ? '$' + Number(r.price).toFixed(2) : '—'}</td><td ${td}>${pct(r.growth)}</td>
<td ${td}>${r.exitMultiple ? r.exitMultiple + 'x' : '—'}</td><td ${td}><b>${pct(r.annualReturn)}</b></td>
<td ${td}><b style="color:${color[r.call] || '#555'}">${esc(r.call)}</b></td><td ${td}>${esc(r.reason)}</td></tr>`).join('')}
</table><p style="color:#555">Approve to save all ${rows.length} calls to the Analyst Calls table. Decline, or no reply within 24 hours, saves nothing.</p></div>`;

// The email turns line breaks into <br>, so keep the HTML on one line
return [{ json: { html: html.replace(/\n/g, '') } }];
