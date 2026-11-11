// @ts-check
"use strict";

/** @typedef {{id:string,building:string,floor:number,unit:string,room:string,type:string,level:number,time:string,device:string,status:string,description:string}} AlertData */

/* 事件数据统一由 store.js（本地持久化）提供；这里保留一份快照供三维场景使用，
   数据层发生任何变更时由 syncAlerts() 增量同步告警点。 */
/** @type {AlertData[]} */
let alerts = AX.events().slice();

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

/** @param {BuildingData} data @returns {void} */
function createBuilding(data){
  const group=new THREE.Group();group.position.set(data.x,0,data.z);neighborhood.add(group);
  buildFacade(group);
  const selection=box(2.38,TOWER_HEIGHT+.18,1.83,materials.selected,0,TOWER_HEIGHT/2,0);selection.visible=false;group.add(selection);
  const floorHighlight=box(2.42,FLOOR_HEIGHT,1.88,materials.floor,0,.5,0);floorHighlight.visible=false;group.add(floorHighlight);
  for(let floor=1;floor<=35;floor++){
    const y=(floor-.5)*FLOOR_HEIGHT;
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
/** 每个告警点使用独立材质，方便随处置状态改变颜色（办结后熄灭为灰色）。
 *  @param {AlertData} alert @returns {void} */
function createMarker(alert){
  const tower=towerObjects.get(alert.building);
  if(!tower)return;
  const material=(alert.level===3?materials.urgent:alert.level===2?materials.high:materials.watch).clone();
  const haloMaterial=new THREE.MeshBasicMaterial({color:material.color,transparent:true,opacity:.19,depthTest:false});
  const y=(alert.floor-.5)*FLOOR_HEIGHT;
  const x=alert.room.endsWith("01")?-.62:.62;
  const group=new THREE.Group();group.position.set(x,y,1.07);tower.group.add(group);
  const halo=new THREE.Mesh(new THREE.SphereGeometry(.19,16,12),haloMaterial);halo.renderOrder=20;group.add(halo);
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.095,16,12),material);dot.renderOrder=21;group.add(dot);
  const hit=new THREE.Mesh(new THREE.SphereGeometry(.22,16,12),new THREE.MeshBasicMaterial({visible:false}));
  hit.userData={kind:"alert",id:alert.id};group.add(hit);markerHits.push(hit);
  markerObjects.set(alert.id,{group,halo,dot,hit,material,haloMaterial});
  applyMarkerState(alert);
}
/** @param {AlertData} alert @returns {void} */
function applyMarkerState(alert){
  const record=markerObjects.get(alert.id);if(!record)return;
  const done=alert.status===AX.STATUS.RESOLVED;
  const color=done?0x9fb3a7:alert.level===3?0xd85651:alert.level===2?0xe68b57:0xd7af54;
  record.material.color.setHex(color);
  record.material.transparent=done;record.material.opacity=done?.45:1;record.material.depthTest=!done;
  record.haloMaterial.color.setHex(color);record.haloMaterial.opacity=done?.07:.19;
  record.material.needsUpdate=true;
}
/** @param {string} id @returns {void} */
function removeMarker(id){
  const record=markerObjects.get(id);if(!record)return;
  if(record.group.parent)record.group.parent.remove(record.group);
  const index=markerHits.indexOf(record.hit);if(index>=0)markerHits.splice(index,1);
  record.material.dispose();record.haloMaterial.dispose();
  markerObjects.delete(id);
}
/** 数据层变更 → 增量同步三维告警点、列表、统计与详情状态。 @returns {void} */
function syncAlerts(){
  const next=AX.events().slice();
  const ids=new Set(next.map(item=>item.id));
  for(const id of [...markerObjects.keys()])if(!ids.has(id))removeMarker(id);
  for(const item of next){
    if(!markerObjects.has(item.id))createMarker(item);
    applyMarkerState(item);
  }
  alerts=next;
  if(selectedAlert&&!ids.has(selectedAlert))closeDetail();
  renderList();
  if(selectedBuilding)renderFloors();
  refreshSummary();
  const status=document.getElementById("detailStatus");
  if(status&&selectedAlert&&ids.has(selectedAlert))status.textContent=getAlert(selectedAlert).status;
}
/** 让顶部概览数字跟随真实事件数据。 @returns {void} */
function refreshSummary(){
  const stats=AX.stats();
  const pad=n=>String(n).padStart(2,"0");
  const today=new Date();
  const date=`${today.getFullYear()} / ${pad(today.getMonth()+1)} / ${pad(today.getDate())}`;
  const summary=document.querySelector(".summary");
  if(summary)summary.innerHTML=`<span><b>${pad(buildings.length)}</b> 栋住宅</span><span><b>${pad(stats.urgent)}</b> 条紧急</span><span><b>${pad(stats.total)}</b> 条告警</span><small>${date}</small>`;
  const counter=document.querySelector(".aside-head h2 em");if(counter)counter.textContent=pad(stats.total);
  const tools=document.querySelectorAll(".list-tools span");if(tools[1])tools[1].textContent=`共 ${stats.total} 条`;
}
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
function renderList(){
  const list=/** @type {HTMLElement} */(document.getElementById("alertList"));list.replaceChildren();
  const sorted=[...alerts].sort((a,b)=>{
    const doneA=a.status===AX.STATUS.RESOLVED?1:0;
    const doneB=b.status===AX.STATUS.RESOLVED?1:0;
    return doneA-doneB||b.level-a.level||b.time.localeCompare(a.time);
  });
  for(const alert of sorted){
    const button=document.createElement("button");button.type="button";
    button.className="alert-card"+(alert.status===AX.STATUS.RESOLVED?" is-resolved":"");
    const sourceTag=alert.source==="simulator"?'<i class="source-tag">模拟</i>':"";
    button.innerHTML=`<span class="alert-card-top"><strong>${esc(alert.type)}${sourceTag}</strong><span class="level ${levelClass(alert.level)}">${levelName(alert.level)}</span></span><span class="alert-location">${esc(getBuilding(alert.building).name)} · ${esc(alert.unit)} · ${alert.floor}层 ${esc(alert.room)}室</span><span class="alert-card-bottom"><span>${AX.fmtShort(alert.time)}</span><b>${esc(alert.status)} →</b></span>`;
    button.addEventListener("click",()=>openAlert(alert.id));list.appendChild(button);
  }
}
renderList();
refreshSummary();

