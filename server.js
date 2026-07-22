'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4599;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'summaries.json');
const EXPIRY_DAYS = 7;
const MAX_BOARD_ITEMS = 20;
const CANONICAL_BASE = 'https://github.com/bonciarello/verbalino';

// ── Data store ───────────────────────────────────────────────────────────────
let store = { summaries: {} };
let storeDirty = false;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore() {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      store = JSON.parse(raw);
      if (!store.summaries) store.summaries = {};
    }
  } catch (_) {
    store = { summaries: {} };
  }
}

function saveStore() {
  if (!storeDirty) return;
  ensureDataDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
    storeDirty = false;
  } catch (e) {
    console.error('Failed to persist store:', e.message);
  }
}

function generateId() {
  return crypto.randomBytes(5).toString('hex'); // 10-char hex
}

function cleanExpired() {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, entry] of Object.entries(store.summaries)) {
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() < now) {
      delete store.summaries[id];
      cleaned++;
      storeDirty = true;
    }
  }
  if (cleaned > 0) saveStore();
}

// Periodic cleanup every hour
setInterval(() => { cleanExpired(); }, 3600_000);
// Also clean on startup
loadStore();
cleanExpired();

// ── Italian NLP Engine ───────────────────────────────────────────────────────

const ITALIAN_MONTHS = [
  'gennaio','febbraio','marzo','aprile','maggio','giugno',
  'luglio','agosto','settembre','ottobre','novembre','dicembre'
];

// Common Italian first names for better person detection
const COMMON_NAMES = new Set([
  'Alessandro','Alessio','Andrea','Angelo','Antonio','Alberto','Anna',
  'Barbara','Beatrice','Benedetta','Carlo','Caterina','Chiara','Claudia',
  'Cristina','Daniela','Davide','Diego','Domenico','Elena','Elisa',
  'Emanuele','Enrico','Fabio','Federica','Federico','Filippo','Francesca',
  'Francesco','Gabriele','Giacomo','Gianluca','Giorgia','Giorgio',
  'Giovanna','Giovanni','Giulia','Giulio','Giuseppe','Ilaria','Irene',
  'Laura','Leonardo','Lorenzo','Luca','Lucia','Luigi','Marco','Maria',
  'Mario','Marta','Martina','Massimo','Matteo','Mattia','Mauro','Michela',
  'Michele','Monica','Nicola','Nicoletta','Paola','Paolo','Patrizia',
  'Pietro','Raffaele','Riccardo','Roberta','Roberto','Rosa','Salvatore',
  'Sara','Silvia','Simone','Stefania','Stefano','Tommaso','Valentina',
  'Valerio','Veronica','Vincenzo','Vittorio'
]);

