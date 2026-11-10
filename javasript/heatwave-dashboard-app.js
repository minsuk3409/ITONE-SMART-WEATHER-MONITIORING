/* 폭염작업 모니터링 대시보드 (무세션 + 회사코드 게이팅)
 * - 진입: /ctrlmnt/heatwave-dashboard.html?dispKey=<field키>&fieldId=DW10009 (기존 관제 catch-all 재사용)
 * - 데이터: GET /v1/ctrlmnt/heatwave/fields/{dispKey}/{fieldId}  (heatwave.listFieldGrade, companyCd는 fieldId에서 서버 유도)
 * - 기상 일괄조회 + 보조정보 조회를 사용한다. 대우 특보는 DB 좌표와 기존 Kakao JS SDK 행정구역을 연결한다.
 * @author leewy
 *
 * 현재/내일 토글: 현재=활성 온습도계 등록 현장은 센서, 그 외는 기상청 캐시. 내일=기상청 단기예보 극한 근사.
 * 본부(hq)는 field_type_code 기반 잠정 매핑(매퍼). 강수/풍속/풍향은 현재값만 보유(내일은 '-').
 */

/* 폭염 5등급(임계) : 5=중대경보(>=38) / 4=경보(>=35) / 3=주의보(>=33) / 2=관심(>=31) / 1=정상(<31), 0=미수신 */
var HW_GRADE = {
	5: { name: "폭염중대경보", color: "#E53935" },
	4: { name: "폭염경보",     color: "#FB8C00" },
	3: { name: "폭염주의보",   color: "#FDD835" },
	2: { name: "관심",         color: "#1E88E5" },
	1: { name: "정상",         color: "#7CB342" },
	0: { name: "미수신",       color: "#9E9E9E" }
};

/* 집계표 헤더(시안) : 온도 임계 + 등급명 + 등급색 배경 (좌→우 5~1) */
var HW_GRADE_HEAD = [
	{ g: 5, temp: "38℃ 이상", name: "폭염중대경보", bg: "#E53935", fg: "#fff" },
	{ g: 4, temp: "35℃ 이상", name: "폭염경보",     bg: "#FB8C00", fg: "#fff" },
	{ g: 3, temp: "33℃ 이상", name: "폭염주의보",   bg: "#FDD835", fg: "#1a1a1a" },
	{ g: 2, temp: "31℃ 이상", name: "관심",         bg: "#1E88E5", fg: "#1a1a1a" },
	{ g: 1, temp: "31℃ 이하", name: "정상",         bg: "#7CB342", fg: "#1a1a1a" }
];

/* 집계표 행 순서 — 지역(시안 16 + 세종/미지정), 본부(시안 4 + 기타) */
var HW_REGIONS = ["서울","경기","인천","강원","충북","충남","대전","세종","경북","대구","경남","부산","울산","전북","전남","광주","제주","미지정"];
var HW_HQS = ["건축","토목","플랜트","글로벌","기타"];
var HW_HQ_LABEL = { "건축":"건축사업본부", "토목":"토목사업본부", "플랜트":"플랜트사업본부", "글로벌":"글로벌 인프라 본부" };	/* 본부 집계표 표시명 (기타는 그대로) */
var HW_ALERT_TYPES = ["강풍","대설","한파","폭염","태풍","호우"];

/* [설정] 대시보드 조회 제외 현장코드 (지도·집계·위젯 전부에서 빠짐)
   사유: 좌표 중복 + DW 측 제외 요청  (DW10004·DW10009=G-TOWN 은 유지) */
var HW_EXCLUDE_FIELDS = ["DW10001","DW10002","DW10007","DW10010"];

/* 풍향 16방위(도→한글) */
var COMPASS_16 = ["북","북북동","북동","동북동","동","동남동","남동","남남동","남","남남서","남서","서남서","서","서북서","북서","북북서"];

var hwMap = null;
var hwOverlays = [];
var hwMarkerByFieldId = Object.create(null); // 계절 전환·자동 갱신에도 같은 현장의 마커 DOM을 유지한다.
var hwRows = [];
var hwDataFresh = false; // 조회 실패 시 이전 현장을 최신 등급으로 표시하지 않는다.
var hwMode = "now";			// now | tomorrow
var hwSelected = null;		// 선택 현장 row
var hwGeocoder = null;		// 기존 JS 키의 행정구역 역지오코더 (브레드크럼·대우 특보)
var hwInitDone = false;		// 첫 로딩 시 URL 파라미터 현장 자동 선택 (1회)
var hwCompanyCd = "";		// 진입 현장에서 유도한 회사코드 (DW1/HW1/HS1/기타)
var hwAlertRows = [];		// 특보 화면 회사의 기상특보 최근 조회 결과
var hwAlertAreaNm = "";		// 기상특보 지점명
var hwAlertFieldNm = "";	// 특보 기준이 되는 선택 현장명
var hwAlertFieldId = "";	// 현재 기상특보 조회 대상 현장ID
var hwAlertRequestSeq = 0;	// 현장 전환 시 이전 특보 응답 무시용 요청 순번
var hwAlertTimer = null;	// 기상특보 5분 갱신 타이머

/* 주소·대기질·특보 발표자료는 권한 검증된 일괄 API로 5분마다 보완한다.
 * 발표 제목만으로 현재 발효 현장 수를 추정하지 않는다. 기존 날씨 15초 갱신과 독립적이다. */
var hwDetailById = Object.create(null);
var hwReports = [];
var hwDetailsQuality = "unknown";
var hwDetailsFetchedAt = "";
var hwDetailLastAttempt = 0;
var hwDetailPending = false;
var hwWarningMeta = {};
// 서버가 선택 권한과 DB 좌표를 검증한다. SDK 행정구역은 화면에서만 공식 특보구역과 대조한다.
var hwCoordinateWarnings = Object.create(null);
var hwCoordinateWarningPending = null;
var hwCoordinateWarningSeq = 0;
var hwCoordinateRegions = new Map();
var hwCoordinateRegionPending = new Map();
var hwCoordinateWarningBackground = Object.create(null);
var hwCoordinateWarningBackgroundCount = 0; // 선택 현장 1개와 별도로 전체 집계는 최대 2개만 병렬 조회한다.
var hwCoordinateWarningNextIndex = 0;
var hwCoordinateWarningPublishTimer = null;

function resolveWarningRegion(row) {
	var lat=heatwaveNumber(row.latitude), lng=heatwaveNumber(row.longitude), key=[lat,lng].join("|");
	if (lat===null || lng===null || lat<33 || lat>39 || lng<124 || lng>132) {
		return Promise.resolve({region:null, reason:"INVALID_FIELD_COORDINATES"});
	}
	var entry=hwCoordinateRegions.get(key), now=Date.now();
	if (entry && now-entry.at < (entry.region ? 86400000 : 60000)) {
		hwCoordinateRegions.delete(key); hwCoordinateRegions.set(key,entry);
		return Promise.resolve(entry);
	}
	if (!hwGeocoder || typeof kakao==="undefined" || !kakao.maps.services) {
		// SDK 로드 전 실패는 캐시하지 않는다. 초기화 직후 선택 현장을 다시 연결한다.
		return Promise.resolve({region:null, reason:"COORDINATE_SDK_NOT_READY"});
	}
	if (hwCoordinateRegionPending.has(key)) { return hwCoordinateRegionPending.get(key); }
	if (hwCoordinateRegionPending.size>=32) { return Promise.resolve({region:null, reason:"COORDINATE_SDK_BUSY"}); }
	var request=new Promise(function(resolve) {
		var done=false, timer=setTimeout(function(){finish(null,"COORDINATE_SDK_TIMEOUT");},8000);
		function finish(region,reason) {
			if (done) { return; } done=true;clearTimeout(timer);
			var result={region:region,reason:reason,at:Date.now()};
			hwCoordinateRegions.delete(key);hwCoordinateRegions.set(key,result);
			while(hwCoordinateRegions.size>512) { hwCoordinateRegions.delete(hwCoordinateRegions.keys().next().value); }
			resolve(result);
		}
		try {
			// 경도(x), 위도(y). H 결과만 인정하며 지도 중심/B 결과로 대체하지 않는다.
			hwGeocoder.coord2RegionCode(lng,lat,function(records,status) {
				if (status!==kakao.maps.services.Status.OK || !Array.isArray(records)) { finish(null,"COORDINATE_SDK_FAILED");return; }
				var candidates=records.filter(function(item){return item && item.region_type==="H";});
				var valid=candidates.map(window.HeatwaveDashboardModel.warningRegion);
				if (!valid.length || valid.some(function(item){return !item;}) || valid.some(function(item){return item.province!==valid[0].province || item.municipality!==valid[0].municipality;})) {
					finish(null,"COORDINATE_REGION_UNAVAILABLE");return;
				}
				finish(candidates[0],"");
			});
		} catch (error) { finish(null,"COORDINATE_SDK_FAILED"); }
	});
	hwCoordinateRegionPending.set(key,request);
	return request.then(function(result){hwCoordinateRegionPending.delete(key);return result;});
}

function coordinateWarningKey(row) {
	return row ? [String(row.fieldId), heatwaveNumber(row.latitude), heatwaveNumber(row.longitude)].join("|") : "";
}

function coordinateWarningFor(row) {
	var entry = hwCoordinateWarnings[String(row.fieldId)];
	return entry && entry.key === coordinateWarningKey(row) ? entry : null;
}

function cancelSelectedWarningRequest() {
	hwCoordinateWarningSeq++;
	if (hwCoordinateWarningPending && hwCoordinateWarningPending.controller) { hwCoordinateWarningPending.controller.abort(); }
	hwCoordinateWarningPending = null;
}

function coordinateWarningDue(row, force) {
	var entry=coordinateWarningFor(row),now=Date.now(),quality=entry && entry.result.alertsQuality;
	if (force || !entry || quality==="loading") { return true; }
	if (entry.result.alertsReason==="COORDINATE_SDK_NOT_READY" && hwGeocoder) { return true; }
	var validAt=Date.parse(entry.result.alertsValidAt);
	if (quality==="scheduled" && validAt<=now) {
		// 발효시각 직후 한 번은 즉시 재조회한다. 원천 캐시가 아직 예정 자료면 15초 갱신 간격을 지킨다.
		return entry.attemptedAt<validAt || now-entry.attemptedAt>=15000;
	}
	return now-entry.attemptedAt >= (quality==="ok" || quality==="partial" ? 300000 : 60000);
}

function coordinateWarningRowIsCurrent(row) {
	var key=coordinateWarningKey(row);
	return hwDataFresh && hwCompanyCd==="DW1" && hwRows.some(function(item){return coordinateWarningKey(item)===key;});
}

