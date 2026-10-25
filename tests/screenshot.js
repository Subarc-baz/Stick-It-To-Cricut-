// Dev helper: renders two screenshots of index.html (design with a group selected; Cut tab with simulator)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } }); p.on('dialog', d => d.accept());
  await p.goto('file://' + process.argv[2]); await p.waitForTimeout(400);
  await p.evaluate(() => {
    objects.push({id:1,type:'rect',x:150,y:150,w:200,h:120,fill:'#44ff66',stroke:'#fff',strokeW:2,alpha:1,name:'Rectangle'});
    objects.push({id:2,type:'ellipse',cx:500,cy:220,rx:70,ry:50,x:430,y:170,w:140,h:100,fill:'#9b59b6',stroke:'#fff',strokeW:2,alpha:1,name:'Ellipse'});
    objects.push({id:3,type:'star',cx:750,cy:220,r:70,ir:28,n:5,x:680,y:150,w:140,h:140,fill:'#ffc107',stroke:'#fff',strokeW:2,alpha:1,name:'Star'});
    nextId=4; draw(); selectMany([1,2,3]); groupSelected(); draw();
  });
  await p.screenshot({ path: process.argv[3] + '/shot-design.png' });
  await p.evaluate(() => { __machine.autoConfirm = true; document.querySelector('.vtab[data-t="cut"]').click(); });
  await p.click('#btnSimConn'); await p.waitForTimeout(100);
  await p.evaluate(() => __machine.runCut(false)); await p.waitForTimeout(150);
  await p.screenshot({ path: process.argv[3] + '/shot-cut.png' });
  await b.close();
})();
