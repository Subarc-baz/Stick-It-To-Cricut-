#!/usr/bin/env python3
"""Reproducibly derive src/app.html from the untouched original.
Every replacement asserts it matched exactly the expected number of times."""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
orig = next((root / 'original').glob('*.html')).read_text(encoding='utf-8')
s = orig

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'expected {count} match(es), found {n}: {old[:70]!r}'
    s = s.replace(old, new)

def rx(pattern, new, count=1, flags=re.S):
    global s
    found = re.findall(pattern, s, flags)
    assert len(found) == count, f'regex expected {count}, found {len(found)}: {pattern[:70]!r}'
    s = re.sub(pattern, lambda m: new, s, flags=flags)

# 1. state + the undeclared variable (ReferenceError on every mouse move/up)
rep('var undoStack=[],redoStack=[],nextId=1;',
    'var undoStack=[],redoStack=[],nextId=1;\nvar resizingText=null; /* FIX: was read in onMove/onUp but never declared -> ReferenceError on every mouse move/up */\n/*@@CORE_ENGINE@@*/')

# 2. every place that clears selection must clear selIds too
n = s.count('sel=null;selIdx=-1;')
assert n == 9, n
s = s.replace('sel=null;selIdx=-1;', 'sel=null;selIdx=-1;selIds=[];')

# 3. snapshot-based undo/redo/save/autosave (JSON of an <img> element is {} -> draw() threw after undo)
assert s.count('JSON.stringify(objects)') == 3
s = s.replace('JSON.stringify(objects)', 'snapshotObjects()')
rep('objects=JSON.parse(undoStack.pop())', 'objects=restoreObjects(undoStack.pop())')
rep('objects=JSON.parse(redoStack.pop())', 'objects=restoreObjects(redoStack.pop())')
rep('objects:objects,matW', 'objects:JSON.parse(snapshotObjects()),matW')
rep('objects=p.objects||[];', 'objects=restoreObjects(JSON.stringify(p.objects||[]));')
rep('JSON.stringify({objects:objects,nextId:nextId,ts:Date.now()})',
    'JSON.stringify({objects:JSON.parse(snapshotObjects()),nextId:nextId,ts:Date.now()})')
rep('objects=p.objects;nextId=p.nextId||objects.length+1;',
    'objects=restoreObjects(JSON.stringify(p.objects));nextId=p.nextId||objects.length+1;')
rep("type:'image',img:img,", "type:'image',img:img,src:img.src,", 4)
rep("else if(o.type==='image'&&o.img){ctx.drawImage",
    "else if(o.type==='image'&&o.img&&o.img.complete&&o.img.naturalWidth){ctx.drawImage")

# 4. remove the old versions of functions now provided by the engine
for name in ['copySelected', 'pasteClipboard', 'duplicateSelected', 'selectAll', 'selectObj', 'updateTransform']:
    rx(r'\nfunction ' + name + r'\([^\n]*\n', '\n')
rx(r'\n// === OBJECT ALIGNMENT ===\nfunction alignObjects\(dir\)\{.*?\n\}\n', '\n// === OBJECT ALIGNMENT === (moved to core engine)\n')

# 5. pointer handling
rep('    // Text has draggable corner handles.', '    if(tryBeginResize(pt))return;\n    // Text has draggable corner handles.')
rep('if(hit>=0){selectObj(hit);if(!objects[hit].locked)dragging=true;dragOX=pt.x-objects[hit].x;dragOY=pt.y-objects[hit].y;}',
    'if(hit>=0){beginObjectDrag(hit,pt,e);}')
rep('if(dragging&&sel){sel.x=snap(pt.x-dragOX);sel.y=snap(pt.y-dragOY);updateTransform();draw();return;}',
    'if(resizeOp){doResize(pt,e);return;}\n  if(dragging&&sel){doDrag(pt);return;}')
rep('if(dragging){pushUndo();dragging=false;return;}',
    'if(resizeOp){endResize();return;}\n  if(dragging){endDrag(e);return;}')

# 6. draw(): selection overlay
rx(r'\n  if\(sel\)\{\n    var sb=sel\.type', '\n  if(selIds.length>1){drawMultiSelection();}\n  if(sel&&selIds.length<2){\n    var sb=sel.type')