// 선택 조회와 전체 집계 모두 같은 권한 검증 API·DB 좌표·SDK 행정구역 계약을 사용한다.
function requestCoordinateWarnings(row, controller, current) {
	var id=String(row.fieldId),key=coordinateWarningKey(row),options={headers:{"Accept":"application/json"}};
	if (controller) { options.signal=controller.signal; }
	var url=ctx+"/v1/ctrlmnt/heatwave/warnings/"+encodeURIComponent(DISP_KEY)+"/"+encodeURIComponent(PARAM_FIELD_ID)
		+"?targetFieldId="+encodeURIComponent(id);
	return fetch(url,options)
		.then(function(response){if(!response.ok){throw new Error("Warning request failed");}return response.json();})
		.then(function(data){
			if (!current()) { return; }
			var result=data && data.result;
			if (!result || String(result.fieldId)!==id || ["ok","scheduled","mapping_required","error","stale"].indexOf(result.alertsQuality)<0
				|| typeof result.alertsComplete!=="boolean" || coordinateWarningKey(result)!==key) { throw new Error("Invalid warning response"); }
			if (result.alertsQuality!=="ok" && result.alertsQuality!=="scheduled") { return result; }
			return resolveWarningRegion(result).then(function(mapping){
				if (!current()) { return; }
				var evaluated=window.HeatwaveDashboardModel.evaluateWarningScopes(result,mapping.region);
				if (!mapping.region && evaluated.alertsQuality==="mapping_required") { evaluated.alertsReason=mapping.reason; }
				return evaluated;
			});
		});
}

function cancelBackgroundWarningRequest(id) {
	var pending=hwCoordinateWarningBackground[id];
	if (!pending) { return; }
	pending.cancelled=true;
	if (pending.controller) { pending.controller.abort(); }
}

function publishBackgroundWarnings() {
	if (hwCoordinateWarningPublishTimer!==null) { return; }
	hwCoordinateWarningPublishTimer=setTimeout(function(){
		hwCoordinateWarningPublishTimer=null;
		if (hwDataFresh && hwCompanyCd==="DW1") { publishDashboardSnapshot(); }
	},100);
}

function startBackgroundWarningRequest(row) {
	var id=String(row.fieldId),key=coordinateWarningKey(row),now=Date.now();
	var controller=typeof AbortController==="function" ? new AbortController() : null;
	var pending={key:key,controller:controller,cancelled:false};
	hwCoordinateWarningBackground[id]=pending;hwCoordinateWarningBackgroundCount++;
	function current(){return !pending.cancelled && hwCoordinateWarningBackground[id]===pending && coordinateWarningRowIsCurrent(row);}
	var rejectTimeout,timer;
	var timeout=new Promise(function(resolve,reject){rejectTimeout=reject;});
	timer=setTimeout(function(){if(controller)controller.abort();rejectTimeout(new Error("Warning lookup timeout"));},18000);
	if (!coordinateWarningFor(row)) {
		hwCoordinateWarnings[id]={key:key,attemptedAt:now,result:{alertsQuality:"loading",alerts:null,alertsComplete:false}};
	}
	Promise.race([requestCoordinateWarnings(row,controller,current),timeout])
		.then(function(result){if(current() && result){hwCoordinateWarnings[id]={key:key,attemptedAt:now,result:result};publishBackgroundWarnings();}})
		.catch(function(){
			if (current()) {
				hwCoordinateWarnings[id]={key:key,attemptedAt:now,result:{alertsQuality:"error",alertsReason:"COORDINATE_WARNING_REQUEST_FAILED",alerts:null,alertsComplete:false}};
				publishBackgroundWarnings();
			}
		})
		.then(function(){
			clearTimeout(timer);
			if (hwCoordinateWarningBackground[id]===pending) { delete hwCoordinateWarningBackground[id]; }
			hwCoordinateWarningBackgroundCount--;
			loadBackgroundWarnings();
		});
}

function loadBackgroundWarnings() {
	Object.keys(hwCoordinateWarningBackground).forEach(function(id){
		var pending=hwCoordinateWarningBackground[id];
		if (!hwDataFresh || hwCompanyCd!=="DW1" || !hwRows.some(function(row){return coordinateWarningKey(row)===pending.key;})) {
			cancelBackgroundWarningRequest(id);
		}
	});
	// SDK 준비 전에는 전체 현장에 동일한 실패 요청을 보내지 않는다. 준비 후·15초 갱신 때 다시 진행한다.
	if (!hwDataFresh || hwCompanyCd!=="DW1" || !hwGeocoder) { return; }
	for (var i=0;i<hwRows.length && hwCoordinateWarningBackgroundCount<2;i++) {
		// 앞쪽 현장의 지연·오류 재시도가 뒤쪽 현장의 첫 조회를 계속 밀지 않도록 순환한다.
		var index=hwCoordinateWarningNextIndex%hwRows.length;
		hwCoordinateWarningNextIndex=(index+1)%hwRows.length;
		var row=hwRows[index],id=String(row.fieldId);
		if ((hwSelected && String(hwSelected.fieldId)===id) || hwCoordinateWarningBackground[id]
			|| (hwCoordinateWarningPending && hwCoordinateWarningPending.key===coordinateWarningKey(row)) || !coordinateWarningDue(row,false)) { continue; }
		startBackgroundWarningRequest(row);
	}
}

function loadSelectedWarnings(force) {
	var row = hwSelected;
	if (!row || !coordinateWarningRowIsCurrent(row)) { cancelSelectedWarningRequest(); return; }
	var key = coordinateWarningKey(row), id = String(row.fieldId), entry = coordinateWarningFor(row), now = Date.now();
	if (hwCoordinateWarningPending) {
		if (hwCoordinateWarningPending.key === key) { return; }
		cancelSelectedWarningRequest();
	}
	// 현장 이동으로 취소된 loading 캐시는 복귀 시 즉시 재조회한다. 실행 중 중복은 위 pending 검사로 막는다.
	if (!coordinateWarningDue(row,force)) { return; }
	// 전체 집계 중인 현장도 사용자가 선택하면 선택 조회로 전환해 응답을 우선한다.
	cancelBackgroundWarningRequest(id);
	var seq = ++hwCoordinateWarningSeq;
	var controller = typeof AbortController === "function" ? new AbortController() : null;
	hwCoordinateWarningPending = {key:key, controller:controller};
	var rejectTimeout;
	// 서버 조회 + SDK 응답 대기를 제한한다. 취소할 수 없는 SDK의 늦은 callback도 화면을 덮어쓰지 못한다.
	var timeout=new Promise(function(resolve,reject){rejectTimeout=reject;});
	var timer=setTimeout(function(){if(controller)controller.abort();rejectTimeout(new Error("Warning lookup timeout"));},18000);
	if (!entry) {
		hwCoordinateWarnings[id] = {key:key, attemptedAt:now, result:{alertsQuality:"loading", alerts:null, alertsComplete:false}};
		publishDashboardSnapshot();
	}
	function current() {
		return seq === hwCoordinateWarningSeq && coordinateWarningRowIsCurrent(row) && coordinateWarningKey(hwSelected) === key;
	}
	var request=requestCoordinateWarnings(row,controller,current);
	return Promise.race([request,timeout])
		.then(function(result){if(current() && result)hwCoordinateWarnings[id]={key:key,attemptedAt:now,result:result};})
		.catch(function() {
			if (current()) {
				hwCoordinateWarnings[id] = {key:key, attemptedAt:now,
					result:{alertsQuality:"error", alertsReason:"COORDINATE_WARNING_REQUEST_FAILED", alerts:null, alertsComplete:false}};
			}
		})
		.then(function() {
			if (timer) { clearTimeout(timer); }
			if (seq === hwCoordinateWarningSeq) {
				hwCoordinateWarningPending = null;
				if (current()) { publishDashboardSnapshot(); }
			}
			loadBackgroundWarnings();
		});
}

function heatwaveNumber(value) {
	if (window.HeatwaveDashboardModel) {
		var parsed = window.HeatwaveDashboardModel.number(value);
		return parsed !== null && parsed > -900 ? parsed : null;
	}
	if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") { return null; }
	var n = Number(value);
	return Number.isFinite(n) && n > -900 ? n : null;
}

/* 기상청 강수 문자열(강수없음/1.0mm/1mm 미만)을 소실시키지 않는다. */
function dashboardPrecipitation(value) {
	var raw = value == null ? "" : String(value).trim();
	if (!raw || raw === "-" || /^-\d/.test(raw)) { return {rain:null, rainText:""}; }
	if (raw === "강수없음") { return {rain:0, rainText:raw}; }
	var match = raw.match(/^(\d+(?:\.\d+)?)\s*(?:mm)?$/i);
	return {rain:match ? heatwaveNumber(match[1]) : null, rainText:raw};
}

function dashboardReportsFor(row) {
	var region = window.HeatwaveDashboardModel.region(row.sido);
	return hwReports.filter(function(report) {
		return report.region === "전국" || (region !== "미분류" && window.HeatwaveDashboardModel.region(report.region) === region);
	});
}

