const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const assets = ['index.html', 'watched.html', 'watchlist.html', 'stats.html', 'recommendations.html', 'recommendations.js', 'script.js', 'style.css', 'collection.js'];
function checkInterface(directory) {
  for (const file of assets) {
    const contents = fs.readFileSync(path.join(directory, file), 'utf8');
    assert.doesNotMatch(contents, /diary|activity-timeline|activity-entry|watchedDate|ratedAt|ratingUpdatedAt|recordActivity/i, `${file}: removed features must stay absent`);
    assert.doesNotMatch(contents, /(?:import|export)-collection|(?:import|export|backup)-controls/i, `${file}: transfer UI code must stay removed`);
    if (file.endsWith('.html')) {
      assert.doesNotMatch(contents, /<input\b[^>]*\btype\s*=\s*["']?file\b/i, `${file}: no collection file inputs`);
      assert.doesNotMatch(contents, /(?:import|export)(?:\s*\/\s*(?:import|export))?\s+(?:collection|json)|json\s+(?:import|export)/i, `${file}: no transfer headings or buttons`);
    }
  }
}
test('source and repeated builds contain no JSON Import/Export interface or unused handlers/styles', () => {
  checkInterface(root);
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'retired-page.html'), 'stale output');
  fs.writeFileSync(path.join(root, 'dist', '.env'), 'PRIVATE_BUILD_SENTINEL');
  for (let build = 0; build < 2; build++) {
    execFileSync(process.execPath, [path.join(root, 'build.cjs')], { cwd: root, stdio: 'pipe' });
    checkInterface(path.join(root, 'dist'));
    assert.deepEqual(fs.readdirSync(path.join(root, 'dist')).sort(), [...assets].sort(), 'Only required public assets may ship');
    for (const file of assets) {
      assert.deepEqual(fs.readFileSync(path.join(root, 'dist', file)), fs.readFileSync(path.join(root, file)), `dist/${file} must match current source`);
    }
  }
});

test('every page has unique IDs, valid local asset links and no broken navigation targets', () => {
  for (const file of assets.filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file}: duplicate IDs`);
    for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^https?:/.test(target)) continue;
      const [localFile, fragment] = target.split('#');
      assert.ok(!localFile || assets.includes(localFile), `${file}: missing asset ${target}`);
      if (fragment && !localFile) assert.ok(ids.includes(fragment), `${file}: missing anchor ${target}`);
    }
    for (const [, target] of html.matchAll(/\bfor="([^"]+)"/g)) assert.ok(ids.includes(target), `${file}: missing label target ${target}`);
  }
});
