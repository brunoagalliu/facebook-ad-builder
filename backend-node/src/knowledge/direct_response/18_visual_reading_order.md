# Visual Reading Order

Drawn from Siegfried Vögele's eye-tracking research in the *Handbook of Direct Mail* — the one source in this knowledge base that isn't about words at all. Applies specifically to the `visual_description` and `image_generation_prompt` outputs (Ad Remix and image generation), not to headline/body/cta text directly, since Meta/TikTok render those as separate elements alongside the image rather than as text baked into it.

## Readers scan a fixed path, they don't read a page top-to-bottom

Vögele's research found the eye consistently lands on the dominant visual element first, then large text, then supporting detail, then the call-to-action or logo last — a predictable path, not a random scan. Applied to feed ads: the image's focal point is effectively read *before* the headline, even though the headline is a separate ad-unit field, because the image is what stops the scroll in the first place.

## Image and copy have to reinforce the same claim, not compete for it

If the visual's most eye-catching element points at something the headline doesn't reference (a lifestyle scene with the product barely visible in a corner, paired with a headline about a specific product benefit), the reader's attention and the ad's claim are pulling in different directions — the image wins the first look, and if it doesn't support the claim, the headline reads as disconnected from what was just seen. The two should be planned together: whatever the visual's focal point is, the headline/hook should be about that same thing.

## Practical rule for this engine

When writing `visual_description` or `image_generation_prompt`, be explicit about what the dominant focal point of the image is — the product itself, a result, a face, a scene — and make sure the headline/hook concept for that same variation is built around that same focal point, not a different angle the image doesn't visually support.
