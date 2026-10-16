/*
 * Pocket Picked It newsletter popup, with a built-in A/B/C test.
 *
 * Settings arrive as JSON in #pp-popup-config (written by the Shopify section,
 * or by the preview page). Three designs share one form and one success state:
 *   A  Pocket Pop   centred card with the cream marquee band and logo dots
 *   B  Lights On    split card, lamp photo flickers on as it opens
 *   C  Colour Pick  corner card that asks for a favourite colour first
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

  const VARIANTS = ['A', 'B', 'C'];
  const MODAL = { A: true, B: true, C: false };
  const COLOURS = C.colours || [
    { id: 'lemon', name: 'Lemon', hex: '#F5D04C' },
    { id: 'candy', name: 'Candy', hex: '#F2A6B8' },
    { id: 'mandarin', name: 'Mandarin', hex: '#F08A2C' },
    { id: 'chocolate', name: 'Chocolate', hex: '#5E3B2A' },
    { id: 'oatmeal', name: 'Oatmeal', hex: '#E6D8BF' },
    { id: 'spearmint', name: 'Spearmint', hex: '#9ED3B8' },
    { id: 'maple', name: 'Maple', hex: '#B9773F' },
  ];

  const experiment = String(C.experiment || 'popup-test-1');
  const K = {
    variant: 'pp_popup:' + experiment + ':variant',
    closedUntil: 'pp_popup:closed_until',
    joined: 'pp_popup:joined',
    pending: 'pp_popup:pending',
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
  let variant = null;
  let colour = null;
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
    const m = location.search.match(/[?&]pp_popup=([abc])\b/i);
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
    try { if (typeof window.gtag === 'function') window.gtag('event', name, params); } catch (e) { /* ignore */ }
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

  function formHTML() {
    return `<form class="ppp__form" novalidate>
        <label class="ppp__sr" for="ppp-email">Email address</label>
        <input id="ppp-email" class="ppp__input" type="email" name="email" autocomplete="email"
          inputmode="email" placeholder="${esc(C.placeholder || 'your@email.com')}" required>
        <button class="ppp__btn" type="submit">${esc(C.button || 'Join the list')}</button>
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
  };

  /* ---------- open / close ---------- */

  function viewportWidth() {
    return mount === document.body ? window.innerWidth : mount.clientWidth;
  }
  function fit() {
    if (root) root.classList.toggle('ppp--compact', viewportWidth() < 640);
  }

  function open(v, opts) {
    opts = opts || {};
    if (!TEMPLATES[v]) return;
    if (root) close(null);
    variant = v;
    colour = null;
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
    }
    document.dispatchEvent(new CustomEvent('pp-popup-closed'));
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
      const t = e.target.closest('[data-close],[data-colour],[data-back],[data-copy]');
      if (!t) return;
      if (t.dataset.close) close(t.dataset.close);
      else if (t.dataset.colour) pickColour(t.dataset.colour, t.dataset.name, t.style.getPropertyValue('--sw'));
      else if (t.hasAttribute('data-back')) stepTo('pick');
      else if (t.dataset.copy) copyCode(t);
    });
    const form = el.querySelector('.ppp__form');
    if (form) form.addEventListener('submit', onSubmit);
  }

  function stepTo(step) {
    root.querySelectorAll('.ppp-c__step').forEach((s) => { s.hidden = s.dataset.step !== step; });
    const focusEl = step === 'form' ? root.querySelector('.ppp-c__title2') : root.querySelector('.ppp-c__sw');
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  function pickColour(id, name, hex) {
    colour = id;
    const card = root.querySelector('.ppp-c');
    const chip = root.querySelector('.ppp-c__chosen');
    card.style.setProperty('--pick', hex || 'transparent');
    card.classList.toggle('ppp-c--all', id === 'all');
    chip.querySelector('span').textContent = name;
    const headline = id === 'all'
      ? (C.headlineCAll || 'Can’t pick just one? Fair.')
      : String(C.headlineC2 || 'Good pick. [colour] it is.').replace(/\[colou?r\]/gi, name);
    root.querySelector('.ppp-c__title2').textContent = headline;
    track('popup_colour', { popup_colour: id });
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
    if (colour) tags.push('colour-' + colour);
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
    store.set(K.pending, JSON.stringify({ v: variant, c: colour || 'none' }));
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
      if (persist) store.set(K.joined, '1');
      track('popup_signup', { popup_colour: colour || 'none' });
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

  function blocked() {
    if (C.suppress) return true;
    if (store.get(K.joined)) return true;
    const until = Number(store.get(K.closedUntil) || 0);
    return until > Date.now();
  }

  function arm(v) {
    let fired = false;
    const timers = [];
    const fire = (trigger) => {
      if (fired || root) return;
      fired = true;
      timers.forEach(clearTimeout);
      open(v, { trigger });
    };

    const delay = Number(C.delay) || 0;
    if (delay > 0) timers.push(setTimeout(() => fire('delay'), delay * 1000));

    const scrollPct = Number(C.scroll) || 0;
    if (scrollPct > 0) {
      listen(window, 'scroll', () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0 && (window.scrollY / max) * 100 >= scrollPct) fire('scroll');
      }, { passive: true });
    }

    if (C.exitIntent && window.matchMedia('(pointer: fine)').matches) {
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
    if (mount !== document.body && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(fit);
      ro.observe(mount);
      cleanups.push(() => ro.disconnect());
    }

    window.PocketPopup = {
      open: (v, opts) => open(String(v).toUpperCase(), opts || { trigger: 'manual' }),
      close: () => close('api'),
      variant: () => variant,
      assign,
      config: C,
      reset() { Object.values(K).forEach(store.del); },
      destroy() {
        cleanups.splice(0).forEach((fn) => fn());
        if (root) { root.remove(); root = null; }
        document.documentElement.classList.remove('ppp-lock');
      },
    };

    if (C.preview || C.enabled === false) return;

    if (C.designMode) {
      open(C.editorVariant || 'A', { silent: true });
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
        track('popup_signup', { popup_colour: p.c || 'none' });
      }
      return;
    }

    const forced = forcedVariant();
    if (forced) { open(forced, { trigger: 'url' }); return; }
    if (blocked()) return;
    const v = assign();
    if (v) arm(v);
  }

  boot();
})();