# 7. marquee: multi-select, shift adds, handles keep priority
rep('if(!isSelectedTextHandle(pt)){', 'if(!isSelectedTextHandle(pt)&&resizeHandleAt(pt)<0){')
rx(r"rubberBand=\{sx:mx,sy:my,ex:mx,ey:my,active:true\};\n\s*sel=null;selIdx=-1;selIds=\[\];refreshLayers\(\);draw\(\);",
   "rubberBand={sx:mx,sy:my,ex:mx,ey:my,active:true,base:e.shiftKey?selIds.slice():[]};\n        if(!e.shiftKey){sel=null;selIdx=-1;selIds=[];}\n        refreshLayers();draw();")
a = s.index('    for(var i=objects.length-1;i>=0;i--){\n      var o=objects[i];if(o.hidden)continue;\n      var mb=')
b = s.index('// Select first found (multi-select is phase 2)\n      }\n    }') + len('// Select first found (multi-select is phase 2)\n      }\n    }')
s = s[:a] + ("    var hits=rubberBand.base.slice();\n"
 "    objects.forEach(function(o){\n"
 "      if(o.hidden)return;\n"
 "      var mb=objBounds(o);\n"
 "      if(mb.x>=p1.x&&mb.x+mb.w<=p2.x&&mb.y>=p1.y&&mb.y+mb.h<=p2.y)hits.push(o.id);\n"
 "    });\n"
 "    if(hits.length)selectMany(hits);else{sel=null;selIdx=-1;selIds=[];refreshLayers();}") + s[b:]

# 8. keyboard
rep("if(e.key==='a'){e.preventDefault();selectAll();}",
    "if(e.key==='a'){e.preventDefault();selectAll();}\n      if(e.key==='g'||e.key==='G'){e.preventDefault();if(e.shiftKey)ungroupSelected();else groupSelected();}")
rep("if((e.key==='Delete'||e.key==='Backspace')&&sel){e.preventDefault();pushUndo();objects.splice(selIdx,1);sel=null;selIdx=-1;selIds=[];refreshLayers();draw();}",
    "if((e.key==='Delete'||e.key==='Backspace')&&sel){e.preventDefault();deleteSelected();}")
rep("['Ctrl+A','Select All'],", "['Ctrl+A','Select All'],['Ctrl+G','Group'],['Ctrl+Shift+G','Ungroup'],['Shift+Click','Add/remove from selection'],")

# 9. context menu (Copy passed a *string* -> TypeError; Delete/z-order/lock only handled one object)
rep("cmBtn('Copy','copySelected','Ctrl+C')", "cmBtn('Copy',copySelected,'Ctrl+C')")
rx(r"menu\.appendChild\(cmBtn\('Delete',function\(\)\{[^\n]*?\},'Del'\)\);",
   "menu.appendChild(cmBtn('Delete',deleteSelected,'Del'));\n      menu.appendChild(cmBtn('Group',groupSelected,'Ctrl+G'));\n      menu.appendChild(cmBtn('Ungroup',ungroupSelected,'Ctrl+Shift+G'));")
rx(r"menu\.appendChild\(cmBtn\('Bring to Front',function\(\)\{[^\n]*?\}\)\);", "menu.appendChild(cmBtn('Bring to Front',bringToFront));")
rx(r"menu\.appendChild\(cmBtn\('Send to Back',function\(\)\{[^\n]*?\}\)\);", "menu.appendChild(cmBtn('Send to Back',sendToBack));")
rep("menu.appendChild(cmBtn(sel.locked?'Unlock':'Lock',function(){sel.locked=!sel.locked;refreshLayers();}));",
    "menu.appendChild(cmBtn(sel.locked?'Unlock':'Lock',function(){var v=!sel.locked;selectedObjects().forEach(function(o){o.locked=v;});refreshLayers();}));")
rep("menu.appendChild(cmBtn(sel.hidden?'Show':'Hide',function(){sel.hidden=!sel.hidden;refreshLayers();draw();}));",
    "menu.appendChild(cmBtn(sel.hidden?'Show':'Hide',function(){var v=!sel.hidden;selectedObjects().forEach(function(o){o.hidden=v;});refreshLayers();draw();}));")

# 10. layers panel: highlight whole selection, mark groups, keep groups valid on delete
rep("d.className='litem'+(idx===selIdx?' sel':'');", "d.className='litem'+(selIds.indexOf(o.id)>=0?' sel':'');")
rep("+(o.name||o.type)+'</span>'", "+(o.gid?'\\u25A3 ':'')+(o.name||o.type)+'</span>'")
rep("pushUndo();objects.splice(idx,1);sel=null;", "pushUndo();objects.splice(idx,1);normalizeGroups();sel=null;")

