# MovieList

A student movie tracking prototype built with HTML, CSS and vanilla JavaScript. Discover popular and weekly trending films, search TMDB, open film details, and keep a personal watched collection and watchlist. Netlify runs a small serverless proxy so the TMDB credential never enters frontend code.

## Configure TMDB privately

1. Create a TMDB account and request API access from [Settings → API](https://www.themoviedb.org/settings/api). Follow TMDB's registration requirements.
2. Find your **API Read Access Token** (the bearer token, not the shorter API key).
3. Copy `.env.example` to `.env` in this project. Replace the placeholder **in your local editor**:
   ```dotenv
   TMDB_READ_TOKEN=your_actual_read_access_token
   ```
4. Never paste the token into chat, JavaScript, HTML, `netlify.toml`, GitHub, screenshots or your demo recording. `.env` is ignored by Git. Only `.env.example`, containing a placeholder, should be committed.

The server reads `process.env.TMDB_READ_TOKEN`; the browser calls `/.netlify/functions/tmdb`. Only approved popular, trending, search, details and genre routes are allowed. Authentication headers and raw upstream errors are never returned to the browser. Posters load directly from TMDB's public image CDN without credentials.

## Local setup with Netlify Dev

Install Node.js 22 or newer and the [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/):

```sh
npm install --global netlify-cli
npm run dev
```

Open **http://localhost:8888** (or the URL Netlify prints). Netlify Dev reads the local `.env` file and runs the functions. Restart after changing the token. `npm run dev` first copies the seven public assets to `dist`; after editing frontend files, restart this command to refresh that copy. There are no frontend packages to install and no bundler.

Double-clicking `index.html`, using a plain static server, or using GitHub Pages cannot run the proxy. Without configuration, the collection still works and Discover shows an actionable setup error with a retry button. A working catalog needs the token, Netlify functions and internet access.

## Deploy on Netlify

1. Push this source repository to GitHub, checking that `.env` is excluded (`git check-ignore .env`).
2. In Netlify, import that repository. The included `netlify.toml` sets:
   - Build command: `node build.cjs`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
3. In the site's environment variable settings, add **TMDB_READ_TOKEN** with your Read Access Token. Make it available to **Functions** (or all scopes), and to the deployment contexts you use. Do not put its value in `netlify.toml`.
4. Deploy or redeploy after adding/changing the variable. Test search and movie details on the deployed URL.

`build.cjs` copies only `index.html`, `watched.html`, `watchlist.html`, `stats.html`, `style.css`, `script.js` and `collection.js` to `dist`. Server code, `.env`, tests and configuration stay outside the published directory. Deploy through the repository/Netlify build or the CLI with functions; uploading only the static folder does not include the API proxy. This change does not publish the site automatically.

## Pages and navigation

- **Discover (`index.html`)**: popular and trending TMDB films, catalog search, details and collection actions. Personal collection grids live on their own pages.
- **Watched (`watched.html`)**: watched films and editable personal ratings, title search, and sorting by saved order, title, rating or release year. Choose and order your Top 4 favorite films. Move films to Watchlist or remove them.
- **Watchlist (`watchlist.html`)**: saved films to watch, title search, removal, marking films watched and a random movie picker.
- **Stats (`stats.html`)**: personal collection totals, genre and rating charts, highest-rated films and release decades.

All four pages share the same responsive navigation, active page indicator, details dialog, collection statistics and dark design. Each reads the existing `movielist-v2` key on the same origin. Open tabs refresh on storage changes; restored pages reload saved data. Navigation never resets the collection. Legacy TMDB linking opens a matching catalog search on the collection page when requested.

## Usage

- Submit the global search to search TMDB's catalog. Clear it or select Popular/Trending to return to Discover. Load more fetches the next page; the app caps requests at TMDB's 500-page limit.
- Click a poster or title for its synopsis, genres, status and personal rating. Close with the button or Escape.
- Both status buttons start as neutral outlines. Selected **Watched** is filled green with a checkmark; selected **In Watchlist** is filled blue with a bookmark. Click the selected button again to remove the status, or click the other button to move the film.
- A film can occupy only one collection. Selecting another state moves it by TMDB ID; clicking the selected status removes it.
- Rate using five stars: the left/right half of each star selects a half/full star. Tab enters the rating group; arrow keys change by half a star, Home/End select 0.5/5, and Delete/Backspace or Clear removes the rating. Touch users can tap either half. Hover previews the fill without saving.
- Ratings are optional, from 0.5–5 stars, and available only for watched films. Moving a film out of Watched clears its rating. Moving it back starts unrated. TMDB popularity scores are never used as personal ratings.
- The separate personal filter searches saved film titles, including when the catalog is unavailable.
- Missing or failed poster images display a text fallback. Full details have their own retry action.

Status and rating updates reuse existing cards and detail controls to preserve focus. Rating space is reserved, notifications float outside the page layout, and a stable scrollbar gutter avoids shifts when details open. Removing cards reserves the current grid height until a search/sort or navigation, keeping the viewport from collapsing near the bottom. Rating sorts reorder immediately while retaining the viewport position. The details dialog stays open during updates. Reduced-motion preferences are respected.

## Personal Statistics

Open **Stats** in the navigation for statistics calculated from your actual localStorage collection. There are no example films or sample totals.

- **Overview:** watched and watchlist totals, the number of rated films, and the average personal rating. Only valid personal ratings from 0.5 to 5 in half-star steps enter the average. An unrated collection displays **—**, rather than a made-up average.
- **Genres:** watched films contribute once to each saved TMDB genre. Multi-genre films contribute to more than one bar, so genre counts can exceed the watched total. The chart explains how many films are missing genre metadata. Open their existing movie details or link legacy films from Watched to enrich metadata.
- **Ratings:** all ten half-star bins are shown once you have ratings, including zero-count bins. Watchlist entries and unrated films are excluded. The average is rounded to one decimal place for display.
- **Highest-rated films:** up to eight watched films, sorted by personal rating (title breaks ties), with real saved posters, ratings and existing detail/status/favorite controls.
- **Release decades:** groups watched films by saved release year. Missing or invalid years are excluded and counted in a note. This is release-era information, not viewing dates.

The page works offline with saved metadata and makes no catalog requests on load. Opening movie details still uses the existing TMDB proxy. Statistics update after local status/rating changes, changes in another open tab, and restored-page navigation. Visiting Stats never writes to or resets your collection. Charts use vanilla JavaScript and CSS, with visible labels/counts, semantic lists and a screen-reader update announcement. Empty collections, missing metadata and unrated films have dedicated explanations.

The design pass preserves the dark cinema theme while refining navigation, typography, card spacing, two-line movie titles, fixed poster ratios and consistent control sizes. Loading feedback has a reserved space; interaction updates reuse existing cards and preserve viewport position. Reduced-motion preferences disable decorative motion.

## Favorite Movies — My Top 4

Select **♡ Add to Favorites** on any watched movie card or its details. The selected **♥ In Favorites** button removes it with one click. Favorites are optional: a new or existing collection starts with none unless you choose them.

Your four ordered poster slots appear at the top of Watched, independent of title/genre filters. Click a poster or title to open the existing details dialog. Use the labeled **← / →** buttons to reorder, including with a keyboard or on mobile. Remove a favorite with its heart button. If all four slots are filled, adding another opens a chooser to replace one favorite in its current position. Cancel keeps your Top 4 unchanged.

Only watched films can be favorites. Removing a film from Watched or moving it to Watchlist removes its favorite reference automatically. Returning it to Watched does not automatically favorite it again. Favorite actions do not change ratings. Legacy entries retain favorites when explicitly linked to TMDB, with poster fallbacks until linking supplies a real poster.

## What Should I Watch?

On Watchlist, click **What Should I Watch?** for a random film from your entire saved watchlist. The picker shows its saved TMDB poster, title, release year and synopsis. **Pick Another** avoids the last pick when more than one film is available; a single remaining film can be picked again. Search and genre filters affect the collection grid but do not restrict this draw.

**Movie details** opens the existing TMDB details dialog. **Mark as Watched** moves the selected film out of Watchlist into Watched, initially unrated, and clears the current pick. You can also manage its status in details or a normal card. Open tabs stay synchronized, and a pick removed elsewhere stops being actionable. An empty watchlist shows a prompt to add films on Discover.

The draw uses local data and adds no API requests or keys. Saved metadata remains usable offline; opening full details uses the existing TMDB integration. The current random pick is temporary and resets on navigation/reload. Favorite order is persistent. Both features reserve their display space and preserve viewport position during collection changes; existing movie cards and controls are reused.

## Genre filtering

Every page offers a **Genre** dropdown with All Genres and TMDB's movie genres, including Action, Comedy, Drama, Horror, Thriller, Science Fiction, Romance, Animation and Adventure. The genre list refreshes from TMDB; its standard taxonomy is available as an offline fallback.

- Discover Popular uses TMDB's [Discover endpoint](https://developer.themoviedb.org/reference/discover-movie) with `with_genres`, popularity sorting and server pagination. All Genres restores the original Popular route.
- Search and Trending preserve their original TMDB ordering and filter each fetched page using real genre IDs. A page may have no matches; Load more stays available while more pages remain. Changing genre resets pagination and cancels stale requests. Search text and the selected category are retained.
- Watched and Watchlist combine genre with title search and existing sorting. Multi-genre films match every applicable genre. Saved entries without genre metadata remain under All Genres; opening TMDB details or explicitly linking a legacy entry enriches their genres. No genres are guessed from titles.

## Data preservation

A new browser starts with **empty personal collections**, with no default watched films or ratings. Existing stored entries, including starter films saved by an older version, are retained because the app cannot reliably distinguish them from your choices. Remove any you do not want.

The new `movielist-v2` localStorage key stores TMDB IDs, titles, release years, poster paths, synopsis, genres, status (via collection membership) and personal ratings. An optional ordered `favorites` array in the same record stores up to four references to watched movies, without duplicating metadata. Older records without it load with no favorites. Existing `movielist-v1` and original `movies` data are read when v2 does not exist; those old keys are never deleted. Previously saved ratings are retained. Conflicting duplicate entries prefer Watched.

Older manual entries have no verified TMDB ID. They stay visible with a poster fallback. Select **Find in TMDB**, then **Link this film** on the correct result to preserve the old status/rating and add the real metadata. Linking is explicit so remakes or unrelated titles are not silently merged. If the same TMDB film is already saved, entries merge with Watched taking priority; an existing nonzero watched rating takes priority.

localStorage belongs to a browser **and origin**: a file URL, localhost and a deployed URL do not share data. The entire JSON Import/Export interface has been removed. Existing localStorage records are still read and saved normally; no data is reset or deleted. The previous change removed Export but left Import markup in all three source pages, along with its JavaScript handler and CSS. Since the build copies source assets into `dist`, rebuilding reproduced that remaining interface. Both source and generated assets are now checked by regression tests.

If saved JSON is unreadable, the app leaves it untouched and keeps new changes temporary; fix/restore browser data and reload before saving again. If writing fails, a visible warning explains that changes may be lost. This is a single-browser prototype without accounts or cloud sync.

## Tests and demo checklist

```sh
npm test
```

Tests cover empty defaults, ID deduplication and state moves, clearing ratings outside Watched, optional half-star ratings, saved metadata round trips, old data migration, explicit linking, malformed data, proxy input validation, missing configuration, server-only authorization and sanitized upstream failures. No real token is used by tests.

Automated frontend tests use a simulated DOM and mocked TMDB responses. They cover navigation targets and active states, initialization on all three pages, isolated collection grids, sorting, filtering, status moves, ratings, reload persistence, storage events, legacy linking, details, search races and API errors. Genre tests cover multi-genre matches, combined search/sorting, pagination resets, empty-page continuation, category changes and proxy genre validation. Regression tests rebuild twice and check all source and generated pages, scripts and styles for Import/Export UI remnants. They also verify existing data survives initialization and restored-page refreshes. Interaction regressions also cover all ten half-star values, clearing ratings, keyboard changes, one-click status toggles, stable card/control identity, dialog continuity and scroll restoration. Favorites and picker tests additionally cover watched-only selection, limits, replacement, ordering, removal, reloads, cross-tab updates, legacy linking, existing-data preservation, empty/single watchlists, non-repeating picks and moving a pick into Watched. Statistics tests cover empty/unrated collections, missing metadata, multi-genre counts, every half-star bin, averages, top-film ordering, decades, non-mutating calculations and live updates across tabs. Navigation and the no-Import/Export regression checks include Stats. The build includes all seven public assets. Live authenticated TMDB responses and a deployed Netlify instance require a configured token and a manual browser check.

Before recording your demo:

1. Configure the token; check that popular and trending films have real posters and Load more appends results.
2. Search for a title; check results, a query with no matches and clearing the search. Switch categories rapidly to check stale results do not replace the latest request.
3. Open a movie and verify title, year, synopsis and genres. Add it to Watchlist (blue), move it to Watched (green), and rate it 3.5. Navigate to Watched and verify the film and its rating. Open Watchlist and verify it is absent.
4. Refresh: the same movie and rating should remain. Repeatedly press the same status button; no duplicate should appear.
5. Move it to Watchlist: rating should disappear. Remove it: Not added should appear. Refresh again to verify removal.
6. Search each collection, test every Watched sort option, and link an old manual entry. Open a second tab and verify status/rating changes appear there.
7. Add four favorites, replace one, reorder them with arrows, refresh, and verify their order and ratings. Move a favorite to Watchlist and confirm it leaves Top 4.
8. Pick a random watchlist film, try Pick Another, open details, and mark it watched. Check empty and single-film watchlists.
9. Open Stats and compare totals with Watched/Watchlist. Rate a film, move one to Watchlist, and verify averages, genres and chart counts update, including in another tab. Check empty and unrated states.
10. Check keyboard focus, Escape to close details, mobile widths, image fallbacks, and retry behavior with offline mode or an absent token.

## Credits

Movie data and posters are provided by [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. An official TMDB logo and the required notice appear in the app's About & credits section. See [TMDB attribution requirements](https://developer.themoviedb.org/docs/faq).
