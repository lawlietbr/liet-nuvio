const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const CDN_BASE = 'https://cdn-s01.mywallpaper-4k-image.net';

function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

async function testUrl(url) {
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        return response.ok || response.status === 206;
    } catch (error) {
        return false;
    }
}

async function getTMDBEpisodeDate(tmdbId, season, episode) {
    const url = TMDB_BASE_URL + '/tv/' + tmdbId + '/season/' + season + '/episode/' + episode + '?api_key=' + TMDB_API_KEY;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return data.air_date ? new Date(data.air_date).getTime() : null;
    } catch {
        return null;
    }
}

async function getTMDBTitle(tmdbId) {
    const url = TMDB_BASE_URL + '/tv/' + tmdbId + '?api_key=' + TMDB_API_KEY + '&language=en-US';
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return data.name;
    } catch {
        return null;
    }
}

async function getTMDBSeasonsInfo(tmdbId) {
    const url = `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=seasons`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }
        });
        
        if (!response.ok) throw new Error("TMDB erro");
        const data = await response.json();
        
        const seasons = data.seasons || [];
        const seasonsInfo = [];
        let totalEpisodesBefore = 0;
        
        seasons.sort((a, b) => a.season_number - b.season_number);
        
        seasons.forEach(season => {
            if (season.season_number > 0) {
                seasonsInfo.push({
                    seasonNumber: season.season_number,
                    episodeCount: season.episode_count || 0,
                    totalBefore: totalEpisodesBefore
                });
                totalEpisodesBefore += season.episode_count || 0;
            }
        });
        
        return seasonsInfo;
    } catch (error) {
        return null;
    }
}

function calculateAbsoluteEpisode(seasonsInfo, targetSeason, targetEpisode) {
    if (!seasonsInfo || !seasonsInfo.length) return null;
    
    const seasonInfo = seasonsInfo.find(s => s.seasonNumber === targetSeason);
    if (!seasonInfo) return null;
    
    return seasonInfo.totalBefore + targetEpisode;
}

async function getAnimeDetails(animeId) {
    const query = `
        query ($id: Int) {
            Media(id: $id) {
                id
                title { romaji english }
                startDate { year month day }
                episodes
                relations {
                    edges {
                        node {
                            id
                            title { romaji english }
                            startDate { year month day }
                            episodes
                        }
                        relationType
                    }
                }
            }
        }
    `;

    const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { id: animeId } })
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.data ? data.data.Media : null;
}

function dateToTimestamp(date) {
    if (!date || !date.year) return null;
    return new Date(date.year, (date.month || 1) - 1, date.day || 1).getTime();
}

