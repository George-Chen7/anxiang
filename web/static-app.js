// @ts-check
"use strict";

/** @typedef {{id:string,name:string,x:number,z:number}} BuildingData */
/** @typedef {{id:string,building:string,floor:number,unit:string,room:string,type:string,level:number,time:string,device:string,status:string,description:string}} AlertData */

/** @type {BuildingData[]} */
const buildings = [
  {id:"A1",name:"A区 1号楼",x:-6.4,z:-3.7},
  {id:"A2",name:"A区 2号楼",x:-5.5,z:3.1},
  {id:"B3",name:"B区 3号楼",x:4.4,z:-4.0},
  {id:"C2",name:"C区 2号楼",x:-0.1,z:2.5},
  {id:"B5",name:"B区 5号楼",x:5.7,z:3.7}
];
/** @type {AlertData[]} */
const alerts = [
  {id:"AX-001",building:"B3",floor:31,unit:"2单元",room:"3102",type:"燃气浓度异常",level:3,time:"2026-11-07 09:12:40",device:"燃气传感器 CH₄-3102 · 18% LEL",status:"待核实",description:"住户厨房燃气浓度连续 3 次超过预设阈值，请尽快电话核实并安排现场排查。"},
  {id:"AX-002",building:"A1",floor:22,unit:"1单元",room:"2201",type:"烟雾浓度异常",level:3,time:"2026-11-07 08:56:20",device:"烟雾探测器 SM-2201 · 86 ppm",status:"处理中",description:"烟雾探测器持续上报异常，值班人员需联系住户并确认现场情况。"},
  {id:"AX-003",building:"B5",floor:17,unit:"2单元",room:"1702",type:"独居关怀提醒",level:2,time:"2026-11-07 08:31:10",device:"活动感应器 AC-1702 · 12 小时未检测到活动",status:"待核实",description:"住户活动信号长时间未更新，建议先电话联系，再视情况上门关怀。"},
  {id:"AX-004",building:"A2",floor:28,unit:"1单元",room:"2801",type:"用水异常",level:2,time:"2026-11-07 07:41:12",device:"智能水表 WM-2801 · 连续流量异常",status:"待核实",description:"智能水表出现持续用水记录，建议联系住户确认是否存在漏水。"},
  {id:"AX-005",building:"C2",floor:12,unit:"2单元",room:"1202",type:"门磁长时开启",level:1,time:"2026-11-07 07:13:00",device:"门磁传感器 DC-1202 · 开启 48 分钟",status:"已通知",description:"住户入户门保持开启超过设定时长，请联系住户确认。"}
];

const sceneElement = /** @type {HTMLElement} */ (document.getElementById("scene"));
const workspace = /** @type {HTMLElement} */ (document.getElementById("workspace"));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38,1,.1,120);
const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sceneElement.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0xb5c3ae,.88));
const sun = new THREE.DirectionalLight(0xffffff,.92);
sun.position.set(-12,22,14);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-20;sun.shadow.camera.right=20;sun.shadow.camera.top=20;sun.shadow.camera.bottom=-20;scene.add(sun);
const neighborhood = new THREE.Group();scene.add(neighborhood);
const materials = {
  wall:new THREE.MeshStandardMaterial({color:0xe5e3db,roughness:.92}),
  side:new THREE.MeshStandardMaterial({color:0xd4d9d0,roughness:.9}),
  balcony:new THREE.MeshStandardMaterial({color:0xbfcfc8,roughness:.75}),
  glass:new THREE.MeshStandardMaterial({color:0x779da2,roughness:.35,metalness:.12}),
  entry:new THREE.MeshStandardMaterial({color:0x587c78,roughness:.5}),
  roof:new THREE.MeshStandardMaterial({color:0xd7dcd3,roughness:.85}),
  grass:new THREE.MeshStandardMaterial({color:0xdde9d8,roughness:1}),
  path:new THREE.MeshStandardMaterial({color:0xede9df,roughness:1}),
  selected:new THREE.MeshStandardMaterial({color:0x8bc5a9,transparent:true,opacity:.26,depthWrite:false,side:THREE.DoubleSide}),
  floor:new THREE.MeshStandardMaterial({color:0x82bd97,transparent:true,opacity:.45,depthWrite:false,side:THREE.DoubleSide}),
  urgent:new THREE.MeshBasicMaterial({color:0xd85651,depthTest:false}),
  high:new THREE.MeshBasicMaterial({color:0xe68b57,depthTest:false}),
  watch:new THREE.MeshBasicMaterial({color:0xd7af54,depthTest:false})
};
const FLOOR_HEIGHT=.275;
const TOWER_HEIGHT=35*FLOOR_HEIGHT;
/** @type {Map<string,any>} */ const towerObjects=new Map();
/** @type {Map<string,any>} */ const markerObjects=new Map();
/** @type {any[]} */ const hitObjects=[];
/** @type {any[]} */ const markerHits=[];
let selectedBuilding="";
let selectedFloor=0;
let selectedAlert="";
let userPaused=false;
let hovered=false;
let hoveredMarker="";
let dragging=false;
let pointerX=0;
let pointerY=0;
let dragDistance=0;
let radius=31;
let theta=.56;
let phi=1.13;
const target=new THREE.Vector3(0,4.4,0);
const desiredTarget=new THREE.Vector3(0,4.4,0);
let desiredRadius=31;
const raycaster=new THREE.Raycaster();
const pointer=new THREE.Vector2();

