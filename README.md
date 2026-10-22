# MovieList

A student movie tracking prototype built with HTML, CSS and vanilla JavaScript. Discover acclaimed films across all eras and weekly trending films, search TMDB, open film details, and keep a personal watched collection and watchlist. Netlify runs a small serverless proxy so the TMDB credential never enters frontend code.

## Configure TMDB privately

1. Create a TMDB account and request API access from [Settings → API](https://www.themoviedb.org/settings/api). Follow TMDB's registration requirements.
2. Find your **API Read Access Token** (the bearer token, not the shorter API key).
3. Copy `.env.example` to `.env` in this project. Replace the placeholder **in your local editor**:
   ```dotenv
   TMDB_READ_TOKEN=your_actual_read_access_token
   ```
4. Never paste the token into chat, JavaScript, HTML, `netlify.toml`, GitHub, screenshots or your demo recording. `.env` is ignored by Git. Only `.env.example`, containing a placeholder, should be committed.

The server reads `process.env.TMDB_READ_TOKEN`; the browser calls `/.netlify/functions/tmdb`. Only approved popular, trending, search, details, genre, Discover, recommendations and similar-movie routes are allowed. Authentication headers and raw upstream errors are never returned to the browser. Posters load directly from TMDB's public image CDN without credentials.

## Local setup with Netlify Dev

Install Node.js 22 or newer and the [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/):

```sh
npm install --global netlify-cli
npm run dev
```

Open **http://localhost:8888** (or the URL Netlify prints). Netlify Dev reads the local `.env` file and runs the functions. Restart after changing the token. `npm run dev` first copies the nine public assets to `dist`; after editing frontend files, restart this command to refresh that copy. There are no frontend packages to install and no bundler.

Double-clicking `index.html`, using a plain static server, or using GitHub Pages cannot run the proxy. Without configuration, the collection still works and Discover shows an actionable setup error with a retry button. A working catalog needs the token, Netlify functions and internet access.

## Deploy on Netlify

1. Push this source repository to GitHub, checking that `.env` is excluded (`git check-ignore .env`).
2. In Netlify, import that repository. The included `netlify.toml` sets:
   - Build command: `node build.cjs`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
3. In the site's environment variable settings, add **TMDB_READ_TOKEN** with your Read Access Token. Make it available to **Functions** (or all scopes), and to the deployment contexts you use. Do not put its value in `netlify.toml`.
4. Deploy or redeploy after adding/changing the variable. Test search and movie details on the deployed URL.

`build.cjs` copies only `index.html`, `watched.html`, `watchlist.html`, `stats.html`, `recommendations.html`, `style.css`, `script.js`, `collection.js` and `recommendations.js` to `dist`. Server code, `.env`, tests and configuration stay outside the published directory. Deploy through the repository/Netlify build or the CLI with functions; uploading only the static folder does not include the API proxy. This change does not publish the site automatically.

## Pages and navigation

- **Discover (`index.html`)**: all-era TMDB browsing with release-period and sorting filters, trending films, catalog search, details and collection actions. Personal collection grids live on their own pages.
- **Watched (`watched.html`)**: watched films and editable personal ratings, title search, and sorting by saved order, title, rating or release year. Choose and order your Top 4 favorite films. Move films to Watchlist or remove them.
- **Watchlist (`watchlist.html`)**: saved films to watch, title search, removal, marking films watched and a random movie picker.
- **Stats (`stats.html`)**: personal collection totals, genre and rating charts, highest-rated films and release decades.
- **For You (`recommendations.html`)**: recommendations explained by your high ratings, Top 4 favorites and optional genre preferences.

All five pages share the same responsive navigation, active page indicator, details dialog, collection statistics and dark design. Each reads the existing `movielist-v2` key on the same origin. Open tabs refresh on storage changes; restored pages reload saved data. Navigation never resets the collection. Legacy TMDB linking opens a matching catalog search on the collection page when requested.

## Usage

- Submit the global search to search TMDB's catalog. Clear it or select Browse all eras/Trending to return to browsing. Load more fetches the next page; the app caps requests at TMDB's 500-page limit.
- Click a poster or title for its synopsis, genres, status and personal rating. Close with the button or Escape.
- Both status buttons start as neutral outlines. Selected **Watched** is filled green with a checkmark; selected **In Watchlist** is filled blue with a bookmark. Click the selected button again to remove the status, or click the other button to move the film.
- A film can occupy only one collection. Selecting another state moves it by TMDB ID; clicking the selected status removes it.
- Rate using five stars: the left/right half of each star selects a half/full star. Tab enters the rating group; arrow keys change by half a star, Home/End select 0.5/5, and Delete/Backspace or Clear removes the rating. Touch users can tap either half. Hover previews the fill without saving.
- Ratings are optional, from 0.5–5 stars, and available only for watched films. Moving a film out of Watched clears its rating. Moving it back starts unrated. TMDB popularity scores are never used as personal ratings.
- The separate personal filter searches saved film titles, including when the catalog is unavailable.
- Missing or failed poster images display a text fallback. Full details have their own retry action.

Status and rating updates reuse existing cards and detail controls to preserve focus. Rating space is reserved using its real content, notifications float outside the page layout, and a stable scrollbar gutter avoids shifts when details open. Removing cards reserves the current grid height until a search/sort or navigation, keeping the viewport from collapsing near the bottom. Rating sorts reorder immediately while retaining the viewport position. The details dialog stays open during updates. Reduced-motion preferences are respected.

## Stable movie-card layout

Status, rating and favorite controls keep the same intrinsic space in every state. Their labels share a grid cell with hidden, accessibility-excluded copies of all possible labels, so switching between Watchlist/In Watchlist, Add to Favorites/In Favorites, or rating values cannot change wrapping height. The sizing copies are always in flow, including for currently unavailable watched-only controls.

Rating sections size naturally instead of relying on fixed 93/100px heights. Card bodies no longer use flex growth and automatic control margins to redistribute changing content height, and movie-grid items align at the start instead of stretching all peers to a changing row height. Posters still use the same 2:3 ratio. Status buttons choose one or two columns based on available room, retain unwrapped labels, and stack on mobile. Overflow is clipped on posters rather than on the whole card, so controls remain visible. Existing title/description previews and overall card styling are preserved.

`npm test` includes a real headless Chrome/Chromium layout regression when a supported browser is installed (otherwise that test is skipped). It uses an isolated temporary browser profile and mocked movie data, never your normal browser profile or stored collection. At 320, 375, 768 and 1280px it checks card and poster dimensions, control positions, peer heights, button overflow and scroll position through status moves, favorites, all half-star values and clearing. The original 320px control-position regression was reproduced before applying the fix. Restricted execution environments may need permission to launch browser subprocesses; no browser sandbox is disabled.

## Discover across the decades

Discover defaults to **All years + Most Popular**, using TMDB’s [Discover API](https://developer.themoviedb.org/reference/discover-movie). Choose **Highest Rated** for widely appreciated films with at least **1,000 votes**. Release-period controls still let you explore older eras deliberately, and **Trending this week** stays separate.

Choose **All years**, **2020s**, **2010s**, **2000s**, **1990s**, **1980s**, **1970s**, or **Before 1970**. Decades use inclusive calendar boundaries, such as 1980-01-01 through 1989-12-31. Before 1970 sets an upper date of 1969-12-31. **Specific year / custom range** reveals start/end inputs and Apply years; enter the same year in both fields for a single year. Supported years are 1800–2100. Invalid or inverted ranges show guidance without making a request.

Browse sorting offers only the three options below. Empty, obsolete or unrecognized frontend selections fall back to Most Popular, including browser-restored selections. Sorting is not stored in the collection’s localStorage record. The proxy rejects unsupported sort parameters.

Browse sorting maps to these TMDB parameters:

| Sort by | TMDB sort |
| --- | --- |
| Most Popular | `popularity.desc` |
| Highest Rated | `vote_average.desc`, with `vote_count.gte=1000` |
| Most Reviewed | `vote_count.desc` (number of user votes, not written review count) |

Genre, release period and sort combine in each server-side Discover request, using `with_genres`, `primary_release_date.gte` and `primary_release_date.lte`. All years removes the date limits. Filters reset pagination to page 1, cancel superseded requests and preserve their parameters on Load more. Duplicate TMDB IDs and late responses are discarded. The proxy validates year formats/bounds, range order and an explicit sort allowlist before contacting TMDB. The 1,000-vote floor applies only to Highest rated browsing, leaving other sorts available for less-reviewed older films.

Title search is preserved. [TMDB Search](https://developer.themoviedb.org/reference/search-movie) and Trending do not expose Discover's full sort/range options. They retain TMDB relevance/weekly order, with Sort by disabled while those categories are active; returning to Browse restores your sort selection. The proxy applies genre and year filters to **every fetched Search/Trending page**, and exact-year searches also pass `primary_release_year` upstream. Pagination counts remain those of the upstream search/trending feed: a page can contain no matches while Load more remains available. The interface explains this rather than implying a globally sorted search result. Normal Browse date/genre filtering and ordering happen directly in TMDB's Discover endpoint.

## Undo collection actions

After adding, removing or moving a film between Watched and Watchlist, a notification offers **Undo** and **Dismiss**. Undo restores that movie's previous status, personal rating, collection position and Top 4 slot. A Random Picker move is reversible too, restoring its selected film. Movie details have an **Undo last action** button so the dialog can stay open.

Undo is a single action, available until the next status/feedback action, dismissal or navigation; it does not expire on a timer. It reverses only the affected film, preserving unrelated edits. If that movie was subsequently changed, or restoring its favorite would displace a newer Top 4 choice, Undo safely declines instead of overwriting the newer state. External storage updates invalidate the current Undo. Undo history is temporary; collection changes and their reversals use normal localStorage persistence. Rating edits and direct Top 4 reordering are not themselves added to this status Undo history.

## For You — personalized recommendations

The **For You** navigation link opens a poster-led recommendation grid with film titles, release years, short synopses, a reason for each recommendation, and the existing Watched/Watchlist buttons and details dialog. Already-watched films are excluded; saved Watchlist films remain visible with their selected blue button. No defaults are added to your collection.

Each recommendation includes **More like this** and **Not interested**. More like this is a toggle: selected films become extra seeds and contribute to genre affinity, without being marked watched or receiving an invented rating. Selecting it immediately opens a labelled **Because you liked [film]** panel with loading feedback, up to eight related films, existing movie details/status controls, retry and Undo. It preserves the background viewport rather than scrolling the page. Closing the panel returns to For You and keeps the signal. Not interested hides that exact film from all recommendation sources, including after refresh/reload, and clears any positive signal for it. Both actions offer Undo. **Reset feedback** brings hidden films back and clears explicit more-like-this signals, while preserving watched movies, ratings, favorites and current mood choices; that reset can also be undone.

Feedback is stored as an optional `recommendationFeedback` field in the existing `movielist-v2` record: dismissed TMDB IDs plus metadata for more-like-this films. Existing records load normally with no feedback defaults and are not rewritten on page load. Feedback is shared across tabs/pages. Nothing is sent to an AI service.

The algorithm in `recommendations.js` is deterministic, runs in the browser, and uses no AI model, training, chatbot or third-party AI service:

1. Watched films rated **4–5 stars** receive seed weights of `(rating - 3) × 2`. A **Top 4** favorite receives an additional **6**, including when unrated. An explicit More like this adds **6** to a film’s weight. Each qualifying film contributes its weight to each distinct saved genre.
2. Up to **four** verified TMDB seeds provide [recommendations](https://developer.themoviedb.org/reference/movie-recommendations) and [similar films](https://developer.themoviedb.org/reference/movie-similar). Up to **three** strongest genres provide TMDB Discover candidates. Optional selected genres add 4 to genre affinity and take priority over inferred genres for Discover requests. Recent explicit More like this selections take seed priority; remaining slots use the existing weighted ratings/favorites order. The source bound stays at four seeds and three genres. Legacy entries can influence genre affinity without inventing TMDB IDs.
3. Candidate evidence contributes `source weight × multiplier / (1 + source rank / 20)`, where multipliers are 6 for recommendations, 3 for similar films and 1 for Discover. Matching genre affinity adds twice its total weight; the TMDB vote average contributes at most 1 as a minor quality tie influence. TMDB scores never become personal ratings.
4. Evidence combines across distinct sources. Duplicate IDs within a source, duplicate sources, adult films, watched IDs and Not interested IDs are excluded. Legacy watched entries also exclude matching titles with matching release years (or titles alone if no year is saved). Direct matches from explicit More like this seeds are ranked ahead of broad genre-only candidates, with the most recent explicit seed taking priority. Scores and TMDB IDs order films within that tier. Explanations prefer the corresponding direct feedback evidence. Repeated selection of the same seed does not accumulate weight, and the four-seed source limit remains unchanged. Up to **40** results are displayed; explanations use the strongest supporting source.

An empty or small collection needs no fabricated recommendations: rate a watched film highly, choose a favorite, or select up to three optional genres. Genre choices apply to the current visit and are not written into existing storage. Selected moods filter all results to films matching at least one selected genre, including results from favorite-film and similar-film sources. Removing a selected genre updates the feed; deselecting all restores the full personalized feed. No signals means helpful onboarding and no recommendation requests.

**Refresh Recommendations** refetches the same bounded source set; unchanged signals and TMDB responses produce the same ranking. It is a refresh, not a random shuffle. Each pass fetches the first page from at most 11 sources, with at most three requests in flight. Changes in watched films/favorites or feedback automatically rebuild the feed, including cross-tab updates. Requests cancel on replacement and stale responses are ignored. Each successful source renders as soon as it arrives, so the selected film’s recommendations/similar results are visible before unrelated requests finish. Available sources still render if others fail; failures show a retry message. Existing cards remain in place while new sources load, and only sources still present in the current profile contribute. Undo immediately excludes a removed feedback seed and its boost, even before replacement network requests finish. Related panels use the same mood, watched, hidden and duplicate exclusions, and do not show the source film itself. Only movie IDs and genre IDs go through the existing proxy; ratings, favorites, dismissal lists and the complete collection are never transmitted as a profile. Explicit More like this choices are represented upstream only by movie IDs used for related-film requests. Browsing does not write to localStorage; explicit movie actions use the existing persistence path.

The earlier interaction could look unchanged because it waited for the full request batch, explicit matches could be outweighed by broad genre evidence, and all results shared one undifferentiated grid. Streaming source results, a dedicated related-picks panel and direct-evidence ranking address those causes. Tests cover early partial responses, source identity, strong genre competition, Undo against cached source batches, targeted errors and a real Chrome mobile interaction with unchanged background scroll.

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

- Discover browsing uses TMDB's [Discover endpoint](https://developer.themoviedb.org/reference/discover-movie) with genre, release dates, selected sorting and server pagination. All Genres removes the genre restriction while preserving year and sort.
- Search and Trending preserve their original TMDB ordering; the proxy filters each fetched page by real genre IDs and selected release years. A page may have no matches; Load more stays available while more pages remain. Changing genre resets pagination and cancels stale requests. Search text and the selected category are retained.
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

Automated frontend tests use a simulated DOM and mocked TMDB responses. They cover navigation targets and active states, initialization on all five pages, isolated collection grids, sorting, filtering, status moves, ratings, reload persistence, storage events, legacy linking, details, search races and API errors. Genre tests cover multi-genre matches, combined search/sorting, pagination resets, empty-page continuation, category changes and proxy genre validation. Regression tests rebuild twice and check all source and generated pages, scripts and styles for Import/Export UI remnants. They also verify existing data survives initialization and restored-page refreshes. Interaction regressions also cover all ten half-star values, clearing ratings, keyboard changes, one-click status toggles, stable card/control identity, dialog continuity and scroll restoration. Favorites and picker tests additionally cover watched-only selection, limits, replacement, ordering, removal, reloads, cross-tab updates, legacy linking, existing-data preservation, empty/single watchlists, non-repeating picks and moving a pick into Watched. Statistics tests cover empty/unrated collections, missing metadata, multi-genre counts, every half-star bin, averages, top-film ordering, decades, non-mutating calculations and live updates across tabs. Navigation and the no-Import/Export regression checks include Stats. Recommendation tests cover weighting, deterministic ordering, multi-source evidence, duplicates, watched/adult exclusions, genre onboarding, unchanged stored data, source limits, partial failures, retry, stale responses and proxy validation. Discover tests additionally cover decade/date boundaries, custom and single-year ranges, all three sorts, vote thresholds, combined filters, paging resets, stale date-filter responses and Search/Trending proxy filtering. Undo/feedback tests verify restoring status/rating/favorite order, preserving unrelated edits, safe conflict handling, Random Picker restoration, dialog controls, feedback normalization/persistence, positive seed selection, dismissed-film exclusion and reversible feedback resets. The real Chrome geometry test also covers Undo. The build includes all nine public assets. Live authenticated TMDB responses and a deployed Netlify instance require a configured token and a manual browser check.

Before recording your demo:

1. Configure the token; verify all-era browsing and Trending posters. Try Before 1970, each decade, a custom range and each of the three sorts. Combine genre/year/sort, then verify Load more appends without duplicates.
2. Search for a title; check results, a query with no matches and clearing the search. Switch categories rapidly to check stale results do not replace the latest request.
3. Open a movie and verify title, year, synopsis and genres. Add it to Watchlist (blue), move it to Watched (green), and rate it 3.5. Navigate to Watched and verify the film and its rating. Open Watchlist and verify it is absent.
4. Refresh: the same movie and rating should remain. Repeatedly press the same status button; no duplicate should appear.
5. Move it to Watchlist: rating should disappear. Remove it: Not added should appear. Refresh again to verify removal.
6. Search each collection, test every Watched sort option, and link an old manual entry. Open a second tab and verify status/rating changes appear there.
7. Add four favorites, replace one, reorder them with arrows, refresh, and verify their order and ratings. Move a favorite to Watchlist and confirm it leaves Top 4.
8. Pick a random watchlist film, try Pick Another, open details, and mark it watched. Check empty and single-film watchlists.
9. Open Stats and compare totals with Watched/Watchlist. Rate a film, move one to Watchlist, and verify averages, genres and chart counts update, including in another tab. Check empty and unrated states.
10. Open For You, verify explanations and watched exclusions, try genre preferences, save a recommendation to Watchlist, and mark it watched. Test refresh and missing/offline API responses.
11. Check keyboard focus, Escape to close details, mobile widths, image fallbacks, and retry behavior with offline mode or an absent token.

## Future conversational assistant (not implemented)

A later assistant could translate a conversation into validated genre, era and mood filters, call narrowly scoped server-side movie tools, and explain a licensed set of results. Keep the existing deterministic ranking as a fallback and preserve explicit user control over collection changes. No assistant code, AI API key or model dependency is included now.

Licensing must be resolved first. TMDB's [API Terms of Use](https://www.themoviedb.org/api-terms-of-use?language=en-CA), section 1.C, restrict use of its APIs/content in AI/ML-based applications, including training. This is broader than a training-only restriction; disabling model training or moving TMDB lookup outside the prompt does not establish permission. Obtain explicit written authorization covering the proposed assistant, or use a data source whose license explicitly permits the intended AI/inference use. Review terms for storage/caching, third-party processing and generated outputs, and review the model provider's retention and data-use terms. TMDB's [FAQ](https://developer.themoviedb.org/docs/faq) separately requires attribution for non-commercial use and a commercial license for commercial projects. This outline does not establish legal permission for a future integration.

Security design: keep TMDB/model credentials only in server environment variables; use authenticated endpoints where appropriate, request and output limits, timeouts, rate limiting and cost caps. Validate tool arguments against allowlists and return structured movie IDs; never let model text choose arbitrary URLs or execute code. Treat movie metadata and conversation content as untrusted, escape displayed text, isolate tool instructions from retrieved content, and protect against prompt injection. Send only consented, necessary user preferences to a provider, redact secrets from logs, choose suitable retention controls, and require an explicit user action before changing stored movie statuses or ratings. Keep the personal collection local unless the user opts into a documented sync/processing flow.

## Credits

Movie data and posters are provided by [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. An official TMDB logo and the required notice appear in the app's About & credits section. See [TMDB attribution requirements](https://developer.themoviedb.org/docs/faq).
