// Constants
const MAX_RETRIES = 3;
const CACHE_CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 100;
const TIMEOUT_DURATION = 5000;
const TEST_IMAGE = '/img-master/img/2022/08/02/14/06/38/100177233_p0_master1200.jpg';

// Reverse proxy configuration
const reverseProxyPrefixs = [
    "https://pixiv.ciallo.link",
    "https://pixiv.mayx.eu.org",
    "https://i.yuki.sh",
];

// State
let indexData = [];
let currentArtwork = null;
let loading = false;
let errorState = {
    hasError: false,
    message: '',
    retryCount: 0,
    retryTimer: null  // 添加重试定时器
};
let proxyStatus = [];
const imageCache = new Map();
let isInitialized = false;  // 添加初始化状态标志

// Utility Functions
const loadImageWithTimeout = (url, timeout = TIMEOUT_DURATION) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timeoutId = setTimeout(() => {
            img.src = '';
            reject(new Error('Image load timeout'));
        }, timeout);

        img.onload = () => {
            clearTimeout(timeoutId);
            resolve(url);
        };

        img.onerror = () => {
            clearTimeout(timeoutId);
            reject(new Error('Image load failed'));
        };

        img.src = url;
    });
};

const updateUI = {
    loading: (isLoading) => {
        loading = isLoading;
        if (isLoading) {
            $('#loadingIndicator').removeClass('hidden');
            $('#nextImageBtn').prop('disabled', true);
        } else {
            $('#loadingIndicator').addClass('hidden');
            $('#nextImageBtn').prop('disabled', false);
        }
    },

    error: (show, message = '', retryCount = 0) => {
        if (show) {
            $('#errorState').removeClass('hidden');
            $('#errorMessage').text(message);
            $('#retryCount').text(`Attempt ${retryCount} of ${MAX_RETRIES}`);
            $('#loadingIndicator').addClass('hidden');  // 确保加载指示器被隐藏
        } else {
            $('#errorState').addClass('hidden');
        }
    },

    artwork: (data) => {
        if (!data) return;  // 添加空值检查
        
        $('#artworkPid')
            .text(data.pid || 'Unknown')
            .attr('href', data.pid ? `https://www.pixiv.net/artworks/${data.pid}` : '#');
        $('#artworkTitle').text(data.title || 'Untitled');
        $('#artworkAuthor').text(data.author || 'Unknown');
        
        // Update tags
        const $tags = $('#artworkTags').empty();
        const tags = Array.isArray(data.tags) ? data.tags : (data.tags || '').split(',');
        tags.forEach(tag => {
            if (tag.trim()) {
                $tags.append(
                    $('<span>')
                        .addClass('inline-block px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full')
                        .text(tag.trim())
                );
            }
        });
    },

    proxyStatus: (status) => {
        const availableCount = status.filter(p => p.status).length;
        $('#proxyStatusCount').text(
            `Available proxies: ${availableCount} / ${status.length}`
        );

        const $statusList = $('#proxyStatusList').empty();
        status.forEach(proxy => {
            $statusList.append(
                $('<div>')
                    .addClass(proxy.status ? 'text-green-700' : 'text-red-700')
                    .text(`${proxy.prefix}: ${proxy.status ? 'Available' : 'Not Available'}`)
            );
        });

        $('#proxyStatusBanner').toggleClass('hidden', status.length === 0);
    },

    reset: () => {
        // 重置所有UI元素到初始状态
        $('#artworkImage').attr('src', './images/loading.svg');
        $('#artworkPid').text('Loading...');
        $('#artworkTitle').text('Loading...');
        $('#artworkAuthor').text('Loading...');
        $('#artworkTags').empty();
        updateUI.error(false);
        updateUI.loading(false);
    }
};

// Core Functions
async function checkProxyStatus() {
    const results = await Promise.all(
        reverseProxyPrefixs.map(async (prefix) => {
            try {
                const testUrl = `${prefix}${TEST_IMAGE}`;
                await loadImageWithTimeout(testUrl, 3000);
                return { prefix, status: true };
            } catch {
                return { prefix, status: false };
            }
        })
    );

    proxyStatus = results;
    updateUI.proxyStatus(results);

    const availableProxies = results.filter(r => r.status).length;
    if (availableProxies === 0) {
        throw new Error('No working proxy servers available');
    }

    return results.filter(r => r.status).map(r => r.prefix);
}

async function tryLoadImage(url) {
    if (!url) throw new Error('Invalid image URL');
    
    const normalizedUrl = url.startsWith('/') ? url : `/${url}`;

    // Check cache
    if (imageCache.has(normalizedUrl)) {
        return imageCache.get(normalizedUrl);
    }

    // Get available proxies
    const availableProxies = proxyStatus
        .filter(p => p.status)
        .map(p => p.prefix);

    if (availableProxies.length === 0) {
        throw new Error('No available proxy servers');
    }

    // Try all proxies in parallel
    const attempts = availableProxies.map(async prefix => {
        const imageUrl = `${prefix}${normalizedUrl}`;
        try {
            await loadImageWithTimeout(imageUrl);
            return { success: true, url: imageUrl, prefix };
        } catch (error) {
            return { success: false, prefix, error };
        }
    });

    const results = await Promise.all(attempts);
    const success = results.find(r => r.success);

    if (success) {
        imageCache.set(normalizedUrl, success.url);
        return success.url;
    }

    // Update proxy status
    results.forEach(result => {
        if (!result.success) {
            const proxyIndex = proxyStatus.findIndex(p => p.prefix === result.prefix);
            if (proxyIndex !== -1) {
                proxyStatus[proxyIndex].status = false;
                updateUI.proxyStatus(proxyStatus);
            }
        }
    });

    throw new Error('Failed to load image from any proxy');
}

