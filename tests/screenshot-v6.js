// Dev helper: screenshots of the v6 features (text converted to shapes, export dialog, fonts dialog)
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } }); p.on('dialog', d => d.accept());
  await p.goto('file://' + process.argv[2]); await p.waitForTimeout(400);
  const f = fs.readFileSync(process.env.FONT_TTF || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf').toString('base64');
  await p.evaluate(async (b64) => {
    await FontLib.addFiles([new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'DejaVuSans.ttf')]);
    const F = '"DejaVu Sans", sans-serif';
    objects.push({ id: 1, type: 'text', x: 150, y: 260, text: 'Stick it', fill: '#44ff66', stroke: 'none', strokeW: 0, alpha: 1, font: '110px ' + F, name: 'Text: Stick it', w: 0, h: 52, curve: 0, warp: 'none' });
    objects.push({ id: 2, type: 'text', x: 250, y: 520, text: 'Cut curved text', fill: '#ffc107', stroke: 'none', strokeW: 0, alpha: 1, font: '64px ' + F, name: 'Text: Cut curved', w: 0, h: 52, curve: 55, warp: 'none' });
    objects.push({ id: 3, type: 'star', cx: 800, cy: 700, r: 80, ir: 32, n: 5, x: 720, y: 620, w: 160, h: 160, fill: '#9b59b6', stroke: '#fff', strokeW: 2, alpha: 1, name: 'Star' }); nextId = 4;
    selectMany([1]); draw(); await convertSelectedTextToShapes(); selectMany([2]); draw();
  }, f);
  await p.waitForTimeout(200); await p.screenshot({ path: process.argv[3] + '/shot-v6-design.png' });
  await p.keyboard.press('Control+Shift+E'); await p.waitForTimeout(150); await p.screenshot({ path: process.argv[3] + '/shot-v6-export.png' }); await p.keyboard.press('Escape');
  await p.evaluate(() => FontLib.openDialog()); await p.waitForTimeout(150); await p.screenshot({ path: process.argv[3] + '/shot-v6-fonts.png' });
  await b.close();
})();