function toDashboardField(row) {
	var nowFeels = heatwaveNumber(row.currFeelsTpr);
	var tomorrowFeels = heatwaveNumber(row.tmrFeelsTpr);
	var detail = hwDetailById[String(row.fieldId)] || {};
	var coordinateWarning = hwCompanyCd === "DW1" ? coordinateWarningFor(row) : null;
	var warning = coordinateWarning ? coordinateWarning.result : detail;
	if (hwCompanyCd === "DW1" && !coordinateWarning && coordinateWarningKey(detail) !== coordinateWarningKey(row)) {
		// 전체 현장 갱신과 보조조회 사이에 DB 좌표가 변경되면 예전 구역의 '특보 없음'을 재사용하지 않는다.
		warning = {alertsQuality:"mapping_required", alertsReason:"COORDINATE_REGION_PENDING", alerts:null, alertsComplete:false};
	}
	var precipitation = dashboardPrecipitation(row.precipitation);
	var air = detail.air ? Object.assign({}, detail.air) : null;
	if (air && hwDetailsQuality === "error") { air.quality = "error"; }
	var alertsQuality = warning.alertsQuality || "loading";
	var alertsReason = warning.alertsReason || "";
	var checkedAt = Date.parse(warning.alertsCheckedAt || "");
	if (!coordinateWarning && hwDetailsQuality === "error") {
		alertsQuality = "error"; alertsReason = "DETAILS_ERROR";
	} else if ((alertsQuality === "ok" || alertsQuality === "partial" || alertsQuality === "scheduled") && (!Number.isFinite(checkedAt) || Date.now() - checkedAt > 600000)) {
		// 서버 캐시 5분 + 화면 갱신 5분을 넘긴 상태를 계속 현재 발효현황으로 표시하지 않는다.
		alertsQuality = "stale"; alertsReason = "STALE";
	}
	return {
		id: String(row.fieldId || ""),
		siteCd: String(row.shMappingFieldId || ""),
		name: String(row.fieldNm || row.fieldId || ""),
		address: detail.address || "",
		region: String(row.sido || ""), hq: String(row.hq || ""),
		lat: heatwaveNumber(row.latitude), lng: heatwaveNumber(row.longitude),
		weather: {
			now: {
				temperature: heatwaveNumber(row.currTemp), feelsLike: nowFeels,
				humidity: heatwaveNumber(row.humidity), rain: precipitation.rain, rainText: precipitation.rainText,
				snow: null, // 현재 수집 스키마에 정량 강설 자료가 없다.
				windSpeed: heatwaveNumber(row.windSpd), windDirection: heatwaveNumber(row.windDir),
				dailyMaxFeelsLike: heatwaveNumber(row.currMaxFeelsTpr),
				observedAt: row.temperatureFetchedAt || row.weatherFetchedAt || "",
				source: row.temperatureSource === "SENSOR" ? "온습도계" : "기상청",
				quality: nowFeels === null ? "missing" : "ok"
			},
			tomorrow: {
				temperature: heatwaveNumber(row.tmrHighTemp), feelsLike: tomorrowFeels,
				humidity: heatwaveNumber(row.tmrHumidity), rain: null,
				windSpeed: null, windDirection: null,
				observedAt: row.weatherFetchedAt || "", source: "기상청 단기예보",
				quality: tomorrowFeels === null ? "missing" : "ok"
			}
		},
		air: air, alerts: (alertsQuality === "ok" || (hwCompanyCd === "DW1" && alertsQuality === "partial")) && Array.isArray(warning.alerts) ? warning.alerts : null,
		alertsComplete: warning.alertsComplete,
		scheduledAlerts: alertsQuality === "scheduled" && Array.isArray(warning.scheduledAlerts) ? warning.scheduledAlerts : null,
		scheduledAlertsComplete: warning.scheduledAlertsComplete,
		alertsQuality: alertsQuality, alertsReason: alertsReason,
		alertsCheckedAt: warning.alertsCheckedAt || "", alertsIssuedAt: warning.alertsIssuedAt || "",
		alertsValidAt: warning.alertsValidAt || "", alertsSource: warning.alertsSource || "",
		alertsRegion: warning.alertsRegion || "",
		reports: dashboardReportsFor(row), reportsQuality: hwDetailsQuality
	};
}

function publishDashboardSnapshot(initialSelectedFieldId) {
	if (!window.HeatwaveDashboardUI) { return; }
	var snapshot = {
		fields: hwRows.map(toDashboardField),
		updatedAt: new Date().toISOString(),
		complete: false, // 기존 SQL은 좌표 없는 현장·일부 제외 현장을 포함하지 않는다.
		source: "heatwave.fields",
		reports: hwReports.filter(function(report) {
			var region = window.HeatwaveDashboardModel.region(report.region);
			return report.region === "전국" || (region !== "미분류" && hwRows.some(function(row) {
				return window.HeatwaveDashboardModel.region(row.sido) === region;
			}));
		}),
		reportsQuality: hwDetailsQuality,
		detailsFetchedAt: hwDetailsFetchedAt,
		alertsCheckedAt: hwWarningMeta.alertsCheckedAt || "",
		alertsIssuedAt: hwWarningMeta.alertsIssuedAt || "",
		alertsSource: hwWarningMeta.alertsSource || "",
		reportWindowHours: 12
	};
	snapshot.selectedFieldId = initialSelectedFieldId || (hwSelected ? hwSelected.fieldId : "");
	window.HeatwaveDashboardUI.update(snapshot);
}

function apiDashboardDetailsUrl() {
	return ctx + "/v1/ctrlmnt/heatwave/details/" + encodeURIComponent(DISP_KEY) + "/" + encodeURIComponent(PARAM_FIELD_ID);
}

function loadDashboardDetails(force) {
	var now = Date.now(), retryAfter = hwDetailsQuality === "error" ? 60000 : 300000;
	if (hwDetailPending || !hwRows.length || (!force && hwDetailLastAttempt && now - hwDetailLastAttempt < retryAfter)) { return; }
	hwDetailPending = true;
	hwDetailLastAttempt = now;
	if (!hwDetailsFetchedAt) { hwDetailsQuality = "loading"; }
	var controller = typeof AbortController === "function" ? new AbortController() : null;
	var options = {headers:{"Accept":"application/json"}};
	if (controller) { options.signal = controller.signal; }
	var timer = controller ? setTimeout(function() { controller.abort(); }, 12000) : null;
	return fetch(apiDashboardDetailsUrl(), options)
		.then(function(response) { if (!response.ok) { throw new Error("HTTP " + response.status); } return response.json(); })
		.then(function(data) {
			var result = data && data.result;
			if (!result || !Array.isArray(result.fields) || !Array.isArray(result.reports)) { throw new Error("Invalid dashboard details"); }
			var details = Object.create(null);
			result.fields.forEach(function(field) { if (field && field.fieldId) { details[String(field.fieldId)] = field; } });
			hwDetailById = details;
			hwReports = result.reports;
			hwWarningMeta = {alertsCheckedAt:result.alertsCheckedAt, alertsIssuedAt:result.alertsIssuedAt, alertsSource:result.alertsSource};
			hwDetailsQuality = "recent";
			hwDetailsFetchedAt = new Date().toISOString();
		})
		.catch(function() {
			// 부가정보 실패가 지도·현재 기상정보 조회 성공을 덮어쓰지 않게 한다.
			hwDetailsQuality = "error";
		})
		.then(function() {
			if (timer) { clearTimeout(timer); }
			hwDetailPending = false;
			if (hwDataFresh) { publishDashboardSnapshot(); }
		});
}

if (window.HeatwaveDashboardUI) {
	window.HeatwaveDashboardUI.connect({
		onSelectField: function(id) {
			var row = hwRows.find(function(item) { return item.fieldId === id; });
			if (row) { selectField(row); }
		},
		onModeChange: function() { renderLegend(); renderAll(); },
		onTimeChange: function(time) { hwMode = time; renderAll(); },
		onRelayout: function() { if (hwMap) { hwMap.relayout(); } },
		onOpenRegion: function(region) {
			// 이미 권한 검증·제외 처리가 끝난 현장 목록만 기존 팝업으로 전달한다.
			var rows = hwRows.filter(function(row) { return window.HeatwaveDashboardModel.region(row.sido) === region; });
			openModal("지역 · " + region + (region === "충남" ? " (세종 포함)" : "") + " (" + rows.length + "개 현장)", rows);
		},
		mapSynchronized: true,
		preserveOriginalPanels: true // 기존 지도·6위젯·지역/본부 표의 모양과 클릭 동작을 유지한다.
	});
}

document.addEventListener("DOMContentLoaded", function() {
	syncCompanyLayout(companyCdFromFieldId(PARAM_FIELD_ID));
	renderLegend();
	fillWidgets(null);
	if (!window.HeatwaveDashboardUI) { bindToggle(); }
	bindModal();
	bindMapbar();
	bindFullscreen();
	refreshDatetime();
	setInterval(refreshDatetime, 1000 * 30);

	// 지도 SDK 오류가 현황 조회까지 막지 않도록 서로 독립적으로 시작한다.
	loadFields();
	setInterval(loadFields, 1000 * 15);
	if (typeof kakao === "undefined" || !kakao.maps) {
		showMapError();
		return;
	}
	var mapWait = setTimeout(showMapError, 10000);
	try {
		kakao.maps.load(function() {
			clearTimeout(mapWait);
			try {
				initMap();
				document.getElementById("hwxMapError").hidden = true;
				// 현황 응답이 지도보다 먼저 도착한 경우에도 마커와 기본 위치를 반영한다.
				if (hwInitDone) { defaultFocus(); renderMarkers(); if (hwSelected) { crumbForField(hwSelected); } }
			} catch (e) { showMapError(e); }
		});
	} catch (e) { clearTimeout(mapWait); showMapError(e); }
});

function showMapError(error) {
	console.error("[heatwave] 지도 초기화 실패", error || "SDK 응답 없음");
	var message = document.getElementById("hwxMapError");
	if (message) {
		message.hidden = false;
		message.textContent = "지도를 불러오지 못했습니다. 현장 현황은 별도로 조회합니다.";
	}
}

/* ===== 전체화면 (F11 동일, Fullscreen API 토글) ===== */
function bindFullscreen() {
	var btn = document.getElementById("hwFull");
	if (!btn) { return; }
	btn.addEventListener("click", function() {
		if (document.fullscreenElement) {
			(document.exitFullscreen || document.webkitExitFullscreen || function() {}).call(document);
		} else {
			var el = document.documentElement;
			(el.requestFullscreen || el.webkitRequestFullscreen || function() {}).call(el);
		}
	});
	document.addEventListener("fullscreenchange", syncFullscreenIcon);
	syncFullscreenIcon();
}

function syncFullscreenIcon() {	// 전체화면 상태에 따라 확대(expand)/축소(compress) 아이콘 + 툴팁 토글
	var btn = document.getElementById("hwFull"), ic = document.getElementById("hwFullIcon");
	if (!btn || !ic) { return; }
	var on = !!document.fullscreenElement;
	ic.innerHTML = on
		? '<path d="M9 9V5H7v2H5v2h4zm6 0h4V7h-2V5h-2v4zM9 15H5v2h2v2h2v-4zm6 4h2v-2h2v-2h-4v4z"/>'
		: '<path d="M7 7h4V5H5v6h2V7zm10 0v4h2V5h-6v2h4zM7 17v-4H5v6h6v-2H7zm12-4h-2v4h-4v2h6v-6z"/>';
	btn.title = on ? "전체화면 해제 (F11)" : "전체화면 (F11)";
}

function initMap() {
	hwMap = new kakao.maps.Map(document.getElementById("hwMap"), {
		center: new kakao.maps.LatLng(36.3, 127.8),
		level: 12
	});
	if (window.HeatwaveDashboardUI) { window.HeatwaveDashboardUI.attachMap(hwMap); }
	// 일반(로드맵) 그대로 사용 — 지적편집도는 '국토개발벨트' 데이터가 딸려와 제외. 북한 보이되 남한으로 포커스
	frameSouth();								// 초기 SK fit(전국 128km). 기본 32km 줌은 데이터 로드 후 defaultFocus
	hwMap.setMaxLevel(hwMap.getLevel());		// 줌아웃 잠금
	loadSidoBoundaries();						// 행정경계(시도) 얇은 선 — 지적편집도 '벨트' 없이
	if (kakao.maps.services) {
		hwGeocoder = new kakao.maps.services.Geocoder();		// 동일 kakao.map.js.key의 services 라이브러리를 특보 연결에도 사용한다.
		// 지도 중심 위치추적(idle→updateCrumb) 제거 → 좌상단이 'PC 위치(지도중심 지명)'처럼 보이던 것 해소. 미선택 시 기본 '전국' 유지(마커·뷰는 현장정보 기반·위치 무관).
	}
	loadSelectedWarnings(true);
	loadBackgroundWarnings();
}

