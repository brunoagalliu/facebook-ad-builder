from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json

from app.core.config import settings
from app.services import copy_generation_service

router = APIRouter()

class CopyGenerationRequest(BaseModel):
    brand: Dict[str, Any]
    product: Dict[str, Any]
    profile: Dict[str, Any]
    template: Optional[Dict[str, Any]] = None
    variationCount: int = 3
    campaignDetails: Dict[str, str]
    customPrompt: Optional[str] = None

class FieldRegenerationRequest(BaseModel):
    field: str
    currentValue: str
    brand: Dict[str, Any]
    product: Dict[str, Any]
    profile: Dict[str, Any]
    template: Optional[Dict[str, Any]] = None
    campaignDetails: Dict[str, str]

@router.post("/generate")
async def generate_copy(request: CopyGenerationRequest):
    """Generate direct-response ad copy variations using the doctrine-grounded copy engine"""

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Anthropic API key not configured")

    try:
        result = copy_generation_service.generate_variations(
            brand=request.brand,
            product=request.product,
            profile=request.profile,
            campaign_details=request.campaignDetails,
            template=request.template,
            variation_count=request.variationCount,
            custom_prompt=request.customPrompt,
        )
        return result

    except json.JSONDecodeError as e:
        print(f"JSON Parse Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response as JSON: {str(e)}")
    except Exception as e:
        print(f"Copy generation error: {e}")
        raise HTTPException(status_code=500, detail=f"Copy generation failed: {str(e)}")

@router.post("/regenerate-field")
async def regenerate_field(request: FieldRegenerationRequest):
    """Regenerate a specific field (headline, body, or cta)"""

    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=500, detail="Anthropic API key not configured")

    try:
        new_value = copy_generation_service.regenerate_field(
            field=request.field,
            current_value=request.currentValue,
            brand=request.brand,
            product=request.product,
            profile=request.profile,
            campaign_details=request.campaignDetails,
        )
        return {"newValue": new_value}

    except Exception as e:
        print(f"Field regeneration error: {e}")
        raise HTTPException(status_code=500, detail=f"Field regeneration failed: {str(e)}")
