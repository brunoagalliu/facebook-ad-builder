import React, { useState, useEffect } from 'react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { createBrandScrape, getBrandScrapes, getBrandScrape, deleteBrandScrape } from '../api/research';
import { Search, Trash2, ChevronDown, ChevronRight, ExternalLink, Image, Video, Loader2, RefreshCw, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// media_urls is a flat array of URLs, not tagged by role — extraction order
// (brandScraperService.ts's playwrightScrapeAds) pushes any background-image/img
// URLs first, then the video's own src, then its poster frame last. Blindly using
// media_urls[0] as the <video> source (the original bug here) grabs whatever image
// came first instead of the actual video — it renders an empty, unplayable player.
// Classify by file extension instead, and prefer the *last* non-video URL as the
// cover/poster: confirmed live (via a direct DOM inspection while debugging the
// scraper) that for a video ad, that last URL is the real representative frame
// Facebook itself generates, not some earlier decorative/UI asset.
const isVideoUrl = (url) => /\.(mp4|webm|mov)(\?|$)/i.test(url);
const classifyAdMedia = (ad) => {
    const urls = (ad.media_urls || []).filter(Boolean);
    const videoUrl = urls.find(isVideoUrl);
    const imageUrls = urls.filter((url) => !isVideoUrl(url));
    const coverImage = videoUrl ? imageUrls[imageUrls.length - 1] : imageUrls[0];
    return { videoUrl, imageUrls, coverImage };
};

const BrandScrapes = () => {
    const { showSuccess, showError, showInfo } = useToast();
    const { authFetch } = useAuth();
    const [promotingAdId, setPromotingAdId] = useState(null);
    const [promotedAdIds, setPromotedAdIds] = useState(new Set());
    const [brandName, setBrandName] = useState('');
    const [pageInput, setPageInput] = useState('');

    // Build full URL from page ID, search query, or extract from URL
    const buildPageUrl = (input) => {
        const trimmed = input.trim();
        // If it's just numbers, treat as page ID
        if (/^\d+$/.test(trimmed)) {
            return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&view_all_page_id=${trimmed}`;
        }
        // If it's a valid FB Ads Library URL (with view_all_page_id OR search query), use as-is
        if (trimmed.includes('facebook.com/ads/library') && (trimmed.includes('view_all_page_id=') || trimmed.includes('q='))) {
            return trimmed;
        }
        // Try to extract page ID from various FB URL formats
        const pageIdMatch = trimmed.match(/(?:page_id=|pages\/|facebook\.com\/)(\d+)/);
        if (pageIdMatch) {
            return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&view_all_page_id=${pageIdMatch[1]}`;
        }
        return null;
    };
    const [scrapes, setScrapes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedScrape, setExpandedScrape] = useState(null);
    const [scrapeDetails, setScrapeDetails] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [scrapeToDelete, setScrapeToDelete] = useState(null);
    const [selectedAd, setSelectedAd] = useState(null);

    useEffect(() => {
        fetchScrapes();
    }, []);

    useEffect(() => {
        if (!selectedAd) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setSelectedAd(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedAd]);

    // scrapeBrand runs as a fire-and-forget background job server-side (see
    // research.ts's POST /brand-scrapes) that can take a minute or more, but nothing
    // ever re-fetched status after the initial load — confirmed live that a scrape
    // which had genuinely finished (status: completed, 30 ads) still showed "scraping"
    // indefinitely until a manual page reload. Polls only while at least one scrape is
    // still pending/scraping, and stops itself once everything reaches a terminal state.
    useEffect(() => {
        const hasActiveScrape = scrapes.some((s) => s.status === 'pending' || s.status === 'scraping');
        if (!hasActiveScrape) return;

        const interval = setInterval(fetchScrapes, 5000);
        return () => clearInterval(interval);
    }, [scrapes]);

    const fetchScrapes = async () => {
        try {
            const data = await getBrandScrapes();
            setScrapes(Array.isArray(data) ? data : []);
        } catch (error) {
            showError('Failed to load brand scrapes');
            setScrapes([]);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!brandName.trim()) {
            showError('Please enter a brand name');
            return;
        }
        if (!pageInput.trim()) {
            showError('Please enter a Facebook Page ID or Ads Library URL');
            return;
        }

        const pageUrl = buildPageUrl(pageInput);
        if (!pageUrl) {
            showError('Invalid input. Enter a Page ID (numbers) or a Facebook Ads Library URL');
            return;
        }

        setLoading(true);
        try {
            await createBrandScrape(brandName, pageUrl);
            showSuccess('Brand scrape started! Check back soon for results.');
            setBrandName('');
            setPageInput('');
            fetchScrapes();
        } catch (error) {
            const message = error.response?.data?.detail || 'Failed to start scrape';
            showError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleExpand = async (scrapeId) => {
        if (expandedScrape === scrapeId) {
            setExpandedScrape(null);
            setScrapeDetails(null);
            return;
        }

        setExpandedScrape(scrapeId);
        try {
            const details = await getBrandScrape(scrapeId);
            // Ensure ads is always an array
            if (details && !Array.isArray(details.ads)) {
                details.ads = [];
            }
            setScrapeDetails(details);
        } catch (error) {
            showError('Failed to load scrape details');
            setScrapeDetails(null);
        }
    };

    const handlePromoteAd = async (ad) => {
        setPromotingAdId(ad.id);
        try {
            const response = await authFetch(`${API_URL}/research/brand-scraped-ads/${ad.id}/promote`, { method: 'POST' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to mark ad as winner');
            }
            setPromotedAdIds(prev => new Set(prev).add(ad.id));
            showSuccess('Marked as winner — analyzing its structure now. Check Winning Ads shortly.');
        } catch (error) {
            showError(error.message || 'Failed to mark ad as winner');
        } finally {
            setPromotingAdId(null);
        }
    };

    const confirmDelete = (scrape) => {
        setScrapeToDelete(scrape);
        setShowDeleteModal(true);
    };

    const handleDelete = async () => {
        if (!scrapeToDelete) return;

        try {
            await deleteBrandScrape(scrapeToDelete.id);
            showSuccess('Brand scrape deleted');
            setShowDeleteModal(false);
            setScrapeToDelete(null);
            if (expandedScrape === scrapeToDelete.id) {
                setExpandedScrape(null);
                setScrapeDetails(null);
            }
            fetchScrapes();
        } catch (error) {
            showError('Failed to delete brand scrape');
        }
    };

    const getStatusBadge = (status) => {
        const styles = {
            pending: 'bg-yellow-100 text-yellow-800',
            scraping: 'bg-blue-100 text-blue-800',
            completed: 'bg-green-100 text-green-800',
            failed: 'bg-red-100 text-red-800'
        };
        return (
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
                {status}
            </span>
        );
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-amber-900">Scrape Brand Ads</h1>
                    <p className="text-amber-600 text-sm">Download all ads from a Facebook page to R2 storage</p>
                </div>
                <button
                    onClick={fetchScrapes}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-lg"
                >
                    <RefreshCw size={16} />
                    Refresh
                </button>
            </div>

            {/* Scrape Form */}
            <div className="bg-white rounded-xl border border-amber-200 p-6">
                <h2 className="text-lg font-semibold text-amber-900 mb-4">New Brand Scrape</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="brandName" className="block text-sm font-medium text-gray-700 mb-1">
                            Brand Name
                        </label>
                        <input
                            id="brandName"
                            name="brandName"
                            type="text"
                            value={brandName}
                            onChange={(e) => setBrandName(e.target.value)}
                            placeholder="e.g., Nike, Apple, etc."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">This will be the folder name on R2 storage</p>
                    </div>
                    <div>
                        <label htmlFor="pageInput" className="block text-sm font-medium text-gray-700 mb-1">
                            Facebook Page ID or Ads Library URL
                        </label>
                        <input
                            id="pageInput"
                            name="pageInput"
                            type="text"
                            value={pageInput}
                            onChange={(e) => setPageInput(e.target.value)}
                            placeholder="123456789 or https://www.facebook.com/ads/library/?...&view_all_page_id=123456789"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Paste a Page ID or full Ads Library URL - we'll handle the rest
                        </p>
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="flex items-center gap-2 px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:bg-amber-300 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                Starting...
                            </>
                        ) : (
                            <>
                                <Search size={18} />
                                Start Scrape
                            </>
                        )}
                    </button>
                </form>
            </div>

            {/* Scrapes List */}
            <div className="bg-white rounded-xl border border-amber-200">
                <div className="p-4 border-b border-amber-100">
                    <h2 className="text-lg font-semibold text-amber-900">Brand Scrapes</h2>
                </div>

                {scrapes.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        No brand scrapes yet. Start one above!
                    </div>
                ) : (
                    <div className="divide-y divide-amber-100">
                        {scrapes.map((scrape) => (
                            <div key={scrape.id}>
                                <div
                                    className="p-4 hover:bg-amber-50 cursor-pointer flex items-center justify-between"
                                    onClick={() => handleExpand(scrape.id)}
                                >
                                    <div className="flex items-center gap-4">
                                        <button className="text-amber-600">
                                            {expandedScrape === scrape.id ? (
                                                <ChevronDown size={20} />
                                            ) : (
                                                <ChevronRight size={20} />
                                            )}
                                        </button>
                                        <div>
                                            <h3 className="font-medium text-gray-900">{scrape.brand_name}</h3>
                                            <p className="text-sm text-gray-500">
                                                {scrape.page_name || `Page ID: ${scrape.page_id}`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <p className="text-sm font-medium text-gray-900">
                                                {scrape.total_ads} ads
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {scrape.media_downloaded} media files
                                            </p>
                                        </div>
                                        {getStatusBadge(scrape.status)}
                                        <span className="text-xs text-gray-400">
                                            {formatDate(scrape.created_at)}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                confirmDelete(scrape);
                                            }}
                                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded Details */}
                                {expandedScrape === scrape.id && scrapeDetails && (
                                    <div className="px-4 pb-4 bg-amber-50/50">
                                        {scrape.error_message && (
                                            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                                                {scrape.error_message}
                                            </div>
                                        )}

                                        {scrapeDetails.ads && scrapeDetails.ads.length > 0 ? (
                                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                                {scrapeDetails.ads.map((ad) => {
                                                    const { coverImage } = classifyAdMedia(ad);
                                                    return (
                                                        <div
                                                            key={ad.id}
                                                            onClick={() => setSelectedAd(ad)}
                                                            className="bg-white rounded-lg border border-amber-200 overflow-hidden cursor-pointer hover:shadow-md hover:border-amber-300 transition-shadow"
                                                        >
                                                            {/* Cover Image */}
                                                            <div className="aspect-video bg-gray-100 relative">
                                                                {coverImage ? (
                                                                    <img
                                                                        src={coverImage}
                                                                        alt={ad.headline || 'Ad'}
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                                                        <Image size={32} />
                                                                    </div>
                                                                )}
                                                                {ad.media_type === 'video' && (
                                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                                                        <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                                                                            <Video size={18} className="text-white" />
                                                                        </div>
                                                                    </div>
                                                                )}
                                                                {ad.media_urls && ad.media_urls.length > 1 && (
                                                                    <span className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 text-white text-xs rounded">
                                                                        +{ad.media_urls.length - 1} more
                                                                    </span>
                                                                )}
                                                                {promotedAdIds.has(ad.id) && (
                                                                    <span className="absolute top-2 left-2 px-2 py-0.5 bg-green-600 text-white text-xs rounded font-medium">
                                                                        ✓ Winner
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Minimal Info */}
                                                            <div className="p-3">
                                                                {ad.page_name && (
                                                                    <span className="text-xs font-medium text-indigo-600 truncate block mb-1">
                                                                        {ad.page_name}
                                                                    </span>
                                                                )}
                                                                {ad.headline && (
                                                                    <p className="text-sm font-medium text-gray-900 line-clamp-2">
                                                                        {ad.headline}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="text-center py-8 text-gray-500">
                                                {scrape.status === 'scraping' ? (
                                                    <div className="flex items-center justify-center gap-2">
                                                        <Loader2 size={20} className="animate-spin" />
                                                        Scraping in progress...
                                                    </div>
                                                ) : (
                                                    'No ads found'
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && scrapeToDelete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            Delete Brand Scrape?
                        </h3>
                        <p className="text-gray-600 mb-4">
                            This will delete all {scrapeToDelete.total_ads} ads and {scrapeToDelete.media_downloaded} media files from R2 storage. This action cannot be undone.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => {
                                    setShowDeleteModal(false);
                                    setScrapeToDelete(null);
                                }}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Ad Details Modal */}
            {selectedAd && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
                    onClick={() => setSelectedAd(null)}
                >
                    <div
                        className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-4 border-b border-amber-100 sticky top-0 bg-white">
                            <div className="flex items-center gap-2 min-w-0">
                                <h3 className="font-semibold text-gray-900 truncate">
                                    {selectedAd.page_name || 'Ad Details'}
                                </h3>
                                {selectedAd.page_link && (
                                    <a
                                        href={selectedAd.page_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-400 hover:text-indigo-600 flex-shrink-0"
                                        title="View all ads from this page"
                                    >
                                        <ExternalLink size={14} />
                                    </a>
                                )}
                            </div>
                            <button
                                onClick={() => setSelectedAd(null)}
                                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg flex-shrink-0"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-4 space-y-4">
                            {(() => {
                                const { videoUrl, coverImage } = classifyAdMedia(selectedAd);
                                // Scraped ads are often portrait (Reels/Stories-shaped) — a
                                // plain w-full would blow a 9:16 video up to the modal's
                                // full width and make it enormous and mostly off-screen.
                                // Letterbox it in a fixed-height dark frame instead, capped
                                // by height so portrait and landscape media both fit.
                                if (videoUrl) {
                                    return (
                                        <div className="bg-gray-900 rounded-lg flex items-center justify-center overflow-hidden">
                                            <video
                                                src={videoUrl}
                                                poster={coverImage}
                                                className="max-h-[50vh] max-w-full"
                                                controls
                                                autoPlay
                                            />
                                        </div>
                                    );
                                }
                                if (coverImage) {
                                    return (
                                        <div className="bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden">
                                            <img
                                                src={coverImage}
                                                alt={selectedAd.headline || 'Ad'}
                                                className="max-h-[50vh] max-w-full"
                                            />
                                        </div>
                                    );
                                }
                                return (
                                    <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                                        <Image size={32} />
                                    </div>
                                );
                            })()}

                            <div className="space-y-3">
                                {selectedAd.ad_copy && (
                                    <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">
                                            Primary Text
                                        </p>
                                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{selectedAd.ad_copy}</p>
                                    </div>
                                )}
                                {selectedAd.headline && (
                                    <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">
                                            Headline
                                        </p>
                                        <p className="text-sm font-medium text-gray-900">{selectedAd.headline}</p>
                                    </div>
                                )}
                                {selectedAd.cta_text && (
                                    <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">
                                            Call to Action
                                        </p>
                                        <span className="inline-block px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded font-medium">
                                            {selectedAd.cta_text}
                                        </span>
                                    </div>
                                )}
                                {selectedAd.platforms && selectedAd.platforms.length > 0 && (
                                    <div>
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">
                                            Platforms
                                        </p>
                                        <div className="flex flex-wrap gap-1">
                                            {selectedAd.platforms.map((platform) => (
                                                <span
                                                    key={platform}
                                                    className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded capitalize"
                                                >
                                                    {platform}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-100">
                                <span>{selectedAd.start_date || 'Unknown date'}</span>
                                {selectedAd.ad_link && (
                                    <a
                                        href={selectedAd.ad_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-amber-600 hover:text-amber-800"
                                    >
                                        View in Ad Library <ExternalLink size={12} />
                                    </a>
                                )}
                            </div>

                            {promotedAdIds.has(selectedAd.id) ? (
                                <span className="block text-center px-3 py-2 bg-green-100 text-green-700 rounded-lg font-medium text-sm">
                                    ✓ Marked as Winner
                                </span>
                            ) : (
                                <button
                                    onClick={() => handlePromoteAd(selectedAd)}
                                    disabled={promotingAdId === selectedAd.id}
                                    className="w-full px-3 py-2 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {promotingAdId === selectedAd.id ? 'Marking...' : '★ Mark as Winner'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BrandScrapes;
