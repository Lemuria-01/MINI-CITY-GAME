(() => {
  // ===== Canvas & DPR =====
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const mini = document.getElementById('minimap');
  const mctx = mini.getContext('2d');
  const hpFill = document.getElementById('hpFill');
  const hpLabel = document.getElementById('hpLabel');
  const starsEl = document.getElementById('stars');
  const invEl = document.getElementById('inv');

  const state = { w:0, h:0, dpr:1, last:0, camX:0, camY:0, keys:{}, mouse:{x:0,y:0,down:false}, mobile:false };
  function resize(){
    state.dpr = Math.max(1, Math.min(window.devicePixelRatio||1, 2));
    state.w = Math.floor(window.innerWidth);
    state.h = Math.floor(window.innerHeight);
    canvas.width = state.w*state.dpr; canvas.height = state.h*state.dpr;
    canvas.style.width = state.w+'px'; canvas.style.height = state.h+'px';
    ctx.setTransform(state.dpr,0,0,state.dpr,0,0);
  }
  window.addEventListener('resize', resize); resize();
  state.mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ===== World =====
  const TILE=48, W=44, H=44; // карта 44x44 тайла
  const map=[];
  for(let y=0;y<H;y++){
    map[y]=[];
    for(let x=0;x<W;x++){
      const road=(x%4===0)||(y%4===0);
      map[y][x]= road?0:1; // 0 road, 1 block
    }
  }
  function isRoad(tx,ty){ return tx>=0&&ty>=0&&tx<W&&ty<H && map[ty][tx]===0; }
  function blocked(px,py){
    const tx=(px/TILE|0), ty=(py/TILE|0);
    return !(tx>=0&&ty>=0&&tx<W&&ty<H) || map[ty][tx]===1;
  }

  // ===== Entities =====
  const PLAYER_SPEED=180, BULLET_SPEED=560, NPC_SPEED=80, CAR_SPEED=120;
  const Weapons = [
    {id:'knife', name:'Нож', type:'melee', dmg:30, range:24, cd:0.3},
    {id:'pistol', name:'Пистолет', type:'gun', dmg:20, cd:0.18},
    {id:'smg', name:'Автомат', type:'gun', dmg:10, cd:0.08}
  ];

  const player = {
    x:TILE*6+24, y:TILE*6+24, r:12,
    vx:0, vy:0, dir:{x:1,y:0},
    hp:100, maxHp:100,
    weaponIndex:1, shootCD:0, punchCD:0,
    inCar:null, inventory:[] // items: {id:'package'}
  };
  function invHas(id){ return player.inventory.some(it=>it.id===id); }
  function invAdd(id){ player.inventory.push({id}); refreshInventory(); }
  function invRemove(id){ const i=player.inventory.findIndex(it=>it.id===id); if(i>=0){ player.inventory.splice(i,1); refreshInventory(); } }
  function refreshInventory(){
    const w = Weapons[player.weaponIndex];
    const items = player.inventory.map(it=>it.id).join(', ') || 'пусто';
    invEl.innerHTML = `<b>Оружие:</b> ${w.name}<br/><b>Инвентарь:</b> ${items}`;
  }
  refreshInventory();

  const bullets=[];
  const npcs=[]; const cars=[]; const cops=[]; // полицейские пешие
  // spawn civilians
  for(let i=0;i<20;i++){
    const p=findSidewalk(); npcs.push({x:p.x,y:p.y,r:10,vx:0,vy:0,t:Math.random()*2,alive:true,id:`npc${i}`});
  }
  // mission givers:
  const givers=[]; // {npc, type:'deliver'|'kill', data:...}
  // giver A -> deliver
  const giverA = spawnNPCNear(TILE*10, TILE*10); givers.push({npc: giverA, type:'deliver', data:{}});
  // giver B -> kill target
  const targetNPC = spawnNPCNear(TILE*30, TILE*32);
  const giverB = spawnNPCNear(TILE*26, TILE*12); givers.push({npc: giverB, type:'assassinate', data:{target: targetNPC}});

  // cars
  for(let i=0;i<12;i++){
    const p=findRoadCenter(); const horiz=Math.random()<.5;
    const dir = horiz? {x:Math.random()<.5?1:-1,y:0} : {x:0,y:Math.random()<.5?1:-1};
    cars.push({x:p.x,y:p.y,w:32,h:18,dir,speed:CAR_SPEED*(.8+Math.random()*0.4), driver: Math.random()<.5? spawnDriverAt(p.x,p.y): null});
  }

  function spawnDriverAt(x,y){ // водитель-NPC (сидит в машине)
    return { x, y, inCar:true, alive:true, r:10, vx:0, vy:0, id:`drv${Math.random()}` };
  }
  function spawnNPCNear(x,y){
    const p= findNearWalkable(x,y); const npc={x:p.x,y:p.y,r:10,vx:0,vy:0,t:0.5+Math.random()*1.5,alive:true,id:`npcG${Math.random()}`};
    npcs.push(npc); return npc;
  }
  function findRoadCenter(){
    while(true){ const x=(Math.random()*W|0), y=(Math.random()*H|0); if(isRoad(x,y)) return {x:x*TILE+24, y:y*TILE+24};}
  }
  function findSidewalk(){
    while(true){ const x=(Math.random()*W|0), y=(Math.random()*H|0);
      if(map[y][x]===1 && (isRoad(x+1,y)||isRoad(x-1,y)||isRoad(x,y+1)||isRoad(x,y-1)))
        return {x:x*TILE+24, y:y*TILE+24};
    }
  }
  function findNearWalkable(px,py){
    for(let r=0;r<10;r++){
      const x = ((px/TILE|0)+ (Math.random()*5|0)-2);
      const y = ((py/TILE|0)+ (Math.random()*5|0)-2);
      if(y>=0&&x>=0&&y<H&&x<W && map[y][x]===1) return {x:x*TILE+24,y:y*TILE+24};
    }
    return findSidewalk();
  }

  // ===== Wanted (stars) + police spawn =====
  let wanted=0; // 0..5
  updateStars();
  function addWanted(n){
    wanted = Math.max(0, Math.min(5, wanted+n));
    updateStars();
  }
  function decayWanted(dt){
    if(wanted<=0) return;
    wantedTimer -= dt;
    if (wantedTimer<=0){ wanted--; wantedTimer=DECAY_TIME; updateStars(); }
  }
  const DECAY_TIME=20; let wantedTimer=DECAY_TIME;
  function updateStars(){
    starsEl.innerHTML='';
    for(let i=0;i<5;i++){
      const s=document.createElement('div'); s.className='star'+(i<wanted?' on':''); s.classList.add('star');
      s.innerHTML='⭐'; starsEl.appendChild(s);
    }
  }
  function ensureCops(){
    // простая логика: wanted>=1 -> 2 копа преследуют, >=3 -> 4
    const need = wanted===0?0 : (wanted<3?2:4);
    while(cops.length<need) cops.push(spawnCop());
    while(cops.length>need) cops.pop();
  }
  function spawnCop(){
    const p=findRoadCenter();
    return {x:p.x,y:p.y,r:11,vx:0,vy:0,spd:140,hp:60,shootCD:0,alive:true};
  }

  // ===== Missions =====
  let activeMission=null; // {type:'deliver'|'assassinate', stage, data...}
  const dlg = document.getElementById('dlg');
  const dlgTitle = document.getElementById('dlgTitle');
  const dlgText  = document.getElementById('dlgText');
  document.getElementById('dlgClose').onclick = ()=> dlg.hidden=true;
  document.getElementById('dlgStart').onclick = ()=>{
    if(!pendingOffer) return;
    startMission(pendingOffer);
    dlg.hidden=true;
  };
  let pendingOffer=null;

  function offerMission(giver){
    pendingOffer=giver;
    if(giver.type==='deliver'){
      dlgTitle.textContent='Миссия: Доставка';
      dlgText.textContent='Возьми посылку и отвези получателю. По миникарте появится отметка, GPS подсветит путь.';
    }else{
      dlgTitle.textContent='Миссия: Устранение';
      dlgText.textContent='Найди и устрани цель. Цель отмечена на миникарте.';
    }
    dlg.hidden=false;
  }
  function startMission(giver){
    if(giver.type==='deliver'){
      activeMission = {type:'deliver', stage:'got', target: spawnRecipient(), routeTick:0};
      if(!invHas('package')) invAdd('package');
    }else{
      activeMission = {type:'assassinate', target: giver.data.target};
    }
  }
  function spawnRecipient(){
    const npc=spawnNPCNear(TILE*36, TILE*8);
    npc.recipient=true; return npc;
  }
  function completeMission(){
    // простая награда
    addWanted(-1);
    activeMission=null;
  }

  // ===== Input desktop =====
  window.addEventListener('keydown', e=>{
    const k=e.key.toLowerCase(); state.keys[k]=true;
    if(k==='1'){ player.weaponIndex=0; refreshInventory(); }
    if(k==='2'){ player.weaponIndex=1; refreshInventory(); }
    if(k==='3'){ player.weaponIndex=2; refreshInventory(); }
    if(k==='e'){ interact(); }
    if(k==='f'){ punch(); }
  });
  window.addEventListener('keyup', e=>{ state.keys[e.key.toLowerCase()]=false; });

  // mouse
  canvas.addEventListener('mousemove', e=>{
    const r=canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - r.left + state.camX;
    state.mouse.y = e.clientY - r.top  + state.camY;
  });
  canvas.addEventListener('mousedown', ()=>{ state.mouse.down=true; shoot(); });
  window.addEventListener('mouseup', ()=>{ state.mouse.down=false; });

  // mobile controls
  const joy = document.getElementById('joy');
  const knob = document.getElementById('joyKnob');
  const actions = {
    shootBtn: document.getElementById('btnShoot'),
    useBtn:   document.getElementById('btnUse'),
    punchBtn: document.getElementById('btnPunch'),
    cycleBtn: document.getElementById('btnCycle')
  };
  actions.shootBtn.onclick=()=>shoot();
  actions.useBtn.onclick=()=>interact();
  actions.punchBtn.onclick=()=>punch();
  actions.cycleBtn.onclick=()=>{ player.weaponIndex=(player.weaponIndex+1)%Weapons.length; refreshInventory(); };

  let joyActive=false, joyVec={x:0,y:0};
  const joyRect=()=> joy.getBoundingClientRect();
  joy.addEventListener('pointerdown',e=>{ e.preventDefault(); joyActive=true; joyMove(e.clientX,e.clientY); });
  window.addEventListener('pointermove',e=>{ if(joyActive){ e.preventDefault(); joyMove(e.clientX,e.clientY);} }, {passive:false});
  window.addEventListener('pointerup',()=>{ joyActive=false; knob.style.transform='translate(-50%,-50%)'; joyVec={x:0,y:0}; });
  function joyMove(x,y){
    const r=joyRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
    const dx=x-cx, dy=y-cy; const max=r.width*0.38; const L=Math.hypot(dx,dy)||1;
    const nx=dx/L, ny=dy/L, m=Math.min(L,max);
    knob.style.transform=`translate(${nx*m}px,${ny*m}px) translate(-50%,-50%)`;
    joyVec={x:(m/max)*nx, y:(m/max)*ny};
  }

  function moveVector(){
    if(joyActive) return {...joyVec};
    const v={x:0,y:0}; const k=state.keys;
    if(k['w']) v.y-=1; if(k['s']) v.y+=1; if(k['a']) v.x-=1; if(k['d']) v.x+=1;
    const L=Math.hypot(v.x,v.y)||1; return {x:v.x/L,y:v.y/L};
  }

  // ===== Actions =====
  function shoot(){
    if(player.inCar) { addWanted(1); return; } // в машине стрелять пока не реализуем
    const weap = Weapons[player.weaponIndex];
    if(weap.type==='melee'){ punch(); return; }
    if(player.shootCD>0) return;
    let dir;
    if(!state.mobile && (state.mouse.x||state.mouse.y)){
      const dx=state.mouse.x-player.x, dy=state.mouse.y-player.y, L=Math.hypot(dx,dy)||1; dir={x:dx/L,y:dy/L};
    }else{
      const mv=moveVector(); const L=Math.hypot(mv.x,mv.y)||1; dir=L<0.2?player.dir:{x:mv.x/L,y:mv.y/L};
    }
    bullets.push({x:player.x,y:player.y,vx:dir.x*BULLET_SPEED,vy:dir.y*BULLET_SPEED,life:1.2,dmg:weap.dmg});
    player.dir=dir; player.shootCD=weap.cd;
    addWanted(1); // за стрельбу
  }
  function interact(){
    // приоритет: миссия-дающий, вход в машину, сдача доставки
    const nearGiver = givers.find(g=>dist(g.npc, player)<36 && g.npc.alive!==false);
    if(nearGiver){ offerMission(nearGiver); return; }

    // сдача доставки
    if(activeMission && activeMission.type==='deliver' && activeMission.stage==='got'){
      const rec = npcs.find(n=>n.recipient);
      if(rec && dist(rec,player)<36 && invHas('package')){
        invRemove('package'); completeMission();
        return;
      }
    }

    // вход в авто (ближайшее)
    const car = nearestCar(36);
    if(car){
      // если есть водитель — «вытолкнуть»
      if(car.driver && car.driver.alive){
        const d=car.driver; d.inCar=false; d.x=car.x+20; d.y=car.y; d.vx=80; d.vy=0;
        npcs.push(d); car.driver=null; addWanted(1); // угон -> розыск
      }
      player.inCar=car;
      return;
    }
  }
  function punch(){
    const weap=Weapons[player.weaponIndex];
    if(weap.type!=='melee'){ // рукопашка без ножа
      // лёгкий удар кулаком
      if(player.punchCD>0) return; player.punchCD=0.35;
      hitAround(24,12); return;
    }
    if(player.punchCD>0) return; player.punchCD=weap.cd;
    hitAround(weap.range, weap.dmg);
  }
  function hitAround(range,dmg){
    for(const n of npcs){
      if(!n.alive) continue;
      if(dist(n,player)<range){ n.alive=false; if(activeMission && activeMission.type==='assassinate' && activeMission.target===n){ completeMission(); } addWanted(1); }
    }
    for(const c of cops){ if(c.alive && dist(c,player)<range){ c.hp-=dmg; if(c.hp<=0) c.alive=false; addWanted(1);} }
  }

  function nearestCar(rad){
    let best=null, bd=1e9;
    for(const c of cars){
      const d=Math.hypot(c.x-player.x, c.y-player.y);
      if(d<rad && d<bd){ bd=d; best=c; }
    }
    return best;
  }

  // ===== Update loop =====
  function loop(t){
    if(!state.last) state.last=t;
    const dt = Math.min((t-state.last)/1000, 1/30); state.last=t;

    update(dt); render(); requestAnimationFrame(loop);
  }

  function update(dt){
    // cooldowns
    if(player.shootCD>0) player.shootCD-=dt;
    if(player.punchCD>0) player.punchCD-=dt;

    // wanted logic
    decayWanted(dt); ensureCops();

    // player movement / car control
    if(player.inCar){
      const car=player.inCar;
      const mv=moveVector();
      car.x += mv.x*CAR_SPEED*dt*1.2; car.y += mv.y*CAR_SPEED*dt*1.2;
      // выход из авто (Space)
      if(state.keys[' ']||state.keys['space']){
        player.inCar=null; player.x=car.x+18; player.y=car.y; state.keys[' ']=false; state.keys['space']=false;
      }
      // камеры за машиной
      state.camX = car.x - state.w/2; state.camY = car.y - state.h/2;
      player.x = car.x; player.y = car.y; // якорим игрока
    }else{
      const mv=moveVector(); let nx=player.x+mv.x*PLAYER_SPEED*dt, ny=player.y+mv.y*PLAYER_SPEED*dt;
      if(!blocked(nx,player.y)) player.x=nx; else if(!blocked(player.x+Math.sign(mv.x)*12, player.y)) player.x+=Math.sign(mv.x)*80*dt;
      if(!blocked(player.x,ny)) player.y=ny; else if(!blocked(player.x, player.y+Math.sign(mv.y)*12)) player.y+=Math.sign(mv.y)*80*dt;
      if(Math.hypot(mv.x,mv.y)>0.2) player.dir=mv;
      state.camX = player.x - state.w/2; state.camY = player.y - state.h/2;
    }
    clampCam();

    // bullets
    for(let i=bullets.length-1;i>=0;i--){
      const b=bullets[i]; b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
      if(b.life<=0 || blocked(b.x,b.y)) { bullets.splice(i,1); continue; }
      // hit npcs / cops
      for(const n of npcs){ if(n.alive && Math.hypot(n.x-b.x,n.y-b.y)<n.r){ n.alive=false; bullets.splice(i,1); addWanted(1); if(activeMission && activeMission.type==='assassinate' && activeMission.target===n){ completeMission(); } break; } }
      for(const c of cops){ if(c.alive && Math.hypot(c.x-b.x,c.y-b.y)<c.r){ c.hp-=b.dmg; bullets.splice(i,1); if(c.hp<=0)c.alive=false; addWanted(1); break; } }
    }

    // civilians wander
    for(const n of npcs){
      if(!n.alive) continue;
      n.t-=dt; if(n.t<=0){ const ang=Math.random()*Math.PI*2; n.vx=Math.cos(ang)*NPC_SPEED; n.vy=Math.sin(ang)*NPC_SPEED; n.t=1+Math.random()*2; }
      const nx=n.x+n.vx*dt, ny=n.y+n.vy*dt;
      if(!blocked(nx,ny)){ n.x=nx; n.y=ny; } else { n.vx*=-1; n.vy*=-1; }
    }

    // cars AI (простое)
    for(const c of cars){
      // припаркованные с шансом стоят
      if(Math.random()<0.002) c.dir = {x:0,y:0};
      if(Math.random()<0.002) c.dir = Math.random()<.5? {x:(Math.random()<.5?1:-1),y:0}:{x:0,y:(Math.random()<.5?1:-1)};
      c.x += c.dir.x*c.speed*dt; c.y += c.dir.y*c.speed*dt;
      const tx=(c.x/TILE|0), ty=(c.y/TILE|0);
      if(!(tx>=0&&ty>=0&&tx<W&&ty<H) || !isRoad(tx,ty)){ c.dir.x*=-1; c.dir.y*=-1; }
      // если в машине есть водитель NPC — держим его внутри
      if(c.driver) { c.driver.x=c.x; c.driver.y=c.y; }
    }

    // cops chase
    for(const cop of cops){
      if(!cop.alive) continue;
      const dx=player.x-cop.x, dy=player.y-cop.y; const L=Math.hypot(dx,dy)||1;
      cop.vx = (dx/L)*cop.spd; cop.vy=(dy/L)*cop.spd;
      const nx=cop.x+cop.vx*dt, ny=cop.y+cop.vy*dt;
      if(!blocked(nx,ny)){ cop.x=nx; cop.y=ny; }
      // стрельба по игроку простая
      cop.shootCD-=dt;
      if(L<220 && cop.shootCD<=0 && wanted>0){
        const vx=(dx/L)*BULLET_SPEED*0.9, vy=(dy/L)*BULLET_SPEED*0.9;
        bullets.push({x:cop.x,y:cop.y,vx,vy,life:1.2,dmg:8,fromCop:true});
        cop.shootCD=0.6;
      }
      // попадание по игроку
      for(let i=bullets.length-1;i>=0;i--){
        const b=bullets[i]; if(!b.fromCop) continue;
        if(Math.hypot(player.x-b.x, player.y-b.y)<player.r){ bullets.splice(i,1); damage(8); }
      }
      // арест/удар
      if(L<18){ busted(); }
    }

    // HP UI
    hpFill.style.width = `${(player.hp/player.maxHp)*100}%`;
    hpLabel.textContent = `HP ${Math.max(0,player.hp|0)}/${player.maxHp}`;

    // continuous shooting on desktop hold
    if(!state.mobile && state.mouse.down) shoot();
  }

  function damage(n){
    player.hp-=n; if(player.hp<=0){ player.hp=0; busted(); }
  }
  function busted(){
    // простая перезагрузка сцены
    player.hp=player.maxHp; wanted=0; updateStars(); player.inCar=null;
    bullets.length=0; state.camX=player.x- state.w/2; state.camY=player.y- state.h/2;
  }

  // ===== Render =====
  function render(){
    ctx.clearRect(0,0,state.w,state.h);
    ctx.save(); ctx.translate(-state.camX, -state.camY);

    // map
    for(let y=0;y<H;y++){
      for(let x=0;x<W;x++){
        const X=x*TILE, Y=y*TILE;
        if(map[y][x]===0){
          ctx.fillStyle='#2b3d47'; ctx.fillRect(X,Y,TILE,TILE);
          if(x%4===0||y%4===0){ ctx.fillStyle='#3f535f'; ctx.fillRect(X+TILE/2-2,Y,4,TILE); ctx.fillRect(X,Y+TILE/2-2,TILE,4); }
        }else{
          ctx.fillStyle='#394a54'; ctx.fillRect(X,Y,TILE,TILE);
          ctx.fillStyle='rgba(255,255,255,.06)';
          for(let i=8;i<TILE-6;i+=12) for(let j=8;j<TILE-6;j+=12) ctx.fillRect(X+i,Y+j,4,6);
        }
      }
    }

    // route highlight for delivery
    if(activeMission && activeMission.type==='deliver'){
      const rec=npcs.find(n=>n.recipient);
      if(rec){ ctx.strokeStyle='rgba(255,223,70,.9)'; ctx.lineWidth=3; ctx.setLineDash([8,6]);
        ctx.beginPath(); ctx.moveTo(player.x,player.y); ctx.lineTo(rec.x, rec.y); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // cars
    for(const c of cars){
      ctx.fillStyle='#ffc84d'; ctx.fillRect(c.x-16,c.y-9,32,18);
      ctx.fillStyle='#222'; ctx.fillRect(c.x-14,c.y-8,28,6);
    }

    // civilians
    for(const n of npcs){
      if(!n.alive) continue;
      ctx.fillStyle='#8bd1ff'; ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2); ctx.fill();
    }

    // mission givers icons
    for(const g of givers){
      if(!g.npc.alive) continue;
      ctx.fillStyle='#ffd54f'; ctx.font='700 16px system-ui'; ctx.textAlign='center';
      ctx.fillText('!', g.npc.x, g.npc.y - 16);
    }
    // recipient mark
    const rec=npcs.find(n=>n.recipient);
    if(rec){ ctx.fillStyle='#ffd54f'; ctx.fillRect(rec.x-6, rec.y-6, 12,12); }

    // cops
    for(const cop of cops){
      if(!cop.alive) continue;
      ctx.fillStyle='#1f5b95'; ctx.beginPath(); ctx.arc(cop.x,cop.y,cop.r,0,Math.PI*2); ctx.fill();
    }

    // bullets
    ctx.fillStyle='#ffe082';
    for(const b of bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,3,0,Math.PI*2); ctx.fill(); }

    // player (or car)
    ctx.fillStyle='#ffddad'; ctx.beginPath(); ctx.arc(player.x,player.y,player.r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#13242b'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(player.x,player.y);
    ctx.lineTo(player.x+player.dir.x*18, player.y+player.dir.y*18); ctx.stroke();

    ctx.restore();

    // minimap
    drawMinimap();
  }

  function drawMinimap(){
    const mw=mini.width, mh=mini.height; mctx.clearRect(0,0,mw,mh);
    const scaleX=mw/(W*TILE), scaleY=mh/(H*TILE);
    // roads
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      if(map[y][x]===0){ mctx.fillStyle='#263743'; mctx.fillRect(x*TILE*scaleX,y*TILE*scaleY,TILE*scaleX,TILE*scaleY); }
      else { mctx.fillStyle='#6b8594'; mctx.fillRect(x*TILE*scaleX,y*TILE*scaleY,TILE*scaleX,TILE*scaleY); }
    }
    // cars
    mctx.fillStyle='#ffd54f'; for(const c of cars) mctx.fillRect(c.x*scaleX-2,c.y*scaleY-2,4,4);
    // cops
    mctx.fillStyle='#90caf9'; for(const cop of cops) if(cop.alive) mctx.fillRect(cop.x*scaleX-2,cop.y*scaleY-2,4,4);
    // npcs (faint)
    mctx.fillStyle='#80deea'; for(const n of npcs) if(n.alive) mctx.fillRect(n.x*scaleX-1.5,n.y*scaleY-1.5,3,3);
    // mission marks
    const rec=npcs.find(n=>n.recipient);
    if(rec){ mctx.fillStyle='#ffeb3b'; mctx.fillRect(rec.x*scaleX-3,rec.y*scaleY-3,6,6); }
    if(activeMission && activeMission.type==='assassinate' && activeMission.target && activeMission.target.alive){
      const t=activeMission.target; mctx.fillStyle='#ef5350'; mctx.fillRect(t.x*scaleX-3,t.y*scaleY-3,6,6);
    }
    // player
    mctx.fillStyle='#ff8a65'; mctx.fillRect(player.x*scaleX-3,player.y*scaleY-3,6,6);
  }

  // ===== Utils =====
  function clampCam(){
    const maxX=W*TILE - state.w, maxY=H*TILE - state.h;
    state.camX=Math.max(0,Math.min(maxX,state.camX));
    state.camY=Math.max(0,Math.min(maxY,state.camY));
  }
  function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }

  // ===== Start =====
  requestAnimationFrame(loop);
})();
