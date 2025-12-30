/**
 * Song Info TMI Component
 * - Fullscreen TMI view when album art is clicked
 */

const SongInfoTMI = (() => {
    const { useState, useEffect, useRef, useCallback, useMemo } = Spicetify.React;

    // Cache for TMI data
    const tmiCache = new Map();

    // Simple markdown bold parser
    const renderMarkdown = (text) => {
        if (!text) return null;
        const parts = text.split(/(\*\*.*?\*\*)/);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return react.createElement("strong", { key: i }, part.slice(2, -2));
            }
            return part;
        });
    };

    // Fetch song info from backend
    async function fetchSongInfo(trackId, regenerate = false) {
        // Check cache first (skip if regenerating)
        if (!regenerate && tmiCache.has(trackId)) {
            return tmiCache.get(trackId);
        }

        const lang = CONFIG.visual["language"] || 'en';
        const userHash = Utils.getUserHash();
        let url = `https://lyrics.api.ivl.is/lyrics/song_info?trackId=${trackId}&userHash=${userHash}&lang=${lang}`;

        if (regenerate) {
            url += `&regenerate=true&_ts=${Date.now()}`;
        }

        try {
            let apiKey = CONFIG.visual?.["gemini-api-key"];
            if (apiKey && apiKey.trim().startsWith('[')) {
                try {
                    const keys = JSON.parse(apiKey);
                    if (Array.isArray(keys) && keys.length > 0) {
                        apiKey = keys[Math.floor(Math.random() * keys.length)];
                    }
                } catch (e) { }
            }

            const fetchOptions = {
                headers: {
                    "User-Agent": `spicetify v${Spicetify.Config.version}`,
                    "X-IvLyrics-Gemini-Key": apiKey || ""
                }
            };

            if (regenerate) {
                fetchOptions.cache = 'no-store';
                fetchOptions.headers['Pragma'] = 'no-cache';
                fetchOptions.headers['Cache-Control'] = 'no-cache';
            }

            const response = await fetch(url, fetchOptions);
            const data = await response.json();
            
            // Check for error response from backend
            if (response.status !== 200 || data?.error) {
                const errorMsg = data?.error || `HTTP ${response.status}`;
                // Return error object instead of null
                return { error: true, message: errorMsg };
            }
            
            // Cache the result
            if (data?.track) {
                tmiCache.set(trackId, data);
            }
            return data;
        } catch (e) {
            console.error('[SongInfoTMI] Fetch failed:', e);
            return { error: true, message: e.message || 'Network error' };
        }
    }

    // Full TMI View Component (replaces left panel content)
    const TMIFullView = react.memo(({ info, onClose, trackName, artistName, coverUrl, onRegenerate, tmiScale: propTmiScale }) => {
        // prop으로 받은 tmiScale 사용, 없으면 CONFIG에서 가져옴
        const tmiScale = propTmiScale ?? (CONFIG?.visual?.["fullscreen-tmi-font-size"] || 100) / 100;
        
        // Handle error state
        if (info?.error) {
            const isQuotaError = info.message?.includes('429') || info.message?.includes('quota') || info.message?.includes('RESOURCE_EXHAUSTED');
            return react.createElement("div", { 
                className: "tmi-fullview tmi-fullview-error",
                style: { "--tmi-scale": tmiScale }
            },
                react.createElement("div", { className: "tmi-fullview-header" },
                    coverUrl && react.createElement("img", {
                        src: coverUrl,
                        className: "tmi-fullview-cover"
                    }),
                    react.createElement("div", { className: "tmi-fullview-info" },
                        react.createElement("span", { className: "tmi-fullview-label" }, I18n.t("tmi.title")),
                        react.createElement("h2", { className: "tmi-fullview-track" }, trackName),
                        react.createElement("p", { className: "tmi-fullview-artist" }, artistName)
                    )
                ),
                react.createElement("div", { className: "tmi-fullview-content tmi-error-content" },
                    react.createElement("div", { className: "tmi-error-icon" }, "⚠️"),
                    react.createElement("p", { className: "tmi-error-message" }, 
                        isQuotaError ? I18n.t("tmi.errorQuota") : I18n.t("tmi.errorFetch")
                    ),
                    isQuotaError && react.createElement("p", { className: "tmi-error-hint" }, I18n.t("tmi.errorQuotaHint"))
                ),
                react.createElement("div", { className: "tmi-fullview-footer" },
                    onRegenerate && react.createElement("button", {
                        className: "tmi-btn-regenerate",
                        onClick: onRegenerate,
                        title: I18n.t("tmi.regenerate")
                    },
                        react.createElement("span", { style: { fontSize: "18px", lineHeight: 1 } }, "↻")
                    ),
                    react.createElement("button", {
                        className: "tmi-btn-close",
                        onClick: onClose
                    },
                        react.createElement("span", null, "✕"),
                        react.createElement("span", null, I18n.t("tmi.close"))
                    )
                )
            );
        }

        const triviaList = info?.track?.trivia || [];
        const description = info?.track?.description || '';

        return react.createElement("div", { 
            className: "tmi-fullview",
            style: { "--tmi-scale": tmiScale }
        },
            // Header
            react.createElement("div", { className: "tmi-fullview-header" },
                coverUrl && react.createElement("img", {
                    src: coverUrl,
                    className: "tmi-fullview-cover"
                }),
                react.createElement("div", { className: "tmi-fullview-info" },
                    react.createElement("div", { className: "tmi-header-top" },
                        react.createElement("span", { className: "tmi-fullview-label" }, I18n.t("tmi.title"))
                    ),
                    react.createElement("h2", { className: "tmi-fullview-track" }, trackName),
                    react.createElement("p", { className: "tmi-fullview-artist" }, artistName)
                )
            ),

            // Content - scrollable area
            react.createElement("div", { className: "tmi-fullview-content" },
                // Description
                description && react.createElement("div", { className: "tmi-fullview-description" },
                    react.createElement("p", null, renderMarkdown(description))
                ),

                // All Trivia items
                triviaList.length > 0 && react.createElement("div", { className: "tmi-fullview-trivia-list" },
                    react.createElement("div", { className: "tmi-fullview-trivia-label" }, I18n.t("tmi.didYouKnow")),
                    triviaList.map((item, i) => react.createElement("div", {
                        key: i,
                        className: "tmi-fullview-trivia-item"
                    },
                        react.createElement("span", { className: "tmi-trivia-bullet" }, "✦"),
                        react.createElement("span", { className: "tmi-trivia-text" }, renderMarkdown(item))
                    ))
                ),

                // No data fallback
                !description && triviaList.length === 0 && react.createElement("div", { className: "tmi-fullview-empty" },
                    react.createElement("p", null, I18n.t("tmi.noData"))
                )
            ),

            // Footer with buttons
            react.createElement("div", { className: "tmi-fullview-footer" },
                onRegenerate && react.createElement("button", {
                    className: "tmi-btn-regenerate",
                    onClick: onRegenerate,
                    title: I18n.t("tmi.regenerate")
                },
                    react.createElement("span", { style: { fontSize: "18px", lineHeight: 1 } }, "↻")
                ),
                react.createElement("button", {
                    className: "tmi-btn-close",
                    onClick: onClose
                },
                    react.createElement("span", null, "✕"),
                    react.createElement("span", null, I18n.t("tmi.close"))
                )
            )
        );
    });

    // Loading View
    const TMILoadingView = react.memo(({ onClose, tmiScale: propTmiScale }) => {
        // prop으로 받은 tmiScale 사용, 없으면 CONFIG에서 가져옴
        const tmiScale = propTmiScale ?? (CONFIG?.visual?.["fullscreen-tmi-font-size"] || 100) / 100;
        
        return react.createElement("div", { 
            className: "tmi-fullview tmi-fullview-loading",
            style: { "--tmi-scale": tmiScale }
        },
            react.createElement("div", { className: "tmi-fullview-header" },
                react.createElement("span", { className: "tmi-fullview-label" }, I18n.t("tmi.title"))
            ),
            react.createElement("div", { className: "tmi-fullview-content tmi-loading-content" },
                react.createElement("div", { className: "tmi-loading-spinner" }),
                react.createElement("p", null, I18n.t("tmi.loading"))
            ),
            react.createElement("div", { className: "tmi-fullview-footer" },
                react.createElement("button", {
                    className: "tmi-fullview-close-btn",
                    onClick: onClose
                },
                    react.createElement("span", null, "✕"),
                    react.createElement("span", null, I18n.t("tmi.cancel"))
                )
            )
        );
    });

    return { TMIFullView, TMILoadingView, fetchSongInfo, tmiCache };
})();

// Register globally
window.SongInfoTMI = SongInfoTMI;
