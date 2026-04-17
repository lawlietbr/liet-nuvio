const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const CDN_PROXY = 'https://ondemand.mylifekorea.shop';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://www.doramogo.net/'
};

const CACHE = {};

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
            headers: HEADERS
        });
        return response.ok || response.status === 206;
    } catch {
        return false;
    }
}

async function extractQualitiesFromM3u8(url) {
    try {
        const response = await fetch(url, { headers: HEADERS });
        const content = await response.text();
        
        const qualities = [];
        const lines = content.split('\n');
        const resolutionPattern = /RESOLUTION=(\d+)x(\d+)/;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = resolutionPattern.exec(line);
            
            if (match) {
                const height = parseInt(match[2]);
                let streamUrl = lines[i + 1]?.trim();
                
                if (streamUrl && !streamUrl.startsWith('http')) {
                    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
                    streamUrl = streamUrl.startsWith('/') 
                        ? new URL(streamUrl, url).href 
                        : baseUrl + streamUrl;
                }
                
                if (streamUrl && streamUrl.startsWith('http')) {
                    qualities.push({ url: streamUrl, height });
                }
            }
        }
        
        return qualities;
    } catch {
        return [];
    }
}

async function getTMDBTitle(tmdbId, mediaType) {
    const cacheKey = `${tmdbId}_${mediaType}`;
    if (CACHE[cacheKey]) return CACHE[cacheKey];

    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        const title = mediaType === 'tv' ? data.name : data.title;

        let ano = null;
        if (mediaType === 'tv' && data.first_air_date) {
            ano = data.first_air_date.substring(0, 4);
        } else if (mediaType === 'movie' && data.release_date) {
            ano = data.release_date.substring(0, 4);
        }

        CACHE[cacheKey] = { title, ano };
        return { title, ano };
    } catch {
        return null;
    }
}

function generateSlugVariations(baseTitle, season, ano) {
    const baseSlug = titleToSlug(baseTitle);
    const variations = [];
    const seen = {};

    function add(slug) {
        if (!seen[slug]) {
            seen[slug] = true;
            variations.push(slug);
        }
    }

    const words = baseSlug.split('-');

    add(baseSlug);

    if (ano) add(baseSlug + '-' + ano);

    add(baseSlug + '-legendado');
    add(baseSlug + '-dublado');

    if (ano) {
        add(baseSlug + '-' + ano + '-legendado');
        add(baseSlug + '-' + ano + '-dublado');
    }

    if (season > 1) {
        add(baseSlug + '-' + season);
        if (ano) add(baseSlug + '-' + ano + '-' + season);
    }

    if (words.length > 3) {
        for (let i = 3; i < words.length; i++) {
            const reduced = words.slice(0, i).join('-');
            add(reduced);
            if (ano) add(reduced + '-' + ano);
            if (season > 1) add(reduced + '-' + season);
        }
    }

    return variations;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const targetSeason = mediaType === 'movie' ? 1 : season;
    const targetEpisode = mediaType === 'movie' ? 1 : episode;
    const epPadded = targetEpisode.toString().padStart(2, '0');
    const seasonPadded = targetSeason.toString().padStart(2, '0');
    const timestamp = Date.now();

    const info = await getTMDBTitle(tmdbId, mediaType);
    if (!info) return [];

    const { title, ano } = info;

    const slugVariations = generateSlugVariations(title, targetSeason, ano);

    const masterUrls = [];
    const seen = new Set();

    for (const slug of slugVariations) {
        const firstLetter = slug.charAt(0).toUpperCase() || 'T';

        let masterUrl;
        if (mediaType === 'movie') {
            masterUrl = `${CDN_PROXY}/${firstLetter}/${slug}/stream/stream.m3u8?nocache=${timestamp}`;
        } else {
            masterUrl = `${CDN_PROXY}/${firstLetter}/${slug}/${seasonPadded}-temporada/${epPadded}/stream.m3u8?nocache=${timestamp}`;
        }
        
        if (!seen.has(masterUrl)) {
            seen.add(masterUrl);
            masterUrls.push(masterUrl);
        }
    }

    const allStreams = [];

    for (const masterUrl of masterUrls) {
        if (await testUrl(masterUrl)) {
            const qualities = await extractQualitiesFromM3u8(masterUrl);
            
            for (const qual of qualities) {
                const qualityName = `${qual.height}p`;
                allStreams.push({
                    url: qual.url,
                    headers: HEADERS,
                    name: `Doramogo - ${qualityName}`,
                    title: mediaType === 'movie' ? title : `${title} S${targetSeason} EP${targetEpisode}`,
                    quality: qual.height,
                    type: 'hls'
                });
            }
        }
    }

    allStreams.sort((a, b) => (b.quality || 0) - (a.quality || 0));
    
    return allStreams;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}