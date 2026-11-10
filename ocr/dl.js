/* ================================================================
   Driving licence / ID barcode (AAMVA, PDF417) — the 2D barcode on
   the back of US & Canadian licences and many ID cards. Decoded with
   ZXing (bundled), then the AAMVA element IDs are mapped to fields.
   Pure logic + a thin ZXing wrapper; no network.
   ================================================================ */
(function(root){
"use strict";
var AAMVA={
  DCS:"lastName", DAB:"lastName", DCT:"givenNames", DAC:"firstName", DAD:"middleName",
  DAQ:"licenceNumber", DBB:"dob", DBA:"expiry", DBD:"issued", DBC:"sex",
  DAG:"addressStreet", DAH:"addressStreet2", DAI:"addressCity", DAJ:"addressState", DAK:"addressPostal",
  DCG:"country", DCF:"documentDiscriminator", DAU:"height", DAY:"eyeColor", DAZ:"hairColor",
  DCA:"vehicleClass", DCB:"restrictions", DCD:"endorsements", DDE:"familyNameTruncation",
  DCH:"federalCommercial", DDA:"complianceType", DDB:"revisionDate", DCK:"inventoryControl",
  DCU:"nameSuffix", DAW:"weight", DCL:"race"
};
function parseDate(v,country){
  v=String(v||"").trim(); if(!/^\d{8}$/.test(v)) return {raw:v};
  /* US = MMDDYYYY, Canada = YYYYMMDD. Decide by which makes a valid date. */
  var a={y:+v.slice(4),m:+v.slice(0,2),d:+v.slice(2,4)};   /* MMDDYYYY */
  var b={y:+v.slice(0,4),m:+v.slice(4,6),d:+v.slice(6,8)}; /* YYYYMMDD */
  function good(x){ return x.m>=1&&x.m<=12&&x.d>=1&&x.d<=31&&x.y>=1900&&x.y<=2100; }
  var pick = (country==="CAN")? (good(b)?b:a) : (good(a)?a:b);
  if(!good(pick)) return {raw:v};
  var iso=pick.y+"-"+("0"+pick.m).slice(-2)+"-"+("0"+pick.d).slice(-2);
  return {raw:v,iso:iso,display:("0"+pick.d).slice(-2)+"/"+("0"+pick.m).slice(-2)+"/"+pick.y};
}
function parseAAMVA(text){
  text=String(text||"");
  if(text.indexOf("ANSI ")<0 && text.indexOf("AAMVA")<0 && text.indexOf("DAQ")<0) return null;
  var out={ raw:text, fields:{}, valid:false, type:"DL" };
  /* Elements are 3-letter IDs + value. They are mostly one per line, but
     the first element (DAQ) is glued to the header line, so match each known
     code and take its value up to the next known code or line break. */
  var codes=Object.keys(AAMVA), set={}; codes.forEach(function(c){ set[c]=1; });
  var re=new RegExp("("+codes.join("|")+")([\\s\\S]*?)(?=("+codes.join("|")+")|[\\r\\n]|$)","g");
  var m, hits=0;
  while((m=re.exec(text))){ var id=m[1], val=(m[2]||"").trim();
    if(val && out.fields[AAMVA[id]]===undefined){ out.fields[AAMVA[id]]=val; hits++; } }
  if(hits<3) return null;
  var f=out.fields, country=f.country||"USA";
  if(f.dob){ var d=parseDate(f.dob,country); f.dobDisplay=d.display; f.dobISO=d.iso; }
  if(f.expiry){ var e=parseDate(f.expiry,country); f.expiryDisplay=e.display; f.expiryISO=e.iso; }
  if(f.issued){ var s=parseDate(f.issued,country); f.issuedDisplay=s.display; f.issuedISO=s.iso; }
  f.sex={1:"Male",2:"Female","M":"Male","F":"Female"}[f.sex]||f.sex;
  var given=[f.firstName,f.givenNames,f.middleName].filter(Boolean).join(" ").replace(/\s+/g," ").replace(/,.*/,"").trim();
  f.fullName=[given,f.lastName].filter(Boolean).join(" ").trim();
  var addr=[f.addressStreet,f.addressCity,f.addressState,f.addressPostal].filter(Boolean).join(", ").replace(/\s+/g," ");
  f.address=addr;
  out.valid = !!(f.licenceNumber && (f.fullName||f.lastName));
  out.confident = !!(f.licenceNumber && f.dob && f.expiry);
  return out;
}
/* ZXing decode from a canvas; tries a few scales/rotations */
function decodeBarcode(canvas){
  if(typeof ZXing==="undefined") return null;
  var tries=[canvas];
  function lum(cv){ var w=cv.width,h=cv.height,id=cv.getContext("2d").getImageData(0,0,w,h).data, a=new Uint8ClampedArray(w*h);
    for(var i=0,j=0;i<id.length;i+=4,j++) a[j]=(id[i]*0.299+id[i+1]*0.587+id[i+2]*0.114)|0; return {a:a,w:w,h:h}; }
  function rot(cv,deg){ if(!deg) return cv; var rad=deg*Math.PI/180, w=cv.width,h=cv.height,co=Math.abs(Math.cos(rad)),si=Math.abs(Math.sin(rad));
    var W=Math.ceil(w*co+h*si),H=Math.ceil(w*si+h*co),o=document.createElement("canvas"); o.width=W;o.height=H; var c=o.getContext("2d");
    c.fillStyle="#fff";c.fillRect(0,0,W,H);c.translate(W/2,H/2);c.rotate(rad);c.drawImage(cv,-w/2,-h/2); return o; }
  [90,270,5,-5,180].forEach(function(d){ tries.push(rot(canvas,d)); });
  for(var t=0;t<tries.length;t++){
    try{
      var L=lum(tries[t]);
      var src=new ZXing.RGBLuminanceSource(L.a,L.w,L.h);
      var bmp=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));
      var reader=new ZXing.PDF417Reader();
      var hints=new Map(); hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
      var res=reader.decode(bmp,hints);
      if(res && res.getText()){ var p=parseAAMVA(res.getText()); if(p) return p; }
    }catch(e){}
  }
  return null;
}
var api={ parseAAMVA:parseAAMVA, decodeBarcode:decodeBarcode };
if(typeof module!=="undefined"&&module.exports) module.exports=api; else root.KeyflowDL=api;
})(typeof window!=="undefined"?window:globalThis);
