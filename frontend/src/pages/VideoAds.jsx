import React, { useState, useRef, useEffect } from 'react';
import { Video, Briefcase, Package, Users, Check, ChevronLeft, ChevronRight, Sparkles, Plus, Trash2, Download, Wand2, Film } from 'lucide-react';
import { useBrands } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import BrandSelectionStep from '../components/steps/BrandSelectionStep';
import ProductSelectionStep from '../components/steps/ProductSelectionStep';
import ProfileSelectionStep from '../components/steps/ProfileSelectionStep';
import ImageTemplateSelector from '../components/ImageTemplateSelector';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// Kie.ai's bytedance/seedance-2 model: each poll costs one request, so this trades
// promptness for not hammering the API — mirrors facebookService.ts's
// waitForVideoReady polling defaults (10s interval, 600s/10min timeout) since video
// generation is a comparably slow async job.
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 600_000;

// Seedance generates one continuous clip per call, 4-15s total (no multi-shot API) —
// scene durations are summed and clamped server-side, but the picker only offers
// values that keep 1-3 scenes comfortably within that ceiling. Kling O3 (the second
// model option below) genuinely supports up to 6 distinct shots/cuts within the same
// 15s total, so it gets its own scene cap and shorter duration options — 6 scenes at
// today's 3s floor would already exceed the ceiling.
const SCENE_DURATION_OPTIONS = [3, 5, 7, 10, 15];
const KLING_SCENE_DURATION_OPTIONS = [1, 2, 3, 5, 7, 10, 15];
const MAX_TOTAL_DURATION = 15;
const MAX_SCENES_BY_MODEL = { seedance: 3, 'kling-o3': 6 };

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
    const [character, setCharacter] = useState({ name: '', age: '', ethnicity: '', gender: '', description: '' });
    const [location, setLocation] = useState('');
    const [aspectRatio, setAspectRatio] = useState('portrait');
    const [scenes, setScenes] = useState([{ durationSeconds: 10, action: '' }]);
    // Which video generation backend to use — 'seedance' (default, one continuous
    // take) or 'kling-o3' (real multi-shot storyboarding, see backend's
    // buildKlingInput). Mirrors ImageAds.jsx's model picker pattern.
    const [model, setModel] = useState('seedance');
    const maxScenes = MAX_SCENES_BY_MODEL[model];
    const sceneDurationOptions = model === 'kling-o3' ? KLING_SCENE_DURATION_OPTIONS : SCENE_DURATION_OPTIONS;

    const selectModel = (newModel) => {
        // Switching back to Seedance while more scenes exist than it supports would
        // leave stale scenes the "Add scene" cap silently prevents removing one at a
        // time from ever being sent correctly — truncate up front instead.
        if (newModel === 'seedance' && scenes.length > MAX_SCENES_BY_MODEL.seedance) {
            setScenes((prev) => prev.slice(0, MAX_SCENES_BY_MODEL.seedance));
        }
        setModel(newModel);
    };

    const [generating, setGenerating] = useState(false);
    const [generationState, setGenerationState] = useState(null); // 'waiting' | 'queuing' | 'generating' | 'success' | 'fail'
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null);
    const pollAbortRef = useRef(false);

    // Which winning-ad blueprint steers generation: 'auto' (default — createVideoTask
    // already auto-selects one for the brand's vertical server-side, same rotating-pool
    // logic ImageAds.jsx's auto-suggested template uses), 'single' (one specific
    // WinningAd the user picks, mirroring ImageAds.jsx's "Browse Templates" mode — video
    // had no equivalent before), or 'vertical' (a synthesized meta-blueprint combining
    // the whole vertical's pool — see blueprintSynthesisService.ts). Whichever mode is
    // active, selectedVideoTemplate ends up holding the resulting template so the rest
    // of the wizard (hook-line fill, ready-to-generate banner, batch-save copy reuse)
    // doesn't need to fork three ways — it just reads selectedVideoTemplate regardless
    // of how it was populated.
    const [templateMode, setTemplateMode] = useState('auto');
    const [selectedVideoTemplate, setSelectedVideoTemplate] = useState(null);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [loadingVerticalTemplate, setLoadingVerticalTemplate] = useState(false);

    useEffect(() => {
        if (templateMode !== 'auto') return;
        const brandId = wizardData.brand?.id;
        const verticalId = wizardData.brand?.verticalId;
        if (!brandId || !verticalId) {
            setSelectedVideoTemplate(null);
            return;
        }
        authFetch(`${API_URL}/generated-ads/auto-video-template?brand_id=${brandId}`)
            .then(res => res.ok ? res.json() : null)
            .then(setSelectedVideoTemplate)
            .catch(() => setSelectedVideoTemplate(null));
    }, [templateMode, wizardData.brand?.id, wizardData.brand?.verticalId, authFetch]);

    const fetchVerticalTemplate = () => {
        const brandId = wizardData.brand?.id;
        if (!brandId) return;
        setLoadingVerticalTemplate(true);
        authFetch(`${API_URL}/generated-ads/auto-video-template?brand_id=${brandId}&mode=vertical`)
            .then(res => res.ok ? res.json() : null)
            .then(setSelectedVideoTemplate)
            .catch(() => setSelectedVideoTemplate(null))
            .finally(() => setLoadingVerticalTemplate(false));
    };

    const handleTemplateModeChange = (mode) => {
        setTemplateMode(mode);
        if (mode === 'single') {
            setShowTemplatePicker(true);
        } else if (mode === 'vertical') {
            setSelectedVideoTemplate(null);
            fetchVerticalTemplate();
        }
        // 'auto' repopulates itself via the effect above.
    };

    // hook_transcript is just the opening line of a longer source ad — feeding it as
    // the *only* scene left the generated video with nothing to resolve into, trailing
    // off with no payoff/CTA (confirmed live: a 10s video that just stops after the
    // hook line). Building a real two-beat hook+CTA script instead of pasting an
    // isolated sentence gives the model something to land on.
    const buildScenesFromTemplate = () => {
        const hook = selectedVideoTemplate?.video_blueprint_json?.hook_transcript;
        if (!hook) return null;
        const productName = wizardData.product?.name || wizardData.brand?.name || 'this';
        return [
            { durationSeconds: 10, action: hook },
            { durationSeconds: 5, action: `She turns to the camera and says: "If that's you, ${productName} could help — tap below to see if you qualify."` },
        ];
    };

    const fillFromWinningAd = () => {
        const built = buildScenesFromTemplate();
        if (built) setScenes(built);
    };

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
            // Scene 1 can stay blank if a winning ad's hook_transcript is available to
            // fall back on at generate time (see handleGenerate) — any additional
            // scenes beyond the first still need real content, since there's no
            // per-scene blueprint data to substitute for those.
            case 4: return scenes.every((s, i) =>
                s.action.trim().length > 0 || (i === 0 && Boolean(selectedVideoTemplate?.video_blueprint_json?.hook_transcript))
            );
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
        if (scenes.length >= maxScenes) return;
        setScenes(prev => [...prev, { durationSeconds: 3, action: '' }]);
    };

    const totalDuration = scenes.reduce((sum, s) => sum + s.durationSeconds, 0);

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

        // Mirrors isStepComplete's fallback: a blank Scene 1 is only allowed through
        // when a winning ad's hook_transcript exists, so substitute it here — the
        // backend's schema requires real, non-empty scene text (min(1)), it can't stay
        // blank on the wire even though the wizard let the user skip typing it.
        const scenesToSend = scenes.map((s, i) => {
            if (i === 0 && !s.action.trim() && selectedVideoTemplate?.video_blueprint_json?.hook_transcript) {
                return { ...s, action: selectedVideoTemplate.video_blueprint_json.hook_transcript };
            }
            return s;
        });

        try {
            const response = await authFetch(`${API_URL}/generated-ads/generate-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brand: wizardData.brand,
                    product: wizardData.product,
                    productShots: wizardData.useProductShots ? (wizardData.product?.product_shots || []) : [],
                    character: {
                        name: character.name || undefined,
                        age: character.age || undefined,
                        ethnicity: character.ethnicity || undefined,
                        gender: character.gender || undefined,
                        description: character.description || undefined,
                    },
                    location: location || undefined,
                    scenes: scenesToSend,
                    aspectRatio,
                    model,
                    mode: templateMode,
                    templateId: templateMode === 'single' ? selectedVideoTemplate?.id : undefined,
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
                            // Video ads had no accompanying headline/body/CTA at all
                            // before — the video is only the creative, not the whole ad,
                            // so nothing showed in Generated Ads and it couldn't be
                            // published as a real Facebook ad. Reuses the winning ad's
                            // own real copy (already surfaced via the raw ad-copy
                            // breakdown) rather than requiring a new manual step.
                            headline: selectedVideoTemplate?.headline || undefined,
                            body: selectedVideoTemplate?.body_text || undefined,
                            cta: selectedVideoTemplate?.cta_text || undefined,
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

            {/* Skip straight to Generate once there's a real winning ad's hook line to
                use — bypasses Video Style entirely instead of requiring a click through
                Character/Setting/Script when nothing in them needs customizing. */}
            {wizardData.brand && wizardData.product && wizardData.profile
                && selectedVideoTemplate?.video_blueprint_json?.hook_transcript && currentStep < 5 && (
                <div className="mb-6 flex items-center justify-between gap-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                        {selectedVideoTemplate.image_url && (
                            <img src={selectedVideoTemplate.image_url} alt="" className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                        )}
                        <div>
                            <p className="font-medium text-gray-900">Ready to generate from {selectedVideoTemplate.name}</p>
                            <p className="text-sm text-gray-600">Skip Video Style — hook line and pacing pulled from this winning ad.</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => { fillFromWinningAd(); setCurrentStep(5); }}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium whitespace-nowrap"
                    >
                        ⚡ Skip to Generate
                    </button>
                </div>
            )}

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
                            <h3 className="text-lg font-bold text-gray-900 mb-1">Creative Reference</h3>
                            <p className="text-sm text-gray-500 mb-3">
                                Base this video on one specific winning ad, a synthesis of the whole vertical's proven patterns, or let it auto-pick.
                            </p>
                            <div className="flex gap-2 mb-3 bg-gray-100 p-1 rounded-lg w-fit">
                                <button
                                    type="button"
                                    onClick={() => handleTemplateModeChange('auto')}
                                    className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${templateMode === 'auto' ? 'bg-white text-amber-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                >
                                    <div className="flex items-center gap-2"><Sparkles size={16} /> Auto</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTemplateModeChange('single')}
                                    className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${templateMode === 'single' ? 'bg-white text-amber-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                >
                                    <div className="flex items-center gap-2"><Film size={16} /> Specific Ad</div>
                                </button>
                                {wizardData.brand?.verticalId && (
                                    <button
                                        type="button"
                                        onClick={() => handleTemplateModeChange('vertical')}
                                        className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${templateMode === 'vertical' ? 'bg-white text-amber-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                    >
                                        <div className="flex items-center gap-2"><Wand2 size={16} /> Whole Vertical</div>
                                    </button>
                                )}
                            </div>

                            {templateMode === 'single' && (
                                selectedVideoTemplate ? (
                                    <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {selectedVideoTemplate.image_url && (
                                                <img src={selectedVideoTemplate.image_url} alt="" className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                                            )}
                                            <span className="text-sm font-medium text-gray-900 truncate">{selectedVideoTemplate.name}</span>
                                        </div>
                                        <button type="button" onClick={() => setShowTemplatePicker(true)} className="text-sm text-amber-700 hover:text-amber-800 font-medium whitespace-nowrap">
                                            Change
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setShowTemplatePicker(true)}
                                        className="text-sm px-4 py-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium"
                                    >
                                        Browse winning ads…
                                    </button>
                                )
                            )}

                            {templateMode === 'vertical' && (
                                loadingVerticalTemplate ? (
                                    <div className="text-sm text-gray-500">Synthesizing patterns across this vertical's winning ads…</div>
                                ) : selectedVideoTemplate ? (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                        <p className="text-sm font-medium text-gray-900">{selectedVideoTemplate.name}</p>
                                        <p className="text-sm text-gray-600">Synthesized from {selectedVideoTemplate.source_count} winning ad{selectedVideoTemplate.source_count === 1 ? '' : 's'} in this vertical.</p>
                                    </div>
                                ) : (
                                    <div className="text-sm text-gray-500">No analyzed winning ads found in this brand's vertical yet.</div>
                                )
                            )}
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-1">Character</h3>
                            <p className="text-sm text-gray-500 mb-3">Describe who's on camera. A product photo (selected in the previous step) doubles as a visual reference for consistency.</p>
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
                            <h3 className="text-lg font-bold text-gray-900 mb-1">Video Model</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div
                                    onClick={() => selectModel('seedance')}
                                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${model === 'seedance' ? 'border-amber-600 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-bold text-gray-900">Seedance 2.0 — Continuous Take</span>
                                        {model === 'seedance' && <Check className="text-amber-600" size={18} />}
                                    </div>
                                    <p className="text-sm text-gray-600">One fluid handheld shot, no cuts. (Default)</p>
                                </div>
                                <div
                                    onClick={() => selectModel('kling-o3')}
                                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${model === 'kling-o3' ? 'border-amber-600 bg-amber-50' : 'border-gray-200 hover:border-amber-300'}`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-bold text-gray-900">Kling O3 — Multi-Shot</span>
                                        {model === 'kling-o3' && <Check className="text-amber-600" size={18} />}
                                    </div>
                                    <p className="text-sm text-gray-600">Up to 6 distinct shots/cuts. Higher cost per generation. Reference photos aren't used yet for this model.</p>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-bold text-gray-900">Script</h3>
                                <div className="flex items-center gap-3">
                                    {selectedVideoTemplate?.video_blueprint_json?.hook_transcript && (
                                        <button
                                            type="button"
                                            onClick={fillFromWinningAd}
                                            className="flex items-center gap-1 text-sm px-3 py-1 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 font-medium"
                                            title="Fills Scene 1's action/dialogue with this vertical's winning ad's actual hook line"
                                        >
                                            ✨ Fill from Winning Ad
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={addScene}
                                        disabled={scenes.length >= maxScenes}
                                        className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <Plus size={16} /> Add scene
                                    </button>
                                </div>
                            </div>
                            <p className="text-sm text-gray-500 mb-1">
                                {model === 'kling-o3'
                                    ? `Up to ${maxScenes} scenes, ${MAX_TOTAL_DURATION}s total — each scene renders as its own distinct shot/cut.`
                                    : `Up to ${maxScenes} scenes, ${MAX_TOTAL_DURATION}s total (one continuous take). Describe what the character does and says in each.`}
                                {selectedVideoTemplate?.video_blueprint_json?.hook_transcript && ' Scene 1 can stay blank to use the winning ad\'s own hook line directly.'}
                            </p>
                            <p className="text-sm text-gray-500 mb-1">
                                Tip: for lead-gen offers, a scene like <span className="italic">"She holds her phone up, scrolling through the signup form — name, email, phone — and taps the button to submit"</span> renders as a natural phone reveal, not just narration.
                            </p>
                            <p className={`text-sm mb-3 font-medium ${totalDuration > MAX_TOTAL_DURATION ? 'text-red-600' : 'text-gray-400'}`}>
                                {totalDuration}s / {MAX_TOTAL_DURATION}s{totalDuration > MAX_TOTAL_DURATION ? ' — will be trimmed to fit' : ''}
                            </p>
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
                                                    {sceneDurationOptions.map((d) => <option key={d} value={d}>{d}s</option>)}
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
                                            placeholder={
                                                i === 0 && selectedVideoTemplate?.video_blueprint_json?.hook_transcript
                                                    ? "Leave blank to use the winning ad's own hook line"
                                                    : 'e.g. She holds up the product, smiling: "Okay, so this might sound crazy, but I swear this actually worked."'
                                            }
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

            {/* Single-ad mode's picker — reuses ImageTemplateSelector (already renders
                a video badge for media_type === 'video' rows) filtered to only
                video-capable templates, instead of building a separate component. */}
            {showTemplatePicker && (
                <ImageTemplateSelector
                    mediaTypeFilter="video"
                    onSelect={(template) => {
                        setSelectedVideoTemplate(template);
                        setShowTemplatePicker(false);
                    }}
                    onClose={() => setShowTemplatePicker(false)}
                />
            )}
        </div>
    );
}
