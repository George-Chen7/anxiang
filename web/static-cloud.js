// @ts-check
"use strict";

/** @typedef {{id:string,name:string,x:number,z:number}} BuildingData */
/** @typedef {{id:string,building:string,floor:number,unit:string,room:string,type:string,level:number,occurred_at:string,device:string,status:string,description:string}} AlertData */
/** @typedef {{id:number,alert_id:string,action:string,operator:string|null,created_at:string}} ActionData */
/** @typedef {{id:string,name:string,building:string,floor:number,unit:string,room:string}} ResidentEntry */

/* ---------------------------------------------------------------------------
 * 云端数据层：楼栋、告警、处置记录都存放在云数据库中
 * ------------------------------------------------------------------------- */

/** @type {any} */ let cloud = null;
/** @type {{username:string,role:"grid"|"admin",displayName:string}|null} */
let currentSession = null;

/** @type {BuildingData[]} */ let buildings = [];
/** @type {AlertData[]} */ let alerts = [];

/* 演示住户目录：与 profile-card 的 residents.js 对应，用于管理员选择住户
   以及把新事件的房间位置映射回身份卡片。 */
/** @type {ResidentEntry[]} */
const RESIDENT_DIRECTORY = [
  { id: "AX-001", name: "周慧兰", building: "B3", floor: 31, unit: "2单元", room: "3102" },
  { id: "AX-002", name: "李国栋", building: "A1", floor: 22, unit: "1单元", room: "2201" },
  { id: "AX-003", name: "陈秀英", building: "B5", floor: 17, unit: "2单元", room: "1702" },
  { id: "AX-004", name: "王振华", building: "A2", floor: 28, unit: "1单元", room: "2801" },
  { id: "AX-005", name: "赵淑芬", building: "C2", floor: 12, unit: "2单元", room: "1202" }
];

/** @param {string} id @returns {ResidentEntry|undefined} */
function residentById(id) { return RESIDENT_DIRECTORY.find((resident) => resident.id === id); }

/** @param {AlertData} alert @returns {ResidentEntry|undefined} */
function residentForAlert(alert) {
  return RESIDENT_DIRECTORY.find((resident) => resident.building === alert.building && resident.floor === alert.floor && resident.unit === alert.unit && resident.room === alert.room);
}

const OPERATOR_STORAGE_KEY = "anxiang-operator";

/** @param {string} id @returns {HTMLElement} */
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`页面缺少元素：${id}`);
  return node;
}

/** @returns {any} */
function createCloudClient() {
  const config = window.ANXIANG_CLOUD_CONFIG;
  const library = window.WorkBuddyCloud;
  if (!config) throw new Error("云端配置缺失，cloud-config.js 未加载");
  if (!library) throw new Error("云端 SDK 未加载，请检查网络后刷新页面");
  return library.createWorkBuddyCloud({
    endpoint: config.endpoint,
    oauthRelayBaseUrl: config.oauthRelayBaseUrl,
    publishableKey: config.publishableKey
  });
}

/** @returns {Promise<{buildings:BuildingData[],alerts:AlertData[]}>} */
async function fetchData() {
  const [buildingResult, alertResult] = await Promise.all([
    cloud.database.from("buildings").select("id,name,x,z").order("sort_order", { ascending: true }),
    cloud.database
      .from("alerts")
      .select("id,building_id,floor,unit,room,type,level,occurred_at,device,status,description")
      .order("occurred_at", { ascending: false })
  ]);
  if (buildingResult.error) throw buildingResult.error;
  if (alertResult.error) throw alertResult.error;
  return {
    buildings: (buildingResult.data || []).map((/** @type {any} */ row) => ({
      id: String(row.id),
      name: String(row.name),
      x: Number(row.x),
      z: Number(row.z)
    })),
    alerts: (alertResult.data || []).map((/** @type {any} */ row) => ({
      id: String(row.id),
      building: String(row.building_id),
      floor: Number(row.floor),
      unit: String(row.unit),
      room: String(row.room),
      type: String(row.type),
      level: Number(row.level),
      occurred_at: String(row.occurred_at),
      device: String(row.device || ""),
      status: String(row.status || "待核实"),
      description: String(row.description || "")
    }))
  };
}

/** @returns {Promise<ActionData[]>} */
async function fetchActions(alertId) {
  const { data, error } = await cloud.database
    .from("alert_actions")
    .select("id,alert_id,action,operator,created_at")
    .eq("alert_id", alertId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data || [];
}

/* ---------------------------------------------------------------------------
 * 渲染辅助
 * ------------------------------------------------------------------------- */

/** @param {unknown} value @returns {string} */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[character] || character;
  });
}

/** @param {unknown} error @returns {string} */
function describeError(error) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  const typed = /** @type {{message?:string,error_description?:string,code?:string}} */ (error);
  const message = typed.message || typed.error_description || "";
  if (typed.code === "42P01") return "数据表不存在，请在云端初始化数据表";
  if (typed.code === "42501" || /permission denied/i.test(message)) return "没有数据库访问权限，请让 WorkBuddy 应用管理员检查权限策略";
  return message || "请稍后重试";
}

/** @param {string} iso @returns {string} */
function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (/** @type {number} */ value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** @param {string} iso @returns {string} */
function formatClock(iso) {
  const formatted = formatTime(iso);
  return formatted ? formatted.slice(11, 16) : "";
}

/** @returns {string} */
function todayLabel() {
  const date = new Date();
  const pad = (/** @type {number} */ value) => String(value).padStart(2, "0");
  return `${date.getFullYear()} / ${pad(date.getMonth() + 1)} / ${pad(date.getDate())}`;
}

/** @param {number} level @returns {string} */
function levelName(level) { return level === 3 ? "紧急" : level === 2 ? "较高" : "关注"; }
/** @param {number} level @returns {string} */
function levelClass(level) { return level === 3 ? "urgent" : level === 2 ? "high" : "watch"; }
/** @param {string} id @returns {AlertData|undefined} */
function getAlert(id) { return alerts.find((item) => item.id === id); }
/** @param {string} id @returns {BuildingData|undefined} */
function getBuilding(id) { return buildings.find((item) => item.id === id); }
/** @param {string} id @returns {string} */
function buildingName(id) { const building = getBuilding(id); return building ? building.name : id; }

/** @param {string} state @param {"ok"|"error"|"loading"} tone @returns {void} */
function setSyncState(state, tone) {
  const node = document.getElementById("syncState");
  if (!node) return;
  node.textContent = state;
  node.className = `sync-state ${tone}`;
}

/** @param {unknown} error @returns {void} */
function showLoadError(error) {
  const box = el("loadError");
  box.hidden = false;
  box.innerHTML = `<strong>云端数据加载失败</strong><br>${escapeHtml(describeError(error))}<br><button type="button" id="retryButton">重试连接</button>`;
  const retry = document.getElementById("retryButton");
  if (retry) retry.addEventListener("click", () => { void refreshAlerts(false); });
}

/** @returns {void} */
function hideLoadError() {
  const box = document.getElementById("loadError");
  if (box) box.hidden = true;
}

/** @param {string} message @returns {void} */
function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3200);
}

