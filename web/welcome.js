// @ts-check
"use strict";
/** @param {string} id @returns {HTMLElement} */
function element(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error("展示页缺少元素 " + id);
  return node;
}
const stage = element("stage");
const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .85;
stage.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, .003, 180);
scene.add(new THREE.HemisphereLight(0xf3f3f3, 0x9b9da0, .84));
const light = new THREE.DirectionalLight(0xf6f5f4, .78);
light.position.set(-7, 14, 9);
scene.add(light);
materials.glass.color.setHex(0x839092);
materials.grass.color.setHex(0xbfc2ba);
materials.balcony.color.setHex(0xb6bcb9);
const city = new THREE.Group();
scene.add(city);
/** @type {Record<string, 1|2|3>} Demo event severity per building. */
const severityByBuilding = {A1:3, A2:2, B3:3, C2:1, B5:2};
const severityMaterial = {1:materials.watch, 2:materials.high, 3:materials.urgent};
/** @type {{dot:THREE.Mesh, halo:THREE.Mesh, severity:number, phase:number}[]} */
const alertMarkers = [];
for (const building of buildings) {
  const shell = new THREE.Group();
  buildFacade(shell);
  const panes = shell.children.filter(part => part.material === materials.glass);
  const pane = panes[Math.floor(Math.random() * panes.length)];
  const outward = Math.sign(pane.position.z);
  const glassSurface = pane.position.z + outward * pane.geometry.parameters.depth / 2;
  // Batch repeated balcony and window shapes by material.
  const batches = new Map();
  for (const part of shell.children) {
    const key = part.material.uuid;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(part);
  }
  for (const parts of batches.values()) {
    const batch = new THREE.InstancedMesh(new THREE.BoxGeometry(), parts[0].material, parts.length);
    parts.forEach((part, index) => {
      const size = part.geometry.parameters;
      part.scale.set(size.width, size.height, size.depth);
      part.updateMatrix();
      batch.setMatrixAt(index, part.matrix);
      part.geometry.dispose();
    });
    batch.position.set(building.x, 0, building.z);
    city.add(batch);
  }
  const severity = severityByBuilding[building.id];
  const color = severityMaterial[severity].color;
  const warning = new THREE.Mesh(new THREE.CircleGeometry(.135, 32),
    new THREE.MeshBasicMaterial({color,toneMapped:false}));
  warning.position.set(building.x + pane.position.x, pane.position.y, building.z + glassSurface + outward * .001);
  warning.rotation.y = outward < 0 ? Math.PI : 0;
  const halo = new THREE.Mesh(new THREE.RingGeometry(.143, .16, 32),
    new THREE.MeshBasicMaterial({color, transparent:true, opacity:.2, depthWrite:false,toneMapped:false}));
  halo.position.copy(warning.position);
  halo.rotation.copy(warning.rotation);
  city.add(warning,halo);
  alertMarkers.push({dot:warning, halo, severity, phase:Math.random()*Math.PI*2});
  const label = labelSprite(building.name);
  label.position.set(building.x,TOWER_HEIGHT+.8,building.z);
  city.add(label);
}
city.add(box(19,.22,15,materials.grass,0,-.15,0));
for (const z of [-1.1,1.2]) city.add(box(18,.02,.62,materials.path,0,-.03,z));
for (const x of [-2.9,2.4]) city.add(box(.62,.02,14,materials.path,x,-.02,0));
/** @param {number} color @returns {THREE.MeshStandardMaterial} */
function paint(color){return new THREE.MeshStandardMaterial({color,roughness:.85});}
const room = new THREE.Group();
scene.add(room);
const wood=paint(0x9d9388), plaster=paint(0xc9c8c5), textile=paint(0x748680), dark=paint(0x354f49), skin=paint(0xce9f78);
/** @param {number} w @param {number} h @param {number} d @param {THREE.Material} mat @param {number} x @param {number} y @param {number} z @returns {THREE.Mesh} */
function furniture(w,h,d,mat,x,y,z){
  const mesh=box(w,h,d,mat,x,y,z);
  room.add(mesh);
  return mesh;
}
furniture(8,.25,6,wood,0,0,0);
furniture(8,3.3,.15,plaster,0,1.7,-3);
furniture(.15,3.3,6,plaster,-4,1.7,0);
furniture(4.6,.04,3,paint(0xa9a7a1),.2,.15,.5);
furniture(3.4,.55,1.25,textile,-1.6,.52,-1.9);
furniture(3.4,.96,.25,textile,-1.6,.88,-2.47);
for(const x of [-3.23,.03]) furniture(.2,.7,1.25,textile,x,.69,-1.9);
furniture(1.5,1.13,.08,wood,1.6,1.95,-2.86);
furniture(1.32,.95,.1,paint(0x9fb9ac),1.6,1.95,-2.8);
furniture(.7,.59,.17,dark,-.2,2.4,-2.84);
const lamp=furniture(.44,.22,.09,paint(0x90a099),-.2,2.42,-2.71);
const beacon=new THREE.Mesh(new THREE.RingGeometry(.19,.22,40),
  new THREE.MeshBasicMaterial({color:0xc16556,transparent:true,depthWrite:false}));
