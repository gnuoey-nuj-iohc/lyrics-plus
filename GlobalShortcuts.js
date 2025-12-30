// GlobalShortcuts.js - Spotify 전역에서 작동하는 단축키
// subfiles_extension으로 로드되어 페이지에 구애받지 않고 작동

(function GlobalShortcuts() {
    // 설정 키 (개별 설정은 직접 키 이름으로 저장됨)
    const FULLSCREEN_KEY_SETTING = "ivLyrics:visual:fullscreen-key";
    const DEFAULT_KEY = "f12";

    // 전체화면 단축키 가져오기
    const getFullscreenKey = () => {
        try {
            const stored = Spicetify.LocalStorage.get(FULLSCREEN_KEY_SETTING);
            return stored || DEFAULT_KEY;
        } catch (e) {
            return DEFAULT_KEY;
        }
    };

    // 현재 ivLyrics 페이지에 있는지 확인
    const isOnLyricsPage = () => {
        const pathname = Spicetify.Platform?.History?.location?.pathname || "";
        return pathname.includes("/ivLyrics");
    };

    // 전역 Mousetrap 인스턴스
    let globalMousetrap = null;
    let currentBoundKey = null;

    // 전체화면 진입 전 페이지 저장 (GlobalShortcuts를 통해 진입한 경우만)
    let previousPathBeforeFullscreen = null;

    // 전체화면 토글 함수 (LyricsContainer가 있으면 해당 메서드 사용, 없으면 직접 처리)
    const toggleFullscreen = () => {
        // ivLyrics 페이지에 있으면, LyricsContainer가 처리하도록 함
        if (isOnLyricsPage() && window.lyricContainer) {
            // 이미 index.js에서 처리하므로 중복 방지
            return;
        }

        // ivLyrics 페이지가 아닐 때 전체화면 요청
        // LyricsContainer가 있으면 해당 toggle 사용
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
                // 입력 필드에서는 무시
                const activeElement = document.activeElement;
                const tagName = activeElement?.tagName?.toLowerCase();
                const isEditable = activeElement?.isContentEditable;

                if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || isEditable) {
                    return;
                }

                e.preventDefault();
                toggleFullscreen();
            });
            currentBoundKey = newKey;
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

        // 설정 변경 감지
        window.addEventListener("ivLyrics", (event) => {
            if (event.detail?.name === "fullscreen-key") {
                updateKeyBinding();
            }
        });

        // 설정 저장 시 바인딩 업데이트를 위한 Storage 이벤트 리스너
        // (다른 탭에서 변경된 경우를 위해)
        const checkKeyChange = () => {
            const newKey = getFullscreenKey();
            if (newKey !== currentBoundKey) {
                updateKeyBinding();
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
