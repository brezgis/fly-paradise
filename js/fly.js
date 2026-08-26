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

  // soft blob shadow that grounds him (the sun shadow is too coarse at fly scale)
  const blobShadow = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(30,34,18,0.5)'); gr.addColorStop(1, 'rgba(30,34,18,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.7),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
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
    b.position.set(side * 0.26, 0.16, -0.18);
    b.rotation.set(-1.1, 0, side * 0.5);
    body.add(b);
    return b;
  });

  // ---------- legs & gait ----------
  const LEGS = [];
  const STANCE = { f: [0.30, 0.34], m: [0.44, -0.14], h: [0.36, -0.52] };  // [out, fwd]
  for (const key of ['lf', 'lm', 'lh', 'rf', 'rm', 'rh']) {
    const info = M.legs[key];
    const side = key[0] === 'l' ? 1 : -1;
    const st = STANCE[key[1]];
    LEGS.push({
      key, side,
      hip: new V().fromArray(info.hip),
      lens: info.lens,
      parts: ['coxa', 'femur', 'tibia', 'tarsus'].map(s => parts[`leg_${key}_${s}`]),
      stance: new V(side * st[0], 0, st[1]),
      foot: new V(),                          // world-space planted foot
      from: new V(), to: new V(),
      swing: -1,                              // <0 planted, else 0..1 swing progress
      tripod: (key === 'lf' || key === 'rm' || key === 'lh') ? 0 : 1,
      tuck: 0,
    });
  }

  const BODY_H = 0.34;
  let bodyH = BODY_H;

  function groundY(x, z) { return world.groundHeight(x, z); }

  // place root somewhere pleasant to start
  root.position.set(-1.5, 0, -0.8);
  root.position.y = groundY(root.position.x, root.position.z);
  root.rotation.y = 0.6;

  function stanceWorld(leg, lead, out) {
    tmpA.copy(leg.stance);
    if (lead) tmpA.add(tmpB.copy(velRoot).multiplyScalar(0.16));
    out.copy(root.localToWorld(tmpA.clone()));
    out.y = groundY(out.x, out.z) + 0.02;
    if (fly.perchY !== null) out.y = fly.perchY;
    return out;
  }

  const qA = new Q(), qB = new Q(), qC = new Q();
  function aimLocal(part, parentWorldQ, dir) {
    qA.setFromUnitVectors(DOWN, dir);                       // world orientation
    qB.copy(parentWorldQ).invert();
    part.quaternion.copy(qB.multiply(qA));
    return qA.clone();
  }

  function solveLeg(leg) {
    const [Lc, Lf, Lt, Ltar] = leg.lens;
    // hip in root frame
    const hip = tmpA.copy(leg.hip).applyQuaternion(body.quaternion).add(body.position);
    // foot in root frame
    const footR = root.worldToLocal(tmpB.copy(leg.footNow));
    const toFoot = tmpC.copy(footR).sub(hip);
    const dist = Math.max(0.01, toFoot.length());
    toFoot.divideScalar(dist);
    // coxa points down, biased toward the foot
    const coxaDir = tmpD.copy(toFoot).multiplyScalar(0.45).addScaledVector(DOWN, 0.8).normalize();
    const knee0 = new V().copy(hip).addScaledVector(coxaDir, Lc);
    // ankle: pull back from the foot along a flat-ish tarsus
    const horiz = new V(toFoot.x, 0, toFoot.z);
    if (horiz.lengthSq() < 1e-6) horiz.set(leg.side, 0, 0);
    horiz.normalize();
    const tarsusDir = new V().copy(horiz).multiplyScalar(0.86).addScaledVector(DOWN, 0.5).normalize();
    const ankle = new V().copy(footR).addScaledVector(tarsusDir, -Ltar * 0.88);
    if (ankle.y < footR.y + 0.05) ankle.y = footR.y + 0.05;
    // two-bone femur+tibia from knee0 to ankle
    const AB = new V().copy(ankle).sub(knee0);
    let d = AB.length();
    const minD = Math.abs(Lf - Lt) * 1.05 + 0.005, maxD = (Lf + Lt) * 0.985;
    if (d < minD || d > maxD) { d = Math.min(maxD, Math.max(minD, d)); }
    const along = AB.normalize();
    const proj = (Lf * Lf - Lt * Lt + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0.0001, Lf * Lf - proj * proj));
    const outward = new V(leg.side, 0.15, leg.key[1] === 'f' ? 0.35 : 0).normalize();
    const axis = new V().crossVectors(along, outward);
    if (axis.lengthSq() < 1e-5) axis.set(0, 0, leg.side);
    axis.normalize();
    const kneeDir = new V().crossVectors(axis, along).normalize();
    if (kneeDir.y < 0) kneeDir.negate();
    const knee = new V().copy(knee0).addScaledVector(along, proj).addScaledVector(kneeDir, h);
    const ankle2 = new V().copy(knee0).addScaledVector(along, d);
    // orient the chain
    const bodyQ = body.quaternion;
    let pq = aimLocal(leg.parts[0], bodyQ, coxaDir);
    pq = aimLocal(leg.parts[1], pq, new V().copy(knee).sub(knee0).normalize());
    pq = aimLocal(leg.parts[2], pq, new V().copy(ankle2).sub(knee).normalize());
    aimLocal(leg.parts[3], pq, new V().copy(footR).sub(ankle2).normalize());
  }

  // ---------- particles (hearts, zzz) ----------
  function spriteTexture(draw) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
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
    mood: 'settling in',
    needs: { hunger: 0.35, thirst: 0.25, energy: 0.85 },
    stress: 0, trust: 0.25,
    perchY: null,                            // non-null when perched off-terrain
    onPillow: false,
    petting: false, pettingGlow: 0,
    events: [],
    activity: { optic: 0.2, antennal: 0.1, mushroom: 0.1, cx: 0.1, sez: 0.05, ammc: 0.05, motor: 0.1 },
    dominant: 'idle',
  };

  root.updateMatrixWorld(true);
  for (const leg of LEGS) { stanceWorld(leg, false, leg.foot); leg.footNow = leg.foot.clone(); }

  let target = new V(), targetFood = null, gaitPhase = 0, lastTripod = 1;
  let flyVel = new V(), flyWaypoint = new V(), heartTimer = 0, zTimer = 0, sipTimer = 0;
  let wake = { proboscis: 0, groomT: 0, headPitch: 0, antennaBack: 0, wingSpread: 0, flap: 0 };
  let landSpot = null, walkSpeed = 1.15, curiousCooldown = 8;

  function setState(s) {
    if (fly.state === 'nap') fly.events.push('wake');
    fly.state = s; fly.stateT = 0;
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

  function pickWaypoint() {
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5.5;
    flyWaypoint.set(Math.cos(a) * r, 2.5 + Math.random() * 5.5, Math.sin(a) * r);
  }
  function pickLanding() {
    const roll = Math.random();
    if (roll < 0.16) {
      const a = Math.random() * Math.PI * 2;
      landSpot = { pos: new V(Math.cos(a) * world.rim.r, world.rim.y + 0.06, Math.sin(a) * world.rim.r), perch: world.rim.y + 0.06 };
    } else if (roll < 0.30 && world.twigPerch) {
      landSpot = { pos: world.twigPerch.clone().add(new V(0, 0.06, 0)), perch: world.twigPerch.y + 0.06 };
    } else {
      let x = 0, z = 0, ok = false, guard = 0;
      while (!ok && guard++ < 40) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 8.4;
        x = Math.cos(a) * r; z = Math.sin(a) * r;
        ok = Math.hypot(x - world.dish.x, z - world.dish.z) > world.dish.r + 0.8;
      }
      landSpot = { pos: new V(x, groundY(x, z), z), perch: null };
    }
  }

  fly.startle = function (hard) {
    if (fly.state === 'carried') fly.events.push('escape');
    if (fly.state !== 'fly' && fly.state !== 'land') {
      fly.trust = Math.max(0, fly.trust - (hard ? 0.08 : 0.04));
      fly.stress = 1.2;
      setState('fly');
    }
  };
  fly.canCarry = () => fly.trust > 0.45 &&
    ['idle', 'wander', 'groom', 'pet', 'eat', 'drink'].includes(fly.state);
  fly.beginCarry = function () { setState('carried'); fly.events.push('carry'); };
  fly.endCarry = function (pos) {
    root.position.copy(pos);
    // never set him down in the water dish — nudge to its edge
    tmpA.set(pos.x - world.dish.x, 0, pos.z - world.dish.z);
    const dDish = tmpA.length();
    if (dDish < world.dish.r + 0.3) {
      if (dDish < 1e-3) tmpA.set(1, 0, 0); else tmpA.divideScalar(dDish);
      root.position.x = world.dish.x + tmpA.x * (world.dish.r + 0.4);
      root.position.z = world.dish.z + tmpA.z * (world.dish.r + 0.4);
    }
    const overPillow = Math.hypot(root.position.x - world.pillow.x, root.position.z - world.pillow.z) < world.pillow.r * 0.8;
    if (overPillow) {
      root.position.y = world.pillow.worldTop; fly.onPillow = true; fly.perchY = world.pillow.worldTop;
      fly.needs.energy < 0.75 ? setState('nap') : setState('idle');
    } else {
      root.position.y = groundY(pos.x, pos.z);
      fly.perchY = null;
      setState('idle');
    }
    if (fly.trust > 0.8) spawnHearts(1);
    for (const leg of LEGS) stanceWorld(leg, false, leg.foot);
  };
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

  function walkToward(dt, dest, speed) {
    tmpA.copy(dest).sub(root.position); tmpA.y = 0;
    const dist = tmpA.length();
    if (dist < 0.18) return true;
    tmpA.divideScalar(dist);
    const desiredYaw = Math.atan2(tmpA.x, tmpA.z);
    let dy = desiredYaw - root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    root.rotation.y += THREE.MathUtils.clamp(dy, -3.4 * dt, 3.4 * dt);
    const go = Math.min(speed * dt, dist) * Math.max(0.15, 1 - Math.abs(dy) * 0.5);
    // steer around the water dish
    tmpB.set(root.position.x - world.dish.x, 0, root.position.z - world.dish.z);
    const dDish = tmpB.length();
    if (dDish < world.dish.r + 0.7 && !(fly.state === 'seekWater' || fly.state === 'drink')) {
      tmpA.addScaledVector(tmpB.normalize(), (world.dish.r + 0.7 - dDish) * 1.6).normalize();
    }
    root.position.addScaledVector(tmpA, go);
    const r = Math.hypot(root.position.x, root.position.z);
    if (r > 9.3) { root.position.x *= 9.3 / r; root.position.z *= 9.3 / r; }
    root.position.y = fly.perchY !== null ? fly.perchY : groundY(root.position.x, root.position.z);
    worldVel.copy(tmpA).multiplyScalar(go / Math.max(dt, 1e-4));
    return false;
  }

  function randomSpot() {
    let guard = 0;
    while (guard++ < 40) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 8.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - world.dish.x, z - world.dish.z) > world.dish.r + 1 &&
          Math.hypot(x - world.pillow.x, z - world.pillow.z) > world.pillow.r + 0.6) {
        return new V(x, 0, z);
      }
    }
    return new V(0, 0, 0);
  }

  function nearestFood() {
    let best = null, bd = 1e9;
    for (const f of world.foods) {
      const d = f.mesh.position.distanceTo(root.position);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  // ---------- main update ----------
  fly.update = function (dt, t, io) {
    dt = Math.min(dt, 0.05);
    fly.stateT += dt;
    const S = fly.state;
    const grounded = !['fly', 'land', 'carried'].includes(S);

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
      const rough = Math.max(0, io.cursorSpeed - 3.2) * (1 - fly.trust * 0.35);
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
    let moving = false;

    switch (S) {
      case 'idle': {
        if (FP.freeze) break;
        if (fly.stateT > 1.2 + Math.random() * 2) {
          if (fly.perchY !== null && !fly.onPillow) { setState('fly'); break; }  // leave rim/twig perch
          if (fly.needs.energy < 0.22) { target.copy(world.pillow.mesh ? new V(world.pillow.x, 0, world.pillow.z) : target); setState('seekRest'); }
          else if (fly.needs.hunger > 0.62 && (targetFood = nearestFood())) setState('seekFood');
          else if (fly.needs.thirst > 0.68) setState('seekWater');
          else if (io && fly.trust > 0.55 && curiousCooldown <= 0 && io.cursorOnGround &&
                   io.cursorSpeed < 1.2 && io.cursorDist > 2.2 && io.cursorDist < 7 && Math.random() < 0.5) {
            target.copy(io.cursorWorld); setState('curious');
          }
          else {
            const r = Math.random();
            if (r < 0.42) { target.copy(randomSpot()); setState('wander'); }
            else if (r < 0.68) setState('groom');
            else fly.stateT = 0;
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
        if (fly.stateT > 3.2 + Math.random() * 2.5) setState('idle');
        break;
      }
      case 'seekFood': {
        if (!targetFood) { setState('idle'); break; }
        tmpA.copy(root.position).sub(targetFood.mesh.position); tmpA.y = 0;
        if (tmpA.lengthSq() < 1e-4) tmpA.set(1, 0, 0);
        tmpA.normalize();
        tmpB.copy(targetFood.mesh.position).addScaledVector(tmpA, targetFood.radius + 0.5);
        moving = !walkToward(dt, tmpB, 1.5);
        if (!moving) setState('eat');
        if (fly.stateT > 12) setState('idle');
        break;
      }
      case 'eat': {
        if (!targetFood) { setState('idle'); break; }
        // face the food
        tmpA.copy(targetFood.mesh.position).sub(root.position);
        const yaw = Math.atan2(tmpA.x, tmpA.z);
        let dy = yaw - root.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        root.rotation.y += dy * Math.min(1, dt * 4);
        wantProboscis = 0.65 + Math.sin(t * 5.2) * 0.3;
        wantHeadPitch = 0.34;
        fly.needs.hunger = Math.max(0, fly.needs.hunger - dt / 7);
        if (targetFood.mesh.position.distanceTo(root.position) > targetFood.radius + 1.4) setState('seekFood');
        else if (fly.needs.hunger < 0.12 || fly.stateT > 11) {
          if (fly.trust > 0.5) spawnHearts(1);
          setState('idle');
        }
        break;
      }
      case 'seekWater': {
        tmpA.set(root.position.x - world.dish.x, 0, root.position.z - world.dish.z);
        if (tmpA.lengthSq() < 1e-4) tmpA.set(1, 0, 0);
        tmpA.normalize();
        tmpB.set(world.dish.x, 0, world.dish.z).addScaledVector(tmpA, world.dish.r + 0.35);
        moving = !walkToward(dt, tmpB, 1.4);
        if (!moving) {
          // hop up to the rim
          tmpC.set(world.dish.x, 0, world.dish.z).addScaledVector(tmpA, world.dish.waterR + 0.42);
          root.position.set(tmpC.x, world.dish.worldY + 0.95, tmpC.z);
          fly.perchY = root.position.y;
          root.rotation.y = Math.atan2(world.dish.x - root.position.x, world.dish.z - root.position.z);
          for (const leg of LEGS) stanceWorld(leg, false, leg.foot);
          setState('drink');
        }
        if (fly.stateT > 12) setState('idle');
        break;
      }
      case 'drink': {
        wantProboscis = 0.8 + Math.sin(t * 3.2) * 0.2;
        wantHeadPitch = 0.5;
        fly.needs.thirst = Math.max(0, fly.needs.thirst - dt / 6);
        sipTimer -= dt;
        if (sipTimer <= 0) {
          sipTimer = 1.3 + Math.random();
          tmpA.copy(root.position);
          tmpB.set(world.dish.x - tmpA.x, 0, world.dish.z - tmpA.z).normalize();
          world.spawnRipple(tmpA.x + tmpB.x * 0.7, tmpA.z + tmpB.z * 0.7);
          fly.events.push('sip');
        }
        if (fly.needs.thirst < 0.1 || fly.stateT > 10) {
          fly.perchY = null;
          root.position.y = groundY(root.position.x, root.position.z);
          for (const leg of LEGS) stanceWorld(leg, false, leg.foot);
          setState('idle');
        }
        break;
      }
      case 'seekRest': {
        tmpB.set(world.pillow.x, 0, world.pillow.z);
        moving = !walkToward(dt, tmpB, 1.1);
        const d = Math.hypot(root.position.x - world.pillow.x, root.position.z - world.pillow.z);
        if (d < world.pillow.r * 0.75) {
          fly.onPillow = true; fly.perchY = world.pillow.worldTop;
          root.position.y = world.pillow.worldTop;
          for (const leg of LEGS) stanceWorld(leg, false, leg.foot);
          setState('nap');
        }
        if (fly.stateT > 14) setState('idle');
        break;
      }
      case 'nap': {
        antennaRelax = 1;
        fly.needs.energy = Math.min(1, fly.needs.energy + dt / (FP.fast ? 6 : 26));
        zTimer -= dt;
        if (zTimer <= 0) {
          zTimer = 2.6 + Math.random() * 1.5;
          spawnSprite(zTex, fly.headWorld(tmpD).add(new V(0.15, 0.5, 0)),
            { size: 0.34, life: 2.6, rise: 0.55, sway: 0.5 });
        }
        if (fly.needs.energy > 0.92) {
          fly.onPillow = false; fly.perchY = null;
          root.position.y = groundY(root.position.x, root.position.z);
          setState('groom');
        }
        break;
      }
      case 'pet': {
        antennaRelax = 0.85;
        fly.trust = Math.min(1, fly.trust + dt * 0.028);
        heartTimer -= dt;
        if (heartTimer <= 0 && fly.trust > 0.35) {
          heartTimer = 1.4 + Math.random() * 0.9;
          spawnHearts(1 + (fly.trust > 0.75 ? 1 : 0));
        }
        if (!fly.petting && fly.stateT > 1.2) setState('idle');
        if (!fly.petting) { /* linger a moment */ } else fly.stateT = Math.min(fly.stateT, 1);
        break;
      }
      case 'carried': {
        antennaRelax = 0.4;
        if (io && io.carryTarget) {
          root.position.lerp(io.carryTarget, Math.min(1, dt * 7));
        }
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
        if (flyVel.length() > 5.2) flyVel.setLength(5.2);
        root.position.addScaledVector(flyVel, dt);
        const r = Math.hypot(root.position.x, root.position.z);
        if (r > 8.2) { const s = 8.2 / r; root.position.x *= s; root.position.z *= s; flyVel.x -= root.position.x / r * 2 * dt * 30; flyVel.z -= root.position.z / r * 2 * dt * 30; }
        root.position.y = THREE.MathUtils.clamp(root.position.y, 1.0, 9.6);
        root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, Math.atan2(flyVel.x, flyVel.z), Math.min(1, dt * 5));
        if (fly.stateT > 2.5 && fly.stress < 0.22) setState('land');
        break;
      }
      case 'land': {
        if (!landSpot) pickLanding();
        tmpA.copy(landSpot.pos).sub(root.position);
        const d = tmpA.length();
        if (d < 0.15) {
          root.position.copy(landSpot.pos);
          fly.perchY = landSpot.perch;
          if (fly.perchY === null) root.position.y = groundY(root.position.x, root.position.z);
          for (const leg of LEGS) stanceWorld(leg, false, leg.foot);
          fly.events.push('land');
          setState('idle');
          break;
        }
        tmpA.normalize();
        flyVel.lerp(tmpA.multiplyScalar(Math.min(4, d * 2.4 + 0.6)), Math.min(1, dt * 3));
        root.position.addScaledVector(flyVel, dt);
        root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, Math.atan2(flyVel.x, flyVel.z), Math.min(1, dt * 4));
        break;
      }
    }

    const flying = S === 'fly' || S === 'land';
    const carried = S === 'carried';

    // ---- gait ----
    root.updateMatrixWorld(true);
    velRoot.copy(worldVel).applyQuaternion(qC.copy(root.quaternion).invert()).divideScalar(SCALE);
    if (!flying && !carried) {
      const speed = moving ? walkSpeed : 0;
      if (moving) {
        gaitPhase += dt * (2.4 + speed * 1.6);
        const step = Math.floor(gaitPhase * 2) % 2;
        if (step !== lastTripod) {
          lastTripod = step;
          for (const leg of LEGS) {
            if (leg.tripod === step && leg.swing < 0) {
              leg.swing = 0;
              leg.from.copy(leg.foot);
              stanceWorld(leg, true, leg.to);
            }
          }
        }
      } else {
        // tidy stray feet while standing
        for (const leg of LEGS) {
          if (leg.swing < 0) {
            stanceWorld(leg, false, tmpA);
            if (tmpA.distanceTo(leg.foot) > 0.42 * SCALE) {
              leg.swing = 0; leg.from.copy(leg.foot); leg.to.copy(tmpA);
            }
          }
        }
      }
      for (const leg of LEGS) {
        leg.tuck = Math.max(0, leg.tuck - dt * 5);
        if (leg.swing >= 0) {
          leg.swing += dt / 0.14;
          if (leg.swing >= 1) { leg.swing = -1; leg.foot.copy(leg.to); }
          else {
            leg.foot.lerpVectors(leg.from, leg.to, leg.swing);
            leg.foot.y += Math.sin(leg.swing * Math.PI) * 0.16 * SCALE;
          }
        }
        leg.footNow = leg.footNow || new V();
        leg.footNow.copy(leg.foot);
      }
    } else {
      // tuck legs beneath the body
      for (const leg of LEGS) {
        leg.tuck = Math.min(1, leg.tuck + dt * 4);
        leg.swing = -1;
        tmpA.copy(leg.stance).multiplyScalar(0.4).add(new V(leg.side * 0.1, 0.05, 0.05));
        leg.footNow = leg.footNow || new V();
        leg.footNow.copy(root.localToWorld(tmpA.clone()));
        leg.foot.copy(leg.footNow);
      }
    }

    // ---- body pose ----
    const napping = S === 'nap';
    let targetH = napping ? 0.20 : flying ? 0.4 : BODY_H;
    if (S === 'pet') targetH = BODY_H - 0.05 - fly.pettingGlow * 0.02 * Math.sin(t * 3);
    bodyH = THREE.MathUtils.lerp(bodyH, targetH, Math.min(1, dt * 6));
    const bob = moving ? Math.sin(gaitPhase * Math.PI * 2) * 0.012 : Math.sin(t * (napping ? 1.1 : 2.1)) * (napping ? 0.006 : 0.004);
    body.position.set(0, bodyH + bob, 0);
    let pitch = wantHeadPitch * 0.4 + (flying ? -0.35 : 0);
    let roll = 0;
    if (flying) {
      const latAccel = flyVel.x * Math.cos(root.rotation.y) - flyVel.z * Math.sin(root.rotation.y);
      roll = THREE.MathUtils.clamp(-latAccel * 0.09, -0.5, 0.5);
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

    // grooming: front legs rub near the head
    if (wantGroom) {
      wake.groomT += dt;
      for (const leg of LEGS) {
        if (leg.key[1] !== 'f') continue;
        const ph = wake.groomT * 9 + (leg.side > 0 ? 0 : Math.PI);
        tmpA.set(leg.side * (0.10 + Math.sin(ph) * 0.045), 0.24 + Math.abs(Math.sin(ph * 0.5)) * 0.06, 0.42 + Math.cos(ph) * 0.03);
        leg.footNow.copy(root.localToWorld(tmpA.clone()));
      }
    } else wake.groomT = 0;

    // wings & halteres
    const wingsOut = FP.wingsOverride != null ? FP.wingsOverride : (flying ? 1 : 0);
    wake.wingSpread = THREE.MathUtils.lerp(wake.wingSpread, wingsOut, Math.min(1, dt * 8));
    wake.flap = FP.flapOverride != null ? FP.flapOverride :
      (flying ? wake.flap + dt * 26 * Math.PI * 2 : 0);
    for (const [nm, sgn] of [['wing_l', 1], ['wing_r', -1]]) {
      const p = parts[nm];
      p.quaternion.copy(p.userData.rest);
      if (wake.wingSpread > 0.01) {
        const spread = wake.wingSpread * 1.35;
        const flap = Math.sin(wake.flap) * 0.85 * wake.wingSpread;
        p.quaternion.multiply(qB.setFromAxisAngle(new V(0, 1, 0), -sgn * spread))
                    .multiply(qC.setFromAxisAngle(new V(0, 0, 1), sgn * flap));
      } else if (napping) {
        p.quaternion.multiply(qB.setFromAxisAngle(new V(1, 0, 0), 0.06));
      }
    }
    for (const [nm, sgn] of [['haltere_l', 1], ['haltere_r', -1]]) {
      parts[nm].quaternion.copy(parts[nm].userData.rest);
      if (flying) parts[nm].quaternion.multiply(qB.setFromAxisAngle(new V(0, 0, 1), sgn * Math.sin(wake.flap + Math.PI) * 0.5));
    }
    for (const b of blurs) {
      b.material.opacity = wake.wingSpread * (0.16 + Math.abs(Math.sin(wake.flap * 0.5)) * 0.12);
      b.scale.y = 0.5 + Math.abs(Math.sin(wake.flap * 0.25)) * 0.3;
    }

    // abdomen breathing
    const breath = napping ? Math.sin(t * 1.4) * 0.045 : Math.sin(t * 2.3) * 0.02;
    parts.abdomen.scale.setScalar(1 + breath);

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
    const eating = S === 'eat', drinking = S === 'drink';
    const foodNear = targetFood && targetFood.mesh.position.distanceTo(root.position) < 4 ? 0.5 : 0;
    lerpA('optic', 0.22 + cursorMotion * 0.8 + (flying ? 0.5 : 0) + (S === 'curious' ? 0.3 : 0) - (napping ? 0.18 : 0));
    lerpA('antennal', 0.12 + fly.needs.hunger * 0.25 + foodNear + (eating ? 0.45 : 0) + (S === 'curious' ? 0.4 : 0));
    lerpA('mushroom', 0.12 + (eating ? 0.55 : 0) + fly.pettingGlow * 0.5 + (S === 'curious' ? 0.35 : 0));
    lerpA('cx', 0.15 + (moving ? 0.65 : 0) + (flying ? 0.8 : 0) - (napping ? 0.1 : 0));
    lerpA('sez', 0.06 + (eating || drinking ? 0.95 : 0) + (wantGroom ? 0.35 : 0));
    lerpA('ammc', 0.08 + fly.pettingGlow * 0.95 + (carried ? 0.5 : 0) + (flying ? 0.35 : 0));
    lerpA('motor', 0.1 + (moving ? 0.55 : 0) + (flying ? 0.95 : 0) + (wantGroom ? 0.6 : 0) - (napping ? 0.08 : 0));
    fly.dominant =
      S === 'nap' ? 'nap' :
      flying ? (fly.stress > 0.6 ? 'escape' : 'flight') :
      eating ? 'taste' : drinking ? 'drink' :
      fly.petting || S === 'pet' ? 'touch' :
      carried ? 'carried' :
      wantGroom ? 'groom' :
      S === 'curious' ? 'curious' :
      cursorMotion > 0.45 ? 'looming' :
      moving ? 'walk' : 'rest';

    // blob shadow follows him, fading with altitude
    {
      const gy = world.groundHeight(root.position.x, root.position.z);
      const alt = Math.max(0, root.position.y - gy);
      blobShadow.position.set(root.position.x, gy + 0.04, root.position.z);
      blobShadow.rotation.z = root.rotation.y;
      const k = Math.max(0.15, 1 - alt / 7);
      blobShadow.material.opacity = 0.85 * k;
      blobShadow.scale.setScalar(1 + alt * 0.12);
    }

    // pillow squish
    if (world.pillow.mesh) {
      const target = fly.onPillow ? 0.5 : 0.62;
      world.pillow.mesh.scale.y = THREE.MathUtils.lerp(world.pillow.mesh.scale.y, target, Math.min(1, dt * 4));
    }

    // mood label
    fly.mood =
      S === 'nap' ? 'fast asleep' :
      S === 'pet' ? 'enjoying pets' :
      S === 'carried' ? (fly.trust > 0.8 ? 'riding along happily' : 'holding on') :
      flying ? (fly.stress > 0.6 ? 'startled!' : 'stretching his wings') :
      eating ? 'snacking' : drinking ? 'having a sip' :
      wantGroom ? 'tidying his face' :
      S === 'curious' ? 'curious about you' :
      fly.needs.energy < 0.25 ? 'sleepy' :
      fly.needs.hunger > 0.62 ? 'peckish' :
      fly.needs.thirst > 0.68 ? 'thirsty' :
      moving ? 'exploring' : 'content';
  };

  return fly;
};
