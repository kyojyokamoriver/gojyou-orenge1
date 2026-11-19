import {starColors, starPoints, starPulse} from './stars.js';
import {prepareWalk} from './ar-launch.js';
import {AlienLayer} from './alien.js';
import {FaceTracker} from './faces.js';

const $ = id => document.getElementById(id);
const view = $('viewfinder');
const nativeAR = $('native-ar');
const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const video = $('video');
const under = $('underlay');
const over = $('overlay');
const underCtx = under.getContext('2d');
const overCtx = over.getContext('2d');
const aliens = new AlienLayer($('world'));
const faces = new FaceTracker();
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const TAU = 2 * Math.PI;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let width = 1;
let height = 1;
let ratio = 1;
let stream;
let live = false;
let busy = false;
let facing = 'environment';
let captureUrl;
let captureFile;
let lastHint = '';
let lastFrame = -1;
let drawn = false;
let connection = 0;
let notice = '';
let noticeTimeout;
let walk;
let checkingWalk = true;
let walkActive = false;
let returningFromQuickLook = false;

new ResizeObserver(() => {
  width = Math.max(1, view.clientWidth);
  height = Math.max(1, view.clientHeight);
  ratio = Math.min(2, window.devicePixelRatio || 1);
  for (const canvas of [under, over]) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  aliens.resize(width, height, ratio);
}).observe(view);

function positionInView(x, y, crop, mirror = false) {
  return {x:(mirror ? 1-x : x)*crop.width + crop.x, y:y*crop.height + crop.y};
}

function videoRect() {
  const scale = Math.max(width/video.videoWidth, height/video.videoHeight);
  const w = video.videoWidth * scale;
  const h = video.videoHeight * scale;
  return {x:(width-w)/2, y:(height-h)/2, width:w, height:h};
}

function character(x, y, size, now, id = 0, tilt = 0) {
  const phase = now / 1000 + id * .81;
  const motion = reduceMotion.matches ? 0 : 1;
  const blinkPhase = ((now + id * 1267 + 1500) % 3650);
  return {
    x, y:y + Math.sin(phase*2.25) * size*.045*motion, size,
    blink:blinkPhase > 3465 && blinkPhase < 3635,
    pitch:Math.sin(phase*.96)*.075*motion,
    yaw:Math.sin(phase*1.23)*.17*motion,
    roll:tilt + Math.cos(phase*1.5)*.065*motion,
    phase:now + id * 1221
  };
}

