/* ================================================================
   MRZ — the two or three machine-readable lines at the foot of a
   passport or ID card. Parses TD3 (passport, 2×44), TD2 (2×36) and
   TD1 (3×30), checks every check digit, and uses the digits to
   repair the classic OCR confusions (O/0, I/1, S/5…) so a slightly
   misread scan still comes out right. Pure logic, no DOM.
   Spec: ICAO Doc 9303.
   ================================================================ */
(function(root){
"use strict";
var VAL={"<":0}; for(var i=0;i<10;i++) VAL[""+i]=i; for(var j=0;j<26;j++) VAL[String.fromCharCode(65+j)]=10+j;
var WEIGHTS=[7,3,1];
function cd(s){ var sum=0; for(var i=0;i<s.length;i++){ var c=s[i], v=VAL[c]; if(v===undefined) v=0; sum+=v*WEIGHTS[i%3]; } return sum%10; }
function cdChar(s){ return ""+cd(s); }
/* letter the digit was probably misread from, and vice-versa */
var D2A={"0":"O","1":"I","2":"Z","5":"S","8":"B","6":"G"};
var A2D={"O":"0","Q":"0","D":"0","I":"1","L":"1","Z":"2","S":"5","B":"8","G":"6","C":"0","U":"0"};
function toDigits(s){ return s.replace(/[A-Z]/g,function(c){ return A2D[c]||c; }); }
function toAlpha(s){ return s.replace(/[0-9]/g,function(c){ return D2A[c]||c; }); }
function clean(line,len){
  var s=String(line||"").toUpperCase().replace(/\s+/g,"").replace(/[^A-Z0-9<]/g,"");
  s=s.replace(/[«»]/g,"<");            /* guillemets sometimes stand in for < */
  if(len){ if(s.length>len) s=s.slice(0,len); while(s.length<len) s+="<"; }
  return s;
}
/* An alphanumeric field (e.g. a passport number, which may contain letters).
   If its check digit does not match, try flipping ambiguous characters
   (O<->0, I<->1, S<->5…) one or two at a time until the check passes — this
   repairs the usual OCR slips without inventing data. */
function flipChar(c){ if(A2D[c]!==undefined) return A2D[c]; if(D2A[c]!==undefined) return D2A[c]; return null; }
function fixField(field,check){
  if(cdChar(field)===check) return {v:field,ok:true,fixed:false};
  var amb=[]; for(var i=0;i<field.length;i++) if(flipChar(field[i])!==null) amb.push(i);
  /* single flip */
  for(var a=0;a<amb.length;a++){ var arr=field.split(""); arr[amb[a]]=flipChar(arr[amb[a]]); var c=arr.join("");
    if(cdChar(c)===check) return {v:c,ok:true,fixed:true}; }
  /* double flip */
  for(var x=0;x<amb.length;x++) for(var y=x+1;y<amb.length;y++){ var arr2=field.split("");
    arr2[amb[x]]=flipChar(arr2[amb[x]]); arr2[amb[y]]=flipChar(arr2[amb[y]]); var c2=arr2.join("");
    if(cdChar(c2)===check) return {v:c2,ok:true,fixed:true}; }
  return {v:field,ok:false,fixed:false};
}
function parseDate(s,kind){
  s=toDigits(s);
  if(!/^\d{6}$/.test(s)) return {raw:s,ok:false};
  var yy=+s.slice(0,2), mm=+s.slice(2,4), dd=+s.slice(4,6);
  if(mm<1||mm>12||dd<1||dd>31) return {raw:s,ok:false};
  var now=new Date(), cc=Math.floor(now.getFullYear()/100)*100, yr=cc+yy;
  if(kind==="birth" && yr>now.getFullYear()) yr-=100;            /* born last century */
  if(kind==="expiry" && yr<now.getFullYear()-15) yr+=100;        /* expiry in the future-ish */
  var iso=yr+"-"+("0"+mm).slice(-2)+"-"+("0"+dd).slice(-2);
  return {raw:s,ok:true,iso:iso,display:("0"+dd).slice(-2)+"/"+("0"+mm).slice(-2)+"/"+yr,year:yr,month:mm,day:dd};
}
function names(block){
  var parts=block.split("<<"); var sur=(parts[0]||"").replace(/</g," ").trim();
  var giv=(parts.slice(1).join("<<")||"").replace(/</g," ").replace(/\s+/g," ").trim();
  return {surname:sur,given:giv};
}
var MRZ_BUILTIN_COUNTRIES={"AFG": "Afghanistan", "ALB": "Albania", "DZA": "Algeria", "AND": "Andorra", "AGO": "Angola", "ARG": "Argentina", "ARM": "Armenia", "AUS": "Australia", "AUT": "Austria", "AZE": "Azerbaijan", "BHR": "Bahrain", "BGD": "Bangladesh", "BRB": "Barbados", "BLR": "Belarus", "BEL": "Belgium", "BLZ": "Belize", "BEN": "Benin", "BTN": "Bhutan", "BOL": "Bolivia", "BIH": "Bosnia and Herzegovina", "BWA": "Botswana", "BRA": "Brazil", "BRN": "Brunei", "BGR": "Bulgaria", "BFA": "Burkina Faso", "BDI": "Burundi", "KHM": "Cambodia", "CMR": "Cameroon", "CAN": "Canada", "CPV": "Cape Verde", "CAF": "Central African Republic", "TCD": "Chad", "CHL": "Chile", "CHN": "China", "COL": "Colombia", "COM": "Comoros", "COG": "Congo", "COD": "DR Congo", "CRI": "Costa Rica", "CIV": "Côte d'Ivoire", "HRV": "Croatia", "CUB": "Cuba", "CYP": "Cyprus", "CZE": "Czechia", "DNK": "Denmark", "DJI": "Djibouti", "DMA": "Dominica", "DOM": "Dominican Republic", "ECU": "Ecuador", "EGY": "Egypt", "SLV": "El Salvador", "GNQ": "Equatorial Guinea", "ERI": "Eritrea", "EST": "Estonia", "SWZ": "Eswatini", "ETH": "Ethiopia", "FJI": "Fiji", "FIN": "Finland", "FRA": "France", "GAB": "Gabon", "GMB": "Gambia", "GEO": "Georgia", "DEU": "Germany", "GHA": "Ghana", "GRC": "Greece", "GRD": "Grenada", "GTM": "Guatemala", "GIN": "Guinea", "GNB": "Guinea-Bissau", "GUY": "Guyana", "HTI": "Haiti", "HND": "Honduras", "HUN": "Hungary", "ISL": "Iceland", "IND": "India", "IDN": "Indonesia", "IRN": "Iran", "IRQ": "Iraq", "IRL": "Ireland", "ISR": "Israel", "ITA": "Italy", "JAM": "Jamaica", "JPN": "Japan", "JOR": "Jordan", "KAZ": "Kazakhstan", "KEN": "Kenya", "KIR": "Kiribati", "PRK": "North Korea", "KOR": "South Korea", "KWT": "Kuwait", "KGZ": "Kyrgyzstan", "LAO": "Laos", "LVA": "Latvia", "LBN": "Lebanon", "LSO": "Lesotho", "LBR": "Liberia", "LBY": "Libya", "LIE": "Liechtenstein", "LTU": "Lithuania", "LUX": "Luxembourg", "MDG": "Madagascar", "MWI": "Malawi", "MYS": "Malaysia", "MDV": "Maldives", "MLI": "Mali", "MLT": "Malta", "MHL": "Marshall Islands", "MRT": "Mauritania", "MUS": "Mauritius", "MEX": "Mexico", "FSM": "Micronesia", "MDA": "Moldova", "MCO": "Monaco", "MNG": "Mongolia", "MNE": "Montenegro", "MAR": "Morocco", "MOZ": "Mozambique", "MMR": "Myanmar", "NAM": "Namibia", "NRU": "Nauru", "NPL": "Nepal", "NLD": "Netherlands", "NZL": "New Zealand", "NIC": "Nicaragua", "NER": "Niger", "NGA": "Nigeria", "MKD": "North Macedonia", "NOR": "Norway", "OMN": "Oman", "PAK": "Pakistan", "PLW": "Palau", "PSE": "Palestine", "PAN": "Panama", "PNG": "Papua New Guinea", "PRY": "Paraguay", "PER": "Peru", "PHL": "Philippines", "POL": "Poland", "PRT": "Portugal", "QAT": "Qatar", "ROU": "Romania", "RUS": "Russia", "RWA": "Rwanda", "KNA": "Saint Kitts and Nevis", "LCA": "Saint Lucia", "VCT": "Saint Vincent", "WSM": "Samoa", "SMR": "San Marino", "STP": "São Tomé and Príncipe", "SAU": "Saudi Arabia", "SEN": "Senegal", "SRB": "Serbia", "SYC": "Seychelles", "SLE": "Sierra Leone", "SGP": "Singapore", "SVK": "Slovakia", "SVN": "Slovenia", "SLB": "Solomon Islands", "SOM": "Somalia", "ZAF": "South Africa", "SSD": "South Sudan", "ESP": "Spain", "LKA": "Sri Lanka", "SDN": "Sudan", "SUR": "Suriname", "SWE": "Sweden", "CHE": "Switzerland", "SYR": "Syria", "TWN": "Taiwan", "TJK": "Tajikistan", "TZA": "Tanzania", "THA": "Thailand", "TLS": "Timor-Leste", "TGO": "Togo", "TON": "Tonga", "TTO": "Trinidad and Tobago", "TUN": "Tunisia", "TUR": "Türkiye", "TKM": "Turkmenistan", "TUV": "Tuvalu", "UGA": "Uganda", "UKR": "Ukraine", "ARE": "United Arab Emirates", "GBR": "United Kingdom", "USA": "United States", "URY": "Uruguay", "UZB": "Uzbekistan", "VUT": "Vanuatu", "VAT": "Vatican City", "VEN": "Venezuela", "VNM": "Vietnam", "YEM": "Yemen", "ZMB": "Zambia", "ZWE": "Zimbabwe", "D": "Germany", "GBD": "British Overseas", "GBN": "British National", "GBO": "British Overseas Citizen", "GBP": "British Protected Person", "GBS": "British Subject", "UNO": "United Nations", "UNK": "Kosovo", "XXA": "Stateless", "XXB": "Refugee", "XXC": "Refugee (other)", "XXX": "Unspecified", "EUE": "European Union", "HKG": "Hong Kong", "MAC": "Macao", "RKS": "Kosovo"};
var CC2NAME=root.MRZ_COUNTRIES||MRZ_BUILTIN_COUNTRIES;
function countryName(code){ return CC2NAME[code]||code; }
function result(type,lines){
  return {type:type,lines:lines,fields:{},checks:{},valid:false,warnings:[]};
}
/* TD3 — passport: 2 lines of 44 */
function parseTD3(l1,l2){
  l1=clean(l1,44); l2=clean(l2,44);
  var r=result("TD3",[l1,l2]), F=r.fields, C=r.checks, W=r.warnings;
  F.documentCode=l1.slice(0,2).replace(/</g,"");
  F.issuingCountry=toAlpha(l1.slice(2,5));
  var nm=names(l1.slice(5)); F.surname=nm.surname; F.givenNames=nm.given;
  var num=l2.slice(0,9), numCd=l2[9];
  var nf=fixField(num,numCd); F.documentNumber=nf.v.replace(/<+$/,"").replace(/</g,""); C.documentNumber=nf.ok; if(nf.fixed) W.push("document number");
  F.nationality=toAlpha(l2.slice(10,13));
  var dob=parseDate(l2.slice(13,19),"birth"), dobCd=l2[19];
  F.dateOfBirth=dob.ok?dob.iso:null; F.dateOfBirthDisplay=dob.display||l2.slice(13,19); C.dateOfBirth=(cdChar(toDigits(l2.slice(13,19)))===dobCd);
  F.sex={M:"M",F:"F","<":"X"}[l2[20]]||"X";
  var exp=parseDate(l2.slice(21,27),"expiry"), expCd=l2[27];
  F.dateOfExpiry=exp.ok?exp.iso:null; F.dateOfExpiryDisplay=exp.display||l2.slice(21,27); C.dateOfExpiry=(cdChar(toDigits(l2.slice(21,27)))===expCd);
  var personal=l2.slice(28,42), perCd=l2[42];
  F.personalNumber=personal.replace(/<+$/,"").replace(/</g,"");
  C.personalNumber = perCd==="<"||perCd==="0" ? true : (cdChar(personal)===perCd);
  var composite=l2.slice(0,10)+l2.slice(13,20)+l2.slice(21,43), compCd=l2[43];
  C.composite=(cdChar(composite)===compCd);
  C.lineLength=(l1.length===44&&l2.length===44);
  finalize(r); return r;
}
/* TD1 — ID card: 3 lines of 30 */
function parseTD1(l1,l2,l3){
  l1=clean(l1,30); l2=clean(l2,30); l3=clean(l3,30);
  var r=result("TD1",[l1,l2,l3]), F=r.fields, C=r.checks, W=r.warnings;
  F.documentCode=l1.slice(0,2).replace(/</g,"");
  F.issuingCountry=toAlpha(l1.slice(2,5));
  var num=l1.slice(5,14), numCd=l1[14];
  var nf=fixField(num,numCd); F.documentNumber=nf.v.replace(/<+$/,"").replace(/</g,""); C.documentNumber=nf.ok; if(nf.fixed) W.push("document number");
  F.optional1=l1.slice(15,30).replace(/<+$/,"");
  var dob=parseDate(l2.slice(0,6),"birth");
  F.dateOfBirth=dob.ok?dob.iso:null; F.dateOfBirthDisplay=dob.display||l2.slice(0,6); C.dateOfBirth=(cdChar(toDigits(l2.slice(0,6)))===l2[6]);
  F.sex={M:"M",F:"F","<":"X"}[l2[7]]||"X";
  var exp=parseDate(l2.slice(8,14),"expiry");
  F.dateOfExpiry=exp.ok?exp.iso:null; F.dateOfExpiryDisplay=exp.display||l2.slice(8,14); C.dateOfExpiry=(cdChar(toDigits(l2.slice(8,14)))===l2[14]);
  F.nationality=toAlpha(l2.slice(15,18));
  var comp=l1.slice(5,30)+l2.slice(0,7)+l2.slice(8,15)+l2.slice(18,29), compCd=l2[29];
  C.composite=(cdChar(comp)===compCd);
  var nm=names(l3); F.surname=nm.surname; F.givenNames=nm.given;
  C.lineLength=(l1.length===30&&l2.length===30&&l3.length===30);
  finalize(r); return r;
}
/* TD2 — 2 lines of 36 */
function parseTD2(l1,l2){
  l1=clean(l1,36); l2=clean(l2,36);
  var r=result("TD2",[l1,l2]), F=r.fields, C=r.checks, W=r.warnings;
  F.documentCode=l1.slice(0,2).replace(/</g,""); F.issuingCountry=toAlpha(l1.slice(2,5));
  var nm=names(l1.slice(5)); F.surname=nm.surname; F.givenNames=nm.given;
  var nf=fixField(l2.slice(0,9),l2[9]); F.documentNumber=nf.v.replace(/<+$/,"").replace(/</g,""); C.documentNumber=nf.ok; if(nf.fixed) W.push("document number");
  F.nationality=toAlpha(l2.slice(10,13));
  var dob=parseDate(l2.slice(13,19),"birth"); F.dateOfBirth=dob.ok?dob.iso:null; F.dateOfBirthDisplay=dob.display||l2.slice(13,19); C.dateOfBirth=(cdChar(toDigits(l2.slice(13,19)))===l2[19]);
  F.sex={M:"M",F:"F","<":"X"}[l2[20]]||"X";
  var exp=parseDate(l2.slice(21,27),"expiry"); F.dateOfExpiry=exp.ok?exp.iso:null; F.dateOfExpiryDisplay=exp.display||l2.slice(21,27); C.dateOfExpiry=(cdChar(toDigits(l2.slice(21,27)))===l2[27]);
  var comp=l2.slice(0,10)+l2.slice(13,20)+l2.slice(21,35), compCd=l2[35];
  C.composite=(cdChar(comp)===compCd);
  C.lineLength=(l1.length===36&&l2.length===36);
  finalize(r); return r;
}
function finalize(r){
  r.fields.issuingCountryName=countryName(r.fields.issuingCountry);
  r.fields.nationalityName=countryName(r.fields.nationality);
  r.fields.fullName=[r.fields.givenNames,r.fields.surname].filter(Boolean).join(" ");
  var keys=["documentNumber","dateOfBirth","dateOfExpiry","composite"], pass=0, tot=0;
  keys.forEach(function(k){ if(k in r.checks){ tot++; if(r.checks[k]) pass++; } });
  r.checksPassed=pass; r.checksTotal=tot;
  r.valid = r.checks.documentNumber && r.checks.dateOfBirth && r.checks.dateOfExpiry;
  r.confident = r.valid && r.checks.composite!==false;
}
/* pick the MRZ lines out of whatever OCR returned (several lines of noise) */
function findLines(text){
  var raw=String(text||"").split(/\r?\n/).map(function(l){ return clean(l); }).filter(function(l){ return l.length>=28; });
  /* a real MRZ line is almost all A-Z0-9< and has some < fillers */
  var cand=raw.filter(function(l){ return /^[A-Z0-9<]+$/.test(l) && (l.indexOf("<")>=0 || /\d/.test(l)); });
  return cand;
}
function parse(text){
  var L=findLines(text);
  /* try each known layout on the best-matching run of lines */
  function pickLen(len){ return L.map(function(l){ return {l:l,d:Math.abs(l.length-len)}; }).filter(function(x){return x.d<=4;}).sort(function(a,b){return a.d-b.d;}).map(function(x){return x.l;}); }
  var best=null;
  function consider(r){ if(!r) return; if(!best || r.checksPassed>best.checksPassed || (r.checksPassed===best.checksPassed && r.type==="TD3")) best=r; }
  /* which line is the document line (starts P, I, A, C, V + filler/letters and
     carries the << name separator) decides the order; try both to be safe */
  function docFirst(a,b){ var aIsName=/^[PICAV]/.test(a)&&a.indexOf("<<")>=0; var bIsName=/^[PICAV]/.test(b)&&b.indexOf("<<")>=0; return bIsName&&!aIsName; }
  function pair(cands,fn){ if(cands.length<2) return; var a=cands[0],b=cands[1]; consider(fn(a,b)); consider(fn(b,a)); }
  pair(pickLen(44),parseTD3);
  pair(pickLen(36),parseTD2);
  var td1=pickLen(30); if(td1.length>=3){ consider(parseTD1(td1[0],td1[1],td1[2])); consider(parseTD1(td1[2],td1[1],td1[0])); consider(parseTD1(td1[0],td1[2],td1[1])); }
  /* last resort: the final long lines in both orders */
  if((!best||best.checksPassed<2) && L.length>=2){ consider(parseTD3(L[L.length-2],L[L.length-1])); consider(parseTD3(L[L.length-1],L[L.length-2]));
    if(L.length>=3){ consider(parseTD1(L[L.length-3],L[L.length-2],L[L.length-1])); } }
  return best;
}
var api={ parse:parse, parseTD3:parseTD3, parseTD1:parseTD1, parseTD2:parseTD2, cd:cd, clean:clean, findLines:findLines };
if(typeof module!=="undefined"&&module.exports) module.exports=api; else root.MRZ=api;
})(typeof window!=="undefined"?window:globalThis);
