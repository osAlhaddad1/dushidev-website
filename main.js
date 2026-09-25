/* ==========================================================================
   DUSHIDEV — interactive grain gradient fields + UI behaviour
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  /* ------------------------------------------------------------------------
     Shared field config — every gradient canvas reads from this
     ------------------------------------------------------------------------ */
  const cfg = { pink: 80, blue: 85, red: 70, speed: 50, grain: 45, warp: 55, motion: reduceMotion ? 'still' : 'flow', cursor: 'attract', seed: 0x3FA2 };

  const COLORS = {
    pink: [1.0, 0.18, 0.58],
    blue: [0.18, 0.36, 1.0],
    red:  [0.92, 0.07, 0.10],
  };
  /* ------------------------------------------------------------------------
     Shaders
     ------------------------------------------------------------------------ */
  const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

  // Pass 1 — the light field, rendered at reduced resolution into a texture
  const FRAG_FIELD = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uClock;
uniform vec2  uMouse;
uniform float uHover;
uniform float uForce;
uniform vec3  uPink;
uniform vec3  uBlue;
uniform vec3  uRed;
uniform vec3  uGain;
uniform float uWarp;
uniform float uSeed;
uniform vec4  uPulse[4];

vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz;
  x12.xy-=i1;
  i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;
  vec3 h=abs(x)-.5;
  vec3 ox=floor(x+.5);
  vec3 a0=x-ox;
  m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x=a0.x*x0.x+h.x*x0.y;
  g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
float fbm(vec2 p){
  float v=0.,a=.5;
  for(int i=0;i<3;i++){v+=a*snoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}
  return v;
}
float blob(vec2 p,vec2 c,float r){vec2 d=p-c;return exp(-dot(d,d)/(r*r));}

