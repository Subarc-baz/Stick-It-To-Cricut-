/* ============================================================
   SELECTION / GROUPING / TRANSFORM ENGINE  (added in v5)
   Design notes
   - Groups are NOT nested objects. Each member stays in the flat `objects`
     array and shares a numeric `gid`. This keeps draw(), hit-testing, undo,
     save/load and export working unchanged (none of them need to know about
     groups) and makes grouping impossible to "lose" an object.
   - `sel` / `selIdx` still mean "primary selected object" so every pre-existing
     feature that reads them keeps working. `selIds` is the full selection.
   - Every geometry change goes through translateObj()/scaleObj(), which know
     about the per-type coordinate fields (x/y, cx/cy, x1/y1/x2/y2).
   ============================================================ */
var selIds=[];
var dragSnap=null,dragMoved=false,dragStartPt=null,dragAnchor=null,dragHit=-1;
var resizeOp=null;
var _imgCache={};

/* ---------- snapshots (undo / save / autosave / clipboard) ---------- */
function _noImg(k,v){return k==='img'?undefined:v;}
function snapshotObjects(){return JSON.stringify(objects,_noImg);}
function restoreObjects(json){
  var arr=JSON.parse(json);
  arr.forEach(function(o){
    if(o.type==='image'&&o.src){
      var im=_imgCache[o.src];
      if(!im){im=new Image();im.onload=function(){draw();};im.src=o.src;_imgCache[o.src]=im;}
      o.img=im;
    }
  });
  return arr;
}
function cloneList(list){return restoreObjects(JSON.stringify(list,_noImg));}

/* ---------- geometry helpers ---------- */
function objBounds(o){return o.type==='text'?textBounds(o):{x:o.x,y:o.y,w:o.w,h:o.h};}
function unionBounds(bs){
  if(!bs.length)return null;
  var x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  bs.forEach(function(b){x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);x1=Math.max(x1,b.x+b.w);y1=Math.max(y1,b.y+b.h);});
  return{x:x0,y:y0,w:x1-x0,h:y1-y0};
}
function selectedObjects(){return objects.filter(function(o){return selIds.indexOf(o.id)>=0;});}
function selectionBounds(){return unionBounds(selectedObjects().map(objBounds));}

/* Move an object by (dx,dy). Shapes store their geometry in different fields
   (x/y for rect/text/image, cx/cy for ellipse/star/polygon, x1..y2 for line);
   all of them must move together or the hit-box and the drawing separate. */
function translateObj(o,dx,dy){
  o.x+=dx;o.y+=dy;
  if(o.cx!==undefined){o.cx+=dx;o.cy+=dy;}
  if(o.x1!==undefined){o.x1+=dx;o.x2+=dx;o.y1+=dy;o.y2+=dy;}
}
function scaleFont(font,u){
  return String(font||'bold 48px sans-serif').replace(/(\d+(?:\.\d+)?)px/,function(m,n){return Math.max(1,Math.round(n*u*10)/10)+'px';});
}
/* Scale `o` from the geometry in `c` (a shallow copy taken before the operation)
   about anchor (ax,ay). Always computed from `c`, so repeated calls during one
   drag never accumulate rounding error. */
function scaleObj(o,c,sx,sy,ax,ay){
  var u=Math.sqrt(Math.abs(sx*sy));
  function px(v){return ax+(v-ax)*sx;} function py(v){return ay+(v-ay)*sy;}
  if(o.type==='ellipse'){
    o.cx=px(c.cx);o.cy=py(c.cy);o.rx=c.rx*sx;o.ry=c.ry*sy;
    o.x=o.cx-o.rx;o.y=o.cy-o.ry;o.w=o.rx*2;o.h=o.ry*2;
  }else if(o.type==='star'||o.type==='polygon'){
    /* radius-based shapes cannot be stretched non-uniformly: scale uniformly */
    o.cx=px(c.cx);o.cy=py(c.cy);o.r=c.r*u;if(c.ir!==undefined)o.ir=c.ir*u;
    o.x=o.cx-o.r;o.y=o.cy-o.r;o.w=o.h=o.r*2;
  }else if(o.type==='line'){
    o.x1=px(c.x1);o.y1=py(c.y1);o.x2=px(c.x2);o.y2=py(c.y2);
    o.x=Math.min(o.x1,o.x2);o.y=Math.min(o.y1,o.y2);o.w=Math.abs(o.x2-o.x1);o.h=Math.abs(o.y2-o.y1);
  }else if(o.type==='text'){
    o.x=px(c.x);o.y=py(c.y);o.font=scaleFont(c.font,u);
  }else{ /* rect, image */
    o.x=px(c.x);o.y=py(c.y);o.w=c.w*sx;o.h=c.h*sy;
    if(c.cornerR!==undefined)o.cornerR=c.cornerR*u;
  }
}