/** @param {number} width @param {number} height @param {number} depth @param {any} material @param {number} x @param {number} y @param {number} z @returns {any} */
function box(width,height,depth,material,x,y,z){const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;}
/** @param {string} label @returns {any} */
function labelSprite(label){const canvas=document.createElement("canvas");canvas.width=320;canvas.height=72;const context=canvas.getContext("2d");if(!context)throw new Error("无法创建楼栋标签画布");context.fillStyle="rgba(255,253,249,.94)";context.beginPath();context.roundRect(4,4,312,64,17);context.fill();context.fillStyle="#315d4f";context.font="bold 29px Microsoft YaHei, sans-serif";context.textAlign="center";context.fillText(label,160,47);const texture=new THREE.CanvasTexture(canvas);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));sprite.scale.set(2.2,.5,1);return sprite;}
/** @param {BuildingData} data @returns {void} */
function createBuilding(data){
  const group=new THREE.Group();group.position.set(data.x,0,data.z);neighborhood.add(group);
  group.add(box(2.15,TOWER_HEIGHT,1.55,materials.wall,0,TOWER_HEIGHT/2,0));
  group.add(box(.16,TOWER_HEIGHT,1.55,materials.side,1.1,TOWER_HEIGHT/2,0));
  group.add(box(2.32,.18,1.72,materials.roof,0,TOWER_HEIGHT+.08,0));
  group.add(box(.82,.45,.12,materials.entry,0,.24,.82));
  group.add(box(.98,.07,.46,materials.roof,0,.49,.93));
  const selection=box(2.38,TOWER_HEIGHT+.18,1.83,materials.selected,0,TOWER_HEIGHT/2,0);selection.visible=false;group.add(selection);
  const floorHighlight=box(2.42,FLOOR_HEIGHT,1.88,materials.floor,0,.5,0);floorHighlight.visible=false;group.add(floorHighlight);
  for(let floor=1;floor<=35;floor++){
    const y=(floor-.5)*FLOOR_HEIGHT;
    for(const x of [-.62,.62]){
      group.add(box(.43,.16,.025,materials.glass,x,y,.795));
      group.add(box(.56,.028,.25,materials.balcony,x,y-.10,.91));
      group.add(box(.025,.11,.22,materials.balcony,x-.28,y-.045,.91));
      group.add(box(.025,.11,.22,materials.balcony,x+.28,y-.045,.91));
      group.add(box(.46,.16,.025,materials.glass,x,y,-.795));
    }
    group.add(box(2.2,.012,1.61,materials.side,0,floor*FLOOR_HEIGHT,0));
    const hit=box(2.36,FLOOR_HEIGHT,1.83,new THREE.MeshBasicMaterial({visible:false}),0,y,0);
    hit.userData={kind:"floor",building:data.id,floor};group.add(hit);hitObjects.push(hit);
  }
  const label=labelSprite(data.name);label.position.set(0,TOWER_HEIGHT+.75,0);group.add(label);
  towerObjects.set(data.id,{group,selection,floorHighlight,data});
}
for(const building of buildings)createBuilding(building);
neighborhood.add(box(19,.14,15,materials.grass,0,-.12,0));
for(const z of [-1.1,1.2])neighborhood.add(box(17,.015,.66,materials.path,0,-.03,z));
for(const x of [-2.9,2.4])neighborhood.add(box(.63,.015,13,materials.path,x,-.02,0));

