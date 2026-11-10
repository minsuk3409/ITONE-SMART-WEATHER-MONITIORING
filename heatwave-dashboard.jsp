<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" trimDirectiveWhitespaces="true" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="fn" uri="http://java.sun.com/jsp/jstl/functions" %>
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags" %>
<%
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0L);
%>
<c:set var="context" value="${pageContext.request.contextPath}" />
<c:set var="currentdtmt" value="${currentdtmcrm}" />
<c:set var="assetVersion" value="20261028.1" />
<c:set var="weatherViewKind" value="${empty fn:trim(siteCd) ? 'admin' : 'general'}" />
<spring:eval var="kakaomapkey" expression="@conf.getProperty('kakao.map.js.key')" />
<c:url var="cssUrl" value="/res/css/ctrlmnt/heatwave-dashboard-ui.css"><c:param name="v" value="${assetVersion}" /></c:url>
<c:url var="iconUrl" value="/res/image/heatwave/dashboard-icons.svg"><c:param name="v" value="${assetVersion}" /></c:url>
<c:url var="compatUrl" value="/res/css/ctrlmnt/heatwave-dashboard-compat.css"><c:param name="v" value="${assetVersion}" /></c:url>
<c:url var="layoutUrl" value="/res/css/ctrlmnt/heatwave-dashboard-layout.css"><c:param name="v" value="${assetVersion}" /></c:url>
<c:url var="configUrl" value="/res/script/ctrlmnt/heatwave-dashboard-config.js"><c:param name="v" value="${assetVersion}" /></c:url>
<c:url var="modelUrl" value="/res/script/ctrlmnt/heatwave-dashboard-model.js"><c:param name="v" value="${assetVersion}" /></c:url>
<c:url var="uiUrl" value="/res/script/ctrlmnt/heatwave-dashboard-ui.js"><c:param name="v" value="${assetVersion}" /></c:url>
<c:url var="legacyUrl" value="/res/script/ctrlmnt/heatwave-dashboard-app.js"><c:param name="v" value="${assetVersion}" /><c:param name="t" value="${currentdtmt}" /></c:url>
<c:url var="weatherIconBase" value="/res/image/heatwave/weather-ui" />
<c:url var="weatherIconScript" value="/res/image/heatwave/weather-ui/weather-icons.js"><c:param name="v" value="${assetVersion}" /></c:url>
<%-- 라이브러리 구분 쉼표는 기존 SDK 호출 형식 그대로 유지한다. --%>
<c:url var="hwKakaoUrl" value="https://dapi.kakao.com/v2/maps/sdk.js"><c:param name="appkey" value="${kakaomapkey}" /></c:url>
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>SmartSafety · 스마트 기상정보 모니터링</title>
    <link rel="icon" href="<c:out value='${context}'/>/res/image/smartsafety_icon.png" />
    <link rel="stylesheet" href="<c:out value='${context}'/>/res/lib/fonts/fonts.css" />
    <link rel="stylesheet" href="<c:out value='${compatUrl}'/>" />
    <link rel="stylesheet" href="<c:out value='${cssUrl}'/>" />
    <link rel="stylesheet" href="<c:out value='${layoutUrl}'/>" />
</head>
<body class="hw-dashboard">
<!-- Server values are escaped in HTML attributes, never interpolated into JavaScript strings.
     heatwaveViewScope: hq (default) / field. This controls layout only, NOT authorization. -->
<div id="hwBoot" hidden
     data-context="<c:out value='${context}'/>"
     data-icon-url="<c:out value='${iconUrl}'/>"
     data-disp-key="<c:out value='${dispKey}'/>"
     data-field-id="<c:out value='${fieldId}'/>"
     data-site-cd="<c:out value='${siteCd}'/>"
     data-view-kind="<c:out value='${weatherViewKind}'/>"
     data-view-scope="<c:out value='${heatwaveViewScope}'/>"
     data-initial-mode="<c:out value='${heatwaveInitialMode}'/>"></div>
