const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });

/* HUD */
const scoreEl = document.getElementById("score");
const coinsEl = document.getElementById("coins");
const highEl  = document.getElementById("high");
const overlay = document.getElementById("overlay");
const restartBtn = document.getElementById("restartBtn");
const finalScore = document.getElementById("finalScore");
const finalCoins = document.getElementById("finalCoins");

let HIGH = Number(localStorage.getItem("subway_high") || "0");
highEl.textContent = HIGH;

/* SFX */
const SFX = {
  coin: new Audio("https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg"),
  jump: new Audio("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg"),
  hit:  new Audio("https://actions.google.com/sounds/v1/cartoon/punch.ogg"),
  slide:new Audio("https://actions.google.com/sounds/v1/cartoon/woosh.ogg"),
};
Object.values(SFX).forEach(a => { a.volume = 0.5; a.preload = "auto"; });

/* Game state */
const LANES = [-2.4, 0, 2.4];
let scene, camera;

let player, police, dog;
let playerLane = 1;
let velY = 0;
let grounded = true;
let sliding = false;
let slideTimer = 0;

let speed = 0.20; // forward speed
let score = 0;
let coins = 0;
let alive = true;

let biome = 0; // 0 city, 1 sea
let biomeTimer = 0;

const obstacles = [];
const trains = [];
const coinsMeshes = [];
const chunks = [];

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function rand(a, b){ return a + Math.random()*(b-a); }
function choice(arr){ return arr[(Math.random()*arr.length)|0]; }

function createScene() {
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color3(0.72, 0.86, 1.0); // sky

  // Lights
  const hemi = new BABYLON.HemisphericLight("h", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.95;

  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.4, -1, 0.6), scene);
  sun.position = new BABYLON.Vector3(30, 45, -30);
  sun.intensity = 1.1;

  // Camera
  camera = new BABYLON.FollowCamera("cam", new BABYLON.Vector3(0, 6, -10), scene);
  camera.radius = 11;
  camera.heightOffset = 4.2;
  camera.rotationOffset = 0;
  camera.cameraAcceleration = 0.09;
  camera.maxCameraSpeed = 20;

  // Ground + rails chunk system
  for(let i=0;i<14;i++){
    const z = i*10;
    chunks.push(makeChunk(z));
  }

  // Player
  player = makeRunner(new BABYLON.Color3(0.95,0.95,0.95), "runner");
  player.position = new BABYLON.Vector3(LANES[playerLane], 1.05, 2);
  camera.lockedTarget = player;

  // Police + dog
  police = makeRunner(new BABYLON.Color3(0.12,0.25,0.6), "police");
  police.scaling = new BABYLON.Vector3(1.05, 1.05, 1.05);
  police.position = new BABYLON.Vector3(LANES[playerLane], 1.05, -2.5);

  dog = BABYLON.MeshBuilder.CreateBox("dog", { size: 0.7 }, scene);
  const dogMat = new BABYLON.StandardMaterial("dogMat", scene);
  dogMat.diffuseColor = new BABYLON.Color3(0.7, 0.55, 0.25);
  dog.material = dogMat;
  dog.position = new BABYLON.Vector3(LANES[playerLane]-0.9, 0.35, -3.2);

  // Fog for depth
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;

  // Initial spawns
  for(let i=0;i<60;i++) spawnItem(18 + i*4);

  // Update loop
  scene.onBeforeRenderObservable.add(update);

  // Controls
  setupControls();

  restartBtn.onclick = () => {
    overlay.classList.remove("show");
    reset();
  };

  return scene;
}