# 10b. give the status-bar connection text an id so the machine layer can update it
rep('<span class="dot" id="stDot"></span> Disconnected</span>', '<span class="dot" id="stDot"></span> <span id="stConnTxt">Disconnected</span></span>')

# 10c. exportSVG silently dropped star/polygon/line objects
rep("else if(o.type==='ellipse')s+='<ellipse cx=\"'", "else if(o.type==='star'||o.type==='polygon'||o.type==='line')s+=svgOtherShape(o);\n    else if(o.type==='ellipse')s+='<ellipse cx=\"'")


# 10d. v6: path objects in draw()/PNG export, panel sync, export menu/shortcuts
rep("else if(o.type==='image'&&o.img&&o.img.complete&&o.img.naturalWidth){ctx.drawImage",
    "else if(o.type==='path'){drawPathObj(ctx,o);}\n    else if(o.type==='image'&&o.img&&o.img.complete&&o.img.naturalWidth){ctx.drawImage")
rep("else if(o.type==='line'){ex.beginPath();ex.moveTo(o.x1,o.y1);ex.lineTo(o.x2,o.y2);ex.stroke();}",
    "else if(o.type==='line'){ex.beginPath();ex.moveTo(o.x1,o.y1);ex.lineTo(o.x2,o.y2);ex.stroke();}\n    else if(o.type==='path'){drawPathObj(ex,o);}\n    else if(o.type==='image'&&o.img&&o.img.complete&&o.img.naturalWidth){ex.drawImage(o.img,o.x,o.y,o.w,o.h);}")
rep("var o=sel&&sel.type==='text'?sel:null;", "var o=sel&&sel.type==='text'&&selIds.length<2?sel:null;")
rep("curveSlider.addEventListener('input',", "window.__refreshTextPanel=refresh;\n  curveSlider.addEventListener('input',")
rep("menu.appendChild(cmBtn('Export PNG',exportPNG,'Ctrl+E'));",
    "menu.appendChild(cmBtn('Export PNG',exportPNG,'Ctrl+E'));\n    menu.appendChild(cmBtn('Export SVG\\u2026',function(){openExportDialog('svg');},'Ctrl+Shift+E'));")
rep("menu.appendChild(cmBtn('Ungroup',ungroupSelected,'Ctrl+Shift+G'));",
    "menu.appendChild(cmBtn('Ungroup',ungroupSelected,'Ctrl+Shift+G'));\n      if(selectedObjects().some(function(t){return t.type==='text';}))menu.appendChild(cmBtn('Convert Text to Shapes',convertSelectedTextToShapes));")
rep("if(e.key==='e'){e.preventDefault();exportPNG();}",
    "if(e.key==='e'||e.key==='E'){e.preventDefault();if(e.shiftKey)openExportDialog('svg');else exportPNG();}")
rep("['Ctrl+E','Export PNG'],", "['Ctrl+E','Export PNG'],['Ctrl+Shift+E','Export dialog (SVG / PNG)'],")

# 10e. v6.1: configurable mat colour (was hard-coded dark navy, black objects were invisible)
rep("ctx.fillStyle='#0c0c20';ctx.fillRect(0,0,matW,matH);", "ctx.fillStyle=matColor;ctx.fillRect(0,0,matW,matH);", 2)
rep("ex.fillStyle='#0c0c20';ex.fillRect(0,0,matW,matH);", "ex.fillStyle=matColor;ex.fillRect(0,0,matW,matH);")
rep("ctx.strokeStyle='rgba(255,255,255,0.04)';", "ctx.strokeStyle=matInk(0.04);")
rep("ctx.strokeStyle='rgba(255,255,255,0.12)';", "ctx.strokeStyle=matInk(0.12);")

# 11. machine layer markers + title
rep('</script>\n</body>', '</script>\n<!--@@MACHINE@@-->\n</body>')
rep('<title>Stick-it-too-Cricut — RICKET MAKER C-137</title>', '<title>Stick-it-too-Cricut — RICKET MAKER C-137 (v6)</title>')

out = root / 'src' / 'app.html'
out.write_text(s, encoding='utf-8')
print('wrote', out, len(s), 'bytes')
