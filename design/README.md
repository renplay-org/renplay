# Lamplight

Renplay's design language, on one page. The tokens are in `tokens.css`, the fonts in `fonts.css` and `fonts/`, the mark
in `logo/`, and `grain.webp` is the soft-light tile for paper. The app, the demo, the docs and the website take all of
these from here and nowhere else.

| Consumer | How it takes them |
|---|---|
| The library (`selector/`) | `src/index.css` imports `fonts.css` and `tokens.css`. Vite emits the fonts as hashed files, and the Dockerfile copies this folder into the build |
| The demo | It is the library with `RENPLAY_DEMO` on, so it needs nothing of its own |
| The docs (`docs/site/`) | `astro.config.mjs` lists both files first in `customCss`, and `src/styles/renplay.css` maps Starlight's variables to the tokens |
| The website (`website/`) | `build.mjs` copies `tokens.css`, `fonts.css`, `fonts/` and `grain.webp` into `/design/` of each site, and every page links the two stylesheets before `site.css` |
| The game page (`runtime/`) | It loads no file from here. A colour it paints is a literal with its token's name in a comment |

The art is the light, ink is the room, and the person holds a lamp.

## The rules

- **Everything that is a colour, a face, a corner or a duration is a token.** `node scripts/check-design.mjs` fails on a
  literal anywhere else, and counts what is allowed for now in the file. White and black at any alpha, `transparent` and
  `currentColor` are fine.
- **Three faces, one job each.** Fraunces (`--serif`) for a title and the story voice, Inter (`--sans`) for everything
  used, JetBrains Mono (`--mono`) for a label or a small fact. A title that is a sentence ends with a full stop, a title
  that is a name does not. Labels are sentence case, never uppercase.
- **One lit control per screen.** The thing to do next is paper (`--paper`, `--on-paper`), flat, no shadow. Everything
  else is a hairline (`--hair`) or quiet text.
- **The brand gradient has three homes.** The logo, the avatar without a picture, and the room's glow. Never on a
  control, never behind text.
- **Four corners.** `--r-1` (4 px) for a control, `--r-2` (8) for a row, `--r-3` (12) for a plate or a tile, `--r-4`
  (16) for a sheet. `--r-round` for a dot, an avatar, a switch, a bar. No pills on buttons.
- **Three surfaces.** A plate sits on the room, glass floats over art, paper is the lit control. A plate has no border.
- **Status colours are words.** `--green`, `--amber` and `--red` colour a word, an icon or a dot, never a surface.
- **The lamp is a few pixels.** `--lamp` is the dot before a label, a caret, the fill of a progress bar. Never a surface.
- **Focus is `--ring`** with the tint's glow, the same for the keyboard and the controller, everywhere.
- **Motion settles.** `--out` for what arrives, `--inout` for a crossfade, the five durations and nothing longer.
  Reduced motion zeroes them.
- **Covers are the developers' art**, never cropped into a shape, never recoloured, never under grain. At Blurred they
  are blurred and nothing else.
- **The app is still under the hand, but for a game's tile.** The light follows the pointer on the website, the docs
  home, the sign-in page and the empty library. A tile is the website's shelf card: a border and a sheen in the game's
  colour, and under the hand or the focus a lean toward the pointer, a lift and the colour's long shadow. A press leans
  it on a touch screen. Reduced motion keeps the colour and drops the lean and the lift. Nothing else moves under the hand.
- **Density, touch and speed are not the language's to change.** Sizes and spaces (`--s1` to `--s6`, `--hit`), the
  44 px hit area, the adult blur and the game page's weight stay as they are.

## The words

Renplay's writing rule applies (`AGENTS.md`). A title says what the screen is, a button is a verb, a label is a noun,
and the story voice speaks to the reader in the second person only where there is nothing to use yet.

## Changing it

A new token goes in `tokens.css` with its job in a comment. A new face does not happen. A new colour needs a job no
token does, which has not happened since the website. The icons are written from `logo/mark.svg` by
`node design/build.mjs`, never edited by hand. Give it a folder to try it out without touching the repository's own icons.
