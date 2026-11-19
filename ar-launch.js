const asset = new URL('./alien-ar.usdz?effects=orange-original-material-2', import.meta.url);
const modelType = 'model/vnd.usdz+zip';

export async function prepareWalk(link) {
  if (link.relList.supports('ar')) {
    link.href = asset.href;
    // Load through the current signed-in page so Quick Look can use the local asset.
    const response = await fetch(asset);
    {
      if (!response.ok) throw new Error('USDZ unavailable');
      const file = await response.arrayBuffer();
      if (file.byteLength < 4 || new DataView(file).getUint32(0) !== 0x504b0304) throw new Error('Invalid USDZ');
      link.href = URL.createObjectURL(new Blob([file], {type:modelType}));
      link.download = 'uchujin.usdz';
    }
    return {type:'quick-look'};
  }
  if (await navigator.xr?.isSessionSupported('immersive-ar')) {
    const {WalkMode} = await import('./walk-mode.js');
    return {type:'webxr', WalkMode};
  }
}
