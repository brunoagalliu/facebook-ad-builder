import React, { useState, useRef } from 'react';
import { X, Upload, Loader, Camera } from 'lucide-react';
import { useBrands } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { validateProductName, validateProductDescription } from '../utils/validation';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const ProductForm = ({ onClose, onSave, initialData = null }) => {
    const { brands } = useBrands();
    const { showSuccess, showError } = useToast();
    const { authFetch } = useAuth();
    const [formData, setFormData] = useState(initialData || {
        name: '',
        description: '',
        brandId: '',
        product_shots: [],
        default_url: ''
    });
    const [uploading, setUploading] = useState(false);
    const [capturingScreenshot, setCapturingScreenshot] = useState(false);
    // Separate from formData.default_url deliberately — that field is the product's
    // saved main link. Capturing a second funnel step (e.g. the actual form page, or a
    // thank-you page) needs its own URL without overwriting the saved one every time.
    // Seeded from default_url since the first capture usually is the landing page.
    const [captureUrl, setCaptureUrl] = useState(initialData?.default_url || '');
    const [saving, setSaving] = useState(false);
    const fileInputRef = useRef(null);

    // Client-side validation constants
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (!formData.brandId) {
                throw new Error('Please select a brand');
            }

            const validatedData = {
                ...formData,
                name: validateProductName(formData.name),
                description: validateProductDescription(formData.description),
                product_shots: formData.product_shots || []
            };

            await onSave(validatedData);
            showSuccess('Product saved successfully');
            onClose();
        } catch (err) {
            showError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleFileUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        // Client-side validation
        for (const file of files) {
            if (!ALLOWED_TYPES.includes(file.type)) {
                showError(`Invalid file type: ${file.name}. Allowed types: JPEG, PNG, GIF, WebP`);
                return;
            }
            if (file.size > MAX_SIZE) {
                showError(`File too large: ${file.name}. Maximum size: 10MB`);
                return;
            }
        }

        setUploading(true);
        try {
            const newShots = [];
            for (const file of files) {
                const uploadData = new FormData();
                uploadData.append('file', file);

                const response = await authFetch(`${API_URL}/uploads/`, {
                    method: 'POST',
                    body: uploadData
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ detail: 'Upload failed' }));
                    throw new Error(errorData.detail || 'Upload failed');
                }

                const data = await response.json();
                newShots.push(data.url);
            }

            setFormData(prev => ({
                ...prev,
                product_shots: [...(prev.product_shots || []), ...newShots]
            }));
            showSuccess(`Successfully uploaded ${newShots.length} image(s)`);
        } catch (err) {
            console.error('Upload error:', err);
            showError(err.message || 'Failed to upload images');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCaptureScreenshot = async () => {
        setCapturingScreenshot(true);
        try {
            const response = await authFetch(`${API_URL}/uploads/screenshot`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: captureUrl })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: 'Screenshot capture failed' }));
                throw new Error(errorData.detail || 'Screenshot capture failed');
            }

            const data = await response.json();
            setFormData(prev => ({
                ...prev,
                product_shots: [...(prev.product_shots || []), data.url]
            }));
            showSuccess('Screenshot captured');
        } catch (err) {
            console.error('Screenshot capture error:', err);
            showError(err.message || 'Failed to capture screenshot');
        } finally {
            setCapturingScreenshot(false);
        }
    };

    const removeShot = (index) => {
        setFormData(prev => ({
            ...prev,
            product_shots: prev.product_shots.filter((_, i) => i !== index)
        }));
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-surface rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-border">
                    <h2 className="text-xl font-bold text-ink">
                        {initialData ? 'Edit Product' : 'Add New Product'}
                    </h2>
                    <button onClick={onClose} className="text-ink-tertiary hover:bg-surface-hover p-2 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Brand</label>
                        <select
                            required
                            value={formData.brandId}
                            onChange={e => setFormData({ ...formData, brandId: e.target.value })}
                            className="w-full p-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500"
                            disabled={!!initialData}
                        >
                            <option value="">Select a Brand...</option>
                            {brands.map(brand => (
                                <option key={brand.id} value={brand.id}>{brand.name}</option>
                            ))}
                        </select>
                        {brands.length === 0 && (
                            <p className="text-xs text-red-500 mt-1">No brands available. Please create a brand first.</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Product Name</label>
                        <input
                            required
                            type="text"
                            maxLength={100}
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            className="w-full p-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. Glow Serum"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Description</label>
                        <textarea
                            value={formData.description}
                            maxLength={500}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                            className="w-full p-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500"
                            rows="3"
                            placeholder="Short description of the product..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Landing Page URL</label>
                        <input
                            type="url"
                            value={formData.default_url || ''}
                            onChange={e => setFormData({ ...formData, default_url: e.target.value })}
                            className="w-full p-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500"
                            placeholder="https://example.com/signup"
                        />
                        <p className="text-xs text-ink-tertiary mt-1">The product's main link.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Capture a Screenshot</label>
                        <div className="flex gap-2">
                            <input
                                type="url"
                                value={captureUrl}
                                onChange={e => setCaptureUrl(e.target.value)}
                                className="flex-1 p-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="https://example.com/signup"
                            />
                            <button
                                type="button"
                                onClick={handleCaptureScreenshot}
                                disabled={!captureUrl || capturingScreenshot}
                                className="px-3 py-1.5 text-sm border border-border rounded-lg text-ink-secondary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                            >
                                {capturingScreenshot ? <Loader size={14} className="animate-spin" /> : <Camera size={14} />}
                                {capturingScreenshot ? 'Capturing...' : 'Capture'}
                            </button>
                        </div>
                        <p className="text-xs text-ink-tertiary mt-1">Enter any URL from the funnel (landing page, form, thank-you page) and capture — repeat for as many steps as you need. Each capture adds a real screenshot to the Product Shots below, independent of the Landing Page URL above.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-2">Product Shots</label>
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            {(formData.product_shots || []).map((shot, index) => (
                                <div key={index} className="relative aspect-square bg-surface-hover rounded-lg overflow-hidden group">
                                    <img src={shot} alt={`Product shot ${index + 1}`} className="w-full h-full object-cover" />
                                    <button
                                        type="button"
                                        onClick={() => removeShot(index)}
                                        className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="aspect-square border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-ink-tertiary hover:border-blue-500 hover:text-blue-500 transition-colors"
                            >
                                {uploading ? <Loader size={20} className="animate-spin" /> : <Upload size={20} />}
                                <span className="text-xs mt-1">{uploading ? 'Uploading...' : 'Upload'}</span>
                            </button>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleFileUpload}
                            className="hidden"
                        />
                        <p className="text-xs text-ink-tertiary">Upload product images to use in ad generation.</p>
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
                            disabled={saving || uploading || capturingScreenshot}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {saving && <Loader size={16} className="animate-spin" />}
                            {saving ? 'Saving...' : 'Save Product'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ProductForm;