/** @returns {string} */
function readOperator() {
  try {
    const stored = window.localStorage.getItem(OPERATOR_STORAGE_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch (error) { /* 本地存储不可用时忽略 */ }
  return "值班网格员";
}

/** @returns {string} */
function currentOperator() {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById("operatorInput"));
  const value = input && input.value.trim() ? input.value.trim() : readOperator();
  try { window.localStorage.setItem(OPERATOR_STORAGE_KEY, value); } catch (error) { /* 忽略 */ }
  return value;
}

/* ---------------------------------------------------------------------------
 * 三维社区场景
 * ------------------------------------------------------------------------- */

const sceneElement = el("scene");
const workspace = el("workspace");

/** @type {any} */ let scene = null;
/** @type {any} */ let camera = null;
/** @type {any} */ let renderer = null;
/** @type {any} */ let neighborhood = null;
/** @type {any} */ let materials = null;

const FLOOR_HEIGHT = .275;
const TOWER_HEIGHT = 35 * FLOOR_HEIGHT;
/** @type {Map<string,any>} */ const towerObjects = new Map();
/** @type {Map<string,any>} */ const markerObjects = new Map();
/** @type {any[]} */ const hitObjects = [];
/** @type {any[]} */ const markerHits = [];

let selectedBuilding = "";
let selectedFloor = 0;
let selectedAlert = "";
let userPaused = false;
let hovered = false;
let hoveredMarker = "";
let dragging = false;
let pointerX = 0;
let pointerY = 0;
let dragDistance = 0;
let radius = 31;
let theta = .56;
let phi = 1.13;
const target = new THREE.Vector3(0, 4.4, 0);
const desiredTarget = new THREE.Vector3(0, 4.4, 0);
let desiredRadius = 31;
/** @type {{started:number,duration:number,fromTarget:any,fromRadius:number,fromTheta:number,toTheta:number,fromPhi:number,fromRotation:number,toRotation:number}|null} */
let returnTransition = null;
let layoutChanging = false;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** @param {number} width @param {number} height @param {number} depth @param {any} material @param {number} x @param {number} y @param {number} z @returns {any} */
function box(width, height, depth, material, x, y, z) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

/** @param {string} label @returns {any} */
function labelSprite(label) { const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 72; const context = canvas.getContext("2d"); if (!context) throw new Error("无法创建楼栋标签画布"); context.fillStyle = "rgba(255,253,249,.94)"; context.beginPath(); context.roundRect(4, 4, 312, 64, 17); context.fill(); context.fillStyle = "#315d4f"; context.font = "bold 29px Microsoft YaHei, sans-serif"; context.textAlign = "center"; context.fillText(label, 160, 47); const texture = new THREE.CanvasTexture(canvas); const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false })); sprite.scale.set(2.2, .5, 1); return sprite; }

/** @param {BuildingData} data @returns {void} */
function createBuilding(data) {
  const group = new THREE.Group(); group.position.set(data.x, 0, data.z); neighborhood.add(group);
  group.add(box(2.15, TOWER_HEIGHT, 1.55, materials.wall, 0, TOWER_HEIGHT / 2, 0));
  group.add(box(.16, TOWER_HEIGHT, 1.55, materials.side, 1.1, TOWER_HEIGHT / 2, 0));
  group.add(box(2.32, .18, 1.72, materials.roof, 0, TOWER_HEIGHT + .08, 0));
  group.add(box(.82, .45, .12, materials.entry, 0, .24, .82));
  group.add(box(.98, .07, .46, materials.roof, 0, .49, .93));
  const selection = box(2.38, TOWER_HEIGHT + .18, 1.83, materials.selected, 0, TOWER_HEIGHT / 2, 0); selection.visible = false; group.add(selection);
  const floorHighlight = box(2.42, FLOOR_HEIGHT, 1.88, materials.floor, 0, .5, 0); floorHighlight.visible = false; group.add(floorHighlight);
  for (let floor = 1; floor <= 35; floor++) {
    const y = (floor - .5) * FLOOR_HEIGHT;
    for (const x of [-.62, .62]) {
      group.add(box(.43, .16, .025, materials.glass, x, y, .795));
      group.add(box(.56, .028, .25, materials.balcony, x, y - .10, .91));
      group.add(box(.025, .11, .22, materials.balcony, x - .28, y - .045, .91));
      group.add(box(.025, .11, .22, materials.balcony, x + .28, y - .045, .91));
      group.add(box(.46, .16, .025, materials.glass, x, y, -.795));
    }
    group.add(box(2.2, .012, 1.61, materials.side, 0, floor * FLOOR_HEIGHT, 0));
    const hit = box(2.36, FLOOR_HEIGHT, 1.83, new THREE.MeshBasicMaterial({ visible: false }), 0, y, 0);
    hit.userData = { kind: "floor", building: data.id, floor }; group.add(hit); hitObjects.push(hit);
  }
  const label = labelSprite(data.name); label.position.set(0, TOWER_HEIGHT + .75, 0); group.add(label);
  towerObjects.set(data.id, { group, selection, floorHighlight, data });
}