async function fetchIndexData() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await axios.get('./index.json', {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!Array.isArray(response.data)) {
            throw new Error('Invalid index data format');
        }

        indexData = response.data;

        if (indexData.length === 0) {
            throw new Error('Index is empty');
        }
        return true;
    } catch (error) {
        console.error('Error fetching index data:', error);
        errorState.message = 'Failed to load image index';
        errorState.hasError = true;
        updateUI.error(true, errorState.message);
        return false;
    }
}

async function getRandomImage() {
    // 清除任何现有的重试定时器
    if (errorState.retryTimer) {
        clearTimeout(errorState.retryTimer);
        errorState.retryTimer = null;
    }

    // 检查是否正在加载
    if (loading) {
        console.log('Already loading, skipping request');
        return;
    }

    // 检查索引数据
    if (!indexData.length) {
        if (!await fetchIndexData()) {
            console.error('Failed to fetch index data');
            return;
        }
    }

    try {
        updateUI.reset();
        updateUI.loading(true);
        
        const randomIndex = Math.floor(Math.random() * indexData.length);
        const artworkFile = indexData[randomIndex];

        const response = await axios.get(`./data/${artworkFile}`);
        currentArtwork = {
            ...response.data,
            pid: response.data.pid || '',
            title: response.data.title || 'Untitled',
            author: response.data.author || 'Unknown',
            tags: response.data.tags || [],
            url: response.data.url || '',
            urls: response.data.urls || { regular: '' }
        };

        updateUI.artwork(currentArtwork);

        const imageUrl = currentArtwork.url;
        // currentArtwork.urls?.regular || currentArtwork.url;
        if (!imageUrl) {
            throw new Error('No valid image URL found in artwork data');
        }

        const workingUrl = await tryLoadImage(imageUrl);
        $('#artworkImage').attr('src', workingUrl);
        errorState.retryCount = 0; // 重置重试计数

    } catch (error) {
        console.error('Error in getRandomImage:', error);

        if (errorState.retryCount < MAX_RETRIES) {
            errorState.retryCount++;
            updateUI.error(true, 'Loading failed, retrying...', errorState.retryCount);
            
            // 使用定时器进行重试
            errorState.retryTimer = setTimeout(() => {
                getRandomImage();
            }, 1000);
            
            return;
        }

        errorState.message = `Failed to load image: ${error.message}`;
        errorState.hasError = true;
        $('#artworkImage').attr('src', './images/error.svg');
        updateUI.error(true, errorState.message, errorState.retryCount);
    } finally {
        updateUI.loading(false);
    }
}

// Event Handlers
function handleImageError(event) {
    // 阻止事件冒泡
    event.stopPropagation();
    
    // 检查是否已经显示错误状态
    if (errorState.hasError) {
        return;
    }

    if (errorState.retryCount < MAX_RETRIES) {
        errorState.retryCount++;
        console.log(`Retrying image load (${errorState.retryCount}/${MAX_RETRIES})...`);
        
        // 使用定时器进行重试
        errorState.retryTimer = setTimeout(() => {
            getRandomImage();
        }, 1000);
    } else {
        errorState.retryCount = 0;
        loading = false;
        $('#artworkImage').attr('src', './images/error.svg');
        errorState.hasError = true;
        errorState.message = 'Failed to load image after multiple retries';
        updateUI.error(true, errorState.message);
    }
}

// Cache cleanup
setInterval(() => {
    if (imageCache.size > MAX_CACHE_SIZE) {
        console.log('Clearing image cache...');
        imageCache.clear();
    }
}, CACHE_CLEANUP_INTERVAL);

// Initialize application
$(document).ready(async function() {
    // 防止重复初始化
    if (isInitialized) return;
    isInitialized = true;

    // Set up event listeners
    $('#nextImageBtn').on('click', () => {
        if (!loading) {
            getRandomImage();
        }
    });
    
    $('#retryButton').on('click', () => {
        errorState.retryCount = 0;
        errorState.hasError = false;
        getRandomImage();
    });
    
    $('#artworkImage').on('error', handleImageError);

    // Initialize error handling
    window.onerror = function(msg, url, lineNo, columnNo, error) {
        console.error('Global error:', {
            message: msg,
            url: url,
            line: lineNo,
            column: columnNo,
            error: error
        });
        return false;
    };

    window.addEventListener('unhandledrejection', function(event) {
        console.error('Unhandled promise rejection:', event.reason);
    });

    // Check development mode
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.info('Running in development mode');
    }

    // Initialize the application
    try {
        await checkProxyStatus();
        if (await fetchIndexData()) {
            await getRandomImage();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        errorState.message = 'Failed to initialize application';
        errorState.hasError = true;
        updateUI.error(true, errorState.message);
    }
});
