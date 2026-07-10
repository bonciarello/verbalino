/**
 * Verbalino — Frontend App
 * Gestisce input, chiamate API, rendering dei risultati, salvataggio e bacheca.
 */
(function () {
  'use strict';

  // ── DOM Refs ──────────────────────────────────────────────────────────
  const form = document.getElementById('verbal-form');
  const textarea = document.getElementById('verbal-text');
  const errorField = document.getElementById('verbal-error');
  const generateBtn = document.getElementById('generate-btn');
  const clearBtn = document.getElementById('clear-btn');
  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const resultsSection = document.getElementById('results-section');
  const resultsTitle = document.querySelector('.results-title');
  const resultsMeta = document.querySelector('.results-meta');
  const resultsWarning = document.getElementById('results-warning');
  const resultsActions = document.getElementById('results-actions');

  // Cards
  const cardDecisions = document.getElementById('card-decisions');
  const cardActions = document.getElementById('card-actions');
  const cardOpen = document.getElementById('card-open');
  const listDecisions = document.getElementById('list-decisions');
  const listActions = document.getElementById('list-actions');
  const listOpen = document.getElementById('list-open');
  const countDecisions = document.getElementById('count-decisions');
  const countActions = document.getElementById('count-actions');
  const countOpen = document.getElementById('count-open');

  // Save / Share
  const saveBtn = document.getElementById('save-btn');
  const shareResult = document.getElementById('share-result');
  const shareUrlInput = document.getElementById('share-url-input');
  const copyBtn = document.getElementById('copy-btn');
  const copyFeedback = document.getElementById('copy-feedback');

  // Board
  const boardList = document.getElementById('board-list');

  // ── State ─────────────────────────────────────────────────────────────
  let currentSummary = null;
  let currentText = '';
  let isGenerating = false;

  // ── Helpers ───────────────────────────────────────────────────────────

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getInitials(name) {
    return name
      .split(/\s+/)
      .map(function (w) { return w[0].toUpperCase(); })
      .join('');
  }

  // ── API Calls ─────────────────────────────────────────────────────────

  async function apiCall(method, path, body) {
    const opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(path, opts);
    const data = await res.json();

    if (!res.ok && !data.success) {
      throw new Error(data.error || 'Errore del server');
    }

    return data;
  }

  // ── Generate ──────────────────────────────────────────────────────────

  async function handleGenerate(e) {
    e.preventDefault();

    if (isGenerating) return;

    const text = textarea.value.trim();

    // Validate
    if (!text) {
      showError('Inserisci il testo del verbale prima di generare il riepilogo.');
      textarea.classList.add('has-error');
      textarea.focus();
      return;
    }

    if (text.length < 20) {
      showError('Il testo è troppo breve. Incolla un verbale completo di almeno qualche frase.');
      textarea.classList.add('has-error');
      textarea.focus();
      return;
    }

    // Clear previous state
    textarea.classList.remove('has-error');
    hide(errorState);
    hide(resultsSection);
    hide(resultsActions);
    hide(shareResult);
    currentSummary = null;
    currentText = text;

    // Show loading
    show(loadingState);
    isGenerating = true;
    generateBtn.disabled = true;

    try {
      const data = await apiCall('POST', 'api/generate', { text: text });

      hide(loadingState);

      if (data.warning) {
        showWarning(data.warning);
      } else {
        hide(resultsWarning);
      }

      currentSummary = data.summary;
      renderResults(data.summary);
      show(resultsSection);
      show(resultsActions);
    } catch (err) {
      hide(loadingState);
      showError(err.message || 'Si è verificato un errore durante l\'elaborazione. Riprova.');
    } finally {
      isGenerating = false;
      generateBtn.disabled = false;
    }
  }

  function showError(msg) {
    errorState.innerHTML = msg;
    show(errorState);
    errorState.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showWarning(msg) {
    resultsWarning.textContent = msg;
    show(resultsWarning);
  }

  // ── Render Results ────────────────────────────────────────────────────

  function renderResults(summary) {
    // Title
    resultsTitle.textContent = summary.title || 'Riepilogo della riunione';

    // Meta
    const parts = [];
    if (summary.metadata) {
      parts.push(summary.metadata.wordCount + ' parole analizzate');
      parts.push(summary.metadata.processingTime + 'ms');
    }
    resultsMeta.textContent = parts.join(' · ');

    // Decisions
    const decisions = summary.decisions || [];
    if (decisions.length > 0) {
      countDecisions.textContent = decisions.length;
      listDecisions.innerHTML = decisions.map(function (d) {
        return '<li class="card-item">' + escHtml(d.text) + '</li>';
      }).join('');
      show(cardDecisions);
    } else {
      hide(cardDecisions);
    }

    // Actions
    const actions = summary.actions || [];
    if (actions.length > 0) {
      countActions.textContent = actions.length;
      listActions.innerHTML = actions.map(function (a) {
        var initials = a.responsible ? getInitials(a.responsible) : '?';
        var personHtml = a.responsible
          ? '<span class="action-person">' + escHtml(a.responsible) + '</span>'
          : '';
        var deadlineHtml = a.deadline
          ? '<span class="action-deadline">↦ ' + escHtml(a.deadline) + '</span>'
          : '<span class="action-no-deadline">senza scadenza</span>';

        return '<li class="action-item">' +
          '<div class="action-avatar" aria-hidden="true">' + escHtml(initials) + '</div>' +
          '<div class="action-body">' +
            '<p class="action-text">' + escHtml(a.text) + '</p>' +
            '<div class="action-meta">' + personHtml + deadlineHtml + '</div>' +
          '</div>' +
        '</li>';
      }).join('');
      show(cardActions);
    } else {
      hide(cardActions);
    }

    // Open Points
    const openPoints = summary.openPoints || [];
    if (openPoints.length > 0) {
      countOpen.textContent = openPoints.length;
      listOpen.innerHTML = openPoints.map(function (o) {
        return '<li class="card-item">' + escHtml(o.text) + '</li>';
      }).join('');
      show(cardOpen);
    } else {
      hide(cardOpen);
    }

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Save & Share ──────────────────────────────────────────────────────

  async function handleSave() {
    if (!currentSummary) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvataggio in corso…';

    try {
      const data = await apiCall('POST', 'api/save', {
        text: currentText,
        summary: currentSummary
      });

      const shareUrl = window.location.origin + window.location.pathname.replace(/\/+$/, '') + '/' + data.url;
      shareUrlInput.value = shareUrl;
      show(shareResult);
      shareResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Refresh board
      loadBoard();
    } catch (err) {
      showError('Errore durante il salvataggio: ' + (err.message || 'riprova.'));
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path></svg> Salva e condividi';
    }
  }

  function handleCopy() {
    const url = shareUrlInput.value;
    if (!url) return;

    navigator.clipboard.writeText(url).then(function () {
      copyFeedback.textContent = 'Link copiato negli appunti!';
      copyFeedback.style.color = 'var(--color-green)';
      setTimeout(function () { copyFeedback.textContent = ''; }, 2500);
    }).catch(function () {
      // Fallback
      shareUrlInput.select();
      document.execCommand('copy');
      copyFeedback.textContent = 'Link copiato!';
      copyFeedback.style.color = 'var(--color-green)';
      setTimeout(function () { copyFeedback.textContent = ''; }, 2500);
    });
  }

  // ── Clear ─────────────────────────────────────────────────────────────

  function handleClear() {
    textarea.value = '';
    textarea.classList.remove('has-error');
    hide(errorState);
    hide(resultsSection);
    hide(resultsWarning);
    hide(resultsActions);
    hide(shareResult);
    currentSummary = null;
    currentText = '';
    textarea.focus();
  }

  // ── Board ─────────────────────────────────────────────────────────────

  async function loadBoard() {
    try {
      const data = await apiCall('GET', 'api/board');
      const entries = data.entries || [];

      if (entries.length === 0) {
        boardList.innerHTML = '<p class="board-empty">Nessun riepilogo salvato. Genera il tuo primo riepilogo!</p>';
        return;
      }

      boardList.innerHTML = entries.map(function (e) {
        var date = new Date(e.createdAt).toLocaleDateString('it-IT', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });

        var badges = [];
        if (e.decisionsCount > 0) badges.push('<span class="board-item-badge board-item-badge--decisions">' + e.decisionsCount + ' dec.</span>');
        if (e.actionsCount > 0) badges.push('<span class="board-item-badge board-item-badge--actions">' + e.actionsCount + ' az.</span>');
        if (e.openCount > 0) badges.push('<span class="board-item-badge board-item-badge--open">' + e.openCount + ' aperti</span>');

        return '<a href="s/' + escHtml(e.id) + '" class="board-item">' +
          '<span class="board-item-title">' + escHtml(e.title) + '</span>' +
          '<span class="board-item-meta">' +
            badges.join('') +
            '<span>' + date + '</span>' +
          '</span>' +
        '</a>';
      }).join('');
    } catch (_) {
      // Silently fail - board is not critical
    }
  }

  // ── Live validation (blur) ────────────────────────────────────────────

  function handleBlur() {
    var text = textarea.value.trim();
    if (!text) {
      errorField.textContent = 'Inserisci il testo del verbale.';
      show(errorField);
      textarea.classList.add('has-error');
    } else if (text.length < 20) {
      errorField.textContent = 'Il testo deve contenere almeno 20 caratteri per un\'analisi utile.';
      show(errorField);
      textarea.classList.add('has-error');
    } else {
      hide(errorField);
      textarea.classList.remove('has-error');
    }
  }

  function handleInput() {
    if (textarea.classList.contains('has-error')) {
      var text = textarea.value.trim();
      if (text.length >= 20) {
        hide(errorField);
        textarea.classList.remove('has-error');
      }
    }
  }

  // ── Event Listeners ───────────────────────────────────────────────────

  form.addEventListener('submit', handleGenerate);
  textarea.addEventListener('blur', handleBlur);
  textarea.addEventListener('input', handleInput);
  clearBtn.addEventListener('click', handleClear);
  saveBtn.addEventListener('click', handleSave);
  copyBtn.addEventListener('click', handleCopy);

  // Keyboard shortcut: Ctrl+Enter to generate
  textarea.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────
  loadBoard();

})();
