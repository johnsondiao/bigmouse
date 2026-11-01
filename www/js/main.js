(function () {
  'use strict';

  // ===================== 配置 =====================
  const CFG = {
    world: 200,        // 地面半边长
    duration: 120,     // 单局秒数
    startRadius: 3.4,  // 初始嘴巴半径
    maxRadius: 52,
    playerSpeed: 30,   // 移动速度
    aiCount: 4,
    growthK: 0.16,     // 吞噬成长系数
    eatRatio: 1.15     // 比对手大这么多才能吃它
  };

  // 道路网格
  const ROAD_X = [-90, 0, 90];
  const ROAD_Z = [-90, 0, 90];
  const ROAD_W = 22;     // 马路宽
  const SIDE_W = 3.5;    // 人行道宽

  // ===================== 全局 =====================
  let scene, camera, renderer, clock;
  let preys = [];
  let mouths = [];
  let player = null;
  let ais = [];
  let placed = [];       // 建筑间距记录
  let state = 'menu';
  let timeLeft = CFG.duration;
  let eatCount = 0;
  let audioCtx = null, muted = false;
  const input = { vx: 0, vz: 0 };

  let boxGeo, circleGeo, torusGeo, cylOpenGeo, coneGeo, cylGeo, sphereGeo;
  let toothMat, windowTextures = [];

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (m, p) => {
    const dx = m.group.position.x - p.group.position.x;
    const dz = m.group.position.z - p.group.position.z;
    return dx * dx + dz * dz;
  };
  const inOcean = (x, z) => (x > 100 && z > 100);   // 海洋在 +,+ 角
  function onRoad(x, z) {
    for (const r of ROAD_Z) if (Math.abs(z - r) < ROAD_W / 2 + SIDE_W) return true;
    for (const r of ROAD_X) if (Math.abs(x - r) < ROAD_W / 2 + SIDE_W) return true;
    return false;
  }

  // 窗户贴图，让楼房看起来有窗户
  function makeWinTex(base) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 10; j++) {
        x.fillStyle = (i + j) % 3 === 0 ? '#ffe9a8' : '#2b3a55';
        x.fillRect(6 + i * 10, 8 + j * 12, 6, 8);
      }
    }
    return new THREE.CanvasTexture(c);
  }

  // ===================== 一次性搭建场景 =====================
  function initWorld() {
    const canvas = $('c');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fd8ff);
    scene.fog = new THREE.Fog(0x9fd8ff, 280, 460);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);

    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x6ab04c, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(60, 120, 40);
    scene.add(dir);

    boxGeo = new THREE.BoxGeometry(1, 1, 1);
    circleGeo = new THREE.CircleGeometry(1, 40);
    torusGeo = new THREE.TorusGeometry(1, 0.16, 10, 40);
    cylOpenGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    coneGeo = new THREE.ConeGeometry(1, 1, 12);
    cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
    sphereGeo = new THREE.SphereGeometry(1, 14, 12);
    toothMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const winBases = ['#7d93b8', '#8aa0c8', '#9fb0c8', '#6f8cc0', '#a9b7d0', '#86a0bf'];
    windowTextures = winBases.map(makeWinTex);

    // 草地
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.world * 2, CFG.world * 2),
      new THREE.MeshLambertMaterial({ color: 0x7cc24a })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    buildRoadNetwork();

    // 海洋（一角，装饰）
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

  // 3x3 路网：柏油 + 人行道 + 路缘石 + 黄色虚线车道线
  function buildRoadNetwork() {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x44444c });
    const sideMat = new THREE.MeshLambertMaterial({ color: 0x909199 });
    const curbMat = new THREE.MeshLambertMaterial({ color: 0xc2c2c2 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
    const len = CFG.world * 2;
    const addRoad = (axis, pos) => {
      const w = axis === 'x' ? len : ROAD_W;
      const d = axis === 'x' ? ROAD_W : len;
      const a = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), roadMat);
      a.position.set(axis === 'x' ? 0 : pos, 0.05, axis === 'x' ? pos : 0); scene.add(a);
      const off = ROAD_W / 2 + SIDE_W / 2;
      for (const s of [-1, 1]) {
        const sw = axis === 'x' ? len : SIDE_W;
        const sd = axis === 'x' ? SIDE_W : len;
        const s1 = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.16, sd), sideMat);
        if (axis === 'x') s1.position.set(0, 0.08, pos + s * off); else s1.position.set(pos + s * off, 0.08, 0);
        scene.add(s1);
        const cw = axis === 'x' ? len : 0.4;
        const cd = axis === 'x' ? 0.4 : len;
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.24, cd), curbMat);
        if (axis === 'x') c1.position.set(0, 0.12, pos + s * (ROAD_W / 2)); else c1.position.set(pos + s * (ROAD_W / 2), 0.12, 0);
        scene.add(c1);
      }
      const seg = 6, gap = 5, n = Math.floor(len / (seg + gap));
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + i * (seg + gap) + seg / 2;
        const lw = axis === 'x' ? seg : 0.5;
        const ld = axis === 'x' ? 0.5 : seg;
        const dash = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.13, ld), lineMat);
        if (axis === 'x') dash.position.set(t, 0.13, pos); else dash.position.set(pos, 0.13, t);
        scene.add(dash);
      }
    };
    for (const r of ROAD_Z) addRoad('x', r);
    for (const r of ROAD_X) addRoad('z', r);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ===================== 城市物件 =====================
  function buildSkyscraper() {
    const w = rand(8, 14), h = rand(34, 74), d = rand(8, 14);
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ map: pick(windowTextures), color: pick([0xffffff, 0xeef2ff, 0xdfe7ff]) });
    const body = new THREE.Mesh(boxGeo, mat); body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);
    const top = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x55606e }));
    top.scale.set(w * 0.5, 2, d * 0.5); top.position.y = h + 1; g.add(top);
    const ant = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x444444 }));
    ant.scale.set(0.1, 3, 0.1); ant.position.y = h + 2.5; g.add(ant);
    return { group: g, radius: 0.5 * Math.hypot(w, d), mass: 220 };
  }
  function buildApartment() {
    const w = rand(11, 17), h = rand(14, 28), d = rand(11, 17);
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ map: pick(windowTextures), color: pick([0xfff2d6, 0xffe9c2, 0xf3e2c0]) });
    const body = new THREE.Mesh(boxGeo, mat); body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);
    const roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xe07b3a }));
    roof.scale.set(w, 1.4, d); roof.position.y = h + 0.7; g.add(roof);
    return { group: g, radius: 0.5 * Math.hypot(w, d), mass: 95 };
  }
  function buildHouse() {
    const w = rand(6, 9), h = rand(6, 9), d = rand(6, 9);
    const g = new THREE.Group();
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: pick([0xffd98a, 0xf7c873, 0xffe6b0]) }));
    body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);
    const roof = new THREE.Mesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0xd6453f }));
    roof.scale.set(w * 0.8, h * 0.7, d * 0.8); roof.position.y = h + h * 0.35; roof.rotation.y = Math.PI / 4; g.add(roof);
    return { group: g, radius: 0.5 * Math.hypot(w, d), mass: 32 };
  }
  function buildShop() {
    const w = rand(10, 15), h = rand(8, 12), d = rand(10, 13);
    const g = new THREE.Group();
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: pick([0xbfe3c8, 0xcfe0ff, 0xffe0e6, 0xfff0c0]) }));
    body.scale.set(w, h, d); body.position.y = h / 2; g.add(body);
    const awn = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: pick([0xff5a5a, 0x4aa3ff, 0xff9d3d, 0x57d98a]) }));
    awn.scale.set(w, 1.2, 2); awn.position.set(0, h - 1, d / 2 + 1); g.add(awn);
    const sign = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x3a7bd5 }));
    sign.scale.set(w * 0.7, 2, 0.6); sign.position.set(0, h + 1.5, 0); g.add(sign);
    return { group: g, radius: 0.5 * Math.hypot(w, d), mass: 42 };
  }
  function buildCar() {
    const g = new THREE.Group();
    const color = pick([0xff4d4d, 0x4d79ff, 0x4dd07a, 0xffd24d, 0xff7ad2, 0xff9d3d, 0xffffff, 0x222831]);
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color }));
    body.scale.set(2.4, 1.1, 4.6); body.position.y = 0.95; g.add(body);
    const cabin = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x222831 }));
    cabin.scale.set(2.0, 0.9, 2.2); cabin.position.set(0, 1.8, -0.2); g.add(cabin);
    const wmat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const wheels = [];
    const wp = [[-1.0, 0.5, 1.5], [1.0, 0.5, 1.5], [-1.0, 0.5, -1.5], [1.0, 0.5, -1.5]];
    for (const p of wp) {
      const wheel = new THREE.Mesh(cylGeo, wmat);
      wheel.scale.set(0.5, 0.3, 0.5); wheel.rotation.z = Math.PI / 2;
      wheel.position.set(p[0], p[1], p[2]); g.add(wheel); wheels.push(wheel);
    }
    const hl = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    hl.scale.set(1.8, 0.3, 0.2); hl.position.set(0, 1.0, 2.3); g.add(hl);
    return { group: g, radius: 2.6, mass: 8, parts: { wheels } };
  }
  // 行人：分高矮、可戴帽子，四肢用 pivot 便于摆动
  function buildPerson() {
    const g = new THREE.Group();
    const skin = pick([0xffcc99, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524]);
    const cloth = pick([0xff6b6b, 0x4d96ff, 0x6bcb77, 0xffd93d, 0xb983ff, 0xff9f1c, 0x2ec4b6, 0xe71d73, 0x34495e]);
    const lg = 0.9;                 // 腿长
    const h = rand(0.9, 1.3);       // 躯干高
    const body = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: cloth }));
    body.scale.set(0.8, h, 0.5); body.position.y = lg + h / 2; g.add(body);
    const head = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: skin }));
    head.scale.set(0.6, 0.6, 0.6); head.position.y = lg + h + 0.3; g.add(head);
    if (Math.random() < 0.35) {
      const hat = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: pick([0x222222, 0x8b5a2b, 0xc0392b, 0x2e86de]) }));
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
      legL: mkLimb(0.22, lg, -0.22, lg, 0x2b2b35),
      legR: mkLimb(0.22, lg, 0.22, lg, 0x2b2b35)
    };
    return { group: g, radius: 0.7, mass: 1.2, parts };
  }
  function buildTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
    trunk.scale.set(0.4, 2, 0.4); trunk.position.y = 1; g.add(trunk);
    const foli = new THREE.Mesh(coneGeo, new THREE.MeshLambertMaterial({ color: pick([0x3fa34d, 0x4caf50, 0x2e8b57]) }));
    foli.scale.set(1.8, 4, 1.8); foli.position.y = 4; g.add(foli);
    return { group: g, radius: 1.6, mass: 11 };
  }
  function buildStreetLamp() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x333333 }));
    pole.scale.set(0.18, 5, 0.18); pole.position.y = 2.5; g.add(pole);
    const arm = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x333333 }));
    arm.scale.set(0.18, 0.18, 1.4); arm.position.set(0, 5, 0.6); g.add(arm);
    const bulb = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    bulb.scale.setScalar(0.3); bulb.position.set(0, 4.9, 1.2); g.add(bulb);
    return { group: g, radius: 0.8, mass: 3 };
  }
  function buildTrafficLight() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(cylGeo, new THREE.MeshLambertMaterial({ color: 0x444444 }));
    pole.scale.set(0.16, 4, 0.16); pole.position.y = 2; g.add(pole);
    const head = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x222222 }));
    head.scale.set(0.8, 1.8, 0.5); head.position.y = 4.4; g.add(head);
    const cols = [0xff3b30, 0xffcc00, 0x34c759];
    cols.forEach((c, i) => {
      const bulb = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: c }));
      bulb.scale.setScalar(0.18); bulb.position.set(0, 4.8 - i * 0.6, 0.26); g.add(bulb);
    });
    return { group: g, radius: 0.6, mass: 2 };
  }
  function buildFence() {
    const g = new THREE.Group();
    const wmat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(boxGeo, wmat);
      p.scale.set(0.25, 2, 0.25); p.position.set(-2 + i * 1, 1, 0); g.add(p);
    }
    for (const y of [0.6, 1.6]) {
      const rail = new THREE.Mesh(boxGeo, wmat);
      rail.scale.set(4.4, 0.18, 0.18); rail.position.set(0, y, 0); g.add(rail);
    }
    return { group: g, radius: 2.4, mass: 14 };
  }

  // ===================== 城市布置 =====================
  function tryPlace(x, z, margin) {
    if (onRoad(x, z)) return false;
    if (inOcean(x, z)) return false;
    if (Math.hypot(x, z) < 26) return false;   // 玩家起步区域留空
    for (const q of placed) if (Math.hypot(x - q.x, z - q.z) < q.r + margin) return false;
    return true;
  }
  function placeBuilding(fn, kind) {
    for (let t = 0; t < 18; t++) {
      const x = rand(-190, 190), z = rand(-190, 190);
      const margin = rand(7, 12);
      if (!tryPlace(x, z, margin * 0.7)) continue;
      const res = fn();
      res.group.position.set(x, 0, z);
      res.group.rotation.y = rand(0, 6.28);
      scene.add(res.group);
      preys.push({ group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind });
      placed.push({ x, z, r: res.radius * 0.6 });
      return;
    }
  }
  function placeRoadsideShops(n) {
    let made = 0, guard = 0;
    while (made < n && guard < 500) {
      guard++;
      const axis = Math.random() < 0.5 ? 'x' : 'z';
      const roads = axis === 'x' ? ROAD_Z : ROAD_X;
      const r = pick(roads);
      const along = rand(-CFG.world + 12, CFG.world - 12);
      const side = Math.random() < 0.5 ? -1 : 1;
      const off = ROAD_W / 2 + SIDE_W + rand(2, 5);
      let x, z;
      if (axis === 'x') { x = along; z = r + side * off; } else { z = along; x = r + side * off; }
      if (inOcean(x, z) || Math.hypot(x, z) < 26) continue;
      let ok = true;
      for (const q of placed) if (Math.hypot(x - q.x, z - q.z) < q.r + 5) { ok = false; break; }
      if (!ok) continue;
      const res = buildShop();
      res.group.position.set(x, 0, z);
      res.group.rotation.y = axis === 'x' ? (side < 0 ? Math.PI / 2 : -Math.PI / 2) : (side < 0 ? 0 : Math.PI);
      scene.add(res.group);
      preys.push({ group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind: 'shop' });
      placed.push({ x, z, r: res.radius * 0.6 });
      made++;
    }
  }
  function placeWalker() {
    for (let t = 0; t < 18; t++) {
      const x = rand(-185, 185), z = rand(-185, 185);
      if (onRoad(x, z) || inOcean(x, z) || Math.hypot(x, z) < 24) continue;
      const res = buildPerson();
      res.group.position.set(x, 0, z);
      scene.add(res.group);
      preys.push({
        group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind: 'person',
        parts: res.parts, walk: { tx: rand(-180, 180), tz: rand(-180, 180), spd: rand(0, 3), phase: rand(0, 6.28) }
      });
      return;
    }
  }
  function placeCar() {
    const axis = Math.random() < 0.5 ? 'x' : 'z';
    const roads = axis === 'x' ? ROAD_Z : ROAD_X;
    const r = pick(roads);
    const lane = (Math.random() < 0.5 ? -1 : 1) * (ROAD_W / 2 - 5);
    const along = rand(-CFG.world + 12, CFG.world - 12);
    const dir = Math.random() < 0.5 ? 1 : -1;
    let x, z;
    if (axis === 'x') { x = along; z = r + lane; } else { z = along; x = r + lane; }
    const res = buildCar();
    res.group.position.set(x, 0, z);
    scene.add(res.group);
    preys.push({ group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind: 'car', parts: res.parts, car: { axis, dir, spd: rand(14, 22) } });
  }
  function placeDeco(fn, kind, n, onSidewalk) {
    for (let i = 0; i < n; i++) {
      let x, z, tries = 0;
      do {
        tries++;
        if (onSidewalk) {
          const axis = Math.random() < 0.5 ? 'x' : 'z';
          const roads = axis === 'x' ? ROAD_Z : ROAD_X;
          const r = pick(roads);
          const along = rand(-CFG.world + 12, CFG.world - 12);
          const side = Math.random() < 0.5 ? -1 : 1;
          const off = ROAD_W / 2 + SIDE_W / 2;
          if (axis === 'x') { x = along; z = r + side * off; } else { z = along; x = r + side * off; }
        } else {
          x = rand(-190, 190); z = rand(-190, 190);
        }
      } while (tries < 20 && (onRoad(x, z) && !onSidewalk || inOcean(x, z) || Math.hypot(x, z) < 24));
      const res = fn();
      res.group.position.set(x, 0, z);
      res.group.rotation.y = rand(0, 6.28);
      scene.add(res.group);
      preys.push({ group: res.group, radius: res.radius, mass: res.mass, eaten: false, eater: null, kind });
    }
  }
  function spawnPreys() {
    placed.length = 0;
    // 街区建筑
    for (let i = 0; i < 48; i++) placeBuilding(buildSkyscraper, 'sky');
    for (let i = 0; i < 42; i++) placeBuilding(buildApartment, 'apt');
    for (let i = 0; i < 34; i++) placeBuilding(buildHouse, 'house');
    // 路边商店
    placeRoadsideShops(36);
    // 行人（会走动）
    for (let i = 0; i < 20; i++) placeWalker();
    // 车辆（在公路上行驶）
    for (let i = 0; i < 12; i++) placeCar();
    // 树、路灯、红绿灯、围栏
    for (let i = 0; i < 18; i++) placeDeco(buildTree, 'tree', 1, false);
    placeDeco(buildStreetLamp, 'lamp', 18, true);
    placeDeco(buildTrafficLight, 'light', 6, false);
    placeDeco(buildFence, 'fence', 5, false);
  }

  // ===================== 大嘴巴 =====================
  // 耳朵：贴着草地向外摊平，不立起来
  function addEars(g, type, color) {
    const mat = new THREE.MeshLambertMaterial({ color });
    const addEar = (angle, make) => {
      const pivot = new THREE.Group();
      pivot.rotation.y = angle;
      const ear = make();
      ear.position.set(0, 0.06, 1.02);        // 洞口边缘外侧，贴地
      ear.rotation.x = Math.PI / 2 - 0.16;     // 放倒：整体趴在草地上，尖端略翘
      pivot.add(ear);
      g.add(pivot);
    };
    const coneEar = (r, h) => { const e = new THREE.Mesh(coneGeo, mat); e.scale.set(r, h, r); return e; };
    const boxEar = (w, h, d) => { const e = new THREE.Mesh(boxGeo, mat); e.scale.set(w, h, d); return e; };
    const sphEar = (r) => { const e = new THREE.Mesh(sphereGeo, mat); e.scale.set(r, 0.14, r); return e; };
    if (type === 'cat') {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.7, () => coneEar(0.32, 0.7));
    } else if (type === 'bunny') {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.5, () => coneEar(0.2, 1.1));
    } else if (type === 'bear') {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.8, () => sphEar(0.3));
    } else if (type === 'dog') {
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.8, () => boxEar(0.28, 0.12, 0.55));
    } else { // fox
      for (const s of [-1, 1]) addEar(Math.PI / 2 + s * 0.6, () => coneEar(0.3, 0.8));
    }
  }
  function createMouth(opts) {
    const g = new THREE.Group();
    const hole = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: 0x07070d }));
    hole.rotation.x = -Math.PI / 2; hole.position.y = 0.03; g.add(hole);
    const depth = new THREE.Mesh(cylOpenGeo, new THREE.MeshBasicMaterial({ color: 0x05050a, side: THREE.BackSide }));
    depth.position.y = -0.5; g.add(depth);
    const lip = new THREE.Mesh(torusGeo, new THREE.MeshLambertMaterial({ color: opts.color }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.08; g.add(lip);
    const tc = 18;
    for (let i = 0; i < tc; i++) {
      const a = i / tc * Math.PI * 2;
      const t = new THREE.Mesh(boxGeo, toothMat);
      t.scale.set(0.14, 0.24, 0.14);
      t.position.set(Math.cos(a) * 0.9, 0.12, Math.sin(a) * 0.9);
      t.rotation.y = -a; g.add(t);
    }
    addEars(g, opts.earType, opts.earColor);
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

  // ===================== 玩法更新 =====================
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
        const d = dist2(m, p);
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
  // 行人漫步：走向随机目标，四肢摆动 + 上下颠簸
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
  // 车辆沿公路行驶，车轮转动
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

  // ===================== HUD / 结算 =====================
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
    const r = player ? player.r : CFG.startRadius;
    const off = new THREE.Vector3(0, 34 + r * 1.4, 26 + r * 1.7);
    const p = player ? player.group.position : new THREE.Vector3();
    camera.position.set(p.x + off.x, off.y, p.z + off.z);
    camera.lookAt(p.x, 0, p.z);
  }
  function loop() {
    requestAnimationFrame(loop);
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
    spawnPreys();
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
