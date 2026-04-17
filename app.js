import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import polygonClipping from 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';
import { CSG } from 'https://cdn.jsdelivr.net/npm/three-csg-ts@3.2.0/+esm';

// ─── State ───────────────────────────────────────────────────────────
const state = {
  currentPlane: 'XY',
  viewMode: '2d',          // '2d' or '3d'
  currentTool: null,
  gridSnap: true,
  gridVisible: true,
  sketches: [],
  selectedSketch: null,
  drawingPoints: [],
  drawStart: null,
  drawPreview: null,
  polygonPreviewLine: null,
  regionCandidates: [],
  selectedRegionIds: new Set(),
  regionPickCycle: { key: null, index: 0 },
  solids: [],
  selectedSolidIds: new Set(),
  solidSelectionOrder: [],
  selectedSolidId: null,
  selectedFace: null,
  customPlanes: {},
  nextWorkPlaneId: 1,
  nextSolidId: 1,
  nextId: 1,
};

const BASE_PLANE_FRAMES = {
  XY: {
    id: 'XY',
    label: 'XY',
    origin: [0, 0, 0],
    ex: [1, 0, 0],
    ey: [0, 1, 0],
    ez: [0, 0, 1],
    gridKey: 'XY',
  },
  XZ: {
    id: 'XZ',
    label: 'XZ',
    origin: [0, 0, 0],
    ex: [1, 0, 0],
    ey: [0, 0, 1],
    ez: [0, 1, 0],
    gridKey: 'XZ',
  },
  YZ: {
    id: 'YZ',
    label: 'YZ',
    origin: [0, 0, 0],
    ex: [0, 1, 0],
    ey: [0, 0, 1],
    ez: [1, 0, 0],
    gridKey: 'YZ',
  },
};

function vecFromArray(arr) {
  return new THREE.Vector3(arr[0], arr[1], arr[2]);
}

function arrayFromVec(v) {
  return [v.x, v.y, v.z];
}

function resolvePlaneFrame(planeId = state.currentPlane) {
  return BASE_PLANE_FRAMES[planeId] ?? state.customPlanes[planeId] ?? null;
}

function getPlaneLabel(planeId = state.currentPlane) {
  return resolvePlaneFrame(planeId)?.label ?? String(planeId);
}

function ensureCurrentPlaneValid() {
  if (!resolvePlaneFrame(state.currentPlane)) {
    state.currentPlane = 'XY';
  }
}

function setMeshToPlaneFrame(mesh, planeId) {
  const frame = resolvePlaneFrame(planeId);
  if (!frame) return;
  const ex = vecFromArray(frame.ex);
  const ey = vecFromArray(frame.ey);
  const ez = vecFromArray(frame.ez);
  const origin = vecFromArray(frame.origin);
  const matrix = new THREE.Matrix4().makeBasis(ex, ey, ez);
  mesh.quaternion.setFromRotationMatrix(matrix);
  mesh.position.copy(origin);
}

function registerCustomPlaneFromFrame(frame) {
  const id = `WP${state.nextWorkPlaneId++}`;
  state.customPlanes[id] = {
    id,
    label: `Face ${state.nextWorkPlaneId - 1}`,
    origin: arrayFromVec(frame.origin),
    ex: arrayFromVec(frame.ex),
    ey: arrayFromVec(frame.ey),
    ez: arrayFromVec(frame.ez),
    gridKey: null,
  };
  return id;
}

// ─── Three.js Setup ──────────────────────────────────────────────────
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0xffffff);

const scene = new THREE.Scene();

// Perspective camera (3D view)
const perspCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
perspCamera.position.set(15, 15, 15);
perspCamera.lookAt(0, 0, 0);

// Orthographic camera (2D plane views)
const ORTHO_FRUSTUM = 15;
const orthoCamera = new THREE.OrthographicCamera(
  -ORTHO_FRUSTUM, ORTHO_FRUSTUM,
  ORTHO_FRUSTUM, -ORTHO_FRUSTUM,
  0.1, 1000
);

let activeCamera = orthoCamera;

const controls = new OrbitControls(activeCamera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.target.set(0, 0, 0);

// ─── Lighting ────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// ─── Axis Helper ─────────────────────────────────────────────────────
const axesHelper = new THREE.AxesHelper(50);
scene.add(axesHelper);

// ─── Grids ───────────────────────────────────────────────────────────
const GRID_SIZE = 40;
const GRID_DIVISIONS = 40;
const grids = {};

function createGrid(plane) {
  const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0xbbbbbb, 0xe0e0e0);
  grid.material.opacity = 0.8;
  grid.material.transparent = true;

  if (plane === 'XY') {
    grid.rotation.x = Math.PI / 2;
  } else if (plane === 'YZ') {
    grid.rotation.z = Math.PI / 2;
  }

  return grid;
}

grids.XY = createGrid('XY');
grids.XZ = createGrid('XZ');
grids.YZ = createGrid('YZ');
Object.values(grids).forEach(g => scene.add(g));

