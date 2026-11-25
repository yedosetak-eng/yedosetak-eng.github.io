/**
 * ============================================================================
 *  개인 비서 백엔드 — Google Apps Script + Gemini Function Calling
 * ============================================================================
 *
 *  assistant.html 이 이 웹 앱으로 { pin, message, history } 를 POST 하고,
 *  Apps Script 가 Gemini(gemini-2.5-flash)에 도구(Function Calling)를 붙여
 *  캘린더·할 일·시트·메일·노션을 실제로 확인한 답을 돌려줍니다.
 *
 *  같은 웹 앱 주소를 텔레그램 봇의 웹훅으로도 씁니다. 텔레그램 업데이트가 오면
 *  PIN 대신 TELEGRAM_CHAT_ID(허용된 본인 chat_id)로 신원을 확인하고, 같은
 *  Gemini + 도구 루프의 답을 텔레그램 sendMessage 로 돌려줍니다.
 *
 *  이 파일에는 어떤 비밀값도 들어 있지 않습니다. 모든 키는 스크립트 속성에 둡니다.
 *
 *  ---------------------------------------------------------------------------
 *  [설치 순서]
 *  ---------------------------------------------------------------------------
 *  1) https://script.google.com → 새 프로젝트
 *  2) 이 파일 내용 전체를 Code.gs 에 붙여넣고 저장
 *  3) 왼쪽 [서비스] + → "Tasks API" 추가 (식별자 Tasks, 고급 Google 서비스)
 *     · 할 일 기능을 쓰지 않으면 생략 가능 (해당 도구만 오류를 돌려줍니다)
 *  4) [프로젝트 설정] → 시간대를 Asia/Seoul 로 변경  ← 날짜·시각 해석에 중요
 *  5) [프로젝트 설정] → 스크립트 속성에 아래 값 등록
 *       GEMINI_API_KEY   (필수) Google AI Studio 에서 발급한 API 키
 *       ACCESS_PIN       (필수) 웹 앱 접속 PIN — 6자리 이상 권장
 *       SHARED_SHEET_ID  (선택) 자주 쓰는 구글 시트 ID (read_sheet/append 기본값)
 *       NOTION_TOKEN     (선택) 노션 검색을 쓰려면 integration 토큰
 *       NOTION_VERSION   (선택) 기본 2022-06-28
 *       TELEGRAM_BOT_TOKEN      (선택) @BotFather 토큰 — 텔레그램으로 쓰려면 필수
 *       TELEGRAM_CHAT_ID        (선택) 답장을 허용할 chat_id. 쉼표로 여러 개 가능.
 *                               비워 두면 봇에게 /myid 를 보내 본인 id를 확인한 뒤 등록
 *       TELEGRAM_WEBHOOK_SECRET (선택·권장) 웹훅 위조 방지용 임의 문자열
 *  6) 편집기에서 setupCheck() 를 한 번 실행 → 실행 로그로 설정 상태 확인
 *     (처음 실행하면 권한 승인 창이 뜹니다. 캘린더·할 일·시트·메일 권한은
 *      각 도구가 실제로 필요로 하는 범위입니다.)
 *  7) [배포] → 새 배포 → 유형 "웹 앱"
 *       설명: assistant
 *       다음 사용자로 실행: 나
 *       액세스 권한: 모든 사용자          ← 브라우저 fetch 호출에 필요
 *     → 배포 후 나오는 https://script.google.com/macros/s/.../exec 주소를
 *       assistant.html 설정 화면에 입력 (PIN과 함께)
 *  8) 코드를 고친 뒤에는 [배포 관리] → 연필 → 버전 "새 버전" 으로 다시 배포해야 반영됩니다.
 *  9) (선택) 텔레그램 봇으로도 쓰기
 *       a. 텔레그램에서 @BotFather → /newbot → 이름·아이디 정하면 토큰이 나옵니다.
 *       b. 스크립트 속성 TELEGRAM_BOT_TOKEN 에 그 토큰을 넣고,
 *          (권장) TELEGRAM_WEBHOOK_SECRET 에 아무 임의 문자열(20자 이상)을 넣습니다.
 *       c. 위 7) 처럼 웹 앱을 "모든 사용자"로 배포한 뒤,
 *          편집기 함수 선택에서 setTelegramWebhook() 를 한 번 실행합니다.
 *       d. 봇에게 /myid 를 보내면 chat_id 가 오므로, 그 값을 TELEGRAM_CHAT_ID 에 넣고
 *          다시 setTelegramWebhook() 는 필요 없습니다(속성만 저장하면 다음 메시지부터 적용).
 *          sendTelegramTest() 로 연결을 확인할 수 있습니다.
 *       · TELEGRAM_CHAT_ID 가 비어 있으면 AI 를 부르지 않고, /myid 와 등록 안내(자신의 chat_id)만
 *         돌려줍니다. 목록에 없는 사람의 메시지에는 아무 응답도 하지 않습니다.
 *
 *  ---------------------------------------------------------------------------
 *  [보안 메모]
 *  ---------------------------------------------------------------------------
 *  · ACCESS_PIN 이 틀리면 Gemini 호출 전에 즉시 거절합니다.
 *  · Apps Script 웹 앱은 HTTP 상태 코드를 지정할 수 없어 항상 200 으로 응답합니다.
 *    따라서 결과 JSON 안에 ok / status 를 담고, 클라이언트가 그것으로 판단합니다.
 *  · 텔레그램 응답은 반드시 HtmlService 로 돌려줍니다(telegramOk_). ContentService 응답은
 *    googleusercontent.com 으로 302 되고, 텔레그램은 리다이렉트를 따라가지 않아
 *    "Wrong response from the webhook: 302 Moved Temporarily" 로 계속 재전송됩니다.
 *  · 도구는 "조회"와 "추가"만 있습니다. 삭제·메일 발송 같은 되돌리기 어려운 동작은
 *    의도적으로 넣지 않았습니다.
 *  · 텔레그램은 웹 앱 주소를 아는 사람이면 누구나 호출할 수 있으므로, chat_id 허용 목록이
 *    신원 확인의 전부입니다. 목록에 없는 chat 에는 답도, 오류도 보내지 않습니다.
 *    (목록이 비어 있을 때만 /myid·등록 안내로 그 사람 자신의 chat_id 를 돌려줍니다 — 비밀값 아님)
 *  · TELEGRAM_WEBHOOK_SECRET 을 넣으면 Telegram 이 보내는
 *    X-Telegram-Bot-Api-Secret-Token 헤더가 일치하지 않는 요청은 처리하지 않습니다.
 *  · 같은 update_id 는 CacheService 로 한 번만 처리해, 웹훅 재전송 때 일정·할 일이
 *    두 번 추가되는 일을 막습니다.
 * ============================================================================
 */

