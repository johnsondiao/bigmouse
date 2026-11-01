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
    stucco: ['#e8dfc9', '#ddd2b8', '#f0e7d5', '#d4c6a8', '#e3d7bd'],
    glass: ['#7fa8bd', '#6f9cb3', '#8ab5c8', '#6496ae', '#87aec1'],
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
  let holeGeo, holeWallGeo, grassTex, dashTex, crossTex, texCache = {};
  let toothMat, windowTextures = [];

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const inOcean = (x, z) => (x > 100 && z > 100);
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
    x.fillStyle = '#6fb83f'; x.fillRect(0, 0, s, s);
    // 大块明显深浅草色（不透明叠加，保证对比）
    for (let i = 0; i < 80; i++) {
      const dark = Math.random() < 0.5;
      x.fillStyle = dark ? 'rgba(74,130,42,0.5)' : 'rgba(158,210,98,0.5)';
      x.beginPath(); x.ellipse(Math.random() * s, Math.random() * s, Math.random() * 120 + 50, Math.random() * 90 + 40, Math.random() * 3.14, 0, 6.28); x.fill();
    }
    // 草叶短笔触（深浅交错）
    for (let i = 0; i < 5200; i++) {
      const px = Math.random() * s, py = Math.random() * s;
      const dark = Math.random() < 0.5;
      x.strokeStyle = dark ? 'rgba(54,118,42,0.55)' : 'rgba(150,210,90,0.55)';
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
  // 立面：单格一个窗户（可平铺），带砖缝/窗框/反光/亮灯
  function makeFacadeTex(base, frame, glass, brick) {
    const W = 32, H = 64;
    const c = cv(W, H); const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, W, H);
    if (brick) {
      x.strokeStyle = 'rgba(0,0,0,0.13)'; x.lineWidth = 1;
      for (let y = 0; y < H; y += 8) { x.beginPath(); x.moveTo(0, y + 0.5); x.lineTo(W, y + 0.5); x.stroke(); }
      for (let y = 0; y < H; y += 8) {
        const off = ((y / 8) % 2) * 8;
        for (let px = off; px < W; px += 16) { x.beginPath(); x.moveTo(px + 0.5, y); x.lineTo(px + 0.5, y + 8); x.stroke(); }
      }
    }
    x.fillStyle = frame; x.fillRect(6, 9, 20, 42);      // 窗框
    x.fillStyle = '#6d86b0'; x.fillRect(9, 12, 14, 36);       // 玻璃（提亮，避免像黑洞）
    x.fillStyle = 'rgba(255,255,255,0.20)'; x.fillRect(9, 12, 14, 8);
    x.fillStyle = frame; x.fillRect(5, 48, 22, 4);       // 窗台
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
    x.fillStyle = '#ffe27a'; x.fillRect(0, 0, 18, 32);
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
    scene.background = new THREE.Color(0xa8ddf5);
    scene.fog = new THREE.Fog(0xa8ddf5, 300, 520);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1200);

    scene.add(new THREE.HemisphereLight(0xcfeaff, 0x74b355, 1.05));
    const dir = new THREE.DirectionalLight(0xfff4e0, 0.9);
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
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.world * 2, CFG.world * 2),
      new THREE.MeshLambertMaterial({ map: grassTex })
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
      new THREE.MeshLambertMaterial({ color: 0x2f9fe0, transparent: true, opacity: 0.92 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(CFG.world - 50, 0.04, CFG.world - 50);
    scene.add(ocean);

    clock = new THREE.Clock();
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // 柏油 + 人行道 + 路缘石 + 车道虚线
  function buildRoadNetwork() {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x4a4a52 });
    const sideMat = new THREE.MeshLambertMaterial({ color: 0x9a9aa2 });
    const curbMat = new THREE.MeshLambertMaterial({ color: 0xc6c6c6 });
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
      const lw = axis === 'x' ? len : 1.1;
      const ld = axis === 'x' ? 1.1 : len;
      const tex = dashTex.clone(); tex.needsUpdate = true; tex.repeat.set(len / 14, 1);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      line.rotation.x = -Math.PI / 2;
      line.position.set(axis === 'x' ? 0 : pos, 0.13, axis === 'x' ? pos : 0);
      scene.add(line);
      // 车道分界线（白色虚线，靠两侧）
      for (const s of [-1, 1]) {
        const tx = dashTex.clone(); tx.needsUpdate = true; tx.repeat.set(len / 22, 1);
        const t2 = new THREE.Mesh(new THREE.PlaneGeometry(axis === 'x' ? len : 0.55, axis === 'x' ? 0.55 : len),
          new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, color: 0xf0f0ea }));
        t2.rotation.x = -Math.PI / 2;
        const off2 = ROAD_W / 2 - 4;
        if (axis === 'x') t2.position.set(0, 0.12, pos + s * off2); else t2.position.set(pos + s * off2, 0.12, 0);
        scene.add(t2);
      }
    };
    for (const r of ROAD_Z) addRoad('x', r);
    for (const r of ROAD_X) addRoad('z', r);
  }

  // 路口人行横道
  function buildCrosswalks() {
    const mat = new THREE.MeshBasicMaterial({ map: crossTex, transparent: true, depthWrite: false });
    for (const rx of ROAD_X) {
      for (const rz of ROAD_Z) {
        const d = ROAD_W / 2 + 2.5;
        // 横向马路上的斑马线（条纹沿 Z）
        for (const s of [-1, 1]) {
          const t = crossTex.clone(); t.needsUpdate = true; t.repeat.set(6, 1);
          const m = new THREE.Mesh(new THREE.PlaneGeometry(7, ROAD_W), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(rx + s * d, 0.16, rz);
          scene.add(m);
        }
        // 纵向马路上的斑马线（条纹沿 X）
        for (const s of [-1, 1]) {
          const t = crossTex.clone(); t.needsUpdate = true; t.repeat.set(1, 6);
          const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 7), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(rx, 0.16, rz + s * d);
          scene.add(m);
        }
      }
    }
    void mat;
  }

  // 公园 / 广场色块
  function buildGroundDecor() {
    const parkMat = new THREE.MeshLambertMaterial({ color: 0x5aa83d });
    const plazaMat = new THREE.MeshLambertMaterial({ color: 0xbdb6a8 });
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

  // 边缘远景天际线
  function buildSkyline() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x9db5d4 });
    const ringR = 197;
    for (let i = 0; i < 70; i++) {
      const a = i / 70 * Math.PI * 2;
      const rr = ringR + rand(-12, 12);
      const w = rand(10, 24), h = rand(36, 140), d = rand(10, 24);
      const m = new THREE.Mesh(boxGeo, mat);
      m.scale.set(w, h, d);
      m.position.set(Math.cos(a) * rr, h / 2, Math.sin(a) * rr);
      m.rotation.y = rand(0, 6.28);
      scene.add(m);
    }
  }

  // ===================== 建筑原型（参考城市天际线） =====================
  // 欧式联排小楼：红砖/灰泥 + 红瓦坡顶 + 烟囱 + 底层店面
  function buildRowHouse() {
    const g = new THREE.Group();
    const w = rand(9, 13), d = rand(10, 14);
    const floors = 2 + (Math.random() < 0.45 ? 1 : 0);
    const h = floors * 3.3;
    const isBrick = Math.random() < 0.55;
    const base = pick(isBrick ? CITY.brick : CITY.stucco);
    const frame = pick(CITY.frame);
    const cols = Math.max(2, Math.round(w / 3.3));
    const tex = facadeTex(isBrick ? 'brick' : 'stucco', base, frame, '#33405c');
    tex.repeat.set(cols, floors);
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ map: tex }));
    body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);

    // 坡屋顶（出檐，底面略大于墙体，避免屋顶过大盖住楼体）
    const rh = rand(1.6, 2.3);
    const rbase = pick(CITY.roof);
    const roof = new THREE.Mesh(hipGeo, new THREE.MeshLambertMaterial({ map: roofTex(rbase) }));
    roof.scale.set(w * 0.46, rh, d * 0.46); roof.position.y = h + rh / 2 - 0.1; g.add(roof);

    // 烟囱
    if (Math.random() < 0.6) {
      const ch = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x8d5b46 }));
      ch.scale.set(1.1, rand(2.4, 3.8), 1.1);
      ch.position.set(rand(-w * 0.25, w * 0.25), h + rh * 0.6, rand(-d * 0.2, d * 0.2));
      g.add(ch);
    }
    // 底层店面
    if (Math.random() < 0.5) {
      const awn = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: pick(CITY.awn) }));
      awn.scale.set(w * 0.86, 0.5, 1.9); awn.position.set(0, 2.7, d / 2 + 0.9); g.add(awn);
      const sign = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x2f3a4a }));
      sign.scale.set(w * 0.6, 0.9, 0.3); sign.position.set(0, 3.7, d / 2 + 0.15); g.add(sign);
      const band = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x27364f }));
      band.scale.set(w * 0.82, 2.3, 0.22); band.position.set(0, 1.25, d / 2 + 0.06); g.add(band);
    }
    // 阳台
    if (Math.random() < 0.45 && floors >= 3) {
      const b = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xdcd6c8 }));
      b.scale.set(w * 0.5, 0.22, 1.4); b.position.set(rand(-w * 0.15, w * 0.15), h * 0.52, d / 2 + 0.65); g.add(b);
    }
    return { group: g, radius: 0.5 * Math.hypot(w, d), mass: 26 + floors * 14 };
  }
  // 高层公寓：灰泥板楼 + 平屋顶女儿墙 + 屋顶水箱空调机
  function buildAptTower() {
    const g = new THREE.Group();
    const w = rand(12, 17), d = rand(12, 17);
    const floors = rand(5, 9);
    const h = floors * 3.2;
    const base = pick(CITY.stucco);
    const cols = Math.max(3, Math.round(w / 3.2));
    const tex = facadeTex('stucco', base, pick(CITY.frame), '#33405c');
    tex.repeat.set(cols, floors);
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ map: tex }));
    body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);
    // 屋顶平台
    const deck = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x9a9a96 }));
    deck.scale.set(w + 0.8, 1.0, d + 0.8); deck.position.y = h + 0.5; g.add(deck);
    // 水箱
    if (Math.random() < 0.7) {
      const tank = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x8a7a63 }));
      tank.scale.set(1.5, 2.2, 1.5); tank.position.set(rand(-w * 0.2, w * 0.2), h + 2.1, rand(-d * 0.2, d * 0.2)); g.add(tank);
    }
    // 空调外机
    const acs = 1 + (Math.random() < 0.6 ? 1 : 0);
    for (let i = 0; i < acs; i++) {
      const ac = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xb0b4b8 }));
      ac.scale.set(1.4, 0.9, 1.2); ac.position.set(rand(-w * 0.3, w * 0.3), h + 1.45, rand(-d * 0.3, d * 0.3)); g.add(ac);
    }
    return { group: g, radius: 0.5 * Math.hypot(w, d), mass: 90 + floors * 16 };
  }
  // 玻璃幕墙塔楼
  function buildGlassTower() {
    const g = new THREE.Group();
    const w = rand(13, 19), d = rand(13, 19);
    const floors = rand(8, 20);
    const h = floors * 3.1;
    const cols = Math.max(3, Math.round(w / 3));
    const tex = facadeTex('glass', pick(CITY.glass), '#ffffff', '#4b6f85');
    tex.repeat.set(cols, floors);
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ map: tex }));
    body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);
    const deck = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x8d949b }));
    deck.scale.set(w + 0.8, 0.9, d + 0.8); deck.position.y = h + 0.45; g.add(deck);
    const mech = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x5d646c }));
    mech.scale.set(w * 0.5, 3, d * 0.5); mech.position.y = h + 2.4; g.add(mech);
    const ant = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x444a50 }));
    ant.scale.set(0.22, 6, 0.22); ant.position.y = h + 6.9; g.add(ant);
    return { group: g, radius: 0.5 * Math.hypot(w, d), mass: 130 + floors * 9 };
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
    if (Math.random() < 0.45) {
      // 松树：主干 + 3 层圆锥
      const trunk = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x6b4326 }));
      trunk.scale.set(0.4, 2.0, 0.4); trunk.position.y = 1.0; g.add(trunk);
      const pineMat = new THREE.MeshLambertMaterial({ color: pick(['#2f7d43', '#357f4a', '#287040']) });
      const tiers = [[2.6, 2.6, 3.4], [2.1, 2.3, 5.4], [1.5, 2.0, 7.2]];
      for (const [r, h, y] of tiers) {
        const cone = new THREE.Mesh(coneGeo, pineMat);
        cone.scale.set(r, h, r); cone.position.y = y; g.add(cone);
      }
      return { group: g, radius: 2.4, mass: 12 };
    }
    // 阔叶树：主干 + 多个相交球团，云朵状
    const trunk = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
    trunk.scale.set(0.5, 2.8, 0.5); trunk.position.y = 1.4; g.add(trunk);
    const base = pick(['#4e9b4a', '#5aa851', '#43893f', '#62b45a']);
    const blobs = [
      [0, 5.4, 0, 2.6], [1.8, 5.0, 0.6, 1.9], [-1.8, 5.0, -0.4, 1.9],
      [0.4, 6.6, -0.6, 1.8], [-0.5, 4.6, 1.6, 1.7], [1.2, 6.2, 1.2, 1.4]
    ];
    for (const [bx, by, bz, br] of blobs) {
      const shade = Math.random() < 0.4 ? '#3f8a3c' : base;
      const b = new THREE.Mesh(sphereGeo, new THREE.MeshLambertMaterial({ color: shade }));
      b.scale.set(br, br * 1.05, br); b.position.set(bx, by, bz); g.add(b);
    }
    return { group: g, radius: 2.4, mass: 12 };
  }
  function buildStreetLamp() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
    pole.scale.set(0.18, 5.2, 0.18); pole.position.y = 2.6; g.add(pole);
    const arm = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
    arm.scale.set(0.18, 0.18, 1.5); arm.position.set(0, 5.2, 0.65); g.add(arm);
    const bulb = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xfff0b8 }));
    bulb.scale.setScalar(0.32); bulb.position.set(0, 5.05, 1.3); g.add(bulb);
    return { group: g, radius: 0.8, mass: 3 };
  }
  function buildTrafficLight() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x3f444a }));
    pole.scale.set(0.16, 4.2, 0.16); pole.position.y = 2.1; g.add(pole);
    const head = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x24282c }));
    head.scale.set(0.8, 1.9, 0.5); head.position.y = 4.6; g.add(head);
    [0xff3b30, 0xffcc00, 0x34c759].forEach((c, i) => {
      const b = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: c }));
      b.scale.setScalar(0.19); b.position.set(0, 5.0 - i * 0.6, 0.27); g.add(b);
    });
    return { group: g, radius: 0.6, mass: 2 };
  }
  function buildBusStop() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x3f444a }));
    pole.scale.set(0.14, 2.8, 0.14); pole.position.y = 1.4; g.add(pole);
    const sign = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x2f6fb5 }));
    sign.scale.set(0.9, 0.9, 0.12); sign.position.set(0, 3.0, 0); g.add(sign);
    const roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x9aa2aa }));
    roof.scale.set(4.2, 0.18, 1.8); roof.position.set(0, 2.6, 0.6); g.add(roof);
    const glass = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x9ec3de, transparent: true, opacity: 0.45 }));
    glass.scale.set(4.0, 2.2, 0.1); glass.position.set(0, 1.4, 1.45); g.add(glass);
    const bench = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
    bench.scale.set(3.2, 0.16, 0.55); bench.position.set(0, 0.7, 0.6); g.add(bench);
    return { group: g, radius: 2.2, mass: 8 };
  }
  function buildTrashBin() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x4c5359 }));
    body.scale.set(0.55, 1.1, 0.55); body.position.y = 0.55; g.add(body);
    const lid = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x2f3438 }));
    lid.scale.set(0.62, 0.14, 0.62); lid.position.y = 1.15; g.add(lid);
    return { group: g, radius: 0.6, mass: 2 };
  }
  function buildBush() {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: pick([0x4e9b4a, 0x5aa851, 0x43893f]) });
    for (const o of [[-0.4, 0.5, 0], [0.4, 0.5, 0], [0, 0.78, 0.2]]) {
      const b = new THREE.Mesh(sphereGeo, m);
      b.scale.setScalar(pick([0.6, 0.85, 0.7])); b.position.set(o[0], o[1], o[2]); g.add(b);
    }
    return { group: g, radius: 0.9, mass: 4 };
  }
  function buildFlower() {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x4e9b4a }));
    stem.scale.set(0.07, 0.7, 0.07); stem.position.y = 0.35; g.add(stem);
    const top = new THREE.Mesh(sphereGeo, new THREE.MeshLambertMaterial({ color: pick(['#e8617d', '#f0b83c', '#d982c6', '#f5f5f0', '#9b6bff']) }));
    top.scale.setScalar(0.2); top.position.y = 0.75; g.add(top);
    return { group: g, radius: 0.4, mass: 0.5 };
  }
  function buildBench() {
    const g = new THREE.Group();
    const wmat = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
    const seat = new THREE.Mesh(boxGeo, wmat); seat.scale.set(2, 0.15, 0.6); seat.position.y = 0.5; g.add(seat);
    const back = new THREE.Mesh(boxGeo, wmat); back.scale.set(2, 0.5, 0.15); back.position.set(0, 0.8, -0.25); g.add(back);
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.25, 0.25]) {
      const leg = new THREE.Mesh(boxGeo, wmat); leg.scale.set(0.15, 0.5, 0.15); leg.position.set(sx, 0.25, sz); g.add(leg);
    }
    return { group: g, radius: 1.2, mass: 6 };
  }
  function buildHydrant() {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: 0xcf4436 });
    const body = new THREE.Mesh(cylGeo, m); body.scale.set(0.32, 0.95, 0.32); body.position.y = 0.48; g.add(body);
    const cap = new THREE.Mesh(sphereGeo, m); cap.scale.setScalar(0.34); cap.position.y = 0.96; g.add(cap);
    return { group: g, radius: 0.5, mass: 3 };
  }

  // 车辆：轿车 / 厢式货车 / 巴士，带车窗、轮毂、尾灯
  function buildCar(kind) {
    const g = new THREE.Group();
    const palette = ['#c94f43', '#3f6fb5', '#4f9a63', '#e0b040', '#c96ba8', '#e07b3a', '#e8e8e4', '#3c4147'];
    const color = pick(palette);
    const cmat = new THREE.MeshLambertMaterial({ color });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x223445 });
    const wmat = new THREE.MeshLambertMaterial({ color: 0x17191c });
    const hubMat = new THREE.MeshLambertMaterial({ color: 0xb8bcc0 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xb81f1f });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    const wheels = [];
    const addWheels = (w, d) => {
      for (const p of [[-w, 0.52, d], [w, 0.52, d], [-w, 0.52, -d], [w, 0.52, -d]]) {
        const wh = new THREE.Mesh(cylGeo, wmat);
        wh.scale.set(0.54, 0.34, 0.54); wh.rotation.z = Math.PI / 2;
        wh.position.set(p[0], p[1], p[2]); g.add(wh);
        const hub = new THREE.Mesh(cylGeo, hubMat);
        hub.scale.set(0.26, 0.36, 0.26); hub.rotation.z = Math.PI / 2;
        hub.position.set(p[0] + (p[0] > 0 ? 0.02 : -0.02), p[1], p[2]); g.add(hub);
        wheels.push(wh);
      }
    };
    if (kind === 'van') {
      const body = new THREE.Mesh(boxGeo, cmat); body.scale.set(2.4, 2.4, 5.6); body.position.y = 1.8; g.add(body);
      const cab = new THREE.Mesh(boxGeo, cmat); cab.scale.set(2.3, 1.7, 1.6); cab.position.set(0, 1.45, 2.2); g.add(cab);
      const wind = new THREE.Mesh(boxGeo, glassMat); wind.scale.set(2.0, 1.1, 0.12); wind.position.set(0, 1.7, 3.0); g.add(wind);
      const side = new THREE.Mesh(boxGeo, glassMat); side.scale.set(0.12, 1.2, 4.0); side.position.set(1.22, 1.9, 0); g.add(side);
      const side2 = side.clone(); side2.position.x = -1.22; g.add(side2);
      addWheels(1.15, 1.9);
      for (const tx of [-1.0, 1.0]) { const tl = new THREE.Mesh(boxGeo, tailMat); tl.scale.set(0.3, 0.3, 0.12); tl.position.set(tx, 1.4, -2.84); g.add(tl); }
      return { group: g, radius: 3.0, mass: 12, parts: { wheels } };
    }
    if (kind === 'bus') {
      const body = new THREE.Mesh(boxGeo, cmat); body.scale.set(2.7, 3.2, 9.5); body.position.y = 2.2; g.add(body);
      const glass = new THREE.Mesh(boxGeo, glassMat); glass.scale.set(2.78, 1.2, 8.6); glass.position.y = 3.3; g.add(glass);
      const skirt = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x8a9099 }));
      skirt.scale.set(2.8, 0.5, 9.6); skirt.position.y = 0.9; g.add(skirt);
      const door = new THREE.Mesh(boxGeo, glassMat); door.scale.set(0.16, 2.6, 1.4); door.position.set(1.37, 2.0, 3.6); g.add(door);
      addWheels(1.3, 3.2);
      for (const tx of [-1.0, 1.0]) { const tl = new THREE.Mesh(boxGeo, tailMat); tl.scale.set(0.34, 0.34, 0.12); tl.position.set(tx, 1.6, -4.78); g.add(tl); }
      return { group: g, radius: 5.0, mass: 26, parts: { wheels } };
    }
    // 轿车：下半身 + 引擎盖 + 车厢 + 车窗
    const body = new THREE.Mesh(boxGeo, cmat); body.scale.set(2.3, 1.0, 4.6); body.position.y = 0.95; g.add(body);
    const hood = new THREE.Mesh(boxGeo, cmat); hood.scale.set(2.25, 0.7, 1.3); hood.position.set(0, 1.35, 1.75); g.add(hood);
    const trunk = new THREE.Mesh(boxGeo, cmat); trunk.scale.set(2.2, 0.7, 1.1); trunk.position.set(0, 1.35, -1.85); g.add(trunk);
    const cabin = new THREE.Mesh(boxGeo, cmat); cabin.scale.set(2.1, 1.0, 2.2); cabin.position.set(0, 1.7, -0.2); g.add(cabin);
    const wind = new THREE.Mesh(boxGeo, glassMat); wind.scale.set(1.95, 0.85, 0.12); wind.position.set(0, 1.75, 0.95); g.add(wind);
    const rear = new THREE.Mesh(boxGeo, glassMat); rear.scale.set(1.95, 0.8, 0.12); rear.position.set(0, 1.75, -1.35); g.add(rear);
    const sw = new THREE.Mesh(boxGeo, glassMat); sw.scale.set(0.12, 0.8, 2.0); sw.position.set(1.07, 1.75, -0.2); g.add(sw);
    const sw2 = sw.clone(); sw2.position.x = -1.07; g.add(sw2);
    for (const tx of [-0.85, 0.85]) {
      const hl = new THREE.Mesh(boxGeo, headMat); hl.scale.set(0.45, 0.28, 0.12); hl.position.set(tx, 1.0, 2.32); g.add(hl);
      const tl = new THREE.Mesh(boxGeo, tailMat); tl.scale.set(0.45, 0.28, 0.12); tl.position.set(tx, 1.05, -2.32); g.add(tl);
    }
    addWheels(1.05, 1.55);
    return { group: g, radius: 2.6, mass: 8, parts: { wheels } };
  }

  // 行人：分高矮、可戴帽子，四肢用 pivot 便于摆动
  function buildPerson() {
    const g = new THREE.Group();
    const skin = pick([0xffcc99, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524]);
    const cloth = pick(['#e05a5a', '#4d7fd6', '#5cb87a', '#f2c53d', '#a97ee0', '#ef8f3a', '#3fbdb0', '#d94f8f', '#4a5a70']);
    const lg = 0.9, h = rand(0.9, 1.3);
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: cloth }));
    body.scale.set(0.8, h, 0.5); body.position.y = lg + h / 2; g.add(body);
    const head = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: skin }));
    head.scale.set(0.6, 0.6, 0.6); head.position.y = lg + h + 0.3; g.add(head);
    if (Math.random() < 0.35) {
      const hat = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: pick(['#2a2a2a', '#8b5a2b', '#c0392b', '#2e86de']) }));
      hat.scale.set(0.66, 0.22, 0.66); hat.position.y = lg + h + 0.6; g.add(hat);
    }
    const mkLimb = (w, len, x, jointY, col) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, jointY, 0);
      const m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: col }));
      m.scale.set(w, len, w); m.position.y = -len / 2; pivot.add(m); g.add(pivot);
      return pivot;
    };
    const parts = {
      armL: mkLimb(0.2, 0.8, -0.5, lg + h * 0.9, cloth),
      armR: mkLimb(0.2, 0.8, 0.5, lg + h * 0.9, cloth),
      legL: mkLimb(0.22, lg, -0.22, lg, 0x33333d),
      legR: mkLimb(0.22, lg, 0.22, lg, 0x33333d)
    };
    return { group: g, radius: 0.7, mass: 1.2, parts };
  }

  // ===================== 城市布置 =====================
  function addPrey(res, x, z, kind, rotY) {
    res.group.position.set(x, 0, z);
    if (rotY !== undefined) res.group.rotation.y = rotY;
    scene.add(res.group);
    // blob 投影（柔和接触阴影，移动端稳定显示，不依赖 shadow map）
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(Math.max(res.radius * 1.5, 0.9), 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.18; blob.renderOrder = -2; res.group.add(blob);
    preys.push({ group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind });
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
    const xs = axisIntervals(ROAD_X), zs = axisIntervals(ROAD_Z);
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
              addPrey(buildRowHouse(), x, z, 'row', s.rot);
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
  // 草坪小道具
  function placeScatter() {
    const kinds = [['bush', buildBush, 14], ['flower', buildFlower, 18], ['bench', buildBench, 5], ['hydrant', buildHydrant, 4]];
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
    // 洞口遮罩（最上层纯黑，盖住下方地面/路面，避免穿透；depthTest:false + 高 renderOrder 压在透明路面标线之上）
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false });
    const hole = new THREE.Mesh(holeGeo, holeMat);
    hole.rotation.x = -Math.PI / 2; hole.position.y = 0.04; hole.renderOrder = 20; hole.scale.setScalar(1.06); g.add(hole);
    const lip = new THREE.Mesh(torusGeo, new THREE.MeshLambertMaterial({ color: opts.color }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.1; lip.renderOrder = 1; g.add(lip);
    const tc = 18;
    for (let i = 0; i < tc; i++) {
      const a = i / tc * Math.PI * 2;
      const t = new THREE.Mesh(boxGeo, toothMat);
      t.scale.set(0.14, 0.24, 0.14);
      t.position.set(Math.cos(a) * 0.9, 0.16, Math.sin(a) * 0.9);
      t.rotation.y = -a; g.add(t);
    }
    return g;
  }
  function makeMouth(opts) {
    const group = createMouth(opts);
    const m = {
      group, r: opts.r || CFG.startRadius, isPlayer: !!opts.isPlayer, earType: opts.earType,
      falling: false, eater: null, fallScale: 1, wander: rand(0, 6.28)
    };
    group.scale.setScalar(m.r);
    group.position.set(opts.x || 0, 0, opts.z || 0);
    scene.add(group);
    return m;
  }
  function spawnMouths() {
    player = makeMouth({ isPlayer: true, color: 0xff5a8a, earColor: 0xff86ad, earType: 'cat', r: CFG.startRadius, x: 0, z: 0 });
    mouths.push(player);
    const aiDefs = [
      { color: 0x4aa3ff, earColor: 0x2f7fd6, earType: 'dog' },
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
    p.group.position.x += (e.group.position.x - p.group.position.x) * Math.min(1, dt * 6);
    p.group.position.z += (e.group.position.z - p.group.position.z) * Math.min(1, dt * 6);
    p.group.position.y -= dt * (e.r * 1.6 + 5);
    const s = Math.max(0.001, p.group.scale.x - dt * 1.7);
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
    const off = new THREE.Vector3(0, 32 + r * 1.3, 24 + r * 1.6);
    const p = player ? player.group.position : new THREE.Vector3();
    camera.position.set(p.x + off.x, off.y, p.z + off.z);
    camera.lookAt(p.x, 0, p.z);
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
    };
    el.addEventListener('pointerdown', (e) => {
      if (state !== 'playing') return;
      pid = e.pointerId; ox = e.clientX; oy = e.clientY;
      input.vx = 0; input.vz = 0;
      if (el.setPointerCapture) el.setPointerCapture(pid);
    });
    el.addEventListener('pointermove', (e) => {
      if (pid === null || e.pointerId !== pid) return;
      setFromTouch(e.clientX, e.clientY);
    });
    const end = (e) => { if (e.pointerId === pid) { pid = null; input.vx = 0; input.vz = 0; } };
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
    initWorld();
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
  }
  window.addEventListener('load', init);
})();
