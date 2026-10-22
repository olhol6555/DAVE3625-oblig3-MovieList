// Only public assets enter the deploy directory; .env and server code never do.
const { mkdirSync, copyFileSync } = require('node:fs');
mkdirSync('dist', { recursive: true });
for (const file of ['index.html', 'watched.html', 'watchlist.html', 'stats.html', 'recommendations.html', 'recommendations.js', 'style.css', 'script.js', 'collection.js']) {
  copyFileSync(file, `dist/${file}`);
}