/** @param {AlertData} alert @returns {void} */
function createMarker(alert) {
  const tower = towerObjects.get(alert.building);
  if (!tower) return;
  const material = alert.level === 3 ? materials.urgent : alert.level === 2 ? materials.high : materials.watch;
  const y = (alert.floor - .5) * FLOOR_HEIGHT;
  const x = alert.room.endsWith("01") ? -.62 : .62;
  const group = new THREE.Group(); group.position.set(x, y, 1.07); tower.group.add(group);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(.19, 16, 12), new THREE.MeshBasicMaterial({ color: material.color, transparent: true, opacity: .19, depthWrite: false }));
  halo.renderOrder = 20; group.add(halo);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.095, 16, 12), material); dot.renderOrder = 21; group.add(dot);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData = { kind: "alert", id: alert.id }; group.add(hit); markerHits.push(hit);
  markerObjects.set(alert.id, { group, halo, dot, hit });
}

/** @returns {void} */
function renderMarkers() {
  if (!neighborhood) return;
  for (const marker of markerObjects.values()) { if (marker.group.parent) marker.group.parent.remove(marker.group); }
  markerObjects.clear();
  markerHits.length = 0;
  for (const alert of alerts) createMarker(alert);
}

/** @returns {void} */
function buildScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, .1, 120);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sceneElement.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb5c3ae, .88));
  const sun = new THREE.DirectionalLight(0xffffff, .92);
  sun.position.set(-12, 22, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -20; sun.shadow.camera.right = 20; sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20; scene.add(sun);
  neighborhood = new THREE.Group(); scene.add(neighborhood);
  materials = {
    wall: new THREE.MeshStandardMaterial({ color: 0xe5e3db, roughness: .92 }),
    side: new THREE.MeshStandardMaterial({ color: 0xd4d9d0, roughness: .9 }),
    balcony: new THREE.MeshStandardMaterial({ color: 0xbfcfc8, roughness: .75 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x779da2, roughness: .35, metalness: .12 }),
    entry: new THREE.MeshStandardMaterial({ color: 0x587c78, roughness: .5 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xd7dcd3, roughness: .85 }),
    grass: new THREE.MeshStandardMaterial({ color: 0xdde9d8, roughness: 1 }),
    path: new THREE.MeshStandardMaterial({ color: 0xede9df, roughness: 1 }),
    selected: new THREE.MeshStandardMaterial({ color: 0x8bc5a9, transparent: true, opacity: .26, depthWrite: false, side: THREE.DoubleSide }),
    floor: new THREE.MeshStandardMaterial({ color: 0x82bd97, transparent: true, opacity: .45, depthWrite: false, side: THREE.DoubleSide }),
    urgent: new THREE.MeshBasicMaterial({ color: 0xd85651 }),
    high: new THREE.MeshBasicMaterial({ color: 0xe68b57 }),
    watch: new THREE.MeshBasicMaterial({ color: 0xd7af54 })
  };
  for (const building of buildings) createBuilding(building);
  neighborhood.add(box(19, .14, 15, materials.grass, 0, -.12, 0));
  for (const z of [-1.1, 1.2]) neighborhood.add(box(17, .015, .66, materials.path, 0, -.03, z));
  for (const x of [-2.9, 2.4]) neighborhood.add(box(.63, .015, 13, materials.path, x, -.02, 0));
  renderMarkers();
  bindSceneEvents();
  new ResizeObserver(() => { if (!layoutChanging) resize(); }).observe(sceneElement);
  resize();
  el("sceneHint").textContent = "点击楼栋查看楼层";
  requestAnimationFrame(animate);
}

