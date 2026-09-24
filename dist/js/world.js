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
  // waterY sits just under the rim so Mel's proboscis can actually reach it
  // from the lip; waterR is the usable (logical) water radius.
  const DISH = { x: 4.3, z: 3.0, r: 3.1, waterR: 2.6, waterY: 0.8 };
  const PILLOW = { x: -4.6, z: -3.6, r: 2.1, topY: 1.05 };
  const FOOD_ZONES = [
    { x: -0.9, z: 1.6, r: 1.55 }, { x: -2.9, z: 0.2, r: 1.55 },
    { x: 1.4, z: -1.9, r: 1.15 }, { x: 0.8, z: -3.2, r: 1.3 },
  ];
  W.dish = DISH; W.pillow = PILLOW; W.bowlRadius = BOWL_R;
  W.rim = { y: 12.15, r: 9.25, tube: 0.14 };  // glass opening (perch spot)

  function flatMask(x, z) {                 // 1 -> flatten terrain here (used for soil tint)
    const d1 = Math.hypot(x - DISH.x, z - DISH.z) / (DISH.r + 0.9);
    const d2 = Math.hypot(x - PILLOW.x, z - PILLOW.z) / (PILLOW.r + 0.7);
    return Math.max(0, 1 - Math.min(d1, d2));
  }
  function smooth01(e0, e1, v) {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  function naturalHeight(x, z) {
    const r = Math.hypot(x, z);
    if (r > BOWL_R) return 0;
    const edge = Math.min(1, Math.max(0, (10.4 - r) / 1.6));       // sink to 0 at glass
    const dome = 0.5 * Math.cos(Math.min(1, r / BOWL_R) * Math.PI * 0.5);
    return ((fbm(x * 0.55 + 31, z * 0.55 + 17) - 0.45) * 0.8 + dome) * edge;
  }
  // The dish and pillow sit on truly level plateaus. Previously the moss was
  // only partly flattened, so the ceramic foot floated over dips and the
  // terrain poked through its outer wall on the high side.
  const DISH_PLATEAU = naturalHeight(DISH.x, DISH.z) * 0.35;
  const PILLOW_PLATEAU = naturalHeight(PILLOW.x, PILLOW.z) * 0.35;
  function terrainFn(x, z) {
    let h = naturalHeight(x, z);
    const wd = smooth01(DISH.r + 1.3, DISH.r + 0.25, Math.hypot(x - DISH.x, z - DISH.z));
    const wp = smooth01(PILLOW.r + 1.1, PILLOW.r + 0.2, Math.hypot(x - PILLOW.x, z - PILLOW.z));
    h += (DISH_PLATEAU - h) * wd;
    h += (PILLOW_PLATEAU - h) * wp;
    return h;
  }
  W.groundHeight = terrainFn;               // replaced by the exact mesh sampler below

  // ---------- canvas texture helper ----------
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
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
  // The slab is below the whole soil bed. Receiving the terrarium's sun
  // shadows here creates large unexplained wedges on the exposed tabletop.
  slab.receiveShadow = false;
  scene.add(slab);

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
      p.setY(i, terrainFn(x, z));
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
  // Sample the *rendered* triangles rather than the analytic function: at a
  // 0.275-unit grid the two differ by several hundredths, enough for feet to
  // visibly sink into or hover above the moss.
  {
    const SEG = 80, N1 = SEG + 1, CELL = 22 / SEG;
    const hs = new Float32Array(N1 * N1);
    const p = terrGeo.attributes.position;
    for (let i = 0; i < p.count; i++) hs[i] = p.getY(i);
    W.groundHeight = function (x, z) {
      if (Math.hypot(x, z) > 10.3) return terrainFn(x, z);
      const gx = (x + 11) / CELL, gz = (z + 11) / CELL;
      const ix = Math.min(SEG - 1, Math.max(0, Math.floor(gx)));
      const iz = Math.min(SEG - 1, Math.max(0, Math.floor(gz)));
      const fx = gx - ix, fz = gz - iz;
      const ha = hs[ix + N1 * iz], hb = hs[ix + N1 * (iz + 1)];
      const hc = hs[ix + 1 + N1 * (iz + 1)], hd = hs[ix + 1 + N1 * iz];
      // PlaneGeometry splits each cell along the b-d diagonal: (a,b,d) + (b,c,d)
      if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
      return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
    };
  }
  const terrain = new THREE.Mesh(terrGeo, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 3 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // placement helper — reject spots near set pieces
  function clearSpot(x, z, margin) {
    if (Math.hypot(x - DISH.x, z - DISH.z) < DISH.r + margin) return false;
    if (Math.hypot(x - PILLOW.x, z - PILLOW.z) < PILLOW.r + margin) return false;
    for (const zone of FOOD_ZONES) {
      if (Math.hypot(x - zone.x, z - zone.z) < zone.r + margin) return false;
    }
    return Math.hypot(x, z) < 9.6;
  }

  // Walkable rounded props (moss tufts, pebbles, mushroom caps) are recorded as
  // ellipsoids so feet, food, shadows and the cursor ring can rest on them.
  const blobs = [];
  function addBlob(matrix, radius) {
    const inv = matrix.clone().invert();
    const e = matrix.elements;
    const sx = Math.hypot(e[0], e[1], e[2]), sy = Math.hypot(e[4], e[5], e[6]), sz = Math.hypot(e[8], e[9], e[10]);
    blobs.push({ inv: inv.elements.slice(), r2: radius * radius, x: e[12], z: e[14],
      y: e[13], reach: radius * Math.max(sx, sy, sz), top: e[13] + radius * Math.max(sx, sy, sz) });
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
      addBlob(m, 0.34 * 0.94);              // icosahedron faces sit a little inside its circumsphere
      col.copy(MOSSES[(rng() * 4) | 0]).multiplyScalar(0.85 + rng() * 0.35);
      tuft.setColorAt(placed, col);
      placed++;
    }
    tuft.count = placed;
  }
  tuft.castShadow = true; tuft.receiveShadow = true;
  scene.add(tuft);

  const grassBases = [], grassPositions = [], grassBent = new Set();
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
      grassBases.push(m.clone());
      grassPositions.push({ x, z, y0: W.groundHeight(x, z), q: q.clone(), s: s.clone(), c: v.clone() });
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
  const pebbleZones = [];
  const pebbles = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.32, 10, 8),
    new THREE.MeshPhongMaterial({ shininess: 30 }), 44);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const e = new THREE.Euler(), col = new THREE.Color();
    let i = 0;
    function pebble(x, z, y, big, restOn) {
      const sc = big ? 1 + rng() * 1.1 : 0.5 + rng() * 0.6;
      e.set(rng() * 3, rng() * 3, rng() * 3); q.setFromEuler(e);
      s.set(sc * (0.8 + rng() * 0.5), sc * (0.5 + rng() * 0.35), sc * (0.8 + rng() * 0.5));
      if (restOn !== undefined) {
        // rest on a floor: find the ellipsoid's lowest point for this rotation
        m.compose(v.set(0, 0, 0), q, s);
        const el = m.elements;
        const halfH = 0.32 * Math.hypot(el[1], el[5], el[9]);
        y = restOn + halfH * 0.8;
      }
      v.set(x, y, z); m.compose(v, q, s);
      pebbles.setMatrixAt(i, m);
      addBlob(m, 0.32);
      const bl = blobs[blobs.length - 1];
      pebbleZones.push({ x, z, r: sc * 0.32, top: bl.top, big });
      col.setHex(STONE[(rng() * STONE.length) | 0]).multiplyScalar(0.9 + rng() * 0.25);
      pebbles.setColorAt(i, col);
      i++;
    }
    for (let k = 0; k < 9 && i < 44; k++) {              // inside the dish, under water
      const a = rng() * Math.PI * 2, r = rng() * 1.7;
      // previously placed at a fixed y=0.16, i.e. through the dish floor (the
      // flat dark patches seen in the water); now resting on the floor
      pebble(DISH.x + Math.cos(a) * r, DISH.z + Math.sin(a) * r, 0, false, DISH_PLATEAU - 0.03 + 0.24 + r * 0.017);
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
  dishGroup.position.set(DISH.x, DISH_PLATEAU - 0.03, DISH.z);
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
    // The visible disc meets the inner wall (r≈2.65 at this height); before it
    // stopped 0.2 short, leaving a dry ring inside the bowl.
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(2.67, 40),
      new THREE.MeshPhongMaterial({ color: 0x76aec2, transparent: true, opacity: 0.62, shininess: 160, specular: 0xccddee }));
    water.rotation.x = -Math.PI / 2; water.position.y = DISH.waterY;
    dishGroup.add(water);
  }
  scene.add(dishGroup);
  DISH.worldY = dishGroup.position.y;
  DISH.rimY = DISH.worldY + 1.01;
  DISH.perchR = 2.78;                        // on the lip, just outside the water line
  DISH.waterWorldY = DISH.worldY + DISH.waterY;
  // upper envelope of the lathe profile (local r -> local y)
  const DISH_TOP = [[0, 0.24], [2.3, 0.28], [2.52, 0.45], [2.62, 0.78], [2.82, 0.93], [3.02, 0.86], [3.08, 0.55]];
  function dishTop(r) {
    if (r > 3.08) return null;
    for (let i = 1; i < DISH_TOP.length; i++) {
      if (r <= DISH_TOP[i][0]) {
        const [r0, y0] = DISH_TOP[i - 1], [r1, y1] = DISH_TOP[i];
        return DISH.worldY + y0 + (y1 - y0) * (r - r0) / (r1 - r0);
      }
    }
    return null;
  }

  // ripples (spawned when he drinks / food lands)
  const ripples = [];
  const rippleMat = new THREE.MeshBasicMaterial({ color: 0xdfeef5, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  W.spawnRipple = function (x, z) {
    // keep the centre on the water and never let a ring grow past the wall
    let dx = x - DISH.x, dz = z - DISH.z, d = Math.hypot(dx, dz);
    const maxD = DISH.waterR - 0.3;
    if (d > maxD) { dx *= maxD / d; dz *= maxD / d; d = maxD; }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 26), rippleMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(DISH.x + dx, DISH.waterWorldY + 0.012, DISH.z + dz);
    ring.scale.setScalar(0.12);
    scene.add(ring);
    ripples.push({ mesh: ring, age: 0, maxR: Math.max(0.25, 2.62 - d) });
  };

  // ---------- pillow ----------
  const pillowGroup = new THREE.Group();
  pillowGroup.position.set(PILLOW.x, PILLOW_PLATEAU, PILLOW.z);
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
  PILLOW.seam = seam;
  PILLOW.groupY = pillowGroup.position.y;
  // squishing keeps the pillow's base (0.1 below the moss) where it is instead
  // of lifting the bottom out of the ground
  PILLOW.setSquish = function (sy) {
    pillowMesh.scale.y = sy;
    pillowMesh.position.y = sy - 0.1;
    seam.position.y = pillowMesh.position.y + 0.02;
  };
  PILLOW.setSquish(0.62);
  W.pillowSurfaceHeight = function (x, z) {
    const dx = (x - PILLOW.x) / PILLOW.r;
    const dz = (z - PILLOW.z) / (PILLOW.r * 0.82);
    const r2 = dx * dx + dz * dz;
    if (r2 >= 0.98) return null;
    const verticalRadius = pillowMesh.scale.y;
    return PILLOW.groupY + pillowMesh.position.y + verticalRadius * Math.sqrt(1 - r2);
  };
  PILLOW.worldTop = W.pillowSurfaceHeight(PILLOW.x, PILLOW.z);

  // ---------- obstacles (things Mel walks around rather than over) ----------
  const obstacles = [
    { x: DISH.x, z: DISH.z, r: DISH.r, top: DISH.rimY, kind: 'dish' },
    { x: PILLOW.x, z: PILLOW.z, r: PILLOW.r, top: PILLOW.worldTop, kind: 'pillow' },
  ];
  W.obstacles = obstacles;

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
    // stem + leaf column; the head is wider but sits well above walking height
    obstacles.push({ x, z, r: 0.34, top: y0 + height + 0.1, head: 0.62, kind: 'flower' });
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
    addBlob(new THREE.Matrix4().compose(new THREE.Vector3(x, g.position.y + 0.62 * s, z),
      new THREE.Quaternion(), new THREE.Vector3(1, 0.75, 1)), 0.4 * s);
    obstacles.push({ x, z, r: 0.42 * s, top: g.position.y + 0.92 * s, kind: 'mushroom' });
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
    const TWIG_R = 0.17;
    const twigPts = curve.getSpacedPoints(90);
    W.twig = { pts: twigPts, r: TWIG_R, curve };
    // perch on the top of the tube at its highest bend that is well clear of
    // the flowers (the old perch sat 0.6 from a stem, so he could never land)
    let bestT = 0.5, bestY = -Infinity;
    for (let t = 0.12; t <= 0.88; t += 0.02) {
      const q = curve.getPointAt(t);
      const clear = obstacles.every(o => o.kind !== 'flower' || Math.hypot(q.x - o.x, q.z - o.z) > 1.4);
      if (clear && q.y > bestY) { bestY = q.y; bestT = t; }
    }
    const tp = curve.getPointAt(bestT), tt = curve.getTangentAt(bestT);
    W.twigPerch = new THREE.Vector3(tp.x, tp.y + TWIG_R, tp.z);
    W.twigPerchYaw = Math.atan2(tt.x, tt.z);
    for (let i = 0; i <= 90; i += 6) {
      const q = twigPts[i];
      obstacles.push({ x: q.x, z: q.z, r: TWIG_R + 0.05, top: q.y + TWIG_R, kind: 'twig' });
    }
  }

  // ---------- food ----------
  W.foods = [];
  const UP = new THREE.Vector3(0, 1, 0);
  function addFood(mesh, x, z, radius, height, kind, shape) {
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(mesh);
    const food = Object.assign({ mesh, radius, height, kind, yaw: mesh.rotation.y, inWater: false }, shape);
    mesh.position.set(x, 0, z);
    W.foods.push(food);
    return food;
  }
  // footprint sample points in the food's yaw frame
  function footprint(food) {
    const pts = [[0, 0]];
    if (food.shape === 'box') {
      for (const fx of [-1, -0.5, 0, 0.5, 1]) for (const fz of [-1, 0, 1]) if (fx || fz) pts.push([fx * food.hx, fz * food.hz]);
    } else {
      for (const k of [0.5, 0.97]) for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        pts.push([Math.cos(a) * food.radius * k, Math.sin(a) * food.radius * k]);
      }
    }
    return pts;
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
  function cucumber(x, z, rot) {
    const geo = new THREE.CylinderGeometry(1.32, 1.32, 0.34, 30);
    const rind = new THREE.MeshPhongMaterial({ color: 0x49712f, shininess: 30 });
    const flesh = new THREE.MeshPhongMaterial({ map: cucTop, shininess: 18 });
    const m = new THREE.Mesh(geo, [rind, flesh, flesh]);
    m.rotation.set(0, rot, 0);
    return addFood(m, x, z, 1.35, 0.34, 'cucumber', { shape: 'cyl' });
  }
  cucumber(-0.9, 1.6, 0.7);
  cucumber(-2.9, 0.2, 2.3);
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
    addFood(coin, 1.4, -1.9, 0.95, 0.42, 'carrot', { shape: 'cyl' });
    const stick = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.46, 0.5), side);
    stick.rotation.y = -0.5;
    addFood(stick, 0.8, -3.2, 1.08, 0.46, 'carrot', { shape: 'box', hx: 1.05, hz: 0.25 });
  }
  const hiddenGrass = new THREE.Matrix4().makeScale(0, 0, 0);
  const grassHidden = new Uint8Array(grassPositions.length);
  W.refreshGrassClearance = function () {
    for (let i = 0; i < grassPositions.length; i++) {
      const p = grassPositions[i];
      const inFood = W.foods.some(food =>
        Math.hypot(p.x - food.mesh.position.x, p.z - food.mesh.position.z) < food.radius + 0.24);
      const inPebble = pebbleZones.some(zone =>
        Math.hypot(p.x - zone.x, p.z - zone.z) < zone.r + 0.11);
      grassHidden[i] = inFood || inPebble ? 1 : 0;
      grass.setMatrixAt(i, grassHidden[i] ? hiddenGrass : grassBases[i]);
    }
    grass.instanceMatrix.needsUpdate = true;
    grassBent.clear();
  };

  // ---------- surfaces ----------
  // One height query for everything that can be stood on. Feet, the blob
  // shadow, the cursor ring, dragged food and the carried fly all use it, so
  // nothing sinks into (or hovers over) props the terrain function ignores.
  // opts.feet: open water is not a surface (returns NaN)
  // opts.skipFood: a food object (or true for all food) to ignore
  const blobGrid = new Map();
  function blobCell(ix, iz) { return ix * 1000 + iz; }
  function buildBlobGrid() {
    blobGrid.clear();
    blobs.forEach((b, i) => {
      for (let ix = Math.floor(b.x - b.reach); ix <= Math.floor(b.x + b.reach); ix++) {
        for (let iz = Math.floor(b.z - b.reach); iz <= Math.floor(b.z + b.reach); iz++) {
          const k = blobCell(ix, iz);
          if (!blobGrid.has(k)) blobGrid.set(k, []);
          blobGrid.get(k).push(i);
        }
      }
    });
  }
  function blobTop(b, x, z) {
    const e = b.inv;
    const ax = e[0] * x + e[8] * z + e[12], ay = e[1] * x + e[9] * z + e[13], az = e[2] * x + e[10] * z + e[14];
    const bx = e[4], by = e[5], bz = e[6];
    const BB = bx * bx + by * by + bz * bz, AB = ax * bx + ay * by + az * bz, AA = ax * ax + ay * ay + az * az;
    const disc = AB * AB - BB * (AA - b.r2);
    if (disc < 0) return -Infinity;
    return (-AB + Math.sqrt(disc)) / BB;
  }
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpN = new THREE.Vector3();
  function foodTop(food, x, z) {
    const m = food.mesh;
    tmpN.copy(UP).applyQuaternion(m.quaternion);
    const cx = m.position.x + tmpN.x * food.height / 2, cy = m.position.y + tmpN.y * food.height / 2, cz = m.position.z + tmpN.z * food.height / 2;
    tmpV.set(x - cx, 0, z - cz).applyQuaternion(tmpQ.copy(m.quaternion).invert());
    if (food.shape === 'box') {
      if (Math.abs(tmpV.x) > food.hx || Math.abs(tmpV.z) > food.hz) return -Infinity;
    } else if (tmpV.x * tmpV.x + tmpV.z * tmpV.z > food.radius * food.radius * 0.95) return -Infinity;
    return cy - (tmpN.x * (x - cx) + tmpN.z * (z - cz)) / tmpN.y;
  }
  W.foodTop = foodTop;
  const WATER_EDGE = 2.65;
  W.inWater = (x, z) => Math.hypot(x - DISH.x, z - DISH.z) < WATER_EDGE;
  // opts.maxY: ignore surfaces above this height (so the glass rim, 12 units
  // up, is not "the floor" for a fly or shadow down on the moss beside it)
  W.surfaceHeight = function (x, z, opts) {
    const cap = opts && opts.maxY !== undefined ? opts.maxY : Infinity;
    let y = W.groundHeight(x, z);
    const list = blobGrid.get(blobCell(Math.floor(x), Math.floor(z)));
    if (list) {
      for (const i of list) {
        const b = blobs[i];
        const dx = x - b.x, dz = z - b.z;
        if (dx * dx + dz * dz > b.reach * b.reach || b.top <= y) continue;
        const t = blobTop(b, x, z);
        if (t > y && t <= cap) y = t;
      }
    }
    const dd = Math.hypot(x - DISH.x, z - DISH.z);
    if (dd <= 3.08) {
      if (dd < WATER_EDGE) {
        if (opts && opts.feet) return NaN;
        if (DISH.waterWorldY <= cap) y = Math.max(y, DISH.waterWorldY);
      } else { const t = dishTop(dd); if (t <= cap) y = Math.max(y, t); }
    }
    const py = W.pillowSurfaceHeight(x, z);
    if (py !== null && py > y && py <= cap) y = py;
    const skip = opts && opts.skipFood;
    if (skip !== true) {
      for (const f of W.foods) {
        if (f === skip) continue;
        const t = foodTop(f, x, z);
        if (t > y && t <= cap) y = t;
      }
    }
    const tw = W.twig;
    if (tw && x > tw.minX && x < tw.maxX && z > tw.minZ && z < tw.maxZ) {
      const r2 = tw.r * tw.r;
      for (const q of tw.pts) {
        const dx = x - q.x, dz = z - q.z, d2 = dx * dx + dz * dz;
        if (d2 < r2) { const t = q.y + Math.sqrt(r2 - d2); if (t > y && t <= cap) y = t; }
      }
    }
    const dr = Math.abs(Math.hypot(x, z) - W.rim.r);
    if (dr < W.rim.tube) {
      const t = W.rim.y + Math.sqrt(W.rim.tube * W.rim.tube - dr * dr);
      if (t <= cap) y = Math.max(y, t);
    }
    return y;
  };

  // ---------- obstacle queries ----------
  function foodObstacles(f, out) {
    const x = f.mesh.position.x, z = f.mesh.position.z, top = f.mesh.position.y + f.height / 2;
    if (f.shape === 'box') {
      // a row of small circles along the stick; one big circle blocked the
      // gap between it and the nearby pebble entirely
      const c = Math.cos(f.yaw), s = Math.sin(f.yaw), n = 4;
      for (let i = 0; i < n; i++) {
        const lx = -f.hx + f.hz + (2 * (f.hx - f.hz)) * i / (n - 1);
        out.push({ x: x + lx * c, z: z - lx * s, r: f.hz * 1.35, top, kind: 'food', food: f });
      }
    } else out.push({ x, z, r: f.radius, top, kind: 'food', food: f });
  }
  // obstacles (optionally excluding some kinds / one food) as a fresh list
  W.obstacleList = function (skip) {
    const out = [];
    for (const o of obstacles) if (!(skip && skip[o.kind])) out.push(o);
    if (!(skip && skip.food === true)) {
      for (const f of W.foods) if (!(skip && skip.food === f)) foodObstacles(f, out);
    }
    return out;
  };
  W.isClear = function (x, z, margin, skip) {
    if (Math.hypot(x, z) > 9.3 - margin * 0.5) return false;
    if (W.inWater(x, z)) return false;
    for (const o of W.obstacleList(skip)) {
      if (Math.hypot(x - o.x, z - o.z) < o.r + margin) return false;
    }
    return true;
  };
  // push a point (x/z of `p`) out of every obstacle circle grown by `radius`
  W.pushOut = function (p, radius, skip, list) {
    list = list || W.obstacleList(skip);
    let moved = false;
    for (let pass = 0; pass < 3; pass++) {
      let any = false;
      for (const o of list) {
        const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + radius;
        if (d < min) {
          const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
          p.x = o.x + nx * min; p.z = o.z + nz * min;
          any = moved = true;
        }
      }
      if (!any) break;
    }
    return moved;
  };

  {
    const tw = W.twig;
    tw.minX = Math.min(...tw.pts.map(q => q.x)) - tw.r; tw.maxX = Math.max(...tw.pts.map(q => q.x)) + tw.r;
    tw.minZ = Math.min(...tw.pts.map(q => q.z)) - tw.r; tw.maxZ = Math.max(...tw.pts.map(q => q.z)) + tw.r;
  }
  buildBlobGrid();
  // pebbles tall enough to trip over are walked around, the rest walked over
  for (const zone of pebbleZones) {
    if (zone.top - W.groundHeight(zone.x, zone.z) > 0.3 && !W.inWater(zone.x, zone.z)) {
      obstacles.push({ x: zone.x, z: zone.z, r: zone.r * 1.25, top: zone.top, kind: 'pebble' });
    }
  }

  // ---------- settling food ----------
  W.settleFood = function (food, avoid) {       // keep dragged food on real surfaces
    const p = food.mesh.position;
    const maxR = 9.6 - food.radius;
    // dish: either afloat well inside the water, or clear of the ceramic walls
    const toDish = () => Math.hypot(p.x - DISH.x, p.z - DISH.z);
    let dd = toDish();
    food.inWater = dd < DISH.r * 0.72;
    if (food.inWater) {
      const lim = Math.max(0.1, DISH.waterR - food.radius - 0.05);
      if (dd > lim) { p.x = DISH.x + (p.x - DISH.x) * lim / dd; p.z = DISH.z + (p.z - DISH.z) * lim / dd; }
    } else {
      const list = W.obstacleList({ food, twig: false });
      // other food and (optionally) Mel himself are round obstacles too
      if (avoid) list.push({ x: avoid.x, z: avoid.z, r: 0.75 });
      for (let k = 0; k < 3; k++) {
        W.pushOut(p, food.radius + 0.05, null, list);
        const r = Math.hypot(p.x, p.z);
        if (r > maxR) { p.x *= maxR / r; p.z *= maxR / r; }
      }
    }
    const yawQ = tmpQ.setFromAxisAngle(UP, food.yaw);
    if (food.inWater) {
      food.mesh.quaternion.copy(yawQ);
      p.y = DISH.waterWorldY + 0.06 - food.height / 2;
      W.spawnRipple(p.x, p.z);
    } else {
      // fit a plane to whatever is underneath, then lift until nothing pokes through
      const pts = footprint(food);
      const cy = Math.cos(food.yaw), sy = Math.sin(food.yaw);
      let sx2 = 0, sz2 = 0, sxy = 0, szy = 0, sumY = 0;
      const hs = pts.map(([lx, lz]) => {
        const dx = lx * cy + lz * sy, dz = -lx * sy + lz * cy;
        // (capped so the glass rim, 12 units up, never counts as "underneath")
        const h = W.surfaceHeight(p.x + dx, p.z + dz, { skipFood: true, maxY: W.groundHeight(p.x + dx, p.z + dz) + 1.6 });
        sx2 += dx * dx; sz2 += dz * dz; sxy += dx * h; szy += dz * h; sumY += h;
        return [dx, dz, h];
      });
      let a = sx2 > 0 ? sxy / sx2 : 0, b = sz2 > 0 ? szy / sz2 : 0;
      const g = Math.hypot(a, b), gMax = 0.3;
      if (g > gMax) { a *= gMax / g; b *= gMax / g; }
      let base = -Infinity;
      for (const [dx, dz, h] of hs) base = Math.max(base, h - a * dx - b * dz);
      base -= 0.015;                               // nestle a hair into the moss
      tmpN.set(-a, 1, -b).normalize();
      food.mesh.quaternion.setFromUnitVectors(UP, tmpN).multiply(yawQ);
      p.y = base + tmpN.y * food.height / 2;
    }
    W.refreshGrassClearance();
  };
  for (const f of W.foods) W.settleFood(f);

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

  // ---------- decals that lie on surfaces ----------
  // A flat geometry in the XZ plane (mesh: yaw + uniform scale only) is
  // draped over the surfaces below it, so shadows and the cursor ring hug the
  // moss, pillow and food instead of cutting through slopes or hovering.
  W.drape = function (mesh, lift, opts) {
    const geo = mesh.geometry, pos = geo.attributes.position;
    if (!geo.userData.base) geo.userData.base = Float32Array.from(pos.array);
    const base = geo.userData.base;
    const sc = mesh.scale.x, cy = Math.cos(mesh.rotation.y), sy = Math.sin(mesh.rotation.y);
    const ox = mesh.position.x, oz = mesh.position.z, oy = mesh.position.y;
    for (let i = 0; i < pos.count; i++) {
      const lx = base[i * 3] * sc, lz = base[i * 3 + 2] * sc;
      const wx = ox + lx * cy + lz * sy, wz = oz - lx * sy + lz * cy;
      let h = W.surfaceHeight(wx, wz, opts);            // opts.maxY keeps decals off the rim
      if (!(h > -1e6)) h = oy;
      pos.setY(i, (h + lift - oy) / sc);
    }
    pos.needsUpdate = true;
  };

  // ---------- grass parts around Mel ----------
  // Blades inside his footprint lean away from him instead of spearing
  // through his body and legs.
  const bendM = new THREE.Matrix4(), bendQ = new THREE.Quaternion(), bendAxis = new THREE.Vector3();
  const bendP = new THREE.Vector3(), bendQ2 = new THREE.Quaternion();
  function bendGrass(fly) {
    let dirty = false;
    const seen = new Set();
    if (fly) {
      const ax = fly.x + fly.fx * 0.25, az = fly.z + fly.fz * 0.25;      // head end
      const bx = fly.x - fly.fx * 1.1, bz = fly.z - fly.fz * 1.1;        // abdomen tip
      const R = 0.95;
      for (let i = 0; i < grassPositions.length; i++) {
        if (grassHidden[i]) continue;
        const g = grassPositions[i];
        const low = fly.y - g.y0;
        if (low > 1.6) continue;
        // closest point on the body segment
        const ex = bx - ax, ez = bz - az;
        let k = ((g.x - ax) * ex + (g.z - az) * ez) / (ex * ex + ez * ez);
        k = Math.max(0, Math.min(1, k));
        const cx = ax + ex * k, cz = az + ez * k;
        let dx = g.x - cx, dz = g.z - cz;
        const d = Math.hypot(dx, dz);
        if (d > R) continue;
        if (d < 1e-3) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
        const amt = (1 - d / R) * (1 - Math.max(0, low - 0.6));
        const ang = Math.min(1.25, 0.35 + amt * 1.1);
        bendAxis.set(dz, 0, -dx);                    // tip swings toward (dx, dz)
        bendQ.setFromAxisAngle(bendAxis, ang);
        bendP.set(g.c.x - g.x, g.c.y - g.y0, g.c.z - g.z).applyQuaternion(bendQ);
        bendP.x += g.x; bendP.y += g.y0; bendP.z += g.z;
        bendQ2.copy(bendQ).multiply(g.q);
        bendM.compose(bendP, bendQ2, g.s);
        grass.setMatrixAt(i, bendM);
        seen.add(i); dirty = true;
      }
    }
    for (const i of grassBent) {
      if (!seen.has(i)) { grass.setMatrixAt(i, grassHidden[i] ? hiddenGrass : grassBases[i]); dirty = true; }
    }
    grassBent.clear();
    for (const i of seen) grassBent.add(i);
    if (dirty) grass.instanceMatrix.needsUpdate = true;
  }

  // ---------- per-frame ----------
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  W.update = function (dt, t, flyPose) {
    bendGrass(flyPose);
    for (const f of flowerHeads) {
      f.head.rotation.z = f.base + Math.sin(t * 0.7 + f.phase) * 0.045;
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]; r.age += dt;
      const rr = Math.min(r.maxR, 0.12 + r.age * 1.7);
      r.mesh.scale.setScalar(rr);
      r.mesh.material.opacity = Math.max(0, 0.5 - r.age * 0.55) * Math.min(1, (r.maxR - rr) / 0.25 + 0.05);
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
