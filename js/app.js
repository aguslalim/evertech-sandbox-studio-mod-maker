(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = n => new Intl.NumberFormat('id-ID').format(n || 0);
  const extOf = name => (String(name || '').split('.').pop() || '').toLowerCase();
  const safeName = (name, fallback = 'mod') => String(name || fallback).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || fallback;
  const safeFile = (name, fallback = 'asset') => {
    const parts = String(name || '').split('.');
    const ext = parts.length > 1 ? '.' + parts.pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    return safeName(parts.join('.'), fallback) + ext;
  };
  const humanBytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
  let model = null, primaryModelFile = null, sourceFiles = [], textureFile = null, textureBytes = null, textureImage = null, textureObjectUrl = null;
  let selectedMeshIndex = 0;
  let projectUuid = makeUuid(), jsonWasManuallyEdited = false, importBusy = false, toastTimer = null;
  let ctx = null, gridCtx = null, canvasWidth = 0, canvasHeight = 0, dpr = 1, frameRequested = false;
  let gl = null, glProgram = null, glRendererReady = false, glSourceModel = null, glMeshes = [], glTextureCache = new WeakMap();
  let glLocations = null;
  let gizmoMode = 'move';
  let faceRendering = true, doubleFace = false, layoutMode = 'auto';
  const generatedTextureUrls = new Set();
  const camera = { yaw: 0.72, pitch: 0.32, distance: 7, target: [0, 0, 0], fov: 45 };
  const drag = { pointers: new Map(), lastX: 0, lastY: 0, pinchDistance: 0, mode: 'orbit' };
  const PALETTE = ['#9aa9bf', '#80a0ce', '#c4a0b9', '#a2b6a5', '#d0b083', '#a5a4d5'];

  function itemMeta(mesh){
    if(!mesh.evts)mesh.evts={};const e=mesh.evts;
    if(!e.uuid)e.uuid=makeUuid();if(!e.itemName)e.itemName=mesh.name||'Custom Part';if(!mesh.nodeId)mesh.nodeId=makeUuid();if(!e.groupName)e.groupName='Scene';if(e.parentId===undefined)e.parentId=null;
    if(e.exportItem===undefined)e.exportItem=true;if(!e.collider)e.collider='default';
    if(!Number.isFinite(e.scale))e.scale=1;
    if(!e.colliderOptions)e.colliderOptions={};
    for(const [k,v] of Object.entries({SizeX:3,SizeY:.35,SizeZ:3,OffsetX:0,OffsetY:0,OffsetZ:0}))if(!Number.isFinite(e.colliderOptions[k]))e.colliderOptions[k]=v;
    if(!Number.isFinite(e.meshOffsetY))e.meshOffsetY=0;
    if(!mesh.transform)mesh.transform={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
    if(!mesh.localCenter){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<mesh.positions.length;i+=3)for(let a=0;a<3;a++){const v=mesh.positions[i+a];min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);}mesh.localCenter=min.map((v,i)=>(v+max[i])/2);}
    return e;
  }
  function activeMesh(){return model&&model.meshes[selectedMeshIndex]||null;}
  function activeTransform(){const mesh=activeMesh();return mesh?mesh.transform:model&&model.transform;}
  function meshByNodeId(id){return model&&model.meshes.find(m=>m.nodeId===id)||null;}
  function meshTransformChain(mesh){const chain=[],seen=new Set();let current=mesh;while(current&&!seen.has(current.nodeId)){chain.push(current);seen.add(current.nodeId);current=current.evts&&current.evts.parentId?meshByNodeId(current.evts.parentId):null;}return chain;}
  function meshDepth(mesh){return Math.max(0,meshTransformChain(mesh).length-1);}
  function parentWouldCycle(mesh,parentId){let p=parentId?meshByNodeId(parentId):null,seen=new Set();while(p&&!seen.has(p.nodeId)){if(p.nodeId===mesh.nodeId)return true;seen.add(p.nodeId);p=p.evts&&p.evts.parentId?meshByNodeId(p.evts.parentId):null;}return false;}
  function renderParentOptions(mesh){const select=$('activeParent');if(!select)return;const old=mesh&&mesh.evts.parentId||'';let html='<option value="">Scene root</option>';if(model&&mesh)for(const candidate of model.meshes){if(candidate===mesh||parentWouldCycle(mesh,candidate.nodeId))continue;html+=`<option value="${candidate.nodeId}">${escapeHtml(candidate.name)}</option>`;}select.innerHTML=html;select.value=old;}

  function meshFolderName(mesh,index){return safeName(mesh&&mesh.evts&&mesh.evts.exportFolderName||mesh&&mesh.name||`Mesh_${index+1}`,`Mesh_${index+1}`);}
  function meshObjPath(mesh,index){const n=meshFolderName(mesh,index);return `meshes/${n}/${n}.obj`;}
  function meshTexture(mesh){if(!mesh)return null;const hasOverride=!!(mesh.materialTextureBytes&&mesh.materialTextureImage);if(hasOverride)return{image:mesh.materialTextureImage,bytes:mesh.materialTextureBytes,filename:mesh.materialTextureFileName||'diffuse.png',type:mesh.materialTextureType||'image/png',objectUrl:mesh.materialTextureObjectUrl||null,override:true};if(mesh.textureBytes&&mesh.textureImage)return{image:mesh.textureImage,bytes:mesh.textureBytes,filename:mesh.textureFileName||'diffuse.png',type:mesh.textureType||'image/png',objectUrl:mesh.textureObjectUrl||null,override:false};return null;}
  function meshTexturePath(mesh,index){const tex=meshTexture(mesh);if(!tex)return'';const n=meshFolderName(mesh,index),ext=extOf(tex.filename)||'png';return `textures/${n}/diffuse.${ext}`;}
  function syncTextureGlobalsFromSelection(){const m=activeMesh();if(!m)return;const tex=meshTexture(m);textureFile=m.materialTextureFile||null;textureBytes=tex&&tex.bytes||null;textureImage=tex&&tex.image||null;textureObjectUrl=tex&&tex.objectUrl||null;}
  function refreshExportFolderNames(meshes){const used=new Set();(meshes||[]).forEach((m,i)=>{const base=safeName(m.name||`Mesh_${i+1}`,`Mesh_${i+1}`);let candidate=base,n=2;while(used.has(candidate.toLowerCase()))candidate=base+'_'+n++;used.add(candidate.toLowerCase());itemMeta(m).exportFolderName=candidate;});}
  function ensureMeshMetadata(meshes){meshes.forEach((m,i)=>{if(!m.name)m.name=`Mesh_${i+1}`;itemMeta(m);});refreshExportFolderNames(meshes);selectedMeshIndex=Math.max(0,Math.min(selectedMeshIndex,meshes.length-1));}
  function makePlaceholderPng(label,width=256,height=256){const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');x.fillStyle='#222a33';x.fillRect(0,0,width,height);x.strokeStyle='#4aa8ed';x.lineWidth=Math.max(2,width/64);const cx=width/2,cy=height*.43,r=Math.min(width,height)*.19;x.beginPath();x.moveTo(cx,cy-r);x.lineTo(cx+r,cy-r*.45);x.lineTo(cx+r,cy+r*.55);x.lineTo(cx,cy+r);x.lineTo(cx-r,cy+r*.55);x.lineTo(cx-r,cy-r*.45);x.closePath();x.stroke();x.beginPath();x.moveTo(cx,cy-r);x.lineTo(cx,cy+r);x.moveTo(cx-r,cy-r*.45);x.lineTo(cx,cy);x.lineTo(cx+r,cy-r*.45);x.stroke();x.fillStyle='#f0f5fa';x.font=`600 ${Math.max(10,width/17)}px system-ui`;x.textAlign='center';x.textBaseline='middle';let title=String(label||'EVTS MOD');if(title.length>24)title=title.slice(0,22)+'…';x.fillText(title,cx,height*.83);return new Blob([decodeDataUri(c.toDataURL('image/png'))],{type:'image/png'});}

  function makeUuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function setEngineBadge(message, good = true) {
    $('engineStatus').innerHTML = `<span class="dot" style="background:${good ? 'var(--green)' : 'var(--amber)'}"></span> ${message}`;
  }
  function setPage(name) {
    document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'config' && !jsonWasManuallyEdited) syncJsonFromForm();
  }
  document.querySelectorAll('.navbtn').forEach(b => b.addEventListener('click', () => setPage(b.dataset.page)));

  function projectUpdate() {
    $('projectTitle').textContent = $('modName').value.trim() || 'Untitled Mod';
    $('projectMeta').innerHTML = `${model ? `${model.meshes.length} mesh imported` : 'No model imported'}<br>${model?model.meshes.filter(m=>!!meshTexture(m)).length:0} textured mesh(es) · local session`;
    const progress = (model ? 50 : 0) + (textureFile ? 20 : 0) + ($('modName').value.trim() && $('author').value.trim() ? 20 : 0) + 10;
    $('projectProgress').style.width = `${Math.min(100, progress)}%`;
  }
  function statusReport(message, type = '') {
    const el = $('validationReport'); el.textContent = message; el.className = 'status ' + type;
  }
  function setExportStatus(message, type = 'info') {
    const el = $('exportStatus'); el.textContent = message; el.className = 'status ' + type;
  }
  function updateValidationBadge(message, type = '') {
    const el = $('validationBadge'); el.textContent = message; el.className = 'pill' + (type ? ` ${type}` : '');
  }

  // ---------- Minimal, self-contained Canvas 3D viewport ----------
  // GPU-backed preview: perspective-correct texture mapping + depth buffer, no triangle sampling.
  function initGLRenderer() {
    const canvas = $('viewGL');
    try { gl = canvas.getContext('webgl', { alpha:true, antialias:true, depth:true, premultipliedAlpha:false, powerPreference:'high-performance' }) || canvas.getContext('experimental-webgl'); }
    catch (_) { gl = null; }
    if (!gl) return false;
    const vertex = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec2 aUV;
      attribute vec3 aBarycentric;
      uniform mat4 uMVP;
      uniform mat3 uNormalMatrix;
      varying vec3 vNormal;
      varying vec2 vUV;
      varying vec3 vBarycentric;
      void main(){ gl_Position=uMVP*vec4(aPosition,1.0); vNormal=normalize(uNormalMatrix*aNormal); vUV=aUV; vBarycentric=aBarycentric; }
    `;
    const fragment = `
      precision mediump float;
      uniform sampler2D uTexture;
      uniform float uUseTexture;
      uniform vec3 uColor;
      uniform float uOnFace;
      varying vec3 vNormal;
      varying vec2 vUV;
      varying vec3 vBarycentric;
      void main(){
        if(uOnFace < 0.5){
          float edge=min(vBarycentric.x,min(vBarycentric.y,vBarycentric.z));
          if(edge > 0.018) discard;
          gl_FragColor=vec4(0.07,0.09,0.12,1.0);
          return;
        }
        vec4 base = uUseTexture > 0.5 ? texture2D(uTexture, vUV) : vec4(uColor,1.0);
        float ndl=max(dot(normalize(vNormal),normalize(vec3(-0.35,0.82,0.45))),0.0);
        float shade=0.58+ndl*0.42;
        gl_FragColor=vec4(base.rgb*shade,base.a);
      }
    `;
    const compile = (type, source) => {
      const sh=gl.createShader(type); gl.shaderSource(sh,source); gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){ const msg=gl.getShaderInfoLog(sh)||'shader compile failed'; gl.deleteShader(sh); throw new Error(msg); }
      return sh;
    };
    try {
      const vs=compile(gl.VERTEX_SHADER,vertex), fs=compile(gl.FRAGMENT_SHADER,fragment), program=gl.createProgram();
      gl.attachShader(program,vs); gl.attachShader(program,fs); gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)||'program link failed');
      glProgram=program;
      glLocations={ pos:gl.getAttribLocation(program,'aPosition'), normal:gl.getAttribLocation(program,'aNormal'), uv:gl.getAttribLocation(program,'aUV'), bary:gl.getAttribLocation(program,'aBarycentric'), mvp:gl.getUniformLocation(program,'uMVP'), normalMatrix:gl.getUniformLocation(program,'uNormalMatrix'), tex:gl.getUniformLocation(program,'uTexture'), useTex:gl.getUniformLocation(program,'uUseTexture'), color:gl.getUniformLocation(program,'uColor'), onFace:gl.getUniformLocation(program,'uOnFace') };
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.clearDepth(1.0); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0,0,0,0); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      return true;
    } catch(err) { console.warn('WebGL preview unavailable; using Canvas fallback:',err); gl=null; glProgram=null; return false; }
  }
  function deleteGLMeshes() {
    if(gl) for(const m of glMeshes) { if(m.pos)gl.deleteBuffer(m.pos); if(m.normal)gl.deleteBuffer(m.normal); if(m.uv)gl.deleteBuffer(m.uv); if(m.bary)gl.deleteBuffer(m.bary); }
    glMeshes=[]; glSourceModel=null;
  }
  function makeFlatNormals(positions) {
    const normals=new Float32Array(positions.length);
    for(let i=0;i+8<positions.length;i+=9){
      const ax=positions[i+3]-positions[i], ay=positions[i+4]-positions[i+1], az=positions[i+5]-positions[i+2];
      const bx=positions[i+6]-positions[i], by=positions[i+7]-positions[i+1], bz=positions[i+8]-positions[i+2];
      let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx, l=Math.hypot(nx,ny,nz)||1; nx/=l;ny/=l;nz/=l;
      for(let k=0;k<3;k++){normals[i+k*3]=nx;normals[i+k*3+1]=ny;normals[i+k*3+2]=nz;}
    }
    return normals;
  }
  function syncGLModel() {
    if(!glRendererReady || !gl) return;
    if(glSourceModel===model) return;
    deleteGLMeshes(); glSourceModel=model;
    if(!model) return;
    for(const mesh of model.meshes){
      const p=mesh.positions instanceof Float32Array?mesh.positions:new Float32Array(mesh.positions);
      const n=mesh.normals && mesh.normals.length===p.length ? mesh.normals : makeFlatNormals(p);
      const vertexCount=p.length/3, uv=new Float32Array(vertexCount*2), bary=new Float32Array(vertexCount*3);
      if(mesh.uvs && mesh.uvs.length===uv.length) uv.set(mesh.uvs);
      for(let v=0;v<vertexCount;v++) bary[v*3+(v%3)]=1;
      const makeBuffer=(target,data)=>{const b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);return b;};
      const hex=(mesh.color||'#ffffff').replace('#','');
      const channels=[hex.slice(0,2),hex.slice(2,4),hex.slice(4,6)].map(v=>parseInt(v,16)); const color=channels.map(v=>Number.isFinite(v)?v/255:1);
      glMeshes.push({pos:makeBuffer(gl.ARRAY_BUFFER,p),normal:makeBuffer(gl.ARRAY_BUFFER,n),uv:makeBuffer(gl.ARRAY_BUFFER,uv),bary:makeBuffer(gl.ARRAY_BUFFER,bary),count:Math.floor(p.length/3),color,textureImage:mesh.textureImage||null});
    }
  }
  function getGLTexture(image, flipY=false) {
    if(!image || !gl) return null;
    const key=flipY?'flip':'noFlip'; let byFlip=glTextureCache.get(image);
    if(byFlip&&byFlip[key]) return byFlip[key];
    const tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,!!flipY);
    try { gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image); }
    catch(err){ gl.deleteTexture(tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false); console.warn('Texture upload failed:',err); return null; }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    if(!byFlip){byFlip={};glTextureCache.set(image,byFlip);} byFlip[key]=tex; return tex;
  }
  function rotateVector(v, r) {
    let [x,y,z]=v, c=Math.cos(r[0]),s=Math.sin(r[0]); [y,z]=[y*c-z*s,y*s+z*c];
    c=Math.cos(r[1]);s=Math.sin(r[1]);[x,z]=[x*c+z*s,-x*s+z*c];
    c=Math.cos(r[2]);s=Math.sin(r[2]);[x,y]=[x*c-y*s,x*s+y*c]; return [x,y,z];
  }
  function glModelMatrix(t) {
    const r=t.rotation, s=t.scale, ex=rotateVector([1,0,0],r), ey=rotateVector([0,1,0],r), ez=rotateVector([0,0,1],r);
    return new Float32Array([ex[0]*s[0],ex[1]*s[0],ex[2]*s[0],0, ey[0]*s[1],ey[1]*s[1],ey[2]*s[1],0, ez[0]*s[2],ez[1]*s[2],ez[2]*s[2],0, t.position[0],t.position[1],t.position[2],1]);
  }
  function glNormalMatrix(t) {
    const r=t.rotation,s=t.scale,ex=rotateVector([1,0,0],r),ey=rotateVector([0,1,0],r),ez=rotateVector([0,0,1],r);
    const sx=(s[0]<0?-1:1)/Math.max(.000001,Math.abs(s[0])),sy=(s[1]<0?-1:1)/Math.max(.000001,Math.abs(s[1])),sz=(s[2]<0?-1:1)/Math.max(.000001,Math.abs(s[2]));
    return new Float32Array([ex[0]*sx,ex[1]*sx,ex[2]*sx,ey[0]*sy,ey[1]*sy,ey[2]*sy,ez[0]*sz,ez[1]*sz,ez[2]*sz]);
  }
  function multiply3(a,b){const o=new Float32Array(9);for(let c=0;c<3;c++)for(let r=0;r<3;r++)for(let k=0;k<3;k++)o[c*3+r]+=a[k*3+r]*b[c*3+k];return o;}
  function multiply4(a,b) { const o=new Float32Array(16); for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k]; return o; }
  function glViewProjection() {
    const basis=cameraBasis(), f=basis.forward, u=basis.up, r=basis.right, eye=basis.position;
    const view=new Float32Array([r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,-dot(r,eye),-dot(u,eye),dot(f,eye),1]);
    const b=model&&model.bounds?model.bounds:null;
    const span=b?Math.max(b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2],0.0001):1;
    // Tight, model-aware clipping range materially improves WebGL depth-buffer precision.
    const near=Math.max(0.0001,Math.min(camera.distance*0.01,span*0.005));
    const far=Math.max(camera.distance+span*8,span*20,near*2000);
    const fov=1/Math.tan(camera.fov*Math.PI/360), aspect=Math.max(.01,canvasWidth/Math.max(1,canvasHeight));
    const proj=new Float32Array([fov/aspect,0,0,0,0,fov,0,0,0,0,(far+near)/(near-far),-1,0,0,(2*far*near)/(near-far),0]);
    return multiply4(proj,view);
  }
  function drawGLScene() {
    if(!glRendererReady||!gl) return;
    syncGLModel(); gl.viewport(0,0,$('viewGL').width,$('viewGL').height); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(!model||!glMeshes.length) return;
    gl.useProgram(glProgram);
    const rootT=model.transform||{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
    const vp=glViewProjection(), rootM=glModelMatrix(rootT), rootN=glNormalMatrix(rootT);
    gl.uniform1i(glLocations.tex,0); gl.uniform1f(glLocations.onFace,faceRendering?1:0);
    for(let i=0;i<glMeshes.length;i++){
      const item=glMeshes[i], source=model.meshes[i], chain=meshTransformChain(source);let objectM=rootM,normalM=rootN,determinant=rootT.scale[0]*rootT.scale[1]*rootT.scale[2];
      for(let ci=chain.length-1;ci>=0;ci--){const t=chain[ci].transform;objectM=multiply4(objectM,glModelMatrix(t));normalM=multiply3(normalM,glNormalMatrix(t));determinant*=t.scale[0]*t.scale[1]*t.scale[2];}
      const mvp=multiply4(vp,objectM), nm=normalM;
      if(doubleFace) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(determinant<0?gl.CW:gl.CCW); }
      gl.uniformMatrix4fv(glLocations.mvp,false,mvp); gl.uniformMatrix3fv(glLocations.normalMatrix,false,nm);
      gl.bindBuffer(gl.ARRAY_BUFFER,item.pos); gl.enableVertexAttribArray(glLocations.pos); gl.vertexAttribPointer(glLocations.pos,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,item.normal); gl.enableVertexAttribArray(glLocations.normal); gl.vertexAttribPointer(glLocations.normal,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,item.uv); gl.enableVertexAttribArray(glLocations.uv); gl.vertexAttribPointer(glLocations.uv,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,item.bary); gl.enableVertexAttribArray(glLocations.bary); gl.vertexAttribPointer(glLocations.bary,3,gl.FLOAT,false,0,0);
      const img=source.materialTextureImage||source.textureImage, tex=getGLTexture(img,!!source.textureFlipY);
      gl.uniform1f(glLocations.useTex,tex?1:0); gl.uniform3fv(glLocations.color,item.color);
      if(tex){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);} else gl.bindTexture(gl.TEXTURE_2D,null);
      gl.drawArrays(gl.TRIANGLES,0,item.count);
    }
  }

  function init3D() {
    ctx = $('view').getContext('2d', { alpha: true });
    gridCtx = $('viewGrid').getContext('2d', { alpha: true });
    if (!ctx || !gridCtx) { setEngineBadge('Canvas unavailable', false); $('emptyState').querySelector('.empty-copy').textContent = 'Browser ini tidak mendukung Canvas 2D. Coba Chrome atau browser modern.'; return; }
    glRendererReady = initGLRenderer();
    setEngineBadge(glRendererReady ? 'WebGL GPU ready' : 'Canvas fallback', true);
    if (!glRendererReady) $('viewGL').style.display = 'none';
    resizeCanvas();
    if ('ResizeObserver' in window) new ResizeObserver(resizeCanvas).observe($('dropTarget'));
    else window.addEventListener('resize', resizeCanvas);
    drawScene();
  }
  function resizeCanvas() {
    const rect = $('view').getBoundingClientRect(); if (!rect.width || !rect.height || !ctx) return;
    const profileCaps = { quality:1.75, balanced:1.25, performance:0.85 };
    const profileCap = profileCaps[$('renderQuality')?.value || 'balanced'] || 1.25;
    dpr = Math.min(window.devicePixelRatio || 1, profileCap);
    canvasWidth = rect.width; canvasHeight = rect.height;
    const w = Math.max(1, Math.round(canvasWidth * dpr)), h = Math.max(1, Math.round(canvasHeight * dpr));
    for (const id of ['view','viewGrid','viewGL']) { const c = $(id); if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (gl) gl.viewport(0, 0, $('viewGL').width, $('viewGL').height);
    scheduleDraw();
  }
  function scheduleDraw() {
    if (frameRequested) return; frameRequested = true;
    requestAnimationFrame(() => { frameRequested = false; drawScene(); });
  }
  const vadd = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const vsub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const vscale = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = a => { const l=Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l,a[1]/l,a[2]/l]; };
  function transformBy(t,p) {
    const m=t||{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
    let x=p[0]*m.scale[0], y=p[1]*m.scale[1], z=p[2]*m.scale[2];
    let c=Math.cos(m.rotation[0]), s=Math.sin(m.rotation[0]); [y,z]=[y*c-z*s,y*s+z*c];
    c=Math.cos(m.rotation[1]); s=Math.sin(m.rotation[1]); [x,z]=[x*c+z*s,-x*s+z*c];
    c=Math.cos(m.rotation[2]); s=Math.sin(m.rotation[2]); [x,y]=[x*c-y*s,x*s+y*c];
    return [x+m.position[0], y+m.position[1], z+m.position[2]];
  }
  function transformPoint(p,mesh=null) {
    let point=p;if(mesh&&model){const chain=meshTransformChain(mesh);for(const node of chain)point=transformBy(node.transform,point);}return transformBy(model&&model.transform,point);
  }
  function normalByTransform(t,n) {
    const m=t||{rotation:[0,0,0],scale:[1,1,1]};
    let x=n[0]/(Math.abs(m.scale[0])<.000001?1e-6:m.scale[0]),y=n[1]/(Math.abs(m.scale[1])<.000001?1e-6:m.scale[1]),z=n[2]/(Math.abs(m.scale[2])<.000001?1e-6:m.scale[2]);
    let c=Math.cos(m.rotation[0]),s=Math.sin(m.rotation[0]);[y,z]=[y*c-z*s,y*s+z*c];
    c=Math.cos(m.rotation[1]);s=Math.sin(m.rotation[1]);[x,z]=[x*c+z*s,-x*s+z*c];
    c=Math.cos(m.rotation[2]);s=Math.sin(m.rotation[2]);[x,y]=[x*c-y*s,x*s+y*c];
    return norm([x,y,z]);
  }
  function transformNormal(n,mesh=null) {
    let normal=n;if(mesh&&model){for(const node of meshTransformChain(mesh))normal=normalByTransform(node.transform,normal);}return normalByTransform(model&&model.transform,normal);
  }
  function cameraBasis() {
    const cp=Math.cos(camera.pitch), sp=Math.sin(camera.pitch), sy=Math.sin(camera.yaw), cy=Math.cos(camera.yaw);
    const position = [camera.target[0] + camera.distance*cp*sy, camera.target[1] + camera.distance*sp, camera.target[2] + camera.distance*cp*cy];
    const forward = norm(vsub(camera.target, position));
    const right = norm(cross(forward, [0,1,0]));
    const up = norm(cross(right, forward));
    return { position, forward, right, up };
  }
  function projectWorld(p, basis) {
    const rel=vsub(p,basis.position), x=dot(rel,basis.right), y=dot(rel,basis.up), z=dot(rel,basis.forward);
    if (z <= 0.03) return null;
    const focal=(canvasHeight*0.5)/Math.tan(camera.fov*Math.PI/360);
    return { x:canvasWidth/2 + x*focal/z, y:canvasHeight/2 - y*focal/z, z };
  }
  function shadeColor(hex, shade) {
    const h=hex.replace('#',''); const r=parseInt(h.slice(0,2),16)||150, g=parseInt(h.slice(2,4),16)||160, b=parseInt(h.slice(4,6),16)||175;
    const factor=Math.max(.22,Math.min(1.22,shade));
    return `rgb(${Math.min(255,Math.round(r*factor))},${Math.min(255,Math.round(g*factor))},${Math.min(255,Math.round(b*factor))})`;
  }
  function drawGrid(basis, floorY) {
    if (!gridCtx) return;
    gridCtx.save(); gridCtx.lineWidth=1;
    const step=1, extent=Math.max(12,camera.distance*2.5), centerX=camera.target[0], centerZ=camera.target[2];
    for (let i=-12;i<=12;i++) {
      for (const axis of [0,1]) {
        const a=axis===0 ? [centerX+i*step, floorY, centerZ-12] : [centerX-12, floorY, centerZ+i*step];
        const b=axis===0 ? [centerX+i*step, floorY, centerZ+12] : [centerX+12, floorY, centerZ+i*step];
        const pa=projectWorld(a,basis), pb=projectWorld(b,basis); if (!pa || !pb) continue;
        const strong=i===0;
        gridCtx.strokeStyle=strong ? (axis===0 ? '#5f3540' : '#304d6c') : ((i%5===0)?'#303848':'#222936');
        gridCtx.globalAlpha=strong?.95:(i%5===0?.68:.48);
        gridCtx.beginPath(); gridCtx.moveTo(pa.x,pa.y); gridCtx.lineTo(pb.x,pb.y); gridCtx.stroke();
      }
    }
    gridCtx.globalAlpha=1; gridCtx.restore();
  }
  function drawTexturedTriangle(points, uv, image) {
    const w=image.naturalWidth||image.width, h=image.naturalHeight||image.height;
    const src=uv.map(p=>[p[0]*w, (1-p[1])*h]);
    const [p0,p1,p2]=points, [s0,s1,s2]=src;
    const dx1=s1[0]-s0[0], dy1=s1[1]-s0[1], dx2=s2[0]-s0[0], dy2=s2[1]-s0[1];
    const det=dx1*dy2-dx2*dy1; if (Math.abs(det)<1e-8) return false;
    const a=((p1.x-p0.x)*dy2-(p2.x-p0.x)*dy1)/det;
    const c=(dx1*(p2.x-p0.x)-dx2*(p1.x-p0.x))/det;
    const b=((p1.y-p0.y)*dy2-(p2.y-p0.y)*dy1)/det;
    const d=(dx1*(p2.y-p0.y)-dx2*(p1.y-p0.y))/det;
    const e=p0.x-a*s0[0]-c*s0[1], f=p0.y-b*s0[0]-d*s0[1];
    ctx.save(); ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.closePath(); ctx.clip();
    ctx.transform(a,b,c,d,e,f); ctx.drawImage(image,0,0); ctx.restore(); return true;
  }
  function drawScene() {
    if (!ctx || !canvasWidth || !canvasHeight) return;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,canvasWidth,canvasHeight);
    if(gridCtx){gridCtx.setTransform(dpr,0,0,dpr,0,0);gridCtx.clearRect(0,0,canvasWidth,canvasHeight);}
    const basis=cameraBasis();
    const floorY = model && model.bounds ? model.bounds.min[1] : 0;
    drawGrid(basis,floorY);
    if(glRendererReady) drawGLScene();
    if (!model || !model.meshes.length) {
      ctx.fillStyle='#78849a'; ctx.font='12px system-ui'; ctx.textAlign='center'; ctx.fillText('3D viewport ready · import a model to begin',canvasWidth/2,canvasHeight-28); return;
    }
    if (glRendererReady) {
      drawGizmo(basis);
      ctx.fillStyle='#9ca8ba'; ctx.font='10px system-ui'; ctx.textAlign='right';
      const total=model.meshes.reduce((n,m)=>n+Math.floor(m.positions.length/9),0);
      ctx.fillText(`WebGL GPU · ${fmt(total)} tris`,canvasWidth-12,canvasHeight-12);
      return;
    }
    const allTriangles=[]; let fullTriCount=0;
    for (let mi=0;mi<model.meshes.length;mi++) fullTriCount+=Math.floor(model.meshes[mi].positions.length/9);
    for (let mi=0;mi<model.meshes.length;mi++) {
      const mesh=model.meshes[mi], p=mesh.positions, uv=mesh.uvs, ns=mesh.normals;
      for (let i=0;i+8<p.length;i+=9) {
        const tri=[0,1,2].map(k=>transformPoint([p[i+k*3],p[i+k*3+1],p[i+k*3+2]],mesh));
        const projected=tri.map(v=>projectWorld(v,basis)); if (projected.some(v=>!v)) continue;
        let normal;
        if(ns&&ns.length>=i+9){const vnorm=[0,0,0];for(let k=0;k<3;k++){const n0=transformNormal([ns[i+k*3],ns[i+k*3+1],ns[i+k*3+2]],mesh);vnorm[0]+=n0[0];vnorm[1]+=n0[1];vnorm[2]+=n0[2];}normal=norm(vnorm);}
        else normal=norm(cross(vsub(tri[1],tri[0]),vsub(tri[2],tri[0])));
        const light=norm([-.35,.82,.45]); const shade=.58+Math.max(0,dot(normal,light))*.42;
        if(!doubleFace && dot(normal,vsub(basis.position,tri[0]))<=0) continue;
        const uvs=uv && uv.length >= (i/3+3)*2 ? [0,1,2].map(k=>[uv[(i/3+k)*2],uv[(i/3+k)*2+1]]) : null;
        allTriangles.push({ points:projected, uv:uvs, z:(projected[0].z+projected[1].z+projected[2].z)/3, color:mesh.color||'#ffffff', shade, texture:mesh.materialTextureImage||mesh.textureImage||null, selected:mi===selectedMeshIndex });
      }
    }
    allTriangles.sort((a,b)=>b.z-a.z);
    for (const tri of allTriangles) {
      const [a,b,c]=tri.points;
      if (Math.max(a.x,b.x,c.x)<-80||Math.min(a.x,b.x,c.x)>canvasWidth+80||Math.max(a.y,b.y,c.y)<-80||Math.min(a.y,b.y,c.y)>canvasHeight+80) continue;
      if (!faceRendering) { ctx.strokeStyle='rgba(18,24,31,.92)'; ctx.lineWidth=1; ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.closePath();ctx.stroke(); continue; }
      const activeTexture=tri.texture;
      if (activeTexture && tri.uv) {
        const ok=drawTexturedTriangle(tri.points,tri.uv,activeTexture);
        if (ok && tri.shade<.96) { ctx.fillStyle=`rgba(0,0,0,${Math.min(.46,(1-tri.shade)*.7)})`; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(c.x,c.y); ctx.closePath(); ctx.fill(); }
        if (!ok) { ctx.fillStyle=shadeColor(tri.color,tri.shade); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.closePath();ctx.fill(); }
      } else { ctx.fillStyle=shadeColor(tri.color,tri.shade); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.closePath();ctx.fill(); }
    }
    if (fullTriCount > 100000) {ctx.fillStyle='#9ca8ba';ctx.font='10px system-ui';ctx.textAlign='right';ctx.fillText(`Full preview · ${fmt(fullTriCount)} tris (high load)`,canvasWidth-12,canvasHeight-12);}
    drawGizmo(basis);
  }
  const AXES=[{name:'X',axis:0,color:'#ff5364',vec:[1,0,0]},{name:'Y',axis:1,color:'#54e59b',vec:[0,1,0]},{name:'Z',axis:2,color:'#63a4ff',vec:[0,0,1]}];
  function gizmoAnchor(){const m=activeMesh();return model?(m?transformPoint(m.localCenter||[0,0,0],m):transformPoint(model.localCenter||[0,0,0])):[0,0,0];}
  function gizmoSizeWorld(){const focal=(canvasHeight*.5)/Math.tan(camera.fov*Math.PI/360);return Math.max(.1,camera.distance*66/Math.max(focal,1));}
  function projectGizmoPoint(p,basis){const q=projectWorld(p,basis);return q?{x:q.x,y:q.y,z:q.z}:null;}
  function getGizmoHandles(basis){
    if(!model)return [];
    const center3=gizmoAnchor(),center=projectGizmoPoint(center3,basis);if(!center)return [];
    const size=gizmoSizeWorld(),handles=[];
    for(const a of AXES){
      if(gizmoMode==='rotate'){
        const points=[];const r=size*.78;
        for(let j=0;j<=48;j++){
          const t=j/48*Math.PI*2;let offset;
          if(a.axis===0)offset=[0,Math.cos(t)*r,Math.sin(t)*r];
          else if(a.axis===1)offset=[Math.cos(t)*r,0,Math.sin(t)*r];
          else offset=[Math.cos(t)*r,Math.sin(t)*r,0];
          points.push(projectGizmoPoint(vadd(center3,offset),basis));
        }
        handles.push({axis:a.axis,name:a.name,color:a.color,center,points,mode:'rotate'});
      } else {
        const tip3=vadd(center3,vscale(a.vec,size)),tip=projectGizmoPoint(tip3,basis);
        if(tip)handles.push({axis:a.axis,name:a.name,color:a.color,center,tip,mode:gizmoMode});
      }
    }
    return handles;
  }
  function drawGizmo(basis){
    if(!model)return;
    const handles=getGizmoHandles(basis);if(!handles.length)return;
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const h of handles){
      ctx.strokeStyle=h.color;ctx.fillStyle=h.color;ctx.lineWidth= gizmoMode==='rotate'?2.5:3;
      if(h.mode==='rotate'){
        ctx.beginPath();let started=false;for(const p of h.points){if(!p){started=false;continue;}if(!started){ctx.moveTo(p.x,p.y);started=true;}else ctx.lineTo(p.x,p.y);}ctx.stroke();
      } else {
        ctx.beginPath();ctx.moveTo(h.center.x,h.center.y);ctx.lineTo(h.tip.x,h.tip.y);ctx.stroke();
        if(gizmoMode==='scale'){ctx.fillRect(h.tip.x-5,h.tip.y-5,10,10);}
        else{ctx.beginPath();ctx.arc(h.tip.x,h.tip.y,5,0,Math.PI*2);ctx.fill();}
      }
      const labelPoint=h.mode==='rotate'?h.points[Math.floor(h.points.length*.12)]:h.tip;
      if(labelPoint){ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=3.5;ctx.strokeStyle='#10151e';ctx.strokeText(h.name,labelPoint.x,labelPoint.y-12);ctx.fillStyle=h.color;ctx.fillText(h.name,labelPoint.x,labelPoint.y-12);}
    }
    ctx.fillStyle='#f5f7fb';ctx.strokeStyle='#11151c';ctx.lineWidth=2;ctx.beginPath();ctx.arc(handles[0].center.x,handles[0].center.y,5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
  }
  function pointSegmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;if(!l2)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));}
  function hitGizmo(clientX,clientY){
    if(!model)return null;const r=$('view').getBoundingClientRect(),p={x:clientX-r.left,y:clientY-r.top},handles=getGizmoHandles(cameraBasis());let best=null,bestD=12;
    for(const h of handles){let d=Infinity;if(h.mode==='rotate'){for(let i=1;i<h.points.length;i++)if(h.points[i-1]&&h.points[i])d=Math.min(d,pointSegmentDistance(p,h.points[i-1],h.points[i]));}else{const inner={x:h.center.x+(h.tip.x-h.center.x)*.24,y:h.center.y+(h.tip.y-h.center.y)*.24};d=pointSegmentDistance(p,inner,h.tip);}if(d<bestD){bestD=d;best=h;}}
    return best;
  }
  function setGizmoMode(mode){gizmoMode=mode;[['move','gizmoMove'],['rotate','gizmoRotate'],['scale','gizmoScale']].forEach(([m,id])=>$(id).classList.toggle('active',m===mode));$('viewportHint').textContent=`Gizmo ${mode[0].toUpperCase()+mode.slice(1)} · tarik sumbu X/Y/Z`;scheduleDraw();}
  function syncTransformInputs(){if(!model)return;const t=activeTransform()||model.transform;['px','py','pz'].forEach((id,i)=>$(id).value=Number(t.position[i].toFixed(4)));['rx','ry','rz'].forEach((id,i)=>$(id).value=Number((t.rotation[i]*180/Math.PI).toFixed(2)));['sx','sy','sz'].forEach((id,i)=>$(id).value=Number(t.scale[i].toFixed(4)));}
  function startGizmoDrag(e){
    const h=hitGizmo(e.clientX,e.clientY);if(!h)return false;
    const t=activeTransform()||model.transform,r=$('view').getBoundingClientRect(),center=h.center;
    drag.gizmo={mode:gizmoMode,axis:h.axis,startX:e.clientX,startY:e.clientY,startValue:gizmoMode==='move'?t.position[h.axis]:gizmoMode==='rotate'?t.rotation[h.axis]:t.scale[h.axis],centerClient:{x:r.left+center.x,y:r.top+center.y},startAngle:Math.atan2(e.clientY-(r.top+center.y),e.clientX-(r.left+center.x)),screenAxis:h.tip?{x:(h.tip.x-h.center.x),y:(h.tip.y-h.center.y)}:null};
    if(drag.gizmo.screenAxis){const n=Math.hypot(drag.gizmo.screenAxis.x,drag.gizmo.screenAxis.y)||1;drag.gizmo.screenAxis.x/=n;drag.gizmo.screenAxis.y/=n;}
    drag.mode='gizmo';return true;
  }
  function updateGizmoDrag(e){
    if(!drag.gizmo||!model)return;const g=drag.gizmo,dx=e.clientX-g.startX,dy=e.clientY-g.startY,axis=g.axis,t=activeTransform()||model.transform;
    if(g.mode==='move'){
      const direction=g.screenAxis||{x:0,y:0},pixels=dx*direction.x+dy*direction.y;
      const unitsPerPixel=(2*camera.distance*Math.tan(camera.fov*Math.PI/360))/Math.max(canvasHeight,1);
      t.position[axis]=g.startValue+pixels*unitsPerPixel;
    } else if(g.mode==='scale'){
      const direction=g.screenAxis||{x:0,y:0},pixels=dx*direction.x+dy*direction.y;
      t.scale[axis]=Math.max(.001,g.startValue*Math.exp(pixels*.012));
    } else {
      const angle=Math.atan2(e.clientY-g.centerClient.y,e.clientX-g.centerClient.x);let delta=angle-g.startAngle;
      while(delta>Math.PI)delta-=Math.PI*2;while(delta< -Math.PI)delta+=Math.PI*2;
      t.rotation[axis]=g.startValue+delta;
    }
    syncTransformInputs();scheduleDraw();
  }

  function frameModel() {
    if (!model) { toast('Impor model terlebih dahulu.'); return; }
    const pts=[];
    model.meshes.forEach(mesh=>{ for(let i=0;i<mesh.positions.length;i+=3) pts.push(transformPoint([mesh.positions[i],mesh.positions[i+1],mesh.positions[i+2]],mesh)); });
    if (!pts.length) return;
    const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
    pts.forEach(p=>{for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}});
    model.bounds={min,max}; camera.target=[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2];
    camera.distance=Math.max(Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2])*1.85,.8); scheduleDraw();
  }
  function geometryStats(meshes) {
    let meshCount=0,vertices=0,triangles=0;
    meshes.forEach(m=>{meshCount++; vertices+=m.positions.length/3;triangles+=m.positions.length/9;});
    return {meshes:meshCount,vertices,triangles};
  }
  function refreshStats() {
    if (!model) { $('statMeshes').textContent='—';$('statVertices').textContent='—';$('statTriangles').textContent='—';return; }
    const s=geometryStats(model.meshes); $('statMeshes').textContent=fmt(s.meshes);$('statVertices').textContent=fmt(s.vertices);$('statTriangles').textContent=fmt(s.triangles);
  }

  // ---------- Model readers: OBJ, STL, GLB and glTF 2.0 static meshes ----------
  function makeMesh(positions, uvs=null, color='#ffffff', name='Mesh', normals=null, extras={}) {
    return Object.assign({ positions: new Float32Array(positions), uvs: uvs ? new Float32Array(uvs) : null,
      normals: normals && normals.length === positions.length ? new Float32Array(normals) : null,
      color: color || '#ffffff', name }, extras);
  }
  function parseOBJ(text) {
    const verts=[], tex=[], normals=[], groups=[];
    let gp=[], gu=[], gn=[], allFacesHaveUV=true, currentName='Model';
    const finish=()=>{
      if(gp.length){groups.push(makeMesh(gp,allFacesHaveUV&&gu.length===gp.length/3*2?gu:null,'#ffffff',currentName,gn));}
      gp=[];gu=[];gn=[];allFacesHaveUV=true;
    };
    const resolve=(s,len)=>{const n=Number(s);return n<0?len+n:n-1;};
    const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
    for(const raw of lines){
      const line=raw.trim();if(!line||line.startsWith('#'))continue;
      const parts=line.split(/\s+/),tag=parts[0];
      if(tag==='v'&&parts.length>=4) verts.push([+parts[1],+parts[2],+parts[3]]);
      else if(tag==='vt'&&parts.length>=3) tex.push([+parts[1],+parts[2]]);
      else if(tag==='vn'&&parts.length>=4) normals.push([+parts[1],+parts[2],+parts[3]]);
      else if(tag==='o'||tag==='g') {finish();currentName=parts.slice(1).join(' ')||'Mesh';}
      else if(tag==='f'&&parts.length>=4){
        const corners=parts.slice(1).map(token=>{const q=token.split('/'),vi=resolve(q[0],verts.length),ti=q[1]?resolve(q[1],tex.length):-1,ni=q[2]?resolve(q[2],normals.length):-1;return {v:verts[vi],t:ti>=0?tex[ti]:null,n:ni>=0?normals[ni]:null};});
        for(let k=1;k<corners.length-1;k++){
          const tri=[corners[0],corners[k],corners[k+1]];
          if(tri.some(v=>!v.v||v.v.some(n=>!Number.isFinite(n))))continue;
          const faceNormal=norm(cross(vsub(tri[1].v,tri[0].v),vsub(tri[2].v,tri[0].v)));
          for(const v of tri){gp.push(...v.v);const n=v.n&&v.n.every(Number.isFinite)?norm(v.n):faceNormal;gn.push(...n);if(v.t)gu.push(v.t[0],1-v.t[1]);else{allFacesHaveUV=false;gu.push(0,0);}}
        }
      }
    }
    finish();
    const good=groups.filter(g=>g.positions.length>=9);
    if(!good.length)throw new Error('OBJ tidak memiliki face/triangle yang valid.');
    return good;
  }
  function parseSTL(buffer) {
    const view=new DataView(buffer), byteLen=buffer.byteLength; let positions=[];
    const count=byteLen>=84?view.getUint32(80,true):0;
    const looksBinary=count>0&&84+count*50<=byteLen;
    if(looksBinary){
      for(let i=0;i<count;i++){
        const base=84+i*50; const n=[view.getFloat32(base,true),view.getFloat32(base+4,true),view.getFloat32(base+8,true)];
        const tri=[];for(let j=0;j<3;j++){const off=base+12+j*12;tri.push([view.getFloat32(off,true),view.getFloat32(off+4,true),view.getFloat32(off+8,true)]);}
        // Keep the source triangle orientation; normals are calculated during display/export.
        tri.forEach(p=>positions.push(...p));
      }
    } else {
      const text=new TextDecoder().decode(buffer);const re=/\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;let m;
      while((m=re.exec(text)))positions.push(+m[1],+m[2],+m[3]);
    }
    if(positions.length<9)throw new Error('STL tidak berisi triangle yang valid.');
    positions=positions.slice(0,Math.floor(positions.length/9)*9);
    return [makeMesh(positions,null,'#ffffff','STL Mesh')];
  }
  const glComp = {5120:{bytes:1,type:'getInt8'},5121:{bytes:1,type:'getUint8'},5122:{bytes:2,type:'getInt16'},5123:{bytes:2,type:'getUint16'},5125:{bytes:4,type:'getUint32'},5126:{bytes:4,type:'getFloat32'}};
  const glTypeCount = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  function identity4(){return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];}
  function mult4(a,b){const o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
  function trs4(t=[0,0,0],q=[0,0,0,1],s=[1,1,1]){
    const [x,y,z,w]=q;const x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
    return [(1-(yy+zz))*s[0],(xy+wz)*s[0],(xz-wy)*s[0],0,(xy-wz)*s[1],(1-(xx+zz))*s[1],(yz+wx)*s[1],0,(xz+wy)*s[2],(yz-wx)*s[2],(1-(xx+yy))*s[2],0,t[0],t[1],t[2],1];
  }
  function apply4(m,p){const x=p[0],y=p[1],z=p[2];const w=m[3]*x+m[7]*y+m[11]*z+m[15]||1;return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w];}
  function decodeDataUri(uri){const comma=uri.indexOf(',');if(comma<0)throw new Error('Data URI tidak valid.');const meta=uri.slice(0,comma),body=uri.slice(comma+1);if(meta.includes(';base64')){const binary=atob(body);const out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out.buffer;}return new TextEncoder().encode(decodeURIComponent(body)).buffer;}
  async function parseGLTF(file, files) {
    const ext=extOf(file.name);let json,binChunk=null;
    if(ext==='glb'){
      const buffer=await file.arrayBuffer(),view=new DataView(buffer);
      if(buffer.byteLength<20||view.getUint32(0,true)!==0x46546c67)throw new Error('Header GLB tidak valid.');
      const version=view.getUint32(4,true);if(version!==2)throw new Error(`Versi GLB ${version} belum didukung; gunakan glTF 2.0.`);
      let offset=12;
      while(offset+8<=buffer.byteLength){
        const len=view.getUint32(offset,true),type=view.getUint32(offset+4,true);offset+=8;
        if(offset+len>buffer.byteLength)throw new Error('Chunk GLB terpotong.');
        const chunk=buffer.slice(offset,offset+len);
        if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(chunk).replace(/[\u0000\s]+$/g,''));
        else if(type===0x004e4942)binChunk=chunk;
        offset+=len;
      }
      if(!json)throw new Error('Chunk JSON tidak ditemukan di GLB.');
    } else {
      try{json=JSON.parse(await file.text());}catch(err){throw new Error('File glTF bukan JSON valid: '+err.message);}
    }
    const chosen=new Map();
    files.forEach(f=>{
      chosen.set(f.name.toLowerCase(),f);
      if(f.webkitRelativePath)chosen.set(f.webkitRelativePath.toLowerCase(),f);
    });
    const normalizeUri=uri=>{let u=String(uri||'').split(/[?#]/)[0];try{u=decodeURIComponent(u);}catch(_){}return u.replace(/\\/g,'/').replace(/^\.\//,'').toLowerCase();};
    const findFile=uri=>{
      const u=normalizeUri(uri),base=u.split('/').pop();
      return chosen.get(u)||chosen.get(base)||Array.from(files).find(f=>normalizeUri(f.webkitRelativePath||f.name).endsWith('/'+u)||f.name.toLowerCase()===base)||null;
    };
    const buffers=[];
    for(let i=0;i<(json.buffers||[]).length;i++){
      const def=json.buffers[i];let array;
      if(def.uri){
        if(/^data:/i.test(def.uri))array=decodeDataUri(def.uri);
        else {const f=findFile(def.uri);if(!f)throw new Error(`File buffer "${def.uri}" tidak dipilih. Untuk .gltf, pilih file .bin pendamping bersama .gltf.`);array=await f.arrayBuffer();}
      } else if(i===0&&binChunk)array=binChunk;
      else throw new Error(`Buffer glTF nomor ${i} tidak tersedia.`);
      if(def.byteLength&&array.byteLength<def.byteLength)throw new Error(`Buffer ${i} terlalu pendek (${array.byteLength} byte, perlu ${def.byteLength}).`);
      buffers.push(array);
    }
    function readAccessor(index){
      const a=(json.accessors||[])[index];if(!a)throw new Error(`Accessor ${index} tidak ditemukan.`);
      if(a.sparse)throw new Error('Accessor sparse belum didukung. Ekspor ulang model tanpa sparse accessor.');
      const info=glComp[a.componentType],num=glTypeCount[a.type];if(!info||!num)throw new Error('Tipe accessor glTF tidak dikenali.');
      const bv=(json.bufferViews||[])[a.bufferView];if(!bv)throw new Error('BufferView accessor tidak ditemukan.');
      const raw=buffers[bv.buffer||0];if(!raw)throw new Error('Buffer glTF hilang.');
      const base=(bv.byteOffset||0)+(a.byteOffset||0),stride=bv.byteStride||info.bytes*num,view=new DataView(raw),arr=new Array(a.count*num);
      for(let i=0;i<a.count;i++)for(let j=0;j<num;j++){
        const off=base+i*stride+j*info.bytes;if(off+info.bytes>raw.byteLength)throw new Error('Data accessor melebihi batas buffer.');
        let v=view[info.type](off,true);
        if(a.normalized){if(a.componentType===5120)v=Math.max(v/127,-1);else if(a.componentType===5121)v/=255;else if(a.componentType===5122)v=Math.max(v/32767,-1);else if(a.componentType===5123)v/=65535;}
        arr[i*num+j]=v;
      }
      return {data:arr,count:a.count,num};
    }
    const imageAssets=[];
    for(let i=0;i<(json.images||[]).length;i++){
      const def=json.images[i];let blob=null,bytes=null,filename=def.name||`embedded_${i+1}.png`,mime=def.mimeType||'';
      try{
        if(def.uri&&/^data:/i.test(def.uri)){
          const header=def.uri.slice(0,def.uri.indexOf(','));mime=(header.match(/^data:([^;,]+)/i)||[])[1]||mime||'application/octet-stream';
          bytes=decodeDataUri(def.uri);blob=new Blob([bytes],{type:mime});
          const extension=({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/avif':'avif' })[mime]||'bin';filename=`embedded_${i+1}.${extension}`;
        } else if(def.uri){
          const f=findFile(def.uri);
          if(!f)throw new Error(`Gambar "${def.uri}" tidak dipilih; pilih file tekstur pendamping .gltf.`);
          blob=f;bytes=await f.arrayBuffer();filename=f.name;mime=f.type||mime||'application/octet-stream';
        } else if(def.bufferView!=null){
          const bv=(json.bufferViews||[])[def.bufferView],raw=bv&&buffers[bv.buffer||0];
          if(!bv||!raw)throw new Error(`bufferView gambar ${i} tidak tersedia.`);
          bytes=raw.slice(bv.byteOffset||0,(bv.byteOffset||0)+bv.byteLength);mime=mime||'image/png';blob=new Blob([bytes],{type:mime});
          const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'})[mime]||'png';filename=`embedded_${i+1}.${extension}`;
        } else throw new Error(`Sumber gambar ${i} tidak didukung.`);
        const objectUrl=URL.createObjectURL(blob);generatedTextureUrls.add(objectUrl);
        const img=new Image();
        await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Browser tidak bisa mendekode tekstur '+filename));img.src=objectUrl;});
        imageAssets.push({image:img,bytes:bytes||await blob.arrayBuffer(),filename,type:mime||blob.type||'application/octet-stream',objectUrl});
      }catch(err){imageAssets.push(null);console.warn('Texture glTF dilewati:',err);}
    }
    const materials=json.materials||[], textureDefs=json.textures||[], meshes=json.meshes||[], nodes=json.nodes||[], output=[];
    function addMeshPrimitive(primitive,world,nodeLabel){
      if(primitive.mode!=null&&![4,5,6].includes(primitive.mode))return;
      const attrs=primitive.attributes||{};if(attrs.POSITION==null)return;
      const pos=readAccessor(attrs.POSITION),uv=attrs.TEXCOORD_0!=null?readAccessor(attrs.TEXCOORD_0):null,normals=attrs.NORMAL!=null?readAccessor(attrs.NORMAL):null;
      const idx=primitive.indices!=null?readAccessor(primitive.indices).data:Array.from({length:pos.count},(_,i)=>i);
      const mode=primitive.mode==null?4:primitive.mode;
      const mat=primitive.material!=null?materials[primitive.material]:null;
      const texIndex=mat&&mat.pbrMetallicRoughness&&mat.pbrMetallicRoughness.baseColorTexture?mat.pbrMetallicRoughness.baseColorTexture.index:null;
      const texDef=texIndex!=null?textureDefs[texIndex]:null;
      const texAsset=texDef&&texDef.source!=null?imageAssets[texDef.source]:null;
      const p=[],t=[],n=[];
      // Expand each triangle directly instead of creating a second array containing every triangle.
      // This cuts the import-time memory spike for 100k+ triangle GLB/glTF files.
      const appendTriangle=(i0,i1,i2)=>{
        if(!Number.isInteger(i0)||!Number.isInteger(i1)||!Number.isInteger(i2)||i0<0||i1<0||i2<0||i0>=pos.count||i1>=pos.count||i2>=pos.count)return;
        const ids=[i0,i1,i2];
        for(let k=0;k<3;k++){
          const vi=ids[k],x=pos.data[vi*3],y=pos.data[vi*3+1],z=pos.data[vi*3+2];
          if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return;
        }
        for(let k=0;k<3;k++){
          const vi=ids[k],point=apply4(world,[pos.data[vi*3],pos.data[vi*3+1],pos.data[vi*3+2]]);
          p.push(point[0],point[1],point[2]);
          if(uv)t.push(uv.data[vi*2],1-uv.data[vi*2+1]);
          if(normals){const nn=applyNormal4(world,[normals.data[vi*3],normals.data[vi*3+1],normals.data[vi*3+2]]);n.push(nn[0],nn[1],nn[2]);}
        }
      };
      if(mode===4){for(let i=0;i+2<idx.length;i+=3)appendTriangle(idx[i],idx[i+1],idx[i+2]);}
      else if(mode===5){for(let i=0;i+2<idx.length;i++)i%2?appendTriangle(idx[i+1],idx[i],idx[i+2]):appendTriangle(idx[i],idx[i+1],idx[i+2]);}
      else if(mode===6){for(let i=1;i+1<idx.length;i++)appendTriangle(idx[0],idx[i],idx[i+1]);}
      if(p.length>=9){
        const mesh=makeMesh(p,uv?t:null,'#ffffff',nodeLabel||'glTF mesh',normals?n:null,
          texAsset?{textureImage:texAsset.image,textureBytes:texAsset.bytes,textureFileName:texAsset.filename,textureType:texAsset.type,textureObjectUrl:texAsset.objectUrl,materialName:mat&&mat.name||'Material'}:{materialName:mat&&mat.name||'Default material'});
        mesh.textureFlipY=true; // glTF UVs use top-left image origin; upload flipped for WebGL sampling.
        output.push(mesh);
      }
    }
    function walkNode(index,parent){
      const node=nodes[index];if(!node)return;
      const local=node.matrix?node.matrix.slice():trs4(node.translation,node.rotation,node.scale),world=mult4(parent,local);
      if(node.mesh!=null){const def=meshes[node.mesh];if(def)(def.primitives||[]).forEach(pr=>addMeshPrimitive(pr,world,node.name||def.name||'glTF mesh'));}
      (node.children||[]).forEach(child=>walkNode(child,world));
    }
    const sceneDef=(json.scenes||[])[json.scene||0];
    if(sceneDef&&Array.isArray(sceneDef.nodes))sceneDef.nodes.forEach(i=>walkNode(i,identity4()));
    else if(nodes.length)nodes.forEach((n,i)=>{const referenced=nodes.some(q=>(q.children||[]).includes(i));if(!referenced)walkNode(i,identity4());});
    else meshes.forEach(def=>(def.primitives||[]).forEach(pr=>addMeshPrimitive(pr,identity4(),def.name||'glTF mesh')));
    if(!output.length)throw new Error('Tidak ada triangle mesh yang bisa dibaca. Model mungkin menggunakan accessor sparse, compressed mesh, atau ekstensi glTF yang belum didukung.');
    const unsupportedImages=(json.images||[]).length-imageAssets.filter(Boolean).length;
    return {meshes:output,animations:(json.animations||[]).length,skins:(json.skins||[]).length,asset:json.asset||{},embeddedTextures:imageAssets.filter(Boolean),textureWarnings:unsupportedImages};
  }
  function applyNormal4(m,v){const a00=m[0],a01=m[4],a02=m[8],a10=m[1],a11=m[5],a12=m[9],a20=m[2],a21=m[6],a22=m[10];const c00=a11*a22-a12*a21,c01=a12*a20-a10*a22,c02=a10*a21-a11*a20,c10=a02*a21-a01*a22,c11=a00*a22-a02*a20,c12=a01*a20-a00*a21,c20=a01*a12-a02*a11,c21=a02*a10-a00*a12,c22=a00*a11-a01*a10;const det=a00*c00+a01*c01+a02*c02;if(!Number.isFinite(det)||Math.abs(det)<1e-12)return norm([m[0]*v[0]+m[4]*v[1]+m[8]*v[2],m[1]*v[0]+m[5]*v[1]+m[9]*v[2],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]]);return norm([(c00*v[0]+c01*v[1]+c02*v[2])/det,(c10*v[0]+c11*v[1]+c12*v[2])/det,(c20*v[0]+c21*v[1]+c22*v[2])/det]);}
  async function importModels(fileList) {
    if(importBusy)return;const files=Array.from(fileList||[]);if(!files.length)return;
    const allowed=files.filter(f=>['obj','glb','gltf','stl','bin','png','jpg','jpeg','webp','bmp','avif'].includes(extOf(f.name)));
    const candidates=allowed.filter(f=>['obj','glb','gltf','stl'].includes(extOf(f.name)));
    if(!candidates.length){toast('Pilih model OBJ, GLB, glTF, atau STL.');return;}
    const primary=candidates[0],total=allowed.reduce((n,f)=>n+f.size,0);
    if(total>250*1024*1024){toast('Total file melebihi 250 MB. Gunakan model lebih ringan untuk browser HP.');return;}
    importBusy=true;$('browseModel').disabled=true;$('emptyImport').disabled=true;setEngineBadge('Importing…',false);
    try{
      for(const url of generatedTextureUrls)URL.revokeObjectURL(url);generatedTextureUrls.clear();
      let meshes=[],animations=0,skins=0,embeddedTextures=[],textureWarnings=0;const ext=extOf(primary.name);
      if(ext==='obj')meshes=parseOBJ(await primary.text());
      else if(ext==='stl')meshes=parseSTL(await primary.arrayBuffer());
      else {const result=await parseGLTF(primary,allowed);meshes=result.meshes;animations=result.animations;skins=result.skins;embeddedTextures=result.embeddedTextures||[];textureWarnings=result.textureWarnings||0;}
      const stats=geometryStats(meshes);if(!stats.triangles)throw new Error('Model tidak memiliki triangle yang bisa dirender.');
      // A newly imported model should use its own embedded materials, not a stale texture override from the previous project.
      if(textureObjectUrl)URL.revokeObjectURL(textureObjectUrl);textureObjectUrl=null;textureFile=null;textureBytes=null;textureImage=null;
      ensureMeshMetadata(meshes);selectedMeshIndex=0;
      model={meshes,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},bounds:null,localCenter:[0,0,0],animations,skins,embeddedTextures,textureWarnings};
      const bmin=[Infinity,Infinity,Infinity],bmax=[-Infinity,-Infinity,-Infinity];
      for(const mesh of meshes)for(let i=0;i<mesh.positions.length;i+=3)for(let k=0;k<3;k++){const v=mesh.positions[i+k];bmin[k]=Math.min(bmin[k],v);bmax[k]=Math.max(bmax[k],v);}
      model.localCenter=bmin.map((v,k)=>(v+bmax[k])/2);
      primaryModelFile=primary;sourceFiles=allowed;
      $('emptyState').classList.add('hidden');camera.yaw=.72;camera.pitch=.32;
      ['px','py','pz','rx','ry','rz'].forEach(id=>$(id).value=0);['sx','sy','sz'].forEach(id=>$(id).value=1);
      refreshStats();renderOutliner();syncSelectedMeshUi();frameModel();displayAsset(primary,primary.size);syncJsonFromForm();projectUpdate();updateValidationBadge('Not checked','');setEngineBadge(glRendererReady?'WebGL GPU ready':'Canvas fallback',glRendererReady);scheduleDraw();updateTextureUi();
      const embeddedMeshCount=meshes.filter(m=>m.textureImage).length;
      const msg=`Model berhasil dimuat: ${primary.name}\n${fmt(stats.meshes)} mesh · ${fmt(stats.vertices)} vertices · ${fmt(stats.triangles)} triangles.`+
        (embeddedMeshCount?`\n${embeddedMeshCount} mesh menggunakan tekstur GLB/glTF yang berhasil dibaca.`:'\nMaterial tanpa tekstur menggunakan putih default.')+
        (textureWarnings?`\nPeringatan: ${textureWarnings} sumber gambar tidak dapat dibaca.`:'')+
        (animations?`\nPeringatan: ${animations} animasi tidak dipertahankan dalam preview/ekspor OBJ.`:'')+
        (skins?'\nModel berisi skin/rig; ekspor OBJ tetap statis.':'');
      statusReport(msg,textureWarnings||animations||skins?'warn':'ok');
      toast(`Import berhasil · ${fmt(stats.triangles)} triangles${embeddedMeshCount?` · ${embeddedMeshCount} mesh bertekstur`:''}`);
    }catch(err){const msg=err&&err.message?err.message:String(err);statusReport('Impor gagal:\n'+msg+'\n\nUntuk glTF JSON, pilih juga file .bin dan gambar pendamping. GLB biasanya menyimpan buffer dan tekstur di dalam file.','error');setEngineBadge('Import failed',false);toast('Impor gagal. Periksa detail di halaman Export.');console.error('Import error',err);}
    finally{importBusy=false;$('browseModel').disabled=false;$('emptyImport').disabled=false;$('modelFile').value='';}
  }
  function displayAsset(file, size) {
    const ext=extOf(file.name);$('assetType').textContent=ext.toUpperCase()+' → OBJ';$('modelPill').textContent=file.name;
    const s=geometryStats(model.meshes);
    $('assetList').innerHTML=`<div class="file-row"><div class="file-icon">⬡</div><div class="file-info"><div class="file-name">${escapeHtml(file.name)}</div><div class="file-detail">${ext.toUpperCase()} · ${humanBytes(size)} · ${fmt(s.triangles)} triangles</div></div><span class="pill green">Loaded</span></div>${model.animations||model.skins?`<div class="status warn" style="margin-top:9px">${model.animations?`${model.animations} animation(s) detected. `:''}${model.skins?'Skin/rig detected. ':''}Export is static OBJ; animation and rigging will not be preserved.</div>`:''}`;
    $('viewportHint').textContent='Model loaded · transform preview active';
  }

  // ---------- Texture preview ----------
  async function importTexture(file) {
    if(!file)return;const ext=extOf(file.name);
    if(!['png','jpg','jpeg','webp'].includes(ext)){toast('Pilih PNG, JPG, atau WebP untuk texture.');return;}
    if(file.size>40*1024*1024){toast('Texture lebih dari 40 MB. Gunakan gambar yang lebih kecil.');return;}
    const url=URL.createObjectURL(file),img=new Image();
    try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Browser tidak dapat membuka file gambar.'));img.src=url;});}
    catch(err){URL.revokeObjectURL(url);statusReport('Texture gagal dibaca: '+err.message,'error');return;}
    const bytes=await file.arrayBuffer(),mesh=activeMesh();
    if(mesh){mesh.materialTextureFile=file;mesh.materialTextureImage=img;mesh.materialTextureBytes=bytes;mesh.materialTextureFileName=file.name;mesh.materialTextureType=file.type||'image/'+ext;mesh.materialTextureObjectUrl=url;generatedTextureUrls.add(url);syncTextureGlobalsFromSelection();}
    else {if(textureObjectUrl)URL.revokeObjectURL(textureObjectUrl);textureObjectUrl=url;textureFile=file;textureImage=img;textureBytes=bytes;generatedTextureUrls.add(url);}
    updateTextureUi();scheduleDraw();const uvMesh=mesh?!!mesh.uvs:model&&model.meshes.some(m=>m.uvs);
    statusReport(`Texture berhasil dimuat: ${file.name}\n${img.naturalWidth} × ${img.naturalHeight}px.\nTujuan: ${mesh?mesh.name:'global preview'}. ${uvMesh?'UV tersedia; texture ditampilkan pada mesh terpilih.':'Model tidak menyediakan UV yang dikenali sehingga texture tidak dapat dipetakan dengan benar.'}`,uvMesh?'ok':'warn');toast(mesh?`Texture ditetapkan ke ${mesh.name}`:'Texture berhasil dimuat.');
  }
  function embeddedTextureAssets(){
    if(!model)return[];const byImage=new Map();
    for(const mesh of model.meshes){const tex=meshTexture(mesh);if(tex&&tex.image&&!byImage.has(tex.image))byImage.set(tex.image,{image:tex.image,bytes:tex.bytes,filename:tex.filename||'diffuse.png',type:tex.type||'image/png'});}
    return Array.from(byImage.values());
  }
  function embeddedTextureForExport(){const m=activeMesh();return meshTexture(m);}
  function texturePath(){const m=activeMesh();if(m)return meshTexturePath(m,selectedMeshIndex);if(textureFile){const ext=extOf(textureFile.name)||'png';return 'textures/Global/diffuse.'+ext;}return'';}
  function updateTextureUi(){
    syncTextureGlobalsFromSelection();const mesh=activeMesh(),tex=meshTexture(mesh),embedded=mesh&&mesh.textureImage&&!mesh.materialTextureImage?meshTexture(mesh):null;
    $('textureBadge').textContent=mesh?(tex?(tex.override?'Override · '+mesh.name:'Embedded · '+mesh.name):'No texture · '+mesh.name):(textureFile?'Texture loaded':'No texture');
    $('diffuseState').textContent=tex?(tex.override?'Override ready':'Embedded texture'):'Default white';
    $('removeTexture').disabled=!(mesh&&mesh.materialTextureFile);$('removeTexture').title=mesh&&mesh.materialTextureFile?'Hapus texture override untuk mesh terpilih':'Pilih mesh dengan texture override untuk menghapusnya';
    const wrap=$('texturePreviewWrap');
    if(tex&&tex.objectUrl){wrap.className='';wrap.innerHTML=`<img class="texture-preview" src="${tex.objectUrl}" alt="Texture preview"><div class="note" style="margin-top:8px">Assigned to: ${escapeHtml(mesh.name)}${mesh.uvs?' · UV tersedia':' · UV tidak terdeteksi'}</div>`;$('textureFileInfo').classList.remove('hidden');$('textureFileName').textContent=tex.filename;$('textureFileDetails').textContent=`${humanBytes(tex.bytes&&tex.bytes.byteLength||0)} · ${tex.image.naturalWidth} × ${tex.image.naturalHeight}px`;
      if(!$('textureOutputName').dataset.userEdited)$('textureOutputName').value='diffuse.'+(extOf(tex.filename)||'png');}
    else if(tex&&tex.image){wrap.className='';wrap.innerHTML=`<div class="note">Texture bawaan model: ${escapeHtml(tex.filename||'embedded texture')} · ${escapeHtml(mesh.name)}</div>`;$('textureFileInfo').classList.remove('hidden');$('textureFileName').textContent=tex.filename||'embedded texture';$('textureFileDetails').textContent=`${humanBytes(tex.bytes&&tex.bytes.byteLength||0)} · assigned from source model`;if(!$('textureOutputName').dataset.userEdited)$('textureOutputName').value='diffuse.'+(extOf(tex.filename)||'png');}
    else{wrap.className='texture-empty';wrap.innerHTML='No texture assigned<br><span class="small">Pilih mesh di Outliner, lalu Add texture untuk menetapkan tekstur ke mesh tersebut.</span>';$('textureFileInfo').classList.add('hidden');if(!$('textureOutputName').dataset.userEdited)$('textureOutputName').value='diffuse.png';}
    syncJsonFromForm();projectUpdate();
  }

  function renderOutliner(){
    const list=$('outlinerList');if(!list)return;
    if(!model||!model.meshes.length){list.innerHTML='<div class="note">Impor model untuk mengelola objek dan export item.</div>';$('outlinerCount').textContent='0 objects';return;}
    refreshExportFolderNames(model.meshes);$('outlinerCount').textContent=`${model.meshes.length} objects · ${model.meshes.filter(m=>itemMeta(m).exportItem).length} export`;
    list.innerHTML=model.meshes.map((m,i)=>{const e=itemMeta(m),tri=Math.floor(m.positions.length/9),tex=!!meshTexture(m);return `<div class="outliner-row ${i===selectedMeshIndex?'selected':''}" data-row-index="${i}" style="padding-left:${8+meshDepth(m)*13}px"><input type="checkbox" data-export-index="${i}" ${e.exportItem?'checked':''} aria-label="Include ${escapeHtml(m.name)} in export"><button class="outliner-select" type="button" data-select-index="${i}" title="Select ${escapeHtml(m.name)}"><span>${e.parentId?'↳':'⬡'}</span><span style="min-width:0;flex:1"><span class="outliner-name">${escapeHtml(m.name)}</span><br><span class="outliner-detail">${fmt(tri)} tris · ${escapeHtml(e.groupName||'Scene')}${e.parentId?' · child of '+escapeHtml(meshByNodeId(e.parentId)?.name||'Object'):''}</span></span></button><span class="outliner-badge">${tex?'TEXTURE':'MESH'}</span></div>`;}).join('');
  }
  function syncSelectedMeshUi(){
    const m=activeMesh();const enabled=!!m;['activeObjectName','activeItemName','activeGroupName','activeParent','activeExportItem','activeItemScale','activeCollider','collSizeX','collSizeY','collSizeZ','collOffsetX','collOffsetY','collOffsetZ','meshOffsetY','applyItemSettings'].forEach(id=>{const el=$(id);if(el)el.disabled=!enabled;});
    if(!m){$('activeObjectName').value='';$('activeItemName').value='';$('activeGroupName').value='Scene';$('activeParent').innerHTML='<option value="">Scene root</option>';$('activeExportItem').checked=false;$('activeItemScale').value=1;$('activeCollider').value='default';}
    else{const e=itemMeta(m);$('activeObjectName').value=m.name;$('activeItemName').value=e.itemName;$('activeGroupName').value=e.groupName||'Scene';renderParentOptions(m);$('activeExportItem').checked=!!e.exportItem;$('activeItemScale').value=e.scale;$('activeCollider').value=e.collider;for(const [id,k] of [['collSizeX','SizeX'],['collSizeY','SizeY'],['collSizeZ','SizeZ'],['collOffsetX','OffsetX'],['collOffsetY','OffsetY'],['collOffsetZ','OffsetZ']])$(id).value=e.colliderOptions[k];$('meshOffsetY').value=e.meshOffsetY;}
    $('sizableWheelFields').classList.toggle('hidden',!m||itemMeta(m).collider!=='sizable_wheel');syncTransformInputs();renderOutliner();syncTextureGlobalsFromSelection();
  }
  function applyItemSettings(){const m=activeMesh();if(!m){toast('Tidak ada mesh terpilih.');return;}const e=itemMeta(m),v=id=>{const n=Number($(id).value);return Number.isFinite(n)?n:0;};m.name=$('activeObjectName').value.trim()||m.name||'Mesh';e.itemName=$('activeItemName').value.trim()||m.name;e.groupName=$('activeGroupName').value.trim()||'Scene';const parentId=$('activeParent').value||null;if(parentWouldCycle(m,parentId)){toast('Parent tidak valid karena membuat circular hierarchy.');renderParentOptions(m);return;}e.parentId=parentId;e.exportItem=$('activeExportItem').checked;e.scale=Math.max(.001,v('activeItemScale')||1);e.collider=$('activeCollider').value;e.colliderOptions={SizeX:Math.max(.001,v('collSizeX')||3),SizeY:Math.max(.001,v('collSizeY')||.35),SizeZ:Math.max(.001,v('collSizeZ')||3),OffsetX:v('collOffsetX'),OffsetY:v('collOffsetY'),OffsetZ:v('collOffsetZ')};e.meshOffsetY=v('meshOffsetY');$('sizableWheelFields').classList.toggle('hidden',e.collider!=='sizable_wheel');jsonWasManuallyEdited=false;renderOutliner();syncJsonFromForm();projectUpdate();scheduleDraw();updateValidationBadge('Not checked','');statusReport(`Pengaturan EVTS disimpan untuk “${m.name}”.`,'ok');toast('Pengaturan item diterapkan.');}

  // ---------- Transform + JSON ----------
  function readTransformInputs(){
    if(!model){toast('Impor model terlebih dahulu.');return;}
    const num=(id,def=0)=>{const n=Number($(id).value);return Number.isFinite(n)?n:def;},t=activeTransform()||model.transform;
    t.position=['px','py','pz'].map(id=>num(id));t.rotation=['rx','ry','rz'].map(id=>num(id)*Math.PI/180);t.scale=['sx','sy','sz'].map(id=>Math.max(.001,num(id,1)));
    scheduleDraw();frameModel();statusReport(`Transform diterapkan ke ${activeMesh()?.name||'root scene'}. Transform akan dibake ke OBJ saat ekspor.`,'ok');toast('Transform diterapkan.');
  }
  function resetTransform(){const t=activeTransform()||model?.transform;if(t){t.position=[0,0,0];t.rotation=[0,0,0];t.scale=[1,1,1];}syncTransformInputs();frameModel();toast('Transform objek direset.');}
  function selectedExportMeshes(){return model?model.meshes.filter(m=>itemMeta(m).exportItem):[];}
  function itemConfig(mesh,index){const e=itemMeta(mesh),tex=meshTexturePath(mesh,index),file=meshFolderName(mesh,index),entry={uuid:e.uuid,name:e.itemName||mesh.name||`Item ${index+1}`,description:`Created with Evertech Mod Studio · ${mesh.name||'Mesh'}`,icon:tex||`textures/${file}/icon.png`,dif:tex,nor:'',normScale:1,met:'',smoothness:0,mesh:meshObjPath(mesh,index),scale:Math.max(.001,Number(e.scale)||1)};if(e.collider==='wheel')entry.collider='wheel';else if(e.collider==='sizable_wheel'){entry.collider='sizable_wheel';entry.colliderOptions={SizeX:Number(e.colliderOptions.SizeX)||3,SizeY:Number(e.colliderOptions.SizeY)||.35,SizeZ:Number(e.colliderOptions.SizeZ)||3,OffsetX:Number(e.colliderOptions.OffsetX)||0,OffsetY:Number(e.colliderOptions.OffsetY)||0,OffsetZ:Number(e.colliderOptions.OffsetZ)||0};}if(Number(e.meshOffsetY))entry.meshOptions={OffsetY:Number(e.meshOffsetY)};return entry;}
  function buildConfig(){
    const all=model?model.meshes:[],included=selectedExportMeshes();let simpleblocks=[];
    if($('exportMode')?.value==='combined'&&included.length){const first=included[0],e=itemMeta(first),firstIndex=all.indexOf(first),tex=meshTexturePath(first,firstIndex),entry={uuid:e.uuid,name:$('itemName').value.trim()||$('modName').value.trim()||'Combined Item',description:'Combined static mesh item',icon:tex||'textures/icon.png',dif:tex,nor:'',normScale:1,met:'',smoothness:0,mesh:'meshes/combined/combined.obj',scale:Math.max(.001,Number($('itemScale').value)||1)};if(e.collider==='wheel')entry.collider='wheel';else if(e.collider==='sizable_wheel'){entry.collider='sizable_wheel';entry.colliderOptions={...e.colliderOptions};}if(Number(e.meshOffsetY))entry.meshOptions={OffsetY:Number(e.meshOffsetY)};simpleblocks=[entry];}
    else if(included.length)simpleblocks=included.map(m=>itemConfig(m,all.indexOf(m)));
    else if(!all.length){const tex=texturePath();simpleblocks=[{uuid:projectUuid,name:$('itemName').value.trim()||'Custom Part',description:'Decorative model',icon:tex||'textures/icon.png',dif:tex,nor:'',normScale:1,met:'',smoothness:0,mesh:'meshes/Model/Model.obj',scale:Math.max(.001,Number($('itemScale').value)||1)}];}
    const rootPreview=(simpleblocks[0]&&simpleblocks[0].dif)||'textures/preview.png';
    return{name:$('modName').value.trim(),preview:rootPreview,version:'1.0.0',author:$('author').value.trim(),description:'Created with Evertech Mod Studio Browser Lab',simpleblocks};
  }
  function syncJsonFromForm(){if(jsonWasManuallyEdited)return;if($('jsonEditor'))$('jsonEditor').value=JSON.stringify(buildConfig(),null,2);projectUpdate();}
  function getConfigFromEditor(){try{return{config:JSON.parse($('jsonEditor').value),error:null};}catch(err){return{config:null,error:err.message};}}

  // Bake model transforms and write a static OBJ with per-triangle normals and existing UVs.
  function serializeOBJ(meshesToSerialize=null){
    if(!model)throw new Error('Tidak ada model 3D untuk diekspor.');
    const sourceMeshes=meshesToSerialize||model.meshes,lines=['# Exported by Evertech Mod Studio Browser Lab v0.7','# Static OBJ; each item has an independent OBJ path.'];let vertexIndex=1,uvIndex=1,normalIndex=1;
    sourceMeshes.forEach((mesh,mi)=>{
      const p=mesh.positions,uv=mesh.uvs;lines.push(`o ${safeName(mesh.name,`Mesh_${mi+1}`)}`);
      const transformed=[];for(let i=0;i<p.length;i+=3)transformed.push(transformPoint([p[i],p[i+1],p[i+2]],mesh));
      if($('exportMode')?.value==='separate'&&sourceMeshes.length===1&&transformed.length){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const v of transformed)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],v[k]);hi[k]=Math.max(hi[k],v[k]);}const center=lo.map((v,k)=>(v+hi[k])/2);for(const v of transformed)for(let k=0;k<3;k++)v[k]-=center[k];}
      for(const v of transformed)lines.push(`v ${v[0].toFixed(7)} ${v[1].toFixed(7)} ${v[2].toFixed(7)}`);
      const hasUv=uv&&uv.length===transformed.length/3*2;
      if(hasUv)for(let i=0;i<uv.length;i+=2)lines.push(`vt ${uv[i].toFixed(7)} ${uv[i+1].toFixed(7)}`);
      for(let i=0;i+2<transformed.length;i+=3){const n=norm(cross(vsub(transformed[i+1],transformed[i]),vsub(transformed[i+2],transformed[i])));for(let j=0;j<3;j++)lines.push(`vn ${n[0].toFixed(7)} ${n[1].toFixed(7)} ${n[2].toFixed(7)}`);}
      for(let i=0;i+2<transformed.length;i+=3){const refs=[];for(let j=0;j<3;j++){const v=vertexIndex+i+j,vt=uvIndex+i+j,vn=normalIndex+i+j;refs.push(hasUv?`${v}/${vt}/${vn}`:`${v}//${vn}`);}lines.push('f '+refs.join(' '));}
      vertexIndex+=transformed.length;normalIndex+=transformed.length;if(hasUv)uvIndex+=transformed.length;
    });
    return lines.join('\n')+'\n';
  }

  // ---------- Validation + build ----------
  function collectValidation(){
    const errors=[],warnings=[],checks=[];
    if(!$('modName').value.trim())errors.push('Nama mod wajib diisi.');else checks.push('Nama mod terisi.');
    if(!$('author').value.trim())errors.push('Nama author wajib diisi.');else checks.push('Author terisi.');
    if(!model)errors.push('Belum ada model 3D di viewport.');else checks.push(`${model.meshes.length} mesh berhasil dibaca.`);
    const included=selectedExportMeshes();if(model&&!included.length)errors.push('Pilih setidaknya satu mesh untuk diekspor.');else if(included.length)checks.push(`${included.length} mesh dipilih untuk ekspor.`);
    const parsed=getConfigFromEditor();if(parsed.error)errors.push('info.json tidak valid: '+parsed.error);else{
      const c=parsed.config;if(!c||typeof c!=='object'||Array.isArray(c))errors.push('Root info.json harus berupa object JSON.');else if(!Array.isArray(c.simpleblocks)||!c.simpleblocks.length)errors.push('simpleblocks harus berupa array yang tidak kosong.');else{
        checks.push('info.json memiliki sintaks JSON valid.');
        const expected=new Set();if($('exportMode').value==='combined')expected.add('meshes/combined/combined.obj');else included.forEach(m=>expected.add(meshObjPath(m,model.meshes.indexOf(m))));
        c.simpleblocks.forEach((it,i)=>{if(!it||typeof it!=='object'){errors.push(`simpleblocks[${i}] bukan object.`);return;}if(!it.uuid)errors.push(`simpleblocks[${i}] tidak memiliki UUID.`);if(!it.mesh)errors.push(`simpleblocks[${i}] tidak memiliki path mesh.`);else if(!expected.has(it.mesh))errors.push(`Path mesh item ${i+1} (${it.mesh}) tidak sesuai file yang akan dibuat.`);if(it.collider==='sizable_wheel'&&!it.colliderOptions)warnings.push(`Item ${i+1} memakai sizable_wheel tetapi colliderOptions kosong.`);});
      }
    }
    const hasTextures=included.some(m=>!!meshTexture(m));if(hasTextures)checks.push('Tekstur per mesh akan disertakan pada folder masing-masing.');else warnings.push('Tidak ada tekstur diffuse; item akan memakai material default/putih.');
    if($('exportMode').value==='combined'&&new Set(included.map(m=>{const t=meshTexture(m);return t&&t.bytes?meshTexturePath(m,model.meshes.indexOf(m)):'';}).filter(Boolean)).size>1)warnings.push('Mode Combined: beberapa tekstur terdeteksi tetapi satu item EVTS hanya memiliki satu field diffuse. Gunakan Separate Items untuk menjaga tekstur per objek.');
    if($('profile').value!=='decorative')warnings.push('Collider roda diekspor melalui collider field yang terdokumentasi; fitur Lua fungsional masih perlu diuji dalam game.');
    if($('luaCode').value.trim())warnings.push('Lua disertakan ke scripts/main.lua; path API runtime perlu dikonfirmasi untuk versi EVTS yang dipakai.');
    if(model&&(model.animations||model.skins))warnings.push('Animasi/rig tidak dipertahankan dalam ekspor OBJ statis.');
    if(typeof JSZip==='undefined')errors.push('JSZip tidak tersedia di file ini.');else checks.push('ZIP engine tersedia secara lokal.');
    checks.push($('exportMode').value==='separate'?'Output: satu OBJ dan item config per mesh tercentang.':'Output: satu OBJ gabungan dan satu item config.');
    return{errors,warnings:[...new Set(warnings)],checks};
  }
  function runValidation(){const r=collectValidation(),sections=[];if(r.errors.length)sections.push('ERRORS\n'+r.errors.map(x=>'✕ '+x).join('\n'));if(r.warnings.length)sections.push('WARNINGS\n'+r.warnings.map(x=>'⚠ '+x).join('\n'));if(r.checks.length)sections.push('CHECKS\n'+r.checks.map(x=>'✓ '+x).join('\n'));if(!r.errors.length)sections.push('\nPemeriksaan lokal selesai. Format item mengikuti schema dokumentasi mod EVTS, tetapi harus diuji di dalam versi game yang kamu gunakan.');statusReport(sections.join('\n\n'),r.errors.length?'error':r.warnings.length?'warn':'ok');updateValidationBadge(r.errors.length?`${r.errors.length} error`:r.warnings.length?`${r.warnings.length} warning`:'Passed',r.errors.length?'red':r.warnings.length?'':'green');return r;}
  const yieldExportUI = () => new Promise(resolve => setTimeout(resolve, 0));
  let exportInProgress = false;
  // Heavy OBJ conversion can run off the UI thread on browsers that support Web Workers.
  // Keep the existing serializer as the compatibility fallback for small meshes / restricted browsers.
  async function serializeOBJResponsive(sourceMeshes,onProgress=()=>{}){
    const totalVertices=sourceMeshes.reduce((sum,m)=>sum+Math.floor((m.positions||[]).length/3),0);
    if(typeof Worker==='undefined'||typeof URL.createObjectURL!=='function'||totalVertices<60000){
      await yieldExportUI();return serializeOBJ(sourceMeshes);
    }
    const workerSource = `
      function safeObjectName(s,fallback){s=String(s||fallback||'mod').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);return s||fallback||'mod';}
      function applyTransform(t,p){const m=t||{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};let x=p[0]*m.scale[0],y=p[1]*m.scale[1],z=p[2]*m.scale[2];let c=Math.cos(m.rotation[0]),s=Math.sin(m.rotation[0]);[y,z]=[y*c-z*s,y*s+z*c];c=Math.cos(m.rotation[1]);s=Math.sin(m.rotation[1]);[x,z]=[x*c+z*s,-x*s+z*c];c=Math.cos(m.rotation[2]);s=Math.sin(m.rotation[2]);[x,y]=[x*c-y*s,x*s+y*c];return [x+m.position[0],y+m.position[1],z+m.position[2]];}
      const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
      const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      const norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
      self.onmessage=e=>{try{
        const {meshes,centerSingle,total}=e.data,lines=['# Exported by Evertech Mod Studio Browser Lab v0.7','# Static OBJ; each item has an independent OBJ path.'];let vertexIndex=1,uvIndex=1,normalIndex=1,done=0;
        for(let mi=0;mi<meshes.length;mi++){
          const m=meshes[mi],p=m.positions,uv=m.uvs||[],transforms=m.transforms||[];lines.push('o '+safeObjectName(m.name,'Mesh_'+(mi+1)));
          const transformed=[];
          for(let i=0;i<p.length;i+=3){let v=[p[i],p[i+1],p[i+2]];for(const t of transforms)v=applyTransform(t,v);transformed.push(v);done++;if(done%25000===0)self.postMessage({type:'progress',done,total,percent:Math.min(90,Math.round(done/Math.max(1,total)*90))});}
          if(centerSingle&&transformed.length){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const v of transformed)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],v[k]);hi[k]=Math.max(hi[k],v[k]);}const center=lo.map((v,k)=>(v+hi[k])/2);for(const v of transformed)for(let k=0;k<3;k++)v[k]-=center[k];}
          for(const v of transformed)lines.push('v '+v[0].toFixed(7)+' '+v[1].toFixed(7)+' '+v[2].toFixed(7));
          const hasUv=uv.length===transformed.length/3*2;
          if(hasUv)for(let i=0;i<uv.length;i+=2)lines.push('vt '+uv[i].toFixed(7)+' '+uv[i+1].toFixed(7));
          for(let i=0;i+2<transformed.length;i+=3){const n=norm(cross(sub(transformed[i+1],transformed[i]),sub(transformed[i+2],transformed[i])));for(let j=0;j<3;j++)lines.push('vn '+n[0].toFixed(7)+' '+n[1].toFixed(7)+' '+n[2].toFixed(7));}
          for(let i=0;i+2<transformed.length;i+=3){const refs=[];for(let j=0;j<3;j++){const v=vertexIndex+i+j,vt=uvIndex+i+j,vn=normalIndex+i+j;refs.push(hasUv?(v+'/'+vt+'/'+vn):(v+'//'+vn));}lines.push('f '+refs.join(' '));}
          vertexIndex+=transformed.length;normalIndex+=transformed.length;if(hasUv)uvIndex+=transformed.length;
        }
        self.postMessage({type:'done',text:lines.join('\\n')+'\\n'});
      }catch(err){self.postMessage({type:'error',message:err&&err.message?err.message:String(err)});}};
    `;
    const workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
    try{
      return await new Promise((resolve,reject)=>{
        const worker=new Worker(workerUrl);let settled=false;
        const finish=(fn,value)=>{if(settled)return;settled=true;worker.terminate();fn(value);};
        worker.onmessage=e=>{const d=e.data||{};if(d.type==='progress')onProgress(`Worker OBJ: ${Math.round((d.percent||0))}% · ${totalVertices.toLocaleString()} vertex`,Math.min(65,Math.round((d.percent||0)*.65)));else if(d.type==='done')finish(resolve,d.text);else if(d.type==='error')finish(reject,new Error(d.message||'Worker gagal membuat OBJ.'));};
        worker.onerror=e=>finish(reject,new Error(e.message||'Web Worker gagal.'));
        const payload=sourceMeshes.map(m=>({name:safeName(m.name,'Mesh'),positions:m.positions,uvs:m.uvs||[],transforms:[...meshTransformChain(m).map(node=>node.transform),model.transform]}));
        worker.postMessage({meshes:payload,centerSingle:$('exportMode').value==='separate'&&sourceMeshes.length===1,total:totalVertices});
      });
    }catch(err){console.warn('OBJ Worker fallback:',err);onProgress('Worker tidak tersedia; memakai serializer standar…',30);await yieldExportUI();return serializeOBJ(sourceMeshes);}
    finally{URL.revokeObjectURL(workerUrl);}
  }
  function zipProfile(){
    const mode=$('zipMode')?.value||'fast';
    if(mode==='compact')return {name:'Smaller ZIP',level:7};
    if(mode==='balanced')return {name:'Balanced',level:3};
    return {name:'Fast',level:1};
  }
  async function buildPackageFiles(onProgress=()=>{}){
    if(!model)throw new Error('Tidak ada model untuk diekspor.');
    const parsed=getConfigFromEditor();
    if(parsed.error)throw new Error('JSON tidak valid: '+parsed.error);
    const cfg=parsed.config,root=safeName(cfg.name||$('modName').value||'EvertechMod','EvertechMod'),included=selectedExportMeshes(),files=[];
    if(!included.length)throw new Error('Pilih setidaknya satu mesh untuk diekspor.');
    const mode=$('exportMode').value;refreshExportFolderNames(model.meshes);
    const pathFor=(m)=>meshObjPath(m,model.meshes.indexOf(m));
    const texPathFor=(m)=>meshTexturePath(m,model.meshes.indexOf(m));
    const emitted = new Set();
    if(mode==='combined'){
      onProgress(`Menyiapkan OBJ gabungan dari ${included.length} mesh…`,5);
      await yieldExportUI();
      const objText=await serializeOBJResponsive(included,onProgress);if(!/^f\s/m.test(objText))throw new Error('OBJ gabungan tidak berisi face.');files.push({path:'meshes/combined/combined.obj',data:new Blob([objText],{type:'text/plain'})});
      const first=included[0],tex=meshTexture(first),texPath=texPathFor(first);if(tex&&tex.bytes){files.push({path:texPath,data:new Blob([tex.bytes],{type:tex.type||'application/octet-stream'})});emitted.add(texPath);}
      if(!cfg.simpleblocks[0]||cfg.simpleblocks[0].mesh!=='meshes/combined/combined.obj')throw new Error('Path mesh di info.json tidak sama dengan mode Combined; ketik ulang properti untuk menyinkronkan JSON.');
      onProgress('OBJ gabungan selesai; merapikan metadata…',65);
    } else {
      for(let n=0;n<included.length;n++){
        const m=included[n],i=model.meshes.indexOf(m),objPath=pathFor(m);
        onProgress(`Menyiapkan mesh ${n+1}/${included.length}: ${m.name||'Mesh '+(n+1)}…`,Math.round((n/included.length)*60));
        await yieldExportUI();
        const objText=await serializeOBJResponsive([m],onProgress);if(!/^f\s/m.test(objText))throw new Error(`OBJ ${m.name} tidak memiliki face.`);
        files.push({path:objPath,data:new Blob([objText],{type:'text/plain'})});
        const tex=meshTexture(m),texPath=texPathFor(m);if(tex&&tex.bytes&&!emitted.has(texPath)){files.push({path:texPath,data:new Blob([tex.bytes],{type:tex.type||'application/octet-stream'})});emitted.add(texPath);}
        onProgress(`Mesh ${n+1}/${included.length} siap: ${m.name||'Mesh '+(n+1)}`,Math.round(((n+1)/included.length)*60));
        await yieldExportUI();
      }
      if(cfg.simpleblocks.length!==included.length)throw new Error('Jumlah item dalam info.json tidak sama dengan mesh tercentang. Sinkronkan dengan mengubah pengaturan item lalu ekspor lagi.');
      for(let i=0;i<included.length;i++)if(cfg.simpleblocks[i]?.mesh!==pathFor(included[i]))throw new Error(`Path mesh item ${i+1} tidak cocok dengan folder ekspor. Format JSON kembali atau edit ulang pengaturan item.`);
    }
    onProgress('Menyiapkan ikon, preview, dan metadata…',68);await yieldExportUI();
    // Ensure each item has an icon path that resolves; use its diffuse when available, otherwise create a small labeled placeholder.
    const items=Array.isArray(cfg.simpleblocks)?cfg.simpleblocks:[];
    for(let i=0;i<items.length;i++){const m=mode==='combined'?included[0]:included[i];if(!m)continue;const texPath=texPathFor(m);if(items[i].icon&&texPath&&items[i].icon===texPath)continue;if(!items[i].icon||!String(items[i].icon).startsWith('textures/'))items[i].icon='textures/icon.png';if(items[i].icon==='textures/icon.png'&&!emitted.has('textures/icon.png')){files.push({path:'textures/icon.png',data:makePlaceholderPng(items[i].name||m.name,128,128)});emitted.add('textures/icon.png');}}
    if(!cfg.preview||!String(cfg.preview).startsWith('textures/'))cfg.preview='textures/preview.png';
    const paths=new Set(files.map(f=>f.path));if(cfg.preview&&!paths.has(cfg.preview)&&!emitted.has(cfg.preview)){files.push({path:cfg.preview,data:makePlaceholderPng(cfg.name||'EVTS Mod',320,220)});paths.add(cfg.preview);}
    // Any icon/preview referring to a texture path without bytes is replaced with a generated file rather than leaving a broken reference.
    for(const it of items){if(it.icon&&!files.some(f=>f.path===it.icon)){files.push({path:it.icon,data:makePlaceholderPng(it.name||'EVTS Item',128,128)});} }
    if(cfg.preview&&!files.some(f=>f.path===cfg.preview))files.push({path:cfg.preview,data:makePlaceholderPng(cfg.name||'EVTS Mod',320,220)});
    files.unshift({path:'info.json',data:new Blob([JSON.stringify(cfg,null,2)],{type:'application/json'})});
    if($('luaCode').value.trim())files.push({path:'scripts/main.lua',data:new Blob([$('luaCode').value],{type:'text/plain'})});
    if($('includeSource').checked)files.push({path:'PROJECT_NOTES.txt',data:new Blob([`Evertech Mod Studio v0.7\nExport mode: ${mode}\nMeshes included: ${included.length}\nSource: ${primaryModelFile?primaryModelFile.name:'(none)'}\nStatic OBJ export. Animations and rigging are not preserved. Collider choices follow the community-documented EVTS mod schema. Test the result in the target game version.\n`],{type:'text/plain'})});
    onProgress(`Paket siap: ${files.length} file.`,72);await yieldExportUI();
    return{root,files,config:cfg,mode,meshCount:included.length};
  }
  async function exportZip(){
    if(exportInProgress)return;
    const validation=runValidation();if(validation.errors.length){setPage('export');toast('Perbaiki error validasi sebelum ekspor.');return;}
    if(typeof JSZip==='undefined'){setExportStatus('ZIP library tidak tersedia.','error');return;}
    exportInProgress=true;$('downloadZip').disabled=true;$('exportFolder').disabled=true;
    const profile=zipProfile();
    try{
      setExportStatus('Menyiapkan ekspor…','info');await yieldExportUI();
      const pack=await buildPackageFiles((message,pct)=>setExportStatus(`${message}\nProgres persiapan: ${pct}%`,'info'));
      const zip=new JSZip(),root=zip.folder(pack.root);
      for(let i=0;i<pack.files.length;i++){
        const item=pack.files[i],isTexture=/^textures\//i.test(item.path);
        // Image assets are already compressed formats. STORE avoids spending CPU compressing them again.
        root.file(item.path,item.data,isTexture?{compression:'STORE'}:{compression:'DEFLATE',compressionOptions:{level:profile.level}});
        if(i%8===0){setExportStatus(`Menambahkan file ${i+1}/${pack.files.length}: ${item.path}\nMode ZIP: ${profile.name}`,'info');await yieldExportUI();}
      }
      setExportStatus(`Membuat ZIP (${profile.name})… 0%`,'info');await yieldExportUI();
      const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:profile.level},streamFiles:true},meta=>setExportStatus(`Membuat ZIP (${profile.name})… ${Math.round(meta.percent)}%${meta.currentFile?'\nFile: '+meta.currentFile:''}`,'info'));
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=pack.root+'.zip';a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
      setExportStatus(`ZIP berhasil dibuat: ${pack.root}.zip\n${pack.files.length} file · ${humanBytes(blob.size)}\nMode ZIP: ${profile.name} (level ${profile.level}; tekstur disimpan tanpa kompresi ulang)\nMode objek: ${pack.mode} · ${pack.meshCount} mesh/item\nUnduhan dimulai. Uji paket di EVTS sebelum dianggap kompatibel.`,'ok');toast('ZIP berhasil dibuat.');
    }catch(err){setExportStatus('Ekspor gagal: '+(err.message||err),'error');toast('Ekspor gagal. Lihat laporan.');console.error(err);}
    finally{exportInProgress=false;$('downloadZip').disabled=false;$('exportFolder').disabled=false;}
  }
  async function writeBlob(dir,path,blob){const parts=path.split('/'),filename=parts.pop();let folder=dir;for(const part of parts)folder=await folder.getDirectoryHandle(part,{create:true});const h=await folder.getFileHandle(filename,{create:true});const w=await h.createWritable();await w.write(blob);await w.close();}
  async function exportFolder(){
    if(exportInProgress)return;
    if(!('showDirectoryPicker'in window)){setExportStatus('Browser ini tidak menyediakan akses tulis folder. Gunakan Download ZIP. Folder export biasanya tersedia pada browser desktop yang mendukung File System Access API melalui HTTPS/localhost.','warn');toast('Folder export tidak didukung. Gunakan ZIP.');return;}
    const validation=runValidation();if(validation.errors.length){setPage('export');toast('Perbaiki error validasi sebelum ekspor.');return;}
    exportInProgress=true;$('downloadZip').disabled=true;$('exportFolder').disabled=true;
    try{
      const parent=await window.showDirectoryPicker({mode:'readwrite'});
      const pack=await buildPackageFiles((message,pct)=>setExportStatus(`${message}\nProgres persiapan: ${pct}%`,'info'));
      const root=await parent.getDirectoryHandle(pack.root,{create:true});
      for(let i=0;i<pack.files.length;i++){
        const item=pack.files[i];setExportStatus(`Menulis file ${i+1}/${pack.files.length}: ${item.path}`,'info');
        await writeBlob(root,item.path,item.data);if(i%4===0)await yieldExportUI();
      }
      setExportStatus(`Folder berhasil dibuat: ${pack.root}/\n${pack.files.length} file ditulis.\nMode: ${pack.mode} · ${pack.meshCount} mesh/item diproses.\nVerifikasi paket lalu uji di EVTS.`,'ok');toast('Folder mod berhasil dibuat.');
    }catch(err){setExportStatus(err.name==='AbortError'?'Pemilihan folder dibatalkan.':'Folder export gagal: '+(err.message||err),err.name==='AbortError'?'warn':'error');}
    finally{exportInProgress=false;$('downloadZip').disabled=false;$('exportFolder').disabled=false;}
  }
  function newProject(){if(!confirm('Mulai proyek baru? Model/texture yang belum diekspor di sesi ini akan dilepas.'))return;for(const url of generatedTextureUrls)URL.revokeObjectURL(url);generatedTextureUrls.clear();model=null;selectedMeshIndex=0;primaryModelFile=null;sourceFiles=[];textureFile=null;textureBytes=null;textureImage=null;if(textureObjectUrl)URL.revokeObjectURL(textureObjectUrl);textureObjectUrl=null;projectUuid=makeUuid();jsonWasManuallyEdited=false;$('modName').value='My Custom Mod';$('author').value='Creator';$('itemName').value='Custom Part';$('itemScale').value='1';$('exportMode').value='separate';$('zipMode').value='fast';$('profile').value='decorative';$('luaCode').value='';$('includeSource').checked=false;$('textureOutputName').value='diffuse.png';$('textureOutputName').dataset.userEdited='';$('emptyState').classList.remove('hidden');$('assetList').innerHTML='<div class="note">Belum ada file. Tekan <b>Import 3D</b> untuk memulai.</div>';$('assetType').textContent='No asset';$('modelPill').textContent='Belum ada model';['px','py','pz','rx','ry','rz'].forEach(id=>$(id).value=0);['sx','sy','sz'].forEach(id=>$(id).value=1);refreshStats();renderOutliner();syncSelectedMeshUi();updateTextureUi();syncJsonFromForm();projectUpdate();statusReport('Proyek baru siap. Impor model 3D untuk memulai.','info');updateValidationBadge('Not checked','');camera.yaw=.72;camera.pitch=.32;camera.distance=7;camera.target=[0,0,0];scheduleDraw();setPage('scene');toast('Proyek baru dibuat.');}

  // ---------- UI events ----------
  $('browseModel').addEventListener('click',()=>$('modelFile').click());$('emptyImport').addEventListener('click',()=>$('modelFile').click());$('modelFile').addEventListener('change',e=>importModels(e.target.files));
  $('browseTexture').addEventListener('click',()=>$('textureFile').click());$('materialsImport').addEventListener('click',()=>$('textureFile').click());$('textureFile').addEventListener('change',async e=>{await importTexture(e.target.files&&e.target.files[0]);e.target.value='';});
  function syncFaceButtons(){
    $('onFaceToggle').classList.toggle('active',faceRendering); $('onFaceToggle').setAttribute('aria-pressed',String(faceRendering));
    $('doubleFaceToggle').classList.toggle('active',doubleFace); $('doubleFaceToggle').setAttribute('aria-pressed',String(doubleFace));
    $('onFaceToggle').textContent=faceRendering?'▰ On Face':'▱ Wireframe';
    $('doubleFaceToggle').textContent=doubleFace?'◧ Double Face ON':'◨ Double Face';
  }
  function syncLayoutButton(){
    const labels={auto:'▤ Auto',portrait:'▯ Portrait',landscape:'▰ Landscape'};
    document.querySelector('.app').dataset.layout=layoutMode;
    $('layoutToggle').textContent=labels[layoutMode]; $('layoutToggle').setAttribute('aria-label','UI layout: '+layoutMode);
    $('layoutToggle').title='Layout mode: '+layoutMode+' (tap to change)';
    requestAnimationFrame(()=>{resizeCanvas();scheduleDraw();});
  }
  $('onFaceToggle').addEventListener('click',()=>{faceRendering=!faceRendering;syncFaceButtons();scheduleDraw();});
  $('doubleFaceToggle').addEventListener('click',()=>{doubleFace=!doubleFace;syncFaceButtons();scheduleDraw();});
  $('layoutToggle').addEventListener('click',()=>{layoutMode=layoutMode==='auto'?'portrait':layoutMode==='portrait'?'landscape':'auto';syncLayoutButton();});
  syncFaceButtons(); syncLayoutButton();
  $('frameBtn').addEventListener('click',frameModel);$('renderQuality').addEventListener('change',resizeCanvas);$('applyTransform').addEventListener('click',readTransformInputs);$('resetTransform').addEventListener('click',resetTransform);
  $('gizmoMove').addEventListener('click',()=>setGizmoMode('move'));$('gizmoRotate').addEventListener('click',()=>setGizmoMode('rotate'));$('gizmoScale').addEventListener('click',()=>setGizmoMode('scale'));
  $('removeTexture').addEventListener('click',()=>{const m=activeMesh();if(!m||!m.materialTextureFile){toast('Tidak ada texture override pada mesh terpilih.');return;}m.materialTextureFile=null;m.materialTextureImage=null;m.materialTextureBytes=null;m.materialTextureFileName=null;m.materialTextureType=null;m.materialTextureObjectUrl=null;syncTextureGlobalsFromSelection();updateTextureUi();renderOutliner();scheduleDraw();toast('Texture override dihapus dari mesh terpilih.');});
  $('outlinerList').addEventListener('click',e=>{const button=e.target.closest('[data-select-index]');if(!button)return;selectedMeshIndex=Number(button.dataset.selectIndex)||0;syncSelectedMeshUi();updateTextureUi();scheduleDraw();});
  $('outlinerList').addEventListener('change',e=>{const cb=e.target.closest('[data-export-index]');if(!cb)return;const idx=Number(cb.dataset.exportIndex),m=model&&model.meshes[idx];if(!m)return;itemMeta(m).exportItem=cb.checked;renderOutliner();jsonWasManuallyEdited=false;syncJsonFromForm();updateValidationBadge('Not checked','');});
  $('selectAllExport').addEventListener('click',()=>{if(!model)return;model.meshes.forEach(m=>itemMeta(m).exportItem=true);renderOutliner();jsonWasManuallyEdited=false;syncJsonFromForm();});
  $('deselectAllExport').addEventListener('click',()=>{if(!model)return;model.meshes.forEach(m=>itemMeta(m).exportItem=false);renderOutliner();jsonWasManuallyEdited=false;syncJsonFromForm();});
  $('activeCollider').addEventListener('change',()=>{$('sizableWheelFields').classList.toggle('hidden',$('activeCollider').value!=='sizable_wheel');});
  $('applyItemSettings').addEventListener('click',applyItemSettings);
  $('activeObjectName').addEventListener('keydown',e=>{if(e.key==='Enter')applyItemSettings();});$('activeItemName').addEventListener('keydown',e=>{if(e.key==='Enter')applyItemSettings();});
  $('exportMode').addEventListener('change',()=>{jsonWasManuallyEdited=false;syncJsonFromForm();updateValidationBadge('Not checked','');});
  $('textureOutputName').addEventListener('input',()=>{});
  ['modName','author','itemName','itemScale','profile'].forEach(id=>$(id).addEventListener('input',()=>{jsonWasManuallyEdited=false;syncJsonFromForm();projectUpdate();updateValidationBadge('Not checked','');}));
  $('jsonEditor').addEventListener('input',()=>{jsonWasManuallyEdited=true;updateValidationBadge('Edited','');});
  document.querySelectorAll('.code-tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.code-tab').forEach(x=>x.classList.toggle('active',x===tab));document.querySelectorAll('.code-pane').forEach(x=>x.classList.toggle('active',x.id===tab.dataset.code));}));
  $('formatJson').addEventListener('click',()=>{try{$('jsonEditor').value=JSON.stringify(JSON.parse($('jsonEditor').value),null,2);jsonWasManuallyEdited=true;toast('JSON diformat.');}catch(err){statusReport('JSON belum valid: '+err.message,'error');setPage('export');}});
  $('validateBtn').addEventListener('click',runValidation);$('runValidationTop').addEventListener('click',()=>{setPage('export');runValidation();});$('downloadZip').addEventListener('click',exportZip);$('exportFolder').addEventListener('click',exportFolder);$('newProject').addEventListener('click',newProject);

  // Mouse, pen, and touch navigation
  const target=$('dropTarget');target.addEventListener('pointerdown',e=>{if(e.target!==$('view'))return;target.setPointerCapture?.(e.pointerId);drag.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});drag.lastX=e.clientX;drag.lastY=e.clientY;if(model&&e.button!==2&&e.button!==1&&!e.shiftKey&&startGizmoDrag(e)){scheduleDraw();return;}drag.mode=(e.button===2||e.button===1||e.shiftKey)?'pan':'orbit';if(drag.pointers.size===2){const ps=[...drag.pointers.values()];drag.pinchDistance=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);} });
  target.addEventListener('pointermove',e=>{if(!drag.pointers.has(e.pointerId))return;const old=drag.pointers.get(e.pointerId);drag.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(drag.mode==='gizmo'){updateGizmoDrag(e);return;}if(drag.pointers.size>=2){const ps=[...drag.pointers.values()],dist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);if(drag.pinchDistance>0)camera.distance=Math.max(.15,Math.min(100000,camera.distance*drag.pinchDistance/Math.max(1,dist)));drag.pinchDistance=dist;}
    else{const dx=e.clientX-old.x,dy=e.clientY-old.y;if(drag.mode==='orbit'){camera.yaw-=dx*.008;camera.pitch=Math.max(-1.47,Math.min(1.47,camera.pitch-dy*.008));}else{const basis=cameraBasis(),scale=camera.distance/Math.max(canvasHeight,1)*1.5;camera.target=vadd(camera.target,vadd(vscale(basis.right,-dx*scale),vscale(basis.up,dy*scale)));}}scheduleDraw();});
  const clearPointer=e=>{drag.pointers.delete(e.pointerId);drag.gizmo=null;if(drag.pointers.size<2)drag.pinchDistance=0;};target.addEventListener('pointerup',clearPointer);target.addEventListener('pointercancel',clearPointer);target.addEventListener('lostpointercapture',clearPointer);target.addEventListener('contextmenu',e=>e.preventDefault());
  $('view').addEventListener('wheel',e=>{e.preventDefault();camera.distance=Math.max(.15,Math.min(100000,camera.distance*Math.exp(e.deltaY*.001)));scheduleDraw();},{passive:false});
  target.addEventListener('dragover',e=>{e.preventDefault();target.style.outline='2px dashed var(--red)';target.style.outlineOffset='-7px';});target.addEventListener('dragleave',()=>{target.style.outline='';target.style.outlineOffset='';});target.addEventListener('drop',e=>{e.preventDefault();target.style.outline='';target.style.outlineOffset='';const files=Array.from(e.dataTransfer.files||[]);if(files.some(f=>['obj','glb','gltf','stl'].includes(extOf(f.name))))importModels(files);else if(files[0])importTexture(files[0]);});
  window.addEventListener('keydown',e=>{const targetTag=(e.target&&e.target.tagName||'').toLowerCase();if(['input','textarea','select'].includes(targetTag)||e.ctrlKey||e.metaKey||e.altKey)return;const key=e.key.toLowerCase();if(key==='o'){$('modelFile').click();}else if(key==='g')setGizmoMode('move');else if(key==='r')setGizmoMode('rotate');else if(key==='s')setGizmoMode('scale');});

  init3D();syncJsonFromForm();projectUpdate();renderOutliner();syncSelectedMeshUi();updateTextureUi();setGizmoMode('move');
})();