var PROPS = PropertiesService.getScriptProperties();
var TZ = 'Asia/Seoul';
var GEMINI_MODEL = 'gemini-2.5-flash';
var GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
var MAX_TOOL_ROUNDS = 5;
var MAX_HISTORY = 20;

var TG_API = 'https://api.telegram.org/bot';
var TG_MAX_LEN = 4000;        // Telegram 상한 4096 — 여유를 둡니다.
var TG_HISTORY_TURNS = 10;    // 기억할 최근 대화 턴 수(한 턴 = 사용자+비서 2개)
var TG_HISTORY_TTL = 21600;   // 6시간
var TG_KEEP_CHARS = 2000;     // 기억에 남길 답변 길이(캐시 용량 보호)

/* ==========================================================================
 *  웹 앱 진입점
 * ========================================================================== */

/** 브라우저로 /exec 를 열면 서비스 상태만 돌려줍니다(민감정보 없음). */
function doGet(e) {
  return jsonOut_({ ok: true, service: 'personal-assistant', model: GEMINI_MODEL });
}

function doPost(e) {
  var started = Date.now();
  try {
    var body = {};
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {};
    } catch (parseErr) {
      return jsonOut_({ ok: false, status: 400, error: '요청 본문이 JSON이 아닙니다.' });
    }

    // ── 텔레그램 웹훅 분기 ─────────────────────────────────────────
    // PIN 대신 chat_id 허용 목록으로 인증하므로 PIN 검증보다 먼저 처리합니다.
    if (isTelegramUpdate_(body)) {
      try {
        handleTelegramUpdate_(body, e);
      } catch (tgErr) {
        Logger.log('텔레그램 처리 오류: ' + errText_(tgErr));
      }
      return telegramOk_();
    }

    var expectedPin = PROPS.getProperty('ACCESS_PIN');
    if (!expectedPin) {
      return jsonOut_({ ok: false, status: 500, error: '서버에 ACCESS_PIN 스크립트 속성이 없습니다.' });
    }
    if (!body.pin || !safeEqual_(String(body.pin), String(expectedPin))) {
      return jsonOut_({ ok: false, status: 401, error: 'PIN이 올바르지 않습니다.' });
    }

    if (body.action === 'ping') {
      return jsonOut_({ ok: true, pong: true, model: GEMINI_MODEL });
    }

    var message = String(body.message || '').trim().slice(0, 4000);
    if (!message) {
      return jsonOut_({ ok: false, status: 400, error: '메시지가 비어 있습니다.' });
    }

    var result = converse_(message, body.history);
    return jsonOut_({
      ok: true,
      reply: result.text,
      tools: result.tools,
      elapsedMs: Date.now() - started
    });
  } catch (err) {
    return jsonOut_({ ok: false, status: 500, error: String((err && err.message) || err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 텔레그램 웹훅에 돌려줄 200 응답.
 *
 * ContentService 응답은 script.google.com 이 아니라 script.googleusercontent.com 일회용 주소로
 * 302 리다이렉트되고, 텔레그램은 리다이렉트를 따라가지 않습니다(그러면
 * getWebhookInfo 에 "Wrong response from the webhook: 302 Moved Temporarily" 가 남고
 * 같은 업데이트를 계속 재전송합니다). HtmlService 응답은 웹 앱 자체 페이지로 바로 나가므로
 * 텔레그램이 200 으로 받습니다. 웹챗(브라우저 fetch)은 리다이렉트를 따라가므로 그대로 JSON 을 씁니다.
 */
function telegramOk_() {
  try {
    return HtmlService.createHtmlOutput('OK');
  } catch (e) {
    // HtmlService 를 쓸 수 없는 환경이면 형태라도 돌려줍니다.
    return ContentService.createTextOutput('OK');
  }
}

/** 길이·내용 유출을 줄이는 단순 비교(상수 시간에 가깝게). */
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ==========================================================================
 *  텔레그램 봇 웹훅
 * ==========================================================================
 *
 *  [메시지 처리 흐름]
 *   1) TELEGRAM_WEBHOOK_SECRET 이 있으면 X-Telegram-Bot-Api-Secret-Token 확인
 *   2) update_id 중복 처리 방지
 *   3) chat.id 가 TELEGRAM_CHAT_ID 목록에 있는지 확인 — 없으면 조용히 무시
 *      (목록이 비어 있을 때만 /myid·등록 안내로 그 사람 자신의 chat_id 를 돌려줌)
 *   4) /myid · /clear · /help 같은 명령 처리
 *   5) 그 밖의 텍스트 → converse_() (웹챗과 같은 Gemini + 도구 루프)
 *   6) 답을 4000자 이하로 나눠 sendMessage (parse_mode 없이 plain text)
 *   7) 최근 10턴을 chat_id 별 CacheService 에 남겨 연속 대화 유지
 * ========================================================================== */

/** 텔레그램 웹훅 업데이트인지 판별합니다. */
function isTelegramUpdate_(body) {
  if (!body || typeof body !== 'object') return false;
  var msg = body.message || body.edited_message;
  if (!msg || !msg.chat) return false;
  return msg.chat.id !== undefined && msg.chat.id !== null;
}

