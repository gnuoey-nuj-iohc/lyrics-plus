const kuroshiroPath =
  "https://cdn.jsdelivr.net/npm/kuroshiro@1.2.0/dist/kuroshiro.min.js";
const kuromojiPath =
  "https://cdn.jsdelivr.net/npm/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js";
const aromanize =
  "https://cdn.jsdelivr.net/npm/aromanize@0.1.5/aromanize.min.js";
const openCCPath =
  "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.min.js";
const pinyinProPath =
  "https://cdn.jsdelivr.net/npm/pinyin-pro@3.19.7/dist/index.min.js";
const tinyPinyinPath =
  "https://cdn.jsdelivr.net/npm/tiny-pinyin/dist/tiny-pinyin.min.js";

const dictPath = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict";

// 최적화 #7 - 에러 메시지 표준화
const API_ERROR_MESSAGES = {
  400: {
    MISSING_API_KEY: I18n.t("translator.missingApiKey"),
    INVALID_API_KEY_FORMAT: I18n.t("translator.invalidApiKeyFormat"),
    DEFAULT: I18n.t("translator.invalidRequestFormat")
  },
  401: I18n.t("translator.invalidApiKey"),
  403: I18n.t("translator.accessForbidden"),
  429: I18n.t("translator.rateLimitExceeded"),
  500: I18n.t("translator.serviceUnavailable"),
  502: I18n.t("translator.serviceUnavailable"),
  503: I18n.t("translator.serviceUnavailable")
};

/**
 * API 에러 상태 코드에 따라 적절한 에러 메시지를 반환합니다.
 * 
 * @param {number} status - HTTP 상태 코드
 * @param {Object} errorData - 에러 데이터 객체 (선택적)
 * @param {string} [errorData.code] - 에러 코드 (400 에러의 경우)
 * @returns {string} 사용자에게 표시할 에러 메시지
 */
function handleAPIError(status, errorData) {
  const errorConfig = API_ERROR_MESSAGES[status];

  if (typeof errorConfig === 'object') {
    // 400 에러 - 코드별 메시지
    const code = errorData?.code;
    return errorConfig[code] || errorConfig.DEFAULT;
  }

  // 기타 에러 - 직접 메시지 반환
  return errorConfig || `${I18n.t("translator.requestFailed")} (${status})`;
}

// 전역 요청 상태 관리 (중복 요청 방지)
const _inflightRequests = new Map();
const _pendingRetries = new Map();

/**
 * 진행 중인 요청을 식별하기 위한 고유 키를 생성합니다.
 * 
 * @param {string} trackId - 트랙 ID
 * @param {boolean} wantSmartPhonetic - 발음 표기 여부
 * @param {string} lang - 언어 코드
 * @returns {string} 요청 키 (형식: "trackId:type:lang")
 * 
 * @example
 * const key = getRequestKey("4iV5W9uYEdYUVa79Axb7Rh", false, "ko");
 * // 결과: "4iV5W9uYEdYUVa79Axb7Rh:translation:ko"
 */
function getRequestKey(trackId, wantSmartPhonetic, lang) {
  return `${trackId}:${wantSmartPhonetic ? 'phonetic' : 'translation'}:${lang}`;
}

/**
 * 가사 번역 및 발음 표기를 담당하는 클래스입니다.
 * 
 * 주요 기능:
 * - Gemini API를 통한 가사 번역 및 발음 표기
 * - Perplexity API를 통한 가사 번역 (로컬 버전 추가 기능)
 * - 메타데이터(제목/아티스트) 번역
 * - 일본어 로마자 변환 (Kuroshiro)
 * - 한국어 로마자 변환 (Aromanize)
 * - 중국어 간체/번체 변환 및 병음 변환 (OpenCC, PinyinPro)
 * - 캐싱 시스템 (메모리 + IndexedDB)
 * - API 키 로테이션 지원
 * 
 * @class Translator
 * 
 * @example
 * // 인스턴스 생성
 * const translator = new Translator('ja');
 * await translator.initializeAsync('ja');
 * 
 * // 로마자 변환
 * const romaji = await translator.romajifyText("こんにちは");
 * 
 * // 번역 (정적 메서드)
 * const result = await Translator.callGemini({
 *   text: "Hello world",
 *   wantSmartPhonetic: false
 * });
 */
class Translator {
  // 메타데이터 번역 캐시 (메모리)
  static _metadataCache = new Map();
  static _metadataInflightRequests = new Map();

  /**
   * 특정 트랙의 진행 중인 모든 요청을 정리합니다.
   * 곡이 변경될 때 호출하여 이전 곡의 중복 요청을 방지합니다.
   * 
   * @param {string} trackId - 정리할 트랙 ID
   */
  static clearInflightRequests(trackId) {
    if (!trackId) return;

    // _inflightRequests에서 해당 trackId로 시작하는 키 제거
    for (const key of _inflightRequests.keys()) {
      if (key.startsWith(`${trackId}:`)) {
        _inflightRequests.delete(key);
      }
    }

    // _pendingRetries에서도 제거
    for (const key of _pendingRetries.keys()) {
      if (key.startsWith(`${trackId}:`)) {
        _pendingRetries.delete(key);
      }
    }
  }

  /**
   * 모든 진행 중인 요청을 정리합니다.
   * 메모리 누수를 방지하기 위해 사용할 수 있습니다.
   */
  static clearAllInflightRequests() {
    _inflightRequests.clear();
    _pendingRetries.clear();
  }

  /**
   * 특정 트랙의 메타데이터 메모리 캐시를 초기화합니다.
   * 
   * @param {string} trackId - 캐시를 초기화할 트랙 ID
   */
  static clearMemoryCache(trackId) {
    if (!trackId) return;
    for (const key of this._metadataCache.keys()) {
      if (key.startsWith(`${trackId}:`)) {
        this._metadataCache.delete(key);
      }
    }
  }

  /**
   * 모든 메타데이터 메모리 캐시를 초기화합니다.
   */
  static clearAllMemoryCache() {
    this._metadataCache.clear();
  }