void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  vec2 p=(uv-.5)*vec2(asp,1.);
  vec2 m=(uMouse-.5)*vec2(asp,1.);

  // click pulses: an expanding ring that shoves the field outward
  float ring=0.;
  for(int i=0;i<4;i++){
    vec4 k=uPulse[i];
    float age=uClock-k.z;
    if(age>0.&&age<2.2){
      vec2 d=p-(k.xy-.5)*vec2(asp,1.);
      float r=length(d);
      float life=1.-age/2.2;
      float band=exp(-pow((r-age*.8)*6.,2.))*life*life*k.w;
      p-=d/(r+1e-4)*band*.12;
      ring+=band;
    }
  }

  // cursor lens: pull (attract) or push (repel) space around the pointer
  vec2 dm=p-m;
  float lens=exp(-dot(dm,dm)*4.)*uHover;
  p-=dm*lens*.55*uForce;

  float t=uTime*.07;
  vec2 q=vec2(fbm(p*1.25+vec2(uSeed,t)),fbm(p*1.25+vec2(-t*1.1,uSeed+3.7)));
  vec2 w=p+q*uWarp;

  vec2 c1=vec2(sin(t*1.9+uSeed)*.55*asp, cos(t*1.3+uSeed*.7)*.34);
  vec2 c2=vec2(cos(t*1.2+1.7+uSeed)*.5*asp, sin(t*1.7+.4)*.38);
  vec2 c3=vec2(sin(t*.9+3.9+uSeed*.3)*.6*asp, cos(t*2.1+uSeed*1.3)*.3);

  float f1=blob(w,c1,.36);
  float f2=blob(w,c2,.42);
  float f3=blob(w,c3,.31);
  float fm=blob(w,m,.22)*uHover;

  float silk=max(0.,.66+.5*snoise(w*2.2+vec2(t*2.,-t)));

  // the cursor carries its own light, cycling pink -> blue -> red
  float ph=uClock*.5;
  vec3 cw=vec3(.5+.5*sin(ph),.5+.5*sin(ph+2.094),.5+.5*sin(ph+4.189));
  cw/=(cw.x+cw.y+cw.z);
  vec3 curCol=uPink*cw.x+uBlue*cw.y+uRed*cw.z;

  // dark: additive light, tone-mapped
  vec3 acc=(uPink*f1*uGain.x+uBlue*f2*uGain.y+uRed*f3*uGain.z)*silk+curCol*fm*1.1;
  acc=max(acc-.035,0.);
  vec3 col=(1.-exp(-acc*1.9))+ring*.05;

  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

  // Pass 2 — upscale the field and lay film grain at full resolution
  const FRAG_GRAIN = `
precision highp float;
uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uGrain;
uniform float uGrainT;
float hash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
void main(){
  vec3 col=texture2D(uTex,gl_FragCoord.xy/uRes).rgb;
  // fine + coarse grain, heavier inside the light than in the black
  float g1=hash(gl_FragCoord.xy+uGrainT*vec2(97.13,41.71))-.5;
  float g2=hash(floor(gl_FragCoord.xy*.5)+uGrainT*vec2(13.17,71.31))-.5;
  float luma=dot(col,vec3(.299,.587,.114));
  float amt=uGrain*mix(.3,1.,smoothstep(0.,.22,luma));
  col+=(g1*.75+g2*.55)*amt;
  gl_FragColor=vec4(clamp(col,0.,1.),1.);
}`;

  /* ------------------------------------------------------------------------
     Pointer (global, so text layered over a canvas doesn't block it)
     ------------------------------------------------------------------------ */
  const P = { x: -9999, y: -9999, active: false };
  addEventListener('pointermove', (e) => { P.x = e.clientX; P.y = e.clientY; P.active = true; }, { passive: true });
  addEventListener('pointerdown', (e) => { P.x = e.clientX; P.y = e.clientY; P.active = true; }, { passive: true });
  addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') P.active = false; }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { P.active = false; });
  addEventListener('blur', () => { P.active = false; });

  /* ------------------------------------------------------------------------
     Field
     ------------------------------------------------------------------------ */
  const FIELD_UNIFORMS = ['uRes', 'uTime', 'uClock', 'uMouse', 'uHover', 'uForce', 'uPink', 'uBlue', 'uRed', 'uGain', 'uWarp', 'uSeed', 'uPulse'];
  const GRAIN_UNIFORMS = ['uTex', 'uRes', 'uGrain', 'uGrainT'];
  const MAX_LIVE = 2; // at most two gradient fields render per frame
  const VARIANT_SEED = { hero: 0, service: 11.4, portfolio: 29.1, team: 64.2, contact: 41.9, cta: 53.7 };

  class Field {
    constructor(canvas) {
      this.canvas = canvas;
      this.host = canvas.closest('[data-field-host]') || canvas.parentElement;
      this.name = canvas.dataset.field;
      this.offset = VARIANT_SEED[this.name] || 0;
      this.mouse = { x: 0.62, y: 0.55 };
      this.target = { x: 0.62, y: 0.55 };
      this.hover = 0;
      this.pulses = new Float32Array(16).fill(-99);
      this.pulseIdx = 0;
      this.outScale = Math.min(window.devicePixelRatio || 1, 1.5); // grain pass: crisp
      this.fieldScale = 0.5;                                        // light pass: smooth, cheap
      this.visible = false;
      this.ratio = 0;
      this.slow = 0;
      this.ok = this.init();
      if (!this.ok) { this.host.classList.add('no-webgl'); return; }

      new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; this.ratio = e.intersectionRatio; },
        { rootMargin: '80px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }).observe(canvas);
      new ResizeObserver(() => this.resize()).observe(canvas);
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; this.host.classList.add('no-webgl'); });

      this.host.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('a, button, input, textarea, label, select')) return;
        this.pulse(e.clientX, e.clientY);
      });
      this.resize();
    }

    init() {
      const gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
      if (!gl) return false;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
        return s;
      };
      const link = (fragSrc, names) => {
        const vs = compile(gl.VERTEX_SHADER, VERT);
        const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
        if (!vs || !fs) return null;
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, 'a');
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return null; }
        const u = {};
        for (const n of names) u[n] = gl.getUniformLocation(prog, n);
        return { prog, u };
      };
      this.gl = gl;
      this.pField = link(FRAG_FIELD, FIELD_UNIFORMS);
      this.pGrain = link(FRAG_GRAIN, GRAIN_UNIFORMS);
      if (!this.pField || !this.pGrain) return false;

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.fw = 2; this.fh = 2;
      return true;
    }

    resize() {
      if (!this.ok) return;
      const gl = this.gl;
      const r = this.canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(r.width * this.outScale));
      const h = Math.max(2, Math.round(r.height * this.outScale));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      const fw = Math.max(2, Math.round(r.width * this.fieldScale));
      const fh = Math.max(2, Math.round(r.height * this.fieldScale));
      if (fw !== this.fw || fh !== this.fh) {
        this.fw = fw; this.fh = fh;
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
    }

    pulse(cx, cy, strength = 1) {
      const r = this.canvas.getBoundingClientRect();
      const i = this.pulseIdx * 4;
      this.pulses[i] = (cx - r.left) / r.width;
      this.pulses[i + 1] = 1 - (cy - r.top) / r.height;
      this.pulses[i + 2] = clock;
      this.pulses[i + 3] = strength;
      this.pulseIdx = (this.pulseIdx + 1) % 4;
    }

    pulseCenter(strength = 1) {
      const r = this.canvas.getBoundingClientRect();
      this.pulse(r.left + r.width / 2, r.top + r.height / 2, strength);
    }

    render(dt) {
      const gl = this.gl;
      const r = this.canvas.getBoundingClientRect();
      const inside = P.active && P.x >= r.left && P.x <= r.right && P.y >= r.top && P.y <= r.bottom;
      if (inside) {
        this.target.x = (P.x - r.left) / r.width;
        this.target.y = 1 - (P.y - r.top) / r.height;
      }
      const km = 1 - Math.exp(-dt * 6);
      const kh = 1 - Math.exp(-dt * (inside ? 4 : 1.6));
      this.mouse.x += (this.target.x - this.mouse.x) * km;
      this.mouse.y += (this.target.y - this.mouse.y) * km;
      this.hover += ((inside ? 1 : 0) - this.hover) * kh;


      // pass 1: light field -> texture
      let u = this.pField.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.fw, this.fh);
      gl.useProgram(this.pField.prog);
      gl.uniform2f(u.uRes, this.fw, this.fh);
      gl.uniform1f(u.uTime, flowTime + this.offset * 13.0);
      gl.uniform1f(u.uClock, clock);
      gl.uniform2f(u.uMouse, this.mouse.x, this.mouse.y);
      gl.uniform1f(u.uHover, this.hover);
      gl.uniform1f(u.uForce, cfg.cursor === 'repel' ? -1.0 : 1.0);
      gl.uniform3fv(u.uPink, COLORS.pink);
      gl.uniform3fv(u.uBlue, COLORS.blue);
      gl.uniform3fv(u.uRed, COLORS.red);
      const g = this.gain || [1, 1, 1];
      gl.uniform3f(u.uGain, cfg.pink / 100 * 1.1 * g[0], cfg.blue / 100 * 1.1 * g[1], cfg.red / 100 * 1.1 * g[2]);
      gl.uniform1f(u.uWarp, cfg.warp / 100 * 1.2);
      gl.uniform1f(u.uSeed, (cfg.seed % 997) / 61 + this.offset);
      gl.uniform4fv(u.uPulse, this.pulses);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // pass 2: upscale + film grain -> screen
      u = this.pGrain.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.pGrain.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(u.uTex, 0);
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(u.uGrain, cfg.grain / 100 * 0.24);
      gl.uniform1f(u.uGrainT, grainT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // adaptive quality: step the light pass down if this device is struggling
      if (dt > 1 / 40) this.slow++; else this.slow = Math.max(0, this.slow - 1);
      if (this.slow > 45 && (this.fieldScale > 0.3 || this.outScale > 1)) {
        if (this.fieldScale > 0.3) this.fieldScale = Math.max(0.3, this.fieldScale * 0.8);
        else this.outScale = 1;
        this.slow = 0;
        this.resize();
      }
    }
  }

  /* ------------------------------------------------------------------------
     Language (EN lives in the HTML, PAP comes from i18n.js)
     ------------------------------------------------------------------------ */
  const I18N = window.DD_I18N || { pap: {}, ui: {} };
  let lang = document.documentElement.lang === 'pap' ? 'pap' : 'en';
  const ui = (key, ...args) => {
    const table = (I18N.ui && I18N.ui[lang]) || {};
    const fallback = (I18N.ui && I18N.ui.en) || {};
    const v = key in table ? table[key] : fallback[key];
    return typeof v === 'function' ? v(...args) : (v == null ? key : v);
  };

  /* ------------------------------------------------------------------------
     Render loop
     ------------------------------------------------------------------------ */
  const fields = $$('canvas[data-field]').map((c) => new Field(c)).filter((f) => f.ok);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

  let flowTime = (cfg.seed % 1000) * 0.37;
  let clock = 0;
  let grainT = 0;
  let frame = 0;
  let last = performance.now();
  let fpsAcc = 0, fpsFrames = 0;

  const read = (k) => $$(`[data-read="${k}"]`);
  const R = { x: read('x'), y: read('y'), fps: read('fps'), state: read('state') };
  const setText = (els, v) => { for (const el of els) if (el.textContent !== v) el.textContent = v; };

  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    const speed = cfg.motion === 'still' ? 0 : (cfg.speed / 50);
    flowTime += dt * speed;
    frame++;
    if (!reduceMotion && frame % 2 === 0) grainT = (grainT + 1.37) % 97;

    // only the most-visible fields animate; the rest hold their last frame
    const live = fields.filter((f) => f.visible && f.ok).sort((a, b) => b.ratio - a.ratio).slice(0, MAX_LIVE);
    for (const f of live) f.render(dt);

    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      setText(R.fps, String(Math.round(fpsFrames / fpsAcc)).padStart(2, '0'));
      fpsAcc = 0; fpsFrames = 0;
    }
    const hf = byName.hero;
    if (hf && hf.visible) {
      setText(R.x, hf.mouse.x.toFixed(3));
      setText(R.y, hf.mouse.y.toFixed(3));
    }
    requestAnimationFrame(tick);
  }
  if (fields.length) requestAnimationFrame(tick);
  else setText(R.state, 'STATIC');

  function syncState() { setText(R.state, ui(cfg.motion === 'still' ? 'hold' : 'live')); }

  /* ------------------------------------------------------------------------
     Menu: full-screen card
     ------------------------------------------------------------------------ */
  const nav = $('[data-nav]');
  const menu = $('[data-menu]');
  const menuCard = $('[data-menu-card]');
  const menuBtn = $('[data-menu-toggle]');
  const menuLabel = $('[data-menu-label]');
  let lastFocus = null;

  function setMenu(open) {
    if (open === !menu.hidden) return;
    menu.hidden = !open;
    nav.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuLabel.textContent = ui(open ? 'close' : 'menu');
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      lastFocus = document.activeElement;
      const here = $('.menu__links a[aria-current="page"]', menu) || $('.menu__links a', menu);
      here && here.focus({ preventScroll: true });
    } else if (lastFocus && lastFocus.focus) {
      lastFocus.focus({ preventScroll: true });
    }
  }
  menuBtn.addEventListener('click', () => setMenu(menu.hidden));
  $$('a', menu).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') { setMenu(false); return; }
    if (e.key === 'Tab') {
      // keep focus inside the bar + card while the menu is open
      const f = [...$$('button, a', nav.querySelector('.nav__bar')), ...$$('a, button', menu)].filter((el) => el.offsetParent !== null);
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  menu.addEventListener('pointermove', (e) => {
    const r = menuCard.getBoundingClientRect();
    menuCard.style.setProperty('--gx', `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`);
    menuCard.style.setProperty('--gy', `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`);
  });

  /* ------------------------------------------------------------------------
     Pages: one document, each page has its own #address
     ------------------------------------------------------------------------ */
  const pages = $$('[data-page]');
  const PAGE_IDS = pages.map((p) => p.dataset.page).filter((p) => p !== 'service');
  const SERVICES = ['development', 'security', 'infrastructure'];
  const SERVICE_GAIN = { development: [1.15, 0.45, 0.35], security: [0.35, 1.15, 0.3], infrastructure: [0.5, 0.35, 1.2] };
  const ctaBand = $('[data-cta-band]');
  let current = null;   // route token: home, development, portfolio, ...

  const TITLES = {
    en: { development: 'Development', security: 'Cyber Security', infrastructure: 'Infrastructure & Optimization', portfolio: 'Portfolio', team: 'The Team', contact: 'Get a Quote' },
    pap: { development: 'Desaroyo', security: 'Cyber Security', infrastructure: 'Infrastructura & Optimisacion', portfolio: 'Portfolio', team: 'E Team', contact: 'Pidi un Quote' },
  };
  function setTitle() {
    const name = TITLES[lang][current];
    document.title = name ? `${name} · DushiDev` : 'DushiDev';
  }

  function resolve() {
    const token = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!token) return { token: 'home' };
    if (PAGE_IDS.includes(token) || SERVICES.includes(token)) return { token };
    const el = document.getElementById(token);
    if (el) {
      const host = el.closest('[data-page]');
      return host ? { token: host.dataset.page, anchor: el } : null; // e.g. #main: leave it to the browser
    }
    return { token: 'home' };
  }

  function show(token) {
    if (token === current) return false;
    current = token;
    const svc = SERVICES.includes(token) ? token : null;
    const page = svc ? 'service' : token;
    pages.forEach((p) => { p.hidden = p.dataset.page !== page; });
    if (svc) {
      $$('[data-svc]').forEach((el) => { el.hidden = el.dataset.svc !== svc; });
      if (byName.service) byName.service.gain = SERVICE_GAIN[svc];
    }
    if (ctaBand) ctaBand.hidden = page === 'contact';
    $$('[data-route-link]').forEach((a) => {
      if (a.dataset.routeLink === token) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.body.dataset.route = token;
    setTitle();
    setMenu(false);
    return true;
  }

  function route() {
    const r = resolve();
    if (!r) return;
    const changed = show(r.token);
    if (r.anchor) requestAnimationFrame(() => r.anchor.scrollIntoView({ block: 'start' }));
    else if (changed) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
  addEventListener('hashchange', route);

  // clicking the link for the page you're already on takes you back to its top
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const token = a.getAttribute('href').slice(1);
    if ((PAGE_IDS.includes(token) || SERVICES.includes(token)) && location.hash === `#${token}`) {
      setMenu(false);
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  });

  $$('[data-to-top]').forEach((b) => b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })));

  /* ------------------------------------------------------------------------
     Stats: team dots
     ------------------------------------------------------------------------ */
  $$('.dots').forEach((row) => {
    const n = Number(row.dataset.count) || 0;
    const lit = Number(row.dataset.lit) || 0;
    row.innerHTML = Array.from({ length: n }, (_, i) => `<i${i < lit ? ' class="on"' : ''}></i>`).join('');
  });

  /* ------------------------------------------------------------------------
     Portfolio filter
     ------------------------------------------------------------------------ */
  const grid = $('[data-filter-grid]');
  function updateFilterCount() {
    if (!grid) return;
    const n = $$('.work-card', grid).filter((c) => !c.hidden).length;
    setText($$('[data-filter-count]'), ui('showing', n));
  }
  if (grid) {
    const cards = $$('.work-card', grid);
    const count = (cat) => cards.filter((c) => cat === 'all' || c.dataset.cat === cat).length;
    $$('[data-count-for]').forEach((el) => { el.textContent = String(count(el.dataset.countFor)).padStart(2, '0'); });
    const apply = (cat) => {
      cards.forEach((c) => { c.hidden = !(cat === 'all' || c.dataset.cat === cat); });
      $$('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === cat)));
      updateFilterCount();
    };
    $$('[data-filter]').forEach((b) => b.addEventListener('click', () => apply(b.dataset.filter)));
    apply('all');
  }

  /* ------------------------------------------------------------------------
     Work covers: gradient light follows the cursor
     ------------------------------------------------------------------------ */
  $$('.work-card').forEach((card) => {
    const cover = $('.work-card__cover', card);
    const cs = getComputedStyle(cover);
    const rest = { x: parseFloat(cs.getPropertyValue('--px')) || 50, y: parseFloat(cs.getPropertyValue('--py')) || 50 };
    card.addEventListener('pointermove', (e) => {
      const r = cover.getBoundingClientRect();
      cover.style.setProperty('--px', clamp((e.clientX - r.left) / r.width * 100, -10, 110).toFixed(1));
      cover.style.setProperty('--py', clamp((e.clientY - r.top) / r.height * 100, -10, 110).toFixed(1));
    });
    card.addEventListener('pointerleave', () => {
      cover.style.setProperty('--px', rest.x);
      cover.style.setProperty('--py', rest.y);
    });
  });

  /* ------------------------------------------------------------------------
     Services + founders: grainy spotlight tracks the cursor
     ------------------------------------------------------------------------ */
  $$('.spot').forEach((row) => {
    row.addEventListener('pointermove', (e) => {
      const r = row.getBoundingClientRect();
      row.style.setProperty('--mx', `${e.clientX - r.left}px`);
      row.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  /* ------------------------------------------------------------------------
     Timelines (story + each service): light a step's segments
     ------------------------------------------------------------------------ */
  $$('[data-timeline]').forEach((timeline) => {
    // four steps of five segments; the last one is ongoing
    timeline.innerHTML = [0, 1, 2, 3].map((p) =>
      `<span class="tl-phase">${`<i data-p="${p}"${p === 3 ? ' class="ongoing"' : ''}></i>`.repeat(5)}</span>`).join('');
    const segs = $$('i', timeline);
    const steps = $$('.step', timeline.parentElement);
    const activate = (p) => {
      if (p == null) { timeline.removeAttribute('data-active'); steps.forEach((s) => s.classList.remove('is-active')); segs.forEach((s) => s.classList.remove('lit')); return; }
      timeline.setAttribute('data-active', p);
      segs.forEach((s) => s.classList.toggle('lit', s.dataset.p === String(p)));
      steps.forEach((s) => s.classList.toggle('is-active', s.dataset.phase === String(p)));
    };
    steps.forEach((s) => {
      s.addEventListener('pointerenter', () => activate(s.dataset.phase));
      s.addEventListener('focus', () => activate(s.dataset.phase));
      s.addEventListener('pointerleave', () => activate(null));
      s.addEventListener('blur', () => activate(null));
    });
  });

  /* ------------------------------------------------------------------------
     Footer wordmark: dot-matrix lit by moving light
     ------------------------------------------------------------------------ */
  const wordmark = $('[data-wordmark]');
  const footer = $('[data-footer]');
  if (wordmark && footer) {
    footer.addEventListener('pointermove', (e) => {
      const r = wordmark.getBoundingClientRect();
      wordmark.style.setProperty('--fx', `${clamp((e.clientX - r.left) / r.width * 100, -20, 120).toFixed(1)}%`);
      wordmark.style.setProperty('--fy', `${clamp((e.clientY - r.top) / r.height * 100, -60, 160).toFixed(1)}%`);
    });
  }

  /* ------------------------------------------------------------------------
     Copy buttons
     ------------------------------------------------------------------------ */
  function selectText(el) {
    if (typeof el.select === 'function') { el.focus(); el.select(); return; }
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  $$('[data-copy-target]').forEach((btn) => btn.addEventListener('click', () => {
    const src = $(btn.dataset.copyTarget);
    if (!src) return;
    const text = (typeof src.value === 'string' ? src.value : src.textContent).trim();
    const restore = btn.innerHTML;
    const done = (msg) => { btn.textContent = msg; setTimeout(() => { btn.innerHTML = restore; }, 1800); };
    try {
      navigator.clipboard.writeText(text).then(() => done(ui('copied')), () => { selectText(src); done(ui('copyFail')); });
    } catch (e) {
      selectText(src);
      done(ui('copyFail'));
    }
  }));

  /* ------------------------------------------------------------------------
     Contact form: builds an email the visitor sends themselves
     (a static site has no server to deliver it)
     ------------------------------------------------------------------------ */
  const SERVICE_NAME = {
    en: { dev: 'Development', sec: 'Cyber Security', infra: 'Infrastructure & Optimization' },
    pap: { dev: 'Desaroyo', sec: 'Cyber Security', infra: 'Infrastructura & Optimisacion' },
  };
  const form = $('[data-form]');
  if (form) {
    const status = $('[data-status]', form);
    const email = $('#f-email', form);
    const err = $('[data-error="email"]', form);
    const row = email.closest('.field-row');
    const draft = $('[data-draft]', form);
    const draftText = $('[data-draft-text]', form);
    const draftMail = $('[data-draft-mail]', form);
    const clearErr = () => { row.classList.remove('has-error'); err.textContent = ''; };
    email.addEventListener('input', clearErr);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = email.value.trim();
      if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        row.classList.add('has-error');
        err.textContent = ui(v ? 'errFormat' : 'errRequired');
        email.focus();
        return;
      }
      const data = new FormData(form);
      const name = String(data.get('name') || '').trim();
      const service = SERVICE_NAME[lang][String(data.get('service') || 'dev')];
      const idea = String(data.get('message') || '').trim();
      const subject = ui('subject', service, name);
      const body = [`${ui('name')}: ${name || '-'}`, `${ui('email')}: ${v}`, `${ui('service')}: ${service}`, '', idea || ui('noIdea')].join('\n');

      draftText.value = `To: contact@dushi.dev\nSubject: ${subject}\n\n${body}`;
      draftMail.href = `mailto:contact@dushi.dev?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      draft.hidden = false;
      status.textContent = ui('ready');
      status.classList.add('is-ok');
      byName.contact && byName.contact.pulseCenter(1);
    });
  }

  /* ------------------------------------------------------------------------
     Footer clock + year
     ------------------------------------------------------------------------ */
  const clockEl = $('[data-clock]');
  const yearEl = $('[data-year]');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  if (clockEl) {
    let f;
    try { f = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Aruba', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
    catch (e) { f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); }
    const t = () => { clockEl.textContent = f.format(new Date()); };
    t();
    setInterval(t, 1000);
  }

  /* ------------------------------------------------------------------------
     Apply language, then open the page named in the address
     ------------------------------------------------------------------------ */
  const EN_HTML = new Map($$('[data-i18n]').map((el) => [el, el.innerHTML]));
  const EN_PH = new Map($$('[data-i18n-ph]').map((el) => [el, el.getAttribute('placeholder') || '']));
  const EN_ARIA = new Map($$('[data-i18n-aria]').map((el) => [el, el.getAttribute('aria-label') || '']));

  function applyLang(next, persist) {
    lang = next === 'pap' ? 'pap' : 'en';
    document.documentElement.lang = lang;
    const dict = lang === 'pap' ? (I18N.pap || {}) : null;
    EN_HTML.forEach((html, el) => {
      const v = dict && dict[el.dataset.i18n];
      el.innerHTML = v == null ? html : v;
    });
    EN_PH.forEach((ph, el) => {
      const v = dict && dict[el.dataset.i18nPh];
      el.setAttribute('placeholder', v == null ? ph : v);
    });
    EN_ARIA.forEach((label, el) => {
      const v = dict && dict[el.dataset.i18nAria];
      el.setAttribute('aria-label', v == null ? label : v.replace(/&amp;/g, '&'));
    });
    $$('[data-lang-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.langSet === lang)));
    if (persist) store.set('dd-lang', lang);
    menuLabel.textContent = ui(menu.hidden ? 'menu' : 'close');
    syncState();
    updateFilterCount();
    setTitle();
  }
  $$('[data-lang-set]').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.langSet, true)));

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  route();
  applyLang(lang, false);
})();