function handleTelegramUpdate_(update, e) {
  var token = String(PROPS.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!token) {
    Logger.log('텔레그램: TELEGRAM_BOT_TOKEN 이 없어 업데이트를 무시했습니다.');
    return;
  }

  // 웹훅 위조 방지(선택). 설정했으면 헤더가 정확히 같아야 처리합니다.
  var secret = String(PROPS.getProperty('TELEGRAM_WEBHOOK_SECRET') || '').trim();
  if (secret) {
    var got = telegramSecretFromRequest_(e);
    if (!got || !safeEqual_(got, secret)) {
      Logger.log('텔레그램: 웹훅 비밀 토큰이 일치하지 않아 무시했습니다.');
      return;
    }
  }

  // 같은 update 가 두 번 와도 일정·할 일이 두 번 추가되지 않게 합니다.
  if (!consumeTelegramUpdate_(update.update_id)) {
    Logger.log('텔레그램: 이미 처리한 update_id — 건너뜁니다.');
    return;
  }

  var msg = update.message || update.edited_message;
  var chatId = String(msg.chat.id);
  var text = typeof msg.text === 'string' ? msg.text : '';
  var trimmed = text.trim();
  var command = trimmed.toLowerCase().replace(/@[a-z0-9_]+$/, '');

  var allowed = allowedChatIds_();
  var isAllowed = allowed.length > 0 && allowed.indexOf(chatId) >= 0;

  // 허용 목록에 없는 chat: /myid 로 self id 를 확인하는 경우 말고는 아무 응답도 하지 않습니다.
  if (!isAllowed && allowed.length > 0) {
    Logger.log('텔레그램: 허용되지 않은 chat(' + maskChatId_(chatId) + ') — 무시했습니다.');
    return;
  }

  if (command === '/myid' || command === '/id') {
    // allowed.length === 0 이면 본인 확인용, 아니면 허용된 사용자용.
    sendTelegramMessage_(token, chatId, 'chat_id: ' + chatId);
    return;
  }

  if (!isAllowed) {
    // 목록이 비어 있는 상태에서 일반 메시지를 보낸 경우 — AI 는 호출하지 않고 등록 안내만 합니다.
    sendTelegramMessage_(token, chatId,
      'chat_id: ' + chatId + '\n' +
      '이 대화는 아직 등록되지 않았습니다. Apps Script 스크립트 속성 TELEGRAM_CHAT_ID 에 위 값을 넣으면 답장을 시작합니다.');
    return;
  }

  if (command === '/clear' || command === '/reset') {
    telegramHistoryClear_(chatId);
    sendTelegramMessage_(token, chatId, '대화 기억을 지웠습니다.');
    return;
  }

  if (command === '/start' || command === '/help' || command === '/도움말') {
    sendTelegramMessage_(token, chatId, telegramHelpText_());
    return;
  }

  if (!trimmed) {
    sendTelegramMessage_(token, chatId, '텍스트 메시지로 물어봐 주세요. 사진·파일은 아직 읽지 못합니다.');
    return;
  }

  var question = trimmed.slice(0, 4000);
  sendTelegramTyping_(token, chatId);

  var history = telegramHistoryGet_(chatId);
  var result;
  try {
    result = converse_(question, history);
  } catch (err) {
    Logger.log('텔레그램 답변 실패: ' + errText_(err));
    sendTelegramMessage_(token, chatId, '처리하지 못했습니다: ' + errText_(err).slice(0, 300));
    return;
  }

  var reply = String((result && result.text) || '').trim() || '답변을 만들지 못했습니다. 다시 한 번 물어봐 주세요.';
  sendTelegramMessage_(token, chatId, reply);
  telegramHistoryAppend_(chatId, question, reply);
}

function telegramHelpText_() {
  return [
    '개인 비서 봇입니다. 그냥 말을 걸면 캘린더·할 일·시트·메일·노션을 실제로 확인해 답합니다.',
    '',
    '/myid — 이 대화의 chat_id 확인',
    '/clear — 대화 기억 지우기',
    '/help — 이 안내',
    '',
    '할 수 있는 일: 일정 조회·추가, 할 일 조회·추가, 시트 읽기·행 추가, 메일 검색, 노션 검색',
    '삭제·메일 발송처럼 되돌리기 어려운 동작은 하지 않습니다.'
  ].join('\n');
}

/** 스크립트 속성 TELEGRAM_CHAT_ID — 쉼표·공백·세미콜론 구분 모두 허용. */
function allowedChatIds_() {
  var raw = String(PROPS.getProperty('TELEGRAM_CHAT_ID') || '');
  return raw.split(/[,\s;]+/).map(function (v) { return v.trim(); }).filter(function (v) { return !!v; });
}

function telegramSecretFromRequest_(e) {
  var h = (e && e.header) || {};
  for (var k in h) {
    if (String(k).toLowerCase() === 'x-telegram-bot-api-secret-token') return String(h[k] || '');
  }
  return '';
}

/** true = 처음 보는 update (처리 진행), false = 이미 처리함. */
function consumeTelegramUpdate_(updateId) {
  if (updateId === undefined || updateId === null) return true;
  try {
    var cache = CacheService.getScriptCache();
    var key = 'tg_upd_' + String(updateId);
    if (cache.get(key)) return false;
    cache.put(key, '1', 900);
  } catch (e) {
    Logger.log('텔레그램: update 중복 확인을 건너뜁니다 — ' + errText_(e));
  }
  return true;
}