/** @returns {void} */
function resize() {
  if (!renderer || !camera) return;
  const width = sceneElement.clientWidth;
  const height = sceneElement.clientHeight;
  if (width === 0 || height === 0) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

workspace.addEventListener("transitionend", (event) => {
  if (event.target === workspace && /** @type {TransitionEvent} */ (event).propertyName === "grid-template-columns") { layoutChanging = false; resize(); }
});

/** @param {PointerEvent} event @returns {void} */
function setPointer(event) {
  if (!renderer) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
  pointer.y = -(event.clientY - rect.top) / rect.height * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

/** @returns {any} */
function visibleMarkerHit() {
  const markerHit = raycaster.intersectObjects(markerHits, false)[0];
  if (!markerHit) return null;
  const floorHit = raycaster.intersectObjects(hitObjects, false)[0];
  return floorHit && floorHit.distance < markerHit.distance ? null : markerHit;
}

/** @returns {void} */
function bindSceneEvents() {
  if (!renderer) return;
  renderer.domElement.addEventListener("pointerdown", (event) => { stopReturnTransition(); dragging = true; dragDistance = 0; pointerX = event.clientX; pointerY = event.clientY; renderer.domElement.setPointerCapture(event.pointerId); });
  renderer.domElement.addEventListener("pointermove", (event) => {
    hovered = true;
    if (!dragging) { setPointer(event); const markerHit = visibleMarkerHit(); hoveredMarker = markerHit ? markerHit.object.userData.id : ""; renderer.domElement.style.cursor = hoveredMarker ? "pointer" : "grab"; return; }
    hoveredMarker = ""; renderer.domElement.style.cursor = "grabbing";
    const dx = event.clientX - pointerX; const dy = event.clientY - pointerY;
    dragDistance += Math.abs(dx) + Math.abs(dy);
    theta -= dx * .006; phi = Math.max(.2, Math.min(1.51, phi - dy * .006));
    pointerX = event.clientX; pointerY = event.clientY;
  });
  renderer.domElement.addEventListener("pointerleave", () => { hovered = false; hoveredMarker = ""; renderer.domElement.style.cursor = "grab"; });
  renderer.domElement.addEventListener("pointerup", (event) => {
    dragging = false;
    if (dragDistance > 6) return;
    setPointer(event);
    const markerHit = visibleMarkerHit();
    if (markerHit) { void openAlert(markerHit.object.userData.id); return; }
    const floorHit = raycaster.intersectObjects(hitObjects, false)[0];
    if (floorHit) selectFloor(floorHit.object.userData.building, floorHit.object.userData.floor);
  });
  renderer.domElement.addEventListener("wheel", (event) => { event.preventDefault(); stopReturnTransition(); desiredRadius = Math.max(5, Math.min(48, desiredRadius * (event.deltaY > 0 ? 1.1 : .9))); }, { passive: false });
}

/* ---------------------------------------------------------------------------
 * 列表 / 楼层 / 详情
 * ------------------------------------------------------------------------- */

/** @returns {void} */
function renderStats() {
  el("statBuildings").textContent = String(buildings.length).padStart(2, "0");
  el("statUrgent").textContent = String(alerts.filter((alert) => alert.level === 3).length).padStart(2, "0");
  el("statAlerts").textContent = String(alerts.length).padStart(2, "0");
  el("alertCount").textContent = String(alerts.length).padStart(2, "0");
  el("listCount").textContent = `共 ${alerts.length} 条`;
}

/** @returns {void} */
function renderList() {
  const list = el("alertList");
  list.replaceChildren();
  const sorted = [...alerts].sort((a, b) => b.level - a.level || b.occurred_at.localeCompare(a.occurred_at));
  for (const alert of sorted) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "alert-card";
    button.innerHTML = `<span class="alert-card-top"><strong>${escapeHtml(alert.type)}</strong><span class="level ${levelClass(alert.level)}">${levelName(alert.level)}</span></span><span class="alert-location">${escapeHtml(buildingName(alert.building))} · ${escapeHtml(alert.unit)} · ${alert.floor}层 ${escapeHtml(alert.room)}室</span><span class="alert-card-bottom"><span>${formatClock(alert.occurred_at)}</span><b>${escapeHtml(alert.status)} →</b></span>`;
    button.addEventListener("click", () => { void openAlert(alert.id); });
    list.appendChild(button);
  }
}

/** @param {string} id @returns {void} */
function selectBuilding(id) {
  stopReturnTransition();
  selectedBuilding = id; selectedFloor = 0; selectedAlert = "";
  for (const [key, tower] of towerObjects) { tower.selection.visible = key === id; tower.floorHighlight.visible = false; }
  const tower = towerObjects.get(id);
  if (tower) { tower.group.getWorldPosition(desiredTarget); desiredTarget.y = 5.1; }
  desiredRadius = 15;
  el("floorPicker").hidden = false;
  el("pickerTitle").textContent = `${buildingName(id)} · 选择楼层`;
  renderFloors();
  el("sceneHint").textContent = "已定位楼栋，点击模型楼层或右上方楼层编号";
}

/** @returns {void} */
function renderFloors() {
  const grid = el("floorGrid");
  grid.replaceChildren();
  for (let floor = 35; floor >= 1; floor--) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(floor);
    const floorAlerts = alerts.filter((alert) => alert.building === selectedBuilding && alert.floor === floor);
    const highestLevel = Math.max(0, ...floorAlerts.map((alert) => alert.level));
    button.classList.toggle("active", floor === selectedFloor);
    if (highestLevel > 0) { button.classList.add("has-alert", levelClass(highestLevel)); button.title = `${floor}层 · ${levelName(highestLevel)}告警`; }
    button.addEventListener("click", () => selectFloor(selectedBuilding, floor));
    grid.appendChild(button);
  }
}

/** @param {string} id @param {number} floor @returns {void} */
function selectFloor(id, floor) {
  if (selectedBuilding !== id) selectBuilding(id);
  selectedFloor = floor;
  const tower = towerObjects.get(id);
  if (tower) {
    tower.floorHighlight.visible = true;
    tower.floorHighlight.position.y = (floor - .5) * FLOOR_HEIGHT;
    const focus = new THREE.Vector3(0, (floor - .5) * FLOOR_HEIGHT, 0);
    tower.group.localToWorld(focus);
    desiredTarget.copy(focus);
  }
  desiredRadius = 11;
  renderFloors();
  el("sceneHint").textContent = `${buildingName(id)} · ${floor}层${alerts.some((alert) => alert.building === id && alert.floor === floor) ? " · 此层有告警" : ""}`;
}

/** @param {string} id @returns {Promise<void>} */
async function openAlert(id) {
  const alert = getAlert(id);
  if (!alert) { showToast("该告警已不存在，请刷新列表"); return; }
  selectFloor(alert.building, alert.floor);
  selectedAlert = id;
  desiredRadius = 12;
  const marker = markerObjects.get(id);
  if (marker) marker.group.getWorldPosition(desiredTarget);
  layoutChanging = !workspace.classList.contains("detail-open") && window.matchMedia("(min-width: 1051px)").matches;
  workspace.classList.add("detail-open");
  el("listView").hidden = true;
  const detail = el("detailView");
  detail.hidden = false;
  const resident = residentForAlert(alert);
  const cardEntry = resident
    ? `<div class="elder-dropdown" id="elderDropdown"><button class="elder-dropdown__trigger" id="elderTrigger" type="button" aria-expanded="false" aria-controls="elderDropdownPanel" data-alert-id="${escapeHtml(alert.id)}" data-resident-id="${escapeHtml(resident.id)}"><span class="elder-dropdown__dot" aria-hidden="true"></span><span class="elder-dropdown__label">查看住户简介</span><span class="elder-dropdown__hint">点击打开简介页</span><svg class="elder-dropdown__chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 5.5 8 10.5 13 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`
    : `<div class="elder-empty">该住户暂无身份卡片，仅显示事件位置与设备依据。</div>`;
  detail.innerHTML = `<div class="detail-content"><button class="detail-back" id="backButton" type="button">← 返回列表</button><span class="panel-kicker">ALERT DETAIL / ${escapeHtml(alert.id)}</span><h2 class="detail-title">${escapeHtml(alert.type)}</h2><p class="detail-sub">告警点已在左侧模型中定位</p><div class="detail-hero"><span class="level ${levelClass(alert.level)}">${levelName(alert.level)}告警</span><p>${escapeHtml(alert.description)}</p></div><div class="detail-grid"><div><span>住户位置</span><b>${escapeHtml(buildingName(alert.building))}<br>${escapeHtml(alert.unit)} ${alert.floor}层 ${escapeHtml(alert.room)}室</b></div><div><span>发生时间</span><b>${formatTime(alert.occurred_at)}</b></div><div><span>告警等级</span><b>${levelName(alert.level)}</b></div><div><span>处理状态</span><b id="detailStatus">${escapeHtml(alert.status)}</b></div></div><div class="detail-section"><h3>设备依据</h3><div class="evidence">${escapeHtml(alert.device)}</div></div><div class="detail-section" style="margin-top:18px"><h3>处置记录</h3><div id="historyBox"><div class="history-empty">正在载入处置记录…</div></div><label class="operator-field" for="operatorInput">处置人<input id="operatorInput" type="text" maxlength="20" value="${escapeHtml(readOperator())}"></label></div><div class="actions"><button id="contactButton" type="button">记录联系住户</button><button id="dispatchButton" class="primary" type="button">安排上门处置</button></div>${cardEntry}</div>`;
  closeElderDropdown(true);
  positionElderTrigger();
  el("backButton").addEventListener("click", closeDetail);
  el("contactButton").addEventListener("click", () => { void submitAction(alert, "记录联系住户", "已联系住户"); });
  el("dispatchButton").addEventListener("click", () => { void submitAction(alert, "安排上门处置", "已安排上门"); });
  await loadHistory(alert.id);
  positionElderTrigger();
}