function stars(ctx, obj, elapsed) {
  const time = reduceMotion.matches ? 0 : obj.phase / 1000;
  for (let i = 0; i < 6; i++) {
    const pulse = starPulse(elapsed,i);
    if (pulse <= 0) continue;
    const angle = i * TAU / 6 - Math.PI/2;
    const wave = Math.sin(time*3.2 + i*1.35);
    const radius = obj.size * (.65 + wave*.06);
    const size = obj.size * (.054 + (i%3)*.010) * (.86 + .14*wave) * (.45 + .55*pulse);
    ctx.save();
    ctx.translate(obj.x + Math.cos(angle)*radius, obj.y + Math.sin(angle)*radius*.78);
    ctx.rotate((i%3-1)*.22 + wave*.18);
    ctx.globalAlpha = pulse * (.85 + .15*wave);
    ctx.fillStyle = starColors[i%2];
    ctx.beginPath();
    starPoints.forEach(([x,y],point) => {
      if (point === 0) ctx.moveTo(x*size,-y*size);
      else ctx.lineTo(x*size,-y*size);
    });
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function hint(message) {
  if (message === lastHint) return;
  lastHint = message;
  $('hint').textContent = message;
  $('hint').hidden = !message;
}

function render(now) {
  requestAnimationFrame(render);
  if (now - lastFrame < 1000/40) return;
  lastFrame = now;
  underCtx.setTransform(ratio,0,0,ratio,0,0);
  overCtx.setTransform(ratio,0,0,ratio,0,0);
  underCtx.clearRect(0,0,width,height);
  overCtx.clearRect(0,0,width,height);
  let objects = [];
  let message = '';
  const front = facing === 'user';
  if (walkActive) {
    message = 'ARを起動中…';
  } else if (!live) {
    if (busy) message = front ? 'カメラを起動中…' : 'ARを準備中…';

  } else if (busy || video.readyState < 2) {
    message = 'カメラを切り替えています…';
  } else if (front) {
    faces.update(video, now);
    const crop = videoRect();
    const found = faces.current(now).map(track => {
      const pos = positionInView(track.x, track.y, crop, true);
      return {track, pos};
    }).filter(({pos}) => pos.x > -6 && pos.x < width+6 && pos.y > -height*.12 && pos.y < height).slice(0,3);

    for (const {track, pos} of found) {
      const size = clamp(track.width * crop.width * 1.03, 40, Math.min(width*.32, height*.29));
      const y = pos.y - track.height * crop.height*.22 - size*.48;
      objects.push(character(pos.x, clamp(y, size*.47+16, height-size*.5), size, now, track.id, clamp(-track.eyeSlope*.35,-.25,.25)));
    }
    objects.forEach(obj => stars(overCtx,obj,now/1000));
    if (faces.state === 'loading') message = '顔検出の準備中…';
    else if (faces.state === 'error') message = '顔検出を読み込めませんでした。カメラを切り替えてお試しください。';
    else if (!objects.length) message = '最大3人。頭の上を少し空けてね';
  }
  aliens.draw(objects, underCtx);
  drawn = true;
  hint(notice || message);
}

requestAnimationFrame(render);

function syncUI() {
  const front = facing === 'user';
  const start = $('start');
  start.disabled = busy || walkActive;
  start.hidden = live || !front;
  const frontReady = front || walkActive;
  const arReady = !busy && !checkingWalk && walk && !returningFromQuickLook;
  $('ar-entry').hidden = frontReady || !arReady;
  $('ar-start').hidden = walk?.type !== 'webxr';
  $('ar-unavailable').hidden = frontReady || checkingWalk || Boolean(walk);
  document.body.classList.toggle('rear-ready', !front && !walkActive);
  $('safari-help-open').hidden = front || !appleMobile;
  nativeAR.hidden = busy || front || walk?.type !== 'quick-look' || walkActive || returningFromQuickLook;
  view.setAttribute('aria-label', front ? '内カメの撮影画面' : walk ?
    '外カメの撮影画面。床にカメラを向けてタップするとARが始まります' :
    '空間ARの起動画面');
  const swap = $('swap');
  swap.disabled = busy || walkActive;
  swap.setAttribute('aria-label', front ? '外カメに切り替える' : '内カメに切り替える');
  $('swap-label').textContent = front ? '外カメ' : '内カメ';
  $('shutter').disabled = busy || !live || !front;
  $('view-label').hidden = !live;
  $('view-label').textContent = front ? '内カメ' : walk || checkingWalk ? '外カメ' : '空間AR未対応';
  document.body.classList.toggle('front', front);
  document.body.classList.toggle('live', live);
}

function stopTracks() {
  video.pause();
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  stream = undefined;
  video.srcObject = null;
}

function resumeAfterQuickLook() {
  if (!returningFromQuickLook || document.hidden) return;
  returningFromQuickLook = false;
  startCamera('environment');
}

function showError(message) {
  $('error').textContent = message;
  $('camera-state').hidden = !message;
}

function cameraError(error) {
  const messages = {
    NotAllowedError:'このページのカメラを許可して、もう一度お試しください。',
    NotFoundError:'選んだカメラが見つかりませんでした。',
    OverconstrainedError:'この端末では選んだカメラを開けませんでした。',
    NotReadableError:'ほかのアプリでカメラを使っている場合は、閉じてからお試しください。'
  };
  return messages[error.name] || 'カメラを開けませんでした。スマホのブラウザでページを開き直してください。';
}

async function connect(next, attempt) {
  let incoming;
  const constraints = {width:{ideal:1280}, height:{ideal:1280}, frameRate:{ideal:30,max:30}};
  try {
    incoming = await navigator.mediaDevices.getUserMedia({audio:false,video:{...constraints,facingMode:{exact:next}}});
  } catch (err) {
    if (!['OverconstrainedError','NotFoundError'].includes(err.name)) throw err;
    incoming = await navigator.mediaDevices.getUserMedia({audio:false,video:{...constraints,facingMode:{ideal:next}}});
    const actual = incoming.getVideoTracks()[0]?.getSettings().facingMode;
    if (actual && actual !== next) {
      incoming.getTracks().forEach(track => track.stop());
      throw new DOMException('Requested lens unavailable', 'NotFoundError');
    }
  }
  if (attempt !== connection) {
    incoming.getTracks().forEach(track => track.stop());
    throw new DOMException('Camera closed', 'AbortError');
  }
  stream = incoming;
  video.srcObject = incoming;
  await video.play();
  if (attempt !== connection) throw new DOMException('Camera closed', 'AbortError');
  for (const track of incoming.getVideoTracks()) {
    track.onended = () => {
      closeCamera();
      showError('カメラの接続が切れました。もう一度カメラを開いてください。');
    };
  }
}

async function startCamera(next = facing) {
  if (busy || walkActive) return;
  returningFromQuickLook = false;
  showError('');
  // Rear AR owns the camera. Never start a competing getUserMedia session.
  if (next === 'environment') {
    const hadCamera = Boolean(stream);
    const attempt = ++connection;
    busy = true;
    facing = next;
    live = false;
    notice = '';
    clearTimeout(noticeTimeout);
    faces.clear();
    stopTracks();
    syncUI();
    // Give iOS time to release the front camera before exposing the native link.
    if (hadCamera) await new Promise(resolve => setTimeout(resolve, 500));
    if (attempt === connection) {
      busy = false;
      syncUI();
    }
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showError('このブラウザではカメラを利用できません。スマホのブラウザでこのページを開いてください。');
    return;
  }
  const previous = live ? facing : null;
  const attempt = ++connection;
  notice = '';
  clearTimeout(noticeTimeout);
  busy = true;
  syncUI();
  faces.clear();
  try {
    stopTracks();
    await connect(next, attempt);
    facing = next;
    live = true;
    if (facing === 'user') faces.load();
  } catch (error) {
    if (attempt !== connection) return;
    stopTracks();
    live = false;
    if (previous && previous !== next) {
      try {
        await connect(previous, attempt);
        live = true;
      } catch {
        if (attempt !== connection) return;
        stopTracks();
      }
    }
    if (live) {
      notice = 'カメラを切り替えられませんでした';
      noticeTimeout = setTimeout(() => { notice = ''; }, 2400);
    } else showError(cameraError(error));
  } finally {
    if (attempt === connection) {
      busy = false;
      syncUI();
    }
  }
}

function closeCamera() {
  connection++;
  busy = false;
  notice = '';
  clearTimeout(noticeTimeout);
  stopTracks();
  live = false;
  faces.clear();
  syncUI();
}

$('start').addEventListener('click', () => {
  if (returningFromQuickLook) {
    returningFromQuickLook = false;
    startCamera();
  } else if (canLaunchWalk()) launchWalk();
  else startCamera();
});
$('reload').addEventListener('click', () => location.reload());
$('swap').addEventListener('click', () => startCamera(facing === 'user' ? 'environment' : 'user'));
window.addEventListener('pagehide', closeCamera);
window.addEventListener('focus', resumeAfterQuickLook);
document.addEventListener('visibilitychange', resumeAfterQuickLook);
window.addEventListener('pageshow', event => {
  if (event.persisted) startCamera();
});

$('shutter').addEventListener('click', () => {
  if (facing !== 'user' || busy || !live || !drawn || video.readyState < 2 || $('photo').open) return;
  const output = document.createElement('canvas');
  const crop = videoRect();
  const density = clamp(video.videoWidth / crop.width, 1, 3);
  output.width = Math.round(width*density);
  output.height = Math.round(height*density);
  const ctx = output.getContext('2d');
  ctx.scale(output.width/width,output.height/height);
  ctx.save();
  if (facing === 'user') {
    ctx.translate(width,0);
    ctx.scale(-1,1);
  }
  ctx.drawImage(video,crop.x,crop.y,crop.width,crop.height);
  ctx.restore();
  ctx.drawImage(under,0,0,width,height);
  aliens.capture(ctx,width,height);
  ctx.drawImage(over,0,0,width,height);
  const flash = $('flash');
  flash.classList.remove('snap');
  void flash.offsetWidth;
  flash.classList.add('snap');
  $('shutter').disabled = true;
  showPhoto(output);
});

function showPhoto(output) {
  output.toBlob(blob => {
    $('shutter').disabled = !live || busy;
    if (!blob) return;
    if (captureUrl) URL.revokeObjectURL(captureUrl);
    captureUrl = URL.createObjectURL(blob);
    const filename = 'uchujin-' + new Date().toISOString().replace(/[:.]/g,'-') + '.jpg';
    captureFile = new File([blob],filename,{type:'image/jpeg'});
    $('result').src = captureUrl;
    $('last').style.backgroundImage = 'url(' + captureUrl + ')';
    $('last').disabled = false;
    if (!$('photo').open) $('photo').showModal();
  },'image/jpeg',.94);
}

$('last').addEventListener('click', () => $('photo').showModal());
$('close-photo').addEventListener('click', () => $('photo').close());
$('retake').addEventListener('click', () => $('photo').close());
$('save').addEventListener('click', async () => {
  if (!captureFile) return;
  if (navigator.canShare?.({files:[captureFile]})) {
    try {
      await navigator.share({files:[captureFile]});
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const link = document.createElement('a');
  link.href = captureUrl;
  link.download = captureFile.name;
  document.body.append(link);
  link.click();
  link.remove();
});

const safariHelp = $('safari-help');
const safariUrl = $('safari-url');
const safariCopyStatus = $('safari-copy-status');
$('safari-help-open').addEventListener('click', () => {
  safariUrl.value = new URL('./',location.href).href;
  safariCopyStatus.textContent = '';
  safariHelp.showModal();
});
safariHelp.querySelector('.icon-button').addEventListener('click', () => safariHelp.close());
$('safari-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(safariUrl.value);
    safariCopyStatus.textContent = 'コピーしました';
  } catch {
    safariUrl.focus();
    safariUrl.select();
    safariCopyStatus.textContent = '選択したリンクをコピーしてください';
  }
});

prepareWalk(nativeAR).then(mode => {
  walk = mode;
}).catch(() => {
  $('ar-unavailable').textContent = '空間ARの準備に失敗しました。左上の更新ボタンで再読み込みしてください。';
}).finally(() => {
  checkingWalk = false;
  syncUI();
});

nativeAR.addEventListener('click', event => {
  if (busy || facing !== 'environment') {
    event.preventDefault();
    return;
  }
  returningFromQuickLook = true;
  connection++;
  busy = false;
  stopTracks();
  // Keep the link available if the native confirmation is cancelled.
  // A real return/focus or pagehide handles the UI lifecycle.
});

function canLaunchWalk() {
  return !checkingWalk && walk?.type === 'webxr' && facing === 'environment' && !busy && !walkActive;
}

$('ar-start').addEventListener('click', launchWalk);

async function launchWalk() {
  if (!canLaunchWalk()) return;
  closeCamera();
  walkActive = true;
  syncUI();
  hint('ARを起動中…');
  const mode = new walk.WalkMode({
    onEnd() {
      if (!walkActive) return;
      if ($('photo').open) $('photo').close();
      walkActive = false;
      startCamera('environment');
    },
    onPhoto:showPhoto
  });
  try {
    await mode.start();
  } catch {
    const wasStarting = walkActive;
    walkActive = false;
    walk = undefined;
    syncUI();
    if (wasStarting) await startCamera('environment');
    showError('空間ARを開始できませんでした。SafariまたはAR対応のChromeで開いてください。');
    notice = '';
    clearTimeout(noticeTimeout);
    noticeTimeout = setTimeout(() => { notice = ''; }, 2800);
  }
}

startCamera();