/** @param {AlertData} alert @returns {void} */
function createMarker(alert){const tower=towerObjects.get(alert.building);const material=alert.level===3?materials.urgent:alert.level===2?materials.high:materials.watch;const y=(alert.floor-.5)*FLOOR_HEIGHT;const x=alert.room.endsWith("01")?-.62:.62;const group=new THREE.Group();group.position.set(x,y,1.07);tower.group.add(group);const halo=new THREE.Mesh(new THREE.SphereGeometry(.19,16,12),new THREE.MeshBasicMaterial({color:material.color,transparent:true,opacity:.19,depthTest:false}));halo.renderOrder=20;group.add(halo);const dot=new THREE.Mesh(new THREE.SphereGeometry(.095,16,12),material);dot.renderOrder=21;group.add(dot);const hit=new THREE.Mesh(new THREE.SphereGeometry(.22,16,12),new THREE.MeshBasicMaterial({visible:false}));hit.userData={kind:"alert",id:alert.id};group.add(hit);markerHits.push(hit);markerObjects.set(alert.id,{group,halo,dot,hit});}
for(const alert of alerts)createMarker(alert);

/** @param {number} level @returns {string} */
function levelName(level){return level===3?"紧急":level===2?"较高":"关注";}
/** @param {number} level @returns {string} */
function levelClass(level){return level===3?"urgent":level===2?"high":"watch";}
/** @param {string} id @returns {AlertData} */
function getAlert(id){const alert=alerts.find(item=>item.id===id);if(!alert)throw new Error(`找不到告警：${id}`);return alert;}
/** @param {string} id @returns {BuildingData} */
function getBuilding(id){const building=buildings.find(item=>item.id===id);if(!building)throw new Error(`找不到楼栋：${id}`);return building;}
/** @returns {void} */
function renderList(){const list=/** @type {HTMLElement} */(document.getElementById("alertList"));list.replaceChildren();for(const alert of [...alerts].sort((a,b)=>b.level-a.level||b.time.localeCompare(a.time))){const button=document.createElement("button");button.type="button";button.className="alert-card";button.innerHTML=`<span class="alert-card-top"><strong>${alert.type}</strong><span class="level ${levelClass(alert.level)}">${levelName(alert.level)}</span></span><span class="alert-location">${getBuilding(alert.building).name} · ${alert.unit} · ${alert.floor}层 ${alert.room}室</span><span class="alert-card-bottom"><span>${alert.time.slice(11)}</span><b>${alert.status} →</b></span>`;button.addEventListener("click",()=>openAlert(alert.id));list.appendChild(button);}}
renderList();