const planeHighlightGeo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
const planeHighlightMat = new THREE.MeshBasicMaterial({
  color: 0x4a6cf7,
  transparent: true,
  opacity: 0.015,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const planeHighlight = new THREE.Mesh(planeHighlightGeo, planeHighlightMat);
scene.add(planeHighlight);

function updatePlaneHighlight() {
  setMeshToPlaneFrame(planeHighlight, state.currentPlane);
}
updatePlaneHighlight();

// ─── Raycasting plane (invisible, for mouse projection) ─────────────
const rayPlaneGeo = new THREE.PlaneGeometry(200, 200);
const rayPlaneMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
const rayPlaneMesh = new THREE.Mesh(rayPlaneGeo, rayPlaneMat);
scene.add(rayPlaneMesh);

function updateRayPlane() {
  setMeshToPlaneFrame(rayPlaneMesh, state.currentPlane);
}
updateRayPlane();

// ─── Camera / View Switching ─────────────────────────────────────────
function snapCameraToPlane(plane) {
  const frame = resolvePlaneFrame(plane);
  if (!frame) return;
  state.viewMode = '2d';
  state.currentPlane = plane;
  activeCamera = orthoCamera;
  controls.object = orthoCamera;

  controls.enableRotate = false;
  controls.enablePan = true;
  controls.enableZoom = true;

  const D = 50;
  const origin = vecFromArray(frame.origin);
  const normal = vecFromArray(frame.ez);
  const up = vecFromArray(frame.ey);
  controls.target.copy(origin);
  orthoCamera.position.copy(origin.clone().addScaledVector(normal, D));
  orthoCamera.up.copy(up);
  orthoCamera.lookAt(origin);
  controls.update();

  updatePlaneHighlight();
  updateRayPlane();

  // Show only the active grid in 2D mode
  const gridKey = frame.gridKey;
  Object.entries(grids).forEach(([key, g]) => {
    g.visible = state.gridVisible && !!gridKey && key === gridKey;
  });

  document.getElementById('view-badge').textContent = `${getPlaneLabel(plane)} Plane`;
  document.getElementById('status-plane').textContent = `Plane: ${getPlaneLabel(plane)}`;
  refreshExtrusionRegions();
}

function switchTo3D() {
  state.viewMode = '3d';
  activeCamera = perspCamera;
  controls.object = perspCamera;

  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.target.set(0, 0, 0);

  perspCamera.position.set(15, 15, 15);
  perspCamera.lookAt(0, 0, 0);
  controls.update();

  Object.values(grids).forEach(g => {
    g.visible = state.gridVisible;
  });

  document.getElementById('view-badge').textContent = '3D View';
  document.getElementById('status-plane').textContent = `Plane: ${getPlaneLabel(state.currentPlane)}`;
  refreshExtrusionRegions();
}

function updateOrthoAspect() {
  const container = document.getElementById('viewport-container');
  const aspect = container.clientWidth / container.clientHeight;
  orthoCamera.left = -ORTHO_FRUSTUM * aspect;
  orthoCamera.right = ORTHO_FRUSTUM * aspect;
  orthoCamera.top = ORTHO_FRUSTUM;
  orthoCamera.bottom = -ORTHO_FRUSTUM;
  orthoCamera.updateProjectionMatrix();
}

// ─── Sketch Group ────────────────────────────────────────────────────
const sketchGroup = new THREE.Group();
scene.add(sketchGroup);
const regionPreviewGroup = new THREE.Group();
scene.add(regionPreviewGroup);
const solidsGroup = new THREE.Group();
scene.add(solidsGroup);
let faceSelectionOverlay = null;

// ─── Utility: Map 3D point to 2D coords on current plane ────────────
function to2D(point3D, plane) {
  const frame = resolvePlaneFrame(plane);
  if (!frame) return { u: 0, v: 0 };
  const origin = vecFromArray(frame.origin);
  const ex = vecFromArray(frame.ex);
  const ey = vecFromArray(frame.ey);
  const rel = point3D.clone().sub(origin);
  return { u: rel.dot(ex), v: rel.dot(ey) };
}

function to3D(u, v, plane) {
  const frame = resolvePlaneFrame(plane);
  if (!frame) return new THREE.Vector3();
  const origin = vecFromArray(frame.origin);
  const ex = vecFromArray(frame.ex);
  const ey = vecFromArray(frame.ey);
  return origin.clone().addScaledVector(ex, u).addScaledVector(ey, v);
}

function snapToGrid(val, gridSize = 1) {
  return state.gridSnap ? Math.round(val / gridSize) * gridSize : val;
}

function getMouseOnPlane(event) {
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, activeCamera);
  const intersects = raycaster.intersectObject(rayPlaneMesh);
  if (intersects.length === 0) return null;

  const pt = intersects[0].point;
  const coords2d = to2D(pt, state.currentPlane);
  coords2d.u = snapToGrid(coords2d.u);
  coords2d.v = snapToGrid(coords2d.v);
  return coords2d;
}

function getPointerNDC(event) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
}

function closeRing(points) {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, [first[0], first[1]]];
}

function sketchToRing(sketch, circleSegments = 72) {
  if (sketch.type === 'rectangle') {
    const { u1, v1, u2, v2 } = sketch.data;
    return closeRing([
      [u1, v1],
      [u2, v1],
      [u2, v2],
      [u1, v2],
    ]);
  }
  if (sketch.type === 'circle') {
    const { cu, cv, radius } = sketch.data;
    const ring = [];
    for (let i = 0; i < circleSegments; i++) {
      const a = (i / circleSegments) * Math.PI * 2;
      ring.push([cu + Math.cos(a) * radius, cv + Math.sin(a) * radius]);
    }
    return closeRing(ring);
  }
  if (sketch.type === 'polygon') {
    const ring = sketch.data.points.map((p) => [p.u, p.v]);
    return closeRing(ring);
  }
  return [];
}

function isNonEmptyMultiPolygon(mp) {
  return Array.isArray(mp) && mp.length > 0;
}

function ringSignedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function polygonAreaFromRings(rings) {
  if (!rings.length) return 0;
  let total = Math.abs(ringSignedArea(rings[0]));
  for (let i = 1; i < rings.length; i++) {
    total -= Math.abs(ringSignedArea(rings[i]));
  }
  return Math.max(0, total);
}

function centroidFromRing(ring) {
  let cx = 0;
  let cy = 0;
  let areaTerm = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    areaTerm += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const area = areaTerm / 2;
  if (Math.abs(area) < 1e-8) return { u: ring[0][0], v: ring[0][1] };
  return { u: cx / (6 * area), v: cy / (6 * area) };
}