/* 남한 포커스 : 남한 bounds로 맞춰 화면을 채움 (북한은 위쪽 경계 밖으로 살짝만) */
function frameSouth() {
	if (!hwMap) { return; }
	hwMap.setBounds(new kakao.maps.LatLngBounds(
		new kakao.maps.LatLng(33.1, 125.5), new kakao.maps.LatLng(38.6, 129.6)));
}

/* 기본 포커스 : 첫 데이터 로드 후 1회 — 컨테이너 확정 + 전국 보기 중심(충남 공주) + 64km(레벨13) 고정 */
var hwReframed = false;
function defaultFocus() {
	if (hwReframed || !hwMap) { return; }
	hwReframed = true;
	hwMap.relayout();
	frameSouth();								// SK fit (컨테이너 확정 후) — fit 레벨은 화면 크기에 따라 가변
	var fit = hwMap.getLevel();
	hwMap.setMaxLevel(Math.max(fit, 13));		// 전국(64km)보다 줌아웃 금지
	hwMap.setCenter(new kakao.maps.LatLng(35.8, 127.1549));		// 전국 보기 중심 (제주까지 들어오도록 남쪽으로 내림)
	hwMap.setLevel(13);							// 64km 고정 — 전국 한눈에 (기본)
}

/* 남한 반투명 흰 면 + 시도 경계 : 카카오 로드맵 위에 '반투명' 바다/남한 면을 얹어 도로·지형이 비치게 함(고객 요청 = 반투명, 완전덮기 X).
   → 커스텀 폴리곤이라 모든 줌에서 유지(지적편집도와 달리 사라지지 않음·벨트 없음). 북한·도로는 면 너머로 은은히 비침. 파란 시도 경계 + 시도명. (마커·현장경계 별도) */
var hwSidoPolys = [];
function loadSidoBoundaries() {
	if (!hwMap || hwSidoPolys.length) { return; }	// 1회만
	fetch(ctx + "/res/data/skorea-sido.json", { headers: { "Accept": "application/json" } })
		.then(function(r) { return r.json(); })
		.then(function(data) {
			if (!data || !data.features) { return; }
			// 1) 바다 반투명 면 : 큰 사각형으로 베이스맵을 은은히 덮음 (반투명이라 도로·지명·북한이 비침)
			var sea = new kakao.maps.Polygon({
				path: [ new kakao.maps.LatLng(20, 110), new kakao.maps.LatLng(20, 145),
						new kakao.maps.LatLng(50, 145), new kakao.maps.LatLng(50, 110) ],
				strokeWeight: 0, fillColor: "#A6C8E1", fillOpacity: 0.45, zIndex: 1
			});
			sea.setMap(hwMap);
			hwSidoPolys.push(sea);
			// 2) 시도 반투명 흰 면 + 파란 경계선 + 시도명 라벨
			data.features.forEach(function(f) {
				(f.rings || []).forEach(function(ring) {
					var poly = new kakao.maps.Polygon({
						path: ring.map(function(pt) { return new kakao.maps.LatLng(pt[1], pt[0]); }),
						strokeWeight: 1.2, strokeColor: "#3F6FB0", strokeOpacity: 0.75,
						strokeStyle: "solid", fillColor: "#FFFFFF", fillOpacity: 0.5, zIndex: 2
					});
					poly.setMap(hwMap);
					hwSidoPolys.push(poly);
				});
				var big = (f.rings || []).slice().sort(function(a, b) { return b.length - a.length; })[0];	// 본토(최대 ring) 중심에 시도명
				if (big && big.length) {
					var cx = 0, cy = 0;
					big.forEach(function(p) { cx += p[0]; cy += p[1]; });
					var el = document.createElement("div");
					el.className = "hw-sido-label";
					el.textContent = shortSido(f.name);
					var ov = new kakao.maps.CustomOverlay({
						position: new kakao.maps.LatLng(cy / big.length, cx / big.length),
						content: el, zIndex: 3, xAnchor: 0.5, yAnchor: 0.5
					});
					ov.setMap(hwMap);
					hwSidoPolys.push(ov);
				}
			});
		})
		.catch(function(e) { console.warn("[heatwave] 시도 맵 로드 실패", e); });
}

/* 시도 풀네임 → 축약 (경상남도→경남) */
function shortSido(n) {
	var m = { "서울특별시":"서울","부산광역시":"부산","대구광역시":"대구","인천광역시":"인천","광주광역시":"광주",
		"대전광역시":"대전","울산광역시":"울산","세종특별자치시":"세종","경기도":"경기","강원도":"강원",
		"충청북도":"충북","충청남도":"충남","전라북도":"전북","전라남도":"전남","경상북도":"경북","경상남도":"경남","제주특별자치도":"제주" };
	return m[n] || n;
}

/* 위성/일반 지도타입 토글 */
function bindMapType() {
	var btns = document.querySelectorAll(".hw-maptype button");
	if (!btns.length) { return; }
	btns.forEach(function(b) {
		b.addEventListener("click", function() {
			if (!hwMap) { return; }
			var road = b.getAttribute("data-type") === "road";
			hwMap.setMapTypeId(road ? kakao.maps.MapTypeId.ROADMAP : kakao.maps.MapTypeId.SKYVIEW);
			document.querySelectorAll(".hw-maptype button").forEach(function(x) { x.classList.toggle("on", x === b); });
		});
	});
}

/* 현장경계(작업구역) : 선택 현장 geojson을 불러와 노란 외곽선 + 그 영역으로 줌인 (대우관제 displaydrawline 패턴 재사용) */
var hwFieldBdy = [];
function clearFieldBoundary() {
	hwFieldBdy.forEach(function(o) { o.setMap(null); });
	hwFieldBdy = [];
}
function flattenRings(coords) {		// geojson 좌표 → ring(점배열) 목록 (Polygon/MultiPolygon/LineString 공통)
	if (!Array.isArray(coords) || !coords.length) { return []; }
	if (typeof coords[0][0] === "number") { return [coords]; }
	var rings = [];
	coords.forEach(function(c) { rings = rings.concat(flattenRings(c)); });
	return rings;
}
function loadFieldBoundary(row) {
	clearFieldBoundary();
	var lat = parseFloat(row.latitude), lng = parseFloat(row.longitude);
	function zoomToPoint() { if (hwMap && !isNaN(lat) && !isNaN(lng)) { hwMap.setLevel(4); hwMap.panTo(new kakao.maps.LatLng(lat, lng)); } }
	fetch(ctx + "/v1/file/storage/geojson/" + encodeURIComponent(row.fieldId) + "/geojson", { headers: { "Accept": "application/json" } })
		.then(function(r) { return r.ok ? r.json() : null; })
		.then(function(geo) {
			var bounds = new kakao.maps.LatLngBounds(), has = false;
			if (geo && geo.features) {
				geo.features.forEach(function(f) {
					var coords = f.geometry && f.geometry.coordinates;
					flattenRings(coords).forEach(function(ring) {
						var path = ring.map(function(pt) { return new kakao.maps.LatLng(pt[1], pt[0]); });
						path.forEach(function(ll) { bounds.extend(ll); has = true; });
						var pl = new kakao.maps.Polyline({ path: path, strokeWeight: 3, strokeColor: "#FFEB3B", strokeOpacity: 0.95, strokeStyle: "solid", zIndex: 60 });
						pl.setMap(hwMap);
						hwFieldBdy.push(pl);
					});
				});
			}
			if (has) { hwMap.setBounds(bounds); } else { zoomToPoint(); }	// 작업구역 영역으로 줌인, geojson 없으면 좌표로
		})
		.catch(function() { zoomToPoint(); });
}

function apiFieldsUrl() {
	var siteCd = initialSiteCd();
	var url = ctx + "/v1/ctrlmnt/heatwave/fields/"
		+ encodeURIComponent(DISP_KEY) + "/" + encodeURIComponent(PARAM_FIELD_ID);
	return siteCd ? url + "?siteCd=" + encodeURIComponent(siteCd) : url;
}

function hwTrim(v) {
	return v == null ? "" : String(v).trim();
}

function initialSiteCd() {
	return hwTrim(typeof PARAM_SITE_CD === "undefined" ? "" : PARAM_SITE_CD);
}

/* ===== 회사별 우측 패널 ===== */
function companyCdFromFieldId(fieldId) {
	var id = hwTrim(fieldId).toUpperCase();
	if (id.indexOf("HW1") === 0) { return "HW1"; }
	if (id.indexOf("HS1") === 0) { return "HS1"; }
	if (id.indexOf("DW1") === 0) { return "DW1"; }
	return "";
}

function usesWeatherAlertLayout(companyCd) {
	companyCd = hwTrim(companyCd || hwCompanyCd).toUpperCase();
	return companyCd === "HW1" || companyCd === "HS1";
}

function syncCompanyLayout(companyCd) {
	companyCd = hwTrim(companyCd).toUpperCase();
	if (companyCd) { hwCompanyCd = companyCd; }

	var right = document.getElementById("hwRight");
	var hq = document.getElementById("hwHqPanel");
	var alertPanel = document.getElementById("hwAlertPanel");
	var musa = document.getElementById("hwMusa");
	if (!right || !hq || !alertPanel) { return; }

	var usesAlertLayout = usesWeatherAlertLayout(hwCompanyCd);
	var isDaewoo = (hwCompanyCd === "DW1");
	var shell = document.getElementById("hwShell");
	if (shell) { shell.dataset.company = hwCompanyCd; } // 화면 배치 전용. REST 조회 권한·범위는 변경하지 않는다.
	right.classList.toggle("hw-layout-alert", usesAlertLayout);
	right.classList.toggle("hw-layout-single", !usesAlertLayout && !isDaewoo);
	hq.style.display = isDaewoo ? "flex" : "none";
	if (musa) { musa.style.display = isDaewoo ? "inline-flex" : "none"; }
	alertPanel.style.display = usesAlertLayout ? "flex" : "none";

	if (usesAlertLayout) {
		ensureWeatherAlertPolling();
	} else if (hwAlertTimer) {
		clearInterval(hwAlertTimer);
		hwAlertTimer = null;
	}
}

function ensureWeatherAlertPolling() {
	if (hwAlertTimer) { return; }
	/* 첫 조회는 현장 목록에서 초기 선택 현장이 확정된 뒤 loadFields가 실행한다. */
	if (hwRows.length) { loadWeatherAlerts(); }
	hwAlertTimer = setInterval(loadWeatherAlerts, 1000 * 60 * 5);
}

function apiWeatherAlertsUrl(targetFieldId) {
	return ctx + "/v1/ctrlmnt/heatwave/weather-report/"
		+ encodeURIComponent(DISP_KEY) + "/" + encodeURIComponent(PARAM_FIELD_ID)
		+ "?targetFieldId=" + encodeURIComponent(targetFieldId);
}

