/* main.js — boot, camera, lights, HUD, sound, the loop. */
(async function () {
  'use strict';

  const errbox = document.getElementById('errbox');
  function showError(msg) {
    errbox.style.display = 'block';
    errbox.textContent = 'something broke in the terrarium:\n' + msg;
    document.title = 'ERR · Fly Paradise';
  }
  window.addEventListener('error', e => showError(e.message + '\n' + (e.filename || '') + ':' + (e.lineno || '')));
  window.addEventListener('unhandledrejection', e => showError(String(e.reason)));

  const params = new URLSearchParams(location.search);
  FP.fast = params.has('fast');
  FP.freeze = params.has('freeze');
  FP.forcePet = params.has('pet');
  FP.wingsOverride = params.has('wings') ? parseFloat(params.get('wings')) : null;
  FP.flapOverride = params.has('flap') ? parseFloat(params.get('flap')) : null;

  // ---------- renderer / camera ----------
  const canvas = document.getElementById('stage');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 220);
  const CAMS = {
    default: [[12.5, 9.5, 23.0], [0, 2.4, 0]],
    front:   [[0.5, 4.5, 24.0], [0, 1.5, 0]],
    close:   [[4.0, 3.2, 9.0],  [-1, 0.8, -0.5]],
    fly:     [[2.2, 2.6, 3.6],  [-1.5, 0.7, -0.8]],
    meltop:  [[-1.45, 7.0, -0.5], [-1.5, 0.4, -0.8]],
    top:     [[0.5, 26.0, 10.0], [0, 0, 0]],
    neural:  [[13.0, 11.0, 25.0], [0, 7.6, 0]],
  };
  const camPreset = CAMS[params.get('cam')] || CAMS.default;
  camera.position.fromArray(camPreset[0]);

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.fromArray(camPreset[1]);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 55;
  controls.maxPolarAngle = 1.52;
  controls.update();

  // ---------- lights ----------
  const sun = new THREE.DirectionalLight(0xffe2b0, 1.25);
  sun.position.set(14, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xeaf2dd, 0x5c4a30, 0.85));
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.28);
  fill.position.set(-16, 8, -8);
  scene.add(fill);

  // ---------- build ----------
  const world = FP.buildWorld(scene);
  const fly = FP.createFly(scene, world);
  const brain = FP.createBrain(scene, camera);
  const interact = FP.createInteraction(renderer, camera, controls, world, fly);
  FP.debug = { scene, fly, world, brain, renderer };
  FP.rendererBackend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2-fallback';

  // trust persists between visits
  try {
    const saved = parseFloat(localStorage.getItem('fp_trust'));
    if (!isNaN(saved)) fly.trust = Math.max(fly.trust, Math.min(1, saved));
  } catch (e) { /* private windows are fine */ }
  if (FP.forcePet) fly.trust = 0.9;
  function saveTrust() {
    try { localStorage.setItem('fp_trust', fly.trust.toFixed(3)); } catch (e) { /* ok */ }
  }
  setInterval(saveTrust, 10000);
  window.addEventListener('beforeunload', saveTrust);

  // ---------- HUD ----------
  const moodText = document.getElementById('mood-text');
  const moodDot = document.getElementById('mood-dot');
  const heartsEl = document.getElementById('hearts');
  const hintEl = document.getElementById('hint');
  const neuroCaption = document.getElementById('neuro-caption');
  const neuroLine = document.getElementById('neuro-line');
  document.getElementById('neuro-count').textContent =
    `flywire fafb v783 · ${FP.FLYWIRE_BRAIN.neuron_count.toLocaleString()} measured neuron locations`;

  const HEART_PATH = 'M6 10.6C1.1 7.2 1.7 2.7 4.4 3.5c.9.3 1.4 1 1.6 1.4.2-.4.7-1.1 1.6-1.4 2.7-.8 3.3 3.7-1.6 7.1Z';
  const heartFills = [];
  for (let i = 0; i < 3; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.innerHTML = `<path class="h-bg" d="${HEART_PATH}"/><path class="h-fill" d="${HEART_PATH}"/>`;
    heartsEl.appendChild(svg);
    heartFills.push(svg.querySelector('.h-fill'));
  }

  const MOOD_DOT = {
    'startled!': '#c96a4a', 'enjoying pets': '#c98a2d', 'riding along happily': '#c98a2d',
    'fast asleep': '#8f9cc0', 'sleepy': '#8f9cc0', 'curious about you': '#c98a2d',
    'snacking': '#d89a52', 'having a sip': '#76aec2', 'peckish': '#d89a52', 'thirsty': '#76aec2',
  };

  let hintQueue = [], hintT = 0, shownHints = {};
  function hint(id, text, dur) {
    if (shownHints[id]) return;
    shownHints[id] = true;
    hintQueue.push({ text, dur: dur || 5 });
  }
  if (!params.has('shot')) {
    setTimeout(() => hint('hello', 'drag the empty air to look around — and move slowly near Mel, he’s shy'), 1800);
  }

  const CAPTIONS = {
    rest:    ['resting state', 'sparse spontaneous spiking, nothing urgent'],
    walk:    ['central complex → descending neurons', 'steering a six-legged stroll'],
    groom:   ['gnathal + leg motor circuits', 'running the grooming routine'],
    taste:   ['gustatory neurons at the proboscis', 'sugar detected — very good news'],
    drink:   ['SEZ gustatory circuits', 'clean water, approved'],
    touch:   ['bristle mechanosensors → AMMC', 'a gentle pressure, and it’s welcome'],
    carried: ['mechanosensory + wind-sensing antennae', 'riding an unfamiliar breeze'],
    flight:  ['wing motor + haltere gyroscopes', 'airborne at ≈200 wingbeats a second'],
    escape:  ['looming detectors → giant fiber', 'ESCAPE reflex fired'],
    looming: ['optic lobes', 'something large is moving fast out there'],
    curious: ['antennal + optic streams converging', 'investigating the giant visitor'],
    nap:     ['dorsal fan-shaped body', 'sleep switch engaged — traffic is quiet'],
  };
  let captionKey = '', captionCooldown = 0;

  // ---------- neural toggle ----------
  const btnNeural = document.getElementById('btn-neural');
  let neural = false, targetExposure = 1.05;
  function setNeural(v) {
    neural = v;
    document.body.classList.toggle('neural', v);
    btnNeural.classList.toggle('active', v);
    brain.setVisible(v);
    neuroCaption.classList.toggle('show', v);
    targetExposure = v ? 0.34 : 1.05;
  }
  btnNeural.addEventListener('click', () => setNeural(!neural));
  const keysHeld = {};
  window.addEventListener('keydown', e => {
    if (e.key === 'n' || e.key === 'N') setNeural(!neural);
    if (e.key === 'Escape') helpEl.classList.remove('open');
    if (e.key.startsWith('Arrow')) { keysHeld[e.key] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { delete keysHeld[e.key]; });
  window.addEventListener('blur', () => { for (const k in keysHeld) delete keysHeld[k]; });

  // arrow keys orbit the terrarium
  const sph = new THREE.Spherical();
  function keyOrbit(dt) {
    const az = (keysHeld.ArrowLeft ? 1 : 0) - (keysHeld.ArrowRight ? 1 : 0);
    const pol = (keysHeld.ArrowUp ? 1 : 0) - (keysHeld.ArrowDown ? 1 : 0);
    if (!az && !pol) return;
    const off = camera.position.clone().sub(controls.target);
    sph.setFromVector3(off);
    sph.theta += az * dt * 1.5;
    sph.phi = THREE.MathUtils.clamp(sph.phi - pol * dt * 1.1, 0.15, controls.maxPolarAngle);
    off.setFromSpherical(sph);
    camera.position.copy(controls.target).add(off);
  }
  if (params.has('neural')) setNeural(true);

  // ---------- help ----------
  const helpEl = document.getElementById('help');
  document.getElementById('btn-help').addEventListener('click', () => helpEl.classList.add('open'));
  document.getElementById('help-close').addEventListener('click', () => helpEl.classList.remove('open'));
  helpEl.addEventListener('click', e => { if (e.target === helpEl) helpEl.classList.remove('open'); });

  // ---------- sound ----------
  const btnSound = document.getElementById('btn-sound');
  const sndOn = btnSound.querySelector('.snd-on');
  const sndOff = btnSound.querySelector('.snd-off');
  let audio = null, soundOn = false, buzzGain = null;
  function initAudio() {
    if (audio) return;
    audio = new (window.AudioContext || window.webkitAudioContext)();
    // A fruit fly's wingbeat is a light, narrow buzz around 200 Hz. Keep the
    // fundamental smooth, add only a breath of harmonic, and gently wander
    // the pitch so it feels alive without turning into a tiny engine.
    const wing = audio.createOscillator();
    wing.type = 'triangle'; wing.frequency.value = 208;
    const harmonic = audio.createOscillator();
    harmonic.type = 'sine'; harmonic.frequency.value = 416;
    const wingGain = audio.createGain(); wingGain.gain.value = 0.72;
    const harmonicGain = audio.createGain(); harmonicGain.gain.value = 0.09;
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 920; lp.Q.value = 0.55;
    buzzGain = audio.createGain(); buzzGain.gain.value = 0;
    const flutter = audio.createOscillator(); flutter.type = 'sine'; flutter.frequency.value = 7.3;
    const flutterDepth = audio.createGain(); flutterDepth.gain.value = 3.2;
    flutter.connect(flutterDepth); flutterDepth.connect(wing.frequency);
    wing.connect(wingGain); wingGain.connect(lp);
    harmonic.connect(harmonicGain); harmonicGain.connect(lp);
    lp.connect(buzzGain); buzzGain.connect(audio.destination);
    wing.start(); harmonic.start(); flutter.start();
  }
  function blip(f0, f1, dur, vol) {
    if (!audio || !soundOn) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine';
    const t0 = audio.currentTime;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    if (soundOn) { initAudio(); audio.resume(); }
    btnSound.classList.toggle('active', soundOn);
    sndOn.setAttribute('opacity', soundOn ? 1 : 0);
    sndOff.setAttribute('opacity', soundOn ? 0 : 1);
  });

  // ---------- debug states for screenshots ----------
  const forceState = params.get('state');
  if (forceState) {
    setTimeout(() => {
      if (forceState === 'nap') {
        fly.root.position.set(world.pillow.x, world.pillow.worldTop, world.pillow.z);
        fly.onPillow = true; fly.perchY = world.pillow.worldTop;
      }
      if (forceState === 'eat') { fly.needs.hunger = 0.9; }
      if (forceState === 'drink') { fly.needs.thirst = 0.9; }
      fly.setState(forceState === 'eat' ? 'seekFood' : forceState === 'drink' ? 'seekWater' : forceState);
    }, 600);
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let hudT = 0, elapsed = 0;
  const headPos = new THREE.Vector3();

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    elapsed += dt;

    const io = interact.update(dt);
    if (FP.forcePet) { io.petting = true; io.cursorDist = 1; io.cursorSpeed = 1; }
    const neural = brain.step(dt, fly, io);
    io.neural = neural;
    fly.update(dt, elapsed, io);
    world.update(dt, elapsed);
    fly.headWorld(headPos);
    brain.update(dt, elapsed, neural.activity, headPos);
    keyOrbit(dt);
    controls.update();

    renderer.toneMappingExposure = THREE.MathUtils.lerp(renderer.toneMappingExposure, targetExposure, Math.min(1, dt * 2.5));

    // fly events -> sound + milestones
    for (const ev of fly.events) {
      if (ev === 'takeoff' && buzzGain && soundOn) buzzGain.gain.setTargetAtTime(0.017, audio.currentTime, 0.16);
      if (ev === 'land' && buzzGain) buzzGain.gain.setTargetAtTime(0, audio.currentTime, 0.28);
      if (ev === 'heart') blip(680, 990, 0.14, 0.035);
      if (ev === 'sip') blip(300, 210, 0.1, 0.018);
    }
    fly.events.length = 0;
    if (buzzGain && soundOn) {
      const flying = fly.state === 'fly' || fly.state === 'land';
      const target = flying ? (fly.stress > 0.6 ? 0.017 : 0.013) : 0;
      buzzGain.gain.setTargetAtTime(target, audio.currentTime, flying ? 0.18 : 0.3);
    }

    // HUD at ~5 Hz
    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.2;
      moodText.textContent = fly.mood;
      moodDot.style.background = MOOD_DOT[fly.mood] || '#7d9b62';
      for (let i = 0; i < 3; i++) {
        heartFills[i].style.opacity = Math.max(0, Math.min(1, fly.trust * 3 - i));
      }
      if (fly.trust > 0.5) hint('trust1', 'Mel is starting to trust you');
      if (fly.canCarry()) hint('carry', 'press and hold on Mel to offer him a lift');

      if (neural) {
        captionCooldown -= 0.2;
        if (fly.dominant !== captionKey && captionCooldown <= 0) {
          captionKey = fly.dominant;
          captionCooldown = 1.6;
          const c = CAPTIONS[captionKey] || CAPTIONS.rest;
          neuroLine.innerHTML = '<span class="region">' + c[0] + '</span> — ' + c[1];
        }
      }
    }

    // hints
    if (hintQueue.length && hintT <= 0) {
      const h = hintQueue.shift();
      hintEl.textContent = h.text;
      hintEl.classList.add('show');
      hintT = h.dur;
    } else if (hintT > 0) {
      hintT -= dt;
      if (hintT <= 0) hintEl.classList.remove('show');
    }

    renderer.render(scene, camera);
  }
  frame();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})();