/** @param {string} alertId @returns {Promise<void>} */
async function loadHistory(alertId) {
  const box = document.getElementById("historyBox");
  if (!box) return;
  try {
    const rows = await fetchActions(alertId);
    if (!rows.length) { box.innerHTML = `<div class="history-empty">暂无处置记录，操作后会写入云端。</div>`; return; }
    box.innerHTML = rows.map((row) => `<div class="history-item"><b>${escapeHtml(row.action)}</b> · ${escapeHtml(row.operator || "未记录处置人")}<time>${formatTime(row.created_at)}</time></div>`).join("");
  } catch (error) {
    box.innerHTML = `<div class="history-empty">处置记录读取失败：${escapeHtml(describeError(error))}</div>`;
  }
  positionElderTrigger();
}

/** @param {AlertData} alert @param {string} action @param {string} nextStatus @returns {Promise<void>} */
async function submitAction(alert, action, nextStatus) {
  const buttons = /** @type {HTMLButtonElement[]} */ ([document.getElementById("contactButton"), document.getElementById("dispatchButton")].filter(Boolean));
  buttons.forEach((button) => { button.disabled = true; });
  setSyncState("正在写入云端…", "loading");
  try {
    const { data, error } = await cloud.database
      .from("alerts")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", alert.id)
      .select("id,status");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("未找到该告警，状态未更新");
    alert.status = nextStatus;
    const statusNode = document.getElementById("detailStatus");
    if (statusNode) statusNode.textContent = nextStatus;
    renderList();
    const { error: logError } = await cloud.database
      .from("alert_actions")
      .insert({ alert_id: alert.id, action, operator: currentOperator() });
    if (logError) throw new Error(`状态已更新，但处置记录写入失败：${describeError(logError)}`);
    showToast(`${alert.id}：${action}，已写入云端`);
    setSyncState("云端数据已同步", "ok");
    await loadHistory(alert.id);
  } catch (error) {
    showToast(`操作失败：${describeError(error)}`);
    setSyncState("云端写入失败", "error");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

/** @returns {void} */
function closeDetail() {
  selectedAlert = "";
  closeElderDropdown(true);
  layoutChanging = workspace.classList.contains("detail-open") && window.matchMedia("(min-width: 1051px)").matches;
  workspace.classList.remove("detail-open");
  el("listView").hidden = false;
  el("detailView").hidden = true;
  desiredTarget.set(0, 4.4, 0);
  desiredRadius = 31;
}

/** @returns {void} */
function resetView() {
  const fromTarget = target.clone();
  const fromRadius = radius;
  const fromTheta = theta;
  const fromPhi = phi;
  const fromRotation = neighborhood ? neighborhood.rotation.y : 0;
  selectedBuilding = ""; selectedFloor = 0; selectedAlert = "";
  for (const tower of towerObjects.values()) { tower.selection.visible = false; tower.floorHighlight.visible = false; }
  closeDetail();
  el("floorPicker").hidden = true;
  el("sceneHint").textContent = "正在返回社区视角";
  returnTransition = { started: performance.now(), duration: 950, fromTarget, fromRadius, fromTheta, toTheta: .56 + Math.round((fromTheta - .56) / (Math.PI * 2)) * Math.PI * 2, fromPhi, fromRotation, toRotation: Math.round(fromRotation / (Math.PI * 2)) * Math.PI * 2 };
}

/** @returns {void} */
function stopReturnTransition() {
  if (!returnTransition) return;
  returnTransition = null;
  desiredTarget.copy(target);
  desiredRadius = radius;
}

let lastTime = performance.now();
/** @param {number} time @returns {void} */
function animate(time) {
  const delta = Math.min((time - lastTime) / 1000, .05); lastTime = time;
  if (!renderer || !camera || !neighborhood) return;
  if (returnTransition) {
    const transition = returnTransition;
    const progress = Math.min((time - transition.started) / transition.duration, 1);
    const eased = progress * progress * (3 - 2 * progress);
    target.copy(transition.fromTarget).lerp(desiredTarget, eased);
    radius = transition.fromRadius + (desiredRadius - transition.fromRadius) * eased;
    theta = transition.fromTheta + (transition.toTheta - transition.fromTheta) * eased;
    phi = transition.fromPhi + (1.13 - transition.fromPhi) * eased;
    neighborhood.rotation.y = transition.fromRotation + (transition.toRotation - transition.fromRotation) * eased;
    if (progress === 1) { returnTransition = null; el("sceneHint").textContent = "点击楼栋查看楼层"; }
  } else {
    if (!userPaused && !hovered && !dragging && !selectedBuilding && !selectedAlert) neighborhood.rotation.y += delta * .085;
    target.lerp(desiredTarget, .08);
    radius += (desiredRadius - radius) * .08;
  }
  camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
  for (const [id, marker] of markerObjects) {
    const active = id === selectedAlert;
    const over = id === hoveredMarker;
    marker.dot.scale.setScalar(over ? 1.48 : 1);
    marker.halo.scale.setScalar(over ? 1.65 : active ? 1.2 + Math.sin(time * .006) * .25 : 1 + Math.sin(time * .003) * .12);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

/* === 住户简介页 · 视口居中模态浮层（React Bits 官方 ProfileCard · iframe）===
   触发器绝对定位于事件页原有留白；遮罩与浮层均用 fixed 定位，不参与文档流：
   页面高度、滚动位置与所有既有元素尺寸都和原版一致。 */
let elderTriggerObserver = null;
/** @type {WeakSet<Element>} */ const observedElderActions = new WeakSet();

/** @returns {void} */
function positionElderTrigger() {
  const dropdown = document.getElementById("elderDropdown");
  const actions = document.querySelector(".detail-content .actions");
  if (!dropdown || !actions) return;
  if (!elderTriggerObserver) elderTriggerObserver = new ResizeObserver(() => positionElderTrigger());
  if (!observedElderActions.has(actions)) {
    observedElderActions.add(actions);
    elderTriggerObserver.observe(actions);
  }
  const content = actions.closest(".detail-content");
  if (content && !observedElderActions.has(content)) {
    observedElderActions.add(content);
    elderTriggerObserver.observe(content);
  }
  dropdown.style.top = `${actions.offsetTop + actions.offsetHeight + 16}px`;
}

/** @returns {HTMLElement} */
function elderPanel() {
  let panel = document.getElementById("elderDropdownPanel");
  if (panel) return panel;
  const overlay = document.createElement("div");
  overlay.id = "elderOverlay";
  overlay.className = "elder-overlay";
  overlay.hidden = true;
  panel = document.createElement("div");
  panel.id = "elderDropdownPanel";
  panel.className = "elder-modal";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "住户简介");
  panel.hidden = true;
  panel.innerHTML = `<button class="elder-modal__close" type="button" aria-label="关闭住户简介"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button><iframe class="elder-card-frame" title="住户简介" scrolling="no"></iframe>`;
  document.body.append(overlay, panel);
  return panel;
}

/** @returns {void} */
function openElderDropdown() {
  const dropdown = document.getElementById("elderDropdown");
  const trigger = document.getElementById("elderTrigger");
  if (!dropdown || !trigger) return;
  const panel = elderPanel();
  const overlay = document.getElementById("elderOverlay");
  const frame = /** @type {HTMLIFrameElement} */ (panel.querySelector(".elder-card-frame"));
  const id = trigger.dataset.residentId || trigger.dataset.alertId || "";
  if (frame.dataset.residentId !== id) {
    frame.src = `profile-card/dist/index.html?id=${encodeURIComponent(id)}`;
    frame.dataset.residentId = id;
  }
  if (overlay) overlay.hidden = false;
  panel.hidden = false;
  dropdown.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
  const hint = trigger.querySelector(".elder-dropdown__hint");
  if (hint) hint.textContent = "点击关闭简介页";
  positionElderTrigger();
}

/** @param {boolean} remove @returns {void} */
function closeElderDropdown(remove) {
  const dropdown = document.getElementById("elderDropdown");
  if (dropdown) {
    dropdown.classList.remove("is-open");
    const trigger = document.getElementById("elderTrigger");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      const hint = trigger.querySelector(".elder-dropdown__hint");
      if (hint) hint.textContent = "点击打开简介页";
    }
  }
  const panel = document.getElementById("elderDropdownPanel");
  const overlay = document.getElementById("elderOverlay");
  if (!panel) return;
  if (remove) {
    panel.remove();
    if (overlay) overlay.remove();
    return;
  }
  panel.hidden = true;
  if (overlay) overlay.hidden = true;
}

/** @returns {void} */
function toggleElderDropdown() {
  const dropdown = document.getElementById("elderDropdown");
  if (!dropdown) return;
  if (dropdown.classList.contains("is-open")) closeElderDropdown(false);
  else openElderDropdown();
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("#elderTrigger")) { toggleElderDropdown(); return; }
  if (event.target.closest(".elder-modal__close") || event.target.closest(".elder-overlay")) { closeElderDropdown(false); return; }
  if (event.target.closest(".elder-modal")) return;
  const dropdown = document.getElementById("elderDropdown");
  if (dropdown && dropdown.classList.contains("is-open")) closeElderDropdown(false);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeElderDropdown(false); });