/* ---------- selection ---------- */
function groupMembers(o){return o.gid?objects.filter(function(m){return m.gid===o.gid;}):[o];}
function selectMany(ids){
  var set={};ids.forEach(function(i){set[i]=1;});
  objects.forEach(function(o){if(set[o.id]&&o.gid)objects.forEach(function(m){if(m.gid===o.gid)set[m.id]=1;});});
  selIds=objects.filter(function(o){return set[o.id];}).map(function(o){return o.id;});
  if(!selIds.length){sel=null;selIdx=-1;}
  else{var last=selIds[selIds.length-1];selIdx=objects.findIndex(function(o){return o.id===last;});sel=objects[selIdx];}
  updateTransform();refreshLayers();draw();
}
function selectObj(i){
  var o=objects[i];if(!o)return;
  selectMany([o.id]);selIdx=i;sel=o;
}
function selectAll(){selectMany(objects.filter(function(o){return !o.hidden;}).map(function(o){return o.id;}));}
function updateTransform(){
  var b=selectionBounds();if(!b)return;
  document.getElementById('tfX').value=toIn(b.x);document.getElementById('tfY').value=toIn(b.y);
  document.getElementById('tfW').value=toIn(b.w);document.getElementById('tfH').value=toIn(b.h);
}

/* ---------- grouping ---------- */
function nextGid(){return objects.reduce(function(m,o){return Math.max(m,o.gid||0);},0)+1;}
function normalizeGroups(){
  var n={};objects.forEach(function(o){if(o.gid)n[o.gid]=(n[o.gid]||0)+1;});
  objects.forEach(function(o){if(o.gid&&n[o.gid]<2)delete o.gid;});
}
function groupSelected(){
  var list=selectedObjects();
  if(list.length<2){toast('Select two or more objects to group');return false;}
  pushUndo();
  var g=nextGid();list.forEach(function(o){o.gid=g;});
  /* keep the members adjacent in z-order, at the position of the topmost member */
  var lastIdx=-1;objects.forEach(function(o,i){if(list.indexOf(o)>=0)lastIdx=i;});
  var out=[];objects.forEach(function(o,i){if(list.indexOf(o)<0)out.push(o);if(i===lastIdx)Array.prototype.push.apply(out,list);});
  objects=out;
  normalizeGroups();
  selectMany(list.map(function(o){return o.id;}));
  toast('Grouped '+list.length+' objects');return true;
}
function ungroupSelected(){
  var list=selectedObjects(),gs={};
  list.forEach(function(o){if(o.gid)gs[o.gid]=1;});
  if(!Object.keys(gs).length){toast('Selection contains no group');return false;}
  pushUndo();
  objects.forEach(function(o){if(o.gid&&gs[o.gid])delete o.gid;});
  selectMany(list.map(function(o){return o.id;}));
  toast('Ungrouped');return true;
}

