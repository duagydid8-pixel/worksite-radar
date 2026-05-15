void function(){

window.fetchElcdList=async function(startDate,endDate,grndsCd,osrccSnStr){
  if(!startDate||!endDate||!grndsCd||!osrccSnStr)
    return JSON.stringify({error:"fetchElcdList('20260514','20260515','공사코드','osrccSnStr')"});
  window.__elcd_rows=[];
  var pageNo=1,recordCount=500,totalCount=Infinity;
  while(window.__elcd_rows.length<totalCount){
    var body={
      lbrYmdBgng:startDate.replace(/-/g,""),lbrYmdEnd:endDate.replace(/-/g,""),
      lbrYm:"",grndsCd:grndsCd,conm:"",margNo:"",autoTot:1,birthday:"",bldrYn:"Y",
      cardIssuHstryYn:"",custNm:"",ctpcTelno:"",directYn:null,frstWdaMh:"",
      grndsCdObj:{grndsCd:grndsCd},noNameYn:"N",ntnCd:"",ocptSeCd:"",
      osrccSnStr:osrccSnStr,pageNo:pageNo,pastFlag:"N",prcsSeCd:"R1",
      recordCount:recordCount,rrno:"",tagCd:"",targetListBtnId:"",trmnlNo:""
    };
    try{
      var resp=await fetch("https://eum.cw.or.kr/api/selectListElcdUseDsctn",{
        method:"POST",headers:{"Content-Type":"application/json"},
        credentials:"include",body:JSON.stringify(body)
      });
      var data=await resp.json();
      if(pageNo===1){
        totalCount=data.totalCount||data.totalCnt||data.cnt||9999;
        console.log("총 건수:"+totalCount+" 응답키:"+Object.keys(data));
        var list0=data.list||data.data||[];
        if(list0[0])console.log("항목키:"+Object.keys(list0[0]));
      }
      var list=data.list||data.data||[];
      if(!list.length)break;
      window.__elcd_rows=window.__elcd_rows.concat(list);
      console.log("p"+pageNo+": "+list.length+"건 / 누적:"+window.__elcd_rows.length+"/"+totalCount);
      if(list.length<recordCount)break;
      pageNo++;
    }catch(e){return JSON.stringify({error:e.message,collected:window.__elcd_rows.length})}
  }
  return JSON.stringify({total:window.__elcd_rows.length});
};

window.parseElcd=function(){
  var rows=window.__elcd_rows;
  if(!rows||!rows.length)return JSON.stringify({error:"먼저 fetchElcdList() 실행"});
  window.__elcd_parsed=rows.map(function(r){
    return{
      name:      r.custNm   ||r.wkrNm   ||r.nm      ||"",
      birthday:  r.birthday ||r.brdt     ||r.birthYmd||"",
      tagDate:   r.tagYmd   ||r.lbrYmd   ||r.wkYmd   ||"",
      tagType:   r.tagSeNm  ||r.inOutNm  ||r.tagNm   ||r.tagSeCd||"",
      inTime:    r.workStrTm||r.inTm     ||r.strTm   ||"",
      outTime:   r.workEndTm||r.outTm    ||r.endTm   ||"",
      authMethod:r.authMtdNm||r.tagMtdNm ||r.tagMtdCd||""
    };
  });
  var s=window.__elcd_parsed[0];
  if(Object.values(s).every(function(v){return!v;}))
    console.warn("필드 매핑 실패 — 원본 키 확인:",Object.keys(rows[0]));
  return JSON.stringify({total:window.__elcd_parsed.length,sample:s});
};

// PMIS 명단과 전자카드 타각 여부 대조
// pmisJson: exportForElcdCompare() 로 복사한 JSON 문자열
window.compareWithPmis=function(pmisJson){
  var elcd=window.__elcd_parsed;
  if(!elcd)return JSON.stringify({error:"먼저 parseElcd() 실행"});
  var pmis;
  try{pmis=typeof pmisJson==="string"?JSON.parse(pmisJson):pmisJson;}
  catch(e){return JSON.stringify({error:"PMIS 데이터 파싱 실패:"+e.message});}
  // 타각자 Set: 이름+생년월일
  var tapped=new Set();
  elcd.forEach(function(r){tapped.add(r.name+"|"+r.birthday);});
  window.__compare_result=pmis.map(function(p){
    var key=(p.name||"")+("|")+(p.birth||p.birthday||"");
    return Object.assign({},p,{타각여부:tapped.has(key)?"Y":"N"});
  });
  var y=window.__compare_result.filter(function(r){return r.타각여부==="Y";}).length;
  return JSON.stringify({total:window.__compare_result.length,타각:y,미타각:window.__compare_result.length-y});
};

window.downloadElcdCsv=function(filename){
  var rows=window.__elcd_parsed;
  if(!rows)return JSON.stringify({error:"먼저 parseElcd() 실행"});
  var ko=["이름","생년월일","태그일자","태그내역","출근시간","퇴근시간","인증방식"];
  var en=["name","birthday","tagDate","tagType","inTime","outTime","authMethod"];
  var lines=[ko.join(",")];
  rows.forEach(function(r){lines.push(en.map(function(h){return(r[h]||"").replace(/,/g," ");}).join(","));});
  window.__elcd_csv=lines.join("\n");
  filename=filename||("elcd_"+(new Date().toISOString().slice(0,10))+".csv");
  var blob=new Blob(["﻿"+window.__elcd_csv],{type:"text/csv;charset=utf-8"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},5000);
  return JSON.stringify({ok:true,filename:filename,rows:rows.length});
};

window.downloadCompareCsv=function(filename){
  var rows=window.__compare_result;
  if(!rows)return JSON.stringify({error:"먼저 compareWithPmis() 실행"});
  var keys=Object.keys(rows[0]);
  var lines=[keys.join(",")];
  rows.forEach(function(r){lines.push(keys.map(function(k){return(r[k]||"").replace(/,/g," ");}).join(","));});
  filename=filename||("compare_"+(new Date().toISOString().slice(0,10))+".csv");
  var blob=new Blob(["﻿"+lines.join("\n")],{type:"text/csv;charset=utf-8"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},5000);
  return JSON.stringify({ok:true,filename:filename,rows:rows.length});
};

(function(){
  var help=[
    "OK elcd v1 ──────────────────────────────────────────",
    "[ eum.cw.or.kr 에서 실행 ]",
    "1. await fetchElcdList('20260514','20260515','공사코드','osrccSnStr')",
    "   전자카드 사용내역 전체 수집",
    "2. parseElcd()              이름/생년월일/태그일자/출퇴근/인증방식 정리",
    "3. downloadElcdCsv()        전자카드 CSV 다운로드",
    "── PMIS 대조 ────────────────────────────────────────",
    "4. compareWithPmis(JSON)    PMIS 명단 붙여넣기 → 타각여부(Y/N) 대조",
    "   JSON은 PMIS에서 exportForElcdCompare() 로 복사",
    "5. downloadCompareCsv()     대조 결과 CSV 다운로드",
    "────────────────────────────────────────────────────"
  ].join("\n");
  console.log(help);
  navigator.clipboard.writeText(help).then(
    function(){console.log("클립보드에 복사됨");},
    function(){console.log("클립보드 복사 실패");}
  );
})();

}()
