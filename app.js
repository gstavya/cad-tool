import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
  nextId: 1,
};

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
  opacity: 0.04,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const planeHighlight = new THREE.Mesh(planeHighlightGeo, planeHighlightMat);
scene.add(planeHighlight);

function updatePlaneHighlight() {
  planeHighlight.rotation.set(0, 0, 0);
  planeHighlight.position.set(0, 0, 0);
  if (state.currentPlane === 'XY') {
    // default
  } else if (state.currentPlane === 'XZ') {
    planeHighlight.rotation.x = -Math.PI / 2;
  } else if (state.currentPlane === 'YZ') {
    planeHighlight.rotation.y = Math.PI / 2;
  }
}
updatePlaneHighlight();

// ─── Raycasting plane (invisible, for mouse projection) ─────────────
const rayPlaneGeo = new THREE.PlaneGeometry(200, 200);
const rayPlaneMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
const rayPlaneMesh = new THREE.Mesh(rayPlaneGeo, rayPlaneMat);
scene.add(rayPlaneMesh);

function updateRayPlane() {
  rayPlaneMesh.rotation.set(0, 0, 0);
  rayPlaneMesh.position.set(0, 0, 0);
  if (state.currentPlane === 'XY') {
    // default
  } else if (state.currentPlane === 'XZ') {
    rayPlaneMesh.rotation.x = -Math.PI / 2;
  } else if (state.currentPlane === 'YZ') {
    rayPlaneMesh.rotation.y = Math.PI / 2;
  }
}
updateRayPlane();

// ─── Camera / View Switching ─────────────────────────────────────────
function snapCameraToPlane(plane) {
  state.viewMode = '2d';
  state.currentPlane = plane;
  activeCamera = orthoCamera;
  controls.object = orthoCamera;

  controls.enableRotate = false;
  controls.enablePan = true;
  controls.enableZoom = true;

  const D = 50;
  controls.target.set(0, 0, 0);

  if (plane === 'XY') {
    orthoCamera.position.set(0, 0, D);
    orthoCamera.up.set(0, 1, 0);
  } else if (plane === 'XZ') {
    orthoCamera.position.set(0, D, 0);
    orthoCamera.up.set(0, 0, -1);
  } else if (plane === 'YZ') {
    orthoCamera.position.set(D, 0, 0);
    orthoCamera.up.set(0, 1, 0);
  }

  orthoCamera.lookAt(0, 0, 0);
  controls.update();

  updatePlaneHighlight();
  updateRayPlane();

  // Show only the active grid in 2D mode
  Object.entries(grids).forEach(([key, g]) => {
    g.visible = state.gridVisible && key === plane;
  });

  document.getElementById('view-badge').textContent = `${plane} Plane`;
  document.getElementById('status-plane').textContent = `Plane: ${plane}`;
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
  document.getElementById('status-plane').textContent = `Plane: ${state.currentPlane}`;
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

// ─── Utility: Map 3D point to 2D coords on current plane ────────────
function to2D(point3D, plane) {
  if (plane === 'XY') return { u: point3D.x, v: point3D.y };
  if (plane === 'XZ') return { u: point3D.x, v: point3D.z };
  if (plane === 'YZ') return { u: point3D.y, v: point3D.z };
}

function to3D(u, v, plane) {
  if (plane === 'XY') return new THREE.Vector3(u, v, 0);
  if (plane === 'XZ') return new THREE.Vector3(u, 0, v);
  if (plane === 'YZ') return new THREE.Vector3(0, u, v);
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

// ─── Shape Rendering ─────────────────────────────────────────────────
const SHAPE_COLOR = 0x4a6cf7;
const SHAPE_COLOR_SELECTED = 0xf44336;
const SHAPE_FILL_OPACITY = 0.12;

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

    const fillGeo = new THREE.PlaneGeometry(w, h);
    const fillMat = new THREE.MeshBasicMaterial({
      color: SHAPE_COLOR,
      transparent: true,
      opacity: SHAPE_FILL_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    const center3D = to3D(cu, cv, sketch.plane);
    fillMesh.position.copy(center3D);
    if (sketch.plane === 'XZ') fillMesh.rotation.x = -Math.PI / 2;
    else if (sketch.plane === 'YZ') fillMesh.rotation.y = Math.PI / 2;
    group.add(fillMesh);

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

    const circleShape = new THREE.Shape();
    circleShape.absarc(0, 0, radius, 0, Math.PI * 2, false);
    const fillGeo = new THREE.ShapeGeometry(circleShape, segments);
    const fillMat = new THREE.MeshBasicMaterial({
      color: SHAPE_COLOR,
      transparent: true,
      opacity: SHAPE_FILL_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    const center3D = to3D(cu, cv, sketch.plane);
    fillMesh.position.copy(center3D);
    if (sketch.plane === 'XZ') fillMesh.rotation.x = -Math.PI / 2;
    else if (sketch.plane === 'YZ') fillMesh.rotation.y = Math.PI / 2;
    group.add(fillMesh);

  } else if (sketch.type === 'polygon') {
    const pts = sketch.data.points;
    if (pts.length < 2) return group;

    const linePoints = pts.map(p => to3D(p.u, p.v, sketch.plane));
    linePoints.push(linePoints[0].clone());
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineMat = new THREE.LineBasicMaterial({ color: SHAPE_COLOR, linewidth: 2 });
    group.add(new THREE.Line(lineGeo, lineMat));

    if (pts.length >= 3) {
      const shape = new THREE.Shape();
      shape.moveTo(pts[0].u, pts[0].v);
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i].u, pts[i].v);
      }
      shape.closePath();
      const fillGeo = new THREE.ShapeGeometry(shape);
      const fillMat = new THREE.MeshBasicMaterial({
        color: SHAPE_COLOR,
        transparent: true,
        opacity: SHAPE_FILL_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const fillMesh = new THREE.Mesh(fillGeo, fillMat);
      if (sketch.plane === 'XZ') {
        fillMesh.rotation.x = -Math.PI / 2;
      } else if (sketch.plane === 'YZ') {
        fillMesh.rotation.y = Math.PI / 2;
      }
      group.add(fillMesh);
    }
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

    item.innerHTML = `${icon}<span class="shape-label">${label}</span><span class="shape-plane">${sketch.plane}</span>`;
    item.addEventListener('click', () => {
      state.selectedSketch = sketch;
      rebuildSketchVisuals();
    });
    list.appendChild(item);
  }
}

// ─── Mouse Events ────────────────────────────────────────────────────
let isMouseDown = false;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const coords = getMouseOnPlane(e);
  if (!coords) return;

  if (state.currentTool === null) {
    const hit = hitTestSketch(coords);
    state.selectedSketch = hit;
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
    if (state.selectedSketch && !state.currentTool) {
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
    } else {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTool = tool;
      canvas.classList.add('crosshair');
      document.getElementById('status-tool').textContent = `Tool: ${tool.charAt(0).toUpperCase() + tool.slice(1)}`;
    }
    cancelDraw();
  });
});