function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > pt.v) !== (yj > pt.v))
      && (pt.u < (xj - xi) * (pt.v - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInRegion(region, pt) {
  for (const rings of region.polygons) {
    if (!rings.length) continue;
    if (!pointInRing(pt, rings[0])) continue;
    let inHole = false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(pt, rings[i])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

function buildRegionPartitionsForPlane(plane) {
  const planeSketches = state.sketches.filter((s) => s.plane === plane);
  if (!planeSketches.length) return [];

  let cells = [];
  for (const sketch of planeSketches) {
    const ring = sketchToRing(sketch);
    if (ring.length < 4) continue;
    const shapeMp = [[ring]];
    let remaining = shapeMp;
    const nextCells = [];

    for (const cell of cells) {
      const overlap = polygonClipping.intersection(cell.geom, shapeMp);
      if (isNonEmptyMultiPolygon(overlap)) {
        nextCells.push({
          geom: overlap,
          mask: [...cell.mask, sketch.id],
        });
      }

      const cellOnly = polygonClipping.difference(cell.geom, shapeMp);
      if (isNonEmptyMultiPolygon(cellOnly)) {
        nextCells.push({
          geom: cellOnly,
          mask: [...cell.mask],
        });
      }

      if (isNonEmptyMultiPolygon(remaining)) {
        const rem = polygonClipping.difference(remaining, cell.geom);
        remaining = isNonEmptyMultiPolygon(rem) ? rem : [];
      }
    }

    if (isNonEmptyMultiPolygon(remaining)) {
      nextCells.push({ geom: remaining, mask: [sketch.id] });
    }
    cells = nextCells;
  }

  const regions = [];
  let rid = 1;
  for (const cell of cells) {
    for (const polygonRings of cell.geom) {
      const area = polygonAreaFromRings(polygonRings);
      if (area < 1e-4) continue;
      const center = centroidFromRing(polygonRings[0]);
      regions.push({
        id: `r${rid++}`,
        plane,
        polygons: [polygonRings],
        mask: [...cell.mask],
        area,
        centroid: center,
      });
    }
  }
  return regions.sort((a, b) => a.area - b.area);
}

function clearRegionPreviews() {
  while (regionPreviewGroup.children.length) {
    const child = regionPreviewGroup.children[0];
    regionPreviewGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
}

function shapeFromRings(rings) {
  const outer = rings[0];
  const shape = new THREE.Shape();
  shape.moveTo(outer[0][0], outer[0][1]);
  for (let i = 1; i < outer.length; i++) {
    shape.lineTo(outer[i][0], outer[i][1]);
  }
  for (let h = 1; h < rings.length; h++) {
    const holeRing = rings[h];
    const hole = new THREE.Path();
    hole.moveTo(holeRing[0][0], holeRing[0][1]);
    for (let i = 1; i < holeRing.length; i++) {
      hole.lineTo(holeRing[i][0], holeRing[i][1]);
    }
    shape.holes.push(hole);
  }
  return shape;
}

function getPlaneAxes(plane) {
  const frame = resolvePlaneFrame(plane);
  if (!frame) {
    return {
      ex: new THREE.Vector3(1, 0, 0),
      ey: new THREE.Vector3(0, 1, 0),
      ez: new THREE.Vector3(0, 0, 1),
    };
  }
  return {
    ex: vecFromArray(frame.ex),
    ey: vecFromArray(frame.ey),
    ez: vecFromArray(frame.ez),
  };
}

function applyPlaneTransformToGeometry(geometry, plane, normalOffset = 0) {
  const axes = getPlaneAxes(plane);
  const matrix = new THREE.Matrix4().makeBasis(axes.ex, axes.ey, axes.ez);
  geometry.applyMatrix4(matrix);
  const frame = resolvePlaneFrame(plane);
  if (frame) {
    geometry.translate(frame.origin[0], frame.origin[1], frame.origin[2]);
  }
  if (normalOffset !== 0) {
    geometry.translate(
      axes.ez.x * normalOffset,
      axes.ez.y * normalOffset,
      axes.ez.z * normalOffset
    );
  }
}

function refreshExtrusionRegions() {
  clearRegionPreviews();
  state.regionCandidates = [];
  if (state.currentTool !== 'extrude-select') return;

  const regions = buildRegionPartitionsForPlane(state.currentPlane);
  state.regionCandidates = regions;
  const validIds = new Set(regions.map((r) => r.id));
  state.selectedRegionIds = new Set(
    [...state.selectedRegionIds].filter((id) => validIds.has(id))
  );

  for (const region of regions) {
    const isSelected = state.selectedRegionIds.has(region.id);
    for (const polygonRings of region.polygons) {
      const shape = shapeFromRings(polygonRings);
      const geo = new THREE.ShapeGeometry(shape);
      applyPlaneTransformToGeometry(geo, state.currentPlane, 0.01);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: isSelected ? 0xf59e0b : 0x22c55e,
          transparent: true,
          opacity: isSelected ? 0.42 : 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      mesh.userData.regionId = region.id;
      regionPreviewGroup.add(mesh);
    }
  }
  setStatus(
    `Select regions: ${regions.length} candidate(s), ${state.selectedRegionIds.size} selected`
  );
}

function pickRegionAt(coords) {
  const hits = state.regionCandidates.filter((r) => pointInRegion(r, coords));
  if (!hits.length) return null;
  hits.sort((a, b) => a.area - b.area);
  const key = `${coords.u.toFixed(3)},${coords.v.toFixed(3)}`;
  if (state.regionPickCycle.key !== key) {
    state.regionPickCycle = { key, index: 0 };
  } else {
    state.regionPickCycle.index = (state.regionPickCycle.index + 1) % hits.length;
  }
  return hits[state.regionPickCycle.index];
}

function extrudeRegion(region, depth) {
  if (!region || !Number.isFinite(depth) || Math.abs(depth) < 1e-6) return;
  const colorHex = new THREE.Color().setHSL(Math.random(), 0.55, 0.55).getHex();
  const mesh = buildExtrudedMeshForRegion(region, depth, colorHex);
  if (!mesh) return;
  addSolidFromMesh(mesh, { color: colorHex });
}

function extrudeSelectedRegions() {
  if (state.selectedRegionIds.size === 0) {
    setStatus('Select at least one region first.');
    return;
  }
  const input = window.prompt('Extrusion depth (positive or negative):', '5');
  if (input === null) return;
  const depth = Number(input);
  if (!Number.isFinite(depth) || Math.abs(depth) < 1e-6) {
    setStatus('Invalid extrusion depth');
    return;
  }
  const selectedRegions = state.regionCandidates.filter((r) => state.selectedRegionIds.has(r.id));
  if (!selectedRegions.length) {
    setStatus('Selected regions are no longer valid; reselect and try again.');
    return;
  }

  const colorHex = new THREE.Color().setHSL(Math.random(), 0.55, 0.55).getHex();
  const regionMeshes = selectedRegions
    .map((region) => buildExtrudedMeshForRegion(region, depth, colorHex))
    .filter(Boolean);

  if (!regionMeshes.length) {
    setStatus('Could not build extrusion geometry from selected regions.');
    return;
  }

  let resultMesh = regionMeshes[0];
  for (let i = 1; i < regionMeshes.length; i++) {
    resultMesh = CSG.union(resultMesh, regionMeshes[i]);
  }
  addSolidFromMesh(resultMesh, { color: colorHex });

  const count = selectedRegions.length;
  state.selectedRegionIds.clear();
  refreshExtrusionRegions();
  setStatus(`Extruded ${count} region${count === 1 ? '' : 's'} by ${depth}`);
  switchTo3D();
  document.querySelectorAll('.plane-btn').forEach((b) => b.classList.remove('active'));
  const btn3d = document.querySelector('.plane-btn[data-plane="3D"]');
  if (btn3d) btn3d.classList.add('active');
}

function buildExtrudedMeshForRegion(region, depth, colorHex) {
  if (!region || !Number.isFinite(depth) || Math.abs(depth) < 1e-6) return null;
  const material = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.15,
    roughness: 0.7,
  });

  let resultMesh = null;
  for (const polygonRings of region.polygons) {
    const shape = shapeFromRings(polygonRings);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      curveSegments: 48,
      steps: 1,
    });
    applyPlaneTransformToGeometry(geo, region.plane, 0);
    const partMesh = new THREE.Mesh(geo, material);
    resultMesh = resultMesh ? CSG.union(resultMesh, partMesh) : partMesh;
  }
  return resultMesh;
}

function addSolidFromMesh(mesh, { color }) {
  if (!mesh?.geometry) return null;
  const resultId = state.nextSolidId++;
  const geometryData = geometryToData(mesh.geometry);
  const record = {
    id: resultId,
    color,
    geometryData,
  };
  state.solids.push(record);
  buildSolidMesh(record);
  return record;
}

function clearSolidsVisuals() {
  clearFaceHighlight();
  while (solidsGroup.children.length) {
    const child = solidsGroup.children[0];
    solidsGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
}

function geometryToData(geometry) {
  const g = geometry.clone();
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const norm = g.getAttribute('normal');
  return {
    positions: Array.from(pos.array),
    normals: norm ? Array.from(norm.array) : null,
    index: g.index ? Array.from(g.index.array) : null,
  };
}

function geometryFromData(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  if (data.normals && data.normals.length === data.positions.length) {
    g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  } else {
    g.computeVertexNormals();
  }
  if (data.index && data.index.length) {
    g.setIndex(data.index);
  }
  return g;
}

function buildSolidMesh(record) {
  let geo;
  if (record.geometryData) {
    geo = geometryFromData(record.geometryData);
  } else {
    const shape = shapeFromRings(record.polygonRings);
    geo = new THREE.ExtrudeGeometry(shape, {
      depth: record.depth,
      bevelEnabled: false,
      curveSegments: 48,
      steps: 1,
    });
    applyPlaneTransformToGeometry(geo, record.plane, 0);
  }
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: record.color ?? 0x64748b,
      metalness: 0.15,
      roughness: 0.7,
    })
  );
  mesh.userData.solidId = record.id;
  solidsGroup.add(mesh);
}