/** @param {string} id @returns {void} */
function selectBuilding(id){selectedBuilding=id;selectedFloor=0;selectedAlert="";for(const [key,tower] of towerObjects){tower.selection.visible=key===id;tower.floorHighlight.visible=false;}const tower=towerObjects.get(id);tower.group.getWorldPosition(desiredTarget);desiredTarget.y=5.1;desiredRadius=15;/** @type {HTMLElement} */(document.getElementById("floorPicker")).hidden=false;/** @type {HTMLElement} */(document.getElementById("pickerTitle")).textContent=`${getBuilding(id).name} · 选择楼层`;renderFloors();/** @type {HTMLElement} */(document.getElementById("sceneHint")).textContent="已定位楼栋，点击模型楼层或右上方楼层编号";}
/** @returns {void} */
function renderFloors(){const grid=/** @type {HTMLElement} */(document.getElementById("floorGrid"));grid.replaceChildren();for(let floor=35;floor>=1;floor--){const button=document.createElement("button");button.type="button";button.textContent=String(floor);button.classList.toggle("active",floor===selectedFloor);button.classList.toggle("has-alert",alerts.some(alert=>alert.building===selectedBuilding&&alert.floor===floor));button.addEventListener("click",()=>selectFloor(selectedBuilding,floor));grid.appendChild(button);}}
/** @param {string} id @param {number} floor @returns {void} */
function selectFloor(id,floor){if(selectedBuilding!==id)selectBuilding(id);selectedFloor=floor;const tower=towerObjects.get(id);tower.floorHighlight.visible=true;tower.floorHighlight.position.y=(floor-.5)*FLOOR_HEIGHT;const focus=new THREE.Vector3(0,(floor-.5)*FLOOR_HEIGHT,0);tower.group.localToWorld(focus);desiredTarget.copy(focus);desiredRadius=11;renderFloors();/** @type {HTMLElement} */(document.getElementById("sceneHint")).textContent=`${getBuilding(id).name} · ${floor}层${alerts.some(alert=>alert.building===id&&alert.floor===floor)?" · 此层有告警":""}`;}
/** @param {string} id @returns {void} */
/** 模拟器的自定义文本会进入详情模板，统一转义避免 HTML 注入。 */
function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);}
/** 打开告警详情：只读展示 + 引导到对应角色工作台。 @param {string} id @returns {void} */
function openAlert(id){
  const alert=getAlert(id);
  const event=AX.event(id);
  selectFloor(alert.building,alert.floor);
  selectedAlert=id;desiredRadius=12;
  const marker=markerObjects.get(id);
  if(marker)marker.group.getWorldPosition(desiredTarget);
  workspace.classList.add("detail-open");
  /** @type {HTMLElement} */(document.getElementById("listView")).hidden=true;
  const detail=/** @type {HTMLElement} */(document.getElementById("detailView"));detail.hidden=false;
  const session=AX.session();
  const isGrid=!!session&&session.user.role===AX.ROLE.GRID;
  const resident=event&&event.residentId?AX.resident(event.residentId):null;
  const assignee=event&&event.assignedTo?AX.user(event.assignedTo):null;
  const template=AX.EVENT_TYPES.find(item=>item.name===alert.type);
  const advice=template?template.advice:"请联系住户核实情况，必要时安排上门查看。";
  const steps=event&&event.timeline?event.timeline.slice(-4):[];
  const stepsHtml=steps.length?steps.map(step=>`<div class="mini-step"><i></i><span><b>${esc(step.action)}</b><small>${esc(step.actorName)} · ${AX.fmtShort(step.at)}</small>${step.note?`<em>${esc(step.note)}</em>`:""}</span></div>`).join(""):'<p class="empty-note">暂无处置记录</p>';
  const profileHtml=resident
    ?`<div class="elder-dropdown" id="elderDropdown"><button class="elder-dropdown__trigger" id="elderTrigger" type="button" aria-expanded="false" aria-controls="elderDropdownPanel" data-resident-id="${esc(resident.id)}"><span class="elder-dropdown__dot" aria-hidden="true"></span><span class="elder-dropdown__label">查看住户简介</span><span class="elder-dropdown__hint">${esc(resident.name)} · 点击打开</span><svg class="elder-dropdown__chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 5.5 8 10.5 13 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`
    :`<div class="detail-no-profile">该事件未关联住户关怀档案，可在处置台手动补充联系信息。</div>`;
  detail.innerHTML=`<div class="detail-content"><button class="detail-back" id="backButton" type="button">← 返回列表</button>
    <span class="panel-kicker">ALERT DETAIL / ${esc(alert.id)}</span>
    <h2 class="detail-title">${esc(alert.type)}</h2><p class="detail-sub">告警点已在左侧模型中定位</p>
    <div class="detail-hero"><span class="level ${levelClass(alert.level)}">${levelName(alert.level)}告警</span><p>${esc(alert.description)}</p></div>
    <div class="detail-grid">
      <div><span>住户位置</span><b>${esc(getBuilding(alert.building).name)}<br>${esc(alert.unit)} ${alert.floor}层 ${esc(alert.room)}室</b></div>
      <div><span>发生时间</span><b>${esc(alert.time)}</b></div>
      <div><span>告警等级</span><b>${levelName(alert.level)}</b></div>
      <div><span>处理状态</span><b id="detailStatus">${esc(alert.status)}</b></div>
      <div><span>处置网格员</span><b>${assignee?esc(assignee.name):"未指派 · 公共事件池"}</b></div>
      <div><span>关联住户</span><b>${resident?esc(resident.name+"（"+resident.ageText+"）"):"临时住户 · 无档案"}</b></div>
      <div><span>触发来源</span><b>${event&&event.source==="simulator"?"管理员模拟器":"感知设备上报"}</b></div>
      <div><span>处置进展</span><b>${steps.length?esc(steps[steps.length-1].action):"等待接收"}</b></div>
    </div>
    <div class="detail-section"><h3>设备依据</h3><div class="evidence">${esc(alert.device)}</div></div>
    <div class="detail-section"><h3>处置建议</h3><div class="evidence advice">${esc(advice)}</div></div>
    <div class="detail-section"><h3>处置时间线</h3><div class="mini-timeline">${stepsHtml}</div></div>
    <div class="actions"><button id="detailPrimary" class="primary" type="button">${isGrid?"前往处置台":"查看处置记录"}</button><button id="detailRelocate" type="button">重新定位告警点</button></div>
    ${profileHtml}</div>`;
  closeElderDropdown(true);positionElderTrigger();
  /** @type {HTMLElement} */(document.getElementById("backButton")).addEventListener("click",closeDetail);
  /** @type {HTMLElement} */(document.getElementById("detailPrimary")).addEventListener("click",()=>{
    if(!window.AXConsole)return;
    if(isGrid)AXConsole.openTask(id);else AXConsole.openRecord(id);
  });
  /** @type {HTMLElement} */(document.getElementById("detailRelocate")).addEventListener("click",()=>{
    selectFloor(alert.building,alert.floor);showToast(`${alert.id} 已在三维模型中重新定位`);
  });
  requestAnimationFrame(resize);
}
/* 状态变更统一由 store.js 的处置流转负责，此处不再直接改写事件对象。 */
/** @returns {void} */
function closeDetail(){selectedAlert="";workspace.classList.remove("detail-open");closeElderDropdown(true);/** @type {HTMLElement} */(document.getElementById("listView")).hidden=false;/** @type {HTMLElement} */(document.getElementById("detailView")).hidden=true;desiredTarget.set(0,4.4,0);desiredRadius=31;requestAnimationFrame(resize);}
/** @param {string} message @returns {void} */
function showToast(message){const toast=/** @type {HTMLElement} */(document.getElementById("toast"));toast.textContent=message;toast.classList.add("show");window.setTimeout(()=>toast.classList.remove("show"),2800);}
window.AXToast=showToast;
AX.subscribe(syncAlerts);
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
  const id=trigger.dataset.residentId||"AX-003";
  if(frame.dataset.residentId!==id){frame.src=`profile-card/dist/index.html?id=${encodeURIComponent(id)}`;frame.dataset.residentId=id;}
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