/* Runner (simple lowpoly character) */
function makeRunner(color, name){
  const root = new BABYLON.TransformNode(name, scene);

  const body = BABYLON.MeshBuilder.CreateBox(name+"_body",{ width:0.75,height:1.15,depth:0.35 },scene);
  const head = BABYLON.MeshBuilder.CreateSphere(name+"_head",{ diameter:0.55 },scene);
  const leg1 = BABYLON.MeshBuilder.CreateBox(name+"_leg1",{ width:0.22,height:0.7,depth:0.22 },scene);
  const leg2 = BABYLON.MeshBuilder.CreateBox(name+"_leg2",{ width:0.22,height:0.7,depth:0.22 },scene);

  const mat = new BABYLON.StandardMaterial(name+"_mat", scene);
  mat.diffuseColor = color;
  mat.specularColor = new BABYLON.Color3(0.1,0.1,0.1);

  body.material = mat; head.material = mat; leg1.material = mat; leg2.material = mat;

  body.parent = root; head.parent = root; leg1.parent = root; leg2.parent = root;

  body.position.y = 1.0;
  head.position.y = 1.65;
  leg1.position.set(-0.18,0.35,0);
  leg2.position.set( 0.18,0.35,0);

  // Running animation
  root._animT = 0;
  root._legs = { leg1, leg2 };

  return root;
}

/* Chunk: tracks + side walls + background (biome changes) */
function makeChunk(z){
  const chunk = new BABYLON.TransformNode("chunk", scene);
  chunk.position.z = z;

  // ground
  const ground = BABYLON.MeshBuilder.CreateGround("g",{ width: 18, height: 10 },scene);
  ground.position.y = 0;
  ground.position.z = 5;
  ground.parent = chunk;

  const gmat = new BABYLON.StandardMaterial("gmat", scene);
  gmat.diffuseColor = new BABYLON.Color3(0.46,0.38,0.28);
  gmat.specularColor = new BABYLON.Color3(0,0,0);
  ground.material = gmat;

  // rails
  for(let i=0;i<3;i++){
    const x = LANES[i];
    const rail1 = BABYLON.MeshBuilder.CreateBox("rail",{ width:0.12,height:0.08,depth:10 },scene);
    rail1.position.set(x-0.45,0.05,5);
    rail1.parent = chunk;

    const rail2 = BABYLON.MeshBuilder.CreateBox("rail",{ width:0.12,height:0.08,depth:10 },scene);
    rail2.position.set(x+0.45,0.05,5);
    rail2.parent = chunk;

    const rmat = new BABYLON.StandardMaterial("rmat", scene);
    rmat.diffuseColor = new BABYLON.Color3(0.2,0.2,0.2);
    rmat.specularColor = new BABYLON.Color3(0.08,0.08,0.08);
    rail1.material = rmat;
    rail2.material = rmat;

    // sleepers
    for(let s=0;s<10;s++){
      const sl = BABYLON.MeshBuilder.CreateBox("sl",{ width:1.3,height:0.06,depth:0.22 },scene);
      sl.position.set(x,0.03, s+0.5);
      sl.parent = chunk;
      const sm = new BABYLON.StandardMaterial("sm", scene);
      sm.diffuseColor = new BABYLON.Color3(0.22,0.14,0.08);
      sl.material = sm;
    }
  }

  // side deco
  const left = BABYLON.MeshBuilder.CreateBox("wallL",{ width:3,height:3,depth:10 },scene);
  const right = BABYLON.MeshBuilder.CreateBox("wallR",{ width:3,height:3,depth:10 },scene);
  left.position.set(-9,1.5,5);
  right.position.set(9,1.5,5);
  left.parent = chunk;
  right.parent = chunk;

  const wmat = new BABYLON.StandardMaterial("wmat", scene);
  wmat.diffuseColor = new BABYLON.Color3(0.9,0.4,0.2);
  left.material = wmat;
  right.material = wmat;

  // buildings (city biome)
  for(let i=0;i<6;i++){
    const b = BABYLON.MeshBuilder.CreateBox("b",{ width:1.8, height: rand(2.5,6.5), depth:1.8 },scene);
    b.position.set(choice([-6.5,6.5]), b.getBoundingInfo().boundingBox.extendSize.y, rand(0,10));
    b.parent = chunk;
    const bm = new BABYLON.StandardMaterial("bm", scene);
    bm.diffuseColor = new BABYLON.Color3(rand(0.3,0.9), rand(0.3,0.9), rand(0.3,0.9));
    bm.specularColor = new BABYLON.Color3(0,0,0);
    b.material = bm;
    b._isBuilding = true;
  }

  // sea plane (sea biome)
  const sea = BABYLON.MeshBuilder.CreateGround("sea",{ width:60, height:30 }, scene);
  sea.position.set(0, -0.35, 5);
  sea.parent = chunk;
  const smat = new BABYLON.StandardMaterial("seaMat", scene);
  smat.diffuseColor = new BABYLON.Color3(0.2,0.55,0.75);
  smat.alpha = 0.0; // start hidden
  sea.material = smat;
  sea._isSea = true;

  chunk._sea = sea;
  return chunk;
}

