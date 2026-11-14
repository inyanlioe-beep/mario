import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// No dependencies. Run with: node tests/game.test.mjs
// Set CHROME_PATH if Chrome is installed somewhere else.
const root=fileURLToPath(new URL('../',import.meta.url));
const html=await readFile(join(root,'index.html'),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new Function(source); // Check the original script before browser instrumentation.
const testHtml=html.replace('  makeLevel();player=newPlayer();let last=0,accumulator=0;',
  '  globalThis.__game={run:code=>eval(code)};\n  makeLevel();player=newPlayer();let last=0,accumulator=0;');
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(testHtml);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'pocket-mario-test-'));
const chrome=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--in-process-gpu','--no-sandbox','--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--mute-audio','--remote-debugging-port=0',
  `--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
console.log('Starting headless Chrome...');
let browserLog='';chrome.stderr.on('data',chunk=>{browserLog+=chunk;});
let socket;
try{
  const debugUrl=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000);
    chrome.on('error',reject);chrome.stderr.on('data',data=>{output+=data;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  const debugOrigin=debugUrl.replace('ws:','http:').split('/devtools/')[0];
  const pages=await (await fetch(debugOrigin+'/json/list',{signal:AbortSignal.timeout(10000)})).json();
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Chrome WebSocket timed out')),10000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=reject;});
  let nextId=0;const pending=new Map(),errors=[];
  socket.onclose=()=>{for(const p of pending.values())p.reject(new Error('Chrome connection closed'));pending.clear();};
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p.reject(message.error);else p.resolve(message.result);}};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timed out: '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const game=code=>evaluate(`__game.run(${JSON.stringify(code)})`);
  await cdp('Runtime.enable');await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:'window.requestAnimationFrame=()=>0;'});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  for(let i=0;i<100;i++){if(await evaluate('typeof __game!=="undefined"'))break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(await game('state'),'title');
  await evaluate('document.getElementById("startButton").click()');
  assert.equal(await game('state'),'playing');
  console.log('PASS: original page loads and Start works in Chrome');

  for(let i=0;i<4;i++){
    const result=await game(`(()=>{loadStage(${i});render();return {cols:level[0].length,rows:level.length,overlap:collides(player),world:$('worldLabel').textContent,time,stage:stage().id};})()`);
    assert.equal(result.rows,14);assert.equal(result.overlap,false);assert.equal(result.time,i<2?400:300);assert.equal(result.stage,`1-${i+1}`);assert.ok(result.world.includes(result.stage));
  }
  console.log('PASS: all four maps have valid dimensions, safe spawns, timers and world labels');

  // Search actual held-jump trajectories using the game's collision routine.
  // Moving lifts can be waited on at the bottom, middle and top of their cycle.
  for(const height of [30,54])for(let index=1;index<4;index++){
    const route=await game(`(()=>{
      loadStage(${index});const h=${height},nodes=[],keys=new Map();
      const add=(x,y,lift=-1)=>{const b={x:x*T+5,y:y-h,w:22,h};if(!collides(b)){const n={...b,feet:y,lift};keys.set(x+','+Math.round(y),nodes.length);nodes.push(n);}};
      for(let x=0;x<COLS;x++)for(let y=3;y<ROWS;y++)if(solid(tile(x,y))&&!solid(tile(x,y-1)))add(x,y*T);
      platforms.forEach((p,lift)=>{for(const y of [p.baseY-p.range,p.baseY,p.baseY+p.range])for(let x=p.baseX/T;x<(p.baseX+p.w)/T;x++)add(x,y,lift);});
      const first=keys.get('2,'+GROUND),queue=[first],visited=new Set(queue);
      const visit=n=>{if(n!==undefined&&!visited.has(n)){visited.add(n);queue.push(n);}};
      const landing=(b,feet)=>{const col=Math.floor((b.x+b.w/2)/T);return keys.get(col+','+Math.round(feet));};
      for(let cursor=0;cursor<queue.length;cursor++){
        const n=nodes[queue[cursor]];if(n.x>=END-2*T)return {ok:true,visited:visited.size};
        if(n.lift>=0)nodes.forEach((other,i)=>{if(other.lift===n.lift)visit(i);});
        for(const dir of [-1,1]){
          visit(keys.get((Math.floor(n.x/T)+dir)+','+Math.round(n.feet)));
          for(const speed of [120,218,350])for(const hold of [true,false]){
            const b={x:n.x,y:n.y,w:22,h,vx:dir*speed,vy:-610,grounded:false};
            for(let step=0;step<90;step++){
              const previous=b.y+h;b.vx=Math.max(-speed,Math.min(speed,b.vx+dir*1200/60));b.vy=Math.min(850,b.vy+(b.vy<0?(hold?1180:2800):1880)/60);
              const hit=move(b,1/60);if(hit.wall)b.vx=0;
              if(b.vy>=0)for(const p of platforms)for(const y of [p.baseY-p.range,p.baseY,p.baseY+p.range])if(previous<=y&&b.y+h>=y&&b.x+b.w>p.baseX&&b.x<p.baseX+p.w){visit(landing(b,y));}
              if(b.grounded){visit(landing(b,b.y+h));break;}if(b.y>H+50)break;
            }
          }
        }
      }
      return {ok:false,visited:visited.size,furthest:Math.max(...[...visited].map(i=>nodes[i].x/T))};
    })()`);
    assert.equal(route.ok,true,`World 1-${index+1}, Mario height ${height}: ${JSON.stringify(route)}`);
  }
  console.log('PASS: jump routes reach all three new goals for small and powered-up Mario');

  await game('startGame();score=1234;coinCount=17;lives=2;player.power=2;player.h=54;');
  for(let i=0;i<4;i++){
    const result=await game(`(()=>{player.x=END-28;player.y=${i===3?'11*T-player.h':'GROUND-player.h'};time=123;updatePlayer(1/60);const began=state==='finishing';for(let n=0;n<400;n++)update(1/60);const total=score;for(let n=0;n<30;n++)update(1/60);return {began,state,score,stable:total===score,text:ui.start.textContent,stageIndex,lives,coinCount,power:player.power};})()`);
    assert.equal(result.began,true);assert.equal(result.state,'complete');assert.equal(result.stable,true);assert.equal(result.stageIndex,i);assert.equal(result.lives,2);assert.equal(result.coinCount,17);assert.equal(result.power,2);
    assert.equal(result.score,1234+(i+1)*(5000+123*50));
    assert.ok(result.text.includes(i<3?`1-${i+2}`:'MAIN DARI AWAL'));
    // One transition via keyboard; the others use the visible button.
    if(i===1)await evaluate('document.getElementById("game").focus();document.dispatchEvent(new KeyboardEvent("keydown",{code:"Enter",bubbles:true}));');
    else await evaluate('document.getElementById("startButton").click()');
    if(i<3){assert.equal(await game('stageIndex'),i+1);assert.equal(await game('time'),i+1<2?400:300);assert.equal(await game('player.power'),2);}
  }
  assert.equal(await game('stageIndex'),0);assert.equal(await game('score'),0);assert.equal(await game('lives'),3);
  console.log('PASS: flag/axe completion, one-time time bonus, button/Enter transitions, carry-over and final restart');

  for(let i=0;i<3;i++){
    const result=await game(`(()=>{lives=3;loadStage(${i});player.x=(stage().checkpoint+1)*T;player.y=spawnY(player.x)-player.h;player.grounded=true;updatePlayer(1/60);die();for(let n=0;n<200;n++)update(1/60);return {checkpoint,state,stageIndex,lives,x:player.x,overlap:collides(player),power:player.power};})()`);
    assert.equal(result.checkpoint,true,JSON.stringify(result));assert.equal(result.state,'playing');assert.equal(result.stageIndex,i);assert.equal(result.lives,2);assert.equal(result.overlap,false);assert.equal(result.power,0);
  }
  console.log('PASS: death respawns on each current level at a safe checkpoint');

  assert.equal(await game(`(()=>{loadStage(2);const lift=platforms[0];player.x=lift.x+20;player.y=lift.y-player.h;player.grounded=true;const before=player.y;update(1/60);return player.grounded&&Math.abs(player.y+player.h-lift.y)<.01&&player.y!==before;})()`),true);
  assert.equal(await game(`(()=>{togglePause();const before=JSON.stringify([time,stageClock,player.x,player.y,platforms]);for(let i=0;i<60;i++)update(1/60);const frozen=before===JSON.stringify([time,stageClock,player.x,player.y,platforms]);togglePause();return frozen&&state==='playing';})()`),true);
  console.log('PASS: moving platforms carry Mario; pause freezes physics, timer and hazards');

  assert.equal(await game(`(()=>{loadStage(3);player.x=18*T+4;player.y=GROUND-player.h+2;player.star=5;player.immune=5;updatePlayer(0);return state==='dying';})()`),true);
  assert.equal(await game(`(()=>{loadStage(3);const b=firebars[0];const a=b.phase;player.x=b.x+Math.cos(a)*30-10;player.y=b.y+Math.sin(a)*30-15;updateHazards(0);return state==='dying';})()`),true);
  assert.equal(await game(`(()=>{loadStage(3);player.x=boss.x;player.y=boss.y;updateHazards(0);return state==='dying';})()`),true);
  console.log('PASS: lava, rotating firebars and Bowser contact cause damage/death');

  assert.equal(await game(`(()=>{loadStage(3);for(let i=0;i<5;i++){boss.immune=0;fireballs=[{x:boss.x+5,y:boss.y+10,w:12,h:12,vx:0,vy:0,life:1}];updateFireballs(0);}return boss.dead&&boss.hp===0&&state==='playing';})()`),true);
  assert.equal(await game(`(()=>{lives=3;die();for(let n=0;n<200;n++)update(1/60);return state==='playing'&&stageIndex===3&&boss.hp===5&&!boss.dead&&!checkpoint;})()`),true);
  assert.equal(await game(`(()=>{player.x=END-28;player.y=11*T-player.h;updatePlayer(0);for(let n=0;n<290;n++)update(1/60);return state==='complete'&&bridgeFalling&&boss.dead&&level[11].slice(109,122).every(c=>c===' ');})()`),true);
  console.log('PASS: five fireballs defeat Bowser, death resets castle, axe also defeats live Bowser and collapses bridge');

  await game('loadStage(1);lives=1;die();for(let i=0;i<150;i++)update(1/60);');
  assert.equal(await game('state'),'gameover');
  await evaluate('document.getElementById("startButton").click()');
  assert.equal(await game('stageIndex'),0);assert.equal(await game('lives'),3);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
  const touch=await evaluate(`(()=>{const b=document.querySelector('[data-control="right"]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...touch,id:1}]});
  assert.equal(await game('input.right'),true);
  await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await game('input.right'),false);
  console.log('PASS: Game Over restarts the adventure and touch input still works');

  await cdp('Emulation.setDeviceMetricsOverride',{width:1200,height:950,deviceScaleFactor:1,mobile:false});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});
  await evaluate('window.scrollTo(0,0)');
  const artifacts=join(root,'tests','artifacts');await mkdir(artifacts,{recursive:true});
  for(const [name,index,x] of [['world-1-2',1,18],['world-1-3',2,38],['world-1-4',3,115]]){
    await game(`loadStage(${index});player.x=${x}*T;player.y=${index===2?'platforms[0].y-player.h':index===3?'11*T-player.h':'spawnY(player.x)-player.h'};cam=Math.max(0,player.x-W*.4);render();`);
    const shot=await cdp('Page.captureScreenshot',{format:'png'});
    await writeFile(join(artifacts,name+'.png'),Buffer.from(shot.data,'base64'));
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp('Emulation.setTouchEmulationEnabled',{enabled:true});
  await evaluate('document.documentElement.style.setProperty("--test", "1");');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await game('loadStage(2);setState("complete");render();');
  assert.equal(await evaluate('(()=>{const button=document.getElementById("startButton"),a=button.getBoundingClientRect(),b=document.getElementById("overlay").getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;})()'),true);
  const mobile=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'mobile.png'),Buffer.from(mobile.data,'base64'));
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop/mobile render, completion button remains visible, no browser exceptions');
  console.log('Screenshots: tests/artifacts/');
}catch(error){console.error(error);console.error(browserLog.slice(-5000));process.exitCode=1;}finally{
  if(socket?.readyState===1)socket.close();
  chrome.kill();await new Promise(resolve=>{if(chrome.exitCode!==null||chrome.signalCode!==null)resolve();else{chrome.once('exit',resolve);setTimeout(resolve,3000);}});
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  assert.ok(profile.startsWith(join(tmpdir(),'pocket-mario-test-')));
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