function telegramApi_(token, method, payload) {
  var res = UrlFetchApp.fetch(TG_API + token + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  var data = null;
  try { data = JSON.parse(text); } catch (parseErr) { data = null; }

  if (code !== 200 || !data || data.ok !== true) {
    throw new Error('Telegram ' + method + ' 오류 ' + code + ': ' + String(text).slice(0, 200));
  }
  return data.result;
}

/** 답장을 4000자 이하로 나눠 보냅니다. parse_mode 를 쓰지 않아 마크다운 오류가 없습니다. */
function sendTelegramMessage_(token, chatId, text) {
  var body = String(text || '').trim();
  if (!body) return 0;

  var chunks = splitTelegramText_(body, TG_MAX_LEN);
  var sent = 0;
  for (var i = 0; i < chunks.length; i++) {
    try {
      telegramApi_(token, 'sendMessage', {
        chat_id: chatId,
        text: chunks[i],
        disable_web_page_preview: true
      });
      sent++;
    } catch (e) {
      Logger.log('텔레그램 전송 실패(' + (i + 1) + '/' + chunks.length + '): ' + errText_(e));
    }
  }
  return sent;
}

function sendTelegramTyping_(token, chatId) {
  try {
    telegramApi_(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch (e) {
    Logger.log('텔레그램 typing 표시 실패: ' + errText_(e));
  }
}

/** 줄바꿈 우선, 그다음 공백에서 자릅니다. 서로게이트 쌍(이모지)이 갈라지지 않게 보정합니다. */
function splitTelegramText_(text, limit) {
  var s = String(text || '').replace(/\r\n/g, '\n');
  if (!s) return [];

  var out = [];
  while (s.length > limit) {
    var cut = s.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = s.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    if (cut > 0 && /[\uD800-\uDBFF]/.test(s.charAt(cut - 1))) cut -= 1;
    var piece = s.slice(0, cut).replace(/\s+$/, '');
    if (piece) out.push(piece);
    s = s.slice(cut).replace(/^\s+/, '');
  }
  if (s) out.push(s);
  return out;
}

/* ── 대화 기억(chat_id 별, CacheService) ───────────────────────────── */

function telegramHistoryKey_(chatId) {
  return 'tg_hist_' + String(chatId).replace(/[^0-9-]/g, '');
}

function telegramHistoryGet_(chatId) {
  try {
    var raw = CacheService.getScriptCache().get(telegramHistoryKey_(chatId));
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function telegramHistoryAppend_(chatId, userText, replyText) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(5000); } catch (e) { locked = false; }

  try {
    var arr = telegramHistoryGet_(chatId);
    arr.push({ role: 'user', text: String(userText).slice(0, TG_KEEP_CHARS) });
    arr.push({ role: 'assistant', text: String(replyText).slice(0, TG_KEEP_CHARS) });
    var max = TG_HISTORY_TURNS * 2;
    if (arr.length > max) arr = arr.slice(arr.length - max);
    CacheService.getScriptCache().put(telegramHistoryKey_(chatId), JSON.stringify(arr), TG_HISTORY_TTL);
  } catch (e) {
    Logger.log('텔레그램 기억 저장 실패: ' + errText_(e));
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e2) { /* 무시 */ } }
  }
}

function telegramHistoryClear_(chatId) {
  try {
    CacheService.getScriptCache().remove(telegramHistoryKey_(chatId));
  } catch (e) {
    Logger.log('텔레그램 기억 삭제 실패: ' + errText_(e));
  }
}

/* ── 설정용 1회 실행 함수 ─────────────────────────────────────────── */

/** 웹 앱 URL 로 setWebhook 을 호출합니다. 배포 후 편집기에서 한 번 실행하세요. */
function setTelegramWebhook() {
  var token = String(PROPS.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!token) {
    Logger.log('실패: 스크립트 속성 TELEGRAM_BOT_TOKEN 이 없습니다. @BotFather 에서 발급한 토큰을 먼저 등록하세요.');
    return;
  }

  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  if (!url || url.indexOf('/exec') < 0) {
    Logger.log('실패: 웹 앱 주소를 얻지 못했습니다. [배포] → 새 배포 → 웹 앱(실행: 나 / 액세스: 모든 사용자)으로 배포한 뒤 다시 실행하세요.');
    return;
  }

  var payload = {
    url: url,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: false
  };
  var secret = String(PROPS.getProperty('TELEGRAM_WEBHOOK_SECRET') || '').trim();
  if (secret) payload.secret_token = secret;

  try {
    telegramApi_(token, 'setWebhook', payload);
    Logger.log('웹훅 등록 성공 — ' + url);
    if (secret) {
      Logger.log('  secret_token 사용: 예, X-Telegram-Bot-Api-Secret-Token 검증이 켜졌습니다.');
    } else {
      Logger.log('  secret_token 사용: 아니오 — 웹 앱 주소를 아는 제3자가 가짜 업데이트를 보낼 수 있으니, TELEGRAM_WEBHOOK_SECRET 등록을 권합니다.');
    }
  } catch (e) {
    Logger.log('웹훅 등록 실패: ' + errText_(e));
    return;
  }

  Logger.log('이제 봇에게 /myid 를 보내 chat_id 를 확인하고 TELEGRAM_CHAT_ID 에 등록하세요.');
  telegramWebhookInfo();
}

/** 현재 웹훅 상태를 실행 로그에 찍습니다. */
function telegramWebhookInfo() {
  var token = String(PROPS.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!token) { Logger.log('TELEGRAM_BOT_TOKEN 이 없어 웹훅 정보를 볼 수 없습니다.'); return; }

  try {
    var info = telegramApi_(token, 'getWebhookInfo', {});
    Logger.log('웹훅 URL: ' + (info.url || '(없음 — setTelegramWebhook() 를 실행하세요)'));
    Logger.log('대기 중 업데이트: ' + (info.pending_update_count || 0) + '건');
    if (info.last_error_message) {
      Logger.log('마지막 웹훅 오류: ' + info.last_error_message);
    }
  } catch (e) {
    Logger.log('웹훅 정보 조회 실패: ' + errText_(e));
  }
}

/** TELEGRAM_CHAT_ID 로 짧은 시험 메시지를 보냅니다. */
function sendTelegramTest() {
  var token = String(PROPS.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  if (!token) { Logger.log('실패: TELEGRAM_BOT_TOKEN 이 없습니다.'); return; }

  var ids = allowedChatIds_();
  if (!ids.length) {
    Logger.log('실패: TELEGRAM_CHAT_ID 가 비어 있습니다. 봇에게 /myid 를 보내 본인 id를 확인한 뒤 등록하세요.');
    return;
  }

  var stamp = fmt_(new Date(), 'yyyy-MM-dd HH:mm');
  ids.forEach(function (id) {
    var sent = sendTelegramMessage_(token, id,
      '연결 확인 — ' + stamp + '\n이 봇은 개인 비서입니다. 말을 걸면 캘린더·할 일·시트·메일을 확인해 답합니다.');
    if (sent > 0) Logger.log('전송 성공: ' + maskChatId_(id));
    else Logger.log('전송 실패: ' + maskChatId_(id) + ' — 위의 전송 오류 로그를 확인하세요.');
  });
}

function errText_(err) {
  return String((err && err.message) || err);
}

/** 로그에 chat_id 를 통째로 남기지 않기 위한 가림 처리. */
function maskChatId_(id) {
  var s = String(id || '');
  if (s.length <= 4) return '…';
  return s.slice(0, 3) + '…' + s.slice(-2);
}

/* ==========================================================================
 *  Gemini 대화 + 도구 호출 루프
 * ========================================================================== */

function converse_(message, historyRaw) {
  var apiKey = PROPS.getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('서버에 GEMINI_API_KEY 스크립트 속성이 없습니다.');

  var contents = normalizeHistory_(historyRaw);
  contents.push({ role: 'user', parts: [{ text: message }] });

  var usedTools = [];
  var declarations = toolDeclarations_();

  for (var round = 0; round < MAX_TOOL_ROUNDS; round++) {
    var payload = {
      systemInstruction: { parts: [{ text: systemPrompt_() }] },
      contents: contents,
      tools: [{ functionDeclarations: declarations }],
      generationConfig: {
        temperature: 0.35,
        topP: 0.95,
        maxOutputTokens: 4096,
        // 2.5 모델의 사고(thinking) 예산을 제한해 응답이 잘리지 않게 합니다.
        thinkingConfig: { thinkingBudget: 1024 }
      }
    };

    var res = callGemini_(payload, apiKey);
    var candidates = res.candidates || [];
    if (!candidates.length) {
      throw new Error('Gemini 응답이 비어 있습니다(차단 또는 할당량 문제일 수 있습니다).');
    }

    var parts = (candidates[0].content && candidates[0].content.parts) || [];
    var callParts = [];
    var textChunks = [];

    parts.forEach(function (p) {
      if (p.functionCall) callParts.push(p);
      else if (p.text && !p.thought) textChunks.push(p.text);
    });

    if (callParts.length) {
      // 모델 턴을 그대로 되돌려 주어야 다음 턴에서 맥락이 이어집니다.
      contents.push({
        role: 'model',
        parts: callParts.map(function (p) {
          var out = { functionCall: p.functionCall };
          if (p.thoughtSignature) out.thoughtSignature = p.thoughtSignature;
          return out;
        })
      });

      contents.push({
        role: 'user',
        parts: callParts.map(function (p) {
          var name = p.functionCall.name;
          usedTools.push(name);
          var toolResult;
          try {
            toolResult = runTool_(name, p.functionCall.args || {});
          } catch (toolErr) {
            toolResult = { error: String((toolErr && toolErr.message) || toolErr) };
          }
          return { functionResponse: { name: name, response: { result: toolResult } } };
        })
      });
      continue;
    }

    var text = textChunks.join('\n').trim();
    if (text) return { text: text, tools: usedTools };

    contents.push({
      role: 'user',
      parts: [{ text: '방금 응답이 비어 있었습니다. 확인한 내용을 요약해 답해 주세요.' }]
    });
  }

  return {
    text: '도구 호출이 너무 여러 번 반복되어 중단했습니다. 질문을 조금 좁혀서 다시 물어봐 주세요.',
    tools: usedTools
  };
}

function normalizeHistory_(raw) {
  if (!Array.isArray(raw)) return [];
  var items = [];
  raw.slice(-MAX_HISTORY).forEach(function (m) {
    if (!m || typeof m.text !== 'string' || !m.text.trim()) return;
    var role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
    items.push({ role: role, parts: [{ text: m.text.slice(0, 4000) }] });
  });

  // Gemini 는 첫 턴이 user 여야 하고, 같은 role 이 연속되면 합쳐야 합니다.
  while (items.length && items[0].role !== 'user') items.shift();

  var merged = [];
  items.forEach(function (it) {
    var last = merged[merged.length - 1];
    if (last && last.role === it.role) last.parts.push(it.parts[0]);
    else merged.push({ role: it.role, parts: [it.parts[0]] });
  });
  return merged;
}

function systemPrompt_() {
  var now = new Date();
  var weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  var wdIndex = Number(Utilities.formatDate(now, TZ, 'u')) % 7; // 1=월 … 7=일
  var stamp = Utilities.formatDate(now, TZ, 'yyyy-MM-dd') + ' (' + weekdays[wdIndex] + ') ' +
    Utilities.formatDate(now, TZ, 'HH:mm');

  return [
    '당신은 사용자의 개인 비서입니다.',
    '현재 시각: ' + stamp + ' Asia/Seoul',
    '',
    '규칙:',
    '1. 간결한 한국어 존댓말로 답합니다. 여러 항목은 짧은 불릿으로 정리합니다.',
    '2. 일정·할 일·시트·메일·노션에 관한 질문은 반드시 도구로 실제 데이터를 확인한 뒤 답합니다. 확인하지 않은 내용을 지어내지 않습니다.',
    '3. 도구 결과가 비었으면 "해당하는 항목이 없습니다"라고 분명히 말합니다.',
    '4. 날짜는 YYYY-MM-DD, 시각은 24시간제 HH:mm 로 표기합니다.',
    '5. 도구 결과에 없는 개인정보를 추측하거나 만들어내지 않습니다.',
    '6. 메일 발송·일정 삭제처럼 되돌리기 어려운 동작은 할 수 없습니다. 필요하면 제안만 합니다.',
    '7. 도구 오류가 났으면 그 사실을 짧게 알리고, 사용자가 무엇을 하면 되는지 한 줄로 안내합니다.',
    '8. 답변은 전체 8줄을 넘기지 않게 핵심만 전합니다.'
  ].join('\n');
}

/* ==========================================================================
 *  도구 선언 (Gemini Function Calling)
 * ========================================================================== */

var TOOL_DECLARATIONS = [
  {
    name: 'get_calendar_events',
    description: '기본 Google 캘린더에서 지금부터 N일 이내의 일정을 조회합니다. 오늘·이번 주·모레 일정 질문에 사용합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        days: { type: 'INTEGER', description: '지금부터 며칠 뒤까지 볼지. 기본 7, 최대 60.' }
      },
      required: []
    }
  },
  {
    name: 'add_calendar_event',
    description: '기본 Google 캘린더에 일정을 새로 추가합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: '일정 제목' },
        date_or_start: { type: 'STRING', description: '시작. "YYYY-MM-DD HH:mm" 또는 시각이 없으면 "YYYY-MM-DD". 시각이 없고 all_day 가 false 면 09:00 로 잡습니다.' },
        end: { type: 'STRING', description: '종료. "YYYY-MM-DD HH:mm". 없으면 시작 1시간 뒤.' },
        all_day: { type: 'BOOLEAN', description: '종일 일정이면 true.' }
      },
      required: ['title', 'date_or_start']
    }
  },
  {
    name: 'get_tasks',
    description: '기본 할 일 목록(Google Tasks)의 미완료 항목을 조회합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        include_completed: { type: 'BOOLEAN', description: '완료한 항목도 포함할지. 기본 false.' }
      },
      required: []
    }
  },
  {
    name: 'add_task',
    description: '기본 할 일 목록(Google Tasks)에 항목을 추가합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: '할 일 제목' },
        notes: { type: 'STRING', description: '메모(선택)' },
        due: { type: 'STRING', description: '마감일 "YYYY-MM-DD" (선택)' }
      },
      required: ['title']
    }
  },
  {
    name: 'read_sheet',
    description: '구글 스프레드시트의 지정 범위를 읽습니다. 공용 시트 확인에 사용합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sheet_id: { type: 'STRING', description: '스프레드시트 ID. 생략하면 서버 기본값(SHARED_SHEET_ID).' },
        range: { type: 'STRING', description: 'A1 표기. 예: "A1:E30" 또는 "정산!A1:E30". 기본 "A1:Z50".' }
      },
      required: []
    }
  },
  {
    name: 'append_sheet_row',
    description: '구글 스프레드시트 마지막 행 다음에 값을 추가합니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sheet_id: { type: 'STRING', description: '스프레드시트 ID. 생략하면 서버 기본값.' },
        sheet_name: { type: 'STRING', description: '탭 이름(선택). 생략하면 첫 번째 탭.' },
        values: {
          type: 'ARRAY',
          description: '한 행의 값 배열(예: ["2026-11-25","식비","8000"]). 여러 행이면 배열의 배열.',
          items: { type: 'STRING' }
        }
      },
      required: ['values']
    }
  },
  {
    name: 'search_gmail',
    description: 'Gmail 을 Gmail 검색 문법으로 검색해 최근 메일의 제목·발신자·날짜·요약을 가져옵니다.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Gmail 검색어. 예: "is:unread newer_than:2d", "from:someone@example.com".' },
        max_results: { type: 'INTEGER', description: '최대 개수. 기본 8, 최대 15.' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_notion',
    description: '노션 워크스페이스에서 제목으로 페이지·데이터베이스를 검색합니다. (NOTION_TOKEN 이 설정된 경우에만 사용 가능)',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: '검색어' }
      },
      required: ['query']
    }
  }
];