function rebuildSolidsVisuals() {
  clearSolidsVisuals();
  for (const solid of state.solids) {
    buildSolidMesh(solid);
  }
  updateSolidSelectionVisuals();
}

function clearFaceHighlight() {
  if (!faceSelectionOverlay) return;
  scene.remove(faceSelectionOverlay);
  if (faceSelectionOverlay.geometry) faceSelectionOverlay.geometry.dispose();
  if (faceSelectionOverlay.material) faceSelectionOverlay.material.dispose();
  faceSelectionOverlay = null;
}

function updateSolidSelectionVisuals() {
  for (const mesh of solidsGroup.children) {
    const mat = mesh.material;
    if (!mat || !mat.isMeshStandardMaterial) continue;
    const solidId = mesh.userData.solidId;
    const selected = state.selectedSolidIds.has(solidId);
    const isPrimary = solidId === state.selectedSolidId;
    mat.emissive.setHex(selected ? 0x2244aa : 0x000000);
    mat.emissiveIntensity = isPrimary ? 0.45 : selected ? 0.24 : 0;
  }
}

function showFaceHighlight(intersection) {
  clearFaceHighlight();
  if (!intersection?.face || !intersection.object?.geometry) return;
  const geometry = intersection.object.geometry;
  const position = geometry.attributes.position;
  if (!position) return;

  const ia = intersection.face.a;
  const ib = intersection.face.b;
  const ic = intersection.face.c;
  const a = new THREE.Vector3().fromBufferAttribute(position, ia).applyMatrix4(intersection.object.matrixWorld);
  const b = new THREE.Vector3().fromBufferAttribute(position, ib).applyMatrix4(intersection.object.matrixWorld);
  const c = new THREE.Vector3().fromBufferAttribute(position, ic).applyMatrix4(intersection.object.matrixWorld);
  const edgeGeo = new THREE.BufferGeometry().setFromPoints([a, b, c, a]);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffa500 });
  faceSelectionOverlay = new THREE.Line(edgeGeo, edgeMat);
  scene.add(faceSelectionOverlay);
}

function pickSolidIntersection(event) {
  if (solidsGroup.children.length === 0) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(getPointerNDC(event), activeCamera);
  const intersects = raycaster.intersectObjects(solidsGroup.children, true);
  return intersects.length ? intersects[0] : null;
}

function getSolidMeshById(id) {
  return solidsGroup.children.find((m) => m.userData.solidId === id) ?? null;
}

function prepareMeshForCSG(sourceMesh, { flipWinding = false } = {}) {
  if (!sourceMesh?.geometry) return null;

  const prepared = sourceMesh.clone();
  let geo = sourceMesh.geometry.clone();
  if (geo.index) geo = geo.toNonIndexed();
  geo.applyMatrix4(sourceMesh.matrixWorld);

  const pos = geo.getAttribute('position');
  if (flipWinding && pos) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      pos.setXYZ(i, a.x, a.y, a.z);
      pos.setXYZ(i + 1, c.x, c.y, c.z);
      pos.setXYZ(i + 2, b.x, b.y, b.z);
    }
    pos.needsUpdate = true;
  }

  geo.deleteAttribute('normal');
  geo.computeVertexNormals();

  prepared.geometry = geo;
  prepared.position.set(0, 0, 0);
  prepared.rotation.set(0, 0, 0);
  prepared.scale.set(1, 1, 1);
  prepared.matrix.identity();
  prepared.matrixWorld.identity();
  prepared.updateMatrixWorld(true);
  return prepared;
}

function meshVolume(geometry) {
  if (!geometry) return 0;
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = geo.getAttribute('position');
  if (!pos || pos.count < 3) return 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(volume);
}

function buildPlaneFrameFromIntersection(intersection) {
  if (!intersection?.face || !intersection.object?.geometry?.attributes?.position) return null;
  const geometry = intersection.object.geometry;
  const position = geometry.attributes.position;
  const ia = intersection.face.a;
  const ib = intersection.face.b;
  const ic = intersection.face.c;
  const a = new THREE.Vector3().fromBufferAttribute(position, ia).applyMatrix4(intersection.object.matrixWorld);
  const b = new THREE.Vector3().fromBufferAttribute(position, ib).applyMatrix4(intersection.object.matrixWorld);
  const c = new THREE.Vector3().fromBufferAttribute(position, ic).applyMatrix4(intersection.object.matrixWorld);

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld);
  const ez = intersection.face.normal.clone().applyMatrix3(normalMatrix).normalize();
  if (ez.lengthSq() < 1e-8) return null;

  const edge = b.clone().sub(a);
  edge.addScaledVector(ez, -edge.dot(ez));
  if (edge.lengthSq() < 1e-8) {
    edge.copy(c.clone().sub(a));
    edge.addScaledVector(ez, -edge.dot(ez));
  }
  if (edge.lengthSq() < 1e-8) return null;

  const ex = edge.normalize();
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
  const correctedEx = new THREE.Vector3().crossVectors(ey, ez).normalize();
  const origin = a.clone().add(b).add(c).multiplyScalar(1 / 3);
  return { origin, ex: correctedEx, ey, ez };
}

function enterFaceSketchPlane() {
  if (!state.selectedFace?.planeFrame) {
    setStatus('Select a solid face in 3D first.');
    return false;
  }
  if (!state.selectedFace.workPlaneId || !resolvePlaneFrame(state.selectedFace.workPlaneId)) {
    state.selectedFace.workPlaneId = registerCustomPlaneFromFrame(state.selectedFace.planeFrame);
  }
  snapCameraToPlane(state.selectedFace.workPlaneId);
  document.querySelectorAll('.plane-btn').forEach((b) => b.classList.remove('active'));
  return true;
}

function selectSolidFromIntersection(intersection, additive = false) {
  const solidId = intersection?.object?.userData?.solidId ?? null;
  const planeFrame = buildPlaneFrameFromIntersection(intersection);
  state.selectedSketch = null;
  if (!solidId) {
    if (!additive) {
      state.selectedSolidIds.clear();
      state.solidSelectionOrder = [];
      state.selectedSolidId = null;
      state.selectedFace = null;
      clearFaceHighlight();
      updateSolidSelectionVisuals();
    }
    return;
  }

  if (additive) {
    if (state.selectedSolidIds.has(solidId)) {
      state.selectedSolidIds.delete(solidId);
      state.solidSelectionOrder = state.solidSelectionOrder.filter((id) => id !== solidId);
      if (state.selectedSolidId === solidId) {
        state.selectedSolidId = state.solidSelectionOrder[state.solidSelectionOrder.length - 1] ?? null;
      }
      state.selectedFace = null;
      clearFaceHighlight();
    } else {
      state.selectedSolidIds.add(solidId);
      state.solidSelectionOrder = state.solidSelectionOrder.filter((id) => id !== solidId);
      state.solidSelectionOrder.push(solidId);
      state.selectedSolidId = solidId;
      state.selectedFace = {
        solidId,
        faceIndex: intersection.faceIndex ?? null,
        planeFrame,
        workPlaneId: null,
      };
      showFaceHighlight(intersection);
    }
  } else {
    state.selectedSolidIds = new Set([solidId]);
    state.solidSelectionOrder = [solidId];
    state.selectedSolidId = solidId;
    state.selectedFace = {
      solidId,
      faceIndex: intersection.faceIndex ?? null,
      planeFrame,
      workPlaneId: null,
    };
    showFaceHighlight(intersection);
  }

  const count = state.selectedSolidIds.size;
  setStatus(`Selected solid ${solidId} (${count} selected)`);
  updateSolidSelectionVisuals();
}

