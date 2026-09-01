import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { searchAndSave, getSavedSearches, deleteSavedSearch, getApiUsage, getBlacklist, addToBlacklist, removeFromBlacklist, getKeywordBlacklist, addToKeywordBlacklist, removeFromKeywordBlacklist, getRateLimit, getVerticals, createVertical, getVerticalAggregatedAds, getVerticalPageAds } from '../api/research';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const COUNTRIES = [
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'CA', name: 'Canada' },
    { code: 'AU', name: 'Australia' },
];

// AdPlexity charges 1 base credit per API call + 1 credit per result actually
// returned (confirmed empirically: count=1 -> 2 credits, count=50 -> 51 credits).
// The backend batches in chunks of up to 100 results per call, so this estimates
// the worst case (every batch fully populated) — actual cost may be lower.
const estimateAdplexityCredits = (limit) => Math.ceil(limit / 100) + limit;

const LIMIT_OPTIONS = [
    { value: 100, label: '100 ads', apiCalls: 1 },
    { value: 300, label: '300 ads', apiCalls: 3 },
    { value: 500, label: '500 ads', apiCalls: 5 },
    { value: 1000, label: '1,000 ads', apiCalls: 10 },
    { value: 2000, label: '2,000 ads', apiCalls: 20 },
    { value: 5000, label: '5,000 ads', apiCalls: 50 },
    { value: 10000, label: '10,000 ads', apiCalls: 100 },
];

