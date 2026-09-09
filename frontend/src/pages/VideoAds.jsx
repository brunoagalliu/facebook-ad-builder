import React, { useState, useRef, useEffect } from 'react';
import { Video, Briefcase, Package, Users, Check, ChevronLeft, ChevronRight, Sparkles, Plus, Trash2, Download, Wand2, Film } from 'lucide-react';
import { useBrands } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import BrandSelectionStep from '../components/steps/BrandSelectionStep';
import ProductSelectionStep from '../components/steps/ProductSelectionStep';
import ProfileSelectionStep from '../components/steps/ProfileSelectionStep';
import ImageTemplateSelector from '../components/ImageTemplateSelector';
import { downloadFile } from '../lib/download';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// Kie.ai's bytedance/seedance-2 model: each poll costs one request, so this trades
// promptness for not hammering the API — mirrors facebookService.ts's
// waitForVideoReady polling defaults (10s interval, 600s/10min timeout) since video
// generation is a comparably slow async job.
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 600_000;

// Seedance generates one continuous clip per call (no multi-shot API) — scene
// durations are summed and clamped server-side, but the picker only offers values
// that keep 1-3 scenes comfortably within that ceiling: 15s for the original Seedance
// 2.0, 30s for Seedance 2.5 (its headline difference — natively reaches double the
// duration in one pass). Kling O3 genuinely supports up to 6 distinct shots/cuts
// within a 15s total, so it gets its own scene cap and shorter duration options — 6
// scenes at today's 3s floor would already exceed the ceiling.
const SCENE_DURATION_OPTIONS = [3, 5, 7, 10, 15];
const SEEDANCE25_SCENE_DURATION_OPTIONS = [4, 5, 7, 10, 15, 20, 25, 30];
const KLING_SCENE_DURATION_OPTIONS = [1, 2, 3, 5, 7, 10, 15];
const MAX_TOTAL_DURATION_BY_MODEL = { seedance: 15, 'kling-o3': 15, 'seedance-2-5': 30 };
const MAX_SCENES_BY_MODEL = { seedance: 3, 'kling-o3': 6, 'seedance-2-5': 3 };

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
    // 480p is meaningfully cheaper on Kie.ai than 720p/1080p (confirmed live: roughly
    // half the per-second credit cost) — exposed as a real choice so cost-conscious
    // testing doesn't require burning full-price credits every time.
    const [resolution, setResolution] = useState('720p');
    const [scenes, setScenes] = useState([{ durationSeconds: 10, action: '' }]);
    // Which video generation backend to use — 'seedance-2-5' (default: ByteDance's
    // newer flagship, one continuous take but natively reaches 30s and beats the
    // other two on quality, confirmed via live testing), 'seedance' (the original
    // Seedance 2.0 integration, kept as a cheaper/legacy option), or 'kling-o3' (real
    // multi-shot storyboarding, see backend's buildKlingInput). Mirrors ImageAds.jsx's
    // model picker pattern.
    const [model, setModel] = useState('seedance-2-5');
    const maxScenes = MAX_SCENES_BY_MODEL[model];
    const maxTotalDuration = MAX_TOTAL_DURATION_BY_MODEL[model];
    const sceneDurationOptions = model === 'kling-o3'
        ? KLING_SCENE_DURATION_OPTIONS
        : model === 'seedance-2-5'
            ? SEEDANCE25_SCENE_DURATION_OPTIONS
            : SCENE_DURATION_OPTIONS;

    // Long-video continuation, Kling only — chains a second Kie.ai job
    // ("kling/v3-turbo-image-to-video") seeded from segment 1's actual last frame, past
    // Kling's own 15s hard cap. See videoGenerationService.ts's createSegment2Task.
    const [part2Enabled, setPart2Enabled] = useState(false);
    const [part2Action, setPart2Action] = useState('');
    const [part2Duration, setPart2Duration] = useState(10);

    // Claude-assisted prompt authoring, two independent opt-ins: enhancingSceneIndex
    // expands one scene's rough idea in place (model-agnostic — the result is just
    // better scene.action text); useClaudePrompt reworks the *entire* built prompt for
    // more natural prose before it's sent to Kie.ai, Seedance-only since Kling's real
    // content lives in per-shot prompts this never touches (mirrors the backend's own
    // superRefine restriction).
    const [enhancingSceneIndex, setEnhancingSceneIndex] = useState(null);
    const [useClaudePrompt, setUseClaudePrompt] = useState(false);

    const selectModel = (newModel) => {
        // Switching to a model with a lower scene cap while more scenes exist than it
        // supports would leave stale scenes the "Add scene" cap silently prevents
        // removing one at a time from ever being sent correctly — truncate up front.
        const newCap = MAX_SCENES_BY_MODEL[newModel];
        if (scenes.length > newCap) {
            setScenes((prev) => prev.slice(0, newCap));
        }
        if (newModel !== 'kling-o3') {
            setPart2Enabled(false);
        }
        setModel(newModel);
    };

    const [generating, setGenerating] = useState(false);
    const [generationState, setGenerationState] = useState(null); // 'waiting' | 'queuing' | 'generating' | 'success' | 'fail'
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState(null);
    const pollAbortRef = useRef(false);

    // Targeted "fix just this" edit on the video already sitting in generatedVideoUrl
    // — Seedance 2.5's reference_video_urls + duration:-1 confirmed live to modify
    // only the described element/region while leaving the rest of the take untouched,
    // regardless of which model originally generated it (editing is a property of the
    // edit call, not the source clip). isEditingVideo only distinguishes the loading
    // label from a fresh generation; `generating` itself is reused so the same
    // full-screen progress UI applies to both.
    const [showEditPanel, setShowEditPanel] = useState(false);
    const [editInstruction, setEditInstruction] = useState('');
    const [isEditingVideo, setIsEditingVideo] = useState(false);

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

    const [fillingFromWinningAd, setFillingFromWinningAd] = useState(false);

    // hook_transcript is just the opening line of a longer source ad, and is often
    // itself a fragment — Gemini Vision transcribes only the hook segment (e.g. 0-9s
    // of a longer clip), and the real sentence frequently continues past that
    // boundary (confirmed live: a real winning ad's hook_transcript came back as
    // "I don't know who needs to hear this, but if you have over $10,000 in credit
    // card debt" — a dangling clause with no resolution). Pasting it verbatim as
    // Scene 1, plus a generic hardcoded bridge line as Scene 2, produced a script
    // that looked incomplete and disconnected from what the ad actually says next.
    // Routing both through the same Claude scene-enhancement endpoint used elsewhere
    // completes the truncated hook into a real sentence and writes a Scene 2 that
    // continues the actual thought (using the blueprint's narrative_arc as a guide),
    // instead of a generic reused CTA line.
    const enhanceSceneText = async (action) => {
        try {
            const response = await authFetch(`${API_URL}/generated-ads/enhance-scene`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    character: (character.name || character.description) ? character : undefined,
                    location: location || undefined,
                    productName: wizardData.product?.name,
                    brandVoice: wizardData.brand?.voice,
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || 'Failed to enhance scene');
            return data.enhanced;
        } catch (error) {
            console.error('Auto-enhance during fill-from-winning-ad failed, using raw text:', error);
            return action;
        }
    };

    const fillFromWinningAd = async () => {
        const hook = selectedVideoTemplate?.video_blueprint_json?.hook_transcript;
        if (!hook) return;
        const productName = wizardData.product?.name || wizardData.brand?.name || 'this';
        const narrativeArc = selectedVideoTemplate?.video_blueprint_json?.narrative_arc;

        setFillingFromWinningAd(true);
        try {
            const [scene1Action, scene2Action] = await Promise.all([
                enhanceSceneText(hook),
                enhanceSceneText(
                    `She turns to the camera and explains why ${productName} is the better alternative, then gives a clear, low-friction call to action to tap and check if they qualify.` +
                    (narrativeArc ? ` (This ad's overall structure, for reference: ${narrativeArc})` : '')
                ),
            ]);
            setScenes([
                { durationSeconds: 10, action: scene1Action },
                { durationSeconds: 5, action: scene2Action },
            ]);
        } finally {
            setFillingFromWinningAd(false);
        }
    };

    // Split from a single "Video Style" step that had grown into 7 stacked sections
    // (Creative Reference, Character, Setting, Aspect Ratio, Resolution, Video Model,
    // Script) as features were added incrementally over time — Format groups the
    // technical/cost decisions (model, aspect ratio, resolution) plus who/where, while
    // Script groups everything about what the video actually says (creative
    // reference, scenes, AI-assist tools, model-specific extras like cutaways/
    // long-video/full-prompt-rework). Model lives in Format since it determines scene
    // duration options, max scene count, and which Script extras even appear.
    const steps = [
        { id: 1, name: 'Brand', icon: Briefcase },
        { id: 2, name: 'Product', icon: Package },
        { id: 3, name: 'Profile', icon: Users },
        { id: 4, name: 'Format', icon: Video },
        { id: 5, name: 'Script', icon: Film },
        { id: 6, name: 'Generate', icon: Sparkles }
    ];

    const updateData = (field, value) => {
        setWizardData(prev => ({ ...prev, [field]: value }));
    };

    const isStepComplete = (stepId) => {
        switch (stepId) {
            case 1: return wizardData.brand !== null;
            case 2: return wizardData.product !== null;
            case 3: return wizardData.profile !== null;
            // Format (model/aspect ratio/resolution/character/setting) always has
            // sensible defaults — nothing here blocks proceeding.
            case 4: return true;
            // Scene 1 can stay blank if a winning ad's hook_transcript is available to
            // fall back on at generate time (see handleGenerate) — any additional
            // scenes beyond the first still need real content, since there's no
            // per-scene blueprint data to substitute for those.
            case 5: return scenes.every((s, i) =>
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

    const enhanceScene = async (index) => {
        const scene = scenes[index];
        if (!scene.action.trim()) {
            showError('Write a rough idea first, then enhance it.');
            return;
        }
        setEnhancingSceneIndex(index);
        try {
            const response = await authFetch(`${API_URL}/generated-ads/enhance-scene`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: scene.action,
                    character: (character.name || character.description) ? character : undefined,
                    location: location || undefined,
                    productName: wizardData.product?.name,
                    brandVoice: wizardData.brand?.voice,
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to enhance scene');
            }
            updateScene(index, 'action', data.enhanced);
        } catch (error) {
            console.error('Scene enhance error:', error);
            showError(error.message || 'Failed to enhance scene. Please try again.');
        } finally {
            setEnhancingSceneIndex(null);
        }
    };

    const pollVideoStatus = async (taskId, timeoutMs = POLL_TIMEOUT_MS) => {
        const startedAt = Date.now();
        while (!pollAbortRef.current) {
            if (Date.now() - startedAt > timeoutMs) {
                throw new Error(`Video generation timed out after ${Math.round(timeoutMs / 60_000)} minutes. Check back later or try again.`);
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
        setIsEditingVideo(false);
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

        const part2 = (model === 'kling-o3' && part2Enabled && part2Action.trim())
            ? { action: part2Action.trim(), durationSeconds: part2Duration }
            : undefined;

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
                    resolution,
                    model,
                    mode: templateMode,
                    templateId: templateMode === 'single' ? selectedVideoTemplate?.id : undefined,
                    part2,
                    useClaudePrompt: model !== 'kling-o3' && useClaudePrompt,
                })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to start video generation');
            }

            // Segment 1 + segment 2 + frame-extraction/concat work needs more headroom
            // than a single job's 10-minute window.
            const videoUrl = await pollVideoStatus(data.task_id, part2 ? 900_000 : POLL_TIMEOUT_MS);
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

    const handleEditVideo = async () => {
        if (!editInstruction.trim()) return;
        setGenerating(true);
        setIsEditingVideo(true);
        setGenerationState('waiting');
        pollAbortRef.current = false;

        try {
            const response = await authFetch(`${API_URL}/generated-ads/generate-video-edit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceVideoUrl: generatedVideoUrl,
                    instruction: editInstruction.trim(),
                    brandId: wizardData.brand?.id,
                })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.detail || 'Failed to start video edit');
            }

            const videoUrl = await pollVideoStatus(data.task_id);
            setGeneratedVideoUrl(videoUrl);
            setShowEditPanel(false);
            setEditInstruction('');
            showSuccess('Edit applied successfully!');

            // Save the edited result as its own entry, same pattern as handleGenerate.
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
                console.error('Failed to save edited video to database:', saveError);
                showError('Edit applied but failed to save to Generated Ads. Download it below before leaving this page.');
            }
        } catch (error) {
            console.error('Video edit error:', error);
            showError(error.message || 'Failed to edit video. Please try again.');
            setGenerationState('fail');
        } finally {
            setGenerating(false);
        }
    };

    const stateLabel = {
        waiting: 'Queued…',
        queuing: 'Queued…',
        generating: isEditingVideo ? 'Applying your edit (this can take a minute)…' : 'Generating your video (this can take a few minutes)…',
        success: 'Done!',
        fail: isEditingVideo ? 'Edit failed' : 'Generation failed',
    };

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-ink flex items-center gap-3">
                    <Video size={32} className="text-brand-600" />
                    Create Video Ads
                </h1>
                <p className="text-ink-secondary mt-1">Generate AI UGC-style video ads from your product assets</p>
            </div>

            {/* Skip straight to Generate once there's a real winning ad's hook line to
                use — bypasses Format and Script entirely instead of requiring a click
                through Character/Setting/Script when nothing in them needs customizing. */}
            {wizardData.brand && wizardData.product && wizardData.profile
                && selectedVideoTemplate?.video_blueprint_json?.hook_transcript && currentStep < 6 && (
                <div className="mb-6 flex items-center justify-between gap-4 bg-brand-50 border border-brand-200 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                        {selectedVideoTemplate.image_url && (
                            <img src={selectedVideoTemplate.image_url} alt="" className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                        )}
                        <div>
                            <p className="font-medium text-ink">Ready to generate from {selectedVideoTemplate.name}</p>
                            <p className="text-sm text-ink-secondary">Skip Format & Script — hook line and pacing pulled from this winning ad.</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={fillingFromWinningAd}
                        onClick={async () => { await fillFromWinningAd(); setCurrentStep(6); }}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium whitespace-nowrap disabled:opacity-60 disabled:cursor-wait"
                    >
                        {fillingFromWinningAd ? 'Writing script…' : '⚡ Skip to Generate'}
                    </button>
                </div>
            )}

            {/* Progress Steps */}
            <div className="mb-8 bg-surface rounded-xl shadow-sm border border-border p-6">
                <div className="flex items-center justify-between relative">
                    <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-border -z-10"></div>
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
                                className={`flex flex-col items-center bg-surface px-2 ${isClickable ? 'cursor-pointer group' : 'cursor-not-allowed opacity-60'}`}
                                onClick={() => isClickable && handleStepClick(step.id)}
                            >
                                <div
                                    className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-all ${isActive ? 'bg-brand-600 text-white scale-110 shadow-md' :
                                        isCompleted ? 'bg-green-500 text-white group-hover:bg-green-600' :
                                            'bg-border text-ink-tertiary group-hover:bg-border'
                                        }`}
                                >
                                    {isCompleted ? <Check size={20} /> : <Icon size={20} />}
                                </div>
                                <span className={`text-xs font-medium transition-colors ${isActive ? 'text-brand-600' :
                                    isClickable ? 'text-ink-tertiary group-hover:text-ink-secondary' : 'text-ink-tertiary'
                                    }`}>
                                    {step.name}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Step Content */}
            <div className="bg-surface rounded-xl shadow-sm border border-border p-8 min-h-[500px] relative">
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

                {/* Step 4: Format — model, aspect ratio/resolution, and who/where.
                    Model comes first since it determines Script's scene duration
                    options, max scene count, and which model-specific extras appear
                    there. */}
                {currentStep === 4 && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-ink mb-1">Video Model</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div
                                    onClick={() => selectModel('seedance-2-5')}
                                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${model === 'seedance-2-5' ? 'border-brand-600 bg-brand-50' : 'border-border hover:border-brand-300'}`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-bold text-ink">Seedance 2.5 — Best Quality</span>
                                        {model === 'seedance-2-5' && <Check className="text-brand-600" size={18} />}
                                    </div>
                                    <p className="text-sm text-ink-secondary">One fluid handheld shot, no cuts, natively up to 30s. (Recommended)</p>
                                </div>
                                <div
                                    onClick={() => selectModel('seedance')}
                                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${model === 'seedance' ? 'border-brand-600 bg-brand-50' : 'border-border hover:border-brand-300'}`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-bold text-ink">Seedance 2.0 — Legacy</span>
                                        {model === 'seedance' && <Check className="text-brand-600" size={18} />}
                                    </div>
                                    <p className="text-sm text-ink-secondary">One fluid handheld shot, no cuts, up to 15s. Cheaper, lower quality than 2.5.</p>
                                </div>
                                <div
                                    onClick={() => selectModel('kling-o3')}
                                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${model === 'kling-o3' ? 'border-brand-600 bg-brand-50' : 'border-border hover:border-brand-300'}`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-bold text-ink">Kling O3 — Multi-Shot</span>
                                        {model === 'kling-o3' && <Check className="text-brand-600" size={18} />}
                                    </div>
                                    <p className="text-sm text-ink-secondary">Up to 6 distinct shots/cuts, and the only option with a long-video continuation mode. Needs at least 2 reference photos to use them (1 alone isn't enough).</p>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-lg font-bold text-ink">Aspect Ratio</h3>
                            </div>
                            <div className="flex gap-2">
                                {['portrait', 'landscape'].map((ratio) => (
                                    <button
                                        key={ratio}
                                        type="button"
                                        onClick={() => setAspectRatio(ratio)}
                                        className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${aspectRatio === ratio ? 'bg-brand-600 text-white' : 'bg-surface-hover text-ink-secondary hover:bg-border'}`}
                                    >
                                        {ratio}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-lg font-bold text-ink">Resolution</h3>
                            </div>
                            <div className="flex gap-2">
                                {['480p', '720p', '1080p'].map((res) => (
                                    <button
                                        key={res}
                                        type="button"
                                        onClick={() => setResolution(res)}
                                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${resolution === res ? 'bg-brand-600 text-white' : 'bg-surface-hover text-ink-secondary hover:bg-border'}`}
                                    >
                                        {res}
                                    </button>
                                ))}
                            </div>
                            <p className="text-sm text-ink-tertiary mt-1">
                                480p costs roughly half as much per generation as 720p/1080p — a good default for cheap testing before committing to a full-quality run.
                            </p>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-ink mb-1">Character</h3>
                            <p className="text-sm text-ink-tertiary mb-3">Describe who's on camera. A product photo (selected in the previous step) doubles as a visual reference for consistency.</p>
                            <div className="grid grid-cols-2 gap-3">
                                <input type="text" value={character.name} onChange={(e) => setCharacter(prev => ({ ...prev, name: e.target.value }))} placeholder="Name (optional)" className="px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                                <input type="text" value={character.age} onChange={(e) => setCharacter(prev => ({ ...prev, age: e.target.value }))} placeholder="Age (e.g. mid-20s)" className="px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                                <input type="text" value={character.ethnicity} onChange={(e) => setCharacter(prev => ({ ...prev, ethnicity: e.target.value }))} placeholder="Ethnicity" className="px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                                <input type="text" value={character.gender} onChange={(e) => setCharacter(prev => ({ ...prev, gender: e.target.value }))} placeholder="Gender" className="px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent" />
                                <textarea
                                    value={character.description}
                                    onChange={(e) => setCharacter(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Additional detail: hair, features, clothing, voice, mannerisms…"
                                    rows={2}
                                    className="col-span-2 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                                />
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-ink mb-1">Setting</h3>
                            <input
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="e.g. a cozy, well-lit home kitchen"
                                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                            />
                        </div>
                    </div>
                )}

                {/* Step 5: Script — creative reference and the scene-by-scene script,
                    plus the AI-assist tools and model-specific extras that only make
                    sense once real script content exists. */}
                {currentStep === 5 && (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-ink mb-1">Creative Reference</h3>
                            <p className="text-sm text-ink-tertiary mb-3">
                                Base this video on one specific winning ad, a synthesis of the whole vertical's proven patterns, or let it auto-pick.
                            </p>
                            <div className="flex gap-2 mb-3 bg-surface-hover p-1 rounded-lg w-fit">
                                <button
                                    type="button"
                                    onClick={() => handleTemplateModeChange('auto')}
                                    className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${templateMode === 'auto' ? 'bg-surface text-brand-600 shadow-sm' : 'text-ink-secondary hover:text-ink'}`}
                                >
                                    <div className="flex items-center gap-2"><Sparkles size={16} /> Auto</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleTemplateModeChange('single')}
                                    className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${templateMode === 'single' ? 'bg-surface text-brand-600 shadow-sm' : 'text-ink-secondary hover:text-ink'}`}
                                >
                                    <div className="flex items-center gap-2"><Film size={16} /> Specific Ad</div>
                                </button>
                                {wizardData.brand?.verticalId && (
                                    <button
                                        type="button"
                                        onClick={() => handleTemplateModeChange('vertical')}
                                        className={`px-4 py-2 rounded-md font-medium text-sm transition-all ${templateMode === 'vertical' ? 'bg-surface text-brand-600 shadow-sm' : 'text-ink-secondary hover:text-ink'}`}
                                    >
                                        <div className="flex items-center gap-2"><Wand2 size={16} /> Whole Vertical</div>
                                    </button>
                                )}
                            </div>

                            {templateMode === 'single' && (
                                selectedVideoTemplate ? (
                                    <div className="flex items-center justify-between gap-3 bg-brand-50 border border-brand-200 rounded-lg p-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            {selectedVideoTemplate.image_url && (
                                                <img src={selectedVideoTemplate.image_url} alt="" className="w-12 h-12 object-cover rounded-lg flex-shrink-0" />
                                            )}
                                            <span className="text-sm font-medium text-ink truncate">{selectedVideoTemplate.name}</span>
                                        </div>
                                        <button type="button" onClick={() => setShowTemplatePicker(true)} className="text-sm text-brand-700 hover:text-brand-800 font-medium whitespace-nowrap">
                                            Change
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setShowTemplatePicker(true)}
                                        className="text-sm px-4 py-2 bg-brand-100 text-brand-700 rounded-lg hover:bg-brand-200 font-medium"
                                    >
                                        Browse winning ads…
                                    </button>
                                )
                            )}

                            {templateMode === 'vertical' && (
                                loadingVerticalTemplate ? (
                                    <div className="text-sm text-ink-tertiary">Synthesizing patterns across this vertical's winning ads…</div>
                                ) : selectedVideoTemplate ? (
                                    <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
                                        <p className="text-sm font-medium text-ink">{selectedVideoTemplate.name}</p>
                                        <p className="text-sm text-ink-secondary">Synthesized from {selectedVideoTemplate.source_count} winning ad{selectedVideoTemplate.source_count === 1 ? '' : 's'} in this vertical.</p>
                                    </div>
                                ) : (
                                    <div className="text-sm text-ink-tertiary">No analyzed winning ads found in this brand's vertical yet.</div>
                                )
                            )}
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-bold text-ink">Script</h3>
                                <div className="flex items-center gap-3">
                                    {selectedVideoTemplate?.video_blueprint_json?.hook_transcript && (
                                        <button
                                            type="button"
                                            disabled={fillingFromWinningAd}
                                            onClick={fillFromWinningAd}
                                            className="flex items-center gap-1 text-sm px-3 py-1 bg-brand-100 text-brand-700 rounded-lg hover:bg-brand-200 font-medium disabled:opacity-60 disabled:cursor-wait"
                                            title="Uses this winning ad's hook line as a starting point, completed and polished by Claude into a full two-beat script"
                                        >
                                            {fillingFromWinningAd ? 'Writing script…' : '✨ Fill from Winning Ad'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={addScene}
                                        disabled={scenes.length >= maxScenes}
                                        className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <Plus size={16} /> Add scene
                                    </button>
                                </div>
                            </div>
                            <p className="text-sm text-ink-tertiary mb-1">
                                {model === 'kling-o3'
                                    ? `Up to ${maxScenes} scenes, ${maxTotalDuration}s total — each scene renders as its own distinct shot/cut.`
                                    : `Up to ${maxScenes} scenes, ${maxTotalDuration}s total (one continuous take). Describe what the character does and says in each.`}
                                {selectedVideoTemplate?.video_blueprint_json?.hook_transcript && ' Scene 1 can stay blank to use the winning ad\'s own hook line directly.'}
                            </p>
                            <p className="text-sm text-ink-tertiary mb-1">
                                Tip: for lead-gen offers, a scene like <span className="italic">"She holds her phone up, scrolling through the signup form — name, email, phone — and taps the button to submit"</span> renders as a natural phone reveal, not just narration.
                            </p>
                            <p className={`text-sm mb-3 font-medium ${totalDuration > maxTotalDuration ? 'text-red-600' : 'text-ink-tertiary'}`}>
                                {totalDuration}s / {maxTotalDuration}s{totalDuration > maxTotalDuration ? ' — will be trimmed to fit' : ''}
                            </p>
                            <div className="space-y-3">
                                {scenes.map((scene, i) => (
                                    <div key={i} className="border border-border rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-medium text-ink-secondary">Scene {i + 1}</span>
                                                <select
                                                    value={scene.durationSeconds}
                                                    onChange={(e) => updateScene(i, 'durationSeconds', Number(e.target.value))}
                                                    className="text-sm border border-border rounded px-2 py-1"
                                                >
                                                    {sceneDurationOptions.map((d) => <option key={d} value={d}>{d}s</option>)}
                                                </select>
                                            </div>
                                            {scenes.length > 1 && (
                                                <button type="button" onClick={() => removeScene(i)} className="text-ink-tertiary hover:text-red-600">
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
                                            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => enhanceScene(i)}
                                            disabled={enhancingSceneIndex === i || !scene.action.trim()}
                                            className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed mt-1"
                                        >
                                            <Sparkles size={14} /> {enhancingSceneIndex === i ? 'Enhancing…' : 'Enhance with Claude'}
                                        </button>
                                        {model === 'kling-o3' && wizardData.product?.product_shots?.length > 0 && (
                                            <div className="mt-2">
                                                <select
                                                    value={scene.cutawayImageUrl || ''}
                                                    onChange={(e) => updateScene(i, 'cutawayImageUrl', e.target.value || undefined)}
                                                    className="text-sm border border-border rounded px-2 py-1 w-full"
                                                >
                                                    <option value="">No cutaway — let Kling render this shot</option>
                                                    {wizardData.product.product_shots.map((url, shotIdx) => (
                                                        <option key={url} value={url}>Cutaway to screenshot {shotIdx + 1}</option>
                                                    ))}
                                                </select>
                                                <p className="text-xs text-ink-tertiary mt-1">
                                                    Replaces this shot's entire visual with a real screenshot instead of relying on AI-rendered text — audio/narration keeps playing underneath. Kling only; scene timing isn't reliable enough for this on Seedance.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {model !== 'kling-o3' && (
                                <div className="mt-4 pt-4 border-t border-border">
                                    <label className="flex items-center gap-2 cursor-pointer mb-1">
                                        <input
                                            type="checkbox"
                                            checked={useClaudePrompt}
                                            onChange={(e) => setUseClaudePrompt(e.target.checked)}
                                            className="rounded border-border"
                                        />
                                        <span className="text-sm font-bold text-ink">Let Claude rework the full prompt</span>
                                    </label>
                                    <p className="text-xs text-ink-tertiary">
                                        Rewrites the whole generated prompt for more natural, specific prose (matching this brand's voice) before it's sent to the video model — the proven authenticity/quality-control instructions are preserved untouched, only the descriptive parts are rewritten.
                                    </p>
                                </div>
                            )}

                            {model === 'kling-o3' && (
                                <div className="mt-4 pt-4 border-t border-border">
                                    <label className="flex items-center gap-2 cursor-pointer mb-1">
                                        <input
                                            type="checkbox"
                                            checked={part2Enabled}
                                            onChange={(e) => setPart2Enabled(e.target.checked)}
                                            className="rounded border-border"
                                        />
                                        <span className="text-sm font-bold text-ink">Continue for longer (up to +15s)</span>
                                    </label>
                                    <p className="text-xs text-ink-tertiary mb-2">
                                        Chains a second Kling generation seeded from this video's own last frame — real visual continuity at the seam, not two unrelated clips stitched together. Audio isn't continuous across the seam, and generation takes noticeably longer.
                                    </p>
                                    {part2Enabled && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-ink-secondary">Continuation duration:</span>
                                                <select
                                                    value={part2Duration}
                                                    onChange={(e) => setPart2Duration(Number(e.target.value))}
                                                    className="text-sm border border-border rounded px-2 py-1"
                                                >
                                                    {KLING_SCENE_DURATION_OPTIONS.filter((d) => d >= 3).map((d) => <option key={d} value={d}>{d}s</option>)}
                                                </select>
                                            </div>
                                            <textarea
                                                value={part2Action}
                                                onChange={(e) => setPart2Action(e.target.value)}
                                                placeholder='What happens next? e.g. "She smiles, gives a thumbs up to the camera, and walks off."'
                                                rows={2}
                                                className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Step 6: Generate */}
                {currentStep === 6 && (
                    <div className="text-center py-12">
                        {!generatedVideoUrl && !generating && (
                            <>
                                <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <Sparkles className="text-brand-600" size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-ink mb-2">Generate Video</h3>
                                <p className="text-ink-secondary mb-6">Ready to generate your AI UGC video ad.</p>
                                <button
                                    onClick={handleGenerate}
                                    className="flex items-center gap-2 px-6 py-3 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium transition-colors mx-auto"
                                >
                                    <Sparkles size={20} />
                                    Generate Video
                                </button>
                            </>
                        )}

                        {generating && (
                            <>
                                <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                                    <Sparkles className="text-brand-600" size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-ink mb-2">{stateLabel[generationState] || 'Working…'}</h3>
                                <p className="text-ink-secondary">This can take a few minutes. Feel free to wait — don't navigate away.</p>
                            </>
                        )}

                        {generatedVideoUrl && !generating && (
                            <>
                                <video
                                    src={generatedVideoUrl}
                                    controls
                                    className="max-w-sm mx-auto rounded-lg shadow-md mb-6"
                                />
                                <p className="text-sm text-ink-tertiary mb-4">
                                    Not quite right? Tweak the character, script, or model and regenerate — your selections are still filled in.
                                </p>
                                <div className="flex items-center justify-center gap-3 flex-wrap">
                                    <button
                                        type="button"
                                        onClick={() => downloadFile(generatedVideoUrl, `generated-video-${Date.now()}.mp4`).catch(() => showError('Failed to download video. Please try again.'))}
                                        className="flex items-center gap-2 px-4 py-2 bg-surface-hover text-ink-secondary rounded-lg hover:bg-border font-medium"
                                    >
                                        <Download size={18} /> Download
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setGeneratedVideoUrl(null);
                                            setGenerationState(null);
                                            // Script (5), not Format (4) — most refinements are to the
                                            // dialogue/scenes, not the model/resolution; Format is one Back away.
                                            setCurrentStep(5);
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-surface-hover text-ink-secondary rounded-lg hover:bg-border font-medium"
                                    >
                                        <Wand2 size={18} /> Refine & Regenerate
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowEditPanel((prev) => !prev)}
                                        className="flex items-center gap-2 px-4 py-2 bg-surface-hover text-ink-secondary rounded-lg hover:bg-border font-medium"
                                    >
                                        <Wand2 size={18} /> Edit This Video
                                    </button>
                                    <button
                                        onClick={() => {
                                            setGeneratedVideoUrl(null);
                                            setGenerationState(null);
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium"
                                    >
                                        <Sparkles size={18} /> Generate Another (same settings)
                                    </button>
                                </div>

                                {showEditPanel && (
                                    <div className="mt-4 max-w-md mx-auto text-left bg-surface-hover border border-border rounded-lg p-4">
                                        <label className="block text-sm font-bold text-ink mb-1">What should change?</label>
                                        <p className="text-xs text-ink-tertiary mb-2">
                                            Edits just the thing you describe — everything else in this exact take (face, setting, framing) stays the same. Works regardless of which model made this video, but source clips under 4s can't be edited.
                                        </p>
                                        <textarea
                                            value={editInstruction}
                                            onChange={(e) => setEditInstruction(e.target.value)}
                                            placeholder='e.g. "Change her sweater to blue" or "Remove the papers from her hands"'
                                            rows={2}
                                            className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm mb-3"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleEditVideo}
                                                disabled={!editInstruction.trim()}
                                                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Apply Edit
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setShowEditPanel(false); setEditInstruction(''); }}
                                                className="px-4 py-2 bg-surface text-ink-secondary rounded-lg hover:bg-border font-medium"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
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
                        ? 'bg-surface-hover text-ink-tertiary cursor-not-allowed'
                        : 'bg-surface-hover text-ink-secondary hover:bg-border'
                        }`}
                >
                    <ChevronLeft size={20} />
                    Back
                </button>

                {currentStep < steps.length && (
                    <button
                        onClick={nextStep}
                        disabled={!canProceed()}
                        className="flex items-center gap-2 px-6 py-3 bg-brand-600 text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
