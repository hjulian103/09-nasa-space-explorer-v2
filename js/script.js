// Use this URL to fetch NASA APOD JSON data.
const apodData = 'https://cdn.jsdelivr.net/gh/GCA-Classroom/apod/data.json';

// Basic DOM refs
const getImageBtn = document.getElementById('getImageBtn');
const gallery = document.getElementById('gallery');

// App state
let allItems = [];
let singleViewCurrent = 0;
let singleViewQueue = [];

// Minimal loader timing
const MIN_LOADING_MS = 600;

// Small helpers
function el(tag, className, text) {
	const e = document.createElement(tag);
	if (className) e.className = className;
	if (text) e.textContent = text;
	return e;
}

function shuffleArray(arr) {
	const a = Array.isArray(arr) ? arr.slice() : [];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function createShuffledIndexQueue(n) {
	return shuffleArray(Array.from({ length: n }, (_, i) => i));
}

// YouTube helper: extract 11-char id from common URL forms
function extractYouTubeId(url) {
	if (!url || typeof url !== 'string') return null;
	const m = url.match(/(?:youtu\.be\/|youtube\.com(?:\/embed\/|.*[?&]v=))([A-Za-z0-9_-]{11})/i);
	return m ? m[1] : null;
}

// Ensure YT API loaded once
let _youtubeApiPromise = null;
function ensureYouTubeApiLoaded() {
	if (_youtubeApiPromise) return _youtubeApiPromise;
	_youtubeApiPromise = new Promise((resolve) => {
		if (window.YT && window.YT.Player) return resolve(window.YT);
		const tag = document.createElement('script');
		tag.src = 'https://www.youtube.com/iframe_api';
		document.head.appendChild(tag);
		const prev = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = function () {
			if (typeof prev === 'function') prev();
			resolve(window.YT);
		};
		// safety poll
		const t = setInterval(() => {
			if (window.YT && window.YT.Player) {
				clearInterval(t);
				resolve(window.YT);
			}
		}, 200);
	});
	return _youtubeApiPromise;
}

// Show a simple loading message
function showLoading() {
	gallery.innerHTML = '';
	const loader = el('div', 'loader');
	loader.setAttribute('role', 'status');
	loader.setAttribute('aria-live', 'polite');

	// icon container — clone hidden SVG template if present
	const iconContainer = document.createElement('span');
	iconContainer.className = 'loader-icon';
	iconContainer.setAttribute('aria-hidden', 'true');
	const svgTemplate = document.getElementById('loader-svg');
	if (svgTemplate) {
		const svgClone = svgTemplate.cloneNode(true);
		svgClone.removeAttribute('id');
		svgClone.style.display = 'inline-block';
		svgClone.style.verticalAlign = 'middle';
		svgClone.style.width = '24px';
		svgClone.style.height = '24px';
		iconContainer.appendChild(svgClone);
	} else {
		// fallback emoji
		iconContainer.textContent = '🔄';
	}

	const text = el('span', 'loader-text', 'Loading space photos…');
	loader.appendChild(iconContainer);
	loader.appendChild(text);
	loader.classList.add('fade-in');
	gallery.appendChild(loader);
}

function showError(msg) {
	gallery.innerHTML = '';
	gallery.appendChild(el('div', 'error', msg || 'Failed to load.'));
}

// Create media element (card or lightbox)
function createMediaElement(item, opts = {}) {
	const { forLightbox = false } = opts;
	const mediaType = item.media_type || '';
	const src = item.hdurl || item.url || item.image || '';

	const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(src || '');
	const isVideoExt = /\.(mp4|webm|ogg)(?:$|\?)/i.test(src || '');

	// Video-like
	if ((mediaType && String(mediaType).toLowerCase().startsWith('video')) || isYouTube || isVideoExt) {
		if (forLightbox) {
			// Try YouTube player first (we can detect embed errors and show a link fallback)
			const ytId = extractYouTubeId(src);
			if (ytId) {
				const container = document.createElement('div');
				container.className = 'youtube-player-container';
				container.dataset.ytId = ytId;
				container.dataset.embedLoaded = '0';

				// Create player once and guard against duplicates
				ensureYouTubeApiLoaded().then((YT) => {
					try {
						if (container._ytPlayerInstance || container._ytCreating) return;
						container._ytCreating = true;
						const player = new YT.Player(container, {
							videoId: ytId,
							width: '100%',
							height: '100%',
							playerVars: { autoplay: 1, mute: 1, rel: 0, controls: 1, playsinline: 1 },
							events: {
								onReady: (ev) => {
									container.dataset.embedLoaded = '1';
									container._ytCreating = false;
									try { ev.target.playVideo && ev.target.playVideo(); } catch (e) { /* ignore */ }
								},
								onError: (e) => {
									container._ytCreating = false;
									const code = e && e.data;
									const msg = el('div', 'embed-fail', code ? `Cannot play here (error ${code})` : 'Cannot play here');
									const btn = el('button', 'open-external', 'Open on YouTube');
									btn.addEventListener('click', () => window.open(`https://www.youtube.com/watch?v=${ytId}`, '_blank', 'noopener'));
									msg.appendChild(btn);
									container.appendChild(msg);
								}
							}
						});
						container._ytPlayerInstance = player;
					} catch (e) {
						container._ytCreating = false;
						console.error('YT create error', e);
					}
				});
				return container;
			}

			// Direct video file
			if (isVideoExt) {
				const v = document.createElement('video');
				v.controls = true;
				v.src = src;
				v.preload = 'metadata';
				return v;
			}

			// Generic iframe fallback
			const iframe = document.createElement('iframe');
			let embedSrc = src;
			if (/youtube\.com\/watch\?v=/.test(embedSrc)) embedSrc = embedSrc.replace('watch?v=', 'embed/');
			iframe.src = embedSrc;
			iframe.dataset.embedLoaded = '0';
			iframe.addEventListener('load', () => { iframe.dataset.embedLoaded = '1'; });
			iframe.style.width = '100%';
			iframe.style.height = '100%';
			iframe.frameBorder = '0';
			iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
			iframe.allowFullscreen = true;
			return iframe;
		}

		// Card view: try to show a thumbnail image if available
		const thumb = item.thumbnail_url || item.thumbnail || item.thumb || '';
		const id = extractYouTubeId(src);
		const derived = (!thumb && id) ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : '';
		const thumbUrl = thumb || derived;
		if (thumbUrl) {
			const img = document.createElement('img');
			img.src = thumbUrl;
			img.alt = item.title || 'video thumbnail';
			img.loading = 'lazy';
			img.className = 'video-thumb';
			const wrap = el('div', 'video-thumb-wrap');
			wrap.appendChild(img);
			const overlay = el('span', 'play-overlay', '▶');
			overlay.setAttribute('aria-hidden', 'true');
			wrap.appendChild(overlay);
			// store original src for opening
			img.dataset.videoSrc = src;
			return wrap;
		}

		const link = el('a', 'video-link');
		link.href = src || '#';
		link.target = '_blank';
		link.rel = 'noopener';
		link.textContent = 'Open video';
		return link;
	}

	// Non-video: image
	if (src) {
		const img = document.createElement('img');
		img.src = src;
		img.alt = item.title || 'space image';
		img.loading = 'lazy';
		return img;
	}

	return el('div', 'no-image', 'No preview');
}

// Create card
function createCard(item) {
	const card = el('figure', 'card');
	const media = createMediaElement(item, { forLightbox: false });
	const mediaWrap = el('div', 'card-media');
	mediaWrap.appendChild(media);
	card.appendChild(mediaWrap);
	return card;
}

// Single view render
function renderSingleCard(index) {
	if (!allItems || index < 0 || index >= allItems.length) return;
	gallery.innerHTML = '';
	const view = el('div', 'single-view');
	const cardWrap = el('div', 'single-card-wrap');
	const item = allItems[index];
	const card = createCard(item);
	card.dataset.index = index;

	// make media clickable
	const selectors = ['.video-thumb-wrap', 'img', 'iframe', 'video', 'a.video-link', '.no-image'];
	const seen = new Set();
	selectors.forEach((sel) => {
		const node = card.querySelector(sel);
		if (!node || seen.has(node)) return;
		seen.add(node);
		if (node.tagName && node.tagName.toLowerCase() === 'a') {
			node.style.cursor = 'pointer';
			node.addEventListener('click', (ev) => {
				if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
				ev.preventDefault();
				const itemSrc = (item && (item.hdurl || item.url || item.image)) || '';
				const canEmbed = (item.media_type && String(item.media_type).toLowerCase().startsWith('video')) || /(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(itemSrc) || /\.(mp4|webm|ogg)(?:$|\?)/i.test(itemSrc);
				if (canEmbed) openLightbox(index); else window.open(node.href, '_blank', 'noopener');
			});
		} else {
			node.style.cursor = 'zoom-in';
			node.addEventListener('click', (ev) => { ev.stopPropagation(); openLightbox(index); });
		}
	});

	cardWrap.appendChild(card);
	view.appendChild(cardWrap);
	view.classList.add('fade-in');
	gallery.appendChild(view);
}

function showSingleView(startIndex) {
	singleViewCurrent = startIndex || 0;
	renderSingleCard(singleViewCurrent);
}

function nextShuffled() {
	if (!allItems || allItems.length === 0) return;
	if (singleViewQueue.length === 0) singleViewQueue = createShuffledIndexQueue(allItems.length);
	const next = singleViewQueue.shift();
	if (typeof next === 'number') { singleViewCurrent = next; renderSingleCard(singleViewCurrent); }
}

// Fetch and show
async function fetchAndShow() {
	showLoading();
	const start = Date.now();
	try {
		const resp = await fetch(apodData);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data = await resp.json();
		let items = data;
		if (data.data) items = data.data;
		if (data.items) items = data.items;
		if (!Array.isArray(items)) items = Object.values(items || {});
		allItems = items || [];
		if (allItems.length === 0) { showError('No images'); return; }
		singleViewQueue = createShuffledIndexQueue(allItems.length);
		const first = singleViewQueue.shift();
		singleViewCurrent = (typeof first === 'number') ? first : 0;
		const elapsed = Date.now() - start;
		if (elapsed < MIN_LOADING_MS) await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed));
		showSingleView(singleViewCurrent);
	} catch (err) {
		console.error('Fetch error', err);
		showError('Unable to load images.');
	}
}