async function searchAnilistId(title) {
    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                id
            }
        }
    `;

    const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { search: title } })
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.data && data.data.Media ? data.data.Media.id : null;
}

function filterInvalidSeasons(seasons) {
    if (seasons.length <= 2) return seasons;
    
    const filtered = [];
    
    for (let i = 0; i < seasons.length; i++) {
        const season = seasons[i];
        const isLastSeason = i === seasons.length - 1;
        
        if (season.episodes <= 1) {
            if (i > 0 && !isLastSeason) {
                const prevSeason = seasons[i - 1];
                const nextSeason = seasons[i + 1];
                
                if (prevSeason.episodes > 1 && nextSeason.episodes > 1) {
                    continue;
                }
            }
        }
        
        filtered.push(season);
    }
    
    return filtered;
}

async function getAllSeasons(startId) {
    const allSeasons = [];
    const visited = new Set();

    async function followChain(animeId, seasonNum) {
        if (visited.has(animeId)) return;
        visited.add(animeId);

        await new Promise(r => setTimeout(r, 1000));

        const anime = await getAnimeDetails(animeId);
        if (!anime) return;

        allSeasons.push({
            id: animeId,
            title: anime.title.romaji || anime.title.english,
            date: dateToTimestamp(anime.startDate),
            season: seasonNum,
            episodes: anime.episodes || 0
        });

        const edges = anime.relations?.edges || [];
        for (const edge of edges) {
            if (edge.relationType === 'SEQUEL') {
                await followChain(edge.node.id, seasonNum + 1);
                break;
            }
        }
    }

    await followChain(startId, 1);

    allSeasons.sort((a, b) => (a.date || 0) - (b.date || 0));

    for (let i = 0; i < allSeasons.length; i++) {
        allSeasons[i].season = i + 1;
    }

    const filteredSeasons = filterInvalidSeasons(allSeasons);
    
    for (let i = 0; i < filteredSeasons.length; i++) {
        filteredSeasons[i].season = i + 1;
    }

    return filteredSeasons;
}

function findSeasonByDate(seasons, targetDate) {
    let closest = null;
    let minDiff = Infinity;

    for (const s of seasons) {
        if (!s.date) continue;
        const diff = Math.abs(targetDate - s.date);
        const days = diff / (1000 * 60 * 60 * 24);

        if (days < 180 && diff < minDiff) {
            minDiff = diff;
            closest = s;
        }
    }
    return closest;
}

function extractBaseTitle(fullTitle) {
    if (!fullTitle) return '';
    const cleaned = fullTitle.replace(/[:\s]*(?:Part|Parte)\s*\d+$/i, '').trim();
    if (!cleaned || cleaned.length < 3) return fullTitle;
    return cleaned;
}

function isSignificantTitle(specificTitle, baseTitle) {
    if (!specificTitle || !baseTitle) return false;
    if (specificTitle === baseTitle) return false;
    
    const baseSlug = titleToSlug(baseTitle);
    const specificSlug = titleToSlug(specificTitle);
    
    if (specificSlug.includes(baseSlug) && specificSlug.length - baseSlug.length < 10) {
        return false;
    }
    
    return true;
}

function analyzeParts(seasons, targetEpisode, episodeDate) {
    const closest = findSeasonByDate(seasons, episodeDate);
    if (!closest) return null;

    const groups = {};
    for (const s of seasons) {
        let base = s.title
            .replace(/[:\s]*(?:Part|Parte)\s*\d+$/i, '')
            .replace(/\s+\d+$/, '')
            .replace(/[:\s]*(?:Season|Cour)\s*\d+$/, '')
            .trim();
            
        if (base.length < 3) base = s.title;
        
        if (!groups[base]) groups[base] = [];
        groups[base].push(s);
    }

    for (const base in groups) {
        groups[base].sort((a, b) => (a.date || 0) - (b.date || 0));
    }

    for (const base in groups) {
        const group = groups[base];
        const index = group.findIndex(s => s.id === closest.id);
        
        if (index !== -1) {
            const hasMultipleParts = group.length > 1;
            const partNumber = index + 1;
            
            let episodesBefore = 0;
            for (let k = 0; k < index; k++) {
                episodesBefore += group[k].episodes;
            }
            
            const episodeInPart = targetEpisode - episodesBefore;

            return {
                id: closest.id,
                title: closest.title,
                date: closest.date,
                season: closest.season,
                episodes: closest.episodes,
                baseTitle: base,
                partNumber: partNumber,
                totalParts: group.length,
                hasMultipleParts: hasMultipleParts,
                episodesBefore: episodesBefore,
                episodeInPart: episodeInPart
            };
        }
    }

    return {
        id: closest.id,
        title: closest.title,
        date: closest.date,
        season: closest.season,
        episodes: closest.episodes,
        baseTitle: closest.title,
        partNumber: 1,
        totalParts: 1,
        hasMultipleParts: false,
        episodesBefore: 0,
        episodeInPart: targetEpisode
    };
}

function generateMinimalSlugs(seasonInfo, targetSeason) {
    const slugs = [];
    
    const baseTitle = seasonInfo.baseTitle || 
                   seasonInfo.title.replace(/[:\s]*(?:Part|Parte)?\s*\d+/i, '').trim();
    const baseSlug = titleToSlug(baseTitle);
    
    if (seasonInfo.hasMultipleParts) {
        if (seasonInfo.partNumber === 1) {
            slugs.push(baseSlug);
        } else {
            slugs.push(baseSlug + '-' + seasonInfo.partNumber);
        }
    } else {
        slugs.push(baseSlug);
    }
    
    if (targetSeason > 1) {
        slugs.push(baseSlug + '-' + targetSeason);
    }
    
    return [...new Set(slugs)];
}

function getAniListTitles(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbUrl = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;

    return fetch(tmdbUrl)
        .then(response => {
            if (!response.ok) throw new Error("TMDB erro");
            return response.json();
        })
        .then(tmdbData => {
            const searchTitle = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
            const query = `
                query ($search: String) {
                    Media(search: $search, type: ANIME) {
                        title { romaji english }
                        synonyms
                    }
                }`;
            return fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables: { search: searchTitle } })
            })
            .then(res => res.json())
            .then(anilistData => {
                const media = anilistData?.data?.Media;
                const titles = [];

                if (media?.title?.romaji) {
                    titles.push({ name: media.title.romaji, type: 'romaji' });
                }
                if (media?.title?.english && media.title.english !== media.title.romaji) {
                    titles.push({ name: media.title.english, type: 'english' });
                }
                if (media?.synonyms) {
                    for (const syn of media.synonyms) {
                        if (!titles.some(t => t.name.toLowerCase() === syn.toLowerCase())) {
                            titles.push({ name: syn, type: 'synonym' });
                        }
                    }
                }
                return titles;
            });
        });
}

function generateSlugVariations(baseTitle, season) {
    const baseSlug = titleToSlug(baseTitle);
    const variations = [];
    const seen = {};

    const add = (slug) => {
        if (!seen[slug]) {
            seen[slug] = true;
            variations.push(slug);
        }
    };

    const words = baseSlug.split('-');

    if (season === 1) {
        add(baseSlug);
    } else {
        add(baseSlug + '-' + season);
    }

    if (words.length > 3) {
        for (let i = 3; i < words.length; i++) {
            const reducedBase = words.slice(0, i).join('-');
            if (season === 1) {
                add(reducedBase);
            } else {
                add(reducedBase + '-' + season);
            }
        }
    }

    return variations;
}

function calculateContinuousEpisode(seasons, targetSeason, targetEpisode) {
    if (!seasons || seasons.length === 0) return null;
    
    const sortedSeasons = [...seasons].sort((a, b) => (a.season || 0) - (b.season || 0));
    
    let totalEpisodesBefore = 0;
    
    for (const season of sortedSeasons) {
        if (season.season < targetSeason) {
            totalEpisodesBefore += season.episodes || 0;
        }
    }
    
    if (totalEpisodesBefore > 0) {
        return totalEpisodesBefore + targetEpisode;
    }
    
    return null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const targetSeason = mediaType === 'movie' ? 1 : season;
    const targetEpisode = mediaType === 'movie' ? 1 : episode;
    const epPadded = targetEpisode.toString().padStart(2, '0');

    try {
        let validStreams = [];

        const titles = await getAniListTitles(tmdbId, mediaType);

        if (titles?.length > 0) {
            const streamMap = {};

            for (const titleInfo of titles) {
                if (titleInfo.type !== 'romaji' && titleInfo.type !== 'english') continue;

                const slugVariations = generateSlugVariations(titleInfo.name, targetSeason);

                for (const slug of slugVariations) {
                    const firstLetter = slug.charAt(0) || 't';
                    const key = `${titleInfo.name} (${titleInfo.type})`;

                    if (!streamMap[key]) streamMap[key] = [];
                    
                    streamMap[key].push({
                        url: `${CDN_BASE}/stream/${firstLetter}/${slug}/${epPadded}.mp4/index.m3u8`,
                        type: 'leg',
                        titleKey: titleInfo.name
                    });
                    
                    streamMap[key].push({
                        url: `${CDN_BASE}/stream/${firstLetter}/${slug}-dublado/${epPadded}.mp4/index.m3u8`,
                        type: 'dub',
                        titleKey: titleInfo.name
                    });
                }
            }

            const allUrls = Object.values(streamMap).flat();

            for (const item of allUrls) {
                if (await testUrl(item.url)) {
                    let originalTitle = '';
                    for (const key in streamMap) {
                        const found = streamMap[key].find(u => u.url === item.url);
                        if (found) {
                            originalTitle = key.split(' (')[0];
                            break;
                        }
                    }

                    validStreams.push({
                        url: item.url,
                        name: `My Wallpaper ${item.type === 'dub' ? 'Dublado' : 'Legendado'} 1080p`,
                        title: `${originalTitle} S${targetSeason} EP${targetEpisode}`,
                        quality: 1080,
                        type: 'hls'
                    });
                }
            }
        }

        if (validStreams.length === 0) {
            const seasonsInfo = await getTMDBSeasonsInfo(tmdbId);

            if (seasonsInfo?.length) {
                const absoluteEpisode = calculateAbsoluteEpisode(seasonsInfo, targetSeason, targetEpisode);

                if (absoluteEpisode) {
                    const absEpPadded = absoluteEpisode.toString().padStart(2, '0');
                    const animeTitle = await getTMDBTitle(tmdbId);
                    
                    if (animeTitle) {
                        const baseSlug = titleToSlug(animeTitle);
                        
                        const absoluteSlugs = [baseSlug];
                        
                        const words = baseSlug.split('-');
                        if (words.length > 3) {
                            for (let i = 3; i < words.length; i++) {
                                absoluteSlugs.push(words.slice(0, i).join('-'));
                            }
                        }
                        
                        const uniqueSlugs = [...new Set(absoluteSlugs)];

                        for (const slug of uniqueSlugs) {
                            const firstLetter = slug.charAt(0) || 't';

                            const legUrl = `${CDN_BASE}/stream/${firstLetter}/${slug}/${absEpPadded}.mp4/index.m3u8`;
                            if (await testUrl(legUrl)) {
                                validStreams.push({
                                    url: legUrl,
                                    name: "My Wallpaper Legendado 1080p",
                                    title: `${animeTitle} EP${absoluteEpisode}`,
                                    quality: 1080,
                                    type: 'hls'
                                });
                            }

                            const dubUrl = `${CDN_BASE}/stream/${firstLetter}/${slug}-dublado/${absEpPadded}.mp4/index.m3u8`;
                            if (await testUrl(dubUrl)) {
                                validStreams.push({
                                    url: dubUrl,
                                    name: "My Wallpaper Dublado 1080p",
                                    title: `${animeTitle} EP${absoluteEpisode}`,
                                    quality: 1080,
                                    type: 'hls'
                                });
                            }
                        }
                    }
                }
            }
        }

        if (validStreams.length === 0) {
            const episodeDate = await getTMDBEpisodeDate(tmdbId, targetSeason, targetEpisode);
            
            if (episodeDate) {
                const animeTitle = await getTMDBTitle(tmdbId);
                
                if (animeTitle) {
                    const anilistId = await searchAnilistId(animeTitle);
                    
                    if (anilistId) {
                        const allSeasons = await getAllSeasons(anilistId);
                        
                        if (allSeasons.length) {
                            const seasonInfo = analyzeParts(allSeasons, targetEpisode, episodeDate);
                            
                            if (seasonInfo) {
                                const slugs = generateMinimalSlugs(seasonInfo, targetSeason);
                                const testEpisode = seasonInfo.episodeInPart || targetEpisode;
                                const testEpPadded = testEpisode.toString().padStart(2, '0');

                                for (const slug of slugs) {
                                    const firstLetter = slug.charAt(0) || 't';

                                    const legUrl = `${CDN_BASE}/stream/${firstLetter}/${slug}/${testEpPadded}.mp4/index.m3u8`;
                                    if (await testUrl(legUrl)) {
                                        validStreams.push({
                                            url: legUrl,
                                            name: "My Wallpaper Legendado 1080p",
                                            title: `${seasonInfo.baseTitle} S${targetSeason} EP${targetEpisode}${seasonInfo.hasMultipleParts ? ` (Parte ${seasonInfo.partNumber})` : ''}`,
                                            quality: 1080,
                                            type: 'hls'
                                        });
                                    }

                                    const dubUrl = `${CDN_BASE}/stream/${firstLetter}/${slug}-dublado/${testEpPadded}.mp4/index.m3u8`;
                                    if (await testUrl(dubUrl)) {
                                        validStreams.push({
                                            url: dubUrl,
                                            name: "My Wallpaper Dublado 1080p",
                                            title: `${seasonInfo.baseTitle} S${targetSeason} EP${targetEpisode}${seasonInfo.hasMultipleParts ? ` (Parte ${seasonInfo.partNumber})` : ''}`,
                                            quality: 1080,
                                            type: 'hls'
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        validStreams.sort((a, b) => b.quality - a.quality);
        return validStreams;

    } catch (error) {
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
