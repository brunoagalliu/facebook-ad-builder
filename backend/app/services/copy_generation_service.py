"""Direct-response ad copy generation.

Applies the curated direct-response doctrine (backend/app/knowledge/direct_response/*.md)
as a grounding system prompt on top of brand/product/audience/campaign inputs, via the
Claude API. Kept independent of the FastAPI request schemas in api/v1/copy_generation.py
so it can be reused by other callers (e.g. the Ad Remix reconstruction path).
"""
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

import anthropic

from app.core.config import settings

KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge" / "direct_response"
MODEL = "claude-sonnet-5"

SYSTEM_PROMPT_TEMPLATE = """You are the direct-response copywriting engine for an affiliate marketing team's ad creation tool. The following is your doctrine — apply it to every piece of copy you generate, without exception.

{knowledge_base}

Output ONLY valid JSON or plain text exactly as instructed in the user message — no markdown code fences, no commentary before or after."""


@lru_cache(maxsize=1)
def get_knowledge_base() -> str:
    sections = [path.read_text() for path in sorted(KNOWLEDGE_DIR.glob("*.md"))]
    return "\n\n---\n\n".join(sections)


def _client() -> anthropic.Anthropic:
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


def _system_prompt() -> str:
    return SYSTEM_PROMPT_TEMPLATE.format(knowledge_base=get_knowledge_base())


def _extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[: -3]
    return json.loads(text.strip())


def build_variations_prompt(
    brand: Dict[str, Any],
    product: Dict[str, Any],
    profile: Dict[str, Any],
    campaign_details: Dict[str, str],
    template: Optional[Dict[str, Any]] = None,
    variation_count: int = 3,
) -> str:
    template = template or {}
    return f"""Generate {variation_count} variations of ad copy for a Facebook/Instagram ad campaign.

BRAND VOICE: {brand.get('voice', 'Professional and friendly')}

PRODUCT: {product.get('name')}
{f"Description: {product.get('description')}" if product.get('description') else ''}

TARGET AUDIENCE:
- Demographics: {profile.get('demographics', 'General audience')}
- Pain Points: {profile.get('pain_points', 'Not specified')}
- Goals: {profile.get('goals', 'Not specified')}

CAMPAIGN DETAILS:
- Offer: {campaign_details.get('offer')}
- Urgency: {campaign_details.get('urgency', 'Not specified')}
- Key Messaging: {campaign_details.get('messaging')}

TEMPLATE STYLE: {template.get('design_style', 'Modern and clean')}

Each of the {variation_count} variations must:
1. Pass the direct-response mandate in your doctrine — a real reason to act now, not just brand messaging
2. Match the brand voice in tone only (voice never overrides the doctrine's urgency/specificity requirements)
3. Draw from a different body-copy framework or trigger combination across variations so they are meaningfully distinct, not restatements of the same angle
4. Address the audience's stated pain points and goals directly
5. Keep headlines under 40 characters
6. Keep body copy under 125 characters for bullet/short styles, up to 200 characters for storytelling styles
7. Keep CTAs under 20 characters, phrased as an instruction, not a soft suggestion

Return ONLY valid JSON in this exact format, no markdown fences, no other text:
{{
  "variations": [
    {{
      "headline": "Short, punchy headline",
      "body": "Compelling body copy",
      "cta": "Action CTA"
    }}
  ]
}}"""


def build_field_prompt(
    field: str,
    current_value: str,
    brand: Dict[str, Any],
    product: Dict[str, Any],
    profile: Dict[str, Any],
    campaign_details: Dict[str, str],
) -> str:
    field_instructions = {
        "headline": "Generate a new headline (under 40 characters)",
        "body": "Generate new body copy (under 125 characters for bullets, or up to 200 for storytelling)",
        "cta": "Generate a new call-to-action (under 20 characters), phrased as an instruction, not a soft suggestion",
    }
    return f"""{field_instructions.get(field, 'Generate new copy')}, applying your direct-response doctrine.

BRAND VOICE: {brand.get('voice', 'Professional and friendly')}
PRODUCT: {product.get('name')}
TARGET AUDIENCE: {profile.get('demographics', 'General audience')}
CAMPAIGN: {campaign_details.get('offer')}

Current {field}: {current_value}

Generate a DIFFERENT, fresh variation that still passes the direct-response mandate, matches the brand voice, and follows the character limits.

Return ONLY the new {field} text, nothing else — no quotes, no markdown, no explanation."""


def generate_variations(
    brand: Dict[str, Any],
    product: Dict[str, Any],
    profile: Dict[str, Any],
    campaign_details: Dict[str, str],
    template: Optional[Dict[str, Any]] = None,
    variation_count: int = 3,
    custom_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    prompt = custom_prompt or build_variations_prompt(
        brand, product, profile, campaign_details, template, variation_count
    )
    response = _client().messages.create(
        model=MODEL,
        max_tokens=2000,
        system=_system_prompt(),
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text
    return _extract_json(text)


def regenerate_field(
    field: str,
    current_value: str,
    brand: Dict[str, Any],
    product: Dict[str, Any],
    profile: Dict[str, Any],
    campaign_details: Dict[str, str],
) -> str:
    prompt = build_field_prompt(field, current_value, brand, product, profile, campaign_details)
    response = _client().messages.create(
        model=MODEL,
        max_tokens=300,
        system=_system_prompt(),
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip().strip('"').strip("'")