function performBooleanOperation(op) {
  if (state.selectedSolidIds.size !== 2) {
    setStatus('Select exactly 2 solids in 3D (Shift/Cmd+click for multi-select).');
    return;
  }
  const selectedOrdered = state.solidSelectionOrder.filter((id) => state.selectedSolidIds.has(id));
  if (selectedOrdered.length !== 2) {
    setStatus('Selection order invalid; reselect the two solids.');
    return;
  }
  const [aId, bId] = selectedOrdered;
  const meshA = getSolidMeshById(aId);
  const meshB = getSolidMeshById(bId);
  if (!meshA || !meshB) {
    setStatus('Could not find selected solids.');
    return;
  }
  meshA.updateMatrixWorld(true);
  meshB.updateMatrixWorld(true);

  let resultMesh;
  try {
    const preparedA = prepareMeshForCSG(meshA);
    const preparedB = prepareMeshForCSG(meshB);
    if (!preparedA || !preparedB) {
      setStatus('Could not prepare selected solids for boolean.');
      return;
    }

    resultMesh = op === 'union'
      ? CSG.union(preparedA, preparedB)
      : CSG.subtract(preparedA, preparedB);

    if (op === 'subtract') {
      const aVolume = meshVolume(preparedA.geometry);
      const resultVolume = meshVolume(resultMesh?.geometry);
      const overlapMesh = CSG.intersect(prepareMeshForCSG(meshA), prepareMeshForCSG(meshB));
      const overlapVolume = meshVolume(overlapMesh?.geometry);
      const overlapExists = overlapVolume > 1e-5;
      const noMaterialRemoved = aVolume > 1e-5 && Math.abs(resultVolume - aVolume) < Math.max(aVolume * 1e-4, 1e-5);

      // Some extrusions can have inverted winding; retry with flipped cutter if overlap exists but cut failed.
      if (overlapExists && noMaterialRemoved) {
        const retryA = prepareMeshForCSG(meshA);
        const retryB = prepareMeshForCSG(meshB, { flipWinding: true });
        if (retryA && retryB) {
          const retryMesh = CSG.subtract(retryA, retryB);
          const retryVolume = meshVolume(retryMesh?.geometry);
          if (retryVolume < resultVolume - 1e-6) {
            resultMesh = retryMesh;
          }
        }
      }
    }
  } catch (err) {
    setStatus(`Boolean ${op} failed`);
    return;
  }
  if (!resultMesh?.geometry) {
    setStatus(`Boolean ${op} produced no geometry`);
    return;
  }
  const resultId = state.nextSolidId++;
  const baseColor = state.solids.find((s) => s.id === aId)?.color ?? 0x64748b;
  const resultRecord = {
    id: resultId,
    color: baseColor,
    geometryData: geometryToData(resultMesh.geometry),
  };

  state.solids = state.solids.filter((s) => s.id !== aId && s.id !== bId);
  state.solids.push(resultRecord);
  state.selectedSolidIds = new Set([resultId]);
  state.solidSelectionOrder = [resultId];
  state.selectedSolidId = resultId;
  state.selectedFace = null;
  clearFaceHighlight();
  rebuildSolidsVisuals();
  setStatus(op === 'union' ? 'Union completed' : `Subtracted solid ${bId} from ${aId}`);
}

// ─── Shape Rendering ─────────────────────────────────────────────────
const SHAPE_COLOR = 0x4a6cf7;
const SHAPE_COLOR_SELECTED = 0xf44336;

function createShapeMesh(sketch) {
  const group = new THREE.Group();
  group.userData.sketchId = sketch.id;

  if (sketch.type === 'rectangle') {
    const { u1, v1, u2, v2 } = sketch.data;
    const w = Math.abs(u2 - u1);
    const h = Math.abs(v2 - v1);
    const cu = (u1 + u2) / 2;
    const cv = (v1 + v2) / 2;

    const points = [
      to3D(u1, v1, sketch.plane),
      to3D(u2, v1, sketch.plane),
      to3D(u2, v2, sketch.plane),
      to3D(u1, v2, sketch.plane),
      to3D(u1, v1, sketch.plane),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({ color: SHAPE_COLOR, linewidth: 2 });
    group.add(new THREE.Line(lineGeo, lineMat));

  } else if (sketch.type === 'circle') {
    const { cu, cv, radius } = sketch.data;
    const segments = 64;

    const circlePoints = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const u = cu + Math.cos(angle) * radius;
      const v = cv + Math.sin(angle) * radius;
      circlePoints.push(to3D(u, v, sketch.plane));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(circlePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: SHAPE_COLOR, linewidth: 2 });
    group.add(new THREE.Line(lineGeo, lineMat));

  } else if (sketch.type === 'polygon') {
    const pts = sketch.data.points;
    if (pts.length < 2) return group;

    const linePoints = pts.map(p => to3D(p.u, p.v, sketch.plane));
    linePoints.push(linePoints[0].clone());
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: SHAPE_COLOR, linewidth: 2 });
    group.add(new THREE.Line(lineGeo, lineMat));
  }

  return group;
}

function rebuildSketchVisuals() {
  while (sketchGroup.children.length) {
    sketchGroup.remove(sketchGroup.children[0]);
  }
  for (const sketch of state.sketches) {
    const mesh = createShapeMesh(sketch);
    if (state.selectedSketch && state.selectedSketch.id === sketch.id) {
      mesh.traverse(child => {
        if (child.material && child.material.color) {
          child.material.color.set(SHAPE_COLOR_SELECTED);
        }
      });
    }
    sketchGroup.add(mesh);
  }
  updateSketchList();
  refreshExtrusionRegions();
}

// ─── Drawing Logic ───────────────────────────────────────────────────
function startDrawing(coords) {
  if (state.currentTool === 'rectangle' || state.currentTool === 'circle') {
    state.drawStart = { u: coords.u, v: coords.v };
  } else if (state.currentTool === 'polygon') {
    if (state.drawingPoints.length === 0) {
      state.drawingPoints.push({ u: coords.u, v: coords.v });
    } else {
      const first = state.drawingPoints[0];
      const dist = Math.sqrt((coords.u - first.u) ** 2 + (coords.v - first.v) ** 2);
      if (dist < 0.5 && state.drawingPoints.length >= 3) {
        finishPolygon();
        return;
      }
      state.drawingPoints.push({ u: coords.u, v: coords.v });
    }
    updatePolygonPreview();
    setStatus(`Polygon: ${state.drawingPoints.length} points — Enter to finish, Esc to cancel`);
  }
}

