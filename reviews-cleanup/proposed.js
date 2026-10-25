// Markup tweaks the proposal needs (would be made in the section's Liquid / JS)
(() => {
  const root = document.querySelector('.pocket-reviews');

  // Hero: replace the 3 stat tiles with one rating line
  const stats = root.querySelector('.pr-stats');
  const rating = document.createElement('p');
  rating.className = 'pr-rating';
  rating.innerHTML = '<span class="pr-stars" aria-hidden="true">★★★★★</span><span><b>4.9</b> from 1,600+ happy homes</span>';
  stats.replaceWith(rating);

  // Lamp cards: "★ 5.0 · 9 reviews" as one plain line
  root.querySelectorAll('.pr-lamp').forEach((lamp) => {
    const meta = lamp.querySelector('.pr-lamp__meta');
    const score = meta.querySelector('.card-rating-badge').textContent.replace('★', '').trim();
    const count = meta.querySelector('.caption-with-letter-spacing').textContent.trim();
    meta.innerHTML = `<span class="pr-lamp__rate"><b>★</b> ${score} <span>· ${count}</span></span>`;
  });

  // Chips: drop the emoji
  root.querySelectorAll('.pr-chip').forEach((chip) => {
    const t = chip.firstChild;
    if (t && t.nodeType === 3) t.textContent = t.textContent.replace(/^[^A-Za-z]+/, '') + ' ';
  });

  // Promises move under the final button
  const cta = root.querySelector('.pr-cta');
  const p = document.createElement('p');
  p.className = 'pr-promises';
  p.textContent = 'made to order in melbourne · free postage over $150 · 30-day returns';
  cta.appendChild(p);

  // Bottom bar text
  const dock = root.querySelector('.pr-dock__text');
  if (dock) dock.innerHTML = '<b>4.9★</b> · 1,600+ homes';
})();
