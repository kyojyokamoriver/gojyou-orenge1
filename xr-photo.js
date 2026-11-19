import * as THREE from 'three';

function initProgram(gl) {
  const program = gl.createProgram();
  const compile = (type,source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader,source);
    gl.compileShader(shader);
    gl.attachShader(program,shader);
    gl.deleteShader(shader);
  };
  compile(gl.VERTEX_SHADER,`#version 300 es
    out vec2 uv;
    void main() {
      uv = vec2(float((gl_VertexID << 1) & 2),float(gl_VertexID & 2));
      gl_Position = vec4(uv*2.0-1.0,0.0,1.0);
    }`);
  compile(gl.FRAGMENT_SHADER,`#version 300 es
    precision mediump float;
    uniform sampler2D frame;
    in vec2 uv;
    out vec4 color;
    void main() { color = vec4(texture(frame,uv).rgb,1.0); }`);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error('Could not initialize camera compositing');
  }
  return program;
}

export class XRPhoto {
  constructor(renderer,session) {
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.binding = new XRWebGLBinding(session,this.gl);
    this.program = initProgram(this.gl);
    this.framebuffer = this.gl.createFramebuffer();
    this.texture = this.gl.createTexture();
    this.vao = this.gl.createVertexArray();
    this.camera = new THREE.PerspectiveCamera();
  }

  take(view,scene) {
    const {gl,renderer} = this;
    const texture = this.binding.getCameraImage(view.camera);
    if (!texture) throw new Error('Camera frame unavailable');
    const scale = Math.min(1,1280/Math.max(view.camera.width,view.camera.height));
    const w = Math.round(view.camera.width*scale);
    const h = Math.round(view.camera.height*scale);
    const background = new Uint8Array(w*h*4);
    const overlay = new Uint8Array(w*h*4);
    const wasEnabled = renderer.xr.enabled;
    const originalTarget = renderer.getRenderTarget();

    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer);
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAX_LEVEL,0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
      gl.viewport(0,0,w,h);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.CULL_FACE);
      gl.colorMask(true,true,true,true);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.uniform1i(gl.getUniformLocation(this.program,'frame'),0);
      gl.drawArrays(gl.TRIANGLES,0,3);
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,background);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      renderer.resetState();
    }

    const target = new THREE.WebGLRenderTarget(w,h,{colorSpace:THREE.SRGBColorSpace});
    try {
      renderer.xr.enabled = false;
      this.camera.matrix.fromArray(view.transform.matrix);
      this.camera.matrix.decompose(this.camera.position,this.camera.quaternion,this.camera.scale);
      this.camera.projectionMatrix.fromArray(view.projectionMatrix);
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene,this.camera);
      renderer.readRenderTargetPixels(target,0,0,w,h,overlay);
    } finally {
      renderer.xr.enabled = wasEnabled;
      renderer.setRenderTarget(originalTarget);
      target.dispose();
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const result = ctx.createImageData(w,h);
    const destination = result.data;
    for (let y=0; y<h; y++) {
      for (let x=0; x<w; x++) {
        const src = ((h-1-y)*w+x)*4;
        const dst = (y*w+x)*4;
        const inverseAlpha = 1-overlay[src+3]/255;
        for (let channel=0; channel<3; channel++) {
          destination[dst+channel] = overlay[src+channel]+background[src+channel]*inverseAlpha;
        }
        destination[dst+3] = 255;
      }
    }
    ctx.putImageData(result,0,0);
    return canvas;
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
    this.gl.deleteVertexArray(this.vao);
  }
}