function updateDrawPreview(coords) {
  clearPreview();

  if (state.currentTool === 'rectangle' && state.drawStart) {
    const points = [
      to3D(state.drawStart.u, state.drawStart.v, state.currentPlane),
      to3D(coords.u, state.drawStart.v, state.currentPlane),
      to3D(coords.u, coords.v, state.currentPlane),
      to3D(state.drawStart.u, coords.v, state.currentPlane),
      to3D(state.drawStart.u, state.drawStart.v, state.currentPlane),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineDashedMaterial({ color: 0x22c55e, dashSize: 0.3, gapSize: 0.15, linewidth: 1 });
    state.drawPreview = new THREE.Line(geo, mat);
    state.drawPreview.computeLineDistances();
    scene.add(state.drawPreview);

  } else if (state.currentTool === 'circle' && state.drawStart) {
    const du = coords.u - state.drawStart.u;
    const dv = coords.v - state.drawStart.v;
    const radius = Math.sqrt(du * du + dv * dv);
    const segments = 64;
    const circlePoints = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const u = state.drawStart.u + Math.cos(angle) * radius;
      const v = state.drawStart.v + Math.sin(angle) * radius;
      circlePoints.push(to3D(u, v, state.currentPlane));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(circlePoints);
    const mat = new THREE.LineDashedMaterial({ color: 0x22c55e, dashSize: 0.3, gapSize: 0.15 });
    state.drawPreview = new THREE.Line(geo, mat);
    state.drawPreview.computeLineDistances();
    scene.add(state.drawPreview);

  } else if (state.currentTool === 'polygon' && state.drawingPoints.length > 0) {
    updatePolygonPreview(coords);
  }
}

function updatePolygonPreview(hoverCoords) {
  clearPreview();
  if (state.drawingPoints.length === 0) return;

  const points = state.drawingPoints.map(p => to3D(p.u, p.v, state.currentPlane));
  if (hoverCoords) {
    points.push(to3D(hoverCoords.u, hoverCoords.v, state.currentPlane));
  }
  if (state.drawingPoints.length >= 3) {
    points.push(to3D(state.drawingPoints[0].u, state.drawingPoints[0].v, state.currentPlane));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineDashedMaterial({ color: 0x22c55e, dashSize: 0.3, gapSize: 0.15 });
  state.drawPreview = new THREE.Line(geo, mat);
  state.drawPreview.computeLineDistances();
  scene.add(state.drawPreview);

  // Dot at first point when closable
  if (state.drawingPoints.length >= 3) {
    const dotGeo = new THREE.SphereGeometry(0.15);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xf44336 });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    const firstPt = to3D(state.drawingPoints[0].u, state.drawingPoints[0].v, state.currentPlane);
    dot.position.copy(firstPt);
    state.polygonPreviewLine = dot;
    scene.add(dot);
  }

  // Dots at all placed vertices
  for (const p of state.drawingPoints) {
    const dGeo = new THREE.SphereGeometry(0.1);
    const dMat = new THREE.MeshBasicMaterial({ color: 0x4a6cf7 });
    const d = new THREE.Mesh(dGeo, dMat);
    d.position.copy(to3D(p.u, p.v, state.currentPlane));
    if (!state.polygonPreviewLine) {
      state.polygonPreviewLine = new THREE.Group();
      scene.add(state.polygonPreviewLine);
    }
    if (state.polygonPreviewLine.isGroup) {
      state.polygonPreviewLine.add(d);
    }
  }
}

function clearPreview() {
  if (state.drawPreview) {
    scene.remove(state.drawPreview);
    state.drawPreview.geometry.dispose();
    state.drawPreview = null;
  }
  if (state.polygonPreviewLine) {
    scene.remove(state.polygonPreviewLine);
    if (state.polygonPreviewLine.geometry) state.polygonPreviewLine.geometry.dispose();
    state.polygonPreviewLine = null;
  }
}

function finishRectangle(coords) {
  if (!state.drawStart) return;
  const u1 = Math.min(state.drawStart.u, coords.u);
  const v1 = Math.min(state.drawStart.v, coords.v);
  const u2 = Math.max(state.drawStart.u, coords.u);
  const v2 = Math.max(state.drawStart.v, coords.v);

  if (Math.abs(u2 - u1) < 0.1 || Math.abs(v2 - v1) < 0.1) {
    state.drawStart = null;
    clearPreview();
    return;
  }

  const sketch = {
    id: state.nextId++,
    type: 'rectangle',
    plane: state.currentPlane,
    data: { u1, v1, u2, v2 },
  };
  state.sketches.push(sketch);
  state.drawStart = null;
  clearPreview();
  rebuildSketchVisuals();
  setStatus(`Rectangle created on ${sketch.plane}`);
}

function finishCircle(coords) {
  if (!state.drawStart) return;
  const du = coords.u - state.drawStart.u;
  const dv = coords.v - state.drawStart.v;
  const radius = Math.sqrt(du * du + dv * dv);

  if (radius < 0.1) {
    state.drawStart = null;
    clearPreview();
    return;
  }

  const sketch = {
    id: state.nextId++,
    type: 'circle',
    plane: state.currentPlane,
    data: { cu: state.drawStart.u, cv: state.drawStart.v, radius },
  };
  state.sketches.push(sketch);
  state.drawStart = null;
  clearPreview();
  rebuildSketchVisuals();
  setStatus(`Circle created on ${sketch.plane}`);
}

function finishPolygon() {
  if (state.drawingPoints.length < 3) {
    state.drawingPoints = [];
    clearPreview();
    setStatus('Polygon needs at least 3 points');
    return;
  }

  const sketch = {
    id: state.nextId++,
    type: 'polygon',
    plane: state.currentPlane,
    data: { points: [...state.drawingPoints] },
  };
  state.sketches.push(sketch);
  state.drawingPoints = [];
  clearPreview();
  rebuildSketchVisuals();
  setStatus(`Polygon created on ${sketch.plane}`);
}

// ─── Selection ───────────────────────────────────────────────────────
function hitTestSketch(coords) {
  const plane = state.currentPlane;
  for (let i = state.sketches.length - 1; i >= 0; i--) {
    const s = state.sketches[i];
    if (s.plane !== plane) continue;

    if (s.type === 'rectangle') {
      const { u1, v1, u2, v2 } = s.data;
      if (coords.u >= u1 && coords.u <= u2 && coords.v >= v1 && coords.v <= v2) return s;
    } else if (s.type === 'circle') {
      const dx = coords.u - s.data.cu;
      const dy = coords.v - s.data.cv;
      if (Math.sqrt(dx * dx + dy * dy) <= s.data.radius) return s;
    } else if (s.type === 'polygon') {
      if (pointInPolygon(coords, s.data.points)) return s;
    }
  }
  return null;
}

