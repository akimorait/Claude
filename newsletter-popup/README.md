# Pocket newsletter popup (with A/B test)

A new email sign-up popup for pocketpickedit.com, in three designs that can be
tested against each other.

| Design | What it looks like |
| --- | --- |
| **A · Pocket Pop** | Centred card with the cream scrolling strip, the four logo dots and the orange halo button. |
| **B · Lights On** | Split card. A lamp photo flickers on as it opens, next to a cream panel. |
| **C · Colour Pick** | Small corner card (bottom sheet on phones) that asks for a favourite colour, then the email. |

Open `preview.html` in a browser to click through all three.

## What gets installed

One file: `pocket-newsletter-popup.liquid`. It's a theme section, so every
setting (words, discount code, test shares, timing, photo) can be changed in
**Online Store → Themes → Customize** without touching code.

## Installing

1. Online Store → Themes → on your current theme, **⋯ → Duplicate** (work on the copy).
2. On the copy: **⋯ → Edit code → sections → Add a new section**, name it
   `pocket-newsletter-popup`, replace the contents with this file's contents, Save.
3. **Customize** the copy → **Footer → Add section → Newsletter popup**.
4. Preview it. To see one design directly, add `?pp_popup=A` (or `B`, `C`) to any page address.
5. Switch off the old Shopify Forms popup (Apps → Shopify Forms) so visitors don't get two.
6. Publish the copy.

## How the A/B test works

- **Who sees what.** Each new visitor is randomly given A, B or C using the
  shares in the settings (34 / 33 / 33 by default). They keep the same design on
  every visit.
- **What's counted.** Views, closes and sign-ups are sent to Google Analytics as
  `popup_view`, `popup_close`, `popup_signup` (and `popup_colour` for C), each
  with `popup_variant` = A, B or C.
- **Who signed up.** Every subscriber is tagged in Shopify: `newsletter`,
  `popup-A` / `popup-B` / `popup-C`, the test name, plus `customer-code` (same
  tag as your current form). Design C also adds `colour-lemon`, `colour-candy`, etc.
- **The thank-you screen** shows your code `POCKET3141` ($10 off orders over
  $100) with a copy button.

### Reading the results

- **Quickest:** Shopify → Customers → filter by tag `popup-A`, then `popup-B`,
  then `popup-C`. Most sign-ups wins (the visitor split is even).
- **Fairer:** in Google Analytics, sign-up rate = `popup_signup` ÷ `popup_view`
  for each design. One-time setup: Admin → Custom definitions → add
  `popup_variant` as an event-scoped dimension.
- Give it 2–4 weeks, or about 100 sign-ups per design, before calling it.
- **When you have a winner:** set the other two shares to 0. To test something new
  (e.g. two headlines), change the **Test name** so everyone is shuffled again.

### Who never sees it

People who already signed up, anyone who closed it in the last 14 days (adjustable),
logged-in customers already subscribed, and the cart and account pages.

## For developers

Source lives in `src/` (`popup.css`, `popup.js`, `section.liquid`,
`preview.html`). Run `python3 build.py` to regenerate the `.liquid` file and
`preview.html`. Sign-ups post to Shopify's `/contact` customer form in the
background; if Shopify asks for a captcha it falls back to a normal form post and
shows the thank-you after the reload.