function loadWeatherAlerts() {
	if (!usesWeatherAlertLayout()) { return; }
	var targetFieldId = hwAlertFieldId || (hwSelected && hwSelected.fieldId);
	if (!targetFieldId) { return; }
	hwAlertFieldId = targetFieldId;
	var requestSeq = ++hwAlertRequestSeq;
	if (!hwAlertRows.length) { renderWeatherAlertLoading(); }
	fetch(apiWeatherAlertsUrl(targetFieldId), { headers: { "Accept": "application/json" } })
		.then(function(r) {
			if (!r.ok) { throw new Error("HTTP " + r.status); }
			return r.json();
		})
		.then(function(data) {
			if (requestSeq !== hwAlertRequestSeq || targetFieldId !== hwAlertFieldId) { return; }
			var rows = (data && (data.resultlist || data.result)) || [];
			hwAlertRows = Array.isArray(rows) ? rows : [];
			hwAlertAreaNm = hwAlertRows.length ? hwTrim(hwAlertRows[0].stnArea || hwAlertRows[0].stn_area) : "";
			renderWeatherAlerts(hwAlertRows, false);
		})
		.catch(function() {
			if (requestSeq !== hwAlertRequestSeq || targetFieldId !== hwAlertFieldId) { return; }
			hwAlertRows = [];
			hwAlertAreaNm = "";
			renderWeatherAlerts([], true);
		});
}

function updateAlertFieldName() {
	var targetFieldId = (hwSelected && hwSelected.fieldId) || "";
	var changed = targetFieldId !== hwAlertFieldId;
	hwAlertFieldId = targetFieldId;
	hwAlertFieldNm = "";
	for (var i = 0; i < hwRows.length; i++) {
		if (hwRows[i].fieldId === targetFieldId) {
			hwAlertFieldNm = hwTrim(hwRows[i].fieldNm);
			break;
		}
	}
	if (changed) {
		hwAlertRows = [];
		hwAlertAreaNm = "";
	} else if (usesWeatherAlertLayout() && hwAlertRows.length) {
		renderWeatherAlerts(hwAlertRows, false);
	}
	return changed;
}

function weatherAlertParts(row) {
	var raw = hwTrim(row && row.title);
	var slash = raw.indexOf(" / ");
	var head = slash >= 0 ? raw.substring(0, slash) : "";
	var report = slash >= 0 ? raw.substring(slash + 3) : raw;
	var colon = head.lastIndexOf(" : ");
	var time = colon >= 0 ? head.substring(colon + 3) : "";
	report = report.replace(/\s*\(\*\)\s*/g, "").trim();
	return { report: report, time: time };
}

function weatherAlertTimeLabel(value) {
	var time = hwTrim(value);
	var match = time.match(/(\d{2}:\d{2})$/);
	return match ? match[1] : "";
}

function weatherAlertStates(rows) {
	var states = {};
	HW_ALERT_TYPES.forEach(function(type) {
		states[type] = { resolved:false, level:0, detail:"발효 없음" };
	});

	rows.forEach(function(row) {
		var parts = weatherAlertParts(row);
		var timeLabel = weatherAlertTimeLabel(parts.time);
		var tokens = parts.report.split("·").map(function(token) { return token.trim(); }).filter(function(token) { return token; });
		HW_ALERT_TYPES.forEach(function(type) {
			var state = states[type];
			if (state.resolved) { return; }
			var matched = tokens.filter(function(token) { return token.indexOf(type) >= 0; });
			if (!matched.length) { return; }

			state.resolved = true;
			var active = matched.filter(function(token) {
				return token.indexOf("해제") < 0 && (token.indexOf("경보") >= 0 || token.indexOf("주의보") >= 0);
			});
			if (!active.length) {
				state.detail = timeLabel ? "최근 해제 " + timeLabel : "최근 해제";
				return;
			}

			var warning = active.filter(function(token) { return token.indexOf("경보") >= 0; });
			state.level = warning.length ? 2 : 1;
			state.detail = timeLabel ? "발효 " + timeLabel : "발효 중";
		});
	});
	return states;
}

function hwEscapeHtml(value) {
	var div = document.createElement("div");
	div.textContent = value == null ? "" : String(value);
	return div.innerHTML;
}

function weatherAlertBasis() {
	var field = hwAlertFieldNm ? "현장: " + hwAlertFieldNm : "선택 현장 기준";
	var area = hwAlertAreaNm ? "특보지역: " + hwAlertAreaNm : "";
	return [field, area].filter(function(v) { return v; }).join(" · ");
}

function renderWeatherAlertLoading() {
	var grid = document.getElementById("hwAlertGrid");
	var area = document.getElementById("hwAlertArea");
	if (!grid || !area) { return; }
	var basis = weatherAlertBasis();
	area.textContent = basis;
	area.title = basis;
	grid.innerHTML = "<div class='hw-todo hw-alert-loading'>특보 조회 중…</div>";
}

function renderWeatherAlerts(rows, failed) {
	var grid = document.getElementById("hwAlertGrid");
	var area = document.getElementById("hwAlertArea");
	if (!grid || !area) { return; }

	var basis = weatherAlertBasis();
	area.textContent = basis;
	area.title = basis;
	var states = weatherAlertStates(rows || []);
	var html = "";
	HW_ALERT_TYPES.forEach(function(type) {
		var state = states[type];
		var cls = failed ? "hw-alert-error" : (state.level === 2 ? "hw-alert-warning" : state.level === 1 ? "hw-alert-watch" : "");
		var status = failed ? "조회 실패" : (state.level === 2 ? "경보" : state.level === 1 ? "주의보" : "특보 없음");
		var detail = failed ? "잠시 후 다시 확인" : state.detail;
		html += "<div class='hw-alert-item " + cls + "'>"
			+ "<div class='hw-alert-name'>" + type + "</div>"
			+ "<span class='hw-alert-status'>" + status + "</span>"
			+ "<div class='hw-alert-detail'>" + hwEscapeHtml(detail) + "</div></div>";
	});
	grid.innerHTML = html;
}

function findInitialFocusRow() {
	var siteCd = initialSiteCd().toUpperCase();
	var i, row;
	if (siteCd) {
		for (i = 0; i < hwRows.length; i++) {
			row = hwRows[i];
			if (row.focusYn === "Y" || row.focus_yn === "Y") { return row; }
			if (hwTrim(row.shMappingFieldId || row.sh_mapping_field_id).toUpperCase() === siteCd) { return row; }
		}
	}
	if (hwCompanyCd === "DW1") { return null; }
	for (i = 0; i < hwRows.length; i++) {
		if (hwRows[i].fieldId === PARAM_FIELD_ID) { return hwRows[i]; }
	}
	return hwRows.length ? hwRows[0] : null;	// 진입 현장이 준공·플랜트로 제외되면 첫 조회 가능 현장 선택
}

function loadFields() {
	fetch(apiFieldsUrl(), { headers: { "Accept": "application/json" } })
		.then(function(r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); })
		.then(function(data) {
			var rows = (data && (data.resultlist || data.result)) || data || [];
			if (!Array.isArray(rows)) { rows = []; }
			var companyCd = rows.length ? (rows[0].companyCd || rows[0].company_cd) : companyCdFromFieldId(PARAM_FIELD_ID);
			syncCompanyLayout(companyCd);
			hwRows = rows;
			hwDataFresh = true;
			if (HW_EXCLUDE_FIELDS.length) { hwRows = hwRows.filter(function(r) { return HW_EXCLUDE_FIELDS.indexOf(r.fieldId) < 0; }); }	/* [설정] 제외 현장코드 거르기 */
			Object.keys(hwCoordinateWarnings).forEach(function(id) {
				if (!hwRows.some(function(row) { return String(row.fieldId) === id && coordinateWarningKey(row) === hwCoordinateWarnings[id].key; })) {
					delete hwCoordinateWarnings[id];
				}
			});
			var firstLoad = !hwInitDone;
			var focusRow = null;
			if (!hwInitDone) {
				hwInitDone = true;
				defaultFocus();
				focusRow = findInitialFocusRow();
				if (focusRow) { hwSelected = focusRow; }
			}
			renderAll();
			publishDashboardSnapshot(firstLoad && hwSelected ? hwSelected.fieldId : "");
			loadDashboardDetails(false);
			loadSelectedWarnings(false);
			loadBackgroundWarnings();
			var alertTargetChanged = updateAlertFieldName();
			if (firstLoad && focusRow) { crumbForField(focusRow); }
			if (alertTargetChanged && usesWeatherAlertLayout()) { loadWeatherAlerts(); }
		})
		.catch(function(e) {
			console.error("[heatwave] fields 로드 실패", e);
			hwDataFresh = false;
			cancelSelectedWarningRequest();
			loadBackgroundWarnings(); // 실패 전 목록의 진행 요청도 취소하고 결과를 재사용하지 않는다.
			if (hwInitDone) { renderAll(); }
			if (window.HeatwaveDashboardUI) { window.HeatwaveDashboardUI.reportError("현장 기상자료 갱신 실패 · 이전 자료의 최신 상태 미확인"); }
		});
}

/* ===== 등급 helper ===== */
/* 지도·기존 위젯도 신규 계절 판정과 같은 모델을 사용한다. */
function activeDashboardSeason() {
	return window.HeatwaveDashboardUI ? window.HeatwaveDashboardUI.getViewState().season : "summer";
}

function gradeDisplayName(grade) {
	if (!window.HeatwaveDashboardModel || activeDashboardSeason() === "summer" || grade < 3) { return HW_GRADE[grade].name; }
	var key = {0:"unknown",1:"normal",2:"attention",3:"caution",4:"danger",5:"alert"}[grade];
	return (activeDashboardSeason() === "def" ? "" : activeDashboardSeason() === "winter" ? "한파 " : "혹서기 ")
		+ window.HeatwaveDashboardModel.gradeNames[key];
}

/* 표의 위치/색상은 그대로 두고, 표시 임계만 실제 계절 판정과 일치시킨다. */
function gradeHeaders() {
	var season = activeDashboardSeason();
	var winter = {5:"−18℃ 이하",4:"−15℃ 이하",3:"−12℃ 이하",2:"−9℃ 미만",1:"−9℃ 이상"};
	var combined = {5:"38℃↑<br>−18℃↓",4:"35℃↑<br>−15℃↓",3:"33℃↑<br>−12℃↓",2:"31℃↑<br>−9℃ 미만",1:"−9℃ 이상<br>31℃ 미만"};
	var heads = HW_GRADE_HEAD.map(function(h) {
		return {g:h.g, bg:h.bg, fg:h.fg, name:gradeDisplayName(h.g),
			temp:season === "winter" ? winter[h.g] : season === "def" ? combined[h.g] : (h.g === 1 ? "31℃ 미만" : h.temp)};
	});
	// 미수신이 있는 경우에만 회색 열을 추가한다. 미수신을 정상으로 합산하지 않는다.
	if (hwRows.some(function(row) { return gradeOf(row, hwMode) === 0; })) {
		heads.push({g:0, temp:"미수신", name:"미수신", bg:HW_GRADE[0].color, fg:"#fff"});
	}
	return heads;
}

