import {starColors, starPoints, starPulse} from './stars.js';
import * as THREE from 'three';
import {GLTFLoader} from './GLTFLoader.js';
import {prepareBlink} from './eye-blink.js';

const $ = id => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const model = new URL('./alien.glb', import.meta.url);

function makeShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64,64,0,64,64,64);
  gradient.addColorStop(0,'rgba(8,13,10,.46)');
  gradient.addColorStop(.42,'rgba(8,13,10,.31)');
  gradient.addColorStop(1,'rgba(8,13,10,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0,0,128,128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(.64,.64), new THREE.MeshBasicMaterial({
    map:new THREE.CanvasTexture(canvas), transparent:true, depthWrite:false
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .004;
  return shadow;
}

function makeStars() {
  const shape = new THREE.Shape(starPoints.map(([x,y]) => new THREE.Vector2(x,y)));
  const geometry = new THREE.ExtrudeGeometry(shape,{depth:.20,bevelEnabled:false});
  geometry.translate(0,0,-.10);
  const materials = starColors.map(color => new THREE.MeshBasicMaterial({color}));
  return Array.from({length:6}, (_,i) => new THREE.Mesh(geometry,materials[i%2]));
}

export class WalkMode {
  constructor({onEnd, onPhoto}) {
    this.overlay = $('xr-overlay');
    this.hint = $('xr-hint');
    this.onEnd = onEnd;
    this.onPhoto = onPhoto;
    this.points = new Map();
    this.autoPlace = false;
    this.candidate = new THREE.Vector3();
    this.anchorRotation = new THREE.Quaternion();
    this.anchorOffset = new THREE.Quaternion();
    this.rebaseMatrix = new THREE.Matrix4();
  }