// ── Decision patterns
const DECISION_PATTERNS = [
  /si\s+decide\s+di\s+(.+?)(?:[.;]|$)/gi,
  /viene\s+deciso\s+(?:che\s+)?(.+?)(?:[.;]|$)/gi,
  /è\s+stato\s+deciso\s+(?:che\s+)?(.+?)(?:[.;]|$)/gi,
  /decisione\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /deciso\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /delibera\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /approvato\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /si\s+stabilisce\s+(?:che\s+)?(.+?)(?:[.;]|$)/gi,
  /si\s+concorda\s+(?:che\s+)?(.+?)(?:[.;]|$)/gi,
  /si\s+approva\s+(.+?)(?:[.;]|$)/gi,
  /deliberato\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /(?:l\'|la\s+|il\s+)?(?:assemblea|comitato|consiglio|team|gruppo)\s+(?:decide|ha\s+deciso|stabilisce)\s+(?:che\s+|di\s+)?(.+?)(?:[.;]|$)/gi,
];

// ── Action patterns (person + verb)
const ACTION_PERSON_VERB_PATTERNS = [
  /([A-Z][a-zà-ù]{2,}\s+[A-Z][a-zà-ù]{2,})\s+(?:farà|deve\s+fare|deve|dovrà|si\s+occuperà\s+di|si\s+occuperà|ha\s+il\s+compito\s+di|provvederà\s+a|preparerà|contatterà|scriverà|invierà|organizzerà|coordinerà|gestirà|seguirà|redigerà|pianificherà|creerà|svilupperà|analizzerà|verificherà|controllerà|presenterà)\s+(.+?)(?:[.;]|$)/gi,
];

// ── Action patterns (label-based)
const ACTION_LABEL_PATTERNS = [
  /azione\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /azioni?\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /compito\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /da\s+fare\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /todo\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /task\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
];

// ── Person assignment patterns
const PERSON_ASSIGN_PATTERNS = [
  /a\s+carico\s+di\s+([A-Z][a-zà-ù]+\s+[A-Z][a-zà-ù]+)\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /responsabile\s*[:\-–—]\s*([A-Z][a-zà-ù]+\s+[A-Z][a-zà-ù]+)/gi,
  /assegnat[oa]\s+a\s+([A-Z][a-zà-ù]+\s+[A-Z][a-zà-ù]+)\s*[:\-–—]?\s*(.+?)(?:[.;]|$)/gi,
  /@([A-Z][a-zà-ù]+(?:\s+[A-Z][a-zà-ù]+)?)\s*[:\-–—]?\s*(.+?)(?:[.;]|$)/gi,
];

// ── Open points patterns
const OPEN_POINT_PATTERNS = [
  /punt[oi]\s+(?:aperto|in\s+sospeso|da\s+discutere)\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /da\s+(?:valutare|approfondire|chiarire|verificare|definire|discutere|analizzare)\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /in\s+sospeso\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /rimane\s+da\s+(?:definire|chiarire|approfondire)\s*(.+?)(?:[.;]|$)/gi,
  /rinviato\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /da\s+rivedere\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
  /pending\s*[:\-–—]\s*(.+?)(?:[.;]|$)/gi,
];

// ── Date patterns
const DATE_NUMERIC = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/g;
const DATE_TEXT = new RegExp(
  `(\\d{1,2})\\s+(${ITALIAN_MONTHS.join('|')})\\s+(\\d{4})`, 'gi'
);
const ENTR_IL_DATE = /entro\s+(?:il\s+)?(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:\d{2,4}|\d{2}))/gi;
const SCADENZA_DATE = /scadenza\s*[:\-–—]\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:\d{2,4}|\d{2}))/gi;
const DEADLINE_DATE = /deadline\s*[:\-–—]\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:\d{2,4}|\d{2}))/gi;
const PER_IL_DATE = /(?:entro|per)\s+(?:il\s+)?(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.](?:\d{2,4}|\d{2}))/gi;
const RELATIVE_DATE = /(?:entro|per)\s+(?:la\s+)?(?:prossim[oa]|questa)\s+(?:settimana|mese|anno|trimestre|semestre)/gi;
const FINE_MESE = /entro\s+fine\s+(?:mese|settimana|anno|trimestre)/gi;

// ── Italian first name + last name pattern (two capitalized words)
const NAME_PATTERN = /([A-Z][a-zà-ù]{2,}\s+[A-Z][a-zà-ù]{2,})/g;

