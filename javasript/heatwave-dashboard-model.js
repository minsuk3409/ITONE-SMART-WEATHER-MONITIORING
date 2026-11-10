/**
 * HeatwaveDashboardModel 20260928.1 — pure, dependency-free presentation model.
 * Summer thresholds preserve the original screen. Winter thresholds are provisional
 * until the owner supplies confirmed ranges; neither is a KMA warning decision.
 * No network access, guessing of endpoint names, or synthetic production data.
 * API fields must be translated explicitly at the adapter boundary; see DATA_CONTRACT.md.
 */
(function (root, factory) {
    'use strict';
    var model = factory();
    if (typeof module === 'object' && module.exports) module.exports = model;
    else root.HeatwaveDashboardModel = model;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    var regions = ['서울','경기','인천','강원','충북','충남','대전','경북','대구','경남','부산','울산','전북','전남','광주','제주'];
    var regionNames = {
        '서울특별시':'서울','경기도':'경기','인천광역시':'인천','강원도':'강원','강원특별자치도':'강원',
        '충청북도':'충북','충청남도':'충남','세종':'충남','세종특별자치시':'충남','대전광역시':'대전',
        '경상북도':'경북','대구광역시':'대구','경상남도':'경남','부산광역시':'부산','울산광역시':'울산',
        '전라북도':'전북','전북특별자치도':'전북','전라남도':'전남','광주광역시':'광주','제주도':'제주','제주특별자치도':'제주'
    };
    // 집계표의 '세종→충남' 묶음과 달리 공식 특보 판정에서는 17개 시도를 각각 구분한다.
    var warningProvinces = Object.assign({}, regionNames, {'세종':'세종','세종특별자치시':'세종'});
    var warningMetros = ['서울','부산','대구','인천','광주','대전','울산','세종'];
    var grades = ['normal','attention','caution','danger','alert','unknown'];
    var gradeNames = {normal:'정상',attention:'관심',caution:'주의보',danger:'경보',alert:'위험',unknown:'미확인'};
    var types = {heat:'폭염',cold:'한파',rain:'호우',wind:'강풍',sea:'풍랑',typhoon:'태풍',snow:'대설',dry:'건조',dust:'황사',other:'기타'};
    var typeOrder = {heat:0,cold:0,rain:1,wind:2,sea:3,typhoon:4,snow:5,dry:6,dust:7,other:8};
    var levelNames = {severe:'중대경보',warning:'경보',advisory:'주의보'};
    var levelOrder = {severe:0,warning:1,advisory:2};
    var headquarters = ['건축','토목','플랜트','글로벌'];
    var headquartersNames = {'건축':'건축사업본부','토목':'토목사업본부','플랜트':'플랜트사업본부','글로벌':'글로벌인프라본부'};
    function text(value) { return value == null ? '' : String(value).trim(); }
    function number(value, min, max) {
        if (typeof value !== 'number' && typeof value !== 'string') return null;
        if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
        var n = Number(value);
        return Number.isFinite(n) && (min == null || n >= min) && (max == null || n <= max) ? n : null;
    }
    function region(value) {
        var r = text(value);
        return regionNames[r] || (regions.indexOf(r) >= 0 ? r : '미분류');
    }
    function quality(value, fallback) {
        return ['ok','stale','error','missing','unknown'].indexOf(value) >= 0 ? value : (fallback || 'unknown');
    }
    function weather(value) {
        if (!value || typeof value !== 'object') return null;
        return {
            temperature:number(value.temperature,-100,70), feelsLike:number(value.feelsLike,-100,100),
            humidity:number(value.humidity,0,100), windSpeed:number(value.windSpeed,0,200), windDirection:number(value.windDirection,0,360),
            rain:number(value.rain,0,10000), snow:number(value.snow,0,10000), rainText:text(value.rainText),
            dailyMaxFeelsLike:number(value.dailyMaxFeelsLike,-100,100), dailyMinFeelsLike:number(value.dailyMinFeelsLike,-100,100),
            observedAt:text(value.observedAt), validAt:text(value.validAt), source:text(value.source), quality:quality(value.quality)
        };
    }
    function air(value) {
        if (!value || typeof value !== 'object') return null;
        var allowed = ['good','normal','bad','verybad'];
        return {pm10:number(value.pm10,0,10000), pm25:number(value.pm25,0,10000),
            pm10Grade:allowed.indexOf(value.pm10Grade) >= 0 ? value.pm10Grade : null,
            pm25Grade:allowed.indexOf(value.pm25Grade) >= 0 ? value.pm25Grade : null,
            station:text(value.station), observedAt:text(value.observedAt), quality:quality(value.quality)};
    }
    function normalizeAlerts(value, expectedStatus) {
        expectedStatus = expectedStatus || 'active';
        if (!Array.isArray(value)) return null; // null=not verified; []=verified no active warnings.
        var seen = new Set(), result = [], unknown = false;
        value.forEach(function (a) {
            if (!a || typeof a !== 'object') { unknown = true; return; }
            if (a.status === 'cancelled' || a.status === 'expired' || a.status === 'inactive') return;
            if (a.status !== expectedStatus || !Object.prototype.hasOwnProperty.call(levelNames,a.level)) { unknown = true; return; }
            var type = Object.prototype.hasOwnProperty.call(types,a.type) ? a.type : 'other';
            var key = type + ':' + a.level; // Same event received twice counts once per site/type/severity.
            if (seen.has(key)) return;
            seen.add(key);
            result.push({id:text(a.id), type:type, level:a.level, name:type === 'other' && text(a.name) ? text(a.name) : types[type]+levelNames[a.level],
                status:expectedStatus,issuedAt:text(a.issuedAt),validAt:text(a.validAt), source:text(a.source)});
        });
        result.sort(sortAlerts);
        // Preserve active records even with an unrecognized sibling; mark incomplete separately.
        return {items:result, complete:!unknown};
    }
    function sortAlerts(a,b) { return typeOrder[a.type]-typeOrder[b.type] || levelOrder[a.level]-levelOrder[b.level] || a.name.localeCompare(b.name,'ko'); }
    function warningRegion(value) {
        // Kakao SDK의 행정동(H)만 사용한다. 법정동(B)·측정소명·지도 중심은 판정 근거가 아니다.
        if (!value || value.region_type !== 'H') return null;
        var original=text(value.region_1depth_name), province=warningProvinces[original] || (regions.indexOf(original)>=0 || original==='세종' ? original : '');
        if (!province) return null;
        var municipality=text(value.region_2depth_name).split(/\s+/)[0];
        if (municipality && !/^[가-힣]+$/.test(municipality)) return null;
        if (!municipality && province!=='세종') return null; // 시군구 누락 응답을 정상 행정구역으로 확정하지 않는다.
        municipality=municipality.replace(warningMetros.indexOf(province)>=0 ? /(?:구|군)$/ : /(?:시|군)$/, '');
        return {province:province,municipality:municipality,address:[original,text(value.region_2depth_name),text(value.region_3depth_name)].filter(Boolean).join(' ')};
    }
    function warningScopeMatch(scope, target) {
        if (!scope || typeof scope.whole!=='boolean' || typeof scope.ambiguous!=='boolean' || !Array.isArray(scope.municipalities)) return -1;
        if (scope.province===null) return scope.whole && !scope.ambiguous ? 1 : -1;
        if (typeof scope.province!=='string' || (regions.indexOf(scope.province)<0 && scope.province!=='세종')) return -1;
        if (scope.province!==target.province) return 0;
        if (scope.ambiguous) return -1;
        if (scope.whole) return 1;
        if (!target.municipality || !scope.municipalities.length || scope.municipalities.some(function(city){return typeof city!=='string' || !/^[가-힣]+$/.test(city);})) return -1;
        return scope.municipalities.indexOf(target.municipality)>=0 ? 1 : 0;
    }
    function evaluateWarningScopes(snapshot, administrativeRegion) {
        // 서버가 키/회사/현장을 검증하고 만든 공식 구역만 SDK 행정구역에 대조한다.
        // 행정구역은 화면 표시용이며 서버의 조회 권한 또는 회사 범위에 전달하지 않는다.
        var result=Object.assign({},snapshot,{alerts:null,alertsComplete:false,scheduledAlerts:null,scheduledAlertsComplete:false});
        if (!snapshot || ['ok','scheduled'].indexOf(snapshot.alertsQuality)<0) return result;
        function invalid(){result.alertsQuality='error';result.alertsReason='INVALID_WARNING_SCOPE_RESPONSE';return result;}
        if (snapshot.warningScopeVersion!==1 || typeof snapshot.warningNationwideClear!=='boolean' || !Array.isArray(snapshot.warningScopes) || snapshot.warningScopes.length>64) return invalid();
        var checked=Date.parse(snapshot.alertsCheckedAt),effective=Date.parse(snapshot.alertsValidAt);
        if (!Number.isFinite(checked) || !Number.isFinite(effective)) return invalid();
        var scheduled=snapshot.alertsQuality==='scheduled' || effective>checked;
        var target=warningRegion(administrativeRegion);
        if (!target) {result.alertsQuality='mapping_required';result.alertsReason='COORDINATE_REGION_UNAVAILABLE';return result;}
        result.alertsRegion=target.address;
        // 미래 무특보 자료도 현재 '없음'으로 변환하지 않는다. 발효 이후 서버에 다시 조회한다.
        if (!scheduled && snapshot.warningNationwideClear && !snapshot.warningScopes.length) {
            result.alerts=[];result.alertsQuality='ok';result.alertsComplete=true;result.alertsReason='NO_ACTIVE_WARNING';return result;
        }
        if (!snapshot.warningScopes.length && !scheduled) return invalid();
        var alerts=[],unknown=false;
        snapshot.warningScopes.forEach(function(warning){
            if (!warning || !Object.prototype.hasOwnProperty.call(types,warning.type) || !Object.prototype.hasOwnProperty.call(levelNames,warning.level)
                || !Array.isArray(warning.scopes) || !warning.scopes.length || warning.scopes.length>128) {unknown=true;return;}
            var matches=false,uncertain=false;
            warning.scopes.forEach(function(scope){var match=warningScopeMatch(scope,target);if(match===1)matches=true;else if(match===-1)uncertain=true;});
            if (matches) alerts.push(Object.assign({},warning,{status:scheduled?'scheduled':'active'}));
            else if (uncertain) unknown=true;
        });
        var normalized=normalizeAlerts(alerts,scheduled?'scheduled':'active');
        if (scheduled) {
            result.alertsQuality='scheduled';result.alertsReason='SCHEDULED_WARNING';
            result.scheduledAlerts=normalized.items;result.scheduledAlertsComplete=!unknown && normalized.complete;
        } else {
            result.alerts=normalized.items;result.alertsQuality=unknown?'partial':'ok';result.alertsComplete=!unknown && normalized.complete;
            result.alertsReason=unknown?'WARNING_AREA_MAPPING_REQUIRED':alerts.length?'ACTIVE_WARNING':'NO_ACTIVE_WARNING';
        }
        return result;
    }
    // 발표 이력과 공식 활성 특보는 별도 계약이다. 제목에 경보가 있어도 active로 변환하지 않는다.
    function normalizeReports(value) {
        if (!Array.isArray(value)) return [];
        var seen=new Set(), rows=[];
        value.forEach(function(r){
            if(!r || !text(r.title))return;
            var item={region:text(r.region),stnId:text(r.stnId),title:text(r.title),issuedAt:text(r.issuedAt)};
            var key=[item.region,item.stnId,item.issuedAt,item.title].join('|');
            if(!seen.has(key)){seen.add(key);rows.push(item);}
        });
        return rows.sort(function(a,b){return b.issuedAt.localeCompare(a.issuedAt);});
    }
    function normalizeSnapshot(input) {
        if (!input || !Array.isArray(input.fields)) throw new TypeError('snapshot.fields must be an array');
        var rows = new Map(), diagnostics = {duplicates:0,invalidIds:0};
        input.fields.forEach(function (f) {
            if (!f || !text(f.id)) { diagnostics.invalidIds++; return; }
            var id=text(f.id), a=normalizeAlerts(f.alerts), scheduled=normalizeAlerts(f.scheduledAlerts,'scheduled');
            if (rows.has(id)) diagnostics.duplicates++;
            rows.set(id,{id:id,siteCd:text(f.siteCd),name:text(f.name)||id,address:text(f.address),originalRegion:text(f.region),
                region:region(f.region),hq:text(f.hq)||'미분류',lat:number(f.lat,-90,90),lng:number(f.lng,-180,180),
                weather:{now:weather(f.weather && f.weather.now),tomorrow:weather(f.weather && f.weather.tomorrow)},
                air:air(f.air),alerts:a && (f.alertsQuality === 'ok' || f.alertsQuality === 'partial') ? a.items : null,
                alertsComplete:a ? a.complete && f.alertsQuality === 'ok' && f.alertsComplete !== false : false,
                scheduledAlerts:scheduled && f.alertsQuality==='scheduled' ? scheduled.items : null,
                scheduledAlertsComplete:scheduled ? scheduled.complete && f.scheduledAlertsComplete!==false : false,
                alertsQuality:text(f.alertsQuality),alertsReason:text(f.alertsReason),alertsCheckedAt:text(f.alertsCheckedAt),
                alertsIssuedAt:text(f.alertsIssuedAt),alertsValidAt:text(f.alertsValidAt),alertsSource:text(f.alertsSource),alertsRegion:text(f.alertsRegion),
                reports:normalizeReports(f.reports),reportsQuality:text(f.reportsQuality)||'unknown'});
        });
        return {fields:Array.from(rows.values()),selectedFieldId:text(input.selectedFieldId),updatedAt:text(input.updatedAt),
            complete:input.complete === true && diagnostics.invalidIds === 0 && diagnostics.duplicates === 0,
            source:text(input.source),diagnostics:diagnostics,reports:normalizeReports(input.reports),
            reportsQuality:text(input.reportsQuality)||'unknown',detailsFetchedAt:text(input.detailsFetchedAt),
            alertsCheckedAt:text(input.alertsCheckedAt),alertsIssuedAt:text(input.alertsIssuedAt),alertsSource:text(input.alertsSource),
            reportWindowHours:number(input.reportWindowHours,1,168)};
    }
    function grade(value, season) {
        var t=number(value,-100,100);
        if (t === null) return 'unknown';
        if (season === 'winter') {
            if (t >= -9) return 'normal';
            if (t > -12) return 'attention';
            if (t > -15) return 'caution';
            if (t > -18) return 'danger';
            return 'alert';
        }
        if (season === 'def') {
            var hot=grade(t,'summer'),cold=grade(t,'winter');
            return grades.indexOf(hot) > grades.indexOf(cold) ? hot : cold;
        }
        if (t >= 38) return 'alert';
        if (t >= 35) return 'danger';
        if (t >= 33) return 'caution';
        if (t >= 31) return 'attention';
        return 'normal';
    }
    function fieldGrade(field, season, time) {
        var w=field.weather[time];
        return w && w.quality === 'ok' ? grade(w.feelsLike,season) : 'unknown';
    }
    function counts(rows,season,time) {
        var c={normal:0,attention:0,caution:0,danger:0,alert:0,unknown:0,total:rows.length};
        rows.forEach(function(f){c[fieldGrade(f,season,time)]++;});
        return c;
    }
    function aggregate(rows,key,season,time) {
        var names=key === 'region' ? regions.slice() : [];
        rows.forEach(function(f){if(names.indexOf(f[key]) < 0) names.push(f[key]);});
        return names.map(function(name){var fields=rows.filter(function(f){return f[key]===name;});return {name:name,fields:fields,counts:counts(fields,season,time)};});
    }
    function hasWarning(field) {
        return Array.isArray(field.alerts) && field.alerts.some(function(a){return a.status==='active' && (a.level==='warning' || a.level==='severe');});
    }
    function alertSummary(fields) {
        var groups=new Map(),affected=new Set(),warningAffected=new Set(),unknown=0;
        fields.forEach(function(f){
            if(!f.alertsComplete) unknown++;
            if(hasWarning(f)) warningAffected.add(f.id);
            if(!f.alerts) return;
            f.alerts.forEach(function(a){
                var key=a.type+':'+a.level;
                if(!groups.has(key)) groups.set(key,{key:key,type:a.type,level:a.level,name:a.name,fields:new Map(),regions:new Map()});
                var g=groups.get(key);
                if(!g.fields.has(f.id)) {g.fields.set(f.id,f);g.regions.set(f.region,(g.regions.get(f.region)||0)+1);}
                affected.add(f.id);
            });
        });
        var list=Array.from(groups.values()).map(function(g){g.count=g.fields.size;g.fields=Array.from(g.fields.values());g.regions=Array.from(g.regions.entries()).sort(function(a,b){var ia=regions.indexOf(a[0]),ib=regions.indexOf(b[0]);return (ia<0?99:ia)-(ib<0?99:ib);});return g;});
        list.sort(sortAlerts);
        return {groups:list,affected:affected.size,warningAffected:warningAffected.size,unknown:unknown};
    }
    function headquartersOverview(fields) {
        var names=headquarters.slice();
        fields.forEach(function(f){if(names.indexOf(f.hq)<0)names.push(f.hq);});
        return names.map(function(name){var rows=fields.filter(function(f){return f.hq===name;});
            return {name:name,label:headquartersNames[name]||name,fields:rows,total:rows.length,alerts:alertSummary(rows)};
        });
    }
    function wind(value) {
        var n=number(value,0,360),names=['북','북북동','북동','동북동','동','동남동','남동','남남동','남','남남서','남서','서남서','서','서북서','북서','북북서'];
        return n === null ? '—' : names[Math.round(n/22.5)%16];
    }
    function search(rows,query) {
        var q=text(query).toLocaleLowerCase('ko').replace(/\s/g,'');
        return rows.filter(function(f){return (f.name+' '+f.address+' '+f.region+' '+f.hq).toLocaleLowerCase('ko').replace(/\s/g,'').indexOf(q)>=0;});
    }
    function thresholds(season) {
        if (season === 'def') return {
            normal:'−9℃ 이상 ~ 31℃ 미만 (고온·저온 통합)',
            attention:'고온 31℃ 이상 ~ 33℃ 미만 / 저온 −12℃ 초과 ~ −9℃ 미만',
            caution:'고온 33℃ 이상 ~ 35℃ 미만 / 저온 −15℃ 초과 ~ −12℃ 이하',
            danger:'고온 35℃ 이상 ~ 38℃ 미만 / 저온 −18℃ 초과 ~ −15℃ 이하',
            alert:'고온 38℃ 이상 / 저온 −18℃ 이하',unknown:'유효 자료 없음'
        };
        return season === 'winter' ? {normal:'−9℃ 이상',attention:'−12℃ 초과 ~ −9℃ 미만',caution:'−15℃ 초과 ~ −12℃ 이하',danger:'−18℃ 초과 ~ −15℃ 이하',alert:'−18℃ 이하',unknown:'유효 자료 없음'} :
            {normal:'31℃ 미만',attention:'31℃ 이상 ~ 33℃ 미만',caution:'33℃ 이상 ~ 35℃ 미만',danger:'35℃ 이상 ~ 38℃ 미만',alert:'38℃ 이상',unknown:'유효 자료 없음'};
    }
    return Object.freeze({regions:regions,grades:grades,gradeNames:gradeNames,types:types,levelNames:levelNames,number:number,text:text,region:region,
        normalizeSnapshot:normalizeSnapshot,normalizeReports:normalizeReports,warningRegion:warningRegion,evaluateWarningScopes:evaluateWarningScopes,
        grade:grade,fieldGrade:fieldGrade,counts:counts,aggregate:aggregate,alertSummary:alertSummary,hasWarning:hasWarning,headquartersOverview:headquartersOverview,wind:wind,search:search,thresholds:thresholds});
}));
