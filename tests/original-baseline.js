// Baseline probe: run against a given html file; report console errors + drag behaviour.
const { chromium } = require('playwright');
(async () => {
  const file = process.argv[2];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type()==='error' && errs.push('console: '+m.text()));
  await p.goto('file://' + file); await p.waitForTimeout(500);
  const box = await p.locator('#cvs').boundingBox();
  async function drawShape(tool, x1,y1,x2,y2){ await p.evaluate(t=>setTool(t),tool); await p.mouse.move(box.x+x1,box.y+y1); await p.mouse.down(); await p.mouse.move(box.x+(x1+x2)/2,box.y+(y1+y2)/2); await p.mouse.move(box.x+x2,box.y+y2); await p.mouse.up(); }
  await drawShape('rect',300,200,400,280);
  await drawShape('circle',600,300,660,350);
  const res = {};
  for (const [name,idx,cx,cy] of [['rect',0,350,240],['ellipse',1,600,300]]) {
    await p.evaluate(()=>setTool('select'));
    const cnt = await p.evaluate(()=>objects.length); if(cnt<=idx){res[name]="NO OBJECT CREATED (objects.length="+cnt+")";continue;} const before = await p.evaluate(i=>JSON.parse(JSON.stringify(objects[i])),idx);
    await p.mouse.move(box.x+cx,box.y+cy); await p.mouse.down(); await p.mouse.move(box.x+cx+40,box.y+cy+30); await p.mouse.move(box.x+cx+80,box.y+cy+60); await p.mouse.up();
    const after = await p.evaluate(i=>JSON.parse(JSON.stringify(objects[i])),idx);
    res[name]={before:{x:before.x,y:before.y,cx:before.cx,cy:before.cy},after:{x:after.x,y:after.y,cx:after.cx,cy:after.cy}};
  }
  console.log(JSON.stringify({ errors:[...new Set(errs)], res }, null, 1));
  await b.close();
})();