/** @param {string} id @returns {void} */
function selectBuilding(id){selectedBuilding=id;selectedFloor=0;selectedAlert="";for(const [key,tower] of towerObjects){tower.selection.visible=key===id;tower.floorHighlight.visible=false;}const tower=towerObjects.get(id);tower.group.getWorldPosition(desiredTarget);desiredTarget.y=5.1;desiredRadius=15;/** @type {HTMLElement} */(document.getElementById("floorPicker")).hidden=false;/** @type {HTMLElement} */(document.getElementById("pickerTitle")).textContent=`${getBuilding(id).name} · 选择楼层`;renderFloors();/** @type {HTMLElement} */(document.getElementById("sceneHint")).textContent="已定位楼栋，点击模型楼层或右上方楼层编号";}
/** @returns {void} */
function renderFloors(){const grid=/** @type {HTMLElement} */(document.getElementById("floorGrid"));grid.replaceChildren();for(let floor=35;floor>=1;floor--){const button=document.createElement("button");button.type="button";button.textContent=String(floor);button.classList.toggle("active",floor===selectedFloor);button.classList.toggle("has-alert",alerts.some(alert=>alert.building===selectedBuilding&&alert.floor===floor));button.addEventListener("click",()=>selectFloor(selectedBuilding,floor));grid.appendChild(button);}}
/** @param {string} id @param {number} floor @returns {void} */
function selectFloor(id,floor){if(selectedBuilding!==id)selectBuilding(id);selectedFloor=floor;const tower=towerObjects.get(id);tower.floorHighlight.visible=true;tower.floorHighlight.position.y=(floor-.5)*FLOOR_HEIGHT;const focus=new THREE.Vector3(0,(floor-.5)*FLOOR_HEIGHT,0);tower.group.localToWorld(focus);desiredTarget.copy(focus);desiredRadius=11;renderFloors();/** @type {HTMLElement} */(document.getElementById("sceneHint")).textContent=`${getBuilding(id).name} · ${floor}层${alerts.some(alert=>alert.building===id&&alert.floor===floor)?" · 此层有告警":""}`;}
/** @param {string} id @returns {void} */
function openAlert(id){const alert=getAlert(id);selectFloor(alert.building,alert.floor);selectedAlert=id;desiredRadius=12;const marker=markerObjects.get(id);marker.group.getWorldPosition(desiredTarget);workspace.classList.add("detail-open");/** @type {HTMLElement} */(document.getElementById("listView")).hidden=true;const detail=/** @type {HTMLElement} */(document.getElementById("detailView"));detail.hidden=false;detail.innerHTML=`<div class="detail-content"><button class="detail-back" id="backButton" type="button">← 返回列表</button><span class="panel-kicker">ALERT DETAIL / ${alert.id}</span><h2 class="detail-title">${alert.type}</h2><p class="detail-sub">告警点已在左侧模型中定位</p><div class="detail-hero"><span class="level ${levelClass(alert.level)}">${levelName(alert.level)}告警</span><p>${alert.description}</p></div><div class="detail-grid"><div><span>住户位置</span><b>${getBuilding(alert.building).name}<br>${alert.unit} ${alert.floor}层 ${alert.room}室</b></div><div><span>发生时间</span><b>${alert.time}</b></div><div><span>告警等级</span><b>${levelName(alert.level)}</b></div><div><span>处理状态</span><b id="detailStatus">${alert.status}</b></div></div><div class="detail-section"><h3>设备依据</h3><div class="evidence">${alert.device}</div></div><div class="actions"><button id="contactButton" type="button">记录联系住户</button><button id="dispatchButton" class="primary" type="button">安排上门处置</button></div><div class="elder-dropdown" id="elderDropdown"><button class="elder-dropdown__trigger" id="elderTrigger" type="button" aria-expanded="false" aria-controls="elderDropdownPanel" data-alert-id="${alert.id}"><span class="elder-dropdown__dot" aria-hidden="true"></span><span class="elder-dropdown__label">查看住户简介</span><span class="elder-dropdown__hint">点击打开简介页</span><svg class="elder-dropdown__chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 5.5 8 10.5 13 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div>`;closeElderDropdown(true);positionElderTrigger();/** @type {HTMLElement} */(document.getElementById("backButton")).addEventListener("click",closeDetail);/** @type {HTMLElement} */(document.getElementById("contactButton")).addEventListener("click",()=>updateStatus(alert,"已联系住户"));/** @type {HTMLElement} */(document.getElementById("dispatchButton")).addEventListener("click",()=>updateStatus(alert,"已安排上门"));requestAnimationFrame(resize);}
/** @param {AlertData} alert @param {string} status @returns {void} */
function updateStatus(alert,status){alert.status=status;/** @type {HTMLElement} */(document.getElementById("detailStatus")).textContent=status;renderList();showToast(`${alert.id}：${status}（仅保存于当前页面）`);}
/** @returns {void} */
function closeDetail(){selectedAlert="";workspace.classList.remove("detail-open");closeElderDropdown(true);/** @type {HTMLElement} */(document.getElementById("listView")).hidden=false;/** @type {HTMLElement} */(document.getElementById("detailView")).hidden=true;desiredTarget.set(0,4.4,0);desiredRadius=31;requestAnimationFrame(resize);}
/** @param {string} message @returns {void} */
function showToast(message){const toast=/** @type {HTMLElement} */(document.getElementById("toast"));toast.textContent=message;toast.classList.add("show");window.setTimeout(()=>toast.classList.remove("show"),2800);}
/** @returns {void} */
function resetView(){selectedBuilding="";selectedFloor=0;selectedAlert="";for(const tower of towerObjects.values()){tower.selection.visible=false;tower.floorHighlight.visible=false;}closeDetail();/** @type {HTMLElement} */(document.getElementById("floorPicker")).hidden=true;theta=.56;phi=1.13;neighborhood.rotation.y=0;/** @type {HTMLElement} */(document.getElementById("sceneHint")).textContent="点击楼栋查看楼层";}
/** @returns {void} */
function resize(){const width=sceneElement.clientWidth;const height=sceneElement.clientHeight;if(width===0||height===0)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(sceneElement);resize();
/** @param {PointerEvent} event @returns {void} */
function setPointer(event){const rect=renderer.domElement.getBoundingClientRect();pointer.x=(event.clientX-rect.left)/rect.width*2-1;pointer.y=-(event.clientY-rect.top)/rect.height*2+1;raycaster.setFromCamera(pointer,camera);}
renderer.domElement.addEventListener("pointerdown",event=>{dragging=true;dragDistance=0;pointerX=event.clientX;pointerY=event.clientY;renderer.domElement.setPointerCapture(event.pointerId);});
renderer.domElement.addEventListener("pointermove",event=>{hovered=true;if(!dragging){setPointer(event);const markerHit=raycaster.intersectObjects(markerHits,false)[0];hoveredMarker=markerHit?markerHit.object.userData.id:"";renderer.domElement.style.cursor=hoveredMarker?"pointer":"grab";return;}hoveredMarker="";renderer.domElement.style.cursor="grabbing";const dx=event.clientX-pointerX;const dy=event.clientY-pointerY;dragDistance+=Math.abs(dx)+Math.abs(dy);theta-=dx*.006;phi=Math.max(.2,Math.min(1.51,phi-dy*.006));pointerX=event.clientX;pointerY=event.clientY;});
renderer.domElement.addEventListener("pointerleave",()=>{hovered=false;hoveredMarker="";renderer.domElement.style.cursor="grab";});
renderer.domElement.addEventListener("pointerup",event=>{dragging=false;if(dragDistance>6)return;setPointer(event);const markerHit=raycaster.intersectObjects(markerHits,false)[0];if(markerHit){openAlert(markerHit.object.userData.id);return;}const floorHit=raycaster.intersectObjects(hitObjects,false)[0];if(floorHit)selectFloor(floorHit.object.userData.building,floorHit.object.userData.floor);});
renderer.domElement.addEventListener("wheel",event=>{event.preventDefault();desiredRadius=Math.max(5,Math.min(48,desiredRadius*(event.deltaY>0?1.1:.9)));},{passive:false});
/** @type {HTMLElement} */(document.getElementById("rotationButton")).addEventListener("click",event=>{userPaused=!userPaused;/** @type {HTMLElement} */(event.currentTarget).textContent=userPaused?"▶ 继续旋转":"Ⅱ 暂停旋转";});
/** @type {HTMLElement} */(document.getElementById("resetButton")).addEventListener("click",resetView);
/** @type {HTMLElement} */(document.getElementById("closePicker")).addEventListener("click",resetView);
let lastTime=performance.now();
/** @param {number} time @returns {void} */
function animate(time){const delta=Math.min((time-lastTime)/1000,.05);lastTime=time;if(!userPaused&&!hovered&&!dragging&&!selectedBuilding&&!selectedAlert)neighborhood.rotation.y+=delta*.085;target.lerp(desiredTarget,.08);radius+=(desiredRadius-radius)*.08;camera.position.set(target.x+radius*Math.sin(phi)*Math.sin(theta),target.y+radius*Math.cos(phi),target.z+radius*Math.sin(phi)*Math.cos(theta));camera.lookAt(target);for(const [id,marker] of markerObjects){const active=id===selectedAlert;const over=id===hoveredMarker;marker.dot.scale.setScalar(over?1.48:1);marker.halo.scale.setScalar(over?1.65:active?1.2+Math.sin(time*.006)*.25:1+Math.sin(time*.003)*.12);}renderer.render(scene,camera);requestAnimationFrame(animate);}
requestAnimationFrame(animate);

/* === 住户简介页 · 视口居中模态浮层（React Bits 官方 ProfileCard · iframe）===
   触发器绝对定位于事件页原有留白；遮罩与浮层均用 fixed 定位，不参与文档流：
   页面高度、滚动位置与所有既有元素尺寸都和原版完全一致，展开时不再滚动页面。 */
let elderTriggerObserver=null;
const observedElderActions=new WeakSet();
function positionElderTrigger(){
  const dd=document.getElementById("elderDropdown");
  const actions=document.querySelector(".detail-content .actions");
  if(!dd||!actions)return;
  /* .workspace 切换详情页时有 0.48s 列宽过渡，期间文字换行会改变 actions 位置，
     用 ResizeObserver 持续跟随，保证触发器始终落在既有留白里。 */
  if(!elderTriggerObserver)elderTriggerObserver=new ResizeObserver(()=>positionElderTrigger());
  if(!observedElderActions.has(actions)){observedElderActions.add(actions);elderTriggerObserver.observe(actions);}
  dd.style.top=`${actions.offsetTop+actions.offsetHeight+16}px`;
}

function elderPanel(){
  let panel=document.getElementById("elderDropdownPanel");
  if(panel)return panel;
  const overlay=document.createElement("div");
  overlay.id="elderOverlay";
  overlay.className="elder-overlay";
  overlay.hidden=true;
  panel=document.createElement("div");
  panel.id="elderDropdownPanel";
  panel.className="elder-modal";
  panel.setAttribute("role","dialog");
  panel.setAttribute("aria-modal","true");
  panel.setAttribute("aria-label","住户简介");
  panel.hidden=true;
  panel.innerHTML=`<button class="elder-modal__close" type="button" aria-label="关闭住户简介"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button><iframe class="elder-card-frame" title="住户简介" scrolling="no"></iframe>`;
  document.body.append(overlay,panel);
  return panel;
}

function openElderDropdown(){
  const dd=document.getElementById("elderDropdown");
  const trigger=document.getElementById("elderTrigger");
  if(!dd||!trigger)return;
  const panel=elderPanel();
  const overlay=document.getElementById("elderOverlay");
  const frame=panel.querySelector(".elder-card-frame");
  const id=trigger.dataset.alertId;
  if(frame.dataset.alertId!==id){frame.src=`profile-card/dist/index.html?id=${encodeURIComponent(id)}`;frame.dataset.alertId=id;}
  overlay.hidden=false;
  panel.hidden=false;
  dd.classList.add("is-open");
  trigger.setAttribute("aria-expanded","true");
  trigger.querySelector(".elder-dropdown__hint").textContent="点击关闭简介页";
  positionElderTrigger();
}

function closeElderDropdown(remove){
  const dd=document.getElementById("elderDropdown");
  if(dd){dd.classList.remove("is-open");const trigger=document.getElementById("elderTrigger");
    if(trigger){trigger.setAttribute("aria-expanded","false");const hint=trigger.querySelector(".elder-dropdown__hint");if(hint)hint.textContent="点击打开简介页";}}
  const panel=document.getElementById("elderDropdownPanel");
  const overlay=document.getElementById("elderOverlay");
  if(!panel)return;
  if(remove){panel.remove();if(overlay)overlay.remove();return;}
  panel.hidden=true;
  if(overlay)overlay.hidden=true;
}

function toggleElderDropdown(){
  const dd=document.getElementById("elderDropdown");
  if(!dd)return;
  if(dd.classList.contains("is-open"))closeElderDropdown(false);else openElderDropdown();
}

document.addEventListener("click",event=>{
  if(!(event.target instanceof Element))return;
  if(event.target.closest("#elderTrigger")){toggleElderDropdown();return;}
  if(event.target.closest(".elder-modal__close")||event.target.closest(".elder-overlay")){closeElderDropdown(false);return;}
  if(event.target.closest(".elder-modal"))return;
  const dd=document.getElementById("elderDropdown");
  if(dd&&dd.classList.contains("is-open"))closeElderDropdown(false);
});
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeElderDropdown(false);});
window.addEventListener("resize",positionElderTrigger);

/* 接收 iframe 内官方卡片「联系家属」按钮的回传，复用页面既有 toast；
   同时把 iframe 内的滚轮转发给页面，保证滚动不被吞掉。 */
window.addEventListener("message",event=>{
  const data=event.data;
  if(!data)return;
  const frame=document.querySelector(".elder-card-frame");
  if(frame&&event.source!==frame.contentWindow)return;
  if(data.type==="elder-card-wheel"){window.scrollBy(0,data.deltaY);return;}
  if(data.type!=="elder-card-contact")return;
  showToast(`${data.name}：已通知紧急联系人 ${data.contactName} ${data.contactPhone}（原型演示）`);
});
