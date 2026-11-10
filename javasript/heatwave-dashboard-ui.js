/**
 * SmartSafety dashboard UI 20261013.2
 * Additive integration. The original app owns networking and the Kakao map.
 * No guessed endpoints, global-array probing, AJAX interception or automatic data fabrication.
 * Public bridge: connect(adapter), update(snapshot), selectField(id), attachMap(map), reportError(message).
 */
(function (window, document) {
    'use strict';
    if (window.HeatwaveDashboardUI) return;
    var M=window.HeatwaveDashboardModel;
    if (!M) throw new Error('Load heatwave-dashboard-model.js before the UI script.');
    var state={season:'def',scope:'hq',viewKind:'admin',time:'now',snapshot:null,selectedId:'',adapter:{},map:null,modal:null,modalRows:[],modalTitle:'',filter:null,alertType:null,alertFieldId:''};
    var initialized=false, resizeObserver=null, legacyObserver=null, labelObserver=null, frame=0, lastFocus=null, legacyLastFocus=null;
    var cleanup=[], listenerBindings=[], previousOverflow='', version='20261013.2';
    var mapWidth=0,mapHeight=0;
    var seasonNames={def:'상시',summer:'혹서기',winter:'혹한기'};
    var iconNames=['heat','cold','rain','wind','sea','typhoon','snow','dry','dust','other','unknown','clear','air-good','air-normal','air-bad','air-verybad','air-unknown'];
    var suppliedIconNames={heat:'heatwave',cold:'cold-wave',rain:'heavy-rain',wind:'strong-wind',sea:'high-waves',snow:'heavy-snow',dry:'dryness',unknown:'status-unknown',clear:'status-normal'};
    var qualityNames={ok:'',stale:'지연 자료',error:'조회 오류',missing:'미수신',unknown:'품질 미확인'};
    function $(id){return document.getElementById(id);}
    function el(tag,cls,value){var n=document.createElement(tag);if(cls)n.className=cls;if(value!=null)n.textContent=String(value);return n;}
    function assetIcon(asset,cls,name){
        // 바깥 요소는 helper의 SVG→PNG→오류문자 교체 후에도 기존 class/data 계약을 유지한다.
        var host=el('span','hwx-icon '+(cls||'')),icons=window.WeatherUiIcons;
        host.dataset.icon=name||asset;host.setAttribute('aria-hidden','true');
        host.appendChild(icons && typeof icons.create==='function'?icons.create(asset,{size:64}):el('span','wx-icon-fallback','아이콘 오류'));
        return host;
    }
    function initSummaryIcons(){
        if(!window.WeatherUiIcons || typeof window.WeatherUiIcons.create!=='function')return;
        document.querySelectorAll('img[data-weather-summary-icon]').forEach(function(image){
            var name=image.dataset.weatherSummaryIcon;if(['site-total','site-advisory','site-risk'].indexOf(name)<0)return;
            var icon=assetIcon(name,'hwx-stat-icon');Object.keys(image.dataset).forEach(function(key){icon.dataset[key]=image.dataset[key];});image.replaceWith(icon);
        });
    }
    // 제공된 개별 자산만 img로 연결하고, 제공 목록 밖의 항목은 기존 sprite를 유지한다.
    function svgIcon(name,cls){
        if(iconNames.indexOf(name)<0)name='other';
        if(suppliedIconNames[name])return assetIcon(suppliedIconNames[name],cls,name);
        var boot=$('hwBoot'),data=boot?boot.dataset:{},ns='http://www.w3.org/2000/svg';
        var base=data.preview==='true'?'':data.iconUrl||(data.context||'')+'/res/image/heatwave/dashboard-icons.svg?v=20260929.7';
        var svg=document.createElementNS(ns,'svg'),use=document.createElementNS(ns,'use');
        svg.setAttribute('viewBox','0 0 64 64');svg.setAttribute('class','hwx-icon '+(cls||''));
        svg.setAttribute('data-icon',name);svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
        use.setAttribute('href',base+'#hw-icon-'+name);svg.appendChild(use);return svg;
    }
    function unknownAlert(message){
        // 계절과 무관하게 미확인은 회색 데이터 그림이다. 폭염/한파 발효 그림을 재사용하지 않는다.
        var row=el('div','hwx-unknown-alert hwx-icon-message'),icon=svgIcon('unknown','hwx-alert-symbol');
        icon.dataset.state='unknown';return append(row,icon,el('span','',message));
    }
    function alertUnavailable(field){
        if(field.alertsQuality==='loading')return '현재 발효 특보를 조회하고 있습니다.';
        if(field.alertsQuality==='scheduled')return timeText(field.alertsValidAt)+' 발효예정 자료입니다. 현재 발효 상태는 확인 중입니다.';
        if(field.alertsReason==='COORDINATE_SDK_NOT_READY')return '지도 서비스 연결을 기다리고 있습니다.';
        if(field.alertsReason==='INVALID_FIELD_COORDINATES')return '현장 좌표를 확인해 주세요.';
        if(/^COORDINATE_(?:SDK|REGION)/.test(field.alertsReason||'') && field.alertsReason!=='COORDINATE_REGION_PENDING')return '현장 좌표의 행정구역을 확인하지 못했습니다. 다시 조회합니다.';
        if(field.alertsQuality==='mapping_required')return '현장 특보구역 연결이 필요합니다.';
        if(field.alertsQuality==='stale')return '특보정보 갱신이 지연되고 있습니다.';
        return '특보정보를 가져오지 못했습니다. 다시 조회합니다.';
    }
    function daewooAlertMessage(status,title,description){
        // 시안처럼 큰 상태 그림 + 제목 + 짧은 설명으로 표시한다. 체크는 확인된 무특보에만 사용한다.
        var row=el('div','hwx-status-message'),copy=el('div','hwx-status-copy');
        var icon=assetIcon(status==='clear'?'status-normal':'status-unknown','hwx-status-icon',status==='pending'?'clock':status);
        row.dataset.state=status;
        append(copy,el('strong','',title),el('span','',description));return append(row,icon,copy);
    }
    function daewooUnavailableMessage(field){
        if(field.alertsQuality==='loading'||field.alertsReason==='COORDINATE_REGION_PENDING'||field.alertsReason==='COORDINATE_SDK_NOT_READY')
            return daewooAlertMessage('pending','현재 특보 확인 중','확인되는 대로 바로 표시합니다.');
        if(field.alertsQuality==='stale')return daewooAlertMessage('attention','특보정보 갱신 지연','최신 정보를 다시 확인합니다.');
        if(field.alertsQuality==='mapping_required')return daewooAlertMessage('attention','특보 확인이 필요합니다.','현장 위치와 특보구역을 확인해 주세요.');
        return daewooAlertMessage('error','특보정보 조회 실패','잠시 후 다시 확인합니다.');
    }
    function hasScheduledAlerts(field){return Array.isArray(field.scheduledAlerts)&&field.scheduledAlerts.length>0;}
    function shortAlertTime(value){
        var date=new Date(value);if(!value||Number.isNaN(date.getTime()))return '발효시각 확인 중';
        var formatter=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
        function parts(input){var result={};formatter.formatToParts(input).forEach(function(part){result[part.type]=part.value;});return result;}
        var target=parts(date),today=parts(new Date()),time=target.hour+':'+target.minute;
        if(target.year===today.year&&target.month===today.month&&target.day===today.day)return time;
        return (target.year!==today.year?target.year+'.':'')+target.month+'.'+target.day+' '+time;
    }
    function append(parent){for(var i=1;i<arguments.length;i++){if(arguments[i])parent.appendChild(arguments[i]);}return parent;}
    function put(id,node){var target=$(id);if(target)target.replaceChildren(node);}
    function txt(id,value){if($(id))$(id).textContent=value;}
    function empty(message){return el('p','hwx-empty',message);}
    function on(node,event,handler,options){if(!node)return;node.addEventListener(event,handler,options);listenerBindings.push([node,event,handler,options]);}
    function button(label,cls,handler){var b=el('button',cls,label);b.type='button';b.addEventListener('click',handler);return b;}
    function fmt(n,digits){return n==null?'—':Number(n).toLocaleString('ko-KR',{maximumFractionDigits:digits==null?1:digits});}
    function timeText(value){
        if(!value)return '시각 미수신';
        if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)){
            var date=new Date(value);
            if(!Number.isNaN(date.getTime()))return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)+' KST';
        }
        return value+' (원문 시각)';
    }
    function viewState(){return {season:state.season,scope:state.scope,time:state.time,selectedFieldId:state.selectedId};}
    function notify(message,isError){var n=$('hwxNotice');if(!n)return;n.hidden=!message;n.textContent=message||'';n.classList.toggle('hwx-error-notice',!!isError);}
    function invoke(name,args){
        var fn=state.adapter[name];if(typeof fn!=='function')return false;
        try{var result=fn.apply(null,args||[]);if(result && typeof result.catch==='function')result.catch(function(){notify('기존 기능과의 연결 처리에 실패했습니다. 연결 코드를 확인하세요.',true);});return true;}
        catch(error){notify('기존 기능과의 연결 처리에 실패했습니다. 연결 코드를 확인하세요.',true);return false;}
    }
    function selected(){return state.snapshot?state.snapshot.fields.find(function(f){return f.id===state.selectedId;})||null:null;}
    function allFields(){return state.snapshot?state.snapshot.fields:[];}
    function gradeChip(grade){var n=el('span','hwx-grade',M.gradeNames[grade]);n.dataset.grade=grade;return n;}
    function dot(grade){var n=el('span','hwx-dot');n.dataset.grade=grade;n.setAttribute('aria-hidden','true');return n;}
    function relayout(){
        if(frame)return;
        frame=window.requestAnimationFrame(function(){
            frame=0;
            // 데이터/계절 변경은 지도 크기 변경이 아니다. 실제 크기가 바뀐 프레임에만 재배치한다.
            var host=$('hwMap'),width=host?host.clientWidth:0,height=host?host.clientHeight:0;
            if(!width || !height || (width===mapWidth && height===mapHeight))return;
            if(state.map){
                try{
                    var center=typeof state.map.getCenter==='function'?state.map.getCenter():null;
                    state.map.relayout();
                    if(center && typeof state.map.setCenter==='function')state.map.setCenter(center);
                    mapWidth=width;mapHeight=height;
                }catch(e){notify('지도 크기 재계산에 실패했습니다. 지도 연결을 확인하세요.');}
            }else if(invoke('onRelayout',[viewState()])){mapWidth=width;mapHeight=height;}
        });
    }
    function applyLayout(){
        var shell=$('hwShell'),boot=$('hwBoot');if(!shell)return;
        // 서버가 전달한 화면 종류는 배치에만 사용하며 기존 scope와 조회 권한은 유지한다.
        state.viewKind=boot && boot.dataset.viewKind==='general'?'general':'admin';shell.dataset.view=state.viewKind;
        shell.dataset.season=state.season;shell.dataset.scope=state.scope;shell.dataset.time=state.time;shell.dataset.source=state.snapshot?'bridge':'legacy';
        shell.dataset.renderer=state.adapter.preserveOriginalPanels?'original':'managed';
        ['def','summer','winter'].forEach(function(mode){var b=$('wtab'+mode);if(!b)return;b.classList.toggle('on',state.season===mode);b.setAttribute('aria-pressed',String(state.season===mode));});
        ['now','tomorrow'].forEach(function(mode){var b=$(mode==='now'?'hwTabNow':'hwTabTmr');b.classList.toggle('on',state.time===mode);b.setAttribute('aria-pressed',String(state.time===mode));});
        if($('hwxScope'))$('hwxScope').value=state.scope;
        if($('hwxSeasonNote')){
            // 혹서기에서도 자리만 유지해 우측 표의 높이가 계절 전환 때 출렁이지 않게 한다.
            $('hwxSeasonNote').hidden=false;
            $('hwxSeasonNote').classList.toggle('hwx-reserved-note',state.season==='summer');
            $('hwxSeasonNote').setAttribute('aria-hidden',String(state.season==='summer'));
            txt('hwxSeasonNote','혹한기 구간 확정 대기 · 기존 기준 임시 적용');
        }
        txt('hwxViewTitle',(state.scope==='hq'?'본사':'현장')+' · '+seasonNames[state.season]+' 모니터링');
        txt('hwxMapSyncNote',state.adapter.mapSynchronized===true?'지도·상세정보 연결 설정됨':'지도 색상·위치: 기존 로직');
        relayout();
    }
    function setMode(mode){
        if(!Object.prototype.hasOwnProperty.call(seasonNames,mode))throw new TypeError('Invalid mode');
        if(state.season===mode)return;
        state.season=mode;window.wtabmode='wtab'+mode;
        // Preserve original JSP behavior without assuming that renderAll always exists.
        if(!invoke('onModeChange',[mode,viewState()]) && typeof window.renderAll==='function'){
            try{window.renderAll();}catch(e){notify('기존 화면 다시 그리기에 실패했습니다. 기존 JS와의 연동 점검이 필요합니다.',true);}
        }
        render();
    }
    function setScope(scope){if(scope!=='hq' && scope!=='field')throw new TypeError('Invalid view scope');if(state.scope===scope)return;state.scope=scope;render();invoke('onScopeChange',[scope,viewState()]);}
    function setTime(time){if(time!=='now' && time!=='tomorrow')throw new TypeError('Invalid time mode');if(state.time===time)return;state.time=time;invoke('onTimeChange',[time,viewState()]);render();}
    function renderLegend(){
        var list=document.createDocumentFragment();M.grades.forEach(function(g){var li=el('li');append(li,dot(g),el('span','',M.gradeNames[g]));list.appendChild(li);});put('hwxLegend',list);
        var frag=document.createDocumentFragment();frag.appendChild(el('h3','',state.snapshot&&state.snapshot.complete?'조회 현장 현황':'수신 현장 현황'));
        var counts=M.counts(allFields(),state.season,state.time);
        M.grades.forEach(function(g){var b=button('',null,function(){openFields({grade:g},M.gradeNames[g]+' 등급 현장');});append(b,dot(g),el('span','',M.gradeNames[g]),el('strong','',fmt(counts[g],0)+'개'));frag.appendChild(b);});put('hwxMapSummary',frag);
    }
    function renderSite(){
        var f=selected(),shell=$('hwShell'),isDaewoo=shell && shell.dataset.company==='DW1';
        // 대우 설계는 별도 주소 카드 없이 특보 요약 바로 아래에서 현장명과 기상정보를 보여준다.
        txt('hwxSelectedAlertTitle',isDaewoo?'현장 특보 현황':'기상특보');
        txt('hwxSiteName',f?f.name:'현장을 선택하세요');txt('hwxSiteAddress',f?(f.address||'주소 미수신'):'—');
        txt('hwxSiteRegion',f?f.region+(f.originalRegion.indexOf('세종')>=0?' (세종 포함)':''):'—');txt('hwxSiteHq',f?f.hq:'—');
        txt('hwxFieldLabel',f?f.name:'현장을 선택하세요');
        var area=document.createDocumentFragment();
        if(!f)area.appendChild(isDaewoo?daewooAlertMessage('select','현장을 선택해 주세요','지도 또는 지역 목록에서 선택할 수 있습니다.'):unknownAlert('현장을 선택하세요'));
        else if(f.alertsQuality==='scheduled'){
            if(isDaewoo){
                // 미래 기준의 전국 자료만 있을 때 선택 현장에 실제 예정 특보가 있다고 단정하지 않는다.
                var upcoming=hasScheduledAlerts(f),names=upcoming?f.scheduledAlerts.slice(0,2).map(function(a){return a.name;}).join(' · '):'';
                if(upcoming&&f.scheduledAlerts.length>2)names+=' 외 '+(f.scheduledAlerts.length-2)+'건';
                area.appendChild(daewooAlertMessage('pending',upcoming?'특보 발효 예정':'현재 특보 확인 중',
                    upcoming?names+' · '+shortAlertTime(f.alertsValidAt)+' 발효 예정':shortAlertTime(f.alertsValidAt)+' 기준 정보 · 현재 상태는 확인 중입니다.'));
            }else{area.appendChild(unknownAlert(alertUnavailable(f)));appendScheduledAlerts(area,f,null,false);}
        }
        else if(f.alerts===null){
            area.appendChild(isDaewoo?daewooUnavailableMessage(f):unknownAlert(alertUnavailable(f)));
        }
        else if(!f.alerts.length && f.alertsComplete){
            if(isDaewoo)area.appendChild(daewooAlertMessage('clear','발효 중인 특보가 없습니다.','현재 이 현장에 발효 중인 기상특보가 없습니다.'));
            else{var clear=el('div','hwx-no-alert');append(clear,svgIcon('clear','hwx-alert-symbol'),el('span','','발효 중인 특보가 없습니다.'));area.appendChild(clear);}
        }
        else{
            f.alerts.forEach(function(a){
                var row=el('div','hwx-selected-alert-line'),ico=svgIcon(a.type,'hwx-alert-symbol');ico.dataset.level=a.level;
                // 대우는 실제 발효 특보의 종류·수준을 큰 그림과 글자로 표시한다. 원본 특보 판정은 유지한다.
                if(isDaewoo){row.classList.add('hwx-alert-highlight');row.dataset.level=a.level;row.dataset.type=a.type;}
                append(row,ico,el('strong','',a.name),el('span','hwx-alert-state','발효 중'));area.appendChild(row);
            });
            if(!f.alertsComplete){
                if(isDaewoo)area.appendChild(f.alerts.length?el('p','hwx-selected-alert-note','확인된 특보만 표시합니다. 전체 현황은 더보기에서 확인하세요.'):
                    daewooAlertMessage('attention','특보 확인이 필요합니다.','현재 상태를 확인하고 있습니다. 자세한 내용은 더보기에서 확인하세요.'));
                else area.appendChild(unknownAlert('일부 특보 상태를 확인하지 못했습니다.'));
            }
        }
        // 요약 카드는 그림/상태만, 발표 원문과 데이터 한계는 선택 현장 범위의 상세에서 제공한다.
        if($('hwxSelectedMore'))$('hwxSelectedMore').disabled=!f;
        put('hwxSelectedAlerts',area);
        renderAir(f);
        if(!state.adapter.preserveOriginalPanels)renderWeather(f);
    }
    function appendScheduledAlerts(parent,field,type,isDaewoo){
        var rows=(field.scheduledAlerts||[]).filter(function(a){return !type || a.type===type;});
        rows.forEach(function(a){
            var row=el('div','hwx-selected-alert-line'),icon=svgIcon(a.type,'hwx-alert-symbol');icon.dataset.level=a.level;
            row.dataset.state='scheduled';if(isDaewoo)row.classList.add('hwx-alert-highlight');
            append(row,icon,el('strong','',a.name),el('span','hwx-alert-state','발효 예정 · '+timeText(a.validAt)));parent.appendChild(row);
        });
        if(!field.scheduledAlertsComplete)parent.appendChild(el('p','hwx-selected-alert-note','일부 발효예정 특보구역은 확인이 필요합니다.'));
        // 예정 목록이 비어도 현재 무특보를 의미하지 않는다. 녹색 체크/현재 발효 건수에 포함하지 않는다.
    }
    function renderAir(f){
        var a=f?f.air:null,frag=document.createDocumentFragment(),widgets=document.createDocumentFragment(),names={good:'좋음',normal:'보통',bad:'나쁨',verybad:'매우 나쁨'};
        [['pm10','미세먼지 PM10'],['pm25','초미세먼지 PM2.5']].forEach(function(item){
            var key=item[0],value=a?a[key]:null,q=a?a.quality:'missing',g=a && q==='ok' && value!==null?a[key+'Grade']:null;
            if(q==='error'||q==='missing')value=null;
            var row=el('div','hwx-air-item'),face=svgIcon('air-'+(g||'unknown'),'hwx-air-icon');face.dataset.air=g||'unknown';row.dataset.air=g||'unknown';
            var info=el('div'),valueNode=el('div','hwx-air-value',fmt(value,0));valueNode.appendChild(el('small','','㎍/㎥'));
            var label=g?names[g]:value==null?'미수신':q==='ok'?'등급 미수신':qualityNames[q];
            append(info,el('div','hwx-air-name',item[1]),el('div','hwx-air-grade',label),valueNode);append(row,face,info);frag.appendChild(row);
            widgets.appendChild(airWeatherWidget(item,value,g,label));
        });
        var source=a?(a.station||'측정소 미수신')+' · '+timeText(a.observedAt)+(a.quality!=='ok'?' · '+qualityNames[a.quality]:''):'측정소·관측시각 미수신';
        put('hwxAir',frag);put('hwxWeatherAir',widgets);txt('hwxAirTime',source);
        // 측정소 설정과 관측자료 유무를 분리하고, 없는 시각/자료를 '미수신'으로 반복하지 않는다.
        var airNote='미세먼지'+(a && a.station?' · 측정소: '+a.station:'');
        if(!a || a.quality==='missing')airNote+=' · 관측자료 없음';
        else if(a.quality==='error')airNote+=' · 조회 실패';
        else{
            airNote+=' · '+(a.observedAt?timeText(a.observedAt):'관측시각 없음');
            if(a.quality==='stale')airNote+=' · 갱신 지연';
            else if(a.quality==='unknown')airNote+=' · 자료 확인 필요';
        }
        txt('hwxWeatherAirTime',airNote+(state.time==='tomorrow'?' (현재 관측자료 · 내일예보 아님)':''));
    }
    function airWeatherWidget(item,value,grade,label){
        // 농도와 수신 등급을 그대로 표시한다. 원호는 등급 4단계를 표현하며 미수신·지연 자료는 회색이다.
        var ns='http://www.w3.org/2000/svg',card=el('div','hw-widget hwx-air-widget'),host=el('div','hw-gauge'),svg=document.createElementNS(ns,'svg');
        var colors={good:'#3386C5',normal:'#4AAD79',bad:'#E89A37',verybad:'#D75550'},levels={good:1,normal:2,bad:3,verybad:4};
        card.dataset.air=grade||'unknown';card.dataset.metric=item[0];card.setAttribute('aria-label',item[1]+' '+fmt(value,0)+' ㎍/㎥ · '+label);
        var head=el('div','w-head');append(head,el('span','',item[0]==='pm10'?'미세먼지':'초미세먼지'),el('span','',item[0]==='pm10'?'PM10':'PM2.5'));card.appendChild(head);
        svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('aria-hidden','true');
        [false,true].forEach(function(fill){var circle=document.createElementNS(ns,'circle');
            var attrs={cx:50,cy:50,r:40,fill:'none',stroke:fill?(colors[grade]||'#9E9E9E'):'#E3E8EF','stroke-width':9,'stroke-linecap':fill && grade?'round':'butt',pathLength:100,'stroke-dasharray':fill?(75*(levels[grade]||0)/4)+' 100':'75 25',transform:'rotate(135 50 50)'};
            Object.keys(attrs).forEach(function(key){circle.setAttribute(key,String(attrs[key]));});svg.appendChild(circle);
        });
        [[53,fmt(value,0),17,'#1F2937'],[67,'㎍/㎥',9,'#6B7280']].forEach(function(data){var text=document.createElementNS(ns,'text');text.setAttribute('x','50');text.setAttribute('y',String(data[0]));text.setAttribute('text-anchor','middle');text.setAttribute('font-size',String(data[2]));text.setAttribute('font-weight',data[0]===53?'700':'400');text.setAttribute('fill',data[3]);text.textContent=data[1];svg.appendChild(text);});
        append(host,svg,el('div','g-sub',label));card.appendChild(host);return card;
    }
    function gauge(value,min,max,color,unit){
        var host=el('div','hwx-gauge'),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 76 66');svg.setAttribute('aria-hidden','true');
        var path=document.createElementNS(ns,'path');path.setAttribute('d','M 15 57 A 29 29 0 1 1 61 57');path.setAttribute('class','hwx-gauge-track');svg.appendChild(path);
        if(value!==null){var fill=document.createElementNS(ns,'path');fill.setAttribute('d','M 15 57 A 29 29 0 1 1 61 57');fill.setAttribute('class','hwx-gauge-fill');fill.setAttribute('pathLength','100');fill.setAttribute('stroke-dasharray',String(Math.max(0,Math.min(100,(value-min)/(max-min)*100)))+' 100');fill.style.setProperty('--metric-color',color);svg.appendChild(fill);}
        var val=el('strong','hwx-metric-value',fmt(value));val.appendChild(el('small','',unit));append(host,svg,val);return host;
    }
    function metric(label,value,min,max,color,unit,sub){var c=el('div','hwx-metric');append(c,el('span','hwx-metric-label',label),gauge(value,min,max,color,unit),el('span','hwx-metric-sub',sub));return c;}
    function renderWeather(f){
        var w=f?f.weather[state.time]:null,valid=w && w.quality!=='error' && w.quality!=='missing';
        function v(key){return valid?w[key]:null;}
        var frag=document.createDocumentFragment(),rain=el('div','hwx-metric'),rainValue=el('strong','hwx-metric-value');
        var isSnow=v('snow')!==null && v('snow')>0;
        rainValue.textContent=valid && w.rainText?w.rainText:fmt(v(isSnow?'snow':'rain'));
        if(!(valid && w.rainText))rainValue.appendChild(el('small','',isSnow?'cm':'mm'));
        var rainIcon=svgIcon(isSnow?'snow':'rain','hwx-rain-symbol');if(v(isSnow?'snow':'rain')===null && !(valid && w.rainText))rainIcon.dataset.state='unknown';
        append(rain,el('span','hwx-metric-label',isSnow?'강설':'강수'),rainIcon,rainValue,el('span','hwx-metric-sub',state.time==='tomorrow'?'예보 대상시각 기준':'측정자료 기준'));frag.appendChild(rain);
        frag.appendChild(metric('온도',v('temperature'),-30,50,'#efa350','℃',state.time==='tomorrow'?'예보 온도':'관측 온도'));
        frag.appendChild(metric('습도',v('humidity'),0,100,'#53b590','%',state.time==='tomorrow'?'예보 습도':'상대 습도'));
        var grade=f?M.fieldGrade(f,state.season,state.time):'unknown',feels=el('div','hwx-metric hwx-metric--feels');feels.dataset.grade=grade;
        var temp=el('strong','hwx-metric-value',fmt(v('feelsLike')));temp.appendChild(el('small','','℃'));
        var extreme=state.season==='winter'?'dailyMinFeelsLike':'dailyMaxFeelsLike',extremeText=(state.time==='tomorrow'?'내일 ':'당일 ')+(state.season==='winter'?'최저 ':'최대 ')+fmt(v(extreme))+'℃';
        append(feels,el('span','hwx-metric-label','체감온도'),temp,el('span','hwx-metric-sub',extremeText),gradeChip(grade));frag.appendChild(feels);
        frag.appendChild(metric('풍속',v('windSpeed'),0,25,'#69a5d4','m/s','기상자료 풍속'));
        var dir=el('div','hwx-metric'),compass=el('div','hwx-compass');
        if(v('windDirection')!==null){var arrow=el('span','hwx-compass-arrow');arrow.style.setProperty('--deg',v('windDirection')+'deg');arrow.setAttribute('aria-hidden','true');compass.appendChild(arrow);}else compass.appendChild(el('span','hwx-compass-empty','—'));
        append(dir,el('span','hwx-metric-label','풍향'),compass,el('span','hwx-metric-sub',M.wind(v('windDirection'))+(v('windDirection')!==null?' · '+fmt(v('windDirection'),0)+'°':'')));frag.appendChild(dir);put('hwxWidgets',frag);
        var label=state.time==='tomorrow'?'내일예보 대상: ':'관측: ';
        txt('hwxWeatherTime',!w?(state.time==='tomorrow'?'내일예보 미수신 · 현재 관측값을 대신 표시하지 않습니다.':'기상자료 미수신'):
            label+timeText(state.time==='tomorrow'?w.validAt:w.observedAt)+' · '+(w.source||'출처 미수신')+(w.quality!=='ok'?' · '+qualityNames[w.quality]:'')+(state.time==='tomorrow'?' / 특보·대기질은 현재 자료':''));
        var chip=$('hwxWeatherChip');if(chip)chip.textContent=f?f.name+' · '+(state.time==='tomorrow'?'내일예보 ':'현재 ')+fmt(v('temperature'))+'℃ · 체감 '+fmt(v('feelsLike'))+'℃':'현장을 선택하세요';
    }
    function alertRow(group,compact,fieldId){
        var row=button('','hwx-alert-row',function(){openFields({alert:group.key,id:fieldId||''},group.name+' 발효 현장');});
        var ico=svgIcon(group.type,'hwx-alert-symbol');ico.dataset.level=group.level;
        var info=el('span','hwx-alert-info'),detail=group.regions.map(function(r){return r[0]+' '+r[1];}).join(' · ');
        var detailNode=el('span','hwx-alert-regions',detail);detailNode.title=detail;
        append(info,el('span','hwx-alert-name',group.name),detailNode);var count=el('strong','hwx-alert-count',fmt(group.count,0));count.appendChild(el('small','','개'));
        append(row,ico,info,count);row.setAttribute('aria-label',group.name+' 발효 현장 '+group.count+'개. '+detail);return row;
    }
    function reportLine(report){
        var row=el('div','hwx-report-line');
        append(row,el('strong','',report.title),el('small','',(report.region||'권역 미수신')+' · '+timeText(report.issuedAt)));
        return row;
    }
    function recentReports(type){
        if(!state.snapshot || state.snapshot.reportsQuality!=='recent')return [];
        return state.snapshot.reports.filter(function(r){return !type || r.title.indexOf(M.types[type])>=0;});
    }
    function statusMajorCard(type,unknown){
        var card=button('','hwx-alert-row hwx-major-card',function(){openAlerts(type);});
        var info=el('span','hwx-alert-info');
        append(info,el('strong','hwx-alert-name',M.types[type]),el('span','hwx-alert-regions','발효 현장 수'));
        var icon=svgIcon(type,'hwx-alert-symbol');icon.dataset.state=unknown?'unknown':'clear';
        var count=el('strong',unknown?'hwx-pending-count':'hwx-alert-count',unknown?'확인 필요':'0');
        if(!unknown)count.appendChild(el('small','','개'));
        append(card,icon,info,count);
        card.setAttribute('aria-label',M.types[type]+(unknown?' 발효 현장 수 확인 필요':' 발효 현장 0개'));
        return card;
    }
    function renderSummary(){
        var fields=allFields(),summary=M.alertSummary(fields),frag=document.createDocumentFragment();
        var stats=[{label:state.snapshot.complete?'전체 현장':'수신 현장',value:fields.length,note:state.snapshot.complete?'조회 권한 내 전체 현장':'전체 목록 여부 미확인',cls:'',icon:'site-total'},
            {label:'특보 발효현장',value:summary.affected || summary.unknown === 0 ? summary.affected : null,note:summary.unknown?'미확인 '+summary.unknown+'개 · 확정값만 집계':'중복 현장 제외',cls:'hwx-stat--warning',icon:'site-advisory'},
            {label:'기상 위험현장',value:summary.warningAffected || summary.unknown===0 ? summary.warningAffected : null,note:summary.unknown?'경보 이상 · 미확인 '+summary.unknown+'개 별도':'현재 특보 경보 이상 발효 현장',cls:'hwx-stat--danger',icon:'site-risk'}];
        stats.forEach(function(s){var n=el('div','hwx-stat '+s.cls),v=el('strong','',fmt(s.value,0));if(s.value!==null)v.appendChild(el('small','','개'));append(n,assetIcon(s.icon,'hwx-stat-icon'),el('span','',s.label),v,el('small','',s.note));frag.appendChild(n);});put('hwxStats',frag);
        txt('hwxOverviewScope',state.snapshot.complete?'권한 내 전체 목록':'수신 목록 · 전체 여부 미확인');
        var list=document.createDocumentFragment(),major=document.createDocumentFragment();
        if(summary.groups.length){summary.groups.slice(0,6).forEach(function(g){list.appendChild(alertRow(g));});summary.groups.slice(0,3).forEach(function(g){major.appendChild(alertRow(g,true));});}
        else{
            var message=summary.unknown?'일부 현장의 특보정보를 확인하지 못했습니다.':fields.length?'발효 중인 특보가 없습니다.':'수신된 현장 목록이 없습니다.';
            list.appendChild(empty(message));
            if(fields.length){
                var types=state.season==='winter'?['cold','snow','dry']:['heat','rain','dry'];
                types.forEach(function(type){major.appendChild(statusMajorCard(type,summary.unknown>0));});
            }else major.appendChild(empty(message));
        }
        put('hwxOverviewAlerts',list);put('hwWidgets2',major);
        txt('hwxAlertCountNote',!fields.length?'조회 대상 현장이 없습니다.':summary.unknown?'조회 '+fields.length+'개 현장 중 '+summary.unknown+'개 확인 필요 · 더보기에서 확인하세요.':'기상청 현재 특보현황 · 조회 '+timeText(state.snapshot.alertsCheckedAt));
        renderRegionButtons();renderHqOverview(fields);
    }
    function renderRegionButtons(){
        var focused=document.activeElement && document.activeElement.dataset?document.activeElement.dataset.hwxRegion:null;
        var frag=document.createDocumentFragment();M.regions.forEach(function(r){
            var b=button(r,null,function(){if(!invoke('onOpenRegion',[r]))openFields({region:r},r+(r==='충남'?' (세종 포함)':'')+' 현장');});
            var count=allFields().filter(function(f){return f.region===r;}).length;
            b.dataset.hwxRegion=r;
            b.disabled=!state.snapshot;b.setAttribute('aria-label',r+(r==='충남'?' (세종 포함)':'')+' 현장 기상정보'+(state.snapshot?' · '+count+'개 현장':''));
            if(r==='충남')b.title='세종 현장을 충남에 합산';frag.appendChild(b);
        });put('hwxRegionButtons',frag);
        if(focused){var target=Array.from($('hwxRegionButtons').children).find(function(b){return b.dataset.hwxRegion===focused;});if(target && !target.disabled)target.focus();}
    }
    function renderHqOverview(fields){
        var groups=M.headquartersOverview(fields),table=el('table','hwx-table hwx-table-overview'),thead=el('thead'),head=el('tr');
        ['본부','전체 현장','특보 발효현장','기상 위험현장'].forEach(function(t){var th=el('th','',t);th.scope='col';head.appendChild(th);});thead.appendChild(head);table.appendChild(thead);
        function countCell(value,unknown,filter,title){
            var td=el('td'),b=button(value || unknown===0 ? fmt(value,0)+'개':'—',null,function(){openFields(filter,title);});
            if(unknown){b.title='확인된 현장 '+value+'개 · 특보 미확인 '+unknown+'개';b.appendChild(el('small','hwx-count-pending','미확인 '+unknown+'개'));}
            td.appendChild(b);return td;
        }
        var body=el('tbody');
        groups.forEach(function(g){var tr=el('tr'),th=el('th');th.scope='row';th.appendChild(button(g.label,null,function(){openFields({hq:g.name},g.label+' 현장');}));tr.appendChild(th);
            tr.appendChild(countCell(g.total,0,{hq:g.name},g.label+' 전체 현장'));
            tr.appendChild(countCell(g.alerts.affected,g.alerts.unknown,{hq:g.name,hasAlert:true},g.label+' 특보 발효현장'));
            tr.appendChild(countCell(g.alerts.warningAffected,g.alerts.unknown,{hq:g.name,warningOnly:true},g.label+' 기상 위험현장'));body.appendChild(tr);
        });
        var summary=M.alertSummary(fields),total=el('tr','hwx-total-row');total.appendChild(el('th','','계'));
        total.firstChild.scope='row';total.appendChild(countCell(fields.length,0,{},'전체 현장'));
        total.appendChild(countCell(summary.affected,summary.unknown,{hasAlert:true},'전체 특보 발효현장'));
        total.appendChild(countCell(summary.warningAffected,summary.unknown,{warningOnly:true},'전체 기상 위험현장'));body.appendChild(total);
        table.appendChild(body);put('hwxHqOverview',table);
        txt('hwxHqOverviewNote',(state.snapshot.complete?'전체 현장':'수신 현장')+' 기준 · 특보는 현재 발효현황'+(summary.unknown?' · 미확인 '+summary.unknown+'개 별도':''));
    }
    function shortThreshold(g){
        var winter={alert:'−18℃↓',danger:'−15℃↓',caution:'−12℃↓',attention:'−9℃ 미만',normal:'−9℃↑',unknown:'확인 필요'};
        var summer={alert:'38℃↑',danger:'35℃↑',caution:'33℃↑',attention:'31℃↑',normal:'31℃ 미만',unknown:'확인 필요'};
        var allSeason={alert:'고온 38↑ / 저온 −18↓',danger:'고온 35↑ / 저온 −15↓',caution:'고온 33↑ / 저온 −12↓',attention:'고온 31↑ / 저온 −5 미만',normal:'−5~31℃',unknown:'확인 필요'};
        return (state.season==='winter'?winter:state.season==='def'?allSeason:summer)[g];
    }
    function renderAggregation(key,target){
        var fields=allFields(),groups=M.aggregate(fields,key,state.season,state.time),order=['alert','danger','caution','attention','normal','unknown'];
        var table=el('table','hwx-table'+(key==='hq'?' hwx-table-hq':'')),thead=el('thead'),head=el('tr');
        var first=el('th','',key==='region'?'권역':'본부');first.scope='col';head.appendChild(first);
        order.forEach(function(g){var th=el('th');th.scope='col';th.dataset.grade=g;th.title=M.thresholds(state.season)[g];var b=button('',null,function(){openFields({grade:g},M.gradeNames[g]+' 등급 현장');});append(b,el('span','',M.gradeNames[g]),el('small','',shortThreshold(g)));b.lastChild.style.display='block';th.appendChild(b);head.appendChild(th);});
        var totalHead=el('th');totalHead.scope='col';totalHead.appendChild(button('계',null,function(){openFields({},'전체 수신 현장');}));head.appendChild(totalHead);thead.appendChild(head);table.appendChild(thead);
        function addRow(name,rows,counts,total){var tr=el('tr',total?'hwx-total-row':'');var td=el('td'),base={};if(!total)base[key]=name;
            td.appendChild(button(name,null,function(){openFields(base,name+' 현장');}));tr.appendChild(td);
            order.concat(['total']).forEach(function(g){var cell=el('td');if(g!=='total')cell.dataset.grade=g;var filter=Object.assign({},base);if(g!=='total')filter.grade=g;cell.appendChild(button(fmt(counts[g],0),null,function(){openFields(filter,name+' · '+(g==='total'?'전체':M.gradeNames[g])+' 현장');}));tr.appendChild(cell);});return tr;}
        var tbody=el('tbody');groups.forEach(function(g){tbody.appendChild(addRow(g.name,g.fields,g.counts,false));});table.appendChild(tbody);var foot=el('tfoot');foot.appendChild(addRow('계',fields,M.counts(fields,state.season,state.time),true));table.appendChild(foot);put(target,table);
    }
    function render(){
        if(!initialized)return;applyLayout();renderRegionButtons();if(!state.snapshot)return;
        renderSite();renderSummary();
        if(!state.adapter.preserveOriginalPanels){renderLegend();renderAggregation('region','hwxAggRegion');renderAggregation('hq','hwxAggHq');}
        var s=state.snapshot,d=s.diagnostics;
        txt('hwxDataStatus',(s.complete?'전체 목록':'수신 목록')+' '+s.fields.length+'개 · 수신 '+timeText(s.updatedAt));
        txt('hwxAggregateNote',(state.time==='tomorrow'?'내일 예보':'현재 관측')+' 체감온도 기준 · 미수신은 정상 등급에서 제외');
        if(d.duplicates||d.invalidIds)notify('입력 데이터 확인 필요: 중복 ID '+d.duplicates+'건, ID 누락 '+d.invalidIds+'건. 중복은 마지막 행을 사용하며 전체 집계로 확정하지 않습니다.');
        if(state.modal==='fields')renderFieldList();else if(state.modal==='alerts')renderAlertModal();
    }
    function matchingRows(filter){
        filter=filter||{};return allFields().filter(function(f){
            if(filter.id && f.id!==filter.id)return false;
            if(filter.region && f.region!==filter.region)return false;if(filter.hq && f.hq!==filter.hq)return false;
            if(filter.warningOnly && !M.hasWarning(f))return false;
            if(filter.grade && M.fieldGrade(f,state.season,state.time)!==filter.grade)return false;
            if(filter.hasAlert && !(f.alerts && f.alerts.length))return false;
            if(filter.alert && !(f.alerts && f.alerts.some(function(a){return a.type+':'+a.level===filter.alert;})))return false;
            return true;
        });
    }
    function showModal(kind,title,kicker){
        if($('hwxModal').hidden){lastFocus=document.activeElement;previousOverflow=document.body.style.overflow;}
        state.modal=kind;state.modalTitle=title;$('hwxModal').hidden=false;txt('hwxModalTitle',title);txt('hwxModalKicker',kicker);
        $('hwxModalSearchWrap').hidden=kind!=='fields';document.body.style.overflow='hidden';
        window.requestAnimationFrame(function(){(kind==='fields'?$('hwxModalSearch'):$('hwxModalClose')).focus();});
    }
    function closeModal(){
        $('hwxModal').hidden=true;state.modal=null;state.filter=null;document.body.style.overflow=previousOverflow;
        if(lastFocus && document.contains(lastFocus))lastFocus.focus();
    }
    function openFields(filter,title){
        if(!state.snapshot){legacySearch();return;}
        state.filter=filter||{};$('hwxModalSearch').value='';showModal('fields',title||'현장 검색','FIELD SEARCH');renderFieldList();
    }
    function renderFieldList(){
        var rows=M.search(matchingRows(state.filter),$('hwxModalSearch').value),frag=document.createDocumentFragment();
        var focused=document.activeElement && document.activeElement.dataset?document.activeElement.dataset.hwxField:null;
        txt('hwxSearchCount',rows.length+'개 현장 · '+(state.time==='tomorrow'?'내일예보':'현재 관측')+' 기준');
        if(!rows.length)frag.appendChild(empty('검색 조건에 해당하는 현장이 없습니다.'));
        rows.forEach(function(f){var b=button('','hwx-field-button',function(){selectField(f.id,{notify:true});closeModal();});b.dataset.hwxField=f.id;b.setAttribute('aria-current',String(f.id===state.selectedId));
            var w=f.weather[state.time],main=el('span','hwx-field-main'),value=el('span','hwx-field-value');
            append(main,el('strong','',f.name),el('small','',f.region+' · '+f.hq),el('small','',f.address||'주소 미수신'));
            append(value,el('strong','',fmt(w && w.quality!=='error' && w.quality!=='missing'?w.feelsLike:null)+'℃'),gradeChip(M.fieldGrade(f,state.season,state.time)));
            append(b,main,value);frag.appendChild(b);});put('hwxModalBody',frag);
        if(focused){var buttons=$('hwxModalBody').querySelectorAll('[data-hwx-field]'),found=Array.from(buttons).find(function(b){return b.dataset.hwxField===focused;});if(found)found.focus();else $('hwxModalSearch').focus();}
    }
    function renderAlertModal(){
        var field=state.alertFieldId?allFields().find(function(f){return f.id===state.alertFieldId;}):null;
        var fields=state.alertFieldId?(field?[field]:[]):allFields(),sum=M.alertSummary(fields),frag=document.createDocumentFragment();
        if(!fields.length){put('hwxModalBody',empty(state.alertFieldId?'선택 현장이 현재 조회 목록에 없어 특보를 확인할 수 없습니다.':'조회 대상 현장이 없어 특보 발효 여부를 확인할 수 없습니다.'));return;}
        if(field)txt('hwxModalTitle','기상특보 · '+field.name);
        var shownGroups=sum.groups.filter(function(g){return !state.alertType||g.type===state.alertType;});
        frag.appendChild(el('p','hwx-rule-note','기상청 특보현황 · 조회 '+timeText(field?field.alertsCheckedAt:state.snapshot.alertsCheckedAt)));
        var issuedAt=field?field.alertsIssuedAt:state.snapshot.alertsIssuedAt;
        if(issuedAt)frag.appendChild(el('p','hwx-rule-note','원천 발표 '+timeText(issuedAt)));
        if(field && field.alertsRegion)frag.appendChild(el('p','hwx-rule-note','현장 좌표 행정구역 · '+field.alertsRegion));
        fields.filter(function(f){return f.alertsQuality==='scheduled';}).forEach(function(f){
            frag.appendChild(el('h3','',f.name+(hasScheduledAlerts(f)?' · 발효 예정':' · 현재 특보 확인 중')));
            frag.appendChild(el('p','hwx-rule-note',alertUnavailable(f)));appendScheduledAlerts(frag,f,state.alertType,false);
        });
        shownGroups.forEach(function(g){
            frag.appendChild(alertRow(g,false,field?field.id:''));
            var records=el('ul','hwx-current-alert-fields');
            g.fields.forEach(function(f){
                var a=f.alerts.find(function(item){return item.type===g.type && item.level===g.level;});
                var b=button('','hwx-field-button',function(){selectField(f.id,{notify:true});closeModal();});
                append(b,el('strong','',f.name),el('small','',f.region+' · '+g.name+' · 발효 '+timeText(a && a.validAt)));
                var li=el('li');li.appendChild(b);records.appendChild(li);
            });
            frag.appendChild(records);
        });
        if(!sum.unknown && !shownGroups.length){
            var clear=el('div','hwx-no-alert hwx-icon-message');
            append(clear,svgIcon('clear','hwx-alert-symbol'),el('strong','',state.alertType?'발효 중인 '+M.types[state.alertType]+' 특보가 없습니다.':'발효 중인 특보가 없습니다.'));frag.appendChild(clear);
        }
        var unresolved=fields.filter(function(f){return !f.alertsComplete&&f.alertsQuality!=='scheduled';});
        if(unresolved.length){
            frag.appendChild(el('h3','',unresolved.length+'개 현장 확인 필요'));
            unresolved.forEach(function(f){frag.appendChild(el('p','hwx-rule-note',f.name+' · '+alertUnavailable(f)));});
        }
        var reportsQuality=field?field.reportsQuality:state.snapshot.reportsQuality;
        var reports=field?(reportsQuality==='recent'?field.reports.filter(function(r){return !state.alertType || r.title.indexOf(M.types[state.alertType])>=0;}):[]):recentReports(state.alertType);
        var history=el('details','hwx-report-history');
        history.appendChild(el('summary','','최근 권역 발표이력 (참고)'));
        history.appendChild(el('p','hwx-rule-note','최근 '+(state.snapshot.reportWindowHours||12)+'시간 발표 이력입니다. 위의 현재 발효현황과는 별도 자료입니다.'));
        if(!reports.length)history.appendChild(empty(reportsQuality==='error'?'발표이력을 가져오지 못했습니다.':reportsQuality==='recent'?'조회 구간의 발표이력이 없습니다.':'발표이력을 조회하고 있습니다.'));
        reports.forEach(function(report){history.appendChild(reportLine(report));});frag.appendChild(history);put('hwxModalBody',frag);
    }
    function openAlerts(type,fieldId){
        state.alertType=typeof type==='string' && M.types[type]?type:null;
        state.alertFieldId=typeof fieldId==='string'?fieldId:'';
        showModal('alerts',state.alertFieldId?'기상특보 · 선택 현장':'특보현황 · 당사 현장 기준','WEATHER ALERTS');
        if(state.snapshot)renderAlertModal();else put('hwxModalBody',empty('현재 발효 특보를 조회하고 있습니다.'));
    }
    function openRules(){
        showModal('rules',seasonNames[state.season]+' 체감온도 기준','DESIGN THRESHOLDS');var frag=document.createDocumentFragment();
        function add(season){frag.appendChild(el('h3','',seasonNames[season]));var table=el('table','hwx-rule-table'),body=el('tbody'),rules=M.thresholds(season);
            M.grades.forEach(function(g){var tr=el('tr'),th=el('th');th.scope='row';th.appendChild(gradeChip(g));append(tr,th,el('td','',rules[g]));body.appendChild(tr);});table.appendChild(body);frag.appendChild(table);}
        if(state.season==='def'){add('summer');add('winter');}else add(state.season);
        frag.appendChild(el('p','hwx-rule-note','혹한기 온도 구간은 담당자 확정 대기 중이며 기존 코드 기준을 임시 적용합니다. 상시는 혹서·혹한 중 높은 단계를 표시합니다. 현재 API의 내일 체감온도는 최고기온 기반 근사값으로 혹한기 최저 체감온도가 아닙니다.'));
        frag.appendChild(el('p','hwx-rule-note','서버 체감온도 계산은 달력 월 기준이며, 화면의 계절 버튼으로 계산 공식이 바뀌지는 않습니다. 혹한기 풍속 반영 계산은 별도 보완이 필요합니다.'));
        frag.appendChild(el('p','hwx-rule-note','체감온도에 따른 화면 등급이며 기상청 공식 특보와는 다릅니다. 미수신·지연·오류 자료는 정상 등급에 포함하지 않습니다.'));
        put('hwxModalBody',frag);
    }
    function selectField(id,options){
        id=M.text(id);var f=allFields().find(function(row){return row.id===id;});if(!f)return false;
        state.selectedId=id;renderSite();
        if(options && options.notify){if(!invoke('onSelectField',[id,viewState()]))notify('상세정보만 변경되었습니다. 지도 선택 동기화는 기존 JS와의 연결이 필요합니다.');}
        return true;
    }
    function legacySearch(){
        var table=$('hwAggRegion'),trigger=table && (table.querySelector('.hw-gth-all')||table.querySelector('.hw-sum td:last-child'));
        if(trigger){trigger.click();window.requestAnimationFrame(function(){if(window.getComputedStyle($('hwModal')).display==='none')showUnlinkedSearch();});}
        else showUnlinkedSearch();
    }
    function showUnlinkedSearch(){showModal('unlinked','현장 검색 연결 대기','INTEGRATION REQUIRED');put('hwxModalBody',empty('기존 현장 목록을 확인하지 못했습니다. 기존 heatwave-dashboard-app.js 로드와 데이터 연결을 확인하세요. 샘플 현장은 운영 화면에 표시하지 않습니다.'));}
    function focusTrap(event,node){
        var items=Array.from(node.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]')).filter(function(x){return x.getClientRects().length>0;});
        if(!items.length)return;var first=items[0],last=items[items.length-1];
        if(event.key==='Tab'){if(event.shiftKey && (document.activeElement===first||!node.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey && (document.activeElement===last||!node.contains(document.activeElement))){event.preventDefault();first.focus();}}
    }
    function initLegacyModal(){
        var modal=$('hwModal'),wasOpen=false;
        legacyObserver=new MutationObserver(function(){var open=window.getComputedStyle(modal).display!=='none';
            modal.querySelectorAll('.hw-modal-list li:not(.hw-modal-empty)').forEach(function(li){li.tabIndex=0;li.setAttribute('role','button');});
            if(open && !wasOpen){legacyLastFocus=document.activeElement;$('hwModalSearch').focus();}
            if(!open && wasOpen && legacyLastFocus && document.contains(legacyLastFocus))legacyLastFocus.focus();wasOpen=open;
        });legacyObserver.observe(modal,{attributes:true,attributeFilter:['style','class'],childList:true,subtree:true});
        on(modal,'keydown',function(e){if(e.key==='Escape'){$('hwModalClose').click();e.stopPropagation();}else{focusTrap(e,modal);if((e.key==='Enter'||e.key===' ') && e.target.matches('.hw-modal-list li[role="button"]')){e.preventDefault();e.target.click();}}});
        // Only mirror the rendered name in legacy mode. Never derive IDs, alerts or air values from text.
        labelObserver=new MutationObserver(function(){if(!state.snapshot)txt('hwxSiteName',$('hwFieldLabel').textContent||'현장을 선택하세요');});labelObserver.observe($('hwFieldLabel'),{childList:true,characterData:true,subtree:true});
    }
    function initSplitter(){
        var splitter=$('hwxSplitter'),active=false;
        function set(value){value=Math.max(35,Math.min(65,value));document.body.style.setProperty('--hw-left',value.toFixed(1)+'%');splitter.setAttribute('aria-valuenow',String(Math.round(value)));relayout();}
        on(splitter,'pointerdown',function(e){if(e.button!==0)return;active=true;splitter.setPointerCapture(e.pointerId);e.preventDefault();});
        on(splitter,'pointermove',function(e){if(!active)return;var rect=$('hwMain').getBoundingClientRect();set((e.clientX-rect.left)/rect.width*100);});
        on(splitter,'pointerup',function(){active=false;});on(splitter,'pointercancel',function(){active=false;});
        on(splitter,'keydown',function(e){var v=Number(splitter.getAttribute('aria-valuenow'));if(e.key==='ArrowLeft'){e.preventDefault();set(v-2);}if(e.key==='ArrowRight'){e.preventDefault();set(v+2);}if(e.key==='Home'){e.preventDefault();set(35);}if(e.key==='End'){e.preventDefault();set(65);}});
    }
    function reportError(message){
        if(state.snapshot){state.snapshot.complete=false;state.snapshot.fields.forEach(function(f){['now','tomorrow'].forEach(function(t){if(f.weather[t])f.weather[t].quality='stale';});f.alertsComplete=false;f.alerts=null;f.alertsQuality='error';if(f.air)f.air.quality='stale';});render();}
        else{
            txt('hwxSiteName','현장자료 조회 실패');
            put('hwxSelectedAlerts',unknownAlert('현장 목록을 불러오지 못해 특보를 확인할 수 없습니다.'));
            put('hwWidgets2',empty('현장 목록 조회 실패 · 발효 현장 수 미확인'));
            put('hwxHqOverview',empty('현장 목록 조회 실패 · 본부별 현황 미확인'));
            txt('hwxHqOverviewNote','다음 자동 갱신 시 다시 조회합니다.');
            txt('hwxAlertCountNote','다음 자동 갱신 시 다시 조회합니다.');
            txt('hwxWeatherTime','현장 기상자료 조회 실패');
        }
        notify(message||'자료 갱신에 실패했습니다. 이전 자료는 최신 상태로 집계하지 않습니다.',true);
    }
    function update(snapshot){
        var next=M.normalizeSnapshot(snapshot),previous=state.selectedId;
        var boot=$('hwBoot'),wanted=Object.prototype.hasOwnProperty.call(snapshot,'selectedFieldId')?next.selectedFieldId:previous;
        if(!wanted && !state.snapshot && !Object.prototype.hasOwnProperty.call(snapshot,'selectedFieldId')){wanted=next.fields.find(function(f){return boot.dataset.siteCd && f.siteCd===boot.dataset.siteCd;})?.id || boot.dataset.fieldId || '';}
        state.snapshot=next;state.selectedId=next.fields.some(function(f){return f.id===wanted;})?wanted:'';
        notify('');render();return {accepted:next.fields.length,diagnostics:Object.assign({},next.diagnostics)};
    }
    function connect(adapter){
        if(!adapter||typeof adapter!=='object')throw new TypeError('adapter must be an object');
        ['onSelectField','onModeChange','onTimeChange','onScopeChange','onRelayout','onOpenRegion'].forEach(function(k){if(adapter[k]!=null && typeof adapter[k]!=='function')throw new TypeError(k+' must be a function');});
        state.adapter=Object.assign({},adapter);applyLayout();return window.HeatwaveDashboardUI;
    }
    function attachMap(map){if(!map||typeof map.relayout!=='function')throw new TypeError('A Kakao map instance with relayout() is required');state.map=map;mapWidth=0;mapHeight=0;relayout();}
    function init(){
        if(initialized)return;initialized=true;var boot=$('hwBoot');state.scope=boot.dataset.viewScope==='field'?'field':'hq';state.viewKind=boot.dataset.viewKind==='general'?'general':'admin';state.season=['summer','winter'].indexOf(boot.dataset.initialMode)>=0?boot.dataset.initialMode:'def';window.wtabmode='wtab'+state.season;
        ['def','summer','winter'].forEach(function(mode){on($('wtab'+mode),'click',function(){setMode(mode);});});
        on($('hwTabNow'),'click',function(){setTime('now');});on($('hwTabTmr'),'click',function(){setTime('tomorrow');});on($('hwxScope'),'change',function(e){setScope(e.target.value);});
        on($('hwxSelectedMore'),'click',function(){var f=selected();if(f)openAlerts(null,f.id);});
        on($('hwxSearchOpen'),'click',function(){openFields({},'현장 검색');});document.querySelectorAll('[data-hwx-search]').forEach(function(b){on(b,'click',function(){openFields({},'현장 검색');});});
        document.querySelectorAll('[data-hwx-alerts]').forEach(function(b){on(b,'click',openAlerts);});document.querySelectorAll('[data-hwx-rules]').forEach(function(b){on(b,'click',openRules);});
        on($('hwxModalClose'),'click',closeModal);on($('hwxModalSearch'),'input',renderFieldList);on($('hwxModal'),'click',function(e){if(e.target===$('hwxModal'))closeModal();});
        on($('hwxModal'),'keydown',function(e){if(e.key==='Escape'){closeModal();e.stopPropagation();}else focusTrap(e,$('hwxModal'));});
        on(document,'fullscreenchange',relayout);on(window,'resize',relayout);
        // Own fullscreen only in the preview; production keeps the original app's click handler.
        if(boot.dataset.preview==='true')on($('hwFull'),'click',function(){var p=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();if(p&&p.catch)p.catch(function(){notify('이 브라우저에서는 전체화면 전환이 허용되지 않습니다.');});});
        if($('hwDatetime').textContent.trim()==='—')txt('hwDatetime',new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()));
        initLegacyModal();initSplitter();if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(relayout);resizeObserver.observe($('hwMap'));}
        initSummaryIcons();renderAir(null);render();document.dispatchEvent(new CustomEvent('heatwave:ui-ready',{detail:{version:version}}));
    }
    function destroy(){listenerBindings.forEach(function(b){b[0].removeEventListener(b[1],b[2],b[3]);});listenerBindings=[];if(resizeObserver)resizeObserver.disconnect();if(legacyObserver)legacyObserver.disconnect();if(labelObserver)labelObserver.disconnect();if(frame)window.cancelAnimationFrame(frame);frame=0;mapWidth=0;mapHeight=0;if(state.modal)closeModal();initialized=false;}
    window.HeatwaveDashboardUI=Object.freeze({version:version,connect:connect,update:update,selectField:selectField,attachMap:attachMap,reportError:reportError,
        setMode:setMode,setScope:setScope,setTime:setTime,openSearch:function(){openFields({},'현장 검색');},openAlerts:openAlerts,openRules:openRules,getViewState:viewState,destroy:destroy});
    // Install resource error handling before the following SDK/application script tags load.
        on(window,'error',function(e){var target=e.target;if(target && target.id==='hwKakaoSdk'){$('hwxMapError').hidden=false;notify('카카오 지도 SDK를 불러오지 못했습니다. HTTPS 접속과 키·허용 도메인을 확인하세요.',true);}if(target && target.id==='hwLegacyApp')notify('기존 heatwave-dashboard-app.js를 불러오지 못했습니다. 파일 경로·배포 상태를 확인하세요.',true);},true);
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
}(window,document));
