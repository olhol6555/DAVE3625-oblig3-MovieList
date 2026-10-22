const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const assets = ['index.html', 'watched.html', 'watchlist.html', 'stats.html', 'script.js', 'style.css', 'collection.js'];
function checkInterface(directory) {
  for (const file of assets) {
    const contents = fs.readFileSync(path.join(directory, file), 'utf8');
    assert.doesNotMatch(contents, /(?:import|export)-collection|(?:import|export|backup)-controls/i, `${file}: transfer UI code must stay removed`);
    if (file.endsWith('.html')) {
      assert.doesNotMatch(contents, /<input\b[^>]*\btype\s*=\s*["']?file\b/i, `${file}: no collection file inputs`);
      assert.doesNotMatch(contents, /(?:import|export)(?:\s*\/\s*(?:import|export))?\s+(?:collection|json)|json\s+(?:import|export)/i, `${file}: no transfer headings or buttons`);
    }
  }
}
test('source and repeated builds contain no JSON Import/Export interface or unused handlers/styles', () => {
  checkInterface(root);
  for (let build = 0; build < 2; build++) {
    execFileSync(process.execPath, [path.join(root, 'build.cjs')], { cwd: root, stdio: 'pipe' });
    checkInterface(path.join(root, 'dist'));
    for (const file of assets) {
      assert.deepEqual(fs.readFileSync(path.join(root, 'dist', file)), fs.readFileSync(path.join(root, file)), `dist/${file} must match current source`);
    }
  }
});