/** NOTION_TOKEN 이 없으면 노션 도구는 목록에서 뺍니다(모델이 부르지 않도록). */
function toolDeclarations_() {
  if (PROPS.getProperty('NOTION_TOKEN')) return TOOL_DECLARATIONS;
  return TOOL_DECLARATIONS.filter(function (d) { return d.name !== 'search_notion'; });
}

function runTool_(name, args) {
  switch (name) {
    case 'get_calendar_events': return toolGetCalendarEvents_(args);
    case 'add_calendar_event': return toolAddCalendarEvent_(args);
    case 'get_tasks': return toolGetTasks_(args);
    case 'add_task': return toolAddTask_(args);
    case 'read_sheet': return toolReadSheet_(args);
    case 'append_sheet_row': return toolAppendSheetRow_(args);
    case 'search_gmail': return toolSearchGmail_(args);
    case 'search_notion': return toolSearchNotion_(args);
    default: return { error: '알 수 없는 도구입니다: ' + name };
  }
}

/* ==========================================================================
 *  도구 구현 — 캘린더
 * ========================================================================== */

function toolGetCalendarEvents_(args) {
  var days = clampInt_(args && args.days, 1, 60, 7);
  var cal = CalendarApp.getDefaultCalendar();
  var start = new Date();
  var end = new Date(start.getTime() + days * 86400000);

  var events = cal.getEvents(start, end).slice(0, 50);
  return events.map(function (ev) {
    var allDay = ev.isAllDayEvent();
    return {
      title: ev.getTitle(),
      start: fmt_(ev.getStartTime(), allDay ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'),
      end: fmt_(ev.getEndTime(), allDay ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'),
      allDay: allDay,
      location: ev.getLocation() || ''
    };
  });
}

function toolAddCalendarEvent_(args) {
  var title = String((args && args.title) || '').trim();
  if (!title) throw new Error('일정 제목(title)이 필요합니다.');

  var parsed = parseDateTime_(args && args.date_or_start);
  if (!parsed) {
    throw new Error('시작 시각을 해석하지 못했습니다. 예: "2026-11-26 15:00" 또는 "2026-11-26"');
  }

  var cal = CalendarApp.getDefaultCalendar();
  var allDay = args.all_day === true || !parsed.hasTime;
  var ev;

  if (allDay) {
    ev = cal.createAllDayEvent(title, parsed.date);
  } else {
    var endDate = null;
    if (args.end) {
      var p2 = parseDateTime_(args.end);
      if (p2) endDate = p2.date;
    }
    if (!endDate || endDate.getTime() <= parsed.date.getTime()) {
      endDate = new Date(parsed.date.getTime() + 3600000);
    }
    ev = cal.createEvent(title, parsed.date, endDate);
  }

  return {
    created: true,
    title: ev.getTitle(),
    start: fmt_(ev.getStartTime(), ev.isAllDayEvent() ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'),
    end: fmt_(ev.getEndTime(), ev.isAllDayEvent() ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'),
    allDay: ev.isAllDayEvent(),
    id: ev.getId()
  };
}

/* ==========================================================================
 *  도구 구현 — 할 일 (고급 서비스 Tasks)
 * ========================================================================== */

function assertTasks_() {
  if (typeof Tasks === 'undefined' || !Tasks.Tasks) {
    throw new Error('Tasks 고급 서비스가 꺼져 있습니다. Apps Script 왼쪽 [서비스]에서 "Tasks API"를 추가하세요.');
  }
}

function toolGetTasks_(args) {
  assertTasks_();
  var includeCompleted = !!(args && args.include_completed === true);
  var res = Tasks.Tasks.list('@default', {
    maxResults: 100,
    showCompleted: includeCompleted,
    showHidden: false
  });
  var items = (res.items || []).slice(0, 40).map(function (t) {
    return {
      title: t.title || '',
      notes: t.notes ? String(t.notes).replace(/\s+/g, ' ').slice(0, 200) : '',
      due: t.due ? String(t.due).slice(0, 10) : '',
      status: t.status || 'needsAction'
    };
  });
  return { count: items.length, tasks: items };
}

function toolAddTask_(args) {
  assertTasks_();
  var title = String((args && args.title) || '').trim();
  if (!title) throw new Error('할 일 제목(title)이 필요합니다.');

  var body = { title: title };
  if (args.notes) body.notes = String(args.notes).slice(0, 8000);
  if (args.due) {
    var d = String(args.due).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) body.due = d + 'T00:00:00.000Z';
  }

  var created = Tasks.Tasks.insert(body, '@default');
  return {
    created: true,
    title: created.title,
    due: created.due ? String(created.due).slice(0, 10) : '',
    id: created.id
  };
}

/* ==========================================================================
 *  도구 구현 — 스프레드시트
 * ========================================================================== */

function resolveSheetId_(value) {
  var id = String(value || PROPS.getProperty('SHARED_SHEET_ID') || '').trim();
  if (!id) {
    throw new Error('시트 ID가 없습니다. 스크립트 속성 SHARED_SHEET_ID 를 등록하거나 sheet_id 를 지정하세요.');
  }
  return id;
}

function toolReadSheet_(args) {
  var id = resolveSheetId_(args && args.sheet_id);
  var range = String((args && args.range) || 'A1:Z50').trim();

  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheets()[0];
  var a1 = range;

  var bang = range.lastIndexOf('!');
  if (bang >= 0) {
    var tabName = range.slice(0, bang).replace(/^'|'$/g, '');
    var found = ss.getSheetByName(tabName);
    if (!found) throw new Error('시트 탭 "' + tabName + '"을(를) 찾지 못했습니다.');
    sheet = found;
    a1 = range.slice(bang + 1);
  }

  var values = sheet.getRange(a1).getDisplayValues();
  var rowCap = 80, colCap = 12;
  return {
    sheet: sheet.getName(),
    range: a1,
    totalRows: values.length,
    columns: values.length ? values[0].length : 0,
    truncated: values.length > rowCap || (values.length && values[0].length > colCap),
    values: values.slice(0, rowCap).map(function (r) { return r.slice(0, colCap); })
  };
}

function toolAppendSheetRow_(args) {
  var id = resolveSheetId_(args && args.sheet_id);
  var raw = args && args.values;
  if (raw === undefined || raw === null || raw === '') throw new Error('추가할 값(values)이 필요합니다.');

  var rows;
  if (Array.isArray(raw)) rows = Array.isArray(raw[0]) ? raw : [raw];
  else rows = [[raw]];

  var ss = SpreadsheetApp.openById(id);
  var sheet = ss.getSheets()[0];
  if (args.sheet_name) {
    var found = ss.getSheetByName(String(args.sheet_name));
    if (!found) throw new Error('시트 탭 "' + args.sheet_name + '"을(를) 찾지 못했습니다.');
    sheet = found;
  }

  rows.forEach(function (row) {
    sheet.appendRow(row.map(function (v) {
      var s = (v === null || v === undefined) ? '' : String(v);
      // 수식 주입 방지: = + - @ 로 시작하는 값은 문자로 저장
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return s;
    }));
  });

  return { appended: rows.length, sheet: sheet.getName(), lastRow: sheet.getLastRow() };
}

/* ==========================================================================
 *  도구 구현 — Gmail
 * ========================================================================== */

function toolSearchGmail_(args) {
  var query = String((args && args.query) || '').trim() || 'newer_than:7d';
  var max = clampInt_(args && args.max_results, 1, 15, 8);

  var threads = GmailApp.search(query, 0, max);
  var messages = threads.map(function (th) {
    var msgs = th.getMessages();
    var last = msgs[msgs.length - 1];
    return {
      subject: th.getFirstMessageSubject() || '(제목 없음)',
      from: last.getFrom() || '',
      date: fmt_(last.getDate(), 'yyyy-MM-dd HH:mm'),
      unread: th.isUnread(),
      snippet: String(last.getPlainBody() || '').replace(/\s+/g, ' ').trim().slice(0, 180)
    };
  });

  return { query: query, count: messages.length, messages: messages };
}

/* ==========================================================================
 *  도구 구현 — Notion (선택)
 * ========================================================================== */

function toolSearchNotion_(args) {
  var token = PROPS.getProperty('NOTION_TOKEN');
  if (!token) throw new Error('노션 검색이 설정되지 않았습니다(스크립트 속성 NOTION_TOKEN 없음).');

  var query = String((args && args.query) || '').trim();
  if (!query) throw new Error('검색어(query)가 필요합니다.');

  var res = UrlFetchApp.fetch('https://api.notion.com/v1/search', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': PROPS.getProperty('NOTION_VERSION') || '2022-06-28'
    },
    payload: JSON.stringify({ query: query, page_size: 5 }),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Notion API 오류 ' + code + ': ' + res.getContentText().slice(0, 200));
  }

  var data = JSON.parse(res.getContentText());
  return (data.results || []).map(function (r) {
    return {
      type: r.object,
      title: notionTitle_(r),
      url: r.url || '',
      lastEdited: String(r.last_edited_time || '').slice(0, 10)
    };
  });
}

function notionTitle_(r) {
  try {
    if (r.object === 'database' && r.title && r.title.length) {
      return r.title.map(function (t) { return t.plain_text; }).join('');
    }
    var props = r.properties || {};
    for (var key in props) {
      var p = props[key];
      if (p && p.type === 'title' && p.title && p.title.length) {
        return p.title.map(function (t) { return t.plain_text; }).join('');
      }
    }
  } catch (e) { /* 제목을 못 찾으면 아래 기본값 */ }
  return '(제목 없음)';
}

/* ==========================================================================
 *  유틸
 * ========================================================================== */

function callGemini_(payload, apiKey) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var lastError = '';
  for (var attempt = 1; attempt <= 3; attempt++) {
    var res = UrlFetchApp.fetch(GEMINI_ENDPOINT, options);
    var code = res.getResponseCode();
    var text = res.getContentText();

    if (code === 200) {
      var data = JSON.parse(text);
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw new Error('Gemini 가 요청을 거절했습니다: ' + data.promptFeedback.blockReason);
      }
      return data;
    }

    lastError = 'Gemini API 오류 ' + code + ': ' + text.slice(0, 300);
    if (code === 429 || code >= 500) {
      if (attempt < 3) { Utilities.sleep(1200 * attempt); continue; }
    }
    throw new Error(lastError);
  }
  throw new Error(lastError);
}