// ── Helper: normalize text
function normalizeText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Helper: extract dates from text
function extractDates(text) {
  const dates = [];

  // Numeric dates (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
  let m;
  DATE_NUMERIC.lastIndex = 0;
  while ((m = DATE_NUMERIC.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      dates.push({
        raw: m[0],
        formatted: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
        date: new Date(year, month - 1, day)
      });
    }
  }

  // Text dates (15 marzo 2026)
  DATE_TEXT.lastIndex = 0;
  while ((m = DATE_TEXT.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const monthName = m[2].toLowerCase();
    const month = ITALIAN_MONTHS.indexOf(monthName);
    const year = parseInt(m[3], 10);
    if (month >= 0 && day >= 1 && day <= 31) {
      dates.push({
        raw: m[0],
        formatted: `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`,
        date: new Date(year, month, day)
      });
    }
  }

  // Remove duplicates, sort by date
  const seen = new Set();
  return dates
    .filter(d => {
      const key = d.formatted;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date - b.date);
}

// ── Helper: extract the first date found in a text snippet
function extractDateFromSnippet(snippet, allDates) {
  for (const d of allDates) {
    if (snippet.includes(d.raw)) {
      return d.formatted;
    }
  }
  return null;
}

// ── Helper: find dates near a position in text
function findNearbyDates(text, position, allDates) {
  // Look for dates within ~200 chars after and before the position
  const start = Math.max(0, position - 50);
  const snippet = text.substring(start, position + 200);
  return extractDateFromSnippet(snippet, allDates);
}

// ── Helper: is a string a person name (two words, first is common name)
function isPersonName(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length !== 2) return false;
  const firstName = parts[0];
  // Check against common names or capitalize pattern
  if (COMMON_NAMES.has(firstName)) return true;
  // Also accept if both parts look like proper names (capitalized, >= 3 chars, no numbers)
  return /^[A-Z][a-zà-ù]{2,}$/.test(parts[0]) && /^[A-Z][a-zà-ù]{2,}$/.test(parts[1]);
}

// ── Helper: extract all person names from text
function extractPeopleNames(text) {
  const names = [];
  const seen = new Set();
  NAME_PATTERN.lastIndex = 0;
  let m;
  while ((m = NAME_PATTERN.exec(text)) !== null) {
    const name = m[1];
    if (!seen.has(name) && isPersonName(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

// ── Helper: get initials from name
function getInitials(name) {
  return name
    .split(/\s+/)
    .map(w => w[0].toUpperCase())
    .join('');
}

// ── Main NLP: parse verbal text
function parseVerbal(text) {
  const startTime = Date.now();
  const normalized = normalizeText(text);
  const allDates = extractDates(normalized);
  const allPeople = extractPeopleNames(normalized);

  const decisions = [];
  const actions = [];
  const openPoints = [];

  // Split into lines for structured analysis
  const lines = normalized.split('\n');
  const processedPositions = new Set(); // track char ranges already processed

  // ── Phase 1: Check for structured sections ──
  let currentSection = null;
  const sectionLines = { decisions: [], actions: [], open: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();

    if (/^(?:decisioni|decision|delibere|delibera|cosa\s+(?:si\s+)?decide)[\s:]*$/i.test(lower)) {
      currentSection = 'decisions';
      continue;
    }
    if (/^(?:azioni|azione|action|tasks|task|compiti|compito|cosa\s+(?:si\s+)?fa|da\s+fare)[\s:]*$/i.test(lower)) {
      currentSection = 'actions';
      continue;
    }
    if (/^(?:punti\s+aperti|punto\s+aperto|in\s+sospeso|da\s+discutere|da\s+approfondire|open\s+points|pending)[\s:]*$/i.test(lower)) {
      currentSection = 'open';
      continue;
    }

    if (currentSection === 'decisions') {
      // Remove bullet markers
      const clean = trimmed.replace(/^[\s]*[-•*]\s*/, '');
      if (clean) sectionLines.decisions.push(clean);
    } else if (currentSection === 'actions') {
      const clean = trimmed.replace(/^[\s]*[-•*]\s*/, '');
      if (clean) sectionLines.actions.push(clean);
    } else if (currentSection === 'open') {
      const clean = trimmed.replace(/^[\s]*[-•*]\s*/, '');
      if (clean) sectionLines.open.push(clean);
    }
  }

  // Process structured sections first
  for (const line of sectionLines.decisions) {
    const text_clean = line.replace(/^[:\-–—]\s*/, '').trim();
    if (text_clean) {
      decisions.push({ text: text_clean.charAt(0).toUpperCase() + text_clean.slice(1) });
    }
  }

  for (const line of sectionLines.actions) {
    const text_clean = line.replace(/^[:\-–—]\s*/, '').trim();
    if (!text_clean) continue;

    // Try to extract person and deadline from the line
    let responsible = null;
    let deadline = null;
    let actionText = text_clean;

    // Extract person name from the line
    for (const person of allPeople) {
      if (text_clean.includes(person)) {
        responsible = person;
        break;
      }
    }

    // Extract deadline
    for (const d of allDates) {
      if (text_clean.includes(d.raw)) {
        deadline = d.formatted;
        break;
      }
    }

    // If no person found, try to detect "Nome Cognome:" at start
    const personPrefix = text_clean.match(/^([A-Z][a-zà-ù]+\s+[A-Z][a-zà-ù]+)\s*[:\-–—]\s*/);
    if (personPrefix && isPersonName(personPrefix[1])) {
      responsible = personPrefix[1];
      actionText = text_clean.substring(personPrefix[0].length);
    }

    actions.push({
      text: actionText.charAt(0).toUpperCase() + actionText.slice(1),
      responsible,
      deadline
    });
  }

  for (const line of sectionLines.open) {
    const text_clean = line.replace(/^[:\-–—]\s*/, '').trim();
    if (text_clean) {
      openPoints.push({ text: text_clean.charAt(0).toUpperCase() + text_clean.slice(1) });
    }
  }

  // ── Phase 2: Pattern-based extraction for unstructured text ──
  // Only if we didn't find structured sections (or to supplement)

  if (decisions.length === 0 && actions.length === 0 && openPoints.length === 0) {
    // ── Extract decisions
    for (const pattern of DECISION_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(normalized)) !== null) {
        const raw = (m[1] || m[2] || '').trim();
        const clean = raw.replace(/^[:\-–—]\s*/, '').replace(/^che\s+/i, '').replace(/^di\s+/i, '').trim();
        if (clean && clean.length > 3) {
          const key = clean.toLowerCase().slice(0, 40);
          if (!decisions.some(d => d.text.toLowerCase().slice(0, 40) === key)) {
            decisions.push({ text: clean.charAt(0).toUpperCase() + clean.slice(1) });
          }
        }
      }
    }

    // ── Extract actions with person + verb
    for (const pattern of ACTION_PERSON_VERB_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(normalized)) !== null) {
        const person = (m[1] || '').trim();
        const task = (m[2] || '').trim();
        if (person && task && isPersonName(person) && task.length > 3) {
          // Check for deadline in the action text first, then nearby
          let deadline = extractDateFromSnippet(m[0], allDates) ||
                         findNearbyDates(normalized, m.index + m[0].length, allDates);
          const key = (person + task).toLowerCase().slice(0, 50);
          if (!actions.some(a => (a.responsible + a.text).toLowerCase().slice(0, 50) === key)) {
            actions.push({
              text: task.charAt(0).toUpperCase() + task.slice(1),
              responsible: person,
              deadline
            });
          }
        }
      }
    }

    // ── Extract actions with person assignment (a carico di, responsabile, etc.)
    for (const pattern of PERSON_ASSIGN_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(normalized)) !== null) {
        const person = (m[1] || '').trim();
        const task = (m[2] || '').trim();
        if (person && isPersonName(person)) {
          const taskClean = task ? task.replace(/^[:\-–—]\s*/, '').trim() : '';
          if (taskClean && taskClean.length > 3) {
            let deadline = extractDateFromSnippet(m[0], allDates) ||
                           findNearbyDates(normalized, m.index + m[0].length, allDates);
            const key = (person + taskClean).toLowerCase().slice(0, 50);
            if (!actions.some(a => (a.responsible + a.text).toLowerCase().slice(0, 50) === key)) {
              actions.push({
                text: taskClean.charAt(0).toUpperCase() + taskClean.slice(1),
                responsible: person,
                deadline
              });
            }
          }
        }
      }
    }

    // ── Extract actions from label patterns
    for (const pattern of ACTION_LABEL_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(normalized)) !== null) {
        const raw = (m[1] || '').trim();
        if (raw && raw.length > 3) {
          // Try to find person name in the action text
          let responsible = null;
          for (const person of allPeople) {
            if (raw.includes(person)) {
              responsible = person;
              break;
            }
          }
          let deadline = extractDateFromSnippet(m[0], allDates) ||
                         findNearbyDates(normalized, m.index + m[0].length, allDates);
          const key = raw.toLowerCase().slice(0, 50);
          if (!actions.some(a => a.text.toLowerCase().slice(0, 50) === key)) {
            actions.push({
              text: raw.charAt(0).toUpperCase() + raw.slice(1),
              responsible,
              deadline
            });
          }
        }
      }
    }

    // ── Extract open points
    for (const pattern of OPEN_POINT_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(normalized)) !== null) {
        const raw = (m[1] || '').trim();
        if (raw && raw.length > 3) {
          const key = raw.toLowerCase().slice(0, 40);
          if (!openPoints.some(p => p.text.toLowerCase().slice(0, 40) === key)) {
            openPoints.push({ text: raw.charAt(0).toUpperCase() + raw.slice(1) });
          }
        }
      }
    }
  }

  // ── Phase 3: If still no open points, look for sentences with "da" + infinitive
  if (openPoints.length === 0) {
    const daPattern = /\b(?:rimane\s+)?da\s+(valutare|approfondire|chiarire|verificare|definire|discutere|analizzare|stabilire|capire|vedere)\b/gi;
    let m;
    while ((m = daPattern.exec(normalized)) !== null) {
      // Get the full sentence containing this phrase
      const start = Math.max(0, m.index - 100);
      const end = Math.min(normalized.length, m.index + 200);
      let sentence = normalized.substring(start, end);
      // Find sentence boundaries
      const periodIdx = sentence.indexOf('.');
      if (periodIdx > 0) sentence = sentence.substring(0, periodIdx);
      sentence = sentence.trim();
      if (sentence.length > 5) {
        const key = sentence.toLowerCase().slice(0, 40);
        if (!openPoints.some(p => p.text.toLowerCase().slice(0, 40) === key)) {
          openPoints.push({ text: sentence.charAt(0).toUpperCase() + sentence.slice(1) });
        }
      }
    }
  }

  // ── Phase 4: Clean up and deduplicate ──

  // Remove duplicates from decisions
  const uniqueDecisions = [];
  const seenD = new Set();
  for (const d of decisions) {
    const key = d.text.toLowerCase().replace(/[^a-zà-ù0-9]/g, '').slice(0, 60);
    if (!seenD.has(key)) {
      seenD.add(key);
      uniqueDecisions.push(d);
    }
  }

  // Remove duplicates from actions
  const uniqueActions = [];
  const seenA = new Set();
  for (const a of actions) {
    const key = (a.text + (a.responsible || '')).toLowerCase().replace(/[^a-zà-ù0-9]/g, '').slice(0, 60);
    if (!seenA.has(key)) {
      seenA.add(key);
      uniqueActions.push(a);
    }
  }

  // Remove duplicates from open points
  const uniqueOpen = [];
  const seenO = new Set();
  for (const o of openPoints) {
    const key = o.text.toLowerCase().replace(/[^a-zà-ù0-9]/g, '').slice(0, 60);
    if (!seenO.has(key)) {
      seenO.add(key);
      uniqueOpen.push(o);
    }
  }

  // Sort actions by deadline
  uniqueActions.sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    const dateA = parseDate(a.deadline);
    const dateB = parseDate(b.deadline);
    return dateA - dateB;
  });

  const processingTime = Date.now() - startTime;

  // Generate a title
  const today = new Date();
  const dateStr = today.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  let title = `Riepilogo riunione del ${dateStr}`;

  // Try to extract a topic from the first few lines
  const firstLine = lines.find(l => l.trim().length > 10);
  if (firstLine && firstLine.length < 120) {
    const clean = firstLine.replace(/^[:\-–—#*\s]+/, '').trim();
    if (clean.length > 3 && !/^(?:decisioni|azioni|partecipanti|presenti|data|luogo|ora)/i.test(clean)) {
      title = clean;
    }
  }

  return {
    title,
    date: today.toISOString().split('T')[0],
    decisions: uniqueDecisions,
    actions: uniqueActions,
    openPoints: uniqueOpen,
    metadata: {
      charCount: normalized.length,
      wordCount: normalized.split(/\s+/).filter(Boolean).length,
      processingTime,
      peopleDetected: allPeople,
      datesDetected: allDates.map(d => d.formatted)
    }
  };
}

function parseDate(str) {
  const parts = str.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day).getTime();
  }
  return Infinity;
}