beacon.position.copy(lamp.position);
beacon.position.z+=.08;
room.add(beacon);
const reflection=new THREE.PointLight(0xff432c,0,5);
reflection.position.copy(lamp.position);reflection.position.z+=.4;room.add(reflection);
const facade = furniture(8,3.3,.15,plaster,0,1.7,3);
const revealPlane = new THREE.Plane(new THREE.Vector3(1,0,0),4);
facade.material = plaster.clone();
facade.material.clippingPlanes = [revealPlane];
renderer.localClippingEnabled = true;
const person=new THREE.Group();
room.add(person);
/** @param {THREE.Object3D} parent @param {number[]} size @param {number[]} pos @param {THREE.Material} material @returns {THREE.Mesh} */
function oval(parent,size,pos,material){
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),material);
  mesh.scale.set(...size);mesh.position.set(...pos);parent.add(mesh);return mesh;
}
oval(person,[.29,.42,.19],[0,.22,0],textile);
oval(person,[.19,.22,.18],[0,.77,.025],skin);
oval(person,[.2,.13,.18],[0,.89,0],paint(0xd7d6c9));
const limbs=[-1,1].map(side=>{
  const leg=new THREE.Group(),arm=new THREE.Group();
  leg.position.set(side*.14,-.1,0);arm.position.set(side*.27,.48,0);
  person.add(leg,arm);
  oval(leg,[.11,.34,.12],[0,-.28,0],dark);
  oval(leg,[.11,.085,.16],[0,-.6,.05],dark);
  oval(arm,[.085,.28,.085],[0,-.2,0],textile);
  oval(arm,[.078,.1,.075],[0,-.48,.01],skin);
  return {leg,arm,side};
});
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
let angle=.54, elapsed=0, previous=performance.now(), dragging=false, lastX=0;
const pulse=element("pulse"), pin=element("pin");
stage.onpointerdown=e=>{dragging=true;lastX=e.clientX;stage.setPointerCapture(e.pointerId);};
stage.onpointermove=e=>{if(dragging){angle+=(lastX-e.clientX)*.008;lastX=e.clientX;}};
stage.onlostpointercapture=()=>{dragging=false;};