window.addEventListener("resize", positionElderTrigger);

/* 接收 iframe 内官方卡片「联系家属」按钮的回传，复用页面既有 toast；
   同时把 iframe 内的滚轮转发给页面，保证滚动不被吞掉。 */
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  const frame = document.querySelector(".elder-card-frame");
  if (frame && event.source !== frame.contentWindow) return;
  if (data.type === "elder-card-wheel") { window.scrollBy(0, data.deltaY); return; }
  if (data.type !== "elder-card-contact") return;
  showToast(`${data.name}：已通知紧急联系人 ${data.contactName} ${data.contactPhone}（原型演示）`);
});

/* ---------------------------------------------------------------------------
 * 登录角色与管理员事件
 * ------------------------------------------------------------------------- */

/** @param {{username:string,role:"grid"|"admin",displayName:string}} session @returns {void} */
function applySession(session) {
  currentSession = session;
  const existing = document.getElementById("accountChip");
  if (existing) existing.remove();
  const heading = document.querySelector(".page-heading");
  if (heading) {
    const chip = document.createElement("div");
    chip.className = "account-chip";
    chip.id = "accountChip";
    const roleLabel = session.role === "admin" ? "平台管理员" : "社区网格员";
    chip.innerHTML = `<span class="account-role">${roleLabel}</span><span>${escapeHtml(session.displayName)}</span><button id="logoutButton" type="button">退出</button>`;
    heading.append(chip);
    const logoutButton = chip.querySelector("#logoutButton");
    if (logoutButton) logoutButton.addEventListener("click", () => { window.AnxiangAuth.logout(); });
  }
  const addButton = /** @type {HTMLButtonElement|null} */ (document.getElementById("addEventButton"));
  if (addButton) addButton.hidden = session.role !== "admin";
}