/**
 * "2026-11-26 15:00" / "2026-11-26T15:00:00+09:00" / "2026-11-26" 을 해석합니다.
 * 시간대가 붙은 ISO 문자열은 그대로, 벽시계 문자열은 스크립트 시간대(Asia/Seoul 권장) 기준으로 처리합니다.
 */
function parseDateTime_(input) {
  var s = String(input || '').trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    var iso = new Date(s);
    if (!isNaN(iso.getTime())) return { date: iso, hasTime: true };
  }

  var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?(?::\d{2})?$/);
  if (!m) {
    var k = s.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(\d{1,2}):(\d{2}))?$/);
    if (!k) return null;
    m = k;
  }

  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (m[4] !== undefined) {
    return { date: new Date(y, mo - 1, d, Number(m[4]), Number(m[5]), 0), hasTime: true };
  }
  return { date: new Date(y, mo - 1, d, 0, 0, 0), hasTime: false };
}

function clampInt_(value, min, max, fallback) {
  var n = Number(value);
  if (!isFinite(n)) return fallback;
  n = Math.floor(n);
  return Math.min(max, Math.max(min, n));
}

function fmt_(date, pattern) {
  return Utilities.formatDate(date, TZ, pattern);
}

/* ==========================================================================
 *  설정 점검 (편집기에서 직접 실행)
 * ========================================================================== */