document.getElementById('btn-select').addEventListener('click', () => {
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  state.currentTool = null;
  canvas.classList.remove('crosshair');
  document.getElementById('status-tool').textContent = 'Tool: Select';
  cancelDraw();
});

document.getElementById('btn-delete').addEventListener('click', deleteSelected);
document.getElementById('btn-clear').addEventListener('click', () => {
  state.sketches = state.sketches.filter(s => s.plane !== state.currentPlane);
  state.selectedSketch = null;
  rebuildSketchVisuals();
  setStatus(`Cleared ${state.currentPlane} plane`);
});

document.getElementById('btn-save').addEventListener('click', saveProject);
document.getElementById('btn-load').addEventListener('click', loadProject);

document.getElementById('toggle-grid').addEventListener('change', (e) => {
  state.gridVisible = e.target.checked;
  if (state.viewMode === '2d') {
    Object.entries(grids).forEach(([key, g]) => {
      g.visible = state.gridVisible && key === state.currentPlane;
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
    version: 1,
    sketches: state.sketches,
    nextId: state.nextId,
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
      state.nextId = data.nextId || 1;
      state.selectedSketch = null;
      rebuildSketchVisuals();
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
        state.nextId = data.nextId || 1;
        state.selectedSketch = null;
        rebuildSketchVisuals();
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
  if (state.sketches.length > 0) {
    const data = { version: 1, sketches: state.sketches, nextId: state.nextId };
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
    state.nextId = data.nextId || 1;
    rebuildSketchVisuals();
    setStatus('Restored previous session');
  } catch { /* ignore */ }
}
