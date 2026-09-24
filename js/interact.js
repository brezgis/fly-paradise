/* interact.js — cursor presence, gentleness, petting, carrying, food dragging.
   FP.createInteraction(renderer, camera, controls, world, fly) -> I
   I.update(dt) refreshes I.io, consumed by fly.update. */
window.FP = window.FP || {};

FP.createInteraction = function (renderer, camera, controls, world, fly) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const V = THREE.Vector3;
  const tmp = new V(), tmp2 = new V();
  const plane = new THREE.Plane(new V(0, 1, 0), 0);

  // invisible grab-sphere that travels with the fly
  const flyHit = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false }));
  flyHit.position.y = 0.3;
  fly.root.add(flyHit);

  // cursor presence ring, draped over the moss / pillow / food under it (a flat
  // ring used to slice into slopes and vanish under props)
  const ringGeo = new THREE.RingGeometry(0.55, 0.68, 32, 1); ringGeo.rotateX(-Math.PI / 2);
  const ringMesh = new THREE.Mesh(ringGeo,
    new THREE.MeshBasicMaterial({ color: 0x8fae6d, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
  const dotGeo = new THREE.CircleGeometry(0.09, 16); dotGeo.rotateX(-Math.PI / 2);
  const ringDot = new THREE.Mesh(dotGeo,
    new THREE.MeshBasicMaterial({ color: 0x8fae6d, transparent: true, opacity: 0.0, depthWrite: false }));
  ringMesh.renderOrder = ringDot.renderOrder = 2;
  ringMesh.visible = ringDot.visible = false;
  fly.root.parent.add(ringMesh, ringDot);

  const I = {
    io: {
      cursorWorld: new V(), cursorSpeed: 0, cursorDist: 99, cursorOnGround: false,
      petting: false, carryTarget: null,
    },
    carrying: false,
    draggingFood: null,
    pointerIn: false,
  };

  const dotEl = document.getElementById('cursor-dot');
  let dotWanted = false, isTouch = false;

  let lastCursor = new V(), haveLast = false, speedSmooth = 0;
  let petHold = 0, holdTimer = -1, holdStart = { x: 0, y: 0 }, orbiting = false;
  let stroking = false;                             // touch: finger down near Mel
  let lastEvt = null, lastMoveT = performance.now();

  function setNDC(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function groundPoint(out) {
    // iterate ray ∩ horizontal plane at the local terrain height
    plane.constant = 0;
    let ok = ray.ray.intersectPlane(plane, out);
    if (!ok) return false;
    for (let i = 0; i < 3; i++) {
      plane.constant = -world.surfaceHeight(out.x, out.z, { maxY: world.groundHeight(out.x, out.z) + 1.6 });
      if (!ray.ray.intersectPlane(plane, out)) break;
    }
    return true;
  }

  function refreshCursor(e, dt) {
    setNDC(e);
    ray.setFromCamera(ndc, camera);
    const onGround = groundPoint(tmp);
    if (!onGround) { I.io.cursorOnGround = false; return; }
    const r = Math.hypot(tmp.x, tmp.z);
    I.io.cursorOnGround = r < 10.5;
    if (haveLast && dt > 0) {
      const d = tmp.distanceTo(lastCursor);
      const v = Math.min(40, d / Math.max(dt, 0.008));
      speedSmooth = THREE.MathUtils.lerp(speedSmooth, v, 0.35);
    }
    lastCursor.copy(tmp);
    haveLast = true;
    I.io.cursorWorld.copy(tmp);
  }

  const el = renderer.domElement;

  el.addEventListener('pointermove', (e) => {
    lastEvt = e; I.pointerIn = true;
    isTouch = e.pointerType === 'touch';
    if (dotEl && !isTouch) {
      dotEl.style.left = e.clientX + 'px';
      dotEl.style.top = e.clientY + 'px';
      dotWanted = true;
    }
    const now = performance.now();
    const dt = (now - lastMoveT) / 1000;
    lastMoveT = now;
    if (orbiting) { speedSmooth = 0; haveLast = false; return; }
    refreshCursor(e, dt);

    if (I.carrying) {
      // carry plane floats above the terrain — and above the pillow, dish or
      // food under the cursor, so he is never dragged through them
      const cx = I.io.cursorWorld.x, cz = I.io.cursorWorld.z;
      const y = Math.max(world.groundHeight(cx, cz) + 1.15,
        world.surfaceHeight(cx, cz, { maxY: world.groundHeight(cx, cz) + 1.6 }) + 0.7);
      plane.constant = -y;
      if (ray.ray.intersectPlane(plane, tmp2)) {
        const r = Math.hypot(tmp2.x, tmp2.z);
        if (r > 8.8) { tmp2.x *= 8.8 / r; tmp2.z *= 8.8 / r; }
        tmp2.y = y;
        I.io.carryTarget = I.io.carryTarget || new V();
        I.io.carryTarget.copy(tmp2);
      }
      if (speedSmooth > 13) {                       // too rough — he bolts
        I.carrying = false; I.io.carryTarget = null;
        fly.startle(true);
      }
    } else if (I.draggingFood) {
      const f = I.draggingFood;
      plane.constant = -f.dragY;
      if (ray.ray.intersectPlane(plane, tmp2)) {
        f.mesh.position.x = tmp2.x + f.grabOffset.x;
        f.mesh.position.z = tmp2.z + f.grabOffset.z;
        world.settleFood(f, flyOnGround() ? fly.root.position : null);
        const dFly = f.mesh.position.distanceTo(fly.root.position);
        if (speedSmooth > 9 && dFly < 3) fly.stress += 0.35;
      }
    } else if (holdTimer >= 0) {
      // cancel the pickup if the pointer wanders before the hold completes
      if (Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 26) holdTimer = -1;
    }
  });

  el.addEventListener('pointerdown', (e) => {
    lastEvt = e;
    isTouch = e.pointerType === 'touch';
    setNDC(e);
    ray.setFromCamera(ndc, camera);
    // the fly first
    const hitFly = ray.intersectObject(flyHit, false).length > 0;
    // Touch has no hover, so petting could never happen on phones: a finger
    // that comes down on or right beside Mel strokes him instead of orbiting.
    if (isTouch && flyOnGround()) {
      const g = groundPoint(tmp) ? tmp.distanceTo(fly.root.position) : 99;
      if (hitFly || g < 2.3) {
        controls.enabled = false;
        stroking = true; I.pointerIn = true; haveLast = false;
        refreshCursor(e, 0);
        if (hitFly && fly.state === 'nap') {
          fly.setState('idle');
          fly.stress = Math.min(1, fly.stress + 0.15);
        } else if (hitFly && fly.canCarry()) {
          holdTimer = 0;
          holdStart.x = e.clientX; holdStart.y = e.clientY;
        }
        return;
      }
    }
    if (hitFly && !['fly', 'land'].includes(fly.state)) {
      controls.enabled = false;
      if (fly.state === 'nap') {                     // gentle wake
        fly.setState('idle');
        fly.stress = Math.min(1, fly.stress + 0.25);
      } else if (fly.canCarry()) {
        holdTimer = 0;
        holdStart.x = e.clientX; holdStart.y = e.clientY;
      } else {
        fly.stress = Math.min(1.4, fly.stress + 0.55 + (0.45 - fly.trust) * 0.6);
      }
      return;
    }
    // then the food
    const foodMeshes = world.foods.map(f => f.mesh);
    const hits = ray.intersectObjects(foodMeshes, false);
    if (hits.length) {
      const mesh = hits[0].object;
      const f = world.foods.find(f => f.mesh === mesh);
      controls.enabled = false;
      f.dragY = hits[0].point.y;
      f.grabOffset = new V(mesh.position.x - hits[0].point.x, 0, mesh.position.z - hits[0].point.z);
      I.draggingFood = f;
      return;
    }
    orbiting = true;                                 // empty space -> camera
  });

  function release() {
    if (I.carrying) {
      I.carrying = false;
      const p = I.io.carryTarget ? I.io.carryTarget.clone() : fly.root.position.clone();
      I.io.carryTarget = null;
      fly.endCarry(p);
    }
    if (I.draggingFood) { world.settleFood(I.draggingFood, flyOnGround() ? fly.root.position : null); I.draggingFood = null; }
    holdTimer = -1;
    orbiting = false;
    if (stroking) { stroking = false; I.pointerIn = false; haveLast = false; speedSmooth = 0; }
    controls.enabled = true;
  }
  function flyOnGround() { return !['fly', 'land', 'carried', 'hop'].includes(fly.state); }
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', () => {
    I.pointerIn = false; haveLast = false; speedSmooth = 0;
    dotWanted = false;
    if (!I.carrying && !I.draggingFood) release();
  });

  I.update = function (dt) {
    // finish a pickup hold
    if (holdTimer >= 0) {
      holdTimer += dt;
      if (holdTimer > 0.33) {
        holdTimer = -1;
        if (fly.canCarry()) {
          I.carrying = true;
          fly.beginCarry();
          I.io.carryTarget = I.io.carryTarget || new V();
          I.io.carryTarget.copy(fly.root.position).y += 1.0;
        }
      }
    }
    speedSmooth *= Math.max(0, 1 - dt * 2.2);        // decay while pointer rests

    const io = I.io;
    io.cursorSpeed = speedSmooth;
    io.cursorDist = I.pointerIn && !orbiting ? io.cursorWorld.distanceTo(fly.root.position) : 99;

    // petting: close, slow, sustained, hands empty
    const petZone = io.cursorDist < 2.3 && speedSmooth > 0.15 && speedSmooth < 3.6 &&
      !I.carrying && !I.draggingFood && !orbiting && I.pointerIn;
    petHold = petZone ? petHold + dt : 0;
    io.petting = petHold > 0.4;

    // cursor ring
    const showRing = I.pointerIn && !orbiting && io.cursorOnGround && !I.carrying;
    const targetOp = showRing ? 0.55 : 0;
    ringMesh.material.opacity = THREE.MathUtils.lerp(ringMesh.material.opacity, targetOp, Math.min(1, dt * 8));
    ringDot.material.opacity = ringMesh.material.opacity * 0.8;
    ringMesh.visible = ringDot.visible = ringMesh.material.opacity > 0.01;
    if (showRing) {
      const x = io.cursorWorld.x, z = io.cursorWorld.z;
      const cap = { maxY: world.groundHeight(x, z) + 1.6 };   // moss-level props, never the glass rim
      const y = world.surfaceHeight(x, z, cap);
      const danger = speedSmooth > 6 && io.cursorDist < 5;
      const color = danger ? 0xc96a4a : io.petting ? 0xc98a2d : 0x8fae6d;
      ringMesh.material.color.setHex(color);
      ringDot.material.color.setHex(color);
      const s = 1 + Math.min(0.5, speedSmooth * 0.04);
      ringMesh.scale.setScalar(io.petting ? 0.8 : s);
      ringDot.scale.setScalar(ringMesh.scale.x);
      ringMesh.position.set(x, y, z); ringDot.position.set(x, y, z);
      world.drape(ringMesh, 0.035, cap);
      world.drape(ringDot, 0.045, cap);
    }

    // screen dot takes over wherever the moss ring can't live
    if (dotEl) dotEl.style.opacity = (dotWanted && !isTouch && !showRing) ? 1 : 0;
    return io;
  };

  return I;
};
