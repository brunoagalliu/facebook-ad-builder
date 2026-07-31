import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

const BrandContext = createContext();
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// Every CRUD call below used to ignore response.ok entirely — a failed save (permission
// denied, validation error, etc.) would silently reload the unchanged data with no
// indication anything went wrong. This turns a non-OK response into a real thrown Error
// carrying the API's detail message, so callers' catch blocks can surface it.
async function throwIfNotOk(response, fallbackMessage) {
    if (!response.ok) {
        let detail = fallbackMessage;
        try {
            const data = await response.json();
            if (typeof data?.detail === 'string') detail = data.detail;
        } catch {
            // response body wasn't JSON — stick with the fallback message
        }
        throw new Error(detail);
    }
}

export const useBrands = () => {
    const context = useContext(BrandContext);
    if (!context) {
        throw new Error('useBrands must be used within a BrandProvider');
    }
    return context;
};

export const BrandProvider = ({ children }) => {
    const [brands, setBrands] = useState([]);
    const [customerProfiles, setCustomerProfiles] = useState([]);
    const [activeBrand, setActiveBrand] = useState(null);
    const [loading, setLoading] = useState(true);

    const { authFetch, isAuthenticated, loading: authLoading } = useAuth();
    const { showError } = useToast();

    // Load data from API
    const loadData = useCallback(async () => {
        if (!isAuthenticated || authLoading) {
            setLoading(false);
            return;
        }

        try {
            const [brandsRes, profilesRes] = await Promise.all([
                authFetch(`${API_URL}/brands`),
                authFetch(`${API_URL}/profiles`)
            ]);

            if (brandsRes.ok) {
                const brandsData = await brandsRes.json();
                setBrands(Array.isArray(brandsData) ? brandsData : []);
            } else {
                setBrands([]);
            }

            if (profilesRes.ok) {
                const profilesData = await profilesRes.json();
                setCustomerProfiles(Array.isArray(profilesData) ? profilesData : []);
            } else {
                setCustomerProfiles([]);
            }
        } catch (error) {
            console.error('Error loading data:', error);
            setBrands([]);
            setCustomerProfiles([]);
        } finally {
            setLoading(false);
        }
    }, [authFetch, isAuthenticated, authLoading]);

    // Initial data load when authenticated
    useEffect(() => {
        if (authLoading) {
            // Still loading auth, wait
            return;
        }

        if (isAuthenticated) {
            loadData();
        } else {
            setBrands([]);
            setCustomerProfiles([]);
            setLoading(false);
        }
    }, [isAuthenticated, authLoading, loadData]);

    // Brand Management
    const addBrand = async (brand) => {
        try {
            const newBrand = {
                ...brand,
                id: crypto.randomUUID()
            };

            const response = await authFetch(`${API_URL}/brands`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newBrand)
            });
            await throwIfNotOk(response, 'Failed to create brand');

            await loadData();
        } catch (error) {
            console.error('Error adding brand:', error);
            showError(error.message || 'Failed to create brand');
            throw error;
        }
    };

    const updateBrand = async (id, updatedBrand) => {
        try {
            const response = await authFetch(`${API_URL}/brands/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedBrand)
            });
            await throwIfNotOk(response, 'Failed to save brand');

            await loadData();
        } catch (error) {
            console.error('Error updating brand:', error);
            showError(error.message || 'Failed to save brand');
            throw error;
        }
    };

    const deleteBrand = async (id) => {
        try {
            const response = await authFetch(`${API_URL}/brands/${id}`, {
                method: 'DELETE'
            });
            await throwIfNotOk(response, 'Failed to delete brand');

            await loadData();
        } catch (error) {
            console.error('Error deleting brand:', error);
            showError(error.message || 'Failed to delete brand');
            throw error;
        }
    };

    // Product Management (standalone - kept for compatibility)
    const addProduct = async (brandId, product) => {
        try {
            const brand = brands.find(b => b.id === brandId);
            if (brand) {
                const newProduct = { ...product, id: crypto.randomUUID() };
                const updatedBrand = {
                    ...brand,
                    products: [...brand.products, newProduct]
                };
                await updateBrand(brandId, updatedBrand);
            }
        } catch (error) {
            console.error('Error adding product:', error);
            throw error;
        }
    };

    const updateProduct = async (brandId, productId, updatedProduct) => {
        try {
            const brand = brands.find(b => b.id === brandId);
            if (brand) {
                const updatedBrand = {
                    ...brand,
                    products: brand.products.map(p =>
                        p.id === productId ? { ...p, ...updatedProduct } : p
                    )
                };
                await updateBrand(brandId, updatedBrand);
            }
        } catch (error) {
            console.error('Error updating product:', error);
            throw error;
        }
    };

    const deleteProduct = async (brandId, productId) => {
        try {
            const brand = brands.find(b => b.id === brandId);
            if (brand) {
                const updatedBrand = {
                    ...brand,
                    products: brand.products.filter(p => p.id !== productId)
                };
                await updateBrand(brandId, updatedBrand);
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            throw error;
        }
    };

    // Customer Profile Management
    const addProfile = async (profile) => {
        try {
            const newProfile = {
                ...profile,
                id: crypto.randomUUID()
            };

            const response = await authFetch(`${API_URL}/profiles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newProfile)
            });
            await throwIfNotOk(response, 'Failed to create profile');

            await loadData();
            return newProfile;
        } catch (error) {
            console.error('Error adding profile:', error);
            showError(error.message || 'Failed to create profile');
            throw error;
        }
    };

    const updateProfile = async (id, updatedProfile) => {
        try {
            const response = await authFetch(`${API_URL}/profiles/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedProfile)
            });
            await throwIfNotOk(response, 'Failed to save profile');

            await loadData();
        } catch (error) {
            console.error('Error updating profile:', error);
            showError(error.message || 'Failed to save profile');
            throw error;
        }
    };

    const deleteProfile = async (id) => {
        try {
            const response = await authFetch(`${API_URL}/profiles/${id}`, {
                method: 'DELETE'
            });
            await throwIfNotOk(response, 'Failed to delete profile');

            await loadData();
        } catch (error) {
            console.error('Error deleting profile:', error);
            showError(error.message || 'Failed to delete profile');
            throw error;
        }
    };

    // Profile-Brand linking (handled in brand update)
    const linkProfileToBrand = async (brandId, profileId) => {
        try {
            const brand = brands.find(b => b.id === brandId);
            if (brand && !brand.profileIds.includes(profileId)) {
                const updatedBrand = {
                    ...brand,
                    profileIds: [...brand.profileIds, profileId]
                };
                await updateBrand(brandId, updatedBrand);
            }
        } catch (error) {
            console.error('Error linking profile:', error);
            throw error;
        }
    };

    const unlinkProfileFromBrand = async (brandId, profileId) => {
        try {
            const brand = brands.find(b => b.id === brandId);
            if (brand) {
                const updatedBrand = {
                    ...brand,
                    profileIds: brand.profileIds.filter(id => id !== profileId)
                };
                await updateBrand(brandId, updatedBrand);
            }
        } catch (error) {
            console.error('Error unlinking profile:', error);
            throw error;
        }
    };

    return (
        <BrandContext.Provider value={{
            brands,
            customerProfiles,
            activeBrand,
            setActiveBrand,
            loading,
            loadData,
            addBrand,
            updateBrand,
            deleteBrand,
            addProduct,
            updateProduct,
            deleteProduct,
            addProfile,
            updateProfile,
            deleteProfile,
            linkProfileToBrand,
            unlinkProfileFromBrand
        }}>
            {children}
        </BrandContext.Provider>
    );
};
