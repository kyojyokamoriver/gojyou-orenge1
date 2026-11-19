import {env, InferenceSession, Tensor} from './ort.wasm.min.mjs';

const SIDE = 320;
const CAPACITY = SIDE * SIDE;
const STRIDES = [8, 16, 32];
const FACE_ASSETS = new URL('./', import.meta.url);
let session;

export async function loadDetector() {
  env.wasm.numThreads = 1;
  env.wasm.wasmPaths = FACE_ASSETS.href;
  session ??= await InferenceSession.create(new URL('yunet-dynamic.onnx', FACE_ASSETS).href, {
    executionProviders:['wasm']
  });
}

function overlap(a, b) {
  const x = Math.max(0, Math.min(a.cx+a.w/2,b.cx+b.w/2)-Math.max(a.cx-a.w/2,b.cx-b.w/2));
  const y = Math.max(0, Math.min(a.cy+a.h/2,b.cy+b.h/2)-Math.max(a.cy-a.h/2,b.cy-b.h/2));
  return (x*y) / (a.w*a.h + b.w*b.h - x*y);
}

function findFaces(output) {
  const proposals = [];
  for (const stride of STRIDES) {
    const classification = output['cls_' + stride].data;
    const objectness = output['obj_' + stride].data;
    const boxes = output['bbox_' + stride].data;
    const landmarks = output['kps_' + stride].data;
    const columns = SIDE / stride;
    for (let i = 0; i < classification.length; i++) {
      const score = Math.sqrt(Math.max(0, classification[i]) * Math.max(0, objectness[i]));
      if (!Number.isFinite(score) || score < .61) continue;
      const column = i % columns;
      const row = Math.floor(i / columns);
      const w = Math.exp(boxes[4*i+2]) * stride;
      const h = Math.exp(boxes[4*i+3]) * stride;
      if (w < 12 || h < 14) continue;
      const cx = (column + boxes[4*i]) * stride;
      const cy = (row + boxes[4*i+1]) * stride;
      const dx = landmarks[10*i+2] - landmarks[10*i];
      const dy = landmarks[10*i+3] - landmarks[10*i+1];
      proposals.push({score,cx,cy,w,h,eyeSlope:dy / (dx || 1)});
    }
  }
  proposals.sort((a,b) => b.score-a.score);
  const chosen = [];
  for (const p of proposals) {
    if (chosen.some(face => overlap(face,p) > .28)) continue;
    chosen.push(p);
    if (chosen.length === 3) break;
  }
  return chosen;
}

export async function detectFaces(pixels) {
  const buffer = new Float32Array(3 * CAPACITY);
  for (let i = 0; i < CAPACITY; i++) {
    buffer[i] = pixels[4*i+2];
    buffer[i+CAPACITY] = pixels[4*i+1];
    buffer[i+2*CAPACITY] = pixels[4*i];
  }
  const tensor = new Tensor('float32',buffer,[1,3,SIDE,SIDE]);
  const result = await session.run({[session.inputNames[0]]:tensor});
  return findFaces(result);
}