const Research = () => {
    const { showSuccess, showError, showInfo } = useToast();
    const { authFetch } = useAuth();
    const location = useLocation();
    const [promotingAdId, setPromotingAdId] = useState(null);
    const [promotedAdIds, setPromotedAdIds] = useState(new Set());
    const [adPendingDelete, setAdPendingDelete] = useState(null);
    const [deletingAdId, setDeletingAdId] = useState(null);
    const [pagePendingDelete, setPagePendingDelete] = useState(null);
    const [deletingPageId, setDeletingPageId] = useState(null);
    const [selectedPageIds, setSelectedPageIds] = useState(new Set());
    const [batchDeletePending, setBatchDeletePending] = useState(false);
    const [batchDeleting, setBatchDeleting] = useState(false);
    const [query, setQuery] = useState('');
    const [source, setSource] = useState('facebook');
    const [country, setCountry] = useState('US');
    const [negativeKeywords, setNegativeKeywords] = useState('');
    const [limit, setLimit] = useState(300);
    const [savedSearches, setSavedSearches] = useState([]);
    const [selectedSearch, setSelectedSearch] = useState(null);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('verticals');
    const [selectedVertical, setSelectedVertical] = useState(null);
    const [apiUsage, setApiUsage] = useState([]);
    const [blacklist, setBlacklist] = useState([]);
    const [showBlacklistModal, setShowBlacklistModal] = useState(false);
    const [blacklistPageName, setBlacklistPageName] = useState('');
    const [keywordBlacklist, setKeywordBlacklist] = useState([]);
    const [showKeywordModal, setShowKeywordModal] = useState(false);
    const [blacklistKeyword, setBlacklistKeyword] = useState('');
    const [rateLimit, setRateLimit] = useState(null);
    const [progressMessage, setProgressMessage] = useState('');
    const [verticals, setVerticals] = useState([]);
    const [showVerticalModal, setShowVerticalModal] = useState(false);
    const [newVerticalName, setNewVerticalName] = useState('');
    const [newVerticalDescription, setNewVerticalDescription] = useState('');
    const [searchType, setSearchType] = useState('one_time');
    const [expandedPages, setExpandedPages] = useState(new Set());
    const [aggregatedAds, setAggregatedAds] = useState([]);
    const [pageAds, setPageAds] = useState({});
    const [verticalTab, setVerticalTab] = useState('aggregated');
    const [aggregatedFilter, setAggregatedFilter] = useState('');

    useEffect(() => {
        // Set activeTab based on route
        if (!selectedVertical) {
            setActiveTab('verticals');
        }
    }, [location.pathname]);

    useEffect(() => {
        fetchVerticals();
        fetchRateLimit();
        if (activeTab === 'saved-searches') {
            fetchSavedSearches();
            fetchApiUsage();
            fetchBlacklist();
            fetchKeywordBlacklist();
        }
        if (activeTab === 'vertical-detail' && selectedVertical) {
            console.log('vertical-detail tab active, fetching data for vertical:', selectedVertical.name);
            fetchBlacklist();
            fetchKeywordBlacklist();
            fetchSavedSearches();
            fetchAggregatedAds();
        }
    }, [activeTab, selectedVertical]);

    const fetchRateLimit = async () => {
        try {
            const data = await getRateLimit();
            setRateLimit(data);
        } catch (error) {
            console.error('Failed to load rate limit', error);
        }
    };

    const fetchVerticals = async () => {
        try {
            const data = await getVerticals();
            setVerticals(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load verticals', error);
            setVerticals([]);
        }
    };

    const fetchAggregatedAds = async () => {
        if (!selectedVertical) {
            console.log('No selected vertical, skipping aggregated ads fetch');
            return;
        }

        try {
            console.log('Fetching aggregated ads for vertical:', selectedVertical.id);
            const data = await getVerticalAggregatedAds(selectedVertical.id);
            console.log('Aggregated ads data:', data);
            setAggregatedAds(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load aggregated ads', error);
            showError('Failed to load aggregated ads');
            setAggregatedAds([]);
        }
    };

    const togglePageExpansion = async (pageId) => {
        const newExpandedPages = new Set(expandedPages);

        if (expandedPages.has(pageId)) {
            // Collapse
            newExpandedPages.delete(pageId);
            setExpandedPages(newExpandedPages);
        } else {
            // Expand - fetch ads if not already loaded
            newExpandedPages.add(pageId);
            setExpandedPages(newExpandedPages);

            if (!pageAds[pageId]) {
                try {
                    const ads = await getVerticalPageAds(selectedVertical.id, pageId);
                    setPageAds(prev => ({ ...prev, [pageId]: Array.isArray(ads) ? ads : [] }));
                } catch (error) {
                    console.error('Failed to load page ads', error);
                    showError('Failed to load ads for this page');
                    setPageAds(prev => ({ ...prev, [pageId]: [] }));
                }
            }
        }
    };

    const handlePromoteAd = async (ad) => {
        setPromotingAdId(ad.id);
        try {
            const response = await authFetch(`${API_URL}/research/scraped-ads/${ad.id}/promote`, { method: 'POST' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to mark ad as winner');
            }
            setPromotedAdIds(prev => new Set(prev).add(ad.id));
            showSuccess(`Marked as winner — analyzing its structure now. Check Winning Ads shortly.`);
        } catch (error) {
            showError(error.message || 'Failed to mark ad as winner');
        } finally {
            setPromotingAdId(null);
        }
    };

    const handleDeleteAdClick = (ad, pageId) => {
        setAdPendingDelete({ ad, pageId });
    };

    const confirmDeleteAd = async () => {
        if (!adPendingDelete) return;
        const { ad, pageId } = adPendingDelete;
        setDeletingAdId(ad.id);
        try {
            const response = await authFetch(`${API_URL}/research/scraped-ads/${ad.id}`, { method: 'DELETE' });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || 'Failed to remove ad');
            }
            setPageAds(prev => {
                if (!pageId || !prev[pageId]) return prev;
                return { ...prev, [pageId]: prev[pageId].filter(a => a.id !== ad.id) };
            });
            setSavedSearches(prev => prev.map(search => ({
                ...search,
                ads: (search.ads || []).filter(a => a.id !== ad.id)
            })));
            showSuccess('Ad removed');
        } catch (error) {
            showError(error.message || 'Failed to remove ad');
        } finally {
            setDeletingAdId(null);
            setAdPendingDelete(null);
        }
    };

    const handleDeletePageClick = (page) => {
        setPagePendingDelete(page);
    };

    const confirmDeletePage = async () => {
        if (!pagePendingDelete || !selectedVertical) return;
        const page = pagePendingDelete;
        setDeletingPageId(page.page_id);
        try {
            const response = await authFetch(
                `${API_URL}/research/verticals/${selectedVertical.id}/pages/${page.page_id}/ads`,
                { method: 'DELETE' }
            );
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || 'Failed to remove page');
            }
            const data = await response.json().catch(() => ({}));
            setAggregatedAds(prev => prev.filter(p => p.page_id !== page.page_id));
            setPageAds(prev => {
                const next = { ...prev };
                delete next[page.page_id];
                return next;
            });
            showSuccess(data.message || 'Page removed');
        } catch (error) {
            showError(error.message || 'Failed to remove page');
        } finally {
            setDeletingPageId(null);
            setPagePendingDelete(null);
        }
    };

    const togglePageSelection = (pageId) => {
        setSelectedPageIds(prev => {
            const next = new Set(prev);
            if (next.has(pageId)) next.delete(pageId);
            else next.add(pageId);
            return next;
        });
    };

    const toggleSelectAllPages = (pageIds) => {
        setSelectedPageIds(prev => {
            const allSelected = pageIds.length > 0 && pageIds.every(id => prev.has(id));
            return allSelected ? new Set() : new Set(pageIds);
        });
    };

    const confirmBatchDeletePages = async () => {
        if (!selectedVertical || selectedPageIds.size === 0) return;
        setBatchDeleting(true);
        try {
            const pageIds = Array.from(selectedPageIds);
            const response = await authFetch(
                `${API_URL}/research/verticals/${selectedVertical.id}/pages/ads`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page_ids: pageIds }),
                }
            );
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || 'Failed to remove pages');
            }
            const data = await response.json().catch(() => ({}));
            const pageIdSet = new Set(pageIds);
            setAggregatedAds(prev => prev.filter(p => !pageIdSet.has(p.page_id)));
            setPageAds(prev => {
                const next = { ...prev };
                pageIds.forEach(id => delete next[id]);
                return next;
            });
            setSelectedPageIds(new Set());
            showSuccess(data.message || 'Pages removed');
        } catch (error) {
            showError(error.message || 'Failed to remove pages');
        } finally {
            setBatchDeleting(false);
            setBatchDeletePending(false);
        }
    };

    const handleCreateVertical = async () => {
        if (!newVerticalName.trim()) {
            showError('Enter vertical name');
            return;
        }

        try {
            await createVertical(newVerticalName, newVerticalDescription);
            showSuccess(`Created vertical "${newVerticalName}"`);
            setNewVerticalName('');
            setNewVerticalDescription('');
            setShowVerticalModal(false);
            fetchVerticals();
        } catch (error) {
            showError('Failed to create vertical');
        }
    };

    const fetchApiUsage = async () => {
        try {
            const data = await getApiUsage();
            setApiUsage(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load API usage', error);
            setApiUsage([]);
        }
    };

    const fetchBlacklist = async () => {
        try {
            const data = await getBlacklist();
            setBlacklist(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load blacklist', error);
            setBlacklist([]);
        }
    };

    const fetchKeywordBlacklist = async () => {
        try {
            const data = await getKeywordBlacklist();
            setKeywordBlacklist(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load keyword blacklist', error);
            setKeywordBlacklist([]);
        }
    };

    const fetchSavedSearches = async () => {
        try {
            const data = await getSavedSearches();
            setSavedSearches(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Failed to load searches', error);
            setSavedSearches([]);
        }
    };

    const handleScrape = async (e) => {
        e.preventDefault();
        if (!query.trim()) {
            showError('Enter search term');
            return;
        }

        setLoading(true);

        if (source === 'adplexity') {
            setProgressMessage(`Fetching ads from AdPlexity (~${estimateAdplexityCredits(limit)} credits)...`);
        } else {
            const apiCalls = LIMIT_OPTIONS.find(o => o.value === limit)?.apiCalls || 1;
            setProgressMessage(`Fetching ads from Facebook (${apiCalls} API call${apiCalls > 1 ? 's' : ''})...`);
        }
        showInfo('Starting scrape...');

        try {
            const negativeList = negativeKeywords
                .split(',')
                .map(k => k.trim())
                .filter(k => k.length > 0);

            setProgressMessage('Processing and filtering ads...');

            const result = await searchAndSave({
                query,
                source,
                platform: 'facebook',
                limit,
                country,
                offset: 0,
                exclude_ids: [],
                negative_keywords: negativeList,
                vertical_id: selectedVertical?.id || null,
                search_type: searchType,
                schedule_config: null
            });

            setProgressMessage('Saving to database...');
            showSuccess(`Saved ${result.ads_count} ads from search`);
            setQuery('');
            setNegativeKeywords('');
            fetchSavedSearches();
            fetchApiUsage();
            fetchRateLimit();
            // Refresh aggregated ads if in a vertical
            if (selectedVertical) {
                fetchAggregatedAds();
                setActiveTab('vertical-detail');
            }
        } catch (error) {
            console.error('Scrape failed', error);
            showError(error.response?.data?.detail || 'Scrape failed. Try again.');
        } finally {
            setLoading(false);
            setProgressMessage('');
        }
    };

    const handleDelete = async (searchId) => {
        try {
            await deleteSavedSearch(searchId);
            showSuccess('Search deleted');
            fetchSavedSearches();
            if (selectedSearch?.id === searchId) {
                setSelectedSearch(null);
            }
        } catch (error) {
            console.error('Delete failed', error);
            showError('Failed to delete');
        }
    };

    const viewSearch = (search) => {
        // Filter out ads from blacklisted pages and keywords
        const blacklistedPageNames = blacklist.map(b => b.page_name.toLowerCase());
        const blacklistedKeywordsLower = keywordBlacklist.map(k => k.keyword.toLowerCase());

        const filteredAds = search.ads.filter(ad => {
            // Check page blacklist
            if (blacklistedPageNames.includes(ad.brand_name?.toLowerCase())) {
                return false;
            }

            // Check keyword blacklist
            const bodyText = ad.ad_copy?.toLowerCase() || '';
            const titleText = ad.headline?.toLowerCase() || '';
            const captionText = ad.cta_text?.toLowerCase() || '';
            const brandName = ad.brand_name?.toLowerCase() || '';

            for (const keyword of blacklistedKeywordsLower) {
                if (bodyText.includes(keyword) ||
                    titleText.includes(keyword) ||
                    captionText.includes(keyword) ||
                    brandName.includes(keyword)) {
                    return false;
                }
            }

            return true;
        });

        setSelectedSearch({
            ...search,
            ads: filteredAds
        });
        setActiveTab('ads');
    };

    const handleAddToBlacklist = async (pageName) => {
        if (!pageName) {
            setShowBlacklistModal(true);
            return;
        }

        try {
            await addToBlacklist(pageName);
            showSuccess(`Added "${pageName}" to blacklist`);
            fetchBlacklist();
            setBlacklistPageName('');
            setShowBlacklistModal(false);

            // Remove ads from this page from current view
            if (selectedSearch) {
                const filteredAds = selectedSearch.ads.filter(
                    ad => ad.brand_name?.toLowerCase() !== pageName.toLowerCase()
                );
                setSelectedSearch({
                    ...selectedSearch,
                    ads: filteredAds
                });
            }
        } catch (error) {
            const errorMsg = error.response?.data?.detail || 'Failed to add to blacklist';
            showError(errorMsg);
        }
    };

    const handleRemoveFromBlacklist = async (id, pageName) => {
        try {
            await removeFromBlacklist(id);
            showSuccess(`Removed "${pageName}" from blacklist`);
            fetchBlacklist();
        } catch (error) {
            showError('Failed to remove from blacklist');
        }
    };

    const handleAddToKeywordBlacklist = async (keyword) => {
        if (!keyword) {
            setShowKeywordModal(true);
            return;
        }

        try {
            await addToKeywordBlacklist(keyword);
            showSuccess(`Added "${keyword}" to keyword blacklist`);
            fetchKeywordBlacklist();
            setBlacklistKeyword('');
            setShowKeywordModal(false);

            // Remove ads containing this keyword from current view
            if (selectedSearch) {
                const keywordLower = keyword.toLowerCase();
                const filteredAds = selectedSearch.ads.filter(ad => {
                    const bodyText = ad.ad_copy?.toLowerCase() || '';
                    const titleText = ad.headline?.toLowerCase() || '';
                    const captionText = ad.cta_text?.toLowerCase() || '';
                    const brandName = ad.brand_name?.toLowerCase() || '';

                    return !bodyText.includes(keywordLower) &&
                           !titleText.includes(keywordLower) &&
                           !captionText.includes(keywordLower) &&
                           !brandName.includes(keywordLower);
                });
                setSelectedSearch({
                    ...selectedSearch,
                    ads: filteredAds
                });
            }
        } catch (error) {
            showError('Failed to add to keyword blacklist');
        }
    };

    const handleRemoveFromKeywordBlacklist = async (id, keyword) => {
        try {
            await removeFromKeywordBlacklist(id);
            showSuccess(`Removed "${keyword}" from keyword blacklist`);
            fetchKeywordBlacklist();
        } catch (error) {
            showError('Failed to remove from keyword blacklist');
        }
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-ink">Ad Research</h1>
                <p className="text-ink-secondary mt-2">
                    Scrape Facebook Ads Library and save searches with ads
                </p>
            </div>


            {/* Verticals Tab */}
            {activeTab === 'verticals' && !selectedVertical && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h2 className="text-2xl font-bold">Research Verticals</h2>
                            <p className="text-ink-secondary mt-1">Select a vertical to view and manage searches</p>
                        </div>
                        <button
                            onClick={() => setShowVerticalModal(true)}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm"
                        >
                            + New Vertical
                        </button>
                    </div>

                    {verticals.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="max-w-md mx-auto">
                                <h3 className="text-lg font-semibold text-ink mb-2">No Verticals Yet</h3>
                                <p className="text-ink-secondary mb-4">
                                    Create verticals to organize your research by category (Legal, Fitness, E-commerce, etc.)
                                </p>
                                <button
                                    onClick={() => setShowVerticalModal(true)}
                                    className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                                >
                                    Create Your First Vertical
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {verticals.map((vertical) => (
                                <button
                                    key={vertical.id}
                                    onClick={() => {
                                        setSelectedVertical(vertical);
                                        setActiveTab('vertical-detail');
                                    }}
                                    className="bg-surface p-6 rounded-lg border-2 border-border shadow-sm hover:border-indigo-500 hover:shadow-md transition-all text-left"
                                >
                                    <h3 className="font-semibold text-xl text-ink mb-2">{vertical.name}</h3>
                                    {vertical.description && (
                                        <p className="text-ink-secondary text-sm mb-4">{vertical.description}</p>
                                    )}
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-ink-tertiary">
                                            Created {new Date(vertical.created_at).toLocaleDateString()}
                                        </span>
                                        <span className="text-indigo-600 font-medium">View →</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Vertical Detail View */}
            {activeTab === 'vertical-detail' && selectedVertical && (
                <div className="space-y-6">
                    <div className="flex items-center gap-4 mb-6">
                        <button
                            onClick={() => {
                                setSelectedVertical(null);
                                setActiveTab('verticals');
                            }}
                            className="text-ink-secondary hover:text-ink"
                        >
                            ← Back to Verticals
                        </button>
                        <div>
                            <h2 className="text-2xl font-bold">{selectedVertical.name}</h2>
                            {selectedVertical.description && (
                                <p className="text-ink-secondary">{selectedVertical.description}</p>
                            )}
                        </div>
                    </div>

                    {/* Vertical Detail Tabs */}
                    <div className="border-b border-border">
                        <div className="flex gap-4">
                            <button
                                onClick={() => setVerticalTab('aggregated')}
                                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                                    verticalTab === 'aggregated'
                                        ? 'border-indigo-600 text-indigo-600'
                                        : 'border-transparent text-ink-secondary hover:text-ink'
                                }`}
                            >
                                Aggregated Ads
                            </button>
                            <button
                                onClick={() => setVerticalTab('search')}
                                className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                                    verticalTab === 'search'
                                        ? 'border-indigo-600 text-indigo-600'
                                        : 'border-transparent text-ink-secondary hover:text-ink'
                                }`}
                            >
                                Search & History
                            </button>
                        </div>
                    </div>

                    {/* Aggregated Ads Tab */}
                    {verticalTab === 'aggregated' && (
                        <div className="bg-surface rounded-lg border border-border p-6">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 className="text-lg font-semibold">Unique Ads by Page</h3>
                                    {aggregatedAds.length > 0 && (
                                        <p className="text-sm text-ink-secondary mt-1">
                                            Total: {aggregatedAds.reduce((sum, page) => sum + page.total_ads, 0)} unique ads across {aggregatedAds.length} pages
                                        </p>
                                    )}
                                </div>
                                {aggregatedAds.length > 0 && (
                                    <input
                                        type="text"
                                        value={aggregatedFilter}
                                        onChange={(e) => setAggregatedFilter(e.target.value)}
                                        placeholder="Filter by keyword..."
                                        className="px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none w-64"
                                    />
                                )}
                            </div>
                            {aggregatedAds.length === 0 ? (
                                <p className="text-ink-tertiary text-center py-8">No ads yet. Run a search to see aggregated results.</p>
                            ) : (
                                <div className="space-y-2">
                                    {(() => {
                                        // Filter pages by keyword
                                        const filteredPages = aggregatedFilter.trim()
                                            ? aggregatedAds.filter(page =>
                                                page.page_name.toLowerCase().includes(aggregatedFilter.toLowerCase())
                                            )
                                            : aggregatedAds;

                                        return filteredPages.length === 0 ? (
                                            <p className="text-ink-tertiary text-center py-8">No pages match your filter.</p>
                                        ) : (<>
                                        <div className="flex items-center gap-3 px-1 pb-1">
                                            <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={filteredPages.length > 0 && filteredPages.every(p => selectedPageIds.has(p.page_id))}
                                                    onChange={() => toggleSelectAllPages(filteredPages.map(p => p.page_id))}
                                                    className="rounded border-border"
                                                />
                                                Select all
                                            </label>
                                            {selectedPageIds.size > 0 && (
                                                <div className="flex items-center gap-2 ml-auto">
                                                    <span className="text-sm text-ink-secondary">{selectedPageIds.size} page{selectedPageIds.size === 1 ? '' : 's'} selected</span>
                                                    <button
                                                        onClick={() => setBatchDeletePending(true)}
                                                        className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                                                    >
                                                        🗑 Delete Selected
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        {filteredPages.map((page) => (
                                        <div key={page.page_id} className="border border-border rounded-lg overflow-hidden">
                                            <div className="px-4 py-3 bg-surface-hover flex items-center justify-between">
                                                <div className="flex-1 flex items-center gap-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedPageIds.has(page.page_id)}
                                                        onChange={() => togglePageSelection(page.page_id)}
                                                        className="rounded border-border"
                                                    />
                                                    <span
                                                        onClick={() => togglePageExpansion(page.page_id)}
                                                        className="text-ink-secondary hover:text-ink transition-transform cursor-pointer select-none"
                                                        style={{ transform: expandedPages.has(page.page_id) ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                                    >
                                                        ▶
                                                    </span>
                                                    <div>
                                                        <h4 className="font-semibold text-ink">{page.page_name}</h4>
                                                        <div className="flex items-center gap-4 mt-1 text-sm">
                                                            <span className="text-ink-secondary font-medium">
                                                                {page.total_ads} unique ads
                                                            </span>
                                                            <div className="flex items-center gap-3 text-xs">
                                                                {page.image_count > 0 && (
                                                                    <span className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-700 rounded">
                                                                        📷 {page.image_count} images
                                                                    </span>
                                                                )}
                                                                {page.video_count > 0 && (
                                                                    <span className="inline-flex items-center px-2 py-1 bg-purple-100 text-purple-700 rounded">
                                                                        🎥 {page.video_count} videos
                                                                    </span>
                                                                )}
                                                                {page.carousel_count > 0 && (
                                                                    <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-700 rounded">
                                                                        🎠 {page.carousel_count} carousels
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => handleAddToBlacklist(page.page_name)}
                                                        className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                                                        title="Excludes this page from future scrapes and hides it from view"
                                                    >
                                                        Block Page
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeletePageClick(page)}
                                                        disabled={deletingPageId === page.page_id}
                                                        className="px-3 py-1 text-sm bg-red-50 text-red-600 rounded hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title="Permanently deletes every scraped ad from this page in this vertical"
                                                    >
                                                        {deletingPageId === page.page_id ? 'Removing...' : '🗑 Delete All Ads'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Expanded ads */}
                                            {expandedPages.has(page.page_id) && (
                                                <div className="px-4 py-3 bg-surface border-t border-border">
                                                    {!pageAds[page.page_id] ? (
                                                        <div className="text-center py-4 text-ink-tertiary">Loading ads...</div>
                                                    ) : pageAds[page.page_id].length === 0 ? (
                                                        <div className="text-center py-4 text-ink-tertiary">No ads found</div>
                                                    ) : (
                                                        <div className="space-y-3">
                                                            {(() => {
                                                                // Filter ads by keyword when expanded
                                                                const filteredAds = aggregatedFilter.trim()
                                                                    ? pageAds[page.page_id].filter(ad => {
                                                                        const searchText = aggregatedFilter.toLowerCase();
                                                                        return (
                                                                            (ad.headline?.toLowerCase().includes(searchText)) ||
                                                                            (ad.ad_copy?.toLowerCase().includes(searchText)) ||
                                                                            (ad.cta_text?.toLowerCase().includes(searchText)) ||
                                                                            (ad.brand_name?.toLowerCase().includes(searchText))
                                                                        );
                                                                    })
                                                                    : pageAds[page.page_id];

                                                                return filteredAds.length === 0 ? (
                                                                    <div className="text-center py-4 text-ink-tertiary">No ads match your filter.</div>
                                                                ) : filteredAds.map((ad) => (
                                                                <div key={ad.id} className="border border-border rounded p-3 hover:shadow-sm">
                                                                    <div className="flex justify-between items-start mb-2">
                                                                        <div className="flex-1">
                                                                            {ad.headline && (
                                                                                <h5 className="font-semibold text-ink">{ad.headline}</h5>
                                                                            )}
                                                                            {ad.ad_copy && (
                                                                                <p className="text-sm text-ink-secondary mt-1">{ad.ad_copy}</p>
                                                                            )}
                                                                        </div>
                                                                        {ad.media_type && (
                                                                            <span className="ml-2 px-2 py-1 text-xs bg-surface-hover text-ink-secondary rounded">
                                                                                {ad.media_type}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center justify-between text-xs text-ink-tertiary mt-2">
                                                                        <div className="flex items-center gap-3">
                                                                            {ad.cta_text && (
                                                                                <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded">
                                                                                    CTA: {ad.cta_text}
                                                                                </span>
                                                                            )}
                                                                            <span className={`px-2 py-1 rounded font-medium ${
                                                                                (ad.seen_count || 1) > 1
                                                                                    ? 'bg-green-100 text-green-700'
                                                                                    : 'bg-surface-hover text-ink-secondary'
                                                                            }`}>
                                                                                Seen {ad.seen_count || 1}x
                                                                            </span>
                                                                            {ad.run_duration_days != null && (
                                                                                <span className="px-2 py-1 bg-brand-50 text-brand-700 rounded font-medium" title="Days this ad has been running — the strongest signal available that it's still working">
                                                                                    Running {ad.run_duration_days}d
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-3">
                                                                            <a
                                                                                href={ad.ad_link}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="text-indigo-600 hover:text-indigo-800"
                                                                            >
                                                                                View Ad →
                                                                            </a>
                                                                            {promotedAdIds.has(ad.id) ? (
                                                                                <span className="px-2 py-1 bg-green-100 text-green-700 rounded font-medium">
                                                                                    ✓ Marked as Winner
                                                                                </span>
                                                                            ) : (
                                                                                <button
                                                                                    onClick={() => handlePromoteAd(ad)}
                                                                                    disabled={promotingAdId === ad.id}
                                                                                    className="px-2 py-1 bg-brand-100 text-brand-700 rounded font-medium hover:bg-brand-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                                    title="Analyzes this ad's structure with AI and adds it to your Winning Ads blueprint library"
                                                                                >
                                                                                    {promotingAdId === ad.id ? 'Marking...' : '★ Mark as Winner'}
                                                                                </button>
                                                                            )}
                                                                            <button
                                                                                onClick={() => handleDeleteAdClick(ad, page.page_id)}
                                                                                disabled={deletingAdId === ad.id}
                                                                                className="px-2 py-1 bg-red-50 text-red-600 rounded font-medium hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                                                                title="Remove this ad from the dashboard"
                                                                            >
                                                                                {deletingAdId === ad.id ? 'Removing...' : '🗑 Remove'}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    </>)
                                })()}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Search & History Tab */}
                    {verticalTab === 'search' && (
                        <div className="space-y-6">
                            {/* New Search Form */}
                    <div className="bg-surface rounded-lg border border-border p-6">
                        <h3 className="text-lg font-semibold mb-4">New Search</h3>
                        <form onSubmit={handleScrape} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-ink-secondary mb-2">Source</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 text-sm text-ink-secondary">
                                        <input
                                            type="radio"
                                            name="source"
                                            value="facebook"
                                            checked={source === 'facebook'}
                                            onChange={() => setSource('facebook')}
                                        />
                                        Facebook Ad Library (free)
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-ink-secondary">
                                        <input
                                            type="radio"
                                            name="source"
                                            value="adplexity"
                                            checked={source === 'adplexity'}
                                            onChange={() => setSource('adplexity')}
                                        />
                                        AdPlexity (uses credits)
                                    </label>
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-4">
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search keyword (e.g. 'fitness', 'Nike')"
                                    className="flex-1 p-3 border border-border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                />
                                <select
                                    value={country}
                                    onChange={(e) => setCountry(e.target.value)}
                                    className="p-3 border border-border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-surface"
                                >
                                    {COUNTRIES.map((c) => (
                                        <option key={c.code} value={c.code}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-4">
                                <input
                                    type="text"
                                    value={negativeKeywords}
                                    onChange={(e) => setNegativeKeywords(e.target.value)}
                                    placeholder="Negative keywords (comma-separated)"
                                    className="flex-1 p-3 border border-border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                />
                                <select
                                    value={limit}
                                    onChange={(e) => setLimit(parseInt(e.target.value))}
                                    className="p-3 border border-border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-surface"
                                >
                                    {LIMIT_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ink-secondary mb-2">Search Type</label>
                                <select
                                    value={searchType}
                                    onChange={(e) => setSearchType(e.target.value)}
                                    className="w-full p-3 border border-border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-surface"
                                >
                                    <option value="one_time">One-Time Search</option>
                                    <option value="scheduled_daily">Scheduled Daily</option>
                                    <option value="scheduled_weekly">Scheduled Weekly</option>
                                </select>
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm space-y-2">
                                {source === 'adplexity' ? (
                                    <div className="flex items-center justify-between">
                                        <span className="text-ink-secondary">
                                            Estimated cost: <strong>~{estimateAdplexityCredits(limit)} credits</strong>
                                        </span>
                                        <span className="text-ink-tertiary">
                                            (1 base + 1 per result returned, may be less if fewer results exist)
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between">
                                        <span className="text-ink-secondary">
                                            API Calls: <strong>{LIMIT_OPTIONS.find(o => o.value === limit)?.apiCalls || 1}</strong>
                                        </span>
                                        <span className="text-ink-tertiary">
                                            (Facebook Ads Library API limit: 300 ads/call)
                                        </span>
                                    </div>
                                )}
                                {source === 'facebook' && rateLimit && (
                                    <div className="flex items-center justify-between pt-2 border-t border-blue-200">
                                        <span className="text-ink-secondary">
                                            Rate Limit: <strong className={rateLimit.remaining < 50 ? 'text-red-600' : 'text-green-600'}>
                                                {rateLimit.remaining}/{rateLimit.limit}
                                            </strong> remaining
                                        </span>
                                        {rateLimit.reset_in_seconds > 0 && (
                                            <span className="text-ink-tertiary">
                                                Resets in {Math.ceil(rateLimit.reset_in_seconds / 60)} min
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            {loading && progressMessage && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
                                    <div className="flex items-center gap-2">
                                        <svg className="animate-spin h-5 w-5 text-yellow-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <span className="text-ink-secondary">{progressMessage}</span>
                                    </div>
                                </div>
                            )}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            >
                                {loading ? 'Scraping...' : 'Scrape & Save'}
                            </button>
                        </form>
                    </div>

                            {/* Saved Searches for this vertical */}
                            <div className="bg-surface rounded-lg border border-border p-6">
                                <h3 className="text-lg font-semibold mb-4">Saved Searches</h3>
                                {savedSearches.filter(s => s.vertical_id === selectedVertical.id).length === 0 ? (
                                    <p className="text-ink-tertiary text-center py-8">No searches yet for this vertical.</p>
                                ) : (
                                    <div className="space-y-4">
                                        {savedSearches.filter(s => s.vertical_id === selectedVertical.id).map((search) => (
                                            <div
                                                key={search.id}
                                                className="border border-border rounded-lg p-4 hover:shadow-md transition-shadow"
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <h3 className="text-lg font-semibold text-ink">
                                                                "{search.query}" in {search.country}
                                                            </h3>
                                                            {search.search_type !== 'one_time' && (
                                                                <span className={`px-2 py-1 text-xs rounded ${
                                                                    search.search_type === 'scheduled_daily' ? 'bg-blue-100 text-blue-700' :
                                                                    search.search_type === 'scheduled_weekly' ? 'bg-purple-100 text-purple-700' :
                                                                    'bg-surface-hover text-ink-secondary'
                                                                }`}>
                                                                    {search.search_type === 'scheduled_daily' ? 'Daily' :
                                                                     search.search_type === 'scheduled_weekly' ? 'Weekly' : search.search_type}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-ink-tertiary mt-1">
                                                            {search.ads?.length || 0} ads • {new Date(search.created_at).toLocaleString()}
                                                        </p>
                                                        {(search.ads_requested || search.ads_returned || search.ads_new || search.ads_duplicate) && (
                                                            <p className="text-xs text-ink-tertiary mt-1">
                                                                Requested: {search.ads_requested || 0} • Returned: {search.ads_returned || 0} • New: {search.ads_new || 0} • Duplicates: {search.ads_duplicate || 0}
                                                            </p>
                                                        )}
                                                        {search.negative_keywords && search.negative_keywords.length > 0 && (
                                                            <p className="text-xs text-ink-tertiary mt-1">
                                                                Excluded: {search.negative_keywords.join(', ')}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => viewSearch(search)}
                                                            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                                        >
                                                            View Ads
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(search.id)}
                                                            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Ads View Tab */}
            {activeTab === 'ads' && selectedVertical && (
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <div>
                            <button
                                onClick={() => {
                                    setSelectedSearch(null);
                                    setActiveTab('vertical-detail');
                                }}
                                className="text-indigo-600 hover:text-indigo-800 mb-2 flex items-center gap-1"
                            >
                                ← Back to Searches
                            </button>
                            <h2 className="text-2xl font-bold text-ink">
                                {selectedVertical.name} - All Ads
                            </h2>
                            <p className="text-ink-secondary mt-1">
                                Grouped by page
                            </p>
                        </div>
                    </div>

                    {(() => {
                        // Get all ads from all searches in this vertical
                        const allAds = savedSearches
                            .filter(s => s.vertical_id === selectedVertical.id)
                            .flatMap(search =>
                                (search.ads || []).map(ad => ({
                                    ...ad,
                                    searchQuery: search.query,
                                    searchId: search.id
                                }))
                            );

                        // Filter out blacklisted pages
                        const blacklistedPageNames = blacklist.map(b => b.page_name.toLowerCase());
                        const filteredAds = allAds.filter(ad =>
                            !blacklistedPageNames.includes(ad.brand_name?.toLowerCase())
                        );

                        // Group by page name
                        const adsByPage = filteredAds.reduce((acc, ad) => {
                            const pageName = ad.brand_name || 'Unknown Page';
                            if (!acc[pageName]) {
                                acc[pageName] = [];
                            }
                            acc[pageName].push(ad);
                            return acc;
                        }, {});

                        // Get unique ads per page and collect search tags
                        const pageGroups = Object.entries(adsByPage).map(([pageName, ads]) => {
                            const uniqueAds = {};
                            ads.forEach(ad => {
                                if (!uniqueAds[ad.id]) {
                                    uniqueAds[ad.id] = { ...ad, searches: new Set([ad.searchQuery]) };
                                } else {
                                    uniqueAds[ad.id].searches.add(ad.searchQuery);
                                }
                            });
                            return {
                                pageName,
                                ads: Object.values(uniqueAds),
                                totalAds: Object.keys(uniqueAds).length
                            };
                        }).sort((a, b) => b.totalAds - a.totalAds);

                        const togglePage = (pageName) => {
                            const newExpanded = new Set(expandedPages);
                            if (newExpanded.has(pageName)) {
                                newExpanded.delete(pageName);
                            } else {
                                newExpanded.add(pageName);
                            }
                            setExpandedPages(newExpanded);
                        };

                        return pageGroups.length === 0 ? (
                            <div className="text-center py-16 bg-surface rounded-lg border border-border">
                                <p className="text-ink-tertiary">No ads found in this vertical</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {pageGroups.map(({ pageName, ads, totalAds }) => (
                                    <div key={pageName} className="bg-surface rounded-lg border border-border overflow-hidden">
                                        <button
                                            onClick={() => togglePage(pageName)}
                                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-hover transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-ink-tertiary">
                                                    {expandedPages.has(pageName) ? '▼' : '▶'}
                                                </span>
                                                <div className="text-left">
                                                    <h3 className="font-semibold text-ink">{pageName}</h3>
                                                    <p className="text-sm text-ink-tertiary">{totalAds} unique ads</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleAddToBlacklist(pageName);
                                                }}
                                                className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                                            >
                                                Block Page
                                            </button>
                                        </button>

                                        {expandedPages.has(pageName) && (
                                            <div className="border-t border-border">
                                                <table className="min-w-full">
                                                    <thead className="bg-surface-hover">
                                                        <tr>
                                                            <th className="px-4 py-2 text-left text-xs font-medium text-ink-tertiary uppercase">Headline</th>
                                                            <th className="px-4 py-2 text-left text-xs font-medium text-ink-tertiary uppercase">Ad Copy</th>
                                                            <th className="px-4 py-2 text-left text-xs font-medium text-ink-tertiary uppercase">CTA</th>
                                                            <th className="px-4 py-2 text-left text-xs font-medium text-ink-tertiary uppercase">Searches</th>
                                                            <th className="px-4 py-2 text-left text-xs font-medium text-ink-tertiary uppercase">Seen</th>
                                                            <th className="px-4 py-2 text-left text-xs font-medium text-ink-tertiary uppercase">Started</th>
                                                            <th className="px-4 py-2 text-left text-xs font-medium text-ink-tertiary uppercase">Actions</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-border">
                                                        {ads.map((ad) => (
                                                            <tr key={ad.id} className="hover:bg-surface-hover">
                                                                <td className="px-4 py-2 text-sm text-ink-secondary max-w-xs">
                                                                    <div className="line-clamp-2">{ad.headline || '-'}</div>
                                                                </td>
                                                                <td className="px-4 py-2 text-sm text-ink-secondary max-w-md">
                                                                    <div className="line-clamp-2">{ad.ad_copy || '-'}</div>
                                                                </td>
                                                                <td className="px-4 py-2 text-sm">
                                                                    {ad.cta_text && (
                                                                        <span className="inline-block px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs">
                                                                            {ad.cta_text}
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-2 text-sm">
                                                                    <div className="flex gap-1 flex-wrap">
                                                                        {Array.from(ad.searches).map((search, idx) => (
                                                                            <span key={idx} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                                                                {search}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-2 text-sm text-ink-secondary text-center">
                                                                    <span className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                                                                        {ad.seen_count || 1}x
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-2 text-sm text-ink-tertiary whitespace-nowrap">
                                                                    {ad.start_date ? new Date(ad.start_date).toLocaleDateString() : '-'}
                                                                </td>
                                                                <td className="px-4 py-2 text-sm whitespace-nowrap">
                                                                    <div className="flex items-center gap-3">
                                                                        <a
                                                                            href={ad.ad_link}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="text-indigo-600 hover:text-indigo-900"
                                                                        >
                                                                            View
                                                                        </a>
                                                                        {promotedAdIds.has(ad.id) ? (
                                                                            <span className="text-green-700 font-medium">✓ Winner</span>
                                                                        ) : (
                                                                            <button
                                                                                onClick={() => handlePromoteAd(ad)}
                                                                                disabled={promotingAdId === ad.id}
                                                                                className="text-brand-700 hover:text-brand-900 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                                                title="Analyzes this ad's structure with AI and adds it to your Winning Ads blueprint library"
                                                                            >
                                                                                {promotingAdId === ad.id ? 'Marking...' : '★ Mark as Winner'}
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            onClick={() => handleDeleteAdClick(ad, null)}
                                                                            disabled={deletingAdId === ad.id}
                                                                            className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                                            title="Remove this ad from the dashboard"
                                                                        >
                                                                            {deletingAdId === ad.id ? 'Removing...' : '🗑 Remove'}
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* Vertical Modal */}
            {showVerticalModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-surface rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold mb-4">Add Vertical</h3>
                        <div className="space-y-4">
                            <input
                                type="text"
                                value={newVerticalName}
                                onChange={(e) => setNewVerticalName(e.target.value)}
                                placeholder="Vertical name (e.g., Legal, Fitness)"
                                className="w-full p-3 border border-border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                autoFocus
                            />
                            <textarea
                                value={newVerticalDescription}
                                onChange={(e) => setNewVerticalDescription(e.target.value)}
                                placeholder="Description (optional)"
                                className="w-full p-3 border border-border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                rows="3"
                            />
                        </div>
                        <div className="flex gap-2 mt-6">
                            <button
                                onClick={() => {
                                    setShowVerticalModal(false);
                                    setNewVerticalName('');
                                    setNewVerticalDescription('');
                                }}
                                className="flex-1 px-4 py-2 border border-border text-ink-secondary rounded hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateVertical}
                                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Ad Confirmation Modal */}
            {adPendingDelete && (
                <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-surface rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xl flex-shrink-0">
                                🗑
                            </div>
                            <h3 className="text-lg font-semibold text-ink">Remove this ad?</h3>
                        </div>
                        <p className="text-sm text-ink-secondary mb-6">
                            {adPendingDelete.ad.headline || 'This ad'} will be permanently removed from your research dashboard. This can't be undone
                            {adPendingDelete.ad && promotedAdIds.has(adPendingDelete.ad.id)
                                ? ' — its Winning Ads blueprint will stay intact.'
                                : '.'}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setAdPendingDelete(null)}
                                disabled={deletingAdId === adPendingDelete.ad.id}
                                className="flex-1 px-4 py-2 border border-border text-ink-secondary rounded hover:bg-surface-hover disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeleteAd}
                                disabled={deletingAdId === adPendingDelete.ad.id}
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                            >
                                {deletingAdId === adPendingDelete.ad.id ? 'Removing...' : 'Remove'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Page Ads Confirmation Modal */}
            {pagePendingDelete && (
                <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-surface rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xl flex-shrink-0">
                                🗑
                            </div>
                            <h3 className="text-lg font-semibold text-ink">Delete all ads from this page?</h3>
                        </div>
                        <p className="text-sm text-ink-secondary mb-6">
                            All {pagePendingDelete.total_ads} ad{pagePendingDelete.total_ads === 1 ? '' : 's'} scraped from <strong>{pagePendingDelete.page_name}</strong> in
                            this vertical will be permanently removed from your research dashboard. This can't be undone — any already-promoted
                            Winning Ads blueprints will stay intact. This doesn't stop future scrapes from returning this page again; use Block Page for that.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPagePendingDelete(null)}
                                disabled={deletingPageId === pagePendingDelete.page_id}
                                className="flex-1 px-4 py-2 border border-border text-ink-secondary rounded hover:bg-surface-hover disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDeletePage}
                                disabled={deletingPageId === pagePendingDelete.page_id}
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                            >
                                {deletingPageId === pagePendingDelete.page_id ? 'Removing...' : 'Delete All Ads'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Batch Delete Pages Confirmation Modal */}
            {batchDeletePending && (
                <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-surface rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xl flex-shrink-0">
                                🗑
                            </div>
                            <h3 className="text-lg font-semibold text-ink">Delete ads from {selectedPageIds.size} page{selectedPageIds.size === 1 ? '' : 's'}?</h3>
                        </div>
                        <p className="text-sm text-ink-secondary mb-6">
                            All {aggregatedAds.filter(p => selectedPageIds.has(p.page_id)).reduce((sum, p) => sum + p.total_ads, 0)} ads
                            scraped from these {selectedPageIds.size} page{selectedPageIds.size === 1 ? '' : 's'} in this vertical will be permanently removed
                            from your research dashboard. This can't be undone — any already-promoted Winning Ads blueprints will stay intact.
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setBatchDeletePending(false)}
                                disabled={batchDeleting}
                                className="flex-1 px-4 py-2 border border-border text-ink-secondary rounded hover:bg-surface-hover disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmBatchDeletePages}
                                disabled={batchDeleting}
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                            >
                                {batchDeleting ? 'Removing...' : 'Delete Selected'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Research;