/* ---------- selection-aware edit commands ---------- */
function deleteSelected(){
  if(!selIds.length)return;
  pushUndo();var ids=selIds.slice();
  objects=objects.filter(function(o){return ids.indexOf(o.id)<0;});
  normalizeGroups();sel=null;selIdx=-1;selIds=[];refreshLayers();draw();
}
function copySelected(){var l=selectedObjects();if(l.length)clipboard=cloneList(l);}
function pasteClipboard(){
  if(!clipboard||!clipboard.length)return;
  pushUndo();
  var copies=cloneList(clipboard),gmap={},base=nextGid();
  copies.forEach(function(o){
    o.id=nextId++;translateObj(o,20,20);o.name=(o.name||o.type)+' copy';
    if(o.gid){if(!gmap[o.gid])gmap[o.gid]=base++;o.gid=gmap[o.gid];}
    objects.push(o);
  });
  clipboard=cloneList(copies);       /* successive pastes cascade */
  selectMany(copies.map(function(o){return o.id;}));
}
function duplicateSelected(){if(!selIds.length)return;copySelected();pasteClipboard();}
function bringToFront(){
  var l=selectedObjects();if(!l.length)return;pushUndo();
  objects=objects.filter(function(o){return l.indexOf(o)<0;}).concat(l);
  selectMany(l.map(function(o){return o.id;}));
}
function sendToBack(){
  var l=selectedObjects();if(!l.length)return;pushUndo();
  objects=l.concat(objects.filter(function(o){return l.indexOf(o)<0;}));
  selectMany(l.map(function(o){return o.id;}));
}
function alignObjects(dir){
  var list=selectedObjects().filter(function(o){return !o.locked;});
  var b=selectionBounds();if(!list.length||!b)return;
  pushUndo();
  var dx=0,dy=0;
  if(dir==='left')dx=-b.x;
  else if(dir==='center-h')dx=matW/2-(b.x+b.w/2);
  else if(dir==='right')dx=matW-(b.x+b.w);
  else if(dir==='top')dy=-b.y;
  else if(dir==='center-v')dy=matH/2-(b.y+b.h/2);
  else if(dir==='bottom')dy=matH-(b.y+b.h);
  list.forEach(function(o){translateObj(o,dx,dy);});
  updateTransform();draw();
}

/* ---------- dragging ---------- */
function beginObjectDrag(hit,pt,e){
  var ho=objects[hit];
  if(e.shiftKey){                       /* shift-click toggles the object (or its whole group) */
    var ids=groupMembers(ho).map(function(m){return m.id;});
    var has=selIds.indexOf(ho.id)>=0;
    selectMany(has?selIds.filter(function(i){return ids.indexOf(i)<0;}):selIds.concat(ids));
    return;
  }
  if(selIds.indexOf(ho.id)<0)selectObj(hit);
  else{selIdx=hit;sel=ho;updateTransform();refreshLayers();draw();}
  if(ho.locked)return;
  dragging=true;dragMoved=false;dragHit=hit;
  dragStartPt={x:pt.x,y:pt.y};dragAnchor={x:ho.x,y:ho.y};dragSnap=snapshotObjects();
}
function doDrag(pt){
  if(!dragMoved){
    /* ignore sub-3px jitter so a plain click never moves or dirties the document */
    if(Math.hypot(pt.x-dragStartPt.x,pt.y-dragStartPt.y)*zoom<3)return;
    dragMoved=true;
    undoStack.push(dragSnap);if(undoStack.length>80)undoStack.shift();redoStack=[];
  }
  var dx=snap(dragAnchor.x+(pt.x-dragStartPt.x))-sel.x,dy=snap(dragAnchor.y+(pt.y-dragStartPt.y))-sel.y;
  if(dx||dy){
    selectedObjects().forEach(function(o){if(!o.locked)translateObj(o,dx,dy);});
    updateTransform();draw();
  }
}
function endDrag(e){
  dragging=false;dragSnap=null;
  /* plain click (no movement) on a member of a multi-selection selects just that item/group */
  if(!dragMoved&&dragHit>=0&&selIds.length>1&&!(e&&e.shiftKey)&&objects[dragHit])selectObj(dragHit);
  dragHit=-1;updateTransform();draw();
}