/* Spawn coins / obstacles / trains */
function spawnItem(z){
  const r = Math.random();

  // coins line
  if(r < 0.62){
    const lane = (Math.random()*3)|0;
    const count = 1 + ((Math.random()*6)|0);
    for(let i=0;i<count;i++){
      const c = BABYLON.MeshBuilder.CreateCylinder("coin",{ diameter:0.55, height:0.12 }, scene);
      c.position.set(LANES[lane], 1.15, z + i*1.0);
      c.rotation.x = Math.PI/2;

      const cm = new BABYLON.StandardMaterial("cm", scene);
      cm.diffuseColor = new BABYLON.Color3(1.0,0.78,0.2);
      cm.emissiveColor = new BABYLON.Color3(0.15,0.1,0.02);
      c.material = cm;

      c._isCoin = true;
      coinsMeshes.push(c);
    }
    return;
  }

  // obstacle barrier
  if(r < 0.88){
    const lane = (Math.random()*3)|0;
    const o = BABYLON.MeshBuilder.CreateBox("obs",{ width:1.35, height: rand(1.0,1.6), depth:0.65 }, scene);
    o.position.set(LANES[lane], o.getBoundingInfo().boundingBox.extendSize.y, z);
    const om = new BABYLON.StandardMaterial("om", scene);
    om.diffuseColor = new BABYLON.Color3(0.95,0.95,0.95);
    o.material = om;
    o._isObstacle = true;

    // red stripes
    const stripe = BABYLON.MeshBuilder.CreatePlane("stripe",{ width:1.3, height:0.35 }, scene);
    stripe.position.set(0, 0, 0.33);
    stripe.parent = o;
    const sm = new BABYLON.StandardMaterial("sm2", scene);
    sm.diffuseColor = new BABYLON.Color3(0.9,0.15,0.12);
    stripe.material = sm;

    obstacles.push(o);
    return;
  }

  // train (danger)
  const lane = (Math.random()*3)|0;
  const t = BABYLON.MeshBuilder.CreateBox("train",{ width:2.1,height:2.0,depth:6.5 }, scene);
  t.position.set(LANES[lane], 1.0, z);
  const tm = new BABYLON.StandardMaterial("tm", scene);
  tm.diffuseColor = new BABYLON.Color3(0.2,0.3,0.35);
  t.material = tm;

  const front = BABYLON.MeshBuilder.CreatePlane("front",{ width:1.4, height:0.7 }, scene);
  front.parent = t;
  front.position.set(0, 0.2, -3.26);
  const fm = new BABYLON.StandardMaterial("fm", scene);
  fm.diffuseColor = new BABYLON.Color3(0.75,0.85,0.95);
  front.material = fm;

  t._isTrain = true;
  trains.push(t);
}

