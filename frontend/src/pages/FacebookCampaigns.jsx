import React, { useState } from 'react';
import { Check, Target, Users, Image as ImageIcon, Zap, CheckCircle, CreditCard, Megaphone, CheckCircle2, ArrowRight } from 'lucide-react';
import { CampaignProvider } from '../context/CampaignContext';
import AdAccountStep from '../components/AdAccountStep';
import CampaignStep from '../components/CampaignStep';
import AdSetStep from '../components/AdSetStep';
import AdCreativeStep from '../components/AdCreativeStep';
import BulkAdCreation from '../components/BulkAdCreation';

const FacebookCampaignWizard = () => {
    const [currentStep, setCurrentStep] = useState(1);
    const [formData, setFormData] = useState({
        adAccountId: null,
        campaignId: null,
        adSetId: null,
        creativeId: null,
    });

    const steps = [
        { id: 1, label: 'Ad Account', icon: CreditCard },
        { id: 2, label: 'Campaign', icon: Target },
        { id: 3, label: 'Ad Set', icon: Users },
        { id: 4, label: 'Creative', icon: ImageIcon },
        { id: 5, label: 'Bulk Ads', icon: Megaphone },
        { id: 6, label: 'Review & Launch', icon: CheckCircle2 },
    ];

    const handleNext = () => {
        if (currentStep < steps.length) {
            setCurrentStep(currentStep + 1);
        }
    };

    const handleBack = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    // Placeholder for validation logic
    const isStepValid = () => {
        switch (currentStep) {
            case 1: return !!formData.adAccountId;
            case 2: return !!formData.campaignId;
            case 3: return !!formData.adSetId;
            case 4: return !!formData.creativeId;
            default: return true;
        }
    };

    return (
        <CampaignProvider>
            <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold text-ink mb-2 flex items-center gap-3">
                        <Megaphone size={32} className="text-brand-600" />
                        Facebook Campaigns
                    </h1>
                    <p className="text-ink-secondary">Create and manage your Facebook ad campaigns</p>
                </div>

                {/* Wizard Steps */}
                <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
                    <div className="flex justify-between items-center mb-8 relative">
                        {/* Progress Bar Background */}
                        <div className="absolute top-1/2 left-0 w-full h-1 bg-surface-hover -z-10 rounded-full" />

                        {/* Progress Bar Fill */}
                        <div
                            className="absolute top-1/2 left-0 h-1 bg-brand-600 -z-10 rounded-full transition-all duration-500 ease-in-out"
                            style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
                        />

                        {steps.map((step) => {
                            const isCompleted = step.id < currentStep;
                            const isCurrent = step.id === currentStep;

                            return (
                                <div key={step.id} className="flex flex-col items-center gap-2 bg-surface px-2">
                                    <div
                                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${isCompleted || isCurrent
                                            ? 'bg-brand-600 text-white shadow-md scale-110'
                                            : 'bg-surface-hover text-ink-tertiary'
                                            }`}
                                    >
                                        {isCompleted ? (
                                            <CheckCircle2 size={20} />
                                        ) : (
                                            <step.icon size={20} />
                                        )}
                                    </div>
                                    <span
                                        className={`text-sm font-medium transition-colors duration-300 ${isCurrent ? 'text-brand-900' : 'text-ink-tertiary'
                                            }`}
                                    >
                                        {step.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Step Content */}
                    <div className="min-h-[400px]">
                        {currentStep === 1 && (
                            <AdAccountStep
                                selectedAccount={formData.adAccountId}
                                onAccountSelect={(id) => setFormData({ ...formData, adAccountId: id })}
                                onNext={handleNext}
                            />
                        )}
                        {currentStep === 2 && (
                            <CampaignStep
                                adAccountId={formData.adAccountId}
                                selectedCampaign={formData.campaignId}
                                onCampaignSelect={(id) => setFormData({ ...formData, campaignId: id })}
                                onNext={handleNext}
                                onBack={handleBack}
                            />
                        )}
                        {currentStep === 3 && (
                            <AdSetStep
                                adAccountId={formData.adAccountId}
                                campaignId={formData.campaignId}
                                selectedAdSet={formData.adSetId}
                                onAdSetSelect={(id) => setFormData({ ...formData, adSetId: id })}
                                onNext={handleNext}
                                onBack={handleBack}
                            />
                        )}
                        {currentStep === 4 && (
                            <AdCreativeStep
                                adAccountId={formData.adAccountId}
                                selectedCreative={formData.creativeId}
                                onCreativeSelect={(id) => setFormData({ ...formData, creativeId: id })}
                                onNext={handleNext}
                                onBack={handleBack}
                            />
                        )}
                        {currentStep === 5 && (
                            <BulkAdCreation
                                onNext={handleNext}
                                onBack={handleBack}
                            />
                        )}
                        {currentStep === 6 && (
                            <div className="text-center py-12">
                                <CheckCircle2 className="mx-auto mb-4 text-brand-500" size={64} />
                                <h2 className="text-3xl font-bold mb-4">Campaign Ready to Launch!</h2>
                                <p className="text-ink-secondary mb-8">
                                    Review your settings and launch your Facebook ad campaign.
                                </p>
                            </div>
                        )}
                    </div>


                </div>
            </div>
        </CampaignProvider>
    );
};

export default FacebookCampaignWizard;
