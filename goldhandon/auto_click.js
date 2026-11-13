/**
 * 금한돈 "금 적립하기" 1시간 자동 클릭 스크립트 (AutoX.js / Auto.js Pro 용)
 *
 * 동작 순서 (1시간마다 반복):
 *   1) 화면 켜기 (+ 잠금화면 위로 밀기 - 비밀번호/패턴 없는 경우만)
 *   2) 금한돈 앱 실행
 *   3) 하단 "자동채굴" 탭 누르기
 *   4) "금 적립하기" 버튼 찾아서 누르기
 *   5) 뜨는 팝업(확인/닫기 등) 정리
 *   6) 홈 화면으로 나가기
 *
 * 사용법은 같은 폴더의 README.md 참고.
 */

// ===================== 설정 =====================
var APP_NAME = "금한돈";           // 홈 화면에 보이는 앱 이름
var BUTTON_TEXT = "금 적립하기";    // 누를 버튼 글자
var TAB_TEXT = "자동채굴";          // 하단 탭 글자
var INTERVAL_MIN = 60;             // 반복 간격(분)
var LOAD_WAIT_SEC = 8;             // 앱이 뜰 때까지 기다리는 시간(초)
var POPUP_TEXTS = ["확인", "닫기", "오늘 하루 보지 않기", "다음에", "취소"]; // 클릭 후 뜨는 팝업 버튼들

// ---- 잠금 패턴 (패턴 잠금을 쓰는 경우만) ----
// 점 번호:  1 2 3
//           4 5 6
//           7 8 9
// 예) ㄱ자 패턴이면 "1236" 또는 [1,2,3,6]. 패턴 잠금이 없으면 "" 로 두세요.
var UNLOCK_PATTERN = "";
// 잠금화면에서 1번 점(왼쪽 위)과 9번 점(오른쪽 아래)의 화면 좌표.
// 개발자 옵션 → "포인터 위치" 를 켜고 잠금화면에서 점을 눌러보면 X, Y 값이 보입니다.
var DOT1_X = 0, DOT1_Y = 0;
var DOT9_X = 0, DOT9_Y = 0;
// =================================================

auto.waitFor(); // 접근성 서비스 권한 확인 (없으면 설정 화면으로 안내)

// 스크립트가 꺼지지 않도록 알림창에 상주
try { $settings.setEnabled("foreground_service", true); } catch (e) {}

function now() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

function say(msg) {
    log("[" + now() + "] " + msg);
    toast(msg);
}

function isLocked() {
    var km = context.getSystemService(android.content.Context.KEYGUARD_SERVICE);
    return km.isKeyguardLocked();
}

/** UNLOCK_PATTERN 대로 잠금 패턴을 그림 */
function drawPattern() {
    var digits = String(UNLOCK_PATTERN).replace(/[^1-9]/g, "").split("");
    if (digits.length < 2) return;
    if (!DOT1_X || !DOT9_X) {
        say("패턴 좌표(DOT1_X 등)가 설정되지 않았습니다");
        return;
    }
    var stepX = (DOT9_X - DOT1_X) / 2, stepY = (DOT9_Y - DOT1_Y) / 2;
    var pts = digits.map(function (d) {
        var n = parseInt(d, 10) - 1;
        return [Math.round(DOT1_X + (n % 3) * stepX), Math.round(DOT1_Y + Math.floor(n / 3) * stepY)];
    });
    var args = [Math.max(400, pts.length * 250)].concat(pts);
    gesture.apply(null, args);
}

/** 화면이 꺼져 있으면 켜고, 잠금화면이면 해제 (밀기 / 패턴) */
function wakeScreen() {
    if (!device.isScreenOn()) {
        device.wakeUp();
        sleep(1500);
    }
    if (isLocked()) {
        // 1) 위로 밀어서 잠금화면 넘기기
        swipe(device.width / 2, device.height * 0.85, device.width / 2, device.height * 0.25, 400);
        sleep(1500);
        // 2) 패턴 입력 화면이면 패턴 그리기 (최대 2번 시도)
        for (var i = 0; i < 2 && isLocked() && UNLOCK_PATTERN; i++) {
            drawPattern();
            sleep(2000);
        }
        if (isLocked()) say("잠금 해제 실패 - 패턴/좌표 설정을 확인하세요");
    }
    device.keepScreenOn(3 * 60 * 1000); // 작업하는 동안 3분간 화면 유지
}

/** 글자로 요소를 찾아서 누르기. 성공하면 true */
function clickText(t, timeoutMs) {
    var el = text(t).findOne(timeoutMs || 3000);
    if (!el) el = textContains(t).findOne(1000);
    if (!el) el = desc(t).findOne(1000);
    if (!el) return false;

    // 자기 자신이 클릭 가능하지 않으면 클릭 가능한 부모를 찾아서 누름
    var target = el;
    for (var i = 0; i < 5 && target && !target.clickable(); i++) target = target.parent();
    if (target && target.clickable() && target.click()) return true;

    // 그래도 안 되면 화면 좌표로 직접 터치
    var b = el.bounds();
    return click(b.centerX(), b.centerY());
}

function closePopups() {
    for (var round = 0; round < 3; round++) {
        var closed = false;
        for (var i = 0; i < POPUP_TEXTS.length; i++) {
            var el = text(POPUP_TEXTS[i]).findOne(800);
            if (el) {
                clickText(POPUP_TEXTS[i], 500);
                log("  팝업 닫음: " + POPUP_TEXTS[i]);
                closed = true;
                sleep(1500);
            }
        }
        if (!closed) break;
    }
}

function runOnce() {
    say("금한돈 자동 적립 시작");
    wakeScreen();

    if (!launchApp(APP_NAME)) {
        say("앱 '" + APP_NAME + "' 을(를) 찾을 수 없습니다. APP_NAME 을 확인하세요.");
        return false;
    }
    sleep(LOAD_WAIT_SEC * 1000);

    // 시작 시 광고/공지 팝업 정리 후 자동채굴 탭으로 이동
    closePopups();
    clickText(TAB_TEXT, 3000);
    sleep(2500);

    var ok = clickText(BUTTON_TEXT, 8000);
    if (ok) {
        say("'" + BUTTON_TEXT + "' 클릭 완료");
        sleep(3000);
        closePopups();
    } else {
        say("'" + BUTTON_TEXT + "' 버튼을 찾지 못했습니다");
    }

    sleep(1500);
    home();
    device.cancelKeepingAwake();
    return ok;
}

// ===================== 메인 루프 =====================
say("1시간 자동 적립 시작됨 (" + INTERVAL_MIN + "분 간격)");
while (true) {
    try {
        runOnce();
    } catch (e) {
        log("오류: " + e);
        try { home(); } catch (e2) {}
    }
    var next = new Date(Date.now() + INTERVAL_MIN * 60 * 1000);
    log("다음 실행: " + next.toLocaleTimeString());
    sleep(INTERVAL_MIN * 60 * 1000);
}
