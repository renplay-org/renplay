// The app's browser checks: its lists and pages, the Up next carousel and the search, against the built library (npm run build
// in selector/ first) and a made-up API. The checks are in app-ui/, each file runnable on its own, with what they share in
// app-ui/lib.mjs, and run here a few at a time.
//
//   node scripts/check-app-ui.mjs [--base http://localhost:5199] [--webkit] [--only name,name] [--jobs 4]
//
// --webkit adds the phone checks in WebKit. Needs the browsers once: npx playwright install chromium webkit
import * as app from './app-ui/app.mjs'
import * as blink from './app-ui/blink.mjs'
import * as carousel from './app-ui/carousel.mjs'
import * as landing from './app-ui/landing.mjs'
import * as scroll from './app-ui/scroll.mjs'
import * as search from './app-ui/search.mjs'
import * as typing from './app-ui/typing.mjs'
import { main } from './app-ui/lib.mjs'

await main([app, blink, carousel, landing, scroll, search, typing])
