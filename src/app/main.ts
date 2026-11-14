import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing app root');
if (import.meta.env.VITE_SIM_MODE === 'false') {
  throw new Error('Encore supports simulation mode only');
}
const scene = new Scene();
const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;
const renderer = new WebGLRenderer({ antialias: true });
document.body.style.margin = '0';
renderer.domElement.setAttribute('aria-label', 'Encore blank simulation canvas');
app.append(renderer.domElement);
function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);
}
window.addEventListener('resize', resize);
resize();
