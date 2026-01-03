// ============================================
// NowPlayingPanelLyrics.js
// 우측 패널 (Now Playing View)에 가사를 표시하는 모듈
// ============================================

(function NowPlayingPanelLyricsModule() {
    "use strict";

    // Spicetify가 준비될 때까지 대기
    if (!window.Spicetify || !Spicetify.React || !Spicetify.ReactDOM) {
        setTimeout(NowPlayingPanelLyricsModule, 300);
        return;
    }

    const react = Spicetify.React;
    const { useState, useEffect, useRef, useCallback, useMemo, memo } = react;

    // 설정 키
    const STORAGE_KEY = "ivLyrics:visual:panel-lyrics-enabled";
    const PANEL_LINES_KEY = "ivLyrics:visual:panel-lyrics-lines";
    const FONT_SCALE_KEY = "ivLyrics:visual:panel-font-scale";

    // 기본 설정값
    const DEFAULT_ENABLED = true;
    const DEFAULT_LINES = 5; // 표시할 가사 줄 수 (위 2, 현재 1, 아래 2)
    const DEFAULT_FONT_SCALE = 100; // 폰트 크기 배율 (50% ~ 200%)

    // 패널 가사 컨테이너 CSS 클래스
    const PANEL_CONTAINER_CLASS = "ivlyrics-panel-lyrics-container";
    const PANEL_SECTION_CLASS = "ivlyrics-panel-lyrics-section";
    const PANEL_STYLE_ID = "ivlyrics-panel-lyrics-styles";

    // Observer 참조
    let panelObserver = null;
    let lyricsRoot = null;
    let stylesInjected = false;

    // ============================================
    // CSS 스타일 (Apple Music Card Lyrics 스타일)
    // 앨범 색상 배경의 카드 박스, Pretendard 폰트
    // ============================================
    const PANEL_STYLES = `
/* Pretendard 폰트 import */
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css');

/* ivLyrics 페이지에서는 패널 가사 숨기기 (중복 방지) */
/* JavaScript에서 body에 클래스를 추가하는 방식으로 동작 */
body.ivlyrics-page-active .ivlyrics-panel-lyrics-container,
body.ivlyrics-page-active .ivlyrics-panel-lyrics-section {
  display: none !important;
}

/* CSS :has() 셀렉터 폴백 (지원 브라우저용) */
body:has([data-testid="ivlyrics-page"]) .ivlyrics-panel-lyrics-container,
body:has([data-testid="ivlyrics-page"]) .ivlyrics-panel-lyrics-section {
  display: none !important;
}

/* Now Playing Panel Lyrics - 카드 스타일 */
.ivlyrics-panel-lyrics-container {
  width: 100% !important;
  font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important;
  order: 2 !important; /* 곡 정보 다음, 크레딧 전에 고정 위치 */
  --ivlyrics-font-scale: 1; /* 기본 스케일 (CSS 변수로 동적 조절) */
  cursor: pointer !important;
}

/* 카드 박스 - 앨범 색상 배경 (CSS 변수로 동적 색상 적용) */
.ivlyrics-panel-lyrics-section {
  padding: 14px 16px 18px !important;
  border-radius: 12px !important;
  background: var(--ivlyrics-panel-bg-color, rgba(80, 80, 80, 0.6)) !important;
  backdrop-filter: blur(20px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
}

/* Lyrics 라벨 */
.ivlyrics-panel-header {
  display: flex !important;
  align-items: center !important;
  margin-bottom: 10px !important;
  padding: 0 !important;
}

.ivlyrics-panel-header h2 {
  font-size: 11px !important;
  font-weight: 700 !important;
  color: rgba(255, 255, 255, 0.85) !important;
  margin: 0 !important;
  letter-spacing: 0.02em !important;
  font-family: 'Pretendard Variable', Pretendard, sans-serif !important;
}

/* 가사 래퍼 - 슬라이드 업 애니메이션 */
.ivlyrics-panel-lyrics-wrapper {
  display: flex !important;
  flex-direction: column !important;
  gap: 4px !important;
  height: auto !important;
  max-height: none !important;
  overflow: hidden !important;
  position: relative !important;
  mask-image: none !important;
  -webkit-mask-image: none !important;
}

/* 슬라이드 업 애니메이션 */
@keyframes ivlyrics-slide-up {
  from {
    transform: translateY(10px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes ivlyrics-fade-out {
  from {
    opacity: 0.5;
  }
  to {
    opacity: 0.3;
  }
}

/* 노래방 글자 바운스 애니메이션 - 자연스럽고 미세한 효과 */
@keyframes ivlyrics-bounce {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
  }
}

/* 가사 라인 */
.ivlyrics-panel-line {
  display: flex !important;
  flex-direction: column !important;
  gap: 2px !important;
  padding: 3px 0 !important;
  border-radius: 0 !important;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
  background: transparent !important;
  text-align: left !important;
  font-family: 'Pretendard Variable', Pretendard, sans-serif !important;
  animation: ivlyrics-slide-up 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
}

/* 활성 라인 */
.ivlyrics-panel-line.active {
  background: transparent !important;
  opacity: 1 !important;
}

/* 지나간 라인 */
.ivlyrics-panel-line.past {
  opacity: 0.4 !important;
}

/* 다음 라인 */
.ivlyrics-panel-line.future {
  opacity: 0.6 !important;
}

/* 1. 발음 (Phonetic) - 아래에 작게 */
.ivlyrics-panel-line-phonetic {
  font-size: calc(13px * var(--ivlyrics-font-scale, 1)) !important;
  font-weight: 400 !important;
  color: rgba(255, 255, 255, 0.55) !important;
  line-height: 1.35 !important;
  letter-spacing: 0.01em !important;
  font-family: 'Pretendard Variable', Pretendard, sans-serif !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-phonetic {
  color: rgba(255, 255, 255, 0.75) !important;
}

/* 2. 원어 (Original Text) - 크고 볼드 */
.ivlyrics-panel-line-text {
  font-size: calc(18px * var(--ivlyrics-font-scale, 1)) !important;
  font-weight: 700 !important;
  color: rgba(255, 255, 255, 0.7) !important;
  line-height: 1.4 !important;
  letter-spacing: -0.01em !important;
  word-break: keep-all !important;
  overflow-wrap: break-word !important;
  font-family: 'Pretendard Variable', Pretendard, sans-serif !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-text {
  color: #ffffff !important;
  font-weight: 800 !important;
}

/* 3. 번역 (Translation) - 아래에 작게 */
.ivlyrics-panel-line-translation {
  font-size: calc(13px * var(--ivlyrics-font-scale, 1)) !important;
  font-weight: 500 !important;
  color: rgba(255, 255, 255, 0.5) !important;
  line-height: 1.35 !important;
  margin-top: 1px !important;
  font-family: 'Pretendard Variable', Pretendard, sans-serif !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-line-translation {
  color: rgba(255, 255, 255, 0.8) !important;
}

/* ========================================
   노래방 (Karaoke) 가사 스타일
   ======================================== */
.ivlyrics-panel-line-karaoke {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0px !important;
  font-size: calc(18px * var(--ivlyrics-font-scale, 1)) !important;
  font-weight: 700 !important;
  line-height: 1.4 !important;
  font-family: 'Pretendard Variable', Pretendard, sans-serif !important;
}

.ivlyrics-panel-karaoke-space {
  margin-right: 5px !important;
}

/* 노래방 단어 */
.ivlyrics-panel-karaoke-word {
  position: relative !important;
  display: inline-block !important;
  color: rgba(255, 255, 255, 0.5) !important;
  transition: color 0.15s ease, transform 0.15s ease !important;
  transform-origin: center bottom !important;
}

/* 노래방 단어 - 활성 (하이라이트 + 미세 바운스) */
.ivlyrics-panel-karaoke-word.sung {
  color: #ffffff !important;
  animation: ivlyrics-bounce 0.2s ease-out forwards !important;
}

/* 노래방 라인 활성 시 단어 기본 색상 더 밝게 */
.ivlyrics-panel-line.active .ivlyrics-panel-karaoke-word {
  color: rgba(255, 255, 255, 0.6) !important;
}

.ivlyrics-panel-line.active .ivlyrics-panel-karaoke-word.sung {
  color: #ffffff !important;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.5) !important;
}

/* 가사 없음 상태 */
.ivlyrics-panel-empty {
  text-align: center !important;
  color: rgba(255, 255, 255, 0.6) !important;
  font-size: 13px !important;
  padding: 16px !important;
  font-family: 'Pretendard Variable', Pretendard, sans-serif !important;
}

/* Placeholder 라인 (빈 줄 - 높이 유지용) */
.ivlyrics-panel-line.placeholder {
  opacity: 0 !important;
  pointer-events: none !important;
  min-height: 24px !important;
}

/* Furigana (Ruby) 스타일 */
.ivlyrics-panel-line ruby {
  ruby-align: center !important;
}

.ivlyrics-panel-line ruby rt {
  font-size: 0.55em !important;
  color: rgba(255, 255, 255, 0.55) !important;
  font-weight: 400 !important;
}

.ivlyrics-panel-line.active ruby rt {
  color: rgba(255, 255, 255, 0.75) !important;
}

/* 스크롤바 숨기기 */
.ivlyrics-panel-lyrics-wrapper::-webkit-scrollbar {
  display: none !important;
}

.ivlyrics-panel-lyrics-wrapper {
  -ms-overflow-style: none !important;
  scrollbar-width: none !important;
}
`;

    // CSS 스타일 주입 함수
    const injectStyles = () => {
        if (stylesInjected) return;
        if (document.getElementById(PANEL_STYLE_ID)) {
            stylesInjected = true;
            return;
        }

        const styleElement = document.createElement('style');
        styleElement.id = PANEL_STYLE_ID;
        styleElement.textContent = PANEL_STYLES;
        document.head.appendChild(styleElement);
        stylesInjected = true;
        console.log("[NowPlayingPanelLyrics] Styles injected");
    };

    // 현재 가사 상태
    let currentLyricsState = {
        lyrics: [],
        currentIndex: 0,
        isPlaying: false,
        trackUri: null
    };

    // ============================================
    // 유틸리티 함수
    // ============================================
    const getStorageValue = (key, defaultValue) => {
        try {
            const value = localStorage.getItem(key);
            if (value === null) return defaultValue;
            if (value === "true") return true;
            if (value === "false") return false;
            const num = parseInt(value, 10);
            if (!isNaN(num)) return num;
            return value;
        } catch {
            return defaultValue;
        }
    };

    const setStorageValue = (key, value) => {
        try {
            localStorage.setItem(key, String(value));
        } catch (e) {
            console.error("[NowPlayingPanelLyrics] Storage error:", e);
        }
    };

    // ============================================
    // 노래방 가사 렌더링 헬퍼
    // syllables 또는 vocals 구조에서 syllables 추출
    // ============================================
    const getSyllablesFromLine = (line) => {
        if (line.syllables && line.syllables.length > 0) {
            return line.syllables;
        }
        if (line.vocals?.lead?.syllables) {
            // lead와 background 병합
            const allSyllables = [...line.vocals.lead.syllables];
            if (line.vocals.background) {
                line.vocals.background.forEach(bg => {
                    if (bg.syllables) {
                        allSyllables.push(...bg.syllables);
                    }
                });
            }
            // startTime 기준 정렬
            return allSyllables.sort((a, b) => a.startTime - b.startTime);
        }
        return [];
    };

    // ============================================
    // 노래방 단어 컴포넌트 (개별 syllable)
    // DOM 직접 조작으로 리렌더링 없이 하이라이트
    // ============================================
    const KaraokeWord = memo(({ syllable, idx, isLinePast }) => {
        const wordRef = useRef(null);
        const text = syllable.text || '';

        // 외부에서 시간 업데이트 시 클래스만 토글 (리렌더링 없음)
        useEffect(() => {
            if (!wordRef.current) return;

            const updateSungState = () => {
                const el = wordRef.current;
                if (!el) return;

                // isLinePast가 true면 항상 sung
                if (isLinePast) {
                    if (!el.classList.contains('sung')) {
                        el.classList.add('sung');
                    }
                    return;
                }

                // 현재 시간과 비교 (ref에서 직접 읽음)
                const currentTime = window._ivLyricsPanelCurrentTime || 0;
                const shouldBeSung = currentTime >= syllable.startTime;

                if (shouldBeSung && !el.classList.contains('sung')) {
                    el.classList.add('sung');
                } else if (!shouldBeSung && el.classList.contains('sung')) {
                    el.classList.remove('sung');
                }
            };

            // 초기 상태 설정
            updateSungState();

            // 커스텀 이벤트로 업데이트 수신
            window.addEventListener('ivlyrics-panel-time-update', updateSungState);
            return () => {
                window.removeEventListener('ivlyrics-panel-time-update', updateSungState);
            };
        }, [syllable.startTime, isLinePast]);

        // 텍스트가 비어있으면 렌더링하지 않음
        if (!text) return null;

        // 공백만 있는 경우 공백 span 반환
        if (text.trim() === '') {
            return react.createElement("span", {
                key: `space-${idx}`,
                className: "ivlyrics-panel-karaoke-space"
            }, " ");
        }

        // 텍스트에 공백이 포함된 경우 그대로 렌더링 (공백 유지)
        return react.createElement("span", {
            key: idx,
            ref: wordRef,
            className: `ivlyrics-panel-karaoke-word ${isLinePast ? 'sung' : ''}`
        }, text);
    });

    // ============================================
    // 노래방 라인 컴포넌트 (syllables 포함)
    // ============================================
    const KaraokeLine = memo(({ syllables, isActive, isPast, phonetic, translation, lineClass }) => {
        return react.createElement("div", { className: lineClass },
            // 노래방 가사 (글자별 타이밍)
            react.createElement("div", { className: "ivlyrics-panel-line-karaoke" },
                syllables.map((syllable, idx) =>
                    react.createElement(KaraokeWord, {
                        key: idx,
                        syllable,
                        idx,
                        isLinePast: isPast
                    })
                )
            ),
            // 발음
            phonetic && react.createElement("div", {
                className: "ivlyrics-panel-line-phonetic"
            }, phonetic),
            // 번역
            translation && react.createElement("div", {
                className: "ivlyrics-panel-line-translation"
            }, translation)
        );
    }, (prevProps, nextProps) => {
        // 라인 상태가 바뀔 때만 리렌더링
        return prevProps.isActive === nextProps.isActive &&
               prevProps.isPast === nextProps.isPast &&
               prevProps.lineClass === nextProps.lineClass &&
               prevProps.phonetic === nextProps.phonetic &&
               prevProps.translation === nextProps.translation;
    });

    // ============================================
    // 일반 가사 라인 컴포넌트
    // ============================================
    const NormalLine = memo(({ displayText, phonetic, translation, lineClass }) => {
        return react.createElement("div", { className: lineClass },
            react.createElement("div", {
                className: "ivlyrics-panel-line-text",
                dangerouslySetInnerHTML: displayText ? { __html: displayText } : undefined
            }, displayText ? undefined : " "),
            phonetic && react.createElement("div", {
                className: "ivlyrics-panel-line-phonetic"
            }, phonetic),
            translation && react.createElement("div", {
                className: "ivlyrics-panel-line-translation"
            }, translation)
        );
    }, (prevProps, nextProps) => {
        return prevProps.lineClass === nextProps.lineClass &&
               prevProps.displayText === nextProps.displayText &&
               prevProps.phonetic === nextProps.phonetic &&
               prevProps.translation === nextProps.translation;
    });

    // ============================================
    // 가사 라인 컴포넌트 (Apple Music 스타일)
    // 노래방 가사와 일반 가사 모두 지원
    // ============================================
    const LyricLine = memo(({ line, isActive, isPast, isFuture, translation, phonetic, isPlaceholder }) => {
        const lineClass = `ivlyrics-panel-line ${isActive ? 'active' : ''} ${isPast ? 'past' : ''} ${isFuture ? 'future' : ''} ${isPlaceholder ? 'placeholder' : ''}`;

        // 노래방 가사인지 확인
        const syllables = getSyllablesFromLine(line);
        const isKaraoke = syllables.length > 0;
        const displayText = line.originalText || line.text || '';

        // 노래방 가사인 경우
        if (isKaraoke) {
            return react.createElement(KaraokeLine, {
                syllables,
                isActive,
                isPast,
                phonetic,
                translation,
                lineClass
            });
        }

        // 일반 가사
        return react.createElement(NormalLine, {
            displayText,
            phonetic,
            translation,
            lineClass
        });
    }, (prevProps, nextProps) => {
        // currentTime 제거됨 - 라인 상태 변경 시에만 리렌더링
        return prevProps.isActive === nextProps.isActive &&
               prevProps.isPast === nextProps.isPast &&
               prevProps.isFuture === nextProps.isFuture &&
               prevProps.isPlaceholder === nextProps.isPlaceholder &&
               prevProps.translation === nextProps.translation &&
               prevProps.phonetic === nextProps.phonetic &&
               prevProps.line === nextProps.line;
    });

    // ============================================
    // 패널 가사 메인 컴포넌트
    // ============================================
    const PanelLyrics = () => {
        const [lyrics, setLyrics] = useState([]);
        const [currentIndex, setCurrentIndex] = useState(0);
        // currentTime은 더 이상 상태로 관리하지 않음 - 전역 변수 사용
        const [trackOffset, setTrackOffset] = useState(0); // 곡별 싱크 오프셋
        const [isEnabled, setIsEnabled] = useState(getStorageValue(STORAGE_KEY, DEFAULT_ENABLED));
        const [numLines, setNumLines] = useState(parseInt(getStorageValue(PANEL_LINES_KEY, DEFAULT_LINES), 10));
        const [fontScale, setFontScale] = useState(parseInt(getStorageValue(FONT_SCALE_KEY, DEFAULT_FONT_SCALE), 10));
        const containerRef = useRef(null);
        const scrollRef = useRef(null);
        const animationRef = useRef(null);
        const lastTrackUri = useRef(null);
        const loadingRef = useRef(false);

        // LyricsService Extension을 사용해서 가사 직접 불러오기
        // 1단계: 가사 먼저 로드 → 2단계: 발음/번역 따로 요청
        const loadLyricsFromExtension = useCallback(async (forceReload = false) => {
            // 이미 로딩 중이면 스킵
            if (loadingRef.current && !forceReload) return;

            // LyricsService Extension이 로드될 때까지 대기
            let retries = 0;
            while (!window.LyricsService && retries < 20) {
                await new Promise(resolve => setTimeout(resolve, 300));
                retries++;
            }

            if (!window.LyricsService) {
                console.warn("[PanelLyrics] LyricsService Extension not loaded");
                return;
            }

            // 현재 트랙 정보 가져오기
            const item = Spicetify.Player.data?.item;
            if (!item) return;

            const trackUri = item.uri;

            // 같은 트랙이면 스킵 (forceReload가 아닌 경우)
            if (!forceReload && trackUri === lastTrackUri.current) {
                return;
            }

            loadingRef.current = true;
            lastTrackUri.current = trackUri;

            const trackInfo = {
                uri: trackUri,
                title: item.name,
                artist: item.artists?.map(a => a.name).join(', ') || '',
                album: item.album?.name || '',
                duration: item.duration?.milliseconds || 0,
                trackId: trackUri?.split(':')[2]
            };

            console.log("[PanelLyrics] Loading lyrics for:", trackInfo.title);

            try {
                // ==========================================
                // 1단계: 가사만 먼저 로드 (빠르게 표시)
                // ==========================================
                // 사용자 설정의 provider 순서 사용 (활성화된 것만 필터)
                const defaultOrder = ['ivlyrics', 'spotify', 'lrclib', 'local'];
                const configOrder = window.CONFIG?.providersOrder;
                const providers = window.CONFIG?.providers || {};
                const providerOrder = Array.isArray(configOrder) && configOrder.length > 0
                    ? configOrder.filter(id => providers[id]?.on !== false)
                    : defaultOrder;
                const result = await window.LyricsService.getLyricsFromProviders(trackInfo, providerOrder, 0); // mode 0 = karaoke 우선

                if (result && !result.error) {
                    // karaoke (노래방) → synced → unsynced 순서로 선택
                    let lyricsData = result.karaoke || result.synced || result.unsynced || [];
                    const isKaraoke = !!result.karaoke;

                    if (lyricsData.length > 0) {
                        // endTime 계산 (없으면 다음 라인의 startTime 사용)
                        lyricsData = lyricsData.map((line, idx, arr) => {
                            if (!line.endTime && idx < arr.length - 1) {
                                return { ...line, endTime: arr[idx + 1].startTime };
                            }
                            return line;
                        });

                        console.log("[PanelLyrics] Got lyrics:", lyricsData.length, "lines, karaoke:", isKaraoke);
                        if (isKaraoke && lyricsData[0]) {
                            console.log("[PanelLyrics] Karaoke sample:", lyricsData[0].syllables || lyricsData[0].vocals);
                        }

                        setLyrics(lyricsData);
                        currentLyricsState.lyrics = lyricsData;
                        currentLyricsState.trackUri = trackUri;
                        setCurrentIndex(0);

                        // 곡별 싱크 오프셋 가져오기
                        if (window.TrackSyncDB?.getOffset) {
                            const offset = await window.TrackSyncDB.getOffset(trackUri);
                            setTrackOffset(offset || 0);
                            console.log("[PanelLyrics] Track offset:", offset || 0);
                        }

                        // ==========================================
                        // 2단계: 발음/번역 비동기 요청 (가사 표시 후)
                        // ==========================================
                        loadTranslationAsync(trackInfo, lyricsData, result.provider);
                    } else {
                        console.log("[PanelLyrics] No lyrics in result");
                        setLyrics([]);
                        currentLyricsState.lyrics = [];
                    }
                } else {
                    console.log("[PanelLyrics] No lyrics found:", result?.error);
                    setLyrics([]);
                    currentLyricsState.lyrics = [];
                }
            } catch (error) {
                console.error("[PanelLyrics] Failed to load lyrics:", error);
                setLyrics([]);
            } finally {
                loadingRef.current = false;
            }
        }, []);

        // 발음/번역 비동기 로드 (가사 표시 후 백그라운드에서)
        // 사용자 설정에 따라 발음/번역 요청 여부 결정
        const loadTranslationAsync = useCallback(async (trackInfo, lyricsData, provider) => {
            if (!window.Translator?.callGemini) {
                console.log("[PanelLyrics] Translator not available");
                return;
            }

            try {
                // 가사 언어 감지
                const lyricsText = lyricsData.map(l => l.text || '').join('\n');
                const trackId = trackInfo.trackId;

                // 언어 감지 (LyricsService.detectLanguage 사용)
                // modeKey는 CONFIG의 translation-mode 키와 동일해야 함 (예: "japanese", "korean")
                // LyricsService.detectLanguage는 언어 코드(ja, ko, zh 등)를 반환
                const langCodeToKey = {
                    'ja': 'japanese',
                    'ko': 'korean',
                    'zh': 'chinese',
                    'ru': 'russian',
                    'vi': 'vietnamese',
                    'de': 'german',
                    'es': 'spanish',
                    'fr': 'french',
                    'it': 'italian',
                    'pt': 'portuguese',
                    'nl': 'dutch',
                    'pl': 'polish',
                    'tr': 'turkish',
                    'ar': 'arabic',
                    'hi': 'hindi',
                    'th': 'thai',
                    'id': 'indonesian',
                    'en': 'english'
                };

                let modeKey = 'english';
                try {
                    if (window.LyricsService?.detectLanguage) {
                        // LyricsService.detectLanguage는 배열을 받음
                        const detected = window.LyricsService.detectLanguage(lyricsData);
                        if (detected && langCodeToKey[detected]) {
                            modeKey = langCodeToKey[detected];
                        }
                        console.log(`[PanelLyrics] Detected language code: ${detected} -> modeKey: ${modeKey}`);
                    } else {
                        // 폴백: 간단한 유니코드 감지
                        if (/[\u3040-\u309F\u30A0-\u30FF]/.test(lyricsText)) {
                            modeKey = 'japanese';
                        } else if (/[\uAC00-\uD7AF]/.test(lyricsText)) {
                            modeKey = 'korean';
                        } else if (/[\u4E00-\u9FFF]/.test(lyricsText)) {
                            modeKey = 'chinese';
                        } else if (/[а-яА-ЯёЁ]/.test(lyricsText)) {
                            modeKey = 'russian';
                        }
                        console.log(`[PanelLyrics] Fallback language detection: ${modeKey}`);
                    }
                } catch (e) {
                    console.warn("[PanelLyrics] Language detection failed:", e);
                    // 폴백: 간단한 감지
                    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(lyricsText)) {
                        modeKey = 'japanese';
                    } else if (/[\uAC00-\uD7AF]/.test(lyricsText)) {
                        modeKey = 'korean';
                    } else if (/[\u4E00-\u9FFF]/.test(lyricsText)) {
                        modeKey = 'chinese';
                    }
                }

                // 사용자 설정에서 발음/번역 모드 확인
                const displayMode1 = window.CONFIG?.visual?.[`translation-mode:${modeKey}`] ||
                    localStorage.getItem(`ivLyrics:visual:translation-mode:${modeKey}`) || "none";
                const displayMode2 = window.CONFIG?.visual?.[`translation-mode-2:${modeKey}`] ||
                    localStorage.getItem(`ivLyrics:visual:translation-mode-2:${modeKey}`) || "none";

                console.log(`[PanelLyrics] Language: ${modeKey}, Mode1: ${displayMode1}, Mode2: ${displayMode2}`);

                // 발음/번역이 모두 비활성화되어 있으면 스킵
                if ((!displayMode1 || displayMode1 === "none") && (!displayMode2 || displayMode2 === "none")) {
                    console.log("[PanelLyrics] Translation/phonetic disabled for this language");
                    return;
                }

                // 발음이 필요한지, 번역이 필요한지 확인
                const needPhonetic = displayMode1 === "gemini_romaji" || displayMode2 === "gemini_romaji";
                const needTranslation = (displayMode1 && displayMode1 !== "none" && displayMode1 !== "gemini_romaji") ||
                    (displayMode2 && displayMode2 !== "none" && displayMode2 !== "gemini_romaji");

                console.log(`[PanelLyrics] Need phonetic: ${needPhonetic}, Need translation: ${needTranslation}`);

                let phoneticLines = [];
                let translationLines = [];

                // 발음 요청 (필요한 경우에만)
                if (needPhonetic) {
                    console.log("[PanelLyrics] Requesting phonetic...");
                    const phoneticResponse = await window.Translator.callGemini({
                        trackId,
                        artist: trackInfo.artist,
                        title: trackInfo.title,
                        text: lyricsText,
                        wantSmartPhonetic: true,
                        provider
                    });
                    phoneticLines = phoneticResponse?.phonetic || [];
                }

                // 번역 요청 (필요한 경우에만)
                if (needTranslation) {
                    console.log("[PanelLyrics] Requesting translation...");
                    const translationResponse = await window.Translator.callGemini({
                        trackId,
                        artist: trackInfo.artist,
                        title: trackInfo.title,
                        text: lyricsText,
                        wantSmartPhonetic: false,
                        provider
                    });
                    translationLines = translationResponse?.vi || [];
                }

                // 결과 병합
                if (phoneticLines.length > 0 || translationLines.length > 0) {
                    const updatedLyrics = lyricsData.map((line, idx) => ({
                        ...line,
                        originalText: line.text || line.originalText || '',
                        text: phoneticLines[idx] || line.text || '',
                        text2: translationLines[idx] || line.text2 || ''
                    }));

                    console.log("[PanelLyrics] Applied translation:", phoneticLines.length, "phonetic,", translationLines.length, "translation");
                    setLyrics(updatedLyrics);
                    currentLyricsState.lyrics = updatedLyrics;
                }
            } catch (error) {
                console.warn("[PanelLyrics] Translation failed:", error);
                // 발음/번역 실패해도 가사는 이미 표시됨
            }
        }, []);

        // 가사 로드 및 곡 변경 리스너
        useEffect(() => {
            // 곡 변경 시 가사 로드
            const handleSongChange = () => {
                // 약간의 딜레이 후 로드 (트랙 정보가 완전히 업데이트될 때까지 대기)
                setTimeout(() => {
                    loadLyricsFromExtension(true);
                }, 300);
            };

            // 설정 변경 리스너
            const handleSettingsChange = (event) => {
                if (event.detail?.name === 'panel-lyrics-enabled') {
                    setIsEnabled(event.detail.value);
                }
                if (event.detail?.name === 'panel-lyrics-lines') {
                    setNumLines(parseInt(event.detail.value, 10) || DEFAULT_LINES);
                }
                if (event.detail?.name === 'panel-font-scale') {
                    setFontScale(parseInt(event.detail.value, 10) || DEFAULT_FONT_SCALE);
                }
            };

            // 싱크 오프셋 변경 리스너
            const handleOffsetChange = (event) => {
                const currentUri = Spicetify.Player.data?.item?.uri;
                if (event.detail?.trackUri === currentUri) {
                    setTrackOffset(event.detail.offset || 0);
                    console.log("[PanelLyrics] Offset changed:", event.detail.offset);
                }
            };

            // 곡 변경 리스너
            Spicetify.Player.addEventListener('songchange', handleSongChange);
            window.addEventListener('ivLyrics', handleSettingsChange);
            window.addEventListener('ivLyrics:offset-changed', handleOffsetChange);

            // 초기 로드 (현재 재생 중인 곡)
            loadLyricsFromExtension();

            return () => {
                Spicetify.Player.removeEventListener('songchange', handleSongChange);
                window.removeEventListener('ivLyrics', handleSettingsChange);
                window.removeEventListener('ivLyrics:offset-changed', handleOffsetChange);
            };
        }, [loadLyricsFromExtension]);

        // 앨범 색상을 가져와서 카드 배경에 적용
        useEffect(() => {
            const updateBackgroundColor = async () => {
                try {
                    const trackUri = Spicetify.Player.data?.item?.uri;
                    if (!trackUri) return;

                    // Spotify에서 앨범 색상 추출
                    let vibrantColor = null;
                    try {
                        const { fetchExtractedColorForTrackEntity } = Spicetify.GraphQL.Definitions;
                        const { data } = await Spicetify.GraphQL.Request(
                            fetchExtractedColorForTrackEntity,
                            { uri: trackUri }
                        );
                        const { hex } = data.trackUnion.albumOfTrack.coverArt.extractedColors.colorDark;
                        vibrantColor = hex;
                    } catch {
                        // GraphQL 실패 시 CosmosAsync 시도
                        try {
                            const colors = await Spicetify.CosmosAsync.get(
                                `https://spclient.wg.spotify.com/colorextractor/v1/extract-presets?uri=${trackUri}&format=json`
                            );
                            const colorInt = colors.entries[0].color_swatches.find(
                                (color) => color.preset === "VIBRANT_NON_ALARMING"
                            )?.color;
                            if (colorInt) {
                                const r = (colorInt >> 16) & 255;
                                const g = (colorInt >> 8) & 255;
                                const b = colorInt & 255;
                                vibrantColor = `rgb(${r}, ${g}, ${b})`;
                            }
                        } catch {
                            // 색상 추출 실패
                        }
                    }

                    // CSS 변수로 색상 적용
                    if (vibrantColor) {
                        // 색상을 약간 어둡게 하고 투명도 추가
                        const section = document.querySelector('.ivlyrics-panel-lyrics-section');
                        if (section) {
                            // hex를 rgba로 변환
                            let r, g, b;
                            if (vibrantColor.startsWith('#')) {
                                r = parseInt(vibrantColor.slice(1, 3), 16);
                                g = parseInt(vibrantColor.slice(3, 5), 16);
                                b = parseInt(vibrantColor.slice(5, 7), 16);
                            } else if (vibrantColor.startsWith('rgb')) {
                                const match = vibrantColor.match(/(\d+),\s*(\d+),\s*(\d+)/);
                                if (match) {
                                    r = parseInt(match[1]);
                                    g = parseInt(match[2]);
                                    b = parseInt(match[3]);
                                }
                            }
                            if (r !== undefined) {
                                // 약간 어둡게 조정
                                r = Math.floor(r * 0.7);
                                g = Math.floor(g * 0.7);
                                b = Math.floor(b * 0.7);
                                section.style.setProperty('--ivlyrics-panel-bg-color', `rgba(${r}, ${g}, ${b}, 0.85)`);
                                section.style.background = `rgba(${r}, ${g}, ${b}, 0.85)`;
                            }
                        }
                    }
                } catch (error) {
                    console.error('[NowPlayingPanelLyrics] Failed to get album color:', error);
                }
            };

            // 초기 색상 적용
            updateBackgroundColor();

            // 곡 변경 시 색상 업데이트
            Spicetify.Player.addEventListener('songchange', updateBackgroundColor);

            return () => {
                Spicetify.Player.removeEventListener('songchange', updateBackgroundColor);
            };
        }, []);

        // 현재 재생 위치 추적 및 노래방 가사 타이밍 업데이트
        // 최적화: 상태 업데이트 최소화, DOM 직접 조작으로 노래방 하이라이트
        useEffect(() => {
            let lastIndex = currentIndex;
            let lastEventTime = 0;
            const EVENT_THROTTLE = 50; // 이벤트 발생 간격 (ms) - 노래방 업데이트용

            const updatePosition = () => {
                if (!lyrics || lyrics.length === 0) {
                    animationRef.current = requestAnimationFrame(updatePosition);
                    return;
                }

                const position = Spicetify.Player.getProgress();
                const globalDelay = parseInt(getStorageValue('ivLyrics:visual:delay', '0'), 10) || 0;
                // 글로벌 딜레이 + 곡별 싱크 오프셋 적용
                const adjustedPosition = position + globalDelay + trackOffset;

                // 전역 변수에 현재 시간 저장 (KaraokeWord에서 읽음)
                window._ivLyricsPanelCurrentTime = adjustedPosition;

                // 노래방 가사 업데이트 이벤트 발생 (throttled)
                const now = performance.now();
                if (now - lastEventTime >= EVENT_THROTTLE) {
                    lastEventTime = now;
                    window.dispatchEvent(new Event('ivlyrics-panel-time-update'));
                }

                // 현재 라인 찾기
                let newIndex = 0;
                for (let i = 0; i < lyrics.length; i++) {
                    if (lyrics[i].startTime !== undefined && lyrics[i].startTime <= adjustedPosition) {
                        newIndex = i;
                    } else if (lyrics[i].startTime > adjustedPosition) {
                        break;
                    }
                }

                // 라인이 변경될 때만 상태 업데이트 (리렌더링 최소화)
                if (newIndex !== lastIndex) {
                    lastIndex = newIndex;
                    setCurrentIndex(newIndex);
                }

                animationRef.current = requestAnimationFrame(updatePosition);
            };

            if (isEnabled && lyrics.length > 0) {
                animationRef.current = requestAnimationFrame(updatePosition);
            }

            return () => {
                if (animationRef.current) {
                    cancelAnimationFrame(animationRef.current);
                }
                // 전역 변수 정리
                window._ivLyricsPanelCurrentTime = 0;
            };
        }, [lyrics, isEnabled, trackOffset]); // currentIndex 의존성 제거

        // 스크롤 애니메이션 비활성화 - Now Playing 탭 스크롤 문제 방지
        // useEffect(() => {
        //     if (!scrollRef.current || !isEnabled) return;
        //     const activeElement = scrollRef.current.querySelector('.ivlyrics-panel-line.active');
        //     if (activeElement) {
        //         activeElement.scrollIntoView({
        //             behavior: 'smooth',
        //             block: 'center'
        //         });
        //     }
        // }, [currentIndex, isEnabled]);

        // 표시할 가사 라인들 계산
        // 노래방 가사는 line 객체에 syllables 또는 vocals 포함
        // 항상 numLines 개수만큼 표시 (빈 줄은 투명 placeholder로)
        const visibleLines = useMemo(() => {
            if (!lyrics || lyrics.length === 0) return [];

            const halfLines = Math.floor(numLines / 2);
            const lines = [];

            // 항상 numLines 개수만큼 표시
            for (let offset = -halfLines; offset <= halfLines; offset++) {
                const i = currentIndex + offset;

                if (i < 0 || i >= lyrics.length) {
                    // 범위 밖: 빈 placeholder 추가 (높이 유지)
                    lines.push({
                        index: `placeholder-${offset}`,
                        line: { text: '\u00A0' }, // non-breaking space
                        originalText: '\u00A0',
                        phonetic: '',
                        translation: '',
                        isActive: false,
                        isPast: offset < 0,
                        isFuture: offset > 0,
                        isPlaceholder: true
                    });
                } else {
                    const line = lyrics[i];
                    // originalText = 원어, text = 발음, text2 = 번역
                    const originalText = line?.originalText || line?.text || '';
                    const phonetic = (line?.originalText && line?.text !== line?.originalText) ? line?.text : '';
                    const translation = line?.text2 || '';

                    lines.push({
                        index: i,
                        line: line, // 노래방 가사용 전체 line 객체
                        originalText: originalText,
                        phonetic: phonetic,
                        translation: translation,
                        isActive: i === currentIndex,
                        isPast: i < currentIndex,
                        isFuture: i > currentIndex,
                        isPlaceholder: false
                    });
                }
            }

            return lines;
        }, [lyrics, currentIndex, numLines]);

        // currentTime은 더 이상 상태로 관리하지 않음 (전역 변수 window._ivLyricsPanelCurrentTime 사용)

        // ivLyrics 페이지로 이동
        const handleContainerClick = useCallback(() => {
            Spicetify.Platform.History.push('/ivLyrics');
        }, []);

        // 폰트 스케일 스타일
        const containerStyle = useMemo(() => ({
            '--ivlyrics-font-scale': fontScale / 100
        }), [fontScale]);

        // 비활성화 또는 가사 없음
        if (!isEnabled) return null;
        if (!lyrics || lyrics.length === 0) {
            return react.createElement("div", {
                className: PANEL_SECTION_CLASS,
                ref: containerRef,
                onClick: handleContainerClick,
                style: containerStyle
            },
                react.createElement("div", { className: "ivlyrics-panel-header" },
                    react.createElement("h2", null, "ivLyrics")
                ),
                react.createElement("div", { className: "ivlyrics-panel-empty" },
                    "가사를 불러오는 중..."
                )
            );
        }

        return react.createElement("div", {
            className: PANEL_SECTION_CLASS,
            ref: containerRef,
            onClick: handleContainerClick,
            style: containerStyle
        },
            // 헤더
            react.createElement("div", { className: "ivlyrics-panel-header" },
                react.createElement("h2", null, "ivLyrics")
            ),
            // 가사 컨테이너
            react.createElement("div", {
                className: "ivlyrics-panel-lyrics-wrapper",
                ref: scrollRef
            },
                visibleLines.map((visLine, idx) =>
                    react.createElement(LyricLine, {
                        key: `${visLine.index}-${idx}`,
                        line: visLine.line,
                        isActive: visLine.isActive,
                        isPast: visLine.isPast,
                        isFuture: visLine.isFuture,
                        translation: visLine.translation,
                        phonetic: visLine.phonetic,
                        isPlaceholder: visLine.isPlaceholder
                    })
                )
            )
        );
    };

    // ============================================
    // 패널 감지 및 삽입
    // ============================================
    const findNowPlayingPanel = () => {
        // Spotify의 Now Playing View 패널 찾기
        // 여러 가지 선택자 시도
        const selectors = [
            '.main-nowPlayingView-section',
            '[data-testid="NPV_Panel_OpenDiv"]',
            '.main-nowPlayingWidget-nowPlayingWidget',
            '.iHa_q9pq4un3VNRQgwTx'
        ];

        for (const selector of selectors) {
            const panel = document.querySelector(selector);
            if (panel) {
                return panel.closest('.main-nowPlayingView-nowPlayingGrid')
                    || panel.closest('.main-nowPlayingView-nowPlayingWidget')
                    || panel.parentElement;
            }
        }

        return null;
    };

    const insertPanelLyrics = () => {
        // 이미 존재하면 스킵
        if (document.querySelector(`.${PANEL_CONTAINER_CLASS}`)) {
            return;
        }

        // ivLyrics 페이지에 있으면 삽입하지 않음
        if (window.location.pathname === '/ivLyrics' ||
            document.querySelector('[data-testid="ivlyrics-page"]')) {
            return;
        }

        const panel = findNowPlayingPanel();
        if (!panel) {
            return;
        }

        // CSS 스타일 주입 (처음 한 번만)
        injectStyles();

        // 컨테이너 생성
        const container = document.createElement('div');
        container.className = PANEL_CONTAINER_CLASS;

        // 곡 정보 (곡명, 아티스트) 바로 **아래**에 삽입
        // Now Playing 패널 구조:
        // main-nowPlayingView-nowPlayingGrid
        //   ├── main-nowPlayingView-coverArtContainer (동영상/앨범아트)
        //   ├── 동영상 전환 버튼
        //   ├── main-nowPlayingView-contextItemInfo (곡제목+아티스트+버튼들)
        //   └── main-nowPlayingView-section (관련 뮤직비디오 등)
        //
        // 가사는 main-nowPlayingView-contextItemInfo 바로 **다음**에 삽입해야 함

        // contextItemInfo 찾기 (곡제목, 아티스트, 버튼들을 포함하는 컨테이너)
        const contextItemInfo = panel.querySelector('.main-nowPlayingView-contextItemInfo');

        if (contextItemInfo && contextItemInfo.parentElement) {
            // contextItemInfo 바로 다음에 삽입
            const parent = contextItemInfo.parentElement;
            const nextSibling = contextItemInfo.nextElementSibling;
            if (nextSibling) {
                parent.insertBefore(container, nextSibling);
            } else {
                parent.appendChild(container);
            }
            console.log("[NowPlayingPanelLyrics] Inserted after contextItemInfo");
        } else {
            // 폴백: 관련 뮤직비디오 섹션 앞에 삽입
            const relatedSection = panel.querySelector('.main-nowPlayingView-section');
            if (relatedSection && relatedSection.parentElement) {
                relatedSection.parentElement.insertBefore(container, relatedSection);
                console.log("[NowPlayingPanelLyrics] Inserted before related section");
            } else {
                // 최종 폴백: 패널 끝에 삽입
                panel.appendChild(container);
                console.log("[NowPlayingPanelLyrics] Used fallback - appended to panel");
            }
        }

        // React 렌더링
        try {
            const ReactDOM = Spicetify.ReactDOM;
            if (ReactDOM.createRoot) {
                // React 18+
                lyricsRoot = ReactDOM.createRoot(container);
                lyricsRoot.render(react.createElement(PanelLyrics));
            } else {
                // React 17 이하
                ReactDOM.render(react.createElement(PanelLyrics), container);
                lyricsRoot = container;
            }
            console.log("[NowPlayingPanelLyrics] Panel lyrics inserted successfully");
        } catch (error) {
            console.error("[NowPlayingPanelLyrics] Failed to render:", error);
        }
    };

    const removePanelLyrics = () => {
        const container = document.querySelector(`.${PANEL_CONTAINER_CLASS}`);
        if (container) {
            try {
                if (lyricsRoot && typeof lyricsRoot.unmount === 'function') {
                    lyricsRoot.unmount();
                } else {
                    Spicetify.ReactDOM.unmountComponentAtNode(container);
                }
            } catch (e) {
                // Ignore unmount errors
            }
            container.remove();
            lyricsRoot = null;
        }
    };

    // ============================================
    // MutationObserver 설정
    // ============================================
    const setupObserver = () => {
        if (panelObserver) {
            panelObserver.disconnect();
        }

        panelObserver = new MutationObserver((mutations) => {
            // 패널이 열렸는지 확인
            const panel = findNowPlayingPanel();
            const container = document.querySelector(`.${PANEL_CONTAINER_CLASS}`);

            if (panel && !container) {
                // 패널이 있지만 가사가 없으면 삽입
                setTimeout(insertPanelLyrics, 100);
            } else if (!panel && container) {
                // 패널이 없지만 컨테이너가 있으면 제거
                removePanelLyrics();
            }
        });

        // body 전체 감시 (패널이 동적으로 생성됨)
        panelObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    };

    // ============================================
    // 가사 데이터 수신 및 전달
    // ============================================
    const setupLyricsListener = () => {
        // 트랙 변경 감지
        Spicetify.Player.addEventListener('songchange', () => {
            currentLyricsState.lyrics = [];
            currentLyricsState.currentIndex = 0;
            currentLyricsState.trackUri = Spicetify.Player.data?.item?.uri;
        });
    };

    // ============================================
    // ivLyrics 페이지 감지 및 body 클래스 관리
    // ============================================
    const updateIvLyricsPageState = () => {
        // 1. URL 기반 감지
        const isUrlIvLyrics = window.location.pathname === '/ivLyrics' ||
            window.location.pathname.startsWith('/ivLyrics/');

        // 2. data-testid 기반 감지
        const hasTestId = document.querySelector('[data-testid="ivlyrics-page"]') !== null;

        // 3. lyrics-lyricsContainer-LyricsContainer 클래스 감지 (ivLyrics 메인 컨테이너)
        const hasLyricsContainer = document.querySelector('.lyrics-lyricsContainer-LyricsContainer') !== null;

        const isOnIvLyricsPage = isUrlIvLyrics || hasTestId || hasLyricsContainer;

        if (isOnIvLyricsPage) {
            document.body.classList.add('ivlyrics-page-active');
        } else {
            document.body.classList.remove('ivlyrics-page-active');
        }
    };

    const setupPageDetection = () => {
        // 초기 상태 확인
        updateIvLyricsPageState();

        // Spicetify History 변경 감지 (URL 변경)
        if (Spicetify.Platform?.History) {
            Spicetify.Platform.History.listen(() => {
                // 약간의 지연 후 확인 (DOM이 업데이트될 시간 확보)
                setTimeout(updateIvLyricsPageState, 100);
            });
        }

        // MutationObserver로 DOM 변경 감지 (lyrics-lyricsContainer-LyricsContainer 클래스 포함)
        const pageObserver = new MutationObserver((mutations) => {
            // 클래스 변경이나 새 요소 추가 시 상태 업데이트
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // 새로 추가된 노드 중 lyrics 컨테이너가 있는지 확인
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) { // Element node
                            if (node.classList?.contains('lyrics-lyricsContainer-LyricsContainer') ||
                                node.querySelector?.('.lyrics-lyricsContainer-LyricsContainer')) {
                                updateIvLyricsPageState();
                                return;
                            }
                        }
                    }
                    // 제거된 노드 확인
                    for (const node of mutation.removedNodes) {
                        if (node.nodeType === 1) {
                            if (node.classList?.contains('lyrics-lyricsContainer-LyricsContainer') ||
                                node.querySelector?.('.lyrics-lyricsContainer-LyricsContainer')) {
                                updateIvLyricsPageState();
                                return;
                            }
                        }
                    }
                }
            }
            updateIvLyricsPageState();
        });

        // main-view 영역 감시 (전체 body 감시로 확장)
        const mainView = document.querySelector('.Root__main-view') || document.body;
        pageObserver.observe(mainView, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-testid', 'class']
        });
    };

    // ============================================
    // 초기화
    // ============================================
    const init = () => {
        console.log("[NowPlayingPanelLyrics] Initializing...");

        // 설정 체크
        const isEnabled = getStorageValue(STORAGE_KEY, DEFAULT_ENABLED);
        if (!isEnabled) {
            console.log("[NowPlayingPanelLyrics] Disabled by settings");
            return;
        }

        // 페이지 감지 설정 (ivLyrics 페이지인지 확인)
        setupPageDetection();

        // Observer 설정
        setupObserver();

        // 가사 리스너 설정
        setupLyricsListener();

        // 초기 삽입 시도
        setTimeout(insertPanelLyrics, 1000);

        // 설정 변경 리스너
        window.addEventListener('ivLyrics', (event) => {
            if (event.detail?.name === 'panel-lyrics-enabled') {
                if (event.detail.value) {
                    setupObserver();
                    insertPanelLyrics();
                } else {
                    if (panelObserver) panelObserver.disconnect();
                    removePanelLyrics();
                }
            }
        });

        console.log("[NowPlayingPanelLyrics] Initialized successfully");
    };

    // 초기화 실행
    init();

    // 전역 접근용 (디버깅/설정)
    window.NowPlayingPanelLyrics = {
        insert: insertPanelLyrics,
        remove: removePanelLyrics,
        isEnabled: () => getStorageValue(STORAGE_KEY, DEFAULT_ENABLED),
        setEnabled: (enabled) => {
            setStorageValue(STORAGE_KEY, enabled);
            if (enabled) {
                insertPanelLyrics();
            } else {
                removePanelLyrics();
            }
        },
        updateLyrics: (lyrics, index) => {
            currentLyricsState.lyrics = lyrics || [];
            currentLyricsState.currentIndex = index || 0;
            window.dispatchEvent(new CustomEvent('ivlyrics-panel-lyrics-update', {
                detail: {
                    lyrics: currentLyricsState.lyrics,
                    currentIndex: currentLyricsState.currentIndex
                }
            }));
        }
    };

})();
