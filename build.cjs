// Only public assets enter the deploy directory; .env and server code never do.
const { mkdirSync, copyFileSync, rmSync } = require('node:fs');
const path = require('node:path');
// Recreate only this project's generated output, so retired or stray files cannot ship.
const output = path.join(__dirname, 'dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'watched.html', 'watchlist.html', 'stats.html', 'recommendations.html', 'recommendations.js', 'style.css', 'script.js', 'collection.js']) {
  copyFileSync(path.join(__dirname, file), path.join(output, file));
}