function pointInPolygon(pt, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].u, yi = polygon[i].v;
    const xj = polygon[j].u, yj = polygon[j].v;
    const intersect = ((yi > pt.v) !== (yj > pt.v))
      && (pt.u < (xj - xi) * (pt.v - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── Sketch List Panel ──────────────────────────────────────────────
function updateSketchList() {
  const list = document.getElementById('sketch-list');
  list.innerHTML = '';
  if (state.sketches.length === 0) {
    list.innerHTML = '<div style="font-size:11px;color:#999;padding:4px;">No sketches yet</div>';
    return;
  }

  for (const sketch of state.sketches) {
    const item = document.createElement('div');
    item.className = 'sketch-item' + (state.selectedSketch?.id === sketch.id ? ' selected' : '');

    let icon = '';
    let label = '';
    if (sketch.type === 'rectangle') {
      icon = '<svg class="shape-icon" viewBox="0 0 14 14"><rect x="1" y="2" width="12" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
      const w = Math.abs(sketch.data.u2 - sketch.data.u1).toFixed(1);
      const h = Math.abs(sketch.data.v2 - sketch.data.v1).toFixed(1);
      label = `Rect ${w}×${h}`;
    } else if (sketch.type === 'circle') {
      icon = '<svg class="shape-icon" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
      label = `Circle r=${sketch.data.radius.toFixed(1)}`;
    } else if (sketch.type === 'polygon') {
      icon = '<svg class="shape-icon" viewBox="0 0 14 14"><polygon points="7,1 13,5 11,13 3,13 1,5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
      label = `Polygon ${sketch.data.points.length}pts`;
    }

    item.innerHTML = `${icon}<span class="shape-label">${label}</span><span class="shape-plane">${getPlaneLabel(sketch.plane)}</span>`;
    item.addEventListener('click', () => {
      state.selectedSketch = sketch;
      state.selectedSolidIds.clear();
      state.solidSelectionOrder = [];
      state.selectedSolidId = null;
      state.selectedFace = null;
      clearFaceHighlight();
      updateSolidSelectionVisuals();
      rebuildSketchVisuals();
    });
    list.appendChild(item);
  }
}

// ─── Mouse Events ────────────────────────────────────────────────────
let isMouseDown = false;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;

  if (state.currentTool === null && state.viewMode === '3d') {
    const hit3d = pickSolidIntersection(e);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (hit3d) {
      selectSolidFromIntersection(hit3d, additive);
      return;
    }
    if (!additive) {
      state.selectedSolidIds.clear();
      state.solidSelectionOrder = [];
      state.selectedSolidId = null;
      state.selectedFace = null;
      clearFaceHighlight();
      updateSolidSelectionVisuals();
    }
    return;
  }

  const coords = getMouseOnPlane(e);
  if (!coords) return;

  if (state.currentTool === 'extrude-select') {
    const region = pickRegionAt(coords);
    if (!region) {
      setStatus('No region here. Click inside a highlighted region.');
      return;
    }
    if (state.selectedRegionIds.has(region.id)) {
      state.selectedRegionIds.delete(region.id);
    } else {
      state.selectedRegionIds.add(region.id);
    }
    refreshExtrusionRegions();
    return;
  }

  if (state.currentTool === null) {
    const hit = hitTestSketch(coords);
    state.selectedSketch = hit;
    state.selectedSolidIds.clear();
    state.solidSelectionOrder = [];
    state.selectedSolidId = null;
    state.selectedFace = null;
    clearFaceHighlight();
    updateSolidSelectionVisuals();
    rebuildSketchVisuals();
    return;
  }

  isMouseDown = true;
  controls.enabled = false;
  startDrawing(coords);
});

canvas.addEventListener('mousemove', (e) => {
  const coords = getMouseOnPlane(e);
  if (!coords) return;

  updateCoords(coords);

  if (state.currentTool && (isMouseDown || state.currentTool === 'polygon')) {
    updateDrawPreview(coords);
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  if (!isMouseDown && state.currentTool !== 'polygon') return;

  const coords = getMouseOnPlane(e);
  if (!coords) {
    isMouseDown = false;
    controls.enabled = true;
    return;
  }

  if (state.currentTool === 'rectangle') {
    finishRectangle(coords);
  } else if (state.currentTool === 'circle') {
    finishCircle(coords);
  }

  isMouseDown = false;
  controls.enabled = true;
});

canvas.addEventListener('dblclick', () => {
  if (state.currentTool === 'polygon' && state.drawingPoints.length >= 3) {
    finishPolygon();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    state.drawStart = null;
    state.drawingPoints = [];
    isMouseDown = false;
    controls.enabled = true;
    clearPreview();
    setStatus('Cancelled');
  } else if (e.key === 'Enter') {
    if (state.currentTool === 'polygon' && state.drawingPoints.length >= 3) {
      finishPolygon();
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!state.currentTool && (state.selectedSketch || state.selectedSolidIds.size > 0 || state.selectedSolidId)) {
      deleteSelected();
    }
  }
});

// ─── Toolbar UI ──────────────────────────────────────────────────────
document.querySelectorAll('.plane-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.plane-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const plane = btn.dataset.plane;
    if (plane === '3D') {
      switchTo3D();
    } else {
      snapCameraToPlane(plane);
    }
    cancelDraw();
  });
});

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    if (state.currentTool === tool) {
      btn.classList.remove('active');
      state.currentTool = null;
      canvas.classList.remove('crosshair');
      document.getElementById('status-tool').textContent = 'Tool: Select';
      clearRegionPreviews();
      state.regionCandidates = [];
      state.selectedRegionIds.clear();
    } else {
      if (state.viewMode === '3d') {
        if (!enterFaceSketchPlane()) return;
      }
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTool = tool;
      canvas.classList.add('crosshair');
      document.getElementById('status-tool').textContent = `Tool: ${tool.charAt(0).toUpperCase() + tool.slice(1)}`;
      if (tool === 'extrude-select') {
        state.selectedRegionIds.clear();
        refreshExtrusionRegions();
      } else {
        clearRegionPreviews();
        state.regionCandidates = [];
        state.selectedRegionIds.clear();
      }
    }
    cancelDraw();
  });
});

document.getElementById('btn-select').addEventListener('click', () => {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  state.currentTool = null;
  canvas.classList.remove('crosshair');
  document.getElementById('status-tool').textContent = 'Tool: Select';
  clearRegionPreviews();
  state.regionCandidates = [];
  state.selectedRegionIds.clear();
  cancelDraw();
});

