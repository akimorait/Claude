# Reviews page clean-up (proposal)

A tidier version of pocketpickedit.com/pages/reviews, mainly for phones.
Nothing here is installed yet.

| Part of the page | Change |
| --- | --- |
| Top | One rating line replaces the label and the three number boxes. Review card sits straight. |
| Most-loved lamps | Cards show photo, name, rating and price only. |
| Orange scrolling strip | Removed. Its three promises move under the last button. |
| What people love | On phones: one list, small photo left, words right. Topic buttons lose the emoji. |
| In your homes | Removed (it repeated the photos above). |
| Bottom bar | Shorter text, stays on one line. |

Result: about 33% less scrolling on phones, 26% on computers.

## Files

- `proposed.css` — style changes, to add to the end of the theme's `pocket-reviews.css`.
- `proposed.js` — the small wording/markup changes; when installing, these go into the
  reviews section's Liquid file instead of running as a script.