// ── Express App ──────────────────────────────────────────────────────────────
const app = express();

// Middleware
app.use(express.json({ limit: '500kb' }));

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
  }
}));

// ── API Routes ───────────────────────────────────────────────────────────────

// POST /api/generate — analyze text, return structured summary
app.post('/api/generate', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nessun testo fornito.',
        hint: 'Incolla il verbale della riunione nel campo testo.'
      });
    }

    if (text.trim().length < 20) {
      return res.status(400).json({
        success: false,
        error: 'Il testo è troppo breve per essere analizzato.',
        hint: 'Incolla un verbale completo di almeno qualche frase per ottenere un riepilogo utile.'
      });
    }

    const summary = parseVerbal(text.trim());

    // If nothing was found, provide a graceful response
    if (summary.decisions.length === 0 && summary.actions.length === 0 && summary.openPoints.length === 0) {
      return res.json({
        success: true,
        summary,
        warning: 'Nessun elemento strutturato è stato rilevato automaticamente. Prova a usare frasi come "Si decide di...", "Mario farà...", "Da valutare..." per aiutare il riconoscimento.'
      });
    }

    res.json({ success: true, summary });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ success: false, error: 'Errore interno durante l\'elaborazione.' });
  }
});

// POST /api/save — save summary to board
app.post('/api/save', (req, res) => {
  try {
    const { text, summary } = req.body;
    if (!summary) {
      return res.status(400).json({ success: false, error: 'Nessun riepilogo da salvare.' });
    }

    const id = generateId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    store.summaries[id] = {
      id,
      originalText: text || '',
      summary,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
    storeDirty = true;
    saveStore();

    res.json({
      success: true,
      id,
      url: `s/${id}`,
      expiresAt: expiresAt.toISOString()
    });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ success: false, error: 'Errore durante il salvataggio.' });
  }
});

