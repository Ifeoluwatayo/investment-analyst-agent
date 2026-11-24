/*
 * Small helper steps
 * ==================
 * Two short steps from workflows/investment-analyst-agent.json.
 *
 * Approved Calls: when the agent is run by hand from the form, a review page lists
 *   the proposed calls with a checkbox per ticker. This keeps only the ticked calls,
 *   so nothing reaches the Analyst Calls table without approval.
 *
 * Tag as PDF: the handbook is downloaded from GitHub on every run. GitHub labels the
 *   file as generic data, and n8n's PDF reader refuses it, so this step labels it as
 *   a PDF first. (Found and fixed during testing.)
 */

// ---- Approved Calls ----
// Keep only the calls ticked on Review the Calls
let picked = $('Review the Calls').first().json['Save these calls'] ?? [];
if (typeof picked === 'string') { try { picked = JSON.parse(picked); } catch (e) { picked = picked.split(','); } }
picked = (Array.isArray(picked) ? picked : [picked]).map(t => String(t).trim().toUpperCase());

return $('Read the Calls').all()
  .filter(i => picked.includes(String(i.json.ticker).toUpperCase()))
  .map(i => ({ json: { ...i.json, savedBy: 'workflow, approved' } }));


// ---- Tag as PDF ----
// GitHub raw links label files as generic data; the PDF loader needs them labelled as PDFs
for (const item of $input.all()) {
  for (const file of Object.values(item.binary ?? {})) file.mimeType = 'application/pdf';
}
return $input.all();
