/* Keyflow — credit/debit card front reader.
   Cards carry no MRZ and no barcode, so this is pure OCR of the printed
   face: the PAN (self-checked with the card's own Luhn digit), expiry and
   cardholder. All on-device; the image is kept encrypted in the entry like
   passports and licences. */
(function(g){
  "use strict";

  // ---- Luhn: every real card number satisfies this. Our self-check. ----
  function luhn(num){
    var s=0, alt=false;
    for(var i=num.length-1;i>=0;i--){
      var d=num.charCodeAt(i)-48; if(d<0||d>9) return false;
      if(alt){ d*=2; if(d>9) d-=9; }
      s+=d; alt=!alt;
    }
    return num.length>0 && s%10===0;
  }

  // ---- network by IIN/length (ranges per ISO/IEC 7812 + issuer tables) ----
  function network(n){
    if(/^4\d{12}(\d{3})?(\d)?$/.test(n)) return "Visa";
    if(/^3[47]\d{13}$/.test(n)) return "American Express";
    if(/^(5[1-5]\d{14}|222[1-9]\d{12}|22[3-9]\d{13}|2[3-6]\d{14}|27[01]\d{13}|2720\d{12})$/.test(n)) return "Mastercard";
    if(/^(6011\d{12}|65\d{14}|64[4-9]\d{13}|622(1[2-9][6-9]|[2-8]\d{2}|9([01]\d|2[0-5]))\d{10})$/.test(n)) return "Discover";
    if(/^3(0[0-5]|[68]\d)\d{11}$/.test(n)) return "Diners Club";
    if(/^35(2[89]|[3-8]\d)\d{12}$/.test(n)) return "JCB";
    if(/^(2200|2204)\d{12}$/.test(n)) return "Mir";
    if(/^62\d{14,17}$/.test(n)) return "UnionPay";
    return null;
  }
  function spaced(n){
    if(n.length===15) return n.slice(0,4)+" "+n.slice(4,10)+" "+n.slice(10);
    var out=[]; for(var i=0;i<n.length;i+=4) out.push(n.slice(i,i+4));
    return out.join(" ");
  }
  function validLen(n){
    var nt=network(n);
    if(nt==="American Express"||nt==="Diners Club") return n.length===15||n.length===14;
    if(nt==="UnionPay") return n.length>=16&&n.length<=19;
    return n.length===16;
  }

  // Common OCR confusions on a card face (printed, not OCR-B, so looser).
  var DIG = {O:"0",o:"0",Q:"0",D:"0",I:"1",l:"1",i:"1",L:"1","|":"1",Z:"2",z:"2",
             E:"3",A:"4",S:"5",s:"5",G:"6",b:"6",T:"7",B:"8",g:"9",q:"9"};
  function toDigits(s){ var o=""; for(var i=0;i<s.length;i++){ var c=s[i]; o+= (c>="0"&&c<="9")?c:(DIG[c]||""); } return o; }

  // Pull candidate PANs from a blob of OCR text, Luhn-filter, rank.
  function findPANs(text){
    var cands={}, order=[];
    var lines=text.split(/[\n\r]+/);
    for(var li=0; li<lines.length; li++){
      var ln=lines[li];
      var joined = ln.replace(/[ \-  ]+/g,"");
      pushRun(toDigits(joined));
      var m, re=/[0-9OoQDIliLZzEASsGbTBgq|]{12,25}/g;
      while((m=re.exec(ln))){ pushRun(toDigits(m[0])); }
    }
    function pushRun(d){
      if(d.length<13) return;
      [16,15,19,18,17,14].forEach(function(L){
        for(var i=0;i+L<=d.length;i++){
          var sub=d.slice(i,i+L);
          if(luhn(sub) && network(sub) && validLen(sub)){
            if(!(sub in cands)){ cands[sub]=0; order.push(sub); }
            cands[sub]++;
          }
        }
      });
    }
    order.sort(function(a,b){
      var s=(cands[b]-cands[a]); if(s) return s;
      return (a.length===16?-1:0)-(b.length===16?-1:0);
    });
    return order;
  }

  // A printed expiry is tiny, so OCR often bleeds the month's 0 into a 9 or Q
  // and drops the slash. Repair to a real 1–12 month the same way Luhn fixes
  // the PAN: only accept a candidate that lands in range.
  function fixMonth(s){
    var d=toDigits(s);
    if(d.length>2) d=d.slice(-2);
    if(d.length===1) d="0"+d;
    if(d.length!==2) return null;
    var cands=[d];
    if(d.indexOf("9")>=0) cands.push(d.replace(/9/g,"0")); // 0↔9 bleed
    for(var i=0;i<cands.length;i++){ var mi=parseInt(cands[i],10); if(mi>=1&&mi<=12) return ("0"+mi).slice(-2); }
    return null;
  }
  function fixYear(s){
    var d=toDigits(s); if(d.length>=4) d=d.slice(0,4); else if(d.length>=2) d=d.slice(0,2); else return null;
    var yr = d.length===2 ? 2000+parseInt(d,10) : parseInt(d,10);
    return (yr>=2000&&yr<=2099)?yr:null;
  }
  function findExpiry(text){
    var best=null, bestScore=-1;
    function take(mmRaw,yyRaw,base){
      var mm=fixMonth(mmRaw), yr=fixYear(yyRaw);
      if(!mm||!yr) return;
      var sc=base+((yr>=2024&&yr<=2036)?1:0);
      if(sc>bestScore){ bestScore=sc; best={mm:mm, yyyy:yr, raw:mm+"/"+String(yr).slice(-2)}; }
    }
    var TOK="[0-9OoIlQDZzSsEAGbTBgq|]";
    // 1) anchored to a validity keyword (slash optional, OCR chars allowed)
    var kw=new RegExp("(valid\\s*thru|valid|thru|expires?|good\\s*thru|exp)\\W{0,4}("+TOK+"{1,3})\\s*[\\/\\-\\. ]?\\s*("+TOK+"{2,4})","gi"), m;
    while((m=kw.exec(text))) take(m[2],m[3],3);
    // 2) any MM/YY-ish pair with a real separator
    var any=new RegExp("\\b("+TOK+"{1,2})\\s*[\\/\\-\\.]\\s*(\\d{2}|\\d{4})\\b","g");
    while((m=any.exec(text))) take(m[1],m[2],1);
    return best;
  }

  function findName(text){
    var lines=text.split(/[\n\r]+/), best=null;
    var bad=/VALID|THRU|EXPIRE|GOOD|MONTH|YEAR|BANK|CARD|MEMBER|SINCE|DEBIT|CREDIT|PLATINUM|GOLD|CLASSIC|BUSINESS|WORLD|SIGNATURE|VISA|MASTER|AMERICAN|EXPRESS|DISCOVER|UNION|CUSTOMER/;
    for(var i=0;i<lines.length;i++){
      var s=lines[i].trim().replace(/\s+/g," ");
      if(!/^[A-Z][A-Z .'-]{4,30}$/.test(s)) continue;
      var words=s.split(" ").filter(function(w){return w.length>1;});
      if(words.length<2||words.length>4) continue;
      if(bad.test(s)) continue;
      var sc = i + words.length;
      if(!best || sc>best.sc) best={name:s, sc:sc};
    }
    return best?best.name:null;
  }

  function parse(text){
    var pans=findPANs(text);
    var pan=pans[0]||null;
    var exp=findExpiry(text);
    var name=findName(text);
    var problems=[];
    if(!pan) problems.push("card number not found");
    if(!exp) problems.push("expiry not found");
    if(!name) problems.push("cardholder name not found");
    return {
      ok: !!pan,
      number: pan,
      numberSpaced: pan?spaced(pan):null,
      luhnOk: pan?luhn(pan):false,
      network: pan?network(pan):null,
      candidates: pans.slice(0,4),
      expiry: exp?exp.raw:null,
      expiryMonth: exp?exp.mm:null,
      expiryYear: exp?exp.yyyy:null,
      name: name,
      problems: problems
    };
  }

  // =================================================================
  //  Live-frame guidance + offline OCR for the card face.
  //  No MRZ band and no barcode here, so the frame check only judges
  //  light / focus / fill, and the read is a general-English OCR pass
  //  whose output goes through parse() above — the Luhn digit is what
  //  tells us we actually got the number right.
  // =================================================================
  function grayStats(fd){ // fd={w,h,px}
    var px=fd.px,n=fd.w*fd.h,sum=0,i,j,g=new Float32Array(n);
    for(i=0,j=0;i<px.length;i+=4,j++){ var v=0.299*px[i]+0.587*px[i+1]+0.114*px[i+2]; g[j]=v; sum+=v; }
    var mean=sum/n, vs=0; for(i=0;i<n;i++){ var d=g[i]-mean; vs+=d*d; }
    // sharpness: mean |Laplacian|
    var w=fd.w,h=fd.h,s=0,c=0;
    for(var y=1;y<h-1;y+=2) for(var x=1;x<w-1;x+=2){ var k=y*w+x; s+=Math.abs(4*g[k]-g[k-1]-g[k+1]-g[k-w]-g[k+w]); c++; }
    return { mean:mean, sd:Math.sqrt(vs/n), sharp:c?s/c:0 };
  }
  function analyzeFrame(fd){
    var st=grayStats(fd);
    if(st.mean<46) return {code:"dark",msg:"Too dark — move into better light",ok:false,ready:false};
    if(st.mean>224) return {code:"bright",msg:"Too bright — tilt away from the glare",ok:false,ready:false};
    if(st.sd<12) return {code:"blank",msg:"Fit the front of the card into the frame",ok:false,ready:false};
    if(st.sharp<8) return {code:"blurry",msg:"Hold steady — it’s blurry",ok:false,ready:false};
    if(st.sharp<14) return {code:"softish",msg:"Almost — hold still for a sharp shot",ok:false,ready:false};
    return {code:"ready",msg:"Hold still…",ok:true,ready:true};
  }

  // ---- OCR worker (general English; card fonts aren't OCR-B) ----
  var _w=null,_load=null,_base="ocr/";
  function setBase(b){ _base=b; }
  function loadWorker(onP){
    if(_w) return Promise.resolve(_w);
    if(_load) return _load;
    if(typeof Tesseract==="undefined") return Promise.reject(new Error("ocr-missing"));
    _load=Tesseract.createWorker("eng",1,{
      workerPath:_base+"worker.min.js", corePath:_base, langPath:_base,
      gzip:false, cacheMethod:"none",
      logger:function(m){ if(onP&&m.status) onP(m); }
    }).then(function(w){
      return w.setParameters({
        tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 /-.'",
        tessedit_pageseg_mode:"6", preserve_interword_spaces:"1"
      }).then(function(){ _w=w; return w; });
    });
    return _load;
  }
  function upscale(cv,long){
    var w=cv.width,h=cv.height,scale=Math.min(3,(long||1400)/Math.max(1,w));
    var o=document.createElement("canvas"); o.width=Math.round(w*scale); o.height=Math.round(h*scale);
    var c=o.getContext("2d"); c.imageSmoothingEnabled=true; c.imageSmoothingQuality="high";
    c.drawImage(cv,0,0,o.width,o.height); return o;
  }
  function rot(cv,deg){ if(!deg) return cv; var rad=Math.abs(deg)*Math.PI/180,w=cv.width,h=cv.height;
    var co=Math.abs(Math.cos(rad)),si=Math.abs(Math.sin(rad));
    var W=Math.ceil(w*co+h*si),H=Math.ceil(w*si+h*co);
    var o=document.createElement("canvas"); o.width=W; o.height=H; var c=o.getContext("2d");
    c.fillStyle="#fff"; c.fillRect(0,0,W,H); c.translate(W/2,H/2); c.rotate(deg*Math.PI/180); c.drawImage(cv,-w/2,-h/2); return o; }
  function canvasOf(src){ if(src&&src.getContext) return src;
    var c=document.createElement("canvas"); if(src&&src.width){ c.width=src.videoWidth||src.width; c.height=src.videoHeight||src.height; c.getContext("2d").drawImage(src,0,0,c.width,c.height); } return c; }

  function scan(src,opts){
    opts=opts||{}; var cv=canvasOf(src);
    return loadWorker(opts.onProgress).then(function(w){
      var best=null,bestText="";
      function consider(text){
        var r=parse(text);
        // score: a Luhn-valid networked number is the real win; then how
        // many of the three fields came through.
        r._score=(r.number?3:0)+(r.expiry?1:0)+(r.name?1:0);
        if(!best || r._score>best._score){ best=r; bestText=text; }
      }
      // upright first, a couple of scales and small deskews
      var up=[ upscale(cv,1400), upscale(cv,1000) ];
      [-3,3,-6,6].forEach(function(d){ up.push(upscale(rot(cv,d),1300)); });
      // only if nothing read: the card was shot sideways / upside-down
      var ori=[]; [90,270,180].forEach(function(d){ ori.push(upscale(rot(cv,d),1300)); });
      function step(i,list){
        if(i>=list.length) return Promise.resolve();
        return w.recognize(list[i]).then(function(res){
          consider(res.data.text);
          if(best && best.number && (best.expiry||best.name)) return true; // confident enough
          return step(i+1,list);
        });
      }
      return step(0,up).then(function(done){
        if(done || (best && best.number)) return { card:best, text:bestText };
        return step(0,ori).then(function(){ return { card:best, text:bestText }; });
      });
    });
  }
  function terminate(){ if(_w){ try{_w.terminate();}catch(e){} _w=null; _load=null; } }

  g.KFCard = { parse:parse, luhn:luhn, network:network, spaced:spaced, findPANs:findPANs,
               analyzeFrame:analyzeFrame, scan:scan, loadWorker:loadWorker, setBase:setBase, terminate:terminate };
})(typeof window!=="undefined"?window:globalThis);