/* ---------- corner-handle resizing (any shape, any multi-selection) ---------- */
function _handlePositions(b){return[[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]];}
function resizeHandleAt(pt){
  if(!sel||!selIds.length)return -1;
  if(selIds.length===1&&sel.type==='text')return -1;   /* text keeps its own font-size handle */
  var list=selectedObjects();
  if(list.every(function(o){return o.locked;}))return -1;
  var b=selectionBounds();if(!b)return -1;
  var r=Math.max(7/zoom,5),hp=_handlePositions(b);
  for(var i=0;i<4;i++)if(Math.hypot(pt.x-hp[i][0],pt.y-hp[i][1])<=r)return i;
  return -1;
}
function tryBeginResize(pt){
  var h=resizeHandleAt(pt);if(h<0)return false;
  var b=selectionBounds();
  var list=selectedObjects().filter(function(o){return !o.locked;});
  var opp=[[b.x+b.w,b.y+b.h],[b.x,b.y+b.h],[b.x+b.w,b.y],[b.x,b.y]][h];
  resizeOp={h:h,anchor:opp,b:b,moved:false,snapshot:snapshotObjects(),
    orig:list.map(function(o){return{o:o,c:Object.assign({},o)};})};
  return true;
}
function doResize(pt,e){
  var ro=resizeOp,b=ro.b;
  var px=snapOn?snap(pt.x):pt.x,py=snapOn?snap(pt.y):pt.y;
  var hx=(ro.h%2===0)?b.x:b.x+b.w,hy=(ro.h<2)?b.y:b.y+b.h;
  var sx=b.w>1?(px-ro.anchor[0])/(hx-ro.anchor[0]):1,sy=b.h>1?(py-ro.anchor[1])/(hy-ro.anchor[1]):1;
  if(e&&e.shiftKey&&b.w>1&&b.h>1){var s=Math.max(Math.abs(sx),Math.abs(sy));sx=s;sy=s;}
  if(b.w>1)sx=Math.max(sx,4/b.w);   /* minimum 4px, never flips */
  if(b.h>1)sy=Math.max(sy,4/b.h);
  if(!ro.moved){
    if(Math.abs(sx-1)<1e-3&&Math.abs(sy-1)<1e-3)return;
    ro.moved=true;undoStack.push(ro.snapshot);if(undoStack.length>80)undoStack.shift();redoStack=[];
  }
  ro.orig.forEach(function(r){scaleObj(r.o,r.c,sx,sy,ro.anchor[0],ro.anchor[1]);});
  updateTransform();draw();
}
function endResize(){resizeOp=null;updateTransform();draw();}

/* ---------- numeric Transform panel (X / Y / W / H, inches) ---------- */
function applyTransformInput(){
  var b=selectionBounds();if(!b)return;
  var nx=parseFloat(document.getElementById('tfX').value)*DPI,ny=parseFloat(document.getElementById('tfY').value)*DPI;
  var nw=parseFloat(document.getElementById('tfW').value)*DPI,nh=parseFloat(document.getElementById('tfH').value)*DPI;
  if(![nx,ny,nw,nh].every(isFinite)){updateTransform();return;}
  var list=selectedObjects().filter(function(o){return !o.locked;});if(!list.length)return;
  pushUndo();
  var sx=(b.w>0.5&&nw>0.5)?nw/b.w:1,sy=(b.h>0.5&&nh>0.5)?nh/b.h:1;
  if(Math.abs(sx-1)>1e-6||Math.abs(sy-1)>1e-6)list.forEach(function(o){scaleObj(o,Object.assign({},o),sx,sy,b.x,b.y);});
  var b2=selectionBounds(),dx=nx-b2.x,dy=ny-b2.y;
  if(dx||dy)list.forEach(function(o){translateObj(o,dx,dy);});
  updateTransform();draw();
}

/* ---------- multi-selection overlay (called from draw()) ---------- */
function drawMultiSelection(){
  var list=selectedObjects(),b=selectionBounds();if(!b)return;
  var isGroup=list.length>1&&list.every(function(o){return o.gid&&o.gid===list[0].gid;});
  var col=isGroup?'#b57bff':'#44ff66';
  ctx.save();
  ctx.lineWidth=1/zoom;ctx.strokeStyle=col;ctx.globalAlpha=0.55;ctx.setLineDash([3/zoom,3/zoom]);
  list.forEach(function(o){var ob=objBounds(o);ctx.strokeRect(ob.x,ob.y,ob.w,ob.h);});
  ctx.globalAlpha=1;ctx.lineWidth=1.5/zoom;ctx.setLineDash([6/zoom,3/zoom]);
  ctx.strokeRect(b.x-4/zoom,b.y-4/zoom,b.w+8/zoom,b.h+8/zoom);ctx.setLineDash([]);
  var hs=6/zoom;ctx.fillStyle='#fff';
  _handlePositions(b).forEach(function(p){ctx.beginPath();ctx.arc(p[0],p[1],hs/2,0,Math.PI*2);ctx.fill();ctx.stroke();});
  ctx.restore();
}

