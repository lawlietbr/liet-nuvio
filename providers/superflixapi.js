const BASE_URL = "https://superflixapi.rest";
const CDN_BASE = "https://llanfairpwllgwyngy.com";

let SESSION_DATA = {
    cookies: '',
    csrfToken: '',
    pageToken: ''
};

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'pt-BR',
    'Referer': 'https://lospobreflix.site/',
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive'
};

const API_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': BASE_URL,
    'Connection': 'keep-alive'
};

function updateCookies(response) {
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
        SESSION_DATA.cookies = setCookie;
    }
}

function getCookieHeader() {
    return SESSION_DATA.cookies ? { 'Cookie': SESSION_DATA.cookies } : {};
}

const ITAG_QUALITY_MAP = {
    18: 360,
    22: 720,
    37: 1080,
    59: 480
};

function getRandomUserAgent() {
    return 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36';
}

function decodeUrl(url) {
    let decoded = url;
    decoded = decoded.replace(/\\\//g, '/');
    decoded = decoded.replace(/\\\\/g, '\\');
    decoded = decoded.replace(/\\=/g, '=');
    decoded = decoded.replace(/\\&/g, '&');
    decoded = decoded.replace(/\\"/g, '"');
    if (decoded.endsWith('\\')) decoded = decoded.slice(0, -1);
    return decoded.trim();
}

function extractItagFromUrl(url) {
    const patterns = [
        /itag[=?&](\d+)/,
        /itag%3D(\d+)/,
        /itag\\u003d(\d+)/
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            const itag = parseInt(match[1]);
            if (!isNaN(itag)) return itag;
        }
    }
    
    if (url.includes('itag=22')) return 22;
    if (url.includes('itag=18')) return 18;
    if (url.includes('itag=37')) return 37;
    if (url.includes('itag=59')) return 59;
    return 18;
}

function extractVideoId(url) {
    const match = url.match(/id=([a-f0-9]+)/);
    return match ? match[1] : 'picasacid';
}

function extractTokenFromUrl(url) {
    const match = url.match(/token=([a-zA-Z0-9_\-]+)/);
    return match ? match[1] : null;
}

function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function generateCpn(token, videoId, timestamp) {
    const seed = `boq_bloggeruiserver_20260223.02_p0${videoId}${timestamp}${token}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(seed);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashBase64 = btoa(String.fromCharCode.apply(null, hashArray));
    return hashBase64.substring(0, 16).replace(/[+/=]/g, '');
}

async function extractBloggerVideo(bloggerUrl, referer, serverType, quality, title, callback) {
    const token = extractTokenFromUrl(bloggerUrl);
    if (!token) return false;
    
    const apiUrl = 'https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute';
    const reqid = Math.floor(Math.random() * 90000) + 10000;
    const fSid = '-7535563745894756252';
    const bl = 'boq_bloggeruiserver_20260223.02_p0';
    
    const headers = {
        'authority': 'www.blogger.com',
        'accept': '*/*',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'origin': 'https://www.blogger.com',
        'referer': 'https://www.blogger.com/',
        'user-agent': getRandomUserAgent(),
        'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99", "Microsoft Edge Simulate";v="127", "Lemur";v="127"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'x-client-data': 'COjuygE=',
        'x-same-domain': '1'
    };
    
    const urlWithParams = `${apiUrl}?rpcids=WcwnYd&source-path=%2Fvideo.g&f.sid=${fSid}&bl=${bl}&hl=pt-BR&_reqid=${reqid}&rt=c`;
    
    const body = `f.req=%5B%5B%5B%22WcwnYd%22%2C%22%5B%5C%22${token}%5C%22%2C%5C%22%5C%22%2C0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D`;
    
    const response = await fetch(urlWithParams, {
        method: 'POST',
        headers: headers,
        body: body
    });
    
    if (!response.ok) return false;
    
    const responseText = await response.text();
    const videoUrls = extractVideoUrlsFromResponse(responseText);
    
    if (videoUrls.length === 0) return false;
    
    const timestamp = Date.now();
    
    for (const [videoUrl, itag] of videoUrls) {
        const videoQuality = ITAG_QUALITY_MAP[itag] || 480;
        const videoId = extractVideoId(videoUrl);
        const cpn = await generateCpn(token, videoId, timestamp);
        
        let urlBase = decodeUrl(videoUrl);
        let urlFinal = urlBase;
        
        if (urlBase.includes('?')) {
            urlFinal = `${urlBase}&cpn=${cpn}&c=WEB_EMBEDDED_PLAYER&cver=1.20260224.08.00`;
        } else {
            urlFinal = `${urlBase}?cpn=${cpn}&c=WEB_EMBEDDED_PLAYER&cver=1.20260224.08.00`;
        }
        
        callback({
            name: `SuperFlix ${serverType} ${videoQuality}p`,
            title: title,
            url: urlFinal,
            quality: videoQuality,
            headers: {
                'Referer': 'https://youtube.googleapis.com/',
                'User-Agent': getRandomUserAgent(),
                'Accept': '*/*',
                'Accept-Language': 'pt-BR',
                'Range': 'bytes=0-',
                'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99", "Microsoft Edge Simulate";v="127", "Lemur";v="127"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'video',
                'sec-fetch-mode': 'no-cors',
                'sec-fetch-site': 'cross-site'
            }
        });
    }
    
    return true;
}

function extractVideoUrlsFromResponse(response) {
    const videos = [];
    
    let data = response.replace(/^\)\]\}'\n/, '');
    
    const jsonPattern = /\[\s*\[\s*"wrb\.fr"\s*,\s*"[^"]*"\s*,\s*"(.+?)"\s*\]/s;
    const match = data.match(jsonPattern);
    
    if (match) {
        let jsonStr = match[1];
        jsonStr = jsonStr.replace(/\\"/g, '"');
        jsonStr = jsonStr.replace(/\\\\/g, '\\');
        jsonStr = decodeUnicodeEscapes(jsonStr);
        
        const urlPattern = /"((?:https?:\\\/\\\/)?[^"]+?googlevideo[^"]+?)",\[(\d+)\]/g;
        let urlMatch;
        while ((urlMatch = urlPattern.exec(jsonStr)) !== null) {
            let url = urlMatch[1];
            const itag = parseInt(urlMatch[2]);
            url = decodeUrl(url);
            videos.push([url, itag]);
        }
        
        if (videos.length === 0) {
            const simplePattern = /https?:\\?\/\\?\/[^"'\s]+?googlevideo[^"'\s]+/g;
            let simpleMatch;
            while ((simpleMatch = simplePattern.exec(jsonStr)) !== null) {
                let url = simpleMatch[0];
                if (!url.startsWith('http')) url = 'https://' + url;
                url = decodeUrl(url);
                const itag = extractItagFromUrl(url);
                videos.push([url, itag]);
            }
        }
    }
    
    const qualityOrder = [37, 22, 18, 59];
    videos.sort((a, b) => {
        const indexA = qualityOrder.indexOf(a[1]);
        const indexB = qualityOrder.indexOf(b[1]);
        return indexA - indexB;
    });
    
    const seen = new Set();
    return videos.filter(([url, itag]) => {
        const key = `${url}_${itag}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function decodeUnicodeEscapes(text) {
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const targetSeason = mediaType === 'movie' ? 1 : season;
    const targetEpisode = mediaType === 'movie' ? 1 : episode;
    const results = [];
    
    try {
        let pageUrl;
        if (mediaType === 'movie') {
            pageUrl = `${BASE_URL}/filme/${tmdbId}`;
        } else {
            pageUrl = `${BASE_URL}/serie/${tmdbId}/${targetSeason}/${targetEpisode}`;
        }
        
        const pageResponse = await fetch(pageUrl, {
            headers: { ...HEADERS, ...getCookieHeader() }
        });
        
        if (!pageResponse.ok) return [];
        updateCookies(pageResponse);
        
        let html = await pageResponse.text();
        
        let finalHtml = html;
        if (!html.includes('var CSRF_TOKEN') && !html.includes('<!DOCTYPE')) {
            const altResponse = await fetch(pageUrl, {
                headers: {
                    ...HEADERS,
                    ...getCookieHeader(),
                    'Accept-Encoding': 'gzip, deflate'
                }
            });
            if (altResponse.ok) {
                updateCookies(altResponse);
                finalHtml = await altResponse.text();
            }
        }
        
        const csrfMatch = finalHtml.match(/var CSRF_TOKEN\s*=\s*["']([^"']+)["']/);
        if (!csrfMatch) return [];
        SESSION_DATA.csrfToken = csrfMatch[1];
        
        const pageMatch = finalHtml.match(/var PAGE_TOKEN\s*=\s*["']([^"']+)["']/);
        if (!pageMatch) return [];
        SESSION_DATA.pageToken = pageMatch[1];
        
        let contentId = null;
        
        if (mediaType === 'movie') {
            const initialContentMatch = finalHtml.match(/INITIAL_CONTENT_ID\s*=\s*(\d+)/);
            if (initialContentMatch) {
                contentId = initialContentMatch[1];
            } else {
                const dataContentMatch = finalHtml.match(/data-contentid=["'](\d+)["']/);
                if (dataContentMatch) contentId = dataContentMatch[1];
            }
        } else {
            const epMatch = finalHtml.match(/var ALL_EPISODES\s*=\s*(\{.*?\});/s);
            if (epMatch) {
                const episodes = JSON.parse(epMatch[1]);
                const seasonData = episodes[targetSeason.toString()];
                if (seasonData) {
                    for (let i = 0; i < seasonData.length; i++) {
                        if (seasonData[i].epi_num === targetEpisode) {
                            contentId = seasonData[i].ID?.toString();
                            break;
                        }
                    }
                }
            }
        }
        
        if (!contentId) return [];
        
        const optionsParams = new URLSearchParams();
        optionsParams.append('contentid', contentId);
        optionsParams.append('type', mediaType === 'movie' ? 'filme' : 'serie');
        optionsParams.append('_token', SESSION_DATA.csrfToken);
        optionsParams.append('page_token', SESSION_DATA.pageToken);
        optionsParams.append('pageToken', SESSION_DATA.pageToken);
        
        const optionsResponse = await fetch(`${BASE_URL}/player/options`, {
            method: 'POST',
            headers: {
                ...API_HEADERS,
                'X-Page-Token': SESSION_DATA.pageToken,
                'Referer': pageUrl,
                ...getCookieHeader()
            },
            body: optionsParams.toString()
        });
        
        if (!optionsResponse.ok) return [];
        
        const optionsData = await optionsResponse.json();
        const optionsArray = optionsData?.data?.options || [];
        
        for (let i = 0; i < optionsArray.length; i++) {
            const option = optionsArray[i];
            const videoId = option.ID;
            const serverType = option.type === 1 ? 'Dublado' : (option.type === 2 ? 'Legendado' : `Tipo ${option.type}`);
            
            const sourceParams = new URLSearchParams();
            sourceParams.append('video_id', videoId);
            sourceParams.append('page_token', SESSION_DATA.pageToken);
            sourceParams.append('_token', SESSION_DATA.csrfToken);
            
            const sourceResponse = await fetch(`${BASE_URL}/player/source`, {
                method: 'POST',
                headers: {
                    ...API_HEADERS,
                    'Referer': pageUrl,
                    ...getCookieHeader()
                },
                body: sourceParams.toString()
            });
            
            if (!sourceResponse.ok) continue;
            
            const sourceData = await sourceResponse.json();
            const redirectUrl = sourceData?.data?.video_url;
            
            if (!redirectUrl) continue;
            
            const redirectResponse = await fetch(redirectUrl, {
                method: 'GET',
                headers: {
                    ...HEADERS,
                    ...getCookieHeader()
                },
                redirect: 'manual'
            });
            
            const location = redirectResponse.headers.get('location');
            const finalUrl = location || redirectResponse.url;
            
            if (!redirectResponse.ok && !location) continue;
            
            if (finalUrl.includes('blogger.com/video.g') || finalUrl.includes('blogger.com')) {
                const title = mediaType === 'movie' ? `Filme ${tmdbId}` : `S${targetSeason.toString().padStart(2, '0')}E${targetEpisode.toString().padStart(2, '0')}`;
                
                await extractBloggerVideo(finalUrl, pageUrl, serverType, 720, title, (stream) => {
                    results.push(stream);
                });
                continue;
            }
            
            const playerHash = finalUrl.split('/').pop();
            
            const videoParams = new URLSearchParams();
            videoParams.append('hash', playerHash);
            videoParams.append('r', '');
            
            const videoResponse = await fetch(`${CDN_BASE}/player/index.php?data=${playerHash}&do=getVideo`, {
                method: 'POST',
                headers: {
                    'Accept': '*/*',
                    'Accept-Language': 'pt-BR',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Origin': CDN_BASE,
                    'Referer': `${CDN_BASE}/`,
                    'X-Requested-With': 'XMLHttpRequest',
                    'User-Agent': HEADERS['User-Agent']
                },
                body: videoParams.toString()
            });
            
            if (!videoResponse.ok) continue;
            
            const videoData = await videoResponse.json();
            const videoUrl = videoData.securedLink || videoData.videoSource;
            
            if (!videoUrl) continue;
            
            let quality = 720;
            if (videoUrl.includes('2160') || videoUrl.includes('4k')) quality = 2160;
            else if (videoUrl.includes('1440')) quality = 1440;
            else if (videoUrl.includes('1080')) quality = 1080;
            else if (videoUrl.includes('720')) quality = 720;
            else if (videoUrl.includes('480')) quality = 480;
            
            let title;
            if (mediaType === 'movie') {
                title = `Filme ${tmdbId}`;
            } else {
                title = `S${targetSeason.toString().padStart(2, '0')}E${targetEpisode.toString().padStart(2, '0')}`;
            }
            
            results.push({
                name: `SuperFlix ${serverType} ${quality}p`,
                title: title,
                url: videoUrl,
                quality: quality,
                headers: {
                    'Referer': `${CDN_BASE}/`,
                    'User-Agent': HEADERS['User-Agent']
                }
            });
        }
        
        return results;
        
    } catch (error) {
        return [];
    }
}

module.exports = { getStreams };
