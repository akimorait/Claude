/*
 * Pocket Picked It newsletter popup, with a built-in A/B/C test.
 *
 * Settings arrive as JSON in #pp-popup-config (written by the Shopify section,
 * or by the preview page). Three designs share one form and one success state:
 *   A  Pocket Pop   centred card with the cream marquee band and logo dots
 *   B  Lights On    split card, lamp photo flickers on as it opens
 *   C  Colour Pick  corner card that asks for a favourite colour first
 *   D  Room Match   pick the room it's for, get a matching lamp, then sign up
 *   E  Print Job    a receipt that prints down from the top of the screen
 *
 * Each visitor is given one design (weighted random), keeps it on every visit,
 * and every view / close / sign-up is reported with that design's letter.
 */
(() => {
  'use strict';

  const cfgEl = document.getElementById('pp-popup-config');
  if (!cfgEl) return;
  let C;
  try { C = JSON.parse(cfgEl.textContent); } catch (e) { return; }

  // The theme editor re-runs this script whenever a setting changes.
  if (window.PocketPopup && window.PocketPopup.destroy) window.PocketPopup.destroy();

  const VARIANTS = ['A', 'B', 'C', 'D', 'E'];
  const MODAL = { A: true, B: true, C: false, D: true, E: true };
  // Best-selling colours first: net sales by product vendor (the store keeps
  // each product's colour in its Vendor field), last 6 months. Swatch colours
  // match the store's "Shop by colour" row; each id is that colour's
  // collection handle (those collections are built from the vendor).
  const COLOURS = C.colours || [
    { id: 'coffee', name: 'Coffee', hex: '#d4b89b' },
    { id: 'lemon', name: 'Lemon', hex: '#f7e569' },
    { id: 'maple', name: 'Maple', hex: '#c68642' },
    { id: 'natural', name: 'Natural', hex: '#a69f8e' },
    { id: 'mandarin', name: 'Mandarin', hex: '#ff8243' },
    { id: 'oatmeal', name: 'Oatmeal', hex: '#eeddb2' },
    { id: 'spearmint', name: 'Spearmint', hex: '#7ab87f' },
  ];
  const collectionUrl = (handle) => (C.collectionsUrl || '/collections') + '/' + encodeURIComponent(handle);

  const ROOMS = (C.rooms || []).filter((r) => r && r.name);

  function jobNumber() {
    const digits = String(C.code || '').replace(/\D/g, '');
    return digits.slice(-4) || '0001';
  }

  function receiptRows() {
    return String(C.receipt || '').split('\n').map((line) => line.split('|'))
      .filter((p) => p.length === 2 && p[0].trim())
      .map((p) => `<div><dt>${esc(p[0].trim())}</dt><dd>${esc(p[1].trim())}</dd></div>`).join('');
  }

  const experiment = String(C.experiment || 'popup-test-1');
  const K = {
    variant: 'pp_popup:' + experiment + ':variant',
    closedUntil: 'pp_popup:closed_until',
    joined: 'pp_popup:joined',
    pending: 'pp_popup:pending',
    tabOff: 'pp_popup:tab_off',
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
  };
  const persist = !C.preview && !C.designMode;
  const mount = (C.mount && document.querySelector(C.mount)) || document.body;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root = null;
  let tab = null;
  let variant = null;
  let choice = null; // { kind: 'colour' | 'room', id }
  let lastFocus = null;
  const cleanups = [];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  /* ---------- A/B assignment ---------- */

  function weights() {
    const w = C.weights || {};
    return VARIANTS.map((id) => ({ id, w: Math.max(0, Number(w[id]) || 0) })).filter((x) => x.w > 0);
  }

  function forcedVariant() {
    const m = location.search.match(/[?&]pp_popup=([a-e])\b/i);
    return m ? m[1].toUpperCase() : null;
  }

  // Weighted random pick, remembered per experiment so a visitor always sees
  // the same design. Renaming the experiment starts everyone afresh.
  function assign() {
    const pool = weights();
    if (!pool.length) return null;
    const saved = store.get(K.variant);
    if (saved && pool.some((x) => x.id === saved)) return saved;
    const total = pool.reduce((sum, x) => sum + x.w, 0);
    let r = Math.random() * total;
    let pick = pool[pool.length - 1].id;
    for (const x of pool) {
      r -= x.w;
      if (r < 0) { pick = x.id; break; }
    }
    if (persist) store.set(K.variant, pick);
    return pick;
  }

  /* ---------- reporting ---------- */

  function track(name, extra) {
    const params = Object.assign({ popup_variant: variant, popup_experiment: experiment }, extra || {});
    if (C.preview) {
      document.dispatchEvent(new CustomEvent('pp-popup-track', { detail: { name, params } }));
      return;
    }
    if (C.designMode) return;
    // The design letter goes in the event name (popup_signup_b) so reports can
    // split by design without any Google Analytics setup.
    try {
      if (typeof window.gtag === 'function') {
        const gaParams = C.gaId ? Object.assign({ send_to: C.gaId }, params) : params;
        window.gtag('event', name + '_' + String(variant).toLowerCase(), gaParams);
      }
    } catch (e) { /* ignore */ }
    try {
      const a = window.Shopify && window.Shopify.analytics;
      if (a && typeof a.publish === 'function') a.publish(name, params);
    } catch (e) { /* ignore */ }
  }

  /* ---------- markup ---------- */

  const closeBtn = `<button type="button" class="ppp__x" data-close="button" aria-label="Close">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  const dots = (cls) => `<div class="${cls}" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`;
  const eyebrow = () => (C.eyebrow ? `<p class="ppp__eyebrow">${esc(C.eyebrow)}</p>` : '');
  const offer = () => (C.offer ? `<p class="ppp__offer"><span aria-hidden="true">✹</span>${esc(C.offer)}</p>` : '');

  function formHTML(label) {
    return `<form class="ppp__form" novalidate>
        <label class="ppp__sr" for="ppp-email">Email address</label>
        <input id="ppp-email" class="ppp__input" type="email" name="email" autocomplete="email"
          inputmode="email" enterkeyhint="send" autocapitalize="none" autocorrect="off" spellcheck="false"
          placeholder="${esc(C.placeholder || 'your@email.com')}" required>
        <button class="ppp__btn" type="submit">${esc(label || C.button || 'Join the list')}</button>
        <p class="ppp__err" role="alert" hidden></p>
        ${C.fine ? `<p class="ppp__fine">${esc(C.fine)}</p>` : ''}
      </form>`;
  }

  function doneHTML() {
    const code = C.code
      ? `<div class="ppp__code">
          <span class="ppp__code-label">${esc(C.codeLabel || 'Your code for checkout')}</span>
          <button type="button" class="ppp__code-btn" data-copy="${esc(C.code)}">
            <b>${esc(C.code)}</b><small data-copy-label>Copy</small></button>
        </div>`
      : '';
    return `<div class="ppp__done" hidden>
        ${dots('ppp__done-dots')}
        <h2 class="ppp__title" tabindex="-1">${esc(C.successTitle || "You're on the list")}</h2>
        <p class="ppp__body">${esc(C.successBody || '')}</p>
        ${code}
        <a class="ppp__btn ppp__btn--link" href="${esc(C.shopUrl || '/collections/all')}">${esc(C.shopLabel || 'Shop lamps')}</a>
      </div>`;
  }

  const marqueeWords = () => (C.marquee || 'new designs ✹ fresh colours ✹ early-bird specials ✹ made in melbourne ✹')
    .trim();

  const TEMPLATES = {
    A: () => `
      <div class="ppp__scrim" data-close="scrim"></div>
      <div class="ppp__card ppp-a" role="dialog" aria-modal="true" aria-labelledby="ppp-title" tabindex="-1">
        <div class="ppp-a__band" aria-hidden="true"><div class="ppp-a__track">
          <span>${esc(marqueeWords())}&nbsp;</span><span>${esc(marqueeWords())}&nbsp;</span>
          <span>${esc(marqueeWords())}&nbsp;</span><span>${esc(marqueeWords())}&nbsp;</span>
        </div></div>
        ${closeBtn}
        <div class="ppp__inner">
          <div class="ppp__main">
            ${dots('ppp-a__dots')}
            ${eyebrow()}
            <h2 class="ppp__title" id="ppp-title">${esc(C.headlineA)}</h2>
            <p class="ppp__body">${esc(C.body)}</p>
            ${offer()}
            ${formHTML()}
          </div>
          ${doneHTML()}
        </div>
      </div>`,

    B: () => `
      <div class="ppp__scrim" data-close="scrim"></div>
      <div class="ppp__card ppp-b${C.imageB ? '' : ' ppp-b--noimg'}" role="dialog" aria-modal="true"
        aria-labelledby="ppp-title" tabindex="-1">
        ${closeBtn}
        <div class="ppp-b__media" aria-hidden="true">
          ${C.imageB ? `<img src="${esc(C.imageB)}" alt="" loading="eager" decoding="async">` : dots('ppp-b__bigdots')}
          <span class="ppp-b__glow"></span>
          <span class="ppp-b__tag"><i></i><span class="ppp-b__off">lights off</span><span class="ppp-b__on">lights on</span></span>
        </div>
        <div class="ppp-b__panel">
          <div class="ppp__main">
            ${eyebrow()}
            <h2 class="ppp__title" id="ppp-title">${esc(C.headlineB)}</h2>
            <p class="ppp__body">${esc(C.body)}</p>
            ${offer()}
            ${formHTML()}
          </div>
          ${doneHTML()}
        </div>
      </div>`,

    C: () => `
      <div class="ppp__card ppp-c" role="dialog" aria-modal="false" aria-labelledby="ppp-title" tabindex="-1">
        ${closeBtn}
        <div class="ppp__main">
          <div class="ppp-c__step" data-step="pick">
            ${eyebrow()}
            <h2 class="ppp__title" id="ppp-title">${esc(C.headlineC)}</h2>
            <div class="ppp-c__swatches" role="group" aria-label="Colours">
              ${COLOURS.map((c) => `<button type="button" class="ppp-c__sw" data-colour="${esc(c.id)}"
                data-name="${esc(c.name)}" style="--sw:${esc(c.hex)}"><i></i><span>${esc(c.name)}</span></button>`).join('')}
              <button type="button" class="ppp-c__sw ppp-c__sw--all" data-colour="all" data-name="All of them">
                <i></i><span>All of them</span></button>
            </div>
          </div>
          <div class="ppp-c__step" data-step="form" hidden>
            <button type="button" class="ppp-c__chosen" data-back>
              <i></i><span></span><small>change</small></button>
            <h2 class="ppp__title ppp-c__title2" tabindex="-1"></h2>
            <p class="ppp__body">${esc(C.body)}</p>
            ${offer()}
            ${formHTML()}
          </div>
        </div>
        ${doneHTML()}
      </div>`,

    D: () => `
      <div class="ppp__scrim" data-close="scrim"></div>
      <div class="ppp__card ppp-d" role="dialog" aria-modal="true" aria-labelledby="ppp-title" tabindex="-1">
        ${closeBtn}
        <div class="ppp__main">
          <div class="ppp-d__step" data-step="pick">
            ${eyebrow()}
            <h2 class="ppp__title" id="ppp-title">${esc(C.headlineD)}</h2>
            <div class="ppp-d__rooms" role="group" aria-label="Rooms">
              ${ROOMS.map((r, i) => `<button type="button" class="ppp-d__room" data-room="${i}">
                  <span class="ppp-d__img">${r.image ? `<img src="${esc(r.image)}" alt="" decoding="async">` : ''}</span>
                  <span class="ppp-d__label"><b>${esc(r.name)}</b><small>${esc(r.mood)}</small></span>
                </button>`).join('')}
            </div>
          </div>
          <div class="ppp-d__step ppp-d__match" data-step="form" hidden>
            <figure class="ppp-d__pick">
              <span class="ppp-d__img"><img alt="" decoding="async"></span>
              <figcaption><small>Our pick</small><b></b><span></span></figcaption>
            </figure>
            <div class="ppp-d__form">
              <button type="button" class="ppp-c__chosen" data-back><i></i><span></span><small>change</small></button>
              <h2 class="ppp__title ppp-d__title2" tabindex="-1"></h2>
              <p class="ppp__body">${esc(C.bodyD || 'Tell us the room and we\u2019ll send lamp ideas that suit it, plus first dibs on new designs.')}</p>
              ${offer()}
              ${formHTML()}
            </div>
          </div>
        </div>
        ${doneHTML()}
      </div>`,

    E: () => `
      <div class="ppp__scrim ppp__scrim--light" data-close="scrim"></div>
      <div class="ppp-e__wrap">
        <div class="ppp-e__head" aria-hidden="true"><i></i><span>${esc(C.printerName || 'pocket-01 \u00b7 melbourne')}</span></div>
        <div class="ppp__card ppp-e" role="dialog" aria-modal="true" aria-labelledby="ppp-title" tabindex="-1">
          ${closeBtn}
          <div class="ppp__main">
            <p class="ppp-e__job">Print job #${esc(jobNumber())}</p>
            <h2 class="ppp__title" id="ppp-title">${esc(C.headlineE)}</h2>
            <dl class="ppp-e__rows">${receiptRows()}</dl>
            ${formHTML(C.buttonE || 'Start print')}
            <div class="ppp-e__progress" hidden aria-hidden="true">
              <span class="ppp-e__bar"><i></i></span><span class="ppp-e__pct">printing 0%</span>
            </div>
          </div>
          ${doneHTML()}
          <div class="ppp-e__tear" aria-hidden="true"></div>
        </div>
      </div>`,
  };

  /* ---------- open / close ---------- */

  function viewportSize() {
    return mount === document.body
      ? [window.innerWidth, window.innerHeight]
      : [mount.clientWidth, mount.clientHeight];
  }
  // Phones (narrow) and phones on their side (short) both get the compact
  // layout; "short" also trims tall pictures so the form stays reachable.
  function fit() {
    if (!root) return;
    const [w, h] = viewportSize();
    root.classList.toggle('ppp--compact', w < 640 || h < 520);
    root.classList.toggle('ppp--short', h < 520);
  }

  // When the phone keyboard opens, lift the popup above it.
  function onKeyboard() {
    const vv = window.visualViewport;
    if (!root || !vv || mount !== document.body) return;
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--ppp-kb', covered + 'px');
  }

  function open(v, opts) {
    opts = opts || {};
    if (!TEMPLATES[v]) return;
    if (root) close(null);
    hideTab();
    variant = v;
    choice = null;
    lastFocus = document.activeElement;

    root = document.createElement('div');
    root.className = 'ppp ppp--' + v.toLowerCase() + (mount === document.body ? '' : ' ppp--contained');
    root.dataset.variant = v;
    root.innerHTML = TEMPLATES[v]();
    mount.appendChild(root);
    fit();
    wire(root);

    if (MODAL[v] && mount === document.body) document.documentElement.classList.add('ppp-lock');
    // Two frames so the starting styles paint before the transition runs.
    requestAnimationFrame(() => requestAnimationFrame(() => root && root.classList.add('is-open')));
    if (v === 'B') setTimeout(() => root && root.classList.add('is-lit'), reduceMotion ? 0 : 420);

    if (opts.success) showDone();
    else if (MODAL[v] && !C.preview) {
      const card = root.querySelector('.ppp__card');
      const input = root.querySelector('.ppp__input');
      const fine = window.matchMedia('(pointer: fine)').matches;
      (fine && input ? input : card).focus({ preventScroll: true });
    }
    if (!opts.silent) track('popup_view', { popup_trigger: opts.trigger || 'manual' });
  }

  function close(method) {
    if (!root) return;
    const el = root;
    root = null;
    el.classList.remove('is-open');
    el.classList.add('is-closing');
    setTimeout(() => el.remove(), reduceMotion ? 0 : 320);
    document.documentElement.classList.remove('ppp-lock');
    if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
      lastFocus.focus({ preventScroll: true });
    }
    if (!method) return;
    if (el.dataset.state !== 'done') {
      if (persist) store.set(K.closedUntil, String(Date.now() + (Number(C.hideDays) || 14) * 864e5));
      track('popup_close', { close_method: method });
      showTab(el.dataset.variant);
    }
    document.dispatchEvent(new CustomEvent('pp-popup-closed'));
  }

  /* ---------- minimised tab ---------- */

  // After a close, a small pill stays in the corner so visitors can reopen
  // the same design whenever they like, until they hide it or sign up.
  function showTab(v) {
    if (C.tab === false || !TEMPLATES[v]) return;
    hideTab();
    const label = C.tabLabel || (C.offer ? 'Get $10 off' : 'Join the list');
    tab = document.createElement('div');
    tab.className = 'ppp ppp--tab' + (mount === document.body ? '' : ' ppp--contained');
    tab.innerHTML = `<div class="ppp-tab">
        <button type="button" class="ppp-tab__open" data-tab="open">
          ${dots('ppp-tab__dots')}<span>${esc(label)}</span></button>
        <button type="button" class="ppp-tab__x" data-tab="hide" aria-label="Hide this">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>`;
    tab.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      if (t.dataset.tab === 'open') {
        open(v, { trigger: 'tab' });
      } else {
        hideTab();
        if (persist) store.set(K.tabOff, store.get(K.closedUntil) || String(Date.now() + 864e5));
        variant = v;
        track('popup_tab_hide');
        document.dispatchEvent(new CustomEvent('pp-popup-closed'));
      }
    });
    mount.appendChild(tab);
    requestAnimationFrame(() => requestAnimationFrame(() => tab && tab.classList.add('is-open')));
  }

  function hideTab() {
    if (tab) { tab.remove(); tab = null; }
  }

  function showDone() {
    if (!root) return;
    root.dataset.state = 'done';
    root.querySelectorAll('.ppp__main').forEach((n) => { n.hidden = true; });
    const done = root.querySelector('.ppp__done');
    done.hidden = false;
    const title = done.querySelector('.ppp__title');
    if (title) title.focus({ preventScroll: true });
  }

  /* ---------- behaviour ---------- */

  function wire(el) {
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-close],[data-colour],[data-room],[data-back],[data-copy]');
      if (!t) return;
      if (t.dataset.close) close(t.dataset.close);
      else if (t.dataset.room) pickRoom(Number(t.dataset.room));
      else if (t.dataset.colour) pickColour(t.dataset.colour, t.dataset.name, t.style.getPropertyValue('--sw'));
      else if (t.hasAttribute('data-back')) stepTo('pick');
      else if (t.dataset.copy) copyCode(t);
    });
    const form = el.querySelector('.ppp__form');
    if (form) form.addEventListener('submit', onSubmit);
    el.addEventListener('focusin', (e) => {
      if (!e.target.matches('.ppp__input') || !el.classList.contains('ppp--compact')) return;
      setTimeout(() => { onKeyboard(); e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
    });
  }

  function stepTo(step) {
    root.querySelectorAll('[data-step]').forEach((s) => { s.hidden = s.dataset.step !== step; });
    const focusEl = step === 'form'
      ? root.querySelector('.ppp-c__title2, .ppp-d__title2')
      : root.querySelector('.ppp-c__sw, .ppp-d__room');
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  function pickColour(id, name, hex) {
    choice = { kind: 'colour', id };
    const card = root.querySelector('.ppp-c');
    const chip = root.querySelector('.ppp-c__chosen');
    card.style.setProperty('--pick', hex || 'transparent');
    card.classList.toggle('ppp-c--all', id === 'all');
    chip.querySelector('span').textContent = name;
    const headline = id === 'all'
      ? (C.headlineCAll || 'Can’t pick just one? Fair.')
      : String(C.headlineC2 || 'Good pick. [colour] it is.').replace(/\[colou?r\]/gi, name);
    root.querySelector('.ppp-c__title2').textContent = headline;
    // Point the thank-you button at that colour's collection.
    const shop = root.querySelector('.ppp__btn--link');
    if (shop) {
      shop.href = id === 'all' ? (C.shopUrl || '/collections/all') : collectionUrl(id);
      shop.textContent = id === 'all' ? (C.shopLabel || 'Shop lamps') : 'Shop ' + name + ' lamps';
    }
    track('popup_choice', { popup_choice: id });
    stepTo('form');
  }

  function pickRoom(i) {
    const r = ROOMS[i];
    if (!r) return;
    choice = { kind: 'room', id: r.id };
    const pick = root.querySelector('.ppp-d__pick');
    const img = pick.querySelector('img');
    if (r.image) { img.src = r.image; img.hidden = false; } else { img.hidden = true; }
    pick.querySelector('figcaption b').textContent = r.product || '';
    pick.querySelector('figcaption span').textContent = r.price || '';
    const chip = root.querySelector('.ppp-d__form .ppp-c__chosen');
    chip.querySelector('span').textContent = r.name;
    chip.querySelector('i').style.backgroundImage = r.image ? `url("${r.image.replace(/"/g, '%22')}")` : '';
    root.querySelector('.ppp-d__title2').textContent =
      String(C.headlineD2 || '[room] it is.').replace(/\[room\]/gi, r.name);
    // Point the thank-you button at the matching lamp.
    const shop = root.querySelector('.ppp__btn--link');
    if (shop && r.url) {
      shop.href = r.url;
      if (r.product) shop.textContent = 'Shop the ' + r.product;
    }
    track('popup_choice', { popup_choice: r.id });
    stepTo('form');
  }

  async function copyCode(btn) {
    const label = btn.querySelector('[data-copy-label]');
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      label.textContent = 'Copied';
    } catch (e) {
      const range = document.createRange();
      range.selectNodeContents(btn.querySelector('b'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      label.textContent = 'Selected';
    }
  }

  function tagsFor() {
    const tags = ['newsletter', 'popup', 'popup-' + variant, experiment];
    if (choice) tags.push(choice.kind + '-' + choice.id);
    String(C.extraTags || '').split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => tags.push(t));
    return tags.join(',');
  }

  async function send(email, tags) {
    if (C.preview) {
      await new Promise((r) => setTimeout(r, 650));
      return 'ok';
    }
    const fd = new FormData();
    fd.append('form_type', 'customer');
    fd.append('utf8', '✓');
    fd.append('contact[email]', email);
    fd.append('contact[tags]', tags);
    try {
      const res = await fetch(C.contactUrl || '/contact', {
        method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'text/html' },
      });
      // Shopify sometimes asks for a captcha; that needs a real page load.
      if (/\/challenge/.test(res.url)) return 'native';
      return res.ok ? 'ok' : 'error';
    } catch (e) {
      return 'native';
    }
  }

  // Fallback: post the hidden Shopify form the normal way. The page reloads
  // with ?customer_posted=true and boot() shows the success state.
  function nativeSubmit(email, tags) {
    const f = document.getElementById('pp-popup-native');
    if (!f) return false;
    f.querySelector('[name="contact[email]"]').value = email;
    f.querySelector('[name="contact[tags]"]').value = tags;
    store.set(K.pending, JSON.stringify({ v: variant, c: choice ? choice.id : 'none' }));
    f.submit();
    return true;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.querySelector('.ppp__input');
    const btn = form.querySelector('.ppp__btn');
    const err = form.querySelector('.ppp__err');
    const email = input.value.trim();
    err.hidden = true;
    input.removeAttribute('aria-invalid');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      err.textContent = C.errEmail || 'That email doesn’t look right. Check it and try again.';
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }

    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = C.busyLabel || 'Joining…';
    const tags = tagsFor();
    const result = await send(email, tags);

    if (result === 'ok') {
      if (variant === 'E') await printOut(form);
      if (persist) store.set(K.joined, '1');
      track('popup_signup', { popup_choice: choice ? choice.id : 'none' });
      showDone();
    } else if (result === 'native' && nativeSubmit(email, tags)) {
      // page is navigating away
    } else {
      btn.disabled = false;
      btn.textContent = label;
      err.textContent = C.errNetwork || 'Couldn’t sign you up just now. Try again in a moment.';
      err.hidden = false;
    }
  }

  // Design E: a short "printing" progress bar before the code appears.
  function printOut(form) {
    const box = root && root.querySelector('.ppp-e__progress');
    if (!box) return Promise.resolve();
    form.hidden = true;
    box.hidden = false;
    const bar = box.querySelector('i');
    const pct = box.querySelector('.ppp-e__pct');
    const total = reduceMotion ? 1 : 1400;
    const start = performance.now();
    return new Promise((resolve) => {
      const step = (t) => {
        const k = Math.min(1, (t - start) / total);
        const n = Math.round(k * 100);
        bar.style.width = n + '%';
        pct.textContent = k < 1 ? 'printing ' + n + '%' : 'done';
        if (k < 1) requestAnimationFrame(step);
        else setTimeout(resolve, reduceMotion ? 0 : 250);
      };
      requestAnimationFrame(step);
    });
  }

  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { close('escape'); return; }
    if (e.key !== 'Tab' || !MODAL[variant]) return;
    const items = [...root.querySelectorAll('button, a[href], input')].filter((n) => !n.disabled && n.offsetParent);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  /* ---------- when to show ---------- */

  function arm(v) {
    let fired = false;
    const timers = [];
    const fire = (trigger) => {
      if (fired || root) return;
      fired = true;
      timers.forEach(clearTimeout);
      open(v, { trigger });
    };

    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const delay = Number(finePointer || C.mobileDelay == null ? C.delay : C.mobileDelay) || 0;
    if (delay > 0) timers.push(setTimeout(() => fire('delay'), delay * 1000));

    // Phones have no mouse to leave the page with. A quick flick back up the
    // page (usually heading for the address bar) stands in for exit intent.
    if (C.mobileExit !== false && !finePointer) {
      const armedAt = Date.now();
      let anchorY = window.scrollY;
      let anchorT = performance.now();
      let deepest = 0;
      listen(window, 'scroll', () => {
        const y = window.scrollY;
        const t = performance.now();
        deepest = Math.max(deepest, y);
        const dt = t - anchorT;
        const speed = (anchorY - y) / Math.max(dt, 1); // px per ms, upwards
        if (Date.now() - armedAt > 5000 && deepest > window.innerHeight && deepest - y > 300 && speed > 1.5) {
          fire('scroll_up');
        }
        if (dt > 120) { anchorY = y; anchorT = t; }
      }, { passive: true });
    }

    const scrollPct = Number(C.scroll) || 0;
    if (scrollPct > 0) {
      listen(window, 'scroll', () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0 && (window.scrollY / max) * 100 >= scrollPct) fire('scroll');
      }, { passive: true });
    }

    if (C.exitIntent && finePointer) {
      // Wait a few seconds so a quick mouse flick on arrival doesn't count.
      timers.push(setTimeout(() => {
        listen(document, 'mouseout', (e) => {
          if (!e.relatedTarget && e.clientY <= 0) fire('exit');
        });
      }, 4000));
    }
    cleanups.push(() => timers.forEach(clearTimeout));
  }

  function boot() {
    listen(document, 'keydown', onKey);
    listen(window, 'resize', fit);
    if (window.visualViewport) {
      listen(window.visualViewport, 'resize', onKeyboard);
      listen(window.visualViewport, 'scroll', onKeyboard);
    }
    if (mount !== document.body && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(fit);
      ro.observe(mount);
      cleanups.push(() => ro.disconnect());
    }

    window.PocketPopup = {
      open: (v, opts) => open(String(v).toUpperCase(), opts || { trigger: 'manual' }),
      hideTab,
      close: () => close('api'),
      variant: () => variant,
      assign,
      config: C,
      reset() { Object.values(K).forEach(store.del); },
      destroy() {
        cleanups.splice(0).forEach((fn) => fn());
        if (root) { root.remove(); root = null; }
        hideTab();
        document.documentElement.classList.remove('ppp-lock');
      },
    };

    if (C.preview || C.enabled === false) return;

    if (C.designMode) {
      // In the theme editor, show the design with the biggest share.
      const top = weights().sort((x, y) => y.w - x.w)[0];
      open(C.editorVariant || (top ? top.id : 'A'), { silent: true });
      return;
    }

    // Back from the fallback form post: show the thank-you in the same design.
    const pending = store.get(K.pending);
    if (pending && /[?&]customer_posted=true/.test(location.search)) {
      store.del(K.pending);
      store.set(K.joined, '1');
      let p = {};
      try { p = JSON.parse(pending); } catch (e) { /* ignore */ }
      if (TEMPLATES[p.v]) {
        open(p.v, { silent: true, success: true });
        track('popup_signup', { popup_choice: p.c || 'none' });
      }
      return;
    }

    const forced = forcedVariant();
    if (forced) { open(forced, { trigger: 'url' }); return; }
    if (C.suppress || store.get(K.joined)) return;
    const v = assign();
    if (!v) return;
    const now = Date.now();
    if (Number(store.get(K.closedUntil) || 0) > now) {
      // Closed recently: no popup, just the tab (unless they hid that too).
      if (Number(store.get(K.tabOff) || 0) <= now) showTab(v);
      return;
    }
    arm(v);
  }

  boot();
})();
