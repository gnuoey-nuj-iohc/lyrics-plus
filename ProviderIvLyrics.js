const ProviderIvLyrics = (() => {
	/**
	 * ivLyrics API를 통해 가사를 검색합니다.
	 * 
	 * @param {Object} info - 트랙 정보 객체
	 * @param {string} info.uri - Spotify 트랙 URI (형식: "spotify:track:TRACK_ID")
	 * @returns {Promise<Object>} 가사 데이터 객체 또는 에러 객체
	 * 
	 * @example
	 * const lyrics = await ProviderIvLyrics.findLyrics({
	 *   uri: "spotify:track:7GVUmCP00eSsqc4tzj1sDD"
	 * });
	 */
	async function findLyrics(info) {
		const trackId = info.uri.split(":")[2];
		
		if (!trackId) {
			console.warn('[ProviderIvLyrics] Invalid track URI:', info.uri);
			return {
				error: "Invalid track URI",
				uri: info.uri,
			};
		}

		// ApiTracker에 현재 트랙 설정 (트랙 변경 감지)
		if (window.ApiTracker) {
			window.ApiTracker.setCurrentTrack(trackId);
		}

		// 1. 로컬 캐시 먼저 확인 (API 호출 절약)
		try {
			const cached = await LyricsCache.getLyrics(trackId);
			if (cached) {
				console.log(`[ProviderIvLyrics] Using local cache for ${trackId}`);
				// 캐시 히트 로깅
				if (window.ApiTracker) {
					window.ApiTracker.logCacheHit('lyrics', `lyrics:${trackId}`, {
						provider: cached.provider,
						lyrics_type: cached.lyrics_type,
						lineCount: cached.synced?.length || cached.unsynced?.length || 0
					});
				}
				return cached;
			}
		} catch (e) {
			console.warn('[ProviderIvLyrics] Cache check failed:', e);
		}

		// 2. API 호출
		const userHash = Utils.getUserHash();
		const baseURL = `https://lyrics.api.ivl.is/lyrics?trackId=${trackId}&userHash=${userHash}`;

		// API 요청 로깅 시작
		let logId = null;
		if (window.ApiTracker) {
			logId = window.ApiTracker.logRequest('lyrics', baseURL, { trackId, userHash });
		}

		try {
			// API 요청 전에 트랙이 변경되었는지 확인
			// ApiTracker의 현재 트랙과 요청한 trackId가 일치하는지 검증
			if (window.ApiTracker) {
				const currentTrack = window.ApiTracker.getCurrentTrack?.();
				if (currentTrack && currentTrack !== trackId) {
					console.warn(`[ProviderIvLyrics] Track changed during request. Requested: ${trackId}, Current: ${currentTrack}`);
					// 트랙이 변경되었으면 요청 취소
					if (window.ApiTracker && logId) {
						window.ApiTracker.logResponse(logId, null, 'error', 'Track changed during request');
					}
					return {
						error: "Track changed during request",
						uri: info.uri,
					};
				}
			}

			const body = await fetch(baseURL, {
				headers: {
					"User-Agent": `spicetify v${Spicetify.Config.version} (https://github.com/spicetify/cli)`,
				},
				cache: "no-cache",  // 브라우저 HTTP 캐시 우회
			});

			// 응답 후에도 트랙이 변경되었는지 다시 확인
			if (window.ApiTracker) {
				const currentTrack = window.ApiTracker.getCurrentTrack?.();
				if (currentTrack && currentTrack !== trackId) {
					console.warn(`[ProviderIvLyrics] Track changed after request. Requested: ${trackId}, Current: ${currentTrack}`);
					if (window.ApiTracker && logId) {
						window.ApiTracker.logResponse(logId, null, 'error', 'Track changed after request');
					}
					return {
						error: "Track changed after request",
						uri: info.uri,
					};
				}
			}

			if (body.status !== 200) {
				const errorResult = {
					error: "Request error: Track wasn't found",
					uri: info.uri,
				};
				// 에러 로깅
				if (window.ApiTracker && logId) {
					window.ApiTracker.logResponse(logId, { status: body.status }, 'error', `HTTP ${body.status}`);
				}
				return errorResult;
			}

			const response = await body.json();

			if (response.error) {
				// API 에러 로깅
				if (window.ApiTracker && logId) {
					window.ApiTracker.logResponse(logId, response, 'error', response.error);
				}
				return {
					error: response.error,
					uri: info.uri,
				};
			}

			// 성공 로깅
			if (window.ApiTracker && logId) {
				window.ApiTracker.logResponse(logId, {
					provider: response.provider,
					lyrics_type: response.lyrics_type,
					source: response.source,
					lineCount: response.synced?.length || response.unsynced?.length || 0
				}, 'success');
			}

			// 3. 로컬 캐시에 저장 (백그라운드)
			LyricsCache.setLyrics(trackId, response).catch(() => { });

			return response;
		} catch (e) {
			// 네트워크 에러 로깅
			if (window.ApiTracker && logId) {
				window.ApiTracker.logResponse(logId, null, 'error', e.message);
			}
			throw e;
		}
	}

	/**
	 * 응답 본문에서 비동기 가사를 추출합니다.
	 * 
	 * @param {Object} body - API 응답 본문
	 * @param {string} body.lyrics_type - 가사 타입 ("synced", "unsynced", "word_by_word")
	 * @param {string} body.lyrics - 가사 텍스트 (JSON 또는 문자열)
	 * @returns {Array<Object>|null} 비동기 가사 배열 또는 null
	 */
	function getUnsynced(body) {
		if (body.error) return null;

		if (body.lyrics_type === "synced") {
			const parsed = Utils.parseLocalLyrics(body.lyrics);
			return parsed.unsynced;
		} else if (body.lyrics_type === "unsynced") {
			return Utils.parseLocalLyrics(body.lyrics).unsynced;
		} else if (body.lyrics_type === "word_by_word") {
			const lyrics = JSON.parse(body.lyrics);
			return lyrics.map(line => ({
				text: line.x
			}));
		}

		return null;
	}

	/**
	 * 응답 본문에서 동기화된 가사를 추출합니다.
	 * 
	 * @param {Object} body - API 응답 본문
	 * @param {string} body.lyrics_type - 가사 타입 ("synced", "unsynced", "word_by_word")
	 * @param {string} body.lyrics - 가사 텍스트 (JSON 또는 문자열)
	 * @returns {Array<Object>|null} 동기화된 가사 배열 (startTime 포함) 또는 null
	 */
	function getSynced(body) {
		if (body.error) return null;

		if (body.lyrics_type === "synced") {
			const parsed = Utils.parseLocalLyrics(body.lyrics);
			return parsed.synced;
		} else if (body.lyrics_type === "word_by_word") {
			const lyrics = JSON.parse(body.lyrics);
			return lyrics.map(line => ({
				startTime: Math.round(line.ts * 1000),
				text: line.x
			}));
		}

		return null;
	}

	/**
	 * 응답 본문에서 가라오케(단어 단위 동기화) 가사를 추출합니다.
	 * 
	 * @param {Object} body - API 응답 본문
	 * @param {string} body.lyrics_type - 가사 타입 (반드시 "word_by_word")
	 * @param {string} body.lyrics - 가사 JSON 문자열
	 * @returns {Array<Object>|null} 가라오케 가사 배열 (syllables 포함) 또는 null
	 * 
	 * @description
	 * 가라오케 가사는 단어별/음절별 타이밍 정보를 포함합니다.
	 * 여러 보컬 트랙(리드/백그라운드)을 지원합니다.
	 */
	function getKaraoke(body) {
		if (body.error) return null;

		if (body.lyrics_type === "word_by_word") {
			const lyrics = JSON.parse(body.lyrics);
			const result = lyrics.map(line => {
				const lineStartTime = Math.round(line.ts * 1000);
				const lineEndTime = Math.round(line.te * 1000);

				if (!line.l || line.l.length === 0) {
					return {
						startTime: lineStartTime,
						endTime: lineEndTime,
						text: line.x,
						syllables: [{
							text: line.x,
							startTime: lineStartTime,
							endTime: lineEndTime
						}]
					};
				}

				// Separate vocals by timing groups
				const vocalGroups = [];
				let currentGroup = [];
				let lastEndTime = 0;

				line.l.forEach((syllable, index) => {
					const syllableStartTime = Math.round((line.ts + syllable.o) * 1000);
					const nextSyllable = line.l[index + 1];
					const syllableEndTime = nextSyllable
						? Math.round((line.ts + nextSyllable.o) * 1000)
						: lineEndTime;

					// Check if this syllable starts significantly after the last one ended
					const gap = syllableStartTime - lastEndTime;
					const isNewVocalGroup = gap > 500 && currentGroup.length > 0; // 500ms gap threshold

					if (isNewVocalGroup) {
						vocalGroups.push([...currentGroup]);
						currentGroup = [];
					}

					currentGroup.push({
						text: syllable.c,
						startTime: syllableStartTime,
						endTime: syllableEndTime
					});

					lastEndTime = syllableEndTime;
				});

				if (currentGroup.length > 0) {
					vocalGroups.push(currentGroup);
				}

				// If we have multiple vocal groups, structure them as lead + background
				if (vocalGroups.length > 1) {
					return {
						startTime: lineStartTime,
						endTime: lineEndTime,
						text: line.x,
						vocals: {
							lead: {
								startTime: vocalGroups[0][0].startTime,
								endTime: vocalGroups[0][vocalGroups[0].length - 1].endTime,
								syllables: vocalGroups[0]
							},
							background: vocalGroups.slice(1).map(group => ({
								startTime: group[0].startTime,
								endTime: group[group.length - 1].endTime,
								syllables: group
							}))
						}
					};
				} else {
					// Single vocal track
					return {
						startTime: lineStartTime,
						endTime: lineEndTime,
						text: line.x,
						syllables: vocalGroups[0] || [{
							text: line.x,
							startTime: lineStartTime,
							endTime: lineEndTime
						}]
					};
				}
			});

			return result;
		}

		return null;
	}

	return { findLyrics, getSynced, getUnsynced, getKaraoke };
})();