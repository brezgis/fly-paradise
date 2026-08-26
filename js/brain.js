/* brain.js — stylized FlyWire-inspired connectome hologram.
   FP.createBrain(scene, camera) -> { setVisible, update, visible } */
window.FP = window.FP || {};

FP.createBrain = function (scene, camera) {
  const group = new THREE.Group();
  group.position.set(0, 12.8, 0);
  group.visible = false;
  scene.add(group);

  const REGIONS = {
    optic:    { color: 0x6fd6ff, label: 'optic lobe',        n: 1500 },
    antennal: { color: 0xffd166, label: 'antennal lobe',     n: 260 },
    mushroom: { color: 0xc79bff, label: 'mushroom body',     n: 520 },
    cx:       { color: 0x7dffc4, label: 'central complex',   n: 300 },
    sez:      { color: 0xff9e7a, label: 'gustatory (SEZ)',   n: 260 },
    ammc:     { color: 0xffa8d4, label: 'mechanosensory (AMMC)', n: 220 },
    motor:    { color: 0x8fa8ff, label: 'ventral nerve cord', n: 380 },
    bg:       { color: 0x51688f, label: null,                n: 650 },
  };

  // gaussian-ish scatter in an ellipsoid shell/blob
  function scatter(n, centers, radii, shell) {
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = centers[i % centers.length];
      let x, y, z, r2;
      do {
        x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
        r2 = x * x + y * y + z * z;
      } while (r2 > 1 || (shell && r2 < 0.42));
      pts[i * 3] = c[0] + x * radii[0];
      pts[i * 3 + 1] = c[1] + y * radii[1];
      pts[i * 3 + 2] = c[2] + z * radii[2];
    }
    return pts;
  }

  const LAYOUT = {
    optic:    { centers: [[-3.1, 0, 0], [3.1, 0, 0]], radii: [1.45, 1.85, 1.3], shell: true },
    antennal: { centers: [[-0.85, -0.7, 1.5], [0.85, -0.7, 1.5]], radii: [0.5, 0.45, 0.45] },
    mushroom: { centers: [[-1.35, 0.85, 0.3], [1.35, 0.85, 0.3], [-1.0, 0.2, 0.9], [1.0, 0.2, 0.9]], radii: [0.62, 0.5, 0.45] },
    cx:       { centers: [[0, 0.6, 0.15]], radii: [0.75, 0.42, 0.45] },
    sez:      { centers: [[0, -1.2, 0.85]], radii: [0.8, 0.5, 0.55] },
    ammc:     { centers: [[-1.5, -0.55, 0.85], [1.5, -0.55, 0.85]], radii: [0.45, 0.4, 0.4] },
    motor:    { centers: [[0, -1.9, -0.7], [0, -2.6, -1.35], [0, -3.2, -1.9]], radii: [0.55, 0.5, 0.5] },
    bg:       { centers: [[0, 0, 0]], radii: [2.35, 1.65, 1.5] },
  };

  const dot = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();

  const clouds = {};
  const anchors = {};
  for (const [key, reg] of Object.entries(REGIONS)) {
    const lay = LAYOUT[key];
    const pts = scatter(reg.n, lay.centers, lay.radii, lay.shell);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = new THREE.PointsMaterial({
      color: reg.color, map: dot, size: key === 'bg' ? 0.07 : 0.1,
      transparent: true, opacity: 0.25, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const cloud = new THREE.Points(geo, mat);
    group.add(cloud);
    clouds[key] = cloud;
    const c0 = lay.centers[0];
    anchors[key] = new THREE.Vector3(c0[0] - (lay.centers.length > 1 ? lay.radii[0] * 0.9 : 0), c0[1] + lay.radii[1] * 0.75, c0[2]);
  }

  // fiber tracts between related regions
  const TRACTS = [
    ['optic', 'cx', 22], ['optic', 'mushroom', 10], ['antennal', 'mushroom', 16],
    ['ammc', 'sez', 10], ['sez', 'motor', 12], ['cx', 'motor', 16], ['mushroom', 'cx', 10],
  ];
  const edges = [];
  {
    const verts = [];
    for (const [a, b, n] of TRACTS) {
      const pa = clouds[a].geometry.attributes.position;
      const pb = clouds[b].geometry.attributes.position;
      for (let i = 0; i < n; i++) {
        const ia = (Math.random() * pa.count) | 0, ib = (Math.random() * pb.count) | 0;
        const va = new THREE.Vector3().fromBufferAttribute(pa, ia);
        const vb = new THREE.Vector3().fromBufferAttribute(pb, ib);
        verts.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
        edges.push({ a: va, b: vb, ra: a, rb: b });
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: 0x5a78c8, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    group.add(lines);
  }

  // travelling signal sparks
  const SPARKS = 46;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARKS * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkPts = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xeaf6ff, map: dot, size: 0.22, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending }));
  group.add(sparkPts);
  const sparks = [];
  for (let i = 0; i < SPARKS; i++) sparks.push({ edge: null, t: 1 + Math.random() });

  // projection beam up from the fly
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x9fd8ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), beamMat);
  beam.visible = false;
  scene.add(beam);

  // HTML labels
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

  const B = { visible: false, group };
  let fade = 0;
  const tmp = new THREE.Vector3();

  B.setVisible = function (v) {
    B.visible = v;
    if (v) { group.visible = true; beam.visible = true; }
    for (const el of Object.values(labelEls)) el.style.opacity = v ? 1 : 0;
  };

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  B.update = function (dt, t, activity, flyHead) {
    fade = THREE.MathUtils.lerp(fade, B.visible ? 1 : 0, Math.min(1, dt * 2.5));
    if (fade < 0.01 && !B.visible) { group.visible = false; beam.visible = false; return; }
    if (!reduceMotion) group.rotation.y = Math.sin(t * 0.12) * 0.45;
    group.scale.setScalar(1.45);

    for (const [key, cloud] of Object.entries(clouds)) {
      const act = key === 'bg' ? 0.2 : (activity[key] || 0.1);
      const pulse = 1 + Math.sin(t * (6 + act * 6) + key.length) * 0.12 * act;
      cloud.material.opacity = fade * (0.22 + act * 0.55) * pulse;
      cloud.material.size = (key === 'bg' ? 0.10 : 0.16 + act * 0.07) * pulse;
    }

    // sparks travel along tracts whose endpoint regions are active
    let sp = 0;
    for (const s of sparks) {
      s.t += dt * 2.1;
      if (s.t >= 1) {
        s.edge = null;
        // pick an edge weighted by activity
        for (let tries = 0; tries < 6; tries++) {
          const e = edges[(Math.random() * edges.length) | 0];
          const act = Math.max(activity[e.ra] || 0, activity[e.rb] || 0);
          if (Math.random() < act) { s.edge = e; s.t = 0; break; }
        }
      }
      if (s.edge && s.t < 1) {
        tmp.lerpVectors(s.edge.a, s.edge.b, s.t);
        sparkPos[sp * 3] = tmp.x; sparkPos[sp * 3 + 1] = tmp.y; sparkPos[sp * 3 + 2] = tmp.z;
        sp++;
      }
    }
    for (let i = sp; i < SPARKS; i++) {
      sparkPos[i * 3] = 0; sparkPos[i * 3 + 1] = -999; sparkPos[i * 3 + 2] = 0;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkPts.material.opacity = fade * 0.85;

    // beam from the fly's head to the hologram
    if (flyHead) {
      const top = tmp.copy(group.position);
      beam.position.lerpVectors(flyHead, top, 0.5);
      const h = flyHead.distanceTo(top);
      beam.scale.set(0.5 + fade * 0.4, h * 0.92, 1);
      beam.lookAt(camera.position.x, beam.position.y, camera.position.z);
      beamMat.opacity = fade * 0.05;
    }

    // labels track their anchors
    if (B.visible || fade > 0.05) {
      for (const [key, el] of Object.entries(labelEls)) {
        tmp.copy(anchors[key]).applyMatrix4(group.matrixWorld);
        tmp.project(camera);
        if (tmp.z > 1) { el.style.opacity = 0; continue; }
        el.style.opacity = fade * (0.35 + (activity[key] || 0) * 0.65);
        el.style.left = ((tmp.x * 0.5 + 0.5) * window.innerWidth) + 'px';
        el.style.top = ((-tmp.y * 0.5 + 0.5) * window.innerHeight) + 'px';
      }
    }
  };

  return B;
};
