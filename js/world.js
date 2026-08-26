/* world.js — the terrarium: bowl, moss, water dish, flowers, food, pillow.
   Exposes FP.buildWorld(scene) -> world object used by fly/interaction. */
window.FP = window.FP || {};

FP.buildWorld = function (scene) {
  const W = {};

  // ---------- seeded noise ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(20240321);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const h = (X, Z) => perm[(perm[(X & 255)] + (Z & 255)) & 511] / 255;
    return h(xi, zi) * (1 - u) * (1 - v) + h(xi + 1, zi) * u * (1 - v) +
           h(xi, zi + 1) * (1 - u) * v + h(xi + 1, zi + 1) * u * v;
  }
  function fbm(x, z) {
    return vnoise(x, z) * 0.55 + vnoise(x * 2.3 + 7, z * 2.3 + 3) * 0.3 + vnoise(x * 5.1 + 13, z * 5.1 + 29) * 0.15;
  }

  // ---------- layout ----------
  const BOWL_R = 11, SOIL_TOP = 0, SOIL_DEPTH = 3.5;
  const DISH = { x: 4.3, z: 3.0, r: 3.1, waterR: 2.35, waterY: 0.62 };
  const PILLOW = { x: -4.6, z: -3.6, r: 2.1, topY: 1.05 };
  W.dish = DISH; W.pillow = PILLOW; W.bowlRadius = BOWL_R;
  W.rim = { y: 12.15, r: 9.25 };            // glass opening (perch spot)

  function flatMask(x, z) {                 // 1 -> flatten terrain here
    const d1 = Math.hypot(x - DISH.x, z - DISH.z) / (DISH.r + 0.9);
    const d2 = Math.hypot(x - PILLOW.x, z - PILLOW.z) / (PILLOW.r + 0.7);
    return Math.max(0, 1 - Math.min(d1, d2));
  }
  W.groundHeight = function (x, z) {
    const r = Math.hypot(x, z);
    if (r > BOWL_R) return 0;
    const edge = Math.min(1, Math.max(0, (10.4 - r) / 1.6));       // sink to 0 at glass
    const dome = 0.5 * Math.cos(Math.min(1, r / BOWL_R) * Math.PI * 0.5);
    let h = (fbm(x * 0.55 + 31, z * 0.55 + 17) - 0.45) * 0.8 + dome;
    h *= edge * (1 - 0.9 * Math.min(1, flatMask(x, z) * 1.4));
    return h;
  };

  // ---------- canvas texture helper ----------
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // ---------- wooden slab ----------
  const woodTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#8a6647'; g.fillRect(0, 0, w, h);
    for (let r = 8; r < 360; r += 7 + rng() * 16) {
      g.strokeStyle = `rgba(${70 + rng() * 30 | 0},${48 + rng() * 20 | 0},${30 + rng() * 12 | 0},${0.16 + rng() * 0.22})`;
      g.lineWidth = 1.5 + rng() * 2.5;
      g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke();
    }
  });
  const slab = new THREE.Mesh(
    new THREE.CylinderGeometry(15.4, 15.9, 1.7, 56),
    [new THREE.MeshPhongMaterial({ color: 0x6e4f33, shininess: 8 }),
     new THREE.MeshPhongMaterial({ map: woodTex, shininess: 14 }),
     new THREE.MeshPhongMaterial({ color: 0x5c4028 })]);
  slab.position.y = -SOIL_DEPTH - 0.85;
  slab.receiveShadow = true;
  scene.add(slab);

  // soft contact shadow under the slab
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(19, 40),
    new THREE.MeshBasicMaterial({
      map: canvasTex(256, 256, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(38,42,26,0.42)'); gr.addColorStop(1, 'rgba(38,42,26,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }), transparent: true, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = -SOIL_DEPTH - 1.74;
  scene.add(contact);

  // ---------- soil cross-section (seen through the glass) ----------
  const soilTex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#453221'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a2a1b'; g.fillRect(0, h * 0.55, w, h * 0.45);
    for (let i = 0; i < 150; i++) {                       // buried grit
      const y = rng() * h;
      g.fillStyle = `rgba(${100 + rng() * 45 | 0},${88 + rng() * 35 | 0},${72 + rng() * 26 | 0},${y > h * 0.6 ? 0.55 : 0.28})`;
      const s = y > h * 0.6 ? 3 + rng() * 6 : 1 + rng() * 3;
      g.beginPath(); g.ellipse(rng() * w, y, s, s * 0.75, rng() * 3, 0, Math.PI * 2); g.fill();
    }
  });
  soilTex.wrapS = THREE.RepeatWrapping; soilTex.repeat.x = 3;
  const soilWall = new THREE.Mesh(
    new THREE.CylinderGeometry(10.92, 10.6, SOIL_DEPTH, 48, 1, true),
    new THREE.MeshPhongMaterial({ map: soilTex, shininess: 4 }));
  soilWall.position.y = -SOIL_DEPTH / 2;
  scene.add(soilWall);

  // ---------- mossy terrain ----------
  const SOIL = new THREE.Color(0x54422c), MOSSES = [0x5a7d46, 0x74975a, 0x8fae6d, 0x678a4b].map(c => new THREE.Color(c));
  const terrGeo = new THREE.PlaneGeometry(22, 22, 80, 80);
  terrGeo.rotateX(-Math.PI / 2);
  {
    const p = terrGeo.attributes.position, colors = [];
    const col = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r > BOWL_R) { const s = BOWL_R / r; x *= s; z *= s; p.setX(i, x); p.setZ(i, z); }
      p.setY(i, W.groundHeight(x, z));
      const n = fbm(x * 0.8 + 3, z * 0.8 + 9);
      const m1 = MOSSES[(n * 7 | 0) % 4], m2 = MOSSES[(n * 13 | 0 + 1) % 4];
      col.copy(m1).lerp(m2, vnoise(x * 3 + 5, z * 3));
      const soilPatch = Math.max(0, Math.min(1, (fbm(x * 0.7 + 40, z * 0.7 + 40) - 0.62) * 6)) * 0.85;
      col.lerp(SOIL, soilPatch + Math.max(0, flatMask(x, z) - 0.55));
      col.multiplyScalar(0.88 + 0.24 * vnoise(x * 6, z * 6));
      colors.push(col.r, col.g, col.b);
    }
    terrGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    terrGeo.computeVertexNormals();
  }
  const terrain = new THREE.Mesh(terrGeo, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 3 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // placement helper — reject spots near set pieces
  function clearSpot(x, z, margin) {
    if (Math.hypot(x - DISH.x, z - DISH.z) < DISH.r + margin) return false;
    if (Math.hypot(x - PILLOW.x, z - PILLOW.z) < PILLOW.r + margin) return false;
    return Math.hypot(x, z) < 9.6;
  }

  // ---------- moss tufts + grass ----------
  const tuft = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.34, 1),
    new THREE.MeshPhongMaterial({ shininess: 4 }), 130);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const col = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < 130 && guard++ < 2000) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 9.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearSpot(x, z, 0.35)) continue;
      const sc = 0.55 + rng() * 1.35;
      s.set(sc, sc * (0.4 + rng() * 0.3), sc);
      q.setFromEuler(new THREE.Euler(0, rng() * 6.3, 0));
      v.set(x, W.groundHeight(x, z) + 0.05, z);
      m.compose(v, q, s); tuft.setMatrixAt(placed, m);
      col.copy(MOSSES[(rng() * 4) | 0]).multiplyScalar(0.85 + rng() * 0.35);
      tuft.setColorAt(placed, col);
      placed++;
    }
    tuft.count = placed;
  }
  tuft.castShadow = true; tuft.receiveShadow = true;
  scene.add(tuft);

  const grass = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.05, 1, 5),
    new THREE.MeshPhongMaterial({ shininess: 6 }), 170);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const e = new THREE.Euler(), col = new THREE.Color();
    let placed = 0, guard = 0;
    while (placed < 170 && guard++ < 2000) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 9.4;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearSpot(x, z, 0.65)) continue;
      const hgt = 0.6 + rng() * 1.3;
      e.set((rng() - 0.5) * 0.55, rng() * 6.3, (rng() - 0.5) * 0.55);
      q.setFromEuler(e); s.set(1, hgt, 1);
      v.set(x, W.groundHeight(x, z) + hgt * 0.48, z);
      m.compose(v, q, s); grass.setMatrixAt(placed, m);
      col.setHex(0x7fa35e).offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.12);
      grass.setColorAt(placed, col);
      placed++;
    }
    grass.count = placed;
  }
  grass.castShadow = true;
  scene.add(grass);

  // ---------- pebbles ----------
  const STONE = [0x9a948a, 0xb5aa98, 0x8b8378, 0xa79c8d, 0x7d7a72];
  const pebbles = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.32, 10, 8),
    new THREE.MeshPhongMaterial({ shininess: 30 }), 44);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const e = new THREE.Euler(), col = new THREE.Color();
    let i = 0;
    function pebble(x, z, y, big) {
      const sc = big ? 1 + rng() * 1.1 : 0.5 + rng() * 0.6;
      e.set(rng() * 3, rng() * 3, rng() * 3); q.setFromEuler(e);
      s.set(sc * (0.8 + rng() * 0.5), sc * (0.5 + rng() * 0.35), sc * (0.8 + rng() * 0.5));
      v.set(x, y, z); m.compose(v, q, s);
      pebbles.setMatrixAt(i, m);
      col.setHex(STONE[(rng() * STONE.length) | 0]).multiplyScalar(0.9 + rng() * 0.25);
      pebbles.setColorAt(i, col);
      i++;
    }
    for (let k = 0; k < 9 && i < 44; k++) {              // inside the dish, under water
      const a = rng() * Math.PI * 2, r = rng() * 1.7;
      pebble(DISH.x + Math.cos(a) * r, DISH.z + Math.sin(a) * r, 0.16, false);
    }
    for (let k = 0; k < 12 && i < 44; k++) {             // ring around the dish
      const a = rng() * Math.PI * 2, r = DISH.r + 0.5 + rng() * 0.9;
      const x = DISH.x + Math.cos(a) * r, z = DISH.z + Math.sin(a) * r;
      if (Math.hypot(x, z) < 9.6) pebble(x, z, W.groundHeight(x, z) + 0.1, false);
    }
    let guard = 0;
    while (i < 44 && guard++ < 400) {                    // scattered
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 9.2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearSpot(x, z, 0.4)) continue;
      pebble(x, z, W.groundHeight(x, z) + 0.08, rng() < 0.3);
    }
    pebbles.count = i;
  }
  pebbles.castShadow = true; pebbles.receiveShadow = true;
  scene.add(pebbles);

  // ---------- water dish ----------
  const dishGroup = new THREE.Group();
  dishGroup.position.set(DISH.x, W.groundHeight(DISH.x, DISH.z) - 0.06, DISH.z);
  {
    const pts = [
      new THREE.Vector2(0.0, 0.02), new THREE.Vector2(2.55, 0.02), new THREE.Vector2(2.92, 0.18),
      new THREE.Vector2(3.08, 0.55), new THREE.Vector2(3.02, 0.86), new THREE.Vector2(2.82, 0.93),
      new THREE.Vector2(2.62, 0.78), new THREE.Vector2(2.52, 0.45), new THREE.Vector2(2.3, 0.28),
      new THREE.Vector2(0.0, 0.24)];
    const dish = new THREE.Mesh(
      new THREE.LatheGeometry(pts, 40),
      new THREE.MeshPhongMaterial({ color: 0xe7e0cf, shininess: 55, specular: 0x555544, side: THREE.DoubleSide }));
    dish.castShadow = true; dish.receiveShadow = true;
    dishGroup.add(dish);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(DISH.waterR, 36),
      new THREE.MeshPhongMaterial({ color: 0x76aec2, transparent: true, opacity: 0.62, shininess: 160, specular: 0xccddee }));
    water.rotation.x = -Math.PI / 2; water.position.y = DISH.waterY;
    dishGroup.add(water);
  }
  scene.add(dishGroup);
  DISH.worldY = dishGroup.position.y;

  // ripples (spawned when he drinks / food lands)
  const ripples = [];
  const rippleMat = new THREE.MeshBasicMaterial({ color: 0xdfeef5, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  W.spawnRipple = function (x, z) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 26), rippleMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, DISH.worldY + DISH.waterY + 0.015, z);
    ring.scale.setScalar(0.12);
    scene.add(ring);
    ripples.push({ mesh: ring, age: 0 });
  };

  // ---------- pillow ----------
  const pillowGroup = new THREE.Group();
  pillowGroup.position.set(PILLOW.x, W.groundHeight(PILLOW.x, PILLOW.z), PILLOW.z);
  const pillowMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 18),
    new THREE.MeshPhongMaterial({ color: 0xc98f8f, shininess: 8 }));
  pillowMesh.scale.set(PILLOW.r, 0.62, PILLOW.r * 0.82);
  pillowMesh.position.y = 0.52;
  pillowMesh.castShadow = true; pillowMesh.receiveShadow = true;
  pillowGroup.add(pillowMesh);
  const seam = new THREE.Mesh(                       // piped seam around the middle
    new THREE.TorusGeometry(1, 0.035, 8, 40),
    new THREE.MeshPhongMaterial({ color: 0xb37676, shininess: 20 }));
  seam.rotation.x = Math.PI / 2;
  seam.scale.set(PILLOW.r * 0.99, PILLOW.r * 0.81, 1);
  seam.position.y = 0.54;
  pillowGroup.add(seam);
  scene.add(pillowGroup);
  PILLOW.mesh = pillowMesh;
  PILLOW.worldTop = pillowGroup.position.y + PILLOW.topY;

  // ---------- flowers ----------
  const flowerHeads = [];
  function flower(x, z, petalColor, coreColor, height, petals) {
    const g = new THREE.Group();
    const y0 = W.groundHeight(x, z);
    g.position.set(x, y0, z);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.12, height * 0.5, 0.06),
      new THREE.Vector3(-0.05, height, 0.02)]);
    const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.055, 6),
      new THREE.MeshPhongMaterial({ color: 0x5d7d43, shininess: 8 }));
    stem.castShadow = true;
    g.add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
      stem.material);
    leaf.scale.set(1.6, 0.25, 0.8); leaf.position.set(0.2, height * 0.4, 0.1);
    leaf.rotation.z = -0.4;
    g.add(leaf);
    const head = new THREE.Group();
    head.position.copy(curve.getPoint(1));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10),
      new THREE.MeshPhongMaterial({ color: coreColor, shininess: 25 }));
    core.scale.y = 0.7; core.castShadow = true;
    head.add(core);
    const petalMat = new THREE.MeshPhongMaterial({ color: petalColor, shininess: 12, side: THREE.DoubleSide });
    for (let i = 0; i < petals; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), petalMat);
      p.scale.set(1, 0.18, 0.44);
      const a = (i / petals) * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.33, 0.02, Math.sin(a) * 0.33);
      p.rotation.y = -a; p.rotation.z = 0.12;
      p.castShadow = true;
      head.add(p);
    }
    head.rotation.set((rng() - 0.5) * 0.5, rng() * 6.3, (rng() - 0.5) * 0.5);
    g.add(head);
    flowerHeads.push({ head, phase: rng() * 6.3, base: head.rotation.z });
    scene.add(g);
    return { x, z, headY: y0 + height };
  }
  flower(-3.2, 4.4, 0xf3f0e4, 0xe0aa3e, 3.4, 9);
  flower(-4.4, 3.4, 0xf3f0e4, 0xe0aa3e, 2.5, 8);
  flower(6.2, -2.6, 0xeec2cc, 0xd89a52, 2.9, 9);
  W.flower = flower(1.8, -5.8, 0xf5e6ba, 0xc98a2d, 3.8, 10);

  // ---------- mushrooms ----------
  function mushroom(x, z, s) {
    const g = new THREE.Group();
    g.position.set(x, W.groundHeight(x, z), z);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * s, 0.2 * s, 0.72 * s, 10),
      new THREE.MeshPhongMaterial({ color: 0xe8ddc8, shininess: 6 }));
    stalk.position.y = 0.36 * s; stalk.castShadow = true;
    g.add(stalk);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4 * s, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshPhongMaterial({ color: 0xb56b48, shininess: 18 }));
    cap.position.y = 0.62 * s; cap.scale.y = 0.75; cap.castShadow = true;
    g.add(cap);
    for (let i = 0; i < 4; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 6, 5), stalk.material);
      const a = rng() * 6.3, r = rng() * 0.28 * s;
      dot.position.set(Math.cos(a) * r, 0.74 * s + 0.12 * s * (1 - r / (0.4 * s)), Math.sin(a) * r);
      dot.scale.y = 0.5;
      g.add(dot);
    }
    scene.add(g);
  }
  mushroom(-6.8, 1.2, 1.0);
  mushroom(-6.2, 1.9, 0.62);

  // ---------- twig ----------
  {
    const y0 = W.groundHeight(-1.5, -7.2), y1 = W.groundHeight(0.6, -6.9), y2 = W.groundHeight(3.2, -5.8);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.5, y0 + 0.1, -7.2), new THREE.Vector3(0.6, y1 + 0.34, -6.9),
      new THREE.Vector3(2.0, y1 + 0.6, -6.4), new THREE.Vector3(3.2, y2 + 0.28, -5.8)]);
    const twig = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.17, 7),
      new THREE.MeshPhongMaterial({ color: 0x74563a, shininess: 6 }));
    twig.castShadow = true; twig.receiveShadow = true;
    scene.add(twig);
    W.twigPerch = new THREE.Vector3(2.0, y1 + 0.82, -6.4);
  }

  // ---------- food ----------
  W.foods = [];
  function addFood(mesh, x, z, radius, topY, kind) {
    const y = W.groundHeight(x, z);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(mesh);
    const food = { mesh, radius, topY, kind, baseRot: mesh.rotation.y };
    W.foods.push(food);
    return food;
  }
  const cucTop = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c4d8a4'; g.beginPath(); g.arc(128, 128, 128, 0, 6.3); g.fill();
    g.fillStyle = '#b8d093'; g.beginPath(); g.arc(128, 128, 108, 0, 6.3); g.fill();
    g.fillStyle = '#cfe0b4'; g.beginPath(); g.arc(128, 128, 70, 0, 6.3); g.fill();
    for (let i = 0; i < 9; i++) {                        // seeds
      const a = (i / 9) * Math.PI * 2 + 0.3;
      g.save(); g.translate(128 + Math.cos(a) * 46, 128 + Math.sin(a) * 46); g.rotate(a + 1.57);
      g.fillStyle = 'rgba(196,210,160,0.9)';
      g.beginPath(); g.ellipse(0, 0, 12, 6, 0, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(170,188,132,0.8)'; g.lineWidth = 2; g.stroke();
      g.restore();
    }
  });
  function cucumber(x, z, rot, tilt) {
    const geo = new THREE.CylinderGeometry(1.32, 1.32, 0.34, 30);
    const rind = new THREE.MeshPhongMaterial({ color: 0x49712f, shininess: 30 });
    const flesh = new THREE.MeshPhongMaterial({ map: cucTop, shininess: 18 });
    const m = new THREE.Mesh(geo, [rind, flesh, flesh]);
    m.rotation.set(tilt, rot, 0);
    return addFood(m, x, z, 1.35, 0.34, 'cucumber');
  }
  cucumber(-0.9, 1.6, 0.7, 0.06);
  cucumber(-2.9, 0.2, 2.3, -0.05);
  const carTop = canvasTex(128, 128, (g) => {
    g.fillStyle = '#e07b39'; g.beginPath(); g.arc(64, 64, 64, 0, 6.3); g.fill();
    g.fillStyle = '#eb9451'; g.beginPath(); g.arc(64, 64, 40, 0, 6.3); g.fill();
    g.fillStyle = '#f2ab68'; g.beginPath(); g.arc(64, 64, 18, 0, 6.3); g.fill();
    g.strokeStyle = 'rgba(214,110,45,0.7)'; g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * 20, 64 + Math.sin(a) * 20);
      g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); g.stroke();
    }
  });
  {
    const side = new THREE.MeshPhongMaterial({ color: 0xd96f2f, shininess: 26 });
    const top = new THREE.MeshPhongMaterial({ map: carTop, shininess: 20 });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.42, 22), [side, top, top]);
    coin.rotation.y = 1.2;
    addFood(coin, 1.4, -1.9, 0.95, 0.42, 'carrot');
    const stick = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.46, 0.5), side);
    stick.rotation.y = -0.5; stick.position.y += 0.02;
    addFood(stick, 0.8, -3.2, 1.0, 0.46, 'carrot');
  }
  W.settleFood = function (food) {                  // keep dragged food on the moss
    const p = food.mesh.position;
    const r = Math.hypot(p.x, p.z);
    if (r > 9.2) { p.x *= 9.2 / r; p.z *= 9.2 / r; }
    const inDish = Math.hypot(p.x - DISH.x, p.z - DISH.z) < DISH.waterR;
    if (inDish) { p.y = DISH.worldY + DISH.waterY - 0.1; W.spawnRipple(p.x, p.z); }
    else p.y = W.groundHeight(p.x, p.z);
  };

  // ---------- glass bowl ----------
  const glassMat = new THREE.MeshPhongMaterial({
    color: 0xdcecf0, transparent: true, opacity: 0.09, shininess: 210,
    specular: 0xffffff, side: THREE.DoubleSide, depthWrite: false });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(12, 56, 28, 0, Math.PI * 2, 0.88, 1.43), glassMat);
  glass.position.y = 4.5;
  glass.renderOrder = 5;
  scene.add(glass);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(9.25, 0.14, 10, 60),
    new THREE.MeshPhongMaterial({ color: 0xe8f2f2, transparent: true, opacity: 0.5, shininess: 220, specular: 0xffffff }));
  rim.rotation.x = Math.PI / 2; rim.position.y = W.rim.y;
  scene.add(rim);

  // ---------- dust motes ----------
  const MOTES = 70;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTES * 3);
  const moteSeed = [];
  for (let i = 0; i < MOTES; i++) {
    moteSeed.push({ a: rng() * 6.3, r: 1 + rng() * 7, y: 0.5 + rng() * 9.5, s: 0.1 + rng() * 0.4, p: rng() * 6.3 });
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    map: canvasTex(32, 32, (g) => {
      const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
      gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(1, 'rgba(255,250,230,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    }, false),
    size: 0.16, transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  scene.add(motes);

  // ---------- per-frame ----------
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  W.update = function (dt, t) {
    for (const f of flowerHeads) {
      f.head.rotation.z = f.base + Math.sin(t * 0.7 + f.phase) * 0.045;
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.age += dt;
      r.mesh.scale.setScalar(0.12 + r.age * 1.7);
      r.mesh.material.opacity = Math.max(0, 0.5 - r.age * 0.55);
      if (r.age > 1) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); ripples.splice(i, 1); }
    }
    if (!reduceMotion) {
      for (let i = 0; i < MOTES; i++) {
        const s = moteSeed[i];
        const a = s.a + t * 0.03 * (i % 2 ? 1 : -1);
        motePos[i * 3] = Math.cos(a) * s.r + Math.sin(t * s.s + s.p) * 0.5;
        motePos[i * 3 + 1] = s.y + Math.sin(t * 0.11 + s.p * 2) * 0.8;
        motePos[i * 3 + 2] = Math.sin(a) * s.r + Math.cos(t * s.s * 0.8 + s.p) * 0.5;
      }
      moteGeo.attributes.position.needsUpdate = true;
    }
  };

  return W;
};
