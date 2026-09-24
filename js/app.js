import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.module.js';

// The terrarium modules intentionally remain small classic scripts. Loading
// them in order preserves their simple shared FP namespace while the renderer
// itself comes from modern, module-only Three.js.
window.THREE = { ...THREE, OrbitControls };

const modules = [
  './flymodel.data.js',
  './brain.data.js',
  './world.js',
  './fly.js',
  './brain.js',
  './interact.js',
  './main.js',
];

try {
  for (const src of modules) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(src, import.meta.url).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }
} catch (err) {
  // main.js (which normally reports errors) never ran, so say so here
  const box = document.getElementById('errbox');
  if (box) {
    box.style.display = 'block';
    box.textContent = 'something broke in the terrarium:\n' + err.message;
  }
  throw err;
}