/* Controls */
function setupControls(){
  window.addEventListener("keydown", (e) => {
    if(!alive) return;
    if(e.key === "ArrowLeft") moveLane(-1);
    if(e.key === "ArrowRight") moveLane(1);
    if(e.key === "ArrowUp") jump();
    if(e.key === "ArrowDown") slide();
  });

  // mobile swipe
  let sx=0, sy=0;
  canvas.addEventListener("touchstart",(e)=>{
    const t=e.touches[0];
    sx=t.clientX; sy=t.clientY;
  },{passive:true});

  canvas.addEventListener("touchend",(e)=>{
    const t=e.changedTouches[0];
    const dx=t.clientX - sx;
    const dy=t.clientY - sy;

    if(Math.abs(dx) > Math.abs(dy)){
      if(dx > 35) moveLane(1);
      else if(dx < -35) moveLane(-1);
    } else {
      if(dy < -35) jump();
      else if(dy > 35) slide();
    }
  },{passive:true});
}

function moveLane(dir){
  playerLane = clamp(playerLane + dir, 0, 2);
}

function jump(){
  if(!grounded) return;
  grounded = false;
  velY = 0.26;
  try{ SFX.jump.currentTime=0; SFX.jump.play(); }catch{}
}

function slide(){
  if(sliding) return;
  sliding = true;
  slideTimer = 0.5;
  try{ SFX.slide.currentTime=0; SFX.slide.play(); }catch{}
}

/* Collision helper */
function aabbHit(a, b){
  const A = a.getBoundingInfo().boundingBox;
  const B = b.getBoundingInfo().boundingBox;
  return A.intersectsBox(B);
}

/* Reset */
function reset(){
  // clear spawns
  [...obstacles, ...trains, ...coinsMeshes].forEach(m => m.dispose());
  obstacles.length = 0;
  trains.length = 0;
  coinsMeshes.length = 0;

  // reset state
  alive = true;
  score = 0;
  coins = 0;
  speed = 0.20;
  biome = 0;
  biomeTimer = 0;

  playerLane = 1;
  grounded = true;
  velY = 0;
  sliding = false;
  slideTimer = 0;

  player.position.set(LANES[playerLane], 1.05, 2);
  police.position.set(LANES[playerLane], 1.05, -2.5);
  dog.position.set(LANES[playerLane]-0.9, 0.35, -3.2);

  // respawn
  for(let i=0;i<60;i++) spawnItem(18 + i*4);
}

/* Game update */
function update(){
  const dt = engine.getDeltaTime() / 1000;

  if(!alive){
    // tiny idle animation
    animateRunner(player, dt, 0.2);
    return;
  }

  // difficulty increases gradually
  speed += dt * 0.0025;
  score += dt * (20 + speed*80);

  // biome switching
  biomeTimer += dt;
  if(biomeTimer > 18){
    biomeTimer = 0;
    biome = (biome + 1) % 2;
    applyBiome(biome);
  }

  // player lane smoothing
  const targetX = LANES[playerLane];
  player.position.x += (targetX - player.position.x) * (dt * 14);

  // jump physics
  if(!grounded){
    velY -= dt * 0.75;
    player.position.y += velY * 9.0;
    if(player.position.y <= 1.05){
      player.position.y = 1.05;
      grounded = true;
      velY = 0;
    }
  }

  // slide
  if(sliding){
    slideTimer -= dt;
    // squash player collider visually
    player.scaling.y = 0.65;
    if(slideTimer <= 0){
      sliding = false;
      player.scaling.y = 1.0;
    }
  }

  // run animation
  animateRunner(player, dt, 1.0 + speed*2.5);

  // police chase animation / distance
  police.position.x += (player.position.x - police.position.x) * (dt * 10);
  police.position.z += (-2.5 - police.position.z) * (dt * 4);
  animateRunner(police, dt, 0.9 + speed*2.0);

  dog.position.x += ((police.position.x - 0.9) - dog.position.x) * (dt * 8);

  // move world items towards player
  const forward = speed * 60 * dt;

  // chunks loop
  chunks.forEach(ch => {
    ch.position.z -= forward;
    if(ch.position.z < -10){
      ch.position.z += 140;
    }
  });

  // items move
  moveAndCollide(coinsMeshes, forward, "coin");
  moveAndCollide(obstacles, forward, "obstacle");
  moveAndCollide(trains, forward, "train");

  // add more spawns ahead
  if(Math.random() < dt*1.8){
    spawnItem(80 + rand(0,20));
  }

  // HUD
  scoreEl.textContent = Math.floor(score);
  coinsEl.textContent = coins;
  highEl.textContent = HIGH;
}

