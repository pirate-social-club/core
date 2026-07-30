import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const mount = document.querySelector("#scene");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
mount.append(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x06050a, 0.055);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, .1, 100);
camera.position.set(0, .4, 12.5);

const crown = new THREE.Group();
scene.add(crown);

const gold = new THREE.MeshPhysicalMaterial({
  color: 0xb99a3a,
  metalness: 1,
  roughness: .2,
  clearcoat: .5,
  clearcoatRoughness: .15,
  emissive: 0x171004,
});
const darkGold = new THREE.MeshPhysicalMaterial({
  color: 0x5e4820,
  metalness: 1,
  roughness: .28,
  clearcoat: .35,
});
const gemMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xbaff21,
  emissive: 0x6d9700,
  emissiveIntensity: 2.8,
  transmission: .15,
  metalness: .05,
  roughness: .08,
});

const base = new THREE.Mesh(new THREE.TorusGeometry(2.75, .36, 24, 96), gold);
base.rotation.x = Math.PI / 2;
base.scale.y = .78;
crown.add(base);

const lowerBand = new THREE.Mesh(new THREE.TorusGeometry(2.72, .17, 16, 96), darkGold);
lowerBand.rotation.x = Math.PI / 2;
lowerBand.position.y = -.42;
lowerBand.scale.y = .78;
crown.add(lowerBand);

const pointShape = new THREE.Shape();
pointShape.moveTo(-.48, 0);
pointShape.quadraticCurveTo(-.22, 1.45, 0, 3.25);
pointShape.quadraticCurveTo(.22, 1.45, .48, 0);
pointShape.lineTo(-.48, 0);
const pointGeometry = new THREE.ExtrudeGeometry(pointShape, {
  depth: .18,
  bevelEnabled: true,
  bevelSegments: 3,
  bevelSize: .055,
  bevelThickness: .07,
});
pointGeometry.center();

for (let index = 0; index < 7; index += 1) {
  const angle = (index / 7) * Math.PI * 2;
  const point = new THREE.Mesh(pointGeometry, index % 2 ? darkGold : gold);
  point.position.set(Math.sin(angle) * 2.42, 1.28, Math.cos(angle) * 2.42);
  point.rotation.y = angle;
  point.scale.set(index % 2 ? .86 : 1.08, index % 2 ? .82 : 1.05, 1);
  crown.add(point);

  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(index % 2 ? .16 : .22, 0), gemMaterial);
  gem.position.set(Math.sin(angle) * 2.74, index % 2 ? 1.3 : 1.55, Math.cos(angle) * 2.74);
  gem.scale.y = 1.45;
  crown.add(gem);
}

const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(.42, 1), gemMaterial);
jewel.position.set(0, .15, 2.75);
jewel.scale.y = 1.45;
crown.add(jewel);

const particleCount = 480;
const positions = new Float32Array(particleCount * 3);
for (let index = 0; index < particleCount; index += 1) {
  const radius = 4 + Math.random() * 8;
  const angle = Math.random() * Math.PI * 2;
  positions[index * 3] = Math.cos(angle) * radius;
  positions[index * 3 + 1] = (Math.random() - .5) * 10;
  positions[index * 3 + 2] = Math.sin(angle) * radius - 2;
}
const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
const particles = new THREE.Points(
  particleGeometry,
  new THREE.PointsMaterial({
    color: 0xd8ff3e,
    size: .025,
    transparent: true,
    opacity: .55,
    depthWrite: false,
  }),
);
scene.add(particles);

scene.add(new THREE.HemisphereLight(0xd9d1ff, 0x09070c, 1.8));
const key = new THREE.SpotLight(0xd8ff3e, 160, 30, .5, .7, 1.4);
key.position.set(4, 7, 7);
scene.add(key);
const violet = new THREE.PointLight(0x6d36ff, 110, 24, 1.5);
violet.position.set(-5, -1, 4);
scene.add(violet);
const rim = new THREE.PointLight(0xffc75a, 85, 20, 1.6);
rim.position.set(3, 0, -5);
scene.add(rim);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  .72,
  .65,
  .78,
));

const pointer = new THREE.Vector2();
const target = new THREE.Vector2();
let dragging = false;
let previousX = 0;
let dragRotation = 0;

window.addEventListener("pointermove", (event) => {
  target.x = (event.clientX / window.innerWidth) * 2 - 1;
  target.y = (event.clientY / window.innerHeight) * 2 - 1;
  if (dragging) {
    dragRotation += (event.clientX - previousX) * .008;
    previousX = event.clientX;
  }
});
window.addEventListener("pointerdown", (event) => {
  dragging = true;
  previousX = event.clientX;
  renderer.domElement.setPointerCapture?.(event.pointerId);
});
window.addEventListener("pointerup", () => { dragging = false; });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function frame() {
  const elapsed = clock.getElapsedTime();
  pointer.lerp(target, .035);
  const narrow = window.innerWidth < 780;
  crown.position.x = narrow ? 2.15 : 3.25;
  crown.position.y = narrow ? 2.05 : .15;
  crown.scale.setScalar(narrow ? .62 : .9);
  crown.rotation.x = -.18 + pointer.y * .12;
  crown.rotation.y = dragRotation + pointer.x * .24 + (reduceMotion ? .35 : elapsed * .09);
  crown.rotation.z = -.08 - pointer.x * .04;
  particles.rotation.y = reduceMotion ? 0 : elapsed * .012;
  particles.position.y = reduceMotion ? 0 : Math.sin(elapsed * .3) * .15;
  composer.render();
  requestAnimationFrame(frame);
}
frame();