/** @param {number} value @returns {number} */
function smooth(value){const t=Math.min(1,Math.max(0,value));return t*t*(3-2*t);}
const windowPoint=new THREE.Vector3(6.32,4.26,4.51);
const frame=box(.48,.24,.04,paint(0xfbd391),windowPoint.x,windowPoint.y,windowPoint.z+.02);
city.add(frame);
const marker=new THREE.Vector3();
let received=false;
/** @param {number} time @returns {void} */
function render(time){
  const delta=document.hidden?0:(time-previous)/1000;previous=time;
  const p=Math.min(1,scrollY/element("home").offsetHeight);
  const mobile=innerWidth<=700;
  const mix=smooth((p-.47)/.52);
  const width=innerWidth*(mobile?1:.65);
  const height=innerHeight*(mobile?.60-.23*mix:.86);
  stage.style.left=(mobile?0:innerWidth*.35*(1-mix))+"px";
  stage.style.top=innerHeight*(mobile?.37-.18*mix:.12)+"px";
  stage.style.width=width+"px";stage.style.height=height+"px";
  if(renderer.domElement.clientWidth!==Math.round(width)||renderer.domElement.clientHeight!==Math.round(height))renderer.setSize(Math.round(width),Math.round(height));
  camera.aspect=width/height;camera.updateProjectionMatrix();
  if(p<.68)angle+=Math.min(delta,.1)*.14;
  const into=smooth(p/.68);
  city.visible=p<.68;room.visible=!city.visible;
  // Dissolve the facade into the matching room shot around the camera cut.
  stage.style.opacity=String(reduced ? 1 : smooth(Math.abs(p-.68)/.085));
  if(city.visible){
    for(const {dot,halo,severity,phase} of alertMarkers){
      const wave=reduced ? .5 : .5+.5*Math.sin(time*.001*(2+severity)+phase);
      dot.scale.setScalar(1+.1*wave);
      halo.scale.setScalar(1+.30*wave);
      halo.material.opacity=.07+.26*wave;
    }
    const radius=Math.max(28,39/camera.aspect);
    const aim=new THREE.Vector3(0,4.1,0).lerp(windowPoint,into);
    const orbit=Math.atan2(Math.sin(angle),Math.cos(angle))*(1-into);
    camera.position.set(aim.x+Math.sin(orbit)*radius*(1-into),aim.y+12*(1-into),aim.z+Math.cos(orbit)*radius*(1-into)+.12);
    camera.lookAt(aim);
  }else{
    const reveal=smooth((p-.68)/.32);
    revealPlane.constant=4-8.1*smooth(reveal/.75);
    camera.position.set(8*reveal,1.5+8*reveal,3.4+Math.max(10,13/camera.aspect)*reveal);
    camera.lookAt(0,1,0);
  }
  if(p<.68) elapsed=0;
  if(p>.92) elapsed=(elapsed+Math.min(delta,.12))%14;
  const walk=Math.min(elapsed,4),fall=smooth((elapsed-4)/1.35);
  person.position.set(-1.65+walk*.63,.96-.53*fall,.7);
  person.rotation.y=1.13*(1-fall);
  person.rotation.z=-1.48*fall;
  person.position.y+=.045*Math.abs(Math.sin(walk*6))*(1-fall);
  for(const {leg,arm,side} of limbs){
    leg.rotation.x=Math.sin(walk*6)*side*.44*(1-fall);
    arm.rotation.x=-leg.rotation.x*.8;
    arm.rotation.z=side*.42*fall;
  }
  const alarm=elapsed>=6;
  const glow=alarm?(elapsed<8?.45+.55*Math.pow(Math.cos((elapsed-6)*Math.PI),2):.65):0;
  lamp.material.emissive.setHex(alarm?0xfb4030:0x345943);lamp.material.emissiveIntensity=alarm?glow:.4;
  beacon.visible=alarm;
  beacon.scale.setScalar(1+1.9*(elapsed%1));
  beacon.material.opacity=.65*(1-elapsed%1);
  reflection.intensity=glow*3;
  renderer.render(scene,camera);
  pulse.style.display="none";
  if(elapsed>=8&&elapsed<10&&p>.94){
    marker.copy(lamp.position).project(camera);
    const area=stage.getBoundingClientRect(),dest=pin.getBoundingClientRect(),u=smooth((elapsed-8)/2);
    const x=area.left+(marker.x+1)*width/2,y=area.top+(1-marker.y)*height/2;
    pulse.style.display="block";
    pulse.style.transform="translate("+((1-u)*x+u*(dest.left+dest.width/2)-5)+"px,"+((1-u)*y+u*(dest.top+dest.height/2)-18*Math.sin(Math.PI*u)-5)+"px)";
  }
  if(received!==(elapsed>=10)){
    received=elapsed>=10;pin.classList.toggle("active",received);
    element("status").textContent=received?"疑似跌倒 · 待核实":"等待事件";
    element("detail").textContent=received?"B区 5号楼 · 1602 室":"社区正在值守";
    if(received&&!reduced){
      const card=element("status").parentElement;
      const source=pin.getBoundingClientRect(),destination=card.getBoundingClientRect();
      card.animate([{transform:"translate("+(source.left-destination.left)+"px,"+(source.top-destination.top)+"px) scale(.2)",opacity:.35},{transform:"none",opacity:1}],{duration:580,easing:"ease-out"});
    }
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);
