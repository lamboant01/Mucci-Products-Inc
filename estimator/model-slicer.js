import * as THREE from "https://esm.sh/three@0.180.0";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/OBJLoader.js";
import { ThreeMFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/3MFLoader.js";
import { STLExporter } from "https://esm.sh/three@0.180.0/examples/jsm/exporters/STLExporter.js";
import { createSlicerClient } from "./vendor/three-slicer/engine/src/client.js";
import { SLICER_PROFILES } from "./slicer-config.js";

let viewer;
let currentGroup;

function ensureViewer(container) {
  if (viewer) return viewer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10000);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5c7282, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(100, -120, 180);
  scene.add(key);
  const grid = new THREE.GridHelper(240, 12, 0x0a557b, 0x9ab9c2);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  controls.addEventListener("change", () => renderer.render(scene, camera));
  new ResizeObserver(resize).observe(container);
  resize();
  viewer = { scene, camera, controls, renderer };
  return viewer;
}

function meshMaterial() {
  return new THREE.MeshStandardMaterial({ color:0x16b8b4, roughness:0.62, metalness:0.05, side:THREE.DoubleSide });
}

function normalizeGroup(group) {
  group.traverse((child) => {
    if (!child.isMesh) return;
    child.material = meshMaterial();
    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
  });
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) throw new Error("The model does not contain printable geometry.");
  const center = box.getCenter(new THREE.Vector3());
  group.position.x -= center.x;
  group.position.y -= center.y;
  group.position.z -= box.min.z;
  group.updateMatrixWorld(true);
  return group;
}

async function stepGroup(buffer) {
  if (typeof window.occtimportjs !== "function") throw new Error("The STEP converter could not be loaded.");
  const occt = await window.occtimportjs();
  const result = occt.ReadStepFile(new Uint8Array(buffer), { linearUnit:"millimeter" });
  if (!result?.success || !result.meshes?.length) throw new Error("This STEP file could not be converted to a printable mesh.");
  const group = new THREE.Group();
  result.meshes.forEach((item) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(item.attributes.position.array, 3));
    if (item.attributes.normal?.array) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(item.attributes.normal.array, 3));
    if (item.index?.array) geometry.setIndex(item.index.array.flat ? item.index.array.flat() : item.index.array);
    group.add(new THREE.Mesh(geometry, meshMaterial()));
  });
  return group;
}

async function parseModel(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  const buffer = await file.arrayBuffer();
  if (extension === "stl") return new THREE.Group().add(new THREE.Mesh(new STLLoader().parse(buffer), meshMaterial()));
  if (extension === "obj") return new OBJLoader().parse(new TextDecoder().decode(buffer));
  if (extension === "3mf") return new ThreeMFLoader().parse(buffer);
  if (["step", "stp"].includes(extension)) return stepGroup(buffer);
  throw new Error("Choose an STL, 3MF, OBJ, STEP, or STP file.");
}

function toBinaryStl(group) {
  const exported = new STLExporter().parse(group, { binary:true });
  if (exported instanceof DataView) return exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength);
  if (exported instanceof ArrayBuffer) return exported;
  if (ArrayBuffer.isView(exported)) return exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength);
  throw new Error("The model could not be converted for slicing.");
}

function fitViewer(group) {
  const { scene, camera, controls } = viewer;
  if (currentGroup) scene.remove(currentGroup);
  currentGroup = group;
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 10);
  camera.position.set(radius * 1.35, -radius * 1.55, radius * 1.15);
  controls.target.set(0, 0, size.z * 0.42);
  camera.near = Math.max(0.01, radius / 1000);
  camera.far = radius * 20;
  camera.updateProjectionMatrix();
  controls.update();
  viewer.renderer.render(scene, camera);
}

export async function loadAndPreviewModel(file, container) {
  ensureViewer(container);
  const group = normalizeGroup(await parseModel(file));
  const binaryStl = toBinaryStl(group);
  fitViewer(group);
  const dimensions = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  return { binaryStl, dimensions:{ x:dimensions.x, y:dimensions.y, z:dimensions.z } };
}

export async function sliceModel(model, profileName, onProgress) {
  const process = SLICER_PROFILES[profileName];
  if (!process) throw new Error("Choose a valid print profile.");
  const client = createSlicerClient();
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        client.terminate();
        reject(new Error("This model took too long to slice."));
      }, 120000);
    });
    const slicing = (async () => {
      onProgress?.({ stage:"Loading slicer" });
      await client.warmup();
      onProgress?.({ stage:"Slicing model" });
      return client.slice(model.binaryStl.slice(0), process, {
        onProgress(done, total) {
          onProgress?.({ stage:`Slicing model (${Math.round(done / Math.max(total, 1) * 100)}%)` });
        }
      });
    })();
    const result = await Promise.race([
      slicing,
      timeout
    ]);
    if (result?.error) throw new Error(result.error);
    if (result?.warnings?.includes("over_bed_model")) throw new Error("The model does not fit within the print area.");
    if (!result?.gcode || !Number(result?.stats?.time_estimate)) throw new Error("The slicer did not return a usable G-code time estimate.");
    onProgress?.({ stage:"G-code ready" });
    return { gcode:result.gcode, seconds:Number(result.stats.time_estimate) };
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    client.terminate();
  }
}
