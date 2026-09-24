/* brain.js — FlyWire-backed connectome hologram.
   Anatomy: FAFB v783 representative neuron coordinates.
   Activity: lightweight connectome-constrained model, not a neural recording. */
window.FP = window.FP || {};

FP.createBrain = function (scene, camera) {
  const data = FP.FLYWIRE_BRAIN;
  if (!data) throw new Error('FlyWire brain data did not load');

  const group = new THREE.Group();
  group.position.set(0, 12.8, 0);
  group.visible = false;
  scene.add(group);

  const REGIONS = {
    optic:    { color: 0x6fd6ff, label: 'optic lobes' },
    antennal: { color: 0xffd166, label: 'antennal + olfactory' },
    mushroom: { color: 0xc79bff, label: 'mushroom bodies' },
    cx:       { color: 0x7dffc4, label: 'central complex' },
    sez:      { color: 0xff9e7a, label: 'gustatory (SEZ)' },
    ammc:     { color: 0xffa8d4, label: 'mechanosensory (AMMC)' },
    motor:    { color: 0x8fa8ff, label: 'ascending + descending' },
    bg:       { color: 0x51688f, label: null },
  };
  const LABEL_OFFSETS = {
    optic: [-125, -20], antennal: [-125, 42], mushroom: [5, -62],
    cx: [8, -26], sez: [5, 58], ammc: [125, 38], motor: [125, -26],
  };
  const order = data.region_order;
  const boundsMin = data.bounds.min;
  const boundsRange = data.bounds.range;

  function bytes(b64) {
    const raw = atob(b64), out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function positions(b64) {
    const raw = bytes(b64);
    const q = new Uint16Array(raw.buffer);
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) {
      const axis = i % 3;
      out[i] = boundsMin[axis] + (q[i] / 65535) * boundsRange[axis];
    }
    return out;
  }
  function edgeFade(x, y, z) {
    const values = [x, y, z];
    let distance = 1;
    for (let axis = 0; axis < 3; axis++) {
      const q = (values[axis] - boundsMin[axis]) / boundsRange[axis];
      distance = Math.min(distance, q, 1 - q);
    }
    const t = THREE.MathUtils.clamp(distance / 0.15, 0, 1);
    return 0.025 + 0.975 * t * t * (3 - 2 * t);
  }
  function fadeColors(pos) {
    const color = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const f = edgeFade(pos[i], pos[i + 1], pos[i + 2]);
      color[i] = color[i + 1] = color[i + 2] = f;
    }
    return color;
  }

  const dot = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.38, 'rgba(255,255,255,.48)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();

  const clouds = {}, anchors = {};
  for (const key of order) {
    const info = data.regions[key], reg = REGIONS[key];
    const pos = positions(info.positions_u16_b64);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(fadeColors(pos), 3));
    const mat = new THREE.PointsMaterial({
      color: reg.color, map: dot, size: key === 'bg' ? 0.045 : 0.065,
      vertexColors: true, transparent: true, opacity: 0.24, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const cloud = new THREE.Points(geo, mat);
    cloud.frustumCulled = false;
    group.add(cloud);
    clouds[key] = cloud;

    const anchor = new THREE.Vector3();
    const stride = Math.max(1, Math.floor(info.count / 2000));
    let samples = 0;
    for (let i = 0; i < info.count; i += stride) {
      anchor.x += pos[i * 3]; anchor.y += pos[i * 3 + 1]; anchor.z += pos[i * 3 + 2];
      samples++;
    }
    anchor.divideScalar(Math.max(1, samples));
    anchor.y += 0.35;
    anchors[key] = anchor;
  }

  // Strong measured edges are split by functional region so their glow can
  // follow activity without rewriting a large color buffer every frame.
  const allEdgePos = positions(data.strong_edges.positions_u16_b64);
  const edgeRegion = bytes(data.strong_edges.regions_u8_b64);
  const edgeWeight = bytes(data.strong_edges.weights_u8_b64);
  const regionEdgeIndices = order.map(() => []);
  for (let i = 0; i < edgeRegion.length; i++) regionEdgeIndices[edgeRegion[i]].push(i);

  const edgeLines = {};
  for (let r = 0; r < order.length; r++) {
    const key = order[r], indices = regionEdgeIndices[r];
    const pos = new Float32Array(indices.length * 6);
    for (let n = 0; n < indices.length; n++) {
      const src = indices[n] * 6;
      pos.set(allEdgePos.subarray(src, src + 6), n * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(fadeColors(pos), 3));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: REGIONS[key].color, vertexColors: true,
      transparent: true, opacity: key === 'bg' ? 0.025 : 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    group.add(line);
    edgeLines[key] = line;
  }

  // Travelling sparks use the real strong-edge endpoints without allocating
  // a Vector3 pair for every edge.
  const SPARKS = 62;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARKS * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkPts = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xeaf6ff, map: dot, size: 0.16, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  group.add(sparkPts);
  const sparks = Array.from({ length: SPARKS }, () => ({ edge: -1, t: 1 + Math.random() }));

  // Projection beam up from Mel, retained from the original visual design.
  const beamOuterMat = new THREE.MeshBasicMaterial({
    color: 0x9fd8ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const beamCoreMat = beamOuterMat.clone();
  beamCoreMat.color.setHex(0xc6edff);
  const beam = new THREE.Group();
  beam.add(
    new THREE.Mesh(new THREE.CylinderGeometry(1.65, 0.025, 1, 32, 1, true), beamOuterMat),
    new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.008, 1.002, 28, 1, true), beamCoreMat));
  beam.visible = false;
  scene.add(beam);

  const labelEls = {};
  for (const [key, reg] of Object.entries(REGIONS)) {
    if (!reg.label) continue;
    const el = document.createElement('div');
    el.textContent = reg.label;
    el.style.cssText =
      'position:fixed;z-index:5;pointer-events:none;font-family:var(--mono);' +
      'font-size:9px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;' +
      'transform:translate(-50%,-120%);opacity:0;transition:opacity .5s ease;' +
      `color:#${reg.color.toString(16).padStart(6, '0')};text-shadow:0 0 10px rgba(120,190,255,.6);`;
    document.body.appendChild(el);
    labelEls[key] = el;
  }

  const modeledActivity = {};
  for (const key of order) modeledActivity[key] = key === 'bg' ? 0.16 : 0.08;
  const B = {
    visible: false, group, activity: modeledActivity,
    provenance: `${data.dataset} · ${data.neuron_count.toLocaleString()} neurons`,
  };
  let fade = 0;
  const tmp = new THREE.Vector3();
  const beamDir = new THREE.Vector3();
  const beamUp = new THREE.Vector3(0, 1, 0);
  const beamTopOffset = new THREE.Vector3(0, -1.4, 0);
  const desired = new Float32Array(order.length);

  B.setVisible = function (v) {
    B.visible = v;
    if (v) { group.visible = true; beam.visible = true; }
    for (const el of Object.values(labelEls)) el.style.opacity = v ? 1 : 0;
  };

  // The state machine supplies sensory/contextual drive. The published
  // connection graph supplies cross-region propagation. These values bias
  // behavior; they are explicitly not claimed as measured firing rates.
  B.step = function (dt, fly, io) {
    const authored = fly.activity || {};
    const nearMotion = io ? Math.min(1, io.cursorSpeed / 10) * Math.max(0, 1 - io.cursorDist / 7) : 0;
    for (let i = 0; i < order.length; i++) {
      const key = order[i];
      desired[i] = key === 'bg' ? 0.12 : (authored[key] || 0.05) * 0.72;
    }
    desired[order.indexOf('optic')] += nearMotion * 0.65;
    desired[order.indexOf('ammc')] += io && io.petting ? 0.65 : 0;
    desired[order.indexOf('sez')] += fly.state === 'eat' || fly.state === 'drink' ? 0.75 : 0;

    const matrix = data.region_matrix;
    for (let i = 0; i < order.length; i++) {
      const source = authored[order[i]] || modeledActivity[order[i]] || 0;
      for (let j = 0; j < order.length; j++) desired[j] += source * matrix[i * order.length + j] * 0.22;
    }
    for (let i = 0; i < order.length; i++) {
      const key = order[i], target = Math.min(1, desired[i]);
      modeledActivity[key] = THREE.MathUtils.lerp(modeledActivity[key], target, Math.min(1, dt * 5));
    }
    return {
      activity: modeledActivity,
      escape: Math.min(1, nearMotion * 0.72 + modeledActivity.optic * 0.22 + modeledActivity.motor * 0.08),
      groom: Math.min(1, modeledActivity.ammc * 0.65 + (io && io.petting ? 0.2 : 0)),
      feed: Math.min(1, modeledActivity.sez * 0.55 + modeledActivity.antennal * 0.2),
      locomotion: Math.min(1, modeledActivity.cx * 0.5 + modeledActivity.motor * 0.5),
    };
  };

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  B.update = function (dt, t, activity, flyHead) {
    activity = activity || modeledActivity;
    fade = THREE.MathUtils.lerp(fade, B.visible ? 1 : 0, Math.min(1, dt * 2.5));
    if (fade < 0.01 && !B.visible) {
      if (group.visible) for (const el of Object.values(labelEls)) el.style.opacity = 0;
      group.visible = false; beam.visible = false; return;
    }
    if (!reduceMotion) group.rotation.y = Math.sin(t * 0.12) * 0.34;
    group.scale.setScalar(1.18);

    for (const key of order) {
      const cloud = clouds[key], act = key === 'bg' ? 0.16 : (activity[key] || 0.08);
      const pulse = 1 + Math.sin(t * (5 + act * 5) + key.length) * 0.1 * act;
      cloud.material.opacity = fade * (key === 'bg' ? 0.018 : 0.025 + act * 0.14) * pulse;
      cloud.material.size = (key === 'bg' ? 0.032 : 0.038 + act * 0.035) * pulse;
      edgeLines[key].material.opacity = fade * (key === 'bg' ? 0.006 : 0.009 + act * 0.045);
    }

    let visibleSparks = 0;
    for (const spark of sparks) {
      spark.t += dt * 1.7;
      if (spark.t >= 1) {
        spark.edge = -1;
        for (let tries = 0; tries < 8; tries++) {
          const region = (Math.random() * order.length) | 0;
          const candidates = regionEdgeIndices[region];
          if (!candidates.length || Math.random() > (activity[order[region]] || 0.05)) continue;
          const candidate = candidates[(Math.random() * candidates.length) | 0];
          if (Math.random() > edgeWeight[candidate] / 255) continue;
          spark.edge = candidate;
          spark.t = 0;
          break;
        }
      }
      if (spark.edge >= 0 && spark.t < 1) {
        const at = spark.edge * 6;
        const ease = spark.t * spark.t * (3 - 2 * spark.t);
        sparkPos[visibleSparks * 3] = allEdgePos[at] + (allEdgePos[at + 3] - allEdgePos[at]) * ease;
        sparkPos[visibleSparks * 3 + 1] = allEdgePos[at + 1] + (allEdgePos[at + 4] - allEdgePos[at + 1]) * ease;
        sparkPos[visibleSparks * 3 + 2] = allEdgePos[at + 2] + (allEdgePos[at + 5] - allEdgePos[at + 2]) * ease;
        visibleSparks++;
      }
    }
    for (let i = visibleSparks; i < SPARKS; i++) {
      sparkPos[i * 3] = 0; sparkPos[i * 3 + 1] = -999; sparkPos[i * 3 + 2] = 0;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkPts.material.opacity = fade * 0.82;

    if (flyHead) {
      const top = tmp.copy(group.position).add(beamTopOffset);
      beam.position.lerpVectors(flyHead, top, 0.5);
      const h = flyHead.distanceTo(top);
      beamDir.copy(top).sub(flyHead).normalize();
      beam.quaternion.setFromUnitVectors(beamUp, beamDir);
      beam.scale.set(0.88 + fade * 0.12, h * 0.98, 0.88 + fade * 0.12);
      beamOuterMat.opacity = fade * 0.024;
      beamCoreMat.opacity = fade * 0.052;
    }

    group.updateMatrixWorld(true);
    if (B.visible || fade > 0.05) {
      for (const [key, el] of Object.entries(labelEls)) {
        tmp.copy(anchors[key]).applyMatrix4(group.matrixWorld).project(camera);
        if (tmp.z > 1) { el.style.opacity = 0; continue; }
        el.style.opacity = fade * (0.3 + (activity[key] || 0) * 0.7);
        const offset = LABEL_OFFSETS[key] || [0, 0];
        el.style.left = ((tmp.x * 0.5 + 0.5) * window.innerWidth + offset[0]) + 'px';
        el.style.top = ((-tmp.y * 0.5 + 0.5) * window.innerHeight + offset[1]) + 'px';
      }
    }
  };

  return B;
};