// GET /api/summary/:id — get saved summary
app.get('/api/summary/:id', (req, res) => {
  try {
    const { id } = req.params;
    const entry = store.summaries[id];

    if (!entry) {
      return res.status(404).json({ success: false, error: 'Riepilogo non trovato. Potrebbe essere scaduto.' });
    }

    // Check expiry
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      delete store.summaries[id];
      storeDirty = true;
      saveStore();
      return res.status(410).json({ success: false, error: 'Questo riepilogo è scaduto.' });
    }

    res.json({ success: true, entry });
  } catch (err) {
    console.error('Get summary error:', err);
    res.status(500).json({ success: false, error: 'Errore interno.' });
  }
});

// GET /api/board — list recent summaries
app.get('/api/board', (req, res) => {
  try {
    cleanExpired();

    const entries = Object.values(store.summaries)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, MAX_BOARD_ITEMS)
      .map(e => ({
        id: e.id,
        title: e.summary.title || 'Senza titolo',
        createdAt: e.createdAt,
        expiresAt: e.expiresAt,
        decisionsCount: e.summary.decisions?.length || 0,
        actionsCount: e.summary.actions?.length || 0,
        openCount: e.summary.openPoints?.length || 0
      }));

    res.json({ success: true, entries });
  } catch (err) {
    console.error('Board error:', err);
    res.status(500).json({ success: false, error: 'Errore interno.' });
  }
});

