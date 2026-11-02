(function () {
  'use strict';

  // ===================== 配置 =====================
  const CFG = {
    world: 200,
    duration: 120,
    startRadius: 3.4,
    maxRadius: 52,
    playerSpeed: 30,
    aiCount: 4,
    growthK: 0.16,
    eatRatio: 1.15
  };

  const ROAD_X = [-90, 0, 90];
  const ROAD_Z = [-90, 0, 90];
  const ROAD_W = 22;
  const SIDE_W = 3.5;
  const OCC = ROAD_W / 2 + SIDE_W;   // 道路+人行道占的半宽

  // ===================== 城市色板（低饱和，参考城市天际线） =====================
  const CITY = {
    brick: ['#b2654e', '#a75a43', '#c07a5f', '#9e5540', '#ab6148'],
    stucco: ['#e8dfc9', '#ddd2b8', '#7a74b0', '#d4c6a8', '#6a68a8'],
    glass: ['#7a86d8', '#6a74c8', '#8490e2', '#7280cc', '#8a96e0'],
    frame: ['#f4efe4', '#e9e2d4', '#d6cebd'],
    roof: ['#a8452f', '#8f3a28', '#b0513a', '#4d545a', '#3f6b6b', '#96543f'],
    awn: ['#c4553f', '#3f7fa8', '#d08a3a', '#4f9a63', '#8a5f9e', '#c47b3f'],
    concrete: ['#b8b4ad', '#a9a69f', '#c4c0b8', '#9fa8ad']
  };

  // ===================== 全局 =====================
  let scene, camera, renderer, clock;
  let preys = [];
  let mouths = [];
  let player = null;
  let ais = [];
  let placed = [];
  let state = 'menu';
  let timeLeft = CFG.duration;
  let eatCount = 0;
  let audioCtx = null, muted = false;
  const input = { vx: 0, vz: 0 };

  let boxGeo, circleGeo, torusGeo, cylOpenGeo, coneGeo, cylGeo, sphereGeo, hipGeo;
  let holeGeo, holeWallGeo, grassTex, dashTex, crossTex, holeTex, umbrellaTex, texCache = {};
  let toothMat, windowTextures = [];

  // ===================== 美术资产（生图模型重制，billboard 贴片） =====================
  // key: [png 路径, 世界高度]
  const ASSETS = {
    bld_shop_pink: ['assets/bld_shop_pink.png', 13.0],
    bld_shop_cream: ['assets/bld_shop_cream.png', 13.0],
    bld_shop_mint: ['assets/bld_shop_mint.png', 13.0],
    bld_apt: ['assets/bld_apt.png', 30.0],
    bld_office: ['assets/bld_office.png', 42.0],
    tree_cloud: ['assets/tree_cloud.png', 7.2],
    tree_pine: ['assets/tree_pine.png', 7.6],
    bush: ['assets/bush.png', 2.0],
    planter: ['assets/planter.png', 1.7],
    bin: ['assets/bin.png', 1.8],
    hydrant: ['assets/hydrant.png', 1.5],
    lamp: ['assets/lamp.png', 8.5],
    trafficlight: ['assets/trafficlight.png', 6.0],
    busstop: ['assets/busstop.png', 5.0],
    bench: ['assets/bench.png', 1.6],
    fountain: ['assets/fountain.png', 8.0],
    car_red: ['assets/car_red.png', 3.4],
    car_blue: ['assets/car_blue.png', 3.6],
    ped_yellow: ['assets/ped_yellow.png', 2.4],
    ped_red: ['assets/ped_red.png', 2.4],
    ped_white: ['assets/ped_white.png', 2.4]
  };
  const texs = {};
  // 预加载全部贴图，完成后回调
  function loadAssets(done) {
    const keys = Object.keys(ASSETS);
    let n = 0, fired = false;
    const fin = () => { if (!fired && ++n >= keys.length) { fired = true; done(); } };
    const loader = new THREE.TextureLoader();
    const DATA = window.__ASSET_DATA || null;
    for (const k of keys) {
      // 优先用内联 base64（WebView 下 file:// 读图会污染 WebGL 纹理），没有则回退到文件
      const src = (DATA && DATA[k]) || ASSETS[k][0];
      loader.load(src, (t) => {
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = 4;
        texs[k] = t; fin();
      }, undefined, () => fin());
    }
    if (!keys.length) done();
  }
  // 竖立贴片：底边贴地，高 worldH，宽按图片原始比例（保证不变形）
  function spriteOf(key, worldH, yOffset) {
    const t = texs[key];
    const t0 = t || texs[Object.keys(texs)[0]];
    const ar = (t0 && t0.image) ? t0.image.width / t0.image.height : 1;
    const h = worldH || ASSETS[key][1];
    const w = h * ar;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: t0, transparent: true, alphaTest: 0.2, depthWrite: true, fog: true
    }));
    sp.scale.set(w, h, 1);
    sp.position.y = h * 0.5 + (yOffset || 0);
    sp.userData.w = w; sp.userData.h = h;
    return sp;
  }

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const inOcean = (x, z) => (x > 100 && z > 100);
  let stickBase = null, stickKnob = null, playerTag = null, playerTagBall = null, playerTagNum = null, playerTagText = null;
  const aiTags = [];
  const ray = new THREE.Ray(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpProj = new THREE.Vector3();
  // 动态 UI：虚拟摇杆（参考录屏的基座圈+方向球）与 LVL 等级标签
  function buildDynamicUI() {
    if (!document.body || !document.createElement) return;
    try {
      const mk = (css) => {
        const d = document.createElement('div');
        d.style.cssText = css;
        document.body.appendChild(d);
        return d;
      };
      stickBase = mk('position:fixed;left:0;top:0;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:2px solid rgba(255,255,255,0.8);background:rgba(255,255,255,0.15);pointer-events:none;z-index:30;display:none;');
      stickKnob = mk('position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,0.95);box-shadow:0 2px 8px rgba(0,0,0,0.3);pointer-events:none;z-index:31;display:none;');
      // 玩家等级标签：LVL 文本 + 黑底计数条（蓝色圆球 + n/10，参考录屏同款）
      playerTag = mk('position:fixed;left:-999px;top:-999px;transform:translate(-50%,-100%);pointer-events:none;z-index:25;text-align:center;');
      playerTagText = document.createElement('div');
      playerTagText.style.cssText = 'font-weight:700;font-size:18px;color:#37c8ff;text-shadow:0 1px 3px rgba(0,0,0,0.6);letter-spacing:1px;';
      playerTagText.textContent = 'LVL 1';
      playerTag.appendChild(playerTagText);
      const bar = document.createElement('div');
      bar.style.cssText = 'position:relative;width:96px;height:20px;margin:2px auto 0;background:#22242e;border:1.5px solid rgba(255,255,255,0.35);border-radius:11px;overflow:hidden;';
      playerTagBall = document.createElement('div');
      playerTagBall.style.cssText = 'position:absolute;top:2.5px;left:2px;width:12px;height:12px;border-radius:50%;background:#37c8ff;';
      bar.appendChild(playerTagBall);
      playerTagNum = document.createElement('div');
      playerTagNum.style.cssText = 'position:absolute;left:0;right:0;top:0;line-height:17px;font-size:11px;font-weight:700;color:#fff;text-align:center;';
      playerTagNum.textContent = '0/10';
      bar.appendChild(playerTagNum);
      playerTag.appendChild(bar);
      // AI 标签：彩色三角箭头 + LVL 文本
      for (let i = 0; i < CFG.aiCount; i++) {
        const t = mk('position:fixed;left:-999px;top:-999px;transform:translate(-50%,-100%);pointer-events:none;z-index:24;text-align:center;');
        const tri = document.createElement('div');
        tri.style.cssText = 'width:0;height:0;margin:0 auto;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid #fff;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));';
        t.appendChild(tri);
        const tx = document.createElement('div');
        tx.style.cssText = 'font-weight:700;font-size:12px;text-shadow:0 1px 3px rgba(0,0,0,0.65);';
        tx.textContent = 'LVL 1';
        t.appendChild(tx);
        t._tri = tri; t._tx = tx;
        aiTags.push(t);
      }
    } catch (e) { stickBase = stickKnob = null; }
  }
  // 等级按吞掉数计：每 10 个升 1 级（参考的 n/10 计数条）
  function lvlOf(count) {
    const c = Math.max(0, count | 0);
    return { lvl: Math.min(5, 1 + Math.floor(c / 10)), prog: (c % 10) / 10, label: (c % 10) + '/10' };
  }
  // 每帧把洞上方锚点投影到屏幕，更新 LVL 标签位置
  function updateLabels() {
    if (!playerTag) return;
    if (state !== 'playing' || !player) {
      playerTag.style.display = 'none';
      for (const t of aiTags) t.style.display = 'none';
      return;
    }
    // 标签锚定洞的屏幕上缘：投影洞远侧圆边点（远离相机的一侧），标签放在其上方
    tmpProj.set(player.group.position.x, 0, player.group.position.z - player.r * 1.3).project(camera);
    if (tmpProj.z < 1) {
      playerTag.style.display = 'block';
      playerTag.style.left = ((tmpProj.x * 0.5 + 0.5) * window.innerWidth) + 'px';
      playerTag.style.top = ((-tmpProj.y * 0.5 + 0.5) * window.innerHeight - 14) + 'px';
      const L = lvlOf(player.eatCount || 0);
      playerTagText.textContent = 'LVL ' + L.lvl;
      playerTagNum.textContent = L.label;
      playerTagBall.style.left = (2 + L.prog * 78) + 'px';
    } else playerTag.style.display = 'none';
    let i = 0;
    for (const m of mouths) {
      if (m.isPlayer || i >= aiTags.length) continue;
      const t = aiTags[i++];
      tmpProj.set(m.group.position.x, 0, m.group.position.z - m.r * 1.3).project(camera);
      if (tmpProj.z < 1 && !m.falling) {
        t.style.display = 'block';
        t.style.left = ((tmpProj.x * 0.5 + 0.5) * window.innerWidth) + 'px';
        t.style.top = ((-tmpProj.y * 0.5 + 0.5) * window.innerHeight - 6) + 'px';
        const col = '#' + (m.color || 0xffffff).toString(16).padStart(6, '0');
        t._tx.textContent = 'LVL ' + lvlOf(m.eatCount || 0).lvl;
        t._tx.style.color = col;
        t._tri.style.borderTopColor = col;
      } else t.style.display = 'none';
    }
  }
  // 挡视建筑渐隐：相机->玩家连线命中的建筑淡化到 0.35
  function updateFade() {
    if (!player) return;
    const p = player.group.position;
    tmpV.set(p.x - camera.position.x, 1 - camera.position.y, p.z - camera.position.z).normalize();
    ray.set(camera.position, tmpV);
    for (const pr of preys) {
      if (pr.eaten || !pr.box) continue;
      const target = ray.intersectBox(pr.box, tmpV2) ? 0.62 : 1;
      if (pr.fade !== target) {
        pr.fade += (target - pr.fade) * 0.28;
        if (Math.abs(pr.fade - target) < 0.02) pr.fade = target;
        const f = pr.fade;
        pr.group.traverse(o => {
          if ((o.isMesh || o.isSprite) && o.material && o.renderOrder !== -2) {
            o.material.transparent = true;
            o.material.opacity = f;
          }
        });
      }
    }
  }
  function onRoad(x, z) {
    for (const r of ROAD_Z) if (Math.abs(z - r) < OCC) return true;
    for (const r of ROAD_X) if (Math.abs(x - r) < OCC) return true;
    return false;
  }

  // ===================== 贴图 =====================
  function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // 草地：深浅绿斑块 + 草叶笔触，避免纯色
  function makeGrassTex() {
    const s = 512;
    const c = cv(s, s); const x = c.getContext('2d');
    x.fillStyle = '#93cf52'; x.fillRect(0, 0, s, s);
    // 大块明显深浅草色（不透明叠加，保证对比）
    for (let i = 0; i < 80; i++) {
      const dark = Math.random() < 0.5;
      x.fillStyle = dark ? 'rgba(104,168,58,0.5)' : 'rgba(178,224,110,0.5)';
      x.beginPath(); x.ellipse(Math.random() * s, Math.random() * s, Math.random() * 120 + 50, Math.random() * 90 + 40, Math.random() * 3.14, 0, 6.28); x.fill();
    }
    // 草叶短笔触（深浅交错）
    for (let i = 0; i < 5200; i++) {
      const px = Math.random() * s, py = Math.random() * s;
      const dark = Math.random() < 0.5;
      x.strokeStyle = dark ? 'rgba(88,152,52,0.55)' : 'rgba(176,228,112,0.55)';
      x.lineWidth = 2.2;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() * 2 - 1), py - (Math.random() * 5 + 3)); x.stroke();
    }
    // 零星小花与碎石
    for (let i = 0; i < 120; i++) {
      const px = Math.random() * s, py = Math.random() * s;
      x.fillStyle = pick(['#f4f4ef', '#f0c04a', '#e87fae', '#c98be0']);
      x.beginPath(); x.arc(px, py, Math.random() * 1.6 + 0.8, 0, 6.28); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6);
    t.anisotropy = 4;
    return t;
  }
  // 城市硬铺装地坪（浅灰紫 + 细砖缝），代替"满城草地"
  function makePaveTex() {
    const s = 256;
    const c = cv(s, s); const x = c.getContext('2d');
    x.fillStyle = '#bcb2c6'; x.fillRect(0, 0, s, s);
    x.strokeStyle = 'rgba(148,138,164,0.30)'; x.lineWidth = 1;
    for (let i = 0; i <= s; i += 32) {
      x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, s); x.stroke();
      x.beginPath(); x.moveTo(0, i + 0.5); x.lineTo(s, i + 0.5); x.stroke();
    }
    for (let i = 0; i < 700; i++) {
      x.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.045).toFixed(3) + ')';
      x.beginPath(); x.arc(Math.random() * s, Math.random() * s, Math.random() * 5 + 1, 0, 6.28); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(120, 120);
    t.anisotropy = 4;
    return t;
  }
  // 立面：单格一个窗户（可平铺），带砖缝/窗框/反光/亮灯
  function makeFacadeTex(base, frame, glass, brick) {
    const W = 32, H = 64;
    const c = cv(W, H); const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, W, H);
    // 白色竖向壁柱（参考立面两侧白柱，平铺后等距分隔）
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.fillRect(0, 0, 3, H); x.fillRect(W - 3, 0, 3, H);
    if (brick) {
      x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 1;
      for (let y = 0; y < H; y += 8) { x.beginPath(); x.moveTo(0, y + 0.5); x.lineTo(W, y + 0.5); x.stroke(); }
      for (let y = 0; y < H; y += 8) {
        const off = ((y / 8) % 2) * 8;
        for (let px = off; px < W; px += 16) { x.beginPath(); x.moveTo(px + 0.5, y); x.lineTo(px + 0.5, y + 8); x.stroke(); }
      }
    }
    // 大窗：白框 + 天蓝玻璃 + 白窗台（参考临街商铺同款）
    x.fillStyle = '#ffffff'; x.fillRect(5, 8, 22, 42);      // 窗框
    x.fillStyle = glass; x.fillRect(8, 11, 16, 36);        // 天蓝玻璃
    x.fillStyle = 'rgba(255,255,255,0.4)'; x.fillRect(8, 11, 16, 6);
    x.fillStyle = '#ffffff'; x.fillRect(3, 47, 26, 5);      // 白窗台
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  // 玻璃幕墙
  function makeGlassTex(base) {
    const W = 32, H = 32;
    const c = cv(W, H); const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(0, 0, W, 10);
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, 0, 2, H); x.fillRect(0, 0, W, 2);
    x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(0, H - 2, W, 2);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  // 屋瓦
  function makeRoofTex(base) {
    const W = 16, H = 16;
    const c = cv(W, H); const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(0,0,0,0.20)'; x.lineWidth = 1;
    for (let y = 0; y < H; y += 4) { x.beginPath(); x.moveTo(0, y + 0.5); x.lineTo(W, y + 0.5); x.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
    return t;
  }
  // 车道虚线（横向平铺）
  function makeDashTex() {
    const c = cv(32, 32); const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 18, 32);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  // 人行横道条纹
  function makeCrossTex() {
    const c = cv(32, 32); const x = c.getContext('2d');
    x.fillStyle = '#f4f4f0'; x.fillRect(0, 0, 16, 32);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  // 洞内漩涡：偏心径向渐变（深色偏右上=内壁立体感）+ 同心亮蓝唇环，按参考径向剖面复刻
  function makeHoleTex() {
    const s = 128;
    const c = cv(s, s); const x = c.getContext('2d');
    const cx = s * 0.56, cyy = s * 0.42;
    const g = x.createRadialGradient(cx, cyy, 0, cx, cyy, s * 0.72);
    g.addColorStop(0.0, '#002878');
    g.addColorStop(0.5, '#0a4298');
    g.addColorStop(0.8, '#1f6cc4');
    g.addColorStop(1.0, '#3a9cf0');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    // 同心唇环（宽约半径 31%，参考同款亮蓝环带）
    x.strokeStyle = '#3aa9fc';
    x.lineWidth = s * 0.145;
    x.beginPath(); x.arc(s / 2, s / 2, s * 0.45, 0, 6.28); x.stroke();
    // 唇环内缘白色高光（参考的唇环是内白外蓝双色）
    x.strokeStyle = 'rgba(255,255,255,0.8)';
    x.lineWidth = s * 0.06;
    x.beginPath(); x.arc(s / 2, s / 2, s * 0.372, 0, 6.28); x.stroke();
    const t = new THREE.CanvasTexture(c);
    return t;
  }
  // 遮阳伞条纹（红黄放射）
  function makeUmbrellaTex() {
    const c = cv(64, 64); const x = c.getContext('2d');
    const cols = ['#e05a4f', '#f2c53d'];
    for (let i = 0; i < 8; i++) {
      x.fillStyle = cols[i % 2];
      x.beginPath(); x.moveTo(32, 32); x.arc(32, 32, 32, i / 8 * 6.28 - 1.57, (i + 1) / 8 * 6.28 - 1.57); x.closePath(); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  }
  function facadeTex(kind, base, frame, glass) {
    const key = kind + '|' + base + '|' + frame;
    if (!texCache[key]) {
      texCache[key] = kind === 'glass'
        ? makeGlassTex(base)
        : makeFacadeTex(base, frame, glass, kind === 'brick');
    }
    return texCache[key].clone();
  }
  function roofTex(base) {
    const key = 'roof|' + base;
    if (!texCache[key]) texCache[key] = makeRoofTex(base);
    return texCache[key].clone();
  }

  // ===================== 场景 =====================
  function initWorld() {
    const canvas = $('c');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x74b4ec);
    scene.fog = new THREE.Fog(0x74b4ec, 200, 400);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2600);

    scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x9cc46e, 0.78));
    const dir = new THREE.DirectionalLight(0xfff4e0, 0.5);
    dir.position.set(80, 150, 60);
    scene.add(dir);

    boxGeo = new THREE.BoxGeometry(1, 1, 1);
    circleGeo = new THREE.CircleGeometry(1, 40);
    torusGeo = new THREE.TorusGeometry(1, 0.16, 10, 40);
    cylOpenGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    coneGeo = new THREE.ConeGeometry(1, 1, 12);
    cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
    sphereGeo = new THREE.SphereGeometry(1, 14, 12);
    hipGeo = new THREE.CylinderGeometry(0.22, 1, 1, 4);
    hipGeo.rotateY(Math.PI / 4);   // 让四坡屋顶的底与建筑平面对齐
    holeGeo = new THREE.CircleGeometry(0.8, 40);
    holeWallGeo = new THREE.CylinderGeometry(0.8, 0.8, 1, 40, 1, true);
    toothMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    dashTex = makeDashTex();
    crossTex = makeCrossTex();

    grassTex = makeGrassTex();
    grassTex.repeat.set(18, 18);   // 地面扩到 1200x1200 后按比例加密，保持草皮密度
    holeTex = makeHoleTex();
    umbrellaTex = makeUmbrellaTex();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.world * 6, CFG.world * 6),
      new THREE.MeshLambertMaterial({ map: makePaveTex() })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    buildRoadNetwork();
    buildCrosswalks();
    buildGroundDecor();
    buildSkyline();

    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshBasicMaterial({ color: 0x0080f8 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(CFG.world - 50, 0.04, CFG.world - 50);
    scene.add(ocean);
    buildSeaRail();

    clock = new THREE.Clock();
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // 柏油 + 人行道 + 路缘石 + 车道虚线（马卡龙配色：浅紫路面，参考 hole.io 风格）
  function buildRoadNetwork() {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x8a819e });
    const sideMat = new THREE.MeshLambertMaterial({ color: 0xb2a7ba });
    const curbMat = new THREE.MeshLambertMaterial({ color: 0xd5cede });
    const len = CFG.world * 2;
    const addRoad = (axis, pos) => {
      const w = axis === 'x' ? len : ROAD_W;
      const d = axis === 'x' ? ROAD_W : len;
      const a = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), roadMat);
      a.position.set(axis === 'x' ? 0 : pos, 0.05, axis === 'x' ? pos : 0); a.receiveShadow = true; scene.add(a);
      const off = ROAD_W / 2 + SIDE_W / 2;
      for (const s of [-1, 1]) {
        const sw = axis === 'x' ? len : SIDE_W;
        const sd = axis === 'x' ? SIDE_W : len;
        const s1 = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.16, sd), sideMat);
        if (axis === 'x') s1.position.set(0, 0.08, pos + s * off); else s1.position.set(pos + s * off, 0.08, 0);
        s1.receiveShadow = true; scene.add(s1);
        const cw = axis === 'x' ? len : 0.4;
        const cd = axis === 'x' ? 0.4 : len;
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.24, cd), curbMat);
        if (axis === 'x') c1.position.set(0, 0.12, pos + s * (ROAD_W / 2)); else c1.position.set(pos + s * (ROAD_W / 2), 0.12, 0);
        scene.add(c1);
      }
      // 车道虚线：用带虚线贴图的平面，省掉一堆小方块
      const lw = axis === 'x' ? len : 1.3;
      const ld = axis === 'x' ? 1.3 : len;
      const tex = dashTex.clone(); tex.needsUpdate = true; tex.repeat.set(len / 4.6, 1);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xe8e4f0 }));
      line.rotation.x = -Math.PI / 2;
      line.position.set(axis === 'x' ? 0 : pos, 0.13, axis === 'x' ? pos : 0);
      scene.add(line);
      // 道路两侧白色实线边线
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.PlaneGeometry(axis === 'x' ? len : 0.5, axis === 'x' ? 0.5 : len),
          new THREE.MeshBasicMaterial({ color: 0xe8e4f0 }));
        e.rotation.x = -Math.PI / 2;
        const offE = ROAD_W / 2 - 0.9;
        if (axis === 'x') e.position.set(0, 0.14, pos + s * offE); else e.position.set(pos + s * offE, 0.14, 0);
        scene.add(e);
      }
    };
    for (const r of ROAD_Z) addRoad('x', r);
    for (const r of ROAD_X) addRoad('z', r);
  }

  // 路口人行横道（细窄短条，不铺满路口）
  function buildCrosswalks() {
    for (const rx of ROAD_X) {
      for (const rz of ROAD_Z) {
        const d = ROAD_W / 2 + 1.2;
        // 横向马路上的斑马线（条纹沿 Z）
        for (const s of [-1, 1]) {
          const t = crossTex.clone(); t.needsUpdate = true; t.repeat.set(1, 3);
          const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W - 8, 3.2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, color: 0xeceaf2 }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(rx + s * d, 0.16, rz);
          scene.add(m);
        }
        // 纵向马路上的斑马线（条纹沿 X）
        for (const s of [-1, 1]) {
          const t = crossTex.clone(); t.needsUpdate = true; t.repeat.set(3, 1);
          const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, ROAD_W - 8), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, color: 0xeceaf2 }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(rx, 0.16, rz + s * d);
          scene.add(m);
        }
      }
    }
  }

  // 海堤白色石栏（粗石柱+圆帽+双横梁，参考同款）
  function buildSeaRail() {
    const railMat = new THREE.MeshLambertMaterial({ color: 0xf0ebf5 });
    const capMat = new THREE.MeshLambertMaterial({ color: 0xfaf6fc });
    const shore = 104;
    for (const axis of ['x', 'z']) {
      for (let t = 107; t < 194; t += 5) {
        const post = new THREE.Mesh(boxGeo, railMat);
        post.scale.set(1.3, 1.7, 1.3);
        if (axis === 'x') post.position.set(t, 0.85, shore); else post.position.set(shore, 0.85, t);
        scene.add(post);
        const cap = new THREE.Mesh(sphereGeo, capMat);
        cap.scale.set(0.85, 0.3, 0.85);
        if (axis === 'x') cap.position.set(t, 1.75, shore); else cap.position.set(shore, 1.75, t);
        scene.add(cap);
      }
      const beam = new THREE.Mesh(boxGeo, railMat);
      if (axis === 'x') { beam.scale.set(90, 0.75, 0.75); beam.position.set(150, 1.35, shore); }
      else { beam.scale.set(0.75, 0.75, 90); beam.position.set(shore, 1.35, 150); }
      scene.add(beam);
      const beam2 = new THREE.Mesh(boxGeo, railMat);
      if (axis === 'x') { beam2.scale.set(90, 0.45, 0.45); beam2.position.set(150, 0.5, shore); }
      else { beam2.scale.set(0.45, 0.45, 90); beam2.position.set(shore, 0.5, 150); }
      scene.add(beam2);
    }
  }

  // 公园 / 广场色块
  function buildGroundDecor() {
    const parkMat = new THREE.MeshLambertMaterial({ color: 0x77c253 });
    const plazaMat = new THREE.MeshLambertMaterial({ color: 0xe3dcef });
    const place = (mat, size) => {
      for (let i = 0; i < 5; i++) {
        let x, z, tries = 0;
        do { x = rand(-190, 190); z = rand(-190, 190); tries++; }
        while (tries < 20 && (onRoad(x, z) || inOcean(x, z) || Math.hypot(x, z) < 30));
        const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        p.rotation.x = -Math.PI / 2; p.position.set(x, 0.015, z); p.receiveShadow = true; scene.add(p);
      }
    };
    place(parkMat, rand(44, 76));
    place(plazaMat, rand(32, 58));
  }

  // 边缘远景：用同款楼房贴片往外铺一圈，靠雾融进天空（比灰盒子自然）
  function buildSkyline() {
    const keys = ['bld_shop_pink', 'bld_shop_cream', 'bld_shop_mint', 'bld_apt', 'bld_office'];
    for (let i = 0; i < 96; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 207 + Math.random() * 55;
      const h = rand(9, 24);
      const sp = spriteOf(pick(keys), h);
      sp.position.x = Math.cos(a) * rr;
      sp.position.z = Math.sin(a) * rr;
      scene.add(sp);
    }
  }

  // 街区铺装地坪（参考的城市地面是连续硬铺装，草地只留公园/花坛）
  function buildBlocks(xs, zs) {
    const mat = new THREE.MeshLambertMaterial({ color: 0xbcb2c6 });
    for (const [x0, x1] of xs) {
      for (const [z0, z1] of zs) {
        const w = x1 - x0, d = z1 - z0;
        if (w < 14 || d < 14) continue;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(w + SIDE_W * 2 - 0.6, d + SIDE_W * 2 - 0.6), mat);
        p.rotation.x = -Math.PI / 2;
        p.position.set((x0 + x1) / 2, 0.06, (z0 + z1) / 2);
        scene.add(p);
      }
    }
  }

  // ===================== 建筑原型（参考城市天际线） =====================
  // 欧式联排小楼：红砖/灰泥 + 红瓦坡顶 + 烟囱 + 底层店面
  function buildRowHouse() {
    const g = new THREE.Group();
    const key = pick(['bld_shop_pink', 'bld_shop_cream', 'bld_shop_mint', 'bld_shop_cream']);
    const h = rand(11.5, 14.5);
    const sp = spriteOf(key, h);
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.42, mass: 46 + h * 2.2, boxH: h };
  }
  // 高层公寓：灰泥板楼 + 平屋顶女儿墙 + 屋顶水箱空调机
  function buildAptTower() {
    const g = new THREE.Group();
    const h = rand(26, 36);
    const sp = spriteOf('bld_apt', h);
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.40, mass: 110 + h * 3, boxH: h };
  }
  // 玻璃幕墙塔楼
  function buildGlassTower() {
    const g = new THREE.Group();
    const h = rand(38, 52);
    const sp = spriteOf('bld_office', h);
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.38, mass: 180 + h * 3, boxH: h };
  }
  // 厂房仓库：锯齿屋顶 + 烟囱
  function buildWarehouse() {
    const g = new THREE.Group();
    const w = rand(18, 26), d = rand(14, 20), h = rand(9, 13);
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: pick(CITY.concrete) }));
    body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x6d737a });
    const teeth = Math.max(2, Math.round(w / 9));
    for (let i = 0; i < teeth; i++) {
      const t = new THREE.Mesh(boxGeo, roofMat);
      t.scale.set(w / teeth * 0.5, 2.4, d * 0.55);
      t.position.set(-w / 2 + (i + 0.5) * (w / teeth), h + 1.2, 0);
      t.rotation.z = -0.35;
      g.add(t);
    }
    const stack = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x9a6a58 }));
    stack.scale.set(1.6, 11, 1.6); stack.position.set(w * 0.32, h + 5.5, -d * 0.3); g.add(stack);
    return { group: g, radius: 0.5 * Math.hypot(w, d), mass: 150 };
  }

  // ===================== 其他物件 =====================
  function buildTree() {
    const g = new THREE.Group();
    const pine = Math.random() < 0.28;
    const h = pine ? rand(6.2, 8.4) : rand(6.4, 8.2);
    const sp = spriteOf(pine ? 'tree_pine' : 'tree_cloud', h);
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.40, mass: 12 };
  }
  function buildStreetLamp() {
    const g = new THREE.Group();
    g.add(spriteOf('lamp', rand(7.6, 9.0)));
    return { group: g, radius: 0.7, mass: 3 };
  }
  function buildTrafficLight() {
    const g = new THREE.Group();
    g.add(spriteOf('trafficlight', rand(5.4, 6.4)));
    return { group: g, radius: 0.6, mass: 2 };
  }
  function buildBusStop() {
    const g = new THREE.Group();
    const sp = spriteOf('busstop', 5.0);
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.42, mass: 8 };
  }
  function buildTrashBin() {
    const g = new THREE.Group();
    g.add(spriteOf('bin', rand(1.6, 1.9)));
    return { group: g, radius: 0.6, mass: 2 };
  }
  function buildBush() {
    const g = new THREE.Group();
    const sp = spriteOf('bush', rand(1.6, 2.2));
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.42, mass: 4 };
  }
  function buildFlower() {
    const g = new THREE.Group();
    g.add(spriteOf('planter', rand(1.4, 1.8)));
    return { group: g, radius: 0.5, mass: 1 };
  }
  function buildBench() {
    const g = new THREE.Group();
    const sp = spriteOf('bench', 1.6);
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.42, mass: 6 };
  }
  function buildHydrant() {
    const g = new THREE.Group();
    g.add(spriteOf('hydrant', 1.5));
    return { group: g, radius: 0.5, mass: 3 };
  }

  // 车辆：轿车 / 厢式货车 / 巴士，带车窗、轮毂、尾灯
  function buildCar(kind) {
    const g = new THREE.Group();
    const truck = kind === 'van' || kind === 'bus' || Math.random() < 0.28;
    const sp = spriteOf(truck ? 'car_blue' : 'car_red', truck ? rand(3.5, 4.1) : rand(3.1, 3.7));
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.5, mass: truck ? 14 : 8 };
  }

  // 行人：分高矮、可戴帽子，四肢用 pivot 便于摆动
  function buildPerson() {
    const g = new THREE.Group();
    g.add(spriteOf(pick(['ped_yellow', 'ped_red', 'ped_white']), rand(2.1, 2.6)));
    return { group: g, radius: 0.55, mass: 1.2 };
  }

  // ===================== 城市布置 =====================
  function addPrey(res, x, z, kind, rotY) {
    res.group.position.set(x, 0, z);
    if (rotY !== undefined) res.group.rotation.y = rotY;
    scene.add(res.group);
    // blob 投影（柔和接触阴影，移动端稳定显示，不依赖 shadow map）
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(res.radius * 1.08, 0.7), 24),
      new THREE.MeshBasicMaterial({ color: 0x2c2340, transparent: true, opacity: 0.13, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.18; blob.renderOrder = -2; res.group.add(blob);
    let box = null;
    if (res.boxH) {
      // 贴片物体：用"半宽 x 高度"的柱体近似遮挡体积（Sprite 包围盒厚度为 0，无法命中射线）
      const hw = res.radius * 0.9, hd = res.radius * 0.6;
      box = new THREE.Box3(
        new THREE.Vector3(x - hw, 0, z - hd),
        new THREE.Vector3(x + hw, res.boxH, z + hd)
      );
    } else if (kind === 'row' || kind === 'tower') {
      try { box = new THREE.Box3().setFromObject(res.group); } catch (e) { box = null; }
    }
    preys.push({ group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind, box, fade: 1 });
    placed.push({ x, z, r: res.radius * 0.55 });
  }
  // 街区：道路之间的矩形区域
  function axisIntervals(roads) {
    const edges = [-CFG.world];
    for (const r of roads) { edges.push(r - OCC, r + OCC); }
    edges.push(CFG.world);
    const iv = [];
    for (let i = 0; i < edges.length; i += 2) iv.push([edges[i], edges[i + 1]]);
    return iv;
  }
  function spawnCity() {
    placed.length = 0;
    placeFountains();
    const xs = axisIntervals(ROAD_X), zs = axisIntervals(ROAD_Z);
    buildBlocks(xs, zs);
    for (const [x0, x1] of xs) {
      for (const [z0, z1] of zs) {
        const bw = x1 - x0, bd = z1 - z0;
        if (bw < 14 || bd < 14) continue;
        // 沿临街的边成排排房子（形成连续街墙）
        const sides = [
          { axis: 'x', fixed: x0, from: z0, to: z1, rot: -Math.PI / 2, street: x0 > -CFG.world + 1 },
          { axis: 'x', fixed: x1, from: z0, to: z1, rot: Math.PI / 2, street: x1 < CFG.world - 1 },
          { axis: 'z', fixed: z0, from: x0, to: x1, rot: Math.PI, street: z0 > -CFG.world + 1 },
          { axis: 'z', fixed: z1, from: x0, to: x1, rot: 0, street: z1 < CFG.world - 1 }
        ];
        for (const s of sides) {
          if (!s.street) continue;
          let t = s.from + 8;
          while (t < s.to - 14) {
            const w = rand(11, 15);
            if (t + w > s.to - 6) break;
            const c = t + w / 2;
            const inset = rand(9, 12);
            const x = s.axis === 'x' ? s.fixed + (s.fixed === x0 ? inset : -inset) : c;
            const z = s.axis === 'x' ? c : s.fixed + (s.fixed === z0 ? inset : -inset);
            if (!inOcean(x, z) && Math.hypot(x, z) > 12) {
              let clear = true;
              for (const q of placed) if (Math.hypot(x - q.x, z - q.z) < q.r + 7) { clear = false; break; }
              if (clear) addPrey(buildRowHouse(), x, z, 'row', s.rot);
            }
            t += w + rand(0.4, 1.4);
          }
        }
        // 街区内部：公寓 / 塔楼 / 厂房，靠街区中心填充
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const inner = 3 + (Math.random() < 0.6 ? 1 : 0);
        for (let i = 0; i < inner; i++) {
          for (let a = 0; a < 24; a++) {
            const x = rand(cx - bw / 2 + 26, cx + bw / 2 - 26);
            const z = rand(cz - bd / 2 + 26, cz + bd / 2 - 26);
            if (cx - bw / 2 + 26 > cx + bw / 2 - 26 || cz - bd / 2 + 26 > cz + bd / 2 - 26) break;
            if (inOcean(x, z) || Math.hypot(x, z) < 16) continue;
            let good = true;
            for (const q of placed) if (Math.hypot(x - q.x, z - q.z) < q.r + 12) { good = false; break; }
            if (!good) continue;
            const r = Math.random();
            const res = r < 0.5 ? buildAptTower() : (r < 0.85 ? buildGlassTower() : buildWarehouse());
            addPrey(res, x, z, 'tower', rand(0, 6.28));
            break;
          }
        }
      }
    }
    // 街道设施
    placeStreetTrees();
    placeSidewalkProps();
    placeWalker(16);
    placeTraffic(12);
    placeScatter();
  }

  // 喷泉地标：水池 + 中心柱 + 双层水盘 + 水柱（参考画面中央广场的喷泉）
  function buildFountain() {
    const g = new THREE.Group();
    const sp = spriteOf('fountain', 8.0);
    g.add(sp);
    return { group: g, radius: sp.userData.w * 0.45, mass: 70 };
  }
  // 在开阔草地上放 3 座喷泉（避开道路/海洋/出生区/已有物体）
  function placeFountains() {
    let made = 0, guard = 0;
    while (made < 3 && guard < 200) {
      guard++;
      const x = rand(-170, 170), z = rand(-170, 170);
      if (onRoad(x, z) || inOcean(x, z) || Math.hypot(x, z) < 24) continue;
      let ok = true;
      for (const q of placed) if (Math.hypot(x - q.x, z - q.z) < q.r + 16) { ok = false; break; }
      if (!ok) continue;
      addPrey(buildFountain(), x, z, 'fountain');
      made++;
    }
  }

  // 沿人行道成排行道树（左右交错，避免过密）
  function placeStreetTrees() {
    const step = 22;
    for (const r of ROAD_Z) {
      let flip = 0;
      for (let t = -CFG.world + 28; t < CFG.world - 28; t += step) {
        const s = (flip++ % 2 === 0) ? 1 : -1;
        const x = t, z = r + s * (ROAD_W / 2 + SIDE_W / 2);
        if (inOcean(x, z) || Math.hypot(x, z) < 12) continue;
        addPrey(buildTree(), x, z, 'tree');
      }
    }
    for (const r of ROAD_X) {
      let flip = 0;
      for (let t = -CFG.world + 28; t < CFG.world - 28; t += step) {
        const s = (flip++ % 2 === 0) ? 1 : -1;
        const x = r + s * (ROAD_W / 2 + SIDE_W / 2), z = t;
        if (inOcean(x, z) || Math.hypot(x, z) < 12) continue;
        addPrey(buildTree(), x, z, 'tree');
      }
    }
  }
  // 人行道道具：路灯、公交站、垃圾桶、红绿灯
  function placeSidewalkProps() {
    for (const r of ROAD_Z) {
      let flip = 0;
      for (let t = -CFG.world + 36; t < CFG.world - 36; t += 40) {
        const s = (flip++ % 2 === 0) ? 1 : -1;
        const z = r + s * (ROAD_W / 2 + SIDE_W / 2);
        if (!inOcean(t, z) && Math.hypot(t, z) > 12) addPrey(buildStreetLamp(), t, z, 'lamp');
      }
    }
    for (const r of ROAD_X) {
      let flip = 0;
      for (let t = -CFG.world + 36; t < CFG.world - 36; t += 40) {
        const s = (flip++ % 2 === 0) ? 1 : -1;
        const x = r + s * (ROAD_W / 2 + SIDE_W / 2);
        if (!inOcean(x, t) && Math.hypot(x, t) > 12) addPrey(buildStreetLamp(), x, t, 'lamp');
      }
    }
    // 公交站
    for (const r of ROAD_Z) {
      for (let t = -CFG.world + 60; t < CFG.world - 60; t += 80) {
        const z = r + (ROAD_W / 2 + SIDE_W / 2 + 1.6);
        if (!inOcean(t, z) && Math.hypot(t, z) > 14) {
          const res = buildBusStop();
          addPrey(res, t, z, 'busstop', Math.PI);
        }
      }
    }
    // 垃圾桶 / 红绿灯
    for (let i = 0; i < 24; i++) {
      const axis = Math.random() < 0.5 ? 'x' : 'z';
      const roads = axis === 'x' ? ROAD_Z : ROAD_X;
      const r = pick(roads);
      const along = rand(-CFG.world + 20, CFG.world - 20);
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = ROAD_W / 2 + SIDE_W / 2;
      const x = axis === 'x' ? along : r + side * off;
      const z = axis === 'x' ? r + side * off : along;
      if (inOcean(x, z) || Math.hypot(x, z) < 12) continue;
      addPrey(Math.random() < 0.55 ? buildTrashBin() : buildTrafficLight(), x, z, 'prop');
    }
  }
  // 行人
  function placeWalker(n) {
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < 20; t++) {
        const x = rand(-185, 185), z = rand(-185, 185);
        if (inOcean(x, z) || onRoad(x, z) || Math.hypot(x, z) < 12) continue;
        const res = buildPerson();
        res.group.position.set(x, 0, z);
        scene.add(res.group);
        preys.push({
          group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind: 'person',
          parts: res.parts, walk: { tx: rand(-180, 180), tz: rand(-180, 180), spd: rand(0, 3), phase: rand(0, 6.28) }
        });
        break;
      }
    }
  }
  // 行驶的车辆
  function placeTraffic(n) {
    for (let i = 0; i < n; i++) {
      const axis = Math.random() < 0.5 ? 'x' : 'z';
      const roads = axis === 'x' ? ROAD_Z : ROAD_X;
      const r = pick(roads);
      const lane = (Math.random() < 0.5 ? -1 : 1) * (ROAD_W / 2 - 4.5);
      const along = rand(-CFG.world + 12, CFG.world - 12);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const kind = pick(['car', 'car', 'car', 'van', 'bus']);
      const res = buildCar(kind);
      const x = axis === 'x' ? along : r + lane;
      const z = axis === 'x' ? r + lane : along;
      res.group.position.set(x, 0, z);
      scene.add(res.group);
      preys.push({
        group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind: 'car',
        parts: res.parts, car: { axis, dir, spd: kind === 'bus' ? 13 : (kind === 'van' ? 16 : rand(18, 26)) }
      });
    }
  }
  // 露天咖啡座：红黄条纹遮阳伞 + 座椅 + 绿篱（参考街边装饰）
  function buildCafe() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0xd8d2c8 }));
    pole.scale.set(0.12, 2.6, 0.12); pole.position.y = 1.3; g.add(pole);
    const top = new THREE.Mesh(coneGeo, new THREE.MeshLambertMaterial({ map: umbrellaTex }));
    top.scale.set(1.9, 0.85, 1.9); top.position.y = 2.85; g.add(top);
    const chairMat = new THREE.MeshLambertMaterial({ color: 0xc4503f });
    for (const [cx, cz, ry] of [[1.4, 0.3, 0.6], [-1.3, -0.4, -2.3]]) {
      const seat = new THREE.Mesh(boxGeo, chairMat);
      seat.scale.set(0.7, 0.45, 0.7); seat.position.set(cx, 0.5, cz); seat.rotation.y = ry; g.add(seat);
      const back = new THREE.Mesh(boxGeo, chairMat);
      back.scale.set(0.7, 0.85, 0.14);
      back.position.set(cx + Math.sin(ry) * 0.32, 1.05, cz + Math.cos(ry) * 0.32);
      back.rotation.y = ry; g.add(back);
    }
    const hedge = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x4f9e4c }));
    hedge.scale.set(3.6, 0.8, 0.7); hedge.position.set(0, 0.4, -1.2); g.add(hedge);
    return { group: g, radius: 2.2, mass: 5 };
  }
  // 草坪小道具
  function placeScatter() {
    const kinds = [['bush', buildBush, 14], ['flower', buildFlower, 18], ['bench', buildBench, 5], ['hydrant', buildHydrant, 4], ['cafe', buildCafe, 7]];
    for (const [kind, fn, n] of kinds) {
      let made = 0, guard = 0;
      while (made < n && guard < 300) {
        guard++;
        const x = rand(-190, 190), z = rand(-190, 190);
        if (onRoad(x, z) || inOcean(x, z) || Math.hypot(x, z) < 14) continue;
        let ok = true;
        for (const q of placed) if (Math.hypot(x - q.x, z - q.z) < q.r + 2.5) { ok = false; break; }
        if (!ok) continue;
        addPrey(fn(), x, z, kind);
        made++;
      }
    }
  }

  // ===================== 大嘴巴 =====================
  function addEars(g, type, color) {
    const mat = new THREE.MeshLambertMaterial({ color });
    const addEar = (angle, make) => {
      const pivot = new THREE.Group();
      pivot.rotation.y = angle;
      const ear = make();
      ear.position.set(0, 0.06, 1.02);
      ear.rotation.x = Math.PI / 2 - 0.16;
      pivot.add(ear);
      g.add(pivot);
    };
    const coneEar = (r, h) => { const e = new THREE.Mesh(coneGeo, mat); e.scale.set(r, h, r); return e; };
    const boxEar = (w, h, d) => { const e = new THREE.Mesh(boxGeo, mat); e.scale.set(w, h, d); return e; };
    const sphEar = (r) => { const e = new THREE.Mesh(sphereGeo, mat); e.scale.set(r, 0.14, r); return e; };
    if (type === 'cat') {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.55, () => coneEar(0.22, 0.5));
    } else if (type === 'bunny') {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.45, () => coneEar(0.15, 0.78));
    } else if (type === 'bear') {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.7, () => sphEar(0.24));
    } else if (type === 'dog') {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.7, () => boxEar(0.24, 0.1, 0.46));
    } else {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.5, () => coneEar(0.2, 0.55));
    }
  }
  function createMouth(opts) {
    const g = new THREE.Group();
    // 外圈光晕（参考几乎没有，仅一丝提示）
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.25, 40),
      new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.1, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; glow.renderOrder = 0.5; g.add(glow);
    // 洞口遮罩（蓝色漩涡贴图：偏心渐变+亮蓝唇环；depthTest:false + 高 renderOrder 压在透明路面标线之上）
    const holeMat = new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthTest: false, depthWrite: false });
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.rotation.x = -Math.PI / 2; hole.position.y = 0.04; hole.renderOrder = 20; hole.scale.setScalar(1.06); g.add(hole);
    // 平面唇环（随洞色，替代原 3D torus——参考的唇环是平的）
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.86, 40),
      new THREE.MeshBasicMaterial({ color: opts.color, transparent: true, depthTest: false, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.renderOrder = 19; g.add(ring);
    const tc = 18;
    for (let i = 0; i < tc; i++) {
      const a = i / tc * Math.PI * 2;
      const t = new THREE.Mesh(boxGeo, toothMat);
      t.scale.set(0.12, 0.22, 0.12);
      t.position.set(Math.cos(a) * 0.56, 0.14, Math.sin(a) * 0.56);
      t.rotation.y = -a; g.add(t);
    }
    return g;
  }
  function makeMouth(opts) {
    const group = createMouth(opts);
    const m = {
      group, r: opts.r || CFG.startRadius, isPlayer: !!opts.isPlayer, earType: opts.earType,
      color: opts.color, falling: false, eater: null, fallScale: 1, wander: rand(0, 6.28)
    };
    group.scale.setScalar(m.r);
    group.position.set(opts.x || 0, 0, opts.z || 0);
    scene.add(group);
    return m;
  }
  function spawnMouths() {
    player = makeMouth({ isPlayer: true, color: 0x38b6ff, earColor: 0xff86ad, earType: 'cat', r: CFG.startRadius, x: 0, z: 0 });
    mouths.push(player);
    const aiDefs = [
      { color: 0xff6b9a, earColor: 0x2f7fd6, earType: 'dog' },
      { color: 0x57d98a, earColor: 0xffffff, earType: 'bunny' },
      { color: 0xffc24a, earColor: 0xc98a2a, earType: 'bear' },
      { color: 0xb06bff, earColor: 0x7d3fc0, earType: 'fox' }
    ];
    for (const d of aiDefs) {
      let x, z;
      do { x = rand(-CFG.world + 20, CFG.world - 20); z = rand(-CFG.world + 20, CFG.world - 20); }
      while (Math.hypot(x, z) < 40);
      const m = makeMouth({ color: d.color, earColor: d.earColor, earType: d.earType, r: CFG.startRadius * rand(0.9, 1.3), x, z });
      ais.push(m); mouths.push(m);
    }
  }
  function clearGame() {
    for (const p of preys) scene.remove(p.group);
    for (const m of mouths) scene.remove(m.group);
    preys = []; mouths = []; ais = []; player = null;
  }

  // ===================== 玩法 =====================
  function clampBounds(m) {
    const lim = CFG.world - m.r * 0.5;
    m.group.position.x = Math.max(-lim, Math.min(lim, m.group.position.x));
    m.group.position.z = Math.max(-lim, Math.min(lim, m.group.position.z));
  }
  function updatePlayer(dt) {
    if (player.falling) return;
    let vx = input.vx, vz = input.vz;
    const len = Math.hypot(vx, vz);
    if (len > 1) { vx /= len; vz /= len; }
    const sp = CFG.playerSpeed;
    player.group.position.x += vx * sp * dt;
    player.group.position.z += vz * sp * dt;
    clampBounds(player);
    if (len > 0.05) player.group.rotation.y = Math.atan2(vx, vz);
  }
  function updateAI(m, dt) {
    if (m.falling) return;
    let tx = 0, tz = 0, mode = 'wander';
    let threat = null, tb = 1e9;
    for (const o of mouths) {
      if (o === m || o.falling) continue;
      if (o.r > m.r * CFG.eatRatio) {
        const dx = m.group.position.x - o.group.position.x;
        const dz = m.group.position.z - o.group.position.z;
        const d = dx * dx + dz * dz;
        if (d < tb) { tb = d; threat = o; }
      }
    }
    if (threat && tb < Math.pow(m.r + threat.r, 2) * 2.2) {
      tx = m.group.position.x - threat.group.position.x;
      tz = m.group.position.z - threat.group.position.z;
      mode = 'flee';
    } else {
      let best = 1e9, target = null;
      for (const p of preys) {
        if (p.eaten) continue;
        const dx = p.group.position.x - m.group.position.x;
        const dz = p.group.position.z - m.group.position.z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; target = p; }
      }
      if (target && best < 75 * 75) {
        tx = target.group.position.x - m.group.position.x;
        tz = target.group.position.z - m.group.position.z;
        mode = 'hunt';
      } else {
        m.wander += dt * 0.7;
        tx = Math.cos(m.wander); tz = Math.sin(m.wander);
      }
    }
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const sp = CFG.playerSpeed * (mode === 'flee' ? 1.05 : 0.95);
    m.group.position.x += tx * sp * dt;
    m.group.position.z += tz * sp * dt;
    clampBounds(m);
    m.group.rotation.y = Math.atan2(tx, tz);
  }
  function eatPreyCheck(m) {
    for (const p of preys) {
      if (p.eaten) continue;
      const dx = p.group.position.x - m.group.position.x;
      const dz = p.group.position.z - m.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < m.r - p.radius * 0.5 && p.radius < m.r * 0.9) {
        p.eaten = true; p.eater = m;
        p.fallT = 0;
        m.eatCount = (m.eatCount || 0) + 1;
      }
    }
  }
  function updatePerson(p, dt) {
    const w = p.walk;
    let dx = w.tx - p.group.position.x, dz = w.tz - p.group.position.z;
    let d = Math.hypot(dx, dz);
    if (d < 2) {
      w.tx = rand(-CFG.world + 15, CFG.world - 15);
      w.tz = rand(-CFG.world + 15, CFG.world - 15);
      if (inOcean(w.tx, w.tz)) { w.tx = -100; w.tz = -100; }
      dx = w.tx - p.group.position.x; dz = w.tz - p.group.position.z; d = Math.hypot(dx, dz);
    }
    const sp = 4 + w.spd;
    const ux = dx / (d || 1), uz = dz / (d || 1);
    p.group.position.x = clamp(p.group.position.x + ux * sp * dt, -CFG.world + 5, CFG.world - 5);
    p.group.position.z = clamp(p.group.position.z + uz * sp * dt, -CFG.world + 5, CFG.world - 5);
    p.group.rotation.y = Math.atan2(ux, uz);
    w.phase += dt * (6 + w.spd);
    const sw = Math.sin(w.phase) * 0.5;
    if (p.parts) {
      p.parts.armL.rotation.x = sw; p.parts.armR.rotation.x = -sw;
      p.parts.legL.rotation.x = -sw; p.parts.legR.rotation.x = sw;
    }
    p.group.position.y = Math.abs(Math.sin(w.phase)) * 0.1;
  }
  function updateCar(p, dt) {
    const c = p.car;
    const lim = CFG.world - 8;
    if (c.axis === 'x') {
      p.group.position.x += c.dir * c.spd * dt;
      if (p.group.position.x > lim) p.group.position.x = -lim;
      else if (p.group.position.x < -lim) p.group.position.x = lim;
      p.group.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      p.group.position.z += c.dir * c.spd * dt;
      if (p.group.position.z > lim) p.group.position.z = -lim;
      else if (p.group.position.z < -lim) p.group.position.z = lim;
      p.group.rotation.y = c.dir > 0 ? 0 : Math.PI;
    }
    if (p.parts) for (const w of p.parts.wheels) w.rotateX(c.spd * dt * 0.5);
  }
  function updatePrey(p, dt) {
    if (!p.eaten) return;
    const e = p.eater;
    p.fallT = (p.fallT || 0) + dt;
    // 吸入洞心（先加速吸附）
    const k = Math.min(1, dt * (6 + p.fallT * 14));
    p.group.position.x += (e.group.position.x - p.group.position.x) * k;
    p.group.position.z += (e.group.position.z - p.group.position.z) * k;
    // 先轻轻弹起 0.12s 再加速坠入洞中
    const hop = p.fallT < 0.12 ? Math.sin(p.fallT / 0.12 * Math.PI) * e.r * 0.35 : 0;
    p.group.position.y = hop - Math.max(0, p.fallT - 0.1) * (e.r * 2.2 + 6);
    // 边转边缩小（参考的螺旋吸入感）
    p.group.rotation.y += dt * 7;
    const s = Math.max(0.001, p.group.scale.x - dt * 1.9);
    p.group.scale.setScalar(s);
    if (s <= 0.06 || p.group.position.y < -e.r) {
      scene.remove(p.group);
      const idx = preys.indexOf(p); if (idx >= 0) preys.splice(idx, 1);
      e.r = Math.min(CFG.maxRadius, e.r + CFG.growthK * Math.cbrt(p.mass));
      e.group.scale.setScalar(e.r);
      if (e.isPlayer) { eatCount++; popSound(); }
    }
  }
  function resolveMouths() {
    for (let i = 0; i < mouths.length; i++) {
      for (let j = i + 1; j < mouths.length; j++) {
        const a = mouths[i], b = mouths[j];
        if (a.falling || b.falling) continue;
        const dx = a.group.position.x - b.group.position.x;
        const dz = a.group.position.z - b.group.position.z;
        if (Math.hypot(dx, dz) < (a.r + b.r) * 0.5) {
          let big = a, small = b;
          if (b.r > a.r) { big = b; small = a; }
          if (big.r > small.r * CFG.eatRatio) {
            small.falling = true; small.eater = big; small.fallScale = 1;
          }
        }
      }
    }
  }
  function updateMouthFall(m, dt) {
    if (!m.falling) return;
    const e = m.eater;
    m.group.position.x += (e.group.position.x - m.group.position.x) * Math.min(1, dt * 5);
    m.group.position.z += (e.group.position.z - m.group.position.z) * Math.min(1, dt * 5);
    m.group.position.y -= dt * (e.r * 1.6 + 5);
    m.fallScale = Math.max(0.001, m.fallScale - dt * 1.4);
    m.group.scale.setScalar(m.r * m.fallScale);
    if (m.fallScale <= 0.06) {
      scene.remove(m.group);
      const mi = mouths.indexOf(m); if (mi >= 0) mouths.splice(mi, 1);
      const ai = ais.indexOf(m); if (ai >= 0) ais.splice(ai, 1);
      e.r = Math.min(CFG.maxRadius, e.r + m.r * 0.5 + 1.5);
      e.group.scale.setScalar(e.r);
      if (e.isPlayer) popSound();
      if (m.isPlayer) endGame('lost');
    }
  }

  // ===================== HUD =====================
  function computeRank() {
    let rank = 1;
    for (const m of mouths) if (!m.isPlayer && !m.falling && m.r > player.r) rank++;
    return rank;
  }
  function updateHUD() {
    const t = Math.max(0, Math.ceil(timeLeft));
    const mm = Math.floor(t / 60), ss = t % 60;
    $('time').textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
    $('score').textContent = eatCount;
    $('rank').textContent = player ? computeRank() : 1;
  }
  function endGame(reason) {
    state = 'over';
    $('hud').classList.add('hidden');
    $('over').classList.remove('hidden');
    const rank = computeRank();
    const size = player ? Math.round(player.r * 2) : 0;
    $('finalScore').textContent = eatCount;
    $('finalRank').textContent = rank;
    $('finalSize').textContent = size;
    if (reason === 'lost') {
      $('overTitle').textContent = '被吃掉了！';
      $('overDesc').textContent = '小心比自己大的嘴巴~';
    } else if (rank === 1) {
      $('overTitle').textContent = '你是最强的大嘴巴！';
      $('overDesc').textContent = '全场最大，太厉害了！';
    } else {
      $('overTitle').textContent = '时间到！';
      $('overDesc').textContent = '再练练就能拿第一啦~';
    }
  }
  function updateCamera() {
    if (window.__freezeCam) return;
    window.__cam = camera;
    const r = player ? player.r : CFG.startRadius;
    const p = player ? player.group.position : new THREE.Vector3();
    // 视角随体型演进：占比恒定，俯角 40°(贴地矮视角,能看建筑立面)->60°(高空)
    const t = clamp((r - CFG.startRadius) / (CFG.maxRadius - CFG.startRadius), 0, 1);
    const theta = (40 + t * 20) * Math.PI / 180;
    const D = 10.5 * r;
    camera.position.set(p.x, D * Math.sin(theta), p.z + D * Math.cos(theta));
    camera.lookAt(p.x, 0, p.z);
    // 雾随相机高度外推：小洞保持原雾；大洞高空时把雾推到地平线，避免全城被糊
    if (scene.fog) {
      scene.fog.near = Math.max(150, D * 0.55);
      scene.fog.far = Math.max(330, D * 1.15);
    }
  }
  function loop() {
    requestAnimationFrame(loop);
    if (typeof window !== 'undefined') { window.__dbgPreys = preys; window.__dbgScene = scene; }
    const dt = Math.min(0.05, clock.getDelta());
    if (state === 'playing') {
      timeLeft -= dt;
      updatePlayer(dt);
      for (const m of mouths) if (!m.isPlayer) updateAI(m, dt);
      for (const m of mouths) eatPreyCheck(m);
      for (const p of preys) {
        if (p.eaten) continue;
        if (p.kind === 'person') updatePerson(p, dt);
        else if (p.kind === 'car') updateCar(p, dt);
      }
      for (let i = preys.length - 1; i >= 0; i--) updatePrey(preys[i], dt);
      resolveMouths();
      for (const m of mouths) updateMouthFall(m, dt);
      updateHUD();
      if (timeLeft <= 0) endGame('time');
    }
    updateCamera();
    updateFade();
    updateLabels();
    renderer.render(scene, camera);
  }

  // ===================== 音效 =====================
  function popSound() {
    if (muted || !audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 380 + Math.random() * 260;
    g.gain.value = 0.04;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.09);
    o.stop(audioCtx.currentTime + 0.1);
  }

  // ===================== 输入 =====================
  function setupInput() {
    const el = $('c');
    let ox = 0, oy = 0, pid = null;
    const setFromTouch = (cx, cy) => {
      let dx = cx - ox, dy = cy - oy;
      const max = 70;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      input.vx = dx / max; input.vz = dy / max;
      return [dx, dy];
    };
    el.addEventListener('pointerdown', (e) => {
      if (state !== 'playing') return;
      pid = e.pointerId; ox = e.clientX; oy = e.clientY;
      input.vx = 0; input.vz = 0;
      if (stickBase) {
        stickBase.style.left = ox + 'px'; stickBase.style.top = oy + 'px';
        stickBase.style.display = 'block';
        stickKnob.style.left = ox + 'px'; stickKnob.style.top = oy + 'px';
        stickKnob.style.display = 'block';
      }
      if (el.setPointerCapture) el.setPointerCapture(pid);
    });
    el.addEventListener('pointermove', (e) => {
      if (pid === null || e.pointerId !== pid) return;
      const [dx, dy] = setFromTouch(e.clientX, e.clientY);
      if (stickKnob) {
        stickKnob.style.left = (ox + dx) + 'px';
        stickKnob.style.top = (oy + dy) + 'px';
      }
    });
    const end = (e) => {
      if (e.pointerId === pid) {
        pid = null; input.vx = 0; input.vz = 0;
        if (stickBase) { stickBase.style.display = 'none'; stickKnob.style.display = 'none'; }
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    const keys = {};
    window.addEventListener('keydown', (e) => { keys[e.key] = true; });
    window.addEventListener('keyup', (e) => { keys[e.key] = false; });
    setInterval(() => {
      if (state !== 'playing') return;
      let vx = 0, vz = 0;
      if (keys['ArrowLeft'] || keys['a']) vx -= 1;
      if (keys['ArrowRight'] || keys['d']) vx += 1;
      if (keys['ArrowUp'] || keys['w']) vz -= 1;
      if (keys['ArrowDown'] || keys['s']) vz += 1;
      if (vx || vz) { input.vx = vx; input.vz = vz; }
    }, 30);
  }

  function startGame() {
    clearGame();
    spawnCity();
    spawnMouths();
    timeLeft = CFG.duration; eatCount = 0;
    input.vx = 0; input.vz = 0;
    state = 'playing';
    $('start').classList.add('hidden');
    $('over').classList.add('hidden');
    $('hud').classList.remove('hidden');
    updateHUD();
  }
  function init() {
    const boot = () => {
      initWorld();
      buildDynamicUI();
      setupInput();
      $('playBtn').addEventListener('click', () => {
        if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
        startGame();
      });
      $('againBtn').addEventListener('click', startGame);
      $('muteBtn').addEventListener('click', () => {
        muted = !muted;
        $('muteBtn').textContent = muted ? '🔇 音效：关' : '🔊 音效：开';
      });
      loop();
    };
    // 资产贴图加载完成后再启动（3.5s 超时兜底，缺图也不至于卡死）
    let fired = false;
    const go = () => { if (fired) return; fired = true; boot(); };
    try { loadAssets(go); } catch (e) { go(); }
    setTimeout(go, 3500);
  }
  window.addEventListener('load', init);
})();