<a class="hwx-skip" href="#hwMain">기상정보 본문으로 이동</a>
<div id="hwShell" class="hw-wrap" data-season="def" data-scope="hq" data-view="<c:out value='${weatherViewKind}'/>" data-source="legacy" data-time="now">
    <header class="hw-top">
        <h1 class="hw-title">스마트 기상정보 모니터링 시스템</h1>
        <div class="hw-top-right">
            <span id="hwDatetime" class="hw-datetime" aria-label="현재 시각">—</span>
            <div class="hw-toggle" role="group" aria-label="계절별 보기">
                <button type="button" id="wtabdef" class="on" data-mode="def" aria-pressed="true">상시</button>
                <button type="button" id="wtabsummer" data-mode="summer" aria-pressed="false">혹서기</button>
                <button type="button" id="wtabwinter" data-mode="winter" aria-pressed="false">혹한기</button>
            </div>
            <div class="hw-toggle hwx-time-toggle" role="group" aria-label="기상자료 시점">
                <button type="button" id="hwTabNow" class="on" data-mode="now" aria-pressed="true">현재</button>
                <button type="button" id="hwTabTmr" data-mode="tomorrow" aria-pressed="false">내일예보</button>
            </div>
            <c:if test="${fn:startsWith(fn:toUpperCase(fieldId), 'DW1')}">
                <a id="hwMusa" class="hw-musa-btn" href="https://cloud.musa-go.com/" target="_blank" rel="noopener noreferrer">체감온도 모니터링(무사고)</a>
            </c:if>
            <button type="button" id="hwFull" class="hw-full-btn" title="전체화면" aria-label="전체화면 전환"><svg id="hwFullIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h4V5H5v6h2V7zm10 0v4h2V5h-6v2h4zM7 17v-4H5v6h6v-2H7zm12-4h-2v4h-4v2h6v-6z"/></svg></button>
        </div>
    </header>
    <div id="hwxNotice" class="hwx-notice" role="status" hidden></div>
    <main id="hwMain" class="hw-body" tabindex="-1">
        <%-- siteCd 없음: 관리자 배치 / 있음: 현장 상세 배치. 조회·접근 권한과는 별개다. --%>
        <section class="hw-left" aria-label="현장 지도와 기상정보">
            <div class="hw-left-top">
                <section id="hwMapPanel" class="hwx-panel hwx-map-panel" aria-label="전국 현장 지도">
                    <div class="hwx-map-stage">
                        <div class="hw-mapbar"><button id="hwHome" class="mapbar-btn" type="button" aria-label="전국 보기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg></button><button id="hwNear" class="mapbar-btn" type="button">주변</button><span id="hwCrumb" class="mapbar-crumb">전국</span><button id="hwxSearchOpen" class="hwx-text-button" type="button">현장 검색</button></div>
                        <div id="hwWeatherChip" class="hw-weather-chip hwx-legacy">현장 선택 시 날씨 표시</div>
                        <div id="hwxWeatherChip" class="hw-weather-chip hwx-managed">현장을 선택하세요</div>
                        <div id="hwMap" class="hw-map" aria-label="카카오 지도"></div>
                        <div id="hwxMapError" class="hwx-map-error" hidden>지도 스크립트를 불러오지 못했습니다. 네트워크·지도 키 설정을 확인하세요.</div>
                    </div>
                </section>
                <aside class="hwx-overview-column" aria-label="현장 현황과 지역 기상정보">
                <section id="hwxSelectedAlertPanel" class="hwx-panel" aria-labelledby="hwxSelectedAlertTitle">
                    <div class="hwx-panel-head"><h2 id="hwxSelectedAlertTitle">현장 특보 현황</h2><button type="button" id="hwxSelectedMore" class="hwx-text-button" disabled>더보기 ↗</button></div>
                    <div id="hwxSelectedAlerts" class="hwx-selected-alerts" aria-live="polite"><p class="hwx-empty">선택 현장의 특보정보를 조회하고 있습니다.</p></div>
                </section>
                <section id="hwxOverviewPanel" class="hwx-panel hwx-overview-panel" aria-label="관제 현장 현황">
                    <div class="hwx-panel-head"><h2>현장 현황</h2><span id="hwxOverviewScope" class="hwx-muted">관제 조회 범위</span></div>
                    <div class="hwx-overview-content">
                        <div id="hwxStats" class="hwx-stats">
                            <div class="hwx-stat"><img class="wx-icon hwx-stat-icon" data-weather-summary-icon="site-total" src="<c:out value='${weatherIconBase}'/>/svg/site-total.svg" width="36" height="36" alt="" aria-hidden="true" /><span>수신 현장</span><strong>—</strong><small>현장 목록 조회 중</small></div>
                            <div class="hwx-stat hwx-stat--warning"><img class="wx-icon hwx-stat-icon" data-weather-summary-icon="site-advisory" src="<c:out value='${weatherIconBase}'/>/svg/site-advisory.svg" width="36" height="36" alt="" aria-hidden="true" /><span>특보 발효현장</span><strong>—</strong><small>현재 발효현황 확인 중</small></div>
                            <div class="hwx-stat hwx-stat--danger"><img class="wx-icon hwx-stat-icon" data-weather-summary-icon="site-risk" src="<c:out value='${weatherIconBase}'/>/svg/site-risk.svg" width="36" height="36" alt="" aria-hidden="true" /><span>기상 위험현장</span><strong>—</strong><small>현재 특보 경보 이상 발효 현장</small></div>
                        </div>
                        <div id="hwxOverviewAlerts" class="hwx-overview-alerts"><p class="hwx-empty">특보정보 조회 중</p></div>
                    </div>
                </section>
                <section id="hwxOtherFieldPanel" class="hwx-panel hwx-other-field-panel" aria-label="타 현장 기상정보 조회">
                    <div class="hwx-panel-head"><h2>지역별 기상정보 조회</h2></div>
                    <div id="hwxRegionButtons" class="hwx-region-buttons" role="group" aria-label="지역별 현장 기상정보"></div>
                </section>
                </aside>
            </div>
            <section id="hwWeatherPanel" class="hwx-panel hwx-weather-panel" aria-label="선택 현장 기상정보">
                <div class="hwx-panel-head hwx-weather-title"><h2>현장 기상정보</h2></div>
                <div class="hw-legendbar"><div class="hwx-weather-heading"><span id="hwFieldLabel" class="hw-field-label hwx-legacy">현장을 선택하세요</span><span id="hwxFieldLabel" class="hw-field-label hwx-managed">현장을 선택하세요</span></div><ul id="hwLegend" class="hw-legend hwx-legacy"></ul><ul id="hwxLegend" class="hw-legend hwx-managed"></ul></div>
                <%-- 기존 6개 기상 위젯은 유지하고 대우 화면에서만 대기질 2개를 같은 줄에 표시한다. --%>
                <div id="hw-weather-databox"><div id="hwWidgets" class="hw-widgets hwx-legacy"><p class="hw-todo">기상자료를 불러오는 중입니다.</p></div><div id="hwxWidgets" class="hwx-widgets hwx-managed"></div><div id="hwxWeatherAir" class="hwx-weather-air"></div></div>
                <div class="hwx-weather-sources">
                    <p id="hwxWeatherTime" class="hwx-footnote">기상자료의 관측시각을 확인하고 있습니다.</p>
                    <p id="hwxWeatherAirTime" class="hwx-footnote hwx-weather-air-time">미세먼지 · 관측자료 없음</p>
                </div>
            </section>
            <div class="hwx-bottom-overview">
            <section id="hwxMajorAlertPanel" class="hwx-panel hwx-major-alert-panel" aria-label="주요 특보 현황">
                <div class="hwx-panel-head"><h2>주요특보현황 <span class="hwx-muted">(당사 현장 기준)</span></h2><button type="button" class="hwx-text-button" data-hwx-alerts>더보기 ↗</button></div>
                <div id="hwWidgets2" class="hw-widgets2 hwx-major-alerts"><p class="hwx-empty">기상특보를 불러오는 중입니다.</p></div>
                <p id="hwxAlertCountNote" class="hwx-footnote">현재 발효 특보 조회 중</p>
            </section>
            <section id="hwxHqOverviewPanel" class="hwx-panel hwx-hq-overview-panel" aria-labelledby="hwxHqOverviewTitle">
                <div class="hwx-panel-head"><h2 id="hwxHqOverviewTitle">본부별 현황</h2></div>
                <div id="hwxHqOverview" class="hwx-table-scroll"><p class="hwx-empty">본부별 현장 현황을 조회하고 있습니다.</p></div>
                <p id="hwxHqOverviewNote" class="hwx-footnote">상단 현장 현황과 같은 조회 범위를 본부별로 표시합니다.</p>
            </section>
            </div>
        </section>
        <div id="hwxRightRail" class="hwx-right-rail" role="region" aria-label="공통 현장 현황">
        <%-- 기존 표의 DOM과 렌더러를 유지한다. 선택 현장 특보는 지도 옆 공통 패널에 표시한다. --%>
        <aside id="hwRight" class="hw-right" aria-label="지역·본부별 체감온도 현황">
            <div id="hwRegionPanel" class="hw-agg"><div class="hwx-panel-head"><h2>기온 현황 (지역별)</h2><button type="button" class="hwx-text-button" data-hwx-rules>기준 ⓘ</button></div><div class="hwx-table-scroll"><table id="hwAggRegion" class="hw-agg-table hwx-legacy"><tbody><tr><td class="hw-todo">집계 로딩…</td></tr></tbody></table><div id="hwxAggRegion" class="hwx-managed"></div></div></div>
            <div id="hwHqPanel" class="hw-agg"><h2>기온 현황 (본부별)</h2><div class="hwx-table-scroll"><table id="hwAggHq" class="hw-agg-table hwx-legacy"><tbody><tr><td class="hw-todo">집계 로딩…</td></tr></tbody></table><div id="hwxAggHq" class="hwx-managed"></div></div></div>
            <section id="hwAlertPanel" class="hw-alert" hidden aria-hidden="true"><div class="hw-alert-head"><h2>기상특보 (주의보/경보)</h2><span id="hwAlertArea" class="hw-alert-area">선택 현장 기준</span></div><div id="hwAlertGrid" class="hw-alert-grid"></div></section>
            <p id="hwxAggregateNote" class="hwx-footnote">미수신은 정상 등급에 포함하지 않습니다.</p>
            <p id="hwxSeasonNote" class="hwx-footnote hwx-season-note" hidden>혹한기 구간 확정 대기 · 기존 기준 임시 적용</p>
        </aside>
        </div>
    </main>