function gradeOf(row, mode) {
	if (!hwDataFresh) { return 0; }
	var f = heatwaveNumber(mode === "tomorrow" ? row.tmrFeelsTpr : row.currFeelsTpr);
	if (f === null) { return 0; }		// 체감온도 미수신
	if (window.HeatwaveDashboardModel) {
		return {unknown:0,normal:1,attention:2,caution:3,danger:4,alert:5}[
			window.HeatwaveDashboardModel.grade(f, activeDashboardSeason())
		];
	}
	if (f >= 38) { return 5; }
	if (f >= 35) { return 4; }
	if (f >= 33) { return 3; }
	if (f >= 31) { return 2; }
	return 1;
}

/* 지역 구분셀 뱃지 전용: 현재의 수신된 기상청 특보만 표시한다.
   내일 체감온도 예측을 공식 발효 특보로 표시하지 않는다. */
function warnGradeOf(row, mode) {
	// 내일 체감온도 등급은 공식 발효 특보가 아니다. 특히 한파를 폭염 배지로 표시하지 않는다.
	if (mode === "tomorrow" || !hwDataFresh) { return 0; }
	var g = parseInt(row.currGrade, 10);
	return isNaN(g) ? 1 : g;
}

/* ===== 전체 재렌더 ===== */
function renderAll() {
	renderMarkers();
	renderAgg("hwAggRegion", "sido", HW_REGIONS, "지역", true);	// geo: 날씨아이콘 + 폭염특보 뱃지
	if (hwCompanyCd === "DW1") {
		renderAgg("hwAggHq", "hq", HW_HQS, "본부", false);		// 대우 본부는 지리신호(날씨/특보) 없음 → 이름만
	}
	if (hwSelected) {
		var refreshedSelected = null;
		for (var i = 0; i < hwRows.length; i++) {		// 갱신 데이터로 선택현장 row 교체
			if (hwRows[i].fieldId === hwSelected.fieldId) { refreshedSelected = hwRows[i]; break; }
		}
		hwSelected = refreshedSelected || (hwCompanyCd === "DW1" ? null : (hwRows[0] || null));
		if (hwSelected) {
			applySelected(hwSelected);		// 위젯/라벨만 갱신 (지도는 안 움직임)
		} else {
			fillWidgets(null); updateWeatherChip(null);
		}
	} else {
		fillWidgets(null); updateWeatherChip(null);
	}
	updateWeatherTime();
	refreshDatetime();
}

function updateWeatherTime() {
	var weatherTime = document.getElementById("hwxWeatherTime");
	if (weatherTime) {
		weatherTime.textContent = !hwDataFresh ? "기상자료 조회 실패 · 이전 자료는 최신 상태가 아닙니다."
			: !hwSelected ? "현장을 선택하면 기상정보를 표시합니다."
			: (hwMode === "tomorrow" ? "내일예보 · 기상청" : (hwSelected.temperatureSource === "SENSOR" ? "온습도계" : "기상청"))
				+ " · 자료시각 " + ((hwMode === "tomorrow" ? hwSelected.weatherFetchedAt : hwSelected.temperatureFetchedAt || hwSelected.weatherFetchedAt) || "미수신");
	}
}

/* ===== 지도 마커 ===== */
function renderMarkers() {
	if (!hwMap) { return; }
	var nextMarkers = Object.create(null), nextOverlays = [];

	hwRows.forEach(function(row) {
		var lat = parseFloat(row.latitude), lng = parseFloat(row.longitude);
		if (isNaN(lat) || isNaN(lng)) { return; }
		var fieldId = String(row.fieldId), entry = nextMarkers[fieldId] || hwMarkerByFieldId[fieldId];
		var g = gradeOf(row, hwMode);
		// 미수신(g=0)도 회색 마커(HW_GRADE[0]=#9E9E9E)로 지도 표시 — 집계표 카운트와 일치(살리기). (이전: 미표시)

		var isSel = hwSelected && row.fieldId === hwSelected.fieldId;	// 선택(현재위치) 강조 대상
		var markerClass = "hw-marker" + (isSel ? " hw-marker-sel" : ""), zIndex = isSel ? 999 : 100 + g;
		if (!entry) {
			var markerElement = document.createElement("div");
			entry = {element:markerElement, row:row, lat:lat, lng:lng, zIndex:zIndex};
			// 자동 갱신 전 row를 클로저에 고정하지 않고 항상 최신 수신 행을 선택한다.
			markerElement.addEventListener("click", function() { selectField(entry.row); });
		} else {
			if (entry.lat !== lat || entry.lng !== lng) {
				entry.overlay.setPosition(new kakao.maps.LatLng(lat, lng));
				entry.lat = lat; entry.lng = lng;
			}
			if (entry.zIndex !== zIndex) { entry.overlay.setZIndex(zIndex); entry.zIndex = zIndex; }
		}
		entry.row = row;
		var el = entry.element;
		// 선택 상태가 같으면 class를 재설정하지 않아 강조 표시도 불필요하게 재시작하지 않는다.
		if (el.className !== markerClass) { el.className = markerClass; }
		el.style.background = HW_GRADE[g].color;
		el.style.setProperty("--mk", HW_GRADE[g].color);	// 포커싱 핑 링 색(등급색)
		el.title = row.fieldNm + " · " + gradeDisplayName(g);
		if (!entry.overlay) {
			// 최초 부착 전에 크기·색상 class를 설정하여 원래 중심 앵커를 유지한다.
			entry.overlay = new kakao.maps.CustomOverlay({
				position: new kakao.maps.LatLng(lat, lng),
				content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: zIndex
			});
			entry.overlay.setMap(hwMap);
		}
		if (!nextMarkers[fieldId]) { nextOverlays.push(entry.overlay); }
		nextMarkers[fieldId] = entry;
	});
	Object.keys(hwMarkerByFieldId).forEach(function(fieldId) {
		// 목록에서 빠졌거나 좌표가 무효화된 현장만 지도에서 제거한다.
		if (!nextMarkers[fieldId]) { hwMarkerByFieldId[fieldId].overlay.setMap(null); }
	});
	hwMarkerByFieldId = nextMarkers;
	hwOverlays = nextOverlays;
}

/* ===== 현장 선택(마커/팝업 공통) ===== */
function applySelected(row) {		// 라벨/위젯/날씨칩만 갱신 (지도 이동 없음 — 15초 자동갱신용)
	var g = gradeOf(row, hwMode);
	document.getElementById("hwFieldLabel").textContent = row.fieldNm + "  [" + gradeDisplayName(g) + "]";
	fillWidgets(row);
	updateWeatherChip(row);
	updateWeatherTime();
}

function selectField(row) {			// 마커/팝업 클릭 — 선택 강조 + 하단 위젯 갱신 (확대 X, 전체 보기 유지)
	hwSelected = row;
	if (window.HeatwaveDashboardUI) { window.HeatwaveDashboardUI.selectField(row.fieldId); }
	applySelected(row);				// 하단 6위젯을 선택 현장 데이터로 갱신
	renderMarkers();				// 선택 강조(핑 링) 즉시 반영 — 지도 줌/중심은 그대로
	crumbForField(row);				// 상단 브레드크럼을 선택 현장 위치로 갱신 (확대 없이 표시만)
	updateAlertFieldName();
	loadSelectedWarnings(false);
	if (usesWeatherAlertLayout()) { loadWeatherAlerts(); }
}

/* ===== 하단 6위젯 (SVG 게이지/카드) ===== */
function fillWidgets(row) {
	var tmr = (hwMode === "tomorrow");
	var temp  = row ? (tmr ? row.tmrHighTemp  : row.currTemp)    : null;
	var humi  = row ? (tmr ? row.tmrHumidity  : row.humidity)    : null;
	var feels = row ? (tmr ? row.tmrFeelsTpr  : row.currFeelsTpr): null;
	var maxFeels = (row && !tmr) ? row.currMaxFeelsTpr : null;	// 당일최대 체감온도 (현재 모드만, 위젯에 현재와 함께 표시)
	var grade = row ? gradeOf(row, hwMode) : 0;
	var rain  = row ? (tmr ? "-" : row.precipitation) : null;	// 내일 강수 미보유
	var wspd  = (row && !tmr) ? row.windSpd : null;				// 내일 풍속 미보유
	var wdir  = (row && !tmr) ? row.windDir : null;				// 내일 풍향 미보유

	var tn = num(temp), hn = num(humi), wn = num(wspd);
	document.getElementById("hwWidgets").innerHTML =
		  rainCell(rain, activeDashboardSeason() === "winter")
		+ gaugeCell("온도", show(temp), "℃",  tn === null ? 0 : tn / 50,  "#FB8C00", tn === null ? "" : tempLevel(tn))
		+ gaugeCell("습도", show(humi), "%",   hn === null ? 0 : hn / 100, "#2EBB57", hn === null ? "" : humiLevel(hn))
		+ feelsCell(show(feels), grade, tmr ? "내일 체감온도" : "체감온도", num(maxFeels) === null ? null : show(maxFeels))
		+ gaugeCell("풍속", show(wspd), "m/s", wn === null ? 0 : wn / 15,  "#52B0FF", wn === null ? "" : windLevel(wn))
		+ windDirCell(wdir);
}

function num(v) { if (v === null || v === undefined || v === "") { return null; } var n = parseFloat(v); return isNaN(n) ? null : n; }
function show(v) { return (v === null || v === undefined || v === "") ? "-" : v; }

/* 270° 원형 게이지 (하단 개방). 값/단위 중앙, 레벨 라벨 하단 */
function gaugeCell(label, valStr, unit, frac, color, sub) {
	frac = Math.max(0, Math.min(1, frac || 0));
	var dash = (75 * frac).toFixed(1);
	return "<div class='hw-widget'><div class='w-head'>" + label + "</div>"
		+ "<div class='hw-gauge'><svg viewBox='0 0 100 100'>"
		+ "<circle cx='50' cy='50' r='40' fill='none' stroke='#E3E8EF' stroke-width='9' pathLength='100' stroke-dasharray='75 25' transform='rotate(135 50 50)'/>"
		+ "<circle cx='50' cy='50' r='40' fill='none' stroke='" + color + "' stroke-width='9' stroke-linecap='round' pathLength='100' stroke-dasharray='" + dash + " 100' transform='rotate(135 50 50)'/>"
		+ "<text x='50' y='53' text-anchor='middle' fill='#1F2937' font-size='17' font-weight='700'>" + valStr + "</text>"
		+ "<text x='50' y='67' text-anchor='middle' fill='#6B7280' font-size='9'>" + unit + "</text>"
		+ "</svg><div class='g-sub'>" + (sub || "&nbsp;") + "</div></div></div>";
}