  /**
   * 노래 제목과 아티스트 이름을 사용자 언어로 번역합니다.
   * 서버 API를 통해 번역을 수행하며, 결과는 메모리 및 IndexedDB에 캐싱됩니다.
   * 
   * @param {Object} options - 번역 옵션
   * @param {string} [options.trackId] - Spotify 트랙 ID (없으면 현재 재생 중인 곡 자동 감지)
   * @param {string} options.title - 원본 노래 제목
   * @param {string} options.artist - 원본 아티스트 이름
   * @param {boolean} [options.ignoreCache=false] - 캐시를 무시하고 새로 번역할지 여부
   * @returns {Promise<Object|null>} 번역 결과 객체 또는 null (실패 시)
   * @returns {string} returns.translatedTitle - 번역된 제목
   * @returns {string} returns.translatedArtist - 번역된 아티스트 이름
   * @returns {string} returns.romanizedTitle - 로마자 발음 표기된 제목
   * @returns {string} returns.romanizedArtist - 로마자 발음 표기된 아티스트 이름
   * 
   * @example
   * const result = await Translator.translateMetadata({
   *   trackId: "4iV5W9uYEdYUVa79Axb7Rh",
   *   title: "Love Story",
   *   artist: "Taylor Swift"
   * });
   * // 결과: { translatedTitle: "러브 스토리", translatedArtist: "테일러 스위프트", ... }
   */
  static async translateMetadata({ trackId, title, artist, ignoreCache = false }) {
    if (!title || !artist) {
      return null;
    }

    // trackId가 없으면 현재 재생 중인 곡에서 가져옴
    let finalTrackId = trackId;
    if (!finalTrackId) {
      finalTrackId = Spicetify.Player.data?.item?.uri?.split(':')[2];
    }
    if (!finalTrackId) {
      return null;
    }

    // API 키 확인 및 파싱 (JSON 배열 또는 단일 문자열 지원)
    const apiKeyRaw = StorageManager.getItem("lyrics-plus:visual:gemini-api-key");
    if (!apiKeyRaw || apiKeyRaw.trim() === "") {
      return null;
    }

    // API 키 파싱 (callGemini와 동일한 로직)
    let apiKey;
    try {
      const trimmed = apiKeyRaw.trim();
      if (trimmed.startsWith('[')) {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0) {
          apiKey = parsed[0]; // 첫 번째 키 사용
        } else {
          apiKey = trimmed;
        }
      } else {
        apiKey = trimmed;
      }
    } catch (e) {
      console.warn("[Translator] Failed to parse API key, using as-is:", e);
      apiKey = apiKeyRaw;
    }

    // 파싱된 키 검증
    if (!apiKey || apiKey.trim() === "") {
      return null;
    }

    // 사용자 언어
    const userLang = I18n.getCurrentLanguage();
    const cacheKey = `${finalTrackId}:${userLang}`;

    // 메모리 캐시 확인
    if (!ignoreCache && this._metadataCache.has(cacheKey)) {
      return this._metadataCache.get(cacheKey);
    }

    // 로컬 캐시 (IndexedDB) 확인
    if (!ignoreCache) {
      try {
        const localCached = await LyricsCache.getMetadata(finalTrackId, userLang);
        if (localCached) {
          console.log(`[Translator] Using local metadata cache for ${cacheKey}`);
          this._metadataCache.set(cacheKey, localCached);
          return localCached;
        }
      } catch (e) {
        console.warn('[Translator] Local metadata cache check failed:', e);
      }
    }

    // 중복 요청 방지
    if (this._metadataInflightRequests.has(cacheKey)) {
      return this._metadataInflightRequests.get(cacheKey);
    }