/* ---------- UI wiring: transform inputs + Group/Ungroup buttons ---------- */
(function(){
  ['tfX','tfY','tfW','tfH'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.addEventListener('change',applyTransformInput);
  });
  var tp=document.querySelector('#tfH');var container=tp&&tp.closest('.spanel-body');
  if(container){
    var row=document.createElement('div');
    row.style.cssText='display:flex;gap:3px;margin-top:8px';
    row.innerHTML='<div style="font:700 9px var(--ui);text-transform:uppercase;letter-spacing:1.5px;color:var(--portal);margin-bottom:4px;width:100%">Group</div>';
    row.style.flexWrap='wrap';
    [['Group (Ctrl+G)',groupSelected,'btnGroup'],['Ungroup (Ctrl+Shift+G)',ungroupSelected,'btnUngroup']].forEach(function(a){
      var b=document.createElement('button');b.className='mbtn';b.id=a[2];b.style.cssText='flex:1;padding:5px;font-size:10px;min-width:60px';
      b.textContent=a[0].split(' ')[0];b.title=a[0];b.onclick=a[1];row.appendChild(b);
    });
    container.appendChild(row);
  }
})();

/* SVG for the shapes v4's exportSVG() silently dropped (star, polygon, line) */
function svgOtherShape(o){
  var f=o.fill||'none',st=o.stroke||'#fff',w=o.strokeW||2,pts=[],i;
  var attrs=' fill="'+f+'" stroke="'+st+'" stroke-width="'+w+'"/>\n';
  if(o.type==='line')return '<line x1="'+o.x1+'" y1="'+o.y1+'" x2="'+o.x2+'" y2="'+o.y2+'" fill="none" stroke="'+st+'" stroke-width="'+w+'"/>\n';
  if(o.type==='polygon'){for(i=0;i<o.n;i++){var a=2*Math.PI/o.n*i-Math.PI/2;pts.push((o.cx+o.r*Math.cos(a)).toFixed(3)+','+(o.cy+o.r*Math.sin(a)).toFixed(3));}}
  else{for(i=0;i<o.n*2;i++){var r=i%2===0?o.r:o.ir,b=Math.PI/o.n*i-Math.PI/2;pts.push((o.cx+r*Math.cos(b)).toFixed(3)+','+(o.cy+r*Math.sin(b)).toFixed(3));}}
  return '<polygon points="'+pts.join(' ')+'"'+attrs;
}

/* ---------- v6: `path` object (compound closed polylines, e.g. converted text) ----------
   Contours are stored relative to the bounding-box origin in a (bw x bh) frame:
   move = change x/y, resize = change w/h. translateObj()/scaleObj() therefore need no special case. */
function drawPathObj(c,o){
  if(!o.contours||!o.contours.length)return;
  var fx=o.w/(o.bw||1),fy=o.h/(o.bh||1);
  c.beginPath();
  o.contours.forEach(function(ct){
    ct.forEach(function(p,i){var X=o.x+p[0]*fx,Y=o.y+p[1]*fy;if(i)c.lineTo(X,Y);else c.moveTo(X,Y);});
    c.closePath();
  });
  if(o.fill&&o.fill!=='none')c.fill('nonzero');
  if(o.stroke&&o.stroke!=='none'&&(o.strokeW||0)>0)c.stroke();
}
/* Keep the text-properties panel in sync with ANY selection change (marquee, group, delete, click on empty canvas). */
var _refreshLayersBase=refreshLayers;
refreshLayers=function(){_refreshLayersBase.apply(this,arguments);if(window.__refreshTextPanel)window.__refreshTextPanel();};

/* v6.1: mat colour. matInk(a) = grid/guide colour that contrasts with the current mat. */
var matColor = '#0c0c20';
function matInk(a) {
  var m = /^#([0-9a-f]{6})$/i.exec(matColor), l = 0;
  if (m) { var n = parseInt(m[1], 16); l = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
  return l > 0.5 ? 'rgba(0,0,0,' + a * 2.5 + ')' : 'rgba(255,255,255,' + a + ')';
}
function setMatColor(c) { if (!/^#[0-9a-f]{6}$/i.test(c)) return false; matColor = c.toLowerCase(); draw(); return true; }
