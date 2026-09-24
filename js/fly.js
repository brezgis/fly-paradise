/* fly.js — Mel: NeuroMechFly body, procedural tripod gait, needs & moods.
   FP.createFly(scene, world) -> fly object. Update with fly.update(dt, t, io)
   where io comes from the interaction layer (cursor, petting, carrying). */
window.FP = window.FP || {};

FP.createFly = function (scene, world) {
  const M = FP.FLY_MODEL;
  const SCALE = 2.05;                        // model length 1.0 -> world units (storybook scale)
  const V = THREE.Vector3, Q = THREE.Quaternion;
  const tmpA = new V(), tmpB = new V(), tmpC = new V(), tmpD = new V();
  const DOWN = new V(0, -1, 0);

  // ---------- decode model geometry ----------
  function decodeGeometry(p) {
    const raw = atob(p.pos_b64);
    const q = new Uint16Array(p.nv * 3);
    for (let i = 0; i < q.length; i++) q[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    const pos = new Float32Array(p.nv * 3);
    for (let i = 0; i < p.nv; i++) {
      for (let c = 0; c < 3; c++) {
        pos[i * 3 + c] = p.min[c] + (q[i * 3 + c] / 65535) * p.range[c];
      }
    }
    const rawI = atob(p.idx_b64);
    const idx = new Uint16Array(p.nf * 3);
    for (let i = 0; i < idx.length; i++) idx[i] = rawI.charCodeAt(i * 2) | (rawI.charCodeAt(i * 2 + 1) << 8);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  }

  // abdomen stripes as vertex colors (STLs have no UVs)
  function stripeAbdomen(geo) {
    const pos = geo.attributes.position;
    const box = new THREE.Box3().setFromBufferAttribute(pos);
    const span = Math.max(1e-6, box.max.z - box.min.z);
    const base = new THREE.Color(0xb08948), dark = new THREE.Color(0x4a3416);
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = 1 - (pos.getZ(i) - box.min.z) / span;      // 0 front -> 1 tip
      const band = Math.pow(Math.max(0, Math.sin(t * Math.PI * 5.2 - 0.9)), 3) * Math.min(1, t * 2.2);
      const tip = Math.max(0, (t - 0.82) * 5.5);
      c.copy(base).lerp(dark, Math.min(1, band * 0.85 + tip));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  const MATS = {
    cuticle: new THREE.MeshStandardMaterial({ color: 0x8a5a2f, roughness: 0.52, metalness: 0.05 }),
    abdomen: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x611007, roughness: 0.3, metalness: 0.08, emissive: 0x160302 }),
    leg: new THREE.MeshStandardMaterial({ color: 0x6b4823, roughness: 0.6 }),
    antenna: new THREE.MeshStandardMaterial({ color: 0x5c3d1e, roughness: 0.6 }),
    proboscis: new THREE.MeshStandardMaterial({ color: 0x9c6f42, roughness: 0.55 }),
    haltere: new THREE.MeshStandardMaterial({ color: 0xb99459, roughness: 0.5 }),
    wing: new THREE.MeshPhysicalMaterial({
      color: 0xdfe9f2, transparent: true, opacity: 0.32, roughness: 0.18,
      metalness: 0, iridescence: 0.85, iridescenceIOR: 1.35,
      side: THREE.DoubleSide, depthWrite: false }),
  };
  function materialFor(name) {
    if (name.startsWith('eye')) return MATS.eye;
    if (name.startsWith('wing')) return MATS.wing;
    if (name.startsWith('leg')) return MATS.leg;
    if (name.startsWith('antenna')) return MATS.antenna;
    if (name === 'proboscis') return MATS.proboscis;
    if (name.startsWith('haltere')) return MATS.haltere;
    if (name === 'abdomen') return MATS.abdomen;
    return MATS.cuticle;
  }

  const root = new THREE.Group();            // on the ground, yaw only
  root.scale.setScalar(SCALE);
  const body = new THREE.Group();            // height, pitch & roll
  root.add(body);
  scene.add(root);

  const parts = {};
  for (const p of M.parts) {
    const g = decodeGeometry(p);
    if (p.name === 'abdomen') stripeAbdomen(g);
    const mesh = new THREE.Mesh(g, materialFor(p.name));
    mesh.castShadow = true;
    const grp = new THREE.Group();
    grp.position.fromArray(p.pos);
    grp.quaternion.set(p.quat[1], p.quat[2], p.quat[3], p.quat[0]);
    grp.add(mesh);
    if (p.name.startsWith('wing')) {
      // the CT rest pose already folds the wings back — just tuck the tips
      // slightly toward the midline so they overlap like a resting fly's
      const side = p.name.endsWith('_l') ? 1 : -1;
      grp.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side * 0.2));
    }
    grp.userData.rest = grp.quaternion.clone();
    parts[p.name] = grp;
    (p.parent ? parts[p.parent] : body).add(grp);
  }

  // soft blob shadow that grounds him (the sun shadow is too coarse at fly scale).
  // It is a small grid draped over whatever is underneath, so it no longer
  // cuts into slopes, pillows or food.
  const blobShadow = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(30,34,18,0.5)'); gr.addColorStop(1, 'rgba(30,34,18,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const geo = new THREE.PlaneGeometry(1.9, 2.3, 8, 8);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -0.45);                  // centred under the whole body, not the thorax
    const m = new THREE.Mesh(geo,
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.renderOrder = 1;
    scene.add(m);
    return m;
  })();

  // wing motion blur discs (flight only)
  const blurMat = new THREE.MeshBasicMaterial({
    color: 0xf2ecdc, transparent: true, opacity: 0, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending });
  const blurs = [1, -1].map(side => {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), blurMat.clone());
    b.scale.set(1, 0.62, 1);
    b.position.set(side * 0.3, 0.16, -0.18);
    b.rotation.set(-1.1, 0, side * 0.5);
    b.visible = false;
    body.add(b);
    return b;
  });

  // ---------- legs & gait ----------
  const LEGS = [];
  const STANCE = { f: [0.30, 0.34], m: [0.44, -0.14], h: [0.36, -0.52] };  // [out, fwd]
  const partInfo = {};
  for (const p of M.parts) partInfo[p.name] = p;
  for (const key of ['lf', 'lm', 'lh', 'rf', 'rm', 'rh']) {
    const info = M.legs[key];
    const side = key[0] === 'l' ? 1 : -1;
    const st = STANCE[key[1]];
    LEGS.push({
      key, side,
      hip: new V().fromArray(info.hip),
      lens: info.lens,
      // the tarsus mesh runs a little past the nominal joint chain; aim with
      // its real length so the claw lands on the target instead of below it
      tipLen: -partInfo[`leg_${key}_tarsus`].min[1],
      parts: ['coxa', 'femur', 'tibia', 'tarsus'].map(s => parts[`leg_${key}_${s}`]),
      stance: new V(side * st[0], 0, st[1]),
      foot: new V(),                          // world-space planted foot
      footNow: new V(),
      from: new V(), to: new V(),
      swing: -1,                              // <0 planted, else 0..1 swing progress
      tripod: (key === 'lf' || key === 'rm' || key === 'lh') ? 0 : 1,
      tuck: 0,
    });
  }

  const BODY_H = 0.34;
  let bodyH = BODY_H;
  const FOOT_LIFT = 0.012;                   // claw pads rest on, not in, the surface
  const DROP = 0.42, RISE = 0.6;             // how far a foot may reach below/above the root

  // walkable surface height (NaN over open water); `cap` ignores anything
  // higher (e.g. the glass rim when he is down on the moss beside it)
  const surfOpts = { feet: true, maxY: Infinity };
  function surf(x, z, cap) {
    surfOpts.maxY = cap === undefined ? Infinity : cap;
    return world.surfaceHeight(x, z, surfOpts);
  }
  // (only surfaces far overhead are ignored: anything he could bump into
  // still counts, so a foot is never "on the moss" underneath a food slice)
  function footSurf(x, z) { return surf(x, z, root.position.y + 3); }
  function groundY(x, z) {
    const h = surf(x, z);
    return h === h ? h : world.groundHeight(x, z);
  }

  // root has yaw + uniform scale only, so its transform is cheap to apply by
  // hand — and never stale, unlike matrixWorld right after a teleport
  function rootToWorld(lx, ly, lz, out) {
    const c = Math.cos(root.rotation.y), s = Math.sin(root.rotation.y);
    return out.set(root.position.x + SCALE * (lx * c + lz * s),
      root.position.y + SCALE * ly,
      root.position.z + SCALE * (-lx * s + lz * c));
  }

  // place root somewhere pleasant to start
  root.position.set(-1.5, 0, -0.8);
  root.rotation.y = 0.6;

  // Foot placement: project the stance point onto the real surface. When that
  // lands off an edge (twig, rim, dish lip, water) or up a wall, walk the
  // target back toward the hip until it finds footing — feet grip edges
  // instead of dangling in the air or sinking through props.
  const probe = new V(), hipW = new V();
  // a foothold is only usable if the leg can get to it: reject spots tucked
  // against the side of food, a pebble or the dish (the leg would pass
  // through the wall between the hip and the foot)
  function legPathClear(leg, fx, fy, fz) {
    rootToWorld(leg.hip.x, BODY_H + leg.hip.y, leg.hip.z, hipW);
    for (const t of [0.25, 0.5]) {                // the knee arches, so allow some slack
      const x = fx + (hipW.x - fx) * t, z = fz + (hipW.z - fz) * t;
      const h = footSurf(x, z);
      if (h === h && h > fy + (hipW.y - fy) * t * 1.5) return false;
    }
    return true;
  }
  function placeFoot(leg, lead, out) {
    let sx = leg.stance.x, sz = leg.stance.z;
    if (lead) { sx += velRoot.x * 0.16; sz += velRoot.z * 0.16; }
    const baseY = root.position.y;
    const hx = leg.hip.x * 0.6, hz = leg.hip.z;
    for (let k = 0; k <= 1.0001; k += 0.125) {
      rootToWorld(sx + (hx - sx) * k, 0, sz + (hz - sz) * k, probe);
      const h = footSurf(probe.x, probe.z);
      if (h === h && h > baseY - DROP && h < baseY + RISE && legPathClear(leg, probe.x, h, probe.z)) {
        leg.dangling = false;
        return out.set(probe.x, h + FOOT_LIFT, probe.z);
      }
    }
    // then the nearest foothold around the nominal spot that the leg can
    // still reach from its hip (e.g. forward onto a narrow lip or twig)
    for (let ring = 1; ring <= 6; ring++) {
      const rr = ring * 0.07;
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 + ring * 0.7;
        const lx = sx + Math.cos(a) * rr, lz = sz + Math.sin(a) * rr;
        if (Math.hypot(lx - leg.hip.x, lz - leg.hip.z) > 0.56) continue;
        rootToWorld(lx, 0, lz, probe);
        const h = footSurf(probe.x, probe.z);
        if (h === h && h > baseY - DROP && h < baseY + RISE && legPathClear(leg, probe.x, h, probe.z)) {
          leg.dangling = false;
          return out.set(probe.x, h + FOOT_LIFT, probe.z);
        }
      }
    }
    leg.dangling = true;
    // nowhere to stand within reach: keep the nominal spot, clamped to reach
    rootToWorld(sx, 0, sz, out);
    const h = footSurf(out.x, out.z);
    out.y = (h === h ? THREE.MathUtils.clamp(h, baseY - DROP, baseY + RISE) : baseY) + FOOT_LIFT;
    return out;
  }
  function footOk(p) {
    const h = footSurf(p.x, p.z);
    return h === h && h > root.position.y - DROP && h < root.position.y + RISE ? h : null;
  }
  function plantAll() {
    for (const leg of LEGS) { placeFoot(leg, false, leg.foot); leg.swing = -1; leg.footNow.copy(leg.foot); }
  }

  const qA = new Q(), qB = new Q(), qC = new Q();
  function aimLocal(part, parentWorldQ, dir) {
    qA.setFromUnitVectors(DOWN, dir);                       // world orientation
    qB.copy(parentWorldQ).invert();
    part.quaternion.copy(qB.multiply(qA));
    return qA.clone();
  }

  const knee0 = new V(), ankle = new V(), ankle2 = new V(), knee = new V(), AB = new V();
  const horiz = new V(), tarsusDir = new V(), outward = new V(), axis = new V(), kneeDir = new V(), tipDir = new V();
  function solveLeg(leg) {
    const [Lc, Lf, Lt] = leg.lens;
    const Ltar = leg.tipLen;
    // hip in root frame
    const hip = tmpA.copy(leg.hip).applyQuaternion(body.quaternion).add(body.position);
    // foot in root frame
    const footR = root.worldToLocal(tmpB.copy(leg.footNow));
    const toFoot = tmpC.copy(footR).sub(hip);
    const dist = Math.max(0.01, toFoot.length());
    toFoot.divideScalar(dist);
    // coxa points down, biased toward the foot
    const coxaDir = tmpD.copy(toFoot).multiplyScalar(0.45).addScaledVector(DOWN, 0.8).normalize();
    knee0.copy(hip).addScaledVector(coxaDir, Lc);
    // ankle: pull back from the foot along a flat-ish tarsus
    horiz.set(toFoot.x, 0, toFoot.z);
    if (horiz.lengthSq() < 1e-6) horiz.set(leg.side, 0, 0);
    horiz.normalize();
    tarsusDir.copy(horiz).multiplyScalar(0.86).addScaledVector(DOWN, 0.5).normalize();
    ankle.copy(footR).addScaledVector(tarsusDir, -Ltar * 0.92);
    if (ankle.y < footR.y + 0.05) ankle.y = footR.y + 0.05;
    // two-bone femur+tibia from knee0 to ankle
    AB.copy(ankle).sub(knee0);
    let d = AB.length();
    const minD = Math.abs(Lf - Lt) * 1.05 + 0.005, maxD = (Lf + Lt) * 0.985;
    d = Math.min(maxD, Math.max(minD, d));
    const along = AB.normalize();
    const proj = (Lf * Lf - Lt * Lt + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0.0001, Lf * Lf - proj * proj));
    outward.set(leg.side, 0.15, leg.key[1] === 'f' ? 0.35 : 0).normalize();
    axis.crossVectors(along, outward);
    if (axis.lengthSq() < 1e-5) axis.set(0, 0, leg.side);
    axis.normalize();
    kneeDir.crossVectors(axis, along).normalize();
    if (kneeDir.y < 0) kneeDir.negate();
    knee.copy(knee0).addScaledVector(along, proj).addScaledVector(kneeDir, h);
    ankle2.copy(knee0).addScaledVector(along, d);
    // tarsus: aim at the foot; if the ankle ended up closer than the tarsus is
    // long, flatten the tarsus so its tip rests on the surface, not under it
    tipDir.copy(footR).sub(ankle2);
    const tipDist = tipDir.length();
    tipDir.divideScalar(Math.max(1e-6, tipDist));
    if (tipDist < Ltar) {
      const wantY = THREE.MathUtils.clamp((footR.y - ankle2.y) / Ltar, -1, 1);
      const hl = Math.hypot(tipDir.x, tipDir.z);
      const hs = Math.sqrt(Math.max(0, 1 - wantY * wantY));
      if (hl > 1e-4) tipDir.set(tipDir.x / hl * hs, wantY, tipDir.z / hl * hs);
      else tipDir.set(horiz.x * hs, wantY, horiz.z * hs);
    }
    // orient the chain
    const bodyQ = body.quaternion;
    let pq = aimLocal(leg.parts[0], bodyQ, coxaDir);
    pq = aimLocal(leg.parts[1], pq, tmpC.copy(knee).sub(knee0).normalize());
    pq = aimLocal(leg.parts[2], pq, tmpC.copy(ankle2).sub(knee).normalize());
    aimLocal(leg.parts[3], pq, tipDir);
  }

  // Ventral sample points (lower halves of body, head, eyes, proboscis). Each
  // frame the body is lifted just enough that none of them dips below the
  // surface — napping on the pillow, eating at food, stepping over pebbles.
  const clearancePts = [];
  for (const name of ['thorax', 'abdomen', 'head', 'eye_l', 'eye_r', 'proboscis']) {
    const g = parts[name].children[0].geometry, pos = g.attributes.position;
    const box = new THREE.Box3().setFromBufferAttribute(pos);
    const midY = (box.min.y + box.max.y) / 2;
    const cand = [];
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < midY) cand.push(i);
    const want = name === 'abdomen' || name === 'thorax' ? 36 : 14;
    const step = Math.max(1, Math.floor(cand.length / want));
    for (let k = 0; k < cand.length; k += step) {
      const i = cand[k];
      clearancePts.push({ part: parts[name].children[0], p: new V(pos.getX(i), pos.getY(i), pos.getZ(i)) });
    }
  }
  const cw = new V();
  function bodyPenetration() {
    root.updateMatrixWorld(true);
    let worst = -Infinity;
    for (const c of clearancePts) {
      cw.copy(c.p).applyMatrix4(c.part.matrixWorld);
      const h = surf(cw.x, cw.z, root.position.y + 3);
      if (h !== h) continue;                       // over water: sipping is allowed
      const pen = h + 0.012 - cw.y;
      if (pen > worst) worst = pen;
    }
    return worst;
  }

  // ---------- particles (hearts, zzz) ----------
  function spriteTexture(draw) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const heartTex = spriteTexture(g => {
    g.translate(32, 30); g.scale(1.15, 1.15);
    g.fillStyle = '#e2705f';
    g.beginPath();
    g.moveTo(0, 18);
    g.bezierCurveTo(-22, 2, -16, -16, -1, -7);
    g.bezierCurveTo(0, -8, 1, -8, 1, -7);
    g.bezierCurveTo(16, -16, 22, 2, 0, 18);
    g.fill();
    g.fillStyle = 'rgba(255,235,225,0.75)';
    g.beginPath(); g.ellipse(-7, -6, 4, 3, -0.6, 0, 6.3); g.fill();
  });
  const zTex = spriteTexture(g => {
    g.font = '700 44px "Space Mono", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#8f9cc0';
    g.fillText('z', 32, 34);
  });
  const sparkles = [];
  function spawnSprite(tex, wp, opts) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 1, depthWrite: false }));
    s.position.copy(wp);
    s.scale.setScalar(opts.size || 0.5);
    scene.add(s);
    sparkles.push(Object.assign({ mesh: s, age: 0, life: 1.6, rise: 1.1, sway: 0.3, phase: Math.random() * 6 }, opts));
  }

  // ---------- the fly object ----------
  const velRoot = new V();                   // root-frame velocity (for gait lead)
  const worldVel = new V();
  const fly = {
    root, body, parts,
    state: 'idle',
    stateT: 0,
    stateDur: 2,
    mood: 'settling in',
    needs: { hunger: 0.35, thirst: 0.25, energy: 0.85 },
    stress: 0, trust: 0.25,
    perchY: null,                            // non-null when perched off the moss (rim, twig, lip, pillow)
    onPillow: false,
    petting: false, pettingGlow: 0,
    events: [],
    activity: { optic: 0.2, antennal: 0.1, mushroom: 0.1, cx: 0.1, sez: 0.05, ammc: 0.05, motor: 0.1 },
    dominant: 'idle',
  };

  root.position.y = groundY(root.position.x, root.position.z);
  plantAll();

  let target = new V(), targetFood = null, gaitPhase = 0, lastTripod = 1;
  let flyVel = new V(), flyWaypoint = new V(), heartTimer = 0, zTimer = 0, sipTimer = 0;
  let wake = { proboscis: 0, groomT: 0, headPitch: 0, antennaBack: 0, wingSpread: 0, flap: 0 };
  let landSpot = null, walkSpeed = 1.15, curiousCooldown = 8;
  let hop = null;
  const pose = { pitch: 0, roll: 0, lift: 0, clear: 0 };

  function setState(s) {
    if (fly.state === 'nap' && s !== 'nap') fly.events.push('wake');
    nav.dest.set(1e9, 0, 0); nav.path = null; nav.detour = null; nav.list = null;
    if (s !== 'eat' && s !== 'seekFood') approach = null;
    fly.state = s; fly.stateT = 0;
    // roll durations once per state (re-rolling every frame biased them short)
    fly.stateDur = s === 'idle' ? 1.2 + Math.random() * 2 : s === 'groom' ? 3.2 + Math.random() * 2.5 : 0;
    if (s === 'nap') { zTimer = 1.2; }
    if (s === 'fly') {
      flyVel.set((Math.random() - 0.5) * 2, 3.5, (Math.random() - 0.5) * 2);
      pickWaypoint();
      fly.events.push('takeoff');
      fly.perchY = null; fly.onPillow = false;
    }
    if (s === 'land') pickLanding();
  }
  fly.setState = setState;

  // short hop with a flutter: onto the dish lip, onto / off the pillow
  function startHop(to, yaw, then, perch) {
    hop = { from: root.position.clone(), to: to.clone(), yaw0: root.rotation.y, yaw, t: 0,
      dur: 0.55 + Math.min(0.4, root.position.distanceTo(to) * 0.12), then, perch };
    setState('hop');
  }

  // flower stems are the only props not covered by the surface query, so
  // they are the columns a flying or carried fly must steer around
  function columnsAt(y, extra) {
    return world.obstacles.filter(o => o.kind === 'flower' && y < o.top + extra);
  }
  function pickWaypoint() {
    for (let guard = 0; guard < 30; guard++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5.5;
      flyWaypoint.set(Math.cos(a) * r, 2.5 + Math.random() * 5.5, Math.sin(a) * r);
      const bad = columnsAt(flyWaypoint.y, 0.8).some(o =>
        Math.hypot(flyWaypoint.x - o.x, flyWaypoint.z - o.z) < (o.head || o.r) + 0.9);
      if (!bad) return;
    }
  }
  function pickLanding() {
    const roll = Math.random();
    if (roll < 0.16) {
      const a = Math.random() * Math.PI * 2;
      landSpot = { pos: new V(Math.cos(a) * world.rim.r, world.rim.y + world.rim.tube, Math.sin(a) * world.rim.r),
        perch: true, yaw: Math.atan2(-Math.sin(a), Math.cos(a)) + (Math.random() < 0.5 ? Math.PI : 0) };
    } else if (roll < 0.30 && world.twigPerch) {
      landSpot = { pos: world.twigPerch.clone(), perch: true,
        yaw: world.twigPerchYaw + (Math.random() < 0.5 ? Math.PI : 0) };
    } else {
      const spot = randomSpot(1.5);                // room for his whole body, abdomen included
      landSpot = { pos: new V(spot.x, groundY(spot.x, spot.z), spot.z), perch: false, yaw: null };
    }
  }

  fly.startle = function (hard) {
    if (fly.state === 'carried') fly.events.push('escape');
    if (fly.state !== 'fly' && fly.state !== 'land') {
      fly.trust = Math.max(0, fly.trust - (hard ? 0.08 : 0.04));
      fly.stress = 1.2;
      hop = null;
      setState('fly');
    }
  };
  fly.canCarry = () => fly.trust > 0.45 &&
    ['idle', 'wander', 'groom', 'pet', 'eat', 'drink'].includes(fly.state);
  fly.beginCarry = function () { hop = null; fly.perchY = null; fly.onPillow = false; setState('carried'); fly.events.push('carry'); };
  fly.endCarry = function (pos) {
    root.position.copy(pos);
    fly.perchY = null; fly.onPillow = false;
    const overPillow = world.pillowSurfaceHeight(root.position.x, root.position.z) !== null &&
      Math.hypot(root.position.x - world.pillow.x, (root.position.z - world.pillow.z) / 0.82) < world.pillow.r * 0.75;
    if (overPillow) {
      root.position.y = groundY(root.position.x, root.position.z);
      fly.onPillow = true; fly.perchY = root.position.y;
      plantAll();
      fly.needs.energy < 0.75 ? setState('nap') : setState('idle');
    } else {
      // never set him down in the water, inside a prop, or through the glass
      const r = Math.hypot(root.position.x, root.position.z);
      if (r > 9.0) { root.position.x *= 9.0 / r; root.position.z *= 9.0 / r; }
      settleBody(world.obstacleList());
      root.position.y = groundY(root.position.x, root.position.z);
      plantAll();
      setState('idle');
    }
    if (fly.trust > 0.8) spawnHearts(1);
  };
  fly.plantAll = plantAll;
  fly.legs = LEGS;
  fly.headWorld = function (out) {
    return parts.head.getWorldPosition(out || new V());
  };

  function spawnHearts(n) {
    const hp = fly.headWorld(tmpD).add(new V(0, 0.55, 0));
    for (let i = 0; i < n; i++) {
      spawnSprite(heartTex, hp.clone().add(new V((Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3)),
        { size: 0.42 + Math.random() * 0.22, life: 1.7, rise: 1.15 });
    }
    fly.events.push('heart');
  }
  fly.spawnHearts = spawnHearts;

  // Mel's footprint as three circles along his body (head, thorax, abdomen).
  const BODY_CIRCLES = [[0.25, 0.36], [-0.4, 0.4], [-0.95, 0.36]];
  const push = new V();
  function settleBody(list) {
    const c = Math.cos(root.rotation.y), s = Math.sin(root.rotation.y);
    for (let pass = 0; pass < 2; pass++) {
      for (const [off, rad] of BODY_CIRCLES) {
        push.set(root.position.x + s * off, 0, root.position.z + c * off);
        const bx = push.x, bz = push.z;
        if (world.pushOut(push, rad, null, list)) {
          root.position.x += push.x - bx; root.position.z += push.z - bz;
        }
        // keep the abdomen off the glass too
        const r = Math.hypot(push.x, push.z);
        if (r > 9.55) { root.position.x -= push.x * (1 - 9.55 / r); root.position.z -= push.z * (1 - 9.55 / r); }
      }
    }
  }

  // ---------- path planning ----------
  // Local steering alone gets pinned in gaps narrower than his body (e.g.
  // between the big pebble and the carrot), so walks follow a coarse A* path
  // over an occupancy grid of obstacles inflated by his half-width.
  const NAV_CELL = 0.3, NAV_O = -9.6, NAV_N = 64, NAV_INF = 0.4;
  const navGrid = new Uint8Array(NAV_N * NAV_N);
  const navG = new Float32Array(NAV_N * NAV_N), navFrom = new Int32Array(NAV_N * NAV_N);
  const cellX = i => NAV_O + (i % NAV_N + 0.5) * NAV_CELL, cellZ = i => NAV_O + ((i / NAV_N | 0) + 0.5) * NAV_CELL;
  const cellOf = (x, z) => {
    const ix = Math.floor((x - NAV_O) / NAV_CELL), iz = Math.floor((z - NAV_O) / NAV_CELL);
    return ix < 0 || iz < 0 || ix >= NAV_N || iz >= NAV_N ? -1 : ix + iz * NAV_N;
  };
  function buildNavGrid(list) {
    for (let i = 0; i < navGrid.length; i++) {
      const x = cellX(i), z = cellZ(i);
      navGrid[i] = Math.hypot(x, z) > 9.25 || world.inWater(x, z) ? 1 : 0;
    }
    for (const o of list) {
      const R = o.r + NAV_INF;
      const x0 = Math.floor((o.x - R - NAV_O) / NAV_CELL), x1 = Math.floor((o.x + R - NAV_O) / NAV_CELL);
      const z0 = Math.floor((o.z - R - NAV_O) / NAV_CELL), z1 = Math.floor((o.z + R - NAV_O) / NAV_CELL);
      for (let iz = Math.max(0, z0); iz <= Math.min(NAV_N - 1, z1); iz++) {
        for (let ix = Math.max(0, x0); ix <= Math.min(NAV_N - 1, x1); ix++) {
          const i = ix + iz * NAV_N;
          if (Math.hypot(cellX(i) - o.x, cellZ(i) - o.z) < R) navGrid[i] = 1;
        }
      }
    }
  }
  function nearestFree(i) {
    if (i >= 0 && !navGrid[i]) return i;
    const ix0 = i < 0 ? NAV_N / 2 : i % NAV_N, iz0 = i < 0 ? NAV_N / 2 : (i / NAV_N | 0);
    for (let r = 1; r < 12; r++) {
      let best = -1, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ix = ix0 + dx, iz = iz0 + dz;
        if (ix < 0 || iz < 0 || ix >= NAV_N || iz >= NAV_N) continue;
        const j = ix + iz * NAV_N;
        if (!navGrid[j] && dx * dx + dz * dz < bd) { bd = dx * dx + dz * dz; best = j; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  function lineFree(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.1);
    for (let k = 1; k < n; k++) {
      const c = cellOf(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
      if (c < 0 || navGrid[c]) return false;
    }
    return true;
  }
  function planPath(from, to, list) {
    buildNavGrid(list);
    const s0 = nearestFree(cellOf(from.x, from.z)), g0 = nearestFree(cellOf(to.x, to.z));
    if (s0 < 0 || g0 < 0) return null;
    navG.fill(Infinity); navFrom.fill(-1);
    const heap = [[0, s0]];
    navG[s0] = 0;
    const gx = g0 % NAV_N, gz = g0 / NAV_N | 0;
    const hfn = i => { const dx = Math.abs(i % NAV_N - gx), dz = Math.abs((i / NAV_N | 0) - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const push = (f, i) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    let found = false, guard = 0, bestCell = s0, bestH = hfn(s0);
    while (heap.length && guard++ < 8000) {
      const [, i] = pop();
      if (i === g0) { found = true; break; }
      const hi = hfn(i);
      if (hi < bestH) { bestH = hi; bestCell = i; }
      const ix = i % NAV_N, iz = i / NAV_N | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = ix + dx, nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= NAV_N || nz >= NAV_N) continue;
        const j = nx + nz * NAV_N;
        if (navGrid[j]) continue;
        if (dx && dz && (navGrid[ix + dx + iz * NAV_N] || navGrid[ix + (iz + dz) * NAV_N])) continue;  // no corner cutting
        const g = navG[i] + (dx && dz ? 1.414 : 1);
        if (g < navG[j]) { navG[j] = g; navFrom[j] = i; push(g + hfn(j), j); }
      }
    }
    // unreachable goal: get as close as the moss allows
    const end = found ? g0 : bestCell;
    if (!found && end === s0) return { pts: null, found: false };
    const cells = [];
    for (let i = end; i >= 0; i = navFrom[i]) cells.push(i);
    cells.reverse();
    // string-pull: keep only the corners needed for line of sight
    const pts = [new V(from.x, 0, from.z)];
    for (const c of cells) pts.push(new V(cellX(c), 0, cellZ(c)));
    if (found) pts.push(new V(to.x, 0, to.z));
    const out = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !lineFree(pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
      out.push(pts[b]);
      a = b;
    }
    return { pts: out, found };
  }

  const steer = new V(), fwd = new V();
  const nav = { dest: new V(1e9, 0, 0), best: Infinity, t: 0, path: null, idx: 0, detour: null, detourT: 0 };
  function walkToward(dt, dest, speed, skip) {
    tmpA.copy(dest).sub(root.position); tmpA.y = 0;
    const realDist = tmpA.length();
    if (realDist < 0.18) { nav.path = null; nav.detour = null; return true; }
    // Food slices normally get walked around; if they wall off the goal he
    // climbs over them instead (they are real surfaces his feet can use).
    const replan = () => {
      nav.list = world.obstacleList(skip);
      let plan = planPath(root.position, dest, nav.list);
      if (!plan.found) {
        const over = world.obstacleList(Object.assign({}, skip, { food: true }));
        const plan2 = planPath(root.position, dest, over);
        if (plan2.found) { plan = plan2; nav.list = over; }
      }
      nav.path = plan.pts; nav.idx = 0;
      nav.best = Infinity; nav.t = 0;
    };
    if (Math.hypot(nav.dest.x - dest.x, nav.dest.z - dest.z) > 0.5 || !nav.list) {
      nav.dest.copy(dest); nav.detour = null; replan();
    }
    const list = nav.list;
    if (realDist < nav.best - 0.08) { nav.best = realDist; nav.t = 0; } else nav.t += dt;
    if (nav.t > 1.6 && !nav.detour) {
      // still not getting closer: replan, and if even that fails, wander off a bit
      replan();
      if (!nav.path) {
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 1.5;
        nav.detour = clearNear(new V(root.position.x + Math.cos(a) * r, 0, root.position.z + Math.sin(a) * r));
        nav.detourT = 2.5;
      }
    }
    let goal = dest;
    if (nav.detour) {
      nav.detourT -= dt;
      if (nav.detourT <= 0 || Math.hypot(nav.detour.x - root.position.x, nav.detour.z - root.position.z) < 0.3) { nav.detour = null; replan(); }
      else goal = nav.detour;
    } else if (nav.path && nav.idx < nav.path.length) {
      while (nav.idx < nav.path.length - 1 &&
             Math.hypot(nav.path[nav.idx].x - root.position.x, nav.path[nav.idx].z - root.position.z) < 0.35) nav.idx++;
      goal = nav.path[nav.idx];
    }
    tmpA.copy(goal).sub(root.position).setY(0);
    const dist = Math.max(1e-4, Math.min(tmpA.length(), realDist));
    tmpA.normalize();
    // steer around obstacles ahead: lean away and slide along their tangent
    steer.set(0, 0, 0);
    for (const o of list) {
      const dx = root.position.x - o.x, dz = root.position.z - o.z;
      const d = Math.hypot(dx, dz), gap = d - o.r;
      const range = 1.5;
      if (gap > range || d < 1e-4) continue;
      const ax = dx / d, az = dz / d;
      if (tmpA.x * -ax + tmpA.z * -az < -0.25) continue;       // behind us
      const w = (range - Math.max(0, gap)) / range;
      let tx = -az, tz = ax;
      if (tx * tmpA.x + tz * tmpA.z < 0) { tx = -tx; tz = -tz; }
      const k = nav.path ? 0.8 : 2.2;                           // the plan already routes around
      steer.x += (ax * 0.7 + tx) * w * w * k;
      steer.z += (az * 0.7 + tz) * w * w * k;
    }
    tmpA.add(steer).setY(0).normalize();
    const desiredYaw = Math.atan2(tmpA.x, tmpA.z);
    let dy = desiredYaw - root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    root.rotation.y += THREE.MathUtils.clamp(dy, -3.4 * dt, 3.4 * dt);
    const go = Math.min(speed * dt, dist) * Math.max(0.15, 1 - Math.abs(dy) * 0.5);
    // walk where he is facing (no sideways skating)
    fwd.set(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
    const px = root.position.x, pz = root.position.z;
    root.position.addScaledVector(fwd, go);
    settleBody(list);
    const r = Math.hypot(root.position.x, root.position.z);
    if (r > 9.3) { root.position.x *= 9.3 / r; root.position.z *= 9.3 / r; }
    const h = surf(root.position.x, root.position.z, root.position.y + 3);
    if (h !== h) { root.position.x = px; root.position.z = pz; }  // never step onto water
    worldVel.set(root.position.x - px, 0, root.position.z - pz).divideScalar(Math.max(dt, 1e-4));
    return false;
  }

  function randomSpot(margin) {
    for (let guard = 0; guard < 60; guard++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 8.4;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (world.isClear(x, z, margin || 0.9)) return new V(x, 0, z);
    }
    return new V(-1.5, 0, -0.8);
  }

  // nearest clear spot to p (spiralling outward), written back into p
  function clearNear(p) {
    const x0 = p.x, z0 = p.z;
    for (let i = 0; i < 48; i++) {
      const a = i * 2.4, r = 0.18 * i;
      const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
      if (world.isClear(x, z, 0.8)) { p.x = x; p.z = z; return p; }
    }
    return p;
  }

  function nearestFood() {
    let best = null, bd = 1e9;
    for (const f of world.foods) {
      if (f.inWater) continue;                    // floating food can't be reached
      const d = f.mesh.position.distanceTo(root.position);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  // nearest point on the food's rim (and outward normal) as seen from `from`
  const edge = { x: 0, z: 0, nx: 0, nz: 0 };
  function foodEdge(food, from) {
    const m = food.mesh, px = m.position.x, pz = m.position.z;
    let dx = from.x - px, dz = from.z - pz;
    if (food.shape === 'box') {
      const c = Math.cos(food.yaw), s = Math.sin(food.yaw);
      let lx = dx * c - dz * s, lz = dx * s + dz * c;          // into box frame
      const cx = THREE.MathUtils.clamp(lx, -food.hx, food.hx), cz = THREE.MathUtils.clamp(lz, -food.hz, food.hz);
      let nx = lx - cx, nz = lz - cz;
      const nl = Math.hypot(nx, nz);
      if (nl < 1e-4) { nx = 0; nz = Math.sign(lz) || 1; } else { nx /= nl; nz /= nl; }
      edge.x = px + cx * c + cz * s; edge.z = pz - cx * s + cz * c;
      edge.nx = nx * c + nz * s; edge.nz = -nx * s + nz * c;
    } else {
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      edge.x = px + dx * food.radius * 0.97; edge.z = pz + dz * food.radius * 0.97;
      edge.nx = dx; edge.nz = dz;
    }
    return edge;
  }

  // Pick a reachable, uncluttered approach point around a round target
  // (dish, pillow) instead of the straight radial one, which can sit in a
  // pocket between pebbles and food that he can never get into.
  function pickApproach(cx, cz, radius, skip) {
    let best = null, bd = Infinity;
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
      if (!world.isClear(x, z, 0.5, skip)) continue;
      const d = Math.hypot(x - root.position.x, z - root.position.z);
      if (d < bd) { bd = d; best = new V(x, 0, z); }
    }
    if (!best) {
      tmpA.set(root.position.x - cx, 0, root.position.z - cz).normalize();
      best = new V(cx + tmpA.x * radius, 0, cz + tmpA.z * radius);
    }
    return best;
  }
  // the same for food: a clear spot just off its rim, plus the facing normal
  let approach = null, approachFoodPos = new V();
  function pickFoodApproach(food) {
    let best = null, bd = Infinity;
    const m = food.mesh.position;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const e = foodEdge(food, tmpC.set(m.x + Math.cos(a) * 4, 0, m.z + Math.sin(a) * 4));
      const x = e.x + e.nx * 0.2, z = e.z + e.nz * 0.2;
      if (!world.isClear(x, z, 0.3, { food })) continue;
      const d = Math.hypot(x - root.position.x, z - root.position.z);
      if (d < bd) { bd = d; best = { pos: new V(x, 0, z), nx: e.nx, nz: e.nz }; }
    }
    approachFoodPos.copy(m);
    return best;
  }

  const hopTo = new V();
  // ---------- main update ----------
  fly.update = function (dt, t, io) {
    dt = Math.min(dt, 0.05);
    fly.stateT += dt;
    const S = fly.state;
    const grounded = !['fly', 'land', 'carried', 'hop'].includes(S);

    // needs drift
    if (S !== 'nap') {
      fly.needs.hunger = Math.min(1, fly.needs.hunger + dt / (FP.fast ? 30 : 260));
      fly.needs.thirst = Math.min(1, fly.needs.thirst + dt / (FP.fast ? 40 : 330));
      fly.needs.energy = Math.max(0, fly.needs.energy - dt / (FP.fast ? 50 : 430));
    }
    fly.stress = Math.max(0, fly.stress - dt * 0.35);
    curiousCooldown = Math.max(0, curiousCooldown - dt);

    // cursor threat assessment (io.cursorSpeed in world units/s, io.cursorDist to fly)
    if (io && grounded) {
      const near = Math.max(0, 1 - io.cursorDist / 5.5);
      const neuralEscape = io.neural ? io.neural.escape : 0;
      const rough = Math.max(0, io.cursorSpeed - 3.2) * (1 - fly.trust * 0.35) * (1 + neuralEscape * 0.28);
      fly.stress += rough * near * near * dt * 0.55;
      if (io.cursorSpeed > 14 && io.cursorDist < 3.2) fly.stress = 1.2;
      if (fly.stress > 1 && S !== 'nap') fly.startle(true);
      if (S === 'nap' && fly.stress > 0.6) { fly.perchY = null; fly.onPillow = false; fly.startle(true); }
    }

    // petting
    fly.petting = !!(io && io.petting && grounded && S !== 'nap');
    if (fly.petting && S !== 'pet' && ['idle', 'wander', 'groom'].includes(S)) setState('pet');
    fly.pettingGlow = THREE.MathUtils.lerp(fly.pettingGlow, fly.petting ? 1 : 0, dt * 3);

    // ---- state machine ----
    walkSpeed = 1.15;
    let wantProboscis = 0, wantGroom = false, wantHeadPitch = 0, antennaRelax = 0;
    let moving = false, bodyLow = 0;

    switch (fly.state) {
      case 'idle': {
        if (FP.freeze) break;
        if (fly.stateT > fly.stateDur) {
          if (fly.onPillow) { fly.onPillow = false; setState('fly'); break; }
          if (fly.perchY !== null) { setState('fly'); break; }  // leave rim/twig perch
          if (fly.needs.energy < 0.22) setState('seekRest');
          else if (fly.needs.hunger > 0.62 - ((io && io.neural) ? io.neural.feed * 0.06 : 0) && (targetFood = nearestFood())) setState('seekFood');
          else if (fly.needs.thirst > 0.68) setState('seekWater');
          else if (io && fly.trust > 0.55 && curiousCooldown <= 0 && io.cursorOnGround &&
                   io.cursorSpeed < 1.2 && io.cursorDist > 2.2 && io.cursorDist < 7 && Math.random() < 0.5) {
            target.copy(io.cursorWorld); setState('curious');
          }
          else {
            const r = Math.random();
            const groomBias = io && io.neural ? io.neural.groom * 0.12 : 0;
            if (r < 0.42 - groomBias * 0.25) { target.copy(randomSpot()); setState('wander'); }
            else if (r < 0.68 + groomBias) setState('groom');
            else { fly.stateT = 0; fly.stateDur = 1.2 + Math.random() * 2; }
          }
        }
        break;
      }
      case 'wander': {
        moving = !walkToward(dt, target, walkSpeed);
        if (!moving || fly.stateT > 9) setState('idle');
        break;
      }
      case 'curious': {
        if (io) target.copy(io.cursorWorld);
        const arrived = walkToward(dt, target, 0.9);
        antennaRelax = 0.3;
        if (arrived || fly.stateT > 7 || (io && (io.cursorSpeed > 4 || !io.cursorOnGround))) {
          curiousCooldown = 14; setState('idle');
        }
        moving = !arrived;
        break;
      }
      case 'groom': {
        wantGroom = true; wantHeadPitch = 0.16;
        if (fly.stateT > fly.stateDur) setState('idle');
        break;
      }
      case 'seekFood': {
        if (!targetFood || targetFood.inWater) { setState('idle'); break; }
        // stop with his head over the rim of the food, forelegs on it
        if (!approach || approachFoodPos.distanceTo(targetFood.mesh.position) > 0.3) approach = pickFoodApproach(targetFood);
        if (!approach) { setState('idle'); break; }
        moving = !walkToward(dt, approach.pos, 1.5, { food: targetFood });
        if (!moving) setState('eat');
        if (fly.stateT > 14) { approach = null; setState('idle'); }
        break;
      }
      case 'eat': {
        if (!targetFood || targetFood.inWater) { setState('idle'); break; }
        // face the food
        const e = foodEdge(targetFood, root.position);
        const yaw = Math.atan2(-e.nx, -e.nz);
        let dy = yaw - root.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        root.rotation.y += dy * Math.min(1, dt * 4);
        wantProboscis = 0.65 + Math.sin(t * 5.2) * 0.3;
        wantHeadPitch = 0.34;
        bodyLow = 0.03;
        fly.needs.hunger = Math.max(0, fly.needs.hunger - dt / 7);
        if (Math.hypot(e.x - root.position.x, e.z - root.position.z) > 1.1) { approach = null; setState('seekFood'); }
        else if (fly.needs.hunger < 0.12 || fly.stateT > 11) {
          if (fly.trust > 0.5) spawnHearts(1);
          setState('idle');
        }
        break;
      }
      case 'seekWater': {
        if (!approach || !approach.isVector3) approach = pickApproach(world.dish.x, world.dish.z, world.dish.r + 0.75, { dish: true });
        moving = !walkToward(dt, approach, 1.4, { dish: true });
        tmpD.set(root.position.x - world.dish.x, 0, root.position.z - world.dish.z);
        if (tmpD.lengthSq() < 1e-4) tmpD.set(1, 0, 0);
        tmpD.normalize();
        if (!moving) {
          // hop up onto the lip, facing the water
          hopTo.set(world.dish.x, 0, world.dish.z).addScaledVector(tmpD, world.dish.perchR);
          hopTo.y = groundY(hopTo.x, hopTo.z);
          startHop(hopTo, Math.atan2(-tmpD.x, -tmpD.z), 'drink', true);
        } else if (fly.stateT > 12) setState('idle');
        break;
      }
      case 'drink': {
        wantProboscis = 0.8 + Math.sin(t * 3.2) * 0.2;
        wantHeadPitch = 0.5;
        bodyLow = 0.06;
        fly.needs.thirst = Math.max(0, fly.needs.thirst - dt / 6);
        sipTimer -= dt;
        if (sipTimer <= 0) {
          sipTimer = 1.3 + Math.random();
          parts.proboscis.getWorldPosition(tmpA);
          world.spawnRipple(tmpA.x, tmpA.z);
          fly.events.push('sip');
        }
        if (fly.needs.thirst < 0.1 || fly.stateT > 10) {
          // hop back down onto the moss, away from the dish
          tmpA.set(root.position.x - world.dish.x, 0, root.position.z - world.dish.z).normalize();
          clearNear(hopTo.set(world.dish.x, 0, world.dish.z).addScaledVector(tmpA, world.dish.r + 1.1));
          hopTo.y = groundY(hopTo.x, hopTo.z);
          startHop(hopTo, Math.atan2(tmpA.x, tmpA.z), 'idle', false);
        }
        break;
      }
      case 'seekRest': {
        const P = world.pillow;
        if (!approach || !approach.isVector3) approach = pickApproach(P.x, P.z, P.r + 0.7, { pillow: true });
        moving = !walkToward(dt, approach, 1.1, { pillow: true });
        tmpD.set(root.position.x - P.x, 0, root.position.z - P.z);
        if (tmpD.lengthSq() < 1e-4) tmpD.set(1, 0, 0);
        tmpD.normalize();
        if (!moving) {
          // the pillow's side is a wall — hop up onto the top instead of teleporting
          hopTo.set(P.x, 0, P.z).addScaledVector(tmpD, 0.35);
          hopTo.y = groundY(hopTo.x, hopTo.z);
          startHop(hopTo, Math.atan2(-tmpD.x, -tmpD.z) + (Math.random() - 0.5), 'nap', true);
          fly.onPillow = true;
        } else if (fly.stateT > 14) setState('idle');
        break;
      }
      case 'hop': {
        if (!hop) { setState('idle'); break; }
        hop.t += dt / hop.dur;
        const k = Math.min(1, hop.t), e = k * k * (3 - 2 * k);
        root.position.lerpVectors(hop.from, hop.to, e);
        root.position.y += Math.sin(Math.PI * k) * (0.55 + Math.abs(hop.to.y - hop.from.y) * 0.3);
        let dy = hop.yaw - hop.yaw0;
        while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        root.rotation.y = hop.yaw0 + dy * e;
        if (k >= 1) {
          const h = hop;
          hop = null;
          root.position.copy(h.to);
          fly.perchY = h.perch ? root.position.y : null;
          if (!h.perch) fly.onPillow = false;
          plantAll();
          fly.events.push('land');
          setState(h.then);
        }
        break;
      }
      case 'nap': {
        antennaRelax = 1;
        bodyLow = 0.16;
        fly.needs.energy = Math.min(1, fly.needs.energy + dt / (FP.fast ? 6 : 26));
        zTimer -= dt;
        if (zTimer <= 0) {
          zTimer = 2.6 + Math.random() * 1.5;
          spawnSprite(zTex, fly.headWorld(tmpD).add(new V(0.15, 0.5, 0)),
            { size: 0.34, life: 2.6, rise: 0.55, sway: 0.5 });
        }
        if (fly.needs.energy > 0.92) {
          fly.onPillow = false; fly.perchY = null;
          setState('fly');
        }
        break;
      }
      case 'pet': {
        antennaRelax = 0.85;
        bodyLow = 0.05 + fly.pettingGlow * 0.02 * Math.sin(t * 3);
        fly.trust = Math.min(1, fly.trust + dt * 0.028);
        heartTimer -= dt;
        if (heartTimer <= 0 && fly.trust > 0.35) {
          heartTimer = 1.4 + Math.random() * 0.9;
          spawnHearts(1 + (fly.trust > 0.75 ? 1 : 0));
        }
        if (!fly.petting && fly.stateT > 1.2) setState('idle');
        if (fly.petting) fly.stateT = Math.min(fly.stateT, 1);
        break;
      }
      case 'carried': {
        antennaRelax = 0.4;
        if (io && io.carryTarget) {
          root.position.lerp(io.carryTarget, Math.min(1, dt * 7));
        }
        // never drag him through a flower stem or a mushroom cap on the way
        const cols = columnsAt(root.position.y, 0.9);
        if (cols.length) settleBody(cols);
        const floor = world.surfaceHeight(root.position.x, root.position.z) + 0.3;
        if (root.position.y < floor) root.position.y = floor;
        if (fly.trust > 0.8) {
          heartTimer -= dt;
          if (heartTimer <= 0) { heartTimer = 2.2; spawnHearts(1); }
        }
        break;
      }
      case 'fly': {
        // steer toward waypoint
        tmpA.copy(flyWaypoint).sub(root.position);
        if (tmpA.length() < 1) pickWaypoint();
        tmpA.normalize();
        flyVel.addScaledVector(tmpA, dt * 9);
        flyVel.x += (Math.sin(t * 3.1) + Math.sin(t * 5.7)) * dt * 1.5;
        flyVel.z += (Math.cos(t * 2.7) + Math.sin(t * 4.3)) * dt * 1.5;
        // soft walls: turn back toward the middle rather than teleporting in
        const r = Math.hypot(root.position.x, root.position.z);
        if (r > 8.2) { flyVel.x -= root.position.x / r * dt * 14; flyVel.z -= root.position.z / r * dt * 14; }
        if (root.position.y > 9.6) flyVel.y -= dt * 10;
        if (flyVel.length() > 5.2) flyVel.setLength(5.2);
        root.position.addScaledVector(flyVel, dt);
        airborneConstraints(0.9);
        root.rotation.y = lerpAngle(root.rotation.y, Math.atan2(flyVel.x, flyVel.z), Math.min(1, dt * 5));
        if (fly.stateT > 2.5 && fly.stress < 0.22) setState('land');
        break;
      }
      case 'land': {
        if (!landSpot) pickLanding();
        if (fly.stateT > 9) { fly.stateT = 0; pickLanding(); }   // blocked: choose again
        // approach a point above the spot, then settle straight down onto it —
        // a diagonal glide used to cut through flowers, food and the glass
        const hover = landSpot.perch ? 0.9 : 1.5;
        const hd = Math.hypot(landSpot.pos.x - root.position.x, landSpot.pos.z - root.position.z);
        tmpB.copy(landSpot.pos);
        if (hd > 0.3) tmpB.y = Math.max(tmpB.y + hover, root.position.y - hd * 0.4);
        tmpA.copy(tmpB).sub(root.position);
        const d = tmpA.length();
        if (hd < 0.3 && Math.abs(root.position.y - landSpot.pos.y) < 0.12) {
          root.position.copy(landSpot.pos);
          if (landSpot.yaw !== null) root.rotation.y = landSpot.yaw;
          fly.perchY = landSpot.perch ? landSpot.pos.y : null;
          if (!landSpot.perch) root.position.y = groundY(root.position.x, root.position.z);
          plantAll();
          fly.events.push('land');
          landSpot = null;
          setState('idle');
          break;
        }
        tmpA.normalize();
        flyVel.lerp(tmpA.multiplyScalar(Math.min(4, d * 2.4 + 0.6)), Math.min(1, dt * 3));
        root.position.addScaledVector(flyVel, dt);
        airborneConstraints(hd > 0.6 ? 0.7 : 0);
        if (hd < 1.2 && landSpot.yaw !== null) root.rotation.y = lerpAngle(root.rotation.y, landSpot.yaw, Math.min(1, dt * 5));
        else if (hd > 0.3) root.rotation.y = lerpAngle(root.rotation.y, Math.atan2(flyVel.x, flyVel.z), Math.min(1, dt * 4));
        break;
      }
    }

    const Sn = fly.state;
    const flying = Sn === 'fly' || Sn === 'land';
    const hopping = Sn === 'hop';
    const carried = Sn === 'carried';
    const napping = Sn === 'nap';
    const airborne = flying || carried || hopping;

    // settle onto whatever he's standing on (pillow squish, dragged food, ...)
    if (!airborne) {
      // ease onto the surface (a quick climb rather than a pop when he steps
      // up onto a food slice or the pillow squishes under him)
      const h = surf(root.position.x, root.position.z, root.position.y + 3);
      if (h === h) {
        root.position.y += (h - root.position.y) * Math.min(1, dt * 14);
        if (fly.perchY !== null) fly.perchY = root.position.y;
      }
    }

    // ---- gait ----
    velRoot.copy(worldVel).applyQuaternion(qC.copy(root.quaternion).invert()).divideScalar(SCALE);
    worldVel.set(0, 0, 0);
    if (!airborne) {
      if (moving) {
        gaitPhase += dt * (2.4 + walkSpeed * 1.6);
        const step = Math.floor(gaitPhase * 2) % 2;
        if (step !== lastTripod) {
          lastTripod = step;
          for (const leg of LEGS) {
            if (leg.tripod === step && leg.swing < 0) {
              leg.swing = 0;
              leg.from.copy(leg.foot);
              placeFoot(leg, true, leg.to);
            }
          }
        }
      }
      for (const leg of LEGS) {
        if (leg.swing >= 0) continue;
        // planted feet follow the surface under them (pillow squish, food
        // dragged away); if it is gone or out of reach, take a step
        const h = footOk(leg.foot);
        const stray = !moving && rootToWorld(leg.stance.x, 0, leg.stance.z, tmpA).setY(leg.foot.y).distanceTo(leg.foot) > 0.42 * SCALE;
        if ((h === null && !leg.dangling) || stray) {
          leg.swing = 0; leg.from.copy(leg.foot); placeFoot(leg, false, leg.to);
        } else if (h !== null) leg.foot.y = h + FOOT_LIFT;
      }
      for (const leg of LEGS) {
        leg.tuck = Math.max(0, leg.tuck - dt * 5);
        if (leg.swing >= 0) {
          leg.swing += dt / 0.14;
          if (leg.swing >= 1) { leg.swing = -1; leg.foot.copy(leg.to); }
          else {
            leg.foot.lerpVectors(leg.from, leg.to, leg.swing);
            // clear anything between the two footholds, then a modest lift
            const h = footSurf(leg.foot.x, leg.foot.z);
            if (h === h && h + FOOT_LIFT > leg.foot.y) leg.foot.y = h + FOOT_LIFT;
            leg.foot.y += Math.sin(leg.swing * Math.PI) * 0.09 * SCALE;
          }
        }
        leg.footNow.copy(leg.foot);
      }
    } else {
      // tuck legs beneath the body
      for (const leg of LEGS) {
        leg.tuck = Math.min(1, leg.tuck + dt * 4);
        leg.swing = -1;
        rootToWorld(leg.stance.x * 0.4 + leg.side * 0.1, 0.08, leg.stance.z * 0.4 + 0.05, leg.footNow);
        leg.foot.copy(leg.footNow);
      }
    }

    // ---- body pose ----
    // terrain-following: pitch/roll/height from where the feet actually are
    let tPitch = 0, tRoll = 0, tLift = 0;
    if (!airborne) {
      const fy = {};
      for (const leg of LEGS) fy[leg.key] = leg.swing >= 0 ? leg.to.y : leg.foot.y;
      const front = (fy.lf + fy.rf) / 2, hind = (fy.lh + fy.rh) / 2;
      const left = (fy.lf + fy.lm + fy.lh) / 3, right = (fy.rf + fy.rm + fy.rh) / 3;
      const mean = (left + right) / 2;
      tPitch = THREE.MathUtils.clamp(Math.atan2(hind - front, 1.76), -0.5, 0.5);
      tRoll = THREE.MathUtils.clamp(Math.atan2(left - right, 1.8), -0.45, 0.45);
      tLift = THREE.MathUtils.clamp((mean - FOOT_LIFT - root.position.y) / SCALE * 0.7, -0.12, 0.16);
    }
    const kPose = Math.min(1, dt * 7);
    pose.pitch += (tPitch - pose.pitch) * kPose;
    pose.roll += (tRoll - pose.roll) * kPose;
    pose.lift += (tLift - pose.lift) * kPose;

    let targetH = flying ? 0.4 : BODY_H - bodyLow;
    bodyH = THREE.MathUtils.lerp(bodyH, targetH, Math.min(1, dt * 6));
    const bob = moving ? Math.sin(gaitPhase * Math.PI * 2) * 0.012 : Math.sin(t * (napping ? 1.1 : 2.1)) * (napping ? 0.006 : 0.004);
    body.position.set(0, bodyH + bob + pose.lift + pose.clear, 0);
    let pitch = wantHeadPitch * 0.4 + (flying ? -0.35 : 0) + pose.pitch;
    let roll = pose.roll;
    if (flying) {
      const latAccel = flyVel.x * Math.cos(root.rotation.y) - flyVel.z * Math.sin(root.rotation.y);
      roll += THREE.MathUtils.clamp(-latAccel * 0.09, -0.5, 0.5);
    }
    qA.setFromEuler(new THREE.Euler(pitch, 0, roll));
    body.quaternion.slerp(qA, Math.min(1, dt * 5));

    // head, antennae, proboscis
    parts.head.quaternion.copy(parts.head.userData.rest)
      .multiply(qB.setFromAxisAngle(new V(1, 0, 0), wantHeadPitch + (wantGroom ? Math.sin(t * 6) * 0.05 : 0)));
    wake.proboscis = THREE.MathUtils.lerp(wake.proboscis, wantProboscis, Math.min(1, dt * 5));
    parts.proboscis.quaternion.copy(parts.proboscis.userData.rest)
      .multiply(qB.setFromAxisAngle(new V(1, 0, 0), wake.proboscis * 0.95));
    const twitch = (Math.sin(t * 7.3) > 0.96 ? 0.25 : 0) * (napping ? 0 : 1);
    wake.antennaBack = THREE.MathUtils.lerp(wake.antennaBack, antennaRelax, Math.min(1, dt * 4));
    for (const [nm, sgn] of [['antenna_l', 1], ['antenna_r', -1]]) {
      parts[nm].quaternion.copy(parts[nm].userData.rest)
        .multiply(qB.setFromAxisAngle(new V(1, 0, 0), -wake.antennaBack * 0.5 + twitch * (sgn > 0 ? 1 : 0.6)));
    }

    // wings & halteres
    const wingsOut = FP.wingsOverride != null ? FP.wingsOverride : (flying ? 1 : hopping ? 0.7 : 0);
    wake.wingSpread = THREE.MathUtils.lerp(wake.wingSpread, wingsOut, Math.min(1, dt * 8));
    wake.flap = FP.flapOverride != null ? FP.flapOverride :
      (flying || hopping ? wake.flap + dt * 26 * Math.PI * 2 : 0);
    for (const [nm, sgn] of [['wing_l', 1], ['wing_r', -1]]) {
      const p = parts[nm];
      p.quaternion.copy(p.userData.rest);
      if (wake.wingSpread > 0.01) {
        const spread = wake.wingSpread * 1.35;
        // shallower downstroke so the wings sweep clear of the tucked legs
        const sf = Math.sin(wake.flap);
        const flap = (sf > 0 ? sf * 0.85 : sf * 0.38) * wake.wingSpread;
        p.quaternion.multiply(qB.setFromAxisAngle(new V(0, 1, 0), -sgn * spread))
                    .multiply(qC.setFromAxisAngle(new V(0, 0, 1), sgn * flap));
      } else if (napping) {
        p.quaternion.multiply(qB.setFromAxisAngle(new V(1, 0, 0), 0.06));
      }
    }
    for (const [nm, sgn] of [['haltere_l', 1], ['haltere_r', -1]]) {
      parts[nm].quaternion.copy(parts[nm].userData.rest);
      if (flying || hopping) parts[nm].quaternion.multiply(qB.setFromAxisAngle(new V(0, 0, 1), sgn * Math.sin(wake.flap + Math.PI) * 0.5));
    }
    for (const b of blurs) {
      b.material.opacity = wake.wingSpread * (0.16 + Math.abs(Math.sin(wake.flap * 0.5)) * 0.12);
      b.scale.y = 0.5 + Math.abs(Math.sin(wake.flap * 0.25)) * 0.3;
      b.visible = b.material.opacity > 0.005;
    }

    // abdomen breathing: mostly dorsoventral, so the resting wings stay on top
    const breath = napping ? Math.sin(t * 1.4) * 0.03 : Math.sin(t * 2.3) * 0.012;
    parts.abdomen.scale.set(1 + breath * 0.5, 1 + breath, 1);

    // grooming: forelegs rub over the face (targets in the head's own frame)
    if (wantGroom) {
      wake.groomT += dt;
      root.updateMatrixWorld(true);
      for (const leg of LEGS) {
        if (leg.key[1] !== 'f') continue;
        const ph = wake.groomT * 9 + (leg.side > 0 ? 0 : Math.PI);
        tmpA.set(leg.side * (0.035 + Math.sin(ph) * 0.03), -0.05 + Math.abs(Math.sin(ph * 0.5)) * 0.07, 0.19 + Math.cos(ph) * 0.025);
        parts.head.localToWorld(leg.footNow.copy(tmpA));
      }
    } else wake.groomT = 0;

    // ventral clearance: lift the body until nothing pokes into the surface
    if (!airborne) {
      const pen = bodyPenetration();
      if (pen > 0) { pose.clear += pen / SCALE; body.position.y += pen / SCALE; }
      else pose.clear = Math.max(0, pose.clear - Math.min(-pen / SCALE, dt * 0.25));
    } else pose.clear = Math.max(0, pose.clear - dt * 0.5);

    // solve all legs
    for (const leg of LEGS) solveLeg(leg);

    // ---- particles ----
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const sp = sparkles[i];
      sp.age += dt;
      sp.mesh.position.y += sp.rise * dt;
      sp.mesh.position.x += Math.sin(sp.age * 3 + sp.phase) * sp.sway * dt;
      const k = sp.age / sp.life;
      sp.mesh.material.opacity = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85);
      if (sp.age > sp.life) { scene.remove(sp.mesh); sp.mesh.material.dispose(); sparkles.splice(i, 1); }
    }

    // ---- neural activity ----
    const a = fly.activity;
    const cursorMotion = io ? Math.min(1, io.cursorSpeed / 9) * Math.max(0, 1 - io.cursorDist / 8) : 0;
    const lerpA = (k, v) => { a[k] = THREE.MathUtils.lerp(a[k], Math.min(1, v), Math.min(1, dt * 4)); };
    const eating = Sn === 'eat', drinking = Sn === 'drink';
    const foodNear = targetFood && targetFood.mesh.position.distanceTo(root.position) < 4 ? 0.5 : 0;
    lerpA('optic', 0.22 + cursorMotion * 0.8 + (flying ? 0.5 : 0) + (Sn === 'curious' ? 0.3 : 0) - (napping ? 0.18 : 0));
    lerpA('antennal', 0.12 + fly.needs.hunger * 0.25 + foodNear + (eating ? 0.45 : 0) + (Sn === 'curious' ? 0.4 : 0));
    lerpA('mushroom', 0.12 + (eating ? 0.55 : 0) + fly.pettingGlow * 0.5 + (Sn === 'curious' ? 0.35 : 0));
    lerpA('cx', 0.15 + (moving ? 0.65 : 0) + (flying ? 0.8 : 0) - (napping ? 0.1 : 0));
    lerpA('sez', 0.06 + (eating || drinking ? 0.95 : 0) + (wantGroom ? 0.35 : 0));
    lerpA('ammc', 0.08 + fly.pettingGlow * 0.95 + (carried ? 0.5 : 0) + (flying ? 0.35 : 0));
    lerpA('motor', 0.1 + (moving ? 0.55 : 0) + (flying || hopping ? 0.95 : 0) + (wantGroom ? 0.6 : 0) - (napping ? 0.08 : 0));
    fly.dominant =
      Sn === 'nap' ? 'nap' :
      flying ? (fly.stress > 0.6 ? 'escape' : 'flight') :
      eating ? 'taste' : drinking ? 'drink' :
      fly.petting || Sn === 'pet' ? 'touch' :
      carried ? 'carried' :
      wantGroom ? 'groom' :
      Sn === 'curious' ? 'curious' :
      cursorMotion > 0.45 ? 'looming' :
      moving || hopping ? 'walk' : 'rest';

    // blob shadow follows him, draped over the surface, fading with altitude
    {
      const below = { maxY: root.position.y + 0.05 };
      const gy = world.surfaceHeight(root.position.x, root.position.z, below);
      const alt = Math.max(0, root.position.y - gy);
      blobShadow.position.set(root.position.x, gy, root.position.z);
      blobShadow.rotation.y = root.rotation.y;
      const k = Math.max(0.15, 1 - alt / 7);
      blobShadow.material.opacity = 0.85 * k;
      blobShadow.scale.setScalar(1 + alt * 0.12);
      world.drape(blobShadow, 0.02, below);
    }

    // pillow squish
    if (world.pillow.setSquish) {
      const target = fly.onPillow && !airborne ? 0.54 : 0.62;
      world.pillow.setSquish(THREE.MathUtils.lerp(world.pillow.mesh.scale.y, target, Math.min(1, dt * 4)));
    }

    // mood label
    fly.mood =
      Sn === 'nap' ? 'fast asleep' :
      Sn === 'pet' ? 'enjoying pets' :
      carried ? (fly.trust > 0.8 ? 'riding along happily' : 'holding on') :
      flying ? (fly.stress > 0.6 ? 'startled!' : 'stretching his wings') :
      hopping ? 'hopping up' :
      eating ? 'snacking' : drinking ? 'having a sip' :
      wantGroom ? 'tidying his face' :
      Sn === 'curious' ? 'curious about you' :
      fly.needs.energy < 0.25 ? 'sleepy' :
      fly.needs.hunger > 0.62 ? 'peckish' :
      fly.needs.thirst > 0.68 ? 'thirsty' :
      moving ? 'exploring' : 'content';
  };

  function lerpAngle(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }

  // keep a flying fly out of props, above the surface and inside the glass
  function airborneConstraints(clearance) {
    const p = root.position;
    const cols = columnsAt(p.y, 0.7).map(o => o.head && p.y > o.top - 1 ? Object.assign({}, o, { r: o.head }) : o);
    if (cols.length) {
      const before = tmpC.copy(p);
      settleBody(cols);
      if (before.distanceToSquared(p) > 1e-8) { flyVel.x *= 0.6; flyVel.z *= 0.6; }
    }
    const surfY = world.surfaceHeight(p.x, p.z, { maxY: p.y + 0.3 });
    if (p.y < surfY + 0.05) p.y = surfY + 0.05;                    // never inside anything
    const floor = surfY + clearance;                              // ...and ease up to cruising height
    if (p.y < floor) { p.y += (floor - p.y) * 0.25; if (flyVel.y < 0) flyVel.y *= 0.5; }
    // the bowl is a 12-unit sphere centred 4.5 up: hard stop just inside the
    // glass, and a softer nudge to keep his whole body clear of it
    if (p.y < W_RIM_Y) {
      const glassR = Math.sqrt(Math.max(0, 144 - (p.y - 4.5) * (p.y - 4.5)));
      const r = Math.hypot(p.x, p.z);
      if (r > 1e-3) {
        const hard = glassR - 0.4, soft = glassR - 1.3;
        if (r > hard) { p.x *= hard / r; p.z *= hard / r; }
        else if (r > soft) { const k = 1 - (r - soft) * 0.2 / r; p.x *= k; p.z *= k; }
      }
    }
  }
  const W_RIM_Y = world.rim.y - 0.05;

  return fly;
};
