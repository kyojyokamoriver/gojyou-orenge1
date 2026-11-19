const SIDE = 320;
const lerp = (from, to, weight) => from + (to - from) * weight;

export class FaceTracker {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIDE;
    this.context = this.canvas.getContext('2d', {willReadFrequently:true});
    this.generation = 0;
    this.pending = false;
    this.state = 'idle';
    this.clear();
  }

  load() {
    if (this.state === 'ready' || this.state === 'loading') return;
    this.state = 'loading';
    this.worker?.terminate();
    this.worker = new Worker(new URL('./face-worker.js', import.meta.url), {type:'module'});
    this.worker.addEventListener('message', ({data}) => {
      if (data.type === 'ready') this.state = 'ready';
      if (data.type === 'result') this.receive(data);
      if (data.type === 'error') this.fail(data.message);
    });
    this.worker.addEventListener('error', error => this.fail(error.message));
    this.worker.postMessage({type:'load'});
  }

  fail(message) {
    console.warn('Face detection failed', message);
    this.state = 'error';
    this.pending = false;
    this.tracks = [];
  }

  receive({faces, frame}) {
    const now = performance.now();
    this.pending = false;
    this.nextRead = now + 50;
    if (frame.generation !== this.generation) return;
    const {x,y,width,height} = frame;
    const detections = faces.map(face => ({
      x:(face.cx-x)/width,
      y:(face.cy-face.h*.5-y)/height,
      width:face.w/width,
      height:face.h/height,
      eyeSlope:face.eyeSlope
    }));
    this.associate(detections, now);
  }

  clear() {
    this.generation++;
    this.tracks = [];
    this.nextRead = 0;
    this.videoTime = -1;
    this.sequence = 0;
  }

  update(video, now) {
    if (this.state !== 'ready' || this.pending || now < this.nextRead || video.currentTime === this.videoTime) return;
    this.videoTime = video.currentTime;
    const scale = Math.min(SIDE / video.videoWidth, SIDE / video.videoHeight);
    const width = video.videoWidth * scale;
    const height = video.videoHeight * scale;
    const x = (SIDE-width)/2;
    const y = (SIDE-height)/2;
    const generation = this.generation;
    this.context.fillStyle = '#000';
    this.context.fillRect(0,0,SIDE,SIDE);
    this.context.drawImage(video,x,y,width,height);
    const pixels = this.context.getImageData(0,0,SIDE,SIDE).data;
    this.pending = true;
    this.worker.postMessage({type:'frame',pixels,frame:{x,y,width,height,generation}}, [pixels.buffer]);
  }

  associate(detections, now) {
    const available = this.tracks.filter(track => now - track.seen < 1000);
    for (const detection of detections) {
      let distance = .17;
      let nearest;
      for (const track of available) {
        const gap = Math.hypot(track.target.x - detection.x, track.target.y - detection.y);
        if (gap < distance) {
          nearest = track;
          distance = gap;
        }
      }
      if (nearest) {
        nearest.target = detection;
        nearest.seen = now;
        available.splice(available.indexOf(nearest), 1);
      } else {
        this.tracks.push({...detection, target:detection, seen:now, id:this.sequence++});
      }
    }
    this.tracks = this.tracks.filter(track => now - track.seen < 1000);
  }

  current(now) {
    const live = this.tracks.filter(track => now - track.seen < 900).sort((a,b) => b.seen - a.seen);
    for (const track of live) {
      for (const key of ['x', 'y', 'width', 'height', 'eyeSlope']) {
        track[key] = lerp(track[key], track.target[key], .27);
      }
    }
    return live;
  }
}
