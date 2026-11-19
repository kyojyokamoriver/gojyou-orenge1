import {detectFaces, loadDetector} from './face-detector.js';

self.addEventListener('message', async ({data}) => {
  try {
    if (data.type === 'load') {
      await loadDetector();
      self.postMessage({type:'ready'});
    } else {
      const faces = await detectFaces(data.pixels);
      self.postMessage({type:'result', faces, frame:data.frame});
    }
  } catch (error) {
    self.postMessage({type:'error', message:String(error)});
  }
});
