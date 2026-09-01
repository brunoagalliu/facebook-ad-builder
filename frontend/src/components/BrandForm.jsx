import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Unlink } from 'lucide-react';
import { useBrands } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { validateBrandName, validateHexColor, validateProductName, validateProductDescription, validateBrandVoice, validateTextInput } from '../utils/validation';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const BrandForm = ({ onClose, onSave, initialData = null }) => {
    const { customerProfiles, brands } = useBrands();
    const { showError } = useToast();
    const { authFetch } = useAuth();
    const [verticals, setVerticals] = useState([]);

    useEffect(() => {
        authFetch(`${API_URL}/research/verticals`)
            .then(res => res.ok ? res.json() : [])
            .then(setVerticals)
            .catch(() => setVerticals([]));
    }, [authFetch]);

    // Get all products from all brands
    const allProducts = brands.flatMap(brand =>
        brand.products.map(product => ({
            ...product,
            brandName: brand.name,
            brandId: brand.id
        }))
    );

    const [formData, setFormData] = useState(initialData || {
        name: '',
        logo: '',
        colors: { primary: '#3B82F6', secondary: '#10B981', highlight: '#F59E0B' },
        voice: '',
        products: [],
        profileIds: [],
        verticalId: null
    });

    // Linking a product/profile used to be a two-step "pick it, then click the link
    // button" flow — easy to miss the second click, which silently drops the selection
    // (nothing is added to formData, so Save persists nothing, with no error shown).
    // Selecting an option now links it immediately.
    const handleLinkProduct = (productId) => {
        if (productId && !formData.products.find(p => p.id === productId)) {
            const product = allProducts.find(p => p.id === productId);
            if (product) {
                // Preserve every real product field (product_shots, default_url, etc.) —
                // hand-picking a field subset here is what silently wiped product_shots
                // back to [] on save, since brands.ts writes back whatever this object
                // contains. Only strip brandName/brandId, which allProducts added above
                // and aren't real Product fields.
                const { brandName, brandId, ...productData } = product;
                setFormData({
                    ...formData,
                    products: [...formData.products, productData]
                });
            }
        }
    };

    const removeProduct = (id) => {
        setFormData({
            ...formData,
            products: formData.products.filter(p => p.id !== id)
        });
    };

    const handleLinkProfile = (profileId) => {
        if (profileId && !formData.profileIds?.includes(profileId)) {
            setFormData({
                ...formData,
                profileIds: [...(formData.profileIds || []), profileId]
            });
        }
    };

    const handleUnlinkProfile = (id) => {
        setFormData({
            ...formData,
            profileIds: (formData.profileIds || []).filter(pid => pid !== id)
        });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        try {
            // Validate all fields
            const validatedData = {
                ...formData,
                name: validateBrandName(formData.name),
                voice: validateBrandVoice(formData.voice),
                colors: {
                    primary: validateHexColor(formData.colors.primary),
                    secondary: validateHexColor(formData.colors.secondary),
                    highlight: validateHexColor(formData.colors.highlight || '#F59E0B')
                },
                products: formData.products || [],
                profileIds: formData.profileIds || []
            };
            onSave(validatedData);
        } catch (err) {
            showError(err.message);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-border">
                    <h2 className="text-xl font-bold text-ink">
                        {initialData ? 'Edit Brand' : 'Add New Brand'}
                    </h2>
                    <button onClick={onClose} className="text-ink-tertiary hover:bg-surface-hover p-2 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-ink-secondary mb-1">Brand Name</label>
                            <input
                                required
                                type="text"
                                maxLength={100}
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                className="w-full p-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="e.g. Acme Corp"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-ink-secondary mb-1">Brand Voice/Tone</label>
                            <textarea
                                value={formData.voice}
                                maxLength={500}
                                onChange={e => setFormData({ ...formData, voice: e.target.value })}
                                className="w-full p-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500"
                                rows="2"
                                placeholder="e.g. Professional, Friendly, Witty..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-ink-secondary mb-1">Vertical / Niche</label>
                            <select
                                value={formData.verticalId || ''}
                                onChange={e => setFormData({ ...formData, verticalId: e.target.value || null })}
                                className="w-full p-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">None — pick templates manually</option>
                                {verticals.map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                            </select>
                            <p className="text-xs text-ink-tertiary mt-1">
                                Optional. When set, ad generation auto-suggests a winning creative blueprint from this niche's research instead of requiring manual template selection.
                            </p>
                        </div>
                    </div>

                    {/* Colors */}
                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-2">Brand Colors</label>
                        <div className="flex gap-4">
                            <div>
                                <label className="text-xs text-ink-tertiary block mb-1">Primary</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={formData.colors.primary}
                                        onChange={e => setFormData({ ...formData, colors: { ...formData.colors, primary: e.target.value } })}
                                        className="h-10 w-10 rounded cursor-pointer border-0"
                                    />
                                    <span className="text-sm text-ink-secondary font-mono">{formData.colors.primary}</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-ink-tertiary block mb-1">Secondary</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={formData.colors.secondary}
                                        onChange={e => setFormData({ ...formData, colors: { ...formData.colors, secondary: e.target.value } })}
                                        className="h-10 w-10 rounded cursor-pointer border-0"
                                    />
                                    <span className="text-sm text-ink-secondary font-mono">{formData.colors.secondary}</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-ink-tertiary block mb-1">Highlight</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={formData.colors.highlight}
                                        onChange={e => setFormData({ ...formData, colors: { ...formData.colors, highlight: e.target.value } })}
                                        className="h-10 w-10 rounded cursor-pointer border-0"
                                    />
                                    <span className="text-sm text-ink-secondary font-mono">{formData.colors.highlight}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Products */}
                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-2">Products</label>
                        <div className="bg-surface-hover p-4 rounded-lg space-y-3">
                            <div className="flex gap-2">
                                <select
                                    value=""
                                    onChange={(e) => handleLinkProduct(e.target.value)}
                                    className="flex-1 p-2 border border-border rounded-lg text-sm"
                                >
                                    <option value="">Select a product to assign...</option>
                                    {allProducts
                                        .filter(p => !formData.products.find(fp => fp.id === p.id))
                                        .map(product => (
                                            <option key={product.id} value={product.id}>
                                                {product.name} (currently in: {product.brandName})
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>

                            {formData.products.length > 0 && (
                                <div className="space-y-2 mt-2">
                                    {formData.products.map(product => (
                                        <div key={product.id} className="flex items-center justify-between bg-surface p-3 rounded border border-border">
                                            <div>
                                                <div className="font-medium text-sm">{product.name}</div>
                                                <div className="text-xs text-ink-tertiary">{product.description}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeProduct(product.id)}
                                                className="text-red-500 hover:bg-red-50 p-1 rounded"
                                                title="Remove Product"
                                            >
                                                <Unlink size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {allProducts.length === 0 && (
                                <p className="text-xs text-ink-tertiary mt-1">
                                    No products available. Create them in the Products page first.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Customer Profiles */}
                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-2">Linked Customer Profiles</label>
                        <div className="bg-surface-hover p-4 rounded-lg space-y-3">
                            <div className="flex gap-2">
                                <select
                                    value=""
                                    onChange={(e) => handleLinkProfile(e.target.value)}
                                    className="flex-1 p-2 border border-border rounded-lg text-sm"
                                >
                                    <option value="">Select a profile to link...</option>
                                    {customerProfiles
                                        .filter(p => !(formData.profileIds || []).includes(p.id))
                                        .map(profile => (
                                            <option key={profile.id} value={profile.id}>
                                                {profile.name}
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>

                            {(formData.profileIds || []).length > 0 && (
                                <div className="space-y-2 mt-2">
                                    {(formData.profileIds || []).map(profileId => {
                                        const profile = customerProfiles.find(p => p.id === profileId);
                                        if (!profile) return null;
                                        return (
                                            <div key={profile.id} className="flex items-center justify-between bg-surface p-3 rounded border border-border">
                                                <div>
                                                    <div className="font-medium text-sm">{profile.name}</div>
                                                    <div className="text-xs text-ink-tertiary">{profile.demographics}</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleUnlinkProfile(profile.id)}
                                                    className="text-red-500 hover:bg-red-50 p-1 rounded"
                                                    title="Unlink Profile"
                                                >
                                                    <Unlink size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {customerProfiles.length === 0 && (
                                <p className="text-xs text-ink-tertiary mt-1">
                                    No profiles available. Create them in the Customer Profiles page first.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-border">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-ink-secondary hover:bg-surface-hover rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                        >
                            Save Brand
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BrandForm;