/* 체감온도 강조 카드 (폭염 등급색 테두리/뱃지) */
function feelsCell(valStr, grade, label, maxStr) {
	var c = HW_GRADE[grade].color, nm = gradeDisplayName(grade);
	var showMaximum = !!maxStr && activeDashboardSeason() !== "winter";
	return "<div class='hw-widget hw-feels' style='border-color:" + c + ";box-shadow:0 0 10px " + c + "55;'>"
		+ "<div class='w-head'>" + (label || "체감온도") + "</div>"
		+ "<div class='feels-val' style='color:" + c + "'>" + valStr + "<span class='feels-unit'>℃</span></div>"
		+ "<div class='feels-max" + (showMaximum ? "" : " hwx-reserved-note") + "'" + (showMaximum ? "" : " aria-hidden='true'") + ">당일최대 " + (showMaximum ? hwEscapeHtml(maxStr) : "—") + "℃</div>"
		+ "<div class='feels-badge' style='background:" + c + "'>" + nm + "</div></div>";
}

/* 강수 카드 (1시간 강수량, 문자열 그대로) */
function rainCell(txt, winter) {
	// 기존 강수 표시값은 유지하고 그림만 공통 SVG로 교체한다. 미수신은 회색으로 구분한다.
	var iconBoot = document.getElementById('hwBoot'), iconData = iconBoot ? iconBoot.dataset : {};
	var iconBase = iconData.preview === 'true' ? '' : iconData.iconUrl || (iconData.context || '') + '/res/image/heatwave/dashboard-icons.svg?v=20260929.5';
	var iconHref = hwEscapeHtml(iconBase + '#hw-icon-rain').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	var rainKnown = dashboardPrecipitation(txt).rainText !== '';
	var icon = '<svg class="hwx-icon hwx-precip-icon" viewBox="0 0 64 64" data-icon="rain" data-state="' + (rainKnown ? 'known' : 'unknown') + '" aria-hidden="true" focusable="false"><use href="' + iconHref + '"></use></svg>';
	return "<div class='hw-widget'><div class='w-head'>" + (winter ? "강수 / 강설" : "강수") + "</div>"
		+ "<div class='hw-rain'><div class='rain-ico'>" + icon + "</div><div class='rain-val'>" + hwEscapeHtml(show(txt)) + "</div>"
		+ "<div class='g-sub'><span class='hw-rain-period'>" + (hwMode === "tomorrow" ? "예보 강수량 미수신" : "1시간 강수량") + "</span>"
		+ "<span class='hw-rain-detail" + (winter ? "" : " hwx-reserved-note") + "'" + (winter ? "" : " aria-hidden='true'") + ">강설량 미수신</span></div></div></div>";
}

/* 풍향 바늘 게이지 (0=북, 시계방향) */
function windDirCell(deg) {
	var d = num(deg), has = (d !== null);
	var needle = has
		? "<line x1='50' y1='50' x2='50' y2='15' stroke='#E53935' stroke-width='3' stroke-linecap='round' transform='rotate(" + d + " 50 50)'/><circle cx='50' cy='50' r='3.5' fill='#374151'/>"
		: "";
	return "<div class='hw-widget'><div class='w-head'>풍향</div>"
		+ "<div class='hw-gauge'><svg viewBox='0 0 100 100'>"
		+ "<circle cx='50' cy='50' r='40' fill='none' stroke='#E3E8EF' stroke-width='6'/>"
		+ "<text x='50' y='13' text-anchor='middle' fill='#9CA3AF' font-size='9'>N</text>"
		+ needle + "</svg><div class='g-sub'>" + (has ? compass(d) + "풍" : "-") + "</div></div></div>";
}

function tempLevel(t) { return t < 15 ? "낮음" : t < 23 ? "보통" : t < 28 ? "다소높음" : t < 33 ? "높음" : "매우높음"; }
function humiLevel(h) { return h < 30 ? "건조" : h < 60 ? "보통" : h < 80 ? "다소높음" : "높음"; }
function windLevel(w) { return w < 0.5 ? "고요" : w < 4 ? "약함" : w < 9 ? "보통" : "강함"; }

