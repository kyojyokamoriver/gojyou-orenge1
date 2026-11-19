import * as THREE from 'three';

// Same curved lid and three lashes as the green alien, in a matching amber.
export function prepareBlink(model) {
  model.updateMatrixWorld(true);
  const eyes = [], whites = [], lids = [];
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    if ((/pSphere/.test(mesh.name) || mesh.name === 'pCylinder1')) eyes.push(mesh);
    if (/^pSphere1$/.test(mesh.name)) whites.push(mesh);
  });
  const material = new THREE.MeshBasicMaterial({color:0xa28900});
  for (const [i,eye] of whites.entries()) {
    const box = new THREE.Box3().setFromObject(eye);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const lid = new THREE.Group();
    lid.name = 'closed-eye-' + i;
    const paths = [Array.from({length:25}, (_,j) => {
      const t = Math.PI*j/24;
      return new THREE.Vector3(c.x-size.x*.40*Math.cos(t),c.y+size.y*(.20-.45*Math.sin(t)),box.max.z+size.x*.02);
    })];
    for (const x of [-.25,0,.25]) paths.push([
      new THREE.Vector3(c.x+x*size.x,c.y-size.y*.18,box.max.z+size.x*.02),
      new THREE.Vector3(c.x+x*size.x*1.3,c.y-size.y*.43,box.max.z+size.x*.02)
    ]);
    for (const path of paths) lid.add(new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path),path.length>2?48:4,size.x*.028,8,false),material));
    lid.visible = false;
    model.add(lid);
    lids.push(lid);
  }
  return {eyes,lids};
}
