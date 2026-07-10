/**
 * Verbalino — Test Suite
 * Testa tutti gli endpoint e la logica NLP.
 */
'use strict';

const http = require('http');
const path = require('path');

const PORT = process.env.TEST_PORT || 4599;
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

// ── Helper: HTTP request ────────────────────────────────────────────────
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), raw: data });
        } catch (_) {
          resolve({ status: res.statusCode, body: null, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Assertions ──────────────────────────────────────────────────────────
function assert(condition, msg) {
  if (condition) {
    console.log('  ✓ ' + msg);
    passed++;
  } else {
    console.log('  ✗ ' + msg);
    failed++;
  }
}

async function test(name, fn) {
  console.log('\n' + name);
  try {
    await fn();
  } catch (err) {
    console.log('  ✗ ERROR: ' + err.message);
    failed++;
  }
}

// ── Sample meeting minutes ──────────────────────────────────────────────
const SAMPLE_STRUCTURED = `
Riunione settimanale di marketing — 10 luglio 2026

Partecipanti: Mario Rossi, Laura Bianchi, Giuseppe Verdi, Anna Neri

Decisioni:
- Aumentare il budget marketing del 15% per il Q3
- Lanciare la nuova campagna social entro settembre
- Assumere un nuovo graphic designer

Azioni:
- Mario Rossi: preparare il report finanziario entro il 20/07/2026
- Laura Bianchi: contattare i fornitori per la nuova campagna entro il 15/07/2026
- Giuseppe Verdi: aggiornare il sito web con le nuove pagine prodotto entro il 25/07/2026

Punti aperti:
- Sede del nuovo ufficio ancora da definire
- Budget per il 2027 da valutare con la direzione
- Possibile partnership con l'agenzia XYZ da approfondire
`;

const SAMPLE_UNSTRUCTURED = `
Oggi ci siamo riuniti per discutere del lancio del nuovo prodotto.
Si decide di posticipare il lancio a settembre per avere più tempo per i test.
Mario Rossi farà una revisione completa della documentazione tecnica.
Laura Bianchi deve contattare i partner entro la prossima settimana.
Rimane da valutare il budget per la campagna pubblicitaria.
Il team ha approvato il nuovo design delle pagine prodotto.
Viene deciso che il prezzo di lancio sarà di 49,99 euro.
`;

const SAMPLE_MIXED = `
Meeting del 10/07/2026

Decisione: approvare il piano strategico 2026-2027
Azione: Marco Rossi si occuperà di preparare le slide per il board meeting
Deadline: 20/07/2026
Compito: Laura Bianchi deve aggiornare il CRM
Scadenza: 25 luglio 2026
Da valutare: budget per nuove assunzioni
In sospeso: scelta del nuovo fornitore
`;

// ── Tests ───────────────────────────────────────────────────────────────

async function runTests() {
  // ── 1. Health check ──────────────────────────────────────────────────
  await test('1. Server health check', async () => {
    const res = await request('GET', '/');
    assert(res.status === 200, 'GET / returns 200');
    assert(res.raw.includes('<!DOCTYPE html>'), 'Response is HTML');
  });

  // ── 2. API: Generate with valid structured text ───────────────────────
  await test('2. POST /api/generate — structured text', async () => {
    const res = await request('POST', '/api/generate', { text: SAMPLE_STRUCTURED });
    assert(res.status === 200, 'Returns 200');
    assert(res.body.success === true, 'success is true');
    assert(res.body.summary.decisions.length >= 2, 'Found at least 2 decisions');
    assert(res.body.summary.actions.length >= 2, 'Found at least 2 actions');
    assert(res.body.summary.openPoints.length >= 2, 'Found at least 2 open points');

    // Check action structure
    const firstAction = res.body.summary.actions[0];
    assert(typeof firstAction.text === 'string', 'Action has text');
    assert(typeof firstAction.responsible === 'string' || firstAction.responsible === null, 'Action has responsible (or null)');
    assert(typeof firstAction.deadline === 'string' || firstAction.deadline === null, 'Action has deadline (or null)');

    // Check metadata
    assert(typeof res.body.summary.metadata === 'object', 'Has metadata');
    assert(res.body.summary.metadata.wordCount > 10, 'Word count is reasonable');
    assert(typeof res.body.summary.metadata.processingTime === 'number', 'Has processing time');
  });

  // ── 3. API: Generate with unstructured text ───────────────────────────
  await test('3. POST /api/generate — unstructured text', async () => {
    const res = await request('POST', '/api/generate', { text: SAMPLE_UNSTRUCTURED });
    assert(res.status === 200, 'Returns 200');
    assert(res.body.success === true, 'success is true');
    // Should find at least some items
    const total = res.body.summary.decisions.length +
                  res.body.summary.actions.length +
                  res.body.summary.openPoints.length;
    assert(total > 0, 'Found at least some items in unstructured text');
  });

  // ── 4. API: Generate with mixed format text ───────────────────────────
  await test('4. POST /api/generate — mixed format', async () => {
    const res = await request('POST', '/api/generate', { text: SAMPLE_MIXED });
    assert(res.status === 200, 'Returns 200');
    assert(res.body.success === true, 'success is true');
  });

  // ── 5. API: Generate with empty text ──────────────────────────────────
  await test('5. POST /api/generate — empty text', async () => {
    const res = await request('POST', '/api/generate', { text: '' });
    assert(res.status === 400, 'Returns 400 for empty text');
    assert(res.body.success === false, 'success is false');
    assert(res.body.error, 'Has error message');
  });

  // ── 6. API: Generate with very short text ─────────────────────────────
  await test('6. POST /api/generate — short text', async () => {
    const res = await request('POST', '/api/generate', { text: 'Ciao' });
    assert(res.status === 400, 'Returns 400 for short text');
    assert(res.body.success === false, 'success is false');
  });

  // ── 7. API: Save summary ──────────────────────────────────────────────
  let savedId = null;
  await test('7. POST /api/save — save a summary', async () => {
    // First generate a summary
    const genRes = await request('POST', '/api/generate', { text: SAMPLE_STRUCTURED });

    const res = await request('POST', '/api/save', {
      text: SAMPLE_STRUCTURED,
      summary: genRes.body.summary
    });
    assert(res.status === 200, 'Returns 200');
    assert(res.body.success === true, 'success is true');
    assert(typeof res.body.id === 'string', 'Has id');
    assert(res.body.id.length === 10, 'ID is 10 characters'); // 5 bytes hex = 10 chars
    assert(typeof res.body.url === 'string', 'Has url');
    assert(res.body.url.startsWith('s/'), 'URL starts with s/');
    savedId = res.body.id;
  });

  // ── 8. API: Get saved summary ─────────────────────────────────────────
  await test('8. GET /api/summary/:id — get saved summary', async () => {
    // Generate and save
    const genRes = await request('POST', '/api/generate', { text: SAMPLE_STRUCTURED });
    const saveRes = await request('POST', '/api/save', {
      text: SAMPLE_STRUCTURED,
      summary: genRes.body.summary
    });
    const id = saveRes.body.id;

    const res = await request('GET', '/api/summary/' + id);
    assert(res.status === 200, 'Returns 200');
    assert(res.body.success === true, 'success is true');
    assert(res.body.entry.id === id, 'Entry has correct id');
    assert(res.body.entry.summary.decisions.length >= 2, 'Summary has decisions');
  });

  // ── 9. API: Get non-existent summary ──────────────────────────────────
  await test('9. GET /api/summary/:id — non-existent', async () => {
    const res = await request('GET', '/api/summary/nonexistent99');
    assert(res.status === 404, 'Returns 404');
    assert(res.body.success === false, 'success is false');
  });

  // ── 10. API: Board ────────────────────────────────────────────────────
  await test('10. GET /api/board — list summaries', async () => {
    const res = await request('GET', '/api/board');
    assert(res.status === 200, 'Returns 200');
    assert(res.body.success === true, 'success is true');
    assert(Array.isArray(res.body.entries), 'entries is an array');
    // Should have at least the ones we saved
    assert(res.body.entries.length >= 1, 'Has at least 1 entry');
  });

  // ── 11. Share page ────────────────────────────────────────────────────
  await test('11. GET /s/:id — share page', async () => {
    const genRes = await request('POST', '/api/generate', { text: SAMPLE_STRUCTURED });
    const saveRes = await request('POST', '/api/save', {
      text: SAMPLE_STRUCTURED,
      summary: genRes.body.summary
    });
    const id = saveRes.body.id;

    const res = await request('GET', '/s/' + id);
    assert(res.status === 200, 'Returns 200');
    assert(res.raw.includes('<!DOCTYPE html>'), 'Response is HTML');
    assert(res.raw.includes('Verbalino'), 'Contains Verbalino branding');
    assert(res.raw.includes('ld+json'), 'Contains JSON-LD');
    assert(res.raw.includes('og:title'), 'Contains OG tags');
  });

  // ── 12. Share page — non-existent ─────────────────────────────────────
  await test('12. GET /s/:id — non-existent', async () => {
    const res = await request('GET', '/s/nonexistent123');
    assert(res.status === 404, 'Returns 404');
    assert(res.raw.includes('non trovato'), 'Shows not found message');
  });

  // ── 13. Sitemap ───────────────────────────────────────────────────────
  await test('13. GET /sitemap.xml', async () => {
    const res = await request('GET', '/sitemap.xml');
    assert(res.status === 200, 'Returns 200');
    assert(res.raw.includes('urlset'), 'Contains urlset');
    assert(res.raw.includes('cristianporco.it'), 'Contains canonical URL');
  });

  // ── 14. Robots.txt ────────────────────────────────────────────────────
  await test('14. GET /robots.txt', async () => {
    const res = await request('GET', '/robots.txt');
    assert(res.status === 200, 'Returns 200');
    assert(res.raw.includes('Sitemap:'), 'Contains Sitemap reference');
    assert(res.raw.includes('cristianporco.it'), 'Contains canonical URL');
  });

  // ── 15. Static files ──────────────────────────────────────────────────
  await test('15. Static file serving', async () => {
    const res = await request('GET', '/style.css');
    assert(res.status === 200, 'style.css returns 200');
    assert(res.raw.includes('font-family') || res.raw.includes('--color'), 'Contains CSS');

    const res2 = await request('GET', '/app.js');
    assert(res2.status === 200, 'app.js returns 200');
    assert(res2.raw.includes('function') || res2.raw.includes('=>'), 'Contains JS');
  });

  // ── 16. NLP: action deadline extraction ───────────────────────────────
  await test('16. NLP — deadline detection in actions', async () => {
    const text = 'Mario Rossi preparerà il report entro il 20/07/2026. Laura Bianchi deve contattare i fornitori.';
    const res = await request('POST', '/api/generate', { text });
    assert(res.status === 200, 'Returns 200');
    const actions = res.body.summary.actions;
    const marioAction = actions.find(a => a.responsible && a.responsible.includes('Mario'));
    assert(marioAction && marioAction.deadline === '20/07/2026', 'Mario\'s action has correct deadline');
  });

  // ── 17. NLP: person detection ─────────────────────────────────────────
  await test('17. NLP — person name detection', async () => {
    const text = 'Mario Rossi e Laura Bianchi si occuperanno del progetto.';
    const res = await request('POST', '/api/generate', { text });
    assert(res.status === 200, 'Returns 200');
    const people = res.body.summary.metadata.peopleDetected;
    assert(Array.isArray(people), 'peopleDetected is an array');
  });

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

// ── Start server and run tests ──────────────────────────────────────────

// First require the server module to check if it exports correctly
try {
  const serverModule = require('./server');
  console.log('Server module loaded. Running tests against port ' + PORT + '...');

  // Give the server a moment to start
  setTimeout(() => {
    runTests().catch(err => {
      console.error('Test suite error:', err);
      process.exit(1);
    });
  }, 500);

} catch (err) {
  console.error('Failed to load server module:', err.message);
  console.log('Make sure the server is running on port ' + PORT);
  process.exit(1);
}