    const requestPromise = (async () => {
      const url = "https://lyrics.api.ivl.is/lyrics/translate/metadata";

      // API 요청 로깅 시작
      let logId = null;
      if (window.ApiTracker) {
        logId = window.ApiTracker.logRequest('metadata', url, { trackId: finalTrackId, title, artist, lang: userLang });
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            trackId: finalTrackId,
            title,
            artist,
            lang: userLang,
            apiKey,
            ignore_cache: ignoreCache,
          }),
        });

        if (!response.ok) {
          if (window.ApiTracker && logId) {
            window.ApiTracker.logResponse(logId, { status: response.status }, 'error', `HTTP ${response.status}`);
          }
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          if (window.ApiTracker && logId) {
            window.ApiTracker.logResponse(logId, data, 'error', data.message || "Translation failed");
          }
          throw new Error(data.message || "Translation failed");
        }

        if (data.success && data.data) {
          // 성공 로깅
          if (window.ApiTracker && logId) {
            window.ApiTracker.logResponse(logId, {
              translatedTitle: data.data.translatedTitle,
              translatedArtist: data.data.translatedArtist,
              romanizedTitle: data.data.romanizedTitle,
              romanizedArtist: data.data.romanizedArtist
            }, 'success');
          }
          // 메모리 캐시에 저장
          this._metadataCache.set(cacheKey, data.data);
          // 로컬 캐시(IndexedDB)에도 저장 (백그라운드)
          LyricsCache.setMetadata(finalTrackId, userLang, data.data).catch(() => { });
          return data.data;
        }

        if (window.ApiTracker && logId) {
          window.ApiTracker.logResponse(logId, data, 'error', "No data returned");
        }
        return null;
      } catch (error) {
        if (window.ApiTracker && logId) {
          window.ApiTracker.logResponse(logId, null, 'error', error.message);
        }
        console.warn(`[Translator] Metadata translation failed:`, error.message);
        return null;
      } finally {
        this._metadataInflightRequests.delete(cacheKey);
      }
    })();

    this._metadataInflightRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  /**
   * 메타데이터 번역 결과를 메모리 캐시에서 동기적으로 가져옵니다.
   * IndexedDB를 조회하지 않고 메모리 캐시만 확인합니다.
   * 
   * @param {string} trackId - 조회할 트랙 ID
   * @returns {Object|null} 캐시된 번역 결과 또는 null (캐시에 없을 경우)
   */
  static getMetadataFromCache(trackId) {
    const userLang = I18n.getCurrentLanguage();
    const cacheKey = `${trackId}:${userLang}`;
    return this._metadataCache.get(cacheKey) || null;
  }

  /**
   * 모든 메타데이터 번역 캐시를 초기화합니다.
   * 메모리 캐시와 진행 중인 요청 맵을 모두 비웁니다.
   */
  static clearMetadataCache() {
    this._metadataCache.clear();
    this._metadataInflightRequests.clear();
  }

  constructor(lang, isUsingNetease = false) {
    this.finished = {
      ja: false,
      ko: false,
      zh: false,
      ru: false,
      vi: false,
      de: false,
      en: false,
      es: false, // Spanish
      fr: false, // French
      it: false, // Italian
      pt: false, // Portuguese
      nl: false, // Dutch
      pl: false, // Polish
      tr: false, // Turkish
      ar: false, // Arabic
      hi: false, // Hindi
      th: false, // Thai
      id: false, // Indonesian
    };
    this.isUsingNetease = isUsingNetease;
    this.initializationPromise = null;

    this.applyKuromojiFix();
    // Start initialization asynchronously but don't await in constructor
    this.initializationPromise = this.initializeAsync(lang);
  }

  /**
   * Async initialization method that can be awaited
   * @param {string} lang - Language code
   * @returns {Promise<void>}
   */
  async initializeAsync(lang) {
    try {
      await this.injectExternals(lang);
      await this.createTranslator(lang);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Gemini API를 사용하여 가사를 번역하거나 발음 표기 생성
   * 
   * @param {Object} options - 번역 옵션
   * @param {string} options.trackId - Spotify 트랙 ID (없으면 현재 재생 중인 곡 자동 감지)
   * @param {string} options.artist - 아티스트 이름
   * @param {string} options.title - 노래 제목
   * @param {string} options.text - 번역할 가사 텍스트
   * @param {boolean} [options.wantSmartPhonetic=false] - true: 발음 표기, false: 번역
   * @param {string|null} [options.provider=null] - 가사 제공자 정보
   * @param {boolean} [options.ignoreCache=false] - 캐시 무시 여부
   * @returns {Promise<Object>} 번역/발음 표기 결과 { translation: string[] } 또는 { phonetic: string[] }
   * @throws {Error} 텍스트가 없거나 API 키가 없을 때
   * 
   * @example
   * // 번역 요청
   * const result = await Translator.callGemini({
   *   trackId: "4iV5W9uYEdYUVa79Axb7Rh",
   *   artist: "Taylor Swift",
   *   title: "Love Story",
   *   text: "We were both young when I first saw you",
   *   wantSmartPhonetic: false
   * });
   * 
   * @example
   * // 발음 표기 요청
   * const phonetic = await Translator.callGemini({
   *   text: "こんにちは",
   *   wantSmartPhonetic: true
   * });
   */
  static async callGemini({
    trackId,
    artist,
    title,
    text,
    wantSmartPhonetic = false,
    provider = null,
    ignoreCache = false,
  }) {
    if (!text?.trim()) throw new Error("No text provided for translation");

    // Get API key from localStorage
    const apiKeyRaw = StorageManager.getItem("lyrics-plus:visual:gemini-api-key");
    let apiKeys = [];

    // Parse API keys (support both single string and JSON array)
    try {
      if (apiKeyRaw) {
        const trimmed = apiKeyRaw.trim();
        if (trimmed.startsWith('[')) {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            apiKeys = parsed;
          } else {
            apiKeys = [trimmed];
          }
        } else {
          apiKeys = [trimmed];
        }
      }
    } catch (e) {
      console.warn("Failed to parse API keys, treating as single key", e);
      apiKeys = [apiKeyRaw];
    }

    // Filter empty keys
    apiKeys = apiKeys.filter(k => k && k.trim().length > 0);

    // Check if API key is provided
    if (apiKeys.length === 0) {
      throw new Error(I18n.t("translator.missingApiKey"));
    }

    // trackId가 전달되지 않으면 현재 재생 중인 곡에서 가져옴
    let finalTrackId = trackId;
    if (!finalTrackId) {
      finalTrackId = Spicetify.Player.data?.item?.uri?.split(':')[2];
    }
    if (!finalTrackId) {
      throw new Error("No track ID available");
    }

    // 사용자의 현재 언어 가져오기
    const userLang = I18n.getCurrentLanguage();

    // 1. 로컬 캐시 먼저 확인 (ignoreCache가 아닌 경우)
    if (!ignoreCache) {
      try {
        const localCached = await LyricsCache.getTranslation(finalTrackId, userLang, wantSmartPhonetic);
        if (localCached) {
          console.log(`[Translator] Using local cache for ${finalTrackId}:${userLang}:${wantSmartPhonetic ? 'phonetic' : 'translation'}`);
          if (window.ApiTracker) {
            window.ApiTracker.logCacheHit(
              wantSmartPhonetic ? 'phonetic' : 'translation',
              `${finalTrackId}:${userLang}`,
              { lineCount: localCached.phonetic?.length || localCached.translation?.length || 0 }
            );
          }
          return localCached;
        }
      } catch (e) {
        console.warn('[Translator] Local cache check failed:', e);
      }
    }

    // 중복 요청 방지
    const requestKey = getRequestKey(finalTrackId, wantSmartPhonetic, userLang);
    if (!ignoreCache && _inflightRequests.has(requestKey)) {
      console.log(`[Translator] Deduplicating request for: ${requestKey}`);
      return _inflightRequests.get(requestKey);
    }

    // 실제 API 호출을 수행하는 함수
    const executeRequest = async (currentApiKey) => {
      const endpoint = "https://lyrics.api.ivl.is/lyrics/translate";

      // API 요청 로깅 시작
      const category = wantSmartPhonetic ? 'phonetic' : 'translation';
      let logId = null;
      if (window.ApiTracker) {
        logId = window.ApiTracker.logRequest(category, endpoint, {
          trackId: finalTrackId,
          artist,
          title,
          lang: userLang,
          wantSmartPhonetic,
          textLength: text?.length || 0
        });
      }

      const tryFetch = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 80000);

        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              apiKey: currentApiKey,
              trackId: finalTrackId,
              artist,
              title,
              text,
              wantSmartPhonetic,
              lang: userLang,
            }),
            signal: controller.signal,
            mode: "cors",
          });

          clearTimeout(timeoutId);
          return res;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      };

      try {
        const res = await tryFetch();

        if (!res.ok) {
          let errorData;
          try {
            const text = await res.text();
            try {
              errorData = JSON.parse(text);
            } catch (e) {
              errorData = { error: { message: text || `HTTP ${res.status}` } };
            }
          } catch (e) {
            errorData = { error: { message: `HTTP ${res.status}` } };
          }

          if (res.status === 429) {
            throw new Error("429 Rate Limit Exceeded");
          }

          if (res.status === 401 || res.status === 403) {
            throw new Error("403 Forbidden - Invalid API Key");
          }

          const errorMessage = errorData.error?.message || errorData.message || errorData.detail || `HTTP ${res.status}`;
          const errorMsg = handleAPIError(res.status, { message: errorMessage });
          throw new Error(errorMsg);
        }

        const data = await res.json();

        // Gemini API 응답 파싱
        const result = wantSmartPhonetic 
          ? { phonetic: data.phonetic || [] }
          : { translation: data.vi || data.translation || [] };

        // API 성공 응답 로깅
        if (window.ApiTracker && logId) {
          const responseInfo = {
            lineCount: (result.phonetic || result.translation || []).length,
            cached: false
          };
          window.ApiTracker.logResponse(logId, responseInfo, 'success');
        }

        // 성공 시 로컬 캐시에 저장 (백그라운드)
        LyricsCache.setTranslation(finalTrackId, userLang, wantSmartPhonetic, result).catch(() => { });

        return result;
      } catch (error) {
        // 에러 발생 시 로깅
        if (window.ApiTracker && logId) {
          const errorMsg = error.name === "AbortError" ? 'timeout' : error.message;
          window.ApiTracker.logResponse(logId, null, 'error', errorMsg);
        }
        if (error.name === "AbortError") {
          throw new Error(I18n.t("translator.requestTimeout"));
        }
        throw error;
      }
    };

    // 로테이션 실행 로직
    const runWithRotation = async () => {
      let lastError;
      for (let i = 0; i < apiKeys.length; i++) {
        const key = apiKeys[i];
        try {
          return await executeRequest(key);
        } catch (error) {
          lastError = error;
          const isRateLimit = error.message.includes("429") || error.message.includes("Rate Limit");
          const isForbidden = error.message.includes("403") || error.message.includes("Forbidden") || error.message.includes("API key not valid");

          if (isRateLimit || isForbidden) {
            console.warn(`[Translator] Gemini API Key ${key.substring(0, 8)}... failed (${isRateLimit ? 'Rate Limit' : 'Invalid'}). Rotating...`);
            if (i === apiKeys.length - 1) {
              break;
            }
            continue;
          }
          throw error;
        }
      }
      throw new Error(`${I18n.t("translator.failedPrefix")}: ${lastError ? lastError.message : "All keys failed"}`);
    };

    // Promise를 생성하고 Map에 저장
    const requestPromise = runWithRotation().finally(() => {
      _inflightRequests.delete(requestKey);
    });

    if (!ignoreCache) {
      _inflightRequests.set(requestKey, requestPromise);
    }

    return requestPromise;
  }

  static async callPerplexity({
    trackId,
    artist,
    title,
    text,
    wantSmartPhonetic = false,
    provider = null,
    ignoreCache = false,
  }) {
    if (!text?.trim()) throw new Error("No text provided for translation");

    // Get API key from localStorage
    const apiKeyRaw = StorageManager.getItem("lyrics-plus:visual:perplexity-api-key");
    let apiKeys = [];

    // Parse API keys (support both single string and JSON array)
    try {
      if (apiKeyRaw) {
        const trimmed = apiKeyRaw.trim();
        if (trimmed.startsWith('[')) {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            apiKeys = parsed;
          } else {
            apiKeys = [trimmed];
          }
        } else {
          apiKeys = [trimmed];
        }
      }
    } catch (e) {
      console.warn("Failed to parse API keys, treating as single key", e);
      apiKeys = [apiKeyRaw];
    }

    // Filter empty keys
    apiKeys = apiKeys.filter(k => k && k.trim().length > 0);

    // Check if API key is provided
    if (apiKeys.length === 0) {
      throw new Error(
        I18n.t("translator.missingApiKey")
      );
    }

    // trackId가 전달되지 않으면 현재 재생 중인 곡에서 가져옴
    let finalTrackId = trackId;
    if (!finalTrackId) {
      finalTrackId = Spicetify.Player.data?.item?.uri?.split(':')[2];
    }
    if (!finalTrackId) {
      throw new Error("No track ID available");
    }

    // 사용자의 현재 언어 가져오기
    const userLang = I18n.getCurrentLanguage();

    // 1. 로컬 캐시 먼저 확인 (ignoreCache가 아닌 경우)
    if (!ignoreCache) {
      try {
        const localCached = await LyricsCache.getTranslation(finalTrackId, userLang, wantSmartPhonetic);
        if (localCached) {
          console.log(`[Translator] Using local cache for ${finalTrackId}:${userLang}:${wantSmartPhonetic ? 'phonetic' : 'translation'}`);
          // 캐시 히트 로깅
          if (window.ApiTracker) {
            window.ApiTracker.logCacheHit(
              wantSmartPhonetic ? 'phonetic' : 'translation',
              `${finalTrackId}:${userLang}`,
              { lineCount: localCached.phonetic?.length || localCached.translation?.length || 0 }
            );
          }
          return localCached;
        }
      } catch (e) {
        console.warn('[Translator] Local cache check failed:', e);
      }
    }

    // 중복 요청 방지: 동일한 trackId + type + lang 조합에 대한 요청이 진행 중이면 해당 Promise 반환
    const requestKey = getRequestKey(finalTrackId, wantSmartPhonetic, userLang);

    // ignoreCache가 아닌 경우에만 중복 요청 체크
    if (!ignoreCache && _inflightRequests.has(requestKey)) {
      console.log(`[Translator] Deduplicating request for: ${requestKey}`);
      return _inflightRequests.get(requestKey);
    }

      // 실제 API 호출을 수행하는 함수
      const executeRequest = async (currentApiKey) => {
        const endpoint = "https://api.perplexity.ai/chat/completions";

        // API 키 검증 및 로깅
        if (!currentApiKey || !currentApiKey.trim()) {
          throw new Error(I18n.t("translator.missingApiKey"));
        }
        
        // API 키가 pplx-로 시작하는지 확인
        const trimmedKey = currentApiKey.trim();
        if (!trimmedKey.startsWith('pplx-')) {
          console.warn("[Translator] API key doesn't start with 'pplx-', but will try anyway:", trimmedKey.substring(0, 10) + "...");
        }

        // Perplexity 모델 선택 (설정에서 가져오거나 기본값 사용)
        const perplexityModel = StorageManager.getItem("lyrics-plus:visual:perplexity-model") || "sonar";

      // API 요청 로깅 시작
      const category = wantSmartPhonetic ? 'phonetic' : 'translation';
      let logId = null;
      if (window.ApiTracker) {
        logId = window.ApiTracker.logRequest(category, endpoint, {
          trackId: finalTrackId,
          artist,
          title,
          lang: userLang,
          wantSmartPhonetic,
          textLength: text?.length || 0
        });
      }

      // 언어 코드를 언어 이름으로 변환
      const langNames = {
        'ko': 'Korean', 'en': 'English', 'ja': 'Japanese', 'zh': 'Chinese',
        'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian',
        'pt': 'Portuguese', 'ru': 'Russian', 'ar': 'Arabic', 'hi': 'Hindi',
        'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian'
      };
      const targetLang = langNames[userLang] || userLang;

      // 프롬프트 생성
      let prompt;
      if (wantSmartPhonetic) {
        // 발음 표기 요청 - 원본 가사의 언어를 감지하여 적절한 발음 표기로 변환
        // 가사 텍스트에서 언어를 감지 (간단한 휴리스틱)
        const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
        const isKorean = /[\uAC00-\uD7AF]/.test(text);
        const isChinese = /[\u4E00-\u9FFF]/.test(text) && !isJapanese;
        
        // 발음 언어 설정 가져오기 (영어/한국어)
        const phoneticLanguage = StorageManager.getItem("lyrics-plus:visual:phonetic-language") || "english";
        const useKoreanPhonetic = phoneticLanguage === "korean";
        
        let phoneticType = 'phonetic transcription (romanization)';
        let phoneticDescription = '';
        
        if (isJapanese) {
          if (useKoreanPhonetic) {
            phoneticType = 'Korean pronunciation (한국어 발음)';
            phoneticDescription = 'Convert Japanese text to Korean pronunciation (한글 발음). For example, "こんにちは" should become "곤니치와" or similar Korean pronunciation.';
          } else {
            phoneticType = 'Romaji (Japanese romanization)';
            phoneticDescription = 'Convert Japanese text to Romaji (romanization). For example, "こんにちは" should become "konnichiwa".';
          }
        } else if (isKorean) {
          if (useKoreanPhonetic) {
            phoneticType = 'Korean pronunciation (한국어 발음)';
            phoneticDescription = 'Keep the Korean text as is, or provide pronunciation guide in Korean.';
          } else {
            phoneticType = 'Romaja (Korean romanization)';
            phoneticDescription = 'Convert Korean text to Romaja (romanization). For example, "안녕하세요" should become "annyeonghaseyo".';
          }
        } else if (isChinese) {
          if (useKoreanPhonetic) {
            phoneticType = 'Korean pronunciation (한국어 발음)';
            phoneticDescription = 'Convert Chinese text to Korean pronunciation (한글 발음).';
          } else {
            phoneticType = 'Pinyin (Chinese romanization)';
            phoneticDescription = 'Convert Chinese text to Pinyin (romanization).';
          }
        } else {
          if (useKoreanPhonetic) {
            phoneticType = 'Korean pronunciation (한국어 발음)';
            phoneticDescription = 'Convert the text to Korean pronunciation (한글 발음).';
          } else {
            phoneticType = 'phonetic transcription (romanization)';
            phoneticDescription = 'Convert the text to phonetic transcription (romanization).';
          }
        }
        
        prompt = `You are a language expert. Convert the following lyrics to ${phoneticType}.

${phoneticDescription}

CRITICAL INSTRUCTIONS:
- DO NOT search the web or provide explanations
- DO NOT include any additional text, explanations, or citations
- ONLY output the ${phoneticType}
- Maintain the EXACT same number of lines as the original
- Keep empty lines as empty lines
- Preserve the original line structure

Original lyrics:
${text}

Output ONLY the ${phoneticType}, one line per line, with no additional text:`;
      } else {
        // 번역 요청
        const isKorean = targetLang === 'Korean' || userLang === 'ko';
        const translationGuidelines = isKorean ? `
TRANSLATION GUIDELINES FOR KOREAN:
- Use natural, fluent Korean that sounds like original Korean lyrics
- Preserve the emotional tone, mood, and nuance of the original
- Use appropriate Korean expressions that convey the same feeling
- Consider the rhythm and flow of the lyrics
- Avoid literal translations - prioritize natural Korean expressions
- Use poetic and lyrical language when appropriate
- Maintain the original's sentiment (sad, happy, romantic, etc.)
- Use conversational Korean that feels natural to Korean speakers` : `
TRANSLATION GUIDELINES:
- Use natural, fluent language that sounds like original lyrics in ${targetLang}
- Preserve the emotional tone, mood, and nuance of the original
- Use appropriate expressions that convey the same feeling
- Consider the rhythm and flow of the lyrics
- Avoid literal translations - prioritize natural expressions
- Use poetic and lyrical language when appropriate`;

        prompt = `You are a professional translator specializing in song lyrics. Translate the following Japanese lyrics to ${targetLang}.

CRITICAL INSTRUCTIONS:
- DO NOT search the web or provide explanations
- DO NOT include any citations, references, or additional text like [1][2][3]
- DO NOT add any introductory text like "Here is the translation:" or "Translation:"
- ONLY output the translated lyrics, nothing else
- Start directly with the first translated line, no preamble
- Maintain the EXACT same number of lines as the original
- Keep empty lines as empty lines (do not remove them)
- Translate ALL text completely - do not leave any Japanese characters
- Each line must be translated separately and completely
- Make the translation sound natural and fluent, as if it were originally written in ${targetLang}

${translationGuidelines}

Original lyrics:
${text}

Output ONLY the ${targetLang} translation, one line per line, with no Japanese text, no citations, and no explanations:`;
      }

      const tryFetch = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 80000);

        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${currentApiKey}`,
            },
            body: JSON.stringify({
              model: perplexityModel,
              messages: [
                {
                  role: "system",
                  content: "You are a professional translator and language expert. Provide only the requested translation or romanization without any explanations, citations, or additional text."
                },
                {
                  role: "user",
                  content: prompt
                }
              ],
              temperature: 0.3,
              max_tokens: 4000,
            }),
            signal: controller.signal,
            mode: "cors",
          });

          clearTimeout(timeoutId);
          return res;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      };

      try {
        const res = await tryFetch();

        if (!res.ok) {
          let errorData;
          try {
            const text = await res.text();
            try {
              errorData = JSON.parse(text);
            } catch (e) {
              errorData = { error: { message: text || `HTTP ${res.status}` } };
            }
          } catch (e) {
            errorData = { error: { message: `HTTP ${res.status}` } };
          }

          // 상세한 에러 로깅
          console.error("[Translator] Perplexity API error response:", {
            status: res.status,
            statusText: res.statusText,
            errorData: errorData,
            apiKeyPrefix: currentApiKey.substring(0, 10) + "..."
          });

          if (res.status === 429) {
            throw new Error("429 Rate Limit Exceeded");
          }

          if (res.status === 401 || res.status === 403) {
            throw new Error("403 Forbidden - Invalid API Key");
          }

          // Perplexity API 에러 응답 형식 처리
          const errorMessage = errorData.error?.message || errorData.message || errorData.detail || errorData.error || `HTTP ${res.status}`;
          
          // 400 에러인 경우 더 자세한 정보 제공
          if (res.status === 400) {
            console.error("[Translator] Perplexity API 400 error details:", JSON.stringify(errorData, null, 2));
            throw new Error(errorMessage || I18n.t("translator.invalidRequestFormat"));
          }

          const errorMsg = handleAPIError(res.status, { message: errorMessage });
          throw new Error(errorMsg);
        }

        const data = await res.json();

        // Perplexity API 응답 파싱
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
          throw new Error("Invalid response format from Perplexity API");
        }

        let translatedText = data.choices[0].message.content.trim();
        
        // Perplexity 응답에서 검색 결과 표시 제거 ([1][2][3] 같은 인용 제거)
        translatedText = translatedText.replace(/\[\d+\]/g, '');
        
        // 설명 텍스트 제거 (예: "The search results discuss..." 같은 패턴)
        const explanationPatterns = [
          /^The search results.*?\.\s*/i,
          /^However, I can help.*?\.\s*/i,
          /^Key principles.*?\.\s*/i,
          /^Converting.*?requires:.*?\.\s*/i,
          /^.*?based on the search results.*?\.\s*/i,
          /^Here.*?translation.*?:?\s*/i,
          /^Translation.*?:?\s*/i,
          /^The translation.*?:?\s*/i,
        ];
        explanationPatterns.forEach(pattern => {
          translatedText = translatedText.replace(pattern, '');
        });
        
        // 줄 단위로 분리 (빈 줄도 유지하여 원본 가사와 줄 수 맞춤)
        let lines = translatedText.split('\n');
        
        // 각 줄의 앞뒤 공백 제거 및 정리 (빈 줄은 빈 문자열로 유지)
        lines = lines.map(line => {
          let cleanLine = line.trim();
          
          // 인용 제거 (각 줄에서도)
          cleanLine = cleanLine.replace(/\[\d+\]/g, '').trim();
          
          // 설명 패턴이 줄 시작에만 있으면 제거 (줄 중간은 보존)
          explanationPatterns.forEach(pattern => {
            if (pattern.test(cleanLine)) {
              const match = cleanLine.match(pattern);
              if (match && match.index === 0) {
                cleanLine = cleanLine.replace(pattern, '').trim();
              }
            }
          });
          
          // 번역의 경우: 원본 언어 문자가 많이 포함된 줄만 제거 (혼합 번역 방지)
          // 하지만 너무 공격적으로 필터링하지 않음
          if (!wantSmartPhonetic && cleanLine && cleanLine.length > 5) {
            // 일본어/중국어 문자가 50% 이상 포함된 줄만 제거 (30% -> 50%로 완화)
            const japaneseChars = (cleanLine.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g) || []).length;
            const chineseChars = (cleanLine.match(/[\u4E00-\u9FFF]/g) || []).length;
            const totalChars = cleanLine.length;
            if (totalChars > 0 && (japaneseChars + chineseChars) / totalChars > 0.5) {
              // 원본 언어가 많이 포함된 줄은 제거 (혼합 번역)
              return '';
            }
          }
          
          return cleanLine;
        });
        
        // 빈 줄은 그대로 유지 (원본 가사 구조 유지)
        // 실제 번역/발음 줄은 모두 유지 (너무 공격적인 필터링 제거)
        
        // 응답 형식 변환 (기존 형식과 호환)
        const result = wantSmartPhonetic 
          ? { phonetic: lines }
          : { translation: lines };

        // API 성공 응답 로깅
        if (window.ApiTracker && logId) {
          const responseInfo = {
            lineCount: lines.length,
            cached: false
          };
          window.ApiTracker.logResponse(logId, responseInfo, 'success');
        }

        // 성공 시 로컬 캐시에 저장 (백그라운드)
        LyricsCache.setTranslation(finalTrackId, userLang, wantSmartPhonetic, result).catch(() => { });

        return result;
      } catch (error) {
        // 에러 발생 시 로깅
        if (window.ApiTracker && logId) {
          const errorMsg = error.name === "AbortError" ? 'timeout' : error.message;
          window.ApiTracker.logResponse(logId, null, 'error', errorMsg);
        }
        if (error.name === "AbortError") {
          throw new Error(I18n.t("translator.requestTimeout"));
        }
        throw error;
      }
    };

    // 로테이션 실행 로직
    const runWithRotation = async () => {
      let lastError;
      for (let i = 0; i < apiKeys.length; i++) {
        const key = apiKeys[i];
        try {
          return await executeRequest(key);
        } catch (error) {
          lastError = error;
          // 429(Rate Limit) 또는 403(Forbidden/Invalid)인 경우 다음 키로 시도
          const isRateLimit = error.message.includes("429") || error.message.includes("Rate Limit");
          const isForbidden = error.message.includes("403") || error.message.includes("Forbidden") || error.message.includes("API key not valid");

          if (isRateLimit || isForbidden) {
            console.warn(`[Translator] API Key ${key.substring(0, 8)}... failed (${isRateLimit ? 'Rate Limit' : 'Invalid'}). Rotating...`);
            if (i === apiKeys.length - 1) {
              break; // 마지막 키였으면 중단
            }
            continue; // 다음 키 시도
          }

          // 그 외 에러는 즉시 중단
          throw error;
        }
      }
      throw new Error(`${I18n.t("translator.failedPrefix")}: ${lastError ? lastError.message : "All keys failed"}`);
    };

    // Promise를 생성하고 Map에 저장
    const requestPromise = runWithRotation().finally(() => {
      // 요청 완료 후 Map에서 제거
      _inflightRequests.delete(requestKey);
    });

    // ignoreCache가 아닌 경우에만 중복 요청 방지 등록
    if (!ignoreCache) {
      _inflightRequests.set(requestKey, requestPromise);
    }

    return requestPromise;
  }

  /**
   * 통합 번역 API 호출 함수 - Perplexity와 Gemini를 모두 시도
   * 먼저 Perplexity를 시도하고, 실패하면 Gemini를 시도
   * API 키는 메모리 캐시를 사용하여 성능 최적화
   */
  static _apiKeyCache = {
    perplexity: null,
    gemini: null,
    lastCheck: 0,
    cacheTTL: 60000, // 1분 캐시
  };

  static _getApiKeys() {
    const now = Date.now();
    // 캐시가 유효하면 재사용
    if (this._apiKeyCache.lastCheck && (now - this._apiKeyCache.lastCheck) < this._apiKeyCache.cacheTTL) {
      return {
        hasPerplexityKey: !!this._apiKeyCache.perplexity,
        hasGeminiKey: !!this._apiKeyCache.gemini,
      };
    }

    // 캐시 갱신
    const perplexityKey = StorageManager.getItem("ivLyrics:visual:perplexity-api-key");
    const geminiKey = StorageManager.getItem("ivLyrics:visual:gemini-api-key");
    
    this._apiKeyCache.perplexity = perplexityKey && perplexityKey.trim().length > 0 ? perplexityKey : null;
    this._apiKeyCache.gemini = geminiKey && geminiKey.trim().length > 0 ? geminiKey : null;
    this._apiKeyCache.lastCheck = now;

    return {
      hasPerplexityKey: !!this._apiKeyCache.perplexity,
      hasGeminiKey: !!this._apiKeyCache.gemini,
    };
  }

  static _clearApiKeyCache() {
    this._apiKeyCache.perplexity = null;
    this._apiKeyCache.gemini = null;
    this._apiKeyCache.lastCheck = 0;
  }

  static async callTranslationAPI({
    trackId,
    artist,
    title,
    text,
    wantSmartPhonetic = false,
    provider = null,
    ignoreCache = false,
  }) {
    // API 키 확인 (메모리 캐시 사용)
    const { hasPerplexityKey, hasGeminiKey } = this._getApiKeys();

    // 둘 다 없으면 에러
    if (!hasPerplexityKey && !hasGeminiKey) {
      throw new Error(I18n.t("translator.missingApiKey"));
    }

    // 먼저 Perplexity 시도
    if (hasPerplexityKey) {
      try {
        console.log("[Translator] Trying Perplexity API first...");
        return await this.callPerplexity({
          trackId,
          artist,
          title,
          text,
          wantSmartPhonetic,
          provider,
          ignoreCache,
        });
      } catch (error) {
        console.warn("[Translator] Perplexity API failed:", error.message);
        
        // 에러 타입 확인
        const isRateLimit = error.message.includes("429") || error.message.includes("Rate Limit");
        const isForbidden = error.message.includes("403") || error.message.includes("Forbidden") || error.message.includes("Invalid API Key");
        const shouldFallback = isRateLimit || isForbidden;
        
        // Gemini로 fallback 가능한 경우
        if (hasGeminiKey && shouldFallback) {
          console.log("[Translator] Falling back to Gemini API...");
          try {
            return await this.callGemini({
              trackId,
              artist,
              title,
              text,
              wantSmartPhonetic,
              provider,
              ignoreCache,
            });
          } catch (geminiError) {
            // Gemini도 실패하면 원래 에러 throw
            throw new Error(`${I18n.t("translator.failedPrefix")}: Perplexity (${error.message}), Gemini (${geminiError.message})`);
          }
        }
        
        // Gemini가 없거나 fallback이 불가능한 경우 원래 에러 throw
        throw error;
      }
    }

    // Perplexity 키가 없으면 Gemini만 시도
    if (hasGeminiKey) {
      console.log("[Translator] Using Gemini API (Perplexity key not available)...");
      return await this.callGemini({
        trackId,
        artist,
        title,
        text,
        wantSmartPhonetic,
        provider,
        ignoreCache,
      });
    }

    throw new Error(I18n.t("translator.missingApiKey"));
  }

  includeExternal(url) {
    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${url}"]`);
      if (existingScript) {
        if (existingScript.dataset)
          existingScript.dataset.loaded =
            existingScript.dataset.loaded || "true";
        return resolve();
      }

      const script = document.createElement("script");
      script.setAttribute("type", "text/javascript");
      script.setAttribute("src", url);

      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      });

      script.addEventListener("error", () => {
        reject(new Error(`Failed to load script: ${url}`));
      });

      document.head.appendChild(script);
    });
  }

  async injectExternals(lang) {
    const langCode = lang?.slice(0, 2);
    try {
      switch (langCode) {
        case "ja":
          await Promise.all([
            this.includeExternal(kuromojiPath),
            this.includeExternal(kuroshiroPath),
          ]);
          break;
        case "ko":
          await this.includeExternal(aromanize);
          break;
        case "zh":
          await this.includeExternal(openCCPath);
          this.includeExternal(pinyinProPath).catch(() => { });
          this.includeExternal(tinyPinyinPath).catch(() => { });
          break;
        case "ru":
        case "vi":
        case "de":
        case "en":
        case "es":
        case "fr":
        case "it":
        case "pt":
        case "nl":
        case "pl":
        case "tr":
        case "ar":
        case "hi":
        case "th":
        case "id":
          // These languages will use Gemini API for translation
          // No external libraries needed
          this.finished[langCode] = true;
          break;
      }
    } catch (error) {
      throw error;
    }
  }
  async awaitFinished(language) {
    const langCode = language?.slice(0, 2);
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
    if (langCode && !this.finished[langCode]) {
      await this.injectExternals(language);
      await this.createTranslator(language);
    }
  }

  /**
   * Fix an issue with kuromoji when loading dict from external urls
   * Adapted from: https://github.com/mobilusoss/textlint-browser-runner/pull/7
   */
  applyKuromojiFix() {
    if (typeof XMLHttpRequest.prototype.realOpen !== "undefined") return;
    XMLHttpRequest.prototype.realOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, bool) {
      if (url.indexOf(dictPath.replace("https://", "https:/")) === 0) {
        this.realOpen(method, url.replace("https:/", "https://"), bool);
      } else {
        this.realOpen(method, url, bool);
      }
    };
  }

  async createTranslator(lang) {
    const langCode = lang.slice(0, 2);

    switch (langCode) {
      case "ja":
        if (this.kuroshiro) return;

        // Wait for libraries to be available with timeout
        await this.waitForGlobals(["Kuroshiro", "KuromojiAnalyzer"], 10000);

        this.kuroshiro = new Kuroshiro.default();
        await this.kuroshiro.init(new KuromojiAnalyzer({ dictPath }));
        this.finished.ja = true;
        break;

      case "ko":
        if (this.Aromanize) return;

        await this.waitForGlobals(["Aromanize"], 5000);

        this.Aromanize = Aromanize;
        this.finished.ko = true;
        break;

      case "zh":
        if (this.OpenCC) return;

        await this.waitForGlobals(["OpenCC"], 5000);

        this.OpenCC = OpenCC;
        this.finished.zh = true;
        break;

      case "ru":
      case "vi":
      case "de":
      case "en":
      case "es":
      case "fr":
      case "it":
      case "pt":
      case "nl":
      case "pl":
      case "tr":
      case "ar":
      case "hi":
      case "th":
      case "id":
        // These languages use Gemini API for translation
        this.finished[langCode] = true;
        break;
    }
  }

  /**
   * Wait for global variables to become available
   * @param {string[]} globalNames - Array of global variable names to wait for
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<void>}
   */
  async waitForGlobals(globalNames, timeoutMs = 5000) {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkGlobals = () => {
        const allAvailable = globalNames.every(
          (name) => typeof window[name] !== "undefined"
        );

        if (allAvailable) {
          resolve();
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(
            new Error(`Timeout waiting for globals: ${globalNames.join(", ")}`)
          );
          return;
        }

        setTimeout(checkGlobals, 50);
      };

      checkGlobals();
    });
  }

  // 최적화 #12 - Romaji character map
  static _romajiMap = { 'ō': 'ou', 'ū': 'uu', 'ā': 'aa', 'ī': 'ii', 'ē': 'ee' };
  static _romajiPattern = /[ōūāīē]/g;

  static normalizeRomajiString(s) {
    if (typeof s !== "string") return "";
    // 최적화 #12 - 단일 replace로 변경
    return s
      .replace(this._romajiPattern, match => this._romajiMap[match])
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /**
   * 일본어 텍스트를 로마자(romaji)로 변환합니다.
   * Kuroshiro 라이브러리를 사용하여 일본어 히라가나/가타카나를 로마자로 변환합니다.
   * 
   * @param {string} text - 변환할 일본어 텍스트
   * @param {string} [target="romaji"] - 변환 대상 형식
   * @param {string} [mode="spaced"] - 변환 모드 ("spaced", "okurigana", "furigana")
   * @returns {Promise<string>} 변환된 로마자 텍스트
   * 
   * @example
   * const romaji = await translator.romajifyText("こんにちは");
   * // 결과: "konnichiha"
   */
  async romajifyText(text, target = "romaji", mode = "spaced") {
    // Ensure initialization is complete
    await this.awaitFinished("ja");

    const out = await this.kuroshiro.convert(text, {
      to: target,
      mode: mode,
      romajiSystem: "hepburn",
    });
    return Translator.normalizeRomajiString(out);
  }

  /**
   * 한국어 한글을 로마자(romaja)로 변환합니다.
   * Aromanize 라이브러리를 사용하여 한글을 로마자 표기법으로 변환합니다.
   * 
   * @param {string} text - 변환할 한글 텍스트
   * @param {string} target - 변환 대상 형식 (예: "hangul"일 경우 원본 반환)
   * @returns {Promise<string>} 변환된 로마자 텍스트
   * @throws {Error} 한국어 변환기가 초기화되지 않았을 때
   * 
   * @example
   * const romaja = await translator.convertToRomaja("안녕하세요");
   * // 결과: "annyeonghaseyo"
   */
  async convertToRomaja(text, target) {
    // Ensure initialization is complete
    await this.awaitFinished("ko");

    if (target === "hangul") return text;
    if (!this.Aromanize || typeof this.Aromanize.hangulToLatin !== "function") {
      throw new Error("Korean converter not initialized");
    }
    return this.Aromanize.hangulToLatin(text, "rr-translit");
  }

  /**
   * 중국어 텍스트를 다른 체계로 변환합니다.
   * OpenCC 라이브러리를 사용하여 간체/번체 중국어를 변환합니다.
   * 
   * @param {string} text - 변환할 중국어 텍스트
   * @param {string} from - 원본 형식 (예: "t", "s")
   * @param {string} target - 변환 대상 형식 (예: "t", "s")
   * @returns {Promise<string>} 변환된 중국어 텍스트
   * 
   * @example
   * // 간체를 번체로 변환
   * const traditional = await translator.convertChinese("你好", "s", "t");
   * // 결과: "你好" (번체)
   */
  async convertChinese(text, from, target) {
    // Ensure initialization is complete
    await this.awaitFinished("zh");

    const converter = this.OpenCC.Converter({
      from: from,
      to: target,
    });

    return converter(text);
  }

  async loadPinyinPro() {
    if (typeof pinyinPro !== "undefined") return true;
    const urls = [
      pinyinProPath,
      "https://cdn.jsdelivr.net/npm/pinyin-pro@3.19.7/dist/index.js",
      "https://unpkg.com/pinyin-pro@3.19.7/dist/index.min.js",
      "https://unpkg.com/pinyin-pro@3.19.7/dist/index.js",
      "https://fastly.jsdelivr.net/npm/pinyin-pro@3.19.7/dist/index.min.js",
      "https://fastly.jsdelivr.net/npm/pinyin-pro@3.19.7/dist/index.js",
    ];
    for (const url of urls) {
      try {
        await this.includeExternal(url);
        await this.waitForGlobals(["pinyinPro"], 8000);
        return true;
      } catch { }
    }
    return false;
  }

  async loadTinyPinyin() {
    if (typeof TinyPinyin !== "undefined") return true;
    const urls = [
      tinyPinyinPath,
      "https://unpkg.com/tiny-pinyin/dist/tiny-pinyin.min.js",
      "https://fastly.jsdelivr.net/npm/tiny-pinyin/dist/tiny-pinyin.min.js",
    ];
    for (const url of urls) {
      try {
        await this.includeExternal(url);
        await this.waitForGlobals(["TinyPinyin"], 8000);
        return true;
      } catch { }
    }
    return false;
  }

  /**
   * 중국어 한자를 병음(Pinyin)으로 변환합니다.
   * TinyPinyin 또는 PinyinPro 라이브러리를 사용하여 변환을 수행합니다.
   * 
   * @param {string} text - 변환할 중국어 텍스트
   * @param {Object} [options={}] - 변환 옵션
   * @param {string} [options.toneType="mark"] - 성조 표기 방식
   * @param {string} [options.type="string"] - 반환 타입
   * @param {string} [options.nonZh="consecutive"] - 비중국어 문자 처리 방식
   * @returns {Promise<string>} 변환된 병음 텍스트
   * 
   * @example
   * const pinyin = await translator.convertToPinyin("你好");
   * // 결과: "nǐ hǎo"
   */
  async convertToPinyin(text, options = {}) {
    try {
      if (await this.loadTinyPinyin()) {
        return TinyPinyin.convertToPinyin(text || "");
      }
      if (await this.loadPinyinPro()) {
        const toneType = options.toneType || "mark";
        const type = options.type || "string";
        const nonZh = options.nonZh || "consecutive";
        return pinyinPro.pinyin(text || "", { toneType, type, nonZh });
      }
      return text || "";
    } catch {
      return text || "";
    }
  }
}