/** @returns {string} */
function nextAlertId() {
  let max = 0;
  for (const alert of alerts) {
    const match = /^AX-(\d+)$/.exec(alert.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let next = max + 1;
  let id = `AX-${String(next).padStart(3, "0")}`;
  while (alerts.some((alert) => alert.id === id)) {
    next += 1;
    id = `AX-${String(next).padStart(3, "0")}`;
  }
  return id;
}

/** @param {HTMLSelectElement} residentSelect @returns {{ok:boolean,error?:string,location?:{building:string,floor:number,unit:string,room:string},label?:string}} */
function resolveAdminLocation(residentSelect) {
  if (residentSelect.value === "__custom__") {
    const buildingSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("adminBuilding"));
    const floorInput = /** @type {HTMLInputElement|null} */ (document.getElementById("adminFloor"));
    const unitInput = /** @type {HTMLInputElement|null} */ (document.getElementById("adminUnit"));
    const roomInput = /** @type {HTMLInputElement|null} */ (document.getElementById("adminRoom"));
    if (!buildingSelect || !floorInput || !unitInput || !roomInput) return { ok: false, error: "自定义位置字段缺失" };
    const building = buildingSelect.value;
    const floor = Number(floorInput.value);
    const unit = unitInput.value.trim();
    const room = roomInput.value.trim();
    if (!getBuilding(building)) return { ok: false, error: "请选择楼栋" };
    if (!Number.isInteger(floor) || floor < 1 || floor > 35) return { ok: false, error: "楼层需为 1–35 的整数" };
    if (!unit) return { ok: false, error: "请填写单元" };
    if (!room) return { ok: false, error: "请填写房号" };
    return {
      ok: true,
      location: { building, floor, unit, room },
      label: `${buildingName(building)} ${unit} ${floor}层 ${room}室`
    };
  }
  const resident = residentById(residentSelect.value);
  if (!resident) return { ok: false, error: "请选择住户" };
  return {
    ok: true,
    location: { building: resident.building, floor: resident.floor, unit: resident.unit, room: resident.room },
    label: `${resident.name} · ${buildingName(resident.building)} ${resident.unit} ${resident.floor}层 ${resident.room}室`
  };
}

/** @type {HTMLElement|null} */
let adminPanel = null;

/** @returns {HTMLElement} */
function adminFormPanel() {
  if (adminPanel) return adminPanel;
  const overlay = document.createElement("div");
  overlay.id = "adminOverlay";
  overlay.className = "admin-overlay";
  overlay.hidden = true;
  const panel = document.createElement("div");
  panel.id = "adminModal";
  panel.className = "admin-modal";
  panel.hidden = true;
  const residentOptions = RESIDENT_DIRECTORY.map((resident) =>
    `<option value="${escapeHtml(resident.id)}">${escapeHtml(resident.name)} · ${escapeHtml(buildingName(resident.building))} ${escapeHtml(resident.unit)} ${resident.floor}层 ${escapeHtml(resident.room)}室</option>`
  ).join("") + '<option value="__custom__">其他住户（手动填写位置）</option>';
  const buildingOptions = buildings.map((building) =>
    `<option value="${escapeHtml(building.id)}">${escapeHtml(building.name)}</option>`
  ).join("");
  panel.innerHTML = `<form class="admin-form" id="adminEventForm"><h2>添加住户事件</h2><p class="admin-form__hint">已有住户会自动关联身份卡片；其他住户只记录楼栋、楼层、单元和房号。事件会写入云端数据库，网格员刷新后即可看到。</p><label for="adminResident">住户<select id="adminResident" required>${residentOptions}</select></label><div class="admin-custom" id="adminCustom" hidden><label for="adminBuilding">楼栋<select id="adminBuilding">${buildingOptions}</select></label><div class="admin-inline"><label for="adminFloor">楼层<input id="adminFloor" type="number" min="1" max="35" value="1"></label><label for="adminUnit">单元<input id="adminUnit" type="text" maxlength="10" placeholder="如 1单元"></label><label for="adminRoom">房号<input id="adminRoom" type="text" maxlength="10" placeholder="如 501"></label></div><p class="admin-form__hint">该住户暂无身份卡片时，事件只显示位置与核实信息，不会冒用其他住户的卡片。</p></div><label for="adminType">事件类型<input id="adminType" type="text" list="adminTypeList" value="疑似跌倒" required><datalist id="adminTypeList"><option value="疑似跌倒"></option><option value="疑似跌倒后未回应"></option><option value="主动求助"></option><option value="异常长时间静止"></option><option value="活动异常待观察"></option><option value="燃气浓度异常"></option><option value="烟雾浓度异常"></option></datalist></label><label for="adminLevel">风险等级<select id="adminLevel"><option value="3">紧急</option><option value="2">较高</option><option value="1">关注</option></select></label><label for="adminDevice">设备依据<input id="adminDevice" type="text" value="管理员手动添加" maxlength="100"></label><label for="adminDescription">事件描述<textarea id="adminDescription" rows="4" maxlength="300" placeholder="说明事件依据和需要核实的内容" required></textarea></label><p class="admin-error" id="adminError" hidden></p><div class="admin-form__actions"><button id="adminCancel" type="button">取消</button><button id="adminSubmit" type="submit" class="primary">写入云端</button></div></form>`;
  document.body.append(overlay, panel);
  adminPanel = panel;
  overlay.addEventListener("click", () => { closeAdminForm(); });
  const form = panel.querySelector("#adminEventForm");
  if (form) form.addEventListener("submit", (event) => { void submitAdminEvent(/** @type {SubmitEvent} */ (event)); });
  const cancel = panel.querySelector("#adminCancel");
  if (cancel) cancel.addEventListener("click", () => { closeAdminForm(); });
  const residentSelect = /** @type {HTMLSelectElement|null} */ (panel.querySelector("#adminResident"));
  const customFields = panel.querySelector("#adminCustom");
  if (residentSelect && customFields) {
    residentSelect.addEventListener("change", () => {
      customFields.hidden = residentSelect.value !== "__custom__";
    });
  }
  return panel;
}

/** @returns {void} */
function openAdminForm() {
  if (!currentSession || currentSession.role !== "admin") return;
  if (!cloud || buildings.length === 0) {
    showToast("云端数据尚未就绪，请稍后再试");
    return;
  }
  const panel = adminFormPanel();
  const overlay = document.getElementById("adminOverlay");
  const form = /** @type {HTMLFormElement|null} */ (document.getElementById("adminEventForm"));
  const error = document.getElementById("adminError");
  if (form) form.reset();
  const device = /** @type {HTMLInputElement|null} */ (document.getElementById("adminDevice"));
  if (device) device.value = "管理员手动添加";
  const residentSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("adminResident"));
  if (residentSelect) residentSelect.dispatchEvent(new Event("change", { bubbles: true }));
  if (error) { error.hidden = true; error.textContent = ""; }
  if (overlay) overlay.hidden = false;
  panel.hidden = false;
  const type = /** @type {HTMLInputElement|null} */ (document.getElementById("adminType"));
  if (type) type.focus();
}

