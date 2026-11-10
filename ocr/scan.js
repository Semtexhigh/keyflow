/* ================================================================
   Passport scan — live camera guidance + offline OCR.
   analyzeFrame() looks at a small grayscale copy of the camera frame
   and returns the single most useful thing to say right now, so the
   guidance reads like a person talking you through it. scanImage()
   runs Tesseract (bundled, no network) and hands the text to MRZ.parse.
   ================================================================ */
(function(root){
"use strict";
var MRZ = root.MRZ || (typeof require!=="undefined" && require("./mrz.js"));

/* ---- frame quality: returns {code, msg, ok, ready} ---- */
function gray(data){ // {w,h,px:Uint8ClampedArray rgba}
  var w=data.w,h=data.h,src=data.px,g=new Float32Array(w*h);
  for(var i=0,j=0;i<src.length;i+=4,j++) g[j]=0.299*src[i]+0.587*src[i+1]+0.114*src[i+2];
  return g;
}
function stats(g){
  var n=g.length,sum=0,min=255,max=0,i;
  for(i=0;i<n;i++){ var v=g[i]; sum+=v; if(v<min)min=v; if(v>max)max=v; }
  var mean=sum/n, vs=0; for(i=0;i<n;i++){ var d=g[i]-mean; vs+=d*d; }
  return {mean:mean,min:min,max:max,sd:Math.sqrt(vs/n)};
}
/* sharpness: mean |Laplacian| over the frame */
function sharpness(g,w,h){
  var s=0,c=0;
  for(var y=1;y<h-1;y+=2){ for(var x=1;x<w-1;x+=2){ var i=y*w+x;
    var lap=4*g[i]-g[i-1]-g[i+1]-g[i-w]-g[i+w]; s+=Math.abs(lap); c++; } }
  return c?s/c:0;
}
/* fraction of near-white pixels in the brightest 8-pixel band — glare/flash */
function glare(g,w,h){ var c=0,n=0; for(var i=0;i<g.length;i+=3){ n++; if(g[i]>248)c++; } return c/n; }
/* find the MRZ band: the row region with the most high-contrast vertical
   transitions (monospace text). returns {found, top,bottom, rows, frac, tilt} */
function mrzBand(g,w,h){
  var row=new Float32Array(h);
  for(var y=0;y<h;y++){ var t=0,prev=g[y*w]; for(var x=1;x<w;x++){ var v=g[y*w+x]; if(Math.abs(v-prev)>40)t++; prev=v; } row[y]=t; }
  var thr=0; for(var y2=0;y2<h;y2++) thr+=row[y2]; thr=(thr/h)*1.8;
  var best=null,run=null;
  for(var y3=0;y3<h;y3++){ if(row[y3]>thr){ if(!run)run={a:y3}; run.b=y3; } else { if(run){ if(!best||run.b-run.a>best.b-best.a)best=run; run=null; } } }
  if(run&&(!best||run.b-run.a>best.b-best.a))best=run;
  if(!best) return {found:false};
  var th=best.b-best.a+1;
  return {found:th>=6, top:best.a, bottom:best.b, frac:th/h, centerY:(best.a+best.b)/2/h };
}
function analyzeFrame(data){
  var w=data.w,h=data.h,g=gray(data);
  var st=stats(g);
  if(st.mean<48) return hint("dark","Too dark — move into better light");
  if(st.mean>220) return hint("bright","Too bright — reduce glare or move the light");
  if(st.sd<9) return hint("blank","Point the camera at your passport’s photo page");
  if(glare(g,w,h)>0.06) return hint("glare","Glare on the page — tilt it slightly away from the light");
  var sh=sharpness(g,w,h);
  if(sh<9) return hint("blurry","Hold steady — it’s blurry");
  var band=mrzBand(g,w,h);
  if(!band.found) return hint("nomrz","Fit the two lines of code at the bottom of the page into the frame");
  if(band.frac<0.045) return hint("far","Move closer — the code strip is too small to read");
  if(band.frac>0.22) return hint("close","A little further back");
  if(band.centerY<0.35) return hint("low","Move the passport down a little");
  if(band.top<2||band.bottom>h-2) return hint("cut","The code is cut off — show the whole bottom strip");
  if(sh<16) return hint("softish","Almost — hold still for a sharp shot");
  return { code:"ready", msg:"Hold still…", ok:true, ready:true, band:band };
}
function hint(code,msg){ return {code:code,msg:msg,ok:false,ready:false}; }

/* ---- OCR (lazy, offline) ---- */
var _worker=null,_loading=null,_base="ocr/";
function setBase(b){ _base=b; }
function loadWorker(onProgress){
  if(_worker) return Promise.resolve(_worker);
  if(_loading) return _loading;
  if(typeof Tesseract==="undefined") return Promise.reject(new Error("ocr-missing"));
  _loading=Tesseract.createWorker("mrzi",1,{
    workerPath:_base+"worker.min.js",
    corePath:_base,                     /* folder with tesseract-core-simd-lstm.* */
    langPath:_base,
    gzip:false, cacheMethod:"none",
    logger:function(m){ if(onProgress&&m.status) onProgress(m); }
  }).then(function(w){
    return w.setParameters({ tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<", tessedit_pageseg_mode:"6" }).then(function(){ _worker=w; return w; });
  });
  return _loading;
}
function canvasOf(src){
  if(src && src.getContext) return src;
  var c=document.createElement("canvas");
  if(src && src.width){ c.width=src.videoWidth||src.width; c.height=src.videoHeight||src.height; c.getContext("2d").drawImage(src,0,0,c.width,c.height); }
  return c;
}
/* crop to the bottom third (where the MRZ lives) and upscale for a cleaner read */
function mrzCanvas(cv,band){
  var w=cv.width,h=cv.height;
  var top=band? Math.max(0,band.top-h*0.02):h*0.62, bot=band? Math.min(h,band.bottom+h*0.02):h;
  var sh=bot-top; var scale=Math.min(3, 1000/Math.max(1,w));
  var out=document.createElement("canvas"); out.width=Math.round(w*scale); out.height=Math.round(sh*scale);
  var ctx=out.getContext("2d"); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
  ctx.drawImage(cv,0,top,w,sh,0,0,out.width,out.height);
  return out;
}
function bottomCanvas(cv,fromFrac){
  var w=cv.width,h=cv.height,top=Math.round(h*fromFrac),sh=h-top;
  var scale=Math.min(2.5, 1100/Math.max(1,w));
  var out=document.createElement("canvas"); out.width=Math.round(w*scale); out.height=Math.round(sh*scale);
  var ctx=out.getContext("2d"); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
  ctx.drawImage(cv,0,top,w,sh,0,0,out.width,out.height); return out;
}
function topCanvas(cv,toFrac){
  var w=cv.width,h=cv.height,sh=Math.round(h*toFrac);
  var scale=Math.min(2.5, 1100/Math.max(1,w));
  var out=document.createElement("canvas"); out.width=Math.round(w*scale); out.height=Math.round(sh*scale);
  var ctx=out.getContext("2d"); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality="high";
  ctx.drawImage(cv,0,0,w,sh,0,0,out.width,out.height); return out;
}
function scanImage(src,opts){
  opts=opts||{};
  var cv=canvasOf(src);
  return loadWorker(opts.onProgress).then(function(w){
    var band=opts.band;
    if(!band){ try{ var ctx=cv.getContext("2d"),id=ctx.getImageData(0,0,cv.width,cv.height); band=mrzBand(gray({w:cv.width,h:cv.height,px:id.data}),cv.width,cv.height); }catch(e){} }
    /* try a few crops, and if they don't fully validate, a few small
       rotations (handles a tilted photo). Keep the reading that passes the
       most check digits — composite included, so a coincidental single-field
       match can't win over a genuinely correct read. Stop as soon as one
       passes every check. */
    var crops=[];
    if(band&&band.found) crops.push(mrzCanvas(cv,band));
    crops.push(bottomCanvas(cv,0.62));
    if(!(band&&band.found)) crops.push(bottomCanvas(cv,0.45));
    var best=null,bestText="";
    /* DocScan's engine (ICAO-complete, checksum-guided correction, country
       tables, special codes) when present; Keyflow's own parser otherwise */
    var PARSER=(typeof root.DocScanMRZ!=="undefined" && root.DocScanMRZ.parse) ? root.DocScanMRZ : MRZ;
    function consider(text){ var r=PARSER.parse(text);
      if(r && (!best || r.checksPassed>best.checksPassed)){ best=r; bestText=text; } }
    function rot(canvas,deg){ if(!deg) return canvas; var rad=Math.abs(deg)*Math.PI/180, w=canvas.width,h=canvas.height;
      var co=Math.abs(Math.cos(rad)), si=Math.abs(Math.sin(rad));
      var W=Math.ceil(w*co+h*si), H=Math.ceil(w*si+h*co);
      var o=document.createElement("canvas"); o.width=W; o.height=H; var c=o.getContext("2d");
      c.fillStyle="#fff"; c.fillRect(0,0,W,H); c.translate(W/2,H/2); c.rotate(deg*Math.PI/180); c.drawImage(canvas,-w/2,-h/2); return o; }
    var jobs=crops.slice();
    /* deskew: rotate the WHOLE image a few degrees and re-crop, to recover a
       tilted phone photo */
    [-3,3,-6,6,-9,9].forEach(function(d){ jobs.push(bottomCanvas(rot(cv,d),0.5)); });
    /* orientation: only reached if nothing above validated — a photo taken
       sideways or upside down. Try the whole image at 90/180/270 and wider
       tilts, scanning top+bottom since the MRZ could be on any edge now. */
    var oriented=[];
    [90,180,270].forEach(function(d){ var r=rot(cv,d); oriented.push(bottomCanvas(r,0.5)); oriented.push(topCanvas(r,0.5)); });
    [15,-15,25,-25].forEach(function(d){ oriented.push(bottomCanvas(rot(cv,d),0.42)); });
    function step(i,list){
      if(i>=list.length) return null;
      return w.recognize(list[i]).then(function(res){
        consider(res.data.text);
        if(best && best.confident) return true;
        return step(i+1,list);
      });
    }
    return step(0,jobs).then(function(done){
      if(done || (best && best.valid)) return { mrz:best, text:bestText };
      return step(0,oriented).then(function(){ return { mrz:best, text:bestText }; });
    });
  });
}
function terminate(){ if(_worker){ try{_worker.terminate();}catch(e){} _worker=null; _loading=null; } }
var api={ analyzeFrame:analyzeFrame, scanImage:scanImage, loadWorker:loadWorker, setBase:setBase, terminate:terminate, _mrzBand:mrzBand, _gray:gray, _stats:stats };
if(typeof module!=="undefined"&&module.exports) module.exports=api; else root.KeyflowOCR=api;
})(typeof window!=="undefined"?window:globalThis);