// Button
if (getImageBtn) getImageBtn.addEventListener('click', () => fetchAndShow());

// Lightbox basics
let currentLightbox = null;
function openLightbox(index) {
	const item = allItems[index];
	if (!item) return;
	closeLightbox();
	const overlay = el('div', 'lightbox-overlay');
	const content = el('div', 'lightbox-content');
	const mediaItem = Object.assign({}, item);
	mediaItem.hdurl = item.hdurl || item.url || item.image || '';
	const media = createMediaElement(mediaItem, { forLightbox: true });

	// Make the lightbox content use flex so children can size to viewport limits.
	content.style.display = 'flex';
	content.style.flexDirection = 'column';
	content.style.alignItems = 'stretch';
	content.style.justifyContent = 'center';

	// For YouTube player containers (divs created by createMediaElement) we need
	// to give them an explicit height so the iframe fills the modal. For other
	// embeds (iframe/video/img), constrain their max-height to the viewport.
	media.style.width = '100%';
	if (media.tagName === 'DIV' || media.classList && media.classList.contains('youtube-player-container')) {
		// give the player plenty of room but keep it within the viewport
		media.style.height = '80vh';
		media.style.maxHeight = '95vh';
		media.style.display = 'block';
	} else {
		media.style.maxHeight = '80vh';
		media.style.height = 'auto';
		media.style.objectFit = 'contain';
		media.style.display = 'block';
	}

	content.appendChild(media);
	// caption
	if (item.title || item.date || item.explanation) {
		const cap = el('div', 'lightbox-caption');
		if (item.title) cap.appendChild(el('div', '', item.title));
		if (item.date) cap.appendChild(el('div', '', item.date));
		if (item.explanation) cap.appendChild(el('div', '', item.explanation));
		content.appendChild(cap);
	}
	const closeBtn = el('button', 'lightbox-close', 'Close');
	closeBtn.addEventListener('click', closeLightbox);
	content.appendChild(closeBtn);
	overlay.appendChild(content);
	document.body.appendChild(overlay);
	overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeLightbox(); });
	function onKey(ev) { if (ev.key === 'Escape') closeLightbox(); }
	document.addEventListener('keydown', onKey);
	currentLightbox = { overlay, onKey };
}

function closeLightbox() {
	if (!currentLightbox) return;
	const { overlay, onKey } = currentLightbox;
	try {
		const containers = overlay.querySelectorAll && overlay.querySelectorAll('[data-yt-id]');
		if (containers && containers.length) {
			containers.forEach((c) => { if (c && c._ytPlayerInstance && typeof c._ytPlayerInstance.destroy === 'function') { try { c._ytPlayerInstance.destroy(); } catch (e) { /* ignore */ } } });
		}
	} catch (e) { /* ignore */ }
	if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
	if (onKey) document.removeEventListener('keydown', onKey);
	currentLightbox = null;
}