/** @returns {void} */
function closeAdminForm() {
  const panel = document.getElementById("adminModal");
  const overlay = document.getElementById("adminOverlay");
  if (panel) panel.hidden = true;
  if (overlay) overlay.hidden = true;
}

/** @param {SubmitEvent} event @returns {Promise<void>} */
async function submitAdminEvent(event) {
  event.preventDefault();
  if (!currentSession || currentSession.role !== "admin") return;
  const residentSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("adminResident"));
  const typeInput = /** @type {HTMLInputElement|null} */ (document.getElementById("adminType"));
  const levelSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById("adminLevel"));
  const deviceInput = /** @type {HTMLInputElement|null} */ (document.getElementById("adminDevice"));
  const descriptionInput = /** @type {HTMLTextAreaElement|null} */ (document.getElementById("adminDescription"));
  const errorBox = document.getElementById("adminError");
  const submitButton = /** @type {HTMLButtonElement|null} */ (document.getElementById("adminSubmit"));
  if (!residentSelect || !typeInput || !levelSelect || !deviceInput || !descriptionInput || !errorBox || !submitButton) return;
  const resolved = resolveAdminLocation(residentSelect);
  const type = typeInput.value.trim();
  const description = descriptionInput.value.trim();
  if (!resolved.ok || !resolved.location) {
    errorBox.textContent = resolved.error || "请选择住户";
    errorBox.hidden = false;
    return;
  }
  if (!type || !description) {
    errorBox.textContent = "请填写事件类型和事件描述";
    errorBox.hidden = false;
    return;
  }
  const location = resolved.location;
  const id = nextAlertId();
  const level = Number(levelSelect.value);
  submitButton.disabled = true;
  errorBox.hidden = true;
  setSyncState("正在写入云端…", "loading");
  try {
    const { data, error } = await cloud.database
      .from("alerts")
      .insert({
        id,
        building_id: location.building,
        floor: location.floor,
        unit: location.unit,
        room: location.room,
        type,
        level,
        occurred_at: new Date().toISOString(),
        device: deviceInput.value.trim() || "管理员手动添加",
        status: "待核实",
        description
      })
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("写入失败，云端未返回新事件");
    closeAdminForm();
    showToast(`已添加事件 ${id} · ${resolved.label || "住户事件"}`);
    await refreshAlerts(false);
  } catch (error) {
    errorBox.textContent = `添加失败：${describeError(error)}`;
    errorBox.hidden = false;
    setSyncState("云端写入失败", "error");
  } finally {
    submitButton.disabled = false;
  }
}

const addEventButton = /** @type {HTMLButtonElement|null} */ (document.getElementById("addEventButton"));
if (addEventButton) addEventButton.addEventListener("click", openAdminForm);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const panel = document.getElementById("adminModal");
  if (panel && !panel.hidden) closeAdminForm();
});

/* ---------------------------------------------------------------------------
 * 启动与刷新
 * ------------------------------------------------------------------------- */

/** @param {boolean} showFeedback @returns {Promise<void>} */
async function refreshAlerts(showFeedback) {
  const refreshButton = /** @type {HTMLButtonElement|null} */ (document.getElementById("refreshButton"));
  if (refreshButton) refreshButton.disabled = true;
  setSyncState("正在同步云端…", "loading");
  try {
    const data = await fetchData();
    buildings = data.buildings;
    alerts = data.alerts;
    hideLoadError();
    renderStats();
    renderList();
    renderMarkers();
    if (selectedAlert) {
      const current = getAlert(selectedAlert);
      if (!current) closeDetail();
      else await loadHistory(selectedAlert);
    }
    if (selectedBuilding) renderFloors();
    setSyncState("云端数据已同步", "ok");
    if (showFeedback) showToast("已从云端刷新");
  } catch (error) {
    showLoadError(error);
    setSyncState("云端连接失败", "error");
    if (showFeedback) showToast(`刷新失败：${describeError(error)}`);
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

/** @returns {Promise<void>} */
async function boot() {
  el("todayLabel").textContent = todayLabel();
  try {
    cloud = createCloudClient();
    const data = await fetchData();
    buildings = data.buildings;
    alerts = data.alerts;
    renderStats();
    renderList();
    try {
      buildScene();
    } catch (error) {
      el("sceneHint").textContent = "三维模型初始化失败，请改用支持 WebGL 的浏览器";
    }
    setSyncState("云端数据已同步", "ok");
  } catch (error) {
    showLoadError(error);
    setSyncState("云端连接失败", "error");
    el("sceneHint").textContent = "云端数据未就绪，无法加载社区模型";
  }
}

el("rotationButton").addEventListener("click", (event) => {
  userPaused = !userPaused;
  /** @type {HTMLElement} */ (event.currentTarget).textContent = userPaused ? "▶ 继续旋转" : "Ⅱ 暂停旋转";
});
el("resetButton").addEventListener("click", resetView);
el("closePicker").addEventListener("click", resetView);
el("refreshButton").addEventListener("click", () => { void refreshAlerts(true); });

if (!window.AnxiangAuth) throw new Error("static-auth.js 未加载，无法启动登录流程");
window.AnxiangAuth.init({
  onAuthenticated: (session) => {
    applySession(session);
    void boot();
  }
});