document.getElementById('btn-delete').addEventListener('click', deleteSelected);
document.getElementById('btn-extrude').addEventListener('click', extrudeSelectedRegions);
document.getElementById('btn-union').addEventListener('click', () => performBooleanOperation('union'));
document.getElementById('btn-subtract').addEventListener('click', () => performBooleanOperation('subtract'));
document.getElementById('btn-clear').addEventListener('click', () => {
  state.sketches = state.sketches.filter(s => s.plane !== state.currentPlane);
  state.selectedSketch = null;
  state.selectedSolidIds.clear();
  state.solidSelectionOrder = [];
  state.selectedSolidId = null;
  state.selectedFace = null;
  clearFaceHighlight();
  updateSolidSelectionVisuals();
  rebuildSketchVisuals();
  setStatus(`Cleared ${getPlaneLabel(state.currentPlane)} plane`);
});
document.getElementById('btn-reset-all').addEventListener('click', () => {
  const hasContent = state.sketches.length > 0 || state.solids.length > 0;
  if (hasContent && !window.confirm('Clear all drawings and solids? This cannot be undone.')) {
    return;
  }

  state.sketches = [];
  state.solids = [];
  state.selectedSketch = null;
  state.selectedSolidIds.clear();
  state.solidSelectionOrder = [];
  state.selectedSolidId = null;
  state.selectedFace = null;
  state.customPlanes = {};
  state.nextWorkPlaneId = 1;
  state.currentPlane = 'XY';
  state.regionCandidates = [];
  state.selectedRegionIds.clear();
  state.regionPickCycle = { key: null, index: 0 };
  clearRegionPreviews();
  clearFaceHighlight();
  cancelDraw();
  rebuildSketchVisuals();
  rebuildSolidsVisuals();
  if (state.viewMode === '2d') {
    snapCameraToPlane('XY');
    document.querySelectorAll('.plane-btn').forEach((b) => b.classList.remove('active'));
    const xyBtn = document.querySelector('.plane-btn[data-plane="XY"]');
    if (xyBtn) xyBtn.classList.add('active');
  } else {
    document.getElementById('status-plane').textContent = `Plane: ${getPlaneLabel(state.currentPlane)}`;
  }
  localStorage.removeItem('cad_tool_project');
  setStatus('Reset all drawings and solids');
});

document.getElementById('btn-save').addEventListener('click', saveProject);
document.getElementById('btn-load').addEventListener('click', loadProject);

document.getElementById('toggle-grid').addEventListener('change', (e) => {
  state.gridVisible = e.target.checked;
  if (state.viewMode === '2d') {
    const activeFrame = resolvePlaneFrame(state.currentPlane);
    const gridKey = activeFrame?.gridKey;
    Object.entries(grids).forEach(([key, g]) => {
      g.visible = state.gridVisible && !!gridKey && key === gridKey;
    });
  } else {
    Object.values(grids).forEach(g => g.visible = state.gridVisible);
  }
});

document.getElementById('toggle-snap').addEventListener('change', (e) => {
  state.gridSnap = e.target.checked;
});

function cancelDraw() {
  state.drawStart = null;
  state.drawingPoints = [];
  isMouseDown = false;
  controls.enabled = true;
  clearPreview();
}

function deleteSelected() {
  if (state.selectedSolidIds.size > 0 || state.selectedSolidId) {
    const toDelete = state.selectedSolidIds.size > 0
      ? new Set(state.selectedSolidIds)
      : new Set([state.selectedSolidId]);
    const count = toDelete.size;
    state.solids = state.solids.filter((s) => !toDelete.has(s.id));
    state.selectedSolidIds.clear();
    state.solidSelectionOrder = [];
    state.selectedSolidId = null;
    state.selectedFace = null;
    clearFaceHighlight();
    rebuildSolidsVisuals();
    setStatus(`Deleted ${count} solid${count === 1 ? '' : 's'}`);
    return;
  }

  if (!state.selectedSketch) {
    setStatus('Nothing selected');
    return;
  }
  state.sketches = state.sketches.filter(s => s.id !== state.selectedSketch.id);
  setStatus(`Deleted ${state.selectedSketch.type}`);
  state.selectedSketch = null;
  rebuildSketchVisuals();
}

// ─── Save / Load ─────────────────────────────────────────────────────
function saveProject() {
  const data = {
    version: 2,
    sketches: state.sketches,
    solids: state.solids,
    customPlanes: state.customPlanes,
    nextWorkPlaneId: state.nextWorkPlaneId,
    nextId: state.nextId,
    nextSolidId: state.nextSolidId,
  };
  const json = JSON.stringify(data, null, 2);
  localStorage.setItem('cad_tool_project', json);

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cad_project.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Project saved');
}

function loadProject() {
  const stored = localStorage.getItem('cad_tool_project');
  if (stored) {
    try {
      const data = JSON.parse(stored);
      state.sketches = data.sketches || [];
      state.solids = data.solids || [];
      state.customPlanes = data.customPlanes || {};
      state.nextWorkPlaneId = data.nextWorkPlaneId || 1;
      state.nextId = data.nextId || 1;
      state.nextSolidId = data.nextSolidId || 1;
      ensureCurrentPlaneValid();
      state.selectedSketch = null;
      state.selectedSolidIds.clear();
      state.solidSelectionOrder = [];
      state.selectedSolidId = null;
      state.selectedFace = null;
      rebuildSketchVisuals();
      rebuildSolidsVisuals();
      setStatus('Project loaded from storage');
      return;
    } catch { /* fall through */ }
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        state.sketches = data.sketches || [];
        state.solids = data.solids || [];
        state.customPlanes = data.customPlanes || {};
        state.nextWorkPlaneId = data.nextWorkPlaneId || 1;
        state.nextId = data.nextId || 1;
        state.nextSolidId = data.nextSolidId || 1;
        ensureCurrentPlaneValid();
        state.selectedSketch = null;
        state.selectedSolidIds.clear();
        state.solidSelectionOrder = [];
        state.selectedSolidId = null;
        state.selectedFace = null;
        rebuildSketchVisuals();
        rebuildSolidsVisuals();
        setStatus('Project loaded from file');
      } catch {
        setStatus('Error: invalid file');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

setInterval(() => {
  if (state.sketches.length > 0 || state.solids.length > 0) {
    const data = {
      version: 2,
      sketches: state.sketches,
      solids: state.solids,
      customPlanes: state.customPlanes,
      nextWorkPlaneId: state.nextWorkPlaneId,
      nextId: state.nextId,
      nextSolidId: state.nextSolidId,
    };
    localStorage.setItem('cad_tool_project', JSON.stringify(data));
  }
}, 5000);

// ─── Status Bar ──────────────────────────────────────────────────────
function updateCoords(coords) {
  document.getElementById('status-coords').textContent =
    `U: ${coords.u.toFixed(2)} V: ${coords.v.toFixed(2)}`;
}

function setStatus(msg) {
  document.getElementById('status-info').textContent = msg;
  setTimeout(() => {
    if (document.getElementById('status-info').textContent === msg) {
      document.getElementById('status-info').textContent = '';
    }
  }, 3000);
}

// ─── Resize ──────────────────────────────────────────────────────────
function onResize() {
  const container = document.getElementById('viewport-container');
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);

  perspCamera.aspect = w / h;
  perspCamera.updateProjectionMatrix();

  updateOrthoAspect();
}
window.addEventListener('resize', onResize);

// ─── Render Loop ─────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, activeCamera);
}

// ─── Init ────────────────────────────────────────────────────────────
onResize();
snapCameraToPlane('XY');
animate();
rebuildSketchVisuals();
setStatus('Ready — select a tool to start drawing');

const autoLoad = localStorage.getItem('cad_tool_project');
if (autoLoad) {
  try {
    const data = JSON.parse(autoLoad);
    state.sketches = data.sketches || [];
    state.solids = data.solids || [];
    state.customPlanes = data.customPlanes || {};
    state.nextWorkPlaneId = data.nextWorkPlaneId || 1;
    state.nextId = data.nextId || 1;
    state.nextSolidId = data.nextSolidId || 1;
    ensureCurrentPlaneValid();
    rebuildSketchVisuals();
    rebuildSolidsVisuals();
    setStatus('Restored previous session');
  } catch { /* ignore */ }
}