function animateRunner(runner, dt, speedMul){
  runner._animT += dt * speedMul * 8;
  const t = runner._animT;
  const a = Math.sin(t) * 0.6;
  runner._legs.leg1.rotation.x = a;
  runner._legs.leg2.rotation.x = -a;
}

function moveAndCollide(list, forward, type){
  for(let i=list.length-1;i>=0;i--){
    const m = list[i];
    m.position.z -= forward;

    // spin coins
    if(type==="coin"){
      m.rotation.z += 0.12;
      if(m.position.z < -10){
        m.dispose(); list.splice(i,1); continue;
      }
      if(aabbHitCoin(m, player)){
        coins++;
        try{ SFX.coin.currentTime=0; SFX.coin.play(); }catch{}
        m.dispose(); list.splice(i,1);
      }
      continue;
    }

    // obstacle/train
    if(m.position.z < -12){
      m.dispose(); list.splice(i,1); continue;
    }

    if(m.position.z < 6 && m.position.z > -2){
      if(aabbHitSimple(m, player)){
        // for low obstacles allow slide to dodge
        if(type==="obstacle" && sliding && m.scaling.y <= 1.6){
          // slide dodge ok
        } else {
          crash();
        }
      }
    }
  }
}

function aabbHitSimple(ob, runner){
  // slightly smaller player hitbox for fairness
  const p = new BABYLON.BoundingInfo(
    runner.getBoundingInfo().boundingBox.minimumWorld.add(new BABYLON.Vector3(0.15,0.0,0.1)),
    runner.getBoundingInfo().boundingBox.maximumWorld.add(new BABYLON.Vector3(-0.15,0.0,-0.1))
  );
  return p.boundingBox.intersectsBox(ob.getBoundingInfo().boundingBox);
}

function aabbHitCoin(coin, runner){
  // coin pickup radius
  const dx = coin.position.x - runner.position.x;
  const dy = coin.position.y - (runner.position.y+0.35);
  const dz = coin.position.z - runner.position.z;
  const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
  return d < 0.75;
}

/* Biomes */
function applyBiome(b){
  if(b===0){
    scene.clearColor = new BABYLON.Color3(0.72, 0.86, 1.0);
    chunks.forEach(ch=>{
      if(ch._sea) ch._sea.material.alpha = 0.0;
      ch.getChildMeshes().forEach(m=>{
        if(m._isBuilding) m.isVisible = true;
      });
    });
  } else {
    scene.clearColor = new BABYLON.Color3(0.84, 0.93, 1.0);
    chunks.forEach(ch=>{
      if(ch._sea) ch._sea.material.alpha = 0.55;
      ch.getChildMeshes().forEach(m=>{
        if(m._isBuilding) m.isVisible = false;
      });
    });
  }
}

/* Crash */
function crash(){
  alive = false;
  try{ SFX.hit.currentTime=0; SFX.hit.play(); }catch{}

  const s = Math.floor(score);

  if(s > HIGH){
    HIGH = s;
    localStorage.setItem("subway_high", String(HIGH));
  }

  finalScore.textContent = String(s);
  finalCoins.textContent = String(coins);
  overlay.classList.add("show");
}

const sceneToRender = createScene();
engine.runRenderLoop(() => {
  sceneToRender.render();
});

window.addEventListener("resize", () => engine.resize());
