# Application fonts

Manrope (weights 300–400) and Plus Jakarta Sans (weights 400–700) are served
with the application without depending on access to Google Fonts, in accordance with its
same-origin Content Security Policy. `index.css` preserves all original Unicode subsets
and uses `font-display: swap`. Font URLs use Vite’s `?no-inline` flag
to keep small subsets as same-origin files rather than blocked data URLs.

The WOFF2 files and Unicode ranges come from the Google Fonts CSS API:
https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..700&family=Manrope:wght@300..400&display=swap

Both families are licensed under the SIL Open Font License 1.1; their original
copyright notices and licenses are included in this directory. Upstream sources:

- https://github.com/google/fonts/tree/main/ofl/manrope
- https://github.com/google/fonts/tree/main/ofl/plusjakartasans