</div>
<!-- Existing search dialog: IDs and display convention retained for legacy app. -->
<div id="hwModal" class="hw-modal" style="display:none;" role="dialog" aria-modal="true" aria-labelledby="hwModalTitle"><div class="hw-modal-box"><div class="hw-modal-head"><span id="hwModalTitle">현장 검색</span><button id="hwModalClose" type="button" aria-label="현장 검색 닫기">×</button></div><div class="hw-modal-search"><label class="hwx-sr-only" for="hwModalSearch">현장명 검색</label><input id="hwModalSearch" type="search" placeholder="현장명을 입력하세요" autocomplete="off" /></div><ul id="hwModalList" class="hw-modal-list"></ul></div></div>
<!-- New dialogs use their own namespace; never compete with the legacy list. -->
<div id="hwxModal" class="hwx-modal" hidden role="dialog" aria-modal="true" aria-labelledby="hwxModalTitle"><div class="hwx-modal-box"><div class="hwx-modal-head"><div><span id="hwxModalKicker" class="hwx-section-kicker">FIELD SEARCH</span><h2 id="hwxModalTitle">현장 검색</h2></div><button id="hwxModalClose" type="button" class="hwx-icon-button" aria-label="팝업 닫기">×</button></div><div id="hwxModalSearchWrap" class="hwx-modal-search"><label class="hwx-sr-only" for="hwxModalSearch">현장명 검색</label><input id="hwxModalSearch" type="search" placeholder="현장명, 주소, 본부로 검색" autocomplete="off" /><p id="hwxSearchCount" class="hwx-muted" role="status"></p></div><div id="hwxModalBody" class="hwx-modal-body"></div></div></div>
<noscript><div class="hwx-notice">기상정보를 표시하려면 JavaScript가 필요합니다.</div></noscript>
<!-- Keep this order: the existing dashboard app consumes the UI/model bridge and retains the real API/map connection. -->
<script src="<c:out value='${configUrl}'/>"></script>
<script src="<c:out value='${modelUrl}'/>"></script>
<script src="<c:out value='${weatherIconScript}'/>"></script>
<script src="<c:out value='${uiUrl}'/>"></script>
<script id="hwKakaoSdk" src="<c:out value='${hwKakaoUrl}'/>&amp;libraries=services,clusterer&amp;autoload=false"></script>
<script id="hwLegacyApp" src="<c:out value='${legacyUrl}'/>"></script>
</body>
</html>
