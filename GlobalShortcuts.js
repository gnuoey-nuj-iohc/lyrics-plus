// GlobalShortcuts.js - Spotify 전역에서 작동하는 단축키
// subfiles_extension으로 로드되어 페이지에 구애받지 않고 작동

(function GlobalShortcuts() {
    // 설정 키 (개별 설정은 직접 키 이름으로 저장됨)
    const FULLSCREEN_KEY_SETTING = "ivLyrics:visual:fullscreen-key";
    const DEFAULT_KEY = "f12";

    // 전체화면 모드 내에서 작동하는 단축키 설정 키
    const TOGGLE_TV_MODE_KEY = "ivLyrics:visual:toggle-tv-mode-key";
    const DEFAULT_TOGGLE_TV_KEY = "t";

    // 전체화면 단축키 가져오기
    const getFullscreenKey = () => {
        try {
            const stored = Spicetify.LocalStorage.get(FULLSCREEN_KEY_SETTING);
            return stored || DEFAULT_KEY;
        } catch (e) {
            return DEFAULT_KEY;
        }
    };

    // TV 모드 전환 단축키 가져오기
    const getToggleTvKey = () => {
        try {
            const stored = Spicetify.LocalStorage.get(TOGGLE_TV_MODE_KEY);
            return stored || DEFAULT_TOGGLE_TV_KEY;
        } catch (e) {
            return DEFAULT_TOGGLE_TV_KEY;
        }
    };

    // 현재 ivLyrics 페이지에 있는지 확인
    const isOnLyricsPage = () => {
        const pathname = Spicetify.Platform?.History?.location?.pathname || "";
        return pathname.includes("/ivLyrics");
    };

    // 전체화면 모드인지 확인
    const isInFullscreenMode = () => {
        // 1. lyricContainer의 state 확인 (가장 정확)
        if (window.lyricContainer?.state?.isFullscreen) {
            return true;
        }
        // 2. fullscreen-container가 body에 있는지 확인
        if (document.getElementById('lyrics-fullscreen-container')) {
            return true;
        }
        // 3. fullscreen-active 클래스 확인 (fallback)
        const container = document.querySelector('.lyrics-lyricsContainer-LyricsContainer.fullscreen-active');
        return !!container;
    };

    // 전역 Mousetrap 인스턴스
    let globalMousetrap = null;
    let currentBoundKey = null;
    let currentToggleTvKey = null;

    // 전체화면 진입 전 페이지 저장 (GlobalShortcuts를 통해 진입한 경우만)
    let previousPathBeforeFullscreen = null;

    // 전체화면 토글 함수 (LyricsContainer가 있으면 해당 메서드 사용, 없으면 직접 처리)
    const toggleFullscreen = () => {
        // LyricsContainer가 있으면 해당 toggle 사용 (ivLyrics 페이지에 있든 없든)
        if (window.lyricContainer && typeof window.lyricContainer.toggleFullscreen === 'function') {
            window.lyricContainer.toggleFullscreen();
            return;
        }

        // LyricsContainer가 없으면 ivLyrics 페이지로 이동 후 전체화면
        if (!window.lyricContainer) {
            // 현재 경로 저장 (나중에 돌아오기 위해)
            const currentPath = Spicetify.Platform?.History?.location?.pathname || "";
            if (!currentPath.includes("/ivLyrics")) {
                previousPathBeforeFullscreen = currentPath;
                // 전역으로 저장 (index.js에서 접근 가능하도록)
                window._ivLyricsPreviousPath = currentPath;
            }

            // 먼저 ivLyrics 페이지로 이동
            Spicetify.Platform?.History?.push?.("/ivLyrics");

            // 약간의 딜레이 후 전체화면 토글
            setTimeout(() => {
                if (window.lyricContainer && typeof window.lyricContainer.toggleFullscreen === 'function') {
                    window.lyricContainer.toggleFullscreen();
                }
            }, 300);
        }
    };

    // TV 모드 토글 함수 (전체화면 모드에서만 작동)
    const toggleTvMode = () => {
        if (!isInFullscreenMode()) {
            console.debug("[ivLyrics] TV mode toggle ignored - not in fullscreen mode");
            return;
        }

        // TV 모드 설정 토글
        const currentValue = Spicetify.LocalStorage.get("ivLyrics:visual:fullscreen-tv-mode") === "true";
        const newValue = !currentValue;

        console.debug("[ivLyrics] Toggling TV mode:", currentValue, "->", newValue);

        // LocalStorage에 저장
        Spicetify.LocalStorage.set("ivLyrics:visual:fullscreen-tv-mode", newValue.toString());

        // CONFIG 업데이트 (있으면)
        if (typeof window.CONFIG !== 'undefined' && window.CONFIG.visual) {
            window.CONFIG.visual["fullscreen-tv-mode"] = newValue;
        }

        // 이벤트 발생하여 UI 업데이트
        window.dispatchEvent(new CustomEvent("ivLyrics", {
            detail: { name: "fullscreen-tv-mode", value: newValue }
        }));

        // lyricContainer가 있으면 forceUpdate 호출
        if (window.lyricContainer && typeof window.lyricContainer.forceUpdate === 'function') {
            window.lyricContainer.forceUpdate();
        }

        // 컨테이너 클래스 업데이트 (fullscreen-container 내부의 컨테이너 찾기)
        const fullscreenContainer = document.getElementById('lyrics-fullscreen-container');
        const container = fullscreenContainer?.querySelector('.lyrics-lyricsContainer-LyricsContainer') 
            || document.querySelector('.lyrics-lyricsContainer-LyricsContainer.fullscreen-active');
        if (container) {
            if (newValue) {
                container.classList.add('tv-mode-active');
            } else {
                container.classList.remove('tv-mode-active');
            }
        }
    };

    // 전체화면 종료 시 이전 페이지로 돌아가기
    const goBackToPreviousPage = () => {
        if (previousPathBeforeFullscreen) {
            Spicetify.Platform?.History?.push?.(previousPathBeforeFullscreen);
            previousPathBeforeFullscreen = null;
            window._ivLyricsPreviousPath = null;
        }
    };

    // 전체화면 종료 이벤트 리스너 (index.js에서 발생시킴)
    window.addEventListener("ivLyrics:fullscreen-closed", () => {
        goBackToPreviousPage();
    });

    // 입력 필드 체크
    const isInputFocused = () => {
        const activeElement = document.activeElement;
        const tagName = activeElement?.tagName?.toLowerCase();
        const isEditable = activeElement?.isContentEditable;
        return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || isEditable;
    };

    // 단축키 바인딩 업데이트
    const updateKeyBinding = () => {
        if (!globalMousetrap) return;

        const newKey = getFullscreenKey();

        // 기존 바인딩이 있고 키가 변경되었으면 해제
        if (currentBoundKey && currentBoundKey !== newKey) {
            globalMousetrap.unbind(currentBoundKey);
        }

        // 새 키 바인딩
        if (newKey) {
            globalMousetrap.bind(newKey, (e) => {
                if (isInputFocused()) return;
                e.preventDefault();
                toggleFullscreen();
            });
            currentBoundKey = newKey;
        }
    };

    // TV 모드 단축키 바인딩 업데이트
    const updateTvModeKey = () => {
        if (!globalMousetrap) return;

        const newToggleTvKey = getToggleTvKey();

        // 기존 바인딩 해제
        if (currentToggleTvKey && currentToggleTvKey !== newToggleTvKey) {
            globalMousetrap.unbind(currentToggleTvKey);
        }

        // TV 모드 전환 키 (전체화면 모드에서만 작동)
        if (newToggleTvKey) {
            globalMousetrap.bind(newToggleTvKey, (e) => {
                if (isInputFocused()) return;
                if (!isInFullscreenMode()) return;

                e.preventDefault();
                toggleTvMode();
            });
            currentToggleTvKey = newToggleTvKey;
        }
    };

    // 초기화
    const init = () => {
        // Mousetrap이 준비될 때까지 대기
        if (!Spicetify.Mousetrap) {
            setTimeout(init, 300);
            return;
        }

        // 전역 Mousetrap 인스턴스 생성
        globalMousetrap = new Spicetify.Mousetrap(document);

        // 초기 바인딩
        updateKeyBinding();
        updateTvModeKey();

        // 설정 변경 감지
        window.addEventListener("ivLyrics", (event) => {
            if (event.detail?.name === "fullscreen-key") {
                updateKeyBinding();
            }
            if (event.detail?.name === "toggle-tv-mode-key") {
                updateTvModeKey();
            }
            // PlaybarButton에서 전체화면 버튼 클릭 시 발생하는 이벤트 처리
            if (event.detail?.type === "fullscreen-toggle") {
                toggleFullscreen();
            }
        });

        // 설정 저장 시 바인딩 업데이트를 위한 Storage 이벤트 리스너
        // (다른 탭에서 변경된 경우를 위해)
        const checkKeyChange = () => {
            const newKey = getFullscreenKey();
            const newToggleTvKey = getToggleTvKey();

            if (newKey !== currentBoundKey) {
                updateKeyBinding();
            }
            if (newToggleTvKey !== currentToggleTvKey) {
                updateTvModeKey();
            }
        };

        // 5초마다 설정 변경 확인 (Storage 이벤트가 작동하지 않을 경우 대비)
        setInterval(checkKeyChange, 5000);

        console.debug("[ivLyrics] Global shortcuts initialized");
    };

    // Spicetify가 준비되면 초기화
    if (Spicetify.Platform && Spicetify.LocalStorage) {
        init();
    } else {
        // Spicetify가 준비될 때까지 대기
        const waitForSpicetify = setInterval(() => {
            if (Spicetify.Platform && Spicetify.LocalStorage) {
                clearInterval(waitForSpicetify);
                init();
            }
        }, 100);

        // 10초 이내에 준비되지 않으면 포기
        setTimeout(() => clearInterval(waitForSpicetify), 10000);
    }
})();