function compass(deg) {
	var d = parseFloat(deg);
	if (isNaN(d)) { return "-"; }
	return COMPASS_16[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
}

/* ===== 집계표 (지역/본부 공통) ===== */
function keyOf(row, keyField, orderList) {
	var k = row[keyField];
	return (orderList.indexOf(k) >= 0) ? k : orderList[orderList.length - 1];	// 미정의 → 폴백(미지정/기타)
}

/* geo=true(지역별): 구분셀 = 날씨아이콘 + 지역명 + 폭염특보 뱃지. false(본부별): 이름만 */
function renderAgg(tableId, keyField, orderList, headLabel, geo) {
	if (!hwInitDone) { return; } // 조회 전에는 허위 0건 표를 만들지 않는다.
	var heads = gradeHeaders();
	var fallback = orderList[orderList.length - 1];		// 미지정/기타 (데이터 있을 때만 노출)
	var bucket = {};
	orderList.forEach(function(k) { bucket[k] = { 5:0,4:0,3:0,2:0,1:0,0:0, tot:0, warn:0, rep:null, repFeels:-999 }; });

	hwRows.forEach(function(row) {
		var k = keyOf(row, keyField, orderList);
		var b = bucket[k];
		var g = gradeOf(row, hwMode);				// 체감온도 밴드 → 컬럼
		b[g] += 1;
		b.tot += 1;
		var w = warnGradeOf(row, hwMode);			// 폭염특보 → 뱃지(지역 대표=최고)
		if (w > b.warn) { b.warn = w; }
		var f = parseFloat(hwMode === "tomorrow" ? row.tmrFeelsTpr : row.currFeelsTpr);	// 대표현장(아이콘)=체감 최고
		if (!isNaN(f) && f > b.repFeels) { b.repFeels = f; b.rep = row; }
		else if (b.rep === null) { b.rep = row; }
	});

	var html = "<thead><tr><th>" + headLabel + "</th>";
	heads.forEach(function(h) {	/* 등급 컬럼 헤더 : 클릭 시 해당 등급 현장목록(#4) — class/ data-grade 부여 */
		html += "<th class='hw-gth' data-grade='" + h.g + "' style='background:" + h.bg + ";color:" + h.fg + ";line-height:1.2;padding:5px 3px;'>"
			+ h.temp + "</th>";	/* 온도 임계만 표시 (등급명 제거) */
	});
	html += "<th class='hw-gth-all'>계</th></tr></thead><tbody>";	/* 계 헤더 클릭 → 자사 전체 현장목록 */

	var sum = { 5:0,4:0,3:0,2:0,1:0,0:0, tot:0 };
	orderList.forEach(function(k) {
		var b = bucket[k];
		if (k === fallback && b.tot === 0) { return; }		// 폴백 버킷은 데이터 있을 때만, 정의지역은 0도 노출(전국 그리드)
		heads.forEach(function(h) { sum[h.g] += b[h.g]; }); sum.tot+=b.tot;

		var disp = HW_HQ_LABEL[k] || k;		// 본부는 표시명(건축→건축사업본부 등), 지역명은 그대로
		var label;
		if (geo && b.tot > 0) {
			label = "<span class='hw-rgn'>" + disp + "</span>" + weatherIconImg(b.rep) + warnBadge(b.warn);	// 순서: 지역명 → 날씨아이콘 → 특보뱃지 (2p)
		} else if (b.tot === 0) {
			label = "<span class='hw-rgn hw-rgn-empty'>" + disp + "</span>";	// 현장 없는 지역: 이름만(흐리게)
		} else {
			label = "<span class='hw-rgn'>" + disp + "</span>";
		}

		html += "<tr class='" + (b.tot > 0 ? "clickable" : "empty") + "' data-key='" + k + "'>"
			+ "<td style='text-align:left;'>" + label + "</td>"
			+ heads.map(function(h) { return tdGrade(b[h.g], h.bg); }).join("")
			+ "<td>" + "<b>" + b.tot + "</b>" + "</td></tr>";	/* 계 셀: 항상 굵게 (0 포함, 다른 숫자와 동일 서체) */
	});

	html += "<tr class='hw-sum'><td class='hw-sth-all'>계</td>"
		+ heads.map(function(h) { return tdSum(sum[h.g], h.g); }).join("")
		+ "<td class='hw-sth-all'><b>" + sum.tot + "</b></td></tr></tbody>";

	var table = document.getElementById(tableId);
	table.innerHTML = html;
	table.querySelectorAll("tr.clickable").forEach(function(tr) {
		tr.addEventListener("click", function() {
			var key = tr.getAttribute("data-key");
			var list = hwRows.filter(function(r) { return keyOf(r, keyField, orderList) === key; });
			openModal(headLabel + " · " + (HW_HQ_LABEL[key] || key) + " (" + list.length + "개 현장)", list);
		});
	});
	/* 등급 컬럼 헤더 + 계(합계)행 등급셀 클릭 → 해당 등급 자사 현장목록 (클라이언트 필터, companyCd 스코프 유지) */
	table.querySelectorAll("th.hw-gth, td.hw-sth").forEach(function(el) {
		el.addEventListener("click", function() { gradeListClick(parseInt(el.getAttribute("data-grade"), 10)); });
	});
	/* 계 헤더 + 합계셀 클릭 → 자사 전체 현장목록 */
	table.querySelectorAll(".hw-gth-all, .hw-sth-all").forEach(function(el) {
		el.addEventListener("click", function() { gradeListClick("all"); });
	});
}

/* 등급/전체 현장목록 팝업 (등급헤더·계행 공통) */
function gradeListClick(g) {
	var list, label;
	if (g === "all" || isNaN(g)) {
		list = hwRows.slice();
		label = "전체 현장";
	} else {
		var head = gradeHeaders().filter(function(x) { return x.g === g; })[0];
		label = head ? (head.temp.replace(/<br>/g, " / ") + " · " + head.name) : gradeDisplayName(g);
		list = hwRows.filter(function(r) { return gradeOf(r, hwMode) === g; });
	}
	openModal(label + " (" + list.length + "개 현장)", list);
}

function tdGrade(cnt, color) {
	if (!cnt) { return "<td></td>"; }	/* 빈/0 등급셀은 '-' 없이 공백 (2p) */
	return "<td style='color:" + color + ";font-weight:700;'>" + cnt + "</td>";
}
function tdSum(n, g) { return "<td class='hw-sth' data-grade='" + g + "'>" + "<b>" + n + "</b>" + "</td>"; }	/* 계(합계) 행: 빈 등급칸도 0(굵게) 표시 */

/* 현재 날씨아이콘 (기존 플랫폼 체계 /res/image/weather/ico_wt_NN.svg 재사용, 없으면 숨김) */
function weatherIconImg(row) {
	var code = row ? (hwMode === "tomorrow" ? row.tmrWeatherIcon : row.currWeatherIcon) : null;
	if (!code) { return ""; }
	var nm = row ? (hwMode === "tomorrow" ? (row.tmrWeather || "") : (row.currWeather || "")) : "";
	return "<img class='hw-wt' src='/res/image/weather/ico_wt_" + code + ".svg' alt='' title='" + nm + "' "
		+ "onerror='this.style.display=&quot;none&quot;;'>";
}

/* 폭염특보 뱃지 : 경보(주황)/주의보(노랑), 없음=뱃지 생략 */
function warnBadge(warn) {
	if (warn >= 4) { return "<span class='hw-badge' style='background:#FB8C00;color:#fff;'>폭염경보</span>"; }
	if (warn >= 3) { return "<span class='hw-badge' style='background:#FDD835;color:#1a1a1a;'>폭염주의보</span>"; }
	return "";
}

/* 한글 초성 추출 (초성 검색용) : 가-힣 → 초성, 그 외 글자는 그대로 */
var HW_CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function toChoseong(str) {
	var out = "";
	for (var i = 0; i < str.length; i++) {
		var c = str.charCodeAt(i);
		out += (c >= 0xAC00 && c <= 0xD7A3) ? HW_CHO[Math.floor((c - 0xAC00) / 588)] : str.charAt(i);
	}
	return out;
}

/* ===== 현장리스트 팝업 (검색 필터 + 10개+ 스크롤) ===== */
var hwModalRows = [];		// 현재 팝업의 전체 목록(검색 원본, 등급 내림차순 정렬)

function openModal(title, rows) {
	document.getElementById("hwModalTitle").textContent = title;
	hwModalRows = rows.slice().sort(function(a, b) { return gradeOf(b, hwMode) - gradeOf(a, hwMode); });
	var s = document.getElementById("hwModalSearch");
	if (s) { s.value = ""; }
	renderModalList("");
	document.getElementById("hwModal").style.display = "flex";
	if (s) { s.focus(); }
}

/* 검색어로 현장명·시도 필터 후 렌더 (목록은 CSS max-height로 ~10개 후 스크롤) */
function renderModalList(q) {
	var ul = document.getElementById("hwModalList");
	ul.innerHTML = "";
	q = (q || "").trim().toLowerCase();
	var list = q ? hwModalRows.filter(function(r) {
		var nm = (r.fieldNm || ""), sido = (r.sido || "");
		return nm.toLowerCase().indexOf(q) >= 0 || sido.toLowerCase().indexOf(q) >= 0
			|| toChoseong(nm).indexOf(q) >= 0 || toChoseong(sido).indexOf(q) >= 0;	// 초성 검색(ㄱ→강남/김포…)
	}) : hwModalRows;
	if (!list.length) {
		var empty = document.createElement("li");
		empty.className = "hw-modal-empty";
		empty.textContent = q ? "검색 결과 없음" : "현장 없음";
		ul.appendChild(empty);
		return;
	}
	list.forEach(function(row) {
		var g = gradeOf(row, hwMode);
		var li = document.createElement("li");
		li.innerHTML = "<span class='dot' style='background:" + HW_GRADE[g].color + "'></span>"
			+ "<span>" + row.fieldNm + "</span>"
			+ "<span style='margin-left:auto;color:#6B7280;'>" + gradeDisplayName(g) + "</span>";
		li.addEventListener("click", function() { closeModal(); selectField(row); });
		ul.appendChild(li);
	});
}

function closeModal() { document.getElementById("hwModal").style.display = "none"; }

function bindModal() {
	document.getElementById("hwModalClose").addEventListener("click", closeModal);
	document.getElementById("hwModal").addEventListener("click", function(e) {
		if (e.target === this) { closeModal(); }	// 바깥 클릭 시 닫기
	});
	var s = document.getElementById("hwModalSearch");
	if (s) { s.addEventListener("input", function() { renderModalList(s.value); }); }	// 검색 필터
}

/* ===== 지도 상단바 : 전국보기 / 주변현장 / 행정구역 브레드크럼 / 날씨칩 ===== */
function bindMapbar() {
	var home = document.getElementById("hwHome");
	var near = document.getElementById("hwNear");
	if (home) {
		home.addEventListener("click", function() {
			clearFieldBoundary();	// 현장경계 제거
			frameSouth();			// 전국(남한) 보기 재적용 (북한 미노출)
		});
	}
	if (near) {
		near.addEventListener("click", function() {
			if (!hwMap) { return; }
			var b = hwMap.getBounds();
			var list = hwRows.filter(function(r) {
				var lat = parseFloat(r.latitude), lng = parseFloat(r.longitude);
				return !isNaN(lat) && !isNaN(lng) && b.contain(new kakao.maps.LatLng(lat, lng));
			});
			openModal("주변 현장 (화면 내 " + list.length + "개)", list);
		});
	}
}

function renderCrumb(lng, lat) {		// 좌표 → 행정구역 브레드크럼 (지도중심/선택현장 공용)
	if (!hwGeocoder) { return; }
	hwGeocoder.coord2RegionCode(lng, lat, function(res, status) {
		var el = document.getElementById("hwCrumb");
		if (!el) { return; }
		if (status !== kakao.maps.services.Status.OK || !res || !res.length) { el.textContent = "전국"; return; }
		var r = null;
		for (var i = 0; i < res.length; i++) { if (res[i].region_type === "H") { r = res[i]; break; } }
		if (!r) { r = res[0]; }
		var parts = [r.region_1depth_name, r.region_2depth_name, r.region_3depth_name].filter(function(x) { return x; });
		el.innerHTML = parts.length ? parts.join(" <span class='crumb-sep'>›</span> ") : "전국";
	});
}
function crumbForField(row) {		// 마커/팝업 클릭 → 선택 현장 위치 행정구역 (지도 이동 없이 표시만)
	if (!hwGeocoder || !row) { return; }
	var la = parseFloat(row.latitude), ln = parseFloat(row.longitude);
	if (!isNaN(la) && !isNaN(ln)) { renderCrumb(ln, la); }
}

function updateWeatherChip(row) {
	var el = document.getElementById("hwWeatherChip");
	if (!el) { return; }
	if (!row) { el.innerHTML = "<span style='color:#6B7280;'>현장 선택 시 날씨 표시</span>"; return; }
	var tmr = (hwMode === "tomorrow");
	var temp  = tmr ? row.tmrHighTemp  : row.currTemp;
	var feels = tmr ? row.tmrFeelsTpr  : row.currFeelsTpr;
	var g = gradeOf(row, hwMode);
	var wet = String(tmr ? (row.tmrWeather || "") : (row.precipitation || ""));
	var sunny = (wet === "" || /맑|없음|구름조금/.test(wet));
	var basis = weatherBasis(row);
	var ico = sunny
		? "<svg viewBox='0 0 24 24' width='15' height='15' fill='#FBC02D'><circle cx='12' cy='12' r='6'/></svg>"
		: "<svg viewBox='0 0 24 24' width='15' height='15' fill='#52B0FF'><path d='M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z'/></svg>";
	el.innerHTML = ico + "<span>" + show(temp) + "℃</span>"
		+ "<span class='wc-dot' style='background:" + HW_GRADE[g].color + "'></span>"
		+ "<span>체감 " + show(feels) + "℃</span>"
		+ (basis ? "<span class='wc-time'>" + basis + "</span>" : "");
}

function weatherBasis(row) {
	if (!row) { return ""; }
	if (hwMode === "tomorrow") {
		return sourceBasis("기상청", row.weatherFetchedAt || row.weather_fetched_at, row.weatherBaseTime || row.weather_base_time);
	}
	var source = hwTrim(row.temperatureSource || row.temperature_source).toUpperCase();
	var sensorStatus = hwTrim(row.sensorStatus || row.sensor_status).toUpperCase();
	if (source === "SENSOR") {
		if (sensorStatus !== "NORMAL") { return "온습도계 수집 지연"; }
		return sourceBasis("온습도계", row.temperatureFetchedAt || row.temperature_fetched_at, "");
	}
	if (source === "KMA" && sensorStatus === "STALE") {
		return sourceBasis("기상청 대체", row.temperatureFetchedAt || row.temperature_fetched_at || row.weatherFetchedAt || row.weather_fetched_at, row.weatherBaseTime || row.weather_base_time)
			+ " · 온습도계 수집 지연";
	}
	return sourceBasis("기상청", row.temperatureFetchedAt || row.temperature_fetched_at || row.weatherFetchedAt || row.weather_fetched_at, row.weatherBaseTime || row.weather_base_time);
}

function sourceBasis(label, fetchedAt, baseTimeValue) {
	var fetched = fetchedAt ? String(fetchedAt) : "";
	if (fetched.length >= 16) { return label + " " + fetched.substring(11, 16) + " 기준"; }
	var baseTime = baseTimeValue ? String(baseTimeValue) : "";
	if (baseTime.length === 4) { return label + " " + baseTime.substring(0, 2) + ":" + baseTime.substring(2, 4) + " 기준"; }
	return label;
}

/* ===== 범례 ===== */
function renderLegend() {
	var html = "";
	[5,4,3,2,1,0].forEach(function(g) {		// 미수신(0) 포함 — 지도에 회색 마커로 표시(집계와 일치)
		html += "<li><span class='dot' style='background:" + HW_GRADE[g].color + "'></span>" + gradeDisplayName(g) + "</li>";
	});
	document.getElementById("hwLegend").innerHTML = html;
}

/* ===== 일시 (현재/내일) ===== */
function refreshDatetime() {
	var el = document.getElementById("hwDatetime");
	if (!el) { return; }
	var d = new Date();
	function p(n) { return (n < 10 ? "0" : "") + n; }
	var days = ["일","월","화","수","목","금","토"];
	if (hwMode === "tomorrow") {
		var t = new Date(d.getTime() + 86400000);
		el.textContent = "내일 " + p(t.getMonth() + 1) + "." + p(t.getDate()) + "(" + days[t.getDay()] + ") 예보 극한";
	} else {
		el.textContent = d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate())
			+ " " + p(d.getHours()) + ":" + p(d.getMinutes());
	}
}

/* ===== 현재/내일 토글 ===== */
function bindToggle() {
	var now = document.getElementById("hwTabNow");
	var tmr = document.getElementById("hwTabTmr");
	now.addEventListener("click", function() {
		if (hwMode === "now") { return; }
		hwMode = "now"; now.classList.add("on"); tmr.classList.remove("on");
		renderAll();
	});
	tmr.addEventListener("click", function() {
		if (hwMode === "tomorrow") { return; }
		hwMode = "tomorrow"; tmr.classList.add("on"); now.classList.remove("on");
		renderAll();
	});
}
