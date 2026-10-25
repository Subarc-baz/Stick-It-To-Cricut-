#!/usr/bin/env node
// Builds ./index.html (single self-contained file) from src/app.html + src/*.js
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
let html = rd('app.html');
const need = ['/*@@CORE_ENGINE@@*/', '<!--@@MACHINE@@-->'];
need.forEach(m => { if (html.split(m).length !== 2) { console.error('marker missing/duplicated: ' + m); process.exit(1); } });
html = html.replace('/*@@CORE_ENGINE@@*/', () => rd('core-engine.js'));
// load order matters: vendor lib -> pure modules -> machine -> fonts -> export UI -> machine UI
const SCRIPTS = ['vendor/opentype.min.js', 'textpaths.js', 'svgexport.js', 'machine.js', 'fonts.js', 'export-ui.js', 'undo-ui.js', 'mat-ui.js', 'machine-ui.js'];
const blocks = SCRIPTS.map(f => { const t = rd(f); if (/<\/script/i.test(t)) { console.error('forbidden </script in ' + f); process.exit(1); } return '<script>\n' + t + '\n</script>'; });
html = html.replace('<!--@@MACHINE@@-->', () => blocks.join('\n'));
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('built index.html', html.length, 'bytes');
