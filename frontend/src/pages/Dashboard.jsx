import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Image, Video, Star, TrendingUp, Zap, Wand2, Package, ShoppingBag, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export default function Dashboard() {
    const { authFetch } = useAuth();
    const [statsData, setStatsData] = useState({
        brands_count: 0,
        products_count: 0,
        generated_ads_count: 0,
        templates_count: 0,
        campaigns_count: 0
    });
    const [tokenStatus, setTokenStatus] = useState(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const response = await authFetch(`${API_URL}/dashboard/stats`);
                if (response.ok) {
                    const data = await response.json();
                    setStatsData(data);
                }
            } catch (error) {
                console.error('Failed to fetch dashboard stats:', error);
            }
        };

        const fetchTokenStatus = async () => {
            try {
                const response = await authFetch(`${API_URL}/dashboard/facebook-token-status`);
                if (response.ok) {
                    setTokenStatus(await response.json());
                }
            } catch (error) {
                console.error('Failed to fetch Facebook token status:', error);
            }
        };

        fetchStats();
        fetchTokenStatus();
    }, [authFetch]);

    const tokenWarningMessage = () => {
        if (!tokenStatus) return null;
        if (!tokenStatus.configured) {
            return 'Facebook Ads Library token is not configured — ad research is falling back to slower, less reliable scraping.';
        }
        if (tokenStatus.isValid === false) {
            return 'Facebook Ads Library token is no longer valid — ad research has fallen back to slower, less reliable scraping. Generate a new one via Graph API Explorer.';
        }
        if (tokenStatus.daysRemaining != null && tokenStatus.daysRemaining <= 10) {
            return `Facebook Ads Library token expires in ${tokenStatus.daysRemaining} day${tokenStatus.daysRemaining === 1 ? '' : 's'} — generate a new one via Graph API Explorer before it lapses.`;
        }
        return null;
    };
    const tokenWarning = tokenWarningMessage();

    const stats = [
        { label: 'Total Campaigns', value: statsData.campaigns_count, icon: TrendingUp },
        { label: 'Generated Ads', value: statsData.generated_ads_count, icon: Image },
        { label: 'Active Brands', value: statsData.brands_count, icon: ShoppingBag },
        { label: 'Templates', value: statsData.templates_count, icon: Star },
    ];

    const quickActions = [
        { label: 'Build Creatives', description: 'Create new image or video ads', icon: Wand2, path: '/build-creatives' },
        { label: 'Manage Brands', description: 'Update brand assets and profiles', icon: ShoppingBag, path: '/brands' },
        { label: 'Browse Templates', description: 'Explore winning ad templates', icon: Star, path: '/winning-ads' },
    ];

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-ink flex items-center gap-3">
                    <LayoutDashboard size={32} className="text-brand-600" />
                    Dashboard
                </h1>
                <p className="text-ink-secondary mt-2">Welcome to your Ad Builder workspace</p>
            </div>

            {/* Facebook Ads Library token warning */}
            {tokenWarning && (
                <div className="mb-8 flex items-start gap-3 rounded-lg border border-brand-300 bg-brand-50 px-4 py-3 text-brand-800">
                    <AlertTriangle size={20} className="mt-0.5 flex-shrink-0" />
                    <p className="text-sm font-medium">{tokenWarning}</p>
                </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {stats.map((stat, index) => {
                    const Icon = stat.icon;
                    return (
                        <div key={index} className="bg-surface rounded-xl shadow-sm border border-border p-6">
                            <div className="flex items-center justify-between mb-4">
                                <div className="bg-surface-hover w-12 h-12 rounded-lg flex items-center justify-center">
                                    <Icon className="text-brand-600 dark:text-brand-400" size={24} />
                                </div>
                            </div>
                            <div className="text-3xl font-bold text-ink mb-1">{stat.value}</div>
                            <div className="text-sm text-ink-secondary">{stat.label}</div>
                        </div>
                    );
                })}
            </div>

            {/* Quick Actions */}
            <div className="mb-8">
                <h2 className="text-xl font-bold text-ink mb-4">Quick Actions</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {quickActions.map((action, index) => {
                        const Icon = action.icon;
                        return (
                            <Link
                                key={index}
                                to={action.path}
                                className="group bg-surface rounded-xl shadow-sm border border-border p-6 hover:shadow-lg transition-all"
                            >
                                <div className="bg-brand-600 w-14 h-14 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <Icon className="text-white" size={28} />
                                </div>
                                <h3 className="text-lg font-bold text-ink mb-2">{action.label}</h3>
                                <p className="text-sm text-ink-secondary">{action.description}</p>
                            </Link>
                        );
                    })}
                </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
                <h2 className="text-xl font-bold text-ink mb-4">Recent Activity</h2>
                <div className="text-center py-12 text-ink-tertiary">
                    <Zap size={48} className="mx-auto mb-4 text-ink-tertiary" />
                    <p>No recent activity yet</p>
                    <p className="text-sm mt-2">Start creating ads to see your activity here</p>
                </div>
            </div>
        </div>
    );
}
