# MovieList

**Live site:** [MovieList on Netlify](https://dave3625-oblig3-movielist.netlify.app/)

## Project Overview

MovieList is a university project for discovering films and keeping a personal movie collection. Users can track films they have watched, save films for later and give optional ratings. The application was developed with AI-assisted coding using OpenAI Codex, through multiple rounds of implementation, testing and improvement.

Movie collections are saved locally in the browser using `localStorage`. No account is required, and data does not automatically sync between devices or browsers.

## Features

- **Discover:** Search for films and browse by genre, release period and popularity or ratings.
- **Cast & crew:** Open directors and main cast from movie details. Profiles include biographies and separate acting/directing filmographies, watched counts, and direct Watched/Watchlist controls. Missing TMDB information has fallbacks.
- **Watched:** Track watched films, rate them in half-star increments and undo status changes.
- **Watchlist:** Save films to watch later and move them to Watched.
- **My Top 4:** Choose and arrange four favorite watched films.
- **Random Picker:** Get a random suggestion from your watchlist.
- **Stats:** Explore viewing statistics, genres, ratings and release decades.
- **For You:** Receive personalized recommendations based on your ratings, favorites and feedback. This feature uses rule-based recommendations, not an AI model.

## Technologies

HTML, CSS, vanilla JavaScript, the TMDB API and Netlify Functions. Movie data and posters require an internet connection.

## Run Locally

1. Install [Node.js](https://nodejs.org/) (version 22 or newer) and the Netlify CLI:
   ```
   npm install --global netlify-cli
   ```
2. Get an **API Read Access Token** from [TMDB](https://www.themoviedb.org/settings/api).
3. Copy `.env.example` to `.env` and set `TMDB_READ_TOKEN` to your token.
4. Run the application:
   ```
   npm run dev
   ```
5. Open [http://localhost:8888](http://localhost:8888/) or the address shown in the terminal.

Never commit `.env` or expose API credentials in frontend files. The TMDB token is used only by the server-side function. Movie details append fixed `credits`; the only person routes are validated `person` (`/person/:id`) and `personCredits` (`/person/:id/movie_credits`) actions. Opening `index.html` directly will not run that function.

## Deployment

MovieList is hosted on [Netlify](https://dave3625-oblig3-movielist.netlify.app/). Visitors can use the live site without installing anything or obtaining an API token. Netlify uses the settings in `netlify.toml`, with `TMDB_READ_TOKEN` configured as a protected environment variable.

## Testing

Run the automated tests with:

```
npm test
```

Tests cover collection management, recommendations, statistics, API validation and interface behavior. The production build can be generated with `npm run build`.

## Credits

Movie data and posters are provided by [The Movie Database (TMDB)](https://www.themoviedb.org/).

*This product uses the TMDB API but is not endorsed or certified by TMDB.*