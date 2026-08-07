import React, { useState, useRef } from 'react';
import { Video, Briefcase, Package, Users, Check, ChevronLeft, ChevronRight, Sparkles, Plus, Trash2, Download } from 'lucide-react';
import { useBrands } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import BrandSelectionStep from '../components/steps/BrandSelectionStep';
import ProductSelectionStep from '../components/steps/ProductSelectionStep';
import ProfileSelectionStep from '../components/steps/ProfileSelectionStep';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// Kie.ai's sora-2-pro-storyboard model: each poll costs one request, so this trades
// promptness for not hammering the API — mirrors facebookService.ts's
// waitForVideoReady polling defaults (10s interval, 600s/10min timeout) since video
// generation is a comparably slow async job.
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 600_000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function VideoAds() {
    const { brands, customerProfiles } = useBrands();
    const { showError, showSuccess } = useToast();
    const { authFetch } = useAuth();
    const [currentStep, setCurrentStep] = useState(1);
    const [wizardData, setWizardData] = useState({
        brand: null,
        product: null,
        profile: null,
        useProductShots: false
    });

    // Video-specific creative inputs, separate from wizardData since they're only
    // relevant to steps 4-5, not the shared brand/product/profile selection steps.
    const [hasExistingCharacter, setHasExistingCharacter] = useState(false);
    const [characterTag, setCharacterTag] = useState('');
    const [character, setCharacter] = useState({ name: '', age: '', ethnicity: '', gender: '', description: '' });
    const [location, setLocation] = useState('');
    const [aspectRatio, setAspectRatio] = useState('portrait');
    const [scenes, setScenes] = useState([{ durationSeconds: 15, action: '' }]);

    const [generating, setGenerating] = useState(false);
    const [generationState, setGenerationState] = useState(null); // 'waiting' | 'queuing' | 'generating' | 'success' | 'fail'
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null);
    const pollAbortRef = useRef(false);

    const steps = [
        { id: 1, name: 'Brand', icon: Briefcase },
        { id: 2, name: 'Product', icon: Package },
        { id: 3, name: 'Profile', icon: Users },
        { id: 4, name: 'Video Style', icon: Video },
        { id: 5, name: 'Generate', icon: Sparkles }
    ];

    const updateData = (field, value) => {
        setWizardData(prev => ({ ...prev, [field]: value }));
    };

    const isStepComplete = (stepId) => {
        switch (stepId) {
            case 1: return wizardData.brand !== null;
            case 2: return wizardData.product !== null;
            case 3: return wizardData.profile !== null;
            case 4: return scenes.every(s => s.action.trim().length > 0);
            default: return true;
        }
    };

    const canProceed = () => isStepComplete(currentStep);

    const nextStep = () => {
        if (currentStep < steps.length) {
            setCurrentStep(currentStep + 1);
        }
    };

    const prevStep = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    const handleStepClick = (stepId) => {
        if (stepId < currentStep) {
            setCurrentStep(stepId);
            return;
        }
        let canNavigate = true;
        for (let i = 1; i < stepId; i++) {
            if (!isStepComplete(i)) {
                canNavigate = false;
                break;
            }
        }
        if (canNavigate) {
            setCurrentStep(stepId);
        }
    };

    const updateScene = (index, field, value) => {
        setScenes(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
    };

    const addScene = () => {
        if (scenes.length >= 3) return;
        setScenes(prev => [...prev, { durationSeconds: 10, action: '' }]);
    };

    const removeScene = (index) => {
        if (scenes.length <= 1) return;
        setScenes(prev => prev.filter((_, i) => i !== index));
    };

    const pollVideoStatus = async (taskId) => {
        const startedAt = Date.now();
        while (!pollAbortRef.current) {
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                throw new Error('Video generation timed out after 10 minutes. Check back later or try again.');
            }
            await sleep(POLL_INTERVAL_MS);

            const response = await authFetch(`${API_URL}/generated-ads/generate-video/${taskId}`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to check video status');
            }

            setGenerationState(data.state);
            if (data.state === 'success') {
                return data.video_url;
            }
            if (data.state === 'fail') {
                throw new Error(data.detail || 'Video generation failed');
            }
            // waiting/queuing/generating — keep polling
        }
        throw new Error('Video generation cancelled');
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setGeneratedVideoUrl(null);
        setGenerationState('waiting');
        pollAbortRef.current = false;

        try {
            const response = await authFetch(`${API_URL}/generated-ads/generate-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brand: wizardData.brand,
                    product: wizardData.product,
                    productShots: wizardData.useProductShots ? (wizardData.product?.product_shots || []) : [],
                    character: hasExistingCharacter
                        ? { tag: characterTag }
                        : {
                            name: character.name || undefined,
                            age: character.age || undefined,
                            ethnicity: character.ethnicity || undefined,
                            gender: character.gender || undefined,
                            description: character.description || undefined,
                        },
                    location: location || undefined,
                    scenes,
                    aspectRatio,
                })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to start video generation');
            }

            const videoUrl = await pollVideoStatus(data.task_id);
            setGeneratedVideoUrl(videoUrl);
            showSuccess('Video generated successfully!');

            // Save to Generated Ads gallery, same pattern as ImageAds.jsx's batch save.
            try {
                const saveResponse = await authFetch(`${API_URL}/generated-ads/batch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ads: [{
                            id: `ga_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            brandId: wizardData.brand?.id,
                            productId: wizardData.product?.id,
                            mediaType: 'video',
                            videoUrl,
                        }]
                    })
                });
                if (!saveResponse.ok) {
                    throw new Error(`Batch save failed: ${saveResponse.statusText}`);
                }
            } catch (saveError) {
                console.error('Failed to save video to database:', saveError);
                showError('Video generated but failed to save to Generated Ads. Download it below before leaving this page.');
            }
        } catch (error) {
            console.error('Video generation error:', error);
            showError(error.message || 'Failed to generate video. Please try again.');
            setGenerationState('fail');
        } finally {
            setGenerating(false);
        }
    };

    const stateLabel = {
        waiting: 'Queued…',
        queuing: 'Queued…',
        generating: 'Generating your video (this can take a few minutes)…',
        success: 'Done!',
        fail: 'Generation failed',
    };

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                    <Video size={32} className="text-amber-600" />
                    Create Video Ads
                </h1>
                <p className="text-gray-600 mt-1">Generate AI UGC-style video ads from your product assets</p>
            </div>

            {/* Progress Steps */}
            <div className="mb-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between relative">
                    <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-gray-200 -z-10"></div>
                    {steps.map((step) => {
                        const Icon = step.icon;
                        const isActive = step.id === currentStep;
                        const isCompleted = step.id < currentStep;

                        let isClickable = true;
                        for (let i = 1; i < step.id; i++) {
                            if (!isStepComplete(i)) {
                                isClickable = false;
                                break;
                            }
                        }

                        return (
                            <div
                                key={step.id}
                                className={`flex flex-col items-center bg-white px-2 ${isClickable ? 'cursor-pointer group' : 'cursor-not-allowed opacity-60'}`}
                                onClick={() => isClickable && handleStepClick(step.id)}
                            >
                                <div
                                    className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-all ${isActive ? 'bg-amber-600 text-white scale-110 shadow-md' :
                                        isCompleted ? 'bg-green-500 text-white group-hover:bg-green-600' :
                                            'bg-gray-200 text-gray-500 group-hover:bg-gray-300'
                                        }`}
                                >
                                    {isCompleted ? <Check size={20} /> : <Icon size={20} />}
                                </div>
                                <span className={`text-xs font-medium transition-colors ${isActive ? 'text-amber-600' :
                                    isClickable ? 'text-gray-500 group-hover:text-gray-700' : 'text-gray-400'
                                    }`}>
                                    {step.name}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Step Content */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 min-h-[500px] relative">
                {/* Step 1: Brand Selection */}
                {currentStep === 1 && (
                    <BrandSelectionStep
                        brands={brands}
                        selectedBrand={wizardData.brand}
                        onSelect={(brand) => {
                            updateData('brand', brand);
                            nextStep();
                        }}
                    />
                )}

                {/* Step 2: Product Selection */}
                {currentStep === 2 && (
                    <ProductSelectionStep
                        products={wizardData.brand?.products || []}
                        selectedProduct={wizardData.product}
                        useProductShots={wizardData.useProductShots}
                        onSelect={(product) => {
                            updateData('product', product);
                            updateData('useProductShots', false);
                            nextStep();
                        }}
                        onToggleProductShots={(use) => updateData('useProductShots', use)}
                    />
                )}

                {/* Step 3: Profile Selection */}
                {currentStep === 3 && (
                    <ProfileSelectionStep
                        profiles={customerProfiles.filter(p => wizardData.brand?.profileIds?.includes(p.id))}
                        selectedProfile={wizardData.profile}
                        onSelect={(profile) => {
                            updateData('profile', profile);
                            nextStep();
                        }}
                    />
                )}

                {/* Step 4: Video Style — character, setting, and scene script */}
                {currentStep === 4 && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-1">Character</h3>
                            <p className="text-sm text-gray-500 mb-3">Reuse a character you've already created in Sora, or describe a new one for the AI to render.</p>
                            <label className="flex items-center gap-2 mb-3 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={hasExistingCharacter}
                                    onChange={(e) => setHasExistingCharacter(e.target.checked)}
                                    className="w-4 h-4 text-amber-600 rounded"
                                />
                                I already have a Sora character handle (e.g. @icyflame313)
                            </label>
                            {hasExistingCharacter ? (
                                <input
                                    type="text"
                                    value={characterTag}
                                    onChange={(e) => setCharacterTag(e.target.value)}
                                    placeholder="@yourcharacter"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                />
                            ) : (
                                <div className="grid grid-cols-2 gap-3">
                                    <input type="text" value={character.name} onChange={(e) => setCharacter(prev => ({ ...prev, name: e.target.value }))} placeholder="Name (optional)" className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
                                    <input type="text" value={character.age} onChange={(e) => setCharacter(prev => ({ ...prev, age: e.target.value }))} placeholder="Age (e.g. mid-20s)" className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
                                    <input type="text" value={character.ethnicity} onChange={(e) => setCharacter(prev => ({ ...prev, ethnicity: e.target.value }))} placeholder="Ethnicity" className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
                                    <input type="text" value={character.gender} onChange={(e) => setCharacter(prev => ({ ...prev, gender: e.target.value }))} placeholder="Gender" className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
                                    <textarea
                                        value={character.description}
                                        onChange={(e) => setCharacter(prev => ({ ...prev, description: e.target.value }))}
                                        placeholder="Additional detail: hair, features, clothing, voice, mannerisms…"
                                        rows={2}
                                        className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                    />
                                </div>
                            )}
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-1">Setting</h3>
                            <input
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="e.g. a cozy, well-lit home kitchen"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                            />
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-lg font-bold text-gray-900">Aspect Ratio</h3>
                            </div>
                            <div className="flex gap-2">
                                {['portrait', 'landscape'].map((ratio) => (
                                    <button
                                        key={ratio}
                                        type="button"
                                        onClick={() => setAspectRatio(ratio)}
                                        className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${aspectRatio === ratio ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                    >
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-bold text-gray-900">Script</h3>
                                <button
                                    type="button"
                                    onClick={addScene}
                                    disabled={scenes.length >= 3}
                                    className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    <Plus size={16} /> Add scene
                                </button>
                            </div>
                            <p className="text-sm text-gray-500 mb-3">Up to 3 scenes, 25s total. Describe what the character does and says in each.</p>
                            <div className="space-y-3">
                                {scenes.map((scene, i) => (
                                    <div key={i} className="border border-gray-200 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-gray-700">Scene {i + 1}</span>
                                                <select
                                                    value={scene.durationSeconds}
                                                    onChange={(e) => updateScene(i, 'durationSeconds', Number(e.target.value))}
                                                    className="text-sm border border-gray-300 rounded px-2 py-1"
                                                >
                                                    {[5, 10, 15].map((d) => <option key={d} value={d}>{d}s</option>)}
                                                </select>
                                            </div>
                                            {scenes.length > 1 && (
                                                <button type="button" onClick={() => removeScene(i)} className="text-gray-400 hover:text-red-600">
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                        <textarea
                                            value={scene.action}
                                            onChange={(e) => updateScene(i, 'action', e.target.value)}
                                            placeholder='e.g. She holds up the product, smiling: "Okay, so this might sound crazy, but I swear this actually worked."'
                                            rows={2}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 5: Generate */}
                {currentStep === 5 && (
                    <div className="text-center py-12">
                        {!generatedVideoUrl && !generating && (
                            <>
                                <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <Sparkles className="text-amber-600" size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">Generate Video</h3>
                                <p className="text-gray-600 mb-6">Ready to generate your AI UGC video ad.</p>
                                <button
                                    onClick={handleGenerate}
                                    className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium transition-colors mx-auto"
                                >
                                    <Sparkles size={20} />
                                    Generate Video
                                </button>
                            </>
                        )}

                        {generating && (
                            <>
                                <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                                    <Sparkles className="text-amber-600" size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">{stateLabel[generationState] || 'Working…'}</h3>
                                <p className="text-gray-600">This can take a few minutes. Feel free to wait — don't navigate away.</p>
                            </>
                        )}

                        {generatedVideoUrl && !generating && (
                            <>
                                <video
                                    src={generatedVideoUrl}
                                    controls
                                    className="max-w-sm mx-auto rounded-lg shadow-md mb-6"
                                />
                                <div className="flex items-center justify-center gap-3">
                                    <a
                                        href={generatedVideoUrl}
                                        download
                                        className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
                                    >
                                        <Download size={18} /> Download
                                    </a>
                                    <button
                                        onClick={() => {
                                            setGeneratedVideoUrl(null);
                                            setGenerationState(null);
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium"
                                    >
                                        <Sparkles size={18} /> Generate Another
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            <div className="mt-6 flex items-center justify-between">
                <button
                    onClick={prevStep}
                    disabled={currentStep === 1 || generating}
                    className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-colors ${currentStep === 1 || generating
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                >
                    <ChevronLeft size={20} />
                    Back
                </button>

                {currentStep < steps.length && (
                    <button
                        onClick={nextStep}
                        disabled={!canProceed()}
                        className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        Continue
                        <ChevronRight size={20} />
                    </button>
                )}
            </div>
        </div>
    );
}