// ── Share Page (server-rendered for SEO) ────────────────────────────────────
app.get('/s/:id', (req, res) => {
  try {
    const { id } = req.params;
    const entry = store.summaries[id];

    if (!entry || new Date(entry.expiresAt).getTime() < Date.now()) {
      if (entry) {
        delete store.summaries[id];
        storeDirty = true;
        saveStore();
      }
      return res.status(404).send(renderNotFound(id));
    }

    res.send(renderSharePage(entry));
  } catch (err) {
    console.error('Share page error:', err);
    res.status(500).send('Errore interno.');
  }
});

// ── Sitemap & Robots ────────────────────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${CANONICAL_BASE}/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Sitemap: ${CANONICAL_BASE}/sitemap.xml
`);
});

// ── HTML Renderers ──────────────────────────────────────────────────────────

function renderSharePage(entry) {
  const { summary } = entry;
  const shareUrl = `${CANONICAL_BASE}/s/${entry.id}`;
  const title = summary.title || 'Riepilogo riunione';
  const description = summary.decisions?.[0]?.text || summary.actions?.[0]?.text || 'Riepilogo generato con Verbalino';

  const decisionsHtml = (summary.decisions || []).map(d =>
    `<li class="share-item share-item--decision">${escHtml(d.text)}</li>`
  ).join('');

  const actionsHtml = (summary.actions || []).map(a => {
    const respHtml = a.responsible
      ? `<span class="share-action-person">${escHtml(a.responsible)}</span>`
      : '';
    const deadlineHtml = a.deadline
      ? `<span class="share-action-deadline">↦ ${escHtml(a.deadline)}</span>`
      : '';
    return `<li class="share-item share-item--action">
      ${respHtml}
      <span class="share-action-text">${escHtml(a.text)}</span>
      ${deadlineHtml}
    </li>`;
  }).join('');

  const openHtml = (summary.openPoints || []).map(o =>
    `<li class="share-item share-item--open">${escHtml(o.text)}</li>`
  ).join('');

  const createdAt = new Date(entry.createdAt).toLocaleDateString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const expiresAt = new Date(entry.expiresAt).toLocaleDateString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} — Verbalino</title>
<meta name="description" content="${escHtml(description)}">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${escHtml(shareUrl)}">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${escHtml(shareUrl)}">
<meta property="og:site_name" content="Verbalino">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="style.css">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "CreativeWork",
  "name": "${escJs(title)}",
  "description": "${escJs(description)}",
  "dateCreated": "${entry.createdAt}",
  "url": "${escJs(shareUrl)}",
  "about": "Riepilogo riunione generato automaticamente"
}
</script>
</head>
<body id="share-page">
<header class="share-header">
  <a href="./" class="share-logo">Verbalino</a>
  <p class="share-subtitle">Riepilogo generato automaticamente</p>
</header>

<main class="share-main">
  <article class="share-card">
    <h1 class="share-title">${escHtml(title)}</h1>

    <div class="share-meta">
      <span>Creato il ${createdAt}</span>
      <span class="share-meta-sep">·</span>
      <span>Scade il ${escHtml(expiresAt)}</span>
    </div>

    ${decisionsHtml ? `
    <section class="share-section share-section--decisions">
      <h2 class="share-section-title">Decisioni</h2>
      <ul class="share-list">${decisionsHtml}</ul>
    </section>` : ''}

    ${actionsHtml ? `
    <section class="share-section share-section--actions">
      <h2 class="share-section-title">Azioni</h2>
      <ul class="share-list">${actionsHtml}</ul>
    </section>` : ''}

    ${openHtml ? `
    <section class="share-section share-section--open">
      <h2 class="share-section-title">Punti aperti</h2>
      <ul class="share-list">${openHtml}</ul>
    </section>` : ''}

    ${!decisionsHtml && !actionsHtml && !openHtml ? `
    <p class="share-empty">Nessun elemento strutturato rilevato in questo riepilogo.</p>` : ''}
  </article>

  <div class="share-actions">
    <button id="copy-share-link" class="btn btn--primary" data-url="${escHtml(shareUrl)}">
      Copia link
    </button>
  </div>
</main>

<footer class="share-footer">
  <p>Creato con <a href="./">Verbalino</a> — i riepiloghi scadono automaticamente dopo 7 giorni.</p>
</footer>

<script>
document.getElementById('copy-share-link').addEventListener('click', function() {
  const url = this.getAttribute('data-url');
  navigator.clipboard.writeText(url).then(() => {
    this.textContent = 'Copiato!';
    setTimeout(() => { this.textContent = 'Copia link'; }, 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    this.textContent = 'Copiato!';
    setTimeout(() => { this.textContent = 'Copia link'; }, 2000);
  });
});
</script>
</body>
</html>`;
}

function renderNotFound(id) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Riepilogo non trovato — Verbalino</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="style.css">
</head>
<body id="share-page">
<header class="share-header">
  <a href="./" class="share-logo">Verbalino</a>
</header>
<main class="share-main">
  <article class="share-card share-card--notfound">
    <h1 class="share-title">Riepilogo non trovato</h1>
    <p>Il riepilogo <code>${escHtml(id)}</code> non esiste o è scaduto.</p>
    <p>I riepiloghi vengono automaticamente rimossi dopo 7 giorni dalla creazione.</p>
    <a href="./" class="btn btn--primary">Torna alla home</a>
  </article>
</main>
<footer class="share-footer">
  <p>Creato con <a href="./">Verbalino</a></p>
</footer>
</body>
</html>`;
}

// ── Escape helpers ──────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escJs(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ── Fallback: serve index.html for SPA-like routing ────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Verbalino server running at http://0.0.0.0:${PORT}`);
});

module.exports = { app, parseVerbal, store };