function setupCheck() {
  Logger.log('스크립트 시간대: ' + Session.getScriptTimeZone() + '  (권장: Asia/Seoul)');
  Logger.log('GEMINI_API_KEY: ' + (PROPS.getProperty('GEMINI_API_KEY') ? '설정됨' : '없음 — 필수'));
  var pin = PROPS.getProperty('ACCESS_PIN');
  Logger.log('ACCESS_PIN: ' + (pin ? '설정됨 (' + String(pin).length + '자)' : '없음 — 필수'));
  Logger.log('SHARED_SHEET_ID: ' + (PROPS.getProperty('SHARED_SHEET_ID') ? '설정됨' : '없음 — 선택'));
  Logger.log('NOTION_TOKEN: ' + (PROPS.getProperty('NOTION_TOKEN') ? '설정됨' : '없음 — 선택'));
  Logger.log('Tasks 고급 서비스: ' + (typeof Tasks !== 'undefined' && Tasks.Tasks ? '사용 가능' : '없음 — 할 일 기능에 필요'));

  var tgToken = String(PROPS.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  var tgIds = allowedChatIds_();
  Logger.log('TELEGRAM_BOT_TOKEN: ' + (tgToken ? '설정됨' : '없음 — 텔레그램으로 쓰려면 필수'));
  Logger.log('TELEGRAM_CHAT_ID: ' + (tgIds.length
    ? '설정됨 (' + tgIds.length + '개: ' + tgIds.map(maskChatId_).join(', ') + ')'
    : '없음 — 봇에게 /myid 를 보내 확인한 뒤 등록'));
  Logger.log('TELEGRAM_WEBHOOK_SECRET: ' + (PROPS.getProperty('TELEGRAM_WEBHOOK_SECRET') ? '설정됨' : '없음 — 선택(권장)'));
  if (tgToken) {
    try {
      var me = telegramApi_(tgToken, 'getMe', {});
      Logger.log('텔레그램 봇 연결: OK — @' + me.username);
    } catch (e) {
      Logger.log('텔레그램 봇 연결 실패: ' + errText_(e));
    }
    telegramWebhookInfo();
  }

  var key = PROPS.getProperty('GEMINI_API_KEY');
  if (key) {
    try {
      callGemini_({
        contents: [{ role: 'user', parts: [{ text: '핑' }] }],
        generationConfig: { maxOutputTokens: 16 }
      }, key);
      Logger.log('Gemini 연결: OK (' + GEMINI_MODEL + ')');
    } catch (e) {
      Logger.log('Gemini 연결 실패: ' + e.message);
    }
  }

  try {
    Logger.log('웹 앱 URL: ' + (ScriptApp.getService().getUrl() || '(배포 전)'));
  } catch (e) {
    Logger.log('웹 앱 URL: (배포 전)');
  }

  var sheetId = PROPS.getProperty('SHARED_SHEET_ID');
  if (sheetId) {
    try { Logger.log('시트 접근: OK — ' + SpreadsheetApp.openById(sheetId).getName()); }
    catch (e) { Logger.log('시트 접근 실패: ' + e.message); }
  }
}
