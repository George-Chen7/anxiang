/** @typedef {{id:string,name:string,x:number,z:number}} BuildingData */
/** @type {BuildingData[]} */
const buildings = [
  {id:"A1",name:"A区 1号楼",x:-6.4,z:-3.7},
  {id:"A2",name:"A区 2号楼",x:-5.5,z:3.1},
  {id:"B3",name:"B区 3号楼",x:4.4,z:-4.0},
  {id:"C2",name:"C区 2号楼",x:-0.1,z:2.5},
  {id:"B5",name:"B区 5号楼",x:5.7,z:3.7}
];
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
/** @param {number} width @param {number} height @param {number} depth @param {any} material @param {number} x @param {number} y @param {number} z @returns {any} */
function box(width,height,depth,material,x,y,z){const mesh=new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),material);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;}
/** @param {string} label @returns {any} */
function labelSprite(label){const canvas=document.createElement("canvas");canvas.width=320;canvas.height=72;const context=canvas.getContext("2d");if(!context)throw new Error("无法创建楼栋标签画布");context.fillStyle="rgba(255,253,249,.94)";context.beginPath();context.roundRect(4,4,312,64,17);context.fill();context.fillStyle="#315d4f";context.font="bold 29px Microsoft YaHei, sans-serif";context.textAlign="center";context.fillText(label,160,47);const texture=new THREE.CanvasTexture(canvas);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false}));sprite.scale.set(2.2,.5,1);return sprite;}
/** @param {THREE.Group} group @returns {void} */
function buildFacade(group){
  group.add(box(2.15,TOWER_HEIGHT,1.55,materials.wall,0,TOWER_HEIGHT/2,0));
  group.add(box(.16,TOWER_HEIGHT,1.55,materials.side,1.1,TOWER_HEIGHT/2,0));
  group.add(box(2.32,.18,1.72,materials.roof,0,TOWER_HEIGHT+.08,0));
  group.add(box(.82,.45,.12,materials.entry,0,.24,.82));
  group.add(box(.98,.07,.46,materials.roof,0,.49,.93));
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
  }
}
