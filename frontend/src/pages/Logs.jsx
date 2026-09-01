import React, { useCallback, useEffect, useState } from 'react';
import { BarChart, Clock, CreditCard, RefreshCw, CheckCircle2, XCircle, Loader } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const PAGE_SIZE = 25;

function formatDuration(ms) {
    if (ms == null) return '—';
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.round(seconds % 60);
    return `${minutes}m ${remaining}s`;
}

function formatCost(amount, provider) {
    if (amount == null) return '—';
    if (provider === 'kie') return `${amount.toFixed(1)} credits`;
    return `$${amount.toFixed(4)}`;
}

function formatBalance(balance, unit) {
    if (balance == null) return 'Unavailable';
    if (unit === 'usd') return `$${balance.toFixed(2)}`;
    return `${Math.round(balance).toLocaleString()} credits`;
}

const STATUS_BADGE = {
    success: { icon: CheckCircle2, className: 'bg-green-50 text-green-700 border-green-200' },
    error: { icon: XCircle, className: 'bg-red-50 text-red-700 border-red-200' },
    pending: { icon: Loader, className: 'bg-brand-50 text-brand-700 border-brand-200' },
};

function StatusBadge({ status }) {
    const cfg = STATUS_BADGE[status] || STATUS_BADGE.pending;
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
            <Icon size={12} className={status === 'pending' ? 'animate-spin' : ''} />
            {status}
        </span>
    );
}

