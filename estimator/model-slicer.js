import * as THREE from "https://esm.sh/three@0.180.0";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/OBJLoader.js";
import { ThreeMFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/3MFLoader.js";
import { STLExporter } from "https://esm.sh/three@0.180.0/examples/jsm/exporters/STLExporter.js";
import { loadModel as loadUnifiedModel } from "https://esm.sh/three-slicer@0.3.2/viewer/loaders";
import { createSlicerClient } from "./vendor/three-slicer/engine/src/client.js?v=stats-only-time-v1";
import { SLICER_PROFILES } from "./slicer-config.js?v=mobile-large-parts-v2";
import { filamentDensity, filamentGrams } from "./filament-math.mjs?v=mobile-large-parts-v2";
import { slicerFilamentLength, slicerTimeSeconds } from "./slicer-result.mjs?v=mobile-large-parts-v2";
import { packPrintBeds } from "./bed-packing.mjs?v=a1-auto-beds-v1";

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

function triangleBounds(triangles) {
  const bounds = { minX:Infinity, minY:Infinity, minZ:Infinity, maxX:-Infinity, maxY:-Infinity, maxZ:-Infinity };
  for (let index = 0; index < triangles.length; index += 3) {
    bounds.minX = Math.min(bounds.minX, triangles[index]); bounds.maxX = Math.max(bounds.maxX, triangles[index]);
    bounds.minY = Math.min(bounds.minY, triangles[index + 1]); bounds.maxY = Math.max(bounds.maxY, triangles[index + 1]);
    bounds.minZ = Math.min(bounds.minZ, triangles[index + 2]); bounds.maxZ = Math.max(bounds.maxZ, triangles[index + 2]);
  }
  return bounds;
}

function plateStl(placements) {
  const group = new THREE.Group();
  for (const placement of placements) {
    const { triangles, bounds } = placement.item;
    const positioned = new Float32Array(triangles.length);
    for (let index = 0; index < triangles.length; index += 3) {
      const localX = triangles[index] - bounds.minX;
      const localY = triangles[index + 1] - bounds.minY;
      positioned[index] = placement.x + (placement.rotated ? localY : localX);
      positioned[index + 1] = placement.y + (placement.rotated ? placement.item.width - localX : localY);
      positioned[index + 2] = triangles[index + 2] - bounds.minZ;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positioned, 3));
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, meshMaterial()));
  }
  normalizeGroup(group);
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  return { binaryStl:toBinaryStl(group), dimensions:{ x:size.x, y:size.y, z:size.z } };
}

async function projectAnalysisBeds(file) {
  const buffer = await file.arrayBuffer();
  const objects = await loadUnifiedModel(file.name, buffer);
  const printable = objects.filter((object) => object?.modelPos?.length >= 9).map((object, index) => {
    const triangles = object.modelPos;
    const bounds = triangleBounds(triangles);
    return {
      name:object.name || `${file.name} object ${index + 1}`, triangles, bounds,
      width:bounds.maxX - bounds.minX, depth:bounds.maxY - bounds.minY, height:bounds.maxZ - bounds.minZ
    };
  });
  if (!printable.length) throw new Error("The 3MF project does not contain printable objects.");
  const plates = packPrintBeds(printable, { bedWidth:250, bedDepth:250, bedHeight:250, spacing:4, maximumBeds:64 });
  const largest = printable.reduce((current, item) => ({
    x:Math.max(current.x, item.width), y:Math.max(current.y, item.depth), z:Math.max(current.z, item.height)
  }), { x:0, y:0, z:0 });
  return { analysisBeds:plates.map((plate) => plateStl(plate.placements)), objectCount:printable.length, plateCount:plates.length, dimensions:largest };
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
  const loaded = await loadModelForSlicing(file);
  const group = loaded.group;
  fitViewer(group);
  return loaded;
}

export async function loadModelForSlicing(file) {
  const group = normalizeGroup(await parseModel(file));
  if (file.name.split(".").pop().toLowerCase() === "3mf") return { group, ...(await projectAnalysisBeds(file)) };
  const dimensions = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  const analysisBed = { binaryStl:toBinaryStl(group), dimensions:{ x:dimensions.x, y:dimensions.y, z:dimensions.z } };
  return { group, binaryStl:analysisBed.binaryStl, analysisBeds:[analysisBed], plateCount:1, objectCount:1, dimensions:analysisBed.dimensions };
}

export function createVirtualBoundingBoxModel(dimensions) {
  const { x, y, z } = dimensions || {};
  if (![x, y, z].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Enter valid finished dimensions before estimating printing.");
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(x, y, z), meshMaterial()));
  normalizeGroup(group);
  return { binaryStl:toBinaryStl(group), dimensions:{ x, y, z } };
}

export async function sliceModel(model, profileName, onProgress, material = "PLA") {
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
      return client.sliceStats(model.binaryStl.slice(0), process, {
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
    const filamentLengthMm = slicerFilamentLength(result);
    if (!filamentLengthMm) throw new Error("The slicer found no printable material. Check that the model is solid, has a usable scale, and is not thinner than the selected layer height.");
    const materialGrams = filamentGrams(filamentLengthMm, undefined, filamentDensity(material));
    const seconds = slicerTimeSeconds(result, globalThis.MucciGcodeTime?.parse);
    if (!seconds) throw new Error("The slicer produced toolpaths but did not return a print-time estimate.");
    onProgress?.({ stage:"Estimate ready" });
    return { gcode:"", seconds, filamentLengthMm, filamentGrams:materialGrams };
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    client.terminate();
  }
}