  async start() {
    this.session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures:['hit-test','dom-overlay'],
      optionalFeatures:['anchors','camera-access'],
      domOverlay:{root:this.overlay}
    });
    this.session.addEventListener('end', () => this.finish(), {once:true});
    this.events = new AbortController();
    try {
      const viewer = await this.session.requestReferenceSpace('viewer');
      this.hitSource = await this.session.requestHitTestSource({space:viewer});
      this.renderer = new THREE.WebGLRenderer({alpha:true,antialias:true});
      this.renderer.setClearColor(0,0);
      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType('local');
      await this.renderer.xr.setSession(this.session);
      if (!this.events || this.events.signal.aborted) return;
      this.space = this.renderer.xr.getReferenceSpace();
      this.scene = new THREE.Scene();
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.scene.add(new THREE.HemisphereLight(0xffffff,0xd8d8d8,2.2));
      const light = new THREE.DirectionalLight(0xffffff,1.4);
      light.position.set(-2,3,5);
      this.scene.add(light);
      this.camera = new THREE.PerspectiveCamera(50,1,.015,40);
      this.floor = new THREE.Group();
      this.scene.add(this.floor);
      this.object = new THREE.Group();
      this.object.visible = false;
      this.floor.add(this.object);
      this.object.add(makeShadow());
      this.stars = makeStars();
      this.object.add(...this.stars);
      this.body = new THREE.Group();
      this.object.add(this.body);
      this.reticle = new THREE.Mesh(new THREE.RingGeometry(.075,.084,36),
        new THREE.MeshBasicMaterial({color:0xffb566,side:THREE.DoubleSide}));
      this.reticle.geometry.rotateX(-Math.PI/2);
      this.reticle.visible = false;
      this.scene.add(this.reticle);
      if (window.XRWebGLBinding) {
        import('./xr-photo.js').then(({XRPhoto}) => {
          if (!this.events.signal.aborted) {
            this.photoCapture = new XRPhoto(this.renderer,this.session);
          }
        }).catch(() => {});
      }
      this.setControls();
      await this.loadAlien();
      if (this.events.signal.aborted) return;
      this.renderer.setAnimationLoop((now,frame) => this.render(now,frame));
    } catch (error) {
      if (!this.events?.signal.aborted) await this.session.end().catch(() => this.finish());
      throw error;
    }
  }

  async loadAlien() {
    const {scene:alien} = await new GLTFLoader().loadAsync(model.href);
    if (this.events.signal.aborted) return;
    this.blinkEyes = [];
    this.blinkLids = [];
    alien.traverse(mesh => {
      if (!mesh.isMesh) return;
      const material = mesh.material;
      // Preserve the source GLB material and its texture/color space.
      mesh.material = material;
      if ((/pSphere/.test(mesh.name) || mesh.name === 'pCylinder1')) {
        mesh.userData.blinkScaleY = mesh.scale.y;
        this.blinkEyes.push(mesh);
      }
    });
    const blink = prepareBlink(alien);
    this.blinkEyes = blink.eyes;
    this.blinkLids = blink.lids;
    const bounds = new THREE.Box3().setFromObject(alien);
    alien.add(...this.blinkLids);
    const center = bounds.getCenter(new THREE.Vector3());
    center.y = bounds.min.y;
    const scale = .44 / bounds.getSize(new THREE.Vector3()).x;
    alien.scale.setScalar(scale);
    alien.position.copy(center).multiplyScalar(-scale);
    this.body.add(alien);
  }

  setControls() {
    $('xr-controls').hidden = false;
    $('xr-reset').hidden = true;
    $('xr-shutter').hidden = true;
    document.body.classList.add('in-xr');
    this.tell('床にカメラを向けてください');
    const options = {signal:this.events.signal};
    $('xr-close').addEventListener('click', () => this.session.end(), options);
    $('xr-reload').addEventListener('click', () => {
      this.reloading = true;
      this.session.end().catch(() => location.reload());
    }, options);
    this.space.addEventListener('reset', event => this.rebasePlacement(event), options);
    $('xr-reset').addEventListener('click', () => this.clearPlacement(), options);
    $('xr-shutter').addEventListener('click', () => {
      if (!$('photo').open) this.takePhoto = true;
    }, options);
    this.overlay.addEventListener('beforexrselect', event => event.preventDefault(), options);
    this.overlay.addEventListener('pointerdown', event => this.pointerDown(event), options);
    this.overlay.addEventListener('pointermove', event => this.pointerMove(event), options);
    for (const type of ['pointerup','pointercancel','lostpointercapture']) {
      this.overlay.addEventListener(type, event => this.pointerEnd(event), options);
    }
  }

  tell(message) {
    if (this.hint.textContent === message) return;
    this.hint.textContent = message;
    this.hint.hidden = !message;
  }

  render(now, frame) {
    if (!frame) return;
    const viewer = frame.getViewerPose(this.space);
    const view = viewer?.views[0];
    if (!view || viewer.emulatedPosition) {
      this.floor.visible = false;
      this.reticle.visible = false;
      this.tell('周囲をゆっくり映して、位置を合わせてください');
      $('xr-shutter').hidden = true;
      this.placeRequested = false;
      this.candidateSince = undefined;
      this.takePhoto = false;
      if (view) this.renderer.render(this.scene,this.camera);
      return;
    }
    this.floor.visible = true;
    if (!this.object.visible) {
      this.hit = frame.getHitTestResults(this.hitSource).find(hit => hit.getPose(this.space)?.transform.matrix[5] > .72);
      this.reticle.visible = Boolean(this.hit);
      const matrix = this.hit?.getPose(this.space).transform.matrix;
      if (matrix) this.reticle.position.set(matrix[12],matrix[13]+.006,matrix[14]);
      this.tell(!this.hit ? '床にカメラを向け、ゆっくり動かしてください' :
        this.autoPlace ? '床を認識中。そのまま少し待ってね' : '置きたい床を映して、タップで位置を固定');
      if (this.hit && (this.placeRequested || this.readyToPlace(now))) {
        this.place(this.hit,view.transform.position,now);
      } else if (!this.hit) this.candidateSince = undefined;
    } else {
      const anchorTracked = this.updateAnchor(frame);
      if (!anchorTracked || this.awaitingAnchor) {
        this.floor.visible = false;
        this.tell('宇宙人を置いた位置を探しています');
        $('xr-shutter').hidden = true;
        this.takePhoto = false;
        this.renderer.render(this.scene,this.camera);
        return;
      }
      this.body.position.y = .38 + .065*Math.sin((now-this.placedAt)/1000*Math.PI/3);
      const phase = ((now-this.placedAt)/1000) % 6;
      const blinking = (phase >= 2.04 && phase < 2.23) || (phase >= 5.04 && phase < 5.23);
      this.blinkEyes?.forEach(eye => { eye.visible = !blinking; });
      this.blinkLids?.forEach(lid => { lid.visible = blinking; });
      this.animateStars((now-this.placedAt)/1000);
      if (now > this.instructionUntil) this.tell('');
      else this.tell('位置を固定しました。近づいたり、周りを歩いたりしてみてね');
    }
    this.placeRequested = false;
    this.renderer.render(this.scene,this.camera);
    $('xr-shutter').hidden = !this.object.visible || !view?.camera || !this.photoCapture;
    if (this.takePhoto && view?.camera) {
      this.takePhoto = false;
      this.capture(view);
    }
  }

  updateAnchor(frame) {
    if (!this.anchor) return true;
    const pose = frame.getPose(this.anchor.anchorSpace,this.space);
    if (!pose || pose.emulatedPosition) return false;
    const {position, orientation} = pose.transform;
    this.anchorRotation.copy(orientation);
    if (!this.anchorAligned) {
      this.anchorOffset.copy(this.anchorRotation).invert().multiply(this.floor.quaternion);
      this.anchorAligned = true;
    }
    this.floor.position.copy(position);
    this.floor.quaternion.copy(this.anchorRotation).multiply(this.anchorOffset);
    this.awaitingAnchor = false;
    return true;
  }

  rebasePlacement({transform}) {
    this.candidateSince = undefined;
    this.placeRequested = false;
    if (!this.object.visible) return;
    if (transform) {
      // The new origin is expressed in the old space; apply its inverse to our placement.
      this.floor.applyMatrix4(this.rebaseMatrix.fromArray(transform.matrix).invert());
    } else if (this.anchor) {
      this.awaitingAnchor = true;
    } else {
      this.clearPlacement();
    }
  }

  readyToPlace(now) {
    if (!this.autoPlace) return false;
    if (this.candidateSince === undefined || this.candidate.distanceToSquared(this.reticle.position) > .0144) {
      this.candidate.copy(this.reticle.position);
      this.candidateSince = now;
    }
    return now-this.candidateSince >= 425;
  }

  animateStars(time) {
    this.stars.forEach((star,i) => {
      const pulse = starPulse(time,i);
      star.visible = pulse > 0;
      if (!star.visible) return;
      const angle = i*Math.PI/3 + time*.29;
      const wave = Math.sin(time*2.3 + i*1.35);
      const radius = .33 + .027*wave;
      const size = (.034 + i%3*.007)*(.87 + .13*wave);
      star.position.set(Math.cos(angle)*radius,this.body.position.y + .11 + .088*wave,Math.sin(angle)*radius);
      star.rotation.set(.22*wave,-angle + Math.PI/4,.25*wave);
      star.scale.setScalar(size*pulse);
    });
  }

  place(hit, cameraPosition, now) {
    const pos = hit.getPose(this.space).transform.position;
    this.floor.position.copy(pos);
    this.floor.quaternion.identity();
    this.anchorAligned = false;
    this.awaitingAnchor = false;
    this.object.rotation.y = Math.atan2(cameraPosition.x-pos.x,cameraPosition.z-pos.z);
    this.object.scale.setScalar(1);
    this.body.rotation.set(0,0,0);
    this.body.position.y = .38;
    this.placedAt = now;
    this.autoPlace = false;
    this.animateStars(0);
    this.object.visible = true;
    this.reticle.visible = false;
    this.instructionUntil = now + 7000;
    this.tell('位置を固定しました。近づいたり、周りを歩いたりしてみてね');
    $('xr-reset').hidden = false;
    const placement = {};
    this.placement = placement;
    hit.createAnchor?.().then(anchor => {
      if (this.placement === placement && !this.events.signal.aborted) this.anchor = anchor;
      else anchor.delete();
    }).catch(() => {});
  }

  clearPlacement() {
    this.placement = null;
    this.candidateSince = undefined;
    this.anchor?.delete();
    this.anchor = null;
    this.anchorAligned = false;
    this.awaitingAnchor = false;
    this.object.visible = false;
    this.takePhoto = false;
    $('xr-reset').hidden = true;
  }

  pointerDown(event) {
    if (event.target.closest('button, dialog') || this.points.size >= 2 || event.button !== 0) return;
    this.points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    this.overlay.setPointerCapture(event.pointerId);
    if (this.points.size === 1) this.moved = false;
    this.recordGesture();
  }

  recordGesture() {
    const [a,b] = this.points.values();
    this.baseGesture = a && {
      x:a.x, y:a.y,
      distance:b && Math.hypot(b.x-a.x,b.y-a.y),
      angle:b && Math.atan2(b.y-a.y,b.x-a.x),
      scale:this.object.scale.x,
      yaw:this.object.rotation.y,
      pitch:this.body.rotation.x
    };
  }

  pointerMove(event) {
    if (!this.points.has(event.pointerId)) return;
    this.points.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const [a,b] = this.points.values();
    const base = this.baseGesture;
    if (!this.moved && !b && Math.hypot(a.x-base.x,a.y-base.y) < 7) return;
    this.moved = true;
    if (!this.object.visible) return;
    if (b && base.distance > 3) {
      this.object.scale.setScalar(clamp(base.scale*Math.hypot(b.x-a.x,b.y-a.y)/base.distance,.35,3));
      this.object.rotation.y = base.yaw - (Math.atan2(b.y-a.y,b.x-a.x)-base.angle);
    } else if (!b) {
      this.object.rotation.y = base.yaw + (a.x-base.x)*.014;
      this.body.rotation.x = clamp(base.pitch+(a.y-base.y)*.007,-.70,.70);
    }
    this.instructionUntil = 0;
  }

  pointerEnd(event) {
    if (!this.points.delete(event.pointerId)) return;
    if (!this.points.size && event.type === 'pointerup' && !this.moved && !this.object.visible) {
      this.placeRequested = true;
    }
    this.recordGesture();
  }

  capture(view) {
    try {
      // The camera texture can only be read inside this animation frame.
      if (!this.photoCapture) return;
      const photo = this.photoCapture.take(view,this.scene);
      this.onPhoto(photo);
    } catch {
      this.instructionUntil = performance.now() + 3500;
      this.tell('この端末でAR写真を合成できませんでした');
    }
  }

  finish() {
    this.events?.abort();
    this.hitSource?.cancel();
    this.anchor?.delete();
    this.renderer?.setAnimationLoop(null);
    this.photoCapture?.dispose();
    this.renderer?.dispose();
    $('xr-controls').hidden = true;
    document.body.classList.remove('in-xr');
    if (this.reloading) location.reload();
    else this.onEnd();
  }
}
