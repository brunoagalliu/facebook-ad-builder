import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileImage, Video, ArrowRight } from 'lucide-react';

export default function CreateAds() {
    const navigate = useNavigate();

    return (
        <div className="max-w-5xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-ink">Create New Ad</h1>
                <p className="text-ink-secondary mt-2">Select the format you want to create</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Image Ad Card */}
                <button
                    onClick={() => navigate('/image-ads')}
                    className="group relative flex flex-col items-start p-8 bg-surface rounded-2xl border-2 border-border hover:border-brand-200 hover:shadow-xl transition-all duration-300 text-left"
                >
                    <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <FileImage size={32} className="text-brand-600" />
                    </div>

                    <h3 className="text-2xl font-bold text-ink mb-3">Image Ad</h3>
                    <p className="text-ink-tertiary mb-8 leading-relaxed">
                        Create high-converting static image ads using our template library or AI generation. Perfect for feed posts and stories.
                    </p>

                    <div className="mt-auto flex items-center gap-2 text-brand-600 font-semibold group-hover:gap-3 transition-all">
                        Start Creating <ArrowRight size={20} />
                    </div>
                </button>

                {/* Video Ad Card */}
                <button
                    onClick={() => navigate('/video-ads')}
                    className="group relative flex flex-col items-start p-8 bg-surface rounded-2xl border-2 border-border hover:border-blue-200 hover:shadow-xl transition-all duration-300 text-left"
                >
                    <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <Video size={32} className="text-blue-600" />
                    </div>

                    <h3 className="text-2xl font-bold text-ink mb-3">Video Ad</h3>
                    <p className="text-ink-tertiary mb-8 leading-relaxed">
                        Generate engaging video ads from product shots or stock footage. Ideal for Reels, Stories, and TikTok.
                    </p>

                    <div className="mt-auto flex items-center gap-2 text-blue-600 font-semibold group-hover:gap-3 transition-all">
                        Start Creating <ArrowRight size={20} />
                    </div>
                </button>
            </div>
        </div>
    );
}