const Logs = () => {
    const { authFetch } = useAuth();
    const [balances, setBalances] = useState([]);
    const [summary, setSummary] = useState(null);
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [filters, setFilters] = useState({ media_type: '', provider: '', status: '' });
    const [loading, setLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            Object.entries(filters).forEach(([key, value]) => {
                if (value) params.set(key, value);
            });
            params.set('skip', String(page * PAGE_SIZE));
            params.set('limit', String(PAGE_SIZE));

            const [balancesRes, summaryRes, logsRes] = await Promise.all([
                authFetch(`${API_URL}/ai-usage/balances`),
                authFetch(`${API_URL}/ai-usage/summary`),
                authFetch(`${API_URL}/ai-usage/logs?${params.toString()}`),
            ]);
            if (balancesRes.ok) setBalances((await balancesRes.json()).balances);
            if (summaryRes.ok) setSummary(await summaryRes.json());
            if (logsRes.ok) {
                const data = await logsRes.json();
                setLogs(data.logs);
                setTotal(data.total);
            }
        } catch (error) {
            console.error('Failed to fetch AI usage data:', error);
        } finally {
            setLoading(false);
        }
    }, [authFetch, filters, page]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const updateFilter = (key, value) => {
        setPage(0);
        setFilters((prev) => ({ ...prev, [key]: value }));
    };

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-ink mb-2 flex items-center gap-3">
                        <BarChart size={32} className="text-brand-600" />
                        AI Generation Logs
                    </h1>
                    <p className="text-ink-secondary">Cost, duration, and provider balances for image/video ad generation</p>
                </div>
                <button
                    onClick={fetchAll}
                    className="p-2 text-ink-tertiary hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                    title="Refresh"
                >
                    <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Provider Balance Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {balances.map((b) => (
                    <div key={b.provider} className="bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-3 rounded-lg bg-brand-50">
                                <CreditCard className="text-brand-600" size={24} />
                            </div>
                            {b.error && <span className="text-xs text-red-500">{b.error}</span>}
                        </div>
                        <h3 className="text-ink-tertiary text-sm font-medium">
                            {b.provider === 'kie' ? 'Kie.ai Balance' : 'Fal.ai Balance'}
                        </h3>
                        <p className="text-2xl font-bold text-ink mt-1">{formatBalance(b.balance, b.unit)}</p>
                    </div>
                ))}
            </div>

            {/* Summary Stats */}
            {summary && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-ink-tertiary text-sm font-medium">Total Generations</h3>
                        <p className="text-2xl font-bold text-ink mt-1">{summary.total}</p>
                    </div>
                    <div className="bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-ink-tertiary text-sm font-medium">Success Rate</h3>
                        <p className="text-2xl font-bold text-ink mt-1">
                            {summary.success_rate != null ? `${(summary.success_rate * 100).toFixed(0)}%` : '—'}
                        </p>
                    </div>
                    <div className="bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <h3 className="text-ink-tertiary text-sm font-medium">Kie.ai Credits Spent</h3>
                        <p className="text-2xl font-bold text-ink mt-1">
                            {summary.total_kie_credits_spent != null ? summary.total_kie_credits_spent.toFixed(1) : '—'}
                        </p>
                        <p className="text-xs text-ink-tertiary mt-1">Fal.ai cost isn't tracked per-call</p>
                    </div>
                    <div className="bg-surface p-6 rounded-xl border border-border shadow-sm">
                        <div className="flex items-center gap-2">
                            <Clock size={16} className="text-ink-tertiary" />
                            <h3 className="text-ink-tertiary text-sm font-medium">Avg Duration</h3>
                        </div>
                        <p className="text-2xl font-bold text-ink mt-1">{formatDuration(summary.avg_duration_ms)}</p>
                    </div>
                </div>
            )}

            {/* Filters + Table */}
            <div className="bg-surface rounded-xl border border-border shadow-sm">
                <div className="p-6 border-b border-border flex flex-wrap gap-3">
                    <select
                        value={filters.media_type}
                        onChange={(e) => updateFilter('media_type', e.target.value)}
                        className="border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    >
                        <option value="">All Media Types</option>
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                    </select>
                    <select
                        value={filters.provider}
                        onChange={(e) => updateFilter('provider', e.target.value)}
                        className="border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    >
                        <option value="">All Providers</option>
                        <option value="kie">Kie.ai</option>
                        <option value="fal">Fal.ai</option>
                    </select>
                    <select
                        value={filters.status}
                        onChange={(e) => updateFilter('status', e.target.value)}
                        className="border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    >
                        <option value="">All Statuses</option>
                        <option value="success">Success</option>
                        <option value="error">Error</option>
                        <option value="pending">Pending</option>
                    </select>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-ink-tertiary border-b border-border">
                                <th className="px-6 py-3 font-medium">Timestamp</th>
                                <th className="px-6 py-3 font-medium">Type</th>
                                <th className="px-6 py-3 font-medium">Provider</th>
                                <th className="px-6 py-3 font-medium">Model</th>
                                <th className="px-6 py-3 font-medium">Status</th>
                                <th className="px-6 py-3 font-medium">Duration</th>
                                <th className="px-6 py-3 font-medium">Cost</th>
                                <th className="px-6 py-3 font-medium">Brand</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-ink-tertiary">
                                        No generations logged yet
                                    </td>
                                </tr>
                            )}
                            {logs.map((log) => (
                                <tr key={log.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                                    <td className="px-6 py-3 text-ink-secondary whitespace-nowrap">
                                        {new Date(log.started_at).toLocaleString()}
                                    </td>
                                    <td className="px-6 py-3 capitalize">{log.media_type}</td>
                                    <td className="px-6 py-3 uppercase text-xs font-semibold text-ink-tertiary">{log.provider}</td>
                                    <td className="px-6 py-3 text-ink-secondary">{log.model}</td>
                                    <td className="px-6 py-3">
                                        <StatusBadge status={log.status} />
                                    </td>
                                    <td className="px-6 py-3 text-ink-secondary">{formatDuration(log.duration_ms)}</td>
                                    <td className="px-6 py-3 text-ink-secondary">{formatCost(log.cost_amount, log.provider)}</td>
                                    <td className="px-6 py-3 text-ink-secondary">{log.brand_name || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex items-center justify-between px-6 py-4 border-t border-border text-sm text-ink-secondary">
                    <span>
                        Page {page + 1} of {totalPages} ({total} total)
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-hover"
                        >
                            Previous
                        </button>
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                            disabled={page >= totalPages - 1}
                            className="px-3 py-1.5 border border-border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-hover"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Logs;
